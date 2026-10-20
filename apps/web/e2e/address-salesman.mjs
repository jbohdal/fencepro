// A salesman adds customers by address on a phone, on the dev copy.
//
//   cd apps/web && pnpm -s build
//   WebKit (as on an iPhone):
//     APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> SHOTS=<folder> node e2e/address-salesman.mjs
//   The Android emulator's Chrome (its real keyboard and touch):
//     adb reverse tcp:4001 tcp:4001; adb forward tcp:9333 localabstract:chrome_devtools_remote
//     CDP_URL=http://localhost:9333 ... node e2e/address-salesman.mjs
//
//   1. A Salesman login is made the real way (invite, then accept).
//   2. New customer: types a Marion County address (Android: the phone's own
//      key input through adb; the DevTools IME emulation is unreliable on the
//      emulator even in a plain box, so it is not used), the suggestions show
//      above the keyboard, a tap
//      picks one, Save. The server has street, city, state and ZIP.
//   3. The lookup fails (blocked): the box says "No suggestions, type the full
//      address", keeps what was typed, and the saved customer still gets its
//      city, state and ZIP (read from the typed address).
//   4. Pipeline, New Lead: typed, picked, Add: city, state and ZIP saved.
//   5. The website instant quote: suggestions and the same message on failure.
// Dev only (port 4001). Removes the login and everything it made.
import { webkit, chromium } from 'playwright'
import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'

