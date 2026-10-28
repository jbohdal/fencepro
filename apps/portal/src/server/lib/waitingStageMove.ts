/**
 * A job waiting in its own Operations stage moves on by itself (Jonathan,
 * Oct 27 2026, docs/DECISIONS.md), the one rule for it:
 *
 *   - the 811 locate becomes Clear to dig (saved, or its good to dig day
 *     arrives: the daily sweep below), or the permit becomes issued (Approved,
 *     Inspection scheduled, Passed) or Not needed: from Awaiting Locates or
 *     Permit Pending;
 *   - the Sales Order is marked Received (lib/materialsFromOrders.ts). Marked
 *     Ordered only records the materials; the card does not move.
 *
 * Where to: the waiting stage its records put it in (opsStageModel
 * waitingStageOf), where the locate counts only when it is Clear to dig (a
 * good to dig day still ahead does not):
 *   no clear locate → Awaiting Locates; permit not issued or not set → Permit
 *   Pending; materials received → Ready to Pull; ordered → Materials Ordered;
 *   else Need Drawing, passed over to the next stage on the board when the
 *   job already has its drawing (jobHasDrawing).
 * A repair whose locate is clear and permit issued or not needed goes to the
 * stage that stands for ready to schedule (readyStageOf).
 *
 * Only forward, only from the job's own staging stage on the board, never when
 * a stage rule refuses. Only when the thing that moves it changes (the
 * callers check that), never on every save or sweep pass: a job the office
 * drags back stays there. Each move leaves a line in the job's history.
 *
 * Review Oct 27 2026: a signed job stayed in Awaiting Locates after the office
 * entered its 811 ticket (Clear to dig) and an Approved permit.
 */

import prisma from './prisma.js'
import { auditSystem } from './auditLog.js'
import { recordJobChanges } from './automations/hooks.js'
import { checkJobMove } from './automations/stageRules.js'
import { floridaDay } from './automations/context.js'
import { loadOpsStages } from './opsStages.js'
import { permitStatusOf } from './permitStatus.js'
import { installWord } from './workWords.js'
import { locateOf, locateStatus } from './locates.js'
import { boardStages, nextStage, permitIsOk, phaseOf, sortedStages, stageById, stageOfJob, waitingStageOf, type OpsStageDef } from './opsStageModel.js'

type Json = any

/** What, besides the job row, decides where it goes. */
export interface MoveFacts { permit: string | null; repair: boolean; drawing: boolean; today: string }

/** Kept in ActivityLog metadata.kind for a move made by itself (the job's history). */
export const AUTO_MOVE_KIND = 'ops.auto_move'

/** The stages that wait on the 811 locate and the permit. */
export const LOCATE_PERMIT_STAGES = ['awaiting_locates', 'permit_pending']

/** The locate is Clear to dig on `today` (not just a date entered). */
export const locateClear = (job: Json, today: string) => locateStatus(locateOf(job), today) === 'clear'

/**
 * The job has its drawing: marked drawn, or its quote has a yard drawn in the
 * quote builder or the customer's own drawing from the website (the same test
 * as web jobDrawing.ts hasDrawing, Smart Schedule's Need Drawing tag).
 */
export function jobHasDrawing(job: { drawingComplete?: boolean | null }, quote: { layout?: unknown } | null | undefined): boolean {
  const layout = quote?.layout as { yard?: unknown; widgetDrawing?: unknown } | null | undefined
  return !!job.drawingComplete || !!layout?.yard || !!layout?.widgetDrawing
}

/** The stage that stands for ready to schedule: one named so, else the last board stage before the scheduled ones (Ready to Pull). */
export function readyStageOf(stages: OpsStageDef[]): string | null {
  const cols = boardStages(stages)
  const named = cols.find(s => s.name.trim().toLowerCase() === 'ready to schedule')
  if (named) return named.id
  const waiting = cols.filter(s => phaseOf(stages, s.id) === 'staging')
  return waiting[waiting.length - 1]?.id ?? null
}

/** Where the job's records put it (see the top of the file), or null. */
export function autoStageOf(stages: OpsStageDef[], job: Json, f: MoveFacts): string | null {
  const clear = locateClear(job, f.today)
  if (f.repair && clear && permitIsOk(f.permit)) return readyStageOf(stages)
  let w = waitingStageOf(stages, { locatesDate: clear ? job.locatesDate : null, materialsStatus: job.materialsStatus }, f.permit)
  if (w === 'need_drawing' && (f.drawing || f.repair)) {
    const n = nextStage(stages, w)
    w = n && phaseOf(stages, n.id) === 'staging' ? n.id : null
  }
  return w
}

/** The facts for a job: its permit, whether it is a repair, whether it has its drawing, today. */
export async function moveFactsOf(accountId: string, job: Json, now = new Date()): Promise<MoveFacts> {
  const [permit, quote] = await Promise.all([
    permitStatusOf(accountId, job),
    job.quoteId ? prisma.savedQuote.findUnique({ where: { id: job.quoteId }, select: { work: true, layout: true } }) : null,
  ])
  return { permit, repair: installWord(quote?.work as { type?: unknown } | null) === 'Repair', drawing: jobHasDrawing(job, quote), today: floridaDay(now) }
}

/**
 * The stage a job moves on to when `after` is saved, or null (it stays).
 * `from`: only from these stages; `to`: only to these.
 */
