/**
 * The site plan draws exactly the posts the quote is priced with: corner
 * squares = corner posts, filled dots = end and gate posts, open dots = line
 * posts at each run's section count.
 */

import { describe, test, expect } from 'vitest'
import { layoutForShape, deriveLayout, type YardLayout } from '../../web/src/yardLayout'
import { buildPlan, autoVertices, centeredVertices, aerialFtPerPx, aerialUrl, layoutSignature, planVertices } from '../../web/src/sitePlanGeometry'

const ft = (n: number) => n * 12

function backyard(): YardLayout {
  const l = layoutForShape('backyard')
  const [lr, ls, back, rs, rr] = l.sides
  lr.lengthIn = ft(30); lr.gate = { type: 'walk', widthIn: 48, position: 'middle' }
  ls.lengthIn = ft(120)
  back.lengthIn = ft(150); back.skip = { kind: 'existing', lengthIn: ft(40), position: 'middle' }
  rs.lengthIn = ft(120)
  rr.lengthIn = ft(30); rr.gate = { type: 'double', widthIn: 120, position: 'middle' }
  return l
}
const count = (plan: ReturnType<typeof buildPlan>, kind: string) => plan.posts.filter(p => p.kind === kind).length

describe('site plan posts match the priced posts', () => {
  test('backyard with gates and an existing fence skip', () => {
    const l = backyard()
    const r = deriveLayout(l)
    // 8 ft sections: 13,13 | 120 | 55,55 | 120 | 10,10
    const secs = [2, 2, 15, 7, 7, 15, 2, 2]
    const plan = buildPlan(l, r, secs)
    expect(count(plan, 'corner')).toBe(r.corners)
    expect(count(plan, 'end') + count(plan, 'gate')).toBe(r.ends)
    expect(count(plan, 'line')).toBe(secs.reduce((t, n) => t + n - 1, 0))
    expect(plan.sides.find(s => s.name === 'Back')!.skip?.kind).toBe('existing')
    expect(plan.sides.find(s => s.name === 'Back')!.sublabel).toBe('Back · 14 sections')
    expect(plan.house).not.toBeNull()
    expect(plan.street).toBe(true)
  })

  test('sides that are off are not drawn', () => {
    const l = backyard()
    l.sides[3].on = false; l.sides[4].on = false
    const plan = buildPlan(l, deriveLayout(l))
    expect(plan.sides.map(s => s.name)).toEqual(['Left return', 'Left side', 'Back'])
  })

  test('gates swing into the yard', () => {
    const l = backyard()
    const plan = buildPlan(l, deriveLayout(l))
    // The returns run along y = 0 with the yard above them (y > 0).
    for (const s of plan.sides.filter(x => x.gate)) expect(s.gate!.swing.y).toBeGreaterThan(0)
  })

  test('a straight run is two end posts and its line posts', () => {
    const l = layoutForShape('straight')
    l.sides[0].lengthIn = ft(81)
    const plan = buildPlan(l, deriveLayout(l), [11])
    expect([count(plan, 'corner'), count(plan, 'end'), count(plan, 'line')]).toEqual([0, 2, 10])
    expect(plan.house).toBeNull()
    expect(plan.street).toBe(false)
  })

  test('a perimeter closes on its first corner', () => {
    const l = layoutForShape('perimeter')
    l.sides.forEach(s => { s.lengthIn = ft(100) })
    expect(autoVertices(l)).toHaveLength(4)
    expect(count(buildPlan(l, deriveLayout(l)), 'corner')).toBe(4)
  })

  test('corners dragged by hand (an older quote) keep their angle; the side is drawn at its typed length', () => {
    const l = layoutForShape('straight')
    l.sides[0].lengthIn = ft(50)
    l.plan = { points: [{ x: 5, y: 5 }, { x: 40, y: 30 }] }
    const v = buildPlan(l, deriveLayout(l)).vertices
    expect(v[0]).toEqual({ x: 5, y: 5 })
    expect(Math.atan2(v[1].y - v[0].y, v[1].x - v[0].x)).toBeCloseTo(Math.atan2(25, 35), 9)
    expect(dist(v[0], v[1])).toBeCloseTo(50, 9)
  })
})

function yard(left: number, right: number, back: number, lr = 30, rr = 30): YardLayout {
  const l = layoutForShape('backyard')
  ;[lr, left, back, right, rr].forEach((n, i) => { l.sides[i].lengthIn = ft(n) })
  return l
}
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
const level = (pts: Array<{ x: number; y: number }>) => {
  // Every edge of the house is either flat or straight up and down.
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    if (Math.abs(a.x - b.x) > 1e-9 && Math.abs(a.y - b.y) > 1e-9) return false
  }
  return true
}

