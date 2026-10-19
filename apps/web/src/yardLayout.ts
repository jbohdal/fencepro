/**
 * Yard layout: the salesman describes the yard as named sides (Left return,
 * Back, ...) with a finish at each end, an optional gate and an optional skip,
 * and this module turns that into exactly what the quote has always taken:
 * run lengths, corner posts, end posts and gate counts. Pure, no React.
 *
 * Lengths are kept in inches so 80' 4" is exact; runs go out in feet.
 *
 * Posts:
 *   - a Corner joins a side to the next side that is on: 1 corner post, shared
 *   - every other finish (meets the house, ties into existing fence, stops
 *     here) is 1 end post
 *   - a gate adds a post on each side of it (counted as end posts)
 *   - a skip ("existing fence here" / "no fence here") splits the side; each
 *     piece gets its own end post at the skip, and the skip is not charged
 */

export type EndFinish = 'corner' | 'house' | 'existing' | 'free'
export type GateType = 'walk' | 'double'
export type GatePosition = 'middle' | 'start' | 'end' | 'distance'
export type YardShape = 'backyard' | 'perimeter' | 'front' | 'straight' | 'custom'

export type GateSwing = 'in' | 'out'
export type GateHinge = 'left' | 'right'

export interface SideGate {
  type: GateType
  /** Opening width in inches. */
  widthIn: number
  position: GatePosition
  /** For 'distance': inches from the start of the side to the gate. */
  distanceIn?: number
  /** Into the yard (default) or out, toward the street / outside the fence. Drawing and crew notes only. */
  swing?: GateSwing | null
  /** Walk gate: hinge post on the left or right, as seen from inside the yard
   *  facing the gate. Unset: the end nearest the house (else the side's start). */
  hinge?: GateHinge | null
  /** Double gate: each leaf set on its own (left / right as seen from inside). Unset: both use `swing`. */
  leafSwing?: { left: GateSwing; right: GateSwing } | null
}

export interface SideSkip {
  kind: 'existing' | 'none'
  lengthIn: number
  position: 'middle' | 'distance'
  /** For 'distance': inches from the start of the side to the skip. */
  distanceIn?: number
}

export interface YardSide {
  id: string
  name: string
  on: boolean
  lengthIn: number
  /** Ignored when the previous side joins this one with a corner. */
  startFinish: EndFinish
  /** 'corner' joins the next side that is on; with no next side it stops here. */
  endFinish: EndFinish
  gate?: SideGate | null
  skip?: SideSkip | null
  /** Drawing direction in degrees (0 = right, 90 = up the page), for the site plan. */
  heading?: number
  /** A backyard return: where it meets the house (drawing only). Back corner when unset. */
  meetsHouse?: HouseMeet | null
}

export interface HouseMeet {
  at: 'back' | 'front' | 'distance'
  /** For 'distance': inches from the house's back corner toward the street. */
  distanceIn?: number
}

/** Point on the site plan, in feet, y up. */
export interface PlanPoint { x: number; y: number }

export interface YardLayout {
  shape: YardShape
  /** Perimeter: the last side's end corner joins the first side's start. */
  closed: boolean
  sides: YardSide[]
  /** Counts typed over the top of what the layout counts. */
  cornersOverride?: number | null
  endsOverride?: number | null
  /** Site plan drawing: corners dragged by hand, and the aerial photo it sits on. */
  plan?: {
    points?: PlanPoint[] | null
    /** The measurements the dragged corners were drawn for (see layoutSignature).
     *  When the lengths change after, the drag no longer applies. Unset on the
     *  aerial photo, where corners are placed on the picture. */
    pointsFor?: string | null
    aerial?: { lat: number; lng: number; halfM: number; address: string } | null
    /** Compass heading (degrees) of "up the page", from standing at the house
     *  and pointing the phone at the back fence. Used without an aerial photo. */
    facingRef?: number | null
  } | null
}

/** What a saved quote keeps about its layout. */
export interface QuoteLayoutRecord {
  /** The yard as drawn; null for a quote typed as a run list. */
  yard: YardLayout | null
  /** Sections in each saved run, same order, as priced. */
  runSections: number[]
}

export const GATE_WIDTH_IN: Record<GateType, number> = { walk: 48, double: 120 }
export const GATE_LABEL: Record<GateType, string> = { walk: 'Walk gate', double: 'Double gate' }
export const FINISH_LABEL: Record<EndFinish, string> = {
  corner: 'Corner',
  house: 'Meets the house',
  existing: 'Ties into existing fence',
  free: 'Stops here',
}
/** "near the house", for gate positions. */
export const FINISH_NEAR: Record<EndFinish, string> = {
  corner: 'near the corner',
  house: 'near the house',
  existing: 'near the existing fence',
  free: 'near the end',
}

