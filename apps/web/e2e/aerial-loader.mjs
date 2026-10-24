// The yard photo in the website quote loads fast and says so (freeMap.tsx, aerialTiles.ts):
//  - "Loading your yard photo…" while the sharp tiles come, gone when they are in
//  - "Sharpest photo available here" only after zooming in to the limit, never on opening
//  - Esri first when the server has it; an Esri tile slower than 3 s switches to NAIP,
//    and after two such tiles the whole map uses NAIP; an Esri error switches at once
//  - the credit shown: Powered by Esri with Esri tiles, NAIP's with NAIP tiles
//  - on dev, with the photo already on the server, the sharp photo in under 3 s on 4G
//
//   E2E_ACCESS_TOKEN=<dev token> node e2e/aerial-loader.mjs
//
// Dev only (4001), test mode (?test=1: no draft, no lead). The Esri cases stub
// /p/tiles/config and the tiles in the browser (no Esri key on dev, and no
// request to Esri at all); the last case uses the dev server's real NAIP tiles.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
// The dev copy on 4001, or a worktree's own dev server on another local port (devOnly.mjs refuses 4000).
if (!/^http:\/\/localhost:\d+\/?$/.test(APP) || /:4000\b/.test(APP)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
const ADDRESS = '110 SE Watula'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const GREEN = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#6b8f4e"/></svg>'
const BLUE = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#4e6b8f"/></svg>'
const CREDIT = { esri: 'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community', naip: 'USDA, USGS The National Map: Orthoimagery (NAIP, public domain)' }
const FOUR_G = { offline: false, latency: 170, downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8 }

const browser = await chromium.launch()

/** A phone on the website quote; `esri`: what the made-up Esri does ('slow' never answers, 'error' fails, 'ok' answers), null: the real dev server. */
async function phone({ esri = null, naipDelay = 1200, net = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  const reqs = []
  if (esri) {
    await ctx.route('**/p/tiles/config', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ success: true, esri: true, switchMs: 3000, maxZoom: 19, credit: CREDIT }) }))
    await ctx.route(/\/p\/tiles\/esri\//, async r => {
      reqs.push({ kind: 'esri', at: Date.now(), url: r.request().url() })
      if (esri === 'slow') return // never answers (Esri down slowly)
      if (esri === 'error') return r.fulfill({ status: 502, body: 'down' })
      await sleep(120); return r.fulfill({ contentType: 'image/svg+xml', body: BLUE })
    })
    await ctx.route(/\/p\/tiles\/naip\//, async r => {
      reqs.push({ kind: 'naip', at: Date.now(), url: r.request().url() })
      await sleep(naipDelay); return r.fulfill({ contentType: 'image/svg+xml', body: GREEN })
    }).catch(() => {})
    await ctx.route(/USGSImageryOnly/, r => r.fulfill({ contentType: 'image/svg+xml', body: GREEN }))
  } else {
    ctx.on('request', r => { if (/\/p\/tiles\//.test(r.url())) reqs.push({ kind: /\/naip\//.test(r.url()) ? 'naip' : 'other', at: Date.now(), url: r.url() }) })
  }
  await ctx.route(/gis\.ocalafl\.org/, r => r.fulfill({ contentType: 'application/json', body: '{"features":[]}' }))
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  if (net) { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await cdp.send('Network.emulateNetworkConditions', net) }
  await page.goto(`${APP}/p/quote/?test=1`)
  await page.fill('[data-w-address]', ADDRESS)
  await page.locator('[data-w-suggestion]').first().waitFor({ timeout: 20000 })
  const t0 = Date.now()
  await page.locator('[data-w-suggestion]').first().click()
  await page.locator('[data-w-map] .leaflet-container').waitFor()
  return { ctx, page, reqs, errors, t0 }
}
const map = '[data-w-map] .leaflet-container'
const state = p => p.locator(map).getAttribute('data-aerial-state')
const visibleSharp = p => p.evaluate(sel => {
  const box = document.querySelector(sel).getBoundingClientRect()
  return [...document.querySelectorAll(`${sel} img.leaflet-tile`)].filter(i => /\/p\/tiles\//.test(i.src)).filter(i => { const r = i.getBoundingClientRect(); return r.right > box.left + 1 && r.left < box.right - 1 && r.bottom > box.top + 1 && r.top < box.bottom - 1 })
    .map(i => ({ src: i.dataset.aerialSource, loaded: i.classList.contains('leaflet-tile-loaded') }))
}, map)
async function waitSharp(p, ms) { const t = Date.now(); while (Date.now() - t < ms) { if (await state(p) === 'sharp') return Date.now() - t; await sleep(50) } return null }

try {
  // 1 Esri slow: the loading message, then NAIP after 3 seconds, the whole map on NAIP.
  {
    const { ctx, page, reqs, errors, t0 } = await phone({ esri: 'slow', naipDelay: 1200 })
    await sleep(700)
    const msg = page.locator('[data-aerial-loading]')
    check('Esri slow: "Loading your yard photo…" shows over the map while the photo comes', await msg.isVisible() && (await msg.textContent()).includes('Loading your yard photo…'))
    check('opening at the closest zoom does not say "Sharpest photo available here"', !(await page.locator('[data-aerial-limit]').isVisible()))
    const firstEsri = reqs.find(r => r.kind === 'esri')
    const tSharp = await waitSharp(page, 15000)
    const firstNaip = reqs.find(r => r.kind === 'naip')
    const switchAfter = firstNaip && firstEsri ? firstNaip.at - firstEsri.at : null
    check('Esri asked first', !!firstEsri && (!firstNaip || firstEsri.at <= firstNaip.at))
    check('a tile Esri has not sent in 3 s switches to NAIP (not before)', switchAfter !== null && switchAfter >= 2900 && switchAfter < 4500, `${switchAfter} ms`)
    const tiles = await visibleSharp(page)
    check('the photo then comes in from NAIP, every visible tile', tSharp !== null && tiles.length > 0 && tiles.every(t => t.src === 'naip' && t.loaded), `sharp after ${tSharp === null ? 'never' : Date.now() - t0} ms; ${tiles.length} tiles`)
    check('the loading message is gone once the photo is in', !(await page.locator('[data-aerial-loading]').isVisible()))
    check('the map says NAIP is its photo now', await page.locator(map).getAttribute('data-aerial-source') === 'naip')
    // Pan: new tiles go straight to NAIP (the whole layer switched after two slow tiles).
    const esriBefore = reqs.filter(r => r.kind === 'esri').length
    const box = await page.locator(map).boundingBox()
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 40, box.y + 40, { steps: 6 }); await page.mouse.up()
    await waitSharp(page, 8000)
    check('after that the whole map stays on NAIP (no more Esri requests)', reqs.filter(r => r.kind === 'esri').length === esriBefore, `${reqs.filter(r => r.kind === 'esri').length - esriBefore} more`)
    const attr = await page.locator('.leaflet-control-attribution').textContent()
    check('the credit names NAIP', attr.includes('USGS The National Map'), attr)
    // Zoom in at the limit: now it says so.
    await page.locator('.leaflet-control-zoom-in').click({ force: true }); await sleep(400)  // (greyed out at the limit, still tapped)
    check('zooming in at the limit says "Sharpest photo available here"', await page.locator('[data-aerial-limit]').isVisible() && (await page.locator('[data-aerial-limit]').textContent()) === 'Sharpest photo available here')
    check('no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 2 Esri failing: NAIP at once (not after 3 s).
  {
    const { ctx, page, reqs, errors } = await phone({ esri: 'error', naipDelay: 100 })
    const t = await waitSharp(page, 10000)
    const firstEsri = reqs.find(r => r.kind === 'esri'), firstNaip = reqs.find(r => r.kind === 'naip')
    check('Esri failing: NAIP straight away', !!firstNaip && !!firstEsri && firstNaip.at - firstEsri.at < 1500, `${firstNaip && firstEsri ? firstNaip.at - firstEsri.at : '?'} ms`)
    check('Esri failing: the photo is in, all NAIP', t !== null && (await visibleSharp(page)).every(x => x.src === 'naip' && x.loaded))
    check('no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 3 Esri answering: sharp at once, no NAIP, Powered by Esri shown.
  {
    const { ctx, page, reqs, errors, t0 } = await phone({ esri: 'ok' })
    const t = await waitSharp(page, 10000)
    const tiles = await visibleSharp(page)
    check('Esri: the sharp photo in well under 3 s, every tile from Esri', t !== null && Date.now() - t0 < 3000 && tiles.every(x => x.src === 'esri' && x.loaded), `${Date.now() - t0} ms, ${tiles.length} tiles`)
    check('Esri: nothing asked of NAIP', !reqs.some(r => r.kind === 'naip'))
    const attr = await page.locator('.leaflet-control-attribution').textContent()
    check('Esri: "Powered by Esri" and the World Imagery credit on the map', /Powered by Esri/.test(attr) && /Earthstar Geographics/.test(attr), attr)
    check('Esri: the words under the map name Esri', /Esri World Imagery/.test(await page.locator('[data-aerial-credit]').textContent()))
    check('no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }

  // 4 The real dev server (no Esri key: NAIP), the photo already kept there: sharp in under 3 s on 4G.
  {
    const s = await (await fetch(`${APP}/p/quote/api/suggest?q=${encodeURIComponent(ADDRESS)}`)).json()
    const at = s.data[0]
    await fetch(`${APP}/p/tiles/warm?lat=${at.lat}&lng=${at.lng}`)
    // Wait (up to 90 s) until the server has the address's photo (the first time, USGS takes about 20 s).
    const n = 2 ** 19, r = at.lat * Math.PI / 180
    const x = Math.floor((at.lng + 180) / 360 * n), y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n)
    let kept = false
    for (let i = 0; i < 90 && !kept; i++) { const res = await fetch(`${APP}/p/tiles/naip/19/${x}/${y}.jpg`); kept = res.ok; if (!kept) await sleep(1000) }
    const cfg = await (await fetch(`${APP}/p/tiles/config`)).json()
    check('dev: no Esri key, so NAIP', cfg.esri === false)
    const { ctx, page, reqs, errors, t0 } = await phone({ net: FOUR_G })
    const t = await waitSharp(page, 30000)
    const ms = t === null ? null : Date.now() - t0
    check('dev on 4G, the photo kept on the server: sharp in under 3 s', ms !== null && ms < 3000, `${ms} ms after the pick, ${reqs.filter(q => q.kind === 'naip').length} NAIP tiles`)
    check('dev: the tiles come from our server (/p/tiles/naip), cut from one picture', reqs.length > 0 && reqs.every(q => /\/p\/tiles\/(naip|config|warm)/.test(q.url)))
    check('no page errors', errors.length === 0, errors.join(' | '))
    await ctx.close()
  }
} catch (e) {
  check('ran to the end', false, String(e?.stack || e).slice(0, 600))
} finally {
  await browser.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
