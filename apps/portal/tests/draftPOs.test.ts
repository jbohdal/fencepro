/**
 * Draft purchase orders in Pending Orders (web draftPOs.ts; Jonathan, Oct 28
 * 2026): which drafts show, the job's Sales Order each goes with, whether
 * their parts agree, what Mark ordered does to that Sales Order, and closing
 * a draft as ordered or discarded.
 */
import { describe, test, expect } from 'vitest'
import { shownDrafts, salesOrderOfDraft, compareToSalesOrder, relationText, orderedStep, closeDraft, supplierOf, type DraftLike, type SalesOrderLike } from '../../web/src/draftPOs'

const draft = (id: string, extra: Partial<DraftLike> = {}): DraftLike => ({
  id, poNumber: `PO-${id}`, jobId: 'job-1', jobName: 'Pat Smith', jobAddress: '1 Main St, Ocala', supplier: 'Default Supplier', status: 'draft',
  lineItems: [
    { id: 'l1', itemName: 'ND, Donut', quantity: 58, unitCostCents: 412, totalCents: 23896 },
    { id: 'l2', itemName: 'Vinyl, 5x6 WV Section', quantity: 12, unitCostCents: 8950, totalCents: 107400 },
  ],
  subtotalCents: 131296, createdAt: '2026-10-28T14:00:00.000Z', ...extra,
})
const order = (id: string, extra: Partial<SalesOrderLike> = {}): SalesOrderLike => ({
  id, jobId: 'job-1', quoteId: 'q-1', status: 'ordered', createdAt: '2026-10-20T12:00:00.000Z',
  items: [{ itemName: 'ND, Donut', requiredQuantity: 58 }, { itemName: 'Vinyl, 5x6 WV Section', requiredQuantity: 12 }], ...extra,
})

describe('which drafts Pending Orders shows', () => {
  test('only drafts, newest first; closed ones leave', () => {
    const list = [
      draft('a', { createdAt: '2026-10-27T10:00:00.000Z' }),
      draft('b', { createdAt: '2026-10-28T10:00:00.000Z' }),
      draft('c', { status: 'ordered' }),
      draft('d', { status: 'cancelled' }),
    ]
    expect(shownDrafts(list).map(p => p.id)).toEqual(['b', 'a'])
    expect(shownDrafts(undefined)).toEqual([])
  })

  test('the made up "Default Supplier" reads as no supplier', () => {
    expect(supplierOf(draft('a'))).toBeNull()
    expect(supplierOf(draft('a', { supplier: '  ' }))).toBeNull()
    expect(supplierOf(draft('a', { supplier: 'Stephens' }))).toBe('Stephens')
  })
})

describe("a draft and its job's Sales Order", () => {
  test("the job's own order; never a cancelled one; else the order of the job's quote", () => {
    const p = draft('a')
    expect(salesOrderOfDraft(p, [order('x', { jobId: 'job-2' }), order('y')])?.id).toBe('y')
    expect(salesOrderOfDraft(p, [order('y', { status: 'cancelled' })])).toBeNull()
    expect(salesOrderOfDraft(p, [order('z', { jobId: undefined })], 'q-1')?.id).toBe('z')
    expect(salesOrderOfDraft(p, [order('z', { jobId: undefined })], 'q-other')).toBeNull()
    // Two for the job: the newest.
    expect(salesOrderOfDraft(p, [order('old'), order('new', { createdAt: '2026-10-25T00:00:00.000Z' })])?.id).toBe('new')
  })

  test('same parts, same quantities: same (names compared without case or extra spaces)', () => {
    const cmp = compareToSalesOrder(draft('a'), order('y', { items: [{ itemName: 'nd,  donut', requiredQuantity: 58 }, { itemName: 'Vinyl, 5x6 WV Section', requiredQuantity: 12 }] }))
    expect(cmp.same).toBe(true)
    expect(relationText(order('y'), cmp)).toBe("Same parts as the job's Sales Order (Ordered).")
  })

  test('a change order on the Sales Order: the difference is named, part by part', () => {
    const so = order('y', { status: 'pending', items: [{ itemName: 'ND, Donut', requiredQuantity: 64 }, { itemName: 'Gate, WV, 4 ft', requiredQuantity: 1 }] })
    const cmp = compareToSalesOrder(draft('a'), so)
    expect(cmp.same).toBe(false)
    expect(cmp.qtyDiffers).toEqual([{ itemName: 'ND, Donut', draft: 58, order: 64 }])
    expect(cmp.onlyDraft).toEqual(['Vinyl, 5x6 WV Section'])
    expect(cmp.onlyOrder).toEqual(['Gate, WV, 4 ft'])
    expect(relationText(so, cmp)).toBe("Not the same as the job's Sales Order (Pending): 1 part in another quantity, 1 only on this draft, 1 only on the Sales Order. The Sales Order follows change orders; order from it.")
  })

  test('no Sales Order', () => {
    expect(relationText(null, null)).toBe('This job has no Sales Order. Its materials are tracked on the job.')
  })
})

describe('Mark ordered and Discard draft', () => {
  test('Mark ordered marks a pending Sales Order Ordered; one already ordered or received is left as it is', () => {
    expect(orderedStep(order('y', { status: 'pending' }))).toBe('mark_sales_order')
    expect(orderedStep(order('y', { status: 'ordered' }))).toBe('sales_order_already')
    expect(orderedStep(order('y', { status: 'received' }))).toBe('sales_order_already')
    expect(orderedStep(null)).toBe('no_sales_order')
  })

  test('closing a draft dates it and leaves the other drafts and the money as they were', () => {
    const list = [draft('a'), draft('b')]
    const now = '2026-10-28T18:00:00.000Z'
    const ordered = closeDraft(list, 'a', 'ordered', now)!
    expect(ordered[0]).toMatchObject({ id: 'a', status: 'ordered', orderedAt: now, subtotalCents: 131296 })
    expect(ordered[0].cancelledAt).toBeUndefined()
    expect(ordered[1]).toBe(list[1])
    expect(list[0].status).toBe('draft')   // the list read is not changed in place
    const discarded = closeDraft(list, 'b', 'cancelled', now)!
    expect(discarded[1]).toMatchObject({ status: 'cancelled', cancelledAt: now })
    expect(shownDrafts(discarded).map(p => p.id)).toEqual(['a'])
  })

  test('a draft already closed (on another phone) or gone is not closed again', () => {
    const now = '2026-10-28T18:00:00.000Z'
    expect(closeDraft([draft('a', { status: 'ordered' })], 'a', 'cancelled', now)).toBeNull()
    expect(closeDraft([draft('a')], 'zz', 'ordered', now)).toBeNull()
  })
})
