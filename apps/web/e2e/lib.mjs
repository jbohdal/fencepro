// Shared helpers for the browser tests. See README.md in this folder.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
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
export const STAFF_COOKIE = process.env.E2E_STAFF_COOKIE || ''
export const ACCESS_TOKEN = process.env.E2E_ACCESS_TOKEN || ''
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
  const me = await ctx.request.get(`${api}/api/crm-auth/me`)
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
