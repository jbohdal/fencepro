/**
 * Sketch and measure (Jonathan, Nov 6 2026): at the house the salesperson
 * draws a rough sketch of the fence with a finger, then types the measured
 * feet on each side. The sketch is rough and never sets a price; the typed
 * feet do. It is a layer on the walk list (walkList.ts): the sketch with its
 * feet becomes the same walk list (sides, feet, corners with their turns,
 * gates at their feet, tees at their feet, end posts, closed or open), and
 * everything prices from that as it always has.
 *
 *   - A fence line is its corner points as drawn (screen units, y down, in a
 *     VIEW_W × VIEW_H box). Open: the two ends are end posts. Closed: the last
 *     side goes back to the first corner.
 *   - Each side has the feet typed for it, corner to corner, gates included
 *     (that is how the wheel measures). The gate's width comes out of the
 *     fence feet when it becomes walk steps, as quotes count it today.
 *   - A gate sits on a side at feet from the side's first corner (unset: the
 *     middle of the side). A branch starts at a tee on an earlier line's
 *     side, feet from that side's first corner.
 *   - Where the points are (the drawing's angles, its proportions, the house)
 *     is the picture and the office's starting layout only. No price rule
 *     reads it.
 *
 * Kept on the walk list as walk.sketch. The walk list stays the truth: when
 * it is changed another way (List view, a change order, the office), the
 * sketch is made again from it (sketchFor), keeping the drawn shape when the
 * fence still has the same lines and corners.
 *
 * Imports only types from walkList.ts (walkList.ts uses the pictures here).
 */

import type { GateType } from './yardLayout'
import type { Turn, WalkLine, WalkList, WalkStep } from './walkList'

export const VIEW_W = 400
export const VIEW_H = 520

export interface SkPt { x: number; y: number }

export interface SkGate {
  id: string
  /** Side index on its line (0 = from the line's first point). */
  side: number
  /** Inches from the side's first corner to the gate's near edge. Unset: the middle of the side. */
  atIn: number | null
  widthIn: number
  type: GateType
}

export interface SkLine {
  id: string
  /** The corners as drawn, in order (a closed line: without the first one again). */
  pts: SkPt[]
  closed: boolean
  /** Feet typed for each side, inches, gates included. Null: not measured yet. */
  feetIn: Array<number | null>
  gates: SkGate[]
  /** A branch: it starts at a tee on a side of an earlier line, inches from that side's first corner (null: not measured yet). */
  tee?: { lineId: string; side: number; atIn: number | null } | null
}

export interface Sketch {
  v: 1
  lines: SkLine[]
  /** A rough box for the house (picture only). */
  house?: { x: number; y: number; w: number; h: number } | null
}