export const SHAPE_LABEL: Record<YardShape, string> = {
  backyard: 'Backyard',
  perimeter: 'Full perimeter',
  front: 'Front yard',
  straight: 'Straight line',
  custom: 'Custom',
}

let seq = 0
export function newSideId(): string {
  seq += 1
  return `s${Date.now().toString(36)}${seq}`
}

function side(name: string, startFinish: EndFinish, endFinish: EndFinish, heading: number): YardSide {
  return { id: newSideId(), name, on: true, lengthIn: 0, startFinish, endFinish, gate: null, skip: null, heading }
}

/** A new layout for a yard shape, sides in walking order. */
export function layoutForShape(shape: YardShape): YardLayout {
  switch (shape) {
    case 'backyard':
      return { shape, closed: false, sides: [
        side('Left return', 'house', 'corner', 180),
        side('Left side', 'corner', 'corner', 90),
        side('Back', 'corner', 'corner', 0),
        side('Right side', 'corner', 'corner', 270),
        side('Right return', 'corner', 'house', 180),
      ] }
    case 'perimeter':
      return { shape, closed: true, sides: [
        side('Front', 'corner', 'corner', 0),
        side('Right side', 'corner', 'corner', 90),
        side('Back', 'corner', 'corner', 180),
        side('Left side', 'corner', 'corner', 270),
      ] }
    case 'front':
      return { shape, closed: false, sides: [
        side('Left side', 'house', 'corner', 270),
        side('Front', 'corner', 'corner', 0),
        side('Right side', 'corner', 'house', 90),
      ] }
    case 'straight':
      return { shape, closed: false, sides: [side('Fence', 'free', 'free', 0)] }
    case 'custom':
      return { shape, closed: false, sides: [side('Side 1', 'free', 'free', 0)] }
  }
}

// ── Joins ─────────────────────────────────────────────────────────────────────

function prevIndex(layout: YardLayout, i: number): number | null {
  if (i > 0) return i - 1
  return layout.closed && layout.sides.length > 1 ? layout.sides.length - 1 : null
}
function nextIndex(layout: YardLayout, i: number): number | null {
  if (i < layout.sides.length - 1) return i + 1
  return layout.closed && layout.sides.length > 1 ? 0 : null
}

/**
 * True when side i's end is a corner shared with the next side: both are on
 * and the end is set to Corner. A side not measured yet still meets its
 * neighbor at a corner, so a new Backyard reads "Corner" at every join (not
 * "Stops here") and the corner posts count as soon as one side has a length.
 */
export function joinsNext(layout: YardLayout, i: number): boolean {
  const s = layout.sides[i], n = nextIndex(layout, i)
  return !!s?.on && s.endFinish === 'corner' && n !== null && n !== i && layout.sides[n].on
}
/** True when side i's start is a corner shared with the previous side. */
export function joinedFromPrev(layout: YardLayout, i: number): boolean {
  const p = prevIndex(layout, i)
  return p !== null && joinsNext(layout, p)
}

/** The finish that really applies at each end of side i. */
export function effectiveFinishes(layout: YardLayout, i: number): { start: EndFinish; end: EndFinish } {
  const s = layout.sides[i]
  const own = (f: EndFinish): EndFinish => (f === 'corner' ? 'free' : f)
  return {
    start: joinedFromPrev(layout, i) ? 'corner' : own(s.startFinish),
    end: joinsNext(layout, i) ? 'corner' : own(s.endFinish),
  }
}

/** Name of the side a corner at this end joins, for labels. */
export function neighborName(layout: YardLayout, i: number, which: 'start' | 'end'): string | null {
  const j = which === 'start' ? prevIndex(layout, i) : nextIndex(layout, i)
  return j === null ? null : layout.sides[j].name
}

// ── Turning a side into runs ──────────────────────────────────────────────────

export interface LayoutRun {
  /** Run length in feet, as the calculator takes it. */
  ft: number
  inches: number
  sideId: string
  sideName: string
  /** 1 based piece number within the side, and how many pieces it has. */
  piece: number
  pieces: number
}

export interface SideResult {
  sideId: string
  name: string
  on: boolean
  lengthIn: number
  /** Inches of fence actually charged on this side. */
  fenceIn: number
  runs: LayoutRun[]
  /** Where the gate starts (inches from the side's start), if it fits. */
  gateAtIn: number | null
  /** Inches from the side's start: each fence piece, the gate and the skip. */
  pieceSpans: Array<[number, number]>
  gateSpan: [number, number] | null
  skipSpan: [number, number] | null
  skipAtIn: number | null
  finishes: { start: EndFinish; end: EndFinish }
  /** Posts at the side's two ends, if anything touches them. */
  touchesStart: boolean
  touchesEnd: boolean
  /** Posts inside the side: gate posts and skip end posts. */
  gatePosts: number
  skipPosts: number
  notes: string[]
}

