/**
 * Pending Orders — materials reserved for a SOLD job but not yet
 * physically ordered from the supplier.
 *
 * Flow: job marked SOLD → pending order created from pull sheet (status: pending)
 *   → user confirms materials ordered (status: ordered)
 *   → materials arrive (status: received) → inventory deducted
 *
 * Mirrors: inventory_pending_orders + inventory_pending_order_items tables.
 */

import type { LineItem } from './materialCalculator'
import type { SavedQuote } from './QuotesPage'

const PO_KEY = 'fencepro_pending_orders'

const uid = () => Math.random().toString(36).slice(2, 10)

export type PendingOrderStatus = 'pending' | 'ordered' | 'received' | 'cancelled'

export interface PendingOrderItem {
  id: string
  inventoryItemId?: string   // matched against inventory by name if present
  itemName: string
  requiredQuantity: number
  unitCostCents: number
  totalCostCents: number
  quantityReceived: number
  receivedAt?: string
  // Stock sufficiency snapshot at time of order
  quantityOnHandAtTimeOfOrder?: number
  isSufficientStock?: boolean
}

export interface PendingOrder {
  id: string
  quoteId: string
  quoteName: string
  jobId?: string
  customerId?: string
  customerName: string
  status: PendingOrderStatus
  totalCostCents: number
  items: PendingOrderItem[]
  notes: string
  createdAt: string
  updatedAt: string
  orderedAt?: string
  receivedAt?: string
  cancelledAt?: string
}

export function getPendingOrders(): PendingOrder[] {
  try { const r = localStorage.getItem(PO_KEY); return r ? JSON.parse(r) : [] } catch { return [] }
}
function save(orders: PendingOrder[]) { localStorage.setItem(PO_KEY, JSON.stringify(orders)) }

export function getPendingOrdersForQuote(quoteId: string): PendingOrder[] {
  return getPendingOrders().filter(o => o.quoteId === quoteId)
}

export function getPendingOrdersForCustomer(customerId: string): PendingOrder[] {
  return getPendingOrders().filter(o => o.customerId === customerId)
}

export function getPendingOrderById(id: string): PendingOrder | null {
  return getPendingOrders().find(o => o.id === id) || null
}

/** Create a pending order from a quote's pull sheet. Idempotent per-quote. */
export function createPendingOrderFromQuote(quote: SavedQuote): PendingOrder | null {
  if (!quote.pullSheet || quote.pullSheet.length === 0) return null
  const existing = getPendingOrdersForQuote(quote.id)
  if (existing.length > 0) return existing[0]

  const inv = getInventory()
  const items: PendingOrderItem[] = quote.pullSheet.map((li: LineItem) => {
    const match = inv.find(i => i.name?.toLowerCase() === li.item?.toLowerCase())
    const onHand = match?.quantity ?? 0
    return {
      id: uid(),
      itemName: li.item,
      requiredQuantity: li.qty,
      unitCostCents: Math.round(li.unitCost * 100),
      totalCostCents: Math.round(li.total * 100),
      quantityReceived: 0,
      quantityOnHandAtTimeOfOrder: onHand,
      isSufficientStock: onHand >= li.qty,
    }
  })
  const totalCostCents = items.reduce((s, i) => s + i.totalCostCents, 0)

  const order: PendingOrder = {
    id: uid(),
    quoteId: quote.id,
    quoteName: `${quote.fenceStyle} — ${quote.customerName}`,
    jobId: undefined,
    customerId: quote.customerId,
    customerName: quote.customerName,
    status: 'pending',
    totalCostCents,
    items,
    notes: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  const all = getPendingOrders()
  all.unshift(order)
  save(all)
  // Reserve inventory — flag as committed, not decremented
  try { reserveInventoryForOrder(order) } catch { /* noop */ }
  return order
}

export function updatePendingOrderStatus(id: string, status: PendingOrderStatus): PendingOrder | null {
  const all = getPendingOrders()
  const idx = all.findIndex(o => o.id === id)
  if (idx < 0) return null
  const prev = all[idx]
  const now = new Date().toISOString()
  all[idx] = {
    ...prev,
    status,
    updatedAt: now,
    orderedAt: status === 'ordered' ? (prev.orderedAt || now) : prev.orderedAt,
    receivedAt: status === 'received' ? now : prev.receivedAt,
    cancelledAt: status === 'cancelled' ? now : prev.cancelledAt,
  }
  save(all)
  // On received: formally deduct from inventory
  if (status === 'received') {
    try { deductInventoryForOrder(all[idx]) } catch { /* noop */ }
  }
  if (status === 'cancelled') {
    try { releaseInventoryForOrder(all[idx]) } catch { /* noop */ }
  }
  return all[idx]
}

export function deletePendingOrder(id: string): void {
  save(getPendingOrders().filter(o => o.id !== id))
}

export function updatePendingOrderItem(orderId: string, itemId: string, updates: Partial<PendingOrderItem>): void {
  const all = getPendingOrders()
  const order = all.find(o => o.id === orderId)
  if (!order) return
  const item = order.items.find(i => i.id === itemId)
  if (!item) return
  Object.assign(item, updates)
  order.updatedAt = new Date().toISOString()
  save(all)
}

// ── Inventory reservation integration (best-effort, optional) ──

interface InventoryItem { id: string; name: string; quantity?: number; reservedQty?: number }

function getInventory(): InventoryItem[] {
  try { const r = localStorage.getItem('fencepro_inventory'); return r ? JSON.parse(r) : [] } catch { return [] }
}
function saveInventory(items: InventoryItem[]) { localStorage.setItem('fencepro_inventory', JSON.stringify(items)) }

function reserveInventoryForOrder(order: PendingOrder) {
  const inv = getInventory()
  if (inv.length === 0) return
  for (const oi of order.items) {
    const m = inv.find(i => i.name?.toLowerCase() === oi.itemName?.toLowerCase())
    if (m) m.reservedQty = (m.reservedQty || 0) + oi.requiredQuantity
  }
  saveInventory(inv)
}

function releaseInventoryForOrder(order: PendingOrder) {
  const inv = getInventory()
  if (inv.length === 0) return
  for (const oi of order.items) {
    const m = inv.find(i => i.name?.toLowerCase() === oi.itemName?.toLowerCase())
    if (m) m.reservedQty = Math.max(0, (m.reservedQty || 0) - oi.requiredQuantity)
  }
  saveInventory(inv)
}

function deductInventoryForOrder(order: PendingOrder) {
  const inv = getInventory()
  if (inv.length === 0) return
  for (const oi of order.items) {
    const m = inv.find(i => i.name?.toLowerCase() === oi.itemName?.toLowerCase())
    if (m) {
      m.quantity = Math.max(0, (m.quantity || 0) - oi.requiredQuantity)
      m.reservedQty = Math.max(0, (m.reservedQty || 0) - oi.requiredQuantity)
    }
  }
  saveInventory(inv)
}

/** For a given order, list items that lack sufficient inventory. */
export interface InsufficientStockWarning {
  itemName: string
  required: number
  available: number
  short: number
}
export function checkStockForOrder(order: PendingOrder): InsufficientStockWarning[] {
  const inv = getInventory()
  const warnings: InsufficientStockWarning[] = []
  for (const oi of order.items) {
    const m = inv.find(i => i.name?.toLowerCase() === oi.itemName?.toLowerCase())
    const available = m?.quantity ?? 0
    if (available < oi.requiredQuantity) {
      warnings.push({
        itemName: oi.itemName,
        required: oi.requiredQuantity,
        available,
        short: oi.requiredQuantity - available,
      })
    }
  }
  return warnings
}
