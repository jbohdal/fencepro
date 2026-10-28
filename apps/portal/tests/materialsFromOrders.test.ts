/** The job's materials follow its Sales Order, never backward (lib/materialsFromOrders.ts; review Oct 27 2026). */
import { describe, test, expect } from 'vitest'
import { materialsOfOrder, raisedMaterials, ordersNowBought, ordersAfterJobMaterials } from '../src/server/lib/materialsFromOrders.js'
import { heldForDrawing, moveMoreWords, DRAWN_WAITS_WORDS } from '../src/server/lib/waitingStageMove.js'
import { START_OPS_STAGES, waitsOnlyForDrawing, HELD_FOR_DRAWING_WORDS } from '../src/server/lib/opsStageModel.js'

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

  test('held in Need Drawing with its materials in: what the card and history say (audit #55)', () => {
    const undrawn = { drawing: false, repair: false }
    expect(waitsOnlyForDrawing('need_drawing', 'received', undrawn)).toBe(true)
    expect(waitsOnlyForDrawing('need_drawing', 'loaded', undrawn)).toBe(true)
    expect(waitsOnlyForDrawing('need_drawing', 'ordered', undrawn)).toBe(false)
    expect(waitsOnlyForDrawing('need_drawing', null, undrawn)).toBe(false)
    expect(waitsOnlyForDrawing('need_drawing', 'received', { drawing: true, repair: false })).toBe(false)
    expect(waitsOnlyForDrawing('need_drawing', 'received', { drawing: false, repair: true })).toBe(false)
    expect(waitsOnlyForDrawing('ready_to_pull', 'received', undrawn)).toBe(false)
    const f = { permit: 'approved', today: '2026-10-28', ...undrawn }
    expect(moveMoreWords('need_drawing', f, 'received')).toBe(`${HELD_FOR_DRAWING_WORDS}.`)
    expect(moveMoreWords('need_drawing', f, 'not_ordered')).toBe('')
    expect(moveMoreWords('need_drawing', { ...f, drawing: true }, 'received')).toBe(DRAWN_WAITS_WORDS)
    expect(HELD_FOR_DRAWING_WORDS).toBe('Materials in; waits for its drawing')
  })

  test('a hand move that records materials marks the job\'s pending Sales Order Ordered, never Received (audit #54)', () => {
    const now = '2026-10-28T16:00:00.000Z'
    const orders = [
      { id: 'mine', jobId: 'j1', quoteId: 'q1', status: 'pending' },
      { id: 'byQuote', quoteId: 'q1', status: 'pending' },
      { id: 'other', jobId: 'j2', quoteId: 'q1', status: 'pending' },
      { id: 'gone', jobId: 'j1', status: 'cancelled' },
      { id: 'in', jobId: 'j1', status: 'received', receivedAt: '2026-10-01T00:00:00.000Z' },
    ]
    const o = ordersAfterJobMaterials(orders, { id: 'j1', quoteId: 'q1' }, now)
    expect(o.changed).toEqual(['mine', 'byQuote'])
    const by = (id: string) => (o.orders as any[]).find(x => x.id === id)
    expect([by('mine').status, by('mine').orderedAt, by('mine').updatedAt, by('mine').receivedAt]).toEqual(['ordered', now, now, undefined])
    expect(by('other').status).toBe('pending')
    expect(by('gone').status).toBe('cancelled')
    expect(by('in')).toEqual(orders[4])

    // An order already Ordered stays Ordered, with the day it was ordered: Mark Received in Inventory does the rest (stock counts).
    const ordered = { ...by('mine'), orderedAt: '2026-10-20T00:00:00.000Z' }
    const r = ordersAfterJobMaterials([ordered], { id: 'j1', quoteId: 'q1' }, now)
    expect(r).toEqual({ orders: [ordered], changed: [] })
    // Nothing of the job's to change, or no list: nothing changes.
    expect(ordersAfterJobMaterials(orders, { id: 'j9', quoteId: null }, now).changed).toEqual([])
    expect(ordersAfterJobMaterials('junk', { id: 'j1' }, now)).toEqual({ orders: [], changed: [] })
  })
})
