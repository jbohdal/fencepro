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

import { deriveLayout, formatFtIn, sidePieces, type GateHinge, type GateSwing, type HouseRect, type LayoutResult, type PlanPoint, type SidePiece, type YardLayout, type YardSide } from './yardLayout'
import { autoTile } from './aerialTiles'
import {
  chainEnds, chainVertices, cornerAngles, houseCorners, houseFitted, houseRectOf, houseTouching, norm180, norm360, segmentsMeet, sideCrossings, specFromVertices, teeAnchor,
  type ChainSpec, type CornerAngle, type SideCrossing, type SideEnds,
} from './yardChain'

export interface PlanPost {
  x: number; y: number
  /** 'tee': where a side starts from another side (counted as the end post it is today). */
  kind: 'corner' | 'end' | 'gate' | 'line' | 'tee'
  /** A gate's hinge post (drawn as a dark square). */ hinge?: boolean
}
/** One gate leaf: hangs on `hinge`, closes toward `latch`, opens toward `dir` (unit, plan feet). */
export interface PlanGateLeaf { hinge: PlanPoint; latch: PlanPoint; swing: GateSwing; dir: PlanPoint; side: GateHinge }
export interface PlanGate {
  a: PlanPoint
  b: PlanPoint
  type: 'walk' | 'double'
  /** Unit vector into the yard. */
  swing: PlanPoint
  label: string
  leaves: PlanGateLeaf[]
  /** Walk gate: the hinge side as seen from inside the yard; null for a double gate. */
  hinge: GateHinge | null
  /** True when the hinge side was not set and the default was used. */
  hingeDefaulted: boolean
  /** Swing of each leaf (walk gate: both the same). */
  leafSwing: { left: GateSwing; right: GateSwing }
  /** "swings in, hinges left" for the crew. */
  swingText: string
}
/** A labeled piece of a split side, placed on the plan. */
export type PlanPiece = SidePiece & { a: PlanPoint; b: PlanPoint }
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
  gate: PlanGate | null
  /** Each piece of a side split by a gate or skip, with its own length (empty when not split). */
  pieces: PlanPiece[]
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
  /** Backyard returns that meet the house: where, and how far from its back corner (feet). */
  houseAttach: Array<{ sideId: string; name: string; which: 'left' | 'right'; at: PlanPoint; distFt: number }>
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  /** The house as a box (middle, size, turn) and how it is placed (see houseOnPlan). */
  houseRect: HouseRect | null
  houseMode: HouseOnPlan['mode']
  /** The angle at every corner and tee. */
  angles: CornerAngle[]
  /** Sides that cross or run over each other ("Side 3 crosses Side 6, check the drawing"). */
  crossings: SideCrossing[]
  /** Every corner and end point that can be dragged (vertex indexes), and each tee's start. */
  handles: number[]
  tees: Array<{ sideId: string; name: string; at: PlanPoint; anchorId: string }>
  /** Drawn from the angles (an edited drawing) rather than the shape's own. */
  chain: boolean
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
function yardWidth(across: number | null, rise: number, fallback: number, names: [string, string, string], notes: string[], typed = true): number {
  if (across === null) return fallback
  if (across + 1e-6 >= Math.abs(rise)) return Math.sqrt(Math.max(0, across * across - rise * rise))
  // Only measurements actually typed are questioned; stand-ins just draw.
  if (!typed) return Math.max(fallback, across)
  notes.push(`Check these measurements: the ${names[0]} (${fmtFt(across)}) is shorter than the difference between the ${names[1]} and the ${names[2]} (${fmtFt(Math.abs(rise))}).`)
  return Math.max(fallback, across)
}

/** How deep the house is drawn (feet): deep enough for either return to meet it. */
function houseDepthFt(layout: YardLayout): number {
  const d = (s?: YardSide) => (s?.on && s.meetsHouse?.at === 'distance' ? Math.max(0, (s.meetsHouse.distanceIn ?? 0) / 12) : 0)
  return Math.max(HOUSE_DEPTH_FT, d(layout.sides[0]) + 8, d(layout.sides[4]) + 8)
}

/**
 * Where each backyard return meets the house, in feet from the house's back
 * corner toward the street: back corner = 0, front corner = the house depth,
 * or the saved distance. Drawing only; never footage or price.
 */