let seq = 0
export const skId = (p: string) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`
export const emptySketch = (): Sketch => ({ v: 1, lines: [] })

// ── Geometry ─────────────────────────────────────────────────────────────────

export const sideCount = (l: SkLine) => (l.closed ? l.pts.length : Math.max(0, l.pts.length - 1))
export function sideEnds(l: SkLine, k: number): [SkPt, SkPt] {
  return [l.pts[k], l.pts[(k + 1) % l.pts.length]]
}
const d2 = (a: SkPt, b: SkPt) => Math.hypot(a.x - b.x, a.y - b.y)
/** The nearest point on a–b to p, and how far along (0..1). */
export function nearestOn(p: SkPt, a: SkPt, b: SkPt): { pt: SkPt; t: number; dist: number } {
  const dx = b.x - a.x, dy = b.y - a.y
  const L2 = dx * dx + dy * dy
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0
  const pt = { x: a.x + dx * t, y: a.y + dy * t }
  return { pt, t, dist: d2(p, pt) }
}
/** Which way the fence turns from direction a→b to b→c (screen y down): left or right, walking along it. */
export function turnAt(a: SkPt, b: SkPt, c: SkPt): Turn {
  // In y-up terms: cross > 0 is a left turn. y down flips the sign.
  const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
  return cross < 0 ? 'left' : 'right'
}
/** Direction in degrees, y up (0 = right, 90 = up the page), of a→b drawn on screen (y down). */
export const degUp = (a: SkPt, b: SkPt) => (Math.atan2(-(b.y - a.y), b.x - a.x) * 180) / Math.PI

/** Ramer–Douglas–Peucker: the corners of a rough line. */
function rdp(pts: SkPt[], eps: number): SkPt[] {
  if (pts.length < 3) return pts.slice()
  let worst = 0, at = 0
  const a = pts[0], b = pts[pts.length - 1]
  for (let i = 1; i < pts.length - 1; i++) {
    const d = nearestOn(pts[i], a, b).dist
    if (d > worst) { worst = d; at = i }
  }
  if (worst <= eps) return [a, b]
  return [...rdp(pts.slice(0, at + 1), eps).slice(0, -1), ...rdp(pts.slice(at), eps)]
}

const angleBetween = (a: SkPt, b: SkPt, c: SkPt) => {
  const u = Math.atan2(b.y - a.y, b.x - a.x), v = Math.atan2(c.y - b.y, c.x - b.x)
  let d = Math.abs(((v - u) * 180) / Math.PI) % 360
  if (d > 180) d = 360 - d
  return d
}

/** Straight sides from a finger stroke: a corner wherever the line changes direction. No grid, no snapping. */
export function straighten(raw: SkPt[], opts: { eps?: number; minSide?: number; minTurn?: number } = {}): SkPt[] {
  const eps = opts.eps ?? 9, minSide = opts.minSide ?? 16, minTurn = opts.minTurn ?? 22
  // Drop repeats so a still finger doesn't make corners.
  const clean: SkPt[] = []
  for (const p of raw) if (!clean.length || d2(clean[clean.length - 1], p) >= 1.5) clean.push(p)
  if (clean.length < 2) return clean
  let pts = rdp(clean, eps)
  // Merge nearly straight corners and tiny sides (a wobble or a hook at the end of the stroke).
  let changed = true
  while (changed && pts.length > 2) {
    changed = false
    for (let i = 1; i < pts.length - 1; i++) {
      if (angleBetween(pts[i - 1], pts[i], pts[i + 1]) < minTurn) { pts.splice(i, 1); changed = true; break }
    }
    if (changed) continue
    let shortest = -1, len = Infinity
    for (let i = 0; i < pts.length - 1; i++) { const L = d2(pts[i], pts[i + 1]); if (L < len) { len = L; shortest = i } }
    if (len < minSide && pts.length > 2) {
      // A short first or last side goes; a short middle side: its two corners become one.
      if (shortest === 0) pts.splice(1, 1)
      else if (shortest === pts.length - 2) pts.splice(pts.length - 2, 1)
      else pts.splice(shortest, 2, { x: (pts[shortest].x + pts[shortest + 1].x) / 2, y: (pts[shortest].y + pts[shortest + 1].y) / 2 })
      changed = true
    }
  }
  return pts
}

// ── Names: sides, corners ────────────────────────────────────────────────────

/** Lines in priced order: a branch after the line its tee is on (as walkList.ts lays them out). */
export function orderedLines(sk: Sketch): SkLine[] {
  const done = new Set<string>(), out: SkLine[] = []
  const place = (l: SkLine, depth = 0) => {
    if (done.has(l.id) || depth > 20) return
    if (l.tee) { const host = sk.lines.find(x => x.id === l.tee!.lineId); if (host) place(host, depth + 1) }
    done.add(l.id); out.push(l)
  }
  for (const l of sk.lines) place(l)
  return out
}

/** Every side numbered as the walk list and the quote number them ("Side 3"). */
export function sideNumbers(sk: Sketch): Array<{ lineId: string; side: number; n: number }> {
  const out: Array<{ lineId: string; side: number; n: number }> = []
  for (const l of orderedLines(sk)) for (let k = 0; k < sideCount(l); k++) out.push({ lineId: l.id, side: k, n: out.length + 1 })
  return out
}
export const sideNo = (sk: Sketch, lineId: string, side: number) => sideNumbers(sk).find(s => s.lineId === lineId && s.side === side)?.n ?? 0

/** Every point numbered: corners ("Corner 4"), end posts and tees. */
export function pointNames(sk: Sketch): Map<string, string> {
  const out = new Map<string, string>()
  let c = 0, e = 0
  for (const l of orderedLines(sk)) {
    l.pts.forEach((_, i) => {
      const key = `${l.id}:${i}`
      if (i === 0 && l.tee) { out.set(key, 'the tee'); return }
      if (!l.closed && (i === 0 || i === l.pts.length - 1)) { e += 1; out.set(key, `End post ${e}`); return }
      c += 1; out.set(key, `Corner ${c}`)
    })
  }
  return out
}
/** Where a side's feet are measured from: "Corner 3", "End post 1", "the tee". */
export const fromName = (sk: Sketch, lineId: string, side: number) => pointNames(sk).get(`${lineId}:${side}`) ?? 'the corner'
export const toName = (sk: Sketch, lineId: string, side: number) => {
  const l = sk.lines.find(x => x.id === lineId)
  return l ? pointNames(sk).get(`${lineId}:${(side + 1) % l.pts.length}`) ?? 'the corner' : 'the corner'
}

// ── Feet ─────────────────────────────────────────────────────────────────────

/** Where a gate's near edge is on its side, inches: as set, else the middle (once the side has feet). */
export function gateAt(l: SkLine, g: SkGate): number | null {
  if (g.atIn != null) return g.atIn
  const L = l.feetIn[g.side]
  return L != null && L > 0 ? Math.max(0, Math.round(((L - g.widthIn) / 2) * 8) / 8) : null
}

/** Inches walked (gates in) and of fence (gates out), as the top of the screen says them. */
export function sketchTotals(sk: Sketch): { walkedIn: number; fenceIn: number; gatesIn: number } {
  let walked = 0, gates = 0
  for (const l of sk.lines) {
    for (const f of l.feetIn) walked += Math.max(0, f ?? 0)
    for (const g of l.gates) gates += Math.max(0, g.widthIn)
  }
  return { walkedIn: walked, fenceIn: Math.max(0, walked - gates), gatesIn: gates }
}

const ftText = (inches: number) => {
  const f = Math.round((inches / 12) * 100) / 100
  return `${Number.isInteger(f) ? f : f.toFixed(f * 10 % 1 === 0 ? 1 : 2)} ft`
}

/** One thing to fix, said plainly, and where (to light it up). */
export interface SketchProblem { text: string; lineId?: string; side?: number; gateId?: string; tee?: string }

/** What to fix before prices; [] when the sketch can be priced. */
export function sketchProblems(sk: Sketch): SketchProblem[] {
  const out: SketchProblem[] = []
  if (!sk.lines.length) return [{ text: 'Draw the fence with your finger.' }]
  for (const l of orderedLines(sk)) {
    const n = sideCount(l)
    if (l.tee) {
      const host = sk.lines.find(x => x.id === l.tee!.lineId)
      const hostL = host?.feetIn[l.tee.side]
      if (l.tee.atIn == null) out.push({ text: `How far from ${fromName(sk, l.tee.lineId, l.tee.side)} is the branch? Tap the tee.`, tee: l.id })
      else if (hostL != null && l.tee.atIn > hostL) out.push({ text: `The branch on Side ${sideNo(sk, l.tee.lineId, l.tee.side)} is past ${toName(sk, l.tee.lineId, l.tee.side)}. Tap the tee to fix its feet.`, tee: l.id })
    }
    for (let k = 0; k < n; k++) {
      const L = l.feetIn[k]
      if (!(L != null && L > 0)) { out.push({ text: `Side ${sideNo(sk, l.id, k)} has no feet. Tap it.`, lineId: l.id, side: k }); continue }
      const gs = l.gates.filter(g => g.side === k).map(g => ({ g, at: gateAt(l, g)! })).sort((a, b) => a.at - b.at)
      let end = 0
      for (const { g, at } of gs) {
        if (!(g.widthIn > 0)) out.push({ text: `A gate on Side ${sideNo(sk, l.id, k)} has no width. Tap it.`, lineId: l.id, side: k, gateId: g.id })
        else if (at + g.widthIn > L + 0.01) out.push({ text: `The ${ftText(g.widthIn)} gate on Side ${sideNo(sk, l.id, k)} runs past ${toName(sk, l.id, k)}. Tap the gate to move it, or check the side's feet.`, lineId: l.id, side: k, gateId: g.id })
        else if (at < end - 0.01) out.push({ text: `Two gates on Side ${sideNo(sk, l.id, k)} overlap. Tap one to move it.`, lineId: l.id, side: k, gateId: g.id })
        end = Math.max(end, at + g.widthIn)
      }
    }
  }
  const t = sketchTotals(sk)
  if (!out.length && !(t.fenceIn > 0)) out.push({ text: 'There are no feet of fence yet.' })
  return out
}

