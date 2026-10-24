/**
 * One box for a number: money, a percent or a plain number.
 *
 *  - While it is being typed in, nothing touches it: no reformatting, no
 *    cursor jumps, no reset from a save or a reload of the data behind it.
 *  - Tapping it shows the bare number ("1234.50", no "$" or commas, so a
 *    phone's number pad can edit it) with all of it selected, so typing
 *    replaces it. Backspace and paste work as in any box; "$1,234.50" pasted
 *    is read as 123450 cents.
 *  - Leaving it (Tab, Enter, tapping elsewhere) reads it and calls onCommit
 *    once, only when the number changed. Enter, and the phone's Next key,
 *    move to the next number box on the page. Escape puts the old number back.
 *  - Not a number: the old one stays, the box is outlined red and says why.
 *
 * Money values are whole cents. Percents are in percent (24.5 for 24.5%).
 */

import { useEffect, useRef, useState } from 'react'
import { readBox, showBox, editBox, type NumberKind } from './numberText'

export const NUMBER_FIELD_ATTR = 'data-number-field'

/** The next number box after `el` in the page (Enter / Next on a phone). */
function focusNext(el: HTMLInputElement, back = false) {
  const all = [...document.querySelectorAll<HTMLInputElement>(`input[${NUMBER_FIELD_ATTR}]`)]
    .filter(i => !i.disabled && i.offsetParent !== null)
  const at = all.indexOf(el)
  const next = all[at + (back ? -1 : 1)]
  if (next) next.focus()
  else el.blur()
}

export default function NumberField({
  value, onCommit, kind = 'number', decimals, cents = 'auto', blank = 0, min, max,
  id, name, label, placeholder, className = '', prefix, suffix, disabled, width, look = 'box',
  ...rest
}: {
  /** 'box' (the usual bordered box) or 'plain' (only `className`, for a big headline number). */
  look?: 'box' | 'plain'
  /** Cents for money, percent for a percent (24.5), else the number. */
  value: number
  onCommit: (next: number) => void
  kind?: NumberKind
  /** Decimal places kept for a percent or number (2 by default). */
  decimals?: number
  /** Money: show cents always, never, or only when there are some ('auto'). */
  cents?: boolean | 'auto'
  /** What an empty box means (0 by default); null refuses an empty box. */
  blank?: number | null
  min?: number
  max?: number
  id?: string
  name?: string
  /** Read aloud and shown on hover when the box has no visible label of its own. */
  label?: string
  placeholder?: string
  className?: string
  /** Shown inside the box before the number ("$" is already part of money). */
  prefix?: string
  suffix?: string
  disabled?: boolean
  /** Tailwind width class for the box (w-full by default). */
  width?: string
} & Record<`data-${string}`, string | boolean | undefined>) {
  const ref = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(() => showBox(kind, value, { decimals, cents }))
  const [error, setError] = useState('')
  // Set when the box is left by Escape: put the old number back, commit nothing.
  const cancel = useRef(false)
  // The first mouse up after focusing would undo the select-all (Chrome, Safari).
  const keepSelection = useRef(false)

  // Set once something is typed (or pasted) after the box was tapped.
  const typed = useRef(false)

  // The number from outside is shown only while nothing is being typed: a box
  // tapped but not typed in yet follows it (Enter from the yearly box changes
  // the monthly one it moves to), a box being typed in is left alone.
  useEffect(() => {
    if (!editing) setText(showBox(kind, value, { decimals, cents }))
    else if (!typed.current) { setText(editBox(kind, value, { decimals })); requestAnimationFrame(selectAll) }
  }, [value, editing, kind, decimals, cents])

  function selectAll() {
    const el = ref.current
    if (!el) return
    try { el.setSelectionRange(0, el.value.length) } catch { el.select() }
  }

  function onFocus() {
    cancel.current = false
    typed.current = false
    keepSelection.current = true
    setEditing(true)
    setError('')
    setText(editBox(kind, value, { decimals }))
    // After the bare number is in the box; again a moment later for iOS Safari.
    requestAnimationFrame(selectAll)
    setTimeout(selectAll, 60)
  }

  function onBlur() {
    setEditing(false)
    // Left by Escape, or left without typing anything: nothing changes.
    if (cancel.current || !typed.current) { cancel.current = false; typed.current = false; setError(''); setText(showBox(kind, value, { decimals, cents })); return }
    typed.current = false
    const r = readBox(kind, text, { blank, min, max, decimals })
    if (!r.ok) {
      setError(r.error)
      setText(showBox(kind, value, { decimals, cents }))
      return
    }
    setError('')
    setText(showBox(kind, r.value, { decimals, cents }))
    if (r.value !== value) onCommit(r.value)
  }

  const hint = error ? `${error}. The number was not changed.` : undefined

  return (
    <span className={`relative inline-flex items-center ${width ?? 'w-full'}`}>
      {prefix && <span aria-hidden className="pointer-events-none absolute left-2.5 text-gray-400 text-sm">{prefix}</span>}
      <input
        ref={ref}
        {...{ [NUMBER_FIELD_ATTR]: kind }}
        id={id}
        name={name}
        type="text"
        inputMode="decimal"
        enterKeyHint="next"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={disabled}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        title={hint ?? label}
        placeholder={placeholder}
        value={text}
        onFocus={onFocus}
        onBlur={onBlur}
        onMouseUp={e => { if (keepSelection.current) { keepSelection.current = false; e.preventDefault() } }}
        onChange={e => { keepSelection.current = false; typed.current = true; setText(e.target.value); if (error) setError('') }}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); focusNext(e.currentTarget, e.shiftKey) }
          else if (e.key === 'Escape') { cancel.current = true; e.currentTarget.blur() }
        }}
        className={look === 'plain'
          ? `min-h-[44px] w-full bg-transparent outline-none ${error ? 'ring-2 ring-red-300 rounded' : ''} ${className}`
          : `min-h-[44px] w-full rounded-lg border bg-white px-2.5 py-2 text-right font-mono text-sm text-gray-900 outline-none transition-colors focus:border-orange-400 focus:ring-2 focus:ring-orange-200 disabled:bg-gray-50 disabled:text-gray-400 ${prefix ? 'pl-6' : ''} ${suffix ? 'pr-7' : ''} ${error ? 'border-red-400 ring-2 ring-red-200' : 'border-gray-200'} ${className}`}
        {...rest}
      />
      {suffix && <span aria-hidden className="pointer-events-none absolute right-2.5 text-gray-400 text-sm">{suffix}</span>}
      {error && <span role="alert" className="absolute left-0 top-full z-10 mt-0.5 whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-600 shadow-sm">{error}</span>}
    </span>
  )
}
