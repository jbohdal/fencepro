/**
 * Jonathan's rules, Oct 21, 2026 (TAKEOFF_RULES.md, docs/DECISIONS.md):
 *
 *   A. Tan vinyl, 6 ft tall, 8 ft wide: 15 pickets a section (was 16), as White.
 *   B. 8 ft tall vinyl, every color, ND and DS: priced by the piece, one price
 *      per section and one per post (FenceStyle.pieceCents, Settings → Price
 *      List). The pull sheet lists every part at $0: a section is 2 rails, a
 *      mid rail, 22 pickets (4 ft) and 4 U channels (4 ft) at 6 ft wide; 2
 *      rails, a mid rail, 30 pickets, 4 U channels and 2 rail inserts at 8 ft
 *      wide. The post kit (post, cap, donuts and pipe or concrete) is covered
 *      by the post price. Gates are priced from their parts, as before. Not
 *      available for quoting until both prices are in.
 */

import { describe, test, expect, afterEach } from 'vitest'
import { estimateConfig } from '../../web/src/estimate'
import { calculateQuote, type QuoteCalcInput } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap, legacyCalculateMaterialsDetailed, TALL_VINYL_SECTION, type LineItem } from '../../web/src/materialCalculator'
import { setSavedKitSets, kitSetFor, clearBuiltInKits } from '../../web/src/materialKits'
import { DEFAULT_CATALOG, tallPricesMissing, tallPriceStatus, tallSourceWords, type InvItem } from '../../web/src/fenceCatalog'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { isQuotable } from '../../web/src/styleAvailability'
import { planTallVinylParts } from '../../web/src/tallVinylParts'
import type { FenceStyle } from '../../web/src/configStore'

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

// Inventory with the parts (a few real looking costs; the covered parts' costs never reach a quote).
const INV: Record<string, number> = {
  "V , W, Post, 8' Privacy, CP, 5\" x 5\"": 26.7, "V , W, Post, 8' Privacy, EP, 5\" x 5\"": 26.7, "V , W, Post, 8' Privacy, LP, 5\" x 5\"": 26.7,
  '*Vinyl, White, Cap, 5"x5"': 1.5, 'ND, Donut': 4.12, "Pipe, PT40, Galv, 2-1/2\" x 8'": 18.05, 'Misc, Concrete': 7.06,
  "*Vinyl, White, Rail, 6'": 6.65, "*Vinyl, White, Rail, 8'": 9.85, "Vinyl, Rail Insert, 8'": 8.15,
  "*Vinyl, White, Mid Rail, 6'": 0, "*Vinyl, White, Mid Rail, 8'": 0, "*Vinyl, White, Picket, 4'": 0, "*Vinyl, White, U Channel, 4'": 0,
  'V , W, Privacy Gate 8 x 4': 399, '*Vinyl, Gate, Hinge': 29.03, '*Vinyl, Gate, Latch': 20.46, '*Vinyl, Gate, Handle': 5.98, '*Vinyl, White, Cap, Gate': 1.75,
}

const styles = (prices: Record<string, FenceStyle['pieceCents']> = {}): FenceStyle[] =>
  DEFAULT_FENCE_STYLES.map(s => (prices[s.name] ? { ...s, pieceCents: prices[s.name] } : { ...s }))

function setup(prices: Record<string, FenceStyle['pieceCents']> = {}, inv: Record<string, number> = INV) {
  setMaterialPriceSource(priceSourceFromMap(inv))
  setSavedKitSets(() => [])
  return estimateConfig({ fenceStyles: styles(prices), fenceCatalog: DEFAULT_CATALOG } as any)
}
const job = (cfg: ReturnType<typeof setup>, name: string, over: Partial<QuoteCalcInput> = {}): QuoteCalcInput => ({
  style: cfg.fenceStyles.find(s => s.name === name)!, runs: [{ ft: 48, rail: 'auto' }], corners: 0, ends: 2, walkGates: 0, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, optimizer: cfg.railOptimizer!, ...over,
})
const line = (items: LineItem[], name: string) => items.filter(i => i.item === name)
const qty = (items: LineItem[], name: string) => line(items, name).reduce((t, i) => t + i.qty, 0)

