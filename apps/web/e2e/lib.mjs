// Shared helpers for the browser tests. See README.md in this folder.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import { execFileSync } from 'child_process'
export { chromium }

// The dev copy serves the app too. (5173 is the old ~/fencepro build's dev server on this Mac: never test there.)
export const APP = process.env.APP_URL || 'http://localhost:4001'
export const API = process.env.API_URL || 'http://localhost:4001'
export const EMAIL = process.env.E2E_EMAIL || ''
export const PASSWORD = process.env.E2E_PASSWORD || ''

// These tests create customers, quotes, jobs, vendors and schedule entries.
// They are for a local or throwaway database only.
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if ((!local(APP) || !local(API)) && process.env.E2E_ALLOW_REMOTE !== 'I understand this writes test data') {
  console.error('Refusing to run: APP_URL and API_URL must be localhost. These tests write test data.')
  process.exit(2)
}
export const ACCESS_TOKEN = process.env.E2E_ACCESS_TOKEN || ''
/**
 * The `ezbiz_staff` cookie for the suites that sign in only by cookie. E2E_STAFF_COOKIE
 * when it is set; otherwise, with only E2E_ACCESS_TOKEN (how run-heavy.sh and the
 * nightly run are usually started), the token is moved over to a cookie once here,
 * the way the app does on its first load (POST /api/crm-auth/move-over; the token
 * keeps working).
 */
async function cookieFromToken() {
  if (!ACCESS_TOKEN) return ''
  try {
    const r = await fetch(`${API}/api/crm-auth/move-over`, { method: 'POST', headers: { 'X-Staff-Request': '1', 'Content-Type': 'application/json', Authorization: `Bearer ${ACCESS_TOKEN}` }, body: '{}' })
    const set = (r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie') || '']).join('\n')
    return set.match(/ezbiz_staff=([^;\s]+)/)?.[1] || ''
  } catch { return '' }
}
export const STAFF_COOKIE = process.env.E2E_STAFF_COOKIE || await cookieFromToken()
if ((!EMAIL || !PASSWORD) && !STAFF_COOKIE && !ACCESS_TOKEN) {
  console.error('Set E2E_STAFF_COOKIE (scripts/dev-session-token.ts --cookie), E2E_ACCESS_TOKEN, or E2E_EMAIL and E2E_PASSWORD for a login on the test database.')
  process.exit(2)
}

export const sleep = ms => new Promise(r => setTimeout(r, ms))

/** A separate browser profile: its own storage, like a second computer. */
export async function newSession(browser, name) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const log = { console: [], failed: [], api: [] }
  page.on('console', m => { if (m.type() === 'error') log.console.push(m.text().slice(0, 300)) })
  page.on('pageerror', e => log.console.push('PAGEERROR ' + String(e).slice(0, 300)))
  page.on('response', r => {
    const u = r.url()
    if (u.startsWith(API)) {
      const rec = `${r.request().method()} ${u.replace(API, '')} ${r.status()}`
      log.api.push(rec)
      if (r.status() >= 400) log.failed.push(rec)
    }
  })
  page.on('dialog', d => d.accept().catch(() => {}))
  return { ctx, page, log, name }
}

export async function login(s, password = PASSWORD) {
  // No password given (a run with only E2E_ACCESS_TOKEN or E2E_STAFF_COOKIE): the cookie sign in.
  if (!EMAIL || !password) {
    await signInByCookie(s.ctx)
    await s.page.goto(APP)
    return
  }
  await s.page.goto(APP)
  await s.page.waitForSelector('input[type="email"]', { timeout: 15000 })
  await s.page.fill('input[type="email"]', EMAIL)
  await s.page.fill('input[type="password"]', password)
  await s.page.click('button[type="submit"]')
}

