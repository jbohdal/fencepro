// Scheduling an install, the way the office does it (Schedule > Ready to
// schedule, ScheduleInstall.tsx; server lib/installScheduling.ts):
//
//   1. Two realistic sold jobs: A (yes to texts, nothing ready yet, a crew-day
//      estimate of 5 on the job) and B (no answer on texts; permit issued, 811
//      ticket, materials ordered). Both are in Ready to schedule with their
//      details and warnings. Schedule Settings show Monday to Friday only.
//   2. Computer, the Schedule tab, March 2027: drag A onto a Thursday. The
//      window fills the crew days on crew days only, warns (permit, 811,
//      deposit, materials; a holiday when the start is moved to Thanksgiving),
//      says the crew days in words, and books with "Schedule anyway"; the
//      summary says what happened with Google Calendar. The text is prepared
//      word for word and only opens on this phone. The month fits at 1440 and
//      1280 wide (no sideways scroll), with the cards on it.
//   3. Phone (WebKit): Ready to schedule tab, tap B: a day A's crew already
//      has is warned (double booking, still allowed); another day books it.
//      B has no yes to texts: no text button, "call them" instead.
//   4. The crew packet lists the crew days, Dispatch shows each (date picker),
//      the customer portal shows the install date and only the steps really
//      done, the pipeline card face shows "Install Thu 3/4", the Operations
//      card "Thu, Mar 4 to Fri, Mar 5", one crew in the crew filter.
//   5. Friday switched off: A's Friday still shows, with "Friday is not a work
//      day any more"; its Move window does not tick weekends and books Thu, Mon.
//   6. Reschedule by drag asks, then offers the "moved" text.
//   7. Rain day: nothing until the day is picked; preview; confirm; moved.
//   8. Take off the schedule: back to its stage (Awaiting Locates), crew and
//      dates cleared, its estimate (5) kept, the "date is being changed" text
//      prepared; the portal says "Install date: to be set".
//   9. A holiday shows on the month (Memorial Day). Everything is removed and
//      Schedule Settings put back as they were.
//
//   APP_URL=http://localhost:4015 API_URL=http://localhost:4015 E2E_ACCESS_TOKEN=<dev owner> SHOTS=<folder> node e2e/schedule-install.mjs
//
// Dev copy only (never port 4000). Dates are in March 2027, clear of real jobs.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes customers, quotes and jobs on the shared dev copy
import { chromium, webkit } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
if (!/^http:\/\/localhost:\d+$/.test(APP) || /:4000$/.test(APP) || /:4000$/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
let shotN = 0
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${String(++shotN).padStart(2, '0')}-${name}.png`) }).catch(() => {}) }

const dow = d => new Date(`${d}T12:00:00Z`).getUTCDay()
const plus = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const fill = (start, n, week) => { const out = []; let d = start; while (!week.includes(dow(d))) d = plus(d, 1); out.push(d); while (out.length < n) { d = plus(d, 1); if (week.includes(dow(d))) out.push(d) } return out }
const us = d => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`
const weekdayUs = d => `${new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}, ${us(d)}`
const short = d => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dow(d)]} ${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

const stamp = Date.now().toString(36).slice(-6)
const ADDR1 = '4411 SE 31st St, Ocala, FL 34480', ADDR2 = '9020 SW 103rd Ln, Ocala, FL 34481'
const W = {
  a: { contactId: crypto.randomUUID(), cardId: crypto.randomUUID(), quoteId: crypto.randomUUID(), first: 'Dana', last: `E2E Sched ${stamp}`, phone: '3525550161', addr: ADDR1, runs: [150, 130], walk: 1, jobId: '', consent: true },
  b: { contactId: crypto.randomUUID(), cardId: crypto.randomUUID(), quoteId: crypto.randomUUID(), first: 'Ray', last: `E2E Phone ${stamp}`, phone: '3525550162', addr: ADDR2, runs: [96], walk: 0, jobId: '', consent: false },
}
const nameOf = x => `${x.first} ${x.last}`
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const browsers = []

async function makeSoldJob(x, extra = {}) {
  const sections = x.runs.reduce((s, ft) => s + Math.ceil(ft / 8), 0)
  const feet = x.runs.reduce((s, f) => s + f, 0)
  const price = Math.round(feet * 38.5 * 100) / 100
  const c = await call('POST', '/api/crm-contacts', { id: x.contactId, firstName: x.first, lastName: x.last, phone: x.phone, email: `e2e-sched-${stamp}-${x.first.toLowerCase()}@example.invalid`, serviceAddress: x.addr, leadSource: 'Other',
    lead: { id: x.cardId, customerId: x.contactId, firstName: x.first, lastName: x.last, phone: x.phone, address: x.addr, stage: 'Signed Contract', leadSource: 'Other', quoteId: x.quoteId, createdAt: today, lastMoved: today }, leadBefore: null })
  const consent = x.consent ? await call('POST', `/api/crm-contacts/${x.contactId}/text-consent`, { consent: 'yes' }) : { status: 200 }
  const q = await call('POST', '/api/saved-quotes', {
    id: x.quoteId, crmContactId: x.contactId, customerName: nameOf(x), customerPhone: x.phone, customerAddress: x.addr,
    fenceStyle: "WV-ND 6'x8' Privacy", runs: x.runs, sections, corners: x.runs.length - 1, ends: 2, walkGates: x.walk, materialCost: feet * 12, laborCost: feet * 6, totalCOGS: feet * 18, finalPrice: price, gmPct: 0.35,
    pullSheet: [], status: 'SENT', date: today, salesRep: 'E2E Salesman', leadSource: 'Other',
  })
  const sold = await call('PATCH', `/api/saved-quotes/${x.quoteId}`, { status: 'SOLD' })
  const j = await call('POST', '/api/saved-jobs', { quoteId: x.quoteId, crmContactId: x.contactId, customerName: nameOf(x), customerPhone: x.phone, customerAddress: x.addr, fenceStyle: "WV-ND 6'x8' Privacy", sections, totalFeet: feet, walkGates: x.walk, quotePrice: price, contractValue: price, status: 'staging', salesRep: 'E2E Salesman', ...extra })
  x.jobId = j.json.data?.id || ''
  return [c, consent, q, sold, j].every(r => r.status < 300) && !!x.jobId
}

async function browserPage(kind, viewport) {
  const phone = kind === 'phone'
  const br = phone ? await webkit.launch() : await chromium.launch()
  browsers.push(br)
  const ctx = await br.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: viewport || { width: 1440, height: 950 } })
  await signInByCookie(ctx, { api: API })
  // A text hands off to the phone's own texting app: the link is recorded, nothing leaves.
  await ctx.addInitScript(() => {
    window.__sms = []
    window.addEventListener('click', e => { const a = e.target instanceof Element ? e.target.closest('a[href^="sms:"],a[href^="tel:"]') : null; if (a) { window.__sms.push(a.getAttribute('href')); e.preventDefault() } }, true)
  })
  const page = await ctx.newPage()
  const errors = [], sends = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  // Anything that would text or email a customer from the server (none should happen).
  page.on('request', r => { if (/\/(sms|send-sms|twilio|messages\/send|outbound)/i.test(r.url()) && r.method() !== 'GET') sends.push(`${r.method()} ${r.url()}`) })
  return { br, ctx, page, errors, sends, phone }
}

