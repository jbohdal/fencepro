import { useState, useRef } from 'react'
import { styleLabel } from './fenceCatalog'
import { sourcePicker, sourceLabel } from './optionListsStore'
import { upsertCustomer, logCustomerActivity, findPossibleMatches, type Customer } from './customerStore'
import { getPipeline, savePipeline as storeSavePipeline } from './pipelineStore'
import { toast } from './toast'
import { pickableIds, stageName, stageColor } from './pipelineStagesStore'
import { useBackLayer } from './nav'
import { newId } from './recordSync'
import { businessDate } from './businessDate'
import AddressAutocomplete from './AddressAutocomplete'
import { can } from './permissions'
import { archiveRecord } from './recordArchive'

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
  /** The quote (and job) this card was made or signed for (signedContractFlow stamps them). */
  quoteId?: string
  jobId?: string
  /** Hand placed position on the board. Only counts while the card is still in `stage`. */
  boardOrder?: { stage: string; rank: number }
}



/**
 * The board's cards, and the ids of the stages pickers offer (Settings >
 * Pipeline Stages, shown ones in board order). Cards are never made here;
 * each customer's card is made once, on the server, when the customer is
 * (see routes/crm-contacts).
 */
export function loadPipeline(): { leads: PipelineLead[], stages: string[] } {
  return { leads: (getPipeline().leads as PipelineLead[]) || [], stages: pickableIds() }
}

export function savePipeline(leads: PipelineLead[]) {
  storeSavePipeline(leads)
}

const FLAME_COLORS = ['text-blue-400','text-cyan-400','text-yellow-400','text-orange-500','text-red-500']

// ── Quick Add Modal ───────────────────────────────────────────────────────────

