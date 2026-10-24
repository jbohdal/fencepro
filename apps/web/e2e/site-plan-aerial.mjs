// The aerial photo on Site Plans (Operations > Site Plans > + Create New Site Plan), on a phone:
// the same loader as the website quote (freeMap.tsx, aerialTiles.ts).
//  - before an address the map shows Ocala from above on the soft photo, and asks for no sharp tiles
//  - every sharp tile comes from our own /p/tiles (Esri first when the server has it), each asked once
//  - "Loading your yard photo…" while the tiles come; a sharp photo in under 3 s with Esri
//  - picking a second address stops the first one's tiles still on their way
//  - panning away and back asks for no tile already in
//  - the real dev server (no Esri key: NAIP), the photo already kept there: sharp in under 3 s on 4G
//
//   APP_URL=http://localhost:4011 API_URL=http://localhost:4011 E2E_ACCESS_TOKEN=<dev token> node e2e/site-plan-aerial.mjs
//
// Dev only. Saves nothing (the plan is never saved). The Esri cases stub
// /p/tiles/config and the tiles in the browser (dev has no Esri key, and
// nothing here asks Esri); the last case uses the dev server's real NAIP tiles.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium, signInByCookie, APP, sleep, reporter } from './lib.mjs'

const { check, finish } = reporter()
const A = '1301 SE Silver Springs Pl'
const B = '12222 SW 16th Ave'
const BLUE = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#4e6b8f"/></svg>'
const GREEN = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#6b8f4e"/></svg>'
const CREDIT = { esri: 'Powered by <a href="https://www.esri.com">Esri</a> | Source: Esri', naip: 'USDA, USGS The National Map: Orthoimagery (NAIP, public domain)' }
const FOUR_G = { offline: false, latency: 150, downloadThroughput: 9e6 / 8, uploadThroughput: 3e6 / 8 }
const MAP = '[data-site-plan-map]'
const SHARP = /\/p\/tiles\/(esri|naip|aerial)\/(\d+)\/(\d+)\/(\d+)\.jpg/

const browser = await chromium.launch()

/** A phone signed in, on Site Plans with a new plan open. `esriDelay`: a made-up Esri answering after that long (null: the real dev server). */
async function open({ esriDelay = null, net = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  await signInByCookie(ctx)
  const reqs = []
  if (esriDelay != null) {
    await ctx.route('**/p/tiles/config', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, esri: true, switchMs: 3000, maxZoom: 19, credit: CREDIT }) }))
    await ctx.route(/\/p\/tiles\/esri\//, async r => { await sleep(esriDelay); await r.fulfill({ contentType: 'image/svg+xml', body: BLUE }).catch(() => {}) })
    await ctx.route(/\/p\/tiles\/naip\//, r => r.fulfill({ contentType: 'image/svg+xml', body: GREEN }))
    await ctx.route(/USGSImageryOnly/, r => r.fulfill({ contentType: 'image/svg+xml', body: GREEN }))
  }
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.dismiss().catch(() => {}))
  page.on('request', r => { if (SHARP.test(r.url()) || /nationalmap\.gov|arcgis/.test(r.url())) reqs.push({ url: r.url(), at: Date.now(), failed: false, done: false }) })
  page.on('requestfailed', r => { const q = reqs.findLast(x => x.url === r.url()); if (q) q.failed = true })
  page.on('requestfinished', r => { const q = reqs.findLast(x => x.url === r.url()); if (q) q.done = true })
  if (net) {
    const cdp = await ctx.newCDPSession(page)
    await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', net); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  }
  await page.goto(`${APP}/site-plans`)
  await page.locator('button:has-text("New Site Plan"), button:has-text("Create your first")').first().click({ timeout: 60000 })
  await page.waitForSelector(`${MAP} .leaflet-tile-container`, { state: 'attached', timeout: 30000 })
  return { ctx, page, reqs, errors }
}
async function pick(page, address) {
  await page.locator('input[data-site-plan-address]').fill(address)
  await page.locator('[data-address-suggestion]').first().waitFor({ timeout: 30000 })
  const t0 = Date.now()
  await page.locator('[data-address-suggestion]').first().click()
  return t0
}
/** The z19 photo tiles in the map's box, with whether each is in. */
const visible = page => page.evaluate(sel => {
  const el = document.querySelector(sel), box = el.getBoundingClientRect()
  return [...el.querySelectorAll('img.leaflet-tile')].filter(i => /\/p\/tiles\/[a-z]+\/19\//.test(i.src))
    .filter(i => { const r = i.getBoundingClientRect(); return r.right > box.left + 1 && r.left < box.right - 1 && r.bottom > box.top + 1 && r.top < box.bottom - 1 })
    .map(i => ({ src: i.src, source: i.dataset.aerialSource, in: i.complete && i.naturalWidth > 0 }))
}, MAP)
/** Until the map says sharp and every z19 tile in view is in (ms after t0, or null). */
async function waitSharp(page, t0, ms) {
  while (Date.now() - t0 < ms) {
    const st = await page.locator(MAP).getAttribute('data-aerial-state')
    const v = await visible(page)
    if (st === 'sharp' && v.length >= 4 && v.every(t => t.in)) return Date.now() - t0
    await sleep(50)
  }
  return null
}
async function drag(page, dx, dy) {
  const b = await page.locator(MAP).boundingBox()
  const x = b.x + b.width / 2, y = b.y + b.height / 2
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 8 }); await page.mouse.up()
}

