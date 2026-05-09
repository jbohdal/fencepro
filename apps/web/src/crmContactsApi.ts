/**
 * Database-backed contact persistence for the CRM web app.
 *
 * The CRM has historically stored customers in localStorage (`fencepro_customers`)
 * — see CRITICAL_ISSUES_AUDIT.md. This client adds a parallel write to the
 * Postgres-backed `/api/crm-contacts` endpoint so contacts survive browser
 * clears, device switches, and deploys.
 *
 * Strategy: dual-write. Local UI is still driven by localStorage (so the page
 * is instantly responsive and works offline), but every save is mirrored to
 * the API in the background. If the API call fails the local state is
 * preserved and the user is warned via toast — no data is lost.
 */

import { getAccessToken } from './crmAuth'
import { toast } from './toast'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '')

export interface CrmContactPayload {
  firstName: string
  lastName: string
  email?: string
  phone?: string
  serviceAddress?: string
  billingAddress?: string
  billingDifferent?: boolean
  city?: string
  state?: string
  zip?: string
  leadSource?: string
  salesRep?: string
  firstApptDate?: string
  tags?: string[]
  notes?: string
  jobStatus?: string
  isCompleted?: boolean
}

export interface CrmContactRecord extends CrmContactPayload {
  id: string
  ownerId?: string
  archivedAt?: string | null
  createdAt: string
  updatedAt: string
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = getAccessToken()
  if (!token) return { ok: false, error: 'Not authenticated' }
  try {
    const res = await fetch(`${AUTH_API}/api/crm-contacts${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) {
      // Token expired — handled by global session-expired handler in App.tsx.
      return { ok: false, error: 'Session expired' }
    }
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.success === false) {
      return { ok: false, error: json?.error || `HTTP ${res.status}` }
    }
    return { ok: true, data: json.data as T }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Network error' }
  }
}

export async function listContacts(): Promise<CrmContactRecord[] | null> {
  const r = await call<CrmContactRecord[]>('GET', '/')
  if (!r.ok) {
    toast.error('Could not load customers from cloud', `${r.error || 'Network error'} — showing local cache only.`)
    return null
  }
  return r.data || []
}

export async function createContact(payload: CrmContactPayload): Promise<CrmContactRecord | null> {
  const r = await call<CrmContactRecord>('POST', '/', payload)
  if (!r.ok) {
    toast.error('Customer not saved to cloud', `${r.error || 'Network error'} — your local copy is preserved. We'll retry next time you save.`)
    return null
  }
  return r.data || null
}

export async function updateContact(id: string, payload: Partial<CrmContactPayload>): Promise<CrmContactRecord | null> {
  const r = await call<CrmContactRecord>('PATCH', `/${id}`, payload)
  if (!r.ok) {
    toast.error('Update not saved to cloud', `${r.error || 'Network error'} — your local copy is preserved.`)
    return null
  }
  return r.data || null
}

export async function archiveContact(id: string): Promise<boolean> {
  const r = await call('DELETE', `/${id}`)
  if (!r.ok) {
    toast.error('Customer not deleted from cloud', `${r.error || 'Network error'} — it will reappear on next reload.`)
  }
  return r.ok
}

// ── Notes (sub resource) ──

export interface CrmContactNoteRecord {
  id: string
  crmContactId: string
  accountId: string
  body: string
  isPinned: boolean
  visibility: 'internal' | 'all_staff'
  createdBy: string
  createdById?: string | null
  createdAt: string
  updatedAt: string
  deletedAt?: string | null
}

export interface CrmContactNotePayload {
  body: string
  isPinned?: boolean
  visibility?: 'internal' | 'all_staff'
}

export async function listContactNotes(contactId: string): Promise<CrmContactNoteRecord[] | null> {
  const r = await call<CrmContactNoteRecord[]>('GET', `/${contactId}/notes`)
  if (!r.ok) {
    toast.error('Could not load notes', `${r.error || 'Network error'}`)
    return null
  }
  return r.data || []
}

export async function createContactNote(contactId: string, payload: CrmContactNotePayload): Promise<CrmContactNoteRecord | null> {
  const r = await call<CrmContactNoteRecord>('POST', `/${contactId}/notes`, payload)
  if (!r.ok) {
    toast.error('Note not saved', `${r.error || 'Network error'}`)
    return null
  }
  return r.data || null
}

export async function updateContactNote(contactId: string, noteId: string, payload: Partial<CrmContactNotePayload>): Promise<CrmContactNoteRecord | null> {
  const r = await call<CrmContactNoteRecord>('PATCH', `/${contactId}/notes/${noteId}`, payload)
  if (!r.ok) {
    toast.error('Note not updated', `${r.error || 'Network error'}`)
    return null
  }
  return r.data || null
}

export async function deleteContactNote(contactId: string, noteId: string): Promise<boolean> {
  const r = await call('DELETE', `/${contactId}/notes/${noteId}`)
  if (!r.ok) {
    toast.error('Note not deleted', `${r.error || 'Network error'} — it will reappear on next reload.`)
  }
  return r.ok
}

/**
 * One shot push of the legacy `fencepro_customer_notes` localStorage blob into
 * the database. Idempotent on the server side (matches by contact + body) and
 * gated by a localStorage flag so we do not retry on every page load.
 */
const NOTES_MIGRATION_FLAG = 'fencepro_notes_db_migrated_v1'

interface LegacyLocalNote {
  id?: string
  customerId: string
  body: string
  isPinned?: boolean
  visibility?: 'internal' | 'all_staff'
  createdBy?: string
  createdAt?: string
  deletedAt?: string
}

export async function migrateLocalNotesOnce(): Promise<void> {
  if (localStorage.getItem(NOTES_MIGRATION_FLAG) === '1') return
  const token = getAccessToken()
  if (!token) return
  try {
    const raw = localStorage.getItem('fencepro_customer_notes')
    const all: LegacyLocalNote[] = raw ? JSON.parse(raw) : []
    const live = (Array.isArray(all) ? all : []).filter(n => n && n.customerId && n.body && !n.deletedAt)
    if (live.length === 0) {
      localStorage.setItem(NOTES_MIGRATION_FLAG, '1')
      return
    }
    const payload = {
      notes: live.map(n => ({
        crmContactId: n.customerId,
        body: n.body,
        isPinned: !!n.isPinned,
        visibility: (n.visibility === 'internal' ? 'internal' : 'all_staff') as 'internal' | 'all_staff',
        createdBy: n.createdBy || 'migrated',
        createdAt: n.createdAt,
      })),
    }
    const r = await call<{ created: number; skipped: number; total: number }>('POST', '/notes/sync', payload)
    if (r.ok) {
      localStorage.setItem(NOTES_MIGRATION_FLAG, '1')
      if (r.data && r.data.created > 0) {
        toast.info('Customer notes synced to cloud', `${r.data.created} note${r.data.created === 1 ? '' : 's'} migrated.`)
      }
    }
  } catch {}
}

/**
 * One-time bulk migration: pushes the entire localStorage `fencepro_customers`
 * blob into the database. Safe to call repeatedly — the server upserts by
 * (ownerId, email) or (ownerId, firstName+lastName+phone). Stamps a flag
 * after first success so we don't repeat on every page load.
 */
const MIGRATION_FLAG = 'fencepro_contacts_db_migrated_v1'

export async function migrateLocalContactsOnce(localCustomers: any[]): Promise<void> {
  if (!localCustomers || localCustomers.length === 0) return
  if (localStorage.getItem(MIGRATION_FLAG) === '1') return
  const token = getAccessToken()
  if (!token) return
  const payload = {
    contacts: localCustomers.map((c: any) => ({
      firstName: c.firstName || c.first_name || '',
      lastName: c.lastName || c.last_name || '',
      email: c.email || undefined,
      phone: c.phone || undefined,
      serviceAddress: c.serviceAddress || c.service_address || undefined,
      billingAddress: c.billingAddress || undefined,
      billingDifferent: !!c.billingDifferent,
      leadSource: c.leadSource || undefined,
      salesRep: c.salesRep || undefined,
      firstApptDate: c.firstApptDate || undefined,
      tags: Array.isArray(c.tags) ? c.tags : undefined,
      notes: c.notes || undefined,
      jobStatus: c.jobStatus || undefined,
      isCompleted: !!c.isCompleted,
    })).filter(c => c.firstName && c.lastName),
  }
  const r = await call<{ created: number; updated: number; total: number }>('POST', '/sync', payload)
  if (r.ok && r.data) {
    localStorage.setItem(MIGRATION_FLAG, '1')
    if (r.data.created > 0 || r.data.updated > 0) {
      toast.info('Customers backed up to cloud', `${r.data.created} new and ${r.data.updated} existing customers are now in the database.`)
    }
  }
}
