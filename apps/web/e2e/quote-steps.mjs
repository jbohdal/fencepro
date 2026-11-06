// The quote screen in steps, on a phone, on the dev copy.
//
//   APP_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> SHOTS=<folder> node e2e/quote-steps.mjs
//
// Quote the Backyard (returns 30 ft, a 4' walk gate on the left return, sides
// 120, back 150) moving on with only "Next side". Before every tap the button
// must already be on the phone screen: nothing needs a scroll to reach. Each
// step is photographed. Nothing typed is lost moving between steps. Nothing
// is saved.

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
if (!/localhost:(4001|409[0-9])/.test(APP)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  await page.goto(APP); await page.waitForSelector('[data-tabbar]', { timeout: 30000 }); await sleep(800)

  // Every tap: the button must be fully on screen as it is, then it is tapped.
  const offscreen = []
  const tap = async (loc, what) => {
    await loc.waitFor({ state: 'visible', timeout: 10000 })
    const box = await loc.boundingBox()
    const vh = page.viewportSize().height
    if (!box || box.y < 0 || box.y + box.height > vh) offscreen.push(`${what} at ${box ? Math.round(box.y) : '?'}`)
    await loc.tap({ noWaitAfter: true })
    await sleep(250)
  }
  const pad = async digits => {
    for (const d of digits) await tap(page.locator(`[data-ftin-pad] [data-pad-key="${d}"]`), `pad ${d}`)
    await tap(page.locator('[data-ftin-pad] [data-pad-done]'), 'pad Done')
  }
  const b = page.locator('[data-quote-builder]')
  const bar = page.locator('[data-quote-bar]')
  const shot = async name => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

  await page.locator('button:has-text("New quote"):visible').first().tap(); await sleep(800)
  check('opens on step 1, Customer, with the 4 steps across the top', (await b.locator('[data-step="customer"][aria-selected="true"]').count()) === 1 && (await b.locator('[data-steps] [data-step]').count()) === 4)
  await b.locator('input[placeholder^="Customer name"]').fill('Steps test (e2e)')
  await shot('1-customer')
  await tap(bar.locator('[data-bar-next]'), 'Next: Yard')

  // The walk list (Nov 5 2026): no drawing at the house, each side walked and typed.
  check('Yard: the walk list, "Stand where the fence starts.", the feet box ready', /Stand where the fence starts/.test(await b.locator('[data-walk-prompt]').innerText()) && (await b.locator('[data-walk-feet]').count()) === 1)
  const walkSteps = [[13, 'gate', 4], [13, 'corner'], [120, 'corner'], [150, 'corner'], [120, 'corner'], [30, 'end']]
  for (const [ft, what, w] of walkSteps) {
    await b.locator('[data-walk-feet]').fill(String(ft)); await sleep(150)
    if (what === 'gate') {
      await tap(b.locator('[data-walk-gate]'), 'Gate')
      await tap(b.locator(`[data-walk-gate-width="${w}"]`), `${w} ft`)
      await tap(b.locator('[data-walk-gate-kind="walk"]'), 'Single')
    } else if (what === 'corner') {
      await tap(b.locator('[data-walk-corner]'), 'Corner')
      await tap(b.locator('[data-walk-right]'), 'Turns right')
    } else await tap(b.locator('[data-walk-end]'), 'End post')
    if (ft === 150) await shot('2-yard-walk')
  }
  const list = await b.locator('[data-walk-step]').allInnerTexts()
  check('the step list: the gate, then a side per corner, the end post last', list.length === 6 && /Gate 4 ft single/.test(list[0]) && /End post/.test(list[5]), list.join(' | '))
  check('the total at the top: 450 ft walked', /450 ft/.test(await b.locator('[data-walk-total]').innerText()), await b.locator('[data-walk-total]').innerText())
  const facts = (await bar.locator('[data-bar-facts]').textContent()).trim()
  check('bottom bar: 446 ft of fence (450 less the 4 ft gate), 4 corner, 4 end', /446 ft · 4 corner, 4 end/.test(facts), facts)
  check('a rough sketch, not to scale', /not to scale/i.test(await b.locator('[data-walk-sketch]').innerHTML()))
  await shot('3-yard-done')

  await tap(bar.locator('[data-bar-next]'), 'Next: Style')
  check('Style step', (await b.locator('[data-step="style"][aria-selected="true"]').count()) === 1)
  await b.locator('[data-step-panel="style"] select').first().selectOption({ label: "White Vinyl Privacy, 6 ft tall, 6 ft sections, No dig" }); await sleep(500)
  await shot('5-style')
  await tap(bar.locator('[data-bar-next]'), 'Next: Price')
  check('Price step with the Save button in the bar', (await b.locator('[data-step="price"][aria-selected="true"]').count()) === 1 && (await bar.locator('[data-save-open]').count()) === 1)
  const price = (await b.locator('[data-quote-price]').textContent()).trim()
  check('the running price in the bar matches the Price step', (await bar.locator('[data-bar-price]').textContent()).trim() === price, price)
  await shot('6-price')

  // Back to the yard: everything typed is still there.
  await tap(b.locator('[data-step="customer"]'), 'Customer tab')
  check('nothing lost: the customer name is still there', (await b.locator('input[placeholder^="Customer name"]').inputValue()) === 'Steps test (e2e)')
  await tap(b.locator('[data-step="yard"]'), 'Yard tab')
  check('nothing lost: the walked steps are still there', (await b.locator('[data-walk-step]').count()) === 6)

  // Photos have their own button with a count.
  check('Photos and video live in the bottom bar with a count', /\d/.test(await bar.locator('[data-photos-open]').textContent()) && (await b.locator('[data-step-panel] [data-quote-media]').count()) === 0)
  await tap(bar.locator('[data-photos-open]'), 'Photos')
  check('Photos open in their own sheet', await page.locator('[data-photos-sheet] [data-quote-media]').isVisible())
  await shot('7-photos')
  await tap(page.locator('[data-photos-done]'), 'Photos Done')

  check('no button needed a scroll to reach', offscreen.length === 0, offscreen.join('; '))
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).split('\n').slice(0, 3).join(' '))
} finally {
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
