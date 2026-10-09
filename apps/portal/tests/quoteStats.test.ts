/**
 * Dashboard and Quotes page summary numbers.
 */
import { describe, test, expect } from 'vitest'
import { soldRevenueForYear, averageMargin } from '../../web/src/quoteStats'

const q = (over: Partial<{ status: string; date: string; finalPrice: number; totalCOGS: number; gmPct: number }>) =>
  ({ status: 'SOLD', date: '2026-05-10', finalPrice: 1000, totalCOGS: 600, gmPct: 0.4, ...over })

describe('soldRevenueForYear', () => {
  test('counts only sold quotes dated in that year', () => {
    const quotes = [
      q({ finalPrice: 1000 }),
      q({ finalPrice: 2500.5, date: '2026-10-08' }),
      q({ finalPrice: 9000, date: '2025-12-31' }),
      q({ finalPrice: 7000, date: '2024-02-22' }),
      q({ finalPrice: 400, status: 'SENT' }),
      q({ finalPrice: 300, status: 'LOST' }),
    ]
    expect(soldRevenueForYear(quotes, 2026)).toBeCloseTo(3500.5, 2)
    expect(soldRevenueForYear(quotes, 2025)).toBe(9000)
  })

  test('a January 1 sale belongs to its own year', () => {
    expect(soldRevenueForYear([q({ date: '2026-01-01' })], 2026)).toBe(1000)
    expect(soldRevenueForYear([q({ date: '2026-01-01' })], 2025)).toBe(0)
  })

  test('a quote with no date is not counted', () => {
    expect(soldRevenueForYear([q({ date: '' })], 2026)).toBe(0)
  })
})

describe('averageMargin', () => {
  test('quotes with no cost are left out', () => {
    const quotes = [q({ gmPct: 0.4 }), q({ gmPct: 0.3 }), q({ totalCOGS: 0, gmPct: 0 }), q({ totalCOGS: 0, gmPct: 0 })]
    expect(averageMargin(quotes)).toBeCloseTo(0.35, 6)
  })

  test('every status counts, as before', () => {
    expect(averageMargin([q({ status: 'DRAFT', gmPct: 0.5 }), q({ status: 'LOST', gmPct: 0.3 })])).toBeCloseTo(0.4, 6)
  })

  test('nothing to average gives null, not zero', () => {
    expect(averageMargin([])).toBeNull()
    expect(averageMargin([q({ totalCOGS: 0, gmPct: 0 })])).toBeNull()
  })
})
