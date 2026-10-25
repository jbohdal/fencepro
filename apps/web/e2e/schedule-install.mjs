// Scheduling an install, the way the office does it (Schedule > Ready to
// schedule, ScheduleInstall.tsx; server lib/installScheduling.ts):
//
//   1. Two realistic sold jobs (customer with a yes to texts, a quote marked
//      Sold, its job): they are in Ready to schedule with customer, address,
//      style, footage, crew days from the quote, permit, 811, deposit and
//      materials, and the warnings (permit not issued, no 811 ticket, deposit
//      not paid, materials not ordered).
//   2. Computer: the Schedule tab, March 2027; drag the first job onto a
//      Thursday. Schedule install opens on that day with the crew days it
//      fills (crew days only: never Saturday or Sunday), the warnings, and
//      "Schedule anyway". Booked: the stage is Scheduled, one Schedule entry
//      per crew day ("day 1 of 3"), the days off hidden (a toggle shows them).
//      The confirmation text is prepared word for word, with the company
//      phone, and only opens on this phone (an sms: link): nothing is sent.
//   3. Phone (WebKit, iPhone size): the Schedule tab, Ready to schedule tab,
//      tap the second job, pick a start day and crew, schedule it.
//   4. The job's date shows on the crew packet, Dispatch (every crew day), the
//      customer portal (My Projects) and the job page (Move install button);
//      the pipeline card window has the Install section.
//   5. Computer: drag the first job's first day to another day: it asks, then
//      moves every crew day, and offers the "moved" text (not sent).
//   6. Rain day: the preview lists what moves (one crew day later, from that
//      day on) and the prepared text for a moved start; then it is applied.
//   7. Everything made is removed.
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

