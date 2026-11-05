/**
 * A customer's properties on their page, and the form to add or change one
 * (Jonathan, Nov 5 2026; propertiesApi.ts): each property's label (Home,
 * Rental, Airbnb...), address (the county suggestions), gate code, tenant or
 * property manager and phone, and access notes; which one is Primary; one sold
 * or moved from marked "No longer theirs", greyed out, its quotes, jobs and
 * visits still listed with it. Billing and mailing address stay on the
 * customer (Contact details). The Installer reads them; the office, the owner
 * and the Salesman (her own customers) add and change them.
 */

import { useCallback, useEffect, useState } from 'react'
import AddressAutocomplete from './AddressAutocomplete'
import { PROPERTY_LABELS, addProperty, changeProperty, loadProperties, type Property, type PropertyInput } from './propertiesApi'
import { getQuotes } from './quoteStore'
import { getJobs } from './jobStore'
import { appointmentsFor } from './appointmentsStore'
import { isCrewLogin } from './permissions'
import { formatPhone } from './phoneFormat'
import { toast } from './toast'

const BOX = 'w-full border border-gray-300 rounded-lg px-3 min-h-[44px] text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-400'
const BTN = 'min-h-[44px] px-3 rounded-lg text-sm font-medium'

/** The add / change form. `onSaved` gets the customer's properties as saved and the one saved. */
export function PropertyForm({ customerId, property, onSaved, onCancel, primary }: {
  customerId: string
  property?: Property | null
  onSaved: (properties: Property[], saved: Property) => void
  onCancel: () => void
  /** A new one made the Primary (a customer with no address yet). */
  primary?: boolean
}) {
  const [label, setLabel] = useState(property?.label || (primary ? 'Home' : 'Rental'))
  const [address, setAddress] = useState(property?.address || '')
  const [place, setPlace] = useState<Pick<PropertyInput, 'city' | 'state' | 'zip' | 'lat' | 'lng'> | null>(null)
  const [gateCode, setGateCode] = useState(property?.gateCode || '')
  const [tenantName, setTenantName] = useState(property?.tenantName || '')
  const [tenantPhone, setTenantPhone] = useState(property?.tenantPhone || '')
  const [accessNotes, setAccessNotes] = useState(property?.accessNotes || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // An address not picked from the county list and with no ZIP: checked once before it is saved (it goes on proposals and contracts).
  const [unchecked, setUnchecked] = useState(false)

  async function save(confirmMove = false) {
    if (!address.trim()) { setError('Type the property address.'); return }
    const changed = !property || address.trim() !== property.address
    if (changed && !place && !/\b\d{5}\b/.test(address) && !unchecked) {
      setUnchecked(true)
      setError('This address is not in the county list and has no ZIP. Check it (it goes on proposals and contracts), pick a suggestion, or tap Save again to keep it as typed.')
      return
    }
    setBusy(true); setError('')
    const input: PropertyInput = {
      label: label.trim() || 'Home', address: address.trim(), ...(place ?? {}),
      gateCode: gateCode.trim() || null, tenantName: tenantName.trim() || null, tenantPhone: tenantPhone.trim() || null, accessNotes: accessNotes.trim() || null,
    }
    const r = property ? await changeProperty(customerId, property.id, { ...input, ...(confirmMove ? { confirmMove: true } : {}) }) : await addProperty(customerId, { ...input, ...(primary ? { primary: true } : {}) })
    setBusy(false)
    // Signed jobs or visits ahead are at this property: the same place (a typo fixed) moves them; another place is another property.
    if (!r.ok && r.code === 'MOVES_RECORDS') {
      if (window.confirm(`${r.error} Their signed contract keeps the old address.\n\nOK if this is the same property (fixing the address).\nCancel if it is a different place: then use Add property instead.`)) { await save(true); return }
      setError('Not changed. For a different place, use Add property.')
      return
    }
    if (!r.ok) { setError(r.error); return }
    onSaved(r.properties, r.made!)
  }

  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-3 space-y-2" data-property-form>
      <p className="text-sm font-semibold text-gray-900">{property ? `Change ${property.label}` : 'Add property'}</p>
      <div>
        <label className="text-xs text-gray-500 block mb-1">What it is</label>
        <div className="flex flex-wrap gap-1.5 mb-1.5">
          {PROPERTY_LABELS.map(l => (
            <button key={l} type="button" className={`${BTN} border ${label === l ? 'bg-orange-600 border-orange-600 text-white' : 'bg-white border-gray-300 text-gray-700'}`} onClick={() => setLabel(l)} data-property-label-choice={l}>{l}</button>
          ))}
        </div>
        <input className={BOX} value={label} onChange={e => setLabel(e.target.value)} maxLength={40} aria-label="Label" data-property-label />
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Address</label>
        <AddressAutocomplete
          value={address}
          onChange={v => { setAddress(v); setPlace(null); setUnchecked(false) }}
          onSelect={p => { setAddress(p.formatted); setPlace({ city: p.city || null, state: p.state || null, zip: p.zip || null, lat: p.lat ?? null, lng: p.lng ?? null }) }}
          className={BOX}
          inputAttrs={{ 'data-property-address': true }}
        />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-gray-500 block mb-1">Gate code (optional)</label>
          <input className={BOX} value={gateCode} onChange={e => setGateCode(e.target.value)} maxLength={120} data-property-gate-code />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Tenant or property manager (optional)</label>
          <input className={BOX} value={tenantName} onChange={e => setTenantName(e.target.value)} maxLength={120} data-property-tenant-name />
        </div>
        <div>
          <label className="text-xs text-gray-500 block mb-1">Their phone (optional)</label>
          <input className={BOX} value={tenantPhone} onChange={e => setTenantPhone(e.target.value)} inputMode="tel" maxLength={40} data-property-tenant-phone />
        </div>
      </div>
      <div>
        <label className="text-xs text-gray-500 block mb-1">Access notes (optional)</label>
        <textarea className={`${BOX} py-2`} rows={2} value={accessNotes} onChange={e => setAccessNotes(e.target.value)} maxLength={2000} placeholder="Dogs in the yard, call the tenant first, side gate…" data-property-access-notes />
      </div>
      {error && <p className="text-sm text-red-700" data-property-error>{error}</p>}
      <div className="flex gap-2">
        <button type="button" className={`${BTN} flex-1 border border-gray-300 bg-white text-gray-700`} onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className={`${BTN} flex-1 bg-orange-600 text-white disabled:opacity-50`} onClick={() => void save()} disabled={busy} data-property-save>{busy ? 'Saving…' : property ? 'Save' : 'Add property'}</button>
      </div>
    </div>
  )
}