try {
  // 1 Esri (made up, 900 ms a tile): the overview asks no sharp tiles; the loading message; sharp under 3 s; each tile once; a pan asks nothing again.
  {
    const { ctx, page, reqs, errors } = await open({ esriDelay: 900 })
    await sleep(1500)
    check('before an address: no sharp photo tiles asked for (Ocala from above, soft photo only)', reqs.filter(r => SHARP.test(r.url)).length === 0, `${reqs.filter(r => SHARP.test(r.url)).length} asked`)
    const t0 = await pick(page, A)
    await sleep(500)
    const msg = page.locator('[data-aerial-loading]')
    check('"Loading your yard photo…" over the map while the photo comes', await msg.isVisible() && (await msg.textContent()).includes('Loading your yard photo…'))
    const t = await waitSharp(page, t0, 10000)
    check('a sharp photo in under 3 s (Esri, 900 ms a tile)', t !== null && t < 3000, `${t} ms`)
    check('the loading message is gone once the photo is in', !(await msg.isVisible()))
    const sharp = reqs.filter(r => SHARP.test(r.url))
    check('every sharp tile from our own /p/tiles, Esri first', sharp.length > 0 && sharp.every(r => r.url.startsWith(`${APP}/p/tiles/esri/`)), [...new Set(sharp.map(r => r.url.replace(/\/\d+\/\d+\/\d+\.jpg.*/, '')))].join(', '))
    check('nothing sharp straight from USGS (only the soft zoom 16 and under tiles)', reqs.filter(r => /nationalmap\.gov/.test(r.url)).every(r => /\/tile\/(1[0-6]|\d)\//.test(r.url)))
    const urls = sharp.map(r => r.url)
    check('each tile asked once (no second set of the same tiles)', new Set(urls).size === urls.length, `${urls.length} asked, ${new Set(urls).size} different`)
    const v = await visible(page)
    check('only about the tiles the phone shows are asked for', sharp.length <= v.length + 6, `${sharp.length} asked, ${v.length} in view`)
    const before = new Set(urls), n0 = reqs.length
    await drag(page, 120, 70); await sleep(1500); await drag(page, -120, -70); await sleep(1500)
    const again = reqs.slice(n0).filter(r => before.has(r.url))
    check('panning away and back asks for no tile already in', again.length === 0, `${again.length} asked again`)
    check('no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 2 A second address while the first one's tiles are still coming (Esri 2.5 s a tile): those are stopped.
  {
    const { ctx, page, reqs, errors } = await open({ esriDelay: 2500 })
    await pick(page, A)
    await sleep(600)
    const firstSet = reqs.filter(r => SHARP.test(r.url)).map(r => r.url)
    const t0 = await pick(page, B)
    const t = await waitSharp(page, t0, 15000)
    await sleep(500)
    const left = reqs.filter(r => firstSet.includes(r.url) && !r.failed && r.done)
    check('the first address\'s tiles still coming are stopped (not left downloading)', firstSet.length > 0 && left.length === 0, `${firstSet.length} asked, ${left.length} still finished`)
    check('the second address\'s photo comes in', t !== null, `${t} ms`)
    const src = await page.locator(MAP).getAttribute('data-aerial-source')
    check('a stopped tile does not count as Esri being slow (the map stays on Esri)', src === 'esri', src)
    check('no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 3 The real dev server (NAIP, no Esri key), the photo already kept there: sharp in under 3 s on 4G with a 4x slower phone.
  {
    const cfg = await (await fetch(`${APP}/p/tiles/config`)).json()
    check('dev: no Esri key, so NAIP', cfg.esri === false)
    // Keep the address's photo on the server first (the first look at an address asks USGS: seconds).
    const warm = await open({})
    await pick(warm.page, A)
    await waitSharp(warm.page, Date.now(), 60000)
    await warm.ctx.close()
    const { ctx, page, reqs, errors } = await open({ net: FOUR_G })
    const t0 = await pick(page, A)
    const t = await waitSharp(page, t0, 30000)
    check('dev on 4G, the photo kept on the server: sharp in under 3 s', t !== null && t < 3000, `${t} ms, ${reqs.filter(r => SHARP.test(r.url)).length} tiles`)
    check('dev: the sharp tiles come from /p/tiles/naip', reqs.filter(r => SHARP.test(r.url)).every(r => r.url.startsWith(`${APP}/p/tiles/naip/`)))
    check('dev: the map says NAIP', (await page.locator(MAP).getAttribute('data-aerial-source')) === 'naip')
    check('no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} catch (e) {
  check('ran to the end', false, String(e?.stack || e).slice(0, 600))
} finally {
  await browser.close()
}
process.exit(finish())
