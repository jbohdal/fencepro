/**
 * Booking math: which times can one person really make on a day, and which
 * are best. Pure (no screen, no clock, no network), so it is tested with a
 * fake clock and fake drive times (apps/portal/tests/bookingPlanner.test.ts).
 *
 * For each start time, in 15 minute steps inside the work hours in Settings:
 *
 *   - where he will be before: the appointment that ends before it, or his
 *     home base when it is the first of the day
 *   - drive there, then the appointment (length by type), then a gap (the
 *     buffer in Settings) and the drive on to the next appointment
 *   - today: never earlier than now plus the drive, rounded up to 15 minutes
 *   - leaving home and finishing must both fall inside the work hours
 *
 * Ranking: least driving this booking adds, plus least dead time it leaves
 * (minutes waiting after the appointment before it and before the next one,
 * less the waiting already in a gap it fills), minute for minute. Ties go to
 * a time on the hour or half hour, then the earlier one. The first is "Best".
 *
 * Drive times: straight line distance between the two map points, times 1.25
 * for roads, at the average speed in Settings (30 mph by default). Free, no
 * key, no service to call; good to about 10 minutes on a 45 minute drive,
 * worse where a river or a missing bridge forces a long way round.
 */

import { distanceMiles, type LatLng } from './geoUtils'
import {
  floridaDate, floridaHM, floridaTime, minutesOf, hmOf, weekdayOf, addDays, isOpen,
  type Appointment, type AppointmentSettings,
} from './appointmentLogic'

/* ── Drive time ──────────────────────────────────────────────────────────── */

/** Minutes to drive from one point to another. */
export type DriveFn = (from: LatLng, to: LatLng) => number

/** Roads are not straight lines: straight line miles times this. */
export const ROAD_FACTOR = 1.25

export function estimateDriveMinutes(a: LatLng, b: LatLng, mph: number): number {
  return Math.round(((distanceMiles(a, b) * ROAD_FACTOR) / Math.max(5, mph || 30)) * 60)
}
export const estimator = (mph: number): DriveFn => (a, b) => estimateDriveMinutes(a, b, mph)

/* ── What the day looks like ─────────────────────────────────────────────── */

/** Something already on the person's day, in minutes after midnight (Florida). */
export interface Stop { id: string; name: string; start: number; end: number; at: LatLng | null }

export interface DayInput {
  /** YYYY-MM-DD, Florida. */
  date: string
  /** Length of the new appointment, minutes. */
  minutes: number
  /** Where the new appointment is; null when it is not on the map. */
  target: LatLng | null
  /** The person's timed appointments that day. */
  stops: Stop[]
  /** Where the person's day starts; null when no home base is set. */
  home: LatLng | null
  workStart: number
  workEnd: number
  /** Gap kept after each appointment before driving on. */
  buffer: number
  now: Date
  drive: DriveFn
}

const point = (a: { lat: number | null | undefined; lng: number | null | undefined }): LatLng | null =>
  a.lat != null && a.lng != null && Number.isFinite(a.lat) && Number.isFinite(a.lng) ? { lat: a.lat, lng: a.lng } : null

type ApptLike = Pick<Appointment, 'id' | 'startAt' | 'endAt' | 'allDay' | 'assignedTo' | 'status' | 'lat' | 'lng' | 'customerName'>

/** The person's open, timed appointments on a day, in order. */
export function stopsFor(appointments: ApptLike[], person: string, date: string, ignoreId?: string): Stop[] {
  return appointments
    .filter(a => a.id !== ignoreId && a.assignedTo === person && isOpen(a) && a.startAt && !a.allDay && floridaDate(a.startAt) === date)
    .map(a => {
      const start = minutesOf(floridaHM(a.startAt!))
      const end = a.endAt && floridaDate(a.endAt) === date ? minutesOf(floridaHM(a.endAt)) : start + 60
      return { id: a.id, name: a.customerName || 'another appointment', start, end: Math.max(end, start + 5), at: point(a) }
    })
    .sort((x, y) => x.start - y.start)
}

/** A team member's home base, when set and on the map. */
export function homeOf(settings: AppointmentSettings, person: string): LatLng | null {
  const m = settings.team.find(t => t.name === person)
  return m ? point({ lat: m.homeLat, lng: m.homeLng }) : null
}

