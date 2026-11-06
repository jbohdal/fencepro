/**
 * The office site plan editor's moves (SitePlanEditor.tsx), pure so the tests
 * check exactly what the editor does: a side typed to a length, a post
 * snapped square to its neighbour or onto a property line or the house, the
 * whole plan moved and turned, gates added and taken off, sides drawn and
 * removed, undo and redo, the survey laid under the plan, and the change a
 * quote needs when the office uses the drawn length or makes a change order
 * from the plan (the walk list's steps or the older drawing's side).
 *
 * Feet here are feet east (x) and north (y) of the plan's origin (toFeet).
 * Nothing here prices: a quote's price changes only through the quote builder.
 */

import { toFeet, fromFeet, postOf, drawnFt, planId, type LatLng, type SitePlanData, type SiteSide, type SiteGate, type SiteSurvey } from './sitePlanData'
import { walkToYard, type WalkList, type WalkStep } from './walkList'
import type { GateType, GateSwing, GateHinge, SideGate, YardLayout } from './yardLayout'

export interface Pt { x: number; y: number }

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T

// ── Undo and redo ─────────────────────────────────────────────────────────────

export interface History<T> { past: T[]; now: T; future: T[] }
const KEEP = 100
export const historyOf = <T,>(now: T): History<T> => ({ past: [], now, future: [] })
/** A new state: the one before goes on the undo list, the redo list is emptied. */
export function historyPush<T>(h: History<T>, next: T): History<T> {
  if (next === h.now) return h
  return { past: [...h.past, h.now].slice(-KEEP), now: next, future: [] }
}
/** The state changed in place of the last one (while a post is dragged): nothing new to undo. */
export const historyReplace = <T,>(h: History<T>, next: T): History<T> => ({ ...h, now: next })
export function historyUndo<T>(h: History<T>): History<T> {
  if (!h.past.length) return h
  return { past: h.past.slice(0, -1), now: h.past[h.past.length - 1], future: [h.now, ...h.future] }
}
export function historyRedo<T>(h: History<T>): History<T> {
  if (!h.future.length) return h
  return { past: [...h.past, h.now], now: h.future[0], future: h.future.slice(1) }
}

// ── Posts ─────────────────────────────────────────────────────────────────────

export const postFeet = (plan: SitePlanData, id: string): Pt | null => { const p = postOf(plan, id); return p ? toFeet(plan.origin, p) : null }

/** The answers about a side's feet were for where its posts were: once one moves, the side is asked again (its revisions keep the old answer). */
function dropLengthAnswers(plan: SitePlanData, postIds: string[]): Record<string, SitePlanData['answers'][string]> {
  const touched = new Set(plan.sides.filter(s => postIds.includes(s.a) || postIds.includes(s.b)).map(s => `len:${s.id}`))
  const out: SitePlanData['answers'] = {}
  for (const [k, v] of Object.entries(plan.answers)) if (!touched.has(k)) out[k] = v
  return out
}

/** A post put at a spot (feet). */
export function movePost(plan: SitePlanData, postId: string, at: Pt): SitePlanData {
  const ll = fromFeet(plan.origin, at)
  return { ...plan, posts: plan.posts.map(p => (p.id === postId ? { ...p, ...ll } : p)), answers: dropLengthAnswers(plan, [postId]) }
}

/**
 * A side typed to a length: its far post (b) moves along the side, the first
 * post stays. Another side on that post follows it. A side of no length keeps
 * its posts.
 */
export function setSideLength(plan: SitePlanData, sideId: string, ft: number): SitePlanData {
  const side = plan.sides.find(s => s.id === sideId)
  if (!side || !(ft > 0)) return plan
  const a = postFeet(plan, side.a), b = postFeet(plan, side.b)
  if (!a || !b) return plan
  const len = Math.hypot(b.x - a.x, b.y - a.y)
  if (len < 1e-6) return plan
  const k = ft / len
  return movePost(plan, side.b, { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k })
}

const angleOf = (v: Pt) => Math.atan2(v.y, v.x)
const wrap = (r: number) => { let x = r % (2 * Math.PI); if (x > Math.PI) x -= 2 * Math.PI; if (x <= -Math.PI) x += 2 * Math.PI; return x }

/** The line a dragged post is held to: through `from`, at `angle` (radians). */
interface Ray { from: Pt; angle: number }

