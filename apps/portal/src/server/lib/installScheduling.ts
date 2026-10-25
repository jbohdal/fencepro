/**
 * Scheduling installs (Schedule > Ready to schedule, the job page's and the
 * pipeline card's Schedule install, a drag on the Schedule or Dispatch).
 *
 * One step does it all, on the server, in one transaction:
 *   - the job gets its start and end day, crew and crew days, and moves to the
 *     Scheduled stage (Settings > Operations Stages; a stage rule that refuses
 *     the move refuses the booking, as everywhere else);
 *   - the Schedule board gets one entry per crew day (ScheduledGridJob, linked
 *     by stagingJobId), on crew working days only (lib/installDays.ts);
 *   - the board's version goes up, so an open Schedule merges it in.
 * Google Calendar follows by itself (the schedule router asks for a sync after
 * every write); the crew packet, Dispatch and the customer portal read the job.
 *
 * The customer's text is only prepared here (installText), with whether this
 * customer may be texted (lib/textConsent.ts). Nothing is sent: the office
 * opens it on their own phone and sends it, or does not.
 *
 * Rain day: every booked crew day on or after the day moves one crew day later
 * (rainDayMoves), each job's start and end follow, the rain log gets a row per
 * job, and the moved customers' texts are prepared the same way.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { dataFor, requestFrom } from './quotePricing.js'
import { loadOpsStages } from './opsStages.js'
import { stageOfJob, phaseOf, stageById, firstStageFor, fieldsForStage, sortedStages } from './opsStageModel.js'
import { checkJobMove } from './automations/stageRules.js'
import { recordJobChanges } from './automations/hooks.js'
import { softDeleteLogged, type Actor } from './deletion.js'
import { textAllowedTo } from './textConsent.js'
import { staffLogins, loginByName } from './appointmentRep.js'
import { floridaDay } from './automations/context.js'
import {
  crewDaysOfWeek, installDays, isCrewDay, wholeCrewDays, daysForSections, rainDayMoves, installText, customerPhoneToGive, isYmd,
  type Ymd, type ReadyFacts,
} from './installDays.js'

type Json = any

export class ScheduleError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

const LIVE = { deletedAt: null, archivedAt: null }

async function settingsOf(accountId: string, db: any = prisma) {
  const s = await db.scheduleSettings.findUnique({ where: { accountId } })
  const crews = (Array.isArray(s?.crews) ? s!.crews : [{ id: 'crew1', name: 'Crew 1', color: 'bg-blue-500' }]) as Array<{ id: string; name: string; color: string }>
  return { workDays: (Array.isArray(s?.workDays) ? s!.workDays : [1, 2, 3, 4]) as number[], crews }
}

/* ── Crew days from the quote ───────────────────────────────────────────── */

/**
 * The quote's crew time, in whole crew days: the quote builder's own math
 * (pricingEngine: man hours from the style's sections per man hour and the
 * gates, / crew size, / crew hours a day). Null when it cannot be worked out
 * (no quote, a move or repair, a style with no man hour rate).
 */
async function quoteCrewDays(m: Json, data: Json, quote: Json | null): Promise<number | null> {
  if (!quote || quote.work) return null
  const rails: unknown[] = Array.isArray(quote.runRails) ? quote.runRails : []
  const body = {
    fenceStyle: quote.fenceStyle, runs: (Array.isArray(quote.runs) ? quote.runs : []).map((ft: unknown, i: number) => ({ ft: Number(ft) || 0, rail: rails[i] })),
    corners: quote.corners, ends: quote.ends, walkGates: quote.walkGates, dblGates: quote.dblGates,
    tearOutSections: quote.tearOutSections, tearOutGates: quote.tearOutGates, extraLaborHrs: quote.adjLaborHrs, hasSalesman: quote.hasSalesman,
    priceAdjust: quote.priceAdjust, jobType: 'new',
  }
  try {
    const { req, overheadPct } = requestFrom(body, quote, m.importedOldPrice, m.keepsCents)
    const job = m.quoteJobFor(data, req, overheadPct)
    const days = wholeCrewDays(job?.calc?.priced?.crewDays)
    return days > 0 ? days : null
  } catch { return null }
}

/* ── Ready to schedule ──────────────────────────────────────────────────── */

export interface ReadyJob extends ReadyFacts {
  id: string
  customerName: string
  address: string
  phone: string
  crmContactId: string | null
  quoteId: string | null
  fenceStyle: string
  footage: number
  sections: number
  crewDays: number
  /** quote: the quote's crew time; estimate: about 15 sections a day (no crew time on the quote). */
  crewDaysFrom: 'quote' | 'estimate'
  stage: string
  stageName: string
  scheduledDate: string
  scheduledEndDate: string | null
  crewAssigned: string
  /** The crew days booked on the Schedule (empty when not scheduled). */
  bookedDays: Ymd[]
  depositCents: number
  depositPaidCents: number
}

