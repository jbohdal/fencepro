/**
 * An address box that suggests addresses as they are typed, from Marion
 * County's own property list kept on the Mac (then the US Census lookup for a
 * complete address the county list lacks). $0, no Google. Picking one fills
 * the street, city, state, ZIP and the map location in one tap; typing the
 * address by hand still works when nothing matches.
 *
 *   <AddressAutocomplete value={addr} onChange={setAddr} onSelect={(a) => setAddr(a.formatted)} />
 */

import { useEffect, useRef, useState } from 'react'
import { suggestAddresses, type AddressSuggestion } from './appointmentsStore'

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
  /** Extra attributes for the input itself (data-* markers). */
  inputAttrs?: Record<string, string | boolean>
  /** Where the box sits (layout classes for the wrapper). */
  wrapClassName?: string
}

export default function AddressAutocomplete({
  value, onChange, onSelect,
  placeholder = 'Start with the house number…',
  className = 'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400',
  autoFocus, disabled, id, inputAttrs, wrapClassName = '',
}: AddressAutocompleteProps) {
  const [list, setList] = useState<AddressSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const typed = useRef(false)
  const seq = useRef(0)

  useEffect(() => {
    if (!typed.current) return
    const q = value.trim()
    if (q.length < 3 || !/^\d/.test(q)) { setList([]); return }
    const n = ++seq.current
    // A short pause after typing, so a weak signal is not asked on every letter.
    const t = setTimeout(() => {
      suggestAddresses(q).then(r => { if (n === seq.current) { setList(r); setActive(-1); setOpen(true) } }).catch(() => {})
    }, 220)
    return () => clearTimeout(t)
  }, [value])

  function pick(s: AddressSuggestion) {
    typed.current = false
    setOpen(false); setList([])
    onChange(s.formatted)
    onSelect?.({ formatted: s.formatted, line1: s.line1, city: s.city, state: s.state, zip: s.zip, lat: s.lat, lng: s.lng })
  }

  return (
    // Above map layers (Leaflet uses z-index up to 1000) while suggestions are open.
    <div className={`relative ${open && list.length ? 'z-[1100]' : ''} ${wrapClassName}`}>
      <input
        id={id}
        type="text"
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={e => { typed.current = true; onChange(e.target.value) }}
        onFocus={() => { if (list.length) setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (!open || !list.length) return
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, list.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(list[active]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
        data-address-input
        {...inputAttrs}
      />
      {open && list.length > 0 && (
        <ul className="absolute z-[1100] left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto" role="listbox" data-address-suggestions>
          {list.map((s, i) => (
            <li key={s.formatted + i} role="option" aria-selected={i === active}>
              <button type="button" className={`w-full text-left px-3 min-h-[48px] py-2 text-sm ${i === active ? 'bg-orange-50' : 'hover:bg-gray-50'}`}
                onMouseDown={e => e.preventDefault()} onClick={() => pick(s)} data-address-suggestion>
                <span className="block font-medium text-gray-900">{s.line1}</span>
                <span className="block text-xs text-gray-500">{s.city}, {s.state} {s.zip}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
