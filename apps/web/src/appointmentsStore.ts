/**
 * Appointments: in memory copy of /api/appointments.
 *
 * Loaded once after sign in with every other module and read again by
 * liveRefresh.ts with the other lists: only what changed since the last read
 * (?since=; the whole list is 0.8 MB). Bookings and changes go through the outbox:
 * shown at once, kept on the phone until the server confirms them, sent
 * again after no signal. A change the server refuses because the appointment
 * was changed on another device first is shown as "Couldn't save", and the
 * screen takes the server's copy; nothing is merged over someone else's change.
 */

import { isSignedIn, fetchWithAuth } from './crmAuth'
import { toast } from './toast'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import type { Appointment, AppointmentOutcome, AppointmentStatus, AppointmentType } from './appointmentLogic'
import { registerKind, enqueue, whenSaved, statusOf, reapply, pendingFor, type Op } from './outbox'
import { sendJson } from './syncHttp'
import { newId } from './recordSync'
import { getCustomerById } from './customerStore'
import { plainError, plainThrown } from './plainError'
import { untableBody, asTable } from './listTable'

const AUTH_API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '')
const URL_BASE = `${AUTH_API}/api/appointments`
export const APPOINTMENTS_UPDATED = 'fencepro:appointments:updated'

let cache: Appointment[] = []
let hydrated = false
let initPromise: Promise<void> | null = null

