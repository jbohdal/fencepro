// The office's review of Oct 28 2026 (Inventory > Sales Orders and the Operations board), used as the office
// would, on a computer and a phone, on a dev server:
//
//   APP_URL=http://localhost:4092 E2E_STAFF_COOKIE=<office cookie> SHOTS=<dir> node e2e/review-1028-office.mjs
//
// Makes its own customer, quote and job (in Need Drawing, materials in, no drawing), a draft purchase order saved
// in dollars and an Ordered Sales Order for it, straight in ezbiz_dev, and removes them after.
//   1. Open job on the draft opens the job; its × closes it in one press and it stays closed; Back closes it in
//      one press, and Back again returns to Inventory.
//   2. Advance on the job asks about the drawing first; Cancel leaves it; OK moves it and records the drawing.
//   3. The draft saved in dollars shows its prices and subtotal.
//   4. A drawn job in Need Drawing with its materials in does not say "order materials".
//   6. The Sales Order says Ordered / Received; Mark Received says what it did to the stock counts; on a phone
//      the page says to tap an order above and the order's buttons are 44 px tall like the draft's.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { chromium } from 'playwright'
import { signInByCookie } from './lib.mjs'

const APP = process.env.APP_URL
const COOKIE = process.env.E2E_STAFF_COOKIE
const SHOTS = process.env.SHOTS
if (!APP || !COOKIE || !SHOTS) { console.error('Set APP_URL, E2E_STAFF_COOKIE, SHOTS.'); process.exit(2) }
if (/:(4000|4001)\b/.test(APP)) { console.error('Use your own server: never 4000 (live) or 4001 (the shared dev server).'); process.exit(2) }

