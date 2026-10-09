/**
 * Pipeline card values and header numbers come from the customer's quotes.
 */
import { describe, test, expect } from 'vitest'
import { leadValue, relevantQuote, pipelineMetrics } from '../../web/src/pipelineValue'

const lead = (over: Partial<{ id: string; customerId: string; stage: string; quotePrice: number; jobValue: number; createdAt: string }> = {}) =>
  ({ id: 'l1', customerId: 'c1', stage: 'Pending Signature', quotePrice: 0, jobValue: 0, createdAt: '2026-09-01', ...over })
const quote = (over: Partial<{ id: string; customerId: string; status: string; date: string; finalPrice: number }> = {}) =>
  ({ id: 'q1', customerId: 'c1', status: 'SENT', date: '2026-09-10', finalPrice: 5000, ...over })

describe('leadValue', () => {
  test('before Signed Contract the open quote sets the value, even when the card says $0', () => {
    expect(leadValue(lead(), [quote()])).toBe(5000)
    expect(leadValue(lead({ stage: 'First Contact' }), [quote({ status: 'DRAFT', finalPrice: 4385.55 })])).toBe(4385.55)
  })

  test('the newest open quote wins; sold and lost quotes are ignored before the sale', () => {
    const quotes = [
      quote({ id: 'a', date: '2026-08-01', finalPrice: 3000 }),
      quote({ id: 'b', date: '2026-09-15', finalPrice: 7000 }),
      quote({ id: 'c', status: 'SOLD', date: '2026-09-20', finalPrice: 9999 }),
      quote({ id: 'd', status: 'LOST', date: '2026-09-25', finalPrice: 8888 }),
    ]
    expect(leadValue(lead(), quotes)).toBe(7000)
  })

  test('on the same day a sent quote beats a draft', () => {
    const quotes = [quote({ id: 'a', status: 'DRAFT', finalPrice: 1 }), quote({ id: 'b', status: 'SENT', finalPrice: 2 })]
    expect(leadValue(lead(), quotes)).toBe(2)
  })

  test('from Signed Contract onward the sold quote sets the value', () => {
    const quotes = [quote({ id: 'a', finalPrice: 24810.73 }), quote({ id: 'b', status: 'SOLD', finalPrice: 7109.03 })]
    for (const stage of ['Signed Contract', 'Job Prep', 'Jobs In Progress', 'Job Complete', 'Paid & Closed']) {
      expect(leadValue(lead({ stage }), quotes)).toBe(7109.03)
    }
  })

  test('a repeat customer in production shows the job still to be installed', () => {
    const quotes = [
      quote({ id: 'old', status: 'SOLD', date: '2025-05-09', finalPrice: 9476.39 }),
      quote({ id: 'new', status: 'SOLD', date: '2026-05-22', finalPrice: 724.39 }),
      quote({ id: 'newer-but-done', status: 'SOLD', date: '2026-06-01', finalPrice: 100 }),
    ]
    const jobs = [{ quoteId: 'old', completedDate: '2025-07-24' }, { quoteId: 'new', completedDate: null }, { quoteId: 'newer-but-done', completedDate: '2026-06-05' }]
    expect(leadValue(lead({ stage: 'Signed Contract' }), quotes, jobs)).toBe(724.39)
    // Once everything is installed, the newest sold quote.
    expect(leadValue(lead({ stage: 'Paid & Closed' }), quotes, jobs)).toBe(100)
  })

  test('other customers\' quotes never count, and a card with no customer keeps its own figure', () => {
    expect(leadValue(lead({ quotePrice: 1200 }), [quote({ customerId: 'someone-else' })])).toBe(1200)
    expect(leadValue(lead({ customerId: undefined, jobValue: 900 }), [quote({ customerId: undefined })])).toBe(900)
    expect(relevantQuote(lead({ customerId: undefined }), [quote({ customerId: undefined })])).toBeUndefined()
  })

  test('no fitting quote falls back to the card, then to zero', () => {
    expect(leadValue(lead({ quotePrice: 800 }), [quote({ status: 'LOST' })])).toBe(800)
    expect(leadValue(lead(), [])).toBe(0)
  })
})

describe('pipelineMetrics', () => {
  const leads = [
    lead({ id: '1', customerId: 'a', stage: 'First Contact', createdAt: '2026-10-02' }),      // no quote
    lead({ id: '2', customerId: 'b', stage: 'Estimating', createdAt: '2026-10-03' }),          // draft 2,000
    lead({ id: '3', customerId: 'c', stage: 'Pending Signature', createdAt: '2026-09-01' }),   // sent 10,000
    lead({ id: '4', customerId: 'd', stage: 'Signed Contract', createdAt: '2026-10-01' }),     // sold 6,000 in October
    lead({ id: '5', customerId: 'e', stage: 'Paid & Closed', createdAt: '2026-03-01' }),       // sold 4,000 back in May
    lead({ id: '6', customerId: 'f', stage: 'Lost Sale', createdAt: '2026-10-04' }),           // sent 50,000, lost
  ]
  const quotes = [
    quote({ id: 'qb', customerId: 'b', status: 'DRAFT', finalPrice: 2000 }),
    quote({ id: 'qc', customerId: 'c', status: 'SENT', finalPrice: 10000 }),
    quote({ id: 'qd', customerId: 'd', status: 'SOLD', date: '2026-10-05', finalPrice: 6000 }),
    quote({ id: 'qe', customerId: 'e', status: 'SOLD', date: '2026-05-22', finalPrice: 4000 }),
    quote({ id: 'qf', customerId: 'f', status: 'SENT', finalPrice: 50000 }),
  ]
  const m = pipelineMetrics(leads, quotes, [], '2026-07-11')   // the last 90 days as of Oct 9, 2026

  test('pipeline value is the open cards only', () => {
    expect(m.pipelineValue).toBe(12000)
    expect(m.openCount).toBe(3)
  })

  test('weighted pipeline applies each stage\'s chance of closing', () => {
    expect(m.weighted).toBeCloseTo(2000 * 0.30 + 10000 * 0.60, 6)
  })

  test('average deal size skips open cards that have no value yet', () => {
    expect(m.avgDeal).toBe(6000)
  })

  test('sold is every card from Signed Contract onward', () => {
    expect(m.sold).toBe(10000)
    expect(m.soldCount).toBe(2)
  })

  test('close rate is cards sold in the period over cards created in the period', () => {
    expect(m.soldInPeriod).toBe(1)          // the October sale; the May one is too old
    expect(m.createdInPeriod).toBe(5)       // every card but the one created in March
    expect(m.closeRate).toBe(20)
  })

  test('an empty pipeline reads zero everywhere', () => {
    expect(pipelineMetrics([], [], [], '2026-07-11')).toMatchObject({ pipelineValue: 0, weighted: 0, avgDeal: 0, sold: 0, closeRate: 0 })
  })
})
