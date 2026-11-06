// A discount on the main option only (Jonathan, Nov 2 2026): "A discount on one option must never change the price of
// the other options." On the dev copy (run `pnpm -s build` in apps/web first).
//
//   APP_URL=http://localhost:4120 API_URL=http://localhost:4120 E2E_STAFF_COOKIE=<owner cookie value> \
//   SALES_COOKIE=<Salesman cookie value> [SHOTS=<folder>] node e2e/discount-options.mjs
//
// The owner and Christa, each on a phone sized WebKit (iPhone): one drawn yard, aluminum with a chain link option and a
// vinyl option added (three options, mixed styles); $500 off the main option. The main option drops $500, the other two
// stay at their price; Make main moves the $500 to the new main option and back. Saved, sent with the Discount line;
// the customer reads the Discount on the main option only, signs the chain link at its own price; the quote, job,
// deposit, Sales Order and contract are that price, with no discount on the record.
// Removes everything it made (hard deletes on ezbiz_dev only, by id).
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit } from 'playwright'
import { execFileSync } from 'child_process'
import { signInByCookie, pickStyle, walkFence, sidesOf } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const OWNER = process.env.E2E_STAFF_COOKIE || ''
const SALES = process.env.SALES_COOKIE || ''
const SHOTS = process.env.SHOTS || ''
if (!OWNER || !SALES) { console.error('Set E2E_STAFF_COOKIE and SALES_COOKIE.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const dollars = s => Number(String(s).replace(/[^0-9.]/g, ''))
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
const run = Date.now().toString(36)
const made = []

async function phone(browser, cookie) {
  const ctx = await browser.newContext(PHONE)
  await signInByCookie(ctx, { cookie, api: API })
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  return { ctx, page, errors }
}

/** A new quote up to the Price step: the same drawn yard every time. */
async function quoteUpToPrice(page, name, styleText) {
  const sides = [['Left return', '20', 'Walk gate'], ['Left side', '95'], ['Back', '128', 'Double gate'], ['Right side', '95'], ['Right return', '20']]
  const b = page.locator('[data-quote-builder]'), bar = page.locator('[data-quote-bar]')
  await page.goto(`${APP}/quotes`); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(1500)
  await page.locator('button:has-text("New quote"):visible').first().tap(); await sleep(800)
  await b.locator('input[placeholder^="Customer name"]').fill(name)
  await bar.locator('[data-bar-next]').tap(); await sleep(300)
  await walkFence(page, sidesOf(sides))
  await bar.locator('[data-bar-next]').tap(); await sleep(400)
  await pickStyle(page, styleText)
  await bar.locator('[data-bar-next]').tap()
  await b.locator('[data-tiers]').waitFor({ timeout: 15000 })
  await sleep(1500)
  return b
}

const card = (b, key) => b.locator(`[data-tier="${key}"]`)
const priceOf = async (b, key) => dollars(await card(b, key).locator('[data-tier-price]').first().textContent())
const prices = async b => ({ good: await priceOf(b, 'good'), better: await priceOf(b, 'better'), added: await priceOf(b, 'added1') })
const barPrice = async page => dollars(await page.locator('[data-quote-bar] [data-bar-price]').first().textContent())
async function swap(b, key, text) {
  const sel = card(b, key).locator('[data-tier-swap]')
  const value = await sel.evaluate((el, t) => [...el.options].find(o => new RegExp(t, 'i').test(o.textContent))?.value, text)
  if (value === undefined) throw new Error(`no style like ${text}`)
  await sel.selectOption(value); await sleep(1500)
}
async function addOption(b, text) {
  const sel = b.locator('[data-option-add] select')
  const value = await sel.evaluate((el, t) => [...el.options].find(o => new RegExp(t, 'i').test(o.textContent))?.value, text)
  await sel.selectOption(value); await sleep(1500)
}
async function adjust(page, v) {
  const box = page.locator('[data-adjust-dollars]')
  await box.scrollIntoViewIfNeeded()
  await box.fill(v); await sleep(1500)
}
async function save(page) {
  await page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(500)
  await page.locator('[data-save-mode="new"]').tap().catch(() => {}); await sleep(300)
  await page.locator('[data-save-submit]').tap(); await sleep(3500)
}
const quotesNamed = async (ctx, name) => {
  const j = await (await ctx.request.get(`${API}/api/saved-quotes?full=1`)).json()
  return (j.data ?? []).filter(q => q.customerName.startsWith(name))
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}) }

