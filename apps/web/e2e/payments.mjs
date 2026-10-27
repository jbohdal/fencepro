// Payment received and the receipt, on a phone, with and without signal
// (Payments.tsx, paymentsStore.ts; server lib/contractBilling.ts). See README.md.
//
//   1. A quote sold for $8,914.27 (marked Sold, its job made, as the app does):
//      the job's Deposit is $4,457.14 and its Final $4,457.13.
//   2. On the phone, the job page, no signal: Payment received, check #1042 for
//      the deposit. The receipt shows at once with its real number (set aside
//      while the phone had signal), the amount, the check number, the balance,
//      "Saved on this phone". Email asked for with no signal waits.
//   3. Signal back: the payment saves once (one payment, one receipt, the same
//      number), the email is attempted (the dev copy has no email settings:
//      "not set up", nothing sent), the receipt link opens in a fresh browser
//      with no sign in, and its PDF has the right numbers.
//   4. A short payment (cash): the rest stays on the balance.
//   5. A Salesman records one in the field (straight to the server, with a
//      Salesman's own sign in): it is in "Payments to confirm"; the owner
//      confirms it and its receipt does not change.
//   6. The final payment: Paid in full, the warranty, the lien release (DRAFT)
//      on the PDF. Voided (its receipt says VOID), then made again.
//   7. The customer page Billing and the pipeline card window show the schedule.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<owner> node e2e/payments.mjs
//   On the Android emulator's Chrome: adb reverse tcp:4001 tcp:4001;
//   adb forward tcp:9333 localabstract:chrome_devtools_remote; CDP_URL=http://localhost:9333 node e2e/payments.mjs
//
// Everything it makes is removed at the end. Dev copy only.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes customers, quotes, jobs and payments on the shared dev copy
import { webkit, chromium } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import zlib from 'zlib'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const CDP = process.env.CDP_URL || ''
const SHOTS = process.env.E2E_SHOTS || ''
const NAME = CDP ? 'android' : 'webkit'
// A dev server on this machine (the shared 4001, or a worktree's own port); devOnly.mjs already refuses live (4000).
const DEV_URL = /^http:\/\/(localhost|127\.0\.0\.1):(?!4000\b)\d+/
if (!DEV_URL.test(APP) || !DEV_URL.test(API)) { console.error('Refusing to run: a dev server on this machine only (e.g. localhost:4001).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (method, p, body, token = OWNER) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
async function until(fn, ms = 30000, every = 500) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const uuid = s => /^[0-9a-f-]{36}$/i.test(s)
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `dev-payments-${NAME}-${name}.png`) }).catch(() => {}) }

/** The words in a pdfkit PDF (as apps/portal/tests/pdfText.ts). */
function pdfText(buf) {
  const raw = buf.toString('latin1'), parts = []
  for (const s of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = s[1]
    try { body = zlib.inflateSync(Buffer.from(s[1], 'latin1')).toString('latin1') } catch { /* not compressed */ }
    if (!/\bBT\b/.test(body)) continue
    for (const r of body.matchAll(/\[([^\]]*)\]\s*TJ|(<[0-9a-fA-F\s]*>|\([^)]*\))\s*Tj/g)) {
      let out = ''
      for (const m of (r[1] ?? r[2]).matchAll(/<([0-9a-fA-F\s]*)>|\(([^)]*)\)/g)) {
        if (m[1] !== undefined) { const h = m[1].replace(/\s+/g, ''); for (let i = 0; i + 1 < h.length; i += 2) out += String.fromCharCode(parseInt(h.slice(i, i + 2), 16)) } else out += m[2]
      }
      parts.push(out)
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim()
}

const stamp = Date.now().toString(36).slice(-6)
const WHO = `Payments ${NAME} ${stamp}`
const contactId = crypto.randomUUID(), cardId = crypto.randomUUID(), quoteId = crypto.randomUUID()
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
let jobId = null, salesSession = null
const PORTAL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../portal')

