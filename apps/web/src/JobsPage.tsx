import { useState, useRef, useEffect } from 'react'
import { fireSalesStageChange } from './automationTrigger'
import { upsertCustomer, logCustomerActivity, getCustomers } from './customerStore'
import { toast } from './toast'
import { applySignedContractTransition } from './signedContractFlow'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PipelineLead {
  id: string
  customerId?: string
  firstName: string
  lastName: string
  phone: string
  email: string
  address: string
  leadSource: string
  leadTemp: number
  fenceType: string
  sections: number
  quotePrice: number
  crew: string
  scheduledDate: string
  jobValue: number
  paymentStatus: string
  balanceDue: number
  notes: string
  stage: string
  createdAt: string
  lastMoved: string
  assignedRep?: string
}

export const DEFAULT_STAGES = [
  'First Contact',
  'Appointment',
  'Estimating',
  'Pending Signature',
  'Signed Contract',
  'Job Prep',
  'Pending Start',
  'Jobs In Progress',
  'Job Complete',
  'Pending Payment',
  'Paid & Closed',
  'Lost Sale',
  'No Answer',
]

export const PRE_SALE_STAGES   = new Set(['First Contact', 'Appointment', 'Estimating', 'Pending Signature'])
export const PRODUCTION_STAGES = new Set(['Signed Contract', 'Job Prep', 'Pending Start', 'Jobs In Progress'])
export const CLOSING_STAGES    = new Set(['Job Complete', 'Pending Payment', 'Paid & Closed'])
export const DEAD_STAGES       = new Set(['Lost Sale', 'No Answer'])

export const STAGE_COLORS: Record<string, string> = {
  'First Contact':     'bg-gray-500',
  'Appointment':       'bg-blue-500',
  'Estimating':        'bg-indigo-500',
  'Pending Signature': 'bg-purple-500',
  'Signed Contract':   'bg-green-500',
  'Job Prep':          'bg-teal-500',
  'Pending Start':     'bg-cyan-500',
  'Jobs In Progress':  'bg-orange-500',
  'Job Complete':      'bg-emerald-500',
  'Pending Payment':   'bg-yellow-500',
  'Paid & Closed':     'bg-green-700',
  'Lost Sale':         'bg-red-500',
  'No Answer':         'bg-gray-400',
}

const uid = () => Math.random().toString(36).slice(2, 9)

const FLAME_COLORS = ['text-blue-400','text-cyan-400','text-yellow-400','text-orange-500','text-red-500']

function FlameDisplay({ value }: { value: number }) {
  if (!value) return null
  return (
    <span className={`text-sm ${FLAME_COLORS[value - 1]}`}>
      {'🔥'.repeat(value)}
    </span>
  )
}

function loadConfiguredStages(): string[] | null {
  try {
    const raw = localStorage.getItem('fencepro_config')
    if (!raw) return null
    const cfg = JSON.parse(raw)
    if (Array.isArray(cfg.pipelineStages) && cfg.pipelineStages.length > 0) return cfg.pipelineStages
  } catch {}
  return null
}

export function loadPipeline(): { leads: PipelineLead[], stages: string[] } {
  const configured = loadConfiguredStages()
  try {
    const raw = localStorage.getItem('fencepro_pipeline')
    if (raw) {
      const parsed = JSON.parse(raw)
      // Prefer configured stages if available (keeps pipeline board in sync with Settings)
      if (configured) return { leads: parsed.leads || [], stages: configured }
      return parsed
    }

    // First load — seed from existing customers
    const customers = getCustomers()
    const leads: PipelineLead[] = customers.map((c) => ({
      id: uid(),
      firstName: c.firstName ?? '',
      lastName:  c.lastName ?? '',
      phone:     c.phone ?? '',
      email:     c.email ?? '',
      address:   c.serviceAddress ?? '',
      leadSource: c.leadSource ?? '',
      leadTemp:  0,
      fenceType: '',
      sections:  0,
      quotePrice: 0,
      crew: '',
      scheduledDate: '',
      jobValue: 0,
      paymentStatus: '',
      balanceDue: 0,
      notes: c.notes ?? '',
      stage: c.jobStatus === 'Paid & Closed' ? 'Paid & Closed' : c.jobStatus === 'Lost' ? 'Lost Sale' : 'First Contact',
      createdAt: c.createdAt ?? new Date().toISOString().slice(0, 10),
      lastMoved: new Date().toISOString().slice(0, 10),
    }))

    const result = { leads, stages: DEFAULT_STAGES }
    localStorage.setItem('fencepro_pipeline', JSON.stringify(result))
    return result
  } catch { return { leads: [], stages: DEFAULT_STAGES } }
}

