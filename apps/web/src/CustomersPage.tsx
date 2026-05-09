import { useState, useCallback, useEffect } from 'react'
import {
  getInvoicesForCustomer, createInvoice, recordPayment,
  getPaymentsForCustomer, getBillingSummary, getPullSheetsForCustomer,
  nextInvoiceNumber,
  type Invoice, type Payment,
} from './billingStore'
import { toast } from './toast'
import CustomerPhotosTab from './CustomerPhotosTab'
import CustomerFilesTab from './CustomerFilesTab'
import CustomerMessagesTab from './CustomerMessagesTab'
import QuoteDetailDrawer from './QuoteDetailDrawer'
import type { SavedQuote } from './QuotesPage'
import FileViewerModal, { type CustomerFileShape } from './FileViewerModal'
import { getPortalAccessStatus, loadAccountsSoon, sendPortalInvite, resendPortalInvite, buildActivationLink } from './portalAccountStore'
import { getEmailTemplate, renderTemplate } from './emailTemplatesStore'
import { logCustomerActivity, getCustomers, upsertCustomer, deleteCustomer as storeDeleteCustomer, bulkImportCustomers } from './customerStore'
import { getQuotes } from './quoteStore'
import {
  listContactNotes, createContactNote, updateContactNote, deleteContactNote,
  type CrmContactNoteRecord,
} from './crmContactsApi'

interface Customer {
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

interface ImportedQuote {
  id: string
  customerId: string
  projectType: string
  sections: number
  mhQuoted: number
  tearOut: boolean
  quotedPrice: number
  laborBid: number
  depositAmt: number
  salesRep: string
  soldDate: string
  firstApptDate: string
}

interface Quote {
  id: string
  customerId: string
  type: string
  sections: number
  price: number
  margin: number
  status: 'DRAFT' | 'SENT' | 'SOLD' | 'LOST'
  date: string
}

interface Job {
  id: string
  customerId: string
  type: string
  sections: number
  value: number
  stage: string
  scheduledDate: string
}

interface CustomerFile {
  id: string
  customerId: string
  name: string
  size: string
  type: string
  uploadedAt: string
}

const LEAD_SOURCES = [
  'Google', 'Facebook', 'Instagram', 'Yard Sign', 'Referral',
  'Door Hanger', 'Repeat Customer', 'Nextdoor', 'Other'
]

const TAG_OPTIONS = [
  'Residential', 'Commercial', 'HOA', 'Multi-Family',
  'Agricultural', 'Industrial', 'VIP', 'Warranty'
]

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT:  'bg-blue-100 text-blue-700',
  SOLD:  'bg-green-100 text-green-700',
  LOST:  'bg-red-100 text-red-700',
}

const STAGE_COLORS: Record<string, string> = {
  SOLD:               'bg-blue-100 text-blue-800',
  MATERIALS_ORDERED:  'bg-yellow-100 text-yellow-800',
  MATERIALS_RECEIVED: 'bg-orange-100 text-orange-800',
  SCHEDULED:          'bg-green-100 text-green-800',
  IN_PROGRESS:        'bg-purple-100 text-purple-800',
  COMPLETE:           'bg-gray-100 text-gray-600',
}

const STAGE_LABELS: Record<string, string> = {
  SOLD:               'Sold',
  MATERIALS_ORDERED:  'Materials Ordered',
  MATERIALS_RECEIVED: 'Materials Ready',
  SCHEDULED:          'Scheduled',
  IN_PROGRESS:        'In Progress',
  COMPLETE:           'Complete',
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const uid = () => Math.random().toString(36).slice(2, 9)

const SAMPLE_QUOTES: Quote[] = [
  { id: 'q1', customerId: 'c1', type: "CL - 6' Black", sections: 23, price: 6025, margin: 0.64, status: 'SENT', date: '2025-03-01' },
  { id: 'q2', customerId: 'c2', type: "WV-ND 6'x6'", sections: 68, price: 18400, margin: 0.66, status: 'SOLD', date: '2025-02-10' },
  { id: 'q3', customerId: 'c3', type: "Alum - ND - Emily - 48", sections: 24, price: 5743, margin: 0.63, status: 'SOLD', date: '2025-02-20' },
]

const SAMPLE_JOBS: Job[] = [
  { id: 'j1', customerId: 'c2', type: 'Vinyl', sections: 68, value: 18400, stage: 'SCHEDULED', scheduledDate: '2025-04-12' },
  { id: 'j2', customerId: 'c3', type: 'Aluminum', sections: 24, value: 5743, stage: 'COMPLETE', scheduledDate: '2025-03-08' },
]

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <span className="text-3xl">👥</span>
        </div>
        <h3 className="font-bold text-gray-900 mb-1">No customer selected</h3>
        <p className="text-sm text-gray-400 mb-4">Select a customer from the list or create a new one</p>
        <button onClick={onNew} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg">
          + New Customer
        </button>
      </div>
    </div>
  )
}

// ── Customer Form ─────────────────────────────────────────────────────────────

function CustomerForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<Customer>
  onSave: (c: Customer) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<Customer>({
    id: initial?.id ?? uid(),
    firstName: initial?.firstName ?? '',
    lastName: initial?.lastName ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    serviceAddress: initial?.serviceAddress ?? '',
    billingAddress: initial?.billingAddress ?? '',
    billingDifferent: initial?.billingDifferent ?? false,
    leadSource: initial?.leadSource ?? '',
    notes: initial?.notes ?? '',
    tags: initial?.tags ?? [],
    createdAt: initial?.createdAt ?? new Date().toISOString().slice(0, 10),
    salesRep: initial?.salesRep ?? '',
    firstApptDate: initial?.firstApptDate ?? '',
    jobStatus: initial?.jobStatus ?? '',
  })

  function toggle(tag: string) {
    setForm(f => ({
      ...f,
      tags: f.tags.includes(tag) ? f.tags.filter(t => t !== tag) : [...f.tags, tag],
    }))
  }

  const canSave = form.firstName.trim() && form.lastName.trim()

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="px-8 py-6 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{initial?.id ? 'Edit Customer' : 'New Customer'}</h2>
          <p className="text-sm text-gray-400 mt-0.5">Fill in the details below</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onCancel} className="border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button
            disabled={!canSave}
            onClick={() => onSave(form)}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-semibold px-4 py-2 rounded-lg"
          >
            Save Customer
          </button>
        </div>
      </div>

      <div className="px-8 py-6 space-y-8 max-w-2xl">
        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Contact Info</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">First Name</label>
              <input autoFocus className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Last Name</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Phone</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="(352) 555-0100" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Email</label>
              <input type="email" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="name@email.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Addresses</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Service Address — where the fence is being installed</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="1349 SE 32nd St, Ocala, FL 34470"
                value={form.serviceAddress}
                onChange={e => setForm(f => ({ ...f, serviceAddress: e.target.value }))}
              />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="billingDiff" checked={form.billingDifferent} onChange={e => setForm(f => ({ ...f, billingDifferent: e.target.checked }))} className="accent-orange-500" />
              <label htmlFor="billingDiff" className="text-sm text-gray-600">Billing address is different from service address</label>
            </div>
            {form.billingDifferent && (
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Billing Address</label>
                <input
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Billing address (street, city, state zip)"
                  value={form.billingAddress}
                  onChange={e => setForm(f => ({ ...f, billingAddress: e.target.value }))}
                />
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Lead Source</h3>
          <div className="flex flex-wrap gap-2">
            {LEAD_SOURCES.map(src => (
              <button key={src} onClick={() => setForm(f => ({ ...f, leadSource: f.leadSource === src ? '' : src }))} className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${form.leadSource === src ? 'bg-orange-500 border-orange-500 text-white' : 'border-gray-200 text-gray-600 hover:border-orange-300'}`}>{src}</button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Tags</h3>
          <div className="flex flex-wrap gap-2">
            {TAG_OPTIONS.map(tag => (
              <button key={tag} onClick={() => toggle(tag)} className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${form.tags.includes(tag) ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>{tag}</button>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Sales Info</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Sales Rep</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="e.g. jb" value={form.salesRep} onChange={e => setForm(f => ({ ...f, salesRep: e.target.value }))} />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">First Appointment Date</label>
              <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={form.firstApptDate} onChange={e => setForm(f => ({ ...f, firstApptDate: e.target.value }))} />
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Notes</h3>
          <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" rows={4} placeholder="HOA requirements, gate swing direction, dog fence, access notes..." value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>
      </div>
    </div>
  )
}

// ── Customer Billing Tab ─────────────────────────────────────────────────────

function CustomerBillingTab({ customerId, customerName, customerEmail }: { customerId: string; customerName: string; customerEmail: string }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [showCreateInvoice, setShowCreateInvoice] = useState(false)
  const [showPayment, setShowPayment] = useState<string | null>(null) // invoiceId
  const [sub, setSub] = useState<'overview' | 'invoices' | 'payments'>('overview')

  const load = useCallback(() => {
    setInvoices(getInvoicesForCustomer(customerId))
    setPayments(getPaymentsForCustomer(customerId))
  }, [customerId])
  useEffect(() => { load() }, [load])

  const summary = getBillingSummary(customerId)
  const fmtD = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-700', viewed: 'bg-sky-100 text-sky-700',
    partially_paid: 'bg-yellow-100 text-yellow-700', paid: 'bg-green-100 text-green-700',
    overdue: 'bg-red-100 text-red-700', void: 'bg-gray-100 text-gray-400',
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
        Billing data (invoices and payments) is migrating to the cloud (Phase 9). Anything you create or record here is stored locally in this browser only and will not be visible to teammates until the migration completes.
      </div>
      {/* Sub-nav */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 w-fit">
        {(['overview', 'invoices', 'payments'] as const).map(t => (
          <button key={t} onClick={() => setSub(t)} className={`px-3 py-1.5 rounded-md text-xs font-medium capitalize transition ${sub === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{t}</button>
        ))}
      </div>

      {sub === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Total Billed</p><p className="text-lg font-bold text-gray-900">{fmtD(summary.totalBilledCents)}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Paid</p><p className="text-lg font-bold text-green-600">{fmtD(summary.totalPaidCents)}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Outstanding</p><p className="text-lg font-bold text-orange-600">{fmtD(summary.outstandingCents)}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Overdue</p><p className="text-lg font-bold text-red-600">{fmtD(summary.overdueCents)}</p></div>
            <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Invoices</p><p className="text-lg font-bold text-gray-900">{summary.invoiceCount}</p></div>
          </div>
          {/* Aging */}
          <div className="bg-white rounded-2xl border border-gray-200 p-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-3">Aging Summary</h3>
            <div className="grid grid-cols-5 gap-2 text-center text-sm">
              <div><p className="text-xs text-gray-400">Current</p><p className="font-semibold text-green-600">{fmtD(summary.agingCurrent)}</p></div>
              <div><p className="text-xs text-gray-400">1-30d</p><p className="font-semibold text-yellow-600">{fmtD(summary.aging1to30)}</p></div>
              <div><p className="text-xs text-gray-400">31-60d</p><p className="font-semibold text-orange-600">{fmtD(summary.aging31to60)}</p></div>
              <div><p className="text-xs text-gray-400">61-90d</p><p className="font-semibold text-red-600">{fmtD(summary.aging61to90)}</p></div>
              <div><p className="text-xs text-gray-400">90+</p><p className="font-semibold text-red-700">{fmtD(summary.aging90plus)}</p></div>
            </div>
          </div>
        </div>
      )}

      {sub === 'invoices' && (
        <div className="space-y-3">
          <div className="flex justify-between">
            <p className="text-sm text-gray-500">{invoices.length} invoice{invoices.length !== 1 ? 's' : ''}</p>
            <button onClick={() => setShowCreateInvoice(true)} className="bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium">+ Create Invoice</button>
          </div>
          {invoices.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No invoices yet</div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-50">
              {invoices.map(inv => (
                <div key={inv.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{inv.invoiceNumber} — {inv.title}</p>
                    <p className="text-xs text-gray-500">Due: {inv.dueDate} {inv.jobName ? `· Job: ${inv.jobName}` : ''}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-sm font-semibold text-gray-900">{fmtD(inv.totalCents)}</p>
                      {inv.balanceDueCents > 0 && <p className="text-xs text-red-600">Due: {fmtD(inv.balanceDueCents)}</p>}
                    </div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[inv.status] || 'bg-gray-100 text-gray-600'}`}>{inv.status}</span>
                    {inv.balanceDueCents > 0 && inv.status !== 'void' && (
                      <button onClick={() => setShowPayment(inv.id)} className="text-xs text-blue-600 hover:text-blue-800">Record Payment</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {sub === 'payments' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">{payments.length} payment{payments.length !== 1 ? 's' : ''}</p>
          {payments.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No payments recorded yet</div>
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-50">
              {payments.map(pay => (
                <div key={pay.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{fmtD(pay.amountCents)}</p>
                    <p className="text-xs text-gray-500">{pay.paymentDate} · {pay.paymentMethod} · Inv: {pay.invoiceNumber}</p>
                  </div>
                  {pay.referenceNumber && <span className="text-xs text-gray-400">Ref: {pay.referenceNumber}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Invoice Modal */}
      {showCreateInvoice && (
        <CreateInvoiceModal customerId={customerId} customerName={customerName} onClose={() => setShowCreateInvoice(false)} onCreated={() => { setShowCreateInvoice(false); load() }} />
      )}

      {/* Record Payment Modal */}
      {showPayment && (
        <RecordPaymentModal invoiceId={showPayment} customerId={customerId} customerName={customerName} onClose={() => setShowPayment(null)} onRecorded={() => { setShowPayment(null); load() }} />
      )}
    </div>
  )
}

function CreateInvoiceModal({ customerId, customerName, onClose, onCreated }: { customerId: string; customerName: string; onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('')
  const [invoiceNumber] = useState(nextInvoiceNumber())
  const [dueDate, setDueDate] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 30); return d.toISOString().slice(0, 10) })
  const [lineItems, setLineItems] = useState<{ desc: string; qty: number; price: number }[]>([{ desc: '', qty: 1, price: 0 }])
  const [taxRate, setTaxRate] = useState(0)
  const [discountCents, setDiscountCents] = useState(0)
  const [notes, setNotes] = useState('')

  const subtotal = lineItems.reduce((s, li) => s + Math.round(li.qty * li.price * 100), 0)
  const tax = Math.round(subtotal * taxRate)
  const total = subtotal + tax - discountCents

  function addLine() { setLineItems([...lineItems, { desc: '', qty: 1, price: 0 }]) }
  function removeLine(i: number) { setLineItems(lineItems.filter((_, idx) => idx !== i)) }
  function updateLine(i: number, field: string, val: any) { setLineItems(lineItems.map((li, idx) => idx === i ? { ...li, [field]: val } : li)) }

  function save() {
    createInvoice({
      customerId, customerName, invoiceNumber, title: title || `Invoice ${invoiceNumber}`,
      status: 'draft',
      lineItems: lineItems.map((li, i) => ({ id: Math.random().toString(36).slice(2), description: li.desc, quantity: li.qty, unitPriceCents: Math.round(li.price * 100), totalCents: Math.round(li.qty * li.price * 100), sortOrder: i })),
      subtotalCents: subtotal, taxRate, taxCents: tax, discountCents, totalCents: total,
      amountPaidCents: 0, dueDate, issuedDate: new Date().toISOString().slice(0, 10),
      notes, createdBy: 'admin',
    })
    onCreated()
  }

  const fmtD = (c: number) => '$' + (c / 100).toFixed(2)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[600px] max-h-[90vh] overflow-y-auto p-5 mx-4 space-y-4">
        <div className="flex justify-between"><h2 className="font-bold text-gray-900 text-lg">Create Invoice</h2><button onClick={onClose} className="text-gray-400 text-xl">×</button></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs text-gray-500 mb-1">Invoice #</label><input value={invoiceNumber} readOnly className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50" /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Due Date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
        </div>
        <div><label className="block text-xs text-gray-500 mb-1">Title</label><input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g., Fence Installation" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>

        <div>
          <div className="flex justify-between mb-2"><label className="text-xs text-gray-500 font-semibold">Line Items</label><button onClick={addLine} className="text-xs text-orange-600">+ Add</button></div>
          {lineItems.map((li, i) => (
            <div key={i} className="flex gap-2 mb-1.5">
              <input value={li.desc} onChange={e => updateLine(i, 'desc', e.target.value)} placeholder="Description" className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
              <input type="number" value={li.qty} onChange={e => updateLine(i, 'qty', parseFloat(e.target.value) || 0)} className="w-16 border border-gray-200 rounded-lg px-2 py-1.5 text-sm text-center" />
              <input type="number" step="0.01" value={li.price} onChange={e => updateLine(i, 'price', parseFloat(e.target.value) || 0)} placeholder="$" className="w-24 border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
              <span className="text-sm text-gray-600 w-20 text-right self-center">{fmtD(Math.round(li.qty * li.price * 100))}</span>
              {lineItems.length > 1 && <button onClick={() => removeLine(i)} className="text-gray-300 hover:text-red-500">×</button>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div><label className="block text-xs text-gray-500 mb-1">Tax %</label><input type="number" step="0.1" value={taxRate * 100} onChange={e => setTaxRate((parseFloat(e.target.value) || 0) / 100)} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div><label className="block text-xs text-gray-500 mb-1">Discount $</label><input type="number" step="0.01" value={discountCents / 100} onChange={e => setDiscountCents(Math.round((parseFloat(e.target.value) || 0) * 100))} className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm" /></div>
          <div className="text-right pt-5"><p className="text-lg font-bold text-gray-900">{fmtD(total)}</p><p className="text-xs text-gray-400">Total</p></div>
        </div>

        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes..." rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={save} className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2.5 rounded-xl">Create Invoice</button>
        </div>
      </div>
    </div>
  )
}

function RecordPaymentModal({ invoiceId, customerId, customerName, onClose, onRecorded }: { invoiceId: string; customerId: string; customerName: string; onClose: () => void; onRecorded: () => void }) {
  const inv = getInvoicesForCustomer(customerId).find(i => i.id === invoiceId)
  const [amount, setAmount] = useState(inv ? inv.balanceDueCents / 100 : 0)
  const [method, setMethod] = useState<string>('check')
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  if (!inv) return null

  function save() {
    recordPayment({
      invoiceId, invoiceNumber: inv!.invoiceNumber, customerId, customerName,
      amountCents: Math.round(amount * 100), paymentMethod: method as any,
      referenceNumber: ref, paymentDate: date, recordedBy: 'admin', notes,
    })
    onRecorded()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[400px] p-5 mx-4 space-y-4">
        <h2 className="font-bold text-gray-900">Record Payment — {inv.invoiceNumber}</h2>
        <p className="text-sm text-gray-500">Balance due: ${(inv.balanceDueCents / 100).toFixed(2)}</p>
        <div><label className="block text-xs text-gray-500 mb-1">Amount</label><input type="number" step="0.01" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Method</label><select value={method} onChange={e => setMethod(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"><option value="cash">Cash</option><option value="check">Check</option><option value="credit_card">Credit Card</option><option value="bank_transfer">Bank Transfer</option><option value="other">Other</option></select></div>
        <div><label className="block text-xs text-gray-500 mb-1">Reference #</label><input value={ref} onChange={e => setRef(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="Check # or transaction ID" /></div>
        <div><label className="block text-xs text-gray-500 mb-1">Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={save} className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold py-2.5 rounded-xl">Record Payment</button>
        </div>
      </div>
    </div>
  )
}

// ── Customer Notes Tab ──────────────────────────────────────────────────────

function CustomerNotesTab({ customerId }: { customerId: string }) {
  const [notes, setNotes] = useState<CrmContactNoteRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [newNote, setNewNote] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    const rows = await listContactNotes(customerId)
    if (rows) setNotes(rows)
    setLoading(false)
  }, [customerId])
  useEffect(() => { setLoading(true); load() }, [load])

  async function handleCreate() {
    const body = newNote.trim()
    if (!body || busy) return
    setBusy(true)
    const created = await createContactNote(customerId, { body })
    setBusy(false)
    if (created) {
      setNewNote('')
      load()
    }
  }

  async function handlePin(id: string, pinned: boolean) {
    setBusy(true)
    const updated = await updateContactNote(customerId, id, { isPinned: !pinned })
    setBusy(false)
    if (updated) load()
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this note?')) return
    setBusy(true)
    const ok = await deleteContactNote(customerId, id)
    setBusy(false)
    if (ok) load()
  }

  function startEdit(n: CrmContactNoteRecord) { setEditingId(n.id); setEditBody(n.body) }

  async function saveEdit() {
    if (!editingId) return
    const body = editBody.trim()
    if (!body) return
    setBusy(true)
    const updated = await updateContactNote(customerId, editingId, { body })
    setBusy(false)
    if (updated) {
      setEditingId(null)
      load()
    }
  }

  const filtered = search ? notes.filter(n => n.body.toLowerCase().includes(search.toLowerCase())) : notes

  return (
    <div className="space-y-4">
      {/* Add note */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4">
        <textarea value={newNote} onChange={e => setNewNote(e.target.value)} placeholder="Add a note..." rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-orange-400 outline-none" />
        <div className="flex justify-end mt-2">
          <button onClick={handleCreate} disabled={!newNote.trim()} className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium disabled:opacity-40">Add Note</button>
        </div>
      </div>

      {/* Search */}
      {notes.length > 3 && (
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search notes..."
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
      )}

      {/* Notes list */}
      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">Loading notes…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">No notes yet</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(n => (
            <div key={n.id} className={`bg-white rounded-xl border ${n.isPinned ? 'border-orange-300 bg-orange-50' : 'border-gray-200'} p-4`}>
              {editingId === n.id ? (
                <div>
                  <textarea value={editBody} onChange={e => setEditBody(e.target.value)} rows={3} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                  <div className="flex gap-2 mt-2">
                    <button onClick={saveEdit} className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg">Save</button>
                    <button onClick={() => setEditingId(null)} className="text-xs text-gray-500">Cancel</button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {n.isPinned && <span className="text-xs text-orange-600 font-semibold mr-2">📌 Pinned</span>}
                      {n.visibility === 'internal' && <span className="text-xs bg-red-100 text-red-600 px-1.5 py-0.5 rounded mr-2">Internal</span>}
                      <p className="text-sm text-gray-800 whitespace-pre-wrap mt-1">{n.body}</p>
                    </div>
                    <div className="flex gap-1 shrink-0 ml-2">
                      <button onClick={() => handlePin(n.id, n.isPinned)} className="text-xs text-gray-400 hover:text-orange-600">{n.isPinned ? 'Unpin' : 'Pin'}</button>
                      <button onClick={() => startEdit(n)} className="text-xs text-gray-400 hover:text-blue-600">Edit</button>
                      <button onClick={() => handleDelete(n.id)} className="text-xs text-gray-400 hover:text-red-600">Delete</button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 mt-2">{n.createdBy} · {new Date(n.createdAt).toLocaleString()}</p>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Customer Pull Sheets Tab ─────────────────────────────────────────────────

function CustomerPullSheetsTab({ customerId }: { customerId: string }) {
  const pullSheets = getPullSheetsForCustomer(customerId)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const viewing = pullSheets.find(ps => ps.id === viewingId)

  const fmtD = (n: number) => '$' + n.toFixed(2)

  return (
    <div className="space-y-4">
      {pullSheets.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <p className="font-medium">No pull sheets linked</p>
          <p className="text-sm mt-1">Pull sheets will appear here automatically when quotes are created for this customer.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 divide-y divide-gray-50">
          {pullSheets.map(ps => (
            <div key={ps.id} className="px-4 py-3 flex items-center justify-between hover:bg-gray-50 cursor-pointer" onClick={() => setViewingId(ps.id === viewingId ? null : ps.id)}>
              <div>
                <p className="text-sm font-medium text-gray-900">{ps.quoteName}</p>
                <p className="text-xs text-gray-500">v{ps.versionNumber} · {new Date(ps.linkedAt).toLocaleDateString()}{ps.jobName ? ` · Job: ${ps.jobName}` : ''}</p>
              </div>
              <span className="text-xs text-gray-400">{ps.versionSnapshot?.length || 0} items</span>
            </div>
          ))}
        </div>
      )}

      {/* Pull Sheet Viewer */}
      {viewing && (
        <div className="bg-white rounded-2xl border border-gray-200 p-4">
          <div className="flex justify-between mb-3">
            <h3 className="font-semibold text-gray-900">{viewing.quoteName} — Pull Sheet v{viewing.versionNumber}</h3>
            <button onClick={() => setViewingId(null)} className="text-xs text-gray-400">Close</button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr><th className="text-left px-3 py-2 text-xs text-gray-500">#</th><th className="text-left px-3 py-2 text-xs text-gray-500">Material</th><th className="text-right px-3 py-2 text-xs text-gray-500">Qty</th><th className="text-right px-3 py-2 text-xs text-gray-500">Unit Cost</th><th className="text-right px-3 py-2 text-xs text-gray-500">Total</th></tr>
              </thead>
              <tbody>
                {(viewing.versionSnapshot || []).map((li: any, i: number) => (
                  <tr key={i} className="border-b border-gray-50"><td className="px-3 py-1.5 text-gray-400">{i + 1}</td><td className="px-3 py-1.5">{li.item}</td><td className="px-3 py-1.5 text-right">{li.qty}</td><td className="px-3 py-1.5 text-right">{fmtD(li.unitCost)}</td><td className="px-3 py-1.5 text-right font-medium">{fmtD(li.total)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr className="font-semibold"><td colSpan={4} className="px-3 py-2 text-right">Total</td><td className="px-3 py-2 text-right">{fmtD((viewing.versionSnapshot || []).reduce((s: number, li: any) => s + li.total, 0))}</td></tr></tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Customer Job Costing Tab ──────────────────────────────────────────────────

function CustomerJobCostingTab({ quotes }: { quotes: any[] }) {
  const costEntries: any[] = (() => {
    try { const r = localStorage.getItem('fencepro_jobcosting'); return r ? JSON.parse(r) : [] } catch { return [] }
  })()

  const soldQuotes = quotes.filter((q: any) => q.status === 'SOLD')
  const costedJobs = soldQuotes.map((q: any) => {
    const entry = costEntries.find((e: any) => e.quoteId === q.id)
    if (!entry) return null
    const estLabor = (q.adjLaborHrs || 0) * 22
    const actLabor = entry.actualLaborHrs * 22
    const estCOGS = q.totalCOGS || 0
    const actCOGS = actLabor + entry.actualMaterialCost + (entry.actualOtherCosts || 0)
    const variance = actCOGS - estCOGS
    const estGM = q.gmPct || 0
    const actGM = q.finalPrice > 0 ? (q.finalPrice - actCOGS) / q.finalPrice : 0
    return { quote: q, entry, estCOGS, actCOGS, variance, estGM, actGM }
  }).filter(Boolean) as any[]

  const totalEst = costedJobs.reduce((s: number, j: any) => s + j.estCOGS, 0)
  const totalAct = costedJobs.reduce((s: number, j: any) => s + j.actCOGS, 0)
  const totalVariance = totalAct - totalEst

  const fmtD = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
  const fmtP = (n: number) => `${(n * 100).toFixed(1)}%`
  const varColor = (v: number) => v > 0 ? 'text-red-600' : v < 0 ? 'text-green-600' : 'text-gray-600'

  if (costedJobs.length === 0) {
    return (
      <div className="space-y-4">
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
          Job costing data is migrating to the cloud with Jobs (Phase 3). Entries you make in Budget → Job Costing are stored locally until the migration completes.
        </div>
        <div className="text-center py-12 text-gray-400">
          <p className="font-medium">No job costing data</p>
          <p className="text-sm mt-1">Complete jobs and enter actual costs in Budget → Job Costing to see data here.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
        Job costing data is migrating to the cloud with Jobs (Phase 3). Entries are stored locally until the migration completes.
      </div>
      {/* Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Jobs Costed</p><p className="text-lg font-bold text-gray-900">{costedJobs.length}</p></div>
        <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Est. COGS</p><p className="text-lg font-bold text-gray-900">{fmtD(totalEst)}</p></div>
        <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Actual COGS</p><p className="text-lg font-bold text-gray-900">{fmtD(totalAct)}</p></div>
        <div className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400">Variance</p><p className={`text-lg font-bold ${varColor(totalVariance)}`}>{totalVariance > 0 ? '+' : ''}{fmtD(totalVariance)}</p></div>
      </div>

      {/* Job list */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100 grid grid-cols-7 gap-2 text-xs font-medium text-gray-500 uppercase">
          <div className="col-span-2">Job</div><div>Est. COGS</div><div>Actual</div><div>Variance</div><div>Est. GM</div><div>Actual GM</div>
        </div>
        <div className="divide-y divide-gray-50">
          {costedJobs.map((j: any) => (
            <div key={j.quote.id} className="px-4 py-3 grid grid-cols-7 gap-2 items-center text-sm hover:bg-gray-50">
              <div className="col-span-2">
                <p className="font-medium text-gray-900">{j.quote.customerName}</p>
                <p className="text-xs text-gray-400">{j.quote.fenceStyle} • {j.entry.completionDate}</p>
              </div>
              <div className="text-gray-700">{fmtD(j.estCOGS)}</div>
              <div className="text-gray-700">{fmtD(j.actCOGS)}</div>
              <div className={`font-medium ${varColor(j.variance)}`}>{j.variance > 0 ? '+' : ''}{fmtD(j.variance)}</div>
              <div className="text-gray-700">{fmtP(j.estGM)}</div>
              <div className={`font-medium ${j.actGM >= j.estGM ? 'text-green-600' : 'text-red-600'}`}>{fmtP(j.actGM)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Customer Detail ───────────────────────────────────────────────────────────

function CustomerDetail({
  customer, quotes, importedQuotes, jobs, files,
  onEdit, onNewQuote, onDelete, onDeleteFile, onQuoteClick, onFileClick, initialTab, onTabConsumed,
}: {
  customer: Customer
  quotes: Quote[]
  importedQuotes: ImportedQuote[]
  jobs: Job[]
  files: CustomerFile[]
  onEdit: () => void
  onNewQuote: (customer: Customer) => void
  onDelete: (id: string) => void
  onDeleteFile: (id: string) => void
  onQuoteClick?: (quoteId: string) => void
  onFileClick?: (f: CustomerFile) => void
  initialTab?: string | null
  onTabConsumed?: () => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'quotes' | 'jobs' | 'costing' | 'billing' | 'notes' | 'pullsheets' | 'files' | 'photos' | 'messages'>('overview')

  useEffect(() => {
    if (initialTab && ['overview','quotes','jobs','costing','billing','notes','pullsheets','files','photos','messages'].includes(initialTab)) {
      setActiveTab(initialTab as any)
      onTabConsumed?.()
    }
  }, [initialTab, customer.id, onTabConsumed])

  const totalRevenue = quotes.filter(q => q.status === 'SOLD').reduce((s, q) => s + q.price, 0)
    + importedQuotes.reduce((s, q) => s + q.quotedPrice, 0)
  const allQuoteCount = quotes.length + importedQuotes.length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-8 py-6 border-b border-gray-200 bg-white">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-orange-500 flex items-center justify-center text-white text-xl font-black">
              {customer.firstName?.[0] ?? ''}{customer.lastName?.[0] ?? ''}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-gray-900">{customer.firstName} {customer.lastName}</h2>
                {quotes.some(q => q.status === 'SOLD') && (
                  <span className="text-[10px] font-bold uppercase tracking-widest bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Signed / Sold</span>
                )}
                {!quotes.some(q => q.status === 'SOLD') && quotes.some(q => q.status === 'SENT') && (
                  <span className="text-[10px] font-bold uppercase tracking-widest bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Quote Sent</span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1">
                {customer.phone && <span className="text-sm text-gray-500">📞 {customer.phone}</span>}
                {customer.email && <span className="text-sm text-gray-500">✉️ {customer.email}</span>}
              </div>
              <div className="flex gap-1.5 mt-2">
                {customer.tags.map(tag => (
                  <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{tag}</span>
                ))}
                {customer.leadSource && (
                  <span className="text-xs bg-orange-50 text-orange-600 border border-orange-200 px-2 py-0.5 rounded-full">via {customer.leadSource}</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => onNewQuote(customer)} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg">+ New Quote</button>
            <button onClick={onEdit} className="border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50">Edit</button>
            <button onClick={() => onDelete(customer.id)} className="border border-red-200 text-red-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-red-50">Delete</button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4 mt-5">
          {[
            { label: 'Total Revenue', value: fmt(totalRevenue) },
            { label: 'Quotes', value: String(allQuoteCount) },
            { label: 'Jobs', value: String(jobs.length) },
            { label: 'Customer Since', value: customer.createdAt },
          ].map(s => (
            <div key={s.label} className="bg-gray-50 rounded-xl p-3">
              <p className="text-xs text-gray-400">{s.label}</p>
              <p className="text-sm font-bold text-gray-900 mt-0.5">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Portal Access section — prominent, dedicated row */}
        <PortalAccessSection customer={customer} />

        <div className="flex gap-1 mt-5 bg-gray-100 rounded-xl p-1 w-fit">
          {(['overview', 'quotes', 'jobs', 'billing', 'costing', 'notes', 'pullsheets', 'files', 'photos', 'messages'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all ${activeTab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
            >
              {t}
              {t === 'quotes' && allQuoteCount > 0 && <span className="ml-1.5 text-xs bg-orange-100 text-orange-600 rounded-full px-1.5">{allQuoteCount}</span>}
              {t === 'jobs' && jobs.length > 0 && <span className="ml-1.5 text-xs bg-orange-100 text-orange-600 rounded-full px-1.5">{jobs.length}</span>}
              {t === 'files' && files.length > 0 && <span className="ml-1.5 text-xs bg-orange-100 text-orange-600 rounded-full px-1.5">{files.length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-8 py-6">
        {activeTab === 'overview' && (
          <div className="space-y-6 max-w-2xl">
            <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
              <h3 className="font-bold text-gray-900">Contact Details</h3>
              {[
                { label: 'Service Address', value: customer.serviceAddress },
                customer.billingDifferent ? { label: 'Billing Address', value: customer.billingAddress } : null,
                { label: 'Phone',       value: customer.phone },
                { label: 'Email',       value: customer.email },
                { label: 'Lead Source', value: customer.leadSource },
                { label: 'Sales Rep',   value: customer.salesRep },
                { label: 'First Appt',  value: customer.firstApptDate },
                { label: 'Job Status',  value: customer.jobStatus },
              ].filter(Boolean).map((row: any) => row?.value ? (
                <div key={row.label} className="flex gap-4">
                  <span className="text-xs text-gray-400 w-32 shrink-0 pt-0.5">{row.label}</span>
                  <span className="text-sm text-gray-800">{row.value}</span>
                </div>
              ) : null)}
            </div>
            {customer.notes && (
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <h3 className="font-bold text-gray-900 mb-3">Notes</h3>
                <p className="text-sm text-gray-600 whitespace-pre-wrap">{customer.notes}</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'quotes' && (
          <div className="space-y-4">
            {importedQuotes.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Imported Quote History</p>
                  <p className="text-xs text-gray-400">{importedQuotes.length} records</p>
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100">
                    <tr>
                      <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-400 uppercase">Type</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">Sections</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">Quoted</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">Labor</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">50% Dep</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">Tear Out</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">Rep</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-400 uppercase">Sold</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {importedQuotes.map(q => (
                      <tr key={q.id} className="hover:bg-gray-50">
                        <td className="px-5 py-2.5 font-medium text-gray-800">{q.projectType || '—'}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{q.sections || '—'}</td>
                        <td className="px-4 py-2.5 text-right font-bold text-gray-900">{q.quotedPrice > 0 ? fmt(q.quotedPrice) : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{q.laborBid > 0 ? fmt(q.laborBid) : '—'}</td>
                        <td className="px-4 py-2.5 text-right text-gray-600">{q.depositAmt > 0 ? fmt(q.depositAmt) : '—'}</td>
                        <td className="px-4 py-2.5 text-right">
                          {q.tearOut ? <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Yes</span> : <span className="text-xs text-gray-300">No</span>}
                        </td>
                        <td className="px-4 py-2.5 text-right text-gray-500 text-xs uppercase">{q.salesRep || '—'}</td>
                        <td className="px-4 py-2.5 text-right text-gray-400 text-xs">{q.soldDate || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {quotes.length > 0 && (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Quotes from EZBiz</p>
                </div>
                <table className="w-full text-sm">
                  <thead className="border-b border-gray-100">
                    <tr>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-400 uppercase">Type</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Sections</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Price</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Margin</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Date</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {quotes.map(q => (
                      <tr key={q.id} className="hover:bg-orange-50 cursor-pointer transition-colors" onClick={() => onQuoteClick?.(q.id)}>
                        <td className="px-5 py-3 font-medium text-gray-800">{q.type}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{q.sections}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(q.price)}</td>
                        <td className={`px-4 py-3 text-right font-semibold text-sm ${q.margin >= 0.34 ? 'text-green-600' : q.margin >= 0.27 ? 'text-yellow-600' : 'text-red-500'}`}>
                          {(q.margin * 100).toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400 text-xs">{q.date}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[q.status]}`}>{q.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {quotes.length === 0 && importedQuotes.length === 0 && (
              <div className="text-center py-16 border border-dashed border-gray-200 rounded-2xl">
                <p className="text-gray-400 text-sm mb-3">No quotes yet</p>
                <button onClick={() => onNewQuote(customer)} className="text-orange-500 text-sm hover:underline">Create first quote</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'jobs' && (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-lg px-3 py-2">
              Jobs are migrating to the cloud in the next push (Phase 3). Jobs and stage changes are stored locally in this browser only until the migration completes; teammates may not see them yet.
            </div>
            {jobs.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-gray-200 rounded-2xl">
                <p className="text-4xl mb-2">🏗</p>
                <p className="text-gray-700 font-medium">No jobs yet</p>
                <p className="text-gray-400 text-xs mt-1 max-w-sm mx-auto">Jobs are created automatically when a quote is marked as Sold — either by dragging a pipeline card to Signed Contract or clicking Mark as Sold on a quote.</p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Sections</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Value</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Scheduled</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Stage</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {jobs.map(j => (
                      <tr key={j.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-800">{j.type}</td>
                        <td className="px-4 py-3 text-right text-gray-600">{j.sections}</td>
                        <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(j.value)}</td>
                        <td className="px-4 py-3 text-right text-gray-400 text-xs">{j.scheduledDate}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs px-2 py-1 rounded-full ${STAGE_COLORS[j.stage] ?? 'bg-gray-100 text-gray-600'}`}>
                            {STAGE_LABELS[j.stage] ?? j.stage}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'costing' && (
          <CustomerJobCostingTab quotes={quotes} />
        )}

        {activeTab === 'billing' && (
          <CustomerBillingTab customerId={customer.id} customerName={`${customer.firstName} ${customer.lastName}`} customerEmail={customer.email} />
        )}

        {activeTab === 'notes' && (
          <CustomerNotesTab customerId={customer.id} />
        )}

        {activeTab === 'pullsheets' && (
          <CustomerPullSheetsTab customerId={customer.id} />
        )}

        {activeTab === 'photos' && (
          <CustomerPhotosTab customerId={customer.id} uploadedBy="user" />
        )}

        {activeTab === 'files' && (
          <CustomerFilesTab
            customerId={customer.id}
            uploadedBy="user"
            legacyFiles={files as any}
            onLegacyFileClick={(f) => onFileClick?.(f as any)}
            onLegacyFileDelete={(id) => onDeleteFile(id)}
          />
        )}

        {activeTab === 'messages' && (
          <CustomerMessagesTab customerId={customer.id} sender="user" />
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomersPage({ onNewQuote }: { onNewQuote?: (customer?: Customer) => void }) {
  const [importedQuotes, setImportedQuotes] = useState<ImportedQuote[]>(() => {
    try {
      const raw = localStorage.getItem('fencepro_imported_quotes')
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })
  const [customers, setCustomers] = useState<Customer[]>(() => getCustomers())
  // Pull real quotes from the API-backed cache. Empty state is honest now —
  // no SAMPLE_QUOTES fallback, fresh accounts simply see "no quotes yet".
  const readQuotes = (): Quote[] => {
    return getQuotes().map(q => ({
      id: q.id,
      customerId: q.customerId || '',
      type: q.fenceStyle || '',
      sections: q.sections || 0,
      price: q.finalPrice || 0,
      margin: q.gmPct || 0,
      status: q.status || 'DRAFT',
      date: q.date || '',
    })) as Quote[]
  }
  const readJobs = (): Job[] => {
    try {
      const raw = localStorage.getItem('fencepro_jobs')
      if (!raw) return SAMPLE_JOBS
      const all = JSON.parse(raw) as any[]
      if (!Array.isArray(all) || all.length === 0) return SAMPLE_JOBS
      return all.map(j => ({
        id: j.id, customerId: j.customerId || '',
        type: j.fenceStyle || j.type || '',
        sections: j.sections || 0,
        value: j.value || j.finalPrice || 0,
        stage: j.stage || j.status || 'SCHEDULED',
        scheduledDate: j.scheduledDate || '',
      })) as Job[]
    } catch { return SAMPLE_JOBS }
  }
  const [quotes, setQuotes] = useState<Quote[]>(() => readQuotes())
  const [jobs, setJobs] = useState<Job[]>(() => readJobs())

  // Listen for quote/job/customer updates to keep the profile in sync without refresh
  useEffect(() => {
    const reload = () => { setQuotes(readQuotes()); setJobs(readJobs()) }
    const reloadCustomers = () => {
      // Always trust the cache once a store mutation has fired the event
      // (covers delete-last-customer where the new list is legitimately empty).
      setCustomers(getCustomers())
    }
    window.addEventListener('fencepro:quotes:updated', reload)
    window.addEventListener('fencepro:jobs:updated', reload)
    window.addEventListener('fencepro:customers:updated', reloadCustomers)
    return () => {
      window.removeEventListener('fencepro:quotes:updated', reload)
      window.removeEventListener('fencepro:jobs:updated', reload)
      window.removeEventListener('fencepro:customers:updated', reloadCustomers)
    }
  }, [])

  const [files, setFiles] = useState<CustomerFile[]>(() => {
    try {
      const raw = localStorage.getItem('fencepro_files')
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'new' | 'edit'>('view')
  const [search, setSearch] = useState('')
  const [drawerQuote, setDrawerQuote] = useState<SavedQuote | null>(null)
  const [viewerFile, setViewerFile] = useState<CustomerFile | null>(null)
  const [forcedTab, setForcedTab] = useState<string | null>(null)

  useEffect(() => {
    function onSelect(e: any) {
      const id = e?.detail?.customerId
      const tab = e?.detail?.tab
      if (typeof id === 'string') {
        setSelectedId(id)
        setMode('view')
        if (typeof tab === 'string') setForcedTab(tab)
      }
    }
    window.addEventListener('fencepro:select-customer', onSelect as any)
    return () => window.removeEventListener('fencepro:select-customer', onSelect as any)
  }, [])

  const filtered = customers.filter(c => {
    const q = search.toLowerCase()
    return (
      `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
      (c.phone || '').includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.serviceAddress || '').toLowerCase().includes(q)
    )
  })

  const selected = customers.find(c => c.id === selectedId) ?? null
  const customerQuotes = quotes.filter(q => q.customerId === selectedId)
  const customerImportedQuotes = importedQuotes.filter(q => q.customerId === selectedId)
  const customerJobs = jobs.filter(j => j.customerId === selectedId)
  const customerFiles = files.filter(f => f.customerId === selectedId)

  function handleSave(c: Customer) {
    try {
      const isNew = !customers.find(x => x.id === c.id)
      // Route through the store: it dual writes to /api/crm-contacts, updates
      // the in memory cache, and fires `fencepro:customers:updated` (which
      // our reloadCustomers handler picks up to refresh local state).
      // For new customers the store also seeds the pipeline + fires the
      // customer_created automation, so we skip those here on the new path.
      const { customer } = upsertCustomer(c)
      setSelectedId(customer.id)
      setMode('view')

      if (isNew) {
        if (c.email) {
          toast.success('Customer added', 'On Sales Pipeline at First Contact · portal account ready — click "Send Portal Invite" on their profile to deliver the link.')
        } else {
          toast.success('Customer added', 'Also placed on Sales Pipeline under First Contact.')
        }
      } else {
        toast.success('Customer updated')
      }
    } catch (err: any) {
      toast.error('Could not save customer', err?.message || 'Unknown error.')
    }
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this customer?')) return
    storeDeleteCustomer(id)
    if (selectedId === id) { setSelectedId(null); setMode('view') }
  }

  function handleCSVImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = async ev => {
      const text = ev.target?.result as string
      if (!text) return

      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length < 2) return

      function parseCSVLine(line: string): string[] {
        const cols: string[] = []
        let current = ''
        let inQuotes = false
        for (let ci = 0; ci < line.length; ci++) {
          const ch = line[ci]
          if (ch === '"') { inQuotes = !inQuotes; continue }
          if (ch === ',' && !inQuotes) { cols.push(current.trim()); current = ''; continue }
          current += ch
        }
        cols.push(current.trim())
        return cols.map(c => c.replace(/^"|"$/g, '').trim())
      }

      function parseMoney(s: string): number {
        return parseFloat(s.replace(/[$,\s]/g, '')) || 0
      }

      const headers = parseCSVLine(lines[0]).map(h =>
        h.toLowerCase().replace(/[\s_#$().]+/g, '')
      )

      function col(...keys: string[]): number {
        for (const k of keys) {
          const i = headers.indexOf(k)
          if (i !== -1) return i
        }
        return -1
      }

      const colMap = {
        leadSource:  col('leadsource', 'source', 'lead'),
        clientName:  col('clientname', 'name', 'fullname', 'customername', 'displayname'),
        firstName:   col('firstname', 'first', 'fname'),
        lastName:    col('lastname', 'last', 'lname'),
        address:     col('homeaddress', 'address', 'serviceaddress', 'streetaddress'),
        phone:       col('phone', 'phonenumber', 'mobile', 'cell'),
        phone2:      col('phonenumber1', 'phone2', 'mobilephone', 'cellphone'),
        email:       col('email', 'emailaddress'),
        projectType: col('projecttype', 'type', 'fencetype'),
        sections:    col('ofsections', 'sections', 'numberofsections'),
        mhQuoted:    col('mhquoted', 'mh', 'manhours'),
        tearOut:     col('tearout', 'tear'),
        quotedPrice: col('quoted', 'price', 'quoteamount'),
        laborBid:    col('laborbid', 'labor'),
        deposit:     col('50', 'deposit', '50amt'),
        salesRep:    col('salesrep', 'rep', 'salesperson'),
        soldDate:    col('solddate', 'sold', 'closedate'),
        firstAppt:   col('dateof1stappt', 'firstappt', 'appointmentdate', 'apptdate'),
        jobStatus:   col('jobstatus', 'status', 'stage'),
        city:        col('city'),
        state:       col('state'),
        zip:         col('zip'),
      }

      const importedCustomers: Customer[] = []
      const importedQuotesList: ImportedQuote[] = []

      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i])
        const get = (idx: number) => (idx !== -1 && cols[idx] ? cols[idx] : '')

        let firstName = get(colMap.firstName)
        let lastName  = get(colMap.lastName)

        if (!firstName && !lastName) {
          const full = get(colMap.clientName).trim()
          if (!full) continue
          const spaceIdx = full.indexOf(' ')
          if (spaceIdx === -1) { firstName = full; lastName = '' }
          else { firstName = full.slice(0, spaceIdx); lastName = full.slice(spaceIdx + 1) }
        }

        if (!firstName) continue

        const custId = uid()
        const rawSource = get(colMap.leadSource)
        const matchedSource = LEAD_SOURCES.find(s => s.toLowerCase() === rawSource.toLowerCase()) ?? rawSource

        let address = get(colMap.address)
        const city  = get(colMap.city)
        const state = get(colMap.state)
        const zip   = get(colMap.zip)
        if (city || state || zip) {
          address = [address, city, state, zip].filter(Boolean).join(', ')
        }

        const customer: Customer = {
          id: custId,
          firstName,
          lastName,
          phone: get(colMap.phone) || get(colMap.phone2),
          email: get(colMap.email),
          serviceAddress: address,
          billingAddress: '',
          billingDifferent: false,
          leadSource: matchedSource,
          notes: '',
          tags: [],
          createdAt: get(colMap.soldDate) || new Date().toISOString().slice(0, 10),
          salesRep: get(colMap.salesRep),
          firstApptDate: get(colMap.firstAppt),
          jobStatus: get(colMap.jobStatus),
        }

        const projectType = get(colMap.projectType)
        const quotedPrice = parseMoney(get(colMap.quotedPrice))
        const soldDate    = get(colMap.soldDate)

        if (projectType || quotedPrice > 0 || soldDate) {
          importedQuotesList.push({
            id: uid(),
            customerId: custId,
            projectType,
            sections:     parseInt(get(colMap.sections)) || 0,
            mhQuoted:     parseFloat(get(colMap.mhQuoted)) || 0,
            tearOut:      get(colMap.tearOut).toLowerCase().startsWith('y'),
            quotedPrice,
            laborBid:     parseMoney(get(colMap.laborBid)),
            depositAmt:   parseMoney(get(colMap.deposit)),
            salesRep:     get(colMap.salesRep),
            soldDate,
            firstApptDate: get(colMap.firstAppt),
          })
        }

        importedCustomers.push(customer)
      }

      if (importedCustomers.length === 0) {
        alert('No customers could be parsed. Check that your CSV has a header row.')
        return
      }

      // Push fresh records to the API via the store. Existing rows are
      // matched by phone/email and skipped; new ones get pipeline lead +
      // automation seeded inside upsertCustomer.
      const result = await bulkImportCustomers(importedCustomers)
      const freshCount = result.created

      setImportedQuotes(prev => {
        const updated = [...importedQuotesList, ...prev]
        localStorage.setItem('fencepro_imported_quotes', JSON.stringify(updated))
        return updated
      })

      toast.success(`Imported ${freshCount} customers`, `${importedQuotesList.length} quote records attached · all added to pipeline.`)
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="flex h-full bg-white rounded-2xl border border-gray-200 overflow-hidden" style={{ minHeight: 'calc(100vh - 120px)' }}>
      <div className="w-72 border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-4 py-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-gray-900">Customers</h2>
            <button onClick={() => { setSelectedId(null); setMode('new') }} className="bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg">+ New</button>
          </div>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            placeholder="Search customers..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <label className="mt-2 flex items-center justify-center gap-1.5 w-full border border-dashed border-gray-300 rounded-lg px-3 py-2 text-xs text-gray-500 hover:border-orange-400 hover:text-orange-500 cursor-pointer transition-colors">
            📂 Import CSV
            <input type="file" accept=".csv" className="hidden" onChange={handleCSVImport} />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">No customers found</div>
          )}
          {filtered.map(c => {
            const revenue = quotes.filter(q => q.customerId === c.id && q.status === 'SOLD').reduce((s, q) => s + q.price, 0)
            const isSelected = selectedId === c.id && mode !== 'new'
            return (
              <div
                key={c.id}
                onClick={() => { setSelectedId(c.id); setMode('view') }}
                className={`w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors group relative cursor-pointer ${isSelected ? 'bg-orange-50 border-r-2 border-orange-500' : ''}`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${isSelected ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {c.firstName?.[0] ?? ''}{c.lastName?.[0] ?? ''}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{c.firstName} {c.lastName}</p>
                    <p className="text-xs text-gray-400 truncate">{c.phone}</p>
                  </div>
                  {revenue > 0 && <span className="text-xs font-semibold text-green-600 shrink-0">{fmt(revenue)}</span>}
                </div>
                {c.tags && c.tags.length > 0 && (
                  <div className="flex gap-1 mt-1.5 ml-12">
                    {c.tags.slice(0, 2).map(tag => (
                      <span key={tag} className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{tag}</span>
                    ))}
                    {c.tags.length > 2 && <span className="text-xs text-gray-400">+{c.tags.length - 2}</span>}
                  </div>
                )}
                <button onClick={e => { e.stopPropagation(); handleDelete(c.id) }} title="Delete customer" className="absolute right-3 top-3 text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
              </div>
            )
          })}
        </div>

        <div className="px-4 py-3 border-t border-gray-100 text-xs text-gray-400">
          {customers.length} customer{customers.length !== 1 ? 's' : ''}
        </div>
      </div>

      {mode === 'new' && <CustomerForm onSave={handleSave} onCancel={() => setMode('view')} />}
      {mode === 'edit' && selected && <CustomerForm initial={selected} onSave={handleSave} onCancel={() => setMode('view')} />}
      {mode === 'view' && !selected && <EmptyState onNew={() => setMode('new')} />}
      {mode === 'view' && selected && (
        <CustomerDetail
          customer={selected}
          quotes={customerQuotes}
          importedQuotes={customerImportedQuotes}
          jobs={customerJobs}
          files={customerFiles}
          onEdit={() => setMode('edit')}
          onNewQuote={(c) => onNewQuote?.(c)}
          onDelete={handleDelete}
          onDeleteFile={id => setFiles(prev => {
            const updated = prev.filter(f => f.id !== id)
            localStorage.setItem('fencepro_files', JSON.stringify(updated))
            return updated
          })}
          onQuoteClick={(quoteId) => {
            const full = getQuotes().find(q => q.id === quoteId) || null
            setDrawerQuote(full as SavedQuote | null)
          }}
          onFileClick={(f) => setViewerFile(f)}
          initialTab={forcedTab}
          onTabConsumed={() => setForcedTab(null)}
        />
      )}

      {viewerFile && (
        <FileViewerModal
          file={viewerFile as unknown as CustomerFileShape}
          siblingImages={files.filter(f => /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(f.name)) as unknown as CustomerFileShape[]}
          onClose={() => setViewerFile(null)}
          onDelete={(id) => {
            setFiles(prev => {
              const next = prev.filter(f => f.id !== id)
              localStorage.setItem('fencepro_files', JSON.stringify(next))
              return next
            })
          }}
        />
      )}

      {drawerQuote && (
        <QuoteDetailDrawer
          quote={drawerQuote}
          onClose={() => setDrawerQuote(null)}
          onChange={() => {
            const updated = getQuotes().find(q => q.id === drawerQuote.id) || null
            setDrawerQuote(updated as SavedQuote | null)
            setQuotes(readQuotes())
            setJobs(readJobs())
          }}
        />
      )}
    </div>
  )
}
// Full-width, prominent Portal Access panel rendered in the customer profile
// header area below the stats row.
function PortalAccessSection({ customer }: { customer: Customer }) {
  const [bump, setBump] = useState(0)
  const [busy, setBusy] = useState(false)

  // Kick off a backend refresh on mount so the cached status is fresh
  useEffect(() => { loadAccountsSoon().then(() => setBump(b => b + 1)).catch(() => {}) }, [customer.id])
  void bump
  const status = getPortalAccessStatus(customer.id)

  function composeFallbackMailto(rawToken: string) {
    // Fallback used when the server couldn't send the email itself
    const link = buildActivationLink(rawToken)
    const tpl = getEmailTemplate('portal_welcome')
    const companyName = (() => {
      try { const r = localStorage.getItem('fencepro_config'); if (r) return JSON.parse(r).company?.name || 'EZBiz' } catch {}
      return 'EZBiz'
    })()
    const companyPhone = (() => {
      try { const r = localStorage.getItem('fencepro_config'); if (r) return JSON.parse(r).company?.phone || '' } catch {}
      return ''
    })()
    const rendered = renderTemplate(tpl, {
      customer_first_name: customer.firstName || 'there',
      customer_name: `${customer.firstName} ${customer.lastName}`.trim(),
      company_name: companyName,
      company_phone: companyPhone,
      portal_link: link,
    })
    const plainBody = rendered.body
      .replace(/<a[^>]*href="([^"]+)"[^>]*>[^<]*<\/a>/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    const mailto = `mailto:${encodeURIComponent(customer.email)}?subject=${encodeURIComponent(rendered.subject)}&body=${encodeURIComponent(plainBody)}`
    navigator.clipboard?.writeText(link).catch(() => {})
    window.open(mailto, '_blank')
  }

  async function handleSend() {
    if (!customer.email) {
      toast.warning('No email on file', 'Add an email to this customer to send a portal invite.')
      return
    }
    setBusy(true)
    const r = await sendPortalInvite({
      id: customer.id, email: customer.email,
      firstName: customer.firstName, lastName: customer.lastName,
    })
    setBusy(false)
    if (!r.ok) {
      toast.error('Could not send portal invite', r.error || 'Unknown error')
      return
    }
    const { data } = r
    if (!data) return
    // Always copy link to clipboard as a safety net
    try { navigator.clipboard?.writeText(data.activationUrl) } catch {}
    if (data.emailSent) {
      toast.success('Portal invite sent', `Email delivered to ${customer.email}. Link also copied to clipboard.`)
      logCustomerActivity(customer.id, `Portal invite emailed to ${customer.email}`, { actor: 'user', kind: 'info' })
    } else {
      // Email service not configured on the backend — hand off to the staff's email client
      // Extract raw token from the URL and open mailto
      const tok = (data.activationUrl.match(/token=([a-f0-9]+)/i) || [])[1]
      if (tok) composeFallbackMailto(tok)
      toast.warning('Email service offline — using your email client',
        'The server could not send directly. Your email client opened with the invite prefilled. Click Send there.')
      logCustomerActivity(customer.id, `Portal invite opened in email client (server send disabled)`, { actor: 'user', kind: 'info' })
    }
    await loadAccountsSoon()
    setBump(b => b + 1)
  }

  async function handleResend() {
    setBusy(true)
    const r = await resendPortalInvite(customer.email)
    setBusy(false)
    if (r.ok) {
      toast.success('New invite requested', 'Customer will receive a fresh activation link.')
      await loadAccountsSoon()
      setBump(b => b + 1)
    } else if (r.error === 'RATE_LIMITED') {
      toast.warning('Too many requests', 'Resend limit reached for this email — try again in an hour.')
    } else {
      toast.error('Could not resend', r.error)
    }
  }

  async function handleCopyLink() {
    // Re-issue an invite to get a fresh token we can copy.
    setBusy(true)
    const r = await sendPortalInvite({
      id: customer.id, email: customer.email || '',
      firstName: customer.firstName, lastName: customer.lastName,
    })
    setBusy(false)
    if (r.ok && r.data) {
      try { await navigator.clipboard?.writeText(r.data.activationUrl) } catch {}
      toast.success('Activation link copied', 'A fresh link was issued and copied to your clipboard.')
    } else {
      toast.error('Could not issue a link', r.error)
    }
  }

  // Colors + copy vary by state
  let stateIcon = '👤', stateLabel = 'No Portal Access', bodyText = '', chipClass = 'bg-gray-100 text-gray-600'
  if (status.state === 'active') {
    stateIcon = '✓'; stateLabel = 'Portal Active'; chipClass = 'bg-green-100 text-green-700'
    bodyText = status.lastLogin
      ? `Last login ${new Date(status.lastLogin).toLocaleDateString()}.`
      : `Activated. Customer can sign in anytime.`
  } else if (status.state === 'invited') {
    stateIcon = '✉'; stateLabel = 'Invite Sent'; chipClass = 'bg-blue-100 text-blue-700'
    bodyText = status.invitedAt
      ? `Invited ${new Date(status.invitedAt).toLocaleDateString()}. Customer hasn't activated yet.`
      : `Customer hasn't activated yet.`
  } else {
    bodyText = customer.email
      ? `Portal account is ready — click Send Invite to email the activation link.`
      : `Add an email address to enable the customer portal.`
  }

  return (
    <div className="mt-4 bg-gradient-to-r from-orange-50 to-white border border-orange-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="w-10 h-10 rounded-xl bg-white border border-orange-200 flex items-center justify-center text-orange-500 text-xl shrink-0">
          {stateIcon}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-gray-900">Customer Portal</p>
            <span className={`text-[10px] uppercase tracking-widest font-bold px-2 py-0.5 rounded-full ${chipClass}`}>{stateLabel}</span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{bodyText}</p>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        {status.state === 'none' && (
          <button onClick={handleSend} disabled={!customer.email}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-sm font-semibold px-4 py-2 rounded-lg whitespace-nowrap">
            Send Portal Invite
          </button>
        )}
        {status.state === 'invited' && (
          <>
            <button onClick={handleResend}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg whitespace-nowrap">
              Resend Invite
            </button>
            <button onClick={handleCopyLink}
              className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm px-3 py-2 rounded-lg whitespace-nowrap">
              Copy Link
            </button>
          </>
        )}
        {status.state === 'active' && (
          <a href={`${window.location.origin}/#/portal/login`} target="_blank" rel="noreferrer"
            className="border border-gray-200 text-gray-700 hover:bg-gray-50 text-sm px-3 py-2 rounded-lg whitespace-nowrap">
            Open Portal
          </a>
        )}
      </div>
    </div>
  )
}
