// Warnings that prevent bad quotes, in a browser on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> node e2e/quote-checks.mjs
//
// Nothing is saved.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'
import { walkFence } from './lib.mjs'

const APP = process.env.APP_URL || 'http://localhost:4001'
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
  // The walk list (Nov 5 2026): a straight fence walked, 80 ft to the end post.
  await walkFence(page, [[80, 'end']])
  await go('style')
  await b.locator('select').filter({ hasText: 'Select a fence style' }).selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft sections, No dig" }); await sleep(400)
  await go('yard')
  const w1 = await warnings()
  check('80 ft at 8 ft wide asks for a tape measure check', w1.includes("Side 1 (80' 0\"): Check this length with a tape measure. A few inches either way changes the number of sections."), w1.slice(0, 160))
  check('and marks the step on the walk list', await b.locator('[data-walk-step] [data-tape-flag]').count() === 1)
  if (SHOTS) { await b.locator('[data-tape-flag]').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${SHOTS}/1-phone-tape-check.png` }) }

  // Fix the step: 80' 4" still warns; 80' 7" does not.
  const fix = async (feet, what) => {
    await b.locator('[data-walk-step]').first().click(); await sleep(200)
    await page.locator('[data-walk-edit-feet]').fill(feet)
    if (what) await page.locator(`[data-walk-edit-what="${what}"]`).click()
    await page.locator('[data-walk-edit-save]').click(); await sleep(300)
  }
  await fix('80 4')
  check("80' 4\" still warns", (await warnings()).includes('tape measure'))
  await fix('80 7')
  check("80' 7\" does not", !(await warnings()).includes('tape measure'))

  // A gate on a side under 6 ft: the one step taken away, then 6 in, a 4 ft gate, 6 in to the end post (a 5 ft side).
  const takeAway = async () => { await b.locator('[data-walk-step]').first().click(); await sleep(200); page.once('dialog', d => d.accept()); await page.locator('[data-walk-edit-delete]').click(); await sleep(300) }
  await takeAway()
  await walkFence(page, [[0.5, 'gate', { w: 4 }], [0.5, 'end']])
  const gw = await warnings()
  check('a gate on a 5 ft side warns', gw.includes("Side 1 is under 6 ft (5' 0\") and has a gate"), gw.slice(0, 200))

  // Margin and price per foot, from a price typed by hand: 150 ft, no gate.
  await takeAway(); await takeAway()
  await walkFence(page, [[150, 'end']])
  await go('price')
  await b.locator('input[placeholder="Calculated"]').last().fill('1500'); await sleep(400)
  const w2 = await warnings()
  check('a low typed price warns about margin', /Margin is -?\d+\.\d% \(price less cost\), under this fence's [\d.]+% Target Margin \(Overhead \+ Target Profit in Settings\)\./.test(w2), w2.slice(0, 200))
  // The normal price per foot comes from saved quotes with run lengths (imported quotes have none):
  // quiet with under 5 for this style; once there are 5 or more, it warns and says from how many
  // (the rule itself is covered by tests/quoteChecks.test.ts).
  const perFoot = /a foot is far below your past .* quotes \(usually \$[\d.,]+ to \$[\d.,]+ a foot, from (\d+) past quotes\)/.exec(w2)
  check('price per foot: quiet under 5 past quotes for the style, a warning that names the count from 5', perFoot ? Number(perFoot[1]) >= 5 : !w2.includes('a foot is far'), w2.slice(0, 300))
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
