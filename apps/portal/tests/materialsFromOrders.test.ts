/** The job's materials follow its Sales Order, never backward (lib/materialsFromOrders.ts; review Oct 27 2026). */
import { describe, test, expect } from 'vitest'
import { materialsOfOrder, raisedMaterials, ordersNowBought } from '../src/server/lib/materialsFromOrders.js'
import { heldForDrawing } from '../src/server/lib/waitingStageMove.js'
import { START_OPS_STAGES } from '../src/server/lib/opsStageModel.js'

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

  test('a job still to be drawn goes no further than Need Drawing, whatever its materials say (audit #50)', () => {
    const l = START_OPS_STAGES.map(x => ({ ...x }))
    const undrawn = { drawing: false, repair: false }
    // Received while in Need Drawing: stays there (it moved to Ready to Pull before).
    expect(heldForDrawing(l, 'need_drawing', 'ready_to_pull', undrawn)).toBe('need_drawing')
    expect(heldForDrawing(l, 'need_drawing', 'materials_ordered', undrawn)).toBe('need_drawing')
    // From Awaiting Locates or Permit Pending: Need Drawing, not past it.
    expect(heldForDrawing(l, 'awaiting_locates', 'ready_to_pull', undrawn)).toBe('need_drawing')
    expect(heldForDrawing(l, 'permit_pending', 'materials_ordered', undrawn)).toBe('need_drawing')
    expect(heldForDrawing(l, 'awaiting_locates', 'permit_pending', undrawn)).toBe('permit_pending')
    // Drawn, a repair, or already put past Need Drawing by the office: as the records say.
    expect(heldForDrawing(l, 'need_drawing', 'ready_to_pull', { drawing: true, repair: false })).toBe('ready_to_pull')
    expect(heldForDrawing(l, 'awaiting_locates', 'ready_to_pull', { drawing: false, repair: true })).toBe('ready_to_pull')
    expect(heldForDrawing(l, 'materials_ordered', 'ready_to_pull', undrawn)).toBe('ready_to_pull')
    // Need Drawing hidden in Settings: nothing to hold it in.
    expect(heldForDrawing(l.map(x => (x.id === 'need_drawing' ? { ...x, hidden: true } : x)), 'permit_pending', 'ready_to_pull', undrawn)).toBe('ready_to_pull')
  })
})
