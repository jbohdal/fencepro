/**
 * A phone number field for Settings. Shows the number the way the app writes
 * it, "(352) 789 4314" (phoneFormat.ts), except while it is being typed in.
 * What is saved is what was typed: a number nobody edits is saved exactly as
 * it was.
 */
import { useState, type InputHTMLAttributes } from 'react'
import { formatPhone } from './phoneFormat'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
}

export default function PhoneInput({ value, onChange, onBlur, ...rest }: Props) {
  const [typing, setTyping] = useState(false)
  return (
    <input type="tel" inputMode="tel" autoComplete="off" {...rest}
      value={typing ? value : formatPhone(value)}
      onBlur={e => { setTyping(false); onBlur?.(e) }}
      onChange={e => { setTyping(true); onChange(e.target.value) }} />
  )
}
