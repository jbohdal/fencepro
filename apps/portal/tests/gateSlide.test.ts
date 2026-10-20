/**
 * Sliding a gate along its side (web/src/gateSlide.ts): clamps, no overlap,
 * snapping, distances both ways, the width change keeping the middle, and the
 * pieces priced as the builder's split for a gate prices them (per piece
 * section rounding, footage never changed by a move).
 */

import { describe, test, expect } from 'vitest'
import {
  startRanges, clampStart, snapStart, gateDistances, startFromEnd, slideGate, resizeGate, gateStartIn, gatePieces, gateDistanceText, STEP_HALF_FOOT,
  slideGateFromEnd, sameGateSpot, ftText, sideEndName, gateWhereText, gateDistanceTextExact,
} from '../../web/src/gateSlide'
import { deriveLayout, layoutForShape, sidePieces, type YardLayout } from '../../web/src/yardLayout'
import { sectionsForRun } from '../../web/src/sectionCount'

const ft = (n: number) => n * 12
function oneSide(lengthFt: number, gate: { type: 'walk' | 'double'; widthFt: number } | null, skip?: { lengthFt: number; atFt: number }): YardLayout {
  const l = layoutForShape('straight')
  l.sides[0] = { ...l.sides[0], lengthIn: ft(lengthFt), gate: gate ? { type: gate.type, widthIn: ft(gate.widthFt), position: 'middle' } : null, skip: skip ? { kind: 'existing', lengthIn: ft(skip.lengthFt), position: 'distance', distanceIn: ft(skip.atFt) } : null }
  return l
}

describe('where a gate may go', () => {
  test('it stays on its side: from flush with the start to flush with the end', () => {
    expect(startRanges(ft(48), ft(5))).toEqual([{ fromIn: 0, toIn: ft(43) }])
    expect(clampStart(-50, ft(48), ft(5))).toBe(0)
    expect(clampStart(ft(60), ft(48), ft(5))).toBe(ft(43))
  })
  test('it never overlaps the skip on its side (or another gate), and touching is allowed', () => {
    const r = startRanges(ft(48), ft(5), [{ fromIn: ft(20), toIn: ft(30) }])
    expect(r).toEqual([{ fromIn: 0, toIn: ft(15) }, { fromIn: ft(30), toIn: ft(43) }])
    expect(clampStart(ft(19), ft(48), ft(5), [{ fromIn: ft(20), toIn: ft(30) }])).toBe(ft(15))  // nearer the left stretch
    expect(clampStart(ft(27), ft(48), ft(5), [{ fromIn: ft(20), toIn: ft(30) }])).toBe(ft(30))
  })
  test('a gate wider than its side has nowhere to go', () => {
    expect(clampStart(0, ft(4), ft(5))).toBeNull()
  })
})

describe('snapping', () => {
  test('to whole feet by default, half feet as an option', () => {
    expect(snapStart(ft(12.4), ft(48), ft(5))).toBe(ft(12))
    expect(snapStart(ft(12.4), ft(48), ft(5), [], STEP_HALF_FOOT)).toBe(ft(12.5))
  })
  test('flush with an end even when the side is not whole feet', () => {
    const L = ft(30) + 4 // 30' 4"
    expect(snapStart(L, L, ft(4))).toBe(L - ft(4))
    expect(snapStart(ft(26.1), L, ft(4))).toBe(ft(26))
  })
})

describe('distances', () => {
  test('from the start and to the end, either way round', () => {
    expect(gateDistances(ft(48), ft(12), ft(5))).toEqual({ beforeIn: ft(12), afterIn: ft(31) })
    expect(startFromEnd(ft(48), ft(5), ft(31))).toBe(ft(12))
    expect(gateDistanceText(ft(12), ft(5), ft(31))).toBe('12 ft ← [5 ft gate] → 31 ft')
  })
})