const browser = CDP ? await chromium.connectOverCDP(CDP) : await webkit.launch()
const desk = await chromium.launch()
let cdp = null
try {
  // ── 1. Sold: a customer with a card, a quote marked Sold, its job (the app's own calls) ──
  const c = await call('POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: WHO, phone: '3525550187', email: 'e2e-payments@example.invalid', serviceAddress: '12 Receipt Rd, Ocala, FL 34470', leadSource: 'Other', lead: { id: cardId, customerId: contactId, firstName: 'E2E', lastName: WHO, phone: '3525550187', stage: 'Signed Contract', leadSource: 'Other', quoteId, createdAt: today, lastMoved: today }, leadBefore: null })
  const q = await call('POST', '/api/saved-quotes', {
    id: quoteId, crmContactId: contactId, customerName: `E2E ${WHO}`, customerPhone: '3525550187', customerEmail: 'e2e-payments@example.invalid', customerAddress: '12 Receipt Rd, Ocala, FL 34470',
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [150], sections: 19, ends: 2, walkGates: 1, materialCost: 4000, laborCost: 2000, totalCOGS: 6000, finalPrice: 8914.27, gmPct: 0.33,
    pullSheet: [], status: 'SENT', date: today, salesRep: 'E2E Salesman', leadSource: 'Other',
    proposal: { version: 1, customer: { name: `E2E ${WHO}`, address: '12 Receipt Rd, Ocala, FL 34470' }, company: { name: 'Getter Done Fence', phone: '3527894314', email: '' }, footageFt: 150, gatesText: '1 walk gate', included: [], depositPct: 50,
      options: [{ label: 'White vinyl privacy', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 8914.27, perFoot: 59.43, sections: 19, snapshot: { materialCost: 4000, laborCost: 2000, tearOutCost: 0, totalCOGS: 6000, gmPct: 0.33, pullSheet: [], runSections: [19] } }] },
  })
  const sold = await call('PATCH', `/api/saved-quotes/${quoteId}`, { status: 'SOLD' })
  const j = await call('POST', '/api/saved-jobs', { quoteId, crmContactId: contactId, customerName: `E2E ${WHO}`, customerPhone: '3525550187', customerEmail: 'e2e-payments@example.invalid', customerAddress: '12 Receipt Rd, Ocala, FL 34470', fenceStyle: "WV-ND 6'x8' Privacy", quotePrice: 8914.27, contractValue: 8914.27, status: 'staging', sections: 19 })
  jobId = j.json.data?.id ?? null
  check('setup: customer, quote sold, job made', c.status < 300 && q.status < 300 && sold.status < 300 && !!jobId, `${c.status} ${q.status} ${sold.status} ${j.status}`)
  const sched = (await call('GET', `/api/payments/job/${jobId}`)).json.data?.schedule
  const dep = sched?.invoices.find(i => i.kind === 'deposit'), fin = sched?.invoices.find(i => i.kind === 'final')
  check('sold: the deposit invoice is $4,457.14, the final $4,457.13 (adds up to $8,914.27)', dep?.amountCents === 445714 && fin?.amountCents === 445713, `${dep?.amountCents} ${fin?.amountCents}`)

  // ── 2. The phone, on the job page ──
  const ctx = CDP ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true })
  const setToken = t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }
  if (CDP) { const p0 = await ctx.newPage(); await p0.goto(APP); await p0.evaluate(setToken, OWNER); await p0.close() }
  else await ctx.addInitScript(setToken, OWNER)
  // A text hands off to the phone's texting app: record the link and stay.
  await ctx.addInitScript(() => {
    window.__sms = []
    window.addEventListener('click', e => { const a = e.target instanceof Element ? e.target.closest('a[href^="sms:"]') : null; if (a) { window.__sms.push(a.getAttribute('href')); e.preventDefault() } }, true)
  })
  const errors = []
  let reserved = 0
  let page
  // A new tab (a long session on WebKit can crash when a page is opened over it again).
  const openPage = async () => {
    if (page) await page.close().catch(() => {})
    page = await ctx.newPage()
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    page.on('dialog', d => d.accept().catch(() => {}))
    page.on('response', r => { if (r.url().endsWith('/api/payments/receipt-numbers') && r.status() === 200) reserved++ })
    return page
  }
  await openPage()
  const R = () => page.locator('[data-receipt-screen]')
  const S = () => page.locator('[data-payment-sheet]')
  const tap = async loc => { await loc.scrollIntoViewIfNeeded(); await loc.waitFor({ state: 'visible', timeout: 15000 }); await (CDP ? loc.click() : loc.tap()); await sleep(250) }
  const offline = async on => {
    if (CDP) {
      cdp ??= await page.context().newCDPSession(page)
      await cdp.send('Network.enable')
      await cdp.send('Network.emulateNetworkConditions', { offline: on, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
    } else await ctx.setOffline(on)
  }
  await page.goto(`${APP}/operations?job=${jobId}`)
  await page.waitForSelector(`[data-payment-schedule="${jobId}"]`, { timeout: 40000 })
  await until(async () => reserved > 0, 15000)
  check('the phone set receipt numbers aside while it had signal', reserved > 0)
  const depBtn = page.locator(`[data-payment-schedule="${jobId}"] [data-payment-received="deposit"]`)
  check('job page: Payment received on the deposit, filled in with $4,457.14', /\$4,457\.14/.test(await depBtn.innerText()))
  check('job page: the final shows due on completion', /Due on completion/.test(await page.locator('[data-invoice="final"]').innerText()))
  await shot(page, '1-schedule')

  // No signal.
  await offline(true)
  await sleep(500)
  const t0 = Date.now()
  await tap(depBtn)
  check('the form opens filled in with the amount due', (await S().locator('[data-payment-amount]').inputValue()) === '4457.14')
  await tap(S().locator('[data-payment-method="check"]'))
  await S().locator('[data-payment-check-number]').fill('1042')
  await shot(page, '2-payment-form')
  await tap(S().locator('[data-payment-save]'))
  await R().waitFor({ state: 'visible', timeout: 10000 })
  check('no signal: the receipt is on screen at once', Date.now() - t0 < 30000, `${Math.round((Date.now() - t0) / 1000)} s from the tap`)
  const shownNumber = Number(await R().locator('[data-receipt-number]').getAttribute('data-receipt-number'))
  check('no signal: it has its real receipt number', shownNumber > 1000, String(shownNumber))
  check('no signal: amount, check number, deposit, balance', (await R().locator('[data-receipt-amount]').innerText()) === '$4,457.14' && /Check #1042/.test(await R().locator('[data-receipt-method]').innerText()) && /Deposit/.test(await R().locator('[data-receipt-for]').innerText()) && (await R().locator('[data-receipt-balance]').innerText()) === '$4,457.13')
  check('no signal: says it is saved on this phone', (await R().locator('[data-receipt-status]').getAttribute('data-receipt-status')) === 'waiting')
  check('no signal: not on the server yet', sql(`SELECT count(*) FROM "ContractPayment" WHERE "jobId" = '${jobId}'`) === '0')
  // Text: the phone's own texting app, with the saved phone and the receipt link.
  await tap(R().locator('[data-receipt-text]'))
  const sms = await page.evaluate(() => window.__sms.slice(-1)[0] || '')
  const link = decodeURIComponent(sms).match(/https?:\/\/\S+\/p\/r\/[A-Za-z0-9_-]+/)?.[0] ?? ''
  check('Text opens the texting app to the saved phone with the receipt link', /^sms:3525550187\?body=/.test(sms) && !!link, sms.slice(0, 80))
  check('the email is the saved one', (await R().locator('[data-receipt-email]').inputValue()) === 'e2e-payments@example.invalid')
  await tap(R().locator('[data-receipt-email-send]'))
  check('no signal: the email waits for signal', (await R().locator('[data-receipt-email-status]').getAttribute('data-receipt-email-status')) === 'waiting')
  await shot(page, '3-receipt-no-signal')

  // ── 3. Signal back ──
  await offline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  const savedOnce = await until(async () => sql(`SELECT count(*) FROM "Receipt" WHERE "jobId" = '${jobId}' AND "emailStatus" IS NOT NULL`) === '1', 45000)
  check('signal back: the payment and its receipt are saved, the email attempted', !!savedOnce)
  await sleep(3000)
  check('saved once: one payment, one receipt', sql(`SELECT count(*) FROM "ContractPayment" WHERE "jobId" = '${jobId}'`) === '1' && sql(`SELECT count(*) FROM "Receipt" WHERE "jobId" = '${jobId}'`) === '1')
  const r1 = sql(`SELECT number || '|' || token || '|' || coalesce("emailStatus",'') || '|' || coalesce("portalFileId",'') FROM "Receipt" WHERE "jobId" = '${jobId}'`).split('|')
  check('the server receipt has the number shown with no signal', Number(r1[0]) === shownNumber, r1[0])
  check('the email went through the server (dev: not set up, nothing sent)', r1[2] === 'not_configured', r1[2])
  check('the receipt is in the customer\'s Documents', !!r1[3])
  check('the link is the receipt\'s', link.endsWith(`/p/r/${r1[1]}`))
  await until(async () => (await R().locator('[data-receipt-status]').getAttribute('data-receipt-status')) === 'saved', 15000)
  check('the receipt screen says Saved', (await R().locator('[data-receipt-status]').getAttribute('data-receipt-status')) === 'saved')
  check('the email result shows on the receipt', (await R().locator('[data-receipt-email-status]').getAttribute('data-receipt-email-status')) === 'not_configured')
  // A fresh browser, no sign in.
  const fresh = await desk.newContext()
  const fp = await fresh.newPage()
  await fp.goto(link.replace(/^https?:\/\/[^/]+/, APP))
  check('the link opens with no sign in', (await fp.locator('[data-receipt-amount]').getAttribute('data-receipt-amount')) === '445714' && Number(await fp.locator('[data-receipt-number]').getAttribute('data-receipt-number')) === shownNumber)
  await fresh.close()
  const pdfRes = await fetch(`${API}/p/r/${r1[1]}.pdf`)
  const pdf = pdfText(Buffer.from(await pdfRes.arrayBuffer()))
  check('the PDF downloads with the right numbers', /application\/pdf/.test(pdfRes.headers.get('content-type') || '') && pdf.includes(`Receipt ${shownNumber}`) && pdf.includes('$4,457.14') && pdf.includes('Check #1042') && pdf.includes('$8,914.27') && pdf.includes('$4,457.13'), pdf.slice(0, 160))
  await tap(R().locator('[data-receipt-done]'))

  // ── 4. A short payment: cash $2,000.00 on the final ──
  const finBtn = page.locator(`[data-payment-schedule="${jobId}"] [data-payment-received="final"]`)
  await finBtn.waitFor({ state: 'visible', timeout: 15000 })
  await tap(finBtn)
  await S().locator('[data-payment-amount]').fill('2000.00')
  await tap(S().locator('[data-payment-method="cash"]'))
  await tap(S().locator('[data-payment-save]'))
  await R().waitFor({ state: 'visible' })
  check('short payment: the balance carries ($2,457.13 left)', (await R().locator('[data-receipt-balance]').innerText()) === '$2,457.13')
  await until(async () => (await R().locator('[data-receipt-status]').getAttribute('data-receipt-status')) === 'saved', 20000)
  await tap(R().locator('[data-receipt-done]'))
  await until(async () => /Left \$2,457\.13/.test(await page.locator('[data-invoice="final"]').innerText()), 15000)
  check('job page: the final shows $2,457.13 left', /Left \$2,457\.13/.test(await page.locator('[data-invoice="final"]').innerText()))

  // ── 5. A Salesman in the field; the owner confirms ──
  const repEmail = sql(`SELECT email FROM "CrmUser" WHERE role = 'sales_rep' AND status = 'active' ORDER BY "createdAt" LIMIT 1`)
  const tokFile = path.join(os.tmpdir(), `e2e-payments-sales-${stamp}.txt`)
  execFileSync(path.join(PORTAL_DIR, 'node_modules/.bin/tsx'), ['scripts/dev-session-token.ts', '--email', repEmail, '--days', '1', '--out', tokFile], { cwd: PORTAL_DIR, stdio: 'ignore' })
  const SALES = fs.readFileSync(tokFile, 'utf8').trim(); fs.rmSync(tokFile)
  salesSession = JSON.parse(Buffer.from(SALES.split('.')[1], 'base64url').toString()).sid
  const sp = await call('POST', '/api/payments', { id: `e2esales${stamp}`, jobId, amountCents: 45713, method: 'zelle', paidOn: today }, SALES)
  check('a Salesman records a payment in the field', sp.status === 201 && sp.json.data?.payment?.needsConfirm === true, String(sp.status))
  const salesReceipt = JSON.stringify(sp.json.data?.receipt?.says)
  await openPage()
  await page.goto(`${APP}/billing`)
  const tc = page.locator(`[data-to-confirm="e2esales${stamp}"]`)
  await tc.waitFor({ state: 'visible', timeout: 30000 })
  check('owner: it is in Payments to confirm', await tc.isVisible())
  await shot(page, '4-to-confirm')
  await tap(tc.locator('[data-to-confirm-button]'))
  const confirmed = await until(async () => sql(`SELECT count(*) FROM "ContractPayment" WHERE id = 'e2esales${stamp}' AND "confirmedAt" IS NOT NULL`) === '1', 15000)
  check('confirmed by the owner', !!confirmed)
  const after = JSON.stringify((await call('GET', `/api/payments/job/${jobId}`)).json.data.schedule.payments.find(p => p.id === `e2esales${stamp}`)?.receipt?.says)
  check('the receipt did not change', after === salesReceipt, after === salesReceipt ? '' : `${salesReceipt?.slice(0, 120)} / ${after?.slice(0, 120)}`)

  // ── 6. The final payment: Paid in full, the warranty, the lien release; void and redo ──
  async function payFinal(lien) {
    await openPage()
    await page.goto(`${APP}/operations?job=${jobId}`)
    await page.waitForSelector(`[data-payment-schedule="${jobId}"] [data-payment-received="final"]`, { timeout: 30000 })
    await tap(page.locator(`[data-payment-schedule="${jobId}"] [data-payment-received="final"]`))
    check('the form is filled in with the $2,000.00 left', (await S().locator('[data-payment-amount]').inputValue()) === '2000.00')
    await S().locator('[data-payment-check-number]').fill('1043')
    check('paying it all offers the lien release, marked DRAFT', /DRAFT/.test(await S().locator('[data-lien-release]').innerText()))
    if (lien) await tap(S().locator('[data-lien-release-tick]'))
    await tap(S().locator('[data-payment-save]'))
    await R().waitFor({ state: 'visible' })
    await until(async () => (await R().locator('[data-receipt-status]').getAttribute('data-receipt-status')) === 'saved', 20000)
  }
  await payFinal(true)
  check('final: Paid in full with the warranty', await R().locator('[data-receipt-paid-in-full]').isVisible() && /Lifetime Craftsmanship Warranty/.test(await R().locator('[data-receipt-warranty]').innerText()), await R().locator('[data-receipt-warranty]').innerText().catch(() => ''))
  check('final: the balance is $0.00', (await R().locator('[data-receipt-balance]').innerText()) === '$0.00')
  await shot(page, '5-paid-in-full')
  const fin1 = sql(`SELECT r.token || '|' || r."paymentId" FROM "Receipt" r JOIN "ContractPayment" p ON p.id = r."paymentId" WHERE r."jobId" = '${jobId}' AND p."checkNumber" = '1043'`).split('|')
  const fpdf = pdfText(Buffer.from(await (await fetch(`${API}/p/r/${fin1[0]}.pdf`)).arrayBuffer()))
  check('final PDF: Paid in full, the warranty, the install date note, the DRAFT lien release', fpdf.includes('Paid in full') && fpdf.includes('Lifetime Craftsmanship Warranty') && fpdf.includes('starts on the install date') && fpdf.includes('WAIVER AND RELEASE OF LIEN UPON FINAL PAYMENT') && fpdf.includes('DRAFT'))
  await tap(R().locator('[data-receipt-done]'))
  // Void it.
  const row = page.locator(`[data-payment="${fin1[1]}"]`)
  await tap(row.locator('[data-void-payment]'))
  await row.locator('[data-void-reason]').fill('E2E: typed the wrong check')
  await tap(row.locator('[data-void-confirm]'))
  await until(async () => await row.locator('[data-payment-void]').isVisible(), 15000)
  check('void: the payment and its receipt are void', sql(`SELECT count(*) FROM "Receipt" WHERE token = '${fin1[0]}' AND "voidedAt" IS NOT NULL`) === '1' && /VOID/.test(await (await fetch(`${API}/p/r/${fin1[0]}`)).text()))
  check('void: the final is open again ($2,000.00 left)', /Left \$2,000\.00/.test(await page.locator('[data-invoice="final"]').innerText()))
  check('void: in the audit log', sql(`SELECT count(*) FROM "CrmAuditLog" WHERE action = 'voided' AND "entityId" = '${fin1[1]}'`) === '1')
  await payFinal(false)
  check('redo: Paid in full again', await R().locator('[data-receipt-paid-in-full]').isVisible())
  await tap(R().locator('[data-receipt-done]'))

  // ── 7. The customer page and the card window show the schedule ──
  await openPage()
  await page.goto(`${APP}/customers/${contactId}`)
  await tap(page.locator('[data-customer-tab="billing"]'))
  await page.waitForSelector(`[data-payment-schedule="${jobId}"]`, { timeout: 20000 })
  check('customer page Billing: the schedule, paid in full', await page.locator(`[data-payment-schedule="${jobId}"] [data-paid-in-full]`).isVisible())
  await openPage()
  await page.goto(`${APP}/pipeline?card=${cardId}`)
  check('card window: Payments', !!(await until(async () => await page.locator(`[data-card-payments] [data-payment-schedule="${jobId}"]`).isVisible(), 20000)))
  await shot(page, '6-card-window')
  // Billing > Payments: every payment received on the schedule (not the voided one), each with its receipt (audit fix Oct 27 2026).
  await openPage()
  await page.goto(`${APP}/billing`)
  await tap(page.getByRole('button', { name: 'Payments', exact: true }))
  await page.waitForSelector('[data-billing-payments] [data-payments-total]', { timeout: 20000 })
  const live = sql(`SELECT count(*) FROM "ContractPayment" WHERE "jobId" = '${jobId}' AND "voidedAt" IS NULL`)
  const rows = page.locator(`[data-billing-payment]:has([data-payment-job="${jobId}"])`)
  check('Billing > Payments: this job\'s payments, the voided one left out, each with its receipt', String(await rows.count()) === live && await rows.locator('[data-payment-receipt]').count() === Number(live), `${await rows.count()} shown, ${live} not voided`)
  const total = Number(await page.locator('[data-payments-total]').getAttribute('data-payments-total'))
  const cash = (await call('GET', '/api/payments/received')).json.data.reduce((t, r) => t + r.amountCents, 0)
  check('Billing > Payments: the total is at least the cash the P&L counts from the schedules', total >= cash, `${total} vs ${cash}`)
  check('no page errors', errors.length === 0, errors.join(' | '))
  if (!CDP) await ctx.close(); else await page.close()
} finally {
  if (CDP) { try { await cdp?.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }) } catch { /* page gone */ } }
  await browser.close().catch(() => {})
  await desk.close()
  // Remove what this made. Dev database only, named on every command.
  try {
    if (![contactId, cardId, quoteId].every(uuid) || (jobId && !/^[A-Za-z0-9-]+$/.test(jobId))) throw new Error('bad id')
    const jl = jobId ? `'${jobId}'` : "'-'"
    for (const k of sql(`SELECT f."fileKey" FROM "PortalFile" f JOIN "Receipt" r ON r."portalFileId" = f.id WHERE r."jobId" = ${jl}`).split('\n').filter(Boolean)) fs.rmSync(path.join(PORTAL_DIR, 'uploads', k), { force: true })
    for (const k of sql(`SELECT "photoKey" FROM "ContractPayment" WHERE "jobId" = ${jl} AND "photoKey" IS NOT NULL`).split('\n').filter(Boolean)) fs.rmSync(path.join(PORTAL_DIR, 'uploads', k), { force: true })
    const ids = `SELECT id FROM "ContractPayment" WHERE "jobId" = ${jl}`
    sql(`DELETE FROM "CrmAuditLog" WHERE "entityId" IN (${ids}) OR "entityId" IN (SELECT id FROM "Receipt" WHERE "jobId" = ${jl}) OR "entityId" IN (${jl}, '${quoteId}', '${contactId}')`)
    sql(`DELETE FROM "PortalFile" WHERE id IN (SELECT "portalFileId" FROM "Receipt" WHERE "jobId" = ${jl})`)
    sql(`DELETE FROM "Receipt" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "PaymentApplication" WHERE "paymentId" IN (${ids})`)
    sql(`DELETE FROM "ContractPayment" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "ContractAdjustment" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "JobQuotedCost" WHERE "quoteId" = '${quoteId}'`)
    sql(`DELETE FROM "AutomationEvent" WHERE "entityId" IN (${jl}, '${quoteId}', '${cardId}', '${contactId}')`)
    sql(`DELETE FROM "JobChecklistItem" WHERE "jobId" = ${jl}`)
    sql(`DELETE FROM "SavedJob" WHERE id = ${jl}`)  // its schedule, invoices and billing log go with it
    sql(`DELETE FROM "SavedQuote" WHERE id = '${quoteId}'`)
    if (salesSession && uuid(salesSession)) sql(`DELETE FROM "CrmUserSession" WHERE id = '${salesSession}'`)
    const pl = (await call('GET', '/api/pipeline')).json
    const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === contactId || l.id === cardId).map(l => l.id)
    if (mine.length) await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })
    await call('DELETE', `/api/crm-contacts/${contactId}`)
    sql(`DELETE FROM "CrmContact" WHERE id = '${contactId}'`)
    check('cleaned up (payments, receipts, files, job, quote, customer, card)', sql(`SELECT count(*) FROM "ContractPayment" WHERE "jobId" = ${jl}`) === '0' && sql(`SELECT count(*) FROM "PaymentSchedule" WHERE "jobId" = ${jl}`) === '0' && sql(`SELECT count(*) FROM "CrmContact" WHERE id = '${contactId}'`) === '0')
  } catch (e) { check('cleaned up', false, String(e?.message || e).slice(0, 200)) }
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
