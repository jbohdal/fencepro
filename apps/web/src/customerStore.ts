/**
 * Unified customer store — the single source of truth for customer records.
 *
 * Both the Customers page and the Sales Pipeline QuickAdd flow write through
 * this module so we never end up with a lead-without-a-customer.
 */

import { fireCustomerCreated } from './automationTrigger'
import { addLeadForNewCustomer } from './pipelineSeeder'

const KEY = 'fencepro_customers'
const EVT = 'fencepro:customers:updated'

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

export function getCustomers(): Customer[] {
  try { const r = localStorage.getItem(KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}

export function getCustomerById(id: string): Customer | null {
  return getCustomers().find(c => c.id === id) || null
}

/** Find an existing customer by phone or email to avoid duplicates. */
export function findDuplicate(data: { phone?: string; email?: string }): Customer | null {
  const all = getCustomers()
  const phone = (data.phone || '').replace(/\D/g, '')
  const email = (data.email || '').toLowerCase()
  for (const c of all) {
    const cPhone = (c.phone || '').replace(/\D/g, '')
    const cEmail = (c.email || '').toLowerCase()
    if (phone && cPhone && phone === cPhone) return c
    if (email && cEmail && email === cEmail) return c
  }
  return null
}

function saveAll(list: Customer[]) {
  localStorage.setItem(KEY, JSON.stringify(list))
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

/**
 * Upsert a customer. If a row exists (by id, phone, or email), fields are
 * merged onto the existing record (non-empty wins); otherwise a new record
 * is created and seeded into the sales pipeline at First Contact.
 */
export function upsertCustomer(partial: Partial<Customer> & { firstName: string }): { customer: Customer; created: boolean } {
  const all = getCustomers()

  // Match by id first
  let existing = partial.id ? all.find(c => c.id === partial.id) : null
  // Then by phone / email
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
    const updated = all.map(c => c.id === merged.id ? merged : c)
    saveAll(updated)
    return { customer: merged, created: false }
  }

  const fresh: Customer = {
    id: partial.id || uid(),
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
  saveAll([fresh, ...all])

  // Seed pipeline (First Contact) + fire customer_created automation
  try {
    addLeadForNewCustomer({
      id: fresh.id,
      firstName: fresh.firstName,
      lastName: fresh.lastName,
      phone: fresh.phone,
      email: fresh.email,
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

  return { customer: fresh, created: true }
}

export function updateCustomer(id: string, updates: Partial<Customer>): Customer | null {
  const all = getCustomers()
  const idx = all.findIndex(c => c.id === id)
  if (idx < 0) return null
  all[idx] = { ...all[idx], ...updates }
  saveAll(all)
  return all[idx]
}

export function deleteCustomer(id: string): void {
  saveAll(getCustomers().filter(c => c.id !== id))
}

/** Activity feed entry (customer-scoped). */
export interface CustomerActivity {
  id: string
  customerId: string
  body: string
  actor: string           // 'system' | 'automation' | user name
  at: string              // ISO
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
