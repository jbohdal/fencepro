/**
 * Dashboard and Quotes page summary numbers.
 */
import { describe, test, expect } from 'vitest'
import { averageMargin, installedRevenueForYear, soldNotInstalled } from '../../web/src/quoteStats'

const q = (over: Partial<{ status: string; date: string; finalPrice: number; totalCOGS: number; gmPct: number }>) =>
  ({ status: 'SOLD', date: '2026-05-10', finalPrice: 1000, totalCOGS: 600, gmPct: 0.4, ...over })

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

describe('installed revenue and open jobs', () => {
  const job = (over: Partial<{ completedDate: string | null; contractValue: number; quotePrice: number }>) =>
    ({ completedDate: '2026-03-10', contractValue: 1000, quotePrice: 1000, ...over })
  const jobs = [
    job({ contractValue: 5000 }),
    job({ contractValue: 2500.5, completedDate: '2026-09-22' }),
    job({ contractValue: 9000, completedDate: '2025-12-31' }),
    job({ contractValue: 7109.03, completedDate: null }),
    job({ contractValue: 724.39, completedDate: undefined }),
  ]

  test('installed revenue counts jobs by install date in that year', () => {
    expect(installedRevenueForYear(jobs, 2026)).toBeCloseTo(7500.5, 2)
    expect(installedRevenueForYear(jobs, 2025)).toBe(9000)
    expect(installedRevenueForYear(jobs, 2024)).toBe(0)
  })

  test('a job sold last year and installed this year counts this year', () => {
    // The sold date lives on the quote; only the install date matters here.
    expect(installedRevenueForYear([job({ completedDate: '2026-01-06', contractValue: 4441.09 })], 2026)).toBeCloseTo(4441.09, 2)
  })

  test('a January 1 install belongs to its own year', () => {
    expect(installedRevenueForYear([job({ completedDate: '2026-01-01' })], 2026)).toBe(1000)
    expect(installedRevenueForYear([job({ completedDate: '2026-01-01' })], 2025)).toBe(0)
  })

  test('open jobs are left out of installed revenue and counted separately', () => {
    expect(soldNotInstalled(jobs)).toEqual({ count: 2, total: 7109.03 + 724.39 })
    expect(soldNotInstalled([])).toEqual({ count: 0, total: 0 })
  })

  test('falls back to the quote price when no contract value is set', () => {
    expect(installedRevenueForYear([job({ contractValue: 0, quotePrice: 800 })], 2026)).toBe(800)
  })
})
