import type { SavedQuote } from './QuotesPage'
import { legacyMigrationEnabled } from './syncGuard'
import { newId } from './recordSync'
import { registerKind, enqueue, hasPending, reapply, pendingFor, type Op } from './outbox'
import { sendJson } from './syncHttp'
import { notifyStageBlocked } from './stageBlocked'
import { fireOpsStageChange, fireJobCreated, fireJobAssigned, fireJobScheduled, firePaymentReceived } from './automationTrigger'
import { createDraftPO, getPOsForJob } from './purchaseOrderStore'
import { getQuoteById } from './quoteStore'
import {
  listSavedJobs,
  migrateLocalJobsOnce,
  type SavedJobRecord,
} from './savedJobsApi'
import { businessDate } from './businessDate'
import { getFirstOpsStage, reconcileStage, stageOf, nextOpsStage, stageFields } from './opsStagesStore'

/* ═══════════════════════════════════════════════
   JOB ENTITY — unified lifecycle from quote to paid
   ═══════════════════════════════════════════════ */

export type JobStatus =
  | 'staging'        // materials being prepped
  | 'scheduled'      // crew + date assigned
  | 'in_progress'    // crew on site
  | 'completed'      // work done, pending invoice
  | 'invoiced'       // customer billed
  | 'paid'           // payment received
  | 'on_hold'        // paused (HOA, customer delay, backorder)

export type MaterialsStatus = 'not_ordered' | 'ordered' | 'received' | 'loaded'

export interface Job {
  id: string
  quoteId: string
  status: JobStatus
  previousStatus?: JobStatus   // for un-holding
  /** The Operations stage id (Settings > Operations Stages); '' on a job saved before stages were kept on the job. */
  opsStage?: string

  // Customer (from quote)
  customerName: string
  customerPhone: string
  customerEmail: string
  customerAddress: string
  customerId?: string

  // Scope (from quote)
  fenceStyle: string
  sections: number
  totalFeet: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  hasSalesman: boolean

  // Geolocation (for smart scheduling)
  lat?: number
  lng?: number

  // Pricing
  quotePrice: number           // original quote finalPrice
  changeOrderTotal: number     // sum of approved COs
  contractValue: number        // quotePrice + changeOrderTotal
  gmPct: number

  // Operations — staging
  materialsStatus: MaterialsStatus
  pullSheetPulled: boolean
  locatesDate?: string         // call-before-you-dig date
  locatesExpDate?: string
  drawingComplete: boolean

  // Operations — scheduling
  crewAssigned: string
  scheduledDate: string
  scheduledEndDate?: string
  estimatedDays: number

  // Operations — completion
  completedDate?: string
  completedBy?: string
  actualDays?: number

  // Payment
  invoiceNumber?: string
  invoiceDate?: string
  paymentStatus: 'not_invoiced' | 'invoiced' | 'partial' | 'paid'
  amountPaid: number
  paymentDate?: string
  paymentMethod?: string

  // Meta
  notes: string
  holdReason?: string
  salesRep: string
  leadSource: string
  createdAt: string
  updatedAt: string
}

/* ───────── helpers ───────── */

const LEGACY_KEY = 'fencepro_jobs'
const EVT = 'fencepro:jobs:updated'
const uid = () => Math.random().toString(36).slice(2, 9)

let cache: Job[] = []
let initPromise: Promise<void> | null = null
let hydrated = false

function fromApi(r: SavedJobRecord): Job {
  return {
    id: r.id,
    quoteId: r.quoteId || '',
    status: r.status,
    previousStatus: r.previousStatus || undefined,
    opsStage: r.opsStage || '',
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerEmail: r.customerEmail,
    customerAddress: r.customerAddress,
    customerId: r.crmContactId || undefined,
    fenceStyle: r.fenceStyle,
    sections: r.sections,
    totalFeet: r.totalFeet,
    walkGates: r.walkGates,
    dblGates: r.dblGates,
    tearOutSections: r.tearOutSections,
    hasSalesman: r.hasSalesman,
    lat: r.lat ?? undefined,
    lng: r.lng ?? undefined,
    quotePrice: r.quotePrice,
    changeOrderTotal: r.changeOrderTotal,
    contractValue: r.contractValue,
    gmPct: r.gmPct ?? 0,
    materialsStatus: r.materialsStatus,
    pullSheetPulled: r.pullSheetPulled,
    locatesDate: r.locatesDate || undefined,
    locatesExpDate: r.locatesExpDate || undefined,
    drawingComplete: r.drawingComplete,
    crewAssigned: r.crewAssigned,
    scheduledDate: r.scheduledDate,
    scheduledEndDate: r.scheduledEndDate || undefined,
    estimatedDays: r.estimatedDays,
    completedDate: r.completedDate || undefined,
    completedBy: r.completedBy || undefined,
    actualDays: r.actualDays ?? undefined,
    invoiceNumber: r.invoiceNumber || undefined,
    invoiceDate: r.invoiceDate || undefined,
    paymentStatus: r.paymentStatus,
    amountPaid: r.amountPaid,
    paymentDate: r.paymentDate || undefined,
    paymentMethod: r.paymentMethod || undefined,
    notes: r.notes,
    holdReason: r.holdReason || undefined,
    salesRep: r.salesRep,
    leadSource: r.leadSource,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }
}

