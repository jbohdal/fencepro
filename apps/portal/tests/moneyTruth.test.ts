/**
 * The owner's money screens from one source (web moneyTruth.ts; Oct 26, 2026
 * audit item 6): revenue on each basis, receivables, margin over quotes with
 * costs only, the Target Margin from Settings, the Budget's actual shares and
 * a balance sheet that always balances. Every number in cents.
 */
import { describe, test, expect } from 'vitest'
import {
  toCents, dayIn, cashReceived, installedRevenue, legacyPaymentsReceived, receivablesTotal,
  marginOf, leftOutWords, targetMargins, targetOfStyle, weightedTarget, marginTone,
  budgetActuals, projectYear, balanceSheet, withChangeOrders, soldInYear, jobContractCents,
} from '../../web/src/moneyTruth'

describe('revenue', () => {
  const payments = [
    { paidOn: '2026-10-20', amountCents: 350000 },
    { paidOn: '2026-10-21', amountCents: 445700 },
    { paidOn: '2026-10-22', amountCents: 481900 },
    { paidOn: '2025-12-31', amountCents: 100 },
  ]
  test('cash basis: payments received in the period, by the day paid, both ends counted', () => {
    expect(cashReceived(payments, '2026-01-01', '2026-10-26')).toEqual({ cents: 1277600, count: 3 })
    expect(cashReceived(payments, '2026-10-21', '2026-10-21')).toEqual({ cents: 445700, count: 1 })
    expect(cashReceived(payments, '2026-11-01', '2026-11-30')).toEqual({ cents: 0, count: 0 })
  })
  test('installed basis: jobs finished in the period at their contract value (else the quote price), in cents', () => {
    const jobs = [
      { completedDate: '2026-03-02', contractValue: 8914, quotePrice: 8914.27 },
      { completedDate: '2026-10-26', contractValue: 0, quotePrice: 7363.1 },
      { completedDate: null, contractValue: 5000, quotePrice: 5000 },
      { completedDate: '2025-12-31', contractValue: 1, quotePrice: 1 },
    ]
    expect(installedRevenue(jobs, '2026-01-01', '2026-12-31')).toEqual({ cents: 891400 + 736310, count: 2 })
    expect(jobContractCents({ contractValue: 0.1 + 0.2, quotePrice: 0 })).toBe(30)
  })
  test('a payment on a hand-made invoice counts once: not when its invoice was taken into a schedule', () => {
    const invoices = [{ id: 'a', adoptedJobId: 'job1' }, { id: 'b' }, { id: 'c', status: 'void' }]
    const pays = [
      { invoiceId: 'a', amountCents: 445700, paymentDate: '2026-10-21' },
      { invoiceId: 'b', amountCents: 1000, paymentDate: '2026-10-22T14:00:00.000Z' },
      { invoiceId: 'c', amountCents: 5, paymentDate: '2026-10-22' },
    ]
    expect(legacyPaymentsReceived(invoices, pays)).toEqual([{ paidOn: '2026-10-22', amountCents: 1000 }])
  })
  test('dayIn reads the date text, inclusive', () => {
    expect(dayIn('2026-01-01', '2026-01-01', '2026-12-31')).toBe(true)
    expect(dayIn('2026-12-31T23:00:00Z', '2026-01-01', '2026-12-31')).toBe(true)
    expect(dayIn('', '2026-01-01', '2026-12-31')).toBe(false)
    expect(dayIn(null, '2026-01-01', '2026-12-31')).toBe(false)
  })
})

describe('receivables (Billing Outstanding = Balance Sheet receivables)', () => {
  test('schedule balances plus hand-made invoices not taken into a schedule', () => {
    const rows = [
      { balanceCents: 711383, state: 'overdue' },
      { balanceCents: 445700, state: 'not_due' },
      { balanceCents: 0, state: 'paid' },
    ]
    const legacy = [
      { status: 'sent', balanceDueCents: 10000, dueDate: '2026-10-01' },          // overdue
      { status: 'sent', balanceDueCents: 5000, dueDate: '2026-11-01' },           // not due
      { status: 'paid', balanceDueCents: 0, dueDate: '2026-10-01' },
      { status: 'void', balanceDueCents: 999, dueDate: '2026-10-01' },
      { status: 'paid', balanceDueCents: 445700, dueDate: '2026-10-01', adoptedJobId: 'j' }, // on its schedule already
    ]
    expect(receivablesTotal(rows, legacy, '2026-10-26')).toEqual({ outstandingCents: 711383 + 445700 + 10000 + 5000, overdueCents: 711383 + 10000, openCount: 4 })
  })
})

