// Warnings that prevent bad quotes, in a browser on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> node e2e/quote-checks.mjs
//
// Nothing is saved.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:5173'
const API = process.env.API_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }

const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await ctx.addInitScript(t => {
    localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e')
  }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  await page.goto(APP); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(800)
  await page.locator('button:has-text("New quote"):visible').first().click()
  const b = page.locator('[data-quote-builder]')
  const warnings = async () => (await b.locator('text=Check before you quote').locator('xpath=..').textContent().catch(() => '')) || ''

  const go = async k => { await b.locator(`[data-step="${k}"]`).click(); await sleep(200) }
  // Tape measure: 80 ft at 8 ft wide.
  await go('yard')
  await b.locator('[data-shape="straight"]').click()
  await b.locator('[data-side-length]').first().click()
  for (const k of ['8', '0']) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await page.locator('[data-ftin-pad] [data-pad-done]').click()
  await go('style')
  await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig" }); await sleep(400)
  await go('yard')
  const w1 = await warnings()
  check('80 ft at 8 ft wide asks for a tape measure check', w1.includes("Fence (80' 0\"): Check this run with a tape measure. A few inches either way changes the section count."), w1.slice(0, 160))
  check('and marks the run on its side', await b.locator('[data-tape-flag]').count() === 1)
  if (SHOTS) { await b.locator('[data-tape-flag]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/1-phone-tape-check.png` }) }

  // 80' 4" still warns; 80' 7" does not.
  await b.locator('[data-side-length]').first().click()
  for (const k of ['8', '0', 'unit', '4']) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await page.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(300)
  check("80' 4\" still warns", (await warnings()).includes('tape measure'))
  await b.locator('[data-side-length]').first().click()
  for (const k of ['8', '0', 'unit', '7']) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await page.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(300)
  check("80' 7\" does not", !(await warnings()).includes('tape measure'))

  // A gate on a side under 6 ft.
  await b.locator('[data-side-length]').first().click()
  await page.locator('[data-ftin-pad] [data-pad-key="5"]').click()
  await page.locator('[data-ftin-pad] [data-pad-done]').click()
  await b.locator('[data-gate-choice] button:has-text("Walk gate")').click(); await sleep(300)
  check('a gate on a 5 ft side warns', (await warnings()).includes("Fence is under 6 ft (5' 0\") and has a gate"))

  // Margin and price per foot, from a price typed by hand.
  await b.locator('[data-gate-choice] button:has-text("No gate")').click()
  await b.locator('[data-side-length]').first().click()
  for (const k of ['1', '5', '0']) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await page.locator('[data-ftin-pad] [data-pad-done]').click()
  await go('price')
  await b.locator('input[placeholder="Calculated"]').last().fill('1500'); await sleep(400)
  const w2 = await warnings()
  check('a low typed price warns about margin', /Margin is -?\d+\.\d%, under your 34% target in Settings\./.test(w2), w2.slice(0, 200))
  // The normal price per foot comes from saved quotes with run lengths; the
  // imported quotes have none, so with under 5 for this style it stays quiet
  // (the warning itself is covered by tests/quoteChecks.test.ts).
  check('price per foot stays quiet without 5 past quotes with footage for the style', !w2.includes('a foot is far'), w2.slice(0, 300))
  if (SHOTS) { await b.locator('text=Check before you quote').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/2-phone-warnings.png` }) }
  check('warnings never block saving', await page.locator('[data-quote-bar] [data-save-open]').isEnabled())

  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()

} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
