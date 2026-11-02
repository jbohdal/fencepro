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
 *   "CREDIT IN FULL"   a gate an earlier change order added, taken out by a
 *            later one: the credit is what that change order charged for it,
 *            read from its stored lines, so the two net $0 even after a cost
 *            change or a price typed by hand (gateCreditOf). That first needs
 *            the fence as it was before the gate, the opening's feet back
 *            when the charge had them in it (gateCharges `into`); the rest of
 *            the change is priced from there
 *
 * Gates added are net: a gate of the sold job taken out, a gate whose charge
 * can't be read (gateCreditOf), or one swapped for another, prices as it
 * always has. The one price difference line credits in full by itself: it is
 * the new work's price minus the contract, which holds the earlier charge
 * (workOffContract below for what the contract holds that the work does not).
 * The pull sheet, crew packet, Sales Order and a change order's stored work
 * and costDelta never come through here: they keep whole rolls and the real
 * post count (lib/changeOrderWork.ts priceWork).
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

// ── A gate an earlier change order added, taken out by a later one ───────────

/** The words of the one price difference line (changeOrderDraft.ts). */
export const DIFFERENCE_LINE = "Price difference at today's prices"
export const CHANGES_LINE = "Changes to the work, at today's prices"
const DIFFERENCE_LINES = [DIFFERENCE_LINE, CHANGES_LINE]

/** An earlier change order as this one reads it (ChangeOrders.tsx ChangeOrder). */
export interface EarlierOrder {
  number: number
  status: string
  lines: Array<{ description: string; amountCents: number; qty?: number; source?: { ref: string } | null }>
  scope?: { walkGates?: number; dblGates?: number; footageFt?: number; sections?: number; fromStyle?: string; toStyle?: string } | null
  /** Only a change order with work changed the job: typed lines change the price, never the gates a later one can take out. */
  work?: unknown
  /** The drawing's own gate changes (server ownGateSides); null: a run list. */
  gateSides?: { added: Array<{ side: string; type: 'walk' | 'double' }>; removed: string[] } | null
}

/**
 * A move or repair's earlier change orders with no work kept (its one price
 * difference line is the new work's price minus the contract, so what is in
 * the contract and not in the work would be handed back):
 *
 *   priceOnly  typed or picked lines: they change the price, never the work,
 *              as on a new fence. Their amounts stay on the job, out of the
 *              comparison.
 *   unknown    made in the quote builder before a move or repair kept its work
 *              (Nov 2 2026): a scope or its price difference line says it
 *              changed the work, nothing says how. The price stays compared
 *              with the contract, which is right once its change is put on
 *              the work again, and the person is told (noWorkNote).
 *
 * Approved ones only: an open one is not in the price compared with.
 */
export function workOffContract(orders: EarlierOrder[]): { priceOnly: EarlierOrder[]; unknown: EarlierOrder[] } {
  const off = orders.filter(o => o.status === 'approved' && !o.work)
  const fromBuilder = (o: EarlierOrder) => Object.values(o.scope ?? {}).some(Boolean) || o.lines.some(l => DIFFERENCE_LINES.includes(l.description))
  return { priceOnly: off.filter(o => !fromBuilder(o)), unknown: off.filter(fromBuilder) }
}

const orderCents = (o: EarlierOrder) => o.lines.reduce((t, l) => t + l.amountCents, 0)
const dollars = (cents: number) => `${cents < 0 ? '-' : '+'}$${(Math.abs(cents) / 100).toLocaleString('en-US')}`

/** What the person changing a move or repair is told about those change orders. Null: nothing to say. */
export function noWorkNote(orders: EarlierOrder[]): string | null {
  const { priceOnly, unknown } = workOffContract(orders)
  const list = (os: EarlierOrder[]) => os.map(o => `CO-${o.number} (${dollars(orderCents(o))})`).join(', ')
  const notes: string[] = []
  if (unknown.length) {
    const total = unknown.reduce((t, o) => t + orderCents(o), 0)
    notes.push(`${list(unknown)} changed this job before change orders on a move or repair kept their work, so it is not in the work shown here, but the contract holds its price. Put that change in here first, or this change order takes the ${dollars(total).slice(1)} back.`)
  }
  if (priceOnly.length) notes.push(`${list(priceOnly)} was typed: its price stays on the job and is not part of this change. It is not in the work shown here.`)
  return notes.length ? notes.join(' ') : null
}

