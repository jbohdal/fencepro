// The phone tests on REAL iPhone Safari: Mobile Safari in the iOS Simulator,
// driven by Apple's safaridriver (W3C WebDriver, spoken here with fetch: no
// extra package). The same steps also run in Playwright (DRIVER=webkit or
// DRIVER=chromium, an iPhone sized touch screen) to tell an iPhone-only failure
// from one every browser has.
//
//   cd apps/web
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 node e2e/iphone-safari.mjs
//
//   DRIVER=safari (default) | webkit | chromium
//   DEVICE='iPhone 16'  IOS=18.5       the simulator safaridriver opens (Safari only)
//   AREAS=fit,quote,media,payments,portal,home   only these areas (all by default)
//   SHOTS=<folder>   screenshots of each failure, iphone-<area>-<check>.png
//                    (default ~/Downloads/ezbiz-screens-2026-10-17)
//   MEDIA_PHOTO=<.jpg> MEDIA_VIDEO=<.mp4>   the files picked in "Choose from gallery"
//   E2E_ACCESS_TOKEN=<dev owner token>      optional: otherwise the script makes its own
//                    dev sign in (scripts/dev-session-token.ts, ezbiz_dev only) and removes it
//
// One time on the Mac (needs the admin password once): `safaridriver --enable`.
// The iOS 18.5 simulator runtime must be installed (Xcode > Settings > Components,
// or `xcodebuild -downloadPlatform iOS -buildVersion 18.5`). The simulator
// shares the Mac's network, so it reaches http://localhost:4001 directly.
//
// Areas (each prints PASS/FAIL lines):
//   fit       the main screens fit at iPhone width (phone-fit.mjs's own audit(): no
//             sideways scroll, nothing off screen, cut off or covered); the side menu,
//             the notifications dropdown and the search dialog sit above the maps
//             (Dispatch, Appointments map), phone-fit.mjs's overlayOverMap()
//   quote     website quote /p/quote/?test=1 (test mode: no draft, no lead): the address
//             suggestion, the aerial photo sharp, fence points tapped on the photo, Done,
//             a gate, the price step; no lead made
//   media     a customer's Photos: "Choose from gallery" with a JPEG and a short MP4,
//             both uploaded, the photo shows (grid and viewer), the server has both
//   payments  a sold test job: Payment received (check), the receipt shows and saves,
//             the public receipt link opens with no sign in
//   portal    the customer's invite: set a password on /p/portal/, the dashboard,
//             Billing (the payment, its receipt link, the balance), Documents
//   home      Add to Home Screen: manifest, apple-touch-icon, apple-mobile-web-app
//             tags, the icons load, the start URL opens; navigator.standalone is false
//             in a Safari tab. The Share sheet itself cannot be tapped by WebDriver.
//   reload    signed in as the owner and then as WT Christa (Salesman): Today, Pipeline,
//             a customer, a quote and Schedule each opened by its address (a new address
//             while signed in), then reloaded RELOADS times (default 5); each time the
//             screen must show, and stay shown (a tab that crashed is reloaded by Safari
//             and loses the mark the test leaves on the page). Prints the first load's
//             size (files and API answers, the biggest answers) and the Simulator's
//             Safari page process memory (WebContent, from `ps` on the Mac) before and
//             after. Walkthrough round 2, item 2 (Oct 26, 2026).
//
// Dev copy only (localhost:4001 or a worktree's own port, never 4000; database ezbiz_dev).
// Everything it makes is removed.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // makes a customer, quote, job and payments on the shared dev copy
import { spawn, execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { fileURLToPath } from 'url'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
// The dev copy on this Mac: http://localhost:4001, or a worktree's own dev server on another port (never 4000, live).
const devLocal = u => /^http:\/\/localhost:\d+\/?$/.test(u) && !/:4000\/?$/.test(u)
if (!devLocal(APP) || !devLocal(API)) { console.error('Refusing to run: the dev copy only (http://localhost:4001, never port 4000).'); process.exit(2) }
const DRIVER = process.env.DRIVER || 'safari'
const DEVICE = process.env.DEVICE || 'iPhone 16'
const IOS = process.env.IOS || '18.5'
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PORTAL_DIR = path.resolve(HERE, '../../portal')
const SHOTS = process.env.SHOTS || path.join(os.homedir(), 'Downloads/ezbiz-screens-2026-10-17')
const AREAS = (process.env.AREAS || 'fit,quote,media,payments,portal,home,reload').split(',').map(s => s.trim())
const RELOADS = Math.max(1, Number(process.env.RELOADS || 5))
const PHOTO = process.env.MEDIA_PHOTO || ''
const VIDEO = process.env.MEDIA_VIDEO || ''
const TAG = DRIVER === 'safari' ? 'iphone' : `iphone-pw-${DRIVER}`
fs.mkdirSync(SHOTS, { recursive: true })

const envDb = fs.readFileSync(path.join(PORTAL_DIR, '.env'), 'utf8').match(/^DATABASE_URL="?([^"\n]+)/m)?.[1] || ''
if (!/\/ezbiz_dev(\?|$)/.test(envDb)) { console.error('Refusing to run: apps/portal/.env must name ezbiz_dev.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const sql = q => execFileSync('psql', ['-d', 'ezbiz_dev', '-At', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim()
const lit = s => `'${String(s).replace(/'/g, "''")}'`
const results = []
let D = null // the driver
let area = ''
const shotted = new Set()
async function check(name, ok, detail = '') {
  results.push({ area, name, ok: !!ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${area}] ${name}${detail ? '  -- ' + detail : ''}`)
  if (!ok && D) {
    const slug = `${TAG}-${area}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`
    if (!shotted.has(slug)) { shotted.add(slug); await D.screenshot(path.join(SHOTS, `${slug}.png`)).then(() => console.log(`      screenshot: ${path.join(SHOTS, slug + '.png')}`)).catch(() => {}) }
  }
}
async function until(fn, ms = 20000, every = 400) { const end = Date.now() + ms; for (;;) { const v = await fn().catch(() => null); if (v || Date.now() > end) return v; await sleep(every) } }

// ── Drivers: real iPhone Safari (safaridriver) or Playwright at iPhone size ──
// Scripts are WebDriver style: a function body that reads `arguments`.
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'
const typedBySetter = new Set() // fields whose text safaridriver's keys did not insert
const clickedNotTouched = new Set() // too far down the page for safaridriver's touch

async function safariDriver() {
  const port = 4444 + crypto.randomInt(500)
  const proc = spawn('safaridriver', ['-p', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] })
  let log = ''
  proc.stdout.on('data', d => { log += d }); proc.stderr.on('data', d => { log += d })
  const base = `http://localhost:${port}`
  await until(async () => (await fetch(`${base}/status`)).ok, 15000, 300)
  const raw = async (method, p, body) => {
    // A command that has not answered in 2 minutes is a hung driver: say which one.
    if (process.env.DEBUG_WD) console.log(`      wd ${method} ${p.replace(/^\/session\/[^/]+/, '')} ${body ? JSON.stringify(body).slice(0, 100) : ''}`)
    const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120000) })
      .catch(e => { throw new Error(`${method} ${p.replace(/^\/session\/[^/]+/, '')}: no answer from safaridriver (${e.name === 'TimeoutError' ? 'timed out after 120 s' : e.message})`) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { const e = new Error(`${method} ${p}: ${j.value?.error || r.status} ${String(j.value?.message || '').slice(0, 300)}`); e.wd = j.value?.error; throw e }
    return j.value
  }
  const caps = { browserName: 'safari', platformName: 'iOS', 'safari:useSimulator': true, 'safari:deviceName': DEVICE, 'safari:platformVersion': IOS }
  let s
  // A run that died can leave Safari paired with its old session: quit Safari in that simulator and try once more.
  const quitSafari = () => {
    const devs = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', '-j']).toString()).devices
    const udid = Object.entries(devs).find(([rt]) => rt.endsWith(`iOS-${IOS.replace('.', '-')}`))?.[1].find(d => d.name === DEVICE && d.state === 'Booted')?.udid
    if (udid) execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], { stdio: 'ignore' })
  }
  for (let i = 0; ; i++) {
    try { s = await raw('POST', '/session', { capabilities: { alwaysMatch: caps } }); break } catch (e) {
      if (i === 0 && /already paired/i.test(e.message)) { try { quitSafari() } catch { /* not booted */ } await sleep(3000); continue }
      proc.kill(); throw new Error(`${e.message}${log ? ' | safaridriver: ' + log.slice(-400) : ''}`)
    }
  }
  const sid = s.sessionId
  const wd = (method, p, body) => raw(method, `/session/${sid}${p}`, body)
  await wd('POST', '/timeouts', { script: 90000, pageLoad: 60000, implicit: 0 })
  const find = async css => { try { return (await wd('POST', '/element', { using: 'css selector', value: css }))[ELEMENT] } catch (e) { if (e.wd === 'no such element') return null; throw e } }
  const must = async (css, ms = 15000) => { const id = await until(() => find(css), ms, 300); if (!id) throw new Error(`not found: ${css}`); return id }
  // safaridriver on iOS 18 (Simulator) places a touch at "viewport" x, y measured from the top
  // of the PAGE, not of the screen: with the page scrolled, a tap lands scrollY higher (seen: sent
  // at y 399 with the page scrolled 309, it arrived at clientY 90; an element-origin action is off
  // the same way). So the scroll is added back. It also refuses a point lower than the screen's
  // height, so a spot further down the page than one screen (window scrolling pages: the website
  // quote, the portal) cannot be touched at all: those taps fall back to the element's click(),
  // and the run lists them.
  const touch = async (x, y) => {
    await wd('POST', '/actions', { actions: [{ type: 'pointer', id: 'finger', parameters: { pointerType: 'touch' }, actions: [{ type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(x), y: Math.round(y) }, { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 60 }, { type: 'pointerUp', button: 0 }] }] })
    await wd('DELETE', '/actions').catch(() => {})
  }
  const where = () => wd('POST', '/execute/sync', { script: 'return [scrollX, scrollY, innerWidth, innerHeight]', args: [] })
  const tapAt = async (x, y) => {
    const [sx, sy, w, h] = await where()
    if (x + sx >= w - 1 || y + sy >= h - 1) throw new Error(`a touch at ${Math.round(x)},${Math.round(y)} is ${Math.round(y + sy)}px down the page: safaridriver cannot touch below ${h}`)
    await touch(x + sx, y + sy)
  }
  const fingerOn = async css => {
    const r = await wd('POST', '/execute/sync', { script: `const e = document.querySelector(arguments[0]); e.scrollIntoView({ block: 'center', inline: 'nearest' }); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }`, args: [css] })
    await sleep(250)
    const [sx, sy, w, h] = await where()
    if (r.x + sx < w - 1 && r.y + sy < h - 1) return touch(r.x + sx, r.y + sy)
    clickedNotTouched.add(css)
    await wd('POST', '/execute/sync', { script: 'document.querySelector(arguments[0]).focus?.(); document.querySelector(arguments[0]).click()', args: [css] })
  }
  return {
    name: 'safari', caps: s.capabilities,
    goto: url => wd('POST', '/url', { url }),
    // Safari's own reload (as pulling the page down or the reload button does).
    refresh: () => wd('POST', '/refresh', {}),
    crashes: () => 0, // a crashed Safari tab is reloaded by Safari itself: the reload area's page mark sees it
    exec: (script, args = []) => wd('POST', '/execute/sync', { script, args }),
    execAsync: (script, args = []) => wd('POST', '/execute/async', { script, args }),
    // A real tap: a finger (W3C touch actions) on the middle of the element, once it is
    // scrolled into view. In the iOS 18 Simulator the finger's lift is held back until the next
    // command (it shows as a long press that selects text), so the input state is released at
    // once. (WebDriver's Element Click sometimes never answered in the Simulator, so it is not used.)
    tap: async (css, ms) => { await must(css, ms); await fingerOn(css); await sleep(500) },
    // Typing: tap the field, send the keys; safaridriver in the Simulator delivers keydown,
    // keypress and keyup but iOS inserts no text (any input, any page), so when the field is
    // still empty the text is set the way the keyboard leaves it (value + input event).
    type: async (css, text) => {
      const id = await must(css)
      await fingerOn(css)
      await wd('POST', `/element/${id}/value`, { text }).catch(() => {}); await wd('DELETE', '/actions').catch(() => {})
      await sleep(150)
      const typed = await wd('POST', '/execute/sync', { script: `const e = document.querySelector(arguments[0]); if (e.value === arguments[1]) return true;
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e), 'value').set.call(e, arguments[1]); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return false`, args: [css, text] })
      if (!typed) typedBySetter.add(css)
    },
    // A finger on the screen at page (CSS pixel) coordinates.
    tapAt,
    // The file picker itself is iOS's own sheet: WebDriver hands the file to the input instead.
    setFiles: async (css, files) => { const id = await must(css); await wd('POST', `/element/${id}/value`, { text: files.join('\n') }) },
    addStaffCookie: value => wd('POST', '/cookie', { cookie: { name: 'ezbiz_staff', value, path: '/api', httpOnly: true, secure: false, sameSite: 'Strict' } }),
    clearCookies: () => wd('DELETE', '/cookie'),
    screenshot: async file => fs.writeFileSync(file, Buffer.from(await wd('GET', '/screenshot'), 'base64')),
    close: async () => { await wd('DELETE', '').catch(() => {}); proc.kill() },
  }
}