/** The facts the Ready list and the Schedule install window show, for these jobs. */
async function factsFor(accountId: string, jobs: Json[]): Promise<ReadyJob[]> {
  if (!jobs.length) return []
  const ids = jobs.map(j => j.id)
  const quoteIds = jobs.map(j => j.quoteId).filter(Boolean)
  const [{ stages }, quotes, permits, invoices, payments, grid, m, data] = await Promise.all([
    loadOpsStages(accountId),
    prisma.savedQuote.findMany({ where: { accountId, deletedAt: null, id: { in: quoteIds } } }),
    prisma.permit.findMany({ where: { accountId, jobId: { in: ids } } }),
    prisma.contractInvoice.findMany({ where: { accountId, jobId: { in: ids }, kind: 'deposit', voidedAt: null } }),
    prisma.contractPayment.findMany({ where: { accountId, jobId: { in: ids }, voidedAt: null }, select: { jobId: true, amountCents: true } }),
    prisma.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, stagingJobId: { in: ids } }, select: { stagingJobId: true, date: true } }),
    pricingModule() as Promise<Json>,
    dataFor(accountId),
  ])
  const qById = new Map(quotes.map(q => [q.id, q]))
  const out: ReadyJob[] = []
  for (const j of jobs) {
    const q = j.quoteId ? qById.get(j.quoteId) ?? null : null
    const fromQuote = await quoteCrewDays(m, data, q)
    const dep = invoices.filter(i => i.jobId === j.id)
    const depositCents = dep.reduce((s, i) => s + i.amountCents, 0)
    // Payments go to the oldest open invoice first, and the deposit is the first one (lib/paymentMath.ts).
    const paid = payments.filter(p => p.jobId === j.id).reduce((s, p) => s + p.amountCents, 0)
    const depositPaidCents = Math.min(depositCents, paid)
    const deposit: ReadyFacts['deposit'] = !dep.length ? (paid > 0 ? 'paid' : 'none') : depositPaidCents >= depositCents ? 'paid' : depositPaidCents > 0 ? 'part' : 'unpaid'
    const stage = stageOfJob(stages, j)
    const runs: number[] = Array.isArray(q?.runs) ? (q!.runs as unknown[]).map(Number).filter(n => n > 0) : []
    out.push({
      id: j.id, customerName: j.customerName, address: j.customerAddress, phone: j.customerPhone, crmContactId: j.crmContactId, quoteId: j.quoteId,
      fenceStyle: j.fenceStyle, footage: j.totalFeet || runs.reduce((s, n) => s + n, 0), sections: j.sections,
      crewDays: fromQuote ?? (j.estimatedDays > 0 ? j.estimatedDays : daysForSections(j.sections)), crewDaysFrom: fromQuote ? 'quote' : 'estimate',
      stage, stageName: stageById(stages, stage)?.name ?? stage,
      scheduledDate: j.scheduledDate, scheduledEndDate: j.scheduledEndDate, crewAssigned: j.crewAssigned,
      bookedDays: grid.filter(g => g.stagingJobId === j.id && isYmd(g.date)).map(g => g.date).sort(),
      permitStatus: permits.find(p => p.jobId === j.id)?.status ?? null,
      locatesDate: j.locatesDate || null, locatesExpDate: j.locatesExpDate || null,
      deposit, depositCents, depositPaidCents, materialsStatus: j.materialsStatus,
    })
  }
  return out
}

/** Every sold job not scheduled yet: in a stage that stands for staging, or Scheduled with no date. Side lanes (on hold) are left out. */
export async function readyToSchedule(accountId: string): Promise<ReadyJob[]> {
  const { stages } = await loadOpsStages(accountId)
  const jobs = await prisma.savedJob.findMany({ where: { accountId, deletedAt: null, archivedAt: null, status: { in: ['staging', 'scheduled'] } }, orderBy: { createdAt: 'asc' } })
  const waiting = jobs.filter(j => {
    const p = phaseOf(stages, stageOfJob(stages, j as Json))
    return p === 'staging' || (p === 'scheduled' && !isYmd(j.scheduledDate))
  })
  return factsFor(accountId, waiting)
}

/** One job's facts (scheduled or not), for its Schedule install window. */
export async function jobScheduleFacts(accountId: string, jobId: string): Promise<ReadyJob | null> {
  const j = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, ...LIVE } })
  return j ? (await factsFor(accountId, [j]))[0] : null
}

