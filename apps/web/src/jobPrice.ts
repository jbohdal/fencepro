import { shownDollarCents } from '../../portal/src/server/lib/paymentMath'

/**
 * The price a job for this quote starts with, in dollars. Sold now (never sold before, no soldAt): the whole dollar
 * the customer saw and is billed (Jonathan, Oct 29 2026, D1: "Customers pay what they saw"; portal
 * lib/paymentMath.ts shownDollarCents, the billing's own function). A quote sold before keeps its price as priced;
 * the server decides by its signing date (routes/saved-jobs.ts, lib/contractBilling.ts salePriceForJob) and the job
 * takes the server's figures when the save is confirmed.
 */
export function jobPriceOfQuote(quote: { finalPrice: number; soldAt?: string | null }): number {
  const price = Number(quote.finalPrice) || 0
  return quote.soldAt ? price : shownDollarCents(Math.round(price * 100)) / 100
}
