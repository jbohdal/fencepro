/**
 * Draft purchase orders in Pending Orders (Jonathan, Oct 28 2026: "Draft
 * purchase orders from a hand move show in Pending Orders, marked Draft").
 *
 * A draft is made when a job's materials are first marked Ordered from this
 * app (jobStore updateJob, purchaseOrderStore createDraftPO), from the quote's
 * pull sheet. The job's Sales Order (portal lib/salesOrders.ts) lists the same
 * parts and also follows approved change orders; it is the one record that
 * says whether the materials are ordered or received. So:
 *
 *   - a draft names the Sales Order of its job and says whether their parts
 *     agree (compareToSalesOrder);
 *   - "Mark ordered" on a draft marks that Sales Order Ordered when it is
 *     still pending (the same step as Mark Ordered on the Sales Order), and
 *     closes the draft; it never makes a second "ordered" of its own;
 *   - "Discard draft" closes it without touching the Sales Order or the job.
 *
 * A closed draft (ordered or cancelled) leaves Pending Orders. Pure (no app
 * imports): the portal tests use it too.
 */

import { posToCents } from '../../portal/src/server/lib/poCents'

export interface DraftLineLike { id: string; itemName: string; quantity: number; unitCostCents: number; totalCents: number }

export interface DraftLike {
  id: string
  poNumber: string
  jobId: string
  jobName: string
  jobAddress?: string
  supplier: string
  status: string
  lineItems: DraftLineLike[]
  subtotalCents: number
  createdAt: string
  orderedAt?: string
  cancelledAt?: string
}

export interface SalesOrderLike {
  id: string
  jobId?: string
  quoteId?: string
  quoteName?: string
  status: string
  items: Array<{ itemName: string; requiredQuantity: number }>
  createdAt: string
  orderedAt?: string
  receivedAt?: string
}

/**
 * The saved purchase orders, money in integer cents. A draft saved in dollars
 * before audit #53 (unitCost, total, subtotal) is turned into cents once, as
 * it is read, by the same rule as the backfill (portal lib/poCents.ts,
 * scripts/po-cents-2026-10-28.ts): review Oct 28 2026, such a draft showed
 * "—" for every price and its subtotal. Nothing in dollars: the list as kept.
 * The copy in cents is what the next change saves.
 */
export function purchaseOrdersInCents<T>(saved: unknown): T[] {
  const { list, changed } = posToCents(saved)
  return (changed ? list : Array.isArray(saved) ? saved : []) as T[]
}

/** The supplier a draft is made with when its lines name none (purchaseOrderStore createDraftPO). */
export const NO_SUPPLIER = 'Default Supplier'

/** The draft's supplier, or null when none is known. */
export function supplierOf(po: Pick<DraftLike, 'supplier'>): string | null {
  const s = (po.supplier ?? '').trim()
  return s && s !== NO_SUPPLIER ? s : null
}

