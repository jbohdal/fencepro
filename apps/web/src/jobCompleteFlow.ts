/**
 * Job complete → Sales Pipeline.
 *
 * When a job moves to the Complete stage on the Operations board, the card
 * that belongs to that job's quote moves to the pipeline's "Job complete"
 * stage (Settings > Pipeline Stages, by role), and the customer's activity
 * says so. Which card (Jonathan, Oct 20 2026):
 *   - the card whose quote id is the job's quote (cards get the quote id
 *     when they are signed, on the board or by an online accept);
 *   - a card from before that, with no quote id: only when it is the job's
 *     customer's (same customer record as the quote) ONLY card in a "Sold,
 *     work ahead" stage. Several or none: nothing moves.
 * Never a card matched by name, phone or email, never "the most recent", and
 * never a finished card. When nothing moves the customer's activity (and the
 * console) says why, so it can be seen and done by hand.
 *
 * Called from OperationsBoard whenever a job reaches the Complete stage.
 */

import { logCustomerActivity } from './customerStore'
import { fireOpsStageChange } from './automationTrigger'
import { getPipeline, savePipeline, refreshPipelineNow } from './pipelineStore'
import { getPipelineStages, roleId, stageName } from './pipelineStagesStore'
import { cardForCompletedJob } from './pipelineStageModel'
import { getJobs } from './jobStore'
import { getQuoteById } from './quoteStore'
import { businessDate } from './businessDate'

/** Move the card for this job to the Job complete stage. Returns its id, or null (with why in the customer's activity). */
export function movePipelineCardToJobComplete(ctx: { jobId: string; customerId?: string }): string | null {
  const stages = getPipelineStages()
  const target = roleId('complete')
  const job = getJobs().find(j => j.id === ctx.jobId)
  const quote = job?.quoteId ? getQuoteById(job.quoteId) : null
  const leads = getPipeline().leads || []
  const say = (why: string) => {
    console.info(`[job complete] job ${ctx.jobId}: no pipeline card moved: ${why}`)
    const who = quote?.customerId || ctx.customerId
    if (who) logCustomerActivity(who, `Job marked complete; no pipeline card moved: ${why}. Move it by hand if needed.`, { actor: 'operations', kind: 'job' })
  }
  if (!target) { say('no stage is marked "Job complete" in Settings > Pipeline Stages'); return null }
  const pick = cardForCompletedJob({ id: ctx.jobId, quoteId: job?.quoteId, customerId: ctx.customerId }, quote?.customerId ?? null, leads, stages)
  if (!pick.cardId) { say(pick.why); return null }
  const card = leads.find((l: any) => l.id === pick.cardId)
  if (!card || card.stage === target) return card?.id ?? null
  savePipeline(leads.map((l: any) => (l.id === pick.cardId ? { ...l, stage: target, lastMoved: businessDate(new Date()), isCompleted: true, quoteId: l.quoteId || job?.quoteId || undefined, jobId: l.jobId || ctx.jobId } : l)))
  return pick.cardId
}

export interface JobCompletedContext {
  jobId: string
  customerId?: string
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  stageName: string              // e.g. "Complete"
  fromStage?: string
}

/**
 * Full Job complete cascade. Call when a job moves to the Complete stage. The
 * pipeline card is moved by the server when the job is saved (lib/jobTruth.ts
 * cardFollowsJob: Job Complete, or Paid & Closed when paid in full, and only
 * the card of the same sale); this phone reads it again shortly after, so it
 * never saves the pipeline over the server's move (Oct 25 2026: the phone's
 * "Job Complete" landed over the server's "Paid & Closed", with a 409).
 */
export function onJobCompleted(ctx: JobCompletedContext): void {
  setTimeout(() => { void refreshPipelineNow() }, 2500)
  if (ctx.customerId) {
    try { logCustomerActivity(ctx.customerId, `Job marked ${ctx.stageName}`, { actor: 'operations', kind: 'job' }) } catch { /* activity is a nicety */ }
  }
  try {
    fireOpsStageChange(ctx.jobId, ctx.fromStage || '', ctx.stageName, {
      jobName: ctx.customerName, customerName: ctx.customerName,
      customerEmail: ctx.customerEmail, customerPhone: ctx.customerPhone,
    })
  } catch { /* recorded server side */ }
}
