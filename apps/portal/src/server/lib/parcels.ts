/**
 * Property lines for the office site plan (GET /api/parcels): the county's
 * parcel at a spot on the map, its boundary as latitude and longitude, and
 * the neighbors' around it (thin lines on the plan), from the county's parcel
 * service. Server side only, 15 seconds at most per call, kept in memory for
 * an hour by the rounded spot.
 *
 * Sources per county (Settings config.sitePlan.parcelSources: county → one
 * source or a list tried in order; a source is { url, idField, where?, name? }).
 * Marion's default, both checked live on Nov 6 2026:
 *   1. Marion County Property Appraiser (field PARCEL, about 0.4 s)
 *   2. City of Ocala's copy of the same parcels (weekly; field parcel), used when the first fails
 * Other counties have no default: the office adds one (for example the Florida
 * statewide parcels from FDACS with where CO_NO=45 for Lake County).
 *
 * A point on the address often lands in the road, so when the point finds no
 * parcel the one containing it, else the nearest within about 100 ft, is
 * picked from the parcels around it.
 */

export interface LatLngT { lat: number; lng: number }

/** Feet east (x) and north (y) of `o` (flat over a few hundred feet; the plan's own math is web/src/sitePlanData.ts toFeet). */
function toFeetLocal(o: LatLngT, p: LatLngT): { x: number; y: number } {
  const ftPerDegLat = 364_000, ftPerDegLng = 364_000 * Math.cos((o.lat * Math.PI) / 180)
  return { x: (p.lng - o.lng) * ftPerDegLng, y: (p.lat - o.lat) * ftPerDegLat }
}

export interface ParcelSource { url: string; idField: string; where?: string; name?: string }
export interface FoundParcel { id: string; rings: LatLngT[][]; source: string; fetchedAt: string }
export interface ParcelAnswer { parcel: FoundParcel | null; neighbors: LatLngT[][][]; source: string; note: string }

export const MARION_PA: ParcelSource = { url: 'https://www.pa.marion.fl.us/arcgis/rest/services/MCPA_Services/Parcels/MapServer/0/query', idField: 'PARCEL', name: 'Marion County Property Appraiser' }
export const OCALA_PARCELS: ParcelSource = { url: 'https://gis.ocalafl.org/arcgis/rest/services/Public/Parcels/FeatureServer/0/query', idField: 'parcel', name: 'City of Ocala (Marion County parcels)' }
export const DEFAULT_PARCEL_SOURCES: Record<string, ParcelSource[]> = { Marion: [MARION_PA, OCALA_PARCELS] }

/** "marion county" → "Marion". */
export function countyName(county: unknown): string {
  const c = String(county ?? '').trim().replace(/\s+county$/i, '').trim()
  return c ? c.charAt(0).toUpperCase() + c.slice(1).toLowerCase() : ''
}

function asSource(v: any): ParcelSource | null {
  if (!v || typeof v !== 'object') return null
  const url = String(v.url ?? '').trim()
  if (!/^https:\/\/[^\s]+\/query$/i.test(url)) return null
  const idField = String(v.idField ?? '').trim()
  if (!/^[A-Za-z_][\w]*$/.test(idField)) return null
  const where = typeof v.where === 'string' && v.where.trim() ? v.where.trim().slice(0, 300) : undefined
  const name = typeof v.name === 'string' && v.name.trim() ? v.name.trim().slice(0, 120) : undefined
  return { url, idField, ...(where ? { where } : {}), ...(name ? { name } : {}) }
}

/** The sources for each county: Settings first (one source, or a list), then the defaults for counties Settings leaves out. */
export function parcelSourcesOf(saved: unknown): Record<string, ParcelSource[]> {
  const out: Record<string, ParcelSource[]> = { ...DEFAULT_PARCEL_SOURCES }
  if (saved && typeof saved === 'object') {
    for (const [k, v] of Object.entries(saved as Record<string, unknown>)) {
      const list = (Array.isArray(v) ? v : [v]).map(asSource).filter((x): x is ParcelSource => !!x)
      const name = countyName(k)
      if (!name) continue
      if (list.length) out[name] = list
      else if (v === null) delete out[name]
    }
  }
  return out
}

