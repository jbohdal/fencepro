/**
 * The office site plan (Jonathan, Nov 5 2026, Prompt 2): the exact plan the
 * office draws on a computer after the sale, at true scale on the map.
 *
 * Every post is a place on the map (latitude and longitude), so a side's drawn
 * feet are true feet. Each side joins two posts and keeps the feet it was
 * quoted at and the walk list steps it came from; gates sit on a side by their
 * feet from the side's first post. The plan starts from the quote: a walk list
 * laid out with square corners, or an older drawing placed where it was drawn
 * on its aerial photo (placeOnMap), and neither ever changes the price.
 *
 * Pure: no browser, no server. The editor, the installer sheet and the permit
 * sheet all read a plan through these functions.
 */

import { buildPlan, type Plan } from './sitePlanGeometry'
import { deriveLayout, sideGates, type YardLayout, type GateSwing, type GateHinge } from './yardLayout'
import { photoView, planShift } from './sitePlanPhoto'
import type { WalkList } from './walkList'

// ── The plan ──────────────────────────────────────────────────────────────────

export interface LatLng { lat: number; lng: number }
export interface SitePost extends LatLng { id: string }
export interface SiteGate {
  id: string
  /** Feet from the side's first post to the gate's near edge. */
  atFt: number
  widthFt: number
  type: 'walk' | 'double'
  swing: GateSwing
  /** A single gate's hinge side, looking from inside the yard; null for a double gate. */
  hinge: GateHinge | null
}
export interface SiteSide {
  id: string
  name: string
  /** Its first and last post. */
  a: string
  b: string
  /** Feet the quote was priced with (null: added on the plan, not quoted). */
  quotedFt: number | null
  /** The quote's side it is (yard side id; a walked quote's are made from the walk list). */
  yardSideId: string | null
  /** The walk list steps it was walked as. */
  walkStepIds: string[]
  gates: SiteGate[]
  /** Drawn from another side's tee (that side's id). */
  teeFrom?: string | null
}
/** How a flag was answered: the quote's feet kept (with a note) or the drawn feet used (repriced through the quote). */
export interface FlagAnswer { kind: 'keep' | 'drawn'; note: string; by: string; at: string }
export interface SiteParcel {
  /** The county's parcel number. */
  id: string
  /** Its boundary as the county gave it (a copy kept with the job), outer ring first. */
  rings: LatLng[][]
  source: string
  fetchedAt: string
}
export interface SiteSurvey {
  /** The uploaded survey page (a picture; a PDF's first page made into one). */
  url: string
  /** Its size in pixels. */
  w: number
  h: number
  /** Scale and place: two points on the picture (pixels) and where they are on the map. */
  p1: { px: { x: number; y: number }; at: LatLng }
  p2: { px: { x: number; y: number }; at: LatLng }
  /** The distance typed between the two points, feet (sets the scale). */
  ft: number
  opacity: number
}
export interface SitePlanData {
  v: 1
  /** Where the plan's feet are counted from (the job's address on the map). */
  origin: LatLng
  posts: SitePost[]
  sides: SiteSide[]
  /** The house: each outline's corners on the map. */
  house: LatLng[][]
  /** The post the crew starts at ("Start here"). */
  startPostId: string | null
  /** Office notes for the crew. */
  notes: string
  /** The county's parcel, kept with the job; null when none was found (says so). */
  parcel: SiteParcel | null
  /** Neighbors' parcels as found (thin lines), not kept for the permit. */
  neighbors?: LatLng[][][]
  survey: SiteSurvey | null
  answers: Record<string, FlagAnswer>
  /** Show the aerial photo on the permit sheet (off unless turned on). */
  permitAerial?: boolean
}

// ── True feet on the map ──────────────────────────────────────────────────────

