/**
 * Change orders on wood jobs (Jonathan, Oct 30 2026: "Change orders on wood
 * jobs: use the wood parts and wood pricing, not vinyl +15%";
 * web/src/moveRepair.ts woodChangeOrder). On a Stockade, PT Pine pickets job:
 *   - a section, a walk gate or a double gate added by change order is
 *     priced from the wood style's own kit and Inventory (the same parts and
 *     costs a new wood quote uses for those pieces), labor = the White Vinyl
 *     line's labor × the Wood factor;
 *   - a catalog part is its Inventory cost, nothing added;
 *   - repair quotes and moves on wood stay White Vinyl × the Wood factor;
 *   - an Oct 19 privacy job (no wood kit in use) keeps the old way.
 */

import { describe, test, expect, afterEach } from 'vitest'
import { setMaterialPriceSource } from '../../web/src/materialCalculator'
import { setSavedKitSets, linesFromKitSet, type KitSet } from '../../web/src/materialKits'
import { estimateConfig, heldStyleReason, changeOrderPickPriceFor, type EstimateData } from '../../web/src/estimate'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { planWood, woodStyleName, WOOD_PARTS, WOOD_OLD_OF, WOOD_LABOR_FROM } from '../../web/src/wood'
import { priceChangeOrderPick, priceRepair, moveRepairSettings, type WorkCommon } from '../../web/src/moveRepair'
import { DEFAULT_CATALOG } from '../../web/src/fenceCatalog'
import type { FenceStyle } from '../../web/src/configStore'
import type { PricingSettings } from '../../web/src/pricingEngine'
import type { QuoteStyle } from '../../web/src/quoteCalc'

const PRICING: PricingSettings = {
  manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 13.5, tearOutGate: 27,
  laborMode: 'subcontractor', subUnit: 'section', subRateDefault: 0, subRateByCategory: { Vinyl: 24 },
  subWalkGate: 10, subDblGate: 20, subTearOutSection: 4, subTearOutGate: 12, priceMethod: 'cost_factor', commissionMode: 'included',
}
const OLD_ROWS: FenceStyle[] = Object.entries(WOOD_OLD_OF).map(([name, v]) => {
  const [, , height, install, width] = name.split('/')
  return { id: name, name, category: 'Wood', margin: 0.6, sectionsPerMH: 0.8, panelWidth: Number(width), mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true, material: 'wood', choices: { style: 'privacy', height, install, width }, woodOf: v } as FenceStyle
})
const plan = planWood({ fenceStyles: [...DEFAULT_FENCE_STYLES, ...OLD_ROWS], items: [], kits: [] }, '2026-10-30T12:00:00.000Z')
// The Oct 19 privacy kits, archived (as the one-time step leaves them).
const oldKits = Object.keys(WOOD_OLD_OF).map(n => ({ id: `old_${n}`, name: n, styleName: n, madeFor: 'wood', archived: true, roundUp: [], kits: { section: [{ part: 'Wood, Picket, 62-1/4"', qty: 11, fallbackCost: 0 }] } })) as KitSet[]
const config = { fenceStyles: plan.state.fenceStyles, fenceCatalog: DEFAULT_CATALOG, pricing: { ...PRICING, overheadPct: 30 } } as any
const COST: Record<string, number> = { ...Object.fromEntries(WOOD_PARTS.map(p => [p.part, p.unitCost])), 'Misc, Concrete': 7.06, 'Drop Rod, 48", Black': 48.01 }
const data: EstimateData = {
  config,
  // Jonathan's wood costs; the White Vinyl parts not listed use their built in costs.
  inventory: plan.state.items.map(i => ({ name: i.name, unitCost: COST[i.name] ?? 0, status: 'active' })),
  kits: [...plan.state.kits, ...oldKits],
}
const ST = woodStyleName('stockade', 'pine')

