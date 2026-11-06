/**
 * Assigning a sub to a job (Jonathan, Nov 6 2026: "the ONLY thing I do by
 * hand; everything after is automatic"), and what follows it:
 *
 *   preview   who is free that day, their papers (liability and workers'
 *             comp or the Florida exemption), what they would be paid
 *   assign    the install booked on the Schedule as the sub's own crew row
 *             (lib/installScheduling.ts scheduleInstall: the board, clash
 *             warnings and Google Calendar name them), their pay from their
 *             rates, their link, the "Call in 811" task
 *   follow    the install moved: the 811 task moves and the sub is told; a
 *             change order: their pay is worked out again and they are told;
 *             the 811 ticket entered: the task closes and they are told
 *
 * Every email to a sub goes through lib/emailService.ts (the outbound gate
 * keeps it in the dev outbox off the live install). No texts to subs until
 * the Twilio campaign covers them (docs/DECISIONS.md, Nov 6 2026).
 */

import crypto from 'crypto'
import prisma from './prisma.js'
import { floridaDay } from './automations/context.js'
import { scheduleInstall, settingsOf as scheduleSettingsOf, bumpBoard, ScheduleError, jobScheduleFacts, installMetaOf } from './installScheduling.js'
import { installDays, crewDaysOfWeek, daysForSections, isYmd, usDate, plusDays, type Ymd } from './installDays.js'
import { papersOf, docKindsOf, subSettingsOf, payContext, payLinesFor, payTotal, cleanRates, newLink, linkToken, businessDaysBefore, subCrewId, refreshPay, SubError, SUB_STATUS_LABEL, type SubStatus } from './subcontractors.js'
import { getFrontendBase } from './urls.js'

type Json = any
export interface Actor { userId: string; name: string; role: string }

const CREW_COLORS = ['bg-teal-500', 'bg-amber-500', 'bg-rose-500', 'bg-indigo-500', 'bg-lime-600', 'bg-cyan-600']

/** The sub's link on this server (the raw token is in the link only). */
export function subLinkUrl(token: string): string {
  return `${getFrontendBase()}/p/sub/${token}`
}

async function configOf(accountId: string): Promise<Json> {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  return (b?.config ?? {}) as Json
}

/** The days a sub is booked on other jobs (their crew row on the Schedule). */
async function bookedDays(accountId: string, subId: string, exceptJobId: string): Promise<Array<{ date: Ymd; clientName: string; jobId: string | null }>> {
  const rows = await prisma.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, crewId: subCrewId(subId), NOT: { stagingJobId: exceptJobId } }, select: { date: true, clientName: true, stagingJobId: true } })
  return rows.map(r => ({ date: r.date as Ymd, clientName: r.clientName, jobId: r.stagingJobId }))
}

/** The days a job would take from `start`: its crew days, counted as scheduleInstall counts them (the days booked, else the quote's crew time). */
async function daysFrom(accountId: string, job: Json, start: Ymd): Promise<Ymd[]> {
  const s = await scheduleSettingsOf(accountId)
  const booked = await prisma.scheduledGridJob.count({ where: { accountId, deletedAt: null, stagingJobId: job.id } })
  const meta = await installMetaOf(accountId, job.id)
  const count = booked || (await jobScheduleFacts(accountId, job.id))?.crewDays || daysForSections(job.sections)
  return installDays(start, count, crewDaysOfWeek(s.workDays, meta?.allowWeekend ?? false))
}

