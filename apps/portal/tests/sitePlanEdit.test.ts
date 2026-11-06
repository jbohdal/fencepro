/**
 * The office site plan editor's moves (web/src/sitePlanEdit.ts): a side typed
 * to a length, snapping square and onto lines, gates on and off, undo and redo,
 * the survey's scale, and the walk list or drawing change the quote builder
 * opens on for "Use the drawn length" and a change order from the plan.
 */

import { describe, test, expect } from 'vitest'
import { planFromYard, drawnFt, toFeet, fromFeet, type SitePlanData } from '../../web/src/sitePlanData'
import {
  setSideLength, movePost, snapSquare, snapToEdges, snapEdges, addGate, removeGate, gatePlace, historyOf, historyPush, historyReplace, historyUndo, historyRedo,
  movePlan, turnPlan, addSide, removeSide, placeSurvey, scaleSurvey, surveyToFeet, feetToSurvey, turnSurvey,
  walkWithSideFeet, yardWithSideFeet, walkWithGate, yardWithGate, sideLabel, postFeet, houseRect, quoteYardOf, startOf, sideFeetEdit, optionPairs,
} from '../../web/src/sitePlanEdit'
import { sideStepsNow } from '../../web/src/sitePlanEdit'
import { walkToYard, type WalkList } from '../../web/src/walkList'
import { deriveLayout, layoutForShape } from '../../web/src/yardLayout'

const OCALA = { lat: 29.1872, lng: -82.1401 }
const ft = (n: number) => n * 12
let k = 0
const step = (feet: number, what: any, extra: any = {}) => ({ id: `t${k++}`, feetIn: ft(feet), what, ...extra })
const r1 = (n: number) => Math.round(n * 10) / 10

