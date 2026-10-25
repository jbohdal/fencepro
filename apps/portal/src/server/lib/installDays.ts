/**
 * Scheduling an install: the crew days it fills, the warnings before it is
 * booked, the rain day shift, and the customer's confirmation text. Pure (it
 * imports only the pure lib/locates.ts and lib/customerText.ts): the server (lib/installScheduling.ts) and the web app
 * (apps/web/src/ScheduleInstall.tsx) use this one file.
 *
 * Crew working days (CLAUDE.md, "Working days"): crews work Monday to
 * Thursday. Friday is a crew day only when Schedule > Settings ticks it.
 * Saturday and Sunday are never crew days, whatever Settings say, unless the
 * job itself is booked "weekends too" (allowWeekend), which makes every day a
 * crew day for that job. Dates are plain YYYY-MM-DD calendar days.
 */

import { locateOf, locateWarnings, locateWords, type LocateStatus } from './locates.js'
import { customerText } from './customerText.js'

export type Ymd = string

const DEFAULT_CREW_DAYS = [1, 2, 3, 4]

const parse = (day: Ymd) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)) }
const fmt = (d: Date) => d.toISOString().slice(0, 10)
export const isYmd = (s: unknown): s is Ymd => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(parse(s).getTime())
export const weekdayOf = (day: Ymd) => parse(day).getUTCDay()
export function plusDays(day: Ymd, n: number): Ymd { const d = parse(day); d.setUTCDate(d.getUTCDate() + n); return fmt(d) }

/**
 * The days of the week a crew works on this job. From Settings, Monday to
 * Friday only (Friday when ticked); every day when the job allows weekends.
 */
export function crewDaysOfWeek(settingsDays: number[] | null | undefined, allowWeekend = false): number[] {
  if (allowWeekend) return [0, 1, 2, 3, 4, 5, 6]
  const picked = [...new Set((settingsDays ?? []).filter(n => Number.isInteger(n) && n >= 1 && n <= 5))].sort()
  return picked.length ? picked : DEFAULT_CREW_DAYS.slice()
}

export const isCrewDay = (day: Ymd, days: number[]) => days.includes(weekdayOf(day))

/** The day itself when the crew works it, else the next day it does. */
export function nextCrewDay(day: Ymd, days: number[]): Ymd {
  let d = day
  for (let i = 0; i < 7 && !isCrewDay(d, days); i++) d = plusDays(d, 1)
  return d
}

/** `count` crew days after `day` (0: the day itself, moved onto a crew day). */
export function addCrewDays(day: Ymd, count: number, days: number[]): Ymd {
  let d = nextCrewDay(day, days)
  for (let left = Math.max(0, Math.floor(count)); left > 0;) { d = plusDays(d, 1); if (isCrewDay(d, days)) left-- }
  return d
}

/** The crew days a job of `count` days fills, starting `start` (or the next crew day after it). */
export function installDays(start: Ymd, count: number, days: number[]): Ymd[] {
  const n = Math.max(1, Math.min(60, Math.floor(count) || 1))
  const out: Ymd[] = [nextCrewDay(start, days)]
  while (out.length < n) out.push(addCrewDays(out[out.length - 1], 1, days))
  return out
}

/**
 * Whole crew days from the quote's crew time (crew hours / hours in a day).
 * A tenth of a day over is still the same day (1.04 days is 1 day): the
 * quote shows crew days to one decimal, and that is what is rounded up.
 */
export function wholeCrewDays(crewDays: number | null | undefined): number {
  const x = typeof crewDays === 'number' && Number.isFinite(crewDays) ? crewDays : 0
  if (x <= 0) return 0
  return Math.max(1, Math.ceil(Math.round(x * 10) / 10))
}

/** The rough rule a job made from a quote had: about 15 sections a crew day. */
export const daysForSections = (sections: number) => Math.max(1, Math.ceil(Math.max(0, sections || 0) / 15))

