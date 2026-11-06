/**
 * The walk list (web/src/walkList.ts; Jonathan, Nov 5 2026) prices exactly as
 * the yard drawing does: a drawn yard walked (yardToWalk) and laid out again
 * (walkToYard) gives the same runs, posts, gates, gate widths and tees; walked
 * fences (a closed square with two gates, an L along the house, a tee branch,
 * a second fence line, two gates on one side) give the posts a crew would set.
 */

import { describe, test, expect } from 'vitest'
import { deriveLayout, layoutForShape, type YardLayout, type TeePost } from '../../web/src/yardLayout'
import { walkToYard, yardToWalk, walkProblems, stepLines, sketchOf, walkTable, totalIn, walkPieces, tapeSteps, walkPieceRows, type WalkList } from '../../web/src/walkList'

const same = (yard: YardLayout, nearIn: number, teeAs: TeePost = 'end') => {
  const a = deriveLayout(yard, nearIn, { teeAs })
  const b = deriveLayout(walkToYard(yardToWalk(yard, nearIn)), nearIn, { teeAs })
  const pick = (r: ReturnType<typeof deriveLayout>) => ({ runs: r.runs.map(x => Math.round(x.inches * 1000) / 1000), corners: r.corners, ends: r.ends, walk: r.walkGates, dbl: r.dblGates, widths: r.gateWidthsFt, lines: r.linePosts, tees: r.tees })
  return [pick(a), pick(b)]
}
const shape = (s: Parameters<typeof layoutForShape>[0], lens: number[], edit?: (y: YardLayout) => void) => {
  const y = layoutForShape(s)
  y.sides.forEach((x, i) => { x.lengthIn = (lens[i] ?? 0) * 12 })
  edit?.(y)
  return y
}
const ft = (n: number) => n * 12
const step = (feet: number, what: any, extra: any = {}) => ({ id: `x${Math.random().toString(36).slice(2, 8)}`, feetIn: ft(feet), what, ...extra })

describe('a drawn yard and its walk list price the same', () => {
  test('backyard, perimeter, front yard, straight; gates middle, start, end, at a distance; a skip; a tee; vinyl and chain link tees', () => {
    const cases: YardLayout[] = [
      shape('backyard', [30, 120, 150, 100, 30]),
      shape('backyard', [30, 120, 150, 100, 30], y => { y.sides[1].gate = { type: 'walk', widthIn: 48, position: 'middle' }; y.sides[3].gate = { type: 'double', widthIn: 120, position: 'end' } }),
      shape('backyard', [12, 50, 112, 50, 12], y => { y.sides[0].gate = { type: 'walk', widthIn: 48, position: 'start' }; y.sides[2].gate = { type: 'walk', widthIn: 60, position: 'distance', distanceIn: 300 } }),
      shape('perimeter', [100, 80, 100, 80], y => { y.sides[0].gate = { type: 'double', widthIn: 144, position: 'middle' } }),
      shape('front', [40, 90, 40]),
      shape('straight', [77]),
      shape('backyard', [30, 120, 150, 100, 30], y => { y.sides[2].skip = { kind: 'existing', lengthIn: 240, position: 'middle' } }),
      shape('custom', [100], y => { y.sides.push({ id: 'tee1', name: 'Side 2', on: true, lengthIn: ft(40), startFinish: 'free', endFinish: 'house', tee: { sideId: y.sides[0].id, atIn: ft(60) } }) }),
      shape('backyard', [0, 120, 150, 100, 30], y => { y.sides[0].on = false }),
    ]
    for (const [i, y] of cases.entries()) {
      for (const nearIn of [72, 96]) for (const teeAs of ['end', 'line', 'corner'] as TeePost[]) {
        const [a, b] = same(y, nearIn, teeAs)
        expect(b, `case ${i} near ${nearIn} tee ${teeAs}`).toEqual(a)
      }
    }
  })
})