/** Before Confirm: the sub's papers, the days they are already booked, their pay for this job. */
export async function previewAssign(accountId: string, jobId: string, subId: string, start: Ymd | null) {
  const [job, sub, subSettings] = await Promise.all([
    prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null } }),
    prisma.subcontractor.findFirst({ where: { id: subId, accountId, deletedAt: null }, include: { documents: true } }),
    subSettingsOf(accountId),
  ])
  if (!job) throw new SubError(404, 'That job is not there any more.')
  if (!sub) throw new SubError(404, 'That sub is not there any more.')
  const today = floridaDay(new Date())
  const papers = papersOf(sub.documents as Json, today, docKindsOf(subSettings))
  const days = start && isYmd(start) ? await daysFrom(accountId, job, start) : []
  const clashes = days.length ? (await bookedDays(accountId, subId, jobId)).filter(b => days.includes(b.date)) : []
  // 811: we call it in; the task is due 3 business days before the install. Too soon to call, or the ticket's
  // dig day or expiry does not fit the install days: said before Confirm, with the earliest start that fits.
  const sched = await scheduleSettingsOf(accountId)
  const week = crewDaysOfWeek(sched.workDays, false)
  let earliestStart = today
  while (!week.includes(new Date(`${earliestStart}T12:00:00Z`).getUTCDay()) || businessDaysBefore(earliestStart, 3) < today) earliestStart = plusDays(earliestStart, 1)
  const locate: string[] = []
  if (days.length) {
    const end = days[days.length - 1]
    if (!job.locateTicket?.trim() && days[0] < earliestStart) locate.push(`Too soon for 811: the ticket is called in 3 business days before. The earliest start is ${usDate(earliestStart)}.`)
    if (job.locateTicket?.trim() && job.locatesDate && job.locatesDate > days[0]) locate.push(`811 ticket ${job.locateTicket} is good to dig from ${usDate(job.locatesDate)}, after the install starts.`)
    if (job.locateTicket?.trim() && job.locatesExpDate && job.locatesExpDate < end) locate.push(`811 ticket ${job.locateTicket} expires ${usDate(job.locatesExpDate)}, before the install ends.`)
  }
  const { work, settings } = await payContext(accountId, job.quoteId)
  const lines = work ? payLinesFor(work, settings.styles.find(x => x?.name === work.fenceStyle), settings.pricing, cleanRates(sub.rates)) : []
  return {
    sub: { id: sub.id, businessName: sub.businessName, status: sub.status as SubStatus },
    days, clashes, locate, earliestStart,
    insuranceProblems: papers.insuranceProblems, missing: papers.missing,
    payLines: lines, payCents: payTotal(lines),
  }
}

/** The sub's crew row on the Schedule (made once): its name follows the sub's. */
export async function ensureSubCrew(accountId: string, sub: { id: string; businessName: string }): Promise<string> {
  const id = subCrewId(sub.id)
  await prisma.$transaction(async tx => {
    const s = await scheduleSettingsOf(accountId, tx)
    const crews = [...s.crews]
    const at = crews.findIndex(c => c.id === id)
    if (at >= 0 && crews[at].name === sub.businessName) return
    if (at >= 0) crews[at] = { ...crews[at], name: sub.businessName }
    else crews.push({ id, name: sub.businessName, color: CREW_COLORS[crews.length % CREW_COLORS.length] })
    const n = await tx.scheduleSettings.updateMany({ where: { accountId }, data: { crews: crews as Json, version: { increment: 1 } } })
    if (n.count === 0) await tx.scheduleSettings.create({ data: { accountId, workDays: s.workDays as Json, crews: crews as Json, version: 2 } })
  })
  return id
}

/** A sub no longer active: their crew row comes off the Schedule, unless an install is booked on it from `today` on. */
export async function dropSubCrew(accountId: string, subId: string, today: Ymd) {
  const id = subCrewId(subId)
  const ahead = await prisma.scheduledGridJob.count({ where: { accountId, deletedAt: null, crewId: id, date: { gte: today } } })
  if (ahead) return false
  await prisma.$transaction(async tx => {
    const s = await scheduleSettingsOf(accountId, tx)
    if (!s.crews.some(c => c.id === id)) return
    await tx.scheduleSettings.updateMany({ where: { accountId }, data: { crews: s.crews.filter(c => c.id !== id) as Json, version: { increment: 1 } } })
  })
  return true
}

/**
 * Assign a sub to a job and book its install (one sub per job; a new sub replaces the one before, whose link stops).
 * Missing or expired liability or workers' comp: refused with the reasons, unless the owner overrides (recorded).
 */
