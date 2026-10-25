/**
 * OperationsBoard — the Operations / Jobs board.
 *
 *   - Board view: one column per ops stage, left to right (see KanbanBoard),
 *     plus a permanent "Unscheduled" column; drag by mouse or long press
 *   - Stage pills on a phone to jump to a column, bottom-sheet slide-over + FAB
 *   - Today highlight (pulsing orange ring on cards scheduled today)
 *   - Show Completed toggle (auto-archives completed > 48h)
 *   - List view with sortable columns + bulk actions + CSV export
 *   - Collapsible analytics strip
 *   - Optimistic moves with snap-back on error
 *
 * Reuses the data-layer + DetailPanel from OperationsPage so all existing
 * automation triggers, job-completion cascade, and checklist integration work
 * unchanged.
 */

import { can, isCrewLogin } from './permissions'
import { stageName as pipelineStageName, roleId as pipelineRoleId } from './pipelineStagesStore'
import { styleLabel } from './fenceCatalog'
import { loadSchedule, crewName } from './scheduleStore'
import { useEffect, useMemo, useState } from 'react'
import {
  type UnifiedJob,
  buildUnifiedList, DetailPanel, fenceText,
} from './OperationsPage'
import { type Job, type JobStatus, updateJob, advanceJob, holdJob, unholdJob } from './jobStore'
import {
  useOpsStages, OPS_STAGES_UPDATED_EVENT, stageInfo, stagePhase, nextOpsStage, advanceStage, stageFields, getCompleteOpsStage, type OpsStageDef,
} from './opsStagesStore'
import { boardStages, sideStages, sortedStages, pickableStages, isDonePhase } from './opsStageModel'
import { fireOpsStageChange } from './automationTrigger'
import { onJobCompleted } from './jobCompleteFlow'
import { useMilestoneSummary } from './jobTruthApi'
import { toast } from './toast'
import KanbanBoard, { type KanbanColumn } from './KanbanBoard'
import PopMenu, { PopItem } from './PopMenu'
import { Search, SlidersHorizontal } from 'lucide-react'
import { useBackLayer, useScreenMemory, useNav, takeOpenedParam, replaceUrl } from './nav'
import { refreshNow } from './liveRefresh'
import { businessDate } from './businessDate'
import { readPref, writePref } from './browserStorage'

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const TODAY = () => businessDate(new Date())

/** Done (completed, invoiced or paid) by the status its stage stands for. */
const isDoneStage = (id: string) => isDonePhase(stagePhase(id))

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

const COLLAPSE_KEY      = 'fencepro_ops_collapsed_columns' as const
const VIEW_KEY          = 'fencepro_ops_view' as const
const SORT_KEY          = 'fencepro_ops_sort' as const
const ANALYTICS_KEY     = 'fencepro_ops_analytics_open' as const
const SHOW_COMPLETED_KEY= 'fencepro_ops_show_completed' as const
const TODAY_HIGHLIGHT_KEY = 'fencepro_ops_highlight_today' as const

type SortMode = 'scheduled' | 'value' | 'name' | 'days_in_stage'
type ViewMode = 'board' | 'list'

const UNSCHEDULED_KEY = '__unscheduled__'

/** A crew's name (Schedule > Settings), never its id. */
const crewLabel = crewName

/** "Thu, Dec 3" or "Thu, Dec 3 to Mon, Dec 7". */
function cardDays(start: string, end?: string | null): string {
  const one = (d: string) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : d }
  return end && end > start ? `${one(start)} to ${one(end)}` : one(start)
}

