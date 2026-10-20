// The quote window on a computer, a tablet and a phone, on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> node e2e/quote-window.mjs
//
// Computer (1440x900) and tablet (1024x768): the window is most of the screen
// tall, its bar (price, facts, Photos, Back, Next) is its own footer inside
// its border and on screen without scrolling the page; the content scrolls
// inside the window; Back and Next move between steps; the Yard step shows the
// plan and the sides side by side; opened from a pipeline card, nothing of the
// card window shows behind it, and Back lands on the card again.
// Phone (390x844): the bar is pinned to the bottom of the screen as before,
// with no Back button in it. Nothing is saved; the test card and customer are
// deleted at the end.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}) => {
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}
const FIRST = 'E2E', LAST = `Window ${Date.now().toString(36).slice(-4)}`
const NAME = `${FIRST} ${LAST}`
let contactId = null, leadId = null

async function session(browser, size) {
  const phone = size.width < 500
  const ctx = await browser.newContext(phone ? { viewport: size, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: size })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  return { ctx, page, errors }
}
async function open(page, url) {
  await page.goto(APP + url)
  await page.waitForSelector('[data-page-scroll]', { timeout: 30000 })
  await sleep(1200)
}
const box = async loc => await loc.boundingBox()
const inside = (a, b) => a && b && a.x >= b.x - 1 && a.y >= b.y - 1 && a.x + a.width <= b.x + b.width + 1 && a.y + a.height <= b.y + b.height + 1

async function fillBackyard(page) {
  const b = page.locator('[data-quote-builder]')
  await b.locator('[data-shape="backyard"]').click(); await sleep(400)
  await b.locator('[data-side="Left return"] [data-side-length]').click()
  for (const [keys, last] of [[['3', '0'], 0], [['1', '2', '0'], 0], [['1', '5', '0'], 0], [['1', '2', '0'], 0], [['3', '0'], 1]]) {
    for (const k of keys) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
    await page.locator(last ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]').click()
  }
  await sleep(400)
}