export function houseMeetsOf(layout: YardLayout): { left: number; right: number; depth: number } {
  const depth = houseDepthFt(layout)
  const one = (s?: YardSide) => {
    if (!s?.on || !s.meetsHouse) return 0
    if (s.meetsHouse.at === 'front') return depth
    if (s.meetsHouse.at === 'distance') return Math.max(0, (s.meetsHouse.distanceIn ?? 0) / 12)
    return 0
  }
  return { left: one(layout.sides[0]), right: one(layout.sides[4]), depth }
}

/** True when the house can be slid on the drawing (a backyard with a return meeting the house). */
export function canMoveHouse(layout: YardLayout): boolean {
  return isStandardBackyard(layout) && (returnHouseEnd(layout, 0) !== null || returnHouseEnd(layout, 4) !== null)
}

/**
 * Set where the returns meet the house (feet from the back corner, snapped to
 * whole feet). 0 is the back corner (saved as unset, as before). Once the
 * drawing has its own angles the fence stays put and the house moves to meet
 * it there (houseOnPlan). Only `meetsHouse` changes: never lengths, gates or skips.
 */
export function setHouseMeets(layout: YardLayout, meets: { left?: number; right?: number }): YardLayout {
  const val = (ft: number) => {
    const whole = Math.max(0, Math.round(ft))
    return whole === 0 ? null : { at: 'distance' as const, distanceIn: whole * 12 }
  }
  const sides = layout.sides.map((s, i) => {
    if (i === 0 && meets.left !== undefined && returnHouseEnd(layout, 0)) return { ...s, meetsHouse: val(meets.left) }
    if (i === 4 && meets.right !== undefined && returnHouseEnd(layout, 4)) return { ...s, meetsHouse: val(meets.right) }
    return s
  })
  return { ...layout, sides }
}

/** Both returns back at the house's back corners. */
export function clearHouseMeets(layout: YardLayout): YardLayout {
  if (!isStandardBackyard(layout)) return layout
  return { ...layout, sides: layout.sides.map((s, i) => ((i === 0 || i === 4) && s.meetsHouse ? { ...s, meetsHouse: null } : s)) }
}