/**
 * Sign a browser context in the way the app does since Oct 2026: the
 * `ezbiz_staff` cookie (HttpOnly, Path=/api; apps/portal/src/server/lib/staffSession.ts).
 * Nothing goes in the browser's storage. In order of preference:
 *   - `cookie`, or E2E_STAFF_COOKIE (scripts/dev-session-token.ts --cookie): set as it is;
 *   - `email` + `password` (or E2E_EMAIL / E2E_PASSWORD): signed in through the API;
 *   - `token`, or E2E_ACCESS_TOKEN: the old token, swapped for a cookie by the
 *     one time move over (until stage D switches it off).
 * The cookie lands in the context's own cookie jar, as a sign in on the page would.
 * Returns the signed in login (/api/crm-auth/me).
 */
export async function signInByCookie(ctx, { cookie = STAFF_COOKIE, email = EMAIL, password = PASSWORD, token = ACCESS_TOKEN, api = API } = {}) {
  const headers = { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }
  if (cookie) {
    const u = new URL(api)
    await ctx.addCookies([{ name: 'ezbiz_staff', value: cookie, domain: u.hostname, path: '/api', httpOnly: true, secure: false, sameSite: 'Strict' }])
  } else if (email && password) {
    const r = await ctx.request.post(`${api}/api/crm-auth/login`, { headers, data: { email, password, cookie: true } })
    if (!r.ok()) throw new Error(`cookie sign in failed: ${r.status()} ${await r.text()}`)
  } else if (token) {
    const r = await ctx.request.post(`${api}/api/crm-auth/move-over`, { headers: { ...headers, Authorization: `Bearer ${token}` }, data: {} })
    if (!r.ok()) throw new Error(`moving the test token over to a cookie failed: ${r.status()} ${await r.text()}`)
  } else throw new Error('signInByCookie: no cookie, password or token')
  // The API's request limit counts per signed in person (index.ts apiLimiter), and every suite signs in as the
  // same dev owner: a suite that just made 170 notes and photos, or another run on the same server, can have used
  // up this minute. Signing in is not what is being tested, so a 429 here waits for the limit's reset and asks again.
  let me = await ctx.request.get(`${api}/api/crm-auth/me`)
  for (let i = 0; me.status() === 429 && i < 3; i++) {
    const reset = Number(me.headers()['ratelimit-reset'] || me.headers()['retry-after'] || 0)
    await sleep(Math.min(65, Math.max(5, reset + 1)) * 1000)
    me = await ctx.request.get(`${api}/api/crm-auth/me`)
  }
  if (!me.ok()) throw new Error(`signed in by cookie, but /me answered ${me.status()}`)
  return (await me.json()).data
}

/** Wait until the app has loaded every module's data and shows the dashboard. */
export async function ready(s) {
  await s.page.waitForSelector(s.phone ? '[data-tabbar]' : '[data-global-appointment]', { timeout: 30000 })
}

export async function nav(s, label) {
  await s.page.locator(`span:text-is("${label}"):visible`).first().click()
  await sleep(700)
}

/**
 * Source for an in page helper that imports one of the app's own modules, the
 * same instance the running app uses (the dev server may add a version query
 * to the URL, so the URL is looked up from what the page already loaded).
 */
export const IMP = `const imp = name => { const hit = performance.getEntriesByType('resource').map(e => e.name).filter(n => n.includes('/src/' + name)).pop(); return import(hit ? hit.replace(location.origin, '') : '/src/' + name) }`

/**
 * A test login of its own on the dev copy (the WT test logins are gone since the
 * scrubbed refresh, Oct 26 2026): invited by the owner and accepted with a random
 * password, the way a new hire is. Returns { id, email, password, token, firstName,
 * lastName, name, role }. Remove it with removeTestLogin(). The email is
 * @example.invalid; nothing is sent (the dev copy's outbound gate is shut).
 */
