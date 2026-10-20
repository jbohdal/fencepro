// Site plan on the aerial photo: turn the PHOTO (not the drawing) to match the
// house. Slider, the 1 degree buttons, a two-finger twist (a pinch does not
// turn it), Line up with two taps along a house wall, Reset; the center button
// still moves the plan. The plan is at the photo's real ground scale. Saved
// with the quote, it reopens at the same angle, and the proposal and the crew
// packet show the photo turned the same way with the north arrow. Footage,
// sections and price never change. Phone (360x780 touch, WebKit by default)
// then desktop.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> [BROWSER=webkit|chromium] node e2e/site-plan-rotate.mjs
//   On the Android emulator's Chrome: adb reverse tcp:4001 tcp:4001; adb forward tcp:9333
//   localabstract:chrome_devtools_remote; CDP_URL=http://localhost:9333 node e2e/site-plan-rotate.mjs
//
// The photo service (USGS NAIP) and the address lookup are stubbed with a
// made-up yard photo, so the test needs no network. Makes a customer, a quote
// and a sold job, then deletes them.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
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

const OCALA = { lat: 29.19, lng: -82.14 }
// The made-up yard (ground meters east and north of the address): a house 20 m by 13 m, 8 m south
// of the point, turned 20° clockwise. Every map tile asked for is drawn from it, so tiles join up.
const HOUSE = { e: 0, n: -8, w: 20, h: 13, deg: 20 }
const turn = (p, deg, cx, cy) => { const r = deg * Math.PI / 180; const x = p.x - cx, y = p.y - cy; return { x: cx + x * Math.cos(r) - y * Math.sin(r), y: cy + x * Math.sin(r) + y * Math.cos(r) } }
/** A house corner (sx, sy = ±1, y down as seen from above): ground meters east and north. */
const houseCorner = (sx, sy) => { const t = turn({ x: sx * HOUSE.w / 2, y: sy * HOUSE.h / 2 }, HOUSE.deg, 0, 0); return { e: HOUSE.e + t.x, n: HOUSE.n - t.y } }
const R = 6378137, COS = Math.cos(OCALA.lat * Math.PI / 180)
const MERC0 = { x: R * OCALA.lng * Math.PI / 180, y: R * Math.log(Math.tan(Math.PI / 4 + OCALA.lat * Math.PI / 360)) }

const side = (id, name, ft, s, e, h) => ({ id, name, on: true, lengthIn: ft * 12, startFinish: s, endFinish: e, gate: null, skip: null, heading: h })
const yard = () => ({ shape: 'backyard', closed: false, sides: [
  side('a', 'Left return', 30, 'house', 'corner', 180), side('b', 'Left side', 120, 'corner', 'corner', 90),
  side('c', 'Back', 143, 'corner', 'corner', 0), side('d', 'Right side', 120, 'corner', 'corner', 270),
  side('e', 'Right return', 30, 'corner', 'house', 180),
] })
const ADDRESS = '5708 SW 90th Ln, Ocala, FL 34476'
const made = { contact: null, quote: null, job: null }