export async function assignSub(accountId: string, actor: Actor, input: { jobId: string; subId: string; start: Ymd; override?: boolean }) {
  if (!isYmd(input.start)) throw new SubError(400, 'Pick the install day.')
  const pre = await previewAssign(accountId, input.jobId, input.subId, input.start)
  if (pre.sub.status !== 'active') throw new SubError(409, `${pre.sub.businessName} is ${SUB_STATUS_LABEL[pre.sub.status].toLowerCase()}. Make them Active first.`)
  if (pre.insuranceProblems.length && !input.override) {
    throw new SubError(409, `${pre.sub.businessName}: ${pre.insuranceProblems.join('; ')}.`, { code: 'SUB_PAPERS', problems: pre.insuranceProblems, ownerCanOverride: actor.role === 'super_admin' })
  }
  if (pre.insuranceProblems.length && actor.role !== 'super_admin') throw new SubError(403, 'Only the owner can assign a sub whose insurance is missing or expired.')
  const sub = await prisma.subcontractor.findUniqueOrThrow({ where: { id: input.subId } })
  const crewId = await ensureSubCrew(accountId, sub)
  let booked
  try {
    booked = await scheduleInstall(accountId, { userId: actor.userId, name: actor.name } as Json, { jobId: input.jobId, start: input.start, crew: crewId, logNote: `Sub: ${sub.businessName}.` })
  } catch (e) {
    if (e instanceof ScheduleError) throw new SubError(e.status, e.message, (e as Json).extra ?? {})
    throw e
  }
  const before = await prisma.subJob.findUnique({ where: { jobId: input.jobId } })
  const sameSub = before?.subId === sub.id && !before.linkDisabledAt
  const rowId = before?.id ?? crypto.randomUUID()
  const t = newLink(rowId)
  const override = pre.insuranceProblems.length ? { missing: pre.insuranceProblems, by: actor.name, at: new Date().toISOString() } : null
  const event = { at: new Date().toISOString(), what: before && !sameSub ? `Assigned (was ${before.subId === sub.id ? 'the same sub' : 'another sub'})` : 'Assigned', how: 'app', to: actor.name }
  const data = {
    subId: sub.id, assignedAt: new Date(), assignedBy: actor.name, docOverride: override as Json,
    payLines: pre.payLines as Json, payCents: pre.payCents, payEdited: false,
  }
  const row = before
    ? await prisma.subJob.update({ where: { id: before.id }, data: { ...data, ...(sameSub ? {} : { linkNonce: t.nonce, tokenHash: t.hash, linkDisabledAt: null, checkout: undefined, report: undefined, checkin: undefined, submittedAt: null, confirmedAt: null, confirmedBy: null, flags: [] }), events: [...((before.events as Json[]) ?? []), event] as Json } })
    : await prisma.subJob.create({ data: { id: rowId, accountId, jobId: input.jobId, linkNonce: t.nonce, tokenHash: t.hash, ...data, events: [event] as Json } })
  await ensureLocateTask(accountId, input.jobId, booked.days[0])
  // A new sub on the job (or a new link): the packet link, as a text ready to send from the phone.
  if (!sameSub) await queuePacketText(accountId, { ...row, sub }, booked.days[0] as Ymd).catch(e => console.error('[subs] packet text:', e))
  return { subJob: row, days: booked.days, clashes: pre.clashes, calendar: booked.calendar, link: subLinkUrl(linkToken(row.id, row.linkNonce)), override }
}

/** The sub's link for a job (the same one every time, until a new one is made). */
export function linkOf(sj: { id: string; linkNonce: string }): string {
  return subLinkUrl(linkToken(sj.id, sj.linkNonce))
}

/** A new link for the sub: the old one stops working (a link sent to the wrong person). */
export async function newSubLink(accountId: string, jobId: string): Promise<string> {
  const sj = await prisma.subJob.findFirst({ where: { accountId, jobId } })
  if (!sj) throw new SubError(404, 'No sub on this job.')
  const t = newLink(sj.id)
  await prisma.subJob.update({ where: { id: sj.id }, data: { linkNonce: t.nonce, tokenHash: t.hash, linkDisabledAt: null } })
  return subLinkUrl(t.token)
}

