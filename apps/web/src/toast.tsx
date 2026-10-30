/**
 * Toast notification system — global, dispatch from anywhere.
 *
 * Usage:
 *   import { toast } from './toast'
 *   toast.success('Saved!')
 *   toast.error('Could not save — check your connection.')
 *
 * Mount <ToastContainer /> once near the root of the app.
 */

import { useEffect, useState } from 'react'
import { plainText } from './plainError'
import { shownToast, bottomAbove, toastMs } from './toastQueue'

export type ToastKind = 'success' | 'error' | 'info' | 'warning'

export interface ToastMessage {
  id: string
  kind: ToastKind
  title: string
  body?: string
  ttlMs: number
}

type Listener = (msgs: ToastMessage[]) => void

const listeners = new Set<Listener>()
let current: ToastMessage[] = []
const uid = () => Math.random().toString(36).slice(2, 10)

function emit() {
  for (const l of listeners) l(current)
}

function push(kind: ToastKind, title: string, body?: string, ttlMs: number = toastMs(kind, title, body)): string {
  const msg: ToastMessage = { id: uid(), kind, title, body, ttlMs }
  current = [...current, msg]
  emit()
  return msg.id
  // Its time starts when it is on screen (one at a time; ToastContainer), so none goes unseen.
}

function dismiss(id: string) {
  current = current.filter(m => m.id !== id)
  emit()
}

export const toast = {
  success: (title: string, body?: string) => push('success', title, body),
  error:   (title: string, body?: string) => push('error', title, body),
  info:    (title: string, body?: string) => push('info', title, body),
  warning: (title: string, body?: string) => push('warning', title, body),
  dismiss,
}

export function ToastContainer() {
  const [msgs, setMsgs] = useState<ToastMessage[]>([])
  useEffect(() => {
    const l: Listener = (m) => setMsgs([...m])
    listeners.add(l)
    return () => { listeners.delete(l) }
  }, [])

  const styles: Record<ToastKind, string> = {
    success: 'bg-green-600 text-white',
    error:   'bg-red-600 text-white',
    warning: 'bg-yellow-500 text-white',
    info:    'bg-gray-900 text-white',
  }
  const icons: Record<ToastKind, string> = {
    success: '✓', error: '✕', warning: '⚠', info: 'ℹ',
  }

  // One at a time (toastQueue.ts), just above the quote's bar when it is open, so it never covers Next or the drawing's buttons.
  const { shown, waiting } = shownToast(msgs)
  const [lift, setLift] = useState<number | null>(null)
  // The one on screen goes after its own time; the next one then shows for its full time.
  useEffect(() => {
    if (!shown || shown.ttlMs <= 0) return
    const t = setTimeout(() => dismiss(shown.id), shown.ttlMs)
    return () => clearTimeout(t)
  }, [shown?.id])  // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!shown) return
    const place = () => {
      const bar = [...document.querySelectorAll<HTMLElement>('[data-quote-bar], [data-toast-above]')].find(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed')
      setLift(bottomAbove(bar ? bar.getBoundingClientRect().top : null, window.innerHeight))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [shown?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    // At the bottom, above the phone's tab bar and the quote's Save bar: never over a name or its save status at the top.
    <div className="fixed z-(--z-toast) flex flex-col-reverse gap-2 pointer-events-none inset-x-3 bottom-[calc(108px+env(safe-area-inset-bottom))] md:inset-x-auto md:right-4 md:bottom-4 md:max-w-sm"
      style={lift != null ? { bottom: lift } : undefined} data-toasts={msgs.length}>
      {(shown ? [shown] : []).map(m => (
        <div key={m.id} data-toast={m.kind}
          className={`${styles[m.kind]} rounded-xl shadow-lg px-4 py-3 flex items-start gap-3 pointer-events-auto animate-in slide-in-from-bottom`}>
          <span className="text-lg leading-none shrink-0">{icons[m.kind]}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{m.title}</p>
            {/* The whole message, wrapped (review Oct 28 2026: cut off with "…" on a phone); a very long one scrolls. */}
            {m.body && <p className="text-xs opacity-90 mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere] max-h-[40vh] overflow-y-auto" data-toast-body>{m.body}</p>}
            {waiting > 0 && <p className="text-[11px] opacity-75 mt-0.5" data-toast-waiting={waiting}>{waiting} more after this</p>}
          </div>
          <button onClick={() => dismiss(m.id)}
            className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-white/70 hover:text-white leading-none text-lg -mr-1">×</button>
        </div>
      ))}
    </div>
  )
}
