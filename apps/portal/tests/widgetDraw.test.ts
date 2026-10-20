/**
 * The website quote drawn on the aerial photo (web/src/widgetDraw.ts):
 * ground distance, straight / square snapping, gates splitting a side, the
 * house end suggestion, joining runs, the drawing turned into the quote
 * builder's yard (and back to the ground through the builder's photo), and
 * per run section rounding of what it prices.
 */

import { describe, test, expect } from 'vitest'
import {
  groundFt, toLocalFt, fromLocalFt, metersPerDegree, snapAngle, snapToPoint, nearHouse, joinRuns, toYardLayout, planPointToLatLng,
  photoFtOf, latLngOfPhotoFt, sideLength, runSides, totalFt, drawingProblem, ringHeadings, fitRun,
  type LatLng, type WidgetDrawing, type WidgetRun,
} from '../../web/src/widgetDraw'
import { deriveLayout } from '../../web/src/yardLayout'
import { planVertices, NAIP_MAX_NATIVE_ZOOM } from '../../web/src/sitePlanGeometry'
import { photoBackdrop, planShift, planMiddle, toMercator, MERCATOR_R } from '../../web/src/sitePlanPhoto'
import { sectionsForRun } from '../../web/src/sectionCount'

const OCALA: LatLng = { lat: 29.059091, lng: -82.225946 }
const at = (e: number, n: number) => fromLocalFt(OCALA, { x: e, y: n })
const run = (id: string, pts: LatLng[], extra: Partial<WidgetRun> = {}): WidgetRun => fitRun({ id, pts, start: 'free', end: 'free', typedFt: [], gates: [], ...extra })
const drawingOf = (runs: WidgetRun[]): WidgetDrawing => ({ v: 1, address: '11223 SW 64th Ct Ocala, FL 34476', at: OCALA, runs })

/** Vincenty's inverse formula on WGS84 (the surveyors' reference), meters. */
function vincenty(a: LatLng, b: LatLng): number {
  const A = 6378137, f = 1 / 298.257223563, B = A * (1 - f)
  const L = (b.lng - a.lng) * Math.PI / 180
  const U1 = Math.atan((1 - f) * Math.tan(a.lat * Math.PI / 180)), U2 = Math.atan((1 - f) * Math.tan(b.lat * Math.PI / 180))
  const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2)
  let lam = L, prev = 0, sinS = 0, cosS = 0, sig = 0, cos2a = 0, cos2sm = 0
  for (let i = 0; i < 200; i++) {
    const sl = Math.sin(lam), cl = Math.cos(lam)
    sinS = Math.sqrt((cU2 * sl) ** 2 + (cU1 * sU2 - sU1 * cU2 * cl) ** 2)
    if (sinS === 0) return 0
    cosS = sU1 * sU2 + cU1 * cU2 * cl
    sig = Math.atan2(sinS, cosS)
    const sa = cU1 * cU2 * sl / sinS
    cos2a = 1 - sa * sa
    cos2sm = cos2a ? cosS - 2 * sU1 * sU2 / cos2a : 0
    const C = f / 16 * cos2a * (4 + f * (4 - 3 * cos2a))
    prev = lam
    lam = L + (1 - C) * f * sa * (sig + C * sinS * (cos2sm + C * cosS * (-1 + 2 * cos2sm * cos2sm)))
    if (Math.abs(lam - prev) < 1e-13) break
  }
  const u2 = cos2a * (A * A - B * B) / (B * B)
  const k1 = (Math.sqrt(1 + u2) - 1) / (Math.sqrt(1 + u2) + 1)
  const AA = (1 + k1 * k1 / 4) / (1 - k1), BB = k1 * (1 - 3 / 8 * k1 * k1)
  const dS = BB * sinS * (cos2sm + BB / 4 * (cosS * (-1 + 2 * cos2sm ** 2) - BB / 6 * cos2sm * (-3 + 4 * sinS ** 2) * (-3 + 4 * cos2sm ** 2)))
  return B * AA * (sig - dS)
}

