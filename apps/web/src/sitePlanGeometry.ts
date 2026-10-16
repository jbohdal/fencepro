/**
 * Site plan geometry: where each side, post, gate swing, skip and the house
 * go, in feet with y pointing up. Pure; SitePlan.tsx draws what this returns.
 *
 * A backyard is drawn from the house out: the house square and level at the
 * bottom, each return level from the house to its side, each side straight
 * back at its own length, and the back joining the two side ends (at an angle
 * when the sides differ). A front yard is the same upside down, with no
 * returns. Other shapes lay their sides end to end in their drawing
 * direction. A side with no length yet gets a short stand-in.
 *
 * Corners dragged by hand (layout.plan.points) replace the computed ones,
 * only in the drawing: footage, sections and price always come from the typed
 * lengths. The drawing is a picture of the job, not a survey.
 */

import { deriveLayout, formatFtIn, type LayoutResult, type PlanPoint, type YardLayout, type YardSide } from './yardLayout'

export interface PlanPost { x: number; y: number; kind: 'corner' | 'end' | 'gate' | 'line' }
export interface PlanSegment { a: PlanPoint; b: PlanPoint }
export interface PlanSide {
  sideId: string
  name: string
  /** Whole side, for tapping and for the label. */
  a: PlanPoint
  b: PlanPoint
  /** Fence actually built. */
  fence: PlanSegment[]
  skip: (PlanSegment & { kind: 'existing' | 'none' }) | null
  gate: { a: PlanPoint; b: PlanPoint; type: 'walk' | 'double'; swing: PlanPoint; label: string } | null
  label: string
  sublabel: string
  /** No length typed yet: drawn faint, labeled "tap to enter". */
  placeholder: boolean
  /** Unit vector away from the yard, for placing labels. */
  out: PlanPoint
}
export interface Plan {
  vertices: PlanPoint[]
  sides: PlanSide[]
  posts: PlanPost[]
  house: PlanPoint[] | null
  /** The house is a stand-in size: no returns, or they leave too little room. */
  houseNotToScale: boolean
  /** Measurements that cannot all be true at once ("Check these measurements"). */
  notes: string[]
  /** Corners (vertex indexes) that can be dragged on the plain drawing. */
  corners: number[]
  /** Where the street is, below the drawing, for shapes that have a front. */
  street: boolean
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
}

const DEFAULT_HEADINGS: Record<string, number[]> = {
  backyard: [180, 90, 0, 270, 180],
  perimeter: [0, 90, 180, 270],
  front: [270, 0, 90],
  straight: [0],
  custom: [0, 270, 180, 90],
}

function heading(layout: YardLayout, i: number): number {
  const h = layout.sides[i].heading
  if (typeof h === 'number' && Number.isFinite(h)) return h
  const d = DEFAULT_HEADINGS[layout.shape] ?? DEFAULT_HEADINGS.custom
  return d[i % d.length]
}

// Feet. A house drawn at a stand-in size is never narrower than MIN_HOUSE_FT
// of real room between the returns.
const HOUSE_DEPTH_FT = 30
const MIN_HOUSE_FT = 12
const STANDIN_HOUSE_FT = 40

/** The standard backyard: Left return, Left side, Back, Right side, Right return. */
export function isStandardBackyard(layout: YardLayout): boolean {
  return layout.shape === 'backyard' && !layout.closed && layout.sides.length === 5
}
function isStandardFront(layout: YardLayout): boolean {
  return layout.shape === 'front' && !layout.closed && layout.sides.length === 3
}

/** Which end of side i meets the house as a backyard return, if it is one. */
export function returnHouseEnd(layout: YardLayout, i: number): 'start' | 'end' | null {
  if (!isStandardBackyard(layout)) return null
  const s = layout.sides[i]
  if (i === 0 && s.startFinish === 'house') return 'start'
  if (i === 4 && s.endFinish === 'house') return 'end'
  return null
}

interface AutoGeometry {
  vertices: PlanPoint[]
  house: PlanPoint[] | null
  houseNotToScale: boolean
  notes: string[]
}

function standInFt(layout: YardLayout): number {
  const longest = Math.max(0, ...layout.sides.map(s => s.lengthIn / 12))
  return Math.max(20, longest * 0.3)
}
const fmtFt = (ft: number) => formatFtIn(ft * 12)
const rect = (x0: number, x1: number, y0: number, y1: number): PlanPoint[] =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]

/**
 * How wide the yard is when the line across the far end is `across` long and
 * its two ends are `rise` apart front to back. When the far side is too short
 * to reach, a width is still given so something sensible is drawn, with a note.
 */