/** Three options of mixed styles with $500 off the main one; Make main there and back. Returns the prices before the discount. */
async function threeOptions(who, page, name) {
  const b = await quoteUpToPrice(page, name, 'Aluminum.*No dig')
  await swap(b, 'good', 'Galvanized.*4 ft.*No dig|4 ft.*Galvanized.*No dig')
  await addOption(b, 'White Vinyl Privacy.*6 ft tall.*No dig')
  check(`${who}: three options, mixed styles`, (await b.locator('[data-tier]').count()) === 3)
  const p0 = await prices(b)
  const bar0 = await barPrice(page)
  check(`${who}: the main option (aluminum, Better) is the quote's price`, bar0 === p0.better, `bar $${bar0}, ${JSON.stringify(p0)}`)
  await adjust(page, '-500')
  const p1 = await prices(b)
  check(`${who}: $500 off: the main option is $500 lower`, p1.better === p0.better - 500 && (await barPrice(page)) === p0.better - 500, `$${p0.better} to $${p1.better}`)
  check(`${who}: the chain link and vinyl options keep their prices`, p1.good === p0.good && p1.added === p0.added, `chain link $${p0.good} to $${p1.good}, vinyl $${p0.added} to $${p1.added}`)
  const words = await page.locator('[data-adjust-options]').textContent().catch(() => '')
  check(`${who}: the box says the discount is on this option only`, /on this option only/.test(words) && !/[—–]/.test(words), words)
  await shot(page, `${who}-discount`)
  await card(b, 'good').locator('[data-tier-main]').tap(); await sleep(2500)
  const p2 = await prices(b)
  check(`${who}: Make main on chain link: the $500 goes with the main option`, p2.good === p0.good - 500 && p2.better === p0.better && p2.added === p0.added && (await barPrice(page)) === p0.good - 500, JSON.stringify(p2))
  await shot(page, `${who}-make-main`)
  await card(b, 'better').locator('[data-tier-main]').tap(); await sleep(2500)
  const p3 = await prices(b)
  check(`${who}: Make main back on aluminum: as before`, p3.good === p0.good && p3.better === p0.better - 500 && p3.added === p0.added, JSON.stringify(p3))
  return { b, p0 }
}

