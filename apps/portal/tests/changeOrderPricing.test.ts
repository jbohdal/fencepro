/**
 * Change orders from the drawing or the run list (Jonathan, Oct 31 2026:
 * "Chain link change orders: price fabric by the foot, not whole rolls."
 * "Added gate: 2 new gate posts."; web/src/changeOrderPricing.ts). Checked on
 * the step lines and on the one price difference line, against the pull sheet,
 * which keeps whole rolls and the real post count.
 */

import { describe, test, expect, beforeAll } from 'vitest'
import { setMaterialPriceSource, calculateMaterialsDetailed } from '../../web/src/materialCalculator'
import { setSavedKitSets } from '../../web/src/materialKits'
import { calculateQuote, type QuoteCalcInput, type QuoteStyle } from '../../web/src/quoteCalc'
import { estimateConfig, quoteJobFor, type EstimateData } from '../../web/src/estimate'
import { changeOrderDraft } from '../../web/src/changeOrderDraft'
import { changeBaseOf, changeOrderInput, changeOrderPrice, gatePostsOf, type EarlierOrder } from '../../web/src/changeOrderPricing'
import { creditAfterVoid } from '../src/server/lib/changeOrders'
import { priceMove, moveRepairSettings, type WorkCommon } from '../../web/src/moveRepair'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { deriveLayout, layoutForShape, teePostFor, type YardLayout } from '../../web/src/yardLayout'
import type { QuoteJobRequest } from '../../web/src/quoteJob'
import type { PricingSettings } from '../../web/src/pricingEngine'

const cfg = estimateConfig(null)
const CL = "CL - 5' Galv", BLACK = "CL - 6' Black", COM = "CL - Com 6'", VINYL = "WV-ND 6'x6' Privacy", ALUM = 'Alum - DS - Emily - 48'
const styleOf = (name: string) => cfg.fenceStyles.find(s => s.name === name) as QuoteStyle
const pricing: PricingSettings = {
  ...cfg.pricing, manHourRate: 25, commissionSalesman: 0.09, commissionNonSalesman: 0, tearOutFence: 13.5, tearOutGate: 27,
  laborMode: 'subcontractor', subUnit: 'foot', subRateDefault: 5, subRateByCategory: { Vinyl: 5, Aluminum: 4, Chainlink: 3.9, Commercial: 3.9 },
  subWalkGate: 10, subDblGate: 20, subTearOutSection: 4, subTearOutGate: 12, priceMethod: 'cost_factor', commissionMode: 'included',
}
const ROLL = 137.5 // CL - 5' Galv fabric, built in cost.
const data: EstimateData = { config: { pricing: { ...pricing, overheadPct: 30 } } as never, inventory: [], kits: [] }

beforeAll(() => { setMaterialPriceSource(null); setSavedKitSets(() => []) })

const input = (name: string, runs: number[], extra: Partial<QuoteCalcInput> = {}): QuoteCalcInput => ({
  style: styleOf(name), runs: runs.map(ft => ({ ft, rail: 'auto' as const })), corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
  extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, pricing, overrides: {}, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, ...extra,
})
const signedOf = (i: QuoteCalcInput, extra: Record<string, unknown> = {}) => ({
  id: 'q1', fenceStyle: i.style!.name, runs: i.runs.map(r => r.ft), runRails: i.runs.map(() => 'auto'), corners: i.corners, ends: i.ends, walkGates: i.walkGates, dblGates: i.dblGates,
  tearOutSections: 0, tearOutGates: 0, adjLaborHrs: 0, hasSalesman: false, priceAdjust: 0, sections: calculateQuote(i).sections, finalPrice: calculateQuote(i).priced.price, ...extra,
}) as never
const fabricOf = (i: QuoteCalcInput) => calculateQuote(i).materials.items.filter(x => /Fabric/.test(x.item))
const total = (d: { lines: Array<{ amountCents: number }> }) => d.lines.reduce((s, l) => s + l.amountCents, 0)
/** The change order both ways: the step lines, and the one price difference line a prices only login gets. */
function both(was: QuoteCalcInput, now: QuoteCalcInput, nowDrawing?: Parameters<typeof changeOrderDraft>[0]['now'], extraSigned: Record<string, unknown> = {}) {
  const signed = signedOf(was, extraSigned)
  const draft = { signed, current: now, signedOverrides: {}, styles: cfg.fenceStyles as never, sectionsNow: calculateQuote(now).sections, now: nowDrawing ?? null }
  const steps = changeOrderDraft({ ...draft, priceNow: 0, simple: false })
  const simple = changeOrderDraft({ ...draft, priceNow: changeOrderPrice(now, changeBaseOf(signed as never, nowDrawing)), simple: true })
  return { steps: total(steps), simple: total(simple), lines: steps.lines }
}

const yard = (ft: number, gate = false, extra: Partial<YardLayout['sides'][number]> = {}): YardLayout => {
  const y = layoutForShape('straight')
  y.sides[0] = { ...y.sides[0], id: 'a', lengthIn: ft * 12, gate: gate ? { type: 'walk', widthIn: 48, position: 'middle' } : null, ...extra }
  return y
}
/** A job drawn as `was` and changed to `now`, the way QuoteBuilder derives both. */
function drawn(name: string, was: YardLayout, now: YardLayout) {
  const st = styleOf(name), nearIn = (st.panelWidth ?? 6) * 12, teeAs = teePostFor(st)
  const inp = (y: YardLayout) => {
    const d = deriveLayout(y, nearIn, { teeAs })
    return input(name, d.runs.map(r => r.ft), { corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates, gateWidths: d.gateWidthsFt })
  }
  return { was: inp(was), now: inp(now), drawing: { yard: now, nearIn, teeAs }, signed: { layout: { yard: was } } }
}
const postsOn = (i: QuoteCalcInput) => calculateQuote(i).materials.items.filter(x => /2-1\/2" X|1-5\/8" X/.test(x.item)).reduce((t, x) => t + x.qty, 0)

