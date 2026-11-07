/**
 * Sketch and measure (web/src/sketch.ts; Jonathan, Nov 6 2026): the finger
 * sketch with its typed feet becomes the walk list the quote is priced from.
 * A side's feet include its gates; the gate comes out of the fence feet
 * (100 ft side with a 4 ft gate = 96 ft of fence + the gate). A walk list
 * made into a sketch and back is the same walk (so it prices the same). The
 * stroke is straightened into sides with a corner at each change of
 * direction; editing keeps feet, gates and tees where they belong.
 */

import { describe, test, expect } from 'vitest'
import { deriveLayout } from '../../web/src/yardLayout'
import { walkToYard, yardToWalk, totalIn, fenceIn, sketchOf, walkSideEnds, type WalkList } from '../../web/src/walkList'
import { layoutForShape } from '../../web/src/yardLayout'
import {
  addStroke, closeLine, removePoint, splitSide, sketchProblems, sketchToWalk, walkToSketch, walkSig, sketchFor, straighten, setFeet, setTeeAt, putGate, sketchTotals, sketchDirections, sideNumbers,
  type Sketch, type SkLine,
} from '../../web/src/sketch'

const ft = (n: number) => n * 12
const line = (id: string, pts: Array<[number, number]>, feet: Array<number | null>, extra: Partial<SkLine> = {}): SkLine =>
  ({ id, pts: pts.map(([x, y]) => ({ x, y })), closed: false, feetIn: feet.map(f => (f == null ? null : ft(f))), gates: [], ...extra })
const priced = (w: WalkList, nearIn = 96) => { const r = deriveLayout(walkToYard(w), nearIn, { teeAs: 'line' }); return { runs: r.runs.map(x => Math.round(x.inches * 1000) / 1000), corners: r.corners, ends: r.ends, walk: r.walkGates, dbl: r.dblGates, widths: r.gateWidthsFt, lines: r.linePosts, tees: r.tees } }

describe('sketch to walk list', () => {
  test('a closed backyard with two gates: gates come out of the side feet, 4 corners, no end posts', () => {
    // A square drawn clockwise on screen (y down).
    const sk: Sketch = { v: 1, lines: [line('a', [[50, 50], [350, 50], [350, 350], [50, 350]], [100, 80, 100, 80], { closed: true, gates: [
      { id: 'g1', side: 0, atIn: ft(20), widthIn: 48, type: 'walk' },
      { id: 'g2', side: 2, atIn: null, widthIn: 120, type: 'double' },
    ] })] }
    expect(sketchProblems(sk)).toEqual([])
    const w = sketchToWalk(sk)
    expect(w.lines[0].steps.map(s => [s.what, s.feetIn / 12])).toEqual([['gate', 20], ['corner', 76], ['corner', 80], ['gate', 45], ['corner', 45], ['start', 80]])
    const r = priced(w)
    expect([r.corners, r.ends, r.walk, r.dbl]).toEqual([4, 4, 1, 1])
    expect(r.widths).toEqual({ walk: [4], dbl: [10] })
    expect(totalIn(w) / 12).toBe(360)
    expect(fenceIn(w) / 12).toBe(346)
    expect(sketchTotals(sk)).toEqual({ walkedIn: ft(360), fenceIn: ft(346), gatesIn: ft(14) })
    // Drawn clockwise on screen: every corner turns right walking along it.
    expect(w.lines[0].steps.filter(s => s.what === 'corner').map(s => s.turn)).toEqual(['right', 'right', 'right'])
  })

  test('100 ft side with a 4 ft gate = 96 ft of fence and the gate', () => {
    const sk: Sketch = { v: 1, lines: [line('a', [[20, 200], [380, 200]], [100], { gates: [{ id: 'g', side: 0, atIn: ft(30), widthIn: 48, type: 'walk' }] })] }
    const w = sketchToWalk(sk)
    expect(fenceIn(w) / 12).toBe(96)
    expect(priced(w).runs).toEqual([ft(30), ft(66)])
    expect(priced(w).ends).toBe(2 + 2)
  })

  test('a gate at a corner (0 ft) and at the far end', () => {
    const sk: Sketch = { v: 1, lines: [line('a', [[20, 20], [300, 20], [300, 300]], [50, 40], { gates: [{ id: 'g', side: 0, atIn: 0, widthIn: 48, type: 'walk' }, { id: 'h', side: 1, atIn: ft(36), widthIn: 48, type: 'walk' }] })] }
    expect(sketchProblems(sk)).toEqual([])
    const w = sketchToWalk(sk)
    expect(w.lines[0].steps.map(s => [s.what, s.feetIn / 12])).toEqual([['gate', 0], ['corner', 46], ['gate', 36], ['end', 0]])
  })

  test('an open L along the house: two end posts, one corner, the turn as drawn', () => {
    const sk: Sketch = { v: 1, lines: [line('a', [[50, 50], [50, 300], [300, 300]], [60, 90])] }
    const w = sketchToWalk(sk)
    // Down the page then right: a left turn walking along it.
    expect(w.lines[0].steps.map(s => [s.what, s.turn ?? null])).toEqual([['corner', 'left'], ['end', null]])
    const r = priced(w)
    expect([r.corners, r.ends]).toEqual([1, 2])
  })

  test('a tee branch: the branch starts at its feet along the host side, which is not cut', () => {
    const sk: Sketch = { v: 1, lines: [
      line('a', [[20, 100], [380, 100]], [120]),
      line('b', [[200, 100], [200, 400]], [50], { tee: { lineId: 'a', side: 0, atIn: ft(60) } }),
    ] }
    expect(sketchProblems(sk)).toEqual([])
    const w = sketchToWalk(sk)
    expect(w.lines[0].steps.map(s => [s.what, s.feetIn / 12])).toEqual([['tee', 60], ['end', 60]])
    expect(w.lines[1].fromTee).toBe(w.lines[0].steps[0].id)
    expect(w.lines[1].branchTurn).toBe('right')
    const r = priced(w)
    expect(r.runs).toEqual([ft(120), ft(50)])
    expect(r.tees).toBe(1)
    expect(sideNumbers(sk).map(s => s.n)).toEqual([1, 2])
  })

  test('two separate fence lines', () => {
    const sk: Sketch = { v: 1, lines: [line('a', [[20, 50], [200, 50]], [40]), line('b', [[20, 300], [300, 300], [300, 450]], [70, 30])] }
    const r = priced(sketchToWalk(sk))
    expect([r.corners, r.ends]).toEqual([1, 4])
    expect(r.runs).toEqual([ft(40), ft(70), ft(30)])
  })

  test('says what to fix, plainly', () => {
    const sk: Sketch = { v: 1, lines: [
      line('a', [[20, 100], [380, 100], [380, 300]], [100, null], { gates: [{ id: 'g', side: 0, atIn: ft(98), widthIn: 48, type: 'walk' }] }),
      line('b', [[200, 100], [200, 400]], [50], { tee: { lineId: 'a', side: 0, atIn: null } }),
    ] }
    const p = sketchProblems(sk).map(x => x.text)
    expect(p).toContain('Side 2 has no feet. Tap it.')
    expect(p.some(t => /runs past/.test(t))).toBe(true)
    expect(p.some(t => /How far from End post 1 is the branch/.test(t))).toBe(true)
  })
})