describe('sliding a gate in a layout', () => {
  test('saved as the builder reads it (distance from the start), placed exactly there by the builder', () => {
    const l = slideGate(oneSide(48, { type: 'walk', widthFt: 5 }), 0, ft(12.3))
    expect(l.sides[0].gate).toMatchObject({ position: 'distance', distanceIn: ft(12), widthIn: ft(5) })
    expect(gateStartIn(l, 0)).toBe(ft(12))
    expect(sidePieces(l.sides[0], deriveLayout(l).sides[0]).map(p => p.text)).toEqual(["12'", "5' walk gate", "31'"])
  })
  test('the two pieces price as their own runs: sections round up per piece, gate posts added, footage unchanged', () => {
    const before = oneSide(48, { type: 'walk', widthFt: 5 })
    const moved = slideGate(before, 0, ft(12))
    const a = deriveLayout(before), b = deriveLayout(moved)
    expect(b.runs.map(r => r.ft)).toEqual([12, 31])
    expect(b.totalIn).toBe(a.totalIn)                                   // a move never changes footage
    expect(b.runs.reduce((t, r) => t + r.ft, 0)).toBe(a.runs.reduce((t, r) => t + r.ft, 0))
    expect([b.ends, b.walkGates]).toEqual([2 + 2, 1])                  // the two ends and the gate's two posts
    const p = gatePieces(moved, 0, 8)!
    expect([p.beforeSections, p.afterSections]).toEqual([sectionsForRun(12, 8), sectionsForRun(31, 8)])
    expect([p.beforeSections, p.afterSections]).toEqual([2, 4])         // 43 ft as one run would be 6
  })
  test('flush with the end: the end post is the gate post (one fewer post), footage the same', () => {
    const l = slideGate(oneSide(48, { type: 'walk', widthFt: 4 }), 0, ft(100))
    const r = deriveLayout(l)
    expect(r.runs.map(x => x.ft)).toEqual([44])
    expect(r.ends).toBe(1 + 1 + 1)   // the start's end post, the gate post in the line, and the gate post at the end
    expect(r.totalIn).toBe(ft(48))
  })
  test('a new width keeps the middle where it was (and is pulled back onto the side if it must)', () => {
    const l = slideGate(oneSide(48, { type: 'walk', widthFt: 4 }), 0, ft(20))   // middle at 22 ft
    const wide = resizeGate(l, 0, ft(6))
    expect(gateStartIn(wide, 0)).toBe(ft(19))                                    // 19 + 3 = 22
    const atEnd = slideGate(oneSide(48, { type: 'walk', widthFt: 4 }), 0, ft(44)) // flush with the end
    const dbl = resizeGate(atEnd, 0, ft(12))
    expect(gateStartIn(dbl, 0)).toBe(ft(36))                                     // 36 + 12 = 48, still on the side
  })
  test('it will not slide onto the skip', () => {
    const l0 = oneSide(60, { type: 'walk', widthFt: 4 }, { lengthFt: 10, atFt: 30 })
    const l = { ...l0, sides: [{ ...l0.sides[0], gate: { ...l0.sides[0].gate!, position: 'distance' as const, distanceIn: 0 } }] }
    expect(gateStartIn(slideGate(l, 0, ft(37)), 0)).toBe(ft(40))
    expect(gateStartIn(slideGate(l, 0, ft(28)), 0)).toBe(ft(26))
  })
})

