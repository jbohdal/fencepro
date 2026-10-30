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
import { DEFAULT_CATALOG, tallPricesMissing, pickerState, offWords, type InvItem } from '../../web/src/fenceCatalog'
import { applyTallPrices, shownCents, tallKey } from '../../web/src/tallVinylPriceSave'
import { resolveTiers, type TierSet } from '../../web/src/tiers'
import { estimate, onHoldStyles } from '../../web/src/estimate'
import { widgetStyles } from '../../web/src/widgetPricing'
import { isNotQuotable, notQuotableMessage, notQuotableReason } from '../src/server/lib/estimates'
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

function setup(prices: Record<string, FenceStyle['pieceCents']> = {}) {
  setMaterialPriceSource(priceSourceFromMap(INV))
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
    let cfg = setup()
    for (const [name] of W8) {
      const s = cfg.fenceStyles.find(x => x.name === name)!
      expect(isQuotable(s), name).toBe(false)
      expect(s.held).toBe('8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl')
    }
    cfg = setup({ "WV-ND 8'x8' Privacy": { section: 41250 } })
    expect(cfg.fenceStyles.find(x => x.name === "WV-ND 8'x8' Privacy")!.held).toBe('8 ft tall needs our post cost in Settings → Price List → 8 ft tall vinyl')
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
    // The White 8 ft styles, as when this step ran (Tan 8 ft came Oct 29, 2026: tanTall.test.ts).
    const whiteOnly = () => styles().filter(s => !/^TV-(ND|DS) 8'/.test(s.name))
    const items: InvItem[] = Object.entries(INV).filter(([n]) => !/Mid Rail|Picket, 4'|U Channel, 4'/.test(n)).map(([name, unitCost], i) => ({ id: `x${i}`, name, unitCost, category: 'Vinyl White', status: 'active' }))
    const plan = planTallVinylParts({ fenceStyles: whiteOnly(), items, kits: [] })
    expect(plan.added.sort()).toEqual(["*Vinyl, White, Mid Rail, 6'", "*Vinyl, White, Mid Rail, 8'", "*Vinyl, White, Picket, 4'", "*Vinyl, White, U Channel, 4'"])
    for (const n of plan.added) expect(plan.items.find(i => i.name === n)).toMatchObject({ unitCost: 0, status: 'active', includedIn: '8 ft tall section price', category: 'Vinyl White' })
    expect(plan.items.slice(0, items.length)).toEqual(items)
    expect(planTallVinylParts({ fenceStyles: whiteOnly(), items: plan.items, kits: [] }).added).toEqual([])
  })
})

/**
 * Oct 29, 2026: "8 ft tall vinyl is still off for quoting even though I
 * entered prices." His prices were in Inventory; 8 ft tall is priced only
 * from Settings → Price List → 8 ft tall vinyl ("I'll enter prices in
 * Settings"), where live has none yet. Every place that says it is off says
 * which price is missing and where it goes; the Settings save turns it on.
 */
