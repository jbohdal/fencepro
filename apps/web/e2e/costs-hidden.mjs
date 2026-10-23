// Prices only for a Salesman or Installer: their phones never receive a cost.
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//   E2E_SHOTS=<folder> node e2e/costs-hidden.mjs
//
//   1. The owner invites a Salesman and an Installer (the real invite API); each
//      accepts and signs in.
//   2. Every answer from the server is recorded while the salesman, on a phone,
//      quotes a new fence, a move and a repair and saves them, opens saved
//      quotes, a quote's drawer, the customers, the schedule, and tries
//      Settings and Inventory; and while the installer opens Operations,
//      Inventory, the schedule and a saved quote.
//   3. No answer to either holds a cost field (unitCost, materialCost,
//      laborCost, gmPct, margin, subRate, targetProfitPct, commission,
//      overheadPct, costFactor, snapshot, ...) or one of the company's real
//      unit costs or rates (taken from the owner's own Inventory and Settings).
//   4. Their saves keep every cost: a quote the salesman saves gets its costs
//      on the server (and its price matches the owner's quote builder on the
//      same quote); a stage change and the voice switch leave every cost as saved.
//   5. The owner still sees all of it.
// Screenshot (E2E_SHOTS): dev-salesman-quote-no-costs.png (phone).
// Dev only (port 4001). Removes both logins, the customer and every quote it made.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.E2E_SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

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
const money = t => Number(String(t).replace(/[^\d.-]/g, ''))
const stamp = Date.now().toString(36).slice(-6)
const made = { users: [], contactId: null, quotes: [] }

// ── What must never reach a limited login ──
const COST_FIELDS = ['unitCost', 'fallbackCost', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'gmPct', 'grossMargin', 'margin', 'margins',
  'subRate', 'subRateDefault', 'subRateByCategory', 'subWalkGate', 'subDblGate', 'manHourRate', 'targetProfitPct', 'overheadPct', 'costFactor',
  'commissionSalesman', 'commissionAmt', 'commissionPct', 'snapshot', 'priced', 'unitCostCents', 'totalCostCents', 'materialCents', 'laborCents', 'costCents']
const fieldRe = new RegExp(`"(${COST_FIELDS.join('|')})"\\s*:`)
let VALUES = []   // the company's real unit costs and rates, as text
const valueHits = text => VALUES.filter(v => new RegExp(`(?<![\\d.])${v.replace('.', '\\.')}(?![\\d])`).test(text))
function leaks(bodies) {
  const out = []
  for (const b of bodies) {
    const f = b.text.match(fieldRe)
    const v = valueHits(b.text)
    if (f || v.length) out.push(`${b.method} ${b.url.replace(API, '')} -> ${f ? f[1] : ''} ${v.slice(0, 3).join(',')}`)
  }
  return out
}

async function invite(role, last) {
  const email = `e2e-${role}-${stamp}@example.test`
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: last, email, role })
  const link = new URL(inv.json.data.inviteUrl)
  made.users.push(email)
  const password = `Ch-${crypto.randomBytes(9).toString('base64url')}`
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: link.searchParams.get('token'), email, password })
  return { email, password, token: acc.json.data?.accessToken, refresh: acc.json.data?.refreshToken }
}

