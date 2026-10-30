// The website quote drawn on the aerial photo (/p/quote, the EZ Budget), end
// to end on the dev copy, the way a customer uses it:
//   address → the photo on the house (with the lot lines) → draw a backyard
//   (one hold with the magnifier) → a walk gate → type one side's length →
//   vinyl, white, 6 ft → name and phone → the Good / Better / Best prices →
//   the lead lands once (one customer, one card, one quote) → picking another
//   option and sending again changes that quote, never a second one → the
//   browser kept nothing (no draft id in the address; coming back starts
//   fresh) → the salesman opens it in the quote builder already drawn on the
//   photo, at the same price.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev staff token> \
//   [BROWSER=webkit|chromium] [IFRAME=1] [SHOTS=<folder>] node e2e/widget-draw.mjs
//   Android emulator: adb reverse tcp:4001 tcp:4001; adb forward tcp:9333 localabstract:chrome_devtools_remote;
//   CDP_URL=http://localhost:9333 node e2e/widget-draw.mjs
//
// The page is served the way the website gets it (https, through a stand in
// for the public door that passes every request to the dev server), alone or
// (IFRAME=1) inside a page on www.gdfencepro.com. The photo service and the
// county's parcel service are stubbed with a made-up yard, so no network is
// needed. The test records are removed after.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // writes a pipeline card: takes turns with the other tests that change shared data
import { webkit, chromium } from 'playwright'
import { PHOTO_TILES, tileBox } from './photoTiles.mjs'
import { execFileSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const CDP = process.env.CDP_URL || ''
const IFRAME = process.env.IFRAME === '1'
const ENGINE = CDP ? 'android' : process.env.BROWSER === 'chromium' ? 'chromium' : 'webkit'
const DESKTOP = ENGINE === 'chromium' && process.env.PHONE !== '1'
// The dev copy on 4001, or a worktree's own dev server on another local port (devOnly.mjs refuses 4000).
const devLocal = u => /^http:\/\/localhost:\d+\/?$/.test(u) && !/:4000\b/.test(u)
if (!devLocal(APP) || !devLocal(API)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const psql = sql => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-c', sql], { encoding: 'utf8' }).trim()
const api = async (p, init = {}) => (await (await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json())
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name) }) } }

// Android's Chrome reaches the dev server itself (adb reverse); on localhost Chrome keeps Secure cookies as on https.
const WIDGET = process.env.CDP_URL ? 'http://localhost:4001' : 'https://widget.test'
const HOST = 'https://www.gdfencepro.com/instant-quote'
const host = () => `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Instant quote</title></head>
<body style="margin:0;font-family:sans-serif"><header style="background:#1c1030;color:#fff;padding:10px">Getter Done Fence</header>
<iframe id="w" src="${WIDGET}/p/quote/" title="Get an instant fence estimate" style="width:100%;max-width:640px;height:880px;border:0;display:block;margin:0 auto;" allow="camera"></iframe></body></html>`

// The address (Ocala City Hall, a public building) and the made-up yard around it, in ground feet east / north of the point.
const ADDRESS_TYPED = '110 SE Watula'
const HOUSE = { w: 60, d: 40 }                          // centered on the point
const LOT = [[-70, -60], [70, -60], [70, 120], [-70, 120]]
const NAME = `E2E Drawn ${ENGINE}${IFRAME ? ' Frame' : ''}`
const PHONE = '352-555-01' + String(40 + ['webkit', 'chromium', 'android'].indexOf(ENGINE) * 3 + (IFRAME ? 1 : 0)).padStart(2, '0')

const R = 6378137
const merc = (lat, lng) => ({ x: R * lng * Math.PI / 180, y: R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) })
let CENTER = null // the address point (from the suggestion)
/** Ground feet east / north of the address to latitude / longitude (local, exact enough for a test yard). */
const ll = (e, n) => {
  const lat0 = CENTER.lat * Math.PI / 180
  const mLat = 111132.954 - 559.822 * Math.cos(2 * lat0) + 1.175 * Math.cos(4 * lat0)
  const mLng = 111412.84 * Math.cos(lat0) - 93.5 * Math.cos(3 * lat0)
  return { lat: CENTER.lat + n * 0.3048 / mLat, lng: CENTER.lng + e * 0.3048 / mLng }
}

