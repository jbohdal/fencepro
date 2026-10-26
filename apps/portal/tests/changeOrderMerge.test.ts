/**
 * Two drawing change orders on one job (round 3 walkthrough, Oct 26 2026):
 * signed in any order, the job keeps both changes (lib/changeOrderMerge.ts).
 * The yard is WT3 Robert Hayes's on the dev copy: 4 ft chain link dig set,
 * Left return 10 ft with a walk gate, Left side 50, Back 50, Right side 50
 * with a double gate, Right return 10 (156 ft). CO-1 makes the Back 60 ft,
 * CO-2 puts a walk gate in the Left side.
 */
import { describe, test, expect } from 'vitest'
import { applyChange, foldChanges, shapeOf, sameShape, mergeYard, clashes, type WorkShape } from '../src/server/lib/changeOrderMerge'
import { deriveRunsFor } from '../../web/src/changeOrderYard'

const STYLE = 'chain/4/galv/res/ds'
const derive = (yard: any, style: string) => deriveRunsFor([{ name: STYLE, category: 'Chainlink', panelWidth: 10 }], yard, style)

const side = (id: string, name: string, lengthIn: number, gate: any = null, start = 'corner', end = 'corner') =>
  ({ id, on: true, gate, name, skip: null, heading: 0, lengthIn, endFinish: end, startFinish: start })
const yardOf = (back = 600, leftGate: any = null) => ({
  shape: 'backyard', closed: false,
  sides: [
    side('s1', 'Left return', 120, { type: 'walk', widthIn: 48, position: 'middle' }, 'house', 'corner'),
    side('s2', 'Left side', 600, leftGate),
    side('s3', 'Back', back),
    side('s4', 'Right side', 600, { type: 'double', widthIn: 120, position: 'middle' }),
    side('s5', 'Right return', 120, null, 'corner', 'house'),
  ],
})
const shape = (yard: any): WorkShape => {
  const d = derive(yard, STYLE)!
  return { fenceStyle: STYLE, runs: d.runs, corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates, tearOutSections: 0, tearOutGates: 0, yard }
}
const WALK = { type: 'walk', widthIn: 48, position: 'middle' }
const quote = shape(yardOf())
const co1 = shape(yardOf(720))                 // Back 50 -> 60 ft
const co2Old = shape(yardOf(600, WALK))        // drawn from the signed quote (before the fix)
const both = shape(yardOf(720, WALK))
const total = (s: WorkShape) => s.runs.reduce((a, b) => a + b, 0)

describe('change orders: two drawings on one job', () => {
  test('the signed quote is 156 ft, 1 walk and 1 double gate', () => {
    expect(quote.runs).toEqual([3, 3, 50, 50, 20, 20, 10])
    expect([quote.walkGates, quote.dblGates]).toEqual([1, 1])
  })

  test('two drawn from the signed quote (as on the dev copy), signed CO-1 then CO-2: both changes stay', () => {
    const { shape: now } = foldChanges(quote, [{ number: 1, base: quote, work: co1 }, { number: 2, base: quote, work: co2Old }], derive)
    expect(sameShape(now, both)).toBe(true)
    expect(now.walkGates).toBe(2)
    expect(total(now)).toBe(162) // 166 ft of line, 4 ft of it the new gate
    expect(now.yard.sides.find((s: any) => s.name === 'Back').lengthIn).toBe(720)
  })

  test('signed the other way round: the same work', () => {
    const { shape: now } = foldChanges(quote, [{ number: 2, base: quote, work: co2Old }, { number: 1, base: quote, work: co1 }], derive)
    expect(sameShape(now, both)).toBe(true)
  })

  test('the second one drawn on top of the open first one: alone it adds only the gate; with the first, both', () => {
    const co2 = both // drawn from CO-1's drawing (still open)
    const alone = applyChange(quote, { number: 2, base: co1, work: co2 }, derive)
    expect(alone.merged).toBe(true)
    expect(alone.shape.yard.sides.find((s: any) => s.name === 'Back').lengthIn).toBe(600) // CO-1 not signed: not in the job
    expect(alone.shape.walkGates).toBe(2)
    expect(total(alone.shape)).toBe(152)
    const then = applyChange(alone.shape, { number: 1, base: quote, work: co1 }, derive)
    expect(sameShape(then.shape, both)).toBe(true)
    // In order, nothing to merge: each one's own drawing.
    const inOrder = foldChanges(quote, [{ number: 1, base: quote, work: co1 }, { number: 2, base: co1, work: co2 }], derive)
    expect(inOrder.after.map(a => a.merged)).toEqual([false, false])
    expect(sameShape(inOrder.shape, both)).toBe(true)
  })

  test('the first one cancelled: the second keeps only its own change', () => {
    const { shape: now } = foldChanges(quote, [{ number: 2, base: co1, work: both }], derive)
    expect(now.yard.sides.find((s: any) => s.name === 'Back').lengthIn).toBe(600)
    expect(now.walkGates).toBe(2)
  })

  test('both change the same thing: the one signed last decides, and it is said', () => {
    const co3 = shape(yardOf(840)) // Back 70, drawn from the signed quote
    const r = foldChanges(quote, [{ number: 1, base: quote, work: co1 }, { number: 3, base: quote, work: co3 }], derive)
    expect(r.shape.yard.sides.find((s: any) => s.name === 'Back').lengthIn).toBe(840)
    expect(r.after[1].conflicts).toEqual(['Back: length'])
    expect(clashes({ number: 1, base: quote, work: co1 }, { number: 3, base: quote, work: co3 })).toEqual(['Back: length'])
    expect(clashes({ number: 1, base: quote, work: co1 }, { number: 2, base: co1, work: both })).toEqual([])
  })

  test('a side added by a change goes after the side before it in that drawing', () => {
    const base = yardOf()
    const mine = { ...base, sides: [...base.sides.slice(0, 3), side('s9', 'Dog run', 240), ...base.sides.slice(3)] }
    const cur = yardOf(720)
    const m = mergeYard(base, mine, cur)
    expect(m.yard.sides.map((s: any) => s.id)).toEqual(['s1', 's2', 's3', 's9', 's4', 's5'])
    expect(m.conflicts).toEqual([])
  })

  test('a typed run list (no drawing): run by run, and gates and posts by difference', () => {
    const q = shapeOf({ fenceStyle: STYLE, runs: [50, 50], corners: 1, ends: 2, walkGates: 0, dblGates: 0 })
    const a = shapeOf({ fenceStyle: STYLE, runs: [60, 50], corners: 1, ends: 2, walkGates: 0, dblGates: 0 })
    const b = shapeOf({ fenceStyle: STYLE, runs: [50, 50], corners: 1, ends: 2, walkGates: 1, dblGates: 0 })
    const { shape: now } = foldChanges(q, [{ number: 1, base: q, work: a }, { number: 2, base: q, work: b }], derive)
    expect(now.runs).toEqual([60, 50])
    expect(now.walkGates).toBe(1)
  })
})
