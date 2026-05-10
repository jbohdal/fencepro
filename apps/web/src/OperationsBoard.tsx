/**
 * OperationsBoard — vertical-swimlane redesign of the Operations / Jobs board.
 *
 * Replaces the horizontal kanban (`OperationsPage.tsx`) with:
 *   - Vertical swimlanes per ops stage + permanent "Unscheduled" lane
 *   - Mobile accordion + stage pills + bottom-sheet slide-over + FAB
 *   - Today highlight (pulsing orange ring on cards scheduled today)
 *   - Show Completed toggle (auto-archives completed > 48h)
 *   - List view with sortable columns + bulk actions + CSV export
 *   - Collapsible analytics strip
 *   - Optimistic drag-and-drop with snap-back on error
 *
 * Reuses the data-layer + DetailPanel from OperationsPage so all existing
 * automation triggers, job-completion cascade, and checklist integration work
 * unchanged.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  type UnifiedJob,
  OPS_STAGES, buildUnifiedList, DetailPanel,
} from './OperationsPage'
import { type Job, type JobStatus, getJobs, updateJob, advanceJob, holdJob, unholdJob } from './jobStore'
import { fireOpsStageChange } from './automationTrigger'
import { onJobCompleted } from './jobCompleteFlow'
import { getChecklistProgress } from './checklistStore'
import { toast } from './toast'
import { BottomSheet } from './SalesPipelineBoard'

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const TODAY = () => new Date().toISOString().slice(0, 10)

const stageColorHex: Record<string, string> = {
  'bg-blue-500': '#3b82f6', 'bg-yellow-500': '#eab308', 'bg-orange-500': '#f97316',
  'bg-purple-500': '#a855f7', 'bg-green-500': '#10b981', 'bg-teal-500': '#14b8a6',
  'bg-gray-500': '#6b7280', 'bg-blue-400': '#60a5fa', 'bg-green-400': '#34d399',
  'bg-red-500': '#ef4444', 'bg-rose-500': '#f43f5e', 'bg-amber-500': '#f59e0b',
}

const STAGE_TO_STATUS: Record<string, JobStatus> = {
  'awaiting_locates': 'staging',
  'need_drawing': 'staging',
  'materials_ordered': 'staging',
  'ready_to_pull': 'staging',
  'scheduled': 'scheduled',
  'in_progress': 'in_progress',
  'completed': 'completed',
  'invoiced': 'invoiced',
  'paid': 'paid',
  'on_hold': 'on_hold',
  'customer_delay': 'on_hold',
  'backorder': 'on_hold',
}

function withinNDays(iso: string, n: number): boolean {
  if (!iso) return false
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const now = Date.now()
  const diff = d.getTime() - now
  return diff >= 0 && diff <= n * 86_400_000
}

function isToday(iso: string): boolean {
  return !!iso && iso.slice(0, 10) === TODAY()
}

function daysSince(iso: string): number {
  if (!iso) return 0
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000))
}

function relTime(iso?: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${Math.max(1, m)}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}

function isMobileViewport() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 767px)').matches
}

const COLLAPSE_KEY      = 'fencepro_ops_collapsed_stages'
const VIEW_KEY          = 'fencepro_ops_view'
const SORT_KEY          = 'fencepro_ops_sort'
const ANALYTICS_KEY     = 'fencepro_ops_analytics_open'
const SHOW_COMPLETED_KEY= 'fencepro_ops_show_completed'
const TODAY_HIGHLIGHT_KEY = 'fencepro_ops_highlight_today'

const VIRTUAL_THRESHOLD = 20

type SortMode = 'scheduled' | 'value' | 'name' | 'days_in_stage'
type ViewMode = 'board' | 'list'

const UNSCHEDULED_KEY = '__unscheduled__'

export default function OperationsBoard() {
  const [jobs, setJobs] = useState<UnifiedJob[]>(() => buildUnifiedList())
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) || 'board')
  const [sortMode, setSortMode] = useState<SortMode>(() => (localStorage.getItem(SORT_KEY) as SortMode) || 'scheduled')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}') } catch { return {} }
  })
  const [analyticsOpen, setAnalyticsOpen] = useState<boolean>(() => localStorage.getItem(ANALYTICS_KEY) === '1')
  const [highlightToday, setHighlightToday] = useState<boolean>(() => localStorage.getItem(TODAY_HIGHLIGHT_KEY) !== '0')
  const [showCompleted, setShowCompleted] = useState<boolean>(() => localStorage.getItem(SHOW_COMPLETED_KEY) === '1')

  const [search, setSearch] = useState('')
  const [crewFilter, setCrewFilter] = useState('')
  const [stageFilter, setStageFilter] = useState('')
  const [styleFilter, setStyleFilter] = useState('')
  const [selected, setSelected] = useState<UnifiedJob | null>(null)
  const [confirmComplete, setConfirmComplete] = useState<UnifiedJob | null>(null)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [isMobile, setIsMobile] = useState(isMobileViewport)

  const dragId = useRef<string | null>(null)

  /* ── viewport ── */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const h = () => setIsMobile(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  /* ── persist ── */
  useEffect(() => { localStorage.setItem(VIEW_KEY, view) }, [view])
  useEffect(() => { localStorage.setItem(SORT_KEY, sortMode) }, [sortMode])
  useEffect(() => { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(collapsed)) }, [collapsed])
  useEffect(() => { localStorage.setItem(ANALYTICS_KEY, analyticsOpen ? '1' : '0') }, [analyticsOpen])
  useEffect(() => { localStorage.setItem(SHOW_COMPLETED_KEY, showCompleted ? '1' : '0') }, [showCompleted])
  useEffect(() => { localStorage.setItem(TODAY_HIGHLIGHT_KEY, highlightToday ? '1' : '0') }, [highlightToday])

  /* ── refresh on external updates ── */
  function refresh() { setJobs(buildUnifiedList()) }
  useEffect(() => {
    const h = () => refresh()
    window.addEventListener('fencepro:checklist:updated', h)
    window.addEventListener('fencepro:pipeline:updated', h)
    window.addEventListener('storage', h)
    return () => {
      window.removeEventListener('fencepro:checklist:updated', h)
      window.removeEventListener('fencepro:pipeline:updated', h)
      window.removeEventListener('storage', h)
    }
  }, [])

  /* ── filter ── */
  const filtered = useMemo(() => {
    return jobs.filter(j => {
      if (!showCompleted) {
        // archive: hide completed/paid/invoiced jobs older than 48h
        const arch = (j.opsStage === 'completed' || j.opsStage === 'paid' || j.opsStage === 'invoiced')
          && j.rawJob && daysSince(j.rawJob.completedDate || j.rawJob.updatedAt) > 2
        if (arch) return false
      }
      if (stageFilter && j.opsStage !== stageFilter) return false
      if (crewFilter && j.crewAssigned !== crewFilter) return false
      if (styleFilter && j.fenceType !== styleFilter) return false
      if (!search) return true
      const q = search.toLowerCase()
      return (
        j.customerName.toLowerCase().includes(q) ||
        (j.address || '').toLowerCase().includes(q) ||
        (j.crewAssigned || '').toLowerCase().includes(q) ||
        (j.fenceType || '').toLowerCase().includes(q)
      )
    })
  }, [jobs, search, stageFilter, crewFilter, styleFilter, showCompleted])

  function sortJobs(arr: UnifiedJob[]): UnifiedJob[] {
    const out = [...arr]
    switch (sortMode) {
      case 'value':         out.sort((a, b) => (b.contractValue || 0) - (a.contractValue || 0)); break
      case 'name':          out.sort((a, b) => a.customerName.localeCompare(b.customerName)); break
      case 'days_in_stage': out.sort((a, b) => daysSince((b.rawJob?.updatedAt || '')) - daysSince(a.rawJob?.updatedAt || '')); break
      case 'scheduled':
      default: {
        out.sort((a, b) => {
          if (!a.scheduledDate && !b.scheduledDate) return 0
          if (!a.scheduledDate) return 1
          if (!b.scheduledDate) return -1
          return a.scheduledDate.localeCompare(b.scheduledDate)
        })
      }
    }
    return out
  }

  /* ── DnD: optimistic ── */
  function onDragStart(e: React.DragEvent, j: UnifiedJob) {
    if (isMobile || j.source !== 'job') { e.preventDefault(); return }
    dragId.current = j.id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', j.id)
  }

  function onStageDrop(e: React.DragEvent, stageKey: string) {
    e.preventDefault()
    const id = dragId.current || e.dataTransfer.getData('text/plain')
    dragId.current = null
    if (!id) return
    const j = jobs.find(x => x.id === id)
    if (!j || j.opsStage === stageKey) return

    if (stageKey === 'completed') { setConfirmComplete(j); return }
    moveJobToStage(j, stageKey)
  }

  function moveJobToStage(j: UnifiedJob, targetStage: string) {
    if (j.source !== 'job' || !j.rawJob) return
    // optimistic local update
    const stageInfo = OPS_STAGES.find(s => s.key === targetStage)
    setJobs(prev => prev.map(x => x.id === j.id ? { ...x, opsStage: targetStage, opsStageLabel: stageInfo?.label || x.opsStageLabel } : x))

    const newStatus = STAGE_TO_STATUS[targetStage] || 'staging'
    const updates: Partial<Job> = { status: newStatus }
    if (targetStage === 'materials_ordered') updates.materialsStatus = 'ordered'
    if (targetStage === 'ready_to_pull')     updates.materialsStatus = 'received'
    if (targetStage === 'need_drawing')      updates.drawingComplete = false
    if (targetStage === 'completed')         updates.completedDate = TODAY()

    try {
      updateJob(j.id, updates)
      fireOpsStageChange(j.id, j.rawJob.status, targetStage, {
        jobName: j.customerName, jobAddress: j.address, fenceType: j.fenceType,
        crewAssigned: j.crewAssigned, customerName: j.customerName,
      })
      if (targetStage === 'completed' || targetStage === 'paid') {
        onJobCompleted({
          jobId: j.id, customerId: j.rawJob.customerId, customerName: j.customerName,
          customerPhone: j.rawJob.customerPhone, customerEmail: j.rawJob.customerEmail,
          stageName: 'Complete', fromStage: j.rawJob.status,
        })
      }
      refresh()
    } catch (err) {
      toast.error('Move failed', (err as Error)?.message || 'Could not move job')
      refresh()
    }
  }

  function confirmCompleteJob() {
    if (!confirmComplete) return
    const j = confirmComplete
    setConfirmComplete(null)
    moveJobToStage(j, 'completed')
    toast.success('Job marked complete', `${j.customerName} moved to Complete; customer set to Job Complete in pipeline`)
  }

  function onAdvance(j: UnifiedJob) {
    if (j.source !== 'job' || !j.rawJob) return
    const fromStatus = j.rawJob.status
    const result = advanceJob(j.id)
    if (result && (result.status === 'completed' || result.status === 'paid')) {
      onJobCompleted({
        jobId: j.id, customerId: j.rawJob.customerId, customerName: j.customerName,
        customerPhone: j.rawJob.customerPhone, customerEmail: j.rawJob.customerEmail,
        stageName: 'Complete', fromStage: fromStatus,
      })
    }
    refresh()
  }

  function onHold(j: UnifiedJob) {
    if (j.source !== 'job') return
    const reason = prompt('Hold reason:')
    if (!reason) return
    holdJob(j.id, reason)
    refresh()
  }

  function onUnhold(j: UnifiedJob) { if (j.source === 'job') { unholdJob(j.id); refresh() } }

  function onUpdateJob(j: UnifiedJob, updates: Partial<Job>) {
    if (j.source !== 'job') return
    updateJob(j.id, updates)
    refresh()
  }

  /* ── analytics ── */
  const analytics = useMemo(() => {
    const active = jobs.filter(j => !['completed', 'invoiced', 'paid', 'on_hold'].includes(j.opsStage))
    const scheduledThisWeek = jobs.filter(j => withinNDays(j.scheduledDate, 7)).length
    const unscheduledCount = active.filter(j => !j.scheduledDate).length
    const avgValue = active.length ? active.reduce((s, j) => s + (j.contractValue || 0), 0) / active.length : 0
    // On-time rate: completed jobs in last 30d completed by/before scheduledDate
    const recentCompleted = jobs.filter(j => j.rawJob?.status === 'completed' && j.rawJob?.completedDate && daysSince(j.rawJob.completedDate) <= 30)
    const onTime = recentCompleted.filter(j => j.rawJob && j.rawJob.completedDate && j.rawJob.scheduledDate && j.rawJob.completedDate <= j.rawJob.scheduledDate)
    const onTimeRate = recentCompleted.length ? Math.round((onTime.length / recentCompleted.length) * 100) : 0
    // Weather alerts: jobs in next 14d flagged isRainDay
    const weatherAlerts = jobs.filter(j => withinNDays(j.scheduledDate, 14) && (j.rawJob as Job & { isRainDay?: boolean })?.isRainDay).length
    return {
      activeCount: active.length, scheduledThisWeek, unscheduledCount, avgValue, onTimeRate, weatherAlerts,
      totalContract: jobs.reduce((s, j) => s + j.contractValue, 0),
      totalCollected: jobs.reduce((s, j) => s + j.amountPaid, 0),
    }
  }, [jobs])

  /* ── crew/style options ── */
  const crewOptions = useMemo(() => {
    const set = new Set<string>()
    jobs.forEach(j => j.crewAssigned && set.add(j.crewAssigned))
    return Array.from(set)
  }, [jobs])
  const styleOptions = useMemo(() => {
    const set = new Set<string>()
    jobs.forEach(j => j.fenceType && set.add(j.fenceType))
    return Array.from(set)
  }, [jobs])

  /* ── csv export ── */
  function exportCSV(rows: UnifiedJob[]) {
    const headers = ['Customer','Address','Fence Type','Stage','Scheduled','Crew','Contract Value','Amount Paid','Notes']
    const lines = [headers.join(',')]
    rows.forEach(j => {
      const cells = [
        j.customerName, j.address, j.fenceType, j.opsStageLabel, j.scheduledDate,
        j.crewAssigned, j.contractValue, j.amountPaid, j.notes,
      ].map(v => {
        const s = String(v ?? '')
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      })
      lines.push(cells.join(','))
    })
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `operations-${TODAY()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ── matchesSearch for fade-but-don't-hide ── */
  const matchesSearch = useMemo(() => {
    if (!search.trim()) return null
    const q = search.toLowerCase()
    return new Set(jobs.filter(j =>
      j.customerName.toLowerCase().includes(q) ||
      (j.address || '').toLowerCase().includes(q) ||
      (j.crewAssigned || '').toLowerCase().includes(q)
    ).map(j => j.id))
  }, [jobs, search])

  /* ── grouping ── */
  // Build the lane order: Unscheduled first, then OPS_STAGES.
  type LaneSpec = { key: string; label: string; color: string; bg: string; text: string; muted?: boolean }
  const laneOrder = useMemo<LaneSpec[]>(() => {
    return [
      { key: UNSCHEDULED_KEY, label: 'Unscheduled', color: 'bg-gray-300', bg: 'bg-gray-50', text: 'text-gray-600', muted: true },
      ...OPS_STAGES.map(s => ({ ...s })),
    ]
  }, [])

  function laneJobs(laneKey: string): UnifiedJob[] {
    if (laneKey === UNSCHEDULED_KEY) {
      return sortJobs(filtered.filter(j => !j.scheduledDate && !['completed','invoiced','paid'].includes(j.opsStage)))
    }
    // exclude unscheduled from the regular lanes (they're shown only in the Unscheduled lane)
    return sortJobs(filtered.filter(j => j.opsStage === laneKey && j.scheduledDate))
  }

  return (
    <div className="flex flex-col h-full">
      <ControlsBar
        title="Operations"
        primaryLabel="+ New Job"
        onPrimary={() => toast.info('New Job', 'Create a quote and mark it as Sold to add it to the operations board.')}
        view={view} onViewChange={setView}
        search={search} onSearchChange={setSearch}
        sortMode={sortMode} onSortChange={setSortMode}
        crewOptions={crewOptions} crewFilter={crewFilter} onCrewFilterChange={setCrewFilter}
        styleOptions={styleOptions} styleFilter={styleFilter} onStyleFilterChange={setStyleFilter}
        stageFilter={stageFilter} onStageFilterChange={setStageFilter}
        analyticsOpen={analyticsOpen} onToggleAnalytics={() => setAnalyticsOpen(o => !o)}
        showCompleted={showCompleted} onShowCompletedChange={setShowCompleted}
        highlightToday={highlightToday} onHighlightTodayChange={setHighlightToday}
        activeCount={analytics.activeCount}
        scheduledThisWeek={analytics.scheduledThisWeek}
        isMobile={isMobile}
      />

      {analyticsOpen && (
        <AnalyticsStrip metrics={[
          { label: 'Active Jobs',         value: String(analytics.activeCount) },
          { label: 'Scheduled This Week', value: String(analytics.scheduledThisWeek) },
          { label: 'Unscheduled',         value: String(analytics.unscheduledCount), highlight: analytics.unscheduledCount > 0 ? 'orange' : undefined },
          { label: 'Avg Job Value',       value: fmtUSD(analytics.avgValue) },
          { label: 'On-Time Rate',        value: `${analytics.onTimeRate}%` },
          { label: 'Weather Alerts',      value: String(analytics.weatherAlerts), highlight: analytics.weatherAlerts > 0 ? 'orange' : undefined },
        ]} />
      )}

      {/* mobile stage pills */}
      {isMobile && view === 'board' && (
        <StagePills
          stages={laneOrder.map(s => s.label)}
          onJump={label => {
            const found = laneOrder.find(l => l.label === label)
            if (!found) return
            const el = document.getElementById(`opslane-${slug(found.key)}`)
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            setCollapsed(prev => ({ ...prev, [found.key]: false }))
          }}
        />
      )}

      {view === 'board' ? (
        <div className="flex-1 overflow-y-auto pb-32 md:pb-4 space-y-3">
          {laneOrder.map(lane => {
            const ljobs = laneJobs(lane.key)
            const total = ljobs.reduce((s, j) => s + (j.contractValue || 0), 0)
            const crewCount = new Set(ljobs.map(j => j.crewAssigned).filter(Boolean)).size
            const isOpen = !collapsed[lane.key]
            // Auto-collapse empty unscheduled
            const showOpen = lane.key === UNSCHEDULED_KEY ? (isOpen && ljobs.length > 0) : isOpen
            return (
              <Swimlane
                key={lane.key}
                id={`opslane-${slug(lane.key)}`}
                label={lane.label}
                count={ljobs.length}
                total={total}
                crewCount={crewCount}
                isOpen={showOpen}
                onToggle={() => setCollapsed(prev => ({ ...prev, [lane.key]: !prev[lane.key] }))}
                onDrop={e => onStageDrop(e, lane.key === UNSCHEDULED_KEY ? '' : lane.key)}
                colorHex={lane.muted ? undefined : (stageColorHex[lane.color] || '#9ca3af')}
                muted={lane.muted}
                isComplete={lane.key === 'completed'}
              >
                <CardGrid
                  jobs={ljobs}
                  onCardClick={setSelected}
                  onDragStart={onDragStart}
                  isMobile={isMobile}
                  highlightToday={highlightToday}
                  showStageBadge={lane.key === UNSCHEDULED_KEY}
                  matchesSearch={matchesSearch}
                  onSwipeRight={(j) => {
                    const idx = OPS_STAGES.findIndex(s => s.key === j.opsStage)
                    const next = OPS_STAGES[idx + 1]
                    if (next) {
                      if (next.key === 'completed') setConfirmComplete(j)
                      else moveJobToStage(j, next.key)
                    }
                  }}
                  onSwipeLeft={(j) => {
                    if (window.confirm(`Flag ${j.customerName} as Rain Day / Hold?`)) {
                      if (j.rawJob) updateJob(j.id, { holdReason: 'Rain Day', status: 'on_hold' as JobStatus })
                      refresh()
                    }
                  }}
                />
              </Swimlane>
            )
          })}
        </div>
      ) : (
        <OpsListView
          jobs={sortJobs(filtered)}
          stages={OPS_STAGES}
          onRowClick={setSelected}
          bulkSelected={bulkSelected}
          onBulkChange={setBulkSelected}
          onBulkMove={(toStage) => {
            const ids = bulkSelected
            jobs.filter(j => ids.has(j.id)).forEach(j => moveJobToStage(j, toStage))
            setBulkSelected(new Set())
          }}
          onExportSelected={() => {
            const sel = bulkSelected.size ? jobs.filter(j => bulkSelected.has(j.id)) : jobs
            exportCSV(sel)
          }}
          onAdvance={onAdvance}
          highlightToday={highlightToday}
        />
      )}

      {/* Mobile FAB */}
      {isMobile && (
        <button
          onClick={() => toast.info('New Job', 'Create a quote and mark it as Sold to add it to the operations board.')}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-3xl font-light shadow-2xl flex items-center justify-center"
          aria-label="New Job"
        >+</button>
      )}

      {/* Detail panel / bottom sheet */}
      {selected && (
        isMobile ? (
          <BottomSheet onClose={() => setSelected(null)}>
            <DetailPanel
              job={selected}
              onClose={() => setSelected(null)}
              onAdvance={() => { onAdvance(selected); setSelected(null) }}
              onHold={() => onHold(selected)}
              onUnhold={() => onUnhold(selected)}
              onMoveStage={(stage) => moveJobToStage(selected, stage)}
              onUpdate={(updates) => onUpdateJob(selected, updates)}
            />
          </BottomSheet>
        ) : (
          <DetailPanel
            job={selected}
            onClose={() => setSelected(null)}
            onAdvance={() => { onAdvance(selected); setSelected(null) }}
            onHold={() => onHold(selected)}
            onUnhold={() => onUnhold(selected)}
            onMoveStage={(stage) => moveJobToStage(selected, stage)}
            onUpdate={(updates) => onUpdateJob(selected, updates)}
          />
        )
      )}

      {/* Complete confirmation */}
      {confirmComplete && (
        <ConfirmModal
          title="Mark this job as complete?"
          body={`This will move ${confirmComplete.customerName} to Complete and update the customer to Job Complete in the Sales Pipeline.`}
          confirmLabel="Confirm — Mark Complete"
          onCancel={() => setConfirmComplete(null)}
          onConfirm={confirmCompleteJob}
        />
      )}
    </div>
  )
}

/* ─────────── pieces ─────────── */

function slug(s: string) { return s.replace(/[^a-z0-9]+/gi, '-').toLowerCase() }

function Swimlane({
  id, label, count, total, crewCount, isOpen, onToggle, onDrop, colorHex, muted, isComplete, children,
}: {
  id: string
  label: string
  count: number
  total: number
  crewCount: number
  isOpen: boolean
  onToggle: () => void
  onDrop: (e: React.DragEvent) => void
  colorHex?: string
  muted?: boolean
  isComplete?: boolean
  children: React.ReactNode
}) {
  const [hot, setHot] = useState(false)
  const headerStyle: CSSProperties = isComplete
    ? { borderLeftColor: '#22c55e', borderLeftWidth: '4px' }
    : muted
      ? { borderLeftColor: '#d1d5db', borderLeftWidth: '4px' }
      : { borderLeftColor: colorHex || '#9ca3af', borderLeftWidth: '4px' }

  return (
    <section id={id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        onDragOver={e => { e.preventDefault(); setHot(true) }}
        onDragLeave={() => setHot(false)}
        onDrop={e => { setHot(false); onDrop(e) }}
        style={headerStyle}
        className={`sticky top-0 z-10 w-full pl-4 pr-4 py-3 flex items-center justify-between gap-3 ${muted ? 'bg-gray-50' : 'bg-white'} hover:bg-gray-50 transition-colors ${hot ? 'ring-2 ring-orange-300 bg-orange-50' : ''}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isComplete && <span className="text-base">✓</span>}
          <span className={`text-sm font-bold truncate ${muted ? 'text-gray-600' : 'text-gray-900'}`}>{label}</span>
          <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-semibold">{count}</span>
          {!muted && total > 0 && <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">{fmtUSD(total)}</span>}
          {!muted && crewCount > 0 && <span className="hidden md:inline text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">{crewCount} crew</span>}
        </div>
        <span className={`text-gray-400 text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {isOpen && (
        <div
          onDragOver={e => { e.preventDefault(); setHot(true) }}
          onDragLeave={() => setHot(false)}
          onDrop={e => { setHot(false); onDrop(e) }}
          className={`px-3 py-3 ${hot ? 'bg-orange-50/40' : 'bg-gray-50/40'}`}
        >
          {children}
        </div>
      )}
      {!isOpen && count > 0 && (
        <div className="px-4 pb-3 text-xs text-gray-400">{count} hidden — click to expand</div>
      )}
    </section>
  )
}

function CardGrid({
  jobs, onCardClick, onDragStart, isMobile, highlightToday, showStageBadge, matchesSearch, onSwipeRight, onSwipeLeft,
}: {
  jobs: UnifiedJob[]
  onCardClick: (j: UnifiedJob) => void
  onDragStart: (e: React.DragEvent, j: UnifiedJob) => void
  isMobile: boolean
  highlightToday: boolean
  showStageBadge: boolean
  matchesSearch: Set<string> | null
  onSwipeRight: (j: UnifiedJob) => void
  onSwipeLeft: (j: UnifiedJob) => void
}) {
  if (jobs.length === 0) {
    return (
      <div className="border-2 border-dashed border-gray-200 rounded-xl px-4 py-6 flex items-center justify-center text-xs text-gray-400">
        <span className="mr-2 text-base">+</span>No jobs in this stage
      </div>
    )
  }
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? jobs : jobs.slice(0, VIRTUAL_THRESHOLD)
  const hidden = jobs.length - visible.length
  return (
    <div>
      <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
        {visible.map(j => (
          <OpsCard
            key={j.id}
            job={j}
            onClick={() => onCardClick(j)}
            onDragStart={(e) => onDragStart(e, j)}
            isMobile={isMobile}
            highlightToday={highlightToday}
            showStageBadge={showStageBadge}
            faded={matchesSearch !== null && !matchesSearch.has(j.id)}
            onSwipeRight={() => onSwipeRight(j)}
            onSwipeLeft={() => onSwipeLeft(j)}
          />
        ))}
      </div>
      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-2 w-full text-center py-2 text-xs text-gray-500 hover:text-orange-600 border border-dashed border-gray-300 rounded-lg"
        >
          Show {hidden} more cards
        </button>
      )}
    </div>
  )
}

function OpsCard({
  job, onClick, onDragStart, isMobile, highlightToday, showStageBadge, faded, onSwipeRight, onSwipeLeft,
}: {
  job: UnifiedJob
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
  isMobile: boolean
  highlightToday: boolean
  showStageBadge: boolean
  faded: boolean
  onSwipeRight: () => void
  onSwipeLeft: () => void
}) {
  const stageInfo = OPS_STAGES.find(s => s.key === job.opsStage)
  const hex = stageInfo ? (stageColorHex[stageInfo.color] || '#9ca3af') : '#9ca3af'
  const [progress, setProgress] = useState<{ total: number; complete: number }>({ total: 0, complete: 0 })
  const [menuOpen, setMenuOpen] = useState(false)
  const swipe = useSwipe(isMobile, { onLeft: onSwipeLeft, onRight: onSwipeRight })

  useEffect(() => {
    if (job.source !== 'job') return
    setProgress(getChecklistProgress(job.id))
    const reload = () => setProgress(getChecklistProgress(job.id))
    window.addEventListener('fencepro:checklist:updated', reload)
    return () => window.removeEventListener('fencepro:checklist:updated', reload)
  }, [job.id, job.source])

  const pct = progress.total > 0 ? (progress.complete / progress.total) * 100 : 0
  const today = highlightToday && isToday(job.scheduledDate)
  const draggable = !isMobile && job.source === 'job'
  const city = (job.address || '').split(',').slice(-2)[0]?.trim() || job.address || ''
  const isRain = (job.rawJob as Job & { isRainDay?: boolean })?.isRainDay
  const weatherAlert = withinNDays(job.scheduledDate, 7) && isRain

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onClick={onClick}
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      className={`relative bg-white rounded-xl shadow-sm hover:shadow-md hover:bg-gray-50 transition-all cursor-pointer p-3 group select-none ${faded ? 'opacity-20' : ''} ${today ? 'ring-2 ring-orange-400' : ''}`}
      style={{
        borderLeft: `4px solid ${hex}`,
        transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined,
        transition: swipe.dx ? undefined : 'transform 200ms ease-out',
      }}
    >
      {isMobile && swipe.dx > 30 && (
        <div className="absolute inset-y-0 left-0 -translate-x-full bg-green-500 text-white px-3 flex items-center text-xs font-semibold rounded-l-xl">→ Next Stage</div>
      )}
      {isMobile && swipe.dx < -30 && (
        <div className="absolute inset-y-0 right-0 translate-x-full bg-red-500 text-white px-3 flex items-center text-xs font-semibold rounded-r-xl">Flag Rain Day</div>
      )}

      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{job.customerName}</p>
        </div>
        <p className="text-sm font-bold text-emerald-600 shrink-0">{fmtUSD(job.contractValue)}</p>
      </div>
      <p className="text-xs text-gray-500 truncate">
        {city}{job.fenceType ? <> · <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{job.fenceType}</span></> : null}
      </p>

      <div className="flex items-center gap-1.5 mt-2 text-[11px]">
        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold truncate">{job.crewAssigned ? `👷 ${job.crewAssigned}` : 'No crew'}</span>
        {showStageBadge && stageInfo && (
          <span className="px-2 py-0.5 rounded-full text-white font-semibold" style={{ backgroundColor: hex }}>{stageInfo.label}</span>
        )}
      </div>

      <div className="flex items-center justify-between mt-2 text-[11px]">
        {job.scheduledDate ? (
          <span className="text-gray-500">📅 {job.scheduledDate}{today ? ' • Today' : ''}</span>
        ) : (
          <span className="text-orange-600 font-semibold">Unscheduled</span>
        )}
        {weatherAlert && <span title="Rain forecast" className="text-cyan-600">🌧</span>}
      </div>

      {progress.total > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
            <span>Milestones</span>
            <span>{progress.complete} of {progress.total}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-1.5">
            <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: hex }} />
          </div>
        </div>
      )}

      {isRain && (
        <span className="absolute top-1.5 right-1.5 text-[10px] bg-cyan-100 text-cyan-700 rounded-full px-1.5 py-0.5 font-semibold">Rain</span>
      )}

      {!isMobile && (
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition">
          <button onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
            className="px-1 py-0.5 text-gray-400 hover:text-gray-700 text-sm rounded hover:bg-gray-100"
            aria-label="Card actions">⋯</button>
          {menuOpen && (
            <div onClick={e => e.stopPropagation()} className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg text-xs z-20">
              <button onClick={onClick} className="block w-full text-left px-3 py-2 hover:bg-gray-50">View / Edit</button>
              <button onClick={onSwipeRight} className="block w-full text-left px-3 py-2 hover:bg-gray-50">Move to Next Stage</button>
              <button onClick={onSwipeLeft} className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-red-600">Flag Rain Day</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ControlsBar({
  title, primaryLabel, onPrimary,
  view, onViewChange,
  search, onSearchChange,
  sortMode, onSortChange,
  crewOptions, crewFilter, onCrewFilterChange,
  styleOptions, styleFilter, onStyleFilterChange,
  stageFilter, onStageFilterChange,
  analyticsOpen, onToggleAnalytics,
  showCompleted, onShowCompletedChange,
  highlightToday, onHighlightTodayChange,
  activeCount, scheduledThisWeek,
  isMobile,
}: {
  title: string
  primaryLabel: string
  onPrimary: () => void
  view: ViewMode
  onViewChange: (v: ViewMode) => void
  search: string
  onSearchChange: (s: string) => void
  sortMode: SortMode
  onSortChange: (s: SortMode) => void
  crewOptions: string[]
  crewFilter: string
  onCrewFilterChange: (s: string) => void
  styleOptions: string[]
  styleFilter: string
  onStyleFilterChange: (s: string) => void
  stageFilter: string
  onStageFilterChange: (s: string) => void
  analyticsOpen: boolean
  onToggleAnalytics: () => void
  showCompleted: boolean
  onShowCompletedChange: (v: boolean) => void
  highlightToday: boolean
  onHighlightTodayChange: (v: boolean) => void
  activeCount: number
  scheduledThisWeek: number
  isMobile: boolean
}) {
  const [openSearch, setOpenSearch] = useState(false)
  const [openFilter, setOpenFilter] = useState(false)
  if (isMobile) {
    return (
      <div className="flex items-center justify-between gap-2 mb-3 relative">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{title}</p>
          <p className="text-xs text-gray-500 truncate">{activeCount} active · {scheduledThisWeek} this week</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setOpenSearch(o => !o)} className="p-2 rounded-lg border border-gray-200 text-gray-500" aria-label="Search">🔍</button>
          <button onClick={() => setOpenFilter(o => !o)} className="p-2 rounded-lg border border-gray-200 text-gray-500" aria-label="Filter">⚙</button>
          <ViewToggle value={view} onChange={onViewChange} />
        </div>
        {openSearch && (
          <input autoFocus value={search} onChange={e => onSearchChange(e.target.value)}
            placeholder="Search jobs..." className="absolute left-0 right-0 top-full mt-2 z-30 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white shadow-lg" />
        )}
        {openFilter && (
          <div className="absolute left-0 right-0 top-full mt-2 z-30 bg-white border border-gray-200 rounded-lg p-3 space-y-2 shadow-lg">
            <select value={stageFilter} onChange={e => onStageFilterChange(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="">All stages</option>
              {OPS_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <select value={crewFilter} onChange={e => onCrewFilterChange(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="">All crews</option>
              {crewOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={styleFilter} onChange={e => onStyleFilterChange(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="">All styles</option>
              {styleOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={sortMode} onChange={e => onSortChange(e.target.value as SortMode)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="scheduled">Sched. date</option>
              <option value="value">Value</option>
              <option value="name">Customer</option>
              <option value="days_in_stage">Days in stage</option>
            </select>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={showCompleted} onChange={e => onShowCompletedChange(e.target.checked)} />Show completed (&gt;48h)</label>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={highlightToday} onChange={e => onHighlightTodayChange(e.target.checked)} />Highlight today</label>
            <button onClick={onToggleAnalytics} className="w-full text-left text-xs text-orange-600 hover:underline">{analyticsOpen ? 'Hide analytics' : 'Show analytics'}</button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-lg font-bold text-gray-900 truncate">{title}</h1>
        <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold">{activeCount} Active</span>
        <span className="text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 font-semibold">{scheduledThisWeek} This Week</span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={e => onSearchChange(e.target.value)} placeholder="Search..." className="w-56 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
        <select value={stageFilter} onChange={e => onStageFilterChange(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All stages</option>
          {OPS_STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select value={crewFilter} onChange={e => onCrewFilterChange(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All crews</option>
          {crewOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={styleFilter} onChange={e => onStyleFilterChange(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All styles</option>
          {styleOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={sortMode} onChange={e => onSortChange(e.target.value as SortMode)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="scheduled">Sort: Scheduled</option>
          <option value="value">Sort: Value</option>
          <option value="name">Sort: Customer</option>
          <option value="days_in_stage">Sort: Days in stage</option>
        </select>
        <label className="flex items-center gap-1 text-xs px-2 py-1.5 border border-gray-200 rounded-lg cursor-pointer">
          <input type="checkbox" checked={highlightToday} onChange={e => onHighlightTodayChange(e.target.checked)} />Today
        </label>
        <label className="flex items-center gap-1 text-xs px-2 py-1.5 border border-gray-200 rounded-lg cursor-pointer">
          <input type="checkbox" checked={showCompleted} onChange={e => onShowCompletedChange(e.target.checked)} />Completed
        </label>
        <ViewToggle value={view} onChange={onViewChange} />
        <button onClick={onToggleAnalytics} className="text-xs text-gray-500 hover:text-orange-600 px-2 py-1.5 border border-gray-200 rounded-lg">{analyticsOpen ? '▴ Hide' : '▾ Analytics'}</button>
        <button onClick={onPrimary} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg">{primaryLabel}</button>
      </div>
    </div>
  )
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5">
      {(['board', 'list'] as const).map(v => (
        <button key={v} onClick={() => onChange(v)} className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition ${value === v ? 'bg-white text-gray-900 shadow' : 'text-gray-500'}`}>{v}</button>
      ))}
    </div>
  )
}