const browser = CDP ? await chromium.connectOverCDP(CDP) : await ENGINE.launch()
const desktopBrowser = CDP ? await chromium.launch() : browser.browserType() === chromium ? browser : await chromium.launch()
let painter = null
const photoUrls = []
async function stub(ctx) {
  await ctx.route(/USGSNAIPPlus\/ImageServer\/exportImage/, async r => {
    const q = new URL(r.request().url()).searchParams
    const bbox = q.get('bbox').split(',').map(Number), size = Number(q.get('size').split(',')[0])
    const b64 = await painter.evaluate(({ bbox, size, HOUSE, MERC0, COS }) => {
      const [x0, y0, x1, y1] = bbox
      const cv = document.createElement('canvas'); cv.width = size; cv.height = size
      const g = cv.getContext('2d')
      // Ground meters (east, north of the address) to this tile's pixels.
      const px = (e, n) => [((MERC0.x + e / COS) - x0) / (x1 - x0) * size, (y1 - (MERC0.y + n / COS)) / (y1 - y0) * size]
      g.fillStyle = '#6b8f4e'; g.fillRect(0, 0, size, size)
      // Grass speckles on a 3 m ground grid, the same in every tile.
      const e0 = (x0 - MERC0.x) * COS, e1 = (x1 - MERC0.x) * COS, n0 = (y0 - MERC0.y) * COS, n1 = (y1 - MERC0.y) * COS
      for (let e = Math.floor(e0 / 3) * 3; e < e1; e += 3) for (let n = Math.floor(n0 / 3) * 3; n < n1; n += 3) {
        const h = Math.abs(Math.sin(e * 12.9898 + n * 78.233) * 43758.5453) % 1
        if (h < 0.5) continue
        g.fillStyle = h > 0.75 ? '#5e7f43' : '#7aa05a'
        const [a, b] = px(e, n); g.fillRect(a, b, 4, 4)
      }
      const r = HOUSE.deg * Math.PI / 180
      const corner = (sx, sy) => { const x = sx * HOUSE.w / 2, y = sy * HOUSE.h / 2; return px(HOUSE.e + x * Math.cos(r) - y * Math.sin(r), HOUSE.n - (x * Math.sin(r) + y * Math.cos(r))) }
      g.beginPath(); [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([a, b], i) => { const [x, y] = corner(a, b); i ? g.lineTo(x, y) : g.moveTo(x, y) }); g.closePath()
      g.fillStyle = '#9a9a9a'; g.fill(); g.strokeStyle = '#3a3a3a'; g.lineWidth = 3; g.stroke()
      return cv.toDataURL('image/jpeg', 0.85).split(',')[1]
    }, { bbox, size, HOUSE, MERC0, COS }).catch(e => { console.log('PAINT', String(e).slice(0, 300)); return '' })
    return r.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: Buffer.from(b64, 'base64') })
  })
  ctx.on('request', r => { if (/USGSNAIPPlus\/ImageServer\/exportImage/.test(r.url()) && !photoUrls.includes(r.url())) photoUrls.push(r.url()) })
  await ctx.route(/\/geo\/lookup/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { ...OCALA, source: 'e2e' } }) }))
}
async function signIn(ctx) {
  if (CDP) { const p0 = await ctx.newPage(); await p0.goto(APP); await p0.evaluate(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN); await p0.close() }
  else await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
}

