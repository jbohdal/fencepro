/**
 * Change a pipeline card's stage from outside the board (the customer page
 * header). Does what the board does on a move: saves the pipeline, runs the
 * sold cascade on the Signed stage, and fires the stage change automation.
 */

import { stageHasRole, stageName } from './pipelineStagesStore'
import { loadPipeline, savePipeline } from './JobsPage'
import { fireSalesStageChange } from './automationTrigger'
import { applySignedContractTransition } from './signedContractFlow'
import { toast } from './toast'
import { businessDate } from './businessDate'

export type StageChangeResult = 'moved' | 'sold' | 'cancelled' | 'unchanged' | 'missing'

export function changeLeadStage(leadId: string, toStage: string): StageChangeResult {
  const { leads } = loadPipeline()
  const lead = leads.find(l => l.id === leadId)
  if (!lead) return 'missing'
  if (lead.stage === toStage) return 'unchanged'
  const name = `${lead.firstName} ${lead.lastName}`.trim()
  const toSold = stageHasRole(toStage, 'signed')
  // The board asks before this move too: it marks a quote sold and creates a job.
  if (toSold && !window.confirm(`Mark this deal as sold? This moves ${name} to ${stageName(toStage)} and creates a job on the Operations board.`)) {
    return 'cancelled'
  }

  const fromStage = lead.stage
  const today = businessDate(new Date())
  savePipeline(leads.map(l => l.id === leadId ? { ...l, stage: toStage, lastMoved: today } : l))
  try {
    if (toSold) {
      const result = applySignedContractTransition({
        id: lead.id, customerId: lead.customerId,
        firstName: lead.firstName, lastName: lead.lastName,
        phone: lead.phone, email: lead.email, address: lead.address,
        stage: toStage, fromStage,
      })
      if (result) toast.success('Deal closed — job created', `${result.job.customerName} · quote marked SOLD · job on Operations board`)
      else toast.info(`Moved to ${stageName(toStage)}`, 'No quote linked yet — create a quote, then move the card again to create a job.')
    }
    fireSalesStageChange(lead.id, fromStage, toStage, {
      jobName: name, jobAddress: lead.address, customerName: name,
      customerEmail: lead.email, customerPhone: lead.phone,
      fenceType: lead.fenceType, quotePrice: lead.quotePrice,
    })
  } catch { /* the move itself is saved; automations report their own errors */ }
  return toSold ? 'sold' : 'moved'
}
