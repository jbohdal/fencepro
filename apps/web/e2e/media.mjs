// Photos and video, end to end on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> E2E_PORTAL_TOKEN=<the customer's ezbiz_portal cookie value, from a portal sign in on dev> \
//   E2E_CUSTOMER="Shawn Collins" MEDIA_PHOTO=photo.jpg MEDIA_VIDEO=clip.mp4 node e2e/media.mjs
//
// Test browsers have no camera or compass, so stand-ins provide a moving
// test pattern and a compass reading; the rest is real: the recorder, the
// phone storage, the chunked upload, ffmpeg on the Mac.
// Offline captures wait and upload when back online; each is pinned on the
// plan ("Where were you standing?"), captioned automatically, marked up,
// shared with the customer; files picked from the gallery come along; saving
// the quote for the customer brings the photos to the customer; the portal
// shows only items marked Customer. Everything made is deleted at the end.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import fs from 'fs'

const APP = process.env.APP_URL || 'http://localhost:5173'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const PORTAL = process.env.E2E_PORTAL_TOKEN || ''
const CUSTOMER = process.env.E2E_CUSTOMER || 'Shawn Collins'
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const api = async (p, init = {}, tok = TOKEN) => {
  // The portal signs in with its session cookie (Oct 20, 2026); staff with the Bearer token.
  const auth = tok === PORTAL ? { Cookie: `ezbiz_portal=${tok}` } : { Authorization: `Bearer ${tok}` }
  const r = await fetch(API + p, { ...init, headers: { ...auth, ...(init.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}

// Stand-in camera (a moving test pattern) and compass (10° from north).
function fakeDevices() {
  const c = document.createElement('canvas'); c.width = 1280; c.height = 720
  const g = c.getContext('2d'); let t = 0
  setInterval(() => { t++; g.fillStyle = `hsl(${t % 360},70%,50%)`; g.fillRect(0, 0, 1280, 720); g.fillStyle = '#fff'; g.font = '80px sans-serif'; g.fillText('fence ' + t, 100, 360) }, 50)
  const md = navigator.mediaDevices || {}
  Object.defineProperty(navigator, 'mediaDevices', { value: { ...md, getUserMedia: async () => c.captureStream(20) }, configurable: true })
  Object.defineProperty(navigator, 'geolocation', { value: { watchPosition: (ok) => { setTimeout(() => ok({ coords: { latitude: 29.0909, longitude: -82.1728, accuracy: 12 } }), 50); return 1 }, clearWatch() {} }, configurable: true })
  setInterval(() => { const e = new Event('deviceorientation'); e.webkitCompassHeading = 10; window.dispatchEvent(e) }, 200)
}

const browser = await chromium.launch()
let mediaIds = [], quoteId = null
try {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  await ctx.addInitScript(fakeDevices)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept(d.type() === 'prompt' ? '4 ft gate' : undefined).catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  await page.goto(APP); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(800)
  await page.locator('button:has-text("New quote"):visible').first().click()
  const b = page.locator('[data-quote-builder]')
  await b.locator('[data-step="yard"]').click()
  await b.locator('[data-shape="backyard"]').click()
  await b.locator('[data-side="Left return"] [data-side-length]').click()
  for (const [keys, last] of [[['3', '0'], 0], [['1', '2', '0'], 0], [['1', '5', '0'], 0], [['1', '2', '0'], 0], [['3', '0'], 1]]) {
    for (const k of keys) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
    await page.locator(last ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]').click()
  }
  await b.locator('[data-side-row="Left return"]').click()
  await b.locator('[data-side="Left return"] [data-gate-choice] button:has-text("Walk gate")').click()
  await b.locator('[data-step="style"]').click()
  await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig" })
  await b.locator('[data-step="yard"]').click()

  // ── Offline: two photos and a short video in the in-app camera ──
  await ctx.setOffline(true)
  await page.locator('[data-photos-open]').click()
  await b.locator('[data-media-camera]').click()
  await page.locator('[data-capture-preview]').waitFor()
  await sleep(800)
  await page.locator('[data-capture-shutter]').click(); await sleep(400)
  await page.locator('[data-capture-shutter]').click(); await sleep(400)
  check('camera: several photos in a row without leaving the screen', (await page.locator('[data-capture-count]').textContent()).includes('2'))
  await page.locator('[data-capture-mode="video"]').click()
  await page.locator('[data-capture-record]').click(); await sleep(2500)
  await page.locator('[data-capture-stop]').click(); await sleep(800)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-phone-camera.png` })
  await page.locator('[data-capture-done]').click(); await sleep(800)

  // ── Where were you standing? Set the facing direction once, then pin ──
  check('after the camera: "Where were you standing?"', await page.locator('[data-pin-step]').count() === 1)
  await page.locator('[data-facing-setup] button').click(); await sleep(300)
  await page.locator('[data-facing-setup] button:has-text("OK")').click(); await sleep(300)
  const plan = page.locator('[data-pin-step] [data-site-plan]')
  const box = await plan.boundingBox()
  await plan.click({ position: { x: box.width * 0.22, y: box.height * 0.45 } }); await sleep(200)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-phone-where-were-you.png` })
  check('the pin points the way the camera faced (an arrow)', await page.locator('[data-pin-step] [data-plan-pin="new"] polygon').count() === 1)
  await page.locator('[data-pin-save]').click(); await sleep(1200)

  const badge = (await page.locator('[data-sync-badge]').getAttribute('aria-label').catch(() => '')) || ''
  check('offline: the top bar says 3 waiting', /^3 /.test(badge), badge)
  check('offline: the quote marks them waiting', (await b.locator('[data-media-waiting]').textContent().catch(() => '')).includes('3 waiting'))
  check('offline: three captures shown, kept on the phone', await b.locator('[data-media-item="waiting"]').count() === 3)
  check('the plan shows the photo pins', await b.locator('[data-layout-editor] [data-plan-pin]').count() === 3)
  if (SHOTS) { await b.locator('[data-media-gallery]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/3-phone-waiting-offline.png` }) }

  // ── Back online: they upload, chunk by chunk ──
  await ctx.setOffline(false)
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  for (let i = 0; i < 40 && await b.locator('[data-media-item="uploaded"]').count() < 3; i++) await sleep(1000)
  check('online: all three uploaded and marked', await b.locator('[data-media-item="uploaded"]').count() === 3)
  check('online: the top bar count is gone', await page.locator('[data-sync-badge]').count() === 0)

  let list = []
  // ── Open a photo: caption written for us, mark it up, share with the customer ──
  await b.locator('[data-media-item]').first().click(); await sleep(600)
  const cap = await page.locator('[data-viewer-caption]').inputValue()
  check('auto caption: side, distance, facing and the nearest feature, then category and who', /^Left side, about \d+ ft from the left return corner, looking toward the .+\. .+ \d+ ft (to the left|to the right|ahead|behind)\. Site walk, .+, Jonathan Bohdal\.$/.test(cap), cap)
  await page.locator('[data-viewer-markup]').click()
  await page.locator('[data-markup-canvas]').waitFor(); await sleep(800)
  const cv = await page.locator('[data-markup-canvas]').boundingBox()
  const pt = (x, y, id = 3) => ({ clientX: cv.x + x, clientY: cv.y + y, pointerId: id, pointerType: 'touch', bubbles: true })
  await page.locator('[data-markup-canvas]').dispatchEvent('pointerdown', pt(80, 200))
  await page.locator('[data-markup-canvas]').dispatchEvent('pointermove', pt(180, 260))
  await page.locator('[data-markup-canvas]').dispatchEvent('pointerup', pt(180, 260))
  await page.locator('[data-markup-tool="measure"]').click()
  await page.locator('[data-markup-color="Yellow"]').click()
  await page.locator('[data-markup-canvas]').dispatchEvent('pointerdown', pt(60, 320, 4))
  await page.locator('[data-markup-canvas]').dispatchEvent('pointermove', pt(300, 320, 4))
  await page.locator('[data-markup-canvas]').dispatchEvent('pointerup', pt(300, 320, 4))
  check('markup: an arrow and a "4 ft gate" measurement drawn', (await page.locator('[data-markup-editor]').getAttribute('data-shapes')) === '2')
  await page.locator('[data-markup-undo]').click(); await page.locator('[data-markup-redo]').click()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/4-phone-markup.png` })
  await page.locator('[data-markup-save]').click(); await sleep(2000)
  check('markup saved beside the original; either can be shown', await page.locator('[data-viewer-original]').count() === 1)
  await page.locator('[data-viewer-visibility]').selectOption('customer'); await sleep(800)
  await page.locator('[data-viewer-category]').selectOption('Gate location'); await sleep(800)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-phone-viewer.png` })
  await page.locator('[data-media-viewer] button:has-text("Close")').click(); await sleep(400)

  // ── Pick two files from the phone's gallery ──
  await b.locator('[data-media-pick] input').setInputFiles([process.env.MEDIA_PHOTO, process.env.MEDIA_VIDEO].filter(Boolean))
  await sleep(800)
  if (await page.locator('[data-pin-skip]').count()) await page.locator('[data-pin-skip]').click()
  for (let i = 0; i < 40 && await b.locator('[data-media-item="uploaded"]').count() < 5; i++) await sleep(1000)
  check('gallery: several files picked at once, uploaded', await b.locator('[data-media-item="uploaded"]').count() === 5)

  // ── Save the quote for the customer: the photos follow ──
  await page.locator('[data-photos-done]').click()
  await b.locator('[data-step="price"]').click()
  await page.locator('[data-quote-bar] [data-save-open]').click()
  await page.locator('input[placeholder="Name, phone, or email..."]').fill(CUSTOMER); await sleep(400)
  await page.locator(`text=${CUSTOMER}`).last().click()
  await page.locator('button:has-text("Save quote")').last().click(); await sleep(2500)
  const quotes = await api('/api/saved-quotes')
  const q = (Array.isArray(quotes) ? quotes : []).filter(x => x.customerName === CUSTOMER && x.layout?.yard).sort((a, z) => String(z.createdAt).localeCompare(String(a.createdAt)))[0]
  quoteId = q?.id
  list = await api(`/api/media?quoteKey=${quoteId}`)
  mediaIds = list.map(m => m.id)
  check('server: 5 items with the quote, 3 pinned with a direction', list.length === 5 && list.filter(m => m.pin && typeof m.pin.angle === 'number').length === 3, `${list.length} items, ${list.filter(m => m.pin).length} pinned`)
  const vids = list.filter(m => m.kind === 'video')
  for (let i = 0; i < 40 && (await api(`/api/media?quoteKey=${quoteId}`)).some(m => m.kind === 'video' && m.status === 'processing'); i++) await sleep(1500)
  list = await api(`/api/media?quoteKey=${quoteId}`)
  check('video: a smaller copy made on the Mac, original kept', vids.length === 2 && list.filter(m => m.kind === 'video').every(m => m.previewUrl && m.url && m.status === 'ready'), list.filter(m => m.kind === 'video').map(m => m.status).join(','))
  const custList = await api(`/api/media?customerId=${q.crmContactId}`)
  check('saving the quote for the customer brings the photos to the customer', mediaIds.every(id => custList.some(m => m.id === id)))
  const shared = list.find(m => m.visibility === 'customer')
  check('the shared photo has its marked up copy and new category', !!shared?.markupUrl && shared.category === 'Gate location')

  if (PORTAL) {
    const portal = await api('/api/portal/media', {}, PORTAL)
    const mine = (Array.isArray(portal) ? portal : []).filter(m => mediaIds.includes(m.id))
    check('portal: only the item marked Customer, with its caption', mine.length === 1 && mine[0].id === shared.id && mine[0].caption.length > 10 && !('takenBy' in mine[0]) && !('lat' in mine[0]), `${mine.length} shown`)
  }
  check('no page errors', errors.filter(e => !/Failed to fetch|NetworkError|Load failed|ERR_INTERNET_DISCONNECTED/.test(e)).length === 0, errors.join(' | '))
  await ctx.close()
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  for (const id of mediaIds) await api(`/api/media/${id}`, { method: 'DELETE' })
  if (quoteId) await api(`/api/saved-quotes/${quoteId}`, { method: 'DELETE' })
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
