/**
 * Scheduling an install: the crew days it fills, the warnings before it is
 * booked, the rain day shift, and the customer's confirmation text. Pure, no
 * imports: the server (lib/installScheduling.ts) and the web app
 * (apps/web/src/ScheduleInstall.tsx) use this one file.
 *
 * Crew working days (CLAUDE.md, "Working days"): crews work Monday to
 * Thursday. Friday is a crew day only when Schedule > Settings ticks it.
 * Saturday and Sunday are never crew days, whatever Settings say, unless the
 * job itself is booked "weekends too" (allowWeekend), which makes every day a
 * crew day for that job. Dates are plain YYYY-MM-DD calendar days.
 */

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

export interface BookedDay { id: string; jobKey: string; date: Ymd }

/**
 * A rain day on `from`: every booked crew day on or after it moves `shift`
 * crew days later (one by default), so the whole schedule from that day on
 * slides back. Days before it stay. A job booked "weekends too" (one of its
 * days is not a crew day) moves over every day.
 */
export function rainDayMoves(booked: BookedDay[], from: Ymd, shift: number, settingsDays: number[] | null | undefined): Array<BookedDay & { to: Ymd }> {
  const base = crewDaysOfWeek(settingsDays)
  const weekendJobs = new Set(booked.filter(b => !isCrewDay(b.date, base)).map(b => b.jobKey))
  const n = Math.max(1, Math.min(10, Math.floor(shift) || 1))
  return booked
    .filter(b => b.date >= from)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map(b => ({ ...b, to: addCrewDays(b.date, n, weekendJobs.has(b.jobKey) ? crewDaysOfWeek(null, true) : base) }))
}

/* ── Warnings before booking ────────────────────────────────────────────── */

export interface ReadyFacts {
  /** The job's Permit record status (lib/automations/permits.ts), or null when it has none. */
  permitStatus: string | null
  /** The 811 locate ticket: when it was called in / good from, and when it runs out. */
  locatesDate: Ymd | null
  locatesExpDate: Ymd | null
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
  if (!f.locatesDate && !f.locatesExpDate) out.push({ key: 'locates', text: 'No 811 locate ticket on the job.' })
  else if (f.locatesExpDate && f.locatesExpDate < start) out.push({ key: 'locates', text: `The 811 ticket ran out on ${usDate(f.locatesExpDate)}, before the install starts.` })
  else if (f.locatesExpDate && f.locatesExpDate < end) out.push({ key: 'locates', text: `The 811 ticket runs out on ${usDate(f.locatesExpDate)}, before the last crew day (${usDate(end)}).` })
  if (f.deposit === 'unpaid' || f.deposit === 'none') out.push({ key: 'deposit', text: f.deposit === 'none' ? 'No deposit recorded (no payment schedule on the job yet).' : 'Deposit not paid yet.' })
  else if (f.deposit === 'part') out.push({ key: 'deposit', text: 'Deposit only partly paid.' })
  if (!f.materialsStatus || f.materialsStatus === 'not_ordered') out.push({ key: 'materials', text: 'Materials not ordered yet.' })
  return out
}

export function permitWords(status: string | null | undefined): string {
  const w: Record<string, string> = { not_needed: 'Not needed', needed: 'Needed', applied: 'Applied', approved: 'Issued', inspection_scheduled: 'Issued, inspection scheduled', passed: 'Passed' }
  return status ? (w[status] ?? status) : 'Not set'
}

/** 811 in words, as of `day`. */
export function locatesWords(f: Pick<ReadyFacts, 'locatesDate' | 'locatesExpDate'>, day: Ymd): { state: 'missing' | 'ok' | 'expired'; text: string } {
  if (!f.locatesDate && !f.locatesExpDate) return { state: 'missing', text: 'No ticket' }
  if (f.locatesExpDate && f.locatesExpDate < day) return { state: 'expired', text: `Expired ${usDate(f.locatesExpDate)}` }
  return { state: 'ok', text: f.locatesExpDate ? `Good to ${usDate(f.locatesExpDate)}` : `Called ${usDate(f.locatesDate!)}` }
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
export function installText(kind: 'scheduled' | 'moved', o: { company: string; firstName: string; start: Ymd; phone: string }): string {
  const name = (o.firstName || '').trim() || 'there'
  const when = usDate(o.start)
  const call = o.phone ? ` Questions? Call ${o.phone}.` : ''
  const what = kind === 'scheduled'
    ? `your fence installation is scheduled to start on ${when}.`
    : `your fence installation has moved and is now scheduled to start on ${when}.`
  return `${(o.company || 'Getter Done Fence').trim()}: Hi ${name}, ${what} Our crew will arrive in the morning.${call} Reply STOP to opt out.`
}
