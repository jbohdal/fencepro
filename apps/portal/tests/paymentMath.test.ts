/**
 * The money rules of a payment schedule (lib/paymentMath.ts), in cents: the
 * deposit to the cent, the Final as what is left, payments to the oldest open
 * invoice first with the rest carried, over and under payment.
 */

import { describe, test, expect } from 'vitest'
import { depositOf, finalOf, applyPayments, moneyText, methodText } from '../src/server/lib/paymentMath'

const inv = (id: string, amountCents: number, sortOrder: number) => ({ id, amountCents, sortOrder, createdAt: '2026-10-01T00:00:00Z' })
const pay = (id: string, amountCents: number, paidOn: string, at = '2026-10-21T12:00:00Z') => ({ id, amountCents, paidOn, createdAt: at })

describe('schedule amounts', () => {
  test('$8,914.27 at 50%: deposit and final add up to the contract exactly', () => {
    const d = depositOf(891427, 50)
    expect(d).toBe(445714)
    expect(finalOf(891427, [d])).toBe(445713)
    expect(d + finalOf(891427, [d])).toBe(891427)
  })
  test('no deposit percent on the contract: 50%; 30% when it says so; odd cents', () => {
    expect(depositOf(100001, 0)).toBe(50001)
    expect(depositOf(100001, undefined)).toBe(50001)
    expect(depositOf(333333, 30)).toBe(100000)
    expect(finalOf(333333, [100000])).toBe(233333)
  })
  test('the Final is never below zero', () => expect(finalOf(1000, [1500])).toBe(0))
})

describe('payments: oldest open invoice first, the rest carried', () => {
  const invoices = [inv('final', 445713, 99), inv('deposit', 445714, 0)]
  test('more than the deposit: the rest goes to the final', () => {
    const a = applyPayments(invoices, [pay('p1', 500000, '2026-10-21')])
    expect(a.applications).toEqual([{ paymentId: 'p1', invoiceId: 'deposit', amountCents: 445714 }, { paymentId: 'p1', invoiceId: 'final', amountCents: 54286 }])
    expect(a.creditCents).toBe(0)
  })
  test('short: the deposit stays partly open; next payment fills it first', () => {
    const a = applyPayments(invoices, [pay('p2', 445700, '2026-10-22'), pay('p1', 400000, '2026-10-21')])
    expect(a.paidByInvoice.get('deposit')).toBe(445714)
    expect(a.paidByInvoice.get('final')).toBe(845700 - 445714)
  })
  test('over the total: a credit; voided payments do not count', () => {
    const a = applyPayments(invoices, [pay('p1', 900000, '2026-10-21'), { ...pay('p2', 5000, '2026-10-21'), voided: true }])
    expect(a.creditCents).toBe(900000 - 891427)
    expect(a.unappliedByPayment.get('p1')).toBe(8573)
  })
})

test('plain words', () => {
  expect(moneyText(445700)).toBe('$4,457.00')
  expect(moneyText(-27)).toBe('-$0.27')
  expect(methodText('check', '1234')).toBe('Check #1234')
  expect(methodText('check', null, 'Cashiers check')).toBe('Check (Cashiers check)')
  expect(methodText('zelle')).toBe('Zelle')
})
