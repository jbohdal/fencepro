// Settings → Price List → Vinyl Colors → Add Color, start to finish, on a
// computer (Chromium, 1440 x 900) and on a phone (WebKit, 390 x 844, touch).
//
//   E2E_ACCESS_TOKEN=<dev owner token> APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//     SHOTS=<folder, optional> node e2e/vinyl-color-form.mjs
//
// Dev only (4001). The form is filled in as Jonathan's Chai Gray was, under a
// test name (E2E Clay) so the real Chai Gray on dev is left alone: per
// section, 6x8, $184.00 a section with 15 pickets, 2 rails at 8 ft and 2 U
// channels, one post price ($38.92), cap $3.86, upright $13.36, ND and DS.
// Stiffeners (Nov 5, 2026) in the Pieces part of the form: picket stiffener
// ticked at $5.85, 3 a section and 3 a gate leaf; rail stiffener ticked, 1 and
// 1 (an 8 ft rail's: White's rail insert, priced in Inventory). Saved: the
// confirmation lists what it made; the color is in the quote builder's
// choices; a quote on it prices with the section kit (the section once per
// section, its parts at $0, the stiffeners priced lines); Edit opens with the
// stiffeners as saved. The real Chai Gray's Edit shows the stiffeners its kits
// hold (not saved). Then Undo, and Settings, Inventory, kits and price history
// are as before.
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
    for (const k of ['pickets', 'rails', 'railFt', 'uChannels']) start[k] = await page.locator(`[data-vc-count="6x8:${k}"]`).inputValue()
    check(`${name}: the section's contents start at White's 6x8 section (15 pickets, 2 rails at 8 ft, 2 U channel)`, JSON.stringify(start) === JSON.stringify({ pickets: '15', rails: '2', railFt: '8', uChannels: '2' }), JSON.stringify(start))
    check(`${name}: stiffeners are not in the section's contents any more`, await page.locator('[data-vc-count="6x8:picketStiffeners"], [data-vc-count="6x8:railStiffeners"]').count() === 0)
    await fill('[data-vc-money="section:6x8"]', '184.00')
    // ── Stiffeners: in Pieces, each ticked with a price and counts ──
    check(`${name}: Pieces has a picket and a rail stiffener, not ticked`, await page.locator('[data-vc-stiffener-on="picket"]').count() === 1 && await page.locator('[data-vc-stiffener-on="rail"]').count() === 1 && !(await page.locator('[data-vc-stiffener-on="picket"]').isChecked()))
    await tap('[data-vc-stiffener-on="picket"]'); await sleep(150)
    await fill('[data-vc-stiffener-price="picket"]', '5.85')
    await fill('[data-vc-stiffener-count="picket:6x8"]', '3')
    await fill('[data-vc-stiffener-count="picket:leaf"]', '3')
    await tap('[data-vc-stiffener-on="rail"]'); await sleep(150)
    check(`${name}: an 8 ft rail's stiffener is White's rail insert: no price to type, the shared part named`, await page.locator('[data-vc-stiffener-price="rail"]').count() === 0 && /White’s Rail Insert/.test(await page.locator('[data-vc-stiffener="rail"]').textContent()))
    await fill('[data-vc-stiffener-count="rail:6x8"]', '1')
    await fill('[data-vc-stiffener-count="rail:leaf"]', '1')
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
    // 10: the rail stiffener is White's rail insert, already in Inventory (Jonathan, Oct 21).
    check(`${name}: the confirmation lists every catalog item (10), both fences and both kit sets`, listed.length === 10 && styles.join('|') === `${ND}|${DS}` && kits === 2, `${listed.length} items, ${styles.join(', ')}, ${kits} kits`)
    check(`${name}: …with the section at $184.00, its parts at $0 (in the section kit) and the picket stiffener at $5.85`, listed.some(t => t.includes('Section, 6x8') && t.includes('$184.00')) && listed.filter(t => t.includes('$0 (in the section kit)')).length === 3 && listed.some(t => t.includes('Picket Stiffener') && t.includes('$5.85')), listed.join(' / '))
    check(`${name}: …and Undo for 24 hours`, await page.locator('[data-vc-created-undo]').count() === 1)
    if (SHOTS) await page.locator('[data-sheet="vinyl-color-created"] > div').screenshot({ path: `${SHOTS}/${phone ? 'e2e-color-created-phone' : 'e2e-color-created'}.png` })
    const s = await snapshot()
    const made = s.bs.config.fenceStyles.filter(x => x.material === 'vinyl' && x.choices?.color === KEY)
    const history = (await api(`/api/vinyl-colors`)).records?.find(r => r.key === KEY)
    check(`${name}: saved on the server: 2 fences, 2 kit sets, 10 catalog items, 7 dated costs`, made.length === 2 && (s.inv.kits ?? []).filter(k => k.madeFor === TAG).length === 2 && s.inv.items.filter(i => i.madeFor === TAG).length === 10 && history?.created.priceHistoryIds.length === 7, `${history?.created.priceHistoryIds.length} dated costs`)
    const insertCost = s.inv.items.find(i => i.name.trim() === "Vinyl, Rail Insert, 8'")?.unitCost
    await tap('[data-vc-created-done]'); await sleep(300)

    // ── Edit opens with the stiffeners as saved ──
    await tap(`[data-vc-edit="${KEY}"]`); await page.waitForSelector('[data-vc-form]')
    const got = {}
    for (const k of ['picket:6x8', 'picket:leaf', 'rail:6x8', 'rail:leaf']) got[k] = await page.locator(`[data-vc-stiffener-count="${k}"]`).inputValue()
    check(`${name}: Edit: both stiffeners ticked, $5.85, 3 and 3, 1 and 1`, await page.locator('[data-vc-stiffener-on="picket"]').isChecked() && await page.locator('[data-vc-stiffener-on="rail"]').isChecked() && await page.locator('[data-vc-stiffener-price="picket"]').inputValue() === '5.85' && JSON.stringify(got) === JSON.stringify({ 'picket:6x8': '3', 'picket:leaf': '3', 'rail:6x8': '1', 'rail:leaf': '1' }), JSON.stringify(got))
    if (SHOTS) { await page.locator('[data-vc-pieces]').scrollIntoViewIfNeeded(); await page.locator('[data-sheet="vinyl-color-form"] > div').screenshot({ path: `${SHOTS}/${phone ? 'e2e-color-stiffeners-phone' : 'e2e-color-stiffeners'}.png` }) }
    await tap('[data-sheet-close]'); await sleep(300)

    // ── The real Chai Gray: Edit shows its stiffeners; nothing is saved. Made before Nov 5 in section mode, its stiffeners
    // were in the section kit at $0 and the form said saving charges them. Jonathan saved it again on live on Nov 5 2026 (by
    // the piece, stiffeners on the form), so a copy of live from then on has them saved and nothing to warn about. ──
    const cgForm = JSON.parse(before.catalog)?.materials?.find(m => m.key === 'vinyl')?.dims?.find(d => d.key === 'color')?.options?.find(o => o.key === 'chai-gray')?.color?.form
    const cgWarns = cgForm?.mode === 'section' && !cgForm?.stiffeners
    if (await page.locator('[data-vc-edit="chai-gray"]').count()) {
      await tap('[data-vc-edit="chai-gray"]'); await page.waitForSelector('[data-vc-form]')
      const cg = {}
      for (const k of ['picket:6x8', 'picket:leaf', 'rail:6x8', 'rail:leaf']) cg[k] = await page.locator(`[data-vc-stiffener-count="${k}"]`).inputValue().catch(() => '')
      const cgText = await page.locator('[data-vc-stiffener="picket"]').textContent()
      check(`${name}: Chai Gray's Edit shows its 3 picket stiffeners and 1 rail insert, a section and a leaf${cgWarns ? ', and says saving charges them' : ' (saved on the form: no "saving charges it")'}`, await page.locator('[data-vc-stiffener-on="picket"]').isChecked() && JSON.stringify(cg) === JSON.stringify({ 'picket:6x8': '3', 'picket:leaf': '3', 'rail:6x8': '1', 'rail:leaf': '1' }) && /saving charges it/.test(cgText) === cgWarns, `${JSON.stringify(cg)} picket ticked: ${await page.locator('[data-vc-stiffener-on="picket"]').isChecked()}, text: ${cgText.slice(0, 160)}`)
      await tap('[data-sheet-close]'); await sleep(300)
    }

    // ── In the quote builder now ──
    await page.goto(`${APP}/quotes?quote=new`); await page.waitForSelector('[data-quote-builder]', { timeout: 60000 }); await sleep(800)
    await tap('[data-step="style"]'); await sleep(400); await tap('[data-choice-material="vinyl"]'); await sleep(300)
    const state = await page.locator(`[data-choice-dim="color"][data-choice-key="${KEY}"]`).getAttribute('data-choice-state')
    check(`${name}: quote builder: ${COLOR} is a color choice, available for quoting`, state === 'ok', state)
    await tap(`[data-choice-dim="color"][data-choice-key="${KEY}"]`); await sleep(300)
    await tap('[data-choice-dim="install"][data-choice-key="nd"]').catch(() => {}); await sleep(200)
    await tap('[data-choice-dim="width"][data-choice-key="8"]'); await sleep(300)
    const plain = (await page.locator('[data-style-plain-name]').textContent()).trim()
    check(`${name}: picked, and shown by its plain name`, plain === `${COLOR} Vinyl Privacy, 6 ft tall, 8 ft sections, No dig`, plain)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${phone ? 'e2e-color-quote-phone' : 'e2e-color-quote'}.png` })

    // A quote on it, priced by the server the way the builder prices it.
    const est = await api('/api/quotes/calculate', { method: 'POST', body: JSON.stringify({ fenceStyle: ND, runs: [50, 50], corners: 2, ends: 2, walkGates: 1, dblGates: 0, tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0 }) })
    const line = n => (est.pullSheet ?? []).find(l => l.item === n)
    const sec = line(SECTION)
    check(`${name}: the quote prices: 15 section kits (14 sections + the gate leaf) at $184.00, once`, est.price > 0 && sec?.qty === 15 && sec?.unitCost === 184 && (est.pullSheet ?? []).filter(l => l.item === SECTION).length === 1, JSON.stringify(sec))
    const kit = [...['Picket', "Rail, 8'"].map(p => line(`*Vinyl, ${COLOR}, ${p}`)), line(`*Vinyl, ${COLOR}, U Channel`)]
    check(`${name}: the kit's parts itemized at $0 (225 pickets, 30 rails, 30 U channel)`, kit.map(l => l?.qty).join(',') === '225,30,30' && kit.every(l => l?.total === 0), kit.map(l => `${l?.qty}@${l?.unitCost}`).join(' '))
    // Stiffeners: priced lines, 3 and 1 in each of the 15 section kits. The rail insert (White's, shared) at its Inventory price.
    const ps = line(`*Vinyl, ${COLOR}, Picket Stiffener`), ri = (est.pullSheet ?? []).find(l => l.item.trim() === "Vinyl, Rail Insert, 8'")
    check(`${name}: 45 picket stiffeners at $5.85 and 15 rail inserts at Inventory's $${insertCost}, priced`, ps?.qty === 45 && ps?.unitCost === 5.85 && ri?.qty === 15 && ri?.unitCost === insertCost && insertCost > 0, `${ps?.qty}@${ps?.unitCost} ${ri?.qty}@${ri?.unitCost}`)

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
  const styleDiff = () => {
    const a = JSON.parse(before.styles), b = JSON.parse(after.styles), byId = l => new Map(l.map(x => [x.id, JSON.stringify(x)]))
    const A = byId(a), B = byId(b)
    return [`${a.length} -> ${b.length}`, ...[...B.keys()].filter(k => !A.has(k)).map(k => `added ${JSON.parse(B.get(k)).name}`), ...[...A.keys()].filter(k => !B.has(k)).map(k => `gone ${JSON.parse(A.get(k)).name}`),
      ...[...A.keys()].filter(k => B.has(k) && A.get(k) !== B.get(k)).map(k => { const x = JSON.parse(A.get(k)), y = JSON.parse(B.get(k)); return `changed ${x.name}: ${[...new Set([...Object.keys(x), ...Object.keys(y)])].filter(f => JSON.stringify(x[f]) !== JSON.stringify(y[f])).map(f => `${f} ${JSON.stringify(x[f])} -> ${JSON.stringify(y[f])}`).join(', ')}` })].slice(0, 8).join(' | ')
  }
  check(`${name}: nothing left: fence styles exactly as before`, after.styles === before.styles, after.styles === before.styles ? '' : styleDiff())
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