describe('backyard drawing: the house is level, the sides go straight back, the back takes up the difference', () => {
  test('left 120, right 100, back 150, returns 30 and 30', () => {
    const l = yard(120, 100, 150)
    const plan = buildPlan(l, deriveLayout(l))
    const v = plan.vertices
    // House square and level at the bottom, its back wall at y = 0, between the returns.
    expect(plan.house).toHaveLength(4)
    expect(level(plan.house!)).toBe(true)
    const hx = plan.house!.map(p => p.x), hy = plan.house!.map(p => p.y)
    expect(Math.max(...hy)).toBeCloseTo(0, 9)
    expect(plan.houseNotToScale).toBe(false)
    // Width from the back and the difference in the sides: sqrt(150² − 20²).
    const width = Math.sqrt(150 ** 2 - 20 ** 2)
    expect(v[3].x - v[1].x).toBeCloseTo(width, 6)
    expect(Math.max(...hx) - Math.min(...hx)).toBeCloseTo(width - 60, 6)
    // Returns level from the house to the sides, meeting the house at its back corners.
    expect(v[0]).toEqual({ x: Math.min(...hx), y: 0 })
    expect(v[5]).toEqual({ x: Math.max(...hx), y: 0 })
    expect(v[1].y).toBe(0); expect(v[4].y).toBe(0)
    // Sides straight back at their own lengths; the back joins their ends at an angle.
    expect(v[2].x).toBe(v[1].x); expect(v[3].x).toBe(v[4].x)
    expect(dist(v[0], v[1])).toBeCloseTo(30, 9)
    expect(dist(v[1], v[2])).toBeCloseTo(120, 9)
    expect(dist(v[2], v[3])).toBeCloseTo(150, 9)
    expect(dist(v[3], v[4])).toBeCloseTo(100, 9)
    expect(dist(v[4], v[5])).toBeCloseTo(30, 9)
    expect(v[2].y - v[3].y).toBeCloseTo(20, 9)
    // Labels are the typed lengths.
    expect(plan.sides.map(s => s.label)).toEqual([`30' 0"`, `120' 0"`, `150' 0"`, `100' 0"`, `30' 0"`])
    expect(plan.sides.map(s => s.sublabel.split(' · ')[0])).toEqual(['Left return', 'Left side', 'Back', 'Right side', 'Right return'])
    expect(plan.notes).toEqual([])
  })

  test('equal sides still draw a clean rectangle', () => {
    const l = yard(120, 120, 150)
    const v = buildPlan(l, deriveLayout(l)).vertices
    // Drawn from where the left return meets the house, as before.
    expect(v).toEqual([{ x: 0, y: 0 }, { x: -30, y: 0 }, { x: -30, y: 120 }, { x: 120, y: 120 }, { x: 120, y: 0 }, { x: 90, y: 0 }])
    expect(buildPlan(l, deriveLayout(l)).house).toEqual([{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: -30 }, { x: 0, y: -30 }])
  })

  test('a return can meet the house at its front corner or a typed distance', () => {
    const l = yard(120, 120, 150)
    l.sides[0].meetsHouse = { at: 'front' }
    l.sides[4].meetsHouse = { at: 'distance', distanceIn: ft(10) }
    const plan = buildPlan(l, deriveLayout(l))
    const v = plan.vertices
    expect(v[0].y).toBe(-30); expect(v[1].y).toBe(-30)
    expect(v[4].y).toBe(-10); expect(v[5].y).toBe(-10)
    expect(dist(v[1], v[2])).toBeCloseTo(120, 9)
    expect(dist(v[2], v[3])).toBeCloseTo(150, 9)
    expect(level(plan.house!)).toBe(true)
    // The returns end on the house walls.
    expect(v[0].x).toBeCloseTo(Math.min(...plan.house!.map(p => p.x)), 9)
    expect(v[5].x).toBeCloseTo(Math.max(...plan.house!.map(p => p.x)), 9)
  })

  test('measurements that cannot fit still draw, with a gentle note', () => {
    const l = yard(120, 40, 50)
    const plan = buildPlan(l, deriveLayout(l))
    expect(plan.notes[0]).toMatch(/^Check these measurements: the back \(50' 0"\) is shorter than the difference/)
    expect(plan.vertices.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    expect(level(plan.house!)).toBe(true)
  })

  test('no returns: a stand-in house, centered and marked not to scale', () => {
    const l = yard(100, 100, 120)
    l.sides[0].on = false; l.sides[4].on = false
    l.sides[1].startFinish = 'house'; l.sides[3].endFinish = 'house'
    const plan = buildPlan(l, deriveLayout(l))
    expect(plan.houseNotToScale).toBe(true)
    const hx = plan.house!.map(p => p.x), v = plan.vertices
    expect((Math.min(...hx) + Math.max(...hx)) / 2).toBeCloseTo((v[1].x + v[4].x) / 2, 9)
    expect(level(plan.house!)).toBe(true)
  })

  test('returns that leave too little room for the house: stand-in house', () => {
    const l = yard(100, 100, 70, 30, 30)
    expect(buildPlan(l, deriveLayout(l)).houseNotToScale).toBe(true)
  })

  test('a corner dragged by hand (an older quote) moves the drawing only, and its angle stays when a length changes', () => {
    const l = yard(120, 100, 150)
    const before = deriveLayout(l)
    const pts = autoVertices(l).map(p => ({ ...p }))
    pts[2] = { x: pts[2].x - 15, y: pts[2].y + 6 }
    l.plan = { points: pts, pointsFor: layoutSignature(l) }
    const after = deriveLayout(l)
    const dirOf = (v: Array<{ x: number; y: number }>, i: number) => Math.atan2(v[i + 1].y - v[i].y, v[i + 1].x - v[i].x)
    // The left side keeps the dragged direction, drawn at its typed 120 ft.
    expect(dirOf(planVertices(l), 1)).toBeCloseTo(dirOf(pts, 1), 9)
    expect(dist(planVertices(l)[1], planVertices(l)[2])).toBeCloseTo(120, 9)
    expect(after.runs.map(r => r.ft)).toEqual(before.runs.map(r => r.ft))
    expect(after.corners).toBe(before.corners)
    expect(buildPlan(l, after).sides[1].label).toBe(`120' 0"`)
    // A typed length changes: the typed numbers win, the dragged angle stays (no reset).
    l.sides[1].lengthIn = ft(110)
    expect(dirOf(planVertices(l), 1)).toBeCloseTo(dirOf(pts, 1), 9)
    expect(dist(planVertices(l)[1], planVertices(l)[2])).toBeCloseTo(110, 9)
  })

  test('a new backyard with nothing typed: no warnings, every side drawn, house level', () => {
    const l = layoutForShape('backyard')
    const plan = buildPlan(l, deriveLayout(l))
    expect(plan.notes).toEqual([])
    expect(plan.sides.every(sd => Math.hypot(sd.b.x - sd.a.x, sd.b.y - sd.a.y) > 1)).toBe(true)
    expect(level(plan.house!)).toBe(true)
  })

  test('the corner posts are the ones that can be dragged', () => {
    const l = yard(120, 100, 150)
    expect(buildPlan(l, deriveLayout(l)).corners).toEqual([1, 2, 3, 4])
  })

  test('a front yard: house level at the top, the front angled when the sides differ', () => {
    const l = layoutForShape('front')
    ;[40, 60, 30].forEach((n, i) => { l.sides[i].lengthIn = ft(n) })
    const plan = buildPlan(l, deriveLayout(l))
    const v = plan.vertices
    expect(level(plan.house!)).toBe(true)
    expect(Math.min(...plan.house!.map(p => p.y))).toBe(0)
    expect(dist(v[0], v[1])).toBeCloseTo(40, 9)
    expect(dist(v[1], v[2])).toBeCloseTo(60, 9)
    expect(dist(v[2], v[3])).toBeCloseTo(30, 9)
    expect(v[0].y).toBe(0); expect(v[3].y).toBe(0)
  })
})

describe('aerial photo', () => {
  test('centered drawing and photo scale', () => {
    const l = layoutForShape('straight')
    l.sides[0].lengthIn = ft(100)
    expect(centeredVertices(l)).toEqual([{ x: -50, y: 0 }, { x: 50, y: 0 }])
    // 80 m across 800 px = 0.1 m = 0.328 ft per pixel
    expect(aerialFtPerPx(40)).toBeCloseTo(0.328, 3)
    expect(aerialUrl(29.09, -82.17, 40)).toMatch(/^https:\/\/imagery\.nationalmap\.gov\/arcgis\/rest\/services\/USGSNAIPPlus\/ImageServer\/exportImage\?bbox=/)
  })
})