export interface LayoutResult {
  sides: SideResult[]
  runs: LayoutRun[]
  /** Posts counted from the finishes. */
  counted: { corners: number; endPosts: number; gatePosts: number }
  /** What goes to the calculator: counted, or the typed override. */
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  totalIn: number
  notes: string[]
}

const EPS = 0.01
const ftOf = (inches: number) => Math.round((inches / 12) * 1e6) / 1e6

/**
 * @param nearIn How far from an end a gate placed "near the house / corner"
 *   starts: one section width, so the short piece is one full section.
 */
export function deriveLayout(layout: YardLayout, nearIn = 96): LayoutResult {
  const sides: SideResult[] = layout.sides.map((s, i) => deriveSide(layout, i, nearIn))
  const runs = sides.flatMap(r => r.runs)

  let corners = 0, endPosts = 0, gatePosts = 0
  sides.forEach((r, i) => {
    if (!r.on) return
    const measured = r.lengthIn > 0
    // A shared corner is counted once, at the earlier side's end, when fence
    // reaches it from either side (the other side may not be measured yet).
    if (measured && r.finishes.start !== 'corner' && r.touchesStart) endPosts += 1
    if (r.finishes.end === 'corner') {
      const n = nextIndex(layout, i)!
      if (r.touchesEnd || sides[n].touchesStart) corners += 1
    } else if (measured && r.touchesEnd) endPosts += 1
    if (!measured) return
    gatePosts += r.gatePosts
    endPosts += r.skipPosts
  })

  const on = layout.sides.filter(s => s.on && s.lengthIn > 0)
  const walkGates = sides.filter(r => r.gateAtIn !== null && layout.sides.find(s => s.id === r.sideId)?.gate?.type === 'walk').length
  const dblGates = sides.filter(r => r.gateAtIn !== null && layout.sides.find(s => s.id === r.sideId)?.gate?.type === 'double').length
  const ov = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null)

  return {
    sides,
    runs,
    counted: { corners, endPosts, gatePosts },
    corners: ov(layout.cornersOverride) ?? corners,
    ends: ov(layout.endsOverride) ?? endPosts + gatePosts,
    walkGates,
    dblGates,
    totalIn: on.reduce((s, x) => s + x.lengthIn, 0),
    notes: sides.flatMap(r => r.notes.map(n => `${r.name}: ${n}`)),
  }
}

function deriveSide(layout: YardLayout, i: number, nearIn: number): SideResult {
  const s = layout.sides[i]
  const L = Math.max(0, s.lengthIn || 0)
  const finishes = effectiveFinishes(layout, i)
  const base: SideResult = {
    sideId: s.id, name: s.name, on: s.on, lengthIn: L, fenceIn: 0, runs: [], gateAtIn: null, skipAtIn: null,
    pieceSpans: [], gateSpan: null, skipSpan: null,
    finishes, touchesStart: false, touchesEnd: false, gatePosts: 0, skipPosts: 0, notes: [],
  }
  if (!s.on || L <= 0) return base

  // Cut-outs along the side: the gate opening and the skip.
  const cuts: Array<{ from: number; to: number; kind: 'gate' | 'skip' }> = []
  if (s.gate && s.gate.widthIn > 0) {
    const g = s.gate.widthIn
    if (g > L - EPS) {
      base.notes.push(`the ${GATE_LABEL[s.gate.type].toLowerCase()} (${formatFtIn(g)}) is wider than the side, so it was left off.`)
    } else {
      const near = Math.min(nearIn, L - g)
      const at = s.gate.position === 'start' ? near
        : s.gate.position === 'end' ? L - g - near
        : s.gate.position === 'distance' ? Math.min(Math.max(0, s.gate.distanceIn ?? 0), L - g)
        : (L - g) / 2
      cuts.push({ from: at, to: at + g, kind: 'gate' })
      base.gateAtIn = at
    }
  }
  if (s.skip && s.skip.lengthIn > 0) {
    const k = s.skip.lengthIn
    if (k > L - EPS) {
      base.notes.push('the skip is as long as the side, so it was left off.')
    } else {
      const at = s.skip.position === 'distance' ? Math.min(Math.max(0, s.skip.distanceIn ?? 0), L - k) : (L - k) / 2
      const gate = cuts[0]
      if (gate && at < gate.to - EPS && at + k > gate.from + EPS) {
        base.notes.push('the skip overlaps the gate, so the skip was left off.')
      } else {
        cuts.push({ from: at, to: at + k, kind: 'skip' })
        base.skipAtIn = at
      }
    }
  }
  cuts.sort((a, b) => a.from - b.from)

  // Fence pieces are what is left of [0, L] after the cuts.
  const pieces: Array<[number, number]> = []
  let pos = 0
  for (const c of cuts) {
    if (c.from - pos > EPS) pieces.push([pos, c.from])
    pos = Math.max(pos, c.to)
  }
  if (L - pos > EPS) pieces.push([pos, L])

  const touches = (x: number) => pieces.some(([a, b]) => Math.abs(a - x) < EPS || Math.abs(b - x) < EPS)
  const gate = cuts.find(c => c.kind === 'gate')
  const atGate = (x: number) => !!gate && (Math.abs(gate.from - x) < EPS || Math.abs(gate.to - x) < EPS)

  base.touchesStart = touches(0) || atGate(0)
  base.touchesEnd = touches(L) || atGate(L)
  // A gate hangs between two posts; one at a side end is that end's post.
  if (gate) base.gatePosts = [gate.from, gate.to].filter(x => x > EPS && x < L - EPS).length
  const skip = cuts.find(c => c.kind === 'skip')
  if (skip) base.skipPosts = [skip.from, skip.to].filter(x => x > EPS && x < L - EPS && touches(x) && !atGate(x)).length

  base.runs = pieces.map(([a, b], k) => ({
    ft: ftOf(b - a), inches: b - a, sideId: s.id, sideName: s.name, piece: k + 1, pieces: pieces.length,
  }))
  base.fenceIn = pieces.reduce((t, [a, b]) => t + (b - a), 0)
  base.pieceSpans = pieces
  base.gateSpan = gate ? [gate.from, gate.to] : null
  base.skipSpan = skip ? [skip.from, skip.to] : null
  return base
}

