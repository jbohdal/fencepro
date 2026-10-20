/**
 * The website quote's drawing (the EZ Budget at /p/quote): the customer taps
 * the fence's corners on the aerial photo. Pure, no React and no browser, so
 * the server, the unit tests and the page all use exactly this.
 *
 *   - Points are latitude / longitude (where they are on the ground).
 *   - Side lengths are true ground distance between the two points, on the
 *     WGS84 ellipsoid at that latitude (exact to well under an inch over a
 *     yard), rounded to the nearest foot, the way the page shows them. A
 *     length the customer types ("I measured 82 ft") wins for that side.
 *   - toYardLayout turns the drawing into the quote builder's own yard
 *     (yardLayout.ts), sides in walking order, the corners placed on the
 *     builder's aerial photo at its true scale (north up, plan centered on the
 *     photo), so the salesman opens the quote already drawn and the quote math
 *     (deriveLayout: runs, corners, ends, gates, per run sections) is the
 *     builder's. Separate runs are joined by a side that is off (no fence),
 *     which the builder neither draws nor prices.
 */

import { GATE_LABEL, type EndFinish, type GateType, type PlanPoint, type YardLayout, type YardSide } from './yardLayout'
import { clampStart } from './gateSlide'

export interface LatLng { lat: number; lng: number }

/** How a run's free end finishes: against the house wall, or it just stops (an end post either way). */
export type RunEnd = 'free' | 'house'

export interface WidgetGate {
  type: GateType
  /** Opening, whole feet. */
  widthFt: number
  /** Where the gate starts: feet from the side's start to its first post (the quote builder's own measure). */
  startFt: number
}

export interface WidgetRun {
  id: string
  pts: LatLng[]
  start: RunEnd
  end: RunEnd
  /** The last point joins the first (a fence all the way around). */
  closed?: boolean
  /** Per side (pts.length - 1, or pts.length when closed): a length the customer typed, whole feet, or null (measured). */
  typedFt: Array<number | null>
  /** Per side: its gate, or null. */
  gates: Array<WidgetGate | null>
}

export interface WidgetDrawing {
  v: 1
  /** The address and the point the photo was centered on. */
  address: string
  at: LatLng
  runs: WidgetRun[]
}

/** Gate sizes offered (feet), as the quote builder's defaults: a walk gate 4 ft, a double gate 10 ft. */
export const WALK_GATE_FT = [4, 5, 6] as const
export const DOUBLE_GATE_FT = [8, 10, 12] as const

// ── Ground distance ──────────────────────────────────────────────────────────

const A = 6378137               // WGS84 semi-major axis, m
const E2 = 0.00669437999014     // WGS84 first eccentricity squared
export const M_PER_FT = 0.3048
const RAD = Math.PI / 180

/** Meters per degree of latitude and of longitude at latitude `lat` (WGS84). */
export function metersPerDegree(lat: number): { lat: number; lng: number } {
  const s = Math.sin(lat * RAD)
  const w = 1 - E2 * s * s
  const M = (A * (1 - E2)) / Math.pow(w, 1.5)   // meridional radius
  const N = A / Math.sqrt(w)                      // prime vertical radius
  return { lat: M * RAD, lng: N * Math.cos(lat * RAD) * RAD }
}

/** Feet east and north of `ref` (local, exact at yard size). */
export function toLocalFt(ref: LatLng, p: LatLng): PlanPoint {
  const mid = (ref.lat + p.lat) / 2
  const k = metersPerDegree(mid)
  return { x: ((p.lng - ref.lng) * k.lng) / M_PER_FT, y: ((p.lat - ref.lat) * k.lat) / M_PER_FT }
}

/** The point `d` feet east and north of `ref`. */
export function fromLocalFt(ref: LatLng, d: PlanPoint): LatLng {
  // Two passes so the latitude used for the scale is the middle one.
  let lat = ref.lat
  for (let i = 0; i < 2; i++) {
    const k = metersPerDegree((ref.lat + lat) / 2)
    lat = ref.lat + (d.y * M_PER_FT) / k.lat
  }
  const k = metersPerDegree((ref.lat + lat) / 2)
  return { lat, lng: ref.lng + (d.x * M_PER_FT) / k.lng }
}

/** True ground distance between two points, feet. */
export function groundFt(a: LatLng, b: LatLng): number {
  const d = toLocalFt(a, b)
  return Math.hypot(d.x, d.y)
}

