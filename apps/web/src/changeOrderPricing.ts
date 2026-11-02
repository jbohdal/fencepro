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
 *   "CREDIT IN FULL"   a gate added keeps its 2 posts when it goes: a change
 *            order that takes a gate out or changes the style prices the job
 *            with the posts the gates over the sold count were charged
 *            (gatesOnJob), so the gate comes off at what it costs on the fence
 *            as it is now, whatever came between. Back at a state the job was
 *            already in, in the order the work really happened, the contract
 *            is what it was in that state (backToState)
 *
 * A gate of the sold job taken out, or one swapped for another, prices as it
 * always has. The pull sheet, crew packet, Sales Order and a change order's
 * stored work and costDelta never come through here: they keep whole rolls
 * and the real post count (lib/changeOrderWork.ts priceWork).
 */

import { calculateQuote, isChainLink, type QuoteCalcInput, type QuoteRun, type QuoteStyle } from './quoteCalc'
import { calculateLinePostsPerRun } from './sectionCount'
import { priceMove, type MoveInputs, type NewLine, type WorkCommon } from './moveRepair'
import { deriveLayout, gateWidthsOf, teePostFor, TYPED_DBL_GATE_FT, TYPED_WALK_GATE_FT, type TeePost, type YardLayout } from './yardLayout'

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

