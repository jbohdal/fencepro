/**
 * Each run of a saved quote with its sections and the post to post spacing
 * the crew sets them at (sections are spaced evenly along the run). Used on
 * the quote drawer and the crew pull sheet.
 */

import { getConfig } from './configStore'
import { savedRunSections } from './quoteCalc'
import { deriveLayout, formatFtIn, postSpacing } from './yardLayout'
import { quotePlanWidth } from './QuotePlan'
import type { SavedQuote } from './QuotesPage'

export default function RunSpacingTable({ quote }: { quote: Pick<SavedQuote, 'runs' | 'sections' | 'fenceStyle' | 'layout'> }) {
  const runs = quote.runs || []
  if (runs.length === 0) return null
  const styleCfg = getConfig().fenceStyles.find(s => s.name === quote.fenceStyle)
  const sections = savedRunSections(quote, styleCfg?.panelWidth)
  // Side names from the layout, when the quote has one and it still matches.
  const yard = quote.layout?.yard
  const fromYard = yard ? deriveLayout(yard, quotePlanWidth(yard, quote, styleCfg).nearIn).runs : []
  const names = fromYard.length === runs.length
    ? fromYard.map(r => (r.pieces > 1 ? `${r.sideName} (${r.piece} of ${r.pieces})` : r.sideName))
    : runs.map((_, i) => `Run ${i + 1}`)
  const total = sections.reduce((s, n) => s + n, 0)
  const feet = runs.reduce((s, n) => s + n, 0)

  return (
    <table className="w-full text-sm" data-run-spacing>
      <thead>
        <tr className="text-xs font-semibold text-gray-600 border-b border-gray-200">
          <th className="text-left py-2">Run</th>
          <th className="text-right py-2">Length</th>
          <th className="text-right py-2">Sections</th>
          <th className="text-right py-2">Posts apart</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {runs.map((ft, i) => (
          <tr key={i}>
            <td className="py-2 text-gray-800">{names[i]}</td>
            <td className="py-2 text-right tabular-nums">{formatFtIn(ft * 12)}</td>
            <td className="py-2 text-right tabular-nums font-medium">{sections[i]}</td>
            <td className="py-2 text-right tabular-nums">{postSpacing(ft, sections[i])}</td>
          </tr>
        ))}
        <tr className="font-semibold border-t-2 border-gray-200">
          <td className="py-2">Total</td>
          <td className="py-2 text-right tabular-nums">{formatFtIn(feet * 12)}</td>
          <td className="py-2 text-right tabular-nums">{total}</td>
          <td />
        </tr>
      </tbody>
    </table>
  )
}