function yardWidth(across: number | null, rise: number, fallback: number, names: [string, string, string], notes: string[]): number {
  if (across === null) return fallback
  if (across + 1e-6 >= Math.abs(rise)) return Math.sqrt(Math.max(0, across * across - rise * rise))
  notes.push(`Check these measurements: the ${names[0]} (${fmtFt(across)}) is shorter than the difference between the ${names[1]} and the ${names[2]} (${fmtFt(Math.abs(rise))}).`)
  return Math.max(fallback, across)
}

function backyardGeometry(layout: YardLayout): AutoGeometry {
  const [lrS, lsS, backS, rsS, rrS] = layout.sides
  const standIn = standInFt(layout)
  const len = (s: YardSide) => (!s.on ? 0 : s.lengthIn > 0 ? s.lengthIn / 12 : standIn)
  const lr = len(lrS), left = len(lsS), right = len(rsS), rr = len(rrS)
  const notes: string[] = []

  // Where each return meets the house: its back corner (y = 0), its front
  // corner, or a typed distance toward the street from the back corner.
  const dist = (s: YardSide) => (s.on && s.meetsHouse?.at === 'distance' ? Math.max(0, (s.meetsHouse.distanceIn ?? 0) / 12) : 0)
  const depth = Math.max(HOUSE_DEPTH_FT, dist(lrS) + 8, dist(rrS) + 8)
  const meetY = (s: YardSide) => (!s.on ? 0 : s.meetsHouse?.at === 'front' ? -depth : s.meetsHouse?.at === 'distance' ? -dist(s) : 0)
  const yL = meetY(lrS), yR = meetY(rrS)

  // The back joins the tops of the two sides: width from the back's length
  // and how far apart the tops are front to back.
  const rise = (yR + right) - (yL + left)
  const back = backS.on ? len(backS) : null
  const W = yardWidth(back, rise, lr + rr + STANDIN_HOUSE_FT, ['back', 'left side', 'right side'], notes)
  const xL = -W / 2, xR = W / 2

  // The house fills the room between the returns; with no returns, or too
  // little room, a stand-in house is centered and marked not to scale.
  const room = W - lr - rr
  const noReturns = lr === 0 && rr === 0
  let house: PlanPoint[]
  let houseNotToScale = false
  if (!noReturns && room >= MIN_HOUSE_FT) {
    house = rect(xL + lr, xR - rr, 0, -depth)
  } else {
    houseNotToScale = true
    const hw = Math.max(20, Math.min(STANDIN_HOUSE_FT, (noReturns ? W : Math.max(room, 0)) * 0.6 || STANDIN_HOUSE_FT))
    house = rect(-hw / 2, hw / 2, 0, -depth)
    if (!noReturns && room < 0) notes.push(`Check these measurements: the two returns (${fmtFt(lr + rr)}) are wider than the yard (${fmtFt(W)}).`)
  }

  const vertices = [
    { x: xL + lr, y: yL }, { x: xL, y: yL }, { x: xL, y: yL + left },
    { x: xR, y: yR + right }, { x: xR, y: yR }, { x: xR - rr, y: yR },
  ]
  return { vertices, house, houseNotToScale, notes }
}

function frontGeometry(layout: YardLayout): AutoGeometry {
  const [lsS, frontS, rsS] = layout.sides
  const standIn = standInFt(layout)
  const len = (s: YardSide) => (!s.on ? 0 : s.lengthIn > 0 ? s.lengthIn / 12 : standIn)
  const left = len(lsS), right = len(rsS)
  const notes: string[] = []
  // The sides run from the front of the house toward the street; the front
  // joins their ends.
  const front = frontS.on ? len(frontS) : null
  const W = yardWidth(front, right - left, STANDIN_HOUSE_FT, ['front', 'left side', 'right side'], notes)
  const xL = -W / 2, xR = W / 2
  const houseNotToScale = W < MIN_HOUSE_FT
  const hw = houseNotToScale ? STANDIN_HOUSE_FT : W
  return {
    vertices: [{ x: xL, y: 0 }, { x: xL, y: -left }, { x: xR, y: -right }, { x: xR, y: 0 }],
    house: rect(-hw / 2, hw / 2, HOUSE_DEPTH_FT, 0),
    houseNotToScale,
    notes,
  }
}

/** Sides laid end to end in their drawing directions. */
function chainVertices(layout: YardLayout): PlanPoint[] {
  const standIn = standInFt(layout)
  const pts: PlanPoint[] = [{ x: 0, y: 0 }]
  layout.sides.forEach((s, i) => {
    const L = s.lengthIn > 0 ? s.lengthIn / 12 : standIn
    const r = (heading(layout, i) * Math.PI) / 180
    const p = pts[pts.length - 1]
    pts.push({ x: p.x + L * Math.cos(r), y: p.y + L * Math.sin(r) })
  })
  // A perimeter closes on its first corner whatever the tape said.
  if (layout.closed && pts.length > 2) pts.pop()
  return pts
}

