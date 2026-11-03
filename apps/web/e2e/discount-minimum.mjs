// A discount below the minimum job price (Jonathan, Nov 2 2026): "block it and warn the salesman. Owner can override."
// On the dev copy (run `pnpm -s build` in apps/web first).
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_SALES_TOKEN=<Christa's token> E2E_OWNER_TOKEN=<owner token> \
//     E2E_SALES_COOKIE=<Christa's cookie> E2E_OWNER_COOKIE=<owner cookie> [SHOTS=<folder>] node e2e/discount-minimum.mjs
//
// Christa on a phone sized WebKit (iPhone): a small chain link job with her own customer. A discount that takes the
// price or another option under the minimum stops her with the reason and the minimum; Save is off; a price typed by
// hand is stopped the same way; a discount that stays over it saves. The owner opens the same quote: warned, the box
// lets him save it, the audit log has it. Christa reopens it: no warning, a note saves, a bigger discount is stopped.
// A repair is held the same way, and a real quote nobody touched opens with no warning.
// Removes everything it made (hard deletes on ezbiz_dev only).
import './devOnly.mjs'
import { webkit, chromium } from 'playwright'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKENS = { sales: process.env.E2E_SALES_TOKEN || '', owner: process.env.E2E_OWNER_TOKEN || '' }
const COOKIES = { sales: process.env.E2E_SALES_COOKIE || '', owner: process.env.E2E_OWNER_COOKIE || '' }
const SHOTS = process.env.SHOTS || ''
if (!TOKENS.sales || !TOKENS.owner || !COOKIES.sales || !COOKIES.owner) { console.error('Set E2E_SALES_TOKEN, E2E_OWNER_TOKEN, E2E_SALES_COOKIE and E2E_OWNER_COOKIE (scripts/dev-session-token.ts).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (who, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${TOKENS[who]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', q]).toString().trim()
const dollars = text => { const m = String(text).match(/\$\s?([\d,]+(?:\.\d{2})?)/); return m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) : NaN }
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }

const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
const stamp = Date.now().toString(36).slice(-5)
const contactId = crypto.randomUUID(), quoteId = crypto.randomUUID(), repairId = crypto.randomUUID()