/**
 * Square or 45 degrees to the neighbouring side: for each side on the dragged
 * post, the angle at its other post against that post's other side is held to
 * a multiple of 45 degrees when it is within `tolDeg` of one and that puts it
 * no farther than `maxMoveFt` from where it was dragged (a long side 4 degrees
 * off would jump the post feet away). Two such sides: the post goes where both
 * hold. Returns the spot and whether it was held.
 */
export function snapSquare(plan: SitePlanData, postId: string, want: Pt, tolDeg = 4, maxMoveFt = Infinity): { at: Pt; held: boolean } {
  const onRay = (ray: Ray, p: Pt): Pt => {
    const d = { x: Math.cos(ray.angle), y: Math.sin(ray.angle) }
    const t = (p.x - ray.from.x) * d.x + (p.y - ray.from.y) * d.y
    return { x: ray.from.x + d.x * t, y: ray.from.y + d.y * t }
  }
  const rays: Ray[] = []
  for (const s of plan.sides) {
    if (s.a !== postId && s.b !== postId) continue
    const qId = s.a === postId ? s.b : s.a
    const q = postFeet(plan, qId)
    if (!q) continue
    // The neighbouring side at q (not this one).
    const n = plan.sides.find(x => x.id !== s.id && (x.a === qId || x.b === qId))
    if (!n) continue
    const r = postFeet(plan, n.a === qId ? n.b : n.a)
    if (!r) continue
    const base = angleOf({ x: r.x - q.x, y: r.y - q.y })
    const now = angleOf({ x: want.x - q.x, y: want.y - q.y })
    const step = Math.PI / 4
    const k = Math.round(wrap(now - base) / step)
    const held = base + k * step
    if (Math.abs(wrap(now - held)) <= (tolDeg * Math.PI) / 180 && k % 4 !== 0) rays.push({ from: q, angle: held })
  }
  for (let i = rays.length - 1; i >= 0; i--) { const p = onRay(rays[i], want); if (Math.hypot(p.x - want.x, p.y - want.y) > maxMoveFt) rays.splice(i, 1) }
  if (!rays.length) return { at: want, held: false }
  if (rays.length >= 2) {
    const [r1, r2] = rays
    const d1 = { x: Math.cos(r1.angle), y: Math.sin(r1.angle) }, d2 = { x: Math.cos(r2.angle), y: Math.sin(r2.angle) }
    const den = d1.x * d2.y - d1.y * d2.x
    if (Math.abs(den) > 1e-6) {
      const t = ((r2.from.x - r1.from.x) * d2.y - (r2.from.y - r1.from.y) * d2.x) / den
      const p = { x: r1.from.x + d1.x * t, y: r1.from.y + d1.y * t }
      // Only when both hold near where the post was dragged (else the nearer one alone).
      if (Math.hypot(p.x - want.x, p.y - want.y) <= Math.min(10, maxMoveFt)) return { at: p, held: true }
    }
  }
  return { at: onRay(rays[0], want), held: true }
}

/** The nearest point on the segment a–b. */
export function nearestOnSegment(p: Pt, a: Pt, b: Pt): Pt {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy
  if (l2 < 1e-12) return a
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2))
  return { x: a.x + dx * t, y: a.y + dy * t }
}

/** Every edge of the property line and the house, feet, for snapping a post onto. */
export function snapEdges(plan: SitePlanData): Array<[Pt, Pt]> {
  const out: Array<[Pt, Pt]> = []
  const rings: LatLng[][] = [...(plan.parcel?.rings ?? []), ...plan.house]
  for (const ring of rings) {
    const f = ring.map(p => toFeet(plan.origin, p))
    for (let i = 0; i < f.length; i++) out.push([f[i], f[(i + 1) % f.length]])
  }
  return out
}

/** Onto the nearest property line or house wall within `tolFt`; else where it was. */
export function snapToEdges(p: Pt, edges: Array<[Pt, Pt]>, tolFt: number): { at: Pt; held: boolean } {
  let best: Pt | null = null, bestD = tolFt
  for (const [a, b] of edges) {
    const q = nearestOnSegment(p, a, b), d = Math.hypot(q.x - p.x, q.y - p.y)
    if (d <= bestD) { best = q; bestD = d }
  }
  return best ? { at: best, held: true } : { at: p, held: false }
}

// ── The whole plan ────────────────────────────────────────────────────────────

