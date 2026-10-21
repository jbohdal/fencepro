/**
 * Site plan screen layout: how plan feet map onto the drawing, where each
 * gate leaf swings on screen, and where every text label goes so that no two
 * labels overlap and no label sits on the fence, a gate swing or the house.
 * Pure; SitePlan.tsx draws exactly what this returns, and the unit tests
 * check the same boxes.
 *
 * Labels are placed greedily: the pieces of split sides first (fence pieces,
 * gates, skips), since they must sit right next to their piece, then each
 * side's length and name, which can move along or away from its side. Each
 * label tries spots in order (next to its line, a little further out, the
 * other side, then off to the side with a small leader line) and takes the
 * first that is clear.
 */

import type { Plan, PlanGate, PlanSide } from './sitePlanGeometry'
import type { PlanPoint } from './yardLayout'

export const PLAN_COLORS = { PURPLE: '#5E28A1', GRAY: '#746C80', LIGHT: '#CBC4D6', INK: '#1C1030' }

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface Seg { x1: number; y1: number; x2: number; y2: number }

export interface PlanScreen {
  W: number
  H: number
  ftPerPx: number
  toX: (x: number) => number
  toY: (y: number) => number
  fromX: (sx: number) => number
  fromY: (sy: number) => number
}

/** Feet → drawing units. `fontScale` > 1 leaves more room at the sides for bigger labels (phones). */
export function planScreen(plan: Pick<Plan, 'bounds' | 'street'>, opts: { aerial?: { ftPerPx: number; sizePx: number; shiftFt?: PlanPoint } | null; held?: Plan['bounds'] | null; fontScale?: number } = {}): PlanScreen {
  if (opts.aerial) {
    // The photo's real ground scale; the plan moved on it by shiftFt (feet).
    const W = opts.aerial.sizePx, H = W, f = opts.aerial.ftPerPx
    const sx0 = opts.aerial.shiftFt?.x ?? 0, sy0 = opts.aerial.shiftFt?.y ?? 0
    return { W, H, ftPerPx: f, toX: x => W / 2 + (x + sx0) / f, toY: y => H / 2 - (y + sy0) / f, fromX: sx => (sx - W / 2) * f - sx0, fromY: sy => (H / 2 - sy) * f - sy0 }
  }
  const fs = opts.fontScale ?? 1
  const b = opts.held ?? plan.bounds
  const bw = Math.max(b.maxX - b.minX, 10), bh = Math.max(b.maxY - b.minY, 10)
  const W = 640, pad = 64
  // Room at the sides for the labels beside the side runs ("Left side · 15 sec").
  const padX = 120 * fs
  const s = Math.min((W - 2 * padX) / bw, 420 / bh)
  const H = Math.max(240, bh * s + 2 * pad + (plan.street ? 28 : 0))
  const offX = (W - bw * s) / 2, offY = pad
  return {
    W, H, ftPerPx: 1 / s,
    toX: x => offX + (x - b.minX) * s,
    toY: y => offY + (b.maxY - y) * s,
    fromX: sx => (sx - offX) / s + b.minX,
    fromY: sy => b.maxY - (sy - offY) / s,
  }
}

// ── Text boxes ────────────────────────────────────────────────────────────────

/** Width of a line of text, a little generous for the usual sans serif. */
export function textWidth(text: string, size: number, weight = 400): number {
  let em = 0
  for (const ch of text) {
    em += /[0-9]/.test(ch) ? 0.56 : ch === ' ' || ch === '·' ? 0.3 : ch === "'" ? 0.22 : ch === '"' ? 0.38 : /[A-Z]/.test(ch) ? 0.68 : /[ijlft]/.test(ch) ? 0.3 : /[mw]/.test(ch) ? 0.84 : 0.56
  }
  return em * size * (weight >= 600 ? 1.07 : 1)
}
const ASC = 0.8, DESC = 0.24