/** Gates one line of a change order charged for, still on the job. */
interface GateCharge {
  number: number
  walk: number
  dbl: number
  cents: number
  /** The charge has the gates' opening in it ("4 ft of fence becomes the gate"), that many feet; 0: the fence is on its own lines. */
  openingFt: number
  /** The sides of the drawing they are in; empty: a run list or picked gates. */
  sides: string[]
}

/** The gates a line charged for, as changeOrderDraft.ts writes it or as it was picked (web changeOrderPicks.ts add:walk, add:double). */
function chargeOfLine(l: EarlierOrder['lines'][number]): Omit<GateCharge, 'number' | 'sides'> | null {
  const [kind, piece] = (l.source?.ref ?? '').split(':')
  if (l.source) return kind === 'add' && (piece === 'walk' || piece === 'double') ? { walk: piece === 'walk' ? l.qty || 1 : 0, dbl: piece === 'double' ? l.qty || 1 : 0, cents: l.amountCents, openingFt: 0 } : null
  const m = /^Add (?:(\d+) walk gates?)?(?: and )?(?:(\d+) double gates?)?/.exec(l.description)
  if (!m || !(m[1] || m[2])) return null
  const opening = /\(([\d.]+) ft of fence becomes the gates?\)/.exec(l.description)
  return { walk: Number(m[1] ?? 0), dbl: Number(m[2] ?? 0), cents: l.amountCents, openingFt: opening ? Number(opening[1]) : 0 }
}

/**
 * The gates earlier change orders added that are still on the job, each with
 * what it charged. Taken from the stored lines: a line's words or pick must
 * agree with the gates the change order really added, or it says nothing (an
 * amount typed for something else). A change order that also took a gate out
 * of the same kind is a swap, never a gate added. Void ones don't count; open
 * ones do: their gates are in the drawing being changed.
 */
export function gateCharges(orders: EarlierOrder[]): GateCharge[] {
  let on: GateCharge[] = []
  for (const o of [...orders].sort((a, b) => a.number - b.number)) {
    if (o.status === 'void' || !o.work) continue
    const walk = o.scope?.walkGates ?? 0, dbl = o.scope?.dblGates ?? 0
    // Taken out or changed since: that side's charge is gone. A run list says only how many: the newest.
    if (o.gateSides) on = on.filter(c => !c.sides.some(s => o.gateSides!.removed.includes(s)))
    if (!o.gateSides?.removed.length) {
      for (let n = -walk; n > 0; n--) { const i = on.findLastIndex(c => c.walk > 0); if (i >= 0) on.splice(i, 1) }
      for (let n = -dbl; n > 0; n--) { const i = on.findLastIndex(c => c.dbl > 0); if (i >= 0) on.splice(i, 1) }
    }
    if (walk < 0 || dbl < 0 || o.gateSides?.removed.length) continue
    const lines = o.lines.flatMap(l => { const c = chargeOfLine(l); return c && c.cents > 0 ? [c] : [] })
    if (lines.reduce((t, c) => t + c.walk, 0) !== walk || lines.reduce((t, c) => t + c.dbl, 0) !== dbl) continue
    const left = [...(o.gateSides?.added ?? [])]
    const take = (type: 'walk' | 'double', n: number) => { const got = left.filter(g => g.type === type).slice(0, n); for (const g of got) left.splice(left.indexOf(g), 1); return got.map(g => g.side) }
    for (const c of lines) on.push({ ...c, number: o.number, sides: [...take('walk', c.walk), ...take('double', c.dbl)] })
  }
  return on
}

/** The work before and after, as gateCreditOf reads them. */
type GateWork = Pick<QuoteCalcInput, 'runs' | 'corners' | 'ends' | 'walkGates' | 'dblGates'>