/** The middle of the plan's posts and house, feet. */
export function planCenter(plan: SitePlanData): Pt {
  const pts = [...plan.posts, ...plan.house.flat()].map(p => toFeet(plan.origin, p))
  if (!pts.length) return { x: 0, y: 0 }
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

function mapPlan(plan: SitePlanData, f: (p: Pt) => Pt): SitePlanData {
  const m = (ll: LatLng): LatLng => fromFeet(plan.origin, f(toFeet(plan.origin, ll)))
  return { ...plan, posts: plan.posts.map(p => ({ ...p, ...m(p) })), house: plan.house.map(r => r.map(m)) }
}

/** Posts and house moved `d` feet (the property lines and the survey stay where they are). Feet are unchanged. */
export const movePlan = (plan: SitePlanData, d: Pt): SitePlanData => mapPlan(plan, p => ({ x: p.x + d.x, y: p.y + d.y }))

/** Posts and house turned `deg` clockwise (as seen on the map, north up) about `about`. Feet are unchanged. */
export function turnPlan(plan: SitePlanData, deg: number, about: Pt = planCenter(plan)): SitePlanData {
  const r = (-deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  return mapPlan(plan, p => { const x = p.x - about.x, y = p.y - about.y; return { x: about.x + x * c - y * s, y: about.y + x * s + y * c } })
}

// ── Sides ─────────────────────────────────────────────────────────────────────

/** Sides named in order, a side added on the plan after the quote's. */
const nextSideName = (plan: SitePlanData) => `Side ${plan.sides.length + 1}`

/** A side drawn from a post (or a new post) to a new post at `to`, not on the quote (no quoted feet). */
export function addSide(plan: SitePlanData, from: string | Pt, to: Pt | string): SitePlanData {
  const posts = [...plan.posts]
  const idOf = (x: string | Pt): string => {
    if (typeof x === 'string') return x
    const id = planId('p')
    posts.push({ id, ...fromFeet(plan.origin, x) })
    return id
  }
  const a = idOf(from), b = idOf(to)
  if (a === b) return plan
  const side: SiteSide = { id: planId('s'), name: nextSideName(plan), a, b, quotedFt: null, yardSideId: null, walkStepIds: [], gates: [], teeFrom: null }
  return { ...plan, posts, sides: [...plan.sides, side], startPostId: plan.startPostId ?? a }
}

/** A side taken off; a post no other side uses goes with it. */
export function removeSide(plan: SitePlanData, sideId: string): SitePlanData {
  const sides = plan.sides.filter(s => s.id !== sideId)
  const used = new Set(sides.flatMap(s => [s.a, s.b]))
  const posts = plan.posts.filter(p => used.has(p.id))
  const answers = { ...plan.answers }
  delete answers[`len:${sideId}`]
  return { ...plan, sides, posts, startPostId: plan.startPostId && used.has(plan.startPostId) ? plan.startPostId : sides[0]?.a ?? null, answers }
}

// ── Gates ─────────────────────────────────────────────────────────────────────

export interface GateInput { fromEnd: 'a' | 'b'; distFt: number; widthFt: number; type: GateType; swing: GateSwing; hinge: GateHinge | null }

/** Where a new gate goes: its near edge's feet from the side's first post, or why it cannot go there. */
export function gatePlace(plan: SitePlanData, side: SiteSide, g: Pick<GateInput, 'fromEnd' | 'distFt' | 'widthFt'>): { atFt: number } | { error: string } {
  const len = drawnFt(plan, side)
  if (!(g.widthFt > 0)) return { error: 'Type the gate\'s width.' }
  if (!(g.distFt >= 0)) return { error: 'Type the feet from the corner.' }
  const atFt = g.fromEnd === 'a' ? g.distFt : len - g.distFt - g.widthFt
  if (atFt < -0.01 || atFt + g.widthFt > len + 0.01) return { error: `The gate does not fit: the side is ${Math.round(len * 10) / 10} ft.` }
  for (const o of side.gates) if (atFt < o.atFt + o.widthFt - 0.01 && o.atFt < atFt + g.widthFt - 0.01) return { error: 'It overlaps another gate on this side.' }
  return { atFt: Math.max(0, Math.round(atFt * 100) / 100) }
}

/** A gate added to a side; the posts stay where they are. */
export function addGate(plan: SitePlanData, sideId: string, g: GateInput): SitePlanData | { error: string } {
  const side = plan.sides.find(s => s.id === sideId)
  if (!side) return { error: 'That side is no longer on the plan.' }
  const at = gatePlace(plan, side, g)
  if ('error' in at) return at
  const gate: SiteGate = { id: planId('g'), atFt: at.atFt, widthFt: g.widthFt, type: g.type, swing: g.swing, hinge: g.type === 'double' ? null : g.hinge ?? 'left' }
  return { ...plan, sides: plan.sides.map(s => (s.id === sideId ? { ...s, gates: [...s.gates, gate].sort((x, y) => x.atFt - y.atFt) } : s)) }
}

/** A gate taken off; the posts stay where they are. */
export function removeGate(plan: SitePlanData, sideId: string, gateId: string): SitePlanData {
  return { ...plan, sides: plan.sides.map(s => (s.id === sideId ? { ...s, gates: s.gates.filter(g => g.id !== gateId) } : s)) }
}

/** A gate's swing or hinge changed. */
export function editGate(plan: SitePlanData, sideId: string, gateId: string, patch: Partial<Pick<SiteGate, 'swing' | 'hinge'>>): SitePlanData {
  return { ...plan, sides: plan.sides.map(s => (s.id === sideId ? { ...s, gates: s.gates.map(g => (g.id === gateId ? { ...g, ...patch } : g)) } : s)) }
}

// ── The house ─────────────────────────────────────────────────────────────────

/** A house drawn as a rectangle from two opposite corners (feet, square to north). */
export function houseRect(origin: LatLng, p: Pt, q: Pt): LatLng[] {
  return [{ x: p.x, y: p.y }, { x: q.x, y: p.y }, { x: q.x, y: q.y }, { x: p.x, y: q.y }].map(c => fromFeet(origin, c))
}

/** One house corner moved. */
export function moveHouseCorner(plan: SitePlanData, house: number, corner: number, at: Pt): SitePlanData {
  return { ...plan, house: plan.house.map((r, i) => (i === house ? r.map((c, k) => (k === corner ? fromFeet(plan.origin, at) : c)) : r)) }
}

// ── The survey under the plan ─────────────────────────────────────────────────

/** A spot on the survey picture (pixels, y down) on the map, feet. */
export function surveyToFeet(origin: LatLng, s: Pick<SiteSurvey, 'p1' | 'p2'>, px: Pt): Pt {
  const f1 = toFeet(origin, s.p1.at), f2 = toFeet(origin, s.p2.at)
  // q = pixel offset from p1 with y up; feet = f1 + c * q (complex), c from p2.
  const q2 = { x: s.p2.px.x - s.p1.px.x, y: -(s.p2.px.y - s.p1.px.y) }
  const d2 = { x: f2.x - f1.x, y: f2.y - f1.y }
  const den = q2.x * q2.x + q2.y * q2.y || 1
  const c = { x: (d2.x * q2.x + d2.y * q2.y) / den, y: (d2.y * q2.x - d2.x * q2.y) / den }
  const q = { x: px.x - s.p1.px.x, y: -(px.y - s.p1.px.y) }
  return { x: f1.x + c.x * q.x - c.y * q.y, y: f1.y + c.x * q.y + c.y * q.x }
}

/** A spot on the map (feet) as a spot on the survey picture (pixels). */
export function feetToSurvey(origin: LatLng, s: Pick<SiteSurvey, 'p1' | 'p2'>, f: Pt): Pt {
  const f1 = toFeet(origin, s.p1.at), f2 = toFeet(origin, s.p2.at)
  const q2 = { x: s.p2.px.x - s.p1.px.x, y: -(s.p2.px.y - s.p1.px.y) }
  const d2 = { x: f2.x - f1.x, y: f2.y - f1.y }
  const den2 = d2.x * d2.x + d2.y * d2.y || 1
  // q = (f - f1) / c, with 1/c = q2 / d2.
  const ic = { x: (q2.x * d2.x + q2.y * d2.y) / den2, y: (q2.y * d2.x - q2.x * d2.y) / den2 }
  const d = { x: f.x - f1.x, y: f.y - f1.y }
  const q = { x: ic.x * d.x - ic.y * d.y, y: ic.x * d.y + ic.y * d.x }
  return { x: s.p1.px.x + q.x, y: s.p1.px.y - q.y }
}

/** A survey just uploaded: centered on `at` (feet), `acrossFt` wide, north up, until its scale is set. */
export function placeSurvey(origin: LatLng, up: { url: string; w: number; h: number }, at: Pt, acrossFt: number): SiteSurvey {
  const k = acrossFt / Math.max(1, up.w)
  const p1px = { x: 0, y: up.h / 2 }, p2px = { x: up.w, y: up.h / 2 }
  return {
    url: up.url, w: up.w, h: up.h,
    p1: { px: p1px, at: fromFeet(origin, { x: at.x - (up.w / 2) * k, y: at.y }) },
    p2: { px: p2px, at: fromFeet(origin, { x: at.x + (up.w / 2) * k, y: at.y }) },
    ft: acrossFt, opacity: 0.6,
  }
}

/**
 * The survey's scale from two points on it and the feet between them: the
 * first point stays where it is on the map, the survey keeps its turn.
 */
export function scaleSurvey(origin: LatLng, s: SiteSurvey, a: Pt, b: Pt, ft: number): SiteSurvey | null {
  const px = Math.hypot(b.x - a.x, b.y - a.y)
  if (px < 2 || !(ft > 0)) return null
  const fa = surveyToFeet(origin, s, a), fb = surveyToFeet(origin, s, b)
  const now = Math.hypot(fb.x - fa.x, fb.y - fa.y) || 1
  const k = ft / now
  const fb2 = { x: fa.x + (fb.x - fa.x) * k, y: fa.y + (fb.y - fa.y) * k }
  return { ...s, p1: { px: a, at: fromFeet(origin, fa) }, p2: { px: b, at: fromFeet(origin, fb2) }, ft }
}

/** The survey moved `d` feet on the map. */
export function moveSurvey(origin: LatLng, s: SiteSurvey, d: Pt): SiteSurvey {
  const mv = (ll: LatLng) => { const f = toFeet(origin, ll); return fromFeet(origin, { x: f.x + d.x, y: f.y + d.y }) }
  return { ...s, p1: { ...s.p1, at: mv(s.p1.at) }, p2: { ...s.p2, at: mv(s.p2.at) } }
}

/** The survey turned `deg` clockwise about its middle. */
export function turnSurvey(origin: LatLng, s: SiteSurvey, deg: number): SiteSurvey {
  const mid = surveyToFeet(origin, s, { x: s.w / 2, y: s.h / 2 })
  const r = (-deg * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r)
  const t = (ll: LatLng) => { const f = toFeet(origin, ll), x = f.x - mid.x, y = f.y - mid.y; return fromFeet(origin, { x: mid.x + x * c - y * sn, y: mid.y + x * sn + y * c }) }
  return { ...s, p1: { ...s.p1, at: t(s.p1.at) }, p2: { ...s.p2, at: t(s.p2.at) } }
}

// ── The quote changed to match the plan (through the quote builder only) ─────

/**
 * The walk list with one side's feet changed to `feetIn` (fence plus its
 * gates, as the side was quoted): the difference goes on the side's last
 * walked stretch, then the ones before it when that one is too short. Every
 * other step is kept as it was. Null when the side's steps are not on the
 * walk list (it was changed since) or the feet cannot be taken off.
 */
/**
 * The steps that make a side on the walk list as it is now: from just after the step that ended the side before it
 * (a corner, an end, back to start) to the last of the side's own steps the plan knows. A step put in since the plan
 * was made (a change order's gate) is counted with its side. Null when none of the side's steps is on the walk.
 */
export function sideStepsNow(walk: WalkList, stepIds: string[]): string[] | null {
  for (const line of walk.lines) {
    let last = -1
    line.steps.forEach((x, i) => { if (stepIds.includes(x.id)) last = i })
    if (last < 0) continue
    let first = last
    while (first > 0 && !['corner', 'end', 'start'].includes(line.steps[first - 1].what)) first -= 1
    return line.steps.slice(first, last + 1).map(x => x.id)
  }
  return null
}

export function walkWithSideFeet(walk: WalkList, planStepIds: string[], feetIn: number): WalkList | null {
  const stepIds = sideStepsNow(walk, planStepIds) ?? []
  if (!stepIds.length || !(feetIn > 0)) return null
  const all = walk.lines.flatMap(l => l.steps)
  const steps = stepIds.map(id => all.find(s => s.id === id))
  if (steps.some(s => !s)) return null
  const now = steps.reduce((t, s) => t + Math.max(0, s!.feetIn || 0) + (s!.what === 'gate' ? Math.max(0, s!.gate?.widthIn ?? 0) : 0), 0)
  let delta = Math.round(feetIn) - now
  if (delta === 0) return clone(walk)
  const next = clone(walk)
  const byId = new Map<string, WalkStep>(next.lines.flatMap(l => l.steps).map(s => [s.id, s]))
  if (delta > 0) { byId.get(stepIds[stepIds.length - 1])!.feetIn = Math.max(0, byId.get(stepIds[stepIds.length - 1])!.feetIn || 0) + delta; return next }
  for (let i = stepIds.length - 1; i >= 0 && delta < 0; i--) {
    const s = byId.get(stepIds[i])!
    const take = Math.min(Math.max(0, s.feetIn || 0), -delta)
    s.feetIn = Math.max(0, s.feetIn || 0) - take
    delta += take
  }
  return delta === 0 ? next : null
}

/** An older drawing's side at `lengthIn`; every other side as it was. Null when the side is not on the drawing. */
export function yardWithSideFeet(yard: YardLayout, yardSideId: string, lengthIn: number): YardLayout | null {
  if (!yard.sides.some(s => s.id === yardSideId) || !(lengthIn > 0)) return null
  return { ...clone(yard), sides: yard.sides.map(s => (s.id === yardSideId ? { ...clone(s), lengthIn: Math.round(lengthIn) } : clone(s))) }
}

/**
 * The walk list with a gate put in on a side, `atIn` from the side's start:
 * the stretch it stands in is cut in two at the gate (the side's feet stay the
 * same: the gate takes the place of fence). Null when the gate does not fit
 * inside one stretch of fence (it would cross a corner, a tee or another gate).
 */
export function walkWithGate(walk: WalkList, planStepIds: string[], atIn: number, gate: { widthIn: number; type: GateType }): WalkList | null {
  const stepIds = sideStepsNow(walk, planStepIds) ?? []
  if (!stepIds.length || !(gate.widthIn > 0) || atIn < 0) return null
  const next = clone(walk)
  for (const line of next.lines) {
    let acc = 0
    const mine = line.steps.filter(s => stepIds.includes(s.id))
    if (!mine.length) continue
    for (const s of mine) {
      const fence = Math.max(0, s.feetIn || 0)
      if (atIn >= acc - 0.01 && atIn + gate.widthIn <= acc + fence + 0.01) {
        const before = Math.max(0, Math.round(atIn - acc))
        const g: WalkStep = { id: planId('wg'), feetIn: before, what: 'gate', gate: { widthIn: Math.round(gate.widthIn), type: gate.type } }
        s.feetIn = Math.max(0, fence - before - Math.round(gate.widthIn))
        line.steps.splice(line.steps.indexOf(s), 0, g)
        return next
      }
      acc += fence + (s.what === 'gate' ? Math.max(0, s.gate?.widthIn ?? 0) : 0)
    }
  }
  return null
}

/** An older drawing with a gate put in on a side, `atIn` from its start. */
export function yardWithGate(yard: YardLayout, yardSideId: string, atIn: number, gate: { widthIn: number; type: GateType; swing?: GateSwing | null; hinge?: GateHinge | null }): YardLayout | null {
  const side = yard.sides.find(s => s.id === yardSideId)
  if (!side || !(gate.widthIn > 0) || atIn < 0 || atIn + gate.widthIn > side.lengthIn + 0.01) return null
  const g: SideGate = { type: gate.type, widthIn: Math.round(gate.widthIn), position: 'distance', distanceIn: Math.round(atIn), swing: gate.swing ?? null, hinge: gate.type === 'double' ? null : gate.hinge ?? null }
  return {
    ...clone(yard),
    sides: yard.sides.map(s => {
      if (s.id !== yardSideId) return clone(s)
      const gates = [...(s.gates ?? (s.gate ? [s.gate] : [])), g].sort((x, y) => (x.distanceIn ?? 0) - (y.distanceIn ?? 0))
      return gates.length === 1 ? { ...clone(s), gate: g, gates: null } : { ...clone(s), gate: null, gates: clone(gates) }
    }),
  }
}

/** How the quote's layout changes for one plan change: its walk list and its yard (the builder takes whichever it opens on). */
export interface QuoteEdit {
  walk?: ((w: WalkList) => WalkList | null) | null
  yard?: ((y: YardLayout) => YardLayout | null) | null
}

/** The change for one side's feet (Use the drawn length, Make this side longer). */
export function sideFeetEdit(side: Pick<SiteSide, 'walkStepIds' | 'yardSideId'>, feetIn: number): QuoteEdit {
  return {
    walk: side.walkStepIds.length ? w => walkWithSideFeet(w, side.walkStepIds, feetIn) : null,
    yard: side.yardSideId ? y => yardWithSideFeet(y, side.yardSideId!, feetIn) : null,
  }
}

/** The change for a gate put in on a side (Add a gate here). */
export function gateEdit(side: Pick<SiteSide, 'walkStepIds' | 'yardSideId'>, atIn: number, gate: { widthIn: number; type: GateType; swing?: GateSwing | null; hinge?: GateHinge | null }): QuoteEdit {
  return {
    walk: side.walkStepIds.length ? w => walkWithGate(w, side.walkStepIds, atIn, gate) : null,
    yard: side.yardSideId ? y => yardWithGate(y, side.yardSideId!, atIn, gate) : null,
  }
}

// ── The quote's yard ──

/** The yard the quote is priced from: a walked quote's walk list, else its drawing. */
export function quoteYardOf(layout: unknown): YardLayout | null {
  const l = layout as { walk?: WalkList | null; yard?: YardLayout | null } | null
  if (l?.walk) return walkToYard(l.walk)
  return l?.yard ?? null
}


export type PlanStart = { what: 'draw' | 'place' | 'blank'; label: string }

/** What the button does for a job with no plan yet, from its quote's layout. */
export function startOf(layout: unknown): PlanStart {
  const l = layout as { walk?: WalkList | null; yard?: YardLayout | null } | null
  if (l?.walk) return { what: 'draw', label: 'Draw site plan' }
  if (l?.yard) return { what: 'place', label: 'Place on map' }
  return { what: 'blank', label: 'Draw site plan' }
}

// ── Old and new prices (the quote builder's banner) ──

/** Old and new options side by side ("Good $9,800 → $9,650"), cents, matched by their fence. */
export function optionPairs(
  before: Array<{ label?: string | null; fenceStyle?: string | null; finalPrice?: number | null; tier?: { label?: string | null } | null }>,
  after: Array<{ label?: string | null; fenceStyle?: string | null; finalPrice?: number | null; tier?: { label?: string | null } | null }>,
): Array<{ name: string; was: number | null; now: number | null }> {
  const nameOf = (o: { label?: string | null; fenceStyle?: string | null; tier?: { label?: string | null } | null }) => o.tier?.label || o.label || o.fenceStyle || 'Option'
  const cents = (d: number | null | undefined) => (typeof d === 'number' && Number.isFinite(d) ? Math.round(d * 100) : null)
  const out: Array<{ name: string; was: number | null; now: number | null }> = []
  const used = new Set<number>()
  for (const o of before) {
    const i = after.findIndex((n, k) => !used.has(k) && ((o.fenceStyle && n.fenceStyle === o.fenceStyle) || nameOf(n) === nameOf(o)))
    if (i >= 0) used.add(i)
    out.push({ name: nameOf(o), was: cents(o.finalPrice), now: i >= 0 ? cents(after[i].finalPrice) : null })
  }
  after.forEach((n, k) => { if (!used.has(k)) out.push({ name: nameOf(n), was: null, now: cents(n.finalPrice) }) })
  return out
}

// ── Labels ───────────────────────────────────────────────────────────────────

const ft1 = (n: number) => `${Math.round(n * 10) / 10} ft`
/** A side's label on the map: "Quoted 150 ft / Drawn 142 ft" when they differ by half a foot or more, else one number. */
export function sideLabel(plan: SitePlanData, side: SiteSide): string {
  const drawn = drawnFt(plan, side)
  if (side.quotedFt == null) return ft1(drawn)
  if (plan.answers[`len:${side.id}`]?.kind === 'keep') return `${ft1(side.quotedFt)} (wheel)`
  if (Math.abs(drawn - side.quotedFt) < 0.5) return ft1(side.quotedFt)
  return `Quoted ${ft1(side.quotedFt)} / Drawn ${ft1(drawn)}`
}
