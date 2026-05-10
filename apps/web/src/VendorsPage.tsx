/**
 * Vendors Page — master list of vendors, vendor detail panel, bill + payment management.
 */

import { useState, useMemo } from 'react'
import { getJobs } from './jobStore'
import {
  getVendors, getVendorById, createVendor, updateVendor, deleteVendor,
  getBillsForVendor, getPaymentsForVendor,
  createBill, updateBill, recordVendorPayment,
  refreshOverdueBills,
  type VendorContact, type VendorBill, type VendorPayment,
  type PaymentTerms, type VendorBillCategory, type VendorBillStatus,
  type VendorPaymentMethod, type VendorBillLineItem,
} from './vendorStore'
import AddressAutocomplete from './AddressAutocomplete'
import { toast } from './toast'

const fmt = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(c / 100)

const uid = () => Math.random().toString(36).slice(2, 9)

const TERMS_LABELS: Record<PaymentTerms, string> = {
  net_15: 'Net 15', net_30: 'Net 30', net_45: 'Net 45', net_60: 'Net 60',
  due_on_receipt: 'Due on Receipt', custom: 'Custom',
}

const CATEGORY_LABELS: Record<VendorBillCategory, string> = {
  materials: 'Materials', labor: 'Labor', equipment: 'Equipment',
  overhead: 'Overhead', subcontractor: 'Subcontractor', utilities: 'Utilities',
  insurance: 'Insurance', other: 'Other',
}

const STATUS_COLORS: Record<VendorBillStatus, string> = {
  draft: 'bg-gray-100 text-gray-600',
  received: 'bg-blue-100 text-blue-700',
  approved: 'bg-indigo-100 text-indigo-700',
  scheduled: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
  void: 'bg-gray-100 text-gray-400',
}

