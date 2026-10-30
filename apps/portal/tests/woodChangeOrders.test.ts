/**
 * Change orders on wood jobs (Jonathan, Oct 30 2026: "Change orders on wood
 * jobs: use the wood parts and wood pricing, not vinyl +15%";
 * web/src/moveRepair.ts woodChangeOrder). On a Stockade, PT Pine pickets job:
 *   - a section, a walk gate or a double gate added (or replaced) by change
 *     order is priced as a new wood quote prices those pieces (moveRepair.ts
 *     priceAddedPieces): the wood style's own kit and Inventory, labor = the
 *     White Vinyl install labor × the Wood factor, the style's Target Margin;
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
import { calculateQuote, type QuoteStyle, type QuoteCalcInput } from '../../web/src/quoteCalc'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'

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
  const pick = (name: string, key: 'replaceSection' | 'replaceGate', n: number, gateKind?: 'walk' | 'double', pricing?: PricingSettings) =>
    priceChangeOrderPick({ ...common(name), ...(pricing ? { pricing } : {}) }, { kind: 'repair', key, ...(gateKind ? { gateKind } : {}) }, n)
  const add = (piece: 'section' | 'walk' | 'double', n: number, pricing?: PricingSettings, job = { walkGates: 0, dblGates: 0 }) =>
    priceChangeOrderPick({ ...common(ST), ...(pricing ? { pricing } : {}) }, { kind: 'add', piece }, n, job)
  /** A new Stockade quote: one run of `secs` 8 ft sections, 2 end posts, plus `extra` (quoteCalc.ts woodQuote); cents. */
  const newQuote = (pricing: PricingSettings, secs: number, extra: Partial<QuoteCalcInput> = {}) => {
    const c = common(ST)
    const q = calculateQuote({
      style: c.style, runs: [{ ft: secs * 8, rail: 'auto' }], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
      extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, overrides: {}, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, ...extra,
    })
    return { material: Math.round(q.materialCost * 100), labor: Math.round(q.priced.laborCost * 100), price: Math.round(q.priced.price * 100) }
  }
  const HOURLY: PricingSettings = { ...PRICING, laborMode: 'hourly' }
  const FOOT: PricingSettings = { ...PRICING, subUnit: 'foot', subRateByCategory: { Vinyl: 5 } }

  for (const [mode, pricing] of [['sub per section', PRICING], ['sub per foot', FOOT], ['hourly', HOURLY]] as const) {
    test(`+2 sections, ${mode}: what 2 more sections add to a new wood quote (wood kit, White Vinyl labor × 115%, the style margin)`, () => {
      const a = newQuote(pricing, 10), b = newQuote(pricing, 12)
      const r = add('section', 2, pricing)
      expect(r.materialCents).toBe(b.material - a.material)
      // Wood labor is rounded to the cent once per total, so two totals' difference can be a cent off.
      expect(Math.abs(r.laborCents - (b.labor - a.labor))).toBeLessThanOrEqual(1)
      expect(r.costFactor).toBe(common(ST).style.margin)
      expect(Math.abs(r.priceCents - (b.price - a.price))).toBeLessThanOrEqual(100)
    })
    test(`+1 walk gate, ${mode}: the gate kit and its two 6x6 gate posts, as a new wood quote adds them`, () => {
      const a = newQuote(pricing, 10), b = newQuote(pricing, 10, { ends: 4, walkGates: 1 })
      const r = add('walk', 1, pricing)
      expect(r.materialCents).toBe(b.material - a.material)
      expect(r.materialCents).toBe(newQuoteMaterialCents({ walkGate: 1, end: 2 }))   // the end posts become 6x6 gate posts
      expect(Math.abs(r.laborCents - (b.labor - a.labor))).toBeLessThanOrEqual(1)
      expect(Math.abs(r.priceCents - (b.price - a.price))).toBeLessThanOrEqual(100)
    })
  }

  test('+2 sections: the section kit and 2 line posts at Inventory cost; labor = sub $24 × 2 × 115%', () => {
    const r = add('section', 2)
    expect(r.materialCents).toBe(newQuoteMaterialCents({ section: 2, line: 2 }))
    expect(r.laborCents).toBe(5520)
    expect(r.pullSheet.some(i => i.moneyOnly || /Wood material|Vinyl/.test(i.item))).toBe(false)
  })

  test('Replace 2 sections: the section kit\'s wood parts on the posts there, and the new quote\'s tear out', () => {
    const r = pick(ST, 'replaceSection', 2)
    expect(r.materialCents).toBe(newQuoteMaterialCents({ section: 2 }))
    expect(r.materialCents).toBe(14284)   // 6 rails $31.38 + 34 pickets $94.18 + 204 picket nails $16.32 + 24 framing nails $0.96
    expect(r.pullSheet.map(i => [i.item, i.qty, i.unitCost])).toEqual([
      ["Wood, PT Rail, 2x4x8'", 6, 5.23], ["Wood, Picket, PT Pine, 1x6x6'", 34, 2.77],
      ['Wood, Picket Nail, 1-3/4" x .090 15° 304 SS Ring Shank', 204, 0.08], ['Wood, Framing Nail, 3" x .120 21° Galv Ring Shank', 24, 0.04],
    ])
    // Install: sub $24 × 2 × 115% = $55.20, + sub tear out $4 × 2 (not a wood rate); haul away $9.50 + tear out $13.50 a section.
    expect(r.laborCents).toBe(5520 + 800)
    expect(r.disposalCents).toBe(4600)
  })

  test('Replace a walk gate (4 ft): frame, 9 pickets, 36 screws, latch; a double gate adds the drop rod; no posts', () => {
    const w = pick(ST, 'replaceGate', 1, 'walk')
    expect(w.materialCents).toBe(newQuoteMaterialCents({ walkGate: 1 }))
    expect(w.materialCents).toBe(40999)   // $350 + 9 × $2.77 + 36 × $0.09 + latch $31.82
    expect(w.laborCents).toBe(Math.round(1000 * 1.15) + 1200)   // sub walk gate $10 × 115% + sub tear out gate $12
    const d = pick(ST, 'replaceGate', 1, 'double')
    expect(d.materialCents).toBe(newQuoteMaterialCents({ dblGate: 1 }))
    const first = add('double', 1)
    expect(first.materialCents).toBe(newQuoteMaterialCents({ dblGate: 1, end: 2, anyGate: 1, anyDblGate: 1 }))
    expect(first.pullSheet.find(i => i.item === 'Drop Rod, 48", Black')?.qty).toBe(1)
    expect(add('double', 1, PRICING, { walkGates: 1, dblGates: 1 }).pullSheet.some(i => i.item === 'Drop Rod, 48", Black')).toBe(false)
  })

  test('priced as a new quote is (the style\'s Target Margin, whole dollars); the server pick price is the same', () => {
    const r = add('section', 2)
    expect(r.costCents).toBe(r.materialCents + r.laborCents + r.disposalCents)
    expect(r.priceCents % 100).toBe(0)
    expect(r.priceCents).toBe(Math.floor(r.costCents / r.costFactor / 100) * 100)
    expect(changeOrderPickPriceFor(data, { fenceStyle: ST, hasSalesman: false }, 'add:section', 2)!.priceCents).toBe(r.priceCents)
    expect(changeOrderPickPriceFor(data, { fenceStyle: ST, hasSalesman: false }, 'repair:replaceSection', 2)!.priceCents).toBe(pick(ST, 'replaceSection', 2).priceCents)
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
    const v = priceRepair(common(WOOD_LABOR_FROM), { what: 'other', items: { replaceSection: 2 }, postType: 'ds', newPostCaps: false, gateKind: 'walk', debrisCleared: true })
    expect(r.materialCents).toBe(Math.round(v.materialCents * 1.15))
    expect(r.materialCents).toBeGreaterThan(0)
    // An added section on such a job: the same old way.
    expect(priceChangeOrderPick(common('wood/privacy/6/ds/8'), { kind: 'add', piece: 'section' }, 2).priceCents).toBe(r.priceCents)
  })
})
