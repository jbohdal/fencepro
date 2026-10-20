/**
 * Sliding a gate along its side, in the quote builder's own gate model
 * (yardLayout.ts SideGate). One set of rules for the website quote now and the
 * quote builder, proposal drawing and crew packet later:
 *
 *   - where a gate is now: the builder's own placement (deriveLayout's
 *     gateAtIn), whatever its position kind (middle, near an end, a distance);
 *   - a slid gate is saved as position 'distance' with distanceIn = inches from
 *     the side's start to the gate's first post: exactly what the builder reads;
 *   - it stays on its side ([0, length - width]) and never overlaps a skip (or,
 *     when given, other gates). Clearance 0: it may touch an end or a corner,
 *     as the builder already allows (the end post is then the gate post);
 *   - the start snaps to whole feet (or half feet);
 *   - distance from the start and distance to the end, either way round;
 *   - a new width keeps the gate's middle where it was, re-clamped;
 *   - the two pieces either side, and their sections (per piece, rounded up).
 *
 * Nothing here prices: the pieces are priced as their own runs by the
 * builder's existing split for a gate (deriveLayout), so a moved gate prices
 * exactly as the builder prices that layout. Moving a gate never changes the
 * side's length, so the footage total never changes.
 */

import { deriveLayout, effectiveFinishes, neighborName, formatPieceLen, type SideGate, type YardLayout } from './yardLayout'
import { sectionsForRun } from './sectionCount'

export interface Span { fromIn: number; toIn: number }

/** Snap steps, inches. */
export const STEP_FOOT = 12
export const STEP_HALF_FOOT = 6

/** Where side i's gate starts now (inches from the side's start), as the builder places it; null when it has none or it does not fit. */
export function gateStartIn(layout: YardLayout, i: number, nearIn = 96): number | null {
  return deriveLayout(layout, nearIn).sides[i]?.gateAtIn ?? null
}

/** The other things on the side a gate must not overlap: its skip (and other gates, when a side ever has more than one). */
export function obstaclesOf(layout: YardLayout, i: number, nearIn = 96): Span[] {
  const r = deriveLayout(layout, nearIn).sides[i]
  return r?.skipSpan ? [{ fromIn: r.skipSpan[0], toIn: r.skipSpan[1] }] : []
}

/** Where a gate of `widthIn` may start on a side of `lengthIn`, around `obstacles`: the free stretches, as start ranges. */
export function startRanges(lengthIn: number, widthIn: number, obstacles: Span[] = []): Span[] {
  if (!(lengthIn > 0) || !(widthIn > 0) || widthIn > lengthIn) return []
  const blocks = [...obstacles].sort((a, b) => a.fromIn - b.fromIn)
  const out: Span[] = []
  let pos = 0
  for (const b of blocks) {
    if (b.fromIn - pos >= widthIn) out.push({ fromIn: pos, toIn: b.fromIn - widthIn })
    pos = Math.max(pos, b.toIn)
  }
  if (lengthIn - pos >= widthIn) out.push({ fromIn: pos, toIn: lengthIn - widthIn })
  return out
}

/** The allowed start nearest to `startIn` (no snapping). */
export function clampStart(startIn: number, lengthIn: number, widthIn: number, obstacles: Span[] = []): number | null {
  const ranges = startRanges(lengthIn, widthIn, obstacles)
  if (!ranges.length) return null
  let best = ranges[0].fromIn, bestD = Infinity
  for (const r of ranges) {
    const v = Math.min(Math.max(startIn, r.fromIn), r.toIn)
    const d = Math.abs(v - startIn)
    if (d < bestD) { bestD = d; best = v }
  }
  return best
}

