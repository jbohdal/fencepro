// Make main on a SENT quote with a Price adjust (slider), owner on a phone (review Nov 3 2026): every option keeps the
// price it went out at, the save asks nothing, and the note "On this option only" shows only when no option but the
// main one carries the slider. Two quotes: one sent with this build (only the main option took the slider), and one
// as sent before it (every option took the slider, nothing on its snapshots). With SALES_COOKIE, a quote the Salesman
// makes at +10%: her best price fence is the Better card (main), she sends it, and she, then the owner on another of
// hers, Make main on it.
//
//   APP_URL=http://localhost:4150 E2E_STAFF_COOKIE=<owner cookie> [SALES_COOKIE=<Salesman cookie>] node e2e/make-main-slider.mjs
//
// Removes every quote it made (hard deletes on ezbiz_dev only, by id).

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import { execFileSync } from 'child_process'
import { signInByCookie, pickStyle } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || APP
const OWNER = process.env.E2E_STAFF_COOKIE || ''
const SALES = process.env.SALES_COOKIE || ''
const SHOTS = process.env.SHOTS || ''
if (!OWNER) { console.error('Set E2E_STAFF_COOKIE.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const dollars = s => Number(String(s).replace(/[^0-9.]/g, ''))
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const run = Date.now().toString(36)
const made = []
const h = { 'X-Staff-Request': '1' }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }).catch(() => {}) }

const cards = b => b.locator('[data-tier]').evaluateAll(els => Object.fromEntries(els.map(e => [e.getAttribute('data-tier'), {
  price: Number((e.querySelector('[data-tier-price]')?.textContent ?? '').replace(/[^0-9.]/g, '')),
  main: (e.querySelector('[data-tier-main]')?.textContent ?? '') === 'Main option',
}])))
const barPrice = async page => dollars(await page.locator('[data-quote-bar] [data-bar-price]').first().textContent())
const savedQuote = async (ctx, id) => (await (await ctx.request.get(`${API}/api/saved-quotes/${id}`)).json()).data
const optionPrices = q => Object.fromEntries((q?.proposal?.options ?? []).map(x => [x.fenceStyle, Math.round(Number(x.finalPrice) * 100)]).sort())
const setSlider = async (b, pct) => {
  await b.locator('input[type="range"]').first().evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) }, pct)
  await sleep(1200)
}
const note = async b => (await b.locator('[data-slider-options]').count()) > 0

async function reopen(p, id) {
  await p.page.close().catch(() => {})
  p.page = await p.ctx.newPage()
  p.page.on('pageerror', e => p.errors.push(String(e).slice(0, 300)))
  p.page.on('dialog', d => d.accept().catch(() => {}))
  await p.page.goto(`${APP}/quotes?quote=${id}`)
  const b = p.page.locator('[data-quote-builder]')
  await b.locator('[data-tiers]').waitFor({ timeout: 30000 })
  await sleep(3000)
  return b
}

