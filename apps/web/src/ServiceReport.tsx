/**
 * Reports → Service: warranty and service requests by month (covered, not
 * covered, not decided yet), and what covered work cost by fence style and by
 * the crew that installed the fence, so a style or a crew with problems shows.
 * Covered work's cost is entered when a request is Fixed (crew hours and
 * materials, costed like job costing). Owner and office only (the server
 * refuses everyone else). The math is serviceTicketModel.ts serviceReport.
 */

import { useEffect, useState } from 'react'
import { loadServiceReport, usd, type ServiceReportData } from './serviceStore'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (ym: string) => { const [y, m] = ym.split('-'); return m ? `${MONTHS[Number(m) - 1] ?? m} ${y}` : ym }
const ymNow = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }).slice(0, 7)
const back11 = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 7) }
type View = 'month' | 'style' | 'installer'

export default function ServiceReport() {
  const [to, setTo] = useState(ymNow)
  const [from, setFrom] = useState(() => back11(ymNow()))
  const [data, setData] = useState<ServiceReportData | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('month')
  useEffect(() => {
    let live = true
    setData(undefined)
    loadServiceReport(from, to).then(r => { if (!live) return; if (r.ok) { setData(r.data); setError('') } else { setData(null); setError(r.error) } })
    return () => { live = false }
  }, [from, to])

  return (
    <div className="space-y-4 min-w-0" data-service-report>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-gray-600">From<input type="month" value={from} onChange={e => e.target.value && setFrom(e.target.value)} className="block border border-gray-300 rounded-lg h-11 px-2 text-sm" data-service-report-from /></label>
        <label className="text-xs text-gray-600">Through<input type="month" value={to} onChange={e => e.target.value && setTo(e.target.value)} className="block border border-gray-300 rounded-lg h-11 px-2 text-sm" data-service-report-to /></label>
      </div>
      {data === undefined && <p className="text-sm text-gray-500 p-4">Loading…</p>}
      {data === null && <p className="text-sm text-red-700 p-4">Could not load the service report. {error}</p>}
      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Requests" value={String(data.totals.tickets)} sub={`${data.totals.open} still open`} id="tickets" />
            <Kpi label="Covered" value={String(data.totals.covered)} sub={`${data.totals.notCovered} not covered · ${data.totals.undecided} not decided`} id="covered" />
            <Kpi label="Cost of covered work" value={usd(data.totals.coveredCostCents)} sub={`${data.totals.costed} of ${data.totals.covered} covered costed`} id="cost" />
            <Kpi label="Average covered fix" value={data.totals.costed ? usd(Math.round(data.totals.coveredCostCents / data.totals.costed)) : '$0.00'} sub="crew hours and materials" id="average" />
          </div>
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto" role="tablist">
            {([['month', 'By month'], ['style', 'By style'], ['installer', 'By installer']] as Array<[View, string]>).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} className={`px-3 min-h-[44px] rounded-md text-sm whitespace-nowrap ${view === k ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500'}`} onClick={() => setView(k)} data-service-report-view={k}>{l}</button>
            ))}
          </div>
          {view === 'month' && (
            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100" data-service-report-months>
              {data.byMonth.length === 0 && <p className="p-4 text-sm text-gray-500">No service requests in these months.</p>}
              {data.byMonth.map(m => (
                <div key={m.month} className="p-3 text-sm" data-service-report-month={m.month}>
                  <div className="flex justify-between gap-2"><span className="font-medium text-gray-900">{monthLabel(m.month)}</span><span className="tabular-nums text-gray-700">{m.tickets} request{m.tickets === 1 ? '' : 's'}</span></div>
                  <p className="text-xs text-gray-600 tabular-nums">{m.covered} covered · {m.notCovered} not covered · {m.undecided} not decided · covered work {usd(m.coveredCostCents)}</p>
                </div>
              ))}
            </div>
          )}
          {view === 'style' && <CostRows rows={data.byStyle} name="style" empty="No covered work in these months." />}
          {view === 'installer' && <CostRows rows={data.byInstaller} name="installer" empty="No covered work in these months." />}
          <p className="text-xs text-gray-500">Style and installer are the original job's: the fence style and the crew on the job when it was installed. Only covered requests count toward cost.</p>
        </>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, id }: { label: string; value: string; sub?: string; id: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 min-w-0" data-service-kpi={id}>
      <p className="text-xs font-semibold text-gray-400">{label}</p>
      <p className="text-xl font-bold tabular-nums truncate text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1 truncate">{sub}</p>}
    </div>
  )
}

function CostRows({ rows, name, empty }: { rows: ServiceReportData['byStyle']; name: string; empty: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100" data-service-report-rows={name}>
      {rows.length === 0 && <p className="p-4 text-sm text-gray-500">{empty}</p>}
      {rows.map(r => (
        <div key={r.key} className="p-3 text-sm" data-service-report-row={r.key}>
          <div className="flex justify-between gap-2"><span className="font-medium text-gray-900 break-words">{r.key}</span><span className="tabular-nums font-semibold text-gray-900">{usd(r.costCents)}</span></div>
          <p className="text-xs text-gray-600 tabular-nums">{r.tickets} covered request{r.tickets === 1 ? '' : 's'} · {r.costed} costed · labor {usd(r.laborCents)} · materials {usd(r.materialCents)} · average {usd(r.averageCents)}</p>
        </div>
      ))}
    </div>
  )
}
