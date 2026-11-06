/**
 * The office site plan's core (web/src/sitePlanData.ts; Jonathan, Nov 5 2026,
 * Prompt 2): true feet on the map, a walk list laid out at its quoted feet, an
 * older drawing placed where it was drawn on its photo, quoted vs drawn flags,
 * the crew's numbered posts, property line warnings.
 */

import { describe, test, expect } from 'vitest'
import { applyChange, walkingOrder, planFromYard, planFlags, openFlags, crewPosts, drawnFt, toFeet, fromFeet, feetBetween, propertyLineWarnings, sectionsAt, quoteSectionsOf, type SitePlanData } from '../../web/src/sitePlanData'
import { walkToYard, type WalkList } from '../../web/src/walkList'
import { layoutForShape, deriveLayout } from '../../web/src/yardLayout'

const OCALA = { lat: 29.1872, lng: -82.1401 }
const ft = (n: number) => n * 12
let k = 0
const step = (feet: number, what: any, extra: any = {}) => ({ id: `t${k++}`, feetIn: ft(feet), what, ...extra })

describe('true feet on the map', () => {
  test('feet to a place and back again, within a hundredth of a foot; 100 ft east is 100 ft', () => {
    for (const p of [{ x: 100, y: 0 }, { x: -37.5, y: 212.25 }, { x: 0, y: -500 }]) {
      const back = toFeet(OCALA, fromFeet(OCALA, p))
      expect(Math.abs(back.x - p.x) + Math.abs(back.y - p.y)).toBeLessThan(0.01)
    }
    expect(Math.abs(feetBetween(OCALA, fromFeet(OCALA, { x: 100, y: 0 })) - 100)).toBeLessThan(0.01)
  })
})

