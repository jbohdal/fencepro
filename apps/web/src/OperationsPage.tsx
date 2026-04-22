/**
 * Unified Operations View
 *
 * Merges Jobs (jobStore) and Staging (StagingPage) into a single view.
 * Kanban board + list view with full detail panel.
 */

import { useState, useEffect, useMemo, useRef } from 'react'
import { getJobs, updateJob, advanceJob, holdJob, unholdJob, type Job, type JobStatus } from './jobStore'
import { fireOpsStageChange } from './automationTrigger'
import { onJobCompleted } from './jobCompleteFlow'

// ── Unified operations stages ──

const OPS_STAGES = [
  { key: 'awaiting_locates', label: 'Awaiting Locates',   color: 'bg-blue-500',   bg: 'bg-blue-50',   text: 'text-blue-700'   },
  { key: 'need_drawing',     label: 'Need Drawing',       color: 'bg-yellow-500', bg: 'bg-yellow-50', text: 'text-yellow-700' },
  { key: 'materials_ordered',label: 'Materials Ordered',   color: 'bg-orange-500', bg: 'bg-orange-50', text: 'text-orange-700' },
  { key: 'ready_to_pull',    label: 'Ready to Pull',      color: 'bg-purple-500', bg: 'bg-purple-50', text: 'text-purple-700' },
  { key: 'scheduled',        label: 'Scheduled',          color: 'bg-green-500',  bg: 'bg-green-50',  text: 'text-green-700'  },
  { key: 'in_progress',      label: 'In Progress',        color: 'bg-teal-500',   bg: 'bg-teal-50',   text: 'text-teal-700'   },
  { key: 'completed',        label: 'Complete',           color: 'bg-gray-500',   bg: 'bg-gray-50',   text: 'text-gray-600'   },
  { key: 'invoiced',         label: 'Invoiced',           color: 'bg-blue-400',   bg: 'bg-blue-50',   text: 'text-blue-600'   },
  { key: 'paid',             label: 'Paid',               color: 'bg-green-400',  bg: 'bg-green-50',  text: 'text-green-600'  },
  { key: 'on_hold',          label: 'On Hold',            color: 'bg-red-500',    bg: 'bg-red-50',    text: 'text-red-700'    },
  { key: 'customer_delay',   label: 'Customer Delay',     color: 'bg-rose-500',   bg: 'bg-rose-50',   text: 'text-rose-700'   },
  { key: 'backorder',        label: 'Backorder',          color: 'bg-amber-500',  bg: 'bg-amber-50',  text: 'text-amber-700'  },
]

// Map old JobStatus values to unified stage keys
function mapJobStatusToOps(job: Job): string {
  // Use the staging fields to determine finer-grained status
  if (job.status === 'on_hold') return 'on_hold'
  if (job.status === 'staging') {
    if (job.materialsStatus === 'ordered') return 'materials_ordered'
    if (job.materialsStatus === 'received' || job.materialsStatus === 'loaded') return 'ready_to_pull'
    if (job.drawingComplete === false && job.materialsStatus === 'not_ordered') {
      // Check if locates are done
      if (!job.locatesDate) return 'awaiting_locates'
      return 'need_drawing'
    }
    return 'awaiting_locates'
  }
  if (job.status === 'scheduled') return 'scheduled'
  if (job.status === 'in_progress') return 'in_progress'
  if (job.status === 'completed') return 'completed'
  if (job.status === 'invoiced') return 'invoiced'
  if (job.status === 'paid') return 'paid'
  return 'awaiting_locates'
}

// Also pull staging jobs from localStorage
interface StagingJob {
  id: string; clientName: string; contractDate: string; locatesGoodDate: string
  locatesExpDate: string; area: string; sections: number; fenceType: string
  manhoursSold: number; jobPrice: number; tearout: boolean; notes: string
  status: string; quoteId?: string; createdAt: string; lastMoved: string
}

