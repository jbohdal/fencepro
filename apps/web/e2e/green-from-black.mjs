// "Price may be low" on a green chain link quote (Jonathan, Oct 27 2026: "Any part still priced from Black
// shows a warning on the quote so the salesman knows it's low"). Each step as the person who does it:
//   office    adds the lead on a computer (Chromium)
//   salesman  quotes it from the card on her iPhone (WebKit, 390 x 844): the yard, then Green Chain Link 4 ft
//             No dig (no part from Black once the green prices are in: no warning), then Dig set (its posts are
//             still priced from Black: the warning in the Style and Price steps, naming them), saves it and
//             copies the proposal link
//   customer  opens the proposal on her phone (no login): no warning, no "Black", no cost words
//
// Run (dev copy only; a server serving the built app):
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4089 E2E_ACCESS_TOKEN_FILE=<dev owner token file> SHOTS=<folder> node e2e/green-from-black.mjs
// Makes its own logins and customer (GREENCHECK ..., @example.invalid) and removes them at the end.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit, devices } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const OWNER = process.env.E2E_ACCESS_TOKEN || (process.env.E2E_ACCESS_TOKEN_FILE ? fs.readFileSync(process.env.E2E_ACCESS_TOKEN_FILE, 'utf8').trim() : '')
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, never port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN or E2E_ACCESS_TOKEN_FILE (apps/portal/scripts/dev-session-token.ts).'); process.exit(2) }
const DB = 'ezbiz_dev'
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const sql = q => execFileSync('psql', ['-d', DB, '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`
async function until(fn, ms = 20000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'X-Staff-Request': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await r.text()
  let json = {}; try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: r.status, json, text }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
const stamp = crypto.randomBytes(3).toString('hex')
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
const made = { users: [], contacts: new Set(), cards: new Set(), quotes: new Set() }
const results = []
let failed = 0
const check = (ok, msg) => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) failed++ }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }).catch(() => {}) }

async function invite(role, label) {
  const email = `greencheck-${role.replace('_', '-')}-${stamp}@example.invalid`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'GREENCHECK', lastName: `${TODAY} ${label}`, email, role })
  if (!inv.json?.data?.inviteUrl) throw new Error(`invite ${role}: ${inv.status} ${inv.text.slice(0, 200)}`)
  made.users.push(email)
  const password = `Gc-${crypto.randomBytes(9).toString('base64url')}`
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: new URL(inv.json.data.inviteUrl).searchParams.get('token'), email, password })
  if (!acc.json?.data?.accessToken) throw new Error(`accept invite ${role}: ${acc.status} ${acc.text.slice(0, 200)}`)
  const me = await call(acc.json.data.accessToken, 'GET', '/api/crm-auth/me')
  return { role, email, password, token: acc.json.data.accessToken, userId: me.json?.data?.id ?? null }
}

