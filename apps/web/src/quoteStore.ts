/**
 * Unified saved-quote store — single source of truth for SavedQuote records.
 *
 * Mirrors the customerStore.ts pattern: hydrated by initQuotes() once after
 * auth, kept fresh by every save call, and broadcast to listeners via the
 * `fencepro:quotes:updated` event. Reads are synchronous cache lookups.
 *
 * Public surface preserves the legacy SavedQuote shape exported from
 * QuotesPage so existing callers (QuoteBuilder, QuoteDetailDrawer,
 * JobsPage, signedContractFlow, BudgetPage, etc.) keep working
 * with a one line import swap.
 */

import {
  listSavedQuotes,
  type SavedQuoteRecord,
  type SavedQuotePayload, lastListServerTime } from './savedQuotesApi'
import type { SavedQuote } from './QuotesPage'
import { newId } from './recordSync'
import { registerKind, enqueue, hasPending, reapply, pendingFor, type Op } from './outbox'
import { sendJson } from './syncHttp'
import { asTable } from './listTable'
import { businessDate } from './businessDate'
import { toast } from './toast'

const EVT = 'fencepro:quotes:updated'

const uid = () => Math.random().toString(36).slice(2, 10)

let cache: SavedQuote[] = []
/** Archived quotes (not deleted): kept for search and reports; never on the active lists. */
let archivedCache: SavedQuote[] = []
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
    layout: r.layout || undefined,
    proposal: r.proposal || undefined,
    chosenOption: r.chosenOption ?? null,
    acceptedAt: r.acceptedAt ?? undefined,
    soldAt: r.soldAt ?? null,
    shareToken: r.shareToken ?? null,
    shareExpiresAt: r.shareExpiresAt ?? null,
    shareDisabledAt: r.shareDisabledAt ?? null,
    acceptedBy: r.acceptedBy ?? undefined,
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
    // A Salesman's or Installer's copy comes without costs (prices only): those read as 0.
    materialCost: r.materialCost ?? 0,
    laborCost: r.laborCost ?? 0,
    tearOutCost: r.tearOutCost ?? 0,
    totalCOGS: r.totalCOGS ?? 0,
    finalPrice: r.finalPrice,
    gmPct: r.gmPct ?? 0,
    pullSheet: Array.isArray(r.pullSheet) ? r.pullSheet.map(l => ({ ...l, unitCost: l.unitCost ?? 0, total: l.total ?? 0 })) : [],
    status: r.status,
    date: r.date,
    notes: r.notes,
    leadTemp: r.leadTemp,
    pricing: r.pricing || undefined,
    work: r.work || undefined,
    needsResend: !!r.needsResend,
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
    layout: q.layout ?? null,
    proposal: q.proposal ?? null,
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
    work: q.work ?? null,
    // The list's slim copy is never sent back: the server keeps the proposal as saved (portal lib/quoteSlim.ts).
    ...(q.proposal?.slim ? { proposal: undefined } : {}),
    ...(q.needsResend !== undefined ? { needsResend: !!q.needsResend } : {}),
    // A Salesman's or Installer's save: the quote builder's inputs, so the server works out the costs.
    ...(q.priceRequest ? { priceRequest: q.priceRequest } : {}),
  }
}

function emit() {
  try { window.dispatchEvent(new CustomEvent(EVT)) } catch {}
}

/**
 * Hydrate the in memory cache from /api/saved-quotes. Idempotent.
 */
export function initQuotes(): Promise<void> {
  if (hydrated) return Promise.resolve()
  if (initPromise) return initPromise
  initPromise = (async () => {
    const records = await listSavedQuotes()
    if (!records) return
    cache = records.map(fromApi)
    hydrated = true
    // The next refresh asks only for what changed after this read.
    lastSync = lastListServerTime() ?? lastSync
    void loadArchivedQuotes()
    // Quotes saved on this phone and not on the server yet.
    reapply('quote.')
    emit()
  })().finally(() => { if (!hydrated) initPromise = null })
  return initPromise
}

/** True once quotes have loaded from the server. */
export function isQuotesHydrated(): boolean { return hydrated }

export function getQuotes(): SavedQuote[] {
  return cache
}

/** Archived quotes (with their customer, or on their own): for search and reports. */
export function getArchivedQuotes(): SavedQuote[] {
  return archivedCache
}

async function loadArchivedQuotes(): Promise<void> {
  const r = await sendJson('GET', '/api/saved-quotes?archived=1')
  if (!r.result.ok || !Array.isArray(r.json?.data)) return
  archivedCache = (r.json.data as SavedQuoteRecord[]).map(fromApi)
  emit()
}