const browser = CDP ? await chromium.connectOverCDP(CDP) : await (ENGINE === 'chromium' ? chromium : webkit).launch()
const desk = CDP || ENGINE !== 'chromium' ? await chromium.launch() : browser
let painter = null
const made = { contact: null, quote: null, card: null, draft: null, snapshot: null }

/** The made-up yard photo for any tile asked for: grass, the house, a driveway. */
async function stub(ctx) {
  await ctx.route(PHOTO_TILES, async r => {
    const { bbox, size } = tileBox(r.request().url())
    const c = merc(CENTER.lat, CENTER.lng), cos = Math.cos(CENTER.lat * Math.PI / 180)
    const b64 = await painter.evaluate(({ bbox, size, c, cos, HOUSE }) => {
      const [x0, y0, x1, y1] = bbox
      const cv = document.createElement('canvas'); cv.width = size; cv.height = size
      const g = cv.getContext('2d')
      const px = (eFt, nFt) => [((c.x + eFt * 0.3048 / cos) - x0) / (x1 - x0) * size, (y1 - (c.y + nFt * 0.3048 / cos)) / (y1 - y0) * size]
      g.fillStyle = '#6b8f4e'; g.fillRect(0, 0, size, size)
      const e0 = (x0 - c.x) * cos / 0.3048, e1 = (x1 - c.x) * cos / 0.3048, n0 = (y0 - c.y) * cos / 0.3048, n1 = (y1 - c.y) * cos / 0.3048
      for (let e = Math.floor(e0 / 8) * 8; e < e1; e += 8) for (let n = Math.floor(n0 / 8) * 8; n < n1; n += 8) {
        const h = Math.abs(Math.sin(e * 12.9898 + n * 78.233) * 43758.5453) % 1
        if (h < 0.5) continue
        g.fillStyle = h > 0.75 ? '#5e7f43' : '#7aa05a'; const [a, b] = px(e, n); g.fillRect(a, b, 5, 5)
      }
      const poly = (pts, fill) => { g.beginPath(); pts.forEach(([e, n], i) => { const [x, y] = px(e, n); i ? g.lineTo(x, y) : g.moveTo(x, y) }); g.closePath(); g.fillStyle = fill; g.fill() }
      poly([[-12, -20], [12, -20], [12, -70], [-12, -70]], '#c9c4b8')                       // driveway to the street
      poly([[-HOUSE.w / 2, -HOUSE.d / 2], [HOUSE.w / 2, -HOUSE.d / 2], [HOUSE.w / 2, HOUSE.d / 2], [-HOUSE.w / 2, HOUSE.d / 2]], '#8a8a8a') // the roof
      return cv.toDataURL('image/jpeg', 0.85).split(',')[1]
    }, { bbox, size, c, cos, HOUSE }).catch(() => '')
    return r.fulfill({ status: 200, contentType: 'image/jpeg', headers: { 'Access-Control-Allow-Origin': '*' }, body: Buffer.from(b64, 'base64') })
  })
  // The county's lot lines.
  await ctx.route(/gis\.ocalafl\.org\/arcgis\/rest\/services\/Public\/Parcels\/FeatureServer\/0\/query/, r => {
    const ring = LOT.map(([e, n]) => { const p = ll(e, n); return [p.lng, p.lat] }); ring.push(ring[0])
    return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ features: [{ attributes: { parcel: 'E2E' }, geometry: { rings: [ring] } }] }) })
  })
  // The https stand in for the public door.
  // (The photo tiles stay with the made-up yard above.)
  if (!WIDGET.startsWith(APP)) await ctx.route(`${WIDGET}/**`, async r => PHOTO_TILES.test(r.request().url()) ? r.fallback() : r.fulfill({ response: await r.fetch({ url: r.request().url().replace(WIDGET, APP) }) }))
  await ctx.route(HOST, r => r.fulfill({ contentType: 'text/html', body: host() }))
}

async function open(ctx, query = '') {
  const page = await ctx.newPage()
  if (IFRAME) {
    await page.route(HOST, r => r.fulfill({ contentType: 'text/html', body: host().replace(`${WIDGET}/p/quote/`, `${WIDGET}/p/quote/${query}`) }))
    await page.goto(HOST); await sleep(1500)
  } else { await page.goto(`${WIDGET}/p/quote/${query}`); await sleep(1200) }
  const frame = IFRAME ? page.frames().find(f => f.url().startsWith(WIDGET)) : page.mainFrame()
  return { page, w: IFRAME ? page.frameLocator('#w') : page, frame }
}

