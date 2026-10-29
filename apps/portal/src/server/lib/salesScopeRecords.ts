/**
 * The Salesman's copy of the company-wide records (Jonathan, Oct 28 2026:
 * "Salesman sees only her own quotes and customers, plus any assigned to her").
 *
 * The business record (/api/business-state) and the key-value store (/api/kv)
 * are each one company-wide record that the Salesman's phone reads and saves
 * back whole. So, for the Salesman only:
 *
 *   Read:  an entry tied to a customer, job or quote outside the Salesman's
 *          scope (lib/salesScope.ts) is left out of the answer.
 *   Write: every entry left out is put back exactly as stored, in its place,
 *          before saving. The Salesman's save can add or change only entries
 *          within the scope; one sent for a customer, job or quote outside it
 *          is refused (404, as for a record that is not there).
 *
 * Entries tied to no customer, job or quote (settings, the catalog, company
 * config, a stock purchase order) are kept as they are. Every other login is
 * unchanged.
 */

import type { SalesScope } from './salesScope.js'

const CONTACT_REFS = ['customerId', 'crmContactId', 'contactId', 'crmCustomerId'] as const
const JOB_REFS = ['jobId', 'adoptedJobId', 'savedJobId'] as const
const QUOTE_REFS = ['quoteId', 'savedQuoteId'] as const
/** Words that tie an entry to a customer when it carries no id (an older entry): who it is for, or where. */
const NAME_REFS = ['customerName', 'customerPhone', 'customerEmail', 'customerAddress', 'jobName', 'jobAddress'] as const

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export type EntryPlace = 'in' | 'out' | 'untied'

/**
 * Where one entry stands for the Salesman: 'untied' (no customer, job or
 * quote), 'in' (every customer, job and quote it names is in the scope), or
 * 'out' (one of them is not, or it names a customer only by name or address).
 */
export function entryPlace(s: SalesScope, e: unknown): EntryPlace {
  if (!isObj(e)) return 'untied'
  let tied = false
  for (const k of CONTACT_REFS) { const id = str(e[k]); if (id) { tied = true; if (!s.contactIds.has(id)) return 'out' } }
  for (const k of JOB_REFS) { const id = str(e[k]); if (id) { tied = true; if (!s.jobIds.has(id)) return 'out' } }
  for (const k of QUOTE_REFS) { const id = str(e[k]); if (id) { tied = true; if (!s.quoteIds.has(id)) return 'out' } }
  if (tied) return 'in'
  return NAME_REFS.some(k => str(e[k])) ? 'out' : 'untied'
}

/** The Salesman's view of one list: the entries outside the scope left out (`also`: one more test, e.g. a payment on a hidden invoice). */
export function visibleList(s: SalesScope, list: unknown, also?: (e: Record<string, unknown>) => boolean): unknown {
  if (!Array.isArray(list)) return list
  return list.filter(e => entryPlace(s, e) !== 'out' && !(also && isObj(e) && also(e)))
}

const idOf = (e: unknown): string | null => (isObj(e) ? str(e.id) ?? str(e.token) : null)

export class OutsideScopeError extends Error {
  status = 404
  constructor() { super('Not found') }
}

/**
 * The list to save for the Salesman: what the Salesman sent, with every entry
 * hidden from the Salesman put back exactly as stored, each after the entry it
 * followed (so a list sent back unchanged saves exactly as it was stored).
 *
 * An entry sent with the id of a hidden one is not the Salesman's to change:
 * the stored one stays. A new or changed entry outside the scope throws
 * OutsideScopeError.
 */
export function mergeList(s: SalesScope, saved: unknown, incoming: unknown, hidden?: (e: Record<string, unknown>) => boolean): unknown {
  const before = Array.isArray(saved) ? saved : []
  const isHidden = (e: unknown) => entryPlace(s, e) === 'out' || (!!hidden && isObj(e) && hidden(e))
  const hiddenIds = new Set(before.filter(isHidden).map(idOf).filter((x): x is string => !!x))
  if (!Array.isArray(incoming)) {
    // Not a list (cleared, or another shape): only allowed when nothing was hidden.
    if (before.some(isHidden)) throw new OutsideScopeError()
    return incoming
  }
  const sent: unknown[] = []
  for (const e of incoming) {
    const id = idOf(e)
    if (id && hiddenIds.has(id)) continue
    // A new or changed entry for someone else's customer, job or quote.
    if (entryPlace(s, e) === 'out') throw new OutsideScopeError()
    sent.push(e)
  }
  // Put each hidden entry back after the nearest entry before it that is still there.
  const out = [...sent]
  const position = new Map<string, number>()
  const reindex = () => { position.clear(); out.forEach((e, i) => { const id = idOf(e); if (id && !position.has(id)) position.set(id, i) }) }
  reindex()
  let lastAnchor = -1
  for (const e of before) {
    if (isHidden(e)) {
      out.splice(lastAnchor + 1, 0, e)
      lastAnchor += 1
      reindex()
      continue
    }
    const id = idOf(e)
    const at = id ? position.get(id) : undefined
    if (at !== undefined) lastAnchor = at
  }
  return out
}

