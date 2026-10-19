// Adding a color from Settings, start to finish, on a phone (390 x 844, touch).
//
//   E2E_ACCESS_TOKEN=<dev owner token> APP_URL=http://localhost:4001 API_URL=http://localhost:4001 \
//     SHOTS=<folder, optional> node e2e/add-color.mjs
//
// Dev only (4001). Settings → Fence Styles → Vinyl → Privacy → + Add color:
// the name, the color it copies its parts from (White), priced by piece (job
// lot) with the supplier, the date and some piece prices, what each price
// includes (rail insert ticked under Section), a quantity override (16
// pickets per 8 ft panel) and a Target Profit %. The color is off until it is
// fully priced; the rest of the prices are entered (Edit) and it switches on
// by itself and says so. It is then in the quote builder's choices, a test
// quote on it prices with the job lot note and Good Better Best in the same
// color, and the proposal shows plain names. Then a choice (Semi privacy) is
// added and removed, the test quote is deleted and the color removed, and
// Settings, Inventory and kits are checked to be exactly as before.
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

const COLOR = 'E2E Clay', KEY = 'e2e-clay', TAG = `vinyl:color:${KEY}`
const STYLE = `vinyl/privacy/6/${KEY}/nd/8`
const PICKET = `*Vinyl, ${COLOR}, Picket, 62-1/4"`
/** A part name inside a CSS attribute selector ("62-1/4\"" has a quote in it). */
const css = t => t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
const snapshot = async () => {
  const bs = await api('/api/business-state'), inv = await api('/api/inventory-state')
  return { styles: bs.config.fenceStyles.map(s => s.name), catalog: JSON.stringify(bs.config.fenceCatalog ?? null), vinylColors: (bs.config.fenceCatalog?.materials?.find(m => m.key === 'vinyl')?.dims.find(d => d.key === 'color')?.options ?? []).map(o => o.key),
    items: inv.items.map(i => i.name).sort(), kits: (inv.kits ?? []).map(k => k.id).sort(), bs, inv }
}
const before = await snapshot()
// The White privacy fences turned on (by their codes): the new color gets one of each.
const WHITE_PRIVACY = before.bs.config.fenceStyles.filter(s => s.isActive !== false && /^WV-(Auto (ND|DS) Privacy|(ND|DS) \d'x\d' Privacy)$/.test(s.name))
check('setup: no test color left from an earlier run', !before.vinylColors.includes(KEY) && !before.styles.some(n => n.includes(KEY)))

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
await ctx.addInitScript(t => { localStorage.setItem('crm_access_token', t); localStorage.setItem('crm_refresh_token', 'e2e') }, TOKEN)
const page = await ctx.newPage()
const errs = []; page.on('pageerror', e => errs.push(String(e).slice(0, 200)))
page.on('dialog', d => d.accept().catch(() => {}))
await page.route('**/api/automations/trigger', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }))
const toasts = []
await page.exposeFunction('__toast', t => toasts.push(t))
let quoteId = null, contactId = null

async function openStyles() {
  await page.goto(`${APP}/settings?tab=styles`); await page.waitForSelector('[data-styles-tree]', { timeout: 60000 }); await sleep(1200)
}
const tap = sel => page.locator(sel).first().tap()
const wizNext = async () => { await tap('[data-wiz-next]'); await sleep(350) }

