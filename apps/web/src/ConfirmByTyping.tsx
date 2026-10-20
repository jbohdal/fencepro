/**
 * A delete that cannot happen by a stray tap: the person types the name of
 * what is being deleted, and the red button stays off until it matches
 * (capitals and spaces at the ends don't matter, nor double spaces inside).
 *
 * On a phone it rises from the bottom; on a wide screen it sits in the middle.
 * The phone's back button and Escape cancel it.
 */
import { useEffect, useRef, useState } from 'react'
import { BackClose } from './nav'
import { sameName } from './popupPlace'

export { sameName }

export default function ConfirmByTyping({ title, name, body, action = 'Delete', onConfirm, onCancel }: {
  title: string
  /** What has to be typed. */
  name: string
  body?: string
  action?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const ok = sameName(typed, name)
  useEffect(() => { input.current?.focus() }, [])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  }, [onCancel])
  return (
    <div className="fixed inset-0 z-[1100] bg-black/40 flex items-end sm:items-center justify-center sm:p-4" onClick={onCancel} data-confirm-typing>
      <BackClose onClose={onCancel} name="confirm-delete" />
      <form role="alertdialog" aria-labelledby="confirm-typing-title" onClick={e => e.stopPropagation()}
        onSubmit={e => { e.preventDefault(); if (ok) onConfirm() }}
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl p-5 space-y-4 shadow-2xl pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <h2 id="confirm-typing-title" className="text-lg font-bold text-gray-900">{title}</h2>
        {body && <p className="text-sm text-gray-600">{body}</p>}
        <label className="block text-sm text-gray-700">
          Type <span className="font-semibold text-gray-900 select-all" data-confirm-name>{name}</span> to confirm.
          <input ref={input} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false}
            className="mt-2 w-full border border-gray-300 rounded-lg px-3 py-2.5 text-base" aria-label={`Type ${name} to confirm`} data-confirm-input />
        </label>
        <div className="flex gap-2 justify-end">
          <button type="button" onClick={onCancel} className="btn btn-secondary flex-1 sm:flex-none" data-confirm-cancel>Cancel</button>
          <button type="submit" disabled={!ok}
            className="btn flex-1 sm:flex-none bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed" data-confirm-delete>{action}</button>
        </div>
      </form>
    </div>
  )
}
