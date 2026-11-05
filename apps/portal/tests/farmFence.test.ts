/**
 * Farm fence (web/src/farm.ts; Jonathan, Nov 5 2026). His tests A–E, to the
 * cent: materials only, at shelf price (no tax, no discount), 6" posts $29.99,
 * boards $19.99, Red Brand $414.99, through the quote builder's own math
 * (calculateQuote, the farm kits). Parts he has not priced are $0 here.
 * Then the quantity break, clean corners, the run math the staff see, the
 * X spacing helper, and the one-time step that adds farm fence.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { calculateQuote, type QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap, setQtyBreakSource, inventoryQtyBreakSource } from '../../web/src/materialCalculator'
import { setSavedKitSets } from '../../web/src/materialKits'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { estimateConfig } from '../../web/src/estimate'
import { DEFAULT_CATALOG, plainName, resolveFenceStyles } from '../../web/src/fenceCatalog'
import {
  FARM_COMBOS, FARM_STYLE_NAMES, farmKitSet, farmStyleName, planFarm, farmRuns, farmRolls, crossbuckGap, feetInches,
  POST_6, BOARD, X_BOARD, WIRE_RB, STAPLE, FARM_PARTS, withEstTax,
} from '../../web/src/farm'

const kits = FARM_COMBOS.map(c => farmKitSet(c.style, c.post, c.wire))
const shelf: Record<string, number> = Object.fromEntries(FARM_PARTS.map(p => [p.part, p.shelf ?? 0]))
const pricing = { manHourRate: 22, commissionSalesman: 0, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'hourly' as const, subUnit: 'foot' as const, priceMethod: 'cost_factor' as const, commissionMode: 'included' as const }
const style = (s: string, post = '6', wire = 'redbrand'): QuoteStyle => ({ name: farmStyleName(s, post, wire), category: 'Farm', margin: 0.6, sectionsPerMH: 1, mhPerWalkGate: 2, mhPerDblGate: 4, panelWidth: s === 'xb' ? 7.5 : 8, material: 'farm', choices: { style: s, post, wire } } as QuoteStyle)
const cents = (n: number) => Math.round(n * 100)

function quote(s: QuoteStyle, runs: number[], corners: number, ends: number, rollJoin?: 'clean') {
  const q = calculateQuote({
    style: s, runs: runs.map(ft => ({ ft, rail: 'auto' as const })), corners, ends, walkGates: 0, dblGates: 0,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
    ...(rollJoin ? { rollJoin } : {}),
  })
  const line = (part: string) => q.materials.items.find(i => i.item === part)
  return { q, line, total: cents(q.materials.items.reduce((t, i) => t + i.total, 0)) }
}

beforeAll(() => { setMaterialPriceSource(priceSourceFromMap(shelf)); setSavedKitSets(() => kits) })
afterAll(() => { setMaterialPriceSource(null); setQtyBreakSource(null); setSavedKitSets(() => []) })

describe("Jonathan's tests, to the cent (shelf prices, no tax, no discount)", () => {
  test('A. 3 board + no climb, open, 100 ft: 14 posts $419.86, 21 boards $419.79, 1 roll $414.99 = $1,254.64', () => {
    const { line, total, q } = quote(style('nc3'), [100], 0, 2)
    expect(q.sections).toBe(13)
    expect(line(POST_6)).toMatchObject({ qty: 14, total: 419.86 })
    expect(line(BOARD)).toMatchObject({ qty: 21, total: 419.79 })
    expect(line(WIRE_RB)).toMatchObject({ qty: 1, total: 414.99 })
    expect(total).toBe(125464)
  })
  test('B. 1 board + no climb, open, 100 ft: 14 posts, 7 boards, 1 roll = $974.78', () => {
    const { line, total } = quote(style('nc1'), [100], 0, 2)
    expect([line(POST_6)?.qty, line(BOARD)?.qty, line(WIRE_RB)?.qty]).toEqual([14, 7, 1])
    expect(total).toBe(97478)
  })
  test('C. 4 board + 1 roll (Red Brand, the wire a choice), open, 100 ft: 14 posts, 28 boards, 1 roll = $1,394.57; no wire $979.58', () => {
    const { line, total } = quote(style('b4'), [100], 0, 2)
    expect([line(POST_6)?.qty, line(BOARD)?.qty, line(WIRE_RB)?.qty]).toEqual([14, 28, 1])
    expect(total).toBe(139457)
    const none = quote(style('b4', '6', 'none'), [100], 0, 2)
    expect(none.line(WIRE_RB)).toBeUndefined()
    expect(none.line(STAPLE)).toBeUndefined()
    expect(none.total).toBe(97958)
  })
  test('D. Crossbuck, open, 100 ft: 14 spans, 15 posts $449.85, 14 rail $279.86, 14 X $279.86, 1 roll = $1,424.56', () => {
    const { line, total, q } = quote(style('xb'), [100], 0, 2)
    expect(q.sections).toBe(14)
    expect(line(POST_6)).toMatchObject({ qty: 15, total: 449.85 })
    expect(line(BOARD)).toMatchObject({ qty: 14, total: 279.86 })
    expect(line(X_BOARD)).toMatchObject({ qty: 14, total: 279.86 })
    expect(line(WIRE_RB)).toMatchObject({ qty: 1, total: 414.99 })
    expect(total).toBe(142456)
  })
  test('E. Crossbuck, closed, 165/305/165/305, splice: 126 spans and posts, 128 rail, 126 X, 5 rolls = $10,931.15; clean corners 6 rolls', () => {
    const runs = [165, 305, 165, 305]
    const { line, total, q } = quote(style('xb'), runs, 4, 0)
    expect(q.perRunSections).toEqual([22, 41, 22, 41])
    expect(line(POST_6)).toMatchObject({ qty: 126, total: 3778.74 })
    expect(line(BOARD)).toMatchObject({ qty: 128, total: 2558.72 })
    expect(line(X_BOARD)).toMatchObject({ qty: 126, total: 2518.74 })
    expect(line(WIRE_RB)).toMatchObject({ qty: 5, total: 2074.95 })
    expect(total).toBe(1093115)
    expect(farmRuns(runs, 7.5).map(r => r.spacingText)).toEqual([`7' 6"`, `7' 5"`, `7' 6"`, `7' 5"`])
    const clean = quote(style('xb'), runs, 4, 0, 'clean')
    expect(clean.line(WIRE_RB)).toMatchObject({ qty: 6, total: 2489.94 })
    expect(clean.total - total).toBe(41499)
    // The quantity break: 25 or more 6" posts on a job, 5% off each ($29.99 → $28.49): about $189 here.
    setQtyBreakSource(inventoryQtyBreakSource(FARM_PARTS.filter(p => p.qtyBreak).map(p => ({ name: p.part, qtyBreak: p.qtyBreak }))))
    try {
      const broke = quote(style('xb'), runs, 4, 0)
      expect(broke.line(POST_6)).toMatchObject({ qty: 126, unitCost: 28.49, total: 3589.74, qtyBreak: { minQty: 25, pctOff: 5, fullUnitCost: 29.99 } })
      expect(total - broke.total).toBe(18900)
      // Fewer than 25: no break (test A's 14 posts).
      expect(quote(style('nc3'), [100], 0, 2).line(POST_6)).toMatchObject({ qty: 14, unitCost: 29.99 })
    } finally { setQtyBreakSource(null) }
  })
})

describe('the run math the staff see', () => {
  test('spans, actual spacing never wider than the target, boards per row; rolls both ways and the feet left', () => {
    expect(farmRuns([100], 8)).toEqual([{ ft: 100, spans: 13, spacingFt: 100 / 13, spacingText: `7' 8"`, boardsPerRow: 7 }])
    for (const r of farmRuns([165, 305, 7, 8, 8.01, 1000], 7.5)) expect(r.spacingFt).toBeLessThanOrEqual(7.5)
    expect(farmRolls([165, 305, 165, 305])).toEqual({ splice: 5, clean: 6, spliceLeftFt: 60, cleanLeftFt: 260 })
    expect(feetInches(7.99)).toBe(`8' 0"`)
  })
  test('the crossbuck X helper: 36" → 89", 42" → 86", 48" → 83" clear; on centers + the post', () => {
    expect([36, 42, 48].map(o => Math.round(crossbuckGap(o, 6)!.clearIn))).toEqual([89, 86, 83])
    expect(Math.round(crossbuckGap(36, 6)!.centersIn)).toBe(95)
    expect(crossbuckGap(96, 6)).toBeNull()
  })
})

describe('adding farm fence (planFarm)', () => {
  const base = () => {
    const cfg = estimateConfig({})
    return { fenceStyles: cfg.fenceStyles.map(s => { const c = { ...s }; delete c.label; delete c.held; delete c.jobLot; return c }), fenceCatalog: JSON.parse(JSON.stringify({ ...DEFAULT_CATALOG, materials: DEFAULT_CATALOG.materials.filter(m => m.key !== 'farm') })), items: [], kits: [] }
  }
  test('18 styles, a kit each, the parts at shelf + 7.22% (TSC numbers, the post break, the X board at the board price); run twice, nothing more', () => {
    const plan = planFarm(base())
    expect(plan.catalog).toBe(true)
    expect(plan.styles.sort()).toEqual([...FARM_STYLE_NAMES].sort())
    expect(plan.styles.length).toBe(18)
    expect(plan.kits.length).toBe(18)
    const item = (n: string) => plan.state.items.find(i => i.name === n)!
    expect(item(POST_6)).toMatchObject({ unitCost: 32.16, supplier: 'Tractor Supply', vendorItemNumber: '4041105', qtyBreak: { minQty: 25, pctOff: 5 }, priceUpdatedAt: '2026-11-04' })
    expect(item(BOARD)).toMatchObject({ unitCost: withEstTax(19.99), vendorItemNumber: '4053194' })
    expect(item(X_BOARD)).toMatchObject({ unitCost: 21.43, priceFrom: { part: BOARD, cents: 2143 } })
    expect(item(WIRE_RB)).toMatchObject({ unitCost: 444.95, vendorItemNumber: '3610692' })
    expect(item(STAPLE)).toMatchObject({ unitCost: 0 })
    const again = planFarm(plan.state)
    expect([again.styles, again.kits, again.items, again.catalog]).toEqual([[], [], [], false])
  })
  test('held until every part of its kit is priced; plain names read Farm Fence, style, posts, wire', () => {
    const plan = planFarm(base())
    const price = (zero: boolean) => (n: string) => { const i = plan.state.items.find(x => x.name.toLowerCase().replace(/\s+/g, '') === n.toLowerCase().replace(/\s+/g, '')); return i ? (zero ? i.unitCost : i.unitCost || 1) : undefined }
    const kitOf = (n: string) => plan.state.kits.find(k => k.styleName === n) ?? null
    const held = resolveFenceStyles(plan.state.fenceStyles, plan.state.fenceCatalog!, price(true), kitOf).find(s => s.name === 'farm/nc3/6/redbrand')!
    expect(held.held).toMatch(/Farm fence is waiting for prices on \d+ parts in Inventory/)
    const ok = resolveFenceStyles(plan.state.fenceStyles, plan.state.fenceCatalog!, price(false), kitOf).find(s => s.name === 'farm/nc3/6/redbrand')!
    expect(ok.held).toBeUndefined()
    expect(plainName(plan.state.fenceCatalog!, { material: 'farm', choices: { style: 'xb', post: '5', wire: 'hutch' } })).toBe('Farm Fence, Crossbuck + No Climb, 5" round posts, Hutchison Western no climb')
  })
})
