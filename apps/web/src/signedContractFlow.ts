/**
 * Signed flow — the atomic "deal closed" transition.
 *
 * When a deal moves to the Signed stage (Settings > Pipeline Stages) OR a quote is explicitly marked SOLD,
 * this module does the full cascade:
 *   1. Quote.status = SOLD
 *   2. Create a Job record (via jobStore.createJobFromQuote)
 *   3. Create a PendingOrder from the pull sheet
 *   4. Log activity on the customer
 *   5. Fire quote_sold + job_created + sales_stage_change automations
 *   6. Broadcast fencepro:quotes:updated and fencepro:jobs:updated so
 *      open tabs re-render without a refresh.
 *
 * Throws on failure so the caller can roll back the UI transition.
 */

import { stageHasRole, stageName } from './pipelineStagesStore'
import { getPipeline, savePipeline } from './pipelineStore'
import type { SavedQuote } from './QuotesPage'
import { getCustomerById, logCustomerActivity, upsertCustomer, type Customer } from './customerStore'
import { createJobFromQuote, getJobByQuoteId, type Job } from './jobStore'
import { createPendingOrderFromQuote } from './pendingOrderStore'
import { linkPullSheetToCustomer, getPullSheetsForCustomer } from './billingStore'
import { fireQuoteSold, fireSalesStageChange } from './automationTrigger'
import { getQuotes, getQuoteById, updateQuote } from './quoteStore'
import { pickSignedQuote } from './signedQuotePick'

export const QUOTES_UPDATED_EVENT = 'fencepro:quotes:updated'
export const JOBS_UPDATED_EVENT = 'fencepro:jobs:updated'
export const PIPELINE_UPDATED_EVENT = 'fencepro:pipeline:updated'

/**
 * The quote a deal marks sold: only this customer's own quotes, by customer
 * id, and the card's own quote first (signedQuotePick.ts). Never a quote
 * found by name, phone or email.
 */
export function findActiveQuoteForCustomer(customer: Customer | string, ownQuoteId?: string | null): SavedQuote | null {
  return pickSignedQuote(getQuotes(), typeof customer === 'string' ? customer : customer.id, ownQuoteId)
}

export interface SignedContractResult {
  quote: SavedQuote
  job: Job
  alreadySold: boolean
}

/**
 * Flip a quote to SOLD, create the job, and cascade side effects.
 * Idempotent per quote — if the job already exists it is returned unchanged.
 */
export function markQuoteSold(quoteId: string, opts?: { actor?: string }): SignedContractResult {
  const quote = getQuoteById(quoteId)
  if (!quote) throw new Error(`Quote ${quoteId} not found`)

  const alreadySold = quote.status === 'SOLD'
  let updatedQuote = quote
  if (!alreadySold) {
    updatedQuote = updateQuote(quoteId, { status: 'SOLD' }) || quote
  }

  let job = getJobByQuoteId(quoteId)
  if (!job) {
    job = createJobFromQuote(updatedQuote)
  }

  try { createPendingOrderFromQuote(updatedQuote) } catch {}

  // Auto-generate pull sheet for customer profile if the quote has one and
  // it isn't already linked.
  if (updatedQuote.customerId && updatedQuote.pullSheet && updatedQuote.pullSheet.length > 0) {
    try {
      const existing = getPullSheetsForCustomer(updatedQuote.customerId)
      const already = existing.some(ps => ps.quoteId === updatedQuote.id)
      if (!already) {
        linkPullSheetToCustomer({
          customerId: updatedQuote.customerId,
          customerName: updatedQuote.customerName,
          jobId: job?.id,
          jobName: job ? updatedQuote.customerName : undefined,
          quoteId: updatedQuote.id,
          quoteName: `${updatedQuote.fenceStyle} — ${updatedQuote.customerName}`,
          versionSnapshot: JSON.parse(JSON.stringify(updatedQuote.pullSheet)),
          versionNumber: existing.filter(ps => ps.quoteId === updatedQuote.id).length + 1,
          linkedAt: new Date().toISOString(),
          linkedBy: opts?.actor || 'system',
        })
        logCustomerActivity(updatedQuote.customerId,
          `Pull sheet generated automatically from sold quote #${quoteId.slice(-6).toUpperCase()}`,
          { actor: opts?.actor || 'system', kind: 'job' })
      }
    } catch {}
  }

  if (updatedQuote.customerId) {
    logCustomerActivity(updatedQuote.customerId,
      alreadySold ? `Job created for existing SOLD quote #${quoteId.slice(-6)}` : `Quote marked SOLD · Job created automatically`,
      { actor: opts?.actor || 'system', kind: 'job' })
  }

  if (!alreadySold) {
    try {
      fireQuoteSold(updatedQuote.id, updatedQuote.customerId,
        Math.round((updatedQuote.finalPrice || 0) * 100), {
        jobName: updatedQuote.customerName, customerName: updatedQuote.customerName,
        customerEmail: updatedQuote.customerEmail, customerPhone: updatedQuote.customerPhone,
        jobAddress: updatedQuote.customerAddress, fenceType: updatedQuote.fenceStyle,
        assignedRep: updatedQuote.salesRep, quotePrice: updatedQuote.finalPrice,
        contractValue: updatedQuote.finalPrice,
      })
    } catch {}
  }

  try { window.dispatchEvent(new CustomEvent(JOBS_UPDATED_EVENT)) } catch {}

  return { quote: updatedQuote, job: job!, alreadySold }
}

