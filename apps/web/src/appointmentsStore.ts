/**
 * Appointments: in memory copy of /api/appointments.
 *
 * Loaded once after sign in with every other module, read again when the
 * window comes back into focus, and changed only through the server: every
 * save sends the version it started from, and one built on an older copy is
 * refused. The refused copy is replaced by the server's and the screen says
 * so; nothing is merged over someone else's change.
 */

import { getAccessToken, fetchWithAuth } from './crmAuth'
import { toast } from './toast'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import type { Appointment, AppointmentOutcome, AppointmentStatus, AppointmentType } from './appointmentLogic'

const AUTH_API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '')
const URL_BASE = `${AUTH_API}/api/appointments`
export const APPOINTMENTS_UPDATED = 'fencepro:appointments:updated'

let cache: Appointment[] = []
let hydrated = false
let initPromise: Promise<void> | null = null

function emit() { try { window.dispatchEvent(new CustomEvent(APPOINTMENTS_UPDATED)) } catch { /* no window */ } }

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data?: T; version?: number; error?: string }> {
  if (!getAccessToken()) return { ok: false, status: 401, error: 'Not signed in' }
  try {
    const res = await fetchWithAuth(`${URL_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    return { ok: res.ok && json?.success !== false, status: res.status, data: json?.data, version: json?.version, error: json?.error }
  } catch (err) {
    return { ok: false, status: 0, error: (err as Error)?.message || 'Network error' }
  }
}

function put(a: Appointment) {
  const i = cache.findIndex(x => x.id === a.id)
  cache = i >= 0 ? cache.map(x => (x.id === a.id ? a : x)) : [...cache, a]
  emit()
}

export function initAppointments(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    const r = await call<Appointment[]>('GET', '')
    if (!r.ok || !Array.isArray(r.data)) return
    cache = r.data
    hydrated = true
    emit()
    window.addEventListener('focus', () => { refreshAppointments().catch(() => {}) })
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

export const isAppointmentsHydrated = () => hydrated

/** Read every appointment again (another device may have changed them). */
export async function refreshAppointments(): Promise<void> {
  const r = await call<Appointment[]>('GET', '')
  if (r.ok && Array.isArray(r.data)) { cache = r.data; hydrated = true; emit() }
}

export const getAppointments = (): Appointment[] => cache
export const getAppointment = (id: string) => cache.find(a => a.id === id) ?? null
export const appointmentsFor = (customerId: string) => cache.filter(a => a.crmContactId === customerId)

export interface NewAppointment {
  crmContactId: string
  type: AppointmentType
  startAt: string | null
  endAt: string | null
  allDay?: boolean
  address?: string
  lat?: number | null
  lng?: number | null
  assignedTo?: string
  notes?: string
  quoteId?: string | null
  jobId?: string | null
  status?: AppointmentStatus
}

export async function createAppointment(input: NewAppointment): Promise<Appointment | null> {
  let r = await call<Appointment>('POST', '', input)
  // A customer added a moment ago may still be on its way to the server.
  if (r.status === 400 && /not in this company/.test(r.error || '')) {
    await new Promise(res => setTimeout(res, 2000))
    r = await call<Appointment>('POST', '', input)
  }
  if (!r.ok || !r.data) { toast.error('Appointment not saved', r.error || 'The server did not accept it.'); return null }
  put(r.data)
  return r.data
}

export type AppointmentChanges = Partial<Pick<Appointment,
  'type' | 'status' | 'startAt' | 'endAt' | 'allDay' | 'address' | 'lat' | 'lng' | 'assignedTo' | 'notes' |
  'outcomeNotes' | 'measuredFeet' | 'nextStep' | 'quoteId' | 'jobId' | 'startedAt'>> & { outcome?: AppointmentOutcome | null }

/**
 * Change an appointment. `reason` goes in its history when the time moves.
 * Null when the save did not happen; if another device changed it first, the
 * copy here is replaced with theirs and the caller can try again.
 */
export async function updateAppointment(id: string, changes: AppointmentChanges, reason?: string): Promise<Appointment | null> {
  const cur = getAppointment(id)
  if (!cur) return null
  const r = await call<Appointment>('PATCH', `/${encodeURIComponent(id)}`, { ...changes, baseVersion: cur.version, ...(reason ? { reason } : {}) })
  if (r.status === 409 && r.data) {
    put(r.data)
    toast.error('Changed on another device', 'This appointment was changed somewhere else first. It now shows that change; make yours again if it still applies.')
    return null
  }
  if (!r.ok || !r.data) { toast.error('Appointment not saved', r.error || 'The server did not accept it.'); return null }
  put(r.data)
  return r.data
}

/** Where an address is on the map (looked up once, then kept). */
export async function lookupPosition(address: string): Promise<{ lat: number; lng: number; source: string } | null> {
  if (!address.trim()) return null
  const r = await call<{ lat: number; lng: number; source: string } | null>('GET', `/geo/lookup?address=${encodeURIComponent(address)}`)
  return r.ok ? r.data ?? null : null
}

/** A position set by dragging the pin. Every appointment at that address moves with it. */
export async function pinPosition(address: string, lat: number, lng: number): Promise<boolean> {
  const r = await call<{ appointmentsMoved: number }>('POST', '/geo/pin', { address, lat, lng })
  if (!r.ok) { toast.error('Position not saved', r.error || ''); return false }
  cache = cache.map(a => (a.address.trim().toLowerCase() === address.trim().toLowerCase() ? { ...a, lat, lng } : a))
  emit()
  return true
}