export default function OperationsBoard() {
  const [jobs, setJobs] = useState<UnifiedJob[]>(() => buildUnifiedList())
  // The stages (Settings > Operations Stages): columns, order, names and colors. A change shows at once.
  const stages = useOpsStages()
  // Opened: read the newest copy (a job sold online, a card moved by the server).
  useEffect(() => { void refreshNow() }, [])
  const [view, setView] = useState<ViewMode>(() => (readPref(VIEW_KEY) as ViewMode) || 'board')
  const [sortMode, setSortMode] = useState<SortMode>(() => (readPref(SORT_KEY) as SortMode) || 'scheduled')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(readPref(COLLAPSE_KEY) || '{}') } catch { return {} }
  })
  const [analyticsOpen, setAnalyticsOpen] = useState<boolean>(() => readPref(ANALYTICS_KEY) === '1')
  const [highlightToday, setHighlightToday] = useState<boolean>(() => readPref(TODAY_HIGHLIGHT_KEY) !== '0')
  const [showCompleted, setShowCompleted] = useState<boolean>(() => readPref(SHOW_COMPLETED_KEY) === '1')

  // Filters come back when Back returns to the board.
  type Memory = { search: string; crewFilter: string; stageFilter: string; styleFilter: string }
  const remembered = useScreenMemory<Memory>('operations', (): Memory => ({ search, crewFilter, stageFilter, styleFilter }))
  // A link can open the board searched (?q=, e.g. "not on GD Schedule" from the Finish setup card)
  // or showing just some jobs (?ids=a,b). Either shows every match, old finished jobs included, as a list.
  const linkParams = new URLSearchParams(window.location.search)
  const [search, setSearch] = useState<string>(() => linkParams.get('q') ?? remembered?.search ?? '')
  const [linkSearch, setLinkSearch] = useState<string | null>(() => linkParams.get('q'))
  const [onlyIds, setOnlyIds] = useState<string[] | null>(() => linkParams.get('ids')?.split(',').filter(Boolean) ?? null)
  const fromLink = onlyIds !== null || (linkSearch !== null && search === linkSearch)
  // The board leaves finished jobs with no date out of every lane, so a link's jobs show as a list.
  const shownView: ViewMode = fromLink ? 'list' : view
  function clearLink() { setOnlyIds(null); setLinkSearch(null); setSearch(''); replaceUrl(window.location.pathname) }
  const [crewFilter, setCrewFilter] = useState<string>(remembered?.crewFilter ?? '')
  const [stageFilter, setStageFilter] = useState<string>(remembered?.stageFilter ?? '')
  const [styleFilter, setStyleFilter] = useState<string>(remembered?.styleFilter ?? '')
  const [selected, setSelected] = useState<UnifiedJob | null>(null)
  // A job named in the address (?job=<id>) opens: a reload, a link, or Back onto it.
  const nav = useNav()
  useEffect(() => {
    const id = nav.params.get('job') ?? takeOpenedParam('job')
    if (!id || selected?.id === id) return
    const j = jobs.find(x => x.id === id)
    if (j) setSelected(j)
  }, [nav])  // eslint-disable-line react-hooks/exhaustive-deps
  const [confirmComplete, setConfirmComplete] = useState<UnifiedJob | null>(null)
  const milestoneCounts = useMilestoneSummary()
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [isMobile, setIsMobile] = useState(isMobileViewport)

  /* ── viewport ── */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const h = () => setIsMobile(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  /* ── persist ── */
  useEffect(() => { writePref(VIEW_KEY, view) }, [view])
  useEffect(() => { writePref(SORT_KEY, sortMode) }, [sortMode])
  useEffect(() => { writePref(COLLAPSE_KEY, JSON.stringify(collapsed)) }, [collapsed])
  useEffect(() => { writePref(ANALYTICS_KEY, analyticsOpen ? '1' : '0') }, [analyticsOpen])
  useEffect(() => { writePref(SHOW_COMPLETED_KEY, showCompleted ? '1' : '0') }, [showCompleted])
  useEffect(() => { writePref(TODAY_HIGHLIGHT_KEY, highlightToday ? '1' : '0') }, [highlightToday])

  /* ── refresh on external updates ── */
  function refresh() { setJobs(buildUnifiedList()) }
  // Jobs and quotes change underneath: another device, a customer accepting online, a save confirmed.
  useEffect(() => {
    const h = () => refresh()
    window.addEventListener('fencepro:jobs:updated', h)
    window.addEventListener('fencepro:quotes:updated', h)
    window.addEventListener(OPS_STAGES_UPDATED_EVENT, h)
    return () => { window.removeEventListener('fencepro:jobs:updated', h); window.removeEventListener('fencepro:quotes:updated', h); window.removeEventListener(OPS_STAGES_UPDATED_EVENT, h) }
  }, [])
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

  // The open job as the list has it now (null once it leaves the list: archived, deleted).
  const selectedNow = selected ? (jobs.find(j => j.id === selected.id) ?? selected) : null

  /* ── filter ── */
  const filtered = useMemo(() => {
    return jobs.filter(j => {
      if (onlyIds && !onlyIds.includes(j.id)) return false
      if (!showCompleted && !fromLink) {
        // archive: hide completed/paid/invoiced jobs older than 48h
        const arch = isDoneStage(j.opsStage)
          && j.rawJob && daysSince(j.rawJob.completedDate || j.rawJob.updatedAt) > 2
        if (arch) return false
      }
      if (stageFilter && j.opsStage !== stageFilter) return false
      if (crewFilter && crewLabel(j.crewAssigned) !== crewFilter) return false
      if (styleFilter && j.fenceType !== styleFilter) return false
      if (!search) return true
      const q = search.toLowerCase()
      return (
        j.customerName.toLowerCase().includes(q) ||
        (j.address || '').toLowerCase().includes(q) ||
        (j.crewAssigned || '').toLowerCase().includes(q) ||
        (j.fenceType || '').toLowerCase().includes(q) ||
        (j.notes || '').toLowerCase().includes(q)
      )
    })
  }, [jobs, search, stageFilter, crewFilter, styleFilter, showCompleted, onlyIds, fromLink])

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
  /** Columns are sorted, so a dropped card goes where the sort puts it; null when the drop changes nothing. */
  function landingIndex(j: UnifiedJob, laneKey: string): number | null {
    if (j.opsStage === laneKey) return null
    const others = laneJobs(laneKey).filter(x => x.id !== j.id)
    const moved = { ...j, opsStage: laneKey }
    return sortJobs([...others, moved]).indexOf(moved)
  }

  function onCardDrop(j: UnifiedJob, stageKey: string) {
    if (j.opsStage === stageKey) return
    if (stageInfo(stageKey)?.isComplete) { setConfirmComplete(j); return }
    moveJobToStage(j, stageKey)
  }

  function moveJobToStage(j: UnifiedJob, targetStage: string) {
    if (j.source !== 'job' || !j.rawJob) return
    const target = stageInfo(targetStage)
    const updates = stageFields(targetStage, j.rawJob, TODAY()) as Partial<Job> | null
    if (!target || !updates) return
    // optimistic local update
    setJobs(prev => prev.map(x => x.id === j.id ? { ...x, opsStage: targetStage, opsStageLabel: target.name } : x))
    const wasDone = isDoneStage(j.opsStage)

    try {
      updateJob(j.id, updates)
      fireOpsStageChange(j.id, j.opsStage, targetStage, {
        jobName: j.customerName, jobAddress: j.address, fenceType: j.fenceType,
        crewAssigned: j.crewAssigned, customerName: j.customerName,
      })
      if (!wasDone && isDoneStage(targetStage)) {
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
    const done = getCompleteOpsStage()
    if (!done) return
    moveJobToStage(j, done.id)
    toast.success('Job marked complete', `${j.customerName} moved to ${done.name}; their pipeline card moves to ${pipelineStageName(pipelineRoleId('complete'))}`)
  }

  function onAdvance(j: UnifiedJob) {
    if (j.source !== 'job' || !j.rawJob) return
    const fromStatus = j.rawJob.status
    const result = advanceJob(j.id)
    if (result && !isDoneStage(j.opsStage) && isDonePhase(result.status)) {
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
    const active = jobs.filter(j => !isDoneStage(j.opsStage) && stagePhase(j.opsStage) !== 'on_hold')
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
  }, [jobs, stages])

  /* ── crew/style options ── */
  const crewOptions = useMemo(() => {
    const set = new Set<string>()
    // One entry per crew: "crew1" (an id) and "Crew 1" (its name) are the same crew.
    jobs.forEach(j => j.crewAssigned && set.add(crewLabel(j.crewAssigned)))
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
      (j.crewAssigned || '').toLowerCase().includes(q) ||
      (j.notes || '').toLowerCase().includes(q)
    ).map(j => j.id))
  }, [jobs, search])

  /* ── grouping ── */
  // The lane order: Unscheduled first, then the board stages in their Settings order, then the side
  // lanes. A hidden stage gets a lane only while a job is still in it, so no job drops off the board.
  type LaneSpec = { key: string; label: string; color: string; muted?: boolean; isComplete?: boolean; hidden?: boolean }
  const laneOrder = useMemo<LaneSpec[]>(() => {
    const inUse = new Set(jobs.map(j => j.opsStage))
    const hiddenInUse = sortedStages(stages).filter(s => s.hidden && inUse.has(s.id))
    const lane = (s: OpsStageDef): LaneSpec => ({ key: s.id, label: s.hidden ? `${s.name} (hidden)` : s.name, color: s.color, isComplete: s.isComplete, hidden: s.hidden, muted: s.hidden })
    return [
      { key: UNSCHEDULED_KEY, label: 'Unscheduled', color: '#d1d5db', muted: true },
      ...boardStages(stages).map(lane),
      ...sideStages(stages).map(lane),
      ...hiddenInUse.map(lane),
    ]
  }, [stages, jobs])

  function laneJobs(laneKey: string): UnifiedJob[] {
    if (laneKey === UNSCHEDULED_KEY) {
      return sortJobs(filtered.filter(j => !j.scheduledDate && !isDoneStage(j.opsStage)))
    }
    // exclude unscheduled from the regular lanes (they're shown only in the Unscheduled lane); a finished job is in its
    // stage's lane with or without a date (Oct 25 2026: a job completed with no install date was in no column).
    return sortJobs(filtered.filter(j => j.opsStage === laneKey && (j.scheduledDate || isDoneStage(j.opsStage))))
  }

  const columns: KanbanColumn<UnifiedJob>[] = laneOrder.map(lane => {
    const items = laneJobs(lane.key)
    const crewCount = new Set(items.map(j => j.crewAssigned).filter(Boolean)).size
    const unscheduled = lane.key === UNSCHEDULED_KEY
    return {
      key: lane.key,
      label: lane.label,
      items,
      // The Installer sees no prices: no lane totals.
      total: unscheduled || !can('prices.view') ? 0 : items.reduce((s, j) => s + (j.contractValue || 0), 0),
      colorHex: lane.color,
      icon: lane.isComplete ? '✓' : undefined,
      muted: lane.muted,
      badge: !unscheduled && crewCount > 0
        ? <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">{crewCount} crew</span>
        : undefined,
      emptyLabel: 'No jobs in this stage',
      // A job leaves Unscheduled by getting a date, not by being dragged in or out of a stage.
      acceptsDrop: !unscheduled,
    }
  })

  return (
    <div className="flex flex-col h-full">
      <ControlsBar
        title="Operations"
        primaryLabel="+ New job"
        onPrimary={() => toast.info('New Job', 'Create a quote and mark it as Sold to add it to the operations board.')}
        view={shownView} onViewChange={v => { if (fromLink) clearLink(); setView(v) }}
        search={search} onSearchChange={setSearch}
        sortMode={sortMode} onSortChange={setSortMode}
        crewOptions={crewOptions} crewFilter={crewFilter} onCrewFilterChange={setCrewFilter}
        styleOptions={styleOptions} styleFilter={styleFilter} onStyleFilterChange={setStyleFilter}
        stageFilter={stageFilter} onStageFilterChange={setStageFilter}
        stageOptions={sortedStages(stages)}
        analyticsOpen={analyticsOpen} onToggleAnalytics={() => setAnalyticsOpen(o => !o)}
        showCompleted={showCompleted} onShowCompletedChange={setShowCompleted}
        highlightToday={highlightToday} onHighlightTodayChange={setHighlightToday}
        activeCount={analytics.activeCount}
        scheduledThisWeek={analytics.scheduledThisWeek}
        isMobile={isMobile}
      />

      {fromLink && (
        <div className="mx-4 md:mx-6 mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-sm text-orange-900" data-ops-link-filter>
          <span className="flex-1 min-w-[200px]" data-ops-link-count={filtered.length}>
            {onlyIds ? `Showing the ${filtered.length} job${filtered.length === 1 ? '' : 's'} from the Finish setup list` : `Showing ${filtered.length} job${filtered.length === 1 ? '' : 's'} matching "${search}", finished ones included`}.
          </span>
          <button type="button" className="btn btn-quiet btn-sm" onClick={clearLink} data-ops-show-all>Show all jobs</button>
        </div>
      )}

      {analyticsOpen && (
        <AnalyticsStrip metrics={[
          { label: 'Active Jobs',         value: String(analytics.activeCount) },
          { label: 'Scheduled This Week', value: String(analytics.scheduledThisWeek) },
          { label: 'Unscheduled',         value: String(analytics.unscheduledCount), highlight: analytics.unscheduledCount > 0 ? 'orange' : undefined },
          ...(can('prices.view') ? [{ label: 'Avg Job Value', value: fmtUSD(analytics.avgValue) }] : []),
          { label: 'On-Time Rate',        value: `${analytics.onTimeRate}%` },
          { label: 'Weather Alerts',      value: String(analytics.weatherAlerts), highlight: analytics.weatherAlerts > 0 ? 'orange' : undefined },
        ]} />
      )}

      {/* mobile stage pills */}
      {isMobile && shownView === 'board' && (
        <StagePills
          stages={laneOrder.map(s => s.label)}
          onJump={label => {
            const found = laneOrder.find(l => l.label === label)
            if (!found) return
            setCollapsed(prev => ({ ...prev, [found.key]: false }))
            // After the column has opened to full width.
            requestAnimationFrame(() => document.getElementById(`opslane-${slug(found.key)}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }))
          }}
        />
      )}

      {shownView === 'board' ? (
        <KanbanBoard
          columns={columns}
          getId={j => j.id}
          canDrag={j => j.source === 'job'}
          collapsed={collapsed}
          onToggle={key => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))}
          columnDomId={key => `opslane-${slug(key)}`}
          landingIndex={landingIndex}
          onDrop={onCardDrop}
          renderCard={j => (
            <OpsCard
              job={j}
              progress={milestoneCounts[j.id]}
              onClick={() => setSelected(j)}
              isMobile={isMobile}
              highlightToday={highlightToday}
              showStageBadge={!j.scheduledDate}
              faded={matchesSearch !== null && !matchesSearch.has(j.id)}
              onNextStage={() => {
                const next = advanceStage(j.opsStage)
                if (next) {
                  if (next.isComplete) setConfirmComplete(j)
                  else moveJobToStage(j, next.id)
                }
              }}
              onComplete={() => setConfirmComplete(j)}
              onRainDay={() => {
                if (window.confirm(`Flag ${j.customerName} as Rain Day / Hold?`)) {
                  if (j.rawJob) updateJob(j.id, { holdReason: 'Rain Day', status: 'on_hold' as JobStatus })
                  refresh()
                }
              }}
            />
          )}
        />
      ) : (
        <OpsListView
          jobs={sortJobs(filtered)}
          stages={pickableStages(stages)}
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
          className="fixed bottom-6 right-6 max-md:bottom-[calc(84px+env(safe-area-inset-bottom))] max-md:right-4 z-30 w-14 h-14 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-3xl font-light shadow-2xl flex items-center justify-center"
          aria-label="New Job"
        >+</button>
      )}

      {/* Detail panel: a full screen of its own on a phone (it has its own Close), a side panel on a wide screen.
          It shows the job as it is now (the list), not the copy from when it was opened: a stage picked in it
          (Complete too), a note typed, a save from another phone all show at once. */}
      {selectedNow && (
        <DetailPanel
          job={selectedNow}
          onClose={() => setSelected(null)}
          onAdvance={() => { onAdvance(selectedNow); setSelected(null) }}
          onHold={() => onHold(selectedNow)}
          onUnhold={() => onUnhold(selectedNow)}
          onMoveStage={(stage) => {
            // Complete by hand on a job never scheduled: asked first (it closes the job and moves its card).
            if (stageInfo(stage)?.isComplete && !selectedNow.scheduledDate && !window.confirm(`${selectedNow.customerName} has no install date. Mark it complete anyway? Its pipeline card moves to ${pipelineStageName(pipelineRoleId('complete'))}.`)) return
            moveJobToStage(selectedNow, stage); const st = stageInfo(stage); if (st) toast.success(`Moved to ${st.name}`, st.isComplete ? `${selectedNow.customerName}'s pipeline card moves to ${pipelineStageName(pipelineRoleId('complete'))}.` : undefined) }}
          onUpdate={(updates) => onUpdateJob(selectedNow, updates)}
        />
      )}

      {/* Complete confirmation */}
      {confirmComplete && (
        <ConfirmModal
          title="Mark this job as complete?"
          body={`This will move ${confirmComplete.customerName} to ${getCompleteOpsStage()?.name ?? 'Complete'} and move their card to ${pipelineStageName(pipelineRoleId('complete'))} in the Sales Pipeline.`}
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

function OpsCard({
  job, progress: shown, onClick, isMobile, highlightToday, showStageBadge, faded, onNextStage, onRainDay, onComplete,
}: {
  job: UnifiedJob
  /** The job's milestones from its records (portal lib/jobReadiness.ts), from one request for the board. */
  progress?: { complete: number; total: number }
  onClick: () => void
  isMobile: boolean
  highlightToday: boolean
  showStageBadge: boolean
  faded: boolean
  onNextStage: () => void
  onRainDay: () => void
  /** Asks first, like dropping the card on Complete. */
  onComplete: () => void
}) {
  const stage = stageInfo(job.opsStage)
  const hex = stage?.color ?? '#9ca3af'
  const progress = shown ?? { total: 0, complete: 0 }

  const pct = progress.total > 0 ? (progress.complete / progress.total) * 100 : 0
  const today = highlightToday && isToday(job.scheduledDate)
  const city = (job.address || '').split(',').slice(-2)[0]?.trim() || job.address || ''
  const isRain = (job.rawJob as Job & { isRainDay?: boolean })?.isRainDay
  const weatherAlert = withinNDays(job.scheduledDate, 7) && isRain

  return (
    <div
      onClick={onClick}
      className={`relative bg-white rounded-xl shadow-sm hover:shadow-md hover:bg-gray-50 transition-shadow cursor-pointer p-3 group select-none ${faded ? 'opacity-20' : ''} ${today ? 'ring-2 ring-inset ring-orange-400' : ''}`}
      style={{ borderLeft: `4px solid ${hex}` }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{job.customerName}</p>
        </div>
        {can('prices.view') && <p className="text-sm font-bold text-emerald-600 shrink-0">{fmtUSD(job.contractValue)}</p>}
      </div>
      <p className="text-xs text-gray-500 truncate">
        {city}{job.fenceType ? <> · <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded" data-ops-card-fence>{fenceText(job)}</span></> : null}
        {/* Two jobs for one customer are told apart by their footage. */}
        {job.rawJob?.totalFeet ? <> · {job.rawJob.totalFeet} ft</> : null}
      </p>

      <div className="flex items-center gap-1.5 mt-2 text-[11px]">
        <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold truncate">{job.crewAssigned ? `👷 ${crewLabel(job.crewAssigned)}` : 'No crew'}</span>
        {showStageBadge && stage && (
          <span className="px-2 py-0.5 rounded-full text-white font-semibold" style={{ backgroundColor: hex }} data-ops-stage-pill={stage.id}>{stage.name}</span>
        )}
      </div>

      <div className="flex items-center justify-between mt-2 text-[11px]">
        {/* A finished job says when it was installed, never its old (or still ahead) install dates. */}
        {isDoneStage(job.opsStage) ? (
          <span className="text-green-700 font-semibold" data-ops-card-installed={job.rawJob?.completedDate || ''}>✓ {job.rawJob?.completedDate ? `Installed ${cardDays(job.rawJob.completedDate)}` : 'Done'}</span>
        ) : job.scheduledDate ? (
          <span className="text-gray-500" data-ops-card-date={job.scheduledDate}>📅 {cardDays(job.scheduledDate, job.rawJob?.scheduledEndDate)}{today ? ' • Today' : ''}</span>
        ) : (
          <span className="text-amber-700 font-semibold">Unscheduled</span>
        )}
        {weatherAlert && <span title="Rain forecast" className="text-cyan-600">🌧</span>}
      </div>

      {progress.total > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
            <span>Milestones</span>
            <span data-ops-card-milestones={`${progress.complete}/${progress.total}`}>{progress.complete} of {progress.total}</span>
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
          <PopMenu name="card-actions" label="⋯" title="Job actions" width={192}
            triggerClassName="px-1 py-0.5 text-gray-400 hover:text-gray-700 text-sm rounded hover:bg-gray-100"
            triggerProps={{ 'aria-label': 'Card actions' }}>
            {close => <>
              <PopItem onClick={() => { close(); onClick() }}>View / Edit</PopItem>
              {advanceStage(job.opsStage) && <PopItem onClick={() => { close(); onNextStage() }}>Move to {advanceStage(job.opsStage)!.name}</PopItem>}
              {job.source === 'job' && !stage?.isComplete && <PopItem className="font-semibold !text-green-700" onClick={() => { close(); onComplete() }}>Mark complete</PopItem>}
              <PopItem danger onClick={() => { close(); onRainDay() }}>Flag Rain Day</PopItem>
            </>}
          </PopMenu>
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
  stageFilter, onStageFilterChange, stageOptions,
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
  stageOptions: OpsStageDef[]
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
  if (isMobile) {
    return (
      <div className="flex items-center justify-between gap-2 mb-3 relative">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{title}</p>
          <p className="text-xs text-gray-500 truncate">{activeCount} active · {scheduledThisWeek} this week</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setOpenSearch(o => !o)} className="btn btn-secondary btn-icon" aria-label="Search this board"><Search size={18} aria-hidden="true" /></button>
          <PopMenu name="filter" kind="dialog" title="Filter and sort" width={288} className="p-3 space-y-2" align="end"
            label={<SlidersHorizontal size={18} aria-hidden="true" />}
            triggerClassName="btn btn-secondary btn-icon" triggerProps={{ 'aria-label': 'Filter and sort' }}>
            <select value={stageFilter} onChange={e => onStageFilterChange(e.target.value)} aria-label="Stage filter" data-ops-stage-filter className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="">All stages</option>
              {stageOptions.map(s => <option key={s.id} value={s.id}>{s.name}{s.hidden ? ' (hidden)' : ''}</option>)}
            </select>
            <select value={crewFilter} onChange={e => onCrewFilterChange(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="">All crews</option>
              {crewOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={styleFilter} onChange={e => onStyleFilterChange(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="">All styles</option>
              {styleOptions.map(c => <option key={c} value={c}>{styleLabel(c)}</option>)}
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
          </PopMenu>
          <ViewToggle value={view} onChange={onViewChange} />
        </div>
        {openSearch && (
          <input autoFocus value={search} onChange={e => onSearchChange(e.target.value)}
            placeholder="Search jobs..." className="absolute left-0 right-0 top-full mt-2 z-30 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white shadow-lg" />
        )}
      </div>
    )
  }
  return (
    <div className="mb-3">
      <div className="page-header !mb-3">
        <div className="min-w-0">
          <h1>{title}</h1>
          <div className="facts"><span><b>{activeCount}</b> active jobs</span><span><b>{scheduledThisWeek}</b> scheduled this week</span></div>
        </div>
        <div className="actions">
          <ViewToggle value={view} onChange={onViewChange} />
          {!isCrewLogin() && <button onClick={onToggleAnalytics} className="btn btn-quiet">{analyticsOpen ? 'Hide numbers' : 'Show numbers'}</button>}
          {!isCrewLogin() && <button onClick={onPrimary} className="btn btn-primary">{primaryLabel}</button>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={e => onSearchChange(e.target.value)} placeholder="Search..." aria-label="Search jobs" className="w-64 border border-gray-300 rounded-lg h-9 px-2.5 text-sm bg-white" />
        <select value={stageFilter} onChange={e => onStageFilterChange(e.target.value)} aria-label="Stage filter" data-ops-stage-filter className="border border-gray-300 rounded-lg h-9 px-2.5 text-sm bg-white">
          <option value="">All stages</option>
          {stageOptions.map(s => <option key={s.id} value={s.id}>{s.name}{s.hidden ? ' (hidden)' : ''}</option>)}
        </select>
        <select value={crewFilter} onChange={e => onCrewFilterChange(e.target.value)} className="border border-gray-300 rounded-lg h-9 px-2.5 text-sm bg-white">
          <option value="">All crews</option>
          {crewOptions.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={styleFilter} onChange={e => onStyleFilterChange(e.target.value)} className="border border-gray-300 rounded-lg h-9 px-2.5 text-sm bg-white">
          <option value="">All styles</option>
          {styleOptions.map(c => <option key={c} value={c}>{styleLabel(c)}</option>)}
        </select>
        <select value={sortMode} onChange={e => onSortChange(e.target.value as SortMode)} className="border border-gray-300 rounded-lg h-9 px-2.5 text-sm bg-white">
          <option value="scheduled">Sort: Scheduled</option>
          {!isCrewLogin() && <option value="value">Sort: Value</option>}
          <option value="name">Sort: Customer</option>
          <option value="days_in_stage">Sort: Days in stage</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm h-9 px-2.5 border border-gray-300 rounded-lg cursor-pointer bg-white">
          <input type="checkbox" checked={highlightToday} onChange={e => onHighlightTodayChange(e.target.checked)} />Today
        </label>
        <label className="flex items-center gap-1.5 text-sm h-9 px-2.5 border border-gray-300 rounded-lg cursor-pointer bg-white">
          <input type="checkbox" checked={showCompleted} onChange={e => onShowCompletedChange(e.target.checked)} />Completed
        </label>
      </div>
    </div>
  )
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5">
      {(['board', 'list'] as const).map(v => (
        <button key={v} onClick={() => onChange(v)} className={`px-3 h-8 rounded-md text-sm font-semibold capitalize transition ${value === v ? 'bg-white text-gray-900 shadow' : 'text-gray-600 hover:text-gray-900'}`}>{v}</button>
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
          <p className="text-[10px] font-semibold text-gray-400 truncate">{m.label}</p>
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
  stages: OpsStageDef[]
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
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Address</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Style</th>
              <Th label="Stage" onClick={() => setSort('stage')} active={sortCol === 'stage'} dir={sortDir} />
              <Th label="Scheduled" onClick={() => setSort('date')} active={sortCol === 'date'} dir={sortDir} />
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Crew</th>
              <Th label="Value" onClick={() => setSort('value')} active={sortCol === 'value'} dir={sortDir} align="right" />
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Progress</th>
              <Th label="Days" onClick={() => setSort('days')} active={sortCol === 'days'} dir={sortDir} />
              <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(j => {
              const hex = stageInfo(j.opsStage)?.color ?? '#9ca3af'
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
                  <td className="px-3 py-2 text-xs text-gray-600">{fenceText(j) || '—'}</td>
                  <td className="px-3 py-2"><span className="text-[10px] text-white px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: hex }}>{j.opsStageLabel}</span></td>
                  <td className="px-3 py-2 text-xs">{j.scheduledDate ? <span className="text-gray-700">{j.scheduledDate}</span> : <span className="text-amber-700 font-semibold">Unscheduled</span>}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{crewLabel(j.crewAssigned) || '—'}</td>
                  <td className="px-3 py-2 text-right font-bold text-gray-900 text-xs">{fmtUSD(j.contractValue)}</td>
                  <td className="px-3 py-2"><MiniProgress jobId={j.id} colorHex={hex} /></td>
                  <td className="px-3 py-2 text-xs text-gray-500">{daysSince(j.rawJob?.updatedAt || '')}d</td>
                  <td className="px-3 py-2 text-right">
                    {j.source === 'job' && advanceStage(j.opsStage) && stagePhase(j.opsStage) !== 'on_hold' && (
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
            const hex = stageInfo(j.opsStage)?.color ?? '#9ca3af'
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
              {stages.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={onExportSelected} className="text-xs px-3 py-1 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Export CSV</button>
          </div>
        </div>
      )}
    </div>
  )
}

function MiniProgress({ jobId, colorHex }: { jobId: string; colorHex: string }) {
  // The job's milestones from its records (portal lib/jobReadiness.ts), one request for the whole list.
  const p = useMilestoneSummary()[jobId] ?? { total: 0, complete: 0 }
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
    <th className={`px-3 py-2 text-xs font-semibold text-gray-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={onClick} className={`hover:text-gray-700 ${active ? 'text-orange-600' : ''}`}>{label} {active && (dir === 'asc' ? '↑' : '↓')}</button>
    </th>
  )
}

function ConfirmModal({ title, body, confirmLabel, onConfirm, onCancel }: { title: string; body: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) {
  useBackLayer(onCancel, { key: 'confirm-modal' })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 modal-responsive">
        <h3 className="text-base font-bold text-gray-900">{title}</h3>
        <p className="text-sm text-gray-600 mt-1.5">{body}</p>
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onCancel} className="btn btn-secondary">Cancel</button>
          <button onClick={onConfirm} className="btn btn-primary">{confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
