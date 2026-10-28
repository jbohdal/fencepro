/**
 * The lines of a draft purchase order, from a quote's pull sheet (audit #53,
 * Oct 28 2026): money is integer cents, like every other record. Before, the
 * draft kept dollars ("subtotal": 2319.81). The pull sheet's own unitCost is
 * dollars; it is turned into cents here, once, and nothing after it adds
 * dollars.
 *
 * Only parts to order, the same lines as the Sales Order (portal
 * lib/salesOrders.ts partsToOrder): no money only lines (job lot piece prices,
 * wood's material), no work lines (tear out, haul away, labor), nothing with
 * no quantity. Pure (no app imports): the portal tests use it too.
 */

import * as workWordsNs from '../../portal/src/server/lib/workWords'
const workWords = (Reflect.get(workWordsNs, 'default') ?? workWordsNs) as typeof workWordsNs

/** A pull sheet line as the quote keeps it (materialCalculator LineItem): unitCost in dollars. */
export interface SheetLineLike { item: string; qty: number; unitCost?: number | null; moneyOnly?: boolean; jobLotPiece?: boolean }

/** A line for a draft PO, money in cents. */
export interface PoLineInput { itemName: string; sku?: string; quantity: number; unitCostCents: number; supplier?: string; inventoryItemId?: string }

/** Dollars (a pull sheet's unitCost) to whole cents. */
export const toCents = (dollars: number | null | undefined) => Math.round((Number(dollars) || 0) * 100)

/** The line's total in cents: quantity × unit cost, rounded once to the cent. */
export const lineTotalCents = (quantity: number, unitCostCents: number) => Math.round(quantity * unitCostCents)

/** The parts on a pull sheet to put on a draft PO, money in cents. */
export function poLinesFromSheet(sheet: SheetLineLike[] | null | undefined): PoLineInput[] {
  return (sheet ?? [])
    .filter(l => !l.moneyOnly && !l.jobLotPiece && !workWords.isWorkLine(l.item) && Number(l.qty) > 0)
    .map(l => ({ itemName: l.item, quantity: Number(l.qty), unitCostCents: toCents(l.unitCost) }))
}
