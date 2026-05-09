/**
 * Database-backed saved job persistence for the CRM web app.
 * Mirrors savedQuotesApi.ts pattern. Account scoped on the server.
 */

import { getAccessToken } from './crmAuth'
import { toast } from './toast'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '')

export type SavedJobStatus = 'staging' | 'scheduled' | 'in_progress' | 'completed' | 'invoiced' | 'paid' | 'on_hold'
export type SavedJobMaterialsStatus = 'not_ordered' | 'ordered' | 'received' | 'loaded'
export type SavedJobPaymentStatus = 'not_invoiced' | 'invoiced' | 'partial' | 'paid'

export interface SavedJobPayload {
  id?: string
  quoteId?: string | null
  crmContactId?: string | null
  status?: SavedJobStatus
  previousStatus?: SavedJobStatus | null
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  customerAddress?: string
  fenceStyle?: string
  sections?: number
  totalFeet?: number
  walkGates?: number
  dblGates?: number
  tearOutSections?: number
  hasSalesman?: boolean
  lat?: number | null
  lng?: number | null
  quotePrice?: number
  changeOrderTotal?: number
  contractValue?: number
  gmPct?: number
  materialsStatus?: SavedJobMaterialsStatus
  pullSheetPulled?: boolean
  locatesDate?: string | null
  locatesExpDate?: string | null
  drawingComplete?: boolean
  crewAssigned?: string
  scheduledDate?: string
  scheduledEndDate?: string | null
  estimatedDays?: number
  completedDate?: string | null
  completedBy?: string | null
  actualDays?: number | null
  invoiceNumber?: string | null
  invoiceDate?: string | null
  paymentStatus?: SavedJobPaymentStatus
  amountPaid?: number
  paymentDate?: string | null
  paymentMethod?: string | null
  notes?: string
  holdReason?: string | null
  salesRep?: string
  leadSource?: string
}

export interface SavedJobRecord {
  id: string
  accountId: string
  quoteId: string | null
  crmContactId: string | null
  status: SavedJobStatus
  previousStatus: SavedJobStatus | null
  customerName: string
  customerPhone: string
  customerEmail: string
  customerAddress: string
  fenceStyle: string
  sections: number
  totalFeet: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  hasSalesman: boolean
  lat: number | null
  lng: number | null
  quotePrice: number
  changeOrderTotal: number
  contractValue: number
  gmPct: number
  materialsStatus: SavedJobMaterialsStatus
  pullSheetPulled: boolean
  locatesDate: string | null
  locatesExpDate: string | null
  drawingComplete: boolean
  crewAssigned: string
  scheduledDate: string
  scheduledEndDate: string | null
  estimatedDays: number
  completedDate: string | null
  completedBy: string | null
  actualDays: number | null
  invoiceNumber: string | null
  invoiceDate: string | null
  paymentStatus: SavedJobPaymentStatus
  amountPaid: number
  paymentDate: string | null
  paymentMethod: string | null
  notes: string
  holdReason: string | null
  salesRep: string
  leadSource: string
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = getAccessToken()
  if (!token) return { ok: false, error: 'Not authenticated' }
  try {
    const res = await fetch(`${AUTH_API}/api/saved-jobs${path}`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) return { ok: false, error: 'Session expired' }
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.success === false) return { ok: false, error: json?.error || `HTTP ${res.status}` }
    return { ok: true, data: json.data as T }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Network error' }
  }
}

export async function listSavedJobs(): Promise<SavedJobRecord[] | null> {
  const r = await call<SavedJobRecord[]>('GET', '/')
  if (!r.ok) {
    toast.error('Could not load jobs from cloud', `${r.error || 'Network error'}`)
    return null
  }
  return r.data || []
}

export async function createSavedJob(payload: SavedJobPayload): Promise<SavedJobRecord | null> {
  const r = await call<SavedJobRecord>('POST', '/', payload)
  if (!r.ok) {
    toast.error('Job not saved to cloud', `${r.error || 'Network error'}`)
    return null
  }
  return r.data || null
}