export function getQuoteById(id: string): SavedQuote | null {
  return cache.find(q => q.id === id) || null
}

// ── One quote, whole (the phone load cut, Oct 28 2026) ──────────────────────
// The list comes without each proposal's drawing and option copies (portal
// lib/quoteSlim.ts; proposal.slim). A screen that opens one quote and needs
// them (the quote builder, the Send box) asks for the whole quote here; it
// replaces the list's copy, and stays whole while the screen has it open.

/** Is this the list's slim copy (no drawing, no option copies)? */
export const isSlimQuote = (q: { proposal?: { slim?: true } | null } | null | undefined): boolean => !!q?.proposal?.slim

/** Quotes a screen has open: a newer slim copy from a refresh is made whole again. */
const wanted = new Map<string, number>()
const loading = new Map<string, Promise<SavedQuote | null>>()

/**
 * The quote with its whole proposal: from this phone when it has it, else read
 * from the server (and kept). Null: not on the server for this login, or no
 * signal (the caller says so).
 */
export function loadFullQuote(id: string): Promise<SavedQuote | null> {
  const have = cache.find(q => q.id === id) ?? archivedCache.find(q => q.id === id) ?? null
  if (have && !isSlimQuote(have)) return Promise.resolve(have)
  const going = loading.get(id)
  if (going) return going
  const p = (async () => {
    const r = await sendJson('GET', `/api/saved-quotes/${encodeURIComponent(id)}`)
    if (!r.result.ok || !r.json?.data) return null
    const full = fromApi(r.json.data as SavedQuoteRecord)
    // An edit made on this phone meanwhile wins; only the proposal is taken (it is the part the list left out).
    const merge = (list: SavedQuote[]) => list.map(q => (q.id === id ? (isSlimQuote(q) ? { ...q, proposal: full.proposal } : q) : q))
    cache = merge(cache)
    archivedCache = merge(archivedCache)
    emit()
    return cache.find(q => q.id === id) ?? archivedCache.find(q => q.id === id) ?? full
  })().finally(() => loading.delete(id))
  loading.set(id, p)
  return p
}

/** A screen has this quote open (whole); call the returned function when it closes. */
export function holdFullQuote(id: string): () => void {
  wanted.set(id, (wanted.get(id) ?? 0) + 1)
  void loadFullQuote(id)
  return () => {
    const n = (wanted.get(id) ?? 1) - 1
    if (n > 0) wanted.set(id, n); else wanted.delete(id)
  }
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
    layout: partial.layout,
    proposal: partial.proposal,
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
    date: partial.date || businessDate(new Date()),
    notes: partial.notes || '',
    leadTemp: partial.leadTemp ?? 0,
    pricing: partial.pricing,
    work: partial.work,
    ...(partial.priceRequest ? { priceRequest: partial.priceRequest } : {}),
  }
  cache = [fresh, ...cache]
  emit()

  void enqueue<SavedQuote>({ key: `quote:${tempId}`, kind: 'quote.create', payload: fresh, label: quoteLabel(fresh, 'new quote'), after: customerKeys(fresh) })

  return fresh
}

const quoteLabel = (q: SavedQuote, what: string) => `${q.customerName || 'Quote'}, ${what}`
/** A quote for a customer still on the way to the server waits for that customer. */
const customerKeys = (q: SavedQuote) => (q.customerId && pendingFor(`customer:${q.customerId}`).some(o => o.kind === 'customer.create') ? [`customer:${q.customerId}`] : [])

/** Send the newest copy of a quote. Goes after its create and earlier edits. */
function pushQuoteUpdate(id: string): void {
  const current = cache.find(q => q.id === id)
  if (!current) return
  void enqueue<SavedQuote>({ key: `quote:${id}`, kind: 'quote.update', payload: current, label: quoteLabel(current, 'quote changes'), after: customerKeys(current) })
}

const takeServerFields = (op: Op<SavedQuote>, data: unknown) => {
  const id = op.payload.id
  // Never over an edit made while this was on its way.
  if (!data || hasPending(`quote:${id}`)) return
  const fromServer = fromApi(data as SavedQuoteRecord)
  cache = cache.map(q => q.id === id ? { ...fromServer, id } : q)
  emit()
}