export async function waitingStageMove(
  accountId: string, stages: OpsStageDef[], job: Json, after: Json, facts: MoveFacts,
  opts: { from?: string[]; to?: string[] } = {},
): Promise<string | null> {
  const was = stageOfJob(stages, job)
  if (!job.opsStage || !stageById(stages, job.opsStage)) return null
  if (job.status !== 'staging' || phaseOf(stages, was) !== 'staging' || stageById(stages, was)?.lane !== 'main') return null
  if (opts.from && !opts.from.includes(was)) return null
  const w = autoStageOf(stages, after, facts)
  if (!w || (opts.to && !opts.to.includes(w))) return null
  const order = sortedStages(stages).map(s => s.id)
  if (order.indexOf(w) <= order.indexOf(was)) return null
  const blocked = await checkJobMove(accountId, job, { ...after, opsStage: w })
  return blocked ? null : w
}

/** "Moved to Permit Pending by itself: 811 locate is clear to dig." */
export const autoMoveWords = (stages: OpsStageDef[], to: string, reason: string) => `Moved to ${stageById(stages, to)?.name ?? to} by itself: ${reason}.`

/** Keep the move in the job's history (the job window's Job history and the customer's Activity). */
export async function noteAutoMove(jobId: string, stages: OpsStageDef[], to: string, reason: string, db: Json = prisma): Promise<void> {
  await db.activityLog.create({ data: { entityType: 'job', entityId: jobId, actor: 'system', body: autoMoveWords(stages, to, reason), metadata: { kind: AUTO_MOVE_KIND, to } } })
}

const PERMIT_WORDS: Record<string, string> = { not_needed: 'Not needed', approved: 'Approved', inspection_scheduled: 'Inspection scheduled', passed: 'Passed' }
export const permitReason = (status: string | null) => `permit is ${PERMIT_WORDS[status ?? ''] ?? status}`
export const LOCATE_REASON = '811 locate is clear to dig'

/**
 * The locate became Clear to dig or the permit became issued or not needed
 * (the caller checked that it changed): a job in Awaiting Locates or Permit
 * Pending moves on (waitingStageMove). Only the stage changes; the materials
 * and drawing stay as recorded. Saved like any job save, only while the job is
 * still in the stage it was read in, with a line in its history. The row
 * after, or null when it did not move. Never throws.
 */
export async function stageFollowsLocateAndPermit(accountId: string, jobId: string, reason: string, by: string, now = new Date()): Promise<Json | null> {
  try {
    const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null, archivedAt: null } })
    if (!job) return null
    const { stages } = await loadOpsStages(accountId)
    const facts = await moveFactsOf(accountId, job, now)
    const w = await waitingStageMove(accountId, stages, job, job, facts, { from: LOCATE_PERMIT_STAGES })
    if (!w) return null
    const was = stageOfJob(stages, job as Json)
    const row = await prisma.$transaction(async tx => {
      const d = await tx.savedJob.updateMany({ where: { id: jobId, opsStage: job.opsStage, status: 'staging' }, data: { opsStage: w } })
      if (!d.count) return null
      const r = await tx.savedJob.findUniqueOrThrow({ where: { id: jobId } })
      await recordJobChanges(accountId, job, r, tx)
      await noteAutoMove(jobId, stages, w, reason, tx)
      return r
    })
    if (!row) return null
    await auditSystem('update', 'SavedJob', jobId, { oldValues: { opsStage: job.opsStage }, newValues: { opsStage: w, from: was, why: reason, by } })
    return row
  } catch (e) {
    console.error('[stage follows locate and permit]:', e)
    return null
  }
}

/** The last Florida day the locate sweep looked at, per company. Server only (routes/kv.ts). */
export const LOCATE_SWEEP_KEY = 'ops_locate_clear_day'

const dayBefore = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)

/**
 * The daily part: a locate whose good to dig day arrived since the last pass
 * (it was "Called", now Clear to dig) moves its job on, once. Each company
 * keeps the last day looked at, so a job is looked at only on the pass that
 * first sees its day arrive (a day the server was off is caught up next pass);
 * a job dragged back later is never pushed again. A locate saved on or after
 * its good to dig day was clear when saved: that save was its change. Run by the automation
 * worker's sweeps (lib/automations/queue.ts). The jobs moved.
 */
export async function locatesClearSweep(now = new Date(), onlyAccount?: string): Promise<Array<{ jobId: string; to: string }>> {
  const today = floridaDay(now)
  const out: Array<{ jobId: string; to: string }> = []
  const accounts = onlyAccount ? [{ id: onlyAccount }] : await prisma.crmAccount.findMany({ select: { id: true } })
  for (const { id: accountId } of accounts) {
    const kv = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: LOCATE_SWEEP_KEY } } })
    const stored = typeof (kv?.value as Json)?.day === 'string' ? (kv!.value as Json).day as string : null
    // First pass, or a day ahead of today (a pretend clock): only today's.
    const last = stored && stored < today ? stored : stored === today ? today : dayBefore(today)
    if (last < today) {
      const jobs = await prisma.savedJob.findMany({
        where: { accountId, deletedAt: null, archivedAt: null, status: 'staging', opsStage: { in: LOCATE_PERMIT_STAGES }, locatesDate: { gt: last, lte: today } },
      })
      for (const j of jobs) {
        if (!locateClear(j, today)) continue
        // Saved on or after its good to dig day: it was clear when saved, and that save moved it (or not) already.
        if (j.locateUpdatedAt && floridaDay(j.locateUpdatedAt) >= String(j.locatesDate)) continue
        const row = await stageFollowsLocateAndPermit(accountId, j.id, LOCATE_REASON, 'Daily check (811 good to dig day)', now)
        if (row) out.push({ jobId: j.id, to: row.opsStage })
      }
    }
    if (stored !== today) {
      await prisma.accountKeyValue.upsert({
        where: { accountId_key: { accountId, key: LOCATE_SWEEP_KEY } },
        create: { accountId, key: LOCATE_SWEEP_KEY, value: { day: today } },
        update: { value: { day: today }, version: { increment: 1 } },
      })
    }
  }
  return out
}
