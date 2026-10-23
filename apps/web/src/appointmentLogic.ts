/**
 * Appointments: the rules, kept apart from the screens so they can be tested.
 *
 *   - types, statuses and outcomes, with their labels and colours
 *   - Settings for appointments, with defaults
 *   - Florida dates and times (the business clock, whatever the phone says)
 *   - drive time between two points (the booking math is in bookingPlanner.ts)
 *   - overlap warnings
 *   - what booking or closing out an appointment does to the pipeline card
 *   - confirmation texts, emails and calendar invites, sent by Jonathan himself
 *
 * The server repeats the type, status and outcome names in
 * apps/portal/src/server/lib/appointments.ts; a test checks they match.
 */

import { stageAfterBooking as modelStageAfterBooking, stageAfterOutcome as modelStageAfterOutcome, type PipelineStageDef } from './pipelineStageModel'
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
  /** The login assignedTo was matched to when saved (server, lib/appointmentRep.ts). */
  assignedToUserId?: string | null
  /** That login, with its Direct phone: {rep_phone} in the texts (appointmentMessages.ts). Null: no login matched; missing: not from the server yet. */
  rep?: { userId: string; firstName: string; lastName: string; phone: string | null } | null
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

export interface TeamMember {
  name: string
  isDefault?: boolean
  /** Where this person's day starts (typed in Settings); the first appointment of a day is figured from here. */
  homeBase?: string
  homeLat?: number | null
  homeLng?: number | null
}

export interface AppointmentSettings {
  team: TeamMember[]
  /** Minutes per type; 0 means all day. */
  durations: Record<AppointmentType, number>
  /** Days suggested slots may fall on, 0 = Sunday. */
  slotDays: number[]
  /** Work hours for appointments: booking options start no earlier and end no later than these (HH:MM, Florida). */
  slotStart: string
  slotEnd: string
  /** Average driving speed for drive time estimates. */
  driveMph: number
  /** Gap kept after each appointment before driving on to the next. */
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

/* ── Drive time ──────────────────────────────────────────────────────────── */

export function driveMinutes(a: LatLng | null | undefined, b: LatLng | null | undefined, s: AppointmentSettings): number {
  if (!a || !b) return s.bufferMinutes
  const miles = distanceMiles(a, b) * 1.25          // roads are not straight lines
  return Math.max(s.bufferMinutes, Math.round((miles / Math.max(5, s.driveMph)) * 60))
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

/** Where booking moves the customer's card (the Appointment stage, when the card is before it), or null to leave it. By role, from Settings > Pipeline Stages. */
export function stageAfterBooking(currentStage: string | null | undefined, type: AppointmentType, stages: PipelineStageDef[]): string | null {
  return modelStageAfterBooking(stages, currentStage, type)
}

/** What closing out an appointment does to the card: Ready to quote moves it to the Ready to quote stage, Not interested offers the Lost stage. */
export function stageAfterOutcome(currentStage: string | null | undefined, outcome: AppointmentOutcome, stages: PipelineStageDef[]):
  { move?: string; offer?: string } {
  return modelStageAfterOutcome(stages, currentStage, outcome)
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
// The words are templates (Settings > Messages): appointmentMessages.ts.

const digits = (p: string) => (p || '').replace(/\D/g, '')

export const smsLink = (phone: string, body: string) => `sms:${digits(phone)}?body=${encodeURIComponent(body)}`
export const mailtoLink = (email: string, subject: string, body: string) =>
  `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

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

/** A calendar invite the customer can add with one tap. `description`: the filled template (appointmentMessages.ts icsDescription). */
export function buildIcs(a: Pick<Appointment, 'id' | 'startAt' | 'endAt' | 'allDay' | 'address' | 'type'>, company: { name: string; phone: string }, description: string, now: Date = new Date()): string {
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
    `DESCRIPTION:${icsText(description)}`,
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n')
}