describe('margin: only quotes with costs', () => {
  const sold = [
    { id: 'a', customerName: 'A', finalPrice: 10000, totalCOGS: 5600, materialCost: 4000, laborCost: 1500, tearOutCost: 100 },
    { id: 'b', customerName: 'B', finalPrice: 5000, totalCOGS: 3000, materialCost: 2000, laborCost: 1000, tearOutCost: 0 },
    { id: 'c', customerName: 'GD Schedule import', finalPrice: 20000, totalCOGS: 0 },
  ]
  test('a quote with no cost is left out and named, never 100% margin', () => {
    const m = marginOf(sold)
    expect(m.revenueCents).toBe(1500000)
    expect(m.costCents).toBe(860000)
    expect(m.grossProfitCents).toBe(640000)
    expect(m.margin).toBeCloseTo(640000 / 1500000, 10)
    expect(m.withCosts).toBe(2)
    expect(m.leftOut).toEqual([{ id: 'c', customerName: 'GD Schedule import', priceCents: 2000000 }])
    expect(m.materialCents).toBe(600000)
    expect(m.laborCents).toBe(250000)
    expect(m.tearOutCents).toBe(10000)
    expect(leftOutWords(m)).toBe('1 sold quote without costs left out')
  })
  test('nothing with a cost: no margin at all (a dash), not 0% or 100%', () => {
    const m = marginOf([sold[2]])
    expect(m.margin).toBeNull()
    expect(m.grossProfitCents).toBe(0)
    expect(marginOf([]).margin).toBeNull()
  })
  test('the style that read 100% (Aluminum: 8 sold, none with costs) now has no margin, and says why', () => {
    const alum = Array.from({ length: 8 }, (_, i) => ({ id: `al${i}`, finalPrice: 5941, totalCOGS: 0 }))
    const m = marginOf(alum)
    expect(m.margin).toBeNull()
    expect(m.leftOut.length).toBe(8)
  })
  test('sold quotes at their contract (change orders added), sold in a year read off the date text', () => {
    const quotes = [
      { id: 'q1', status: 'SOLD', finalPrice: 7363.1, date: '2026-10-26' },
      { id: 'q2', status: 'SENT', finalPrice: 100, date: '2026-10-26' },
      { id: 'q3', status: 'SOLD', finalPrice: 50, date: '2025-12-31' },
    ]
    const withCo = withChangeOrders(quotes, [{ quoteId: 'q1', changeOrderTotal: 640.2 }, { quoteId: 'q2', changeOrderTotal: 9 }])
    expect(withCo[0].finalPrice).toBe(8003.3)
    expect(withCo[1].finalPrice).toBe(100)
    expect(quotes[0].finalPrice).toBe(7363.1)
    expect(soldInYear(withCo, 2026).map(q => q.id)).toEqual(['q1'])
  })
})

describe('Target Margin: one setting (Settings › Pricing)', () => {
  // As getConfig() returns them: margin = (100 − overhead − profit) / 100.
  const styles = [
    { name: "WV-ND 6'x8' Privacy", margin: 0.56 },
    { name: "WV-DS 6'x8' Privacy", margin: 0.6 },
    { name: "CL - 4' Galv", margin: 0.58 },
    { name: "Alum - ND - Emily - 48", margin: 0.58 },
    { name: 'Old style', margin: 0.5, isActive: false },
    { name: 'wood/privacy/6/nd/8', margin: 0.56, woodOf: "WV-ND 6'x8' Privacy" },
  ]
  test('each level and the styles at it; switched off and wood styles left out', () => {
    const t = targetMargins(styles, 30)
    expect(t.levels).toEqual([
      { pct: 44, styles: ["WV-ND 6'x8' Privacy"] },
      { pct: 42, styles: ["CL - 4' Galv", 'Alum - ND - Emily - 48'] },
      { pct: 40, styles: ["WV-DS 6'x8' Privacy"] },
    ])
    expect(t.words).toBe('40% to 44%')
    expect(t.minPct).toBe(40)
    expect(t.overheadPct).toBe(30)
    expect(targetMargins([{ name: 'x', margin: 0.56 }], 30).words).toBe('44%')
  })
  test('the Budget\'s 34.6% (its overhead 24% + profit 10.6%) is not the Target Margin quotes price at', () => {
    expect(targetMargins(styles, 30).words).not.toContain('34.6')
  })
  test('a group\'s target is its quotes\' style targets, by price; a style not in Settings counts at the lowest', () => {
    expect(targetOfStyle(styles, "WV-ND 6'x8' Privacy")).toBeCloseTo(0.44, 10)
    expect(targetOfStyle(styles, 'nope')).toBeNull()
    const qs = [
      { fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 3000, totalCOGS: 1680 },
      { fenceStyle: "WV-DS 6'x8' Privacy", finalPrice: 1000, totalCOGS: 600 },
      { fenceStyle: 'GD import', finalPrice: 9999, totalCOGS: 0 },       // no cost: not counted
      { fenceStyle: 'unknown', finalPrice: 1000, totalCOGS: 500 },        // counts at the lowest, 40%
    ]
    expect(weightedTarget(styles, qs, 0.4)).toBeCloseTo((3000 * 0.44 + 1000 * 0.4 + 1000 * 0.4) / 5000, 10)
    expect(weightedTarget(styles, [qs[2]], 0.4)).toBeNull()
  })
  test('tone: on target (whole dollar rounding allowed), up to 5 points under, further under, no cost', () => {
    expect(marginTone(0.4399, 0.44)).toBe('good')
    expect(marginTone(0.40, 0.44)).toBe('near')
    expect(marginTone(0.38, 0.44)).toBe('bad')
    expect(marginTone(null, 0.44)).toBe('none')
  })
})

