/**
 * Sales Orders (Inventory > Sales Orders: the materials to order for a sold
 * job), made on the server from the job's own pull sheet (audit Oct 26 2026,
 * item 2): before, the browser made one once, from the quote's pull sheet as
 * it was the first time it was marked Sold, and never again. So Manuel
 * Cotrich's (marked Sold at the white option, then he signed the tan one
 * online) listed white vinyl, an approved +20 ft change order never reached
 * its order, and a job signed on the proposal link got none.
 *
 * Now each sold job's order follows the same lines as its pull sheet on the
 * customer page (lib/customerPullSheets.ts): the newest approved change order
 * that changed the work, else the pull sheet as signed (frozen at signing,
 * else the option the customer chose, else the quote's own). Only parts to
 * order: money only lines (job lot prices) and work lines (tear out, haul
 * away, labor) are left out.
 *
 * Made or brought up to date when a job is made (in the app, on the proposal
 * link, by a website quote marked Sold) and when a change order is approved
 * or changed (lib/changeOrders.ts applyToJob).
 *
 *   pending   not ordered yet: its lines are rewritten to what the job needs.
 *   ordered / received   what was bought stays as it is. When the job needs
 *             more than those cover (a change order after ordering), one
 *             pending order lists only the difference.
 *   cancelled the office cancelled it: never made again for that quote.
 *
 * Stored in BusinessState.pendingOrders (the list the page reads), version
 * checked like every other write to that record. Integer cents.
 */

import prisma from './prisma.js'
import { linesFromSheet, signedLinesOf, type PullSheetLine } from './customerPullSheets.js'
import { quotedCostFor } from './jobCosting.js'
import { currentWorkRow, type StoredWork } from './changeOrderWork.js'
import { isWorkLine } from './workWords.js'
import { plainStyleName } from './estimates.js'
import { findItemId } from './jobCostingMath.js'

export type OrderStatus = 'pending' | 'ordered' | 'received' | 'cancelled'

export interface OrderItem {
  id: string
  inventoryItemId?: string
  itemName: string
  requiredQuantity: number
  unitCostCents: number
  totalCostCents: number
  quantityReceived: number
  receivedAt?: string
  quantityOnHandAtTimeOfOrder?: number
  isSufficientStock?: boolean
}

export interface SalesOrder {
  id: string
  quoteId: string
  quoteName: string
  jobId?: string
  customerId?: string
  customerName: string
  status: OrderStatus
  totalCostCents: number
  items: OrderItem[]
  notes: string
  /** Where the lines come from, in words ("Change order CO-1", "As signed: the option the customer chose"). */
  source?: string
  createdAt: string
  updatedAt: string
  orderedAt?: string
  receivedAt?: string
  cancelledAt?: string
  [k: string]: unknown
}

/** One part the job needs. */
export interface NeedLine { item: string; qty: number; unitCostCents: number }

/** The parts the job needs from its pull sheet lines: no money only or work lines, one line per part (quantities added). */
export function partsToOrder(lines: PullSheetLine[]): NeedLine[] {
  const by = new Map<string, NeedLine>()
  for (const l of lines) {
    if (l.moneyOnly || isWorkLine(l.item) || !(l.qty > 0)) continue
    const k = keyOf(l.item)
    const had = by.get(k)
    const unit = l.unitCostCents ?? (l.qty ? Math.round((l.totalCostCents ?? 0) / l.qty) : 0)
    if (had) had.qty = round3(had.qty + l.qty)
    else by.set(k, { item: l.item, qty: round3(l.qty), unitCostCents: unit })
  }
  return [...by.values()]
}

const keyOf = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const round3 = (n: number) => Math.round(n * 1000) / 1000

/** What the job's order is made from. */
export interface OrderBasis {
  quoteId: string
  jobId: string
  customerId: string | null
  customerName: string
  styleName: string
  source: string
  need: NeedLine[]
}

export interface Planned {
  /** The quote's orders after the change (others untouched). */
  orders: SalesOrder[]
  changed: boolean
  /** In words, for the log and the backfill's dry run. */
  what: string
}

type Stock = Array<{ id?: unknown; name?: unknown; quantity?: unknown }>

const id8 = () => Math.random().toString(36).slice(2, 10)

