/** The job's materials follow its Sales Order, never backward (lib/materialsFromOrders.ts; review Oct 27 2026). */
import { describe, test, expect } from 'vitest'
import { materialsOfOrder, raisedMaterials, ordersNowBought } from '../src/server/lib/materialsFromOrders.js'

describe('materials follow the Sales Order', () => {
  test('what an order says', () => {
    expect(materialsOfOrder('ordered')).toBe('ordered')
    expect(materialsOfOrder('received')).toBe('received')
    expect(materialsOfOrder('pending')).toBeNull()
    expect(materialsOfOrder('cancelled')).toBeNull()
  })

  test('raised, never backward', () => {
    expect(raisedMaterials('not_ordered', 'ordered')).toBe('ordered')
    expect(raisedMaterials(null, 'ordered')).toBe('ordered')
    expect(raisedMaterials('not_ordered', 'received')).toBe('received')
    expect(raisedMaterials('ordered', 'received')).toBe('received')
    expect(raisedMaterials('ordered', 'ordered')).toBeNull()
    expect(raisedMaterials('received', 'ordered')).toBeNull()
    expect(raisedMaterials('loaded', 'ordered')).toBeNull()
    expect(raisedMaterials('loaded', 'received')).toBeNull()
    expect(raisedMaterials('not_ordered', null)).toBeNull()
  })

  test('only orders that became Ordered or Received in this save', () => {
    const before = [{ id: 'a', status: 'pending' }, { id: 'b', status: 'ordered' }, { id: 'c', status: 'ordered' }, { id: 'd', status: 'pending' }]
    const after = [{ id: 'a', status: 'ordered' }, { id: 'b', status: 'ordered' }, { id: 'c', status: 'received' }, { id: 'd', status: 'cancelled' }, { id: 'e', status: 'ordered' }]
    expect(ordersNowBought(before, after).map(o => o.id)).toEqual(['a', 'c', 'e'])
    // The backfill (no before): every Ordered or Received order.
    expect(ordersNowBought(null, after).map(o => o.id)).toEqual(['a', 'b', 'c', 'e'])
    expect(ordersNowBought([], 'junk')).toEqual([])
  })
})
