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
export interface Suggestion { formatted: string; line1: string; city: string; state: string; zip: string; lat: number; lng: number; source: 'county' | 'street' | 'census' }

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
/** Each direction spelled out, for a word typed part way ("Southe" is SE). */
const DIR_WORDS: Record<string, string> = { N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST', NE: 'NORTHEAST', NW: 'NORTHWEST', SE: 'SOUTHEAST', SW: 'SOUTHWEST' }

/** The direction of a street (the first direction word after the house number), or ''. */
export function directionOf(words: string[]): string {
  return words.slice(1).find(w => DIRS.has(w)) ?? ''
}

/**
 * Do two directions name the same side of town? The same, or one is part of the other: "SE Fort King St" and the
 * county's "E Fort King St" (review Oct 28 2026: for "2200 SE Fort King St" the suggestions were W and E only).
 * W is never SE. A street with no direction fits any.
 */
export function directionsFit(a: string, b: string): boolean {
  if (!a || !b || a === b) return true
  return (a.length === 2 && a.includes(b)) || (b.length === 2 && b.includes(a))
}

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
    // The last word may be typed part way, a direction too: "Southe" is SE, "Nor" is N, NE or NW.
    const fits = (w: string) => last ? w.startsWith(t) || (t.length >= 2 && DIRS.has(w) && DIR_WORDS[w].startsWith(t)) : w === t || (WORDS[t] ?? t) === w
    while (j < street.length && !fits(street[j])) {
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
  const r = countyRow(address)
  return r ? { lat: r[4], lng: r[3] } : null
}

function countyRow(address: string): AddressRow | null {
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
    return rows[i]
  }
  return null
}

/**
 * An address the county list lacks on a street it has ("2715 SE 3rd St" when
 * the county lists 1419 and 3159 SE 3rd St): placed between the nearest house
 * numbers on that street (in the ZIP typed, if one was), with their city and
 * ZIP. Within 2,000 house numbers of a listed one; null otherwise. The street
 * is the one typed, never a similar one.
 */
export function streetEstimate(address: string): Suggestion | null {
  load()
  if (!rows.length) return null
  const [street, ...rest] = address.split(',')
  const typed = addressWords(street)
  if (typed.length < 2 || !/^\d+$/.test(typed[0])) return null
  const n = Number(typed[0])
  const zip = rest.join(' ').match(/\b(\d{5})\b/)?.[1]
  const onStreet = (name: string) => {
    const out: Array<{ n: number; r: AddressRow }> = []
    for (let i = 0; i < rows.length; i++) {
      const k = keys[i]
      if (!/^\d+$/.test(k[0]) || k.slice(1).join(' ') !== name) continue
      if (zip && rows[i][2] !== zip) continue
      out.push({ n: Number(k[0]), r: rows[i] })
    }
    return out
  }
  let same = onStreet(typed.slice(1).join(' '))
  // "SE Fort King St" when the county writes that street "E Fort King St" (and no SE one): placed on the county's
  // street of the same name with the one letter direction, the typed SE kept (review Oct 28 2026).
  if (!same.length && typed[1]?.length === 2 && DIRS.has(typed[1])) {
    for (const d of typed[1].split('')) same = same.concat(onStreet([d, ...typed.slice(2)].join(' ')))
  }
  if (!same.length) return null
  // The ZIP most of the street is in, when none was typed (a long road crosses towns: the nearest numbers decide).
  const below = same.filter(x => x.n <= n).sort((a, b) => b.n - a.n)[0]
  const above = same.filter(x => x.n >= n).sort((a, b) => a.n - b.n)[0]
  const near = [below, above].filter((x): x is { n: number; r: AddressRow } => !!x).sort((a, b) => Math.abs(a.n - n) - Math.abs(b.n - n))
  if (!near.length || Math.abs(near[0].n - n) > 2000) return null
  let lat = near[0].r[4], lng = near[0].r[3]
  if (below && above && below.n !== above.n && Math.abs(above.n - below.n) <= 4000) {
    const t = (n - below.n) / (above.n - below.n)
    lat = below.r[4] + (above.r[4] - below.r[4]) * t
    lng = below.r[3] + (above.r[3] - below.r[3]) * t
  }
  const r = near[0].r
  const line1 = streetText(street.trim().toUpperCase().replace(/\s+/g, ' '))
  return { line1, city: cityText(r[1]), state: 'FL', zip: r[2], lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6, source: 'street', formatted: `${line1}, ${cityText(r[1])}, FL ${r[2]}` }
}