try {
  // The made-up yard's tiles are drawn by a browser page.
  painter = await (await desktopBrowser.newContext()).newPage()

  const contact = await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ firstName: 'E2E', lastName: 'Photo Turn', phone: '3525550177', serviceAddress: ADDRESS, leadSource: 'Referral' }) })
  made.contact = contact.id
  const q0 = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({
    crmContactId: contact.id, customerName: 'E2E Photo Turn', customerPhone: '3525550177', customerAddress: ADDRESS,
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [30, 120, 143, 120, 30], corners: 4, ends: 2, sections: 0, status: 'DRAFT', finalPrice: 0,
    date: new Date().toISOString().slice(0, 10), layout: { yard: yard(), runSections: [] },
  }) })
  made.quote = q0.id

  // ── Phone, 360 px wide ────────────────────────────────────────────────────────
  const ctx = CDP ? browser.contexts()[0] : await browser.newContext({ serviceWorkers: 'block', viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, isMobile: NAME === 'chromium', hasTouch: true })
  await signIn(ctx); await stub(ctx)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  const tapLoc = async loc => { await loc.scrollIntoViewIfNeeded(); await (CDP || NAME !== 'webkit' ? loc.click() : loc.tap()); await sleep(300) }
  const svgSel = '[data-plan-wrap] svg[data-site-plan]'
  const openQuote = async p => {
    await p.goto(`${APP}/quotes?quote=${made.quote}`)
    await p.locator('[data-quote-builder] [data-step="yard"]').click({ timeout: 30000 })
    await p.waitForSelector('[data-plan-wrap] svg', { timeout: 30000 }); await sleep(1200)
  }
  const facts = async p => ({
    prices: (await p.locator('[data-quote-builder]').textContent()).match(/\$[\d,]+(\.\d\d)?/g)?.join() ?? '',
    bar: (await p.locator('[data-bar-facts]').textContent()).trim(),
  })
  const angle = p => p.locator(svgSel).getAttribute('data-photo-rotation').then(Number)
  /** A ground point (meters east, north of the address, the photo's center) on the screen, with the photo turned `deg`. */
  const groundToScreen = async (p, pt, deg) => {
    const r = await p.locator(svgSel).boundingBox()
    const f = Number(await p.locator(svgSel).getAttribute('data-ft-per-px'))
    const d = turn({ x: 400 + pt.e / 0.3048 / f, y: 400 - pt.n / 0.3048 / f }, deg, 400, 400)
    return { x: r.x + d.x * r.width / 800, y: r.y + d.y * r.height / 800 }
  }
  /** Fingers on the drawing as pointer events (touch): [{ id, x, y }] per step. */
  const fingers = (p, type, pts) => p.evaluate(({ type, pts }) => {
    window.__e2eTargets = window.__e2eTargets || {}
    for (const f of pts) {
      if (type === 'pointerdown') window.__e2eTargets[f.id] = document.elementFromPoint(f.x, f.y)
      const el = window.__e2eTargets[f.id]
      el.dispatchEvent(new PointerEvent(type, { pointerId: f.id, pointerType: 'touch', isPrimary: f.id === 11, clientX: f.x, clientY: f.y, bubbles: true, cancelable: true, composed: true }))
    }
  }, { type, pts })
  async function twist(p, center, fromDeg, toDeg, radius = 70, spread = 0) {
    const at = (deg, r) => [{ id: 11, x: center.x - r * Math.cos(deg * Math.PI / 180), y: center.y - r * Math.sin(deg * Math.PI / 180) }, { id: 12, x: center.x + r * Math.cos(deg * Math.PI / 180), y: center.y + r * Math.sin(deg * Math.PI / 180) }]
    await fingers(p, 'pointerdown', at(fromDeg, radius)); await sleep(60)
    for (let k = 1; k <= 12; k++) { await fingers(p, 'pointermove', at(fromDeg + (toDeg - fromDeg) * k / 12, radius + spread * k / 12)); await sleep(40) }
    await fingers(p, 'pointerup', at(toDeg, radius + spread)); await sleep(300)
  }
  const shot = async (p, name, sel = null) => {
    if (!SHOTS) return
    if (!sel) { await p.screenshot({ path: `${SHOTS}/${name}.png` }); return }
    // In the middle of the screen, clear of the window's sticky header.
    await p.locator(sel).first().evaluate(el => el.scrollIntoView({ block: 'center' })); await sleep(300)
    await p.locator(sel).first().screenshot({ path: `${SHOTS}/${name}.png` })
  }

  /** Update quote → the customer (picked if the window did not already) → Save. */
  async function saveQuote(p) {
    // Save is on the Price step.
    await tapLoc(p.locator('[data-quote-builder] [data-step="price"]'))
    await tapLoc(p.locator('[data-quote-bar] [data-save-open]'))
    const go = p.locator('button:has-text("Save quote"), button:has-text("Update quote")').last()
    if (await go.isDisabled()) {
      await p.locator('input[placeholder="Name, phone, or email..."]').fill('E2E Photo Turn'); await sleep(500)
      await tapLoc(p.locator('text=E2E Photo Turn').last())
    }
    await tapLoc(go)
    // The photo is turned and cut for the proposal before the save goes out.
    for (let k = 0; k < 40 && await p.locator('button:has-text("Save quote")').count(); k++) await sleep(500)
    await sleep(2500)
  }

  await openQuote(page)
  // Saved once as typed, before the photo: what the price must still be at the end.
  await saveQuote(page)
  const base = await api(`/api/saved-quotes/${made.quote}`)
  check('saved as typed first (the price to keep)', base.finalPrice > 0 && base.sections > 0, `$${base.finalPrice}, ${base.sections} sections, runs ${base.runs}`)

  await openQuote(page)
  const typedNow = await facts(page)
  check('no north arrow without the photo', await page.locator(`${svgSel} [data-plan-north]`).count() === 0)
  await tapLoc(page.locator('[data-aerial-open]'))
  await page.locator('[data-aerial-address]').fill(ADDRESS)
  await tapLoc(page.locator('[data-aerial-show]'))
  await page.waitForSelector(`${svgSel} [data-plan-photo]`, { timeout: 30000 }).catch(async e => {
    console.log('DEBUG', photoUrls.length, await page.locator('[data-aerial]').textContent(), await page.locator('[data-plan-wrap]').textContent())
    await page.screenshot({ path: '/private/tmp/claude-501/-Users-jonathanbohdal-Downloads-ALL-MY-SHIT-project-for-vs-code-ez-biz-final/068d543f-54ab-416d-a860-ad64e3c16179/scratchpad/dbg.png' }); throw e })
  await sleep(800)
  check('the photo is on, north up, with the north arrow', await angle(page) === 0 && await page.locator(`${svgSel} [data-plan-north="0"]`).count() === 1)

  // True scale: the 143 ft back is 143 ft of the photo's ground (from the photo's own bounds).
  const scale = await page.locator(svgSel).evaluate((svg, COS) => {
    // A tile's ground width (from its own Mercator box) over the drawing units between it and the next tile.
    const tiles = [...svg.querySelectorAll('[data-plan-photo] image')].filter(i => /exportImage/.test(i.getAttribute('href'))).map(i => ({ x: i.x.baseVal.value, y: i.y.baseVal.value, bbox: new URL(i.getAttribute('href')).searchParams.get('bbox').split(',').map(Number) }))
    const a = tiles[0], b = tiles.find(t => Math.abs(t.y - a.y) < 0.01 && t.x > a.x + 1)
    const ftPerPx = ((a.bbox[2] - a.bbox[0]) * COS / 0.3048) / (b.x - a.x)
    const back = [...svg.querySelectorAll('line[stroke="#5E28A1"]')].map(l => ({ dx: l.x2.baseVal.value - l.x1.baseVal.value, dy: l.y2.baseVal.value - l.y1.baseVal.value }))
      .filter(l => Math.abs(l.dy) < 0.5).map(l => Math.abs(l.dx)).sort((a, b) => b - a)[0]
    return { ftPerPx, backFt: back * ftPerPx }
  }, COS)
  check('true scale: the 143 ft back covers 143 ft of the photo', Math.abs(scale.backFt - 143) < 0.5, `${scale.backFt.toFixed(2)} ft at ${scale.ftPerPx.toFixed(4)} ft/px`)
  await page.locator('[data-plan-wrap]').scrollIntoViewIfNeeded()
  await shot(page, 'dev-plan-photo-before-rotate', '[data-layout-plan-col]')

  // Everything fits at 360 px: no sideways scroll, no control off screen or covered.
  const fit = await page.evaluate(() => {
    const bad = []
    if (document.documentElement.scrollWidth > window.innerWidth + 1) bad.push(`page ${document.documentElement.scrollWidth} wide`)
    for (const el of document.querySelectorAll('[data-photo-turn] button, [data-photo-turn] input, [data-aerial] button')) {
      el.scrollIntoView({ block: 'center' })
      const r = el.getBoundingClientRect()
      if (r.left < 0 || r.right > window.innerWidth + 0.5) bad.push(`${el.getAttribute('aria-label') || el.textContent.trim()} off screen`)
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      if (!hit || !(el === hit || el.contains(hit))) bad.push(`${el.getAttribute('aria-label') || el.textContent.trim()} covered`)
      if (r.height < 40) bad.push(`${el.getAttribute('aria-label') || el.textContent.trim()} only ${Math.round(r.height)} px tall`)
    }
    return bad
  })
  check('360 px: every photo control fits, none covered, none small', fit.length === 0, fit.join(' | '))

  // Slider, then the 1 degree buttons.
  await page.locator('[data-photo-rotate]').fill('15'); await sleep(300)
  check('slider: the photo turns 15°, the plan stays level', await angle(page) === 15 && (await page.locator('[data-photo-angle]').textContent()) === '15°'
    && (await page.locator(`${svgSel} [data-plan-photo]`).getAttribute('transform')).includes('rotate(15)') && await page.locator(`${svgSel} [data-plan-north="15"]`).count() === 1)
  await tapLoc(page.locator('[data-photo-rot-plus]')); await tapLoc(page.locator('[data-photo-rot-plus]')); await tapLoc(page.locator('[data-photo-rot-minus]'))
  check('the 1° buttons: 15 → 17 → 16', await angle(page) === 16, String(await angle(page)))
  await page.locator('[data-plan-wrap]').scrollIntoViewIfNeeded(); await sleep(200)

  // Two fingers: a twist turns the photo; a pinch does not.
  const svgBox = await page.locator(svgSel).boundingBox()
  const mid = { x: svgBox.x + svgBox.width * 0.3, y: svgBox.y + svgBox.height * 0.75 }
  await twist(page, mid, 0, 11)
  check('two-finger twist: 11° more, in whole degrees', await angle(page) === 27, String(await angle(page)))
  await twist(page, mid, 0, 0, 50, 60)
  check('a pinch (no twist) leaves the photo as it was', await angle(page) === 27, String(await angle(page)))
  // One finger on the center button still moves the plan, and does not turn the photo.
  const mv0 = await page.locator(`${svgSel} [data-plan-move]`).boundingBox()
  const c0 = { x: mv0.x + mv0.width / 2, y: mv0.y + mv0.height / 2 }
  await fingers(page, 'pointerdown', [{ id: 11, ...c0 }])
  for (let k = 1; k <= 8; k++) { await fingers(page, 'pointermove', [{ id: 11, x: c0.x + 4 * k, y: c0.y + 2 * k }]); await sleep(30) }
  await fingers(page, 'pointerup', [{ id: 11, x: c0.x + 32, y: c0.y + 16 }]); await sleep(300)
  const mv1 = await page.locator(`${svgSel} [data-plan-move]`).boundingBox()
  check('one finger on the center button moves the plan (32 px), the photo keeps its turn', Math.abs(mv1.x - mv0.x - 32) < 3 && Math.abs(mv1.y - mv0.y - 16) < 3 && await angle(page) === 27,
    `${Math.round(mv1.x - mv0.x)},${Math.round(mv1.y - mv0.y)} px`)
  await shot(page, 'dev-plan-photo-rotate-phone-360')

  // Reset, then Line up: two taps along the house's front wall on the photo.
  await tapLoc(page.locator('[data-photo-reset-turn]'))
  check('Reset: back to 0°', await angle(page) === 0)
  await tapLoc(page.locator('[data-photo-lineup]'))
  check('Line up asks for the first corner', (await page.locator('[data-photo-lineup-hint]').textContent()).includes('Tap one corner'))
  await page.locator('[data-plan-wrap]').scrollIntoViewIfNeeded(); await sleep(200)
  const t1 = await groundToScreen(page, houseCorner(-1, -1), 0), t2 = await groundToScreen(page, houseCorner(1, -1), 0)
  const tapAt = async pt => { if (CDP || NAME !== 'webkit') await page.mouse.click(pt.x, pt.y); else await page.touchscreen.tap(pt.x, pt.y); await sleep(350) }
  await tapAt(t1)
  check('first tap marked; it asks for the next corner', await page.locator(`${svgSel} [data-plan-lineup-taps="1"]`).count() === 1 && (await page.locator('[data-photo-lineup-hint]').textContent()).includes('next corner'))
  await tapAt(t2)
  const lined = await angle(page)
  check('Line up: the 20° wall is now level (photo turned −20°)', Math.abs(lined + 20) <= 1, String(lined))
  check('both taps stay marked on the wall', await page.locator(`${svgSel} [data-plan-lineup-taps="2"]`).count() === 1)
  await shot(page, 'dev-plan-photo-line-up', '[data-plan-wrap]')
  const after = await facts(page)
  check('turning and lining up never change price, footage or sections', after.prices === typedNow.prices && after.bar === typedNow.bar, `${typedNow.prices} ${typedNow.bar} | ${after.prices} ${after.bar}`)
  check('phone: no page errors', errors.length === 0, errors.join(' | '))

  // Save; the turn and position go to the server with the quote.
  await saveQuote(page)
  const saved = await api(`/api/saved-quotes/${made.quote}`)
  const a = saved.layout?.yard?.plan?.aerial ?? {}
  check('saved on the server: the turn, the position, photo on', a.rotDeg === lined && a.shown === true && a.planAt && Number.isFinite(a.planAt.x), JSON.stringify(a))
  check('saved: price, sections and footage the same as typed', saved.finalPrice === base.finalPrice && saved.sections === base.sections && JSON.stringify(saved.runs) === JSON.stringify(base.runs)
    && JSON.stringify(saved.layout.runSections) === JSON.stringify(base.layout.runSections), `$${base.finalPrice} → $${saved.finalPrice}, ${base.sections} → ${saved.sections}`)
  const propSvg = String(saved.proposal?.planSvg || '')
  check('the proposal drawing has the turned photo baked in', propSvg.includes(`data-photo-rotation="${lined}"`) && /href="data:image\/jpeg;base64,/.test(propSvg) && propSvg.length < 400_000, `${propSvg.length} chars`)

  // Reload: it opens at the same angle.
  await openQuote(page)
  await page.waitForSelector(`${svgSel} [data-plan-photo]`, { timeout: 30000 }); await sleep(500)
  check('reloaded: the photo is on at the saved angle', await angle(page) === lined, String(await angle(page)))
  check('phone: no page errors after reload', errors.length === 0, errors.join(' | '))
  if (!CDP) await ctx.close(); else await page.close()

  // ── Desktop: the saved angle, a mouse turn, the proposal and the crew packet ──
  // The app's service worker would fetch the photo itself, past the stub.
  const d = await desktopBrowser.newContext({ serviceWorkers: 'block', viewport: { width: 1440, height: 1000 } })
  await d.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  await stub(d)
  const dp = await d.newPage()
  const dErrors = []
  dp.on('pageerror', e => dErrors.push(String(e).slice(0, 300)))
  dp.on('dialog', x => x.accept())
  await openQuote(dp)
  await dp.waitForSelector(`${svgSel} [data-plan-photo]`, { timeout: 30000 }); await sleep(500)
  check('desktop: opens at the saved angle', await angle(dp) === lined)
  await dp.locator('[data-photo-rot-plus]').click(); await sleep(200)
  // The buttons step in whole degrees.
  check('desktop: the 1° button with a mouse', await angle(dp) === Math.round(lined + 1), String(await angle(dp)))
  await dp.locator('[data-plan-wrap]').scrollIntoViewIfNeeded()
  await shot(dp, 'dev-plan-photo-rotated', '[data-layout-plan-col]')
  await dp.locator('[data-photo-rot-minus]').click(); await sleep(200)
  await dp.locator('[data-quote-builder] [data-quote-close]').click(); await sleep(500)

  // The proposal: the same angle.
  const tok = (await api(`/api/saved-quotes/${made.quote}/share-token`, { method: 'POST' })).shareToken
  const cp = await d.newPage()
  await cp.goto(`${API}/p/${tok}`); await sleep(1000)
  const prop = cp.locator('.plan svg')
  check('proposal: the photo under the plan at the same angle, with the north arrow', await prop.getAttribute('data-photo-rotation') === String(lined)
    && await prop.locator(`[data-plan-north="${lined}"]`).count() === 1 && await prop.locator('image[data-plan-photo]').count() === 1, await prop.getAttribute('data-photo-rotation'))
  const loaded = await prop.locator('image[data-plan-photo]').evaluate(img => new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = img.getAttribute('href') }))
  check('proposal: the photo shows (the page allows it)', loaded > 0, `${loaded} px`)
  await cp.locator('.plan').scrollIntoViewIfNeeded()
  await shot(cp, 'dev-plan-photo-proposal', '.plan')
  await cp.close()

  // The crew packet: sold, a job, sent from Operations.
  await api(`/api/saved-quotes/${made.quote}`, { method: 'PATCH', body: JSON.stringify({ status: 'SOLD' }) })
  const NAME_ = 'E2E Photo Turn'
  const job = await api('/api/saved-jobs', { method: 'POST', body: JSON.stringify({ quoteId: made.quote, status: 'scheduled', customerName: NAME_, customerAddress: ADDRESS, fenceStyle: "WV-ND 6'x8' Privacy", sections: saved.sections, totalFeet: 443, scheduledDate: '2026-10-27', crewAssigned: 'Crew A' }) })
  made.job = job.id
  await dp.goto(APP); await dp.waitForSelector('[data-global-appointment]', { timeout: 30000 }); await sleep(1200)
  await dp.locator('span:text-is("Operations"):visible').first().click(); await sleep(1200)
  await dp.locator('input[aria-label="Search jobs"]').fill(NAME_); await sleep(800)
  await dp.locator(`text=${NAME_}`).first().click(); await sleep(1000)
  await dp.locator('[data-packet-send]').click(); await sleep(4000)
  const url = (await dp.locator('[data-packet-url]').textContent()).trim()
  const crew = await d.newPage()
  await crew.goto(url.replace(/^https?:\/\/[^/]+/, API)); await sleep(1200)
  const pk = crew.locator('.plan svg')
  check('crew packet: the photo turned the same way, with the north arrow', await pk.getAttribute('data-photo-rotation') === String(lined)
    && await pk.locator(`[data-plan-north="${lined}"]`).count() === 1 && await pk.locator('image[data-plan-photo]').count() === 1)
  const pkLoaded = await pk.locator('image[data-plan-photo]').evaluate(img => new Promise(res => { const i = new Image(); i.onload = () => res(i.naturalWidth); i.onerror = () => res(0); i.src = img.getAttribute('href') }))
  check('crew packet: the photo shows', pkLoaded > 0)
  await crew.locator('.plan').scrollIntoViewIfNeeded()
  await shot(crew, 'dev-plan-photo-crew-packet', '.plan')
  const pdf = await crew.pdf({ format: 'Letter' }).catch(() => null)
  check('the packet prints to PDF', !!pdf && pdf.length > 10_000)
  await dp.locator('[data-packet-off]').click().catch(() => {}); await sleep(500)

  // Site Plans (Operations > Site Plans) uses the same aerial source and closest zoom as the quote drawing.
  // Every photo request so far came from the quote drawing.
  const quoteUrls = [...photoUrls]
  const quotePhoto = new URL(quoteUrls[0])
  const zoomOf = u => { const q = new URL(u).searchParams; const b = q.get('bbox').split(',').map(Number); return Math.log2(156543.03392 / ((b[2] - b[0]) / Number(q.get('size').split(',')[0]))) }
  const quoteZoom = Math.max(...quoteUrls.map(zoomOf))
  const before = photoUrls.length
  const sp = await d.newPage()
  sp.on('pageerror', e => dErrors.push(String(e).slice(0, 300)))
  await sp.goto(`${APP}/site-plans`); await sleep(2500)
  await sp.locator('button:has-text("New")').first().click(); await sp.waitForSelector('[data-site-plan-map]'); await sleep(3000)
  const mapEl = sp.locator('[data-site-plan-map]')
  const spSource = await mapEl.getAttribute('data-aerial-source'), spZoom = Number(await mapEl.getAttribute('data-aerial-max-native-zoom'))
  const tileUrls = photoUrls.slice(before).filter(u => /size=256%2C256/.test(u))
  check('Site Plans asks the same photo service as the quote drawing', tileUrls.length > 0 && spSource === quotePhoto.origin + quotePhoto.pathname && tileUrls.every(u => u.startsWith(spSource)), `${tileUrls.length} tiles from ${spSource}`)
  check('the same closest zoom: Site Plans stops at 19, the quote photo is zoom-19 tiles', spZoom === 19 && Math.abs(quoteZoom - 19) < 1e-6 && quoteUrls.every(u => /size=256%2C256/.test(u)) && Math.abs(Math.max(...tileUrls.map(zoomOf)) - 19) < 1e-6,
    `map ${spZoom}, quote tiles ${quoteZoom.toFixed(3)}, ${quoteUrls.length} quote tiles`)
  for (let k = 0; k < 4; k++) { await sp.locator('.leaflet-control-zoom-in').click().catch(() => {}); await sleep(400) }
  check('at the closest zoom: "Sharpest photo available here", and no further zoom', await sp.locator('[data-aerial-limit]').isVisible() && (await sp.locator('[data-aerial-limit]').textContent()) === 'Sharpest photo available here'
    && await sp.locator('.leaflet-control-zoom-in.leaflet-disabled').count() === 1)
  await sp.close()

  const end = await api(`/api/saved-quotes/${made.quote}`)
  check('at the end: price, sections and footage still as typed', end.finalPrice === base.finalPrice && end.sections === base.sections && JSON.stringify(end.runs) === JSON.stringify(base.runs))
  check('desktop: no page errors', dErrors.length === 0, dErrors.join(' | '))
  await d.close()
} catch (e) {
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
} finally {
  if (made.job) await api(`/api/saved-jobs/${made.job}`, { method: 'DELETE' }).catch(() => {})
  if (made.quote) await api(`/api/saved-quotes/${made.quote}`, { method: 'DELETE' }).catch(() => {})
  if (made.contact) await api(`/api/crm-contacts/${made.contact}`, { method: 'DELETE' }).catch(() => {})
  if (desktopBrowser !== browser) await desktopBrowser.close()
  if (!CDP) await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed (${NAME})`)
process.exit(passed === results.length ? 0 : 1)
