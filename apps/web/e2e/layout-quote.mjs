// Layout first quoting, in a browser on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> node e2e/layout-quote.mjs
//
// On a phone sized screen: walk the backyard on the walk list (Nov 5 2026: no
// drawing at the house), a walk gate in the left return and a double gate in
// the right return, pick a style; the sections, posts and price must match the
// same job typed as a run list. Then save, reopen on a computer sized screen,
// open it in the drawing tool (office), check the plan and post spacing, save
// at the same price, and the customer sees the finished plan.
// It saves to a customer of its own (made through the API), never a real one; the quote and the customer
// are deleted at the end.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (path, init = {}) => {
  const r = await fetch(API + path, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...(init.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}

async function open(browser, phone) {
  const ctx = await browser.newContext(phone ? { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 1000 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  await page.goto(APP)
  await page.waitForSelector(phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 30000 }); await sleep(800)
  return { ctx, page, errors }
}

async function typeLength(page, keys) {
  for (const k of keys) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
}

const browser = await chromium.launch()
let savedId = null
// Its own customer (it used to save onto a real customer of the dev copy, Shawn Collins).
const CUST = `Layout Quote E2E${Date.now().toString(36)}`
const contact = await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ firstName: 'Layout', lastName: CUST.replace(/^Layout /, ''), phone: '3525550167', email: 'e2e-layout-quote@example.invalid', serviceAddress: '110 SE Watula Ave, Ocala, FL 34471', leadSource: 'Other' }) })
const contactId = contact?.id
try {
  // ── Phone: build the backyard ──
  const s = await open(browser, true)
  const p = s.page
  const t0 = Date.now()
  let taps = 0
  const tap = async loc => { taps += 1; await loc.click() }
  await tap(p.locator('button:has-text("New quote"):visible').first())
  const b = p.locator('[data-quote-builder]')
  await b.locator('input[placeholder^="Customer name"]').fill('Layout test (e2e)')
  await tap(b.locator('[data-step="yard"]'))
  // The walk: 13 ft, a 4 ft walk gate, 13 ft to the corner; 120; 150; 120; 10 ft, a 10 ft double gate, 10 ft to the
  // end post at the house. Each digit on the keypad counts as a tap.
  for (const [ft, what, w] of [[13, 'gate', 4], [13, 'corner'], [120, 'corner'], [150, 'corner'], [120, 'corner'], [10, 'gate', 10], [10, 'end']]) {
    await b.locator('[data-walk-feet]').fill(String(ft)); taps += String(ft).length
    if (what === 'gate') { await tap(b.locator('[data-walk-gate]')); await tap(b.locator(`[data-walk-gate-width="${w}"]`)); await tap(b.locator(`[data-walk-gate-kind="${w === 10 ? 'double' : 'walk'}"]`)) }
    else if (what === 'corner') { await tap(b.locator('[data-walk-corner]')); await tap(b.locator('[data-walk-right]')) }
    else await tap(b.locator('[data-walk-end]'))
  }
  await tap(b.locator('[data-step="style"]'))
  await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft sections, No dig" }); taps += 1
  await tap(b.locator('[data-step="yard"]'))
  await sleep(500)
  const secs = Math.round((Date.now() - t0) / 1000)

  const total = async () => (await b.locator('text=Total sections').locator('xpath=following-sibling::span[1]').textContent()).trim()
  // The label reads "Price", or "Adjusted price" only when an adjustment is on (Nov 2 2026): the figure by its own mark.
  const price = async () => (await b.locator('[data-quote-price]').textContent()).trim()
  const sections = await total()
  const posts = (await p.locator('[data-quote-bar] [data-bar-facts]').textContent()).trim()
  const layoutPrice = await price()
  const priceLabel = (await b.locator('[data-quote-price]').locator('xpath=preceding-sibling::p[1]').textContent()).trim()
  check('phone: no adjustment on, so the label reads "Price" (not "Adjusted price")', priceLabel === 'Price', priceLabel)
  await p.screenshot({ path: process.env.SHOTS ? `${process.env.SHOTS}/phone-layout-top.png` : '/dev/null' }).catch(() => {})
  check('phone: backyard with two gated returns gives 57 sections', sections === '57', sections)
  check('phone: posts are counted from the walk: 4 corner, 6 end (4 of them at the gates)', /4 corner, 6 end$/.test(posts), posts)
  check('phone: walked in 45 taps or fewer (each keypad digit, step tabs included)', taps <= 45, `${taps} taps, ${secs}s for the test robot`)
  check('phone: a rough sketch, not to scale, and no drawing to edit', /not to scale/i.test(await b.locator('[data-walk-sketch]').innerHTML()) && (await b.locator('[data-site-plan]').count()) === 0)

  // The same job typed as a run list prices the same.
  await b.locator('[data-to-advanced]').click(); await sleep(300)
  const typed = await b.locator('input[placeholder="Length in feet"]').evaluateAll(els => els.map(e => e.value))
  const typedPrice = await price()
  check('advanced view gets exactly the layout\'s runs', typed.join(',') === '13,13,120,150,120,10,10', typed.join(','))
  check('and the same price', typedPrice === layoutPrice, `${layoutPrice} vs ${typedPrice}`)
  await b.locator('[data-to-layout]').click(); await sleep(300)
  check('back to the walk list keeps the steps', (await total()) === '57' && (await b.locator('[data-walk-step]').count()) === 7)

  // Pinned totals on the phone.
  await b.locator('[data-step="price"]').click(); await sleep(300)
  const sticky = (await p.locator('[data-quote-bar]').textContent()).trim()
  check('phone: footage, sections and price pinned at the bottom', sticky.includes('436 ft · 57 sections') && sticky.includes(layoutPrice), sticky)

  // Save to its own customer.
  await p.locator('[data-quote-bar] [data-save-open]').click()
  await p.locator('input[placeholder="Name, phone, or email..."]').fill(CUST); await sleep(600)
  await p.locator(`text=${CUST}`).last().click()
  await p.locator('button:has-text("Save quote")').last().click()
  await sleep(2500)
  check('phone: no page errors', s.errors.length === 0, s.errors.join(' | '))
  await s.ctx.close()

  const list = await api('/api/saved-quotes')
  const saved = (Array.isArray(list) ? list : list.quotes || []).filter(q => q.layout?.walk && q.crmContactId === contactId).sort((a, z) => String(z.createdAt).localeCompare(String(a.createdAt)))[0]
  savedId = saved?.id
  check('saved with its walk list, the sides walked and sections per run; site plan needed', !!saved && saved.layout.walk.lines[0].steps.length === 7 && saved.layout.yard.sides.length === 5 && saved.layout.runSections.join(',') === '2,2,15,19,15,2,2' && !saved.layout.planDone,
    saved ? `${saved.runs.join(',')} | ${saved.layout.runSections.join(',')}` : 'not found')

  // ── Computer: reopen the saved quote ──
  const d = await open(browser, false)
  await d.page.keyboard.press('Meta+k')
  await d.page.keyboard.type(CUST); await sleep(800)
  await d.page.locator('[data-global-search] [role="option"]:has-text("White Vinyl Privacy, 6 ft tall, 8 ft sections")').first().locator('button').first().click()
  await sleep(800)
  const b2 = d.page.locator('[data-quote-builder]')
  await b2.locator('[data-step="yard"]').click(); await sleep(400)
  const reopened = await b2.locator('[data-walk-step]').count()
  check('the saved quote reopens on its walk list', reopened === 7, `${reopened} steps`)
  // The office lays it out in the drawing tool (square corners from the turns, lengths kept).
  await b2.locator('[data-walk-open-drawing]').click(); await sleep(800)
  if (process.env.SHOTS) await d.page.screenshot({ path: `${process.env.SHOTS}/desktop-layout-reopened.png` })
  check('Open in drawing tool: the five sides in the drawing tool', (await b2.locator('[data-side-row]').count()) === 5 && (await b2.locator('[data-walk-drawing-note]').count()) === 1)
  {
  const p = d.page, b = b2
  // Site plan: drawn as typed, with every post the quote is priced with.
  const plan = b.locator('[data-site-plan]').first()
  const drawn = await plan.evaluate(svg => ({
    squares: svg.querySelectorAll('rect[width="12"]').length,
    dots: [...svg.querySelectorAll('circle')].filter(c => c.getAttribute('r') === '5.5').length,
    open: [...svg.querySelectorAll('circle')].filter(c => c.getAttribute('r') === '3.2').length,
    gates: svg.querySelectorAll('[data-plan-gate]').length,
    // Gate hinge posts are drawn as dark squares (walk gate: one; double gate: two).
    hinges: svg.querySelectorAll('[data-plan-hinge]').length,
    text: svg.textContent,
  }))
  check('drawing tool: the plan draws 4 corner squares, 6 end and gate posts (3 of them hinge squares), 2 gate swings', drawn.squares === 4 && drawn.dots + drawn.hinges === 6 && drawn.hinges === 3 && drawn.gates === 2, JSON.stringify({ ...drawn, text: undefined }))
  check('drawing tool: line posts drawn at the section count (57 sections, 7 runs = 50)', drawn.open === 50, String(drawn.open))
  check('drawing tool: footage, sections, house, street and the permitting note are on the plan',
    ['150\' 0"', 'Side 3 · 19 sec', 'Not to scale for permitting', "4' walk gate", "10' double gate"].every(t => drawn.text.includes(t)), drawn.text.slice(0, 200))
  await p.locator('[data-plan-side="Side 3"]').click({ force: true }); await sleep(400)
  check('drawing tool: tapping a side on the plan opens that side', (await b.locator('[data-side-open="true"]').getAttribute('data-side')) === 'Side 3')

  const drawnPosts = (await b.locator('[data-post-counts] p').nth(1).textContent()).trim()
  check('drawing tool: the same posts, 4 corner, 6 end (4 at gates)', /^4 corner · 6 end \(4 at gates\)/.test(drawnPosts), drawnPosts)
  if ((await b.locator('[data-side="Side 1"][data-side-open="true"]').count()) === 0) await b.locator('[data-side-row="Side 1"]').click()
  const leftRuns = (await b.locator('[data-side="Side 1"] [data-side-runs]').textContent()).trim()
  check('drawing tool: the left return is split around its gate, with post spacing', /Piece 1: 13' 0" = 2 sections, posts 6' 6" apart/.test(leftRuns), leftRuns)
  // Saved from the drawing tool with nothing changed: no question, the same price, Site plan needed off.
  let asked = ''
  d.page.once('dialog', dl => { asked = dl.message(); dl.dismiss() })
  await b.locator('[data-step="price"]').click(); await sleep(400)
  await d.page.locator('[data-quote-bar] [data-save-open]').click()
  await d.page.locator('[data-save-submit]').click()
  let drawnQuote = null
  for (let i = 0; i < 25 && !drawnQuote; i++) { await sleep(1000); const l = await api('/api/saved-quotes'), x = (Array.isArray(l) ? l : l.quotes || []).find(q => q.id === saved.id); if (x?.layout?.planDone) drawnQuote = x }
  check('saved from the drawing tool: not asked, the same price, the plan finished', !asked && !!drawnQuote && drawnQuote.finalPrice === saved.finalPrice, `${asked ? 'asked: ' + asked.slice(0, 80) : ''} $${saved.finalPrice} → $${drawnQuote?.finalPrice}`)
  await d.page.locator('[data-quote-builder] button[aria-label="Close"]').click().catch(() => {}); await sleep(400)
  }

  // The crew sees runs by side with post spacing on the customer's quote.
  await d.page.goto(`${APP}/?customer=${saved.crmContactId}`)
  await d.page.waitForSelector('[data-global-appointment]'); await sleep(1000)
  await d.page.locator('[data-customer-tab="quotes"]').first().click(); await sleep(500)
  // The quote's row on the Quotes tab (the summary tiles above show the same amount).
  await d.page.locator(`[data-customer-quote="${saved.id}"]`).first().click(); await sleep(800)
  const runTable = (await d.page.locator('[data-run-spacing]').first().textContent()).replace(/\s+/g, ' ')
  if (process.env.SHOTS) await d.page.screenshot({ path: `${process.env.SHOTS}/desktop-quote-drawer-runs.png` })
  check('the saved quote shows its site plan', await d.page.locator('[data-quote-plan] [data-site-plan]').count() > 0)
  check('the saved quote lists runs by side with post spacing', runTable.includes('Side 1 (1 of 2)') && runTable.includes(`7' 10 3/4"`), runTable.slice(0, 160))

  // The customer's link: the plan is on it, and no costs or margin are sent.
  const share = await api(`/api/saved-quotes/${saved.id}/share-token`, { method: 'POST' })
  const token = share.token || share.shareToken
  const pub = await (await fetch(`${API}/api/saved-quotes/share/${token}`)).json()
  check('the customer link sends no costs, margin or pull sheet', pub.data.totalCOGS === 0 && pub.data.gmPct === 0 && pub.data.pullSheet.length === 0 && pub.data.finalPrice > 0 && !!pub.data.layout?.yard,
    `cost ${pub.data.totalCOGS}, margin ${pub.data.gmPct}, ${pub.data.pullSheet.length} parts, price ${pub.data.finalPrice}`)
  await d.page.goto(`${APP}/#/quote/${token}`); await sleep(2500)
  if (process.env.SHOTS) await d.page.screenshot({ path: `${process.env.SHOTS}/customer-quote-with-plan.png`, fullPage: true })
  check('the customer sees the site plan on their quote', await d.page.locator('[data-plan-section] [data-site-plan]').count() > 0)
  check('desktop: no page errors', d.errors.length === 0, d.errors.join(' | '))
  await d.ctx.close()
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  if (savedId) await api(`/api/saved-quotes/${savedId}`, { method: 'DELETE' })
  if (contactId) await api(`/api/crm-contacts/${contactId}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
