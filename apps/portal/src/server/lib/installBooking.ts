/**
 * An install appointment on a job is the job's install date (review Oct 28
 * 2026: booking an install for Nov 2 changed the job's date but the crew
 * Schedule kept Oct 26, and cancelling the appointment left the job
 * "Scheduled, Mon 11/2, Crew 1" with nothing behind it; for every login, not
 * only the Salesman: the booking window saved the job's dates by itself and
 * never touched the Schedule board).
 *
 * One install date, set on the server when the appointment is saved:
 *   - Booking (or moving) an install appointment linked to a job schedules the
 *     install the way the Schedule screen does (lib/installScheduling.ts
 *     scheduleInstall): the job's days, crew and stage, one Schedule board entry
 *     per crew day, and a line in the job's history.
 *   - What the job was before the booking is kept with the appointment (one
 *     AccountKeyValue row, `installAppt:<appointment id>`, server only).
 *     Cancelling the appointment puts the job back as it was then (dates,
 *     status, stage, crew, board entries), with a history line, but only when
 *     nothing else changed the job's schedule since; if something did, the job
 *     stays as it is and the cancel says so (cancelPreview).
 *   - Installs go on crew days only (Schedule > Settings, Monday to Thursday by
 *     default); weekends and Fridays only for a job booked with "The crew works
 *     weekends on this job" (installDays.ts crewDaysOfWeek).
 */

import prisma from './prisma.js'
import { scheduleInstall, installMetaOf, saveInstallMeta, bumpBoard, settingsOf, ScheduleError, INSTALL_META_PREFIX, type InstallMeta, type ScheduleResult } from './installScheduling.js'
import { crewDaysOfWeek, crewDayProblem, isCrewDay, isYmd, plusDays, shortDayWords } from './installDays.js'
import { floridaDay } from './automations/context.js'
import { recordJobChanges } from './automations/hooks.js'
import { softDeleteLogged, type Actor } from './deletion.js'
import { logScheduleChange, dayWords, daysWords } from './jobActivity.js'

type Json = any

export const INSTALL_APPT_PREFIX = 'installAppt:'
const keyOf = (appointmentId: string) => `${INSTALL_APPT_PREFIX}${appointmentId}`

/** An appointment, as far as the install date goes. */
export interface ApptLike { id: string; type: string; status: string; jobId: string | null; startAt: Date | null; endAt: Date | null; allDay: boolean }

/** Statuses that mean the appointment no longer stands. */
const OVER = new Set(['cancelled', 'no_show', 'completed'])

/** Is this an install appointment that sets its job's install date? */
export const setsInstallDate = (a: Pick<ApptLike, 'type' | 'status' | 'jobId' | 'startAt'> | null | undefined): boolean =>
  !!a && a.type === 'install' && !!a.jobId && !!a.startAt && !OVER.has(a.status)

/** The job's schedule as kept: what is compared and put back. */
export interface JobSchedule { scheduledDate: string; scheduledEndDate: string | null; status: string; opsStage: string; crewAssigned: string; estimatedDays: number }
export interface GridDay { date: string; crewId: string; notes?: string }
export interface BookingRecord {
  jobId: string
  before: JobSchedule & { grid: GridDay[]; meta: InstallMeta | null }
  after: JobSchedule & { grid: GridDay[] }
}

const scheduleOf = (j: Json): JobSchedule => ({
  scheduledDate: String(j.scheduledDate ?? ''), scheduledEndDate: j.scheduledEndDate ?? null, status: String(j.status ?? ''),
  opsStage: String(j.opsStage ?? ''), crewAssigned: String(j.crewAssigned ?? ''), estimatedDays: Number(j.estimatedDays) || 0,
})
const gridOf = (rows: Array<{ date: string; crewId: string; notes?: string | null }>): GridDay[] =>
  rows.map(r => ({ date: r.date, crewId: r.crewId, notes: r.notes ?? '' })).sort((a, b) => a.date.localeCompare(b.date) || a.crewId.localeCompare(b.crewId))

/** Has anything changed the job's schedule since the booking? (Pure; the tests call it.) */
export function scheduleChangedSince(after: BookingRecord['after'], now: JobSchedule & { grid: GridDay[] }): boolean {
  const keys: Array<keyof JobSchedule> = ['scheduledDate', 'scheduledEndDate', 'status', 'opsStage', 'crewAssigned']
  if (keys.some(k => (after[k] ?? null) !== (now[k] ?? null))) return true
  const days = (g: GridDay[]) => g.map(d => `${d.date}|${d.crewId}`).sort().join(',')
  return days(after.grid) !== days(now.grid)
}

