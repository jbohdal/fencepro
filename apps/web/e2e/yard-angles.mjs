// The yard drawing with real angles: 451 Locust Rd rebuilt (Custom, 7 sides as
// typed on the live quote: 14' meeting the house with a 4' walk gate, 28', 70',
// 27', 46', 88', 13'; 6 corner, 4 end; no tee), drawn as saved: untangled (no
// side crosses another), an angle typed back to the old 90° right (Side 6
// crosses Side 3: the warning shows) and forward again, corners dragged. Every side keeps
// its typed length on the drawing (measured from the SVG), the angles show,
// nothing else resets the drawing (Meets the house, an end type, a gate, a
// side off and on, a length), the house moves / turns / sizes, the price is
// the same before and after dragging, it saves and reopens the same, and the
// proposal and crew packet show the same drawing. Then Draw on photo (tiles
// stubbed) fills a new quote's sides. Phone (390x844 touch, WebKit by default)
// then desktop Chromium.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> [BROWSER=webkit|chromium] node e2e/yard-angles.mjs
//   On the Android emulator's Chrome: adb reverse tcp:4001 tcp:4001; adb forward tcp:9333
//   localabstract:chrome_devtools_remote; CDP_URL=http://localhost:9333 node e2e/yard-angles.mjs
//
// Makes a customer, two quotes and a sold job, then deletes them.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes and deletes quotes and a job on the shared dev copy
import { webkit, chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const CDP = process.env.CDP_URL || ''
const ENGINE = process.env.BROWSER === 'chromium' ? chromium : webkit
const NAME = CDP ? 'android' : process.env.BROWSER === 'chromium' ? 'chromium' : 'webkit'
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API) || /:4000(\/|$)/.test(APP)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}) => {
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}

const ADDRESS = '451 Locust Rd, Ocala, FL 34472'
const CUSTOMER = 'E2E Yard Angles'
const OCALA = { lat: 29.13, lng: -82.09 }
const LENGTHS = [14, 28, 70, 27, 46, 88, 13]
const HEADINGS = [0, 270, 180, 90, 0, 270, 180]
/** 451 Locust Rd as saved on the live quote (read only). */
const locust = () => ({ shape: 'custom', closed: false, plan: { points: null, pointsFor: null }, sides: LENGTHS.map((n, i) => ({
  id: `ya${i + 1}`, name: `Side ${i + 1}`, on: true, lengthIn: n * 12,
  startFinish: i === 0 ? 'house' : 'corner', endFinish: i === 6 ? 'free' : 'corner',
  gate: i === 0 ? { type: 'walk', widthIn: 48, position: 'middle' } : null, skip: null, heading: HEADINGS[i],
})) })
const made = { contact: null, quote: null, quote2: null, quoteTee: null, job: null }
// A plain green photo for every tile (Draw on photo, the aerial photo).
const GREEN_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGOQrKkBAAGsAN5PO6ywAAAAAElFTkSuQmCC', 'base64')

const browser = CDP ? await chromium.connectOverCDP(CDP) : await ENGINE.launch()
const desktopBrowser = CDP ? await chromium.launch() : browser.browserType() === chromium ? browser : await chromium.launch()
async function stub(ctx) {
  await ctx.route(/USGSNAIPPlus\/ImageServer\/exportImage|USGSImageryOnly\/MapServer\/tile|\/p\/tiles\/(naip|esri|aerial)\/|gis\.ocalafl\.org/, r =>
    /gis\.ocalafl/.test(r.request().url())
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ features: [] }) })
      : r.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: GREEN_PNG }))
  await ctx.route(/\/geo\/lookup/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...OCALA, source: 'e2e' } }) }))
}
async function signIn(ctx) {
  if (CDP) { const p0 = await ctx.newPage(); await p0.goto(APP); await p0.evaluate(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN); await p0.close() }
  else await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
}

const svgSel = '[data-plan-wrap] svg[data-site-plan]'
/** What the drawing shows: each side's length (feet, from the SVG's own scale), the angles, the crossings, the house. */
const planInfo = p => p.locator(svgSel).evaluate(svg => {
  const f = Number(svg.getAttribute('data-ft-per-unit'))
  const sides = [...svg.querySelectorAll('line[data-plan-side]')].map(l => ({ name: l.getAttribute('data-plan-side'), a: { x: l.x1.baseVal.value, y: l.y1.baseVal.value }, b: { x: l.x2.baseVal.value, y: l.y2.baseVal.value } }))
    .map(s => ({ ...s, ft: Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) * f }))
  const angles = [...svg.querySelectorAll('[data-plan-angle]')].map(g => ({ name: g.getAttribute('data-plan-angle'), deg: Number(g.getAttribute('data-angle-deg')), turn: g.getAttribute('data-angle-turn'), tee: g.getAttribute('data-angle-tee') === 'true' }))
  const house = svg.querySelector('[data-plan-house]')?.getAttribute('points')?.trim().split(/\s+/).map(t => t.split(',').map(Number)).map(([x, y]) => ({ x, y })) ?? null
  return { f, sides, angles, crossings: svg.querySelectorAll('[data-plan-crossing]').length, house, tees: svg.querySelectorAll('[data-plan-tee-post]').length }
})
const angleKey = info => info.angles.map(a => `${a.name}:${a.deg.toFixed(2)}${a.turn[0]}`).sort().join(' | ')
const lengthsOk = info => LENGTHS.every((n, i) => { const s = info.sides.find(x => x.name === `Side ${i + 1}`); return s && Math.abs(s.ft - n) < 0.05 })
const lengthsText = info => info.sides.map(s => `${s.name.replace('Side ', 'S')}=${s.ft.toFixed(2)}`).join(' ')
/** Distance (drawing units) from a point to the house outline. */
const toHouse = (house, p) => Math.min(...house.map((a, k) => {
  const b = house[(k + 1) % house.length], dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2))
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t)
}))