// ── Sides ────────────────────────────────────────────────────────────────────

export function sideCount(run: Pick<WidgetRun, 'pts' | 'closed'>): number {
  const n = run.pts.length
  return run.closed && n >= 3 ? n : Math.max(0, n - 1)
}

/** The two ends of side i. */
export function sideEnds(run: Pick<WidgetRun, 'pts' | 'closed'>, i: number): [LatLng, LatLng] {
  return [run.pts[i], run.pts[(i + 1) % run.pts.length]]
}

/** A side as the page shows it: measured from the map, rounded to the foot; typed wins. */
export interface SideLength { measuredFt: number; exactFt: number; typedFt: number | null; ft: number; typed: boolean }

export function sideLength(run: WidgetRun, i: number): SideLength {
  const [a, b] = sideEnds(run, i)
  const exactFt = groundFt(a, b)
  const measuredFt = Math.round(exactFt)
  const t = run.typedFt[i]
  const typedFt = typeof t === 'number' && Number.isFinite(t) && t > 0 ? t : null
  return { measuredFt, exactFt, typedFt, ft: typedFt ?? measuredFt, typed: typedFt !== null }
}

export function runSides(run: WidgetRun): SideLength[] {
  return Array.from({ length: sideCount(run) }, (_, i) => sideLength(run, i))
}

/** Every side's length added up (the fence line, gates included), feet. */
export function totalFt(d: Pick<WidgetDrawing, 'runs'>): number {
  return d.runs.reduce((t, r) => t + runSides(r).reduce((s, x) => s + x.ft, 0), 0)
}

/** The arrays sized to the run's sides (after points are added or removed). */
export function fitRun(run: WidgetRun): WidgetRun {
  const n = sideCount(run)
  const pad = <T>(a: T[], v: T) => Array.from({ length: n }, (_, i) => (i < a.length ? a[i] : v))
  return { ...run, typedFt: pad(run.typedFt ?? [], null), gates: pad(run.gates ?? [], null) }
}

// ── Snapping ─────────────────────────────────────────────────────────────────

const norm360 = (d: number) => ((d % 360) + 360) % 360
const angDiff = (a: number, b: number) => { const d = norm360(a - b); return d > 180 ? d - 360 : d }
/** Direction in degrees, 0 = east, counterclockwise. */
const headingOf = (v: PlanPoint) => (Math.atan2(v.y, v.x) * 180) / Math.PI

/**
 * Straight and square: the new point `cand` placed after `prev` is turned
 * about `prev` onto the nearest of straight on or a 90 degree corner from the
 * side before (`prevPrev` to `prev`), when it is within `tolDeg`. Doubling back
 * is never a snap. With no side before, `refHeadings` (other sides, the lot
 * lines) are the directions it squares to. Returns the point unchanged when
 * nothing is close.
 */
export function snapAngle(prev: LatLng, cand: LatLng, opts: { prevPrev?: LatLng | null; refHeadings?: number[]; tolDeg?: number } = {}): { pt: LatLng; snapped: boolean } {
  const tol = opts.tolDeg ?? 8
  const v = toLocalFt(prev, cand)
  const len = Math.hypot(v.x, v.y)
  if (len < 0.5) return { pt: cand, snapped: false }
  const h = headingOf(v)
  const targets: number[] = []
  if (opts.prevPrev) {
    const h0 = headingOf(toLocalFt(opts.prevPrev, prev))
    targets.push(h0, h0 + 90, h0 - 90)
  } else {
    for (const r of opts.refHeadings ?? []) targets.push(r, r + 90, r + 180, r + 270)
  }
  let best: number | null = null, bestD = tol + 1e-9
  for (const t of targets) { const d = Math.abs(angDiff(h, t)); if (d <= bestD) { bestD = d; best = t } }
  if (best === null) return { pt: cand, snapped: false }
  const r = best * RAD
  return { pt: fromLocalFt(prev, { x: len * Math.cos(r), y: len * Math.sin(r) }), snapped: true }
}

/** The nearest of `targets` within `tolFt` of `cand`, or null. */
export function snapToPoint(cand: LatLng, targets: LatLng[], tolFt: number): LatLng | null {
  let best: LatLng | null = null, bestD = tolFt
  for (const t of targets) { const d = groundFt(cand, t); if (d <= bestD) { bestD = d; best = t } }
  return best
}

