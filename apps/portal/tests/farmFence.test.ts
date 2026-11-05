/**
 * Farm fence (web/src/farm.ts; Jonathan, Nov 5 2026). His tests A–E, to the
 * cent: materials only, at shelf price (no tax, no discount), 6" posts $29.99,
 * boards $19.99, Red Brand $414.99, through the quote builder's own math
 * (calculateQuote, the farm kits). Parts he has not priced are $0 here.
 * Test E's wire follows his second rule (Nov 5 2026: every run one piece,
 * fitted into the fewest rolls, no splice mode): 6 rolls, 2 splices. Then the
 * quantity break, the roll packing, gates by opening width, the run math the
 * staff see, the X spacing helper, and the one-time steps that add farm fence.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { calculateQuote, type QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap, setQtyBreakSource, inventoryQtyBreakSource } from '../../web/src/materialCalculator'
import { setSavedKitSets } from '../../web/src/materialKits'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { estimateConfig, quoteJobFor } from '../../web/src/estimate'
import { DEFAULT_CATALOG, plainName, resolveFenceStyles } from '../../web/src/fenceCatalog'
import { tierStyles } from '../../web/src/tiers'
import { FARM_STARTER } from '../src/server/lib/tierStarters'
import {
  FARM_COMBOS, FARM_STYLE_NAMES, farmKitSet, farmStyleName, planFarm, planFarmGates, farmRuns, packWireRolls, rollPlanText, farmGates, crossbuckGap, feetInches,
  POST_6, BOARD, X_BOARD, WIRE_RB, STAPLE, FARM_PARTS, withEstTax, TUBE_GATES, GATE_HINGE, GATE_LATCH,
} from '../../web/src/farm'

const kits = FARM_COMBOS.map(c => farmKitSet(c.style, c.post, c.wire))
const shelf: Record<string, number> = Object.fromEntries(FARM_PARTS.map(p => [p.part, p.shelf ?? 0]))
const pricing = { manHourRate: 22, commissionSalesman: 0, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'hourly' as const, subUnit: 'foot' as const, priceMethod: 'cost_factor' as const, commissionMode: 'included' as const }
const style = (s: string, post = '6', wire = 'redbrand'): QuoteStyle => ({ name: farmStyleName(s, post, wire), category: 'Farm', margin: 0.6, sectionsPerMH: 1, mhPerWalkGate: 2, mhPerDblGate: 4, panelWidth: s === 'xb' ? 7.5 : 8, material: 'farm', choices: { style: s, post, wire } } as QuoteStyle)
const cents = (n: number) => Math.round(n * 100)

function quote(s: QuoteStyle, runs: number[], corners: number, ends: number, gates?: { walk: number[]; dbl: number[] }) {
  const q = calculateQuote({
    style: s, runs: runs.map(ft => ({ ft, rail: 'auto' as const })), corners, ends, walkGates: gates?.walk.length ?? 0, dblGates: gates?.dbl.length ?? 0,
    ...(gates ? { gateWidths: gates } : {}),
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS,
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
  test('E. Crossbuck, closed, 165/305/165/305: 126 spans and posts, 128 rail, 126 X; every run one piece: 6 rolls, 2 splices = $11,346.14', () => {
    const runs = [165, 305, 165, 305]
    const { line, total, q } = quote(style('xb'), runs, 4, 0)
    expect(q.perRunSections).toEqual([22, 41, 22, 41])
    expect(line(POST_6)).toMatchObject({ qty: 126, total: 3778.74 })
    expect(line(BOARD)).toMatchObject({ qty: 128, total: 2558.72 })
    expect(line(X_BOARD)).toMatchObject({ qty: 126, total: 2518.74 })
    // His first answer spliced 5 rolls ($10,931.15); the rule now: each 305 ft run takes a full roll and 105 ft from
    // another (one splice each); 165, 165, 105 and 105 cannot share a roll whole: 6 rolls.
    expect(line(WIRE_RB)).toMatchObject({ qty: 6, total: 2489.94 })
    expect(total).toBe(1134614)
    expect(line(WIRE_RB)!.note).toBe('Roll 1: run 2 200 ft. Roll 2: run 4 200 ft. Roll 3: run 1 165 ft (35 ft left). Roll 4: run 3 165 ft (35 ft left). Roll 5: run 2 105 ft (95 ft left). Roll 6: run 4 105 ft (95 ft left). 2 splices: run 2, run 4 (longer than a roll).')
    expect(farmRuns(runs, 7.5).map(r => r.spacingText)).toEqual([`7' 6"`, `7' 5"`, `7' 6"`, `7' 5"`])
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
    expect(feetInches(7.99)).toBe(`8' 0"`)
  })
  test('wire rolls: every run one piece, a run on a leftover only whole, splices only in a run longer than a roll, the fewest rolls', () => {
    const p = (runs: number[]) => { const r = packWireRolls(runs, 200); return { rolls: r.rolls.length, splices: r.splices.map(x => x.run), left: r.leftFt } }
    expect(p([165, 305, 165, 305])).toEqual({ rolls: 6, splices: [2, 4], left: 260 })
    // Short runs share a roll only when each fits whole: 120 + 80 and 150 + 50.
    expect(p([120, 150, 80, 50])).toEqual({ rolls: 2, splices: [], left: 0 })
    // The review's yard: 30, 13, 165, 305, 165, 30 and 13 ft: 4 rolls (not 7), one splice in the 305.
    expect(p([30, 13, 165, 305, 165, 30, 13])).toEqual({ rolls: 4, splices: [4], left: 79 })
    // 450 ft: two full rolls and 50 ft spliced on, from the roll the 150 ft run is cut from.
    expect(p([450, 150])).toEqual({ rolls: 3, splices: [1, 1], left: 0 })
    expect(p([400])).toEqual({ rolls: 2, splices: [1], left: 0 })
    expect(p([201])).toEqual({ rolls: 2, splices: [1], left: 199 })
    expect(p([])).toEqual({ rolls: 0, splices: [], left: 0 })
    // First fit decreasing past 18 pieces still keeps every run whole.
    const many = Array.from({ length: 25 }, (_, i) => 40 + i * 5)
    const big = packWireRolls(many, 200)
    expect(big.rolls.every(r => r.pieces.reduce((t, x) => t + x.ft, 0) <= 200)).toBe(true)
    expect(big.rolls.flatMap(r => r.pieces.map(x => x.run)).sort((a, b) => a - b)).toEqual(many.map((_, i) => i + 1))
    expect(rollPlanText(packWireRolls([120, 80], 200))).toBe('Roll 1: run 1 120 ft + run 2 80 ft. No splices.')
  })
  test('gates: one tube gate of the full opening width, up to the widest in Inventory; wider, a double', () => {
    const has = (n: string) => TUBE_GATES.some(g => g.part === n)
    const out = farmGates([4, 7, 12, 30, 50], has)
    const q = (part: string) => out.lines.find(l => l.part === part)?.qty
    expect(q(TUBE_GATES.find(g => g.ft === 4)!.part)).toBe(1)
    expect(q(TUBE_GATES.find(g => g.ft === 8)!.part)).toBe(1)   // 7 ft: the 8 ft gate
    expect(q(TUBE_GATES.find(g => g.ft === 12)!.part)).toBe(1)
    expect(q(TUBE_GATES.find(g => g.ft === 16)!.part)).toBe(2)  // 30 ft: two 16 ft leaves
    expect(q(TUBE_GATES.find(g => g.ft === 20)!.part)).toBe(2)  // 50 ft: two 20 ft, said
    expect([q(GATE_HINGE), q(GATE_LATCH)]).toEqual([7, 5])
    expect(out.notes[0]).toMatch(/50 ft opening is wider than two 20 ft gates/)
    // Only gates that are in Inventory: with 4 to 12 ft, a 14 ft opening is two 8 ft leaves.
    const upTo12 = farmGates([14], n => TUBE_GATES.some(g => g.part === n && g.ft <= 12))
    expect(upTo12.lines).toEqual([{ part: TUBE_GATES.find(g => g.ft === 8)!.part, qty: 2 }, { part: GATE_HINGE, qty: 2 }, { part: GATE_LATCH, qty: 1 }])
  })
  test('on a quote: a 12 ft walk gate drawn is one 12 ft tube gate; a 10 ft double opening one 10 ft gate; a typed walk gate 4 ft', () => {
    setMaterialPriceSource(priceSourceFromMap({ ...shelf, ...Object.fromEntries(TUBE_GATES.map(g => [g.part, 100 + g.ft])) }))
    try {
      const { line } = quote(style('nc3'), [50, 50], 0, 4, { walk: [12], dbl: [10] })
      expect(line(TUBE_GATES.find(g => g.ft === 12)!.part)?.qty).toBe(1)
      expect(line(TUBE_GATES.find(g => g.ft === 10)!.part)?.qty).toBe(1)
      expect(line(TUBE_GATES.find(g => g.ft === 4)!.part)).toBeUndefined()
      expect([line(GATE_HINGE)?.qty, line(GATE_LATCH)?.qty]).toEqual([2, 2])
    } finally { setMaterialPriceSource(priceSourceFromMap(shelf)) }
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
    // A farm kit saved with the old gate lines loses them (gates go by width now); other kits are not touched.
    const old = plan.state.kits.map(k => (k.madeFor === 'farm' ? { ...k, kits: { ...k.kits, walkGate: [{ part: 'x', qty: 1, fallbackCost: 0 }] } } : k))
    const g = planFarmGates([...old, { id: 'v', name: 'v', styleName: 'WV', kits: { walkGate: [{ part: 'y', qty: 1, fallbackCost: 0 }] }, roundUp: [] }])
    expect(g.changed.length).toBe(18)
    expect(g.kits.filter(k => k.madeFor === 'farm').every(k => !k.kits.walkGate)).toBe(true)
    expect(g.kits.find(k => k.id === 'v')!.kits.walkGate).toEqual([{ part: 'y', qty: 1, fallbackCost: 0 }])
  })
  test('held until every part of its kit is priced and a sub rate per foot is set (no price without labor); plain names read Farm Fence, style, posts, wire', () => {
    const plan = planFarm(base())
    const price = (zero: boolean) => (n: string) => { const i = plan.state.items.find(x => x.name.toLowerCase().replace(/\s+/g, '') === n.toLowerCase().replace(/\s+/g, '')); return i ? (zero ? i.unitCost : i.unitCost || 1) : undefined }
    const kitOf = (n: string) => plan.state.kits.find(k => k.styleName === n) ?? null
    const held = resolveFenceStyles(plan.state.fenceStyles, plan.state.fenceCatalog!, price(true), kitOf).find(s => s.name === 'farm/nc3/6/redbrand')!
    expect(held.held).toMatch(/Farm fence is waiting for prices on \d+ parts in Inventory/)
    // Every part priced, no sub rate: still held, for labor.
    const noSub = resolveFenceStyles(plan.state.fenceStyles, plan.state.fenceCatalog!, price(false), kitOf).find(s => s.name === 'farm/nc3/6/redbrand')!
    expect(noSub.held).toBe('its sub rate per foot is not set (Settings → Fence Styles → Farm fence)')
    // A sub rate per foot on the fence, on the Farm material or on a farm choice: available for quoting.
    // The Salesman's copy has no sub rates; the server marks laborReady instead (routes/business-state.ts).
    const marked = plan.state.fenceStyles.map(s => (s.name === 'farm/nc3/6/redbrand' ? { ...s, laborReady: true } : s))
    expect(resolveFenceStyles(marked, plan.state.fenceCatalog!, price(false), kitOf).find(s => s.name === 'farm/nc3/6/redbrand')!.held).toBeUndefined()
    const onFence = plan.state.fenceStyles.map(s => (s.name === 'farm/nc3/6/redbrand' ? { ...s, subRate: 4.5 } : s))
    expect(resolveFenceStyles(onFence, plan.state.fenceCatalog!, price(false), kitOf).find(s => s.name === 'farm/nc3/6/redbrand')!.held).toBeUndefined()
    const cat = JSON.parse(JSON.stringify(plan.state.fenceCatalog))
    cat.materials.find((m: any) => m.key === 'farm').rateDefaults = { subRate: 4 }
    const all = resolveFenceStyles(plan.state.fenceStyles, cat, price(false), kitOf).filter(s => s.name.startsWith('farm/'))
    expect(all.length).toBe(18)
    expect(all.every(s => !s.held)).toBe(true)
    const cat2 = JSON.parse(JSON.stringify(plan.state.fenceCatalog))
    cat2.materials.find((m: any) => m.key === 'farm').dims.find((d: any) => d.key === 'style').options.find((o: any) => o.key === 'xb').rateDefaults = { subRate: 5 }
    const byChoice = resolveFenceStyles(plan.state.fenceStyles, cat2, price(false), kitOf).filter(s => s.name.startsWith('farm/'))
    expect(byChoice.filter(s => !s.held).map(s => s.name).sort()).toEqual(['farm/xb/5/hutch', 'farm/xb/5/redbrand', 'farm/xb/6/hutch', 'farm/xb/6/redbrand'])
    expect(plainName(plan.state.fenceCatalog!, { material: 'farm', choices: { style: 'xb', post: '5', wire: 'hutch' } })).toBe('Farm Fence, Crossbuck + No Climb, 5" round posts, Hutchison Western no climb')
  })
})

describe('Good and Better (the Farm tier set)', () => {
  test('Good = Hutchison + 5", Better = Red Brand + 6", the same style', () => {
    const all = FARM_COMBOS.map(c => style(c.style.key, c.post.key, c.wire.key))
    for (const [s, wire] of [['nc1', 'redbrand'], ['nc3', 'hutch'], ['xb', 'redbrand'], ['b4', 'redbrand'], ['b4', 'hutch']]) {
      const [good, better] = FARM_STARTER.map(t => tierStyles(t, style(s, '6', wire), all))
      expect('styles' in good && good.styles.map(x => x.name)).toEqual([farmStyleName(s, '5', 'hutch')])
      expect('styles' in better && better.styles.map(x => x.name)).toEqual([farmStyleName(s, '6', 'redbrand')])
    }
  })
  test('4 board with no wire: Good and Better never add wire, they differ by post size only (Jonathan, Nov 5 2026)', () => {
    const all = FARM_COMBOS.map(c => style(c.style.key, c.post.key, c.wire.key))
    for (const post of ['5', '6']) {
      const [good, better] = FARM_STARTER.map(t => tierStyles(t, style('b4', post, 'none'), all))
      expect('styles' in good && good.styles.map(x => x.name)).toEqual(['farm/b4/5/none'])
      expect('styles' in better && better.styles.map(x => x.name)).toEqual(['farm/b4/6/none'])
    }
  })
})

describe('the server prices a farm fence only when it is available for quoting (Jonathan, Nov 5 2026)', () => {
  const company = (subRate?: number) => {
    const cfg = estimateConfig({})
    const plan = planFarm({ fenceStyles: cfg.fenceStyles.map(s => { const c = { ...s }; delete c.label; delete c.held; delete c.jobLot; return c }), fenceCatalog: JSON.parse(JSON.stringify({ ...DEFAULT_CATALOG, materials: DEFAULT_CATALOG.materials.filter(m => m.key !== 'farm') })), items: [], kits: [] })
    const items = plan.state.items.map(i => ({ ...i, unitCost: i.unitCost || 1 }))
    const catalog = JSON.parse(JSON.stringify(plan.state.fenceCatalog))
    if (subRate) catalog.materials.find((m: any) => m.key === 'farm').rateDefaults = { subRate }
    return { config: { ...cfg, fenceStyles: plan.state.fenceStyles, fenceCatalog: catalog } as any, inventory: items, kits: plan.state.kits, tierSets: [{ category: 'Farm', tiers: FARM_STARTER }] as any }
  }
  const req = (fenceStyle: string) => ({ fenceStyle, runs: [{ ft: 100, rail: 'auto' as const }], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {}, jobType: 'new' as const, tierSet: { category: 'Farm', tiers: FARM_STARTER, popular: null } as any })
  afterAll(() => { setMaterialPriceSource(priceSourceFromMap(shelf)); setQtyBreakSource(null); setSavedKitSets(() => kits) })
  test('no sub rate per foot: refused, even named directly (the Salesman\'s server pricing)', () => {
    let err: any = null
    try { quoteJobFor(company(), req('farm/b4/6/none'), 30) } catch (e) { err = e }
    expect(err?.code).toBe('not_quotable')
    expect(err?.held).toMatch(/sub rate per foot is not set/)
  })
  test('a 4 board with no wire: Good and Better read posts and no wire, never a wire', () => {
    const job = quoteJobFor(company(4), req('farm/b4/6/none'), 30)
    const byKey = Object.fromEntries(job.proposalOptions.filter(o => o.tier).map(o => [o.tier!.key, o]))
    expect(byKey.good.fenceStyle).toBe('farm/b4/5/none')
    expect(byKey.better.fenceStyle).toBe('farm/b4/6/none')
    expect(byKey.good.tier!.blurb).toBe('5" round treated posts, no wire.')
    expect(byKey.better.tier!.blurb).toBe('6" round treated posts, no wire.')
    // A fence with wire keeps the tier's words.
    const wired = quoteJobFor(company(4), req('farm/nc3/6/redbrand'), 30)
    expect(wired.proposalOptions.find(o => o.tier?.key === 'good')!.tier!.blurb).toBe('Hutchison Western no climb wire on 5" round treated posts.')
  })
})
