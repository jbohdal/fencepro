/**
 * Purchase Order Store
 *
 * Draft PO records linked to jobs, kept in the business record
 * (BusinessState.purchaseOrders). A draft is made when a job's materials are
 * first marked Ordered from this app (jobStore updateJob); it shows in Pending
 * Orders marked Draft until the office marks it ordered or discards it
 * (draftPOs.ts, PendingOrdersPage.tsx; Oct 28 2026). Money is integer
 * cents (unitCostCents, totalCents, subtotalCents; audit #53, Oct 28 2026);
 * drafts saved before then in dollars were changed by
 * portal scripts/po-cents-2026-10-28.ts. One such draft still in dollars
 * (a company the script has not run on yet) is read in cents here, once, by
 * the same rule (portal lib/poCents.ts): before, every price on it and its
 * subtotal showed "—" (review Oct 28 2026).
 */

export type POStatus = 'draft' | 'confirmed' | 'ordered' | 'received' | 'cancelled'

export interface POLineItem {
  id: string
  itemName: string
  sku?: string
  quantity: number
  unitCostCents: number
  totalCents: number
  supplier?: string
  inventoryItemId?: string
}

export interface PurchaseOrder {
  id: string
  poNumber: string
  jobId: string
  jobName: string         // customer name snapshot
  jobAddress?: string
  supplier: string
  status: POStatus
  lineItems: POLineItem[]
  subtotalCents: number
  notes: string
  createdAt: string
  confirmedAt?: string
  orderedAt?: string
  receivedAt?: string
  /** A draft discarded in Pending Orders (draftPOs.ts closeDraft). */
  cancelledAt?: string
  createdBy: string       // 'auto' or user name
}

import { getBusinessField, setBusinessField } from './businessStateStore'
import { lineTotalCents, type PoLineInput } from './poLines'
import { closeDraft, purchaseOrdersInCents } from './draftPOs'

const uid = () => Math.random().toString(36).slice(2, 9)

export function getPurchaseOrders(): PurchaseOrder[] {
  return purchaseOrdersInCents<PurchaseOrder>(getBusinessField('purchaseOrders'))
}

export function savePurchaseOrders(pos: PurchaseOrder[]): void {
  setBusinessField('purchaseOrders', pos)
}

export function getPOsForJob(jobId: string): PurchaseOrder[] {
  return getPurchaseOrders().filter(po => po.jobId === jobId)
}

export function getPOsBySupplier(supplier: string): PurchaseOrder[] {
  return getPurchaseOrders().filter(po => po.supplier === supplier && po.status !== 'cancelled')
}

/** Generate next PO number */
function nextPONumber(): string {
  const pos = getPurchaseOrders()
  const num = pos.length + 1
  return `PO-${String(num).padStart(4, '0')}`
}

/** Create a draft PO from a job's material requirements */
export function createDraftPO(
  jobId: string,
  jobName: string,
  jobAddress: string,
  lineItems: PoLineInput[],
  createdBy = 'auto',
): PurchaseOrder {
  // Group by supplier
  const defaultSupplier = 'Default Supplier'
  const supplierItems: Record<string, typeof lineItems> = {}

  for (const item of lineItems) {
    const sup = item.supplier || defaultSupplier
    if (!supplierItems[sup]) supplierItems[sup] = []
    supplierItems[sup].push(item)
  }

  // For now, create a single PO (multi-supplier consolidation happens separately)
  const primarySupplier = Object.keys(supplierItems)[0] || defaultSupplier
  const items: POLineItem[] = lineItems.map(li => ({
    id: uid(),
    itemName: li.itemName,
    sku: li.sku,
    quantity: li.quantity,
    unitCostCents: li.unitCostCents,
    totalCents: lineTotalCents(li.quantity, li.unitCostCents),
    supplier: li.supplier,
    inventoryItemId: li.inventoryItemId,
  }))

  const po: PurchaseOrder = {
    id: uid(),
    poNumber: nextPONumber(),
    jobId,
    jobName,
    jobAddress,
    supplier: primarySupplier,
    status: 'draft',
    lineItems: items,
    subtotalCents: items.reduce((s, i) => s + i.totalCents, 0),
    notes: '',
    createdAt: new Date().toISOString(),
    createdBy,
  }

  const pos = getPurchaseOrders()
  pos.unshift(po)
  savePurchaseOrders(pos)
  return po
}

/** Update PO status */
export function updatePOStatus(poId: string, status: POStatus): PurchaseOrder | null {
  const pos = getPurchaseOrders()
  const idx = pos.findIndex(p => p.id === poId)
  if (idx < 0) return null

  pos[idx].status = status
  if (status === 'confirmed') pos[idx].confirmedAt = new Date().toISOString()
  if (status === 'ordered') pos[idx].orderedAt = new Date().toISOString()
  if (status === 'received') pos[idx].receivedAt = new Date().toISOString()

  savePurchaseOrders(pos)
  return pos[idx]
}

/** Consolidate POs for same supplier across multiple jobs in a date range */
export function consolidatePOs(poIds: string[]): PurchaseOrder | null {
  const pos = getPurchaseOrders()
  const toConsolidate = pos.filter(p => poIds.includes(p.id) && p.status === 'draft')
  if (toConsolidate.length < 2) return null

  const supplier = toConsolidate[0].supplier
  const allItems: POLineItem[] = []
  const jobRefs: string[] = []

  for (const po of toConsolidate) {
    for (const item of po.lineItems) allItems.push({ ...item, id: uid() })
    jobRefs.push(po.jobName)
  }

  const consolidated: PurchaseOrder = {
    id: uid(),
    poNumber: nextPONumber(),
    jobId: toConsolidate.map(p => p.jobId).join(','),
    jobName: jobRefs.join(' + '),
    supplier,
    status: 'draft',
    lineItems: allItems,
    subtotalCents: allItems.reduce((s, i) => s + i.totalCents, 0),
    notes: `Consolidated from ${toConsolidate.length} POs`,
    createdAt: new Date().toISOString(),
    createdBy: 'auto',
  }

  // Cancel the originals, add the consolidated
  for (const po of toConsolidate) {
    const idx = pos.findIndex(p => p.id === po.id)
    if (idx >= 0) pos[idx].status = 'cancelled'
  }
  pos.unshift(consolidated)
  savePurchaseOrders(pos)
  return consolidated
}

/**
 * Close a draft shown in Pending Orders: 'ordered' (the office placed the
 * order; the page marks the job's Sales Order Ordered first) or 'cancelled'
 * (discarded). Null when it is gone or no longer a draft.
 */
export function closeDraftPO(poId: string, to: 'ordered' | 'cancelled'): PurchaseOrder | null {
  const next = closeDraft(getPurchaseOrders(), poId, to, new Date().toISOString())
  if (!next) return null
  savePurchaseOrders(next)
  return next.find(p => p.id === poId) ?? null
}
