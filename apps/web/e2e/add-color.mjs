// Settings → Fence Styles: adding a color and a choice, on a phone (390 x 844, touch).
//
//   E2E_ACCESS_TOKEN=<dev owner token> APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//     SHOTS=<folder, optional> node e2e/add-color.mjs
//
// Dev only (4001). Since Oct 21, 2026 a vinyl color is added with one form in
// Settings → Price List → Vinyl Colors (e2e/vinyl-color-form.mjs tests it);
// Vinyl → Privacy → + Add color leads there. The Add color steps here are
// for chain link finishes: a finish copying Galvanized, priced by part, is
// added; its fences, kits and parts are made (parts with no price), it is not
// available for quoting until priced, and the quote builder shows it held.
// It is removed, then a choice (Semi privacy) is added and removed, and
// Settings, Inventory and kits are checked to be exactly as before.
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
const raw = async (p, init = {}) => (await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json().catch(() => ({}))
const api = async (p, init = {}) => { const j = await raw(p, init); return j.data ?? j }
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }) }

const FINISH = 'E2E Green', KEY = 'e2e-green', TAG = `chain:finish:${KEY}`
const snapshot = async () => {
  const bs = await api('/api/business-state'), inv = await api('/api/inventory-state')
  const finishes = (bs.config.fenceCatalog?.materials?.find(m => m.key === 'chain')?.dims.find(d => d.key === 'finish')?.options ?? []).map(o => o.key)
  return { styles: bs.config.fenceStyles.map(s => s.name), catalog: JSON.stringify(bs.config.fenceCatalog ?? null), finishes, items: inv.items.map(i => i.name).sort(), kits: (inv.kits ?? []).map(k => k.id).sort(), bs, inv }
}
const before = await snapshot()
const GALV = before.bs.config.fenceStyles.filter(s => s.isActive !== false && (s.choices?.finish === 'galv' || /^CL - (\d'|Com 6'(\+1')?)( Galv)?$/.test(s.name)) && !/Black/.test(s.name))
check('setup: no Semi privacy choice left from an earlier run (the test adds it and removes it)', !before.bs.config.fenceStyles.some(s => s.choices?.style === 'semi-privacy'))
check('setup: no test finish left from an earlier run', !before.finishes.includes(KEY) && !before.styles.some(n => n.includes(KEY)))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
page.on('dialog', d => d.accept().catch(() => {}))
await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))

async function openStyles() {
  await page.goto(`${APP}/settings?tab=styles`); await page.waitForSelector('[data-styles-tree]', { timeout: 60000 }); await sleep(1200)
}
const tap = async sel => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await l.tap() }
const wizNext = async () => { await tap('[data-wiz-next]'); await sleep(350) }

try {
  // ── The tree ──
  await openStyles()
  check('Settings → Fence Styles: a tree by material (vinyl, chain link, aluminum, other, wood), not a table of codes', await page.locator('[data-tree-material]').count() === 5 && await page.locator('[data-tree-option="vinyl:style:privacy"]').isVisible())
  await page.locator('[data-tree-material="vinyl"]').scrollIntoViewIfNeeded(); await shot(page, 'dev-styles-tree')

  // ── A vinyl color: the one form in Price List ──
  await tap('[data-add-color-under="vinyl:style:privacy"]')
  await page.waitForSelector('[data-vc-form]', { timeout: 15000 })
  check('Vinyl → Privacy → + Add color opens Settings → Price List → Vinyl Colors → Add Color', page.url().includes('tab=price_list'))
  await tap('[data-sheet-close]'); await sleep(300)

  // ── A chain link finish: the Add color steps ──
  await openStyles()
  await tap('[data-add-color="chain"]'); await page.waitForSelector('[data-wiz-step="name"]')
  await page.locator('[data-color-name]').fill(FINISH); await shot(page, 'dev-add-finish-1-name'); await wizNext()
  check('step 2: copies parts from Galvanized', await page.locator('[data-copy-from="galv"]').count() === 1)
  await tap('[data-copy-from="galv"]'); await wizNext()
  await tap('[data-pricing="part"]'); await sleep(200); await shot(page, 'dev-add-finish-3-pricing'); await wizNext()
  check('step 4: the finish parts with Galvanized\'s quantities', await page.locator('[data-override-row]').count() > 0)
  await tap('[data-wiz-finish]'); await sleep(3000)

  let s = await snapshot()
  const made = s.bs.config.fenceStyles.filter(x => x.material === 'chain' && x.choices?.finish === KEY)
  const newItems = s.inv.items.filter(i => i.madeFor === TAG)
  check('saved on the server: its fences (one per Galvanized fence), kits and Inventory parts', made.length > 0 && made.length >= GALV.length && (s.inv.kits ?? []).some(k => k.madeFor === TAG) && newItems.length > 0, `${made.length} fences, ${newItems.length} parts`)
  check('its parts have the finish in their names and no price yet', newItems.every(i => i.unitCost === 0 && i.name.includes(FINISH)))
  await openStyles()
  const waiting = page.locator(`[data-color-waiting="${KEY}"]`)
  check('the tree says it is not available for quoting until its parts are priced', await waiting.isVisible() && /waiting for prices on \d+ part/.test(await waiting.textContent()), await waiting.textContent())
  await waiting.scrollIntoViewIfNeeded(); await shot(page, 'dev-add-finish-4-off-until-priced')
  const stylesOff = (await api('/api/quotes/styles')).map(x => x.name)
  check('not offered to customers (chat, phone, widget) while not priced', !stylesOff.some(n => n.includes(KEY)))
  await page.goto(`${APP}/quotes?quote=new`); await page.waitForSelector('[data-quote-builder]', { timeout: 60000 }); await sleep(800)
  await tap('[data-step="style"]'); await sleep(400); await tap('[data-choice-material="chain"]'); await sleep(300)
  check('quote builder: the finish is greyed (held) while not priced', await page.locator(`[data-choice-dim="finish"][data-choice-key="${KEY}"]`).getAttribute('data-choice-state') === 'held')
  await page.locator('[data-quote-close]').tap().catch(() => {}); await sleep(500)

  // ── Remove the finish ──
  await openStyles()
  await tap(`[data-edit-option="chain:finish:${KEY}"]`); await page.waitForSelector('[data-wiz-step="name"]')
  await tap('[data-color-remove]'); await sleep(3000)
  const removeErr = await page.locator('[data-wiz-error]').textContent().catch(() => '')
  check('removed (no saved quote uses it)', !removeErr, removeErr)

  // ── Adding a choice the same way: Semi privacy, then removed ──
  await openStyles()
  await tap('[data-add-choice="vinyl:style"]'); await page.waitForSelector('[data-choice-dialog]')
  await page.locator('[data-choice-label]').fill('Semi privacy'); await page.locator('[data-choice-copy="privacy"]').tap()
  await shot(page, 'dev-add-height-or-style')
  await tap('[data-choice-save]'); await page.waitForSelector('[data-choice-dialog]', { state: 'detached', timeout: 30000 }).catch(() => {}); await sleep(2500)
  s = await snapshot()
  const semi = s.bs.config.fenceStyles.filter(x => x.choices?.style === 'semi-privacy')
  check('Semi privacy added: its fences copied from Privacy, turned off until checked', semi.length > 10 && (await page.locator('[data-tree-option="vinyl:style:semi-privacy"] [role="switch"]').getAttribute('aria-checked')) === 'false', `${semi.length} fences`)
  await tap('[data-edit-option="vinyl:style:semi-privacy"]'); await page.waitForSelector('[data-choice-dialog]'); await tap('[data-choice-remove]'); await sleep(2500)
  // The settings save is debounced and a second edit right after the first merges with it: wait for the server to show the removal (up to 30 s).
  for (let i = 0; i < 15; i++) { s = await snapshot(); if (!s.bs.config.fenceStyles.some(x => x.choices?.style === 'semi-privacy')) break; await sleep(2000) }
  check('Semi privacy removed with its fences and kits', !s.bs.config.fenceStyles.some(x => x.choices?.style === 'semi-privacy') && !(s.inv.kits ?? []).some(k => k.madeFor === 'vinyl:style:semi-privacy'))
} catch (e) {
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 14).join(' '))
}