/** Take the sub off the job: their link stops, the 811 task stays (the install is still booked). */
export async function unassignSub(accountId: string, jobId: string, actor: Actor) {
  const sj = await prisma.subJob.findFirst({ where: { accountId, jobId } })
  if (!sj) return null
  await prisma.subJob.delete({ where: { id: sj.id } })
  await logJob(jobId, `Sub taken off the job by ${actor.name}.`, actor)
  return sj
}

// ── The 811 task ────────────────────────────────────────────────────────────

export const LOCATE_TASK_PREFIX = 'Call in 811: '

/** "Call in 811" for the owner and office, due 3 business days before the install; none once the ticket is in. */
export async function ensureLocateTask(accountId: string, jobId: string, start: Ymd | null | undefined) {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null }, select: { customerName: true, customerAddress: true, locateTicket: true } })
  if (!job || !start || !isYmd(start)) return null
  const open = await prisma.task.findFirst({ where: { jobId, title: { startsWith: LOCATE_TASK_PREFIX }, status: { in: ['pending', 'in_progress'] } } })
  if (job.locateTicket?.trim()) return open ? prisma.task.update({ where: { id: open.id }, data: { status: 'completed', completedAt: new Date() } }) : null
  const due = new Date(`${businessDaysBefore(start, 3)}T16:00:00.000Z`)
  if (open) return +open.dueDate! === +due ? open : prisma.task.update({ where: { id: open.id }, data: { dueDate: due, description: locateTaskWords(job.customerAddress, start) } })
  return prisma.task.create({ data: {
    title: `${LOCATE_TASK_PREFIX}${job.customerName}`.slice(0, 200), description: locateTaskWords(job.customerAddress, start),
    jobId, jobName: job.customerName, dueDate: due, priority: 'high', createdBy: 'subcontractors',
  } })
}
const locateTaskWords = (address: string, start: Ymd) => `Call in the Sunshine 811 locate for ${address || 'the job'}: the install starts ${usDate(start)}. Entering the ticket on the job closes this.`

/**
 * The install moved (Schedule, rain day): the 811 task follows and the sub is told. Booked on another crew (Schedule
 * install with Crew 1): the sub is taken off the job, their link stops, and they are told (one crew per job).
 */
export async function afterInstallMoved(accountId: string, jobId: string, start: Ymd, was: Ymd | null, crewId?: string) {
  await ensureLocateTask(accountId, jobId, start)
  const sj = await prisma.subJob.findFirst({ where: { accountId, jobId }, include: { sub: true } })
  if (!sj) return
  if (crewId && crewId !== subCrewId(sj.subId)) {
    if (sj.submittedAt) return
    await tellSub(accountId, { ...sj, linkDisabledAt: new Date() }, `You are off the job at ${await jobAddress(jobId)}`, `The office gave the install at ${await jobAddress(jobId)} to another crew. You are off this job; its link no longer opens.`, 'Taken off: booked on another crew')
    await prisma.subJob.delete({ where: { id: sj.id } })
    const { logScheduleChange } = await import('./jobActivity.js')
    await logScheduleChange(jobId, `Sub ${sj.sub.businessName} taken off: the install was booked on another crew.`, { name: 'Schedule' }).catch(() => {})
    return
  }
  if (!was || was === start) return
  await tellSub(accountId, sj, `Install moved to ${usDate(start)}`, `The install at ${await jobAddress(jobId)} moved from ${usDate(was)} to ${usDate(start)}.`)
}

/** The 811 ticket was entered: the task closes, and the sub is told it is safe to plan the dig. */
export async function afterLocateSaved(accountId: string, jobId: string) {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId }, select: { locateTicket: true, locatesExpDate: true, scheduledDate: true } })
  if (!job?.locateTicket?.trim()) return
  await ensureLocateTask(accountId, jobId, job.scheduledDate)
  const sj = await prisma.subJob.findFirst({ where: { accountId, jobId }, include: { sub: true } })
  if (!sj) return
  const done = ((sj.events as Json[]) ?? []).some(e => e?.what === `811 ticket ${job.locateTicket}`)
  if (done) return
  await tellSub(accountId, sj, '811 ticket is in', `The 811 locate ticket for ${await jobAddress(jobId)} is in: ${job.locateTicket}${job.locatesExpDate ? `, good until ${usDate(job.locatesExpDate)}` : ''}.`, `811 ticket ${job.locateTicket}`)
}