/** Directions (degrees, 0 = east) of the sides of a ring of points, longest first: for squaring the first side to the lot. */
export function ringHeadings(ring: LatLng[], max = 6): number[] {
  if (ring.length < 2) return []
  const out: Array<{ h: number; len: number }> = []
  for (let i = 0; i + 1 < ring.length; i++) {
    const v = toLocalFt(ring[i], ring[i + 1])
    const len = Math.hypot(v.x, v.y)
    if (len > 10) out.push({ h: headingOf(v), len })
  }
  return out.sort((a, b) => b.len - a.len).slice(0, max).map(x => x.h)
}

// ── The house ────────────────────────────────────────────────────────────────

/** How close (feet) a fence end must be to the property's center point to be offered "Ends at the house". */
export const HOUSE_NEAR_FT = 50

/**
 * True when a fence end is probably at the house: close to the property's
 * center point (the county's point for the parcel, where the house usually
 * is) and not on the lot line. No free building outlines exist for the
 * county, so this is a suggestion the customer can change with one tap.
 */
export function nearHouse(end: LatLng, house: LatLng | null, parcel?: LatLng[] | null, nearFt = HOUSE_NEAR_FT): boolean {
  if (!house) return false
  if (groundFt(end, house) > nearFt) return false
  if (parcel && parcel.length >= 3 && distToRingFt(end, parcel) < 6) return false
  return true
}

/** Shortest distance (feet) from a point to a ring's edges. */
export function distToRingFt(p: LatLng, ring: LatLng[]): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = toLocalFt(p, ring[i]), b = toLocalFt(p, ring[(i + 1) % ring.length])
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy
    const t = L2 > 0 ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / L2)) : 0
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy))
  }
  return best
}

// ── Joining runs that touch ──────────────────────────────────────────────────

const SAME_FT = 0.5
const same = (a: LatLng, b: LatLng) => groundFt(a, b) < SAME_FT

function reverseRun(r: WidgetRun): WidgetRun {
  const n = sideCount(r)
  // A gate's start, measured from the other end now.
  const gates = r.gates.slice(0, n).map((g, i) => (g ? { ...g, startFt: Math.max(0, sideLength(r, i).ft - g.startFt - g.widthFt) } : null))
  return { ...r, pts: [...r.pts].reverse(), start: r.end, end: r.start, typedFt: [...r.typedFt.slice(0, n)].reverse(), gates: gates.reverse() }
}

/** Where side i's gate sits now (inches from the side's start), kept on the side; null when it does not fit. */
export function gateStartInOf(run: WidgetRun, i: number): number | null {
  const g = run.gates[i]
  if (!g) return null
  return clampStart(g.startFt * 12, sideLength(run, i).ft * 12, Math.round(g.widthFt) * 12)
}

/**
 * Runs whose ends meet become one run (a corner where they meet), and a run
 * whose last point is its first is closed. Same post rules as the quote
 * builder: a corner joins two sides; a free end or the house is an end post.
 */
export function joinRuns(runs: WidgetRun[]): WidgetRun[] {
  let list = runs.map(fitRun).filter(r => r.pts.length >= 2)
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < list.length; i++) {
      for (let j = 0; j < list.length; j++) {
        if (i === j || list[i].closed || list[j].closed) continue
        let a = list[i], b = list[j]
        const aEnd = a.pts[a.pts.length - 1]
        if (!same(aEnd, b.pts[0])) {
          if (same(aEnd, b.pts[b.pts.length - 1])) b = reverseRun(b)
          else if (same(a.pts[0], b.pts[0])) a = reverseRun(a)
          else continue
        }
        const joined: WidgetRun = {
          id: a.id, start: a.start, end: b.end,
          pts: [...a.pts, ...b.pts.slice(1)],
          typedFt: [...a.typedFt, ...b.typedFt], gates: [...a.gates, ...b.gates],
        }
        list = [...list.filter((_, k) => k !== i && k !== j), joined]
        changed = true
        break outer
      }
    }
  }
  return list.map(r => {
    if (!r.closed && r.pts.length >= 4 && same(r.pts[0], r.pts[r.pts.length - 1])) {
      const n = sideCount(r)
      return { ...r, pts: r.pts.slice(0, -1), closed: true, typedFt: r.typedFt.slice(0, n), gates: r.gates.slice(0, n) }
    }
    return r
  })
}

