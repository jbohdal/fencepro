/**
 * SalesPipelineBoard — the Sales Pipeline.
 *
 *   - Board view: one column per stage, left to right (see KanbanBoard), with
 *     drag and drop between and within columns, mouse or long press
 *   - Stage pills on a phone to jump to a column, bottom-sheet slide-over + FAB
 *   - List view (sortable table with bulk select + CSV export)
 *   - Collapsible analytics strip
 *   - Optimistic moves with snap-back on error
 *
 * Reuses the data-layer + LeadDrawer + QuickAddModal from JobsPage so all
 * existing automation triggers, signed-contract cascades, and persistence work
 * unchanged. The original JobsPage.tsx remains importable as a fallback.
 */

import { styleLabel } from './fenceCatalog'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { formatPhone, telHref } from './phoneFormat'
import { leadValue, pipelineMetrics } from './pipelineValue'
import { useMergedRefresh } from './useMergedRefresh'
import KanbanBoard, { type KanbanColumn } from './KanbanBoard'
import { openBooking } from './BookingDialog'
import { CalendarPlus, CalendarDays, Eye, Search, SlidersHorizontal } from 'lucide-react'
import { moveCard } from './appointmentPipeline'
import { useAppointmentList } from './TodayScreen'
import { isOpen, needsOutcome, shortWhen, type Appointment } from './appointmentLogic'
import PipelineCardWindow, { type QuoteCustomer } from './PipelineCardWindow'
import QuoteDetailDrawer from './QuoteDetailDrawer'
import type { SavedQuote } from './QuotesPage'
import { navigate, useNav, useScreenMemory, takeOpenedParam, BackClose } from './nav'
import { refreshNow } from './liveRefresh'
import { businessDate } from './businessDate'

const fmtUSD = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const TODAY = () => businessDate(new Date())

function relTime(iso?: string): string {
  if (!iso) return '—'
  // A plain date (most cards): whole days, counted in Florida.
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const days = Math.round((Date.parse(businessDate(new Date())) - Date.parse(iso)) / 86_400_000)
    return days <= 0 ? 'today' : days < 30 ? `${days}d ago` : `${Math.floor(days / 30)}mo ago`
  }
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
  // Whole days in Florida (a plain date read as UTC was a day off every evening).
  const day = /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : businessDate(since)
  return Math.max(0, Math.round((Date.parse(businessDate(new Date())) - Date.parse(day)) / 86_400_000))
}

function ageBadgeClass(d: number): string {
  if (d >= 14) return 'bg-red-500 text-white'
  if (d >= 7)  return 'bg-amber-100 text-amber-900'
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

// Per device view preferences (not business data).
const COLLAPSE_KEY = 'fencepro_pipeline_collapsed_columns'
const VIEW_KEY = 'fencepro_pipeline_view'   // 'board' | 'list'
const SORT_KEY = 'fencepro_pipeline_sort_v2'   // SortMode
const ANALYTICS_KEY = 'fencepro_pipeline_analytics_open'

type SortMode = 'manual' | 'newest' | 'oldest' | 'value_desc' | 'value_asc' | 'days_in_stage'
type ViewMode = 'board' | 'list'

const SORT_LABELS: Record<SortMode, string> = {
  manual: 'Manual order', newest: 'Newest', oldest: 'Oldest',
  value_desc: 'Value high→low', value_asc: 'Value low→high', days_in_stage: 'Days in stage',
}
const SORT_MODES = Object.keys(SORT_LABELS) as SortMode[]

// Finished and dead stages start as narrow strips until this device says otherwise.
const COLLAPSED_BY_DEFAULT: Record<string, boolean> = { 'Paid & Closed': true, 'Lost Sale': true, 'No Answer': true }

function readCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY)
    return raw ? JSON.parse(raw) : { ...COLLAPSED_BY_DEFAULT }
  } catch { return { ...COLLAPSED_BY_DEFAULT } }
}