/**
 * Called when a lead card is dropped on the Signed stage on the
 * pipeline. Takes the card's own quote, else its customer's newest open quote
 * (by customer id only), and runs the full cascade. With none, nothing is
 * marked sold: the customer's activity says so and null is returned (the
 * board then says "No quote linked yet").
 */
export function applySignedContractTransition(lead: { id: string; customerId?: string; quoteId?: string; firstName: string; lastName: string; phone?: string; email?: string; address?: string; stage: string; fromStage?: string }): SignedContractResult | null {

  // Fire automation trigger regardless (engine can match conditions)
  try {
    fireSalesStageChange(lead.customerId || lead.id, lead.fromStage || '', lead.stage, {
      customerName: `${lead.firstName} ${lead.lastName}`.trim(),
      customerPhone: lead.phone, customerEmail: lead.email, jobAddress: lead.address,
    })
  } catch {}

  // Only the Signed stage (Settings > Pipeline Stages, by role) runs the cascade.
  if (!stageHasRole(lead.stage, 'signed')) return null
  if (stageHasRole(lead.fromStage, 'signed')) return null // same-to-same no-op

  // Step 1: the card's own customer (set by a pick or a create, never guessed by name, phone or email).
  let customer: Customer | null = lead.customerId ? getCustomerById(lead.customerId) : null
  if (!customer) {
    // None: create a customer so the cascade can proceed
    try {
      // A fixed id per card: the same card handled again (or on another phone) is the same customer.
      const fixedId = `c-${lead.id}`
      const { customer: created } = upsertCustomer({
        ...(/^[A-Za-z0-9_-]{8,64}$/.test(fixedId) ? { id: fixedId } : {}),
        firstName: lead.firstName || 'Pipeline',
        lastName: lead.lastName || 'Lead',
        phone: lead.phone || '',
        email: lead.email || '',
        serviceAddress: lead.address || '',
      })
      customer = created
    } catch { customer = null }
  }
  if (!customer) return null

  // Step 2: the card's own quote, else its customer's (by id only; no name, phone or email fallback).
  const quote = findActiveQuoteForCustomer(customer.id, lead.quoteId)
  if (!quote) {
    logCustomerActivity(customer.id, `Moved to ${stageName(lead.stage)} — no quote on file to mark sold automatically`, { kind: 'stage_change' })
    return null
  }

  // Step 3: run the cascade. markQuoteSold is per-quote idempotent, so
  // dropping multiple customers/quotes on the Signed stage each gets its own job.
  const result = markQuoteSold(quote.id, { actor: 'pipeline' })
  // The card keeps the quote (and job) it was signed for: completing that job later moves exactly this card.
  stampCard(lead.id, result.quote.id, result.job?.id ?? null)
  return result
}

/** Put the quote id and job id on a pipeline card (it was signed for them). */
function stampCard(cardId: string, quoteId: string, jobId: string | null) {
  const leads = getPipeline().leads || []
  const card = leads.find((l: any) => l?.id === cardId)
  if (!card || (card.quoteId === quoteId && (!jobId || card.jobId === jobId))) return
  savePipeline(leads.map((l: any) => (l.id === cardId ? { ...l, quoteId, ...(jobId ? { jobId } : {}) } : l)))
}

/** Mark as Lost — keeps the quote in the list but stamps the status. */
export function markQuoteLost(quoteId: string, reason?: string, actor?: string): SavedQuote | null {
  const quote = getQuoteById(quoteId)
  if (!quote) return null
  const nextNotes = reason
    ? `${quote.notes || ''}${quote.notes ? '\n' : ''}Lost: ${reason}`
    : quote.notes
  const updated = updateQuote(quoteId, { status: 'LOST', notes: nextNotes })
  if (updated && updated.customerId) {
    logCustomerActivity(updated.customerId, `Quote marked LOST${reason ? ` — ${reason}` : ''}`, { actor: actor || 'user', kind: 'quote' })
  }
  return updated
}
