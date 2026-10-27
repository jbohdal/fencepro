/**
 * Sales Orders follow the job's pull sheet (lib/salesOrders.ts; audit Oct 26
 * 2026 item 2): parts only, a pending order rewritten to the job's work, what
 * was ordered kept with only the difference on a new pending order, a
 * cancelled one never made again.
 */

import { describe, test, expect } from 'vitest'
import { partsToOrder, planOrders, mergeInto, type SalesOrder, type OrderBasis } from '../src/server/lib/salesOrders.js'

const NOW = '2026-10-26T12:00:00.000Z'
let n = 0
const ids = () => `id${++n}`

const basis = (need: OrderBasis['need'], extra: Partial<OrderBasis> = {}): OrderBasis => ({
  quoteId: 'q1', jobId: 'j1', customerId: 'c1', customerName: 'Manuel Cotrich', styleName: 'Tan vinyl 6 ft privacy, no dig', source: 'As signed: the option the customer chose', need, ...extra,
})
const order = (o: Partial<SalesOrder>): SalesOrder => ({
  id: 'o1', quoteId: 'q1', quoteName: 'x', customerName: 'Manuel Cotrich', status: 'pending', totalCostCents: 0, items: [], notes: '', createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', ...o,
})
const item = (itemName: string, requiredQuantity: number, unitCostCents = 100) => ({ id: `i-${itemName}`, itemName, requiredQuantity, unitCostCents, totalCostCents: requiredQuantity * unitCostCents, quantityReceived: 0 })

describe('parts to order', () => {
  test('money only and work lines are left out; the same part twice is one line', () => {
    const got = partsToOrder([
      { item: 'Tear Out Haul-Away Fence', qty: 13, unitCostCents: 950 },
      { item: '*Vinyl, Tan, Post, Line, 5" x 5" x 78"', qty: 10, unitCostCents: 1500 },
      { item: '*Vinyl, Tan, Post, Line, 5" x 5" x 78"', qty: 2, unitCostCents: 1500 },
      { item: 'Misc, 6\' Section', qty: 21, unitCostCents: 15434, moneyOnly: true },
      { item: 'Labor', qty: 1, unitCostCents: 5000 },
      { item: 'ND, Donut', qty: 0, unitCostCents: 300 },
    ])
    expect(got).toEqual([{ item: '*Vinyl, Tan, Post, Line, 5" x 5" x 78"', qty: 12, unitCostCents: 1500 }])
  })
})

describe('planning a quote\'s orders', () => {
  const tan = [{ item: 'Tan post', qty: 12, unitCostCents: 1500 }, { item: 'Tan picket', qty: 300, unitCostCents: 250 }]
  const stock = [{ id: 'tp', name: 'Tan post', quantity: 20 }]

  test('none yet: one pending order from the job\'s pull sheet, costs in cents, stock checked', () => {
    const p = planOrders([], basis(tan), stock, NOW, ids)
    expect(p.changed).toBe(true)
    expect(p.orders).toHaveLength(1)
    const o = p.orders[0]
    expect(o).toMatchObject({ quoteId: 'q1', jobId: 'j1', customerId: 'c1', status: 'pending', source: 'As signed: the option the customer chose', quoteName: 'Tan vinyl 6 ft privacy, no dig — Manuel Cotrich' })
    expect(o.items.map(i => [i.itemName, i.requiredQuantity, i.totalCostCents, i.isSufficientStock])).toEqual([['Tan post', 12, 18000, true], ['Tan picket', 300, 75000, false]])
    expect(o.items[0].inventoryItemId).toBe('tp')
    expect(o.totalCostCents).toBe(93000)
  })

  test('a pending order made from the wrong option (white) is rewritten to the signed one (tan), keeping its id and date', () => {
    const white = order({ items: [item('White post', 12), item('White picket', 300)], totalCostCents: 31200 })
    const p = planOrders([white], basis(tan), stock, NOW, ids)
    expect(p.changed).toBe(true)
    expect(p.orders).toHaveLength(1)
    expect(p.orders[0].id).toBe('o1')
    expect(p.orders[0].createdAt).toBe('2026-10-20T00:00:00.000Z')
    expect(p.orders[0].items.map(i => i.itemName)).toEqual(['Tan post', 'Tan picket'])
  })

  test('already up to date: nothing changes', () => {
    const first = planOrders([], basis(tan), stock, NOW, ids).orders
    const again = planOrders(first, basis(tan), stock, '2026-10-27T00:00:00.000Z', ids)
    expect(again.changed).toBe(false)
  })

  test('ordered before a +20 ft change order: kept as bought, a pending order lists only the difference', () => {
    const bought = order({ status: 'ordered', items: [item('Tan post', 12, 1500), item('Tan picket', 300, 250)] })
    const p = planOrders([bought], basis([{ item: 'Tan post', qty: 14, unitCostCents: 1500 }, { item: 'Tan picket', qty: 300, unitCostCents: 250 }], { source: 'Change order CO-1' }), stock, NOW, ids)
    expect(p.changed).toBe(true)
    const pending = p.orders.find(o => o.status === 'pending')!
    expect(pending.items.map(i => [i.itemName, i.requiredQuantity])).toEqual([['Tan post', 2]])
    expect(pending.quoteName).toMatch(/more needed after ordering/)
    expect(p.orders.find(o => o.id === 'o1')).toBe(bought)
  })

  test('what was ordered covers the job: a leftover pending order is taken off', () => {
    const bought = order({ status: 'received', items: [item('Tan post', 12)] })
    const extra = order({ id: 'o2', status: 'pending', items: [item('Tan post', 2)] })
    const p = planOrders([bought, extra], basis([{ item: 'Tan post', qty: 12, unitCostCents: 100 }]), stock, NOW, ids)
    expect(p.changed).toBe(true)
    expect(p.orders.map(o => o.id)).toEqual(['o1'])
  })

  test('cancelled by the office: not made again', () => {
    const c = order({ status: 'cancelled', items: [item('White post', 1)] })
    const p = planOrders([c], basis(tan), stock, NOW, ids)
    expect(p.changed).toBe(false)
    expect(p.orders).toEqual([c])
  })

  test('no parts on the pull sheet: the orders are left as they are', () => {
    const o = order({ items: [item('Tan post', 1)] })
    expect(planOrders([o], basis([]), stock, NOW, ids)).toMatchObject({ changed: false, orders: [o] })
  })

  test('a pending order this job had from another quote (it follows the quote accepted last) goes', () => {
    const stray = order({ id: 'old', quoteId: 'q0', jobId: 'j1' })
    const p = planOrders([stray], basis(tan), stock, NOW, ids)
    expect(p.orders.every(o => o.quoteId === 'q1')).toBe(true)
  })
})

describe('putting the plan in the list', () => {
  test('a new order goes first; the others stay where they were; one taken off is gone', () => {
    const a = order({ id: 'a', quoteId: 'qa' }), b = order({ id: 'b' }), c = order({ id: 'c', quoteId: 'qc' }), d = order({ id: 'd' })
    const touched = (o: SalesOrder) => o.quoteId === 'q1'
    const b2 = { ...b, notes: 'rewritten' }
    const fresh = order({ id: 'e' })
    expect(mergeInto([a, b, c, d], touched, [fresh, b2]).map(o => [o.id, o.notes])).toEqual([['e', ''], ['a', ''], ['b', 'rewritten'], ['c', '']])
  })
})