/** A change order was approved or signed: the sub's pay is worked out again and they are told. */
export async function afterChangeOrder(accountId: string, jobId: string, number: number) {
  const r = await refreshPay(accountId, jobId)
  const sj = await prisma.subJob.findFirst({ where: { accountId, jobId }, include: { sub: true } })
  if (!sj || !r) return
  const words = r.changed
    ? `Change order CO-${number} changed the job at ${await jobAddress(jobId)}. Your pay for this job is now ${money(r.after)} (was ${money(r.before)}).`
    : `Change order CO-${number} changed the job at ${await jobAddress(jobId)}. Open your link for the new plan.${sj.payEdited ? ' Your pay was set by hand; the office will check it.' : ''}`
  await tellSub(accountId, sj, `Change order CO-${number}`, words)
}

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
async function jobAddress(jobId: string) {
  return (await prisma.savedJob.findUnique({ where: { id: jobId }, select: { customerAddress: true } }))?.customerAddress || 'the job'
}

async function logJob(jobId: string, text: string, actor: Actor) {
  const { logScheduleChange } = await import('./jobActivity.js')
  await logScheduleChange(jobId, text, { userId: actor.userId, name: actor.name }).catch(() => {})
}

/**
 * Tell the sub: an email, sent at once when they have one, and a text waiting for the owner or office to send
 * from the phone (Jonathan, Nov 6 2026: "No Twilio for subs ... show a 'Text [sub] now' button with the message
 * ready, on the job and on my Subs dashboard, plus a push to me saying it's waiting. Email to subs can still go
 * automatically."). Both are kept on the job's sub record as events; a link is in every email and text so they
 * can open the job. Returns whether the email went.
 */
export async function tellSub(accountId: string, sj: Json, subject: string, body: string, what = subject): Promise<boolean> {
  const sub = sj.sub ?? await prisma.subcontractor.findUnique({ where: { id: sj.subId } })
  const to = String(sub?.email ?? '').trim()
  const event = { at: new Date().toISOString(), what, how: to ? 'email' : 'not sent: no email on file', to }
  const link = sj.linkDisabledAt ? null : linkOf(sj)
  const config = await configOf(accountId)
  const company = String(config?.company?.name || 'Getter Done Fence')
  if (to) {
    const { sendEmail } = await import('./emailService.js')
    const r = await sendEmail({
      to, subject: `${company}: ${subject}`,
      body: `<p>${esc(body)}</p>${link ? `<p><a href="${link}">Open the job</a></p>` : ''}<p>${esc(company)}</p>`,
      text: `${body}\n\n${link ? `Open the job: ${link}\n\n` : ''}${company}`,
    }).catch(e => ({ success: false, error: String(e) }) as Json)
    event.how = r.success ? 'email' : r.held ? 'email (dev outbox, not sent)' : r.notConfigured ? 'not sent: email not set up' : `not sent: ${r.error ?? 'email failed'}`
  }
  const text = subTextEvent(sub, `${company}: ${body}${link ? ` Open the job: ${link}` : ''}`, subject)
  const cur = await prisma.subJob.findUnique({ where: { id: sj.id }, select: { events: true } })
  await prisma.subJob.update({ where: { id: sj.id }, data: { events: [...((cur?.events as Json[]) ?? []), event, ...(text ? [text] : [])] as Json } })
  if (text) await pushTextWaiting(accountId, sj, sub, subject, text.textId)
  return event.how === 'email'
}

/** A text to the sub waiting on the phone: an event with its own id, the words and the number. None without a phone. */
function subTextEvent(sub: Json, words: string, subject: string): Json | null {
  const phone = String(sub?.phone ?? '').trim()
  if (!phone.replace(/\D/g, '')) return null
  return { at: new Date().toISOString(), what: `Text waiting: ${subject}`, how: 'text waiting', to: phone, textId: crypto.randomUUID(), text: words }
}

