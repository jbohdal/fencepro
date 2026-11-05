/**
 * A 10 ft double gate is two 5 ft leaves (Jonathan, Nov 3 2026: "build it from
 * the 5 ft gate parts in Inventory at each fence's height"). Aluminum Emily (4
 * ft tall): two "Alum, 3-Rail, Emily, Gate, 4' x 5', 48"" leaves; 8 ft tall
 * White and Tan vinyl: two "V , W / V , T, Privacy, Gate 8 x 5" leaves
 * (TAKEOFF_RULES: 2*addOnQty("Dbl Gate - 10'")). Everything else a double gate
 * takes stays as on the 8 ft gate: hinges (one pair per leaf on vinyl), latch,
 * handles, caps, hex bolts, blank post. Labor is the same.
 *
 * 6 ft tall vinyl (every color) and the 4 ft Bell build each leaf from section
 * parts; Inventory has no 5 ft gate part for them, so a 10 ft double gate there
 * is still priced and pulled as an 8 ft one, with the staff note.
 */
import { describe, test, expect, beforeEach } from 'vitest'
import { calculateQuote, type QuoteCalcInput } from '../../web/src/quoteCalc'
import { estimateConfig } from '../../web/src/estimate'
import { DEFAULT_FENCE_STYLES } from '../../web/src/configDefaults'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { builtInKitSet, clearBuiltInKits, setSavedKitSets } from '../../web/src/materialKits'
import { gateWarnings } from '../../web/src/proposal'

const qty = (items: Array<{ item: string; qty: number }>, p: string) => items.filter(i => i.item === p).reduce((t, i) => t + i.qty, 0)
const cfg = estimateConfig({ fenceStyles: JSON.parse(JSON.stringify(DEFAULT_FENCE_STYLES)), pricing: { overheadPct: 30 } } as any)

function quote(name: string, dbl: number[]) {
  const style = cfg.fenceStyles.find(s => s.name === name)!
  expect(style, name).toBeTruthy()
  const input: QuoteCalcInput = {
    style, runs: [{ ft: 48, rail: 'auto' }], corners: 0, ends: 2, walkGates: 0, dblGates: dbl.length,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {},
    gateWidths: { walk: [], dbl }, pricing: cfg.pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
  }
  return calculateQuote(input)
}

/** Every part but the gate leaf, as on the 8 ft double gate. */
function restSame(a: ReturnType<typeof quote>, b: ReturnType<typeof quote>, leaves: string[]) {
  const rest = (q: ReturnType<typeof quote>) => q.materials.items.filter(i => !leaves.includes(i.item)).map(i => [i.item, i.qty, i.unitCost])
  expect(rest(b)).toEqual(rest(a))
}

beforeEach(() => { setSavedKitSets(() => []); clearBuiltInKits() })