/* ── Rain day ───────────────────────────────────────────────────────────── */

/** The `n`th crew day strictly after `day` (a day off counts from itself: Friday off + 1 is Monday). */
function crewDaysAfter(day: Ymd, n: number, days: number[]): Ymd {
  let d = day
  for (let left = n; left > 0;) { d = plusDays(d, 1); if (isCrewDay(d, days)) left-- }
  return d
}

export interface BookedDay { id: string; jobKey: string; date: Ymd }

/**
 * A rain day on `from`: every booked crew day on or after it moves `shift`
 * crew days later (one by default), so the whole schedule from that day on
 * slides back. Days before it stay. Only a job booked "weekends too" (its key
 * in `weekendJobs`, ticked on purpose) moves over Saturday and Sunday; a day
 * left on a day off (Friday switched off) moves onto crew days like any other.
 */
export function rainDayMoves(booked: BookedDay[], from: Ymd, shift: number, settingsDays: number[] | null | undefined, weekendJobs: Set<string> = new Set()): Array<BookedDay & { to: Ymd }> {
  const base = crewDaysOfWeek(settingsDays)
  const n = Math.max(1, Math.min(10, Math.floor(shift) || 1))
  return booked
    .filter(b => b.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map(b => ({ ...b, to: crewDaysAfter(b.date, n, weekendJobs.has(b.jobKey) ? crewDaysOfWeek(null, true) : base) }))
}

/* ── Warnings before booking ────────────────────────────────────────────── */

export interface ReadyFacts {
  /** The job's Permit record status (lib/automations/permits.ts), or null when it has none. */
  permitStatus: string | null
  /** The 811 locate (lib/locates.ts): good to dig date, expiration date, ticket number, day called in. */
  locatesDate: Ymd | null
  locatesExpDate: Ymd | null
  locateTicket?: string | null
  locateCalledDate?: Ymd | null
  /** none: no payment schedule yet. */
  deposit: 'paid' | 'part' | 'unpaid' | 'none'
  materialsStatus: string
}

export const PERMIT_ISSUED = ['approved', 'inspection_scheduled', 'passed']

export interface ScheduleWarning { key: 'permit' | 'locates' | 'deposit' | 'materials'; text: string }

/** What is not ready for an install on `start` to `end` (it can still be booked). */
export function scheduleWarnings(f: ReadyFacts, start: Ymd, end: Ymd): ScheduleWarning[] {
  const out: ScheduleWarning[] = []
  if (f.permitStatus !== 'not_needed' && !PERMIT_ISSUED.includes(f.permitStatus ?? '')) {
    out.push({ key: 'permit', text: f.permitStatus ? `Permit not issued yet (${permitWords(f.permitStatus).toLowerCase()}).` : 'No permit on the job yet: mark it issued, or Not needed, on the job page.' })
  }
  // The 811 locate: no ticket, the install before the good to dig date, or the ticket running out before or within 3 days of it.
  out.push(...locateWarnings(locateOf(f), start, end))
  if (f.deposit === 'unpaid' || f.deposit === 'none') out.push({ key: 'deposit', text: f.deposit === 'none' ? 'No deposit recorded (no payment schedule on the job yet).' : 'Deposit not paid yet.' })
  else if (f.deposit === 'part') out.push({ key: 'deposit', text: 'Deposit only partly paid.' })
  if (!f.materialsStatus || f.materialsStatus === 'not_ordered') out.push({ key: 'materials', text: 'Materials not ordered yet.' })
  return out
}

export function permitWords(status: string | null | undefined): string {
  const w: Record<string, string> = { not_needed: 'Not needed', needed: 'Needed', applied: 'Applied', approved: 'Issued', inspection_scheduled: 'Issued, inspection scheduled', passed: 'Passed' }
  return status ? (w[status] ?? status) : 'Not set'
}

/** 811 in words, as of `day` (lib/locates.ts): missing (not called), waiting (called, not clear yet), ok (clear to dig), expired. */
export function locatesWords(f: Pick<ReadyFacts, 'locatesDate' | 'locatesExpDate' | 'locateTicket' | 'locateCalledDate'>, day: Ymd): { state: 'missing' | 'waiting' | 'ok' | 'expired'; status: LocateStatus; text: string } {
  const w = locateWords(locateOf(f), day)
  const state = w.status === 'not_called' ? 'missing' : w.status === 'called' ? 'waiting' : w.status === 'clear' ? 'ok' : 'expired'
  return { state, status: w.status, text: w.text }
}

/* ── The customer's text ────────────────────────────────────────────────── */

/** MM/DD/YYYY */
export function usDate(day: Ymd): string {
  if (!isYmd(day)) return day
  const [y, m, d] = day.split('-')
  return `${m}/${d}/${y}`
}

/** (352) 789 4314 */
export function phoneWords(raw: string | null | undefined): string {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : String(raw ?? '').trim()
}

/* ── Holidays ───────────────────────────────────────────────────────────── */

const pad2 = (n: number) => String(n).padStart(2, '0')
/** The nth weekday (0 Sunday) of a month, as YYYY-MM-DD. */
function nthWeekday(y: number, month: number, weekday: number, n: number): Ymd {
  const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay()
  return `${y}-${pad2(month)}-${pad2(1 + ((weekday - first + 7) % 7) + (n - 1) * 7)}`
}
function lastWeekday(y: number, month: number, weekday: number): Ymd {
  const last = new Date(Date.UTC(y, month, 0))
  last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7))
  return last.toISOString().slice(0, 10)
}

