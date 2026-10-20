/**
 * Reports → Job Costing: quoted vs actual for every completed job, by style
 * (plain names), by salesman and by month, and the parts most often over or
 * under the pull sheet (to fix the kits). Totals add up only jobs with both a
 * quoted cost and an approved takeoff; the others are counted as "No takeoff".
 * Owner and office only (the server refuses everyone else).
 */

import { useEffect, useMemo, useState } from 'react'
import { styleLabel } from './fenceCatalog'
import { loadReport, groupReport, partTrends, usd, type ReportJob, type ReportGroup } from './takeoffStore'

const pct = (n: number) => `${n.toFixed(1)}%`
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (ym: string) => { const [y, m] = ym.split('-'); return m ? `${MONTHS[Number(m) - 1] ?? m} ${y}` : ym }
type View = 'jobs' | 'style' | 'salesman' | 'month' | 'parts'

export default function JobCostingReport() {
  const [jobs, setJobs] = useState<ReportJob[] | null | undefined>(undefined)
  const [view, setView] = useState<View>('jobs')
  const [onlyCosted, setOnlyCosted] = useState(true)
  useEffect(() => { loadReport().then(setJobs).catch(() => setJobs(null)) }, [])

  const costed = useMemo(() => (jobs ?? []).filter(j => j.takeoff === 'approved'), [jobs])
  const all = useMemo(() => groupReport(jobs ?? [], () => 'All')[0] ?? null, [jobs])
  const byStyle = useMemo(() => groupReport(jobs ?? [], j => styleLabel(j.fenceStyle) || j.fenceStyle), [jobs])
  const bySalesman = useMemo(() => groupReport(jobs ?? [], j => j.salesRep), [jobs])
  const byMonth = useMemo(() => groupReport(jobs ?? [], j => j.month, monthLabel).sort((a, b) => b.key.localeCompare(a.key)), [jobs])
  const parts = useMemo(() => partTrends(jobs ?? []), [jobs])

  if (jobs === undefined) return <p className="text-sm text-gray-500 p-4">Loading…</p>
  if (jobs === null) return <p className="text-sm text-red-700 p-4">Could not load job costing. Check the connection.</p>
  const shown = onlyCosted ? costed : jobs

  return (
    <div className="space-y-4 min-w-0" data-job-costing-report>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Completed jobs" value={String(jobs.length)} sub={`${costed.length} with an approved takeoff`} />
        <Kpi label="Quoted cost" value={all ? usd(all.quotedCents) : '$0.00'} sub={`${all?.costed ?? 0} jobs costed`} />
        <Kpi label="Actual cost" value={all ? usd(all.actualCents) : '$0.00'} sub={all ? `${all.diffCents > 0 ? '+' : ''}${usd(all.diffCents)} vs quoted` : ''} tone={all && all.diffCents > 0 ? 'bad' : 'good'} testId="actual" />
        <Kpi label="Actual profit" value={all ? usd(all.profitCents) : '$0.00'} sub={all ? `${pct(all.marginPct)} margin` : ''} testId="profit" />
      </div>
      <p className="text-xs text-gray-500">Jobs finished before job costing started have no takeoff and are shown "No takeoff"; they are not in the totals.</p>

      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto" role="tablist">
        {([['jobs', 'Jobs'], ['style', 'By style'], ['salesman', 'By salesman'], ['month', 'By month'], ['parts', 'Parts over / under']] as Array<[View, string]>).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={view === k} className={`px-3 min-h-[44px] rounded-md text-sm whitespace-nowrap ${view === k ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500'}`} onClick={() => setView(k)} data-jc-view={k}>{l}</button>
        ))}
      </div>

      {view === 'jobs' && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[44px]">
            <input type="checkbox" className="w-5 h-5" checked={onlyCosted} onChange={e => setOnlyCosted(e.target.checked)} data-jc-only-costed />
            Only jobs with an approved takeoff
          </label>
          <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100">
            {shown.length === 0 && <p className="p-4 text-sm text-gray-500">No jobs with an approved takeoff yet.</p>}
            {shown.slice(0, 300).map(j => <JobRow key={j.jobId} j={j} />)}
          </div>
          {shown.length > 300 && <p className="text-xs text-gray-500">Showing the latest 300 of {shown.length}.</p>}
        </div>
      )}
      {view === 'style' && <Groups groups={byStyle} name="Style" />}
      {view === 'salesman' && <Groups groups={bySalesman} name="Salesman" />}
      {view === 'month' && <Groups groups={byMonth} name="Month" />}
      {view === 'parts' && (
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100" data-jc-parts>
          {parts.length === 0 && <p className="p-4 text-sm text-gray-500">Every approved takeoff matched its pull sheet so far.</p>}
          {parts.map(p => (
            <div key={p.part} className="p-3 text-sm" data-jc-part={p.part}>
              <p className="font-medium text-gray-900 break-words">{p.part}</p>
              <p className="text-xs text-gray-600 tabular-nums">
                Over on {p.overJobs} of {p.jobs} jobs (+{p.overQty}) · under on {p.underJobs} (−{p.underQty}) · net <b className={p.netQty > 0 ? 'text-red-700' : 'text-green-700'}>{p.netQty > 0 ? '+' : ''}{p.netQty}</b>
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Kpi({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad'; testId?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4 min-w-0" data-jc-kpi={testId}>
      <p className="text-xs font-semibold text-gray-400">{label}</p>
      <p className={`text-xl font-bold tabular-nums truncate ${tone === 'bad' ? 'text-red-600' : tone === 'good' ? 'text-green-700' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1 truncate">{sub}</p>}
    </div>
  )
}

function JobRow({ j }: { j: ReportJob }) {
  const diff = j.quotedCents != null && j.actualCents != null ? j.actualCents - j.quotedCents : null
  const profit = j.actualCents != null ? j.priceCents - j.actualCents : null
  return (
    <div className="p-3 text-sm min-w-0" data-jc-job={j.jobId}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-medium text-gray-900 truncate">{j.customerName || 'No name'}</p>
        <span className="text-xs text-gray-500 shrink-0">{monthLabel(j.month)}</span>
      </div>
      <p className="text-xs text-gray-500 truncate">{styleLabel(j.fenceStyle) || j.fenceStyle} · {j.salesRep || 'No salesman'}</p>
      {j.takeoff !== 'approved' ? (
        <p className="text-xs font-semibold text-gray-600 mt-0.5" data-jc-no-takeoff>{j.takeoff === 'none' ? 'No takeoff' : j.takeoff === 'submitted' ? 'Takeoff waiting for approval' : 'Takeoff in progress'}</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs tabular-nums mt-0.5">
          <span>Price {usd(j.priceCents)}</span>
          <span>Quoted {j.quotedCents != null ? usd(j.quotedCents) : 'none'}</span>
          <span>Actual {usd(j.actualCents ?? 0)}{diff != null ? <b className={diff > 0 ? ' text-red-700' : ' text-green-700'}> ({diff > 0 ? '+' : ''}{usd(diff)})</b> : null}</span>
          <span>Profit {profit != null ? `${usd(profit)} (${j.priceCents > 0 ? pct((profit / j.priceCents) * 100) : '0.0%'})` : ''}</span>
        </div>
      )}
    </div>
  )
}

function Groups({ groups, name }: { groups: ReportGroup[]; name: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-100" data-jc-groups={name}>
      {groups.map(g => (
        <div key={g.key} className="p-3 text-sm min-w-0" data-jc-group={g.label}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-medium text-gray-900 break-words min-w-0">{g.label}</p>
            <span className="text-xs text-gray-500 shrink-0">{g.costed} of {g.jobs} costed{g.noTakeoff ? ` · ${g.noTakeoff} no takeoff` : ''}</span>
          </div>
          {g.costed > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 text-xs tabular-nums mt-0.5">
              <span>Quoted {usd(g.quotedCents)}</span>
              <span>Actual {usd(g.actualCents)}</span>
              <span className={g.diffCents > 0 ? 'text-red-700' : 'text-green-700'}>{g.diffCents > 0 ? '+' : ''}{usd(g.diffCents)} vs quoted</span>
              <span>Profit {usd(g.profitCents)} ({pct(g.marginPct)})</span>
            </div>
          ) : <p className="text-xs text-gray-500 mt-0.5">No takeoff</p>}
        </div>
      ))}
    </div>
  )
}
