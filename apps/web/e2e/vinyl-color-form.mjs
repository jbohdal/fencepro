// Settings → Price List → Vinyl Colors → Add Color, start to finish, on a
// computer (Chromium, 1440 x 900) and on a phone (WebKit, 390 x 844, touch).
//
//   E2E_ACCESS_TOKEN=<dev owner token> APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//     SHOTS=<folder, optional> node e2e/vinyl-color-form.mjs
//
// Dev only (4001). The form is filled in as Jonathan's Chai Gray was, under a
// test name (E2E Clay) so the real Chai Gray on dev is left alone: per
// section, 6x8, $184.00 a section with 15 pickets, 2 rails at 8 ft, 3 picket
// stiffeners, 1 rail stiffener and 2 U channels, one post price ($38.92), cap
// $3.86, upright $13.36, ND and DS. Saved: the confirmation lists what it
// made; the color is in the quote builder's choices; a quote on it prices
// with the section kit (the section once per section, its parts at $0). Then
// Undo, and Settings, Inventory, kits and price history are as before.
import './devOnly.mjs' // refuses the live server (port 4000, *.ts.net); dev copy only
import './sharedLock.mjs' // tests that change shared dev data take turns
import { chromium, webkit } from 'playwright'
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

const COLOR = 'E2E Clay', KEY = 'e2e-clay', TAG = `vinyl:color:${KEY}`
const ND = `vinyl/privacy/6/${KEY}/nd/8`, DS = `vinyl/privacy/6/${KEY}/ds/8`
const SECTION = `*Vinyl, ${COLOR}, Section, 6x8`
const snapshot = async () => {
  const bs = await api('/api/business-state'), inv = await api('/api/inventory-state')
  return {
    styles: JSON.stringify(bs.config.fenceStyles), catalog: JSON.stringify(bs.config.fenceCatalog ?? null),
    items: JSON.stringify(inv.items), kits: JSON.stringify(inv.kits ?? []), bs, inv,
  }
}

