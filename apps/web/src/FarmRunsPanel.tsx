/**
 * Farm fence on the quote builder's Price step (Jonathan, Nov 5 2026), staff
 * only (the customer sees the style, option and price): each run's length,
 * spans at the target spacing, the actual spacing (ft and in) and the 16 ft
 * boards a row takes; the wire rolls spliced or with clean corners, with the
 * feet left over both ways (the choice prices the quote); and on a Crossbuck,
 * the X spacing helper and the note to dry fit one panel.
 */

import { useState } from 'react'
import { crossbuckGap, farmOf, farmRolls, farmRuns, feetInches } from './farm'

const small = 'text-xs text-gray-600 leading-snug'

export default function FarmRunsPanel({ style, runs, rollJoin, onRollJoin }: {
  style: { material?: string; choices?: Record<string, string> | null; panelWidth?: number } | null | undefined
  runs: number[]
  rollJoin: 'splice' | 'clean'
  onRollJoin: (v: 'splice' | 'clean') => void
}) {
  const f = farmOf(style)
  const [opening, setOpening] = useState('42')
  if (!f) return null
  const target = style?.panelWidth && style.panelWidth > 0 ? style.panelWidth : f.style.spacing
  const rows = farmRuns(runs, target)
  if (!rows.length) return null
  const spans = rows.reduce((t, r) => t + r.spans, 0)
  const boards = rows.reduce((t, r) => t + r.boardsPerRow, 0) * f.style.rows
  const rolls = f.wire.part ? farmRolls(runs) : null
  const open = Number(opening)
  const gap = f.style.x ? crossbuckGap(open, f.post.diameterIn) : null
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3" data-farm-runs>
      <div>
        <p className="text-xs font-semibold text-gray-800">Farm fence runs ({f.style.label}, {feetInches(target)} target spacing). Internal only.</p>
        <div className="mt-1 overflow-x-auto">
          <table className="w-full text-xs text-gray-700">
            <thead><tr className="text-left text-gray-500"><th className="py-1 pr-2">Run</th><th className="pr-2">Length</th><th className="pr-2">Spans</th><th className="pr-2">Spacing</th><th>Boards a row</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-t border-gray-200" data-farm-run={i}>
                  <td className="py-1 pr-2">{i + 1}</td><td className="pr-2">{r.ft} ft</td><td className="pr-2">{r.spans}</td>
                  <td className="pr-2">{feetInches(r.spacingFt)} <span className="text-gray-400">({r.spacingFt.toFixed(2)} ft)</span></td><td>{r.boardsPerRow}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={small} data-farm-totals>{spans} spans; {boards} boards ({f.style.rows} row{f.style.rows === 1 ? '' : 's'}){f.style.x ? `, and ${spans} boards cut in half for the X (one a span)` : ''}.</p>
      </div>
      {rolls && (
        <fieldset className="space-y-1" data-farm-rolls>
          <legend className="text-xs font-semibold text-gray-800">Wire rolls (200 ft)</legend>
          {([['splice', 'Splice', rolls.splice, rolls.spliceLeftFt], ['clean', 'Clean corners (a new roll at each corner)', rolls.clean, rolls.cleanLeftFt]] as const).map(([k, label, n, left]) => (
            <label key={k} className="flex items-center gap-3 min-h-[44px] text-sm text-gray-800">
              <input type="radio" name="farm-roll-join" className="w-5 h-5 accent-orange-500" checked={rollJoin === k} onChange={() => onRollJoin(k)} data-farm-roll-join={k} />
              <span>{label}: {n} roll{n === 1 ? '' : 's'}, {left} ft left over</span>
            </label>
          ))}
        </fieldset>
      )}
      {f.style.x && (
        <div className="space-y-1" data-farm-x-helper>
          <p className="text-xs font-semibold text-gray-800">X spacing helper</p>
          <label className="flex items-center gap-2 text-xs text-gray-700">Opening between the top and bottom boards
            <input className="w-20 border border-gray-300 rounded-lg px-2 min-h-[44px] text-sm bg-white" inputMode="numeric" value={opening} onChange={e => setOpening(e.target.value)} data-farm-x-opening /> in
          </label>
          <p className={small} data-farm-x-gap>{gap
            ? `A half board (96") across a ${open}" opening clears ${Math.round(gap.clearIn)}" between posts; posts ${Math.round(gap.centersIn)}" on centers with ${f.post.diameterIn}" posts (${feetInches(gap.centersIn / 12)}).`
            : 'Type an opening under 96".'}</p>
          <p className={small}>36" opening = 89" clear, 42" = 86", 48" = 83" (√(96² − opening²)), plus the post diameter on centers.</p>
          <p className="text-xs text-amber-800 leading-snug" data-farm-dry-fit>Dry fit one panel before cutting the rest. Trimmed boards leave about 1 ft of scrap at 7.5 ft spacing.</p>
        </div>
      )}
    </div>
  )
}
