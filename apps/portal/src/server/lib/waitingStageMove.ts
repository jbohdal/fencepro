/**
 * A job waiting in its own Operations stage moves on once its records say it
 * is further along: the one rule for that, used when a Sales Order is marked
 * Ordered or Received (lib/materialsFromOrders.ts) and when the 811 locate or
 * the permit is saved (stageFollowsLocateAndPermit below).
 *
 * The stage it moves to is the waiting stage its records put it in
 * (opsStageModel.waitingStageOf: no 811 → Awaiting Locates; permit not issued
 * or not set → Permit Pending; materials received → Ready to Pull; ordered →
 * Materials Ordered; else Need Drawing). It moves only:
 *   - when it has its own stage, in the staging stages on the board (never a
 *     side lane, a booked, started or finished job);
 *   - forward on the board, never back;
 *   - when a stage rule (Settings > Stage Rules) does not refuse the move.
 *
 * Review Oct 27 2026: a signed job stayed in Awaiting Locates after the office
 * entered its 811 ticket (Clear to dig) and an Approved permit; it moved only
 * when its Sales Order was marked Ordered.
 */

import prisma from './prisma.js'
import { auditSystem } from './auditLog.js'
import { recordJobChanges } from './automations/hooks.js'
import { checkJobMove } from './automations/stageRules.js'
import { loadOpsStages } from './opsStages.js'
import { permitStatusOf } from './permitStatus.js'
import { installWord } from './workWords.js'
import { phaseOf, sortedStages, stageById, stageOfJob, waitingStageOf, type OpsStageDef } from './opsStageModel.js'

type Json = any

/**
 * The waiting stage a job moves on to when `after` is saved, or null (it stays).
 * `from`: only from these stages; `to`: only to these.
 */
export async function waitingStageMove(
  accountId: string, stages: OpsStageDef[], job: Json, after: Json, permitStatus: string | null,
  opts: { from?: string[]; to?: string[] } = {},
): Promise<string | null> {
  const was = stageOfJob(stages, job)
  if (!job.opsStage || !stageById(stages, job.opsStage)) return null
  if (job.status !== 'staging' || phaseOf(stages, was) !== 'staging' || stageById(stages, was)?.lane !== 'main') return null
  if (opts.from && !opts.from.includes(was)) return null
  const w = waitingStageOf(stages, after, permitStatus)
  if (!w || (opts.to && !opts.to.includes(w))) return null
  const order = sortedStages(stages).map(s => s.id)
  if (order.indexOf(w) <= order.indexOf(was)) return null
  const blocked = await checkJobMove(accountId, job, { ...after, opsStage: w })
  return blocked ? null : w
}

/** The stages that wait on the 811 locate and the permit: a job leaves them by itself, never any other. */
export const LOCATE_PERMIT_STAGES = ['awaiting_locates', 'permit_pending']

/**
 * After the 811 locate or the permit is saved: a job in Awaiting Locates or
 * Permit Pending moves on to the waiting stage its records put it in
 * (waitingStageMove). A repair is not moved into Need Drawing (a repair has no
 * drawing to make; Advance passes it over too): it stays where it is. Only the
 * stage changes: the materials and the drawing stay as recorded. Saved like any
 * job save (updatedAt moves, stage moves and automation events recorded, audit
 * log), only while the job is still in the stage it was read in. The row
 * after, or null when it did not move. Never throws: the locate or permit is
 * saved either way.
 */
export async function stageFollowsLocateAndPermit(accountId: string, jobId: string, by: string): Promise<Json | null> {
  try {
    const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null, archivedAt: null } })
    if (!job) return null
    const { stages } = await loadOpsStages(accountId)
    const permit = await permitStatusOf(accountId, job)
    const quote = job.quoteId ? await prisma.savedQuote.findUnique({ where: { id: job.quoteId }, select: { work: true } }) : null
    const repair = installWord(quote?.work as { type?: unknown } | null) === 'Repair'
    const to = sortedStages(stages).map(s => s.id).filter(id => !(repair && id === 'need_drawing'))
    const w = await waitingStageMove(accountId, stages, job, job, permit, { from: LOCATE_PERMIT_STAGES, to })
    if (!w) return null
    const was = stageOfJob(stages, job as Json)
    const row = await prisma.$transaction(async tx => {
      const d = await tx.savedJob.updateMany({ where: { id: jobId, opsStage: job.opsStage, status: 'staging' }, data: { opsStage: w } })
      if (!d.count) return null
      const r = await tx.savedJob.findUniqueOrThrow({ where: { id: jobId } })
      await recordJobChanges(accountId, job, r, tx)
      return r
    })
    if (!row) return null
    await auditSystem('update', 'SavedJob', jobId, { oldValues: { opsStage: job.opsStage }, newValues: { opsStage: w, from: was, by } })
    return row
  } catch (e) {
    console.error('[stage follows locate and permit]:', e)
    return null
  }
}
