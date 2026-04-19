import { useState, useMemo } from 'react'
import type { SavedQuote } from './QuotesPage'

/* ───────── types ───────── */

interface CrewEntry {
  name: string
  hours: number
  rate: number
}

interface JobCostEntry {
  id: string
  quoteId: string
  completionDate: string
  actualLaborHrs: number
  crew: CrewEntry[]
  actualMaterialCost: number
  actualOtherCosts: number
  notes: string
}

interface CostedJob {
  entry: JobCostEntry
  quote: SavedQuote
  // Computed variances
  laborHrsVariance: number
  laborHrsPct: number
  materialVariance: number
  materialPct: number
  totalEstCOGS: number
  totalActCOGS: number
  cogsVariance: number
  cogsPct: number
  estGM: number
  actGM: number
}

interface BudgetState {
  revenueGoal: number
  overheadPct: number
  laborPct: number
  materialsPct: number
  netProfitPct: number
}

/* ───────── helpers ───────── */

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmt2 = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

const uid = () => Math.random().toString(36).slice(2, 9)

const STORAGE_KEY = 'fencepro_jobcosting'

function loadQuotes(): SavedQuote[] {
  try {
    const raw = localStorage.getItem('fencepro_quotes')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function loadEntries(): JobCostEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveEntries(entries: JobCostEntry[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries))
}

function fenceCategory(style: string): string {
  if (style.toLowerCase().includes('vinyl') || style.startsWith('WV') || style.startsWith('TV')) return 'Vinyl'
  if (style.toLowerCase().includes('alum')) return 'Aluminum'
  if (style.toLowerCase().includes('com')) return 'Commercial'
  if (style.startsWith('CL')) return 'Chainlink'
  return 'Other'
}

function varianceColor(pct: number): string {
  if (Math.abs(pct) <= 0.05) return 'text-green-600'
  if (Math.abs(pct) <= 0.15) return 'text-yellow-600'
  return 'text-red-500'
}

function varianceArrow(val: number): string {
  if (val > 0) return '▲'
  if (val < 0) return '▼'
  return '—'
}

/* ───────── Cost a Job Modal ───────── */

function CostAJobModal({
  soldQuotes,
  existingIds,
  onSave,
  onClose,
  editEntry,
}: {
  soldQuotes: SavedQuote[]
  existingIds: Set<string>
  onSave: (entry: JobCostEntry) => void
  onClose: () => void
  editEntry?: JobCostEntry | null
}) {
  const [quoteId, setQuoteId] = useState(editEntry?.quoteId || '')
  const [completionDate, setCompletionDate] = useState(editEntry?.completionDate || new Date().toISOString().slice(0, 10))
  const [actualLaborHrs, setActualLaborHrs] = useState(String(editEntry?.actualLaborHrs || ''))
  const [actualMaterialCost, setActualMaterialCost] = useState(String(editEntry?.actualMaterialCost || ''))
  const [actualOtherCosts, setActualOtherCosts] = useState(String(editEntry?.actualOtherCosts || ''))
  const [notes, setNotes] = useState(editEntry?.notes || '')
  const [crew, setCrew] = useState<CrewEntry[]>(editEntry?.crew || [])

  const availableQuotes = soldQuotes.filter(q => !existingIds.has(q.id) || q.id === editEntry?.quoteId)
  const selectedQuote = soldQuotes.find(q => q.id === quoteId)

  function addCrewMember() {
    setCrew(prev => [...prev, { name: '', hours: 0, rate: 0 }])
  }

  function updateCrew(i: number, field: keyof CrewEntry, val: string) {
    setCrew(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: field === 'name' ? val : Number(val) || 0 } : c))
  }

  function removeCrew(i: number) {
    setCrew(prev => prev.filter((_, idx) => idx !== i))
  }

  function handleSave() {
    if (!quoteId) return
    onSave({
      id: editEntry?.id || uid(),
      quoteId,
      completionDate,
      actualLaborHrs: Number(actualLaborHrs) || 0,
      crew: crew.filter(c => c.name.trim()),
      actualMaterialCost: Number(actualMaterialCost) || 0,
      actualOtherCosts: Number(actualOtherCosts) || 0,
      notes,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[640px] max-h-[80vh] overflow-y-auto mx-4 lg:mx-0" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-900 text-lg">{editEntry ? 'Edit Job Cost' : 'Cost a Completed Job'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Select quote */}
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Select Sold Quote</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              value={quoteId}
              onChange={e => setQuoteId(e.target.value)}
              disabled={!!editEntry}
            >
              <option value="">— Choose a job —</option>
              {availableQuotes.map(q => (
                <option key={q.id} value={q.id}>
                  {q.customerName} — {q.fenceStyle} — {fmt(q.finalPrice)} ({q.date})
                </option>
              ))}
            </select>
          </div>

          {/* Estimate preview */}
          {selectedQuote && (
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Quote Estimate</p>
              <div className="grid grid-cols-4 gap-3 text-sm">
                <div><p className="text-gray-400 text-xs">Labor Hrs</p><p className="font-bold">{selectedQuote.adjLaborHrs?.toFixed(1) || '—'}</p></div>
                <div><p className="text-gray-400 text-xs">Labor $</p><p className="font-bold">{fmt(selectedQuote.laborCost)}</p></div>
                <div><p className="text-gray-400 text-xs">Materials</p><p className="font-bold">{fmt(selectedQuote.materialCost)}</p></div>
                <div><p className="text-gray-400 text-xs">Total COGS</p><p className="font-bold">{fmt(selectedQuote.totalCOGS)}</p></div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Completion Date</label>
              <input
                type="date"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={completionDate}
                onChange={e => setCompletionDate(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Actual Total Labor Hours</label>
              <input
                type="number" min={0} step={0.5}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="e.g. 24.5"
                value={actualLaborHrs}
                onChange={e => setActualLaborHrs(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Actual Material Cost</label>
              <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-orange-400">
                <span className="px-3 text-gray-400 bg-gray-50 border-r border-gray-300 py-2 text-sm">$</span>
                <input
                  type="number" min={0} step={0.01}
                  className="flex-1 px-3 py-2 text-sm outline-none"
                  placeholder="0.00"
                  value={actualMaterialCost}
                  onChange={e => setActualMaterialCost(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-medium mb-1 block">Other Costs (extras, change orders)</label>
              <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-orange-400">
                <span className="px-3 text-gray-400 bg-gray-50 border-r border-gray-300 py-2 text-sm">$</span>
                <input
                  type="number" min={0} step={0.01}
                  className="flex-1 px-3 py-2 text-sm outline-none"
                  placeholder="0.00"
                  value={actualOtherCosts}
                  onChange={e => setActualOtherCosts(e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Crew breakdown */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 font-medium">Crew Breakdown (optional)</label>
              <button onClick={addCrewMember} className="text-xs text-orange-500 hover:text-orange-600 font-semibold">+ Add crew member</button>
            </div>
            {crew.length > 0 && (
              <div className="space-y-2">
                {crew.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                      placeholder="Name"
                      value={c.name}
                      onChange={e => updateCrew(i, 'name', e.target.value)}
                    />
                    <input
                      type="number" min={0} step={0.5}
                      className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right"
                      placeholder="Hours"
                      value={c.hours || ''}
                      onChange={e => updateCrew(i, 'hours', e.target.value)}
                    />
                    <input
                      type="number" min={0} step={0.5}
                      className="w-20 border border-gray-300 rounded-lg px-2 py-1.5 text-sm text-right"
                      placeholder="$/hr"
                      value={c.rate || ''}
                      onChange={e => updateCrew(i, 'rate', e.target.value)}
                    />
                    <span className="text-xs text-gray-400 w-16 text-right">{fmt(c.hours * c.rate)}</span>
                    <button onClick={() => removeCrew(i)} className="text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
                  </div>
                ))}
                <div className="text-xs text-gray-400 text-right">
                  Crew total: {crew.reduce((s, c) => s + c.hours, 0).toFixed(1)} hrs · {fmt(crew.reduce((s, c) => s + c.hours * c.rate, 0))}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Notes</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              rows={2}
              placeholder="Any notes about this job — weather issues, scope changes, etc."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!quoteId}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold px-6 py-2 rounded-xl text-sm transition-colors"
          >
            {editEntry ? 'Update' : 'Save Job Cost'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ───────── Job Detail Drawer ───────── */

function JobDetailDrawer({ job, onClose }: { job: CostedJob; onClose: () => void }) {
  const { quote: q, entry: e } = job
  const actualLaborCost = e.crew.length > 0
    ? e.crew.reduce((s, c) => s + c.hours * c.rate, 0)
    : 0

  function VarRow({ label, est, act, unit = '$' }: { label: string; est: number; act: number; unit?: string }) {
    const diff = act - est
    const pct = est > 0 ? diff / est : 0
    const fmtVal = unit === '$' ? fmt : (n: number) => n.toFixed(1)
    return (
      <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
        <span className="text-sm text-gray-700 font-medium">{label}</span>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-gray-400 w-20 text-right">{fmtVal(est)}</span>
          <span className="font-bold text-gray-900 w-20 text-right">{fmtVal(act)}</span>
          <span className={`font-bold w-20 text-right ${varianceColor(pct)}`}>
            {varianceArrow(diff)} {unit === '$' ? fmt(Math.abs(diff)) : Math.abs(diff).toFixed(1)}
          </span>
          <span className={`text-xs font-bold w-14 text-right ${varianceColor(pct)}`}>
            {pct >= 0 ? '+' : ''}{fmtPct(pct)}
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-[520px] bg-white shadow-2xl flex flex-col h-full overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">{q.customerName}</h2>
            <p className="text-sm text-gray-400">{q.fenceStyle} · {q.sections} sections · {e.completionDate}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Price & margin summary */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400">Sale Price</p>
              <p className="text-lg font-bold text-gray-900">{fmt(q.finalPrice)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400">Est GM</p>
              <p className={`text-lg font-bold ${job.estGM >= 0.34 ? 'text-green-600' : 'text-yellow-600'}`}>{fmtPct(job.estGM)}</p>
            </div>
            <div className={`rounded-xl p-3 text-center ${job.actGM >= 0.34 ? 'bg-green-50' : job.actGM >= 0.27 ? 'bg-yellow-50' : 'bg-red-50'}`}>
              <p className="text-xs text-gray-400">Actual GM</p>
              <p className={`text-lg font-bold ${job.actGM >= 0.34 ? 'text-green-600' : job.actGM >= 0.27 ? 'text-yellow-600' : 'text-red-500'}`}>{fmtPct(job.actGM)}</p>
            </div>
          </div>

          {/* Variance table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400 font-semibold uppercase">Variance Breakdown</span>
              <div className="flex gap-4 text-xs text-gray-400">
                <span className="w-20 text-right">Estimate</span>
                <span className="w-20 text-right">Actual</span>
                <span className="w-20 text-right">Variance</span>
                <span className="w-14 text-right">%</span>
              </div>
            </div>
            <VarRow label="Labor Hours" est={q.adjLaborHrs || 0} act={e.actualLaborHrs} unit="hrs" />
            <VarRow label="Labor Cost" est={q.laborCost} act={actualLaborCost > 0 ? actualLaborCost : e.actualLaborHrs * (q.adjLaborHrs > 0 ? q.laborCost / q.adjLaborHrs : 22)} />
            <VarRow label="Material Cost" est={q.materialCost} act={e.actualMaterialCost} />
            {e.actualOtherCosts > 0 && (
              <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                <span className="text-sm text-gray-700 font-medium">Other Costs</span>
                <span className="text-sm font-bold text-gray-900">{fmt(e.actualOtherCosts)}</span>
              </div>
            )}
            <VarRow label="Total COGS" est={job.totalEstCOGS} act={job.totalActCOGS} />
          </div>

          {/* Crew breakdown */}
          {e.crew.length > 0 && (
            <div>
              <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Crew Breakdown</p>
              <div className="bg-gray-50 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400">
                      <th className="text-left px-4 py-2">Name</th>
                      <th className="text-right px-4 py-2">Hours</th>
                      <th className="text-right px-4 py-2">Rate</th>
                      <th className="text-right px-4 py-2">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {e.crew.map((c, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-4 py-2 font-medium text-gray-900">{c.name}</td>
                        <td className="px-4 py-2 text-right text-gray-700">{c.hours.toFixed(1)}</td>
                        <td className="px-4 py-2 text-right text-gray-500">{fmt2(c.rate)}/hr</td>
                        <td className="px-4 py-2 text-right font-bold text-gray-900">{fmt(c.hours * c.rate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Notes */}
          {e.notes && (
            <div>
              <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Notes</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded-lg p-3">{e.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   JOB COSTING TAB
   ═══════════════════════════════════════════════ */

export default function JobCostingTab({ state: _state }: { state: BudgetState }) {
  const [entries, setEntries] = useState<JobCostEntry[]>(loadEntries)
  const [showModal, setShowModal] = useState(false)
  const [editEntry, setEditEntry] = useState<JobCostEntry | null>(null)
  const [selectedJob, setSelectedJob] = useState<CostedJob | null>(null)

  const quotes = useMemo(() => loadQuotes(), [])
  const soldQuotes = useMemo(() => quotes.filter(q => q.status === 'SOLD'), [quotes])
  const existingIds = useMemo(() => new Set(entries.map(e => e.quoteId)), [entries])

  // Join entries with quotes to create CostedJob[]
  const costedJobs: CostedJob[] = useMemo(() => {
    return entries
      .map(entry => {
        const quote = quotes.find(q => q.id === entry.quoteId)
        if (!quote) return null

        const actualLaborCost = entry.crew.length > 0
          ? entry.crew.reduce((s, c) => s + c.hours * c.rate, 0)
          : entry.actualLaborHrs * (quote.adjLaborHrs > 0 ? quote.laborCost / quote.adjLaborHrs : 22)

        const totalEstCOGS = quote.totalCOGS
        const totalActCOGS = actualLaborCost + entry.actualMaterialCost + entry.actualOtherCosts

        return {
          entry,
          quote,
          laborHrsVariance: entry.actualLaborHrs - (quote.adjLaborHrs || 0),
          laborHrsPct: (quote.adjLaborHrs || 0) > 0 ? (entry.actualLaborHrs - quote.adjLaborHrs) / quote.adjLaborHrs : 0,
          materialVariance: entry.actualMaterialCost - quote.materialCost,
          materialPct: quote.materialCost > 0 ? (entry.actualMaterialCost - quote.materialCost) / quote.materialCost : 0,
          totalEstCOGS,
          totalActCOGS,
          cogsVariance: totalActCOGS - totalEstCOGS,
          cogsPct: totalEstCOGS > 0 ? (totalActCOGS - totalEstCOGS) / totalEstCOGS : 0,
          estGM: quote.gmPct,
          actGM: quote.finalPrice > 0 ? (quote.finalPrice - totalActCOGS) / quote.finalPrice : 0,
        } as CostedJob
      })
      .filter(Boolean) as CostedJob[]
  }, [entries, quotes])

  // Aggregate stats
  const stats = useMemo(() => {
    if (costedJobs.length === 0) return null
    const avgLaborVar = costedJobs.reduce((s, j) => s + j.laborHrsVariance, 0) / costedJobs.length
    const avgMaterialVar = costedJobs.reduce((s, j) => s + j.materialPct, 0) / costedJobs.length
    const avgCOGSVar = costedJobs.reduce((s, j) => s + j.cogsPct, 0) / costedJobs.length
    const avgEstGM = costedJobs.reduce((s, j) => s + j.estGM, 0) / costedJobs.length
    const avgActGM = costedJobs.reduce((s, j) => s + j.actGM, 0) / costedJobs.length
    const totalEstCOGS = costedJobs.reduce((s, j) => s + j.totalEstCOGS, 0)
    const totalActCOGS = costedJobs.reduce((s, j) => s + j.totalActCOGS, 0)

    // By fence style
    const byStyle: Record<string, { jobs: number; avgLaborVar: number; avgMatVar: number; avgActGM: number }> = {}
    costedJobs.forEach(j => {
      const cat = fenceCategory(j.quote.fenceStyle)
      if (!byStyle[cat]) byStyle[cat] = { jobs: 0, avgLaborVar: 0, avgMatVar: 0, avgActGM: 0 }
      byStyle[cat].jobs += 1
      byStyle[cat].avgLaborVar += j.laborHrsVariance
      byStyle[cat].avgMatVar += j.materialPct
      byStyle[cat].avgActGM += j.actGM
    })
    Object.values(byStyle).forEach(s => {
      s.avgLaborVar /= s.jobs
      s.avgMatVar /= s.jobs
      s.avgActGM /= s.jobs
    })

    return { avgLaborVar, avgMaterialVar, avgCOGSVar, avgEstGM, avgActGM, totalEstCOGS, totalActCOGS, byStyle }
  }, [costedJobs])

  // Insights
  const insights = useMemo(() => {
    if (!stats) return []
    const msgs: string[] = []
    if (stats.avgLaborVar > 1) msgs.push(`You underestimate labor by an average of ${stats.avgLaborVar.toFixed(1)} hours per job.`)
    else if (stats.avgLaborVar < -1) msgs.push(`You overestimate labor by an average of ${Math.abs(stats.avgLaborVar).toFixed(1)} hours per job — your crew is faster than expected.`)
    if (stats.avgMaterialVar > 0.05) msgs.push(`Material costs are running ${fmtPct(stats.avgMaterialVar)} above estimates on average.`)
    else if (stats.avgMaterialVar < -0.05) msgs.push(`Material costs are coming in ${fmtPct(Math.abs(stats.avgMaterialVar))} below estimates — good purchasing.`)
    if (stats.avgActGM < stats.avgEstGM - 0.03) msgs.push(`Actual margins (${fmtPct(stats.avgActGM)}) are below quoted margins (${fmtPct(stats.avgEstGM)}) — review your estimating.`)
    else if (stats.avgActGM >= stats.avgEstGM) msgs.push(`Actual margins are meeting or beating estimates — your pricing model is solid.`)

    Object.entries(stats.byStyle).forEach(([style, d]) => {
      if (d.jobs >= 2 && d.avgLaborVar > 2) msgs.push(`${style} jobs average ${d.avgLaborVar.toFixed(1)} extra labor hours — consider adjusting man-hour rates for this style.`)
    })
    return msgs
  }, [stats])

  function handleSave(entry: JobCostEntry) {
    setEntries(prev => {
      const exists = prev.find(e => e.id === entry.id)
      const updated = exists ? prev.map(e => e.id === entry.id ? entry : e) : [entry, ...prev]
      saveEntries(updated)
      return updated
    })
    setShowModal(false)
    setEditEntry(null)
  }

  function handleDelete(id: string) {
    setEntries(prev => {
      const updated = prev.filter(e => e.id !== id)
      saveEntries(updated)
      return updated
    })
    setSelectedJob(null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Job Costing</h2>
          <p className="text-sm text-gray-400 mt-0.5">Compare estimates to actuals. Enter real costs after job completion.</p>
        </div>
        <button
          onClick={() => { setEditEntry(null); setShowModal(true) }}
          className="bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm px-4 py-2.5 rounded-xl"
        >
          + Cost a Job
        </button>
      </div>

      {/* Aggregate KPIs */}
      {stats && (
        <div className="grid grid-cols-5 gap-4">
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Jobs Costed</p>
            <p className="text-2xl font-bold text-gray-900">{costedJobs.length}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Avg Labor Hr Variance</p>
            <p className={`text-2xl font-bold ${varianceColor(stats.avgLaborVar / 10)}`}>
              {stats.avgLaborVar >= 0 ? '+' : ''}{stats.avgLaborVar.toFixed(1)} hrs
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Avg Material Variance</p>
            <p className={`text-2xl font-bold ${varianceColor(stats.avgMaterialVar)}`}>
              {stats.avgMaterialVar >= 0 ? '+' : ''}{fmtPct(stats.avgMaterialVar)}
            </p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Avg Est GM</p>
            <p className="text-2xl font-bold text-gray-500">{fmtPct(stats.avgEstGM)}</p>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <p className="text-xs text-gray-400 font-semibold uppercase mb-1">Avg Actual GM</p>
            <p className={`text-2xl font-bold ${stats.avgActGM >= 0.34 ? 'text-green-600' : stats.avgActGM >= 0.27 ? 'text-yellow-600' : 'text-red-500'}`}>
              {fmtPct(stats.avgActGM)}
            </p>
          </div>
        </div>
      )}

      {/* Insights */}
      {insights.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
          <p className="text-xs font-semibold text-orange-600 uppercase mb-2">Insights from {costedJobs.length} costed jobs</p>
          <ul className="space-y-1.5">
            {insights.map((msg, i) => (
              <li key={i} className="text-sm text-gray-700 flex items-start gap-2">
                <span className="text-orange-400 mt-0.5">•</span>
                {msg}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* By style breakdown */}
      {stats && Object.keys(stats.byStyle).length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-bold text-gray-900">Variance by Fence Style</h3>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Style</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Jobs</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Avg Labor Hr Var</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Avg Material Var</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Avg Actual GM</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {Object.entries(stats.byStyle).sort((a, b) => b[1].jobs - a[1].jobs).map(([style, d]) => (
                <tr key={style} className="hover:bg-gray-50">
                  <td className="px-6 py-3 font-medium text-gray-900">{style}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{d.jobs}</td>
                  <td className={`px-4 py-3 text-right font-bold ${varianceColor(d.avgLaborVar / 10)}`}>
                    {d.avgLaborVar >= 0 ? '+' : ''}{d.avgLaborVar.toFixed(1)} hrs
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${varianceColor(d.avgMatVar)}`}>
                    {d.avgMatVar >= 0 ? '+' : ''}{fmtPct(d.avgMatVar)}
                  </td>
                  <td className={`px-4 py-3 text-right font-bold ${d.avgActGM >= 0.34 ? 'text-green-600' : d.avgActGM >= 0.27 ? 'text-yellow-600' : 'text-red-500'}`}>
                    {fmtPct(d.avgActGM)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Costed jobs table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-bold text-gray-900">Costed Jobs</h3>
          <span className="text-xs text-gray-400">{costedJobs.length} jobs</span>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase">Style</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase">Price</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase">Est COGS</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase">Act COGS</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase">COGS Var</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase">Est GM</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase">Act GM</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {costedJobs.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-6 py-12 text-center text-gray-400">
                  <p className="text-lg mb-1">No jobs costed yet</p>
                  <p className="text-sm">Click "Cost a Job" to enter actuals for a completed sold quote</p>
                </td>
              </tr>
            ) : costedJobs.map(j => (
              <tr key={j.entry.id} className="hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedJob(j)}>
                <td className="px-5 py-3 font-medium text-gray-900">{j.quote.customerName}</td>
                <td className="px-3 py-3 text-gray-600 text-xs">{fenceCategory(j.quote.fenceStyle)}</td>
                <td className="px-3 py-3 text-right font-semibold text-gray-900">{fmt(j.quote.finalPrice)}</td>
                <td className="px-3 py-3 text-right text-gray-500">{fmt(j.totalEstCOGS)}</td>
                <td className="px-3 py-3 text-right font-semibold text-gray-900">{fmt(j.totalActCOGS)}</td>
                <td className={`px-3 py-3 text-right font-bold ${varianceColor(j.cogsPct)}`}>
                  {j.cogsVariance >= 0 ? '+' : ''}{fmt(j.cogsVariance)}
                </td>
                <td className="px-3 py-3 text-right text-gray-500">{fmtPct(j.estGM)}</td>
                <td className={`px-3 py-3 text-right font-bold ${j.actGM >= 0.34 ? 'text-green-600' : j.actGM >= 0.27 ? 'text-yellow-600' : 'text-red-500'}`}>
                  {fmtPct(j.actGM)}
                </td>
                <td className="px-2 py-3 text-right">
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(j.entry.id) }}
                    className="text-gray-200 hover:text-red-400 text-lg leading-none"
                    title="Delete"
                  >×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <CostAJobModal
          soldQuotes={soldQuotes}
          existingIds={existingIds}
          onSave={handleSave}
          onClose={() => { setShowModal(false); setEditEntry(null) }}
          editEntry={editEntry}
        />
      )}

      {/* Detail drawer */}
      {selectedJob && (
        <JobDetailDrawer job={selectedJob} onClose={() => setSelectedJob(null)} />
      )}
    </div>
  )
}
