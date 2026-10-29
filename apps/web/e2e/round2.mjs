// Walkthrough round 2 (Oct 26, 2026): Jonathan's next round, each role on the dev copy.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/round2.mjs
//
//   Installer (iPhone-size Safari engine), a 2 day job (today and the next crew day):
//     - the card shows the job's 811 ticket; the packet made on day 1's card shows on day 2's card at once
//       (never "Make the crew packet" again);
//     - Start moves the job to In Progress; on day 1 of 2 the buttons are "Finish for today (day 1 of 2)" and
//       "We finished the whole job";
//     - the crew packet shows the office's 811 ticket and dates in words, "Change the locate" opens the boxes,
//       a different ticket is asked about first (No keeps the office's); no "saw an estimate of $ (left out)";
//     - the repair job's card shows the repair items, not the fence style.
//   Office and owner (API): the final walkthrough signed and paid in full first: the job stays In Progress
//     (the crew is not done); then the installer taps "We finished the whole job": Complete, then Paid, and the
//     sales card goes to Paid & Closed, without anyone tapping Complete or Paid.
//   Salesman (phone): the sold quote opened from the pipeline card ends above the bottom tabs (they stay
//     tappable) with no empty bar; "Make a change order" from there, typed: saved as waiting for the office's OK
//     (not sent, no link); the office is told and, on the job page (computer), taps "OK to send".
//   No page errors.
// Dev only (localhost, never port 4000). Removes everything it made.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit, devices } from 'playwright'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json = {}; try { json = JSON.parse(text) } catch {}
  return { status: r.status, json, text }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const stamp = Date.now().toString(36).slice(-6)