try {
  painter = await (await desk.newContext()).newPage()
  CENTER = (await (await fetch(`${API}/p/quote/api/suggest?q=${encodeURIComponent(ADDRESS_TYPED)}`)).json()).data[0]
  check('the county knows the address (its own property list)', CENTER?.source === 'county', CENTER?.formatted)

  const ctx = CDP ? browser.contexts()[0] : await browser.newContext(DESKTOP ? { viewport: { width: 1280, height: 900 } } : { viewport: { width: Number(process.env.WIDTH) || 390, height: 844 }, deviceScaleFactor: 3, isMobile: ENGINE === 'chromium', hasTouch: true })
  // The emulator's Chrome keeps its cookies between runs: start with none (no draft from an earlier run).
  if (CDP) await ctx.clearCookies()
  await stub(ctx)
  const { page, w, frame } = await open(ctx)
  // What the page sends with the quote (its visit id is the lead's key; kept in the page's memory only).
  const submits = []
  page.on('request', r => { if (r.url().includes('/p/quote/api/submit')) submits.push(r.postData() || '') })
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  // Android: a real touch through Chrome's own input (the connected browser has no Playwright touchscreen).
  const cdp = CDP ? await ctx.newCDPSession(page) : null
  const touch = async (x, y) => {
    if (cdp) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] }); await sleep(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }) }
    else await page.touchscreen.tap(x, y)
  }
  // Chrome in a frame: Chrome's test touch input is not moved into a frame from another site (it lands off by the
  // frame's distance from the top of the page; mouse input lands right), so taps there go in as mouse clicks.
  const MOUSE = DESKTOP || (IFRAME && ENGINE !== 'webkit')
  const tap = async (x, y) => { if (MOUSE) await page.mouse.click(x, y); else await touch(x, y); await sleep(350) }
  // Android: close the on screen keyboard first, as a customer does, so it does not cover the button.
  const click = async loc => { if (CDP) { await loc.evaluate(() => (document.activeElement)?.blur?.()); await sleep(700) } await loc.scrollIntoViewIfNeeded(); await loc.click(); await sleep(350) }
  /** Where a ground spot is on the screen now (the map's center and zoom are on the page). */
  const screenOf = async (e, n) => {
    const map = w.locator('[data-w-map]')
    await map.locator('.leaflet-container').scrollIntoViewIfNeeded()
    const [lat, lng, z] = (await map.getAttribute('data-w-view')).split(',').map(Number)
    const box = await map.locator('.leaflet-container').boundingBox()
    const scale = 256 * 2 ** z / (2 * Math.PI * R)
    const p = ll(e, n), m = merc(p.lat, p.lng), c = merc(lat, lng)
    return { x: box.x + box.width / 2 + (m.x - c.x) * scale, y: box.y + box.height / 2 - (m.y - c.y) * scale }
  }
  const tapAt = async (e, n) => { const s = await screenOf(e, n); await tap(s.x, s.y) }

  // ── 1 Address ──────────────────────────────────────────────────────────────
  check('opens on the address, no sign in', await w.locator('[data-w-address]').isVisible())
  await w.locator('[data-w-address]').fill(ADDRESS_TYPED); await sleep(1500)
  check('the county suggests the address as it is typed', (await w.locator('[data-w-suggestion]').count()) >= 1)
  await shot(page, `dev-widget-1-address${IFRAME ? '-iframe' : ''}.png`)
  await click(w.locator('[data-w-suggestion]').first())

  // ── 2 The photo, right away ────────────────────────────────────────────────
  await w.locator('[data-w-step="draw"] .leaflet-tile-loaded').first().waitFor({ timeout: 20000 })
  await sleep(1500)
  const view = (await w.locator('[data-w-map]').getAttribute('data-w-view')).split(',').map(Number)
  check('the photo opens on the house at the sharpest zoom (19), centered on it', view[2] === 19 && Math.abs(view[0] - CENTER.lat) < 1e-5 && Math.abs(view[1] - CENTER.lng) < 1e-5, view.join())
  const tileSrc = await w.locator('[data-w-map] .leaflet-tile').first().getAttribute('src')
  check('the photo comes from our own server, the same photo as the quote drawing', (await w.locator('[data-w-map] img[src*="/p/tiles/"]').count()) > 0, tileSrc)
  check('the county\'s lot lines show, faintly', (await w.locator('[data-w-map] path.leaflet-interactive, [data-w-map] svg.leaflet-zoom-animated path').count()) >= 1)
  check('it says what to do: tap where the fence starts', /Tap where your fence starts/.test(await w.locator('[data-w-draw-help]').textContent()))
  await shot(page, `dev-widget-2-photo${IFRAME ? '-iframe' : ''}.png`)

  // ── Draw a backyard: from the house wall, around the back, to the house wall ──
  if (CDP) { await frame.evaluate(() => (document.activeElement)?.blur?.()); await sleep(1500) }  // Android: the keyboard from the address closes first
  const PTS = [[-30, 15], [-55, 15], [-55, 95], [55, 95], [55, 15], [30, 15]]
  for (const [i, [e, n]] of PTS.entries()) {
    if (i === 3) {
      // One point placed with the magnifier: press, hold, let go.
      const s = await screenOf(e, n)
      if (cdp && !MOUSE) await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: s.x, y: s.y }] })
      else { await page.mouse.move(s.x, s.y); await page.mouse.down() }
      await sleep(700)
      const loupe = await w.locator('[data-w-loupe]').isVisible().catch(() => false)
      check('press and hold: the magnifier shows the photo under the finger', loupe)
      await shot(page, `dev-widget-4-magnifier${IFRAME ? '-iframe' : ''}.png`)
      if (cdp && !MOUSE) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up()
      await sleep(600)
      continue
    }
    const s0 = await screenOf(e, n)
    await tap(s0.x, s0.y)
    // Each point is drawn right under the finger.
    const hb = await w.locator('[data-w-point]').last().locator('circle').nth(1).boundingBox()
    if (Math.hypot(hb.x + hb.width / 2 - s0.x, hb.y + hb.height / 2 - s0.y) > 3) check(`point ${i + 1} is drawn under the finger`, false, `tapped ${Math.round(s0.x)},${Math.round(s0.y)}; drawn ${Math.round(hb.x + hb.width / 2)},${Math.round(hb.y + hb.height / 2)}`)
  }
  const labels = async () => w.locator('[data-w-side-label]').evaluateAll(els => els.map(e => Number(e.getAttribute('data-ft'))))
  const live = await labels()
  check('each side shows its length on the line as it is drawn (nearest foot)', JSON.stringify(live.map(x => Math.round(x / 5) * 5)) === JSON.stringify([25, 80, 110, 80, 25]), live.join(', '))
  check('the total shows', Number(await w.locator('[data-w-total]').getAttribute('data-w-total')) === live.reduce((a, b) => a + b, 0))
  if (DESKTOP) {
    // Double tap the last point: the run is done.
    const s = await screenOf(30, 15)
    await page.mouse.dblclick(s.x, s.y); await sleep(500)
    check('a double tap on the last point finishes the run', (await w.locator('[data-w-done]').count()) === 0 && (await w.locator('[data-w-point]').count()) === 6)
  } else await click(w.locator('[data-w-done]'))
  check('Done: six points, five sides', (await w.locator('[data-w-point]').count()) === 6 && (await labels()).length === 5)
  const ends = await w.locator('[data-w-point][data-end]').evaluateAll(els => els.map(e => e.getAttribute('data-end')))
  check('both ends next to the house are marked "at the house"', ends.join() === 'house,house', ends.join())
  check('straight and square is on by default', await w.locator('[data-w-snap]').isChecked())
  await shot(page, `dev-widget-3-drawing${IFRAME ? '-iframe' : ''}.png`)

  // Drag a point a little, then Undo puts it back.
  const before = await w.locator('[data-w-point]').nth(2).getAttribute('data-lat')
  const p2 = await screenOf(-55, 95)
  if (cdp && !MOUSE) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: p2.x, y: p2.y }] })
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p2.x + 25 * k / 8, y: p2.y + 10 * k / 8 }] }); await sleep(50) }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  } else { await page.mouse.move(p2.x, p2.y); await page.mouse.down(); await page.mouse.move(p2.x + 12, p2.y + 6, { steps: 4 }); await page.mouse.move(p2.x + 25, p2.y + 10, { steps: 4 }); await page.mouse.up() }
  await sleep(400)
  const moved = await w.locator('[data-w-point]').nth(2).getAttribute('data-lat')
  await click(w.locator('[data-w-undo]'))
  check('a point drags, and Undo puts it back', moved !== before && (await w.locator('[data-w-point]').nth(2).getAttribute('data-lat')) === before)

  // ── A walk gate on the left side, then slid along it ───────────────────────
  await click(w.locator('[data-w-add-gate]'))
  const g = await screenOf(-55, 55)
  await (MOUSE ? page.mouse.click(g.x, g.y) : touch(g.x, g.y)); await sleep(500)
  check('Add a gate, tap the side: the sizes come up (walk 4, 5, 6; double as the builder)', (await w.locator('[data-w-gate-size]').count()) === 6)
  await click(w.locator('[data-w-gate-size="walk-4"]'))
  const startFt = async () => Number(await w.locator('[data-w-gate-mark]').getAttribute('data-start-ft'))
  const pieces = (await w.locator('[data-w-side]').nth(1).getAttribute('data-pieces')).split(',').filter(Boolean).map(Number)
  check('the gate shows on the drawing where tapped and splits the side', (await w.locator('[data-w-gate-mark="walk"]').count()) === 1 && pieces.length === 2 && Math.abs(await startFt() - 38) <= 1, `starts ${await startFt()} ft, pieces ${pieces}`)
  await shot(page, `dev-widget-5-gate${IFRAME ? '-iframe' : ''}.png`)
  // Slide it toward the corner with a finger (mouse in a desktop browser): the live distances, then whole feet.
  const from = await screenOf(-55, 55), to = await screenOf(-55, 37)
  if (cdp && !MOUSE) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] })
    for (let k = 1; k <= 8; k++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x, y: from.y + (to.y - from.y) * k / 8 }] }); await sleep(60) }
  } else { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 }) }
  await sleep(300)
  const liveText = await w.locator('[data-w-gate-live]').textContent().catch(() => '')
  check('while sliding: "12 ft ← [4 ft gate] → 31 ft" style distances show live, with the magnifier', /^\d+ ft ← \[4 ft gate\] → \d+ ft$/.test(liveText) && await w.locator('[data-w-loupe]').isVisible(), liveText)
  await shot(page, `dev-widget-5b-gate-slide${IFRAME ? '-iframe' : ''}.png`)
  if (cdp && !MOUSE) await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); else await page.mouse.up()
  await sleep(400)
  const slid = await startFt()
  check('the gate slid along its side, in whole feet, and the two pieces follow', Number.isInteger(slid) && Math.abs(slid - 20) <= 2 && (await w.locator('[data-w-side]').nth(1).getAttribute('data-pieces')) === `${slid},${80 - slid - 4}`, `starts ${slid} ft`)
  // Tap the gate: type where it starts; a new size keeps its middle.
  await click(w.locator('[data-w-gate-label]').first())
  await w.locator('[data-w-gate-dist-input]').fill('12')
  await click(w.locator('[data-w-gate-from-start]'))
  check('typing "starts 12 ft from the corner" puts it there', await startFt() === 12)
  await click(w.locator('[data-w-gate-label]').first())
  check('the sheet shows both distances', (await w.locator('[data-w-gate-distances]').textContent()) === '12 ft ← [4 ft gate] → 64 ft')
  await click(w.locator('[data-w-gate-size="walk-6"]'))
  check('a 6 ft gate instead keeps the gate\'s middle where it was (14 ft)', await startFt() === 11 && (await w.locator('[data-w-side]').nth(1).getAttribute('data-pieces')) === '11,63')

  // ── "I measured 112 ft" on the back ────────────────────────────────────────
  await click(w.locator('[data-w-side-label]').nth(2))       // the back
  await w.locator('[data-w-len-input]').fill('112')
  await shot(page, `dev-widget-6-edit-length${IFRAME ? '-iframe' : ''}.png`)
  // Android: the on screen keyboard is up; its Enter key saves (as a customer would).
  if (CDP) { await w.locator('[data-w-len-input]').press('Enter'); await sleep(400) } else await click(w.locator('[data-w-len-save]'))
  const typed = await w.locator('[data-w-side-label]').nth(2).getAttribute('data-ft')
  check('a typed length replaces the measured one and is marked typed', typed === '112' && /typed/.test(await w.locator('[data-w-side-label]').nth(2).textContent()))

  // ── 3 The fence ────────────────────────────────────────────────────────────
  await click(w.locator('[data-w-step="draw"] [data-w-next]'))
  for (const m of ['vinyl', 'chain', 'alum']) check(`material offered: ${m}`, (await w.locator(`[data-w-material="${m}"]`).count()) === 1)
  await click(w.locator('[data-w-material="vinyl"]'))
  await click(w.locator('[data-w-color="white"]'))
  await click(w.locator('[data-w-height="6|privacy"]'))
  check('each material has a picture', (await w.locator('[data-w-material] [data-w-style-picture], [data-w-material] img').count()) >= 3)
  await shot(page, `dev-widget-7-style${IFRAME ? '-iframe' : ''}.png`)
  await click(w.locator('[data-w-step="fence"] [data-w-next]'))

  // ── 4 Contact first (the default), then the prices ─────────────────────────
  check('contact before price (Settings default): no price shows yet', (await w.locator('[data-w-option]').count()) === 0 && (await w.locator('[data-w-name]').isVisible()))
  await w.locator('[data-w-name]').fill(NAME)
  await w.locator('[data-w-phone]').fill(PHONE)
  await w.locator('[data-w-email]').fill(`e2e.drawn.${ENGINE}@example.com`)
  await shot(page, `dev-widget-8-contact${IFRAME ? '-iframe' : ''}.png`)
  await click(w.locator('[data-w-send]'))
  await w.locator('[data-w-option]').first().waitFor({ timeout: 30000 }); await sleep(600)
  const opts = await w.locator('[data-w-option]').evaluateAll(els => els.map(e => ({ style: e.getAttribute('data-w-option'), price: Number(e.getAttribute('data-w-price')), text: e.textContent })))
  check('Good, Better, Best, each with a price and a price per foot', opts.length === 3 && /^Good/.test(opts[0].text) && /^Better/.test(opts[1].text) && /^Best/.test(opts[2].text) && opts.every(o => o.price > 0 && /\/ft/.test(o.text)), opts.map(o => `${o.style} ${o.price}`).join(' | '))
  check('Better is marked Most popular, and picked', /Most popular/.test(opts[1].text) && (await w.locator('[data-w-option].border-orange-500').getAttribute('data-w-option')) === opts[1].style)
  check('the wording: an instant estimate, measurements confirmed on site', /Instant estimate based on your drawing\. We confirm every measurement on site before you sign\./.test(await w.locator('[data-w-wording]').textContent()))
  const pageText = await w.locator('[data-w-app]').textContent()
  check('no cost anywhere on the page', !/cost|margin|profit|commission/i.test(pageText))
  await shot(page, `dev-widget-9-price${IFRAME ? '-iframe' : ''}.png`)

  // ── In EZ Biz: once ────────────────────────────────────────────────────────
  const frameUrl = (IFRAME ? page.frames().find(f => f.url().startsWith(WIDGET)) : page.mainFrame()).url()
  made.draft = JSON.parse(submits[0] || '{}').draftId || ''
  check('the visit id is in the page\'s memory only: not in the page address', /^[A-Za-z0-9_-]{20,40}$/.test(made.draft) && !new URL(frameUrl).searchParams.get('draft'), made.draft)
  made.contact = psql(`select id from "CrmContact" where "firstName"='E2E' and "lastName"='${NAME.slice(4)}' and "archivedAt" is null order by "createdAt" desc limit 1`)
  const count = () => ({
    contacts: psql(`select count(*) from "CrmContact" where "firstName"='E2E' and "lastName"='${NAME.slice(4)}'`),
    quotes: psql(`select count(*) from "SavedQuote" where "crmContactId"='${made.contact}'`),
    cards: psql(`select count(*) from "PipelineState", jsonb_array_elements(leads::jsonb) l where l->>'customerId'='${made.contact}'`),
    intake: psql(`select count(*) from "IntakeLead" where "sourceRef"='${made.draft}'`),
  })
  const c1 = count()
  check('one customer, one pipeline card, one saved quote, one website lead', JSON.stringify(c1) === JSON.stringify({ contacts: '1', quotes: '1', cards: '1', intake: '1' }), JSON.stringify(c1))
  const q = JSON.parse(psql(`select json_build_object('id', id, 'style', "fenceStyle", 'price', "finalPrice", 'src', "leadSource", 'wd', layout::jsonb->'widgetDrawing', 'aerial', layout::jsonb->'yard'->'plan'->'aerial', 'shape', layout::jsonb->'yard'->>'shape', 'notes', notes) from "SavedQuote" where "crmContactId"='${made.contact}'`))
  made.quote = q.id
  made.snapshot = q.wd?.snapshotUrl ?? null
  const card = JSON.parse(psql(`select l::text from "PipelineState", jsonb_array_elements(leads::jsonb) l where l->>'customerId'='${made.contact}'`))
  made.card = card.id
  check('the quote is the option shown, at the price shown, a Website Quote lead', q.style === opts[1].style && Math.round(q.price * 100) === Math.round(opts[1].price * 100) && q.src === 'Website Quote', `${q.style} ${q.price}`)
  check('the card says where it came from: "Website, drawn by customer"', /Website, drawn by customer/.test(card.notes) && card.leadSource === 'Website Quote', card.notes)
  const sides = (q.wd?.sides ?? []).flat()
  check('the customer\'s drawing is kept on the quote: points, sides (measured / typed), the gate, the pick, the prices shown', q.wd && q.wd.runs?.[0]?.pts?.length === 6 && sides.length === 5 && sides[2].how === 'typed' && sides[2].ft === 112 && sides[0].how === 'measured' && q.wd.runs[0].gates[1]?.type === 'walk' && q.wd.runs[0].gates[1]?.startFt === 11 && q.wd.shown?.length === 3, JSON.stringify(sides.map(s => `${s.ft}${s.how[0]}`)))
  const yardGate = JSON.parse(psql(`select layout::jsonb->'yard'->'sides'->1->'gate' from "SavedQuote" where id='${q.id}'`))
  check('the slid gate is saved where the builder reads it: 11 ft from the start of the side, 6 ft wide', yardGate?.position === 'distance' && yardGate.distanceIn === 132 && yardGate.widthIn === 72, JSON.stringify(yardGate))
  check('the builder\'s yard is drawn on its aerial photo (north up, shown)', q.shape === 'custom' && q.aerial?.shown === true && q.aerial?.rotDeg === 0)
  check('the aerial snapshot of the drawing is saved', !!made.snapshot && (await fetch(APP + made.snapshot)).ok, made.snapshot)
  check('follow ups start as for any new lead (the card entered its first stage)', Number(psql(`select count(*) from "AutomationEvent" where "entityId"='${made.card}' and type='card_entered'`)) === 1)

  // Another option picked: the same quote changes; still one of everything.
  await click(w.locator(`[data-w-option="${opts[0].style}"]`)); await sleep(2500)
  const q2 = psql(`select "fenceStyle"||'|'||"finalPrice" from "SavedQuote" where id='${made.quote}'`)
  check('picking Good after sending updates the same quote (no second one)', q2 === `${opts[0].style}|${opts[0].price}` && JSON.stringify(count()) === JSON.stringify(c1), q2)
  // The phone did not hear the answer and sends again: still one.
  const again = await (IFRAME ? page.frames().find(f => f.url().startsWith(WIDGET)) : page.mainFrame()).evaluate(async body => {
    const r = await fetch('/p/quote/api/submit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    return { status: r.status, body: await r.json() }
  }, submits[submits.length - 1])
  check('the same draft sent again: answered, marked a repeat, nothing new', again.status === 200 && again.body.duplicate === true && JSON.stringify(count()) === JSON.stringify(c1), `${again.status} ${JSON.stringify(count())}`)
  check('no page errors', errors.length === 0, errors.join(' | '))

  // ── Coming back on the same phone: nothing was kept in the browser (Oct 29 2026), it starts at the address ──
  const kept = await ctx.cookies()
  check('the browser kept no cookie for the quote', !kept.some(c => /ezq_/.test(c.name)), kept.map(c => c.name).join(', '))
  const back = await open(ctx)
  check('coming back starts a new quote at the address (the sent one is with the company)', await back.w.locator('[data-w-address]').isVisible().catch(() => false) && !(await back.w.locator('[data-w-sent]').isVisible().catch(() => false)))
  await back.page.close()

  // ── The salesman opens it in the quote builder, already drawn ──────────────
  const staff = await desk.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  await staff.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  await stub(staff)
  const sp = await staff.newPage()
  await sp.goto(`${APP}/quotes?quote=${made.quote}`); await sp.waitForSelector('[data-quote-price]', { timeout: 30000 }); await sleep(1500)
  const builder = Number((await sp.locator('[data-quote-price]').first().textContent()).replace(/[$,]/g, ''))
  check('the quote builder prices it the same, to the cent', Math.round(builder * 100) === Math.round(opts[0].price * 100), `builder $${builder}, widget $${opts[0].price}`)
  await sp.locator('[data-quote-builder] [data-step="yard"]').click(); await sleep(2500)
  check('the builder opens on the yard already drawn, on the aerial photo', (await sp.locator('[data-plan-wrap] svg[data-photo-rotation]').count()) === 1 && (await sp.locator('[data-side-row]').count()) === 5)
  const builderPieces = await sp.locator('[data-plan-wrap] svg').textContent()
  check('the builder draws the gate in the same place: 11\' / 6\' walk gate / 63\'', /11'/.test(builderPieces) && /6' walk gate/.test(builderPieces) && /63'/.test(builderPieces))
  check('and shows the customer\'s drawing as they drew it (measured / typed)', (await sp.locator('[data-customer-drawing]').count()) === 1 && (await sp.locator('[data-side-how="typed"]').count()) === 1)
  await sp.locator('[data-plan-wrap]').scrollIntoViewIfNeeded()
  await shot(sp, `dev-widget-10-in-app${IFRAME ? '-iframe' : ''}.png`)
  // The builder saves: the customer's drawing stays as drawn.
  const before2 = psql(`select layout::jsonb->'widgetDrawing'->>'drawnAt' from "SavedQuote" where id='${made.quote}'`)
  const saved = await api(`/api/saved-quotes/${made.quote}`)
  const body = { ...saved.data, layout: { yard: saved.data.layout.yard, runSections: saved.data.layout.runSections } }
  await api(`/api/saved-quotes/${made.quote}`, { method: 'PATCH', body: JSON.stringify(body) })
  check('a builder save keeps the customer\'s drawing unchanged', psql(`select layout::jsonb->'widgetDrawing'->>'drawnAt' from "SavedQuote" where id='${made.quote}'`) === before2 && !!before2)
  await staff.close()
  if (!CDP) await ctx.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  // Remove the test records.
  try {
    if (made.quote) await api(`/api/saved-quotes/${made.quote}`, { method: 'DELETE' })
    if (made.card) { const pipe = await api('/api/pipeline'); await api('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: [made.card], baseVersion: pipe.data.version }) }) }
    if (made.contact) psql(`delete from "AutomationEffect" where key in (select 'widget-partial-push:' || id from "IntakeLead" where "crmContactId"='${made.contact}')`)
    if (made.contact) psql(`delete from "IntakeLead" where "crmContactId"='${made.contact}'; delete from "CrmContactNote" where "crmContactId"='${made.contact}'; delete from "AutomationEvent" where "entityId"='${made.card}'; delete from "CardFollowUp" where "cardId"='${made.card}'; delete from "CustomerPossibleMatch" where "contactId"='${made.contact}'; delete from "CrmContact" where id='${made.contact}'`)
    if (made.draft) psql(`delete from "WidgetDraft" where id='${made.draft}'`)
    if (made.snapshot) { const f = path.resolve(process.cwd(), '../portal/uploads', made.snapshot.replace('/api/portal/files/', '')); if (fs.existsSync(f)) fs.unlinkSync(f) }
    check('test records removed', !made.contact || psql(`select count(*) from "CrmContact" where id='${made.contact}'`) === '0')
  } catch (e) { check('test records removed', false, String(e?.message || e).slice(0, 200)) }
  if (!CDP) await browser.close(); else await browser.close().catch(() => {})
  if (desk !== browser) await desk.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
