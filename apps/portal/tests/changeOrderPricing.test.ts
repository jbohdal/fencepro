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
import { changeBaseOf, changeOrderInput, changeOrderPrice, gateCharges, gatePostsOf, type EarlierOrder } from '../../web/src/changeOrderPricing'
import { ownGateSides } from '../src/server/lib/changeOrderMerge'
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
 */
describe('a gate an earlier change order added, taken out by a later one: credited in full', () => {
  const draftOf = (was: QuoteCalcInput, now: QuoteCalcInput, opts: { drawing?: Parameters<typeof changeOrderDraft>[0]['now']; signed?: Record<string, unknown>; orders?: EarlierOrder[]; sold?: QuoteCalcInput } = {}) =>
    changeOrderDraft({
      signed: signedOf(was, opts.signed), current: now, signedOverrides: {}, styles: cfg.fenceStyles as never, sectionsNow: calculateQuote(now).sections, now: opts.drawing ?? null, priceNow: 0, simple: false,
      earlier: opts.orders ? { orders: opts.orders, sold: opts.sold ?? { walkGates: 0, dblGates: 0 } as never } : null,
    })
  /** A change order as the server's view hands it to the next one. */
  const saved = (number: number, d: ReturnType<typeof changeOrderDraft>, yards?: { base: YardLayout; work: YardLayout }, extra: Partial<EarlierOrder> = {}): EarlierOrder => ({
    number, status: 'approved', lines: d.lines, scope: d.scope as never, work: {},
    gateSides: yards ? ownGateSides({ base: { layout: { yard: yards.base } }, layout: { yard: yards.work } }) : null, ...extra,
  })
  /** The fence with the gate, drawn, in and back out: CO-1's and CO-2's lines. */
  function drawnRound(name: string, ft: number, gate: () => YardLayout['sides'][number]['gate'] = () => ({ type: 'walk', widthIn: 48, position: 'middle' }), length = ft) {
    const no = yard(ft), yes = yard(length)
    yes.sides[0] = { ...yes.sides[0], gate: gate() }
    const a = drawn(name, no, yes)
    const co1 = draftOf(a.was, a.now, { drawing: a.drawing, signed: a.signed })
    const b = drawn(name, yes, no)
    const co2 = draftOf(b.was, b.now, { drawing: b.drawing, signed: b.signed, orders: [saved(1, co1, { base: no, work: yes })] })
    return { co1, co2, b }
  }

  test.each([CL, VINYL] as const)('a gate drawn into a side and taken out nets $0 (%s), at every length', name => {
    for (const ft of [60, 72, 100, 110, 133]) {
      const { co1, co2 } = drawnRound(name, ft)
      expect(total(co1)).toBeGreaterThan(0)
      expect(total(co2) + total(co1)).toBe(0)
      expect(co2.lines).toHaveLength(1)
      expect(co2.lines[0].description).toMatch(/^Remove 1 walk gate.*: the full CO-1 charge back \(4 ft of fence goes back in\)$/)
      expect(co2.scope).toMatchObject({ walkGates: -1, footageFt: 4 })
    }
  })

  test('the figures before: the credit was $33 short on chain link, and the same fence on vinyl', () => {
    for (const [name, short] of [[CL, 33], [VINYL, 121]] as const) {
      const { co1, co2, b } = drawnRound(name, 100)
      const old = draftOf(b.was, b.now, { drawing: b.drawing, signed: b.signed })
      expect(total(co1) + total(old)).toBe(short * 100)
      expect(total(co1) + total(co2)).toBe(0)
    }
  })

  test('a double gate, and a gate at a side\'s end', () => {
    const dbl = drawnRound(CL, 100, () => ({ type: 'double', widthIn: 120, position: 'middle' }))
    expect(total(dbl.co1) + total(dbl.co2)).toBe(0)
    expect(dbl.co2.lines[0].description).toMatch(/^Remove 1 double gate/)
    const end = drawnRound(VINYL, 72, () => ({ type: 'walk', widthIn: 48, position: 'left' }))
    expect(total(end.co1) + total(end.co2)).toBe(0)
  })

  test('a run list: a gate typed with no change to the runs, and one that split a run', () => {
    for (const name of [CL, VINYL]) {
      const was = input(name, [100]), typed = input(name, [100], { walkGates: 1 })
      const co1 = draftOf(was, typed)
      const co2 = draftOf(typed, was, { orders: [saved(1, co1)] })
      expect(total(co1) + total(co2)).toBe(0)
      expect(co2.lines[0].description).toBe('Remove 1 walk gate: the full CO-1 charge back')
      const split = input(name, [48, 48], { walkGates: 1, ends: 4 })
      const a = draftOf(was, split)
      const b = draftOf(split, was, { orders: [saved(1, a)] })
      expect(total(a) + total(b)).toBe(0)
      expect(b.lines).toHaveLength(1)
    }
  })

  test('end posts typed with the gate are not credited twice', () => {
    const was = input(CL, [100]), typed = input(CL, [100], { walkGates: 1, ends: 4 })
    const co1 = draftOf(was, typed)
    expect(total(co1) + total(draftOf(typed, was, { orders: [saved(1, co1)] }))).toBe(0)
  })

  test('a picked gate: the credit is its picked line, whatever the amount', () => {
    const was = input(CL, [100]), picked = input(CL, [100], { walkGates: 1 })
    const co1: EarlierOrder = { number: 1, status: 'approved', scope: { walkGates: 1 }, work: {}, gateSides: null, lines: [{ description: 'Add a 5 ft walk gate', amountCents: 41200, qty: 1, source: { ref: 'add:walk:5' } }] }
    expect(total(draftOf(picked, was, { orders: [co1] }))).toBe(-41200)
  })

  test('what it really charged: a cost change since, or a price typed by hand, still nets $0', () => {
    const was = input(CL, [100]), typed = input(CL, [100], { walkGates: 1 })
    const co1 = draftOf(was, typed)
    const edited = { ...co1, lines: co1.lines.map(l => ({ ...l, amountCents: 29900 })) }
    expect(total(draftOf(typed, was, { orders: [saved(1, edited)] }))).toBe(-29900)
    const dearer = { ...pricing, tearOutFence: 13.5, manHourRate: 40 }
    const later = (i: QuoteCalcInput) => ({ ...i, pricing: dearer })
    expect(total(draftOf(later(typed), later(was), { orders: [saved(1, co1)] }))).toBe(-total(co1))
  })

  test('the rest of the change is priced from the fence before the gate', () => {
    // CO-2 takes the gate out and adds 12 ft to the same side: the credit, then those 12 ft alone.
    const no = yard(100), yes = yard(100, true), longer = yard(112)
    const a = drawn(VINYL, no, yes)
    const co1 = draftOf(a.was, a.now, { drawing: a.drawing, signed: a.signed })
    const b = drawn(VINYL, yes, longer)
    const co2 = draftOf(b.was, b.now, { drawing: b.drawing, signed: b.signed, orders: [saved(1, co1, { base: no, work: yes })] })
    expect(co2.lines[0].amountCents).toBe(-total(co1))
    const alone = draftOf(drawn(VINYL, no, longer).was, drawn(VINYL, no, longer).now, { drawing: drawn(VINYL, no, longer).drawing, signed: { layout: { yard: no } } })
    expect(total(co2) + total(co1)).toBe(total(alone))
    // The other way: fence lengthened with the gate, whose opening stays off its charge and is billed as fence.
    const bigger = yard(110, true), plain = yard(110)
    const c = drawn(VINYL, no, bigger)
    const co1b = draftOf(c.was, c.now, { drawing: c.drawing, signed: c.signed })
    expect(co1b.lines.length).toBeGreaterThan(1)
    const gateLine = co1b.lines.find(l => /^Add 1 walk gate/.test(l.description))!
    const d = drawn(VINYL, bigger, plain)
    const co2b = draftOf(d.was, d.now, { drawing: d.drawing, signed: d.signed, orders: [saved(1, co1b, { base: no, work: bigger })] })
    expect(co2b.lines[0].amountCents).toBe(-gateLine.amountCents)
    expect(co2b.lines[1].description).toMatch(/^Add 4 ft of fence/)
  })

  test('two gates added on one change order and both taken out; the second of two change orders', () => {
    const was = input(CL, [100]), two = input(CL, [100], { walkGates: 2 }), one = input(CL, [100], { walkGates: 1 })
    const co1 = draftOf(was, two)
    expect(total(co1) + total(draftOf(two, was, { orders: [saved(1, co1)] }))).toBe(0)
    const first = draftOf(was, one), second = draftOf(one, two)
    expect(total(first) + total(second) + total(draftOf(two, was, { orders: [saved(1, first), saved(2, second)] }))).toBe(0)
  })

  test('a gate taken out, put back and taken out again: the credit is the last charge, once', () => {
    const was = input(CL, [100]), gate = input(CL, [100], { walkGates: 1 })
    const co1 = saved(1, draftOf(was, gate))
    const co2 = saved(2, draftOf(gate, was, { orders: [co1] }))
    const back = draftOf(was, gate, { orders: [co1, co2] })
    const co3 = saved(3, { ...back, lines: back.lines.map(l => ({ ...l, amountCents: 30000 })) })
    expect(gateCharges([co1, co2, co3]).map(c => c.number)).toEqual([3])
    expect(total(draftOf(gate, was, { orders: [co1, co2, co3] }))).toBe(-30000)
  })

  test('a gate changed since it was added has lost its charge (today, a question)', () => {
    const no = yard(100), walk = yard(100, true), dbl = yard(100)
    dbl.sides[0] = { ...dbl.sides[0], gate: { type: 'double', widthIn: 120, position: 'middle' } }
    const a = drawn(CL, no, walk)
    const co1 = saved(1, draftOf(a.was, a.now, { drawing: a.drawing, signed: a.signed }), { base: no, work: walk })
    const co2 = saved(2, { lines: [], scope: {}, reason: '' }, { base: walk, work: dbl })
    expect(co2.gateSides).toEqual({ added: [], removed: ['a'] })
    expect(gateCharges([co1, co2])).toEqual([])
  })

  test('void change orders charge nothing; an open one is in the drawing and counts', () => {
    const was = input(CL, [100]), gate = input(CL, [100], { walkGates: 1 })
    const co1 = draftOf(was, gate)
    expect(gateCharges([saved(1, co1, undefined, { status: 'void' })])).toEqual([])
    expect(gateCharges([saved(1, co1, undefined, { status: 'sent' })])).toHaveLength(1)
  })

  describe('kept as it prices today (questions for Jonathan)', () => {
    const today = (was: QuoteCalcInput, now: QuoteCalcInput, o: Parameters<typeof draftOf>[2]) => {
      const { orders: _o, sold: _s, ...rest } = o!; void _o; void _s
      expect(total(draftOf(was, now, o))).toBe(total(draftOf(was, now, rest)))
    }
    test('a gate of the sold job', () => {
      const yes = yard(100, true), no = yard(100)
      const b = drawn(CL, yes, no)
      today(b.was, b.now, { drawing: b.drawing, signed: b.signed, orders: [] })
      const sold = input(CL, [100], { walkGates: 1 })
      today(sold, input(CL, [100]), { orders: [], sold })
    })
    test('a run list on a job sold with a gate of that kind: which one went?', () => {
      const sold = input(CL, [100], { walkGates: 1 }), two = input(CL, [100], { walkGates: 2 })
      today(two, sold, { orders: [saved(1, draftOf(sold, two))], sold })
    })
    test('one of two gates charged on one line', () => {
      const was = input(CL, [100]), two = input(CL, [100], { walkGates: 2 }), one = input(CL, [100], { walkGates: 1 })
      today(two, one, { orders: [saved(1, draftOf(was, two))] })
    })
    test('a gate swapped for another, or moved', () => {
      const was = input(CL, [100]), walk = input(CL, [100], { walkGates: 1 })
      today(walk, input(CL, [100], { dblGates: 1 }), { orders: [saved(1, draftOf(was, walk))] })
    })
    test('a charge that can\'t be read: a line retyped, or typed lines with no work', () => {
      const was = input(CL, [100]), walk = input(CL, [100], { walkGates: 1 })
      const co1 = draftOf(was, walk)
      today(walk, was, { orders: [saved(1, { ...co1, lines: co1.lines.map(l => ({ ...l, description: 'Gate at the back' })) })] })
      today(walk, was, { orders: [saved(1, co1, undefined, { work: null })] })
    })
    test('a run list with its fence changed beyond the opening', () => {
      const was = input(CL, [100]), split = input(CL, [48, 48], { walkGates: 1, ends: 4 })
      today(split, input(CL, [130]), { orders: [saved(1, draftOf(was, split))] })
    })
  })

  test('the one price difference line credits in full by itself: the contract holds the charge', () => {
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
