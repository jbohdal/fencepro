// Ordinary saves make no 409 (fix/save-conflicts, Oct 27 2026). A reviewer saw PATCH /api/pipeline and
// PATCH /api/business-state answered 409 (STALE_VERSION) while booking a visit, saving a quote and scheduling
// an install: the save went through on the second try, but a phone that sends twice wastes signal, and every
// merge is a chance to get it wrong. Each person here keeps one tab open all along, as they do at work
// (no reload between steps; screens are changed inside the app):
//
//   office    Office Staff login, a computer (Chromium, 1440 x 900), one tab from start to end
//   salesman  Salesman login, an iPhone (WebKit, iPhone 13 size), one tab from the visit on
//   customer  the homeowner, an iPhone (WebKit): signs the proposal link
//
//   1. The office adds two leads (Sales Pipeline, + New lead) and books the Salesman's visit at the first
//      (customer page, Book).
//   2. The Salesman: Today, Complete "Ready to quote", draws the yard, picks a style, saves the quote, copies the link.
//   3. The customer signs (the server makes the job, its checklist and its Sales Order, and moves the card).
//   4. The office, still in the same tab: Schedule, drags the job onto a crew day, books it (the server moves the card).
//   5. The office, same tab, straight to the second customer's page: Book (the board save after the server's own).
//   6. The Salesman, same tab, at the second house: Complete "Ready to quote", one straight side, Save (the
//      business record save after the server's own, at the signature).
//
// Every PATCH / PUT to /api/pipeline and /api/business-state is watched: the version the browser sent and,
// on a 409, the server's. PASS needs no 409 at all. Before the fix steps 5 and 6 each came back 409 once.
// The dev copy is shared: another run saving the board in the same second can still cause a real (and
// correctly merged) 409 here; the line printed for it says which save and which versions, so run it again.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4093 API_URL=http://localhost:4093 E2E_ACCESS_TOKEN=<dev owner token> node e2e/save-conflicts.mjs
//   (the token: cd apps/portal && npx tsx scripts/dev-session-token.ts --out <file>; or E2E_ACCESS_TOKEN_FILE=<file>)
//
// Dev only (devOnly.mjs refuses port 4000 and anything not on this Mac). Makes its own logins and one customer
// ("SAVE409 <stamp>", @example.invalid, (352) 555 01xx) and removes them, its quote, job, visits, pull sheet,
// checklist and Sales Order at the end.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit, devices } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const OWNER = process.env.E2E_ACCESS_TOKEN || (process.env.E2E_ACCESS_TOKEN_FILE ? fs.readFileSync(process.env.E2E_ACCESS_TOKEN_FILE, 'utf8').trim() : '')
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(APP) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, never port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server: apps/portal/scripts/dev-session-token.ts).'); process.exit(2) }
const DB = 'ezbiz_dev'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const sql = q => execFileSync('psql', ['-d', DB, '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json = {}; try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: r.status, json, text }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
const ymd = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const TODAY = ymd(new Date())
const plus = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const dow = d => new Date(`${d}T12:00:00Z`).getUTCDay()
const CREW_DAY = d => [1, 2, 3, 4].includes(dow(d))
const stamp = crypto.randomBytes(3).toString('hex')
const FIRST = 'SAVE409', LAST = `${stamp} Vinyl`
const ADDR = { street: '110 SE Watula Ave', city: 'Ocala' }

let passed = 0, failed = 0
const check = (ok, name, detail = '') => { if (ok) passed++; else failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }

// ── People, their one tab each, and every versioned save they send ──
const made = { users: [], contacts: new Set(), quotes: new Set(), jobs: new Set() }
const saves = []      // { who, step, method, url, base, status, server, code, cards }
const reads = {}      // "<who> board" / "<who> business record": GETs
const pageErrors = []
let currentStep = 'setup'

async function invite(role, label) {
  const email = `save409-${role.replace('_', '-')}-${stamp}@example.invalid`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'SAVE409', lastName: label, email, role })
  if (!inv.json?.data?.inviteUrl) throw new Error(`invite ${role}: ${inv.status} ${inv.text.slice(0, 200)}`)
  made.users.push(email)
  const link = new URL(inv.json.data.inviteUrl)
  const password = `Sc-${crypto.randomBytes(9).toString('base64url')}`
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: link.searchParams.get('token'), email, password })
  if (!acc.json?.data?.accessToken) throw new Error(`accept invite ${role}: ${acc.status} ${acc.text.slice(0, 200)}`)
  const me = await call(acc.json.data.accessToken, 'GET', '/api/crm-auth/me')
  return { role, email, password, token: acc.json.data.accessToken, userId: me.json?.data?.id ?? null }
}