export interface LabelLine { text: string; size: number; weight: number; fill: string; dy: number }
export interface PlacedLabel {
  key: string
  kind: 'side' | 'fence' | 'gate' | 'skip'
  sideId: string
  sideName: string
  lines: LabelLine[]
  x: number
  /** Baseline of the first line. */
  y: number
  anchor: 'start' | 'middle' | 'end'
  box: Box
  leader: Seg | null
  /** False only when no clear spot was found (drawn at the least crowded one). */
  clear: boolean
}

function blockSize(lines: LabelLine[]): { w: number; asc: number; h: number } {
  const w = Math.max(...lines.map(l => textWidth(l.text, l.size, l.weight)))
  const asc = ASC * lines[0].size
  const last = lines[lines.length - 1]
  return { w, asc, h: asc + last.dy + DESC * last.size }
}

// ── Gate leaves on screen ─────────────────────────────────────────────────────

export interface ScreenLeaf {
  hx: number; hy: number
  /** Closed position end (toward the latch) and open position end. */
  cx: number; cy: number
  ox: number; oy: number
  r: number
  sweep: 0 | 1
  box: Box
}

/** Each leaf drawn to scale: the leaf's own width, swinging on its hinge post. */
export function screenLeaves(gate: PlanGate, sc: Pick<PlanScreen, 'toX' | 'toY'>): ScreenLeaf[] {
  return gate.leaves.map(l => {
    const hx = sc.toX(l.hinge.x), hy = sc.toY(l.hinge.y)
    const lx = sc.toX(l.latch.x), ly = sc.toY(l.latch.y)
    const len = Math.hypot(lx - hx, ly - hy)
    const d = { x: (lx - hx) / (len || 1), y: (ly - hy) / (len || 1) }
    const o = { x: l.dir.x, y: -l.dir.y }
    const r = Math.max(len, 6)
    const cx = hx + d.x * r, cy = hy + d.y * r, ox = hx + o.x * r, oy = hy + o.y * r
    const mx = hx + (d.x + o.x) * r * Math.SQRT1_2, my = hy + (d.y + o.y) * r * Math.SQRT1_2
    const xs = [hx, cx, ox, mx], ys = [hy, cy, oy, my]
    return {
      hx, hy, cx, cy, ox, oy, r,
      sweep: d.x * o.y - d.y * o.x > 0 ? 1 : 0,
      box: { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) },
    }
  })
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

export function boxesOverlap(a: Box, b: Box, gap = 0): boolean {
  return a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap
}
const grow = (b: Box, g: number): Box => ({ x0: b.x0 - g, y0: b.y0 - g, x1: b.x1 + g, y1: b.y1 + g })

/** Does the segment cross or touch the box (Liang-Barsky)? */
export function segHitsBox(s: Seg, b: Box): boolean {
  let t0 = 0, t1 = 1
  const dx = s.x2 - s.x1, dy = s.y2 - s.y1
  const p = [-dx, dx, -dy, dy], q = [s.x1 - b.x0, b.x1 - s.x1, s.y1 - b.y0, b.y1 - s.y1]
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue }
    const t = q[i] / p[i]
    if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t }
    else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return true
}

function pointInPoly(x: number, y: number, poly: Array<{ x: number; y: number }>): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j]
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function polyHitsBox(poly: Array<{ x: number; y: number }>, b: Box): boolean {
  if (poly.length < 3) return false
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length]
    if (segHitsBox({ x1: p.x, y1: p.y, x2: q.x, y2: q.y }, b)) return true
  }
  return pointInPoly((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, poly)
}

// ── Obstacles and placement ───────────────────────────────────────────────────

export interface PlanObstacles {
  /** Fence lines: every side end to end, on screen. */
  fence: Seg[]
  /** The house, on screen. */
  house: Array<{ x: number; y: number }> | null
  /** Gate swings and other drawn things labels keep off. */
  boxes: Box[]
  /** Where labels may go. */
  area: Box
}

