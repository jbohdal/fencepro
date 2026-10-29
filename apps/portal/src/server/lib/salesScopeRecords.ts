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
 *   Write: the phone may change or remove only an entry that was on the copy
 *          it was handed (lib/salesServed.ts) and is still in the scope.
 *          Every other entry (hidden now, hidden when the phone read it, or
 *          given to the Salesman since) is put back exactly as stored, in its
 *          place, before saving. The Salesman's save can add or change only
 *          entries within the scope; one sent for a customer, job or quote
 *          outside it is refused (404, as for a record that is not there).
 *
 * Entries tied to no customer, job or quote (settings, the catalog, company
 * config, a stock purchase order) are kept as they are. Every other login is
 * unchanged.
 */

import type { SalesScope } from './salesScope.js'
import { entryKey, keysOfList, hadList, type Had } from './salesServed.js'

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

/** What the phone held of one list (lib/salesServed.ts); nothing by default. */
export interface HadList { sure: Set<string>; seen: Set<string> }
const NONE: HadList = { sure: new Set(), seen: new Set() }

export interface MergeOptions {
  /** One more test for an entry the Salesman does not see (a payment on a hidden invoice). */
  hidden?: (e: Record<string, unknown>) => boolean
  /** The entries on the phone's copy of the version the save is built on (default: none). */
  had?: HadList
  /** The app only ever adds to this list (pull sheets, the activity log): the Salesman's save removes nothing. */
  keepRemoved?: boolean
}

/** A merged list, and the entries of the phone's own now in it (the phone's copy after the save). */
export interface Merged { value: unknown; accepted: Set<string> }

/**
 * The list to save for the Salesman: what the Salesman sent, with every entry
 * the save may not touch put back exactly as stored, each after the entry it
 * followed (so a list sent back unchanged saves exactly as it was stored).
 *
 * The phone may change or remove only an entry that was on its copy (`had`)
 * and is still in the Salesman's scope. Put back as stored: an entry hidden
 * now; one the phone never had (a customer given to the Salesman after the
 * phone read the record, Oct 29 2026); one left out that was not on every
 * copy of this version handed to the Salesman; and, with keepRemoved, any one
 * left out. An entry sent with the id of one the phone may not touch is not
 * the Salesman's to change: the stored one stays. A new or changed entry
 * outside the scope throws OutsideScopeError.
 */
export function mergeListWithKeys(s: SalesScope, saved: unknown, incoming: unknown, opts: MergeOptions = {}): Merged {
  const before = Array.isArray(saved) ? saved : []
  const had = opts.had ?? NONE
  const hiddenNow = (e: unknown) => entryPlace(s, e) === 'out' || (!!opts.hidden && isObj(e) && opts.hidden(e))
  // Stored entries the phone may not touch at all: hidden now, or never on its copy.
  const untouchable = (e: unknown) => hiddenNow(e) || !had.seen.has(entryKey(e))
  const removable = (e: unknown) => !untouchable(e) && !opts.keepRemoved && had.sure.has(entryKey(e))
  if (!Array.isArray(incoming)) {
    // Not a list (cleared, or another shape): only when every stored entry may be removed.
    if (!before.every(removable)) throw new OutsideScopeError()
    return { value: incoming, accepted: new Set() }
  }
  const keptIds = new Set<string>()
  const keptContent = new Map<string, number>()
  for (const e of before) {
    if (!untouchable(e)) continue
    const id = idOf(e)
    if (id) keptIds.add(id)
    else { const k = entryKey(e); keptContent.set(k, (keptContent.get(k) ?? 0) + 1) }
  }
  const sent: unknown[] = []
  for (const e of incoming) {
    const id = idOf(e)
    if (id && keptIds.has(id)) continue
    if (!id) {
      const k = entryKey(e), n = keptContent.get(k) ?? 0
      if (n > 0) { keptContent.set(k, n - 1); continue }
    }
    // A new or changed entry for someone else's customer, job or quote.
    if (entryPlace(s, e) === 'out') throw new OutsideScopeError()
    sent.push(e)
  }
  const present = new Set(sent.map(entryKey))
  const kept = (e: unknown) => untouchable(e) || (!present.has(entryKey(e)) && !removable(e))
  // Put each kept entry back after the nearest entry before it that is still there.
  const out = [...sent]
  const position = new Map<string, number>()
  const reindex = () => { position.clear(); out.forEach((e, i) => { const id = idOf(e); if (id && !position.has(id)) position.set(id, i) }) }
  reindex()
  let lastAnchor = -1
  for (const e of before) {
    if (kept(e)) {
      out.splice(lastAnchor + 1, 0, e)
      lastAnchor += 1
      reindex()
      continue
    }
    const id = idOf(e)
    const at = id ? position.get(id) : undefined
    if (at !== undefined) lastAnchor = at
  }
  return { value: out, accepted: present }
}

