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
import { lookupAddresses, type AddressSuggestion } from './appointmentsStore'

/** Said under the box when nothing can be suggested, so the box never just does nothing. */
export const NO_SUGGESTIONS = 'No suggestions, type the full address'

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
  // 'none': looked up (or could not be) and nothing to suggest. Typing carries on as normal.
  const [status, setStatus] = useState<'idle' | 'searching' | 'none'>('idle')
  const [focused, setFocused] = useState(false)
  // Above the box when the phone's keyboard leaves too little room below it.
  const [place, setPlace] = useState<{ up: boolean; max: number }>({ up: false, max: 288 })
  const typed = useRef(false)
  const seq = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!typed.current) return
    const q = value.trim()
    if (q.length < 3) { setList([]); setStatus('idle'); return }
    const n = ++seq.current
    // A short pause after typing, so a weak signal is not asked on every letter.
    const t = setTimeout(() => {
      // Suggestions start from the house number; a street typed without one is kept as typed.
      if (!/^\d/.test(q)) { setList([]); setStatus('none'); return }
      setStatus('searching')
      lookupAddresses(q).then(r => {
        if (n !== seq.current) return
        const found = r ?? []
        setList(found); setActive(-1); setOpen(found.length > 0)
        setStatus(found.length ? 'idle' : 'none')
      })
    }, 220)
    return () => clearTimeout(t)
  }, [value])

  // Room for the list in what is visible above the keyboard.
  useEffect(() => {
    if (!open || !list.length) return
    const measure = () => {
      const el = inputRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      const vv = window.visualViewport
      const top = vv ? vv.offsetTop : 0
      const bottom = vv ? vv.offsetTop + vv.height : window.innerHeight
      const below = bottom - r.bottom - 8, above = r.top - top - 8
      const want = Math.min(288, list.length * 56)
      setPlace(below >= want || below >= above ? { up: false, max: Math.max(120, Math.min(288, below)) } : { up: true, max: Math.max(120, Math.min(288, above)) })
    }
    measure()
    const vv = window.visualViewport
    vv?.addEventListener('resize', measure); vv?.addEventListener('scroll', measure)
    return () => { vv?.removeEventListener('resize', measure); vv?.removeEventListener('scroll', measure) }
  }, [open, list])

  function pick(s: AddressSuggestion) {
    typed.current = false
    setOpen(false); setList([]); setStatus('idle')
    onChange(s.formatted)
    onSelect?.({ formatted: s.formatted, line1: s.line1, city: s.city, state: s.state, zip: s.zip, lat: s.lat, lng: s.lng })
  }

  const showList = open && list.length > 0
  return (
    // Above map layers (Leaflet uses z-index up to 1000) while suggestions are open.
    <div className={`relative ${showList ? 'z-[1100]' : ''} ${wrapClassName}`}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onChange={e => { typed.current = true; onChange(e.target.value) }}
        onFocus={() => { setFocused(true); if (list.length) setOpen(true) }}
        onBlur={() => { setFocused(false); setTimeout(() => setOpen(false), 250) }}
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
      {showList && (
        <ul className={`absolute z-[1100] left-0 right-0 ${place.up ? 'bottom-full mb-1' : 'mt-1'} bg-white border border-gray-200 rounded-lg shadow-lg overflow-y-auto`}
          style={{ maxHeight: place.max }} role="listbox" data-address-suggestions data-placed={place.up ? 'above' : 'below'}>
          {list.map((s, i) => (
            <li key={s.formatted + i} role="option" aria-selected={i === active}>
              {/* Pressing a suggestion must not take the focus off the box first (a tap's blur would close the list before the pick lands). */}
              <button type="button" className={`w-full text-left px-3 min-h-[48px] py-2 text-sm ${i === active ? 'bg-orange-50' : 'hover:bg-gray-50'}`}
                onPointerDown={e => e.preventDefault()} onMouseDown={e => e.preventDefault()} onClick={() => pick(s)} data-address-suggestion>
                <span className="block font-medium text-gray-900">{s.line1}</span>
                <span className="block text-xs text-gray-500">{s.city}, {s.state} {s.zip}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {focused && status === 'none' && !showList && (
        <p className="mt-1 text-xs text-gray-600" role="status" data-address-message>{NO_SUGGESTIONS}</p>
      )}
    </div>
  )
}
