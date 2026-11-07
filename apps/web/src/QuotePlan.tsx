/**
 * A saved quote's site plan, drawn from the layout it was saved with and the
 * sections each run was priced at. Nothing when the quote has no layout
 * (typed as a run list, or saved before layouts).
 */

import SitePlan from './SitePlan'
import { deriveLayout, sitePlanNeeded, type YardLayout } from './yardLayout'
import { walkSheetSvg } from './walkList'
import { sketchSvg } from './sketch'
import { gateWhereText, layoutPanelFt, savedQuoteNearIn } from './gateSlide'
import { DEFAULT_FENCE_STYLES } from './configDefaults'
import type { SavedQuote } from './QuotesPage'

/**
 * Has a plan to show. A walked quote whose plan the office has not drawn yet ("Site plan needed"): the customer sees
 * no picture (price and options only); staff see the walk list sheet (QuotePlan).
 */
export function quoteHasPlan(quote: Pick<SavedQuote, 'layout'> & { proposal?: { planSvg?: string } | null }, opts: { customer?: boolean } = {}): boolean {
  // The customer sees the sketch (feet and gates) when it was saved on the proposal (Settings → Proposals, on by default).
  if (sitePlanNeeded(quote.layout)) return !opts.customer || !!quote.proposal?.planSvg
  return !!quote.layout?.yard
}

type PlanStyle = { name: string; panelWidth?: number; autoRailMix?: boolean }

/**
 * Where a saved quote's "near the house / corner" gates sit, as the builder
 * placed them: one panel of the quote's style in (gateSlide.ts), checked
 * against the runs it was priced on. The panel width and the inches.
 */
export function quotePlanWidth(yard: YardLayout, quote: { fenceStyle?: string; runs?: number[] }, style?: PlanStyle | null): { widthFt: number; nearIn: number } {
  const s = style ?? (quote.fenceStyle ? DEFAULT_FENCE_STYLES.find(x => x.name === quote.fenceStyle) ?? { name: quote.fenceStyle } : null)
  const widthFt = layoutPanelFt(s)
  return { widthFt, nearIn: savedQuoteNearIn(yard, quote.runs, widthFt) }
}

export default function QuotePlan({ quote, style, caption = true, customer = false }: { quote: Pick<SavedQuote, 'layout' | 'runs'> & { fenceStyle?: string }; style?: PlanStyle | null; caption?: boolean; customer?: boolean }) {
  // Walked, not drawn yet. The customer: the sketch with its feet and gates. Staff: the walk list as measured (table and sketch).
  if (sitePlanNeeded(quote.layout) && quote.layout?.walk && customer) {
    return <figure style={{ margin: 0 }} data-quote-plan data-walk-sketch dangerouslySetInnerHTML={{ __html: sketchSvg(quote.layout.walk).replace('<svg ', '<svg style="width:100%;height:auto" ') }} />
  }
  if (sitePlanNeeded(quote.layout) && quote.layout?.walk) {
    return <figure style={{ margin: 0 }} data-quote-plan data-walk-sheet dangerouslySetInnerHTML={{ __html: walkSheetSvg(quote.layout.walk).replace('<svg ', '<svg style="width:100%;height:auto" ') }} />
  }
  const yard = quote.layout?.yard
  if (!yard) return null
  const { widthFt, nearIn } = quotePlanWidth(yard, quote, style)
  const result = deriveLayout(yard, nearIn)
  const secs = quote.layout?.runSections
  // Only use the saved sections when they still line up with the runs.
  const runSections = secs && secs.length === result.runs.length ? secs : undefined
  return (
    <figure style={{ margin: 0 }} data-quote-plan>
      <SitePlan layout={yard} result={result} runSections={runSections} widthFt={widthFt} title="Site plan" />
      {(() => {
        // Each gate, both ways: "Back: 5 ft walk gate, 12 ft from the Left side corner, 31 ft to the Right side corner".
        const gates = yard.sides.map((s, i) => (s.on && s.gate ? gateWhereText(yard, i, nearIn) : null)).map((t, i) => (t ? `${yard.sides[i].name}: ${t}` : null)).filter((t): t is string => !!t)
        return gates.length > 0 && (
          <div style={{ fontSize: 12, color: '#1F1A24', marginTop: 6 }} data-quote-plan-gates>
            {gates.map(g => <p key={g} style={{ margin: '2px 0' }} data-quote-plan-gate>{g}</p>)}
          </div>
        )
      })()}
      {caption && (
        <figcaption style={{ fontSize: 11, color: '#5F5769', marginTop: 6 }}>
          Purple: new fence. Purple squares: corner posts. Dark squares: gate hinge posts. Dots: end and gate latch posts. Dashed arcs: which way each gate swings. Open dots: line posts. Gray dashed: existing fence or no fence, not included.
        </figcaption>
      )}
    </figure>
  )
}
