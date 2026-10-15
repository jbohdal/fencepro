/**
 * Appointments: the rules, kept apart from the screens so they can be tested.
 *
 *   - types, statuses and outcomes, with their labels and colours
 *   - Settings for appointments, with defaults
 *   - Florida dates and times (the business clock, whatever the phone says)
 *   - the three best open slots for a person on a day
 *   - overlap warnings
 *   - what booking or closing out an appointment does to the pipeline card
 *   - confirmation texts, emails and calendar invites, sent by Jonathan himself
 *
 * The server repeats the type, status and outcome names in
 * apps/portal/src/server/lib/appointments.ts; a test checks they match.
 */

import { distanceMiles, type LatLng } from './geoUtils'

/* ── Names ───────────────────────────────────────────────────────────────── */

export const APPOINTMENT_TYPES = ['estimate', 'follow_up', 'contract_signing', 'install', 'service', 'warranty', 'call_back', 'other'] as const
export type AppointmentType = typeof APPOINTMENT_TYPES[number]
export const APPOINTMENT_STATUSES = ['scheduled', 'confirmed', 'on_my_way', 'rescheduled', 'completed', 'no_show', 'cancelled'] as const
export type AppointmentStatus = typeof APPOINTMENT_STATUSES[number]
export const APPOINTMENT_OUTCOMES = ['ready_to_quote', 'needs_follow_up', 'not_interested', 'no_show', 'imported'] as const
export type AppointmentOutcome = typeof APPOINTMENT_OUTCOMES[number]

export const TYPE_LABELS: Record<AppointmentType, string> = {
  estimate: 'Estimate / site visit', follow_up: 'Follow up visit', contract_signing: 'Contract signing', install: 'Install',
  service: 'Service / repair', warranty: 'Warranty', call_back: 'Phone call back', other: 'Other',
}
/** Short names for cards, chips and calendar titles. */
export const TYPE_SHORT: Record<AppointmentType, string> = {
  estimate: 'Estimate', follow_up: 'Follow up', contract_signing: 'Contract signing', install: 'Install',
  service: 'Service', warranty: 'Warranty', call_back: 'Call back', other: 'Appointment',
}
export const TYPE_COLORS: Record<AppointmentType, string> = {
  estimate: '#f97316', follow_up: '#eab308', contract_signing: '#22c55e', install: '#0ea5e9',
  service: '#a855f7', warranty: '#ec4899', call_back: '#64748b', other: '#94a3b8',
}
export const STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Scheduled', confirmed: 'Confirmed', on_my_way: 'On my way', rescheduled: 'Rescheduled',
  completed: 'Completed', no_show: 'No show', cancelled: 'Cancelled',
}
export const OUTCOME_LABELS: Record<AppointmentOutcome, string> = {
  ready_to_quote: 'Ready to quote', needs_follow_up: 'Needs follow up', not_interested: 'Not interested',
  no_show: 'No show', imported: 'Imported from Contractor Accelerator',
}

/** Still to happen (or happening). */
export const OPEN_STATUSES: AppointmentStatus[] = ['scheduled', 'confirmed', 'on_my_way', 'rescheduled']
export const isOpen = (a: { status: string }) => (OPEN_STATUSES as string[]).includes(a.status)

export interface HistoryEntry {
  at: string; by: string; kind: 'booked' | 'rescheduled' | 'status'
  from?: unknown; to?: unknown; reason?: string
}

export interface Appointment {
  id: string
  crmContactId: string
  quoteId: string | null
  jobId: string | null
  type: AppointmentType
  status: AppointmentStatus
  startAt: string | null
  endAt: string | null
  allDay: boolean
  address: string
  lat: number | null
  lng: number | null
  assignedTo: string
  notes: string
  outcome: AppointmentOutcome | null
  outcomeNotes: string
  measuredFeet: number | null
  nextStep: string
  history: HistoryEntry[]
  source: 'manual' | 'website_chat' | 'phone_agent' | 'import' | string
  version: number
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  customerName: string
  customerPhone: string
  customerEmail: string
}