const browser = await webkit.launch()
try {
  // ── The owner ──
  const owner = await phone(browser, OWNER)
  const O = `Discount e2e owner ${run}`
  const { p0 } = await threeOptions('owner', owner.page, O)
  await owner.page.locator('[data-adjust-show-discount]').check(); await sleep(800)
  await save(owner.page)
  let q = (await quotesNamed(owner.ctx, O))[0]
  if (q) made.push(q.id)
  const opts = q?.proposal?.options ?? []
  const byStyle = re => opts.find(o => re.test(o.fenceStyle))
  const alum = byStyle(/^Alum/), chain = byStyle(/^CL/), vinyl = opts.find(o => o !== alum && o !== chain)
  check('owner: saved, three options; aluminum $500 off, the other two at their own price, no discount on them',
    opts.length === 3 && Math.round(q.finalPrice) === p0.better - 500 && alum?.adjustmentCents === -50000 && Math.round(chain?.finalPrice) === p0.good && Math.round(vinyl?.finalPrice) === p0.added && !chain?.adjustmentCents && !vinyl?.adjustmentCents,
    JSON.stringify(opts.map(o => [o.fenceStyle, o.finalPrice, o.adjustmentCents])))
  const t = (await (await owner.ctx.request.post(`${API}/api/saved-quotes/${q.id}/share-token`, { headers: { 'X-Staff-Request': '1' } })).json()).data
  await owner.ctx.request.patch(`${API}/api/saved-quotes/${q.id}`, { headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, data: { status: 'SENT' } })

  // ── The customer, on a phone ──
  const ctx = await browser.newContext(PHONE)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  await page.goto(`${API}/p/${t.shareToken}`); await sleep(1500)
  const cards = await page.locator('.opt[data-option]').evaluateAll(els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()))
  const discounted = cards.filter(c => /Discount/.test(c))
  check('customer: the Discount line is on the aluminum option only', discounted.length === 1 && /Aluminum/i.test(discounted[0]) && /Discount −\$500/.test(discounted[0]), cards.join(' || '))
  const chainCard = cards.find(c => /Chain link/i.test(c)) ?? ''
  check('customer: chain link at its own price', chainCard.includes(`$${p0.good.toLocaleString('en-US')}`), chainCard)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/customer-page.png`, fullPage: true })
  await page.locator('.opt[data-option]', { hasText: /Chain link/i }).first().locator('input').check({ force: true }); await sleep(400)
  const deposit = await page.locator('#deposit').textContent().catch(() => '')
  await page.locator('#name').fill('Discount Customer')
  await page.locator('#sig').scrollIntoViewIfNeeded()
  const sig = await page.locator('#sig').boundingBox()
  const pt = i => ({ clientX: sig.x + 30 + i * 20, clientY: sig.y + 80 + (i % 2 ? -25 : 25), pointerId: 7, pointerType: 'touch', bubbles: true })
  await page.locator('#sig').dispatchEvent('pointerdown', pt(0))
  for (let i = 1; i <= 12; i++) await page.locator('#sig').dispatchEvent('pointermove', pt(i))
  await page.locator('#sig').dispatchEvent('pointerup', pt(12))
  await page.locator('#go').tap(); await sleep(3500)
  const done = await page.locator('[data-accepted]').textContent().catch(() => '')
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/customer-signed.png`, fullPage: true })
  const pdf = await page.request.get(`${API}/p/${t.shareToken}/contract.pdf`)
  check('customer: signed the chain link, the contract opens', /Chain Link/i.test(done) && pdf.ok(), `${done}; deposit: ${deposit}`)
  check('customer: no page errors', errors.length === 0, errors.join('|'))
  await ctx.close()

  // ── The owner: everything is the chain link's own price ──
  q = (await (await owner.ctx.request.get(`${API}/api/saved-quotes/${q.id}`)).json()).data
  check('owner: the quote is the chain link at its own price, no discount on it', /^CL/.test(q.fenceStyle) && Math.round(q.finalPrice) === p0.good && q.pricing?.priceAdjustmentCents == null && q.pricing?.showDiscountOnProposal == null, `${q.fenceStyle} $${q.finalPrice} ${JSON.stringify(q.pricing)}`)
  const jobRow = sql(`select "contractValue" from "SavedJob" where "quoteId" = '${q.id}'`)
  check('owner: the job is that price', Number(jobRow) === p0.good, jobRow)
  const plan = sql(`select "signedCents", "depositPct" from "PaymentSchedule" where "quoteId" = '${q.id}'`)
  check('owner: the payment schedule is that price', Number(plan.split('|')[0]) === p0.good * 100, plan)
  const inv = sql(`select coalesce(string_agg("amountCents"::text, ','), '') from "ContractInvoice" where "quoteId" = '${q.id}'`)
  const pct = Number(plan.split('|')[1]) || 0
  // Whole dollars (Oct 29 2026): the deposit is its share down to the dollar, the balance the rest, together the price.
  const invs = inv.split(',').filter(Boolean).map(Number)
  check('owner: the deposit is the share of that price', pct === 0 ? true : invs.includes(Math.floor(p0.good * pct / 100) * 100) && invs.reduce((a, b) => a + b, 0) === p0.good * 100, `deposit ${pct}%, invoices ${inv}, page ${deposit}`)
  const order = sql(`select count(*) from "BusinessState", jsonb_array_elements(coalesce("pendingOrders", '[]'::jsonb)) o where o->>'quoteId' = '${q.id}'`)
  check('owner: a Sales Order for it', Number(order) >= 1, order)
  const doc = sql(`select count(*) from "SignedDocument" where "quoteId" = '${q.id}'`)
  check('owner: the signed contract is filed', Number(doc) >= 1, doc)
  check('owner: no page errors', owner.errors.length === 0, owner.errors.join('|'))
  await owner.ctx.close()

  // ── Christa, the Salesman ──
  const christa = await phone(browser, SALES)
  const C = `Discount e2e christa ${run}`
  const c = await threeOptions('Christa', christa.page, C)
  await save(christa.page)
  const qc = (await quotesNamed(christa.ctx, C))[0]
  if (qc) made.push(qc.id)
  const oc = qc?.proposal?.options ?? []
  const calum = oc.find(o => /^Alum/.test(o.fenceStyle)), others = oc.filter(o => o !== calum)
  check('Christa: saved at the server\'s prices, the $500 on aluminum only',
    oc.length === 3 && Math.round(qc.finalPrice) === c.p0.better - 500 && calum?.adjustmentCents === -50000 && others.every(o => !o.adjustmentCents) && others.map(o => Math.round(o.finalPrice)).sort().join() === [c.p0.good, c.p0.added].sort().join(),
    JSON.stringify(oc.map(o => [o.fenceStyle, o.finalPrice, o.adjustmentCents])))
  check('Christa: no page errors', christa.errors.length === 0, christa.errors.join('|'))
  await christa.ctx.close()
} finally {
  await browser.close()
  for (const id of made) {
    for (const t of ['ContractPayment', 'ContractInvoice', 'PaymentSchedule', 'JobQuotedCost', 'SignedDocument', 'ProposalView', 'QuoteOption', 'InventoryPendingOrder', 'SavedJob']) sql(`delete from "${t}" where "quoteId" = '${id}'`)
    sql(`update "BusinessState" set "pendingOrders" = (select coalesce(jsonb_agg(o), '[]'::jsonb) from jsonb_array_elements("pendingOrders") o where o->>'quoteId' is distinct from '${id}') where "pendingOrders" @> '[{"quoteId": "${id}"}]'`)
    const contact = sql(`select coalesce("crmContactId", '') from "SavedQuote" where id = '${id}'`)
    sql(`delete from "CrmAuditLog" where "entityId" = '${id}'`)
    sql(`delete from "SavedQuote" where id = '${id}'`)
    if (contact && sql(`select count(*) from "SavedQuote" where "crmContactId" = '${contact}'`) === '0' && /^Discount e2e/.test(sql(`select "firstName" || ' ' || "lastName" from "CrmContact" where id = '${contact}'`))) sql(`delete from "CrmContact" where id = '${contact}'`)
  }
  console.log(`removed ${made.length} quotes: ${made.join(', ')}`)
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