export async function makeTestLogin({ role = 'sales_rep', firstName = 'E2E', lastName, ownerToken = ACCESS_TOKEN, api = API } = {}) {
  const code = Math.random().toString(36).slice(2, 8)
  const last = lastName || `${role.replace('_', ' ')} ${code}`
  const email = `e2e-${role.replace('_', '-')}-${code}@example.invalid`
  const H = { 'X-Staff-Request': '1', 'Content-Type': 'application/json' }
  // Inviting an admin asks the owner's password, which is not known here: invited one step down, raised on the dev copy.
  const inv = await fetch(`${api}/api/crm-auth/invite`, { method: 'POST', headers: { ...H, Authorization: `Bearer ${ownerToken}` }, body: JSON.stringify({ firstName, lastName: last, email, role: role === 'admin' ? 'manager' : role }) })
  const ij = await inv.json().catch(() => null)
  if (!ij?.data?.inviteUrl) throw new Error(`invite ${role}: ${inv.status} ${JSON.stringify(ij).slice(0, 200)}`)
  const password = `E2e-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2, 6).toUpperCase()}!`
  const acc = await fetch(`${api}/api/crm-auth/accept-invite`, { method: 'POST', headers: H, body: JSON.stringify({ token: new URL(ij.data.inviteUrl).searchParams.get('token'), email, password }) })
  const aj = await acc.json().catch(() => null)
  const token = aj?.data?.accessToken
  if (!token) throw new Error(`accept invite ${role}: ${acc.status} ${JSON.stringify(aj).slice(0, 200)}`)
  const me = await (await fetch(`${api}/api/crm-auth/me`, { headers: { Authorization: `Bearer ${token}` } })).json().catch(() => null)
  if (role === 'admin') execFileSync('psql', ['-d', 'ezbiz_dev', '-Atc', `update "CrmUser" set role = 'admin' where email = '${email}'`])
  return { id: me?.data?.id ?? null, email, password, token, firstName, lastName: last, name: `${firstName} ${last}`, role }
}

/** Removes a login made by makeTestLogin (the owner's Team delete). */
export async function removeTestLogin(login, { ownerToken = ACCESS_TOKEN, api = API } = {}) {
  if (!login?.id) return
  await fetch(`${api}/api/crm-auth/users/${login.id}`, { method: 'DELETE', headers: { 'X-Staff-Request': '1', Authorization: `Bearer ${ownerToken}` } }).catch(() => {})
}

export function reporter() {
  const results = []
  return {
    check(name, ok, detail = '') { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) },
    finish() {
      const failed = results.filter(r => !r.ok)
      console.log(`\n${results.length - failed.length} of ${results.length} checks passed`)
      return failed.length ? 1 : 0
    },
  }
}

/**
 * Picks the fence whose plain name matches `styleText` (a regular expression) on the quote builder's Style step.
 * The owner and office pick from the list; a Salesman has no list (Nov 2 2026: Material > Style > Height > Color >
 * add ons, the width and install worked out), so her chips are tapped until the fence named matches.
 */
export async function pickStyle(page, styleText) {
  const b = page.locator('[data-quote-builder]')
  const re = new RegExp(styleText, 'i')
  const list = b.locator('[data-step-panel="style"] [data-style-list]')
  if (await list.count()) {
    const value = await list.evaluate((el, text) => [...el.options].find(o => new RegExp(text, 'i').test(o.textContent))?.value, styleText)
    if (!value) throw new Error(`no style like ${styleText}`)
    await list.selectOption(value); await sleep(600)
    return
  }
  const simple = b.locator('[data-style-choices-simple]')
  const named = async () => re.test((await simple.locator('[data-style-plain-name]').textContent().catch(() => '')) ?? '')
  for (const m of await simple.locator('[data-choice-material]').all()) {
    await m.tap(); await sleep(500)
    if (await named()) return
    // One choice at a time, each option in turn, keeping the first that names the fence; then two at a time.
    const dims = await simple.locator('[data-choice-dim]').evaluateAll(els => [...new Set(els.map(e => e.getAttribute('data-choice-dim')))])
    for (const d of dims) {
      for (const o of await simple.locator(`[data-choice-dim="${d}"]`).all()) {
        await o.tap(); await sleep(400)
        if (await named()) return
      }
    }
    for (const d of dims) for (const o of await simple.locator(`[data-choice-dim="${d}"]`).all()) {
      await o.tap(); await sleep(300)
      for (const d2 of dims.filter(x => x !== d)) for (const o2 of await simple.locator(`[data-choice-dim="${d2}"]`).all()) {
        await o2.tap(); await sleep(300)
        if (await named()) return
      }
    }
  }
  throw new Error(`the Salesman's picker names no fence like ${styleText}`)
}

