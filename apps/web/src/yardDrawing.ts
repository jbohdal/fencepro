/**
 * Editing the yard drawing: drag a corner, type an angle, start a side from
 * another side (a tee), move / turn / size the house, add a side that does
 * not cross the others. Pure; LayoutEditor.tsx and SitePlan.tsx call these.
 *
 * Every edit keeps each side at its typed length (yardChain.ts draws it as a
 * chain from the angles), and only touches the drawing (layout.plan.drawn,
 * a side's tee): footage, sections, posts and price come from the typed
 * lengths and finishes, never from here. A change made anywhere else (a
 * length, an end type, a gate, a side on or off, where a return meets the
 * house) keeps the drawing: only resetDrawing clears it.
 *
 * Dragging a point: the side that ends there turns about its other end (its
 * start), so it keeps its length; the sides after it keep their directions
 * and move along with it (the shape beyond stays as it was, only the two
 * angles at the dragged side change). The first point turns the first side
 * about its end. A tee's start slides along the side it starts from.
 */

import { yardDrawing, houseOnPlan, drawLenFt, chainSpecOf, shapeHasHouse } from './sitePlanGeometry'
import {
  chainEnds, dirDeg, norm180, norm360, outDegFor, segmentsMeet, stepFrom, teeAnchor, closestOn, dist,
  type SideEnds,
} from './yardChain'
import { deriveLayout, joinedFromPrev, type HouseRect, type PlanDrawing, type PlanPoint, type YardLayout } from './yardLayout'

const r3 = (x: number) => Math.round(x * 1000) / 1000

/** True once the drawing has been edited (its angles are saved). */
export function isEdited(layout: YardLayout | null | undefined): boolean {
  return !!layout?.plan?.drawn
}

/**
 * The drawing's angles saved as they are drawn now (nothing moves): from an
 * older quote's dragged corners, or the shape's own drawing. Also takes the
 * house where it is drawn now.
 */
export function freezeDrawing(layout: YardLayout): YardLayout {
  if (layout.plan?.drawn) return layout
  const dr = yardDrawing(layout)
  const deg: Record<string, number> = {}
  layout.sides.forEach((s, i) => { deg[s.id] = r3(norm360(dr.ends[i]?.lenFt > 1e-9 ? dr.ends[i].deg : dr.spec.deg[i])) })
  const origin = dr.ends[0]?.a ?? dr.spec.origin
  // The shape's own house (backyard, front yard) where it is drawn; a house drawn beside a fence end is placed anew (behind that end).
  const home = shapeHasHouse(layout) || dr.mode === 'chain' ? houseOnPlan(layout, deriveLayout(layout), dr).rect : null
  const drawn: PlanDrawing = { v: 1, origin: { x: r3(origin.x), y: r3(origin.y) }, deg, set: [], house: home ? roundHouse(home) : null }
  return { ...layout, plan: { ...(layout.plan ?? {}), drawn, points: null, pointsFor: null } }
}

function roundHouse(h: HouseRect): HouseRect {
  return { cx: r3(h.cx), cy: r3(h.cy), w: r3(h.w), d: r3(h.d), rotDeg: r3(norm180(h.rotDeg)) }
}

function withDrawn(layout: YardLayout, patch: Partial<PlanDrawing>): YardLayout {
  const f = freezeDrawing(layout)
  return { ...f, plan: { ...f.plan, drawn: { ...f.plan!.drawn!, ...patch } } }
}

function markSet(d: PlanDrawing, ids: string[]): string[] {
  return [...new Set([...(d.set ?? []), ...ids])]
}

/** Snap an angle (degrees) to whole degrees, and to a multiple of 45 when within 2.5. */
function snapAngle(a: number): { v: number; to45: boolean } {
  const m = Math.round(a / 45) * 45
  if (Math.abs(a - m) <= 2.5) return { v: m, to45: true }
  return { v: Math.round(a), to45: false }
}

/** The side coming into side i's start: its tee's side, or the side before (none for the first). */
export function incomingSide(layout: YardLayout, i: number): number | null {
  const t = teeAnchor(layout, i)
  if (t !== null) return t
  if (i > 0) return i - 1
  return null
}

/**
 * The drawing with point `k` (a corner list index, as Plan.vertices / handles)
 * moved toward `to` (plan feet). `start` is the drawing when the drag began,
 * so a drag never drifts. Snaps the angles at the dragged side to whole
 * degrees (and to 45 / 90 / 135 when close).
 */