// ── Sketch → walk list (what is priced) ──────────────────────────────────────

/**
 * The walk list for this sketch: each line walked from its first point, each side's gates and tees in order of
 * their feet, a corner (turning as drawn) between sides, an end post at an open line's end, Back to start for a
 * closed one; a branch from its tee. Ids are made from the sketch's, so the same sketch gives the same walk.
 */
export function sketchToWalk(sk: Sketch): WalkList {
  const lines: WalkLine[] = []
  const branchesOn = (lineId: string, side: number) => sk.lines.filter(b => b.tee && b.tee.lineId === lineId && b.tee.side === side && sk.lines.some(h => h.id === lineId))
  for (const l of orderedLines(sk)) {
    const n = sideCount(l)
    if (n < 1) continue
    const steps: WalkStep[] = []
    for (let k = 0; k < n; k++) {
      const L = Math.max(0, l.feetIn[k] ?? 0)
      type Mark = { at: number; gate?: SkGate; branch?: SkLine }
      const marks: Mark[] = [
        ...branchesOn(l.id, k).map(b => ({ at: Math.max(0, Math.min(L, b.tee!.atIn ?? 0)), branch: b })),
        ...l.gates.filter(g => g.side === k).map(g => ({ at: Math.max(0, gateAt(l, g) ?? 0), gate: g })),
      ]
      // By their feet; at the same feet a tee comes before a gate (the gate starts there).
      marks.sort((a, b) => a.at - b.at || (a.branch ? -1 : 0) - (b.branch ? -1 : 0))
      let pos = 0
      for (const m of marks) {
        if (m.gate) {
          steps.push({ id: `${l.id}.${m.gate.id}`, feetIn: Math.max(0, m.at - pos), what: 'gate', gate: { widthIn: m.gate.widthIn, type: m.gate.type } })
          pos = Math.max(pos, m.at) + m.gate.widthIn
        } else {
          steps.push({ id: `t.${m.branch!.id}`, feetIn: Math.max(0, m.at - pos), what: 'tee' })
          pos = Math.max(pos, m.at)
        }
      }
      const rest = Math.max(0, L - pos)
      if (k < n - 1) {
        const [a, b] = sideEnds(l, k), c = sideEnds(l, k + 1)[1]
        steps.push({ id: `${l.id}.${k}.c`, feetIn: rest, what: 'corner', turn: turnAt(a, b, c) })
      } else steps.push({ id: `${l.id}.${k}.${l.closed ? 's' : 'e'}`, feetIn: rest, what: l.closed ? 'start' : 'end' })
    }
    const line: WalkLine = { id: l.id, steps }
    const host = l.tee ? sk.lines.find(x => x.id === l.tee!.lineId) : undefined
    if (host && l.tee && l.pts.length > 1) {
      const [a, b] = sideEnds(host, l.tee.side)
      line.fromTee = `t.${l.id}`
      line.branchTurn = turnAt(a, b, { x: b.x + (l.pts[1].x - l.pts[0].x), y: b.y + (l.pts[1].y - l.pts[0].y) })
    }
    lines.push(line)
  }
  return { v: 1, lines, sketch: sk }
}

// ── Walk list → sketch (a walked quote, List view, a new quote's fence) ──────

/** A walk list without its ids (and without a tee no branch starts from): what two walks are compared by. */
export function walkSig(w: WalkList): string {
  const branched = new Set(w.lines.map(l => l.fromTee).filter(Boolean) as string[])
  const teeNo = new Map<string, number>()
  let t = 0
  for (const l of w.lines) for (const s of l.steps) if (s.what === 'tee' && branched.has(s.id)) teeNo.set(s.id, (t += 1))
  return JSON.stringify(w.lines.filter(l => l.steps.length).map(l => {
    const steps: unknown[] = []
    let carry = 0
    for (const s of l.steps) {
      // A tee with no branch is only feet along the side: kept with the next step's.
      if (s.what === 'tee' && !branched.has(s.id)) { carry += Math.max(0, s.feetIn || 0); continue }
      steps.push([s.what, Math.round((Math.max(0, s.feetIn || 0) + carry) * 8) / 8, s.what === 'corner' ? s.turn ?? 'left' : null, s.gate ? [s.gate.widthIn, s.gate.type] : null, s.what === 'tee' ? teeNo.get(s.id) : null])
      carry = 0
    }
    return [l.fromTee && teeNo.has(l.fromTee) ? [teeNo.get(l.fromTee), l.branchTurn ?? 'left'] : null, steps]
  }))
}

function walkLineOrder(w: WalkList): WalkLine[] {
  const done = new Set<string>(), order: WalkLine[] = []
  const place = (l: WalkLine, depth = 0) => {
    if (done.has(l.id) || depth > 20) return
    if (l.fromTee) { const host = w.lines.find(x => x.steps.some(s => s.id === l.fromTee)); if (host) place(host, depth + 1) }
    done.add(l.id); order.push(l)
  }
  for (const l of w.lines) place(l)
  return order
}

