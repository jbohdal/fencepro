/**
 * Sections and gates on a change order price the same as on a new quote
 * (Jonathan, Oct 30 2026: "+2 wood sections = $2,465 while a whole 100 ft job
 * is $3,206. Added sections and gates on a change order should price the same
 * as on a new quote: same parts, same labor rate, same margin, per section
 * and per gate. No 1.5x labor. This applies to vinyl, aluminum, chain link and
 * wood change orders"; web/src/moveRepair.ts priceAddedPieces).
 *
 * Each check prices a new quote twice with the new quote's own engine
 * (quoteCalc.ts calculateQuote): a 10 section run, then the same job with the
 * pieces added (sections on the run, or a gate with the 2 end posts it hangs
 * on). The difference is what the pieces add to a new quote. A change order
 * line for those pieces must cost exactly that (material, labor) and price it
 * at the style's Target Margin, within the $1 the whole dollar rule can move
 * either total. The kits are the built in ones with nothing rounded up (a
 * change order never rounds up a bag or a roll the job already has, so the
 * comparison is on the parts themselves). Wood: woodChangeOrders.test.ts.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { setMaterialPriceSource } from '../../web/src/materialCalculator'
import { setSavedKitSets, builtInKitSet, type KitSet } from '../../web/src/materialKits'
import { priceChangeOrderPick, moveRepairSettings, type WorkCommon, type ChangeOrderPick } from '../../web/src/moveRepair'
import { calculateQuote, type QuoteStyle, type QuoteCalcInput } from '../../web/src/quoteCalc'
import { estimateConfig, changeOrderPickPriceFor } from '../../web/src/estimate'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import type { PricingSettings } from '../../web/src/pricingEngine'

const cfg = estimateConfig(null)
const STYLES = { vinyl: "WV-ND 6'x8' Privacy", aluminum: 'Alum - DS - Emily - 48', chainLink: "CL - 5' Galv" } as const
const styleOf = (name: string) => cfg.fenceStyles.find(s => s.name === name) as QuoteStyle
const SUB_FOOT: PricingSettings = {
  ...cfg.pricing, manHourRate: 25, commissionSalesman: 0.09, commissionNonSalesman: 0, tearOutFence: 13.5, tearOutGate: 27,
  laborMode: 'subcontractor', subUnit: 'foot', subRateDefault: 5, subRateByCategory: { Vinyl: 5, Aluminum: 4, Chainlink: 3.9 },
  subWalkGate: 10, subDblGate: 20, subTearOutSection: 4, subTearOutGate: 12, priceMethod: 'cost_factor', commissionMode: 'included',
}
const HOURLY: PricingSettings = { ...SUB_FOOT, laborMode: 'hourly' }
// Settings → Moves and Repairs as on Jonathan's (Repair Profit 20 %, replace a section × 10): never used for these lines.
const SETTINGS = moveRepairSettings({ moveRepair: { repairProfitPct: 20, minimumJobCents: 35000, itemMultipliers: { resetPost: 8, rehangGate: 15, replaceGate: 20, replacePost: 8, repairSection: 8, replaceSection: 10 } } as never })

beforeAll(() => {
  setMaterialPriceSource(null)
  const sets: KitSet[] = Object.values(STYLES).map(n => ({ ...builtInKitSet(n)!, id: `t_${n}`, styleName: n, builtIn: false, roundUp: [] }))
  setSavedKitSets(() => sets)
})
afterAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

const common = (name: string, pricing: PricingSettings, hasSalesman = false): WorkCommon =>
  ({ style: styleOf(name), pricing, overrides: {}, settings: SETTINGS, overheadPct: 30, hasSalesman, priceAdjust: 0, extraLaborHrs: 0 })

/** A new quote of one run of `secs` sections with 2 end posts, plus `extra`: cost and price, cents. */
function newQuote(name: string, pricing: PricingSettings, secs: number, extra: Partial<QuoteCalcInput> = {}) {
  const style = styleOf(name)
  const w = style.panelWidth ?? 6
  const c = calculateQuote({
    style, runs: [{ ft: secs * w, rail: 'auto' }], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
    extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, overrides: {}, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, ...extra,
  })
  return { materialCents: Math.round(c.materialCost * 100), laborCents: Math.round(c.priced.laborCost * 100), priceCents: Math.round(c.priced.price * 100) }
}