function StagePills({ stages, onJump }: { stages: string[]; onJump: (s: string) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
      {stages.map(s => (
        <button key={s} onClick={() => onJump(s)} className="shrink-0 px-3 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700 hover:bg-orange-100 hover:text-orange-700 transition">{s}</button>
      ))}
    </div>
  )
}

function AnalyticsStrip({ metrics }: { metrics: Array<{ label: string; value: string; highlight?: 'orange' }> }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3">
      {metrics.map(m => (
        <div key={m.label} className={`bg-white rounded-xl border ${m.highlight === 'orange' ? 'border-orange-300' : 'border-gray-200'} px-3 py-2`}>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide truncate">{m.label}</p>
          <p className={`text-base font-bold mt-0.5 ${m.highlight === 'orange' ? 'text-orange-600' : 'text-gray-900'}`}>{m.value}</p>
        </div>
      ))}
    </div>
  )
}

function OpsListView({
  jobs, stages, onRowClick, bulkSelected, onBulkChange, onBulkMove, onExportSelected, onAdvance, highlightToday,
}: {
  jobs: UnifiedJob[]
  stages: typeof OPS_STAGES
  onRowClick: (j: UnifiedJob) => void
  bulkSelected: Set<string>
  onBulkChange: (s: Set<string>) => void
  onBulkMove: (toStage: string) => void
  onExportSelected: () => void
  onAdvance: (j: UnifiedJob) => void
  highlightToday: boolean
}) {
  const [sortCol, setSortCol] = useState<'name' | 'stage' | 'value' | 'date' | 'days' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  function setSort(col: typeof sortCol) {
    if (col === sortCol) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('asc') }
  }
  const rows = useMemo(() => {
    const out = [...jobs]
    if (!sortCol) return out
    out.sort((a, b) => {
      let av: string | number = '', bv: string | number = ''
      switch (sortCol) {
        case 'name':  av = a.customerName.toLowerCase(); bv = b.customerName.toLowerCase(); break
        case 'stage': av = a.opsStageLabel; bv = b.opsStageLabel; break
        case 'value': av = a.contractValue; bv = b.contractValue; break
        case 'date':  av = a.scheduledDate || 'zzz'; bv = b.scheduledDate || 'zzz'; break
        case 'days':  av = daysSince(a.rawJob?.updatedAt || ''); bv = daysSince(b.rawJob?.updatedAt || ''); break
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return out
  }, [jobs, sortCol, sortDir])

  const allChecked = rows.length > 0 && rows.every(r => bulkSelected.has(r.id))

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto md:overflow-visible">
        <table className="w-full text-sm hidden md:table">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
            <tr>
              <th className="text-left px-3 py-2 w-8">
                <input type="checkbox" checked={allChecked}
                  onChange={e => onBulkChange(new Set(e.target.checked ? rows.map(r => r.id) : []))} />
              </th>
              <Th label="Customer" onClick={() => setSort('name')} active={sortCol === 'name'} dir={sortDir} />
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Address</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Style</th>
              <Th label="Stage" onClick={() => setSort('stage')} active={sortCol === 'stage'} dir={sortDir} />
              <Th label="Scheduled" onClick={() => setSort('date')} active={sortCol === 'date'} dir={sortDir} />
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Crew</th>
              <Th label="Value" onClick={() => setSort('value')} active={sortCol === 'value'} dir={sortDir} align="right" />
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Progress</th>
              <Th label="Days" onClick={() => setSort('days')} active={sortCol === 'days'} dir={sortDir} />
              <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(j => {
              const stageInfo = stages.find(s => s.key === j.opsStage)
              const hex = stageInfo ? (stageColorHex[stageInfo.color] || '#9ca3af') : '#9ca3af'
              const today = highlightToday && isToday(j.scheduledDate)
              return (
                <tr key={j.id} onClick={() => onRowClick(j)} className={`hover:bg-gray-50 cursor-pointer ${today ? 'bg-orange-50/40' : ''}`}>
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={bulkSelected.has(j.id)}
                      onChange={e => {
                        const next = new Set(bulkSelected)
                        if (e.target.checked) next.add(j.id); else next.delete(j.id)
                        onBulkChange(next)
                      }} />
                  </td>
                  <td className="px-3 py-2"><p className="font-medium text-gray-900">{j.customerName}</p></td>
                  <td className="px-3 py-2 text-xs text-gray-500 truncate max-w-[200px]">{j.address || '—'}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{j.fenceType || '—'}</td>
                  <td className="px-3 py-2"><span className="text-[10px] text-white px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: hex }}>{j.opsStageLabel}</span></td>
                  <td className="px-3 py-2 text-xs">{j.scheduledDate ? <span className="text-gray-700">{j.scheduledDate}</span> : <span className="text-orange-600 font-semibold">Unscheduled</span>}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{j.crewAssigned || '—'}</td>
                  <td className="px-3 py-2 text-right font-bold text-gray-900 text-xs">{fmtUSD(j.contractValue)}</td>
                  <td className="px-3 py-2"><MiniProgress jobId={j.id} colorHex={hex} /></td>
                  <td className="px-3 py-2 text-xs text-gray-500">{daysSince(j.rawJob?.updatedAt || '')}d</td>
                  <td className="px-3 py-2 text-right">
                    {j.source === 'job' && j.opsStage !== 'paid' && (
                      <button onClick={e => { e.stopPropagation(); onAdvance(j) }}
                        className="text-xs text-orange-600 font-semibold hover:underline">Advance →</button>
                    )}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={11} className="px-6 py-12 text-center text-gray-400">No jobs match your filters</td></tr>
            )}
          </tbody>
        </table>

        {/* Mobile stacked card list */}
        <div className="md:hidden divide-y divide-gray-100">
          {rows.map(j => {
            const stageInfo = stages.find(s => s.key === j.opsStage)
            const hex = stageInfo ? (stageColorHex[stageInfo.color] || '#9ca3af') : '#9ca3af'
            return (
              <button key={j.id} onClick={() => onRowClick(j)} className="w-full text-left px-3 py-3 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <p className="font-semibold text-sm text-gray-900">{j.customerName}</p>
                  <p className="text-sm font-bold text-emerald-600">{fmtUSD(j.contractValue)}</p>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-white px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: hex }}>{j.opsStageLabel}</span>
                  <span className="text-[10px] text-gray-500">{j.scheduledDate || 'Unscheduled'}</span>
                </div>
              </button>
            )
          })}
          {rows.length === 0 && <div className="px-6 py-12 text-center text-gray-400 text-sm">No jobs match your filters</div>}
        </div>
      </div>

      {bulkSelected.size > 0 && (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-600 font-semibold">{bulkSelected.size} selected</span>
          <div className="flex items-center gap-2">
            <select onChange={e => { if (e.target.value) onBulkMove(e.target.value) }}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs" defaultValue="">
              <option value="">Move to stage…</option>
              {stages.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            <button onClick={onExportSelected} className="text-xs px-3 py-1 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Export CSV</button>
          </div>
        </div>
      )}
    </div>
  )
}

function MiniProgress({ jobId, colorHex }: { jobId: string; colorHex: string }) {
  const [p, setP] = useState<{ total: number; complete: number }>({ total: 0, complete: 0 })
  useEffect(() => {
    setP(getChecklistProgress(jobId))
    const reload = () => setP(getChecklistProgress(jobId))
    window.addEventListener('fencepro:checklist:updated', reload)
    return () => window.removeEventListener('fencepro:checklist:updated', reload)
  }, [jobId])
  if (p.total === 0) return <span className="text-xs text-gray-400">—</span>
  const pct = (p.complete / p.total) * 100
  return (
    <div className="w-24">
      <div className="w-full bg-gray-100 rounded-full h-1.5">
        <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: colorHex }} />
      </div>
      <p className="text-[10px] text-gray-500 mt-0.5">{p.complete}/{p.total}</p>
    </div>
  )
}

