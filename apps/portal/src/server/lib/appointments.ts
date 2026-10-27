/**
 * Appointments on the server: where an address is on the map, reading a call
 * back time a caller said out loud, and the shape the browser gets back.
 *
 * Types, statuses and what a status change means for the pipeline live in the
 * browser (apps/web/src/appointmentLogic.ts). The few names the server needs
 * are repeated here; a test checks the two lists match.
 */

import prisma from './prisma.js'
import { countyPoint, streetEstimate } from './addressIndex.js'

export const APPOINTMENT_TYPES = ['estimate', 'follow_up', 'contract_signing', 'install', 'service', 'warranty', 'call_back', 'other'] as const
export const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'on_my_way', 'rescheduled', 'completed', 'no_show', 'cancelled'] as const
export const APPOINTMENT_OUTCOMES = ['ready_to_quote', 'needs_follow_up', 'not_interested', 'no_show', 'imported'] as const
export const TYPE_LABELS: Record<string, string> = {
  estimate: 'Estimate', follow_up: 'Follow up', contract_signing: 'Contract signing', install: 'Install',
  service: 'Service', warranty: 'Warranty', call_back: 'Call back', other: 'Appointment',
}
/** Default lengths in minutes; Settings can change them. 0 = all day. */
export const DEFAULT_MINUTES: Record<string, number> = {
  estimate: 60, follow_up: 30, contract_signing: 30, install: 0, service: 90, warranty: 60, call_back: 15, other: 60,
}

/* ── Map positions ───────────────────────────────────────────────────────── */

