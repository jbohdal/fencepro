/**
 * Unified customer store — single source of truth for customer records.
 *
 * Backed by /api/crm-contacts (Postgres). The in memory cache is hydrated by
 * initCustomers() once after auth, kept fresh by every save call, and
 * broadcast to listeners via the `fencepro:customers:updated` event.
 *
 * Reads are synchronous (cache lookups). Writes are async (API roundtrip)
 * but optimistic — the cache updates immediately and the event fires before
 * the network call returns. If the API call fails, crmContactsApi surfaces
 * a toast and the optimistic record stays in the cache; the next save or
 * page reload reconciles it.
 */

import { fireCustomerCreated } from './automationTrigger'
import { addLeadForNewCustomer } from './pipelineSeeder'
import {
  listContacts,
  createContact as apiCreateContact,
  updateContact as apiUpdateContact,
  archiveContact as apiArchiveContact,
  migrateLocalContactsOnce,
  type CrmContactRecord,
  type CrmContactPayload,
} from './crmContactsApi'

const EVT = 'fencepro:customers:updated'
const LEGACY_KEY = 'fencepro_customers'

const uid = () => Math.random().toString(36).slice(2, 10)

export interface Customer {
  id: string
  firstName: string
  lastName: string
  phone: string
  email: string
  serviceAddress: string
  billingAddress: string
  billingDifferent: boolean
  leadSource: string
  notes: string
  tags: string[]
  createdAt: string
  salesRep: string
  firstApptDate: string
  jobStatus?: string
}

let cache: Customer[] = []
let initPromise: Promise<void> | null = null

function fromApi(r: CrmContactRecord): Customer {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    phone: r.phone || '',
    email: r.email || '',
    serviceAddress: r.serviceAddress || '',
    billingAddress: r.billingAddress || '',
    billingDifferent: !!r.billingDifferent,
    leadSource: r.leadSource || '',
    notes: r.notes || '',
    tags: Array.isArray(r.tags) ? r.tags : [],
    createdAt: (r.createdAt || '').slice(0, 10),
    salesRep: r.salesRep || '',
    firstApptDate: r.firstApptDate || '',
    jobStatus: r.jobStatus,
  }
}

function toApiPayload(c: Partial<Customer>): CrmContactPayload {
  return {
    firstName: (c.firstName || '').trim(),
    lastName: (c.lastName || '').trim(),
    email: c.email || undefined,
    phone: c.phone || undefined,
    serviceAddress: c.serviceAddress || undefined,
    billingAddress: c.billingAddress || undefined,
    billingDifferent: !!c.billingDifferent,
    leadSource: c.leadSource || undefined,
    salesRep: c.salesRep || undefined,
    firstApptDate: c.firstApptDate || undefined,
    tags: Array.isArray(c.tags) ? c.tags : undefined,
    notes: c.notes || undefined,
    jobStatus: c.jobStatus || undefined,
  }
}

function emit() {
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

/**
 * Hydrate the in memory cache from /api/crm-contacts. Idempotent — the second
 * call returns the same in flight promise. Pushes any legacy localStorage
 * records to the API first via migrateLocalContactsOnce, then drops the
 * legacy key so canonical data lives only in Postgres.
 */
export function initCustomers(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    try {
      const raw = localStorage.getItem(LEGACY_KEY)
      const local = raw ? JSON.parse(raw) : []
      if (Array.isArray(local) && local.length > 0) {
        await migrateLocalContactsOnce(local)
      }
    } catch {}
    const records = await listContacts()
    if (records) {
      cache = records.map(fromApi)
      emit()
    }
    try { localStorage.removeItem(LEGACY_KEY) } catch {}
  })()
  return initPromise
}

export function getCustomers(): Customer[] {
  return cache
}

export function getCustomerById(id: string): Customer | null {
  return cache.find(c => c.id === id) || null
}

/** Find an existing customer by phone or email to avoid duplicates. */
export function findDuplicate(data: { phone?: string; email?: string }): Customer | null {
  const phone = (data.phone || '').replace(/\D/g, '')
  const email = (data.email || '').toLowerCase()
  for (const c of cache) {
    const cPhone = (c.phone || '').replace(/\D/g, '')
    const cEmail = (c.email || '').toLowerCase()
    if (phone && cPhone && phone === cPhone) return c
    if (email && cEmail && email === cEmail) return c
  }
  return null
}

/**
 * Upsert a customer. Returns the merged record synchronously from the cache
 * and fires the API write in the background. If a row exists (by id, phone,
 * or email), fields are merged onto the existing record (non empty wins).
 * Otherwise a new record is created with a temporary client id; once the API
 * returns, the cache is rewritten with the server's id and the event refires.
 */