async function device(browser, login, phone, name) {
  const ctx = phone
    ? await browser.newContext({ ...devices['iPhone 13'], permissions: ['geolocation'], geolocation: { latitude: 29.1872, longitude: -82.1401, accuracy: 15 } })
    : await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (login) {
    const r = await ctx.request.post(`${API}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1' }, data: { email: login.email, password: login.password, cookie: true } })
    if (!r.ok()) throw new Error(`${login.role} sign in: ${r.status()}`)
  }
  const page = await ctx.newPage()
  page.on('pageerror', e => pageErrors.push(`${name}: ${String(e).slice(0, 200)}`))
  page.on('dialog', d => d.accept().catch(() => {}))
  page.on('response', async r => {
    const req = r.request()
    const u = r.url()
    if (!/\/api\/(pipeline|business-state)(\?|$)/.test(u)) return
    if (req.method() === 'GET') { const k = `${name} ${u.includes('business-state') ? 'business record' : 'board'}`; reads[k] = (reads[k] ?? 0) + 1; return }
    if (!['PATCH', 'PUT'].includes(req.method())) return
    let sent = {}; try { sent = JSON.parse(req.postData() || '{}') } catch { /* not JSON */ }
    let body = {}; try { body = await r.json() } catch { /* no body */ }
    saves.push({
      who: name, step: currentStep, method: req.method(), url: u.replace(API, ''), base: sent.baseVersion, status: r.status(),
      server: body?.version ?? body?.data?.version, code: body?.code ?? '',
      cards: (sent.upsert ?? []).map(x => `${x.lead?.firstName ?? ''} ${x.lead?.lastName ?? ''}`.trim()), fields: Object.keys(sent).filter(k => k !== 'baseVersion' && k !== 'upsert' && k !== 'remove'),
    })
  })
  return { ctx, page, phone, name, login }
}
const tap = async (who, loc) => {
  await who.page.evaluate(() => document.activeElement?.blur?.()).catch(() => {})
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  await loc.waitFor({ state: 'visible', timeout: 20000 })
  if (who.phone) await loc.tap(); else await loc.click()
  await sleep(300)
}
/** Another screen inside the app, the way a tap on a menu does it: the page is not loaded again. */
async function inApp(who, path) {
  await who.page.evaluate(p => {
    const i = (history.state?.i ?? 0) + 1
    history.pushState({ ez: 1, i, depth: 0 }, '', p)
    dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  }, path)
  await sleep(1200)
}
const cardOf = async contactId => ((await owner('GET', '/api/pipeline')).json?.data?.leads ?? []).find(l => l.customerId === contactId)
const jobRow = async id => (await owner('GET', `/api/saved-jobs/${id}`)).json?.data

async function cleanUp() {
  const db = sql('SELECT current_database()')
  if (db !== DB) throw new Error(`cleanup refused: psql opened ${db}`)
  const contacts = sql(`SELECT id FROM "CrmContact" WHERE "firstName" = 'SAVE409'`).split('\n').filter(Boolean)
  for (const id of made.contacts) if (!contacts.includes(id)) contacts.push(id)
  const inC = contacts.length ? contacts.map(lit).join(',') : "''"
  const quotes = sql(`SELECT id FROM "SavedQuote" WHERE "crmContactId" IN (${inC}) OR "customerName" LIKE 'SAVE409 %'`).split('\n').filter(Boolean)
  for (const id of made.quotes) if (!quotes.includes(id)) quotes.push(id)
  const inQ = quotes.length ? quotes.map(lit).join(',') : "''"
  const jobs = sql(`SELECT id FROM "SavedJob" WHERE "crmContactId" IN (${inC}) OR "quoteId" IN (${inQ}) OR "customerName" LIKE 'SAVE409 %'`).split('\n').filter(Boolean)
  for (const id of made.jobs) if (!jobs.includes(id)) jobs.push(id)
  const inJ = jobs.length ? jobs.map(lit).join(',') : "''"
  const stmts = [
    `DELETE FROM "PaymentApplication" WHERE "paymentId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" IN (${inJ}) OR "quoteId" IN (${inQ}))`,
    `DELETE FROM "Receipt" WHERE "jobId" IN (${inJ}) OR "crmContactId" IN (${inC})`,
    `DELETE FROM "BillingLog" WHERE "jobId" IN (${inJ})`,
    `DELETE FROM "ContractPayment" WHERE "jobId" IN (${inJ}) OR "quoteId" IN (${inQ})`,
    `DELETE FROM "ContractInvoice" WHERE "jobId" IN (${inJ}) OR "quoteId" IN (${inQ})`,
    `DELETE FROM "ContractAdjustment" WHERE "jobId" IN (${inJ})`,
    `DELETE FROM "PaymentSchedule" WHERE "jobId" IN (${inJ}) OR "quoteId" IN (${inQ})`,
    `DELETE FROM "InstallPacket" WHERE "jobId" IN (${inJ})`,
    `DELETE FROM "Permit" WHERE "jobId" IN (${inJ})`,
    `DELETE FROM "JobChecklistItem" WHERE "jobId" IN (${inJ})`,
    `DELETE FROM "JobTakeoff" WHERE "jobId" IN (${inJ}) OR "quoteId" IN (${inQ})`,
    `DELETE FROM "JobQuotedCost" WHERE "quoteId" IN (${inQ})`,
    `DELETE FROM "Task" WHERE "jobId" IN (${inJ})`,
    `DELETE FROM "ScheduledGridJob" WHERE "stagingJobId" IN (${inJ})`,
    `DELETE FROM "SignedDocument" WHERE "jobId" IN (${inJ}) OR "quoteId" IN (${inQ})`,
    `DELETE FROM "ChangeOrder" WHERE "quoteId" IN (${inQ})`,
    `DELETE FROM "ProposalView" WHERE "quoteId" IN (${inQ}) OR "crmContactId" IN (${inC})`,
    `DELETE FROM "QuoteOption" WHERE "quoteId" IN (${inQ})`,
    `DELETE FROM "MediaItem" WHERE "jobId" IN (${inJ}) OR "customerId" IN (${inC})`,
    `DELETE FROM "Notification" WHERE "jobId" IN (${inJ}) OR title LIKE '%SAVE409 %' OR body LIKE '%SAVE409 %'`,
    `DELETE FROM "ActivityLog" WHERE "entityId" IN (${inJ}) OR "entityId" IN (${inQ}) OR "entityId" IN (${inC})`,
    `DELETE FROM "AutomationEvent" WHERE "entityId" IN (${inJ}) OR "entityId" IN (${inQ}) OR "entityId" IN (${inC})`,
    `DELETE FROM "AutomationRunLog" WHERE "jobId" IN (${inJ})`,
    `DELETE FROM "CrmAppointment" WHERE "crmContactId" IN (${inC}) OR "jobId" IN (${inJ})`,
    `DELETE FROM "CallLog" WHERE "crmContactId" IN (${inC})`,
    `DELETE FROM "CrmContactNote" WHERE "crmContactId" IN (${inC})`,
    `DELETE FROM "PendingTouch" WHERE "crmContactId" IN (${inC})`,
    `DELETE FROM "PortalFile" WHERE "crmCustomerId" IN (${inC})`,
    `DELETE FROM "SavedJob" WHERE id IN (${inJ})`,
    `DELETE FROM "SavedQuote" WHERE id IN (${inQ})`,
  ]
  const problems = []
  for (const s of stmts) { try { sql(s) } catch (e) { problems.push(`${s.slice(0, 50)}: ${String(e.stderr ?? e).split('\n')[0].slice(0, 120)}`) } }
  // The card (through the pipeline, with its version).
  for (let k = 0; k < 5; k++) {
    const pipe = (await owner('GET', '/api/pipeline')).json?.data
    const mine = (pipe?.leads ?? []).filter(l => contacts.includes(l.customerId) || l.firstName === 'SAVE409').map(l => l.id)
    if (!mine.length) break
    const r = await owner('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pipe.version })
    if (r.status === 200) break
    await sleep(800)
  }
  // The pull sheet, checklist and Sales Order the quote and job left in the business record (with its version).
  const jobSet = new Set(jobs), quoteSet = new Set(quotes), contactSet = new Set(contacts)
  for (let k = 0; k < 5; k++) {
    const bs = (await owner('GET', '/api/business-state')).json?.data
    if (!bs) break
    const patch = {}
    const pulls = (bs.pullSheets ?? []).filter(p => !(contactSet.has(p.customerId) || quoteSet.has(p.quoteId)))
    if (pulls.length !== (bs.pullSheets ?? []).length) patch.pullSheets = pulls
    const lists = { ...(bs.jobChecklists ?? {}) }
    let listGone = false
    for (const id of jobs) if (id in lists) { delete lists[id]; listGone = true }
    if (listGone) patch.jobChecklists = lists
    const orders = (bs.pendingOrders ?? []).filter(o => !(jobSet.has(o.jobId) || quoteSet.has(o.quoteId) || contactSet.has(o.customerId)))
    if (orders.length !== (bs.pendingOrders ?? []).length) patch.pendingOrders = orders
    if (!Object.keys(patch).length) break
    const r = await owner('PATCH', '/api/business-state', { ...patch, baseVersion: bs.version })
    if (r.status === 200) break
    await sleep(800)
  }
  for (const id of contacts) await owner('DELETE', `/api/crm-contacts/${id}`).catch(() => {})
  try { sql(`DELETE FROM "CrmContact" WHERE id IN (${inC})`) } catch (e) { problems.push(`contacts: ${String(e.stderr ?? e).split('\n')[0].slice(0, 120)}`) }
  const users = (await owner('GET', '/api/crm-auth/users')).json?.data ?? []
  for (const u of users.filter(x => made.users.includes(x.email) || /^save409-[a-z-]+-[0-9a-f]{6}@example\.invalid$/.test(x.email))) await owner('DELETE', `/api/crm-auth/users/${u.id}`).catch(() => {})
  const left = Number(sql(`SELECT (SELECT count(*) FROM "CrmContact" WHERE "firstName" = 'SAVE409') + (SELECT count(*) FROM "SavedJob" WHERE id IN (${inJ})) + (SELECT count(*) FROM "SavedQuote" WHERE id IN (${inQ}))`))
  return { contacts: contacts.length, left, problems }
}

let chrome, safari, exitCode = 0
const t0 = Date.now()
try {
  chrome = await chromium.launch()
  safari = await webkit.launch()
  const me = await owner('GET', '/api/crm-auth/me')
  if (me.status !== 200) throw new Error(`the owner token does not work on ${API} (${me.status})`)
  await cleanUp()
  const office = await invite('office_staff', 'Office')
  const sales = await invite('sales_rep', 'Salesman')
  const O = await device(chrome, office, false, 'office')
  const S = await device(safari, sales, true, 'salesman')
  const C = await device(safari, null, true, 'customer')
  const A = {}

  /** + New lead on the Sales Pipeline, in the office's tab (the board shown inside the app). */
  async function addLead(last, phone) {
    await inApp(O, '/pipeline')
    await O.page.waitForSelector('[data-kanban-col]', { timeout: 45000 }); await sleep(800)
    await tap(O, O.page.locator('button:has-text("+ New lead")').first())
    await O.page.locator('[data-lead-field="first-name"]').fill(FIRST)
    await O.page.locator('[data-lead-field="last-name"]').fill(last)
    await O.page.locator('[data-lead-field="phone"]').fill(phone)
    await O.page.locator('[data-lead-field="email"]').fill(`save409-${stamp}-${phone.slice(-2)}@example.invalid`)
    await O.page.locator('[data-lead-field="street"]').fill(ADDR.street)
    await O.page.keyboard.press('Escape').catch(() => {})
    await O.page.locator('[data-lead-field="city"]').fill(ADDR.city)
    await tap(O, O.page.locator('[data-lead-add]'))
    const card = await until(async () => ((await owner('GET', '/api/pipeline')).json?.data?.leads ?? []).find(l => l.firstName === FIRST && l.lastName === last && l.customerId), 20000)
    if (!card) throw new Error(`the lead ${last} did not reach the server`)
    made.contacts.add(card.customerId)
    return card
  }
  /** The customer page, Book, the Salesman's first free time; the card goes to Appointment. */
  async function bookVisit(contactId) {
    await inApp(O, `/customers/${contactId}`)
    await tap(O, O.page.locator('[data-book-appointment]').first())
    const dlg = O.page.locator('[data-booking-dialog]')
    await dlg.waitFor({ timeout: 15000 })
    const person = dlg.locator('[data-field="person"]')
    const opts = await person.locator('option').evaluateAll(els => els.map(e => ({ v: e.value, t: e.textContent })))
    const hers = opts.find(x => x.v === sales.userId) ?? opts.find(x => /Salesman/.test(x.t))
    if (!hers) throw new Error(`the Salesman is not in the booking window (${opts.map(x => x.t).join(', ')})`)
    await person.selectOption(hers.v)
    for (let k = 0; k < 8; k++) {
      if (await dlg.locator('[data-suggestions] button').first().waitFor({ timeout: 3000 }).then(() => true, () => false)) break
      const d = new Date((await dlg.locator('[data-field="date"]').inputValue()) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)
      await dlg.locator('[data-field="date"]').fill(d.toISOString().slice(0, 10))
    }
    await tap(O, dlg.locator('[data-suggestions] button').first())
    await tap(O, dlg.locator('[data-save]'))
    await dlg.locator('[data-booked]').waitFor({ timeout: 15000 })
    if (await dlg.locator('[data-booked] button:has-text("Done")').count()) await tap(O, dlg.locator('[data-booked] button:has-text("Done")'))
    const appt = await until(async () => ((await owner('GET', '/api/appointments')).json?.data ?? []).find(a => a.crmContactId === contactId), 15000)
    const inAppt = await until(async () => { const l = await cardOf(contactId); return l?.stage === 'Appointment' ? l : null }, 15000)
    return { appt, card: inAppt, stage: inAppt?.stage ?? (await cardOf(contactId))?.stage }
  }

  // 1. The office: one tab all along. + New lead, then the customer page and Book.
  currentStep = 'office adds the lead'
  await O.page.goto(`${APP}/pipeline`, { waitUntil: 'domcontentloaded' })
  await O.page.waitForSelector('[data-kanban-col]', { timeout: 45000 }); await sleep(1500)
  const card = await addLead(LAST, '3525550147')
  A.contactId = card.customerId; A.cardId = card.id
  // The next customer called too: a lead now, a visit later in the day.
  const card2 = await addLead(`${stamp} Second`, '3525550148')
  A.contact2 = card2.customerId; A.card2 = card2.id
  check(true, 'office: the two leads are on the board', `${card.stage}, ${card2.stage}`)
  currentStep = 'office books the visit'
  const v1 = await bookVisit(A.contactId)
  check(!!v1.appt && !!v1.card, 'office: the visit is booked and the card is in Appointment', v1.stage)
  const appt = v1.appt
  // She is at the house now.
  const start = new Date(Date.now() - 60_000)
  await call(office.token, 'PATCH', `/api/appointments/${appt.id}`, { startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), baseVersion: appt.version, reason: 'Save conflicts check: the visit is now' })

  // 2. The Salesman opens the app on her phone at the visit, and keeps that tab.
  currentStep = 'salesman completes the visit'
  await S.page.goto(`${APP}/today`, { waitUntil: 'domcontentloaded' })
  await S.page.waitForSelector('[data-tabbar]', { timeout: 45000 }); await sleep(1500)
  await S.page.locator('[data-next-appointment]').waitFor({ timeout: 30000 })
  await tap(S, S.page.locator('[data-complete]'))
  await tap(S, S.page.locator('[data-outcome="ready_to_quote"]'))
  await S.page.locator('[data-feet]').fill('430')
  await tap(S, S.page.locator('[data-save-outcome]'))
  const b = S.page.locator('[data-quote-builder]')
  await b.waitFor({ timeout: 30000 })
  currentStep = 'salesman saves the quote'
  await tap(S, b.locator('[data-step="yard"]'))
  await tap(S, b.locator('[data-shape="backyard"]'))
  await tap(S, b.locator('[data-side="Left return"] [data-side-length]'))
  for (const [keys, last] of [[['3', '0'], 0], [['1', '2', '0'], 0], [['1', '5', '0'], 0], [['1', '0', '0'], 0], [['3', '0'], 1]]) {
    for (const k of keys) await tap(S, S.page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`))
    await tap(S, S.page.locator(last ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]'))
  }
  await tap(S, b.locator('[data-step="style"]'))
  const sel = b.locator('[data-style-list], select:has(option:text-is("Select a fence style"))').first()
  await sel.waitFor({ timeout: 15000 })
  const styleLabel = (await sel.locator('option').allInnerTexts()).find(o => /White Vinyl Privacy, 6 ft tall.*No dig/i.test(o))
  if (!styleLabel) throw new Error('no white vinyl no dig style in the list')
  await sel.selectOption({ label: styleLabel }); await sleep(500)
  await tap(S, S.page.locator('[data-quote-builder] [data-step="price"]')); await sleep(800)
  await tap(S, S.page.locator('[data-quote-bar] [data-save-open], [data-save-open]').first())
  await tap(S, S.page.locator('[data-save-submit]'))
  const q = await until(async () => ((await owner('GET', '/api/saved-quotes')).json?.data ?? []).find(x => x.crmContactId === A.contactId), 20000)
  if (!q) throw new Error('the quote did not reach the server')
  made.quotes.add(q.id); A.quote = q
  // The quote window opens on its own after a save from the visit (Send box): Copy link marks it Sent.
  currentStep = 'salesman copies the link'
  await S.page.locator('[data-proposal-send]').first().waitFor({ timeout: 30000 })
  const tokenResp = S.page.waitForResponse(r => /\/api\/saved-quotes\/[^/]+\/share-token$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null)
  await tap(S, S.page.locator('[data-proposal-copy]').first())
  const tr = await tokenResp
  const token = (tr ? await tr.json().catch(() => null) : null)?.data?.shareToken
  if (!token) throw new Error('Copy link made no link')
  await sleep(2500)
  const inEst = await cardOf(A.contactId)
  check(!!inEst && inEst.stage !== 'Appointment', 'salesman: the quote is saved and the card moved on', inEst?.stage)

  // 3. The customer signs (the server makes the job, its checklist, its Sales Order, and moves the card).
  currentStep = 'customer signs'
  await C.page.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
  await C.page.waitForSelector('#go', { timeout: 30000 })
  if (await C.page.locator('.opt[data-option]').count() > 1) {
    const texts = await C.page.locator('.opt[data-option]').allInnerTexts()
    const k = Math.max(0, texts.findIndex(t => /no dig/i.test(t)))
    await C.page.locator('.opt[data-option]').nth(k).tap()
  }
  await C.page.locator('#name').fill('Pat Save')
  const canvas = C.page.locator('#sig'); await canvas.scrollIntoViewIfNeeded()
  const bb = await canvas.boundingBox()
  await C.page.mouse.move(bb.x + 25, bb.y + bb.height * 0.6); await C.page.mouse.down()
  for (let i = 1; i <= 10; i++) await C.page.mouse.move(bb.x + 25 + i * (bb.width - 50) / 10, bb.y + bb.height * (0.6 + 0.2 * Math.sin(i)), { steps: 2 })
  await C.page.mouse.up(); await sleep(200)
  await C.page.locator('#go').tap()
  const job = await until(async () => ((await owner('GET', '/api/saved-jobs')).json?.data ?? []).find(j => j.quoteId === q.id), 30000)
  if (!job) throw new Error('no job was made from the signed proposal')
  made.jobs.add(job.id); A.job = job
  check(true, 'customer: signed; the job is made', job.status)
  await sleep(2000)

  // 4. The office, same tab: Schedule, drag the job onto a crew day, book it.
  currentStep = 'office schedules the install'
  await inApp(O, '/schedule')
  let day = plus(TODAY, 7); while (!CREW_DAY(day)) day = plus(day, 1)
  const ready = O.page.locator(`[data-ready-job="${job.id}"]`)
  await ready.waitFor({ timeout: 40000 })
  const month = day.slice(0, 7)
  for (let i = 0; i < 3 && (await O.page.locator('[data-month]').getAttribute('data-month').catch(() => month)) < month; i++) { await O.page.locator('[data-month-next]').click().catch(() => {}); await sleep(300) }
  await ready.dragTo(O.page.locator(`td[data-day="${day}"]`))
  const sdlg = O.page.locator(`[data-schedule-install="${job.id}"]`)
  await sdlg.locator('[data-si-save]').waitFor({ timeout: 15000 })
  await tap(O, sdlg.locator('[data-si-save]'))
  await O.page.locator('[data-install-text-skip], [data-install-text-open]').first().waitFor({ timeout: 20000 }).catch(() => {})
  if (await O.page.locator('[data-install-text-skip]').count()) await tap(O, O.page.locator('[data-install-text-skip]'))
  const j = await until(async () => { const r = await jobRow(job.id); return r?.scheduledDate?.slice(0, 10) === day ? r : null }, 20000)
  check(!!j, 'office: the install is booked', j ? `${day}, ${j.status}` : `not on ${day}`)
  await sleep(1500)

  // 5. The office, same tab, straight from Schedule to the next customer's page: Book (a pipeline save made
  //    after the server's own writes: the install moved the first card, the signature made the job).
  currentStep = 'office: next visit'
  const v2 = await bookVisit(A.contact2)
  check(!!v2.appt && !!v2.card, 'office: the next visit is booked in the same tab', v2.stage)

  // 6. The Salesman, same tab since the first visit, at the next house: Today, Complete "Ready to quote",
  //    one straight side, Save.
  currentStep = 'salesman: next visit and quote'
  const start2 = new Date(Date.now() - 60_000)
  await call(office.token, 'PATCH', `/api/appointments/${v2.appt.id}`, { startAt: start2.toISOString(), endAt: new Date(start2.getTime() + 3_600_000).toISOString(), baseVersion: v2.appt.version, reason: 'Save conflicts check: the visit is now' })
  // She takes the phone out at the next house and has signal again: the app reads its lists again.
  await inApp(S, '/today')
  await S.page.evaluate(() => { window.dispatchEvent(new Event('online')) })
  await until(async () => (await S.page.locator('[data-next-name]').innerText().catch(() => '')).includes('Second'), 70000, 1000)
  await tap(S, S.page.locator('[data-complete]'))
  await tap(S, S.page.locator('[data-outcome="ready_to_quote"]'))
  await S.page.locator('[data-feet]').fill('180')
  await tap(S, S.page.locator('[data-save-outcome]'))
  await S.page.waitForSelector('[data-quote-builder] [data-step="yard"]', { timeout: 30000 })
  await tap(S, S.page.locator('[data-step="yard"]'))
  await tap(S, S.page.locator('[data-shape="straight"]'))
  await tap(S, S.page.locator('[data-side-length]').first())
  for (const k of ['1', '8', '0']) await tap(S, S.page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`))
  await tap(S, S.page.locator('[data-ftin-pad] [data-pad-done]'))
  await tap(S, S.page.locator('[data-step="style"]'))
  const sel2 = S.page.locator('[data-quote-builder] [data-style-list], [data-quote-builder] select:has(option:text-is("Select a fence style"))').first()
  await sel2.waitFor({ timeout: 15000 })
  const style2 = (await sel2.locator('option').allInnerTexts()).find(o => /White Vinyl Privacy, 6 ft tall.*No dig/i.test(o))
  await sel2.selectOption({ label: style2 }); await sleep(500)
  for (let i = 0; i < 6 && !(await S.page.locator('[data-quote-bar] [data-save-open]').count()); i++) await tap(S, S.page.locator('[data-quote-bar] [data-bar-next]'))
  await tap(S, S.page.locator('[data-quote-bar] [data-save-open]'))
  await tap(S, S.page.locator('[data-save-submit]'))
  const q2 = await until(async () => ((await owner('GET', '/api/saved-quotes')).json?.data ?? []).find(x => x.crmContactId === A.contact2), 20000)
  if (q2) made.quotes.add(q2.id)
  await sleep(3000)
  const c2now = await cardOf(A.contact2)
  check(!!q2 && c2now?.stage !== 'Appointment', 'salesman: the next quote is saved and its card moved on', c2now?.stage)
  // The screen is not disturbed: the saved quote's window is still open with its Send box.
  check(await S.page.locator('[data-proposal-send]').first().isVisible().catch(() => false), 'salesman: the quote\'s Send box is still on screen after the save')
  // The pull sheet reached the business record once, with the quote.
  const bs = (await owner('GET', '/api/business-state')).json?.data
  check((bs?.pullSheets ?? []).some(p => p.quoteId === q2?.id), 'the second quote\'s pull sheet is in the business record')
  check((bs?.jobChecklists ?? {})[job.id] && (bs?.pendingOrders ?? []).some(o => o.jobId === job.id || o.quoteId === q.id), 'the server\'s own writes are kept (the job\'s checklist and Sales Order)')

  // ── What was sent ──
  for (const s of saves) {
    const where = s.status === 409 ? ` (server at ${s.server}${s.code ? ', ' + s.code : ''})` : ''
    console.log(`      ${s.who.padEnd(8)} ${s.step.padEnd(42)} ${s.method} ${s.url} base=${s.base} -> ${s.status}${where}${s.cards.length ? ' cards: ' + s.cards.join(', ') : ''}${s.fields.length ? ' fields: ' + s.fields.join(',') : ''}`)
  }
  console.log(`      reads: ${Object.entries(reads).map(([k, n]) => `${k} ${n}`).join(', ')}`)
  const conflicts = saves.filter(s => s.status === 409)
  check(saves.length > 0, 'the saves were watched', `${saves.length} versioned saves`)
  check(conflicts.length === 0, 'no 409 on any ordinary save (pipeline, business state)', conflicts.map(s => `${s.who} ${s.step}: ${s.method} ${s.url} base ${s.base}, server ${s.server}`).join('; '))
  check(pageErrors.length === 0, 'no page errors', pageErrors.slice(0, 3).join(' | '))
} catch (e) {
  failed++
  console.log(`FAIL  ${currentStep}: ${String(e?.message ?? e).split('\n')[0].slice(0, 300)}`)
  for (const s of saves) console.log(`      ${s.who} ${s.step} ${s.method} ${s.url} base=${s.base} -> ${s.status} ${s.server ?? ''} ${s.code}`)
} finally {
  const c = await cleanUp().catch(e => ({ left: -1, problems: [String(e)] }))
  check(c.left === 0 && !c.problems.length, 'test records removed', c.problems.slice(0, 2).join(' | '))
  await chrome?.close().catch(() => {}); await safari?.close().catch(() => {})
  console.log(`\n${passed} passed, ${failed} failed (${((Date.now() - t0) / 1000).toFixed(0)} s)`)
  exitCode = failed ? 1 : 0
}
process.exit(exitCode)
