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
 * never billed to the customer. Amounts are integer cents.
 *
 * A move or repair, or a login that sees prices only (the server prices
 * their quotes), gets the changes as lines and one price difference line:
 * today's price of the new version minus the signed price.
 */
import { calculateQuote, type QuoteCalcInput } from './quoteCalc'
import type { SavedQuote } from './QuotesPage'
import type { ChangeOrderLine, ChangeOrderPrefill, ChangeOrderScope } from './ChangeOrders'
import { styleLabel } from './fenceCatalog'
import { newId } from './recordSync'

type Style = NonNullable<QuoteCalcInput['style']>

const ft = (runs: Array<{ ft: number }>) => Math.round(runs.reduce((s, r) => s + (r.ft > 0 ? r.ft : 0), 0) * 100) / 100
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const priceCents = (input: QuoteCalcInput) => (input.style ? Math.round(calculateQuote(input).priced.price * 100) : 0)

export interface DraftInput {
  /** The signed quote as saved. */
  signed: SavedQuote
  /** The quote builder's inputs now (what was changed). */
  current: QuoteCalcInput
  /** The pricing choices the quote builder opened with (the signed quote's). */
  signedOverrides: QuoteCalcInput['overrides']
  /** Every style (the signed one is looked up by name). */
  styles: Style[]
  /** The price the quote builder shows now (dollars). */
  priceNow: number
  /** Sections now. */
  sectionsNow: number
  /** A move or repair, or a prices only login: one price difference line. */
  simple: boolean
}

/** What changed on the signed quote, as lines with amounts in cents. */
export function changeOrderDraft(d: DraftInput): ChangeOrderPrefill {
  const s = d.signed, cur = d.current
  const signedStyle = d.styles.find(x => x.name === s.fenceStyle) ?? cur.style
  const signedRuns = s.runs.map((f, i) => ({ ft: f, rail: s.runRails?.[i] ?? 'auto' as const }))
  const ftWas = ft(signedRuns), ftNow = ft(cur.runs)
  const scope: ChangeOrderScope = {}
  const words: Array<{ text: string; step: (x: QuoteCalcInput) => QuoteCalcInput }> = []

  const styleNow = cur.style?.name ?? s.fenceStyle
  if (styleNow !== s.fenceStyle) {
    scope.fromStyle = s.fenceStyle; scope.toStyle = styleNow
    words.push({ text: `Change the fence from ${styleLabel(s.fenceStyle)} to ${styleLabel(styleNow)}`, step: x => ({ ...x, style: cur.style }) })
  }
  const runsChanged = JSON.stringify(cur.runs.filter(r => r.ft > 0).map(r => r.ft)) !== JSON.stringify(s.runs) || cur.corners !== s.corners || cur.ends !== s.ends
  if (runsChanged) {
    const delta = Math.round((ftNow - ftWas) * 100) / 100
    if (delta) scope.footageFt = delta
    words.push({
      text: delta > 0 ? `Add ${delta} ft of fence (${ftWas} ft to ${ftNow} ft)` : delta < 0 ? `Remove ${-delta} ft of fence (${ftWas} ft to ${ftNow} ft)` : 'Change the fence line (same footage, different runs or posts)',
      step: x => ({ ...x, runs: cur.runs, corners: cur.corners, ends: cur.ends }),
    })
  }
  if (cur.walkGates !== s.walkGates) {
    const n = cur.walkGates - s.walkGates
    scope.walkGates = n
    words.push({ text: n > 0 ? `Add ${plural(n, 'walk gate')}` : `Remove ${plural(-n, 'walk gate')}`, step: x => ({ ...x, walkGates: cur.walkGates }) })
  }
  if (cur.dblGates !== s.dblGates) {
    const n = cur.dblGates - s.dblGates
    scope.dblGates = n
    words.push({ text: n > 0 ? `Add ${plural(n, 'double gate')}` : `Remove ${plural(-n, 'double gate')}`, step: x => ({ ...x, dblGates: cur.dblGates }) })
  }
  if (cur.tearOutSections !== s.tearOutSections || cur.tearOutGates !== s.tearOutGates) {
    const a = cur.tearOutSections - s.tearOutSections, b = cur.tearOutGates - s.tearOutGates
    const parts = [a ? `${a > 0 ? 'add' : 'remove'} ${plural(Math.abs(a), 'section')}` : '', b ? `${b > 0 ? 'add' : 'remove'} ${plural(Math.abs(b), 'gate')}` : ''].filter(Boolean)
    words.push({ text: `Tear out: ${parts.join(', ')}`, step: x => ({ ...x, tearOutSections: cur.tearOutSections, tearOutGates: cur.tearOutGates }) })
  }
  const restChanged = cur.extraLaborHrs !== (s.adjLaborHrs || 0) || cur.hasSalesman !== !!s.hasSalesman || cur.priceAdjust !== (s.priceAdjust || 0)
    || JSON.stringify(cur.overrides ?? {}) !== JSON.stringify(d.signedOverrides ?? {})
  words.push({ text: 'Other price changes', step: x => ({ ...x, extraLaborHrs: cur.extraLaborHrs, hasSalesman: cur.hasSalesman, priceAdjust: cur.priceAdjust, overrides: cur.overrides }) })

  const sectionsDelta = d.sectionsNow - s.sections
  if (sectionsDelta) scope.sections = sectionsDelta
  const reason = 'Changed after the quote was signed.'
  const done = (lines: ChangeOrderLine[]): ChangeOrderPrefill => ({ reason, lines, scope: Object.keys(scope).length ? scope : null })

  if (d.simple || !signedStyle) {
    const lines = words.filter(w => w.text !== 'Other price changes').map(w => ({ id: newId(), description: w.text, amountCents: 0 }))
    const diff = Math.round(d.priceNow * 100) - Math.round(s.finalPrice * 100)
    lines.push({ id: newId(), description: lines.length ? "Price difference at today's prices" : "Changes to the work, at today's prices", amountCents: diff })
    return done(lines)
  }

  // Price the signed work today, then put each change on it in turn.
  let at: QuoteCalcInput = {
    ...cur, style: signedStyle, runs: signedRuns, corners: s.corners, ends: s.ends, walkGates: s.walkGates, dblGates: s.dblGates,
    tearOutSections: s.tearOutSections, tearOutGates: s.tearOutGates, extraLaborHrs: s.adjLaborHrs || 0, hasSalesman: !!s.hasSalesman,
    priceAdjust: s.priceAdjust || 0, overrides: d.signedOverrides,
  }
  let was = priceCents(at)
  const lines: ChangeOrderLine[] = []
  for (const w of words) {
    at = w.step(at)
    const now = priceCents(at)
    const amount = now - was
    was = now
    if (w.text === 'Other price changes' && !amount && !restChanged) continue
    lines.push({ id: newId(), description: w.text, amountCents: amount })
  }
  return done(lines)
}