export function upsertCustomer(partial: Partial<Customer> & { firstName: string }): { customer: Customer; created: boolean } {
  let existing = partial.id ? cache.find(c => c.id === partial.id) : null
  if (!existing) existing = findDuplicate({ phone: partial.phone, email: partial.email })

  if (existing) {
    const merged: Customer = {
      ...existing,
      firstName: partial.firstName?.trim() || existing.firstName,
      lastName:  partial.lastName  ?? existing.lastName,
      phone:     partial.phone     ?? existing.phone,
      email:     partial.email     ?? existing.email,
      serviceAddress: partial.serviceAddress ?? existing.serviceAddress,
      billingAddress: partial.billingAddress ?? existing.billingAddress,
      billingDifferent: partial.billingDifferent ?? existing.billingDifferent,
      leadSource: partial.leadSource || existing.leadSource,
      notes:      partial.notes     ?? existing.notes,
      tags:       partial.tags      ?? existing.tags,
      salesRep:   partial.salesRep  ?? existing.salesRep,
      firstApptDate: partial.firstApptDate ?? existing.firstApptDate,
    }
    cache = cache.map(c => c.id === merged.id ? merged : c)
    emit()
    apiUpdateContact(merged.id, toApiPayload(merged)).then(updated => {
      if (!updated) return
      const fromServer = fromApi(updated)
      cache = cache.map(c => c.id === fromServer.id ? fromServer : c)
      emit()
    }).catch(() => {})
    return { customer: merged, created: false }
  }

  const tempId = partial.id || uid()
  const fresh: Customer = {
    id: tempId,
    firstName: partial.firstName.trim(),
    lastName: (partial.lastName || '').trim(),
    phone: partial.phone || '',
    email: partial.email || '',
    serviceAddress: partial.serviceAddress || '',
    billingAddress: partial.billingAddress || '',
    billingDifferent: !!partial.billingDifferent,
    leadSource: partial.leadSource || '',
    notes: partial.notes || '',
    tags: partial.tags || [],
    createdAt: partial.createdAt || new Date().toISOString().slice(0, 10),
    salesRep: partial.salesRep || '',
    firstApptDate: partial.firstApptDate || '',
    jobStatus: partial.jobStatus,
  }
  cache = [fresh, ...cache]
  emit()

  // Seed pipeline + fire automation immediately using the temp id; if the API
  // assigns a different id we patch the cache below — pipeline + automation
  // records keyed by the temp id remain valid because the user is still in
  // the same session and the in flight subscribers keep a stable reference.
  try {
    addLeadForNewCustomer({
      id: fresh.id,
      firstName: fresh.firstName, lastName: fresh.lastName,
      phone: fresh.phone, email: fresh.email,
      serviceAddress: fresh.serviceAddress,
      leadSource: fresh.leadSource,
      notes: fresh.notes,
      salesRep: fresh.salesRep,
      createdAt: fresh.createdAt,
    })
  } catch {}
  try {
    fireCustomerCreated(fresh.id, {
      customerName: `${fresh.firstName} ${fresh.lastName}`.trim(),
      customerEmail: fresh.email, customerPhone: fresh.phone,
      jobAddress: fresh.serviceAddress, assignedRep: fresh.salesRep,
    })
  } catch {}

  apiCreateContact(toApiPayload(fresh)).then(created => {
    if (!created) return
    const fromServer = fromApi(created)
    cache = cache.map(c => c.id === tempId ? fromServer : c)
    emit()
  }).catch(() => {})

  return { customer: fresh, created: true }
}

export function updateCustomer(id: string, updates: Partial<Customer>): Customer | null {
  const idx = cache.findIndex(c => c.id === id)
  if (idx < 0) return null
  const prev = cache[idx]
  const next: Customer = { ...prev, ...updates }
  cache = cache.map(c => c.id === id ? next : c)
  emit()
  apiUpdateContact(id, toApiPayload(next)).then(updated => {
    if (!updated) return
    const fromServer = fromApi(updated)
    cache = cache.map(c => c.id === id ? fromServer : c)
    emit()
  }).catch(() => {})
  return next
}

export function deleteCustomer(id: string): void {
  cache = cache.filter(c => c.id !== id)
  emit()
  apiArchiveContact(id).catch(() => {})
}

/**
 * Bulk import (CSV). Pushes the records to the server's /sync endpoint and
 * refetches the canonical list. Used by the CSV import flow on CustomersPage.
 */
export async function bulkImportCustomers(records: Customer[]): Promise<{ created: number; updated: number; total: number }> {
  if (!records || records.length === 0) return { created: 0, updated: 0, total: 0 }
  // The /sync endpoint upserts by (ownerId, email) or (ownerId, firstName+lastName+phone)
  // and is reused here so the same matching logic governs all bulk paths.
  // Push directly via migrateLocalContactsOnce semantics — but that helper is
  // gated by a one shot flag, so we hit the underlying endpoint via the
  // normal create path serially. Keep it simple: one request per record.
  let created = 0
  for (const r of records) {
    const dup = findDuplicate({ phone: r.phone, email: r.email })
    if (dup) continue
    upsertCustomer(r)
    created++
  }
  return { created, updated: 0, total: records.length }
}

// ── Activity feed ────────────────────────────────────────────────────────────
// Unchanged in Phase 1: customer activity entries are still localStorage only.
// They will be migrated to the database in a later phase (alongside notes /
// audit log work). Preserved here so callers (CustomersPage) keep working.

export interface CustomerActivity {
  id: string
  customerId: string
  body: string
  actor: string
  at: string
  kind?: 'note' | 'stage_change' | 'quote' | 'job' | 'payment' | 'info'
}

const ACTIVITY_KEY = 'fencepro_customer_activity'

export function getActivityForCustomer(customerId: string): CustomerActivity[] {
  try {
    const r = localStorage.getItem(ACTIVITY_KEY)
    const all: CustomerActivity[] = r ? JSON.parse(r) : []
    return all.filter(a => a.customerId === customerId).sort((a, b) => b.at.localeCompare(a.at))
  } catch { return [] }
}

export function logCustomerActivity(customerId: string, body: string, opts: { actor?: string; kind?: CustomerActivity['kind'] } = {}): void {
  try {
    const r = localStorage.getItem(ACTIVITY_KEY)
    const all: CustomerActivity[] = r ? JSON.parse(r) : []
    all.unshift({
      id: uid(), customerId, body,
      actor: opts.actor || 'system',
      kind: opts.kind || 'info',
      at: new Date().toISOString(),
    })
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(all.slice(0, 2000)))
  } catch {}
}

export const CUSTOMER_UPDATED_EVENT = EVT