/** The start snapped to `stepIn` (whole feet by default) and kept allowed; a stretch shorter than a step keeps the exact allowed spot. */
export function snapStart(startIn: number, lengthIn: number, widthIn: number, obstacles: Span[] = [], stepIn = STEP_FOOT): number | null {
  const c = clampStart(startIn, lengthIn, widthIn, obstacles)
  if (c === null) return null
  const ranges = startRanges(lengthIn, widthIn, obstacles)
  const r = ranges.find(x => c >= x.fromIn - 1e-9 && c <= x.toIn + 1e-9)!
  // Pushed against an end, a corner or the skip: flush with it, even off the step.
  if (Math.abs(c - r.fromIn) < 1e-9 && startIn <= r.fromIn) return c
  if (Math.abs(c - r.toIn) < 1e-9 && startIn >= r.toIn) return c
  const near = Math.round(c / stepIn) * stepIn
  if (near >= r.fromIn - 1e-9 && near <= r.toIn + 1e-9) return near
  // Past the end of the stretch: the last whole step inside it; before its start: the first.
  const inside = near > r.toIn ? Math.floor((r.toIn + 1e-9) / stepIn) * stepIn : Math.ceil((r.fromIn - 1e-9) / stepIn) * stepIn
  return inside >= r.fromIn - 1e-9 && inside <= r.toIn + 1e-9 ? inside : c
}

/** Inches before the gate (from the side's start) and after it (to the side's end). */
export function gateDistances(lengthIn: number, startIn: number, widthIn: number): { beforeIn: number; afterIn: number } {
  return { beforeIn: startIn, afterIn: Math.max(0, lengthIn - startIn - widthIn) }
}

/** The start for a gate that ends `afterIn` from the side's end ("12 ft from the corner" measured from the far end). */
export function startFromEnd(lengthIn: number, widthIn: number, afterIn: number): number {
  return lengthIn - widthIn - afterIn
}

/** The gate saved where it was slid to: position 'distance', what the builder reads. */
export function placeGate(gate: SideGate, startIn: number): SideGate {
  return { ...gate, position: 'distance', distanceIn: Math.round(startIn * 8) / 8 }
}

/**
 * Side i's gate slid so it starts at `startIn` (snapped, kept on the side and
 * off its skip). Returns the new layout; the same layout when the side has no
 * gate or nothing fits.
 */
export function slideGate(layout: YardLayout, i: number, startIn: number, opts: { stepIn?: number; nearIn?: number; exact?: boolean } = {}): YardLayout {
  const s = layout.sides[i]
  if (!s?.gate || !(s.lengthIn > 0)) return layout
  const obstacles = obstaclesOf(layout, i, opts.nearIn)
  // Typed: the exact distance (kept on the side and off the skip), not snapped.
  const at = opts.exact ? clampStart(startIn, s.lengthIn, s.gate.widthIn, obstacles) : snapStart(startIn, s.lengthIn, s.gate.widthIn, obstacles, opts.stepIn ?? STEP_FOOT)
  if (at === null) return layout
  return { ...layout, sides: layout.sides.map((x, k) => (k === i ? { ...x, gate: placeGate(x.gate!, at) } : x)) }
}

/** Side i's gate placed so it ends `afterIn` from the side's end (typed: "31 ft to the corner"), exact. */
export function slideGateFromEnd(layout: YardLayout, i: number, afterIn: number, opts: { nearIn?: number } = {}): YardLayout {
  const s = layout.sides[i]
  if (!s?.gate || !(s.lengthIn > 0)) return layout
  return slideGate(layout, i, startFromEnd(s.lengthIn, s.gate.widthIn, afterIn), { ...opts, exact: true })
}

/** True when the two layouts place side i's gate at the same spot (a drag step that changed nothing). */
export function sameGateSpot(a: YardLayout, b: YardLayout, i: number, nearIn = 96): boolean {
  const x = a.sides[i]?.gate, y = b.sides[i]?.gate
  if (!x || !y) return x === y
  return x.widthIn === y.widthIn && Math.abs((gateStartIn(a, i, nearIn) ?? -1) - (gateStartIn(b, i, nearIn) ?? -1)) < 1e-9
}

/** "12 ft", "12.5 ft"; anything else as feet and inches ("12' 4\""). */
export function ftText(inches: number): string {
  const ft = inches / 12
  if (Math.abs(ft * 2 - Math.round(ft * 2)) < 1e-6) return `${Math.round(ft * 2) / 2} ft`
  return formatPieceLen(inches)
}