const ymd = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const today = ymd(new Date())
const plus = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const dow = d => new Date(`${d}T12:00:00Z`).getUTCDay()
// The next crew day (Monday to Thursday) after today.
let day2 = plus(today, 1); while (![1, 2, 3, 4].includes(dow(day2))) day2 = plus(day2, 1)
const us = d => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`
const ADDR = '110 SE Watula Ave, Ocala, FL 34471'
const WEB_NOTE = 'Website, drawn by customer. The customer drew the fence on the aerial photo of the property and saw an estimate of $4,321 (Better). Confirm every measurement on site.'
const made = { users: [], contacts: [], cards: [], quotes: [], jobs: [], grids: [] }

async function invite(role, last) {
  const email = `e2e-r2-${role}-${stamp}@example.test`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: last, email, role })
  const link = new URL(inv.json.data.inviteUrl)
  made.users.push(email)
  const password = `Rr-${crypto.randomBytes(9).toString('base64url')}`
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: link.searchParams.get('token'), email, password })
  return { email, password, token: acc.json.data?.accessToken, name: `E2E ${last}` }
}

/** A customer, a Sold and signed quote, its card in Pending Start and its job booked on `days` for Crew 1. */
async function soldJob(label, days, extra = {}) {
  const last = `R2 ${label} ${stamp}`
  const contact = await owner('POST', '/api/crm-contacts', { firstName: 'E2E', lastName: last, phone: `352555${String(Math.floor(Math.random() * 9000) + 1000)}`, serviceAddress: ADDR })
  const contactId = contact.json.data?.id
  made.contacts.push(contactId)
  const name = `E2E ${last}`
  const quote = await owner('POST', '/api/saved-quotes', {
    crmContactId: contactId, customerName: name, customerPhone: contact.json.data?.phone ?? '', customerAddress: ADDR,
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [120], corners: 0, ends: 2, sections: 15, finalPrice: 5000, status: 'SOLD', notes: extra.notes ?? '',
    proposal: { version: 1, options: [{ label: 'White vinyl', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 5000, perFoot: 41.67, sections: 15 }] },
    ...(extra.quote ?? {}),
  })
  const quoteId = quote.json.data?.id
  made.quotes.push(quoteId)
  sql(`UPDATE "SavedQuote" SET "acceptedAt" = now(), "soldAt" = coalesce("soldAt", now()) WHERE id = ${lit(quoteId)}`)
  const cardId = `e2e-r2-${label}-${stamp}`
  made.cards.push(cardId)
  const card = { id: cardId, firstName: 'E2E', lastName: last, customerId: contactId, quoteId, stage: 'Pending Start', phone: '', email: '', address: ADDR, notes: '', crew: '', jobValue: 5000, quotePrice: 5000, sections: 15, fenceType: '', leadSource: '', assignedRep: '', paymentStatus: '', scheduledDate: days[0], balanceDue: 0, leadTemp: 0, createdAt: today, lastMoved: today }
  let addCard = { status: 0 }
  for (let i = 0; i < 5 && addCard.status !== 200; i++) {
    const pipe = (await owner('GET', '/api/pipeline')).json
    addCard = await owner('PATCH', '/api/pipeline', { upsert: [{ lead: card }], remove: [], baseVersion: pipe.data?.version ?? pipe.version })
    if (addCard.status !== 200) await sleep(1000)
  }
  const job = await owner('POST', '/api/saved-jobs', { customerName: name, crmContactId: contactId, quoteId, customerAddress: ADDR, fenceStyle: "WV-ND 6'x8' Privacy", sections: 15, totalFeet: 120, quotePrice: 5000, contractValue: 5000, notes: extra.notes ?? '', status: 'scheduled', scheduledDate: days[0], scheduledEndDate: days[days.length - 1], crewAssigned: 'crew1', estimatedDays: days.length })
  const jobId = job.json.data?.id
  made.jobs.push(jobId)
  for (const d of days) { const g = await owner('POST', '/api/schedule/jobs', { stagingJobId: jobId, clientName: name, crewId: 'crew1', date: d, sections: 15, status: 'Scheduled' }); made.grids.push(g.json.data?.id) }
  if (!(await owner('GET', `/api/payments/job/${jobId}`)).json.data?.schedule) await owner('POST', `/api/payments/job/${jobId}/schedule`, {})
  return { contactId, quoteId, cardId, jobId, name, ok: !!contactId && !!quoteId && addCard.status === 200 && !!jobId }
}

const chrome = await chromium.launch()
const safari = await webkit.launch()
const errors = []
async function signedIn(login, phone) {
  const ctx = phone ? await safari.newContext({ ...devices['iPhone 13'] }) : await chrome.newContext({ viewport: { width: 1440, height: 900 } })
  const r = await ctx.request.post(`${API}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1' }, data: { email: login.email, password: login.password, cookie: true } })
  if (!r.ok()) throw new Error(`cookie sign in failed: ${r.status()} ${await r.text()}`)
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(`${login.email}: ${String(e).slice(0, 200)}`))
  page.on('dialog', d => d.accept().catch(() => {}))
  // Stage changes ask the server to run automations; the dev data holds real customers, so not here.
  await page.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  return { ctx, page }
}
const go = async (page, p) => { await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-tabbar], [data-global-appointment]', { timeout: 30000 }).catch(() => {}); await sleep(2500) }
const jobRow = async id => (await owner('GET', `/api/saved-jobs/${id}`)).json.data
const cardStage = async id => sql(`SELECT l->>'stage' FROM "PipelineState" s, jsonb_array_elements(s.leads) l WHERE l->>'id' = ${lit(id)} LIMIT 1`)