const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim()
const q = s => `'${String(s).replace(/'/g, "''")}'`
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
let n = 0
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${String(++n).padStart(2, '0')}-${name}.png` })

// ── Test records ──────────────────────────────────────────────────────────────
const tag = Date.now().toString(36)
const ACC = psql(`select "crmAccountId" from "CrmUser" where email = 'aud-office@example.invalid'`)
if (!ACC) { console.error('No aud-office@example.invalid login on ezbiz_dev.'); process.exit(2) }
const name = `E2E Office ${tag}`
const ids = { contact: randomUUID(), quote: randomUUID(), job: randomUUID(), po: `po-${tag}`, so: `so-${tag}` }
const parts = [{ item: `E2E Review Post ${tag}`, qty: 4, cost: 13.5 }, { item: `E2E Review Donut ${tag}`, qty: 58, cost: 4.12 }]
function setUp() {
  psql(`insert into "CrmContact" (id, "accountId", "firstName", "lastName", phone, "updatedAt") values (${q(ids.contact)}, ${q(ACC)}, 'E2E Office', ${q(tag)}, '3525550142', now())`)
  psql(`insert into "SavedQuote" (id, "accountId", "crmContactId", "customerName", "fenceStyle", runs, "pullSheet", "finalPrice", status, "updatedAt") values (${q(ids.quote)}, ${q(ACC)}, ${q(ids.contact)}, ${q(name)}, 'WV 6ft Privacy', '[100]', '[]', 5000, 'SOLD', now())`)
  psql(`insert into "SavedJob" (id, "accountId", "quoteId", "crmContactId", "customerName", "fenceStyle", status, "opsStage", "materialsStatus", "drawingComplete", "contractValue", "updatedAt") values (${q(ids.job)}, ${q(ACC)}, ${q(ids.quote)}, ${q(ids.contact)}, ${q(name)}, 'WV 6ft Privacy', 'staging', 'need_drawing', 'received', false, 5000, now())`)
  // A draft as saved before Oct 28 2026: money in dollars.
  const draft = {
    id: ids.po, poNumber: `PO-E2E-${tag}`, jobId: ids.job, jobName: name, supplier: 'Default Supplier', status: 'draft', notes: '', createdBy: 'auto', createdAt: new Date().toISOString(),
    lineItems: parts.map((p, i) => ({ id: `l${i}-${tag}`, itemName: p.item, quantity: p.qty, unitCost: p.cost, total: Math.round(p.qty * p.cost * 100) / 100 })),
    subtotal: 292.96,
  }
  const now = new Date().toISOString()
  const order = {
    id: ids.so, quoteId: ids.quote, quoteName: `WV 6ft Privacy — ${name}`, jobId: ids.job, customerId: ids.contact, customerName: name, status: 'ordered', notes: '',
    items: parts.map((p, i) => ({ id: `i${i}-${tag}`, itemName: p.item, requiredQuantity: p.qty, unitCostCents: Math.round(p.cost * 100), totalCostCents: Math.round(p.qty * p.cost * 100), quantityReceived: 0 })),
    totalCostCents: 29296, createdAt: now, updatedAt: now, orderedAt: now,
  }
  psql(`update "BusinessState" set "purchaseOrders" = jsonb_build_array(${q(JSON.stringify(draft))}::jsonb) || coalesce("purchaseOrders", '[]'::jsonb), "pendingOrders" = jsonb_build_array(${q(JSON.stringify(order))}::jsonb) || coalesce("pendingOrders", '[]'::jsonb), version = version + 1 where "accountId" = ${q(ACC)}`)
}
function cleanUp() {
  const J = q(ids.job), Q = q(ids.quote), C = q(ids.contact)
  psql(`update "BusinessState" set "purchaseOrders" = coalesce((select jsonb_agg(x) from jsonb_array_elements("purchaseOrders") x where x->>'id' <> ${q(ids.po)}), '[]'::jsonb), "pendingOrders" = coalesce((select jsonb_agg(x) from jsonb_array_elements("pendingOrders") x where x->>'id' <> ${q(ids.so)} and coalesce(x->>'jobId', '') <> ${J} and coalesce(x->>'quoteId', '') <> ${Q}), '[]'::jsonb), version = version + 1 where "accountId" = ${q(ACC)}`)
  psql(`delete from "AutomationRun" where "entityId" in (${J}, ${Q}, ${C})`)
  psql(`delete from "ActivityLog" where "entityId" in (${J}, ${Q}, ${C})`)
  psql(`delete from "SavedJob" where id = ${J}`)
  psql(`delete from "SavedQuote" where id = ${Q}`)
  psql(`delete from "CrmContact" where id = ${C}`)
}
const job = () => JSON.parse(psql(`select json_build_object('opsStage', "opsStage", 'drawingComplete', "drawingComplete", 'materialsStatus', "materialsStatus") from "SavedJob" where id = ${q(ids.job)}`))
const orderStatus = () => psql(`select o->>'status' from "BusinessState", jsonb_array_elements("pendingOrders") o where "accountId" = ${q(ACC)} and o->>'id' = ${q(ids.so)}`)

// ── A browser as the office ──────────────────────────────────────────────────
async function session(browser, phone) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  await signInByCookie(ctx, { api: APP, cookie: COOKIE })
  const page = await ctx.newPage()
  const errors = [], dialogs = []
  let answer = true
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => { dialogs.push(d.message()); (answer ? d.accept() : d.dismiss()).catch(() => {}) })
  return { ctx, page, errors, dialogs, setAnswer: a => { answer = a } }
}
const url = page => { const u = new URL(page.url()); return u.pathname + u.search }
const panel = page => page.locator(`[data-job-panel="${ids.job}"]`)

async function salesOrders(page) {
  await page.goto(`${APP}/inventory`)
  await page.locator('[data-inventory-tab="sales_orders"]').click()
  await page.locator(`[data-draft-po="${ids.po}"]`).waitFor({ timeout: 60000 })
}

async function openJobFromDraft(page) {
  await page.locator(`[data-draft-po="${ids.po}"]`).click()
  await page.locator('[data-draft-open-job]').click()
  await panel(page).waitFor({ timeout: 30000 })
  await sleep(800)
}

async function computer(browser) {
  const s = await session(browser, false)
  const { page } = s
  // 3. The draft saved in dollars.
  await salesOrders(page)
  await page.locator(`[data-draft-po="${ids.po}"]`).click()
  const sub = (await page.locator('[data-draft-subtotal]').innerText()).trim()
  check('3: a draft saved in dollars shows its subtotal', sub === '$292.96', sub)
  const detail = await page.locator(`[data-draft-detail="${ids.po}"]`).innerText()
  check('3: and its line prices', detail.includes('Qty 4 × $13.50') && detail.includes('$54.00') && detail.includes('Qty 58 × $4.12') && detail.includes('$238.96') && !detail.includes('—'), detail.replace(/\s+/g, ' ').slice(0, 300))
  check('3: the draft list shows its total', (await page.locator(`[data-draft-po="${ids.po}"]`).innerText()).includes('$292.96'))
  // Before the Sales Orders load it says so (it said "This job has no Sales Order"); then it names the job's.
  const rel = await page.locator('[data-draft-relation]').getAttribute('data-draft-relation')
  check('3: the draft never says the job has no Sales Order while they load', rel === 'loading' || rel === 'same', rel)
  await page.locator('[data-draft-relation="same"]').waitFor({ timeout: 30000 }).catch(() => {})
  check('3: once loaded, it goes with the job\'s Sales Order', (await page.locator('[data-draft-relation]').getAttribute('data-draft-relation')) === 'same')
  await shot(page, 'draft-in-cents')

  // 1. Open job, then ×.
  await openJobFromDraft(page)
  check('1: Open job opens the job', url(page) === `/operations?job=${ids.job}`, url(page))
  await panel(page).locator('button', { hasText: '×' }).first().click()
  await sleep(1500)
  check('1: × closes it in one press, and it stays closed', (await panel(page).count()) === 0 && url(page) === '/operations', url(page))
  await page.goBack(); await sleep(1500)
  check('1: then Back returns to Inventory in one press', url(page).startsWith('/inventory'), url(page))
  // Open job, then Back.
  await page.locator('[data-inventory-tab="sales_orders"]').click().catch(() => {})
  await page.locator(`[data-draft-po="${ids.po}"]`).waitFor({ timeout: 30000 })
  await openJobFromDraft(page)
  await page.goBack(); await sleep(1500)
  check('1: Back closes the job in one press', (await panel(page).count()) === 0 && url(page) === '/operations', url(page))
  await page.goBack(); await sleep(1500)
  check('1: Back again returns to Inventory', url(page).startsWith('/inventory'), url(page))

  // 2. Advance asks about the drawing.
  await page.goto(`${APP}/operations?job=${ids.job}`)
  await panel(page).waitFor({ timeout: 60000 }); await sleep(1000)
  const wait = await panel(page).locator('[data-ops-stage-wait]').innerText().catch(() => '')
  check('2: the job says it waits for its drawing', wait.includes('Materials in; waits for its drawing'), wait)
  s.setAnswer(false); s.dialogs.length = 0
  await panel(page).locator('[data-ops-advance]').click(); await sleep(1500)
  check('2: Advance asks first', s.dialogs.some(d => d === `No drawing on file for ${name}'s job. Moving it to Ready to Pull records the drawing as done.\n\nMove it?`), JSON.stringify(s.dialogs))
  check('2: Cancel leaves it in Need Drawing, still to be drawn', job().opsStage === 'need_drawing' && job().drawingComplete === false, JSON.stringify(job()))
  s.setAnswer(true); s.dialogs.length = 0
  await panel(page).locator('[data-ops-advance]').click(); await sleep(3000)
  check('2: OK moves it to Ready to Pull and records the drawing done', job().opsStage === 'ready_to_pull' && job().drawingComplete === true, JSON.stringify(job()))
  check('2: one question, asked once', s.dialogs.length === 1, JSON.stringify(s.dialogs))

  // 4. Drawn, in Need Drawing, materials in.
  psql(`update "SavedJob" set "opsStage" = 'need_drawing', "drawingComplete" = true, "materialsStatus" = 'received', "updatedAt" = now() where id = ${q(ids.job)}`)
  await page.goto(`${APP}/operations?job=${ids.job}`)
  await panel(page).waitFor({ timeout: 60000 }); await sleep(1000)
  const drawn = await panel(page).locator('[data-ops-stage-wait]').innerText().catch(() => '')
  check('4: a drawn job with its materials in says so, not "order materials"', drawn.includes('Drawn, materials in') && !drawn.includes('order materials'), drawn)
  await shot(page, 'drawn-materials-in')
  await panel(page).locator('button', { hasText: '×' }).first().click(); await sleep(800)
  const cards = await page.locator('[data-ops-card-drawn]').allInnerTexts()
  check('4: its board card too', cards.some(t => t.includes('Drawn, materials in')), JSON.stringify(cards.slice(0, 5)))

  // 6. The Sales Order: status words, Mark Received.
  await salesOrders(page)
  const row = page.locator('button', { hasText: `WV 6ft Privacy — ${name}` }).first()
  check('6: the list says Ordered', (await row.locator('[data-order-status]').innerText()).trim() === 'Ordered')
  await row.click()
  check('6: the order says Ordered', (await page.locator('[data-order-detail-status]').innerText()).trim() === 'Ordered')
  await page.getByRole('button', { name: 'Mark Received' }).click(); await sleep(1500)
  const body = await page.locator('body').innerText()
  check('6: Mark Received says what it did to the stock counts', body.includes('Order marked Received') && body.includes('None of its 2 parts are in Inventory, so no stock count changed.') && !body.includes('Inventory deducted'), body.match(/Order marked[^\n]*\n?[^\n]*/)?.[0] ?? '')
  await sleep(2500)
  check('6: the order is Received on the server', orderStatus() === 'received', orderStatus())
  check('6: the order says Received', (await page.locator('[data-order-detail-status]').innerText()).trim() === 'Received')
  check('computer: no page errors', s.errors.length === 0, s.errors.join(' | '))
  await s.ctx.close()
}

