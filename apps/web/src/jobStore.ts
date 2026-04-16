import type { SavedQuote } from './QuotesPage'
import { fireOpsStageChange, fireJobCreated, fireJobAssigned, fireJobScheduled, firePaymentReceived } from './automationTrigger'
import { createDraftPO, getPOsForJob } from './purchaseOrderStore'

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

const STORAGE_KEY = 'fencepro_jobs'
const uid = () => Math.random().toString(36).slice(2, 9)

export function getJobs(): Job[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function saveJobs(jobs: Job[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs))
}

export function getJob(id: string): Job | null {
  return getJobs().find(j => j.id === id) || null
}

export function getJobByQuoteId(quoteId: string): Job | null {
  return getJobs().find(j => j.quoteId === quoteId) || null
}

/* ───────── create from quote ───────── */

export function createJobFromQuote(quote: SavedQuote): Job {
  const now = new Date().toISOString()
  const totalFeet = (quote.runs || []).reduce((s: number, r: number) => s + r, 0)

  const job: Job = {
    id: uid(),
    quoteId: quote.id,
    status: 'staging',

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

  const jobs = getJobs()
  saveJobs([job, ...jobs])

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

/* ───────── update ───────── */

export function updateJob(id: string, updates: Partial<Job>): Job | null {
  const jobs = getJobs()
  const idx = jobs.findIndex(j => j.id === id)
  if (idx < 0) return null

  const prev = jobs[idx]
  jobs[idx] = { ...prev, ...updates, updatedAt: new Date().toISOString() }
  saveJobs(jobs)

  // Auto-create PO when materials status changes to 'ordered'
  const job = jobs[idx]
  if (updates.materialsStatus === 'ordered' && prev.materialsStatus !== 'ordered') {
    // Only create if no existing PO for this job
    const existingPOs = getPOsForJob(job.id)
    if (existingPOs.length === 0) {
      try {
        // Pull the quote's pull sheet for line items
        const quotesRaw = localStorage.getItem('fencepro_quotes')
        const quotes = quotesRaw ? JSON.parse(quotesRaw) : []
        const quote = quotes.find((q: any) => q.id === job.quoteId)
        if (quote?.pullSheet?.length > 0) {
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

export function advanceJob(id: string): Job | null {
  const job = getJob(id)
  if (!job || job.status === 'paid' || job.status === 'on_hold') return null

  const currentIdx = STATUS_ORDER.indexOf(job.status)
  if (currentIdx < 0 || currentIdx >= STATUS_ORDER.length - 1) return null

  const nextStatus = STATUS_ORDER[currentIdx + 1]
  const updates: Partial<Job> = { status: nextStatus }

  if (nextStatus === 'completed') {
    updates.completedDate = new Date().toISOString().slice(0, 10)
  }

  const result = updateJob(id, updates)

  // Fire automation trigger
  if (result) {
    fireOpsStageChange(id, job.status, nextStatus, {
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
    if (nextStatus === 'paid') {
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

/* ───────── change order sync ───────── */

export function syncChangeOrderTotal(jobId: string, coTotal: number): void {
  const job = getJob(jobId)
  if (!job) return
  updateJob(jobId, {
    changeOrderTotal: coTotal,
    contractValue: job.quotePrice + coTotal,
  })
}
