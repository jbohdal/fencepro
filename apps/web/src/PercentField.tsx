/**
 * A percent typed the way people say it: "44" or "44%". Shown as "44%".
 * Never a decimal like 0.44 on screen.
 */

import { useEffect, useState } from 'react'
import { parsePercent } from './configStore'

export default function PercentField({ value, onChange, onBad, min = 0, max = 99, placeholder, className = '', ...rest }: {
  /** The percent (44 for 44%), or undefined when blank. */
  value: number | undefined
  onChange: (pct: number | undefined) => void
  /** Told why the text typed was refused (null: it was not), to say so beside it: not a percent, or outside min to max. */
  onBad?: (why: 'letters' | 'range' | null) => void
  min?: number
  max?: number
  placeholder?: string
  className?: string
} & Record<`data-${string}`, string | boolean | undefined>) {
  const show = (v: number | undefined) => (v == null ? '' : `${Math.round(v * 100) / 100}%`)
  const [text, setText] = useState(show(value))
  const [bad, setBad] = useState(false)
  useEffect(() => { setText(show(value)) }, [value])
  function commit() {
    // Blank: whatever the number becomes is shown (a fence back to the number it follows), never an empty box.
    if (!text.trim()) { setBad(false); onBad?.(null); onChange(undefined); setText(show(value)); return }
    const n = parsePercent(text)
    // Refused: the box goes back to the number in use (never keeps a number that was not taken), and says why.
    if (n == null || n < min || n > max) { setBad(true); onBad?.(n == null ? 'letters' : 'range'); setText(show(value)); return }
    setBad(false); onBad?.(null)
    onChange(n)
    setText(show(n))
  }
  return (
    <input type="text" inputMode="decimal" value={text} placeholder={placeholder}
      onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      aria-invalid={bad || undefined} title={bad ? `Type a percent from ${min} to ${max}, like 44 or 44%` : undefined}
      className={`${className} ${bad ? 'border-red-400 ring-2 ring-red-200' : ''}`} {...rest} />
  )
}