const textOf = (first, start, kind) => kind === 'scheduled'
  ? `Getter Done Fence: Hi ${first}, your fence installation is scheduled to start on ${weekdayUs(start)}. Our crew will arrive in the morning. Questions? Call (352) 789 4314. Reply STOP to opt out.`
  : kind === 'moved'
    ? `Getter Done Fence: Hi ${first}, your fence installation has moved and is now scheduled to start on ${weekdayUs(start)}. Our crew will arrive in the morning. Questions? Call (352) 789 4314. Reply STOP to opt out.`
    : `Getter Done Fence: Hi ${first}, your fence installation date is being changed. We'll call you with a new date. Questions? Call (352) 789 4314. Reply STOP to opt out.`

// Schedule Settings, kept to put back exactly: this run uses Monday to Friday, then switches Friday off.
const ACCOUNT = (await call('GET', '/api/schedule/settings')).json.data?.accountId || ''
if (!/^[0-9a-f-]{36}$/.test(ACCOUNT)) { console.error('Could not read the company from Schedule Settings.'); process.exit(2) }
const settingsBefore = sql(`SELECT "workDays"::text FROM "ScheduleSettings" WHERE "accountId" = ${lit(ACCOUNT)}`)
const setWorkDays = days => sql(`UPDATE "ScheduleSettings" SET "workDays" = '${JSON.stringify(days)}'::jsonb, version = version + 1, "updatedAt" = now() WHERE "accountId" = ${lit(ACCOUNT)}`)
const fitCheck = async (page, label) => {
  const r = await page.evaluate(() => {
    const t = document.querySelector('table.calendar-table'); const box = t?.parentElement
    const heads = [...document.querySelectorAll('table.calendar-table thead th')]
    const last = heads[heads.length - 1]?.getBoundingClientRect()
    return { table: t?.scrollWidth ?? 0, box: box?.clientWidth ?? 0, lastRight: last ? last.right : 0, boxRight: box ? box.getBoundingClientRect().right : 0, page: document.documentElement.scrollWidth, win: window.innerWidth }
  })
  check(`${label}: the month fits (no sideways scroll; the last work day in view)`, r.table <= r.box + 1 && r.lastRight <= r.boxRight + 1 && r.page <= r.win + 1, JSON.stringify(r))
}

/** Each month card of a job: the whole name shows (two lines at most, nothing cut), and its "1/2" day badge is fully visible. */
const cardsReadable = async (page, jobId, days, label) => {
  const cards = await page.locator(`[data-install-entry="${jobId}"]`).evaluateAll(els => els.map(el => {
    const n = el.querySelector('[data-install-name]'); const b = el.querySelector('[data-install-daybadge]')
    return { name: n?.textContent?.trim(), nameCut: n ? n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1 : true,
      badge: b?.textContent?.trim() ?? null, badgeCut: b ? b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > el.getBoundingClientRect().right + 1 : false }
  }))
  check(`${label}: each card shows the whole name and its day (${cards.map(c => c.badge).join(', ')})`, cards.length === days && cards.every((c, i) => !c.nameCut && c.name && c.badge === `${i + 1}/${days}` && !c.badgeCut), JSON.stringify(cards))
}