export function QuickAddModal({
  stage,
  onAdd,
  onClose,
}: {
  stage: string
  /** The card for a customer already on file, or null when a new customer brought their own card. */
  onAdd: (lead: PipelineLead | null) => void
  onClose: () => void
}) {
  useBackLayer(onClose, { key: 'quick-add-modal' })
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
  const [newCustomerId] = useState(() => newId())
  // A customer on file picked with "Use": the card goes on their record. Never set by a match alone.
  const [picked, setPicked] = useState<Customer | null>(null)
  const added = useRef(false)
  // Someone on file with the phone or email typed: offered, not assumed.
  const matches = picked ? [] : findPossibleMatches({ phone, email })

  // Combine the four address fields into the single string the data layer expects.
  function composedAddress(): string {
    const cityStateZip = [city, state].filter(Boolean).join(', ') + (zip ? ` ${zip}` : '')
    return [street, cityStateZip].filter(s => s.trim()).join(', ').trim()
  }

  function handleAdd() {
    if (!firstName.trim() && !picked) return
    // Add tapped twice before the window closes: the second tap does nothing.
    if (added.current) return
    added.current = true
    const address = composedAddress()
    if (picked) {
      // A card for the picked customer in this column. Their record is not changed;
      // the property typed here is the card's.
      const lead: PipelineLead = {
        id: newId(),
        customerId: picked.id,
        firstName: picked.firstName,
        lastName: picked.lastName,
        phone: picked.phone, email: picked.email,
        address: address || picked.serviceAddress,
        leadSource: leadSource || picked.leadSource, notes: notes || picked.notes,
        leadTemp: 0, fenceType: '', sections: 0,
        quotePrice: 0, crew: '', scheduledDate: '',
        jobValue: 0, paymentStatus: '', balanceDue: 0,
        stage,
        createdAt: picked.createdAt,
        lastMoved: businessDate(new Date()),
      }
      logCustomerActivity(picked.id, `Lead added to pipeline at ${stageName(stage)}`, { kind: 'stage_change' })
      onAdd(lead)
      toast.info('Lead added for a customer on file', `${picked.firstName} ${picked.lastName}`.trim())
      return
    }
    // A new customer and their card in this column are one save (customerStore): both or neither.
    // The customer's id is chosen when the window opens, so a resend is the same customer.
    const { customer } = upsertCustomer({
      id: newCustomerId,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      phone, email,
      serviceAddress: address,
      city: city.trim(), state: state.trim(), zip: zip.trim(),
      leadSource, notes,
    }, { stage })
    logCustomerActivity(customer.id, `Lead added to pipeline at ${stageName(stage)}`, { kind: 'stage_change' })
    onAdd(null)
    toast.info('Lead added', 'With a customer record. Its status shows Saved once the office has it.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-[420px] max-h-[90vh] overflow-y-auto modal-responsive">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Add to {stage}</h2>
            <p className="text-xs text-gray-400 mt-0.5">Name and phone are all you need to get started</p>
          </div>
          <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">First Name *</label>
              <input
                autoFocus
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={firstName} data-lead-field="first-name"
                onChange={e => setFirstName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Last Name</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                value={lastName} data-lead-field="last-name"
                onChange={e => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Phone</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="(352) 555-0100"
              value={phone} data-lead-field="phone"
              onChange={e => setPhone(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Email</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              value={email} data-lead-field="email"
              onChange={e => setEmail(e.target.value)}
            />
          </div>
          {matches.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 space-y-1.5" data-possible-match>
              <p className="text-xs text-amber-800">Already on file with this phone or email. Add Lead makes a new customer unless you pick one.</p>
              {matches.slice(0, 3).map(c => (
                <div key={c.id} className="flex items-center justify-between gap-2">
                  <span className="text-sm text-gray-800 min-w-0 truncate">{`${c.firstName} ${c.lastName}`.trim()}{c.phone ? ` · ${c.phone}` : ''}</span>
                  <button type="button" onClick={() => setPicked(c)} data-use-customer={c.id}
                    className="shrink-0 min-h-[40px] px-3 rounded-lg border border-amber-300 text-xs font-semibold text-amber-900 hover:bg-amber-100">
                    Use {c.firstName || 'this customer'}
                  </button>
                </div>
              ))}
            </div>
          )}
          {picked && (
            <div className="bg-orange-50 border border-orange-200 rounded-lg px-3 py-2 flex items-center justify-between gap-2" data-picked-customer={picked.id}>
              <span className="text-sm text-gray-800 min-w-0">Card goes on <b>{`${picked.firstName} ${picked.lastName}`.trim()}</b>'s record. Their details are not changed.</span>
              <button type="button" onClick={() => setPicked(null)} data-unpick-customer
                className="shrink-0 min-h-[40px] px-3 rounded-lg text-xs text-orange-600 hover:underline">
                New customer instead
              </button>
            </div>
          )}
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Street Address</label>
            {/* Suggestions from the county's property list: one tap fills street, city, state and ZIP. */}
            <AddressAutocomplete value={street} onChange={setStreet} placeholder="1349 SE 32nd St" inputAttrs={{ 'data-lead-field': 'street' }}
              onSelect={p => { setStreet(p.line1); setCity(p.city); setState(p.state); setZip(p.zip) }} />
          </div>
          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">City</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                placeholder="e.g. Ocala"
                value={city} data-lead-field="city"
                onChange={e => setCity(e.target.value)}
              />
            </div>
            <div className="w-20">
              <label className="text-xs text-gray-500 mb-1 block">State</label>
              <input
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
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
                placeholder="ZIP"
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
              {sourcePicker(leadSource).map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
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
              disabled={!firstName.trim() && !picked}
              data-lead-add
              className="btn btn-primary flex-1"
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
  useBackLayer(onClose, { key: 'lead-drawer' })
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
            <span className="text-xs text-white px-2 py-0.5 rounded-full" style={{ backgroundColor: stageColor(lead.stage) }}>
              {stageName(lead.stage)}
            </span>
          </div>
          <div className="flex gap-2">
            {editing ? (
              <>
                <button onClick={save} className="bg-orange-500 text-white text-sm font-semibold px-3 py-1.5 rounded-lg">Save</button>
                <button onClick={() => { setForm({ ...lead }); setEditing(false) }} className="border border-gray-200 text-gray-600 text-sm px-3 py-1.5 rounded-lg">Cancel</button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} className="btn btn-secondary">Edit</button>
            )}
            <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl leading-none ml-1">×</button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-5">

          {/* Stage mover */}
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium">Move to Stage</p>
            <div className="flex flex-wrap gap-1.5">
              {stages.map(s => (
                <button
                  key={s}
                  onClick={() => onUpdate({ ...lead, stage: s, lastMoved: businessDate(new Date()) })}
                  className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-colors ${
                    lead.stage === s
                      ? 'text-white border-transparent'
                      : 'border-gray-200 text-gray-500 hover:border-gray-400'
                  }`}
                  style={lead.stage === s ? { backgroundColor: stageColor(s) } : undefined}
                >
                  {stageName(s)}
                </button>
              ))}
            </div>
          </div>

          {/* Lead temp */}
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium">Lead Temperature</p>
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
            <p className="text-xs font-semibold text-gray-500">Contact</p>
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
                  { label: 'Source',  value: sourceLabel(lead.leadSource) },
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
            <p className="text-xs font-semibold text-gray-500">Job Info</p>
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
                  { label: 'Type',      value: styleLabel(lead.fenceType) },
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
            <p className="text-xs text-gray-400 mb-2 font-medium">Notes</p>
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

          {(can('records.archive') || can('records.delete')) && <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-3 items-center">
            {/* Archive: the everyday way off the board (search and reports keep it; Unarchive is on the customer's page). */}
            {can('records.archive') && <button
              onClick={async () => {
                const r = await archiveRecord('card', lead.id)
                if (!r.ok) { toast.error('Not archived', r.error || 'Try again.'); return }
                toast.success('Card archived', 'Off the board. Unarchive it from the customer\'s page.')
                onClose()
              }}
              className="btn btn-secondary btn-sm min-h-[44px]" data-card-archive
            >
              Archive card
            </button>}
            {/* Delete (owner, admin): to Settings > Deleted Records, where it can be restored. */}
            {can('records.delete') && <button
              onClick={() => { if (confirm('Delete this card? The owner or an admin can restore it from Settings > Deleted Records.')) { onDelete(lead.id); onClose() } }}
              className="text-red-600 hover:text-red-700 text-sm font-medium min-h-[44px]" data-card-delete
            >
              Delete lead
            </button>}
          </div>}
        </div>
      </div>
    </div>
  )
}
