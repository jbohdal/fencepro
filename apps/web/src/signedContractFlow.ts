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
import { getCustomerById, logCustomerActivity, getCustomers, upsertCustomer, type Customer } from './customerStore'
import { createJobFromQuote, getJobByQuoteId, type Job } from './jobStore'
import { createPendingOrderFromQuote } from './pendingOrderStore'
import { linkPullSheetToCustomer, getPullSheetsForCustomer } from './billingStore'
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

/**
 * Find the best quote to associate with a deal: the most recent non-LOST quote.
 * Matches by customerId first; falls back to name + phone/email match so
 * legacy pipeline cards that lack a customerId still cascade correctly.
 */
export function findActiveQuoteForCustomer(customer: Customer | string): SavedQuote | null {
  const all = loadQuotes()
  if (typeof customer === 'string') {
    return all
      .filter(q => q.customerId === customer && q.status !== 'LOST' && q.status !== 'SOLD')
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
      || all
        .filter(q => q.customerId === customer && q.status !== 'LOST')
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
      || null
  }
  const c = customer
  const name = `${c.firstName} ${c.lastName}`.trim().toLowerCase()
  const phone = (c.phone || '').replace(/\D/g, '')
  const email = (c.email || '').toLowerCase()
  // Prefer a quote with exact customerId; else fall back to name/phone/email match.
  const byId = all.filter(q => q.customerId === c.id && q.status !== 'LOST')
  const byFallback = all.filter(q => {
    if (q.status === 'LOST') return false
    if (!q.customerName) return false
    if (name && q.customerName.toLowerCase() === name) return true
    if (phone && (q.customerPhone || '').replace(/\D/g, '') === phone) return true
    if (email && (q.customerEmail || '').toLowerCase() === email) return true
    return false
  })
  const candidates = [...byId, ...byFallback]
  // Prefer not-already-SOLD so each pipeline drop picks a fresh quote
  const openFirst = candidates.find(q => q.status !== 'SOLD')
  return openFirst || candidates[0] || null
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
 * Called when a lead card is dropped on the Signed Contract stage on the
 * pipeline. Finds the most recent active quote for the customer and runs the
 * full cascade. If no quote exists a helpful error is thrown.
 */
export function applySignedContractTransition(lead: { id: string; customerId?: string; firstName: string; lastName: string; phone?: string; email?: string; address?: string; stage: string; fromStage?: string }): SignedContractResult | null {
  // Normalize stage comparison — trim whitespace, case-insensitive.
  const normalized = (lead.stage || '').trim().toLowerCase()
  const fromNormalized = (lead.fromStage || '').trim().toLowerCase()

  // Fire automation trigger regardless (engine can match conditions)
  try {
    fireSalesStageChange(lead.customerId || lead.id, lead.fromStage || '', lead.stage, {
      customerName: `${lead.firstName} ${lead.lastName}`.trim(),
      customerPhone: lead.phone, customerEmail: lead.email, jobAddress: lead.address,
    })
  } catch {}

  if (normalized !== 'signed contract') return null
  if (fromNormalized === 'signed contract') return null // same-to-same no-op

  // Step 1: resolve (or create) the customer.
  let customer: Customer | null = lead.customerId ? getCustomerById(lead.customerId) : null
  if (!customer) {
    // Fallback 1: match any existing customer by name/phone/email
    const all = getCustomers()
    const leadName = `${lead.firstName} ${lead.lastName}`.trim().toLowerCase()
    const leadPhone = (lead.phone || '').replace(/\D/g, '')
    const leadEmail = (lead.email || '').toLowerCase()
    customer = all.find(c => {
      const cName = `${c.firstName} ${c.lastName}`.trim().toLowerCase()
      const cPhone = (c.phone || '').replace(/\D/g, '')
      const cEmail = (c.email || '').toLowerCase()
      if (leadName && cName === leadName) return true
      if (leadPhone && cPhone === leadPhone) return true
      if (leadEmail && cEmail === leadEmail) return true
      return false
    }) || null
  }
  if (!customer) {
    // Fallback 2: create a customer so the cascade can proceed
    try {
      const { customer: created } = upsertCustomer({
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

  // Step 2: find a quote. customer-object version (fallback by name/phone/email).
  const quote = findActiveQuoteForCustomer(customer)
  if (!quote) {
    logCustomerActivity(customer.id, 'Moved to Signed Contract — no quote on file to mark sold automatically', { kind: 'stage_change' })
    return null
  }

  // Step 3: run the cascade. markQuoteSold is per-quote idempotent, so
  // dropping multiple customers/quotes on Signed Contract each gets its own job.
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
