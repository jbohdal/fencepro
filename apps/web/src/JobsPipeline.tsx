import { useState, useMemo } from 'react'
import {
  getJobs, updateJob, advanceJob, holdJob, unholdJob, getJobStats,
  STATUS_ORDER, STATUS_CONFIG, MATERIALS_STATUS_CONFIG,
} from './jobStore'
import type { Job, JobStatus, MaterialsStatus } from './jobStore'
import { getApprovedCOTotal } from './ChangeOrders'
import { syncJob } from './portalSync'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

/* ═══════════════════════════════════════════════
   JOBS PIPELINE
   ═══════════════════════════════════════════════ */

export default function JobsPipeline() {
  const [jobs, setJobs] = useState<Job[]>(() => getJobs())
  const [selectedJob, setSelectedJob] = useState<Job | null>(null)
  const [view, setView] = useState<'board' | 'list'>('board')
  const [search, setSearch] = useState('')

  const stats = useMemo(() => getJobStats(), [jobs])

  function refresh() { setJobs(getJobs()) }

  function portalSync(id: string) {
    const j = getJobs().find(job => job.id === id)
    if (j) syncJob(j).catch(() => {})
  }

  function handleAdvance(id: string) {
    advanceJob(id)
    refresh()
    if (selectedJob?.id === id) setSelectedJob(getJobs().find(j => j.id === id) || null)
    portalSync(id)
  }

  function handleHold(id: string) {
    const reason = prompt('Hold reason (HOA, customer delay, backorder, etc.):')
    if (reason === null) return
    holdJob(id, reason || 'On hold')
    refresh()
    if (selectedJob?.id === id) setSelectedJob(getJobs().find(j => j.id === id) || null)
    portalSync(id)
  }

  function handleUnhold(id: string) {
    unholdJob(id)
    refresh()
    if (selectedJob?.id === id) setSelectedJob(getJobs().find(j => j.id === id) || null)
    portalSync(id)
  }

  function handleUpdate(id: string, updates: Partial<Job>) {
    updateJob(id, updates)
    refresh()
    if (selectedJob?.id === id) setSelectedJob(getJobs().find(j => j.id === id) || null)
    portalSync(id)
  }

  function handleMoveToStatus(id: string, status: JobStatus) {
    updateJob(id, { status })
    refresh()
    if (selectedJob?.id === id) setSelectedJob(getJobs().find(j => j.id === id) || null)
    portalSync(id)
  }

  const filtered = jobs.filter(j => {
    if (!search) return true
    const q = search.toLowerCase()
    return j.customerName.toLowerCase().includes(q) ||
      j.fenceStyle.toLowerCase().includes(q) ||
      j.customerAddress.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-4">
      {/* Header KPIs */}
      <div className="grid grid-cols-5 gap-3">
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 font-semibold uppercase">Active Jobs</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{stats.activeJobs}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 font-semibold uppercase">Contract Value</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{fmt(stats.totalContractValue)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 font-semibold uppercase">Collected</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{fmt(stats.totalPaid)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 font-semibold uppercase">Outstanding</p>
          <p className="text-2xl font-bold text-orange-600 mt-1">{fmt(stats.totalOutstanding)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 font-semibold uppercase">On Hold</p>
          <p className={`text-2xl font-bold mt-1 ${stats.byStatus.on_hold > 0 ? 'text-red-500' : 'text-gray-300'}`}>{stats.byStatus.on_hold}</p>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex gap-3">
          <input className="border border-gray-300 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-orange-400"
            placeholder="Search jobs..." value={search} onChange={e => setSearch(e.target.value)} />
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(['board', 'list'] as const).map(v => (
              <button key={v} onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize ${view === v ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
                {v}
              </button>
            ))}
          </div>
        </div>
        <span className="text-xs text-gray-400">{jobs.length} total jobs</span>
      </div>

      {/* Board view */}
      {view === 'board' && (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {[...STATUS_ORDER, 'on_hold' as JobStatus].map(status => {
            const cfg = STATUS_CONFIG[status]
            const colJobs = filtered.filter(j => j.status === status)
            return (
              <div key={status} className="w-64 shrink-0 flex flex-col">
                <div className={`rounded-t-xl px-3 py-2 flex items-center justify-between ${cfg.bgColor}`}>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm">{cfg.icon}</span>
                    <span className={`text-xs font-bold uppercase tracking-wide ${cfg.color}`}>{cfg.label}</span>
                  </div>
                  <span className={`text-xs font-bold ${cfg.color}`}>{colJobs.length}</span>
                </div>
                <div className="flex-1 bg-gray-50 rounded-b-xl border border-gray-200 border-t-0 p-2 space-y-2 min-h-[200px]">
                  {colJobs.map(job => (
                    <div key={job.id} onClick={() => setSelectedJob(job)}
                      className="bg-white rounded-xl border border-gray-200 p-3 cursor-pointer hover:border-orange-300 transition-colors shadow-sm">
                      <p className="text-sm font-semibold text-gray-900 truncate">{job.customerName}</p>
                      <p className="text-xs text-gray-400 truncate">{job.fenceStyle} · {job.sections} sec</p>
                      <div className="flex items-center justify-between mt-2">
                        <span className="text-sm font-bold text-gray-900">{fmt(job.contractValue)}</span>
                        {job.crewAssigned && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">{job.crewAssigned}</span>
                        )}
                      </div>
                      {job.scheduledDate && (
                        <p className="text-xs text-gray-400 mt-1">{job.scheduledDate}</p>
                      )}
                      {status === 'on_hold' && job.holdReason && (
                        <p className="text-xs text-red-500 mt-1">{job.holdReason}</p>
                      )}
                    </div>
                  ))}
                  {colJobs.length === 0 && (
                    <p className="text-xs text-gray-300 text-center py-8">No jobs</p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Style</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Status</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-20">Crew</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Date</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Contract</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(job => {
                const cfg = STATUS_CONFIG[job.status]
                return (
                  <tr key={job.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedJob(job)}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{job.customerName}</p>
                      <p className="text-xs text-gray-400 truncate">{job.customerAddress}</p>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600">{job.fenceStyle}</td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${cfg.bgColor} ${cfg.color}`}>{cfg.label}</span>
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-600">{job.crewAssigned || '—'}</td>
                    <td className="px-3 py-3 text-xs text-gray-500">{job.scheduledDate || '—'}</td>
                    <td className="px-3 py-3 text-right font-bold text-gray-900 text-xs">{fmt(job.contractValue)}</td>
                    <td className="px-3 py-3 text-xs">
                      <span className={`font-semibold ${job.paymentStatus === 'paid' ? 'text-green-600' : job.paymentStatus === 'invoiced' ? 'text-blue-600' : 'text-gray-400'}`}>
                        {job.paymentStatus.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                  {jobs.length === 0 ? 'No jobs yet — sell a quote to create one' : 'No jobs match your search'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Job detail drawer */}
      {selectedJob && (
        <JobDrawer
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onAdvance={handleAdvance}
          onHold={handleHold}
          onUnhold={handleUnhold}
          onUpdate={handleUpdate}
          onMoveToStatus={handleMoveToStatus}
        />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   JOB DETAIL DRAWER
   ═══════════════════════════════════════════════ */

function JobDrawer({ job, onClose, onAdvance, onHold, onUnhold, onUpdate, onMoveToStatus }: {
  job: Job
  onClose: () => void
  onAdvance: (id: string) => void
  onHold: (id: string) => void
  onUnhold: (id: string) => void
  onUpdate: (id: string, updates: Partial<Job>) => void
  onMoveToStatus: (id: string, status: JobStatus) => void
}) {
  const cfg = STATUS_CONFIG[job.status]
  const coTotal = getApprovedCOTotal(job.quoteId)

  // Sync CO total if changed
  if (coTotal !== job.changeOrderTotal) {
    onUpdate(job.id, { changeOrderTotal: coTotal, contractValue: job.quotePrice + coTotal })
  }

  const nextStatus = STATUS_ORDER[STATUS_ORDER.indexOf(job.status) + 1]
  const nextCfg = nextStatus ? STATUS_CONFIG[nextStatus] : null

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full lg:w-[560px] bg-white shadow-2xl flex flex-col overflow-y-auto">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-200">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="font-bold text-gray-900 text-lg">{job.customerName}</h2>
              <p className="text-sm text-gray-400">{job.customerAddress}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${cfg.bgColor} ${cfg.color}`}>
              {cfg.icon} {cfg.label}
            </span>
            {job.crewAssigned && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">{job.crewAssigned}</span>}
            {job.scheduledDate && <span className="text-xs text-gray-400">{job.scheduledDate}</span>}
          </div>
        </div>

        <div className="flex-1 px-6 py-5 space-y-5">
          {/* Action buttons */}
          <div className="flex gap-2">
            {job.status !== 'paid' && job.status !== 'on_hold' && nextCfg && (
              <button onClick={() => onAdvance(job.id)}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-semibold py-2.5 rounded-xl text-sm">
                Advance to {nextCfg.icon} {nextCfg.label}
              </button>
            )}
            {job.status === 'on_hold' ? (
              <button onClick={() => onUnhold(job.id)} className="flex-1 border border-green-300 text-green-700 font-semibold py-2.5 rounded-xl text-sm hover:bg-green-50">
                Resume Job
              </button>
            ) : job.status !== 'paid' && (
              <button onClick={() => onHold(job.id)} className="border border-gray-300 text-gray-500 font-semibold py-2.5 rounded-xl text-sm px-4 hover:bg-gray-50">
                Hold
              </button>
            )}
          </div>

          {/* Move to specific status */}
          <div>
            <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Move To</p>
            <div className="flex flex-wrap gap-1.5">
              {[...STATUS_ORDER, 'on_hold' as JobStatus].filter(s => s !== job.status).map(s => {
                const sc = STATUS_CONFIG[s]
                return (
                  <button key={s} onClick={() => onMoveToStatus(job.id, s)}
                    className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${sc.bgColor} ${sc.color} border-transparent hover:border-current`}>
                    {sc.icon} {sc.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Pricing */}
          <div className="bg-gray-900 rounded-xl p-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Original Quote</span>
                <span className="text-gray-300">{fmt(job.quotePrice)}</span>
              </div>
              {job.changeOrderTotal !== 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Change Orders</span>
                  <span className={job.changeOrderTotal > 0 ? 'text-green-400' : 'text-red-400'}>
                    {job.changeOrderTotal > 0 ? '+' : ''}{fmt(job.changeOrderTotal)}
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-700 pt-2">
                <span className="text-white font-bold">Contract Value</span>
                <span className="text-orange-400 font-bold text-lg">{fmt(job.contractValue)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Gross Margin</span>
                <span className={`font-semibold ${job.gmPct >= 0.34 ? 'text-green-400' : 'text-yellow-400'}`}>{fmtPct(job.gmPct)}</span>
              </div>
            </div>
          </div>

          {/* Scope */}
          <div>
            <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Scope of Work</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Style', value: job.fenceStyle },
                { label: 'Sections', value: job.sections },
                { label: 'Total Feet', value: `${job.totalFeet} ft` },
                { label: 'Walk Gates', value: job.walkGates },
                { label: 'Dbl Gates', value: job.dblGates },
                { label: 'Tear Out', value: job.tearOutSections },
              ].map(f => (
                <div key={f.label} className="bg-gray-50 rounded-lg p-2.5">
                  <p className="text-[10px] text-gray-400">{f.label}</p>
                  <p className="text-sm font-bold text-gray-900">{f.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Operations — Staging */}
          <div>
            <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Materials & Staging</p>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Materials Status</span>
                <select className="border border-gray-300 rounded-lg px-2 py-1 text-xs"
                  value={job.materialsStatus}
                  onChange={e => onUpdate(job.id, { materialsStatus: e.target.value as MaterialsStatus })}>
                  {Object.entries(MATERIALS_STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Pull Sheet Pulled</span>
                <button onClick={() => onUpdate(job.id, { pullSheetPulled: !job.pullSheetPulled })}
                  className={`text-xs px-3 py-1 rounded-full font-semibold ${job.pullSheetPulled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                  {job.pullSheetPulled ? 'Yes' : 'No'}
                </button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Drawing Complete</span>
                <button onClick={() => onUpdate(job.id, { drawingComplete: !job.drawingComplete })}
                  className={`text-xs px-3 py-1 rounded-full font-semibold ${job.drawingComplete ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                  {job.drawingComplete ? 'Yes' : 'No'}
                </button>
              </div>
            </div>
          </div>

          {/* Scheduling */}
          <div>
            <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Scheduling</p>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600 w-24 shrink-0">Crew</label>
                <input className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
                  placeholder="Crew name..."
                  value={job.crewAssigned} onChange={e => onUpdate(job.id, { crewAssigned: e.target.value })} />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600 w-24 shrink-0">Start Date</label>
                <input type="date" className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
                  value={job.scheduledDate} onChange={e => onUpdate(job.id, { scheduledDate: e.target.value })} />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600 w-24 shrink-0">Est. Days</label>
                <input type="number" min={1} className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-orange-400"
                  value={job.estimatedDays} onChange={e => onUpdate(job.id, { estimatedDays: parseInt(e.target.value) || 1 })} />
              </div>
            </div>
          </div>

          {/* Payment */}
          <div>
            <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Payment</p>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600 w-24 shrink-0">Invoice #</label>
                <input className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
                  placeholder="INV-..."
                  value={job.invoiceNumber || ''} onChange={e => onUpdate(job.id, { invoiceNumber: e.target.value })} />
              </div>
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-600 w-24 shrink-0">Paid</label>
                <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden flex-1 focus-within:ring-1 focus-within:ring-orange-400">
                  <span className="px-2 text-gray-400 bg-gray-50 border-r border-gray-300 py-1.5 text-sm">$</span>
                  <input type="number" min={0} className="flex-1 px-2 py-1.5 text-sm outline-none text-right"
                    value={job.amountPaid || ''} onChange={e => onUpdate(job.id, { amountPaid: parseFloat(e.target.value) || 0 })} />
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Balance Due</span>
                <span className={`font-bold ${job.contractValue - job.amountPaid > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                  {fmt(job.contractValue - job.amountPaid)}
                </span>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Notes</p>
            <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-orange-400"
              rows={3} placeholder="Job notes..." value={job.notes}
              onChange={e => onUpdate(job.id, { notes: e.target.value })} />
          </div>

          {/* Meta */}
          <div className="text-xs text-gray-400 space-y-1 pt-2 border-t border-gray-100">
            <p>Quote ID: {job.quoteId.slice(0, 8)}</p>
            <p>Sales Rep: {job.salesRep || '—'} · Lead Source: {job.leadSource || '—'}</p>
            <p>Created: {new Date(job.createdAt).toLocaleDateString()} · Updated: {new Date(job.updatedAt).toLocaleDateString()}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