function loadStaging(): StagingJob[] {
  try {
    const raw = localStorage.getItem('fencepro_staging')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

// Map staging status to unified key
function mapStagingStatus(status: string): string {
  const map: Record<string, string> = {
    'Awaiting Locates': 'awaiting_locates', 'Need Drawing': 'need_drawing',
    'Materials Ordered': 'materials_ordered', 'Ready to Pull': 'ready_to_pull',
    'Scheduled': 'scheduled', 'Jobs In Progress': 'in_progress',
    'Job Complete': 'completed', 'Customer Delay': 'customer_delay',
    'Hold (HOA)': 'on_hold', 'Deed Restricted': 'on_hold',
    'Backorder': 'backorder', 'Warranty / Call Back': 'completed',
  }
  return map[status] || 'awaiting_locates'
}

// Unified job type for display
interface UnifiedJob {
  id: string
  source: 'job' | 'staging'
  customerName: string
  address: string
  fenceType: string
  sections: number
  opsStage: string           // unified stage key
  opsStageLabel: string
  crewAssigned: string
  scheduledDate: string
  contractValue: number
  paymentStatus: string
  amountPaid: number
  notes: string
  salesRep: string
  materialsStatus: string
  drawingComplete: boolean
  locatesDate: string
  locatesExpDate: string
  holdReason: string
  // Raw refs
  rawJob?: Job
  rawStaging?: StagingJob
}

function buildUnifiedList(): UnifiedJob[] {
  const jobs = getJobs()
  const staging = loadStaging()
  const result: UnifiedJob[] = []
  const seenQuoteIds = new Set<string>()

  // Jobs from jobStore
  for (const j of jobs) {
    seenQuoteIds.add(j.quoteId)
    const opsStage = mapJobStatusToOps(j)
    const stageInfo = OPS_STAGES.find(s => s.key === opsStage)
    result.push({
      id: j.id,
      source: 'job',
      customerName: j.customerName,
      address: j.customerAddress,
      fenceType: j.fenceStyle,
      sections: j.sections,
      opsStage,
      opsStageLabel: stageInfo?.label || j.status,
      crewAssigned: j.crewAssigned || '',
      scheduledDate: j.scheduledDate || '',
      contractValue: j.contractValue,
      paymentStatus: j.paymentStatus,
      amountPaid: j.amountPaid,
      notes: j.notes || '',
      salesRep: j.salesRep || '',
      materialsStatus: j.materialsStatus,
      drawingComplete: j.drawingComplete,
      locatesDate: j.locatesDate || '',
      locatesExpDate: j.locatesExpDate || '',
      holdReason: j.holdReason || '',
      rawJob: j,
    })
  }

  // Staging jobs that DON'T have a corresponding job (avoid duplicates)
  for (const s of staging) {
    if (s.quoteId && seenQuoteIds.has(s.quoteId)) continue
    const opsStage = mapStagingStatus(s.status)
    const stageInfo = OPS_STAGES.find(st => st.key === opsStage)
    result.push({
      id: s.id,
      source: 'staging',
      customerName: s.clientName,
      address: s.area || '',
      fenceType: s.fenceType,
      sections: s.sections,
      opsStage,
      opsStageLabel: stageInfo?.label || s.status,
      crewAssigned: '',
      scheduledDate: '',
      contractValue: s.jobPrice,
      paymentStatus: 'not_invoiced',
      amountPaid: 0,
      notes: s.notes || '',
      salesRep: '',
      materialsStatus: 'not_ordered',
      drawingComplete: false,
      locatesDate: s.locatesGoodDate || '',
      locatesExpDate: s.locatesExpDate || '',
      holdReason: '',
      rawStaging: s,
    })
  }

  return result
}

type ViewMode = 'board' | 'list'

const fmt = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

// ══════════════════════════════════════════════════
// MAIN PAGE
// ══════════════════════════════════════════════════

export default function OperationsPage() {
  const [view, setView] = useState<ViewMode>('board')
  const [jobs, setJobs] = useState<UnifiedJob[]>([])
  const [selected, setSelected] = useState<UnifiedJob | null>(null)
  const [search, setSearch] = useState('')
  const [stageFilter, setStageFilter] = useState<string>('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => { setJobs(buildUnifiedList()) }, [refreshKey])

  function refresh() { setRefreshKey(k => k + 1); setSelected(null) }

  const filtered = useMemo(() => {
    let list = jobs
    if (stageFilter) list = list.filter(j => j.opsStage === stageFilter)
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(j =>
        j.customerName.toLowerCase().includes(q) ||
        j.fenceType.toLowerCase().includes(q) ||
        j.address.toLowerCase().includes(q) ||
        j.crewAssigned.toLowerCase().includes(q)
      )
    }
    return list
  }, [jobs, stageFilter, search])

  // KPI stats
  const active = jobs.filter(j => !['completed', 'invoiced', 'paid', 'on_hold'].includes(j.opsStage))
  const totalContract = jobs.reduce((s, j) => s + j.contractValue, 0)
  const totalPaid = jobs.reduce((s, j) => s + j.amountPaid, 0)
  const onHold = jobs.filter(j => j.opsStage === 'on_hold' || j.opsStage === 'customer_delay' || j.opsStage === 'backorder')

  // Handle advancing a job from the unified view
  function handleAdvance(uj: UnifiedJob) {
    if (uj.source !== 'job' || !uj.rawJob) return
    const fromStatus = uj.rawJob.status
    const result = advanceJob(uj.id)
    if (result && (result.status === 'completed' || result.status === 'paid')) {
      onJobCompleted({
        jobId: uj.id,
        customerId: uj.rawJob.customerId,
        customerName: uj.customerName,
        customerPhone: uj.rawJob.customerPhone,
        customerEmail: uj.rawJob.customerEmail,
        stageName: 'Complete',
        fromStage: fromStatus,
      })
    }
    refresh()
  }

  function handleHold(uj: UnifiedJob) {
    if (uj.source !== 'job' || !uj.rawJob) return
    const reason = prompt('Hold reason:')
    if (!reason) return
    holdJob(uj.id, reason)
    refresh()
  }

  function handleUnhold(uj: UnifiedJob) {
    if (uj.source !== 'job' || !uj.rawJob) return
    unholdJob(uj.id)
    refresh()
  }

  function handleMoveStage(uj: UnifiedJob, targetStage: string) {
    if (uj.source !== 'job' || !uj.rawJob) return
    const fromStage = uj.rawJob.status
    // Map ops stage to job status
    const stageToStatus: Record<string, JobStatus> = {
      'awaiting_locates': 'staging', 'need_drawing': 'staging', 'materials_ordered': 'staging',
      'ready_to_pull': 'staging', 'scheduled': 'scheduled', 'in_progress': 'in_progress',
      'completed': 'completed', 'invoiced': 'invoiced', 'paid': 'paid', 'on_hold': 'on_hold',
    }
    const newStatus = stageToStatus[targetStage] || 'staging'
    const updates: Partial<Job> = { status: newStatus }

    // Set material status for staging sub-stages
    if (targetStage === 'materials_ordered') updates.materialsStatus = 'ordered'
    if (targetStage === 'ready_to_pull') updates.materialsStatus = 'received'
    if (targetStage === 'need_drawing') updates.drawingComplete = false
    if (targetStage === 'completed') updates.completedDate = new Date().toISOString().slice(0, 10)

    updateJob(uj.id, updates)

    // Fire automation
    fireOpsStageChange(uj.id, fromStage, targetStage, {
      jobName: uj.customerName,
      jobAddress: uj.address,
      fenceType: uj.fenceType,
      crewAssigned: uj.crewAssigned,
      customerName: uj.customerName,
    })

    // If moving to any completion stage, cascade back into the sales pipeline
    const completionKeys = new Set(['completed', 'complete', 'paid'])
    if (completionKeys.has(targetStage)) {
      onJobCompleted({
        jobId: uj.id,
        customerId: uj.rawJob?.customerId,
        customerName: uj.customerName,
        customerPhone: uj.rawJob?.customerPhone,
        customerEmail: uj.rawJob?.customerEmail,
        stageName: 'Complete',
        fromStage,
      })
    }

    refresh()
  }

  return (
    <div className="space-y-5">
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 uppercase">Active Jobs</p>
          <p className="text-2xl font-bold text-gray-900">{active.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 uppercase">Total Jobs</p>
          <p className="text-2xl font-bold text-gray-900">{jobs.length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 uppercase">Contract Value</p>
          <p className="text-2xl font-bold text-gray-900">{fmt(totalContract)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 uppercase">Collected</p>
          <p className="text-2xl font-bold text-green-600">{fmt(totalPaid)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <p className="text-xs text-gray-400 uppercase">On Hold</p>
          <p className="text-2xl font-bold text-red-600">{onHold.length}</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search jobs..."
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-64 focus:outline-none focus:border-orange-400" />
        <div className="flex gap-2">
          {/* Stage filter pills */}
          <select value={stageFilter} onChange={e => setStageFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="">All Stages</option>
            {OPS_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {/* View toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            <button onClick={() => setView('board')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${view === 'board' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Board
            </button>
            <button onClick={() => setView('list')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition ${view === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              List
            </button>
          </div>
        </div>
      </div>

      {/* Views */}
      {view === 'board' ? (
        <BoardView jobs={filtered} onSelect={setSelected} onMoveStage={handleMoveStage} />
      ) : (
        <ListView jobs={filtered} onSelect={setSelected} onAdvance={handleAdvance} />
      )}

      {/* Detail Panel (slide-over) */}
      {selected && (
        <DetailPanel
          job={selected}
          onClose={() => setSelected(null)}
          onAdvance={() => { handleAdvance(selected); refresh() }}
          onHold={() => handleHold(selected)}
          onUnhold={() => handleUnhold(selected)}
          onMoveStage={(stage) => handleMoveStage(selected, stage)}
          onUpdate={(updates) => {
            if (selected.source === 'job' && selected.rawJob) {
              updateJob(selected.id, updates)
              refresh()
            }
          }}
        />
      )}
    </div>
  )
}

// ── Board View (Kanban) ──

function BoardView({ jobs, onSelect, onMoveStage }: { jobs: UnifiedJob[]; onSelect: (j: UnifiedJob) => void; onMoveStage: (j: UnifiedJob, stage: string) => void }) {
  // Render ALL stages — empty columns still show so jobs can be dragged into them
  const activeStages = OPS_STAGES
  const dragId = useRef<string | null>(null)
  const [dragOverStage, setDragOverStage] = useState<string | null>(null)

  function onDragStart(e: React.DragEvent, j: UnifiedJob) {
    if (j.source !== 'job') { e.preventDefault(); return }
    dragId.current = j.id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', j.id)
  }
  function onDragOverCol(e: React.DragEvent, stageKey: string) {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
    setDragOverStage(stageKey)
  }
  function onDropCol(e: React.DragEvent, stageKey: string) {
    e.preventDefault()
    const id = dragId.current || e.dataTransfer.getData('text/plain')
    setDragOverStage(null)
    dragId.current = null
    if (!id) return
    const j = jobs.find(x => x.id === id)
    if (!j || j.opsStage === stageKey) return
    onMoveStage(j, stageKey)
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 400 }}>
      {activeStages.map(stage => {
        const stageJobs = jobs.filter(j => j.opsStage === stage.key)
        const isHot = dragOverStage === stage.key
        return (
          <div key={stage.key} className="flex-shrink-0 w-72"
            onDragOver={(e) => onDragOverCol(e, stage.key)}
            onDragLeave={() => setDragOverStage(null)}
            onDrop={(e) => onDropCol(e, stage.key)}>
            <div className="flex items-center gap-2 mb-2 px-1">
              <div className={`w-2.5 h-2.5 rounded-full ${stage.color}`} />
              <span className="text-sm font-semibold text-gray-700">{stage.label}</span>
              <span className="text-xs text-gray-400 ml-auto">{stageJobs.length}</span>
            </div>
            <div className={`space-y-2 rounded-xl transition-colors p-1 ${isHot ? 'bg-orange-50 ring-2 ring-orange-300' : ''}`}>
              {stageJobs.map(j => (
                <OpsCard key={j.id} job={j} stage={stage}
                  onSelect={() => onSelect(j)}
                  onAdvance={() => {
                    const idx = OPS_STAGES.findIndex(s => s.key === stage.key)
                    const next = OPS_STAGES[idx + 1]
                    if (next) onMoveStage(j, next.key)
                  }}
                  onDragStart={(e) => onDragStart(e, j)}
                />
              ))}
              {stageJobs.length === 0 && (
                <div className="text-center py-8 text-xs text-gray-300 border-2 border-dashed border-gray-200 rounded-lg">
                  Drop jobs here
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function OpsCard({ job, stage, onSelect, onAdvance, onDragStart }: {
  job: UnifiedJob
  stage: { key: string; color: string; bg: string; text: string; label: string }
  onSelect: () => void
  onAdvance: () => void
  onDragStart: (e: React.DragEvent) => void
}) {
  // Pull checklist progress from the checklist store (inline require to avoid circular import)
  const [progress, setProgress] = useState<{ total: number; complete: number }>({ total: 0, complete: 0 })
  useEffect(() => {
    let cancelled = false
    import('./checklistStore').then(m => {
      if (cancelled) return
      if (job.source === 'job') setProgress(m.getChecklistProgress(job.id))
    })
    const reload = () => {
      if (cancelled || job.source !== 'job') return
      import('./checklistStore').then(m => { if (!cancelled) setProgress(m.getChecklistProgress(job.id)) })
    }
    window.addEventListener('fencepro:checklist:updated', reload)
    return () => { cancelled = true; window.removeEventListener('fencepro:checklist:updated', reload) }
  }, [job.id, job.source])

  const draggable = job.source === 'job'
  const pct = progress.total > 0 ? (progress.complete / progress.total) * 100 : 0
  const stageColorHex: Record<string, string> = {
    'bg-blue-500': '#3b82f6', 'bg-yellow-500': '#eab308', 'bg-orange-500': '#f97316',
    'bg-purple-500': '#a855f7', 'bg-green-500': '#10b981', 'bg-teal-500': '#14b8a6',
    'bg-gray-500': '#6b7280', 'bg-blue-400': '#60a5fa', 'bg-green-400': '#34d399',
    'bg-red-500': '#ef4444', 'bg-rose-500': '#f43f5e', 'bg-amber-500': '#f59e0b',
  }

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onSelect}
      className={`bg-white border border-gray-200 rounded-xl p-3 cursor-pointer hover:shadow-md transition group relative ${draggable ? 'active:scale-[0.99]' : ''}`}
      style={{ borderLeft: `4px solid ${stageColorHex[stage.color] || '#94a3b8'}` }}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-gray-900 text-sm truncate">{job.customerName}</p>
          <p className="text-xs text-gray-400 truncate">{job.address || 'No address'}</p>
        </div>
        <span className="text-xs font-bold text-gray-700 shrink-0 ml-2">{fmt(job.contractValue)}</span>
      </div>
      <p className="text-xs text-gray-500 mt-1 truncate">{job.fenceType} · {job.sections} sec</p>

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        {job.scheduledDate ? (
          <span className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">📅 {job.scheduledDate}</span>
        ) : (
          <span className="text-[10px] bg-orange-100 text-orange-700 rounded-full px-2 py-0.5 font-semibold">Unscheduled</span>
        )}
        {job.crewAssigned && (
          <span className="text-[10px] bg-blue-100 text-blue-700 rounded-full px-2 py-0.5">👷 {job.crewAssigned}</span>
        )}
        {(job.rawJob as any)?.isRainDay && (
          <span className="text-[10px] bg-cyan-100 text-cyan-700 rounded-full px-2 py-0.5">🌧 Rain</span>
        )}
      </div>

      {job.source === 'job' && progress.total > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
            <span>Milestones</span>
            <span>{progress.complete} of {progress.total}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1">
            <div className="h-1 rounded-full bg-orange-500 transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}

      {job.source === 'job' && stage.key !== 'paid' && (
        <button onClick={(e) => { e.stopPropagation(); onAdvance() }}
          className="absolute top-2 right-2 text-[10px] text-orange-600 bg-white rounded-full px-2 py-0.5 border border-orange-200 opacity-0 group-hover:opacity-100 transition font-medium">
          Next →
        </button>
      )}
    </div>
  )
}

// ── List View ──

function ListView({ jobs, onSelect, onAdvance }: { jobs: UnifiedJob[]; onSelect: (j: UnifiedJob) => void; onAdvance: (j: UnifiedJob) => void }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 hidden lg:grid grid-cols-12 gap-4 text-xs font-medium text-gray-500 uppercase tracking-wide">
        <div className="col-span-3">Customer</div>
        <div className="col-span-2">Fence Type</div>
        <div className="col-span-2">Stage</div>
        <div className="col-span-1">Crew</div>
        <div className="col-span-1">Date</div>
        <div className="col-span-1 text-right">Value</div>
        <div className="col-span-2 text-right">Actions</div>
      </div>
      <div className="divide-y divide-gray-50">
        {jobs.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">No jobs match your filters</div>
        ) : jobs.map(j => {
          const stage = OPS_STAGES.find(s => s.key === j.opsStage)
          return (
            <div key={j.id} onClick={() => onSelect(j)}
              className="px-4 lg:px-6 py-3 flex flex-col lg:grid lg:grid-cols-12 gap-1 lg:gap-4 lg:items-center hover:bg-gray-50 cursor-pointer text-sm group">
              <div className="col-span-3">
                <p className="font-medium text-gray-900">{j.customerName}</p>
                <p className="text-xs text-gray-400 truncate">{j.address}</p>
              </div>
              <div className="col-span-2 text-gray-600">{j.fenceType}</div>
              <div className="col-span-2">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${stage?.bg || 'bg-gray-100'} ${stage?.text || 'text-gray-600'}`}>
                  {j.opsStageLabel}
                </span>
              </div>
              <div className="col-span-1 text-gray-600 text-xs">{j.crewAssigned || '—'}</div>
              <div className="col-span-1 text-gray-500 text-xs">{j.scheduledDate || '—'}</div>
              <div className="col-span-1 text-right font-medium text-gray-900">{fmt(j.contractValue)}</div>
              <div className="col-span-2 text-right">
                {j.source === 'job' && j.opsStage !== 'paid' && (
                  <button onClick={(e) => { e.stopPropagation(); onAdvance(j) }}
                    className="text-xs text-orange-600 font-medium opacity-0 group-hover:opacity-100 transition">
                    Advance →
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Detail Panel (Slide-over) ──

function DetailPanel({ job, onClose, onAdvance, onHold, onUnhold, onMoveStage, onUpdate }: {
  job: UnifiedJob
  onClose: () => void
  onAdvance: () => void
  onHold: () => void
  onUnhold: () => void
  onMoveStage: (stage: string) => void
  onUpdate: (updates: Partial<Job>) => void
}) {
  const stage = OPS_STAGES.find(s => s.key === job.opsStage)
  const isJobSource = job.source === 'job'

  return (
    <div className="fixed inset-y-0 right-0 w-full lg:w-[480px] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{job.customerName}</h2>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${stage?.bg} ${stage?.text}`}>{job.opsStageLabel}</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {/* Customer Info */}
        <Section title="Customer">
          <Field label="Name" value={job.customerName} />
          <Field label="Address" value={job.address} />
          {job.rawJob?.customerPhone && <Field label="Phone" value={job.rawJob.customerPhone} />}
          {job.rawJob?.customerEmail && <Field label="Email" value={job.rawJob.customerEmail} />}
        </Section>

        {/* Scope */}
        <Section title="Scope of Work">
          <Field label="Fence Type" value={job.fenceType} />
          <Field label="Sections" value={String(job.sections)} />
          {job.rawJob && <Field label="Total Feet" value={String(job.rawJob.totalFeet || 0)} />}
          {job.rawJob && <Field label="Walk Gates" value={String(job.rawJob.walkGates)} />}
          {job.rawJob && <Field label="Double Gates" value={String(job.rawJob.dblGates)} />}
        </Section>

        {/* Operations Status */}
        <Section title="Operations Stage">
          <div className="flex flex-wrap gap-1">
            {OPS_STAGES.filter(s => !['customer_delay', 'backorder'].includes(s.key)).map(s => (
              <button key={s.key} onClick={() => onMoveStage(s.key)} disabled={!isJobSource || job.opsStage === s.key}
                className={`px-2 py-1 rounded-lg text-xs font-medium transition ${
                  job.opsStage === s.key ? `${s.bg} ${s.text}` : 'border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-30'
                }`}>
                {s.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Readiness Checklist */}
        <Section title="Milestone Checklist">
          {isJobSource ? <MilestoneChecklist jobId={job.id} /> : <p className="text-xs text-gray-400">Only available for Job records.</p>}
        </Section>

        {/* Derived readiness hints (from legacy job fields) */}
        <Section title="Readiness Signals">
          <CheckItem label="Locates" done={!!job.locatesDate} detail={job.locatesDate ? `Good: ${job.locatesDate} • Exp: ${job.locatesExpDate}` : 'Not called'} />
          <CheckItem label="Drawing" done={job.drawingComplete} />
          <CheckItem label="Materials" done={job.materialsStatus === 'received' || job.materialsStatus === 'loaded'} detail={job.materialsStatus} />
          <CheckItem label="Pull Sheet" done={job.rawJob?.pullSheetPulled || false} />
        </Section>

        {/* Crew & Schedule */}
        <Section title="Crew & Schedule">
          {isJobSource ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Crew</label>
                  <input type="text" value={job.crewAssigned} onChange={e => onUpdate({ crewAssigned: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Scheduled Date</label>
                  <input type="date" value={job.scheduledDate} onChange={e => onUpdate({ scheduledDate: e.target.value })}
                    className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
                </div>
              </div>
              <Field label="Sales Rep" value={job.salesRep} />
            </>
          ) : (
            <>
              <Field label="Crew" value={job.crewAssigned || 'Not assigned'} />
              <Field label="Scheduled" value={job.scheduledDate || 'Not scheduled'} />
            </>
          )}
        </Section>

        {/* Pricing & Payment */}
        <Section title="Financial">
          <Field label="Contract Value" value={fmt(job.contractValue)} />
          <Field label="Amount Paid" value={fmt(job.amountPaid)} />
          <Field label="Outstanding" value={fmt(job.contractValue - job.amountPaid)} />
          <Field label="Payment Status" value={job.paymentStatus} />
        </Section>

        {/* Notes */}
        <Section title="Notes">
          {isJobSource ? (
            <textarea value={job.notes} onChange={e => onUpdate({ notes: e.target.value })} rows={3}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          ) : (
            <p className="text-sm text-gray-600">{job.notes || 'No notes'}</p>
          )}
        </Section>

        {/* Hold info */}
        {job.opsStage === 'on_hold' && job.holdReason && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-xs font-semibold text-red-700">Hold Reason</p>
            <p className="text-sm text-red-600 mt-1">{job.holdReason}</p>
          </div>
        )}
      </div>

      {/* Footer actions */}
      {isJobSource && (
        <div className="px-6 py-4 border-t border-gray-200 flex gap-2">
          {job.opsStage === 'on_hold' ? (
            <button onClick={onUnhold} className="flex-1 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium">Resume</button>
          ) : (
            <>
              <button onClick={onAdvance} disabled={job.opsStage === 'paid'}
                className="flex-1 bg-orange-500 hover:bg-orange-600 text-white py-2 rounded-lg text-sm font-medium disabled:opacity-40">
                Advance Stage →
              </button>
              <button onClick={onHold}
                className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50">
                Hold
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Shared sub-components ──

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium text-gray-900">{value || '—'}</span>
    </div>
  )
}

function CheckItem({ label, done, detail }: { label: string; done: boolean; detail?: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded-full flex items-center justify-center text-xs ${done ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-400'}`}>
        {done ? '✓' : ''}
      </div>
      <span className={`text-sm ${done ? 'text-gray-900' : 'text-gray-400'}`}>{label}</span>
      {detail && <span className="text-xs text-gray-400 ml-auto">{detail}</span>}
    </div>
  )
}

import { getChecklistForJob, toggleChecklistItem, type ChecklistItem } from './checklistStore'
import { toast } from './toast'

function MilestoneChecklist({ jobId }: { jobId: string }) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)

  function reload() { setItems(getChecklistForJob(jobId)) }
  useEffect(() => {
    reload()
    const onUpdate = () => reload()
    window.addEventListener('fencepro:checklist:updated', onUpdate)
    return () => window.removeEventListener('fencepro:checklist:updated', onUpdate)
  }, [jobId])

  function handleToggle(item: ChecklistItem) {
    setBusyId(item.id)
    // Optimistic
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, isComplete: !i.isComplete } : i))
    try {
      const updated = toggleChecklistItem(jobId, item.id, 'user')
      if (!updated) throw new Error('Item not found')
    } catch (err: any) {
      // Revert
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, isComplete: item.isComplete } : i))
      toast.error('Could not update milestone', err?.message || 'Unknown error')
    } finally {
      setBusyId(null)
    }
  }

  const complete = items.filter(i => i.isComplete).length
  const pct = items.length > 0 ? (complete / items.length) * 100 : 0

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-500">{complete} of {items.length} complete</span>
        <div className="flex-1 mx-3 h-1.5 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-1.5 bg-orange-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-gray-500">{Math.round(pct)}%</span>
      </div>
      {items.map(item => (
        <label key={item.id}
          className={`flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer transition-colors ${item.isComplete ? 'bg-green-50' : 'hover:bg-gray-50'} ${busyId === item.id ? 'opacity-60' : ''}`}>
          <input type="checkbox" checked={item.isComplete}
            onChange={() => handleToggle(item)}
            disabled={busyId === item.id}
            className="w-4 h-4 accent-orange-500 cursor-pointer" />
          <span className={`text-sm flex-1 ${item.isComplete ? 'text-gray-900 line-through' : 'text-gray-700'}`}>{item.label}</span>
          {item.isComplete && item.completedAt && (
            <span className="text-[10px] text-gray-400">{new Date(item.completedAt).toLocaleDateString()}</span>
          )}
        </label>
      ))}
    </div>
  )
}