registerKind<SavedQuote>('quote.create', {
  refused: () => reloadQuotes(),
  what: () => 'This quote',
  send: op => sendJson('POST', '/api/saved-quotes', { ...toApiPayload(op.payload), id: op.payload.id }).then(r => r.result),
  confirmed: takeServerFields,
  apply: op => { if (!cache.some(q => q.id === op.payload.id)) cache = [op.payload, ...cache] },
})
registerKind<SavedQuote>('quote.update', {
  refused: () => reloadQuotes(),
  what: () => 'This change to the quote',
  send: op => sendJson('PATCH', `/api/saved-quotes/${encodeURIComponent(op.payload.id)}`, toApiPayload(op.payload)).then(r => r.result),
  confirmed: takeServerFields,
  apply: op => { cache = cache.map(q => q.id === op.payload.id ? op.payload : q) },
})
registerKind<{ id: string }>('quote.archive', {
  refused: () => reloadQuotes(),
  what: () => 'Removing this quote',
  send: async op => {
    const r = await sendJson('DELETE', `/api/saved-quotes/${encodeURIComponent(op.payload.id)}`)
    return r.status === 404 ? { ok: true } : r.result
  },
  apply: op => { cache = cache.filter(q => q.id !== op.payload.id) },
})

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
  const was = cache.find(q => q.id === id)
  cache = cache.filter(q => q.id !== id)
  emit()
  void enqueue({ key: `quote:${id}`, kind: 'quote.archive', payload: { id }, label: was ? quoteLabel(was, 'quote removed') : 'Quote removed' })
}

export const QUOTES_UPDATED_EVENT = EVT

/** Read the whole list again: a change was refused, so the screen goes back to what the server has. */
function reloadQuotes() { lastSync = null; void refreshQuotes() }

/** When this list was last read from the server (the server's own clock). */
let lastSync: string | null = null

/** Drop every quote not in `ids` (none waiting to be sent); how many went. Not a list: nothing. */
function keepOnly(ids: unknown, waiting: (id: string) => boolean): number {
  if (!Array.isArray(ids)) return 0
  const keep = new Set(ids as string[])
  const before = cache.length + archivedCache.length
  cache = cache.filter(q => keep.has(q.id) || waiting(q.id))
  archivedCache = archivedCache.filter(q => keep.has(q.id) || waiting(q.id))
  return before - cache.length - archivedCache.length
}

/**
 * Read the list again (the server changes some on its own: a customer
 * accepting online). Only what changed since the last read comes back, so it
 * is small on cell data. Waiting changes stay on top. Quiet with no signal.
 */
export async function refreshQuotes(): Promise<void> {
  if (!hydrated) return
  const r = await sendJson('GET', asTable(`/api/saved-quotes${lastSync ? `?since=${encodeURIComponent(lastSync)}` : ''}`))
  if (!r.result.ok || !Array.isArray(r.json?.data)) return
  const rows = r.json.data as Array<SavedQuoteRecord & { archivedAt?: string | null; deletedAt?: string | null }>
  if (r.json.partial) {
    if (rows.length) {
      const byId = new Map(cache.map(x => [x.id, x]))
      const arch = new Map(archivedCache.map(x => [x.id, x]))
      for (const row of rows) {
        const was = byId.get(row.id)
        arch.delete(row.id)
        // Deleted: off both lists. Archived: off the active list, on the archived one.
        if (row.deletedAt) { byId.delete(row.id); continue }
        if (row.archivedAt) { byId.delete(row.id); arch.set(row.id, fromApi(row)); continue }
        const now = fromApi(row)
        // A customer accepted online while the app was open: say so.
        if (was && !was.acceptedAt && now.acceptedAt) {
          try { toast.success('Proposal accepted', `${now.customerName || 'A customer'} accepted online. The quote is Sold and the job is in Operations.`) } catch { /* no screen */ }
        }
        byId.set(row.id, now)
      }
      cache = [...byId.values()]
      archivedCache = [...arch.values()]
    }
  } else { cache = rows.map(fromApi); void loadArchivedQuotes() }
  // A Salesman's small refresh says which quotes are still hers (keepOnly): one moved to someone else leaves this copy.
  const dropped = keepOnly(r.json.keepOnly, id => hasPending(`quote:${id}`))
  if (typeof r.json.serverTime === 'string') lastSync = r.json.serverTime
  if (!r.json.partial || rows.length || dropped) { reapply('quote.'); emit() }
  // A quote a screen has open came back as the list's slim copy: read it whole again.
  for (const id of wanted.keys()) if (isSlimQuote(cache.find(q => q.id === id))) void loadFullQuote(id)
}
