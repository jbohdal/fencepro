/**
 * The yard drawing as a chain: every side is drawn at its typed length, in
 * its own direction, starting where the side before it ends (or from its tee
 * point along an earlier side). So the drawing is always to scale and only the
 * angles between sides change. Pure math, no React; sitePlanGeometry.ts draws
 * with it and yardDrawing.ts edits it.
 *
 *   - Directions are degrees, 0 = right, 90 = up the page (y up), one per side.
 *   - The angle at a corner is the angle between the two sides, on the inside
 *     of the turn: 90° is a square corner, 180° straight on. Walking along the
 *     fence the turn is to the left or to the right.
 *   - Footage, sections and price never come from here: lengths are only read.
 */

import type { HouseRect, PlanPoint, YardLayout } from './yardLayout'

const RAD = Math.PI / 180

export const norm360 = (d: number) => ((d % 360) + 360) % 360
/** In (−180, 180]. */
export function norm180(d: number): number {
  const x = norm360(d)
  return x > 180 ? x - 360 : x
}
export const dirDeg = (a: PlanPoint, b: PlanPoint) => Math.atan2(b.y - a.y, b.x - a.x) / RAD
export const stepFrom = (p: PlanPoint, deg: number, len: number): PlanPoint => ({ x: p.x + len * Math.cos(deg * RAD), y: p.y + len * Math.sin(deg * RAD) })
export const dist = (a: PlanPoint, b: PlanPoint) => Math.hypot(b.x - a.x, b.y - a.y)

/** One side as drawn: start, end, direction (degrees), drawn length (feet). */
export interface SideEnds { a: PlanPoint; b: PlanPoint; deg: number; lenFt: number }

/** What the chain is drawn from: where the first side starts and each side's direction (by index). */
export interface ChainSpec { origin: PlanPoint; deg: number[] }

/** Index of the side a tee starts from, when it is valid (an earlier side). */
export function teeAnchor(layout: YardLayout, i: number): number | null {
  const t = layout.sides[i]?.tee
  if (!t) return null
  const j = layout.sides.findIndex(s => s.id === t.sideId)
  return j >= 0 && j < i ? j : null
}

/** Where along its anchor a tee starts, feet, kept on the anchor as drawn. */
export function teeAtFt(layout: YardLayout, i: number, anchorLenFt: number): number {
  const at = Math.max(0, (layout.sides[i].tee?.atIn ?? 0) / 12)
  return Math.min(at, anchorLenFt)
}

/**
 * The sides end to end. `lenFt(i)` is how long side i is drawn (its typed
 * length, or a stand-in until it is measured). A closed yard's last side ends
 * on the first corner, whatever its length.
 */
export function chainEnds(layout: YardLayout, spec: ChainSpec, lenFt: (i: number) => number): SideEnds[] {
  const out: SideEnds[] = []
  layout.sides.forEach((_, i) => {
    const deg = spec.deg[i] ?? 0
    const L = Math.max(0, lenFt(i))
    let a: PlanPoint
    const j = teeAnchor(layout, i)
    if (j !== null) {
      const an = out[j]
      a = stepFrom(an.a, an.deg, teeAtFt(layout, i, an.lenFt))
    } else {
      a = i === 0 ? { ...spec.origin } : { ...out[i - 1].b }
    }
    out.push({ a, b: stepFrom(a, deg, L), deg, lenFt: L })
  })
  const n = out.length
  if (layout.closed && n > 1 && teeAnchor(layout, n - 1) === null) {
    const last = out[n - 1]
    const b = { ...out[0].a }
    out[n - 1] = { a: last.a, b, deg: dist(last.a, b) > 1e-9 ? dirDeg(last.a, b) : last.deg, lenFt: dist(last.a, b) }
  }
  return out
}

/** The chain's corners as a list: the first side's start, then each side's end (a closed yard: without the last). */
export function chainVertices(layout: YardLayout, ends: SideEnds[]): PlanPoint[] {
  if (!ends.length) return [{ x: 0, y: 0 }]
  const v = [ends[0].a, ...ends.map(e => e.b)]
  if (layout.closed && ends.length > 1) v.pop()
  return v
}