export function dragVertex(start: YardLayout, k: number, to: PlanPoint): YardLayout {
  const f = freezeDrawing(start)
  const d = f.plan!.drawn!
  const dr = yardDrawing(f)
  const n = f.sides.length
  if (!n) return f
  const deg = { ...d.deg }
  if (k === 0) {
    // The first point: the first side turns about its end.
    const e = dr.ends[0]
    if (dist(to, e.b) < 1e-6) return f
    let nd = dirDeg(to, e.b)
    // Snap the angle with the next side.
    if (n > 1 && teeAnchor(f, 1) === null) {
      const a = 180 - Math.abs(norm180(dr.ends[1].deg - nd))
      const s = snapAngle(a)
      const t = norm180(dr.ends[1].deg - nd)
      const want = 180 - s.v
      nd = norm360(dr.ends[1].deg - Math.sign(t || 1) * want)
    } else nd = Math.round(nd)
    deg[f.sides[0].id] = r3(norm360(nd))
    const origin = stepFrom(e.b, nd + 180, e.lenFt)
    return { ...f, plan: { ...f.plan, drawn: { ...d, deg, origin: { x: r3(origin.x), y: r3(origin.y) }, set: markSet(d, [f.sides[0].id]) } } }
  }
  const j = Math.min(k - 1, n - 1)
  const e = dr.ends[j]
  if (dist(to, e.a) < 1e-6) return f
  let nd = dirDeg(e.a, to)
  // Snap: the angle at the dragged point (with the side after) or at the side's start, whichever is nearer a clean angle.
  const cands: Array<{ deg: number; adj: number }> = []
  const inc = incomingSide(f, j)
  if (inc !== null) {
    const t = norm180(nd - dr.ends[inc].deg)
    const s = snapAngle(180 - Math.abs(t))
    cands.push({ deg: norm360(dr.ends[inc].deg + Math.sign(t || 1) * (180 - s.v)), adj: s.to45 ? 0 : 1 })
  }
  if (j + 1 < n && teeAnchor(f, j + 1) === null) {
    const nx = dr.ends[j + 1].deg
    const t = norm180(nx - nd)
    const s = snapAngle(180 - Math.abs(t))
    cands.push({ deg: norm360(nx - Math.sign(t || 1) * (180 - s.v)), adj: s.to45 ? 0 : 1 })
  }
  const best = cands.filter(c => c.adj === 0).sort((a, b) => Math.abs(norm180(a.deg - nd)) - Math.abs(norm180(b.deg - nd)))[0]
    ?? cands[0]
  if (best) nd = best.deg
  else nd = Math.round(nd)
  deg[f.sides[j].id] = r3(norm360(nd))
  return { ...f, plan: { ...f.plan, drawn: { ...d, deg, set: markSet(d, [f.sides[j].id]) } } }
}

/** Sides drawn on from side i (they turn with it when its angle is typed): the sides after it in the chain, and tees off any of them. */
export function downstreamOf(layout: YardLayout, i: number): number[] {
  const D = new Set([i])
  for (let k = i + 1; k < layout.sides.length; k++) {
    const t = teeAnchor(layout, k)
    if (t !== null ? D.has(t) : D.has(k - 1)) D.add(k)
  }
  return [...D].sort((a, b) => a - b)
}

/**
 * The angle at side i's start typed (degrees between the two sides, 1 to 180;
 * 90 = square), turning left or right walking along the fence. Side i and
 * everything drawn on from it turn together about that corner.
 */
export function setCornerAngle(layout: YardLayout, i: number, angle: number, turn: 'left' | 'right'): YardLayout {
  const f = freezeDrawing(layout)
  const inc = incomingSide(f, i)
  if (inc === null || !(angle > 0) || angle > 180) return f
  const d = f.plan!.drawn!
  const dr = yardDrawing(f)
  const nd = outDegFor(dr.ends[inc].deg, angle, turn)
  const delta = norm180(nd - dr.ends[i].deg)
  const deg = { ...d.deg }
  for (const k of downstreamOf(f, i)) deg[f.sides[k].id] = r3(norm360((deg[f.sides[k].id] ?? dr.ends[k].deg) + delta))
  return { ...f, plan: { ...f.plan, drawn: { ...d, deg, set: markSet(d, [f.sides[i].id]) } } }
}

/** The angle at side i's start as drawn now: degrees (0 to 180) and which way, or null for the first side. */
export function cornerAngleAt(layout: YardLayout, i: number): { deg: number; turn: 'left' | 'right' | 'straight' } | null {
  const inc = incomingSide(layout, i)
  if (inc === null) return null
  const dr = yardDrawing(layout)
  const t = norm180(dr.ends[i].deg - dr.ends[inc].deg)
  return { deg: Math.round((180 - Math.abs(t)) * 10) / 10, turn: Math.abs(t) < 1e-6 ? 'straight' : t > 0 ? 'left' : 'right' }
}