/* ── The text ───────────────────────────────────────────────────────────── */

export interface PreparedText {
  jobId: string
  customerName: string
  /** As it would be sent to. */
  phone: string
  body: string
  /** False: this customer may not be texted (no yes on record, or said no); `reason` says why. */
  allowed: boolean
  reason: string | null
  /** Whose number the text gives: the job's salesman's Direct phone, or the company phone. */
  callFrom: 'rep' | 'company'
}

async function textFor(accountId: string, job: Json, kind: 'scheduled' | 'moved', start: Ymd, ctx?: { staff: Json[]; company: { name: string; phone: string } }): Promise<PreparedText> {
  const c = ctx ?? await textContext(accountId)
  const contact = job.crmContactId ? await prisma.crmContact.findUnique({ where: { id: job.crmContactId }, select: { firstName: true, phone: true } }) : null
  const phone = contact?.phone || job.customerPhone || ''
  const rep = loginByName(c.staff, job.salesRep)
  const give = customerPhoneToGive(rep?.phone, c.company.phone)
  const firstName = (contact?.firstName || String(job.customerName || '').trim().split(/\s+/)[0] || '').trim()
  const ok = await textAllowedTo(phone, accountId)
  return {
    jobId: job.id, customerName: job.customerName, phone,
    body: installText(kind, { company: c.company.name, firstName, start, phone: give.phone }),
    allowed: ok.allowed, reason: ok.reason, callFrom: give.from,
  }
}

async function textContext(accountId: string) {
  const [staff, b] = await Promise.all([staffLogins(accountId), prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })])
  const co = ((b?.config as Json)?.company ?? {}) as Json
  return { staff, company: { name: String(co.name || 'Getter Done Fence'), phone: String(co.phone || co.supportPhone || '') } }
}

/* ── Schedule one job ───────────────────────────────────────────────────── */

export interface ScheduleRequest {
  jobId: string
  start: Ymd
  /** A crew's id from Schedule > Settings (or its name). The first crew when left out. */
  crew?: string | null
  /** Crew days; left out: the days already booked (a move), else the quote's crew time. */
  days?: number | null
  /** Book Saturday and Sunday too for this job. */
  allowWeekend?: boolean
}

export interface ScheduleResult {
  job: Json
  days: Ymd[]
  crew: { id: string; name: string }
  /** The start asked for was not a crew day: it moved to the next one. */
  movedFrom: Ymd | null
  /** It had a date before (a move, not a first booking). */
  rescheduled: boolean
  previousStart: Ymd | null
  text: PreparedText
}

