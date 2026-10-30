/**
 * Database-backed saved quote persistence for the CRM web app.
 *
 * Mirrors the crmContactsApi.ts pattern. Saved quotes live in the
 * `SavedQuote` table at /api/saved-quotes, scoped by CrmAccount on the server.
 */

import type { QuoteJobRequest } from './quoteJob'
import type { QuoteProposal } from './proposal'
import type { QuoteLayoutRecord } from './yardLayout'
import { isSignedIn, fetchWithAuth } from './crmAuth'
import { toast } from './toast'
import type { LineItem } from './materialCalculator'
import type { QuotePricingOverrides } from './pricingEngine'
import type { SavedWork } from './moveRepair'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { plainError, plainThrown } from './plainError'
import { untableBody, asTable } from './listTable'
import type { DepositTerms } from './contractTerms'

const AUTH_API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '')

export type SavedQuoteStatus = 'DRAFT' | 'SENT' | 'SOLD' | 'LOST'

export interface SavedQuotePayload {
  id?: string
  crmContactId?: string | null
  customerName?: string
  customerPhone?: string
  customerEmail?: string
  customerAddress?: string
  leadSource?: string
  salesRep?: string
  fenceStyle?: string
  runs?: number[]
  runRails?: Array<'auto' | '6ft' | '8ft'> | null
  layout?: QuoteLayoutRecord | null
  proposal?: QuoteProposal | null
  corners?: number
  ends?: number
  walkGates?: number
  dblGates?: number
  tearOutSections?: number
  tearOutGates?: number
  adjLaborHrs?: number
  hasSalesman?: boolean
  priceAdjust?: number
  sections?: number
  materialCost?: number
  laborCost?: number
  tearOutCost?: number
  totalCOGS?: number
  finalPrice?: number
  gmPct?: number
  pullSheet?: LineItem[]
  status?: SavedQuoteStatus
  date?: string
  notes?: string
  leadTemp?: number
  pricing?: QuotePricingOverrides | null
  /** A fence move or repair (moveRepair.ts); null for a new fence. */
  work?: SavedWork | null
  /** A sent quote saved again at today's prices: it has to be sent again. */
  needsResend?: boolean
  /** A Salesman's or Installer's save: the quote builder's inputs (the server works out the costs). */
  priceRequest?: QuoteJobRequest
  /** The copy of the price data it was priced with (pricingFreshness.ts): the server refuses a save on an older one. */
  pricingStamp?: string
  /** Back to Draft picked on a sent quote: without it the server keeps a sent quote Sent. */
  backToDraft?: boolean
}