// ── Into the quote builder's yard ────────────────────────────────────────────

const R_MERC = 6378137
const mercX = (lng: number) => R_MERC * lng * RAD
const mercY = (lat: number) => R_MERC * Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2))
const unMercY = (y: number) => (2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2) / RAD

/**
 * A point to the builder's photo plan (feet right and up of the photo's
 * center), the way the builder draws its photo: Web Mercator tiles at the
 * true ground scale of the center's latitude.
 */
export function photoFtOf(center: LatLng, p: LatLng): PlanPoint {
  const cos = Math.cos(center.lat * RAD)
  return { x: ((mercX(p.lng) - mercX(center.lng)) * cos) / M_PER_FT, y: ((mercY(p.lat) - mercY(center.lat)) * cos) / M_PER_FT }
}

/** The other way: feet right and up of the photo's center to a point on the ground. */
export function latLngOfPhotoFt(center: LatLng, f: PlanPoint): LatLng {
  const cos = Math.cos(center.lat * RAD)
  return { lat: unMercY(mercY(center.lat) + (f.y * M_PER_FT) / cos), lng: center.lng + ((f.x * M_PER_FT) / cos / R_MERC) / RAD }
}

/**
 * A point of a saved builder drawing (any quote with layout.plan.aerial) to
 * the ground: the plan point moved by where the plan sits on the photo
 * (planAt), turned back by the photo's turn (rotDeg, clockwise on screen),
 * then from the photo's center to latitude / longitude.
 */
