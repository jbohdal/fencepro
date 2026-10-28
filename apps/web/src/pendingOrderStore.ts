/**
 * Pending Orders — materials reserved for a SOLD job but not yet
 * physically ordered from the supplier.
 *
 * Flow: job made for a sold quote → the server makes its order from the job's
 *   pull sheet and keeps it following approved change orders (portal
 *   lib/salesOrders.ts; status: pending)
 *   → user confirms materials ordered (status: ordered)
 *   → materials arrive (status: received) → inventory deducted
 *
 * Mirrors: inventory_pending_orders + inventory_pending_order_items tables.
 */

import type { LineItem } from './materialCalculator'
import { getBusinessField, setBusinessField, whenBusinessStateSaved } from './businessStateStore'

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
  /** Where the lines come from, in words (set by the server). */
  source?: string
  createdAt: string
  updatedAt: string
  orderedAt?: string
  receivedAt?: string
  cancelledAt?: string
}

export function getPendingOrders(): PendingOrder[] {
  return getBusinessField('pendingOrders') as PendingOrder[]
}
function save(orders: PendingOrder[]) { setBusinessField('pendingOrders', orders) }

export function getPendingOrdersForQuote(quoteId: string): PendingOrder[] {
  return getPendingOrders().filter(o => o.quoteId === quoteId)
}

export function getPendingOrdersForCustomer(customerId: string): PendingOrder[] {
  return getPendingOrders().filter(o => o.customerId === customerId)
}

export function getPendingOrderById(id: string): PendingOrder | null {
  return getPendingOrders().find(o => o.id === id) || null
}

/**
 * Low stock on a sold quote's parts (the toast when it is marked Sold): each
 * part to order its pull sheet needs more of than is on hand. The order itself
 * is made on the server from the job's pull sheet (lib/salesOrders.ts).
 */
export function stockWarningsForSheet(sheet: LineItem[] | undefined): InsufficientStockWarning[] {
  const inv = getInventory()
  const out: InsufficientStockWarning[] = []
  for (const li of sheet ?? []) {
    if (li.jobLotPiece || li.moneyOnly || !(li.qty > 0)) continue
    const m = inv.find(i => i.name?.toLowerCase() === li.item?.toLowerCase())
    const available = m?.quantity ?? 0
    if (available < li.qty) out.push({ itemName: li.item, required: li.qty, available, short: li.qty - available })
  }
  return out
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
  // Ordered or Received: the server raises the job's materials to match (portal lib/materialsFromOrders.ts);
  // once the order is saved, the jobs are read again so the job page and the Schedule window say so here too.
  if (status === 'ordered' || status === 'received') {
    void whenBusinessStateSaved().then(ok => ok ? import('./jobStore').then(m => m.refreshJobs()) : undefined).catch(() => {})
  }
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
//
// Routes through inventoryStore (Phase 6) so reservations sync to the cloud
// instead of being local to one browser.

import { getInventory as storeGetInventory, saveInventory as storeSaveInventory } from './inventoryStore'

interface InventoryItem { id: string; name: string; quantity?: number; reservedQty?: number }

function getInventory(): InventoryItem[] {
  return storeGetInventory() as unknown as InventoryItem[]
}
function saveInventory(items: InventoryItem[]) {
  storeSaveInventory(items as any)
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
