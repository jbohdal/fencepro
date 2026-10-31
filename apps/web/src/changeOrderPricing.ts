/**
 * What a change order charges for fence and gates on a sold job (Jonathan,
 * Oct 31 2026: "Chain link change orders: price fabric by the foot, not whole
 * rolls." "Added gate: 2 new gate posts."). Change orders price a change as
 * the new work minus the work before it through the quote's own math, with
 * two things changed on the input (price only). Every login that makes change
 * orders sees costs, a Salesman too, so new fence is priced in the browser on
 * the step lines (changeOrderDraft.ts) and a move's one price difference line
 * by changeOrderPrice there. The server's changePrice (quoteJob.ts) is for a
 * login that sees prices only; none makes change orders today.
 *
 *
 *   fabric   the rolls the job was sold with, then N feet moves N/50 of a roll,
 *            both ways (quoteCalc.ts fabricFromFt); chain link only
 *   gates    each gate added has 2 new gate posts, however it was entered:
 *            end posts added when the work doesn't count 2 (a gate typed on a
 *            run list, or set at a side's end), and no credit for the line
 *            posts its opening drops from a side that was already there
 *
 * Gates added are net: a gate taken out, or swapped for another, prices as it
 * always has. The pull sheet, crew packet, Sales Order and a change order's
 * stored work and costDelta never come through here: they keep whole rolls
 * and the real post count (lib/changeOrderWork.ts priceWork).
 */

import { calculateQuote, type QuoteCalcInput, type QuoteRun } from './quoteCalc'
import { calculateLinePostsPerRun } from './sectionCount'
import { priceMove, type MoveInputs, type NewLine, type WorkCommon } from './moveRepair'
import { deriveLayout, TYPED_DBL_GATE_FT, TYPED_WALK_GATE_FT, type TeePost, type YardLayout } from './yardLayout'

/** The work a change order starts from. */
export interface ChangeBase {
  /** Fence feet: fabric moves by the foot from here. */
  feet: number
  runs: QuoteRun[]
  ends: number
  walkGates: number
  dblGates: number
  /** From the drawing (gateOpenings below); null: a run list. */
  drawn?: DrawnGates | null
}

/** A change made on the drawing. */
export interface DrawnGates {
  /**
   * The fence now with the new gates' openings closed, on sides that were
   * already there. `from`: the run now of its first piece, whose rail it keeps.
   */
  gateRuns: Array<{ ft: number; from: number }>
  /** The posts the drawing counts for the new gates (a gate at a side's end counts 1: the end's post is the other). */
  gatePosts: number
}

/** The drawing as it is now. */
export interface ChangeNow { yard: YardLayout; nearIn: number; teeAs: TeePost }

interface WorkBefore {
  runs: number[]
  runRails?: Array<QuoteRun['rail']> | null
  ends: number
  walkGates: number
  dblGates: number
  layout?: { yard?: YardLayout | null } | null
}

function gateOpenings(before: YardLayout, now: ChangeNow): DrawnGates | null {
  // Ends typed over the drawing's count: it no longer says which posts are the gates'.
  if (typeof now.yard.endsOverride === 'number') return null
  const was = new Map(before.sides.map(s => [s.id, s]))
  const opts = { teeAs: now.teeAs }
  const isNew = (id: string) => { const b = was.get(id); return !(b?.on && b.gate) }
  const drawnNow = deriveLayout(now.yard, now.nearIn, opts)
  const gatePosts = drawnNow.sides.filter(r => r.gateAtIn !== null && isNew(r.sideId)).reduce((t, r) => t + r.gatePosts, 0)
  const closed = now.yard.sides.map(s => {
    const b = was.get(s.id)
    return s.gate && isNew(s.id) && b?.on && b.lengthIn > 0 ? { ...s, gate: null } : s
  })
  const whole = deriveLayout({ ...now.yard, sides: closed }, now.nearIn, opts)
  const firstPiece = (sideId: string, span: [number, number] | undefined) => {
    const piece = drawnNow.sides.find(r => r.sideId === sideId)?.pieceSpans.findIndex(([a]) => !!span && a >= span[0] - 0.01 && a < span[1]) ?? -1
    return drawnNow.runs.findIndex(r => r.sideId === sideId && r.piece === piece + 1)
  }
  return { gatePosts, gateRuns: whole.runs.map(r => ({ ft: r.ft, from: firstPiece(r.sideId, whole.sides.find(x => x.sideId === r.sideId)?.pieceSpans[r.piece - 1]) })) }
}