export async function updateSavedJob(id: string, payload: SavedJobPayload): Promise<SavedJobRecord | null> {
  const r = await call<SavedJobRecord>('PATCH', `/${id}`, payload)
  if (!r.ok) {
    toast.error('Job update not saved to cloud', `${r.error || 'Network error'}`)
    return null
  }
  return r.data || null
}

export async function archiveSavedJob(id: string): Promise<boolean> {
  const r = await call('DELETE', `/${id}`)
  if (!r.ok) {
    toast.error('Job not deleted from cloud', `${r.error || 'Network error'}`)
  }
  return r.ok
}

const JOBS_MIGRATION_FLAG = 'fencepro_jobs_db_migrated_v1'

export async function migrateLocalJobsOnce(): Promise<void> {
  if (localStorage.getItem(JOBS_MIGRATION_FLAG) === '1') return
  const token = getAccessToken()
  if (!token) return
  try {
    const raw = localStorage.getItem('fencepro_jobs')
    const all: any[] = raw ? JSON.parse(raw) : []
    if (!Array.isArray(all) || all.length === 0) {
      localStorage.setItem(JOBS_MIGRATION_FLAG, '1')
      return
    }
    const payload = {
      jobs: all
        .filter(j => j && (j.customerName || j.fenceStyle))
        .map(j => ({
          id: j.id,
          quoteId: j.quoteId || undefined,
          crmContactId: j.customerId || undefined,
          status: j.status || 'staging',
          previousStatus: j.previousStatus || undefined,
          customerName: j.customerName || '',
          customerPhone: j.customerPhone || '',
          customerEmail: j.customerEmail || '',
          customerAddress: j.customerAddress || '',
          fenceStyle: j.fenceStyle || '',
          sections: j.sections || 0,
          totalFeet: j.totalFeet || 0,
          walkGates: j.walkGates || 0,
          dblGates: j.dblGates || 0,
          tearOutSections: j.tearOutSections || 0,
          hasSalesman: !!j.hasSalesman,
          lat: j.lat ?? undefined,
          lng: j.lng ?? undefined,
          quotePrice: j.quotePrice || 0,
          changeOrderTotal: j.changeOrderTotal || 0,
          contractValue: j.contractValue || 0,
          gmPct: j.gmPct || 0,
          materialsStatus: j.materialsStatus || 'not_ordered',
          pullSheetPulled: !!j.pullSheetPulled,
          locatesDate: j.locatesDate || undefined,
          locatesExpDate: j.locatesExpDate || undefined,
          drawingComplete: !!j.drawingComplete,
          crewAssigned: j.crewAssigned || '',
          scheduledDate: j.scheduledDate || '',
          scheduledEndDate: j.scheduledEndDate || undefined,
          estimatedDays: j.estimatedDays || 0,
          completedDate: j.completedDate || undefined,
          completedBy: j.completedBy || undefined,
          actualDays: j.actualDays ?? undefined,
          invoiceNumber: j.invoiceNumber || undefined,
          invoiceDate: j.invoiceDate || undefined,
          paymentStatus: j.paymentStatus || 'not_invoiced',
          amountPaid: j.amountPaid || 0,
          paymentDate: j.paymentDate || undefined,
          paymentMethod: j.paymentMethod || undefined,
          notes: j.notes || '',
          holdReason: j.holdReason || undefined,
          salesRep: j.salesRep || '',
          leadSource: j.leadSource || '',
        })),
    }
    const r = await call<{ created: number; updated: number; skipped: number; total: number }>('POST', '/sync', payload)
    if (r.ok) {
      localStorage.setItem(JOBS_MIGRATION_FLAG, '1')
      if (r.data && (r.data.created > 0 || r.data.updated > 0)) {
        toast.info('Jobs synced to cloud', `${r.data.created} new and ${r.data.updated} existing jobs are now in the database.`)
      }
    }
  } catch {}
}