export async function scheduleInstall(accountId: string, actor: Actor & { name?: string }, r: ScheduleRequest): Promise<ScheduleResult> {
  if (!isYmd(r.start)) throw new ScheduleError(400, 'Pick the day the install starts.')
  const existing = await prisma.savedJob.findFirst({ where: { id: r.jobId, accountId, ...LIVE } })
  if (!existing) throw new ScheduleError(404, 'That job is not there any more (archived or deleted). Reload and try again.')
  const [{ stages }, settings, booked] = await Promise.all([
    loadOpsStages(accountId), settingsOf(accountId),
    prisma.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, stagingJobId: existing.id }, orderBy: [{ date: 'asc' }, { id: 'asc' }] }),
  ])
  // No crew named (a drag to another day): the crew it has.
  const crewKey = String(r.crew ?? '').trim() || booked[0]?.crewId || existing.crewAssigned.trim()
  const crew = settings.crews.find(c => c.id === crewKey) ?? settings.crews.find(c => c.name.trim().toLowerCase() === crewKey.toLowerCase()) ?? settings.crews[0]
  if (!crew) throw new ScheduleError(400, 'There is no crew yet. Add one in Schedule > Settings.')

  // Weekends: asked for, or the job was already booked over a weekend day (kept on a move).
  const base = crewDaysOfWeek(settings.workDays)
  const allowWeekend = r.allowWeekend ?? booked.some(b => isYmd(b.date) && !isCrewDay(b.date, base))
  const week = crewDaysOfWeek(settings.workDays, allowWeekend)
  let count = Number.isFinite(r.days as number) && (r.days as number) > 0 ? Math.floor(r.days as number) : 0
  if (!count) count = booked.length || (await jobScheduleFacts(accountId, existing.id))?.crewDays || daysForSections(existing.sections)
  const days = installDays(r.start, count, week)
  const start = days[0], end = days[days.length - 1]

  // The stage: a job not scheduled yet moves to Scheduled; one already scheduled or under way stays where it is.
  const was = stageOfJob(stages, existing as Json)
  const phase = phaseOf(stages, was)
  const target = phase === 'staging' || phase === 'on_hold' ? (stageById(stages, 'scheduled') && phaseOf(stages, 'scheduled') === 'scheduled' ? 'scheduled' : firstStageFor(stages, 'scheduled')) : was
  const stageFields = target && target !== was ? fieldsForStage(stages, target, existing as Json, floridaDay(new Date())) ?? {} : {}
  const update: Json = { ...stageFields, opsStage: target || was, scheduledDate: start, scheduledEndDate: end, crewAssigned: crew.name, estimatedDays: days.length }
  const blocked = await checkJobMove(accountId, existing, { ...existing, ...update })
  if (blocked) {
    throw new ScheduleError(409, `${blocked.name} cannot move to ${blocked.to} yet. Missing: ${blocked.missing.map(x => x.label.toLowerCase()).join(', ')}.`, { code: 'STAGE_BLOCKED', blocked: [blocked] })
  }

  const job = await prisma.$transaction(async tx => {
    const row = await tx.savedJob.update({ where: { id: existing.id }, data: update })
    await recordJobChanges(accountId, existing, row, tx)
    // One board entry per crew day: the ones there are moved, more added, any left over taken off.
    const entry = { stagingJobId: existing.id, clientName: existing.customerName, area: existing.customerAddress, sections: existing.sections, fenceType: existing.fenceStyle, jobPrice: existing.contractValue || existing.quotePrice, tearout: existing.tearOutSections > 0, crewId: crew.id, status: 'Scheduled' as const }
    for (let i = 0; i < days.length; i++) {
      if (booked[i]) await tx.scheduledGridJob.update({ where: { id: booked[i].id }, data: { ...entry, date: days[i], notes: booked[i].notes } })
      else await tx.scheduledGridJob.create({ data: { accountId, ...entry, date: days[i], notes: '' } })
    }
    await softDeleteLogged(tx as Json, actor, 'scheduledGridJob', 'schedule_entry', booked.slice(days.length).map(b => b.id))
    await bumpBoard(tx, accountId, settings)
    return row
  })
  const rescheduled = isYmd(existing.scheduledDate)
  return {
    job, days, crew: { id: crew.id, name: crew.name },
    movedFrom: start !== r.start ? r.start : null,
    rescheduled, previousStart: rescheduled ? existing.scheduledDate : null,
    text: await textFor(accountId, job, rescheduled ? 'moved' : 'scheduled', start),
  }
}

/** The board changed: its version goes up, so an open Schedule reads it again (lib/versioned.ts). */
async function bumpBoard(tx: Json, accountId: string, settings: { workDays: number[]; crews: Json[] }) {
  const n = await tx.scheduleSettings.updateMany({ where: { accountId }, data: { version: { increment: 1 } } })
  if (n.count === 0) await tx.scheduleSettings.create({ data: { accountId, workDays: settings.workDays, crews: settings.crews, version: 2 } })
}

/**
 * Off the schedule: the job's dates and board entries are cleared and it goes
 * back to the last waiting stage before Scheduled (Ready to Pull by default).
 */
export async function unscheduleInstall(accountId: string, actor: Actor, jobId: string): Promise<Json> {
  const existing = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, ...LIVE } })
  if (!existing) throw new ScheduleError(404, 'That job is not there any more. Reload and try again.')
  const [{ stages }, settings] = await Promise.all([loadOpsStages(accountId), settingsOf(accountId)])
  const was = stageOfJob(stages, existing as Json)
  const waiting = sortedStages(stages).filter(s => s.lane === 'main' && !s.hidden && phaseOf(stages, s.id) === 'staging')
  const back = phaseOf(stages, was) === 'scheduled' ? (waiting[waiting.length - 1]?.id ?? null) : null
  const update: Json = { ...(back ? fieldsForStage(stages, back, existing as Json, floridaDay(new Date())) ?? {} : {}), scheduledDate: '', scheduledEndDate: null }
  // Ready to Pull says the materials are in; going back there keeps the materials as they were.
  if (back) { update.opsStage = back; delete update.materialsStatus; delete update.drawingComplete }
  return prisma.$transaction(async tx => {
    const row = await tx.savedJob.update({ where: { id: existing.id }, data: update })
    await recordJobChanges(accountId, existing, row, tx)
    const ids = (await tx.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, stagingJobId: existing.id }, select: { id: true } })).map(g => g.id)
    await softDeleteLogged(tx as Json, actor, 'scheduledGridJob', 'schedule_entry', ids)
    await bumpBoard(tx, accountId, settings)
    return row
  })
}