async function playwrightDriver(kind) {
  const pw = await import('playwright')
  const browser = await pw[kind].launch()
  const ctx = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, hasTouch: true, isMobile: kind === 'chromium', bypassCSP: true,
    userAgent: kind === 'webkit' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1' : undefined })
  let page
  let crashed = 0
  const fresh = async () => { await page?.close().catch(() => {}); page = await ctx.newPage(); page.on('dialog', d => d.accept().catch(() => {})); page.on('crash', () => { crashed++ }) }
  await fresh()
  const run = (script, args) => page.evaluate(([s, a]) => new Function(s).apply(null, a), [script, args])
  return {
    name: kind,
    // A long session on WebKit can crash its tab: go on in a new one (as payments.mjs does).
    goto: async url => { try { await page.goto(url) } catch (e) { if (!/crash|closed/i.test(e.message)) throw e; await fresh(); await page.goto(url) } },
    // A reload; a tab that crashed is counted (crashes()) and the reload goes on in a new tab.
    refresh: async () => { try { await page.reload() } catch (e) { if (!/crash|closed/i.test(e.message)) throw e; const url = page.url(); await fresh(); await page.goto(url) } },
    crashes: () => crashed,
    exec: run,
    execAsync: (script, args = []) => page.evaluate(([s, a]) => new Promise(res => new Function(s).apply(null, [...a, res])), [script, args]),
    tap: async (css, ms = 15000) => { const l = page.locator(css).first(); await l.waitFor({ state: 'attached', timeout: ms }); await l.scrollIntoViewIfNeeded().catch(() => {}); await l.tap({ timeout: ms }); await sleep(500) },
    type: (css, text) => page.locator(css).first().fill(text),
    tapAt: (x, y) => page.touchscreen.tap(x, y),
    setFiles: (css, files) => page.locator(css).first().setInputFiles(files),
    addStaffCookie: value => ctx.addCookies([{ name: 'ezbiz_staff', value, domain: 'localhost', path: '/api', httpOnly: true, secure: false, sameSite: 'Strict' }]),
    clearCookies: () => ctx.clearCookies(),
    screenshot: file => page.screenshot({ path: file }),
    close: () => browser.close(),
  }
}