const sourceName = (s: ParcelSource) => s.name || new URL(s.url).hostname

// ── The answer from the county ────────────────────────────────────────────────

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>

async function query(s: ParcelSource, params: Record<string, string>, fetchFn: FetchFn, timeoutMs: number): Promise<any[]> {
  const qs = new URLSearchParams({
    where: s.where || '1=1', outFields: s.idField, returnGeometry: 'true', outSR: '4326', inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects', geometryPrecision: '7', f: 'json', ...params,
  })
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const r = await fetchFn(`${s.url}?${qs}`, { signal: ctl.signal })
    if (!r.ok) throw new Error(`answered ${r.status}`)
    const j = await r.json()
    if (j?.error) throw new Error(`said: ${String(j.error.message || 'error').slice(0, 120)}`)
    return Array.isArray(j?.features) ? j.features : []
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error(`did not answer in ${Math.round(timeoutMs / 1000)} seconds`)
    throw e
  } finally { clearTimeout(t) }
}

/** An ArcGIS feature's rings as latitude and longitude (the closing repeat of the first corner left off), biggest first. */
export function ringsOf(feature: any): LatLngT[][] {
  const rings: unknown = feature?.geometry?.rings
  if (!Array.isArray(rings)) return []
  const out: LatLngT[][] = []
  for (const ring of rings) {
    if (!Array.isArray(ring)) continue
    const pts = ring
      .filter((p: unknown): p is number[] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) <= 90 && Math.abs(p[0]) <= 180)
      .map(p => ({ lat: p[1], lng: p[0] }))
    if (pts.length > 1 && pts[0].lat === pts[pts.length - 1].lat && pts[0].lng === pts[pts.length - 1].lng) pts.pop()
    if (pts.length >= 3) out.push(pts.slice(0, 5000))
  }
  return out.sort((a, b) => ringArea(b) - ringArea(a))
}

function ringArea(r: LatLngT[]): number {
  const o = r[0]
  let a = 0
  for (let i = 0; i < r.length; i++) {
    const p = toFeetLocal(o, r[i]), q = toFeetLocal(o, r[(i + 1) % r.length])
    a += p.x * q.y - q.x * p.y
  }
  return Math.abs(a / 2)
}

function insideRing(at: LatLngT, ring: LatLngT[]): boolean {
  const q = toFeetLocal(at, at)
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = toFeetLocal(at, ring[i]), b = toFeetLocal(at, ring[j])
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y || 1e-9) + a.x) c = !c
  }
  return c
}

/** Feet from a spot to a parcel: 0 inside it, else to its nearest edge. */
export function feetToParcel(at: LatLngT, rings: LatLngT[][]): number {
  if (rings.some(r => insideRing(at, r))) return 0
  let best = Infinity
  for (const ring of rings) for (let i = 0; i < ring.length; i++) {
    const a = toFeetLocal(at, ring[i]), b = toFeetLocal(at, ring[(i + 1) % ring.length])
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, (-a.x * dx - a.y * dy) / l2))
    best = Math.min(best, Math.hypot(a.x + t * dx, a.y + t * dy))
  }
  return best
}

/** A box `halfFt` feet each way around a spot, as ArcGIS wants it (west,south,east,north). */
export function envelope(at: LatLngT, halfFt: number): string {
  const dLat = (halfFt * 0.3048) / 111_320
  const dLng = (halfFt * 0.3048) / (111_320 * Math.cos((at.lat * Math.PI) / 180))
  const f = (n: number) => n.toFixed(7)
  return `${f(at.lng - dLng)},${f(at.lat - dLat)},${f(at.lng + dLng)},${f(at.lat + dLat)}`
}

const NEIGHBOR_HALF_FT = 200
const PICK_WITHIN_FT = 100
const MAX_NEIGHBORS = 60