export default function VendorsPage() {
  const [bump, setBump] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showVendorForm, setShowVendorForm] = useState(false)
  const [editingVendor, setEditingVendor] = useState<VendorContact | null>(null)

  const vendors = useMemo(() => {
    refreshOverdueBills()
    return getVendors()
  }, [bump])
  const selected = selectedId ? getVendorById(selectedId) : null

  const vendorsWithBalance = vendors.map(v => {
    const bills = getBillsForVendor(v.id)
    const outstanding = bills.reduce((s, b) => s + (b.status === 'void' ? 0 : b.balanceDueCents), 0)
    const overdue = bills.reduce((s, b) => s + (b.status === 'overdue' ? b.balanceDueCents : 0), 0)
    return { vendor: v, outstanding, overdue, billCount: bills.length }
  })

  function reload() { setBump(b => b + 1) }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendors</h1>
          <p className="text-sm text-gray-500 mt-1">Manage vendor contacts, bills, and payments.</p>
        </div>
        <button onClick={() => { setEditingVendor(null); setShowVendorForm(true) }}
          className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">+ Add Vendor</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* List */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-widest">
            All Vendors ({vendors.length})
          </div>
          {vendors.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No vendors yet. Click + Add Vendor to get started.</div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
              {vendorsWithBalance.map(({ vendor, outstanding, overdue, billCount }) => (
                <button key={vendor.id} onClick={() => setSelectedId(vendor.id)}
                  className={`w-full px-4 py-3 text-left hover:bg-orange-50 transition-colors ${selectedId === vendor.id ? 'bg-orange-50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{vendor.name}</p>
                      <p className="text-xs text-gray-500">{TERMS_LABELS[vendor.paymentTerms]} · {billCount} bill{billCount === 1 ? '' : 's'}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${overdue > 0 ? 'text-red-600' : outstanding > 0 ? 'text-orange-500' : 'text-gray-400'}`}>
                        {outstanding > 0 ? fmt(outstanding) : '—'}
                      </p>
                      {overdue > 0 && <p className="text-[10px] text-red-500 uppercase font-bold">overdue</p>}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail */}
        <div className="lg:col-span-2">
          {selected ? (
            <VendorDetail vendor={selected} onReload={reload}
              onEdit={() => { setEditingVendor(selected); setShowVendorForm(true) }}
              onDelete={() => {
                if (!confirm(`Delete vendor "${selected.name}"? This cannot be undone.`)) return
                deleteVendor(selected.id)
                setSelectedId(null)
                reload()
              }}
            />
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
              Select a vendor on the left to view bills, payments, and details.
            </div>
          )}
        </div>
      </div>

      {showVendorForm && (
        <VendorForm initial={editingVendor} onCancel={() => setShowVendorForm(false)}
          onSaved={(v) => { setShowVendorForm(false); setSelectedId(v.id); reload() }} />
      )}
    </div>
  )
}

// ── Vendor detail panel ──

function VendorDetail({ vendor, onReload, onEdit, onDelete }: {
  vendor: VendorContact; onReload: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [tab, setTab] = useState<'bills' | 'payments' | 'info'>('bills')
  const [showBillForm, setShowBillForm] = useState(false)
  const [editingBill, setEditingBill] = useState<VendorBill | null>(null)
  const [paymentForBill, setPaymentForBill] = useState<VendorBill | null>(null)

  const bills = getBillsForVendor(vendor.id)
  const payments = getPaymentsForVendor(vendor.id)
  const outstanding = bills.reduce((s, b) => s + (b.status === 'void' ? 0 : b.balanceDueCents), 0)

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 flex items-start justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-900">{vendor.name}</h2>
          <p className="text-xs text-gray-500 mt-1">
            {vendor.contactName && `${vendor.contactName} · `}
            {vendor.phone && `${vendor.phone} · `}
            {vendor.email}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {[vendor.address, vendor.city, vendor.state, vendor.zip].filter(Boolean).join(', ')}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={onEdit} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg">Edit</button>
          <button onClick={onDelete} className="text-sm text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg">Delete</button>
        </div>
      </div>

      <div className="px-6 py-4 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Outstanding Balance</p>
          <p className={`text-2xl font-bold ${outstanding > 0 ? 'text-orange-600' : 'text-gray-400'}`}>{fmt(outstanding)}</p>
        </div>
        <button onClick={() => { setEditingBill(null); setShowBillForm(true) }}
          className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">+ Create Bill</button>
      </div>

      <div className="border-b border-gray-100 px-6">
        <div className="flex gap-1 pt-3">
          {([['bills', 'Bills'], ['payments', 'Payments'], ['info', 'Info']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === k ? 'border-orange-500 text-orange-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>{l}</button>
          ))}
        </div>
      </div>

      <div className="p-6">
        {tab === 'bills' && (
          <BillsList bills={bills}
            onEdit={(b) => { setEditingBill(b); setShowBillForm(true) }}
            onRecordPayment={(b) => setPaymentForBill(b)}
            onApprove={(b) => { updateBill(b.id, { status: 'approved' }); onReload() }}
            onVoid={(b) => {
              if (!confirm(`Void bill ${b.billNumber}?`)) return
              updateBill(b.id, { status: 'void' }); onReload()
            }}
          />
        )}
        {tab === 'payments' && <PaymentsList payments={payments} />}
        {tab === 'info' && <VendorInfo vendor={vendor} />}
      </div>

      {showBillForm && (
        <BillForm initial={editingBill} vendor={vendor}
          onCancel={() => setShowBillForm(false)}
          onSaved={() => { setShowBillForm(false); onReload() }} />
      )}
      {paymentForBill && (
        <PaymentForm bill={paymentForBill} vendor={vendor}
          onCancel={() => setPaymentForBill(null)}
          onSaved={() => { setPaymentForBill(null); onReload() }} />
      )}
    </div>
  )
}

function BillsList({ bills, onEdit, onRecordPayment, onApprove, onVoid }: {
  bills: VendorBill[];
  onEdit: (b: VendorBill) => void;
  onRecordPayment: (b: VendorBill) => void;
  onApprove: (b: VendorBill) => void;
  onVoid: (b: VendorBill) => void;
}) {
  if (bills.length === 0) return <div className="text-center py-12 text-gray-400 text-sm">No bills yet for this vendor.</div>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm table-responsive-cards">
        <thead className="text-xs text-gray-500 uppercase font-semibold tracking-widest">
          <tr className="border-b border-gray-100">
            <th className="px-3 py-2 text-left">Bill #</th>
            <th className="px-3 py-2 text-left">Date</th>
            <th className="px-3 py-2 text-left">Due</th>
            <th className="px-3 py-2 text-right">Total</th>
            <th className="px-3 py-2 text-right">Balance</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {bills.map(b => (
            <tr key={b.id} className="hover:bg-gray-50">
              <td data-label="Bill #" className="px-3 py-2 text-gray-900 font-medium">{b.billNumber}</td>
              <td data-label="Date" className="px-3 py-2 text-gray-600">{b.billDate}</td>
              <td data-label="Due" className="px-3 py-2 text-gray-600">{b.dueDate}</td>
              <td data-label="Total" className="px-3 py-2 text-right">{fmt(b.totalCents)}</td>
              <td data-label="Balance" className={`px-3 py-2 text-right font-semibold ${b.balanceDueCents > 0 ? 'text-orange-600' : 'text-gray-400'}`}>
                {fmt(b.balanceDueCents)}
              </td>
              <td data-label="Status" className="px-3 py-2"><span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase ${STATUS_COLORS[b.status]}`}>{b.status}</span></td>
              <td data-label="Actions" className="px-3 py-2 text-right">
                <button onClick={() => onEdit(b)} className="text-blue-600 hover:underline text-xs mr-2">Edit</button>
                {b.status === 'received' && (
                  <button onClick={() => onApprove(b)} className="text-indigo-600 hover:underline text-xs mr-2">Approve</button>
                )}
                {b.balanceDueCents > 0 && b.status !== 'void' && (
                  <button onClick={() => onRecordPayment(b)} className="text-green-600 hover:underline text-xs mr-2">Pay</button>
                )}
                {b.status !== 'void' && (
                  <button onClick={() => onVoid(b)} className="text-red-600 hover:underline text-xs">Void</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PaymentsList({ payments }: { payments: VendorPayment[] }) {
  if (payments.length === 0) return <div className="text-center py-12 text-gray-400 text-sm">No payments yet for this vendor.</div>
  return (
    <div className="divide-y divide-gray-50">
      {payments.map(p => (
        <div key={p.id} className="py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900">Bill {p.billNumber}</p>
            <p className="text-xs text-gray-500">{p.paymentDate} · {p.paymentMethod.replace(/_/g, ' ')}{p.referenceNumber && ` · Ref ${p.referenceNumber}`}</p>
          </div>
          <p className="text-sm font-bold text-green-600">{fmt(p.amountCents)}</p>
        </div>
      ))}
    </div>
  )
}

function VendorInfo({ vendor }: { vendor: VendorContact }) {
  const row = (label: string, value?: string) => value ? (
    <div className="grid grid-cols-3 gap-2 py-2 border-b border-gray-50">
      <div className="text-xs text-gray-500 uppercase font-semibold tracking-wide">{label}</div>
      <div className="col-span-2 text-sm text-gray-900">{value}</div>
    </div>
  ) : null
  return (
    <div>
      {row('Contact', vendor.contactName)}
      {row('Phone', vendor.phone)}
      {row('Email', vendor.email)}
      {row('Address', [vendor.address, vendor.city, vendor.state, vendor.zip].filter(Boolean).join(', '))}
      {row('Payment Terms', TERMS_LABELS[vendor.paymentTerms])}
      {row('Account Number', vendor.accountNumber)}
      {row('Notes', vendor.notes)}
    </div>
  )
}

// ── Vendor form ──

function VendorForm({ initial, onCancel, onSaved }: { initial: VendorContact | null; onCancel: () => void; onSaved: (v: VendorContact) => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [contactName, setContactName] = useState(initial?.contactName ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [address, setAddress] = useState(initial?.address ?? '')
  const [city, setCity] = useState(initial?.city ?? '')
  const [state, setState] = useState(initial?.state ?? '')
  const [zip, setZip] = useState(initial?.zip ?? '')
  const [paymentTerms, setPaymentTerms] = useState<PaymentTerms>(initial?.paymentTerms ?? 'net_30')
  const [accountNumber, setAccountNumber] = useState(initial?.accountNumber ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)

  function handleSave() {
    if (!name.trim()) return
    const data = { name: name.trim(), contactName, phone, email, address, city, state, zip, paymentTerms, accountNumber, notes, isActive }
    const v = initial ? updateVendor(initial.id, data)! : createVendor(data)
    onSaved(v)
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto modal-responsive">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">{initial ? 'Edit' : 'New'} Vendor</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <Field label="Vendor Name *"><input value={name} onChange={e => setName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact Name"><input value={contactName} onChange={e => setContactName(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
            <Field label="Phone"><input value={phone} onChange={e => setPhone(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          </div>
          <Field label="Email"><input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          <Field label="Address">
            <AddressAutocomplete value={address} onChange={setAddress}
              onSelect={p => { setAddress(p.line1 || p.formatted); if (p.city) setCity(p.city); if (p.state) setState(p.state); if (p.zip) setZip(p.zip) }}
              placeholder="Street address…" />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="City"><input value={city} onChange={e => setCity(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
            <Field label="State"><input value={state} onChange={e => setState(e.target.value)} maxLength={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
            <Field label="ZIP"><input value={zip} onChange={e => setZip(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Payment Terms">
              <select value={paymentTerms} onChange={e => setPaymentTerms(e.target.value as PaymentTerms)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {(Object.entries(TERMS_LABELS) as [PaymentTerms, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Account Number"><input value={accountNumber} onChange={e => setAccountNumber(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          </div>
          <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} /><span>Active</span></label>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2">Cancel</button>
          <button onClick={handleSave} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">Save</button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="text-xs text-gray-500 font-semibold uppercase block mb-1">{label}</label>{children}</div>
}

// ── Bill form ──

function BillForm({ initial, vendor, onCancel, onSaved }: {
  initial: VendorBill | null; vendor: VendorContact;
  onCancel: () => void; onSaved: () => void;
}) {
  const [billNumber, setBillNumber] = useState(initial?.billNumber ?? '')
  const [billDate, setBillDate] = useState(initial?.billDate ?? new Date().toISOString().slice(0, 10))
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? computeDueDate(vendor.paymentTerms))
  const [category, setCategory] = useState<VendorBillCategory>(initial?.category ?? 'materials')
  const [jobId, setJobId] = useState(initial?.jobId ?? '')
  const [jobName, setJobName] = useState(initial?.jobName ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [lineItems, setLineItems] = useState<VendorBillLineItem[]>(initial?.lineItems ?? [
    { id: uid(), description: '', quantity: 1, unitCostCents: 0, totalCents: 0, sortOrder: 0 }
  ])
  const [taxCents, setTaxCents] = useState(initial?.taxCents ?? 0)
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [showJobSearch, setShowJobSearch] = useState(false)
  const [jobSearch, setJobSearch] = useState('')

  const subtotalCents = lineItems.reduce((s, li) => s + li.totalCents, 0)
  const totalCents = subtotalCents + taxCents

  function updateLine(id: string, updates: Partial<VendorBillLineItem>) {
    setLineItems(prev => prev.map(li => {
      if (li.id !== id) return li
      const merged = { ...li, ...updates }
      merged.totalCents = Math.round(merged.quantity * merged.unitCostCents)
      return merged
    }))
  }
  function addLine() {
    setLineItems(prev => [...prev, { id: uid(), description: '', quantity: 1, unitCostCents: 0, totalCents: 0, sortOrder: prev.length }])
  }
  function removeLine(id: string) { setLineItems(prev => prev.filter(li => li.id !== id)) }

  // Job search reads from the API-backed cache.
  const jobs = useMemo(() => getJobs(), [])
  const jobResults = jobs.filter(j => !jobSearch || (j.customerName || '').toLowerCase().includes(jobSearch.toLowerCase())).slice(0, 8)

  function handleSave() {
    if (!billNumber.trim() || lineItems.length === 0) return
    const data = {
      vendorId: vendor.id, vendorName: vendor.name,
      billNumber: billNumber.trim(), description, status: (initial?.status ?? 'received') as VendorBillStatus,
      lineItems, subtotalCents, taxCents, totalCents, amountPaidCents: initial?.amountPaidCents ?? 0,
      billDate, dueDate, category, jobId: jobId || undefined, jobName: jobName || undefined,
      notes, createdBy: 'user',
    }
    if (initial) updateBill(initial.id, data)
    else createBill(data)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto modal-responsive">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">{initial ? 'Edit' : 'New'} Bill · {vendor.name}</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Bill Number *"><input value={billNumber} onChange={e => setBillNumber(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
            <Field label="Bill Date"><input type="date" value={billDate} onChange={e => setBillDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
            <Field label="Due Date"><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category">
              <select value={category} onChange={e => setCategory(e.target.value as VendorBillCategory)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {(Object.entries(CATEGORY_LABELS) as [VendorBillCategory, string][]).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Linked Job (optional)">
              <div className="relative">
                <input value={jobName} onChange={e => { setJobName(e.target.value); setShowJobSearch(true); setJobSearch(e.target.value) }}
                  onFocus={() => setShowJobSearch(true)}
                  placeholder="Search jobs..."
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                {showJobSearch && jobResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto z-10">
                    {jobResults.map((j: any) => (
                      <button key={j.id} onClick={() => { setJobId(j.id); setJobName(j.customerName || j.title || j.id); setShowJobSearch(false) }}
                        className="w-full px-3 py-2 text-left hover:bg-orange-50 text-sm">
                        {j.customerName || j.title || j.id}
                      </button>
                    ))}
                    <button onClick={() => { setJobId(''); setJobName(''); setShowJobSearch(false) }}
                      className="w-full px-3 py-2 text-left hover:bg-gray-50 text-xs text-gray-500 border-t border-gray-100">Clear</button>
                  </div>
                )}
              </div>
            </Field>
          </div>
          <Field label="Description"><input value={description} onChange={e => setDescription(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>

          {/* Line items */}
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase block mb-2">Line Items</label>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr><th className="px-3 py-2 text-left">Description</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit Cost</th><th className="px-3 py-2 text-right">Total</th><th></th></tr>
                </thead>
                <tbody>
                  {lineItems.map(li => (
                    <tr key={li.id} className="border-t border-gray-100">
                      <td className="px-2 py-1"><input value={li.description} onChange={e => updateLine(li.id, { description: e.target.value })} className="w-full border-0 text-sm px-2 py-1 focus:bg-white focus:ring-1 focus:ring-orange-300 rounded" /></td>
                      <td className="px-2 py-1"><input type="number" step="0.01" value={li.quantity} onChange={e => updateLine(li.id, { quantity: parseFloat(e.target.value) || 0 })} className="w-20 text-right border-0 text-sm px-2 py-1 focus:bg-white focus:ring-1 focus:ring-orange-300 rounded" /></td>
                      <td className="px-2 py-1"><input type="number" step="0.01" value={(li.unitCostCents / 100).toFixed(2)} onChange={e => updateLine(li.id, { unitCostCents: Math.round(parseFloat(e.target.value) * 100) || 0 })} className="w-28 text-right border-0 text-sm px-2 py-1 focus:bg-white focus:ring-1 focus:ring-orange-300 rounded" /></td>
                      <td className="px-2 py-1 text-right font-medium">{fmt(li.totalCents)}</td>
                      <td className="px-2 py-1"><button onClick={() => removeLine(li.id)} className="text-red-500 hover:bg-red-50 rounded px-2">×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button onClick={addLine} className="mt-2 text-sm text-orange-600 hover:underline">+ Add line item</button>
          </div>

          <div className="grid grid-cols-2 gap-3 ml-auto max-w-xs">
            <span className="text-sm text-gray-500 text-right">Subtotal</span><span className="text-sm text-right font-medium">{fmt(subtotalCents)}</span>
            <span className="text-sm text-gray-500 text-right">Tax ($)</span><input type="number" step="0.01" value={(taxCents / 100).toFixed(2)} onChange={e => setTaxCents(Math.round(parseFloat(e.target.value) * 100) || 0)} className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm text-right" />
            <span className="text-sm font-bold text-gray-900 text-right">Total</span><span className="text-sm text-right font-bold">{fmt(totalCents)}</span>
          </div>

          <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2">Cancel</button>
          <button onClick={handleSave} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">Save Bill</button>
        </div>
      </div>
    </div>
  )
}

function computeDueDate(terms: PaymentTerms): string {
  const now = new Date()
  const days = terms === 'net_15' ? 15 : terms === 'net_30' ? 30 : terms === 'net_45' ? 45 : terms === 'net_60' ? 60 : 0
  const due = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
  return due.toISOString().slice(0, 10)
}

// ── Payment form ──

function PaymentForm({ bill, vendor, onCancel, onSaved }: { bill: VendorBill; vendor: VendorContact; onCancel: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState((bill.balanceDueCents / 100).toFixed(2))
  const [paymentMethod, setPaymentMethod] = useState<VendorPaymentMethod>('check')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  function handleSave() {
    const amountCents = Math.round(parseFloat(amount) * 100)
    if (amountCents <= 0) return
    recordVendorPayment({
      billId: bill.id, billNumber: bill.billNumber,
      vendorId: vendor.id, vendorName: vendor.name,
      amountCents, paymentMethod, referenceNumber, paymentDate,
      recordedBy: 'user', notes,
    })
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto modal-responsive">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Record Payment</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="text-gray-500 text-xs uppercase font-semibold">Paying Bill</p>
            <p className="font-medium text-gray-900">{bill.billNumber} · {vendor.name}</p>
            <p className="text-xs text-gray-500 mt-1">Balance: {fmt(bill.balanceDueCents)}</p>
          </div>
          <Field label="Amount ($)"><input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          <Field label="Method">
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as VendorPaymentMethod)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="check">Check</option><option value="ach">ACH</option><option value="wire">Wire</option><option value="credit_card">Credit Card</option><option value="cash">Cash</option><option value="other">Other</option>
            </select>
          </Field>
          <Field label="Reference / Check #"><input value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          <Field label="Payment Date"><input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
          <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></Field>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2">Cancel</button>
          <button onClick={handleSave} className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg">Record Payment</button>
        </div>
      </div>
    </div>
  )
}
