/**
 * A walked job's fence as measured (walkList.ts), on the job views: "Site plan
 * needed" until the office draws the plan, the table of sides (feet, what is at
 * the end, gates with width and single or double) and the rough sketch, not to
 * scale. Nothing when the quote was not walked.
 */

import { sitePlanNeeded } from './yardLayout'
import { sketchSvgBody, walkTable, feetText, totalIn, type WalkList } from './walkList'

export default function WalkSheetView({ layout }: { layout: { walk?: WalkList | null; planDone?: boolean } | null | undefined }) {
  const walk = layout?.walk
  if (!walk) return null
  const rows = walkTable(walk)
  const needed = sitePlanNeeded(layout)
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3 space-y-2" data-walk-sheet-view>
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-900">Fence as measured (walk list) · {feetText(totalIn(walk))}</h3>
        {needed && <span className="text-xs font-bold uppercase tracking-wide text-amber-900 bg-amber-100 border border-amber-300 rounded px-2 py-0.5" data-site-plan-needed>Site plan needed</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 pr-2">Side</th><th className="pr-2">Feet</th><th className="pr-2">At its end</th><th>Gates</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.side} className="border-t border-gray-100" data-walk-sheet-row>
                <td className="py-1 pr-2 text-gray-900">{r.side}</td><td className="pr-2">{r.feet}</td><td className="pr-2">{r.end}</td><td className="text-gray-700">{r.gates}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <figure className="m-0">
        <svg viewBox="0 0 340 220" className="w-full max-w-md h-auto" role="img" aria-label="Rough sketch, not to scale" dangerouslySetInnerHTML={{ __html: sketchSvgBody(walk, 340, 220) }} />
      </figure>
    </section>
  )
}