/**
 * The sketch of a walk list: its sides, feet, gates and tees, laid out with square corners from its turns
 * (separate lines side by side, a branch from its tee). With `prev` (the sketch it had): the drawn corners are kept
 * when every line still has the same corners, so a change of feet or a gate keeps the shape as drawn.
 */
export function walkToSketch(w: WalkList, prev?: Sketch | null): Sketch {
  const branched = new Set(w.lines.map(l => l.fromTee).filter(Boolean) as string[])
  const teeAt = new Map<string, { lineId: string; side: number; atIn: number; pt: SkPt; dir: number }>()
  const lines: SkLine[] = []
  const MIN = 4
  let offsetX = 0
  for (const wl of walkLineOrder(w)) {
    if (!wl.steps.length) continue
    const tee = wl.fromTee ? teeAt.get(wl.fromTee) : undefined
    // Feet, y up.
    let dir = tee ? (tee.dir + (wl.branchTurn === 'right' ? 270 : 90)) % 360 : 0
    let cur: SkPt = tee ? { ...tee.pt } : { x: offsetX, y: 0 }
    const pts: SkPt[] = [cur]
    const feet: Array<number | null> = []
    const gates: SkGate[] = []
    let at = 0, closed = false
    const go = (p: SkPt, deg: number, ftLen: number): SkPt => ({ x: p.x + Math.cos((deg * Math.PI) / 180) * ftLen, y: p.y + Math.sin((deg * Math.PI) / 180) * ftLen })
    const endSide = () => { feet.push(at > 0 ? at : null) }
    for (const s of wl.steps) {
      at += Math.max(0, s.feetIn || 0)
      if (s.what === 'gate') {
        gates.push({ id: `g${gates.length + 1}`, side: feet.length, atIn: at, widthIn: Math.max(0, s.gate?.widthIn ?? 0), type: s.gate?.type ?? 'walk' })
        at += Math.max(0, s.gate?.widthIn ?? 0)
      } else if (s.what === 'tee') {
        if (branched.has(s.id)) teeAt.set(s.id, { lineId: wl.id, side: feet.length, atIn: at, pt: go(cur, dir, at / 12), dir })
      } else if (s.what === 'corner') {
        cur = go(cur, dir, Math.max(MIN, at / 12)); pts.push(cur); endSide(); at = 0
        dir = (dir + (s.turn === 'right' ? 270 : 90)) % 360
      } else if (s.what === 'end') {
        cur = go(cur, dir, Math.max(MIN, at / 12)); pts.push(cur); endSide(); at = 0
      } else if (s.what === 'start') {
        endSide(); closed = true; at = 0
      }
    }
    // A line still being walked (no end yet): its last stretch ends in an end post.
    const last = wl.steps[wl.steps.length - 1]
    if (last.what !== 'end' && last.what !== 'start') { cur = go(cur, dir, Math.max(MIN, at / 12)); pts.push(cur); endSide() }
    // A closed line needs three corners; one walked back with fewer is drawn open.
    if (closed && pts.length < 3) { pts.push(go(cur, dir, MIN)); closed = false }
    const line: SkLine = { id: wl.id, pts, closed, feetIn: feet, gates }
    if (tee) line.tee = { lineId: tee.lineId, side: tee.side, atIn: tee.atIn }
    lines.push(line)
    if (!tee) offsetX = Math.max(offsetX, ...pts.map(p => p.x)) + 20
  }
  // Keep the shape as drawn when every line still has the same corners.
  if (prev && prev.lines.length === lines.length && lines.every(l => { const p = prev.lines.find(x => x.id === l.id); return p && p.pts.length === l.pts.length && p.closed === l.closed })) {
    const kept: Sketch = { v: 1, lines: lines.map(l => ({ ...l, pts: prev.lines.find(x => x.id === l.id)!.pts.map(p => ({ ...p })) })), house: prev.house ?? null }
    return placeTees(kept)
  }
  // Fit the square layout into the drawing box, y down.
  const all = lines.flatMap(l => l.pts)
  if (!all.length) return { v: 1, lines: [], house: prev?.house ?? null }
  const xs = all.map(p => p.x), ys = all.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const pad = 50
  const k = Math.min((VIEW_W - pad * 2) / Math.max(1, maxX - minX), (VIEW_H - pad * 2) / Math.max(1, maxY - minY))
  const ox = (VIEW_W - (maxX - minX) * k) / 2, oy = (VIEW_H - (maxY - minY) * k) / 2
  const to = (p: SkPt): SkPt => ({ x: Math.round((ox + (p.x - minX) * k) * 10) / 10, y: Math.round((VIEW_H - oy - (p.y - minY) * k) * 10) / 10 })
  return { v: 1, lines: lines.map(l => ({ ...l, pts: l.pts.map(to) })), house: prev?.house ?? null }
}

/** A branch's first point sits on its host side where its tee's feet put it (when both are measured). */
export function placeTees(sk: Sketch): Sketch {
  const lines = sk.lines.map(l => {
    if (!l.tee || l.tee.atIn == null) return l
    const host = sk.lines.find(x => x.id === l.tee!.lineId)
    const L = host?.feetIn[l.tee.side]
    if (!host || !(L != null && L > 0) || l.tee.side >= sideCount(host)) return l
    const [a, b] = sideEnds(host, l.tee.side)
    const t = Math.max(0, Math.min(1, l.tee.atIn / L))
    return { ...l, pts: [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ...l.pts.slice(1)] }
  })
  return { ...sk, lines }
}

/** The sketch to show for a walk list: its own, while it still makes the same walk; else made again from the walk. */
export function sketchFor(w: WalkList | null | undefined): Sketch {
  if (!w) return emptySketch()
  const own = w.sketch
  if (own && Array.isArray(own.lines) && walkSig(sketchToWalk(own)) === walkSig(w)) return own
  return walkToSketch(w, own ?? null)
}

