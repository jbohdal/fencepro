// Make main on a saved draft keeps each card's price (review Nov 2 2026: a draft saved with vinyl as main, reopened,
// Make main on aluminum moved its card from $15,250 to $15,755 at vinyl's margin). On the dev copy (run `pnpm -s build`
// in apps/web first).
//
//   APP_URL=http://localhost:4230 API_URL=http://localhost:4230 E2E_STAFF_COOKIE=<owner cookie value> \
//   SALES_COOKIE=<Salesman cookie value> [SHOTS=<folder>] node e2e/make-main-saved.mjs
//
// The owner and Christa, each on a phone sized WebKit (iPhone): one drawn yard with three options of three materials
// (vinyl, aluminum and chain link), saved as a draft, opened again; Make main on each card in turn: the bar shows the
// price that card showed, every other card keeps its price; Make main back on the first is the saved price. Saved after
// a Make main, the server keeps that price; opened again, the same. The owner does it twice, vinyl main first (the
// reviewer's draft) and aluminum main first; then a sent quote: Make main on aluminum saves at its card's price, with
// the customer's options at the prices sent. Removes everything it made (hard deletes on ezbiz_dev only, by id).
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit } from 'playwright'
import { execFileSync } from 'child_process'
import { signInByCookie } from './lib.mjs'

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
const VINYL = 'White Vinyl Privacy.*6 ft tall.*6 ft (panels|sections).*No dig', ALUM = 'Aluminum.*No dig', CHAIN = 'Galvanized.*4 ft.*No dig|4 ft.*Galvanized.*No dig'

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
  await b.locator('[data-shape="backyard"]').tap(); await sleep(300)
  for (const [side, ft, gate] of sides) {
    const open = b.locator(`[data-side-open="true"][data-side="${side}"]`)
    await open.locator('[data-side-length]').tap(); await sleep(150)
    for (const d of ft) { await page.locator(`[data-ftin-pad] [data-pad-key="${d}"]`).tap(); await sleep(60) }
    await page.locator('[data-ftin-pad] [data-pad-done]').tap(); await sleep(150)
    if (gate) { await open.locator(`[data-gate-choice] button:has-text("${gate}")`).tap(); await sleep(200) }
    if (side !== sides[sides.length - 1][0]) { await bar.locator('[data-bar-next]').tap(); await sleep(200) }
  }
  await bar.locator('[data-bar-next]').tap(); await sleep(400)
  const pick = b.locator('[data-step-panel="style"] select').first()
  const value = await pick.evaluate((el, text) => [...el.options].find(o => new RegExp(text, 'i').test(o.textContent))?.value, styleText)
  if (!value) throw new Error(`no style like ${styleText}`)
  await pick.selectOption(value); await sleep(600)
  await bar.locator('[data-bar-next]').tap()
  await b.locator('[data-tiers]').waitFor({ timeout: 15000 })
  await sleep(1500)
  return b
}

/** Every card's price and whether it is the main one, by card. */
async function cards(b) {
  return b.locator('[data-tier]').evaluateAll(els => Object.fromEntries(els.map(e => [e.getAttribute('data-tier'), {
    price: Number((e.querySelector('[data-tier-price]')?.textContent ?? '').replace(/[^0-9.]/g, '')),
    main: (e.querySelector('[data-tier-main]')?.textContent ?? '') === 'Main option',
    name: (e.textContent ?? '').replace(/\s+/g, ' ').slice(0, 60),
  }])))
}
const barPrice = async page => dollars(await page.locator('[data-quote-bar] [data-bar-price]').first().textContent())
async function swap(b, key, text) {
  const sel = b.locator(`[data-tier="${key}"] [data-tier-swap]`)
  const value = await sel.evaluate((el, t) => [...el.options].find(o => new RegExp(t, 'i').test(o.textContent))?.value, text)
  if (value === undefined) throw new Error(`no style like ${text}`)
  await sel.selectOption(value); await sleep(1500)
}
async function addOption(b, text) {
  const sel = b.locator('[data-option-add] select')
  const value = await sel.evaluate((el, t) => [...el.options].find(o => new RegExp(t, 'i').test(o.textContent))?.value, text)
  await sel.selectOption(value); await sleep(1500)
}
async function save(page, asNew) {
  await page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(500)
  if (asNew) { await page.locator('[data-save-mode="new"]').tap().catch(() => {}); await sleep(300) }
  const submit = page.locator('[data-save-submit]')
  // Other work on the shared dev copy can change a part's price mid run: the app asks first; this run says so.
  if (await page.locator('[data-price-recheck]').count()) throw new Error(`prices changed on the dev copy during the run: ${await page.locator('[data-price-recheck-line]').textContent()}`)
  if (!(await submit.count())) { await shot(page, 'save-not-open'); throw new Error(`the Save window did not open: ${(await page.locator('[data-quote-bar]').textContent()).slice(0, 300)}`) }
  await submit.tap(); await sleep(3500)
}
/** The saved quote opened again, as from a link: a fresh page in the same sign in (a reload of the open builder). */
async function reopen(p, id) {
  await p.page.close().catch(() => {})
  p.page = await p.ctx.newPage()
  p.page.on('pageerror', e => p.errors.push(String(e).slice(0, 300)))
  p.page.on('dialog', d => d.accept().catch(() => {}))
  await p.page.goto(`${APP}/quotes?quote=${id}`)
  const b = p.page.locator('[data-quote-builder]')
  await b.locator('[data-tiers]').waitFor({ timeout: 30000 })
  await sleep(2500)
  return { b, page: p.page }
}
const quotesNamed = async (ctx, name) => {
  const j = await (await ctx.request.get(`${API}/api/saved-quotes?full=1`)).json()
  return (j.data ?? []).filter(q => q.customerName.startsWith(name))
}
const savedQuote = async (ctx, id) => (await (await ctx.request.get(`${API}/api/saved-quotes/${id}`)).json()).data
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}) }
const same = (a, b, skip) => Object.keys(a).every(k => k === skip || a[k].price === b[k]?.price)