describe('ground distance', () => {
  test('matches Vincenty on the WGS84 ellipsoid to well under an inch, any direction, yard sizes', () => {
    for (const [e, n] of [[100, 0], [0, 100], [70.7, 70.7], [-250, 40], [12, -380], [1500, 900]]) {
      const b = at(e, n)
      const vin = vincenty(OCALA, b) / 0.3048
      expect(Math.abs(groundFt(OCALA, b) - vin)).toBeLessThan(0.02)
    }
  })
  test('the local feet are the feet asked for (to and from)', () => {
    const p = at(123.4, -56.7)
    const d = toLocalFt(OCALA, p)
    expect(d.x).toBeCloseTo(123.4, 6); expect(d.y).toBeCloseTo(-56.7, 6)
  })
  test('a degree of latitude at Ocala is the ellipsoid one (110,837 m), not a sphere\'s (111,195 m)', () => {
    // 111132.954 - 559.822 cos 2φ + 1.175 cos 4φ, the standard series.
    const phi = 29.06 * Math.PI / 180
    expect(metersPerDegree(29.06).lat).toBeCloseTo(111132.954 - 559.822 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi), 0)
  })
  test('a side shows to the nearest foot; a typed length wins and is marked typed', () => {
    const r = run('a', [at(0, 0), at(82.4, 0), at(82.4, 40.6)], { typedFt: [null, 41] })
    expect(sideLength(r, 0)).toMatchObject({ measuredFt: 82, ft: 82, typed: false })
    expect(sideLength(r, 1)).toMatchObject({ measuredFt: 41, typedFt: 41, ft: 41, typed: true })
    const r2 = { ...r, typedFt: [80, null] }
    expect(runSides(r2).map(s => s.ft)).toEqual([80, 41])
    expect(totalFt(drawingOf([r2]))).toBe(121)
  })
})

describe('straight and square', () => {
  test('a corner close to 90 degrees is made exactly 90, keeping its length', () => {
    const a = at(0, 0), b = at(100, 0)
    const cand = at(100 + 6, 80)     // about 4.3 degrees off square
    const s = snapAngle(b, cand, { prevPrev: a })
    expect(s.snapped).toBe(true)
    const d = toLocalFt(b, s.pt)
    expect(Math.abs(d.x)).toBeLessThan(1e-6)
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(Math.hypot(6, 80), 3)
  })
  test('nearly straight on is made straight on', () => {
    const s = snapAngle(at(50, 0), at(120, 4), { prevPrev: at(0, 0) })
    expect(s.snapped).toBe(true)
    expect(Math.abs(toLocalFt(at(50, 0), s.pt).y)).toBeLessThan(1e-6)
  })
  test('a real angle (30 degrees off) is left alone, and doubling back is never a snap', () => {
    expect(snapAngle(at(100, 0), at(100 + 46, 80), { prevPrev: at(0, 0) }).snapped).toBe(false)
    expect(snapAngle(at(100, 0), at(20, 3), { prevPrev: at(0, 0) }).snapped).toBe(false)
  })
  test('the first side squares to the lot lines', () => {
    // A lot turned a little off north, square corners.
    const lot = [at(-60, -10), at(40, -12), at(43, 138), at(-57, 140)]
    const h = ringHeadings(lot)
    const s = snapAngle(at(-50, 0), at(30, 4), { refHeadings: h })
    expect(s.snapped).toBe(true)
    const d = toLocalFt(at(-50, 0), s.pt)
    expect(Math.atan2(d.y, d.x) * 180 / Math.PI).toBeCloseTo(Math.atan2(-2, 100) * 180 / Math.PI, 6)
  })
  test('a point near another point lands on it', () => {
    expect(snapToPoint(at(10.5, 0.3), [at(0, 0), at(10, 0)], 2)).toEqual(at(10, 0))
    expect(snapToPoint(at(15, 0), [at(0, 0), at(10, 0)], 2)).toBeNull()
  })
})

