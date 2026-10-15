/**
 * Site plan geometry: where each side, post, gate swing, skip and the house
 * go, in feet with y pointing up. Pure; SitePlan.tsx draws what this returns.
 *
 * Sides are laid end to end in their drawing direction at their measured
 * length (a side with no length yet gets a short stand-in). Corners dragged
 * by hand (layout.plan.points) replace the computed ones. The drawing is a
 * picture of the job, not a survey.
 */

import { deriveLayout, formatFtIn, type LayoutResult, type PlanPoint, type YardLayout } from './yardLayout'

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

/** The corners where sides meet, in feet: sides+1 points (open) or sides (closed). */
export function autoVertices(layout: YardLayout): PlanPoint[] {
  const lengths = layout.sides.map(s => s.lengthIn / 12)
  const longest = Math.max(0, ...lengths)
  const standIn = Math.max(20, longest * 0.3)
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

export function vertexCount(layout: YardLayout): number {
  return layout.closed && layout.sides.length > 1 ? layout.sides.length : layout.sides.length + 1
}

export function planVertices(layout: YardLayout): PlanPoint[] {
  const custom = layout.plan?.points
  return custom && custom.length === vertexCount(layout) ? custom : autoVertices(layout)
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

  // The house: a gray box on the house side of the line between where the
  // fence meets it (one meeting point gets a box beside it).
  let house: PlanPoint[] | null = null
  if (housePts.length >= 2) {
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
  return { vertices: v, sides, posts, house, street: ['backyard', 'front', 'perimeter'].includes(layout.shape), bounds }
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