describe('walked fences', () => {
  test('a closed square with two gates: 4 corners, the gates\' posts, no end posts', () => {
    const w: WalkList = { v: 1, lines: [{ id: 'a', steps: [step(20, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(76, 'corner', { turn: 'right' }), step(100, 'corner', { turn: 'right' }), step(40, 'gate', { gate: { widthIn: 120, type: 'double' } }), step(50, 'corner', { turn: 'right' }), step(100, 'start')] }] }
    expect(walkProblems(w)).toEqual([])
    const r = deriveLayout(walkToYard(w), 96)
    expect([r.corners, r.ends, r.walkGates, r.dblGates]).toEqual([4, 4, 1, 1])
    expect(r.runs.map(x => x.ft)).toEqual([20, 76, 100, 40, 50, 100])
    expect(r.gateWidthsFt).toEqual({ walk: [4], dbl: [10] })
    expect(Math.round(totalIn(w) / 12)).toBe(400)
  })

  test('an open L along the house: end posts at the house, one corner', () => {
    const w: WalkList = { v: 1, lines: [{ id: 'a', steps: [step(60, 'corner', { turn: 'left' }), step(80, 'end')] }] }
    const r = deriveLayout(walkToYard(w), 96)
    expect([r.corners, r.ends, r.runs.map(x => x.ft)]).toEqual([1, 2, [60, 80]])
    expect(stepLines(w).map(l => l.text)).toEqual(['Side 1: 60 ft, Corner left', 'Side 2: 80 ft, End post'])
  })

  test('a tee branch: the branch\'s first post is the style\'s tee post; the side it stands on is not cut', () => {
    const w: WalkList = { v: 1, lines: [
      { id: 'a', steps: [step(40, 'tee'), step(60, 'end')] },
      { id: 'b', fromTee: '', steps: [step(30, 'end')] },
    ] }
    w.lines[1].fromTee = w.lines[0].steps[0].id
    for (const [teeAs, want] of [['line', { corners: 0, ends: 3, lines: 1 }], ['corner', { corners: 1, ends: 3, lines: 0 }], ['end', { corners: 0, ends: 4, lines: 0 }]] as const) {
      const r = deriveLayout(walkToYard(w), 96, { teeAs })
      expect({ corners: r.corners, ends: r.ends, lines: r.linePosts }, teeAs).toEqual(want)
      expect(r.runs.map(x => x.ft)).toEqual([100, 30])
      expect(r.tees).toBe(1)
    }
    // The step list names the branch and which way it goes; going right instead changes the sketch, not the price.
    expect(stepLines(w)[2].text).toBe('Branch from Tee 1 (goes left) · Side 2: 30 ft, End post')
    const right: WalkList = { ...w, lines: [w.lines[0], { ...w.lines[1], branchTurn: 'right' }] }
    expect(deriveLayout(walkToYard(right), 96).runs.map(x => x.ft)).toEqual([100, 30])
    expect(sketchOf(right)[1].points[1]).not.toEqual(sketchOf(w)[1].points[1])
  })

  test('a second separate fence line, and two gates on one side (they share the post between them)', () => {
    const w: WalkList = { v: 1, lines: [
      { id: 'a', steps: [step(10, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(0, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(30, 'end')] },
      { id: 'b', steps: [step(25, 'end')] },
    ] }
    const r = deriveLayout(walkToYard(w), 96)
    expect(r.runs.map(x => x.ft)).toEqual([10, 30, 25])
    // Line 1: start and end posts, 3 gate posts (10 ft, 14 ft, 18 ft); line 2: two end posts.
    expect([r.corners, r.ends, r.walkGates]).toEqual([0, 2 + 3 + 2, 2])
    expect(walkTable(w).length).toBe(2)
    expect(stepLines(w).map(l => l.text)[3]).toBe('Fence line 2 · Side 2: 25 ft, End post')
    expect(sketchOf(w).length).toBe(2)
  })

  test('plain words: what to fix, never a run, segment or loop', () => {
    const w: WalkList = { v: 1, lines: [{ id: 'a', steps: [step(0, 'corner', { turn: 'left' }), step(20, 'gate', { gate: { widthIn: 0, type: 'walk' } })] }] }
    const p = walkProblems(w)
    expect(p).toContain('Side 1 has no feet yet. Tap it to add the feet.')
    expect(p.some(x => /no end yet/.test(x))).toBe(true)
    expect(p.join(' ')).not.toMatch(/\b(run|segment|node|vertex|terminal|polygon|loop)\b/i)
  })
})

describe('the install packet: each piece its own row, in walking order', () => {
  test('a gate in the middle of a side: the fence before it, the gate, the fence after it and what is at its end', () => {
    const w: WalkList = { v: 1, lines: [{ id: 'a', steps: [step(13, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(13, 'corner', { turn: 'right' }), step(120, 'corner', { turn: 'right' }), step(10, 'gate', { gate: { widthIn: 120, type: 'double' } }), step(10, 'end')] }, { id: 'b', steps: [step(0, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(25, 'end')] }] }
    expect(walkPieceRows(w)).toEqual([
      'Side 1: 13 ft fence', '4 ft single gate', 'Side 1: 13 ft fence, then corner right',
      'Side 2: 120 ft fence, then corner right',
      'Side 3: 10 ft fence', '10 ft double gate', 'Side 3: 10 ft fence, then end post',
      'Fence line 2 · 4 ft single gate', 'Side 4: 25 ft fence, then end post',
    ])
  })
})

describe('the tape measure check on the walk list', () => {
  test('the walk\'s stretches are the priced runs, length for length, for every shape; the flagged run marks its step', () => {
    const walks: WalkList[] = [
      { v: 1, lines: [{ id: 'a', steps: [step(20, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(76, 'corner', { turn: 'right' }), step(100, 'corner', { turn: 'right' }), step(40, 'gate', { gate: { widthIn: 120, type: 'double' } }), step(50, 'corner', { turn: 'right' }), step(100, 'start')] }] },
      { v: 1, lines: [{ id: 'a', steps: [step(0, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(30, 'tee'), step(60, 'end')] }, { id: 'b', fromTee: '', steps: [step(25, 'corner', { turn: 'left' }), step(10, 'end')] }, { id: 'c', steps: [step(80, 'end')] }] },
    ]
    walks[1].lines[1].fromTee = walks[1].lines[0].steps[1].id
    for (const y of [shape('backyard', [30, 120, 150, 100, 30], y => { y.sides[1].gate = { type: 'walk', widthIn: 48, position: 'middle' } }), shape('perimeter', [100, 80, 100, 80])]) walks.push(yardToWalk(y, 96))
    for (const w of walks) {
      const runs = deriveLayout(walkToYard(w), 96).runs
      expect(walkPieces(w).map(p => p.inches)).toEqual(runs.map(r => r.inches))
    }
    const w = walks[0], runs = deriveLayout(walkToYard(w), 96).runs
    expect([...tapeSteps(w, runs, runs.map((_, i) => i === 1))]).toEqual([w.lines[0].steps[1].id])
    expect(tapeSteps(w, runs.slice(1), runs.map(() => true)).size).toBe(0)
  })
})

describe('change orders on a walked job', () => {
  test('a gate put into a side that already has one: its own posts and the fence its opening takes out; a longer side: longer runs', async () => {
    const { changeBaseOf } = await import('../../web/src/changeOrderPricing')
    const before: WalkList = { v: 1, lines: [{ id: 'a', steps: [step(20, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(76, 'corner', { turn: 'right' }), step(100, 'end')] }] }
    const was = walkToYard(before)
    // A second gate on side 1, 40 ft past the first gate's far post.
    const added: WalkList = JSON.parse(JSON.stringify(before))
    added.lines[0].steps.splice(1, 1, step(40, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(32, 'corner', { turn: 'right' }))
    const now = walkToYard(added)
    expect(now.sides[0].id).toBe(was.sides[0].id)
    expect(now.sides[0].gates?.length).toBe(2)
    const r0 = deriveLayout(was, 96), r1 = deriveLayout(now, 96)
    const base = changeBaseOf({ runs: r0.runs.map(r => r.ft), ends: r0.ends, walkGates: r0.walkGates, dblGates: r0.dblGates, layout: { yard: was } }, { yard: now, nearIn: 96, teeAs: 'end' })
    // The new gate's two posts (both inside the side); the fence with its opening closed is side 1 as before.
    expect(base.drawn?.gatePosts).toBe(2)
    expect(base.drawn?.gateRuns.map(r => r.ft)).toEqual([20, 76, 100])
    expect([r1.walkGates, r1.runs.map(r => r.ft)]).toEqual([2, [20, 40, 32, 100]])
    // Extend side 2 by 10 ft: the same sides, a longer run.
    const longer: WalkList = JSON.parse(JSON.stringify(before))
    longer.lines[0].steps[2].feetIn += ft(10)
    expect(walkToYard(longer).sides.map(s => s.id)).toEqual(was.sides.map(s => s.id))
    expect(deriveLayout(walkToYard(longer), 96).runs.map(r => r.ft)).toEqual([20, 76, 110])
  })
})
