// The quote screen in steps, on a phone, on the dev copy.
//
//   APP_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev token> SHOTS=<folder> node e2e/quote-steps.mjs
//
// Quote the Backyard (returns 30 ft, a 4' walk gate on the left return, sides
// 120, back 150) moving on with only "Next side". Before every tap the button
// must already be on the phone screen: nothing needs a scroll to reach. Each
// step is photographed. Nothing typed is lost moving between steps. Nothing
// is saved.

import { chromium } from 'playwright'

const APP = process.env.APP_URL || 'http://localhost:4001'
const TOKEN = process.env.E2E_ACCESS_TOKEN || ''
const SHOTS = process.env.SHOTS || ''
if (!/localhost:4001/.test(APP)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
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

  await tap(b.locator('[data-shape="backyard"]'), 'Backyard')
  check('Yard: the plan on top, one row per side, the first side open', (await b.locator('[data-plan-wrap] svg').count()) === 1 && (await b.locator('[data-side-row]').count()) === 5 && (await b.locator('[data-side-open="true"]').getAttribute('data-side')) === 'Left return')
  check('a side shows only the length, mic, gate choice and one ends line; the rest is behind More options',
    (await b.locator('[data-side-open="true"] [data-finish]').count()) === 0 && (await b.locator('[data-side-open="true"] [data-side-ends]').textContent()).includes('Meets the house at the start, corner at the end'))

  const sides = [['Left return', '30', true], ['Left side', '120'], ['Back', '150'], ['Right side', '120'], ['Right return', '30']]
  for (const [name, ft, gate] of sides) {
    const open = b.locator(`[data-side-open="true"][data-side="${name}"]`)
    check(`${name} is the open side`, (await open.count()) === 1)
    await tap(open.locator('[data-side-length]'), `${name} length`)
    await pad([...ft])
    if (gate) {
      await tap(open.locator('[data-gate-choice] button:has-text("Walk gate")'), 'Walk gate')
      check("the walk gate is 4' wide", /4' 0" gate/.test(await open.locator('[data-side-ends]').textContent()), await open.locator('[data-side-ends]').textContent())
    }
    if (name === 'Back') await shot('2-yard-side-open')
    const label = (await bar.locator('[data-bar-next]').textContent()).trim()
    check(`after ${name}: the bar says ${name === 'Right return' ? 'Next: Style' : 'Next side'}`, label === (name === 'Right return' ? 'Next: Style' : 'Next side'), label)
    if (name !== 'Right return') await tap(bar.locator('[data-bar-next]'), `Next side after ${name}`)
  }
  const facts = (await bar.locator('[data-bar-facts]').textContent()).trim()
  check('bottom bar: 5 of 5 sides, 446 ft of fence (450 less the 4 ft gate), 4 corner, 4 end', facts === '5 of 5 sides · 446 ft · 4 corner, 4 end', facts)
  check('every row has its check mark and length', (await b.locator('[data-side-row] .bg-green-600').count()) === 5)
  await shot('3-yard-done')

  // More options holds the rest.
  await tap(b.locator('[data-side-open="true"] [data-side-more]'), 'More options')
  check('More options: start, end, house, gaps, rename, turn off, delete', (await b.locator('[data-side-options] [data-finish]').count()) === 2 && (await b.locator('[data-side-options] [data-add-skip]').count()) === 1 && (await b.locator('[data-side-options] button:has-text("Turn this side off")').count()) === 1)
  await shot('4-yard-more-options')
  await tap(b.locator('[data-side-open="true"] [data-side-more]'), 'Close More options')

  await tap(bar.locator('[data-bar-next]'), 'Next: Style')
  check('Style step', (await b.locator('[data-step="style"][aria-selected="true"]').count()) === 1)
  await b.locator('[data-step-panel="style"] select').first().selectOption({ label: "White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig" }); await sleep(500)
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
  check('nothing lost: the five lengths are still there', (await b.locator('[data-side-len]').allTextContents()).join(',') === `30' 0",120' 0",150' 0",120' 0",30' 0"`)
  // Plan sides are thin lines: tapped where they are drawn (on screen, no scroll).
  const back = page.locator('[data-plan-side="Back"]').first()
  const bb = await back.boundingBox()
  if (!bb || bb.y < 0 || bb.y + bb.height > page.viewportSize().height) offscreen.push('Back on the plan')
  await back.tap({ force: true }); await sleep(300)
  check('tapping a side on the plan opens it', (await b.locator('[data-side-open="true"]').getAttribute('data-side')) === 'Back')

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