let chrome, safari
async function device(login, kind) {
  const phone = kind !== 'computer'
  const ctx = phone ? await safari.newContext({ ...devices['iPhone 13'] }) : await chrome.newContext({ viewport: { width: 1440, height: 900 } })
  if (login) {
    const r = await ctx.request.post(`${API}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1' }, data: { email: login.email, password: login.password, cookie: true } })
    if (!r.ok()) throw new Error(`${login.role} sign in: ${r.status()} ${(await r.text()).slice(0, 200)}`)
  }
  const page = await ctx.newPage()
  page.on('dialog', d => d.accept().catch(() => {}))
  return { ctx, page, phone }
}
async function go(who, p) {
  await who.page.close().catch(() => {})
  who.page = await who.ctx.newPage()
  who.page.on('dialog', d => d.accept().catch(() => {}))
  await who.page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' })
  await who.page.waitForSelector(who.phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 45000 })
  await sleep(1500)
  return who.page
}
const tap = async (who, loc) => {
  await who.page.evaluate(() => document.activeElement?.blur?.()).catch(() => {})
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  await loc.waitFor({ state: 'visible', timeout: 20000 })
  if (who.phone) await loc.tap(); else await loc.click()
  await sleep(300)
}

async function officeAddsLead(o, first, last, phone) {
  const page = await go(o, '/pipeline')
  await page.waitForSelector('[data-kanban-col]', { timeout: 45000 }); await sleep(800)
  await tap(o, page.locator('button:has-text("+ New lead")').first())
  await page.locator('[data-lead-field="first-name"]').fill(first)
  await page.locator('[data-lead-field="last-name"]').fill(last)
  await page.locator('[data-lead-field="phone"]').fill(phone)
  await page.locator('[data-lead-field="email"]').fill(`greencheck-${stamp}@example.invalid`)
  await page.locator('[data-lead-field="street"]').fill('110 SE Watula Ave')
  await page.keyboard.press('Escape').catch(() => {})
  await page.locator('[data-lead-field="city"]').fill('Ocala')
  await tap(o, page.locator('[data-lead-add]'))
  const card = await until(async () => ((await owner('GET', '/api/pipeline')).json?.data?.leads ?? []).find(l => l.firstName === first && l.lastName === last && l.customerId), 20000)
  if (!card) throw new Error('the lead did not reach the server')
  made.contacts.add(card.customerId); made.cards.add(card.id)
  return card
}

async function pickStyle(b, pattern) {
  const sel = b.locator('[data-style-list]').first()
  await sel.waitFor({ timeout: 15000 })
  const opts = await sel.locator('option').allInnerTexts()
  const label = opts.find(o => pattern.test(o))
  if (!label) throw new Error(`no fence style like ${pattern} (${opts.filter(o => /chain/i.test(o)).join(' | ')})`)
  await sel.selectOption({ label })
  await sleep(800)
  return label
}

async function cleanUp() {
  if (sql('SELECT current_database()') !== DB) throw new Error('cleanup refused: not the dev copy')
  const contacts = [...made.contacts]
  const inC = contacts.length ? contacts.map(lit).join(',') : "''"
  const quotes = [...new Set([...made.quotes, ...sql(`SELECT id FROM "SavedQuote" WHERE "crmContactId" IN (${inC})`).split('\n').filter(Boolean)])]
  const inQ = quotes.length ? quotes.map(lit).join(',') : "''"
  for (const s of [
    `DELETE FROM "ProposalView" WHERE "quoteId" IN (${inQ}) OR "crmContactId" IN (${inC})`,
    `DELETE FROM "QuoteOption" WHERE "quoteId" IN (${inQ})`,
    `DELETE FROM "JobQuotedCost" WHERE "quoteId" IN (${inQ})`,
    `DELETE FROM "PaymentSchedule" WHERE "quoteId" IN (${inQ})`,
    `DELETE FROM "ActivityLog" WHERE "entityId" IN (${inQ}) OR "entityId" IN (${inC})`,
    `DELETE FROM "AutomationEvent" WHERE "entityId" IN (${inQ}) OR "entityId" IN (${inC})`,
    `DELETE FROM "Notification" WHERE title LIKE '%GREENCHECK%' OR body LIKE '%GREENCHECK%'`,
    `DELETE FROM "CrmContactNote" WHERE "crmContactId" IN (${inC})`,
    `DELETE FROM "PendingTouch" WHERE "crmContactId" IN (${inC})`,
    `DELETE FROM "SavedQuote" WHERE id IN (${inQ})`,
  ]) { try { sql(s) } catch (e) { console.log(`cleanup: ${s.slice(0, 40)}: ${String(e.stderr ?? e).split('\n')[0].slice(0, 120)}`) } }
  for (let k = 0; k < 4; k++) {
    const pipe = (await owner('GET', '/api/pipeline')).json?.data
    const mine = (pipe?.leads ?? []).filter(l => contacts.includes(l.customerId) || made.cards.has(l.id)).map(l => l.id)
    if (!mine.length) break
    if ((await owner('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pipe.version })).status === 200) break
    await sleep(800)
  }
  for (const id of contacts) await owner('DELETE', `/api/crm-contacts/${id}`).catch(() => {})
  try { sql(`DELETE FROM "CrmContact" WHERE id IN (${inC})`) } catch { /* already gone */ }
  const users = (await owner('GET', '/api/crm-auth/users')).json?.data ?? []
  for (const u of users.filter(x => made.users.includes(x.email))) await owner('DELETE', `/api/crm-auth/users/${u.id}`).catch(() => {})
  return Number(sql(`SELECT (SELECT count(*) FROM "CrmContact" WHERE id IN (${inC})) + (SELECT count(*) FROM "SavedQuote" WHERE id IN (${inQ}))`))
}

async function main() {
  chrome = await chromium.launch()
  safari = await webkit.launch()
  try {
    const office = await invite('office_staff', 'Office')
    const sales = await invite('sales_rep', 'Salesman')
    const O = await device(office, 'computer')
    const S = await device(sales, 'phone')
    const C = await device(null, 'phone')
    const vp = S.page.viewportSize()
    check(vp?.width === 390, `the Salesman's phone is ${vp?.width} wide (iPhone 13, 390 x 844 screen)`)

    const card = await officeAddsLead(O, 'GREENCHECK', `${TODAY} Green Yard`, '3525550109')
    check(!!card, `office added the lead (card ${card.stage})`)
    // The Salesman sees only the Salesman's own and assigned customers (lib/salesScope.ts, Oct 28 2026): the office assigns it.
    const assigned = await call(office.token, 'POST', `/api/lead-assign/${card.customerId}`, { to: sales.userId })
    check(assigned.status === 200, `office assigned the lead to the Salesman (${assigned.status}${assigned.status === 200 ? '' : ' ' + assigned.text.slice(0, 200)})`)

    // The Salesman quotes from the card on her phone.
    let page = await go(S, `/pipeline?card=${encodeURIComponent(card.id)}`)
    await tap(S, page.locator('[data-card-new-quote]').first())
    const b = page.locator('[data-quote-builder]')
    await b.waitFor({ timeout: 20000 })
    await tap(S, b.locator('[data-step="yard"]'))
    await tap(S, b.locator('[data-shape="backyard"]'))
    await tap(S, b.locator('[data-side="Left return"] [data-side-length]'))
    for (const [keys, last] of [[['3', '0'], 0], [['1', '2', '0'], 0], [['1', '5', '0'], 0], [['1', '0', '0'], 0], [['3', '0'], 1]]) {
      for (const k of keys) await tap(S, page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`))
      await tap(S, page.locator(last ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]'))
    }
    await tap(S, b.locator('[data-step="style"]'))

    // No dig: every green part has its own price now.
    const nd = await pickStyle(b, /green chain link.*no dig/i)
    await sleep(800)
    check(await b.locator('[data-from-black="style"]').count() === 0, `${nd}: no "Price may be low" in the Style step`)
    await tap(S, b.locator('[data-step="price"]'))
    await sleep(1000)
    check(await b.locator('[data-from-black]').count() === 0, `${nd}: no "Price may be low" in the Price step`)
    await shot(page, '1-salesman-green-no-dig-price-no-warning')
    // The Dig set option offered on the same proposal still has its posts from Black: its card says so.
    const tierWarn = b.locator('[data-tier-from-black]')
    const tierText = await tierWarn.first().innerText().catch(() => '')
    check(await tierWarn.count() === 1 && /Price may be low: .*DS, Pipe, Green/.test(tierText), `the Dig set option on the proposal says its price may be low ("${tierText}")`)
    await tierWarn.first().scrollIntoViewIfNeeded().catch(() => {})
    await shot(page, '1b-salesman-no-dig-dig-set-option-warning')

    // Dig set: its posts are still priced from Black.
    await tap(S, b.locator('[data-step="style"]'))
    const ds = await pickStyle(b, /green chain link.*dig set/i)
    await sleep(800)
    const styleWarn = b.locator('[data-from-black="style"]')
    check(await styleWarn.isVisible().catch(() => false), `${ds}: "Price may be low" shows in the Style step`)
    await styleWarn.scrollIntoViewIfNeeded().catch(() => {})
    await shot(page, '2-salesman-green-dig-set-style-warning')
    await tap(S, b.locator('[data-step="price"]'))
    await sleep(1000)
    const priceWarn = b.locator('[data-from-black="price"]')
    check(await priceWarn.isVisible().catch(() => false), `${ds}: "Price may be low" shows in the Price step, under the price`)
    const words = await priceWarn.innerText().catch(() => '')
    const parts = await priceWarn.locator('[data-from-black-part]').evaluateAll(els => els.map(e => e.getAttribute('data-from-black-part')))
    check(/Price may be low/.test(words) && /priced from Black/.test(words), `the warning says the price may be low and why ("${words.split('\n')[0]}")`)
    check(parts.length === 2 && parts.every(p => /^DS, Pipe, Green, (Line|Terminal) Post/.test(p)), `it names the parts still from Black: ${parts.join('; ')}`)
    check(!/Bolt|Gate, 1-3\/8", 4' x 4'|Fork/.test(parts.join(' ')), 'the parts with green prices now (bolts, 4 ft gate, fork) are not in it')
    await priceWarn.scrollIntoViewIfNeeded().catch(() => {})
    await shot(page, '3-salesman-green-dig-set-price-warning')

    // Save, then copy the proposal link.
    const before = new Set(((await owner('GET', '/api/saved-quotes')).json?.data ?? []).filter(q => q.crmContactId === card.customerId).map(q => q.id))
    await tap(S, page.locator('[data-quote-bar] [data-save-open], [data-save-open]').first())
    await tap(S, page.locator('[data-save-submit]'))
    const q = await until(async () => ((await owner('GET', '/api/saved-quotes')).json?.data ?? []).find(x => x.crmContactId === card.customerId && !before.has(x.id)), 20000)
    check(!!q, `the quote saved: ${q?.fenceStyle} $${q?.finalPrice}`)
    if (!q) return
    made.quotes.add(q.id)
    page = await go(S, `/quotes?qv=${q.id}`)
    await page.locator('[data-proposal-send]').first().waitFor({ timeout: 30000 })
    const tokenResp = page.waitForResponse(r => /\/api\/saved-quotes\/[^/]+\/share-token$/.test(r.url()) && r.request().method() === 'POST', { timeout: 20000 }).catch(() => null)
    await tap(S, page.locator('[data-proposal-copy]').first())
    const resp = await tokenResp
    const body = resp ? await resp.json().catch(() => null) : null
    const token = body?.data?.shareToken ?? body?.shareToken
    check(!!token, 'the Salesman copied the proposal link')
    if (!token) return

    // The customer opens it on her phone.
    const cp = C.page
    await cp.goto(`${APP}/p/${token}`, { waitUntil: 'domcontentloaded' })
    await cp.waitForSelector('#go', { timeout: 30000 })
    await sleep(1000)
    const text = await cp.locator('body').innerText()
    const html = await cp.content()
    check(!/Price may be low|priced from Black|From Black|Black's price/i.test(text), "the customer's proposal has no From Black warning or words")
    check(!/data-from-black/.test(html), "nothing of the warning is in the customer's page")
    check(/green/i.test(text), "the customer's proposal is the green fence")
    await shot(cp, '4-customer-proposal-no-warning')
    await cp.locator('#go').scrollIntoViewIfNeeded().catch(() => {})
  } finally {
    try { const left = await cleanUp(); check(left === 0, `cleanup: ${left} test rows left`) } catch (e) { check(false, `cleanup: ${String(e).slice(0, 200)}`) }
    await chrome?.close().catch(() => {})
    await safari?.close().catch(() => {})
  }
}

main().then(() => { console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED'); process.exit(failed ? 1 : 0) }, e => { console.error(e); process.exit(1) })