function Th({ label, onClick, active, dir, align }: { label: string; onClick: () => void; active: boolean; dir: 'asc' | 'desc'; align?: 'right' }) {
  return (
    <th className={`px-3 py-2 text-xs font-semibold text-gray-500 uppercase ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={onClick} className={`hover:text-gray-700 ${active ? 'text-orange-600' : ''}`}>{label} {active && (dir === 'asc' ? '↑' : '↓')}</button>
    </th>
  )
}

function ConfirmModal({ title, body, confirmLabel, onConfirm, onCancel }: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 modal-responsive">
        <h3 className="text-base font-bold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600 mt-1.5">{body}</p>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
          <button onClick={onConfirm} className="px-3 py-1.5 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 font-semibold">{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}

/* ─────────── swipe hook (duplicated locally to avoid extra exports) ─────────── */
type SwipeOpts = { onLeft?: () => void; onRight?: () => void }
function useSwipe(enabled: boolean, opts: SwipeOpts) {
  const [dx, setDx] = useState(0)
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)
  const horizontal = useRef<boolean | null>(null)
  function reset() { setDx(0); startX.current = null; startY.current = null; horizontal.current = null }
  return {
    dx,
    onPointerDown: (e: React.PointerEvent) => {
      if (!enabled) return
      startX.current = e.clientX
      startY.current = e.clientY
      horizontal.current = null
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (!enabled || startX.current === null || startY.current === null) return
      const dxNow = e.clientX - startX.current
      const dyNow = e.clientY - startY.current
      if (horizontal.current === null) {
        if (Math.abs(dxNow) < 8 && Math.abs(dyNow) < 8) return
        horizontal.current = Math.abs(dxNow) > Math.abs(dyNow)
      }
      if (!horizontal.current) return
      setDx(Math.max(-160, Math.min(160, dxNow)))
    },
    onPointerUp: () => {
      if (!enabled) return
      const threshold = 90
      if (dx > threshold) opts.onRight?.()
      else if (dx < -threshold) opts.onLeft?.()
      reset()
    },
    onPointerCancel: reset,
  }
}