/** Everything the planner needs for one person and one day, from the app's own data. */
export function dayInput(o: {
  date: string; minutes: number; target: LatLng | null; person: string
  appointments: ApptLike[]; settings: AppointmentSettings; now: Date; ignoreId?: string; drive?: DriveFn
}): DayInput {
  const s = o.settings
  return {
    date: o.date, minutes: Math.max(15, o.minutes || 60), target: o.target,
    stops: stopsFor(o.appointments, o.person, o.date, o.ignoreId), home: homeOf(s, o.person),
    workStart: minutesOf(s.slotStart), workEnd: minutesOf(s.slotEnd), buffer: Math.max(0, s.bufferMinutes ?? 15),
    now: o.now, drive: o.drive ?? estimator(s.driveMph),
  }
}

/* ── Words ───────────────────────────────────────────────────────────────── */

/** "1:00", "12:10" (the work day makes AM and PM plain). */
export function clock(min: number): string {
  const h = Math.floor(min / 60) % 24, m = ((min % 60) + 60) % 60
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`
}
/** "1:00 PM". */
export function clockAmPm(min: number): string {
  const h = Math.floor(min / 60) % 24
  return `${clock(min)} ${h < 12 ? 'AM' : 'PM'}`
}
/** "45 min", "2 hr", "1 hr 15 min" (to the nearest 5 minutes past a quarter hour). */
export function duration(min: number): string {
  const m = min >= 15 ? Math.round(min / 5) * 5 : Math.max(0, Math.round(min))
  if (m < 60) return `${m} min`
  return m % 60 ? `${Math.floor(m / 60)} hr ${m % 60} min` : `${m / 60} hr`
}
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name

/* ── One start time ──────────────────────────────────────────────────────── */

export interface Check {
  start: number
  end: number
  /** Fits: no clash, enough drive time both ways, inside work hours, not in the past. */
  ok: boolean
  /** Why not, in plain words; empty when ok. */
  problems: string[]
  /** A few words for a time button. */
  short: string
  /** The appointment before (null: he starts from home base, or nothing is known). */
  prev: Stop | null
  next: Stop | null
  fromHome: boolean
  /** Minutes; null when one end is not on the map. */
  driveIn: number | null
  driveOut: number | null
  /** When he sets off toward it. */
  leaveAt: number
  /** Waiting time after the appointment before it, and before the next one. */
  freeBefore: number
  freeAfter: number
  /** Driving this booking adds to the day. */
  addedDrive: number
  score: number
}

const ceil15 = (m: number) => Math.ceil(m / 15) * 15

/** Minutes after midnight in Florida for `now`, when `date` is today; -1 for a later day, Infinity for a past day. */
function nowOn(date: string, now: Date): number {
  const today = floridaDate(now)
  if (date < today) return Infinity
  if (date > today) return -1
  const [h, m] = floridaHM(now).split(':').map(Number)
  return h * 60 + m + (now.getUTCSeconds() > 0 || now.getUTCMilliseconds() > 0 ? 1 : 0)
}

export function checkStart(d: DayInput, start: number): Check {
  const L = Math.max(15, d.minutes)
  const end = start + L
  const problems: string[] = []
  const shorts: string[] = []
  const clash = d.stops.find(b => b.start < end && b.end > start)
  if (clash) { problems.push(`Clashes with ${clash.name} (${clock(clash.start)} to ${clock(clash.end)})`); shorts.push(`${firstName(clash.name)} ${clock(clash.start)}`) }

  const prev = [...d.stops].filter(b => b.end <= start).sort((x, y) => x.end - y.end).pop() ?? null
  const next = d.stops.filter(b => b.start >= end).sort((x, y) => x.start - y.start)[0] ?? null
  const origin = prev ? prev.at : d.home
  const fromHome = !prev && !!d.home
  const driveIn = origin && d.target ? d.drive(origin, d.target) : null
  const driveOut = next?.at && d.target ? d.drive(d.target, next.at) : null
  const dIn = driveIn ?? 0, dOut = driveOut ?? 0
  const leaveAt = start - dIn

  if (prev && !clash && start < prev.end + d.buffer + dIn) {
    problems.push(`Not enough time to get here from ${prev.name} (ends ${clock(prev.end)}; ${dIn ? `${dIn} min drive + ` : ''}${d.buffer} min gap)`)
    shorts.push(`from ${firstName(prev.name)}`)
  }
  if (next && !clash && end + d.buffer + dOut > next.start) {
    problems.push(`Not enough time to drive to ${next.name} (${dOut ? `${dOut} min drive + ` : ''}${d.buffer} min gap; they're at ${clock(next.start)})`)
    shorts.push(`to ${firstName(next.name)}`)
  }
  const nowMin = nowOn(d.date, d.now)
  if (nowMin === Infinity || start < nowMin) { problems.push('Already past'); shorts.push('past') }
  else if (nowMin >= 0 && start < ceil15(nowMin + dIn)) {
    problems.push(`Can't get there by then: it's ${clock(nowMin)} and the drive is ${dIn} min`)
    shorts.push('too soon')
  }
  if (start < d.workStart) { problems.push(`Before work hours (${clock(d.workStart)})`); shorts.push('before hours') }
  else if (!prev && fromHome && leaveAt < d.workStart) {
    problems.push(`You'd leave home at ${clock(leaveAt)}, before work hours (${clock(d.workStart)})`)
    shorts.push('leave too early')
  }
  if (end > d.workEnd) { problems.push(`Ends at ${clock(end)}, after work hours (${clock(d.workEnd)})`); shorts.push('after hours') }

  const freeBefore = prev ? Math.max(0, start - (prev.end + d.buffer + dIn)) : 0
  const freeAfter = next ? Math.max(0, next.start - (end + d.buffer + dOut)) : 0
  const direct = origin && next?.at ? d.drive(origin, next.at) : 0
  const addedDrive = d.target ? Math.max(0, dIn + (next ? dOut - direct : 0)) : 0
  // Dead time this booking leaves, less the dead time already in the gap it fills.
  const oldGap = prev && next ? Math.max(0, next.start - prev.end - d.buffer - (prev.at && next.at ? d.drive(prev.at, next.at) : 0)) : 0
  const score = addedDrive + freeBefore + freeAfter - oldGap + (start % 30 ? 1 : 0)
  return {
    start, end, ok: problems.length === 0, problems, short: shorts[0] ?? '', prev, next, fromHome,
    driveIn, driveOut, leaveAt, freeBefore, freeAfter, addedDrive, score,
  }
}