const M_PER_FT = 0.3048
/** Meters per degree of latitude and longitude at `lat` (WGS84). */
function metersPerDegree(lat: number): { lat: number; lng: number } {
  const p = (lat * Math.PI) / 180
  return {
    lat: 111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p),
    lng: 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p),
  }
}
/** A place as feet east (x) and north (y) of `origin`. */
export function toFeet(origin: LatLng, at: LatLng): { x: number; y: number } {
  const m = metersPerDegree(origin.lat)
  return { x: ((at.lng - origin.lng) * m.lng) / M_PER_FT, y: ((at.lat - origin.lat) * m.lat) / M_PER_FT }
}
/** Feet east (x) and north (y) of `origin` as a place on the map. */
export function fromFeet(origin: LatLng, p: { x: number; y: number }): LatLng {
  const m = metersPerDegree(origin.lat)
  return { lat: origin.lat + (p.y * M_PER_FT) / m.lat, lng: origin.lng + (p.x * M_PER_FT) / m.lng }
}
/** Feet between two places. */
export function feetBetween(a: LatLng, b: LatLng): number {
  const p = toFeet(a, b)
  return Math.hypot(p.x, p.y)
}

export const postOf = (plan: SitePlanData, id: string): SitePost | undefined => plan.posts.find(p => p.id === id)
/** A side's drawn feet (its two posts on the map). */
export function drawnFt(plan: SitePlanData, side: SiteSide): number {
  const a = postOf(plan, side.a), b = postOf(plan, side.b)
  return a && b ? feetBetween(a, b) : 0
}
/** The feet a side is built and priced at: the drawn feet once "Use the drawn length" was answered, else the quote's. */
export function builtFt(plan: SitePlanData, side: SiteSide): number {
  if (side.quotedFt == null || plan.answers[`len:${side.id}`]?.kind === 'drawn') return drawnFt(plan, side)
  return side.quotedFt
}

let seq = 0
export const planId = (p: string) => `${p}${Date.now().toString(36)}${(seq += 1).toString(36)}`

// ── From the quote ────────────────────────────────────────────────────────────

/**
 * The quote's yard as a plan on the map. A walked quote's yard (walkToYard) is
 * laid out with square corners from its turns; an older drawing keeps its own
 * angles and house. With an aerial photo saved on the drawing, every post goes
 * where it was drawn on that photo; otherwise the plan is centered on `at` (the
 * job's address), north up. Quoted feet, gates and tees are the quote's; nothing
 * here prices.
 */
export function planFromYard(yard: YardLayout, at: LatLng | null, walk?: WalkList | null): SitePlanData | null {
  const result = deriveLayout(yard)
  const plan: Plan = buildPlan(yard, result)
  const aerial = yard.plan?.aerial
  const origin: LatLng | null = aerial ? { lat: aerial.lat, lng: aerial.lng } : at
  if (!origin) return null
  // Plan feet → feet east/north of the origin.
  let toGround: (p: { x: number; y: number }) => { x: number; y: number }
  if (aerial) {
    const { rotDeg } = photoView(yard), s = planShift(yard)
    const r = (rotDeg * Math.PI) / 180, c = Math.cos(r), sn = Math.sin(r)
    // The drawing's frame is the photo turned by rotDeg (sitePlanPhoto groundToFrame); back to the ground.
    toGround = p => { const f = { x: p.x + s.x, y: p.y + s.y }; return { x: f.x * c - f.y * sn, y: f.x * sn + f.y * c } }
  } else {
    const mx = (plan.bounds.minX + plan.bounds.maxX) / 2, my = (plan.bounds.minY + plan.bounds.maxY) / 2
    toGround = p => ({ x: p.x - mx, y: p.y - my })
  }
  const posts: SitePost[] = []
  const postAt = (p: { x: number; y: number }): string => {
    const g = toGround(p)
    const near = posts.find(q => { const f = toFeet(origin, q); return Math.hypot(f.x - g.x, f.y - g.y) < 0.25 })
    if (near) return near.id
    const id = planId('p')
    posts.push({ id, ...fromFeet(origin, g) })
    return id
  }
  const stepsOf = new Map<string, string[]>()
  if (walk) {
    // walkToYard names a line's sides w<line>_<n>, a new side at each corner (walkList.ts).
    let n = 0
    for (const line of walk.lines) {
      if (!line.steps.length) continue
      n += 1
      let ids: string[] = []
      for (const s of line.steps) {
        ids.push(s.id)
        if (s.what === 'corner') { stepsOf.set(`w${line.id}_${n}`, ids); ids = []; n += 1 }
      }
      stepsOf.set(`w${line.id}_${n}`, ids)
    }
  }
  const sides: SiteSide[] = []
  for (const ps of plan.sides) {
    const ys = yard.sides.find(s => s.id === ps.sideId)
    if (!ys || ys.on === false || ps.placeholder) continue
    const a = postAt(ps.a), b = postAt(ps.b)
    const len = Math.hypot(ps.b.x - ps.a.x, ps.b.y - ps.a.y) || 1
    const along = (p: { x: number; y: number }) => ((p.x - ps.a.x) * (ps.b.x - ps.a.x) + (p.y - ps.a.y) * (ps.b.y - ps.a.y)) / len
    const placed = ps.gates ?? (ps.gate ? [ps.gate] : [])
    const typed = sideGates(ys)
    const gates: SiteGate[] = placed.map((g, i) => {
      const d0 = along(g.a), d1 = along(g.b)
      return {
        id: planId('g'),
        atFt: Math.round(Math.min(d0, d1) * 100) / 100,
        widthFt: typed[i] ? typed[i].widthIn / 12 : Math.abs(d1 - d0),
        type: g.type,
        swing: g.leafSwing.left,
        hinge: g.hinge,
      }
    })
    sides.push({
      id: planId('s'), name: ps.name, a, b,
      quotedFt: Math.round((ys.lengthIn / 12) * 100) / 100,
      yardSideId: ys.id, walkStepIds: stepsOf.get(ys.id) ?? [], gates,
      teeFrom: ys.tee ? ys.tee.sideId : null,
    })
  }
  // A tee's branch is drawn from the side it stands on.
  for (const s of sides) if (s.teeFrom) s.teeFrom = sides.find(x => x.yardSideId === s.teeFrom)?.id ?? null
  const house = plan.house ? [plan.house.map(p => fromFeet(origin, toGround(p)))] : []
  return { v: 1, origin, posts, sides, house, startPostId: sides[0]?.a ?? null, notes: '', parcel: null, survey: null, answers: {} }
}

