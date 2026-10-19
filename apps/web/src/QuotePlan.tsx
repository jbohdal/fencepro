/**
 * A saved quote's site plan, drawn from the layout it was saved with and the
 * sections each run was priced at. Nothing when the quote has no layout
 * (typed as a run list, or saved before layouts).
 */

import SitePlan from './SitePlan'
import { deriveLayout } from './yardLayout'
import type { SavedQuote } from './QuotesPage'

export function quoteHasPlan(quote: Pick<SavedQuote, 'layout'>): boolean {
  return !!quote.layout?.yard
}

export default function QuotePlan({ quote, caption = true }: { quote: Pick<SavedQuote, 'layout' | 'runs'>; caption?: boolean }) {
  const yard = quote.layout?.yard
  if (!yard) return null
  const result = deriveLayout(yard)
  const secs = quote.layout?.runSections
  // Only use the saved sections when they still line up with the runs.
  const runSections = secs && secs.length === result.runs.length ? secs : undefined
  return (
    <figure style={{ margin: 0 }} data-quote-plan>
      <SitePlan layout={yard} result={result} runSections={runSections} title="Site plan" />
      {caption && (
        <figcaption style={{ fontSize: 11, color: '#5F5769', marginTop: 6 }}>
          Purple: new fence. Purple squares: corner posts. Dark squares: gate hinge posts. Dots: end and gate latch posts. Dashed arcs: which way each gate swings. Open dots: line posts. Gray dashed: existing fence or no fence, not included.
        </figcaption>
      )}
    </figure>
  )
}
