/**
 * Dashboard, owner only: what is still on Jonathan to finish setting up, each
 * checked by the server against the data itself (so it ticks off when it is
 * really done), with a link to the right screen. Plus a warning when the Mac
 * is under 50 GB free. Gone once everything is done.
 */

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { getAccessToken, fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { navigate } from './nav'
import { toast } from './toast'

const API = window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''

interface Item { key: string; label: string; done: boolean; detail: string; link?: string; answer?: Array<{ label: string; value: string }> }

async function get<T>(path: string): Promise<T | null> {
  const r = await fetchWithAuth(`${API}${path}`, { headers: { Authorization: `Bearer ${getAccessToken()}` } }).catch(() => null)
  if (!r?.ok) return null
  const j = await r.json().catch(() => null)
  return j?.success ? (j.data as T) : null
}

export function DiskWarning() {
  const [s, setS] = useState<{ freeBytes: number; low: boolean } | null>(null)
  useEffect(() => { get<{ freeBytes: number; low: boolean }>('/api/system/storage').then(setS) }, [])
  if (!s?.low) return null
  return (
    <div className="bg-red-50 border border-red-200 rounded-2xl p-4" data-disk-warning>
      <p className="text-sm font-semibold text-red-900">The Mac mini has {Math.round(s.freeBytes / 1e9)} GB free</p>
      <p className="text-sm text-red-900">Under 50 GB. Photos and video stop saving when it runs out. Move old files off the Mac, or plug in an external drive for media.</p>
    </div>
  )
}

export default function FinishSetup() {
  const [items, setItems] = useState<Item[] | null>(null)
  const load = () => get<Item[]>('/api/system/setup').then(setItems)
  useEffect(() => { load() }, [])

  async function answer(key: string, value: string) {
    const r = await fetchWithAuth(`${API}/api/system/setup`, { method: 'POST', headers: { Authorization: `Bearer ${getAccessToken()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }) }).catch(() => null)
    if (r?.ok) { toast.success('Saved'); load() } else toast.error('Not saved', 'Check the connection and try again.')
  }

  if (!items) return null
  const left = items.filter(i => !i.done)
  if (!left.length) return null
  return (
    <section className="panel p-4 md:p-5" data-finish-setup>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h2 className="text-base font-bold text-gray-900">Finish setup</h2>
        <span className="text-sm text-gray-600 tabular-nums">{items.length - left.length} of {items.length} done</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {items.map(i => (
          <li key={i.key} className="py-2.5 flex items-start gap-3" data-setup-item={i.key} data-done={i.done ? 'true' : 'false'}>
            <span className={`mt-0.5 shrink-0 w-6 h-6 rounded-full grid place-items-center ${i.done ? 'bg-green-600 text-white' : 'border-2 border-gray-300'}`} aria-hidden="true">{i.done && <Check size={14} strokeWidth={3} />}</span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-semibold ${i.done ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{i.label}</p>
              <p className="text-xs text-gray-600">{i.detail}</p>
              {!i.done && (i.link || i.answer) && (
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {i.answer?.map(a => <button key={a.value} type="button" className="btn btn-secondary btn-sm" onClick={() => answer(i.key, a.value)} data-setup-answer={a.value}>{a.label}</button>)}
                  {i.link && <button type="button" className="btn btn-quiet btn-sm" onClick={() => navigate(i.link!)}>Open</button>}
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