/* ── Rain day ───────────────────────────────────────────────────────────── */

export interface RainMove {
  jobId: string | null
  customerName: string
  /** The job's first crew day before and after. */
  startFrom: Ymd
  startTo: Ymd
  days: Array<{ id: string; from: Ymd; to: Ymd }>
  text: PreparedText | null
}

async function rainPlan(accountId: string, from: Ymd, shift: number) {
  const [settings, rows] = await Promise.all([
    settingsOf(accountId),
    prisma.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, status: { in: ['Scheduled', 'InProgress'] } } }),
  ])
  const dated = rows.filter(r => isYmd(r.date))
  const keyOf = (r: Json) => r.stagingJobId ? `job:${r.stagingJobId}` : `name:${String(r.clientName).trim().toLowerCase()}`
  const moves = rainDayMoves(dated.map(r => ({ id: r.id, jobKey: keyOf(r), date: r.date })), from, shift, settings.workDays)
  const byKey = new Map<string, RainMove>()
  for (const mv of moves) {
    const row = dated.find(r => r.id === mv.id)!
    const all = dated.filter(r => keyOf(r) === mv.jobKey).map(r => r.date).sort()
    let g = byKey.get(mv.jobKey)
    if (!g) { g = { jobId: row.stagingJobId ?? null, customerName: row.clientName, startFrom: all[0], startTo: all[0], days: [], text: null }; byKey.set(mv.jobKey, g) }
    g.days.push({ id: mv.id, from: mv.date, to: mv.to })
  }
  for (const [key, g] of byKey) {
    const moved = new Map(g.days.map(d => [d.id, d.to]))
    const after = dated.filter(r => keyOf(r) === key).map(r => moved.get(r.id) ?? r.date).sort()
    g.startTo = after[0]
  }
  return { settings, moves: [...byKey.values()].sort((a, b) => a.startFrom.localeCompare(b.startFrom) || a.customerName.localeCompare(b.customerName)), rows: dated }
}

/** What a rain day on `from` would move, with each moved customer's text (nothing is saved). */
export async function rainDayPreview(accountId: string, from: Ymd, shift = 1): Promise<RainMove[]> {
  if (!isYmd(from)) throw new ScheduleError(400, 'Pick the rain day.')
  const { moves } = await rainPlan(accountId, from, shift)
  return withTexts(accountId, moves)
}

async function withTexts(accountId: string, moves: RainMove[]): Promise<RainMove[]> {
  const ctx = await textContext(accountId)
  const jobs = await prisma.savedJob.findMany({ where: { accountId, deletedAt: null, id: { in: moves.map(m => m.jobId).filter((x): x is string => !!x) } } })
  for (const m of moves) {
    const job = jobs.find(j => j.id === m.jobId)
    // A customer is texted when their start day moves (a job already under way just runs a day longer).
    if (job && m.startTo !== m.startFrom) m.text = await textFor(accountId, job, 'moved', m.startTo, ctx)
  }
  return moves
}

export async function applyRainDay(accountId: string, from: Ymd, shift: number, reason: string): Promise<RainMove[]> {
  if (!isYmd(from)) throw new ScheduleError(400, 'Pick the rain day.')
  const { settings, moves, rows } = await rainPlan(accountId, from, shift)
  if (!moves.length) return []
  const keyOf = (r: Json) => r.stagingJobId ? `job:${r.stagingJobId}` : `name:${String(r.clientName).trim().toLowerCase()}`
  const flaggedAt = new Date()
  await prisma.$transaction(async tx => {
    for (const m of moves) for (const d of m.days) await tx.scheduledGridJob.update({ where: { id: d.id }, data: { date: d.to } })
    for (const m of moves) {
      if (m.jobId) {
        const moved = new Map(m.days.map(d => [d.id, d.to]))
        const sample = rows.find(r => r.stagingJobId === m.jobId)
        const after = rows.filter(r => sample && keyOf(r) === keyOf(sample)).map(r => moved.get(r.id) ?? r.date).sort()
        if (after.length) await tx.savedJob.updateMany({ where: { id: m.jobId, accountId }, data: { scheduledDate: after[0], scheduledEndDate: after[after.length - 1] } })
      }
      await tx.scheduleRainDay.create({ data: { accountId, jobId: m.days[0].id, clientName: m.customerName, originalDate: m.startFrom, rescheduleDate: m.startTo, reason: m === moves[0] ? reason : `${reason} (rain day ${from}, everything after it moved)`, flaggedAt } })
    }
    await bumpBoard(tx, accountId, settings)
  })
  return withTexts(accountId, moves)
}
