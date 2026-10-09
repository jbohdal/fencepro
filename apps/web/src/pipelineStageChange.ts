/**
 * Change a pipeline card's stage from outside the board (the customer page
 * header). Does what the board does on a move: saves the pipeline, runs the
 * sold cascade on Signed Contract, and fires the stage change automation.
 */

import { loadPipeline, savePipeline } from './JobsPage'
import { fireSalesStageChange } from './automationTrigger'
import { applySignedContractTransition } from './signedContractFlow'
import { toast } from './toast'

export type StageChangeResult = 'moved' | 'sold' | 'cancelled' | 'unchanged' | 'missing'

export function changeLeadStage(leadId: string, toStage: string): StageChangeResult {
  const { leads, stages } = loadPipeline()
  const lead = leads.find(l => l.id === leadId)
  if (!lead) return 'missing'
  if (lead.stage === toStage) return 'unchanged'
  const name = `${lead.firstName} ${lead.lastName}`.trim()
  const toSold = toStage === 'Signed Contract'
  // The board asks before this move too: it marks a quote sold and creates a job.
  if (toSold && !window.confirm(`Mark this deal as sold? This moves ${name} to Signed Contract and creates a job on the Operations board.`)) {
    return 'cancelled'
  }

  const fromStage = lead.stage
  const today = new Date().toISOString().slice(0, 10)
  savePipeline(leads.map(l => l.id === leadId ? { ...l, stage: toStage, lastMoved: today } : l), stages)
  try {
    if (toSold) {
      const result = applySignedContractTransition({
        id: lead.id, customerId: lead.customerId,
        firstName: lead.firstName, lastName: lead.lastName,
        phone: lead.phone, email: lead.email, address: lead.address,
        stage: toStage, fromStage,
      })
      if (result) toast.success('Deal closed — job created', `${result.job.customerName} · quote marked SOLD · job on Operations board`)
      else toast.info('Moved to Signed Contract', 'No quote linked yet — create a quote, then move the card again to create a job.')
    }
    fireSalesStageChange(lead.id, fromStage, toStage, {
      jobName: name, jobAddress: lead.address, customerName: name,
      customerEmail: lead.email, customerPhone: lead.phone,
      fenceType: lead.fenceType, quotePrice: lead.quotePrice,
    })
  } catch { /* the move itself is saved; automations report their own errors */ }
  return toSold ? 'sold' : 'moved'
}
