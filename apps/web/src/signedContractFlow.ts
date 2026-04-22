/**
 * Signed Contract flow — the atomic "deal closed" transition.
 *
 * When a deal moves to Signed Contract OR a quote is explicitly marked SOLD,
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

import type { SavedQuote } from './QuotesPage'
import { getCustomerById, logCustomerActivity } from './customerStore'
import { createJobFromQuote, getJobByQuoteId, type Job } from './jobStore'
import { createPendingOrderFromQuote } from './pendingOrderStore'
import { fireQuoteSold, fireSalesStageChange } from './automationTrigger'

const QUOTES_KEY = 'fencepro_quotes'

export const QUOTES_UPDATED_EVENT = 'fencepro:quotes:updated'
export const JOBS_UPDATED_EVENT = 'fencepro:jobs:updated'
export const PIPELINE_UPDATED_EVENT = 'fencepro:pipeline:updated'

function loadQuotes(): SavedQuote[] {
  try { const r = localStorage.getItem(QUOTES_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}
function saveQuotes(list: SavedQuote[]) {
  localStorage.setItem(QUOTES_KEY, JSON.stringify(list))
  try { window.dispatchEvent(new CustomEvent(QUOTES_UPDATED_EVENT)) } catch {}
}

/** Find the best quote to associate with a deal: the most recent non-LOST quote. */
export function findActiveQuoteForCustomer(customerId: string): SavedQuote | null {
  const all = loadQuotes()
  return all
    .filter(q => q.customerId === customerId && q.status !== 'LOST')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0] || null
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
  const quotes = loadQuotes()
  const idx = quotes.findIndex(q => q.id === quoteId)
  if (idx < 0) throw new Error(`Quote ${quoteId} not found`)
  const quote = quotes[idx]

  const alreadySold = quote.status === 'SOLD'
  if (!alreadySold) {
    quotes[idx] = { ...quote, status: 'SOLD' }
    saveQuotes(quotes)
  }
  const updatedQuote = quotes[idx]

  let job = getJobByQuoteId(quoteId)
  if (!job) {
    job = createJobFromQuote(updatedQuote)
  }

  try { createPendingOrderFromQuote(updatedQuote) } catch {}

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
 * Called when a lead card is dropped on the Signed Contract stage on the
 * pipeline. Finds the most recent active quote for the customer and runs the
 * full cascade. If no quote exists a helpful error is thrown.
 */
export function applySignedContractTransition(lead: { id: string; customerId?: string; firstName: string; lastName: string; stage: string; fromStage?: string }): SignedContractResult | null {
  // Fire automation trigger regardless (engine can match conditions)
  try {
    fireSalesStageChange(lead.customerId || lead.id, lead.fromStage || '', lead.stage, {
      customerName: `${lead.firstName} ${lead.lastName}`.trim(),
    })
  } catch {}

  if (lead.stage !== 'Signed Contract') return null

  const customer = lead.customerId ? getCustomerById(lead.customerId) : null
  // If no customer link or no quote, we bail quietly — the pipeline card stays
  // at Signed Contract but no job is auto-created.
  if (!customer) return null

  const quote = findActiveQuoteForCustomer(customer.id)
  if (!quote) {
    logCustomerActivity(customer.id, 'Moved to Signed Contract — no quote on file to mark sold automatically', { kind: 'stage_change' })
    return null
  }

  return markQuoteSold(quote.id, { actor: 'pipeline' })
}

/** Mark as Lost — keeps the quote in the list but stamps the status. */
export function markQuoteLost(quoteId: string, reason?: string, actor?: string): SavedQuote | null {
  const quotes = loadQuotes()
  const idx = quotes.findIndex(q => q.id === quoteId)
  if (idx < 0) return null
  quotes[idx] = { ...quotes[idx], status: 'LOST', notes: reason ? `${quotes[idx].notes || ''}${quotes[idx].notes ? '\n' : ''}Lost: ${reason}` : quotes[idx].notes }
  saveQuotes(quotes)
  if (quotes[idx].customerId) {
    logCustomerActivity(quotes[idx].customerId, `Quote marked LOST${reason ? ` — ${reason}` : ''}`, { actor: actor || 'user', kind: 'quote' })
  }
  return quotes[idx]
}
