/**
 * What appointments do to the customer's pipeline card.
 *
 *   - Booking an Estimate moves a card that is still before Appointment to Appointment.
 *   - "Ready to quote" moves it to Estimating; "Not interested" offers Lost Sale.
 *
 * The rules are in appointmentLogic (stageAfterBooking, stageAfterOutcome);
 * this applies them to the pipeline, through the same save and automations
 * as dragging the card by hand.
 */

import { getPipeline, savePipeline } from './pipelineStore'
import { fireSalesStageChange } from './automationTrigger'
import { stageAfterBooking, stageAfterOutcome, type Appointment, type AppointmentOutcome } from './appointmentLogic'
import { toast } from './toast'

export function cardFor(customerId: string): { id: string; stage: string; firstName: string; lastName: string } | null {
  return (getPipeline().leads || []).find((l: any) => l?.customerId === customerId) ?? null
}

export function moveCard(customerId: string, toStage: string): boolean {
  const { leads, stages } = getPipeline()
  const card = (leads || []).find((l: any) => l?.customerId === customerId)
  if (!card || card.stage === toStage) return false
  const from = card.stage
  savePipeline(leads.map((l: any) => (l === card ? { ...l, stage: toStage, lastMoved: new Date().toISOString().slice(0, 10) } : l)), stages)
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
  const to = stageAfterBooking(card?.stage, a.type, getPipeline().stages || [])
  if (to && moveCard(a.crmContactId, to)) { toast.info('Pipeline updated', `Card moved to ${to}.`); return to }
  return null
}

/** After an outcome: move the card, or ask first when it is a step back (Lost Sale). */
export function applyOutcome(a: Pick<Appointment, 'crmContactId' | 'customerName'>, outcome: AppointmentOutcome): string | null {
  const card = cardFor(a.crmContactId)
  const r = stageAfterOutcome(card?.stage, outcome, getPipeline().stages || [])
  if (r.move && moveCard(a.crmContactId, r.move)) { toast.info('Pipeline updated', `Card moved to ${r.move}.`); return r.move }
  if (r.offer && window.confirm(`Move ${a.customerName || 'this customer'} to ${r.offer} in the pipeline?`) && moveCard(a.crmContactId, r.offer)) return r.offer
  return null
}
