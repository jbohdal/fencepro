/**
 * Good, Better, Best tier sets, kept on the server (/api/tier-sets). Nothing
 * is kept in the browser beyond the last list read, in memory, so the quote
 * builder can draw at once and then shows the server's list.
 */

import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import { plainText } from './plainError'
import type { TierSet, TierSpec } from './tiers'

const EVENT = 'ezbiz:tier-sets'
let cache: TierSet[] | null = null

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await sendJson(method, `/api/tier-sets${path}`, body)
  if (!r.result.ok) {
    const err = new Error(plainText(r.json?.error || (r.status === 0 ? 'Failed to fetch' : 'Something went wrong'), 'The tier set')) as Error & { status?: number; data?: unknown }
    err.status = r.status; err.data = r.json?.data
    throw err
  }
  return (r.json?.data ?? r.json) as T
}

function publish(list: TierSet[]) {
  cache = list
  try { window.dispatchEvent(new CustomEvent(EVENT)) } catch { /* not in a browser */ }
}

/** Read every set from the server (it makes the starting sets the first time). */
export async function loadTierSets(): Promise<TierSet[]> {
  const list = await call<TierSet[]>('GET', '')
  publish(list)
  return list
}

/** Loaded with the rest of the company's data when the app starts (App.tsx STORE_LOADERS). */
export async function initTierSets(): Promise<void> { await loadTierSets() }
export function isTierSetsLoaded(): boolean { return cache !== null }

/** The sets (already in memory from the app's start); read again when the calling screen opens, retried until they arrive. */
export function useTierSets(): { sets: TierSet[] | null; error: string | null } {
  const [sets, setSets] = useState<TierSet[] | null>(cache)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const on = () => setSets(cache)
    window.addEventListener(EVENT, on)
    let stop = false, timer: ReturnType<typeof setTimeout> | undefined
    // Weak signal: keep trying (every 5 seconds) until they arrive.
    const tryLoad = () => loadTierSets().then(() => setError(null)).catch(e => {
      setError(String(e?.message || e))
      if (!stop && cache === null) timer = setTimeout(tryLoad, 5000)
    })
    void tryLoad()
    return () => { stop = true; if (timer) clearTimeout(timer); window.removeEventListener(EVENT, on) }
  }, [])
  return { sets, error }
}

export async function createTierSet(set: { id: string; category: string; tiers: TierSpec[]; popular: string | null }): Promise<TierSet> {
  const row = await call<TierSet>('POST', '', set)
  publish([...(cache ?? []).filter(s => s.id !== row.id), row])
  return row
}

export async function updateTierSet(set: TierSet): Promise<TierSet> {
  try {
    const row = await call<TierSet>('PUT', `/${encodeURIComponent(set.id)}`, { tiers: set.tiers, popular: set.popular, sortOrder: set.sortOrder, version: set.version })
    publish((cache ?? []).map(s => (s.id === row.id ? row : s)))
    return row
  } catch (e) {
    // Someone else saved first: show theirs.
    const data = (e as { data?: TierSet }).data
    if ((e as { status?: number }).status === 409 && data?.id) publish((cache ?? []).map(s => (s.id === data.id ? data : s)))
    throw e
  }
}

export async function deleteTierSet(id: string): Promise<void> {
  await call('DELETE', `/${encodeURIComponent(id)}`)
  publish((cache ?? []).filter(s => s.id !== id))
}
