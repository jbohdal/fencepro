// Settings → Good Better Best, on the dev copy.
//
//   APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> node e2e/tiers-settings.mjs
//
// Opens /settings?tab=tiers, renames the vinyl Best tier and changes its
// words: the preview changes before saving; after Save a new quote's tier
// cards show the new name and words. The quote's "Edit tiers" link opens the
// page. Sets the vinyl tiers back as they were at the end. Nothing else saved.

import { chromium } from 'playwright'

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
const api = async (p, init = {}) => {
  const r = await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } })
  const j = await r.json().catch(() => ({}))
  return j.data ?? j
}
const NEW_NAME = 'Best E2E', NEW_TEXT = `Strongest fence, tested ${Date.now().toString(36)}`
let original = null

const browser = await chromium.launch()
try {
  original = (await api('/api/tier-sets')).find(s => s.category === 'Vinyl')
  check('setup: the vinyl tier set is there, Good, Better, Best', original && original.tiers.map(t => t.key).join(',') === 'good,better,best', JSON.stringify(original?.tiers?.map(t => t.name)))

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 300)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))

  await page.goto(`${APP}/settings?tab=tiers`)
  await page.waitForSelector('[data-tier-settings]', { timeout: 30000 }); await sleep(1200)
  const setNames = await page.locator('[data-tier-set]').evaluateAll(els => els.map(e => e.getAttribute('data-tier-set')))
  check('the page opens at /settings?tab=tiers with a set per category', ['Vinyl', 'Chainlink', 'Aluminum'].every(c => setNames.includes(c)), setNames.join(','))
  check('Vinyl is open with its three tiers', await page.locator('[data-tier-set-open="Vinyl"] [data-tier-setting]').count() === 3)
  const pv = page.locator('[data-preview-tier="best"]')
  const before = (await pv.locator('[data-preview-price]').textContent()).trim()
  check('the preview prices Best for the sample yard', /^\$[\d,]+$/.test(before), before)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-tiers-settings.png` })

  const best = page.locator('[data-tier-setting="best"]')
  await best.locator('[data-tier-name]').fill(NEW_NAME)
  await best.locator('[data-tier-text]').fill(NEW_TEXT)
  await sleep(300)
  check('the preview shows the new name and words before saving', (await pv.locator('[data-preview-name]').textContent()).trim() === NEW_NAME && (await pv.locator('[data-preview-text]').textContent()).trim() === NEW_TEXT)
  await page.locator('[data-preview-yard]').selectOption('straight150'); await sleep(300)
  const straight = (await pv.locator('[data-preview-price]').textContent()).trim()
  check('another sample yard prices differently', straight !== before, `${before} -> ${straight}`)
  await page.locator('[data-tier-preview]').scrollIntoViewIfNeeded()
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/dev-tiers-preview.png` })
  await page.locator('[data-save-tiers]').click(); await sleep(1200)
  const saved = (await api('/api/tier-sets')).find(s => s.category === 'Vinyl')
  check('Save: the server has the new name and words', saved.tiers[2].name === NEW_NAME && saved.tiers[2].text === NEW_TEXT)

  // A new quote picks it up at once.
  await page.goto(`${APP}/?quote=new`)
  await page.waitForSelector('[data-quote-window]', { timeout: 30000 }); await sleep(800)
  const b = page.locator('[data-quote-builder]')
  await b.locator('[data-step="yard"]').click()
  await b.locator('[data-shape="straight"]').click(); await sleep(300)
  await b.locator('[data-side-open="true"] [data-side-length]').click()
  for (const k of ['1', '5', '0']) await page.locator(`[data-ftin-pad] [data-pad-key="${k}"]`).click()
  await page.locator('[data-ftin-pad] [data-pad-done]').click(); await sleep(300)
  await b.locator('[data-step="style"]').click()
  await b.locator('[data-step-panel="style"] select').first().selectOption({ label: "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig" }); await sleep(500)
  await b.locator('[data-step="price"]').click(); await sleep(800)
  const card = b.locator('[data-tier="best"]')
  check("a new quote's Best card shows the new name and words", (await card.locator('[data-tier-name]').textContent()).trim() === NEW_NAME && (await card.locator('[data-tier-text]').textContent()).trim() === NEW_TEXT)
  check('Best is white like the quote, 6 ft wide sections', (await card.locator('[data-tier-style]').textContent()).includes('White Vinyl Privacy, 6 ft tall, 6 ft panels, No dig'))
  await b.locator('[data-step="style"]').click()
  await b.locator('[data-step-panel="style"] select').first().selectOption({ label: "Tan Vinyl Privacy, 6 ft tall, 8 ft panels, No dig" }); await sleep(500)
  await b.locator('[data-step="price"]').click(); await sleep(600)
  check('a tan quote gets a tan Best', (await card.locator('[data-tier-style]').textContent()).includes('Tan Vinyl Privacy, 6 ft tall, 6 ft panels, No dig'))
  await b.locator('[data-edit-tiers]').click(); await sleep(1500)
  check('"Edit tiers" on the quote opens the Good Better Best page', new URL(page.url()).pathname === '/settings' && page.url().includes('tab=tiers') && await page.locator('[data-tier-settings]').isVisible(), page.url())
  check('no page errors', errors.length === 0, errors.join(' | '))
  await ctx.close()
} catch (e) {
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
} finally {
  if (original) {
    const cur = (await api('/api/tier-sets')).find(s => s.id === original.id)
    if (cur) await api(`/api/tier-sets/${original.id}`, { method: 'PUT', body: JSON.stringify({ tiers: original.tiers, popular: original.popular, version: cur.version }) })
    const back = (await api('/api/tier-sets')).find(s => s.id === original.id)
    check('cleanup: the vinyl tiers are back as they were', JSON.stringify(back?.tiers) === JSON.stringify(original.tiers))
  }
  await browser.close()
}
const passed = results.filter(Boolean).length
console.log(`\n${passed} of ${results.length} checks passed`)
process.exit(passed === results.length ? 0 : 1)
