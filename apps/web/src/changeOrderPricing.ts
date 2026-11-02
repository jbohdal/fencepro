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
 * Jonathan, Nov 2 2026, on two things that rule left open:
 *
 *   "FULL NEW FABRIC"  a job sold in another style changed to chain link has no
 *            rolls sold, so nothing moves by the foot: the fabric is whole
 *            rolls for all its feet, as a new fence (changeBaseOf, feet null)
 *   "CREDIT IN FULL"   the price of a change is a matter of what the work is,
 *            never of how it got there: every change order prices from the
 *            sold job (soldBaseOf), so the gates over the sold count carry their
 *            2 posts in the work before a change as in the work after it. A
 *            gate taken out comes off at what it costs on the fence as it is
 *            now, whatever came between. Back at a state the job was already
 *            in, the contract is what it was in that state (backToState)
 *
 * A gate of the sold job taken out, or one swapped for another, prices as it
 * always has. The pull sheet, crew packet, Sales Order and a change order's
 * stored work and costDelta never come through here: they keep whole rolls
 * and the real post count (lib/changeOrderWork.ts priceWork).
 */

import { calculateQuote, isChainLink, type QuoteCalcInput, type QuoteRun, type QuoteStyle } from './quoteCalc'
import { calculateLinePostsPerRun } from './sectionCount'
import { priceMove, type MoveInputs, type NewLine, type WorkCommon } from './moveRepair'
import { deriveLayout, TYPED_DBL_GATE_FT, TYPED_WALK_GATE_FT, type TeePost, type YardLayout } from './yardLayout'