/** "Text <sub> now": a push to the owner (and admins) that a text is ready on the job and the Subs dashboard. */
async function pushTextWaiting(accountId: string, sj: Json, sub: Json, subject: string, textId: string) {
  const { sendPush } = await import('./automations/push.js')
  await sendPush(accountId, { title: `Text ${sub?.businessName ?? 'the sub'} now`, body: `${subject}. The text is ready on the job: tap Text ${sub?.businessName ?? 'the sub'} now.`, url: `/operations?job=${encodeURIComponent(sj.jobId)}`, tag: `sub-text-${textId}` })
    .catch(e => console.error('[subs] text waiting push:', e))
}

/** The packet link for a newly assigned sub, as a text waiting to send (no email: the office sends the link). */
export async function queuePacketText(accountId: string, sj: Json, start: Ymd): Promise<void> {
  const sub = sj.sub ?? await prisma.subcontractor.findUnique({ where: { id: sj.subId } })
  const config = await configOf(accountId)
  const company = String(config?.company?.name || 'Getter Done Fence')
  const address = await jobAddress(sj.jobId)
  const subject = `Your new job: ${address}`
  const text = subTextEvent(sub, `${company}: You have the install at ${address} starting ${usDate(start)}. Open the job sheet, pull sheet, 811 ticket and your pay: ${linkOf(sj)}`, subject)
  if (!text) return
  const cur = await prisma.subJob.findUnique({ where: { id: sj.id }, select: { events: true } })
  await prisma.subJob.update({ where: { id: sj.id }, data: { events: [...((cur?.events as Json[]) ?? []), text] as Json } })
  await pushTextWaiting(accountId, sj, sub, subject, text.textId)
}

export interface WaitingSubText { subJobId: string; jobId: string; textId: string; at: string; what: string; text: string; phone: string; subName: string; customerName: string }

/** Texts to subs still waiting to be sent from the phone: one job's, or the company's (the Subs dashboard). Newest first. */
export async function waitingSubTexts(accountId: string, jobId?: string): Promise<WaitingSubText[]> {
  const rows = await prisma.subJob.findMany({ where: { accountId, ...(jobId ? { jobId } : {}) }, include: { sub: { select: { businessName: true } } } })
  const jobs = await prisma.savedJob.findMany({ where: { id: { in: rows.map(r => r.jobId) }, deletedAt: null }, select: { id: true, customerName: true } })
  const out: WaitingSubText[] = []
  for (const r of rows) {
    const job = jobs.find(j => j.id === r.jobId)
    if (!job) continue
    for (const e of ((r.events as Json[]) ?? [])) {
      if (e?.how !== 'text waiting' || !e.textId || e.textedAt || e.dismissedAt) continue
      out.push({ subJobId: r.id, jobId: r.jobId, textId: e.textId, at: e.at, what: String(e.what).replace(/^Text waiting: /, ''), text: e.text, phone: e.to, subName: r.sub?.businessName ?? '', customerName: job.customerName ?? '' })
    }
  }
  return out.sort((a, b) => b.at.localeCompare(a.at))
}

/** The text was opened on the phone (texted) or is not needed (dismissed): it leaves the lists. */
export async function markSubText(accountId: string, textId: string, done: 'texted' | 'dismissed', by: string): Promise<boolean> {
  const rows = await prisma.subJob.findMany({ where: { accountId }, select: { id: true, events: true } })
  const row = rows.find(r => ((r.events as Json[]) ?? []).some(e => e?.textId === textId && !e.textedAt && !e.dismissedAt))
  if (!row) return false
  const at = new Date().toISOString()
  const events = ((row.events as Json[]) ?? []).map(e => e?.textId === textId ? { ...e, ...(done === 'texted' ? { textedAt: at } : { dismissedAt: at }), by } : e)
  await prisma.subJob.update({ where: { id: row.id }, data: { events: events as Json } })
  return true
}

const esc = (s: string) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export { bumpBoard }
