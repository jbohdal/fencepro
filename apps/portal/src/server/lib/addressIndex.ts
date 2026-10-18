/**
 * Address suggestions from Marion County's own property list, kept on the Mac
 * ($0, no account, works for rural addresses that map services do not know).
 *
 * The list is the county's parcel layer (Property Appraiser data, updated
 * weekly by the county, public): every property's street address and its
 * center point. City and ZIP come from the owner's mailing address where the
 * owner lives there; every other property takes the city and ZIP of the
 * nearest such property. Read again once a month (and at start if missing).
 *
 * Tested Oct 18, 2026 on 30 real customer addresses, mostly rural (Ocklawaha,
 * Silver Springs, Fort McCoy, Belleview, Ocala), typing only the house number
 * and the start of the street: county 28 of 30 in the first suggestions,
 * Photon (OpenStreetMap) 1 of 30. The US Census lookup found 28 of 30 typed in
 * full; it is the fallback for a complete address the county list lacks.
 */

import fs from 'fs'
import path from 'path'

const SOURCE = 'https://gis.ocalafl.org/arcgis/rest/services/Public/Parcels/FeatureServer/0/query'
const REFRESH_DAYS = 30
const DATA_DIR = path.resolve(process.env.ADDRESS_DATA_DIR || './data/addresses')
const FILE = path.join(DATA_DIR, 'marion.json')

/** One property: street as the county writes it, city, ZIP, and its center point. */
export type AddressRow = [street: string, city: string, zip: string, lng: number, lat: number]
export interface Suggestion { formatted: string; line1: string; city: string; state: string; zip: string; lat: number; lng: number; source: 'county' | 'census' }

let rows: AddressRow[] = []
let keys: string[][] = []
let loadedAt = 0

// ── Words as the county writes them ──────────────────────────────────────────

const WORDS: Record<string, string> = {
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  STREET: 'ST', ROAD: 'RD', AVENUE: 'AVE', AV: 'AVE', COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL', PI: 'PL', TERRACE: 'TER', TERR: 'TER',
  TRAIL: 'TRL', DRIVE: 'DR', LANE: 'LN', HIGHWAY: 'HWY', BOULEVARD: 'BLVD', TRACE: 'TRCE', PARKWAY: 'PKWY', POINT: 'PT',
  RUN: 'RUN', LOOP: 'LOOP', WAY: 'WAY', PASS: 'PASS', COVE: 'CV', CROSSING: 'XING', SQUARE: 'SQ', EXTENSION: 'EXT',
  SR: 'HWY', US: 'HWY', CR: 'HWY', FL: 'HWY',
}
const DIRS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])

