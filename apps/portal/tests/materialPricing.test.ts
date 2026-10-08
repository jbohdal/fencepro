/**
 * Material calculator — Inventory is the cost source, gaps are reported,
 * and the parts list fixes (double gate leaves, chain link gate height,
 * styles that used to quote $0 material).
 */
import { describe, test, expect, afterEach } from 'vitest'
import {
  calculateMaterials,
  calculateMaterialsDetailed,
  calculateMixedMaterials,
  totalMaterialCost,
  setMaterialPriceSource,
  priceSourceFromMap,
  materialUnitCost,
  styleHasPartsList,
} from '../../web/src/materialCalculator'
import type { JobInputs, LineItem } from '../../web/src/materialCalculator'

const job = (fenceStyle: string, over: Partial<JobInputs> = {}): JobInputs => ({
  fenceStyle,
  runs: [100, 50],
  corners: 2,
  ends: 2,
  walkGates: 1,
  dblGates: 1,
  tearOutSections: 0,
  tearOutGates: 0,
  ...over,
})

const find = (items: LineItem[], name: string) => items.find(i => i.item === name)

afterEach(() => setMaterialPriceSource(null))

describe('Inventory is the cost source', () => {
  test('with no source registered the built in costs are used (legacy behavior)', () => {
    const items = calculateMaterials(job("WV-ND 6'x6' Privacy"))
    expect(find(items, '*Vinyl, White, Picket, 62-1/4"')?.unitCost).toBe(2.71)
    expect(find(items, '*Vinyl, White, Picket, 62-1/4"')?.costSource).toBe('builtin')
  })

  test('a cost in Inventory overrides the built in cost', () => {
    setMaterialPriceSource(priceSourceFromMap({ '*Vinyl, White, Picket, 62-1/4"': 3.5 }))
    const items = calculateMaterials(job("WV-ND 6'x6' Privacy"))
    const picket = find(items, '*Vinyl, White, Picket, 62-1/4"')!
    expect(picket.unitCost).toBe(3.5)
    expect(picket.costSource).toBe('inventory')
    expect(picket.total).toBeCloseTo(picket.qty * 3.5, 2)
  })

  test('changing an Inventory cost changes the material total', () => {
    const before = totalMaterialCost(calculateMaterials(job("WV-ND 6'x6' Privacy")))
    setMaterialPriceSource(priceSourceFromMap({ '*Vinyl, White, Picket, 62-1/4"': 2.71 + 1 }))
    const items = calculateMaterials(job("WV-ND 6'x6' Privacy"))
    const pickets = find(items, '*Vinyl, White, Picket, 62-1/4"')!.qty
    expect(totalMaterialCost(items)).toBeCloseTo(before + pickets, 2)
  })

  test('names match ignoring case and whitespace', () => {
    setMaterialPriceSource(priceSourceFromMap({ "vinyl, rail insert,  8' ": 12, 'V , W, Privacy Gate 8 x 4': 410 }))
    expect(materialUnitCost("Vinyl, Rail Insert, 8'")).toBe(12)
    expect(materialUnitCost('V, W, Privacy Gate 8 x 4')).toBe(410)
    expect(materialUnitCost('Not A Part', 9)).toBe(9)
  })

  test('parts missing from Inventory are reported and still priced with the fallback', () => {
    setMaterialPriceSource(priceSourceFromMap({}))
    const r = calculateMaterialsDetailed(job("WV-ND 6'x6' Privacy"))
    expect(r.warnings.join(' ')).toMatch(/not in Inventory/)
    expect(totalMaterialCost(r.items)).toBeGreaterThan(0)
  })

  test('a part carried at $0 stays on the pull sheet and is reported', () => {
    setMaterialPriceSource(priceSourceFromMap({ 'ND, Donut': 0 }))
    const r = calculateMaterialsDetailed(job("WV-ND 6'x6' Privacy"))
    expect(find(r.items, 'ND, Donut')?.total).toBe(0)
    expect(r.warnings.join(' ')).toMatch(/at \$0\.00.*ND, Donut/)
  })

  test('the mixed rail calculator reads Inventory too', () => {
    setMaterialPriceSource(priceSourceFromMap({ "*Vinyl, White, Rail, 8'": 11 }))
    const items = calculateMixedMaterials({
      installMethod: 'no-dig', colorFamily: 'white',
      runs: [{ ft: 80, rail: '8ft' }], corners: 0, ends: 2,
      walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
    })
    expect(find(items, "*Vinyl, White, Rail, 8'")?.unitCost).toBe(11)
  })
})