function autoGeometry(layout: YardLayout): AutoGeometry {
  const g = isStandardBackyard(layout) ? backyardGeometry(layout) : isStandardFront(layout) ? frontGeometry(layout) : null
  if (!g) return { vertices: chainVertices(layout), house: null, houseNotToScale: false, notes: [] }
  // The first side starts at x = 0, as plans have always been drawn, so photo
  // pins saved on earlier quotes stay where they were put.
  const dx = -g.vertices[0].x
  const move = (p: PlanPoint) => ({ x: p.x + dx, y: p.y })
  return { ...g, vertices: g.vertices.map(move), house: g.house?.map(move) ?? null }
}

/** The corners where sides meet, in feet: sides+1 points (open) or sides (closed). */
export function autoVertices(layout: YardLayout): PlanPoint[] {
  return autoGeometry(layout).vertices
}

export function vertexCount(layout: YardLayout): number {
  return layout.closed && layout.sides.length > 1 ? layout.sides.length : layout.sides.length + 1
}

/** The measurements the drawing depends on; a corner dragged for other measurements no longer applies. */
export function layoutSignature(layout: YardLayout): string {
  return JSON.stringify(layout.sides.map(s => [s.on ? 1 : 0, s.lengthIn, s.startFinish, s.endFinish, s.meetsHouse?.at ?? '', s.meetsHouse?.distanceIn ?? 0]))
}

export function planVertices(layout: YardLayout): PlanPoint[] {
  const custom = layout.plan?.points
  const forNow = layout.plan?.pointsFor == null || layout.plan.pointsFor === layoutSignature(layout)
  return custom && custom.length === vertexCount(layout) && forNow ? custom : autoVertices(layout)
}

/** Vertex indexes that are corner posts (where a side turns into the next). */
export function cornerVertices(layout: YardLayout, result: LayoutResult = deriveLayout(layout)): number[] {
  const n = vertexCount(layout)
  const out: number[] = []
  layout.sides.forEach((s, i) => { if (s.on && result.sides[i]?.finishes.end === 'corner') out.push((i + 1) % n) })
  return out
}

const lerp = (a: PlanPoint, b: PlanPoint, t: number): PlanPoint => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
const unit = (dx: number, dy: number): PlanPoint => { const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l } }

/**
 * @param runSections Sections in each run of `result.runs`, same order, for
 *   the line posts. When missing, `widthFt` is used to count them.
 */