/** The credit for the gates taken out, and the fence and gates to price the rest of the change from. */
export interface GateCredit {
  cents: number
  numbers: number[]
  walk: number
  dbl: number
  openingFt: number
  /** The names of the sides, on a drawing. */
  sides: string[]
  work: GateWork
}

/**
 * The credit in full for gates earlier change orders added, taken out by this
 * one. Null, and it prices as it always has, when his answer doesn't reach it:
 * no gate net taken out; the gate came with the sold job (a run list doesn't
 * say which gate went, so a job sold with one of that kind is not known
 * either); no charge can be read; a run list with more gates of that kind on
 * it than go, or one line's charge for more gates than go (which of them, or
 * how much of the line?); or a run list with its fence changed beyond the
 * opening (nothing says where the opening was).
 */
export function gateCreditOf(orders: EarlierOrder[], sold: { walkGates: number; dblGates: number }, was: GateWork & Pick<WorkBefore, 'layout'>, cur: GateWork, now?: ChangeNow | null): GateCredit | null {
  const outWalk = was.walkGates - cur.walkGates, outDbl = was.dblGates - cur.dblGates
  if (outWalk < 0 || outDbl < 0 || !(outWalk + outDbl)) return null
  const charges = gateCharges(orders)
  const yardWas = was.layout?.yard
  const drawing = !!(now && yardWas?.sides)
  let gone: GateCharge[]
  if (drawing) {
    const stay = new Map(now!.yard.sides.filter(s => s.on && s.gate).map(s => [s.id, s]))
    const out = yardWas!.sides.filter(s => s.on && s.gate && !stay.has(s.id)).map(s => s.id)
    // A gate moved as well as one taken out: not which is which.
    if (out.length !== outWalk + outDbl) return null
    gone = charges.filter(c => c.sides.length && c.sides.every(s => out.includes(s)))
  } else {
    if ((outWalk && sold.walkGates) || (outDbl && sold.dblGates)) return null
    gone = charges.filter(c => (outWalk && c.walk) || (outDbl && c.dbl))
    if (gone.reduce((t, c) => t + c.walk, 0) !== outWalk || gone.reduce((t, c) => t + c.dbl, 0) !== outDbl) return null
  }
  if (!gone.length) return null
  const openingFt = gone.reduce((t, c) => t + c.openingFt, 0)
  const walk = gone.reduce((t, c) => t + c.walk, 0), dbl = gone.reduce((t, c) => t + c.dbl, 0)
  const feetOf = (runs: QuoteRun[]) => runs.reduce((t, r) => t + (r.ft > 0 ? r.ft : 0), 0)
  // The charge had the opening in it: back to the fence before the gate. Else the fence and its posts are on fence lines, then and now.
  let fence: Pick<GateWork, 'runs' | 'corners' | 'ends'>
  if (drawing) {
    const open = gone.filter(c => c.openingFt > 0).flatMap(c => c.sides)
    const closed = deriveLayout({ ...now!.yard, sides: yardWas!.sides.map(s => (open.includes(s.id) ? { ...s, gate: null } : s)) }, now!.nearIn, { teeAs: now!.teeAs })
    fence = open.length ? { runs: closed.runs.map(r => ({ ft: r.ft, rail: 'auto' as const })), corners: closed.corners, ends: closed.ends } : was
  } else if (!openingFt) fence = was
  else if (Math.abs(feetOf(cur.runs) - feetOf(was.runs) - openingFt) < 0.01) fence = cur
  else return null
  const sameFeet = JSON.stringify(fence.runs.map(r => r.ft)) === JSON.stringify(cur.runs.filter(r => r.ft > 0).map(r => r.ft))
  return {
    cents: gone.reduce((t, c) => t + c.cents, 0), numbers: [...new Set(gone.map(c => c.number))].sort((a, b) => a - b), walk, dbl, openingFt,
    sides: yardWas?.sides.filter(s => gone.some(c => c.sides.includes(s.id))).map(s => s.name) ?? [],
    work: { runs: sameFeet ? cur.runs : fence.runs, corners: fence.corners, ends: fence.ends, walkGates: was.walkGates - walk, dblGates: was.dblGates - dbl },
  }
}