/** The drafts Pending Orders shows: still drafts, newest first. */
export function shownDrafts<T extends DraftLike>(pos: readonly T[] | null | undefined): T[] {
  return (Array.isArray(pos) ? pos : [])
    .filter(p => p && p.status === 'draft')
    .slice()
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

/**
 * The Sales Order of a draft's job: the job's own order (by jobId), else the
 * order of the job's quote; never a cancelled one; the newest if more than one.
 */
export function salesOrderOfDraft<T extends SalesOrderLike>(po: Pick<DraftLike, 'jobId'>, orders: readonly T[] | null | undefined, quoteIdOfJob?: string | null): T | null {
  const live = (Array.isArray(orders) ? orders : []).filter(o => o && o.status !== 'cancelled')
  const newest = (list: T[]) => list.slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null
  const byJob = live.filter(o => !!po.jobId && o.jobId === po.jobId)
  if (byJob.length) return newest(byJob)
  const byQuote = quoteIdOfJob ? live.filter(o => !o.jobId && o.quoteId === quoteIdOfJob) : []
  return byQuote.length ? newest(byQuote) : null
}

const key = (name: string) => String(name ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

export interface DraftVsOrder {
  same: boolean
  /** Parts on the draft that the Sales Order does not have. */
  onlyDraft: string[]
  /** Parts on the Sales Order that the draft does not have. */
  onlyOrder: string[]
  /** Parts on both, in different quantities. */
  qtyDiffers: Array<{ itemName: string; draft: number; order: number }>
}

/** Do a draft and its Sales Order list the same parts in the same quantities (by part name)? */
export function compareToSalesOrder(po: Pick<DraftLike, 'lineItems'>, so: Pick<SalesOrderLike, 'items'>): DraftVsOrder {
  const sum = (lines: Array<{ name: string; qty: number }>) => {
    const m = new Map<string, { name: string; qty: number }>()
    for (const l of lines) {
      const k = key(l.name)
      if (!k) continue
      const hit = m.get(k)
      if (hit) hit.qty += l.qty
      else m.set(k, { name: l.name.trim(), qty: l.qty })
    }
    return m
  }
  const d = sum((po.lineItems ?? []).map(l => ({ name: l.itemName, qty: Number(l.quantity) || 0 })))
  const o = sum((so.items ?? []).map(l => ({ name: l.itemName, qty: Number(l.requiredQuantity) || 0 })))
  const onlyDraft = [...d.entries()].filter(([k]) => !o.has(k)).map(([, v]) => v.name)
  const onlyOrder = [...o.entries()].filter(([k]) => !d.has(k)).map(([, v]) => v.name)
  const qtyDiffers = [...d.entries()].filter(([k, v]) => o.has(k) && o.get(k)!.qty !== v.qty).map(([k, v]) => ({ itemName: v.name, draft: v.qty, order: o.get(k)!.qty }))
  return { same: !onlyDraft.length && !onlyOrder.length && !qtyDiffers.length, onlyDraft, onlyOrder, qtyDiffers }
}

const STATUS_WORD: Record<string, string> = { pending: 'Pending', ordered: 'Ordered', received: 'Received' }

/** One line on the draft about its job's Sales Order, in words. */
export function relationText(so: SalesOrderLike | null, cmp: DraftVsOrder | null): string {
  if (!so) return 'This job has no Sales Order. Its materials are tracked on the job.'
  const st = STATUS_WORD[so.status] ?? so.status
  if (!cmp || cmp.same) return `Same parts as the job's Sales Order (${st}).`
  const bits: string[] = []
  if (cmp.qtyDiffers.length) bits.push(`${cmp.qtyDiffers.length} part${cmp.qtyDiffers.length === 1 ? '' : 's'} in another quantity`)
  if (cmp.onlyDraft.length) bits.push(`${cmp.onlyDraft.length} only on this draft`)
  if (cmp.onlyOrder.length) bits.push(`${cmp.onlyOrder.length} only on the Sales Order`)
  return `Not the same as the job's Sales Order (${st}): ${bits.join(', ')}. The Sales Order follows change orders; order from it.`
}

/** What "Mark ordered" on a draft does to its job's Sales Order. */
export type OrderedStep = 'mark_sales_order' | 'sales_order_already' | 'no_sales_order'

export function orderedStep(so: Pick<SalesOrderLike, 'status'> | null): OrderedStep {
  if (!so) return 'no_sales_order'
  return so.status === 'pending' ? 'mark_sales_order' : 'sales_order_already'
}

/**
 * The PO list with one draft closed as ordered or cancelled (dated now). Null
 * when it is not there or is no longer a draft (closed on another phone).
 */
export function closeDraft<T extends DraftLike>(pos: readonly T[], id: string, to: 'ordered' | 'cancelled', nowIso: string): T[] | null {
  const i = pos.findIndex(p => p.id === id)
  if (i < 0 || pos[i].status !== 'draft') return null
  const next = pos.slice()
  next[i] = { ...pos[i], status: to, ...(to === 'ordered' ? { orderedAt: nowIso } : { cancelledAt: nowIso }) }
  return next
}