describe('a 10 ft double gate is two 5 ft leaves', () => {
  test.each(["Alum - ND - Emily - 48", "Alum - DS - Emily - 48"])('%s: two 4\' x 5\' leaves, hardware as on 8 ft', name => {
    const four = "Alum, 3-Rail, Emily, Gate, 4' x 4', 48\"", five = "Alum, 3-Rail, Emily, Gate, 4' x 5', 48\""
    const g8 = quote(name, [8]), g10 = quote(name, [10]), both = quote(name, [8, 10])
    expect([qty(g8.materials.items, four), qty(g8.materials.items, five)]).toEqual([2, 0])
    expect([qty(g10.materials.items, four), qty(g10.materials.items, five)]).toEqual([0, 2])
    expect([qty(both.materials.items, four), qty(both.materials.items, five)]).toEqual([2, 2])
    // The self-closing hinge part is a pair: one per leaf (Jonathan, Nov 5, 2026).
    expect(qty(g10.materials.items, 'Alum, Gate, Hinge, Self-Closing')).toBe(2)
    expect(qty(g8.materials.items, 'Alum, Gate, Hinge, Self-Closing')).toBe(2)
    expect(qty(g10.materials.items, 'Alum, Gate, Latch')).toBe(1)
    restSame(g8, g10, [four, five])
    expect(g10.materialCost).toBeGreaterThan(g8.materialCost)
    expect(g10.priced.manHours).toBe(g8.priced.manHours)
    expect(g10.priced.laborCost).toBe(g8.priced.laborCost)
    expect(builtInKitSet(name)!.kits.dblGate10?.length).toBeTruthy()
    expect(gateWarnings({ name }, { walk: [], dbl: [10] }, 0, 1)).toEqual([])
  })

  test.each([
    ["WV-ND 8'x6' Privacy", 'V , W'], ["WV-ND 8'x8' Privacy", 'V , W'], ["WV-DS 8'x6' Privacy", 'V , W'], ["WV-DS 8'x8' Privacy", 'V , W'],
    ["TV-ND 8'x6' Privacy", 'V , T'], ["TV-ND 8'x8' Privacy", 'V , T'], ["TV-DS 8'x6' Privacy", 'V , T'], ["TV-DS 8'x8' Privacy", 'V , T'],
  ])('%s (8 ft tall): two Privacy, Gate 8 x 5 leaves, a hinge pair per leaf', (name, V) => {
    const four = `${V}, Privacy Gate 8 x 4`, five = `${V}, Privacy, Gate 8 x 5`
    const g8 = quote(name, [8]), g10 = quote(name, [10]), both = quote(name, [10, 8])
    expect([qty(g8.materials.items, four), qty(g8.materials.items, five)]).toEqual([2, 0])
    expect([qty(g10.materials.items, four), qty(g10.materials.items, five)]).toEqual([0, 2])
    expect([qty(both.materials.items, four), qty(both.materials.items, five)]).toEqual([2, 2])
    // Gate hinge part is a pair: one per leaf at every height (Jonathan, Oct 25 2026).
    expect(qty(g10.materials.items, '*Vinyl, Gate, Hinge')).toBe(2)
    expect(qty(g10.materials.items, '*Vinyl, Gate, Latch')).toBe(1)
    restSame(g8, g10, [four, five])
    expect(g10.priced.manHours).toBe(g8.priced.manHours)
    expect(g10.priced.laborCost).toBe(g8.priced.laborCost)
    expect(gateWarnings({ name }, { walk: [], dbl: [10] }, 0, 1)).toEqual([])
  })

  test.each(["WV-ND 6'x6' Privacy", "WV-DS 6'x8' Privacy", "TV-ND 6'x6' Privacy", "TV-DS 6'x8' Privacy", 'WV-Auto ND Privacy', "WV-ND Bell 4'x6'", 'Alum - DS - Ind Abigail'])('%s: no 5 ft gate part in Inventory, so priced and pulled as 8 ft (unchanged)', name => {
    const g8 = quote(name, [8]), g10 = quote(name, [10])
    expect(g10.materials.items.map(i => [i.item, i.qty, i.unitCost])).toEqual(g8.materials.items.map(i => [i.item, i.qty, i.unitCost]))
    expect(g10.priced.price).toBe(g8.priced.price)
  })

  // 6 ft tall vinyl privacy: a 5 ft leaf is built the same as from a 6 ft wide section (Jonathan, Nov 5, 2026): no note.
  test.each(["WV-ND 6'x6' Privacy", "WV-DS 6'x8' Privacy", "TV-ND 6'x6' Privacy", "TV-DS 6'x8' Privacy", 'WV-Auto ND Privacy'])('%s: a 10 ft double gate and a 5 ft walk gate need no staff note', name => {
    expect(gateWarnings({ name }, { walk: [], dbl: [10] }, 0, 1)).toEqual([])
    expect(gateWarnings({ name }, { walk: [5], dbl: [] }, 1, 0)).toEqual([])
    // A 6 ft leaf (6 ft walk, 12 ft double) was not part of the answer: still noted.
    expect(gateWarnings({ name }, { walk: [6], dbl: [12] }, 1, 1).length).toBe(2)
  })

  test.each(["WV-ND Bell 4'x6'", 'Alum - DS - Ind Abigail'])('%s: not 6 ft tall privacy, the note stays', name => {
    expect(gateWarnings({ name }, { walk: [], dbl: [10] }, 0, 1).length).toBe(1)
  })

  test('a typed double gate (no width) is still the 8 ft gate', () => {
    const style = cfg.fenceStyles.find(s => s.name === 'Alum - ND - Emily - 48')!
    const q = calculateQuote({
      style, runs: [{ ft: 48, rail: 'auto' }], corners: 0, ends: 2, walkGates: 0, dblGates: 1,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {},
      pricing: cfg.pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
    })
    expect(qty(q.materials.items, "Alum, 3-Rail, Emily, Gate, 4' x 4', 48\"")).toBe(2)
    expect(qty(q.materials.items, "Alum, 3-Rail, Emily, Gate, 4' x 5', 48\"")).toBe(0)
  })
})
