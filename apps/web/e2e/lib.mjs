// Shared helpers for the browser tests. See README.md in this folder.
import { chromium } from 'playwright'
export { chromium }

export const APP = process.env.APP_URL || 'http://localhost:5173'
export const API = process.env.API_URL || 'http://localhost:4000'
export const EMAIL = process.env.E2E_EMAIL || ''
export const PASSWORD = process.env.E2E_PASSWORD || ''

// These tests create customers, quotes, jobs, vendors and schedule entries.
// They are for a local or throwaway database only.
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if ((!local(APP) || !local(API)) && process.env.E2E_ALLOW_REMOTE !== 'I understand this writes test data') {
  console.error('Refusing to run: APP_URL and API_URL must be localhost. These tests write test data.')
  process.exit(2)
}
if (!EMAIL || !PASSWORD) {
  console.error('Set E2E_EMAIL and E2E_PASSWORD to a login on the test database.')
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
  await s.page.goto(APP)
  await s.page.waitForSelector('input[type="email"]', { timeout: 15000 })
  await s.page.fill('input[type="email"]', EMAIL)
  await s.page.fill('input[type="password"]', password)
  await s.page.click('button[type="submit"]')
}

/** Wait until the app has loaded every module's data and shows the dashboard. */
export async function ready(s) {
  await s.page.waitForSelector('text=Revenue Goal Progress', { timeout: 25000 })
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