/**
 * Each walked line's side directions as drawn (degrees, y up), for laying the walk out with the sketch's rough angles
 * (the office site plan, walkList.ts sketchOf). Only while the sketch still makes the walk; else none.
 */
export function sketchDirections(w: WalkList | null | undefined): Map<string, number[]> | null {
  const own = w?.sketch
  if (!w || !own || !Array.isArray(own.lines) || walkSig(sketchToWalk(own)) !== walkSig(w)) return null
  return new Map(own.lines.map(l => [l.id, Array.from({ length: sideCount(l) }, (_, k) => { const [a, b] = sideEnds(l, k); return degUp(a, b) })]))
}

// ── Editing (each returns a new sketch) ──────────────────────────────────────

const mapLine = (sk: Sketch, id: string, f: (l: SkLine) => SkLine): Sketch => ({ ...sk, lines: sk.lines.map(l => (l.id === id ? f(l) : l)) })

/** What a finished stroke does: a new line, a branch from a tee, or more of an open line. */
export function addStroke(sk: Sketch, stroke: SkPt[], near = 26): { sketch: Sketch; lineId: string | null; askClose: boolean } {
  let pts = straighten(stroke)
  if (pts.length < 2 || d2(pts[0], pts[pts.length - 1]) < 12 && pts.length < 3) return { sketch: sk, lineId: null, askClose: false }
  type Hit = { kind: 'end'; line: SkLine; atStart: boolean } | { kind: 'side'; line: SkLine; side: number; pt: SkPt }
  const hitAt = (p: SkPt): Hit | null => {
    for (const l of sk.lines) {
      if (l.closed) continue
      if (d2(p, l.pts[l.pts.length - 1]) < near) return { kind: 'end', line: l, atStart: false }
      if (!l.tee && d2(p, l.pts[0]) < near) return { kind: 'end', line: l, atStart: true }
    }
    let best: Hit | null = null, bestD = near
    for (const l of sk.lines) for (let k = 0; k < sideCount(l); k++) {
      const [a, b] = sideEnds(l, k)
      const r = nearestOn(p, a, b)
      if (r.dist < bestD) { bestD = r.dist; best = { kind: 'side', line: l, side: k, pt: r.pt } }
    }
    return best
  }
  let hit = hitAt(pts[0])
  // Drawn from the far end toward a fence: the same as starting on it.
  if (!hit) { const h2 = hitAt(pts[pts.length - 1]); if (h2) { pts = pts.slice().reverse(); hit = h2 } }
  const closes = (p: SkPt[]) => p.length >= 4 && d2(p[0], p[p.length - 1]) < near * 1.3
  if (hit?.kind === 'end') {
    const l = hit.line
    if (!hit.atStart) {
      const npts = [...l.pts, ...pts.slice(1)]
      const added = pts.length - 1
      const next: SkLine = { ...l, pts: npts, feetIn: [...l.feetIn, ...Array(added).fill(null)] }
      return { sketch: mapLine(sk, l.id, () => next), lineId: l.id, askClose: closes(npts) }
    }
    const rev = pts.slice().reverse()
    const added = rev.length - 1
    const npts = [...rev.slice(0, -1), ...l.pts]
    const next: SkLine = { ...l, pts: npts, feetIn: [...Array(added).fill(null), ...l.feetIn], gates: l.gates.map(g => ({ ...g, side: g.side + added })) }
    const moved: Sketch = { ...mapLine(sk, l.id, () => next) }
    moved.lines = moved.lines.map(b => (b.tee?.lineId === l.id ? { ...b, tee: { ...b.tee, side: b.tee.side + added } } : b))
    return { sketch: moved, lineId: l.id, askClose: closes(npts) }
  }
  const id = skId('l')
  if (hit?.kind === 'side') {
    pts[0] = hit.pt
    const line: SkLine = { id, pts, closed: false, feetIn: Array(pts.length - 1).fill(null), gates: [], tee: { lineId: hit.line.id, side: hit.side, atIn: null } }
    return { sketch: { ...sk, lines: [...sk.lines, line] }, lineId: id, askClose: false }
  }
  const line: SkLine = { id, pts, closed: false, feetIn: Array(pts.length - 1).fill(null), gates: [] }
  return { sketch: { ...sk, lines: [...sk.lines, line] }, lineId: id, askClose: closes(pts) }
}

/** "Does the fence close back to the start?" Yes: the last point joins the first (a corner there). */
export function closeLine(sk: Sketch, lineId: string): Sketch {
  return mapLine(sk, lineId, l => {
    if (l.pts.length < 4) return l
    const pts = l.pts.slice(0, -1)
    // The last side now ends at the first corner: same number of sides.
    return { ...l, pts, closed: true, feetIn: l.feetIn.slice(0, pts.length) }
  })
}