/**
 * The crew days an install appointment asks for: an all day appointment over
 * several days, the crew days within it; otherwise null (the days already on
 * the Schedule, else the quote's crew time, as the Schedule screen books).
 */
export function appointmentCrewDays(a: Pick<ApptLike, 'startAt' | 'endAt' | 'allDay'>, week: number[]): number | null {
  if (!a.allDay || !a.startAt || !a.endAt) return null
  const first = floridaDay(a.startAt)
  const last = floridaDay(new Date(a.endAt.getTime() - 1))
  if (!isYmd(first) || !isYmd(last) || last <= first) return null
  let n = 0
  for (let d = first; d <= last && n < 60; d = plusDays(d, 1)) if (isCrewDay(d, week)) n++
  return Math.max(1, n)
}

async function weekOf(accountId: string, jobId: string): Promise<number[]> {
  const [settings, meta] = await Promise.all([settingsOf(accountId), installMetaOf(accountId, jobId)])
  return crewDaysOfWeek(settings.workDays, meta?.allowWeekend ?? false)
}

/** Why an install cannot start on this day (not a crew day), or null. */
export async function installDayProblem(accountId: string, jobId: string, startAt: Date): Promise<string | null> {
  return crewDayProblem(floridaDay(startAt), await weekOf(accountId, jobId))
}

async function readRecord(accountId: string, appointmentId: string, db: Json = prisma): Promise<BookingRecord | null> {
  const row = await db.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: keyOf(appointmentId) } } })
  const v = row?.value as Json
  return v && typeof v === 'object' && typeof v.jobId === 'string' && v.before && v.after ? (v as BookingRecord) : null
}
async function writeRecord(accountId: string, appointmentId: string, rec: BookingRecord, db: Json = prisma) {
  await db.accountKeyValue.upsert({
    where: { accountId_key: { accountId, key: keyOf(appointmentId) } },
    create: { accountId, key: keyOf(appointmentId), value: rec as Json },
    update: { value: rec as Json, version: { increment: 1 } },
  })
}
async function dropRecord(accountId: string, appointmentId: string, db: Json = prisma) {
  await db.accountKeyValue.deleteMany({ where: { accountId, key: keyOf(appointmentId) } })
}

const liveGrid = (accountId: string, jobId: string, db: Json = prisma) =>
  db.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, stagingJobId: jobId }, orderBy: [{ date: 'asc' }, { id: 'asc' }] })

/**
 * Book (or move) the install from its appointment. The job is scheduled as the
 * Schedule screen does it, from the appointment's first day; what the job was
 * before the first booking is kept for a cancel. Throws ScheduleError when the
 * job is gone, the day is not a crew day or a stage rule refuses the move.
 */
export async function bookInstallFromAppointment(accountId: string, actor: Actor & { name?: string }, a: ApptLike): Promise<ScheduleResult> {
  if (!setsInstallDate(a)) throw new ScheduleError(400, 'Not an install appointment on a job.')
  const jobId = a.jobId!
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null, archivedAt: null } })
  if (!job) throw new ScheduleError(404, 'That job is not there any more (archived or deleted). Reload and try again.')
  const problem = await installDayProblem(accountId, jobId, a.startAt!)
  if (problem) throw new ScheduleError(400, problem, { code: 'NOT_A_CREW_DAY' })
  const kept = await readRecord(accountId, a.id)
  // The appointment was on another job before: that job goes back first (when nothing else changed it).
  if (kept && kept.jobId !== jobId) await undoInstallBooking(accountId, actor, a.id)
  const still = kept && kept.jobId === jobId ? kept : null
  const before = still?.before ?? { ...scheduleOf(job), grid: gridOf(await liveGrid(accountId, jobId)), meta: await installMetaOf(accountId, jobId) }
  const r = await scheduleInstall(accountId, actor, {
    jobId, start: floridaDay(a.startAt!), days: appointmentCrewDays(a, await weekOf(accountId, jobId)),
    logNote: 'Booked as an install appointment.',
  })
  await writeRecord(accountId, a.id, { jobId, before, after: { ...scheduleOf(r.job), grid: gridOf(await liveGrid(accountId, jobId)) } })
  return r
}

export type CancelPlan =
  | { kind: 'none' }
  | { kind: 'restore'; jobId: string; words: string }
  | { kind: 'changed'; jobId: string; words: string }

const backWords = (b: BookingRecord['before']) =>
  isYmd(b.scheduledDate)
    ? `the install goes back to ${daysWords(b.scheduledDate, b.scheduledEndDate)}${b.crewAssigned ? `, ${b.crewAssigned}` : ''}`
    : 'the install comes off the Schedule (no install date), as before the booking'

