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
import { walkSideEnds, type WalkList } from './walkList'

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
export interface FlagAnswer {
  kind: 'keep' | 'drawn'
  note: string
  by: string
  at: string
  /** "Use the drawn length" through a change order: the answer counts once that change order is signed or approved (the server checks), and goes with it when it is voided. */
  coId?: string | null
}
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
  /**
   * Changes made from the plan through a change order that is not signed or approved yet: drawn on the editor,
   * never on the crew's or permit sheet or the customer's pages, put on the plan when the change order goes through
   * (applyChange) and dropped when it is voided.
   */
  pending?: PendingChange[]
}
export interface PendingChange {
  id: string
  /** The change order it waits on. */
  coId: string
  coNumber: number | null
  kind: 'gate' | 'longer'
  sideId: string
  /** 'gate': the gate added. */
  gate?: SiteGate
  /** 'longer': the side's new feet. */
  newFt?: number
  by: string
  at: string
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
  // A walked quote is laid out from its walk list (square corners, separate lines side by side, a branch from its
  // tee, back to start closing on the first post), as its rough sketch is.
  const ends = walk ? walkSideEnds(walk) : null
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
    const pts = ends && ends.size ? [...ends.values()].flatMap(e => [e.a, e.b]) : [{ x: plan.bounds.minX, y: plan.bounds.minY }, { x: plan.bounds.maxX, y: plan.bounds.maxY }]
    const mx = (Math.min(...pts.map(p => p.x)) + Math.max(...pts.map(p => p.x))) / 2, my = (Math.min(...pts.map(p => p.y)) + Math.max(...pts.map(p => p.y))) / 2
    toGround = p => ({ x: p.x - mx, y: p.y - my })
  }
  const posts: SitePost[] = []
  const lineStart = new Map<string, string>(), lineEnd = new Map<string, string>()
  const newPost = (p: { x: number; y: number }): string => { const id = planId('p'); posts.push({ id, ...fromFeet(origin, toGround(p)) }); return id }
  const postAt = (p: { x: number; y: number }): string => {
    const g = toGround(p)
    const near = posts.find(q => { const f = toFeet(origin, q); return Math.hypot(f.x - g.x, f.y - g.y) < 0.25 })
    if (near) return near.id
    const id = planId('p')
    posts.push({ id, ...fromFeet(origin, g) })
    return id
  }
  const sides: SiteSide[] = []
  for (const ps of plan.sides) {
    const ys = yard.sides.find(s => s.id === ps.sideId)
    if (!ys || ys.on === false || ps.placeholder) continue
    const walked = !aerial ? ends?.get(ys.id) : undefined
    let a: string, b: string
    if (walked) {
      // A walked side's posts are joined as the fence was walked, never by where they land: the side starts on the
      // last side's end post of its line (a branch on its tee), and only "back to start" ends on the line's first
      // post (a fence walked to an end post that happens to land on its start stays open).
      const line = ys.id.slice(1, ys.id.lastIndexOf('_'))
      a = lineEnd.get(line) ?? newPost(walked.a)
      if (!lineStart.has(line)) lineStart.set(line, a)
      b = ys.joinsSideId ? lineStart.get(line)! : newPost(walked.b)
      lineEnd.set(line, b)
    } else { a = postAt(ps.a); b = postAt(ps.b) }
    const len = Math.hypot(ps.b.x - ps.a.x, ps.b.y - ps.a.y) || 1
    const along = (p: { x: number; y: number }) => ((p.x - ps.a.x) * (ps.b.x - ps.a.x) + (p.y - ps.a.y) * (ps.b.y - ps.a.y)) / len
    const placed = ps.gates ?? (ps.gate ? [ps.gate] : [])
    const typed = sideGates(ys)
    const gates: SiteGate[] = placed.map((g, i) => {
      const d0 = along(g.a), d1 = along(g.b)
      // A walked gate's place is its walked feet from the side's first post.
      const walkedAt = walked && typed[i]?.position === 'distance' ? (typed[i].distanceIn ?? 0) / 12 : null
      return {
        id: planId('g'),
        atFt: Math.round((walkedAt ?? Math.min(d0, d1)) * 100) / 100,
        widthFt: typed[i] ? typed[i].widthIn / 12 : Math.abs(d1 - d0),
        type: g.type,
        swing: g.leafSwing.left,
        hinge: g.hinge,
      }
    })
    sides.push({
      id: planId('s'), name: ps.name, a, b,
      quotedFt: Math.round((ys.lengthIn / 12) * 100) / 100,
      yardSideId: ys.id, walkStepIds: ends?.get(ys.id)?.steps ?? [], gates,
      teeFrom: ys.tee ? ys.tee.sideId : null,
    })
  }
  // A tee's branch is drawn from the side it stands on.
  for (const s of sides) if (s.teeFrom) s.teeFrom = sides.find(x => x.yardSideId === s.teeFrom)?.id ?? null
  const house = plan.house ? [plan.house.map(p => fromFeet(origin, toGround(p)))] : []
  return { v: 1, origin, posts, sides, house, startPostId: sides[0]?.a ?? null, notes: '', parcel: null, survey: null, answers: {} }
}

