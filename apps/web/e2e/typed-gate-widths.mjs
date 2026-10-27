// Gate widths survive "Advanced: type runs"; Settings → Fence styles says what is switched off (review, Oct 26 2026).
//
//   APP_URL=http://localhost:4065 E2E_STAFF_COOKIE=<cookie> SHOTS=<folder> node e2e/typed-gate-widths.mjs
//
//   1. A 100 ft straight yard with a 12 ft double gate on Black Chain Link, 4 ft, Dig set: the
//      price; "Advanced: type runs" keeps the 12 ft width (same price, the width shown); 8 ft
//      there gives the lower price; back to 12 ft, the drawn price again.
//   2. Settings → Fence styles → Chain link: Green says it is switched off (and what it waits
//      for); Dig set names the fences that wait and the ones available for quoting.
// Nothing is saved.
import './devOnly.mjs'
import { chromium } from 'playwright'
import { signInByCookie } from './lib.mjs'
const APP = process.env.APP_URL || 'http://localhost:4001'
const SHOTS = process.env.SHOTS || ''
const STYLE = process.env.STYLE || 'Black Chain Link, 4 ft, Residential, Dig set'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const money = t => Number(String(t).replace(/[^\d.-]/g, ''))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
await signInByCookie(ctx, { api: APP })
const page = await ctx.newPage()
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
page.on('dialog', d => d.accept().catch(() => {}))
const b = page.locator('[data-quote-builder]')
const price = async () => { await sleep(900); return money(await b.locator('[data-quote-price]').first().textContent()) }

try {
  // ── 1. The yard, drawn, then typed ──
  await page.goto(`${APP}/quotes?quote=new`); await b.waitFor({ timeout: 60000 }); await sleep(800)
  await b.locator('[data-step="yard"]').click()
  await b.locator('[data-shape="straight"]').click(); await sleep(300)
  if (!(await b.locator('[data-side="Fence"] [data-side-length]').isVisible().catch(() => false))) await b.locator('[data-side-row="Fence"]').click()
  await b.locator('[data-side="Fence"] [data-side-length]').click()
  for (const k of '100') await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await page.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(300)
  await b.locator('[data-gate-choice] button', { hasText: 'Double gate' }).click(); await sleep(300)
  await b.locator('[data-side-more]').first().click(); await sleep(300)
  await b.locator('[data-gate-size="12"]').click(); await sleep(300)
  await b.locator('[data-step="style"]').click(); await sleep(300)
  await b.locator('[data-style-list]').selectOption({ label: STYLE }); await sleep(400)
  await b.locator('[data-step="price"]').click()
  const drawn = await price()
  check('drawn: a price for the 12 ft double gate', drawn > 0, String(drawn))

  await b.locator('[data-step="yard"]').click(); await sleep(400)
  await b.locator('[data-to-advanced]').click(); await sleep(500)
  const sel = b.locator('[data-gate-width-typed="dbl-0"]')
  check('typed runs: the double gate shows its drawn width (12 ft)', await sel.isVisible() && (await sel.inputValue()) === '12', await sel.inputValue().catch(() => 'not shown'))
  await sel.scrollIntoViewIfNeeded(); if (SHOTS) await page.screenshot({ path: `${SHOTS}/typed-gate-width-12.png` })
  await b.locator('[data-step="price"]').click()
  const typed = await price()
  check('typed runs: the same price as drawn (no quiet repricing as an 8 ft gate)', typed === drawn, `${typed} vs ${drawn}`)

  await b.locator('[data-step="yard"]').click(); await sleep(400)
  await sel.selectOption('8'); await sleep(300)
  await b.locator('[data-step="price"]').click()
  const eight = await price()
  check('typed runs: picking 8 ft prices two 4 ft leaves (lower)', eight > 0 && eight < drawn, `${eight} < ${drawn}`)
  await b.locator('[data-step="yard"]').click(); await sleep(400)
  await sel.selectOption('12'); await sleep(300)
  await b.locator('[data-step="price"]').click()
  check('typed runs: back to 12 ft, the drawn price again', (await price()) === drawn)
  await b.locator('[data-step="yard"]').click(); await sleep(400)
  await b.locator('[data-to-layout]').click(); await sleep(400)
  await b.locator('[data-step="price"]').click()
  check('back to the drawing: the drawn price', (await price()) === drawn)
  await page.locator('[data-quote-close]').first().click().catch(() => {}); await sleep(600)

  // ── 2. Settings → Fence styles ──
  await page.goto(`${APP}/settings`); await sleep(1500)
  await page.locator('[data-settings-tab="styles"]').click(); await sleep(1500)
  const green = page.locator('[data-tree-option^="chain:finish:"]', { hasText: 'Green' })
  if (await green.count()) {
    const t = (await green.first().textContent()) || ''
    check('Green (switched off) says it is switched off, then what it waits for', /Switched off\. It is also waiting for prices on \d+ parts? in Inventory/.test(t) || /Switched off: fully priced/.test(t), t.slice(0, 200))
    await green.first().scrollIntoViewIfNeeded(); if (SHOTS) await page.screenshot({ path: `${SHOTS}/settings-green-switched-off.png` })
  } else {
    // Green Chain Link is made on the dev copy only (scripts/stephens-quotes-2026-10-26b.ts, docs/FEATURES.md
    // "06-251706 and 06-251707"); a fresh copy of live has no Green. The words for a switched off color are
    // pinned in tests/optionStatusWords.test.ts, and adding a held chain link finish in e2e/add-color.mjs.
    console.log('SKIP  Green (switched off): no Green finish on this database (a fresh copy of live); covered by tests/optionStatusWords.test.ts')
  }
  const ds = page.locator('[data-tree-option="chain:install:ds"]')
  const dsText = (await ds.textContent()) || ''
  check('Dig set names the fences available for quoting and the ones waiting, not a pooled count', /Available for quoting: .*Galvanized Chain Link, 4 ft/.test(dsText) && /Waiting for prices in Inventory: |Switched off, and waiting for prices: /.test(dsText) && !/waiting for prices on \d+ parts in Inventory\. It switches on by itself/.test(dsText), dsText.slice(0, 400))
  await ds.scrollIntoViewIfNeeded(); if (SHOTS) await page.screenshot({ path: `${SHOTS}/settings-dig-set-per-fence.png` })
  check('no page errors', errs.length === 0, errs.join(' | '))
} catch (e) {
  check('ran to the end', false, String(e).slice(0, 300))
} finally { await browser.close() }
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
