// Smart Schedule, Site Plans and the Map Quote on free maps (no Google Maps).
//
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> node e2e/free-maps.mjs
//
// Dev only (4001), writes nothing (every save is stopped). Each opens on free
// tiles with no request to Google and no page error; the map quote measures a
// run of known length from two taps.
import { chromium } from 'playwright'
const APP = 'http://localhost:4001', TOKEN = process.env.E2E_ACCESS_TOKEN || '', SHOTS = process.env.SHOTS || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const b = await chromium.launch()
const google = [], errs = []
async function page(phone = false) {
  const c = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 900 } })
  await c.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  await c.route('**/api/**', r => ['GET', 'HEAD'].includes(r.request().method()) ? r.continue() : r.abort())
  const p = await c.newPage()
  p.on('request', r => { if (/maps\.googleapis|maps\.gstatic/.test(r.url())) google.push(r.url().slice(0, 80)) })
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  return { c, p }
}
const tiles = (p, sel) => p.locator(`${sel} .leaflet-tile-loaded`).count()
try {
  // Smart Schedule
  let { c, p } = await page()
  await p.goto(`${APP}/dispatch`); await p.waitForSelector('[data-global-appointment]', { timeout: 60000 }); await sleep(1500)
  await p.locator('button:has-text("Smart Schedule")').click(); await p.waitForSelector('[data-smart-schedule-map]'); await sleep(8000)
  check('Smart Schedule: free street map with job dots', (await tiles(p, '[data-smart-schedule-map]')) > 0 && (await p.locator('[data-smart-schedule-map] .leaflet-marker-icon').count()) > 0, `${await tiles(p, '[data-smart-schedule-map]')} tiles, ${await p.locator('[data-smart-schedule-map] .leaflet-marker-icon').count()} dots`)
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-smart-schedule-free-map.png` })
  await c.close()

  // Site Plans, on a phone
  ;({ c, p } = await page(true))
  await p.goto(`${APP}/site-plans`); await sleep(3000)
  await p.locator('button:has-text("New")').first().click(); await p.waitForSelector('[data-site-plan-map]'); await sleep(1000)
  await p.locator('[data-site-plan-address] input, input[data-site-plan-address]').first().fill('17008 SE 60'); await sleep(1500)
  if (await p.locator('[data-address-suggestion]').count()) await p.locator('[data-address-suggestion]').first().click()
  await sleep(6000)
  check('Site Plans (phone): USGS aerial tiles after picking an address', (await tiles(p, '[data-site-plan-map]')) > 0 && (await p.locator('[data-map-base="aerial"]').count()) > 0, `${await tiles(p, '[data-site-plan-map]')} tiles`)
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-site-plan-free-aerial.png` })
  await c.close()

  // Map Quote: two taps 200 px apart across the map
  ;({ c, p } = await page())
  await p.goto(`${APP}/quotes`); await sleep(3000)
  await p.locator('button:has-text("Map Quote")').click(); await p.waitForSelector('[data-map-quote-map]'); await sleep(800)
  await p.locator('[data-map-quote-address] input, input[data-map-quote-address]').first().fill('17008 SE 60'); await sleep(1500)
  if (await p.locator('[data-address-suggestion]').count()) await p.locator('[data-address-suggestion]').first().click()
  await sleep(6000)
  const box = await p.locator('[data-map-quote-map]').boundingBox()
  const zoom = await p.evaluate(() => { const el = document.querySelector('[data-map-quote-map] .leaflet-container') || document.querySelector('[data-map-quote-map]'); return null })
  const y = box.y + box.height / 2, x0 = box.x + box.width / 2 - 100
  await p.mouse.click(x0, y); await sleep(400); await p.mouse.click(x0 + 200, y); await sleep(800)
  const text = (await p.locator('[data-map-quote]').textContent()).replace(/\s+/g, ' ')
  const ft = Number((text.match(/(\d+(?:\.\d+)?)\s*(?:ft|')/) || [])[1])
  // 200 px at zoom 19 at this latitude: 156543.03 x cos(29.1256) / 2^19 m per px.
  const expected = 200 * 156543.03 * Math.cos(29.1256 * Math.PI / 180) / 2 ** 19 * 3.28084
  check('Map Quote: a run is measured on the free imagery (200 px at zoom 19)', ft > 0 && Math.abs(ft - expected) / expected < 0.06, `${ft} ft, expected about ${expected.toFixed(1)} ft`)
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-map-quote-free-aerial.png` })
  await c.close()
  check('no request to Google Maps on any of them', google.length === 0, google.slice(0, 3).join(' '))
  check('no page errors', errs.length === 0, errs.join(' | '))
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').filter(l => /intercept|not stable|not visible|outside|detached/.test(l)).slice(0, 3).join(' ; ') || String(e).slice(-700))
}
await b.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
