/**
 * A change order filled in from what was changed on a signed quote (the quote
 * builder, after the lock refused the save).
 *
 * Each change is its own line, priced by the quote builder's own math
 * (quoteCalc, per run section rounding included) at today's costs: the signed
 * work is priced again today, then the changes are put on it one at a time
 * (style, footage, walk gates, double gates, tear out, the rest) and each
 * line is what that step moved the price. The lines add up to "the new work
 * today" minus "the signed work today", so a cost change since signing is
 * never billed to the customer. A price set by hand on the signed quote is
 * left out of these steps (it would make every step $0). Amounts are integer cents.
 *
 * A move or repair, or a login that sees prices only (the server prices
 * their quotes), gets the changes as lines and one price difference line:
 * today's price of the new version minus the signed price.
 *
 * Both price a change the way changeOrderPricing.ts does (Jonathan, Oct 31
 * 2026): chain link fabric by the foot, 2 new posts for each gate added. What a
 * gate cost comes off with it, and work brought back to a state the job was
 * already in brings the contract back to what it was then (Jonathan, Nov 2 2026:
 * "CREDIT IN FULL"). What that can't settle is said to whoever is making it, in
 * `warnings`, never on a line.
 *
 * Every amount is whole dollars (Jonathan, Oct 21 2026): each step is priced
 * to the whole dollar, even on a quote signed with cents, and the one price
 * difference line is rounded down to the whole dollar (a credit to the larger
 * whole dollar), so the cents never go on the customer.
 */
import { calculateQuote, type QuoteCalcInput } from './quoteCalc'
import { backToState, changeBaseOf, changeOrderInput, fabricFeet, gateOpeningFt, gatesGoing, gatesOnJob, jobSteps, type ChangeBase, type ChangeNow, type GateOnJob, type JobHistory, type JobStep, type WorkState } from './changeOrderPricing'
import { wholeDollarCents } from './pricingEngine'
import type { SavedQuote } from './QuotesPage'
import type { ChangeOrderLine, ChangeOrderPrefill, ChangeOrderScope } from './ChangeOrders'
import { styleLabel } from './fenceCatalog'
import { newId } from './recordSync'
import { GATE_WIDTH_IN, layoutGateWidths, type YardLayout } from './yardLayout'

type Style = NonNullable<QuoteCalcInput['style']>

const ft = (runs: Array<{ ft: number }>) => Math.round(runs.reduce((s, r) => s + (r.ft > 0 ? r.ft : 0), 0) * 100) / 100
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
// Priced from cost, never at a price set by hand: a hand set price is the same before and after
// every step, so each line came out $0 and the change order could not be saved (seen Oct 23, 2026
// on a signed quote with its price typed in). The step's difference is what the change costs today.
/** The step's price (cents) and its panels: in all, and on each run (per run rounding, never pooled). */
const priced = (input: QuoteCalcInput, base: ChangeBase, posts: { ends: number; linePosts: number } = { ends: 0, linePosts: 0 }): { cents: number; sections: number; perRun: number[] } => {
  if (!input.style) return { cents: 0, sections: 0, perRun: [] }
  const { finalPrice, ...o } = input.overrides ?? {}; void finalPrice
  const p = changeOrderInput(input, base)
  const c = calculateQuote({ ...p, ends: p.ends + posts.ends, ...(posts.linePosts ? { extraLinePosts: (p.extraLinePosts ?? 0) + posts.linePosts } : {}), overrides: { ...o, wholeDollar: true } })
  return { cents: Math.round(c.priced.price * 100), sections: c.sections, perRun: c.perRunSections }
}
const panels = (n: number) => `${n} panel${n === 1 ? '' : 's'}`
/** The pricing choices without the whole dollar mark (which every change order step prices with). */
const choices = (o: QuoteCalcInput['overrides']) => { const { wholeDollar, roundingCents, ...rest } = o ?? {}; void wholeDollar; void roundingCents; return rest }