/** What is at one end of side i, for the crew: "the house", "the Back corner", "the existing fence", "the end". */
export function sideEndName(layout: YardLayout, i: number, which: 'start' | 'end'): string {
  const f = effectiveFinishes(layout, i)[which]
  if (f === 'house') return 'the house'
  if (f === 'existing') return 'the existing fence'
  if (f === 'corner') { const n = neighborName(layout, i, which); return n ? `the ${n} corner` : 'the corner' }
  return 'the end'
}

/**
 * Where side i's gate is, both ways, with the side's real end names:
 * "5 ft walk gate, 12 ft from the Left side corner, 31 ft to the Right side corner".
 * Null when the side has no gate (or it does not fit).
 */
export function gateWhereText(layout: YardLayout, i: number, nearIn = 96): string | null {
  const s = layout.sides[i]
  const at = gateStartIn(layout, i, nearIn)
  if (!s?.gate || at === null) return null
  const d = gateDistances(s.lengthIn, at, s.gate.widthIn)
  const kind = s.gate.type === 'double' ? 'double gate' : 'walk gate'
  const before = d.beforeIn > 0.01 ? `${ftText(d.beforeIn)} from ${sideEndName(layout, i, 'start')}` : `right at ${sideEndName(layout, i, 'start')}`
  const after = d.afterIn > 0.01 ? `${ftText(d.afterIn)} to ${sideEndName(layout, i, 'end')}` : `right at ${sideEndName(layout, i, 'end')}`
  return `${ftText(s.gate.widthIn)} ${kind}, ${before}, ${after}`
}

/**
 * Side i's gate made `widthIn` wide, its middle where it was (then snapped and
 * re-clamped so it stays on the side and off the skip).
 */
export function resizeGate(layout: YardLayout, i: number, widthIn: number, opts: { stepIn?: number; nearIn?: number; snap?: boolean } = {}): YardLayout {
  const s = layout.sides[i]
  if (!s?.gate) return layout
  const was = gateStartIn(layout, i, opts.nearIn)
  const mid = was === null ? s.lengthIn / 2 : was + s.gate.widthIn / 2
  const obstacles = obstaclesOf(layout, i, opts.nearIn)
  const raw = mid - widthIn / 2
  const at = opts.snap === false ? clampStart(raw, s.lengthIn, widthIn, obstacles) : snapStart(raw, s.lengthIn, widthIn, obstacles, opts.stepIn ?? STEP_FOOT)
  const gate: SideGate = { ...s.gate, widthIn }
  return { ...layout, sides: layout.sides.map((x, k) => (k === i ? { ...x, gate: at === null ? gate : placeGate(gate, at) } : x)) }
}

/** The pieces either side of side i's gate and their sections at `widthFt` sections (each piece rounded up on its own). */
export function gatePieces(layout: YardLayout, i: number, widthFt: number, nearIn = 96): { beforeIn: number; afterIn: number; beforeSections: number; afterSections: number } | null {
  const s = layout.sides[i]
  const at = gateStartIn(layout, i, nearIn)
  if (!s?.gate || at === null) return null
  const d = gateDistances(s.lengthIn, at, s.gate.widthIn)
  return { ...d, beforeSections: d.beforeIn > 0 ? sectionsForRun(d.beforeIn / 12, widthFt) : 0, afterSections: d.afterIn > 0 ? sectionsForRun(d.afterIn / 12, widthFt) : 0 }
}

/** "12 ft ← [5 ft gate] → 31 ft" */
export function gateDistanceText(beforeIn: number, widthIn: number, afterIn: number, half = false): string {
  const f = (inches: number) => { const v = half ? Math.round(inches / 6) / 2 : Math.round(inches / 12); return `${v} ft` }
  return `${f(beforeIn)} ← [${f(widthIn)} gate] → ${f(afterIn)}`
}

/** The same, with typed distances shown as they are ("12' 4\" ← [5 ft gate] → 30' 8\""). */
export function gateDistanceTextExact(beforeIn: number, widthIn: number, afterIn: number): string {
  return `${ftText(beforeIn)} ← [${ftText(widthIn)} gate] → ${ftText(afterIn)}`
}