// ── Quoted vs drawn ───────────────────────────────────────────────────────────

export interface PlanFlag {
  key: string
  /** The side it is about, when one. */
  sideId: string | null
  text: string
  /** A side's feet ('length') or the fence's makeup ('count'). */
  kind: 'length' | 'count'
}
export interface FlagSettings { tolFt: number; tolPct: number }
export const DEFAULT_FLAG_SETTINGS: FlagSettings = { tolFt: 3, tolPct: 3 }

const ft1 = (n: number) => `${Math.round(n * 10) / 10} ft`
/** Every place the drawn plan and the quote disagree, in plain words (keys stable across saves). */
export function planFlags(plan: SitePlanData, yard: YardLayout | null, s: FlagSettings = DEFAULT_FLAG_SETTINGS): PlanFlag[] {
  const out: PlanFlag[] = []
  for (const side of plan.sides) {
    if (side.quotedFt == null) continue
    const drawn = drawnFt(plan, side), diff = Math.abs(drawn - side.quotedFt)
    if (diff > Math.max(s.tolFt, (s.tolPct / 100) * side.quotedFt)) {
      out.push({ key: `len:${side.id}`, sideId: side.id, kind: 'length', text: `${side.name}: quoted ${ft1(side.quotedFt)}, drawn ${ft1(drawn)} (${drawn > side.quotedFt ? '+' : '−'}${ft1(diff)}).` })
    }
  }
  if (!yard) return out
  const quotedSides = yard.sides.filter(x => x.on !== false && x.lengthIn > 0)
  if (plan.sides.length !== quotedSides.length) out.push({ key: 'sides', sideId: null, kind: 'count', text: `The quote has ${quotedSides.length} side${quotedSides.length === 1 ? '' : 's'}; the plan has ${plan.sides.length}.` })
  const qGates = quotedSides.flatMap(x => sideGates(x)), pGates = plan.sides.flatMap(x => x.gates)
  if (qGates.length !== pGates.length) out.push({ key: 'gates', sideId: null, kind: 'count', text: `The quote has ${qGates.length} gate${qGates.length === 1 ? '' : 's'}; the plan has ${pGates.length}.` })
  else {
    const q = qGates.map(g => `${g.type}:${Math.round(g.widthIn)}`).sort().join(','), p = pGates.map(g => `${g.type}:${Math.round(g.widthFt * 12)}`).sort().join(',')
    if (q !== p) out.push({ key: 'gateWidths', sideId: null, kind: 'count', text: `Gate widths differ: quoted ${qGates.map(g => `${ft1(g.widthIn / 12)} ${g.type === 'double' ? 'double' : 'single'}`).join(', ')}; drawn ${pGates.map(g => `${ft1(g.widthFt)} ${g.type === 'double' ? 'double' : 'single'}`).join(', ')}.` })
  }
  const qTees = quotedSides.filter(x => x.tee).length, pTees = plan.sides.filter(x => x.teeFrom).length
  if (qTees !== pTees) out.push({ key: 'tees', sideId: null, kind: 'count', text: `The quote has ${qTees} tee${qTees === 1 ? '' : 's'}; the plan has ${pTees}.` })
  const qClosed = yard.closed || quotedSides.some(x => x.joinsSideId), pClosed = planCloses(plan)
  if (qClosed !== pClosed) out.push({ key: 'closed', sideId: null, kind: 'count', text: qClosed ? 'The quote closes back on itself; the plan does not.' : 'The plan closes back on itself; the quote does not.' })
  return out
}
/** Flags not answered yet ("Keep the wheel number" or "Use the drawn length"). */
export function openFlags(plan: SitePlanData, flags: PlanFlag[]): PlanFlag[] {
  return flags.filter(f => !plan.answers[f.key])
}
/** Some fence line ends back at its own first post. */
export function planCloses(plan: SitePlanData): boolean {
  const used = new Map<string, number>()
  for (const s of plan.sides) for (const p of [s.a, s.b]) used.set(p, (used.get(p) ?? 0) + 1)
  // A ring: every post on it is used twice; a closed line has no post used once among its sides.
  const ends = [...used.values()].filter(n => n === 1).length
  return plan.sides.length >= 3 && ends === 0
}