/* ── Settings ────────────────────────────────────────────────────────────── */

export interface TeamMember { name: string; isDefault?: boolean }

export interface AppointmentSettings {
  team: TeamMember[]
  /** Minutes per type; 0 means all day. */
  durations: Record<AppointmentType, number>
  /** Days suggested slots may fall on, 0 = Sunday. */
  slotDays: number[]
  /** Suggested slots start no earlier and end no later than these (HH:MM, Florida). */
  slotStart: string
  slotEnd: string
  /** Average driving speed for drive time estimates. */
  driveMph: number
  /** Gap kept between appointments when there is no address to measure. */
  bufferMinutes: number
}

export const DEFAULT_APPOINTMENT_SETTINGS: AppointmentSettings = {
  team: [
    { name: 'Jonathan Bohdal', isDefault: true },
    { name: 'Alexander Bohdal' },
    { name: 'Stacy Mcgovern' },
    { name: 'Christopher Lindsey' },
  ],
  durations: { estimate: 60, follow_up: 30, contract_signing: 30, install: 0, service: 90, warranty: 60, call_back: 15, other: 60 },
  slotDays: [1, 2, 3, 4, 5, 6],
  slotStart: '07:00',
  slotEnd: '18:00',
  driveMph: 30,
  bufferMinutes: 15,
}

export function withDefaults(s: Partial<AppointmentSettings> | undefined | null): AppointmentSettings {
  const d = DEFAULT_APPOINTMENT_SETTINGS
  return {
    ...d, ...(s || {}),
    team: s?.team?.length ? s.team : d.team,
    durations: { ...d.durations, ...(s?.durations || {}) },
    slotDays: Array.isArray(s?.slotDays) ? s!.slotDays : d.slotDays,
  }
}

export const defaultPerson = (s: AppointmentSettings) => s.team.find(t => t.isDefault)?.name || s.team[0]?.name || ''

/* ── Florida time ────────────────────────────────────────────────────────── */

export const TIME_ZONE = 'America/New_York'
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

/** YYYY-MM-DD in Florida. */
export const floridaDate = (d: Date | string) => dayFmt.format(typeof d === 'string' ? new Date(d) : d)
/** HH:MM (24 hour) in Florida. */
export const floridaHM = (d: Date | string) => hmFmt.format(typeof d === 'string' ? new Date(d) : d)
export const minutesOf = (hm: string) => { const [h, m] = hm.split(':').map(Number); return h * 60 + (m || 0) }
export const hmOf = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** A Florida wall clock time on a Florida date, as a moment. */
export function floridaTime(date: string, hm: string): Date {
  const guess = new Date(`${date}T${hm}:00Z`)
  const shownHM = floridaHM(guess), shownDate = floridaDate(guess)
  const shown = new Date(`${shownDate}T${shownHM}:00Z`)
  return new Date(guess.getTime() + (guess.getTime() - shown.getTime()))
}

export const weekdayOf = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay()
export function addDays(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10)
}

/** "Tue 10:00 AM" (or "Tue" for all day). */
export function shortWhen(a: Pick<Appointment, 'startAt' | 'allDay'>): string {
  if (!a.startAt) return 'No date'
  const d = new Date(a.startAt)
  const day = d.toLocaleDateString('en-US', { timeZone: TIME_ZONE, weekday: 'short' })
  if (a.allDay) return `${day} ${d.toLocaleDateString('en-US', { timeZone: TIME_ZONE, month: 'short', day: 'numeric' })}`
  return `${day} ${d.toLocaleTimeString('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' })}`
}
/** "Tuesday, October 20 at 10:00 AM" */
export function longWhen(a: Pick<Appointment, 'startAt' | 'allDay'>): string {
  if (!a.startAt) return 'a time to be set'
  const d = new Date(a.startAt)
  const day = d.toLocaleDateString('en-US', { timeZone: TIME_ZONE, weekday: 'long', month: 'long', day: 'numeric' })
  return a.allDay ? day : `${day} at ${d.toLocaleTimeString('en-US', { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' })}`
}

