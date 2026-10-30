/**
 * The Inventory dashboard's counts (AdminPage), from the items and stock
 * levels inventoryStore.ts reads. Pure, so it is tested directly.
 */

import type { InventoryItem, StockLevel } from './inventoryStore'

export interface InventorySummary {
  totalItems: number
  totalValue: number
  lowStockCount: number
  outOfStockCount: number
  categoryCounts: Record<string, number>
}

/**
 * The Inventory dashboard's counts. Archived items (kept, never deleted: a
 * removed color's parts, the white vinyl parts once renamed as wood) are not
 * counted anywhere (review Oct 30 2026: "Wood 27" and "358 items" counted them).
 */
export function inventorySummaryOf(all: Array<Pick<InventoryItem, 'id' | 'category' | 'unitCost' | 'status'>>, levels: Array<Pick<StockLevel, 'itemId' | 'quantity' | 'reorderPoint'>>): InventorySummary {
  const items = all.filter(i => i.status !== 'archived')

  let totalValue = 0
  let lowStockCount = 0
  let outOfStockCount = 0
  const categoryCounts: Record<string, number> = {}

  for (const item of items) {
    const totalQty = levels.filter(s => s.itemId === item.id).reduce((sum, s) => sum + s.quantity, 0)
    totalValue += totalQty * item.unitCost
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1

    // Per-location check: an item is low-stock if ANY location is at or below its own reorder point
    const itemLevels = levels.filter(s => s.itemId === item.id)
    if (itemLevels.some(s => s.reorderPoint > 0 && s.quantity <= s.reorderPoint)) lowStockCount++
    if (itemLevels.length > 0 && totalQty === 0) outOfStockCount++
  }

  return {
    totalItems: items.length,
    totalValue,
    lowStockCount,
    outOfStockCount,
    categoryCounts,
  }
}
