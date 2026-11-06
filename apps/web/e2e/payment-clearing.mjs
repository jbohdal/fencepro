// Received and Cleared on the money screens, as the owner on a phone (WebKit,
// iPhone size). Jonathan, Nov 6 2026: "Yes to all four: Billing counts
// received, with a 'not cleared yet' line. The P&L goes by cleared date. The
// Balance Sheet shows deposits in transit. A job reads Paid only when cleared."
//
//   1. A sold $8,914.27 job (billed $8,914: deposit $4,457, final $4,457); the
//      deposit was cash, already cleared.
//   2. On the job page the owner taps Payment received on the final: check
//      #2201. The receipt the customer sees says Payment received (balance $0),
//      not Paid in full; the job reads "Paid, not cleared yet", never Paid.
//   3. Billing: the Not cleared yet tile is up by $4,457.00 (and its count).
//   4. P&L, payments cleared (cash): revenue unchanged; the not cleared line shows.
//   5. Balance Sheet: Deposits in transit up by $4,457.00; it still balances.
//   6. Back on the job: Cleared. The job reads Paid in full; the P&L is up by
//      $4,457.00 (cleared today); Billing's line and the deposits in transit are
//      back; the customer's receipt link now says Paid in full.
//
//   APP_URL=http://localhost:4011 API_URL=http://localhost:4011 E2E_STAFF_COOKIE=<owner cookie> node e2e/payment-clearing.mjs
// Dev copy or a worktree's own server (owner: scripts/dev-session-token.ts --cookie). Removes what it makes.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit } from 'playwright'
import crypto from 'crypto'
import { execFileSync } from 'child_process'
import { APP, API, STAFF_COOKIE, signInByCookie, sleep, reporter } from './lib.mjs'

const { check, finish } = reporter()
const SHOTS = process.env.E2E_SHOTS || ''
if (!STAFF_COOKIE) { console.error('Set E2E_STAFF_COOKIE (an owner cookie on the dev server).'); process.exit(2) }
const call = async (method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Cookie: `ezbiz_staff=${STAFF_COOKIE}`, 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const uuid = s => /^[0-9a-f-]{36}$/i.test(s)
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }

const stamp = Date.now().toString(36).slice(-6)
const WHO = `Clearing ${stamp}`
const contactId = crypto.randomUUID(), quoteId = crypto.randomUUID()
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
let jobId = null

