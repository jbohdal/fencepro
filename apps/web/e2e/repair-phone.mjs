// The Repair flow on a phone (WebKit, as on an iPhone), on the dev copy.
//
//   APP_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> SHOTS=<folder> [BROWSER=webkit|chromium] node e2e/repair-phone.mjs
//   On the Android emulator's Chrome: adb reverse tcp:4001 tcp:4001; adb forward tcp:9333
//   localabstract:chrome_devtools_remote; CDP_URL=http://localhost:9333 node e2e/repair-phone.mjs
//
// New quote → Style: Job type Repair, a style, "What happened?" Leaning
// fence, one more post with the + button, Broken gate items, then the Price
// step: one price, the minimum said internally. Every button tapped must be a
// finger's size. Nothing is saved.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit, chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
const CDP = process.env.CDP_URL || ''
const ENGINE = process.env.BROWSER === 'chromium' ? chromium : webkit
const NAME = CDP ? 'android' : process.env.BROWSER === 'chromium' ? 'chromium' : 'webkit'
if (!/localhost:4001/.test(APP)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }

const browser = CDP ? await chromium.connectOverCDP(CDP) : await ENGINE.launch()
try {
  // The emulator's own Chrome (its real screen and touch), or a phone sized browser here.
  const ctx = CDP ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: NAME === 'chromium', hasTouch: true })
  if (CDP) { const p0 = await ctx.newPage(); await p0.goto(APP); await p0.evaluate(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN); await p0.close() }
  else await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.goto(APP); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(800)
  const small = []
  const tap = async (loc, what) => {
    await loc.scrollIntoViewIfNeeded(); await loc.waitFor({ state: 'visible' })
    const box = await loc.boundingBox()
    if (!box || box.height < 44 || box.width < 44) small.push(`${what} ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : '?'}`)
    await (CDP ? loc.click() : loc.tap()); await sleep(250)
  }
  const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }
  const b = page.locator('[data-quote-builder]')
  { const nq = page.locator('button:has-text("New quote"):visible').first(); await (CDP ? nq.click() : nq.tap()); await sleep(800) }
  await tap(b.locator('[data-step="style"]'), 'Style tab')
  await tap(b.locator('[data-job-type-option="repair"]'), 'Repair')
  await b.locator('[data-style-list]').selectOption({ label: 'White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig' }); await sleep(300)
  await shot(`dev-repair-phone-${NAME}-1-job-type`)
  await tap(b.locator('[data-what="leaning"]'), 'Leaning fence')
  check('Leaning fence: starts with one leaning post', await b.locator('[data-repair-item="resetPost"] [data-stepper-value]').textContent() === '1')
  await tap(b.locator('[data-repair-item="resetPost"] button[aria-label^="One more"]'), '+')
  check('the + button counts up', await b.locator('[data-repair-item="resetPost"] [data-stepper-value]').textContent() === '2')
  await tap(b.locator('[data-repair-item="rehangGate"] button[aria-label^="One more"]'), '+ gate')
  await b.locator('[data-what="leaning"]').scrollIntoViewIfNeeded()
  await shot(`dev-repair-phone-${NAME}-2-what-happened`)
  await b.locator('[data-repair-items]').scrollIntoViewIfNeeded()
  await shot(`dev-repair-phone-${NAME}-3-items`)
  await tap(page.locator('[data-quote-bar] [data-bar-next]'), 'Next: Price')
  const price = Number((await b.locator('[data-quote-price]').textContent()).replace(/[^\d.]/g, ''))
  check('Price step: one price', price >= 350, String(price))
  check('the bar says what the repair is', /Repair · 3 items/.test(await page.locator('[data-bar-facts]').textContent()))
  await shot(`dev-repair-phone-${NAME}-4-price`)
  check('every button tapped is at least 44 × 44', small.length === 0, small.join(', '))
  check('no page errors', errors.length === 0, errors.join(' | '))
} catch (e) {
  check('test run finished', false, String(e).split('\n').slice(0, 3).join(' '))
} finally { if (!CDP) await browser.close() }
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed (${NAME})`)
process.exit(passed === results.length ? 0 : 1)