// ── Small helpers on top of a driver ──
const has = css => D.exec('return !!document.querySelector(arguments[0])', [css])
const visible = css => D.exec(`const e = document.querySelector(arguments[0]); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none'`, [css])
const count = css => D.exec('return document.querySelectorAll(arguments[0]).length', [css])
const text = css => D.exec('const e = document.querySelector(arguments[0]); return e ? e.innerText : null', [css])
const attr = (css, a) => D.exec('const e = document.querySelector(arguments[0]); return e ? e.getAttribute(arguments[1]) : null', [css, a])
const waitFor = (css, ms = 20000) => until(() => visible(css), ms, 300)
async function go(url, sel, { tabbar = true } = {}) {
  await D.goto(`${APP}${url}`)
  if (tabbar) await waitFor('[data-tabbar]', 60000)
  if (sel) await waitFor(sel, 30000)
  await sleep(900)
  await D.exec(`document.querySelectorAll('[data-toast-close], [aria-label="Dismiss"]').forEach(b => b.click())`).catch(() => {})
}

// phone-fit.mjs's own checks, taken from its source so the two stay the same.
const PF = fs.readFileSync(path.join(HERE, 'phone-fit.mjs'), 'utf8')
const fnSrc = name => { const i = PF.indexOf(`function ${name}(`); const j = PF.indexOf('\n}\n', i); if (i < 0 || j < 0) throw new Error(`phone-fit.mjs has no ${name}()`); return PF.slice(i, j + 2) }
const AUDIT = `return (${fnSrc('audit')}).apply(null, arguments)`
const OVER_MAP = `return (${fnSrc('overlayOverMap')}).apply(null, arguments)`

async function judge(screen, opts = {}) {
  const a = await D.exec(AUDIT, [{ scope: opts.scope || null, bars: ['[data-tabbar]', '[data-customer-actions]', '[data-quote-bar]'], scroll: true }])
  if (a.missingScope) return check(`${screen}: opens`, false, `no ${opts.scope}`)
  const bad = [a.hscroll ? `${a.hscroll}px too wide` : '', ...a.off.slice(0, 3).map(x => 'off: ' + x), ...a.cut.slice(0, 3).map(x => 'cut: ' + x), ...a.covered.slice(0, 3).map(x => 'covered: ' + x), ...a.clipped.slice(0, 3).map(x => 'words cut: ' + x)].filter(Boolean)
  await check(`${screen}: fits (no sideways scroll; ${a.count} buttons on screen, none cut off or covered)`, bad.length === 0, bad.join(' | '))
}
async function overMap(screen, what, overlays, map = '.leaflet-container') {
  await sleep(500)
  const r = await D.exec(OVER_MAP, [{ overlays, map }])
  await check(`${screen}: ${what} is on top of the map${r.n ? ` (${r.n} points)` : ''}`, !r.error && r.bad.length === 0, r.error || r.bad.slice(0, 4).join(' | '))
}