/** Take a corner out: its two sides become one (their feet added when both are measured). An end post: its side goes. */
export function removePoint(sk: Sketch, lineId: string, i: number): Sketch {
  const l = sk.lines.find(x => x.id === lineId)
  if (!l) return sk
  const n = sideCount(l)
  const branchesFix = (s: Sketch, f: (side: number, at: number | null) => { side: number; at: number | null } | null): Sketch => ({
    ...s, lines: s.lines.flatMap(b => {
      if (b.tee?.lineId !== lineId) return [b]
      const r = f(b.tee.side, b.tee.atIn)
      return r ? [{ ...b, tee: { ...b.tee, side: r.side, atIn: r.at } }] : [{ ...b, tee: null }]
    }),
  })
  // An open line's end post: its last (or first) side goes; a line of one side goes altogether.
  if (!l.closed && (i === 0 || i === l.pts.length - 1)) {
    if (l.tee && i === 0) return sk
    if (n <= 1) return deleteLine(sk, lineId)
    if (i === l.pts.length - 1) {
      const next: SkLine = { ...l, pts: l.pts.slice(0, -1), feetIn: l.feetIn.slice(0, -1), gates: l.gates.filter(g => g.side < n - 1) }
      return branchesFix(mapLine(sk, lineId, () => next), (side, at) => (side < n - 1 ? { side, at } : null))
    }
    const next: SkLine = { ...l, pts: l.pts.slice(1), feetIn: l.feetIn.slice(1), gates: l.gates.filter(g => g.side > 0).map(g => ({ ...g, side: g.side - 1 })) }
    return branchesFix(mapLine(sk, lineId, () => next), (side, at) => (side > 0 ? { side: side - 1, at } : null))
  }
  // A closed line keeps at least three corners.
  if (l.closed && l.pts.length <= 3) return sk
  // Corner i joins side i-1 (ending at it) and side i (starting at it). On a closed line corner 0 joins the last side and side 0.
  const before = (i - 1 + n) % n, after = i % n
  const A = l.feetIn[before], B = l.feetIn[after]
  const shift = A ?? 0
  const merged = A != null && B != null ? A + B : null
  const pts = l.pts.filter((_, k) => k !== i)
  let feetIn: Array<number | null>, sideOf: (s: number) => number, atShift: (s: number) => number
  if (i === 0) {
    // Closed line, its first corner: the last side and side 0 become the new last side.
    feetIn = [...l.feetIn.slice(1, n - 1), merged]
    sideOf = s => (s === 0 ? n - 2 : s === n - 1 ? n - 2 : s - 1)
    atShift = s => (s === 0 ? shift : 0)
  } else {
    feetIn = [...l.feetIn.slice(0, before), merged, ...l.feetIn.slice(after + 1)]
    sideOf = s => (s <= before ? s : s - 1)
    atShift = s => (s === after ? shift : 0)
  }
  const gates = l.gates.map(g => ({ ...g, side: sideOf(g.side), atIn: g.atIn != null ? g.atIn + atShift(g.side) : g.atIn }))
  return branchesFix(mapLine(sk, lineId, () => ({ ...l, pts, feetIn, gates })), (side, at) => ({ side: sideOf(side), at: at != null ? at + atShift(side) : at }))
}

/** Put a corner in a side where it was tapped: two sides, both to be measured; its gates and tees stay where they were along it. */
export function splitSide(sk: Sketch, lineId: string, side: number, at: SkPt): Sketch {
  const l = sk.lines.find(x => x.id === lineId)
  if (!l) return sk
  const [a, b] = sideEnds(l, side)
  const r = nearestOn(at, a, b)
  const t = Math.max(0.1, Math.min(0.9, r.t))
  const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  const L = l.feetIn[side]
  const cut = L != null ? Math.round(L * t * 8) / 8 : null
  const pts = [...l.pts.slice(0, side + 1), p, ...l.pts.slice(side + 1)]
  const feetIn = [...l.feetIn.slice(0, side), null, null, ...l.feetIn.slice(side + 1)]
  const place = (s: number, atIn: number | null): { side: number; at: number | null } => {
    if (s < side) return { side: s, at: atIn }
    if (s > side) return { side: s + 1, at: atIn }
    if (atIn == null || cut == null) return { side: s, at: atIn }
    return atIn < cut ? { side, at: atIn } : { side: side + 1, at: atIn - cut }
  }
  const gates = l.gates.map(g => { const r2 = place(g.side, g.atIn); return { ...g, side: r2.side, atIn: r2.at } })
  const out = mapLine(sk, lineId, () => ({ ...l, pts, feetIn, gates }))
  return { ...out, lines: out.lines.map(bl => (bl.tee?.lineId === lineId ? (() => { const r2 = place(bl.tee!.side, bl.tee!.atIn); return { ...bl, tee: { ...bl.tee!, side: r2.side, atIn: r2.at } } })() : bl)) }
}

/** Drag a corner: the shape only. A tee point stays on its side. */
export function movePoint(sk: Sketch, lineId: string, i: number, p: SkPt): Sketch {
  const l = sk.lines.find(x => x.id === lineId)
  if (!l) return sk
  const q = { x: Math.max(0, Math.min(VIEW_W, p.x)), y: Math.max(0, Math.min(VIEW_H, p.y)) }
  if (i === 0 && l.tee) {
    // Slides along the side it stands on.
    const host = sk.lines.find(x => x.id === l.tee!.lineId)
    if (!host) return sk
    const [a, b] = sideEnds(host, l.tee.side)
    return mapLine(sk, lineId, x => ({ ...x, pts: [nearestOn(q, a, b).pt, ...x.pts.slice(1)] }))
  }
  const moved = mapLine(sk, lineId, x => ({ ...x, pts: x.pts.map((pt, k) => (k === i ? q : pt)) }))
  return placeTees(moved)
}

/** A fence line goes; branches from it become lines of their own. */
export function deleteLine(sk: Sketch, lineId: string): Sketch {
  return { ...sk, lines: sk.lines.filter(l => l.id !== lineId).map(l => (l.tee?.lineId === lineId ? { ...l, tee: null } : l)) }
}

export function setFeet(sk: Sketch, lineId: string, side: number, inches: number | null): Sketch {
  return placeTees(mapLine(sk, lineId, l => ({ ...l, feetIn: l.feetIn.map((f, k) => (k === side ? inches : f)) })))
}
export function setTeeAt(sk: Sketch, branchId: string, inches: number | null): Sketch {
  return placeTees(mapLine(sk, branchId, l => (l.tee ? { ...l, tee: { ...l.tee, atIn: inches } } : l)))
}
export function putGate(sk: Sketch, lineId: string, g: SkGate): Sketch {
  return mapLine(sk, lineId, l => ({ ...l, gates: l.gates.some(x => x.id === g.id) ? l.gates.map(x => (x.id === g.id ? g : x)) : [...l.gates, g] }))
}
export function removeGate(sk: Sketch, lineId: string, gateId: string): Sketch {
  return mapLine(sk, lineId, l => ({ ...l, gates: l.gates.filter(g => g.id !== gateId) }))
}

// ── Where the words go: no word on another or on a fence line ───────────────

/** A word to place: its text, size, and the spots to try in order (each the middle of the word's baseline box). */
export interface LabelAsk { text: string; size: number; tries: SkPt[] }