const walk: WalkList = { v: 1, lines: [{ id: 'a', steps: [step(13, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(13, 'corner', { turn: 'right' }), step(120, 'corner', { turn: 'right' }), step(150, 'corner', { turn: 'right' }), step(120, 'corner', { turn: 'right' }), step(30, 'end')] }] }
const yard = walkToYard(walk)
const plan = planFromYard(yard, OCALA, walk)!
const lengths = (p: SitePlanData) => p.sides.map(s => r1(drawnFt(p, s)))

describe('posts and sides', () => {
  test('typing a side\'s length moves its far post along the side; the first post stays; the next side follows', () => {
    const s = plan.sides[2]
    const next = setSideLength(plan, s.id, 142)
    expect(r1(drawnFt(next, next.sides[2]))).toBe(142)
    expect(postFeet(next, s.a)).toEqual(postFeet(plan, s.a))
    // Side 3 still runs the same way.
    const a = postFeet(plan, s.a)!, b0 = postFeet(plan, s.b)!, b1 = postFeet(next, s.b)!
    const cross = (b0.x - a.x) * (b1.y - a.y) - (b0.y - a.y) * (b1.x - a.x)
    expect(Math.abs(cross)).toBeLessThan(0.5)
    // Side 4 starts at the moved post: its length changes, the others do not.
    expect(lengths(next)[0]).toBe(30)
    expect(lengths(next)[1]).toBe(120)
  })

  test('moving a post asks that side\'s feet again (its answer is dropped); other answers stay', () => {
    const p = { ...plan, answers: { [`len:${plan.sides[2].id}`]: { kind: 'keep' as const, note: 'n', by: 'o', at: 'x' }, [`len:${plan.sides[0].id}`]: { kind: 'keep' as const, note: 'n', by: 'o', at: 'x' } } }
    const next = movePost(p, plan.sides[2].b, { x: 0, y: 0 })
    expect(Object.keys(next.answers)).toEqual([`len:${plan.sides[0].id}`])
  })

  test('snapping: a post dragged 3 degrees off square is held square to the neighbouring side; 10 degrees off is left free', () => {
    const s = plan.sides[1] // its b is the corner between side 2 and 3; dragging side 3's far post
    const side3 = plan.sides[2]
    const q = postFeet(plan, side3.a)!, b = postFeet(plan, side3.b)!
    const len = Math.hypot(b.x - q.x, b.y - q.y)
    const base = Math.atan2(b.y - q.y, b.x - q.x)
    const off = (deg: number) => ({ x: q.x + len * Math.cos(base + (deg * Math.PI) / 180), y: q.y + len * Math.sin(base + (deg * Math.PI) / 180) })
    // Only side 3 holds this post when side 4 is taken off.
    const lone = removeSide(removeSide(plan, plan.sides[3].id), plan.sides[4].id)
    const near = snapSquare(lone, side3.b, off(3))
    expect(near.held).toBe(true)
    const ang = Math.atan2(near.at.y - q.y, near.at.x - q.x)
    expect(Math.abs(ang - base)).toBeLessThan(1e-6)
    expect(snapSquare(lone, side3.b, off(10)).held).toBe(false)
    // A long side: 3 degrees off is about 7.9 ft at 150 ft; held only when that is within the drag's reach.
    expect(snapSquare(lone, side3.b, off(3), 4, 5).held).toBe(false)
    expect(snapSquare(lone, side3.b, off(3), 4, 10).held).toBe(true)
    void s
  })

  test('snapping: 45 degrees counts too', () => {
    const p0 = addSide({ ...plan, posts: [], sides: [] }, { x: 0, y: 0 }, { x: 100, y: 0 })
    const p1 = addSide(p0, p0.sides[0].b, { x: 100 + 50 * Math.cos(Math.PI / 4 + 0.05), y: 50 * Math.sin(Math.PI / 4 + 0.05) })
    const r = snapSquare(p1, p1.sides[1].b, postFeet(p1, p1.sides[1].b)!)
    expect(r.held).toBe(true)
    const d = { x: r.at.x - 100, y: r.at.y }
    expect(Math.abs(Math.atan2(d.y, d.x) - Math.PI / 4)).toBeLessThan(1e-6)
  })

  test('snapping onto a property line or the house wall within the distance; farther stays put', () => {
    const p = { ...plan, house: [houseRect(plan.origin, { x: -10, y: -10 }, { x: 10, y: 10 })] }
    const edges = snapEdges(p)
    expect(edges.length).toBe(4)
    const hit = snapToEdges({ x: 11, y: 0 }, edges, 1.5)
    expect(hit.held).toBe(true)
    expect(Math.abs(hit.at.x - 10)).toBeLessThan(0.01)
    expect(snapToEdges({ x: 13, y: 0 }, edges, 1.5).held).toBe(false)
  })

  test('moving and turning the whole plan keeps every side\'s feet', () => {
    const moved = turnPlan(movePlan(plan, { x: 40, y: -25 }), 33)
    expect(lengths(moved)).toEqual(lengths(plan))
    expect(postFeet(movePlan(plan, { x: 40, y: -25 }), plan.posts[0].id)!.x).toBeCloseTo(postFeet(plan, plan.posts[0].id)!.x + 40, 3)
  })

  test('a side drawn on the plan has no quoted feet; taking it off takes its lone post too', () => {
    const p = addSide(plan, plan.sides[4].b, { x: 500, y: 500 })
    expect(p.sides.length).toBe(6)
    expect(p.sides[5].quotedFt).toBeNull()
    expect(p.posts.length).toBe(plan.posts.length + 1)
    const back = removeSide(p, p.sides[5].id)
    expect(back.posts.length).toBe(plan.posts.length)
    expect(sideLabel(p, p.sides[5])).toMatch(/ ft$/)
  })
})

describe('gates', () => {
  test('a gate added and taken off: posts stay where they are', () => {
    const s = plan.sides[2]
    const r = addGate(plan, s.id, { fromEnd: 'b', distFt: 10, widthFt: 4, type: 'walk', swing: 'in', hinge: 'left' })
    if ('error' in r) throw new Error(r.error)
    expect(r.posts).toEqual(plan.posts)
    expect(r.sides[2].gates[0].atFt).toBeCloseTo(150 - 10 - 4, 1)
    const off = removeGate(r, s.id, r.sides[2].gates[0].id)
    expect(off.posts).toEqual(plan.posts)
    expect(off.sides[2].gates).toEqual([])
  })

  test('a gate that does not fit or overlaps is refused in plain words', () => {
    const s = plan.sides[0]
    expect(gatePlace(plan, s, { fromEnd: 'a', distFt: 28, widthFt: 4 })).toEqual({ error: expect.stringMatching(/does not fit/) })
    expect(gatePlace(plan, s, { fromEnd: 'a', distFt: 12, widthFt: 4 })).toEqual({ error: expect.stringMatching(/overlaps/) })
    expect(gatePlace(plan, s, { fromEnd: 'a', distFt: 20, widthFt: 4 })).toEqual({ atFt: 20 })
  })
})

describe('undo and redo', () => {
  test('push, undo, redo; a new change empties redo; a drag is one step', () => {
    let h = historyOf(1)
    h = historyPush(h, 2); h = historyPush(h, 3)
    h = historyUndo(h); expect(h.now).toBe(2)
    h = historyUndo(h); expect(h.now).toBe(1)
    h = historyUndo(h); expect(h.now).toBe(1)
    h = historyRedo(h); expect(h.now).toBe(2)
    h = historyPush(h, 9); expect(h.future).toEqual([])
    h = historyRedo(h); expect(h.now).toBe(9)
    // A drag: one push at its start, replaced while it moves.
    h = historyPush(h, 10); h = historyReplace(h, 11); h = historyReplace(h, 12)
    h = historyUndo(h); expect(h.now).toBe(9)
  })
})

describe('the survey under the plan', () => {
  test('picture to map and back; two points 50 ft apart set its scale; turning keeps the scale', () => {
    const s0 = placeSurvey(OCALA, { url: '/x.png', w: 1000, h: 800 }, { x: 0, y: 0 }, 200)
    const mid = surveyToFeet(OCALA, s0, { x: 500, y: 400 })
    expect(Math.hypot(mid.x, mid.y)).toBeLessThan(0.01)
    const back = feetToSurvey(OCALA, s0, surveyToFeet(OCALA, s0, { x: 123, y: 456 }))
    expect(back.x).toBeCloseTo(123, 3); expect(back.y).toBeCloseTo(456, 3)
    // Up on the picture is north.
    expect(surveyToFeet(OCALA, s0, { x: 500, y: 0 }).y).toBeGreaterThan(0)
    const s1 = scaleSurvey(OCALA, s0, { x: 100, y: 100 }, { x: 400, y: 500 }, 50)!
    const a = surveyToFeet(OCALA, s1, { x: 100, y: 100 }), b = surveyToFeet(OCALA, s1, { x: 400, y: 500 })
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(50, 3)
    // The first point stayed where it was.
    const a0 = surveyToFeet(OCALA, s0, { x: 100, y: 100 })
    expect(a.x).toBeCloseTo(a0.x, 3)
    const s2 = turnSurvey(OCALA, s1, 30)
    const a2 = surveyToFeet(OCALA, s2, { x: 100, y: 100 }), b2 = surveyToFeet(OCALA, s2, { x: 400, y: 500 })
    expect(Math.hypot(b2.x - a2.x, b2.y - a2.y)).toBeCloseTo(50, 3)
  })
})

describe('the quote changed to the drawn length (through the builder)', () => {
  test('a walked side drawn 142 ft: the walk\'s other steps are kept, its steps total 142 ft, the price\'s yard follows', () => {
    const s = plan.sides[2]
    const w = walkWithSideFeet(walk, s.walkStepIds, ft(142))!
    const before = walk.lines[0].steps, after = w.lines[0].steps
    expect(after.map(x => x.id)).toEqual(before.map(x => x.id))
    after.forEach((x, i) => { if (!s.walkStepIds.includes(x.id)) expect(x).toEqual(before[i]) })
    expect(walkToYard(w).sides[2].lengthIn).toBe(ft(142))
    // Side 1 (13 ft, a 4 ft gate, 13 ft) to 34 ft: the last stretch takes it.
    const w1 = walkWithSideFeet(walk, plan.sides[0].walkStepIds, ft(34))!
    expect(w1.lines[0].steps[0].feetIn).toBe(ft(13))
    expect(w1.lines[0].steps[1].feetIn).toBe(ft(17))
    // Shorter than the last stretch: the stretch before gives the rest.
    const w2 = walkWithSideFeet(walk, plan.sides[0].walkStepIds, ft(14))!
    expect(w2.lines[0].steps[1].feetIn).toBe(0)
    expect(w2.lines[0].steps[0].feetIn).toBe(ft(10))
    // Steps no longer on the walk: no change.
    expect(walkWithSideFeet(walk, ['gone'], ft(10))).toBeNull()
  })

  test('an older drawing\'s side to the drawn length; the others kept', () => {
    const y = layoutForShape('backyard')
    ;[30, 120, 150, 120, 30].forEach((n, i) => { y.sides[i].lengthIn = ft(n) })
    const y2 = yardWithSideFeet(y, y.sides[2].id, ft(142))!
    expect(y2.sides.map(s => s.lengthIn)).toEqual([30, 120, 142, 120, 30].map(ft))
    expect(y.sides[2].lengthIn).toBe(ft(150))
  })

  test('a gate put in on a walked side: the side keeps its feet, the gate is where it was put, the count is one more', () => {
    const s = plan.sides[2]
    const w = walkWithGate(walk, s.walkStepIds, ft(60), { widthIn: 48, type: 'walk' })!
    const y = walkToYard(w)
    expect(y.sides[2].lengthIn).toBe(ft(150))
    const r = deriveLayout(y)
    expect(r.walkGates).toBe(deriveLayout(yard).walkGates + 1)
    const g = (y.sides[2].gate ?? y.sides[2].gates?.[0])!
    expect(g.distanceIn).toBe(ft(60))
    // Across a gate already there: refused.
    expect(walkWithGate(walk, plan.sides[0].walkStepIds, ft(11), { widthIn: 48, type: 'walk' })).toBeNull()
  })

  test('a gate put in on an older drawing\'s side', () => {
    const y = layoutForShape('backyard')
    ;[30, 120, 150, 120, 30].forEach((n, i) => { y.sides[i].lengthIn = ft(n) })
    const y2 = yardWithGate(y, y.sides[2].id, ft(60), { widthIn: 120, type: 'double' })!
    expect(deriveLayout(y2).dblGates).toBe(deriveLayout(y).dblGates + 1)
    expect(yardWithGate(y, y.sides[2].id, ft(149), { widthIn: 48, type: 'walk' })).toBeNull()
  })
})

describe('labels', () => {
  test('one number when drawn as quoted; both when they differ; the wheel number when kept', () => {
    expect(sideLabel(plan, plan.sides[2])).toBe('150 ft')
    const moved = setSideLength(plan, plan.sides[2].id, 142)
    expect(sideLabel(moved, moved.sides[2])).toBe('Quoted 150 ft / Drawn 142 ft')
    const kept = { ...moved, answers: { [`len:${moved.sides[2].id}`]: { kind: 'keep' as const, note: 'n', by: 'o', at: 'x' } } }
    expect(sideLabel(kept, kept.sides[2])).toBe('150 ft (wheel)')
    void toFeet; void fromFeet
  })
})

describe('from the job\'s quote', () => {
  test('the button: a walked quote is drawn, an older drawing placed, a typed one drawn from nothing', () => {
    expect(startOf({ walk, yard })).toEqual({ what: 'draw', label: 'Draw site plan' })
    expect(startOf({ yard: layoutForShape('backyard') })).toEqual({ what: 'place', label: 'Place on map' })
    expect(startOf({ yard: null, runSections: [] }).what).toBe('blank')
    expect(startOf(null).what).toBe('blank')
  })
  test('the yard flags are counted against: the walk list\'s when walked, else the drawing', () => {
    expect(quoteYardOf({ walk, yard: null })!.sides.map(s => s.lengthIn)).toEqual(yard.sides.map(s => s.lengthIn))
    const y = layoutForShape('backyard')
    expect(quoteYardOf({ yard: y })).toBe(y)
    expect(quoteYardOf(null)).toBeNull()
  })
  test('one side\'s change goes to the walk list and to the yard made from it alike', () => {
    const s = plan.sides[2]
    const e = sideFeetEdit(s, ft(142))
    expect(walkToYard(e.walk!(walk)!).sides[2].lengthIn).toBe(ft(142))
    expect(e.yard!(yard)!.sides[2].lengthIn).toBe(ft(142))
  })
  test('old and new prices side by side, cents, matched by fence', () => {
    const before = [{ label: 'Good', fenceStyle: 'A', finalPrice: 9800 }, { label: 'Better', fenceStyle: 'B', finalPrice: 11000.5 }]
    const after = [{ label: 'Better', fenceStyle: 'B', finalPrice: 10800 }, { label: 'Good', fenceStyle: 'A', finalPrice: 9650 }, { label: 'Best', fenceStyle: 'C', finalPrice: 12000 }]
    expect(optionPairs(before, after)).toEqual([
      { name: 'Good', was: 980000, now: 965000 },
      { name: 'Better', was: 1100050, now: 1080000 },
      { name: 'Best', was: null, now: 1200000 },
    ])
  })
})

describe('change orders from the plan stack on the job as it is now', () => {
  test('a second change on a side keeps the first one\'s gate (CO-1 gate, then CO-2 longer, then CO-3 another gate)', () => {
    const s = plan.sides[2]
    // CO-1: a 4 ft gate 60 ft in, on the walk the builder opens with.
    const w1 = walkWithGate(walk, s.walkStepIds, ft(60), { widthIn: 48, type: 'walk' })!
    // The new gate step is counted with its side, though the plan never knew its id.
    expect(sideStepsNow(w1, s.walkStepIds)!.length).toBe(2)
    // CO-2: the side to 160 ft on that walk: the gate stays, the side is 160 ft, nothing else moves.
    const w2 = walkWithSideFeet(w1, s.walkStepIds, ft(160))!
    const y2 = walkToYard(w2)
    expect(y2.sides[2].lengthIn).toBe(ft(160))
    expect(deriveLayout(y2).walkGates).toBe(deriveLayout(yard).walkGates + 1)
    expect(y2.sides.map(x => x.lengthIn).filter((_, i) => i !== 2)).toEqual(yard.sides.map(x => x.lengthIn).filter((_, i) => i !== 2))
    // CO-3: another gate 100 ft in (past the first): both gates, the feet unchanged.
    const w3 = walkWithGate(w2, s.walkStepIds, ft(100), { widthIn: 48, type: 'walk' })!
    const y3 = walkToYard(w3)
    expect(y3.sides[2].lengthIn).toBe(ft(160))
    expect(deriveLayout(y3).walkGates).toBe(deriveLayout(yard).walkGates + 2)
    expect((y3.sides[2].gates ?? []).map(g => g.distanceIn)).toEqual([ft(60), ft(100)])
  })
})

describe('the fence the plan is checked against', () => {
  test('the job\'s fence now (a change order\'s gate in it) wins over the quote as first signed; no question for that gate', async () => {
    const { fenceNowYard } = await import('../../web/src/sitePlanEdit')
    const { planFlags } = await import('../../web/src/sitePlanData')
    const s = plan.sides[2]
    // CO-1's gate is on the plan now (applied when it was signed).
    const withGate = addGate(plan, s.id, { fromEnd: 'a', distFt: 60, widthFt: 4, type: 'walk', swing: 'in', hinge: 'left' }) as SitePlanData
    const signed = { quote: { layout: { walk, yard } } }
    expect(planFlags(withGate, fenceNowYard(signed)).map(f => f.key)).toContain('gates')
    const now = walkToYard(walkWithGate(walk, s.walkStepIds, ft(60), { widthIn: 48, type: 'walk' })!)
    expect(fenceNowYard({ ...signed, current: { yard: now } })).toBe(now)
    expect(planFlags(withGate, fenceNowYard({ ...signed, current: { yard: now } })).map(f => f.key)).not.toContain('gates')
    // No fence from the server yet: the quote's walk list.
    expect(fenceNowYard({ ...signed, current: null })!.sides.length).toBe(yard.sides.length)
  })
})
