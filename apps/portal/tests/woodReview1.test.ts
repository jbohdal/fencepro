/**
 * The wood kits review (Oct 30 2026), the fixes after wood moves and repairs
 * (those: moveRepair.test.ts and woodChangeOrders.test.ts):
 *
 *   2. the website quote reads wood as "Style" (Stockade, Board on Board,
 *      Shadow Box) and "Pickets" (Regular pressure treated, Alta Premium),
 *      not "Color" and "Height"; heights only when there is more than one
 *   3. the quote builder's labor line shows the wood sub rate ("$5.75/ft,
 *      vinyl $5 × 115%"), not the vinyl rate wood is figured from
 *   4. Good / Better / Best for wood offers no section width (8 ft only)
 *   5. Material Kits marks a style whose kits are all archived; the
 *      Inventory dashboard does not count archived items
 */

import { describe, test, expect, afterEach } from 'vitest'
import { setMaterialPriceSource } from '../../web/src/materialCalculator'
import { setSavedKitSets, kitStyleNote } from '../../web/src/materialKits'
import { widgetCatalogFor, estimateConfig, heldStyleReason, quoteJobFor, type EstimateData } from '../../web/src/estimate'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { planWood, woodStyleName, WOOD_PARTS, WOOD_OLD_OF } from '../../web/src/wood'
import { laborLabel } from '../../web/src/quoteCalc'
import { tierChoicesFor } from '../../web/src/tiers'
import { inventorySummaryOf } from '../../web/src/inventorySummary'
import type { FenceStyle } from '../../web/src/configStore'
import type { PricingSettings } from '../../web/src/pricingEngine'

const PRICING: PricingSettings = {
  manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 13.5, tearOutGate: 27,
  laborMode: 'subcontractor', subUnit: 'foot', subRateDefault: 5, subRateByCategory: { Vinyl: 5 },
  subWalkGate: 10, subDblGate: 20, subTearOutSection: 4, subTearOutGate: 12, priceMethod: 'cost_factor', commissionMode: 'included',
}
const OLD_ROWS: FenceStyle[] = Object.entries(WOOD_OLD_OF).map(([name, v]) => {
  const [, , height, install, width] = name.split('/')
  return { id: name, name, category: 'Wood', margin: 0.6, sectionsPerMH: 0.8, panelWidth: Number(width), mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true, material: 'wood', choices: { style: 'privacy', height, install, width }, woodOf: v } as FenceStyle
})
const plan = planWood({ fenceStyles: [...DEFAULT_FENCE_STYLES, ...OLD_ROWS], items: [], kits: [] }, '2026-10-30T12:00:00.000Z')
const COST: Record<string, number> = { ...Object.fromEntries(WOOD_PARTS.map(p => [p.part, p.unitCost])), 'Misc, Concrete': 7.06, 'Drop Rod, 48", Black': 48.01 }
const data: EstimateData = {
  config: { fenceStyles: plan.state.fenceStyles, fenceCatalog: plan.state.fenceCatalog, pricing: { ...PRICING, overheadPct: 30 } } as never,
  inventory: plan.state.items.map(i => ({ name: i.name, unitCost: COST[i.name] ?? 0, status: 'active' })),
  kits: plan.state.kits,
}
const ST = woodStyleName('stockade', 'pine')

afterEach(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('2. the website quote reads wood as Style and Pickets', () => {
  test('wood: "Style" first (Stockade, Board on Board, Shadow Box; one height, so no height), then "Pickets"', () => {
    const wood = widgetCatalogFor(data).materials.find(m => m.material === 'wood')!
    expect(wood).toBeTruthy()
    expect(wood.heightHeading).toBe('Style')
    expect(wood.heightFirst).toBe(true)
    expect(wood.heights.map(h => h.label)).toEqual(['Stockade', 'Board on Board', 'Shadow Box'])
    expect(wood.colorHeading).toBe('Pickets')
    expect(wood.colors.map(c => c.label)).toEqual(['Regular pressure treated', 'Alta Premium'])
  })
  test('vinyl keeps "Color" and "Height"', () => {
    const vinyl = widgetCatalogFor(data).materials.find(m => m.material === 'vinyl')!
    expect([vinyl.colorHeading, vinyl.heightHeading, vinyl.heightFirst]).toEqual(['Color', 'Height', undefined])
    expect(vinyl.heights.every(h => /^\d+ ft/.test(h.label))).toBe(true)
  })
})

describe('3. the wood labor rate on the quote builder', () => {
  test('a wood quote reads the wood sub rate and where it comes from; vinyl as before', () => {
    heldStyleReason(data, ST)
    const req = { fenceStyle: ST, runs: [{ ft: 100, rail: 'auto' as const }], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {}, jobType: 'new' as const }
    const job = quoteJobFor(data, req)
    expect(laborLabel(job.calc.priced, job.style)).toBe('Labor (sub, $5.75/ft, vinyl $5 × 115%)')
    // The rate shown is the one the labor is figured at: 100 ft × $5.75.
    expect(job.calc.priced.laborCost).toBe(575)
    const cfg = estimateConfig(data.config)
    const vinyl = cfg.fenceStyles.find(s => s.name === "WV-DS 6'x8' Privacy")!
    expect(laborLabel({ laborMode: 'subcontractor', subRate: 5, subUnit: 'foot' }, vinyl)).toBe('Labor (sub, $5/ft)')
    expect(laborLabel({ laborMode: 'flat', subRate: 0, subUnit: 'foot' }, job.style)).toBe('Labor (flat)')
  })
})

describe('4. Good / Better / Best for wood offers no section width', () => {
  test('wood (8 ft only): no width choices; vinyl (6 and 8 ft): all four', () => {
    const cfg = estimateConfig(data.config)
    // The six real wood styles (the Oct 19 privacy rows are held, never offered in a tier set).
    const wood = cfg.fenceStyles.filter(s => s.material === 'wood' && !(s.name in WOOD_OLD_OF))
    expect(wood.length).toBeGreaterThan(0)
    expect(tierChoicesFor(wood).widths).toEqual(['same'])
    expect(tierChoicesFor(wood).colors).toEqual(['same', 'pine', 'premium'])
    const vinyl = cfg.fenceStyles.filter(s => s.category === 'Vinyl')
    expect(tierChoicesFor(vinyl).widths).toEqual(['same', 'cheapest', '6', '8'])
  })
})

describe('5. archived kits and archived Inventory items', () => {
  test('Material Kits: a style whose kits are all archived says so', () => {
    expect(kitStyleNote([])).toBe(' (no parts list)')
    expect(kitStyleNote([{ archived: true }, { archived: true }])).toBe(' (archived)')
    expect(kitStyleNote([{ archived: true }, { archived: false }])).toBe('')
  })
  test('the Inventory dashboard does not count archived items', () => {
    const items = [
      { id: 'a', category: 'Wood', unitCost: 5, status: 'active' as const },
      { id: 'b', category: 'Wood', unitCost: 3, status: 'archived' as const },
      { id: 'c', category: 'Vinyl', unitCost: 2 },
    ]
    const levels = [{ itemId: 'b', quantity: 0, reorderPoint: 2 }, { itemId: 'a', quantity: 4, reorderPoint: 1 }]
    const s = inventorySummaryOf(items, levels)
    expect(s.totalItems).toBe(2)
    expect(s.categoryCounts).toEqual({ Wood: 1, Vinyl: 1 })
    expect(s.totalValue).toBe(20)
    expect([s.lowStockCount, s.outOfStockCount]).toEqual([0, 0])
  })
})