export interface DraftInput {
  /** The signed quote as saved. */
  signed: SavedQuote
  /** The quote builder's inputs now (what was changed). */
  current: QuoteCalcInput
  /** The pricing choices the quote builder opened with (the signed quote's). */
  signedOverrides: QuoteCalcInput['overrides']
  /** Every style (the signed one is looked up by name). */
  styles: Style[]
  /** The new version's change order price (dollars; changeOrderPricing.ts changeOrderPrice): the one price difference line is this minus the signed price. */
  priceNow: number
  /** Sections now. */
  sectionsNow: number
  /** A move or repair, or a prices only login: one price difference line. */
  simple: boolean
  /**
   * Gates put into sides of the drawing (a side that had no gate and has one now, same length): the
   * sides' names and the feet of fence the new gates take. Without it, the gates' own widths, else
   * 4 ft for a walk gate and 8 ft for a double (changeOrderPricing.ts gateOpeningFt).
   */
  gatesIn?: { sides: string[]; openingFt: number } | null
  /**
   * The change side by side, from the drawing ("Left side 40 ft → 50 ft"; changeOrderMerge.ts
   * sideChangeWords). Given, the fence line says its own sides, never the whole fence before and
   * after: with another change order open, which one is signed first changes the whole fence, so
   * "146 ft to 156 ft" stopped being true (round 3 recheck, Oct 26 2026).
   */
  sides?: string | null
  /** The drawing as it is now, for its gates' posts (changeOrderPricing.ts changeBaseOf); null: a run list. */
  now?: ChangeNow | null
  /** The quote as sold and the job's change orders, when `signed` is the work now (ChangeOrders.tsx quoteWithChanges). */
  earlier?: (JobHistory & { sold: SavedQuote }) | null
}

/** "1 walk gate and 1 double gate". */
const gatesWords = (walk: number, dbl: number) => [walk ? plural(walk, 'walk gate') : '', dbl ? plural(dbl, 'double gate') : ''].filter(Boolean).join(' and ')
/** " in the Back side", " in the Left side and the Left return" (a name that says side already). */
function inSides(names: string[]): string {
  const sides = names.filter(Boolean).map(n => (/(^|\s)(side|return|run)$/i.test(n) ? n : `${n} side`))
  return sides.length ? ` in the ${sides.length === 1 ? sides[0] : `${sides.slice(0, -1).join(', the ')} and the ${sides[sides.length - 1]}`}` : ''
}

const dollars = (cents: number) => `$${(Math.abs(cents) / 100).toLocaleString('en-US')}`

