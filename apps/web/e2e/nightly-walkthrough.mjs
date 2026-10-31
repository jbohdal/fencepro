// The nightly 3 job walkthrough (Jonathan, Oct 26 2026: "make the 3 job walkthrough ... an automatic nightly
// check after 6 pm"). Each step is done by the person who does it, on the device they use:
//   office    Office Staff login, a computer (Chromium, 1440 x 900)
//   salesman  Salesman login (Christa), an iPhone (WebKit, iPhone 13 size)
//   installer Field Crew login, an iPhone (WebKit, iPhone 13 size, in Ocala)
//   owner     Jonathan, an iPhone (WebKit)
//   customer  the homeowner, an iPhone (WebKit), no login (the links we send)
//
//   Job A, white vinyl no dig: the office adds the lead and books the Salesman's visit; at the visit she
//     completes it "Ready to quote", draws the yard, picks the style, saves and copies the proposal link; the
//     customer signs; the office takes the deposit, adds the 811 ticket and the permit, schedules the install on
//     a crew day (Monday to Thursday); the installer makes the packet (no prices), taps Start and Finish, walks
//     the job with the homeowner (checklist, photos, both signatures); the office takes the final payment and the
//     job closes itself to Paid (its card to Paid & Closed).
//   Job B, 4 ft chain link dig set: the office adds the lead and gives it to the Salesman (the Salesman choice on
//     Add lead); the Salesman quotes from the card and the customer signs; the office takes the deposit; the Salesman makes a change order (waits for the OK), the office OKs it, the customer signs it on
//     her phone; Jonathan makes a change order from the job's drawing and the customer signs it; the contract is
//     the quote plus both.
//   Job C, walk-in repair: the office adds the walk-in, quotes the repair, sends it (Send anyway: no photos),
//     the customer signs at the counter; the office schedules it; the installer starts and finishes it and walks
//     it (the homeowner signs on the link); the office takes the payment and it closes itself to Paid.
//
// Run (dev copy only; 4001 serves the built app, or a worktree's own server):
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> (or E2E_ACCESS_TOKEN_FILE=<file>) \
//     [SHOTS=<folder>] [RESULTS=<file.json>] [JOBS=A,B,C] [KEEP=1] node e2e/nightly-walkthrough.mjs
//
// The deposit: the proposal's own percent (Settings > Proposal). A proposal that asks 0% or none makes no deposit
// invoice (D2, Jonathan, Oct 29 2026), so the deposit step then checks the Final is the whole contract and records
// nothing; the final payment is the whole contract.
//
// Prints PASS / FAIL / SKIP per step with its time; a failed step takes a screenshot (SHOTS) and the rest of that
// job is skipped (it needs the step). RESULTS gets the same as JSON (deploy/mac/nightly-check.sh reads it).
// Makes its own logins (nightly-<role>-<stamp>@example.invalid) and customers ("NIGHTLY <date> ...",
// @example.invalid, (352) 555 01xx), and removes them all at the end, with whatever an earlier run left.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // needs prices that hold still: a test changing Inventory mid run brings up "Prices changed" on the quote
import { chromium, webkit, devices } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
// The owner's dev sign in: E2E_ACCESS_TOKEN, or E2E_ACCESS_TOKEN_FILE (a file holding it, so it is not on the command line).
const OWNER = process.env.E2E_ACCESS_TOKEN || (process.env.E2E_ACCESS_TOKEN_FILE ? fs.readFileSync(process.env.E2E_ACCESS_TOKEN_FILE, 'utf8').trim() : '')
const SHOTS = process.env.SHOTS || ''
const RESULTS = process.env.RESULTS || ''
const ONLY = new Set((process.env.JOBS || 'A,B,C').split(',').map(s => s.trim().toUpperCase()).filter(Boolean))
const KEEP = process.env.KEEP === '1'
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(APP) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, never port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server: apps/portal/scripts/dev-session-token.ts).'); process.exit(2) }
// The database this writes to must be the dev copy: the psql steps name it, and the server must say so too.
const DB = 'ezbiz_dev'
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

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
const cents = text => { const m = String(text).match(/([−-])?\$\s?([\d,]+(?:\.\d{2})?)/); return m ? (m[1] ? -1 : 1) * Math.round(parseFloat(m[2].replace(/,/g, '')) * 100) : NaN }

// ── Dates (Ocala time) ──
const ymd = d => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const TODAY = ymd(new Date())
const plus = (d, n) => { const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const dow = d => new Date(`${d}T12:00:00Z`).getUTCDay()
const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const CREW_DAY = d => [1, 2, 3, 4].includes(dow(d))

// ── Names ──
const stamp = crypto.randomBytes(3).toString('hex')
const TAG = `NIGHTLY ${TODAY}`
const ADDR = { street: '110 SE Watula Ave', city: 'Ocala', state: 'FL', zip: '34471' }
const ADDRESS = `${ADDR.street}, ${ADDR.city}, ${ADDR.state} ${ADDR.zip}`

// ── Results ──
const steps = []
const blocked = new Set()
const startedAt = new Date().toISOString()
class StepFail extends Error {}
const expect = (ok, msg) => { if (!ok) throw new StepFail(msg) }

/** Runs one step as `who`: PASS with its time, or FAIL with what was wrong and a screenshot; a failed step skips the rest of its job. */
async function step(job, name, who, fn) {
  const rec = { job, step: name, role: who?.role ?? 'system', device: who?.device ?? '', status: 'pass', ms: 0, detail: '', screenshot: null }
  if (blocked.has(job)) {
    rec.status = 'skip'; rec.detail = 'skipped: an earlier step of this job failed'
    steps.push(rec); console.log(`SKIP  [${job}] ${name}`); return null
  }
  const t0 = Date.now()
  let out = null
  try {
    out = await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new StepFail('took more than 4 minutes')), 240_000))])
    if (typeof out === 'string') rec.detail = out
  } catch (e) {
    rec.status = 'fail'
    rec.detail = (e instanceof StepFail ? e.message : String(e?.message ?? e).split('\n').slice(0, 3).join(' ')).slice(0, 600)
    blocked.add(job)
    if (SHOTS && who?.page) {
      const file = path.join(SHOTS, `nightly-${job}-${steps.length + 1}-${who.role}.png`)
      await who.page.screenshot({ path: file, fullPage: false }).then(() => { rec.screenshot = file }).catch(() => {})
    }
  }
  rec.ms = Date.now() - t0
  steps.push(rec)
  console.log(`${rec.status.toUpperCase().padEnd(4)}  [${job}] ${name}  (${(rec.ms / 1000).toFixed(1)} s, ${rec.role}${rec.device ? ' ' + rec.device : ''})${rec.detail ? '  -- ' + rec.detail : ''}`)
  return rec.status === 'pass' ? (out ?? true) : null
}

// ── People and their devices ──
const made = { users: [], contacts: new Set(), cards: new Set(), quotes: new Set(), jobs: new Set() }
let chrome, safari
const pageErrors = []

async function invite(role, label) {
  const email = `nightly-${role.replace('_', '-')}-${stamp}@example.invalid`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'NIGHTLY', lastName: `${TODAY} ${label}`, email, role })
  if (!inv.json?.data?.inviteUrl) throw new Error(`invite ${role}: ${inv.status} ${inv.text.slice(0, 200)}`)
  made.users.push(email)
  const link = new URL(inv.json.data.inviteUrl)
  const password = `Nt-${crypto.randomBytes(9).toString('base64url')}`
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: link.searchParams.get('token'), email, password })
  if (!acc.json?.data?.accessToken) throw new Error(`accept invite ${role}: ${acc.status} ${acc.text.slice(0, 200)}`)
  const me = await call(acc.json.data.accessToken, 'GET', '/api/crm-auth/me')
  return { role, email, password, token: acc.json.data.accessToken, name: `NIGHTLY ${TODAY} ${label}`, userId: me.json?.data?.id ?? null }
}

