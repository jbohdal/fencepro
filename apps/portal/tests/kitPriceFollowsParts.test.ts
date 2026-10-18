/**
 * The price follows the parts. With Inventory prices as saved on 2026-10-14:
 * doubling the footage about doubles Materials $; a gate adds exactly its
 * gate kit's cost; editing a kit quantity changes a quote's Materials $ by
 * exactly (quantity change × how many of that kit × unit cost); the price is
 * (materials + labor) ÷ (1 − Target Margin); and a JobNimbus quote's old price
 * is not treated as a price typed by hand (unless it is sold).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { setMaterialPriceSource, priceSourceFromMap, materialUnitCost } from '../../web/src/materialCalculator'
import { calculateQuote, type QuoteStyle } from '../../web/src/quoteCalc'
import { kitSetFor, countsFor, withKitSets, type KitSet, type KitKind } from '../../web/src/materialKits'
import { importedOldPrice } from '../../web/src/pricingEngine'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const pricing = {
  manHourRate: 22, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27,
  laborMode: 'hourly' as const, subUnit: 'foot' as const, priceMethod: 'cost_factor' as const, commissionMode: 'included' as const,
}
const STYLES: QuoteStyle[] = [
  { name: "WV-ND 6'x6' Privacy", category: 'Vinyl', margin: 0.56, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 6 },
  { name: "TV-DS 6'x8' Privacy", category: 'Vinyl', margin: 0.56, sectionsPerMH: 0.8, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 8 },
  { name: "CL - 4' Galv", category: 'Chainlink', margin: 0.58, sectionsPerMH: 2, mhPerWalkGate: 1, mhPerDblGate: 2, panelWidth: 10 },
  { name: 'Alum - ND - Emily - 48', category: 'Aluminum', margin: 0.58, sectionsPerMH: 1.2, mhPerWalkGate: 2, mhPerDblGate: 4, panelWidth: 6 },
] as QuoteStyle[]

function quote(style: QuoteStyle, ft: number, walkGates = 0, dblGates = 0) {
  return calculateQuote({
    style, runs: [{ ft }], corners: 0, ends: 2, walkGates, dblGates, tearOutSections: 0, tearOutGates: 0,
    extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
  })
}
const set = (name: string) => kitSetFor(name, []) as KitSet
const kitCost = (s: KitSet, kind: KitKind) => (s.kits[kind] ?? []).reduce((t, p) => t + p.qty * materialUnitCost(p.part, p.fallbackCost), 0)

describe.each(STYLES)('$name', style => {
  test('double the footage, about double the Materials $ (and a higher price)', () => {
    const a = quote(style, 100), b = quote(style, 200)
    expect(a.materialCost).toBeGreaterThan(0)
    const ratio = b.materialCost / a.materialCost
    expect(ratio).toBeGreaterThan(1.6)
    expect(ratio).toBeLessThan(2.1)
    expect(b.priced.price).toBeGreaterThan(a.priced.price * 1.6)
  })

  test("a walk gate adds that gate kit's cost", () => {
    const s = set(style.name)
    const without = quote(style, 100), withGate = quote(style, 100, 1)
    expect(withGate.materialCost - without.materialCost).toBeCloseTo(kitCost(s, 'walkGate'), 1)
    expect(withGate.priced.price).toBeGreaterThan(without.priced.price)
  })

  test('editing a kit quantity changes Materials $ by exactly qty change × kits used × unit cost', () => {
    const s = set(style.name)
    const kind: KitKind = (s.kits.section?.length ? 'section' : 'perFoot')
    const part = s.kits[kind]![0]
    const edited: KitSet = JSON.parse(JSON.stringify(s))
    edited.builtIn = false
    edited.kits[kind]![0].qty = part.qty + 11
    const n = countsFor(style.name, [100], { corners: 0, ends: 2, walkGates: 0, dblGates: 0 })[kind]
    const before = quote(style, 100)
    const after = withKitSets([edited], () => quote(style, 100))
    // Parts rounded up per job (rolls, sticks) move in whole units.
    const exact = 11 * n * materialUnitCost(part.part, part.fallbackCost)
    if (s.roundUp.includes(part.part)) expect(Math.abs(after.materialCost - before.materialCost - exact)).toBeLessThan(materialUnitCost(part.part, part.fallbackCost) + 0.01)
    else expect(after.materialCost - before.materialCost).toBeCloseTo(exact, 2)
  })

  test('price = (materials + labor) ÷ (1 − Target Margin)', () => {
    const q = quote(style, 150, 1)
    expect(q.priced.priceMethod).toBe('cost_factor')
    expect(q.priced.price).toBeCloseTo((q.materialCost + q.priced.laborCost) / style.margin!, 2)
  })
})

describe('a JobNimbus quote with its old price', () => {
  const imported = { pricing: { finalPrice: 5518.61 }, runs: [] as number[], status: 'SENT' }
  test('is recognised (no measurements, the old price only)', () => {
    expect(importedOldPrice(imported)).toBe(5518.61)
  })
  test('a price typed in EZ Biz is not mistaken for it', () => {
    expect(importedOldPrice({ pricing: { finalPrice: 9000, laborMode: 'hourly' }, runs: [] })).toBeNull()
    expect(importedOldPrice({ pricing: { finalPrice: 9000 }, runs: [100] })).toBeNull()
    expect(importedOldPrice({ pricing: { laborMode: 'hourly' }, runs: [] })).toBeNull()
    expect(importedOldPrice(null)).toBeNull()
  })
  test('once measured, an open one is priced from its parts', () => {
    // The quote builder leaves the old price off for anything not sold, so the price follows the parts.
    const style = STYLES[0]
    const overrides = importedOldPrice(imported) != null && imported.status !== 'SOLD' ? {} : imported.pricing
    const run = (ft: number) => calculateQuote({
      style, runs: [{ ft }], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
      extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, overrides, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
    }).priced.price
    expect(run(200)).toBeGreaterThan(run(100) * 1.6)
    // With the old price applied, it would not move: what Jonathan saw.
    const locked = (ft: number) => calculateQuote({
      style, runs: [{ ft }], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
      extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, overrides: imported.pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
    }).priced.price
    expect(locked(200)).toBe(locked(100))
  })
})