const browser = await chromium.launch()
const errors = []
function recorder(page) {
  const bodies = []
  page.on('response', async r => {
    const u = r.url()
    if (!u.startsWith(API + '/api/')) return
    const ct = r.headers()['content-type'] || ''
    if (!ct.includes('json')) return
    try { bodies.push({ method: r.request().method(), url: u, text: await r.text() }) } catch { /* a redirect or a closed page */ }
  })
  return bodies
}
// Signed in the way the app does now: the ezbiz_staff cookie (the salesman and
// installer with their password, the owner's test token moved over once), and
// nothing in the browser's storage. The cost hiding must read the role from
// the cookie's session (lib/staffSession.ts).
async function signedIn(login, viewport) {
  const ctx = await browser.newContext({ viewport })
  const headers = { 'X-Staff-Request': '1' }
  const r = login.password
    ? await ctx.request.post(`${API}/api/crm-auth/login`, { headers, data: { email: login.email, password: login.password, cookie: true } })
    : await ctx.request.post(`${API}/api/crm-auth/move-over`, { headers: { ...headers, Authorization: `Bearer ${login.token}` }, data: {} })
  if (!r.ok()) throw new Error(`cookie sign in failed: ${r.status()} ${await r.text()}`)
  const jar = await ctx.cookies(`${API}/api/`)
  check(`${login.email ?? 'owner'}: signed in by an HttpOnly cookie`, jar.some(c => c.name === 'ezbiz_staff' && c.httpOnly && c.sameSite === 'Strict' && c.path === '/api'))
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  const bodies = recorder(page)
  return { ctx, page, bodies }
}
const go = async (page, p) => { await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-global-appointment], [data-quote-builder], main', { timeout: 15000 }).catch(() => {}); await sleep(2500) }

