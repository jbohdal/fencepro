/**
 * SalesPipelineBoard — vertical-swimlane redesign of the Sales Pipeline.
 *
 * Replaces the horizontal kanban (`JobsPage.tsx`) with:
 *   - Vertical swimlanes (one per stage, full-width, flex-wrap card grid inside)
 *   - Mobile accordion with stage pills + bottom-sheet slide-over + FAB
 *   - List view (sortable table with bulk select + CSV export)
 *   - Collapsible analytics strip
 *   - Optimistic drag-and-drop with snap-back on error
 *
 * Reuses the data-layer + LeadDrawer + QuickAddModal from JobsPage so all
 * existing automation triggers, signed-contract cascades, and persistence work
 * unchanged. The original JobsPage.tsx remains importable as a fallback.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  type PipelineLead,
  loadPipeline, savePipeline, LeadDrawer, QuickAddModal,
  STAGE_COLORS, PRE_SALE_STAGES, PRODUCTION_STAGES, CLOSING_STAGES, DEAD_STAGES,
} from './JobsPage'
import { fireSalesStageChange } from './automationTrigger'
import { applySignedContractTransition } from './signedContractFlow'
import { toast } from './toast'
import { getQuotes } from './quoteStore'
import { getJobs } from './jobStore'
import { getCustomerById } from './customerStore'
import { leadValue, pipelineMetrics } from './pipelineValue'
import { useMergedRefresh } from './useMergedRefresh'

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const TODAY = () => new Date().toISOString().slice(0, 10)

function relTime(iso?: string): string {
  if (!iso) return '—'
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return `${Math.max(1, m)}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  const mo = Math.floor(d / 30)
  return `${mo}mo ago`
}

function daysInStage(lead: PipelineLead): number {
  const since = lead.lastMoved || lead.createdAt
  if (!since) return 0
  const ms = Date.now() - new Date(since).getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

function ageBadgeClass(d: number): string {
  if (d >= 14) return 'bg-red-500 text-white'
  if (d >= 7)  return 'bg-orange-500 text-white'
  return 'bg-gray-100 text-gray-600'
}

function stageHexFromTailwind(stage: string): string {
  const cls = STAGE_COLORS[stage] || 'bg-gray-400'
  const map: Record<string, string> = {
    'bg-gray-500':   '#6b7280',
    'bg-gray-400':   '#9ca3af',
    'bg-blue-500':   '#3b82f6',
    'bg-indigo-500': '#6366f1',
    'bg-purple-500': '#a855f7',
    'bg-green-500':  '#22c55e',
    'bg-green-700':  '#15803d',
    'bg-teal-500':   '#14b8a6',
    'bg-cyan-500':   '#06b6d4',
    'bg-orange-500': '#f97316',
    'bg-emerald-500':'#10b981',
    'bg-yellow-500': '#eab308',
    'bg-red-500':    '#ef4444',
  }
  return map[cls] || '#9ca3af'
}

const COLLAPSE_KEY = 'fencepro_pipeline_collapsed_stages'
const VIEW_KEY = 'fencepro_pipeline_view'   // 'board' | 'list'
const SORT_KEY = 'fencepro_pipeline_sort'   // SortMode
const ANALYTICS_KEY = 'fencepro_pipeline_analytics_open'

type SortMode = 'newest' | 'oldest' | 'value_desc' | 'value_asc' | 'days_in_stage'
type ViewMode = 'board' | 'list'

const VIRTUAL_THRESHOLD = 20

function readCollapsed(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '{}') } catch { return {} }
}
function writeCollapsed(state: Record<string, boolean>) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state))
}

function isMobileViewport() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 767px)').matches
}

// Filters and scroll position of the board, kept only in memory so "Back to
// pipeline" on the customer page lands where the user left off.
let leftAt: { search: string; repFilter: string; styleFilter: string; scrollTop: number } | null = null
let returning = false

/** Call just before showing the pipeline again from "Back to pipeline". */
export function markPipelineReturn() { returning = true }

