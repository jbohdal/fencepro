// The website quote (/p/quote) fits a phone: at 360 and 390 px wide, on
// WebKit and Chromium, every step (address, the photo with a drawing and its
// sheets, the fence, contact, the prices) has no sideways scroll, and every
// button, box and label is on screen and not covered. Test mode (?test=1):
// nothing is saved or sent. The photo and parcel services are not called.
//
//   APP_URL=http://localhost:4001 [SHOTS=<folder>] node e2e/widget-fit.mjs

import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import { webkit, chromium } from 'playwright'
import fs from 'fs'

const APP = process.env.APP_URL || 'http://localhost:4001'
if (!/localhost:4001/.test(APP)) { console.error('Refusing to run: the dev copy only.'); process.exit(2) }
const SHOTS = process.env.SHOTS || ''
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }

/** Sideways scroll, and anything a person must tap that is off the screen's width or covered. */
async function fits(page) {
  return page.evaluate(() => {
    const W = window.innerWidth
    const bad = []
    if (document.documentElement.scrollWidth > W + 1) bad.push(`sideways scroll ${document.documentElement.scrollWidth} > ${W}`)
    for (const el of document.querySelectorAll('button, input:not([tabindex="-1"]), textarea, select, a, [role="button"], [data-w-side-label], [data-w-total]')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue
      const label = (el.getAttribute('data-w-side-label') ? 'label ' : '') + (el.textContent || el.getAttribute('placeholder') || el.tagName).trim().slice(0, 30)
      if (r.left < -1 || r.right > W + 1) { bad.push(`off screen: ${label} (${Math.round(r.left)}..${Math.round(r.right)})`); continue }
      // Covered: the middle of it (when it is in view) is it or inside it.
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2
      if (cy < 0 || cy > window.innerHeight) continue
      const top = document.elementFromPoint(cx, cy)
      // The drawing under an open sheet is meant to be covered by it.
      if (top?.closest('[data-w-sheet]') && el.closest('[data-w-overlay]')) continue
      if (top && top !== el && !el.contains(top) && !top.contains(el) && !(el.tagName === 'INPUT' && el.type === 'checkbox' && top.tagName === 'LABEL')) bad.push(`covered: ${label} by ${top.tagName.toLowerCase()}${top.getAttribute('class') ? '.' + top.getAttribute('class').split(' ')[0] : ''}`)
    }
    return bad
  })
}

for (const [engineName, engine] of [['webkit', webkit], ['chromium', chromium]]) {
  for (const width of [360, 390]) {
    const browser = await engine.launch()
    const ctx = await browser.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: engineName === 'chromium' })
    await ctx.route(/USGSNAIPPlus|USGSImageryOnly/, r => r.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#6b8f4e"/></svg>' }))
    await ctx.route(/gis\.ocalafl\.org/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"features":[]}' }))
    const page = await ctx.newPage()
    const at = `${engineName} ${width}px`
    const step = async (name) => {
      const bad = await fits(page)
      check(`${at}: ${name} fits (no sideways scroll, nothing off screen or covered)`, bad.length === 0, bad.slice(0, 4).join(' | '))
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/fit-${engineName}-${width}-${name.replace(/\W+/g, '-')}.png` }) }
    }
    try {
      await page.goto(`${APP}/p/quote/?test=1`); await sleep(1200)
      await page.fill('[data-w-address]', '110 SE Watula'); await sleep(1500)
      await step('address with suggestions')
      await page.click('[data-w-suggestion]'); await sleep(1500)
      await step('the photo')
      const box = await page.locator('[data-w-map] .leaflet-container').boundingBox()
      const c = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      for (const [dx, dy] of [[-90, 40], [-90, -90], [90, -90], [90, 40]]) { await page.mouse.click(c.x + dx, c.y + dy); await sleep(350) }
      await page.click('[data-w-done]'); await sleep(400)
      await step('the drawing')
      await page.click('[data-w-add-gate]'); await page.mouse.click(c.x - 90, c.y - 25); await sleep(400)
      await step('the gate sheet')
      await page.click('[data-w-gate-size="walk-4"]'); await sleep(300)
      await page.locator('[data-w-side-label]').nth(1).click(); await sleep(300)
      await step('the length sheet')
      await page.click('[data-w-sheet-close]'); await sleep(200)
      await page.click('[data-w-step="draw"] [data-w-next]'); await sleep(300)
      await page.click('[data-w-material="vinyl"]'); await sleep(300)
      await step('the fence')
      await page.click('[data-w-step="fence"] [data-w-next]'); await sleep(300)
      await page.fill('[data-w-name]', 'Fit Test'); await page.fill('[data-w-phone]', '3525550100')
      await step('contact')
      await page.click('[data-w-send]'); await page.waitForSelector('[data-w-option]', { timeout: 30000 }); await sleep(400)
      await step('the prices')
      check(`${at}: test mode says nothing is saved or sent`, await page.locator('[data-w-test-banner]').isVisible())
    } catch (e) { check(`${at}: run finished`, false, String(e?.message || e).split('\n')[0]) }
    await browser.close()
  }
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