describe('the house, and runs that meet', () => {
  test('an end close to the property\'s center point is at the house; one on the lot line or far away is not', () => {
    const lot = [at(-60, -60), at(60, -60), at(60, 100), at(-60, 100)]
    expect(nearHouse(at(-20, 10), OCALA, lot)).toBe(true)
    expect(nearHouse(at(-58, 10), OCALA, lot)).toBe(false)      // far, and on the lot line
    expect(nearHouse(at(-30, -59), at(-30, -40), lot)).toBe(false) // close to the point but on the lot line
    expect(nearHouse(at(-20, 10), null, lot)).toBe(false)         // no county point: never guessed
  })
  test('a run that starts where another ends is one run with a corner there', () => {
    const r1 = run('a', [at(0, 0), at(0, 50), at(60, 50)], { start: 'house', gates: [{ type: 'walk', widthFt: 4, startFt: 10.5 }, null] })
    const r2 = run('b', [at(60, 0), at(60, 50)], { start: 'house' })     // drawn the other way, from the house
    const j = joinRuns([r1, r2])
    expect(j).toHaveLength(1)
    expect(j[0].pts).toHaveLength(4)
    expect([j[0].start, j[0].end]).toEqual(['house', 'house'])
    expect(j[0].gates[0]).toMatchObject({ type: 'walk', startFt: 10.5 })
    const L = deriveLayout(toYardLayout(drawingOf([r1, r2])))
    expect(L.corners).toBe(2)
    expect(L.ends).toBe(2 + 2) // two house ends + the gate's two posts
  })
  test('a run joined the other way keeps its gate where it was (measured from the other end now)', () => {
    const r1 = run('a', [at(0, 0), at(0, 50)], { gates: [{ type: 'walk', widthFt: 4, startFt: 6 }] })  // 6 ft up from (0,0)
    const r2 = run('b', [at(0, 0), at(40, 0)])                                                         // both start at (0,0)
    const j = joinRuns([r1, r2])
    expect(j[0].pts.map(p => [Math.round(toLocalFt(at(0, 0), p).x), Math.round(toLocalFt(at(0, 0), p).y)])).toEqual([[0, 50], [0, 0], [40, 0]])
    expect(j[0].gates[0]!.startFt).toBe(50 - 6 - 4)                                                    // 40 ft from (0,50): the same spot
  })
  test('a run back on its own first point goes all the way around (corners only)', () => {
    const r = run('a', [at(0, 0), at(50, 0), at(50, 50), at(0, 50), at(0, 0)])
    const j = joinRuns([r])
    expect(j[0].closed).toBe(true)
    const y = toYardLayout(drawingOf([r]))
    expect(y.closed).toBe(true)
    const L = deriveLayout(y)
    expect([L.corners, L.ends, L.runs.length]).toEqual([4, 0, 4])
  })
})

describe('gates split the side, as in the quote builder', () => {
  test('a 4 ft walk gate in the middle of a 30 ft side: 13 ft, the gate, 13 ft, and two gate posts', () => {
    const r = run('a', [at(0, 0), at(30, 0)], { start: 'house', gates: [{ type: 'walk', widthFt: 4, startFt: 13 }] })
    const L = deriveLayout(toYardLayout(drawingOf([r])))
    expect(L.runs.map(x => x.ft)).toEqual([13, 13])
    expect([L.walkGates, L.dblGates, L.ends, L.corners]).toEqual([1, 0, 4, 0])
  })
  test('a double gate near the end (tapped there) stays where tapped, with a typed length', () => {
    const r = run('a', [at(0, 0), at(100, 0)], { typedFt: [96], gates: [{ type: 'double', widthFt: 12, startFt: 80 }] })
    const y = toYardLayout(drawingOf([r]))
    const g = y.sides[0].gate!
    expect(g).toMatchObject({ type: 'double', widthIn: 144, position: 'distance' })
    expect(g.distanceIn).toBe(80 * 12)
    expect(deriveLayout(y).runs.map(x => x.inches)).toEqual([g.distanceIn, 96 * 12 - g.distanceIn! - 144])
  })
  test('a gate is never placed past the end of its side', () => {
    const r = run('a', [at(0, 0), at(10, 0)], { gates: [{ type: 'walk', widthFt: 6, startFt: 10 }] })
    const g = toYardLayout(drawingOf([r])).sides[0].gate!
    expect(g.distanceIn! + g.widthIn).toBeLessThanOrEqual(120)
  })
})