async function run(engine, name, phone) {
  const before = await snapshot()
  check(`${name}: setup: no test color left from an earlier run`, !before.catalog.includes(`"${KEY}"`) && !before.styles.includes(KEY))
  const browser = await engine.launch()
  const ctx = await browser.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } })
  await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const page = await ctx.newPage()
  const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  page.on('dialog', d => d.accept().catch(() => {}))
  await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
  const tap = async sel => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); phone ? await l.tap() : await l.click() }
  const fill = async (sel, v) => { const l = page.locator(sel).first(); await l.scrollIntoViewIfNeeded(); await l.fill(String(v)) }
  try {
    // ── Fence Styles' vinyl "+ Add color" leads to the one form ──
    await page.goto(`${APP}/settings?tab=styles`); await page.waitForSelector('[data-styles-tree]', { timeout: 60000 }); await sleep(800)
    await tap('[data-add-color-under="vinyl:style:privacy"]')
    await page.waitForSelector('[data-vc-form]', { timeout: 15000 })
    check(`${name}: Fence Styles → Vinyl → + Add color opens Price List → Vinyl Colors → Add Color`, page.url().includes('tab=price_list') && await page.locator('[data-settings-tab="price_list"][aria-pressed="true"]').count() === 1)
    await tap('[data-sheet-close]'); await sleep(400)

    // ── The form ──
    await page.goto(`${APP}/settings?tab=price_list`); await page.waitForSelector('[data-vinyl-colors]', { timeout: 60000 }); await sleep(600)
    check(`${name}: Price List lists the vinyl colors (White, Tan built in)`, await page.locator('[data-vc-color-row="white"]').count() === 1 && await page.locator('[data-vc-color-row="tan"]').count() === 1)
    await tap('[data-vc-add]'); await page.waitForSelector('[data-vc-form]')
    await fill('[data-vc-name]', COLOR)
    await tap('[data-vc-mode="section"]')
    await tap('[data-vc-size="6x8"]'); await sleep(200)
    const start = {}
    for (const k of ['pickets', 'rails', 'railFt', 'picketStiffeners', 'railStiffeners', 'uChannels']) start[k] = await page.locator(`[data-vc-count="6x8:${k}"]`).inputValue()
    check(`${name}: the section's contents start at White's 6x8 section (15 pickets, 2 rails at 8 ft, 1 rail stiffener, 2 U channel)`, JSON.stringify(start) === JSON.stringify({ pickets: '15', rails: '2', railFt: '8', picketStiffeners: '0', railStiffeners: '1', uChannels: '2' }), JSON.stringify(start))
    await fill('[data-vc-money="section:6x8"]', '184.00')
    await fill('[data-vc-count="6x8:picketStiffeners"]', '3')
    check(`${name}: one post price unless "same price for all post types" is unticked`, await page.locator('[data-vc-same-post]').isChecked() && await page.locator('[data-vc-money="post:6:all"]').count() === 1)
    await tap('[data-vc-same-post]'); await sleep(150)
    check(`${name}: unticked: four post prices`, await page.locator('[data-vc-money^="post:6:"]').count() === 4)
    await tap('[data-vc-same-post]'); await sleep(150)
    await fill('[data-vc-money="post:6:all"]', '38.92')
    await fill('[data-vc-money="cap"]', '3.86')
    await fill('[data-vc-money="upright"]', '13.36')
    check(`${name}: ND and DS ticked`, await page.locator('[data-vc-method="nd"]').isChecked() && await page.locator('[data-vc-method="ds"]').isChecked())
    check(`${name}: no field for anything shared (concrete, pipe, hinges...)`, !/concrete cost|hinge cost|pipe cost/i.test(await page.locator('[data-vc-form]').textContent()))
    if (SHOTS) {
      await page.locator('[data-vc-form]').scrollIntoViewIfNeeded()
      const sheet = page.locator('[data-sheet="vinyl-color-form"] > div')
      await page.evaluate(() => { const s = document.querySelector('[data-sheet="vinyl-color-form"] .overflow-y-auto'); if (s) s.scrollTop = 0 })
      await sheet.screenshot({ path: `${SHOTS}/${phone ? 'e2e-color-form-phone' : 'e2e-color-form'}.png` })
    }
    await tap('[data-vc-save]')
    await page.waitForSelector(`[data-vc-created="${KEY}"]`, { timeout: 30000 })

    // ── What it made ──
    const listed = await page.locator('[data-vc-created-item]').allTextContents()
    const styles = await page.locator('[data-vc-created-style]').evaluateAll(els => els.map(e => e.getAttribute('data-vc-created-style')))
    const kits = await page.locator('[data-vc-created-kit]').count()
    check(`${name}: the confirmation lists every catalog item (11), both fences and both kit sets`, listed.length === 11 && styles.join('|') === `${ND}|${DS}` && kits === 2, `${listed.length} items, ${styles.join(', ')}, ${kits} kits`)
    check(`${name}: …with the section at $184.00 and its parts at $0 (in the section kit)`, listed.some(t => t.includes('Section, 6x8') && t.includes('$184.00')) && listed.filter(t => t.includes('$0 (in the section kit)')).length === 5)
    check(`${name}: …and Undo for 24 hours`, await page.locator('[data-vc-created-undo]').count() === 1)
    if (SHOTS) await page.locator('[data-sheet="vinyl-color-created"] > div').screenshot({ path: `${SHOTS}/${phone ? 'e2e-color-created-phone' : 'e2e-color-created'}.png` })
    const s = await snapshot()
    const made = s.bs.config.fenceStyles.filter(x => x.material === 'vinyl' && x.choices?.color === KEY)
    const history = (await api(`/api/vinyl-colors`)).records?.find(r => r.key === KEY)
    check(`${name}: saved on the server: 2 fences, 2 kit sets, 11 catalog items, 6 dated costs`, made.length === 2 && (s.inv.kits ?? []).filter(k => k.madeFor === TAG).length === 2 && s.inv.items.filter(i => i.madeFor === TAG).length === 11 && history?.created.priceHistoryIds.length === 6)
    await tap('[data-vc-created-done]'); await sleep(300)

    // ── In the quote builder now ──
    await page.goto(`${APP}/quotes?quote=new`); await page.waitForSelector('[data-quote-builder]', { timeout: 60000 }); await sleep(800)
    await tap('[data-step="style"]'); await sleep(400); await tap('[data-choice-material="vinyl"]'); await sleep(300)
    const state = await page.locator(`[data-choice-dim="color"][data-choice-key="${KEY}"]`).getAttribute('data-choice-state')
    check(`${name}: quote builder: ${COLOR} is a color choice, available for quoting`, state === 'ok', state)
    await tap(`[data-choice-dim="color"][data-choice-key="${KEY}"]`); await sleep(300)
    await tap('[data-choice-dim="install"][data-choice-key="nd"]').catch(() => {}); await sleep(200)
    await tap('[data-choice-dim="width"][data-choice-key="8"]'); await sleep(300)
    const plain = (await page.locator('[data-style-plain-name]').textContent()).trim()
    check(`${name}: picked, and shown by its plain name`, plain === `${COLOR} Vinyl Privacy, 6 ft tall, 8 ft panels, No dig`, plain)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${phone ? 'e2e-color-quote-phone' : 'e2e-color-quote'}.png` })

    // A quote on it, priced by the server the way the builder prices it.
    const est = await api('/api/quotes/calculate', { method: 'POST', body: JSON.stringify({ fenceStyle: ND, runs: [50, 50], corners: 2, ends: 2, walkGates: 1, dblGates: 0, tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0 }) })
    const line = n => (est.pullSheet ?? []).find(l => l.item === n)
    const sec = line(SECTION)
    check(`${name}: the quote prices: 15 section kits (14 sections + the gate leaf) at $184.00, once`, est.price > 0 && sec?.qty === 15 && sec?.unitCost === 184 && (est.pullSheet ?? []).filter(l => l.item === SECTION).length === 1, JSON.stringify(sec))
    const kit = ['Picket', "Rail, 8'", 'Picket Stiffener', 'Rail Stiffener', 'U Channel'].map(p => line(`*Vinyl, ${COLOR}, ${p}`))
    check(`${name}: the kit's parts itemized at $0 (225 pickets, 30 rails, 45 picket stiffeners, 15 rail stiffeners, 30 U channel)`, kit.map(l => l?.qty).join(',') === '225,30,45,15,30' && kit.every(l => l?.total === 0), kit.map(l => `${l?.qty}@${l?.unitCost}`).join(' '))

    // ── Undo ──
    await page.goto(`${APP}/settings?tab=price_list`); await page.waitForSelector('[data-vinyl-colors]', { timeout: 60000 }); await sleep(600)
    await tap(`[data-vc-undo="${KEY}"]`)
    for (let i = 0; i < 20 && await page.locator(`[data-vc-color-row="${KEY}"]`).count(); i++) await sleep(500)
    check(`${name}: Undo: the color is gone from the list`, await page.locator(`[data-vc-color-row="${KEY}"]`).count() === 0)
  } catch (e) {
    check(`${name}: test run finished`, false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
    // Leave nothing behind.
    await api(`/api/vinyl-colors/${KEY}/undo`, { method: 'POST' })
  }
  await sleep(1000)
  const after = await snapshot()
  check(`${name}: nothing left: fence styles exactly as before`, after.styles === before.styles)
  check(`${name}: nothing left: the choice tree exactly as before`, after.catalog === before.catalog)
  check(`${name}: nothing left: Inventory items and kits exactly as before`, after.items === before.items && after.kits === before.kits)
  // The server's estimates read Settings again at most every few seconds.
  let stylesNow = []
  for (let i = 0; i < 12; i++) { stylesNow = (await api('/api/quotes/styles')).map(x => x.name); if (!stylesNow.some(n => n.includes(KEY))) break; await sleep(1000) }
  check(`${name}: nothing left: not offered for quoting any more`, !stylesNow.some(n => n.includes(KEY)))
  check(`${name}: no page errors`, errs.length === 0, errs.join(' | '))
  await browser.close()
}

await run(chromium, 'computer', false)
await run(webkit, 'phone (WebKit 390x844)', true)
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