/**
 * Picks a spot for each word in turn: the first of its tries that overlaps no word already placed, no fence line and
 * stays inside w × h; else the try with the fewest overlaps. Words are measured roughly (bold Arial).
 */
export function placeLabels(asks: LabelAsk[], segs: Array<[SkPt, SkPt]>, w: number, h: number): SkPt[] {
  type Box = { x0: number; y0: number; x1: number; y1: number }
  const boxOf = (a: LabelAsk, p: SkPt): Box => { const bw = a.text.length * a.size * 0.56 + 4, bh = a.size + 2; return { x0: p.x - bw / 2, y0: p.y - bh / 2, x1: p.x + bw / 2, y1: p.y + bh / 2 } }
  const hit = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1
  const segHits = (b: Box, [p, q]: [SkPt, SkPt]) => {
    const steps = Math.max(2, Math.ceil(d2(p, q) / 3))
    for (let i = 0; i <= steps; i++) { const x = p.x + ((q.x - p.x) * i) / steps, y = p.y + ((q.y - p.y) * i) / steps; if (x > b.x0 - 2 && x < b.x1 + 2 && y > b.y0 - 2 && y < b.y1 + 2) return true }
    return false
  }
  const placed: Box[] = []
  return asks.map(a => {
    let best = a.tries[0], bestN = Infinity
    for (const t of a.tries) {
      const b = boxOf(a, t)
      let n = placed.filter(x => hit(x, b)).length * 3 + segs.filter(sg => segHits(b, sg)).length * 2
      if (b.x0 < 0 || b.y0 < 0 || b.x1 > w || b.y1 > h) n += 1
      if (n < bestN) { bestN = n; best = t }
      if (n === 0) break
    }
    placed.push(boxOf(a, best))
    return best
  })
}

/**
 * The words of a sketch drawn through `at` (drawing units → picture), in the picture's units: each side's feet
 * outside it, each gate's width and kind inside it, each tee's feet; placed so none covers another or a line.
 */
export function sketchLabels(sk: Sketch, at: (p: SkPt) => SkPt, fs: number, w: number, h: number, opts: { gateWord?: (g: SkGate) => string; missing?: (n: number) => string } = {}): Array<{ kind: 'feet' | 'gate' | 'tee'; text: string; x: number; y: number; size: number; missing?: boolean; side?: number }> {
  const all = sk.lines.flatMap(l => l.pts.map(at))
  const cx = all.reduce((t, p) => t + p.x, 0) / Math.max(1, all.length), cy = all.reduce((t, p) => t + p.y, 0) / Math.max(1, all.length)
  const segs: Array<[SkPt, SkPt]> = []
  const asks: Array<LabelAsk & { kind: 'feet' | 'gate' | 'tee'; missing?: boolean; side?: number }> = []
  const gateAsks: typeof asks = [], teeAsks: typeof asks = []
  for (const l of sk.lines) {
    for (let s = 0; s < sideCount(l); s++) {
      const [a0, b0] = sideEnds(l, s)
      const a = at(a0), b = at(b0)
      segs.push([a, b])
      const len = Math.max(1, d2(a, b))
      const ux = (b.x - a.x) / len, uy = (b.y - a.y) / len
      let nx = -uy, ny = ux
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
      if ((mx + nx - cx) ** 2 + (my + ny - cy) ** 2 < (mx - cx) ** 2 + (my - cy) ** 2) { nx = -nx; ny = -ny }
      const L = l.feetIn[s]
      const n = sideNo(sk, l.id, s)
      const text = L ? ftText(L) : (opts.missing ? opts.missing(n) : '? ft')
      // Further out beside an upright side (the words run across it).
      const off = fs * 0.75 + Math.abs(nx) * text.length * fs * 0.28
      const along = (t: number, o: number) => ({ x: a.x + (b.x - a.x) * t + nx * o, y: a.y + (b.y - a.y) * t + ny * o })
      asks.push({ kind: 'feet', text, size: fs, missing: !L, side: n, tries: [along(0.5, off), along(0.35, off), along(0.65, off), along(0.5, off * 1.8), along(0.25, off), along(0.75, off), along(0.5, -off), along(0.5, off * 2.6)] })
      for (const g of l.gates.filter(x => x.side === s)) {
        const atIn = gateAt(l, g)
        const t0 = L && atIn != null ? atIn / L : 0.5 - (L ? g.widthIn / L / 2 : 0.08)
        const tm = Math.min(1, Math.max(0, L && atIn != null ? (atIn + g.widthIn / 2) / L : t0 + (L ? g.widthIn / L / 2 : 0.08)))
        const gt = opts.gateWord ? opts.gateWord(g) : `${ftText(g.widthIn)} ${g.type === 'double' ? 'double' : 'single'} gate`
        const gs = Math.round(fs * 0.85)
        const goff = gs * 0.75 + Math.abs(nx) * gt.length * gs * 0.28
        gateAsks.push({ kind: 'gate', text: gt, size: gs, tries: [along(tm, -goff), along(tm, -goff * 1.8), along(tm, goff * 2.2), along(tm, -goff * 2.6), along(Math.max(0, tm - 0.15), -goff), along(Math.min(1, tm + 0.15), -goff), along(tm, goff * 3.2)] })
      }
    }
  }
  for (const l of sk.lines) {
    if (!l.tee || l.tee.atIn == null) continue
    const p = at(l.pts[0])
    const text = `Tee ${ftText(l.tee.atIn)} from ${fromName(sk, l.tee.lineId, l.tee.side)}`
    const ts = Math.round(fs * 0.8), half = text.length * ts * 0.28 + 8
    teeAsks.push({ kind: 'tee', text, size: ts, tries: [{ x: p.x + half, y: p.y + ts * 1.4 }, { x: p.x - half, y: p.y + ts * 1.4 }, { x: p.x + half, y: p.y - ts * 1.2 }, { x: p.x - half, y: p.y - ts * 1.2 }, { x: p.x + half, y: p.y + ts * 2.8 }, { x: p.x - half, y: p.y + ts * 2.8 }, { x: p.x, y: p.y + ts * 4 }] })
  }
  const list = [...asks, ...gateAsks, ...teeAsks]
  const spots = placeLabels(list, segs, w, h)
  return list.map((a, i) => ({ kind: a.kind, text: a.text, x: spots[i].x, y: spots[i].y, size: a.size, ...(a.missing ? { missing: true } : {}), ...(a.side ? { side: a.side } : {}) }))
}