// Crew days the way the app counts them (lib/installDays.ts): Settings' days, Monday to Friday only.
const dow = d => new Date(`${d}T12:00:00Z`).getUTCDay()
const plus = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const crewWeek = s => { const w = [...new Set((s || []).filter(n => n >= 1 && n <= 5))].sort(); return w.length ? w : [1, 2, 3, 4] }
const fill = (start, n, week) => { const out = []; let d = start; while (!week.includes(dow(d))) d = plus(d, 1); out.push(d); while (out.length < n) { d = plus(d, 1); if (week.includes(dow(d))) out.push(d) } return out }
const us = d => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`

const stamp = Date.now().toString(36).slice(-6)
const ADDR1 = '4411 SE 31st St, Ocala, FL 34480', ADDR2 = '9020 SW 103rd Ln, Ocala, FL 34481'
const W = {
  a: { contactId: crypto.randomUUID(), cardId: crypto.randomUUID(), quoteId: crypto.randomUUID(), first: 'Dana', last: `E2E Sched ${stamp}`, phone: '3525550161', addr: ADDR1, runs: [150, 130], walk: 1, jobId: '' },
  b: { contactId: crypto.randomUUID(), cardId: crypto.randomUUID(), quoteId: crypto.randomUUID(), first: 'Ray', last: `E2E Phone ${stamp}`, phone: '3525550162', addr: ADDR2, runs: [96], walk: 0, jobId: '' },
}
const nameOf = x => `${x.first} ${x.last}`
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const smsSeen = []
const browsers = []

async function makeSoldJob(x, extra = {}) {
  const sections = x.runs.reduce((s, ft) => s + Math.ceil(ft / 8), 0)
  const feet = x.runs.reduce((s, f) => s + f, 0)
  const price = Math.round(feet * 38.5 * 100) / 100
  const c = await call('POST', '/api/crm-contacts', { id: x.contactId, firstName: x.first, lastName: x.last, phone: x.phone, email: `e2e-sched-${stamp}-${x.first.toLowerCase()}@example.invalid`, serviceAddress: x.addr, leadSource: 'Other',
    lead: { id: x.cardId, customerId: x.contactId, firstName: x.first, lastName: x.last, phone: x.phone, address: x.addr, stage: 'Signed Contract', leadSource: 'Other', quoteId: x.quoteId, createdAt: today, lastMoved: today }, leadBefore: null })
  const consent = await call('POST', `/api/crm-contacts/${x.contactId}/text-consent`, { consent: 'yes' })
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

async function browserPage(kind) {
  const phone = kind === 'phone'
  const br = phone ? await webkit.launch() : await chromium.launch()
  browsers.push(br)
  const ctx = await br.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 950 } })
  await signInByCookie(ctx, { api: API })
  // A text hands off to the phone's own texting app: the link is recorded, nothing leaves.
  await ctx.addInitScript(() => {
    window.__sms = []
    window.addEventListener('click', e => { const a = e.target instanceof Element ? e.target.closest('a[href^="sms:"]') : null; if (a) { window.__sms.push(a.getAttribute('href')); e.preventDefault() } }, true)
  })
  const page = await ctx.newPage()
  const errors = [], sends = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  // Anything that would text or email a customer from the server (none should happen).
  page.on('request', r => { if (/\/(sms|send-sms|twilio|messages\/send|outbound)/i.test(r.url()) && r.method() !== 'GET') sends.push(`${r.method()} ${r.url()}`) })
  return { br, ctx, page, errors, sends, phone }
}

const expectedText = (first, start, kind) => kind === 'scheduled'
  ? `Getter Done Fence: Hi ${first}, your fence installation is scheduled to start on ${us(start)}. Our crew will arrive in the morning. Questions? Call (352) 789 4314. Reply STOP to opt out.`
  : `Getter Done Fence: Hi ${first}, your fence installation has moved and is now scheduled to start on ${us(start)}. Our crew will arrive in the morning. Questions? Call (352) 789 4314. Reply STOP to opt out.`

let packetId = null
try {
  // ── 1. Two sold jobs ──
  const okA = await makeSoldJob(W.a)
  const okB = await makeSoldJob(W.b, { materialsStatus: 'ordered', locatesDate: '2027-03-01', locatesExpDate: '2027-03-31' })
  if (W.b.jobId) sql(`INSERT INTO "Permit" (id, "accountId", "jobId", status, "approvedAt", "updatedAt") SELECT ${lit(crypto.randomUUID())}, "accountId", id, 'approved', '2027-02-20', now() FROM "SavedJob" WHERE id = ${lit(W.b.jobId)}`)
  check('setup: two customers (yes to texts), quotes marked Sold, their jobs', okA && okB, `${W.a.jobId} ${W.b.jobId}`)
  const settings = (await call('GET', '/api/schedule/settings')).json.data
  const week = crewWeek(settings.workDays)
  const crews = settings.crews
  check(`crew days from Settings: ${week.map(d => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(' ')} (never Sat or Sun)`, !week.includes(0) && !week.includes(6) && crews.length > 0)

  const ready = (await call('GET', '/api/schedule/ready')).json.data || []
  const ra = ready.find(r => r.id === W.a.jobId), rb = ready.find(r => r.id === W.b.jobId)
  check('Ready to schedule (API): both jobs, with footage, sections and crew days from the quote', !!ra && !!rb && ra.footage === 280 && ra.sections === 36 && ra.crewDays >= 1 && ra.crewDaysFrom === 'quote', JSON.stringify(ra && { footage: ra.footage, sections: ra.sections, crewDays: ra.crewDays, from: ra.crewDaysFrom }))
  const daysA = ra?.crewDays || 1

  // ── 2. Computer: Schedule, drag onto a Thursday ──
  const desk = await browserPage('desk')
  const p = desk.page
  await p.goto(`${APP}/schedule`)
  await p.waitForSelector('[data-ready-panel]', { timeout: 60000 })
  const card = p.locator(`[data-ready-job="${W.a.jobId}"]`)
  await card.waitFor({ timeout: 20000 })
  const cardText = (await card.innerText()).replace(/\s+/g, ' ')
  check('computer: the job is in Ready to schedule (side panel) with customer, address, style, footage, sections, crew days', cardText.includes(nameOf(W.a)) && cardText.includes(ADDR1) && /White Vinyl/i.test(cardText) && cardText.includes('280 ft') && cardText.includes('36 sections') && cardText.includes(`${daysA} crew day`), cardText.slice(0, 220))
  const chips = await card.locator('[data-ready-chip]').evaluateAll(els => els.map(e => [e.getAttribute('data-ready-chip'), e.getAttribute('data-tone'), e.textContent]))
  check('computer: permit, 811, deposit and materials shown, the not ready ones marked', chips.length === 4 && chips.every(c => c[1] !== 'ok'), JSON.stringify(chips))
  const cardB = (await p.locator(`[data-ready-job="${W.b.jobId}"]`).innerText()).replace(/\s+/g, ' ')
  check('computer: the second job shows its permit issued, 811 good and materials ordered', /Permit: Issued/.test(cardB) && /811: Good to 03\/31\/2027/.test(cardB) && /Materials: ordered/.test(cardB), cardB.slice(0, 260))
  await shot(p, 'computer-ready-to-schedule')

  for (let i = 0; i < 12 && (await p.locator('[data-month]').getAttribute('data-month')) !== '2027-03'; i++) { await p.locator('[data-month-next]').click(); await sleep(150) }
  const headers = await p.locator('table.calendar-table thead th').allInnerTexts()
  check('computer: the month shows crew days only (no Saturday or Sunday)', headers.length === week.length && !headers.some(h => /^(Sat|Sun)/.test(h.trim())), headers.join('|'))
  await p.locator('[data-show-days-off]').check(); await sleep(200)
  const allHeaders = await p.locator('table.calendar-table thead th').allInnerTexts()
  check('computer: "Show days off" shows all seven days, the days off marked', allHeaders.length === 7 && allHeaders.filter(h => /day off/.test(h)).length === 7 - week.length, allHeaders.join('|'))
  await p.locator('[data-show-days-off]').uncheck(); await sleep(200)

  const START = '2027-03-04' // a Thursday
  await card.dragTo(p.locator(`td[data-day="${START}"]`))
  await p.waitForSelector(`[data-schedule-install="${W.a.jobId}"] [data-si-save]`, { timeout: 15000 })
  const dlg = p.locator(`[data-schedule-install="${W.a.jobId}"]`)
  const planA = fill(START, daysA, week)
  check('computer: drag onto Thursday opens Schedule install on that day', (await dlg.locator('[data-si-start]').inputValue()) === START)
  check(`computer: it fills ${daysA} crew day(s) on crew days only: ${planA.join(', ')}`, (await dlg.getAttribute('data-schedule-install')) === W.a.jobId && (await dlg.locator('[data-si-plan]').getAttribute('data-si-plan')) === planA.join(','), await dlg.locator('[data-si-plan]').getAttribute('data-si-plan'))
  const warns = await dlg.locator('[data-si-warning]').evaluateAll(els => els.map(e => e.getAttribute('data-si-warning')))
  check('computer: warnings: permit not issued, no 811 ticket, deposit not paid, materials not ordered', ['permit', 'locates', 'deposit', 'materials'].every(k => warns.includes(k)), warns.join(','))
  check('computer: still allowed: "Schedule anyway"', /Schedule anyway/.test(await dlg.locator('[data-si-save]').innerText()))
  await shot(p, 'computer-schedule-install-window')
  await dlg.locator('[data-si-save]').click()
  await p.waitForSelector(`[data-install-done="${W.a.jobId}"]`, { timeout: 20000 })
  const body = (await p.locator('[data-install-text-body]').innerText()).trim()
  check('computer: the confirmation text is prepared word for word, with the company phone', body === expectedText(W.a.first, planA[0], 'scheduled'), body)
  const href = await p.locator('[data-install-text-open]').getAttribute('href')
  check('computer: it only opens on this phone (sms: link to the customer), with the same words', href === `sms:${W.a.phone}?body=${encodeURIComponent(body)}`, href?.slice(0, 80))
  await shot(p, 'computer-text-ready')
  await p.locator('[data-install-text-skip]').click(); await sleep(800)
  check('computer: no text was sent (no SMS request, the link was not opened)', desk.sends.length === 0 && (await p.evaluate(() => window.__sms.length)) === 0, desk.sends.join(' | '))

  const jobA = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data
  check('computer: the job is in Scheduled, with its start, end, crew and crew days', jobA?.opsStage === 'scheduled' && jobA?.status === 'scheduled' && jobA?.scheduledDate === planA[0] && jobA?.scheduledEndDate === planA[planA.length - 1] && jobA?.estimatedDays === daysA && jobA?.crewAssigned === crews[0].name, JSON.stringify(jobA && { opsStage: jobA.opsStage, status: jobA.status, start: jobA.scheduledDate, end: jobA.scheduledEndDate, days: jobA.estimatedDays, crew: jobA.crewAssigned }))
  await until(async () => (await p.locator(`[data-install-entry="${W.a.jobId}"]`).count()) === daysA)
  const entries = await p.locator(`[data-install-entry="${W.a.jobId}"]`).evaluateAll(els => els.map(e => [e.closest('td')?.getAttribute('data-day'), e.getAttribute('data-install-day'), e.textContent]))
  check(`computer: each crew day shows the job card (customer, address, sections, style, day n of ${daysA})`, entries.length === daysA && entries.every((e, i) => e[0] === planA[i] && e[1] === `${i + 1}/${daysA}` && e[2].includes(nameOf(W.a)) && e[2].includes(ADDR1) && e[2].includes('36 sec')), JSON.stringify(entries).slice(0, 300))
  check('computer: it left Ready to schedule', (await until(async () => (await p.locator(`[data-ready-job="${W.a.jobId}"]`).count()) === 0)) === true)
  await shot(p, 'computer-scheduled-on-calendar')

  // ── 3. Phone: tap → start day + crew ──
  const ph = await browserPage('phone')
  const q = ph.page
  await q.goto(`${APP}/`)
  await q.waitForSelector('[data-tabbar]', { timeout: 60000 })
  await q.locator('[data-tabbar] button', { hasText: 'Schedule' }).click()
  await q.waitForSelector('[data-schedule-tabs]', { timeout: 20000 })
  await q.locator('[data-schedule-tab="ready"]').click()
  const pcard = q.locator(`[data-ready-job="${W.b.jobId}"]`)
  await pcard.waitFor({ timeout: 20000 })
  await shot(q, 'phone-ready-tab')
  await pcard.tap()
  const pd = q.locator(`[data-schedule-install="${W.b.jobId}"]`)
  await pd.locator('[data-si-save]').waitFor({ timeout: 15000 })
  const START_B = '2027-03-11' // the next Thursday
  await pd.locator('[data-si-start]').fill(START_B)
  if (crews[1]) await pd.locator('[data-si-crew]').selectOption(crews[1].id)
  const crewB = crews[1] || crews[0]
  await sleep(300)
  const daysB = Number(await pd.locator('[data-si-days]').innerText())
  const planB = fill(START_B, daysB, week)
  check('phone: tap the job, pick the start day and crew: the crew days show', (await pd.locator('[data-si-plan]').getAttribute('data-si-plan')) === planB.join(','), `${await pd.locator('[data-si-plan]').getAttribute('data-si-plan')} vs ${planB}`)
  const pwarn = await pd.locator('[data-si-warning]').evaluateAll(els => els.map(e => e.getAttribute('data-si-warning')))
  check('phone: only the deposit is not ready (permit issued, 811 good, materials ordered)', pwarn.join(',') === 'deposit', pwarn.join(','))
  const fits = await q.evaluate(() => { const d = document.querySelector('[data-schedule-install]'); const r = d.getBoundingClientRect(); return r.width <= window.innerWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1 })
  check('phone: the window fits the screen (no sideways scroll)', fits)
  await shot(q, 'phone-schedule-install-window')
  await pd.locator('[data-si-save]').tap()
  await q.waitForSelector(`[data-install-done="${W.b.jobId}"]`, { timeout: 20000 })
  const pbody = (await q.locator('[data-install-text-body]').innerText()).trim()
  check('phone: the confirmation text is ready to send from the phone, not sent', pbody === expectedText(W.b.first, planB[0], 'scheduled') && (await q.locator('[data-install-text-open]').count()) === 1 && ph.sends.length === 0, pbody)
  await shot(q, 'phone-text-ready')
  await q.locator('[data-install-text-skip]').tap(); await sleep(600)
  const jobB = (await call('GET', `/api/saved-jobs/${W.b.jobId}`)).json.data
  check('phone: the job is Scheduled on its crew', jobB?.opsStage === 'scheduled' && jobB?.scheduledDate === planB[0] && jobB?.crewAssigned === crewB.name, JSON.stringify(jobB && { opsStage: jobB.opsStage, start: jobB.scheduledDate, crew: jobB.crewAssigned }))

  // The job page on the phone: one way to schedule (no raw date or crew box), Move install.
  // A new tab (WebKit can crash when a long session's page is opened over again).
  const q2 = await ph.ctx.newPage()
  q2.on('pageerror', e => ph.errors.push(String(e).slice(0, 200)))
  await q2.goto(`${APP}/operations?job=${W.b.jobId}`)
  await q2.waitForSelector('[data-job-schedule]', { timeout: 30000 })
  const js = (await q2.locator('[data-job-schedule]').innerText()).replace(/\s+/g, ' ')
  check('phone: the job page shows the install days and crew, and Move install; no raw date or crew boxes', js.includes(crewB.name) && (await q2.locator(`[data-schedule-install-button="${W.b.jobId}"]`).innerText()).includes('Move install') && (await q2.locator('[data-job-schedule] input').count()) === 0, js.slice(0, 160))
  await shot(q2, 'phone-job-page')

  // ── 4. Packet, Dispatch, portal, pipeline card ──
  const pk = await call('POST', '/api/install-packets', { jobId: W.a.jobId, snapshot: { style: "WV-ND 6'x8' Privacy", sections: 36, footageFt: 280 } })
  packetId = pk.json.data?.id || null
  const packetHtml = pk.json.data?.token ? await (await fetch(`${APP}/p/i/${pk.json.data.token}`)).text() : ''
  check('the crew packet shows the install days and crew', packetHtml.includes(`data-packet-install="${planA[0]}"`) && packetHtml.includes(daysA > 1 ? `starts ${us(planA[0])}, ${daysA} crew days to ${us(planA[planA.length - 1])}` : us(planA[0])) && packetHtml.includes(`Crew: ${crews[0].name}`), (packetHtml.match(/Install: [^<]*/) || [''])[0])

  for (const d of planA) {
    await p.goto(`${APP}/dispatch?date=${d}`)
    await p.waitForSelector('[data-dispatch-map]', { timeout: 30000 })
    const ok = await until(async () => (await p.locator(`[data-dispatch-block="${W.a.jobId}"]`).count()) > 0, 15000)
    check(`Dispatch shows the job on ${d}`, !!ok)
  }
  await shot(p, 'computer-dispatch')

  const inv = await call('POST', '/api/portal/invite', { crmCustomerId: W.a.contactId, email: `e2e-sched-${stamp}-dana@example.invalid`, firstName: W.a.first, lastName: W.a.last })
  const raw = ((inv.json.data?.activationUrl || '').match(/token=([0-9a-f]{64})/) || [])[1]
  if (raw) {
    const cust = await (await chromium.launch().then(b => { browsers.push(b); return b })).newContext({ viewport: { width: 1280, height: 900 } })
    const cp = await cust.newPage()
    await cp.goto(`${APP}/#/portal/activate?token=${raw}`)
    await cp.waitForSelector('input[type="password"]', { timeout: 60000 })
    const pw = cp.locator('input[type="password"]')
    await pw.nth(0).fill('e2e-sched-pass-1'); await pw.nth(1).fill('e2e-sched-pass-1')
    await cp.locator('form button[type="submit"]').click()
    await cp.waitForFunction(() => location.hash.startsWith('#/portal/dashboard'), null, { timeout: 30000 })
    await cp.goto(`${APP}/#/portal/projects`)
    const shown = await until(async () => (await cp.locator(`[data-portal-install-date="${planA[0]}"]`).count()) > 0, 20000)
    const words = shown ? (await cp.locator(`[data-portal-install-date="${planA[0]}"]`).first().innerText()).replace(/\s+/g, ' ') : ''
    check('the customer portal (My Projects) shows the install start', !!shown && /Install starts/.test(words) && /2027/.test(words), words)
    await shot(cp, 'portal-my-projects')
  } else check('the customer portal invite', false, JSON.stringify(inv.json).slice(0, 200))

  await p.goto(`${APP}/pipeline?card=${W.a.cardId}`)
  const cw = await until(async () => (await p.locator(`[data-card-install-job="${W.a.jobId}"]`).count()) > 0, 30000)
  check('the pipeline card window has the Install section with Move install', !!cw && (await p.locator(`[data-card-install-job="${W.a.jobId}"] [data-schedule-install-button]`).innerText()).includes('Move install'))
  await shot(p, 'computer-pipeline-card-install')

  // ── 5. Reschedule by drag (computer) ──
  await p.goto(`${APP}/schedule`)
  await p.waitForSelector('[data-ready-panel]', { timeout: 60000 })
  for (let i = 0; i < 12 && (await p.locator('[data-month]').getAttribute('data-month')) !== '2027-03'; i++) { await p.locator('[data-month-next]').click(); await sleep(150) }
  const firstEntry = p.locator(`td[data-day="${planA[0]}"] [data-install-entry="${W.a.jobId}"]`)
  await firstEntry.waitFor({ timeout: 20000 })
  const MOVE_TO = '2027-03-16' // a Tuesday
  await firstEntry.dragTo(p.locator(`td[data-day="${MOVE_TO}"]`))
  await p.waitForSelector(`[data-move-install="${W.a.jobId}"]`, { timeout: 10000 })
  check('reschedule by drag: it asks first, and says the customer can be texted next', /text the customer/i.test(await p.locator(`[data-move-install="${W.a.jobId}"]`).innerText()))
  await shot(p, 'computer-move-ask')
  await p.locator('[data-move-install-yes]').click()
  await p.waitForSelector(`[data-install-done="${W.a.jobId}"]`, { timeout: 20000 })
  const movedPlan = fill(MOVE_TO, daysA, week)
  const mbody = (await p.locator('[data-install-text-body]').innerText()).trim()
  check('reschedule: the "moved" text is prepared, not sent', mbody === expectedText(W.a.first, MOVE_TO, 'moved') && desk.sends.length === 0, mbody)
  await p.locator('[data-install-text-skip]').click()
  const movedJob = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data
  check(`reschedule: every crew day moved (${movedPlan.join(', ')}), same crew`, movedJob?.scheduledDate === movedPlan[0] && movedJob?.scheduledEndDate === movedPlan[movedPlan.length - 1] && movedJob?.crewAssigned === crews[0].name, JSON.stringify(movedJob && [movedJob.scheduledDate, movedJob.scheduledEndDate, movedJob.crewAssigned]))
  await until(async () => (await p.locator(`td[data-day="${movedPlan[0]}"] [data-install-entry="${W.a.jobId}"]`).count()) === 1)
  await shot(p, 'computer-moved')

  // ── 6. Rain day on the job's second day (or its first) ──
  const RAIN = movedPlan[Math.min(1, movedPlan.length - 1)]
  const pv = (await call('POST', '/api/schedule/rain-day/preview', { date: RAIN, shift: 1 })).json.data || []
  const onlyMine = pv.length > 0 && pv.every(m => /E2E (Sched|Phone)/.test(m.customerName))
  check(`rain day ${RAIN}: the preview lists only this test's installs`, onlyMine, pv.map(m => m.customerName).join(', '))
  if (onlyMine) {
    await p.locator('[data-rain-day-open]').click()
    const rd = p.locator('[data-rain-day]')
    await rd.locator('[data-rain-date]').fill(RAIN)
    await until(async () => (await rd.locator('[data-rain-move]').count()) === pv.length)
    const rows = await rd.locator('[data-rain-move]').evaluateAll(els => els.map(e => [e.getAttribute('data-rain-move'), e.querySelector('[data-rain-days]')?.textContent]))
    check('rain day: the preview shows each install\'s days moving one crew day later', rows.length === pv.length && rows.some(r => r[0] === W.a.jobId), JSON.stringify(rows))
    await shot(p, 'computer-rain-day-preview')
    await rd.locator('[data-rain-apply]').click()
    await p.waitForSelector('[data-rain-day="done"]', { timeout: 20000 })
    const after = (await call('GET', `/api/saved-jobs/${W.a.jobId}`)).json.data
    const expectA = movedPlan.map(d => (d >= RAIN ? fill(plus(d, 1), 1, week)[0] : d))
    check(`rain day: from ${RAIN} on, every day moved one crew day (${expectA.join(', ')})`, after?.scheduledDate === expectA[0] && after?.scheduledEndDate === expectA[expectA.length - 1], JSON.stringify(after && [after.scheduledDate, after.scheduledEndDate]))
    const bAfter = (await call('GET', `/api/saved-jobs/${W.b.jobId}`)).json.data
    const bMoved = planB[0] >= RAIN
    if (bMoved) {
      const newB = fill(plus(planB[0], 1), 1, week)[0]
      const textB = await p.locator(`[data-rain-move="${W.b.jobId}"] [data-install-text-body]`).innerText().catch(() => '')
      check('rain day: the next job moved too, and its "moved" text is prepared (not sent)', bAfter?.scheduledDate === newB && textB.trim() === expectedText(W.b.first, newB, 'moved') && desk.sends.length === 0, `${bAfter?.scheduledDate} ${textB}`)
    }
    await shot(p, 'computer-rain-day-done')
    await p.locator('[data-rain-close]').click()
  }

  check('no page errors (computer, phone)', desk.errors.length === 0 && ph.errors.length === 0, [...desk.errors, ...ph.errors].slice(0, 3).join(' | '))
} catch (e) {
  check('test ran to the end', false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
} finally {
  for (const b of browsers) await b.close().catch(() => {})
  // ── 7. Remove what this made. Dev database only, named on every command. ──
  try {
    for (const x of [W.a, W.b]) {
      if (x.jobId) await call('POST', `/api/schedule/install/${x.jobId}/off`, {})
    }
    const jobs = [W.a.jobId, W.b.jobId].filter(Boolean).map(lit).join(',') || "'-'"
    const quotes = [W.a.quoteId, W.b.quoteId].map(lit).join(',')
    const contacts = [W.a.contactId, W.b.contactId].map(lit).join(',')
    const entries = `SELECT id FROM "ScheduledGridJob" WHERE "stagingJobId" IN (${jobs})`
    sql(`BEGIN;
      DELETE FROM "ScheduleRainDay" WHERE "jobId" IN (${entries}) OR "clientName" LIKE ${lit(`%E2E % ${stamp}`)};
      DELETE FROM "DeletionLog" WHERE "entityType" = 'schedule_entry' AND "entityId" IN (${entries});
      DELETE FROM "ScheduledGridJob" WHERE "stagingJobId" IN (${jobs});
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
    const left = Number(sql(`SELECT (SELECT count(*) FROM "SavedJob" WHERE id IN (${jobs})) + (SELECT count(*) FROM "ScheduledGridJob" WHERE "stagingJobId" IN (${jobs})) + (SELECT count(*) FROM "CrmContact" WHERE id IN (${contacts})) + (SELECT count(*) FROM "SavedQuote" WHERE id IN (${quotes}))`))
    check('cleaned up (jobs, schedule entries, rain log, packet, permit, portal login, quotes, customers, cards)', left === 0, `${left} left`)
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 300)) }
  void packetId
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
