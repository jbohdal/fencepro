// A real job in the field, on a phone, with bad signal on purpose.
//
//   E2E_ACCESS_TOKEN=<dev staff token> DEVICES=desktop,android SIGNALS=good,slow3g,none,drop \
//   SHOTS=<folder> node e2e/field.mjs
//
// For every device and signal: add a new customer from the pipeline, add a
// note, start a quote with the Backyard layout, take 3 photos, save it, lose
// signal, get it back. Passes only if nothing is lost, nothing is saved twice,
// the screen never says Saved before the server has it, and everything is on
// the server once signal returns.
//
// Signal is switched by a proxy in front of the dev server (signal.mjs): the
// phone opens the app through it. Devices:
//   desktop   Chrome on this Mac at phone size
//   android   Chrome on the Android emulator (adb reverse + remote debugging)
// The phone's camera is a stand-in test pattern on every device.

import { chromium, webkit, devices } from 'playwright'
import { execSync } from 'child_process'
import { startSignal } from './signal.mjs'
import fs from 'fs'

const DEV_API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const PROXY_PORT = 4010
const APP = `http://localhost:${PROXY_PORT}`
const DEVICES = (process.env.DEVICES || 'desktop').split(',')
const SIGNALS = (process.env.SIGNALS || 'good,slow3g,none,drop').split(',')
const FLOWS = (process.env.FLOWS || 'a,b,c,d').split(',')
if (!/localhost:4001$/.test(DEV_API)) { console.error('Refusing to run: the dev copy only (API_URL must be localhost:4001).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const ADB = `${process.env.HOME}/Library/Android/sdk/platform-tools/adb`
const sh = cmd => { try { return execSync(cmd, { stdio: ['ignore', 'pipe', 'ignore'] }).toString() } catch { return '' } }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const table = []
let row = null
const check = (name, ok, detail = '') => {
  results.push(ok)
  if (row && !ok) row.fail.push(name)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${row ? `[${row.device} / ${row.signal}] ` : ''}${name}${detail ? '  -- ' + detail : ''}`)
}
const api = async (p, init = {}) => {
  const r = await fetch(DEV_API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}

// Stand-in camera and compass, as in media.mjs.
function fakeDevices() {
  // Small and slow, so the test camera itself does not use up the phone's memory.
  const c = document.createElement('canvas'); c.width = 640; c.height = 360
  const g = c.getContext('2d'); let t = 0
  setInterval(() => { t++; g.fillStyle = `hsl(${t % 360},70%,50%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText('fence ' + t, 50, 180) }, 200)
  const md = navigator.mediaDevices || {}
  Object.defineProperty(navigator, 'mediaDevices', { value: { ...md, getUserMedia: async () => c.captureStream(5) }, configurable: true })
  Object.defineProperty(navigator, 'geolocation', { value: { watchPosition: ok => { setTimeout(() => ok({ coords: { latitude: 29.0909, longitude: -82.1728, accuracy: 12 } }), 50); return 1 }, clearWatch() {} }, configurable: true })
}
const signIn = t => { try { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') } catch { /* first page */ } }

async function desktopDevice(browser) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(signIn, TOKEN)
  await ctx.addInitScript(fakeDevices)
  await ctx.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  const page = await ctx.newPage()
  return { name: 'Desktop Chrome, phone size', short: 'desktop', page, newPage: () => ctx.newPage(), offline: on => ctx.setOffline(on), close: () => ctx.close(), back: () => page.goBack({ waitUntil: 'commit' }).catch(() => {}) }
}

/** WebKit (Safari's engine) at iPhone size. A stand-in until the iOS Simulator is installed, not a substitute. */
async function webkitDevice() {
  const wk = await webkit.launch()
  const ctx = await wk.newContext({ ...devices['iPhone 13'] })
  await ctx.addInitScript(signIn, TOKEN)
  await ctx.addInitScript(fakeDevices)
  await ctx.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  const page = await ctx.newPage()
  return { name: 'WebKit (Safari engine), iPhone 13 size', short: 'webkit', page, newPage: () => ctx.newPage(), offline: on => ctx.setOffline(on), close: () => wk.close(), back: () => page.goBack({ waitUntil: 'commit' }).catch(() => {}) }
}

async function androidDevice() {
  sh(`${ADB} reverse tcp:${PROXY_PORT} tcp:${PROXY_PORT}`)
  sh(`${ADB} shell cmd connectivity airplane-mode disable`)
  sh(`${ADB} shell am start -n com.android.chrome/com.google.android.apps.chrome.Main -d about:blank`)
  await sleep(2500)
  sh(`${ADB} forward tcp:9222 localabstract:chrome_devtools_remote`)
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const ctx = browser.contexts()[0]
  await ctx.addInitScript(signIn, TOKEN)
  await ctx.addInitScript(fakeDevices)
  await ctx.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  // One tab, on screen: Chrome's own pop-ups and leftover tabs closed, so what is tested is what a person sees.
  const pages = ctx.pages()
  const page = pages[0] ?? await ctx.newPage()
  for (const p of pages.slice(1)) await p.close().catch(() => {})
  await page.bringToFront()
  return {
    name: `Android emulator, Chrome ${browser.version()}`, short: 'android', page, newPage: () => ctx.newPage(),
    // Airplane mode: the phone says it has no signal (the proxy cuts the traffic itself).
    offline: async on => { sh(`${ADB} shell cmd connectivity airplane-mode ${on ? 'enable' : 'disable'}`) },
    close: async () => { sh(`${ADB} shell cmd connectivity airplane-mode disable`); await browser.close().catch(() => {}) },
    screenshot: path => { execSync(`${ADB} exec-out screencap -p > "${path}"`) },
    visible: () => page.evaluate(() => document.visibilityState),
    // The phone's own Back button.
    back: async () => { sh(`${ADB} shell input keyevent KEYCODE_BACK`) },
  }
}

/** Close the on-screen keyboard after typing (the test tool aims taps wrong while it is open). */
const doneTyping = async page => { await page.evaluate(() => (document.activeElement)?.blur?.()); await sleep(500) }

/** The installed app (added to the home screen): its own window, no browser bar. Open it from its icon first. */
async function androidAppDevice() {
  sh(`${ADB} reverse tcp:${PROXY_PORT} tcp:${PROXY_PORT}`)
  sh(`${ADB} shell cmd connectivity airplane-mode disable`)
  sh(`${ADB} forward tcp:9222 localabstract:chrome_devtools_remote`)
  const browser = await chromium.connectOverCDP('http://localhost:9222')
  const ctx = browser.contexts()[0]
  let page = null
  for (const p of ctx.pages()) {
    if (await p.evaluate(() => matchMedia('(display-mode: standalone)').matches).catch(() => false)) { page = p; break }
  }
  if (!page) throw new Error('The installed app is not open: tap the Getter Done icon on the emulator first.')
  await ctx.addInitScript(signIn, TOKEN)
  await ctx.addInitScript(fakeDevices)
  await ctx.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  return {
    name: `Android emulator, installed app (Chrome ${browser.version().split('/').pop()})`, short: 'android-app', page, newPage: () => ctx.newPage(),
    offline: async on => { sh(`${ADB} shell cmd connectivity airplane-mode ${on ? 'enable' : 'disable'}`) },
    close: async () => { sh(`${ADB} shell cmd connectivity airplane-mode disable`); await browser.close().catch(() => {}) },
    screenshot: path => { execSync(`${ADB} exec-out screencap -p > "${path}"`) },
    visible: () => page.evaluate(() => matchMedia('(display-mode: standalone)').matches ? document.visibilityState : 'not the installed app'),
    back: async () => { sh(`${ADB} shell input keyevent KEYCODE_BACK`) },
  }
}

async function shot(dev, name) {
  if (!SHOTS) return
  const path = `${SHOTS}/${dev.short}-${row.signal}-${name}.png`
  if (dev.screenshot) dev.screenshot(path); else await dev.page.screenshot({ path })
}

async function badge(page) {
  return page.locator('[data-sync-badge]').getAttribute('data-sync-badge').catch(() => null)
}

/** Wait until nothing is waiting on the phone (badge gone), up to `ms`. */
async function untilSynced(page, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if ((await page.locator('[data-sync-badge]').count()) === 0) return true
    await sleep(1000)
  }
  return false
}

async function flowA(dev, signal, proxy) {
  const { page } = dev
  const stamp = Date.now().toString(36).slice(-5)
  const first = 'Field', last = `${signal} ${dev.short} ${stamp}`, NAME = `${first} ${last}`
  const errors = []
  page.removeAllListeners('pageerror'); page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.removeAllListeners('dialog'); page.on('dialog', d => d.accept().catch(() => {}))

  proxy.set('up')
  await page.goto(`${APP}/pipeline`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-kanban-col]', { timeout: 60000 })
  await sleep(1500)
  // Anything left on the phone by an earlier run goes first, by itself.
  await untilSynced(page, 60_000)
  check('starts with nothing waiting on the phone', (await page.locator('[data-sync-badge]').count()) === 0)
  if (dev.visible) check('the app is the tab on screen', (await dev.visible()) === 'visible', await dev.visible())

  // The signal for this run, from here on.
  if (signal === 'slow3g') proxy.set('slow3g')
  if (signal === 'none') { proxy.set('down'); await dev.offline(true) }

  // ── New customer from the pipeline ──
  await page.locator('button[aria-label="New Lead"]').click()
  await page.locator('[data-lead-field="first-name"]').fill(first)
  await page.locator('[data-lead-field="last-name"]').fill(last)
  await page.locator('[data-lead-field="phone"]').fill(`352555${String(Math.floor(Math.random() * 9000) + 1000)}`)
  await page.locator('[data-lead-field="street"]').fill('5708 SW 90th Ln')
  await doneTyping(page)
  if (signal === 'drop') proxy.set('drop')
  await page.locator('[data-lead-add]').click()
  await sleep(1200)
  const card = page.locator(`[data-kanban-col] >> text=${NAME}`).first()
  check('the new card shows at once', (await card.count()) === 1)
  await card.click(); await sleep(800)
  const status = await page.locator('[data-card-window] [data-save-status]').first().getAttribute('data-save-status').catch(() => null)
  if (signal === 'none' || signal === 'drop') check('no signal: it says Waiting for signal (or Saving), never Saved', status === 'waiting' || status === 'saving', String(status))
  await shot(dev, '1-card-window')

  // ── Note ──
  await page.locator('[data-card-add-note]').click()
  await page.locator('[data-card-note-text]').fill('Gate on the left, dog in the yard')
  await doneTyping(page)
  await page.locator('[data-card-note-save]').click(); await sleep(600)
  check('the note shows at once', (await page.locator('[data-card-note]').first().textContent().catch(() => '')).includes('Gate on the left'))

  // ── Quote with the Backyard layout and 3 photos ──
  await page.locator('[data-card-new-quote]').click()
  const b = page.locator('[data-quote-builder]')
  await b.waitFor()
  await b.locator('[data-step="yard"]').click()
  await b.locator('[data-shape="backyard"]').click()
  await b.locator('[data-side="Left return"] [data-side-length]').click()
  for (const [keys, last2] of [[['3', '0'], 0], [['1', '2', '0'], 0], [['1', '5', '0'], 0], [['1', '0', '0'], 0], [['3', '0'], 1]]) {
    for (const k of keys) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
    await page.locator(last2 ? '[data-ftin-pad] [data-pad-done]' : '[data-ftin-pad] [data-pad-next]').click()
  }
  await b.locator('[data-step="style"]').click()
  await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig" })
  // Photos have their own button in the bottom bar.
  await page.locator('[data-photos-open]').click()
  await b.locator('[data-media-camera]').click()
  await page.locator('[data-capture-preview]').waitFor({ timeout: 20000 })
  await sleep(800)
  for (let i = 0; i < 3; i++) { await page.locator('[data-capture-shutter]').click(); await sleep(450) }
  await page.locator('[data-capture-done]').click(); await sleep(800)
  // "Where were you standing?" follows the camera (later on a slow connection).
  if (await page.locator('[data-pin-skip]').waitFor({ timeout: 10000 }).then(() => true, () => false)) { await page.locator('[data-pin-skip]').click(); await sleep(400) }
  check('3 photos taken and shown', await b.locator('[data-media-item]').count() >= 3, String(await b.locator('[data-media-item]').count()))
  await shot(dev, '2-quote-with-photos')
  await page.locator('[data-photos-done]').click()
  await b.locator('[data-step="price"]').click()
  await page.locator('[data-save-open]').click()
  await sleep(800)
  check('the save form does not open the keyboard over Save when the customer is already chosen', await page.evaluate(() => document.activeElement?.tagName !== 'INPUT'))
  await page.locator('[data-save-submit]').click()
  let closedAfter = -1
  for (let i = 0; i < 20; i++) { if ((await page.locator('[data-quote-builder]').count()) === 0) { closedAfter = i * 250; break } await sleep(250) }
  check('the quote builder closed after Save', closedAfter >= 0, `${closedAfter} ms, at ${new URL(page.url()).pathname}${new URL(page.url()).search}; save form open: ${await page.locator('[data-save-submit]').count()}`)
  // Back to the board, where the top bar is.
  await page.locator('[data-card-window] button[aria-label="Close"]').click(); await sleep(500)
  if (signal === 'none') {
    check('no signal: the top bar shows what is waiting', (await badge(page)) === 'waiting', String(await badge(page)))
    await page.locator('[data-sync-badge]').click(); await sleep(500)
    const items = await page.locator('[data-waiting-item]').count()
    check('no signal: the waiting list names each change in words', items >= 3 && (await page.locator('[data-waiting-list]').textContent()).includes('No signal right now'))
    await shot(dev, '3-waiting-list')
    await page.locator('[data-waiting-list] button[aria-label="Close"]').click(); await sleep(300)
  }

  // ── Lose signal, get it back ──
  if (signal === 'drop') { await sleep(4000) }
  proxy.set('down'); await dev.offline(true); await sleep(3000)
  const lostBadge = await badge(page)
  check('signal lost: anything still on the phone shows as waiting', lostBadge === null || lostBadge === 'waiting', String(lostBadge))
  proxy.set(signal === 'slow3g' ? 'slow3g' : 'up'); await dev.offline(false)
  const synced = await untilSynced(page, signal === 'slow3g' ? 180_000 : 120_000)
  check('signal back: everything sent by itself (badge gone)', synced, String(await badge(page)))
  await sleep(1000)
  await page.locator(`[data-kanban-col] >> text=${NAME}`).first().click(); await sleep(800)
  check('the card says Saved', (await page.locator('[data-card-window] [data-save-status]').first().getAttribute('data-save-status').catch(() => null)) === 'saved')
  await shot(dev, '4-saved')

  if (signal === 'none') {
    // A second note with no signal: the first stays on screen, and the card does not say Saved.
    proxy.set('down'); await dev.offline(true); await sleep(800)
    await page.locator('[data-card-add-note]').click()
    await page.locator('[data-card-note-text]').fill('Second note, no signal')
    await doneTyping(page)
    await page.locator('[data-card-note-save]').click(); await sleep(800)
    const shown = await page.locator('[data-card-note]').allTextContents()
    check('no signal: a new note does not hide the earlier one', shown.some(t => t.includes('Gate on the left')) && shown.some(t => t.includes('Second note')), shown.join(' | '))
    check('no signal: the card header does not say Saved while the note waits', (await page.locator('[data-card-window] [data-save-status]').first().getAttribute('data-save-status')) !== 'saved')
    proxy.set('up'); await dev.offline(false)
    await untilSynced(page, 60_000); await sleep(1500)
    const after = await page.locator('[data-card-note]').allTextContents()
    check('signal back: both notes shown, header Saved', after.length >= 2 && (await page.locator('[data-card-window] [data-save-status]').first().getAttribute('data-save-status')) === 'saved', after.join(' | '))
  }

  // ── On the server: everything, once ──
  const contacts = (await api('/api/crm-contacts')).filter(c => `${c.firstName} ${c.lastName}` === NAME)
  check('one customer on the server, no duplicate', contacts.length === 1, String(contacts.length))
  const cid = contacts[0]?.id
  const cards = (await api('/api/pipeline')).leads.filter(l => `${l.firstName} ${l.lastName}` === NAME)
  check('one pipeline card, pointing at that customer', cards.length === 1 && cards[0].customerId === cid, `${cards.length} cards, customerId ${cards[0]?.customerId === cid ? 'matches' : 'does not match'}`)
  const notes = cid ? await api(`/api/crm-contacts/${cid}/notes`) : []
  const wantNotes = signal === 'none' ? 2 : 1
  check(`${wantNotes === 1 ? 'one note' : 'both notes'}, no duplicate`, Array.isArray(notes) && notes.length === wantNotes, String(notes?.length))
  const quotes = (await api('/api/saved-quotes')).filter(q => q.crmContactId === cid)
  check('one quote with the backyard layout', quotes.length === 1 && quotes[0].layout?.yard?.shape === 'backyard', String(quotes.length))
  const media = quotes[0] ? await api(`/api/media?quoteKey=${quotes[0].id}`) : []
  check('3 photos on the server', Array.isArray(media) && media.length === 3, String(media?.length))
  check('no page errors', errors.length === 0, errors.join(' | '))
  await page.locator('[data-card-window] button[aria-label="Close"]').click().catch(() => {})
  return { cid, name: NAME, quoteId: quotes[0]?.id, mediaIds: (media || []).map(m => m.id), cardIds: cards.map(c => c.id) }
}

const PHOTO = process.env.MEDIA_PHOTO ? fs.readFileSync(process.env.MEDIA_PHOTO).toString('base64') : null
/** Pick a photo the way the phone's file chooser hands one to the page. */
async function pickPhoto(page, selector) {
  await page.evaluate(([sel, b64]) => {
    const bin = atob(b64), bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const dt = new DataTransfer()
    dt.items.add(new File([bytes], 'completed.jpg', { type: 'image/jpeg' }))
    const input = document.querySelector(sel)
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, [selector, PHOTO])
}
const path = page => { const u = new URL(page.url()); return u.pathname + u.search }

/** The app stays open on the salesman's phone; it finds a job sold elsewhere without a reload. */
async function seesJobWithoutReload(page, jobName) {
  await page.evaluate(() => { history.pushState({ ez: 1, i: 99000, depth: 0 }, '', '/operations'); dispatchEvent(new PopStateEvent('popstate', { state: history.state })) })
  for (let i = 0; i < 25; i++) { if (await page.locator(`text=${jobName} >> visible=true`).count()) return true; await sleep(1000) }
  return false
}

/** (b) The customer opens the proposal on their phone (no Tailscale, no login), picks Better, signs. */
async function flowB(dev, signal, proxy, a) {
  const app = dev.page
  // The salesman copies the proposal link from the quote: the quote is Sent from then on.
  await app.evaluate(id => { history.pushState({ ez: 1, i: 98000, depth: 0 }, '', `/quotes?qv=${id}`); dispatchEvent(new PopStateEvent('popstate', { state: history.state })) }, a.quoteId)
  await app.locator('[data-proposal-send] button:has-text("Copy link")').click({ timeout: 20000 }).catch(() => {})
  let sentStatus = ''
  for (let i = 0; i < 20 && sentStatus !== 'SENT'; i++) { await sleep(1000); sentStatus = (await api('/api/saved-quotes')).find(x => x.id === a.quoteId)?.status }
  check('Copy link marks the quote Sent', sentStatus === 'SENT', sentStatus)
  await app.evaluate(() => history.back())
  await sleep(800)
  // The customer's own phone: another page. The salesman's app stays open.
  const page = await dev.newPage()
  await page.bringToFront().catch(() => {})
  const share = await api(`/api/saved-quotes/${a.quoteId}/share-token`, { method: 'POST' })
  proxy.set(signal === 'slow3g' ? 'slow3g' : 'up')
  await page.goto(`${APP}/p/${share.shareToken}`, { waitUntil: 'domcontentloaded' })
  await page.locator('#go').waitFor({ timeout: 60000 })
  const better = page.locator('label.opt').filter({ has: page.locator('.tier', { hasText: /^Better$/ }) })
  const tierNames = (await page.locator('.tier').allTextContents()).join(',')
  check('the proposal opens on the phone with Good, Better, Best', tierNames.startsWith('Good,Better,Best'), tierNames || 'no tiers shown')
  await better.locator('input[type=radio]').check()
  await page.locator('#name').fill('Pat Customer')
  await doneTyping(page)
  await page.locator('#sig').scrollIntoViewIfNeeded(); await sleep(300)
  const box = await page.locator('#sig').boundingBox()
  await page.mouse.move(box.x + 30, box.y + 60); await page.mouse.down()
  for (let k = 1; k <= 10; k++) await page.mouse.move(box.x + 30 + k * 20, box.y + 60 + (k % 2 ? 25 : -10))
  await page.mouse.up()
  if (SHOTS && !dev.screenshot) await page.screenshot({ path: `${SHOTS}/${dev.short}-${row.signal}-5-proposal-signed.png` }); else await shot(dev, '5-proposal-signed')
  if (signal === 'none' || signal === 'drop') {
    if (signal === 'none') { proxy.set('down'); await dev.offline(true) } else proxy.set('drop')
    await page.locator('#go').click(); await sleep(2500)
    check('no signal while accepting: it says so in plain words and lets them try again', /No connection/.test(await page.locator('#err').textContent()) && await page.locator('#go').isEnabled(), await page.locator('#err').textContent())
    proxy.set('up'); await dev.offline(false); await sleep(1000)
  }
  await page.locator('#go').click()
  // The page reloads to "Accepted" (slower on weak signal).
  await page.locator('section.done').waitFor({ timeout: 45000 }).catch(() => {})
  const q = (await api('/api/saved-quotes')).find(x => x.id === a.quoteId)
  check('accepted on the server: Better, signed, sold', q?.status === 'SOLD' && q?.chosenOption === 1 && q?.acceptedBy === 'Pat Customer', `${q?.status} option ${q?.chosenOption}`)
  check('the customer sees it accepted (no error)', !(await page.locator('#err').textContent().catch(() => '')) && /accepted|thank you/i.test(await page.locator('body').textContent()))
  if (SHOTS && !dev.screenshot) await page.screenshot({ path: `${SHOTS}/${dev.short}-${row.signal}-6-proposal-accepted.png` }); else await shot(dev, '6-proposal-accepted')
  const jobs = (await api('/api/saved-jobs')).filter(j => j.quoteId === a.quoteId)
  check('one job made for it, no duplicate', jobs.length === 1, String(jobs.length))
  await page.close().catch(() => {})
  await app.bringToFront().catch(() => {})
  check("the salesman's open app shows the new job in Operations, no reload", await seesJobWithoutReload(app, a.name))
  return jobs[0]?.id ?? null
}

/** (c) The job in Operations, send the install packet, the crew opens it and uploads a Completed photo. */
async function flowC(dev, signal, proxy, jobId) {
  const { page } = dev
  proxy.set(signal === 'slow3g' ? 'slow3g' : 'up')
  await page.goto(`${APP}/operations?job=${jobId}`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-packet-send]').waitFor({ timeout: 60000 })
  check('the job shows in Operations', true)
  await page.locator('[data-packet-send]').click()
  await page.locator('[data-packet-url]').waitFor({ timeout: 30000 })
  const url = (await page.locator('[data-packet-url]').textContent()).trim()
  check('the install packet link is made', /\/p\/i\/[\w-]{20,}$/.test(url), url)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.locator('#files').waitFor({ state: 'attached', timeout: 60000 })
  await page.locator('#cat').selectOption('Completed')
  await page.locator('#note').fill('All done')
  await doneTyping(page)
  if (signal === 'none') { proxy.set('down'); await dev.offline(true) }
  if (signal === 'drop') proxy.set('drop')
  await pickPhoto(page, '#files')
  if (signal === 'none' || signal === 'drop') {
    await sleep(3000)
    check('no signal on the crew page: it says it will send by itself', /No signal/.test(await page.locator('#upMsg').textContent()), await page.locator('#upMsg').textContent())
    await shot(dev, '7-crew-no-signal')
    proxy.set('up'); await dev.offline(false)
  }
  let up = ''
  for (let i = 0; i < 60 && !/uploaded/.test(up); i++) { await sleep(1000); up = await page.locator('#upMsg').textContent() }
  check('the crew photo uploads (by itself once there is signal)', /1 uploaded/.test(up), up)
  await shot(dev, '8-crew-uploaded')
  const media = (await api(`/api/media?jobId=${jobId}`)).filter(m => m.source === 'crew')
  check('one Completed photo on the job, Internal, no duplicate', media.length === 1 && media[0].category === 'Completed' && media[0].visibility === 'internal', String(media.length))
  return media.map(m => m.id)
}

/** (d) Back through it all, with the phone's own Back. */
async function flowD(dev, a, jobId) {
  const { page } = dev
  await page.goto(`${APP}/pipeline`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-kanban-col]', { timeout: 60000 }); await sleep(1200)
  await page.locator(`[data-kanban-col] >> text=${a.name}`).first().click(); await sleep(900)
  await page.locator('[data-card-new-quote]').click(); await sleep(1200)
  check('Back: card window, then New quote, each with its own address', path(page).includes('quote=new'), path(page))
  await dev.back(); await sleep(1200)
  check('Back closes the quote, the card window stays', path(page).includes('card=') && !path(page).includes('quote=') && await page.locator('[data-card-window]').count() === 1, path(page))
  await dev.back(); await sleep(1200)
  check('Back again closes the card window, still on the pipeline', path(page) === '/pipeline' && await page.locator('[data-card-window]').count() === 0, path(page))
  await page.locator('[data-card-window]').count()
  await page.goto(`${APP}/customers/${a.cid}`, { waitUntil: 'domcontentloaded' }); await sleep(2500)
  await page.locator('[data-customer-tab="quotes"]').click(); await sleep(500)
  const sold = (await api('/api/saved-quotes')).find(x => x.id === a.quoteId)
  const price = '$' + Math.round(sold.finalPrice).toLocaleString('en-US')
  await page.locator(`[data-page-scroll] >> text=${price} >> visible=true`).last().click(); await sleep(1200)
  check('a quote on the customer page opens with its own address', path(page).includes('qv='), path(page))
  await dev.back(); await sleep(1200)
  check('Back closes the quote, back on the customer', path(page) === `/customers/${a.cid}`, path(page))
  await page.goto(`${APP}/operations?job=${jobId}`, { waitUntil: 'domcontentloaded' }); await sleep(2500)
  check('reloading on a job opens it', await page.locator('[data-packet-send]').count() === 1)
  await dev.back(); await sleep(1200)
  check('Back closes the job and stays in Operations, not out of the app', path(page) === '/operations', path(page))
  await shot(dev, '9-back-to-operations')
}

const made = []
const proxy = await startSignal({ listen: PROXY_PORT, target: 4001 })
const browser = await chromium.launch()
try {
  for (const d of DEVICES) {
    const dev = d === 'android' ? await androidDevice() : d === 'android-app' ? await androidAppDevice() : d === 'webkit' ? await webkitDevice() : await desktopDevice(browser)
    for (const signal of SIGNALS) {
      row = { device: dev.name, signal, fail: [] }
      table.push(row)
      const t0 = Date.now()
      try {
        const a = await flowA(dev, signal, proxy)
        made.push(a)
        if (FLOWS.includes('b') && a.quoteId) {
          const jobId = await flowB(dev, signal, proxy, a)
          a.jobId = jobId
          if (FLOWS.includes('c') && jobId) a.mediaIds.push(...await flowC(dev, signal, proxy, jobId))
          if (FLOWS.includes('d') && jobId && signal === 'good') await flowD(dev, a, jobId)
        }
      } catch (e) { check('the run finished', false, String(e?.message || e).split('\n').slice(0, 4).join(' ')) }
      row.seconds = Math.round((Date.now() - t0) / 1000)
      proxy.set('up'); await dev.offline(false)
    }
    await dev.close()
  }
} finally {
  proxy.set('up')
  // Tidy the dev copy: what these runs made.
  for (const m of made.filter(Boolean)) {
    for (const id of m.mediaIds) await api(`/api/media/${id}`, { method: 'DELETE' })
    if (m.jobId) await api(`/api/saved-jobs/${m.jobId}`, { method: 'DELETE' })
    if (m.quoteId) await api(`/api/saved-quotes/${m.quoteId}`, { method: 'DELETE' })
    if (m.cardIds?.length) { const p = await api('/api/pipeline'); await api('/api/pipeline', { method: 'PATCH', body: JSON.stringify({ upsert: [], remove: m.cardIds, baseVersion: p.version }) }) }
    if (m.cid) await api(`/api/crm-contacts/${m.cid}`, { method: 'DELETE' })
  }
  await browser.close()
  await proxy.close()
}
console.log('\nDevice | Signal | Result | Time')
for (const r of table) console.log(`${r.device} | ${r.signal} | ${r.fail.length ? 'FAIL: ' + r.fail.join('; ') : 'PASS'} | ${r.seconds}s`)
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
