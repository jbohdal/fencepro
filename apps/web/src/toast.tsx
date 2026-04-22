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

function push(kind: ToastKind, title: string, body?: string, ttlMs = 4200) {
  const msg: ToastMessage = { id: uid(), kind, title, body, ttlMs }
  current = [...current, msg]
  emit()
  if (ttlMs > 0) setTimeout(() => dismiss(msg.id), ttlMs)
}

function dismiss(id: string) {
  current = current.filter(m => m.id !== id)
  emit()
}

export const toast = {
  success: (title: string, body?: string) => push('success', title, body),
  error:   (title: string, body?: string) => push('error', title, body, 7000),
  info:    (title: string, body?: string) => push('info', title, body),
  warning: (title: string, body?: string) => push('warning', title, body, 6000),
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

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm pointer-events-none">
      {msgs.map(m => (
        <div key={m.id}
          className={`${styles[m.kind]} rounded-xl shadow-lg px-4 py-3 flex items-start gap-3 pointer-events-auto animate-in slide-in-from-right`}>
          <span className="text-lg leading-none shrink-0">{icons[m.kind]}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold">{m.title}</p>
            {m.body && <p className="text-xs opacity-90 mt-0.5 whitespace-pre-wrap">{m.body}</p>}
          </div>
          <button onClick={() => dismiss(m.id)}
            className="text-white/70 hover:text-white leading-none text-lg -mr-1">×</button>
        </div>
      ))}
    </div>
  )
}
