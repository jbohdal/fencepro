/**
 * Database-backed saved job persistence for the CRM web app.
 * Mirrors savedQuotesApi.ts pattern. Account scoped on the server.
 */

import { isSignedIn, fetchWithAuth } from './crmAuth'
import { toast } from './toast'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { plainError, plainThrown } from './plainError'

const AUTH_API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '')

export type SavedJobStatus = 'staging' | 'scheduled' | 'in_progress' | 'completed' | 'invoiced' | 'paid' | 'on_hold'
export type SavedJobMaterialsStatus = 'not_ordered' | 'ordered' | 'received' | 'loaded'
export type SavedJobPaymentStatus = 'not_invoiced' | 'invoiced' | 'partial' | 'paid'

export interface SavedJobPayload {
  id?: string
  quoteId?: string | null
  crmContactId?: string | null
  status?: SavedJobStatus
  previousStatus?: SavedJobStatus | null
  /** The Operations stage id ('' for a job saved before stages were kept on the job). */
  opsStage?: string
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
  opsStage?: string
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
  const token = isSignedIn()
  if (!token) return { ok: false, error: 'Not authenticated' }
  try {
    const res = await fetchWithAuth(`${AUTH_API}/api/saved-jobs${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) return { ok: false, error: plainError(401).message }
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.success === false) return { ok: false, error: plainError(res.status, json?.error).message }
    return { ok: true, data: json.data as T }
  } catch (err) {
    return { ok: false, error: plainThrown(err).message }
  }
}

export async function listSavedJobs(): Promise<SavedJobRecord[] | null> {
  const r = await call<SavedJobRecord[]>('GET', '/')
  if (!r.ok) {
    toast.error('Could not load jobs from cloud', r.error || plainError(0).message)
    return null
  }
  return r.data || []
}

export async function createSavedJob(payload: SavedJobPayload): Promise<SavedJobRecord | null> {
  const r = await call<SavedJobRecord>('POST', '/', payload)
  if (!r.ok) {
    toast.error('Job not saved to cloud', r.error || plainError(0).message)
    return null
  }
  return r.data || null
}

export async function updateSavedJob(id: string, payload: SavedJobPayload): Promise<SavedJobRecord | null> {
  const r = await call<SavedJobRecord>('PATCH', `/${id}`, payload)
  if (!r.ok) {
    toast.error('Job update not saved to cloud', r.error || plainError(0).message)
    return null
  }
  return r.data || null
}

export async function archiveSavedJob(id: string): Promise<boolean> {
  const r = await call('DELETE', `/${id}`)
  if (!r.ok) {
    toast.error('Job not deleted from cloud', r.error || plainError(0).message)
  }
  return r.ok
}