function toApiPayload(j: Partial<Job>) {
  return {
    quoteId: j.quoteId || null,
    crmContactId: j.customerId || null,
    status: j.status,
    previousStatus: j.previousStatus ?? null,
    opsStage: j.opsStage || '',
    customerName: j.customerName,
    customerPhone: j.customerPhone,
    customerEmail: j.customerEmail,
    customerAddress: j.customerAddress,
    fenceStyle: j.fenceStyle,
    sections: j.sections,
    totalFeet: j.totalFeet,
    walkGates: j.walkGates,
    dblGates: j.dblGates,
    tearOutSections: j.tearOutSections,
    hasSalesman: j.hasSalesman,
    lat: j.lat ?? null,
    lng: j.lng ?? null,
    quotePrice: j.quotePrice,
    changeOrderTotal: j.changeOrderTotal,
    contractValue: j.contractValue,
    gmPct: j.gmPct,
    materialsStatus: j.materialsStatus,
    pullSheetPulled: j.pullSheetPulled,
    locatesDate: j.locatesDate ?? null,
    locatesExpDate: j.locatesExpDate ?? null,
    drawingComplete: j.drawingComplete,
    crewAssigned: j.crewAssigned,
    scheduledDate: j.scheduledDate,
    scheduledEndDate: j.scheduledEndDate ?? null,
    estimatedDays: j.estimatedDays,
    completedDate: j.completedDate ?? null,
    completedBy: j.completedBy ?? null,
    actualDays: j.actualDays ?? null,
    invoiceNumber: j.invoiceNumber ?? null,
    invoiceDate: j.invoiceDate ?? null,
    paymentStatus: j.paymentStatus,
    amountPaid: j.amountPaid,
    paymentDate: j.paymentDate ?? null,
    paymentMethod: j.paymentMethod ?? null,
    notes: j.notes,
    holdReason: j.holdReason ?? null,
    salesRep: j.salesRep,
    leadSource: j.leadSource,
  }
}

function emit() { try { window.dispatchEvent(new CustomEvent(EVT)) } catch {} }