export function buildPlan(layout: YardLayout, result: LayoutResult = deriveLayout(layout), runSections?: number[], widthFt = 8): Plan {
  const v = planVertices(layout)
  const at = (i: number) => v[i % v.length]

  // Which way is the yard: the polygon through every corner (closed through
  // the house for a backyard) turns one way; the yard is on that side.
  let area = 0
  for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length]; area += p.x * q.y - q.x * p.y }
  const leftIsIn = area >= 0

  const sides: PlanSide[] = []
  const posts: PlanPost[] = []
  let runIndex = 0
  const housePts: PlanPoint[] = []

  layout.sides.forEach((s, i) => {
    const r = result.sides[i]
    const a = at(i), b = at(i + 1)
    const dir = unit(b.x - a.x, b.y - a.y)
    const inward = leftIsIn ? { x: -dir.y, y: dir.x } : { x: dir.y, y: -dir.x }
    const out = { x: -inward.x, y: -inward.y }
    if (!s.on) return
    const L = r.lengthIn
    const placeholder = !(L > 0)
    const pt = (inches: number) => lerp(a, b, L > 0 ? inches / L : 0)

    if (r.finishes.start === 'house' && r.touchesStart) housePts.push(a)
    if (r.finishes.end === 'house' && r.touchesEnd) housePts.push(b)

    const fence = r.pieceSpans.map(([f, t]) => ({ a: pt(f), b: pt(t) }))
    const skip = r.skipSpan && s.skip ? { a: pt(r.skipSpan[0]), b: pt(r.skipSpan[1]), kind: s.skip.kind } : null
    let gate: PlanSide['gate'] = null
    if (r.gateSpan && s.gate) {
      const ga = pt(r.gateSpan[0]), gb = pt(r.gateSpan[1])
      gate = { a: ga, b: gb, type: s.gate.type, swing: inward, label: `${formatFtIn(s.gate.widthIn).replace(` 0"`, '')} ${s.gate.type === 'double' ? 'double gate' : 'walk gate'}` }
      posts.push({ ...ga, kind: 'gate' }, { ...gb, kind: 'gate' })
    }

    // Line posts: evenly spaced inside each piece at its section count.
    r.pieceSpans.forEach(([f, t]) => {
      const secs = runSections?.[runIndex] ?? Math.ceil((t - f) / 12 / widthFt - 1e-9)
      runIndex += 1
      for (let k = 1; k < secs; k++) posts.push({ ...pt(f + ((t - f) * k) / secs), kind: 'line' })
    })

    // Ends: corners are drawn once, at the earlier side's end.
    if (r.touchesStart && r.finishes.start !== 'corner') posts.push({ ...a, kind: 'end' })
    if (r.finishes.end === 'corner') posts.push({ ...b, kind: 'corner' })
    else if (r.touchesEnd) posts.push({ ...b, kind: 'end' })
    if (r.skipSpan) {
      for (const x of r.skipSpan) {
        if (x > 0.01 && x < L - 0.01 && r.pieceSpans.some(([f, t]) => Math.abs(f - x) < 0.01 || Math.abs(t - x) < 0.01)
          && !(r.gateSpan && (Math.abs(r.gateSpan[0] - x) < 0.01 || Math.abs(r.gateSpan[1] - x) < 0.01))) {
          posts.push({ ...pt(x), kind: 'end' })
        }
      }
    }

    const sideSections = r.runs.reduce((t, _, k) => t + (runSections?.[runIndex - r.runs.length + k] ?? 0), 0)
    sides.push({
      sideId: s.id, name: s.name, a, b, fence, skip, gate, out, placeholder,
      label: placeholder ? `${s.name}: tap to enter` : formatFtIn(L),
      sublabel: placeholder ? '' : `${s.name}${sideSections > 0 ? ` · ${sideSections} sec` : ''}`,
    })
  })

  // The house: square and level, from the typed measurements (never from
  // dragged corners). Other shapes: a gray box beside where the fence meets it.
  const auto = autoGeometry(layout)
  let house: PlanPoint[] | null = null
  if (auto.house) {
    house = auto.house
  } else if (housePts.length >= 2) {
    const p = housePts[0], q = housePts[housePts.length - 1]
    const span = Math.hypot(q.x - p.x, q.y - p.y)
    const d = unit(q.x - p.x, q.y - p.y)
    // Away from the yard: opposite the side the corners are on.
    const mid = lerp(p, q, 0.5)
    const c = v.reduce((t, x) => ({ x: t.x + x.x / v.length, y: t.y + x.y / v.length }), { x: 0, y: 0 })
    let nrm = { x: -d.y, y: d.x }
    if ((c.x - mid.x) * nrm.x + (c.y - mid.y) * nrm.y > 0) nrm = { x: -nrm.x, y: -nrm.y }
    const depth = Math.max(24, span * 0.5)
    house = [p, q, { x: q.x + nrm.x * depth, y: q.y + nrm.y * depth }, { x: p.x + nrm.x * depth, y: p.y + nrm.y * depth }]
  } else if (housePts.length === 1) {
    const p = housePts[0], size = 28
    house = [p, { x: p.x + size, y: p.y }, { x: p.x + size, y: p.y - size }, { x: p.x, y: p.y - size }]
  }

  const all = [...v, ...(house ?? [])]
  const bounds = {
    minX: Math.min(...all.map(p => p.x)), maxX: Math.max(...all.map(p => p.x)),
    minY: Math.min(...all.map(p => p.y)), maxY: Math.max(...all.map(p => p.y)),
  }
  return {
    vertices: v, sides, posts, house,
    houseNotToScale: !!house && !!auto.house && auto.houseNotToScale,
    notes: auto.notes,
    corners: cornerVertices(layout, result),
    street: ['backyard', 'front', 'perimeter'].includes(layout.shape), bounds,
  }
}

// ── Aerial photo ──────────────────────────────────────────────────────────────

/** Pixels across the aerial photo (it is square). */
export const AERIAL_PX = 800

/**
 * USGS National Map NAIP aerial photo (public domain, free, no key) of the
 * square `halfM` meters each way around a point. About 0.3 m per pixel in
 * Marion County; takes 10 to 20 seconds to come back.
 */
export function aerialUrl(lat: number, lng: number, halfM: number, sizePx = AERIAL_PX): string {
  const dLat = halfM / 111320
  const dLng = halfM / (111320 * Math.cos((lat * Math.PI) / 180))
  const q = new URLSearchParams({
    bbox: `${lng - dLng},${lat - dLat},${lng + dLng},${lat + dLat}`,
    bboxSR: '4326', imageSR: '3857', size: `${sizePx},${sizePx}`, format: 'jpg', f: 'image',
  })
  return `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage?${q}`
}

/** Feet per pixel of that photo. */
export function aerialFtPerPx(halfM: number, sizePx = AERIAL_PX): number {
  return (2 * halfM) / 0.3048 / sizePx
}

/** The computed corners moved so the drawing is centered on (0, 0). */
export function centeredVertices(layout: YardLayout): PlanPoint[] {
  const v = autoVertices(layout)
  const xs = v.map(p => p.x), ys = v.map(p => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return v.map(p => ({ x: p.x - cx, y: p.y - cy }))
}