try {
  // ── Set up (owner, through the API) ──
  const A = await soldJob('Maria', [today, day2], { notes: WEB_NOTE })
  await owner('PUT', `/api/saved-jobs/${A.jobId}/locate`, { ticket: '294610232', calledDate: today, goodDate: today, expDate: plus(today, 28) })
  // The Salesman's own sale (Sales rep: the Salesman invited below): the Salesman sees only the Salesman's own and
  // assigned quotes (lib/salesScope.ts, Oct 28 2026).
  const B = await soldJob('Robert', [plus(day2, 7)], { quote: { salesRep: `E2E Salesman ${stamp}` } })
  const R = await soldJob('Linda', [today], { quote: { fenceStyle: "WV-ND 6'x8' Privacy", runs: [], sections: 0, work: { version: 1, type: 'repair', repair: { what: 'other', items: { replacePost: 2, rehangGate: 1 }, gateKind: 'walk', postType: 'nd', newPostCaps: false }, crew: ['Replace 2 posts', 'Rehang the walk gate with new hardware'], description: 'Replace 2 posts and rehang a gate', needs811: true, warnings: [], priced: {} } } })
  const sales = await invite('sales_rep', `Salesman ${stamp}`)
  const office = await invite('office_staff', `Office ${stamp}`)
  const crew = await invite('field_crew', `Installer ${stamp}`)
  check('setup: three sold jobs (2 day install, a later one, a repair), with cards; Salesman, Office and Installer logins', A.ok && B.ok && R.ok && !!sales.token && !!office.token && !!crew.token)

  // ── Installer (phone) ──
  {
    const { ctx, page } = await signedIn(crew, true)
    await go(page, '/my-installs')
    const day1 = page.locator(`[data-installs-today] [data-install-card="${A.jobId}"]`)
    const later = page.locator(`[data-installs-upcoming] [data-install-card="${A.jobId}"][data-install-day="${day2}"]`)
    await day1.waitFor({ timeout: 20000 }).catch(() => {})
    check('installer: the 2 day job is under Today (day 1) and Coming up (day 2)', (await day1.count()) === 1 && (await later.count()) === 1)
    await day1.locator('[data-install-locate]').waitFor({ timeout: 15000 }).catch(() => {})
    check('installer: the card shows the job\'s 811 ticket', /811 ticket 294610232/.test(await day1.locator('[data-install-locate]').innerText().catch(() => '')))
    // Day 1's card makes the packet; day 2's card shows it at once (round 2: it still said "Make the crew packet").
    await day1.locator('[data-install-packet-make]').click()
    await day1.locator('[data-install-packet-open]').waitFor({ timeout: 30000 }).catch(() => {})
    check('installer: the packet made on day 1 shows on day 2\'s card, no "Make the crew packet"', (await later.locator('[data-install-packet-open]').count()) === 1 && (await later.locator('[data-install-packet-make]').count()) === 0)
    await day1.locator('[data-install-start]').click()
    await day1.locator('[data-install-started]').waitFor({ timeout: 15000 }).catch(() => {})
    const started = await until(async () => { const j = await jobRow(A.jobId); return j?.status === 'in_progress' ? j : null }, 15000)
    check('Start: the job moves to In Progress by itself', started?.opsStage === 'in_progress', `${started?.status} ${started?.opsStage}`)
    const finishText = await day1.locator('[data-install-finish]').innerText().catch(() => '')
    check('day 1 of 2: "Finish for today (day 1 of 2)" and "We finished the whole job"', /Finish for today \(day 1 of 2\)/.test(finishText) && (await day1.locator('[data-install-finish-whole]').isVisible()), finishText)
    // The crew packet.
    const href = await day1.locator('[data-install-packet-open]').getAttribute('href')
    const packet = await ctx.newPage()
    packet.on('pageerror', e => errors.push(`packet: ${String(e).slice(0, 200)}`))
    await packet.goto(href.startsWith('http') ? href : `${APP}${href}`)
    const pt = await packet.locator('body').innerText()
    check('packet: the office\'s 811 ticket and dates in words', /294610232/.test(await packet.locator('[data-packet-locate-ticket]').innerText()) && (await packet.locator('[data-packet-locate-good]').innerText()) === us(today) && (await packet.locator('[data-packet-locate-exp]').innerText()) === us(plus(today, 28)) && /Saved by/.test(pt))
    check('packet: no "saw an estimate", no "$ (left out)"; the rest of the note kept', !/saw an estimate|left out|\$\s?\d/.test(pt) && /Confirm every measurement on site\./.test(pt))
    check('packet: the boxes are closed until "Change the locate"', !(await packet.locator('#locForm').isVisible()) && (await packet.locator('[data-packet-locate-edit]').isVisible()))
    await packet.locator('[data-packet-locate-edit]').tap()
    check('packet: "Change the locate" opens the boxes, filled with the job\'s locate', (await packet.locator('#ticket').inputValue()) === '294610232' && (await packet.locator('#ldate').inputValue()) === today)
    // A different ticket: asked first; No keeps the office's.
    packet.removeAllListeners('dialog')
    let asked = ''
    packet.once('dialog', d => { asked = d.message(); d.dismiss().catch(() => {}) })
    await packet.locator('#ticket').fill('555000111')
    await packet.locator('#saveLocate').tap()
    await packet.locator('#locMsg:has-text("kept")').waitFor({ timeout: 10000 }).catch(() => {})
    check('packet: a different ticket is asked about first; No keeps the office\'s', /already has 811 ticket 294610232/.test(asked) && (await jobRow(A.jobId))?.locateTicket === '294610232', asked)
    await packet.close()
    // The repair job's card: the repair, not the fence style.
    const rep = page.locator(`[data-installs-today] [data-install-card="${R.jobId}"] [data-install-facts]`)
    check('installer: the repair card shows the repair items', /Repair: 2 × Replace a post · 1 × Rehang a gate/.test(await rep.innerText().catch(() => '')) && !/Privacy|sections/.test(await rep.innerText().catch(() => '')), await rep.innerText().catch(() => ''))

    // ── The walkthrough signed and paid in full before the crew is done ──
    sql(`INSERT INTO "Walkthrough" (id, "accountId", "jobId", status, "homeownerSig", "repSig", "signedAt", "createdAt", "updatedAt") SELECT ${lit(crypto.randomUUID())}, "accountId", id, 'completed', '{"name":"Maria"}'::jsonb, '{"name":"Jonathan","role":"Owner"}'::jsonb, now(), now(), now() FROM "SavedJob" WHERE id = ${lit(A.jobId)}`)
    const sched = (await owner('GET', `/api/payments/job/${A.jobId}`)).json.data?.schedule
    const paid = await owner('POST', '/api/payments', { id: `e2er2${stamp}a`, jobId: A.jobId, amountCents: sched?.contractCents ?? 500000, method: 'check', checkNumber: '4242' })
    const mid = await jobRow(A.jobId)
    check('signed off and paid in full, crew not done: still In Progress', paid.status === 201 && mid?.status === 'in_progress', `${paid.status} ${mid?.status}`)
    // The crew: "We finished the whole job".
    await go(page, '/my-installs')
    const d1 = page.locator(`[data-installs-today] [data-install-card="${A.jobId}"]`)
    await d1.locator('[data-install-finish-whole]').waitFor({ timeout: 20000 }).catch(() => {})
    await d1.locator('[data-install-finish-whole]').tap()
    const done = await until(async () => { const j = await jobRow(A.jobId); return j?.status === 'paid' ? j : null }, 20000)
    check('the whole job finished: Complete then Paid by itself (nobody tapped Complete or Paid)', done?.opsStage === 'paid' && done?.completedDate === today && /Automatic/.test(done?.completedBy ?? ''), `${done?.status} ${done?.opsStage} ${done?.completedBy}`)
    check('its sales card: Paid & Closed', (await until(async () => (await cardStage(A.cardId)) === 'Paid & Closed', 15000)) === true, await cardStage(A.cardId))
    await ctx.close()
  }

  // ── Salesman (phone): the sold quote, and a change order that waits for the office's OK ──
  {
    const { page, ctx } = await signedIn(sales, true)
    await go(page, `/pipeline?card=${encodeURIComponent(B.cardId)}`)
    await page.locator(`[data-card-quote="${B.quoteId}"]`).waitFor({ timeout: 20000 }).catch(() => {})
    await page.locator(`[data-card-quote="${B.quoteId}"]`).tap()
    await page.locator('[data-quote-drawer]').waitFor({ timeout: 15000 }).catch(() => {})
    await sleep(1000)
    const tabsOk = await page.evaluate(() => {
      const bar = document.querySelector('[data-tabbar]')
      if (!bar) return 'no tab bar'
      const r = bar.getBoundingClientRect()
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      const drawer = document.querySelector('[data-quote-drawer]')?.getBoundingClientRect()
      return bar.contains(hit) && drawer && drawer.bottom <= r.top + 1 ? 'ok' : `covered: ${hit?.outerHTML.slice(0, 80)} drawer bottom ${drawer?.bottom} bar top ${r.top}`
    })
    check('salesman phone: the open sold quote ends above the bottom tabs; they stay tappable', tabsOk === 'ok', tabsOk)
    const bar = page.locator('[data-quote-drawer] [data-quote-actions]')
    check('salesman phone: no empty bar on a sold quote (none, or one with a button)', (await bar.count()) === 0 || (await bar.locator('button:visible').count()) > 0)
    const make = page.locator('[data-quote-change-orders] [data-co-button]')
    check('salesman: "Make a change order" on her sold quote', await make.isVisible().catch(() => false))
    await make.tap()
    await page.locator('[data-co-from-lines]').tap()
    await page.locator('[data-co-modal]').waitFor({ timeout: 10000 })
    await page.locator('[data-co-line-description]').first().fill('Add a 4 ft section by the shed')
    await page.locator('[data-co-line-amount]').first().fill('200')
    // A change order needs the reason typed by whoever makes it (41aabb6, Oct 26): Save stays off until then.
    await page.locator('[data-co-reason]').fill('Customer asked for a section by the shed')
    const saveText = await page.locator('[data-co-save-draft]').innerText()
    check('salesman: the save says it goes to the office to OK', /send to the office to OK/i.test(saveText), saveText)
    await page.locator('[data-co-save-draft]').tap()
    const co = await until(async () => ((await owner('GET', `/api/change-orders?quoteId=${B.quoteId}`)).json.data ?? [])[0], 15000)
    check('her change order waits for the OK (not sent, no link, not billed)', co?.status === 'needs_ok' && !co?.hasLink, co?.status)
    check('she cannot send it yet', (await call(sales.token, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: co.version, status: 'sent' })).status === 409)
    // A new tab (a long WebKit session can crash when a page is opened over it again).
    await page.close()
    const p2 = await ctx.newPage()
    p2.on('pageerror', e => errors.push(`salesman: ${String(e).slice(0, 200)}`))
    await go(p2, `/pipeline?card=${encodeURIComponent(B.cardId)}`)
    await p2.locator('[data-card-co-list] [data-co-waiting-ok]').waitFor({ timeout: 20000 }).catch(() => {})
    check('salesman: her card shows "Waiting for Jonathan or the office to OK it", no Sign or Send yet', (await p2.locator('[data-card-co-list] [data-co-waiting-ok]').count()) === 1 && (await p2.locator('[data-card-co-list] [data-co-sign-here]').count()) === 0)
    await ctx.close()

    // ── Office (computer): told, and the OK on the job page ──
    const bell = (await call(office.token, 'GET', '/api/automations/notifications')).json.data?.notifications ?? []
    const notice = bell.find(n => /Change order to OK/.test(n.title) && n.jobId === B.jobId)
    check('office: the bell says there is a change order to OK, opening the job at it', !!notice && notice.link === `/operations?job=${B.jobId}&co=${co.id}`, `${notice?.title} ${notice?.link}`)
    const o = await signedIn(office, false)
    await go(o.page, `/operations?job=${B.jobId}`)
    await o.page.locator('[data-co-row="1"] [data-co-ok]').waitFor({ timeout: 30000 }).catch(() => {})
    await o.page.locator('[data-co-row="1"] [data-co-ok]').click()
    const ok = await until(async () => { const r = ((await owner('GET', `/api/change-orders?quoteId=${B.quoteId}`)).json.data ?? [])[0]; return r?.status === 'draft' ? r : null }, 15000)
    check('office: "OK to send": now a draft the customer can sign', !!ok)
    check('office: the job page now offers "Customer signs on this phone"', (await until(async () => (await o.page.locator('[data-co-row="1"] [data-co-sign-here]').count()) === 1, 15000)) === true)
    // Round 2 review: the OK clears the office's notice and tells her, opening her card at the change order.
    const after = (await call(office.token, 'GET', '/api/automations/notifications')).json.data?.notifications ?? []
    check('office: the "to OK" notice is cleared once OK\'d', after.filter(n => n.jobId === B.jobId && /^Change order to OK/.test(n.title) && !n.read).length === 0 && after.some(n => n.jobId === B.jobId && /^Change order OK'd/.test(n.title) && n.read))
    // Titled "Change order OK'd: CO-1, <customer>. Send it to the customer." since Oct 27 (5fc7981: it names the step she is at).
    const hers = ((await call(sales.token, 'GET', '/api/automations/notifications')).json.data?.notifications ?? []).find(n => n.title === `Change order OK'd: CO-${co.number}, ${B.name}. Send it to the customer.` && n.jobId === B.jobId)
    check('salesman: her bell says "Change order OK\'d: CO-1, <customer>. Send it to the customer.", opening her card at it', !!hers && !hers.read && hers.link === `/pipeline?card=${encodeURIComponent(B.cardId)}&co=${co.id}`, `${hers?.title} ${hers?.link}`)
    await o.ctx.close()
  }
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  check('ran to the end', false, String(e?.stack ?? e).slice(0, 400))
} finally {
  const ids = made.jobs.filter(Boolean)
  try {
    if (ids.length) {
      const inJobs = ids.map(lit).join(',')
      sql(`DELETE FROM "Receipt" WHERE "jobId" IN (${inJobs})`)
      sql(`DELETE FROM "PaymentApplication" WHERE "paymentId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" IN (${inJobs}))`)
      for (const t of ['ContractPayment', 'ContractInvoice', 'BillingLog', 'PaymentSchedule', 'Walkthrough', 'InstallPacket']) sql(`DELETE FROM "${t}" WHERE "jobId" IN (${inJobs})`)
      sql(`DELETE FROM "ActivityLog" WHERE "entityId" IN (${inJobs})`)
      sql(`DELETE FROM "Notification" WHERE "jobId" IN (${inJobs})`)
    }
    for (const id of made.quotes.filter(Boolean)) sql(`DELETE FROM "ChangeOrder" WHERE "quoteId" = ${lit(id)}`)
  } catch (e) { console.error('cleanup (sql):', String(e).slice(0, 200)) }
  for (const g of made.grids.filter(Boolean)) await owner('DELETE', `/api/schedule/jobs/${g}`).catch(() => {})
  for (const id of ids) await owner('DELETE', `/api/saved-jobs/${id}`).catch(() => {})
  for (const id of made.quotes.filter(Boolean)) await owner('DELETE', `/api/saved-quotes/${id}`).catch(() => {})
  for (const id of made.cards) await owner('DELETE', `/api/pipeline/cards/${encodeURIComponent(id)}`).catch(() => {})
  for (const id of made.contacts.filter(Boolean)) await owner('DELETE', `/api/crm-contacts/${id}`).catch(() => {})
  const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
  for (const u of users.filter(x => made.users.includes(x.email))) await owner('DELETE', `/api/crm-auth/users/${u.id}`).catch(() => {})
  await chrome.close(); await safari.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