/** The change order line and what the same pieces add to a new quote. */
function compare(name: string, pricing: PricingSettings, pick: ChangeOrderPick, qty: number, before: Partial<QuoteCalcInput>, after: Partial<QuoteCalcInput>, job = { walkGates: 0, dblGates: 0 }) {
  const a = newQuote(name, pricing, 10, before)
  const b = newQuote(name, pricing, 10, after)
  const co = priceChangeOrderPick(common(name, pricing), pick, qty, job)
  return { co, material: b.materialCents - a.materialCents, labor: b.laborCents - a.laborCents, price: b.priceCents - a.priceCents }
}

for (const [kind, name] of Object.entries(STYLES)) {
  for (const [mode, pricing] of [['sub per foot', SUB_FOOT], ['hourly', HOURLY]] as const) {
    describe(`${kind} (${name}), ${mode}`, () => {
      const w = styleOf(name).panelWidth ?? 6

      test('+2 sections: the parts, labor and price two more sections add to a new quote', () => {
        const { co, material, labor, price } = compare(name, pricing, { kind: 'add', piece: 'section' }, 2, {}, { runs: [{ ft: 12 * w, rail: 'auto' }] })
        expect(Math.abs(co.materialCents - material)).toBeLessThanOrEqual(2)
        expect(co.laborCents).toBe(labor)
        expect(co.costFactor).toBe(styleOf(name).margin)
        expect(co.marginFrom).toBe("the style's Target Margin")
        expect(co.disposalCents).toBe(0)
        expect(Math.abs(co.priceCents - price)).toBeLessThanOrEqual(100)
        expect(co.priceCents % 100).toBe(0)
        expect(co.minimumApplied).toBe(false)
        // The posts: one line post per section added.
        expect(co.description).toBe('Add 2 sections with 2 new posts.')
      })

      test('per section: one section on a change order ≈ a new quote\'s price per section', () => {
        const one = priceChangeOrderPick(common(name, pricing), { kind: 'add', piece: 'section' }, 1)
        const ten = priceChangeOrderPick(common(name, pricing), { kind: 'add', piece: 'section' }, 10)
        const q = newQuote(name, pricing, 20).priceCents - newQuote(name, pricing, 10).priceCents
        expect(Math.abs(one.priceCents - q / 10)).toBeLessThanOrEqual(100)
        expect(Math.abs(ten.priceCents - q)).toBeLessThanOrEqual(100)
      })

      test('+1 walk gate: the gate, its 2 posts and gate labor, as a new quote adds them', () => {
        const { co, material, labor, price } = compare(name, pricing, { kind: 'add', piece: 'walk' }, 1, {}, { ends: 4, walkGates: 1 })
        expect(Math.abs(co.materialCents - material)).toBeLessThanOrEqual(2)
        expect(co.laborCents).toBe(labor)
        if (mode === 'sub per foot') expect(co.laborCents).toBe(1000)   // the sub walk gate rate, no multiplier
        expect(Math.abs(co.priceCents - price)).toBeLessThanOrEqual(100)
      })

      test('+1 double gate (with its blank post), on a job that already has a double gate', () => {
        const { co, material, labor, price } = compare(name, pricing, { kind: 'add', piece: 'double' }, 1, { ends: 4, dblGates: 1 }, { ends: 6, dblGates: 2 }, { walkGates: 0, dblGates: 1 })
        expect(Math.abs(co.materialCents - material)).toBeLessThanOrEqual(2)
        expect(co.laborCents).toBe(labor)
        expect(Math.abs(co.priceCents - price)).toBeLessThanOrEqual(100)
      })
    })
  }
}

