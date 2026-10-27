// The owner's money screens agree with each other and with the payments
// (Oct 26, 2026 audit item 6; web src/moneyTruth.ts). Reads only, writes nothing.
//
//   - Billing's Outstanding = the Balance Sheet's Accounts Receivable, and the
//     Balance Sheet balances (assets = liabilities + equity), naming what is missing;
//   - P&L revenue, payments received (cash) = the sum of /api/payments/received
//     this year; installed (accrual) = the Dashboard's "Revenue this year";
//   - the Dashboard's Gross margin = Reports' Gross Margin (this year, quotes with costs);
//   - the Target Margin reads the same on the Budget, the Dashboard and Reports
//     (Settings › Pricing), never the budget plan's 34.6%;
//   - no style shows 100% margin; the Budget's net profit is not the old 55%;
//   - P&L and Balance Sheet fit an iPhone (no sideways scroll).
//
//   APP_URL=http://localhost:4085 API_URL=http://localhost:4085 E2E_STAFF_COOKIE=... node e2e/money-screens.mjs
// Dev copy or a worktree's own server (owner sign in: scripts/dev-session-token.ts --cookie).
import { chromium, APP, API, signInByCookie, sleep, reporter } from './lib.mjs'
import fs from 'fs'

const { check, finish } = reporter()
const SHOTS = process.env.SHOTS || ''
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await signInByCookie(ctx)
const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e).slice(0, 200)))

const dollars = t => Number(String(t).replace(/[^0-9.-]/g, ''))
async function open(path, clicks = []) {
  await page.goto(APP + path)
  await page.waitForSelector('[data-global-appointment]', { timeout: 30000 })
  await sleep(2000)
  for (const c of clicks) { await page.locator(`button:text-is("${c}"):visible`).first().click(); await sleep(900) }
}
const shot = async name => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }) } }
const attr = (sel, a) => page.locator(sel).first().getAttribute(a)

// What the server says
const api = async p => (await (await ctx.request.get(`${API}${p}`, { headers: { 'X-Staff-Request': '1' } })).json()).data
const year = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric' }).format(new Date())
const received = await api('/api/payments/received')
const cashYtd = received.filter(p => p.paidOn.startsWith(`${year}-`)).reduce((t, p) => t + p.amountCents, 0)
check('payments received load (owner)', Array.isArray(received), `${received.length} payments, ${year}: $${(cashYtd / 100).toFixed(2)}`)

// Billing and the Balance Sheet (read Billing again after, as other tests may add a job in between)
await open('/billing')
await page.waitForSelector('[data-ar-outstanding]')
await sleep(800)
const billing1 = Number(await attr('[data-ar-outstanding]', 'data-ar-outstanding'))
await shot('billing')
await open('/balance-sheet')
await page.waitForSelector('[data-bs-row="ar"]')
await sleep(800)
const ar = Number(await attr('[data-bs-row="ar"]', 'data-cents'))
const [assets, liabEq] = (await attr('[data-bs-totals]', 'data-bs-totals')).split('/').map(Number)
const status = await page.locator('[data-bs-status]').innerText()
await shot('balance-sheet')
await open('/billing')
await page.waitForSelector('[data-ar-outstanding]')
await sleep(800)
const billing2 = Number(await attr('[data-ar-outstanding]', 'data-ar-outstanding'))
check('Balance Sheet receivables = Billing Outstanding', ar === billing1 || ar === billing2, `balance sheet ${ar}, billing ${billing1} / ${billing2}`)
check('Balance Sheet balances (assets = liabilities + equity)', assets === liabEq, `${assets} / ${liabEq}`)
check('Balance Sheet never says "Out of balance", and names what is missing', !/out of balance/i.test(status) && /Not entered yet|Balanced from what is entered/.test(status), status.replace(/\s+/g, ' ').slice(0, 160))

// P&L, both bases
await open('/pandl-statement', ['YTD'])
await page.waitForSelector('[data-pl-revenue]')
await sleep(1000)
const plInstalled = Number(await attr('[data-pl-revenue]', 'data-pl-revenue'))
const plCashShown = Number(await attr('[data-pl-other-basis]', 'data-pl-other-basis'))
await shot('pl-installed')
await page.locator('[data-pl-basis="cash"]').click()
await sleep(800)
const plCash = Number(await attr('[data-pl-revenue]', 'data-pl-revenue'))
await shot('pl-cash')
check('P&L cash revenue YTD = payments received this year', plCash === cashYtd && plCashShown === cashYtd, `P&L ${plCash} (shown under installed: ${plCashShown}), payments ${cashYtd}`)
check('P&L says its revenue basis', /Payments received \(cash\)/.test(await page.locator('body').innerText()))

// Dashboard
await open('/')
const dash = await page.locator('body').innerText()
const dashRevenue = dollars((dash.match(/Revenue this year\s+(\$[\d,]+)/) || [])[1])
const dashMargin = (dash.match(/Gross margin\s+([\d.]+%|—)/) || [])[1]
const dashTarget = await page.locator('[data-dash-target-margin]').innerText().catch(() => '')
check('P&L installed revenue YTD = Dashboard "Revenue this year"', Math.round(plInstalled / 100) === dashRevenue, `P&L ${plInstalled / 100}, dashboard ${dashRevenue}`)

// Reports
await open('/reports')
const rep = await page.locator('body').innerText()
const repMargin = (rep.match(/Gross Margin\s+([\d.]+%|—)/) || [])[1]
check('Dashboard gross margin = Reports gross margin (this year, quotes with costs)', !!dashMargin && dashMargin === repMargin, `dashboard ${dashMargin}, reports ${repMargin}`)
await open('/reports', ['By Style'])
const styleMargins = await page.locator('[data-style-margin]').evaluateAll(els => els.map(e => [e.getAttribute('data-style-margin'), e.getAttribute('data-margin')]))
check('no style shows a 100% margin (quotes without costs are left out)', styleMargins.length > 0 && styleMargins.every(([, m]) => m === '' || Number(m) < 0.95), JSON.stringify(styleMargins))
const styleText = await page.locator('body').innerText()
check('Reports names the Target Margin from Settings', dashTarget && styleText.includes(`Settings › Pricing: ${dashTarget}`), dashTarget)
await shot('reports-style')

// Budget
await open('/budget')
const budgetTarget = await page.locator('[data-budget-target-margin]').innerText()
const net = await page.locator('[data-budget-bucket="Net Profit"]').first().getAttribute('data-actual')
check('Budget Target Margin = Dashboard Target Margin (Settings › Pricing)', budgetTarget === dashTarget, `${budgetTarget} / ${dashTarget}`)
check('Budget net profit is an estimate from real costs, not the old 55%', net === '' || Number(net) < 0.4, net)
await shot('budget')

// iPhone: P&L and Balance Sheet fit
const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
await signInByCookie(phone)
const pp = await phone.newPage()
for (const path of ['/pandl-statement', '/balance-sheet']) {
  await pp.goto(APP + path)
  await pp.waitForSelector('[data-tabbar]', { timeout: 30000 })
  await sleep(2000)
  const over = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check(`${path} fits an iPhone (no sideways scroll)`, over <= 1, `${over}px over`)
  if (SHOTS) await pp.screenshot({ path: `${SHOTS}/phone${path.replace(/\//g, '-')}.png`, fullPage: true })
}

check('no page errors', errors.length === 0, errors.join(' | '))
await browser.close()
process.exit(finish())
