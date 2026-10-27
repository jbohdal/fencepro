/**
 * What appointments do to the customer's pipeline card.
 *
 *   - Booking an Estimate moves a card that is still before the Appointment stage to it.
 *   - "Ready to quote" moves it to the Ready to quote stage; "Not interested" offers the Lost stage.
 *   - A quote saved from the visit moves it to the Ready to quote stage too.
 *   (The stages by role, from Settings > Pipeline Stages.)
 *
 * The rules are in appointmentLogic (stageAfterBooking, stageAfterOutcome);
 * this applies them to the pipeline, through the same save and automations
 * as dragging the card by hand.
 */

import { getPipelineStages, stageName } from './pipelineStagesStore'
import { cardInPlay } from './pipelineStageModel'
import { getPipeline, savePipeline } from './pipelineStore'
import { fireSalesStageChange } from './automationTrigger'
import { stageAfterBooking, stageAfterOutcome, type Appointment, type AppointmentOutcome } from './appointmentLogic'
import { toast } from './toast'
import { businessDate } from './businessDate'

/** The customer's card in play: an open one (not in a finished stage; most recently moved), else their most recent card. */
export function cardFor(customerId: string): { id: string; stage: string; firstName: string; lastName: string } | null {
  return cardInPlay(getPipelineStages(), (getPipeline().leads || []).filter((l: any) => l?.customerId === customerId))
}

export function moveCard(customerId: string, toStage: string): boolean {
  const { leads } = getPipeline()
  const pick = cardFor(customerId)
  const card = pick && (leads || []).find((l: any) => l?.id === pick.id)
  if (!card || card.stage === toStage) return false
  const from = card.stage
  savePipeline(leads.map((l: any) => (l === card ? { ...l, stage: toStage, lastMoved: businessDate(new Date()) } : l)))
  try {
    fireSalesStageChange(card.id, from, toStage, {
      jobName: `${card.firstName} ${card.lastName}`.trim(), jobAddress: card.address,
      customerName: `${card.firstName} ${card.lastName}`.trim(), customerEmail: card.email, customerPhone: card.phone,
    })
  } catch { /* the card moved; an automation hiccup does not undo it */ }
  return true
}

/** After booking: move the card along when the rules say so. Returns the stage it moved to. */
export function applyBooking(a: Pick<Appointment, 'crmContactId' | 'type'>): string | null {
  const card = cardFor(a.crmContactId)
  const to = stageAfterBooking(card?.stage, a.type, getPipelineStages())
  if (to && moveCard(a.crmContactId, to)) { toast.info('Pipeline updated', `Card moved to ${stageName(to)}.`); return to }
  return null
}

/** After an outcome: move the card, or ask first when it is a step back (the Lost stage). */
export function applyOutcome(a: Pick<Appointment, 'crmContactId' | 'customerName'>, outcome: AppointmentOutcome): string | null {
  const card = cardFor(a.crmContactId)
  const r = stageAfterOutcome(card?.stage, outcome, getPipelineStages())
  if (r.move && moveCard(a.crmContactId, r.move)) { toast.info('Pipeline updated', `Card moved to ${stageName(r.move)}.`); return r.move }
  if (r.offer && window.confirm(`Move ${a.customerName || 'this customer'} to ${stageName(r.offer)} in the pipeline?`) && moveCard(a.crmContactId, r.offer)) return r.offer
  return null
}

/**
 * A quote saved from the visit (Today's "Save and start the quote", or New quote on the card at the
 * appointment): the card moves on as "Ready to quote" does, to the Ready to quote stage (Settings >
 * Pipeline Stages, by role; Estimating to start) when it is still before it. Audit Oct 26 2026: it
 * stayed in Appointment. Returns the stage it moved to.
 */
export function applyQuoteSaved(customerId: string): string | null {
  const card = cardFor(customerId)
  const r = stageAfterOutcome(card?.stage, 'ready_to_quote', getPipelineStages())
  if (r.move && moveCard(customerId, r.move)) return r.move
  return null
}