describe('chain link gates by width, and the once per job gate parts', () => {
  const CL = STYLES.chainLink
  test('a 5 ft walk gate and a 12 ft double gate: their own kits, as a new quote with those widths', () => {
    const w5 = compare(CL, SUB_FOOT, { kind: 'add', piece: 'walk', widthFt: 5 }, 1, {}, { ends: 4, walkGates: 1, gateWidths: { walk: [5], dbl: [] } })
    expect(Math.abs(w5.co.materialCents - w5.material)).toBeLessThanOrEqual(2)
    const d12 = compare(CL, SUB_FOOT, { kind: 'add', piece: 'double', widthFt: 12 }, 1, {}, { ends: 4, dblGates: 1, gateWidths: { walk: [], dbl: [12] } })
    expect(Math.abs(d12.co.materialCents - d12.material)).toBeLessThanOrEqual(2)
    expect(d12.co.materialCents).not.toBe(priceChangeOrderPick(common(CL, SUB_FOOT), { kind: 'add', piece: 'double' }, 1).materialCents)
  })
  test('the first walk gate on a job carries the once per job gate parts; a second one does not', () => {
    const first = compare(CL, SUB_FOOT, { kind: 'add', piece: 'walk' }, 1, {}, { ends: 4, walkGates: 1 })
    const second = compare(CL, SUB_FOOT, { kind: 'add', piece: 'walk' }, 1, { ends: 4, walkGates: 1 }, { ends: 6, walkGates: 2 }, { walkGates: 1, dblGates: 0 })
    expect(Math.abs(second.co.materialCents - second.material)).toBeLessThanOrEqual(2)
    expect(first.co.materialCents).toBeGreaterThan(second.co.materialCents)
  })
})

describe('what stays and what changed', () => {
  const V = STYLES.vinyl
  test('Replace a section / a gate: tear out at the new quote rates and new pieces on the posts there, no multiplier, the style margin', () => {
    const r = priceChangeOrderPick(common(V, SUB_FOOT), { kind: 'repair', key: 'replaceSection' }, 2)
    const add = priceChangeOrderPick(common(V, SUB_FOOT), { kind: 'add', piece: 'section' }, 2)
    expect(r.laborCents).toBe(add.laborCents + 2 * 400)   // install as added, + sub tear out $4 a section
    expect(r.disposalCents).toBe(2 * (950 + 1350))       // haul away $9.50 + tear out $13.50 a section
    expect(r.materialCents).toBeLessThan(add.materialCents)   // no posts
    expect(r.costFactor).toBe(styleOf(V).margin)
    const g = priceChangeOrderPick(common(V, SUB_FOOT), { kind: 'repair', key: 'replaceGate', gateKind: 'walk' }, 1)
    expect(g.laborCents).toBe(1000 + 1200)   // sub walk gate $10 + sub tear out gate $12
    expect(g.pullSheet.some(i => /Tear Out/.test(i.item))).toBe(false)
  })
  test('other picks stay as they were: a reset post is a repair (multiplier, Repair Profit %)', () => {
    const r = priceChangeOrderPick(common(V, SUB_FOOT), { kind: 'repair', key: 'resetPost' }, 1)
    expect(r.costFactor).toBe(0.5)
  })
  test('the server\'s pick price is the same line, the job\'s gates passed through', () => {
    const data = { config: { pricing: { ...SUB_FOOT, overheadPct: 30 }, moveRepair: { repairProfitPct: 20, minimumJobCents: 35000 } }, inventory: [], kits: Object.values(STYLES).map(n => ({ ...builtInKitSet(n)!, id: `t_${n}`, styleName: n, builtIn: false, roundUp: [] })) } as never
    const via = changeOrderPickPriceFor(data, { fenceStyle: STYLES.chainLink, hasSalesman: false, walkGates: 1, dblGates: 0 }, 'add:walk:5', 1)!
    expect(via.label).toBe('Add a 5 ft walk gate')
    setSavedKitSets(() => Object.values(STYLES).map(n => ({ ...builtInKitSet(n)!, id: `t_${n}`, styleName: n, builtIn: false, roundUp: [] })))
    expect(via.priceCents).toBe(priceChangeOrderPick(common(STYLES.chainLink, SUB_FOOT), { kind: 'add', piece: 'walk', widthFt: 5 }, 1, { walkGates: 1, dblGates: 0 }).priceCents)
  })
})