export function planPointToLatLng(aerial: { lat: number; lng: number; rotDeg?: number | null }, shift: PlanPoint, p: PlanPoint): LatLng {
  const f = { x: p.x + shift.x, y: p.y + shift.y }
  const r = ((aerial.rotDeg ?? 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  // groundToFrame is x' = x c + y s, y' = -x s + y c; this is its inverse.
  const g = { x: f.x * c - f.y * s, y: f.x * s + f.y * c }
  return latLngOfPhotoFt({ lat: aerial.lat, lng: aerial.lng }, g)
}

/** Meters each way the builder's photo covers: the whole drawing with room around it (the builder's own range, 40 to 150). */
export function photoHalfM(center: LatLng, pts: LatLng[]): number {
  const reachM = Math.max(0, ...pts.map(p => { const f = photoFtOf(center, p); return Math.max(Math.abs(f.x), Math.abs(f.y)) * M_PER_FT }))
  return Math.min(150, Math.max(40, Math.ceil(reachM * 1.25 + 8)))
}

/** Most sides a saved yard may have (the saved quote allows 60). */
export const MAX_LAYOUT_SIDES = 60

/**
 * The drawing as the quote builder's yard: a Custom yard, one side per drawn
 * side in walking order, each run's sides joined by corners, its two ends at
 * the house or stopping, a gate where it was tapped, and the corners on the
 * builder's aerial photo. Runs are separated by a side that is off.
 */
export function toYardLayout(d: WidgetDrawing): YardLayout {
  const runs = joinRuns(d.runs)
  const all = runs.flatMap(r => r.pts)
  if (all.length === 0) return { shape: 'custom', closed: false, sides: [] }
  const lats = all.map(p => p.lat), lngs = all.map(p => p.lng)
  const center = { lat: (Math.min(...lats) + Math.max(...lats)) / 2, lng: (Math.min(...lngs) + Math.max(...lngs)) / 2 }
  const round = (v: number) => Math.round(v * 1000) / 1000
  const plan = (p: LatLng): PlanPoint => { const f = photoFtOf(center, p); return { x: round(f.x), y: round(f.y) } }

  const single = runs.length === 1 && !!runs[0].closed
  const sides: YardSide[] = []
  const points: PlanPoint[] = []
  runs.forEach((r0, ri) => {
    // A closed run among others: open at its first point (two end posts there).
    const r = r0.closed && !single ? { ...r0, closed: false, pts: [...r0.pts, r0.pts[0]] } : r0
    const n = sideCount(r)
    if (ri > 0) {
      const prev = points[points.length - 1], next = plan(r.pts[0])
      sides.push({
        id: `gap${ri}`, name: `Gap before run ${ri + 1}`, on: false, lengthIn: Math.round(Math.hypot(next.x - prev.x, next.y - prev.y)) * 12,
        startFinish: 'free', endFinish: 'free', gate: null, skip: null, heading: headingOf({ x: next.x - prev.x, y: next.y - prev.y }),
      })
    }
    r.pts.forEach(p => points.push(plan(p)))
    for (let i = 0; i < n; i++) {
      const len = sideLength(r, i)
      const [a, b] = sideEnds(r, i)
      const v = toLocalFt(a, b)
      const L = len.ft * 12
      const g = r.gates[i]
      const w = g ? Math.max(1, Math.round(g.widthFt)) * 12 : 0
      const firstEnd: EndFinish = r.closed ? 'corner' : r.start
      const lastEnd: EndFinish = r.closed ? 'corner' : r.end
      sides.push({
        id: `${r.id}-${i}`,
        name: runs.length > 1 ? `Run ${ri + 1}, side ${i + 1}` : `Side ${i + 1}`,
        on: true,
        lengthIn: L,
        startFinish: i === 0 ? firstEnd : 'corner',
        endFinish: i === n - 1 ? lastEnd : 'corner',
        gate: g && w > 0 && w < L ? { type: g.type, widthIn: w, position: 'distance', distanceIn: Math.round((clampStart(g.startFt * 12, L, w) ?? 0) * 8) / 8 } : null,
        skip: null,
        heading: Math.round(norm360(headingOf(v)) * 10) / 10,
      })
    }
  })
  if (single) points.length = sides.length
  const xs = points.map(p => p.x), ys = points.map(p => p.y)
  const mid = { x: round((Math.min(...xs) + Math.max(...xs)) / 2), y: round((Math.min(...ys) + Math.max(...ys)) / 2) }
  return {
    shape: 'custom',
    closed: single,
    sides,
    plan: {
      points,
      pointsFor: null,
      aerial: { lat: center.lat, lng: center.lng, halfM: photoHalfM(center, all), address: d.address, rotDeg: 0, planAt: mid, shown: true },
    },
  }
}

// ── Checks on what the page sends ────────────────────────────────────────────

export const LIMITS = { runs: 12, pointsPerRun: 40, sideFt: 2000, totalFt: 6000, reachFt: 3300 }

/** Why a drawing cannot be priced (in plain words), or null when it is fine. */
export function drawingProblem(d: WidgetDrawing): string | null {
  if (!d || d.v !== 1 || !Array.isArray(d.runs)) return 'Draw the fence on the photo first.'
  if (!Number.isFinite(d.at?.lat) || !Number.isFinite(d.at?.lng)) return 'The address was not found on the map.'
  if (d.runs.length > LIMITS.runs) return `Draw at most ${LIMITS.runs} separate runs.`
  const runs = d.runs.filter(r => r.pts.length >= 2)
  if (runs.length === 0) return 'Draw the fence on the photo first: tap where it starts, then each corner.'
  let sides = 0
  for (const r of d.runs) {
    if (r.pts.length > LIMITS.pointsPerRun) return `A run can have at most ${LIMITS.pointsPerRun} points.`
    for (const p of r.pts) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) return 'A point of the drawing is not on the map.'
      if (groundFt(d.at, p) > LIMITS.reachFt) return 'The drawing is too far from the address.'
    }
    const n = sideCount(r)
    sides += n
    if ((r.typedFt ?? []).length > n + 1 || (r.gates ?? []).length > n + 1) return 'The drawing did not come through right. Start over.'
    for (let i = 0; i < n; i++) {
      const s = sideLength(fitRun(r), i)
      if (s.ft < 1) return 'A side is shorter than a foot. Undo it, or type its length.'
      if (s.ft > LIMITS.sideFt) return `A side is longer than ${LIMITS.sideFt} ft. Check the drawing.`
      const g = r.gates?.[i]
      if (g) {
        if (!['walk', 'double'].includes(g.type) || !(g.widthFt >= 3 && g.widthFt <= 20) || !(g.startFt >= 0 && g.startFt <= LIMITS.sideFt)) return 'A gate did not come through right. Remove it and add it again.'
        if (g.widthFt >= s.ft) return `The ${GATE_LABEL[g.type].toLowerCase()} is wider than its side.`
      }
    }
  }
  if (sides + d.runs.length > MAX_LAYOUT_SIDES) return 'The drawing has too many sides.'
  if (totalFt(d) > LIMITS.totalFt) return `That is more than ${LIMITS.totalFt.toLocaleString('en-US')} ft of fence. Call us for a job this size.`
  return null
}