/** What cancelling this appointment does to its job, in words for the cancel confirmation. */
export async function cancelPreview(accountId: string, appointmentId: string): Promise<CancelPlan> {
  const rec = await readRecord(accountId, appointmentId)
  if (!rec) return { kind: 'none' }
  const job = await prisma.savedJob.findFirst({ where: { id: rec.jobId, accountId, deletedAt: null } })
  if (!job) return { kind: 'none' }
  const now = { ...scheduleOf(job), grid: gridOf(await liveGrid(accountId, rec.jobId)) }
  if (scheduleChangedSince(rec.after, now)) {
    const at = isYmd(now.scheduledDate) ? `now ${shortDayWords(now.scheduledDate)}${now.crewAssigned ? `, ${now.crewAssigned}` : ''}` : 'now not on the Schedule'
    return { kind: 'changed', jobId: rec.jobId, words: `The job's schedule was changed after this booking (${at}), so the job stays as it is. Change it on the Schedule if it should move.` }
  }
  return { kind: 'restore', jobId: rec.jobId, words: `The job goes back to how it was before this booking: ${backWords(rec.before)}.` }
}

/**
 * The appointment was cancelled (or is no longer an install on that job): the
 * job goes back to how it was before the booking, when nothing else changed
 * its schedule since. The record is dropped either way. Returns what was done.
 */
export async function undoInstallBooking(accountId: string, actor: Actor & { name?: string }, appointmentId: string): Promise<CancelPlan & { oldJob?: Json; job?: Json }> {
  const plan = await cancelPreview(accountId, appointmentId)
  if (plan.kind !== 'restore') {
    if (plan.kind === 'changed') await logScheduleChange(plan.jobId, `Install appointment cancelled; the job's schedule had been changed since the booking, so it stays as it is`, { userId: actor.userId, name: actor.name })
    await dropRecord(accountId, appointmentId)
    return plan
  }
  const rec = (await readRecord(accountId, appointmentId))!
  const existing = await prisma.savedJob.findFirst({ where: { id: rec.jobId, accountId, deletedAt: null } })
  if (!existing) { await dropRecord(accountId, appointmentId); return { kind: 'none' } }
  const settings = await settingsOf(accountId)
  const b = rec.before
  const job = await prisma.$transaction(async (tx: Json) => {
    const row = await tx.savedJob.update({
      where: { id: existing.id },
      data: { scheduledDate: b.scheduledDate, scheduledEndDate: b.scheduledEndDate, status: b.status, opsStage: b.opsStage, crewAssigned: b.crewAssigned, estimatedDays: b.estimatedDays },
    })
    await recordJobChanges(accountId, existing, row, tx)
    // The board entries as they were: the ones there now are moved back, more added, any left over taken off.
    const cur = await liveGrid(accountId, existing.id, tx)
    const entry = { stagingJobId: existing.id, clientName: existing.customerName, area: existing.customerAddress, sections: existing.sections, fenceType: existing.fenceStyle, jobPrice: existing.contractValue || existing.quotePrice, tearout: existing.tearOutSections > 0, status: 'Scheduled' as const }
    for (let i = 0; i < b.grid.length; i++) {
      const g = b.grid[i]
      if (cur[i]) await tx.scheduledGridJob.update({ where: { id: cur[i].id }, data: { ...entry, date: g.date, crewId: g.crewId, notes: g.notes ?? cur[i].notes } })
      else await tx.scheduledGridJob.create({ data: { accountId, ...entry, date: g.date, crewId: g.crewId, notes: g.notes ?? '' } })
    }
    await softDeleteLogged(tx, actor, 'scheduledGridJob', 'schedule_entry', cur.slice(b.grid.length).map((g: Json) => g.id))
    if (b.meta) await saveInstallMeta(tx, accountId, existing.id, b.meta)
    else await tx.accountKeyValue.deleteMany({ where: { accountId, key: `${INSTALL_META_PREFIX}${existing.id}` } })
    await dropRecord(accountId, appointmentId, tx)
    await bumpBoard(tx, accountId, settings)
    return row
  })
  const words = isYmd(b.scheduledDate)
    ? `Install appointment cancelled: install back to ${daysWords(b.scheduledDate, b.scheduledEndDate)}${b.crewAssigned ? `, ${b.crewAssigned}` : ''} (was ${dayWords(existing.scheduledDate)})`
    : `Install appointment cancelled: install taken off the schedule${isYmd(existing.scheduledDate) ? ` (was ${dayWords(existing.scheduledDate)})` : ''}`
  await logScheduleChange(existing.id, words, { userId: actor.userId, name: actor.name })
  return { ...plan, oldJob: existing, job }
}