// ── Feet and inches ───────────────────────────────────────────────────────────

/** 966 → 80' 6". Fractions of an inch to the nearest 1/8. */
export function formatFtIn(inches: number): string {
  if (!Number.isFinite(inches) || inches <= 0) return `0'`
  let eighths = Math.round(inches * 8)
  const ft = Math.floor(eighths / 96)
  eighths -= ft * 96
  const whole = Math.floor(eighths / 8)
  const frac = eighths % 8
  const fracText = frac === 0 ? '' : ` ${reduce(frac, 8)}`
  if (whole === 0 && frac === 0) return `${ft}' 0"`
  return `${ft}' ${whole}${fracText}"`
}

function reduce(n: number, d: number): string {
  let a = n, b = d
  while (b) [a, b] = [b, a % b]
  return `${n / a}/${d / a}`
}

/** "80' 4\"", "80 4", "80'", "80.5" → inches; null when it can't be read. */
export function parseFtIn(text: string): number | null {
  const t = text.trim().replace(/[”″]/g, '"').replace(/[’′]/g, "'")
  if (!t) return null
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in)?)?$/i)
  if (!m) return null
  const ft = parseFloat(m[1]), inch = m[2] ? parseFloat(m[2]) : 0
  if (inch >= 12) return null
  return Math.round((ft * 12 + inch) * 8) / 8
}

/** Plan label length: whole feet as "13'", otherwise "13' 4\"". */
export function formatPieceLen(inches: number): string {
  return formatFtIn(inches).replace(/ 0"$/, '')
}

export interface SidePiece {
  kind: 'fence' | 'gate' | 'skip'
  /** Inches from the side's start. */
  fromIn: number
  toIn: number
  text: string
}

/**
 * The pieces a side is split into, in order along the side, labeled with
 * their own lengths ("13'", "14' double gate", "10' existing fence"). Taken
 * straight from deriveLayout's spans (the same ones the runs, sections and
 * posts come from). Empty when the side is not split (one piece, nothing to
 * add to the side's own label).
 */
export function sidePieces(side: Pick<YardSide, 'gate' | 'skip'>, r: Pick<SideResult, 'pieceSpans' | 'gateSpan' | 'skipSpan'>): SidePiece[] {
  if (!r.gateSpan && !r.skipSpan) return []
  const out: SidePiece[] = r.pieceSpans.map(([a, b]) => ({ kind: 'fence', fromIn: a, toIn: b, text: formatPieceLen(b - a) }))
  if (r.gateSpan && side.gate) {
    const [a, b] = r.gateSpan
    out.push({ kind: 'gate', fromIn: a, toIn: b, text: `${formatPieceLen(b - a)} ${side.gate.type === 'double' ? 'double gate' : 'walk gate'}` })
  }
  if (r.skipSpan && side.skip) {
    const [a, b] = r.skipSpan
    out.push({ kind: 'skip', fromIn: a, toIn: b, text: `${formatPieceLen(b - a)} ${side.skip.kind === 'existing' ? 'existing fence' : 'no fence'}` })
  }
  return out.sort((x, y) => x.fromIn - y.fromIn)
}

/** Post to post spacing when a run is split into evenly spaced sections. */
export function postSpacing(runFt: number, sections: number): string {
  if (!(runFt > 0) || !(sections > 0)) return ''
  return formatFtIn((runFt * 12) / sections)
}