/** What changed on the signed quote, as lines with amounts in cents. */
export function changeOrderDraft(d: DraftInput): ChangeOrderPrefill {
  const s = d.signed, cur = d.current
  const signedStyle = d.styles.find(x => x.name === s.fenceStyle) ?? cur.style
  const signedRuns = s.runs.map((f, i) => ({ ft: f, rail: s.runRails?.[i] ?? 'auto' as const }))
  const sold = d.earlier?.sold ?? s
  const steps = d.earlier ? jobSteps(d.earlier) : []
  const yardWas = (s.layout as { yard?: YardLayout | null } | undefined)?.yard ?? null
  const ftWas = ft(signedRuns), ftNow = ft(cur.runs)
  const scope: ChangeOrderScope = {}
  const words: Array<{ text: string; step: (x: QuoteCalcInput) => QuoteCalcInput; runs?: boolean; gate?: boolean }> = []

  const styleNow = cur.style?.name ?? s.fenceStyle
  if (styleNow !== s.fenceStyle) {
    scope.fromStyle = s.fenceStyle; scope.toStyle = styleNow
    words.push({ text: `Change the fence from ${styleLabel(s.fenceStyle)} to ${styleLabel(styleNow)}`, step: x => ({ ...x, style: cur.style }) })
  }
  const runsChanged = JSON.stringify(cur.runs.filter(r => r.ft > 0).map(r => r.ft)) !== JSON.stringify(s.runs) || cur.corners !== s.corners || cur.ends !== s.ends
  const gatesToo = cur.walkGates !== s.walkGates || cur.dblGates !== s.dblGates
  const walkIn = Math.max(0, cur.walkGates - s.walkGates), dblIn = Math.max(0, cur.dblGates - s.dblGates)
  const delta = Math.round((ftNow - ftWas) * 100) / 100
  const openingFt = Math.round((d.gatesIn?.openingFt ?? gateOpeningFt(cur, s)) * 100) / 100
  const walkOut = Math.max(0, s.walkGates - cur.walkGates), dblOut = Math.max(0, s.dblGates - cur.dblGates)
  const widthsWas = layoutGateWidths(s.layout as Parameters<typeof layoutGateWidths>[0]) ?? undefined
  const gatesOut = d.now && yardWas ? gatesPutIn(d.now.yard, yardWas) : null
  const openingOut = Math.round((gatesOut?.openingFt ?? gateOpeningFt({ walkGates: s.walkGates, dblGates: s.dblGates, gateWidths: widthsWas }, cur)) * 100) / 100
  const gateOutOfSide = runsChanged && (walkOut + dblOut) > 0 && !(walkIn + dblIn) && Math.abs(delta - openingOut) < 0.01
  // The feet a gate taken out gives back to the fence: on a drawing its width, on a run list only when a change order took them.
  const gapMade = steps.find(x => (x.order.scope?.walkGates ?? 0) + (x.order.scope?.dblGates ?? 0) > 0 && (x.order.scope?.footageFt ?? 0) < 0)
  const feetBack = (walkOut + dblOut) > 0 && !(walkIn + dblIn) && (d.now && yardWas || gapMade) ? openingOut : 0
  const ownFt = Math.round((delta - feetBack) * 100) / 100
  // A gate put into a side (round 3, Oct 26 2026): "Remove 4 ft of fence, 1 panel more +$128" then "Add 1 walk gate
  // +$202" read as paying for fence taken away. When the fence taken out is just the new gates' opening, it is one
  // change: "Add 1 walk gate in the Back side (4 ft of fence becomes the gate)", the two price steps as one.
  const gateIntoSide = runsChanged && (walkIn + dblIn) > 0 && delta < 0 && Math.abs(-delta - openingFt) < 0.01
    && cur.walkGates >= s.walkGates && cur.dblGates >= s.dblGates
  if (gateIntoSide) {
    if (delta) scope.footageFt = delta
    if (walkIn) scope.walkGates = walkIn
    if (dblIn) scope.dblGates = dblIn
    words.push({
      text: `Add ${gatesWords(walkIn, dblIn)}${inSides(d.gatesIn?.sides ?? [])} (${openingFt} ft of fence becomes the gate${walkIn + dblIn > 1 ? 's' : ''})`,
      step: x => ({ ...x, runs: cur.runs, corners: cur.corners, ends: cur.ends, walkGates: cur.walkGates, dblGates: cur.dblGates }),
    })
  } else if (gateOutOfSide) {
    // The other way: the fence put back is just the gates' opening, one change.
    scope.footageFt = delta
    if (walkOut) scope.walkGates = -walkOut
    if (dblOut) scope.dblGates = -dblOut
    words.push({
      text: `Remove ${gatesWords(walkOut, dblOut)}${inSides(gatesOut?.sides ?? [])} (${delta} ft of fence goes back in)`,
      step: x => ({ ...x, runs: cur.runs, corners: cur.corners, ends: cur.ends, walkGates: cur.walkGates, dblGates: cur.dblGates }), gate: true,
    })
  } else if (runsChanged) {
    if (delta) scope.footageFt = delta
    // Gate openings are not fence: a 12 ft side with a 4 ft gate adds 8 ft of fence and a gate (its own line).
    const opening = (walkIn + dblIn) > 0 && delta < 0 ? `; ${Math.min(openingFt, -delta)} ft of it becomes the new gate${walkIn + dblIn > 1 ? 's' : ''}` : ''
    // A gate going as the fence grows: the feet the customer can check on the side, and the gate's feet said apart.
    const gateBack = feetBack && ownFt > 0 ? feetBack : 0
    const span = gateBack
      ? `${d.sides ?? `${ftWas + gateBack} ft to ${ftNow} ft`}; the ${gateBack} ft where the gate was goes back to fence too`
      : d.sides
      ? `${d.sides}${gatesToo ? '; the fence feet leave out the gates' : ''}${opening}`
      : `${ftWas} ft to ${ftNow} ft${gatesToo ? ' of fence, gates not counted' : ''}${opening}`
    words.push({
      text: gateBack ? `Add ${ownFt} ft of fence (${span})` : delta > 0 ? `Add ${delta} ft of fence (${span})` : delta < 0 ? `Remove ${-delta} ft of fence (${span})` : 'Change the fence line (same footage, different runs or posts)',
      step: x => ({ ...x, runs: cur.runs, corners: cur.corners, ends: cur.ends }),
      runs: true,
    })
  }
  if (gateIntoSide || gateOutOfSide) { /* the gates are on the line above */ } else if (cur.walkGates !== s.walkGates) {
    const n = cur.walkGates - s.walkGates
    scope.walkGates = n
    words.push({ text: n > 0 ? `Add ${plural(n, 'walk gate')}` : `Remove ${plural(-n, 'walk gate')}`, step: x => ({ ...x, walkGates: cur.walkGates }), gate: n < 0 })
  }
  if (!gateIntoSide && !gateOutOfSide && cur.dblGates !== s.dblGates) {
    const n = cur.dblGates - s.dblGates
    scope.dblGates = n
    words.push({ text: n > 0 ? `Add ${plural(n, 'double gate')}` : `Remove ${plural(-n, 'double gate')}`, step: x => ({ ...x, dblGates: cur.dblGates }), gate: n < 0 })
  }
  if (cur.tearOutSections !== s.tearOutSections || cur.tearOutGates !== s.tearOutGates) {
    const a = cur.tearOutSections - s.tearOutSections, b = cur.tearOutGates - s.tearOutGates
    const parts = [a ? `${a > 0 ? 'add' : 'remove'} ${plural(Math.abs(a), 'section')}` : '', b ? `${b > 0 ? 'add' : 'remove'} ${plural(Math.abs(b), 'gate')}` : ''].filter(Boolean)
    words.push({ text: `Tear out: ${parts.join(', ')}`, step: x => ({ ...x, tearOutSections: cur.tearOutSections, tearOutGates: cur.tearOutGates }) })
  }
  const restChanged = cur.extraLaborHrs !== (s.adjLaborHrs || 0) || cur.hasSalesman !== !!s.hasSalesman || cur.priceAdjust !== (s.priceAdjust || 0)
    || JSON.stringify(choices(cur.overrides)) !== JSON.stringify(choices(d.signedOverrides))
  words.push({ text: 'Other price changes', step: x => ({ ...x, extraLaborHrs: cur.extraLaborHrs, hasSalesman: cur.hasSalesman, priceAdjust: cur.priceAdjust, overrides: cur.overrides }) })

  const sectionsDelta = d.sectionsNow - s.sections
  if (sectionsDelta) scope.sections = sectionsDelta
  // The reason is typed by whoever makes it (required, Oct 26 2026), never a generic sentence.
  const done = (lines: ChangeOrderLine[], warnings: string[] = []): ChangeOrderPrefill => ({ reason: '', lines, scope: Object.keys(scope).length ? scope : null, ...(warnings.length ? { warnings } : {}) })

  if (d.simple || !signedStyle) {
    const lines = words.filter(w => w.text !== 'Other price changes').map(w => ({ id: newId(), description: w.text, amountCents: 0 }))
    const diff = wholeDollarCents(Math.round(d.priceNow * 100) - Math.round(s.finalPrice * 100)).cents
    lines.push({ id: newId(), description: lines.length ? "Price difference at today's prices" : "Changes to the work, at today's prices", amountCents: diff })
    return done(lines)
  }

  // Price the signed work today, then put each change on it in turn.
  // A gate going, or the style changing: the gates over the sold count carry the posts they were priced with, on both
  // sides of the change, each at its own width. Any other change prices as it would on a job with no change orders.
  const soldState = sold as unknown as WorkState
  const gatesWas = s.walkGates + s.dblGates, netOut = Math.max(0, walkOut + dblOut - walkIn - dblIn)
  const on: GateOnJob[] = cur.style && (netOut || styleNow !== s.fenceStyle) ? gatesOnJob(steps, soldState, cur, d.styles as never) : []
  const going = gatesGoing(on, netOut, d.now?.yard)
  const postsAt = (gates: number) => on.filter(g => gates >= gatesWas || !going.includes(g)).reduce((t, g) => ({ ends: t.ends + g.ends, linePosts: t.linePosts + g.linePosts }), { ends: 0, linePosts: 0 })
  let at: QuoteCalcInput = {
    ...cur, ...(on.length ? { gateWidths: widthsWas ?? null, extraLinePosts: (s.layout as { teeLinePosts?: number } | undefined)?.teeLinePosts } : {}),
    style: signedStyle, runs: signedRuns, corners: s.corners, ends: s.ends, walkGates: s.walkGates, dblGates: s.dblGates,
    tearOutSections: s.tearOutSections, tearOutGates: s.tearOutGates, extraLaborHrs: s.adjLaborHrs || 0, hasSalesman: !!s.hasSalesman,
    priceAdjust: s.priceAdjust || 0, overrides: d.signedOverrides,
  }
  // Those change orders move the fabric from where the job's rolls were sold, so back and forth lands on the same dollar.
  const own = changeBaseOf(s, d.now, signedStyle)
  const base = on.length ? { ...own, feet: fabricFeet(steps, soldState, d.styles as never) } : own
  let was = priced(at, base, postsAt(gatesWas))
  // The one side whose length changed (same sides otherwise), for "still 7 panels on that side".
  const ftNowRuns = cur.runs.map(r => r.ft)
  const diffs = ftNowRuns.length === signedRuns.length ? ftNowRuns.map((f, i) => (f === signedRuns[i].ft ? -1 : i)).filter(i => i >= 0) : []
  const oneSide = diffs.length === 1 ? diffs[0] : null
  const lines: ChangeOrderLine[] = []
  let gateCents = 0, gateLine: ChangeOrderLine | null = null as ChangeOrderLine | null
  for (const w of words) {
    at = w.step({ ...at, ...(on.length ? { gateWidths: cur.gateWidths, extraLinePosts: cur.extraLinePosts } : {}) })
    const now = priced(at, base, postsAt(at.walkGates + at.dblGates))
    const amount = now.cents - was.cents
    if (w.text === 'Other price changes' && !amount && !restChanged) { was = now; continue }
    const line = { id: newId(), description: w.runs ? runWords(w.text, was, now, amount, oneSide, !!d.sides) : w.text, amountCents: amount }
    lines.push(line)
    if (w.gate) { gateCents += amount; gateLine = line }
    was = now
  }
  const stateNow: WorkState = { fenceStyle: styleNow, runs: cur.runs.map(r => r.ft), corners: cur.corners, ends: cur.ends, walkGates: cur.walkGates, dblGates: cur.dblGates, tearOutSections: cur.tearOutSections, tearOutGates: cur.tearOutGates, gateWidths: cur.gateWidths ?? null }
  // Back at a state the job was already in: the contract is what it was then, a cost change or a price typed by hand since
  // included. Nothing to undo with a gate going or coming is no such state: a gate is never $0, the price stands.
  let back = restChanged ? null : backToState(steps, soldState, { ...(s as unknown as WorkState), layout: s.layout as WorkState['layout'] }, stateNow)
  if (back === 0 && gatesToo) back = null
  if (back !== null) {
    const off = back - lines.reduce((t, l) => t + l.amountCents, 0)
    // On a line it leaves saying what it says (an "Add" stays a charge), else on its own.
    const carrier = [...lines].reverse().find(l => l.amountCents * (l.amountCents + off) > 0)
    if (carrier) carrier.amountCents += off
    else if (off) lines.push({ id: newId(), description: 'Price back to what it was for this work', amountCents: off })
  }
  // Each step is whole dollars, so a gate's price can land a dollar from what it charged: what it charged.
  // (One gate of several on one line has no whole dollar share: its price stands.)
  const charged = going.length === 1 && going[0].cents !== null && going[0].cents % 100 === 0 && going[0].whole ? going[0].cents : null
  if (back === null && charged !== null && gateLine && Math.abs(gateCents + charged) <= 100) { gateLine.amountCents -= gateCents + charged; gateCents = -charged }
  return done(lines.map(l => ({ ...l, fromChange: true })), warningsOf(steps, s, d, { back, walkOut, dblOut, feetNow: ftNow, feetWas: ftWas, openingOut, gateCents: feetBack && ownFt > 0 ? 0 : gateCents, going }))
}