let packetId = null
try {
  setWorkDays([1, 2, 3, 4, 5])
  // ── 1. Two sold jobs ──
  const okA = await makeSoldJob(W.a, { estimatedDays: 5 })
  const okB = await makeSoldJob(W.b, { materialsStatus: 'ordered', locatesDate: '2027-03-01', locatesExpDate: '2027-03-31' })
  // B's 811 locate, the job's one record (ticket, good to dig, expires): saved as the job page saves it.
  if (W.b.jobId) await call('PUT', `/api/saved-jobs/${W.b.jobId}/locate`, { ticket: '294610232', calledDate: today, goodDate: '2027-03-01', expDate: '2027-03-31' })
  if (W.b.jobId) sql(`INSERT INTO "Permit" (id, "accountId", "jobId", status, "approvedAt", "updatedAt") SELECT ${lit(crypto.randomUUID())}, "accountId", id, 'approved', '2027-02-20', now() FROM "SavedJob" WHERE id = ${lit(W.b.jobId)}`)
  check('setup: two customers, quotes marked Sold, their jobs; Schedule Settings Monday to Friday for this run', okA && okB, `${W.a.jobId} ${W.b.jobId}`)
  let week = [1, 2, 3, 4, 5]
  const crews = (await call('GET', '/api/schedule/settings')).json.data.crews
  const stageA0 = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data?.opsStage

  const ready = (await call('GET', '/api/schedule/ready')).json.data || []
  const ra = ready.find(r => r.id === W.a.jobId), rb = ready.find(r => r.id === W.b.jobId)
  check('Ready to schedule (API): both jobs, footage, sections, crew days from the quote', !!ra && !!rb && ra.footage === 280 && ra.sections === 36 && ra.crewDays >= 1 && ra.crewDaysFrom === 'quote', JSON.stringify(ra && { footage: ra.footage, sections: ra.sections, crewDays: ra.crewDays, from: ra.crewDaysFrom }))
  const daysA = 2

  // ── 2. Computer ──
  const desk = await browserPage('desk')
  const p = desk.page
  await p.goto(`${APP}/schedule`)
  await p.waitForSelector('[data-ready-panel]', { timeout: 60000 })
  const card = p.locator(`[data-ready-job="${W.a.jobId}"]`)
  await card.waitFor({ timeout: 20000 })
  const cardText = (await card.innerText()).replace(/\s+/g, ' ')
  check('computer: A is in Ready to schedule with customer, address, style, footage, sections, crew days', cardText.includes(nameOf(W.a)) && cardText.includes(ADDR1) && /White Vinyl/i.test(cardText) && cardText.includes('280 ft') && cardText.includes('36 sections') && /crew day/.test(cardText), cardText.slice(0, 220))
  const chips = await card.locator('[data-ready-chip]').evaluateAll(els => els.map(e => [e.getAttribute('data-ready-chip'), e.getAttribute('data-tone')]))
  check('computer: permit, 811, deposit and materials shown, the not ready ones marked', chips.length === 4 && chips.every(c => c[1] !== 'ok'), JSON.stringify(chips))
  await shot(p, 'computer-ready-to-schedule')

  // Settings: Monday to Friday only, the words follow the days.
  await p.locator('[data-schedule-settings]').click()
  await p.waitForSelector('[data-settings-week]')
  const dayButtons = await p.locator('h3:has-text("Work Days") + div button').allInnerTexts()
  check('Schedule Settings: only Monday to Friday to tick (no Sat or Sun), "Crew days: Monday to Friday"', dayButtons.join(',') === 'Mon,Tue,Wed,Thu,Fri' && /Monday to Friday/.test(await p.locator('[data-settings-week]').innerText()), dayButtons.join(','))
  await p.locator('button:has-text("Cancel")').first().click(); await sleep(300)

  for (let i = 0; i < 12 && (await p.locator('[data-month]').getAttribute('data-month')) !== '2027-03'; i++) { await p.locator('[data-month-next]').click(); await sleep(150) }
  const headers = await p.locator('table.calendar-table thead th').allInnerTexts()
  check('computer: the month shows crew days only (Mon to Fri)', headers.length === 5 && !headers.some(h => /^(Sat|Sun)/.test(h.trim())), headers.join('|'))

  const START = '2027-03-04' // a Thursday
  await card.dragTo(p.locator(`td[data-day="${START}"]`))
  await p.waitForSelector(`[data-schedule-install="${W.a.jobId}"] [data-si-save]`, { timeout: 15000 })
  const dlg = p.locator(`[data-schedule-install="${W.a.jobId}"]`)
  await dlg.locator('[data-si-days]').waitFor()
  // The quote's crew days, set to 2 so the job runs Thu and Fri.
  for (let i = 0; i < 10 && Number(await dlg.locator('[data-si-days]').innerText()) > daysA; i++) await dlg.locator('[data-si-days-less]').click()
  for (let i = 0; i < 10 && Number(await dlg.locator('[data-si-days]').innerText()) < daysA; i++) await dlg.locator('[data-si-days-more]').click()
  const planA = fill(START, daysA, week)
  check('computer: drag onto Thursday opens Schedule install on that day', (await dlg.locator('[data-si-start]').inputValue()) === START)
  check(`computer: crew days on crew days only: ${planA.join(', ')}; "Crew days: Monday to Friday"`, (await dlg.locator('[data-si-plan]').getAttribute('data-si-plan')) === planA.join(',') && /Monday to Friday/.test(await dlg.locator('[data-si-week]').innerText()), await dlg.locator('[data-si-plan]').getAttribute('data-si-plan'))
  const warns = await dlg.locator('[data-si-warning]').evaluateAll(els => els.map(e => e.getAttribute('data-si-warning')))
  check('computer: warnings: permit not issued, no 811 ticket, deposit not paid, materials not ordered', ['permit', 'locates', 'deposit', 'materials'].every(k => warns.includes(k)), warns.join(','))
  await dlg.locator('[data-si-start]').fill('2027-11-25'); await sleep(300)
  const hol = await dlg.locator('[data-si-warning="holiday"]').allInnerTexts()
  check('computer: a holiday is warned (Thanksgiving), still allowed', hol.some(t => /Thanksgiving/.test(t)) && /Schedule anyway/.test(await dlg.locator('[data-si-save]').innerText()), hol.join(' | '))
  await dlg.locator('[data-si-start]').fill(START); await sleep(300)
  await shot(p, 'computer-schedule-install-window')
  await dlg.locator('[data-si-save]').click()
  await p.waitForSelector(`[data-install-done="${W.a.jobId}"]`, { timeout: 20000 })
  const body = (await p.locator('[data-install-text-body]').innerText()).trim()
  check('computer: the confirmation text is prepared word for word', body === textOf(W.a.first, planA[0], 'scheduled'), body)
  check('computer: the summary says what happened with Google Calendar', /Google Calendar/.test(await p.locator('[data-install-summary]').innerText()), await p.locator('[data-install-summary]').innerText())
  const href = await p.locator('[data-install-text-open]').getAttribute('href')
  check('computer: the text only opens on this phone (sms: link)', href === `sms:${W.a.phone}?body=${encodeURIComponent(body)}`)
  await p.locator('[data-install-text-skip]').click(); await sleep(800)
  check('computer: no text was sent', desk.sends.length === 0 && (await p.evaluate(() => window.__sms.length)) === 0, desk.sends.join(' | '))
  const jobA = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data
  check('computer: A is Scheduled, start, end, crew, crew days', jobA?.opsStage === 'scheduled' && jobA?.scheduledDate === planA[0] && jobA?.scheduledEndDate === planA[1] && jobA?.crewAssigned === crews[0].name, JSON.stringify(jobA && [jobA.opsStage, jobA.scheduledDate, jobA.scheduledEndDate, jobA.crewAssigned]))
  await until(async () => (await p.locator(`[data-install-entry="${W.a.jobId}"]`).count()) === daysA)
  await shot(p, 'computer-scheduled-on-calendar')
  await fitCheck(p, 'computer 1440')
  await cardsReadable(p, W.a.jobId, daysA, 'computer 1440')
  await p.setViewportSize({ width: 1280, height: 900 }); await sleep(500)
  await fitCheck(p, 'computer 1280')
  await cardsReadable(p, W.a.jobId, daysA, 'computer 1280')
  // While dragging over a day (the "Drop here" line shows), still no sideways scroll.
  await p.locator(`td[data-day="${planA[1]}"]`).dispatchEvent('dragenter')
  await fitCheck(p, 'computer 1280 while dragging')
  await p.locator(`td[data-day="${planA[1]}"]`).dispatchEvent('dragleave')
  await shot(p, 'computer-1280-fits')
  await p.setViewportSize({ width: 1440, height: 950 })

  // ── 3. Phone: B, a double booking warned ──
  const ph = await browserPage('phone')
  const q = ph.page
  await q.goto(`${APP}/`)
  await q.waitForSelector('[data-tabbar]', { timeout: 60000 })
  await q.locator('[data-tabbar] button', { hasText: 'Schedule' }).click()
  await q.waitForSelector('[data-schedule-tabs]', { timeout: 20000 })
  await q.locator('[data-schedule-tab="ready"]').click()
  const pcard = q.locator(`[data-ready-job="${W.b.jobId}"]`)
  await pcard.waitFor({ timeout: 20000 })
  check('phone: the Ready list says to tap (not drag)', /Tap a job/.test(await q.locator('[data-ready-panel]').innerText()))
  await pcard.tap()
  const pd = q.locator(`[data-schedule-install="${W.b.jobId}"]`)
  await pd.locator('[data-si-save]').waitFor({ timeout: 15000 })
  await pd.locator('[data-si-start]').fill(planA[1]); await sleep(400)
  const dbl = await pd.locator('[data-si-warning="crew"]').allInnerTexts()
  check(`phone: ${short(planA[1])} warns that ${crews[0].name} already has A that day (still allowed)`, dbl.some(t => t.includes(nameOf(W.a)) && t.includes(short(planA[1]))) && /Schedule anyway/.test(await pd.locator('[data-si-save]').innerText()), dbl.join(' | '))
  await shot(q, 'phone-double-booking-warned')
  const START_B = '2027-03-11'
  await pd.locator('[data-si-start]').fill(START_B); await sleep(400)
  const daysB = Number(await pd.locator('[data-si-days]').innerText())
  const planB = fill(START_B, daysB, week)
  const pwarn = await pd.locator('[data-si-warning]').evaluateAll(els => els.map(e => e.getAttribute('data-si-warning')))
  check('phone: another day: only the deposit is not ready (no double booking)', pwarn.join(',') === 'deposit', pwarn.join(','))
  check('phone: the window fits the screen', await q.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await pd.locator('[data-si-save]').tap()
  await q.waitForSelector(`[data-install-done="${W.b.jobId}"]`, { timeout: 20000 })
  const blocked = await q.locator('[data-install-text-blocked]').innerText()
  check('phone: B has no yes to texts: no text button, and how to tell them anyway (call)', (await q.locator('[data-install-text-open]').count()) === 0 && /has not agreed to texts/.test(blocked) && /call them/i.test(blocked) && (await q.locator('[data-install-text-call]').getAttribute('href')) === `tel:${W.b.phone}`, blocked)
  await shot(q, 'phone-text-not-allowed-call-instead')
  await q.locator('[data-install-text-skip]').tap(); await sleep(500)

  // ── 4. Packet, Dispatch, portal, pipeline, Operations ──
  const pk = await call('POST', '/api/install-packets', { jobId: W.a.jobId, snapshot: { style: "WV-ND 6'x8' Privacy", sections: 36, footageFt: 280 } })
  packetId = pk.json.data?.id || null
  const packetHtml = pk.json.data?.token ? await (await fetch(`${APP}/p/i/${pk.json.data.token}`)).text() : ''
  const want = `2 crew days: ${planA.map(short).join(', ')}`
  check(`the crew packet lists the crew days ("${want}")`, packetHtml.includes(want) && packetHtml.includes(`Crew: ${crews[0].name}`), (packetHtml.match(/Install: [^<]*/) || [''])[0])

  await p.goto(`${APP}/dispatch`)
  await p.waitForSelector('[data-dispatch-date]', { timeout: 30000 })
  for (const d of planA) {
    await p.locator('[data-dispatch-date]').fill(d)
    const ok = await until(async () => (await p.locator(`[data-dispatch-block="${W.a.jobId}"]`).count()) > 0, 15000)
    check(`Dispatch: the date picker goes to ${d}, the job is there`, !!ok)
  }
  await shot(p, 'computer-dispatch-date-picker')

  const inv = await call('POST', '/api/portal/invite', { crmCustomerId: W.a.contactId, email: `e2e-sched-${stamp}-dana@example.invalid`, firstName: W.a.first, lastName: W.a.last })
  const raw = ((inv.json.data?.activationUrl || '').match(/token=([0-9a-f]{64})/) || [])[1]
  let cp = null
  if (raw) {
    const cb = await chromium.launch(); browsers.push(cb)
    cp = await (await cb.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
    await cp.goto(`${APP}/#/portal/activate?token=${raw}`)
    await cp.waitForSelector('input[type="password"]', { timeout: 60000 })
    const pw = cp.locator('input[type="password"]')
    await pw.nth(0).fill('e2e-sched-pass-1'); await pw.nth(1).fill('e2e-sched-pass-1')
    await cp.locator('form button[type="submit"]').click()
    await cp.waitForFunction(() => location.hash.startsWith('#/portal/dashboard'), null, { timeout: 30000 })
    await cp.goto(`${APP}/#/portal/projects`)
    await until(async () => (await cp.locator(`[data-portal-install-date="${planA[0]}"]`).count()) > 0, 20000)
    const steps = await cp.locator('[data-portal-step]').evaluateAll(els => els.map(e => [e.getAttribute('data-portal-step'), e.getAttribute('data-done')]))
    const done = Object.fromEntries(steps)
    check('portal: the install start shows', /Install starts/.test(await cp.locator(`[data-portal-install-date="${planA[0]}"]`).first().innerText()))
    check('portal: only the steps really done are ticked (no 811, permit or materials yet; installation scheduled)', done['Locates Marked (811)'] === 'no' && done['Permit Approved'] === 'no' && done['Materials Ordered'] === 'no' && done['Installation Scheduled'] === 'yes' && done['Quote Accepted'] === 'yes', JSON.stringify(steps))
    await shot(cp, 'portal-my-projects-real-steps')
  } else check('the customer portal invite', false, JSON.stringify(inv.json).slice(0, 200))

  await p.goto(`${APP}/pipeline`)
  const face = await until(async () => (await p.locator(`[data-card-install="${planA[0]}"]`).count()) > 0, 30000)
  check(`pipeline: the card face shows "Install ${short(planA[0])}"`, !!face && (await p.locator(`[data-card-install="${planA[0]}"]`).first().innerText()).includes(`Install ${short(planA[0])}`))
  await shot(p, 'computer-pipeline-card-install-date')
  await p.goto(`${APP}/pipeline?card=${W.a.cardId}`)
  const cw = await until(async () => (await p.locator(`[data-card-install-job="${W.a.jobId}"]`).count()) > 0, 30000)
  const order = cw ? await p.evaluate(() => { const i = document.querySelector('[data-card-install]'); const pay = document.querySelector('[data-card-payments]'); return !pay || !!(i && (i.compareDocumentPosition(pay) & Node.DOCUMENT_POSITION_FOLLOWING)) }) : false
  check('pipeline card window: Install section (Move install), above Payments', !!cw && order && (await p.locator(`[data-card-install-job="${W.a.jobId}"] [data-schedule-install-button]`).innerText()).includes('Move install'))

  await p.goto(`${APP}/operations`)
  const opsDate = await until(async () => { const el = p.locator(`[data-ops-card-date="${planA[0]}"]`); return (await el.count()) ? el.first().innerText() : null }, 30000)
  check('Operations card: the dates in words ("Thu, Mar 4 to Fri, Mar 5")', !!opsDate && opsDate.includes('Thu, Mar 4 to Fri, Mar 5'), opsDate || '')
  const crewOpts = await p.locator('select:has(option:text-is("All crews")) option, select option').allInnerTexts().catch(() => [])
  const norm = s => s.toLowerCase().replace(/\s+/g, '')
  const crewish = crewOpts.filter(o => /crew/i.test(o))
  check('Operations crew filter: one entry per crew (no "Crew 1" and "crew1")', new Set(crewish.map(norm)).size === crewish.length, crewish.join(' | '))

  // ── 5. Friday switched off ──
  setWorkDays([1, 2, 3, 4]); week = [1, 2, 3, 4]
  const d2 = await browserPage('desk')
  const p2 = d2.page
  await p2.goto(`${APP}/schedule`)
  await p2.waitForSelector('[data-month-next]', { timeout: 60000 })
  for (let i = 0; i < 12 && (await p2.locator('[data-month]').getAttribute('data-month')) !== '2027-03'; i++) { await p2.locator('[data-month-next]').click(); await sleep(150) }
  const friCard = p2.locator(`td[data-day="${planA[1]}"] [data-install-entry="${W.a.jobId}"]`)
  const seen = await until(async () => (await friCard.count()) === 1, 15000)
  check('Friday off: A\'s Friday still shows (not hidden), warned "Friday is not a work day any more"', !!seen && (await friCard.getAttribute('data-install-offday')) === 'yes' && /Friday is not a work day any more/.test(await friCard.innerText()))
  await shot(p2, 'friday-off-warned')
  await friCard.click()
  const md = p2.locator(`[data-schedule-install="${W.a.jobId}"]`)
  await md.locator('[data-si-save]').waitFor({ timeout: 15000 })
  const weekendTicked = await md.locator('[data-si-weekends]').isChecked()
  const newPlan = fill(planA[0], 2, week)
  check(`Friday off: Move install does not tick weekends, warns about the Friday, and plans ${newPlan.join(', ')}`, !weekendTicked && (await md.locator('[data-si-offdays]').getAttribute('data-si-offdays')) === planA[1] && (await md.locator('[data-si-plan]').getAttribute('data-si-plan')) === newPlan.join(','), `${weekendTicked} ${await md.locator('[data-si-plan]').getAttribute('data-si-plan')}`)
  await shot(p2, 'friday-off-move-window')
  await md.locator('[data-si-save]').click()
  await p2.waitForSelector(`[data-install-done="${W.a.jobId}"]`, { timeout: 20000 })
  await p2.locator('[data-install-text-skip]').click()
  const afterFri = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data
  check('Friday off: moved onto crew days (Thu, Mon), no weekend', afterFri?.scheduledDate === newPlan[0] && afterFri?.scheduledEndDate === newPlan[1], JSON.stringify(afterFri && [afterFri.scheduledDate, afterFri.scheduledEndDate]))

  // ── 6. Reschedule by drag ──
  const firstEntry = p2.locator(`td[data-day="${newPlan[0]}"] [data-install-entry="${W.a.jobId}"]`)
  await firstEntry.waitFor({ timeout: 20000 })
  const MOVE_TO = '2027-03-16' // a Tuesday
  await firstEntry.dragTo(p2.locator(`td[data-day="${MOVE_TO}"]`))
  await p2.waitForSelector(`[data-move-install="${W.a.jobId}"]`, { timeout: 10000 })
  check('reschedule by drag: it asks first', /text the customer/i.test(await p2.locator(`[data-move-install="${W.a.jobId}"]`).innerText()))
  await p2.locator('[data-move-install-yes]').click()
  await p2.waitForSelector(`[data-install-done="${W.a.jobId}"]`, { timeout: 20000 })
  const mbody = (await p2.locator('[data-install-text-body]').innerText()).trim()
  check('reschedule: the "moved" text is prepared, not sent', mbody === textOf(W.a.first, MOVE_TO, 'moved') && d2.sends.length === 0, mbody)
  await p2.locator('[data-install-text-skip]').click()
  const movedPlan = fill(MOVE_TO, 2, week)

  // ── 6b. Two installs on one crew the same day: marked on the month ──
  const clashB = await call('POST', '/api/schedule/install', { jobId: W.b.jobId, start: movedPlan[0], crew: crews[0].id })
  check(`B moved onto ${movedPlan[0]}, the day A starts on the same crew (allowed)`, clashB.status === 200, JSON.stringify(clashB.json).slice(0, 160))
  for (const [w, label] of [[1440, 'computer 1440'], [1280, 'computer 1280']]) {
    await p2.setViewportSize({ width: w, height: 900 })
    await p2.reload(); await p2.waitForSelector('[data-month-next]', { timeout: 60000 })
    for (let i = 0; i < 12 && (await p2.locator('[data-month]').getAttribute('data-month')) !== '2027-03'; i++) { await p2.locator('[data-month-next]').click(); await sleep(150) }
    const chip = p2.locator(`[data-day-clash="${movedPlan[0]}|${crews[0].id}"]`)
    await until(async () => (await chip.count()) === 1, 15000)
    const both = await p2.locator(`td[data-day="${movedPlan[0]}"] [data-install-clash="yes"]`).count()
    check(`${label}: ${short(movedPlan[0])} says "2 jobs on ${crews[0].name}" and both cards are edged red`, (await chip.innerText()).includes(`2 jobs on ${crews[0].name}`) && both === 2, `${await chip.innerText().catch(() => '')} ${both}`)
    await fitCheck(p2, `${label} with two jobs on a day`)
    await cardsReadable(p2, W.a.jobId, 2, `${label} with two jobs on a day`)
    await shot(p2, `two-jobs-one-crew-${w}`)
  }
  await p2.setViewportSize({ width: 1440, height: 950 })
  {
    const q3 = await ph.ctx.newPage()
    await q3.goto(`${APP}/schedule`); await q3.waitForSelector('[data-month-next]', { timeout: 60000 })
    for (let i = 0; i < 12 && (await q3.locator('[data-month]').getAttribute('data-month')) !== '2027-03'; i++) { await q3.locator('[data-month-next]').tap(); await sleep(150) }
    const pchip = q3.locator(`[data-day-clash="${movedPlan[0]}|${crews[0].id}"]`)
    const ok = await until(async () => (await pchip.count()) === 1, 15000)
    check('phone: the month marks the day with two jobs on one crew, the cards readable', !!ok && (await q3.locator(`td[data-day="${movedPlan[0]}"] [data-install-clash="yes"]`).count()) === 2 && await q3.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await cardsReadable(q3, W.a.jobId, 2, 'phone')
    await shot(q3, 'phone-two-jobs-one-crew')
    await q3.close()
  }

  // ── 7. Rain day ──
  // From A's first day: A and B (both on that day) move one crew day, and A's first day lands on B's: warned.
  const RAIN = movedPlan[0]
  const pv = (await call('POST', '/api/schedule/rain-day/preview', { date: RAIN, shift: 1 })).json.data || []
  const onlyMine = pv.length > 0 && pv.every(m => /E2E (Sched|Phone)/.test(m.customerName))
  check(`rain day ${RAIN}: the preview (API) lists only this test's installs`, onlyMine, pv.map(m => m.customerName).join(', '))
  if (onlyMine) {
    await p2.locator('[data-rain-day-open]').click()
    const rd = p2.locator('[data-rain-day]')
    await rd.waitFor()
    check('rain day: nothing listed until the day is picked; the button waits for it', (await rd.locator('[data-rain-pick]').count()) === 1 && (await rd.locator('[data-rain-move]').count()) === 0 && await rd.locator('[data-rain-apply]').isDisabled())
    await rd.locator('[data-rain-date]').fill(RAIN)
    await until(async () => (await rd.locator('[data-rain-move]').count()) === pv.length)
    const clashText = await rd.locator('[data-rain-clash]').allInnerTexts()
    const nextDay = fill(plus(RAIN, 1), 1, week)[0]
    check(`rain day: the preview warns "${nameOf(W.a)} and ${nameOf(W.b)} would both be on ${crews[0].name}, ${short(nextDay)}"`, clashText.some(t => t.includes(nameOf(W.a)) && t.includes(nameOf(W.b)) && t.includes(`would both be on ${crews[0].name}, ${short(nextDay)}`)), clashText.join(' | '))
    await rd.locator('[data-rain-apply]').click()
    check('rain day: it asks to confirm the list before moving', await rd.locator('[data-rain-confirm]').isVisible())
    await shot(p2, 'rain-day-confirm')
    await rd.locator('[data-rain-confirm]').click()
    await p2.waitForSelector('[data-rain-day="done"]', { timeout: 20000 })
    const after = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data
    check(`rain day: ${RAIN} moved one crew day`, after?.scheduledDate === fill(plus(RAIN, 1), 1, week)[0] && after?.scheduledEndDate === fill(plus(movedPlan[1], 1), 1, week)[0], JSON.stringify(after && [after.scheduledDate, after.scheduledEndDate]))
    await p2.locator('[data-rain-close]').click()
  }

  // ── 8. Take off the schedule ──
  const entry = p2.locator(`[data-install-entry="${W.a.jobId}"]`).first()
  await entry.waitFor({ timeout: 15000 })
  await entry.click()
  const od = p2.locator(`[data-schedule-install="${W.a.jobId}"]`)
  await od.locator('[data-si-off]').click()
  await od.locator('[data-si-off-yes]').click()
  await p2.waitForSelector(`[data-install-done="${W.a.jobId}"]`, { timeout: 20000 })
  const obody = (await p2.locator('[data-install-text-body]').innerText()).trim()
  const osum = await p2.locator('[data-install-summary]').innerText()
  check('take off: the "date is being changed" text is prepared (not sent), the summary names the stage it went back to', obody === textOf(W.a.first, '', 'off') && /Awaiting Locates/.test(osum) && d2.sends.length === 0, `${obody} | ${osum}`)
  await shot(p2, 'take-off-text')
  await p2.locator('[data-install-text-skip]').click()
  const offA = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data
  check(`take off: back in its own stage (${stageA0}), crew and dates cleared, its estimate (5) kept`, offA?.opsStage === stageA0 && offA?.scheduledDate === '' && offA?.crewAssigned === '' && offA?.estimatedDays === 5, JSON.stringify(offA && [offA.opsStage, offA.scheduledDate, offA.crewAssigned, offA.estimatedDays]))
  if (cp) {
    await cp.goto(`${APP}/#/portal/dashboard`); await cp.goto(`${APP}/#/portal/projects`)
    const tbs = await until(async () => { const el = cp.locator(`[data-portal-project="${W.a.jobId}"] [data-portal-install-date=""]`); return (await el.count()) ? el.innerText() : null }, 20000)
    check('portal: after take off it says "Install date: To be set"', !!tbs && /To be set/i.test(tbs), tbs || '')
  }

  // ── 9. A holiday on the month ──
  for (let i = 0; i < 12 && (await p2.locator('[data-month]').getAttribute('data-month')) !== '2027-05'; i++) { await p2.locator('[data-month-next]').click(); await sleep(150) }
  check('the month shows a holiday (Memorial Day, Mon 5/31/2027)', /Memorial Day/.test(await p2.locator('[data-holiday="2027-05-31"]').innerText().catch(() => '')))

  check('no page errors', desk.errors.length === 0 && ph.errors.length === 0 && d2.errors.length === 0, [...desk.errors, ...ph.errors, ...d2.errors].slice(0, 3).join(' | '))
} catch (e) {
  check('test ran to the end', false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  try {
    for (const x of [W.a, W.b]) if (x.jobId) await call('POST', `/api/schedule/install/${x.jobId}/off`, {})
    const jobs = [W.a.jobId, W.b.jobId].filter(Boolean).map(lit).join(',') || "'-'"
    const quotes = [W.a.quoteId, W.b.quoteId].map(lit).join(',')
    const contacts = [W.a.contactId, W.b.contactId].map(lit).join(',')
    const entries = `SELECT id FROM "ScheduledGridJob" WHERE "stagingJobId" IN (${jobs})`
    sql(`BEGIN;
      DELETE FROM "ScheduleRainDay" WHERE "jobId" IN (${entries}) OR "clientName" LIKE ${lit(`%E2E % ${stamp}`)};
      DELETE FROM "DeletionLog" WHERE "entityType" = 'schedule_entry' AND "entityId" IN (${entries});
      DELETE FROM "ScheduledGridJob" WHERE "stagingJobId" IN (${jobs});
      DELETE FROM "AccountKeyValue" WHERE key IN (${[W.a.jobId, W.b.jobId].filter(Boolean).map(id => lit(`install:${id}`)).join(',') || "'-'"});
      DELETE FROM "InstallPacket" WHERE "jobId" IN (${jobs});
      DELETE FROM "Permit" WHERE "jobId" IN (${jobs});
      DELETE FROM "CrmAuditLog" WHERE "entityId" IN (${jobs}, ${quotes}, ${contacts});
      DELETE FROM "JobQuotedCost" WHERE "quoteId" IN (${quotes});
      DELETE FROM "AutomationEvent" WHERE "entityId" IN (${jobs}, ${quotes}, ${contacts}, ${lit(W.a.cardId)}, ${lit(W.b.cardId)});
      DELETE FROM "JobChecklistItem" WHERE "jobId" IN (${jobs});
      DELETE FROM "SavedJob" WHERE id IN (${jobs});
      DELETE FROM "SavedQuote" WHERE id IN (${quotes});
      DELETE FROM "PortalSession" WHERE "portalAccountId" IN (SELECT id FROM "PortalAccount" WHERE "crmCustomerId" IN (${contacts}));
      DELETE FROM "PortalAccount" WHERE "crmCustomerId" IN (${contacts});
      DELETE FROM "Notification" WHERE body LIKE ${lit(`%e2e-sched-${stamp}%`)};
      DELETE FROM "CrmTextConsent" WHERE "crmContactId" IN (${contacts});
      COMMIT;`)
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => [W.a.contactId, W.b.contactId].includes(l.customerId) || [W.a.cardId, W.b.cardId].includes(l.id)).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    for (const x of [W.a, W.b]) await call('DELETE', `/api/crm-contacts/${x.contactId}`)
    sql(`DELETE FROM "DeletionLog" WHERE "entityId" IN (${contacts}); DELETE FROM "CrmContact" WHERE id IN (${contacts})`)
    // Schedule Settings exactly as they were.
    sql(`UPDATE "ScheduleSettings" SET "workDays" = ${lit(settingsBefore)}::jsonb, version = version + 1, "updatedAt" = now() WHERE "accountId" = ${lit(ACCOUNT)}`)
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedJob" WHERE id IN (${jobs})) + (SELECT count(*) FROM "ScheduledGridJob" WHERE "stagingJobId" IN (${jobs})) + (SELECT count(*) FROM "CrmContact" WHERE id IN (${contacts})) + (SELECT count(*) FROM "SavedQuote" WHERE id IN (${quotes}))`))
    const back = sql(`SELECT "workDays"::text FROM "ScheduleSettings" WHERE "accountId" = ${lit(ACCOUNT)}`) === settingsBefore
    check('cleaned up, and Schedule Settings back exactly as they were', left === 0 && back, `${left} left; settings ${back ? 'same' : 'DIFFERENT'}`)
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 300)) }
  void packetId
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
