import { useState } from 'react'

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

const SAMPLE_CUSTOMERS: Customer[] = [
  {
    id: 'c1', firstName: 'Maria', lastName: 'Blyth',
    phone: '(352) 555-0101', email: 'maria.blyth@email.com',
    serviceAddress: '4821 NW 34th St, Gainesville, FL 32605',
    billingAddress: '', billingDifferent: false,
    leadSource: 'Google', notes: 'HOA requires white vinyl only. Gate must swing inward.',
    tags: ['Residential', 'HOA'], createdAt: '2025-01-14',
    salesRep: '', firstApptDate: '',
  },
  {
    id: 'c2', firstName: 'Ricardo', lastName: 'Lopez',
    phone: '(352) 555-0182', email: 'r.lopez@gmail.com',
    serviceAddress: '1203 SW 75th St, Gainesville, FL 32607',
    billingAddress: '', billingDifferent: false,
    leadSource: 'Referral', notes: 'Dog fence — must be at least 6ft. Has two large dogs.',
    tags: ['Residential'], createdAt: '2025-02-03',
    salesRep: '', firstApptDate: '',
  },
  {
    id: 'c3', firstName: 'Greg', lastName: 'Festivan',
    phone: '(352) 555-0244', email: 'gfestivan@company.com',
    serviceAddress: '8901 NW 39th Ave, Gainesville, FL 32606',
    billingAddress: '200 SW 13th St Suite 400, Gainesville, FL 32601',
    billingDifferent: true,
    leadSource: 'Google', notes: 'Commercial property. Needs invoice for net-30 terms.',
    tags: ['Commercial', 'VIP'], createdAt: '2025-02-18',
    salesRep: '', firstApptDate: '',
  },
]

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
              <label className="text-xs text-gray-500 mb-1 block">Service Address</label>
              <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Where the fence is being installed" value={form.serviceAddress} onChange={e => setForm(f => ({ ...f, serviceAddress: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="billingDiff" checked={form.billingDifferent} onChange={e => setForm(f => ({ ...f, billingDifferent: e.target.checked }))} className="accent-orange-500" />
              <label htmlFor="billingDiff" className="text-sm text-gray-600">Billing address is different from service address</label>
            </div>
            {form.billingDifferent && (
              <div>
                <label className="text-xs text-gray-500 mb-1 block">Billing Address</label>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Billing address" value={form.billingAddress} onChange={e => setForm(f => ({ ...f, billingAddress: e.target.value }))} />
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

// ── Customer Detail ───────────────────────────────────────────────────────────

function CustomerDetail({
  customer, quotes, importedQuotes, jobs, files,
  onEdit, onNewQuote, onFileUpload, onDeleteFile,
}: {
  customer: Customer
  quotes: Quote[]
  importedQuotes: ImportedQuote[]
  jobs: Job[]
  files: CustomerFile[]
  onEdit: () => void
  onNewQuote: () => void
  onFileUpload: (f: CustomerFile) => void
  onDeleteFile: (id: string) => void
}) {
  const [activeTab, setActiveTab] = useState<'overview' | 'quotes' | 'jobs' | 'files'>('overview')

  const totalRevenue = quotes.filter(q => q.status === 'SOLD').reduce((s, q) => s + q.price, 0)
    + importedQuotes.reduce((s, q) => s + q.quotedPrice, 0)
  const allQuoteCount = quotes.length + importedQuotes.length

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    onFileUpload({
      id: uid(),
      customerId: customer.id,
      name: file.name,
      size: file.size > 1024 * 1024 ? `${(file.size / 1024 / 1024).toFixed(1)} MB` : `${(file.size / 1024).toFixed(0)} KB`,
      type: file.type,
      uploadedAt: new Date().toISOString().slice(0, 10),
    })
    e.target.value = ''
  }

  function fileIcon(type: string) {
    if (type.includes('pdf')) return '📄'
    if (type.includes('image')) return '🖼️'
    if (type.includes('word') || type.includes('document')) return '📝'
    if (type.includes('sheet') || type.includes('excel')) return '📊'
    return '📎'
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-8 py-6 border-b border-gray-200 bg-white">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-orange-500 flex items-center justify-center text-white text-xl font-black">
              {customer.firstName?.[0] ?? ''}{customer.lastName?.[0] ?? ''}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{customer.firstName} {customer.lastName}</h2>
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
            <button onClick={onNewQuote} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg">+ New Quote</button>
            <button onClick={onEdit} className="border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50">Edit</button>
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

        <div className="flex gap-1 mt-5 bg-gray-100 rounded-xl p-1 w-fit">
          {(['overview', 'quotes', 'jobs', 'files'] as const).map(t => (
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
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Quotes from FencePro</p>
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
                      <tr key={q.id} className="hover:bg-gray-50">
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
                <button onClick={onNewQuote} className="text-orange-500 text-sm hover:underline">Create first quote</button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'jobs' && (
          <div className="space-y-3">
            {jobs.length === 0 ? (
              <div className="text-center py-16 border border-dashed border-gray-200 rounded-2xl">
                <p className="text-gray-400 text-sm">No jobs yet</p>
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

        {activeTab === 'files' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{files.length} file{files.length !== 1 ? 's' : ''} uploaded</p>
              <label className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg cursor-pointer">
                + Upload File
                <input type="file" className="hidden" onChange={handleFileInput} />
              </label>
            </div>
            {files.length === 0 ? (
              <label className="block border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center cursor-pointer hover:border-orange-300 transition-colors">
                <p className="text-4xl mb-3">📎</p>
                <p className="text-gray-500 font-medium">Drop files here or click to upload</p>
                <p className="text-gray-400 text-sm mt-1">Contracts, HOA approvals, site photos, anything relevant</p>
                <input type="file" className="hidden" onChange={handleFileInput} />
              </label>
            ) : (
              <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">File</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Size</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Uploaded</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {files.map(f => (
                      <tr key={f.id} className="hover:bg-gray-50 group">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{fileIcon(f.type)}</span>
                            <span className="font-medium text-gray-800">{f.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400 text-xs">{f.size}</td>
                        <td className="px-4 py-3 text-right text-gray-400 text-xs">{f.uploadedAt}</td>
                        <td className="px-3 py-3">
                          <button onClick={() => onDeleteFile(f.id)} className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 text-lg leading-none">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CustomersPage({ onNewQuote }: { onNewQuote?: () => void }) {
  const [importedQuotes, setImportedQuotes] = useState<ImportedQuote[]>(() => {
    try {
      const raw = localStorage.getItem('fencepro_imported_quotes')
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })
  const [customers, setCustomers] = useState<Customer[]>(() => {
    try {
      const raw = localStorage.getItem('fencepro_customers')
      return raw ? JSON.parse(raw) : SAMPLE_CUSTOMERS
    } catch { return SAMPLE_CUSTOMERS }
  })
  const [quotes] = useState<Quote[]>(SAMPLE_QUOTES)
  const [jobs] = useState<Job[]>(SAMPLE_JOBS)
  const [files, setFiles] = useState<CustomerFile[]>(() => {
    try {
      const raw = localStorage.getItem('fencepro_files')
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<'view' | 'new' | 'edit'>('view')
  const [search, setSearch] = useState('')

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
    setCustomers(prev => {
      const updated = prev.find(x => x.id === c.id)
        ? prev.map(x => x.id === c.id ? c : x)
        : [c, ...prev]
      localStorage.setItem('fencepro_customers', JSON.stringify(updated))
      return updated
    })
    setSelectedId(c.id)
    setMode('view')
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this customer?')) return
    setCustomers(prev => {
      const updated = prev.filter(c => c.id !== id)
      localStorage.setItem('fencepro_customers', JSON.stringify(updated))
      return updated
    })
    if (selectedId === id) { setSelectedId(null); setMode('view') }
  }

  function handleCSVImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
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

      setCustomers(prev => {
        const existingPhones = new Set(prev.map(c => c.phone).filter(Boolean))
        const existingEmails = new Set(prev.map(c => c.email).filter(Boolean))
        const fresh = importedCustomers.filter(c =>
          (!c.phone || !existingPhones.has(c.phone)) &&
          (!c.email || !existingEmails.has(c.email))
        )
        const updated = [...fresh, ...prev]
        localStorage.setItem('fencepro_customers', JSON.stringify(updated))
        return updated
      })

      setImportedQuotes(prev => {
        const updated = [...importedQuotesList, ...prev]
        localStorage.setItem('fencepro_imported_quotes', JSON.stringify(updated))
        return updated
      })

      alert(`Imported ${importedCustomers.length} customers and ${importedQuotesList.length} quote records.`)
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
                <button onClick={e => { e.stopPropagation(); handleDelete(c.id) }} className="absolute right-3 top-3 text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 text-lg leading-none">×</button>
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
          onNewQuote={() => onNewQuote?.()}
          onFileUpload={f => setFiles(prev => {
            const updated = [...prev, f]
            localStorage.setItem('fencepro_files', JSON.stringify(updated))
            return updated
          })}
          onDeleteFile={id => setFiles(prev => {
            const updated = prev.filter(f => f.id !== id)
            localStorage.setItem('fencepro_files', JSON.stringify(updated))
            return updated
          })}
        />
      )}
    </div>
  )
}