describe('chain link fabric moves by the foot', () => {
  test.each([[100, 110], [100, 120], [120, 100], [95, 105]])('%i ft to %i ft: the fabric moves N/50 of a roll, step lines and the one line alike', (a, b) => {
    const was = input(CL, [a]), now = input(CL, [b])
    const base = changeBaseOf(signedOf(was) as never)
    const qty = (i: QuoteCalcInput) => fabricOf(changeOrderInput(i, base))[0].qty
    expect(qty(was)).toBe(Math.ceil(a / 50))
    expect(qty(now)).toBeCloseTo(Math.ceil(a / 50) + (b - a) / 50, 6)
    const { steps, simple } = both(was, now)
    // Both are whole dollars. The one line rounds down from the signed price; the steps from whole dollar prices.
    expect(Math.abs(steps % 100)).toBe(0)
    expect(Math.abs(steps - simple)).toBeLessThanOrEqual(100)
    const old = Math.round(calculateQuote({ ...now, overrides: { wholeDollar: true } }).priced.price * 100) - Math.round(calculateQuote({ ...was, overrides: { wholeDollar: true } }).priced.price * 100)
    const rollsDiff = Math.ceil(b / 50) - Math.ceil(a / 50) - (b - a) / 50
    // Less than the old whole roll price by the part of a roll not used, at the style's margin.
    expect(Math.abs(old - steps)).toBeGreaterThanOrEqual(Math.floor(Math.abs(rollsDiff) * ROLL * 100) - 100)
  })

  test('only the fabric moves: hook ties, top rail and everything else count as they do today', () => {
    const now = input(CL, [120])
    const plain = calculateQuote(now).materials.items
    const co = calculateQuote({ ...now, fabricFromFt: 100 }).materials.items
    expect(co.filter(x => !/Fabric/.test(x.item))).toEqual(plain.filter(x => !/Fabric/.test(x.item)))
    expect(co.find(x => /Fabric/.test(x.item))!.qty).toBe(2.4)
    expect(plain.find(x => /Fabric/.test(x.item))!.qty).toBe(3)
  })

  test.each([[CL], [BLACK], [COM]])('%s: its fabric line, kits and the old parts list alike', name => {
    expect(fabricOf({ ...input(name, [110]), fabricFromFt: 100 })[0].qty).toBe(2.2)
    // The old parts list (a style with no kit in use reads it): same rule.
    const legacy = calculateMaterialsDetailed({ fenceStyle: name, runs: [110], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, fabricFromFt: 100 })
    expect(legacy.items.find(x => /Fabric/.test(x.item))!.qty).toBe(2.2)
  })

  test('vinyl and aluminum never change: the option does nothing to their parts', () => {
    for (const name of [VINYL, ALUM]) expect(calculateQuote({ ...input(name, [120]), fabricFromFt: 100 }).materials.items).toEqual(calculateQuote(input(name, [120])).materials.items)
  })

  test('a credit never goes under nothing, and a same length change is the same price', () => {
    expect(fabricOf({ ...input(CL, [10]), fabricFromFt: 95 })[0].qty).toBeCloseTo(0.3, 6)
    expect(both(input(CL, [100]), input(CL, [100])).steps).toBe(0)
  })

  test('two change orders: the second is billed its own feet, never the first one\'s roll again (the one line)', () => {
    const was = input(CL, [100]), after = input(CL, [110]), now = input(CL, [120])
    const original = changeBaseOf(signedOf(was) as never)
    const contract = Math.floor(changeOrderPrice(after, original))
    const second = changeOrderPrice(now, original) - contract
    // What the second change alone adds, priced from the first one's work.
    const own = changeOrderPrice(now, changeBaseOf(signedOf(after) as never)) - changeOrderPrice(after, changeBaseOf(signedOf(after) as never))
    expect(Math.abs(second - own)).toBeLessThanOrEqual(2)
  })

  test('a new quote and the pull sheet stay in whole rolls', () => {
    const req: QuoteJobRequest = {
      fenceStyle: CL, runs: [{ ft: 110, rail: 'auto' }], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
      extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {}, jobType: 'new',
    }
    const plain = quoteJobFor(data, req)
    const co = quoteJobFor(data, { ...req, changeBase: changeBaseOf(signedOf(input(CL, [100])) as never) })
    expect(plain.changePrice).toBeNull()
    expect(co.changePrice).toBeLessThan(plain.totals.price)
    expect(co.totals).toEqual(plain.totals)
    expect(co.pullSheet).toEqual(plain.pullSheet)
    expect(co.pullSheet.find(x => /Fabric/.test(x.item))!.qty).toBe(3)
  })
})

