/**
 * The yard drawing with real angles (yardChain.ts, yardDrawing.ts): every
 * side is drawn at its typed length and only the angles change. Dragging a
 * corner, typing an angle, a tee, the crossing check, the house following
 * the fence, no reset when anything else changes, and older quotes drawn as
 * before. Footage, sections, posts and price never come from the drawing.
 *
 * The test yard is 451 Locust Rd (Custom, 7 sides, as saved on the live
 * quote): 14' (meets the house, a 4' walk gate in the middle), 28', 70', 27',
 * 46', 88', 13' (stops), every turn drawn square to the right.
 */

import { describe, test, expect } from 'vitest'
import { calculateMaterialsDetailed, calculateMixedMaterialsDetailed } from '../../web/src/materialCalculator'
import { withKitSets } from '../../web/src/materialKits'
import { deriveLayout, layoutForShape, teePostFor, VINYL_TEE_POST, type YardLayout, type YardSide } from '../../web/src/yardLayout'
import { buildPlan, autoVertices, planVertices, yardDrawing, setHouseMeets } from '../../web/src/sitePlanGeometry'
import { dist, onHouseWall, sideCrossings, segmentsMeet, angleOf, houseCorners } from '../../web/src/yardChain'
import {
  freezeDrawing, dragVertex, setCornerAngle, cornerAngleAt, setTee, slideTee, placeNewSide, keepClear, resetDrawing, setHouse, downstreamOf,
} from '../../web/src/yardDrawing'

const ft = (n: number) => n * 12
const LOCUST = [14, 28, 70, 27, 46, 88, 13]
const HEADINGS = [0, 270, 180, 90, 0, 270, 180]

function locust(): YardLayout {
  const sides: YardSide[] = LOCUST.map((n, i) => ({
    id: `s${i + 1}`, name: `Side ${i + 1}`, on: true, lengthIn: ft(n),
    startFinish: i === 0 ? 'house' : 'corner', endFinish: i === 6 ? 'free' : 'corner',
    gate: i === 0 ? { type: 'walk', widthIn: 48, position: 'middle' } : null, skip: null, heading: HEADINGS[i],
  }))
  return { shape: 'custom', closed: false, sides, plan: { points: null, pointsFor: null } }
}
/** What the price is made from: runs, posts, gates. */
const priced = (l: YardLayout) => {
  const r = deriveLayout(l)
  return JSON.stringify([r.runs.map(x => x.inches), r.corners, r.ends, r.walkGates, r.dblGates, r.totalIn])
}
/** Each side's drawn length equals its typed length. */
function toScale(l: YardLayout): boolean {
  const e = yardDrawing(l).ends
  return l.sides.every((s, i) => !(s.lengthIn > 0) || Math.abs(dist(e[i].a, e[i].b) - s.lengthIn / 12) < 1e-6)
}
const angles = (l: YardLayout) => l.sides.map((_, i) => cornerAngleAt(l, i)).map(a => (a ? `${a.deg.toFixed(3)}${a.turn[0]}` : '-'))

/**
 * A test yard drawn by hand at 90 degrees right at every corner (the old
 * drawing of the Locust lengths, saved as hand-set angles): Side 6 crosses
 * Side 3. Used for the drag, angle and tee tests (451 Locust Rd has no tee).
 */
function handDrawn(): YardLayout {
  const f = freezeDrawing(locust())
  const deg: Record<string, number> = {}
  f.sides.forEach((s, i) => { deg[s.id] = HEADINGS[i] })
  return { ...f, plan: { ...f.plan, drawn: { ...f.plan!.drawn!, origin: { x: 0, y: 0 }, deg, set: f.sides.map(s => s.id), house: null } } }
}