// ── Test data (one customer for media, payments and the portal) ──
const stamp = Date.now().toString(36).slice(-6)
const WHO = `iPhone Safari ${stamp}`
const T = { contactId: crypto.randomUUID(), cardId: crypto.randomUUID(), quoteId: crypto.randomUUID(), jobId: null, email: `e2e-iphone-${stamp}@example.invalid`, sessions: [], tmp: fs.mkdtempSync(path.join(os.tmpdir(), 'iphone-safari-')) }
const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
let OWNER = process.env.E2E_ACCESS_TOKEN || ''
let COOKIE = ''
const startedAt = new Date().toISOString()
const call = async (method, p, body, auth = { Authorization: `Bearer ${OWNER}` }) => {
  const isForm = body instanceof FormData
  const r = await fetch(`${API}${p}`, { method, headers: { ...auth, 'X-Staff-Request': '1', ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : isForm ? body : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
function devSession(args) {
  const out = path.join(T.tmp, `s-${crypto.randomBytes(4).toString('hex')}`)
  execFileSync(path.join(PORTAL_DIR, 'node_modules/.bin/tsx'), ['scripts/dev-session-token.ts', ...args, '--days', '1', '--out', out], { cwd: PORTAL_DIR, stdio: 'ignore' })
  const v = fs.readFileSync(out, 'utf8').trim(); fs.rmSync(out)
  return v
}

async function setup() {
  if (!OWNER) { OWNER = devSession([]); T.sessions.push(JSON.parse(Buffer.from(OWNER.split('.')[1], 'base64url').toString()).sid) }
  COOKIE = devSession(['--cookie'])
  const c = await call('POST', '/api/crm-contacts', { id: T.contactId, firstName: 'E2E', lastName: WHO, phone: '3525550193', email: T.email, serviceAddress: '12 Receipt Rd, Ocala, FL 34470', leadSource: 'Other', tags: ['Test'],
    lead: { id: T.cardId, customerId: T.contactId, firstName: 'E2E', lastName: WHO, phone: '3525550193', stage: 'Signed Contract', leadSource: 'Other', quoteId: T.quoteId, createdAt: today, lastMoved: today }, leadBefore: null })
  const q = await call('POST', '/api/saved-quotes', {
    id: T.quoteId, crmContactId: T.contactId, customerName: `E2E ${WHO}`, customerPhone: '3525550193', customerEmail: T.email, customerAddress: '12 Receipt Rd, Ocala, FL 34470',
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [150], sections: 19, ends: 2, walkGates: 1, materialCost: 4000, laborCost: 2000, totalCOGS: 6000, finalPrice: 8914.27, gmPct: 0.33,
    pullSheet: [], status: 'SENT', date: today, salesRep: 'E2E Salesman', leadSource: 'Other',
    proposal: { version: 1, customer: { name: `E2E ${WHO}`, address: '12 Receipt Rd, Ocala, FL 34470' }, company: { name: 'Getter Done Fence', phone: '3527894314', email: '' }, footageFt: 150, gatesText: '1 walk gate', included: [], depositPct: 50,
      options: [{ label: 'White vinyl privacy', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 8914.27, perFoot: 59.43, sections: 19, snapshot: { materialCost: 4000, laborCost: 2000, tearOutCost: 0, totalCOGS: 6000, gmPct: 0.33, pullSheet: [], runSections: [19] } }] },
  })
  const sold = await call('PATCH', `/api/saved-quotes/${T.quoteId}`, { status: 'SOLD' })
  const j = await call('POST', '/api/saved-jobs', { quoteId: T.quoteId, crmContactId: T.contactId, customerName: `E2E ${WHO}`, customerPhone: '3525550193', customerEmail: T.email, customerAddress: '12 Receipt Rd, Ocala, FL 34470', fenceStyle: "WV-ND 6'x8' Privacy", quotePrice: 8914.27, contractValue: 8914.27, status: 'staging', sections: 19 })
  T.jobId = j.json.data?.id ?? null
  area = 'setup'
  await check('a test customer with a card, a sold quote and its job (dev API)', c.status < 300 && q.status < 300 && sold.status < 300 && !!T.jobId, `${c.status} ${q.status} ${sold.status} ${j.status}`)
}

async function signIn() {
  area = 'sign in'
  await D.goto(`${APP}/`)
  await sleep(1500)
  let how = 'cookie'
  try { await D.addStaffCookie(COOKIE) } catch (e) {
    // The old token, moved over to a cookie by the server, the way the app does it once.
    how = `token moved over (the cookie could not be set: ${String(e.message).slice(0, 80)})`
    await D.execAsync(`const done = arguments[arguments.length - 1]; fetch('/api/crm-auth/move-over', { method: 'POST', credentials: 'include', headers: { Authorization: 'Bearer ' + arguments[0], 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, body: '{}' }).then(r => done(r.status), e => done(String(e)))`, [OWNER])
  }
  await go('/today')
  const me = await D.execAsync(`const done = arguments[arguments.length - 1]; fetch('/api/crm-auth/me', { credentials: 'include' }).then(r => r.json()).then(j => done(j.data && j.data.email), e => done('ERR ' + e))`)
  const stored = await D.exec('return [Object.keys(localStorage), Object.keys(sessionStorage), document.cookie]')
  await check(`signed in by the HttpOnly cookie (${how}); the app opens on Today`, !!me && !/^ERR/.test(me) && await visible('[data-tabbar]'), String(me))
  await check('no sign in in browser storage or a script-readable cookie', !stored[0].some(k => /token|auth|session/i.test(k)) && !stored[1].some(k => /token|auth|session/i.test(k)) && !/ezbiz_staff/.test(stored[2]), JSON.stringify(stored).slice(0, 200))
}

// ── 1. Phone fit ──
async function fit() {
  area = 'fit'
  const vw = await D.exec('return [innerWidth, innerHeight, devicePixelRatio, navigator.userAgent]')
  console.log(`      viewport ${vw[0]} x ${vw[1]} @${vw[2]}x  ${vw[3]}`)
  await go('/today'); await judge('Today')
  await go('/pipeline', '[data-kanban-board]'); await judge('Sales Pipeline')
  await go(`/pipeline?card=${T.cardId}`, '[data-kanban-board]')
  if (await waitFor('[data-card-window]', 8000)) await judge('card window', { scope: '[data-card-window]' })
  else await check('card window opens', false)
  await go(`/customers/${T.contactId}`, '[data-customer-tab]'); await judge('customer')
  // The quote steps.
  if (await has('[data-customer-action="new-quote"]')) {
    await D.tap('[data-customer-action="new-quote"]')
    if (await waitFor('[data-quote-builder]', 20000)) {
      for (const step of ['customer', 'yard', 'style', 'price']) {
        await D.tap(`[data-quote-builder] [data-step="${step}"]`)
        await D.exec(`document.querySelector('[data-quote-builder]')?.scrollTo({ top: 0 })`)
        await judge(`quote step ${step}`, { scope: '[data-quote-builder]' })
      }
    } else await check('New quote opens the quote builder', false)
  } else await check('customer: New quote button', false)
  await go('/follow-ups'); await judge('Follow ups')
  await go('/schedule'); await judge('Schedule')
  await go('/inventory'); await judge('Inventory')
  await go('/settings', '[data-settings-tab]'); await judge('Settings')
  await go(`/operations?job=${T.jobId}`, `[data-payment-schedule="${T.jobId}"]`)
  await judge('job page', { scope: '[data-job-detail], div.fixed.inset-y-0.right-0.z-50, [data-bottom-sheet]' })
  // Menus, dropdowns and dialogs over the maps (each from a fresh load of the screen).
  for (const [screen, url, sel, prep] of [['Dispatch', '/dispatch', '[data-dispatch-map] .leaflet-container', null], ['Appointments map', '/appointments', '[data-view="map"]', '[data-view="map"]']]) {
    const open = async () => { await go(url, sel); if (prep) { await D.tap(prep); await waitFor('[data-day-map] .leaflet-container', 20000); await D.exec(`document.querySelector('[data-day-map]')?.scrollIntoView({ block: 'center' })`) } }
    await open()
    if (screen === 'Dispatch') await judge('Dispatch')
    await D.tap('[data-tabbar] [data-popup-trigger="nav-drawer"]')
    await overMap(screen, 'the side menu (More)', ['.mobile-nav-drawer.open'])
    await open()
    const n = await D.exec(`const t = [...document.querySelectorAll('[data-popup-trigger="notifications"]')].find(e => e.getBoundingClientRect().width > 0); if (t) t.setAttribute('data-e2e-trigger', ''); return !!t`)
    if (n) { await D.tap('[data-e2e-trigger]'); await overMap(screen, 'the notifications dropdown', ['[data-popup="notifications"]', '[data-popup-backdrop]']) }
    else await check(`${screen}: the notifications dropdown is there`, false)
    await open()
    const sbtn = await D.exec(`const t = [...document.querySelectorAll('[data-header-search]')].find(e => e.getBoundingClientRect().width > 0); if (t) t.setAttribute('data-e2e-search', ''); return !!t`)
    if (sbtn) { await D.tap('[data-e2e-search]'); await overMap(screen, 'the search dialog', ['div:has(> [data-global-search])']) }
    else await check(`${screen}: the search button is there`, false)
  }
}

// ── 2. Website quote (test mode) ──
async function quote() {
  area = 'quote'
  const NAME = `E2E iPhone Quote ${stamp}`
  const leads = () => Number(sql(`SELECT count(*) FROM "IntakeLead" WHERE name = ${lit(NAME)}`))
  await D.goto(`${APP}/p/quote/?test=1`)
  await waitFor('[data-w-address]', 30000)
  await check('the website quote opens in test mode', await visible('[data-w-test-banner]'))
  await D.tap('[data-w-address]')
  await D.type('[data-w-address]', '110 SE Watula')
  const sug = await waitFor('[data-w-suggestion]', 20000)
  await check('an address suggestion shows while typing', !!sug, String(await count('[data-w-suggestion]')) + ' suggestions')
  if (!sug) return
  await D.tap('[data-w-suggestion]')
  const map = '[data-w-map] .leaflet-container'
  await waitFor(map, 20000)
  const t0 = Date.now()
  const sharp = await until(async () => (await attr(map, 'data-aerial-state')) === 'sharp', 45000, 300)
  const visibleTiles = () => D.exec(`const box = document.querySelector(arguments[0]).getBoundingClientRect(); return [...document.querySelectorAll(arguments[0] + ' img.leaflet-tile')].filter(i => i.src.includes('/p/tiles/')).filter(i => { const r = i.getBoundingClientRect(); return r.right > box.left + 1 && r.left < box.right - 1 && r.bottom > box.top + 1 && r.top < box.bottom - 1 }).map(i => ({ ok: i.complete && i.naturalWidth > 0, src: i.dataset.aerialSource || '', w: i.naturalWidth }))`, [map])
  let tiles = []
  await until(async () => { tiles = await visibleTiles(); return tiles.length > 0 && tiles.every(t => t.ok) }, 20000, 500)
  await check(`the aerial photo loads sharp (data-aerial-state=sharp after ${sharp ? Date.now() - t0 : 'never'} ms; ${tiles.filter(t => t.ok).length} of ${tiles.length} visible tiles loaded)`, !!sharp && tiles.length > 0 && tiles.every(t => t.ok), `state ${await attr(map, 'data-aerial-state')}; sources ${[...new Set(tiles.map(t => t.src))].join(',')}`)
  await sleep(1500)
  // Fence points: taps of a finger on the photo.
  await D.exec(`document.querySelector(arguments[0]).scrollIntoView({ block: 'start' })`, [map]); await sleep(500)
  const box = await D.exec('const r = document.querySelector(arguments[0]).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }', [map])
  const c = { x: box.x + box.w / 2, y: box.y + box.h / 2 }
  for (const [dx, dy] of [[-40, 20], [-70, 20], [-70, -80], [70, -80], [70, 20], [40, 20]]) { await D.tapAt(c.x + dx, c.y + dy); await sleep(500) }
  const pts = await count('[data-w-point]')
  await check('six fence points tapped on the photo', pts === 6, `${pts} points`)
  await D.tap('[data-w-done]')
  await D.tap('[data-w-add-gate]')
  await D.exec(`document.querySelector(arguments[0]).scrollIntoView({ block: 'start' })`, [map]); await sleep(500)
  const box2 = await D.exec('const r = document.querySelector(arguments[0]).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }', [map])
  await D.tapAt(box2.x + box2.w / 2 - 70, box2.y + box2.h / 2 - 30); await sleep(500)
  if (await has('[data-w-gate-size="walk-4"]')) await D.tap('[data-w-gate-size="walk-4"]')
  await check('Done, then a gate tapped onto a side', (await count('[data-w-gate-mark]')) === 1, `${await count('[data-w-gate-mark]')} gates`)
  await D.tap('[data-w-step="draw"] [data-w-next]')
  await D.tap('[data-w-material="vinyl"]')
  await D.tap('[data-w-step="fence"] [data-w-next]')
  await D.type('[data-w-name]', NAME); await D.type('[data-w-phone]', '352-555-0100')
  await D.tap('[data-w-send]')
  const priced = await waitFor('[data-w-option]', 45000)
  const prices = await D.exec(`return [...document.querySelectorAll('[data-w-option]')].map(e => e.getAttribute('data-w-price'))`)
  await check('the price step shows prices', !!priced && prices.length > 0 && prices.every(p => Number(p) > 0), prices.join(', '))
  const h = await D.exec('return document.scrollingElement.scrollWidth - innerWidth')
  await check('the website quote has no sideways scroll', h <= 0, `${h}px`)
  await check('test mode made no lead', leads() === 0)
}

// ── 3. Photos: Choose from gallery ──
async function media() {
  area = 'media'
  if (!PHOTO || !VIDEO || !fs.existsSync(PHOTO) || !fs.existsSync(VIDEO)) return check('MEDIA_PHOTO and MEDIA_VIDEO are set to files', false)
  await go(`/customers/${T.contactId}`, '[data-customer-tab="photos"]')
  await D.tap('[data-customer-tab="photos"]')
  await waitFor('[data-media-pick]', 15000)
  let how = 'WebDriver handed the files to the input'
  try { await D.setFiles('[data-media-pick] input', [PHOTO, VIDEO]) } catch (e) {
    // safaridriver on iOS may not take files: hand the same bytes to the same input (a real
    // File list and a change event, as the iOS picker gives the page).
    how = `files put on the input in the page (WebDriver: ${String(e.message).slice(0, 90)})`
    const files = [PHOTO, VIDEO].map(f => ({ name: path.basename(f), type: f.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg', b64: fs.readFileSync(f).toString('base64'), at: fs.statSync(f).mtimeMs }))
    await D.exec(`const input = document.querySelector('[data-media-pick] input'); const dt = new DataTransfer();
      for (const f of arguments[0]) { const bin = atob(f.b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); dt.items.add(new File([u], f.name, { type: f.type, lastModified: f.at })) }
      input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }))`, [files])
  }
  await sleep(1000)
  if (await has('[data-pin-skip]')) await D.tap('[data-pin-skip]')
  const up = await until(async () => (await count('[data-media-item="uploaded"]')) >= 2, 60000, 1000)
  await check(`a photo and a video picked; both upload (${how})`, !!up, `${await count('[data-media-item="uploaded"]')} uploaded, ${await count('[data-media-item="waiting"]')} waiting`)
  const shown = await until(() => D.exec(`return [...document.querySelectorAll('[data-media-item] img')].some(i => i.complete && i.naturalWidth > 0)`), 20000)
  await check('the photo shows in the grid', !!shown)
  let list = []
  await until(async () => { list = (await call('GET', `/api/media?customerId=${T.contactId}`)).json.data ?? []; return list.length >= 2 }, 20000, 1000)
  await check('the server has both, on this customer', list.length === 2 && list.some(m => m.kind === 'photo') && list.some(m => m.kind === 'video'), list.map(m => `${m.kind}:${m.status}`).join(','))
  // Open the photo.
  const idx = await D.exec(`const a = [...document.querySelectorAll('[data-media-item]')]; const i = a.findIndex(b => b.querySelector('img') && !b.querySelector('svg.lucide-play')); if (i >= 0) a[i].setAttribute('data-e2e-photo', ''); return i`)
  if (idx >= 0) {
    await D.tap('[data-e2e-photo]')
    const big = await until(() => D.exec(`const i = document.querySelector('[data-media-viewer] [data-viewer-image]'); return !!i && i.complete && i.naturalWidth > 0`), 20000)
    await check('tapping it opens the photo full size', !!big)
    await D.exec(`[...document.querySelectorAll('[data-media-viewer] button')].find(b => b.innerText.trim() === 'Close')?.click()`)
  } else await check('a photo tile to open', false)
  const ready = await until(async () => ((await call('GET', `/api/media?customerId=${T.contactId}`)).json.data ?? []).every(m => m.status === 'ready'), 60000, 1500)
  await check('the video is processed on the Mac (ready)', !!ready)
}

// ── 4. Payment received and the receipt ──
async function payments() {
  area = 'payments'
  if (!T.jobId) return check('a test job to pay on', false)
  await go(`/operations?job=${T.jobId}`, `[data-payment-schedule="${T.jobId}"]`)
  const sched = `[data-payment-schedule="${T.jobId}"]`
  await until(() => D.exec(`return performance.getEntriesByType('resource').some(e => e.name.endsWith('/api/payments/receipt-numbers'))`), 15000)
  const dep = `${sched} [data-payment-received="deposit"]`
  await check('job page: Payment received on the deposit ($4,457.14)', /\$4,457\.14/.test(await text(dep) || ''), await text(dep) || 'missing')
  await D.tap(dep)
  await waitFor('[data-payment-sheet]', 10000)
  await check('the payment form opens filled in with the amount due', (await D.exec(`return document.querySelector('[data-payment-sheet] [data-payment-amount]')?.value`)) === '4457.14')
  await D.tap('[data-payment-sheet] [data-payment-method="check"]')
  await D.type('[data-payment-sheet] [data-payment-check-number]', '1042')
  await D.tap('[data-payment-sheet] [data-payment-save]')
  const shown = await waitFor('[data-receipt-screen]', 15000)
  const amt = await text('[data-receipt-screen] [data-receipt-amount]')
  await check('the receipt shows: amount, check number, balance', !!shown && amt === '$4,457.14' && /Check #1042/.test(await text('[data-receipt-screen] [data-receipt-method]') || '') && (await text('[data-receipt-screen] [data-receipt-balance]')) === '$4,457.13', `${amt} | ${await text('[data-receipt-screen] [data-receipt-method]')} | ${await text('[data-receipt-screen] [data-receipt-balance]')}`)
  const saved = await until(async () => (await attr('[data-receipt-screen] [data-receipt-status]', 'data-receipt-status')) === 'saved', 30000)
  await check('the receipt says Saved', !!saved, await attr('[data-receipt-screen] [data-receipt-status]', 'data-receipt-status') || '')
  const rows = sql(`SELECT number || '|' || token FROM "Receipt" WHERE "jobId" = ${lit(T.jobId)}`).split('\n').filter(Boolean)
  const shownNo = await attr('[data-receipt-screen] [data-receipt-number]', 'data-receipt-number')
  await check('saved once on the server, with the number shown', rows.length === 1 && rows[0].split('|')[0] === shownNo, `${rows.length} receipts; shown ${shownNo}`)
  await D.tap('[data-receipt-screen] [data-receipt-done]').catch(() => {})
  T.receiptToken = rows[0]?.split('|')[1]
  // The public link, signed out.
  await D.clearCookies()
  await D.goto(`${APP}/p/r/${T.receiptToken}`)
  await waitFor('[data-receipt-amount]', 20000)
  await check('the public receipt link opens with no sign in', (await attr('[data-receipt-amount]', 'data-receipt-amount')) === '445714' && (await attr('[data-receipt-number]', 'data-receipt-number')) === shownNo && !(await has('input[type="password"]')))
  const h = await D.exec('return document.scrollingElement.scrollWidth - innerWidth')
  await check('the public receipt fits the iPhone (no sideways scroll)', h <= 0, `${h}px`)
  // The page's own Download link (its CSP allows no fetch from the page, so the link is tapped).
  await D.tap('[data-receipt-pdf]')
  const onPdf = await until(() => D.exec('return location.pathname.endsWith(".pdf") ? (document.contentType || "?") : null'), 20000)
  const head = await fetch(`${API}/p/r/${T.receiptToken}.pdf`)
  const bytes = Buffer.from(await head.arrayBuffer()).subarray(0, 5).toString()
  await check('Download the receipt (PDF) opens the PDF in Safari', !!onPdf && /pdf|\?/.test(onPdf) && /application\/pdf/.test(head.headers.get('content-type') || '') && bytes === '%PDF-', `${onPdf} | ${head.headers.get('content-type')} ${bytes}`)
}

// ── 5. The customer portal ──
async function portal() {
  area = 'portal'
  await D.clearCookies()
  const fd = new FormData(); fd.append('label', `HOA approval ${stamp}`); fd.append('isVisibleToCustomer', 'true'); fd.append('file', new Blob([`%PDF-1.4 HOA approval ${stamp}`], { type: 'application/pdf' }), `HOA-approval-${stamp}.pdf`)
  const doc = await call('POST', `/api/portal/customer/${T.contactId}/documents`, fd)
  const inv = await call('POST', '/api/portal/invite', { crmCustomerId: T.contactId, email: T.email, firstName: 'E2E', lastName: WHO })
  const token = ((inv.json.data?.activationUrl || '').match(/token=([0-9a-f]{64})/) || [])[1]
  await check('the office invites the customer to the portal (no email sent on dev)', doc.status < 300 && !!token, `${doc.status} ${inv.status}`)
  if (!token) return
  const root = `${APP}/p/portal/`
  await D.goto(`${root}#/portal/activate?token=${token}`)
  await waitFor('input[type="password"]', 60000)
  const pwIds = await count('input[type="password"]')
  await D.exec(`document.querySelectorAll('input[type="password"]').forEach((e, i) => e.setAttribute('data-e2e-pw', String(i)))`)
  await D.type('[data-e2e-pw="0"]', 'e2e-iphone-pass-1')
  if (pwIds > 1) await D.type('[data-e2e-pw="1"]', 'e2e-iphone-pass-1')
  await D.tap('form button[type="submit"]')
  const dash = await until(() => D.exec(`return location.hash.startsWith('#/portal/dashboard')`), 30000)
  await check('the customer sets a password and lands on the dashboard', !!dash, await D.exec('return location.hash'))
  if (!dash) return
  const cookies = await D.exec('return document.cookie')
  await check('the portal sign in is not readable by scripts', !/ezbiz_portal/.test(cookies), cookies)
  const pages = {}
  for (const p of ['dashboard', 'invoices', 'documents', 'papers', 'photos']) {
    await D.goto(`${root}#/portal/${p}`)
    await until(() => D.exec(`return !document.querySelector('[data-portal-loading]') && !/Loading…/.test(document.querySelector('main')?.innerText || '')`), 20000)
    await sleep(800)
    pages[p] = await D.exec('return [document.scrollingElement.scrollWidth - innerWidth, document.body.innerText]')
    if (p === 'invoices') {
      await waitFor('[data-portal-receipt]', 15000)
      const href = await attr('[data-portal-receipt]', 'href')
      await check('Billing: the payment with its receipt link', !!href && href.endsWith(`/p/r/${T.receiptToken}`), href || 'no receipt link')
      await check('Billing: the balance after the deposit ($4,457.13)', /\$4,457\.13/.test(pages[p][1]), pages[p][1].replace(/\s+/g, ' ').slice(0, 200))
    }
    if (p === 'documents') await check('Documents: the shared document and the receipt', pages[p][1].includes(`HOA approval ${stamp}`) && /receipt/i.test(pages[p][1]), pages[p][1].replace(/\s+/g, ' ').slice(0, 200))
  }
  const wide = Object.entries(pages).filter(([, v]) => v[0] > 0).map(([k, v]) => `${k} ${v[0]}px`)
  await check(`the portal pages fit the iPhone (${Object.keys(pages).join(', ')})`, wide.length === 0, wide.join(', '))
  // Signed in again on the login page after signing out.
  await D.clearCookies()
  await D.goto(`${root}#/portal/login`)
  await waitFor('input[type="email"]', 30000)
  await D.type('input[type="email"]', T.email); await D.type('input[type="password"]', 'e2e-iphone-pass-1')
  await D.tap('form button[type="submit"]')
  await check('the customer signs in again on the login page', !!(await until(() => D.exec(`return location.hash.startsWith('#/portal/dashboard')`), 30000)))
  await D.clearCookies()
}

// ── 6. Add to Home Screen ──
async function home() {
  area = 'home'
  await D.clearCookies()
  await D.goto(`${APP}/`)
  await sleep(2500)
  const head = await D.exec(`const q = s => document.querySelector(s); const m = n => q('meta[name="' + n + '"]')?.content ?? null;
    return { manifest: q('link[rel="manifest"]')?.href ?? null, touch: q('link[rel="apple-touch-icon"]')?.href ?? null, capable: m('apple-mobile-web-app-capable'), mcapable: m('mobile-web-app-capable'), bar: m('apple-mobile-web-app-status-bar-style'), title: m('apple-mobile-web-app-title'), theme: m('theme-color'), viewport: m('viewport'),
      standalone: navigator.standalone, hasStandalone: 'standalone' in navigator, displayMode: matchMedia('(display-mode: standalone)').matches, sw: 'serviceWorker' in navigator }`)
  await check('apple-mobile-web-app tags: capable=yes, a status bar style, a title; theme-color; viewport-fit=cover',
    head.capable === 'yes' && ['default', 'black', 'black-translucent'].includes(head.bar) && !!head.title && !!head.theme && /viewport-fit=cover/.test(head.viewport || ''), JSON.stringify({ capable: head.capable, bar: head.bar, title: head.title, theme: head.theme, viewport: head.viewport }))
  const img = async url => D.execAsync(`const done = arguments[arguments.length - 1]; const i = new Image(); i.onload = () => done([i.naturalWidth, i.naturalHeight]); i.onerror = () => done(null); i.src = arguments[0]`, [url])
  const touch = head.touch ? await img(head.touch) : null
  await check('apple-touch-icon loads, 180 x 180', !!touch && touch[0] === 180 && touch[1] === 180, `${head.touch} ${JSON.stringify(touch)}`)
  const man = head.manifest ? await D.execAsync(`const done = arguments[arguments.length - 1]; fetch(arguments[0]).then(async r => done({ status: r.status, type: r.headers.get('content-type'), body: await r.text() }), e => done({ error: String(e) }))`, [head.manifest]) : null
  let m = null
  try { m = JSON.parse(man?.body || 'null') } catch { /* not JSON */ }
  await check('the web app manifest is linked and valid JSON (name, short_name, start_url, scope, display standalone)', man?.status === 200 && !!m && !!m.name && !!m.short_name && !!m.start_url && m.display === 'standalone', `${man?.status} ${man?.type} ${m ? JSON.stringify({ name: m.name, short_name: m.short_name, start_url: m.start_url, scope: m.scope, display: m.display }) : ''}`)
  await check('the manifest is served as application/manifest+json or JSON', /json/.test(man?.type || ''), man?.type || '')
  const icons = []
  for (const ic of m?.icons ?? []) { const sz = await img(new URL(ic.src, head.manifest).href); icons.push(`${ic.src} ${ic.sizes} ${ic.purpose || 'any'}: ${sz ? sz.join('x') : 'FAILED'}`); ic.ok = !!sz && `${sz[0]}x${sz[1]}` === ic.sizes }
  await check('the manifest icons load at their stated sizes (192, 512, a maskable one)', (m?.icons ?? []).length > 0 && m.icons.every(i => i.ok) && m.icons.some(i => i.sizes === '192x192') && m.icons.some(i => i.sizes === '512x512') && m.icons.some(i => /maskable/.test(i.purpose || '')), icons.join(' | '))
  const start = new URL(m?.start_url || '/', head.manifest || APP).href
  await D.goto(start)
  const opened = await until(() => D.exec(`return !!document.querySelector('[data-tabbar], input[type="email"], form')`), 30000)
  await check(`the start URL (${start}) opens the app (its sign in, when signed out)`, !!opened)
  const sw = await D.execAsync(`const done = arguments[arguments.length - 1]; if (!('serviceWorker' in navigator)) return done('none'); navigator.serviceWorker.getRegistration().then(r => done(r ? (r.active ? 'active ' : '') + (r.active?.scriptURL || r.installing?.scriptURL || r.waiting?.scriptURL || '') : 'no registration'), e => done(String(e)))`)
  console.log(`      service worker: ${sw}`)
  if (DRIVER === 'safari') {
    await check('in a Safari tab: navigator.standalone exists and is false, display-mode is not standalone (the app treats it as a browser tab)', head.hasStandalone && head.standalone === false && head.displayMode === false, JSON.stringify({ standalone: head.standalone, displayMode: head.displayMode }))
  }
}

// ── 7. Reload and new addresses while signed in (walkthrough round 2, item 2) ──
// The Simulator's Safari page processes (WebContent) as the Mac sees them: their memory, in MB.
function simPageMemory() {
  if (DRIVER !== 'safari') return null
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,rss=,command=']).toString().split('\n')
      .filter(l => /CoreSimulator/.test(l) && /com\.apple\.WebKit\.WebContent/.test(l))
      .map(l => { const [pid, rss] = l.trim().split(/\s+/); return { pid: Number(pid), mb: Math.round(Number(rss) / 1024) } })
    return rows
  } catch { return null }
}
const memText = rows => rows ? (rows.length ? rows.map(r => `${r.mb} MB (pid ${r.pid})`).join(', ') : 'none running') : 'n/a'

// What the page loaded: files and API answers (bytes as received, and as unpacked), the biggest answers.
const LOAD_STATS = `const all = performance.getEntriesByType('resource'); const nav = performance.getEntriesByType('navigation')[0];
  const kb = n => Math.round(n / 1024);
  const api = all.filter(e => /\\/api\\//.test(e.name));
  const sum = (l, k) => l.reduce((t, e) => t + (e[k] || 0), 0);
  const big = api.slice().sort((a, b) => (b.decodedBodySize || 0) - (a.decodedBodySize || 0)).slice(0, 4).map(e => kb(e.decodedBodySize || 0) + ' KB ' + e.name.replace(location.origin, '').split('?')[0]);
  return { files: all.length - api.length, filesKb: kb(sum(all.filter(e => !/\\/api\\//.test(e.name)), 'decodedBodySize') + (nav ? nav.decodedBodySize || 0 : 0)), apis: api.length, apiKb: kb(sum(api, 'decodedBodySize')), apiWireKb: kb(sum(api, 'encodedBodySize')), big, nodes: document.getElementsByTagName('*').length, heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }`

async function reloads() {
  area = 'reload'
  const screens = who => [
    ['Today', '/today', '[data-today]'],
    ['Pipeline', '/pipeline', '[data-kanban-board]'],
    ['a customer', `/customers/${T.contactId}`, '[data-customer-tab]'],
    ['a quote', `/quotes?quote=${T.quoteId}`, '[data-quote-builder]'],
    // A Salesman has no Schedule: the app shows its own "no access" words there, which must show as well.
    ['Schedule', '/schedule', who === 'owner' ? '[data-schedule-tabs]' : '[data-schedule-tabs], [data-no-access], main'],
  ]
  // Shown = the tab bar and the screen's own mark; then a mark is left on the page and must still be there
  // 2.5 s later (Safari reloads a tab whose page process crashed, which would wipe it).
  const shown = async sel => {
    const ok = await waitFor('[data-tabbar]', 60000) && await waitFor(sel, 30000)
    if (!ok) return 'not shown'
    const mark = Math.random().toString(36).slice(2)
    await D.exec('window.__e2eMark = arguments[0]', [mark])
    await sleep(2500)
    const still = await D.exec('return window.__e2eMark || null').catch(e => `driver: ${String(e.message).slice(0, 80)}`)
    return still === mark ? '' : `the page was reloaded by itself (crash?) ${still ?? ''}`
  }
  for (const who of ['owner', 'christa']) {
    if (who === 'christa') {
      // Signed out of the owner, then WT Christa signs in the way the app does (the HttpOnly cookie from the server).
      await D.clearCookies()
      await D.goto(`${APP}/`); await sleep(1500)
      const st = await D.execAsync(`const done = arguments[arguments.length - 1]; fetch('/api/crm-auth/login', { method: 'POST', credentials: 'include', headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'wt-christa@example.invalid', password: 'WT-walk-2026!', cookie: true }) }).then(r => done(r.status), e => done(String(e)))`)
      await check('WT Christa signs in (Salesman)', st === 200, String(st))
      if (st !== 200) continue
    }
    const before = simPageMemory()
    const crashesBefore = D.crashes()
    for (const [name, url, sel] of screens(who)) {
      const t0 = Date.now()
      await D.goto(`${APP}${url}`)
      const first = await shown(sel)
      const stats = await D.exec(LOAD_STATS).catch(() => null)
      await check(`${who}: ${name} opens by its address while signed in`, !first, `${Date.now() - t0} ms${first ? ' ' + first : ''}${stats ? ` | ${stats.files} files ${stats.filesKb} KB, ${stats.apis} API answers ${stats.apiKb} KB (${stats.apiWireKb} KB sent), ${stats.nodes} elements${stats.heapMb != null ? `, JS heap ${stats.heapMb} MB` : ''} | biggest: ${stats.big.join('; ')}` : ''}`)
      const times = [], bad = []
      for (let i = 1; i <= RELOADS; i++) {
        const t = Date.now()
        try { await D.refresh(); const why = await shown(sel); if (why) bad.push(`#${i} ${why}`); times.push(Date.now() - t - 2500) } catch (e) { bad.push(`#${i} ${String(e.message).split('\n')[0].slice(0, 160)}`) }
      }
      await check(`${who}: ${name} reloaded ${RELOADS} times, shown every time, no crash`, bad.length === 0, `${times.map(t => `${(t / 1000).toFixed(1)}s`).join(' ')}${bad.length ? ' | ' + bad.join(' | ') : ''}`)
    }
    const after = simPageMemory()
    await check(`${who}: no page crashed (${DRIVER})`, D.crashes() === crashesBefore, `${D.crashes() - crashesBefore} crashes`)
    if (after) console.log(`      Safari page process memory (Simulator, ${who}): before ${memText(before)}; after ${memText(after)}`)
  }
}

// ── Remove what this made (dev database only, named on every command) ──
async function cleanup() {
  area = 'cleanup'
  const step = async (name, fn) => { try { await fn() } catch (e) { console.log(`      clean up: ${name} failed -- ${String(e?.message || e).split('\n')[0]}`) } }
  if (OWNER) await step('media', async () => { for (const m of (await call('GET', `/api/media?customerId=${T.contactId}`)).json.data ?? []) await call('DELETE', `/api/media/${m.id}`) })
  const jl = T.jobId && /^[A-Za-z0-9-]+$/.test(T.jobId) ? lit(T.jobId) : "'-'"
  await step('receipt files', async () => {
    for (const k of sql(`SELECT "fileKey" FROM "PortalFile" WHERE "crmCustomerId" = ${lit(T.contactId)}`).split('\n').filter(Boolean)) fs.rmSync(path.join(PORTAL_DIR, 'uploads', k), { force: true })
    fs.rmSync(path.join(PORTAL_DIR, 'uploads/portal', T.contactId), { recursive: true, force: true })
  })
  await step('rows', async () => sql(`BEGIN;
    DELETE FROM "CrmAuditLog" WHERE "entityId" IN (${jl}, ${lit(T.quoteId)}, ${lit(T.contactId)}) OR "entityId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" = ${jl}) OR "entityId" IN (SELECT id FROM "Receipt" WHERE "jobId" = ${jl});
    DELETE FROM "PaymentApplication" WHERE "paymentId" IN (SELECT id FROM "ContractPayment" WHERE "jobId" = ${jl});
    DELETE FROM "Receipt" WHERE "jobId" = ${jl};
    DELETE FROM "ContractPayment" WHERE "jobId" = ${jl};
    DELETE FROM "ContractAdjustment" WHERE "jobId" = ${jl};
    DELETE FROM "ContractInvoice" WHERE "jobId" = ${jl};
    DELETE FROM "BillingLog" WHERE "jobId" = ${jl};
    DELETE FROM "PaymentSchedule" WHERE "jobId" = ${jl};
    DELETE FROM "JobQuotedCost" WHERE "quoteId" = ${lit(T.quoteId)};
    DELETE FROM "AutomationEvent" WHERE "entityId" IN (${jl}, ${lit(T.quoteId)}, ${lit(T.cardId)}, ${lit(T.contactId)});
    DELETE FROM "JobChecklistItem" WHERE "jobId" = ${jl};
    DELETE FROM "SavedJob" WHERE id = ${jl};
    DELETE FROM "SavedQuote" WHERE id = ${lit(T.quoteId)} OR "crmContactId" = ${lit(T.contactId)};
    DELETE FROM "MediaItem" WHERE "customerId" = ${lit(T.contactId)};
    DELETE FROM "PortalPhoto" WHERE "crmCustomerId" = ${lit(T.contactId)};
    DELETE FROM "PortalFile" WHERE "crmCustomerId" = ${lit(T.contactId)};
    DELETE FROM "PortalMessage" WHERE "crmCustomerId" = ${lit(T.contactId)};
    DELETE FROM "PortalAccount" WHERE "crmCustomerId" = ${lit(T.contactId)};
    DELETE FROM "Notification" WHERE body LIKE ${lit('%' + T.email + '%')} OR body LIKE ${lit('%' + WHO + '%')};
    DELETE FROM "CrmContactNote" WHERE "crmContactId" = ${lit(T.contactId)};
    COMMIT;`))
  if (OWNER) await step('card', async () => {
    for (let i = 0; i < 3; i++) {
      const pl = (await call('GET', '/api/pipeline')).json
      const mine = (pl?.data?.leads ?? []).filter(l => l.customerId === T.contactId || l.id === T.cardId).map(l => l.id)
      if (!mine.length) break
      if ((await call('PATCH', '/api/pipeline', { upsert: [], remove: mine, baseVersion: pl.data.version })).status === 200) break
    }
  })
  if (OWNER) await step('contact (API)', () => call('DELETE', `/api/crm-contacts/${T.contactId}`))
  await step('contact', async () => sql(`DELETE FROM "CrmContact" WHERE id = ${lit(T.contactId)}`))
  await step('sign ins', async () => {
    const ids = T.sessions.filter(s => /^[0-9a-f-]{36}$/i.test(s))
    if (ids.length) sql(`DELETE FROM "CrmUserSession" WHERE id IN (${ids.map(lit).join(',')})`)
    sql(`DELETE FROM "CrmUserSession" WHERE "userAgent" = 'dev-session-token --cookie (browser tests)' AND "createdAt" >= ${lit(startedAt)}`)
    // WT Christa's sign in from the reload area (this run's iPhone browser).
    if (AREAS.includes('reload')) sql(`DELETE FROM "CrmUserSession" WHERE "userId" = (SELECT id FROM "CrmUser" WHERE email = 'wt-christa@example.invalid') AND "createdAt" >= ${lit(startedAt)} AND "userAgent" LIKE '%iPhone%'`)
  })
  fs.rmSync(T.tmp, { recursive: true, force: true })
  const left = Number(sql(`SELECT (SELECT count(*) FROM "CrmContact" WHERE id = ${lit(T.contactId)}) + (SELECT count(*) FROM "SavedQuote" WHERE "crmContactId" = ${lit(T.contactId)}) + (SELECT count(*) FROM "SavedJob" WHERE id = ${jl}) + (SELECT count(*) FROM "Receipt" WHERE "jobId" = ${jl}) + (SELECT count(*) FROM "ContractPayment" WHERE "jobId" = ${jl}) + (SELECT count(*) FROM "MediaItem" WHERE "customerId" = ${lit(T.contactId)}) + (SELECT count(*) FROM "PortalAccount" WHERE "crmCustomerId" = ${lit(T.contactId)}) + (SELECT count(*) FROM "IntakeLead" WHERE name LIKE ${lit('E2E iPhone Quote ' + stamp)})`))
  const folder = fs.existsSync(path.join(PORTAL_DIR, 'uploads/portal', T.contactId))
  D = null // no screenshot for clean up
  await check('cleaned up (customer, card, quote, job, payments, receipt, media, portal login, documents, sign ins)', left === 0 && !folder, `${left} rows left, folder ${folder}`)
}

try {
  await setup()
  area = 'driver'
  try { D = DRIVER === 'safari' ? await safariDriver() : await playwrightDriver(DRIVER) } catch (e) { await check(`${DRIVER} starts`, false, String(e.message || e).slice(0, 600)); throw e }
  if (D.caps) console.log(`      safaridriver session: ${D.caps.browserName} ${D.caps.browserVersion || ''} on ${D.caps.platformName} ${D.caps['safari:platformVersion'] || ''} ${D.caps['safari:deviceName'] || ''}`)
  const run = async (name, fn) => {
    if (!AREAS.includes(name)) return
    area = name
    try { await fn() } catch (e) { await check('ran to the end', false, String(e?.message || e).split('\n')[0].slice(0, 300)) }
  }
  if (['fit', 'media', 'payments', 'reload'].some(a => AREAS.includes(a))) await signIn()
  await run('fit', fit)
  await run('media', media)
  await run('payments', payments)
  await run('portal', portal)
  await run('quote', quote)
  await run('home', home)
  // Last: it signs the owner out and WT Christa in.
  await run('reload', reloads)
} catch (e) {
  if (!results.some(r => !r.ok)) await check('ran', false, String(e?.message || e).split('\n')[0])
} finally {
  if (D) await D.close().catch(() => {})
  D = null
  await cleanup()
  const byArea = {}
  for (const r of results) { byArea[r.area] ??= [0, 0]; byArea[r.area][r.ok ? 0 : 1]++ }
  console.log('\n' + Object.entries(byArea).map(([a, [p, f]]) => `${a}: ${p} passed, ${f} failed`).join('\n'))
  const failed = results.filter(r => !r.ok).length
  if (clickedNotTouched.size) console.log(`\nnote: below the first screen of a scrolling page, safaridriver cannot touch; clicked instead: ${[...clickedNotTouched].join(', ')}`)
  if (typedBySetter.size) console.log(`\nnote: safaridriver's keys inserted no text in the Simulator; set as typed: ${[...typedBySetter].join(', ')}`)
  console.log(`\n${results.length - failed} of ${results.length} checks passed (${DRIVER})`)
  process.exit(failed ? 1 : 0)
}