describe('each gate added has 2 new gate posts', () => {
  test.each([[CL, 100], [VINYL, 96], [ALUM, 96]])('%s, into a side by the drawing: no credit for the line post its opening drops', (name, ft) => {
    const d = drawn(name, yard(ft), yard(ft, true))
    const base = changeBaseOf({ ...signedOf(d.was) as object, ...d.signed } as never, d.drawing)
    const p = gatePostsOf(d.now, base)
    expect(p.ends).toBe(0)
    expect(p.linePosts).toBeGreaterThanOrEqual(0)
    // The posts priced: the 2 gate posts plus every line post the side had.
    const lines = (i: QuoteCalcInput) => calculateQuote(i).perRunSections.reduce((t, n) => t + Math.max(0, n - 1), 0)
    expect(d.now.ends + lines(d.now) + p.linePosts).toBe(d.was.ends + lines(d.was) + 2)
    const r = both(d.was, d.now, d.drawing, d.signed)
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].description).toBe('Add 1 walk gate (4 ft of fence becomes the gate)')
    expect(Math.abs(r.steps - r.simple)).toBeLessThanOrEqual(100)
  })

  test('on the run list, with the post counts left alone: 2 new end posts', () => {
    const was = input(CL, [100]), now = input(CL, [100], { walkGates: 1 })
    const base = changeBaseOf(signedOf(was) as never)
    expect(gatePostsOf(now, base)).toEqual({ ends: 2, linePosts: 0 })
    expect(postsOn(changeOrderInput(now, base)) - postsOn(now)).toBe(2)
  })

  test('on the run list with the end posts typed too, and a 4 ft gate cut out of the run: still 2', () => {
    const was = input(VINYL, [96]), now = input(VINYL, [46, 46], { ends: 4, walkGates: 1 })
    expect(gatePostsOf(now, changeBaseOf(signedOf(was) as never))).toEqual({ ends: 0, linePosts: 1 })
  })

  test.each([["CL - 4' Galv", [100], [80], 1], ["CL - 4' Galv", [100], [60], 1], [VINYL, [96], [72], 1], [CL, [100], [96], 0], [CL, [100, 50], [100, 20], 1]])(
    '%s, %j to %j on the run list with a gate: the line posts the removed fence takes are credited, the opening\'s are not', (name, a, b, kept) => {
      const was = input(name as string, a as number[]), now = input(name as string, b as number[], { walkGates: 1 })
      expect(gatePostsOf(now, changeBaseOf(signedOf(was) as never)).linePosts).toBe(kept)
    })

  test.each([
    [VINYL, [44], [38], { walkGates: 1, gateWidths: { walk: [6], dbl: [] } }, 1],
    [VINYL, [44], [40], { walkGates: 1 }, 1],
    [CL, [102], [96], { walkGates: 1, gateWidths: { walk: [6], dbl: [] } }, 1],
    [CL, [104], [90], { dblGates: 1, gateWidths: { walk: [], dbl: [14] } }, 2],
  ])('%s, %j to %j: the opening is the gate\'s own width (%j), and its line post stays priced', (name, a, b, extra, kept) => {
    const was = input(name as string, a as number[]), now = input(name as string, b as number[], extra as Partial<QuoteCalcInput>)
    expect(gatePostsOf(now, changeBaseOf(signedOf(was) as never)).linePosts).toBe(kept)
  })

  test('a job that has a gate already: the added gate\'s width, not the old one\'s', () => {
    const was = input(VINYL, [44, 20], { walkGates: 1 }), now = input(VINYL, [38, 20], { walkGates: 2, gateWidths: { walk: [4, 6], dbl: [] } })
    expect(gatePostsOf(now, changeBaseOf(signedOf(was) as never)).linePosts).toBe(1)
  })

  test.each([
    [[40], [28, 28]], [[40, 40, 20], [40, 18, 18, 30]], [[40, 40, 20], [40, 30, 18, 18]],
  ])('fence added with the gate on a run list, %j to %j: the line post its opening drops stays priced, as on the drawing', (a, b) => {
    const was = input(CL, a), now = input(CL, b, { ends: 4, walkGates: 1 })
    expect(gatePostsOf(now, changeBaseOf(signedOf(was) as never)).linePosts).toBe(1)
  })

  test('the same change by drawing: 1 line post', () => {
    const d = drawn(CL, yard(40), yard(60, true))
    expect(gatePostsOf(d.now, changeBaseOf({ ...signedOf(d.was) as object, ...d.signed } as never, d.drawing)).linePosts).toBe(1)
  })

  test.each([[[100], [100, 8, 8]], [[100, 50], [100, 50, 12]]])('a gate on a stretch of new fence on a run list, %j to %j: 2 posts, nothing more', (a, b) => {
    const was = input(CL, a), now = input(CL, b, { ends: 6, walkGates: 1 })
    expect(gatePostsOf(now, changeBaseOf(signedOf(was) as never))).toEqual({ ends: 0, linePosts: 0 })
  })

  test('a gate with no change to the fence on a run list: nothing kept', () => {
    const was = input(CL, [100]), now = input(CL, [100], { walkGates: 1, gateWidths: { walk: [6], dbl: [] } })
    expect(gatePostsOf(now, changeBaseOf(signedOf(was) as never)).linePosts).toBe(0)
  })

  test.each([
    [{ walkGates: 1, gateWidths: { walk: [6], dbl: [] } }, [47, 47], 'Add 1 walk gate (6 ft of fence becomes the gate)'],
    [{ walkGates: 1, gateWidths: { walk: [5], dbl: [] } }, [47.5, 47.5], 'Add 1 walk gate (5 ft of fence becomes the gate)'],
    [{ dblGates: 1 }, [46, 46], 'Add 1 double gate (8 ft of fence becomes the gate)'],
    [{ dblGates: 1, gateWidths: { walk: [], dbl: [12] } }, [44, 44], 'Add 1 double gate (12 ft of fence becomes the gate)'],
  ])('the customer\'s words say the gate\'s real width: %j', (extra, runs, words) => {
    const r = both(input(CL, [100]), input(CL, runs as number[], { ends: 4, ...extra as Partial<QuoteCalcInput> }))
    expect(r.lines[0].description).toBe(words)
  })

  test('a 6 ft gate and a shorter fence: "6 ft of it becomes the new gate"', () => {
    const r = both(input(CL, [100]), input(CL, [80], { walkGates: 1, gateWidths: { walk: [6], dbl: [] } }))
    expect(r.lines[0].description).toMatch(/; 6 ft of it becomes the new gate/)
  })

  test('a run cut in two with fence taken out too: one line post, the rest is the removed fence', () => {
    const was = input(CL, [100]), now = input(CL, [38, 38], { ends: 4, walkGates: 1 })
    expect(gatePostsOf(now, changeBaseOf(signedOf(was) as never))).toEqual({ ends: 0, linePosts: 1 })
  })

  test.each([['8ft', 0], ['6ft', 2]] as const)('every run forced to %s: the closed up fence is counted on the same rails (%i kept)', (rail, kept) => {
    const y = (gate: boolean) => { const l = layoutForShape('front'); l.sides = l.sides.map((s, i) => ({ ...s, id: `s${i}`, lengthIn: [30, 40, 30][i] * 12, gate: gate && i === 1 ? { type: 'walk' as const, widthIn: 48, position: 'middle' as const } : null })); return l }
    const d = drawn('WV-Auto ND Privacy', y(false), y(true))
    const forced = (i: QuoteCalcInput) => ({ ...i, runs: i.runs.map(r => ({ ...r, rail })) })
    const base = changeBaseOf({ ...signedOf(forced(d.was)) as object, ...d.signed } as never, d.drawing)
    expect(gatePostsOf(forced(d.now), base).linePosts).toBe(kept)
  })

  test('a skip in the side: each closed up run keeps the rail of its own first piece', () => {
    const skip = { skip: { lengthIn: 120, position: 'distance' as const, distanceIn: 600 } }
    const d = drawn(CL, yard(100, false, skip), yard(100, false, { ...skip, gate: { type: 'walk', widthIn: 48, position: 'distance', distanceIn: 120 } }))
    const drawnBase = changeBaseOf({ ...signedOf(d.was) as object, ...d.signed } as never, d.drawing).drawn!
    expect(d.now.runs.map(r => r.ft)).toEqual([10, 36, 40])
    expect(drawnBase.gateRuns).toEqual([{ ft: 50, from: 0 }, { ft: 40, from: 2 }])
  })

  test('a gate on a stretch of new fence: 2 posts, nothing more', () => {
    const before = layoutForShape('straight')
    before.sides = [{ ...yard(100).sides[0] }]
    const after: YardLayout = { ...before, sides: [before.sides[0], { ...before.sides[0], id: 'b', name: 'New', lengthIn: 12 * 12, gate: { type: 'walk', widthIn: 48, position: 'middle' } }] }
    const d = drawn(CL, before, after)
    const base = changeBaseOf({ ...signedOf(d.was) as object, ...d.signed } as never, d.drawing)
    expect(gatePostsOf(d.now, base)).toEqual({ ends: 0, linePosts: 0 })
  })

  test('a gate at the very end of a side: the drawing counts 1, the price 2', () => {
    const d = drawn(CL, yard(100), yard(100, false, { gate: { type: 'walk', widthIn: 48, position: 'distance', distanceIn: 0 } }))
    const base = changeBaseOf({ ...signedOf(d.was) as object, ...d.signed } as never, d.drawing)
    expect(gatePostsOf(d.now, base).ends).toBe(1)
  })

  test('a double gate: 2 posts, and its blank post as always', () => {
    const was = input(CL, [100]), now = input(CL, [100], { dblGates: 1 })
    expect(gatePostsOf(now, changeBaseOf(signedOf(was) as never))).toEqual({ ends: 2, linePosts: 0 })
  })

  test('a gate taken out, or swapped for another: as it is today', () => {
    const was = input(CL, [46, 46], { ends: 4, walkGates: 1 })
    expect(gatePostsOf(input(CL, [46, 46], { ends: 4 }), changeBaseOf(signedOf(was) as never))).toEqual({ ends: 0, linePosts: 0 })
    expect(gatePostsOf(input(CL, [46, 46], { ends: 4, dblGates: 1 }), changeBaseOf(signedOf(was) as never))).toEqual({ ends: 0, linePosts: 0 })
  })

  test('the crew still gets the real post count', () => {
    const d = drawn(CL, yard(100), yard(100, true))
    expect(postsOn(d.now)).toBe(postsOn(d.was) + 1)
  })
})

