/**
 * Database-backed saved quote persistence for the CRM web app.
 *
 * Mirrors the crmContactsApi.ts pattern. Saved quotes used to live entirely
 * in `localStorage.fencepro_quotes`; now they live in the `SavedQuote`
 * table at /api/saved-quotes and are scoped by CrmAccount on the server.
 */

import { getAccessToken } from './crmAuth'
import { toast } from './toast'
import type { LineItem } from './materialCalculator'
import type { QuotePricingOverrides } from './pricingEngine'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '')

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
}

export interface SavedQuoteRecord extends Required<Omit<SavedQuotePayload, 'crmContactId' | 'runRails' | 'id' | 'pricing'>> {
  id: string
  pricing: QuotePricingOverrides | null
  accountId: string
  ownerId: string | null
  crmContactId: string | null
  runRails: Array<'auto' | '6ft' | '8ft'> | null
  shareToken: string | null
  firstViewedAt: string | null
  viewCount: number
  acceptedAt: string | null
  acceptedBy: string | null
  acceptedSignature: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

async function call<T>(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data?: T; error?: string }> {
  const token = getAccessToken()
  if (!token) return { ok: false, error: 'Not authenticated' }
  try {
    const res = await fetch(`${AUTH_API}/api/saved-quotes${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401) return { ok: false, error: 'Session expired' }
    const json = await res.json().catch(() => ({}))
    if (!res.ok || json?.success === false) {
      return { ok: false, error: json?.error || `HTTP ${res.status}` }
    }
    return { ok: true, data: json.data as T }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Network error' }
  }
}

export async function listSavedQuotes(): Promise<SavedQuoteRecord[] | null> {
  const r = await call<SavedQuoteRecord[]>('GET', '/')
  if (!r.ok) {
    toast.error('Could not load quotes from cloud', `${r.error || 'Network error'}`)
    return null
  }
  return r.data || []
}

export async function getSavedQuote(id: string): Promise<SavedQuoteRecord | null> {
  const r = await call<SavedQuoteRecord>('GET', `/${id}`)
  return r.ok ? (r.data || null) : null
}

export async function createSavedQuote(payload: SavedQuotePayload): Promise<SavedQuoteRecord | null> {
  const r = await call<SavedQuoteRecord>('POST', '/', payload)
  if (!r.ok) {
    toast.error('Quote not saved to cloud', `${r.error || 'Network error'} — your local copy is preserved.`)
    return null
  }
  return r.data || null
}

export async function updateSavedQuote(id: string, payload: SavedQuotePayload): Promise<SavedQuoteRecord | null> {
  const r = await call<SavedQuoteRecord>('PATCH', `/${id}`, payload)
  if (!r.ok) {
    toast.error('Quote update not saved to cloud', `${r.error || 'Network error'}`)
    return null
  }
  return r.data || null
}

export async function archiveSavedQuote(id: string): Promise<boolean> {
  const r = await call('DELETE', `/${id}`)
  if (!r.ok) {
    toast.error('Quote not deleted from cloud', `${r.error || 'Network error'} — it will reappear on next reload.`)
  }
  return r.ok
}

export async function issueShareToken(id: string): Promise<{ shareToken: string } | null> {
  const r = await call<{ shareToken: string; quoteId: string }>('POST', `/${id}/share-token`)
  if (!r.ok || !r.data) return null
  return { shareToken: r.data.shareToken }
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

/**
 * One shot push of the legacy `fencepro_quotes` localStorage blob into the
 * database. Idempotent on the server side and gated by a localStorage flag
 * so we do not retry on every page load.
 */
const QUOTES_MIGRATION_FLAG = 'fencepro_quotes_db_migrated_v1'

export async function migrateLocalQuotesOnce(): Promise<void> {
  if (localStorage.getItem(QUOTES_MIGRATION_FLAG) === '1') return
  const token = getAccessToken()
  if (!token) return
  try {
    const raw = localStorage.getItem('fencepro_quotes')
    const all: any[] = raw ? JSON.parse(raw) : []
    if (!Array.isArray(all) || all.length === 0) {
      localStorage.setItem(QUOTES_MIGRATION_FLAG, '1')
      return
    }
    const payload = {
      quotes: all
        .filter(q => q && (q.fenceStyle || q.customerName))
        .map(q => ({
          id: q.id,
          crmContactId: q.customerId || undefined,
          customerName: q.customerName || '',
          customerPhone: q.customerPhone || '',
          customerEmail: q.customerEmail || '',
          customerAddress: q.customerAddress || '',
          leadSource: q.leadSource || '',
          salesRep: q.salesRep || '',
          fenceStyle: q.fenceStyle || '',
          runs: Array.isArray(q.runs) ? q.runs : [],
          runRails: Array.isArray(q.runRails) ? q.runRails : undefined,
          corners: q.corners || 0,
          ends: q.ends || 0,
          walkGates: q.walkGates || 0,
          dblGates: q.dblGates || 0,
          tearOutSections: q.tearOutSections || 0,
          tearOutGates: q.tearOutGates || 0,
          adjLaborHrs: q.adjLaborHrs || 0,
          hasSalesman: !!q.hasSalesman,
          priceAdjust: q.priceAdjust || 0,
          sections: q.sections || 0,
          materialCost: q.materialCost || 0,
          laborCost: q.laborCost || 0,
          tearOutCost: q.tearOutCost || 0,
          totalCOGS: q.totalCOGS || 0,
          finalPrice: q.finalPrice || 0,
          gmPct: q.gmPct || 0,
          pullSheet: Array.isArray(q.pullSheet) ? q.pullSheet : [],
          status: ['DRAFT', 'SENT', 'SOLD', 'LOST'].includes(q.status) ? q.status : 'DRAFT',
          date: q.date || '',
          notes: q.notes || '',
          leadTemp: q.leadTemp || 0,
        })),
    }
    const r = await call<{ created: number; updated: number; skipped: number; total: number }>('POST', '/sync', payload)
    if (r.ok) {
      localStorage.setItem(QUOTES_MIGRATION_FLAG, '1')
      if (r.data && (r.data.created > 0 || r.data.updated > 0)) {
        toast.info('Quotes synced to cloud', `${r.data.created} new and ${r.data.updated} existing quotes are now in the database.`)
      }
    }
  } catch {}
}