// ── The picture: the sketch with feet, gates and tees ────────────────────────

const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

/**
 * The sketch as an SVG body fitted into w × h: each side with its feet, gates where their feet put them (orange,
 * width and single or double), tees, the house, and the label "Sketch, not to scale. Measurements as listed."
 */
export function sketchPictureBody(sk: Sketch, w: number, h: number, opts: { label?: boolean; labelText?: string } = {}): string {
  const all = [...sk.lines.flatMap(l => l.pts), ...(sk.house ? [{ x: sk.house.x, y: sk.house.y }, { x: sk.house.x + sk.house.w, y: sk.house.y + sk.house.h }] : [])]
  if (!sk.lines.length || !all.length) return ''
  const xs = all.map(p => p.x), ys = all.map(p => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const fs = Math.max(12, Math.round(w / 32))
  const pad = Math.max(30, fs * 3), lab = opts.label === false ? 0 : fs + 12
  const k = Math.min((w - pad * 2) / Math.max(1, maxX - minX), (h - pad * 2 - lab) / Math.max(1, maxY - minY))
  const ox = (w - (maxX - minX) * k) / 2, oy = (h - lab - (maxY - minY) * k) / 2
  const X = (x: number) => ox + (x - minX) * k, Y = (y: number) => oy + (y - minY) * k
  const f1 = (n: number) => n.toFixed(1)
  let out = ''
  if (sk.house) out += `<rect x="${f1(X(sk.house.x))}" y="${f1(Y(sk.house.y))}" width="${f1(sk.house.w * k)}" height="${f1(sk.house.h * k)}" fill="#e5e7eb" stroke="#9ca3af" stroke-width="1.5"/><text x="${f1(X(sk.house.x + sk.house.w / 2))}" y="${f1(Y(sk.house.y + sk.house.h / 2) + fs / 3)}" text-anchor="middle" font-size="${fs}" font-family="Arial" fill="#4b5563">House</text>`
  const labels: string[] = []
  for (const l of sk.lines) {
    const n = sideCount(l)
    const P = l.pts.map(p => ({ x: X(p.x), y: Y(p.y) }))
    out += `<${l.closed ? 'polygon' : 'polyline'} points="${P.map(p => `${f1(p.x)},${f1(p.y)}`).join(' ')}" fill="none" stroke="#111827" stroke-width="3" stroke-linejoin="round"/>`
    for (const p of P) out += `<circle cx="${f1(p.x)}" cy="${f1(p.y)}" r="3.5" fill="#111827"/>`
    for (let s = 0; s < n; s++) {
      const [a0, b0] = sideEnds(l, s)
      const a = { x: X(a0.x), y: Y(a0.y) }, b = { x: X(b0.x), y: Y(b0.y) }
      const L = l.feetIn[s]
      for (const g of l.gates.filter(x => x.side === s)) {
        const at = gateAt(l, g)
        const t0 = L && at != null ? at / L : 0.5 - (L ? g.widthIn / L / 2 : 0.08)
        const t1 = L && at != null ? (at + g.widthIn) / L : t0 + (L ? g.widthIn / L : 0.16)
        const p0 = { x: a.x + (b.x - a.x) * Math.max(0, t0), y: a.y + (b.y - a.y) * Math.max(0, t0) }
        const p1 = { x: a.x + (b.x - a.x) * Math.min(1, t1), y: a.y + (b.y - a.y) * Math.min(1, t1) }
        out += `<line x1="${f1(p0.x)}" y1="${f1(p0.y)}" x2="${f1(p1.x)}" y2="${f1(p1.y)}" stroke="#fff" stroke-width="7"/><line x1="${f1(p0.x)}" y1="${f1(p0.y)}" x2="${f1(p1.x)}" y2="${f1(p1.y)}" stroke="#ea580c" stroke-width="3" stroke-dasharray="4 3"/>`
        for (const q of [p0, p1]) out += `<rect x="${f1(q.x - 4)}" y="${f1(q.y - 4)}" width="8" height="8" fill="#ea580c"/>`
      }
    }
    if (l.tee) labels.push(`<circle cx="${f1(P[0].x)}" cy="${f1(P[0].y)}" r="5" fill="#1d4ed8"/>`)
  }
  out += labels.join('')
  const COLOR = { feet: '#111827', gate: '#c2410c', tee: '#1d4ed8' }
  for (const t of sketchLabels(sk, p => ({ x: X(p.x), y: Y(p.y) }), fs, w, h - lab)) {
    out += `<text x="${f1(t.x)}" y="${f1(t.y + t.size / 3)}" text-anchor="middle" font-size="${t.size}" font-weight="bold" font-family="Arial" fill="${t.missing ? '#b91c1c' : COLOR[t.kind]}" paint-order="stroke" stroke="#fff" stroke-width="4">${esc(t.text)}</text>`
  }
  if (lab) out += `<text x="${w / 2}" y="${h - 6}" text-anchor="middle" font-size="${fs}" font-family="Arial" fill="#4b5563">${esc(opts.labelText ?? 'Sketch, not to scale. Measurements as listed.')}</text>`
  return out
}

/** The sketch of a walk list as a whole SVG (the proposal, the contract, the install and sub packets). */
export function sketchSvg(w: WalkList, W = 760, H = 460, opts: { labelText?: string } = {}): string {
  const body = sketchPictureBody(sketchFor(w), W, H, { label: true, ...opts })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#fff"/>${body}</svg>`
}