/**
 * The quote's orders brought up to what its job needs (pure: no database).
 * `existing`: every order of this quote, plus pending ones made for this job
 * from another quote (the job now follows the quote accepted last).
 */
export function planOrders(existing: SalesOrder[], basis: OrderBasis, stock: Stock, now: string, newId: () => string = id8): Planned {
  const mine = existing.filter(o => o.quoteId === basis.quoteId)
  const strays = existing.filter(o => o.quoteId !== basis.quoteId && o.jobId === basis.jobId && o.status === 'pending')
  if (!basis.need.length) return { orders: mine, changed: false, what: 'no parts on the pull sheet; left as it is' }
  const active = mine.filter(o => o.status !== 'cancelled')
  if (mine.length && !active.length) return { orders: mine, changed: false, what: 'cancelled by the office; not made again' }
  const locked = active.filter(o => o.status === 'ordered' || o.status === 'received')
  const open = active.filter(o => o.status === 'pending')

  // Already bought (ordered or received), by part.
  const bought = new Map<string, number>()
  for (const o of locked) for (const i of o.items ?? []) bought.set(keyOf(i.itemName), (bought.get(keyOf(i.itemName)) ?? 0) + (Number(i.requiredQuantity) || 0))
  const short = basis.need.map(n => ({ ...n, qty: round3(n.qty - (bought.get(keyOf(n.item)) ?? 0)) })).filter(n => n.qty > 0)

  const keep = mine.filter(o => o.status !== 'pending')
  if (!short.length) {
    const changed = open.length > 0 || strays.length > 0
    return { orders: keep, changed, what: changed ? 'what was ordered covers the job; the pending order is taken off' : 'up to date' }
  }

  const target = open[0]
  const prevItems = new Map((target?.items ?? []).map(i => [keyOf(i.itemName), i]))
  const items: OrderItem[] = short.map(n => {
    const onHand = qtyOnHand(stock, n.item)
    const was = prevItems.get(keyOf(n.item))
    const inventoryItemId = findItemId(stock as any, n.item) ?? undefined
    return {
      id: was?.id ?? newId(), ...(inventoryItemId ? { inventoryItemId } : {}), itemName: n.item, requiredQuantity: n.qty,
      unitCostCents: n.unitCostCents, totalCostCents: Math.round(n.qty * n.unitCostCents), quantityReceived: 0,
      quantityOnHandAtTimeOfOrder: onHand, isSufficientStock: onHand >= n.qty,
    }
  })
  const totalCostCents = items.reduce((s, i) => s + i.totalCostCents, 0)
  const quoteName = `${basis.styleName} — ${basis.customerName}${locked.length ? ' (more needed after ordering)' : ''}`
  const same = !!target && strays.length === 0 && open.length === 1 && target.quoteName === quoteName && target.jobId === basis.jobId && target.source === basis.source
    && sameItems(target.items ?? [], items)
  if (same) return { orders: mine, changed: false, what: 'up to date' }
  const order: SalesOrder = {
    ...(target ?? {}),
    id: target?.id ?? newId(), quoteId: basis.quoteId, quoteName, jobId: basis.jobId,
    ...(basis.customerId ? { customerId: basis.customerId } : {}), customerName: basis.customerName,
    status: 'pending', totalCostCents, items, notes: target?.notes ?? '', source: basis.source,
    createdAt: target?.createdAt ?? now, updatedAt: now,
  }
  const what = target
    ? `pending order rewritten to the job's pull sheet, ${basis.source} (${items.length} parts, was ${(target.items ?? []).length})`
    : locked.length ? `a pending order for what the job needs beyond what was ordered (${items.length} parts)` : `new order from the job's pull sheet, ${basis.source} (${items.length} parts)`
  return { orders: [order, ...keep], changed: true, what }
}

function sameItems(a: OrderItem[], b: OrderItem[]): boolean {
  if (a.length !== b.length) return false
  const m = new Map(a.map(i => [keyOf(i.itemName), i]))
  return b.every(i => { const x = m.get(keyOf(i.itemName)); return !!x && Number(x.requiredQuantity) === i.requiredQuantity && Number(x.unitCostCents) === i.unitCostCents })
}

function qtyOnHand(stock: Stock, name: string): number {
  const id = findItemId(stock as any, name)
  const it = id ? stock.find(s => s?.id === id) : null
  const n = Number(it?.quantity)
  return Number.isFinite(n) ? n : 0
}