describe('walk list to sketch and back: the same walk, the same price', () => {
  const step = (id: string, feet: number, what: any, extra: any = {}) => ({ id, feetIn: ft(feet), what, ...extra })
  const walks: WalkList[] = [
    { v: 1, lines: [{ id: 'a', steps: [step('1', 20, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step('2', 76, 'corner', { turn: 'right' }), step('3', 100, 'corner', { turn: 'right' }), step('4', 40, 'gate', { gate: { widthIn: 120, type: 'double' } }), step('5', 50, 'corner', { turn: 'right' }), step('6', 100, 'start')] }] },
    { v: 1, lines: [{ id: 'a', steps: [step('1', 60, 'tee'), step('2', 40, 'corner', { turn: 'left' }), step('3', 30, 'end')] }, { id: 'b', fromTee: '1', branchTurn: 'right', steps: [step('4', 25, 'gate', { gate: { widthIn: 60, type: 'walk' } }), step('5', 10, 'end')] }] },
    { v: 1, lines: [{ id: 'a', steps: [step('1', 40, 'end')] }, { id: 'b', steps: [step('2', 0, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step('3', 12.5, 'corner', { turn: 'left' }), step('4', 0, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step('5', 0, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step('6', 33, 'end')] }] },
    // A tee no branch starts from is only feet along the side.
    { v: 1, lines: [{ id: 'a', steps: [step('1', 30, 'tee'), step('2', 30, 'end')] }] },
  ]
  test('each walk round trips', () => {
    for (const [i, w] of walks.entries()) {
      const back = sketchToWalk(walkToSketch(w))
      expect(walkSig(back), `walk ${i}`).toBe(walkSig(w))
      expect(priced(back), `walk ${i}`).toEqual(priced(w))
    }
  })
  test('drawn yards walked (the 77 drawn quotes proof path) round trip through the sketch', () => {
    for (const [s, lens] of [['backyard', [30, 120, 150, 100, 30]], ['perimeter', [100, 80, 100, 80]], ['front', [40, 90, 40]], ['straight', [77]]] as const) {
      const y = layoutForShape(s)
      y.sides.forEach((x, i) => { x.lengthIn = ft(lens[i] ?? 0) })
      y.sides[0].gate = { type: 'walk', widthIn: 48, position: 'middle' }
      const w = yardToWalk(y, 96)
      const back = sketchToWalk(walkToSketch(w))
      expect(priced(back)).toEqual(priced(w))
    }
  })
  test('the sketch is kept while it makes the same walk; a change of feet keeps the shape', () => {
    const sk: Sketch = { v: 1, lines: [line('a', [[50, 50], [350, 80], [300, 350]], [100, 80])] }
    const w = sketchToWalk(sk)
    expect(sketchFor(w)).toBe(sk)
    // List view changed a side's feet: same corners, so the drawn shape stays.
    const w2: WalkList = { ...w, lines: w.lines.map(l => ({ ...l, steps: l.steps.map((s, i) => (i === 0 ? { ...s, feetIn: ft(90) } : s)) })) }
    const sk2 = sketchFor(w2)
    expect(sk2.lines[0].pts).toEqual(sk.lines[0].pts)
    expect(sk2.lines[0].feetIn).toEqual([ft(90), ft(80)])
    // Drawn angles reach the office layout (not square).
    const dirs = sketchDirections(w)!
    expect(Math.round(dirs.get('a')![0])).toBe(-6)
    const ends = walkSideEnds(w)
    expect(ends.size).toBe(2)
    expect(sketchOf(w, dirs)[0].points[1].y).toBeLessThan(0)
  })
})

describe('drawing and fixing', () => {
  test('a stroke with a wobble becomes straight sides with a corner at each turn', () => {
    const raw = [] as Array<{ x: number; y: number }>
    for (let i = 0; i <= 100; i++) raw.push({ x: 50 + i * 3, y: 100 + (i % 3) })
    for (let i = 1; i <= 80; i++) raw.push({ x: 350 + (i % 2), y: 100 + i * 3 })
    const pts = straighten(raw)
    expect(pts.length).toBe(3)
  })
  test('a stroke back to its start asks to close; yes makes a closed line', () => {
    const raw = [[50, 50], [350, 50], [350, 350], [50, 350], [55, 58]].flatMap(([x, y], i, a) => {
      if (i === 0) return [{ x, y }]
      const [px, py] = a[i - 1]
      return Array.from({ length: 20 }, (_, k) => ({ x: px + ((x - px) * (k + 1)) / 20, y: py + ((y - py) * (k + 1)) / 20 }))
    })
    const r = addStroke({ v: 1, lines: [] }, raw)
    expect(r.askClose).toBe(true)
    const closed = closeLine(r.sketch, r.lineId!)
    expect(closed.lines[0].closed).toBe(true)
    expect(closed.lines[0].pts.length).toBe(4)
    expect(closed.lines[0].feetIn.length).toBe(4)
  })
  test('a line started on a side is a tee; one started at an open end carries the line on', () => {
    const base: Sketch = { v: 1, lines: [line('a', [[20, 100], [380, 100]], [100])] }
    const tee = addStroke(base, [{ x: 200, y: 104 }, { x: 200, y: 250 }, { x: 200, y: 400 }])
    expect(tee.sketch.lines[1].tee).toEqual({ lineId: 'a', side: 0, atIn: null })
    const more = addStroke(base, [{ x: 382, y: 100 }, { x: 382, y: 250 }, { x: 382, y: 400 }])
    expect(more.sketch.lines.length).toBe(1)
    expect(more.sketch.lines[0].pts.length).toBe(3)
    expect(more.sketch.lines[0].feetIn).toEqual([ft(100), null])
  })
  test('taking a corner out adds the two sides; a corner put in asks for both again; gates and tees stay put', () => {
    let sk: Sketch = { v: 1, lines: [line('a', [[20, 20], [200, 20], [200, 200], [380, 200]], [50, 40, 30], { gates: [{ id: 'g', side: 1, atIn: ft(10), widthIn: 48, type: 'walk' }] })] }
    const before = priced(sketchToWalk(sk))
    sk = removePoint(sk, 'a', 1)
    expect(sk.lines[0].feetIn).toEqual([ft(90), ft(30)])
    expect(sk.lines[0].gates[0]).toMatchObject({ side: 0, atIn: ft(60) })
    expect(priced(sketchToWalk(sk)).runs.reduce((a, b) => a + b, 0)).toBe(before.runs.reduce((a, b) => a + b, 0))
    sk = splitSide(sk, 'a', 0, { x: 110, y: 110 })
    expect(sk.lines[0].feetIn.slice(0, 2)).toEqual([null, null])
    expect(sk.lines[0].pts.length).toBe(4)
    sk = setFeet(setFeet(sk, 'a', 0, ft(45)), 'a', 1, ft(45))
    expect(sketchProblems(sk)).toEqual([])
  })
  test('gate in the middle until placed; tee feet set', () => {
    let sk: Sketch = { v: 1, lines: [line('a', [[20, 100], [380, 100]], [40]), line('b', [[200, 100], [200, 400]], [20], { tee: { lineId: 'a', side: 0, atIn: null } })] }
    sk = putGate(sk, 'a', { id: 'g', side: 0, atIn: null, widthIn: 48, type: 'walk' })
    sk = setTeeAt(sk, 'b', ft(10))
    const w = sketchToWalk(sk)
    expect(w.lines[0].steps.map(s => [s.what, s.feetIn / 12])).toEqual([['tee', 10], ['gate', 8], ['end', 18]])
  })
})