function emit() { try { window.dispatchEvent(new CustomEvent(APPOINTMENTS_UPDATED)) } catch { /* no window */ } }

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; status: number; data?: T; version?: number; error?: string; serverTime?: string; partial?: boolean }> {
  if (!isSignedIn()) return { ok: false, status: 401, error: 'Not signed in' }
  try {
    const res = await fetchWithAuth(`${URL_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = untableBody(await res.json().catch(() => ({})))
    return { ok: res.ok && json?.success !== false, status: res.status, data: json?.data, version: json?.version, error: res.ok ? undefined : plainError(res.status, json?.error).message, serverTime: typeof json?.serverTime === 'string' ? json.serverTime : undefined, partial: json?.partial === true }
  } catch (err) {
    return { ok: false, status: 0, error: plainThrown(err).message }
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
    const r = await call<Appointment[]>('GET', asTable(''))
    if (!r.ok || !Array.isArray(r.data)) return
    cache = r.data
    lastSync = r.serverTime ?? null
    hydrated = true
    reapply('appointment.')
    emit()
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

export const isAppointmentsHydrated = () => hydrated

/** When the list was last read (the server's clock): the next read asks only for what changed since. */
let lastSync: string | null = null

/** The list's order (the server's): by start, no start last, then as booked. */
const byStart = (a: Appointment, b: Appointment) => {
  const x = a.startAt ? Date.parse(a.startAt) : Infinity, y = b.startAt ? Date.parse(b.startAt) : Infinity
  return x !== y ? (x < y ? -1 : 1) : String((a as any).createdAt ?? '').localeCompare(String((b as any).createdAt ?? ''))
}

/**
 * Read the appointments again (another device may have changed them). Only
 * what changed since the last read comes back (a booking, a move, a cancel,
 * the customer's name), so it is small on cell data; the whole list only the
 * first time (audit #17: 0.8 MB each time before).
 */
export async function refreshAppointments(): Promise<void> {
  if (!hydrated || !lastSync) {
    const r = await call<Appointment[]>('GET', asTable(''))
    if (r.ok && Array.isArray(r.data)) { cache = r.data; hydrated = true; lastSync = r.serverTime ?? null; reapply('appointment.'); emit() }
    return
  }
  const r = await call<Array<Appointment & { archivedAt?: string | null; deletedAt?: string | null }>>('GET', asTable(`?since=${encodeURIComponent(lastSync)}`))
  if (!r.ok || !Array.isArray(r.data)) return
  if (!r.partial) { cache = r.data; lastSync = r.serverTime ?? null; reapply('appointment.'); emit(); return }
  if (r.serverTime) lastSync = r.serverTime
  if (!r.data.length) return
  const byId = new Map(cache.map(a => [a.id, a]))
  for (const row of r.data) {
    // Cancelled (archived) or deleted: off the list, as a whole read would leave them out.
    if (row.deletedAt || row.archivedAt) byId.delete(row.id)
    else byId.set(row.id, row)
  }
  cache = [...byId.values()].sort(byStart)
  reapply('appointment.')
  emit()
}

/**
 * Read one customer's appointments again (small): a card or page open on that customer sees a booking made
 * on another phone without a reload (round 3, Oct 26 2026: the Salesman's open card missed the office's booking).
 */
export async function refreshAppointmentsFor(customerId: string): Promise<void> {
  if (!customerId) return
  const r = await call<Appointment[]>('GET', asTable(`?contactId=${encodeURIComponent(customerId)}`))
  if (!r.ok || !Array.isArray(r.data)) return
  const fresh = r.data
  const before = JSON.stringify(cache.filter(a => a.crmContactId === customerId))
  if (before === JSON.stringify(fresh)) return
  cache = [...cache.filter(a => a.crmContactId !== customerId), ...fresh]
  reapply('appointment.')
  emit()
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
  /** The login from the booking team (bookingTeamStore.ts); the server keeps its name as assignedTo. */
  assignedToUserId?: string | null
  notes?: string
  quoteId?: string | null
  jobId?: string | null
  status?: AppointmentStatus
}

/** Shown before the server has it: "pending" while it waits for signal. */
export type ShownAppointment = Appointment & { pending?: boolean }
interface ApptCreate { input: NewAppointment & { id: string }; local: Appointment }
interface ApptChange { id: string; changes: AppointmentChanges; reason?: string; local: Appointment }

const apptKey = (id: string) => `appointment:${id}`
/** How long a booking waits for the server before saying it is kept on the phone. */
const CONFIRM_WAIT_MS = 10_000

/**
 * Bookings and changes the server turned down with a reason (outbox refusedWithReason: an install on a day the
 * crew does not work, a job that is gone). They are off the phone already; the reason waits here for the screen
 * that made the change (settle), keyed by appointment id.
 */
const refusals = new Map<string, string>()
/** Appointments a screen is waiting on right now (settle): a refusal for one of them is shown there, not as a toast. */
const settling = new Set<string>()

/** How a screen hears that the server turned its booking or change down, and why. Without it: a toast. */
export interface SaveOptions { onRefused?: (reason: string) => void }

function tellRefused(id: string, title: string, reason: string) {
  if (settling.has(id)) { refusals.set(id, reason); return }
  // Turned down after the screen stopped waiting (slow signal): said where it is seen.
  toast.error(title, reason)
}

function failedMessage(key: string): string | null {
  const st = statusOf([key])
  return st.status === 'failed' ? st.error ?? 'The server did not accept it.' : null
}

/**
 * Book. Shown at once and kept on this phone; resolves with the booking once
 * the server confirms it, or marked `pending` when there is no signal (it is
 * booked by itself later). Null only when the server refused it.
 */
export async function createAppointment(input: NewAppointment & { id?: string }, opts: SaveOptions = {}): Promise<ShownAppointment | null> {
  // The screen's own id when it has one (chosen when the dialog opened), so a second tap is the same booking.
  const id = input.id && input.id.length >= 8 ? input.id : newId()
  const c = getCustomerById(input.crmContactId)
  const now = new Date().toISOString()
  const local: Appointment = {
    id, crmContactId: input.crmContactId, quoteId: input.quoteId ?? null, jobId: input.jobId ?? null,
    type: input.type, status: input.status ?? 'scheduled', startAt: input.startAt, endAt: input.endAt, allDay: !!input.allDay,
    address: input.address ?? c?.serviceAddress ?? '', lat: input.lat ?? null, lng: input.lng ?? null,
    assignedTo: input.assignedTo ?? '', assignedToUserId: input.assignedToUserId ?? null, notes: input.notes ?? '', outcome: null, outcomeNotes: '', measuredFeet: null, nextStep: '',
    history: [], source: 'manual', version: 0, startedAt: null, completedAt: null, createdAt: now,
    customerName: c ? `${c.firstName} ${c.lastName}`.trim() : '', customerPhone: c?.phone ?? '', customerEmail: c?.email ?? '',
  }
  put(local)
  const waitFor = pendingFor(`customer:${input.crmContactId}`).some(o => o.kind === 'customer.create') ? [`customer:${input.crmContactId}`] : []
  settling.add(id)
  await enqueue<ApptCreate>({ key: apptKey(id), kind: 'appointment.create', payload: { input: { ...input, id }, local }, label: `${local.customerName || 'Appointment'}, ${input.type} booked`, after: waitFor })
  return settle(id, 'Appointment not booked', opts)
}

async function settle(id: string, refusedTitle: string, opts: SaveOptions): Promise<ShownAppointment | null> {
  settling.add(id)
  let done: boolean
  try { done = await whenSaved(apptKey(id), CONFIRM_WAIT_MS) } finally { settling.delete(id) }
  const refused = refusals.get(id)
  if (refused !== undefined) {
    refusals.delete(id)
    if (opts.onRefused) opts.onRefused(refused)
    else toast.error(refusedTitle, refused)
    return null
  }
  const failed = failedMessage(apptKey(id))
  if (failed) { toast.error('Appointment not saved', failed); return null }
  const a = getAppointment(id)
  return a ? { ...a, pending: !done } : null
}

export type AppointmentChanges = Partial<Pick<Appointment,
  'type' | 'status' | 'startAt' | 'endAt' | 'allDay' | 'address' | 'lat' | 'lng' | 'assignedTo' | 'assignedToUserId' | 'notes' |
  'outcomeNotes' | 'measuredFeet' | 'nextStep' | 'quoteId' | 'jobId' | 'startedAt'>> & { outcome?: AppointmentOutcome | null }

/**
 * Change an appointment. `reason` goes in its history when the time moves.
 * Shown at once and kept on this phone. Null when the server refused it
 * (changed on another device first: the screen then shows that change).
 */
export async function updateAppointment(id: string, changes: AppointmentChanges, reason?: string, opts: SaveOptions = {}): Promise<ShownAppointment | null> {
  const cur = getAppointment(id)
  if (!cur) return null
  const local: Appointment = { ...cur, ...changes } as Appointment
  // Another person: whose phone the texts give is the server's to say again (appointmentMessages.ts).
  const otherPerson = ('assignedToUserId' in changes && changes.assignedToUserId !== cur.assignedToUserId) || ('assignedTo' in changes && changes.assignedTo !== cur.assignedTo)
  if (otherPerson) { local.rep = undefined; if (!('assignedToUserId' in changes)) local.assignedToUserId = null }
  put(local)
  settling.add(id)
  await enqueue<ApptChange>({ key: apptKey(id), kind: 'appointment.update', payload: { id, changes, reason, local }, label: `${cur.customerName || 'Appointment'}, appointment changes`, coalesce: false })
  return settle(id, 'Appointment not changed', opts)
}

registerKind<ApptCreate>('appointment.create', {
  refused: () => { void refreshAppointments() },
  // Turned down with a reason (an install on a day the crew does not work): never booked, so off this phone's list.
  refusedWithReason: (op, reason) => {
    const id = op.payload.local.id
    if (cache.some(a => a.id === id)) { cache = cache.filter(a => a.id !== id); emit() }
    tellRefused(id, 'Appointment not booked', reason)
  },
  what: () => 'This appointment',
  send: op => sendJson('POST', '/api/appointments', op.payload.input).then(r => r.result),
  confirmed: (_op, data) => { if (data) put(data as Appointment) },
  apply: op => { if (!getAppointment(op.payload.local.id)) put(op.payload.local) },
})

registerKind<ApptChange>('appointment.update', {
  refused: () => { void refreshAppointments() },
  // Turned down with a reason (moved onto a day the crew does not work): the server's copy goes back on screen.
  refusedWithReason: (op, reason) => {
    void refreshAppointmentsFor(op.payload.local.crmContactId)
    tellRefused(op.payload.id, 'Appointment not changed', reason)
  },
  what: () => 'This change to the appointment',
  send: async (op: Op<ApptChange>) => {
    // Built on the copy the server last confirmed (earlier changes from this phone go first).
    const baseVersion = getAppointment(op.payload.id)?.version ?? op.payload.local.version
    const r = await sendJson('PATCH', `/api/appointments/${encodeURIComponent(op.payload.id)}`, { ...op.payload.changes, baseVersion, ...(op.payload.reason ? { reason: op.payload.reason } : {}) })
    // Changed on another device first: show theirs; this change is reported, not merged over it.
    if (r.status === 409 && r.json?.data) put(r.json.data as Appointment)
    return r.result
  },
  confirmed: (_op, data) => { if (data) put(data as Appointment) },
  apply: op => { const a = getAppointment(op.payload.id); if (a) put({ ...a, ...op.payload.changes } as Appointment) },
})

/**
 * What cancelling this install appointment does to its job, in words for the cancel confirmation
 * ("The job goes back to how it was before this booking: …", or that the job's schedule changed since and
 * stays). Empty when it changes no job, or with no signal (the server decides either way when it saves).
 */
export async function installCancelWords(id: string): Promise<string> {
  const r = await call<{ kind: string; words: string }>('GET', `/${encodeURIComponent(id)}/cancel-preview`)
  return r.ok && r.data?.kind !== 'none' ? r.data?.words ?? '' : ''
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

export interface AddressSuggestion { formatted: string; line1: string; city: string; state: string; zip: string; lat: number; lng: number; source: string }
/** Addresses for what has been typed: Marion County's property list on the Mac, then the Census lookup. */
export async function suggestAddresses(q: string): Promise<AddressSuggestion[]> {
  return (await lookupAddresses(q)) ?? []
}

/**
 * The same, but null when the lookup itself failed (no answer, refused, or
 * slower than `waitMs` on a weak signal), so the address box can say so.
 */
export async function lookupAddresses(q: string, waitMs = 8000): Promise<AddressSuggestion[] | null> {
  if (q.trim().length < 3) return []
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>(res => { timer = setTimeout(() => res(null), waitMs) })
  const r = await Promise.race([call<AddressSuggestion[]>('GET', `/geo/suggest?q=${encodeURIComponent(q.trim())}`), late]).finally(() => clearTimeout(timer))
  return r && r.ok && Array.isArray(r.data) ? r.data : null
}