describe('Budget actual shares', () => {
  test('from quotes with costs and the budget overhead over installed revenue; net profit = gross margin − overhead', () => {
    const sold = [
      { finalPrice: 10000, totalCOGS: 5600, materialCost: 4400, laborCost: 1100, tearOutCost: 100 },
      { finalPrice: 30000, totalCOGS: 0 },
    ]
    const a = budgetActuals(sold, toCents(242141), toCents(761000))
    expect(a.materialsPct).toBeCloseTo(0.44, 10)
    expect(a.laborPct).toBeCloseTo(0.12, 10)
    expect(a.grossMargin).toBeCloseTo(0.44, 10)
    expect(a.overheadPct).toBeCloseTo(242141 / 761000, 10)
    expect(a.netProfitPct).toBeCloseTo(0.44 - 242141 / 761000, 10)
    expect(a.withCosts).toBe(1)
    expect(a.leftOut).toBe(1)
  })
  test('the old 55% "actual net profit" cannot happen: quotes without costs no longer dilute materials', () => {
    // Before: materials $29,465 ÷ all sold $676,724 = 4.4%, so "net profit" came out 55%.
    const sold = [{ finalPrice: 66000, totalCOGS: 35852, materialCost: 29465, laborCost: 6212, tearOutCost: 176 }, ...Array.from({ length: 94 }, () => ({ finalPrice: 6500, totalCOGS: 0 }))]
    const a = budgetActuals(sold, toCents(242141), toCents(761000))
    expect(a.materialsPct!).toBeGreaterThan(0.4)
    expect(a.netProfitPct!).toBeLessThan(0.2)
  })
  test('unknowns stay unknown', () => {
    const a = budgetActuals([{ finalPrice: 100, totalCOGS: 0 }], 0, 0)
    expect(a).toMatchObject({ materialsPct: null, laborPct: null, grossMargin: null, overheadPct: null, netProfitPct: null })
  })
  test('this year projected to the full year (as live overhead does)', () => {
    expect(projectYear(36600, '2026-12-31')).toBe(36600)
    expect(projectYear(1000, '2026-01-01')).toBe(365000)
    expect(projectYear(62446724, '2026-10-26')).toBe(Math.round(62446724 * 365 / 299))
  })
})

describe('balance sheet always balances', () => {
  test('nothing typed: receivables and payables only; equity worked out and what is missing named', () => {
    const b = balanceSheet({ arCents: 3109400, apCents: 213900, entries: [] })
    expect(b.assetsCents).toBe(3109400)
    expect(b.liabilitiesCents).toBe(213900)
    expect(b.workedOutEquityCents).toBe(3109400 - 213900)
    expect(b.assetsCents).toBe(b.liabilitiesAndEquityCents)
    expect(b.missing).toEqual(['cash in the bank', 'trucks, trailers and equipment', 'loans and credit cards', "owner's equity (the opening balance)"])
  })
  test('the audit\'s "Out of balance -$2,139" (receivables $0, payables $2,139) now balances with negative worked out equity', () => {
    const b = balanceSheet({ arCents: 0, apCents: 213900, entries: [] })
    expect(b.workedOutEquityCents).toBe(-213900)
    expect(b.assetsCents - b.liabilitiesAndEquityCents).toBe(0)
  })
  test('typed lines count in their sections; a sheet typed in full has nothing worked out', () => {
    const entries = [
      { category: 'current_asset' as const, amountCents: 5000000 },
      { category: 'fixed_asset' as const, amountCents: 8000000 },
      { category: 'long_term_liability' as const, amountCents: 3000000 },
      { category: 'equity' as const, amountCents: 10000000 + 100000 },
    ]
    const b = balanceSheet({ arCents: 100000, apCents: 0, entries })
    expect(b.currentAssetsCents).toBe(5100000)
    expect(b.assetsCents).toBe(13100000)
    expect(b.liabilitiesCents).toBe(3000000)
    expect(b.enteredEquityCents).toBe(10100000)
    expect(b.workedOutEquityCents).toBe(0)
    expect(b.missing).toEqual([])
    expect(b.assetsCents).toBe(b.liabilitiesAndEquityCents)
  })
})