describe('451 Locust Rd (live quote 0366bdd6, read only: 7 sides, Side 1 meets the house, a 4 ft walk gate, no tee)', () => {
  test('as saved, nothing drawn by hand: drawn untangled, no side crosses another or the house; posts and runs as saved', () => {
    const l = locust()
    const before = priced(l)
    const r = deriveLayout(l)
    // What the live quote saved: runs 5, 5, 28, 70, 27, 46, 88, 13; 6 corner, 4 end (house, the free end, 2 gate posts).
    expect(r.runs.map(x => x.ft)).toEqual([5, 5, 28, 70, 27, 46, 88, 13])
    expect([r.corners, r.ends, r.walkGates]).toEqual([6, 4, 1])
    const plan = buildPlan(l)
    expect(plan.chain).toBe(false)
    expect(plan.crossings).toEqual([])
    expect(toScale(l)).toBe(true)
    // Every turn is still square; only Side 5's turns the other way.
    expect(plan.angles.map(a => `${a.deg}${a.turn[0]}`)).toEqual(['90r', '90r', '90r', '90l', '90r', '90r'])
    // No fence through the house drawn behind Side 1's start.
    const h = houseCorners(plan.houseRect!)
    plan.sides.slice(1).forEach(sd => { h.forEach((q, k) => { expect(segmentsMeet(sd.a, sd.b, q, h[(k + 1) % 4], 0.25)).toBeNull() }) })
    expect(priced(l)).toBe(before)
    // The same every time.
    expect(buildPlan(locust()).vertices).toEqual(plan.vertices)
  })

  test('the old 90 degrees right drawing it had: Side 6 crosses Side 3 (drawn by hand, it is never untangled)', () => {
    const plan = buildPlan(handDrawn())
    expect(plan.chain).toBe(true)
    expect(plan.crossings.map(c => c.text)).toEqual(['Side 3 crosses Side 6, check the drawing.'])
  })

  test('typing one angle fixes the hand drawing: Side 5 turns left, the rest follow, lengths kept, price the same', () => {
    const l = handDrawn()
    const before = priced(l)
    const m = setCornerAngle(l, 4, 90, 'left')
    expect(cornerAngleAt(m, 4)).toEqual({ deg: 90, turn: 'left' })
    expect(cornerAngleAt(m, 5)!.deg).toBeCloseTo(90, 6)
    expect(toScale(m)).toBe(true)
    expect(buildPlan(m).crossings).toEqual([])
    expect(priced(m)).toBe(before)
  })
})

describe('untangling only the drawings that cross', () => {
  test('older yards that did not cross are drawn exactly as before', () => {
    const shapes: YardLayout[] = []
    const c = layoutForShape('custom'); c.sides = [0, 270, 180].map((h, i) => ({ id: `c${i}`, name: `Side ${i + 1}`, on: true, lengthIn: ft([40, 60, 40][i]), startFinish: i ? 'corner' : 'house', endFinish: i === 2 ? 'house' : 'corner', gate: null, skip: null, heading: h })); shapes.push(c)
    const s = layoutForShape('straight'); s.sides[0].lengthIn = ft(80); shapes.push(s)
    const p = layoutForShape('perimeter'); p.sides.forEach(x => { x.lengthIn = ft(70) }); shapes.push(p)
    for (const l of shapes) {
      // The saved headings, side after side (what the drawing always was).
      let at = { x: 0, y: 0 }
      const want = [at, ...l.sides.map(x => { const r = (x.heading! * Math.PI) / 180; at = { x: at.x + x.lengthIn / 12 * Math.cos(r), y: at.y + x.lengthIn / 12 * Math.sin(r) }; return at })]
      if (l.closed) want.pop()
      autoVertices(l).forEach((v, i) => { expect(v.x).toBeCloseTo(want[i].x, 9); expect(v.y).toBeCloseTo(want[i].y, 9) })
    }
  })
})

