/**
 * Section width and the 6 ft / 8 ft choice, priced with Inventory prices as
 * saved on 2026-10-14 (fixtures/inventory-prices-2026-10-14.json) and the
 * Settings values saved on live that day (man hour rate $22, magic number
 * 0.58, 1.2 sections per man hour for no dig, 0.8 for dig set).
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import {
  sectionWidthForStyle,
  setMaterialPriceSource,
  priceSourceFromMap,
  calculateMaterials,
  calculateMixedMaterials,
  totalMaterialCost,
  type LineItem,
} from '../../web/src/materialCalculator'
import { calculateQuote, widthComparison, type QuoteCalcInput, type QuoteStyle } from '../../web/src/quoteCalc'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { panelLengthForStyle as serverWidth } from '../src/server/lib/quoteEngine.js'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const pricing = {
  manHourRate: 22, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27,
  laborMode: 'hourly' as const, subUnit: 'foot' as const, priceMethod: 'cost_factor' as const, commissionMode: 'included' as const,
}
const style = (name: string, sectionsPerMH: number, extra: Partial<QuoteStyle> = {}): QuoteStyle =>
  ({ name, category: 'Vinyl', margin: 0.58, sectionsPerMH, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 6, ...extra })
const STYLES: QuoteStyle[] = [
  style("WV-ND 6'x6' Privacy", 1.2), style("WV-ND 6'x8' Privacy", 1.2, { panelWidth: 8 }),
  style("WV-DS 6'x6' Privacy", 0.8), style("WV-DS 6'x8' Privacy", 0.8, { panelWidth: 8 }),
  style("TV-ND 6'x6' Privacy", 1.2), style("TV-ND 6'x8' Privacy", 1.5, { panelWidth: 8 }),
  style('WV-Auto ND Privacy', 1.2, { autoRailMix: true, installMethod: 'no-dig', colorFamily: 'white' }),
  style('WV-Auto DS Privacy', 0.8, { autoRailMix: true, installMethod: 'dig-set', colorFamily: 'white' }),
]
const byName = (n: string) => STYLES.find(s => s.name === n)!

function quote(name: string, job: Partial<QuoteCalcInput> & { runs: number[] }) {
  return calculateQuote({
    style: byName(name), corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
    extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
    ...job, runs: job.runs.map(ft => ({ ft })),
  })
}
const qty = (items: LineItem[], re: RegExp) => items.filter(i => re.test(i.item)).reduce((s, i) => s + i.qty, 0)

const STRAIGHT = { runs: [150], corners: 0, ends: 2 }
const U_300 = { runs: [100, 100, 100], corners: 2, ends: 2, walkGates: 1 }

describe('section width', () => {
  test('6x8 styles are 8 ft wide; the others keep their width', () => {
    for (const n of ["WV-ND 6'x8' Privacy", "WV-DS 6'x8' Privacy", "TV-ND 6'x8' Privacy", "TV-DS 6'x8' Privacy"]) expect(sectionWidthForStyle(n, 6)).toBe(8)
    for (const n of ["WV-ND 6'x6' Privacy", "TV-DS 6'x6' Privacy", "WV-ND 8'x6' Privacy", 'WV-ND Bell 4\'x6\'', 'Alum - ND - Emily - 48']) expect(sectionWidthForStyle(n, 4)).toBe(6)
    expect(sectionWidthForStyle("WV-DS 8'x8' Privacy")).toBe(8)
    expect(sectionWidthForStyle('Alum - DS - Ind Abigail', 6)).toBe(8)
    expect(sectionWidthForStyle("CL - 4' Galv", 6)).toBe(10)
    expect(sectionWidthForStyle('Durafence', 6)).toBe(8)
    // A style with no parts list uses the width saved in Settings.
    expect(sectionWidthForStyle('Wood shadowbox', 7)).toBe(7)
  })

  test('the server quote engine uses the same widths', () => {
    const names = ["WV-ND 6'x6' Privacy", "WV-ND 6'x8' Privacy", "WV-ND 8'x6' Privacy", "WV-ND 8'x8' Privacy", "WV-ND Bell 4'x6'",
      "WV-DS 6'x6' Privacy", "WV-DS 6'x8' Privacy", "WV-DS 8'x6' Privacy", "WV-DS 8'x8' Privacy", "TV-ND 6'x6' Privacy", "TV-ND 6'x8' Privacy",
      "TV-DS 6'x6' Privacy", "TV-DS 6'x8' Privacy", "CL - 4' Galv", "CL - 6' Black", "CL - Com 6'+1'", 'Alum - ND - Emily - 48',
      'Alum - DS - Emily - 48', 'Alum - DS - Ind Abigail', 'Durafence']
    for (const n of names) expect([n, serverWidth(n)]).toEqual([n, sectionWidthForStyle(n)])
  })

  test('the quote count and the pull sheet agree on every 6x8 style', () => {
    const q = quote("WV-ND 6'x8' Privacy", STRAIGHT)
    expect(q.sections).toBe(19)
    expect(qty(q.materials.items, /Rail, 8'$/)).toBe(19 * 2)
    expect(qty(q.materials.items, /Rail Insert/)).toBe(19)
  })
})

describe('150 ft straight, white no dig, 2 ends, no gates', () => {
  test("6'x8' is 19 sections and 18 line posts", () => {
    const q = quote("WV-ND 6'x8' Privacy", STRAIGHT)
    expect(q.sections).toBe(19)
    expect(qty(q.materials.items, /Post, Line/)).toBe(18)
  })

  test("6'x6' is 25 sections, and 6'x8' comes out cheaper", () => {
    const six = quote("WV-ND 6'x6' Privacy", STRAIGHT)
    const eight = quote("WV-ND 6'x8' Privacy", STRAIGHT)
    expect(six.sections).toBe(25)
    expect(eight.priced.totalCOGS).toBeLessThan(six.priced.totalCOGS)
    expect(eight.priced.price).toBeLessThan(six.priced.price)
  })

  test('auto mix picks 8 ft and matches the 6x8 price', () => {
    const auto = quote('WV-Auto ND Privacy', STRAIGHT)
    expect(auto.perRunRail).toEqual(['8ft'])
    expect(auto.priced.price).toBe(quote("WV-ND 6'x8' Privacy", STRAIGHT).priced.price)
  })
})

describe('300 ft: 3 runs of 100, 2 corners, 2 ends, 1 walk gate', () => {
  test('8 ft wide comes out cheaper', () => {
    const six = quote("WV-ND 6'x6' Privacy", U_300)
    const eight = quote("WV-ND 6'x8' Privacy", U_300)
    expect(six.sections).toBe(51)
    expect(eight.sections).toBe(39)
    expect(eight.priced.price).toBeLessThan(six.priced.price)
  })

  test('auto mix picks 8 ft on every run', () => {
    expect(quote('WV-Auto ND Privacy', U_300).perRunRail).toEqual(['8ft', '8ft', '8ft'])
    expect(quote('WV-Auto DS Privacy', U_300).perRunRail).toEqual(['8ft', '8ft', '8ft'])
  })

  test('the full run cost includes line posts, pipe, donuts, caps and labor', () => {
    const auto = quote('WV-Auto ND Privacy', { runs: [100] })
    const run = auto.optimizer!.perRun[0]
    // Panel goods alone favor 6 ft; posts and labor tip it to 8 ft.
    expect(run.cost8ft).toBeLessThan(run.cost6ft)
    expect(run.railType).toBe('8ft')
  })
})

describe('auto mix gate leaves', () => {
  test('gate leaves get pickets and rails like the locked styles', () => {
    const job = { corners: 2, ends: 2, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0 }
    const all6 = calculateMixedMaterials({ installMethod: 'no-dig', colorFamily: 'white', runs: [{ ft: 60, rail: '6ft' }], ...job })
    const all8 = calculateMixedMaterials({ installMethod: 'no-dig', colorFamily: 'white', runs: [{ ft: 64, rail: '8ft' }], ...job })
    // 10 sections + 3 leaves at 6 ft; 8 sections + 3 leaves at 8 ft.
    expect(qty(all6, /Picket/)).toBe(13 * 11)
    expect(qty(all6, /Rail, 6'$/)).toBe(13 * 2)
    expect(qty(all8, /Picket/)).toBe(11 * 15)
    expect(qty(all8, /Rail, 8'$/)).toBe(11 * 2)
    expect(qty(all8, /Rail Insert/)).toBe(11)
  })

  test('all 6 ft or all 8 ft auto mix costs the same as the locked style', () => {
    const job = { corners: 2, ends: 2, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0 }
    for (const [ft, rail, locked] of [[60, '6ft', "WV-ND 6'x6' Privacy"], [64, '8ft', "WV-ND 6'x8' Privacy"]] as const) {
      const mixed = totalMaterialCost(calculateMixedMaterials({ installMethod: 'no-dig', colorFamily: 'white', runs: [{ ft, rail }], ...job }))
      const lockedCost = totalMaterialCost(calculateMaterials({ fenceStyle: locked, runs: [ft], ...job }))
      expect(mixed).toBe(lockedCost)
    }
  })
})

describe('6 ft vs 8 ft line under the total', () => {
  test('a locked style shows itself and its twin', () => {
    const input = {
      style: byName("WV-ND 6'x6' Privacy"), runs: [{ ft: 150 }], corners: 0, ends: 2, walkGates: 0, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing,
      optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, overrides: { finalPrice: 1 },
    }
    const c = widthComparison(input, STYLES)!
    expect(c.at6).toBe(quote("WV-ND 6'x6' Privacy", STRAIGHT).priced.price)
    expect(c.at8).toBe(quote("WV-ND 6'x8' Privacy", STRAIGHT).priced.price)
  })

  test('auto mix forces each width', () => {
    const input = {
      style: byName('WV-Auto ND Privacy'), runs: [{ ft: 150 }], corners: 0, ends: 2, walkGates: 0, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing,
      optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
    }
    const c = widthComparison(input, STYLES)!
    expect(c.at6).toBe(quote("WV-ND 6'x6' Privacy", STRAIGHT).priced.price)
    expect(c.at8).toBe(quote("WV-ND 6'x8' Privacy", STRAIGHT).priced.price)
  })

  test('chain link has no line', () => {
    const input = {
      style: { ...byName("WV-ND 6'x6' Privacy"), name: "CL - 4' Galv" }, runs: [{ ft: 150 }], corners: 0, ends: 2, walkGates: 0, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing,
      optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
    }
    expect(widthComparison(input, STYLES)).toBeNull()
  })
})