/* ── Drive time and open slots ───────────────────────────────────────────── */

export function driveMinutes(a: LatLng | null | undefined, b: LatLng | null | undefined, s: AppointmentSettings): number {
  if (!a || !b) return s.bufferMinutes
  const miles = distanceMiles(a, b) * 1.25          // roads are not straight lines
  return Math.max(s.bufferMinutes, Math.round((miles / Math.max(5, s.driveMph)) * 60))
}

const point = (a: { lat: number | null; lng: number | null }): LatLng | null =>
  a.lat != null && a.lng != null ? { lat: a.lat, lng: a.lng } : null

export interface SlotSuggestion {
  startAt: string
  endAt: string
  /** Plain words: why this slot. */
  reason: string
}

/**
 * The best three open slots for `person` on `date`. A slot leaves room to
 * drive from the appointment before it and to the one after it; with an
 * address to go to, slots that add the least driving come first, otherwise
 * the earliest. Nothing is suggested on a day Settings leaves out.
 */
export function suggestSlots(opts: {
  date: string
  minutes: number
  person: string
  target: LatLng | null
  appointments: Array<Pick<Appointment, 'id' | 'startAt' | 'endAt' | 'allDay' | 'assignedTo' | 'status' | 'lat' | 'lng' | 'customerName' | 'address'>>
  settings: AppointmentSettings
  now?: Date
  ignoreId?: string
  count?: number
}): SlotSuggestion[] {
  const { date, person, target, settings: s } = opts
  const minutes = Math.max(15, opts.minutes || 60)
  if (!s.slotDays.includes(weekdayOf(date))) return []
  const now = opts.now ?? new Date()
  const dayStart = minutesOf(s.slotStart), dayEnd = minutesOf(s.slotEnd)
  const busy = opts.appointments
    .filter(a => a.id !== opts.ignoreId && a.assignedTo === person && isOpen(a) && a.startAt && !a.allDay && floridaDate(a.startAt) === date)
    .map(a => ({ a, start: minutesOf(floridaHM(a.startAt!)), end: a.endAt ? minutesOf(floridaHM(a.endAt)) : minutesOf(floridaHM(a.startAt!)) + 60, at: point(a) }))
    .sort((x, y) => x.start - y.start)

  const candidates: Array<SlotSuggestion & { score: number; start: number }> = []
  for (let start = dayStart; start + minutes <= dayEnd; start += 15) {
    const end = start + minutes
    const at = floridaTime(date, hmOf(start))
    if (at.getTime() < now.getTime() + 30 * 60_000) continue
    const before = [...busy].reverse().find(b => b.start < end && b.start <= start)
    const after = busy.find(b => b.start >= start && b !== before)
    if (busy.some(b => b.start < end && b.end > start)) continue
    const fromPrev = before ? driveMinutes(before.at, target, s) : 0
    const toNext = after ? driveMinutes(target, after.at, s) : 0
    if (before && start < before.end + fromPrev) continue
    if (after && end + toNext > after.start) continue
    let score: number, reason: string
    if (!busy.length) {
      score = start / 60                                    // a free day: earliest first
      reason = 'Open day'
    } else {
      const direct = before && after ? driveMinutes(before.at, after.at, s) : 0
      const detour = target ? fromPrev + toNext - direct : 0
      const gap = (before ? start - (before.end + fromPrev) : 0) + (after ? after.start - (end + toNext) : 0)
      score = detour * 2 + gap / 15 + (before || after ? 0 : 30)
      const near = before ?? after
      reason = near
        ? `${before ? 'After' : 'Before'} ${near.a.customerName || 'another appointment'}${target && near.at ? `, ${driveMinutes(near.at, target, s)} min drive` : ''}`
        : 'Open time'
    }
    if (start % 30) score += 0.1                          // on the hour or half hour, all else being equal
    candidates.push({ startAt: at.toISOString(), endAt: new Date(at.getTime() + minutes * 60_000).toISOString(), reason, score, start })
  }
  // The best ones, far enough apart that they do not overlap, so the three are real choices.
  const apart = Math.max(45, minutes)
  const picked: typeof candidates = []
  for (const c of [...candidates].sort((x, y) => x.score - y.score || x.start - y.start)) {
    if (picked.some(p => Math.abs(p.start - c.start) < apart)) continue
    picked.push(c)
    if (picked.length >= (opts.count ?? 3)) break
  }
  return picked.sort((x, y) => x.start - y.start).map(({ startAt, endAt, reason }) => ({ startAt, endAt, reason }))
}