/**
 * What the price can't settle, for whoever is making the change order (never
 * on a line, never to the customer): a gate taken out that is still on another
 * change order waiting to be signed; a run list whose gate box was changed
 * with the gate's opening left out of the fence; a gate credited more than it
 * was charged, on a state the job was never in (the fence is longer, or the
 * price changed, or it was typed by hand: both figures, never a reason).
 */
function warningsOf(steps: JobStep[], s: SavedQuote, d: DraftInput, c: { back: number | null; walkOut: number; dblOut: number; feetNow: number; feetWas: number; openingOut: number; gateCents: number; going: GateOnJob[] }): string[] {
  const out: string[] = []
  if (!(c.walkOut + c.dblOut)) return out
  const adds = (x: JobStep) => (c.walkOut && (x.order.scope?.walkGates ?? 0) > 0) || (c.dblOut && (x.order.scope?.dblGates ?? 0) > 0)
  const open = steps.filter(x => x.order.status !== 'approved' && adds(x)).map(x => x.order)
  if (open.length) {
    const names = open.map(o => `CO-${o.number}`).join(' and ')
    out.push(`${names} ${open.length === 1 ? 'is' : 'are'} not signed yet. This credit only stands if ${names} ${open.length === 1 ? 'is' : 'are'} signed. If the customer no longer wants the gate, void ${names} instead of making this change order.`)
  }
  const made = steps.findIndex(x => adds(x) && (x.order.scope?.footageFt ?? 0) < 0)
  if (c.back === null && !d.now && Math.abs(c.feetNow - c.feetWas) < 0.01 && c.openingOut > 0 && made >= 0) {
    // The run the gate took its feet from, when the list says: the whole fence is no number to type in one box.
    const before = made ? steps[made - 1].state.runs : (d.earlier?.sold ?? s).runs
    const moved = before.length === s.runs.length ? before.flatMap((f, i) => (f !== s.runs[i] ? [i] : [])) : []
    const fix = moved.length !== 1 ? `add the ${c.openingOut} ft back to the run the gate is on`
      : s.runs.length > 1 ? `type ${before[moved[0]]} ft in Run ${moved[0] + 1}` : `type ${before[moved[0]]} ft on the run list`
    out.push(`The gate took ${c.openingOut} ft out of the fence, and this leaves the fence at ${c.feetNow} ft with a ${c.openingOut} ft gap. If that fence goes back in, ${fix} and make the change order again.`)
  } else if (c.back === null && c.going.length && c.going.every(g => g.cents !== null)) {
    const charged = c.going.reduce((t, g) => t + g.cents!, 0)
    if (-c.gateCents > charged + 100) {
      const names = [...new Set(c.going.map(g => `CO-${g.number}`))].join(' and ')
      out.push(`${names} charged ${dollars(charged)} for ${c.going.length === 1 ? 'this gate' : 'these gates'}. This change order credits ${dollars(c.gateCents)}, the price today on the fence as it is now. Change the amount if it should be less.`)
    }
  }
  return out
}