/** Make main on the first card that is not the main one, save, and check nothing the customer reads changed. */
async function makeMainAndSave(p, who, id, b) {
  const open = await cards(b)
  const sentQ = await savedQuote(p.ctx, id)
  const pick = Object.keys(open).find(k => !open[k].main && open[k].price > 0)
  await b.locator(`[data-tier="${pick}"] [data-tier-main]`).tap(); await sleep(3000)
  const after = await cards(b)
  check(`${who}: Make main on ${pick}: the bar is its sent card price`, (await barPrice(p.page)) === open[pick].price, `card $${open[pick].price}, bar $${await barPrice(p.page)}`)
  check(`${who}: every card keeps the price it went out at`, Object.keys(open).every(k => after[k]?.price === open[k].price), `${JSON.stringify(open)} then, ${JSON.stringify(after)} now`)
  const words = ((await b.locator('[data-tiers-as-sent]').textContent().catch(() => '')) || '').trim()
  check(`${who}: the words over the cards say they are as sent`, /^As sent: the prices on the customer's proposal\./.test(words), words.slice(0, 160))
  await shot(p.page, `${who}-made-main`)
  await p.page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(600)
  await p.page.locator('[data-save-submit]').tap().catch(() => {}); await sleep(3000)
  const asked = await p.page.locator('[data-quote-sent-message], [data-quote-sent-keep]').count()
  const saved = await savedQuote(p.ctx, id)
  check(`${who}: saved without the price-changed question, the new main at its sent price`, !asked && saved.fenceStyle !== sentQ.fenceStyle && Math.round(saved.finalPrice) === open[pick].price, `asked ${asked}, ${saved.fenceStyle} $${saved.finalPrice}`)
  check(`${who}: the customer's options are the same prices as sent`, JSON.stringify(optionPrices(saved)) === JSON.stringify(optionPrices(sentQ)), `${JSON.stringify(optionPrices(sentQ))} then, ${JSON.stringify(optionPrices(saved))} now`)
  // Opened again: the same cards, the new main still at its sent price.
  const b2 = await reopen(p, id)
  const again = await cards(b2)
  check(`${who}: opened again, the same prices`, Object.keys(open).every(k => again[k]?.price === open[k].price) && (await barPrice(p.page)) === open[pick].price, JSON.stringify(again))
  return b2
}

const browser = await chromium.launch()
try {
  const phone = async cookie => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
    await signInByCookie(ctx, { cookie, api: API })
    const s = { ctx, page: await ctx.newPage(), errors: [] }
    s.page.on('pageerror', e => s.errors.push(String(e).slice(0, 300)))
    s.page.on('dialog', d => d.accept().catch(() => {}))
    return s
  }
  const p = await phone(OWNER)
  const ctx = p.ctx

  /** A new 150 ft white vinyl quote at `pct`% on the slider, saved and marked sent (with a link). Returns its id. */
  async function sentQuote(name, pct, who = p) {
    const page = who.page, b = page.locator('[data-quote-builder]'), bar = page.locator('[data-quote-bar]')
    await page.goto(`${APP}/quotes`); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(1500)
    await page.locator('button:has-text("New quote"):visible').first().tap(); await sleep(800)
    await b.locator('input[placeholder^="Customer name"]').fill(name)
    await bar.locator('[data-bar-next]').tap(); await sleep(300)
    await b.locator('[data-shape="straight"]').tap(); await sleep(300)
    await b.locator('[data-side-length]').first().tap()
    for (const k of ['1', '5', '0']) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).tap()
    await page.locator('[data-ftin-pad] [data-pad-done]').tap(); await sleep(300)
    await bar.locator('[data-bar-next]').tap(); await sleep(400)
    await pickStyle(page, 'White Vinyl Privacy.*6 ft tall.*8 ft.*No dig')
    await bar.locator('[data-bar-next]').tap()
    await b.locator('[data-tiers]').waitFor({ timeout: 15000 }); await sleep(1500)
    if (pct) {
      await setSlider(b, pct)
      if (who !== p) await sleep(2500) // her prices come from the server
      check(`${name}: the note shows on a draft with +${pct}% and three options`, await note(b))
      const c = await cards(b)
      check(`${name}: at +${pct}% the Better card is the main option, at the main price`, c.better?.main && c.better.price === await barPrice(page), JSON.stringify(c))
    }
    await page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(500)
    await page.locator('[data-save-mode="new"]').tap().catch(() => {}); await sleep(300)
    await page.locator('[data-save-submit]').tap(); await sleep(3500)
    const list = (await (await who.ctx.request.get(`${API}/api/saved-quotes?full=1`)).json()).data ?? []
    const q = list.find(x => x.customerName === name)
    if (!q) throw new Error(`${name} was not saved`)
    made.push(q.id)
    console.log(`made ${q.id}`)
    // Copy link, as she does it: a link, and the quote marked sent.
    await who.ctx.request.post(`${API}/api/saved-quotes/${q.id}/share-token`, { headers: h })
    await who.ctx.request.patch(`${API}/api/saved-quotes/${q.id}`, { headers: { ...h, 'Content-Type': 'application/json' }, data: { status: 'SENT' } })
    return q.id
  }

  // 1. Sent with this build: +10% on the main option only.
  const id1 = await sentQuote(`Slider e2e new ${run}`, 10)
  let b1 = await reopen(p, id1)
  check('sent with this build: the note shows (only the main option carries the slider)', await note(b1))
  await shot(p.page, 'sent-new-open')
  b1 = await makeMainAndSave(p, 'sent with this build', id1, b1)
  check('sent with this build, made main: the note is gone (the old main carries the slider)', !(await note(b1)))

  // 2. Sent before this build: every option took the slider and says nothing on its snapshot. Made as it was then:
  // a proposal with no slider, the quote then at +10% with every option on it ("Save new version", the rule reads a
  // proposal with nothing on its snapshots as every option carrying the slider), sent again.
  const id2 = await sentQuote(`Slider e2e old ${run}`, 0)
  sql(`update "SavedQuote" set "priceAdjust" = 0.1 where id = '${id2}'`)
  await reopen(p, id2)
  await p.page.locator('[data-quote-bar] [data-save-open]').tap(); await sleep(600)
  await p.page.locator('[data-save-submit]').tap().catch(() => {}); await sleep(2500)
  await p.page.locator('[data-quote-sent-new]').tap(); await sleep(3500)
  await ctx.request.patch(`${API}/api/saved-quotes/${id2}`, { headers: { ...h, 'Content-Type': 'application/json' }, data: { status: 'SENT' } })
  const old = await savedQuote(ctx, id2)
  check('the old style proposal: every option at +10%, nothing on any snapshot', (old.proposal?.options ?? []).every(o => o.snapshot?.priceAdjust === undefined) && Number(old.priceAdjust) === 0.1, JSON.stringify(optionPrices(old)))
  let b2 = await reopen(p, id2)
  check('sent before this build: no note (every option went out with the slider)', !(await note(b2)))
  await shot(p.page, 'sent-old-open')
  b2 = await makeMainAndSave(p, 'sent before this build', id2, b2)
  check('sent before this build, made main: still no note', !(await note(b2)))
  // 3. The Salesman's quote at +10%: she makes main on hers; the owner on another of hers.
  if (SALES) {
    const c = await phone(SALES)
    const id3 = await sentQuote(`Slider e2e Christa ${run}`, 10, c)
    let b3 = await reopen(c, id3)
    check('Christa\'s sent quote: the note shows', await note(b3))
    await shot(c.page, 'christa-sent-open')
    b3 = await makeMainAndSave(c, 'Christa on her sent quote', id3, b3)
    const id4 = await sentQuote(`Slider e2e Christa two ${run}`, 10, c)
    const b4 = await reopen(p, id4)
    await makeMainAndSave(p, 'owner on Christa\'s sent quote', id4, b4)
    check('Christa: no page errors', c.errors.length === 0, c.errors.join(' | '))
    await c.ctx.close()
  }
  check('no page errors', p.errors.length === 0, p.errors.join(' | '))
} finally {
  await browser.close()
  for (const id of made) {
    sql(`delete from "CrmAuditLog" where "entityId" = '${id}'`)
    const contact = sql(`select coalesce("crmContactId", '') from "SavedQuote" where id = '${id}'`)
    sql(`delete from "SavedQuote" where id = '${id}'`)
    if (contact && sql(`select count(*) from "SavedQuote" where "crmContactId" = '${contact}'`) === '0' && /^Slider e2e/.test(sql(`select "firstName" || ' ' || "lastName" from "CrmContact" where id = '${contact}'`))) sql(`delete from "CrmContact" where id = '${contact}'`)
  }
  console.log(`removed ${made.length} quotes: ${made.join(', ')}`)
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
