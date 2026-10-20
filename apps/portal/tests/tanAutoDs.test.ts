/**
 * Tan dig set, 6 or 8 ft panels (best price): "TV-Auto DS Privacy".
 *
 * Its parts per width are the TV-DS 6'x6' and 6'x8' lists, line by line: all
 * 6 ft is TV-DS 6'x6', all 8 ft is TV-DS 6'x8', a mix is each run's panel
 * goods at its width with the dig set posts, concrete and TV-DS gate lines.
 * Priced with the Inventory prices of 2026-10-14 (fixtures).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import {
  legacyCalculateMaterialsDetailed, legacyCalculateMixedMaterialsDetailed, calculateMixedMaterialsDetailed, calculateMaterialsDetailed,
  normalizeItemName, setMaterialPriceSource, priceSourceFromMap, type LineItem, type RailWidth,
} from '../../web/src/materialCalculator'
import { calculateQuote, vinylKind, widthComparison, makeRunCost, type QuoteStyle } from '../../web/src/quoteCalc'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { builtInKitSet, isAutoKitStyle } from '../../web/src/materialKits'
import { planTanAutoDs, TAN_AUTO_DS } from '../../web/src/tanAutoDs'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { styleLabel, resolveFenceStyles, DEFAULT_CATALOG } from '../../web/src/fenceCatalog'
import type { FenceStyle } from '../../web/src/configStore'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const TAN_DS = { installMethod: 'dig-set' as const, colorFamily: 'tan' as const }
type J = { runs: number[]; corners: number; ends: number; walkGates: number; dblGates: number }
const JOBS: J[] = [
  { runs: [150], corners: 0, ends: 2, walkGates: 0, dblGates: 0 },
  { runs: [37, 120, 52], corners: 2, ends: 2, walkGates: 1, dblGates: 1 },
  { runs: [6, 13, 250, 8], corners: 3, ends: 1, walkGates: 2, dblGates: 0 },
  { runs: [48, 64, 96], corners: 2, ends: 1, walkGates: 0, dblGates: 2 },
]
const asMap = (items: LineItem[]) => {
  const m = new Map<string, number>()
  for (const i of items) if (i.qty) m.set(normalizeItemName(i.item), (m.get(normalizeItemName(i.item)) ?? 0) + i.qty)
  return m
}
const mixed = (j: J, rail: RailWidth | RailWidth[]) => legacyCalculateMixedMaterialsDetailed({
  ...TAN_DS, ...j, tearOutSections: 0, tearOutGates: 0,
  runs: j.runs.map((ft, i) => ({ ft, rail: Array.isArray(rail) ? rail[i] : rail })),
}).items
const locked = (name: string, j: J) => legacyCalculateMaterialsDetailed({ fenceStyle: name, ...j, tearOutSections: 0, tearOutGates: 0 }).items
const qty = (items: LineItem[], part: string) => items.filter(i => normalizeItemName(i.item) === normalizeItemName(part)).reduce((t, i) => t + i.qty, 0)

describe('tan dig set mixed parts list = the TV-DS rows', () => {
  test("all 6 ft runs: every line as TV-DS 6'x6'", () => {
    for (const j of JOBS) expect(asMap(mixed(j, '6ft'))).toEqual(asMap(locked("TV-DS 6'x6' Privacy", j)))
  })
  test("all 8 ft runs: every line as TV-DS 6'x8'", () => {
    for (const j of JOBS) expect(asMap(mixed(j, '8ft'))).toEqual(asMap(locked("TV-DS 6'x8' Privacy", j)))
  })
  test('a mix: each run at its width, posts, concrete and hardware from the post counts', () => {
    // 60 ft at 6 ft = 10 sections, 64 ft at 8 ft = 8 sections; line posts 9 + 7.
    const items = mixed({ runs: [60, 64], corners: 1, ends: 2, walkGates: 0, dblGates: 0 }, ['6ft', '8ft'])
    expect(qty(items, '*Vinyl, Tan, Picket, 62-1/4"')).toBe(10 * 11 + 8 * 16)
    expect(qty(items, "*Vinyl, Tan, Rail, 6'")).toBe(20)
    expect(qty(items, "*Vinyl, Tan, Rail, 8'")).toBe(16)
    expect(qty(items, "Vinyl, Rail Insert, 8'")).toBe(8)
    expect(qty(items, '*Vinyl, Tan, U-Trim, 59-1/4"')).toBe(36)
    expect(qty(items, '*Vinyl, Truss, 8 x 3/4" (U-Trim)')).toBe(18 * 6)
    expect(qty(items, '*Vinyl, Tan, Post, Line, 5" x 5" x 102"')).toBe(16)
    expect(qty(items, '*Vinyl, Tan, Post, Corner, 5" x 5" x 102"')).toBe(1)
    expect(qty(items, '*Vinyl, Tan, Post, End, 5" x 5" x 102"')).toBe(2)
    expect(qty(items, '*Vinyl, Hex, 1/4 x 3" (Rail Ties/Bottom)')).toBe(19 * 2)
    expect(qty(items, 'Vinyl, Tan, Cap, 5"x5"')).toBe(19)
    expect(qty(items, 'Misc, Concrete')).toBe(19)
    // Dig set: no donuts, pipe or donut pins; no white parts.
    expect(items.some(i => /Donut|PT40|White/.test(i.item))).toBe(false)
    // The mix is the sum of the two widths' panel goods on the same posts.
    const six = mixed({ runs: [60], corners: 0, ends: 0, walkGates: 0, dblGates: 0 }, '6ft')
    const eight = mixed({ runs: [64], corners: 0, ends: 0, walkGates: 0, dblGates: 0 }, '8ft')
    for (const p of ['*Vinyl, Tan, Picket, 62-1/4"', "*Vinyl, Tan, Rail, 6'", "*Vinyl, Tan, Rail, 8'", "Vinyl, Rail Insert, 8'", '*Vinyl, Tan, U-Trim, 59-1/4"']) {
      expect(qty(items, p)).toBe(qty(six, p) + qty(eight, p))
    }
  })
  test('concrete: one bag per post and blank post, plus 2 per double gate (TV-DS)', () => {
    // 100 ft at 8 ft: 13 sections, 12 line posts; 2 corners, 2 ends, 1 double gate (1 blank post).
    const items = mixed({ runs: [100], corners: 2, ends: 2, walkGates: 0, dblGates: 1 }, '8ft')
    expect(qty(items, 'Misc, Concrete')).toBe(2 + 2 + 12 + 1 + 2)
    expect(qty(items, '*Vinyl, Tan, Post, Blank, 5" x 5" x 102"')).toBe(1)
  })
  test('gates: the TV-DS gate lines', () => {
    const g = (walkGates: number, dblGates: number) => mixed({ runs: [60], corners: 0, ends: 2, walkGates, dblGates }, '6ft')
    const walk = g(1, 0), none = g(0, 0), dbl = g(0, 1)
    const add = (a: LineItem[], p: string) => qty(a, p) - qty(none, p)
    expect(add(walk, "*Vinyl, Gate, H-Beam, 6'")).toBe(2)
    expect(add(walk, '*Vinyl, Gate, Brace')).toBe(1)
    expect(add(walk, '*Vinyl, Gate, Hinge')).toBe(1)
    expect(add(walk, '*Vinyl, Gate, Latch')).toBe(1)
    expect(add(walk, 'Vinyl, Tan, Cap, Gate')).toBe(2)
    // TAKEOFF_RULES (Jonathan, Oct 20, 2026): 2 uprights, 1 P-channel and 2 bags of concrete per walk gate.
    expect(add(walk, '*Vinyl, Tan, Upright')).toBe(2)
    expect(add(walk, "*Vinyl, Gate, P-Channel, 6'")).toBe(1)
    expect(add(walk, 'Misc, Concrete')).toBe(2)
    expect(add(walk, '*Vinyl, Tan, Rivet, 1"')).toBe(50)
    expect(add(dbl, "*Vinyl, Gate, H-Beam, 8'")).toBe(3)
    expect(add(dbl, '*Vinyl, Gate, Brace')).toBe(2)
    expect(add(dbl, '*Vinyl, Gate, Hinge')).toBe(2)
    // TAKEOFF_RULES (Jonathan, Oct 20, 2026): 2 latches, 4 uprights and 2 P-channels per double gate.
    expect(add(dbl, '*Vinyl, Gate, Latch')).toBe(2)
    expect(add(dbl, 'Vinyl, Tan, Cap, Gate')).toBe(4)
    expect(add(dbl, '*Vinyl, Tan, Upright')).toBe(4)
    expect(add(dbl, "*Vinyl, Gate, P-Channel, 6'")).toBe(2)
    expect(add(dbl, '*Vinyl, Tan, Rivet, 1"')).toBe(100)
    // No H-beam bolts on the tan dig set list.
    expect([...walk, ...dbl].some(i => /H-Beam\)/.test(i.item))).toBe(false)
  })
  test('the built in kit set derives cleanly and the quote reads it', () => {
    expect(isAutoKitStyle(TAN_AUTO_DS)).toBe(true)
    const set = builtInKitSet(TAN_AUTO_DS)!
    expect(set.mismatch).toBeUndefined()
    const j = { runs: [{ ft: 60, rail: '6ft' as RailWidth }, { ft: 64, rail: '8ft' as RailWidth }], corners: 1, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0 }
    expect(asMap(calculateMixedMaterialsDetailed({ ...TAN_DS, ...j }).items)).toEqual(asMap(legacyCalculateMixedMaterialsDetailed({ ...TAN_DS, ...j }).items))
  })
})

const pricing = {
  manHourRate: 22, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27,
  laborMode: 'hourly' as const, subUnit: 'foot' as const, priceMethod: 'cost_factor' as const, commissionMode: 'included' as const,
}
const st = (name: string, extra: Partial<QuoteStyle> = {}): QuoteStyle =>
  ({ name, category: 'Vinyl', margin: 0.6, sectionsPerMH: 1.1, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 6, ...extra })
const STYLES = [
  st("TV-DS 6'x6' Privacy"), st("TV-DS 6'x8' Privacy", { panelWidth: 8 }),
  st(TAN_AUTO_DS, { autoRailMix: true, ...TAN_DS }),
]
const by = (n: string) => STYLES.find(s => s.name === n)!
const quote = (name: string, j: J, rails?: RailWidth[]) => calculateQuote({
  style: by(name), ...j, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
  pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, runs: j.runs.map((ft, i) => ({ ft, rail: rails?.[i] })),
})

describe('TV-Auto DS Privacy quotes', () => {
  test('the 6/8 picker can price tan dig set (auto and the locked styles)', () => {
    expect(vinylKind(by(TAN_AUTO_DS))).toEqual(TAN_DS)
    expect(vinylKind(by("TV-DS 6'x6' Privacy"))).toEqual(TAN_DS)
    expect(vinylKind(by("TV-DS 6'x8' Privacy"))).toEqual(TAN_DS)
  })
  test('the optimizer picks the cheaper width per run; short runs are 6 ft', () => {
    const j = { runs: [5, 48, 100, 150], corners: 2, ends: 2, walkGates: 1, dblGates: 0 }
    const q = quote(TAN_AUTO_DS, j)
    const cost = makeRunCost(TAN_DS, by(TAN_AUTO_DS), pricing)
    expect(q.perRunRail[0]).toBe('6ft')
    j.runs.slice(1).forEach((ft, k) => {
      const c6 = cost(ft, '6ft'), c8 = cost(ft, '8ft')
      const want = c8 < c6 || (c8 - c6) / c6 <= DEFAULT_RAIL_OPTIMIZER_SETTINGS.costPreferenceThreshold ? '8ft' : '6ft'
      expect(q.perRunRail[k + 1]).toBe(want)
    })
    expect(q.sections).toBe(q.perRunSections.reduce((t, n) => t + n, 0))
  })
  test("forced all 6 ft prices as TV-DS 6'x6', all 8 ft as TV-DS 6'x8' (same Settings)", () => {
    for (const j of JOBS) {
      const w = widthComparison({
        style: by(TAN_AUTO_DS), ...j, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
        pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, runs: j.runs.map(ft => ({ ft })),
      }, STYLES)!
      expect(w.at6).toBe(quote("TV-DS 6'x6' Privacy", j).priced.price)
      expect(w.at8).toBe(quote("TV-DS 6'x8' Privacy", j).priced.price)
    }
  })
  test("a locked TV-DS quote's parts and price do not change (the 6/8 hint only)", () => {
    const j = JOBS[1]
    const q = quote("TV-DS 6'x6' Privacy", j)
    expect(q.optimizer).not.toBeNull()
    expect(q.perRunRail.every(r => r === null)).toBe(true)
    expect(asMap(q.materials.items)).toEqual(asMap(calculateMaterialsDetailed({ fenceStyle: "TV-DS 6'x6' Privacy", ...j, tearOutSections: 0, tearOutGates: 0 }).items))
  })
})

describe('the style in Settings', () => {
  test('plain name', () => {
    expect(styleLabel(TAN_AUTO_DS)).toBe('Tan Vinyl Privacy, 6 ft tall, 6 or 8 ft panels (best price), Dig set')
  })
  test("defaults: TV-DS 6'x6' man hours and margin", () => {
    const d = DEFAULT_FENCE_STYLES.find(s => s.name === TAN_AUTO_DS)!
    const src = DEFAULT_FENCE_STYLES.find(s => s.name === "TV-DS 6'x6' Privacy")!
    expect(d).toMatchObject({ autoRailMix: true, ...TAN_DS, category: src.category, margin: src.margin, sectionsPerMH: src.sectionsPerMH, mhPerWalkGate: src.mhPerWalkGate, mhPerDblGate: src.mhPerDblGate })
  })
  test("the one time step copies the company's TV-DS 6'x6' settings, next to the other auto styles, once", () => {
    const saved = [
      { ...DEFAULT_FENCE_STYLES[0], margin: 0.56, targetProfitPct: 14 },
      { ...DEFAULT_FENCE_STYLES[1], margin: 0.6, targetProfitPct: 10 },
      { id: '12', name: "TV-DS 6'x6' Privacy", category: 'Vinyl', margin: 0.6, targetProfitPct: 10, sectionsPerMH: 1.1, panelWidth: 6, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true, subRate: 3 },
      { id: '13', name: "TV-DS 6'x8' Privacy", category: 'Vinyl', margin: 0.6, targetProfitPct: 10, sectionsPerMH: 1.3, panelWidth: 8, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, isActive: true },
    ] as FenceStyle[]
    const plan = planTanAutoDs(saved)
    expect(plan.added).toBe(TAN_AUTO_DS)
    expect(plan.copiedFrom).toBe("TV-DS 6'x6' Privacy")
    expect(plan.fenceStyles.map(s => s.name)).toEqual(['WV-Auto ND Privacy', 'WV-Auto DS Privacy', TAN_AUTO_DS, "TV-DS 6'x6' Privacy", "TV-DS 6'x8' Privacy"])
    expect(plan.fenceStyles[2]).toMatchObject({ margin: 0.6, targetProfitPct: 10, sectionsPerMH: 1.1, subRate: 3, autoRailMix: true, ...TAN_DS, isActive: true })
    // Existing styles are untouched.
    expect(plan.fenceStyles.filter(s => s.name !== TAN_AUTO_DS)).toEqual(saved)
    // Again: nothing added.
    expect(planTanAutoDs(plan.fenceStyles).added).toBeNull()
    // No TV-DS to copy from: nothing added, nothing invented.
    expect(planTanAutoDs(saved.slice(0, 2)).added).toBeNull()
    // Not for quoting when tan dig set is not.
    expect(planTanAutoDs(saved.map(s => s.name.startsWith('TV-DS') ? { ...s, quotable: false } : s)).fenceStyles[2].quotable).toBe(false)
  })
  test('it resolves with its plain name and is not held back', () => {
    const plan = planTanAutoDs(DEFAULT_FENCE_STYLES.filter(s => s.name !== TAN_AUTO_DS))
    const r = resolveFenceStyles(plan.fenceStyles, DEFAULT_CATALOG, p => prices[p]).find(s => s.name === TAN_AUTO_DS)!
    expect(r.label).toBe('Tan Vinyl Privacy, 6 ft tall, 6 or 8 ft panels (best price), Dig set')
    expect(r.held).toBeUndefined()
  })
})