// ── Sides that would cross ────────────────────────────────────────────────────

/** Sides (on, drawn) that side i crosses or runs over in this drawing, by name. */
export function crossedBy(layout: YardLayout, ends: SideEnds[], i: number): string[] {
  const out: string[] = []
  const A = ends[i]
  if (!A || !(A.lenFt > 0)) return out
  layout.sides.forEach((s, j) => {
    if (j === i || !s.on || !ends[j] || !(ends[j].lenFt > 0)) return
    const B = ends[j]
    const hit = segmentsMeet(A.a, A.b, B.a, B.b, 0.25)
    if (!hit) return
    if (hit.kind === 'point') {
      const shared = [A.a, A.b].some(p => [B.a, B.b].some(q => dist(p, q) < 0.25) && dist(p, hit.at) < 0.25)
      const tee = (teeAnchor(layout, i) === j && dist(A.a, hit.at) < 0.25) || (teeAnchor(layout, j) === i && dist(B.a, hit.at) < 0.25)
      if (shared || tee) return
    }
    out.push(s.name)
  })
  return out
}

/**
 * A direction for side i that does not cross the other sides: a quarter turn
 * right of the side it starts from (as sides have always been added), else
 * left, else 45 or 135 either way, else straight on. `bent` says it had to
 * turn another way, and which side the square turn would have crossed.
 */
export function clearDirection(layout: YardLayout, i: number): { deg: number; bent: boolean; wouldCross: string[] } {
  const f = freezeDrawing(layout)
  const spec = chainSpecOf(f)
  const dr = yardDrawing(f)
  const inc = incomingSide(f, i)
  const base = inc !== null ? dr.ends[inc].deg : spec.deg[i]
  const turns = inc !== null ? [-90, 90, -45, 45, -135, 135, 0] : [0, 90, 180, 270]
  let first: string[] = []
  for (let k = 0; k < turns.length; k++) {
    const deg = spec.deg.slice()
    const nd = norm360(base + turns[k])
    // The side and those after it keep their angles to it.
    const delta = norm180(nd - deg[i])
    for (const m of downstreamOf(f, i)) deg[m] = norm360(deg[m] + delta)
    const ends = chainEnds(f, { origin: spec.origin, deg }, m => drawLenFt(f, m))
    const hits = new Set<string>()
    for (const m of downstreamOf(f, i)) for (const nm of crossedBy(f, ends, m)) hits.add(nm)
    if (k === 0) first = [...hits]
    if (hits.size === 0) return { deg: r3(nd), bent: k > 0, wouldCross: k > 0 ? first : [] }
  }
  return { deg: r3(norm360(base + turns[0])), bent: false, wouldCross: first }
}

/** Side i (and the sides drawn on from it) turned to `deg`, its angle not marked as set by hand. */
export function turnSideTo(layout: YardLayout, i: number, deg: number): YardLayout {
  const f = freezeDrawing(layout)
  const d = f.plan!.drawn!
  const dr = yardDrawing(f)
  const delta = norm180(deg - dr.ends[i].deg)
  if (Math.abs(delta) < 1e-6) return f
  const next = { ...d.deg }
  for (const k of downstreamOf(f, i)) next[f.sides[k].id] = r3(norm360((next[f.sides[k].id] ?? dr.ends[k].deg) + delta))
  return { ...f, plan: { ...f.plan, drawn: { ...d, deg: next } } }
}

/**
 * After side i gets a length: when its angle was never set by hand and it now
 * crosses another side, it bends away (clearDirection). The message says so.
 */
export function keepClear(layout: YardLayout, i: number): { layout: YardLayout; message: string | null } {
  const s = layout.sides[i]
  if (!s || !layout.plan?.drawn || (layout.plan.drawn.set ?? []).includes(s.id)) return { layout, message: null }
  const dr = yardDrawing(layout)
  const hits = new Set<string>()
  for (const m of downstreamOf(layout, i)) for (const nm of crossedBy(layout, dr.ends, m)) hits.add(nm)
  if (hits.size === 0) return { layout, message: null }
  const c = clearDirection(layout, i)
  if (!c.bent) return { layout, message: null }
  const was = [...hits]
  const next = turnSideTo(layout, i, c.deg)
  const a = cornerAngleAt(next, i)
  return { layout: next, message: `${s.name} would cross ${was.join(' and ')}, so it was drawn turning ${a?.turn === 'straight' ? 'straight on' : `${a?.turn} at ${Math.round(a?.deg ?? 90)}°`}. Drag its corner or type its angle to change it.` }
}