export interface SavedQuoteRecord extends Required<Omit<SavedQuotePayload, 'crmContactId' | 'runRails' | 'layout' | 'proposal' | 'id' | 'pricing' | 'work' | 'needsResend' | 'pricingStamp' | 'backToDraft'>> {
  needsResend?: boolean
  id: string
  pricing: QuotePricingOverrides | null
  work: SavedWork | null
  accountId: string
  ownerId: string | null
  crmContactId: string | null
  runRails: Array<'auto' | '6ft' | '8ft'> | null
  layout: QuoteLayoutRecord | null
  proposal: QuoteProposal | null
  chosenOption: number | null
  /** The first time it was Sold or accepted; never cleared (server lib/everSold.ts). */
  soldAt?: string | null
  shareToken: string | null
  shareExpiresAt: string | null
  shareDisabledAt: string | null
  firstViewedAt: string | null
  viewCount: number
  acceptedAt: string | null
  acceptedBy: string | null
  acceptedSignature: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /** With the customer's copy (GET /share/:token): the deposit its Payment Terms say. */
  depositTerms?: DepositTerms | null
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string; serverTime?: string }> {
  const token = isSignedIn()
  if (!token) return { ok: false, error: 'Not authenticated' }
  try {
    const res = await fetchWithAuth(`${AUTH_API}/api/saved-quotes${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) return { ok: false, error: plainError(401).message }
    const json = untableBody(await res.json().catch(() => ({})))
    if (!res.ok || json?.success === false) {
      return { ok: false, error: plainError(res.status, json?.error).message }
    }
    return { ok: true, data: json.data as T, serverTime: typeof json?.serverTime === 'string' ? json.serverTime : undefined }
  } catch (err) {
    return { ok: false, error: plainThrown(err).message }
  }
}

/**
 * The server's clock when the last whole list was read: the stores ask for
 * "changed since then" next, instead of the whole list again (which, read
 * again on the first refresh, cost a phone ~0.5 MB and a full redraw).
 */
let listedAt: string | null = null
export function lastListServerTime(): string | null { return listedAt }

export async function listSavedQuotes(): Promise<SavedQuoteRecord[] | null> {
  // As one table (listTable.ts): the same rows, without each row repeating the field names.
  const r = await call<SavedQuoteRecord[]>('GET', asTable(''))
  if (r.ok && r.serverTime) listedAt = r.serverTime
  if (!r.ok) {
    toast.error('Could not load quotes from cloud', r.error || plainError(0).message)
    return null
  }
  return r.data || []
}

export async function getSavedQuote(id: string): Promise<SavedQuoteRecord | null> {
  const r = await call<SavedQuoteRecord>('GET', `/${id}`)
  return r.ok ? (r.data || null) : null
}

/** The deposit a quote's Payment Terms say, as the customer's link says it (portal lib/contractBilling.ts termsDepositOf); null offline. */
export async function getDepositTerms(id: string): Promise<DepositTerms | null> {
  const r = await call<DepositTerms>('GET', `/${encodeURIComponent(id)}/deposit-terms`)
  const d = r.ok ? r.data : null
  return d && typeof d.asSigned === 'boolean' && (d.depositPct === null || typeof d.depositPct === 'number') ? { asSigned: d.asSigned, depositPct: d.depositPct } : null
}

export async function createSavedQuote(payload: SavedQuotePayload): Promise<SavedQuoteRecord | null> {
  const r = await call<SavedQuoteRecord>('POST', '/', payload)
  if (!r.ok) {
    toast.error('Quote not saved to cloud', r.error || plainError(0).message)
    return null
  }
  return r.data || null
}

export async function updateSavedQuote(id: string, payload: SavedQuotePayload): Promise<SavedQuoteRecord | null> {
  const r = await call<SavedQuoteRecord>('PATCH', `/${id}`, payload)
  if (!r.ok) {
    toast.error('Quote update not saved to cloud', r.error || plainError(0).message)
    return null
  }
  return r.data || null
}

export async function archiveSavedQuote(id: string): Promise<boolean> {
  const r = await call('DELETE', `/${id}`)
  if (!r.ok) {
    toast.error('Quote not deleted from cloud', r.error || plainError(0).message)
  }
  return r.ok
}

/** The customer link for a quote: the one already sent while it is open, else a new one. */
export async function issueShareToken(id: string, fresh = false): Promise<{ shareToken: string; expiresAt: string | null; preview: string | null } | null> {
  const r = await call<{ shareToken: string; quoteId: string; expiresAt?: string | null; preview?: string }>('POST', `/${id}/share-token${fresh ? '?new=1' : ''}`)
  if (!r.ok || !r.data) return null
  // preview: a signed mark (15 minutes) for opening the link yourself, so it shows as a Staff view and is not counted.
  return { shareToken: r.data.shareToken, expiresAt: r.data.expiresAt ?? null, preview: r.data.preview ?? null }
}

/** Stops the customer link working; it shows a page with the company phone. */
export async function turnOffShare(id: string): Promise<boolean> {
  const r = await call<{ shareDisabledAt: string }>('POST', `/${id}/share-off`)
  return r.ok
}

/**
 * Public read by share token. No auth needed; this is what the customer's
 * browser hits at #/quote/:token and #/present/:token.
 */
export async function fetchPublicQuoteByToken(token: string): Promise<SavedQuoteRecord | null> {
  try {
    const res = await fetch(`${AUTH_API}/api/saved-quotes/share/${encodeURIComponent(token)}`)
    if (!res.ok) return null
    const json = await res.json().catch(() => ({}))
    return json?.success ? (json.data as SavedQuoteRecord) : null
  } catch {
    return null
  }
}

/**
 * Public acceptance: the customer clicks Accept on the share page. Flips the
 * quote to SOLD and records acceptedAt + name + optional signature data URL.
 */
export async function acceptPublicQuoteByToken(
  token: string,
  payload: { name: string; signature?: string },
): Promise<SavedQuoteRecord | null> {
  try {
    const res = await fetch(`${AUTH_API}/api/saved-quotes/share/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) return null
    const json = await res.json().catch(() => ({}))
    return json?.success ? (json.data as SavedQuoteRecord) : null
  } catch {
    return null
  }
}
