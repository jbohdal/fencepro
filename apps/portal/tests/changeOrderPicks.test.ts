/**
 * The change order pick list (web/src/changeOrderPicks.ts and moveRepair.ts
 * priceChangeOrderPick): every number worked by hand from the White Vinyl no
 * dig 6'x6' kits at their parts list costs, as tests/moveRepair.test.ts does.
 *
 *   price = cost ÷ (1 − Target Margin), Target Margin = Overhead % + Repair
 *   Profit % when that is set, else the style's; whole dollars (rounded down);
 *   no minimum job price; wood: its own wood parts and wood labor (woodChangeOrders.test.ts).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { setSavedKitSets, builtInKitSet, KIT_KINDS } from '../../web/src/materialKits'
import { priceChangeOrderPick, priceRepair, moveRepairSettings, type WorkCommon } from '../../web/src/moveRepair'
import { pickList, pickPrice, pickOf } from '../../web/src/changeOrderPicks'
import { estimateConfig } from '../../web/src/estimate'
import type { QuoteStyle } from '../../web/src/quoteCalc'
import type { PricingSettings } from '../../web/src/pricingEngine'

const WV = "WV-ND 6'x6' Privacy"
const PRICING: PricingSettings = {
  manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 13.5, tearOutGate: 27,
  laborMode: 'subcontractor', subUnit: 'section', subRateDefault: 0, subRateByCategory: { Vinyl: 24 },
  subWalkGate: 10, subDblGate: 20, subTearOutSection: 4, subTearOutGate: 12, priceMethod: 'cost_factor', commissionMode: 'included',
}
const style = (extra: Partial<QuoteStyle> = {}): QuoteStyle => ({ name: WV, category: 'Vinyl', margin: 0.56, sectionsPerMH: 1.2, panelWidth: 6, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, ...extra })
const SETTINGS = moveRepairSettings({ moveRepair: { pullNdLaborCents: 500, pullNdDisposalCents: 300, pullDsLaborCents: 1500, pullDsDisposalCents: 2500 } })
const common = (extra: Partial<WorkCommon> = {}): WorkCommon => ({ style: style(), pricing: PRICING, settings: SETTINGS, overheadPct: 30, hasSalesman: false, priceAdjust: 0, extraLaborHrs: 0, ...extra })

beforeAll(() => {
  const map: Record<string, number> = { 'Tear Out Haul-Away Fence': 9.5, 'Tear Out Haul-Away Gate': 27, 'Misc, Concrete': 6.25 }
  const k = builtInKitSet(WV)!
  for (const kind of KIT_KINDS) for (const p of k.kits[kind] ?? []) map[p.part] = p.fallbackCost
  setMaterialPriceSource(priceSourceFromMap(map))
  setSavedKitSets(() => [])
})
afterAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

describe('priced as the Repair price list prices', () => {
  test('a repair item: the repair quote of that item, without the minimum job price', () => {
    const one = priceChangeOrderPick(common(), { kind: 'repair', key: 'resetPost' }, 1)
    const quote = priceRepair({ ...common(), settings: { ...SETTINGS, minimumJobCents: 0 } }, { what: 'other', items: { resetPost: 1 }, postType: 'nd', newPostCaps: false, gateKind: 'walk', debrisCleared: true })
    expect(one.priceCents).toBe(quote.priceCents)
    expect(one.minimumApplied).toBe(false)
    expect(one.priceCents % 100).toBe(0)
    // A repair quote of the same item alone would be lifted to the $350 minimum; a change order line never is.
    expect(priceRepair(common(), { what: 'other', items: { resetPost: 1 }, postType: 'nd', newPostCaps: false, gateKind: 'walk' }).priceCents).toBe(35000)
    expect(one.priceCents).toBeLessThan(35000)
    // Three at once: the repair quote's math for three (kits rounded up as a quote rounds them).
    const three = priceChangeOrderPick(common(), { kind: 'repair', key: 'resetPost' }, 3)
    expect(three.priceCents).toBe(priceRepair({ ...common(), settings: { ...SETTINGS, minimumJobCents: 0 } }, { what: 'other', items: { resetPost: 3 }, postType: 'nd', newPostCaps: false, gateKind: 'walk', debrisCleared: true }).priceCents)
  })

  test('gate items for a walk gate and a double gate: the gate rates (sub $10 and $20 × the multiplier)', () => {
    const walk = priceChangeOrderPick(common(), { kind: 'repair', key: 'rehangGate', gateKind: 'walk' }, 1)
    const dbl = priceChangeOrderPick(common(), { kind: 'repair', key: 'rehangGate', gateKind: 'double' }, 1)
    expect(walk.lines.find(l => l.key === 'rehangGate:labor')?.cents).toBe(1000)
    expect(dbl.lines.find(l => l.key === 'rehangGate:labor')?.cents).toBe(2000)
  })

  test('pull an old post: pull labor $5 + disposal $3 (no dig) ÷ 0.56 = $14.28 → $14; dig set $15 + $25 ÷ 0.56 = $71.42 → $71', () => {
    expect(priceChangeOrderPick(common(), { kind: 'repair', key: 'pullPost' }, 1).priceCents).toBe(1400)
    expect(priceChangeOrderPick(common({ style: style({ name: "WV-DS 6'x6' Privacy" }) }), { kind: 'repair', key: 'pullPost' }, 1).priceCents).toBe(7100)
    // Not set in Settings: $0 and the warning a repair quote gives.
    const blank = priceChangeOrderPick(common({ settings: moveRepairSettings(null) }), { kind: 'repair', key: 'pullPost' }, 2)
    expect(blank.priceCents).toBe(0)
    expect(blank.warnings[0]).toMatch(/^No rate per pull labor per post \(no dig\)/)
  })

  test('a catalog part: quantity × Inventory cost ÷ (1 − Target Margin), no labor', () => {
    // 2 × $6.25 = $12.50 ÷ 0.56 = $22.32 → $22.
    const r = priceChangeOrderPick(common(), { kind: 'part', part: 'Misc, Concrete' }, 2)
    expect(r.materialCents).toBe(1250)
    expect(r.laborCents).toBe(0)
    expect(r.priceCents).toBe(2200)
    // Repair Profit % set (20) with Overhead 30 %: ÷ 0.5 = $25.
    const rp = priceChangeOrderPick(common({ settings: { ...SETTINGS, repairProfitPct: 20 } }), { kind: 'part', part: 'Misc, Concrete' }, 2)
    expect(rp.costFactor).toBe(0.5)
    expect(rp.priceCents).toBe(2500)
    // A Salesman on the quote: commission as on a repair quote (included: 10 % of $22.32 before the whole dollar rounding, out of profit).
    expect(priceChangeOrderPick(common({ hasSalesman: true }), { kind: 'part', part: 'Misc, Concrete' }, 2).commissionCents).toBe(223)
    // The quote's typed price, flat labor and slider never reach a line.
    expect(priceChangeOrderPick(common({ overrides: { finalPrice: 9999, laborCost: 500 }, priceAdjust: 0.5, extraLaborHrs: 3 }), { kind: 'part', part: 'Misc, Concrete' }, 2).priceCents).toBe(2200)
  })

  test('a wood style with no wood kit in use (the Oct 19 privacy rows): material × the Wood factor (115 %), as before; real wood jobs: woodChangeOrders.test.ts', () => {
    const wood = style({ name: 'Wood 6ft', woodBase: style() } as Partial<QuoteStyle>)
    // $12.50 × 1.15 = $14.38 ÷ 0.56 = $25.67 → $25.
    expect(priceChangeOrderPick(common({ style: wood }), { kind: 'part', part: 'Misc, Concrete' }, 2).priceCents).toBe(2500)
  })
})

describe('the list', () => {
  const cfg = estimateConfig(null)
  const inv = [
    { id: 'c1', name: 'Misc, Concrete', unitCost: 6.25, category: 'Misc' },
    { id: 'off', name: 'Old part', unitCost: 5, status: 'inactive' },
    { id: 'free', name: '*Vinyl section price', unitCost: 0 },
  ]
  const nd = cfg.fenceStyles.find(s => /ND/.test(s.name) && !s.woodBase)!.name
  test('every repair item (gates twice) and every Inventory item in use with a cost', () => {
    const l = pickList(cfg, inv, { fenceStyle: nd, hasSalesman: false }, 30)
    expect(l.noStyle).toBe(false)
    expect(l.items.filter(i => i.group === 'repair').map(i => i.source)).toEqual([
      'repair:resetPost', 'repair:replacePost', 'repair:repairSection', 'repair:replaceSection', 'repair:rehangGate:walk', 'repair:rehangGate:double',
      'repair:replaceGate:walk', 'repair:replaceGate:double', 'repair:haulDebris', 'repair:footerDisposal', 'repair:pullPost',
    ])
    expect(l.items.filter(i => i.group === 'catalog').map(i => i.source)).toEqual(['catalog:c1'])
    expect(l.items.find(i => i.source === 'repair:replaceGate:double')!.label).toBe('Replace a gate (double gate)')
  })
  test('an unknown style or source prices nothing', () => {
    expect(pickList(cfg, inv, { fenceStyle: 'No such style', hasSalesman: false }, 30)).toMatchObject({ noStyle: true, items: [] })
    expect(pickOf('repair:rehangGate', inv)).toBeNull()
    expect(pickOf('repair:nothing', inv)).toBeNull()
    expect(pickOf('catalog:off', inv)).toBeNull()
    expect(pickPrice(cfg, inv, { fenceStyle: nd, hasSalesman: false }, 30, 'catalog:c1', 2)).toMatchObject({ qty: 2, label: 'Misc, Concrete' })
  })
})