/** Warnings for a time; they never stop a save. */
export function overlapWarnings(slot: { startAt: string; endAt: string; person: string; customerId: string; ignoreId?: string },
  appointments: Array<Pick<Appointment, 'id' | 'startAt' | 'endAt' | 'allDay' | 'assignedTo' | 'status' | 'customerName' | 'crmContactId'>>): string[] {
  const s = new Date(slot.startAt).getTime(), e = new Date(slot.endAt).getTime()
  const out: string[] = []
  for (const a of appointments) {
    if (a.id === slot.ignoreId || !isOpen(a) || !a.startAt) continue
    const as = new Date(a.startAt).getTime()
    const ae = a.endAt ? new Date(a.endAt).getTime() : as + 3_600_000
    const overlaps = a.allDay ? floridaDate(a.startAt) === floridaDate(slot.startAt) : as < e && ae > s
    if (!overlaps) continue
    const when = a.allDay ? 'all day' : `${floridaHM(a.startAt)}–${floridaHM(new Date(ae))}`
    if (a.assignedTo === slot.person) out.push(`${slot.person || 'This person'} is already booked: ${a.customerName || 'appointment'}, ${when}.`)
    else if (a.crmContactId === slot.customerId) out.push(`This customer already has an appointment then (${when}, with ${a.assignedTo || 'nobody assigned'}).`)
  }
  return out
}

/* ── Pipeline ────────────────────────────────────────────────────────────── */

/** Where booking moves the customer's card, or null to leave it. */
export function stageAfterBooking(currentStage: string | null | undefined, type: AppointmentType, stages: string[]): string | null {
  if (type !== 'estimate' || !currentStage) return null
  const at = stages.indexOf(currentStage), target = stages.indexOf('Appointment')
  return target >= 0 && at >= 0 && at < target ? 'Appointment' : null
}

/** What closing out an appointment does to the card: move it, offer a move, or nothing. */
export function stageAfterOutcome(currentStage: string | null | undefined, outcome: AppointmentOutcome, stages: string[]):
  { move?: string; offer?: string } {
  if (!currentStage) return {}
  if (outcome === 'ready_to_quote') {
    const at = stages.indexOf(currentStage), target = stages.indexOf('Estimating')
    return target >= 0 && at >= 0 && at < target ? { move: 'Estimating' } : {}
  }
  if (outcome === 'not_interested' && currentStage !== 'Lost Sale' && stages.includes('Lost Sale')) return { offer: 'Lost Sale' }
  return {}
}

/** The status an outcome closes an appointment with. */
export const statusForOutcome = (o: AppointmentOutcome): AppointmentStatus => (o === 'no_show' ? 'no_show' : 'completed')

/** Over, and nobody has said what happened. Imported history never counts. */
export function needsOutcome(a: Pick<Appointment, 'status' | 'startAt' | 'endAt' | 'allDay' | 'source'>, now: Date = new Date()): boolean {
  if (!isOpen(a) || !a.startAt || a.source === 'import') return false
  const end = a.endAt ? new Date(a.endAt) : new Date(new Date(a.startAt).getTime() + 3_600_000)
  if (a.allDay) return floridaDate(new Date(end.getTime() - 1)) < floridaDate(now)
  return end.getTime() < now.getTime()
}

