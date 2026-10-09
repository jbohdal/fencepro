/**
 * Summary numbers for the dashboard and the Quotes page.
 */

interface QuoteForStats {
  status: string
  date: string        // YYYY-MM-DD
  finalPrice: number
  totalCOGS: number
  gmPct: number
}

/** Sold revenue for one calendar year, by quote date. The year is read off the
 *  date text: new Date('2026-01-01') is still December 31 in Florida. */
export function soldRevenueForYear(quotes: QuoteForStats[], year: number): number {
  return quotes
    .filter(q => q.status === 'SOLD' && (q.date || '').startsWith(`${year}-`))
    .reduce((s, q) => s + q.finalPrice, 0)
}

/** Average gross margin over quotes that carry a cost. A quote with a price
 *  but no cost (an imported one) says nothing about margin, so it is left out.
 *  Null when there is no costed quote to average. */
export function averageMargin(quotes: QuoteForStats[]): number | null {
  const costed = quotes.filter(q => q.totalCOGS > 0)
  if (costed.length === 0) return null
  return costed.reduce((s, q) => s + q.gmPct, 0) / costed.length
}