async function phone(browser) {
  // The order is Received now; put it back to Ordered so the phone has its buttons.
  psql(`update "BusinessState" set "pendingOrders" = (select jsonb_agg(case when x->>'id' = ${q(ids.so)} then x || '{"status":"ordered"}'::jsonb else x end) from jsonb_array_elements("pendingOrders") x), version = version + 1 where "accountId" = ${q(ACC)}`)
  const s = await session(browser, true)
  const { page } = s
  await salesOrders(page)
  const pick = await page.locator('[data-orders-pick]').innerText()
  check('6: a phone says to tap an order above', pick.trim() === 'Tap an order above to see its parts and mark it Ordered or Received.', pick)
  await page.locator('button', { hasText: `WV 6ft Privacy — ${name}` }).first().click(); await sleep(800)
  const heights = await page.locator('[data-order-actions] button').evaluateAll(bs => bs.map(b => [b.textContent, Math.round(b.getBoundingClientRect().height)]))
  check('6: the order\'s buttons on a phone are 44 px tall, like the draft\'s', heights.length >= 3 && heights.every(([, h]) => h >= 44), JSON.stringify(heights))
  await shot(page, 'phone-order')
  await page.locator(`[data-draft-po="${ids.po}"]`).click(); await sleep(600)
  const dh = await page.locator(`[data-draft-detail="${ids.po}"] button`).evaluateAll(bs => bs.filter(b => b.hasAttribute('data-draft-ordered') || b.hasAttribute('data-draft-discard') || b.hasAttribute('data-draft-open-job')).map(b => Math.round(b.getBoundingClientRect().height)))
  check('6: (the draft\'s buttons, for comparison)', dh.every(h => h >= 44), JSON.stringify(dh))
  // 1 on a phone: Open job, ×.
  await page.locator('[data-draft-open-job]').click()
  await panel(page).waitFor({ timeout: 30000 }); await sleep(800)
  await panel(page).locator('button', { hasText: '×' }).first().tap(); await sleep(1500)
  check('1 (phone): × closes the job in one tap, and it stays closed', (await panel(page).count()) === 0 && url(page) === '/operations', url(page))
  await page.goBack(); await sleep(1500)
  check('1 (phone): Back returns to Inventory', url(page).startsWith('/inventory'), url(page))
  check('phone: no page errors', s.errors.length === 0, s.errors.join(' | '))
  await s.ctx.close()
}

setUp()
const browser = await chromium.launch()
try {
  await computer(browser)
  await phone(browser)
} catch (e) {
  check('ran to the end', false, String(e?.stack ?? e).slice(0, 600))
} finally {
  await browser.close()
  cleanUp()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