/** Address words in the county's form: "17008 Southeast 60th St." -> ["17008","SE","60","ST"]; "FL-40" -> ["HWY","40"]. */
export function addressWords(s: string): string[] {
  return s.toUpperCase().replace(/[.,#]/g, ' ').replace(/\b(FL|SR|US|CR)-(\d)/g, '$1 $2').split(/\s+/).filter(Boolean)
    .map(t => WORDS[t] ?? t)
    .map(t => t.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1'))
}

/**
 * Does what was typed match this street? The house number must be the same;
 * each further word typed must start a word of the street, in order; a
 * direction (E, SE...) may be left out when typing.
 */
export function matches(typed: string[], street: string[]): boolean {
  if (!typed.length || !street.length || typed[0] !== street[0]) return false
  let j = 1
  for (let i = 1; i < typed.length; i++) {
    const t = typed[i]
    const last = i === typed.length - 1
    while (j < street.length && !(last ? street[j].startsWith(t) : street[j] === t || (WORDS[t] ?? t) === street[j])) {
      // Only a direction (or "HWY" before a road number) may be skipped.
      if (!DIRS.has(street[j]) && street[j] !== 'HWY') return false
      j++
    }
    if (j >= street.length) {
      // "Rd" typed after a street whose name already ends: allowed (165th Ct Rd).
      return last && i > 1
    }
    j++
  }
  return true
}

// ── The list ─────────────────────────────────────────────────────────────────

function load(): void {
  try {
    const st = fs.statSync(FILE)
    if (st.mtimeMs === loadedAt) return
    rows = JSON.parse(fs.readFileSync(FILE, 'utf8')) as AddressRow[]
    keys = rows.map(r => addressWords(r[0]))
    loadedAt = st.mtimeMs
    console.log(`[addresses] ${rows.length} Marion County addresses loaded`)
  } catch { /* not there yet: the refresh makes it */ }
}

export function addressCount(): number { load(); return rows.length }

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
/** A street as people write it: "17008 SE 60th St" (the county's "All Units" left off). */
const streetText = (s: string) => title(s.replace(/\s+ALL UNITS$/i, '')).replace(/\b(Ne|Nw|Se|Sw)\b/g, m => m.toUpperCase())
/** A city as people write it: "Ft Mccoy" and "Fort Mc Coy" are Fort McCoy. */
export const cityText = (s: string) => title(s).replace(/^Ft\.? /, 'Fort ').replace(/\bMc ?coy\b/i, 'McCoy')
const toSuggestion = (r: AddressRow): Suggestion => ({
  line1: streetText(r[0]),
  city: cityText(r[1]), state: 'FL', zip: r[2], lat: r[4], lng: r[3], source: 'county',
  formatted: `${streetText(r[0])}, ${cityText(r[1])}, FL ${r[2]}`,
})

/** Up to `limit` county addresses for what has been typed (house number first). */
export function suggestCounty(q: string, limit = 6): Suggestion[] {
  load()
  const typed = addressWords(q.split(',')[0])
  if (!typed.length || !/^\d+$/.test(typed[0])) return []
  if (typed[typed.length - 1] === 'ALL') typed.pop()
  const out: Suggestion[] = []
  for (let i = 0; i < rows.length && out.length < limit; i++) if (matches(typed, keys[i])) out.push(toSuggestion(rows[i]))
  return out
}

/** The county point for a full address ("street, city, FL zip"), when the street and ZIP (or city) agree. */
export function countyPoint(address: string): { lat: number; lng: number } | null {
  load()
  if (!rows.length) return null
  const [street, ...rest] = address.split(',')
  const typed = addressWords(street)
  if (typed.length < 2 || !/^\d+$/.test(typed[0])) return null
  const tail = rest.join(' ').toUpperCase()
  const zip = tail.match(/\b(\d{5})\b/)?.[1]
  for (let i = 0; i < rows.length; i++) {
    const k = keys[i]
    if (k[0] !== typed[0] || k.length < typed.length - 1) continue
    if (!(k.join(' ') === typed.join(' ') || matches(typed, k))) continue
    if (zip ? rows[i][2] !== zip : !tail.includes(cityText(rows[i][1]).toUpperCase()) && !tail.includes(rows[i][1].toUpperCase())) continue
    return { lat: rows[i][4], lng: rows[i][3] }
  }
  return null
}

/** A complete address the county list lacks: the US Census lookup (free), as one suggestion. */
export async function suggestCensus(q: string): Promise<Suggestion | null> {
  const words = q.trim().split(/\s+/)
  if (words.length < 3 || !/^\d+$/.test(words[0])) return null
  const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(/\bFL\b|florida/i.test(q) ? q : `${q}, FL`)
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    const m = (await r.json())?.result?.addressMatches?.[0]
    if (!m?.coordinates) return null
    const [line1, city, state, zip] = String(m.matchedAddress).split(',').map((s: string) => s.trim())
    if (state !== 'FL') return null
    const l1 = streetText(line1), c = cityText(city)
    return { line1: l1, city: c, state, zip, lat: m.coordinates.y, lng: m.coordinates.x, source: 'census', formatted: `${l1}, ${c}, ${state} ${zip}` }
  } catch { return null } finally { clearTimeout(t) }
}

export async function suggest(q: string, limit = 6): Promise<Suggestion[]> {
  const county = suggestCounty(q, limit)
  if (county.length) return county
  const census = await suggestCensus(q)
  return census ? [census] : []
}

// ── Monthly refresh from the county ──────────────────────────────────────────

const CITY_ZIP = /^(.*?)\s+FL\s+(\d{5})/

/** Read the county's property list again and write the file. */
export async function refreshAddressData(fetchFn: typeof fetch = fetch): Promise<number> {
  const raw: Array<[string, string, string, string, number, number]> = []
  for (let off = 0; ; ) {
    const qs = new URLSearchParams({ where: "situs_1 <> ' '", outFields: 'situs_1,add_1,add_2,add_3', returnGeometry: 'false', returnCentroid: 'true', outSR: '4326', orderByFields: 'OBJECTID', resultOffset: String(off), resultRecordCount: '20000', f: 'json' })
    const r = await fetchFn(`${SOURCE}?${qs}`)
    const d: any = await r.json()
    if (!Array.isArray(d?.features)) throw new Error(`county service: ${JSON.stringify(d?.error ?? d).slice(0, 200)}`)
    for (const f of d.features) {
      const a = f.attributes, c = f.centroid
      if (!a?.situs_1?.trim() || !c) continue
      raw.push([a.situs_1.trim(), a.add_1 ?? '', a.add_2 ?? '', a.add_3 ?? '', c.x, c.y])
    }
    off += d.features.length
    if (!d.features.length || (d.features.length < 20000 && !d.exceededTransferLimit)) break
  }
  if (raw.length < 100_000) throw new Error(`only ${raw.length} addresses came back; the old list is kept`)
  // City and ZIP where the owner lives there.
  const out: Array<[string, string, string, number, number]> = raw.map(([street, a1, a2, a3, x, y]) => {
    let city = '', zip = ''
    if (addressWords(a1).join(' ') === addressWords(street).join(' ')) {
      for (const line of [a2, a3]) { const m = line.trim().match(CITY_ZIP); if (m) { city = title(m[1]); zip = m[2]; break } }
    }
    return [street, city, zip, Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6]
  })
  // Everyone else: the nearest property whose city and ZIP are known.
  const G = 0.01, grid = new Map<string, number[]>()
  out.forEach((p, i) => { if (p[1]) { const k = `${Math.floor(p[3] / G)},${Math.floor(p[4] / G)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(i) } })
  for (const p of out) {
    if (p[1]) continue
    const gx = Math.floor(p[3] / G), gy = Math.floor(p[4] / G)
    let best = -1, bestD = Infinity
    for (let r = 0; r <= 8 && best < 0; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        for (const i of grid.get(`${gx + dx},${gy + dy}`) ?? []) {
          const d = (out[i][3] - p[3]) ** 2 + (out[i][4] - p[4]) ** 2
          if (d < bestD) { bestD = d; best = i }
        }
      }
    }
    if (best >= 0) { p[1] = out[best][1]; p[2] = out[best][2] }
  }
  const list = out.filter(p => p[1] && p[2])
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const tmp = `${FILE}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(list))
  fs.renameSync(tmp, FILE)
  load()
  console.log(`[addresses] refreshed from the county: ${list.length} addresses`)
  return list.length
}

export function startAddressRefresh(): void {
  if (process.env.DISABLE_CRON === '1' || process.env.ADDRESS_REFRESH === 'off') return
  const tick = () => {
    let age = Infinity
    try { age = Date.now() - fs.statSync(FILE).mtimeMs } catch { /* missing */ }
    if (age < REFRESH_DAYS * 86_400_000) { load(); return }
    refreshAddressData().catch(err => console.error('[addresses] refresh failed (the old list is kept):', String((err as Error)?.message || err).slice(0, 200)))
  }
  setTimeout(tick, 60_000).unref()
  setInterval(tick, 86_400_000).unref()
}
