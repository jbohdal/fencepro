// Aluminum and chain link quotes show two options; chain link Dig set waits for its prices.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 E2E_ACCESS_TOKEN=<dev owner token> \
//   SHOTS=<folder> node e2e/two-options.mjs
//
//   1. A 120 ft chain link quote (Galvanized, 4 ft, Residential, No dig): "Two
//      options": Dig set with concrete (not available for quoting yet: waiting
//      for its post prices) and No dig, Most popular, priced as the quote.
//   2. An aluminum Emily quote: Dig set with concrete and No dig (Most popular), both priced.
//   3. A vinyl quote still shows Good, Better, Best.
//   4. Settings → Fence Styles → Chain link: Install has No dig and Dig set;
//      Dig set says it is not available until its parts are priced; in the
//      quote builder it is greyed (off).
// Nothing is saved. Screenshots: dev-cl-two-options, dev-alum-two-options, dev-cl-dig-set-off.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // tests that change shared dev data take turns
import { chromium } from 'playwright'
const APP = process.env.APP_URL || 'http://localhost:4001', API = process.env.API_URL || APP
const TOKEN = process.env.E2E_ACCESS_TOKEN || '', SHOTS = process.env.SHOTS || ''
const local = u => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(u)
if (!local(APP) || !local(API) || /:4000(\/|$)/.test(API)) { console.error('Refusing to run: the dev copy only (localhost, not port 4000).'); process.exit(2) }
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const money = t => Number(String(t).replace(/[^\d.-]/g, ''))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
const page = await ctx.newPage()
const errs = []
page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
page.on('dialog', d => d.accept().catch(() => {}))
const b = page.locator('[data-quote-builder]')

async function quoteOn(label, ft = 124) {
  await page.goto(`${APP}/quotes?quote=new`); await b.waitFor({ timeout: 60000 }); await sleep(800)
  await b.locator('[data-step="yard"]').click()
  await b.locator('[data-shape="straight"]').click(); await sleep(300)
  if (!(await b.locator('[data-side="Fence"] [data-side-length]').isVisible().catch(() => false))) await b.locator('[data-side-row="Fence"]').click()
  await b.locator('[data-side="Fence"] [data-side-length]').click()
  for (const k of String(ft)) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await page.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(300)
  await b.locator('[data-step="style"]').click(); await sleep(300)
  await b.locator('[data-style-list]').selectOption({ label }); await sleep(400)
  await b.locator('[data-step="price"]').click(); await sleep(1200)
}
const tiers = async () => b.locator('[data-tier]').evaluateAll(els => els.map(e => ({
  key: e.getAttribute('data-tier'), name: e.querySelector('[data-tier-name]')?.textContent ?? e.querySelector('.font-bold')?.textContent ?? '',
  price: e.querySelector('[data-tier-price]')?.textContent ?? null, popular: /Most popular/.test(e.textContent), reason: e.querySelector('[data-tier-reason]')?.textContent ?? null,
})))

try {
  // ── 1. Chain link ──
  await quoteOn('Galvanized Chain Link, 4 ft, Residential, No dig')
  const own = money(await b.locator('[data-quote-price]').textContent())
  const cl = await tiers()
  check('chain link: titled "Two options", two of them', (await b.locator('[data-tiers-title]').textContent()).startsWith('Two options') && cl.length === 2, JSON.stringify(cl.map(t => t.name)))
  check('chain link: Dig set with concrete is not available for quoting yet (its post prices)', cl[0]?.name === 'Dig set with concrete' && /not available for quoting yet: Dig set is waiting for prices on 2 parts/.test(cl[0]?.reason ?? ''), cl[0]?.reason)
  check('chain link: No dig, Most popular, at the quote\'s own price', cl[1]?.name === 'No dig' && cl[1].popular && money(cl[1].price) === own, `${cl[1]?.price} vs ${own}`)
  await b.locator('[data-tiers]').scrollIntoViewIfNeeded(); if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-cl-two-options.png` })
  await b.locator('[data-step="style"]').click(); await sleep(300)
  await b.locator('[data-choice-material="chain"]').click().catch(() => {}); await sleep(300)
  const dsState = await b.locator('[data-choice-dim="install"][data-choice-key="ds"]').getAttribute('data-choice-state').catch(() => null)
  check('quote builder: chain link Install has Dig set, greyed (off) until priced', dsState === 'held', String(dsState))

  // ── 2. Aluminum ──
  await quoteOn('Aluminum Emily, 4 ft tall, No dig')
  const al = await tiers()
  check('aluminum: Dig set with concrete and No dig (Most popular), both priced', al.length === 2 && al[0].name === 'Dig set with concrete' && money(al[0].price) > 0 && al[1].name === 'No dig' && al[1].popular && money(al[1].price) > 0, JSON.stringify(al))
  await b.locator('[data-tiers]').scrollIntoViewIfNeeded(); if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-alum-two-options.png` })

  // ── 3. Vinyl stays Good Better Best ──
  await quoteOn('White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig')
  const vi = await tiers()
  check('vinyl: still Good, Better, Best', (await b.locator('[data-tiers-title]').textContent()).startsWith('Good, Better, Best') && vi.map(t => t.name).join(',') === 'Good,Better,Best', vi.map(t => t.name).join(','))

  // ── 4. Settings: chain link Dig set waits for its prices ──
  await page.goto(`${APP}/settings`); await sleep(1500)
  await page.locator('[data-settings-tab="styles"]').click(); await sleep(1200)
  const ds = page.locator('[data-tree-option="chain:install:ds"]')
  const dsText = (await ds.textContent().catch(() => '')) || ''
  check('Settings: chain link Install has No dig and Dig set', await page.locator('[data-tree-option="chain:install:nd"]').count() === 1 && await ds.count() === 1)
  check('Settings: Dig set is not available for quoting until its 12 post parts are priced, then on by itself', /Not available for quoting: waiting for prices on 12 parts in Inventory\. It switches on by itself/.test(dsText), dsText.slice(0, 160))
  await page.locator('[data-tree-dim="chain:install"]').scrollIntoViewIfNeeded(); await sleep(300)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-cl-dig-set-off.png` })
  check('no page errors', errs.length === 0, errs.join(' | '))
} catch (e) {
  check('ran to the end', false, String(e).slice(0, 300))
} finally { await browser.close() }
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