/**
 * The Salesman's picker on the Style step, by keys: the material, then each choice in order
 * (`{ style: 'privacy', height: '6', color: 'white' }`). A choice with one option is not shown; it is skipped. The
 * section width and install are hers to never pick (best price, the Better option's install). Returns the fence named.
 */
export async function pickFence(page, material, picks = {}) {
  const simple = page.locator('[data-quote-builder] [data-style-choices-simple]')
  await simple.waitFor({ timeout: 15000 })
  await simple.locator(`[data-choice-material="${material}"]`).click(); await sleep(500)
  for (const [dim, key] of Object.entries(picks)) {
    const chip = simple.locator(`[data-choice-dim="${dim}"][data-choice-key="${key}"]`)
    if (await chip.count()) { await chip.first().click(); await sleep(400) }
  }
  await simple.locator('[data-style-plain-name]').waitFor({ timeout: 10000 })
  return (await simple.locator('[data-style-plain-name]').textContent()).trim()
}

/**
 * The fence a backyard drawing used to give (30, 120, 150, 120, 30 ft, a corner between each side, an end
 * post at the house on each end), as walked on the Yard step's walk list (Nov 5 2026: no drawing at the house).
 */
export const BACKYARD_WALK = [[30, 'corner'], [120, 'corner'], [150, 'corner'], [120, 'corner'], [30, 'end']]

/**
 * Walks a fence on the Yard step's walk list: each step is [feet, what, extra], what one of corner (extra 'left' or
 * 'right', right by default), gate (extra { w: feet, kind: 'walk' | 'double' }), tee, end, start (back to start).
 * Opens the Yard step first when the walk list is not showing. Leaves the finish screen up ("Done, show me prices").
 */
export async function walkFence(page, steps) {
  const b = page.locator('[data-quote-builder]')
  if (!(await page.locator('[data-walk]').isVisible().catch(() => false))) { await b.locator('[data-step="yard"]').click(); await sleep(300) }
  await page.locator('[data-walk]').waitFor({ timeout: 15000 })
  for (const [feet, what, extra] of steps) {
    await page.locator('[data-walk-feet]').fill(String(feet)); await sleep(120)
    if (what === 'corner') {
      await page.locator('[data-walk-corner]').click(); await sleep(120)
      await page.locator(extra === 'left' ? '[data-walk-left]' : '[data-walk-right]').click()
    } else if (what === 'gate') {
      const w = extra?.w ?? 4
      await page.locator('[data-walk-gate]').click(); await sleep(120)
      if (await page.locator(`[data-walk-gate-width="${w}"]`).count()) await page.locator(`[data-walk-gate-width="${w}"]`).click()
      else await page.locator('[data-walk-gate-other]').fill(String(w))
      await page.locator(`[data-walk-gate-kind="${extra?.kind ?? 'walk'}"]`).click()
    } else await page.locator(`[data-walk-${what}]`).click()
    await sleep(150)
  }
}

/** A backyard's side lengths in feet, as walk steps: a corner after each side but the last, an end post there. */
export const backyardOf = lens => lens.map((ft, i) => [ft, i === lens.length - 1 ? 'end' : 'corner'])

/**
 * The old drawing's side list ([name, feet, 'Walk gate' | 'Double gate']) as walk steps: a corner after each side
 * but the last, an end post there (back to start when `closed`); a gate in a side's middle, 4 ft single or 10 ft
 * double, as the drawing's gate choice made it.
 */
export const sidesOf = (sides, closed = false) => sides.flatMap(([, ft, gate], i) => {
  const feet = Number(ft), last = i === sides.length - 1
  const end = [last ? (closed ? 'start' : 'end') : 'corner']
  if (!gate) return [[feet, ...end]]
  const w = /double/i.test(gate) ? 10 : 4, half = (feet - w) / 2
  return [[half, 'gate', { w, kind: w === 10 ? 'double' : 'walk' }], [half, ...end]]
})
