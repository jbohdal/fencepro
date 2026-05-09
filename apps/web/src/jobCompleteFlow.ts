/**
 * Job Complete → Sales Pipeline back-flow.
 *
 * When a job moves to a completion stage on the Ops board, this module:
 *   - Ensures a `Job Complete` stage exists in the pipeline (auto-creates).
 *   - Moves the pipeline card for that customer to `Job Complete`.
 *   - Logs an activity entry on the customer.
 *   - Fires the automation engine job_stage_changed event.
 *
 * Called from OperationsPage whenever the target stage is a completion stage.
 */

import { logCustomerActivity } from './customerStore'
import { fireOpsStageChange, fireTrigger } from './automationTrigger'
import { getPipeline, savePipeline as storeSavePipeline } from './pipelineStore'

const CONFIG_KEY = 'fencepro_config'
const JOB_COMPLETE_STAGE = 'Job Complete'

function loadPipeline(): { leads: any[]; stages: string[] } {
  const cached = getPipeline()
  return { leads: cached.leads || [], stages: (cached.stages as string[]) || [] }
}

function savePipeline(data: { leads: any[]; stages: string[] }) {
  storeSavePipeline(data.leads, data.stages)
}

/** Ensures a Job Complete stage is present in the pipeline config + pipeline board. */
export function ensureJobCompleteStage(): void {
  // 1. Pipeline's own stages (fencepro_pipeline.stages)
  const pipe = loadPipeline()
  if (!pipe.stages.includes(JOB_COMPLETE_STAGE)) {
    // Insert right after Signed Contract if present, else at end (before Lost Sale/No Answer)
    const signedIdx = pipe.stages.findIndex(s => s.trim().toLowerCase() === 'signed contract')
    const newStages = [...pipe.stages]
    if (signedIdx >= 0) newStages.splice(signedIdx + 1, 0, JOB_COMPLETE_STAGE)
    else {
      // place before any Lost/Dead stages
      const deadIdx = newStages.findIndex(s => /lost|no answer/i.test(s))
      if (deadIdx >= 0) newStages.splice(deadIdx, 0, JOB_COMPLETE_STAGE)
      else newStages.push(JOB_COMPLETE_STAGE)
    }
    savePipeline({ ...pipe, stages: newStages })
  }
  // 2. Config's pipelineStages (fencepro_config.pipelineStages)
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (raw) {
      const cfg = JSON.parse(raw)
      if (Array.isArray(cfg.pipelineStages) && !cfg.pipelineStages.includes(JOB_COMPLETE_STAGE)) {
        const signedIdx = cfg.pipelineStages.findIndex((s: string) => s.trim().toLowerCase() === 'signed contract')
        if (signedIdx >= 0) cfg.pipelineStages.splice(signedIdx + 1, 0, JOB_COMPLETE_STAGE)
        else cfg.pipelineStages.push(JOB_COMPLETE_STAGE)
        localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
        try { window.dispatchEvent(new CustomEvent('fencepro:settings:updated', { detail: cfg })) } catch {}
      }
    }
  } catch {}
}

/** Move this customer's pipeline card to Job Complete (if we can find it). */
export function movePipelineCardToJobComplete(match: { customerId?: string; customerName?: string; customerPhone?: string; customerEmail?: string }): void {
  ensureJobCompleteStage()
  const pipe = loadPipeline()
  const name = (match.customerName || '').trim().toLowerCase()
  const phone = (match.customerPhone || '').replace(/\D/g, '')
  const email = (match.customerEmail || '').toLowerCase()

  let changed = false
  const updated = pipe.leads.map((l: any) => {
    const matches =
      (match.customerId && l.customerId === match.customerId) ||
      (name && `${l.firstName || ''} ${l.lastName || ''}`.trim().toLowerCase() === name) ||
      (phone && (l.phone || '').replace(/\D/g, '') === phone) ||
      (email && (l.email || '').toLowerCase() === email)
    if (matches && l.stage !== JOB_COMPLETE_STAGE) {
      changed = true
      return { ...l, stage: JOB_COMPLETE_STAGE, lastMoved: new Date().toISOString().slice(0, 10), isCompleted: true }
    }
    return l
  })
  if (changed) savePipeline({ leads: updated, stages: pipe.stages })
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

/** Full Job Complete cascade. Call when a job moves to a completion stage. */
export function onJobCompleted(ctx: JobCompletedContext): void {
  try {
    movePipelineCardToJobComplete(ctx)
  } catch {}

  if (ctx.customerId) {
    try {
      logCustomerActivity(ctx.customerId,
        `Job marked ${ctx.stageName} — returned to sales pipeline as ${JOB_COMPLETE_STAGE}`,
        { actor: 'operations', kind: 'job' })
    } catch {}
  }

  // Fire automation: job_stage_changed + a synthetic pipeline move so configured
  // automations (e.g. send thank-you email) also run.
  try {
    fireOpsStageChange(ctx.jobId, ctx.fromStage || '', ctx.stageName, {
      jobName: ctx.customerName, customerName: ctx.customerName,
      customerEmail: ctx.customerEmail, customerPhone: ctx.customerPhone,
    })
    fireTrigger('sales_stage_change', {
      jobId: ctx.customerId || ctx.jobId,
      fromStage: 'Signed Contract', toStage: JOB_COMPLETE_STAGE,
      customerName: ctx.customerName,
      customerEmail: ctx.customerEmail, customerPhone: ctx.customerPhone,
    })
  } catch {}
}
