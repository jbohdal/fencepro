/**
 * Unified customer store — single source of truth for customer records.
 *
 * Backed by /api/crm-contacts (Postgres). The in memory cache is hydrated by
 * initCustomers() once after auth, kept fresh by every save call, and
 * broadcast to listeners via the `fencepro:customers:updated` event.
 *
 * Reads are synchronous (cache lookups). Writes show on screen at once and
 * go through the outbox: kept on the phone until the server confirms them,
 * sent again after no signal, never lost on a reload (see outbox.ts). A new
 * customer and their pipeline card are one save.
 */

import { fireCustomerCreated } from './automationTrigger'
import { leadForNewCustomer } from './pipelineSeeder'
import { legacyMigrationEnabled } from './syncGuard'
import { newId } from './recordSync'
import { registerKind, enqueue, hasPending, reapply, type Op } from './outbox'
import { sendJson } from './syncHttp'
import { addCardWithCustomer, pipelineSavedElsewhere } from './pipelineStore'
import {
  listContacts,
  migrateLocalContactsOnce,
  migrateLocalNotesOnce,
  type CrmContactRecord,
  type CrmContactPayload,
} from './crmContactsApi'
import { cloudStorage } from './cloudStorage'
import { businessDate } from './businessDate'

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
  /** The service address's parts: set by picking a suggestion; read from the address by the server otherwise. */
  city?: string
  state?: string
  zip?: string
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
let hydrated = false