async function phone(browser, who, opts = IPHONE) {
  const ctx = await browser.newContext(opts)
  const u = new URL(API)
  await ctx.addCookies([{ name: 'ezbiz_staff', value: COOKIES[who], domain: u.hostname, path: '/api', httpOnly: true, secure: false, sameSite: 'Strict' }])
  const errors = []
  let page = null
  // A new page each time: Playwright's WebKit crashes on a second load in one page on this Mac (it did before this change too).
  const open = async id => {
    await page?.close().catch(() => {})
    page = await ctx.newPage()
    s.page = page
    page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
    page.on('dialog', d => d.accept().catch(() => {}))
    await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
    await page.goto(`${APP}/?quote=${id}`)
    await page.waitForSelector('[data-quote-builder] [data-bar-price]', { timeout: 40000 })
    await sleep(2000)
  }
  const price = async () => dollars(await page.locator('[data-bar-price]').first().innerText())
  const adjust = async v => { await page.locator('[data-adjust-dollars]').fill(v); await sleep(900) }
  const warning = async () => (await page.locator('[data-below-minimum-text]').count()) ? page.locator('[data-below-minimum-text]').innerText() : ''
  const saveOff = () => page.locator('[data-save-open]').first().isDisabled()
  const save = async () => {
    await page.locator('[data-save-open]').first().click()
    await page.waitForSelector('[data-save-submit]', { timeout: 10000 })
    await page.locator('[data-save-submit]').click()
    await sleep(1500)
  }
  const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${who}-${name}.png`) }).catch(e => console.log('(no picture:', String(e).slice(0, 80), ')')) }
  const s = { ctx, page, errors, open, price, adjust, warning, saveOff, save, shot }
  return s
}
const saved = async id => (await call('owner', 'GET', `/api/saved-quotes/${id}`)).json.data
const cleanUp = () => {
  sql(`delete from "CrmAuditLog" where "entityId" in ('${quoteId}', '${repairId}', '${contactId}')`)
  sql(`delete from "SavedQuote" where id in ('${quoteId}', '${repairId}')`)
  sql(`delete from "CrmContact" where id = '${contactId}'`)
}

const browser = await webkit.launch()
try {
  const c = await call('sales', 'POST', '/api/crm-contacts', { id: contactId, firstName: 'E2E', lastName: `Minimum ${stamp}`, phone: '3525550178', email: 'e2e-minimum@example.invalid', leadSource: 'Other', address: '30 Discount Dr, Ocala, FL 34470' })
  const who = { crmContactId: contactId, customerName: `E2E Minimum ${stamp}`, customerPhone: '3525550178', customerEmail: 'e2e-minimum@example.invalid', customerAddress: '30 Discount Dr, Ocala, FL 34470', leadSource: 'Other', date: '2026-11-02' }
  const q = await call('sales', 'POST', '/api/saved-quotes', { id: quoteId, ...who, fenceStyle: "CL - 4' Galv", runs: [6], corners: 0, ends: 2, walkGates: 0, dblGates: 0, status: 'DRAFT', pullSheet: [], hasSalesman: true })
  check('set up: Christa\'s customer and a small chain link draft', c.status < 300 && q.status < 300, `${c.status} ${q.status}`)

  // ── Christa, on her phone ──
  const christa = await phone(browser, 'sales')
  await christa.open(quoteId)
  const list = await christa.price()
  check('the quote opens with no warning and Save on', !(await christa.warning()) && !(await christa.saveOff()), `$${list / 100}`)

  await christa.adjust('-100')
  const low = await christa.price()
  let w = await christa.warning()
  check('$100 off: she sees the price it would be, and is stopped', low === list - 10000 && await christa.saveOff(), `$${low / 100}`)
  check('the warning says why and the minimum, in plain words', /This cannot be saved\./.test(w) && /\$350 minimum job price/.test(w) && /ask Jonathan/.test(w) && !/[—–]/.test(w), w)
  const box = await christa.page.locator('[data-below-minimum]').boundingBox()
  const barPriceBox = await christa.page.locator('[data-bar-price]').first().boundingBox()
  check('it sits on the bar, on screen, under the price', !!box && !!barPriceBox && box.y >= barPriceBox.y && box.y + box.height <= 844, JSON.stringify(box))
  check('no override box for her', (await christa.page.locator('[data-below-minimum-override]').count()) === 0)
  await christa.shot('blocked')
  // The bar grows with the warning: the end of the step still scrolls clear of it.
  const clear = await christa.page.evaluate(() => {
    const scroller = document.querySelector('[data-quote-builder]')
    scroller.scrollTop = scroller.scrollHeight
    const kids = [...document.querySelector('[data-quote-scroll]').querySelectorAll('button, input, label')].filter(e => e.getBoundingClientRect().height > 0)
    const last = Math.max(...kids.map(e => e.getBoundingClientRect().bottom))
    return { last, bar: document.querySelector('[data-below-minimum]').closest('.fixed')?.getBoundingClientRect().top ?? 0 }
  })
  await sleep(200)
  check('with the warning showing, the bottom of the step scrolls clear of the bar', clear.last <= clear.bar, JSON.stringify(clear))

  await christa.page.locator('[data-adjust-final]').fill(String(Math.round(list / 100) - 100))
  await sleep(900)
  check('the same by typing a Final price', /minimum job price/.test(await christa.warning()) && await christa.saveOff())
  await christa.page.locator('[data-adjust-final]').blur()

  await christa.adjust('')
  await sleep(300)
  check('taking it off clears the warning', !(await christa.warning()) && !(await christa.saveOff()) && (await christa.price()) === list)

  // A discount over the minimum for the quote, but not for the other option.
  const other = (await christa.page.locator('[data-tier-price]').allInnerTexts()).map(dollars).filter(n => n !== list)[0]
  const off = Math.ceil((list - 35000) / 100) - 1
  await christa.adjust(`-${off}`)
  w = await christa.warning()
  const lowOther = other - off * 100
  check('a discount that leaves the quote over it but another option under it: stopped, that option named', lowOther >= 35000 ? !w : /would be/.test(w) && await christa.saveOff(), w || `other $${lowOther / 100}`)

  // Over the minimum on every option: saves.
  const fine = Math.floor((Math.min(list, other) - 35000) / 100)
  await christa.adjust(fine > 0 ? `-${fine}` : '')
  check('a discount that keeps every option at or over $350: Save on', !(await christa.warning()) && !(await christa.saveOff()), `-$${fine}`)
  await christa.save()
  const s1 = await until(async () => { const x = await saved(quoteId); return x?.finalPrice === Math.round(list / 100) - fine ? x : null })
  check('it saved at that price', !!s1, String(s1?.finalPrice))
  check('every saved option is at or over the minimum', (s1?.proposal?.options ?? []).every(o => o.finalPrice >= 350), (s1?.proposal?.options ?? []).map(o => o.finalPrice).join(', '))

  await christa.open(quoteId)
  const finalBox = christa.page.locator('[data-price-adjustment]')
  await christa.page.locator('[data-tier-price]').first().waitFor({ timeout: 10000 }).catch(() => {})
  check('the Price adjustment box is there on her phone', await finalBox.isVisible())

  // ── The owner, on his phone ──
  const owner = await phone(browser, 'owner')
  await owner.open(quoteId)
  await owner.adjust('-100')
  const ownerLow = await owner.price()
  w = await owner.warning()
  check('the owner is warned too, with what he can do', /minimum job price/.test(w) && /As the owner you can save it anyway/.test(w), w)
  check('his Save is off until he ticks the box', await owner.saveOff() && (await owner.page.locator('[data-below-minimum-override]').count()) === 1)
  await owner.shot('warned')
  await owner.page.locator('[data-below-minimum-override]').check()
  await sleep(300)
  check('ticked: Save on', !(await owner.saveOff()))
  await owner.shot('ticked')
  await owner.save()
  const s2 = await until(async () => { const x = await saved(quoteId); return Math.round(x?.finalPrice * 100) === ownerLow ? x : null })
  check('saved under the minimum, at the price he set', !!s2, String(s2?.finalPrice))
  const audit = sql(`select count(*) from "CrmAuditLog" where "entityId" = '${quoteId}' and action = 'discount_override'`)
  const logged = sql(`select "newValues"::text from "CrmAuditLog" where "entityId" = '${quoteId}' and action = 'discount_override' limit 1`)
  check('the audit log has his override, once, with the prices and the minimum', audit === '1' && /35000/.test(logged), logged)
  await owner.open(quoteId)
  check('reopened: no warning, Save on', !(await owner.warning()) && !(await owner.saveOff()))
  check('owner: nothing broke on the page', owner.errors.length === 0, owner.errors.join(' | '))
  await owner.ctx.close()

  // ── Christa again: it is not stuck for her, and she cannot take it lower ──
  await christa.open(quoteId)
  check('Christa opens it: the owner\'s price stands, no warning', !(await christa.warning()) && (await christa.price()) === ownerLow, `$${ownerLow / 100}`)
  const notes = await call('sales', 'PATCH', `/api/saved-quotes/${quoteId}`, { notes: 'Customer wants to think it over' })
  check('a note on it saves', notes.status === 200)
  await christa.adjust('-110')
  check('she takes more off: stopped', /minimum job price/.test(await christa.warning()) && await christa.saveOff())
  const crafted = await call('sales', 'PATCH', `/api/saved-quotes/${quoteId}`, { finalPrice: 100 })
  check('a crafted save at $100: refused by the server', crafted.status === 409 && crafted.json.code === 'DISCOUNT_BELOW_MINIMUM', crafted.json.error)
  check('Christa: nothing broke on the page', christa.errors.length === 0, christa.errors.join(' | '))
  await christa.ctx.close()

  // ── The owner at the computer ──
  const desk = await chromium.launch()
  const pc = await phone(desk, 'owner', { viewport: { width: 1440, height: 900 } })
  await pc.open(quoteId)
  await pc.adjust('-110')
  check('at the computer: the same warning and box in the window\'s footer', /As the owner you can save it anyway/.test(await pc.warning()) && await pc.saveOff() && await pc.page.locator('[data-below-minimum-override]').isVisible())
  await pc.shot('desktop')
  await pc.ctx.close()
  await desk.close()

  // ── A repair ──
  const template = (await call('owner', 'GET', '/api/saved-quotes/43683186-b8ad-4492-b627-6d2d5e97fe72')).json.data
  if (template?.work) {
    const fields = ['fenceStyle', 'runs', 'runRails', 'layout', 'corners', 'ends', 'walkGates', 'dblGates', 'tearOutSections', 'tearOutGates', 'adjLaborHrs', 'hasSalesman', 'priceAdjust', 'sections', 'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'finalPrice', 'gmPct', 'pullSheet', 'work']
    const pricing = { ...(template.pricing ?? {}) }
    delete pricing.priceAdjustmentCents; delete pricing.showDiscountOnProposal
    const small = { ...template.work, repair: { ...template.work.repair, what: 'wear', items: { resetPost: 1 } } }
    const r = await call('sales', 'POST', '/api/saved-quotes', { id: repairId, ...Object.fromEntries(fields.map(k => [k, template[k]])), work: small, ...who, pricing, proposal: template.proposal ? { ...template.proposal, showDiscount: undefined } : null, status: 'DRAFT' })
    check('set up: a real repair copied to her customer', r.status < 300, `${r.status} ${r.json?.error ?? ''}`)
    const c2 = await phone(browser, 'sales')
    await c2.open(repairId)
    const repairPrice = await c2.price()
    await c2.page.locator('input[placeholder="Calculated"]:visible').fill('200')
    await sleep(900)
    w = await c2.warning()
    check('a repair: a price typed by hand under the minimum is stopped', /would be \$200/.test(w) && /minimum job price/.test(w) && await c2.saveOff(), `$${repairPrice / 100}: ${w}`)
    await c2.shot('repair')
    check('repair: nothing broke on the page', c2.errors.length === 0, c2.errors.join(' | '))
    await c2.ctx.close()
  }

  // ── A real quote with a discount nobody touches ──
  const real = sql(`select id from "SavedQuote" where (pricing->>'priceAdjustmentCents')::int < 0 and status = 'DRAFT' and "deletedAt" is null limit 1`)
  if (real) {
    const o = await phone(browser, 'owner')
    await o.open(real)
    check('a real draft with a discount over the minimum opens with no warning', !(await o.warning()) && !(await o.saveOff()))
    await o.ctx.close()
  }
} finally {
  await browser.close()
  cleanUp()
}
const failed = results.filter(x => !x).length
console.log(`\n${results.length - failed} of ${results.length} passed`)
process.exit(failed ? 1 : 0)