/** A card's hand placed position, which only counts in the stage it was placed in. */
function rankOf(l: PipelineLead): number | null {
  return l.boardOrder && l.boardOrder.stage === l.stage ? l.boardOrder.rank : null
}
/** Manual order: cards nobody has placed yet come first, newest on top, then the placed ones. */
function byManualOrder(a: PipelineLead, b: PipelineLead): number {
  const ra = rankOf(a), rb = rankOf(b)
  if (ra === null && rb === null) return (b.createdAt || '').localeCompare(a.createdAt || '')
  if (ra === null) return -1
  if (rb === null) return 1
  return ra - rb
}
function writeCollapsed(state: Record<string, boolean>) {
  localStorage.setItem(COLLAPSE_KEY, JSON.stringify(state))
}

function isMobileViewport() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(max-width: 767px)').matches
}

// What Back gives the board back: its filters and where it was scrolled to.
interface PipelineMemory { search: string; repFilter: string; styleFilter: string; boardLeft: number; columnTops: Record<string, number> }

export default function SalesPipelineBoard({ onNewQuote, onOpenQuote }: {
  /** A new quote, filled in with this customer. */
  onNewQuote?: (c: QuoteCustomer) => void
  /** Edit a quote in the quote builder. */
  onOpenQuote?: (q: SavedQuote) => void
} = {}) {
  const initial = loadPipeline()
  const restore = useScreenMemory<PipelineMemory>('pipeline', (): PipelineMemory => ({
    search, repFilter, styleFilter, boardLeft: boardEl()?.scrollLeft ?? 0,
    columnTops: Object.fromEntries(columnScrollers().map(c => [c.key, c.el?.scrollTop ?? 0])),
  }))
  const [leads, setLeads] = useState<PipelineLead[]>(initial.leads)
  // Opened: read the newest copy (a job sold online, a card moved by the server).
  useEffect(() => { void refreshNow() }, [])
  const [stages, setStages] = useState<string[]>(initial.stages)

  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) as ViewMode) || 'board')
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const saved = localStorage.getItem(SORT_KEY) as SortMode
    return SORT_MODES.includes(saved) ? saved : 'manual'
  })
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(readCollapsed)
  const [analyticsOpen, setAnalyticsOpen] = useState<boolean>(() => localStorage.getItem(ANALYTICS_KEY) === '1')

  const [search, setSearch] = useState(restore?.search ?? '')
  const [repFilter, setRepFilter] = useState(restore?.repFilter ?? '')
  const [styleFilter, setStyleFilter] = useState(restore?.styleFilter ?? '')
  const [selected, setSelected] = useState<PipelineLead | null>(null)
  // The card window, and a quote opened from it.
  const [cardId, setCardId] = useState<string | null>(null)
  const [openQuote, setOpenQuote] = useState<SavedQuote | null>(null)
  const [addingToStage, setAddingToStage] = useState<string | null>(null)
  const [confirmSold, setConfirmSold] = useState<{ lead: PipelineLead; fromStage: string } | null>(null)
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set())
  const [isMobile, setIsMobile] = useState(isMobileViewport)

  const rootRef = useRef<HTMLDivElement | null>(null)
  // List view scrolls with the page around it.
  function scroller(): HTMLElement | null {
    const scrolls = (el: HTMLElement) => el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)
    for (let el = rootRef.current?.parentElement ?? null; el; el = el.parentElement) if (scrolls(el)) return el
    return (document.scrollingElement as HTMLElement | null)
  }
  // Board view scrolls sideways as a whole and each column up and down.
  const boardEl = () => rootRef.current?.querySelector<HTMLElement>('[data-kanban-board]') ?? null
  const columnScrollers = () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-kanban-col]') ?? [])
    .map(col => ({ key: col.dataset.kanbanCol!, el: col.querySelector<HTMLElement>('[data-kanban-scroll]') }))

  useLayoutEffect(() => {
    if (!restore) return
    const board = boardEl(); if (board) board.scrollLeft = restore.boardLeft
    for (const c of columnScrollers()) if (c.el) c.el.scrollTop = restore.columnTops[c.key] ?? 0
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

  /** A card opens its window: quote, call, text, navigate, book, notes and stage in one place. */
  function openLead(lead: PipelineLead) { setCardId(lead.id) }
  // A card named in the address (?card=<id>) opens: a reload, a link, or Back onto it.
  const nav = useNav()
  useEffect(() => {
    const id = nav.params.get('card') ?? takeOpenedParam('card')
    if (id && id !== cardId && leads.some(l => l.id === id)) setCardId(id)
  }, [nav])  // eslint-disable-line react-hooks/exhaustive-deps
  const cardLead = cardId ? leads.find(l => l.id === cardId) ?? null : null
  const cardQuotes = useMemo(() => (cardLead?.customerId
    ? (getQuotes() as SavedQuote[]).filter(q => q.customerId === cardLead.customerId).sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    : []), [cardLead?.customerId, dataTick])  // eslint-disable-line react-hooks/exhaustive-deps
  /** The window's stage picker: Signed Contract asks first, as a drop there does. */
  function pickStage(lead: PipelineLead, stage: string) {
    if (stage === lead.stage) return
    if (stage === 'Signed Contract') setConfirmSold({ lead, fromStage: lead.stage })
    else moveLead(lead, stage)
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
      // Stage first, so the list view groups by stage; inside one column it is the hand placed order.
      case 'manual':       out.sort((a, b) => (stages.indexOf(a.stage) - stages.indexOf(b.stage)) || byManualOrder(a, b)); break
      case 'oldest':       out.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')); break
      case 'value_desc':   out.sort((a, b) => valueOf(b) - valueOf(a)); break
      case 'value_asc':    out.sort((a, b) => valueOf(a) - valueOf(b)); break
      case 'days_in_stage':out.sort((a, b) => daysInStage(b) - daysInStage(a)); break
      case 'newest':
      default:             out.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
    }
    return out
  }

  /* ── appointments on the cards ── */
  const appointments = useAppointmentList()
  const apptInfo = useMemo(() => {
    const now = Date.now()
    const next = new Map<string, Appointment>(), overdue = new Set<string>()
    for (const a of appointments) {
      if (needsOutcome(a)) overdue.add(a.crmContactId)
      if (!isOpen(a) || !a.startAt || new Date(a.endAt || a.startAt).getTime() < now) continue
      const cur = next.get(a.crmContactId)
      if (!cur || a.startAt < cur.startAt!) next.set(a.crmContactId, a)
    }
    return { next, overdue }
  }, [appointments])
  /** Book for a card's customer; a card without one just opens its quick view. */
  function bookFor(l: PipelineLead, then?: () => void) {
    if (!l.customerId) { setSelected(l); return }
    openBooking({ customerId: l.customerId, type: 'estimate', onBooked: then })
  }

  /* ── board columns ── */
  // Stage order as configured, with the dead stages (Lost Sale, No Answer) last.
  const columnStages = useMemo(
    () => [...stages.filter(s => !DEAD_STAGES.has(s)), ...stages.filter(s => DEAD_STAGES.has(s))],
    [stages],
  )
  const columns: KanbanColumn<PipelineLead>[] = columnStages.map(stage => ({
    key: stage,
    label: stage,
    items: sortLeads(filteredLeads.filter(l => l.stage === stage)),
    total: leads.reduce((sum, l) => l.stage === stage ? sum + valueOf(l) : sum, 0),
    colorHex: stage === 'Signed Contract' ? '#22c55e' : stageHexFromTailwind(stage),
    icon: stage === 'Signed Contract' ? '🏆' : DEAD_STAGES.has(stage) ? '✕' : undefined,
    emptyLabel: 'No deals in this stage',
  }))
  /** The cards shown in a stage's column, without the one being dragged. */
  const othersIn = (stage: string, lead: PipelineLead) =>
    (columns.find(c => c.key === stage)?.items ?? []).filter(l => l.id !== lead.id)

  /* ── drag-and-drop — optimistic ── */
  /** Where the dragged card will sit in the column once dropped; null when the drop changes nothing. */
  function landingIndex(lead: PipelineLead, stage: string, pointerIndex: number): number | null {
    if (sortMode === 'manual') {
      if (stage !== lead.stage) return pointerIndex
      const shown = columns.find(c => c.key === stage)?.items ?? []
      return shown.findIndex(l => l.id === lead.id) === pointerIndex ? null : pointerIndex
    }
    // Sorted columns: the card goes where the sort puts it, not where it is let go.
    const moved = { ...lead, stage, lastMoved: stage === lead.stage ? lead.lastMoved : TODAY() }
    return sortLeads([...othersIn(stage, lead), moved]).indexOf(moved)
  }

  function onCardDrop(lead: PipelineLead, stage: string, pointerIndex: number) {
    const sameStage = stage === lead.stage
    // Dropping into Appointment books the appointment; the card moves once it is booked.
    if (!sameStage && stage === 'Appointment' && lead.customerId) {
      bookFor(lead, () => moveCard(lead.customerId!, 'Appointment'))
      return
    }
    if (!sameStage && stage === 'Signed Contract') {
      setConfirmSold({ lead, fromStage: lead.stage })
      return
    }
    if (sortMode !== 'manual') {
      if (sameStage) toast.info(`Cards are sorted by ${SORT_LABELS[sortMode]}`, 'Choose "Manual order" in the sort menu to arrange cards by hand.')
      else moveLead(lead, stage)
      return
    }
    // Hand placed: renumber the whole stage (including cards a filter is
    // hiding) with the card put just above the one it was dropped on.
    const shown = othersIn(stage, lead)
    const all = leads.filter(l => l.stage === stage && l.id !== lead.id).sort(byManualOrder)
    const before = shown[pointerIndex]
    const last = shown[shown.length - 1]
    const at = before ? all.findIndex(l => l.id === before.id) : last ? all.findIndex(l => l.id === last.id) + 1 : 0
    const ids = all.map(l => l.id)
    ids.splice(at, 0, lead.id)
    const ranks = new Map(ids.map((id, i) => [id, i]))
    if (sameStage) persist(applyRanks(leads, stage, ranks))
    else moveLead(lead, stage, ranks)
  }

  /** Stamp hand placed positions on the cards of a stage, touching only the ones that change. */
  function applyRanks(list: PipelineLead[], stage: string, ranks: Map<string, number>): PipelineLead[] {
    return list.map(l => {
      const rank = ranks.get(l.id)
      if (rank === undefined || (l.boardOrder?.stage === stage && l.boardOrder.rank === rank)) return l
      return { ...l, boardOrder: { stage, rank } }
    })
  }

  function moveLead(lead: PipelineLead, toStage: string, ranks?: Map<string, number>) {
    const fromStage = lead.stage
    const moved = leads.map(l => l.id === lead.id ? { ...l, stage: toStage, lastMoved: TODAY() } : l)
    persist(ranks ? applyRanks(moved, toStage, ranks) : moved)
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

  function handleAddLead(lead: PipelineLead | null) {
    if (lead) persist([lead, ...leads])
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
  // The same calendar year the dashboard's Revenue YTD tile uses.
  const thisYear = String(new Date().getFullYear())
  const analytics = useMemo(() => {
    const active = leads.filter(l => !DEAD_STAGES.has(l.stage) && l.stage !== 'Paid & Closed')
    // Money figures use the same per card values the cards show (see pipelineValue).
    const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10)
    const m = pipelineMetrics(leads, getQuotes(), getJobs(), since, thisYear)
    const avgDays = active.length ? Math.round(active.reduce((s, l) => s + daysInStage(l), 0) / active.length) : 0
    const atRisk = active.filter(l => daysInStage(l) > 14).length
    return { totalValue: m.pipelineValue, weighted: m.weighted, avgDeal: m.avgDeal, avgDays, closeRate: m.closeRate, atRisk, soldThisYear: m.soldThisYear }
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
        secondaryLabel={`Sold ${thisYear}: ${fmtUSD(analytics.soldThisYear)}`}
        countLabel={`${leads.length} total`}
        view={view} onViewChange={setView}
        search={search} onSearchChange={setSearch}
        sortMode={sortMode} onSortChange={setSortMode}
        repOptions={repOptions} repFilter={repFilter} onRepFilterChange={setRepFilter}
        styleOptions={styleOptions} styleFilter={styleFilter} onStyleFilterChange={setStyleFilter}
        primaryLabel="+ New lead"
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
        <StagePills stages={columnStages} onJump={s => {
          setCollapsed(prev => ({ ...prev, [s]: false }))
          // After the column has opened to full width.
          requestAnimationFrame(() => document.getElementById(`stage-${slug(s)}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'start' }))
        }} />
      )}

      {view === 'board' ? (
        <KanbanBoard
          columns={columns}
          getId={l => l.id}
          collapsed={collapsed}
          onToggle={toggleStage}
          columnDomId={s => `stage-${slug(s)}`}
          landingIndex={landingIndex}
          onDrop={onCardDrop}
          renderCard={l => (
            <PipelineCard
              lead={l}
              value={valueOf(l)}
              onClick={() => openLead(l)}
              onQuickView={() => setSelected(l)}
              faded={matchesSearch !== null && !matchesSearch.has(l.id)}
              isMobile={isMobile}
              onNextStage={() => {
                const next = nextStageOf(l.stage)
                if (next) {
                  if (next === 'Signed Contract') setConfirmSold({ lead: l, fromStage: l.stage })
                  else moveLead(l, next)
                }
              }}
              onMarkLost={() => {
                if (window.confirm(`Mark ${l.firstName} ${l.lastName} as Lost Sale?`)) {
                  moveLead(l, 'Lost Sale')
                }
              }}
              next={l.customerId ? apptInfo.next.get(l.customerId) ?? null : null}
              needsOutcome={!!l.customerId && apptInfo.overdue.has(l.customerId)}
              onBook={() => bookFor(l)}
            />
          )}
        />
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
          className="fixed bottom-6 right-6 max-md:bottom-[calc(84px+env(safe-area-inset-bottom))] max-md:right-4 z-30 w-14 h-14 rounded-full bg-orange-500 hover:bg-orange-600 text-white text-3xl font-light shadow-2xl flex items-center justify-center"
          aria-label="New Lead"
        >+</button>
      )}

      {/* The card's window */}
      {cardLead && (
        <PipelineCardWindow
          lead={cardLead} stages={stages} quotes={cardQuotes}
          next={cardLead.customerId ? apptInfo.next.get(cardLead.customerId) ?? null : null}
          onClose={() => setCardId(null)}
          onNewQuote={c => onNewQuote?.(c)}
          onOpenQuote={q => setOpenQuote(q)}
          onBook={() => bookFor(cardLead)}
          onMoveStage={st => pickStage(cardLead, st)}
          onEditLead={() => setSelected(cardLead)}
          onOpenCustomer={cardLead.customerId && getCustomerById(cardLead.customerId)
            ? () => navigate(`/customers/${encodeURIComponent(cardLead.customerId!)}`, { from: 'Sales Pipeline' }) : null}
        />
      )}
      {openQuote && (
        <QuoteDetailDrawer
          quote={openQuote}
          onClose={() => setOpenQuote(null)}
          onEdit={onOpenQuote ? () => onOpenQuote(openQuote) : undefined}
          onChange={() => setOpenQuote((getQuotes() as SavedQuote[]).find(q => q.id === openQuote.id) ?? null)}
        />
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
      {confirmSold && <BackClose name="confirm-sold" onClose={() => setConfirmSold(null)} />}
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

// New leads from the website and the phone agent get a one tap "Book estimate".
const INTAKE_SOURCES = new Set(['Website Quote', 'Phone (AI receptionist)', 'Website chat'])

function PipelineCard({
  lead, value, onClick, onQuickView, faded, isMobile, onNextStage, onMarkLost, next, needsOutcome: overdue, onBook,
}: {
  lead: PipelineLead
  /** From the customer's quotes; see pipelineValue. */
  value: number
  /** Opens the full customer page. */
  onClick: () => void
  /** Opens the small side panel. */
  onQuickView: () => void
  faded: boolean
  isMobile: boolean
  onNextStage: () => void
  onMarkLost: () => void
  /** The customer's next appointment, shown as a chip. */
  next: Appointment | null
  /** A past appointment nobody has closed out. */
  needsOutcome: boolean
  onBook: () => void
}) {
  const days = daysInStage(lead)
  const hex = stageHexFromTailwind(lead.stage)
  const initials = `${(lead.firstName?.[0] || '').toUpperCase()}${(lead.lastName?.[0] || '').toUpperCase()}`
  const city = (lead.address || '').split(',').slice(-2)[0]?.trim() || lead.address || ''
  // The card's own phone, else the linked customer's (already loaded; no request per card).
  const phone = (lead.phone || (lead.customerId ? getCustomerById(lead.customerId)?.phone : '') || '').trim()
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div
      onClick={onClick}
      className={`relative bg-white rounded-xl shadow-sm hover:shadow-md hover:bg-gray-50 transition-shadow cursor-pointer p-3 group select-none ${faded ? 'opacity-20' : ''}`}
      style={{ borderLeft: `4px solid ${hex}` }}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{lead.firstName} {lead.lastName}</p>
        </div>
        <p className="text-sm font-bold text-emerald-600 shrink-0">{fmtUSD(value)}</p>
      </div>
      <p className="text-xs text-gray-500 truncate">
        {city}{lead.fenceType ? <> · <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{styleLabel(lead.fenceType)}</span></> : null}
      </p>
      {phone && (
        // Tapping calls without opening the card. A press held on it still
        // picks the card up: the board's drag listens to mouse and touch
        // down, which are left to reach it; draggable={false} stops the
        // browser dragging the link itself. Padding with matching negative
        // margins makes it easy to hit without making the card taller.
        <a
          href={telHref(phone)}
          draggable={false}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          className="flex w-fit items-center py-2 -my-1.5 text-xs font-medium text-blue-600 hover:underline [-webkit-touch-callout:none]"
          style={{ minHeight: 0, minWidth: 0 }}
          aria-label={`Call ${formatPhone(phone)}`}
          data-card-phone
        >{formatPhone(phone)}</a>
      )}
      <div className="flex items-center gap-1.5 mt-2 text-[11px] text-gray-500">
        <span className="inline-flex w-5 h-5 rounded-full bg-orange-100 text-orange-700 items-center justify-center text-[9px] font-bold">{initials || '·'}</span>
        <span className="truncate">{lead.assignedRep || '—'}</span>
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px]">
        <span className={`px-2 py-0.5 rounded-full font-semibold ${ageBadgeClass(days)}`}>{days}d in stage</span>
        <span className="flex items-center gap-1.5 text-gray-400">
          {relTime(lead.lastMoved || lead.createdAt)}
          <button
            onClick={e => { e.stopPropagation(); onBook() }}
            className="w-12 h-12 grid place-items-center rounded text-gray-400 hover:text-orange-600 hover:bg-orange-50"
            title="Book appointment" aria-label="Book appointment" data-card-book
          ><CalendarPlus size={16} aria-hidden="true" /></button>
          <button
            onClick={e => { e.stopPropagation(); onQuickView() }}
            className="w-12 h-12 grid place-items-center rounded text-gray-400 hover:text-orange-600 hover:bg-orange-50"
            title="Quick view" aria-label="Quick view"
          ><Eye size={16} aria-hidden="true" /></button>
        </span>
      </div>

      {(next || overdue || (!next && lead.stage === 'First Contact' && INTAKE_SOURCES.has(lead.leadSource))) && (
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          {next && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700" data-card-next><CalendarDays size={12} className="inline -mt-0.5 mr-1" aria-hidden="true" />{shortWhen(next)}</span>
          )}
          {overdue && <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700" data-card-needs-outcome>Needs outcome</span>}
          {!next && lead.stage === 'First Contact' && INTAKE_SOURCES.has(lead.leadSource) && (
            <button onClick={e => { e.stopPropagation(); onBook() }} className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-orange-500 text-white" data-card-book-estimate>Book estimate</button>
          )}
        </div>
      )}

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
              <button onClick={onClick} className="block w-full text-left px-3 py-2 hover:bg-gray-50">Open</button>
              <button onClick={onQuickView} className="block w-full text-left px-3 py-2 hover:bg-gray-50">Quick view</button>
              <button onClick={onNextStage} className="block w-full text-left px-3 py-2 hover:bg-gray-50">Move to Next Stage</button>
              <button onClick={onMarkLost} className="block w-full text-left px-3 py-2 hover:bg-gray-50 text-red-600">Mark Lost</button>
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
          <button onClick={() => setOpenSearch(o => !o)} className="btn btn-secondary btn-icon" aria-label="Search this board"><Search size={18} aria-hidden="true" /></button>
          <button onClick={() => setOpenFilter(o => !o)} className="btn btn-secondary btn-icon" aria-label="Filter and sort"><SlidersHorizontal size={18} aria-hidden="true" /></button>
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
              {styleOptions.map(r => <option key={r} value={r}>{styleLabel(r)}</option>)}
            </select>
            <select value={sortMode} onChange={e => onSortChange(e.target.value as SortMode)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
              {SORT_MODES.map(m => <option key={m} value={m}>{SORT_LABELS[m]}</option>)}
            </select>
            <button onClick={onToggleAnalytics} className="w-full text-left text-xs text-orange-600 hover:underline">{analyticsOpen ? 'Hide analytics' : 'Show analytics'}</button>
          </div>
        )}
      </div>
    )
  }
  return (
    <div className="mb-3">
      <div className="page-header !mb-3">
        <div className="min-w-0">
          <h1>{title}</h1>
          <div className="facts"><span>{totalLabel}</span>{secondaryLabel && <span>{secondaryLabel}</span>}<span>{countLabel}</span></div>
        </div>
        <div className="actions">
          <ViewToggle value={view} onChange={onViewChange} />
          <button onClick={onToggleAnalytics} className="btn btn-quiet">{analyticsOpen ? 'Hide numbers' : 'Show numbers'}</button>
          <button onClick={onPrimary} className="btn btn-primary">{primaryLabel}</button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input value={search} onChange={e => onSearchChange(e.target.value)}
          placeholder="Search..." aria-label="Search this pipeline" className="w-64 border border-gray-300 rounded-lg h-9 px-2.5 text-sm bg-white" />
        <select value={repFilter} onChange={e => onRepFilterChange(e.target.value)} className="border border-gray-300 rounded-lg h-9 px-2.5 text-sm bg-white">
          <option value="">All reps</option>
          {repOptions.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={styleFilter} onChange={e => onStyleFilterChange(e.target.value)} className="border border-gray-300 rounded-lg h-9 px-2.5 text-sm bg-white">
          <option value="">All styles</option>
          {styleOptions.map(r => <option key={r} value={r}>{styleLabel(r)}</option>)}
        </select>
        <select value={sortMode} onChange={e => onSortChange(e.target.value as SortMode)} className="border border-gray-300 rounded-lg h-9 px-2.5 text-sm bg-white" aria-label="Sort">
          {SORT_MODES.map(m => <option key={m} value={m}>{SORT_LABELS[m]}</option>)}
        </select>
      </div>
    </div>
  )
}

function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5">
      {(['board', 'list'] as const).map(v => (
        <button key={v} onClick={() => onChange(v)}
          className={`px-3 min-h-[48px] min-w-[48px] rounded-md text-sm font-semibold capitalize transition ${value === v ? 'bg-white text-gray-900 shadow' : 'text-gray-600 hover:text-gray-900'}`}>
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
          <p className="text-[10px] font-semibold text-gray-400 truncate">{m.label}</p>
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
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Contact</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Style</th>
              <Th label="Stage" onClick={() => setSort('stage')} active={sortCol === 'stage'} dir={sortDir} />
              <Th label="Value" onClick={() => setSort('value')} active={sortCol === 'value'} dir={sortDir} align="right" />
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500">Rep</th>
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
                  <td className="px-3 py-2 text-xs text-gray-600">{styleLabel(l.fenceType) || '—'}</td>
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
    <th className={`px-3 py-2 text-xs font-semibold text-gray-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>
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
          <button onClick={onCancel} className="btn btn-secondary">Cancel</button>
          <button onClick={onConfirm} className="btn btn-primary">{confirmLabel}</button>
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