describe('the chain keeps every side at its typed length', () => {
  test('drag every point, one after the other: lengths kept, only angles change, price the same', () => {
    let l = setCornerAngle(handDrawn(), 4, 90, 'left')
    const before = priced(l)
    const v0 = planVertices(l)
    for (let k = 0; k < v0.length; k++) {
      const v = planVertices(l)
      l = dragVertex(l, k, { x: v[k].x + 3.3, y: v[k].y - 2.1 })
      expect(toScale(l)).toBe(true)
    }
    expect(priced(l)).toBe(before)
    expect(l.plan!.drawn!.set!.length).toBeGreaterThan(3)
  })

  test('dragging a corner turns the side about its start; the sides after keep their directions', () => {
    const l = freezeDrawing(locust())
    const e0 = yardDrawing(l).ends
    const k = 3 // the end of Side 3
    const m = dragVertex(l, k, { x: e0[2].b.x - 8, y: e0[2].b.y + 20 })
    const e1 = yardDrawing(m).ends
    // Side 3 pivots about its start.
    expect(dist(e1[2].a, e0[2].a)).toBeLessThan(1e-9)
    expect(dist(e1[2].a, e1[2].b)).toBeCloseTo(70, 9)
    // Sides 4 to 7 keep their directions (they move along).
    for (let i = 3; i < 7; i++) expect(e1[i].deg).toBeCloseTo(e0[i].deg, 6)
    // Sides 1 and 2 do not move.
    for (let i = 0; i < 2; i++) { expect(dist(e1[i].a, e0[i].a)).toBeLessThan(1e-9); expect(dist(e1[i].b, e0[i].b)).toBeLessThan(1e-9) }
  })

  test('a drag snaps to whole degrees, and to 45 / 90 / 135 when close', () => {
    const l = freezeDrawing(locust())
    const e = yardDrawing(l).ends
    // Pull the end of Side 2 so the corner at Side 2's start is about 134 degrees.
    const a = e[1].a, rad = (-45 - 1.2) * Math.PI / 180
    const m = dragVertex(l, 2, { x: a.x + 28 * Math.cos(rad), y: a.y + 28 * Math.sin(rad) })
    const got = cornerAngleAt(m, 1)!.deg
    expect([45, 90, 135]).toContain(Math.round(got))
    expect(Math.abs(got - Math.round(got))).toBeLessThan(1e-6)
  })

  test('the first point turns the first side about its end', () => {
    const l = freezeDrawing(locust())
    const e0 = yardDrawing(l).ends
    const m = dragVertex(l, 0, { x: e0[0].a.x - 2, y: e0[0].a.y - 9 })
    const e1 = yardDrawing(m).ends
    // (Saved to a thousandth of a foot.)
    expect(dist(e1[0].b, e0[0].b)).toBeLessThan(2e-3)
    expect(dist(e1[0].a, e1[0].b)).toBeCloseTo(14, 9)
    for (let i = 1; i < 7; i++) expect(dist(e1[i].a, e0[i].a)).toBeLessThan(2e-3)
  })
})

describe('typing an angle', () => {
  test('135 degrees turning left at Side 4: that corner reads 135, everything after turns with it', () => {
    const l = freezeDrawing(locust())
    const e0 = yardDrawing(l).ends
    const m = setCornerAngle(l, 3, 135, 'left')
    expect(cornerAngleAt(m, 3)).toEqual({ deg: 135, turn: 'left' })
    const e1 = yardDrawing(m).ends
    // Turned about the corner: Side 4 starts where it did; the angles after it are unchanged.
    expect(dist(e1[3].a, e0[3].a)).toBeLessThan(1e-9)
    for (let i = 4; i < 7; i++) expect(cornerAngleAt(m, i)).toEqual(cornerAngleAt(l, i))
    expect(toScale(m)).toBe(true)
  })
  test('an angle is the inside angle: 180 is straight on, a quarter turn either way is 90', () => {
    expect(angleOf(0, 0)).toMatchObject({ deg: 180, turn: 'straight' })
    expect(angleOf(0, 90)).toMatchObject({ deg: 90, turn: 'left' })
    expect(angleOf(0, -90)).toMatchObject({ deg: 90, turn: 'right' })
    expect(angleOf(10, 55)).toMatchObject({ deg: 135, turn: 'left' })
  })
  test('the first side has no corner to type', () => {
    expect(cornerAngleAt(locust(), 0)).toBeNull()
    expect(setCornerAngle(locust(), 0, 120, 'left').plan!.drawn).toBeTruthy()
  })
})