describe('C. typed in Settings: the save, and every place says what is missing', () => {
  const W8 = ["WV-ND 8'x6' Privacy", "WV-ND 8'x8' Privacy", "WV-DS 8'x6' Privacy", "WV-DS 8'x8' Privacy"]
  const TALL = (cfg: ReturnType<typeof setup>) => cfg.fenceStyles.filter(s => W8.includes(s.name))

  test('the screen\'s save puts the typed dollars on each fence in integer cents, dated; blank stays blank', () => {
    const cfg = setup()
    for (const n of W8) expect([shownCents(cfg.fenceStyles.find(s => s.name === n)!.pieceCents?.section), shownCents(cfg.fenceStyles.find(s => s.name === n)!.pieceCents?.post)]).toEqual(['', ''])
    const typed = { [tallKey("WV-ND 8'x6' Privacy", 'section')]: '$412.50', [tallKey("WV-ND 8'x6' Privacy", 'post')]: '65',
      [tallKey("WV-DS 8'x8' Privacy", 'section')]: '450' }
    const r = applyTallPrices(cfg.fenceStyles, TALL(cfg), typed, '2026-10-29')
    expect(r.bad).toEqual([])
    const by = (n: string) => r.fenceStyles.find(s => s.name === n)!
    expect(by("WV-ND 8'x6' Privacy").pieceCents).toEqual({ section: 41250, post: 6500, pricedOn: '2026-10-29' })
    expect(by("WV-DS 8'x8' Privacy").pieceCents).toEqual({ section: 45000, post: null, pricedOn: '2026-10-29' })
    expect(by("WV-ND 8'x8' Privacy").pieceCents).toBeUndefined()
    // Everything else passes through as it was (the same objects).
    for (const s of cfg.fenceStyles.filter(s => !W8.includes(s.name))) expect(by(s.name)).toBe(s)
    expect(applyTallPrices(cfg.fenceStyles, TALL(cfg), { [tallKey("WV-ND 8'x6' Privacy", 'post')]: 'abc' }, '2026-10-29').bad).toEqual(["WV-ND 8'x6' Privacy"])

    // Read back: on at once with both prices; one price only says which is missing.
    const after = estimateConfig({ fenceStyles: r.fenceStyles, fenceCatalog: DEFAULT_CATALOG } as any)
    const a = (n: string) => after.fenceStyles.find(s => s.name === n)!
    expect(isQuotable(a("WV-ND 8'x6' Privacy"))).toBe(true)
    expect(a("WV-DS 8'x8' Privacy").held).toBe('8 ft tall needs our post cost in Settings → Price List → 8 ft tall vinyl')
    expect(a("WV-ND 8'x8' Privacy").held).toBe('8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl')
  })

  test('the quote builder picker says why 8 ft is off, in sight, and tells the Salesman to ask Jonathan', () => {
    const cfg = setup()
    const row = (c: ReturnType<typeof setup>) => pickerState(c.fenceStyles, DEFAULT_CATALOG, 'vinyl', { style: 'privacy' }, isQuotable).find(r => r.dim.key === 'height')!
    const eight = row(cfg).options.find(o => o.opt.key === '8')!
    expect(eight.state).toBe('held')
    expect(eight.why).toEqual(['8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl'])
    expect(offWords(eight.opt.label, eight.why!, false)).toBe('8 ft is off: 8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl (ask Jonathan).')
    expect(offWords(eight.opt.label, eight.why!, true)).toBe('8 ft is off: 8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl.')
    // 6 ft is on and says nothing.
    expect(row(cfg).options.find(o => o.opt.key === '6')).toEqual(expect.objectContaining({ state: 'ok' }))
    expect(row(cfg).options.find(o => o.opt.key === '6')!.why).toBeUndefined()
    // Different fences missing different prices: each reason once.
    const some = setup({ "WV-ND 8'x6' Privacy": { section: 41250 }, "WV-ND 8'x8' Privacy": { section: 41250 } })
    expect(row(some).options.find(o => o.opt.key === '8')!.why!.sort()).toEqual([
      '8 ft tall needs our post cost in Settings → Price List → 8 ft tall vinyl',
      '8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl',
    ])
    // One priced: 8 ft is on.
    const one = setup({ "WV-ND 8'x8' Privacy": { section: 41250, post: 6500 } })
    expect(row(one).options.find(o => o.opt.key === '8')!.state).toBe('ok')
  })

  test('the server and the website: an unpriced 8 ft fence is "call us for a price on 8 ft tall fence", never commercial; staff hear why', () => {
    const cfg = setup()
    const data = { config: { fenceStyles: styles(), fenceCatalog: DEFAULT_CATALOG } as any, inventory: Object.entries(INV).map(([name, unitCost], i) => ({ id: `i${i}`, name, unitCost })) as any, kits: [] }
    let err: unknown
    try { estimate(data, { fenceStyle: "WV-ND 8'x8' Privacy", runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0 }) } catch (e) { err = e }
    expect(isNotQuotable(err)).toBe(true)
    expect(notQuotableMessage(err)).toBe('Call us for a price on 8 ft tall fence')
    expect(notQuotableMessage(err)).not.toMatch(/commercial|industrial/i)
    expect(notQuotableReason(err)).toBe('8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl')
    // The website never offers it (only what is available for quoting), nor lists it with commercial and industrial.
    expect(widgetStyles(cfg).some(s => /8'x[68]'/.test(s.name))).toBe(false)
    expect(onHoldStyles(data.config).styles.some(s => /8'x[68]'/.test(s.name))).toBe(false)
    // Commercial and industrial, switched off, still say so.
    const onHold = { ...data, config: { ...data.config, fenceStyles: styles().map(s => s.name === "CL - Com 6'" ? { ...s, quotable: false } : s) } }
    expect(onHold.config.fenceStyles.some((s: FenceStyle) => s.quotable === false)).toBe(true)
    let comErr: unknown
    try { estimate(onHold, { fenceStyle: "CL - Com 6'", runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0 }) } catch (e) { comErr = e }
    expect(notQuotableMessage(comErr)).toBe('Call us for commercial and industrial fencing')
    // Priced: estimated.
    const priced = { ...data, config: { ...data.config, fenceStyles: styles({ "WV-ND 8'x8' Privacy": { section: 41250, post: 6500 } }) } }
    expect(estimate(priced, { fenceStyle: "WV-ND 8'x8' Privacy", runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0 }).sections).toBe(13)
  })

  test('the Price step: a width that is not priced is said, never "prices lower"', () => {
    const set: Pick<TierSet, 'category' | 'tiers' | 'popular'> = { category: 'Vinyl', popular: null as any, tiers: [
      { key: 'good', name: 'Good', install: 'same', width: 'cheapest', color: 'same', text: '' } as any,
    ] }
    // Only 8 x 8 priced: the tier uses it, and says 8 x 6 is not priced yet (and why).
    let cfg = setup({ "WV-ND 8'x8' Privacy": { section: 41250, post: 6500 } })
    let t = resolveTiers(job(cfg, "WV-ND 8'x8' Privacy"), cfg.fenceStyles, set)[0]
    expect(t.widthFt).toBe(8)
    expect(t.otherWidth).toBeNull()
    expect(t.otherWidthHeld).toEqual({ widthFt: 6, held: '8 ft tall needs our section and post costs in Settings → Price List → 8 ft tall vinyl' })
    // Both priced: compared as before.
    cfg = setup({ "WV-ND 8'x8' Privacy": { section: 41250, post: 6500 }, "WV-ND 8'x6' Privacy": { section: 30000, post: 6500 } })
    t = resolveTiers(job(cfg, "WV-ND 8'x8' Privacy"), cfg.fenceStyles, set)[0]
    expect(t.otherWidth).not.toBeNull()
    expect(t.otherWidthHeld).toBeUndefined()
  })
})