/** A draft of three materials, saved and opened again; Make main on each card and back; saved after one. */
async function walk(who, p, name, mainStyle, others) {
  let { page } = p
  const { ctx } = p
  let b = await quoteUpToPrice(page, name, mainStyle)
  // The other two materials on cards that are not the main one: swapped in, or added when there is room.
  const first = await cards(b)
  const free = Object.keys(first).filter(k => !first[k].main)
  await swap(b, free[0], others[0])
  if (free[1]) await swap(b, free[1], others[1]); else await addOption(b, others[1])
  const start = await cards(b)
  check(`${who}: the main option is still the first style`, new RegExp(mainStyle.split('.*')[0], 'i').test(Object.values(start).find(c => c.main)?.name ?? ''), JSON.stringify(start))
  await save(page, true)
  const q = (await quotesNamed(ctx, name))[0]
  if (!q) { check(`${who}: saved`, false); return }
  made.push(q.id)
  ;({ b, page } = await reopen(p, q.id))
  const open = await cards(b)
  const mainKey = Object.keys(open).find(k => open[k].main)
  const bar0 = await barPrice(page)
  check(`${who}: opened again at the saved price, three materials`, Object.keys(open).length >= 3 && Math.round(q.finalPrice) === bar0 && !!mainKey, `saved $${q.finalPrice}, bar $${bar0}, ${JSON.stringify(open)}`)
  await shot(page, `${who}-opened`)
  // Every other card in turn, then back to the first, then one more time round.
  const order = [...Object.keys(open).filter(k => k !== mainKey && !open[k].main), mainKey]
  for (const key of [...order, ...order]) {
    await b.locator(`[data-tier="${key}"] [data-tier-main]`).tap(); await sleep(2500)
    const now = await cards(b), bar = await barPrice(page)
    const want = key === mainKey ? bar0 : open[key].price
    check(`${who}: Make main on ${open[key].name.slice(0, 40)}: the bar is the price its card showed`, bar === want && now[key].price === want && now[key].main, `card showed $${want}, bar $${bar}, card now $${now[key].price}`)
    check(`${who}: every other card keeps its price`, same(open, now, key), JSON.stringify(Object.fromEntries(Object.entries(now).map(([k, v]) => [k, v.price]))))
  }
  // Saved with another option as main: the server keeps the price that card showed; opened again, the same.
  const other = order[0]
  await b.locator(`[data-tier="${other}"] [data-tier-main]`).tap(); await sleep(2500)
  await shot(page, `${who}-make-main`)
  await save(page, false)
  const after = await savedQuote(ctx, q.id)
  check(`${who}: saved with ${open[other].name.slice(0, 40)} as main at its card's price`, Math.round(after.finalPrice) === open[other].price, `card $${open[other].price}, saved $${after.finalPrice} (${after.fenceStyle})`)
  ;({ b, page } = await reopen(p, q.id))
  const again = await cards(b)
  check(`${who}: opened again: the same price, the other cards as before`, (await barPrice(page)) === open[other].price && same(open, again, other) && again[other].main, JSON.stringify(Object.fromEntries(Object.entries(again).map(([k, v]) => [k, v.price]))))
  await page.locator('[data-quote-bar] [data-save-open]').waitFor({ timeout: 5000 }).catch(() => {})
}