/** What the job of quote `quoteId` needs, or null when the quote has no live job. `db` may be a transaction. */
export async function orderBasisFor(accountId: string, quoteId: string, db: any = prisma): Promise<OrderBasis | null> {
  const job = await db.savedJob.findFirst({ where: { accountId, quoteId, deletedAt: null, archivedAt: null }, select: { id: true, crmContactId: true, customerName: true } })
  if (!job) return null
  const q = await db.savedQuote.findFirst({
    where: { id: quoteId, accountId },
    select: { fenceStyle: true, customerName: true, crmContactId: true, pullSheet: true, proposal: true, chosenOption: true, acceptedAt: true, status: true },
  })
  if (!q) return null
  const cos = await db.changeOrder.findMany({ where: { accountId, quoteId, deletedAt: null }, select: { id: true, number: true, status: true, approvedAt: true, work: true, deletedAt: true } })
  const cur = currentWorkRow(cos as any)
  let lines: PullSheetLine[], source: string, style: string
  if (cur) {
    const w = cur.work as StoredWork
    lines = linesFromSheet(w.pullSheet)
    source = `Change order CO-${(cur as any).number}`
    style = w.fenceStyle || q.fenceStyle
  } else {
    const quoted = await quotedCostFor(accountId, quoteId)
    ;({ lines, source } = signedLinesOf(q, quoted))
    style = quoted?.fenceStyle || q.fenceStyle
  }
  return {
    quoteId, jobId: job.id, customerId: job.crmContactId ?? q.crmContactId ?? null, customerName: job.customerName || q.customerName || '',
    styleName: await plainStyleName(style), source, need: partsToOrder(lines),
  }
}

/**
 * Bring the order of quote `quoteId`'s job up to date (see the top). Returns
 * what it did in words, or null when the quote has no job. `db` may be a
 * transaction (a change order's approval saves the order with it).
 */
export async function syncSalesOrder(accountId: string, quoteId: string | null | undefined, db: any = prisma): Promise<string | null> {
  if (!quoteId) return null
  const basis = await orderBasisFor(accountId, quoteId, db)
  if (!basis) return null
  const inv = await db.inventoryState.findUnique({ where: { accountId }, select: { items: true } })
  const stock: Stock = Array.isArray(inv?.items) ? inv.items : []
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = await db.businessState.findUnique({ where: { accountId }, select: { pendingOrders: true, version: true } })
    if (!s) return 'no business record yet'
    const all = (Array.isArray(s.pendingOrders) ? s.pendingOrders : []) as SalesOrder[]
    const touched = (o: SalesOrder) => o?.quoteId === quoteId || (o?.jobId === basis.jobId && o?.status === 'pending')
    const plan = planOrders(all.filter(touched), basis, stock, new Date().toISOString())
    if (!plan.changed) return plan.what
    const next = mergeInto(all, touched, plan.orders)
    const done = await db.businessState.updateMany({ where: { accountId, version: s.version }, data: { pendingOrders: next as any, version: { increment: 1 } } })
    if (done.count === 1) {
      console.log(`[sales-orders] quote ${quoteId}: ${plan.what}`)
      return plan.what
    }
  }
  console.error(`[sales-orders] quote ${quoteId}: the business record kept changing; the order was not brought up to date`)
  return null
}

/**
 * The whole list with the touched orders replaced by `planned`: a new order
 * first (newest first, as the page lists them), the others where they were,
 * one taken off is gone, every order not touched as it was.
 */
export function mergeInto(all: SalesOrder[], touched: (o: SalesOrder) => boolean, planned: SalesOrder[]): SalesOrder[] {
  const byId = new Map(planned.map(o => [o.id, o]))
  const fresh = planned.filter(o => !all.some(x => x.id === o.id))
  return [...fresh, ...all.flatMap(o => (!touched(o) ? [o] : byId.has(o.id) ? [byId.get(o.id)!] : []))]
}

/** The same, never failing what it follows (a failure is logged). */
export function syncSalesOrderSafe(accountId: string, quoteId: string | null | undefined): Promise<void> {
  return syncSalesOrder(accountId, quoteId).then(() => {}, e => console.error(`[sales-orders] quote ${quoteId}:`, e))
}