// ── Posts for the crew ────────────────────────────────────────────────────────

export type PostKind = 'corner' | 'end' | 'line' | 'gate' | 'tee'
export interface CrewPost { n: number; kind: PostKind; at: LatLng; sideId: string | null }
export interface CrewSide { id: string; name: string; ft: number; pieces: Array<{ ft: number; sections: number; spacingFt: number }> }

/**
 * Every post the crew sets, numbered in walking order from the start post:
 * each side's first post, its line posts evenly spaced in each piece between
 * gates (`sectionsOf` gives each piece's sections, the quote's own count), the
 * gate posts, then its last post. A post shared by two sides is counted once.
 */
export function crewPosts(plan: SitePlanData, sectionsOf: (sideId: string, pieceFt: number, piece: number) => number): { posts: CrewPost[]; sides: CrewSide[] } {
  const posts: CrewPost[] = [], sides: CrewSide[] = []
  const numbered = new Map<string, number>()
  const uses = new Map<string, number>()
  for (const s of plan.sides) for (const p of [s.a, s.b]) uses.set(p, (uses.get(p) ?? 0) + 1)
  const teeAt = new Set(plan.sides.filter(s => s.teeFrom).map(s => s.a))
  const kindOf = (id: string): PostKind => (teeAt.has(id) ? 'tee' : (uses.get(id) ?? 0) >= 2 ? 'corner' : 'end')
  const add = (kind: PostKind, at: LatLng, sideId: string | null, postId?: string) => {
    if (postId && numbered.has(postId)) return
    const n = posts.length + 1
    posts.push({ n, kind, at, sideId })
    if (postId) numbered.set(postId, n)
  }
  // Walking order: the start post's side first, then sides in the plan's order.
  const order = [...plan.sides].sort((x, y) => Number(y.a === plan.startPostId || y.b === plan.startPostId) - Number(x.a === plan.startPostId || x.b === plan.startPostId))
  for (const side of order) {
    let a = postOf(plan, side.a), b = postOf(plan, side.b)
    if (!a || !b) continue
    const flip = side.b === plan.startPostId && side.a !== plan.startPostId
    if (flip) [a, b] = [b, a]
    const total = builtFt(plan, side) || drawnFt(plan, side)
    // A post `ft` along the side (built feet) sits at that share of the side as drawn on the map.
    const vec = toFeet(a, b)
    const at = (ft: number) => { const k = total > 0 ? Math.min(1, Math.max(0, ft / total)) : 0; return fromFeet(a!, { x: vec.x * k, y: vec.y * k }) }
    add(kindOf(flip ? side.b : side.a), a, side.id, flip ? side.b : side.a)
    const gates = [...side.gates].map(g => (flip ? { ...g, atFt: total - g.atFt - g.widthFt } : g)).sort((x, y) => x.atFt - y.atFt)
    const cuts: Array<[number, number]> = []
    let from = 0
    for (const g of gates) { cuts.push([from, g.atFt]); from = g.atFt + g.widthFt }
    cuts.push([from, total])
    const pieces: CrewSide['pieces'] = []
    cuts.forEach(([p0, p1], i) => {
      const ft = Math.max(0, p1 - p0)
      const sections = ft > 0 ? Math.max(1, sectionsOf(side.id, ft, i)) : 0
      pieces.push({ ft: Math.round(ft * 100) / 100, sections, spacingFt: sections ? Math.round((ft / sections) * 100) / 100 : 0 })
      for (let k = 1; k < sections; k++) add('line', at(p0 + (ft * k) / sections), side.id)
      const g = gates[i]
      // A gate at the side's first or last post hangs on it: that post is the gate post (counted once, as priced).
      const atEnd = (ft: number) => ft < 0.05 || ft > total - 0.05
      if (g) { if (!atEnd(g.atFt)) add('gate', at(g.atFt), side.id); if (!atEnd(g.atFt + g.widthFt)) add('gate', at(g.atFt + g.widthFt), side.id) }
    })
    add(kindOf(flip ? side.a : side.b), b, side.id, flip ? side.a : side.b)
    sides.push({ id: side.id, name: side.name, ft: Math.round(total * 100) / 100, pieces })
  }
  return { posts, sides }
}