/** The resolved Settings (Inventory and kits loaded, as the server does) and a change order line's common inputs for a style. */
function common(name: string): WorkCommon {
  heldStyleReason(data, name)
  const cfg = estimateConfig(data.config)
  const style = cfg.fenceStyles.find(s => s.name === name) as QuoteStyle
  return { style, pricing: cfg.pricing, overrides: {}, settings: moveRepairSettings(cfg), overheadPct: 30, hasSalesman: false, priceAdjust: 0, extraLaborHrs: 0 }
}
/** A new wood quote's material for these kit counts: its own kit at Inventory costs (materialKits.linesFromKitSet), cents. */
function newQuoteMaterialCents(counts: Record<string, number>): number {
  const set = plan.state.kits.find(k => k.styleName === ST)!
  const zero = { section: 0, section8: 0, line: 0, corner: 0, end: 0, blank: 0, walkGate: 0, dblGate: 0, perFoot: 0, perJob: 0 }
  return linesFromKitSet(set, { ...zero, ...counts } as any).reduce((t, l) => t + Math.round(l.qty * COST[l.part] * 100), 0)
}

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('change orders on a wood job: wood parts, wood labor', () => {
  const pick = (name: string, key: 'replaceSection' | 'replaceGate', n: number, gateKind?: 'walk' | 'double') =>
    priceChangeOrderPick(common(name), { kind: 'repair', key, ...(gateKind ? { gateKind } : {}) }, n)
  const vinyl = (key: 'replaceSection' | 'replaceGate', n: number, gateKind?: 'walk' | 'double') => pick(WOOD_LABOR_FROM, key, n, gateKind)

  test('+2 sections: the section kit\'s wood parts at Inventory cost, as a new wood quote; labor White Vinyl × 115%', () => {
    const r = pick(ST, 'replaceSection', 2)
    expect(r.materialCents).toBe(newQuoteMaterialCents({ section: 2 }))
    expect(r.materialCents).toBe(14284)   // 6 rails $31.38 + 34 pickets $94.18 + 204 picket nails $16.32 + 24 framing nails $0.96
    expect(r.pullSheet.map(i => [i.item, i.qty, i.unitCost])).toEqual([
      ["Wood, PT Rail, 2x4x8'", 6, 5.23], ["Wood, Picket, PT Pine, 1x6x6'", 34, 2.77],
      ['Wood, Picket Nail, 1-3/4" x .090 15° 304 SS Ring Shank', 204, 0.08], ['Wood, Framing Nail, 3" x .120 21° Galv Ring Shank', 24, 0.04],
    ])
    expect(r.laborCents).toBe(Math.round(vinyl('replaceSection', 2).laborCents * 1.15))
    expect(r.pullSheet.some(i => i.moneyOnly || /Wood material|Vinyl/.test(i.item))).toBe(false)
  })

  test('+1 walk gate (4 ft): frame, 9 pickets, 36 screws, latch; +1 double gate adds the drop rod', () => {
    const w = pick(ST, 'replaceGate', 1, 'walk')
    expect(w.materialCents).toBe(newQuoteMaterialCents({ walkGate: 1, anyGate: 1, anyWalkGate: 1 }))
    expect(w.materialCents).toBe(40999)   // $350 + 9 × $2.77 + 36 × $0.09 + $31.82
    expect(w.laborCents).toBe(Math.round(vinyl('replaceGate', 1, 'walk').laborCents * 1.15))
    const d = pick(ST, 'replaceGate', 1, 'double')
    expect(d.materialCents).toBe(newQuoteMaterialCents({ dblGate: 1, anyGate: 1, anyDblGate: 1 }))
    expect(d.materialCents).toBe(83617)   // 2 × $350 + 18 × $2.77 + 72 × $0.09 + $31.82 + drop rod $48.01
    expect(d.pullSheet.find(i => i.item === 'Drop Rod, 48", Black')?.qty).toBe(1)
    expect(d.laborCents).toBe(Math.round(vinyl('replaceGate', 1, 'double').laborCents * 1.15))
  })

  test('priced as every change order line is (repair margin, whole dollars); the server pick price is the same', () => {
    const r = pick(ST, 'replaceSection', 2)
    expect(r.costCents).toBe(r.materialCents + r.laborCents + r.disposalCents)
    expect(r.priceCents % 100).toBe(0)
    expect(r.priceCents).toBe(Math.floor(r.costCents / r.costFactor / 100) * 100)
    expect(changeOrderPickPriceFor(data, { fenceStyle: ST, hasSalesman: false }, 'repair:replaceSection', 2)!.priceCents).toBe(r.priceCents)
  })

  test('a catalog part on a wood job: its Inventory cost, nothing added', () => {
    const r = priceChangeOrderPick(common(ST), { kind: 'part', part: "Wood, Picket, PT Pine, 1x6x6'" }, 10)
    expect(r.materialCents).toBe(2770)
    expect(r.laborCents).toBe(0)
  })

  test('repair quotes on wood stay White Vinyl × the Wood factor', () => {
    const inputs = { what: 'other' as const, items: { replaceSection: 2 }, postType: 'ds' as const, newPostCaps: false, gateKind: 'walk' as const, debrisCleared: true }
    const rep = priceRepair(common(ST), inputs)
    const v = priceRepair(common(WOOD_LABOR_FROM), inputs)
    expect(rep.materialCents).toBe(Math.round(v.materialCents * 1.15))
    expect(rep.wood?.base).toBe(WOOD_LABOR_FROM)
  })

  test('an Oct 19 privacy job (no wood kit in use) keeps the old way, never $0 material', () => {
    const r = pick('wood/privacy/6/ds/8', 'replaceSection', 2)
    const v = vinyl('replaceSection', 2)
    expect(r.materialCents).toBe(Math.round(v.materialCents * 1.15))
    expect(r.materialCents).toBeGreaterThan(0)
  })
})