/** The work a change order starts from. */
export interface ChangeBase {
  /** Fence feet: fabric moves by the foot from here. Null: no chain link fabric was sold, so it is whole rolls. */
  feet: number | null
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

/** The change order's starting point: this work, in this style, and the drawing as it is now when it has one. */
export function changeBaseOf(before: WorkBefore, now?: ChangeNow | null, style?: Pick<QuoteStyle, 'category'> | null): ChangeBase {
  const runs = before.runs.map((ft, i) => ({ ft, rail: before.runRails?.[i] ?? ('auto' as const) }))
  const yard = before.layout?.yard
  return {
    feet: style && !isChainLink(style) ? null : Math.round(before.runs.reduce((t, f) => t + (f > 0 ? f : 0), 0) * 100) / 100,
    runs, ends: before.ends, walkGates: before.walkGates, dblGates: before.dblGates,
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
  // taken out with them (those are a credit). More than one way to put it back: the fewest.
  const closed = openingsClosed(input.runs, base.runs, gateOpeningFt(input, base), added)
  return { ends, linePosts: Math.max(0, Math.min(...closed.map(lineOf)) - lineNow) }
}

/**
 * The feet of fence the gates added take: their own widths when the input
 * carries them (a gate added comes last in the list, yardLayout.ts
 * fitGateWidths), else the typed defaults, 4 ft walk and 8 ft double.
 */
export function gateOpeningFt(input: Pick<QuoteCalcInput, 'walkGates' | 'dblGates' | 'gateWidths'>, before: { walkGates: number; dblGates: number }): number {
  const feet = (n: number, widths: number[] | undefined, typed: number) => {
    const added = Math.max(0, n)
    const given = added ? (widths ?? []).slice(-added) : []
    return given.reduce((t, w) => t + w, (added - given.length) * typed)
  }
  return feet(input.walkGates - before.walkGates, input.gateWidths?.walk, TYPED_WALK_GATE_FT) + feet(input.dblGates - before.dblGates, input.gateWidths?.dbl, TYPED_DBL_GATE_FT)
}

/**
 * A run list with its gates' openings closed, each way it can be read: a run
 * that changed gets the opening's feet back, with the pieces a gate cut it
 * into put back together. Fence added or taken out stays as it is now. No run
 * of the job changed: the gate is in fence that is new or was left alone, so
 * no line post went.
 */
function openingsClosed(now: QuoteRun[], before: QuoteRun[], openingFt: number, gates: number): QuoteRun[][] {
  const left = before.filter(r => r.ft > 0)
  const changed = now.filter(r => {
    if (!(r.ft > 0)) return false
    const i = left.findIndex(b => b.ft === r.ft)
    if (i >= 0) left.splice(i, 1)
    return i < 0
  })
  if (!changed.length || !left.length) return [now]
  const same = now.filter(r => !changed.includes(r))
  const pieces = Math.min(gates, Math.max(0, changed.length - left.length)) + 1
  return Array.from({ length: changed.length - pieces + 1 }, (_, i) => {
    const cut = changed.slice(i, i + pieces)
    return [...same, { ...cut[0], ft: cut.reduce((t, r) => t + r.ft, openingFt) }, ...changed.slice(0, i), ...changed.slice(i + pieces)]
  })
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

// ── The job's earlier states ─────────────────────────────────────────────────

/** The fence, gates and style of a state of the job. */
export interface WorkState {
  fenceStyle: string
  runs: number[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
}

/** An earlier change order as a later one reads it (ChangeOrders.tsx ChangeOrder). */
export interface EarlierOrder {
  number: number
  status: string
  totalCents: number
  scope?: { walkGates?: number; dblGates?: number; footageFt?: number; sections?: number; fromStyle?: string; toStyle?: string } | null
  /** The work after it. Typed lines keep none: they change the price, never the job's state. */
  work?: WorkState | null
  /** The job's work after it, when its change was put on another's. */
  jobWork?: WorkState | null
}

/** The change orders that made a state of the job, in order: never a void one, or one with typed lines only. */
export const workOrders = (orders: EarlierOrder[]) => orders.filter(o => o.status !== 'void' && o.work).sort((a, b) => a.number - b.number)
const stateOf = (o: EarlierOrder) => (o.jobWork ?? o.work)!
const stateKey = (w: WorkState) => JSON.stringify([w.fenceStyle, w.runs.filter(f => f > 0).sort((a, b) => a - b), w.corners, w.ends, w.walkGates, w.dblGates, w.tearOutSections, w.tearOutGates])

/**
 * What the contract moves by to come back to `now`, when the job was already
 * in it: the change orders since its last time there, undone, whatever they
 * were priced at. Null when it never was, or it is there still. Lines typed
 * since stay on the contract: they changed no state.
 */
export function backToState(orders: EarlierOrder[], sold: WorkState, was: WorkState, now: WorkState): number | null {
  const key = stateKey(now)
  if (key === stateKey(was)) return null
  const steps = workOrders(orders)
  const states = [sold, ...steps.map(stateOf)]
  const at = states.map(stateKey).lastIndexOf(key)
  return at < 0 ? null : -steps.slice(at).reduce((t, o) => t + o.totalCents, 0)
}

/**
 * The change order's starting point when every change is priced from the sold
 * job: the sold work, with its drawing against `now`. A job that changed style
 * since it was sold has the rolls of its last change to chain link, or none.
 */
export function soldBaseOf(sold: WorkBefore & { fenceStyle: string }, orders: EarlierOrder[], styles: Array<QuoteStyle>, now?: ChangeNow | null): ChangeBase {
  const chainLink = (name: string) => { const st = styles.find(s => s.name === name); return st ? isChainLink(st) : null }
  const base = changeBaseOf(sold, now, styles.find(s => s.name === sold.fenceStyle))
  let feet = base.feet, was = sold.fenceStyle
  for (const w of workOrders(orders).map(stateOf)) {
    const on = chainLink(w.fenceStyle)
    if (on === false) feet = null
    else if (on && chainLink(was) === false) feet = Math.round(w.runs.reduce((t, f) => t + (f > 0 ? f : 0), 0) * 100) / 100
    was = w.fenceStyle
  }
  return { ...base, feet }
}