// ── Tees ──────────────────────────────────────────────────────────────────────

/**
 * Side i starts from a point along an earlier side (`anchorId`, `atIn` inches
 * from its start), square to it on the side that crosses nothing. Its start
 * is no longer a corner with the side before (both ends become "Stops here",
 * posted as end posts, as the builder counts them). Null: back to starting
 * where the side before ends.
 */
export function setTee(layout: YardLayout, i: number, tee: { sideId: string; atIn: number } | null): YardLayout {
  const f = freezeDrawing(layout)
  if (!tee) return { ...f, sides: f.sides.map((s, k) => (k === i ? { ...s, tee: null } : s)) }
  const j = f.sides.findIndex(s => s.id === tee.sideId)
  if (j < 0 || j >= i) return f
  const anchorIn = f.sides[j].lengthIn
  const atIn = Math.max(0, anchorIn > 0 ? Math.min(anchorIn, tee.atIn) : tee.atIn)
  const sides = f.sides.map(s => ({ ...s }))
  if (joinedFromPrev(f, i) && i > 0) sides[i - 1].endFinish = 'free'
  if (sides[i].startFinish === 'corner') sides[i].startFinish = 'free'
  const had = !!f.sides[i].tee
  sides[i].tee = { sideId: tee.sideId, atIn: Math.round(atIn * 8) / 8 }
  let next: YardLayout = { ...f, sides }
  if (!had) {
    // Square to the side it starts from, on whichever side crosses nothing.
    const c = clearDirection(next, i)
    next = turnSideTo(next, i, c.deg)
  }
  return next
}

/** A tee's start dragged along its side: whole feet, kept on the side. */
export function slideTee(layout: YardLayout, i: number, to: PlanPoint): YardLayout {
  const j = teeAnchor(layout, i)
  if (j === null) return layout
  const dr = yardDrawing(layout)
  const an = dr.ends[j]
  const c = closestOn(to, an.a, an.b)
  const ft = Math.round(c.t * an.lenFt)
  const maxIn = layout.sides[j].lengthIn > 0 ? layout.sides[j].lengthIn : an.lenFt * 12
  const atIn = Math.min(maxIn, ft * 12)
  if (Math.abs((layout.sides[i].tee?.atIn ?? 0) - atIn) < 1e-6) return layout
  return { ...layout, sides: layout.sides.map((s, k) => (k === i ? { ...s, tee: { sideId: s.tee!.sideId, atIn } } : s)) }
}

// ── The house ─────────────────────────────────────────────────────────────────

/** The house moved, turned or sized by hand; kept touching the fence where the fence meets it. */
export function setHouse(layout: YardLayout, rect: HouseRect): YardLayout {
  const w = Math.max(8, Math.min(300, rect.w)), d = Math.max(8, Math.min(300, rect.d))
  const next = withDrawn(layout, { house: roundHouse({ ...rect, w, d }) })
  const placed = houseOnPlan(next, deriveLayout(next), yardDrawing(next)).rect
  return placed ? withDrawn(next, { house: roundHouse(placed) }) : next
}

// ── Adding a side, starting over ──────────────────────────────────────────────

/**
 * Side `id` (just added at the end) drawn a quarter turn right of the side
 * before it, or bent away when that would cross another side. The drawing so
 * far is kept as it is (its angles are saved first, so adding a side never
 * redraws the others).
 */
export function placeNewSide(layout: YardLayout, id: string): { layout: YardLayout; message: string | null } {
  const i = layout.sides.findIndex(s => s.id === id)
  if (i < 0) return { layout, message: null }
  const c = clearDirection(layout, i)
  const next = turnSideTo(layout, i, c.deg)
  const s = layout.sides[i]
  const msg = c.bent && c.wouldCross.length
    ? `${s.name} would cross ${c.wouldCross.join(' and ')} at a square right turn, so it was drawn another way. Drag its corner or type its angle to change it.`
    : null
  return { layout: next, message: msg }
}

/** Back as typed: the angles, an older quote's dragged corners and where the returns meet the house all cleared. Tees stay (they are a choice, not a drag). */
export function resetDrawing(layout: YardLayout): YardLayout {
  return { ...layout, plan: { ...(layout.plan ?? {}), drawn: null, points: null, pointsFor: null } }
}
