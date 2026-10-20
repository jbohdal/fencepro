/**
 * Price history: the landed cost of an Inventory item on a date.
 *
 * Read by job costing. Vendor invoices (lib/vendorInvoices.ts) write a
 * PriceHistory row per item per vendor each time a landed cost is applied
 * (including an older invoice that did not change Inventory, so a date in the
 * past gets the price paid then). Undone rows are left out. Until an item has
 * a row on or before the day, its cost is the Inventory item's current unit
 * cost (Inventory keeps dollars; this returns cents).
 */

import prisma from './prisma.js'

export interface LandedCost {
  cents: number
  source: 'invoice' | 'inventory'
  invoiceId?: string
}

/** Inventory keeps unitCost in dollars (a number); history keeps cents. */
function inventoryCents(item: any): number | null {
  const n = Number(item?.unitCost)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.round(n * 100)
}

/**
 * The latest landed cost on or before `day` (YYYY-MM-DD) for one Inventory
 * item, or the item's current Inventory cost when there is no history by then.
 * Null when the item is unknown (or unpriced) and has no history.
 */
export async function landedCostOn(accountId: string, inventoryItemId: string, day: string): Promise<LandedCost | null> {
  const row = await prisma.priceHistory.findFirst({
    where: { accountId, inventoryItemId, undoneAt: null, day: { lte: day } },
    orderBy: [{ day: 'desc' }, { createdAt: 'desc' }],
    select: { unitLandedCents: true, invoiceId: true },
  })
  if (row) return { cents: row.unitLandedCents, source: 'invoice', ...(row.invoiceId ? { invoiceId: row.invoiceId } : {}) }
  const inv = await prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true } })
  const items = Array.isArray(inv?.items) ? (inv!.items as any[]) : []
  const cents = inventoryCents(items.find(i => i?.id === inventoryItemId))
  return cents == null ? null : { cents, source: 'inventory' }
}

export interface JobLotLine {
  invoiceId: string
  vendorName: string
  invoiceNumber: string
  invoiceDate: string
  lineId: string
  inventoryItemId: string | null
  itemNumber: string
  description: string
  quantity: number
  unit: string
  /** The line's amount on the invoice. */
  lineCents: number
  /** Its share of tax, freight and fees. */
  extraCents: number
  /** lineCents + extraCents: what the line really cost. */
  landedCents: number
}

/**
 * The landed lines of vendor invoices linked to a job (job lot orders), from
 * invoices that passed the total check and were not undone or refused.
 */
export async function jobLotInvoiceLines(accountId: string, jobId: string): Promise<JobLotLine[]> {
  const invoices = await prisma.vendorInvoice.findMany({
    where: { accountId, jobId, status: { in: ['applied', 'needs_match'] } },
    include: { lines: { where: { ignored: false }, orderBy: { seq: 'asc' } } },
    orderBy: { invoiceDate: 'asc' },
  })
  return invoices.flatMap(inv => inv.lines.map(l => ({
    invoiceId: inv.id, vendorName: inv.vendorName, invoiceNumber: inv.invoiceNumber, invoiceDate: inv.invoiceDate,
    lineId: l.id, inventoryItemId: l.inventoryItemId, itemNumber: l.itemNumber, description: l.description,
    quantity: l.qty ?? 0, unit: l.unit, lineCents: l.totalCents ?? 0, extraCents: l.extraCents ?? 0,
    landedCents: l.landedCents ?? (l.totalCents ?? 0) + (l.extraCents ?? 0),
  })))
}