describe('into the quote builder\'s yard, on its photo', () => {
  const backyard = run('a', [at(-20, 0), at(-50, 0), at(-50, 90), at(50, 92), at(50, 0), at(20, 0)], { start: 'house', end: 'house', gates: [{ type: 'walk', widthFt: 4, startFt: 13 }, null, null, null, null] })
  const side = run('b', [at(70, 0), at(70, -60)])
  const d = drawingOf([backyard, side])
  const y = toYardLayout(d)

  test('a Custom yard: one side per drawn side, separate runs joined by a side that is off', () => {
    expect(y.shape).toBe('custom')
    expect(y.sides.map(s => s.on)).toEqual([true, true, true, true, true, false, true])
    expect(y.sides[5].name).toMatch(/^Gap/)
    expect(y.plan!.points).toHaveLength(y.sides.length + 1)
    expect(planVertices(y)).toBe(y.plan!.points)  // the builder uses the drawn corners
  })
  test('lengths, corners and ends the builder counts', () => {
    const L = deriveLayout(y)
    expect(L.runs.map(r => r.ft)).toEqual([13, 13, 90, 100, 92, 30, 60])
    expect([L.corners, L.ends, L.walkGates]).toEqual([4, 2 + 2 + 2, 1])
  })
  test('the photo: north up, centered on the drawing, the plan where its points put it', () => {
    const a = y.plan!.aerial!
    expect(a.rotDeg).toBe(0); expect(a.shown).toBe(true)
    expect(planShift(y).x).toBeCloseTo(0, 6); expect(planShift(y).y).toBeCloseTo(0, 6)
    expect(planMiddle(y).x).toBeCloseTo(a.planAt!.x, 6)
    expect(a.halfM).toBeGreaterThanOrEqual(40); expect(a.halfM).toBeLessThanOrEqual(150)
  })
  test('round trip: every corner, read back through the builder\'s photo, is where the customer tapped (within 1 cm)', () => {
    const a = y.plan!.aerial!
    const pts = [...backyard.pts, ...side.pts]
    y.plan!.points!.forEach((p, i) => {
      const back = planPointToLatLng(a, planShift(y), p)
      expect(groundFt(back, pts[i]) * 30.48).toBeLessThan(1)
    })
    // And with the photo turned and the plan moved, as a salesman might leave it.
    const turned = { ...a, rotDeg: 23, planAt: { x: 12, y: -7 } }
    const yt = { ...y, plan: { ...y.plan!, aerial: turned } }
    const p0 = y.plan!.points![2]
    const f = { x: p0.x + planShift(yt).x, y: p0.y + planShift(yt).y }
    const r = 23 * Math.PI / 180
    const ground = { x: f.x * Math.cos(r) - f.y * Math.sin(r), y: f.x * Math.sin(r) + f.y * Math.cos(r) }
    expect(groundFt(planPointToLatLng(turned, planShift(yt), p0), latLngOfPhotoFt(a, ground))).toBeLessThan(1e-6)
  })
  test('each corner sits on the builder\'s photo tiles exactly where that spot is in the photo', () => {
    const b = photoBackdrop(y)!
    const a = y.plan!.aerial!
    const z = NAIP_MAX_NATIVE_ZOOM, world = 2 * Math.PI * MERCATOR_R, tileM = world / 2 ** z
    const tileXY = (p: LatLng) => { const m = toMercator(p.lat, p.lng); return { x: (m.x + world / 2) / tileM, y: (world / 2 - m.y) / tileM } }
    const c = tileXY(a)
    const sharp = b.tiles!.filter(t => !/USGSImageryOnly/.test(t.href))
    const unit = sharp[0].size
    ;[...backyard.pts, ...side.pts].forEach((p, i) => {
      const t = tileXY(p)
      const photoX = (t.x - c.x) * unit, photoY = (t.y - c.y) * unit       // where the spot is on the photo (y down)
      const q = y.plan!.points![i]
      const planX = (q.x + b.shiftFt!.x) / b.ftPerPx, planY = -(q.y + b.shiftFt!.y) / b.ftPerPx
      expect(Math.abs(photoX - planX)).toBeLessThan(0.05)
      expect(Math.abs(photoY - planY)).toBeLessThan(0.05)
    })
  })
  test('photo feet and back are exact', () => {
    const p = at(-37.2, 88.1)
    expect(groundFt(latLngOfPhotoFt(OCALA, photoFtOf(OCALA, p)), p)).toBeLessThan(1e-6)
  })
})

describe('per run section rounding (CLAUDE.md rule 3)', () => {
  test('sections are counted for each run on its own, never from the total', () => {
    const r = run('a', [at(0, 0), at(30, 0), at(30, 50)], { gates: [{ type: 'walk', widthFt: 4, startFt: 13 }, null] })
    const L = deriveLayout(toYardLayout(drawingOf([r])))
    const perRun = L.runs.map(x => sectionsForRun(x.ft, 8))
    expect(L.runs.map(x => x.ft)).toEqual([13, 13, 50])
    expect(perRun).toEqual([2, 2, 7])
    expect(perRun.reduce((s, n) => s + n, 0)).toBe(11)
    expect(sectionsForRun(76, 8)).toBe(10)  // the total would have said 10, not 11
  })
})

describe('what the page may send', () => {
  test('a good drawing passes; nonsense is refused in plain words', () => {
    const r = run('a', [at(0, 0), at(30, 0), at(30, 50)])
    expect(drawingProblem(drawingOf([r]))).toBeNull()
    expect(drawingProblem(drawingOf([]))).toMatch(/Draw the fence/)
    expect(drawingProblem(drawingOf([run('a', [at(0, 0), at(5000, 0)])]))).toMatch(/too far|longer than/)
    expect(drawingProblem(drawingOf([run('a', [at(0, 0), at(3, 0)], { gates: [{ type: 'walk', widthFt: 4, startFt: 0 }] })]))).toMatch(/wider than its side/)
    expect(drawingProblem(drawingOf(Array.from({ length: 13 }, (_, i) => run(`r${i}`, [at(i * 10, 0), at(i * 10, 20)]))))).toMatch(/at most 12/)
  })
})