/** The fence, gates and style of a state of the job: a saved quote, a change order's work, or the server's shape of it. */
export interface WorkState {
  fenceStyle: string
  runs: number[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
  yard?: YardLayout | null
  gateWidths?: { walk: number[]; dbl: number[] } | null
  layout?: { yard?: YardLayout | null; gateWidths?: { walk: number[]; dbl: number[] } | null } | null
}

/** An earlier change order as a later one reads it (ChangeOrders.tsx ChangeOrder). */
export interface EarlierOrder {
  number: number
  status: string
  totalCents: number
  approvedAt?: string | null
  /** `fromChange`: the line came from the change itself, not typed beside it. */
  lines?: Array<{ amountCents: number; fromChange?: boolean; source?: { ref: string } | null }>
  scope?: { walkGates?: number; dblGates?: number; footageFt?: number; sections?: number; fromStyle?: string; toStyle?: string } | null
  /** The work after it. Typed lines keep none: they change the price, never the job's state. */
  work?: WorkState | null
  /** The job's work after it, when its change was put on another's. */
  jobWork?: WorkState | null
}

/** The server's word on the job's states after each change order (lib/changeOrderWork.ts foldShapes): never a void one's work, in any state. */
export interface FoldedState { number: number; state: WorkState }

/** The job's earlier change orders. */
export interface JobHistory { orders: EarlierOrder[]; states?: FoldedState[] | null }

/** A change order and the job's state after it. */
export interface JobStep { order: EarlierOrder; state: WorkState }

/**
 * The change orders that made a state of the job, in the order the work really
 * happened: signed ones in the order they were signed, then open ones. Never a
 * void one, or one with typed lines only. The server's fold when there is one.
 */
export const workOrders = (orders: EarlierOrder[]) => {
  const live = orders.filter(o => o.status !== 'void' && o.work)
  const signed = live.filter(o => o.status === 'approved').sort((a, b) => (a.approvedAt ?? '').localeCompare(b.approvedAt ?? '') || a.number - b.number)
  return [...signed, ...live.filter(o => o.status !== 'approved').sort((a, b) => a.number - b.number)]
}
export function jobSteps(h: JobHistory): JobStep[] {
  if (h.states) return h.states.flatMap(x => { const order = h.orders.find(o => o.number === x.number); return order && order.status !== 'void' ? [{ order, state: x.state }] : [] })
  return workOrders(h.orders).map(order => ({ order, state: (order.jobWork ?? order.work)! }))
}

/** What a change order's own change was priced at: not the lines typed beside it, which stay on the contract. */
function changeCents(o: EarlierOrder): number {
  const cents = (ls: NonNullable<EarlierOrder['lines']>) => ls.reduce((t, l) => t + l.amountCents, 0)
  const ls = o.lines ?? []
  const own = ls.filter(l => l.fromChange), picked = ls.filter(l => l.source?.ref.startsWith('add:'))
  return own.length ? cents(own) : picked.length ? cents(picked) : o.totalCents
}

const yardOf = (w: Pick<WorkState, 'yard' | 'layout'>) => w.yard ?? w.layout?.yard ?? null
function widthsOf(w: Pick<WorkState, 'yard' | 'layout' | 'gateWidths'>) {
  const yard = yardOf(w)
  return yard ? gateWidthsOf(yard) : w.gateWidths ?? w.layout?.gateWidths ?? null
}
/** A gate's width is part of the state: 4 ft then 6 ft is not back where it was. No width kept: the typed defaults. */
function gatesKey(walk: number, dbl: number, w: { walk: number[]; dbl: number[] } | null | undefined) {
  const list = (n: number, a: number[] | undefined, typed: number) => Array.from({ length: n }, (_, i) => a?.[i] ?? typed).sort((x, y) => x - y)
  return [list(walk, w?.walk, TYPED_WALK_GATE_FT), list(dbl, w?.dbl, TYPED_DBL_GATE_FT)]
}
const stateKey = (w: WorkState) => JSON.stringify([w.fenceStyle, w.runs.filter(f => f > 0).sort((a, b) => a - b), w.corners, w.ends, gatesKey(w.walkGates, w.dblGates, widthsOf(w)), w.tearOutSections, w.tearOutGates])

/**
 * What the contract moves by to come back to `now`, when the job was already
 * in it: the change orders since its last time there, undone, whatever they
 * were priced at. Null when it never was, or it is there still. Lines typed
 * since stay on the contract: they changed no state.
 */
export function backToState(steps: JobStep[], sold: WorkState, was: WorkState, now: WorkState): number | null {
  const key = stateKey(now)
  if (key === stateKey(was)) return null
  const at = [sold, ...steps.map(x => x.state)].map(stateKey).lastIndexOf(key)
  return at < 0 ? null : -steps.slice(at).reduce((t, x) => t + changeCents(x.order), 0)
}

/** The feet a job's chain link fabric moves from: the sold length, or the length at its last change to chain link. Null: none now. */
export function fabricFeet(steps: JobStep[], sold: WorkState, styles: QuoteStyle[]): number | null {
  const chain = (name: string) => { const st = styles.find(s => s.name === name); return st ? isChainLink(st) : false }
  const feet = (w: WorkState) => Math.round(w.runs.reduce((t, f) => t + (f > 0 ? f : 0), 0) * 100) / 100
  let from = chain(sold.fenceStyle) ? feet(sold) : null, was = sold
  for (const { state } of steps) {
    if (!chain(state.fenceStyle)) from = null
    else if (!chain(was.fenceStyle)) from = feet(state)
    was = state
  }
  return from
}

/**
 * A gate over the sold count: the posts it was priced with beyond the work's
 * own, the change orders that charged for it, what they charged (null: one
 * changed more than gates) and what the same change comes to at today's prices,
 * so a price typed by hand or a cost change since can be told from a longer fence.
 */
export interface GateOnJob { kind: 'walk' | 'double'; ends: number; linePosts: number; numbers: number[]; cents: number | null; todayCents: number; side?: string; whole?: boolean }

/** Which gates go, by kind: on a drawing the sides that lost theirs, else the newest. */
export function gatesGoing(on: GateOnJob[], out: { walk: number; dbl: number }, yardNow?: YardLayout | null): GateOnJob[] {
  const gated = new Set((yardNow?.sides ?? []).filter(s => s.on && s.gate).map(s => s.id))
  const take = (kind: GateOnJob['kind'], n: number) => {
    const all = on.filter(g => g.kind === kind)
    const bySide = yardNow ? all.filter(g => g.side && !gated.has(g.side)) : []
    return [...bySide, ...all.filter(g => !bySide.includes(g)).reverse()].slice(0, Math.max(0, n))
  }
  return [...take('walk', out.walk), ...take('double', out.dbl)]
}

/** What a change does to the gates by kind: a gate out and one of the other kind in is a swap, the same gate on the job. */
export function gateChange(was: Pick<WorkState, 'walkGates' | 'dblGates'>, now: Pick<WorkState, 'walkGates' | 'dblGates'>) {
  const walk = now.walkGates - was.walkGates, dbl = now.dblGates - was.dblGates
  const toDbl = Math.min(Math.max(0, -walk), Math.max(0, dbl)), toWalk = Math.min(Math.max(0, walk), Math.max(0, -dbl))
  return { toDbl, toWalk, out: { walk: Math.max(0, -walk) - toDbl, dbl: Math.max(0, -dbl) - toWalk }, added: Math.max(0, walk) - toWalk + Math.max(0, dbl) - toDbl }
}

/** The gates over the sold count still on the job, oldest first. */
export function gatesOnJob(steps: JobStep[], sold: WorkState, like: QuoteCalcInput, styles: QuoteStyle[]): GateOnJob[] {
  let on: GateOnJob[] = []
  let prev = sold
  for (const { order, state } of steps) {
    const c = gateChange(prev, state), yard = yardOf(state), yardBefore = yardOf(prev)
    const going = gatesGoing(on, c.out, yard)
    on = on.filter(g => !going.includes(g))
    const style = styles.find(s => s.name === state.fenceStyle)
    const nearIn = (style?.panelWidth ?? 6) * 12, teeAs = style ? teePostFor(style) : ('line' as TeePost)
    const baseFor = (y: YardLayout | null) => changeBaseOf({ ...prev, layout: { yard: yardBefore } }, y ? { yard: y, nearIn, teeAs } : null, styles.find(s => s.name === prev.fenceStyle))
    const inputOf = (w: Pick<QuoteCalcInput, 'runs' | 'corners' | 'ends' | 'walkGates' | 'dblGates' | 'gateWidths'>, st = style) => ({ ...like, style: st, ...w })
    const stateInput = (w: WorkState, st = style) => inputOf({ runs: w.runs.map(ft => ({ ft, rail: 'auto' as const })), corners: w.corners, ends: w.ends, walkGates: w.walkGates, dblGates: w.dblGates, gateWidths: widthsOf(w) }, st)
    const changed = c.added + c.toDbl + c.toWalk
    if (changed) {
      const s = order.scope ?? {}, picked = order.lines?.some(l => l.source?.ref.startsWith('add:'))
      const own = changeCents(order)
      const cents = !s.toStyle && !((s.footageFt ?? 0) > 0) ? own / changed : null
      const whole = (i: QuoteCalcInput) => { const { finalPrice, ...o } = i.overrides ?? {}; void finalPrice; return Math.round(calculateQuote({ ...i, overrides: { ...o, wholeDollar: true } }).priced.price * 100) }
      // Today's price of that same change: a picked gate has its own price list.
      const todayCents = cents === null || picked || !style ? (cents ?? 0) : (whole(changeOrderInput(stateInput(state), baseFor(yard))) - whole(changeOrderInput(stateInput(prev), baseFor(null)))) / changed
      // A swap: the same gate on the job, its posts kept, the change's price on top of what it charged.
      const swap = (from: GateOnJob['kind'], kind: GateOnJob['kind'], n: number) => {
        for (const g of [...gatesGoing(on, from === 'walk' ? { walk: n, dbl: 0 } : { walk: 0, dbl: n })]) {
          on = on.map(x => (x === g ? { ...x, kind, numbers: [...x.numbers, order.number], cents: x.cents === null || cents === null ? null : x.cents + cents, todayCents: x.todayCents + todayCents, whole: false } : x))
        }
      }
      swap('walk', 'double', c.toDbl)
      swap('double', 'walk', c.toWalk)
      const had = new Set((yardBefore?.sides ?? []).filter(x => x.on && x.gate).map(x => x.id))
      const added = yard && yardBefore ? yard.sides.filter(x => x.on && x.gate && !had.has(x.id)) : []
      const entry = { numbers: [order.number], cents, todayCents, whole: changed === 1 }
      if (style && c.added && added.length === c.added) {
        // Each gate by its own side: the line posts one drops are not the other's.
        for (const side of added) {
          const one = { ...yard!, sides: yard!.sides.map(x => (x.gate && !had.has(x.id) && x.id !== side.id ? { ...x, gate: null } : x)) }
          const d = deriveLayout(one, nearIn, { teeAs })
          const p = gatePostsOf(inputOf({ runs: d.runs.map(r => ({ ft: r.ft, rail: 'auto' as const })), corners: d.corners, ends: d.ends, walkGates: d.walkGates, dblGates: d.dblGates, gateWidths: d.gateWidthsFt }), baseFor(one))
          on.push({ ...p, ...entry, kind: side.gate!.type === 'double' ? 'double' : 'walk', side: side.id })
        }
      } else if (c.added) {
        const p = style ? gatePostsOf(stateInput(state), baseFor(yard)) : { ends: 0, linePosts: 0 }
        const share = (n: number, i: number) => Math.floor(n / c.added) + (i < n % c.added ? 1 : 0)
        const walks = Math.max(0, state.walkGates - prev.walkGates) - c.toWalk
        for (let i = 0; i < c.added; i++) on.push({ ends: share(p.ends, i), linePosts: share(p.linePosts, i), ...entry, kind: i < walks ? 'walk' : 'double' })
      }
    }
    prev = state
  }
  return on
}
