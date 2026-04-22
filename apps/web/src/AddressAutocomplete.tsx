/**
 * Reusable Google Places Autocomplete input.
 *
 * Usage — single address field:
 *   <AddressAutocomplete value={addr} onChange={setAddr} onSelect={(a) => setAddr(a.formatted)} />
 *
 * Usage — split street/city/state/zip:
 *   <AddressAutocomplete
 *     value={addr}
 *     onChange={setAddr}
 *     onSelect={(a) => { setAddr(a.line1); setCity(a.city); setState(a.state); setZip(a.zip) }}
 *   />
 *
 * The input behaves like a normal text input until the Places library loads.
 * Requires VITE_GOOGLE_MAPS_API_KEY env var — shows an inline error hint if missing.
 */

import { useEffect, useRef, useState } from 'react'
import { loadPlaces } from './mapsLoader'

export interface PlaceSelection {
  formatted: string
  line1: string
  city: string
  state: string
  zip: string
  lat?: number
  lng?: number
}

export interface AddressAutocompleteProps {
  value: string
  onChange: (v: string) => void
  onSelect?: (place: PlaceSelection) => void
  placeholder?: string
  className?: string
  autoFocus?: boolean
  disabled?: boolean
  id?: string
}

function extractAddressParts(place: google.maps.places.PlaceResult): PlaceSelection {
  const comps = place.address_components || []
  const get = (type: string, short = false) => {
    const c = comps.find(x => x.types.includes(type))
    return c ? (short ? c.short_name : c.long_name) : ''
  }
  const streetNumber = get('street_number')
  const route = get('route')
  const line1 = [streetNumber, route].filter(Boolean).join(' ') || (place.formatted_address?.split(',')[0] || '')
  const city = get('locality') || get('sublocality') || get('postal_town')
  const state = get('administrative_area_level_1', true)
  const zip = get('postal_code')
  return {
    formatted: place.formatted_address || '',
    line1,
    city,
    state,
    zip,
    lat: place.geometry?.location?.lat(),
    lng: place.geometry?.location?.lng(),
  }
}

export default function AddressAutocomplete({
  value, onChange, onSelect,
  placeholder = 'Enter address...',
  className = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400',
  autoFocus, disabled, id,
}: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [placesReady, setPlacesReady] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function init() {
      const key = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY
      if (!key) {
        setApiError('Google Maps API key not configured — autocomplete disabled.')
        return
      }
      try {
        await loadPlaces()
      } catch (err: any) {
        if (!cancelled) setApiError('Could not load Google Places library.')
        return
      }
      if (cancelled || !inputRef.current) return

      const ac = new google.maps.places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: { country: 'us' },
        fields: ['formatted_address', 'address_components', 'geometry'],
      })

      ac.addListener('place_changed', () => {
        const place = ac.getPlace()
        if (!place || !place.formatted_address) return
        const parsed = extractAddressParts(place)
        onChange(parsed.formatted)
        onSelect?.(parsed)
      })
      setPlacesReady(true)
    }
    init()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div>
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={apiError ? 'Enter address (autocomplete unavailable)' : placesReady ? placeholder : 'Loading autocomplete…'}
        className={className}
        autoComplete="off"
      />
      {apiError && <p className="text-[11px] text-amber-600 mt-1">⚠ {apiError}</p>}
    </div>
  )
}
