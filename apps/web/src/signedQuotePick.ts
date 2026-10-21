/**
 * The quote a card moving to Signed marks sold (signedContractFlow.ts), kept
 * apart from the stores so it can be tested on its own.
 *
 * Only the card's own customer's quotes, by customer id (Jonathan, Oct 21,
 * 2026): never a quote found by the customer's name, phone or email, which
 * could be another customer's. The card's own quote first (the one it was
 * made or signed for), when it is that customer's and not lost; else that
 * customer's newest open quote, else their newest sold one.
 */

export interface PickableQuote { id: string; customerId?: string | null; status: string; date?: string }

export function pickSignedQuote<Q extends PickableQuote>(quotes: Q[], customerId: string | null | undefined, ownQuoteId?: string | null): Q | null {
  if (!customerId) return null
  const own = ownQuoteId ? quotes.find(q => q.id === ownQuoteId) : undefined
  if (own && own.customerId === customerId && own.status !== 'LOST') return own
  const theirs = quotes
    .filter(q => q.customerId === customerId && q.status !== 'LOST')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  // Not already sold first, so each drop on Signed picks a fresh quote.
  return theirs.find(q => q.status !== 'SOLD') ?? theirs[0] ?? null
}
