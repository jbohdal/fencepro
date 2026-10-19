// Inventory > Fill in: $0 prices, gate parts, a Durafence parts list.
//
//   E2E_ACCESS_TOKEN=<dev staff token> SHOTS=<folder, optional> node e2e/fill-in.mjs
//
// Dev only (4001). While commercial and industrial styles are not available
// for quoting, their gate parts and the Durafence list are left out. Then it
// turns CL - Com 6' and Durafence back on for quoting, adds a part to a
// commercial chain link walk gate, starts a Durafence parts list with a new
// part, saves each, and checks Inventory, the kits and a quote's material.
// Puts Inventory and the styles back after.
import { chromium } from 'playwright'
const API = 'http://localhost:4001', TOKEN = process.env.E2E_ACCESS_TOKEN || '', SHOTS = process.env.SHOTS || ''
if (!TOKEN) { console.error('Set E2E_ACCESS_TOKEN.'); process.exit(2) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`) }
const call = async (p, init = {}) => (await fetch(API + p, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } })).json()
const api = async (p, init) => (await call(p, init)).data
const before = await api('/api/inventory-state')
const put = async (items, kits) => { const cur = await api('/api/inventory-state'); const { bundles, locations, stockLevels, transactions } = cur; return call('/api/inventory-state', { method: 'PUT', body: JSON.stringify({ items, bundles, locations, stockLevels, transactions, kits, baseVersion: cur.version }) }) }
const estimate = async (fenceStyle, walkGates = 0) => (await call('/api/quotes/calculate', { method: 'POST', body: JSON.stringify({ fenceStyle, runs: [100], corners: 0, ends: 2, walkGates, dblGates: 0, tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0 }) }))
const bsGet = () => api('/api/business-state')
const setQuotable = async (names, on) => {
  for (let i = 0; i < 5; i++) {
    const bs = await bsGet()
    const fenceStyles = bs.config.fenceStyles.map(s => names.includes(s.name) ? { ...s, quotable: typeof on === 'function' ? on(s.name) : on } : s)
    const r = await call('/api/business-state', { method: 'PATCH', body: JSON.stringify({ config: { ...bs.config, fenceStyles }, baseVersion: bs.version }) })
    if (r.success) return r
  }
  throw new Error('could not save the styles')
}
const HELD = ["CL - Com 6'", "CL - Com 6'+1'", "CL - Com 6'+1' Black", 'Alum - DS - Ind Abigail', 'Durafence']
const heldBefore = Object.fromEntries((await bsGet()).config.fenceStyles.filter(s => HELD.includes(s.name)).map(s => [s.name, s.quotable]))
const b = await chromium.launch()
try {
  // On hold: no gate parts or Durafence list, on the screen or on the Finish setup card.
  await setQuotable(HELD, false)
  const heldSetup = (await api('/api/system/setup')).find(i => i.key === 'fill-in')
  check('on hold: Finish setup "Fill in" leaves out commercial gate parts and Durafence', !!heldSetup && !/gate parts|Durafence/.test(heldSetup.detail.split('.')[0]), heldSetup?.detail)
  {
    const c0 = await b.newContext({ viewport: { width: 1280, height: 900 } })
    await c0.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
    const p0 = await c0.newPage()
    await p0.goto(`${API}/inventory?tab=fillin`); await p0.waitForSelector('[data-fill-in]', { timeout: 60000 }); await sleep(800)
    check('on hold: Fill in has no gate parts and no Durafence section', await p0.locator('[data-fill-gates], [data-fill-durafence]').count() === 0)
    const usedBy = await p0.locator('[data-fill-price-row]').allInnerTexts()
    const onlyHeld = usedBy.filter(t => /Used by /.test(t)).filter(t => t.split('Used by ')[1].trim().split(', ').every(n => HELD.includes(n.trim())))
    check('on hold: no part listed that only an on hold style uses', onlyHeld.length === 0, onlyHeld.join(' | '))
    await c0.close()
  }
  await setQuotable(["CL - Com 6'", 'Durafence'], true)
  // The server reads Settings again every few seconds.
  for (let i = 0; i < 15 && !(await estimate("CL - Com 6'")).success; i++) await sleep(1000)
  const setupBefore = (await api('/api/system/setup')).find(i => i.key === 'fill-in')
  check('turned back on: Finish setup lists "Fill in Inventory" with what is left', !!setupBefore && !setupBefore.done && /prices at \$0/.test(setupBefore.detail) && /Durafence/.test(setupBefore.detail), setupBefore?.detail)
  const zeroBefore = before.items.filter(i => i.status !== 'inactive' && i.status !== 'discontinued' && !(i.unitCost > 0))
  const gateBefore = await estimate("CL - Com 6'", 1), plainBefore = await estimate("CL - Com 6'")

  const c = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await c.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
  const p = await c.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
  await p.goto(`${API}${setupBefore?.link || '/inventory?tab=fillin'}`); await p.waitForSelector('[data-fill-in]', { timeout: 60000 }); await sleep(800)
  const rows = await p.locator('[data-fill-prices] [data-fill-price-row]').count()
  check('every $0 price is listed', rows >= zeroBefore.length && zeroBefore.length > 0, `${rows} rows, ${zeroBefore.length} at $0`)
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-fill-in-prices.png` })
  // A price.
  const first = zeroBefore[0]
  await p.locator(`[data-fill-price-row="${first.name.replace(/"/g, '\\"')}"] [data-fill-price]`).fill('12.34')
  await p.locator('[data-fill-save-prices]').click(); await sleep(2500)
  const afterPrice = (await api('/api/inventory-state')).items.find(i => i.id === first.id)
  check('a typed price is saved into Inventory, dated today', afterPrice?.unitCost === 12.34 && !!afterPrice?.priceUpdatedAt, `${afterPrice?.name}: ${afterPrice?.unitCost} ${afterPrice?.priceUpdatedAt}`)
  // A gate part for commercial chain link: a 4 ft gate frame from Inventory.
  const walk = p.locator(`[data-fill-style="CL - Com 6'"] [data-fill-kit="walkGate"]`)
  await walk.locator('[data-fill-search]').fill('Gate, 6 x 4'); await sleep(300)
  const found = await walk.locator('[data-fill-found]').count()
  if (found) await walk.locator('[data-fill-found]').first().click()
  else { await walk.locator('[data-fill-search]').fill('E2E Commercial Gate Frame'); await walk.locator('[data-fill-new-price]').fill('150'); await walk.locator('[data-fill-new-add]').click() }
  await sleep(300)
  if (SHOTS) await walk.screenshot({ path: `${SHOTS}/dev-fill-in-gate.png` })
  await p.locator('[data-fill-save-gates]').click(); await sleep(2500)
  const kits = (await api('/api/inventory-state')).kits
  const com = kits.find(k => k.styleName === "CL - Com 6'" && !k.archived)
  check('gate parts saved into that style\'s kit, marked filled in', !!com?.filledInAt && (com.kits.walkGate ?? []).length >= 3, JSON.stringify(com?.kits?.walkGate?.map(x => x.part)))
  let gateAfter = await estimate("CL - Com 6'", 1), plainAfter = await estimate("CL - Com 6'")
  for (let i = 0; i < 15 && gateAfter.data?.materialCost - plainAfter.data?.materialCost < 30; i++) { await sleep(1000); gateAfter = await estimate("CL - Com 6'", 1); plainAfter = await estimate("CL - Com 6'") }
  const added = (gateAfter.data?.materialCost - plainAfter.data?.materialCost) - (gateBefore.data?.materialCost - plainBefore.data?.materialCost)
  check('a quote with a gate now carries the gate', added > 20, `gate adds ${(gateAfter.data?.materialCost - plainAfter.data?.materialCost)?.toFixed(2)} (was ${(gateBefore.data?.materialCost - plainBefore.data?.materialCost)?.toFixed(2)})`)
  // Durafence: a new part with its price.
  const sec = p.locator('[data-fill-durafence] [data-fill-kit="section"]')
  await sec.locator('[data-fill-search]').fill('E2E Durafence Panel 8ft'); await sec.locator('[data-fill-new-price]').fill('95'); await sec.locator('[data-fill-new-add]').click(); await sleep(300)
  await sec.locator('[data-fill-qty]').first().fill('1')
  await p.locator('[data-fill-save-durafence]').click(); await sleep(2500)
  const st = await api('/api/inventory-state')
  check('a new part goes into Inventory with its price', st.items.some(i => i.name === 'E2E Durafence Panel 8ft' && i.unitCost === 95))
  // The server reads Inventory again every few seconds.
  let dura = await estimate('Durafence')
  for (let i = 0; i < 15 && !(dura.data?.materialCost > 0); i++) { await sleep(1000); dura = await estimate('Durafence') }
  check('Durafence quotes now carry material (13 sections x $95)', Math.abs((dura.data?.materialCost ?? 0) - 13 * 95) < 0.01, String(dura.data?.materialCost))
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/dev-fill-in-durafence.png`, fullPage: true })
  check('no page errors', errs.length === 0, errs.join(' | '))
  await c.close()
} catch (e) {
  check('test run finished', false, String(e?.message || e).slice(0, 300))
} finally {
  const r = await put(before.items, before.kits ?? [])
  check('Inventory put back as it was', !!r?.success)
  await setQuotable(HELD, n => heldBefore[n]).catch(e => check('styles put back', false, String(e)))
  await b.close()
}
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