/** ZIPs in the county list (Marion County). */
let marionZips: Set<string> | null = null
function inMarion(zip: string): boolean {
  load()
  if (!rows.length) return false
  if (!marionZips || marionZips.size === 0) marionZips = new Set(rows.map(r => r[2]))
  return marionZips.has(zip)
}

export interface AddressParts { city: string; state: string; zip: string }

/**
 * City, state and ZIP from a one line address, for a customer saved with the
 * address only: the county's own record when the street and ZIP (or city)
 * match, otherwise read from the text ("street, city, FL 34471",
 * "street, city FL 34471"). A part that cannot be read is left empty.
 */
export function addressParts(address: string): AddressParts {
  const out: AddressParts = { city: '', state: '', zip: '' }
  const a = (address || '').trim()
  if (!a) return out
  const row = countyRow(a)
  if (row) return { city: cityText(row[1]), state: 'FL', zip: row[2] }
  const parts = a.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length < 2) return out
  const last = parts[parts.length - 1]
  const stZip = last.match(/^(?:(.*?)\s+)?([A-Za-z]{2}|Florida)\.?(?:\s+(\d{5})(?:-\d{4})?)?$/i)
  const zipOnly = last.match(/^(\d{5})(?:-\d{4})?$/)
  if (stZip && (!stZip[1] || parts.length === 2)) {
    out.state = /^florida$/i.test(stZip[2]) ? 'FL' : stZip[2].toUpperCase()
    out.zip = stZip[3] ?? ''
    // "street, city FL 34471": the city is before the state; "street, city, FL": the part before.
    out.city = stZip[1] ? title(stZip[1]) : parts.length >= 3 ? title(parts[parts.length - 2]) : ''
  } else if (zipOnly && parts.length >= 3) {
    out.zip = zipOnly[1]
    const st = parts[parts.length - 2].match(/^(?:(.*?)\s+)?([A-Za-z]{2}|Florida)$/i)
    if (st) { out.state = /^florida$/i.test(st[2]) ? 'FL' : st[2].toUpperCase(); out.city = st[1] ? title(st[1]) : parts.length >= 4 ? title(parts[parts.length - 3]) : '' }
  }
  // A state that is not two letters is not one ("Ocala, Marion"): nothing read.
  if (out.state && !/^[A-Z]{2}$/.test(out.state)) return { city: '', state: '', zip: '' }
  if (/^\d/.test(out.city)) out.city = ''
  return out
}

/** Ocala, the middle of the area the company works in (Marion County and its neighbours). */
export const SERVICE_CENTER = { lat: 29.1872, lng: -82.1401 }
/** How far from Ocala a Census match may be and still be offered (miles). Okeechobee, with the same SE street names, is about 170. */
export const SERVICE_RADIUS_MILES = 60

const milesBetween = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const rad = Math.PI / 180, dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.sqrt(h))
}

/**
 * The Census answer's matches as suggestions: in Florida and in the work
 * area only, nearest to Ocala first. Typed without a city, a Marion County
 * street the county list lacks ("2715 SE 3rd St") was matched to the same
 * street in Okeechobee and offered first (Oct 24, 2026 walkthrough).
 */