describe('A. tan 6 ft tall, 8 ft wide: 15 pickets a section', () => {
  test.each(["TV-ND 6'x8' Privacy", "TV-DS 6'x8' Privacy"])('%s', style => {
    clearBuiltInKits()
    // 48 ft = 6 sections; a walk gate leaf takes a 6 ft section's 11 pickets (gate correction, unchanged).
    const items = legacyCalculateMaterialsDetailed({ fenceStyle: style, runs: [48], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0 }).items
    expect(qty(items, '*Vinyl, Tan, Picket, 62-1/4"')).toBe(6 * 15)
    const kit = kitSetFor(style, [])
    if (!kit || kit === 'archived') throw new Error('no kit')
    expect(kit.mismatch).toBeUndefined()
    expect(kit.kits.section!.find(p => p.part === '*Vinyl, Tan, Picket, 62-1/4"')!.qty).toBe(15)
  })
})

describe('B. 8 ft tall vinyl: priced by the piece', () => {
  const W8: Array<[string, 6 | 8]> = [["WV-ND 8'x6' Privacy", 6], ["WV-DS 8'x6' Privacy", 6], ["WV-ND 8'x8' Privacy", 8], ["WV-DS 8'x8' Privacy", 8]]

  test.each(W8)('%s: the section kit is every part of a section, the old whole section is gone', (style, w) => {
    clearBuiltInKits()
    const kit = kitSetFor(style, [])
    if (!kit || kit === 'archived') throw new Error('no kit')
    expect(kit.mismatch).toBeUndefined()
    const c = TALL_VINYL_SECTION[w]
    const want: Record<string, number> = { [`*Vinyl, White, Rail, ${w}'`]: c.rails, [`*Vinyl, White, Mid Rail, ${w}'`]: c.midRails, "*Vinyl, White, Picket, 4'": c.pickets, "*Vinyl, White, U Channel, 4'": c.uChannels }
    if (c.railInserts) want["Vinyl, Rail Insert, 8'"] = c.railInserts
    expect(Object.fromEntries(kit.kits.section!.map(p => [p.part, p.qty]))).toEqual(want)
    // Jonathan's counts, as he gave them.
    expect(c).toEqual(w === 6 ? { rails: 2, midRails: 1, pickets: 22, uChannels: 4, railInserts: 0 } : { rails: 2, midRails: 1, pickets: 30, uChannels: 4, railInserts: 2 })
  })

  test('not available for quoting until both prices are in; then it is', () => {
    // No section price anywhere (INV has no whole 8 ft section); the posts' parts are priced in Inventory.
    let cfg = setup()
    for (const [name, w] of W8) {
      const s = cfg.fenceStyles.find(x => x.name === name)!
      expect(isQuotable(s), name).toBe(false)
      expect(s.held).toBe(`8 ft tall is priced by the piece: enter its section price in Settings → Price List → 8 ft tall vinyl, or a price for V , W, Picket Section 8' x ${w}' Privacy in Inventory`)
    }
    // Neither price: the post's parts with no Inventory price are named.
    const noPost = Object.fromEntries(Object.entries(INV).filter(([n]) => !/Post, 8' Privacy, (EP|LP)/.test(n)))
    cfg = setup({}, noPost)
    expect(cfg.fenceStyles.find(x => x.name === "WV-ND 8'x8' Privacy")!.held).toBe(
      "8 ft tall is priced by the piece: enter its section price in Settings → Price List → 8 ft tall vinyl, or a price for V , W, Picket Section 8' x 8' Privacy in Inventory; "
      + 'enter its post price in Settings → Price List → 8 ft tall vinyl, or prices in Inventory for V , W, Post, 8\' Privacy, EP, 5" x 5", V , W, Post, 8\' Privacy, LP, 5" x 5"')
    cfg = setup({ "WV-ND 8'x8' Privacy": { section: 41250 } }, noPost)
    expect(cfg.fenceStyles.find(x => x.name === "WV-ND 8'x8' Privacy")!.held).toBe('8 ft tall is priced by the piece: enter its post price in Settings → Price List → 8 ft tall vinyl, or prices in Inventory for V , W, Post, 8\' Privacy, EP, 5" x 5", V , W, Post, 8\' Privacy, LP, 5" x 5"')
    expect(tallPricesMissing({ pieceCents: { section: 41250, post: 0 } })).toEqual(['post'])
    cfg = setup({ "WV-ND 8'x8' Privacy": { section: 41250, post: 6500, pricedOn: '2026-10-21' } })
    expect(isQuotable(cfg.fenceStyles.find(x => x.name === "WV-ND 8'x8' Privacy")!)).toBe(true)
    // The others still wait for their own prices; 6 ft tall is untouched.
    expect(isQuotable(cfg.fenceStyles.find(x => x.name === "WV-DS 8'x8' Privacy")!)).toBe(false)
    expect(isQuotable(cfg.fenceStyles.find(x => x.name === "WV-ND 6'x8' Privacy")!)).toBe(true)
  })

  test.each(W8)('%s: one section price and one post price; every section and post part on the pull sheet at $0', (style, w) => {
    const cfg = setup({ [style]: { section: 41250, post: 6500 } })
    const c = calculateQuote(job(cfg, style))
    const n = w === 8 ? 6 : 8          // 48 ft
    const posts = 2 + (n - 1)          // 2 ends + line posts
    const sec = TALL_VINYL_SECTION[w]
    const items = c.materials.items
    expect(c.sections).toBe(n)
    expect(line(items, `8 ft tall White: section, ${w} ft wide`)).toEqual([expect.objectContaining({ qty: n, unitCost: 412.5, total: 412.5 * n, jobLotPiece: true })])
    expect(line(items, '8 ft tall White: end post')).toEqual([expect.objectContaining({ qty: 2, unitCost: 65, jobLotPiece: true })])
    expect(line(items, '8 ft tall White: line post')).toEqual([expect.objectContaining({ qty: n - 1, unitCost: 65, jobLotPiece: true })])
    const parts: Record<string, number> = { [`*Vinyl, White, Rail, ${w}'`]: sec.rails * n, [`*Vinyl, White, Mid Rail, ${w}'`]: n, "*Vinyl, White, Picket, 4'": sec.pickets * n, "*Vinyl, White, U Channel, 4'": 4 * n,
      "V , W, Post, 8' Privacy, EP, 5\" x 5\"": 2, "V , W, Post, 8' Privacy, LP, 5\" x 5\"": n - 1, '*Vinyl, White, Cap, 5"x5"': posts }
    if (sec.railInserts) parts["Vinyl, Rail Insert, 8'"] = 2 * n
    if (/-ND /.test(style)) Object.assign(parts, { 'ND, Donut': 2 * posts, "Pipe, PT40, Galv, 2-1/2\" x 8'": posts })
    else parts['Misc, Concrete'] = 2 * posts
    for (const [p, q] of Object.entries(parts)) expect(line(items, p), p).toEqual([expect.objectContaining({ qty: q, unitCost: 0, total: 0, costSource: 'jobLot' })])
    // Nothing else: material is the pieces only.
    expect(items.length).toBe(Object.keys(parts).length + 3)
    expect(c.materialCost).toBeCloseTo(412.5 * n + 65 * (n + 1), 2)
    expect(items.some(i => /Picket Section/.test(i.item))).toBe(false)
  })

  test.each(W8)('%s: gates are priced from their parts, as before', style => {
    const cfg = setup({ [style]: { section: 41250, post: 6500 } })
    const w = calculateQuote(job(cfg, style, { walkGates: 1, dblGates: 1 }))
    const none = calculateQuote(job(cfg, style))
    // What the gates add is exactly the old gate rows (Inventory prices), nothing covered, no piece line and no blank post.
    const added = (name: string) => qty(w.materials.items.filter(i => i.costSource !== 'jobLot'), name) - qty(none.materials.items.filter(i => i.costSource !== 'jobLot'), name)
    expect([added('V , W, Privacy Gate 8 x 4'), added('*Vinyl, Gate, Hinge'), added('*Vinyl, Gate, Latch'), added('*Vinyl, Gate, Handle'), added('*Vinyl, White, Cap, Gate')]).toEqual([3, 3, 2, 6, 6])
    if (/-DS /.test(style)) expect(line(w.materials.items, 'Misc, Concrete').find(i => i.costSource !== 'jobLot')).toMatchObject({ qty: 2, unitCost: 7.06 })
    expect(w.materials.items.filter(i => i.jobLotPiece).map(i => i.item).sort()).toEqual(none.materials.items.filter(i => i.jobLotPiece).map(i => i.item).sort())
    expect(w.materials.items.some(i => /Blank|gate post/.test(i.item))).toBe(false)
  })

  test('the $0 section parts are made in Inventory once, included in the section price; nothing else is touched', () => {
    clearBuiltInKits()
    const items: InvItem[] = Object.entries(INV).filter(([n]) => !/Mid Rail|Picket, 4'|U Channel, 4'/.test(n)).map(([name, unitCost], i) => ({ id: `x${i}`, name, unitCost, category: 'Vinyl White', status: 'active' }))
    const plan = planTallVinylParts({ fenceStyles: styles(), items, kits: [] })
    expect(plan.added.sort()).toEqual(["*Vinyl, White, Mid Rail, 6'", "*Vinyl, White, Mid Rail, 8'", "*Vinyl, White, Picket, 4'", "*Vinyl, White, U Channel, 4'"])
    for (const n of plan.added) expect(plan.items.find(i => i.name === n)).toMatchObject({ unitCost: 0, status: 'active', includedIn: '8 ft tall section price', category: 'Vinyl White' })
    expect(plan.items.slice(0, items.length)).toEqual(items)
    expect(planTallVinylParts({ fenceStyles: styles(), items: plan.items, kits: [] }).added).toEqual([])
  })
})

/**
 * Oct 29, 2026: "8 ft tall vinyl is still off for quoting even though I
 * entered prices." On live, Jonathan's 8 ft prices are in Inventory (the
 * whole 8 ft sections and the 8 ft posts, dated 2026-10-25); no style had a
 * price typed in Settings → Price List → 8 ft tall vinyl (pieceCents), so
 * every 8 ft tall style stayed held. A blank Settings price now uses
 * Inventory: the section is the whole 8 ft section at its Inventory price,
 * each post its kit's parts at Inventory prices. A typed price still wins.
 */
describe("C. live's shape: prices entered in Inventory, none typed in Settings", () => {
  // Live's four 8 ft tall styles, as saved in Settings (config.fenceStyles), no customer data.
  const LIVE_STYLES: FenceStyle[] = [
    { id: '3', name: "WV-ND 8'x6' Privacy", margin: 0.56, choices: { color: 'white', style: 'privacy', width: '6', height: '8', install: 'nd' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 6, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.8, targetProfitPct: 14 },
    { id: '4', name: "WV-ND 8'x8' Privacy", margin: 0.56, choices: { color: 'white', style: 'privacy', width: '8', height: '8', install: 'nd' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 8, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.8, targetProfitPct: 14 },
    { id: '8', name: "WV-DS 8'x6' Privacy", margin: 0.6, choices: { color: 'white', style: 'privacy', width: '6', height: '8', install: 'ds' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 6, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.7, targetProfitPct: 10 },
    { id: '9', name: "WV-DS 8'x8' Privacy", margin: 0.6, choices: { color: 'white', style: 'privacy', width: '8', height: '8', install: 'ds' }, category: 'Vinyl', isActive: true, material: 'vinyl', panelWidth: 8, mhPerDblGate: 4.8, mhPerWalkGate: 2.4, sectionsPerMH: 0.7, targetProfitPct: 10 },
  ] as FenceStyle[]
  // Live's Inventory prices (dollars) for every part these styles use.
  const LIVE_INV: Record<string, number> = {
    "V , W, Picket Section 8' x 6' Privacy": 92.5, "V , W, Picket Section 8' x 8' Privacy": 147.8,
    "V , W, Post, 8' Privacy, CP, 5\" x 5\"": 26.7, "V , W, Post, 8' Privacy, EP, 5\" x 5\"": 26.7, "V , W, Post, 8' Privacy, LP, 5\" x 5\"": 26.7,
    '*Vinyl, White, Cap, 5"x5"': 1.5, 'ND, Donut': 4.12, "Pipe, PT40, Galv, 2-1/2\" x 8'": 16.06, 'Misc, Concrete': 7.06,
    "*Vinyl, White, Rail, 6'": 6.65, "*Vinyl, White, Rail, 8'": 9.85, "Vinyl, Rail Insert, 8'": 8.15,
    "*Vinyl, White, Mid Rail, 6'": 0, "*Vinyl, White, Mid Rail, 8'": 0, "*Vinyl, White, Picket, 4'": 0, "*Vinyl, White, U Channel, 4'": 0,
    'V , W, Privacy Gate 8 x 4': 399, '*Vinyl, Gate, Hinge': 29.03, '*Vinyl, Gate, Latch': 20.46, '*Vinyl, Gate, Handle': 5.98, '*Vinyl, White, Cap, Gate': 1.75,
  }
  const live = (styles: FenceStyle[] = LIVE_STYLES, inv = LIVE_INV) => {
    setMaterialPriceSource(priceSourceFromMap(inv))
    setSavedKitSets(() => [])
    return estimateConfig({ fenceStyles: styles, fenceCatalog: DEFAULT_CATALOG } as any)
  }
  // 100 ft with 2 corners: three runs, 2 corners, 2 ends.
  const sample = (cfg: ReturnType<typeof live>, name: string) => calculateQuote(job(cfg, name, { runs: [{ ft: 30, rail: 'auto' }, { ft: 40, rail: 'auto' }, { ft: 30, rail: 'auto' }], corners: 2, ends: 2 }))

  // [style, panel width, sections (per run: 30, 40, 30 ft), section $, one post's parts $]
  const CASES: Array<[string, 6 | 8, number, number, number]> = [
    ["WV-ND 8'x6' Privacy", 6, 5 + 7 + 5, 92.5, 26.7 + 1.5 + 2 * 4.12 + 16.06],
    ["WV-ND 8'x8' Privacy", 8, 4 + 5 + 4, 147.8, 26.7 + 1.5 + 2 * 4.12 + 16.06],
    ["WV-DS 8'x6' Privacy", 6, 5 + 7 + 5, 92.5, 26.7 + 1.5 + 2 * 7.06],
    ["WV-DS 8'x8' Privacy", 8, 4 + 5 + 4, 147.8, 26.7 + 1.5 + 2 * 7.06],
  ]

  test.each(CASES)('%s: available for quoting, priced from what is in Inventory', (name, w, n, secPrice, postParts) => {
    const cfg = live()
    const s = cfg.fenceStyles.find(x => x.name === name)!
    expect(s.held).toBeUndefined()
    expect(isQuotable(s)).toBe(true)
    expect(s.jobLot).toMatchObject({ tall: true, sections: { [String(w)]: secPrice }, coversAll: ['section'], tallSource: { section: 'inventory', post: 'parts', sectionItem: `V , W, Picket Section 8' x ${w}' Privacy` } })
    const c = sample(cfg, name)
    const items = c.materials.items
    const posts = 2 + 2 + (n - 3)   // 2 corners, 2 ends, line posts (sections less runs)
    expect(c.sections).toBe(n)
    // One section line at the whole section's Inventory price.
    expect(line(items, `8 ft tall White: section, ${w} ft wide`)).toEqual([expect.objectContaining({ qty: n, unitCost: secPrice, jobLotPiece: true })])
    // Posts: each part at its Inventory price, corner, end and line alike.
    expect(line(items, "V , W, Post, 8' Privacy, CP, 5\" x 5\"")).toEqual([expect.objectContaining({ qty: 2, unitCost: 26.7 })])
    expect(line(items, "V , W, Post, 8' Privacy, EP, 5\" x 5\"")).toEqual([expect.objectContaining({ qty: 2, unitCost: 26.7 })])
    expect(line(items, "V , W, Post, 8' Privacy, LP, 5\" x 5\"")).toEqual([expect.objectContaining({ qty: n - 3, unitCost: 26.7 })])
    expect(line(items, '*Vinyl, White, Cap, 5"x5"')).toEqual([expect.objectContaining({ qty: posts, unitCost: 1.5 })])
    if (/-ND /.test(name)) {
      expect(line(items, 'ND, Donut')).toEqual([expect.objectContaining({ qty: 2 * posts, unitCost: 4.12 })])
      expect(line(items, "Pipe, PT40, Galv, 2-1/2\" x 8'")).toEqual([expect.objectContaining({ qty: posts, unitCost: 16.06 })])
    } else expect(line(items, 'Misc, Concrete')).toEqual([expect.objectContaining({ qty: 2 * posts, unitCost: 7.06 })])
    // The section's parts are on the pull sheet at $0 (the whole section's price covers them); no post piece line.
    for (const p of [`*Vinyl, White, Rail, ${w}'`, `*Vinyl, White, Mid Rail, ${w}'`, "*Vinyl, White, Picket, 4'", "*Vinyl, White, U Channel, 4'"]) expect(line(items, p), p).toEqual([expect.objectContaining({ unitCost: 0, total: 0, costSource: 'jobLot' })])
    expect(items.some(i => /post$/.test(i.item) && i.jobLotPiece)).toBe(false)
    // Material is the sections plus every post's parts, to the cent.
    expect(Math.round(c.materialCost * 100)).toBe(Math.round((n * secPrice + posts * postParts) * 100))
  })

  test('a price typed in Settings wins over Inventory', () => {
    const typed = LIVE_STYLES.map(s => s.name === "WV-ND 8'x6' Privacy" ? { ...s, pieceCents: { section: 10000, post: 6000, pricedOn: '2026-10-29' } } : s)
    const cfg = live(typed)
    const s = cfg.fenceStyles.find(x => x.name === "WV-ND 8'x6' Privacy")!
    expect(s.jobLot).toMatchObject({ sections: { '6': 100 }, corner: 60, end: 60, line: 60, coversAll: ['section', 'post'], tallSource: { section: 'settings', post: 'settings' } })
    const items = sample(cfg, s.name).materials.items
    expect(line(items, '8 ft tall White: section, 6 ft wide')).toEqual([expect.objectContaining({ qty: 17, unitCost: 100 })])
    expect(line(items, '8 ft tall White: corner post')).toEqual([expect.objectContaining({ qty: 2, unitCost: 60 })])
    expect(line(items, "V , W, Post, 8' Privacy, CP, 5\" x 5\"")).toEqual([expect.objectContaining({ unitCost: 0, costSource: 'jobLot' })])
  })

  test('a style missing a price says which one', () => {
    // The 8 x 8 whole section and the pipe with no Inventory price.
    const inv = { ...LIVE_INV }
    delete inv["V , W, Picket Section 8' x 8' Privacy"]
    delete inv["Pipe, PT40, Galv, 2-1/2\" x 8'"]
    const cfg = live(LIVE_STYLES, inv)
    const by = (n: string) => cfg.fenceStyles.find(x => x.name === n)!
    expect(isQuotable(by("WV-ND 8'x8' Privacy"))).toBe(false)
    expect(by("WV-ND 8'x8' Privacy").held).toBe(
      "8 ft tall is priced by the piece: enter its section price in Settings → Price List → 8 ft tall vinyl, or a price for V , W, Picket Section 8' x 8' Privacy in Inventory; "
      + "enter its post price in Settings → Price List → 8 ft tall vinyl, or prices in Inventory for Pipe, PT40, Galv, 2-1/2\" x 8'")
    expect(by("WV-DS 8'x8' Privacy").held).toBe("8 ft tall is priced by the piece: enter its section price in Settings → Price List → 8 ft tall vinyl, or a price for V , W, Picket Section 8' x 8' Privacy in Inventory")
    expect(by("WV-ND 8'x6' Privacy").held).toBe("8 ft tall is priced by the piece: enter its post price in Settings → Price List → 8 ft tall vinyl, or prices in Inventory for Pipe, PT40, Galv, 2-1/2\" x 8'")
    expect(isQuotable(by("WV-DS 8'x6' Privacy"))).toBe(true)
    const st = tallPriceStatus(by("WV-ND 8'x8' Privacy"), undefined, priceSourceFromMap(inv))
    expect(tallSourceWords(st)).toEqual({
      section: "Missing: type it here, or price V , W, Picket Section 8' x 8' Privacy in Inventory",
      post: "Missing: type it here, or price in Inventory: Pipe, PT40, Galv, 2-1/2\" x 8'",
    })
    expect(tallSourceWords(tallPriceStatus(by("WV-DS 8'x6' Privacy"), undefined, priceSourceFromMap(inv)))).toEqual({
      section: "Blank: uses V , W, Picket Section 8' x 6' Privacy in Inventory, $92.50",
      post: 'Blank: each post is its parts at Inventory prices (8 ft post, cap, donuts and pipe or concrete)',
    })
  })
})