try {
  // ── The tree ──
  await openStyles()
  check('Settings → Fence Styles: a tree by material (vinyl, chain link, aluminum, other, wood), not a table of codes', await page.locator('[data-tree-material]').count() === 5 && await page.locator('[data-tree-option="vinyl:style:privacy"]').isVisible())
  await page.locator('[data-tree-material="vinyl"]').scrollIntoViewIfNeeded(); await shot(page, 'dev-styles-tree')

  // ── Add color, step by step ──
  await page.locator('[data-add-color-under="vinyl:style:privacy"]').scrollIntoViewIfNeeded()
  await tap('[data-add-color-under="vinyl:style:privacy"]'); await page.waitForSelector('[data-wiz-step="name"]')
  await page.locator('[data-color-name]').fill(COLOR); await shot(page, 'dev-add-color-1-name'); await wizNext()
  check('step 2: copies parts from White', await page.locator('[data-copy-from="white"]').isChecked())
  await page.locator('[data-copy-from="white"]').tap(); await shot(page, 'dev-add-color-2-copy-from'); await wizNext()
  await page.locator('[data-pricing="piece"]').tap(); await sleep(200)
  await page.locator('[data-job-lot-supplier]').fill('E2E Supply')
  await page.locator('[data-job-lot-date]').fill('2026-10-15')
  const fillPrice = async (key, v) => { const el = page.locator(`[data-piece-price="${key}"]`); await el.fill(String(v)); await el.blur() }
  await fillPrice('6:section6', '91.00'); await fillPrice('6:section8', '115.00'); await fillPrice('6:post', '31.50')
  check('step 3: piece prices for 6 ft and 8 ft wide sections, posts, walk and double gates, each height', await page.locator('[data-piece-height="6"]').count() === 1 && await page.locator('[data-piece-height="8"]').count() === 1 && await page.locator('[data-piece-price="6:dblGate"]').count() === 1)
  await page.locator('[data-piece-price="6:section8"]').scrollIntoViewIfNeeded(); await shot(page, 'dev-add-color-3-pricing'); await wizNext()
  // What each price includes: the color parts ticked; tick the rail insert under Section.
  const insert = page.locator('[data-coverage="section"] [data-cover^="section:Vinyl, Rail Insert"]').first()
  check('step 4: the section price includes the color pickets, rails and U trim to start with', await page.locator(`[data-coverage="section"] [data-cover="section:${css(PICKET)}"]`).isChecked() && !(await insert.isChecked()))
  await insert.tap(); await sleep(200)
  await page.locator('[data-coverage="section"]').scrollIntoViewIfNeeded(); await shot(page, 'dev-add-color-4-coverage'); await wizNext()
  // An override: 16 pickets per 8 ft panel (White uses 15).
  const ov = page.locator(`[data-override="6|8|section|${css(PICKET)}"]`)
  check('step 5: White\'s quantity to start (15 pickets per 8 ft panel)', await ov.inputValue() === '15', await ov.inputValue())
  await ov.fill('16'); await ov.blur()
  await page.locator('[data-color-profit]').fill('18'); await page.locator('[data-color-profit]').blur()
  await ov.scrollIntoViewIfNeeded(); await shot(page, 'dev-add-color-5-overrides')
  await tap('[data-wiz-finish]'); await sleep(3000)

  // ── Saved, off until priced ──
  let s = await snapshot()
  const made = s.bs.config.fenceStyles.filter(x => x.material === 'vinyl' && x.choices?.color === KEY)
  const kit = (s.inv.kits ?? []).find(k => k.styleName === STYLE && !k.archived)
  const newItems = s.inv.items.filter(i => i.madeFor === TAG)
  check('saved on the server: the color, its fences (one per White privacy fence), kits and Inventory parts', made.length === WHITE_PRIVACY.length && !!kit && newItems.length > 5, `${made.length} fences, ${newItems.length} parts`)
  check('its parts are White\'s with the color swapped, no prices', newItems.every(i => i.unitCost === 0 && i.name.includes(COLOR)) && newItems.some(i => i.name === PICKET))
  check('the override is in its kit: 16 pickets per 8 ft section', kit?.kits.section?.find(p => p.part === PICKET)?.qty === 16)
  const opt = s.bs.config.fenceCatalog.materials.find(m => m.key === 'vinyl').dims.find(d => d.key === 'color').options.find(o => o.key === KEY)
  check('job lot saved in cents, with supplier, date, coverage and Target Profit %', opt.color.pricing === 'piece' && opt.color.jobLot.supplier === 'E2E Supply' && opt.color.jobLot.byHeight['6'].sectionCents['8'] === 11500 && opt.color.jobLot.covers.section.some(p => p.startsWith('Vinyl, Rail Insert')) && opt.color.targetProfitPct === 18)
  await openStyles()
  const waiting = page.locator(`[data-color-waiting="${KEY}"]`)
  check('the tree says it is not available for quoting until priced', await waiting.isVisible() && /waiting for \d+ piece price/.test(await waiting.textContent()), await waiting.textContent())
  await waiting.scrollIntoViewIfNeeded(); await shot(page, 'dev-add-color-6-off-until-priced')
  const stylesOff = (await api('/api/quotes/styles')).map(x => x.name)
  check('not offered to customers (chat, phone, widget) while not priced', !stylesOff.some(n => n.includes(KEY)) && stylesOff.includes("WV-ND 6'x8' Privacy"))
  await page.goto(`${APP}/quotes?quote=new`); await page.waitForSelector('[data-quote-builder]', { timeout: 60000 }); await sleep(800)
  await tap('[data-step="style"]'); await sleep(400); await tap('[data-choice-material="vinyl"]'); await sleep(300)
  check('quote builder: the color is greyed (off) while not priced', await page.locator(`[data-choice-dim="color"][data-choice-key="${KEY}"]`).getAttribute('data-choice-state') === 'held')

  // ── Enter the rest of the prices: it switches on by itself ──
  await openStyles()
  await page.evaluate(() => { const was = window.__seen ?? new Set(); new MutationObserver(() => document.querySelectorAll('[role="status"], [data-toast], .toast').forEach(el => { const t = el.textContent || ''; if (!was.has(t)) { was.add(t); window.__toast(t) } })).observe(document.body, { childList: true, subtree: true }); window.__seen = was })
  await page.locator(`[data-edit-option="vinyl:color:${KEY}"]`).scrollIntoViewIfNeeded()
  await tap(`[data-edit-option="vinyl:color:${KEY}"]`); await page.waitForSelector('[data-wiz-step="name"]'); await wizNext()
  for (const [k, v] of [['6:walkGate', '320'], ['6:dblGate', '610'], ['8:section6', '140'], ['8:section8', '175'], ['8:post', '40'], ['8:walkGate', '450'], ['8:dblGate', '900']]) await fillPrice(k, v)
  await wizNext(); await wizNext()
  await tap('[data-wiz-finish]'); await sleep(3000)
  const ready = page.locator(`[data-color-ready="${KEY}"]`)
  check('fully priced: it switched on', await ready.isVisible())
  const bodyText = (await page.locator('body').textContent()) + ' ' + toasts.join(' ')
  check('…and said so', /E2E Clay vinyl is now available for quoting/i.test(bodyText), toasts.join(' | ').slice(0, 200))
  await ready.scrollIntoViewIfNeeded(); await shot(page, 'dev-add-color-7-on')
  let stylesOn = []
  for (let i = 0; i < 10 && !stylesOn.includes(STYLE); i++) { await sleep(1000); stylesOn = (await api('/api/quotes/styles')).map(x => x.name) }
  check('offered to customers now (the server estimate)', stylesOn.includes(STYLE))
  const est = await api('/api/quotes/calculate', { method: 'POST', body: JSON.stringify({ fenceStyle: STYLE, runs: [37, 120, 52], corners: 2, ends: 2, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0 }) })
  const pieceLines = (est.pullSheet ?? []).filter(l => l.item.startsWith(`Job lot, ${COLOR}:`))
  check('server estimate: priced from the job lot pieces, no covered part charged', est.price > 0 && pieceLines.length >= 5 && (est.pullSheet ?? []).filter(l => l.item.includes(COLOR) && !l.item.startsWith('Job lot')).every(l => l.total === 0), `$${est.price}, ${pieceLines.length} piece lines`)
  const wcfg = await (await fetch(`${API}/p/quote/api/config`)).json()
  check('website widget: the color is offered with White and Tan', JSON.stringify(wcfg.materials).includes(COLOR))

  // ── In the quote builder ──
  await page.goto(`${APP}/quotes?quote=new`); await page.waitForSelector('[data-quote-builder]', { timeout: 60000 }); await sleep(800)
  await tap('[data-step="style"]'); await sleep(400); await tap('[data-choice-material="vinyl"]'); await sleep(300)
  await tap(`[data-choice-dim="color"][data-choice-key="${KEY}"]`); await sleep(300)
  await tap('[data-choice-dim="width"][data-choice-key="8"]'); await sleep(300)
  const plain = (await page.locator('[data-style-plain-name]').textContent()).trim()
  check('quote builder: picked by choices, shown by its plain name', plain === 'E2E Clay Vinyl Privacy, 6 ft tall, 8 ft panels, No dig', plain)
  await shot(page, 'dev-add-color-8-in-quote')
  await page.locator('[data-quote-close]').tap().catch(() => {}); await sleep(500)

  // A test quote on it: priced, job lot note, Good Better Best in the same color, plain names on the proposal.
  const today = new Date().toISOString().slice(0, 10)
  const c = await api('/api/crm-contacts', { method: 'POST', body: JSON.stringify({ firstName: 'E2E', lastName: 'Clay Color', phone: '3525550142', serviceAddress: '201 SE 3rd St, Ocala, FL 34471', leadSource: 'Referral' }) })
  contactId = c?.id ?? c?.contact?.id
  const q = await api('/api/saved-quotes', { method: 'POST', body: JSON.stringify({ crmContactId: contactId, customerName: 'E2E Clay Color', customerPhone: '3525550142', customerAddress: '201 SE 3rd St, Ocala, FL 34471', fenceStyle: STYLE, runs: [37, 120, 52], corners: 2, ends: 2, walkGates: 1, dblGates: 1, sections: 0, status: 'DRAFT', finalPrice: 0, date: today }) })
  quoteId = q.id
  await page.goto(`${APP}/quotes?quote=${quoteId}`); await page.waitForSelector('[data-quote-price]', { timeout: 60000 }); await sleep(1500)
  const price = Number((await page.locator('[data-quote-price]').textContent()).replace(/[$,\s]/g, ''))
  const note = (await page.locator('[data-job-lot-note]').textContent().catch(() => '')) || ''
  check('test quote: prices, and says "Job lot pricing from E2E Supply, quoted Oct 15, 2026"', price > 0 && note.includes('Job lot pricing from E2E Supply, quoted Oct 15, 2026'), `$${price} ${note.slice(0, 80)}`)
  const tierStyles = await page.locator('[data-tier-style]').allTextContents()
  check('Good Better Best follow the quote\'s color', tierStyles.length >= 2 && tierStyles.every(t => t.startsWith('E2E Clay Vinyl Privacy')), tierStyles.join(' | '))
  await tap('[data-quote-bar] [data-save-open]'); await sleep(600)
  await tap('[data-save-submit]'); await sleep(3000)
  const saved = await api(`/api/saved-quotes/${quoteId}`)
  const share = await api(`/api/saved-quotes/${quoteId}/share-token`, { method: 'POST' })
  const labels = (saved?.proposal?.options ?? []).map(o => o.label)
  check('the proposal: options by their plain names', labels.length >= 2 && labels.every(l => /Vinyl Privacy, 6 ft tall/.test(l)), labels.join(' | '))
  if (share?.shareToken) {
    const cpage = await ctx.newPage()
    await cpage.goto(`${API}/p/${share.shareToken}`); await sleep(1200)
    await cpage.locator('.opt').first().scrollIntoViewIfNeeded().catch(() => {})
    await shot(cpage, 'dev-plain-names-proposal')
    await cpage.close()
  }

  // ── Adding a choice the same way: Semi privacy, then removed ──
  await openStyles()
  await page.locator('[data-add-choice="vinyl:style"]').scrollIntoViewIfNeeded(); await tap('[data-add-choice="vinyl:style"]'); await page.waitForSelector('[data-choice-dialog]')
  await page.locator('[data-choice-label]').fill('Semi privacy'); await page.locator('[data-choice-copy="privacy"]').tap()
  await shot(page, 'dev-add-height-or-style')
  await tap('[data-choice-save]'); await sleep(2500)
  s = await snapshot()
  const semi = s.bs.config.fenceStyles.filter(x => x.choices?.style === 'semi-privacy')
  check('Semi privacy added: its fences copied from Privacy, turned off until checked', semi.length > 10 && (await page.locator('[data-tree-option="vinyl:style:semi-privacy"] [role="switch"]').getAttribute('aria-checked')) === 'false', `${semi.length} fences`)
  await tap('[data-edit-option="vinyl:style:semi-privacy"]'); await page.waitForSelector('[data-choice-dialog]'); await tap('[data-choice-remove]'); await sleep(2500)
  s = await snapshot()
  check('Semi privacy removed with its fences and kits', !s.bs.config.fenceStyles.some(x => x.choices?.style === 'semi-privacy') && !(s.inv.kits ?? []).some(k => k.madeFor === 'vinyl:style:semi-privacy'))

  // ── Remove the test quote, then the color ──
  await api(`/api/saved-quotes/${quoteId}`, { method: 'DELETE' }); quoteId = null
  await openStyles()
  await page.locator(`[data-edit-option="vinyl:color:${KEY}"]`).scrollIntoViewIfNeeded()
  await tap(`[data-edit-option="vinyl:color:${KEY}"]`); await page.waitForSelector('[data-wiz-step="name"]')
  await tap('[data-color-remove]'); await sleep(3000)
  const removeErr = await page.locator('[data-wiz-error]').textContent().catch(() => '')
  check('removed (no saved quote uses it any more)', !removeErr, removeErr)
  await page.locator('[data-tree-dim="vinyl:color"]').scrollIntoViewIfNeeded(); await shot(page, 'dev-add-color-9-removed')
} catch (e) {
  check('test run finished', false, String(e?.stack || e).split('\n').slice(0, 4).join(' '))
} finally {
  if (quoteId) await api(`/api/saved-quotes/${quoteId}`, { method: 'DELETE' })
  if (contactId) {
    const pipe = await api('/api/pipeline')
    const leads = (pipe?.leads ?? []).filter(l => l.customerId === contactId).map(l => l.id)
    if (leads.length) await fetch(`${API}/api/pipeline`, { method: 'PATCH', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ upsert: [], remove: leads, baseVersion: pipe.version }) })
    await api(`/api/crm-contacts/${contactId}`, { method: 'DELETE' })
  }
}

// ── Nothing left behind ──
await sleep(1500)
const after = await snapshot()
check('nothing left: the fence styles are exactly as before', JSON.stringify(after.styles) === JSON.stringify(before.styles))
check('nothing left: the choice tree is as before (no test color)', !after.vinylColors.includes(KEY) && JSON.stringify(after.vinylColors.length ? after.vinylColors : ['white', 'tan']) === JSON.stringify(before.vinylColors.length ? before.vinylColors : ['white', 'tan']))
check('nothing left: Inventory items and kits are as before', JSON.stringify(after.items) === JSON.stringify(before.items) && JSON.stringify(after.kits) === JSON.stringify(before.kits), `${after.items.length} / ${before.items.length} items, ${after.kits.length} / ${before.kits.length} kits`)
check('no page errors', errs.length === 0, errs.join(' | '))
await browser.close()
const failed = results.filter(r => !r).length
console.log(`\n${results.length - failed} of ${results.length} checks passed`)
process.exit(failed ? 1 : 0)
