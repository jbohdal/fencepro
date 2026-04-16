/**
 * Purchase Order Store
 *
 * Persistent PO records linked to jobs. Supports draft/review/confirm workflow.
 * Auto-created when jobs reach a configurable trigger stage.
 */

export type POStatus = 'draft' | 'confirmed' | 'ordered' | 'received' | 'cancelled'

export interface POLineItem {
  id: string
  itemName: string
  sku?: string
  quantity: number
  unitCost: number
  total: number
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
  subtotal: number
  notes: string
  createdAt: string
  confirmedAt?: string
  orderedAt?: string
  receivedAt?: string
  createdBy: string       // 'auto' or user name
}

const PO_KEY = 'fencepro_purchase_orders'
const uid = () => Math.random().toString(36).slice(2, 9)

export function getPurchaseOrders(): PurchaseOrder[] {
  try {
    const raw = localStorage.getItem(PO_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

export function savePurchaseOrders(pos: PurchaseOrder[]): void {
  localStorage.setItem(PO_KEY, JSON.stringify(pos))
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
  lineItems: { itemName: string; sku?: string; quantity: number; unitCost: number; supplier?: string; inventoryItemId?: string }[],
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
    unitCost: li.unitCost,
    total: Math.round(li.quantity * li.unitCost * 100) / 100,
    supplier: li.supplier,
    inventoryItemId: li.inventoryItemId,
  }))

  const subtotal = items.reduce((s, i) => s + i.total, 0)

  const po: PurchaseOrder = {
    id: uid(),
    poNumber: nextPONumber(),
    jobId,
    jobName,
    jobAddress,
    supplier: primarySupplier,
    status: 'draft',
    lineItems: items,
    subtotal: Math.round(subtotal * 100) / 100,
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
    subtotal: Math.round(allItems.reduce((s, i) => s + i.total, 0) * 100) / 100,
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
