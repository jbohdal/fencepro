/**
 * D6 (Jonathan, Oct 29 2026): "Materials received for a job go to that job and
 * don't change shop stock at all." Mark Received on a job's Sales Order
 * (web pendingOrderStore updatePendingOrderStatus) saves the order Received
 * (the server then records the materials on the job, lib/materialsFromOrders.ts)
 * and never saves Inventory: no count on hand goes down or up. Before, it
 * lowered the count on hand of each Inventory part with the same name.
 */

import { describe, test, expect, vi, beforeEach } from 'vitest'

const state: { pendingOrders: any[] } = { pendingOrders: [] }
const inventory = [{ id: 'i1', name: '*Vinyl, White, Rail, 8\'', quantity: 40, reservedQty: 12 }]
const saveInventory = vi.fn()

vi.mock('../../web/src/businessStateStore', () => ({
  getBusinessField: (k: string) => (state as any)[k],
  setBusinessField: (k: string, v: unknown) => { (state as any)[k] = v },
  whenBusinessStateSaved: () => Promise.resolve(false),
  needBusinessFields: () => Promise.resolve(true),
  isBusinessFieldLoaded: () => true,
  BUSINESS_STATE_UPDATED_EVENT: 'x',
}))
vi.mock('../../web/src/inventoryStore', () => ({
  getInventory: () => inventory,
  saveInventory,
  isInventoryHydrated: () => true,
}))

const { updatePendingOrderStatus, receivedStockWords } = await import('../../web/src/pendingOrderStore')

const order = (status: string) => ({
  id: 'so1', quoteId: 'q1', quoteName: 'Q', jobId: 'j1', customerName: 'Manuel Cotrich', status, totalCostCents: 0, notes: '',
  createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z',
  items: [{ id: 'l1', itemName: '*Vinyl, White, Rail, 8\'', requiredQuantity: 26, unitCostCents: 1500, totalCostCents: 39000, quantityReceived: 0 }],
})

describe('Mark Received changes no shop stock (D6)', () => {
  beforeEach(() => { saveInventory.mockClear(); inventory[0].quantity = 40; inventory[0].reservedQty = 12 })

  test('the order is Received, dated; Inventory is never saved and its count on hand stays', () => {
    state.pendingOrders = [order('ordered')]
    const r = updatePendingOrderStatus('so1', 'received')
    expect(r?.status).toBe('received')
    expect(r?.receivedAt).toBeTruthy()
    expect(state.pendingOrders[0].status).toBe('received')
    expect(saveInventory).not.toHaveBeenCalled()
    expect(inventory[0]).toMatchObject({ quantity: 40, reservedQty: 12 })
  })

  test('from Pending straight to Received: the same', () => {
    state.pendingOrders = [order('pending')]
    updatePendingOrderStatus('so1', 'received')
    expect(saveInventory).not.toHaveBeenCalled()
    expect(inventory[0].quantity).toBe(40)
  })

  test('Mark Ordered does not touch Inventory either', () => {
    state.pendingOrders = [order('pending')]
    updatePendingOrderStatus('so1', 'ordered')
    expect(saveInventory).not.toHaveBeenCalled()
  })

  test('the toast says the materials went to the job and no stock count changed', () => {
    expect(receivedStockWords({ customerName: 'Manuel Cotrich' })).toBe("The materials are recorded on Manuel Cotrich's job. Shop stock counts in Inventory did not change.")
    expect(receivedStockWords({ customerName: '' })).toBe('The materials are recorded on the job. Shop stock counts in Inventory did not change.')
  })
})
