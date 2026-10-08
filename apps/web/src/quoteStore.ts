/**
 * Unified saved-quote store — single source of truth for SavedQuote records.
 *
 * Mirrors the customerStore.ts pattern: hydrated by initQuotes() once after
 * auth, kept fresh by every save call, and broadcast to listeners via the
 * `fencepro:quotes:updated` event. Reads are synchronous cache lookups.
 *
 * Public surface preserves the legacy SavedQuote shape exported from
 * QuotesPage so existing callers (QuoteBuilder, QuoteDetailDrawer,
 * StagingPage, JobsPage, signedContractFlow, BudgetPage, etc.) keep working
 * with a one line import swap.
 */

import {
  listSavedQuotes,
  createSavedQuote,
  updateSavedQuote,
  archiveSavedQuote,
  migrateLocalQuotesOnce,
  type SavedQuoteRecord,
  type SavedQuotePayload,
} from './savedQuotesApi'
import type { SavedQuote } from './QuotesPage'
import { legacyMigrationEnabled } from './syncGuard'
import { newId, enqueue, settled, hasLaterWrites } from './recordSync'

const EVT = 'fencepro:quotes:updated'
const LEGACY_KEY = 'fencepro_quotes'

const uid = () => Math.random().toString(36).slice(2, 10)

let cache: SavedQuote[] = []
let initPromise: Promise<void> | null = null
let hydrated = false

function fromApi(r: SavedQuoteRecord): SavedQuote {
  return {
    id: r.id,
    customerId: r.crmContactId || undefined,
    customerName: r.customerName,
    customerPhone: r.customerPhone,
    customerEmail: r.customerEmail,
    customerAddress: r.customerAddress,
    leadSource: r.leadSource,
    salesRep: r.salesRep,
    fenceStyle: r.fenceStyle,
    runs: Array.isArray(r.runs) ? r.runs : [],
    runRails: r.runRails || undefined,
    corners: r.corners,
    ends: r.ends,
    walkGates: r.walkGates,
    dblGates: r.dblGates,
    tearOutSections: r.tearOutSections,
    tearOutGates: r.tearOutGates,
    adjLaborHrs: r.adjLaborHrs,
    hasSalesman: r.hasSalesman,
    priceAdjust: r.priceAdjust,
    sections: r.sections,
    materialCost: r.materialCost,
    laborCost: r.laborCost,
    tearOutCost: r.tearOutCost,
    totalCOGS: r.totalCOGS,
    finalPrice: r.finalPrice,
    gmPct: r.gmPct,
    pullSheet: Array.isArray(r.pullSheet) ? r.pullSheet : [],
    status: r.status,
    date: r.date,
    notes: r.notes,
    leadTemp: r.leadTemp,
    pricing: r.pricing || undefined,
  }
}

function toApiPayload(q: Partial<SavedQuote>): SavedQuotePayload {
  return {
    crmContactId: q.customerId || null,
    customerName: q.customerName || '',
    customerPhone: q.customerPhone || '',
    customerEmail: q.customerEmail || '',
    customerAddress: q.customerAddress || '',
    leadSource: q.leadSource || '',
    salesRep: q.salesRep || '',
    fenceStyle: q.fenceStyle || '',
    runs: q.runs || [],
    runRails: q.runRails ?? null,
    corners: q.corners ?? 0,
    ends: q.ends ?? 0,
    walkGates: q.walkGates ?? 0,
    dblGates: q.dblGates ?? 0,
    tearOutSections: q.tearOutSections ?? 0,
    tearOutGates: q.tearOutGates ?? 0,
    adjLaborHrs: q.adjLaborHrs ?? 0,
    hasSalesman: !!q.hasSalesman,
    priceAdjust: q.priceAdjust ?? 0,
    sections: q.sections ?? 0,
    materialCost: q.materialCost ?? 0,
    laborCost: q.laborCost ?? 0,
    tearOutCost: q.tearOutCost ?? 0,
    totalCOGS: q.totalCOGS ?? 0,
    finalPrice: q.finalPrice ?? 0,
    gmPct: q.gmPct ?? 0,
    pullSheet: q.pullSheet || [],
    status: q.status || 'DRAFT',
    date: q.date || '',
    notes: q.notes || '',
    leadTemp: q.leadTemp ?? 0,
    pricing: q.pricing ?? null,
  }
}

