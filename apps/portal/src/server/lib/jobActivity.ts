/**
 * A customer's jobs in their Activity (walkthrough recheck, Oct 27 2026: the
 * customer page's Activity had calls, notes, quotes and change orders but no
 * payment, schedule, install or walkthrough). Read from where each is kept:
 *
 *   payments      ContractPayment (recorded, voided; the method and check number)
 *   scheduling    ActivityLog rows written when an install is booked, moved,
 *                 taken off or moved by a rain day (logScheduleChange below).
 *                 A job booked before those rows were written: its move into a
 *                 Scheduled stage (AutomationEvent card_entered), with its dates.
 *   install       ActivityLog Start and Finish taps (lib/crewInstall.ts), and a
 *                 Start before 811 was clear
 *   walkthrough   Walkthrough (started, both signatures in, completed)
 *
 * Folded into lib/followUps.ts customerHistory. A login that does not see
 * prices gets the payment lines without the amount.
 */

import prisma from './prisma.js'
import { loadOpsStages } from './opsStages.js'
import { phaseOf, stageById } from './opsStageModel.js'
import type { HistoryItem } from './followUps.js'

type Db = typeof prisma

/** Kept in ActivityLog metadata.kind for a schedule change. */
export const SCHEDULE_KIND = 'install.schedule'

const METHOD_WORDS: Record<string, string> = { check: 'check', cash: 'cash', zelle: 'Zelle', card: 'card', other: 'other' }
const usd = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const isYmd = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

/** "Tue, Oct 27" for a YYYY-MM-DD day. */
export function dayWords(ymd: string): string {
  if (!isYmd(ymd)) return ''
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' })
}

/** "Tue, Oct 27" or "Tue, Oct 27 to Wed, Oct 28". */
export function daysWords(start: string, end?: string | null): string {
  if (!isYmd(start)) return ''
  return end && isYmd(end) && end !== start ? `${dayWords(start)} to ${dayWords(end)}` : dayWords(start)
}

/** The words of a schedule change, as kept in ActivityLog and shown in Activity. */
export function scheduleWords(kind: 'scheduled' | 'moved' | 'off' | 'rain', o: { start?: string; end?: string | null; crew?: string; was?: string }): string {
  const crew = o.crew ? `, ${o.crew}` : ''
  if (kind === 'off') return `Install taken off the schedule${o.was ? ` (was ${dayWords(o.was)})` : ''}`
  if (kind === 'rain') return `Rain day: install moved${o.was ? ` from ${dayWords(o.was)}` : ''} to ${daysWords(o.start ?? '', o.end)}`
  if (kind === 'moved') return `Install moved to ${daysWords(o.start ?? '', o.end)}${crew}${o.was ? ` (was ${dayWords(o.was)})` : ''}`
  return `Install scheduled for ${daysWords(o.start ?? '', o.end)}${crew}`
}

/** A login's name by its id ('' when unknown). */
async function nameOf(userId: string | null | undefined, db: Db = prisma): Promise<string> {
  if (!userId) return ''
  const u = await db.crmUser.findFirst({ where: { id: userId }, select: { firstName: true, lastName: true } }).catch(() => null)
  return u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.replace(/\s+/g, ' ').trim() : ''
}

/** Keep a schedule change on the job's activity. Never blocks the change itself. */
export async function logScheduleChange(jobId: string, body: string, by: { userId?: string | null; name?: string }, db: Db = prisma): Promise<void> {
  try {
    const actor = by.name || (await nameOf(by.userId, db)) || 'Office'
    await db.activityLog.create({ data: { entityType: 'job', entityId: jobId, actor, body, metadata: { kind: SCHEDULE_KIND } } })
  } catch (e) {
    console.error(`[jobActivity] could not keep the schedule change on job ${jobId}: ${(e as Error).message}`)
  }
}