/** mergeListWithKeys, the list only. */
export function mergeList(s: SalesScope, saved: unknown, incoming: unknown, opts: MergeOptions = {}): unknown {
  return mergeListWithKeys(s, saved, incoming, opts).value
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

/**
 * The object to save: the Salesman's keys as sent, every other key as stored.
 * As for a list, a key the phone did not have (`had`, as 'key:<id>') is kept
 * as stored, and one left out is removed only when it was on every copy.
 */
export function mergeByKeyWithKeys(s: SalesScope, saved: unknown, incoming: unknown, had: HadList = NONE): Merged {
  const before = isObj(saved) ? saved : {}
  const mine = (k: string) => s.jobIds.has(k) || s.quoteIds.has(k)
  const untouchable = (k: string) => !mine(k) || !had.seen.has(`key:${k}`)
  const removable = (k: string) => !untouchable(k) && had.sure.has(`key:${k}`)
  if (!isObj(incoming)) {
    if (!Object.keys(before).every(removable)) throw new OutsideScopeError()
    return { value: incoming, accepted: new Set() }
  }
  const out: Record<string, unknown> = {}
  const accepted = new Set<string>()
  for (const [k, v] of Object.entries(before)) {
    if (untouchable(k)) out[k] = v
    else if (k in incoming) { out[k] = incoming[k]; accepted.add(`key:${k}`) }
    else if (!removable(k)) out[k] = v
  }
  for (const [k, v] of Object.entries(incoming)) {
    if (k in out || k in before) continue
    if (!mine(k)) throw new OutsideScopeError()
    out[k] = v
    accepted.add(`key:${k}`)
  }
  return { value: out, accepted }
}

/** mergeByKeyWithKeys, the object only. */
export function mergeByKey(s: SalesScope, saved: unknown, incoming: unknown, had: HadList = NONE): unknown {
  return mergeByKeyWithKeys(s, saved, incoming, had).value
}

// ── The business record ─────────────────────────────────────────────────────

/** Lists in the business record whose entries belong to a customer, job or quote. */
export const BUSINESS_LISTS = ['invoices', 'payments', 'statements', 'pullSheets', 'pendingOrders', 'purchaseOrders'] as const
/** Kept by job (or quote) id: each job's milestones. */
export const BUSINESS_BY_KEY = ['jobChecklists'] as const
/** Lists the app only ever adds to (web billingStore.ts linkPullSheetToCustomer): a Salesman's save removes none. */
const BUSINESS_ADD_ONLY = new Set<string>(['pullSheets'])

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

/** The entries of a business record copy, per list, as handed to the Salesman (lib/salesServed.ts). */
export function businessHanded(view: unknown): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  if (!isObj(view)) return out
  for (const k of [...BUSINESS_LISTS, ...BUSINESS_BY_KEY]) if (k in view) out.set(k, keysOfList(view[k]))
  return out
}

/**
 * A Salesman's patch, with every entry the Salesman's phone may not touch put
 * back as stored (`had`: what the phone held at the version the patch is
 * built on). `accepted`: per list sent, the phone's entries now in it.
 * Throws OutsideScopeError.
 */
export function salesBusinessPatch(s: SalesScope, saved: Record<string, unknown> | null, patch: Record<string, unknown>, had: Had): { patch: Record<string, unknown>; accepted: Map<string, Set<string>> } {
  const out: Record<string, unknown> = { ...patch }
  const accepted = new Map<string, Set<string>>()
  const hiddenInv = hiddenInvoiceIds(s, saved?.invoices)
  for (const k of BUSINESS_LISTS) {
    if (out[k] === undefined) continue
    const m = mergeListWithKeys(s, saved?.[k], out[k], { hidden: k === 'payments' ? onHiddenInvoice(hiddenInv) : undefined, had: hadList(had, k), keepRemoved: BUSINESS_ADD_ONLY.has(k) })
    out[k] = m.value
    accepted.set(k, m.accepted)
  }
  for (const k of BUSINESS_BY_KEY) {
    if (out[k] === undefined) continue
    const m = mergeByKeyWithKeys(s, saved?.[k], out[k], hadList(had, k))
    out[k] = m.value
    accepted.set(k, m.accepted)
  }
  return { patch: out, accepted }
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
 * Keys the app only ever adds to: the activity log (web customerStore.ts
 * logCustomerActivity; its trim to the newest entries is not a delete) and
 * imported quotes (CustomersPage.tsx import). A Salesman's save removes none
 * of their entries, so a list sent empty or short by mistake deletes nothing.
 */
const KV_ADD_ONLY: ReadonlySet<string> = new Set(['fencepro_customer_activity', 'fencepro_imported_quotes'])

/** The one list of a kv key, as lib/salesServed.ts names it. */
export const KV_LIST = 'value'

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

/**
 * One key's value to save from the Salesman: what the phone may not touch
 * back as stored (`had`: what the phone held at the version the save is built
 * on). `accepted`: the phone's entries now in it (null: not a per customer key).
 * Throws OutsideScopeError.
 */
export function salesKvValue(s: SalesScope, key: string, saved: unknown, value: unknown, had: Had): { value: unknown; accepted: Set<string> | null } {
  if (!KV_PER_CUSTOMER.has(key)) return { value, accepted: null }
  const m = mergeListWithKeys(s, saved, value, { had: hadList(had, KV_LIST), keepRemoved: KV_ADD_ONLY.has(key) })
  return { value: m.value, accepted: m.accepted }
}