describe('sides that cross', () => {
  test('two sides crossing; sides sharing a corner and a tee where it starts are not crossings', () => {
    expect(segmentsMeet({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: -5 }, { x: 5, y: 5 })).toMatchObject({ kind: 'point', at: { x: 5, y: 0 } })
    expect(segmentsMeet({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 0 }, { x: 20, y: 0 })).toMatchObject({ kind: 'overlap' })
    expect(segmentsMeet({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBeNull()
    const l = setCornerAngle(handDrawn(), 4, 90, 'left')
    expect(sideCrossings(l, yardDrawing(l).ends)).toEqual([])
    const t = setTee(l, 6, { sideId: 's3', atIn: ft(40) })
    expect(sideCrossings(t, yardDrawing(t).ends)).toEqual([])
  })
  test('a side doubled back over the one before runs over it', () => {
    const f = freezeDrawing(locust())
    const l = { ...f, plan: { ...f.plan, drawn: { ...f.plan!.drawn!, deg: { ...f.plan!.drawn!.deg, s3: 90 } } } }
    expect(buildPlan(l).crossings.some(c => c.text === 'Side 2 runs over Side 3, check the drawing.')).toBe(true)
  })
})

describe('a tee (a test yard drawn by hand; 451 Locust Rd has none): starts 40 ft along Side 3', () => {
  const base = () => setCornerAngle(handDrawn(), 4, 90, 'left')
  test('drawn from 40 ft along Side 3, square to it, posted as the end it is counted as', () => {
    const l = base()
    const t = setTee(l, 6, { sideId: 's3', atIn: ft(40) })
    const e = yardDrawing(t).ends
    const s3 = e[2]
    expect(dist(s3.a, e[6].a)).toBeCloseTo(40, 9)
    expect(dist(e[6].a, e[6].b)).toBeCloseTo(13, 9)
    expect(Math.abs(Math.abs(cornerAngleAt(t, 6)!.deg) - 90)).toBeLessThan(1e-6)
    // The start is no longer a corner with Side 6: both stop there (end posts, as the builder counts them).
    expect(t.sides[5].endFinish).toBe('free')
    expect(t.sides[6].startFinish).toBe('free')
    const r = deriveLayout(t), r0 = deriveLayout(l)
    expect(r.corners).toBe(r0.corners - 1)
    expect(r.ends).toBe(r0.ends + 2)
    expect(r.runs.map(x => x.inches)).toEqual(r0.runs.map(x => x.inches))
    const plan = buildPlan(t, r)
    expect(plan.posts.filter(p => p.kind === 'tee')).toHaveLength(1)
    expect(plan.tees.map(x => [x.name, x.anchorId])).toEqual([['Side 7', 's3']])
    expect(plan.angles.find(a => a.side === 6)!.tee).toBe(true)
  })
  test('the tee moves with its side and slides along it (whole feet)', () => {
    const t = setTee(base(), 6, { sideId: 's3', atIn: ft(40) })
    const e = yardDrawing(t).ends
    const at = { x: e[2].a.x + (e[2].b.x - e[2].a.x) * (52.4 / 70), y: e[2].a.y + (e[2].b.y - e[2].a.y) * (52.4 / 70) + 1.5 }
    const s = slideTee(t, 6, at)
    expect(s.sides[6].tee!.atIn).toBe(ft(52))
    expect(priced(s)).toBe(priced(t))
  })
  test('a tee only from an earlier side', () => {
    const l = base()
    expect(setTee(l, 2, { sideId: 's5', atIn: 12 }).sides[2].tee ?? null).toBeNull()
  })
})

describe('nothing else resets the drawing', () => {
  /** The yard with a few corners dragged and an angle typed. */
  function dragged(): YardLayout {
    let l = setCornerAngle(handDrawn(), 4, 90, 'left')
    l = setTee(l, 6, { sideId: 's3', atIn: ft(40) })
    const v = planVertices(l)
    l = dragVertex(l, 2, { x: v[2].x - 6, y: v[2].y + 3 })
    l = dragVertex(l, 4, { x: v[4].x + 4, y: v[4].y + 7 })
    return l
  }
  const changes: Array<[string, (l: YardLayout) => YardLayout]> = [
    ['Meets the house at the end of Side 6', l => ({ ...l, sides: l.sides.map((s, i) => (i === 5 ? { ...s, endFinish: 'house' } : s)) })],
    ['an end type (Side 1 starts free)', l => ({ ...l, sides: l.sides.map((s, i) => (i === 0 ? { ...s, startFinish: 'existing' } : s)) })],
    ['a gate added', l => ({ ...l, sides: l.sides.map((s, i) => (i === 4 ? { ...s, gate: { type: 'double', widthIn: 120, position: 'middle' } } : s)) })],
    ['a gate moved', l => ({ ...l, sides: l.sides.map((s, i) => (i === 0 ? { ...s, gate: { ...s.gate!, position: 'distance', distanceIn: 24 } } : s)) })],
    ['a side off', l => ({ ...l, sides: l.sides.map((s, i) => (i === 3 ? { ...s, on: false } : s)) })],
    ['a length', l => ({ ...l, sides: l.sides.map((s, i) => (i === 1 ? { ...s, lengthIn: ft(31) } : s)) })],
    ['a skip', l => ({ ...l, sides: l.sides.map((s, i) => (i === 5 ? { ...s, skip: { kind: 'existing', lengthIn: ft(10), position: 'middle' } } : s)) })],
    ['a rename', l => ({ ...l, sides: l.sides.map((s, i) => (i === 2 ? { ...s, name: 'Back' } : s)) })],
  ]
  for (const [name, change] of changes) {
    test(name, () => {
      const l = dragged()
      const m = change(l)
      expect(m.plan!.drawn).toEqual(l.plan!.drawn)
      expect(angles(m)).toEqual(angles(l))
      expect(toScale(m)).toBe(true)
    })
  }
  test('only Reset the drawing clears it', () => {
    const l = dragged()
    const r = resetDrawing(l)
    expect(r.plan!.drawn).toBeNull()
    expect(r.sides[6].tee).toEqual(l.sides[6].tee)
  })
})

describe('meets the house', () => {
  test('one end meets the house: the house slides so its wall touches that end; dragging keeps it touching', () => {
    let l = freezeDrawing(locust())
    let p = buildPlan(l)
    expect(onHouseWall(p.houseRect!, yardDrawing(l).ends[0].a)).toBe(true)
    l = dragVertex(l, 0, { x: -4, y: -8 })
    p = buildPlan(l)
    expect(p.houseMode).toBe('one')
    expect(onHouseWall(p.houseRect!, yardDrawing(l).ends[0].a)).toBe(true)
  })
  test('choosing Meets the house at the far end: both ends meet it, the angles stay', () => {
    const l = setCornerAngle(handDrawn(), 4, 90, 'left')
    const m = { ...l, sides: l.sides.map((s, i) => (i === 6 ? { ...s, endFinish: 'house' as const } : s)) }
    const p = buildPlan(m)
    const e = yardDrawing(m).ends
    expect(p.houseMode).toBe('fit')
    expect(onHouseWall(p.houseRect!, e[0].a)).toBe(true)
    expect(onHouseWall(p.houseRect!, e[6].b)).toBe(true)
    expect(angles(m)).toEqual(angles(l))
  })
  test('the house moved, turned and sized by hand (no end meets it)', () => {
    const l0 = locust()
    const l = { ...l0, sides: l0.sides.map((s, i) => (i === 0 ? { ...s, startFinish: 'free' as const } : s)) }
    const f = setHouse(l, { cx: 30, cy: 40, w: 50, d: 35, rotDeg: 17 })
    const p = buildPlan(f)
    expect(p.houseMode).toBe('free')
    expect(p.houseRect).toEqual({ cx: 30, cy: 40, w: 50, d: 35, rotDeg: 17 })
  })
  test('a backyard with the drawing edited: the returns stay put and the house moves to meet them', () => {
    const b = layoutForShape('backyard')
    ;[30, 120, 150, 100, 30].forEach((n, i) => { b.sides[i].lengthIn = ft(n) })
    const f = freezeDrawing(b)
    const v0 = planVertices(f)
    const m = setHouseMeets(f, { left: 10, right: 10 })
    expect(planVertices(m)).toEqual(v0)
    const p = buildPlan(m)
    expect(p.houseMode).toBe('fit')
    expect(onHouseWall(p.houseRect!, v0[0])).toBe(true)
    expect(onHouseWall(p.houseRect!, v0[5])).toBe(true)
  })
})

describe('new sides', () => {
  test('a new side turns right, unless that crosses a side: then it bends away and says so', () => {
    let l: YardLayout = { shape: 'custom', closed: false, sides: [] }
    const add = (n: number) => {
      const id = `n${l.sides.length + 1}`
      const sides = l.sides.map(s => ({ ...s }))
      if (sides.length) sides[sides.length - 1].endFinish = 'corner'
      sides.push({ id, name: `Side ${sides.length + 1}`, on: true, lengthIn: ft(n), startFinish: sides.length ? 'corner' : 'house', endFinish: 'free', gate: null, skip: null })
      const r = placeNewSide({ ...freezeDrawing(l), sides }, id)
      l = r.layout
      return r.message
    }
    const msgs = LOCUST.map(add)
    expect(buildPlan(l).crossings).toEqual([])
    expect(toScale(l)).toBe(true)
    // Side 6 would have crossed Side 3 turning right (as 451 Locust Rd was drawn).
    expect(msgs[5]).toMatch(/^Side 6 would cross Side 3/)
  })
  test('a length typed later that makes a side cross: it bends away, unless its angle was set by hand', () => {
    const h = handDrawn()
    // The 90 degrees right drawing, Side 6 not measured yet and no angle set by hand.
    const l = { ...h, sides: h.sides.map((s, i) => (i === 5 ? { ...s, lengthIn: 0 } : s)), plan: { ...h.plan, drawn: { ...h.plan!.drawn!, set: [] } } }
    const typed = { ...l, sides: l.sides.map((s, i) => (i === 5 ? { ...s, lengthIn: ft(88) } : s)) }
    const k = keepClear(typed, 5)
    expect(k.message).toMatch(/^Side 6 would cross Side 3/)
    expect(buildPlan(k.layout).crossings).toEqual([])
    const set = { ...typed, plan: { ...typed.plan, drawn: { ...typed.plan!.drawn!, set: ['s6'] } } }
    expect(keepClear(set, 5).message).toBeNull()
  })
  test('what turns with a side: the sides after it and tees off them', () => {
    const t = setTee(handDrawn(), 6, { sideId: 's3', atIn: ft(40) })
    expect(downstreamOf(t, 2)).toEqual([2, 3, 4, 5, 6])
    expect(downstreamOf(t, 4)).toEqual([4, 5])
  })
})

describe('older quotes look the same until edited', () => {
  const shapes = (): YardLayout[] => {
    const b = layoutForShape('backyard'); [30, 120, 150, 100, 30].forEach((n, i) => { b.sides[i].lengthIn = ft(n) })
    const f = layoutForShape('front'); [40, 60, 30].forEach((n, i) => { f.sides[i].lengthIn = ft(n) })
    const p = layoutForShape('perimeter'); p.sides.forEach(s => { s.lengthIn = ft(100) })
    const s = layoutForShape('straight'); s.sides[0].lengthIn = ft(50)
    const empty = layoutForShape('backyard')
    return [b, f, p, s, empty, locust()]
  }
  test('drawn exactly as before, and saving the angles moves nothing', () => {
    for (const l of shapes()) {
      const plan = buildPlan(l)
      expect(plan.vertices).toEqual(autoVertices(l))
      const f = freezeDrawing(l)
      const v = planVertices(f)
      v.forEach((p, i) => { expect(p.x).toBeCloseTo(plan.vertices[i].x, 2); expect(p.y).toBeCloseTo(plan.vertices[i].y, 2) })
      expect(priced(f)).toBe(priced(l))
    }
  })
  test('an older quote\'s dragged corners: their angles are kept, even after a length changes (the typed lengths are drawn)', () => {
    const l = locust()
    const v = autoVertices(l).map((p, i) => (i >= 5 ? { x: p.x - 40, y: p.y } : p))
    l.plan = { points: v, pointsFor: 'an older signature' }
    const a = angles(l)
    expect(toScale(l)).toBe(true)
    const m = { ...l, sides: l.sides.map((s, i) => (i === 1 ? { ...s, lengthIn: ft(33) } : s)) }
    expect(angles(m)).toEqual(a)
    // Saved as angles on the next edit: the older corners are dropped.
    const f = freezeDrawing(m)
    expect(f.plan!.points).toBeNull()
    expect(angles(f).map(x => x.slice(0, -2))).toEqual(a.map(x => x.slice(0, -2)))
  })
})

describe('posting a tee by material', () => {
  const teeYard = () => setTee(setCornerAngle(handDrawn(), 4, 90, 'left'), 6, { sideId: 's3', atIn: ft(40) })
  test('which post each material uses for a tee', () => {
    expect(teePostFor({ name: "CL - 4' Galv", category: 'Chainlink' })).toBe('corner')
    expect(teePostFor({ name: "CL - Com 6'", category: 'Commercial' })).toBe('corner')
    expect(teePostFor({ name: 'Alum - ND - Emily - 48', category: 'Aluminum' })).toBe('corner')
    expect(teePostFor({ name: "Wood - 6' - ND - BoB", category: 'Other' })).toBe('corner')
    // Vinyl: no 3 way post exists. Jonathan, Oct 21, 2026: "Line post, route the third side on site."
    expect(VINYL_TEE_POST).toBe('line')
    expect(teePostFor({ name: "WV-ND 6'x8' Privacy", category: 'Vinyl' })).toBe('line')
    expect(teePostFor({ name: "TV-DS 6'x6' Privacy", category: 'Vinyl' })).toBe('line')
    expect(teePostFor({ name: 'WV-Auto ND Privacy', category: 'Vinyl' })).toBe('line')
    expect(teePostFor(null)).toBe('end')
  })
  test('the counts: chain link, aluminum and wood one more corner and one fewer end; vinyl one more line post and one fewer end; footage the same', () => {
    const t = teeYard()
    const asEnd = deriveLayout(t, 96, { teeAs: 'end' }), asCorner = deriveLayout(t, 96, { teeAs: 'corner' })
    expect(asEnd.tees).toBe(1)
    expect(asCorner.corners).toBe(asEnd.corners + 1)
    expect(asCorner.ends).toBe(asEnd.ends - 1)
    expect(asCorner.runs).toEqual(asEnd.runs)
    for (const st of [{ name: "CL - 5' Black", category: 'Chainlink' }, { name: 'Alum - DS - Emily - 48', category: 'Aluminum' }, { name: "Wood - 8' - ND - SB", category: 'Other' }]) {
      const r = deriveLayout(t, 96, { teeAs: teePostFor(st) })
      expect([r.corners, r.ends]).toEqual([asCorner.corners, asCorner.ends])
    }
    expect(asEnd.linePosts).toBe(0)
    expect(asCorner.linePosts).toBe(0)
    // Vinyl: the tee is one more line post instead of an end post.
    const v = deriveLayout(t, 96, { teeAs: teePostFor({ name: "WV-ND 6'x8' Privacy", category: 'Vinyl' }) })
    expect([v.corners, v.ends, v.linePosts, v.tees]).toEqual([asEnd.corners, asEnd.ends - 1, 1, 1])
    expect(v.runs).toEqual(asEnd.runs)
    // A yard with no tee counts the same whatever the material.
    const l = locust()
    expect(deriveLayout(l, 96, { teeAs: 'corner' }).corners).toBe(deriveLayout(l).corners)
  })
  test('a vinyl tee prices as one more line post (and its hardware) instead of an end post', () => {
    const t = teeYard()
    for (const fenceStyle of ["WV-ND 6'x6' Privacy", "TV-DS 6'x8' Privacy", "WV-ND Bell 4'x6'"]) {
      const v = deriveLayout(t, 96, { teeAs: 'line' }), e = deriveLayout(t, 96, { teeAs: 'end' })
      const job = (r: typeof v, extra: number) => withKitSets([], () => calculateMaterialsDetailed({
        fenceStyle, runs: r.runs.map(x => x.ft), corners: r.corners, ends: r.ends, walkGates: r.walkGates, dblGates: r.dblGates,
        tearOutSections: 0, tearOutGates: 0, extraLinePosts: extra,
      })).items
      const qty = (items: Array<{ item: string; qty: number }>, rx: RegExp) => items.filter(i => rx.test(i.item)).reduce((n, i) => n + i.qty, 0)
      const asLine = job(v, v.linePosts), asEnd = job(e, 0)
      expect(qty(asLine, /Post, Line/), fenceStyle).toBe(qty(asEnd, /Post, Line/) + 1)
      expect(qty(asLine, /Post, End/), fenceStyle).toBe(qty(asEnd, /Post, End/) - 1)
      // Per post parts (caps, ties, pins, donuts or concrete) are the same: one post either way.
      expect(qty(asLine, /Cap, 5"x5"/), fenceStyle).toBe(qty(asEnd, /Cap, 5"x5"/))
    }
    // The auto mix (6 or 8 ft per run) counts it too.
    const mixed = (extra: number) => withKitSets([], () => calculateMixedMaterialsDetailed({
      installMethod: 'no-dig', colorFamily: 'white', runs: [{ ft: 40, rail: '6ft' }, { ft: 30, rail: '8ft' }], corners: 1, ends: 2, walkGates: 0, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLinePosts: extra,
    })).items
    const lines = (items: Array<{ item: string; qty: number }>) => items.filter(i => /Post, Line/.test(i.item)).reduce((n, i) => n + i.qty, 0)
    expect(lines(mixed(1))).toBe(lines(mixed(0)) + 1)
  })
})

describe('end points drag like corners', () => {
  for (const [start, end] of [['house', 'free'], ['existing', 'house'], ['free', 'existing']] as const) {
    test(`ends "${start}" and "${end}": both are handles; each swings its side about its other end at its typed length`, () => {
      const l0 = locust()
      const l = { ...l0, sides: l0.sides.map((s, i) => (i === 0 ? { ...s, startFinish: start } : i === 6 ? { ...s, endFinish: end } : s)) }
      const plan = buildPlan(l)
      expect(plan.handles).toContain(0)
      expect(plan.handles).toContain(7)
      const e0 = yardDrawing(freezeDrawing(l)).ends
      const a = dragVertex(l, 0, { x: e0[0].a.x + 3, y: e0[0].a.y - 5 })
      const b = dragVertex(a, 7, { x: e0[6].b.x + 4, y: e0[6].b.y + 6 })
      const e1 = yardDrawing(b).ends
      expect(dist(e1[0].b, e0[0].b)).toBeLessThan(2e-3)
      expect(dist(e1[0].a, e1[0].b)).toBeCloseTo(14, 9)
      expect(dist(e1[6].a, e0[6].a)).toBeLessThan(2e-3)
      expect(dist(e1[6].a, e1[6].b)).toBeCloseTo(13, 9)
      expect(priced(b)).toBe(priced(l))
      // Changing the end types after: the ends stay where they were dragged.
      const c = { ...b, sides: b.sides.map((s, i) => (i === 0 ? { ...s, startFinish: 'house' as const } : i === 6 ? { ...s, endFinish: 'free' as const } : s)) }
      const e2 = yardDrawing(c).ends
      expect(dist(e2[0].a, e1[0].a)).toBeLessThan(1e-9)
      expect(dist(e2[6].b, e1[6].b)).toBeLessThan(1e-9)
      // The end at the house is on the house wall.
      expect(onHouseWall(buildPlan(c).houseRect!, e2[0].a)).toBe(true)
    })
  }
})