try {
  const contact = await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ firstName: 'E2E', lastName: 'Yard Angles', phone: '3525550178', serviceAddress: ADDRESS, leadSource: 'Referral' }) })
  made.contact = contact.id
  const q0 = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({
    crmContactId: contact.id, customerName: CUSTOMER, customerPhone: '3525550178', customerAddress: ADDRESS,
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [5, 5, 28, 70, 27, 46, 88, 13], corners: 6, ends: 4, walkGates: 1, sections: 0, status: 'DRAFT', finalPrice: 0,
    date: new Date().toISOString().slice(0, 10), layout: { yard: locust(), runSections: [] },
  }) })
  made.quote = q0.id

  // ── Phone ─────────────────────────────────────────────────────────────────────
  const ctx = CDP ? browser.contexts()[0] : await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: NAME === 'chromium', hasTouch: true })
  await signIn(ctx); await stub(ctx)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  const tapLoc = async loc => { await loc.scrollIntoViewIfNeeded(); await (CDP || NAME !== 'webkit' || (loc.page().viewportSize()?.width ?? 0) > 900 ? loc.click() : loc.tap()); await sleep(350) }
  const openQuote = async (p, id) => {
    await p.goto(`${APP}/quotes?quote=${id}`)
    await p.locator('[data-quote-builder] [data-step="yard"]').click({ timeout: 30000 })
    await p.waitForSelector(svgSel, { timeout: 30000 }); await sleep(1200)
  }
  const facts = async p => ({
    prices: (await p.locator('[data-quote-builder]').textContent()).match(/\$[\d,]+(\.\d\d)?/g)?.join() ?? '',
    bar: (await p.locator('[data-bar-facts]').textContent()).trim(),
  })
  const shot = async (p, name, sel = null) => {
    if (!SHOTS) return
    if (!sel) { await p.screenshot({ path: `${SHOTS}/${name}.png` }); return }
    await p.locator(sel).first().evaluate(el => el.scrollIntoView({ block: 'center' })); await sleep(300)
    await p.locator(sel).first().screenshot({ path: `${SHOTS}/${name}.png` })
  }
  /** Fingers as pointer events (touch), each step at [{ id, x, y }]. */
  const fingers = (p, type, pts) => p.evaluate(({ type, pts }) => {
    window.__e2eTargets = window.__e2eTargets || {}
    for (const f of pts) {
      if (type === 'pointerdown') window.__e2eTargets[f.id] = document.elementFromPoint(f.x, f.y)
      const el = window.__e2eTargets[f.id]
      el.dispatchEvent(new PointerEvent(type, { pointerId: f.id, pointerType: 'touch', isPrimary: true, clientX: f.x, clientY: f.y, bubbles: true, cancelable: true, composed: true }))
    }
  }, { type, pts })
  /** Drag a handle by (dx, dy) screen pixels: a finger on the phone, the mouse on a computer. Returns what showed mid-drag. */
  async function drag(p, sel, dx, dy, touch) {
    const loc = p.locator(sel).first()
    await loc.evaluate(el => el.scrollIntoView({ block: 'center' })); await sleep(250)
    const b = await loc.boundingBox()
    const c = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
    let mid = null
    if (touch) {
      await fingers(p, 'pointerdown', [{ id: 21, ...c }]); await sleep(50)
      for (let k = 1; k <= 10; k++) {
        await fingers(p, 'pointermove', [{ id: 21, x: c.x + dx * k / 10, y: c.y + dy * k / 10 }]); await sleep(35)
        if (k === 7) mid = { live: await p.locator(`${svgSel} [data-plan-drag-text]`).textContent().catch(() => ''), loupe: await p.locator(`${svgSel} [data-plan-loupe]`).count(), angles: await p.locator(`${svgSel} [data-plan-angle]`).count() }
      }
      await fingers(p, 'pointerup', [{ id: 21, x: c.x + dx, y: c.y + dy }])
    } else {
      await p.mouse.move(c.x, c.y); await p.mouse.down()
      for (let k = 1; k <= 10; k++) {
        await p.mouse.move(c.x + dx * k / 10, c.y + dy * k / 10); await sleep(30)
        if (k === 7) mid = { live: await p.locator(`${svgSel} [data-plan-drag-text]`).textContent().catch(() => ''), loupe: await p.locator(`${svgSel} [data-plan-loupe]`).count(), angles: await p.locator(`${svgSel} [data-plan-angle]`).count() }
      }
      await p.mouse.up()
    }
    await sleep(400)
    return mid
  }
  const openSide = async (p, name) => {
    const row = p.locator(`[data-side-row="${name}"]`)
    if (await p.locator(`[data-side="${name}"][data-side-open="true"]`).count() === 0) await tapLoc(row)
    if (await p.locator(`[data-side="${name}"] [data-side-options]`).count() === 0) await tapLoc(p.locator(`[data-side="${name}"] [data-side-more]`))
  }
  const typePad = async (p, digits) => {
    for (const k of digits) await tapLoc(p.locator(`[data-ftin-pad] [data-pad-key="${k}"]`))
    await tapLoc(p.locator('[data-ftin-pad] [data-pad-done]'))
  }
  async function saveQuote(p) {
    await tapLoc(p.locator('[data-quote-builder] [data-step="price"]'))
    await tapLoc(p.locator('[data-quote-bar] [data-save-open]'))
    const go = p.locator('button:has-text("Save quote"), button:has-text("Update quote")').last()
    if (await go.isDisabled()) {
      await p.locator('input[placeholder="Name, phone, or email..."]').fill(CUSTOMER); await sleep(500)
      await tapLoc(p.locator(`text=${CUSTOMER}`).last())
    }
    await tapLoc(go)
    for (let k = 0; k < 40 && await p.locator('button:has-text("Save quote")').count(); k++) await sleep(500)
    await sleep(2500)
  }

  await openQuote(page, made.quote)
  const touch = NAME !== 'android' || true
  // 1. As saved (the live quote's sides: 6 corner, 4 end, Side 1 meets the house, no tee): drawn untangled.
  let info = await planInfo(page)
  check('as saved: every side drawn at its typed length', lengthsOk(info), lengthsText(info))
  check('as saved: drawn with no side crossing (each turn square; Side 5 turns left so Side 6 clears Side 3)',
    info.angles.length === 6 && info.angles.every(a => Math.abs(a.deg - 90) < 0.01) && info.angles.filter(a => a.turn === 'left').map(a => a.name).join() === 'Side 5'
    && info.crossings === 0 && await page.locator('[data-plan-crossing-note]').count() === 0, angleKey(info))
  const posts0 = (await page.locator('[data-post-counts]').textContent()).replace(/\s+/g, ' ')
  check('as saved: posts as the quote saved them (6 corner, 4 end), no tee', /6 corner · 4 end/.test(posts0) && !/tee/.test(posts0) && info.tees === 0, posts0)
  await shot(page, 'dev-yard-locust-untangled-builder', '[data-layout-plan-col]')
  const fit0 = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  check('phone: nothing wider than the screen', fit0)
  const handles = await page.locator(`${svgSel} [data-plan-corner]`).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return Math.min(r.width, r.height) }))
  check('every corner and end point is a handle, at least 44 px', handles.length === 8 && handles.every(w => w >= 43.5), handles.map(Math.round).join(','))

  // 2. Type an angle: Side 5 back to 90° right (the old drawing): the crossing warning; then 90° left again.
  const typeAngle = async (name, deg, turn, shotName = null) => {
    await tapLoc(page.locator(`${svgSel} [data-plan-angle="${name}"]`))
    const open = await page.locator('[data-angle-sheet]').isVisible()
    await tapLoc(page.locator(`[data-angle-sheet] [data-angle-turn="${turn}"]`))
    await page.locator('[data-angle-input]').fill(String(deg))
    // Android: the keyboard closed first, as a salesman does, so it does not cover Done.
    if (CDP) { await page.locator('[data-angle-input]').evaluate(el => el.blur()); await sleep(700) }
    if (shotName) await shot(page, shotName)
    await tapLoc(page.locator('[data-angle-done]'))
    return open
  }
  check('tapping an angle opens the angle sheet', await typeAngle('Side 5', 90, 'right', 'dev-yard-angle-typing'))
  info = await planInfo(page)
  const crossNote = (await page.locator('[data-plan-crossing-note]').allTextContents()).join(' | ')
  check('typed 90° right at Side 5: "Side 3 crosses Side 6, check the drawing." on the drawing and in the side list',
    crossNote === 'Side 3 crosses Side 6, check the drawing.' && info.crossings === 1 && await page.locator('[data-side="Side 3"] [data-side-crosses="Side 6"]').count() === 1 && await page.locator('[data-side="Side 6"] [data-side-crosses="Side 3"]').count() === 1 && lengthsOk(info), crossNote)
  await shot(page, 'dev-yard-crossing-warning', '[data-layout-plan-col]')
  await typeAngle('Side 5', 90, 'left')
  info = await planInfo(page)
  const a5 = info.angles.find(a => a.name === 'Side 5')
  check('typed 90° left: Side 5 turns left; lengths kept; no crossings left', a5?.deg === 90 && a5.turn === 'left' && lengthsOk(info) && info.crossings === 0 && await page.locator('[data-plan-crossing-note]').count() === 0, `${a5?.deg} ${a5?.turn} ${lengthsText(info)}`)

  // 4. Drag corners: lengths kept, the angles show while dragging, the price does not move.
  const priceBefore = await facts(page)
  const midA = await drag(page, `${svgSel} [data-plan-corner="2"]`, -26, 14, touch)
  info = await planInfo(page)
  check('dragging the end of Side 2: every side keeps its typed length on the drawing', lengthsOk(info), lengthsText(info))
  check('while dragging: the angles show, live, with the magnifier', /°/.test(midA?.live ?? '') && /stays 28 ft/.test(midA?.live ?? '') && midA.angles >= 6 && (midA.loupe === 1 || !touch), JSON.stringify(midA))
  const midB = await drag(page, `${svgSel} [data-plan-corner="5"]`, 18, -22, touch)
  info = await planInfo(page)
  check('dragging the end of Side 5: lengths kept, no crossings', lengthsOk(info) && info.crossings === 0, lengthsText(info))
  void midB
  const priceAfter = await facts(page)
  check('the price is the same before and after dragging', priceAfter.prices === priceBefore.prices && priceAfter.bar === priceBefore.bar, `${priceBefore.bar} | ${priceAfter.bar}`)
  let dragged = angleKey(info)
  check('angles changed by the drags (not all square any more)', info.angles.some(a => Math.abs(a.deg - 90) > 1), dragged)

  // 5. Nothing else resets the drawing.
  const same = async what => { const i = await planInfo(page); check(`drags kept after ${what}`, angleKey(i) === dragged && lengthsOk(i), angleKey(i)); return i }
  // Meets the house at Side 7's end, then back.
  await openSide(page, 'Side 7')
  await page.locator('[data-side="Side 7"] [data-finish="end"]').selectOption('house'); await sleep(500)
  {
    const i = await planInfo(page)
    check('drags kept after choosing Meets the house', angleKey(i) === dragged && lengthsOk(i), angleKey(i))
    const end7 = i.sides.find(s => s.name === 'Side 7').b, start1 = i.sides.find(s => s.name === 'Side 1').a
    check('Meets the house: the house turns and sizes so both ends meet its wall', i.house && toHouse(i.house, end7) < 1 && toHouse(i.house, start1) < 1, `${i.house && toHouse(i.house, end7).toFixed(2)} / ${i.house && toHouse(i.house, start1).toFixed(2)} units`)
  }
  await page.locator('[data-side="Side 7"] [data-finish="end"]').selectOption('free'); await sleep(500)
  await same('Meets the house set back')
  // An end type.
  await openSide(page, 'Side 1')
  await page.locator('[data-side="Side 1"] [data-finish="start"]').selectOption('existing'); await sleep(400)
  await same('an end type change (Side 1 ties into existing fence)')
  await page.locator('[data-side="Side 1"] [data-finish="start"]').selectOption('house'); await sleep(400)
  // A gate.
  await openSide(page, 'Side 5')
  await tapLoc(page.locator('[data-side="Side 5"] [data-gate-choice] button:has-text("Walk gate")'))
  await same('a gate added')
  await tapLoc(page.locator('[data-side="Side 5"] [data-gate-choice] button:has-text("No gate")'))
  // A side off and on.
  await openSide(page, 'Side 4')
  await tapLoc(page.locator('[data-side="Side 4"] [data-side-toggle]'))
  {
    const i = await planInfo(page)
    check('a side off: the others keep their angles', i.angles.every(a => info.angles.find(b => b.name === a.name)?.deg === a.deg), angleKey(i))
  }
  await tapLoc(page.locator('[data-side="Side 4"] [data-side-toggle]'))
  await same('a side turned off and on again')
  // A length.
  await openSide(page, 'Side 2')
  await tapLoc(page.locator('[data-side="Side 2"] [data-side-length]'))
  await typePad(page, ['3', '0'])
  {
    const i = await planInfo(page)
    check('a length typed: the angles stay, the side is drawn at the new length', angleKey(i) === dragged && Math.abs(i.sides.find(s => s.name === 'Side 2').ft - 30) < 0.05, angleKey(i))
  }
  await tapLoc(page.locator('[data-side="Side 2"] [data-side-length]'))
  await typePad(page, ['2', '8'])
  await same('the length typed back')
  const priceRestored = await facts(page)
  check('after all that, back as it was: the same price', priceRestored.prices === priceBefore.prices && priceRestored.bar === priceBefore.bar, `${priceBefore.bar} | ${priceRestored.bar}`)

  // 6. The house: Side 1 meets it; move, turn and size it on the phone.
  info = await planInfo(page)
  // A spot on the house nothing else covers.
  const onHouse = await page.locator(`${svgSel} [data-plan-house]`).evaluate(el => {
    el.scrollIntoView({ block: 'center' })
    const r = el.getBoundingClientRect()
    for (let i = 1; i < 10; i++) for (let j = 1; j < 10; j++) { const x = r.left + r.width * i / 10, y = r.top + r.height * j / 10; if (document.elementFromPoint(x, y) === el) return { x, y } }
    return null
  })
  if (onHouse) { if (CDP || NAME !== 'webkit') await page.mouse.click(onHouse.x, onHouse.y); else await page.touchscreen.tap(onHouse.x, onHouse.y); await sleep(400) }
  const tools = await page.locator(`${svgSel} [data-plan-house-tools] > g`).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)) }))
  check('tapping the house shows its move, turn and size handles, each at least 44 px', tools.length === 3 && tools.every(w => w >= 43), tools.join(','))
  const h0 = info.house
  await drag(page, `${svgSel} [data-plan-house-rotate]`, -30, 30, touch)
  info = await planInfo(page)
  const turned = JSON.stringify(info.house) !== JSON.stringify(h0)
  const start1 = info.sides.find(s => s.name === 'Side 1').a
  check('the house turns, and still touches where Side 1 meets it', turned && toHouse(info.house, start1) < 1, `${toHouse(info.house, start1).toFixed(2)} units`)
  const w0 = info.house
  await drag(page, `${svgSel} [data-plan-house-size]`, -18, -18, touch)
  info = await planInfo(page)
  check('the house sizes', JSON.stringify(info.house) !== JSON.stringify(w0) && toHouse(info.house, info.sides.find(s => s.name === 'Side 1').a) < 1)
  check('drags kept after moving the house', angleKey(info) === dragged && lengthsOk(info))
  await shot(page, 'dev-yard-locust-phone', '[data-layout-plan-col]')
  check('phone: no page errors', errors.length === 0, errors.join(' | '))

  // 6b. The two END points (Jonathan): the start of Side 1 by the house and the free end of Side 7 each have a
  // 44 px handle, outside and inside Adjust the drawing; each swings its side about the other end at its typed
  // length. Side 1 set to "Ties into existing fence" first, then back to "Meets the house": the ends stay put.
  // Put the house's handles away first (a tap on the plan, away from the house), as the salesman would.
  {
    const b = await page.locator(svgSel).boundingBox()
    if (CDP || NAME !== 'webkit') await page.mouse.click(b.x + 6, b.y + 6); else await page.touchscreen.tap(b.x + 6, b.y + 6)
    await sleep(300)
    check('a tap on the plan puts the house\'s handles away', await page.locator(`${svgSel} [data-plan-house-tools]`).count() === 0)
  }
  const endHandles = async () => page.locator(`${svgSel} [data-plan-corner="0"], ${svgSel} [data-plan-corner="7"]`).evaluateAll(els => els.map(e => { const r = e.getBoundingClientRect(); return Math.round(Math.min(r.width, r.height)) }))
  const outside = await endHandles()
  await tapLoc(page.locator('[data-plan-adjust]'))
  const inside = await endHandles()
  check('both ends (Side 1 at the house, Side 7 stops) have a 44 px handle, outside and in Adjust the drawing', outside.length === 2 && inside.length === 2 && [...outside, ...inside].every(w => w >= 43), `${outside} / ${inside}`)
  await tapLoc(page.locator('[data-plan-adjust]'))
  await openSide(page, 'Side 1')
  await page.locator('[data-side="Side 1"] [data-finish="start"]').selectOption('existing'); await sleep(400)
  const endsPrice = await facts(page)
  /** Where the two ends are (feet from the corner next to each), from the drawing. */
  const endsAt = i => { const s1 = i.sides.find(x => x.name === 'Side 1'), s7 = i.sides.find(x => x.name === 'Side 7'); return { e1: { x: (s1.a.x - s1.b.x) * i.f, y: (s1.a.y - s1.b.y) * i.f }, e7: { x: (s7.b.x - s7.a.x) * i.f, y: (s7.b.y - s7.a.y) * i.f } } }
  const before0 = endsAt(await planInfo(page))
  await drag(page, `${svgSel} [data-plan-corner="0"]`, 0, -24, touch)
  await drag(page, `${svgSel} [data-plan-corner="7"]`, 22, 18, touch)
  info = await planInfo(page)
  const moved = endsAt(info)
  const turnedBy = (a, b) => Math.abs(Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x)) * 180 / Math.PI
  check('dragging each end swings its side about its other end, at its typed length (14 ft, 13 ft)',
    turnedBy(moved.e1, before0.e1) > 3 && turnedBy(moved.e7, before0.e7) > 3 && Math.abs(Math.hypot(moved.e1.x, moved.e1.y) - 14) < 0.05 && Math.abs(Math.hypot(moved.e7.x, moved.e7.y) - 13) < 0.05 && lengthsOk(info),
    `Side 1 ${turnedBy(moved.e1, before0.e1).toFixed(1)}°, Side 7 ${turnedBy(moved.e7, before0.e7).toFixed(1)}°`)
  check('dragging the ends: the price is unchanged', (await facts(page)).bar === endsPrice.bar && (await facts(page)).prices === endsPrice.prices)
  await page.locator('[data-side="Side 1"] [data-finish="start"]').selectOption('house'); await sleep(500)
  info = await planInfo(page)
  const kept = endsAt(info)
  const same2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < 0.05
  check('Side 1 set to Meets the house: both ends stay where they were dragged, and the house meets Side 1\'s end',
    same2(kept.e1, moved.e1) && same2(kept.e7, moved.e7) && info.house && toHouse(info.house, info.sides.find(x => x.name === 'Side 1').a) < 1, JSON.stringify(kept))
  check('Meets the house again: the price is as it was before the end type changed', (await facts(page)).bar === priceBefore.bar && (await facts(page)).prices === priceBefore.prices, `${priceBefore.bar} | ${(await facts(page)).bar}`)
  // The end at the house slides along the house wall: dragged again, it stays on the wall.
  await drag(page, `${svgSel} [data-plan-corner="0"]`, 12, 0, touch)
  info = await planInfo(page)
  check('the end at the house dragged: still on the house wall, Side 1 still 14 ft', toHouse(info.house, info.sides.find(x => x.name === 'Side 1').a) < 1 && lengthsOk(info))
  await page.locator(`${svgSel} [data-plan-corner="0"]`).evaluate(el => el.scrollIntoView({ block: 'center' }))
  await shot(page, 'dev-yard-locust-ends', '[data-layout-plan-col]')
  dragged = angleKey(info)

  // 7. Save, reopen: the same drawing.
  const builderAngles = angleKey(info)
  const builderPrice = await facts(page)
  await saveQuote(page)
  const saved = await api(`/api/saved-quotes/${made.quote}`)
  const drawn = saved.layout?.yard?.plan?.drawn
  check('saved: the angles and the house go with the quote (no tee)', !!drawn && Object.keys(drawn.deg).length === 7 && !!drawn.house && saved.layout.yard.sides.every(x => !x.tee), JSON.stringify(drawn?.house))
  check('saved: the posts as before (6 corner, 4 end)', saved.corners === 6 && saved.ends === 4, `${saved.corners} corner, ${saved.ends} end`)
  check('saved: footage as typed (the runs from the typed lengths)', JSON.stringify(saved.runs) === JSON.stringify([5, 5, 28, 70, 27, 46, 88, 13]), JSON.stringify(saved.runs))
  // Reopened in a new tab.
  await page.close()
  const page2 = await ctx.newPage()
  page2.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  await openQuote(page2, made.quote)
  info = await planInfo(page2)
  check('reopened: the same angles, lengths and price', angleKey(info) === builderAngles && lengthsOk(info) && (await facts(page2)).bar === builderPrice.bar, angleKey(info))

  // 8. A tee, on its own test yard (451 Locust Rd has none): Side 5 starts 40 ft along Side 3.
  const teeYard = () => ({ shape: 'custom', closed: false, plan: { points: null, pointsFor: null }, sides: [[40, 'house', 'corner', 0], [60, 'corner', 'corner', 90], [80, 'corner', 'corner', 180], [60, 'corner', 'free', 270], [25, 'free', 'free', 90]].map(([n, a, b, h], i) => ({
    id: `yt${i + 1}`, name: `Side ${i + 1}`, on: true, lengthIn: n * 12, startFinish: a, endFinish: b, gate: null, skip: null, heading: h })) })
  const qt = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({
    crmContactId: made.contact, customerName: CUSTOMER, customerPhone: '3525550178', customerAddress: ADDRESS,
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [40, 60, 80, 60, 25], corners: 3, ends: 4, sections: 0, status: 'DRAFT', finalPrice: 0, date: new Date().toISOString().slice(0, 10), layout: { yard: teeYard(), runSections: [] },
  }) })
  made.quoteTee = qt.id
  await openQuote(page2, made.quoteTee)
  await openSide(page2, 'Side 5')
  await page2.locator('[data-side="Side 5"] [data-side-tee]').selectOption('yt3'); await sleep(400)
  check('choosing "Along Side 3" asks how far along', await page2.locator('[data-ftin-pad]').isVisible())
  for (let k = 0; k < 4; k++) await page2.locator('[data-ftin-pad] [data-pad-key="back"]').click().catch(() => {})
  for (const k of ['4', '0']) await tapLoc(page2.locator(`[data-ftin-pad] [data-pad-key="${k}"]`))
  await tapLoc(page2.locator('[data-ftin-pad] [data-pad-done]'))
  const ti = await planInfo(page2)
  const t3 = ti.sides.find(x => x.name === 'Side 3'), t5 = ti.sides.find(x => x.name === 'Side 5')
  const along = t3 && t5 ? Math.hypot(t5.a.x - t3.a.x, t5.a.y - t3.a.y) * ti.f : 0
  const teeAngle = ti.angles.find(a => a.name === 'Side 5')
  check('the tee: Side 5 starts 40 ft along Side 3, square to it, a tee post (not a corner), drawn at 25 ft',
    Math.abs(along - 40) < 0.05 && teeAngle?.tee && Math.abs(teeAngle.deg - 90) < 0.01 && ti.tees === 1 && Math.abs(t5.ft - 25) < 0.05 && ti.crossings === 0,
    `${along.toFixed(2)} ft along, ${teeAngle?.deg}°, ${ti.tees} tee post`)
  const teePosts = (await page2.locator('[data-post-counts]').textContent()).replace(/\s+/g, ' ')
  // Vinyl tee: one more line post, not an end post (Jonathan, Oct 21, 2026: "Line post, route the third side on site").
  check('vinyl: the tee counted as a line post (3 corner, 3 end), and the side list says so', /3 corner · 3 end · 1 tee counted as a line post, route the third side on site/.test(teePosts) && (await page2.locator('[data-side="Side 5"] [data-side-tee-at]').textContent()).includes('along Side 3') && await page2.locator('[data-side-row="Side 5"] [data-side-tee-badge]').count() === 1, teePosts)
  await shot(page2, 'dev-yard-tee', '[data-layout-plan-col]')
  if (!CDP) await ctx.close(); else await page2.close()

  // ── Desktop ───────────────────────────────────────────────────────────────────
  const d = await desktopBrowser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
  await d.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  await stub(d)
  const dp = await d.newPage()
  const dErrors = []
  dp.on('pageerror', e => dErrors.push(String(e).slice(0, 300)))
  dp.on('dialog', x => x.accept())
  await openQuote(dp, made.quote)
  info = await planInfo(dp)
  check('desktop: the same drawing as on the phone', angleKey(info) === builderAngles && lengthsOk(info))
  const dPrice = await facts(dp)
  await drag(dp, `${svgSel} [data-plan-corner="4"]`, 25, 10, false)
  info = await planInfo(dp)
  check('desktop: a corner dragged with the mouse, lengths kept, no crossings, same price', lengthsOk(info) && info.crossings === 0 && (await facts(dp)).bar === dPrice.bar, lengthsText(info))
  await dp.locator('[data-plan-wrap]').scrollIntoViewIfNeeded()
  await shot(dp, 'dev-yard-locust-after', '[data-layout-editor]')
  const deskAngles = angleKey(info)
  // Lines of the fence on a drawing (directions, degrees), to compare the proposal and crew packet with.
  const fenceDirs = sel => p => p.locator(sel).first().evaluate(svg => [...svg.querySelectorAll('line[stroke="#5E28A1"]')]
    .map(l => Math.round(((Math.atan2(l.y2.baseVal.value - l.y1.baseVal.value, l.x2.baseVal.value - l.x1.baseVal.value) * 180 / Math.PI) + 360) % 180)).sort((a, b) => a - b).join(','))
  const builderDirs = await fenceDirs(svgSel)(dp)
  await saveQuote(dp)
  const saved2 = await api(`/api/saved-quotes/${made.quote}`)
  check('desktop: saved with the drag', saved2.layout?.yard?.plan?.drawn && saved2.finalPrice === saved.finalPrice, `$${saved.finalPrice} → $${saved2.finalPrice}`)
  await openQuote(dp, made.quote)
  check('desktop: reopened the same', angleKey(await planInfo(dp)) === deskAngles)
  await dp.locator('[data-quote-builder] [data-quote-close]').click().catch(() => {}); await sleep(500)

  // The proposal: the same drawing (the same fence directions, the tee, the angles that are not square).
  const tok = (await api(`/api/saved-quotes/${made.quote}/share-token`, { method: 'POST' })).shareToken
  const cp = await d.newPage()
  await cp.goto(`${API}/p/${tok}`); await sleep(1200)
  const propDirs = await fenceDirs('.plan svg')(cp)
  const propAngles = await cp.locator('.plan svg [data-plan-angle]').evaluateAll(els => els.map(e => `${e.getAttribute('data-plan-angle')}:${Number(e.getAttribute('data-angle-deg')).toFixed(2)}`).sort().join(' | '))
  const wantAngles = deskAngles.split(' | ').filter(t => { const v = Number(t.split(':')[1].slice(0, -1)); return Math.abs(v - 90) > 0.5 && v < 179.5 }).map(t => t.slice(0, -1)).sort().join(' | ')
  check('proposal: the same drawing as the builder (fence lines, angles, no tee)', propDirs === builderDirs && await cp.locator('.plan svg [data-plan-tee-post]').count() === 0 && propAngles === wantAngles, `${propDirs} vs ${builderDirs}; ${propAngles} vs ${wantAngles}`)
  await cp.locator('.plan').scrollIntoViewIfNeeded()
  await shot(cp, 'dev-yard-proposal', '.plan')
  await cp.close()

  // The crew packet: sold, a job, sent from Operations.
  await api(`/api/saved-quotes/${made.quote}`, { method: 'PATCH', body: JSON.stringify({ status: 'SOLD' }) })
  const job = await api('/api/saved-jobs', { method: 'POST', body: JSON.stringify({ quoteId: made.quote, status: 'scheduled', customerName: CUSTOMER, customerAddress: ADDRESS, fenceStyle: "WV-ND 6'x8' Privacy", sections: saved2.sections, totalFeet: 286, scheduledDate: '2026-10-27', crewAssigned: 'Crew A' }) })
  made.job = job.id
  await dp.goto(APP); await dp.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(1200)
  await dp.locator('span:text-is("Operations"):visible').first().click(); await sleep(1200)
  await dp.locator('input[aria-label="Search jobs"]').fill(CUSTOMER); await sleep(800)
  await dp.locator(`text=${CUSTOMER}`).first().click(); await sleep(1000)
  await dp.locator('[data-packet-send]').click(); await sleep(4000)
  const url = (await dp.locator('[data-packet-url]').textContent()).trim()
  const crew = await d.newPage()
  await crew.goto(url.replace(/^https?:\/\/[^/]+/, API)); await sleep(1200)
  const crewDirs = await fenceDirs('.plan svg')(crew)
  check('crew packet: the same drawing (fence lines, no tee)', crewDirs === builderDirs && await crew.locator('.plan svg [data-plan-tee-post]').count() === 0, `${crewDirs} vs ${builderDirs}`)
  await crew.locator('.plan').scrollIntoViewIfNeeded()
  await shot(crew, 'dev-yard-crew-packet', '.plan')
  await dp.locator('[data-packet-off]').click().catch(() => {}); await sleep(500)
  await crew.close()

  // Draw on photo: a new quote, three corners tapped on the photo; the sides fill in; an exact length typed keeps the angles.
  const q2 = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({
    crmContactId: made.contact, customerName: CUSTOMER, customerPhone: '3525550178', customerAddress: ADDRESS,
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [], corners: 0, ends: 0, sections: 0, status: 'DRAFT', finalPrice: 0, date: new Date().toISOString().slice(0, 10), layout: null,
  }) })
  made.quote2 = q2.id
  await dp.goto(`${APP}/quotes?quote=${made.quote2}`)
  await dp.locator('[data-quote-builder] [data-step="yard"]').click({ timeout: 30000 }); await sleep(800)
  await dp.locator('[data-draw-on-photo-open]').first().click()
  await dp.waitForSelector('[data-draw-on-photo] [data-w-map] .leaflet-container', { timeout: 30000 }); await sleep(1500)
  const mb = await dp.locator('[data-draw-on-photo] [data-w-map] .leaflet-container').boundingBox()
  const c = { x: mb.x + mb.width / 2, y: mb.y + mb.height / 2 }
  for (const [x, y] of [[-150, 60], [-150, -80], [120, -80]]) { await dp.mouse.click(c.x + x, c.y + y); await sleep(450) }
  await dp.locator('[data-draw-on-photo] [data-w-done]').click(); await sleep(500)
  await shot(dp, 'dev-yard-draw-on-photo', '[data-draw-on-photo]')
  await dp.locator('[data-draw-on-photo-use]').click(); await sleep(1500)
  const rows = await dp.locator('[data-side-list] [data-side-len]').allTextContents()
  check('Draw on photo: two sides filled in with their measured lengths', rows.length === 2 && rows.every(t => /^\d+' /.test(t)), rows.join(', '))
  await dp.waitForSelector(svgSel, { timeout: 30000 }); await sleep(800)
  const dInfo0 = await planInfo(dp)
  check('Draw on photo: the corner as drawn (square: the tool snaps straight and square)', dInfo0.angles.length === 1 && Math.abs(dInfo0.angles[0].deg - 90) < 1.5, angleKey(dInfo0))
  await dp.locator('[data-side-row="Side 1"]').click(); await sleep(300)
  await dp.locator('[data-side="Side 1"] [data-side-length]').click(); await sleep(300)
  for (const k of ['back', 'back', 'back', 'back']) await dp.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click().catch(() => {})
  for (const k of ['5', '0']) await dp.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await dp.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(600)
  const dInfo1 = await planInfo(dp)
  check('an exact length typed after: the typed length wins, the angle stays', Math.abs(dInfo1.sides.find(s => s.name === 'Side 1').ft - 50) < 0.05 && Math.abs(dInfo1.angles[0].deg - dInfo0.angles[0].deg) < 0.01, `${lengthsText(dInfo1)} ${angleKey(dInfo1)}`)
  check('desktop: no page errors', dErrors.length === 0, dErrors.join(' | '))
  await d.close()
} catch (e) {
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
} finally {
  if (made.job) await api(`/api/saved-jobs/${made.job}`, { method: 'DELETE' }).catch(() => {})
  if (made.quote) await api(`/api/saved-quotes/${made.quote}`, { method: 'DELETE' }).catch(() => {})
  if (made.quote2) await api(`/api/saved-quotes/${made.quote2}`, { method: 'DELETE' }).catch(() => {})
  if (made.quoteTee) await api(`/api/saved-quotes/${made.quoteTee}`, { method: 'DELETE' }).catch(() => {})
  if (made.contact) await api(`/api/crm-contacts/${made.contact}`, { method: 'DELETE' }).catch(() => {})
  if (desktopBrowser !== browser) await desktopBrowser.close()
  if (!CDP) await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed (${NAME})`)
process.exit(passed === results.length ? 0 : 1)