/** One line that explains an option, e.g. "Leave home 12:10 · 50 min drive · 1:00 to 2:00 · then 46 min to Ashley Rozicki (5:00) · 2 hr free before Ashley". */
export function explain(c: Check, d: Pick<DayInput, 'target'>): string {
  const parts: string[] = []
  if (c.prev) {
    parts.push(`After ${c.prev.name} (ends ${clock(c.prev.end)})`)
    if (c.driveIn != null) parts.push(`${c.driveIn} min drive`)
    if (c.freeBefore >= 15) parts.push(`${duration(c.freeBefore)} free first`)
  } else if (c.fromHome) {
    if (c.driveIn != null) parts.push(`Leave home ${clock(c.leaveAt)}`, `${c.driveIn} min drive`)
    else parts.push('From home')
  } else if (!d.target) {
    parts.push('Drive time unknown (address not on the map yet)')
  } else {
    parts.push('No home base set')
  }
  parts.push(`${clock(c.start)} to ${clock(c.end)}`)
  if (c.next) {
    parts.push(c.driveOut != null ? `then ${c.driveOut} min to ${c.next.name} (${clock(c.next.start)})` : `then ${c.next.name} (${clock(c.next.start)})`)
    const who = firstName(c.next.name)
    parts.push(c.freeAfter >= 15 ? `${duration(c.freeAfter)} free before ${who}` : c.freeAfter > 0 ? `${c.freeAfter} min to spare before ${who}` : `right on time for ${who}`)
  }
  return parts.join(' · ')
}

/* ── The best options for a day ──────────────────────────────────────────── */

export interface Option {
  /** HH:MM, Florida. */
  time: string
  startAt: string
  endAt: string
  start: number
  end: number
  best: boolean
  /** The one line explanation. */
  line: string
  check: Check
}

function toOption(d: DayInput, c: Check, best: boolean): Option {
  const at = floridaTime(d.date, hmOf(c.start))
  return { time: hmOf(c.start), startAt: at.toISOString(), endAt: new Date(at.getTime() + (c.end - c.start) * 60_000).toISOString(), start: c.start, end: c.end, best, line: explain(c, d), check: c }
}

/** Every start time in the work hours that fits, best first. */
export function fittingTimes(d: DayInput): Check[] {
  const out: Check[] = []
  for (let start = ceil15(d.workStart); start + Math.max(15, d.minutes) <= d.workEnd; start += 15) {
    const c = checkStart(d, start)
    if (c.ok) out.push(c)
  }
  return out.sort((x, y) => x.score - y.score || x.start - y.start)
}

/**
 * The best `count` options, best first, far enough apart (the length of the
 * appointment, at least 45 minutes) that each is a real choice; in a narrow
 * window, half an hour apart.
 */