// ── Change orders from the plan ───────────────────────────────────────────────

/**
 * A change order's change put on the plan: a gate added to its side, or a side made longer (its far post moved
 * along it, and the fence beyond moved with it, so the other sides keep their feet). The side's quoted feet become
 * the new feet: the quote is the signed one plus the change order. The change leaves `pending`.
 */
export function applyChange(plan: SitePlanData, c: PendingChange): SitePlanData {
  const next: SitePlanData = JSON.parse(JSON.stringify(plan))
  next.pending = (next.pending ?? []).filter(p => p.id !== c.id)
  const side = next.sides.find(s => s.id === c.sideId)
  if (!side) return next
  if (c.kind === 'gate' && c.gate) side.gates = [...side.gates, { ...c.gate }].sort((x, y) => x.atFt - y.atFt)
  if (c.kind === 'longer' && c.newFt && c.newFt > 0) {
    const a = postOf(next, side.a), b = postOf(next, side.b)
    if (a && b) {
      const v = toFeet(a, b), len = Math.hypot(v.x, v.y) || 1
      const to = fromFeet(a, { x: (v.x / len) * c.newFt, y: (v.y / len) * c.newFt })
      const d = toFeet(b, to)
      // The posts beyond the far post (not back through this side): moved by the same feet.
      const moved = new Set<string>([side.b]), stack = [side.b]
      while (stack.length) {
        const p = stack.pop()!
        for (const s of next.sides) {
          if (s.id === side.id) continue
          for (const [x, y] of [[s.a, s.b], [s.b, s.a]]) if (x === p && !moved.has(y)) { moved.add(y); stack.push(y) }
        }
      }
      // A closed fence comes back to this side's first post: only the far post moves.
      const keep = moved.has(side.a) ? new Set([side.b]) : moved
      for (const post of next.posts) if (keep.has(post.id)) Object.assign(post, fromFeet(post, d))
    }
    side.quotedFt = Math.round(c.newFt * 100) / 100
  }
  if (c.kind === 'gate' && side.quotedFt == null) side.quotedFt = Math.round(drawnFt(next, side) * 100) / 100
  return next
}
/** The plan as the editor shows it: with its change orders still waiting put on, each marked by `pending`. */
export function withPending(plan: SitePlanData): SitePlanData {
  return (plan.pending ?? []).reduce((p, c) => ({ ...applyChange(p, c), pending: plan.pending }), plan)
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
  // The fence's makeup (sides, gates, gate widths, tees, closing) cannot be kept different from the quote: the crew
  // and the customer would see a fence nobody priced. The plan is made to match, or the change goes through the
  // quote (repriced, or a change order).
  return flags.filter(f => { const a = plan.answers[f.key]; return !a || (f.kind === 'count' && a.kind === 'keep') })
}
/** Some fence line ends back at its own first post. */
export function planCloses(plan: SitePlanData): boolean {
  // Each fence line on its own (posts joined by sides): a line that is a ring (3 sides or more, no loose end)
  // closes. Another open line beside a closed pool does not make the pool open.
  const group = new Map<string, string>()
  const root = (p: string): string => { let r = p; while (group.get(r) && group.get(r) !== r) r = group.get(r)!; return r }
  for (const s of plan.sides) { for (const p of [s.a, s.b]) if (!group.has(p)) group.set(p, p); group.set(root(s.a), root(s.b)) }
  const lines = new Map<string, SiteSide[]>()
  for (const s of plan.sides) { const r = root(s.a); lines.set(r, [...(lines.get(r) ?? []), s]) }
  for (const sides of lines.values()) {
    const used = new Map<string, number>()
    for (const s of sides) for (const p of [s.a, s.b]) used.set(p, (used.get(p) ?? 0) + 1)
    if (sides.length >= 3 && ![...used.values()].some(n => n === 1)) return true
  }
  return false
}

