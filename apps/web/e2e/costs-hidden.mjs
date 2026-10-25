// Who sees costs and prices (Jonathan, Oct 25, 2026: "office staff like me and
// sales i think its ok to see cost but installer and subcontractor no see price").
//
//   cd apps/web && pnpm -s build
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> node e2e/costs-hidden.mjs
//
//   1. The owner invites a Salesman, an Office Staff and an Installer (the real
//      invite API); each accepts and signs in by cookie.
//   2. Straight to the server: the Installer's answers (business record,
//      Inventory, quotes, jobs, the pipeline, the schedule, account documents,
//      vendors, tiers) hold no cost field, no price field (price, job value,
//      deposit, payment, balance, ...), no real unit cost and no dollar amount
//      in any text; the money routes (payments, invoices, contracts, change
//      orders, signed documents, quote pricing) refuse it. The Salesman's and
//      the office's answers carry costs, as the owner's do.
//   3. The Installer on a phone opens My installs, Operations and a job, Inventory
//      and the schedule: every answer recorded is checked the same way, and no
//      screen shows a dollar figure.
//   4. The Salesman (phone) and the office (computer) see a quote's margin and
//      cost breakdown; the office opens Accounts Payable and vendor invoices.
// There is no subcontractor role in the app (lib/permissions.ts); the Installer
// (Field Crew) is the role that sees no price.
// Dev only (port 4001). Removes the logins it made.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, webkit, devices } from 'playwright'
import crypto from 'crypto'

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
const stamp = Date.now().toString(36).slice(-6)
const made = { users: [] }

// ── What must never reach the Installer ──
const COST_FIELDS = ['unitCost', 'fallbackCost', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'gmPct', 'grossMargin', 'margin', 'margins',
  'subRate', 'subRateDefault', 'subRateByCategory', 'subWalkGate', 'subDblGate', 'manHourRate', 'targetProfitPct', 'overheadPct', 'costFactor',
  'commissionSalesman', 'commissionAmt', 'commissionPct', 'snapshot', 'priced', 'unitCostCents', 'totalCostCents', 'materialCents', 'laborCents', 'costCents']
const PRICE_FIELDS = ['finalPrice', 'quotePrice', 'jobValue', 'contractValue', 'changeOrderTotal', 'amountPaid', 'balanceDue', 'jobPrice', 'price', 'perFoot',
  'pricePerFoot', 'amountCents', 'depositCents', 'depositPaidCents', 'balanceCents', 'contractCents', 'priceCents', 'deposit', 'depositPct', 'amount']
const costRe = new RegExp(`"(${COST_FIELDS.join('|')})"\\s*:`)
const priceRe = new RegExp(`"(${PRICE_FIELDS.join('|')})"\\s*:`)
const dollarRe = /\$\s?\d/
let VALUES = []   // the company's real unit costs, as text
const valueHits = text => VALUES.filter(v => new RegExp(`(?<![\\d.])${v.replace('.', '\\.')}(?![\\d])`).test(text))
function leaks(bodies) {
  const out = []
  for (const b of bodies) {
    const c = b.text.match(costRe), p = b.text.match(priceRe), d = b.text.match(dollarRe), v = valueHits(b.text)
    if (c || p || d || v.length) out.push(`${b.method} ${b.url.replace(API, '')} -> ${c?.[1] ?? ''} ${p?.[1] ?? ''} ${d ? d[0] : ''} ${v.slice(0, 3).join(',')}`)
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
  return { email, password, token: acc.json.data?.accessToken }
}

const chrome = await chromium.launch()
const safari = await webkit.launch()
const errors = []
function recorder(page) {
  const bodies = []
  page.on('response', async r => {
    const u = r.url()
    if (!u.startsWith(API + '/api/')) return
    if (!(r.headers()['content-type'] || '').includes('json')) return
    try { bodies.push({ method: r.request().method(), url: u, text: await r.text() }) } catch { /* a redirect or a closed page */ }
  })
  return bodies
}
async function signedIn(login, phone) {
  const ctx = phone ? await safari.newContext({ ...devices['iPhone 13'] }) : await chrome.newContext({ viewport: { width: 1440, height: 900 } })
  const r = await ctx.request.post(`${API}/api/crm-auth/login`, { headers: { 'X-Staff-Request': '1' }, data: { email: login.email, password: login.password, cookie: true } })
  if (!r.ok()) throw new Error(`cookie sign in failed: ${r.status()} ${await r.text()}`)
  const page = await ctx.newPage()
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  return { ctx, page, bodies: recorder(page) }
}
const go = async (page, p) => { await page.goto(`${APP}${p}`, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }).catch(() => {}); await sleep(2500) }

