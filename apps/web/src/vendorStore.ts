/**
 * Vendor & Accounts Payable Store
 *
 * All amounts in cents (integer). Backed by /api/vendor-state (singleton
 * per CrmAccount). The legacy fencepro_vendors / fencepro_vendor_bills /
 * fencepro_vendor_payments localStorage trio is migrated on first login
 * post Phase 7 and then dropped.
 */

import { getAccessToken } from './crmAuth'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '')
const VENDOR_EVT = 'fencepro:vendors:updated'
const VENDOR_MIGRATION_FLAG = 'fencepro_vendors_db_migrated_v1'

interface VendorStateBlob { vendors: any[]; bills: any[]; payments: any[] }

let vendorCache: VendorStateBlob = { vendors: [], bills: [], payments: [] }
let vendorInitPromise: Promise<void> | null = null
let vendorFlushTimer: ReturnType<typeof setTimeout> | null = null

async function vendorCall<T>(method: string, body?: unknown): Promise<{ ok: boolean; data?: T }> {
  const token = getAccessToken()
  if (!token) return { ok: false }
  try {
    const res = await fetch(`${AUTH_API}/api/vendor-state`, {
      method,
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) return { ok: false }
    const json = await res.json().catch(() => ({}))
    if (!json?.success) return { ok: false }
    return { ok: true, data: json.data as T }
  } catch { return { ok: false } }
}

function vendorEmit() { try { window.dispatchEvent(new CustomEvent(VENDOR_EVT)) } catch {} }
function vendorScheduleFlush() {
  if (vendorFlushTimer) clearTimeout(vendorFlushTimer)
  vendorFlushTimer = setTimeout(() => {
    vendorFlushTimer = null
    vendorCall('PUT', vendorCache).catch(() => {})
  }, 250)
}

async function migrateLocalVendorsOnce(): Promise<void> {
  if (localStorage.getItem(VENDOR_MIGRATION_FLAG) === '1') return
  const token = getAccessToken()
  if (!token) return
  try {
    const blob: VendorStateBlob = {
      vendors: JSON.parse(localStorage.getItem('fencepro_vendors') || '[]'),
      bills: JSON.parse(localStorage.getItem('fencepro_vendor_bills') || '[]'),
      payments: JSON.parse(localStorage.getItem('fencepro_vendor_payments') || '[]'),
    }
    const hasData = blob.vendors.length || blob.bills.length || blob.payments.length
    if (hasData) {
      const r = await vendorCall<VendorStateBlob>('PUT', blob)
      if (r.ok) localStorage.setItem(VENDOR_MIGRATION_FLAG, '1')
    } else {
      localStorage.setItem(VENDOR_MIGRATION_FLAG, '1')
    }
  } catch {}
}

export function initVendors(): Promise<void> {
  if (vendorInitPromise) return vendorInitPromise
  vendorInitPromise = (async () => {
    try { await migrateLocalVendorsOnce() } catch {}
    const r = await vendorCall<VendorStateBlob>('GET')
    if (r.ok && r.data) {
      vendorCache = {
        vendors: Array.isArray(r.data.vendors) ? r.data.vendors : [],
        bills: Array.isArray(r.data.bills) ? r.data.bills : [],
        payments: Array.isArray(r.data.payments) ? r.data.payments : [],
      }
      vendorEmit()
    }
    try {
      localStorage.removeItem('fencepro_vendors')
      localStorage.removeItem('fencepro_vendor_bills')
      localStorage.removeItem('fencepro_vendor_payments')
    } catch {}
  })()
  return vendorInitPromise
}

export const VENDORS_UPDATED_EVENT = VENDOR_EVT

const uid = () => Math.random().toString(36).slice(2, 10)

// ── Types ──

export type PaymentTerms = 'net_15' | 'net_30' | 'net_45' | 'net_60' | 'due_on_receipt' | 'custom'

export interface VendorContact {
  id: string
  name: string
  contactName: string
  phone: string
  email: string
  address: string
  city: string
  state: string
  zip: string
  paymentTerms: PaymentTerms
  accountNumber: string
  notes: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type VendorBillStatus = 'draft' | 'received' | 'approved' | 'scheduled' | 'paid' | 'overdue' | 'void'
export type VendorBillCategory = 'materials' | 'labor' | 'equipment' | 'overhead' | 'subcontractor' | 'utilities' | 'insurance' | 'other'
export type VendorPaymentMethod = 'check' | 'ach' | 'wire' | 'credit_card' | 'cash' | 'other'

export interface VendorBillLineItem {
  id: string
  description: string
  quantity: number
  unitCostCents: number
  totalCents: number
  sortOrder: number
}

export interface VendorBill {
  id: string
  vendorId: string
  vendorName: string
  billNumber: string
  description: string
  status: VendorBillStatus
  lineItems: VendorBillLineItem[]
  subtotalCents: number
  taxCents: number
  totalCents: number
  amountPaidCents: number
  balanceDueCents: number
  billDate: string
  dueDate: string
  paidAt?: string
  paymentMethod?: VendorPaymentMethod
  referenceNumber?: string
  category: VendorBillCategory
  jobId?: string
  jobName?: string
  notes: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

export interface VendorPayment {
  id: string
  billId: string
  billNumber: string
  vendorId: string
  vendorName: string
  amountCents: number
  paymentMethod: VendorPaymentMethod
  referenceNumber: string
  paymentDate: string
  recordedBy: string
  notes: string
  createdAt: string
}

// ── Vendors ──

export function getVendors(): VendorContact[] {
  return vendorCache.vendors as VendorContact[]
}
function saveVendors(v: VendorContact[]) {
  vendorCache.vendors = v
  vendorEmit()
  vendorScheduleFlush()
}

export function getVendorById(id: string): VendorContact | null {
  return getVendors().find(v => v.id === id) || null
}

export function createVendor(data: Omit<VendorContact, 'id' | 'createdAt' | 'updatedAt'>): VendorContact {
  const v: VendorContact = { ...data, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  const all = getVendors()
  all.unshift(v)
  saveVendors(all)
  return v
}

export function updateVendor(id: string, updates: Partial<VendorContact>): VendorContact | null {
  const all = getVendors()
  const idx = all.findIndex(v => v.id === id)
  if (idx < 0) return null
  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() }
  saveVendors(all)
  return all[idx]
}

export function deleteVendor(id: string): void {
  saveVendors(getVendors().filter(v => v.id !== id))
}

// ── Vendor Bills ──

export function getBills(): VendorBill[] {
  return vendorCache.bills as VendorBill[]
}
function saveBills(b: VendorBill[]) {
  vendorCache.bills = b
  vendorEmit()
  vendorScheduleFlush()
}

export function getBillsForVendor(vendorId: string): VendorBill[] {
  return getBills().filter(b => b.vendorId === vendorId)
}

export function getBillById(id: string): VendorBill | null {
  return getBills().find(b => b.id === id) || null
}

export function getBillsForJob(jobId: string): VendorBill[] {
  return getBills().filter(b => b.jobId === jobId)
}

export function createBill(data: Omit<VendorBill, 'id' | 'createdAt' | 'updatedAt' | 'balanceDueCents'>): VendorBill {
  const bill: VendorBill = {
    ...data,
    id: uid(),
    balanceDueCents: data.totalCents - data.amountPaidCents,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const all = getBills()
  all.unshift(bill)
  saveBills(all)
  return bill
}

export function updateBill(id: string, updates: Partial<VendorBill>): VendorBill | null {
  const all = getBills()
  const idx = all.findIndex(b => b.id === id)
  if (idx < 0) return null
  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() }
  all[idx].balanceDueCents = all[idx].totalCents - all[idx].amountPaidCents
  if (all[idx].amountPaidCents >= all[idx].totalCents && all[idx].totalCents > 0) {
    all[idx].status = 'paid'
    all[idx].paidAt = all[idx].paidAt || new Date().toISOString()
  }
  saveBills(all)
  return all[idx]
}

export function deleteBill(id: string): void {
  saveBills(getBills().filter(b => b.id !== id))
}

/** Auto-flag overdue bills. Call on page load. */
export function refreshOverdueBills(): void {
  const now = new Date()
  const all = getBills()
  let changed = false
  for (const b of all) {
    if (b.status === 'scheduled' || b.status === 'approved' || b.status === 'received') {
      if (b.balanceDueCents > 0 && new Date(b.dueDate) < now) {
        b.status = 'overdue'
        changed = true
      }
    }
  }
  if (changed) saveBills(all)
}

// ── Vendor Payments ──

export function getVendorPayments(): VendorPayment[] {
  return vendorCache.payments as VendorPayment[]
}
function saveVendorPayments(p: VendorPayment[]) {
  vendorCache.payments = p
  vendorEmit()
  vendorScheduleFlush()
}

export function getPaymentsForBill(billId: string): VendorPayment[] {
  return getVendorPayments().filter(p => p.billId === billId)
}

export function getPaymentsForVendor(vendorId: string): VendorPayment[] {
  return getVendorPayments().filter(p => p.vendorId === vendorId)
}

export function recordVendorPayment(data: Omit<VendorPayment, 'id' | 'createdAt'>): VendorPayment {
  const p: VendorPayment = { ...data, id: uid(), createdAt: new Date().toISOString() }
  const all = getVendorPayments()
  all.unshift(p)
  saveVendorPayments(all)
  const bill = getBillById(data.billId)
  if (bill) updateBill(bill.id, { amountPaidCents: bill.amountPaidCents + data.amountCents })
  return p
}

// ── Aging Summary ──

export interface VendorAgingBucket {
  vendorId: string
  vendorName: string
  current: number
  d1to30: number
  d31to60: number
  d61to90: number
  d90plus: number
  total: number
}

export function getVendorAging(): VendorAgingBucket[] {
  refreshOverdueBills()
  const bills = getBills().filter(b => b.status !== 'void' && b.status !== 'paid' && b.balanceDueCents > 0)
  const now = new Date()
  const byVendor = new Map<string, VendorAgingBucket>()
  for (const b of bills) {
    const due = new Date(b.dueDate)
    const days = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))
    const bucket = byVendor.get(b.vendorId) || {
      vendorId: b.vendorId, vendorName: b.vendorName,
      current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0, total: 0,
    }
    if (days <= 0) bucket.current += b.balanceDueCents
    else if (days <= 30) bucket.d1to30 += b.balanceDueCents
    else if (days <= 60) bucket.d31to60 += b.balanceDueCents
    else if (days <= 90) bucket.d61to90 += b.balanceDueCents
    else bucket.d90plus += b.balanceDueCents
    bucket.total += b.balanceDueCents
    byVendor.set(b.vendorId, bucket)
  }
  return Array.from(byVendor.values()).sort((a, b) => b.total - a.total)
}

export interface APSummary {
  totalOutstandingCents: number
  totalOverdueCents: number
  dueThisWeekCents: number
  dueThisMonthCents: number
  paidYtdCents: number
}

export function getAPSummary(): APSummary {
  refreshOverdueBills()
  const bills = getBills()
  const now = new Date()
  const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const yearStart = new Date(now.getFullYear(), 0, 1)

  let outstanding = 0, overdue = 0, dueWeek = 0, dueMonth = 0, paidYtd = 0
  for (const b of bills) {
    if (b.status === 'void') continue
    if (b.balanceDueCents > 0) {
      outstanding += b.balanceDueCents
      const due = new Date(b.dueDate)
      if (due < now) overdue += b.balanceDueCents
      if (due >= now && due <= weekEnd) dueWeek += b.balanceDueCents
      if (due >= now && due <= monthEnd) dueMonth += b.balanceDueCents
    }
    if (b.paidAt && new Date(b.paidAt) >= yearStart) paidYtd += b.amountPaidCents
  }
  return {
    totalOutstandingCents: outstanding,
    totalOverdueCents: overdue,
    dueThisWeekCents: dueWeek,
    dueThisMonthCents: dueMonth,
    paidYtdCents: paidYtd,
  }
}

// ── P&L feed: aggregate bill totals by month/category ──

export interface MonthlyBillAgg {
  year: number
  month: number // 1-12
  category: VendorBillCategory
  totalCents: number
}

export function aggregateBillsByMonthCategory(fromDate: Date, toDate: Date): MonthlyBillAgg[] {
  const bills = getBills().filter(b => b.status !== 'void')
  const out = new Map<string, MonthlyBillAgg>()
  for (const b of bills) {
    const d = new Date(b.billDate)
    if (d < fromDate || d > toDate) continue
    const key = `${d.getFullYear()}-${d.getMonth() + 1}-${b.category}`
    const existing = out.get(key) || { year: d.getFullYear(), month: d.getMonth() + 1, category: b.category, totalCents: 0 }
    existing.totalCents += b.totalCents
    out.set(key, existing)
  }
  return Array.from(out.values())
}
