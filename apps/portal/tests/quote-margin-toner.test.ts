import { describe, it, expect, vi, beforeEach } from 'vitest'

// The Quotes page counts every quote at its Target Margin on each draw. getConfig() works every fence
// style out from Inventory, so one read per quote held a phone's screen for seconds (Oct 31 2026).
const reads = vi.hoisted(() => ({ n: 0 }))
const styles = [
  { name: 'A', isActive: true, margin: 0.6 },
  { name: 'B', isActive: true, margin: 0.7 },
]
vi.mock('../../web/src/configStore', () => ({
  getConfig: () => { reads.n++; return { fenceStyles: styles } },
  overheadPctOf: () => 30,
}))
vi.mock('../../web/src/syncHttp', () => ({ sendJson: vi.fn() }))
vi.mock('../../web/src/billingStore', () => ({ getInvoices: () => [], getPayments: () => [] }))
vi.mock('../../web/src/quoteStore', () => ({ getQuotes: () => [], getArchivedQuotes: () => [] }))
vi.mock('../../web/src/jobStore', () => ({ getJobs: () => [], getArchivedJobs: () => [] }))

import { quoteMarginTone, quoteMarginToner } from '../../web/src/moneyLoad'

const quotes = ['A', 'B', 'Not in Settings'].flatMap(fenceStyle =>
  [0.1, 0.295, 0.31, 0.395, 0.41, 0.6].map(gmPct => ({ gmPct, totalCOGS: 100, fenceStyle })),
).concat({ gmPct: 0.5, totalCOGS: 0, fenceStyle: 'A' })

describe('quoteMarginToner', () => {
  beforeEach(() => { reads.n = 0 })

  it('gives the same answer as quoteMarginTone for every quote', () => {
    const toneOf = quoteMarginToner()
    for (const q of quotes) expect(toneOf(q), JSON.stringify(q)).toBe(quoteMarginTone(q))
    expect(new Set(quotes.map(toneOf)).size).toBeGreaterThan(2)
  })

  it('reads Settings once for a whole list', () => {
    const toneOf = quoteMarginToner()
    quotes.forEach(toneOf)
    expect(reads.n).toBe(1)
  })
})
