// Smart Schedule, Site Plans and the Map Quote on free maps (no Google Maps).
// Smart Schedule also: its jobs come from Jobs with their Operations stage, a
// job on hold shows its side lane in gray, and Schedule books the job through
// Schedule install (the request is caught and stopped, so dev data is not changed).
//
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> node e2e/free-maps.mjs
//
// Dev only (4001), writes nothing (every save is stopped). Each opens on free
// tiles with no request to Google and no page error; the map quote measures a
// run of known length from two taps.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
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
  // Writes nothing, except the sign in (the app moves the test token over to the staff cookie).
  await c.route('**/api/**', r => ['GET', 'HEAD'].includes(r.request().method()) || r.request().url().includes('/api/crm-auth/') ? r.continue() : r.abort())
  const p = await c.newPage()
  p.on('request', r => { if (/maps\.googleapis|maps\.gstatic/.test(r.url())) google.push(r.url().slice(0, 80)) })
  p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  return { c, p }
}
const tiles = (p, sel) => p.locator(`${sel} .leaflet-tile-loaded`).count()
try {
  // Smart Schedule. One staging job is shown on hold in Customer Delay: the
  // jobs list is changed on its way in, nothing is saved.
  let { c, p } = await page()
  let heldId = ''
  await c.route(/\/api\/saved-jobs\/?(\?.*)?$/, async r => {
    if (r.request().method() !== 'GET') return r.abort()
    const res = await r.fetch(); const json = await res.json()
    const j = Array.isArray(json?.data) ? json.data.find(x => x.status === 'staging') : null
    if (j) { heldId = j.id; j.previousStatus = j.status; j.status = 'on_hold'; j.opsStage = 'customer_delay' }
    await r.fulfill({ response: res, json })
  })
  const jobSaves = []
  // Smart Schedule books through Schedule install (POST /api/schedule/install), the same step as the Schedule page.
  p.on('request', r => { if (r.method() === 'POST' && /\/api\/schedule\/install$/.test(r.url())) jobSaves.push(r.postDataJSON()) })
  await p.goto(`${APP}/dispatch`); await p.waitForSelector('[data-global-appointment]', { timeout: 60000 }); await sleep(1500)
  await p.locator('button:has-text("Smart Schedule")').click(); await p.waitForSelector('[data-smart-schedule-map]'); await sleep(8000)
  check('Smart Schedule: free street map with job dots', (await tiles(p, '[data-smart-schedule-map]')) > 0 && (await p.locator('[data-smart-schedule-map] .leaflet-marker-icon').count()) > 0, `${await tiles(p, '[data-smart-schedule-map]')} tiles, ${await p.locator('[data-smart-schedule-map] .leaflet-marker-icon').count()} dots`)
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-smart-schedule-free-map.png` })
  const rows = p.locator('[data-smart-job]')
  const stages = await rows.evaluateAll(els => els.map(e => e.getAttribute('data-smart-job-stage') || ''))
  check('Smart Schedule: jobs listed, each with its Operations stage', stages.length > 0 && stages.every(Boolean), `${stages.length} jobs; stages: ${[...new Set(stages)].join(', ')}`)
  const held = p.locator(`[data-smart-job="${heldId}"]`)
  check('Smart Schedule: a job on hold shows its side lane, in gray', !!heldId && await held.getAttribute('data-smart-job-held') === 'yes' && await held.getAttribute('data-smart-job-stage') === 'Customer Delay' && (await held.locator('span.bg-gray-200', { hasText: 'Customer Delay' }).count()) === 1)
  // Schedule the first job that is not on hold: Monday Oct 26, 2026, crew "E2E Crew".
  const target = p.locator('[data-smart-job][data-smart-job-held="no"]').first()
  const targetId = await target.getAttribute('data-smart-job')
  await p.locator('input[placeholder="Crew..."]').fill('E2E Crew')
  await p.locator('[data-smart-schedule] input[type="date"]').fill('2026-10-26')
  await target.click(); await target.locator('[data-smart-schedule-job]').click(); await sleep(1500)
  const sent = jobSaves.find(b => b && b.jobId === targetId)
  check('Smart Schedule: Schedule books the job through Schedule install, with its crew and start day', !!sent && sent.crew === 'E2E Crew' && sent.start === '2026-10-26', JSON.stringify(sent))
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-smart-schedule.png` })
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