describe('the quote builder: half feet, typed distances, a width change near an end', () => {
  const total = (l: YardLayout) => deriveLayout(l).runs.reduce((t, r) => t + r.inches, 0)
  test('half feet: the drag snaps to 6 inch steps, the pieces price as their own runs, footage unchanged', () => {
    const l0 = oneSide(48, { type: 'walk', widthFt: 5 })
    const l = slideGate(l0, 0, ft(12.3), { stepIn: STEP_HALF_FOOT })
    expect(gateStartIn(l, 0)).toBe(ft(12.5))
    expect(deriveLayout(l).runs.map(r => r.ft)).toEqual([12.5, 30.5])
    expect(total(l)).toBe(total(l0))
    const p = gatePieces(l, 0, 8)!
    expect([p.beforeSections, p.afterSections]).toEqual([2, 4])
    expect(gateDistanceTextExact(p.beforeIn, ft(5), p.afterIn)).toBe('12.5 ft ← [5 ft gate] → 30.5 ft')
  })
  test('typed from the start: exact, not snapped (12\' 4")', () => {
    const l = slideGate(oneSide(48, { type: 'walk', widthFt: 5 }), 0, ft(12) + 4, { exact: true })
    expect(l.sides[0].gate).toMatchObject({ position: 'distance', distanceIn: ft(12) + 4 })
    expect(ftText(gateStartIn(l, 0)!)).toBe(`12' 4"`)
    expect(total(l)).toBe(ft(43))
  })
  test('typed to the far end: "31 ft to the corner" puts the start at 12 ft; too far is kept on the side', () => {
    const l0 = oneSide(48, { type: 'walk', widthFt: 5 })
    expect(gateStartIn(slideGateFromEnd(l0, 0, ft(31)), 0)).toBe(ft(12))
    expect(gateStartIn(slideGateFromEnd(l0, 0, ft(60)), 0)).toBe(0)
    expect(gateStartIn(slideGateFromEnd(l0, 0, -5), 0)).toBe(ft(43))
  })
  test('typed onto the skip: moved off it to the nearer side', () => {
    const m = oneSide(60, { type: 'walk', widthFt: 4 }, { lengthFt: 10, atFt: 30 })
    const l0 = slideGate(m, 0, 0)   // off the skip first (in the middle it would sit on it, and the skip is left off)
    expect(gateStartIn(slideGate(l0, 0, ft(31), { exact: true }), 0)).toBe(ft(26))
    expect(gateStartIn(slideGate(l0, 0, ft(37), { exact: true }), 0)).toBe(ft(40))
  })
  test('a width change near an end keeps the middle, exactly, and stays on the side', () => {
    const atStart = slideGate(oneSide(48, { type: 'walk', widthFt: 4 }), 0, 0)         // flush with the start, middle at 2 ft
    expect(gateStartIn(resizeGate(atStart, 0, ft(6), { snap: false }), 0)).toBe(0)     // would start at -1 ft: pulled back on
    const nearEnd = slideGate(oneSide(48, { type: 'walk', widthFt: 5 }), 0, ft(42))    // middle at 44.5 ft, 1 ft from the end
    const six = resizeGate(nearEnd, 0, ft(6), { snap: false })
    expect(gateStartIn(six, 0)).toBe(ft(41.5))                                         // 41.5 + 3 = 44.5
    expect(gatePieces(six, 0, 8)).toMatchObject({ beforeIn: ft(41.5), afterIn: ft(0.5) })
    const dbl = resizeGate({ ...nearEnd, sides: [{ ...nearEnd.sides[0], gate: { ...nearEnd.sides[0].gate!, type: 'double' } }] }, 0, ft(12), { snap: false })
    expect(gateStartIn(dbl, 0)).toBe(ft(36))                                           // flush with the end
    expect(total(dbl)).toBe(ft(36))
  })
  test('a drag step that lands on the same foot changes nothing', () => {
    const l = slideGate(oneSide(48, { type: 'walk', widthFt: 5 }), 0, ft(12))
    expect(sameGateSpot(l, slideGate(l, 0, ft(12.2)), 0)).toBe(true)
    expect(sameGateSpot(l, slideGate(l, 0, ft(13)), 0)).toBe(false)
  })
  test('the crew\'s words: both distances by the side\'s real ends (corner, house, end)', () => {
    const y = layoutForShape('backyard')
    y.sides.forEach((s, i) => { s.lengthIn = ft([20, 60, 48, 60, 20][i]) })
    y.sides[2].gate = { type: 'walk', widthIn: ft(5), position: 'middle' }
    y.sides[0].gate = { type: 'walk', widthIn: ft(4), position: 'middle' }
    const moved = slideGate(y, 2, ft(12))
    expect(sideEndName(moved, 2, 'start')).toBe('the Left side corner')
    expect(gateWhereText(moved, 2)).toBe('5 ft walk gate, 12 ft from the Left side corner, 31 ft to the Right side corner')
    expect(gateWhereText(moved, 0)).toBe('4 ft walk gate, 8 ft from the house, 8 ft to the Left side corner')
    const line = oneSide(48, { type: 'double', widthFt: 12 })
    expect(gateWhereText(slideGate(line, 0, 0), 0)).toBe('12 ft double gate, right at the end, 36 ft to the end')
  })
})