export function initJobs(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    const migrate = legacyMigrationEnabled()
    if (migrate) { try { await migrateLocalJobsOnce() } catch {} }
    const records = await listSavedJobs()
    if (!records) return
    cache = records.map(fromApi)
    hydrated = true
    // Jobs made or changed on this phone and not on the server yet.
    reapply('job.')
    emit()
    if (migrate) { try { localStorage.removeItem(LEGACY_KEY) } catch {} }
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

/** True once jobs have loaded from the server. */
export function isJobsHydrated(): boolean { return hydrated }

export function getJobs(): Job[] {
  return cache
}

export function saveJobs(_jobs: Job[]): void {
  // No op kept for backward compatibility. Writes flow through createSavedJob /
  // updateSavedJob inside this module; legacy callers that bulk-rewrote the
  // jobs list are gone after the Phase 3 migration.
}

export function getJob(id: string): Job | null {
  return cache.find(j => j.id === id) || null
}

export function getJobByQuoteId(quoteId: string): Job | null {
  return cache.find(j => j.quoteId === quoteId) || null
}

/* ───────── create from quote ───────── */

export function createJobFromQuote(quote: SavedQuote): Job {
  const now = new Date().toISOString()
  const totalFeet = (quote.runs || []).reduce((s: number, r: number) => s + r, 0)

  const job: Job = {
    // Permanent id: checklists, purchase orders and schedule entries keyed by
    // it stay valid after a reload.
    id: newId(),
    quoteId: quote.id,
    status: 'staging',
    // New jobs land in the stage marked first in Settings > Operations Stages.
    opsStage: getFirstOpsStage()?.id || '',

    customerName: quote.customerName,
    customerPhone: quote.customerPhone,
    customerEmail: quote.customerEmail,
    customerAddress: quote.customerAddress,
    customerId: quote.customerId,

    fenceStyle: quote.fenceStyle,
    sections: quote.sections,
    totalFeet,
    walkGates: quote.walkGates,
    dblGates: quote.dblGates,
    tearOutSections: quote.tearOutSections,
    hasSalesman: quote.hasSalesman,

    quotePrice: quote.finalPrice,
    changeOrderTotal: 0,
    contractValue: quote.finalPrice,
    gmPct: quote.gmPct,

    materialsStatus: 'not_ordered',
    pullSheetPulled: false,
    drawingComplete: false,

    crewAssigned: '',
    scheduledDate: '',
    estimatedDays: Math.max(1, Math.ceil(quote.sections / 15)), // rough estimate: ~15 sections/day

    paymentStatus: 'not_invoiced',
    amountPaid: 0,

    notes: quote.notes || '',
    salesRep: quote.salesRep || '',
    leadSource: quote.leadSource || '',
    createdAt: now,
    updatedAt: now,
  }

  cache = [job, ...cache]
  emit()

  // Queued behind the quote and the customer it came from, so they exist on
  // the server before the job that points at them.
  void enqueue<Job>({ key: `job:${job.id}`, kind: 'job.create', payload: job, label: `${job.customerName || 'Job'}, new job`, after: jobDeps(job) })

  // The milestone checklist is made on the server with the job (lib/seeds.ts).

  // Fire automation trigger
  fireJobCreated(job.id, {
    jobName: job.customerName,
    jobAddress: job.customerAddress,
    fenceType: job.fenceStyle,
    assignedRep: job.salesRep,
    customerName: job.customerName,
    customerEmail: job.customerEmail,
    customerPhone: job.customerPhone,
    contractValue: job.contractValue,
    quotePrice: job.quotePrice,
  })

  return job
}

/** A job goes after its customer and quote, when those are still on the way. */
function jobDeps(j: Job): string[] {
  const keys = [j.customerId ? `customer:${j.customerId}` : '', j.quoteId ? `quote:${j.quoteId}` : ''].filter(Boolean)
  return keys.filter(k => pendingFor(k).length > 0)
}
const takeJobFields = (op: Op<Job>, data: unknown) => {
  const id = op.payload.id
  if (!data || hasPending(`job:${id}`)) return
  const fromServer = fromApi(data as SavedJobRecord)
  cache = cache.map(j => j.id === id ? { ...fromServer, id } : j)
  emit()
}
registerKind<Job>('job.create', {
  refused: () => { lastSync = null; void refreshJobs() },
  what: () => 'This job',
  send: op => sendJson('POST', '/api/saved-jobs', { ...toApiPayload(op.payload), id: op.payload.id }).then(r => r.result),
  confirmed: takeJobFields,
  apply: op => { if (!cache.some(j => j.id === op.payload.id)) cache = [op.payload, ...cache] },
})
registerKind<Job>('job.update', {
  refused: () => { lastSync = null; void refreshJobs() },
  what: () => 'This change to the job',
  send: async op => {
    const r = await sendJson('PATCH', `/api/saved-jobs/${encodeURIComponent(op.payload.id)}`, toApiPayload(op.payload))
    if (r.status === 409 && r.json?.code === 'STAGE_BLOCKED' && r.json?.data) {
      // A stage rule refused the move: the job goes back to the stage the server has, the rest of the edit goes again, and the screen says what is missing.
      const server = fromApi(r.json.data as SavedJobRecord) as any
      const back: any = { ...op.payload }
      for (const k of ['status', 'previousStatus', 'opsStage', 'materialsStatus', 'drawingComplete', 'locatesDate', 'completedDate']) back[k] = server[k]
      op.payload = back
      cache = cache.map(j => j.id === back.id ? back : j)
      emit()
      notifyStageBlocked(r.json.blocked ?? [])
      return { ok: false, status: 409, retryNow: true }
    }
    return r.result
  },
  confirmed: takeJobFields,
  apply: op => { cache = cache.map(j => j.id === op.payload.id ? op.payload : j) },
})

/* ───────── update ───────── */

export function updateJob(id: string, updates: Partial<Job>): Job | null {
  const idx = cache.findIndex(j => j.id === id)
  if (idx < 0) return null

  const prev = cache[idx]
  const next: Job = { ...prev, ...updates, updatedAt: new Date().toISOString() }
  // The stage follows the same rule as the server (opsStageModel.reconcileOpsStage): moved on purpose, or as a status change moves it.
  next.opsStage = reconcileStage(prev, next)
  cache = cache.map(j => j.id === id ? next : j)
  emit()
  // Queued behind the job's create and earlier edits. The latest cached copy
  // is what gets sent, so rapid edits cannot land out of order.
  void enqueue<Job>({ key: `job:${id}`, kind: 'job.update', payload: next, label: `${next.customerName || 'Job'}, job changes`, after: jobDeps(next) })
  // Local view of the rest of this function uses `jobs`/`prev`/`jobs[idx]`
  // semantics from before; re-bind for minimal further change below.
  const jobs = cache
  jobs[idx] = next

  // Fire job_assigned when crew changes
  if (updates.crewAssigned !== undefined && updates.crewAssigned !== prev.crewAssigned) {
    try {
      fireJobAssigned(id, updates.crewAssigned || '', {
        jobName: jobs[idx].customerName, customerName: jobs[idx].customerName,
        jobAddress: jobs[idx].customerAddress,
        assignedRep: jobs[idx].salesRep,
      })
    } catch { /* noop */ }
  }
  // Fire job_scheduled when scheduledDate changes
  if (updates.scheduledDate !== undefined && updates.scheduledDate !== prev.scheduledDate) {
    try {
      const wasScheduled = !!prev.scheduledDate
      fireJobScheduled(id, updates.scheduledDate || '', {
        jobName: jobs[idx].customerName, customerName: jobs[idx].customerName,
        jobAddress: jobs[idx].customerAddress,
        assignedRep: jobs[idx].salesRep,
        crewAssigned: jobs[idx].crewAssigned,
      })
      // Treat a change in an existing schedule as a reschedule too
      if (wasScheduled) {
        import('./automationTrigger').then(m => m.fireJobRescheduled(id, updates.scheduledDate || '', {
          jobName: jobs[idx].customerName, customerName: jobs[idx].customerName,
        })).catch(() => {})
      }
    } catch { /* noop */ }
  }

  // Auto-create PO when materials status changes to 'ordered'
  const job = jobs[idx]
  if (updates.materialsStatus === 'ordered' && prev.materialsStatus !== 'ordered') {
    // Only create if no existing PO for this job
    const existingPOs = getPOsForJob(job.id)
    if (existingPOs.length === 0) {
      try {
        // Pull the quote's pull sheet for line items
        const quote = getQuoteById(job.quoteId)
        if (quote?.pullSheet?.length && quote.pullSheet.length > 0) {
          createDraftPO(
            job.id,
            job.customerName,
            job.customerAddress,
            quote.pullSheet.map((li: any) => ({
              itemName: li.item, quantity: li.qty, unitCost: li.unitCost,
            })),
          )
          console.log(`[AutoPO] Draft PO created for job ${job.customerName}`)
        }
      } catch (err) { console.warn('[AutoPO] Failed:', err) }
    }
  }

  return job
}

/* ───────── status transitions ───────── */

export const STATUS_ORDER: JobStatus[] = ['staging', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid']

export const STATUS_CONFIG: Record<JobStatus, { label: string; color: string; bgColor: string; icon: string }> = {
  staging:     { label: 'Staging',      color: 'text-purple-700', bgColor: 'bg-purple-100',  icon: '🏗' },
  scheduled:   { label: 'Scheduled',    color: 'text-blue-700',   bgColor: 'bg-blue-100',    icon: '📅' },
  in_progress: { label: 'In Progress',  color: 'text-orange-700', bgColor: 'bg-orange-100',  icon: '🔨' },
  completed:   { label: 'Completed',    color: 'text-green-700',  bgColor: 'bg-green-100',   icon: '✅' },
  invoiced:    { label: 'Invoiced',     color: 'text-indigo-700', bgColor: 'bg-indigo-100',   icon: '💳' },
  paid:        { label: 'Paid',         color: 'text-emerald-700', bgColor: 'bg-emerald-100', icon: '💰' },
  on_hold:     { label: 'On Hold',      color: 'text-gray-600',   bgColor: 'bg-gray-200',    icon: '⏸' },
}

export const MATERIALS_STATUS_CONFIG: Record<MaterialsStatus, { label: string; color: string }> = {
  not_ordered: { label: 'Not Ordered', color: 'text-gray-400' },
  ordered:     { label: 'Ordered',     color: 'text-blue-600' },
  received:    { label: 'Received',    color: 'text-orange-600' },
  loaded:      { label: 'Loaded',      color: 'text-green-600' },
}

/**
 * Move a job to the next stage on the board (Settings > Operations Stages
 * order), setting the status that stage stands for.
 */
export function advanceJob(id: string): Job | null {
  const job = getJob(id)
  if (!job || job.status === 'on_hold') return null
  const next = nextOpsStage(stageOf(job))
  if (!next) return null
  const updates = stageFields(next.id, job, businessDate(new Date())) as Partial<Job> | null
  if (!updates) return null

  const result = updateJob(id, updates)

  // Fire automation trigger
  if (result) {
    fireOpsStageChange(id, stageOf(job), next.id, {
      jobName: job.customerName,
      jobAddress: job.customerAddress,
      fenceType: job.fenceStyle,
      assignedRep: job.salesRep,
      crewAssigned: job.crewAssigned,
      customerName: job.customerName,
      customerEmail: job.customerEmail,
      customerPhone: job.customerPhone,
      scheduledDate: job.scheduledDate,
      contractValue: job.contractValue,
    })
    if (result.status === 'paid' && job.status !== 'paid') {
      firePaymentReceived(id, { jobName: job.customerName, customerName: job.customerName })
    }
  }

  return result
}

export function holdJob(id: string, reason: string): Job | null {
  const job = getJob(id)
  if (!job) return null
  return updateJob(id, { status: 'on_hold', previousStatus: job.status, holdReason: reason })
}

export function unholdJob(id: string): Job | null {
  const job = getJob(id)
  if (!job || job.status !== 'on_hold') return null
  return updateJob(id, { status: job.previousStatus || 'staging', holdReason: undefined, previousStatus: undefined })
}

/* ───────── summary stats ───────── */

export function getJobStats(): {
  byStatus: Record<JobStatus, number>
  totalContractValue: number
  totalPaid: number
  totalOutstanding: number
  activeJobs: number
} {
  const jobs = getJobs()
  const byStatus: Record<JobStatus, number> = {
    staging: 0, scheduled: 0, in_progress: 0, completed: 0, invoiced: 0, paid: 0, on_hold: 0,
  }

  let totalContractValue = 0
  let totalPaid = 0
  let activeJobs = 0

  for (const job of jobs) {
    byStatus[job.status]++
    totalContractValue += job.contractValue
    totalPaid += job.amountPaid
    if (job.status !== 'paid' && job.status !== 'on_hold') activeJobs++
  }

  return { byStatus, totalContractValue, totalPaid, totalOutstanding: totalContractValue - totalPaid, activeJobs }
}

/** When this list was last read from the server (the server's own clock). */
let lastSync: string | null = null

/**
 * Read the list again (the server changes some on its own: a customer
 * accepting online). Only what changed since the last read comes back, so it
 * is small on cell data. Waiting changes stay on top. Quiet with no signal.
 */
export async function refreshJobs(): Promise<void> {
  if (!hydrated) return
  const r = await sendJson('GET', `/api/saved-jobs${lastSync ? `?since=${encodeURIComponent(lastSync)}` : ''}`)
  if (!r.result.ok || !Array.isArray(r.json?.data)) return
  const rows = r.json.data as Array<SavedJobRecord & { archivedAt?: string | null }>
  if (r.json.partial) {
    if (rows.length) {
      const byId = new Map(cache.map(x => [x.id, x]))
      for (const row of rows) { if (row.archivedAt) byId.delete(row.id); else byId.set(row.id, fromApi(row)) }
      cache = [...byId.values()]
    }
  } else cache = rows.map(fromApi)
  if (typeof r.json.serverTime === 'string') lastSync = r.json.serverTime
  if (!r.json.partial || rows.length) { reapply('job.'); emit() }
}