/**
 * Directions read off a drawing's corners (sides+1 points, or sides for a
 * closed yard): side i runs from point i to point i+1. A side drawn with no
 * length takes `fallback(i)`.
 */
export function specFromVertices(layout: YardLayout, v: PlanPoint[], fallback: (i: number) => number): ChainSpec {
  const n = layout.sides.length
  const at = (k: number) => v[layout.closed && n > 1 ? k % v.length : Math.min(k, v.length - 1)]
  const deg = layout.sides.map((_, i) => {
    const a = at(i), b = at(i + 1)
    return a && b && dist(a, b) > 1e-6 ? dirDeg(a, b) : fallback(i)
  })
  return { origin: v[0] ? { ...v[0] } : { x: 0, y: 0 }, deg }
}

// ── Angles at the corners ─────────────────────────────────────────────────────

export interface CornerAngle {
  /** The side that starts at this corner (its index and id). */
  side: number
  sideId: string
  /** The side coming in (the one before, or the side a tee starts from). */
  from: number
  at: PlanPoint
  /** Angle between the two sides, 0 to 180 (90 = square). */
  deg: number
  /** Which way the fence turns here, walking from the first side. */
  turn: 'left' | 'right' | 'straight'
  /** Unit vector into the angle (between the two sides), for its label. */
  inward: PlanPoint
  tee: boolean
  /** The angle can be typed (not the corner that closes a perimeter). */
  typable: boolean
}

/** Angle between the incoming direction and the outgoing one: 180 minus the turn. */
export function angleOf(inDeg: number, outDeg: number): { deg: number; turn: CornerAngle['turn']; signed: number } {
  const t = norm180(outDeg - inDeg)
  const deg = 180 - Math.abs(t)
  return { deg, turn: Math.abs(t) < 1e-6 ? 'straight' : t > 0 ? 'left' : 'right', signed: t }
}

/** Direction of the outgoing side for an angle typed at a corner (degrees, 0 to 180, and which way it turns). */
export function outDegFor(inDeg: number, angle: number, turn: 'left' | 'right'): number {
  const t = 180 - Math.min(180, Math.max(0, angle))
  return norm360(inDeg + (turn === 'left' ? t : -t))
}

/** Every corner where two sides that are on meet, and every tee, with its angle. */
export function cornerAngles(layout: YardLayout, ends: SideEnds[]): CornerAngle[] {
  const out: CornerAngle[] = []
  const n = layout.sides.length
  const one = (i: number, from: number, tee: boolean, typable: boolean) => {
    const s = layout.sides[i], f = layout.sides[from]
    if (!s?.on || !f?.on || !ends[i] || !ends[from]) return
    if (!(ends[i].lenFt > 0) || !(ends[from].lenFt > 0)) return
    const { deg, turn } = angleOf(ends[from].deg, ends[i].deg)
    const uIn = { x: Math.cos(ends[from].deg * RAD), y: Math.sin(ends[from].deg * RAD) }
    const uOut = { x: Math.cos(ends[i].deg * RAD), y: Math.sin(ends[i].deg * RAD) }
    // Into the angle: between the way back along the incoming side and the way out.
    let bx = -uIn.x + uOut.x, by = -uIn.y + uOut.y
    const bl = Math.hypot(bx, by)
    if (bl < 1e-6) { bx = -uOut.y; by = uOut.x } else { bx /= bl; by /= bl }
    out.push({ side: i, sideId: s.id, from, at: ends[i].a, deg, turn, inward: { x: bx, y: by }, tee, typable })
  }
  for (let i = 0; i < n; i++) {
    const j = teeAnchor(layout, i)
    if (j !== null) one(i, j, true, true)
    else if (i > 0) one(i, i - 1, false, true)
  }
  if (layout.closed && n > 2 && teeAnchor(layout, 0) === null) one(0, n - 1, false, false)
  return out
}

// ── Sides that cross ──────────────────────────────────────────────────────────

const cross = (o: PlanPoint, a: PlanPoint, b: PlanPoint) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