try {
  // ── What the company's costs are (from the owner's own answers) ──
  const inv = (await owner('GET', '/api/inventory-state')).json.data
  const cfg = (await owner('GET', '/api/business-state')).json.data.config
  const costs = [...new Set((inv.items || []).map(i => Number(i.unitCost)).filter(c => c >= 10 && Math.round(c * 100) % 100 !== 0).map(c => c.toFixed(2).replace(/0$/, '')))]
  VALUES = costs.slice(0, 40)
  check('setup: real unit costs to look for', VALUES.length >= 10, VALUES.slice(0, 8).join(', '))
  check('setup: the owner sees sub rates, wages and margins in Settings', cfg.pricing?.subRateByCategory !== undefined && typeof cfg.pricing?.manHourRate === 'number' && cfg.fenceStyles.some(s => typeof s.margin === 'number'))

  // A throwaway customer for the quotes.
  const contact = await owner('POST', '/api/crm-contacts', { firstName: 'E2E', lastName: `Costs ${stamp}`, phone: `352555${String(Math.floor(Math.random() * 9000) + 1000)}` })
  made.contactId = contact.json.data?.id ?? null
  const CUSTOMER = `E2E Costs ${stamp}`

  // ── 1. A Salesman and an Installer ──
  const sales = await invite('sales_rep', `Salesman ${stamp}`)
  const crew = await invite('field_crew', `Installer ${stamp}`)
  check('logins: a Salesman and an Installer signed in', !!sales.token && !!crew.token)

  // ── 2a. Straight to the server with their logins ──
  const direct = []
  for (const t of [sales, crew]) {
    for (const p of ['/api/business-state', '/api/inventory-state', '/api/saved-quotes', '/api/saved-jobs', '/api/kv', '/api/vendor-state', '/api/tier-sets', '/api/pipeline']) {
      const r = await call(t.token, 'GET', p)
      direct.push({ method: 'GET', url: API + p + ` (${t === sales ? 'salesman' : 'installer'})`, text: r.text })
    }
    const view = await call(t.token, 'POST', '/api/quote-pricing', { request: { fenceStyle: "WV-ND 6'x8' Privacy", runs: [{ ft: 120, rail: 'auto' }], corners: 2, ends: 2, walkGates: 1, dblGates: 0, overrides: {}, jobType: 'new', compare: true } })
    direct.push({ method: 'POST', url: API + '/api/quote-pricing', text: view.text })
    check(`server prices for the ${t === sales ? 'salesman' : 'installer'}: a price, no costs`, view.status === 200 && view.json.data?.price > 0 && Array.isArray(view.json.data?.compare) && view.json.data.compare.length > 1, `${view.status} ${view.json.data?.price}`)
  }
  const directLeaks = leaks(direct)
  check('API answers to both logins hold no cost field or real cost', directLeaks.length === 0, directLeaks.slice(0, 5).join(' | '))
  const ownerInv = (await owner('GET', '/api/inventory-state')).text
  check('the owner gets the same answers with costs', fieldRe.test(ownerInv) && valueHits(ownerInv).length > 5)

  // ── 2b. The salesman on a phone ──
  const s = await signedIn(sales, { width: 390, height: 844 })
  const b = s.page.locator('[data-quote-builder]')
  await go(s.page, '/')
  async function newQuote() { await go(s.page, '/quotes?quote=new'); await b.waitFor({ timeout: 30000 }) }
  async function straight(ft, gate) {
    await b.locator('[data-step="yard"]').click()
    await b.locator('[data-shape="straight"]').click(); await sleep(300)
    if (!(await b.locator('[data-side="Fence"] [data-side-length]').isVisible().catch(() => false))) await b.locator('[data-side-row="Fence"]').click()
    await b.locator('[data-side="Fence"] [data-side-length]').click()
    for (const k of String(ft)) await s.page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
    await s.page.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(300)
    if (gate) {
      if (!(await b.locator('[data-side="Fence"] [data-gate-choice]').isVisible().catch(() => false))) await b.locator('[data-side-row="Fence"]').click()
      await b.locator('[data-side="Fence"] [data-gate-choice] button:has-text("Walk gate")').click(); await sleep(300)
    }
  }
  const priceReady = async () => { for (let i = 0; i < 40; i++) { if (money(await b.locator('[data-quote-price]').textContent()) > 0 && !(await b.locator('[data-price-pending]').count())) return true; await sleep(250) } return false }
  async function save() {
    await s.page.locator('[data-quote-bar] [data-save-open]').click()
    await s.page.locator('input[placeholder="Name, phone, or email..."]').fill(`Costs ${stamp}`); await sleep(600)
    await s.page.locator(`text=${CUSTOMER}`).last().click()
    await s.page.locator('[data-save-submit]').click(); await sleep(3000)
  }
  async function newest(pred) {
    const list = (await owner('GET', '/api/saved-quotes')).json.data ?? []
    const q = list.filter(x => x.customerName === CUSTOMER && pred(x)).sort((a, z) => String(z.createdAt).localeCompare(String(a.createdAt)))[0]
    if (q && !made.quotes.includes(q.id)) made.quotes.push(q.id)
    return q
  }

  // New fence: 120 ft, a walk gate, White Vinyl 6 ft tall, 8 ft panels, No dig.
  await newQuote()
  await b.locator('input[placeholder^="Customer name"]').fill(CUSTOMER)
  await straight(124, true)
  await b.locator('[data-step="style"]').click(); await sleep(300)
  check('salesman: no sub rate, flat labor or commission % on the Style step', !(await b.locator('[data-step-panel="style"]').innerText()).match(/Sub rate|Flat labor|commission|\/hr/i))
  await b.locator('[data-style-list]').selectOption({ label: 'White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig' }); await sleep(400)
  await b.locator('[data-step="price"]').click()
  check('salesman: the server prices the quote', await priceReady(), await b.locator('[data-quote-price]').textContent())
  await b.locator('[data-compare-toggle]').click(); await sleep(1500)
  const priceText = await b.locator('[data-step-panel="price"]').innerText()
  check('salesman: price, per foot, tiers and Compare options shown', /per foot/.test(priceText) && await b.locator('[data-tier]').count() > 0 && await b.locator('[data-compare-row]').count() > 1)
  check('salesman: no cost, margin, Target Margin, profit or "where every dollar goes"', !/Material cost|Labor Cost|Total cost|Gross Margin|Margin \$|Target Margin|Total Material|Commission|Profit|Overhead/i.test(priceText), (priceText.match(/Material cost|Labor Cost|Total cost|Gross Margin|Target Margin|Total Material|Commission|Profit|Overhead/i) || [''])[0])
  if (SHOTS) { await b.locator('[data-quote-price]').scrollIntoViewIfNeeded(); await s.page.screenshot({ path: path.join(SHOTS, 'dev-salesman-quote-no-costs.png') }) }
  const salesPrice = money(await b.locator('[data-quote-price]').textContent())
  await save()
  const nq = await newest(q => !q.work)
  check('salesman save: the quote is on the server with its costs worked out there', !!nq && nq.materialCost > 0 && nq.laborCost > 0 && nq.gmPct > 0 && nq.pullSheet.every(l => typeof l.unitCost === 'number') && nq.pullSheet.some(l => l.unitCost > 0), nq ? `${nq.materialCost} ${nq.laborCost} ${nq.gmPct}` : 'none')
  check('salesman save: its price is the one the salesman saw', !!nq && Math.abs(nq.finalPrice - salesPrice) < 0.005, `${nq?.finalPrice} vs ${salesPrice}`)
  check('salesman save: each proposal option has its internal snapshot (for when the customer accepts)', !!nq?.proposal?.options?.length && nq.proposal.options.every(o => o.snapshot && typeof o.snapshot.materialCost === 'number'))

  // Move: 100 ft old fence with a walk gate to a 100 ft new line.
  await newQuote()
  await b.locator('input[placeholder^="Customer name"]').fill(CUSTOMER)
  await straight(104, true)
  await b.locator('[data-step="style"]').click(); await sleep(300)
  await b.locator('[data-job-type-option="move"]').click()
  await b.locator('[data-style-list]').selectOption({ label: 'White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig' }); await sleep(300)
  await b.locator('[data-move-old-ft]').fill('100'); await b.locator('[data-move-old-walk]').fill('1')
  await b.locator('[data-step="price"]').click()
  check('salesman move: priced by the server, no cost lines', await priceReady() && await b.locator('[data-work-line]').count() === 0 && !/Where the cost comes from|Total cost/.test(await b.locator('[data-step-panel="price"]').innerText()))
  await save()
  const mq = await newest(q => q.work?.type === 'move')
  check('salesman move save: the cost lines are worked out on the server', !!mq && mq.work?.priced?.costCents > 0 && mq.work.priced.lines.length > 0 && mq.totalCOGS > 0)

  // Repair: storm, replace a section and a post.
  await newQuote()
  await b.locator('input[placeholder^="Customer name"]').fill(CUSTOMER)
  await straight(60, false)
  await b.locator('[data-step="style"]').click(); await sleep(300)
  await b.locator('[data-job-type-option="repair"]').click()
  await b.locator('[data-style-list]').selectOption({ label: 'White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig' }); await sleep(300)
  await b.locator('[data-what="storm"]').click(); await sleep(200)
  await b.locator('[data-toggle="debris-cleared"] input').check().catch(() => {})
  await b.locator('[data-step="price"]').click()
  check('salesman repair: priced by the server', await priceReady())
  await save()
  const rq = await newest(q => q.work?.type === 'repair')
  check('salesman repair save: costs worked out on the server', !!rq && rq.work?.priced?.costCents > 0 && rq.materialCost > 0)

  // Saved quotes, a quote's drawer, customers, schedule; Settings and Inventory are not theirs.
  await go(s.page, '/quotes'); await go(s.page, `/quotes?quote=${nq?.id}`); await sleep(1500)
  await go(s.page, '/customers'); await go(s.page, '/pipeline'); await go(s.page, '/schedule')
  await go(s.page, '/settings'); await go(s.page, '/inventory')

  // A stage change (no pricing) keeps every cost as saved.
  const before = (await owner('GET', `/api/saved-quotes/${nq.id}`)).json.data
  const theirs = (await call(sales.token, 'GET', `/api/saved-quotes/${nq.id}`)).json.data
  const patched = await call(sales.token, 'PATCH', `/api/saved-quotes/${nq.id}`, { ...theirs, status: 'SENT', materialCost: 0, laborCost: 0, gmPct: 0 })
  const after = (await owner('GET', `/api/saved-quotes/${nq.id}`)).json.data
  check('salesman stage change: costs, pull sheet costs, pricing and snapshots stay as saved', patched.status === 200 && after.status === 'SENT' && ['materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'gmPct'].every(k => after[k] === before[k]) && JSON.stringify(after.pullSheet) === JSON.stringify(before.pullSheet) && JSON.stringify(after.pricing) === JSON.stringify(before.pricing) && JSON.stringify(after.proposal.options.map(o => o.snapshot)) === JSON.stringify(before.proposal.options.map(o => o.snapshot)), `${patched.status}`)
  // The voice switch saves Settings from a phone that has no costs: every cost stays.
  const bsOwner = (await owner('GET', '/api/business-state')).json.data
  const bsTheirs = (await call(sales.token, 'GET', '/api/business-state')).json.data
  const me = (await call(sales.token, 'GET', '/api/crm-auth/me')).json.data
  const onFor = [...new Set([...(bsTheirs.config.voice?.onFor ?? []), me?.id ?? me?.user?.id].filter(Boolean))]
  const voice = await call(sales.token, 'PATCH', '/api/business-state', { config: { ...bsTheirs.config, voice: { ...(bsTheirs.config.voice ?? {}), onFor } }, baseVersion: bsTheirs.version })
  const bsAfter = (await owner('GET', '/api/business-state')).json.data
  const strip = c => JSON.stringify({ ...c, voice: null })
  check('salesman voice switch: saved, and every rate, margin and sub rate in Settings is as it was', voice.status === 200 && strip(bsAfter.config) === strip(bsOwner.config), `${voice.status} ${voice.json.error ?? ''}`)
  await owner('PATCH', '/api/business-state', { config: { ...bsAfter.config, voice: bsOwner.config.voice ?? bsAfter.config.voice }, baseVersion: bsAfter.version })

  // ── 2c. The installer ──
  const c = await signedIn(crew, { width: 390, height: 844 })
  for (const p of ['/', '/operations', '/inventory', '/schedule', `/quotes?quote=${nq.id}`]) await go(c.page, p)

  // ── 3. Nothing reached their phones ──
  const sl = leaks(s.bodies), cl = leaks(c.bodies)
  check(`salesman: ${s.bodies.length} answers recorded, none holds a cost field or a real cost`, s.bodies.length > 20 && sl.length === 0, sl.slice(0, 6).join(' | '))
  check(`installer: ${c.bodies.length} answers recorded, none holds a cost field or a real cost`, c.bodies.length > 10 && cl.length === 0, cl.slice(0, 6).join(' | '))
  check('the phones asked the server to price (quote-pricing answers recorded)', s.bodies.filter(x => x.url.includes('/api/quote-pricing')).length >= 3)

  // ── 4. The owner sees everything, and the same price on the salesman's quote ──
  const o = await signedIn({ token: OWNER }, { width: 1440, height: 1000 })
  await go(o.page, `/quotes?quote=${nq.id}`)
  const ob = o.page.locator('[data-quote-builder]')
  await ob.waitFor({ timeout: 30000 }).catch(() => {})
  await ob.locator('[data-step="price"]').click().catch(() => {}); await sleep(1500)
  const ownerPrice = money(await ob.locator('[data-quote-price]').textContent().catch(() => '0'))
  const ownerText = await ob.locator('[data-step-panel="price"]').innerText().catch(() => '')
  check('owner: the salesman\'s quote prices the same in the owner\'s quote builder (to the cent)', Math.abs(ownerPrice - nq.finalPrice) < 0.005, `${ownerPrice} vs ${nq.finalPrice}`)
  check('owner: sees material cost, labor, margin and Target Margin', /Material cost/.test(ownerText) && /Gross Margin/.test(ownerText) && /Target Margin/.test(ownerText))
  check('owner: answers carry costs', o.bodies.some(x => fieldRe.test(x.text)) && o.bodies.some(x => valueHits(x.text).length > 0))
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  check('ran to the end', false, String(e).slice(0, 300))
} finally {
  for (const id of made.quotes) await owner('DELETE', `/api/saved-quotes/${id}`).catch(() => {})
  if (made.contactId) await owner('DELETE', `/api/crm-contacts/${made.contactId}`).catch(() => {})
  const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
  for (const u of users.filter(x => made.users.includes(x.email))) await owner('DELETE', `/api/crm-auth/users/${u.id}`).catch(() => {})
  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