/**
 * The fence line's words with its panels, so the price reads right: per run
 * rounding (a 4 ft run is a whole panel) can make 8 ft cost two panels, and
 * 6 ft more on a side can still be the same panels and no price change
 * (round 2 review, Oct 26 2026: $0 with an empty price box and Save greyed).
 */
function runWords(text: string, was: { sections: number }, now: { sections: number; perRun: number[] }, amount: number, side: number | null, bySide = false): string {
  const more = now.sections - was.sections
  // Less fence and yet more panels (a new gate splits a side in two pieces): say why, never a bare "Remove ... more".
  if (more > 0 && /^Remove /.test(text)) return text.replace(/^(Remove [\d.]+ ft of fence)/, `$1, yet ${panels(more)} more: a side split in two pieces needs a panel for each piece`)
  if (more) return text.replace(/^((?:Add|Remove) [\d.]+ ft of fence)/, `$1, ${more > 0 ? `${panels(more)} more` : `${panels(-more)} fewer`}`)
  // Said side by side, never the whole fence's panels (another change order signed first changes those).
  const still = side !== null && now.perRun[side] !== undefined ? `still ${panels(now.perRun[side])} on that side` : bySide ? 'same panels' : `still ${panels(now.sections)} in all`
  return `${text}: ${still}${amount === 0 ? ', no price change' : ''}`
}

/**
 * Gates put into sides of the drawing: each side that had no gate and has one
 * now, at the same length (the gate takes its width out of the fence). Null
 * when there is no drawing on either side, or no such side.
 */
export function gatesPutIn(before: YardLayout | null | undefined, after: YardLayout | null | undefined): { sides: string[]; openingFt: number } | null {
  if (!before?.sides || !after?.sides) return null
  const was = new Map(before.sides.map(x => [x.id, x]))
  const sides: string[] = []
  let inches = 0
  for (const x of after.sides) {
    const b = was.get(x.id)
    if (!b || !x.on || !x.gate || b.gate || b.lengthIn !== x.lengthIn) continue
    sides.push(x.name)
    inches += x.gate.widthIn || GATE_WIDTH_IN[x.gate.type]
  }
  return sides.length ? { sides, openingFt: Math.round((inches / 12) * 100) / 100 } : null
}