/**
 * Where two segments meet: a point, a stretch they share (collinear and
 * overlapping by more than `tol`), or nothing.
 */
export function segmentsMeet(p1: PlanPoint, p2: PlanPoint, q1: PlanPoint, q2: PlanPoint, tol = 1e-6): { kind: 'point'; at: PlanPoint } | { kind: 'overlap'; from: PlanPoint; to: PlanPoint } | null {
  const r = { x: p2.x - p1.x, y: p2.y - p1.y }, s = { x: q2.x - q1.x, y: q2.y - q1.y }
  const rxs = r.x * s.y - r.y * s.x
  const qp = { x: q1.x - p1.x, y: q1.y - p1.y }
  const lr = Math.hypot(r.x, r.y), ls = Math.hypot(s.x, s.y)
  if (lr < 1e-9 || ls < 1e-9) return null
  if (Math.abs(rxs) < 1e-9 * lr * ls) {
    // Parallel: on one line?
    if (Math.abs(qp.x * r.y - qp.y * r.x) / lr > 0.05) return null
    const t0 = (qp.x * r.x + qp.y * r.y) / (lr * lr)
    const t1 = t0 + (s.x * r.x + s.y * r.y) / (lr * lr)
    const lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1))
    if ((hi - lo) * lr <= tol) return null
    return { kind: 'overlap', from: { x: p1.x + r.x * lo, y: p1.y + r.y * lo }, to: { x: p1.x + r.x * hi, y: p1.y + r.y * hi } }
  }
  const t = (qp.x * s.y - qp.y * s.x) / rxs
  const u = (qp.x * r.y - qp.y * r.x) / rxs
  const e = 1e-9
  if (t < -e || t > 1 + e || u < -e || u > 1 + e) return null
  return { kind: 'point', at: { x: p1.x + r.x * t, y: p1.y + r.y * t } }
}

export interface SideCrossing { a: number; b: number; aName: string; bName: string; at: PlanPoint; text: string }

/**
 * Sides that cross or run over each other on the drawing ("Side 3 crosses
 * Side 6, check the drawing"). Sides that meet at a shared corner, and a tee
 * where it starts on its side, are not crossings. Only sides that are on and
 * measured are checked.
 */
export function sideCrossings(layout: YardLayout, ends: SideEnds[]): SideCrossing[] {
  const out: SideCrossing[] = []
  const n = layout.sides.length
  const near = 0.25
  const live = (i: number) => !!layout.sides[i]?.on && layout.sides[i].lengthIn > 0 && !!ends[i] && ends[i].lenFt > 0
  for (let i = 0; i < n; i++) {
    if (!live(i)) continue
    for (let j = i + 1; j < n; j++) {
      if (!live(j)) continue
      const A = ends[i], B = ends[j]
      const hit = segmentsMeet(A.a, A.b, B.a, B.b, near)
      if (!hit) continue
      // Points the two are allowed to share: their joined corner, a tee's start.
      const shared: PlanPoint[] = []
      for (const p of [A.a, A.b]) for (const q of [B.a, B.b]) if (dist(p, q) < near) shared.push(p)
      if (teeAnchor(layout, j) === i) shared.push(B.a)
      if (teeAnchor(layout, i) === j) shared.push(A.a)
      if (hit.kind === 'point') {
        if (shared.some(p => dist(p, hit.at) < near)) continue
        out.push(crossingOf(layout, i, j, hit.at, 'crosses'))
      } else {
        out.push(crossingOf(layout, i, j, { x: (hit.from.x + hit.to.x) / 2, y: (hit.from.y + hit.to.y) / 2 }, 'runs over'))
      }
    }
  }
  return out
}

function crossingOf(layout: YardLayout, i: number, j: number, at: PlanPoint, verb: string): SideCrossing {
  const aName = layout.sides[i].name, bName = layout.sides[j].name
  return { a: i, b: j, aName, bName, at, text: `${aName} ${verb} ${bName}, check the drawing.` }
}

// ── The house ─────────────────────────────────────────────────────────────────

