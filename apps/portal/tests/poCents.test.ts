/**
 * Draft purchase orders keep money in integer cents (audit #53, Oct 28 2026):
 * the lines a hand move's draft PO is made from (web poLines.ts) and the
 * backfill of drafts saved in dollars (lib/poCents.ts).
 */
import { describe, test, expect } from 'vitest'
import { poLinesFromSheet, lineTotalCents, toCents } from '../../web/src/poLines'
import { poToCents, posToCents, sumOfLines } from '../src/server/lib/poCents.js'

describe('a draft PO from a pull sheet', () => {
  test('unit costs become whole cents; totals are quantity × cents', () => {
    const lines = poLinesFromSheet([
      { item: 'ND, Donut', qty: 58, unitCost: 4.12 },
      { item: '*Vinyl, Hex, 1/4 x 3" (Rail Ties/Bottom)', qty: 87, unitCost: 0.12 },
      { item: 'Odd price', qty: 3, unitCost: 0.335 },
    ])
    expect(lines.map(l => l.unitCostCents)).toEqual([412, 12, 34])
    for (const l of lines) expect(Number.isInteger(l.unitCostCents)).toBe(true)
    expect(lineTotalCents(58, 412)).toBe(23896)
    expect(lineTotalCents(87, 12)).toBe(1044)
    expect(Number.isInteger(lineTotalCents(2.5, 333))).toBe(true)
  })

  test('only parts to order: no money only, job lot piece, work or empty lines', () => {
    const lines = poLinesFromSheet([
      { item: 'Post', qty: 4, unitCost: 13.5 },
      { item: 'Job lot section price', qty: 10, unitCost: 40, jobLotPiece: true },
      { item: 'Wood material', qty: 1, unitCost: 500, moneyOnly: true },
      { item: 'Tear out existing fence', qty: 100, unitCost: 1 },
      { item: 'Haul away', qty: 1, unitCost: 75 },
      { item: 'Cap', qty: 0, unitCost: 1.5 },
    ])
    expect(lines.map(l => l.itemName)).toEqual(['Post'])
    expect(poLinesFromSheet(undefined)).toEqual([])
  })

  test('dollars to cents rounds once', () => {
    expect(toCents(2319.81)).toBe(231981)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(null)).toBe(0)
  })
})

describe('drafts saved in dollars, in cents', () => {
  const old = {
    id: 'mkif52d', poNumber: 'PO-0002', status: 'draft', jobId: 'j1', jobName: 'Marlowe Testa', supplier: 'Default Supplier', notes: '', createdAt: '2026-10-28T08:37:17.859Z', createdBy: 'auto',
    subtotal: 292.96,
    lineItems: [
      { id: 'a', itemName: 'Post', quantity: 4, unitCost: 13.5, total: 54 },
      { id: 'b', itemName: 'ND, Donut', quantity: 58, unitCost: 4.12, total: 238.96 },
    ],
  }

  test('every figure becomes cents; nothing else changes', () => {
    const { po, changed } = poToCents(old)
    expect(changed).toBe(true)
    expect(po.subtotalCents).toBe(29296)
    expect('subtotal' in po).toBe(false)
    expect(po.lineItems).toEqual([
      { id: 'a', itemName: 'Post', quantity: 4, unitCostCents: 1350, totalCents: 5400 },
      { id: 'b', itemName: 'ND, Donut', quantity: 58, unitCostCents: 412, totalCents: 23896 },
    ])
    expect(sumOfLines(po)).toBe(po.subtotalCents)
    const { subtotal: _s, lineItems: _l, ...rest } = old
    const { subtotalCents: _c, lineItems: _m, ...restAfter } = po
    expect(restAfter).toEqual(rest)
  })

  test('run again it changes nothing', () => {
    const once = poToCents(old).po
    const twice = poToCents(once)
    expect(twice.changed).toBe(false)
    expect(twice.po).toEqual(once)
    expect(posToCents([once, old]).changed).toBe(1)
    expect(posToCents(null)).toEqual({ list: [], changed: 0 })
  })
})