function emit() {
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

/**
 * Hydrate the in memory cache from /api/saved-quotes. Idempotent. Pushes any
 * legacy localStorage records via migrateLocalQuotesOnce first, then fetches
 * the canonical list, then drops the legacy localStorage blob.
 */
export function initQuotes(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    const migrate = legacyMigrationEnabled()
    if (migrate) { try { await migrateLocalQuotesOnce() } catch {} }
    const records = await listSavedQuotes()
    if (!records) return
    cache = records.map(fromApi)
    hydrated = true
    emit()
    if (migrate) { try { localStorage.removeItem(LEGACY_KEY) } catch {} }
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

/** True once quotes have loaded from the server. */
export function isQuotesHydrated(): boolean { return hydrated }

export function getQuotes(): SavedQuote[] {
  return cache
}

export function getQuoteById(id: string): SavedQuote | null {
  return cache.find(q => q.id === id) || null
}

export function getQuotesForCustomer(customerId: string): SavedQuote[] {
  return cache.filter(q => q.customerId === customerId)
}

/**
 * Upsert a quote. Returns the merged record synchronously from the cache and
 * fires the API write in the background. New quotes get a temp client id;
 * once the API returns, the cache is rewritten with the server's id and the
 * event refires so any open page picks up the new id.
 */
export function upsertQuote(partial: Partial<SavedQuote> & { fenceStyle?: string }): SavedQuote {
  const existing = partial.id ? cache.find(q => q.id === partial.id) : null

  if (existing) {
    const merged: SavedQuote = { ...existing, ...partial } as SavedQuote
    cache = cache.map(q => q.id === merged.id ? merged : q)
    emit()
    pushQuoteUpdate(merged.id)
    return merged
  }

  // Permanent id: the server keeps it, so jobs, quote options, pull sheets and
  // share links created against this quote stay valid.
  const tempId = partial.id || newId()
  const fresh: SavedQuote = {
    id: tempId,
    customerId: partial.customerId,
    customerName: partial.customerName || '',
    customerPhone: partial.customerPhone || '',
    customerEmail: partial.customerEmail || '',
    customerAddress: partial.customerAddress || '',
    leadSource: partial.leadSource || '',
    salesRep: partial.salesRep || '',
    fenceStyle: partial.fenceStyle || '',
    runs: partial.runs || [],
    runRails: partial.runRails,
    corners: partial.corners ?? 0,
    ends: partial.ends ?? 0,
    walkGates: partial.walkGates ?? 0,
    dblGates: partial.dblGates ?? 0,
    tearOutSections: partial.tearOutSections ?? 0,
    tearOutGates: partial.tearOutGates ?? 0,
    adjLaborHrs: partial.adjLaborHrs ?? 0,
    hasSalesman: !!partial.hasSalesman,
    priceAdjust: partial.priceAdjust ?? 0,
    sections: partial.sections ?? 0,
    materialCost: partial.materialCost ?? 0,
    laborCost: partial.laborCost ?? 0,
    tearOutCost: partial.tearOutCost ?? 0,
    totalCOGS: partial.totalCOGS ?? 0,
    finalPrice: partial.finalPrice ?? 0,
    gmPct: partial.gmPct ?? 0,
    pullSheet: partial.pullSheet || [],
    status: partial.status || 'DRAFT',
    date: partial.date || new Date().toISOString().slice(0, 10),
    notes: partial.notes || '',
    leadTemp: partial.leadTemp ?? 0,
    pricing: partial.pricing,
  }
  cache = [fresh, ...cache]
  emit()

  enqueue(`quote:${tempId}`, async () => {
    // A quote points at its customer. If that customer was created a moment
    // ago, wait for it to exist on the server first.
    await settled(fresh.customerId ? `customer:${fresh.customerId}` : null)
    const current = cache.find(q => q.id === tempId) || fresh
    const created = await createSavedQuote({ ...toApiPayload(current), id: tempId })
    if (!created || hasLaterWrites(`quote:${tempId}`)) return
    const fromServer = fromApi(created)
    cache = cache.map(q => q.id === tempId ? { ...fromServer, id: tempId } : q)
    emit()
  }).catch(() => {})

  return fresh
}

/** Send the cached copy of a quote. Queued behind its create and earlier edits. */
function pushQuoteUpdate(id: string): void {
  enqueue(`quote:${id}`, async () => {
    const current = cache.find(q => q.id === id)
    if (!current) return
    await settled(current.customerId ? `customer:${current.customerId}` : null)
    await updateSavedQuote(id, toApiPayload(current))
  }).catch(() => {})
}

export function updateQuote(id: string, updates: Partial<SavedQuote>): SavedQuote | null {
  const idx = cache.findIndex(q => q.id === id)
  if (idx < 0) return null
  const next: SavedQuote = { ...cache[idx], ...updates }
  cache = cache.map(q => q.id === id ? next : q)
  emit()
  pushQuoteUpdate(id)
  return next
}

export function deleteQuote(id: string): void {
  cache = cache.filter(q => q.id !== id)
  emit()
  enqueue(`quote:${id}`, () => archiveSavedQuote(id)).catch(() => {})
}

export const QUOTES_UPDATED_EVENT = EVT