/** What is at a property: its quotes, jobs and visits on this phone. */
function historyOf(customerId: string, p: Property, primaryId: string | null): string {
  // A record saved before it had a property is the Primary's (the server puts it there).
  const at = (id: string | null | undefined) => (id ? id === p.id : p.id === primaryId)
  const quotes = getQuotes().filter(q => q.customerId === customerId && at(q.propertyId)).length
  const jobs = getJobs().filter(j => j.customerId === customerId && at(j.propertyId)).length
  const visits = appointmentsFor(customerId).filter(a => at(a.propertyId)).length
  const n = (k: number, one: string, many: string) => (k ? `${k} ${k === 1 ? one : many}` : '')
  return [n(quotes, 'quote', 'quotes'), n(jobs, 'job', 'jobs'), n(visits, 'appointment', 'appointments')].filter(Boolean).join(', ') || 'Nothing here yet'
}

export default function CustomerProperties({ customerId }: { customerId: string }) {
  const [list, setList] = useState<Property[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Property | 'new' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const readOnly = isCrewLogin()

  const load = useCallback(async () => {
    const r = await loadProperties(customerId)
    if (r.ok) { setList(r.properties); setError('') } else setError(r.error)
  }, [customerId])
  useEffect(() => { setList(null); setEditing(null); void load() }, [load])

  async function act(p: Property, change: { primary?: boolean; noLongerTheirs?: boolean }, done: string) {
    setBusy(p.id)
    const r = await changeProperty(customerId, p.id, change)
    setBusy(null)
    if (!r.ok) { toast.error('Not saved', r.error); return }
    setList(r.properties)
    toast.success(done)
  }

  const primaryId = list?.find(p => p.isPrimary)?.id ?? null
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3" data-customer-properties>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold text-gray-900">Properties</h3>
        {!readOnly && editing === null && list && (
          <button type="button" className={`${BTN} border border-orange-300 text-orange-700 bg-white`} onClick={() => setEditing('new')} data-property-add>+ Add property</button>
        )}
      </div>
      {error && <p className="text-sm text-red-700">{error} <button type="button" className="underline min-h-[44px]" onClick={() => void load()}>Try again</button></p>}
      {!list && !error && <p className="text-sm text-gray-500">Loading…</p>}
      {editing === 'new' && (
        <PropertyForm customerId={customerId} primary={!!list && !list.some(p => p.address)} onCancel={() => setEditing(null)}
          onSaved={(props, made) => { setList(props); setEditing(null); toast.success(`${made.label} added`, made.address) }} />
      )}
      {list?.map(p => editing !== 'new' && editing?.id === p.id ? (
        <PropertyForm key={p.id} customerId={customerId} property={p} onCancel={() => setEditing(null)}
          onSaved={(props, saved) => { setList(props); setEditing(null); toast.success('Property saved', saved.address) }} />
      ) : (
        <div key={p.id} className={`rounded-xl border p-3 space-y-1 ${p.noLongerTheirsAt ? 'border-gray-200 bg-gray-50 opacity-70' : p.isPrimary ? 'border-orange-200' : 'border-gray-200'}`} data-property={p.id} data-property-primary={p.isPrimary ? '1' : '0'} data-property-gone={p.noLongerTheirsAt ? '1' : '0'}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900">{p.label}</span>
            {p.isPrimary && <span className="text-[11px] font-semibold uppercase tracking-wide text-orange-700 bg-orange-100 rounded px-1.5 py-0.5">Primary</span>}
            {p.noLongerTheirsAt && <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-600 bg-gray-200 rounded px-1.5 py-0.5">No longer theirs</span>}
          </div>
          <p className="text-sm text-gray-800" data-property-line>{p.address || <span className="text-gray-400">No address yet</span>}</p>
          {(p.gateCode || p.tenantName || p.tenantPhone || p.accessNotes) && (
            <div className="text-xs text-gray-600 space-y-0.5">
              {p.gateCode && <p>Gate code: <b>{p.gateCode}</b></p>}
              {(p.tenantName || p.tenantPhone) && <p>Tenant / manager: {p.tenantName}{p.tenantPhone && <> {p.tenantName ? '· ' : ''}<a className="text-orange-700 underline" href={`tel:${p.tenantPhone.replace(/[^\d+]/g, '')}`}>{formatPhone(p.tenantPhone)}</a></>}</p>}
              {p.accessNotes && <p className="whitespace-pre-line">{p.accessNotes}</p>}
            </div>
          )}
          <p className="text-xs text-gray-500" data-property-history>{historyOf(customerId, p, primaryId)}</p>
          {!readOnly && editing === null && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              <button type="button" className={`${BTN} border border-gray-300 text-gray-700`} onClick={() => setEditing(p)} data-property-edit>Edit</button>
              {!p.isPrimary && <button type="button" className={`${BTN} border border-gray-300 text-gray-700 disabled:opacity-50`} disabled={busy === p.id} onClick={() => void act(p, { primary: true }, `${p.label}, ${p.address}, is now the Primary property`)} data-property-make-primary>Make Primary</button>}
              {!p.isPrimary && !p.noLongerTheirsAt && <button type="button" className={`${BTN} border border-gray-300 text-gray-700 disabled:opacity-50`} disabled={busy === p.id} onClick={() => { if (window.confirm(`Mark ${p.label} (${p.address}) as no longer theirs (moved or sold)? It stays here, greyed out, with its quotes and jobs.`)) void act(p, { noLongerTheirs: true }, `${p.label} marked no longer theirs`) }} data-property-gone-button>No longer theirs</button>}
              {p.noLongerTheirsAt && <button type="button" className={`${BTN} border border-gray-300 text-gray-700 disabled:opacity-50`} disabled={busy === p.id} onClick={() => void act(p, { noLongerTheirs: false }, `${p.label} is theirs again`)} data-property-back>Theirs again</button>}
            </div>
          )}
          {p.isPrimary && !readOnly && editing === null && list.length > 1 && <p className="text-[11px] text-gray-500">To mark the Primary as no longer theirs, make another property Primary first.</p>}
        </div>
      ))}
    </div>
  )
}