/** US federal holidays, plus Christmas Eve and New Year's Eve, on their own dates (no observed days). */
export function holidaysOf(year: number): Record<Ymd, string> {
  const d = (m: number, day: number) => `${year}-${pad2(m)}-${pad2(day)}`
  return {
    [d(1, 1)]: 'New Year’s Day',
    [nthWeekday(year, 1, 1, 3)]: 'Martin Luther King Jr. Day',
    [nthWeekday(year, 2, 1, 3)]: 'Presidents’ Day',
    [lastWeekday(year, 5, 1)]: 'Memorial Day',
    [d(6, 19)]: 'Juneteenth',
    [d(7, 4)]: 'Independence Day',
    [nthWeekday(year, 9, 1, 1)]: 'Labor Day',
    [nthWeekday(year, 10, 1, 2)]: 'Columbus Day',
    [d(11, 11)]: 'Veterans Day',
    [nthWeekday(year, 11, 4, 4)]: 'Thanksgiving',
    [d(12, 24)]: 'Christmas Eve',
    [d(12, 25)]: 'Christmas',
    [d(12, 31)]: 'New Year’s Eve',
  }
}

/** The holiday on a day, or null. */
export function holidayOn(day: Ymd): string | null {
  return isYmd(day) ? holidaysOf(Number(day.slice(0, 4)))[day] ?? null : null
}

/* ── Double booking ─────────────────────────────────────────────────────── */

export interface BoardEntry { id: string; stagingJobId?: string | null; clientName: string; crewId: string; date: Ymd; status?: string }

