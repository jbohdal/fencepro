/**
 * Layout first quoting: a yard described as sides turns into exactly the runs,
 * posts and gates a salesman would type by hand, and prices the same.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { layoutForShape, deriveLayout, formatFtIn, parseFtIn, postSpacing, type YardLayout } from '../../web/src/yardLayout'
import { calculateQuote, type QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const ft = (n: number) => n * 12
const style: QuoteStyle = { name: "WV-ND 6'x8' Privacy", category: 'Vinyl', margin: 0.58, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 8 }
const pricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Vinyl: 24 } }

function price(job: { runs: number[]; corners: number; ends: number; walkGates: number; dblGates: number }) {
  return calculateQuote({
    style, runs: job.runs.map(f => ({ ft: f })), corners: job.corners, ends: job.ends, walkGates: job.walkGates, dblGates: job.dblGates,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
  })
}
/** The layout's output priced, next to the same job typed by hand. */
function samePriceAsTyped(layout: YardLayout, typed: { runs: number[]; corners: number; ends: number; walkGates: number; dblGates: number }) {
  const d = deriveLayout(layout)
  const fromLayout = price({ runs: d.runs.map(r => r.ft), corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates })
  const byHand = price(typed)
  expect(fromLayout.materials.items).toEqual(byHand.materials.items)
  expect(fromLayout.sections).toBe(byHand.sections)
  expect(fromLayout.priced.price).toBe(byHand.priced.price)
  return fromLayout
}

describe('(a) backyard: two returns with gates, two sides, back', () => {
  const layout = layoutForShape('backyard')
  const [lr, ls, back, rs, rr] = layout.sides
  lr.lengthIn = ft(30); lr.gate = { type: 'walk', widthIn: 48, position: 'middle' }
  ls.lengthIn = ft(120)
  back.lengthIn = ft(150)
  rs.lengthIn = ft(120)
  rr.lengthIn = ft(30); rr.gate = { type: 'double', widthIn: 120, position: 'middle' }

  test('each return is typed as one number and split around its gate', () => {
    const d = deriveLayout(layout)
    expect(d.runs.map(r => r.ft)).toEqual([13, 13, 120, 150, 120, 10, 10])
    expect(d.counted).toEqual({ corners: 4, endPosts: 2, gatePosts: 4 })
    expect([d.corners, d.ends, d.walkGates, d.dblGates]).toEqual([4, 6, 1, 1])
  })

  test('prices exactly like typing the runs by hand', () => {
    const q = samePriceAsTyped(layout, { runs: [13, 13, 120, 150, 120, 10, 10], corners: 4, ends: 6, walkGates: 1, dblGates: 1 })
    // 2 + 2 + 15 + 19 + 15 + 2 + 2
    expect(q.sections).toBe(57)
  })
})

describe('(b) left side from the house, back with an existing fence skip, right side off', () => {
  const layout = layoutForShape('backyard')
  const [lr, ls, back, rs, rr] = layout.sides
  lr.on = false; rs.on = false; rr.on = false
  ls.lengthIn = ft(120); ls.startFinish = 'house'
  back.lengthIn = ft(150); back.skip = { kind: 'existing', lengthIn: ft(40), position: 'middle' }

  test('the skip splits the back and is not charged', () => {
    const d = deriveLayout(layout)
    expect(d.runs.map(r => r.ft)).toEqual([120, 55, 55])
    // House end, 2 at the skip, and the back stops where the right side would be.
    expect(d.counted).toEqual({ corners: 1, endPosts: 4, gatePosts: 0 })
    expect(d.sides[2].fenceIn).toBe(ft(110))
  })

  test('prices exactly like typing the runs by hand', () => {
    const q = samePriceAsTyped(layout, { runs: [120, 55, 55], corners: 1, ends: 4, walkGates: 0, dblGates: 0 })
    expect(q.sections).toBe(15 + 7 + 7)
  })
})

describe('(c) one straight 81 ft run that stops at both ends', () => {
  const layout = layoutForShape('straight')
  layout.sides[0].lengthIn = ft(81)

  test('11 sections, 2 end posts, posts 7\' 4 3/8" apart', () => {
    const d = deriveLayout(layout)
    expect(d.runs.map(r => r.ft)).toEqual([81])
    expect([d.corners, d.ends]).toEqual([0, 2])
    const q = samePriceAsTyped(layout, { runs: [81], corners: 0, ends: 2, walkGates: 0, dblGates: 0 })
    expect(q.sections).toBe(11)
    expect(postSpacing(81, 11)).toBe(`7' 4 3/8"`)
  })
})

describe('posts and finishes', () => {
  test('a full perimeter has 4 corners and no end posts', () => {
    const l = layoutForShape('perimeter')
    l.sides.forEach(s => { s.lengthIn = ft(100) })
    const d = deriveLayout(l)
    expect([d.corners, d.ends]).toEqual([4, 0])
  })

  test('a gate near the house starts one section from it', () => {
    const l = layoutForShape('backyard')
    l.sides[0].lengthIn = ft(30)
    l.sides[0].gate = { type: 'walk', widthIn: 48, position: 'start' }
    expect(deriveLayout(l, 96).runs.slice(0, 2).map(r => r.ft)).toEqual([8, 18])
  })

  test('a gate right at a corner uses the corner post', () => {
    const l = layoutForShape('straight')
    l.sides[0].lengthIn = ft(20)
    l.sides[0].gate = { type: 'walk', widthIn: 48, position: 'distance', distanceIn: 0 }
    const d = deriveLayout(l)
    expect(d.runs.map(r => r.ft)).toEqual([16])
    expect(d.ends).toBe(3) // the end post the gate hangs on, the gate's other post, the far end
  })

  test('a gate wider than its side is left off with a note', () => {
    const l = layoutForShape('straight')
    l.sides[0].lengthIn = ft(3)
    l.sides[0].gate = { type: 'walk', widthIn: 48, position: 'middle' }
    const d = deriveLayout(l)
    expect(d.walkGates).toBe(0)
    expect(d.notes[0]).toMatch(/wider than the side/)
  })

  test('typed counts replace the counted ones', () => {
    const l = layoutForShape('straight')
    l.sides[0].lengthIn = ft(50)
    l.cornersOverride = 1; l.endsOverride = 3
    const d = deriveLayout(l)
    expect([d.corners, d.ends]).toEqual([1, 3])
    expect(d.counted.endPosts).toBe(2)
  })
})

describe('feet and inches', () => {
  test('reads and writes 80\' 4"', () => {
    expect(parseFtIn(`80' 4"`)).toBe(964)
    expect(parseFtIn('80 4')).toBe(964)
    expect(parseFtIn("80'")).toBe(960)
    expect(parseFtIn('80.5')).toBe(966)
    expect(parseFtIn('80 12')).toBeNull()
    expect(formatFtIn(964)).toBe(`80' 4"`)
    expect(formatFtIn(960)).toBe(`80' 0"`)
  })
})