export function addressKey(address: string): string {
  return (address || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export interface Point { lat: number; lng: number }

/**
 * Which lookup service. US Census is free and needs no key. Setting
 * GEOCODER=google (with GOOGLE_MAPS_API_KEY) switches to Google; that is the
 * one setting to change when moving to a Google Maps key.
 */
export function geocoderName(): 'census' | 'google' {
  return process.env.GEOCODER === 'google' && process.env.GOOGLE_MAPS_API_KEY ? 'google' : 'census'
}

async function fetchJson(url: string, timeoutMs = 6000): Promise<any> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'EZBiz/1.0 (appointments)' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally { clearTimeout(t) }
}

async function lookupCensus(address: string): Promise<Point | null> {
  const url = 'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=' + encodeURIComponent(address)
  const j = await fetchJson(url)
  const hit = j?.result?.addressMatches?.[0]?.coordinates
  return hit && Number.isFinite(hit.y) && Number.isFinite(hit.x) ? { lat: hit.y, lng: hit.x } : null
}

async function lookupGoogle(address: string): Promise<Point | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?key=${encodeURIComponent(process.env.GOOGLE_MAPS_API_KEY || '')}&address=${encodeURIComponent(address)}`
  const j = await fetchJson(url)
  const loc = j?.results?.[0]?.geometry?.location
  return loc && Number.isFinite(loc.lat) ? { lat: loc.lat, lng: loc.lng } : null
}

/**
 * Where an address is. Looked up once per address and kept; a position set
 * by hand always wins. Null when the address cannot be found (or the lookup
 * service is down; that is not kept, so it is tried again next time).
 */
export async function locate(accountId: string, address: string): Promise<(Point & { source: string }) | null> {
  const key = addressKey(address)
  if (!key) return null
  const known = await prisma.geoPoint.findUnique({ where: { accountId_addressKey: { accountId, addressKey: key } } })
  if (known && known.lat != null && known.lng != null) return { lat: known.lat, lng: known.lng, source: known.source }
  // Not found before: an address the county list and the Census lack, on a street the county has,
  // is placed between its neighbours (Smart Schedule could not place such a job; review, Oct 25, 2026).
  if (known) {
    const near = streetEstimate(address)
    if (!near) return null
    await prisma.geoPoint.update({ where: { accountId_addressKey: { accountId, addressKey: key } }, data: { lat: near.lat, lng: near.lng, source: 'street' } }).catch(() => {})
    return { lat: near.lat, lng: near.lng, source: 'street' }
  }
  // Marion County's own property list first (exact, on the Mac), then the lookup service.
  const county = countyPoint(address)
  let point: Point | null
  let source = county ? 'county' : geocoderName()
  try { point = county ?? (source === 'google' ? await lookupGoogle(address) : await lookupCensus(address)) }
  catch (err) { console.error('[geo] lookup failed:', String((err as Error)?.message || err)); return null }
  // Neither has it: placed between its neighbours on the same street, when the county lists the street.
  if (!point) { const near = streetEstimate(address); if (near) { point = { lat: near.lat, lng: near.lng }; source = 'street' } }
  try {
    await prisma.geoPoint.upsert({
      where: { accountId_addressKey: { accountId, addressKey: key } },
      create: { accountId, addressKey: key, address, lat: point?.lat ?? null, lng: point?.lng ?? null, source: point ? source : 'none' },
      update: {},
    })
  } catch (err) {
    // The same address looked up twice at once: the other lookup saved it first; keep the first.
    if ((err as any)?.code !== 'P2002') throw err
    const first = await prisma.geoPoint.findUnique({ where: { accountId_addressKey: { accountId, addressKey: key } } })
    if (first) return first.lat != null && first.lng != null ? { lat: first.lat, lng: first.lng, source: first.source } : null
  }
  return point ? { ...point, source } : null
}

/** A position set by hand (the pin was dragged). Every appointment at that address follows. */
export async function pinAddress(accountId: string, address: string, point: Point): Promise<number> {
  const key = addressKey(address)
  await prisma.geoPoint.upsert({
    where: { accountId_addressKey: { accountId, addressKey: key } },
    create: { accountId, addressKey: key, address, lat: point.lat, lng: point.lng, source: 'manual' },
    update: { lat: point.lat, lng: point.lng, source: 'manual', address },
  })
  const same = await prisma.appointment.findMany({ where: { accountId, deletedAt: null, archivedAt: null }, select: { id: true, address: true } })
  const ids = same.filter(a => addressKey(a.address) === key).map(a => a.id)
  if (ids.length) await prisma.appointment.updateMany({ where: { id: { in: ids } }, data: { lat: point.lat, lng: point.lng } })
  return ids.length
}

/* ── Call back times said on the phone ───────────────────────────────────── */

/** A Florida wall clock time on a Florida date, as a moment. */
export function floridaTime(date: string, hhmm: string): Date {
  const guess = new Date(`${date}T${hhmm}:00Z`)
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: 'America/New_York' }) + ' UTC')
  return new Date(guess.getTime() + (guess.getTime() - shown.getTime()))
}

const floridaDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/**
 * The phone agent writes down a call back time in words ("tomorrow at 3 pm",
 * "Friday 10am", "2026-10-20 14:00"). Read it when it is clear; otherwise
 * null, and the call back waits under "Needs a date".
 */
export function parseCallbackTime(text: string | null | undefined, now: Date = new Date()): Date | null {
  const t = (text || '').trim().toLowerCase()
  if (!t) return null
  const iso = /(\d{4}-\d{2}-\d{2})[ t](\d{1,2}):(\d{2})/.exec(t)
  if (iso) {
    const d = floridaTime(iso[1], `${iso[2].padStart(2, '0')}:${iso[3]}`)
    return d.getTime() > now.getTime() - 3_600_000 ? d : null
  }
  const time = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/.exec(t)
  if (!time) return null
  let hour = Number(time[1]) % 12
  if (time[3].startsWith('p')) hour += 12
  const hhmm = `${String(hour).padStart(2, '0')}:${time[2] || '00'}`
  const today = floridaDay(now)
  const add = (days: number) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10) }
  let date: string | null = null
  if (/\btoday\b|\bthis (afternoon|morning|evening)\b/.test(t)) date = today
  else if (/\btomorrow\b/.test(t)) date = add(1)
  else {
    const wd = WEEKDAYS.findIndex(w => new RegExp(`\\b${w}\\b`).test(t))
    if (wd >= 0) {
      const todayWd = new Date(today + 'T12:00:00Z').getUTCDay()
      date = add(((wd - todayWd + 7) % 7) || 7)
    }
  }
  if (!date) return null
  const at = floridaTime(date, hhmm)
  return at.getTime() > now.getTime() - 3_600_000 ? at : null
}

/* ── What the browser gets ───────────────────────────────────────────────── */

export const contactSelect = { id: true, firstName: true, lastName: true, phone: true, email: true, serviceAddress: true, notes: true } as const

export function toClient(a: any) {
  return {
    ...a,
    startAt: a.startAt ? a.startAt.toISOString() : null,
    endAt: a.endAt ? a.endAt.toISOString() : null,
    startedAt: a.startedAt ? a.startedAt.toISOString() : null,
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    createdAt: a.createdAt?.toISOString?.() ?? a.createdAt,
    updatedAt: a.updatedAt?.toISOString?.() ?? a.updatedAt,
    customerName: a.contact ? `${a.contact.firstName || ''} ${a.contact.lastName && a.contact.lastName !== '-' ? a.contact.lastName : ''}`.trim() : '',
    customerPhone: a.contact?.phone || '',
    customerEmail: a.contact?.email || '',
    // The customer record's notes (what the office typed in Add lead: "wants 6 ft white vinyl, ~150 ft"), so the
    // Salesman reads them on her visit (audit Oct 26 2026: only the customer page had them).
    customerNotes: a.contact?.notes || '',
    contact: undefined,
  }
}