// ── Posts for the crew ────────────────────────────────────────────────────────

export type PostKind = 'corner' | 'end' | 'line' | 'gate' | 'tee'
export interface CrewPost { n: number; kind: PostKind; at: LatLng; sideId: string | null }
export interface CrewSide {
  id: string; name: string; ft: number; pieces: Array<{ ft: number; sections: number; spacingFt: number }>
  /** The crew's numbers of the side's first and last post as walked, and whether it is walked from its last post (b). */
  from: number; to: number; flip: boolean
  /** Its gates in walking order: feet from the side's first post as walked, and the numbers of the two posts it hangs between. */
  gates: Array<{ id: string; atFt: number; widthFt: number; posts: [number, number] }>
}

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
  const add = (kind: PostKind, at: LatLng, sideId: string | null, postId?: string): number => {
    if (postId && numbered.has(postId)) return numbered.get(postId)!
    const n = posts.length + 1
    posts.push({ n, kind, at, sideId })
    if (postId) numbered.set(postId, n)
    return n
  }
  for (const { side, flip } of walkingOrder(plan)) {
    let a = postOf(plan, side.a), b = postOf(plan, side.b)
    if (!a || !b) continue
    if (flip) [a, b] = [b, a]
    const total = builtFt(plan, side) || drawnFt(plan, side)
    // A post `ft` along the side (built feet) sits at that share of the side as drawn on the map.
    const vec = toFeet(a, b)
    const at = (ft: number) => { const k = total > 0 ? Math.min(1, Math.max(0, ft / total)) : 0; return fromFeet(a!, { x: vec.x * k, y: vec.y * k }) }
    const first = add(kindOf(flip ? side.b : side.a), a, side.id, flip ? side.b : side.a)
    const gateNos: CrewSide['gates'] = []
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
      // Its posts: its own gate posts, or the side's end post it hangs on (the last post's number is known once it is added, below).
      if (g) {
        const p0 = atEnd(g.atFt) ? (g.atFt < 0.05 ? first : -1) : add('gate', at(g.atFt), side.id)
        const p1 = atEnd(g.atFt + g.widthFt) ? (g.atFt + g.widthFt < 0.05 ? first : -1) : add('gate', at(g.atFt + g.widthFt), side.id)
        gateNos.push({ id: g.id, atFt: Math.round(g.atFt * 100) / 100, widthFt: g.widthFt, posts: [p0, p1] })
      }
    })
    const last = add(kindOf(flip ? side.a : side.b), b, side.id, flip ? side.a : side.b)
    for (const g of gateNos) g.posts = g.posts.map(n => (n === -1 ? last : n)) as [number, number]
    sides.push({ id: side.id, name: side.name, ft: Math.round(total * 100) / 100, pieces, from: first, to: last, flip, gates: gateNos })
  }
  return { posts, sides }
}

/**
 * The sides in the order the crew walks them: from the start post along the fence, each side turned to start at
 * the post the crew is standing at, branches after the side they leave from; a fence line not joined to the start
 * is walked next from one of its own end posts.
 */
