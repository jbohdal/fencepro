/**
 * Automation Trigger Client
 *
 * Called from the CRM frontend whenever a job/deal stage changes.
 * Fires events to the portal backend which evaluates all active automations.
 */

const AUTOMATION_API = (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'http://localhost:4000' : '') + '/api/automations/trigger'
const SYNC_KEY = typeof localStorage !== 'undefined' ? (localStorage.getItem('crm_access_token') || 'dev-sync-key') : 'dev-sync-key'

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

/**
 * Fire an automation trigger. Non-blocking — errors are silently logged.
 */
export function fireTrigger(triggerType: string, event: TriggerEvent): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('crm_access_token') : null
  if (token) headers['Authorization'] = `Bearer ${token}`
  else headers['X-API-Key'] = SYNC_KEY
  fetch(AUTOMATION_API, {
    method: 'POST',
    headers,
    body: JSON.stringify({ triggerType, event }),
  }).catch(err => console.warn('[Automation] Trigger failed:', err))
}

// ── Convenience functions ──

export function fireOpsStageChange(jobId: string, fromStage: string, toStage: string, jobData?: Partial<TriggerEvent>): void {
  fireTrigger('ops_stage_change', { jobId, fromStage, toStage, ...jobData })
}

export function fireSalesStageChange(dealId: string, fromStage: string, toStage: string, dealData?: Partial<TriggerEvent>): void {
  fireTrigger('sales_stage_change', { jobId: dealId, fromStage, toStage, ...dealData })
}

export function fireJobCreated(jobId: string, jobData?: Partial<TriggerEvent>): void {
  fireTrigger('job_created', { jobId, ...jobData })
}

export function fireJobAssigned(jobId: string, crewAssigned: string, jobData?: Partial<TriggerEvent>): void {
  fireTrigger('job_assigned', { jobId, crewAssigned, ...jobData })
}

export function fireJobScheduled(jobId: string, scheduledDate: string, jobData?: Partial<TriggerEvent>): void {
  fireTrigger('job_scheduled', { jobId, scheduledDate, ...jobData })
}

export function fireRainDayFlagged(jobId: string, jobData?: Partial<TriggerEvent>): void {
  fireTrigger('rain_day_flagged', { jobId, ...jobData })
}

export function firePaymentReceived(jobId: string, jobData?: Partial<TriggerEvent>): void {
  fireTrigger('payment_received', { jobId, ...jobData })
}

export function fireCustomerCreated(customerId: string, data?: Partial<TriggerEvent>): void {
  fireTrigger('customer_created', { ...data, extraData: { ...data?.extraData, customerId } })
}

export function fireInvoiceCreated(invoiceId: string, customerId?: string, totalCents?: number, data?: Partial<TriggerEvent>): void {
  fireTrigger('invoice_created', {
    jobId: invoiceId, ...data,
    extraData: { ...data?.extraData, invoiceId, customerId, totalCents },
  })
}

export function fireQuoteSold(quoteId: string, customerId?: string, totalCents?: number, data?: Partial<TriggerEvent>): void {
  fireTrigger('quote_sold', {
    jobId: quoteId, ...data,
    extraData: { ...data?.extraData, quoteId, customerId, totalCents },
  })
}

export function fireJobRescheduled(jobId: string, scheduledDate: string, data?: Partial<TriggerEvent>): void {
  fireTrigger('job_rescheduled', { jobId, scheduledDate, ...data })
}