describe('the plan from the quote', () => {
  const walk: WalkList = { v: 1, lines: [{ id: 'a', steps: [step(13, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(13, 'corner', { turn: 'right' }), step(120, 'corner', { turn: 'right' }), step(150, 'corner', { turn: 'right' }), step(120, 'corner', { turn: 'right' }), step(30, 'end')] }] }
  const yard = walkToYard(walk)
  const plan = planFromYard(yard, OCALA, walk)!

  test('a walk list: one side per walked side at its quoted feet, square corners, the gate 13 ft in, each side linked to its walk steps', () => {
    expect(plan.sides.map(s => s.quotedFt)).toEqual([30, 120, 150, 120, 30])
    expect(plan.sides.map(s => Math.round(drawnFt(plan, s) * 10) / 10)).toEqual([30, 120, 150, 120, 30])
    expect(plan.posts.length).toBe(6)
    expect(plan.sides[0].gates).toEqual([expect.objectContaining({ atFt: 13, widthFt: 4, type: 'walk' })])
    expect(plan.sides[0].walkStepIds).toEqual([walk.lines[0].steps[0].id, walk.lines[0].steps[1].id])
    expect(plan.sides[4].walkStepIds).toEqual([walk.lines[0].steps[5].id])
    expect(plan.startPostId).toBe(plan.sides[0].a)
    // Side 2 runs at a right angle to side 1.
    const v = (s: number) => { const a = plan.posts.find(p => p.id === plan.sides[s].a)!, b = plan.posts.find(p => p.id === plan.sides[s].b)!; return toFeet(a, b) }
    const d = v(0).x * v(1).x + v(0).y * v(1).y
    expect(Math.abs(d)).toBeLessThan(0.5)
  })

  test('drawn as quoted: no flags; a side dragged 8 ft short: one flag, which an answer clears', () => {
    expect(planFlags(plan, yard)).toEqual([])
    const moved: SitePlanData = JSON.parse(JSON.stringify(plan))
    const s = moved.sides[2], a = moved.posts.find(p => p.id === s.a)!, b = moved.posts.find(p => p.id === s.b)!
    const v = toFeet(a, b), k2 = 142 / 150
    Object.assign(b, fromFeet(a, { x: v.x * k2, y: v.y * k2 }))
    const flags = planFlags(moved, yard)
    expect(flags.find(f => f.key === `len:${s.id}`)?.text).toMatch(/quoted 150 ft, drawn 142 ft/)
    moved.answers[`len:${s.id}`] = { kind: 'keep', note: 'Wheel checked twice', by: 'Office', at: '2026-11-06' }
    expect(openFlags(moved, flags).filter(f => f.key === `len:${s.id}`)).toEqual([])
  })

  test('within 3 ft or 3%: no flag (a 150 ft side drawn 146 ft is within 4.5 ft)', () => {
    const moved: SitePlanData = JSON.parse(JSON.stringify(plan))
    const s = moved.sides[2], a = moved.posts.find(p => p.id === s.a)!, b = moved.posts.find(p => p.id === s.b)!
    const v = toFeet(a, b)
    Object.assign(b, fromFeet(a, { x: v.x * (146 / 150), y: v.y * (146 / 150) }))
    expect(planFlags(moved, yard).filter(f => f.kind === 'length')).toEqual([])
  })

  test('a gate taken off the plan, a side added: flagged as the fence\'s makeup', () => {
    const moved: SitePlanData = JSON.parse(JSON.stringify(plan))
    moved.sides[0].gates = []
    expect(planFlags(moved, yard).map(f => f.key)).toContain('gates')
    moved.sides.push({ ...moved.sides[4], id: 'extra', quotedFt: null, gates: [] })
    expect(planFlags(moved, yard).map(f => f.key)).toContain('sides')
  })

  test('the crew\'s posts: numbered from the start, corners counted once, line posts per piece, gate posts', () => {
    const { posts, sides } = crewPosts(plan, (_id, pieceFt) => sectionsAt(pieceFt, 8))
    expect(posts[0]).toEqual(expect.objectContaining({ n: 1, kind: 'end' }))
    expect(posts.filter(p => p.kind === 'corner').length).toBe(4)
    expect(posts.filter(p => p.kind === 'end').length).toBe(2)
    expect(posts.filter(p => p.kind === 'gate').length).toBe(2)
    // 13 ft pieces: 2 sections each, 1 line post; 120 ft: 15 sections, 14; 150: 19, 18; 30: 4, 3.
    expect(posts.filter(p => p.kind === 'line').length).toBe(1 + 1 + 14 + 18 + 14 + 3)
    expect(sides[0].pieces).toEqual([{ ft: 13, sections: 2, spacingFt: 6.5 }, { ft: 13, sections: 2, spacingFt: 6.5 }])
  })

  test('a gate that starts at a corner hangs on the corner post: no second post on the same spot', () => {
    const w: WalkList = { v: 1, lines: [{ id: 'g', steps: [step(40, 'corner', { turn: 'right' }), step(0, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(36, 'end')] }] }
    const p = planFromYard(walkToYard(w), OCALA, w)!
    const { posts } = crewPosts(p, (_id, pieceFt) => sectionsAt(pieceFt, 8))
    expect(posts.filter(x => x.kind === 'gate').length).toBe(1)
    const spots = posts.map(x => `${x.at.lat.toFixed(7)},${x.at.lng.toFixed(7)}`)
    expect(new Set(spots).size).toBe(spots.length)
  })

  test('an older drawing with its aerial photo: posts where they were drawn on the photo, its feet the quote\'s', () => {
    const y = layoutForShape('backyard')
    ;[30, 120, 150, 120, 30].forEach((n, i) => { y.sides[i].lengthIn = ft(n) })
    y.plan = { aerial: { ...OCALA, halfM: 40, address: '1 Test St', rotDeg: 30, planAt: { x: 10, y: -5 } } }
    const p = planFromYard(y, null)!
    expect(p.origin).toEqual(OCALA)
    expect(p.sides.map(s => Math.round(drawnFt(p, s)))).toEqual([30, 120, 150, 120, 30])
    expect(planFlags(p, y)).toEqual([])
  })

  test('property lines: a side outside the parcel is a warning; inside with room, none', () => {
    const ring = [{ x: -200, y: -200 }, { x: 200, y: -200 }, { x: 200, y: 200 }, { x: -200, y: 200 }].map(q => fromFeet(plan.origin, q))
    const withLot: SitePlanData = { ...plan, parcel: { id: '12345-678-90', rings: [ring], source: 'test', fetchedAt: '' } }
    expect(propertyLineWarnings(withLot)).toEqual([])
    expect(propertyLineWarnings(withLot, 150).length).toBeGreaterThan(0)
    const small = [{ x: -40, y: -40 }, { x: 40, y: -40 }, { x: 40, y: 40 }, { x: -40, y: 40 }].map(q => fromFeet(plan.origin, q))
    expect(propertyLineWarnings({ ...plan, parcel: { id: 'x', rings: [small], source: 'test', fetchedAt: '' } }).some(w => /crosses the property line/.test(w))).toBe(true)
  })
})

describe('the crew\'s line posts spaced as the quote counted them (quoteSectionsOf)', () => {
  const walk: WalkList = { v: 1, lines: [{ id: 'q', steps: [step(13, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(13, 'corner', { turn: 'right' }), step(120, 'corner', { turn: 'right' }), step(150, 'end')] }] }
  const yard = walkToYard(walk)
  const plan = planFromYard(yard, OCALA, walk)!
  // The quote's own count per run (as a 6 ft pick would give), in the yard's run order.
  const runs = deriveLayout(yard).runs.filter(r => r.ft > 0)
  const runSections = runs.map(r => Math.ceil(r.ft / 6))

  test('each piece takes its quoted run\'s sections, not whole sections at the style width', () => {
    const { sides } = crewPosts(plan, quoteSectionsOf(plan, yard, runSections, 8))
    expect(sides.map(s => s.pieces.map(p => p.sections))).toEqual([[3, 3], [20], [25]])
    expect(sides[1].pieces[0].spacingFt).toBe(6)
  })

  test('a side redrawn longer and answered "use the drawn length": its pieces fall back to the style width', () => {
    const moved: SitePlanData = JSON.parse(JSON.stringify(plan))
    const s = moved.sides[2], a = moved.posts.find(p => p.id === s.a)!, b = moved.posts.find(p => p.id === s.b)!
    const v = toFeet(a, b)
    Object.assign(b, fromFeet(a, { x: v.x * (161 / 150), y: v.y * (161 / 150) }))
    moved.answers[`len:${s.id}`] = { kind: 'drawn', note: '', by: 'Office', at: '2026-11-06' }
    const { sides } = crewPosts(moved, quoteSectionsOf(moved, yard, runSections, 8))
    expect(sides[2].pieces[0].sections).toBe(21)
    expect(sides[1].pieces[0].sections).toBe(20)
  })

  test('no quote counts (or counts that do not line up with the runs): whole sections at the width', () => {
    const { sides } = crewPosts(plan, quoteSectionsOf(plan, yard, [1, 2], 8))
    expect(sides.map(s => s.pieces.map(p => p.sections))).toEqual([[2, 2], [15], [19]])
  })
})

describe('review fixes (Nov 6 2026)', () => {
  test('a closed pool square (back to start) closes on its first post: 4 posts, 4 sides, no "closes" flag', () => {
    const w: WalkList = { v: 1, lines: [{ id: 'p', steps: [step(20, 'gate', { gate: { widthIn: 48, type: 'walk' } }), step(16, 'corner', { turn: 'right' }), step(40, 'corner', { turn: 'right' }), step(40, 'corner', { turn: 'right' }), step(40, 'start')] }] }
    const y = walkToYard(w)
    const p = planFromYard(y, OCALA, w)!
    expect(p.posts.length).toBe(4)
    expect(p.sides.map(s => Math.round(drawnFt(p, s)))).toEqual([40, 40, 40, 40])
    expect(p.sides[3].b).toBe(p.sides[0].a)
    expect(planFlags(p, y)).toEqual([])
  })

  test('two separate fence lines stay separate (no shared post)', () => {
    const w: WalkList = { v: 1, lines: [{ id: 'x', steps: [step(30, 'corner', { turn: 'left' }), step(20, 'end')] }, { id: 'y', steps: [step(25, 'end')] }] }
    const p = planFromYard(walkToYard(w), OCALA, w)!
    expect(p.posts.length).toBe(5)
    const used = new Map<string, number>()
    for (const s of p.sides) for (const q of [s.a, s.b]) used.set(q, (used.get(q) ?? 0) + 1)
    expect([...used.values()].sort()).toEqual([1, 1, 1, 1, 2])
  })

  test('the crew walks from the start post along the fence, whichever post it is', () => {
    const w: WalkList = { v: 1, lines: [{ id: 'z', steps: [step(30, 'corner', { turn: 'right' }), step(120, 'corner', { turn: 'right' }), step(150, 'corner', { turn: 'right' }), step(120, 'corner', { turn: 'right' }), step(30, 'end')] }] }
    const p = planFromYard(walkToYard(w), OCALA, w)!
    p.startPostId = p.sides[4].b
    expect(walkingOrder(p).map(o => `${o.side.name}${o.flip ? ' back' : ''}`)).toEqual(['Side 5 back', 'Side 4 back', 'Side 3 back', 'Side 2 back', 'Side 1 back'])
    const { posts } = crewPosts(p, (_id, ft) => sectionsAt(ft, 8))
    expect(posts.map(x => x.n)).toEqual(posts.map((_, i) => i + 1))
    expect(posts[0].kind).toBe('end')
  })

  test('a change order put on the plan: a side 100 → 110 ft moves the fence beyond it; a gate is added; quoted feet follow', () => {
    const w: WalkList = { v: 1, lines: [{ id: 'c', steps: [step(60, 'corner', { turn: 'right' }), step(100, 'corner', { turn: 'right' }), step(60, 'end')] }] }
    const p = planFromYard(walkToYard(w), OCALA, w)!
    const longer = applyChange(p, { id: 'c1', coId: 'co', coNumber: 2, kind: 'longer', sideId: p.sides[1].id, newFt: 110, by: 'Office', at: '' })
    expect(longer.sides.map(s => Math.round(drawnFt(longer, s)))).toEqual([60, 110, 60])
    expect(longer.sides[1].quotedFt).toBe(110)
    const gated = applyChange(longer, { id: 'c2', coId: 'co', coNumber: 1, kind: 'gate', sideId: p.sides[0].id, gate: { id: 'g', atFt: 20, widthFt: 4, type: 'walk', swing: 'in', hinge: 'left' }, by: 'Office', at: '' })
    expect(gated.sides[0].gates.length).toBe(1)
    expect(gated.pending ?? []).toEqual([])
  })

  test('a gate count difference cannot be kept: the plan must match the quote or go through it', () => {
    const w: WalkList = { v: 1, lines: [{ id: 'k', steps: [step(60, 'end')] }] }
    const y = walkToYard(w), p = planFromYard(y, OCALA, w)!
    p.sides[0].gates.push({ id: 'extra', atFt: 10, widthFt: 5, type: 'walk', swing: 'in', hinge: 'left' })
    p.answers.gates = { kind: 'keep', note: 'not paid', by: 'Office', at: '' }
    expect(openFlags(p, planFlags(p, y)).map(f => f.key)).toEqual(['gates'])
  })

  test('a closed pool beside a separate open line still closes (each line on its own)', () => {
    const w: WalkList = { v: 1, lines: [
      { id: 'q', steps: [step(40, 'corner', { turn: 'right' }), step(40, 'corner', { turn: 'right' }), step(40, 'corner', { turn: 'right' }), step(40, 'start')] },
      { id: 'r', steps: [step(30, 'corner', { turn: 'left' }), step(20, 'end')] },
    ] }
    const y = walkToYard(w), p = planFromYard(y, OCALA, w)!
    expect(planFlags(p, y).map(f => f.key)).not.toContain('closed')
  })
})