async function bigScreen(browser, size, tag) {
  const { ctx, page, errors } = await session(browser, size)
  await open(page, '/?quote=new')
  const b = page.locator('[data-quote-builder]')
  const win = page.locator('[data-quote-window]')
  const bar = page.locator('[data-quote-bar]')
  await win.waitFor()
  const vh = size.height
  const wb = await box(win), bb = await box(bar)
  check(`${tag}: the window is most of the screen tall`, wb.height >= vh * 0.88 && wb.height <= vh, `${Math.round(wb.height)} of ${vh}`)
  check(`${tag}: the bar is the window's footer, inside its border, at its bottom`, inside(bb, wb) && Math.abs((bb.y + bb.height) - (wb.y + wb.height)) <= 2, JSON.stringify({ bar: bb, win: wb }))
  check(`${tag}: the bar is on screen without scrolling the page`, bb.y + bb.height <= vh && bb.y >= 0)
  const back = bar.locator('[data-bar-back]'), next = bar.locator('[data-bar-next]')
  check(`${tag}: Back on the left (off on the first step), Next on the right`, await back.isVisible() && await back.isDisabled() && (await box(back)).x < (await box(next)).x && (await box(next)).x + (await box(next)).width > bb.x + bb.width - 60)

  await b.locator('input[placeholder^="Customer name"]').fill('Window test (e2e)')
  await next.click(); await sleep(400)
  check(`${tag}: Next goes to the Yard step`, await b.locator('[data-step="yard"][aria-selected="true"]').count() === 1)
  await back.click(); await sleep(300)
  check(`${tag}: Back goes to the Customer step, nothing lost`, await b.locator('[data-step="customer"][aria-selected="true"]').count() === 1 && await b.locator('input[placeholder^="Customer name"]').inputValue() === 'Window test (e2e)')
  await next.click(); await sleep(300)
  await fillBackyard(page)
  const plan = await box(page.locator('[data-layout-plan-col]')), sides = await box(page.locator('[data-layout-sides-col]'))
  check(`${tag}: Yard step: the plan on the left, the sides on the right`, plan && sides && plan.x + plan.width <= sides.x + 1 && Math.abs(plan.y - sides.y) < 40, JSON.stringify({ plan, sides }))
  const bb2 = await box(bar)
  check(`${tag}: the footer has not moved`, Math.abs(bb2.y - bb.y) <= 2 && Math.abs(bb2.height - bb.height) <= 30)
  if (SHOTS && tag === 'computer') await page.screenshot({ path: `${SHOTS}/dev-quote-window-desktop-yard.png` })

  await b.locator('[data-step="style"]').click(); await sleep(300)
  await b.locator('[data-step-panel="style"] select').first().selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig" }); await sleep(500)
  await next.click(); await sleep(800)
  check(`${tag}: Price step: Save quote sits where Next was`, await bar.locator('[data-save-open]').isVisible())
  const scroller = page.locator('[data-quote-scroll]')
  const sc = await scroller.evaluate(el => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  check(`${tag}: the Price step scrolls inside the window`, sc.sh > sc.ch, JSON.stringify(sc))
  await scroller.evaluate(el => el.scrollTo({ top: el.scrollHeight }))
  await sleep(300)
  const bb3 = await box(bar)
  const pageScroll = await page.evaluate(() => document.scrollingElement.scrollTop)
  check(`${tag}: scrolled to the end, the footer stays put and the page itself does not scroll`, Math.abs(bb3.y - bb.y) <= 2 && pageScroll === 0)
  check(`${tag}: the bar's price matches the Price step`, (await bar.locator('[data-bar-price]').textContent()).trim().startsWith((await b.locator('[data-quote-price]').textContent()).trim()))
  await scroller.evaluate(el => el.scrollTo({ top: 0 }))
  if (SHOTS && tag === 'computer') await page.screenshot({ path: `${SHOTS}/dev-quote-window-desktop-price.png` })
  if (SHOTS && tag === 'tablet') await page.screenshot({ path: `${SHOTS}/dev-quote-window-tablet.png` })
  if (SHOTS && tag === 'computer') {
    await b.locator('[data-tiers]').scrollIntoViewIfNeeded(); await sleep(300)
    await page.screenshot({ path: `${SHOTS}/dev-quote-tier-cards.png` })
  }
  await back.click(); await sleep(300)
  check(`${tag}: Back from Price goes to Style`, await b.locator('[data-step="style"][aria-selected="true"]').count() === 1)

  // From a pipeline card: the card window is hidden behind the quote, and back again after.
  await page.locator('[data-quote-close]').click(); await sleep(800)
  await open(page, '/pipeline')
  const card = page.locator(`[data-kanban-col] >> text=${NAME}`).first()
  await card.scrollIntoViewIfNeeded(); await card.click(); await sleep(900)
  await page.locator('[data-card-new-quote]').click(); await sleep(1200)
  check(`${tag}: from a card: the quote opens and the card window behind it is hidden`, await page.locator('[data-quote-window]').isVisible() && !(await page.locator('[data-card-window]').isVisible()) && await page.locator('[data-card-window]').count() === 1)
  const hidden = await page.locator('[data-card-window] [data-card-new-quote]').evaluate(el => getComputedStyle(el).visibility)
  check(`${tag}: none of the card's fields show through`, hidden === 'hidden', hidden)
  if (SHOTS && tag === 'computer') await page.screenshot({ path: `${SHOTS}/dev-quote-from-card.png` })
  await page.goBack({ waitUntil: 'commit' }).catch(() => {}); await sleep(800)
  check(`${tag}: Back from the quote lands on the card again`, !(await page.locator('[data-quote-builder]').count()) && await page.locator('[data-card-window]').isVisible() && page.url().includes(`card=${leadId}`), page.url())
  check(`${tag}: no page errors`, errors.length === 0, errors.join(' | '))
  await ctx.close()
}

async function phone(browser) {
  const { ctx, page, errors } = await session(browser, { width: 390, height: 844 })
  await open(page, '/?quote=new')
  const bar = page.locator('[data-quote-bar]')
  await bar.waitFor()
  const bb = await box(bar)
  check('phone: the bar is pinned to the bottom of the screen, full width', Math.abs(bb.y + bb.height - 844) <= 1 && bb.x === 0 && Math.abs(bb.width - 390) <= 1, JSON.stringify(bb))
  check('phone: no Back button in the bar (as before)', !(await bar.locator('[data-bar-back]').isVisible()))
  const wb = await box(page.locator('[data-quote-window]'))
  check('phone: the window fills the screen', wb.x === 0 && Math.abs(wb.width - 390) <= 1 && wb.height >= 844 - 1)
  await bar.locator('[data-bar-next]').tap(); await sleep(400)
  check('phone: Next goes to the Yard step', await page.locator('[data-step="yard"][aria-selected="true"]').count() === 1)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-quote-window-phone.png` })
  check('phone: no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
}

const browser = await chromium.launch()
try {
  const c = await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ firstName: FIRST, lastName: LAST, phone: '3525550143', serviceAddress: '5708 SW 90th Ln, Ocala, FL 34476', leadSource: 'Referral' }) })
  contactId = c.id
  const pipe = await api('/api/pipeline')
  leadId = `e2e-window-${Date.now()}`
  const today = new Date().toISOString().slice(0, 10)
  const lead = { id: leadId, customerId: contactId, firstName: FIRST, lastName: LAST, phone: '3525550143', email: '', address: '5708 SW 90th Ln, Ocala, FL 34476', leadSource: 'Referral', leadTemp: 0, fenceType: '', sections: 0, quotePrice: 0, crew: '', scheduledDate: '', jobValue: 0, paymentStatus: '', balanceDue: 0, notes: '', stage: 'First Contact', createdAt: new Date().toISOString(), lastMoved: today }
  const r = await fetch(`${API}/api/pipeline`, { method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ upsert: [{ lead }], remove: [], baseVersion: pipe.version }) })
  check('setup: a customer with a pipeline card', !!contactId && r.ok)
  await bigScreen(browser, { width: 1440, height: 900 }, 'computer')
  await bigScreen(browser, { width: 1024, height: 768 }, 'tablet')
  await phone(browser)
} catch (e) {
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
} finally {
  if (leadId) {
    const pipe = await api('/api/pipeline')
    await fetch(`${API}/api/pipeline`, { method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ upsert: [], remove: [leadId], baseVersion: pipe.version }) })
  }
  if (contactId) await api(`/api/crm-contacts/${contactId}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