export function savePipeline(leads: PipelineLead[], stages: string[]) {
  localStorage.setItem('fencepro_pipeline', JSON.stringify({ leads, stages }))
}

// ── Quick Add Modal ───────────────────────────────────────────────────────────

export function QuickAddModal({
  stage,
  onAdd,
  onClose,
}: {
  stage: string
  onAdd: (lead: PipelineLead) => void
  onClose: () => void
}) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName]   = useState('')
  const [phone, setPhone]         = useState('')
  const [email, setEmail]         = useState('')
  const [street, setStreet]       = useState('')
  const [city, setCity]           = useState('')
  const [state, setState]         = useState('')
  const [zip, setZip]             = useState('')
  const [leadSource, setLeadSource] = useState('')
  const [notes, setNotes]         = useState('')

  // Combine the four address fields into the single string the data layer expects.
  function composedAddress(): string {
    const cityStateZip = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '')
    return [street, cityStateZip].filter(s => s.trim()).join(', ').trim()
  }

  function handleAdd() {
    if (!firstName.trim()) return
    const address = composedAddress()
    // Always create a matching customer row — no lead-without-customer.
    const { customer, created } = upsertCustomer({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone, email,
      serviceAddress: address,
      leadSource, notes,
    })
    const lead: PipelineLead = {
      id: uid(),
      customerId: customer.id,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone, email: customer.email,
      address: customer.serviceAddress,
      leadSource: customer.leadSource, notes: customer.notes,
      leadTemp: 0, fenceType: '', sections: 0,
      quotePrice: 0, crew: '', scheduledDate: '',
      jobValue: 0, paymentStatus: '', balanceDue: 0,
      stage,
      createdAt: customer.createdAt,
      lastMoved: new Date().toISOString().slice(0, 10),
    }
    if (created) {
      logCustomerActivity(customer.id, `Lead added to pipeline at ${stage}`, { kind: 'stage_change' })
    }
    onAdd(lead)
    toast.success(created ? 'Lead added' : 'Lead linked to existing customer',
      created ? 'Also created a customer record.' : undefined)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px]">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Add to {stage}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Name and phone is all you need to get started</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">First Name *</label>
              <input
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={firstName}
                onChange={e => setFirstName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Last Name</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={lastName}
                onChange={e => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Phone</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="(352) 555-0100"
              value={phone}
              onChange={e => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Email</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Street Address</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="1349 SE 32nd St"
              value={street}
              onChange={e => setStreet(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">City</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="Ocala"
                value={city}
                onChange={e => setCity(e.target.value)}
              />
            </div>
            <div className="w-20">
              <label className="text-xs text-gray-500 mb-1 block">State</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="FL"
                maxLength={2}
                value={state}
                onChange={e => setState(e.target.value.toUpperCase())}
              />
            </div>
            <div className="w-24">
              <label className="text-xs text-gray-500 mb-1 block">Zip</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="34470"
                inputMode="numeric"
                maxLength={10}
                value={zip}
                onChange={e => setZip(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Lead Source</label>
            <select
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              value={leadSource}
              onChange={e => setLeadSource(e.target.value)}
            >
              <option value="">Select...</option>
              {['Google','Facebook','Instagram','Yard Sign','Referral','Door Hanger','Repeat Customer','Nextdoor','Other'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Notes</label>
            <textarea
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50">
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={!firstName.trim()}
              className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-semibold py-2.5 rounded-xl"
            >
              Add Lead
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Lead Detail Drawer ────────────────────────────────────────────────────────

export function LeadDrawer({
  lead,
  stages,
  onClose,
  onUpdate,
  onDelete,
}: {
  lead: PipelineLead
  stages: string[]
  onClose: () => void
  onUpdate: (lead: PipelineLead) => void
  onDelete: (id: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<PipelineLead>({ ...lead })

  function save() {
    onUpdate(form)
    setEditing(false)
  }

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full lg:w-[480px] bg-white shadow-2xl flex flex-col overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">{lead.firstName} {lead.lastName}</h2>
            <span className={`text-xs text-white px-2 py-0.5 rounded-full ${STAGE_COLORS[lead.stage] ?? 'bg-gray-400'}`}>
              {lead.stage}
            </span>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button onClick={save} className="bg-orange-500 text-white text-sm font-semibold px-3 py-1.5 rounded-lg">Save</button>
                <button onClick={() => { setForm({ ...lead }); setEditing(false) }} className="border border-gray-200 text-gray-600 text-sm px-3 py-1.5 rounded-lg">Cancel</button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} className="border border-gray-200 text-gray-600 text-sm px-3 py-1.5 rounded-lg hover:bg-gray-50">Edit</button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none ml-1">×</button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Stage mover */}
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Move to Stage</p>
            <div className="flex flex-wrap gap-1.5">
              {stages.map(s => (
                <button
                  key={s}
                  onClick={() => onUpdate({ ...lead, stage: s, lastMoved: new Date().toISOString().slice(0, 10) })}
                  className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-colors ${
                    lead.stage === s
                      ? `${STAGE_COLORS[s] ?? 'bg-gray-500'} text-white border-transparent`
                      : 'border-gray-200 text-gray-500 hover:border-gray-400'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Lead temp */}
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Lead Temperature</p>
            <div className="flex gap-1">
              {[1,2,3,4,5].map(i => (
                <button
                  key={i}
                  onClick={() => onUpdate({ ...lead, leadTemp: i })}
                  className={`text-xl ${i <= lead.leadTemp ? FLAME_COLORS[i-1] : 'text-gray-200'} hover:scale-125 transition-transform`}
                >
                  🔥
                </button>
              ))}
            </div>
          </div>

          {/* Contact info */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</p>
            {editing ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="First Name" value={form.firstName} onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))} />
                  <input className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Last Name" value={form.lastName} onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))} />
                </div>
                <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Phone" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Address" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>
            ) : (
              <div className="space-y-1.5">
                {[
                  { label: 'Phone',   value: lead.phone },
                  { label: 'Email',   value: lead.email },
                  { label: 'Address', value: lead.address },
                  { label: 'Source',  value: lead.leadSource },
                ].filter(r => r.value).map(r => (
                  <div key={r.label} className="flex gap-3">
                    <span className="text-xs text-gray-400 w-16 shrink-0">{r.label}</span>
                    <span className="text-sm text-gray-800">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Job info */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Job Info</p>
            {editing ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <input className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Fence Type" value={form.fenceType} onChange={e => setForm(f => ({ ...f, fenceType: e.target.value }))} />
                  <input type="number" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Sections" value={form.sections || ''} onChange={e => setForm(f => ({ ...f, sections: Number(e.target.value) }))} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Quote Price" value={form.quotePrice || ''} onChange={e => setForm(f => ({ ...f, quotePrice: Number(e.target.value) }))} />
                  <input className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Crew" value={form.crew} onChange={e => setForm(f => ({ ...f, crew: e.target.value }))} />
                </div>
                <input type="date" className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))} />
                <div className="grid grid-cols-2 gap-2">
                  <input type="number" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Job Value" value={form.jobValue || ''} onChange={e => setForm(f => ({ ...f, jobValue: Number(e.target.value) }))} />
                  <input type="number" className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="Balance Due" value={form.balanceDue || ''} onChange={e => setForm(f => ({ ...f, balanceDue: Number(e.target.value) }))} />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                {[
                  { label: 'Type',      value: lead.fenceType },
                  { label: 'Sections',  value: lead.sections ? String(lead.sections) : '' },
                  { label: 'Quote',     value: lead.quotePrice ? fmt(lead.quotePrice) : '' },
                  { label: 'Crew',      value: lead.crew },
                  { label: 'Scheduled', value: lead.scheduledDate },
                  { label: 'Job Value', value: lead.jobValue ? fmt(lead.jobValue) : '' },
                  { label: 'Balance',   value: lead.balanceDue ? fmt(lead.balanceDue) : '' },
                ].filter(r => r.value).map(r => (
                  <div key={r.label} className="flex gap-3">
                    <span className="text-xs text-gray-400 w-16 shrink-0">{r.label}</span>
                    <span className="text-sm text-gray-800">{r.value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Notes</p>
            {editing ? (
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                rows={4}
                value={form.notes}
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              />
            ) : (
              <p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-3 min-h-[60px]">
                {lead.notes || <span className="text-gray-400">No notes yet</span>}
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-gray-100">
            <button
              onClick={() => { if (confirm('Delete this lead?')) { onDelete(lead.id); onClose() } }}
              className="text-red-400 hover:text-red-600 text-sm font-medium"
            >
              Delete lead
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
// ── Pipeline Card ─────────────────────────────────────────────────────────────

function PipelineCard({
  lead,
  stages,
  onUpdate,
  onClick,
  onDragStart,
}: {
  lead: PipelineLead
  stages: string[]
  onUpdate: (lead: PipelineLead) => void
  onClick: () => void
  onDragStart: (e: React.DragEvent, id: string) => void
}) {
  const isPreSale    = PRE_SALE_STAGES.has(lead.stage)
  const isProduction = PRODUCTION_STAGES.has(lead.stage)
  const isClosing    = CLOSING_STAGES.has(lead.stage)
  const isDead       = DEAD_STAGES.has(lead.stage)

  const fmt = (n: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, lead.id)}
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-3.5 cursor-pointer hover:shadow-md hover:border-orange-300 transition-all select-none"
    >
      {/* Name + flame */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm leading-tight">
            {lead.firstName} {lead.lastName}
          </p>
          {(lead.stage === 'Job Complete' || (lead as any).isCompleted) && (
            <span className="inline-block mt-1 text-[10px] font-bold uppercase tracking-widest bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">
              ✓ Completed
            </span>
          )}
        </div>
        {lead.leadTemp > 0 && <FlameDisplay value={lead.leadTemp} />}
      </div>

      {/* Pre-sale info */}
      {isPreSale && (
        <div className="space-y-1">
          {lead.phone && <p className="text-xs text-gray-500">📞 {lead.phone}</p>}
          {lead.address && <p className="text-xs text-gray-400 truncate">📍 {lead.address}</p>}
          {lead.leadSource && <p className="text-xs text-orange-500">via {lead.leadSource}</p>}
          {lead.quotePrice > 0 && (
            <p className="text-xs font-semibold text-green-600 mt-1">{fmt(lead.quotePrice)}</p>
          )}
        </div>
      )}

      {/* Production info */}
      {isProduction && (
        <div className="space-y-1">
          {lead.address && <p className="text-xs text-gray-400 truncate">📍 {lead.address}</p>}
          {lead.fenceType && <p className="text-xs text-gray-600">🏗 {lead.fenceType}{lead.sections > 0 ? ` · ${lead.sections} sec` : ''}</p>}
          {lead.crew && <p className="text-xs text-blue-600">👷 {lead.crew}</p>}
          {lead.scheduledDate && <p className="text-xs text-purple-600">📅 {lead.scheduledDate}</p>}
          {lead.quotePrice > 0 && <p className="text-xs font-semibold text-green-600">{fmt(lead.quotePrice)}</p>}
        </div>
      )}

      {/* Closing info */}
      {isClosing && (
        <div className="space-y-1">
          {lead.fenceType && <p className="text-xs text-gray-600">{lead.fenceType}</p>}
          {lead.jobValue > 0 && <p className="text-xs font-bold text-gray-900">{fmt(lead.jobValue)}</p>}
          {lead.balanceDue > 0 && (
            <p className="text-xs font-semibold text-red-500">Balance: {fmt(lead.balanceDue)}</p>
          )}
          {lead.balanceDue === 0 && lead.jobValue > 0 && (
            <p className="text-xs font-semibold text-green-600">✓ Paid in full</p>
          )}
        </div>
      )}

      {/* Dead info */}
      {isDead && (
        <div className="space-y-1">
          {lead.phone && <p className="text-xs text-gray-400">📞 {lead.phone}</p>}
          {lead.lastMoved && <p className="text-xs text-gray-400">Last: {lead.lastMoved}</p>}
          {lead.notes && <p className="text-xs text-gray-400 truncate italic">{lead.notes}</p>}
        </div>
      )}

      {/* Fallback for custom stages */}
      {!isPreSale && !isProduction && !isClosing && !isDead && (
        <div className="space-y-1">
          {lead.phone && <p className="text-xs text-gray-500">📞 {lead.phone}</p>}
          {lead.address && <p className="text-xs text-gray-400 truncate">📍 {lead.address}</p>}
        </div>
      )}

      <p className="text-xs text-gray-300 mt-2">{lead.createdAt}</p>
    </div>
  )
}

// ── Pipeline Column ───────────────────────────────────────────────────────────

function PipelineColumn({
  stage,
  leads,
  stages,
  onAddLead,
  onUpdate,
  onLeadClick,
  onDragStart,
  onDrop,
  onRename,
  onDelete,
}: {
  stage: string
  leads: PipelineLead[]
  stages: string[]
  onAddLead: (stage: string) => void
  onUpdate: (lead: PipelineLead) => void
  onLeadClick: (lead: PipelineLead) => void
  onDragStart: (e: React.DragEvent, id: string) => void
  onDrop: (e: React.DragEvent, stage: string) => void
  onRename: (old: string, next: string) => void
  onDelete: (stage: string) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const [editing, setEditing]   = useState(false)
  const [name, setName]         = useState(stage)
  const inputRef = useRef<HTMLInputElement>(null)

  function commitRename() {
    const trimmed = name.trim()
    if (trimmed && trimmed !== stage) onRename(stage, trimmed)
    else setName(stage)
    setEditing(false)
  }

  const color = STAGE_COLORS[stage] ?? 'bg-gray-500'
  const totalValue = leads.reduce((s, l) => s + (l.quotePrice || l.jobValue || 0), 0)

  return (
    <div
      className={`flex flex-col w-64 shrink-0 rounded-2xl border transition-colors ${dragOver ? 'border-orange-400 bg-orange-50' : 'border-gray-200 bg-gray-50'}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { setDragOver(false); onDrop(e, stage) }}
    >
      {/* Column header */}
      <div className="px-3 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
          {editing ? (
            <input
              ref={inputRef}
              autoFocus
              className="flex-1 text-sm font-bold text-gray-900 bg-transparent border-b border-orange-400 outline-none"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setName(stage); setEditing(false) } }}
            />
          ) : (
            <span
              className="text-sm font-bold text-gray-900 truncate cursor-pointer hover:text-orange-500"
              onClick={() => setEditing(true)}
              title="Click to rename"
            >
              {stage}
            </span>
          )}
          <span className="text-xs text-gray-400 bg-gray-200 rounded-full px-1.5 py-0.5 shrink-0">{leads.length}</span>
        </div>
        <button
          onClick={() => { if (confirm(`Delete "${stage}" stage? Leads will be moved to First Contact.`)) onDelete(stage) }}
          className="text-gray-300 hover:text-red-400 text-sm leading-none ml-1 shrink-0"
          title="Delete stage"
        >×</button>
      </div>

      {/* Total value */}
      {totalValue > 0 && (
        <div className="px-3 pb-2">
          <p className="text-xs text-gray-400 font-mono">
            {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalValue)}
          </p>
        </div>
      )}

      {/* Cards */}
      <div className="flex-1 px-3 pb-3 space-y-2 overflow-y-auto max-h-[calc(100vh-260px)]">
        {leads.map(lead => (
          <PipelineCard
            key={lead.id}
            lead={lead}
            stages={stages}
            onUpdate={onUpdate}
            onClick={() => onLeadClick(lead)}
            onDragStart={onDragStart}
          />
        ))}
        {leads.length === 0 && (
          <div className="text-center py-8 text-gray-300 text-xs">Drop leads here</div>
        )}
      </div>

      {/* Add button */}
      <div className="px-3 pb-3">
        <button
          onClick={() => onAddLead(stage)}
          className="w-full text-xs text-gray-400 hover:text-orange-500 border border-dashed border-gray-200 hover:border-orange-300 rounded-lg py-2 transition-colors"
        >
          + Add Lead
        </button>
      </div>
    </div>
  )
}

// ── Main JobsPage ─────────────────────────────────────────────────────────────

export default function JobsPage() {
  const saved = loadPipeline()
  const [leads, setLeads]   = useState<PipelineLead[]>(saved.leads)
  const [stages, setStages] = useState<string[]>(saved.stages)
  const [addingToStage, setAddingToStage] = useState<string | null>(null)
  const [selectedLead, setSelectedLead]   = useState<PipelineLead | null>(null)
  const [search, setSearch] = useState('')
  const [showCompleted, setShowCompleted] = useState(true)
  const dragId = useRef<string | null>(null)

  // Re-read when settings update
  useEffect(() => {
    const reload = () => {
      const next = loadPipeline()
      setLeads(next.leads)
      setStages(next.stages)
    }
    window.addEventListener('fencepro:settings:updated', reload)
    window.addEventListener('fencepro:pipeline:updated', reload)
    return () => {
      window.removeEventListener('fencepro:settings:updated', reload)
      window.removeEventListener('fencepro:pipeline:updated', reload)
    }
  }, [])

  function persist(nextLeads: PipelineLead[], nextStages: string[]) {
    savePipeline(nextLeads, nextStages)
    setLeads(nextLeads)
    setStages(nextStages)
  }

  function handleAddLead(lead: PipelineLead) {
    persist([lead, ...leads], stages)
    setAddingToStage(null)
  }

  function handleUpdate(updated: PipelineLead) {
    const prev = leads.find(l => l.id === updated.id)
    const next = leads.map(l => l.id === updated.id ? updated : l)
    persist(next, stages)
    if (selectedLead?.id === updated.id) setSelectedLead(updated)

    // Fire sales_stage_change on stage transitions
    if (prev && prev.stage !== updated.stage) {
      fireSalesStageChange(updated.id, prev.stage, updated.stage, {
        jobName: `${updated.firstName} ${updated.lastName}`.trim(),
        jobAddress: updated.address,
        customerName: `${updated.firstName} ${updated.lastName}`.trim(),
        customerEmail: updated.email,
        customerPhone: updated.phone,
        fenceType: updated.fenceType,
        quotePrice: updated.quotePrice,
      })
      handleSignedContractIfNeeded(updated, prev.stage)
    }
  }

  function handleSignedContractIfNeeded(lead: PipelineLead, fromStage: string) {
    if ((lead.stage || '').trim().toLowerCase() !== 'signed contract') return
    try {
      const result = applySignedContractTransition({
        id: lead.id, customerId: lead.customerId,
        firstName: lead.firstName, lastName: lead.lastName,
        phone: lead.phone, email: lead.email, address: lead.address,
        stage: lead.stage, fromStage,
      })
      if (result) {
        toast.success('Deal closed — job created', `${result.job.customerName} · quote marked SOLD · job on Operations board`)
      } else {
        toast.info('Moved to Signed Contract', 'No quote linked yet — create a quote for this customer and drop again to auto-generate a job.')
      }
    } catch (err: any) {
      toast.error('Could not complete signed-contract cascade', err?.message || 'Unknown error.')
    }
  }

  function handleDelete(id: string) {
    persist(leads.filter(l => l.id !== id), stages)
  }

  function handleDragStart(e: React.DragEvent, id: string) {
    dragId.current = id
    e.dataTransfer.effectAllowed = 'move'
  }

  function handleDrop(e: React.DragEvent, stage: string) {
    e.preventDefault()
    if (!dragId.current) return
    const draggedId = dragId.current
    const prev = leads.find(l => l.id === draggedId)
    const next = leads.map(l =>
      l.id === draggedId
        ? { ...l, stage, lastMoved: new Date().toISOString().slice(0, 10) }
        : l
    )
    persist(next, stages)
    dragId.current = null

    if (prev && prev.stage !== stage) {
      fireSalesStageChange(draggedId, prev.stage, stage, {
        jobName: `${prev.firstName} ${prev.lastName}`.trim(),
        jobAddress: prev.address,
        customerName: `${prev.firstName} ${prev.lastName}`.trim(),
        customerEmail: prev.email,
        customerPhone: prev.phone,
        fenceType: prev.fenceType,
        quotePrice: prev.quotePrice,
      })
      handleSignedContractIfNeeded({ ...prev, stage }, prev.stage)
    }
  }

  function handleRename(oldName: string, newName: string) {
    const nextStages = stages.map(s => s === oldName ? newName : s)
    const nextLeads  = leads.map(l => l.stage === oldName ? { ...l, stage: newName } : l)
    persist(nextLeads, nextStages)
  }

  function handleDeleteStage(stage: string) {
    const nextStages = stages.filter(s => s !== stage)
    const fallback   = nextStages[0] ?? 'First Contact'
    const nextLeads  = leads.map(l => l.stage === stage ? { ...l, stage: fallback } : l)
    persist(nextLeads, nextStages)
  }

  function handleAddStage() {
    const name = prompt('New stage name:')
    if (!name?.trim()) return
    persist(leads, [...stages, name.trim()])
  }

  const filtered = leads.filter(l => {
    if (!showCompleted) {
      if (l.stage === 'Job Complete' || (l as any).isCompleted) return false
    }
    const q = search.toLowerCase()
    return !q ||
      `${l.firstName} ${l.lastName}`.toLowerCase().includes(q) ||
      l.phone.includes(q) ||
      l.address.toLowerCase().includes(q)
  })

  const totalPipeline = leads
    .filter(l => !DEAD_STAGES.has(l.stage) && l.stage !== 'Paid & Closed')
    .reduce((s, l) => s + (l.quotePrice || l.jobValue || 0), 0)

  const totalSold = leads
    .filter(l => CLOSING_STAGES.has(l.stage) || l.stage === 'Paid & Closed')
    .reduce((s, l) => s + (l.jobValue || l.quotePrice || 0), 0)

  return (
    <div className="flex flex-col h-full">

      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <input
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 w-64"
            placeholder="Search leads..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <div className="flex items-center gap-4 text-sm">
            <span className="text-gray-500">
              Pipeline: <span className="font-bold text-gray-900">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalPipeline)}
              </span>
            </span>
            <span className="text-gray-500">
              Sold: <span className="font-bold text-green-600">
                {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(totalSold)}
              </span>
            </span>
            <span className="text-gray-400 text-xs">{leads.length} total leads</span>
            <label className="flex items-center gap-1.5 text-xs text-gray-500 ml-3">
              <input type="checkbox" checked={showCompleted} onChange={e => setShowCompleted(e.target.checked)} className="accent-orange-500" />
              <span>Show completed</span>
            </label>
          </div>
        </div>
        <button
          onClick={() => setAddingToStage(stages[0])}
          className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg"
        >
          + New Lead
        </button>
      </div>

      {/* Board */}
      <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
        {stages.map(stage => (
          <PipelineColumn
            key={stage}
            stage={stage}
            leads={filtered.filter(l => l.stage === stage)}
            stages={stages}
            onAddLead={setAddingToStage}
            onUpdate={handleUpdate}
            onLeadClick={setSelectedLead}
            onDragStart={handleDragStart}
            onDrop={handleDrop}
            onRename={handleRename}
            onDelete={handleDeleteStage}
          />
        ))}

        {/* Add stage */}
        <div className="w-64 shrink-0">
          <button
            onClick={handleAddStage}
            className="w-full h-16 border-2 border-dashed border-gray-200 hover:border-orange-400 text-gray-400 hover:text-orange-500 rounded-2xl text-sm font-medium transition-colors"
          >
            + Add Stage
          </button>
        </div>
      </div>

      {addingToStage && (
        <QuickAddModal
          stage={addingToStage}
          onAdd={handleAddLead}
          onClose={() => setAddingToStage(null)}
        />
      )}

      {selectedLead && (
        <LeadDrawer
          lead={selectedLead}
          stages={stages}
          onClose={() => setSelectedLead(null)}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}