describe('the other ways a change order is priced', () => {
  test('picked lines stay as they were: fabric a fraction of a roll, 2 ends, no line post credit', () => {
    const section = calculateQuote({ ...input(CL, [10], { ends: 0, extraLinePosts: 1 }), addedTo: { walkGates: 0, dblGates: 0 } })
    expect(section.materials.items.find(x => /Fabric/.test(x.item))!.qty).toBe(0.2)
    const gate = calculateQuote({ ...input(CL, [], { ends: 2, walkGates: 1 }), addedTo: { walkGates: 0, dblGates: 0 } })
    expect(gate.materials.items.filter(x => /2-1\/2" X/.test(x.item)).reduce((t, x) => t + x.qty, 0)).toBe(2)
  })

  const move = { oldFt: 100, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'ds' as const, newPostCaps: false }
  const common: WorkCommon = { style: styleOf(CL), pricing, overrides: {}, settings: moveRepairSettings({} as never), overheadPct: 30, hasSalesman: false, priceAdjust: 0, extraLaborHrs: 0 }
  const line = (ft: number, walk = 0) => ({ runs: [ft], corners: 0, ends: 2, walkGates: walk, dblGates: 0 })
  test('a move: the extra length\'s fabric by the foot, both ways', () => {
    const fabric = (r: ReturnType<typeof priceMove>) => r.lines.find(l => l.key === 'extra')?.parts?.find(p => /Fabric/.test(p.item))
    expect(fabric(priceMove({ ...common, fabricFromFt: 120 }, move, line(130)))?.qty).toBe(1.2)
    expect(fabric(priceMove({ ...common, fabricFromFt: 120 }, move, line(100)))?.qty).toBe(0.6)
    expect(fabric(priceMove(common, move, line(130)))?.qty).toBe(1)
    const was = input(CL, [120]), now = input(CL, [130])
    // Sold with 20 ft of extra length (1 roll), now 30 ft: 1.2 rolls, where a move quoted new has 1.
    const co = changeOrderPrice(now, changeBaseOf(signedOf(was) as never), { common, inputs: move, line: line(130) })
    expect(co).toBeGreaterThan(priceMove(common, move, line(130)).priceCents / 100)
  })

  test('a move with a gate added and the post count left alone: 2 more new posts priced', () => {
    const was = input(CL, [100]), now = input(CL, [100], { walkGates: 1 })
    const co = changeOrderPrice(now, changeBaseOf(signedOf(was) as never), { common, inputs: move, line: line(100, 1) })
    expect(co).toBeGreaterThan(priceMove(common, move, line(100, 1)).priceCents / 100)
  })

  test('a repair: no change order price of its own, its price is the repair today', () => {
    const req: QuoteJobRequest = {
      fenceStyle: CL, runs: [{ ft: 100, rail: 'auto' }], corners: 0, ends: 2, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
      overrides: {}, jobType: 'repair', repair: { what: 'other', items: { replaceSection: 2 }, postType: 'ds', newPostCaps: false, gateKind: 'walk', debrisCleared: true },
    }
    expect(quoteJobFor(data, { ...req, changeBase: changeBaseOf(signedOf(input(CL, [100])) as never) }).changePrice).toBeNull()
  })
})

/**
 * Jonathan, Nov 2 2026. "A change order adds a gate (2 new posts), a later one
 * takes it out. Today the credit is smaller [...] Answer CREDIT IN FULL or KEEP
 * IT": CREDIT IN FULL. "a job sold in vinyl changed to chain link has no chain
 * link rolls sold [...] FOOT FROM SOLD LENGTH [...] or FULL NEW FABRIC": FULL NEW
 * FABRIC.
 *
 * The target: when a change order brings the fence, gates and style back to a
 * state the job was already in, the contract equals what it was in that state.
 * Taking out what was added nets $0, in any order.
 */
describe('back to a state the job was already in: the contract is what it was then', () => {
  type Work = { input: QuoteCalcInput; yard?: YardLayout | null }
  const stateOfInput = (i: QuoteCalcInput) => ({ fenceStyle: i.style!.name, runs: i.runs.map(r => r.ft), corners: i.corners, ends: i.ends, walkGates: i.walkGates, dblGates: i.dblGates, tearOutSections: 0, tearOutGates: 0 })
  const whole = (i: QuoteCalcInput) => Math.floor(calculateQuote(i).priced.price)
  /** The job through its change orders, each saved as the server hands it to the next. */
  function chain(sold: Work, steps: Work[], opts: { edit?: (d: ReturnType<typeof changeOrderDraft>, n: number) => ReturnType<typeof changeOrderDraft>; status?: (n: number) => string } = {}) {
    const soldQuote = (w: Work, finalPrice: number) => signedOf(w.input, { finalPrice, layout: { yard: w.yard ?? null, ...(w.yard ? {} : w.input.gateWidths ? { gateWidths: w.input.gateWidths } : {}) } }) as never
    const orders: EarlierOrder[] = []
    let contract = whole(sold.input) * 100, cur = sold
    const contracts = [contract], drafts: Array<ReturnType<typeof changeOrderDraft>> = []
    const soldQ = soldQuote(sold, contract / 100)
    for (const next of steps) {
      const n = orders.length + 1
      const st = next.input.style!
      let d = changeOrderDraft({
        signed: soldQuote(cur, contract / 100), current: next.input, signedOverrides: {}, styles: cfg.fenceStyles as never, sectionsNow: calculateQuote(next.input).sections,
        now: next.yard ? { yard: next.yard, nearIn: (st.panelWidth ?? 6) * 12, teeAs: teePostFor(st) } : null, priceNow: 0, simple: false, earlier: { orders: [...orders], sold: soldQ },
      })
      if (opts.edit) d = opts.edit(d, n)
      drafts.push(d)
      const cents = total(d)
      orders.push({ number: n, status: opts.status?.(n) ?? 'approved', approvedAt: `2026-11-02T10:0${n}:00Z`, totalCents: cents, lines: d.lines, scope: d.scope as never, work: { ...stateOfInput(next.input), gateWidths: next.input.gateWidths ?? null, layout: { yard: next.yard ?? null } } })
      contract += cents
      contracts.push(contract)
      cur = next
    }
    return { contracts, drafts, orders }
  }
  /** Every time a state comes back, the contract is what it was. */
  function holds(states: Work[], contracts: number[]) {
    states.forEach((w, i) => { for (let k = 0; k < i; k++) if (JSON.stringify(stateOfInput(w.input)) === JSON.stringify(stateOfInput(states[k].input))) expect(contracts[i], `state ${i} is state ${k}`).toBe(contracts[k]) })
  }
  const listed = (name: string) => ({
    bare: { input: input(name, [100]) },
    gate: { input: input(name, [100], { walkGates: 1 }) },
    two: { input: input(name, [100], { walkGates: 2 }) },
    dbl: { input: input(name, [100], { dblGates: 1 }) },
    split: { input: input(name, [48, 48], { walkGates: 1, ends: 4 }) },
    longer: { input: input(name, [120]) },
    longerGate: { input: input(name, [120], { walkGates: 1 }) },
  })
  const drawnWork = (name: string, y: YardLayout): Work => {
    const st = styleOf(name), d = deriveLayout(y, (st.panelWidth ?? 6) * 12, { teeAs: teePostFor(st) })
    return { yard: y, input: input(name, d.runs.map(r => r.ft), { corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates, gateWidths: d.gateWidthsFt }) }
  }
  const twoSides = (ft: number, a: boolean, b: boolean) => {
    const y = layoutForShape('backyard')
    const gate = (on: boolean) => (on ? { type: 'walk' as const, widthIn: 48, position: 'middle' as const } : null)
    y.sides = y.sides.map((s, i) => ({ ...s, id: `s${i}`, on: i < 2, lengthIn: i < 2 ? ft * 12 : 0, gate: i < 2 ? gate(i ? b : a) : null }))
    return y
  }
  const drawnSet = (name: string) => ({
    bare: drawnWork(name, yard(100)),
    gate: drawnWork(name, yard(100, true)),
    longer: drawnWork(name, yard(120)),
    longerGate: drawnWork(name, yard(120, true)),
  })

  describe.each([['vinyl', VINYL], ['chain link', CL]] as const)('%s', (_w, name) => {
    test('by run list: chains ending at each earlier state', () => {
      const s = listed(name)
      for (const path of [
        [s.bare, s.gate, s.bare], [s.bare, s.split, s.bare], [s.bare, s.two, s.gate, s.bare], [s.bare, s.gate, s.two, s.gate, s.bare],
        [s.bare, s.gate, s.longerGate, s.gate, s.bare], [s.bare, s.longer, s.longerGate, s.longer, s.bare], [s.bare, s.gate, s.dbl, s.bare], [s.gate, s.two, s.gate],
        [s.gate, s.bare, s.gate], [s.bare, s.gate, s.bare, s.gate, s.bare],
      ]) {
        const { contracts } = chain(path[0], path.slice(1))
        holds(path, contracts)
      }
    })
    test('by drawing: chains ending at each earlier state', () => {
      const s = drawnSet(name)
      for (const path of [
        [s.bare, s.gate, s.bare], [s.bare, s.gate, s.longerGate, s.gate, s.bare], [s.bare, s.longer, s.longerGate, s.longer, s.bare], [s.bare, s.gate, s.bare, s.gate, s.bare],
      ]) {
        const { contracts } = chain(path[0], path.slice(1))
        holds(path, contracts)
      }
    })
    test('taking out what was added nets $0 in any order: a gate, then more fence, then the gate out', () => {
      for (const s of [listed(name), drawnSet(name)]) {
        // Each step is whole dollars, so a chain can land a dollar from the short way there.
        const { contracts } = chain(s.bare, [s.gate, s.longerGate, s.longer])
        expect(Math.abs(contracts[3] - chain(s.bare, [s.longer]).contracts[1])).toBeLessThanOrEqual(100)
      }
    })
    test('two gates on one change order, out one at a time: 1 left is the state with one gate, 0 left is the sold job', () => {
      const s = listed(name)
      const one = chain(s.bare, [s.gate]).contracts[1]
      const { contracts, drafts } = chain(s.bare, [s.two, s.gate, s.bare])
      expect(contracts[2]).toBe(one)
      expect(contracts[3]).toBe(contracts[0])
      expect(drafts[1].lines[0].description).toBe('Remove 1 walk gate')
      const d = (a: boolean, b: boolean) => drawnWork(name, twoSides(50, a, b))
      const drawnOne = chain(d(false, false), [d(true, false)]).contracts[1]
      const both = chain(d(false, false), [d(true, true), d(true, false), d(false, false)])
      expect(both.contracts[2]).toBe(drawnOne)
      expect(both.contracts[3]).toBe(both.contracts[0])
    })
    test('sold with a gate, another added and taken out: same kind, count back, which one went doesn\'t matter', () => {
      const s = listed(name)
      const { contracts } = chain(s.gate, [s.two, s.gate])
      expect(contracts[2]).toBe(contracts[0])
    })
    test('walk swapped for double, then taken out', () => {
      const s = listed(name)
      expect(chain(s.bare, [s.gate, s.dbl, s.bare]).contracts[3]).toBe(whole(s.bare.input) * 100)
    })
    test('the words of a line retyped change nothing', () => {
      const s = listed(name)
      const { contracts } = chain(s.bare, [s.gate, s.bare], { edit: (d, n) => (n === 1 ? { ...d, lines: d.lines.map(l => ({ ...l, description: 'Walk gate on the back line' })) } : d) })
      expect(contracts[2]).toBe(contracts[0])
    })
    test('a price typed by hand, or a cost change since: back at the state, the contract is what it was', () => {
      const s = listed(name)
      expect(chain(s.bare, [s.gate, s.bare], { edit: (d, n) => (n === 1 ? { ...d, lines: d.lines.map(l => ({ ...l, amountCents: 29900 })) } : d) }).contracts[2]).toBe(whole(s.bare.input) * 100)
      const dear = (w: Work): Work => ({ input: { ...w.input, pricing: { ...pricing, manHourRate: 40 } } })
      expect(chain(s.bare, [s.gate]).contracts[0]).toBe(chain(s.bare, [s.gate, dear(s.bare)]).contracts[2])
    })
  })

  describe('the second review (Nov 2 2026)', () => {
    const lineOf = (d: ReturnType<typeof changeOrderDraft>) => d.lines.map(l => `${l.description} ${l.amountCents / 100}`).join(' | ')
    const draftFrom = (was: QuoteCalcInput, now: QuoteCalcInput, earlier: Parameters<typeof changeOrderDraft>[0]['earlier']) => changeOrderDraft({ signed: signedOf(was) as never, current: now, signedOverrides: {}, styles: cfg.fenceStyles as never, sectionsNow: calculateQuote(now).sections, now: null, priceNow: 0, simple: false, earlier })

    test.each([[1, 2], [2, 1]])('both signing orders: gate on CO-1, fence on CO-2, signed %i then %i, the gate comes off at what it charged', (first) => {
      const s = listed(CL)
      const a = chain(s.bare, [s.gate]).contracts, gateCents = a[1] - a[0]
      const fence = chain(s.bare, [s.longer]).contracts, fenceCents = fence[1] - fence[0]
      const order = (n: number) => (n === first ? '2026-11-02T10:00:00Z' : '2026-11-02T11:00:00Z')
      const orders: EarlierOrder[] = [
        { number: 1, status: 'approved', approvedAt: order(1), totalCents: gateCents, scope: { walkGates: 1 }, work: stateOfInput(s.gate.input) },
        { number: 2, status: 'approved', approvedAt: order(2), totalCents: fenceCents, scope: { footageFt: 20 }, work: stateOfInput(s.longerGate.input) },
      ]
      const first2 = first === 1 ? s.gate.input : s.longer.input
      const states = [...(first === 1 ? [{ number: 1, state: stateOfInput(first2) }, { number: 2, state: stateOfInput(s.longerGate.input) }] : [{ number: 2, state: stateOfInput(first2) }, { number: 1, state: stateOfInput(s.longerGate.input) }])]
      const d = draftFrom(s.longerGate.input, s.longer.input, { orders, states, sold: signedOf(s.bare.input) as never })
      if (first === 2) expect(total(d)).toBe(-gateCents)
      else expect(total(d)).toBeLessThan(0)
      expect(lineOf(d)).toMatch(/^Remove 1 walk gate/)
    })
    test.each([[VINYL], [CL]])('without the server\'s fold, signing order still decides (%s)', name => {
      const s = listed(name)
      const a = chain(s.bare, [s.gate]).contracts[1] - chain(s.bare, [s.gate]).contracts[0]
      const orders: EarlierOrder[] = [
        { number: 1, status: 'approved', approvedAt: '2026-11-02T11:00:00Z', totalCents: a, scope: { walkGates: 1 }, work: stateOfInput(s.gate.input), jobWork: stateOfInput(s.longerGate.input) },
        { number: 2, status: 'approved', approvedAt: '2026-11-02T10:00:00Z', totalCents: 43100, scope: { footageFt: 20 }, work: stateOfInput(s.longerGate.input), jobWork: stateOfInput(s.longer.input) },
      ]
      expect(total(draftFrom(s.longerGate.input, s.longer.input, { orders, sold: signedOf(s.bare.input) as never }))).toBe(-a)
    })
    test('a typed line inside the gate\'s change order stays on the contract', () => {
      const s = listed(CL)
      const { contracts } = chain(s.bare, [s.gate, s.bare], { edit: (d, n) => (n === 1 ? { ...d, lines: [...d.lines, { id: 'typed', description: 'Haul off old debris', amountCents: 15000 }] } : d) })
      expect(contracts[2]).toBe(contracts[0] + 15000)
    })
    test('a gate back at another width is that gate\'s price', () => {
      for (const [out, w] of [[{ walk: [4], dbl: [] }, { walk: [6], dbl: [] }], [{ walk: [], dbl: [8] }, { walk: [], dbl: [12] }]] as const) {
        const mk = (g: { walk: readonly number[]; dbl: readonly number[] }) => ({ input: input(CL, [100], { walkGates: g.walk.length, dblGates: g.dbl.length, gateWidths: { walk: [...g.walk], dbl: [...g.dbl] } }) })
        const bare = { input: input(CL, [100]) }
        const wide = chain(bare, [mk(w)]).contracts
        const c = chain(bare, [mk(out), bare, mk(w)]).contracts
        expect(c[3]).toBe(wide[1])
      }
    })
    test('credited more than it was charged, on a state the job was never in: both figures, and nothing false', () => {
      const s = listed(CL)
      const typed = chain(s.bare, [s.gate, { input: input(CL, [120], { walkGates: 1 }) }, s.longer], { edit: (d, n) => (n === 1 ? { ...d, lines: d.lines.map(l => ({ ...l, amountCents: 30000 })) } : d) })
      expect(typed.drafts[2].warnings?.[0]).toMatch(/^CO-1 charged \$300 for this gate, and the same change is \$[\d,]+ at today's prices\. This change order credits \$[\d,]+\. Change the amount if it should be less\.$/)
      const fair = chain(s.bare, [s.gate, { input: input(CL, [120], { walkGates: 1 }) }, s.longer])
      expect(fair.drafts[2].warnings).toBeUndefined()
    })
    test('the gate box warning on two runs names the run', () => {
      const bare = { input: input(CL, [100, 50], { corners: 1 }) }, gate = { input: input(CL, [96, 50], { corners: 1, walkGates: 1 }) }, left = { input: input(CL, [96, 50], { corners: 1 }) }
      expect(chain(bare, [gate, left]).drafts[1].warnings?.[0]).toMatch(/If that fence goes back in, type 100 ft in Run 1 and make the change order again\.$/)
    })
    test('the gate box warning gives the run as it is now plus the gate\'s opening, never the sold length', () => {
      const one = (ft: number, walkGates = 0) => ({ input: input(CL, [ft], { walkGates }) })
      expect(chain(one(100), [one(96, 1), one(116, 1), one(116)]).drafts[2].warnings?.[0]).toMatch(/type 120 ft on the run list/)
      const two = (a: number, walkGates = 0) => ({ input: input(CL, [a, 50], { corners: 1, walkGates }) })
      expect(chain(two(60), [two(56, 1), two(66, 1), two(66)]).drafts[2].warnings?.[0]).toMatch(/type 70 ft in Run 1/)
    })
    test.each([[VINYL], [CL]])('no word about the charge on a longer fence, where the higher credit is right (%s)', name => {
      const no = yard(100), gate = yard(100, true), long = yard(120, true), plain = yard(120)
      const w = (y: YardLayout) => drawnWork(name, y)
      const d = chain(w(no), [w(gate), w(long), w(plain)]).drafts[2]
      expect(d.warnings).toBeUndefined()
    })
    test('walk swapped for a double, more fence, the double out: nothing false about whose charge, and by kind', () => {
      const s = listed(CL), dbl20 = { input: input(CL, [120], { dblGates: 1 }) }
      const plainRun = chain(s.bare, [s.gate, s.dbl, dbl20, s.longer])
      expect(plainRun.drafts[3].warnings).toBeUndefined()
      expect(plainRun.contracts[4]).toBe(chain(s.bare, [s.longer]).contracts[1])
      const typed = chain(s.bare, [s.gate, s.dbl, dbl20, s.longer], { edit: (d, n) => (n === 2 ? { ...d, lines: d.lines.map(l => (/double/.test(l.description) ? { ...l, amountCents: l.amountCents - 20000 } : l)) } : d) })
      expect(typed.drafts[3].warnings?.[0]).toMatch(/^CO-1 and CO-2 charged \$/)
    })
    test('a cost change since: the same warning, and only for what it is', () => {
      const s = listed(CL), dear = (w: Work): Work => ({ input: { ...w.input, pricing: { ...pricing, subWalkGate: 90 } } })
      const d = chain(s.bare, [s.gate, dear({ input: input(CL, [120], { walkGates: 1 }) }), dear(s.longer)]).drafts[2]
      expect(d.warnings?.[0]).toMatch(/^CO-1 charged \$\d+ for this gate, and the same change is \$\d+ at today's prices\./)
    })
    test('a gate going as the fence grows: the feet a customer can check, the gate\'s said apart', () => {
      const d = drawnWork(CL, yard(40, true)), longer = drawnWork(CL, yard(50))
      const { drafts } = chain(drawnWork(CL, yard(40)), [d, longer])
      expect(drafts[1].lines.map(l => l.description).join(' ')).toMatch(/^Add 10 ft of fence.*the 4 ft where the gate was goes back to fence too/)
      const run = chain({ input: input(CL, [100]) }, [{ input: input(CL, [96], { walkGates: 1 }) }, { input: input(CL, [104]) }]).drafts[1]
      expect(run.lines.map(l => l.description).join(' ')).toMatch(/^Add 4 ft of fence.*\(100 ft to 104 ft; the 4 ft where the gate was goes back to fence too\)/)
      expect(run.scope?.footageFt).toBe(8)
    })
    test('plain chains match the price of the step on its own: the gate kept, footage after', () => {
      const s = listed(CL)
      const one = chain(s.bare, [s.gate]).contracts[1], both = chain(s.bare, [s.gate, s.longerGate]).contracts[2]
      const plain = chain(s.gate, [s.longerGate]).contracts
      expect(both - one).toBe(plain[1] - plain[0])
    })
  })

  test('a style change between: the gate comes off at the new style\'s price, and the job is what a new quote for it is', () => {
    for (const [from, to] of [[VINYL, CL], [CL, VINYL]]) {
      const a = listed(from), b = listed(to)
      const { contracts } = chain(a.bare, [a.gate, b.gate, b.bare])
      expect(Math.abs(contracts[3] - whole(b.bare.input) * 100)).toBeLessThanOrEqual(100)
      const x = drawnSet(from), y = drawnSet(to)
      // The gate's 4 ft of fence back after the switch: chain link by the foot (Oct 31), 0.08 of a roll over a new quote's 2.
      const drawnC = chain(x.bare, [x.gate, y.gate, y.bare]).contracts
      expect(Math.abs(drawnC[3] - whole(y.bare.input) * 100)).toBeLessThanOrEqual(2000)
    }
    // Out and back the whole way: vinyl, gate, chain link, vinyl, no gate.
    const v = listed(VINYL), c = listed(CL)
    const path = [v.bare, v.gate, c.gate, v.gate, v.bare]
    holds(path, chain(path[0], path.slice(1)).contracts)
  })

  test('typed lines stay on the contract: they changed no state', () => {
    const s = listed(CL)
    const { orders, contracts } = chain(s.bare, [s.gate])
    orders.push({ number: 2, status: 'approved', totalCents: 20000, scope: null, work: null })
    const d = changeOrderDraft({ signed: signedOf(s.gate.input, { finalPrice: contracts[1] / 100 + 200 }) as never, current: s.bare.input, signedOverrides: {}, styles: cfg.fenceStyles as never, sectionsNow: 0, now: null, priceNow: 0, simple: false, earlier: { orders, sold: signedOf(s.bare.input) as never } })
    expect(total(d)).toBe(contracts[0] - contracts[1])
  })

  describe('said on screen, never on a line', () => {
    const line = (d: ReturnType<typeof changeOrderDraft>) => d.lines.map(l => l.description).join(' ')
    test('a run list with the gate box changed and the opening left out: 96 ft is its price, and the person is told the 4 ft of fence', () => {
      for (const name of [VINYL, CL]) {
        const bare = { input: input(name, [100]) }, gate = { input: input(name, [96], { walkGates: 1 }) }, left = { input: input(name, [96]) }
        const { drafts, contracts } = chain(bare, [gate, left])
        expect(drafts[1].warnings?.join(' ')).toBe('The gate took 4 ft out of the fence, and this leaves the fence at 96 ft with a 4 ft gap. If that fence goes back in, type 100 ft on the run list and make the change order again.')
        expect(contracts[2]).toBe(chain(bare, [left]).contracts[1])
        const back = chain(bare, [gate, bare])
        expect(back.drafts[1].warnings).toBeUndefined()
        expect(back.contracts[2]).toBe(back.contracts[0])
      }
    })
    test('a change order not signed yet: no line says it was charged, and the person is told', () => {
      const s = listed(CL)
      const { drafts } = chain(s.bare, [s.gate, s.bare], { status: () => 'sent' })
      expect(line(drafts[1])).not.toMatch(/CO-|charge/)
      expect(drafts[1].warnings?.[0]).toBe('CO-1 is not signed yet. This credit only stands if CO-1 is signed. If the customer no longer wants the gate, void CO-1 instead of making this change order.')
    })
    test('voided after: the later credit stands alone, and whoever voids it is told', () => {
      expect(creditAfterVoid({ number: 1, scope: { walkGates: 1 } }, [{ number: 1, status: 'void', scope: { walkGates: 1 } }, { number: 2, status: 'approved', scope: { walkGates: -1 } }]))
        .toBe('CO-2 credits a gate CO-1 added, and CO-1 is void now, so the customer was never charged for it. Void CO-2 too.')
      expect(creditAfterVoid({ number: 1, scope: { footageFt: 10 } }, [{ number: 2, status: 'approved', scope: { walkGates: -1 } }])).toBeNull()
      expect(creditAfterVoid({ number: 1, scope: { walkGates: 1 } }, [{ number: 2, status: 'void', scope: { walkGates: -1 } }])).toBeNull()
    })
    test('a void change order, and any state carrying its work, is no state of the job: the gate added again is charged', () => {
      const s = listed(CL)
      const one = chain(s.bare, [s.gate]).contracts
      const orders: EarlierOrder[] = [{ number: 1, status: 'void', totalCents: one[1] - one[0], scope: { walkGates: 1 }, work: stateOfInput(s.gate.input) }, { number: 2, status: 'sent', totalCents: 0, scope: { footageFt: 0 }, work: stateOfInput(s.gate.input) }]
      const d = changeOrderDraft({ signed: signedOf(s.bare.input) as never, current: s.gate.input, signedOverrides: {}, styles: cfg.fenceStyles as never, sectionsNow: 0, now: null, priceNow: 0, simple: false, earlier: { orders, states: [{ number: 2, state: stateOfInput(s.bare.input) }], sold: signedOf(s.bare.input) as never } })
      expect(total(d)).toBe(one[1] - one[0])
    })
    test('never a $0 gate: with nothing to undo the price stands', () => {
      const s = listed(CL), one = chain(s.bare, [s.gate]).contracts
      const orders: EarlierOrder[] = [{ number: 1, status: 'approved', totalCents: 0, scope: {}, work: stateOfInput(s.gate.input) }]
      const d = changeOrderDraft({ signed: signedOf(s.bare.input) as never, current: s.gate.input, signedOverrides: {}, styles: cfg.fenceStyles as never, sectionsNow: 0, now: null, priceNow: 0, simple: false, earlier: { orders, states: [{ number: 1, state: stateOfInput(s.bare.input) }], sold: signedOf(s.gate.input) as never } })
      expect(total(d)).toBe(one[1] - one[0])
    })
    test('not back at a state: the gate comes off at its price on the fence as it is, nothing to warn about', () => {
      const s = listed(CL), more = { input: input(CL, [130], { walkGates: 1 }) }, less = { input: input(CL, [130]) }
      const { drafts, contracts } = chain(s.longer, [s.longerGate, more, less])
      expect(drafts[2].warnings).toBeUndefined()
      expect(Math.abs(contracts[3] - chain(s.longer, [less]).contracts[1])).toBeLessThanOrEqual(100)
    })
  })

  test('the one price difference line nets within the rounding by itself: the contract holds the charge', () => {
    const was = input(CL, [100]), gate = input(CL, [100], { walkGates: 1 })
    const original = changeBaseOf(signedOf(was) as never)
    const co1 = Math.floor(changeOrderPrice(gate, original)) - Math.floor(calculateQuote(was).priced.price)
    const contract = { finalPrice: Math.floor(calculateQuote(was).priced.price) + co1 }
    const line = changeOrderDraft({ signed: signedOf(gate, contract), current: was, signedOverrides: {}, styles: cfg.fenceStyles as never, sectionsNow: 0, now: null, priceNow: changeOrderPrice(was, original), simple: true })
    expect(Math.abs(total(line) + co1 * 100)).toBeLessThanOrEqual(100)
  })
})

describe('a job sold in another style changed to chain link: full new fabric', () => {
  const draft = (was: QuoteCalcInput, now: QuoteCalcInput) => changeOrderDraft({ signed: signedOf(was), current: now, signedOverrides: {}, styles: cfg.fenceStyles as never, sectionsNow: calculateQuote(now).sections, now: null, priceNow: 0, simple: false })
  const wholeRolls = (now: QuoteCalcInput) => fabricOf(now)[0].qty
  const reqOf = (i: QuoteCalcInput): QuoteJobRequest => ({
    fenceStyle: i.style!.name, runs: i.runs, corners: i.corners, ends: i.ends, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {}, jobType: 'new',
  })

  test('whole rolls for all its feet, as a new fence, not the sold length then by the foot', () => {
    const was = input(VINYL, [100]), now = input(CL, [110])
    const base = changeBaseOf(signedOf(was) as never, null, styleOf(VINYL))
    expect(base.feet).toBeNull()
    expect(fabricOf(changeOrderInput(now, base))[0].qty).toBe(3)
    const before = fabricOf(changeOrderInput(now, changeBaseOf(signedOf(was) as never)))[0].qty
    expect(before).toBe(2.2)
    expect(wholeRolls(now)).toBe(3)
  })

  test('the change order bills 0.8 of a roll more than before; the same on the one line', () => {
    const was = input(VINYL, [100]), now = input(CL, [110])
    const steps = total(draft(was, now))
    const one = changeOrderPrice(now, changeBaseOf(signedOf(was) as never, null, styleOf(VINYL)))
    expect(Math.abs(steps - (Math.floor(one) - Math.floor(calculateQuote(was).priced.price)) * 100)).toBeLessThanOrEqual(100)
    expect(one).toBe(calculateQuote({ ...now }).priced.price)
    expect(one).toBeGreaterThan(changeOrderPrice(now, changeBaseOf(signedOf(was) as never)))
  })

  test('the same length: 2 rolls either way; aluminum too', () => {
    expect(fabricOf(changeOrderInput(input(CL, [100]), changeBaseOf(signedOf(input(VINYL, [100])) as never, null, styleOf(VINYL))))[0].qty).toBe(2)
    expect(fabricOf(changeOrderInput(input(CL, [75]), changeBaseOf(signedOf(input(ALUM, [100])) as never, null, styleOf(ALUM))))[0].qty).toBe(2)
  })

  test('a job already chain link keeps moving by the foot, a second change after the switch too; so does another chain link (today, a question)', () => {
    expect(fabricOf(changeOrderInput(input(CL, [110]), changeBaseOf(signedOf(input(CL, [100])) as never, null, styleOf(CL))))[0].qty).toBe(2.2)
    expect(fabricOf(changeOrderInput(input(BLACK, [110]), changeBaseOf(signedOf(input(CL, [100])) as never, null, styleOf(CL))))[0].qty).toBe(2.2)
  })

  test('the server\'s price: no fabric sold, whole rolls', () => {
    const co = quoteJobFor(data, { ...reqOf(input(CL, [110])), changeBase: changeBaseOf(signedOf(input(VINYL, [100])) as never, null, styleOf(VINYL)) })
    expect(co.changePrice).toBe(quoteJobFor(data, reqOf(input(CL, [110]))).totals.price)
  })

  test('the pull sheet is whole rolls as ever', () => {
    expect(fabricOf(input(CL, [110]))[0].qty).toBe(3)
  })
})