const APP = process.env.APP_URL || 'http://localhost:4001'
const API = process.env.API_URL || 'http://localhost:4001'
const OWNER = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const CDP = process.env.CDP_URL || ''
const NAME = CDP ? 'android' : 'webkit'
const ADB = `${process.env.ANDROID_SDK_ROOT || `${process.env.HOME}/Library/Android/sdk`}/platform-tools/adb`
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1):4001(\/|$)/.test(u)
if (!local(APP) || !local(API)) { console.error('Refusing to run: the dev copy only (localhost:4001).'); process.exit(2) }
if (!OWNER) { console.error('Set E2E_ACCESS_TOKEN (an owner login on the dev server).'); process.exit(2) }
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [${NAME}] ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (token, method, p, body) => {
  const r = await fetch(`${API}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, json: await r.json().catch(() => ({})) }
}
const owner = (m, p, b) => call(OWNER, m, p, b)
async function until(fn, ms = 20000) {
  const end = Date.now() + ms
  let v = await fn()
  while (!v && Date.now() < end) { await sleep(500); v = await fn() }
  return v
}

const stamp = Date.now().toString(36).slice(-6)
const EMAIL = `e2e-address-${stamp}@example.test`
const LAST = `Address ${NAME} ${stamp}`
const made = { contacts: [] }
const errors = []
let browser, ctx, page

/** The contact this run saved under that first name, with its address parts. */
const contactNamed = first => until(async () => ((await owner('GET', '/api/crm-contacts')).json.data ?? []).find(c => c.lastName === LAST && c.firstName === first && c.serviceAddress))

try {
  // ── 1. A salesman login: the invite, then the accept ──
  const inv = await owner('POST', '/api/crm-auth/invite', { firstName: 'E2E', lastName: `Address ${stamp}`, email: EMAIL, role: 'sales_rep' })
  const link = new URL(inv.json.data?.inviteUrl ?? 'http://x/')
  const acc = await call('', 'POST', '/api/crm-auth/accept-invite', { token: link.searchParams.get('token'), email: EMAIL, password: `Ad-${crypto.randomBytes(9).toString('base64url')}` })
  const TOKEN = acc.json.data?.accessToken
  check('a Salesman login, from an invite', inv.status === 201 && acc.json.data?.user?.role === 'sales_rep' && !!TOKEN, `${inv.status} ${acc.json.data?.user?.role}`)

  browser = CDP ? await chromium.connectOverCDP(CDP) : await webkit.launch()
  ctx = CDP ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true })
  if (CDP) {
    const p0 = await ctx.newPage(); await p0.goto(APP)
    await p0.evaluate(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN); await p0.close()
  } else await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  page = await ctx.newPage()
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  // A new customer runs automations; the dev data holds real customers, so not here.
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":{"matched":0}}' }))
  const cdp = CDP ? await ctx.newCDPSession(page) : null
  const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

  /** A finger's tap: the emulator's touch input, or WebKit's. */
  const tap = async loc => {
    await loc.scrollIntoViewIfNeeded(); await loc.waitFor({ state: 'visible' })
    if (!cdp) { await loc.tap(); return }
    // Touch points are on the visible part of the page (above the keyboard), not the whole layout.
    const b = await loc.evaluate(el => { const r = el.getBoundingClientRect(), vv = window.visualViewport; return { x: r.x + r.width / 2 - (vv?.offsetLeft ?? 0), y: r.y + r.height / 2 - (vv?.offsetTop ?? 0) } })
    const { x, y } = b
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    await sleep(60)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await sleep(300)
  }
  /** A tap into a box; again while the keyboard was still moving the page under the finger. */
  const tapInto = async loc => {
    for (let i = 0; i < 4; i++) {
      await tap(loc); await sleep(600)
      if (await loc.evaluate(el => el === document.activeElement)) return
    }
    throw new Error('could not tap into the box')
  }
  /** Typing on the phone's keyboard: Android key input through adb, or WebKit's keyboard. */
  const typeKeys = async (loc, text) => {
    await tapInto(loc)
    if (CDP) execFileSync(ADB, ['shell', 'input', 'text', text.replace(/ /g, '%s')])
    else await page.keyboard.type(text, { delay: 40 })
    await sleep(400)
  }
  /** The list fits in what is visible above the keyboard. */
  const inView = loc => loc.evaluate(el => {
    const r = el.getBoundingClientRect(), vv = window.visualViewport
    const top = vv ? vv.offsetTop : 0, bottom = vv ? vv.offsetTop + vv.height : innerHeight
    return r.top >= top - 1 && r.bottom <= bottom + 1
  })

  // ── 2. New customer: type, pick, save ──
  await page.goto(`${APP}/customers/new`, { waitUntil: 'domcontentloaded' })
  const addr = page.locator('[data-customer-field="address"]')
  await addr.waitFor({ timeout: 60000 }); await sleep(800)
  await page.locator('[data-customer-field="first-name"]').fill('Picked')
  await page.locator('[data-customer-field="last-name"]').fill(LAST)
  await typeKeys(addr, '1301 SE Silver')
  check('typing on the phone keyboard puts the text in the box', (await addr.inputValue()) === '1301 SE Silver', await addr.inputValue())
  const sugg = page.locator('[data-address-suggestion]')
  await sugg.first().waitFor({ timeout: 10000 }).catch(() => {})
  const shown = await sugg.allTextContents()
  check('suggestions show as the address is typed', /1301 SE Silver Springs Pl/.test(shown[0] ?? ''), shown.slice(0, 2).join(' | '))
  check('the suggestions are above the keyboard, where they can be seen', await inView(page.locator('[data-address-suggestions]')).catch(() => false))
  await shot(`dev-address-${NAME}-suggestions`)
  await tap(sugg.first())
  check('one tap picks it: the full address is in the box', (await addr.inputValue()) === '1301 SE Silver Springs Pl, Ocala, FL 34471', await addr.inputValue())
  await tap(page.locator('[data-customer-save]'))
  const c1 = await contactNamed('Picked')
  if (c1) made.contacts.push(c1.id)
  check('saved: street, city, state and ZIP', c1?.serviceAddress === '1301 SE Silver Springs Pl, Ocala, FL 34471' && c1?.city === 'Ocala' && c1?.state === 'FL' && c1?.zip === '34471', JSON.stringify(c1 && { a: c1.serviceAddress, city: c1.city, state: c1.state, zip: c1.zip }))
  await sleep(1500)
  await page.getByText('1301 SE Silver Springs Pl').first().scrollIntoViewIfNeeded().catch(() => {})
  await shot(`dev-address-${NAME}-saved`)

  // ── 3. The lookup fails: the box says so and takes the typed address ──
  await page.route('**/api/appointments/geo/suggest**', r => r.abort())
  await page.goto(`${APP}/customers/new`, { waitUntil: 'domcontentloaded' })
  await addr.waitFor({ timeout: 60000 }); await sleep(800)
  await page.locator('[data-customer-field="first-name"]').fill('Typed')
  await page.locator('[data-customer-field="last-name"]').fill(LAST)
  await typeKeys(addr, '99999 Nowhere Ln, Ocala, FL 34471')
  const msg = page.locator('[data-address-message]')
  const told = await msg.waitFor({ timeout: 10000 }).then(() => true, () => false)
  check('lookup failed: says "No suggestions, type the full address"', told && (await msg.textContent()) === 'No suggestions, type the full address', told ? await msg.textContent() : 'no message')
  check('lookup failed: what was typed is kept', (await addr.inputValue()) === '99999 Nowhere Ln, Ocala, FL 34471', await addr.inputValue())
  await shot(`dev-address-${NAME}-no-suggestions`)
  await tap(page.locator('[data-customer-save]'))
  const c2 = await contactNamed('Typed')
  if (c2) made.contacts.push(c2.id)
  check('typed by hand: city, state and ZIP read from the address', c2?.city === 'Ocala' && c2?.state === 'FL' && c2?.zip === '34471', JSON.stringify(c2 && { city: c2.city, state: c2.state, zip: c2.zip }))
  await page.unroute('**/api/appointments/geo/suggest**')

  // ── 4. Pipeline, New Lead: composed typing, pick, Add ──
  await page.goto(`${APP}/pipeline`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-tabbar]', { timeout: 60000 }); await sleep(1200)
  await tap(page.locator('button[aria-label="New Lead"]'))
  await page.locator('[data-lead-field="first-name"]').fill('Lead')
  await page.locator('[data-lead-field="last-name"]').fill(LAST)
  const street = page.locator('[data-lead-field="street"]')
  await typeKeys(street, '17008 SE 60')
  await sugg.first().waitFor({ timeout: 10000 }).catch(() => {})
  const leadShown = await sugg.allTextContents()
  check('New Lead: suggestions as the street is typed', /17008 SE 60th St/.test(leadShown[0] ?? ''), leadShown.slice(0, 2).join(' | ') || await street.inputValue())
  await tap(sugg.first())
  const all = await page.evaluate(() => [...document.querySelectorAll('input')].map(i => i.value))
  check('New Lead: one tap fills street, city, state and ZIP', (await street.inputValue()) === '17008 SE 60th St' && all.includes('Ocklawaha') && all.includes('FL') && all.includes('32179'))
  await tap(page.locator('[data-lead-add]'))
  const c3 = await contactNamed('Lead')
  if (c3) made.contacts.push(c3.id)
  check('New Lead saved: street, city, state and ZIP', c3?.serviceAddress === '17008 SE 60th St, Ocklawaha, FL 32179' && c3?.city === 'Ocklawaha' && c3?.state === 'FL' && c3?.zip === '32179', JSON.stringify(c3 && { a: c3.serviceAddress, city: c3.city, state: c3.state, zip: c3.zip }))

  // ── 5. The website instant quote ──
  await page.goto(`${APP}/p/quote/`, { waitUntil: 'domcontentloaded' })
  const w = page.locator('[data-w-address]')
  await w.waitFor({ timeout: 30000 })
  await typeKeys(w, '3995 NE 58')
  const ws = page.locator('[data-w-suggestion]')
  await ws.first().waitFor({ timeout: 10000 }).catch(() => {})
  check('instant quote: suggestions as the customer types', /3995 NE 58th Cir/.test((await ws.allTextContents())[0] ?? ''))
  await tap(ws.first())
  check('instant quote: picked, the full address is in the box', (await w.inputValue()) === '3995 NE 58th Cir, Silver Springs, FL 34488', await w.inputValue())
  // WebKit: the app's service worker fetches for the page and steps around the block, so it is
  // taken off in this throwaway browser. Never on the shared emulator (its push sign up lives there).
  if (!CDP) await page.evaluate(() => navigator.serviceWorker?.getRegistrations().then(rs => Promise.all(rs.map(r => r.unregister()))))
  await page.route('**/p/quote/api/suggest**', r => r.abort())
  await page.goto(`${APP}/p/quote/`, { waitUntil: 'domcontentloaded' })
  await w.waitFor({ timeout: 30000 })
  // Not a query asked before (the browser would answer it from its cache).
  await typeKeys(w, '3995 NE 58th')
  const wm = await page.locator('[data-w-address-message]').waitFor({ timeout: 10000 }).then(() => true, () => false)
  check('instant quote, lookup failed: says "No suggestions, type the full address"', wm && (await w.inputValue()) === '3995 NE 58th', `${wm} ${await w.inputValue()}`)
  await shot(`dev-address-${NAME}-widget-no-suggestions`)
  check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} catch (err) {
  check('ran to the end', false, String(err?.message ?? err).split('\n').slice(0, 3).join(' '))
} finally {
  // ── Clean up: the cards, the customers, their activity lines, the login ──
  const pipe = (await owner('GET', '/api/pipeline')).json.data
  const cards = (pipe?.leads ?? []).filter(l => made.contacts.includes(l.customerId) || (l.lastName === LAST)).map(l => l.id)
  for (let i = 0; i < 3 && cards.length; i++) {
    const v = (await owner('GET', '/api/pipeline')).json.data?.version
    if ((await owner('PATCH', '/api/pipeline', { upsert: [], remove: cards, baseVersion: v })).status === 200) break
  }
  const left = ((await owner('GET', '/api/crm-contacts')).json.data ?? []).filter(c => c.lastName === LAST)
  for (const id of new Set([...made.contacts, ...left.map(c => c.id)])) await owner('DELETE', `/api/crm-contacts/${id}`).catch(() => {})
  const kv = (await owner('GET', '/api/kv')).json
  const acts = kv.data?.fencepro_customer_activity
  const ids = new Set([...made.contacts, ...left.map(c => c.id)])
  if (Array.isArray(acts) && acts.some(a => ids.has(a.customerId))) {
    await owner('PUT', '/api/kv/fencepro_customer_activity', { value: acts.filter(a => !ids.has(a.customerId)), baseVersion: kv.versions.fencepro_customer_activity })
  }
  const users = (await owner('GET', '/api/crm-auth/users')).json.data ?? []
  for (const u of users.filter(x => x.email === EMAIL)) await owner('DELETE', `/api/crm-auth/users/${u.id}`)
  const still = ((await owner('GET', '/api/crm-contacts')).json.data ?? []).filter(c => c.lastName === LAST).length
  const userLeft = ((await owner('GET', '/api/crm-auth/users')).json.data ?? []).filter(x => x.email === EMAIL).length
  check('clean up: test customers and the login removed', still === 0 && userLeft === 0, `${still} customers, ${userLeft} logins`)
  // This run's tab, also after a failure (the emulator's Chrome is shared).
  await page?.close().catch(() => {})
  if (browser) { if (CDP) await browser.close().catch(() => {}); else await browser.close() }
  const failed = results.filter(r => !r).length
  console.log(`\n${results.length - failed} of ${results.length} checks passed (${NAME})`)
  process.exit(failed ? 1 : 0)
}
