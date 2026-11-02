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
 * today's price of the new version minus the job as it stands, the contract
 * after the last change order, whose work the builder opened on. Typed lines
 * are not in that work, so their amounts are out of it (changeOrderPricing.ts
 * workOffContract); the rest of a cost change since signing is still in it.
 *
 * Both price a change the way changeOrderPricing.ts does (Jonathan, Oct 31
 * 2026): chain link fabric by the foot, 2 new posts for each gate added. A
 * gate an earlier change order added and this one takes out comes off first,
 * at what it charged, on one line of its own (Jonathan, Nov 2 2026: "CREDIT IN
 * FULL"); the other lines are priced from there.
 *
 * Every amount is whole dollars (Jonathan, Oct 21 2026): each step is priced
 * to the whole dollar, even on a quote signed with cents, and the one price
 * difference line is rounded down to the whole dollar (a credit to the larger
 * whole dollar), so the cents never go on the customer.
 */
import { calculateQuote, type QuoteCalcInput } from './quoteCalc'
import { changeBaseOf, changeOrderInput, gateCreditOf, gateOpeningFt, workOffContract, CHANGES_LINE, DIFFERENCE_LINE, type ChangeBase, type ChangeNow, type EarlierOrder, type GateCredit } from './changeOrderPricing'
import { wholeDollarCents } from './pricingEngine'
import type { SavedQuote } from './QuotesPage'
import type { ChangeOrderLine, ChangeOrderPrefill, ChangeOrderScope } from './ChangeOrders'
import { styleLabel } from './fenceCatalog'
import { newId } from './recordSync'
import { GATE_WIDTH_IN, type YardLayout } from './yardLayout'

type Style = NonNullable<QuoteCalcInput['style']>

const ft = (runs: Array<{ ft: number }>) => Math.round(runs.reduce((s, r) => s + (r.ft > 0 ? r.ft : 0), 0) * 100) / 100
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
// Priced from cost, never at a price set by hand: a hand set price is the same before and after
// every step, so each line came out $0 and the change order could not be saved (seen Oct 23, 2026
// on a signed quote with its price typed in). The step's difference is what the change costs today.
/** The step's price (cents) and its panels: in all, and on each run (per run rounding, never pooled). */
const priced = (input: QuoteCalcInput, base: ChangeBase): { cents: number; sections: number; perRun: number[] } => {
  if (!input.style) return { cents: 0, sections: 0, perRun: [] }
  const { finalPrice, ...o } = input.overrides ?? {}; void finalPrice
  const c = calculateQuote({ ...changeOrderInput(input, base), overrides: { ...o, wholeDollar: true } })
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
  /** The new version's change order price (dollars; changeOrderPricing.ts changeOrderPrice): the one price difference line is this minus the job as it stands. */
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
  /** The job's other change orders and the gates it was sold with: a gate one added, taken out here, is credited what it charged (changeOrderPricing.ts gateCreditOf). */
  earlier?: { orders: EarlierOrder[]; sold: { walkGates: number; dblGates: number } } | null
}

/** "Remove 1 walk gate in the Back side: the full CO-1 charge back (its 4 ft of fence goes back in)". */
function creditWords(c: GateCredit): string {
  const what = [c.walk ? plural(c.walk, 'walk gate') : '', c.dbl ? plural(c.dbl, 'double gate') : ''].filter(Boolean).join(' and ')
  const names = c.sides.map(n => (/(^|\s)(side|return|run)$/i.test(n) ? n : `${n} side`))
  const where = names.length ? ` in the ${names.length === 1 ? names[0] : `${names.slice(0, -1).join(', the ')} and the ${names[names.length - 1]}`}` : ''
  const orders = c.numbers.map(n => `CO-${n}`).join(' and ')
  return `Remove ${what}${where}: the full ${orders} charge back${c.openingFt ? ` (${c.openingFt} ft of fence goes back in)` : ''}`
}

/** What changed on the signed quote, as lines with amounts in cents. */
export function changeOrderDraft(d: DraftInput): ChangeOrderPrefill {
  const s = d.signed, cur = d.current
  const signedStyle = d.styles.find(x => x.name === s.fenceStyle) ?? cur.style
  const soldRuns = s.runs.map((f, i) => ({ ft: f, rail: s.runRails?.[i] ?? 'auto' as const }))
  // Gates an earlier change order added come off first, at what it charged; the rest is the change from there.
  const credit = !d.simple && signedStyle && d.earlier ? gateCreditOf(d.earlier.orders, d.earlier.sold, { ...s, runs: soldRuns }, cur, d.now) : null
  const from = credit ? credit.work : { runs: soldRuns, corners: s.corners, ends: s.ends, walkGates: s.walkGates, dblGates: s.dblGates }
  const signedRuns = from.runs
  const ftWas = ft(signedRuns), ftNow = ft(cur.runs)
  const scope: ChangeOrderScope = {}
  const words: Array<{ text: string; step: (x: QuoteCalcInput) => QuoteCalcInput; runs?: boolean }> = []

  const styleNow = cur.style?.name ?? s.fenceStyle
  if (styleNow !== s.fenceStyle) {
    scope.fromStyle = s.fenceStyle; scope.toStyle = styleNow
    words.push({ text: `Change the fence from ${styleLabel(s.fenceStyle)} to ${styleLabel(styleNow)}`, step: x => ({ ...x, style: cur.style }) })
  }
  const runsChanged = JSON.stringify(cur.runs.filter(r => r.ft > 0).map(r => r.ft)) !== JSON.stringify(signedRuns.map(r => r.ft)) || cur.corners !== from.corners || cur.ends !== from.ends
  const gatesToo = cur.walkGates !== from.walkGates || cur.dblGates !== from.dblGates
  const walkIn = Math.max(0, cur.walkGates - from.walkGates), dblIn = Math.max(0, cur.dblGates - from.dblGates)
  const delta = Math.round((ftNow - ftWas) * 100) / 100
  const openingFt = Math.round((d.gatesIn?.openingFt ?? gateOpeningFt(cur, from)) * 100) / 100
  // A gate put into a side (round 3, Oct 26 2026): "Remove 4 ft of fence, 1 panel more +$128" then "Add 1 walk gate
  // +$202" read as paying for fence taken away. When the fence taken out is just the new gates' opening, it is one
  // change: "Add 1 walk gate in the Back side (4 ft of fence becomes the gate)", the two price steps as one.
  const gateIntoSide = runsChanged && (walkIn + dblIn) > 0 && delta < 0 && Math.abs(-delta - openingFt) < 0.01
    && cur.walkGates >= from.walkGates && cur.dblGates >= from.dblGates
  if (gateIntoSide) {
    if (delta) scope.footageFt = delta
    if (walkIn) scope.walkGates = walkIn
    if (dblIn) scope.dblGates = dblIn
    const what = [walkIn ? plural(walkIn, 'walk gate') : '', dblIn ? plural(dblIn, 'double gate') : ''].filter(Boolean).join(' and ')
    // "the Back side", "the Left side" (a name that says side already), "the Left return".
    const sides = (d.gatesIn?.sides ?? []).filter(Boolean).map(n => (/(^|\s)(side|return|run)$/i.test(n) ? n : `${n} side`))
    const where = sides.length ? ` in the ${sides.length === 1 ? sides[0] : `${sides.slice(0, -1).join(', the ')} and the ${sides[sides.length - 1]}`}` : ''
    words.push({
      text: `Add ${what}${where} (${openingFt} ft of fence becomes the gate${walkIn + dblIn > 1 ? 's' : ''})`,
      step: x => ({ ...x, runs: cur.runs, corners: cur.corners, ends: cur.ends, walkGates: cur.walkGates, dblGates: cur.dblGates }),
    })
  } else if (runsChanged) {
    if (delta) scope.footageFt = delta
    // Gate openings are not fence: a 12 ft side with a 4 ft gate adds 8 ft of fence and a gate (its own line).
    const opening = (walkIn + dblIn) > 0 && delta < 0 ? `; ${Math.min(openingFt, -delta)} ft of it becomes the new gate${walkIn + dblIn > 1 ? 's' : ''}` : ''
    const span = d.sides
      ? `${d.sides}${gatesToo ? '; the fence feet leave out the gates' : ''}${opening}`
      : `${ftWas} ft to ${ftNow} ft${gatesToo ? ' of fence, gates not counted' : ''}${opening}`
    words.push({
      text: delta > 0 ? `Add ${delta} ft of fence (${span})` : delta < 0 ? `Remove ${-delta} ft of fence (${span})` : 'Change the fence line (same footage, different runs or posts)',
      step: x => ({ ...x, runs: cur.runs, corners: cur.corners, ends: cur.ends }),
      runs: true,
    })
  }
  if (gateIntoSide) { /* the gates are on the line above */ } else if (cur.walkGates !== from.walkGates) {
    const n = cur.walkGates - from.walkGates
    scope.walkGates = n
    words.push({ text: n > 0 ? `Add ${plural(n, 'walk gate')}` : `Remove ${plural(-n, 'walk gate')}`, step: x => ({ ...x, walkGates: cur.walkGates }) })
  }
  if (!gateIntoSide && cur.dblGates !== from.dblGates) {
    const n = cur.dblGates - from.dblGates
    scope.dblGates = n
    words.push({ text: n > 0 ? `Add ${plural(n, 'double gate')}` : `Remove ${plural(-n, 'double gate')}`, step: x => ({ ...x, dblGates: cur.dblGates }) })
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
  if (credit) {
    const feet = Math.round((ftNow - ft(soldRuns)) * 100) / 100
    if (feet) scope.footageFt = feet; else delete scope.footageFt
    if (cur.walkGates !== s.walkGates) scope.walkGates = cur.walkGates - s.walkGates; else delete scope.walkGates
    if (cur.dblGates !== s.dblGates) scope.dblGates = cur.dblGates - s.dblGates; else delete scope.dblGates
  }
  // The reason is typed by whoever makes it (required, Oct 26 2026), never a generic sentence.
  const done = (lines: ChangeOrderLine[]): ChangeOrderPrefill => ({ reason: '', lines, scope: Object.keys(scope).length ? scope : null })

  if (d.simple || !signedStyle) {
    const lines = words.filter(w => w.text !== 'Other price changes').map(w => ({ id: newId(), description: w.text, amountCents: 0 }))
    const typed = workOffContract(d.earlier?.orders ?? []).priceOnly.reduce((t, o) => t + o.lines.reduce((n, l) => n + l.amountCents, 0), 0)
    const diff = wholeDollarCents(Math.round(d.priceNow * 100) - (Math.round(s.finalPrice * 100) - typed)).cents
    lines.push({ id: newId(), description: lines.length ? DIFFERENCE_LINE : CHANGES_LINE, amountCents: diff })
    return done(lines)
  }

  // Price the signed work today, then put each change on it in turn.
  let at: QuoteCalcInput = {
    ...cur, style: signedStyle, ...from,
    tearOutSections: s.tearOutSections, tearOutGates: s.tearOutGates, extraLaborHrs: s.adjLaborHrs || 0, hasSalesman: !!s.hasSalesman,
    priceAdjust: s.priceAdjust || 0, overrides: d.signedOverrides,
  }
  const base = changeBaseOf(s, d.now, signedStyle)
  let was = priced(at, base)
  // The one side whose length changed (same sides otherwise), for "still 7 panels on that side".
  const ftNowRuns = cur.runs.map(r => r.ft)
  const diffs = ftNowRuns.length === signedRuns.length ? ftNowRuns.map((f, i) => (f === signedRuns[i].ft ? -1 : i)).filter(i => i >= 0) : []
  const oneSide = diffs.length === 1 ? diffs[0] : null
  const lines: ChangeOrderLine[] = credit ? [{ id: newId(), description: creditWords(credit), amountCents: -credit.cents }] : []
  for (const w of words) {
    at = w.step(at)
    const now = priced(at, base)
    const amount = now.cents - was.cents
    if (w.text === 'Other price changes' && !amount && !restChanged) { was = now; continue }
    lines.push({ id: newId(), description: w.runs ? runWords(w.text, was, now, amount, oneSide, !!d.sides) : w.text, amountCents: amount })
    was = now
  }
  return done(lines)
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
