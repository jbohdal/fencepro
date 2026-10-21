/**
 * A card moving to Signed marks sold only its own customer's quote
 * (apps/web/src/signedQuotePick.ts, used by signedContractFlow.ts): the
 * card's own quote first, else that customer's newest open quote, by
 * customer id only. Another customer's quote with the same name, phone or
 * email is never picked.
 */

import { describe, test, expect } from 'vitest'
import { pickSignedQuote } from '../../web/src/signedQuotePick'

const q = (id: string, customerId: string | undefined, status: string, date: string, extra: Record<string, string> = {}) => ({ id, customerId, status, date, customerName: 'Pat Smith', customerPhone: '3525550100', customerEmail: 'pat@example.test', ...extra })

describe('the quote a card on Signed marks sold', () => {
  const quotes = [
    q('other-newest', 'cust-B', 'DRAFT', '2026-10-20'),            // same name, phone and email, another customer
    q('unlinked', undefined, 'DRAFT', '2026-10-21'),                // no customer at all
    q('mine-old', 'cust-A', 'DRAFT', '2026-09-01'),
    q('mine-new', 'cust-A', 'SENT', '2026-10-01'),
    q('mine-sold', 'cust-A', 'SOLD', '2026-10-10'),
    q('mine-lost', 'cust-A', 'LOST', '2026-10-15'),
  ]

  test('the card\'s own quote first', () => {
    expect(pickSignedQuote(quotes, 'cust-A', 'mine-old')?.id).toBe('mine-old')
    expect(pickSignedQuote(quotes, 'cust-A', 'mine-sold')?.id).toBe('mine-sold')
  })

  test('else the customer\'s newest open quote, then their sold one', () => {
    expect(pickSignedQuote(quotes, 'cust-A')?.id).toBe('mine-new')
    expect(pickSignedQuote(quotes.filter(x => x.status !== 'DRAFT' && x.status !== 'SENT'), 'cust-A')?.id).toBe('mine-sold')
  })

  test('never another customer\'s quote, an unlinked one, or a lost one, whatever the name, phone or email', () => {
    expect(pickSignedQuote(quotes, 'cust-A', 'other-newest')?.id).toBe('mine-new')
    expect(pickSignedQuote(quotes, 'cust-A', 'unlinked')?.id).toBe('mine-new')
    expect(pickSignedQuote(quotes, 'cust-A', 'mine-lost')?.id).toBe('mine-new')
    expect(pickSignedQuote(quotes, 'cust-C')).toBeNull()
    expect(pickSignedQuote(quotes.filter(x => x.customerId !== 'cust-A' || x.status === 'LOST'), 'cust-A')).toBeNull()
    expect(pickSignedQuote(quotes, null, 'other-newest')).toBeNull()
  })
})
