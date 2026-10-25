/**
 * In the quote builder, on a quote from the website quote: the customer's own
 * drawing as they drew it (the photo snapshot), each side measured from the
 * photo or typed by them, and the option they picked. Read only: the builder's
 * yard above is the salesman's to change; this stays as the customer left it.
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import type { WidgetDrawingRecord } from './yardLayout'

/** The server the files are on (the dev server on localhost, else this site). */
const apiUrl = (p: string) => (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '') + p
const money = (n: number) => '$' + Math.round(n).toLocaleString('en-US')

export default function CustomerDrawing({ record }: { record: WidgetDrawingRecord }) {
  const [open, setOpen] = useState(true)
  const sides = (record.sides ?? []).flat()
  const when = record.drawnAt ? new Date(record.drawnAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden" data-customer-drawing>
      <button type="button" className="w-full min-h-[52px] flex items-center gap-2 px-3 text-left" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className="flex-1 font-semibold text-gray-900">{record.source || 'Website, drawn by customer'}{when ? ` · ${when}` : ''}</span>
        {open ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {record.snapshotUrl && <img src={apiUrl(record.snapshotUrl)} alt="The fence as the customer drew it on the aerial photo" className="w-full max-w-md rounded-lg border border-gray-200" data-customer-drawing-photo />}
          <ul className="text-sm text-gray-800 divide-y divide-gray-100" data-customer-drawing-sides>
            {sides.map(s => (
              <li key={`${s.run}-${s.side}`} className="flex items-center justify-between py-1.5">
                <span>Run {s.run}, side {s.side}</span>
                <span className="tabular-nums">
                  <span className="font-semibold">{s.ft} ft</span>{' '}
                  <span className={`text-xs rounded-full px-2 py-0.5 ${s.how === 'typed' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-700'}`} data-side-how={s.how}>
                    {s.how === 'typed' ? `typed (photo ${s.measuredFt} ft)` : 'measured'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {(record.photos ?? []).length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-customer-drawing-photos={(record.photos ?? []).length}>
              {(record.photos ?? []).map(u => (
                <a key={u} href={apiUrl(u)} target="_blank" rel="noreferrer" className="block aspect-square rounded-lg overflow-hidden border border-gray-200 bg-gray-100" aria-label="Open the customer's photo">
                  <img src={apiUrl(u)} alt="The customer's photo of the yard" className="w-full h-full object-cover" loading="lazy" />
                </a>
              ))}
            </div>
          )}
          {record.chosen && <p className="text-sm text-gray-700">The customer picked <span className="font-semibold">{record.chosen.name}</span> at {money(record.chosen.price)}{record.shown?.length > 1 ? ` (shown: ${record.shown.map(o => `${o.name} ${money(o.price)}`).join(', ')})` : ''}.</p>}
          <p className="text-xs text-gray-500">Kept as the customer drew it. Changes to the yard above do not change this.</p>
        </div>
      )}
    </div>
  )
}