/** The next appointment still to come for a customer. */
export function nextFor(customerId: string, list: Appointment[], now: Date = new Date()): Appointment | null {
  return list
    .filter(a => a.crmContactId === customerId && isOpen(a) && a.startAt && new Date(a.endAt || a.startAt).getTime() >= now.getTime())
    .sort((x, y) => x.startAt!.localeCompare(y.startAt!))[0] ?? null
}

/* ── Confirmations Jonathan sends himself ────────────────────────────────── */

const firstName = (full: string) => (full || '').trim().split(/\s+/)[0] || 'there'
const digits = (p: string) => (p || '').replace(/\D/g, '')

export function confirmationText(a: Pick<Appointment, 'customerName' | 'startAt' | 'allDay' | 'address' | 'type' | 'assignedTo'>, company: { name: string; phone: string }): string {
  const what = a.type === 'estimate' ? 'your fence estimate' : `your ${TYPE_SHORT[a.type as AppointmentType]?.toLowerCase() || 'appointment'}`
  return `Hi ${firstName(a.customerName)}, this is ${firstName(a.assignedTo) === 'there' ? 'the team' : firstName(a.assignedTo)} with ${company.name || 'Getter Done Fence'}. ` +
    `You're all set for ${what} on ${longWhen(a)}${a.address ? ` at ${a.address}` : ''}. ` +
    `If anything changes, call or text ${company.phone || 'us'}.`
}

export const smsLink = (phone: string, body: string) => `sms:${digits(phone)}?body=${encodeURIComponent(body)}`
export const mailtoLink = (email: string, subject: string, body: string) =>
  `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

export function onMyWayText(customerName: string, minutes: number, company: { name: string }, person = 'Jonathan'): string {
  return `Hi ${firstName(customerName)}, this is ${firstName(person)} with ${company.name || 'Getter Done Fence'}, I'm on my way and should be there in about ${Math.max(1, Math.round(minutes))} minutes.`
}

/** Directions from wherever the phone is. No key needed. */
export function directionsUrl(a: Pick<Appointment, 'address' | 'lat' | 'lng'>): string {
  const dest = a.address?.trim() || (a.lat != null ? `${a.lat},${a.lng}` : '')
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`
}

/** The whole day as one Google Maps route, from where the phone is, in time order. */
export function routeUrl(stops: Array<Pick<Appointment, 'address' | 'lat' | 'lng'>>): string {
  const parts = stops.map(s => encodeURIComponent(s.address?.trim() || `${s.lat},${s.lng}`))
  return `https://www.google.com/maps/dir//${parts.join('/')}`
}

const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** A calendar invite the customer can add with one tap. */
export function buildIcs(a: Pick<Appointment, 'id' | 'startAt' | 'endAt' | 'allDay' | 'address' | 'type'>, company: { name: string; phone: string }, now: Date = new Date()): string {
  const start = new Date(a.startAt!)
  const end = a.endAt ? new Date(a.endAt) : new Date(start.getTime() + 3_600_000)
  const when = a.allDay
    ? [`DTSTART;VALUE=DATE:${floridaDate(start).replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDays(floridaDate(new Date(end.getTime() - 1)), 1).replace(/-/g, '')}`]
    : [`DTSTART:${icsStamp(start)}`, `DTEND:${icsStamp(end)}`]
  const title = `${a.type === 'estimate' ? 'Fence estimate' : TYPE_SHORT[a.type as AppointmentType] || 'Appointment'} with ${company.name || 'Getter Done Fence'}`
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EZ Biz//Appointments//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${a.id}@ezbiz`, `DTSTAMP:${icsStamp(now)}`, ...when,
    `SUMMARY:${icsText(title)}`, `LOCATION:${icsText(a.address || '')}`,
    `DESCRIPTION:${icsText(`Questions or changes: ${company.phone || ''}`)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n')
}