/** The Activity lines of a customer's jobs (their own jobs, and the jobs of their quotes). */
export async function jobActivityItems(accountId: string, customerId: string, quoteIds: string[], opts: { prices: boolean }): Promise<HistoryItem[]> {
  const jobs = await prisma.savedJob.findMany({
    where: { accountId, deletedAt: null, OR: [{ crmContactId: customerId }, ...(quoteIds.length ? [{ quoteId: { in: quoteIds } }] : [])] },
    select: { id: true, scheduledDate: true, scheduledEndDate: true, crewAssigned: true },
  })
  const jobIds = jobs.map(j => j.id)
  const items: HistoryItem[] = []

  const [payments, logs, walks, events] = await Promise.all([
    prisma.contractPayment.findMany({ where: { accountId, OR: [{ crmContactId: customerId }, ...(jobIds.length ? [{ jobId: { in: jobIds } }] : [])] }, orderBy: { createdAt: 'desc' }, take: 200 }),
    jobIds.length ? prisma.activityLog.findMany({ where: { entityType: 'job', entityId: { in: jobIds } }, orderBy: { createdAt: 'desc' }, take: 300 }) : Promise.resolve([]),
    jobIds.length ? prisma.walkthrough.findMany({ where: { accountId, jobId: { in: jobIds } }, select: { createdAt: true, startedBy: true, signedAt: true, homeownerSig: true, repSig: true, completedAt: true, completedBy: true } }) : Promise.resolve([]),
    jobIds.length ? prisma.automationEvent.findMany({ where: { accountId, type: 'card_entered', board: 'ops', entityKind: 'job', entityId: { in: jobIds } }, orderBy: { occurredAt: 'asc' }, select: { entityId: true, data: true, occurredAt: true } }) : Promise.resolve([]),
  ])

  // ── Payments ──
  for (const p of payments) {
    const how = `${METHOD_WORDS[p.method] ?? p.method}${p.method === 'check' && p.checkNumber ? ` #${p.checkNumber}` : ''}`
    const paidDay = isYmd(p.paidOn) && p.paidOn !== p.createdAt.toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) ? `Paid on ${dayWords(p.paidOn)}.` : ''
    const confirm = p.needsConfirm && !p.confirmedAt ? 'Waiting for the office to confirm it.' : ''
    items.push({
      at: p.createdAt.toISOString(), kind: 'payment',
      title: opts.prices ? `Payment received: ${usd(p.amountCents)} by ${how}` : `Payment received by ${how}`,
      detail: [paidDay, confirm, p.note].filter(Boolean).join(' '), by: p.recordedBy || '',
    })
    if (p.voidedAt) items.push({ at: p.voidedAt.toISOString(), kind: 'payment', title: opts.prices ? `Payment voided: ${usd(p.amountCents)} by ${how}` : `Payment voided (${how})`, detail: p.voidReason ? `${p.voidReason}` : '', by: p.voidedBy || '' })
  }

  // ── Schedule changes, install Start and Finish, and anything else kept on the job ──
  const scheduledByLog = new Set<string>()
  for (const l of logs) {
    const kind = String((l.metadata as any)?.kind ?? '')
    const k = kind === SCHEDULE_KIND ? 'schedule' : kind.startsWith('install.') || /^Install (started|finished)/.test(l.body) ? 'install' : 'job'
    if (k === 'schedule') scheduledByLog.add(l.entityId)
    items.push({ at: l.createdAt.toISOString(), kind: k, title: l.body, detail: '', by: l.actor === 'system' ? '' : l.actor })
  }

  // A job booked before schedule changes were kept: its move into a Scheduled stage, with the dates it has.
  if (events.length) {
    const { stages } = await loadOpsStages(accountId)
    for (const j of jobs) {
      if (scheduledByLog.has(j.id) || !isYmd(j.scheduledDate)) continue
      const e = events.find(x => x.entityId === j.id && phaseOf(stages, String((x.data as any)?.to ?? (x.data as any)?.stage ?? '')) === 'scheduled')
      if (!e) continue
      const stage = stageById(stages, String((e.data as any)?.to ?? ''))?.name
      items.push({ at: e.occurredAt.toISOString(), kind: 'schedule', title: scheduleWords('scheduled', { start: j.scheduledDate, end: j.scheduledEndDate, crew: j.crewAssigned }), detail: stage ? `Moved to ${stage}.` : '', by: '' })
    }
  }

  // ── Final walkthrough ──
  const sigName = (s: unknown) => (s && typeof s === 'object' && typeof (s as any).name === 'string' ? String((s as any).name) : '')
  for (const w of walks) {
    items.push({ at: w.createdAt.toISOString(), kind: 'walkthrough', title: 'Final walkthrough started', detail: '', by: w.startedBy || '' })
    if (w.signedAt) {
      const home = sigName(w.homeownerSig), rep = sigName(w.repSig)
      items.push({ at: w.signedAt.toISOString(), kind: 'walkthrough', title: 'Final walkthrough signed', detail: [home ? `Homeowner: ${home}.` : '', rep ? `For us: ${rep}.` : ''].filter(Boolean).join(' '), by: '' })
    }
    if (w.completedAt) items.push({ at: w.completedAt.toISOString(), kind: 'walkthrough', title: 'Final walkthrough completed', detail: '', by: w.completedBy || '' })
  }
  return items
}