/**
 * An object keyed by job or quote id (the business record's job checklists):
 * the Salesman's view keeps only the keys of the Salesman's jobs and quotes.
 */
export function visibleByKey(s: SalesScope, value: unknown): unknown {
  if (!isObj(value)) return value
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) if (s.jobIds.has(k) || s.quoteIds.has(k)) out[k] = v
  return out
}

/** The object to save: the Salesman's keys as sent, every other key as stored. */
export function mergeByKey(s: SalesScope, saved: unknown, incoming: unknown): unknown {
  const before = isObj(saved) ? saved : {}
  const mine = (k: string) => s.jobIds.has(k) || s.quoteIds.has(k)
  if (!isObj(incoming)) {
    if (Object.keys(before).some(k => !mine(k))) throw new OutsideScopeError()
    return incoming
  }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(before)) {
    if (!mine(k)) out[k] = v
    else if (k in incoming) out[k] = incoming[k]
  }
  for (const [k, v] of Object.entries(incoming)) {
    if (k in out) continue
    if (!mine(k)) throw new OutsideScopeError()
    out[k] = v
  }
  return out
}

// ── The business record ─────────────────────────────────────────────────────

/** Lists in the business record whose entries belong to a customer, job or quote. */
export const BUSINESS_LISTS = ['invoices', 'payments', 'statements', 'pullSheets', 'pendingOrders', 'purchaseOrders'] as const
/** Kept by job (or quote) id: each job's milestones. */
export const BUSINESS_BY_KEY = ['jobChecklists'] as const

/** Invoices the Salesman does not see (a payment on one is hidden with it). */
function hiddenInvoiceIds(s: SalesScope, invoices: unknown): Set<string> {
  const out = new Set<string>()
  if (Array.isArray(invoices)) for (const e of invoices) if (entryPlace(s, e) === 'out') { const id = idOf(e); if (id) out.add(id) }
  return out
}
const onHiddenInvoice = (ids: Set<string>) => (e: Record<string, unknown>) => !!str(e.invoiceId) && ids.has(e.invoiceId as string)

/** The business record as the Salesman reads it (a copy; null and other shapes pass). */
export function salesBusinessView<T>(s: SalesScope, record: T): T {
  if (!isObj(record)) return record
  const out: Record<string, unknown> = { ...record }
  const hiddenInv = hiddenInvoiceIds(s, record.invoices)
  for (const k of BUSINESS_LISTS) {
    if (k in out) out[k] = visibleList(s, out[k], k === 'payments' ? onHiddenInvoice(hiddenInv) : undefined)
  }
  for (const k of BUSINESS_BY_KEY) if (k in out) out[k] = visibleByKey(s, out[k])
  return out as T
}

/** A Salesman's patch, with every entry hidden from the Salesman put back as stored. Throws OutsideScopeError. */
export function salesBusinessPatch(s: SalesScope, saved: Record<string, unknown> | null, patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...patch }
  const hiddenInv = hiddenInvoiceIds(s, saved?.invoices)
  for (const k of BUSINESS_LISTS) {
    if (out[k] === undefined) continue
    out[k] = mergeList(s, saved?.[k], out[k], k === 'payments' ? onHiddenInvoice(hiddenInv) : undefined)
  }
  for (const k of BUSINESS_BY_KEY) {
    if (out[k] === undefined) continue
    out[k] = mergeByKey(s, saved?.[k], out[k])
  }
  return out
}

// ── The key-value store ─────────────────────────────────────────────────────

/**
 * Keys whose entries belong to a customer, job or quote: the customer
 * activity log (customerId), quote share links (quoteId, with the customer's
 * signature and change requests), job costing lines (quoteId), the old change
 * orders (quoteId) and imported quotes (customerId).
 *
 * Left company wide, Jonathan's word (Oct 28 2026): site plans and their
 * files (fencepro_siteplans, fencepro_files).
 */
export const KV_PER_CUSTOMER: ReadonlySet<string> = new Set([
  'fencepro_customer_activity', 'fencepro_quote_shares', 'fencepro_jobcosting', 'fencepro_changeorders', 'fencepro_imported_quotes',
])

/**
 * Keys only the server keeps that list customers' phones and records (the
 * duplicate check's alerts): never sent to the Salesman (no screen of the
 * Salesman's reads them, and the Salesman cannot save them).
 */
export const KV_NOT_FOR_SALESMAN = (key: string): boolean => key.startsWith('duplicateCheck')

/** One key's value as the Salesman reads it. */
export function salesKvView(s: SalesScope, key: string, value: unknown): unknown {
  return KV_PER_CUSTOMER.has(key) ? visibleList(s, value) : value
}

/** One key's value to save from the Salesman: the hidden entries back as stored. Throws OutsideScopeError. */
export function salesKvValue(s: SalesScope, key: string, saved: unknown, value: unknown): unknown {
  return KV_PER_CUSTOMER.has(key) ? mergeList(s, saved, value) : value
}