export function bestTimes(d: DayInput, count = 3): Option[] {
  const fits = fittingTimes(d)
  const picked: Check[] = []
  for (const apart of [Math.max(45, d.minutes), 30]) {
    for (const c of fits) {
      if (picked.length >= count) break
      if (picked.some(p => p === c || Math.abs(p.start - c.start) < apart)) continue
      picked.push(c)
    }
  }
  picked.sort((x, y) => x.score - y.score || x.start - y.start)
  return picked.map((c, i) => toOption(d, c, i === 0))
}

/* ── The time grid ───────────────────────────────────────────────────────── */

export interface GridCell { time: string; start: number; ok: boolean; short: string; reason: string }

/** Every 15 minutes inside the work hours, each marked whether it fits, and why not. */
export function timeGrid(d: DayInput): GridCell[] {
  const out: GridCell[] = []
  for (let start = ceil15(d.workStart); start < d.workEnd; start += 15) {
    const c = checkStart(d, start)
    out.push({ time: hmOf(start), start, ok: c.ok, short: c.short, reason: c.problems.join('; ') })
  }
  return out
}

/** Warnings for a time picked or typed by hand (booking is still allowed). */
export function warningsFor(d: DayInput, hm: string): string[] {
  if (!/^\d{1,2}:\d{2}$/.test(hm)) return []
  return checkStart(d, minutesOf(hm)).problems
}

/**
 * A time typed by hand: "2", "2:30", "230p", "2:30 pm", "14:30". A bare hour
 * with no AM or PM is read inside a work day: 7 to 11 morning, 12 to 6 afternoon.
 */
export function parseTypedTime(text: string): string | null {
  const t = (text || '').trim().toLowerCase().replace(/\./g, '')
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(a|am|p|pm)?$/.exec(t)
  if (!m) return null
  let h = Number(m[1]); const min = Number(m[2] || 0)
  if (min > 59 || h > 23) return null
  if (m[3]) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (m[3].startsWith('p') ? 12 : 0)
  } else if (h >= 1 && h <= 6) h += 12
  return hmOf(h * 60 + min)
}

/* ── The day timeline ────────────────────────────────────────────────────── */

export interface Segment { kind: 'appointment' | 'new' | 'drive'; start: number; end: number; label: string; id?: string }

/**
 * The person's day as blocks: each appointment with its real time, the new
 * one when a time is picked, and the drives between them (a drive starts as
 * the appointment before it ends; the first drive of the day ends on arrival).
 */
export function timeline(d: DayInput, startHm: string | null): Segment[] {
  type B = { kind: 'appointment' | 'new'; start: number; end: number; at: LatLng | null; label: string; id?: string }
  const blocks: B[] = d.stops.map(s => ({ kind: 'appointment', start: s.start, end: s.end, at: s.at, label: `${clock(s.start)} ${s.name}`, id: s.id }))
  if (startHm && /^\d{1,2}:\d{2}$/.test(startHm)) {
    const s = minutesOf(startHm)
    blocks.push({ kind: 'new', start: s, end: s + Math.max(15, d.minutes), at: d.target, label: `${clock(s)} this one` })
  }
  blocks.sort((x, y) => x.start - y.start)
  const out: Segment[] = []
  blocks.forEach((b, i) => {
    const before = blocks[i - 1]
    if (!before) {
      if (d.home && b.at) { const m = d.drive(d.home, b.at); if (m > 0) out.push({ kind: 'drive', start: b.start - m, end: b.start, label: `${m} min from home` }) }
    } else if (before.at && b.at && before.end <= b.start) {
      const m = d.drive(before.at, b.at)
      if (m > 0) out.push({ kind: 'drive', start: before.end, end: before.end + m, label: `${m} min drive` })
    }
    out.push({ kind: b.kind, start: b.start, end: b.end, label: b.label, id: b.id })
  })
  return out
}

/* ── Other days nearby ───────────────────────────────────────────────────── */

export interface NearbyJob { id: string; customerName: string; lat?: number | null; lng?: number | null; scheduledDate?: string | null; scheduledEndDate?: string | null; status?: string }

