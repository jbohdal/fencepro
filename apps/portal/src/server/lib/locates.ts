/**
 * The 811 locate (Sunshine 811 utility marking ticket) of a job: one record,
 * kept on the job (SavedJob.locateTicket, locateCalledDate, locatesDate = good
 * to dig, locatesExpDate = expires). Edited on the job page and on the crew
 * packet; both write the same fields (routes/saved-jobs.ts PUT /:id/locate,
 * routes/installPacket.ts POST /p/i/:token/locate). Pure, no imports: the
 * server and the web app (OperationsPage, ScheduleInstall, installPacket) use
 * this one file.
 *
 * The status is worked out from the dates, never typed:
 *   Not called    no ticket number and no dates
 *   Called        a ticket (or the day it was called in), not clear yet: the
 *                 good to dig date is after today, or not entered
 *   Clear to dig  the good to dig date is today or before, not expired
 *   Expired       the expiration date is before today
 * No rule for how long a ticket lasts is assumed: the expiration date is the
 * one on the ticket, typed in.
 */

export type Ymd = string

export type LocateStatus = 'not_called' | 'called' | 'clear' | 'expired'

export interface LocateRecord {
  ticket: string | null
  calledDate: Ymd | null
  /** Good to dig (the first day digging may start). */
  goodDate: Ymd | null
  expDate: Ymd | null
}

export const LOCATE_STATUS_WORDS: Record<LocateStatus, string> = {
  not_called: 'Not called', called: 'Called', clear: 'Clear to dig', expired: 'Expired',
}

const YMD = /^\d{4}-\d{2}-\d{2}$/
export const isLocateDay = (s: unknown): s is Ymd => typeof s === 'string' && YMD.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))

/** MM/DD/YYYY */
export function locateDay(day: Ymd): string {
  if (!isLocateDay(day)) return day
  const [y, m, d] = day.split('-')
  return `${m}/${d}/${y}`
}

const clean = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s ? s : null
}

/** The record from a job row (its locate fields). */
export function locateOf(job: { locateTicket?: string | null; locateCalledDate?: string | null; locatesDate?: string | null; locatesExpDate?: string | null } | null | undefined): LocateRecord {
  return {
    ticket: clean(job?.locateTicket),
    calledDate: isLocateDay(job?.locateCalledDate) ? job!.locateCalledDate! : null,
    goodDate: isLocateDay(job?.locatesDate) ? job!.locatesDate! : null,
    expDate: isLocateDay(job?.locatesExpDate) ? job!.locatesExpDate! : null,
  }
}

export const hasLocate = (r: LocateRecord) => !!(r.ticket || r.calledDate || r.goodDate || r.expDate)

/** The status on `today`. */
export function locateStatus(r: LocateRecord, today: Ymd): LocateStatus {
  if (!hasLocate(r)) return 'not_called'
  if (r.expDate && r.expDate < today) return 'expired'
  if (r.goodDate && r.goodDate <= today) return 'clear'
  return 'called'
}

/** The status in words, with its dates: "Clear to dig, expires 11/20/2026". */
export function locateWords(r: LocateRecord, today: Ymd): { status: LocateStatus; text: string } {
  const status = locateStatus(r, today)
  const exp = r.expDate ? `, expires ${locateDay(r.expDate)}` : ''
  switch (status) {
    case 'not_called': return { status, text: 'Not called' }
    case 'expired': return { status, text: `Expired ${locateDay(r.expDate!)}` }
    case 'clear': return { status, text: `Clear to dig${exp}` }
    case 'called': return { status, text: r.goodDate ? `Called, clear to dig ${locateDay(r.goodDate)}${exp}` : `Called${r.calledDate ? ` ${locateDay(r.calledDate)}` : ''}, good to dig date not entered` }
  }
}

const dayNumber = (d: Ymd) => Math.round(Date.parse(`${d}T12:00:00Z`) / 86_400_000)

export interface LocateWarning { key: 'locates'; text: string }

/**
 * What is wrong with the locate for an install from `start` to `end`:
 * no ticket; the install starts before the good to dig date; the ticket runs
 * out before the install, before its last crew day, or within 3 days of the
 * start. Empty: nothing to warn about.
 */