/** Other installs the same crew already has on these days (one per day and job). */
export function crewConflicts(entries: BoardEntry[], jobId: string, crewId: string, days: Ymd[]): Array<{ date: Ymd; clientName: string }> {
  const want = new Set(days)
  const seen = new Set<string>()
  const out: Array<{ date: Ymd; clientName: string }> = []
  for (const e of entries) {
    if (e.crewId !== crewId || !want.has(e.date) || (e.stagingJobId && e.stagingJobId === jobId)) continue
    if (e.status === 'Complete' || e.status === 'RolledOver' || e.status === 'Rolled Over') continue
    const k = `${e.date}|${e.stagingJobId || e.clientName}`
    if (seen.has(k)) continue
    seen.add(k)
    out.push({ date: e.date, clientName: e.clientName })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Days where one crew has two or more installs (different jobs) on the board.
 * Each: the day, the crew, the customers' names, and the entry ids involved.
 */
export function sameCrewClashes(entries: Array<{ id: string; jobKey: string; clientName: string; crewId: string; date: Ymd }>): Array<{ date: Ymd; crewId: string; names: string[]; ids: string[] }> {
  const by = new Map<string, Map<string, { name: string; ids: string[] }>>()
  for (const e of entries) {
    if (!e.crewId || !isYmd(e.date)) continue
    const k = `${e.date}|${e.crewId}`
    const jobs = by.get(k) ?? by.set(k, new Map()).get(k)!
    const j = jobs.get(e.jobKey) ?? jobs.set(e.jobKey, { name: e.clientName, ids: [] }).get(e.jobKey)!
    j.ids.push(e.id)
  }
  const out: Array<{ date: Ymd; crewId: string; names: string[]; ids: string[] }> = []
  for (const [k, jobs] of by) {
    if (jobs.size < 2) continue
    const [date, crewId] = k.split('|')
    out.push({ date, crewId, names: [...jobs.values()].map(j => j.name).sort(), ids: [...jobs.values()].flatMap(j => j.ids) })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.crewId.localeCompare(b.crewId))
}

/** "Daniel King and Rick Rocco", "A, B and C". */
export function namesWords(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/* ── Words ──────────────────────────────────────────────────────────────── */

const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** "Monday to Thursday", "Monday, Tuesday and Thursday", "every day". */
export function weekWords(days: number[]): string {
  const d = [...new Set(days)].sort()
  if (d.length === 7) return 'every day'
  if (d.length > 2 && d.every((x, i) => i === 0 || x === d[i - 1] + 1)) return `${DAY_LONG[d[0]]} to ${DAY_LONG[d[d.length - 1]]}`
  const names = d.map(x => DAY_LONG[x])
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** "Thu 12/3" */
export function shortDayWords(day: Ymd): string {
  return isYmd(day) ? `${DAY_LONG[weekdayOf(day)].slice(0, 3)} ${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}` : day
}

/** Jonathan's own cell: never in anything a customer sees. */
export const PERSONAL_CELL = '3525989785'
const digits10 = (raw: string | null | undefined) => { const d = String(raw ?? '').replace(/\D/g, ''); return d.length === 11 && d.startsWith('1') ? d.slice(1) : d }

/** The number the text gives: the rep's Direct phone, else the company phone; never the personal cell. */
export function customerPhoneToGive(repPhone: string | null | undefined, companyPhone: string | null | undefined): { phone: string; from: 'rep' | 'company' } {
  const rep = digits10(repPhone)
  if (rep.length === 10 && rep !== PERSONAL_CELL) return { phone: phoneWords(rep), from: 'rep' }
  const co = digits10(companyPhone)
  return { phone: co.length === 10 && co !== PERSONAL_CELL ? phoneWords(co) : '', from: 'company' }
}

/**
 * The schedule confirmation (scheduled) or the new date (moved: a reschedule
 * or a rain day). Starts with the company name, ends "Reply STOP to opt out."
 */
export function installText(kind: 'scheduled' | 'moved' | 'off', o: { company: string; firstName: string; start: Ymd; phone: string }): string {
  const name = (o.firstName || '').trim() || 'there'
  const when = usDate(o.start)
  const call = o.phone ? ` Questions? Call ${phoneWords(o.phone)}.` : ''
  // The company name in front and "Reply STOP to opt out." at the end, once each (lib/customerText.ts).
  if (kind === 'off') return customerText(`Hi ${name}, your fence installation date is being changed. We'll call you with a new date.${call}`, o.company)
  const what = kind === 'scheduled'
    ? `your fence installation is scheduled to start on ${when}.`
    : `your fence installation has moved and is now scheduled to start on ${when}.`
  return customerText(`Hi ${name}, ${what} Our crew will arrive in the morning.${call}`, o.company)
}