describe('parts list fixes', () => {
  test('tan no dig counts both leaves of a double gate in pickets and rails', () => {
    const none = calculateMaterials(job("TV-ND 6'x6' Privacy", { walkGates: 0, dblGates: 0 }))
    const dbl = calculateMaterials(job("TV-ND 6'x6' Privacy", { walkGates: 0, dblGates: 1 }))
    const pickets = (items: LineItem[]) => find(items, '*Vinyl, Tan, Picket, 62-1/4"')!.qty
    const rails = (items: LineItem[]) => find(items, "*Vinyl, Tan, Rail, 6'")!.qty
    expect(pickets(dbl) - pickets(none)).toBe(2 * 11)
    expect(rails(dbl) - rails(none)).toBe(2 * 2)
  })

  test('white dig set counts both leaves of a double gate', () => {
    const none = calculateMaterials(job("WV-DS 6'x6' Privacy", { walkGates: 0, dblGates: 0 }))
    const dbl = calculateMaterials(job("WV-DS 6'x6' Privacy", { walkGates: 0, dblGates: 1 }))
    const pickets = (items: LineItem[]) => find(items, '*Vinyl, White, Picket, 62-1/4"')!.qty
    expect(pickets(dbl) - pickets(none)).toBe(2 * 11)
  })

  test.each([
    ["CL - 4' Galv", `Chainlink, Galv, Gate, 1-3/8", 4' x 4' (.055)`, 85.00],
    ["CL - 5' Galv", `Chainlink, Galv, Gate, 1-3/8", 5' x 4' (.055)`, 88.85],
    ["CL - 6' Galv", `Chainlink, Galv, Gate, 1-3/8", 6' x 4' (.055)`, 114.86],
    ["CL - 4' Black", `Chainlink, Black, Gate, 1-3/8", 4' x 4' (.065)`, 123.95],
    ["CL - 5' Black", `Chainlink, Black, Gate, 1-3/8", 5' x 4' (.065)`, 138.46],
    ["CL - 6' Black", `Chainlink, Black, Gate, 1-3/8", 6' x 4' (.065)`, 154.66],
  ])('%s gate matches the fence height', (style, gateName, cost) => {
    const items = calculateMaterials(job(style))
    // The calculator lists walk gate and double gate leaves on separate lines.
    const gates = items.filter(i => i.item === gateName)
    expect(gates.reduce((n, g) => n + g.qty, 0)).toBe(3) // 1 walk + 2 leaves of the double
    expect(gates.every(g => g.unitCost === cost)).toBe(true)
    // and no other height's gate is on the sheet
    expect(items.filter(i => /Gate, 1-3\/8/.test(i.item) && i.item !== gateName)).toHaveLength(0)
  })
})

describe('styles that used to quote $0 material', () => {
  test.each([
    "TV-DS 6'x6' Privacy", "TV-DS 6'x8' Privacy",
    "WV-ND 8'x6' Privacy", "WV-ND 8'x8' Privacy", "WV-DS 8'x6' Privacy", "WV-DS 8'x8' Privacy",
    'Alum - DS - Ind Abigail',
  ])('%s now has a parts list and a warning to check it', style => {
    const r = calculateMaterialsDetailed(job(style))
    expect(styleHasPartsList(style)).toBe(true)
    expect(totalMaterialCost(r.items)).toBeGreaterThan(500)
    expect(r.warnings.length).toBeGreaterThan(0)
  })

  test("8'x6' is 8 tall and 6 wide: 150 ft is 26 six foot sections", () => {
    const r = calculateMaterialsDetailed(job("WV-ND 8'x6' Privacy"))
    expect(find(r.items, "V , W, Picket Section 8' x 6' Privacy")?.qty).toBe(17 + 9)
  })

  test("8'x8' uses 8 ft wide sections", () => {
    const r = calculateMaterialsDetailed(job("WV-DS 8'x8' Privacy"))
    expect(find(r.items, "V , W, Picket Section 8' x 8' Privacy")?.qty).toBe(13 + 7)
    expect(find(r.items, 'Misc, Concrete')?.qty).toBe((2 + 2 + 12 + 6) * 2)
  })

  test('a style with no parts list says so instead of quoting $0 silently', () => {
    const r = calculateMaterialsDetailed(job('Durafence'))
    expect(styleHasPartsList('Durafence')).toBe(false)
    expect(r.items).toHaveLength(0)
    expect(r.warnings.join(' ')).toMatch(/no parts list/)
  })

  test('commercial color styles warn that they are priced as galvanized', () => {
    const r = calculateMaterialsDetailed(job("CL - Com 6'+1' Black"))
    expect(r.warnings.join(' ')).toMatch(/galvanized/)
  })
})