function backyardGeometry(layout: YardLayout): AutoGeometry {
  const [lrS, lsS, backS, rsS, rrS] = layout.sides
  const standIn = standInFt(layout)
  const len = (s: YardSide) => (!s.on ? 0 : s.lengthIn > 0 ? s.lengthIn / 12 : standIn)
  const lr = len(lrS), left = len(lsS), right = len(rsS), rr = len(rrS)
  const notes: string[] = []

  // Where each return meets the house: its back corner (y = 0), its front
  // corner, or a distance toward the street from the back corner.
  const m = houseMeetsOf(layout)
  const depth = m.depth
  const yL = lrS.on && m.left ? -m.left : 0, yR = rrS.on && m.right ? -m.right : 0

  // The back joins the tops of the two sides: width from the back's length
  // and how far apart the tops are front to back.
  const rise = (yR + right) - (yL + left)
  const typed = (x: YardSide) => !x.on || x.lengthIn > 0
  // Until the back is measured, the yard is as wide as the returns and a house.
  const back = backS.on && backS.lengthIn > 0 ? len(backS) : null
  const W = yardWidth(back, rise, lr + rr + STANDIN_HOUSE_FT, ['back', 'left side', 'right side'], notes, typed(lsS) && typed(rsS))
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
    if (!noReturns && room < 0 && back !== null && typed(lrS) && typed(rrS)) notes.push(`Check these measurements: the two returns (${fmtFt(lr + rr)}) are wider than the yard (${fmtFt(W)}).`)
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
  const front = frontS.on && frontS.lengthIn > 0 ? len(frontS) : null
  const W = yardWidth(front, right - left, STANDIN_HOUSE_FT, ['front', 'left side', 'right side'], notes, lsS.lengthIn > 0 && rsS.lengthIn > 0)
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
function headingVertices(layout: YardLayout): PlanPoint[] {
  const standIn = standInFt(layout)
  const lens = layout.sides.map(s => (s.lengthIn > 0 ? s.lengthIn / 12 : standIn))
  const degs = untangledHeadings(layout, lens)
  const pts: PlanPoint[] = [{ x: 0, y: 0 }]
  layout.sides.forEach((_, i) => {
    const r = (degs[i] * Math.PI) / 180
    const p = pts[pts.length - 1]
    pts.push({ x: p.x + lens[i] * Math.cos(r), y: p.y + lens[i] * Math.sin(r) })
  })
  // A perimeter closes on its first corner whatever the tape said.
  if (layout.closed && pts.length > 2) pts.pop()
  return pts
}

/** True when p is inside the polygon. */
function inPoly(p: PlanPoint, poly: PlanPoint[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/** How many tries the untangle search makes before giving up (keeps it instant on a 60 side yard). */
const UNTANGLE_TRIES = 20000

/**
 * The drawing directions of an open yard drawn side after side (Custom,
 * Straight line, a yard with an odd number of sides) that nobody has drawn by
 * hand: each side's saved heading, unless that makes the fence cross itself.
 * Then each turn is tried the other way (the same angle, left instead of
 * right), the saved way first, side by side from the start, and the first
 * drawing with no side crossing another is used. The same every time
 * (no randomness); the angles are only flipped, never changed; drawing only.
 * A side running through the house drawn behind the first side's start
 * (when the fence starts at the house) counts as crossing too.
 */
export function untangledHeadings(layout: YardLayout, lens: number[]): number[] {
  const n = layout.sides.length
  const saved = layout.sides.map((_, i) => heading(layout, i))
  if (layout.closed || n < 3) return saved
  const turns = saved.map((h, i) => (i === 0 ? 0 : norm180(h - saved[i - 1])))
  // Only measured sides count (a stand-in for a side not typed yet would flip the drawing while typing).
  const live = (i: number) => layout.sides[i].on && layout.sides[i].lengthIn > 0
  const ends = (degs: number[]) => {
    const out: Array<{ a: PlanPoint; b: PlanPoint }> = []
    let p = { x: 0, y: 0 }
    degs.forEach((d, i) => { const r = (d * Math.PI) / 180, b = { x: p.x + lens[i] * Math.cos(r), y: p.y + lens[i] * Math.sin(r) }; out.push({ a: p, b }); p = b })
    return out
  }
  /** Side i crosses (or runs over) an earlier side that is on, other than the one it starts from. */
  const hits = (e: Array<{ a: PlanPoint; b: PlanPoint }>, i: number) => {
    if (!live(i)) return false
    for (let j = 0; j < i - 1; j++) {
      if (!live(j)) continue
      const m = segmentsMeet(e[i].a, e[i].b, e[j].a, e[j].b, 0.25)
      if (!m) continue
      return true
    }
    // Through the house drawn behind the first side's start (when it meets the house).
    if (house && i > 0 && live(i)) {
      const c = houseCorners(house)
      const mid = { x: (e[i].a.x + e[i].b.x) / 2, y: (e[i].a.y + e[i].b.y) / 2 }
      if (c.some((q, k) => segmentsMeet(e[i].a, e[i].b, q, c[(k + 1) % 4], 0.25)) || inPoly(mid, c)) return true
    }
    // Doubled straight back over the side before.
    if (i > 0 && live(i - 1)) { const m = segmentsMeet(e[i].a, e[i].b, e[i - 1].a, e[i - 1].b, 0.25); if (m?.kind === 'overlap') return true }
    return false
  }
  const first = layout.sides[0]
  const house = first.on && first.startFinish === 'house' ? houseBehind({ x: 0, y: 0, into: saved[0] }) : null
  const savedEnds = ends(saved)
  if (!saved.some((_, i) => hits(savedEnds, i))) return saved
  // Depth first, the saved turn before the flipped one: the first answer keeps the most saved turns at the start.
  const degs = saved.slice()
  let tries = 0
  const go = (i: number): boolean => {
    if (i === n) return true
    for (const t of Math.abs(turns[i]) > 1e-6 && Math.abs(Math.abs(turns[i]) - 180) > 1e-6 ? [turns[i], -turns[i]] : [turns[i]]) {
      if (++tries > UNTANGLE_TRIES) return false
      degs[i] = i === 0 ? saved[0] : norm360(degs[i - 1] + t)
      const e = ends(degs.slice(0, i + 1))
      if (!hits(e, i) && go(i + 1)) return true
    }
    return false
  }
  return go(0) ? degs : saved
}

function autoGeometry(layout: YardLayout): AutoGeometry {
  const g = isStandardBackyard(layout) ? backyardGeometry(layout) : isStandardFront(layout) ? frontGeometry(layout) : null
  if (!g) return { vertices: headingVertices(layout), house: null, houseNotToScale: false, notes: [] }
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

/** The measurements an older quote's dragged corners were drawn for (kept so those quotes read the same; no longer used to throw a drag away). */
export function layoutSignature(layout: YardLayout): string {
  return JSON.stringify(layout.sides.map(s => [s.on ? 1 : 0, s.lengthIn, s.startFinish, s.endFinish, s.meetsHouse?.at ?? '', s.meetsHouse?.distanceIn ?? 0]))
}

// ── The drawing: to scale, from the typed lengths and the angles ─────────────

/**
 * How long side i is drawn (feet): its typed length; until it is measured,
 * as long as the shape draws it (a stand-in), so saving the angles of a yard
 * not yet measured moves nothing.
 */
export function drawLenFt(layout: YardLayout, i: number): number {
  const s = layout.sides[i]
  if (!s) return 0
  if (s.lengthIn > 0) return s.lengthIn / 12
  const v = autoVertices(layout), n = layout.sides.length
  const a = v[layout.closed && n > 1 ? i % v.length : Math.min(i, v.length - 1)]
  const b = v[layout.closed && n > 1 ? (i + 1) % v.length : Math.min(i + 1, v.length - 1)]
  const auto = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0
  if (!s.on) return auto
  return auto > 0.5 ? auto : standInFt(layout)
}

/** An older quote's dragged corners, when they still fit the sides (their angles are kept; lengths are the typed ones). */
function legacyPoints(layout: YardLayout): PlanPoint[] | null {
  const p = layout.plan?.points
  return p && p.length === vertexCount(layout) && p.every(q => Number.isFinite(q?.x) && Number.isFinite(q?.y)) ? p : null
}

/**
 * Corners tapped on the aerial photo (the website quote, Draw on photo) that
 * still agree with the typed lengths (each within the foot the photo's
 * lengths are rounded to): drawn exactly where they were tapped, true to the
 * photo, until the drawing is edited or a length is typed that differs.
 */
function photoPoints(layout: YardLayout): PlanPoint[] | null {
  const p = legacyPoints(layout)
  if (!p || layout.plan?.drawn || layout.plan?.pointsFor != null || !layout.plan?.aerial) return null
  if (layout.sides.some((_, i) => teeAnchor(layout, i) !== null)) return null
  const n = layout.sides.length
  const at = (k: number) => p[layout.closed && n > 1 ? k % p.length : k]
  const agree = layout.sides.every((s, i) => !(s.lengthIn > 0) || Math.abs(Math.hypot(at(i + 1).x - at(i).x, at(i + 1).y - at(i).y) - s.lengthIn / 12) <= 0.75)
  return agree ? p : null
}

/** True once the drawing has its own angles (edited, an older quote's dragged corners, or a tee): drawn as a chain. */
export function drawingIsChain(layout: YardLayout): boolean {
  if (photoPoints(layout)) return false
  return !!layout.plan?.drawn || !!legacyPoints(layout) || layout.sides.some((_, i) => teeAnchor(layout, i) !== null)
}

/**
 * Where the drawing starts and each side's direction (by index). The saved
 * angles (layout.plan.drawn); else an older quote's dragged corners; else the
 * drawing the shape makes from the typed lengths (all square corners), so an
 * older quote looks the same until it is edited. A side added after the
 * angles were saved turns a quarter right of the side before it.
 */
export function chainSpecOf(layout: YardLayout): ChainSpec {
  const fallback = (i: number) => heading(layout, i)
  const d = layout.plan?.drawn
  if (d) {
    const deg: number[] = []
    layout.sides.forEach((s, i) => {
      const v = d.deg?.[s.id]
      deg.push(typeof v === 'number' && Number.isFinite(v) ? v : i > 0 ? norm360(deg[i - 1] - 90) : fallback(0))
    })
    const o = d.origin && Number.isFinite(d.origin.x) && Number.isFinite(d.origin.y) ? d.origin : { x: 0, y: 0 }
    return { origin: { x: o.x, y: o.y }, deg }
  }
  return specFromVertices(layout, legacyPoints(layout) ?? autoVertices(layout), fallback)
}

export interface YardDrawing {
  /** Each side's two ends as drawn. */
  ends: SideEnds[]
  vertices: PlanPoint[]
  spec: ChainSpec
  /** 'chain': drawn from the angles; 'auto': the shape's own drawing (nothing edited yet). */
  mode: 'chain' | 'auto'
}

/** The drawing: each side's start and end. */
export function yardDrawing(layout: YardLayout): YardDrawing {
  const spec = chainSpecOf(layout)
  if (drawingIsChain(layout)) {
    const ends = chainEnds(layout, spec, i => drawLenFt(layout, i))
    return { ends, vertices: chainVertices(layout, ends), spec, mode: 'chain' }
  }
  const v = photoPoints(layout) ?? autoVertices(layout)
  const n = layout.sides.length
  const at = (k: number) => v[layout.closed && n > 1 ? k % v.length : Math.min(k, v.length - 1)]
  const ends = layout.sides.map((_, i) => {
    const a = at(i), b = at(i + 1)
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    return { a, b, deg: len > 1e-9 ? Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI : spec.deg[i], lenFt: len }
  })
  return { ends, vertices: v, spec, mode: 'auto' }
}

export function planVertices(layout: YardLayout): PlanPoint[] {
  return yardDrawing(layout).vertices
}

/** Fence ends that meet the house, in side order (drawn points), each with the direction from it into the fence. */
function houseEndsDir(layout: YardLayout, result: LayoutResult, ends: SideEnds[]): Array<PlanPoint & { into: number }> {
  const out: Array<PlanPoint & { into: number }> = []
  layout.sides.forEach((s, i) => {
    const r = result.sides[i]
    if (!s.on || !r || !ends[i]) return
    if (r.finishes.start === 'house' && r.touchesStart && teeAnchor(layout, i) === null) out.push({ ...ends[i].a, into: ends[i].deg })
    if (r.finishes.end === 'house' && r.touchesEnd) out.push({ ...ends[i].b, into: ends[i].deg + 180 })
  })
  return out
}
function houseEnds(layout: YardLayout, result: LayoutResult, ends: SideEnds[]): PlanPoint[] {
  return houseEndsDir(layout, result, ends).map(({ x, y }) => ({ x, y }))
}

/** True when the shape draws its own house (a standard backyard or front yard). */
export function shapeHasHouse(layout: YardLayout): boolean {
  return !!autoGeometry(layout).house
}

/** A house behind a fence end that meets it: the fence butts square into the middle of its wall. */
function houseBehind(p: PlanPoint & { into: number }): HouseRect {
  const w = 36, d = 28, r = (p.into * Math.PI) / 180
  return { cx: p.x - Math.cos(r) * d / 2, cy: p.y - Math.sin(r) * d / 2, w, d, rotDeg: norm180(p.into + 90) }
}

export interface HouseOnPlan {
  corners: PlanPoint[] | null
  rect: HouseRect | null
  notToScale: boolean
  /**
   * How it is placed: 'auto' (the shape's house, nothing edited), 'fit' (two
   * fence ends meet it: it turns and sizes to them), 'one' (one end meets it:
   * it slides to keep touching), 'free' (no end meets it).
   */
  mode: 'auto' | 'fit' | 'one' | 'free' | null
}

/** The house box an older drawing put beside where the fence meets it (other shapes than backyard and front yard). */
function legacyHouse(E: PlanPoint[], v: PlanPoint[]): PlanPoint[] | null {
  if (E.length >= 2) {
    const p = E[0], q = E[E.length - 1]
    const span = Math.hypot(q.x - p.x, q.y - p.y)
    const d = unit(q.x - p.x, q.y - p.y)
    const mid = lerp(p, q, 0.5)
    const c = v.reduce((t, x) => ({ x: t.x + x.x / v.length, y: t.y + x.y / v.length }), { x: 0, y: 0 })
    let nrm = { x: -d.y, y: d.x }
    if ((c.x - mid.x) * nrm.x + (c.y - mid.y) * nrm.y > 0) nrm = { x: -nrm.x, y: -nrm.y }
    const depth = Math.max(24, span * 0.5)
    return [p, q, { x: q.x + nrm.x * depth, y: q.y + nrm.y * depth }, { x: p.x + nrm.x * depth, y: p.y + nrm.y * depth }]
  }
  if (E.length === 1) {
    const p = E[0], size = 28
    return [p, { x: p.x + size, y: p.y }, { x: p.x + size, y: p.y - size }, { x: p.x, y: p.y - size }]
  }
  return null
}

/**
 * The house on the drawing. Nothing edited: where the shape puts it (as
 * always). Once the drawing has its own angles the house follows the fence
 * ends that meet it: two ends, it turns and sizes so both meet it (a backyard
 * return meeting it the saved distance from its back corner); one end, it
 * slides so its nearest wall touches that end; none, it stays where it was
 * put. It can be moved, turned and sized by hand (yardDrawing.ts setHouse).
 */
export function houseOnPlan(layout: YardLayout, result: LayoutResult, dr: YardDrawing): HouseOnPlan {
  const auto = autoGeometry(layout)
  const E = houseEnds(layout, result, dr.ends)
  if (dr.mode === 'auto') {
    if (auto.house) return { corners: auto.house, rect: houseRectOf(auto.house), notToScale: auto.houseNotToScale, mode: 'auto' }
    // One end meets the house: the house behind it (the fence butts into its wall), never over the fence.
    if (E.length === 1) { const h = houseBehind(houseEndsDir(layout, result, dr.ends)[0]); return { corners: houseCorners(h), rect: h, notToScale: false, mode: 'auto' } }
    const c = legacyHouse(E, dr.vertices)
    return { corners: c, rect: c ? houseRectOf(c) : null, notToScale: false, mode: c ? 'auto' : null }
  }
  const stored = layout.plan?.drawn?.house
  const valid = (h: HouseRect | null | undefined): h is HouseRect => !!h && [h.cx, h.cy, h.w, h.d, h.rotDeg].every(Number.isFinite) && h.w > 0 && h.d > 0
  const base: HouseRect | null = valid(stored) ? stored : auto.house ? houseRectOf(auto.house) : (() => { const c = legacyHouse(E, dr.vertices); return c ? houseRectOf(c) : null })()
  const v = dr.vertices
  const yardAt = v.reduce((t, x) => ({ x: t.x + x.x / v.length, y: t.y + x.y / v.length }), { x: 0, y: 0 })
  let rect: HouseRect | null = base
  let mode: HouseOnPlan['mode'] = base ? 'free' : null
  if (E.length >= 2) {
    const p = E[0], q = E[E.length - 1]
    const m = isStandardBackyard(layout) ? houseMeetsOf(layout) : { left: 0, right: 0, depth: 0 }
    const depth = base?.d ?? (isStandardBackyard(layout) ? m.depth : Math.max(24, Math.hypot(q.x - p.x, q.y - p.y) * 0.5))
    const fit = houseFitted(p, q, m.left, m.right, depth, yardAt)
    if (fit && fit.w >= MIN_HOUSE_FT) { rect = fit; mode = 'fit' }
    else if (base) { rect = houseTouching(base, p); mode = 'one' }
  } else if (E.length === 1) {
    rect = valid(stored) ? houseTouching(stored, E[0]) : auto.house && base ? houseTouching(base, E[0]) : houseBehind(houseEndsDir(layout, result, dr.ends)[0])
    mode = 'one'
  }
  return { corners: rect ? houseCorners(rect) : null, rect, notToScale: false, mode }
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
  const drawing = yardDrawing(layout)
  const v = drawing.vertices

  // Which way is the yard: the polygon through every corner (closed through
  // the house for a backyard) turns one way; the yard is on that side.
  let area = 0
  for (let i = 0; i < v.length; i++) { const p = v[i], q = v[(i + 1) % v.length]; area += p.x * q.y - q.x * p.y }
  const leftIsIn = area >= 0

  const sides: PlanSide[] = []
  const posts: PlanPost[] = []
  let runIndex = 0
  const tees: Plan['tees'] = []

  layout.sides.forEach((s, i) => {
    const r = result.sides[i]
    const { a, b } = drawing.ends[i]
    const dir = unit(b.x - a.x, b.y - a.y)
    const inward = leftIsIn ? { x: -dir.y, y: dir.x } : { x: dir.y, y: -dir.x }
    const out = { x: -inward.x, y: -inward.y }
    if (!s.on) return
    const L = r.lengthIn
    const placeholder = !(L > 0)
    const pt = (inches: number) => lerp(a, b, L > 0 ? inches / L : 0)

    const anchor = teeAnchor(layout, i)
    if (anchor !== null) tees.push({ sideId: s.id, name: s.name, at: a, anchorId: layout.sides[anchor].id })

    const fence = r.pieceSpans.map(([f, t]) => ({ a: pt(f), b: pt(t) }))
    const skip = r.skipSpan && s.skip ? { a: pt(r.skipSpan[0]), b: pt(r.skipSpan[1]), kind: s.skip.kind } : null
    let gate: PlanSide['gate'] = null
    if (r.gateSpan && s.gate) {
      const ga = pt(r.gateSpan[0]), gb = pt(r.gateSpan[1])
      gate = gateOf(s, r.finishes, ga, gb, dir, inward, out)
      const hingeA = gate.leaves.some(l => l.hinge === ga), hingeB = gate.leaves.some(l => l.hinge === gb)
      posts.push({ ...ga, kind: 'gate', hinge: hingeA }, { ...gb, kind: 'gate', hinge: hingeB })
    }
    const pieces: PlanPiece[] = sidePieces(s, r).map(p => ({ ...p, a: pt(p.fromIn), b: pt(p.toIn) }))

    // Line posts: evenly spaced inside each piece at its section count.
    r.pieceSpans.forEach(([f, t]) => {
      const secs = runSections?.[runIndex] ?? Math.ceil((t - f) / 12 / widthFt - 1e-9)
      runIndex += 1
      for (let k = 1; k < secs; k++) posts.push({ ...pt(f + ((t - f) * k) / secs), kind: 'line' })
    })

    // Ends: corners are drawn once, at the earlier side's end.
    // A tee is posted as the end it is counted as; drawn as a tee where it meets its side.
    if (r.touchesStart && r.finishes.start !== 'corner') posts.push({ ...a, kind: anchor !== null ? 'tee' : 'end' })
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
      sideId: s.id, name: s.name, a, b, fence, skip, gate, pieces, out, placeholder,
      label: placeholder ? `${s.name}: tap to enter` : formatFtIn(L),
      sublabel: placeholder ? '' : `${s.name}${sideSections > 0 ? ` · ${sideSections} section${sideSections === 1 ? '' : 's'}` : ''}`,
    })
  })

  const home = houseOnPlan(layout, result, drawing)
  const house = home.corners
  const all = [...v, ...drawing.ends.flatMap(e => [e.a, e.b]).filter((_, k) => layout.sides[k >> 1]?.on), ...(house ?? [])]
  const bounds = {
    minX: Math.min(...all.map(p => p.x)), maxX: Math.max(...all.map(p => p.x)),
    minY: Math.min(...all.map(p => p.y)), maxY: Math.max(...all.map(p => p.y)),
  }
  const auto = autoGeometry(layout)
  const handles = v.map((_, k) => k).filter(k => {
    // A point is a handle when a side that is on starts or ends there.
    const n = layout.sides.length
    const touching = [k - 1, layout.closed && k === 0 ? n - 1 : -1, k < n ? k : -1].filter(j => j >= 0 && j < n)
    return touching.some(j => layout.sides[j].on && !(j === k && teeAnchor(layout, j) !== null))
  })
  return {
    vertices: v, sides, posts, house,
    houseNotToScale: !!house && home.notToScale,
    notes: auto.notes,
    corners: cornerVertices(layout, result),
    street: ['backyard', 'front', 'perimeter'].includes(layout.shape), bounds,
    houseAttach: houseAttachOf(layout, drawing.ends),
    houseRect: home.rect, houseMode: home.mode,
    angles: cornerAngles(layout, drawing.ends),
    crossings: sideCrossings(layout, drawing.ends),
    handles, tees, chain: drawing.mode === 'chain',
  }
}

function houseAttachOf(layout: YardLayout, ends: SideEnds[]): Plan['houseAttach'] {
  if (!canMoveHouse(layout)) return []
  const m = houseMeetsOf(layout)
  const out: Plan['houseAttach'] = []
  if (returnHouseEnd(layout, 0)) out.push({ sideId: layout.sides[0].id, name: layout.sides[0].name, which: 'left', at: ends[0].a, distFt: m.left })
  if (returnHouseEnd(layout, 4)) out.push({ sideId: layout.sides[4].id, name: layout.sides[4].name, which: 'right', at: ends[4].b, distFt: m.right })
  return out
}

/**
 * A gate's leaves: which post each hangs on and which way it opens. Left and
 * right are as seen from inside the yard, facing the gate. Unset: swings in;
 * a walk gate hinges on the end nearest the house (a side meeting the house),
 * otherwise on the end nearest the side's start.
 */
function gateOf(s: YardSide, finishes: { start: string; end: string }, ga: PlanPoint, gb: PlanPoint, dir: PlanPoint, inward: PlanPoint, out: PlanPoint): PlanGate {
  const g = s.gate!
  // Facing out of the yard, left is a quarter turn counterclockwise (y up).
  const leftVec = { x: -out.y, y: out.x }
  const bIsLeft = dir.x * leftVec.x + dir.y * leftVec.y > 0
  const endFor = (h: GateHinge): 'a' | 'b' => ((h === 'left') === bIsLeft ? 'b' : 'a')
  const sideOf = (e: 'a' | 'b'): GateHinge => ((e === 'b') === bIsLeft ? 'left' : 'right')
  const swing: GateSwing = g.swing === 'out' ? 'out' : 'in'
  const leafSwing = g.type === 'double' && g.leafSwing ? { left: g.leafSwing.left === 'out' ? 'out' as const : 'in' as const, right: g.leafSwing.right === 'out' ? 'out' as const : 'in' as const } : { left: swing, right: swing }
  const vec = (w: GateSwing) => (w === 'in' ? inward : out)
  const label = `${formatFtIn(g.widthIn).replace(` 0"`, '')} ${g.type === 'double' ? 'double gate' : 'walk gate'}`
  if (g.type === 'double') {
    const mid = lerp(ga, gb, 0.5)
    const leaves: PlanGateLeaf[] = (['a', 'b'] as const).map(e => {
      const sd = sideOf(e), w = leafSwing[sd]
      return { hinge: e === 'a' ? ga : gb, latch: mid, swing: w, dir: vec(w), side: sd }
    })
    const same = leafSwing.left === leafSwing.right
    const swingText = same ? `both leaves swing ${leafSwing.left}` : `left leaf swings ${leafSwing.left}, right leaf swings ${leafSwing.right}`
    return { a: ga, b: gb, type: g.type, swing: inward, label, leaves, hinge: null, hingeDefaulted: false, leafSwing, swingText }
  }
  const defEnd: 'a' | 'b' = finishes.start === 'house' ? 'a' : finishes.end === 'house' ? 'b' : 'a'
  const hinge: GateHinge = g.hinge === 'left' || g.hinge === 'right' ? g.hinge : sideOf(defEnd)
  const he = endFor(hinge)
  const leaves: PlanGateLeaf[] = [{ hinge: he === 'a' ? ga : gb, latch: he === 'a' ? gb : ga, swing, dir: vec(swing), side: hinge }]
  return { a: ga, b: gb, type: g.type, swing: inward, label, leaves, hinge, hingeDefaulted: !(g.hinge === 'left' || g.hinge === 'right'), leafSwing, swingText: `swings ${swing}, hinges ${hinge}` }
}

// ── Aerial photo ──────────────────────────────────────────────────────────────

/** Pixels across the aerial photo (it is square). */
export const AERIAL_PX = 800

/** USGS NAIP Plus, as a picture of any box (the server asks it: lib/aerialTiles.ts; the browser asks /p/tiles). */
export const NAIP_EXPORT = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage'
/**
 * The closest map zoom where a pixel is still a real photo pixel: the service's
 * finest pixel is 0.3 Web Mercator meters, and zoom 19 is 0.2986 m. Past this
 * the picture would only be enlarged, so nothing asks for more.
 */
export const NAIP_MAX_NATIVE_ZOOM = 19
/** Web Mercator meters per pixel at the photo's closest zoom. */
export const NAIP_FINEST_M_PER_PX = 156543.03392 / 2 ** NAIP_MAX_NATIVE_ZOOM

/** One 256 px tile of the older, softer USGS imagery (it stops at zoom 16): shown only where a sharp tile is missing. */
export function usgsBackupTileUrl(z: number, x: number, y: number): string {
  return `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`
}
export const USGS_BACKUP_MAX_ZOOM = 16

/**
 * One 256 px map tile of the yard photo (Web Mercator tile x, y at zoom z),
 * from our own server (aerialTiles.ts): Esri World Imagery when the server has
 * a key, else (or when Esri is slow) USGS NAIP, kept on the server.
 */
export function naipTileUrl(z: number, x: number, y: number): string {
  return autoTile(z, x, y)
}

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
  return `${NAIP_EXPORT}?${q}`
}

/** Feet per pixel of that photo. */
export function aerialFtPerPx(halfM: number, sizePx = AERIAL_PX): number {
  return (2 * halfM) / 0.3048 / sizePx
}

/** The computed corners moved so the drawing is centered on (0, 0). */
export function centeredVertices(layout: YardLayout): PlanPoint[] {
  const v = planVertices(layout)
  const xs = v.map(p => p.x), ys = v.map(p => p.y)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2
  return v.map(p => ({ x: p.x - cx, y: p.y - cy }))
}
