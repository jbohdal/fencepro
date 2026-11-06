/**
 * Which of the customer's properties a quote or a visit is for (Jonathan, Nov
 * 5 2026): their properties still theirs, the Primary picked when the
 * record has no property or address yet (its address picks its property), and one tap to add
 * a new one right there (CustomerProperties.tsx PropertyForm). The record
 * takes the property's address. No signal: it says so, and the address typed
 * on the screen is used (the server puts the record on the property with that
 * address, or makes one).
 */

import { useEffect, useRef, useState } from 'react'
import { loadProperties, type Property } from './propertiesApi'
import { PropertyForm } from './CustomerProperties'
import { sameAddress } from './propertyAddress'
import { isCrewLogin } from './permissions'

export default function PropertyPicker({ customerId, propertyId, address, onPick, title = 'Property' }: {
  customerId: string
  /** The record's property now (a saved quote's), if it has one. */
  propertyId?: string | null
  /** The record's address now: the property with it is picked when no property id is known. */
  address?: string
  onPick: (p: Property) => void
  title?: string
}) {
  const [list, setList] = useState<Property[] | null>(null)
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<string | null>(propertyId ?? null)
  const [adding, setAdding] = useState(false)
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const startRef = useRef({ propertyId, address })

  useEffect(() => {
    let live = true
    setList(null)
    void loadProperties(customerId).then(r => {
      if (!live) return
      if (!r.ok) { setError(r.error); return }
      setList(r.properties)
      const { propertyId: id, address: a } = startRef.current
      const start = r.properties.find(p => p.id === id)
        ?? (a ? r.properties.find(p => sameAddress(p.address, a)) : undefined)
        // The Primary only when the record has no address yet: a quote made for an address keeps it when another
        // customer is picked (customer-links, Oct 2026); saving puts it on their property there, or makes one.
        ?? (a?.trim() ? undefined : r.properties.find(p => p.isPrimary))
      if (start) { setPicked(start.id); pickRef.current(start) }
    })
    return () => { live = false }
  }, [customerId])

  if (error) return <p className="text-xs text-amber-800" data-property-picker-error>{error} The address below is used; the property is found by it.</p>
  if (!list) return <p className="text-xs text-gray-500">Loading the properties…</p>
  const shown = list.filter(p => !p.noLongerTheirsAt || p.id === picked)
  return (
    <div className="space-y-1.5" data-property-picker>
      <p className="text-xs text-gray-500 font-medium">{title}</p>
      <div role="radiogroup" className="space-y-1.5">
        {shown.map(p => (
          <button key={p.id} type="button" role="radio" aria-checked={picked === p.id}
            className={`w-full text-left rounded-lg border px-3 py-2 min-h-[48px] ${picked === p.id ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-400' : 'border-gray-300 bg-white'}`}
            onClick={() => { setPicked(p.id); onPick(p) }} data-property-choice={p.id} data-property-choice-label={p.label}>
            <span className="block text-sm font-medium text-gray-900">{p.label}{p.isPrimary ? ' · Primary' : ''}{p.noLongerTheirsAt ? ' · no longer theirs' : ''}</span>
            <span className="block text-xs text-gray-600">{p.address || 'No address yet'}</span>
          </button>
        ))}
      </div>
      {!isCrewLogin() && (adding ? (
        <PropertyForm customerId={customerId} onCancel={() => setAdding(false)} primary={!list.some(p => p.address)}
          onSaved={(props, made) => { setList(props); setAdding(false); setPicked(made.id); onPick(made) }} />
      ) : (
        <button type="button" className="min-h-[44px] px-3 rounded-lg text-sm font-medium border border-dashed border-orange-300 text-orange-700 w-full" onClick={() => setAdding(true)} data-property-picker-add>+ Add a property (a rental, a new home)</button>
      ))}
    </div>
  )
}
