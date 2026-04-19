/**
 * Billing Store — Invoices, Payments, Statements
 *
 * All amounts in cents (integer). localStorage-backed.
 */

const INV_KEY = 'fencepro_invoices'
const PAY_KEY = 'fencepro_payments'
const STMT_KEY = 'fencepro_statements'
const NOTE_KEY = 'fencepro_customer_notes'
const PULL_KEY = 'fencepro_customer_pullsheets'

const uid = () => Math.random().toString(36).slice(2, 10)

// ── Invoices ──

export type InvoiceStatus = 'draft' | 'sent' | 'viewed' | 'partially_paid' | 'paid' | 'overdue' | 'void'

export interface InvoiceLineItem {
  id: string
  description: string
  quantity: number
  unitPriceCents: number
  totalCents: number
  sortOrder: number
}

export interface Invoice {
  id: string
  customerId: string
  customerName: string
  jobId?: string
  jobName?: string
  invoiceNumber: string
  title: string
  status: InvoiceStatus
  lineItems: InvoiceLineItem[]
  subtotalCents: number
  taxRate: number       // e.g., 0.07 = 7%
  taxCents: number
  discountCents: number
  totalCents: number
  amountPaidCents: number
  balanceDueCents: number
  dueDate: string
  issuedDate: string
  sentAt?: string
  paidAt?: string
  voidedAt?: string
  notes: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

let invCounter = 1000

export function getInvoices(): Invoice[] {
  try { const r = localStorage.getItem(INV_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}
function saveInvoices(inv: Invoice[]) { localStorage.setItem(INV_KEY, JSON.stringify(inv)) }

export function getInvoicesForCustomer(customerId: string): Invoice[] {
  return getInvoices().filter(i => i.customerId === customerId)
}

export function getInvoiceById(id: string): Invoice | null {
  return getInvoices().find(i => i.id === id) || null
}

export function nextInvoiceNumber(): string {
  const all = getInvoices()
  const maxNum = all.reduce((max, inv) => {
    const n = parseInt(inv.invoiceNumber.replace('INV-', ''))
    return n > max ? n : max
  }, invCounter)
  return `INV-${maxNum + 1}`
}

export function createInvoice(data: Omit<Invoice, 'id' | 'createdAt' | 'updatedAt' | 'balanceDueCents'>): Invoice {
  const inv: Invoice = {
    ...data,
    id: uid(),
    balanceDueCents: data.totalCents - data.amountPaidCents,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const all = getInvoices()
  all.unshift(inv)
  saveInvoices(all)
  return inv
}

export function updateInvoice(id: string, updates: Partial<Invoice>): Invoice | null {
  const all = getInvoices()
  const idx = all.findIndex(i => i.id === id)
  if (idx < 0) return null
  all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() }
  // Recalc balance
  all[idx].balanceDueCents = all[idx].totalCents - all[idx].amountPaidCents
  // Auto-update status
  if (all[idx].amountPaidCents >= all[idx].totalCents && all[idx].totalCents > 0) {
    all[idx].status = 'paid'
    all[idx].paidAt = all[idx].paidAt || new Date().toISOString()
  } else if (all[idx].amountPaidCents > 0) {
    all[idx].status = 'partially_paid'
  }
  saveInvoices(all)
  return all[idx]
}

// ── Payments ──

export type PaymentMethod = 'cash' | 'check' | 'credit_card' | 'bank_transfer' | 'payment_link' | 'other'

export interface Payment {
  id: string
  invoiceId: string
  invoiceNumber: string
  customerId: string
  customerName: string
  amountCents: number
  paymentMethod: PaymentMethod
  referenceNumber: string
  paymentDate: string
  recordedBy: string
  notes: string
  createdAt: string
}

export function getPayments(): Payment[] {
  try { const r = localStorage.getItem(PAY_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}
function savePayments(pay: Payment[]) { localStorage.setItem(PAY_KEY, JSON.stringify(pay)) }

export function getPaymentsForCustomer(customerId: string): Payment[] {
  return getPayments().filter(p => p.customerId === customerId)
}

export function getPaymentsForInvoice(invoiceId: string): Payment[] {
  return getPayments().filter(p => p.invoiceId === invoiceId)
}

export function recordPayment(data: Omit<Payment, 'id' | 'createdAt'>): Payment {
  const pay: Payment = { ...data, id: uid(), createdAt: new Date().toISOString() }
  const all = getPayments()
  all.unshift(pay)
  savePayments(all)

  // Update invoice
  const inv = getInvoiceById(data.invoiceId)
  if (inv) {
    updateInvoice(inv.id, { amountPaidCents: inv.amountPaidCents + data.amountCents })
  }

  return pay
}

// ── Customer Notes ──

export interface CustomerNote {
  id: string
  customerId: string
  body: string
  isPinned: boolean
  visibility: 'internal' | 'all_staff'
  createdBy: string
  createdAt: string
  updatedAt: string
  deletedAt?: string
}

export function getNotesForCustomer(customerId: string): CustomerNote[] {
  try {
    const r = localStorage.getItem(NOTE_KEY)
    const all: CustomerNote[] = r ? JSON.parse(r) : []
    return all.filter(n => n.customerId === customerId && !n.deletedAt)
      .sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1
        if (!a.isPinned && b.isPinned) return 1
        return b.createdAt.localeCompare(a.createdAt)
      })
  } catch { return [] }
}

function saveNotes(notes: CustomerNote[]) { localStorage.setItem(NOTE_KEY, JSON.stringify(notes)) }
function getAllNotes(): CustomerNote[] {
  try { const r = localStorage.getItem(NOTE_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}

export function createNote(data: Omit<CustomerNote, 'id' | 'createdAt' | 'updatedAt'>): CustomerNote {
  const note: CustomerNote = { ...data, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  const all = getAllNotes()
  all.push(note)
  saveNotes(all)
  return note
}

export function updateNote(id: string, updates: Partial<CustomerNote>): void {
  const all = getAllNotes()
  const idx = all.findIndex(n => n.id === id)
  if (idx >= 0) { all[idx] = { ...all[idx], ...updates, updatedAt: new Date().toISOString() }; saveNotes(all) }
}

export function deleteNote(id: string): void {
  const all = getAllNotes()
  const idx = all.findIndex(n => n.id === id)
  if (idx >= 0) { all[idx].deletedAt = new Date().toISOString(); saveNotes(all) }
}

// ── Customer Pull Sheets ──

export interface CustomerPullSheet {
  id: string
  customerId: string
  customerName: string
  jobId?: string
  jobName?: string
  quoteId: string
  quoteName: string
  versionSnapshot: any // LineItem[] snapshot
  versionNumber: number
  linkedAt: string
  linkedBy: string
}

export function getPullSheetsForCustomer(customerId: string): CustomerPullSheet[] {
  try {
    const r = localStorage.getItem(PULL_KEY)
    const all: CustomerPullSheet[] = r ? JSON.parse(r) : []
    return all.filter(ps => ps.customerId === customerId).sort((a, b) => b.linkedAt.localeCompare(a.linkedAt))
  } catch { return [] }
}

function getAllPullSheets(): CustomerPullSheet[] {
  try { const r = localStorage.getItem(PULL_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}

export function linkPullSheetToCustomer(data: Omit<CustomerPullSheet, 'id'>): CustomerPullSheet {
  const ps: CustomerPullSheet = { ...data, id: uid() }
  const all = getAllPullSheets()
  all.unshift(ps)
  localStorage.setItem(PULL_KEY, JSON.stringify(all))
  return ps
}

// ── Billing Summary for a Customer ──

export interface BillingSummary {
  totalBilledCents: number
  totalPaidCents: number
  outstandingCents: number
  overdueCents: number
  lastPaymentDate: string | null
  lastPaymentAmountCents: number
  invoiceCount: number
  agingCurrent: number
  aging1to30: number
  aging31to60: number
  aging61to90: number
  aging90plus: number
}

export function getBillingSummary(customerId: string): BillingSummary {
  const invoices = getInvoicesForCustomer(customerId)
  const payments = getPaymentsForCustomer(customerId)

  const now = new Date()
  let totalBilled = 0, totalPaid = 0, outstanding = 0, overdue = 0
  let agingCurrent = 0, aging1to30 = 0, aging31to60 = 0, aging61to90 = 0, aging90plus = 0

  for (const inv of invoices) {
    if (inv.status === 'void') continue
    totalBilled += inv.totalCents
    totalPaid += inv.amountPaidCents
    const balance = inv.balanceDueCents
    if (balance <= 0) continue
    outstanding += balance

    const due = new Date(inv.dueDate)
    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / (1000 * 60 * 60 * 24))

    if (daysOverdue <= 0) agingCurrent += balance
    else if (daysOverdue <= 30) { aging1to30 += balance; overdue += balance }
    else if (daysOverdue <= 60) { aging31to60 += balance; overdue += balance }
    else if (daysOverdue <= 90) { aging61to90 += balance; overdue += balance }
    else { aging90plus += balance; overdue += balance }
  }

  const lastPayment = payments.sort((a, b) => b.paymentDate.localeCompare(a.paymentDate))[0]

  return {
    totalBilledCents: totalBilled,
    totalPaidCents: totalPaid,
    outstandingCents: outstanding,
    overdueCents: overdue,
    lastPaymentDate: lastPayment?.paymentDate || null,
    lastPaymentAmountCents: lastPayment?.amountCents || 0,
    invoiceCount: invoices.filter(i => i.status !== 'void').length,
    agingCurrent, aging1to30, aging31to60, aging61to90, aging90plus,
  }
}

// ── AR Summary (all customers) ──

export function getARSummary(): { customerId: string; customerName: string; summary: BillingSummary }[] {
  const invoices = getInvoices().filter(i => i.status !== 'void')
  const customerIds = [...new Set(invoices.map(i => i.customerId))]
  return customerIds.map(id => ({
    customerId: id,
    customerName: invoices.find(i => i.customerId === id)?.customerName || 'Unknown',
    summary: getBillingSummary(id),
  })).filter(r => r.summary.outstandingCents > 0)
    .sort((a, b) => b.summary.outstandingCents - a.summary.outstandingCents)
}