export function locateWarnings(r: LocateRecord, start: Ymd, end: Ymd): LocateWarning[] {
  const out: LocateWarning[] = []
  const w = (text: string) => out.push({ key: 'locates', text })
  if (!r.ticket && !r.goodDate && !r.expDate) { w(r.calledDate ? `811 called in ${locateDay(r.calledDate)}, but no ticket number on the job.` : 'No 811 locate ticket on the job.'); return out }
  if (!r.ticket) w('No 811 ticket number on the job.')
  if (r.goodDate && start < r.goodDate) w(`The install starts ${locateDay(start)}, before the 811 good to dig date (${locateDay(r.goodDate)}).`)
  if (!r.goodDate) w('No 811 good to dig date on the job.')
  if (r.expDate) {
    if (r.expDate < start) w(`The 811 ticket ran out on ${locateDay(r.expDate)}, before the install starts.`)
    else if (end && r.expDate < end) w(`The 811 ticket runs out on ${locateDay(r.expDate)}, before the last crew day (${locateDay(end)}).`)
    else if (dayNumber(r.expDate) - dayNumber(start) <= 3) w(`The 811 ticket runs out on ${locateDay(r.expDate)}, within 3 days of the install start.`)
  } else w('No 811 expiration date on the job.')
  return out
}

export interface LocateInput { ticket?: unknown; calledDate?: unknown; goodDate?: unknown; expDate?: unknown }

/** A locate as typed, checked: the record to save, or why not (a plain sentence). */
export function cleanLocate(input: LocateInput): { ok: true; record: LocateRecord } | { ok: false; error: string } {
  const ticket = clean(input.ticket)
  if (ticket && (ticket.length > 40 || !/^[A-Za-z0-9 -]+$/.test(ticket))) return { ok: false, error: 'The ticket number can only have letters, numbers, spaces and dashes.' }
  const day = (v: unknown, what: string): Ymd | null | { error: string } => {
    const s = clean(v)
    if (!s) return null
    return isLocateDay(s) ? s : { error: `The ${what} is not a date.` }
  }
  const calledDate = day(input.calledDate, 'called in date')
  const goodDate = day(input.goodDate, 'good to dig date')
  const expDate = day(input.expDate, 'expiration date')
  for (const d of [calledDate, goodDate, expDate]) if (d && typeof d === 'object') return { ok: false, error: d.error }
  const r: LocateRecord = { ticket, calledDate: calledDate as Ymd | null, goodDate: goodDate as Ymd | null, expDate: expDate as Ymd | null }
  if (r.goodDate && r.calledDate && r.goodDate < r.calledDate) return { ok: false, error: 'The good to dig date is before the day it was called in.' }
  if (r.expDate && r.goodDate && r.expDate < r.goodDate) return { ok: false, error: 'The expiration date is before the good to dig date.' }
  return { ok: true, record: r }
}

/** The job fields a locate record is saved in. */
export function locateFields(r: LocateRecord): { locateTicket: string | null; locateCalledDate: string | null; locatesDate: string | null; locatesExpDate: string | null } {
  return { locateTicket: r.ticket, locateCalledDate: r.calledDate, locatesDate: r.goodDate, locatesExpDate: r.expDate }
}

/**
 * A crew packet's typed locate (InstallPacket.locateTicket / locateDate, the
 * fields the packet had before the job kept the locate) read into the job's
 * record: the ticket number, and the date as the good to dig date (what the
 * crew writes down: "10/24 good date"). Only fields the job has empty are
 * filled; what is on the job already is kept. Null: nothing to move.
 */
export function locateFromPacket(job: LocateRecord, packet: { locateTicket?: string | null; locateDate?: string | null }): LocateRecord | null {
  const t = clean(packet.locateTicket)
  const d = isLocateDay(packet.locateDate) ? packet.locateDate! : null
  if (!t && !d) return null
  const next: LocateRecord = { ...job, ticket: job.ticket ?? t, goodDate: job.goodDate ?? d }
  return next.ticket === job.ticket && next.goodDate === job.goodDate ? null : next
}

/** The worst locate problem for an install, in a few words (a Schedule card), or null. */
export function locateShortWarning(r: LocateRecord, start: Ymd, end: Ymd): string | null {
  const md = (d: Ymd) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
  if (!r.ticket && !r.goodDate && !r.expDate) return 'No 811 ticket'
  if (r.expDate && r.expDate < start) return `811 expired ${md(r.expDate)}`
  if (r.goodDate && start < r.goodDate) return `811 not clear until ${md(r.goodDate)}`
  if (r.expDate && end && r.expDate < end) return `811 runs out ${md(r.expDate)}`
  if (r.expDate && dayNumber(r.expDate) - dayNumber(start) <= 3) return `811 runs out ${md(r.expDate)}`
  if (!r.ticket) return 'No 811 ticket number'
  if (!r.goodDate) return 'No 811 good to dig date'
  if (!r.expDate) return 'No 811 expiration date'
  return null
}