/** Sections in a piece of fence: the quote's own per-piece count when it has one, else whole sections at the width. */
export const sectionsAt = (pieceFt: number, widthFt: number) => (pieceFt > 0 ? Math.ceil(pieceFt / Math.max(1, widthFt) - 1e-9) : 0)

// ── Property lines ────────────────────────────────────────────────────────────

/** Feet from a place to the nearest edge of a ring. */
function distToRing(origin: LatLng, p: LatLng, ring: LatLng[]): number {
  const q = toFeet(origin, p)
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = toFeet(origin, ring[i]), b = toFeet(origin, ring[(i + 1) % ring.length])
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / l2))
    best = Math.min(best, Math.hypot(q.x - (a.x + t * dx), q.y - (a.y + t * dy)))
  }
  return best
}
function inside(origin: LatLng, p: LatLng, ring: LatLng[]): boolean {
  const q = toFeet(origin, p)
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = toFeet(origin, ring[i]), b = toFeet(origin, ring[j])
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y || 1e-9) + a.x) c = !c
  }
  return c
}
/** Sides that leave the job's parcel, or come closer to its line than the setback (feet), checked every foot. */
export function propertyLineWarnings(plan: SitePlanData, setbackFt = 0): string[] {
  const ring = plan.parcel?.rings[0]
  if (!ring || ring.length < 3) return []
  const out: string[] = []
  for (const s of plan.sides) {
    const a = postOf(plan, s.a), b = postOf(plan, s.b)
    if (!a || !b) continue
    const len = feetBetween(a, b), n = Math.max(1, Math.ceil(len))
    let outside = false, closest = Infinity
    for (let k = 0; k <= n; k++) {
      const f = toFeet(a, b), p = fromFeet(a, { x: (f.x * k) / n, y: (f.y * k) / n })
      if (!inside(plan.origin, p, ring)) outside = true
      closest = Math.min(closest, distToRing(plan.origin, p, ring))
    }
    if (outside) out.push(`${s.name} crosses the property line. Check it against a survey.`)
    else if (setbackFt > 0 && closest < setbackFt) out.push(`${s.name} is ${Math.round(closest * 10) / 10} ft from the property line, closer than the ${setbackFt} ft setback.`)
  }
  return out
}