export function walkingOrder(plan: SitePlanData): Array<{ side: SiteSide; flip: boolean }> {
  const out: Array<{ side: SiteSide; flip: boolean }> = []
  const left = new Set(plan.sides.map(s => s.id))
  const at = (post: string) => plan.sides.filter(s => left.has(s.id) && (s.a === post || s.b === post))
  const walkFrom = (post: string) => {
    const stack = [post]
    while (stack.length) {
      const here = stack.pop()!
      const next = at(here)
      // Straight on first: the side that starts here as walked, then any other.
      next.sort((x, y) => Number(y.a === here) - Number(x.a === here))
      for (const side of next.reverse()) {
        if (!left.has(side.id)) continue
        left.delete(side.id)
        const flip = side.a !== here
        out.push({ side, flip })
        stack.push(flip ? side.a : side.b)
      }
      // Sides branching from a tee on a side just walked start at their own first post.
      for (const side of plan.sides) if (left.has(side.id) && side.teeFrom && out.some(o => o.side.id === side.teeFrom)) { left.delete(side.id); out.push({ side, flip: false }); stack.push(side.b) }
    }
  }
  const uses = new Map<string, number>()
  for (const s of plan.sides) for (const p of [s.a, s.b]) uses.set(p, (uses.get(p) ?? 0) + 1)
  if (plan.startPostId && uses.has(plan.startPostId)) walkFrom(plan.startPostId)
  while (left.size) {
    const rest = plan.sides.filter(s => left.has(s.id) && !s.teeFrom)
    const first = rest.find(s => uses.get(s.a) === 1 || uses.get(s.b) === 1) ?? rest[0] ?? plan.sides.find(s => left.has(s.id))!
    walkFrom(uses.get(first.a) === 1 || uses.get(first.b) !== 1 ? first.a : first.b)
  }
  return out
}

/** Sections in a piece of fence: the quote's own per-piece count when it has one, else whole sections at the width. */
export const sectionsAt = (pieceFt: number, widthFt: number) => (pieceFt > 0 ? Math.ceil(pieceFt / Math.max(1, widthFt) - 1e-9) : 0)

/**
 * Sections per piece for crewPosts from the quote: each quoted side's runs (the
 * yard's runs over 0 ft, in the order layout.runSections counts them) matched
 * to the plan's pieces by their feet (within a foot), so the crew spaces the
 * line posts as the quote counted them (the 6 or 8 ft pick per run, farm and
 * chain link spacing included). A piece no quoted run matches (a side added
 * or redrawn on the plan) gets whole sections at `widthFt`.
 */
export function quoteSectionsOf(plan: SitePlanData, yard: YardLayout | null, runSections: number[] | null | undefined, widthFt: number): (sideId: string, pieceFt: number) => number {
  const bySide = new Map<string, Array<{ ft: number; sections: number; used: boolean }>>()
  if (yard && Array.isArray(runSections)) {
    try {
      const runs = deriveLayout(yard).runs.filter(r => r.ft > 0)
      if (runs.length === runSections.length) runs.forEach((r, i) => {
        const list = bySide.get(r.sideId) ?? []
        list.push({ ft: r.ft, sections: Number(runSections[i]) || 0, used: false })
        bySide.set(r.sideId, list)
      })
    } catch { /* a yard that cannot be read: whole sections */ }
  }
  return (sideId, pieceFt) => {
    const side = plan.sides.find(s => s.id === sideId)
    const list = side?.yardSideId ? bySide.get(side.yardSideId) : undefined
    const fits = (r: { ft: number; sections: number; used: boolean }) => !r.used && r.sections > 0 && Math.abs(r.ft - pieceFt) <= 1
    // Its own side's run first; then a run of the same feet on any side (a change order's drawing names its sides its own way).
    const hit = list?.find(fits) ?? [...bySide.values()].flat().find(fits)
    if (hit) { hit.used = true; return hit.sections }
    return sectionsAt(pieceFt, widthFt)
  }
}

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