/** Clearance between a label and a fence line, in drawing units. */
export const FENCE_CLEAR = 3
/** Gap kept between two labels. */
export const LABEL_GAP = 2

export function planObstacles(plan: Plan, sc: PlanScreen): PlanObstacles {
  const fence = plan.sides.map(sd => ({ x1: sc.toX(sd.a.x), y1: sc.toY(sd.a.y), x2: sc.toX(sd.b.x), y2: sc.toY(sd.b.y) }))
  const house = plan.house ? plan.house.map(p => ({ x: sc.toX(p.x), y: sc.toY(p.y) })) : null
  const boxes: Box[] = []
  for (const sd of plan.sides) if (sd.gate) for (const l of screenLeaves(sd.gate, sc)) boxes.push(l.box)
  // "Not to scale for permitting", top left.
  boxes.push({ x0: 10, y0: 8, x1: 12 + textWidth('Not to scale for permitting', 10.5), y1: 22 })
  const bottom = plan.street ? sc.H - 26 : sc.H - 2
  return { fence, house, boxes, area: { x0: 2, y0: 2, x1: sc.W - 2, y1: bottom } }
}

function conflicts(b: Box, obs: PlanObstacles, placed: Box[]): number {
  let n = 0
  if (b.x0 < obs.area.x0 || b.y0 < obs.area.y0 || b.x1 > obs.area.x1 || b.y1 > obs.area.y1) n += 1
  const g = grow(b, FENCE_CLEAR)
  for (const s of obs.fence) if (segHitsBox(s, g)) n += 1
  if (obs.house && polyHitsBox(obs.house, g)) n += 1
  for (const o of obs.boxes) if (boxesOverlap(b, o)) n += 1
  for (const p of placed) if (boxesOverlap(b, p, LABEL_GAP)) n += 1
  return n
}

interface Spot { cx: number; cy: number; nx: number; ny: number; from: { x: number; y: number } | null }

/** A block of text whose near edge is `off` from point p along n (screen units). */
function spot(px: number, py: number, nx: number, ny: number, off: number, w: number, h: number, from: { x: number; y: number } | null): Spot {
  const half = Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2)
  return { cx: px + nx * (off + half), cy: py + ny * (off + half), nx, ny, from }
}

function boxOf(s: Spot, w: number, h: number): Box {
  return { x0: s.cx - w / 2, y0: s.cy - h / 2, x1: s.cx + w / 2, y1: s.cy + h / 2 }
}

function nearestOnBox(b: Box, x: number, y: number) {
  return { x: Math.min(Math.max(x, b.x0), b.x1), y: Math.min(Math.max(y, b.y0), b.y1) }
}

function leaderFor(s: Spot, b: Box): Seg | null {
  if (!s.from) return null
  const e = nearestOnBox(b, s.from.x, s.from.y)
  return Math.hypot(e.x - s.from.x, e.y - s.from.y) > 4 ? { x1: s.from.x, y1: s.from.y, x2: e.x, y2: e.y } : null
}

interface Placed { boxes: Box[]; leaders: Seg[] }

function place(key: string, kind: PlacedLabel['kind'], sd: PlanSide, variants: Array<{ lines: LabelLine[]; spots: Spot[] }>, obs: PlanObstacles, placed: Placed): PlacedLabel {
  let best: { s: Spot; b: Box; leader: Seg | null; n: number; lines: LabelLine[]; asc: number } | null = null
  // Each way of setting the text (a side's name can go on its own line when room is short), first clear spot wins.
  outer: for (const { lines, spots } of variants) {
    const { w, asc, h } = blockSize(lines)
    for (const s of spots) {
      const b = boxOf(s, w, h)
      const leader = leaderFor(s, b)
      let n = conflicts(b, obs, placed.boxes)
      // A leader line never runs through another label, and no label sits on a leader.
      for (const l of placed.leaders) if (segHitsBox(l, grow(b, 1))) n += 1
      if (leader) for (const o of placed.boxes) if (segHitsBox(leader, grow(o, 1))) n += 1
      if (!best || n < best.n) best = { s, b, leader, n, lines, asc }
      if (n === 0) break outer
    }
  }
  const { s, b, leader, lines, asc } = best!
  placed.boxes.push(b)
  if (leader) placed.leaders.push(leader)
  // Lines run beside a side that goes up and down, centered on one that goes across.
  const anchor: PlacedLabel['anchor'] = Math.abs(s.nx) > Math.abs(s.ny) + 0.2 ? (s.nx < 0 ? 'end' : 'start') : 'middle'
  const x = anchor === 'end' ? b.x1 : anchor === 'start' ? b.x0 : (b.x0 + b.x1) / 2
  return { key, kind, sideId: sd.sideId, sideName: sd.name, lines, x, y: b.y0 + asc, anchor, box: b, leader, clear: best!.n === 0 }
}