/** The change order's starting point: this work, and the drawing as it is now when it has one. */
export function changeBaseOf(before: WorkBefore, now?: ChangeNow | null): ChangeBase {
  const runs = before.runs.map((ft, i) => ({ ft, rail: before.runRails?.[i] ?? ('auto' as const) }))
  const yard = before.layout?.yard
  return {
    feet: Math.round(before.runs.reduce((t, f) => t + (f > 0 ? f : 0), 0) * 100) / 100, runs, ends: before.ends, walkGates: before.walkGates, dblGates: before.dblGates,
    drawn: yard?.sides && now ? gateOpenings(yard, now) : null,
  }
}

/** The posts to price beyond the work's own count so each gate added has 2 new gate posts. */
export function gatePostsOf(input: QuoteCalcInput, base: ChangeBase): { ends: number; linePosts: number } {
  const added = Math.max(0, input.walkGates + input.dblGates - base.walkGates - base.dblGates)
  if (!added || !input.style) return { ends: 0, linePosts: 0 }
  const lineOf = (runs: QuoteRun[]) => calculateLinePostsPerRun(calculateQuote({ ...input, runs }).perRunSections.filter(n => n > 0)).reduce((t, n) => t + n, 0)
  const lineNow = lineOf(input.runs)
  const counted = base.drawn ? base.drawn.gatePosts : Math.max(0, input.ends - base.ends)
  const ends = Math.max(0, 2 * added - counted)
  if (base.drawn) return { ends, linePosts: Math.max(0, lineOf(base.drawn.gateRuns.map(r => ({ ft: r.ft, rail: input.runs[r.from]?.rail ?? 'auto' }))) - lineNow) }
  // A run list doesn't say which feet are the gates': the line posts its gates' openings drop, never the fence's
  // taken out with them (those are a credit), and never more than the job really lost.
  const openingFt = Math.max(0, input.walkGates - base.walkGates) * TYPED_WALK_GATE_FT + Math.max(0, input.dblGates - base.dblGates) * TYPED_DBL_GATE_FT
  return { ends, linePosts: Math.max(0, Math.min(lineOf(base.runs), lineOf(openingsClosed(input.runs, base.runs, openingFt))) - lineNow) }
}

/**
 * A run list with its gates' openings closed: the runs that changed, with the
 * pieces a gate cut a run into put back together and the openings' feet back
 * in. The rest of what changed is fence added or taken out, and stays out.
 */
function openingsClosed(now: QuoteRun[], before: QuoteRun[], openingFt: number): QuoteRun[] {
  const left = before.filter(r => r.ft > 0)
  const changed = now.filter(r => {
    if (!(r.ft > 0)) return false
    const i = left.findIndex(b => b.ft === r.ft)
    if (i >= 0) left.splice(i, 1)
    return i < 0
  })
  if (!changed.length) return now
  const pieces = changed.slice(0, Math.max(1, changed.length - left.length + 1))
  const same = now.filter(r => !changed.includes(r))
  return [...same, { ...pieces[0], ft: pieces.reduce((t, r) => t + r.ft, openingFt) }, ...changed.slice(pieces.length)]
}

/** The quote's input as a change order prices it. */
export function changeOrderInput(input: QuoteCalcInput, base: ChangeBase): QuoteCalcInput {
  const p = gatePostsOf(input, base)
  return {
    ...input, fabricFromFt: base.feet, ends: input.ends + p.ends,
    ...(p.linePosts ? { extraLinePosts: (input.extraLinePosts ?? 0) + p.linePosts } : {}),
  }
}

/** The new version's price as a change order prices it (dollars). `move`: a move's new line and inputs. */
export function changeOrderPrice(input: QuoteCalcInput, base: ChangeBase, move?: { common: WorkCommon; inputs: MoveInputs; line: NewLine } | null): number {
  if (!move) return calculateQuote(changeOrderInput(input, base)).priced.price
  const p = gatePostsOf(input, base)
  return priceMove({ ...move.common, fabricFromFt: base.feet }, move.inputs, { ...move.line, ends: move.line.ends + p.ends, ...(p.linePosts ? { extraLinePosts: p.linePosts } : {}) }).priceCents / 100
}