/** A sent quote: Make main on aluminum is its card's price; the customer's options keep the prices sent. */
async function sentQuote(who, p, name) {
  let b = await quoteUpToPrice(p.page, name, VINYL)
  const first = await cards(b)
  const free = Object.keys(first).filter(k => !first[k].main)
  await swap(b, free[0], ALUM)
  await swap(b, free[1], CHAIN)
  await save(p.page, true)
  const q = (await quotesNamed(p.ctx, name))[0]
  if (!q) { check(`${who}: saved`, false); return }
  made.push(q.id)
  const h = { 'X-Staff-Request': '1' }
  await p.ctx.request.post(`${API}/api/saved-quotes/${q.id}/share-token`, { headers: h })
  await p.ctx.request.patch(`${API}/api/saved-quotes/${q.id}`, { headers: { ...h, 'Content-Type': 'application/json' }, data: { status: 'SENT' } })
  let page
  ;({ b, page } = await reopen(p, q.id))
  const open = await cards(b)
  const alum = Object.keys(open).find(k => /Aluminum/.test(open[k].name))
  await b.locator(`[data-tier="${alum}"] [data-tier-main]`).tap(); await sleep(2500)
  check(`${who}: sent quote, Make main on aluminum: the bar is its card's price`, (await barPrice(page)) === open[alum].price, `card $${open[alum].price}, bar $${await barPrice(page)}`)
  await page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(500)
  await page.locator('[data-save-submit]').tap().catch(() => {}); await sleep(2000)
  // No price the customer reads changes (every card stays at its price), so the sent quote question is not asked
  // (QuoteBuilder: it asks when a save would change a price or fence the customer reads). Before the fix it asked,
  // because aluminum's card would have gone up $505.
  const asked = await page.locator('[data-quote-sent-message]').count()
  await shot(page, `${who}-sent-saved`)
  const after = await savedQuote(p.ctx, q.id)
  const priced = o => Object.fromEntries((o?.proposal?.options ?? []).map(x => [x.fenceStyle, Math.round(x.finalPrice)]).sort())
  check(`${who}: saved with aluminum as main at its card's price, no question (nothing the customer reads changed)`, !asked && /^Alum/.test(after.fenceStyle) && Math.round(after.finalPrice) === open[alum].price, `asked ${asked}, ${after.fenceStyle} $${after.finalPrice}`)
  check(`${who}: the customer's options are the same prices as sent`, JSON.stringify(priced(after)) === JSON.stringify(priced(q)), `${JSON.stringify(priced(q))} then, ${JSON.stringify(priced(after))} now`)
}

const browser = await webkit.launch()
try {
  const owner = await phone(browser, OWNER)
  await walk('owner (vinyl first)', owner, `MakeMain e2e owner v ${run}`, VINYL, [ALUM, CHAIN])
  await walk('owner (aluminum first)', owner, `MakeMain e2e owner a ${run}`, ALUM, [CHAIN, VINYL])
  await sentQuote('owner (sent)', owner, `MakeMain e2e owner s ${run}`)
  check('owner: no page errors', owner.errors.length === 0, owner.errors.join('|'))
  await owner.ctx.close()
  const christa = await phone(browser, SALES)
  await walk('Christa (vinyl first)', christa, `MakeMain e2e christa ${run}`, VINYL, [ALUM, CHAIN])
  check('Christa: no page errors', christa.errors.length === 0, christa.errors.join('|'))
  await christa.ctx.close()
} finally {
  await browser.close()
  for (const id of made) {
    const contact = sql(`select coalesce("crmContactId", '') from "SavedQuote" where id = '${id}'`)
    sql(`delete from "CrmAuditLog" where "entityId" = '${id}'`)
    sql(`delete from "SavedQuote" where id = '${id}'`)
    if (contact && sql(`select count(*) from "SavedQuote" where "crmContactId" = '${contact}'`) === '0' && /^MakeMain e2e/.test(sql(`select "firstName" || ' ' || "lastName" from "CrmContact" where id = '${contact}'`))) sql(`delete from "CrmContact" where id = '${contact}'`)
  }
  console.log(`removed ${made.length} quotes: ${made.join(', ')}`)
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