const browser = await webkit.launch()
try {
  // ── 1. A sold job; its deposit paid in cash and cleared ──
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: WHO, phone: '3525550188', email: 'e2e-clearing@example.invalid', serviceAddress: '14 Cleared Ct, Ocala, FL 34470', leadSource: 'Other' })
  const q = await call('POST', '/api/saved-quotes', {
    id: quoteId, crmContactId: contactId, customerName: `E2E ${WHO}`, customerPhone: '3525550188', customerEmail: 'e2e-clearing@example.invalid', customerAddress: '14 Cleared Ct, Ocala, FL 34470',
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [150], sections: 19, ends: 2, walkGates: 1, materialCost: 4000, laborCost: 2000, totalCOGS: 6000, finalPrice: 8914.27, gmPct: 0.33,
    pullSheet: [], status: 'SENT', date: today, salesRep: 'E2E Salesman', leadSource: 'Other',
    proposal: { version: 1, customer: { name: `E2E ${WHO}`, address: '14 Cleared Ct, Ocala, FL 34470' }, company: { name: 'Getter Done Fence', phone: '3528442677', email: '' }, footageFt: 150, gatesText: '1 walk gate', included: [], depositPct: 50,
      options: [{ label: 'White vinyl privacy', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 8914.27, perFoot: 59.43, sections: 19, snapshot: { materialCost: 4000, laborCost: 2000, tearOutCost: 0, totalCOGS: 6000, gmPct: 0.33, pullSheet: [], runSections: [19] } }] },
  })
  const sold = await call('PATCH', `/api/saved-quotes/${quoteId}`, { status: 'SOLD' })
  const j = await call('POST', '/api/saved-jobs', { quoteId, crmContactId: contactId, customerName: `E2E ${WHO}`, customerPhone: '3525550188', customerEmail: 'e2e-clearing@example.invalid', customerAddress: '14 Cleared Ct, Ocala, FL 34470', fenceStyle: "WV-ND 6'x8' Privacy", quotePrice: 8914.27, contractValue: 8914.27, status: 'staging', sections: 19 })
  jobId = j.json.data?.id ?? null
  check('setup: customer, quote sold, job made', c.status < 300 && q.status < 300 && sold.status < 300 && !!jobId, `${c.status} ${q.status} ${sold.status} ${j.status}`)
  const depId = `e2eclr${stamp}d`
  const dep = await call('POST', '/api/payments', { id: depId, jobId, amountCents: 445700, method: 'cash' })
  const depClear = await call('POST', `/api/payments/${depId}/cleared`, {})
  check('setup: the $4,457.00 cash deposit recorded and cleared', dep.status === 201 && depClear.status === 200, `${dep.status} ${depClear.status}`)

  // ── The owner's phone ──
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true })
  await signInByCookie(ctx)
  const errors = []
  let page
  const open = async path => {
    if (page) await page.close().catch(() => {})
    page = await ctx.newPage()
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    page.on('dialog', d => d.accept().catch(() => {}))
    await page.goto(APP + path)
    return page
  }
  const tap = async loc => { await loc.scrollIntoViewIfNeeded(); await loc.waitFor({ state: 'visible', timeout: 15000 }); await loc.tap(); await sleep(300) }
  const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/clearing-${name}.png`, fullPage: false }).catch(() => {}) }
  const cents = async (sel, attr) => Number(await (await until(async () => { const l = page.locator(sel).first(); return (await l.count()) ? l : null }, 30000)).getAttribute(attr))
  const noSideways = async () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)

  // Each screen's number before the check (other received payments on the dev copy are in it too).
  await open('/billing')
  const billing0 = await cents('[data-billing-not-cleared]', 'data-billing-not-cleared')
  await open('/pandl-statement')
  await tap(page.locator('[data-pl-basis="cash"]'))
  const pl0 = await cents('[data-pl-revenue]', 'data-pl-revenue')
  await open('/balance-sheet')
  const transit0 = await cents('[data-bs-row="in-transit"]', 'data-cents')

  // ── 2. The final by check, on the job page ──
  await open(`/operations?job=${jobId}`)
  const fin = page.locator(`[data-payment-schedule="${jobId}"] [data-payment-received="final"]`)
  await fin.waitFor({ timeout: 40000 })
  await tap(fin)
  const S = page.locator('[data-payment-sheet]')
  check('the payment form is filled in with the $4,457.00 final', (await S.locator('[data-payment-amount]').inputValue()) === '4457.00')
  await tap(S.locator('[data-payment-method="check"]'))
  await S.locator('[data-payment-check-number]').fill('2201')
  await tap(S.locator('[data-payment-save]'))
  const R = page.locator('[data-receipt-screen]')
  await R.waitFor({ timeout: 20000 })
  await until(async () => (await R.locator('[data-receipt-status]').getAttribute('data-receipt-status')) === 'saved', 20000)
  check('receipt (customer sees it): Payment received, balance $0.00, not Paid in full', await R.locator('[data-receipt-waiting-on-bank]').isVisible() && !(await R.locator('[data-receipt-paid-in-full]').isVisible()) && (await R.locator('[data-receipt-balance]').innerText()) === '$0.00')
  await shot('1-receipt-payment-received')
  await tap(R.locator('[data-receipt-done]'))
  const finPay = sql(`SELECT id || '|' || (SELECT token FROM "Receipt" r WHERE r."paymentId" = p.id) FROM "ContractPayment" p WHERE "jobId" = '${jobId}' AND "checkNumber" = '2201'`).split('|')
  const status = page.locator('[data-job-payment-status]').first()
  const st1 = await until(async () => { const t = await status.innerText(); return /not cleared/.test(t) ? t : null }, 20000)
  check('job: reads "Paid, not cleared yet", never Paid in full', !!st1 && !/Paid in full/.test(st1), st1 || await status.innerText())
  check('job Payments: the badge says Paid, not cleared yet; the final invoice too', await page.locator(`[data-payment-schedule="${jobId}"] [data-paid-not-cleared]`).isVisible() && (await page.locator(`[data-payment-schedule="${jobId}"] [data-invoice="final"] [data-invoice-balance]`).innerText()) === 'Paid, not cleared yet')
  const jr = sql(`SELECT status || '|' || "paymentStatus" FROM "SavedJob" WHERE id = '${jobId}'`)
  check('job record: not Paid (payment status Partial)', jr.endsWith('|partial'), jr)
  await shot('2-job-not-cleared')
  const page1 = await (await fetch(`${API}/p/r/${finPay[1]}`)).text()
  check('the customer\'s receipt link: Payment received, not Paid in full', page1.includes('data-receipt-waiting-on-bank') && !page1.includes('data-receipt-paid-in-full'))

  // ── 3. Billing ──
  await open('/billing')
  const billing1 = await until(async () => { const v = await cents('[data-billing-not-cleared]', 'data-billing-not-cleared'); return v === billing0 + 445700 ? v : null }, 20000)
  check('Billing: Not cleared yet is up by $4,457.00', billing1 === billing0 + 445700, `${billing0} -> ${billing1}`)
  check('Billing: fits the phone (no sideways scroll)', await noSideways())
  await shot('3-billing')
  await tap(page.getByRole('button', { name: 'Payments', exact: true }))
  const row = page.locator(`[data-billing-payment]:has([data-payment-job="${jobId}"])`)
  await row.first().waitFor({ timeout: 20000 })
  check('Billing > Payments: both payments listed (received counts), the check marked Not cleared yet', await row.count() === 2 && await row.locator('[data-payment-not-cleared]').count() === 1, `${await row.count()} rows`)
  check('Billing > Payments: the not cleared line', await page.locator('[data-payments-not-cleared]').isVisible())

  // ── 4. P&L ──
  await open('/pandl-statement')
  await tap(page.locator('[data-pl-basis="cash"]'))
  const pl1 = await cents('[data-pl-revenue]', 'data-pl-revenue')
  check('P&L (payments cleared): revenue unchanged by the check not cleared', pl1 === pl0, `${pl0} -> ${pl1}`)
  check('P&L: the not cleared line names it', Number(await page.locator('[data-pl-not-cleared]').getAttribute('data-pl-not-cleared')) === billing1)
  await shot('4-pl')

  // ── 5. Balance Sheet ──
  await open('/balance-sheet')
  const transit1 = await until(async () => { const v = await cents('[data-bs-row="in-transit"]', 'data-cents'); return v === transit0 + 445700 ? v : null }, 20000)
  check('Balance Sheet: Deposits in transit up by $4,457.00', transit1 === transit0 + 445700, `${transit0} -> ${transit1}`)
  const [a, le] = String(await page.locator('[data-bs-totals]').getAttribute('data-bs-totals')).split('/').map(Number)
  check('Balance Sheet: still balances', a === le, `${a} / ${le}`)
  check('Balance Sheet: fits the phone (no sideways scroll)', await noSideways())
  await shot('5-balance-sheet')

  // ── 6. Cleared ──
  await open(`/operations?job=${jobId}`)
  const payRow = page.locator(`[data-payment="${finPay[0]}"]`)
  await payRow.waitFor({ timeout: 40000 })
  await tap(payRow.locator('[data-payment-cleared]'))
  const st2 = await until(async () => { const t = await page.locator('[data-job-payment-status]').first().innerText(); return t === 'Paid in full' ? t : null }, 20000)
  check('Cleared: the job reads Paid in full', st2 === 'Paid in full', st2 || await page.locator('[data-job-payment-status]').first().innerText())
  check('Cleared: the badge says Paid in full', await page.locator(`[data-payment-schedule="${jobId}"] [data-paid-in-full]`).isVisible())
  check('Cleared: the job record is Paid', sql(`SELECT "paymentStatus" FROM "SavedJob" WHERE id = '${jobId}'`) === 'paid')
  await shot('6-job-paid')
  await open('/pandl-statement')
  await tap(page.locator('[data-pl-basis="cash"]'))
  const pl2 = await until(async () => { const v = await cents('[data-pl-revenue]', 'data-pl-revenue'); return v === pl0 + 445700 ? v : null }, 20000)
  check('P&L: up by $4,457.00 once cleared (the day it cleared)', pl2 === pl0 + 445700, `${pl0} -> ${pl2}`)
  await open('/billing')
  check('Billing: Not cleared yet back where it was', await cents('[data-billing-not-cleared]', 'data-billing-not-cleared') === billing0)
  await open('/balance-sheet')
  check('Balance Sheet: deposits in transit back where they were', await cents('[data-bs-row="in-transit"]', 'data-cents') === transit0)
  const page2 = await (await fetch(`${API}/p/r/${finPay[1]}`)).text()
  check('the customer\'s receipt link now says Paid in full', page2.includes('data-receipt-paid-in-full') && !page2.includes('data-receipt-waiting-on-bank'))
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
} finally {
  await browser.close().catch(() => {})
  // Remove what this made. Dev database only, named on every command.
  try {
    if (![contactId, quoteId].every(uuid) || (jobId && !/^[A-Za-z0-9-]+$/.test(jobId))) throw new Error('bad id')
    const jl = jobId ? `'${jobId}'` : "'-'"
    const ids = `SELECT id FROM "ContractPayment" WHERE "jobId" = ${jl}`
    sql(`DELETE FROM "CrmAuditLog" WHERE "entityId" IN (${ids}) OR "entityId" IN (SELECT id FROM "Receipt" WHERE "jobId" = ${jl}) OR "entityId" IN (${jl}, '${quoteId}', '${contactId}')`)
    sql(`DELETE FROM "PortalFile" WHERE id IN (SELECT "portalFileId" FROM "Receipt" WHERE "jobId" = ${jl})`)
    sql(`DELETE FROM "Receipt" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "PaymentApplication" WHERE "paymentId" IN (${ids})`)
    sql(`DELETE FROM "ContractPayment" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}'`)
    sql(`DELETE FROM "AutomationEvent" WHERE "entityId" IN (${jl}, '${quoteId}', '${contactId}')`)
    sql(`DELETE FROM "AutomationRun" WHERE "entityId" IN (${jl}, '${quoteId}', '${contactId}')`)
    sql(`DELETE FROM "JobChecklistItem" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "SavedJob" WHERE id = ${jl}`) // its schedule, invoices and billing log go with it
    sql(`DELETE FROM "SavedQuote" WHERE id = '${quoteId}'`)
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === contactId).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
    check('cleaned up (payments, receipts, job, quote, customer)', sql(`SELECT count(*) FROM "ContractPayment" WHERE "jobId" = ${jl}`) === '0' && sql(`SELECT count(*) FROM "SavedJob" WHERE id = ${jl}`) === '0' && sql(`SELECT count(*) FROM "CrmContact" WHERE id = '${contactId}'`) === '0')
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 200)) }
}
process.exit(finish())
