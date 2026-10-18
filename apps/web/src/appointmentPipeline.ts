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
import { businessDate } from './businessDate'

/** Stages a card is finished in: a customer's newer card (a new enquiry) is the one in play. */
const CLOSED = new Set(['Paid & Closed', 'Lost Sale', 'No Answer'])

/** The customer's card in play: an open one (most recently moved), else their most recent card. */
export function cardFor(customerId: string): { id: string; stage: string; firstName: string; lastName: string } | null {
  const mine = (getPipeline().leads || []).filter((l: any) => l?.customerId === customerId)
  if (mine.length < 2) return mine[0] ?? null
  const recent = (a: any, b: any) => String(b.lastMoved || b.createdAt || '').localeCompare(String(a.lastMoved || a.createdAt || ''))
  const open = mine.filter((l: any) => !CLOSED.has(l.stage)).sort(recent)
  return open[0] ?? [...mine].sort(recent)[0]
}

export function moveCard(customerId: string, toStage: string): boolean {
  const { leads, stages } = getPipeline()
  const pick = cardFor(customerId)
  const card = pick && (leads || []).find((l: any) => l?.id === pick.id)
  if (!card || card.stage === toStage) return false
  const from = card.stage
  savePipeline(leads.map((l: any) => (l === card ? { ...l, stage: toStage, lastMoved: businessDate(new Date()) } : l)), stages)
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