// ── Nothing left behind ──
// If the removal above did not reach the server (Oct 31 2026: a removal right after the add in the same page shows removed on screen
// but the server keeps the choice; a reload shows it again), take it out on a fresh page so the dev copy is not left with a test choice.
// The failed check above stays failed.
try {
  if ((await snapshot()).bs.config.fenceStyles.some(x => x.choices?.style === 'semi-privacy')) {
    await openStyles()
    await tap('[data-edit-option="vinyl:style:semi-privacy"]'); await page.waitForSelector('[data-choice-dialog]'); await tap('[data-choice-remove]'); await sleep(4000)
  }
} catch (e) { console.log('cleanup of Semi privacy did not finish:', String(e).split('\n')[0].slice(0, 200)) }
await sleep(1500)
const after = await snapshot()
check('nothing left: the fence styles are exactly as before', JSON.stringify(after.styles) === JSON.stringify(before.styles))
check('nothing left: the choice tree is as before (no test finish)', !after.finishes.includes(KEY) && after.catalog === before.catalog)
check('nothing left: Inventory items and kits are as before', JSON.stringify(after.items) === JSON.stringify(before.items) && JSON.stringify(after.kits) === JSON.stringify(before.kits), `${after.items.length} / ${before.items.length} items, ${after.kits.length} / ${before.kits.length} kits`)
check('no page errors', errs.length === 0, errs.join(' | '))
await browser.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