/** The parcel at a spot and its neighbors from one source (throws when the source fails). */
export async function parcelFromSource(at: LatLngT, s: ParcelSource, fetchFn: FetchFn = fetch as any, timeoutMs = 15_000): Promise<{ parcel: FoundParcel | null; neighbors: LatLngT[][][] }> {
  const [hit, around] = await Promise.all([
    query(s, { geometry: `${at.lng.toFixed(7)},${at.lat.toFixed(7)}`, geometryType: 'esriGeometryPoint' }, fetchFn, timeoutMs),
    query(s, { geometry: envelope(at, NEIGHBOR_HALF_FT), geometryType: 'esriGeometryEnvelope' }, fetchFn, timeoutMs),
  ])
  const idOf = (f: any) => String(f?.attributes?.[s.idField] ?? f?.attributes?.[s.idField.toLowerCase()] ?? f?.attributes?.[s.idField.toUpperCase()] ?? '').trim()
  const all = around.map(f => ({ id: idOf(f), rings: ringsOf(f) })).filter(p => p.rings.length)
  let mine: { id: string; rings: LatLngT[][] } | null = null
  const first = hit.map(f => ({ id: idOf(f), rings: ringsOf(f) })).find(p => p.rings.length)
  if (first) mine = first
  else {
    // The point missed (the road, a right of way): the parcel around it, else the nearest close by.
    const ranked = all.map(p => ({ p, d: feetToParcel(at, p.rings) })).sort((a, b) => a.d - b.d)
    if (ranked[0] && ranked[0].d <= PICK_WITHIN_FT) mine = ranked[0].p
  }
  const parcel = mine ? { id: mine.id, rings: mine.rings, source: sourceName(s), fetchedAt: new Date().toISOString() } : null
  const neighbors = all
    .filter(p => !mine || (p.id !== mine.id || JSON.stringify(p.rings[0]?.[0]) !== JSON.stringify(mine.rings[0]?.[0])))
    .map(p => ({ p, d: feetToParcel(at, p.rings) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_NEIGHBORS)
    .map(x => x.p.rings.map(r => r.slice(0, 2000)))
  return { parcel, neighbors }
}

// ── With the cache ────────────────────────────────────────────────────────────

const HOUR = 3_600_000
const cache = new Map<string, { at: number; answer: ParcelAnswer }>()

/** Forget every kept answer (tests). */
export function forgetParcels(): void { cache.clear() }

/**
 * The parcel at a spot for a county: each source in turn until one answers.
 * No source for the county: no parcel, and a note that says so.
 */
export async function parcelsAt(at: LatLngT, county: string, sources: Record<string, ParcelSource[]>, fetchFn: FetchFn = fetch as any, now = Date.now()): Promise<ParcelAnswer> {
  const name = countyName(county) || 'Marion'
  const list = sources[name] ?? []
  if (!list.length) return { parcel: null, neighbors: [], source: '', note: `No property line source is set for ${name} County. The plan works without property lines.` }
  // About 3.6 ft apart at Ocala: a spot moved a little on the map is the same answer.
  const key = `${name}|${at.lat.toFixed(5)}|${at.lng.toFixed(5)}|${list.map(s => s.url + (s.where ?? '')).join(',')}`
  const kept = cache.get(key)
  if (kept && now - kept.at < HOUR) return kept.answer
  const failed: string[] = []
  for (const s of list) {
    try {
      const { parcel, neighbors } = await parcelFromSource(at, s, fetchFn)
      const answer: ParcelAnswer = {
        parcel, neighbors, source: sourceName(s),
        note: parcel
          ? `Property lines: ${sourceName(s)}. Approximate, from county records, not a survey.`
          : `No property was found at this spot in the ${sourceName(s)} records. Move the plan onto the house, or go on without property lines.`,
      }
      if (cache.size > 500) cache.delete(cache.keys().next().value as string)
      cache.set(key, { at: now, answer })
      return answer
    } catch (e) {
      failed.push(`${sourceName(s)} ${(e as Error).message}`)
      console.warn('[parcels]', failed[failed.length - 1])
    }
  }
  return { parcel: null, neighbors: [], source: '', note: `The county's property records could not be reached (${failed.join('; ')}). Try again in a few minutes; the plan works without property lines.` }
}
