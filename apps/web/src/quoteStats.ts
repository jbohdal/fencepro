/**
 * Summary numbers for the dashboard and the Quotes page.
 */

interface QuoteForStats {
  totalCOGS: number
  gmPct: number
}

interface JobForStats {
  completedDate?: string | null   // YYYY-MM-DD, set once the job is installed
  contractValue: number
  quotePrice: number
}

const jobValue = (j: JobForStats) => j.contractValue || j.quotePrice

/** Installed revenue for one year: jobs with a completion (install) date in
 *  that year. The year is read off the date text: new Date('2026-01-01') is
 *  still December 31 in Florida. */
export function installedRevenueForYear(jobs: JobForStats[], year: number): number {
  return jobs
    .filter(j => (j.completedDate || '').startsWith(`${year}-`))
    .reduce((s, j) => s + jobValue(j), 0)
}

/** Sold but not installed: every job with no completion date yet, whatever
 *  year it was sold in. */
export function soldNotInstalled(jobs: JobForStats[]): { count: number; total: number } {
  const open = jobs.filter(j => !j.completedDate)
  return { count: open.length, total: open.reduce((s, j) => s + jobValue(j), 0) }
}

/** Average gross margin over quotes that carry a cost. A quote with a price
 *  but no cost (an imported one) says nothing about margin, so it is left out.
 *  Null when there is no costed quote to average. */
export function averageMargin(quotes: QuoteForStats[]): number | null {
  const costed = quotes.filter(q => q.totalCOGS > 0)
  if (costed.length === 0) return null
  return costed.reduce((s, q) => s + q.gmPct, 0) / costed.length
}
