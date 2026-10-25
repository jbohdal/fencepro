/**
 * Fence moves and repairs (web/src/moveRepair.ts), wood (web/src/wood.ts),
 * the minimum job price and who sees the cost lines. Every number below is
 * worked by hand from the built in White Vinyl no dig 6'x6' kits at the costs
 * in PRICES (the kits' own parts list costs), so a formula that changes shows.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { setSavedKitSets, builtInKitSet, KIT_KINDS } from '../../web/src/materialKits'
import {
  priceMove, priceRepair, moveRepairSettings, blankSettings, seesCosts, newFenceBetter, styleRates, oldLine, postTypeOf,
  DEFAULT_MOVE_REPAIR, toSavedWork, matchRisk, type WorkCommon, type MoveInputs,
} from '../../web/src/moveRepair'
import { calculateQuote, type QuoteStyle } from '../../web/src/quoteCalc'
import { estimateConfig } from '../../web/src/estimate'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { planWood, woodPartName, WOOD_OF } from '../../web/src/wood'
import { buildWorkProposal, workOption } from '../../web/src/proposal'
import type { PricingSettings } from '../../web/src/pricingEngine'

const WV = "WV-ND 6'x6' Privacy"
const WVDS = "WV-DS 6'x6' Privacy"
const PRICING: PricingSettings = {
  manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 13.5, tearOutGate: 27,
  laborMode: 'subcontractor', subUnit: 'section', subRateDefault: 0, subRateByCategory: { Vinyl: 24 },
  subWalkGate: 10, subDblGate: 20, subTearOutSection: 4, subTearOutGate: 12, priceMethod: 'cost_factor', commissionMode: 'included',
}
const style = (name: string, extra: Partial<QuoteStyle> = {}): QuoteStyle => ({ name, category: 'Vinyl', margin: 0.56, sectionsPerMH: 1.2, panelWidth: 6, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, ...extra })
const SETTINGS = moveRepairSettings({ moveRepair: { pullNdLaborCents: 500, pullNdDisposalCents: 300, pullDsLaborCents: 1500, pullDsDisposalCents: 2500 } })
const common = (s: QuoteStyle, extra: Partial<WorkCommon> = {}): WorkCommon => ({ style: s, pricing: PRICING, settings: SETTINGS, overheadPct: 30, hasSalesman: false, priceAdjust: 0, extraLaborHrs: 0, ...extra })
const straight = (ft: number, walk = 0) => ({ runs: walk ? [ft / 2, ft / 2] : [ft], corners: 0, ends: walk ? 4 : 2, walkGates: walk, dblGates: 0 })
const mv = (m: Partial<MoveInputs>): MoveInputs => ({ oldFt: 100, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd', newPostCaps: false, ...m })
const cents = (r: { lines: Array<{ key: string; cents: number }> }, key: string) => r.lines.find(l => l.key === key)?.cents ?? 0

beforeAll(() => {
  // Every kit part at its parts list cost, plus the tear out haul away lines.
  const map: Record<string, number> = { 'Tear Out Haul-Away Fence': 9.5, 'Tear Out Haul-Away Gate': 27 }
  for (const n of [WV, WVDS, "WV-ND 6'x8' Privacy", "WV-DS 6'x8' Privacy", "CL - 4' Galv", 'Alum - ND - Emily - 48']) {
    const k = builtInKitSet(n)!
    for (const kind of KIT_KINDS) for (const p of k.kits[kind] ?? []) map[p.part] = p.fallbackCost
  }
  setMaterialPriceSource(priceSourceFromMap(map))
  setSavedKitSets(() => [])
})
afterAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('settings', () => {
  test('defaults: 1.5 removal, 15% damage, $350 minimum, 115% wood, post pull blank', () => {
    const s = moveRepairSettings(null)
    expect(s.removalMultiplier).toBe(1.5)
    expect(s.gateRemovalMultiplier).toBe(1.5)
    expect(s.damagePctDefault).toBe(15)
    expect(s.minimumJobCents).toBe(35000)
    expect(s.minimumAppliesToNew).toBe(false)
    expect(s.woodFactorPct).toBe(115)
    expect(s.pullNdLaborCents).toBeNull()
    expect(blankSettings(s)).toEqual([
      'Pull labor per post, no dig', 'Disposal per post, no dig', 'Pull labor per post, dig set (concrete)', 'Disposal per post, dig set (concrete)',
      "Repair Profit % (blank uses each style's Target Profit %)",
    ])
  })
  test('install rates: sub per section, sub per foot × width, hourly', () => {
    expect(styleRates(style(WV), PRICING).perSection).toBe(24)
    expect(styleRates(style(WV), { ...PRICING, subUnit: 'foot', subRateByCategory: { Vinyl: 4 } }).perSection).toBe(24)
    const h = styleRates(style(WV), { ...PRICING, laborMode: 'hourly' })
    expect(h.perSection).toBeCloseTo(25 / 1.2, 10)
    expect(h.perWalkGate).toBe(60)
    // Tear out per section, as a new fence charges it: haul away + tear out + sub tear out.
    expect(styleRates(style(WV), PRICING).tearOutSection).toBe(27)
  })
  test('old line: per run either side of each gate, posts = sections + runs, editable; post type from the style', () => {
    expect(oldLine(mv({ oldFt: 100 }), 6)).toEqual({ sections: 17, posts: 18 })
    expect(oldLine(mv({ oldFt: 100, oldWalkGates: 1 }), 6)).toEqual({ sections: 18, posts: 20 })
    expect(oldLine(mv({ oldFt: 100, oldSections: 16, oldPosts: 20 }), 6)).toEqual({ sections: 16, posts: 20 })
    expect(postTypeOf(style(WV))).toBe('nd')
    expect(postTypeOf(style(WVDS))).toBe('ds')
  })
})

describe('move (spec 2 a to h)', () => {
  test('100 ft to 100 ft, no gates: every line by hand', () => {
    const r = priceMove(common(style(WV)), mv({}), straight(100))
    expect(cents(r, 'removal')).toBe(61200)            // a. 17 × $24 × 1.5
    expect(cents(r, 'pull')).toBe(18 * 500)             // b. 18 posts × $5.00
    expect(cents(r, 'disposal')).toBe(18 * 300)         //    18 posts × $3.00
    expect(cents(r, 'newPosts')).toBe(20770)            // c. 16 line + 2 end × $11.17, 54 hex × $0.123 = 6.64
    expect(cents(r, 'setting')).toBe(47304)             //    36 donuts × 3.19 + 18 pipe × 19.50 + 72 pins × 0.10
    expect(cents(r, 'caps')).toBe(0)                    //    caps reused
    expect(cents(r, 'reinstall')).toBe(40800)           // d. 17 × $24
    expect(cents(r, 'damage')).toBe(13557)              // e. ceil(17 × 15%) = 3 × $45.19
    expect(r.materialCents).toBe(20770 + 47304 + 13557)
    expect(r.laborCents).toBe(61200 + 9000 + 40800)
    expect(r.disposalCents).toBe(5400)
    expect(r.costCents).toBe(198031)
    expect(r.costFactor).toBe(0.56)
    expect(r.priceCents).toBe(353600)                   // $3,536.27 rounded down to the whole dollar (Oct 21 2026)
    expect(r.roundingCents).toBe(Math.round(1980.31 / 0.56 * 100) - 353600)   // the 27 cents, out of profit
    expect(r.minimumApplied).toBe(false)
    expect(r.needs811).toBe(true)
    expect(r.pullSheet.every(i => !/Tear Out/.test(i.item))).toBe(true)
  })
  test('gates: rehung with new hinges and latch; "Replace gate" uses the whole gate kit; removal at the gate rate × 1.5', () => {
    const r = priceMove(common(style(WV)), mv({ oldWalkGates: 1 }), straight(100, 1))
    expect(cents(r, 'removalWalk')).toBe(1500)          // $10 × 1.5
    expect(cents(r, 'gateHardware')).toBe(4949)         // hinge 29.03 + latch 20.46
    expect(cents(r, 'rehangWalk')).toBe(1000)
    const rr = priceMove(common(style(WV)), mv({ oldWalkGates: 1, replaceGates: [true] }), straight(100, 1))
    expect(cents(rr, 'gateHardware')).toBe(0)
    const kit = builtInKitSet(WV)!.kits.walkGate!
    expect(cents(rr, 'newGates')).toBe(kit.reduce((t, p) => t + Math.round(p.qty * p.fallbackCost * 100), 0))
  })
  test('new post caps toggle adds a cap per post', () => {
    const r = priceMove(common(style(WV)), mv({ newPostCaps: true }), straight(100))
    expect(cents(r, 'caps')).toBe(18 * 100)
  })
  test('longer line: extra sections like a new fence (section kits and install labor)', () => {
    const r = priceMove(common(style(WV)), mv({}), straight(120))
    expect(cents(r, 'extra')).toBe(3 * 4519)            // 20 − 17 = 3 sections × $45.19
    expect(cents(r, 'extraLabor')).toBe(3 * 2400)
    expect(cents(r, 'reinstall')).toBe(17 * 2400)
    expect(r.lines.some(l => l.key === 'leftover')).toBe(false)
  })
  test('shorter line: leftover sections hauled away at the tear out rate', () => {
    const r = priceMove(common(style(WV)), mv({}), straight(80))
    expect(cents(r, 'leftover')).toBe(3 * 2700)          // 17 − 14 = 3 × $27.00
    expect(cents(r, 'reinstall')).toBe(14 * 2400)
    expect(cents(r, 'damage')).toBe(3 * 4519)            // ceil(14 × 15%) = 3
  })
  test('dig set old posts use the concrete pull and disposal rates', () => {
    const r = priceMove(common(style(WVDS, { margin: 0.6, sectionsPerMH: 0.8 })), mv({ oldPostType: 'ds' }), straight(100))
    expect(cents(r, 'pull')).toBe(18 * 1500)
    expect(cents(r, 'disposal')).toBe(18 * 2500)
    expect(r.lines.find(l => l.key === 'setting')!.label).toMatch(/concrete/)
  })
  test('damage % on the quote: 0 means none, 100 means every section', () => {
    expect(cents(priceMove(common(style(WV)), mv({ damagePct: 0 }), straight(100)), 'damage')).toBe(0)
    expect(cents(priceMove(common(style(WV)), mv({ damagePct: 100 }), straight(100)), 'damage')).toBe(17 * 4519)
  })
  test('Repair Profit % sets the Target Margin to Overhead + it', () => {
    const r = priceMove(common(style(WV), { settings: { ...SETTINGS, repairProfitPct: 20 } }), mv({}), straight(100))
    expect(r.costFactor).toBe(0.5)
    expect(r.priceCents).toBe(Math.floor(Math.round(r.costCents / 0.5) / 100) * 100)
  })
  test('hourly crew still works', () => {
    const r = priceMove(common(style(WV), { pricing: { ...PRICING, laborMode: 'hourly' } }), mv({}), straight(100))
    expect(cents(r, 'reinstall')).toBe(Math.round(17 * (25 / 1.2) * 100))
  })
  test('a missing rate shows the missing rate warning and counts $0', () => {
    const r = priceMove(common(style(WV), { settings: DEFAULT_MOVE_REPAIR }), mv({}), straight(100))
    expect(r.warnings[0]).toMatch(/^No rate per pull labor per post \(no dig\), per disposal per post \(no dig\) is set, so that cost is \$0/)
    expect(r.lines.find(l => l.key === 'pull')!.missing).toBe(true)
  })
})

describe('repair (spec 3)', () => {
  test('reset a leaning post: pull + disposal + line post kit (cap reused) + labor × 1.5; hits the $350 minimum', () => {
    const r = priceRepair(common(style(WV)), { what: 'leaning', items: { resetPost: 1 }, postType: 'nd', newPostCaps: false, gateKind: 'walk' })
    expect(cents(r, 'resetPost:pull')).toBe(500)
    expect(cents(r, 'resetPost:disposal')).toBe(300)
    expect(cents(r, 'resetPost:post')).toBe(1117 + 37 + 2628)   // post + 3 hex (0.369 → 0.37) + setting 26.28
    expect(cents(r, 'resetPost:labor')).toBe(3600)               // $24 × 1.5
    expect(r.minimumApplied).toBe(true)
    expect(r.priceCents).toBe(35000)
    expect(r.basePriceCents).toBeLessThan(35000)
  })
  test('replace a section, repair a section with chosen parts, rehang and replace a gate, haul debris', () => {
    const r = priceRepair(common(style(WV)), {
      what: 'storm', items: { replaceSection: 2, repairSection: 1, rehangGate: 1, replaceGate: 1, haulDebris: 2 }, postType: 'nd', newPostCaps: false, gateKind: 'walk',
      repairParts: [{ part: '*Vinyl, White, Picket, 62-1/4"', qty: 4 }],
    })
    expect(cents(r, 'replaceSection:parts')).toBe(2 * 4519)
    expect(cents(r, 'replaceSection:labor')).toBe(2 * 2400 * 1.5)
    expect(cents(r, 'repairSection:parts')).toBe(4 * 271)
    expect(cents(r, 'repairSection:labor')).toBe(2400)
    expect(cents(r, 'rehangGate:parts')).toBe(4949)
    expect(cents(r, 'rehangGate:labor')).toBe(1000)
    expect(cents(r, 'replaceGate:labor')).toBe(1500)
    expect(cents(r, 'haulDebris')).toBe(2 * 2700)
    expect(r.needs811).toBe(false)
  })
  test('the minimum does not apply over it, and a typed price under it stays but warns', () => {
    const big = priceRepair(common(style(WV)), { what: 'storm', items: { replaceSection: 6 }, postType: 'nd', newPostCaps: false, gateKind: 'walk' })
    expect(big.minimumApplied).toBe(false)
    const typed = priceRepair(common(style(WV), { overrides: { finalPrice: 200 } }), { what: 'leaning', items: { resetPost: 1 }, postType: 'nd', newPostCaps: false, gateKind: 'walk' })
    expect(typed.priceCents).toBe(20000)
    expect(typed.minimumApplied).toBe(false)
    expect(typed.warnings.some(w => /under the minimum/.test(w))).toBe(true)
  })
  test('the minimum is a setting', () => {
    const r = priceRepair(common(style(WV), { settings: { ...SETTINGS, minimumJobCents: 50000 } }), { what: 'leaning', items: { resetPost: 1 }, postType: 'nd', newPostCaps: false, gateKind: 'walk' })
    expect(r.priceCents).toBe(50000)
  })
})

describe('checks (spec 4)', () => {
  test('a new fence may be better: over half a run damaged, or repair over 60% of a new fence', () => {
    expect(newFenceBetter({ repairCents: 100, newFenceCents: 1000, damagedByRun: [{ damaged: 4, sections: 7 }] }).over50).toBe(true)
    expect(newFenceBetter({ repairCents: 100, newFenceCents: 1000, damagedByRun: [{ damaged: 3, sections: 7 }] }).show).toBe(false)
    expect(newFenceBetter({ repairCents: 601, newFenceCents: 1000, damagedByRun: [] }).over60).toBe(true)
    expect(newFenceBetter({ repairCents: 600, newFenceCents: 1000, damagedByRun: [] }).over60).toBe(false)
  })
})

describe('who sees costs (spec 7)', () => {
  test('owner, admin, manager, office and salesman see the breakdown (Oct 25, 2026); crew and customers do not', () => {
    expect(['super_admin', 'admin', 'manager', 'office_staff', 'sales_rep'].map(seesCosts)).toEqual([true, true, true, true, true])
    expect(['field_crew', null, undefined, 'customer'].map(seesCosts)).toEqual([false, false, false, false])
  })
  test('the customer proposal carries plain words and one price per option, the cost lines only inside the snapshot the server strips', () => {
    const w = priceMove(common(style(WV)), mv({}), straight(100))
    const p = buildWorkProposal({
      kind: 'move', description: w.description, options: [workOption('Move your fence', WV, w, toSavedWork(w, { move: mv({}) }), [17])],
      company: { name: 'Getter Done Fence', phone: '', email: '' }, customer: { name: 'A', address: 'B' }, warranty: '', settings: {}, footageFt: 100, gatesText: '', photoIds: {},
    })
    const shown = JSON.stringify({ ...p, options: p.options.map(({ snapshot, ...o }) => { void snapshot; return o }) })
    expect(shown).not.toMatch(/Cents|removal|disposal|material/i)
    expect(p.options[0].finalPrice).toBe(w.priceCents / 100)
    expect(p.description).toBe('Carefully remove 100 ft of fence, reinstall on the new line with all new posts, replace damaged parts as needed, haul away old posts.')
  })
})

describe('wood (× the Wood factor on material and labor)', () => {
  const vinylStyles = DEFAULT_FENCE_STYLES
  const plan = planWood({ fenceStyles: vinylStyles, items: [], kits: [] })
  const cfg = estimateConfig({ fenceStyles: plan.state.fenceStyles, pricing: { ...PRICING, overheadPct: 30 } as any })
  const st = (n: string) => cfg.fenceStyles.find(s => s.name === n)!
  test('four wood styles, one per White Vinyl 6 ft privacy install and width; wood parts named, unpriced', () => {
    expect(plan.styles.sort()).toEqual(Object.keys(WOOD_OF).sort())
    expect(plan.items.length).toBeGreaterThan(0)
    expect(plan.state.items.every(i => i.unitCost === 0)).toBe(true)
    expect(woodPartName('*Vinyl, White, Picket, 62-1/4"')).toBe('Wood, Picket, 62-1/4"')
    expect(woodPartName('ND, Donut')).toBe('ND, Donut')
    expect(planWood(plan.state).styles).toEqual([])   // twice: nothing more
    for (const [w, v] of Object.entries(WOOD_OF)) expect(st(w).woodBase?.name).toBe(v)
  })
  test('new fence: material and labor exactly 115% of the same job in vinyl (rounded to the cent once per total)', () => {
    setSavedKitSets(() => plan.state.kits)
    try {
      for (const [w, v] of Object.entries(WOOD_OF)) {
        const job = { runs: [{ ft: 100 }], corners: 0, ends: 2, walkGates: 1, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, optimizer: cfg.railOptimizer! }
        const vin = calculateQuote({ ...job, style: st(v) })
        const wood = calculateQuote({ ...job, style: st(w) })
        expect(wood.materialCost).toBe(Math.round(vin.materialCost * 1.15 * 100) / 100)
        expect(wood.priced.laborCost).toBe(Math.round(vin.priced.laborCost * 1.15 * 100) / 100)
        expect(wood.sections).toBe(vin.sections)
        expect(wood.materials.items.filter(i => !i.moneyOnly).every(i => i.unitCost === 0)).toBe(true)
        expect(wood.materials.items.some(i => /^Wood, Picket/.test(i.item))).toBe(true)
      }
    } finally { setSavedKitSets(() => []) }
  })
  test('move and repair: material and labor exactly 115% of vinyl; disposal as it is', () => {
    const w = st('wood/privacy/6/nd/6'), v = st(WV)
    const c = (s: QuoteStyle) => ({ ...common(s), pricing: cfg.pricing })
    const mw = priceMove(c(w), mv({ oldWalkGates: 1 }), straight(100, 1)), mvv = priceMove(c(v), mv({ oldWalkGates: 1 }), straight(100, 1))
    expect(mw.materialCents).toBe(Math.round(mvv.materialCents * 1.15))
    expect(mw.laborCents).toBe(Math.round(mvv.laborCents * 1.15))
    expect(mw.disposalCents).toBe(mvv.disposalCents)
    const rep = { what: 'storm' as const, items: { replaceSection: 2 }, postType: 'nd' as const, newPostCaps: false, gateKind: 'walk' as const }
    const rw = priceRepair(c(w), rep), rv = priceRepair(c(v), rep)
    expect(rw.materialCents).toBe(Math.round(rv.materialCents * 1.15))
    expect(rw.laborCents).toBe(Math.round(rv.laborCents * 1.15))
    expect(rw.pullSheet.some(i => /^Wood, Picket/.test(i.item) && i.unitCost === 0)).toBe(true)
  })
  test('the 15 unpriced wood parts never warn on a wood quote (new fence, move, repair)', () => {
    // Inventory as it is: every kit part priced, the wood parts in Inventory at $0.
    const map: Record<string, number> = { 'Tear Out Haul-Away Fence': 9.5, 'Tear Out Haul-Away Gate': 27 }
    for (const n of Object.values(WOOD_OF)) { const k = builtInKitSet(n)!; for (const kind of KIT_KINDS) for (const p of k.kits[kind] ?? []) map[p.part] = p.fallbackCost }
    for (const i of plan.state.items) map[i.name] = 0
    expect(plan.state.items.length).toBe(15)
    setMaterialPriceSource(priceSourceFromMap(map))
    setSavedKitSets(() => plan.state.kits)
    const priceWords = /price|inventory|\$0|not priced|missing/i
    try {
      for (const w of Object.keys(WOOD_OF)) {
        const s = st(w)
        const q = calculateQuote({ style: s, runs: [{ ft: 100 }], corners: 0, ends: 2, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing: cfg.pricing, optimizer: cfg.railOptimizer! })
        expect(q.materials.items.some(i => /^Wood, /.test(i.item))).toBe(true)
        expect(q.materials.warnings.filter(x => priceWords.test(x))).toEqual([])
        expect(matchRisk(s)).toBeNull()
        const c = { ...common(s), pricing: cfg.pricing }
        const mvw = priceMove(c, mv({ oldWalkGates: 1 }), straight(100, 1))
        const rpw = priceRepair(c, { what: 'storm', items: { replaceSection: 2, replacePost: 1, replaceGate: 1 }, postType: 'nd', newPostCaps: true, gateKind: 'walk', debrisCleared: true })
        for (const r of [mvw, rpw]) {
          expect(r.pullSheet.some(i => /^Wood, /.test(i.item))).toBe(true)
          expect(r.warnings.filter(x => /not in Inventory|no Inventory price/i.test(x))).toEqual([])
        }
      }
    } finally {
      const back: Record<string, number> = { 'Tear Out Haul-Away Fence': 9.5, 'Tear Out Haul-Away Gate': 27 }
      for (const n of [WV, WVDS, "WV-ND 6'x8' Privacy", "WV-DS 6'x8' Privacy", "CL - 4' Galv", 'Alum - ND - Emily - 48']) { const k = builtInKitSet(n)!; for (const kind of KIT_KINDS) for (const p of k.kits[kind] ?? []) back[p.part] = p.fallbackCost }
      setMaterialPriceSource(priceSourceFromMap(back))
      setSavedKitSets(() => [])
    }
  })
  test('the Wood factor is a setting', () => {
    const c2 = estimateConfig({ fenceStyles: plan.state.fenceStyles, pricing: { ...PRICING, overheadPct: 30 } as any, moveRepair: { woodFactorPct: 120 } } as any)
    expect(c2.fenceStyles.find(s => s.name === 'wood/privacy/6/nd/6')!.woodFactor).toBe(1.2)
  })
})