/** Every label on the plan, placed. Font sizes are multiplied by `fontScale`. `keepOff`: more boxes labels stay clear of. */
export function placeLabels(plan: Plan, sc: PlanScreen, fontScale = 1, keepOff: Box[] = []): PlacedLabel[] {
  const fs = fontScale
  const { PURPLE, GRAY, INK } = PLAN_COLORS
  const obs = planObstacles(plan, sc)
  // Other marks drawn on the plan (the angles at the corners) that labels keep off.
  obs.boxes.push(...keepOff)
  const placed: Placed = { boxes: [], leaders: [] }
  const out: PlacedLabel[] = []
  const scr = (sd: PlanSide) => {
    const ax = sc.toX(sd.a.x), ay = sc.toY(sd.a.y), bx = sc.toX(sd.b.x), by = sc.toY(sd.b.y)
    const len = Math.hypot(bx - ax, by - ay) || 1
    return { ax, ay, bx, by, len, dx: (bx - ax) / len, dy: (by - ay) / len, ox: sd.out.x, oy: -sd.out.y }
  }

  // 1. The pieces of split sides, right next to their pieces (so they go first): gates first (they matter most to the crew), then skips, then fence pieces.
  const order = { gate: 0, skip: 1, fence: 2 } as const
  const pieces = plan.sides.flatMap(sd => sd.pieces.map((p, k) => ({ sd, p, k }))).sort((a, b) => order[a.p.kind] - order[b.p.kind])
  for (const { sd, p, k } of pieces) {
    const g = scr(sd)
    const style = p.kind === 'gate' ? { fill: INK, weight: 600 } : p.kind === 'skip' ? { fill: GRAY, weight: 400 } : { fill: PURPLE, weight: 600 }
    const lines: LabelLine[] = [{ text: p.text, size: 11 * fs, weight: style.weight, fill: style.fill, dy: 0 }]
    const { w, h } = blockSize(lines)
    const pax = sc.toX(p.a.x), pay = sc.toY(p.a.y), pbx = sc.toX(p.b.x), pby = sc.toY(p.b.y)
    const plen = Math.hypot(pbx - pax, pby - pay)
    const mx = (pax + pbx) / 2, my = (pay + pby) / 2
    const across = Math.abs(g.dx) >= Math.abs(g.dy)
    const short = across ? w + 8 > plen : h + 6 > plen
    // Inside the yard first (the side's own label is outside); a gate's label away from its swing.
    let normals: Array<[number, number]> = [[-g.ox, -g.oy], [g.ox, g.oy]]
    if (p.kind === 'gate' && sd.gate) {
      const d = sd.gate.leaves[0].dir
      normals = [[-d.x, d.y], [d.x, -d.y]]
    }
    if (short) normals = [normals[1], normals[0]]
    const leafR = p.kind === 'gate' && sd.gate ? Math.max(...screenLeaves(sd.gate, sc).map(l => l.r)) : 0
    const spots: Spot[] = []
    const from = { x: mx, y: my }
    for (const [nx, ny] of normals) {
      const swingSide = p.kind === 'gate' && sd.gate && (nx * sd.gate.leaves[0].dir.x - ny * sd.gate.leaves[0].dir.y) > 0
      const base = swingSide ? leafR + 4 : 0
      if (!short) for (const off of [5, 11].map(o => base + o * fs)) spots.push(spot(mx, my, nx, ny, off, w, h, base > 0 ? from : null))
      for (const off of [14, 24, 36, 50].map(o => base + o * fs)) spots.push(spot(mx, my, nx, ny, off, w, h, from))
    }
    // Further out, and slid along the line (past the piece's ends), with a leader.
    const slides = [0.3 * plen, plen / 2 + w / 2 + 6, plen / 2 + w + 14, plen + w]
    for (const off of [8, 20, 34, 52, 74, 100].map(o => o * fs)) {
      for (const [nx, ny] of normals) {
        for (const sl of [0, ...slides]) {
          for (const sgn of sl === 0 ? [1] : [1, -1]) {
            const at = Math.min(plen / 2, sl) * 0.9 * sgn
            spots.push(spot(mx + g.dx * sl * sgn, my + g.dy * sl * sgn, nx, ny, off + 6, w, h, { x: mx + g.dx * at, y: my + g.dy * at }))
          }
        }
      }
    }
    out.push(place(`piece-${sd.sideId}-${k}`, p.kind, sd, [{ lines, spots }], obs, placed))
  }
  // 2. Each side's length, with its name and sections under it, outside the yard when there is room.
  for (const sd of plan.sides) {
    const g = scr(sd)
    const main: LabelLine = { text: sd.label, size: 14 * fs, weight: 700, fill: sd.placeholder ? GRAY : INK, dy: 0 }
    const sub = (text: string, k: number): LabelLine => ({ text, size: 11 * fs, weight: 400, fill: GRAY, dy: 15 * fs * k })
    const variants: LabelLine[][] = [[main, ...(sd.sublabel ? [sub(sd.sublabel, 1)] : [])]]
    // Narrower: "Right return" and "4 sections" on lines of their own.
    const parts = sd.sublabel.split(' · ')
    if (parts.length > 1) variants.push([main, ...parts.map((t, k) => sub(t, k + 1))])
    const mx = (g.ax + g.bx) / 2, my = (g.ay + g.by) / 2
    const spotsFor = (lines: LabelLine[]) => {
      const { w, h } = blockSize(lines)
      const spots: Spot[] = []
      // Beside the middle of the side first, then slid along it, then past its end (short returns
      // beside the house); then further out with a leader. Outside the yard first, then inside.
      const shifts = [0, -0.22, 0.22, -0.38, 0.38].map(a => a * g.len)
      for (const sgn of [-1, 1]) shifts.push(sgn * g.len / 2, sgn * (g.len / 2 + w / 4), sgn * (g.len / 2 + w / 2), sgn * (g.len / 2 + w / 2 + 16))
      for (const [nx, ny] of [[g.ox, g.oy], [-g.ox, -g.oy]]) for (const offs of [[10, 18, 30, 46], [64, 86, 112, 140]]) {
        for (const shift of shifts) {
          for (const off of offs.map(o => o * fs)) {
            const px = mx + g.dx * shift, py = my + g.dy * shift
            // Far from its side (a crowded corner of a small drawing): a leader back to the side.
            const far = off > 46 * fs
            const at = Math.max(-g.len / 2, Math.min(g.len / 2, shift)) * 0.9
            spots.push(spot(px, py, nx, ny, off, w, h, far ? { x: mx + g.dx * at, y: my + g.dy * at } : null))
            // Still close enough to read as its side's label when a leader would cross something.
            if (far && off <= 64 * fs) spots.push(spot(px, py, nx, ny, off, w, h, null))
          }
        }
      }
      return spots
    }
    out.push(place(`side-${sd.sideId}`, 'side', sd, variants.map(lines => ({ lines, spots: spotsFor(lines) })), obs, placed))
  }

  return out
}
