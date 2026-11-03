/**
 * Who sold it and the owner's hand edit, the pure part (lib/soldBy.ts): the
 * record, what a save leaves alone, and the figures a hand edit changes.
 */

import { describe, test, expect } from 'vitest'
import { handCommission, keepSaleRecord, sellerOf, soldByOn, withoutSaleRecord } from '../src/server/lib/soldBy'
import { quoteCommissionCents } from '../src/server/lib/quotesFollowCustomer'
import { lockedChanges } from '../src/server/lib/quoteLock'
import { typedCents, salesmanQuoteView, creditedTo } from '../../web/src/salesmanCommission'
import { withoutHandCommission } from '../src/server/lib/costRedact'

describe('who sold it', () => {
  test('the record, then the audit log, then the rep', () => {
    const moves = new Map([['q2', 'Christa Feagin']])
    expect(sellerOf({ id: 'q1', salesRep: 'Sam', pricing: { soldBy: 'Dan' } }, moves)).toBe('Dan')
    expect(sellerOf({ id: 'q1', salesRep: 'Sam', pricing: { soldBy: 'Dan' } }, new Map([['q1', 'Christa']]))).toBe('Dan')
    expect(sellerOf({ id: 'q2', salesRep: 'Sam', pricing: {} }, moves)).toBe('Christa Feagin')
    expect(sellerOf({ id: 'q3', salesRep: 'Sam ', pricing: null }, moves)).toBe('Sam')
  })
  test('a copy of a signed quote starts with no record, and keeps the rest', () => {
    expect(withoutSaleRecord({ laborMode: 'hourly', soldBy: 'Christa', commissionHandCents: 5 })).toEqual({ laborMode: 'hourly' })
    expect(withoutSaleRecord(null)).toBeNull()
    expect(withoutSaleRecord(undefined)).toBeUndefined()
  })
})

describe('the hand edit', () => {
  const q = { finalPrice: 10000, totalCOGS: 6000, gmPct: 0.31, hasSalesman: true, pricing: { commissionPct: 0.09, laborMode: 'hourly' }, work: null }

  test('the margin is price less cost less the commission; the switch and the % a change order prices from stay', () => {
    const f = handCommission(q, 120000, 'Christa Feagin')
    expect(f.gmPct).toBeCloseTo(0.28, 10)
    expect(f.pricing).toEqual({ commissionPct: 0.09, laborMode: 'hourly', soldBy: 'Christa Feagin', commissionHandCents: 120000 })
    expect(f).not.toHaveProperty('hasSalesman')
    expect(f).not.toHaveProperty('finalPrice')
    expect(f).not.toHaveProperty('totalCOGS')
    expect(quoteCommissionCents({ ...q, ...f })).toBe(120000)
    expect(soldByOn(f.pricing)).toBe('Christa Feagin')
  })
  test('zero is a figure: no commission, margin back to price less cost', () => {
    const f = handCommission(q, 0, 'Christa Feagin')
    expect(f.gmPct).toBeCloseTo(0.4, 10)
    expect(quoteCommissionCents({ ...q, ...f })).toBe(0)
  })
  test('a repair: its own saved commission and margin move with it', () => {
    const work = { type: 'repair', note: 'kept', priced: { priceCents: 100000, commissionCents: 9000, grossMarginCents: 30000 } }
    const f = handCommission({ ...q, finalPrice: 1000, totalCOGS: 610, work }, 15000, 'Christa')
    expect(f.work.priced).toEqual({ priceCents: 100000, commissionCents: 15000, grossMarginCents: 24000 })
    expect(f.work.note).toBe('kept')
    expect(f.gmPct).toBeCloseTo(0.24, 10)
    expect(quoteCommissionCents({ ...q, finalPrice: 1000, totalCOGS: 610, ...f })).toBe(15000)
  })
  test('no job on a free quote divides by nothing', () => {
    expect(handCommission({ ...q, finalPrice: 0 }, 0, 'Christa').gmPct).toBe(0)
  })
})

describe('a later save', () => {
  const saved = { pricing: { commissionPct: 0.09, soldBy: 'Christa', commissionHandCents: 120000 }, gmPct: 0.28, hasSalesman: true, finalPrice: 10000, work: { type: 'repair', priced: { commissionCents: 120000 } } }

  test('an older copy keeps the record and goes through the lock; its note still saves', () => {
    const data: any = { notes: 'gate code 1234', pricing: { commissionPct: 0.09 }, gmPct: 0.31, hasSalesman: true, finalPrice: 10000, work: { type: 'repair', photoOverride: 'x', priced: { commissionCents: 90000 } } }
    keepSaleRecord(saved, data)
    expect(data.pricing).toBeUndefined()
    expect(data.gmPct).toBeUndefined()
    expect(data.hasSalesman).toBeUndefined()
    expect(data.work).toEqual({ type: 'repair', photoOverride: 'x', priced: { commissionCents: 120000 } })
    expect(lockedChanges(saved, data)).toEqual([])
    expect(data.notes).toBe('gate code 1234')
  })
  test('a real price change on it is still refused', () => {
    const data: any = { finalPrice: 11000, gmPct: 0.31 }
    keepSaleRecord(saved, data)
    expect(lockedChanges(saved, data)).toEqual(['finalPrice'])
  })
  test('a signed quote with no record: the lock as before', () => {
    const data: any = { gmPct: 0.2 }
    keepSaleRecord({ pricing: { commissionPct: 0.09 } }, data)
    expect(data.gmPct).toBe(0.2)
  })
})

describe('what the owner types', () => {
  test('dollars to cents', () => {
    expect(typedCents('1200')).toBe(120000)
    expect(typedCents('$1,200.50')).toBe(120050)
    expect(typedCents('0')).toBe(0)
    expect(typedCents('19.99')).toBe(1999)
  })
  test('not an amount', () => {
    for (const t of ['', 'abc', '-5', '1.234', '1.2.3']) expect(typedCents(t)).toBeNull()
  })
})

describe('the Salesman', () => {
  test('her copy says "set by hand", never the figure, wherever it sits', () => {
    const body = { success: true, data: [{ id: 'q', pricing: { soldBy: 'Christa', commissionHandCents: 120050, laborMode: 'hourly' } }], at: new Date(0) }
    const out = withoutHandCommission(body) as any
    expect(out.data[0].pricing).toEqual({ soldBy: 'Christa', commissionByHand: true, laborMode: 'hourly' })
    expect(out.at).toBeInstanceOf(Date)
    expect(JSON.stringify(out)).not.toContain('120050')
  })
  test('her own sales: credited to who sold it, not the rep it was moved to', () => {
    const me = { firstName: 'Sam', lastName: 'Walk' }
    const quotes = [
      { id: 'moved-to-sam', status: 'SOLD', salesRep: 'Sam Walk', soldBy: 'Christa Feagin' },
      { id: 'sams-own', status: 'SOLD', salesRep: 'Sam Walk' },
      { id: 'moved-from-sam', status: 'SOLD', salesRep: 'Christa Feagin', soldBy: 'Sam Walk' },
      { id: 'no-one', status: 'SOLD', salesRep: 'Sam Walk', soldBy: '' },
    ]
    expect(salesmanQuoteView(quotes, 'sales_rep', me).mine.map(q => q.id)).toEqual(['sams-own', 'moved-from-sam'])
    expect(creditedTo({ salesRep: 'Sam', soldBy: '' })).toBe('')
  })
})
