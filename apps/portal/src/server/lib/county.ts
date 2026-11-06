/**
 * Which county a job is in, for its property lines and its permit sheet
 * (Nov 6 2026: a Leesburg job was read as Marion, so Lake County's lines
 * never came). The U.S. Census Bureau's geocoder answers the county for a
 * spot on the map, or for an address (free, no key; checked live Nov 6 2026,
 * about 0.4 s). An address the Marion County address list knows is Marion
 * without asking (lib/addressIndex.ts). Answers are kept in memory for a day.
 */

import { countyPoint } from './addressIndex.js'

const BASE = 'https://geocoding.geo.census.gov/geocoder/geographies'
const DAY = 86_400_000
const kept = new Map<string, { at: number; county: string | null }>()

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<any> }>

async function ask(url: string, pick: (j: any) => any, fetchFn: FetchFn, timeoutMs: number): Promise<string | null> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetchFn(url, { signal: ctl.signal })
    if (!r.ok) return null
    const c = pick(await r.json())?.geographies?.Counties?.[0]
    // Florida only (state 12): "Lake".
    return c && String(c.STATE) === '12' && c.BASENAME ? String(c.BASENAME) : null
  } catch (e) {
    console.warn('[county]', (e as Error).name === 'AbortError' ? 'the Census geocoder did not answer in time' : (e as Error).message)
    return null
  } finally { clearTimeout(t) }
}

async function cached(key: string, run: () => Promise<string | null>, now: number): Promise<string | null> {
  const k = kept.get(key)
  if (k && now - k.at < DAY) return k.county
  const county = await run()
  // A failed lookup is not kept: the next one asks again.
  if (county) { if (kept.size > 2000) kept.delete(kept.keys().next().value as string); kept.set(key, { at: now, county }) }
  return county
}

/** The Florida county at a spot on the map ("Lake"), or null when it cannot be told. */
export function countyAt(lat: number, lng: number, fetchFn: FetchFn = fetch as any, now = Date.now()): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Promise.resolve(null)
  const qs = new URLSearchParams({ x: lng.toFixed(5), y: lat.toFixed(5), benchmark: 'Public_AR_Current', vintage: 'Current_Current', layers: 'Counties', format: 'json' })
  return cached(`at|${lat.toFixed(4)}|${lng.toFixed(4)}`, () => ask(`${BASE}/coordinates?${qs}`, j => j?.result, fetchFn, 10_000), now)
}

/** The Florida county of an address, or null. */
export function countyOfAddress(address: string, fetchFn: FetchFn = fetch as any, now = Date.now()): Promise<string | null> {
  const a = String(address || '').trim()
  if (!a) return Promise.resolve(null)
  if (countyPoint(a)) return Promise.resolve('Marion')
  const qs = new URLSearchParams({ address: a, benchmark: 'Public_AR_Current', vintage: 'Current_Current', layers: 'Counties', format: 'json' })
  return cached(`addr|${a.toLowerCase()}`, () => ask(`${BASE}/onelineaddress?${qs}`, j => j?.result?.addressMatches?.[0], fetchFn, 10_000), now)
}

/** Forget every kept answer (tests). */
export function forgetCounties(): void { kept.clear() }

/**
 * A job's county: from its spot on the map (the job's, else its plan's), else
 * its address; the permit's county as typed only when neither can be told.
 */
export async function jobCounty(job: { customerAddress: string; lat?: number | null; lng?: number | null }, planAt: { lat: number; lng: number } | null, permitCounty: string | null | undefined, fetchFn?: FetchFn): Promise<string> {
  if (countyPoint(job.customerAddress)) return 'Marion'
  const at = typeof job.lat === 'number' && typeof job.lng === 'number' ? { lat: job.lat, lng: job.lng } : planAt
  const byMap = at ? await countyAt(at.lat, at.lng, fetchFn) : null
  if (byMap) return byMap
  return (await countyOfAddress(job.customerAddress, fetchFn)) || String(permitCounty || '').trim() || 'Marion'
}