export function censusSuggestions(matches: unknown, center = SERVICE_CENTER, maxMiles = SERVICE_RADIUS_MILES, marion: (zip: string) => boolean = () => false): Suggestion[] {
  if (!Array.isArray(matches)) return []
  const out: Array<Suggestion & { miles: number }> = []
  for (const m of matches as any[]) {
    const x = Number(m?.coordinates?.x), y = Number(m?.coordinates?.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    const [line1, city, state, zip] = String(m?.matchedAddress ?? '').split(',').map((s: string) => s.trim())
    if (state !== 'FL' || !line1) continue
    const miles = milesBetween(center, { lat: y, lng: x })
    if (miles > maxMiles) continue
    const l1 = streetText(line1), c = cityText(city ?? '')
    out.push({ line1: l1, city: c, state, zip: zip ?? '', lat: y, lng: x, source: 'census', formatted: `${l1}, ${c}, ${state} ${zip ?? ''}`.trim(), miles })
  }
  // Marion County first, then nearest to Ocala.
  return out.sort((a, b) => Number(marion(b.zip)) - Number(marion(a.zip)) || a.miles - b.miles).map(({ miles: _m, ...s }) => s)
}

/** The company's own town: asked first when no city or ZIP was typed. */
export const HOME_CITY = 'Ocala, FL'

/** Did the typing name a city or a ZIP (anything after the street, or a 5 digit number after it)? */
export function namesTown(q: string): boolean {
  const [street, ...rest] = q.split(',')
  return rest.join(' ').trim().length > 0 || /\b\d{5}\b/.test(street.trim().split(/\s+/).slice(1).join(' '))
}

/** The Census questions for what was typed: with no city, "…, Ocala, FL" first, then "…, FL". */
export function censusQueries(q: string): string[] {
  const t = q.trim()
  if (namesTown(t)) return [/\bFL\b|florida/i.test(t) ? t : `${t}, FL`]
  return [`${t}, ${HOME_CITY}`, `${t}, FL`]
}

async function census(address: string): Promise<unknown[]> {
  const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(address)
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    const m = (await r.json())?.result?.addressMatches
    return Array.isArray(m) ? m : []
  } catch { return [] } finally { clearTimeout(t) }
}

/** The Census lookup (free) for an address the county list lacks: matches in the work area, Marion County first, then nearest. */
export async function suggestCensusAll(q: string): Promise<Suggestion[]> {
  const words = q.trim().split(/\s+/)
  if (words.length < 3 || !/^\d+$/.test(words[0])) return []
  const seen = new Set<string>()
  const out: Suggestion[] = []
  // A direction typed (SE) keeps the Census matches on that side of town only (never W for SE), the same one first.
  const typedDir = directionOf(addressWords(q.split(',')[0]))
  for (const ask of censusQueries(q)) {
    for (const s of censusSuggestions(await census(ask), SERVICE_CENTER, SERVICE_RADIUS_MILES, inMarion)) {
      if (!directionsFit(typedDir, directionOf(addressWords(s.line1)))) continue
      if (seen.has(s.formatted)) continue
      seen.add(s.formatted); out.push(s)
    }
    if (out.some(s => inMarion(s.zip))) break
  }
  const sameDir = (s: Suggestion) => Number(!!typedDir && directionOf(addressWords(s.line1)) === typedDir)
  return out.sort((a, b) => Number(inMarion(b.zip)) - Number(inMarion(a.zip)) || sameDir(b) - sameDir(a))
}

/** The first Census suggestion, or null. */
export async function suggestCensus(q: string): Promise<Suggestion | null> {
  return (await suggestCensusAll(q))[0] ?? null
}

/**
 * Suggestions as an address is typed: the county list; else the typed street
 * placed by its neighbours on the county list (its city and ZIP filled in),
 * then the Census matches in the work area (Marion County first).
 */
export async function suggest(q: string, limit = 6): Promise<Suggestion[]> {
  const county = suggestCounty(q, limit)
  if (county.length) return county
  const street = streetEstimate(q)
  const census = await suggestCensusAll(q)
  const all = [...(street ? [street] : []), ...census.filter(c => !street || c.formatted.toUpperCase() !== street.formatted.toUpperCase())]
  return all.slice(0, limit)
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