/** The house's corners, counterclockwise from its back left (as seen in its own turn). */
export function houseCorners(h: HouseRect): PlanPoint[] {
  const ex = { x: Math.cos(h.rotDeg * RAD), y: Math.sin(h.rotDeg * RAD) }, ey = { x: -ex.y, y: ex.x }
  const at = (sx: number, sy: number) => ({ x: h.cx + ex.x * sx * h.w / 2 + ey.x * sy * h.d / 2, y: h.cy + ex.y * sx * h.w / 2 + ey.y * sy * h.d / 2 })
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)]
}

/** A house drawn as four corners (any rectangle) as a HouseRect. */
export function houseRectOf(pts: PlanPoint[]): HouseRect | null {
  if (pts.length !== 4) return null
  const [p0, p1, , p3] = pts
  const w = dist(p0, p1), d = dist(p0, p3)
  if (!(w > 0) || !(d > 0)) return null
  const cx = pts.reduce((t, p) => t + p.x / 4, 0), cy = pts.reduce((t, p) => t + p.y / 4, 0)
  let rot = dirDeg(p0, p1)
  // p0 → p3 must be a quarter turn left of p0 → p1 for houseCorners to give the same four.
  const leftTurn = cross(p0, p1, p3) > 0
  if (!leftTurn) rot = dirDeg(p1, p0)
  return { cx, cy, w, d, rotDeg: norm180(rot) }
}

/** Closest point to p on segment ab, and how far along (0..1). */
export function closestOn(p: PlanPoint, a: PlanPoint, b: PlanPoint): { pt: PlanPoint; t: number; d: number } {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy
  const t = L2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0
  const pt = { x: a.x + dx * t, y: a.y + dy * t }
  return { pt, t, d: dist(p, pt) }
}

/** The house moved (not turned or resized) so its nearest wall passes through p. */
export function houseTouching(h: HouseRect, p: PlanPoint): HouseRect {
  const c = houseCorners(h)
  let best = { pt: p, d: Infinity }
  for (let k = 0; k < 4; k++) {
    const q = closestOn(p, c[k], c[(k + 1) % 4])
    if (q.d < best.d) best = { pt: q.pt, d: q.d }
  }
  if (!(best.d > 1e-9)) return h
  return { ...h, cx: h.cx + p.x - best.pt.x, cy: h.cy + p.y - best.pt.y }
}

/**
 * The house fitted to two fence ends that meet it: `p` (the first) meets its
 * wall `dl` feet in front of the back corner and `q` (the last) `dr` feet in
 * front of the other back corner, the back of the house toward the yard
 * (`yardAt`). Its depth stays `depth`. Null when the ends cannot both meet it.
 */
export function houseFitted(p: PlanPoint, q: PlanPoint, dl: number, dr: number, depth: number, yardAt: PlanPoint): HouseRect | null {
  const D = dist(p, q), delta = dr - dl
  if (!(D > Math.abs(delta) + 1e-6)) return null
  const w = Math.sqrt(D * D - delta * delta)
  if (w < 4) return null
  // The yard is on the left of p → q (s = 1) or its right (s = −1).
  const s = cross(p, q, yardAt) >= 0 ? 1 : -1
  const r = dirDeg(p, q) - s * (Math.atan2(-delta, w) / RAD)
  const ex = { x: Math.cos(r * RAD), y: Math.sin(r * RAD) }
  const ey = s > 0 ? { x: -ex.y, y: ex.x } : { x: ex.y, y: -ex.x }
  const M = { x: p.x + ex.x * w / 2 + ey.x * dl, y: p.y + ex.y * w / 2 + ey.y * dl }
  const c = { x: M.x - ey.x * depth / 2, y: M.y - ey.y * depth / 2 }
  return { cx: c.x, cy: c.y, w, d: depth, rotDeg: norm180(r) }
}

/** True when p is on the house's outline (within `tol` feet). */
export function onHouseWall(h: HouseRect, p: PlanPoint, tol = 0.05): boolean {
  const c = houseCorners(h)
  return [0, 1, 2, 3].some(k => closestOn(p, c[k], c[(k + 1) % 4]).d <= tol)
}