function fromApi(r: CrmContactRecord): Customer {
  return {
    id: r.id,
    firstName: r.firstName,
    lastName: r.lastName,
    phone: r.phone || '',
    email: r.email || '',
    serviceAddress: r.serviceAddress || '',
    city: r.city || '',
    state: r.state || '',
    zip: r.zip || '',
    billingAddress: r.billingAddress || '',
    billingDifferent: !!r.billingDifferent,
    leadSource: r.leadSource || '',
    notes: r.notes || '',
    tags: Array.isArray(r.tags) ? r.tags : [],
    createdAt: businessDate(r.createdAt),
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
    // Not sent when empty: the server reads them from the address.
    city: c.city || undefined,
    state: c.state || undefined,
    zip: c.zip || undefined,
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
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    // Old browser only customers move up only when that is switched on
    // (see legacyMigrationEnabled); otherwise they are left where they are.
    const migrate = legacyMigrationEnabled()
    if (migrate) {
      try {
        const raw = localStorage.getItem(LEGACY_KEY)
        const local = raw ? JSON.parse(raw) : []
        if (Array.isArray(local) && local.length > 0) {
          await migrateLocalContactsOnce(local)
        }
      } catch {}
    }
    const records = await listContacts()
    if (!records) return
    cache = records.map(fromApi)
    hydrated = true
    // Customers added or changed on this phone and not on the server yet.
    reapply('customer.')
    emit()
    if (migrate) {
      try { localStorage.removeItem(LEGACY_KEY) } catch {}
      try { await migrateLocalNotesOnce() } catch {}
    }
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

/** True once customers have loaded from the server. */
export function isCustomersHydrated(): boolean { return hydrated }

/**
 * Pull the customer list again. Used when the server created customers on
 * its own (a website quote, a phone call). Customers with a save still on
 * its way out keep their local copy.
 */
let lastSync: string | null = null
export async function refreshCustomers(): Promise<void> {
  if (!hydrated) return
  // Only what changed since the last read (small on cell data); waiting changes stay on top.
  const r = await sendJson('GET', `/api/crm-contacts${lastSync ? `?since=${encodeURIComponent(lastSync)}` : ''}`)
  if (!r.result.ok || !Array.isArray(r.json?.data)) return
  const rows = r.json.data as Array<CrmContactRecord & { archivedAt?: string | null }>
  if (r.json.partial) {
    if (rows.length) {
      const byId = new Map(cache.map(c => [c.id, c]))
      for (const row of rows) { if (row.archivedAt) byId.delete(row.id); else byId.set(row.id, fromApi(row)) }
      cache = [...byId.values()]
    }
  } else cache = rows.map(fromApi)
  if (typeof r.json.serverTime === 'string') lastSync = r.json.serverTime
  if (!r.json.partial || rows.length) { reapply('customer.'); emit() }
}

/** Read the whole list again: a change was refused, so the screen goes back to what the server has. */
function reloadCustomers() { lastSync = null; void refreshCustomers() }

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
export function upsertCustomer(partial: Partial<Customer> & { firstName: string }, opts: { stage?: string } = {}): { customer: Customer; created: boolean } {
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
      ...partsAfter(existing, partial),
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
    pushCustomerUpdate(merged.id)
    return { customer: merged, created: false }
  }

  // The id chosen here is permanent: the server keeps it, so quotes, jobs and
  // pipeline leads that point at this customer stay valid. A full length id,
  // always: the server does not accept short ones.
  const tempId = partial.id && partial.id.length >= 8 ? partial.id : newId()
  const fresh: Customer = {
    id: tempId,
    firstName: partial.firstName.trim(),
    lastName: (partial.lastName || '').trim(),
    phone: partial.phone || '',
    email: partial.email || '',
    serviceAddress: partial.serviceAddress || '',
    city: partial.city || '',
    state: partial.state || '',
    zip: partial.zip || '',
    billingAddress: partial.billingAddress || '',
    billingDifferent: !!partial.billingDifferent,
    leadSource: partial.leadSource || '',
    notes: partial.notes || '',
    tags: partial.tags || [],
    createdAt: partial.createdAt || businessDate(new Date()),
    salesRep: partial.salesRep || '',
    firstApptDate: partial.firstApptDate || '',
    jobStatus: partial.jobStatus,
  }
  cache = [fresh, ...cache]
  emit()

  // The customer and their First Contact card are one save: both or neither.
  const lead = leadForNewCustomer({
    id: fresh.id,
    firstName: fresh.firstName, lastName: fresh.lastName,
    phone: fresh.phone, email: fresh.email,
    serviceAddress: fresh.serviceAddress,
    leadSource: fresh.leadSource,
    notes: fresh.notes,
    salesRep: fresh.salesRep,
    createdAt: fresh.createdAt,
    stage: opts.stage,
  })
  const leadBefore = lead ? addCardWithCustomer(lead) : null
  void enqueue<CreatePayload>({
    key: `customer:${tempId}`, kind: 'customer.create',
    payload: { customer: fresh, lead, leadBefore },
    label: `${nameOf(fresh)}, new customer`,
  })

  return { customer: fresh, created: true }
}

/**
 * City, state and ZIP after a change: the ones given; the saved ones while the
 * address is the same; none for a new address given without them (the server
 * reads them from the address then).
 */
function partsAfter(prev: Customer, next: Partial<Customer>): Pick<Customer, 'city' | 'state' | 'zip'> {
  if (next.city !== undefined || next.state !== undefined || next.zip !== undefined) {
    return { city: next.city ?? '', state: next.state ?? '', zip: next.zip ?? '' }
  }
  const moved = next.serviceAddress !== undefined && next.serviceAddress.trim() !== (prev.serviceAddress || '').trim()
  return moved ? { city: '', state: '', zip: '' } : { city: prev.city ?? '', state: prev.state ?? '', zip: prev.zip ?? '' }
}

const nameOf = (c: Pick<Customer, 'firstName' | 'lastName'>) => `${c.firstName} ${c.lastName}`.trim() || 'Customer'

interface CreatePayload { customer: Customer; lead: Record<string, unknown> | null; leadBefore: string | null }

/** Send the newest copy of a customer. Goes after its create and earlier edits. */
function pushCustomerUpdate(id: string): void {
  const current = cache.find(c => c.id === id)
  if (!current) return
  void enqueue<Customer>({ key: `customer:${id}`, kind: 'customer.update', payload: current, label: `${nameOf(current)}, changes` })
}

registerKind<CreatePayload>('customer.create', {
  refused: () => reloadCustomers(),
  what: () => 'This customer',
  send: async (op: Op<CreatePayload>) => {
    const { customer, lead, leadBefore } = op.payload
    const r = await sendJson('POST', '/api/crm-contacts', { ...toApiPayload(customer), id: customer.id, ...(lead ? { lead, leadBefore } : {}) })
    if (r.result.ok) pipelineSavedElsewhere(r.json?.pipelineVersion)
    return r.result
  },
  confirmed: (op, data) => {
    const id = op.payload.customer.id
    if (!data || hasPending(`customer:${id}`)) return
    const fromServer = fromApi(data as CrmContactRecord)
    cache = cache.map(c => c.id === id ? { ...fromServer, id } : c)
    emit()
    try {
      fireCustomerCreated(id, {
        customerName: nameOf(fromServer), customerEmail: fromServer.email, customerPhone: fromServer.phone,
        jobAddress: fromServer.serviceAddress, assignedRep: fromServer.salesRep,
      })
    } catch { /* automations are best effort */ }
  },
  apply: op => {
    const c = op.payload.customer
    if (!cache.some(x => x.id === c.id)) cache = [c, ...cache]
  },
})

registerKind<Customer>('customer.update', {
  refused: () => reloadCustomers(),
  what: () => 'This change to the customer',
  send: op => sendJson('PATCH', `/api/crm-contacts/${encodeURIComponent(op.payload.id)}`, toApiPayload(op.payload)).then(r => r.result),
  apply: op => { cache = cache.map(c => c.id === op.payload.id ? op.payload : c) },
})

registerKind<{ id: string; name: string }>('customer.archive', {
  refused: () => reloadCustomers(),
  what: () => 'Removing this customer',
  send: async op => {
    const r = await sendJson('DELETE', `/api/crm-contacts/${encodeURIComponent(op.payload.id)}`)
    // Already gone is what was wanted.
    return r.status === 404 ? { ok: true } : r.result
  },
  apply: op => { cache = cache.filter(c => c.id !== op.payload.id) },
})

export function updateCustomer(id: string, updates: Partial<Customer>): Customer | null {
  const idx = cache.findIndex(c => c.id === id)
  if (idx < 0) return null
  const prev = cache[idx]
  const next: Customer = { ...prev, ...updates, ...partsAfter(prev, updates) }
  cache = cache.map(c => c.id === id ? next : c)
  emit()
  pushCustomerUpdate(id)
  return next
}

export function deleteCustomer(id: string): void {
  const was = cache.find(c => c.id === id)
  cache = cache.filter(c => c.id !== id)
  emit()
  void enqueue({ key: `customer:${id}`, kind: 'customer.archive', payload: { id, name: was ? nameOf(was) : 'Customer' }, label: `${was ? nameOf(was) : 'Customer'}, removed` })
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
    const r = cloudStorage.getItem(ACTIVITY_KEY)
    const all: CustomerActivity[] = r ? JSON.parse(r) : []
    return all.filter(a => a.customerId === customerId).sort((a, b) => b.at.localeCompare(a.at))
  } catch { return [] }
}

export function logCustomerActivity(customerId: string, body: string, opts: { actor?: string; kind?: CustomerActivity['kind'] } = {}): void {
  try {
    const r = cloudStorage.getItem(ACTIVITY_KEY)
    const all: CustomerActivity[] = r ? JSON.parse(r) : []
    all.unshift({
      id: uid(), customerId, body,
      actor: opts.actor || 'system',
      kind: opts.kind || 'info',
      at: new Date().toISOString(),
    })
    cloudStorage.setItem(ACTIVITY_KEY, JSON.stringify(all.slice(0, 2000)))
  } catch {}
}

export const CUSTOMER_UPDATED_EVENT = EVT