export default function SalesPipelineBoard({ onOpenCustomer }: { onOpenCustomer?: (customerId: string) => void } = {}) {
  const initial = loadPipeline()
  // Decided once per mount: a normal visit to the pipeline starts fresh.
  const [restore] = useState(() => { const r = returning ? leftAt : null; returning = false; return r })
  const [leads, setLeads] = useState<PipelineLead[]>(initial.leads)
  const [stages, setStages] = useState<string[]>(initial.stages)

  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) || 'board')
  const [sortMode, setSortMode] = useState<SortMode>(() => (localStorage.getItem(SORT_KEY) as SortMode) || 'newest')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed)
  const [analyticsOpen, setAnalyticsOpen] = useState<boolean>(() => localStorage.getItem(ANALYTICS_KEY) === '1')

  const [search, setSearch] = useState(restore?.search ?? '')
  const [repFilter, setRepFilter] = useState(restore?.repFilter ?? '')
  const [styleFilter, setStyleFilter] = useState(restore?.styleFilter ?? '')
  const [selected, setSelected] = useState<PipelineLead | null>(null)
  const [addingToStage, setAddingToStage] = useState<string | null>(null)
  const [confirmSold, setConfirmSold] = useState<{ lead: PipelineLead; fromStage: string } | null>(null)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [isMobile, setIsMobile] = useState(isMobileViewport)

  const dragId = useRef<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  // Whatever actually scrolls: the board's own lane area, or (list view, small
  // screens) the page around it.
  function scroller(): HTMLElement | null {
    const scrolls = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)
    const own = rootRef.current?.querySelector<HTMLElement>('[data-pipeline-scroll]')
    if (own && scrolls(own)) return own
    for (let el = rootRef.current?.parentElement ?? null; el; el = el.parentElement) if (scrolls(el)) return el
    return (document.scrollingElement as HTMLElement | null)
  }

  useLayoutEffect(() => {
    if (restore) { const el = scroller(); if (el) el.scrollTop = restore.scrollTop }
  }, [restore])

  /* ── card values come from quotes and jobs, so follow both ── */
  const [dataTick, setDataTick] = useState(0)
  useEffect(() => {
    const bump = () => setDataTick(t => t + 1)
    window.addEventListener('fencepro:quotes:updated', bump)
    window.addEventListener('fencepro:jobs:updated', bump)
    return () => {
      window.removeEventListener('fencepro:quotes:updated', bump)
      window.removeEventListener('fencepro:jobs:updated', bump)
    }
  }, [])
  const values = useMemo(() => {
    const quotes = getQuotes(), jobs = getJobs()
    return new Map(leads.map(l => [l.id, leadValue(l, quotes, jobs)]))
  }, [leads, dataTick])
  const valueOf = (l: PipelineLead) => values.get(l.id) ?? 0

  /** A card opens the full customer page; a lead with no customer record still gets the side panel. */
  function openLead(lead: PipelineLead) {
    if (onOpenCustomer && lead.customerId && getCustomerById(lead.customerId)) {
      leftAt = { search, repFilter, styleFilter, scrollTop: scroller()?.scrollTop ?? 0 }
      onOpenCustomer(lead.customerId)
    } else {
      setSelected(lead)
    }
  }

  /* ── viewport listener ── */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = () => setIsMobile(mq.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  /* ── persist controls ── */
  useEffect(() => { localStorage.setItem(VIEW_KEY, view) }, [view])
  useEffect(() => { localStorage.setItem(SORT_KEY, sortMode) }, [sortMode])
  useEffect(() => { writeCollapsed(collapsed) }, [collapsed])
  useEffect(() => { localStorage.setItem(ANALYTICS_KEY, analyticsOpen ? '1' : '0') }, [analyticsOpen])

  /* ── live reload from settings/pipeline events ── */
  useEffect(() => {
    const reload = () => {
      const next = loadPipeline()
      setLeads(next.leads)
      setStages(next.stages)
    }
    window.addEventListener('fencepro:settings:updated', reload)
    window.addEventListener('fencepro:pipeline:updated', reload)
    return () => {
      window.removeEventListener('fencepro:settings:updated', reload)
      window.removeEventListener('fencepro:pipeline:updated', reload)
    }
  }, [])

  // After a merge with another device the board is already reloaded by the
  // pipeline event above; say so, so the page is not remounted under the user.
  useMergedRefresh('Sales pipeline', () => {})

  /* ── persist helper ── */
  function persist(nextLeads: PipelineLead[], nextStages: string[] = stages) {
    savePipeline(nextLeads, nextStages)
    setLeads(nextLeads)
    setStages(nextStages)
  }

  /* ── filters / search ── */
  const filteredLeads = useMemo(() => {
    const q = search.trim().toLowerCase()
    return leads.filter(l => {
      if (repFilter && (l.assignedRep || '') !== repFilter) return false
      if (styleFilter && (l.fenceType || '') !== styleFilter) return false
      if (!q) return true
      return (
        `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
        (l.phone || '').includes(q) ||
        (l.address || '').toLowerCase().includes(q)
      )
    })
  }, [leads, search, repFilter, styleFilter])

  const matchesSearch = useMemo(() => {
    if (!search.trim()) return null
    const q = search.toLowerCase()
    return new Set(leads
      .filter(l => `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) || (l.phone || '').includes(q) || (l.address || '').toLowerCase().includes(q))
      .map(l => l.id))
  }, [leads, search])

  function sortLeads(arr: PipelineLead[]): PipelineLead[] {
    const out = [...arr]
    switch (sortMode) {
      case 'oldest':       out.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')); break
      case 'value_desc':   out.sort((a, b) => valueOf(b) - valueOf(a)); break
      case 'value_asc':    out.sort((a, b) => valueOf(a) - valueOf(b)); break
      case 'days_in_stage':out.sort((a, b) => daysInStage(b) - daysInStage(a)); break
      case 'newest':
      default:             out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    }
    return out
  }

  /* ── drag-and-drop (desktop) — optimistic ── */
  function onDragStart(e: React.DragEvent, id: string) {
    if (isMobile) { e.preventDefault(); return }
    dragId.current = id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', id)
  }
  function onStageDrop(e: React.DragEvent, stage: string) {
    e.preventDefault()
    const id = dragId.current || e.dataTransfer.getData('text/plain')
    dragId.current = null
    if (!id) return
    const lead = leads.find(l => l.id === id)
    if (!lead || lead.stage === stage) return

    if (stage === 'Signed Contract') {
      setConfirmSold({ lead, fromStage: lead.stage })
      return
    }
    moveLead(lead, stage)
  }

  function moveLead(lead: PipelineLead, toStage: string) {
    const fromStage = lead.stage
    const optimistic = leads.map(l => l.id === lead.id ? { ...l, stage: toStage, lastMoved: TODAY() } : l)
    persist(optimistic)
    try {
      fireSalesStageChange(lead.id, fromStage, toStage, {
        jobName: `${lead.firstName} ${lead.lastName}`.trim(),
        jobAddress: lead.address,
        customerName: `${lead.firstName} ${lead.lastName}`.trim(),
        customerEmail: lead.email,
        customerPhone: lead.phone,
        fenceType: lead.fenceType,
        quotePrice: lead.quotePrice,
      })
    } catch (err) {
      // Snap back on automation error
      persist(leads)
      toast.error('Move failed', (err as Error)?.message || 'Could not move lead')
    }
  }

  function confirmMoveToSold() {
    if (!confirmSold) return
    const { lead, fromStage } = confirmSold
    const optimistic = leads.map(l => l.id === lead.id ? { ...l, stage: 'Signed Contract', lastMoved: TODAY() } : l)
    persist(optimistic)
    setConfirmSold(null)
    try {
      const result = applySignedContractTransition({
        id: lead.id, customerId: lead.customerId,
        firstName: lead.firstName, lastName: lead.lastName,
        phone: lead.phone, email: lead.email, address: lead.address,
        stage: 'Signed Contract', fromStage,
      })
      if (result) {
        toast.success('Deal closed — job created', `${result.job.customerName} · quote marked SOLD · job on Operations board`)
      } else {
        toast.info('Moved to Signed Contract', 'No quote linked yet — create a quote and drop again to auto-generate a job.')
      }
      fireSalesStageChange(lead.id, fromStage, 'Signed Contract', {
        jobName: `${lead.firstName} ${lead.lastName}`.trim(),
        jobAddress: lead.address,
        customerName: `${lead.firstName} ${lead.lastName}`.trim(),
        customerEmail: lead.email, customerPhone: lead.phone,
        fenceType: lead.fenceType, quotePrice: lead.quotePrice,
      })
    } catch (err) {
      persist(leads)
      toast.error('Could not close deal', (err as Error)?.message || 'Unknown error')
    }
  }

  function handleAddLead(lead: PipelineLead) {
    persist([lead, ...leads])
    setAddingToStage(null)
  }

  function handleUpdate(updated: PipelineLead) {
    const prev = leads.find(l => l.id === updated.id)
    persist(leads.map(l => l.id === updated.id ? updated : l))
    if (selected?.id === updated.id) setSelected(updated)
    if (prev && prev.stage !== updated.stage) {
      try {
        fireSalesStageChange(updated.id, prev.stage, updated.stage, {
          jobName: `${updated.firstName} ${updated.lastName}`.trim(),
          jobAddress: updated.address,
          customerName: `${updated.firstName} ${updated.lastName}`.trim(),
          customerEmail: updated.email, customerPhone: updated.phone,
          fenceType: updated.fenceType, quotePrice: updated.quotePrice,
        })
        if ((updated.stage || '').toLowerCase() === 'signed contract') {
          const r = applySignedContractTransition({
            id: updated.id, customerId: updated.customerId,
            firstName: updated.firstName, lastName: updated.lastName,
            phone: updated.phone, email: updated.email, address: updated.address,
            stage: updated.stage, fromStage: prev.stage,
          })
          if (r) toast.success('Deal closed — job created', `${r.job.customerName} · job on Operations board`)
        }
      } catch { /* swallow — UI already updated */ }
    }
  }

  function handleDelete(id: string) {
    persist(leads.filter(l => l.id !== id))
    setSelected(null)
  }

  function toggleStage(stage: string) {
    setCollapsed(prev => ({ ...prev, [stage]: !prev[stage] }))
  }

  function nextStageOf(s: string): string | null {
    const i = stages.indexOf(s)
    if (i < 0 || i >= stages.length - 1) return null
    return stages[i + 1]
  }

  /* ── analytics ── */
  const analytics = useMemo(() => {
    const active = leads.filter(l => !DEAD_STAGES.has(l.stage) && l.stage !== 'Paid & Closed')
    // Money figures use the same per card values the cards show (see pipelineValue).
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
    const m = pipelineMetrics(leads, getQuotes(), getJobs(), since)
    const avgDays = active.length ? Math.round(active.reduce((s, l) => s + daysInStage(l), 0) / active.length) : 0
    const atRisk = active.filter(l => daysInStage(l) > 14).length
    return { totalValue: m.pipelineValue, weighted: m.weighted, avgDeal: m.avgDeal, avgDays, closeRate: m.closeRate, atRisk, sold: m.sold }
  }, [leads, dataTick])

  /* ── unique reps / fence styles for filter dropdowns ── */
  const repOptions = useMemo(() => {
    const set = new Set<string>()
    leads.forEach(l => l.assignedRep && set.add(l.assignedRep))
    return Array.from(set)
  }, [leads])
  const styleOptions = useMemo(() => {
    const set = new Set<string>()
    leads.forEach(l => l.fenceType && set.add(l.fenceType))
    return Array.from(set)
  }, [leads])

  /* ── csv export ── */
  function exportCSV(rows: PipelineLead[]) {
    const headers = ['First Name','Last Name','Phone','Email','Address','Stage','Fence Type','Quote Price','Job Value','Assigned Rep','Days In Stage','Created']
    const lines = [headers.join(',')]
    rows.forEach(l => {
      const cells = [
        l.firstName, l.lastName, l.phone, l.email, l.address, l.stage, l.fenceType,
        l.quotePrice, l.jobValue, l.assignedRep || '', daysInStage(l), l.createdAt,
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
    a.download = `pipeline-${TODAY()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ── render ── */
  return (
    <div ref={rootRef} className="flex flex-col h-full">
      <ControlsBar
        title="Sales Pipeline"
        totalLabel={`Pipeline: ${fmtUSD(analytics.totalValue)}`}
        secondaryLabel={`Sold: ${fmtUSD(analytics.sold)}`}
        countLabel={`${leads.length} total`}
        view={view} onViewChange={setView}
        search={search} onSearchChange={setSearch}
        sortMode={sortMode} onSortChange={setSortMode}
        repOptions={repOptions} repFilter={repFilter} onRepFilterChange={setRepFilter}
        styleOptions={styleOptions} styleFilter={styleFilter} onStyleFilterChange={setStyleFilter}
        primaryLabel="+ New Lead"
        onPrimary={() => setAddingToStage(stages[0])}
        analyticsOpen={analyticsOpen}
        onToggleAnalytics={() => setAnalyticsOpen(o => !o)}
        isMobile={isMobile}
      />

      {analyticsOpen && (
        <AnalyticsStrip metrics={[
          { label: 'Pipeline Value',     value: fmtUSD(analytics.totalValue) },
          { label: 'Weighted Pipeline',  value: fmtUSD(analytics.weighted) },
          { label: 'Avg Deal Size',      value: fmtUSD(analytics.avgDeal) },
          { label: 'Avg Days in Stage',  value: `${analytics.avgDays}d` },
          { label: 'Close Rate (90 days)', value: `${analytics.closeRate}%` },
          { label: 'At Risk (>14d)',     value: String(analytics.atRisk),  highlight: analytics.atRisk > 0 ? 'orange' : undefined },
        ]} />
      )}

      {/* mobile stage pills */}
      {isMobile && view === 'board' && (
        <StagePills stages={stages} onJump={s => {
          const el = document.getElementById(`stage-${slug(s)}`)
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          setCollapsed(prev => ({ ...prev, [s]: false }))
        }} />
      )}

      {view === 'board' ? (
        <div data-pipeline-scroll className="flex-1 overflow-y-auto pb-32 md:pb-4 space-y-3">
          {stages.map(stage => {
            const stageLeads = sortLeads(filteredLeads.filter(l => l.stage === stage))
            const allStageLeads = leads.filter(l => l.stage === stage)
            const total = allStageLeads.reduce((s, l) => s + valueOf(l), 0)
            const isOpen = !collapsed[stage] && (
              !isMobile || (allStageLeads.length > 0 && stageIsFirstOpenOnMobile(stages, leads, stage, collapsed))
            )
            return (
              <Swimlane
                key={stage}
                stage={stage}
                count={stageLeads.length}
                total={total}
                isOpen={isOpen || (!isMobile && !collapsed[stage])}
                onToggle={() => toggleStage(stage)}
                onDrop={e => onStageDrop(e, stage)}
                isSold={stage === 'Signed Contract'}
                isDead={DEAD_STAGES.has(stage)}
              >
                <CardGrid
                  leads={stageLeads}
                  valueOf={valueOf}
                  onCardClick={openLead}
                  onQuickView={setSelected}
                  onDragStart={onDragStart}
                  matchesSearch={matchesSearch}
                  isMobile={isMobile}
                  onSwipeRight={lead => {
                    const next = nextStageOf(lead.stage)
                    if (next) {
                      if (next === 'Signed Contract') setConfirmSold({ lead, fromStage: lead.stage })
                      else moveLead(lead, next)
                    }
                  }}
                  onSwipeLeft={lead => {
                    if (window.confirm(`Mark ${lead.firstName} ${lead.lastName} as Lost Sale?`)) {
                      moveLead(lead, 'Lost Sale')
                    }
                  }}
                />
              </Swimlane>
            )
          })}
        </div>
      ) : (
        <PipelineListView
          leads={sortLeads(filteredLeads)}
          stages={stages}
          valueOf={valueOf}
          onRowClick={openLead}
          bulkSelected={bulkSelected}
          onBulkChange={setBulkSelected}
          onBulkMove={(toStage) => {
            const ids = bulkSelected
            const next = leads.map(l => ids.has(l.id) ? { ...l, stage: toStage, lastMoved: TODAY() } : l)
            persist(next)
            setBulkSelected(new Set())
          }}
          onExportSelected={() => {
            const sel = bulkSelected.size ? leads.filter(l => bulkSelected.has(l.id)) : leads
            exportCSV(sel)
          }}
        />
      )}

      {/* Mobile FAB */}
      {isMobile && (
        <button
          onClick={() => setAddingToStage(stages[0])}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-3xl font-light shadow-2xl flex items-center justify-center"
          aria-label="New Lead"
        >+</button>
      )}

      {/* Slide-over / Bottom sheet */}
      {selected && (
        isMobile ? (
          <BottomSheet onClose={() => setSelected(null)}>
            <LeadDrawer
              lead={selected} stages={stages}
              onClose={() => setSelected(null)}
              onUpdate={handleUpdate} onDelete={handleDelete}
            />
          </BottomSheet>
        ) : (
          <LeadDrawer
            lead={selected} stages={stages}
            onClose={() => setSelected(null)}
            onUpdate={handleUpdate} onDelete={handleDelete}
          />
        )
      )}

      {/* Quick add */}
      {addingToStage && (
        <QuickAddModal
          stage={addingToStage}
          onAdd={handleAddLead}
          onClose={() => setAddingToStage(null)}
        />
      )}

      {/* Signed Contract confirmation */}
      {confirmSold && (
        <ConfirmModal
          title="Mark this deal as sold?"
          body={`This moves ${confirmSold.lead.firstName} ${confirmSold.lead.lastName} to Signed Contract and creates a job on the Operations board.`}
          confirmLabel="Confirm — Create Job"
          onConfirm={confirmMoveToSold}
          onCancel={() => setConfirmSold(null)}
        />
      )}
    </div>
  )
}

/* ─────────── Sub-components ─────────── */

function slug(s: string) { return s.replace(/[^a-z0-9]+/gi, '-').toLowerCase() }

function stageIsFirstOpenOnMobile(stages: string[], leads: PipelineLead[], stage: string, collapsed: Record<string, boolean>): boolean {
  // First non-empty stage opens by default unless explicitly collapsed
  for (const s of stages) {
    const has = leads.some(l => l.stage === s)
    if (has) return s === stage && !collapsed[s]
  }
  return false
}

function Swimlane({
  stage, count, total, isOpen, onToggle, onDrop, isSold, isDead, children,
}: {
  stage: string
  count: number
  total: number
  isOpen: boolean
  onToggle: () => void
  onDrop: (e: React.DragEvent) => void
  isSold?: boolean
  isDead?: boolean
  children: React.ReactNode
}) {
  const [isHot, setHot] = useState(false)
  const hex = stageHexFromTailwind(stage)
  const headerStyle: CSSProperties = isSold
    ? { borderLeftColor: '#22c55e', borderLeftWidth: '4px' }
    : { borderLeftColor: hex, borderLeftWidth: '4px' }

  return (
    <section id={`stage-${slug(stage)}`} className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <button
        onClick={onToggle}
        onDragOver={e => { e.preventDefault(); setHot(true) }}
        onDragLeave={() => setHot(false)}
        onDrop={e => { setHot(false); onDrop(e) }}
        style={headerStyle}
        className={`sticky top-0 z-10 w-full pl-4 pr-4 py-3 flex items-center justify-between gap-3 bg-white hover:bg-gray-50 transition-colors ${isHot ? 'ring-2 ring-orange-300 bg-orange-50' : ''}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          {isSold && <span className="text-base">🏆</span>}
          {isDead && <span className="text-base text-gray-400">✕</span>}
          <span className="text-sm font-bold text-gray-900 truncate">{stage}</span>
          <span className="ml-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-semibold">{count}</span>
          {total > 0 && <span className="hidden sm:inline text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold">{fmtUSD(total)}</span>}
        </div>
        <span className={`text-gray-400 text-xs transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
      </button>
      {isOpen && (
        <div
          onDragOver={e => { e.preventDefault(); setHot(true) }}
          onDragLeave={() => setHot(false)}
          onDrop={e => { setHot(false); onDrop(e) }}
          className={`px-3 py-3 ${isHot ? 'bg-orange-50/40' : 'bg-gray-50/40'}`}
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
  leads, valueOf, onCardClick, onQuickView, onDragStart, matchesSearch, isMobile, onSwipeRight, onSwipeLeft,
}: {
  leads: PipelineLead[]
  valueOf: (l: PipelineLead) => number
  onCardClick: (l: PipelineLead) => void
  onQuickView: (l: PipelineLead) => void
  onDragStart: (e: React.DragEvent, id: string) => void
  matchesSearch: Set<string> | null
  isMobile: boolean
  onSwipeRight: (l: PipelineLead) => void
  onSwipeLeft: (l: PipelineLead) => void
}) {
  if (leads.length === 0) {
    return <EmptyStageCard label="No deals in this stage" />
  }
  // Virtual rendering: only render first VIRTUAL_THRESHOLD; rest become a "show more" placeholder.
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? leads : leads.slice(0, VIRTUAL_THRESHOLD)
  const hidden = leads.length - visible.length
  return (
    <div>
      <div className={`grid gap-3 ${isMobile ? 'grid-cols-1' : 'grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
        {visible.map(l => (
          <PipelineCard
            key={l.id}
            lead={l}
            value={valueOf(l)}
            onClick={() => onCardClick(l)}
            onQuickView={() => onQuickView(l)}
            onDragStart={e => onDragStart(e, l.id)}
            faded={matchesSearch !== null && !matchesSearch.has(l.id)}
            isMobile={isMobile}
            onSwipeRight={() => onSwipeRight(l)}
            onSwipeLeft={() => onSwipeLeft(l)}
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

function EmptyStageCard({ label }: { label: string }) {
  return (
    <div className="border-2 border-dashed border-gray-200 rounded-xl px-4 py-6 flex items-center justify-center text-xs text-gray-400">
      <span className="mr-2 text-base">+</span>{label}
    </div>
  )
}

function PipelineCard({
  lead, value, onClick, onQuickView, onDragStart, faded, isMobile, onSwipeRight, onSwipeLeft,
}: {
  lead: PipelineLead
  /** From the customer's quotes; see pipelineValue. */
  value: number
  /** Opens the full customer page. */
  onClick: () => void
  /** Opens the small side panel. */
  onQuickView: () => void
  onDragStart: (e: React.DragEvent) => void
  faded: boolean
  isMobile: boolean
  onSwipeRight: () => void
  onSwipeLeft: () => void
}) {
  const days = daysInStage(lead)
  const hex = stageHexFromTailwind(lead.stage)
  const initials = `${(lead.firstName?.[0] || '').toUpperCase()}${(lead.lastName?.[0] || '').toUpperCase()}`
  const city = (lead.address || '').split(',').slice(-2)[0]?.trim() || lead.address || ''
  const [menuOpen, setMenuOpen] = useState(false)
  const swipe = useSwipe(isMobile, { onLeft: onSwipeLeft, onRight: onSwipeRight })

  return (
    <div
      draggable={!isMobile}
      onDragStart={onDragStart}
      onClick={onClick}
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      className={`relative bg-white rounded-xl shadow-sm hover:shadow-md hover:bg-gray-50 transition-all cursor-pointer p-3 group select-none ${faded ? 'opacity-20' : ''}`}
      style={{
        borderLeft: `4px solid ${hex}`,
        transform: swipe.dx ? `translateX(${swipe.dx}px)` : undefined,
        transition: swipe.dx ? undefined : 'transform 200ms ease-out',
      }}
    >
      {/* Swipe action backdrops */}
      {isMobile && swipe.dx > 30 && (
        <div className="absolute inset-y-0 left-0 -translate-x-full bg-green-500 text-white px-3 flex items-center text-xs font-semibold rounded-l-xl">→ Next Stage</div>
      )}
      {isMobile && swipe.dx < -30 && (
        <div className="absolute inset-y-0 right-0 translate-x-full bg-red-500 text-white px-3 flex items-center text-xs font-semibold rounded-r-xl">Mark Lost</div>
      )}

      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{lead.firstName} {lead.lastName}</p>
        </div>
        <p className="text-sm font-bold text-emerald-600 shrink-0">{fmtUSD(value)}</p>
      </div>
      <p className="text-xs text-gray-500 truncate">
        {city}{lead.fenceType ? <> · <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{lead.fenceType}</span></> : null}
      </p>
      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-500">
        <span className="inline-flex w-5 h-5 rounded-full bg-orange-100 text-orange-700 items-center justify-center text-[9px] font-bold">{initials || '·'}</span>
        <span className="truncate">{lead.assignedRep || '—'}</span>
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px]">
        <span className={`px-2 py-0.5 rounded-full font-semibold ${ageBadgeClass(days)}`}>{days}d in stage</span>
        <span className="flex items-center gap-1.5 text-gray-400">
          {relTime(lead.lastMoved || lead.createdAt)}
          <button
            onClick={e => { e.stopPropagation(); onQuickView() }}
            onPointerDown={e => e.stopPropagation()}
            className="px-1 rounded text-gray-400 hover:text-orange-600 hover:bg-orange-50"
            title="Quick view" aria-label="Quick view"
          >👁</button>
        </span>
      </div>

      {/* hover three-dot menu */}
      {!isMobile && (
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition">
          <button
            onClick={e => { e.stopPropagation(); setMenuOpen(o => !o) }}
            className="px-1 py-0.5 text-gray-400 hover:text-gray-700 text-sm rounded hover:bg-gray-100"
            aria-label="Card actions"
          >⋯</button>
          {menuOpen && (
            <div onClick={e => e.stopPropagation()} className="absolute right-0 mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg text-xs z-20">
              <button onClick={onClick} className="block w-full text-left px-3 py-2 hover:bg-gray-50">Open customer</button>
              <button onClick={onQuickView} className="block w-full text-left px-3 py-2 hover:bg-gray-50">Quick view</button>
              <button onClick={onSwipeRight} className="block w-full text-left px-3 py-2 hover:bg-gray-50">Move to Next Stage</button>
              <button onClick={onSwipeLeft} className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-red-600">Mark Lost</button>
            </div>
          )}
        </div>
      )}

      {(lead as PipelineLead & { unread?: boolean }).unread && (
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-blue-500" aria-label="Unread message" />
      )}
    </div>
  )
}

function ControlsBar({
  title, totalLabel, secondaryLabel, countLabel,
  view, onViewChange, search, onSearchChange,
  sortMode, onSortChange,
  repOptions, repFilter, onRepFilterChange,
  styleOptions, styleFilter, onStyleFilterChange,
  primaryLabel, onPrimary,
  analyticsOpen, onToggleAnalytics, isMobile,
}: {
  title: string
  totalLabel: string
  secondaryLabel?: string
  countLabel: string
  view: ViewMode
  onViewChange: (v: ViewMode) => void
  search: string
  onSearchChange: (s: string) => void
  sortMode: SortMode
  onSortChange: (s: SortMode) => void
  repOptions: string[]
  repFilter: string
  onRepFilterChange: (s: string) => void
  styleOptions: string[]
  styleFilter: string
  onStyleFilterChange: (s: string) => void
  primaryLabel: string
  onPrimary: () => void
  analyticsOpen: boolean
  onToggleAnalytics: () => void
  isMobile: boolean
}) {
  const [openSearch, setOpenSearch] = useState(false)
  const [openFilter, setOpenFilter] = useState(false)
  if (isMobile) {
    return (
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900 truncate">{title}</p>
          <p className="text-xs text-gray-500 truncate">{totalLabel} · {countLabel}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setOpenSearch(o => !o)} className="p-2 rounded-lg border border-gray-200 text-gray-500" aria-label="Search">🔍</button>
          <button onClick={() => setOpenFilter(o => !o)} className="p-2 rounded-lg border border-gray-200 text-gray-500" aria-label="Filter">⚙</button>
          <ViewToggle value={view} onChange={onViewChange} />
        </div>
        {openSearch && (
          <input autoFocus value={search} onChange={e => onSearchChange(e.target.value)}
            placeholder="Search..." className="absolute left-4 right-4 top-32 z-30 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white" />
        )}
        {openFilter && (
          <div className="absolute left-4 right-4 top-32 z-30 bg-white border border-gray-200 rounded-lg p-3 space-y-2 shadow-lg">
            <select value={repFilter} onChange={e => onRepFilterChange(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="">All reps</option>
              {repOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={styleFilter} onChange={e => onStyleFilterChange(e.target.value)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="">All styles</option>
              {styleOptions.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <select value={sortMode} onChange={e => onSortChange(e.target.value as SortMode)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              <option value="newest">Newest</option><option value="oldest">Oldest</option>
              <option value="value_desc">Value high→low</option><option value="value_asc">Value low→high</option>
              <option value="days_in_stage">Days in stage</option>
            </select>
            <button onClick={onToggleAnalytics} className="w-full text-left text-xs text-orange-600 hover:underline">{analyticsOpen ? 'Hide analytics' : 'Show analytics'}</button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-lg font-bold text-gray-900 truncate">{title}</h1>
        <span className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-700 font-semibold">{totalLabel}</span>
        {secondaryLabel && <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-semibold">{secondaryLabel}</span>}
        <span className="text-xs text-gray-400">{countLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <input value={search} onChange={e => onSearchChange(e.target.value)}
          placeholder="Search..." className="w-56 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400" />
        <select value={repFilter} onChange={e => onRepFilterChange(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All reps</option>
          {repOptions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={styleFilter} onChange={e => onStyleFilterChange(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="">All styles</option>
          {styleOptions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={sortMode} onChange={e => onSortChange(e.target.value as SortMode)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="value_desc">Value high→low</option>
          <option value="value_asc">Value low→high</option>
          <option value="days_in_stage">Days in stage</option>
        </select>
        <ViewToggle value={view} onChange={onViewChange} />
        <button onClick={onToggleAnalytics} className="text-xs text-gray-500 hover:text-orange-600 px-2 py-1.5 border border-gray-200 rounded-lg">
          {analyticsOpen ? '▴ Hide' : '▾ Analytics'}
        </button>
        <button onClick={onPrimary} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg">{primaryLabel}</button>
      </div>
    </div>
  )
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5">
      {(['board', 'list'] as const).map(v => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-3 py-1 rounded-md text-xs font-semibold capitalize transition ${value === v ? 'bg-white text-gray-900 shadow' : 'text-gray-500'}`}>
          {v}
        </button>
      ))}
    </div>
  )
}

function AnalyticsStrip({ metrics }: { metrics: Array<{ label: string; value: string; highlight?: 'orange' }> }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-3 transition-all">
      {metrics.map(m => (
        <div key={m.label} className={`bg-white rounded-xl border ${m.highlight === 'orange' ? 'border-orange-300' : 'border-gray-200'} px-3 py-2`}>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide truncate">{m.label}</p>
          <p className={`text-base font-bold mt-0.5 ${m.highlight === 'orange' ? 'text-orange-600' : 'text-gray-900'}`}>{m.value}</p>
        </div>
      ))}
    </div>
  )
}

function StagePills({ stages, onJump }: { stages: string[]; onJump: (s: string) => void }) {
  return (
    <div className="flex gap-1.5 overflow-x-auto pb-2 mb-2 -mx-1 px-1">
      {stages.map(s => (
        <button key={s} onClick={() => onJump(s)}
          className="shrink-0 px-3 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-700 hover:bg-orange-100 hover:text-orange-700 transition">
          {s}
        </button>
      ))}
    </div>
  )
}

function PipelineListView({
  leads, stages, valueOf, onRowClick, bulkSelected, onBulkChange, onBulkMove, onExportSelected,
}: {
  valueOf: (l: PipelineLead) => number
  leads: PipelineLead[]
  stages: string[]
  onRowClick: (l: PipelineLead) => void
  bulkSelected: Set<string>
  onBulkChange: (s: Set<string>) => void
  onBulkMove: (toStage: string) => void
  onExportSelected: () => void
}) {
  const [sortCol, setSortCol] = useState<'name' | 'stage' | 'value' | 'days' | 'lastMoved' | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  function setSort(col: typeof sortCol) {
    if (col === sortCol) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('asc') }
  }
  const rows = useMemo(() => {
    const out = [...leads]
    if (!sortCol) return out
    out.sort((a, b) => {
      let av: string | number = '', bv: string | number = ''
      switch (sortCol) {
        case 'name':       av = `${a.firstName} ${a.lastName}`.toLowerCase(); bv = `${b.firstName} ${b.lastName}`.toLowerCase(); break
        case 'stage':      av = a.stage; bv = b.stage; break
        case 'value':      av = valueOf(a); bv = valueOf(b); break
        case 'days':       av = daysInStage(a); bv = daysInStage(b); break
        case 'lastMoved':  av = a.lastMoved || ''; bv = b.lastMoved || ''; break
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
    return out
  }, [leads, sortCol, sortDir])

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
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Contact</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Style</th>
              <Th label="Stage" onClick={() => setSort('stage')} active={sortCol === 'stage'} dir={sortDir} />
              <Th label="Value" onClick={() => setSort('value')} active={sortCol === 'value'} dir={sortDir} align="right" />
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Rep</th>
              <Th label="Days" onClick={() => setSort('days')} active={sortCol === 'days'} dir={sortDir} />
              <Th label="Last Activity" onClick={() => setSort('lastMoved')} active={sortCol === 'lastMoved'} dir={sortDir} />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(l => {
              const days = daysInStage(l)
              return (
                <tr key={l.id} className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => onRowClick(l)}>
                  <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={bulkSelected.has(l.id)}
                      onChange={e => {
                        const next = new Set(bulkSelected)
                        if (e.target.checked) next.add(l.id); else next.delete(l.id)
                        onBulkChange(next)
                      }} />
                  </td>
                  <td className="px-3 py-2">
                    <p className="font-medium text-gray-900">{l.firstName} {l.lastName}</p>
                    <p className="text-xs text-gray-400">{(l.address || '').split(',').slice(-2)[0]?.trim() || l.address || '—'}</p>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <a href={`tel:${l.phone}`} className="text-blue-600 hover:underline">{l.phone || '—'}</a>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600">{l.fenceType || '—'}</td>
                  <td className="px-3 py-2">
                    <span className="text-[10px] text-white px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: stageHexFromTailwind(l.stage) }}>{l.stage}</span>
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-gray-900 text-xs">{fmtUSD(valueOf(l))}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{l.assignedRep || '—'}</td>
                  <td className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${ageBadgeClass(days)}`}>{days}d</span></td>
                  <td className="px-3 py-2 text-xs text-gray-500">{relTime(l.lastMoved || l.createdAt)}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-6 py-12 text-center text-gray-400">No leads match your filters</td></tr>
            )}
          </tbody>
        </table>

        {/* Mobile stacked card list */}
        <div className="md:hidden divide-y divide-gray-100">
          {rows.map(l => (
            <button key={l.id} onClick={() => onRowClick(l)} className="w-full text-left px-3 py-3 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <p className="font-semibold text-sm text-gray-900">{l.firstName} {l.lastName}</p>
                <p className="text-sm font-bold text-emerald-600">{fmtUSD(valueOf(l))}</p>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] text-white px-2 py-0.5 rounded-full font-semibold" style={{ backgroundColor: stageHexFromTailwind(l.stage) }}>{l.stage}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${ageBadgeClass(daysInStage(l))}`}>{daysInStage(l)}d</span>
              </div>
            </button>
          ))}
          {rows.length === 0 && <div className="px-6 py-12 text-center text-gray-400 text-sm">No leads match your filters</div>}
        </div>
      </div>

      {bulkSelected.size > 0 && (
        <div className="border-t border-gray-200 bg-gray-50 px-4 py-2 flex items-center justify-between gap-3">
          <span className="text-xs text-gray-600 font-semibold">{bulkSelected.size} selected</span>
          <div className="flex items-center gap-2">
            <select onChange={e => { if (e.target.value) onBulkMove(e.target.value) }}
              className="border border-gray-200 rounded-lg px-2 py-1 text-xs" defaultValue="">
              <option value="">Move to stage…</option>
              {stages.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={onExportSelected} className="text-xs px-3 py-1 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">Export CSV</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Th({ label, onClick, active, dir, align }: { label: string; onClick: () => void; active: boolean; dir: 'asc' | 'desc'; align?: 'right' }) {
  return (
    <th className={`px-3 py-2 text-xs font-semibold text-gray-500 uppercase ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={onClick} className={`hover:text-gray-700 ${active ? 'text-orange-600' : ''}`}>
        {label} {active && (dir === 'asc' ? '↑' : '↓')}
      </button>
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

/* ─────────── Mobile bottom sheet wrapper ─────────── */
export function BottomSheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div onClick={e => e.stopPropagation()} className="relative w-full bg-white rounded-t-2xl shadow-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-center pt-2 pb-1">
          <button onClick={onClose} aria-label="Close" className="w-10 h-1 bg-gray-300 rounded-full" />
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

/* ─────────── Swipe gesture hook ─────────── */
type SwipeOpts = { onLeft?: () => void; onRight?: () => void }
function useSwipe(enabled: boolean, opts: SwipeOpts) {
  const [dx, setDx] = useState(0)
  const startX = useRef<number | null>(null)
  const startY = useRef<number | null>(null)
  const horizontal = useRef<boolean | null>(null)
  function reset() {
    setDx(0); startX.current = null; startY.current = null; horizontal.current = null
  }
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
      // First decisive movement decides axis; if vertical, abandon swipe (preserves scroll)
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