export interface OtherDay {
  date: string
  time: string
  startAt: string
  /** "Tue 10:00 · 8 min from Smith job" */
  line: string
  driveMinutes: number
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DONE_JOB = new Set(['completed', 'paid', 'cancelled', 'on_hold'])

/**
 * Other days this week (Monday to Sunday of the picked day, today on) when the
 * person is already within `near` minutes of this address, at an appointment
 * or a scheduled job: the best time that day, next to it where possible.
 */
export function otherDays(o: {
  date: string; minutes: number; target: LatLng | null; person: string
  appointments: ApptLike[]; jobs: NearbyJob[]; settings: AppointmentSettings; now: Date
  ignoreId?: string; drive?: DriveFn; near?: number; count?: number
}): OtherDay[] {
  if (!o.target) return []
  const near = o.near ?? 15
  const drive = o.drive ?? estimator(o.settings.driveMph)
  const today = floridaDate(o.now)
  const monday = addDays(o.date, -((weekdayOf(o.date) + 6) % 7))
  const out: OtherDay[] = []
  for (let i = 0; i < 7; i++) {
    const day = addDays(monday, i)
    if (day === o.date || day < today || !o.settings.slotDays.includes(weekdayOf(day))) continue
    const d = dayInput({ ...o, date: day, drive })
    const anchors: Array<{ name: string; minutes: number; stopId?: string }> = []
    for (const s of d.stops) if (s.at) { const m = drive(s.at, o.target); if (m <= near) anchors.push({ name: s.name, minutes: m, stopId: s.id }) }
    for (const j of o.jobs) {
      const at = point({ lat: j.lat, lng: j.lng })
      if (!at || !j.scheduledDate || DONE_JOB.has(j.status || '')) continue
      if (!(j.scheduledDate <= day && day <= (j.scheduledEndDate || j.scheduledDate))) continue
      const m = drive(at, o.target)
      if (m <= near) anchors.push({ name: `${j.customerName || 'a'} job`, minutes: m })
    }
    if (!anchors.length) continue
    anchors.sort((x, y) => x.minutes - y.minutes)
    const fits = fittingTimes(d)
    if (!fits.length) continue
    const a = anchors[0]
    const pick = (a.stopId && fits.find(c => c.prev?.id === a.stopId || c.next?.id === a.stopId)) || fits[0]
    const at = floridaTime(day, hmOf(pick.start))
    out.push({ date: day, time: hmOf(pick.start), startAt: at.toISOString(), driveMinutes: a.minutes, line: `${WEEKDAY[weekdayOf(day)]} ${clock(pick.start)} · ${Math.max(1, a.minutes)} min from ${a.name}` })
  }
  return out.sort((x, y) => x.driveMinutes - y.driveMinutes || x.date.localeCompare(y.date)).slice(0, o.count ?? 3)
}

/* ── Addresses ───────────────────────────────────────────────────────────── */

const STREET_WORDS: Record<string, string> = {
  NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W',
  STREET: 'ST', ROAD: 'RD', AVENUE: 'AVE', AV: 'AVE', COURT: 'CT', CIRCLE: 'CIR', PLACE: 'PL', TERRACE: 'TER', TERR: 'TER',
  TRAIL: 'TRL', DRIVE: 'DR', LANE: 'LN', HIGHWAY: 'HWY', BOULEVARD: 'BLVD', TRACE: 'TRCE', PARKWAY: 'PKWY', POINT: 'PT',
  COVE: 'CV', CROSSING: 'XING', SQUARE: 'SQ',
}
const DIRS = new Set(['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'])
const SUFFIXES = new Set(['ST', 'RD', 'AVE', 'CT', 'CIR', 'PL', 'TER', 'TRL', 'DR', 'LN', 'HWY', 'BLVD', 'TRCE', 'PKWY', 'PT', 'CV', 'XING', 'SQ', 'WAY', 'RUN', 'LOOP', 'PASS'])

/** House number, street name and street type words: "10976 SW 139th Court Rd, Dunnellon" -> 10976 / 139 / CT RD. */
export function streetParts(address: string): { number: string; name: string; types: string } | null {
  const words = (address || '').split(',')[0].toUpperCase().replace(/[.#]/g, ' ').split(/\s+/).filter(Boolean)
    .map(w => STREET_WORDS[w] ?? w).map(w => w.replace(/^(\d+)(ST|ND|RD|TH)$/, '$1'))
  if (words.length < 2 || !/^\d+[A-Z]?$/.test(words[0])) return null
  const rest = words.slice(1).filter(w => !DIRS.has(w))
  if (!rest.length) return null
  const name = rest[0]
  const types = rest.slice(1).filter(w => SUFFIXES.has(w)).join(' ')
  return { number: words[0], name, types }
}

/**
 * Two addresses with the same house number on different streets ("SW 139th
 * Court Rd" and "SW 136th Ct"): one of them is wrong, and the pin should wait.
 */
export function differentStreets(a: string, b: string): boolean {
  const x = streetParts(a), y = streetParts(b)
  if (!x || !y || x.number !== y.number) return false
  if (x.name !== y.name) return true
  return !!x.types && !!y.types && x.types !== y.types
}
