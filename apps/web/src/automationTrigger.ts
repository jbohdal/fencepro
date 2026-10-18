/**
 * Automation triggers used to be sent from the browser here, after a save,
 * to an engine that kept nothing. They are now recorded by the server where
 * the change is saved (a stage move with the pipeline or job save, a payment
 * with Billing or the job, a photo when its upload finishes), in the same
 * database step, so nothing is lost and nothing runs twice.
 *
 * These functions stay so the screens that called them need no change; they
 * deliberately send nothing. See apps/portal/src/server/lib/automations/.
 */

export interface TriggerEvent {
  jobId?: string
  jobName?: string
  jobAddress?: string
  fenceType?: string
  fromStage?: string
  toStage?: string
  assignedRep?: string
  assignedRepEmail?: string
  crewAssigned?: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  scheduledDate?: string
  quotePrice?: number
  contractValue?: number
  extraData?: Record<string, unknown>
}

/** Recorded by the server with the save itself; nothing is sent from here. */
export function fireTrigger(_triggerType: string, _event: TriggerEvent): void { /* recorded server side */ }
export function fireOpsStageChange(_jobId: string, _fromStage: string, _toStage: string, _jobData?: Partial<TriggerEvent>): void { /* recorded server side */ }
export function fireSalesStageChange(_dealId: string, _fromStage: string, _toStage: string, _dealData?: Partial<TriggerEvent>): void { /* recorded server side */ }
export function fireJobCreated(_jobId: string, _jobData?: Partial<TriggerEvent>): void { /* recorded server side */ }
export function fireJobAssigned(_jobId: string, _crewAssigned: string, _jobData?: Partial<TriggerEvent>): void { /* recorded server side */ }
export function fireJobScheduled(_jobId: string, _scheduledDate: string, _jobData?: Partial<TriggerEvent>): void { /* recorded server side */ }
export function fireRainDayFlagged(_jobId: string, _jobData?: Partial<TriggerEvent>): void { /* recorded server side */ }
export function firePaymentReceived(_jobId: string, _jobData?: Partial<TriggerEvent>): void { /* recorded server side */ }
export function fireCustomerCreated(_customerId: string, _data?: Partial<TriggerEvent>): void { /* recorded server side */ }
export function fireInvoiceCreated(_invoiceId: string, _customerId?: string, _totalCents?: number, _data?: Partial<TriggerEvent>): void { /* recorded server side */ }
export function fireQuoteSold(_quoteId: string, _customerId?: string, _totalCents?: number, _data?: Partial<TriggerEvent>): void { /* recorded server side */ }
export function fireJobRescheduled(_jobId: string, _scheduledDate: string, _data?: Partial<TriggerEvent>): void { /* recorded server side */ }