try {
  // ── The company's real unit costs (from the owner's Inventory), and a quote and a job with figures ──
  const inv = (await owner('GET', '/api/inventory-state')).json.data
  VALUES = [...new Set((inv.items || []).map(i => Number(i.unitCost)).filter(c => c >= 10 && Math.round(c * 100) % 100 !== 0).map(c => c.toFixed(2).replace(/0$/, '')))].slice(0, 40)
  check('setup: real unit costs to look for', VALUES.length >= 10, VALUES.slice(0, 8).join(', '))
  const quotes = (await owner('GET', '/api/saved-quotes')).json.data ?? []
  const costed = quotes.find(q => q.totalCOGS > 0 && q.finalPrice > 0 && q.status === 'SENT') ?? quotes.find(q => q.totalCOGS > 0 && q.finalPrice > 0)
  const jobs = (await owner('GET', '/api/saved-jobs')).json.data ?? []
  const pricedJob = jobs.find(j => j.contractValue > 0 && j.scheduledDate) ?? jobs.find(j => j.contractValue > 0)
  check('setup: a quote with costs and a job with a contract value', !!costed && !!pricedJob)

  const sales = await invite('sales_rep', `Salesman ${stamp}`)
  const office = await invite('office_staff', `Office ${stamp}`)
  const crew = await invite('field_crew', `Installer ${stamp}`)
  check('logins: a Salesman, an Office Staff and an Installer', !!sales.token && !!office.token && !!crew.token)

  // ── 2. Straight to the server ──
  const reads = ['/api/business-state', '/api/inventory-state', '/api/saved-quotes', '/api/saved-jobs', '/api/kv', '/api/vendor-state', '/api/tier-sets', '/api/pipeline', '/api/schedule/jobs', '/api/schedule/ready']
  const crewDirect = []
  for (const p of reads) crewDirect.push({ method: 'GET', url: API + p, text: (await call(crew.token, 'GET', p)).text })
  if (pricedJob) {
    crewDirect.push({ method: 'GET', url: `${API}/api/saved-jobs/${pricedJob.id}`, text: (await call(crew.token, 'GET', `/api/saved-jobs/${pricedJob.id}`)).text })
    crewDirect.push({ method: 'GET', url: `${API}/api/install-packets/crew/${pricedJob.id}`, text: (await call(crew.token, 'GET', `/api/install-packets/crew/${pricedJob.id}`)).text })
  }
  const dl = leaks(crewDirect)
  check('installer: no cost, no price, no real cost and no dollar amount in any answer', dl.length === 0, dl.slice(0, 5).join(' | '))
  const money = [`/api/payments/job/${pricedJob?.id}`, '/api/invoices', `/api/change-orders?jobId=${pricedJob?.id}`, `/api/signed-documents?jobId=${pricedJob?.id}`, '/api/contracts']
  const refused = []
  for (const p of money) refused.push([p, (await call(crew.token, 'GET', p)).status])
  const qp = await call(crew.token, 'POST', '/api/quote-pricing', { request: { fenceStyle: "WV-ND 6'x8' Privacy", runs: [{ ft: 120, rail: 'auto' }], corners: 2, ends: 2, walkGates: 1, dblGates: 0, overrides: {}, jobType: 'new' } })
  refused.push(['/api/quote-pricing', qp.status])
  check('installer: the money routes refuse it', refused.every(([, s]) => s === 403), JSON.stringify(refused))
  for (const [who, t] of [['salesman', sales], ['office', office]]) {
    const i = (await call(t.token, 'GET', '/api/inventory-state')).text
    const q = (await call(t.token, 'GET', `/api/saved-quotes/${costed?.id}`)).json.data
    check(`${who}: sees costs and prices, as the owner does`, costRe.test(i) && valueHits(i).length > 5 && q?.totalCOGS === costed?.totalCOGS && q?.finalPrice === costed?.finalPrice)
  }
  check('office: vendor invoices open', (await call(office.token, 'GET', '/api/vendor-invoices')).status === 200)
  check('salesman: no vendor invoices (supplier invoices are the office\'s)', (await call(sales.token, 'GET', '/api/vendor-invoices')).status === 403)

  // ── 3. The Installer on a phone ──
  const c = await signedIn(crew, true)
  const screens = []
  for (const p of ['/', '/my-installs', '/operations', ...(pricedJob ? [`/operations?job=${pricedJob.id}`] : []), '/inventory', '/schedule']) {
    await go(c.page, p)
    screens.push(`${p}: ${await c.page.locator('body').innerText().catch(() => '')}`)
  }
  const cl = leaks(c.bodies)
  check(`installer phone: ${c.bodies.length} answers recorded, none holds a cost, a price or a dollar amount`, c.bodies.length > 10 && cl.length === 0, cl.slice(0, 6).join(' | '))
  const shown = screens.join('\n').match(/.{0,40}\$\s?(\d|NaN).{0,20}/)
  check('installer phone: no screen shows a dollar figure', !shown, shown ? shown[0] : '')
  await c.ctx.close()

  // ── 4. The Salesman and the office see the costs ──
  const s = await signedIn(sales, true)
  await go(s.page, `/quotes?qv=${costed.id}`)
  await s.page.locator('[data-quote-drawer]').waitFor({ timeout: 15000 }).catch(() => {})
  const sd = await s.page.locator('[data-quote-drawer]').innerText().catch(() => '')
  check('salesman: the quote shows its margin and cost breakdown', /margin/i.test(sd) && /Material cost/.test(sd), sd.slice(0, 80))
  await s.ctx.close()
  const o = await signedIn(office, false)
  await go(o.page, `/quotes?qv=${costed.id}`)
  await o.page.locator('[data-quote-drawer]').waitFor({ timeout: 15000 }).catch(() => {})
  const od = await o.page.locator('[data-quote-drawer]').innerText().catch(() => '')
  check('office: the quote shows its margin and cost breakdown', /margin/i.test(od) && /Material cost/.test(od))
  await go(o.page, '/accounts-payable')
  check('office: Accounts Payable opens', new URL(o.page.url()).pathname === '/accounts-payable', o.page.url())
  await o.ctx.close()
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (e) {
  check('ran to the end', false, String(e?.stack ?? e).slice(0, 300))
} finally {
  const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
  for (const u of users.filter(x => made.users.includes(x.email))) await owner('DELETE', `/api/crm-auth/users/${u.id}`).catch(() => {})
  await chrome.close(); await safari.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