/** A signed in browser for a login (cookie sign in, as the app does). Phones are WebKit at iPhone size. */
async function device(login, kind) {
  const phone = kind !== 'computer'
  const ctx = phone
    ? await safari.newContext({ ...devices['iPhone 13'], permissions: ['geolocation'], geolocation: { latitude: 29.1872, longitude: -82.1401, accuracy: 15 } })
    : await chrome.newContext({ viewport: { width: 1440, height: 900 } })
  if (login) {
    if (login.password) {
      const r = await ctx.request.post(`${API}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1' }, data: { email: login.email, password: login.password, cookie: true } })
      if (!r.ok()) throw new Error(`${login.role} sign in: ${r.status()} ${(await r.text()).slice(0, 200)}`)
    } else {
      const r = await ctx.request.post(`${API}/api/crm-auth/move-over`, { headers: { 'X-Staff-Request': '1', Authorization: `Bearer ${login.token}` }, data: {} })
      if (!r.ok()) throw new Error(`${login.role} sign in: ${r.status()} ${(await r.text()).slice(0, 200)}`)
    }
  }
  const page = await ctx.newPage()
  const who = { role: login?.role ?? 'customer', device: phone ? 'iPhone (WebKit)' : 'computer (Chromium)', ctx, page, login, phone }
  watch(who, page)
  return who
}
function watch(who, page) {
  page.on('pageerror', e => pageErrors.push(`${who.role}: ${String(e).slice(0, 200)}`))
  page.on('dialog', d => d.accept().catch(() => {}))
}
/** A fresh tab for the person (a long WebKit session can crash when a page is opened over it again). */
async function freshPage(who) {
  await who.page.close().catch(() => {})
  who.page = await who.ctx.newPage()
  watch(who, who.page)
  return who.page
}
async function go(who, p, ready = true) {
  const page = await freshPage(who)
  await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' })
  if (ready) await page.waitForSelector(who.phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 45000 })
  await sleep(1500)
  return page
}
const tap = async (who, loc) => {
  await who.page.evaluate(() => document.activeElement?.blur?.()).catch(() => {})
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  await loc.waitFor({ state: 'visible', timeout: 20000 })
  if (who.phone) await loc.tap(); else await loc.click()
  await sleep(300)
}

// ── Things to check on the server ──
const jobRow = async id => (await owner('GET', `/api/saved-jobs/${id}`)).json?.data
const quoteRow = async id => (await owner('GET', `/api/saved-quotes/${id}`)).json?.data ?? (await owner('GET', `/api/saved-quotes/${id}`)).json
const jobForQuote = async quoteId => ((await owner('GET', '/api/saved-jobs')).json?.data ?? []).find(j => j.quoteId === quoteId)
const cardOf = async contactId => ((await owner('GET', '/api/pipeline')).json?.data?.leads ?? []).find(l => l.customerId === contactId)
const changeOrders = async quoteId => (await owner('GET', `/api/change-orders?quoteId=${quoteId}`)).json?.data ?? []
const schedule = async jobId => (await owner('GET', `/api/payments/job/${jobId}`)).json?.data?.schedule

/** A real PNG photo (a color with a white stripe). */
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3, s = Math.abs(x - y) < 6; raw[o] = s ? 255 : rgb[0]; raw[o + 1] = s ? 255 : rgb[1]; raw[o + 2] = s ? 255 : rgb[2] }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([l, td, c]) }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}
const photo = (name, rgb) => ({ name: `${name}.png`, mimeType: 'image/png', buffer: png(480, 360, rgb) })

/** A finger signature on a canvas (pointer events, as a touch screen sends them). */
async function fingerSign(page, canvas) {
  await canvas.scrollIntoViewIfNeeded()
  const b = await canvas.boundingBox()
  const pt = i => ({ clientX: b.x + 20 + i * Math.max(8, (b.width - 40) / 12), clientY: b.y + b.height / 2 + (i % 2 ? -18 : 18), pointerId: 7, pointerType: 'touch', isPrimary: true, bubbles: true })
  await canvas.dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await canvas.dispatchEvent('pointermove', pt(i))
  await canvas.dispatchEvent('pointerup', pt(12))
  // Mouse too, for pads that listen to mouse events.
  await page.mouse.move(b.x + 25, b.y + b.height * 0.6); await page.mouse.down()
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 25 + i * (b.width - 50) / 10, b.y + b.height * (0.6 + 0.2 * Math.sin(i)), { steps: 2 })
  await page.mouse.up(); await sleep(200)
}

/** The page has no price, money or cost words (an installer's screen). */
const PRICE = /\$\s?\d|\bprice\b|\bcost\b|\bmargin\b|\bdeposit\b/i

// ════════════════════════════════════════════════════════════════════════════
// The steps that more than one job uses
// ════════════════════════════════════════════════════════════════════════════

/** The office adds a lead on the Sales Pipeline (computer). Returns { contactId, cardId, name }. */
async function officeAddsLead(o, first, last, phone, source, salesman = null) {
  const page = await go(o, '/pipeline')
  await page.waitForSelector('[data-kanban-col]', { timeout: 45000 }); await sleep(800)
  await tap(o, page.locator('button:has-text("+ New lead")').first())
  await page.locator('[data-lead-field="first-name"]').fill(first)
  await page.locator('[data-lead-field="last-name"]').fill(last)
  await page.locator('[data-lead-field="phone"]').fill(phone)
  await page.locator('[data-lead-field="email"]').fill(`nightly-${stamp}-${phone.slice(-2)}@example.invalid`)
  await page.locator('[data-lead-field="street"]').fill(ADDR.street)
  await page.keyboard.press('Escape').catch(() => {}) // closes the address suggestions, not the form
  await page.locator('[data-lead-field="city"]').fill(ADDR.city)
  const form = page.locator('[data-lead-add]').locator('xpath=ancestor::div[.//select][1]')
  const src = form.locator('select').last()
  const opts = await src.locator('option').allInnerTexts()
  const want = opts.find(o => source.test(o))
  if (want) await src.selectOption({ label: want })
  // The Salesman choice (Oct 29 2026): the office's entry starts on the owner (D4); picked here, it goes to that Salesman.
  if (salesman) {
    const sel = page.locator('[data-salesman-select]')
    const there = await until(async () => (await sel.locator(`option[value="${salesman}"]`).count()) > 0, 20000)
    expect(there, `the Salesman choice on Add lead does not offer ${salesman}`)
    await sel.selectOption(salesman)
  }
  await tap(o, page.locator('[data-lead-add]'))
  const name = `${first} ${last}`
  const card = await until(async () => ((await owner('GET', '/api/pipeline')).json?.data?.leads ?? []).find(l => l.firstName === first && l.lastName === last && l.customerId), 20000)
  expect(card, `the lead "${name}" did not reach the server (no card with a customer)`)
  made.contacts.add(card.customerId); made.cards.add(card.id)
  const c = (await owner('GET', `/api/crm-contacts/${card.customerId}`)).json?.data
  expect(/Watula/.test(c?.serviceAddress ?? c?.address ?? card.address ?? ''), `the customer has no address (${c?.serviceAddress ?? card.address ?? 'none'})`)
  return { contactId: card.customerId, cardId: card.id, name, stage: card.stage, source: want ?? '(none picked)' }
}

/** In the quote builder: the yard as a backyard (returns 30, sides 120 and 100, back 150), then the style. */
async function drawBackyard(who, b, stylePattern) {
  const page = who.page
  await tap(who, b.locator('[data-step="yard"]'))
  await tap(who, b.locator('[data-shape="backyard"]'))
  await tap(who, b.locator('[data-side="Left return"] [data-side-length]'))
  for (const [keys, last] of [[['3', '0'], 0], [['1', '2', '0'], 0], [['1', '5', '0'], 0], [['1', '0', '0'], 0], [['3', '0'], 1]]) {
    for (const k of keys) await tap(who, page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`))
    await tap(who, page.locator(last ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]'))
  }
  await tap(who, b.locator('[data-step="style"]'))
  return pickStyle(b, stylePattern)
}
async function pickStyle(b, pattern) {
  const sel = b.locator('[data-style-list], select:has(option:text-is("Select a fence style"))').first()
  await sel.waitFor({ timeout: 15000 })
  const opts = await sel.locator('option').allInnerTexts()
  const label = opts.find(o => pattern.test(o))
  expect(label, `no fence style like ${pattern} in the list (${opts.slice(0, 12).join(' | ')} ...)`)
  await sel.selectOption({ label })
  await sleep(500)
  return label
}
/** Price step, then Save (the save window's own Save). Returns the saved quote. */
async function saveQuote(who, contactId) {
  const page = who.page
  const before = new Set(((await owner('GET', '/api/saved-quotes')).json?.data ?? []).filter(q => q.crmContactId === contactId).map(q => q.id))
  await tap(who, page.locator('[data-quote-builder] [data-step="price"]'))
  await sleep(800)
  const price = cents(await page.locator('[data-quote-builder] [data-quote-price], [data-bar-price]').first().innerText().catch(() => ''))
  await tap(who, page.locator('[data-quote-bar] [data-save-open], [data-save-open]').first())
  await tap(who, page.locator('[data-save-submit]'))
  const q = await until(async () => ((await owner('GET', '/api/saved-quotes')).json?.data ?? []).find(x => x.crmContactId === contactId && !before.has(x.id)), 20000)
  expect(q, 'the quote did not reach the server after Save')
  made.quotes.add(q.id)
  expect(q.finalPrice > 0, `the saved quote has no price (${q.finalPrice})`)
  return { quote: q, shownCents: price }
}

/** The quote window's proposal: Copy link (it marks the quote Sent). Returns the customer's link. */
async function copyProposalLink(who, quoteId, { sendAnyway } = {}) {
  const page = who.page
  await page.locator('[data-proposal-send]').first().waitFor({ timeout: 30000 })
  if (sendAnyway && await page.locator('[data-photos-override]').count()) {
    await tap(who, page.locator('[data-photos-override]'))
    await page.locator('[data-photos-reason]').fill(sendAnyway)
    await tap(who, page.locator('[data-photos-override-ok]'))
    await sleep(1200)
  }
  const tokenResp = page.waitForResponse(r => /\/api\/saved-quotes\/[^/]+\/share-token$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null)
  await tap(who, page.locator('[data-proposal-copy]').first())
  const resp = await tokenResp
  const body = resp ? await resp.json().catch(() => null) : null
  const token = body?.data?.shareToken ?? body?.shareToken
  expect(token, `Copy link made no link (${resp ? resp.status() : 'no answer'})`)
  const sent = await until(async () => (await quoteRow(quoteId))?.status === 'SENT', 15000)
  expect(sent, `the quote is not Sent after Copy link (${(await quoteRow(quoteId))?.status})`)
  return `${APP}/p/${token}`
}

/** The customer opens the proposal link on their phone and signs. Returns the job made from it. */
async function customerSignsProposal(c, link, quoteId, signer, pick) {
  const page = await freshPage(c)
  await page.goto(link, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#go', { timeout: 30000 })
  const body = await page.locator('body').innerText()
  const leak = body.match(/.{0,50}(\bcosts? (?:us|of materials|breakdown)|\bmargin\b|COGS|materialCost|laborCost).{0,30}/i)
  expect(!leak, `the customer's proposal shows our cost or margin: "${leak?.[0]}"`)
  const costWord = body.match(/.{0,60}\bcost\b.{0,40}/i)
  if (costWord) console.log(`      (the customer's proposal says: "${costWord[0].replace(/\s+/g, ' ')}")`)
  // The option the customer wants (the one quoted), when there is more than one.
  let chose = ''
  if (pick && await page.locator('.opt[data-option]').count() > 1) {
    const texts = await page.locator('.opt[data-option]').allInnerTexts()
    const k = texts.findIndex(t => pick.test(t))
    expect(k >= 0, `no option like ${pick} on the proposal (${texts.map(t => t.split('\n')[0]).join(' | ')})`)
    await page.locator('.opt[data-option]').nth(k).tap()
    chose = texts[k].split('\n')[0]
  }
  await page.locator('#name').fill(signer)
  await fingerSign(page, page.locator('#sig'))
  await page.locator('#go').tap()
  expect(await until(async () => (await page.locator('body').innerText()).includes('Accepted'), 20000), 'the page never said Accepted after signing')
  const q = await until(async () => { const r = await quoteRow(quoteId); return r?.status === 'SOLD' && r?.acceptedAt ? r : null }, 20000)
  expect(q, `the quote is not Sold after the customer signed (${(await quoteRow(quoteId))?.status})`)
  const job = await until(() => jobForQuote(quoteId), 30000)
  expect(job, 'no job was made from the signed proposal')
  made.jobs.add(job.id)
  job.chose = chose
  return job
}

/** The office records a payment on the job page (computer): deposit or final, by check. Returns the receipt's words. */
async function officeTakesPayment(o, jobId, which, checkNo) {
  const page = await go(o, `/operations?job=${jobId}`)
  const btn = page.locator(`[data-payment-schedule="${jobId}"] [data-payment-received="${which}"]`).first()
  await btn.waitFor({ timeout: 40000 })
  await tap(o, btn)
  const S = page.locator('[data-payment-sheet]')
  await S.waitFor({ timeout: 15000 })
  const amount = await S.locator('[data-payment-amount]').inputValue()
  expect(Number(amount) > 0, `the payment form is not filled in with the amount due (${amount})`)
  await tap(o, S.locator('[data-payment-method="check"]'))
  await S.locator('[data-payment-check-number]').fill(checkNo)
  await tap(o, S.locator('[data-payment-save]'))
  const R = page.locator('[data-receipt-screen]')
  await R.waitFor({ timeout: 20000 })
  await until(async () => (await R.locator('[data-receipt-status]').getAttribute('data-receipt-status')) === 'saved', 20000)
  const status = await R.locator('[data-receipt-status]').getAttribute('data-receipt-status')
  expect(status === 'saved', `the receipt says ${status}, not saved`)
  const words = `$${amount} by check #${checkNo}, receipt ${await R.locator('[data-receipt-number]').getAttribute('data-receipt-number')}`
  const paidInFull = await R.locator('[data-receipt-paid-in-full]').isVisible().catch(() => false)
  await tap(o, R.locator('[data-receipt-done]'))
  return { words, paidInFull, amountCents: Math.round(Number(amount) * 100) }
}

/**
 * The office takes the deposit on the job page when the proposal asked one. A proposal asking 0% or none makes no
 * deposit invoice (D2, Oct 29 2026): then the Final must be the whole contract, and nothing is recorded.
 */
async function officeTakesDeposit(o, jobId, checkNo) {
  const s = await until(async () => { const x = await schedule(jobId); return x?.invoices?.length ? x : null }, 30000)
  expect(s, 'the job has no payment schedule')
  if (s.invoices.some(i => i.kind === 'deposit')) return (await officeTakesPayment(o, jobId, 'deposit', checkNo)).words
  const fin = s.invoices.find(i => i.kind === 'final')
  expect(fin && fin.amountCents === s.contractCents, `no deposit invoice, but the Final ($${(fin?.amountCents ?? 0) / 100}) is not the whole contract ($${s.contractCents / 100})`)
  const page = await go(o, `/operations?job=${jobId}`)
  await page.locator(`[data-payment-schedule="${jobId}"] [data-payment-received="final"]`).first().waitFor({ timeout: 40000 })
  expect(!(await page.locator(`[data-payment-schedule="${jobId}"] [data-payment-received="deposit"]`).count()), 'the job page offers a deposit the schedule does not have')
  return `no deposit: the proposal asks ${s.depositPct || 0}%, so the Final is the whole contract ($${s.contractCents / 100}) (D2)`
}

/** The office schedules the install on the Schedule page: the job dragged from Ready to schedule onto a day. */
async function officeSchedules(o, jobId) {
  // A crew day: Monday to Thursday. On a Friday, Saturday or Sunday night the job goes on today with
  // "The crew works weekends on this job", so the installer can do his part tonight (said in the result).
  const day = TODAY
  const page = await go(o, '/schedule')
  const card = page.locator(`[data-ready-job="${jobId}"]`)
  await card.waitFor({ timeout: 40000 })
  const month = TODAY.slice(0, 7)
  for (let i = 0; i < 3 && (await page.locator('[data-month]').getAttribute('data-month').catch(() => month)) !== month; i++) { await page.locator('[data-month-prev]').click().catch(() => {}); await sleep(200) }
  // The calendar shows crew days only; a day off has no square until "Show days off" is ticked (a Friday to Sunday night).
  if (!(await page.locator(`td[data-day="${day}"]`).count())) await page.locator('[data-show-days-off]').check()
  await card.dragTo(page.locator(`td[data-day="${day}"]`))
  const dlg = page.locator(`[data-schedule-install="${jobId}"]`)
  await dlg.locator('[data-si-save]').waitFor({ timeout: 15000 })
  expect((await dlg.locator('[data-si-start]').inputValue()) === day, `the Schedule install window opened on ${await dlg.locator('[data-si-start]').inputValue()}, not ${day}`)
  let plan = (await dlg.locator('[data-si-plan]').getAttribute('data-si-plan')) ?? ''
  let note = ''
  if (CREW_DAY(day)) {
    expect(plan.split(',').filter(Boolean).every(CREW_DAY), `the plan puts the crew on a day that is not Monday to Thursday: ${plan}`)
  } else {
    // Off day: never filled without the weekend tick (Friday only if Settings has it as a work day).
    expect(!plan.split(',').filter(Boolean).some(d => [0, 6].includes(dow(d))), `the plan puts the crew on a weekend day without the tick: ${plan}`)
    if (!plan.startsWith(day)) {
      await dlg.locator('[data-si-weekends]').check()
      await sleep(400)
      plan = (await dlg.locator('[data-si-plan]').getAttribute('data-si-plan')) ?? ''
      note = ` (today is ${DAY[dow(day)]}: booked with "The crew works weekends on this job" so the installer can work it tonight)`
    }
  }
  expect(plan.split(',')[0] === day, `the plan does not start ${day}: ${plan}`)
  await tap(o, dlg.locator('[data-si-save]'))
  await page.locator('[data-install-text-skip], [data-install-text-open]').first().waitFor({ timeout: 20000 }).catch(() => {})
  if (await page.locator('[data-install-text-skip]').count()) await tap(o, page.locator('[data-install-text-skip]'))
  const j = await until(async () => { const r = await jobRow(jobId); return r?.scheduledDate?.slice(0, 10) === day ? r : null }, 20000)
  expect(j, `the job is not scheduled on ${day} (${(await jobRow(jobId))?.scheduledDate})`)
  return `crew days ${plan}${note}; job ${j.status}`
}

/** The installer, on his phone: My installs, the crew packet (no prices), Start, then Finish the job. */
async function installerDoesTheInstall(i, jobId) {
  const page = await go(i, '/my-installs')
  const card = page.locator(`[data-installs-today] [data-install-card="${jobId}"]`)
  await card.waitFor({ timeout: 40000 })
  expect(!/\$\s?\d/.test(await card.innerText()), 'the installer\'s card shows a dollar amount')
  if (await card.locator('[data-install-packet-make]').count()) await tap(i, card.locator('[data-install-packet-make]'))
  await card.locator('[data-install-packet-open]').waitFor({ timeout: 30000 })
  const href = await card.locator('[data-install-packet-open]').getAttribute('href')
  const packet = await i.ctx.newPage(); watch(i, packet)
  await packet.goto(href.startsWith('http') ? href : `${APP}${href}`, { waitUntil: 'domcontentloaded' })
  await sleep(1500)
  const pt = await packet.locator('body').innerText()
  await packet.close()
  expect(pt.length > 200, 'the crew packet is empty')
  expect(!/\$\s?\d/.test(pt), `the crew packet shows a dollar amount: "${(pt.match(/.{0,40}\$\s?\d.{0,30}/) || [''])[0]}"`)
  await tap(i, card.locator('[data-install-start]'))
  const started = await until(async () => { const j = await jobRow(jobId); return j?.status === 'in_progress' ? j : null }, 20000)
  expect(started, `Start did not move the job to In Progress (${(await jobRow(jobId))?.status})`)
  await card.locator('[data-install-finish]').waitFor({ timeout: 15000 })
  // The last crew day (a one day job): "Finish the job". An earlier day of a longer job: the crew finished
  // early, "We finished the whole job".
  const whole = card.locator('[data-install-finish-whole]')
  const btn = (await whole.count()) ? whole : card.locator('[data-install-finish]')
  const finishText = await btn.innerText()
  const day = (await card.innerText()).match(/day \d+ of \d+/)?.[0]
  await tap(i, btn)
  const finished = await until(async () => (await card.innerText()).match(/finished the job|Job finished/i), 20000)
  expect(finished, `after "${finishText.trim()}" the card does not say the job is finished: ${(await card.innerText()).slice(0, 200)}`)
  return `packet without prices; Start: In Progress; ${day ? `${day}: ` : ''}"${finishText.trim()}"`
}

/** The installer walks the job with the homeowner on his phone: every item, the photos, our signature; the homeowner signs in person or on the link. */
async function installerWalksTheJob(i, c, jobId, { homeownerOnLink, homeowner }) {
  const page = await go(i, `/operations?job=${jobId}`)
  await page.waitForSelector('[data-walkthrough-panel]', { timeout: 40000 })
  if (await page.locator('[data-walkthrough-start]').count()) await tap(i, page.locator('[data-walkthrough-start]'))
  else if (await page.locator('[data-walkthrough-open]').count()) await tap(i, page.locator('[data-walkthrough-open]'))
  await page.waitForSelector('[data-walkthrough-screen="open"]', { timeout: 20000 })
  const ids = await page.locator('[data-wt-item]').evaluateAll(els => els.map(e => e.getAttribute('data-wt-item')))
  expect(ids.length >= 3, `the checklist has ${ids.length} items`)
  for (const id of ids) await tap(i, page.locator(`[data-wt-pass="${id}"]`))
  const slots = await page.locator('[data-wt-slot]').evaluateAll(els => els.map(e => e.getAttribute('data-wt-slot')))
  const colors = [[94, 40, 161], [21, 128, 61], [180, 83, 9], [30, 64, 175], [120, 30, 30], [10, 90, 90], [90, 90, 10], [60, 60, 60]]
  for (let k = 0; k < slots.length; k++) await page.locator(`[data-wt-file="slot-${slots[k]}"]`).setInputFiles(photo(`nightly-${slots[k].replace(':', '-')}`, colors[k % colors.length]))
  const up = await until(async () => (await page.locator('[data-wt-slot-state="uploaded"]').count()) === slots.length, 90000)
  expect(up, `${await page.locator('[data-wt-slot-state="uploaded"]').count()} of ${slots.length} required photos uploaded`)
  // Our representative.
  await tap(i, page.locator('[data-wt-role="Lead installer / Foreman"]'))
  await page.locator('[data-wt-sign-name="rep"]').fill('Nightly Foreman')
  await fingerSign(page, page.locator('[data-wt-sign="rep"] [data-wt-sigpad], [data-wt-sign="rep"] canvas').first())
  await tap(i, page.locator('[data-wt-sign-save="rep"]'))
  await page.waitForSelector('[data-wt-signed="rep"]', { timeout: 20000 })
  if (!homeownerOnLink) {
    // The homeowner signs on the installer's phone.
    const box = page.locator('[data-wt-sign="homeowner"]')
    await box.scrollIntoViewIfNeeded()
    await box.locator('[data-wt-sign-name="homeowner"]').fill(homeowner).catch(() => {})
    await fingerSign(page, box.locator('[data-wt-sigpad], canvas').first())
    await tap(i, page.locator('[data-wt-sign-save="homeowner"]'))
  } else {
    // The homeowner is not there: the link goes to their phone.
    await tap(i, page.locator('[data-walkthrough-screen] [data-wt-link-copy]'))
    await page.waitForSelector('[data-walkthrough-screen] [data-wt-link-url]', { timeout: 15000 })
    const link = (await page.locator('[data-walkthrough-screen] [data-wt-link-url]').innerText()).trim()
    const hp = await freshPage(c)
    await hp.goto(link.replace(/^https?:\/\/[^/]+/, APP), { waitUntil: 'domcontentloaded' })
    await hp.locator('#name').fill(homeowner)
    await fingerSign(hp, hp.locator('#sig'))
    await hp.locator('#go').tap()
    await hp.waitForSelector('text=This page is now read only', { timeout: 20000 })
  }
  const w = await until(async () => { const r = (await owner('GET', `/api/walkthroughs?jobId=${jobId}`)).json?.data; return r?.status === 'completed' ? r : null }, 30000)
  expect(w, `the walkthrough is not finished (${JSON.stringify((await owner('GET', `/api/walkthroughs?jobId=${jobId}`)).json?.data?.missing ?? '')})`)
  return `${ids.length} items passed, ${slots.length} photos, signed by us and ${homeownerOnLink ? 'the homeowner on the link' : 'the homeowner on this phone'}`
}

/** After the last of the three (crew finished, walkthrough signed, paid in full): Complete, then Paid, the card Paid & Closed, by itself. */
async function closesItself(jobId, contactId) {
  const j = await until(async () => { const r = await jobRow(jobId); return r?.status === 'paid' ? r : null }, 30000)
  const now = await jobRow(jobId)
  expect(j, `the job did not close itself to Paid (it is ${now?.status} / ${now?.opsStage})`)
  const card = await until(async () => { const l = await cardOf(contactId); return l?.stage === 'Paid & Closed' ? l : null }, 20000)
  expect(card, `its card is in ${(await cardOf(contactId))?.stage}, not Paid & Closed`)
  return `job ${j.status} (completed ${j.completedDate ?? '?'}, ${j.completedBy ?? ''}); card Paid & Closed`
}

// ════════════════════════════════════════════════════════════════════════════
// Clean up: everything named NIGHTLY (this run's and any an earlier run left), dev copy only
// ════════════════════════════════════════════════════════════════════════════
async function cleanUp() {
  const db = sql('SELECT current_database()')
  if (db !== DB) throw new Error(`cleanup refused: psql opened ${db}`)
  const contacts = sql(`SELECT id FROM "CrmContact" WHERE "firstName" = 'NIGHTLY' OR "lastName" LIKE 'NIGHTLY %'`).split('\n').filter(Boolean)
  for (const id of made.contacts) if (!contacts.includes(id)) contacts.push(id)
  const inC = contacts.length ? contacts.map(lit).join(',') : "''"
  const quotes = sql(`SELECT id FROM "SavedQuote" WHERE "crmContactId" IN (${inC}) OR "customerName" LIKE 'NIGHTLY %'`).split('\n').filter(Boolean)
  for (const id of made.quotes) if (!quotes.includes(id)) quotes.push(id)
  const inQ = quotes.length ? quotes.map(lit).join(',') : "''"
  const jobs = sql(`SELECT id FROM "SavedJob" WHERE "crmContactId" IN (${inC}) OR "quoteId" IN (${inQ}) OR "customerName" LIKE 'NIGHTLY %'`).split('\n').filter(Boolean)
  for (const id of made.jobs) if (!jobs.includes(id)) jobs.push(id)
  const inJ = jobs.length ? jobs.map(lit).join(',') : "''"
  // Files first (media, signed documents, walkthrough certificates), then the rows.
  try {
    const files = sql(`SELECT path FROM "MediaItem" WHERE "jobId" IN (${inJ}) OR "customerId" IN (${inC}) UNION ALL SELECT "certificatePath" FROM "Walkthrough" WHERE "jobId" IN (${inJ}) AND "certificatePath" IS NOT NULL`).split('\n').filter(Boolean)
    for (const f of files) if (/\/uploads\//.test(f)) fs.rmSync(f, { force: true })
  } catch (e) { console.error('cleanup files:', String(e).slice(0, 200)) }
  const stmts = [
    `DELETE FROM "PaymentApplication" WHERE "paymentId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" IN (${inJ}) OR "quoteId" IN (${inQ}))`,
    `DELETE FROM "Receipt" WHERE "jobId" IN (${inJ}) OR "crmContactId" IN (${inC})`,
    `DELETE FROM "BillingLog" WHERE "jobId" IN (${inJ})`,
    `DELETE FROM "ContractPayment" WHERE "jobId" IN (${inJ}) OR "quoteId" IN (${inQ})`,
    `DELETE FROM "ContractInvoice" WHERE "jobId" IN (${inJ}) OR "quoteId" IN (${inQ})`,
    `DELETE FROM "ContractAdjustment" WHERE "jobId" IN (${inJ})`,
    `DELETE FROM "PaymentSchedule" WHERE "jobId" IN (${inJ}) OR "quoteId" IN (${inQ})`,
    `DELETE FROM "WalkthroughPunchItem" WHERE "jobId" IN (${inJ})`,
    `DELETE FROM "Walkthrough" WHERE "jobId" IN (${inJ})`,
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
    `DELETE FROM "Notification" WHERE "jobId" IN (${inJ}) OR title LIKE '%NIGHTLY %' OR body LIKE '%NIGHTLY %'`,
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
  // The cards (through the pipeline, with its version) and the customers.
  for (let k = 0; k < 4; k++) {
    const pipe = (await owner('GET', '/api/pipeline')).json?.data
    const mine = (pipe?.leads ?? []).filter(l => contacts.includes(l.customerId) || made.cards.has(l.id) || l.firstName === 'NIGHTLY').map(l => l.id)
    if (!mine.length) break
    const r = await owner('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pipe.version })
    if (r.status === 200) break
    await sleep(800)
  }
  for (const id of contacts) await owner('DELETE', `/api/crm-contacts/${id}`).catch(() => {})
  try { sql(`DELETE FROM "CrmContact" WHERE id IN (${inC})`) } catch (e) { problems.push(`contacts: ${String(e.stderr ?? e).split('\n')[0].slice(0, 120)}`) }
  // The logins (this run's and any earlier nightly one).
  const users = (await owner('GET', '/api/crm-auth/users')).json?.data ?? []
  for (const u of users.filter(x => made.users.includes(x.email) || /^nightly-[a-z-]+-[0-9a-f]{6}@example\.invalid$/.test(x.email))) await owner('DELETE', `/api/crm-auth/users/${u.id}`).catch(() => {})
  const left = Number(sql(`SELECT (SELECT count(*) FROM "CrmContact" WHERE "firstName" = 'NIGHTLY') + (SELECT count(*) FROM "SavedJob" WHERE id IN (${inJ})) + (SELECT count(*) FROM "SavedQuote" WHERE id IN (${inQ}))`))
  return { contacts: contacts.length, quotes: quotes.length, jobs: jobs.length, left, problems }
}

// ════════════════════════════════════════════════════════════════════════════
// The run
// ════════════════════════════════════════════════════════════════════════════
let exitCode = 0
try {
  chrome = await chromium.launch()
  safari = await webkit.launch()
  const me = await owner('GET', '/api/crm-auth/me')
  if (me.status !== 200) throw new Error(`the owner token does not work on ${API} (${me.status})`)

  let office, sales, crew, O, S, I, J, C
  const ok = await step('setup', 'Leftovers from an earlier run removed; test logins made (Office, Salesman, Installer)', null, async () => {
    const before = await cleanUp()
    office = await invite('office_staff', 'Office')
    sales = await invite('sales_rep', 'Salesman')
    crew = await invite('field_crew', 'Installer')
    O = await device(office, 'computer')
    S = await device(sales, 'phone')
    I = await device(crew, 'phone')
    J = await device({ role: 'owner', token: OWNER }, 'phone')
    C = await device(null, 'phone')
    return `removed ${before.contacts} old test customers; 3 logins`
  })
  if (!ok) { for (const j of ['A', 'B', 'C']) blocked.add(j) }

  // ── Job A: white vinyl, no dig ──
  if (ONLY.has('A')) {
    const A = {}
    await step('A', 'Office adds the lead (Sales Pipeline, + New lead)', O, async () => {
      Object.assign(A, await officeAddsLead(O, 'NIGHTLY', `${TODAY} Vinyl Nodig`, '3525550101', /website|phone call/i))
      return `${A.name}, card in ${A.stage}, source ${A.source}`
    })
    await step('A', 'Office books the Salesman\'s site visit (customer page, Book)', O, async () => {
      const page = await go(O, `/customers/${A.contactId}`)
      await tap(O, page.locator('[data-book-appointment]').first())
      const dlg = page.locator('[data-booking-dialog]')
      await dlg.waitFor({ timeout: 15000 })
      const person = dlg.locator('[data-field="person"]')
      const opts = await person.locator('option').evaluateAll(els => els.map(e => ({ v: e.value, t: e.textContent })))
      const hers = opts.find(x => x.v === sales.userId) ?? opts.find(x => /Salesman/.test(x.t))
      expect(hers, `the Salesman is not in the booking window's people (${opts.map(x => x.t).join(', ')})`)
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
      const appt = await until(async () => ((await owner('GET', '/api/appointments')).json?.data ?? (await owner('GET', '/api/appointments')).json ?? []).find(a => a.crmContactId === A.contactId), 15000)
      expect(appt, 'the visit did not reach the server')
      A.appt = appt
      const card = await until(async () => { const l = await cardOf(A.contactId); return l?.stage === 'Appointment' ? l : null }, 15000)
      expect(card, `the card did not move to Appointment (${(await cardOf(A.contactId))?.stage})`)
      // She is at the house now: the visit moves to this minute (as if it had been booked for tonight).
      const start = new Date(Date.now() - 60_000)
      const moved = await call(office.token, 'PATCH', `/api/appointments/${appt.id}`, { startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), baseVersion: appt.version, reason: 'Nightly check: the visit is now' })
      expect(moved.status === 200, `moving the visit to now: ${moved.status} ${moved.text.slice(0, 150)}`)
      return `booked with ${hers.t} on ${new Date(appt.startAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}; card in Appointment`
    })
    await step('A', 'Salesman at the visit: Today, Complete, "Ready to quote" (phone)', S, async () => {
      const page = await go(S, '/today')
      await page.locator('[data-next-appointment]').waitFor({ timeout: 30000 })
      const next = await page.locator('[data-next-name]').innerText()
      expect(next.includes('NIGHTLY'), `her Today shows "${next}" as the next visit, not the NIGHTLY customer`)
      await tap(S, page.locator('[data-complete]'))
      await tap(S, page.locator('[data-outcome="ready_to_quote"]'))
      await page.locator('[data-feet]').fill('430')
      await tap(S, page.locator('[data-save-outcome]'))
      await page.locator('[data-quote-builder]').waitFor({ timeout: 30000 })
      const done = await until(async () => { const a = ((await owner('GET', '/api/appointments')).json?.data ?? []).find(x => x.id === A.appt.id); return a?.outcome === 'ready_to_quote' ? a : null }, 15000)
      expect(done, 'the visit\'s outcome was not saved')
      return 'the quote builder opened on the customer'
    })
    await step('A', 'Salesman draws the yard, picks white vinyl no dig, saves the quote (phone)', S, async () => {
      const b = S.page.locator('[data-quote-builder]')
      const style = await drawBackyard(S, b, /White Vinyl Privacy, 6 ft tall.*No dig/i)
      const { quote, shownCents } = await saveQuote(S, A.contactId)
      A.quote = quote
      expect(/WV/.test(quote.fenceStyle) && /ND/.test(quote.fenceStyle), `the quote's style is ${quote.fenceStyle}`)
      expect(Number.isFinite(shownCents) ? Math.abs(Math.round(quote.finalPrice * 100) - shownCents) <= 100 : true, `the price shown ($${shownCents / 100}) is not the price saved ($${quote.finalPrice})`)
      return `${style}: ${quote.sections} sections, $${quote.finalPrice.toLocaleString('en-US')}`
    })
    await step('A', 'Salesman copies the proposal link (quote window)', S, async () => {
      const page = await go(S, `/quotes?qv=${A.quote.id}`)
      A.link = await copyProposalLink(S, A.quote.id)
      return 'quote Sent'
    })
    await step('A', 'Customer opens the proposal on their phone and signs', C, async () => {
      A.job = await customerSignsProposal(C, A.link, A.quote.id, 'Pat Nightly', /no dig/i)
      expect(/ND/.test(A.job.fenceStyle ?? ''), `the job's style is ${A.job.fenceStyle}, not the no dig fence quoted`)
      const card = await until(async () => { const l = await cardOf(A.contactId); return /Signed/i.test(l?.stage ?? '') ? l : null }, 15000)
      expect(card, `the card is in ${(await cardOf(A.contactId))?.stage}, not a Signed stage`)
      return `job made (${A.job.status}); card in ${card.stage}`
    })
    await step('A', 'Office takes the deposit (job page, Payment received)', O, async () => {
      return officeTakesDeposit(O, A.job.id, '2101')
    })
    await step('A', 'Office adds the 811 ticket and the permit (job page)', O, async () => {
      const page = await go(O, `/operations?job=${A.job.id}`)
      await page.locator('[data-locate-edit]').waitFor({ timeout: 30000 })
      await tap(O, page.locator('[data-locate-edit]'))
      await page.locator('[data-locate-input="ticket"]').fill('362610001')
      await page.locator('[data-locate-input="called"]').fill(plus(TODAY, -3))
      await page.locator('[data-locate-input="good"]').fill(plus(TODAY, -1))
      await page.locator('[data-locate-input="exp"]').fill(plus(TODAY, 25))
      await tap(O, page.locator('[data-locate-save]'))
      const clear = await until(async () => (await page.locator('[data-job-locate]').getAttribute('data-job-locate')) === 'clear', 15000)
      expect(clear, `811 is ${await page.locator('[data-job-locate]').getAttribute('data-job-locate')}, not Clear to dig`)
      const panel = page.locator(`[data-permit-panel="${A.job.id}"]`)
      await panel.scrollIntoViewIfNeeded()
      await panel.locator('[data-permit-status]').selectOption('approved')
      await panel.locator('[data-permit-number]').fill(`NIGHTLY-${stamp}`)
      await tap(O, panel.locator('[data-permit-save]'))
      const permit = await until(async () => (await page.locator('[data-milestone="permit"]').getAttribute('data-milestone-done')) === 'yes', 15000)
      expect(permit, 'Permit Approved is not done after saving the permit as Approved')
      return '811 Clear to dig; permit Approved'
    })
    await step('A', 'Office schedules the install on a crew day (Schedule, Ready to schedule)', O, () => officeSchedules(O, A.job.id))
    await step('A', 'Installer: crew packet (no prices), Start, Finish the job (phone)', I, () => installerDoesTheInstall(I, A.job.id))
    await step('A', 'Installer walks the job with the homeowner; both sign on his phone', I, () => installerWalksTheJob(I, C, A.job.id, { homeownerOnLink: false, homeowner: 'Pat Nightly' }))
    await step('A', 'Office takes the final payment (job page)', O, async () => {
      const r = await officeTakesPayment(O, A.job.id, 'final', '2102')
      expect(r.paidInFull, 'the receipt does not say Paid in full')
      return r.words
    })
    await step('A', 'The job closes itself: Complete, then Paid; card Paid & Closed', null, () => closesItself(A.job.id, A.contactId))
  }

  // ── Job B: 4 ft chain link, dig set, two change orders ──
  if (ONLY.has('B')) {
    const B = {}
    await step('B', 'Office adds the lead (Sales Pipeline, + New lead)', O, async () => {
      // The Salesman sees only the Salesman's own and assigned customers (lib/salesScope.ts, Oct 28 2026). The office's
      // entry starts on the owner (D4, Oct 29 2026) and only the owner moves a Salesman once saved, so the office gives
      // the lead to the Salesman on Add lead (the Salesman choice), not on the Assign screen afterwards.
      Object.assign(B, await officeAddsLead(O, 'NIGHTLY', `${TODAY} Chain Link Digset`, '3525550102', /phone call|referral/i, sales.name))
      return `${B.name}, card in ${B.stage}, Salesman ${sales.name}`
    })
    await step('B', 'The Salesman has the lead the office gave her (her customer list)', S, async () => {
      // (No GET of one customer by id exists; the database has it.)
      const rep = await until(async () => sql(`SELECT coalesce("salesRep", '') FROM "CrmContact" WHERE id = ${lit(B.contactId)}`) || null, 10000)
      expect(rep === sales.name, `the customer's Salesman is ${rep || 'none'}, not ${sales.name}`)
      const mine = await until(async () => { const l = (await call(sales.token, 'GET', '/api/crm-contacts')).json?.data; return Array.isArray(l) && l.some(x => x.id === B.contactId) ? l : null }, 15000)
      expect(mine, 'the customer is not on the Salesman\'s list after the office gave it to her')
      return `Salesman ${rep}; on her list`
    })
    await step('B', 'Salesman quotes from the card: the yard, 4 ft chain link dig set, saved (phone)', S, async () => {
      const page = await go(S, `/pipeline?card=${encodeURIComponent(B.cardId)}`)
      await tap(S, page.locator('[data-card-new-quote]').first())
      const b = page.locator('[data-quote-builder]')
      await b.waitFor({ timeout: 20000 })
      const style = await drawBackyard(S, b, /chain link.*4 ft.*dig set|4 ft.*chain link.*dig set|chain link.*4'.*dig/i)
      const { quote } = await saveQuote(S, B.contactId)
      B.quote = quote
      expect(/CL/i.test(quote.fenceStyle) || /chain/i.test(quote.fenceStyle), `the quote's style is ${quote.fenceStyle}`)
      return `${style}: $${quote.finalPrice.toLocaleString('en-US')}`
    })
    await step('B', 'Salesman copies the proposal link; the customer signs on their phone', S, async () => {
      await go(S, `/quotes?qv=${B.quote.id}`)
      B.link = await copyProposalLink(S, B.quote.id)
      B.job = await customerSignsProposal(C, B.link, B.quote.id, 'Lee Nightly', /galvanized|chain link/i)
      expect(Math.round((B.job.contractValue ?? B.job.quotePrice ?? 0)) === Math.round(B.quote.finalPrice), `the job's contract ($${B.job.contractValue}) is not the price quoted ($${B.quote.finalPrice})${B.job.chose ? `; the customer picked "${B.job.chose}"` : ''}`)
      return `job made (${B.job.status})${B.job.chose ? `, picked "${B.job.chose}"` : ''}`
    })
    await step('B', 'Office takes the deposit (job page)', O, () => officeTakesDeposit(O, B.job.id, '2201'))
    await step('B', 'Salesman makes a change order on her sold quote: it waits for the OK (phone)', S, async () => {
      const page = await go(S, `/pipeline?card=${encodeURIComponent(B.cardId)}`)
      await tap(S, page.locator(`[data-card-quote="${B.quote.id}"]`).first())
      await page.locator('[data-quote-drawer]').waitFor({ timeout: 20000 })
      await tap(S, page.locator('[data-quote-change-orders] [data-co-button]').first())
      // A quote with a yard drawing opens on the drawing; "Type the change instead" is there. Otherwise a menu.
      const typed = page.locator('[data-co-from-lines], [data-co-type-instead]').first()
      await typed.waitFor({ timeout: 30000 })
      await tap(S, typed)
      if (await page.locator('[data-co-from-lines]').count() && !(await page.locator('[data-co-modal]').count())) await tap(S, page.locator('[data-co-from-lines]'))
      await page.locator('[data-co-modal]').waitFor({ timeout: 10000 })
      await page.locator('[data-co-line-description]').first().fill('Add a 4 ft walk gate by the driveway')
      await page.locator('[data-co-line-amount]').first().fill('350')
      if (await page.locator('[data-co-reason]').count()) await page.locator('[data-co-reason]').fill('Customer wants a gate to the driveway')
      const saveText = await page.locator('[data-co-save-draft]').innerText()
      expect(/office to OK/i.test(saveText), `the save button says "${saveText}", not that it goes to the office to OK`)
      await tap(S, page.locator('[data-co-save-draft]'))
      const co = await until(async () => (await changeOrders(B.quote.id)).find(x => x.number === 1), 15000)
      expect(co?.status === 'needs_ok', `her change order is ${co?.status ?? 'not saved'}, not waiting for the OK`)
      B.co1 = co
      return `CO-1 +$350, waiting for the OK`
    })
    await step('B', 'Office OKs her change order on the job page (computer)', O, async () => {
      const page = await go(O, `/operations?job=${B.job.id}`)
      await page.locator('[data-co-row="1"] [data-co-ok]').waitFor({ timeout: 30000 })
      await tap(O, page.locator('[data-co-row="1"] [data-co-ok]'))
      const r = await until(async () => { const x = (await changeOrders(B.quote.id)).find(c => c.number === 1); return x?.status === 'draft' ? x : null }, 15000)
      expect(r, 'CO-1 is not ready to sign after the OK')
      return 'CO-1 OK\'d: ready for the customer to sign'
    })
    await step('B', 'The customer signs CO-1 on the Salesman\'s phone', S, async () => {
      const page = await go(S, `/pipeline?card=${encodeURIComponent(B.cardId)}`)
      const btn = page.locator('[data-card-co-list] [data-co-sign-here]').first()
      await btn.waitFor({ timeout: 30000 })
      await tap(S, btn)
      await page.locator('[data-co-sign-sheet]').waitFor({ timeout: 15000 })
      const sheet = await page.locator('[data-co-sign-sheet]').innerText()
      expect(!/\bcost\b|margin/i.test(sheet), 'the signing sheet shows a cost or margin')
      await page.locator('[data-co-sign-name]').fill('Lee Nightly')
      await page.locator('[data-co-sign-name]').blur()
      await fingerSign(page, page.locator('[data-co-sign-sheet] canvas'))
      await tap(S, page.locator('[data-co-sign-submit]'))
      const r = await until(async () => { const x = (await changeOrders(B.quote.id)).find(c => c.number === 1); return x?.status === 'approved' ? x : null }, 20000)
      expect(r, `CO-1 is ${(await changeOrders(B.quote.id)).find(c => c.number === 1)?.status}, not signed`)
      B.co1 = r
      return `CO-1 signed, contract rev ${r.contractRev}`
    })
    await step('B', 'Jonathan makes a change order from the job\'s drawing (+10 ft on the back), the customer signs it (phone)', J, async () => {
      const page = await go(J, `/operations?job=${B.job.id}`)
      await page.waitForSelector('[data-co-panel]', { timeout: 40000 })
      const coBtn = page.locator(`[data-co-button="${B.quote.id}"]`).first()
      await tap(J, coBtn)
      if (await page.locator('[data-co-from-drawing-start]').count()) await tap(J, page.locator('[data-co-from-drawing-start]'))
      await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 30000 }); await sleep(1200)
      await tap(J, page.locator('[data-plan-label="Back"]').first())
      await page.waitForSelector('[data-ftin-pad]', { timeout: 10000 })
      for (const d of '160') await tap(J, page.locator(`[data-ftin-pad] [data-pad-key="${d}"]`))
      await tap(J, page.locator('[data-ftin-pad] [data-pad-action]'))
      await page.waitForSelector('[data-co-modal]', { timeout: 15000 })
      const line = await page.locator('[data-co-line-description]').first().inputValue()
      expect(/Add 10 ft/.test(line), `the change order says "${line}", not "Add 10 ft"`)
      await tap(J, page.locator('[data-co-reason]'))
      await page.keyboard.type('Customer wants the back 10 ft longer')
      await tap(J, page.locator('[data-co-save-draft]'))
      const co2 = await until(async () => (await changeOrders(B.quote.id)).find(c => c.number === 2), 15000)
      expect(co2, 'CO-2 was not saved')
      const p2 = await go(J, `/operations?job=${B.job.id}`)
      await p2.waitForSelector('[data-co-row="2"] [data-co-sign-here]', { timeout: 30000 })
      await tap(J, p2.locator('[data-co-row="2"] [data-co-sign-here]'))
      await p2.waitForSelector('[data-co-sign-sheet]', { timeout: 10000 })
      await p2.locator('[data-co-sign-name]').fill('Lee Nightly')
      await p2.locator('[data-co-sign-name]').blur()
      await fingerSign(p2, p2.locator('[data-co-sign-sheet] canvas'))
      await tap(J, p2.locator('[data-co-sign-submit]'))
      const r = await until(async () => { const x = (await changeOrders(B.quote.id)).find(c => c.number === 2); return x?.status === 'approved' ? x : null }, 20000)
      expect(r, `CO-2 is ${(await changeOrders(B.quote.id)).find(c => c.number === 2)?.status}, not signed`)
      B.co2 = r
      return `CO-2 "${line}" $${(r.totalCents / 100).toFixed(2)}, signed, contract rev ${r.contractRev}`
    })
    await step('B', 'The contract is the quote plus both change orders (job and payment schedule)', null, async () => {
      const want = Math.round(B.quote.finalPrice * 100) + B.co1.totalCents + B.co2.totalCents
      const j = await until(async () => { const r = await jobRow(B.job.id); return Math.round((r?.contractValue ?? 0) * 100) === want ? r : null }, 15000)
      const s = await schedule(B.job.id)
      expect(j, `the job's contract is $${((await jobRow(B.job.id))?.contractValue ?? 0).toFixed(2)}, not $${(want / 100).toFixed(2)}`)
      expect(!s || s.contractCents === want, `the payment schedule's contract is ${s?.contractCents}, not ${want}`)
      return `$${(want / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} = quote $${B.quote.finalPrice} + CO-1 $${B.co1.totalCents / 100} + CO-2 $${B.co2.totalCents / 100}`
    })
  }

  // ── Job C: a walk-in repair ──
  if (ONLY.has('C')) {
    const R = {}
    await step('C', 'Office adds the walk-in (Sales Pipeline, + New lead, Walk-in)', O, async () => {
      Object.assign(R, await officeAddsLead(O, 'NIGHTLY', `${TODAY} Repair Walkin`, '3525550103', /walk/i))
      expect(/walk/i.test(R.source), `no Walk-in lead source to pick (picked ${R.source})`)
      return `${R.name}, source ${R.source}`
    })
    await step('C', 'Office quotes the repair: Repair, a leaning fence, 2 posts and a gate (computer)', O, async () => {
      const page = await go(O, `/pipeline?card=${encodeURIComponent(R.cardId)}`)
      await tap(O, page.locator('[data-card-new-quote]').first())
      const b = page.locator('[data-quote-builder]')
      await b.waitFor({ timeout: 20000 })
      await tap(O, b.locator('[data-step="style"]'))
      await tap(O, b.locator('[data-job-type-option="repair"]'))
      await pickStyle(b, /White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig/i)
      await tap(O, b.locator('[data-what="leaning"]'))
      if (await b.locator('[data-repair-starter-add]').count()) await tap(O, b.locator('[data-repair-starter-add]'))
      await tap(O, b.locator('[data-repair-item="resetPost"] button[aria-label^="One more"]'))
      await tap(O, b.locator('[data-repair-item="rehangGate"] button[aria-label^="One more"]'))
      const { quote } = await saveQuote(O, R.contactId)
      R.quote = quote
      expect(quote.work?.type === 'repair', `the quote is not a repair (${quote.work?.type})`)
      return `repair, $${quote.finalPrice.toLocaleString('en-US')}`
    })
    await step('C', 'Office sends it (Send anyway: no photos at the counter); the customer signs at the counter', O, async () => {
      await go(O, `/quotes?qv=${R.quote.id}`)
      R.link = await copyProposalLink(O, R.quote.id, { sendAnyway: 'Walk-in: the customer showed the damage on their phone at the counter' })
      R.job = await customerSignsProposal(C, R.link, R.quote.id, 'Sam Nightly')
      return `job made (${R.job.status})`
    })
    await step('C', 'Office schedules the repair on a crew day (Schedule)', O, () => officeSchedules(O, R.job.id))
    await step('C', 'Installer: packet (no prices), Start, Finish (phone)', I, () => installerDoesTheInstall(I, R.job.id))
    await step('C', 'Installer walks it; the homeowner signs on the link on their own phone', I, () => installerWalksTheJob(I, C, R.job.id, { homeownerOnLink: true, homeowner: 'Sam Nightly' }))
    await step('C', 'Office takes the payment in full (job page)', O, async () => {
      const words = []
      for (let k = 0; k < 3; k++) {
        const s = await schedule(R.job.id)
        const open = ['deposit', 'progress', 'final'].find(w => (s?.invoices ?? []).some(inv => inv.kind === w && inv.balanceCents > 0)) ?? (k === 0 ? 'deposit' : 'final')
        const r = await officeTakesPayment(O, R.job.id, open, `230${k + 1}`)
        words.push(`${open}: ${r.words}`)
        if (r.paidInFull) return words.join('; ')
      }
      throw new StepFail(`not paid in full after ${words.length} payments: ${words.join('; ')}`)
    })
    await step('C', 'The repair closes itself: Paid; card Paid & Closed', null, () => closesItself(R.job.id, R.contactId))
  }

  await step('end', 'No page errors in any browser', null, async () => {
    expect(pageErrors.length === 0, pageErrors.slice(0, 4).join(' | '))
    return ''
  })
} catch (e) {
  steps.push({ job: 'run', step: 'The run finished', role: 'system', device: '', status: 'fail', ms: 0, detail: String(e?.stack ?? e).slice(0, 600), screenshot: null })
  console.log(`FAIL  the run did not finish: ${String(e?.message ?? e).slice(0, 300)}`)
} finally {
  if (!KEEP) {
    const t0 = Date.now()
    try {
      const r = await cleanUp()
      const ok = r.left === 0 && !r.problems.length
      steps.push({ job: 'end', step: 'Everything the run made is removed', role: 'system', device: '', status: ok ? 'pass' : 'fail', ms: Date.now() - t0, detail: ok ? `${r.contacts} customers, ${r.quotes} quotes, ${r.jobs} jobs, the logins` : `${r.left} left; ${r.problems.join(' | ')}`, screenshot: null })
      console.log(`${ok ? 'PASS' : 'FAIL'}  [end] Everything the run made is removed${ok ? '' : `  -- ${r.left} left; ${r.problems.join(' | ')}`}`)
    } catch (e) {
      steps.push({ job: 'end', step: 'Everything the run made is removed', role: 'system', device: '', status: 'fail', ms: Date.now() - t0, detail: String(e).slice(0, 300), screenshot: null })
      console.log(`FAIL  cleanup: ${String(e).slice(0, 300)}`)
    }
  } else console.log('KEEP=1: what the run made is left on the dev copy')
  await chrome?.close().catch(() => {}); await safari?.close().catch(() => {})
  const failed = steps.filter(s => s.status === 'fail').length
  const skipped = steps.filter(s => s.status === 'skip').length
  const passed = steps.filter(s => s.status === 'pass').length
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped (${((Date.now() - Date.parse(startedAt)) / 60000).toFixed(1)} min)`)
  if (RESULTS) fs.writeFileSync(RESULTS, JSON.stringify({ suite: 'nightly-walkthrough', app: APP, startedAt, finishedAt: new Date().toISOString(), passed, failed, skipped, steps }, null, 2))
  exitCode = failed ? 1 : 0
}
process.exit(exitCode)
