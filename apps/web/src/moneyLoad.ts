/**
 * What the money screens load from the server (memory only), for moneyTruth.ts:
 * the payment schedules' open invoices (Billing, Balance Sheet) and the
 * payments received (P&L and Budget cash basis).
 */

import { useEffect, useState } from 'react'
import { sendJson } from './syncHttp'
import { getInvoices, getPayments } from './billingStore'
import { getQuotes, getArchivedQuotes } from './quoteStore'
import { getJobs, getArchivedJobs } from './jobStore'
import { getConfig, overheadPctOf } from './configStore'
import { businessDate } from './businessDate'
import type { SavedQuote } from './QuotesPage'
import {
  legacyPaymentsReceived, receivablesTotal, clearedCash, targetMargins, withChangeOrders, soldInYear, budgetActuals, installedRevenue, projectYear, toCents,
  targetOfStyle, quoteGrade, weightedTarget, hasCost,
  type ReceivedPayment, type TargetMargins, type BudgetActuals, type QuoteForGrade, type QuoteForMargin, type QuoteGrade, type MarginTone,
} from './moneyTruth'

/** An open invoice on a job's payment schedule (portal lib/jobTruth.ts receivables). */
export interface Receivable {
  invoiceId: string; jobId: string; customerId: string | null; customerName: string; address: string; fenceStyle: string
  label: string; kind: string; amountCents: number; balanceCents: number; state: 'not_due' | 'due' | 'overdue' | 'paid'; dueDate: string | null; daysOver: number
}

/** A payment received on a schedule (portal lib/jobTruth.ts paymentsReceived). */
export interface ReceivedRow {
  id: string; jobId: string; customerName: string; amountCents: number; paidOn: string; method: string
  customerId: string | null; address: string; fenceStyle: string; checkNumber: string | null; reference: string | null
  receipt: { id: string; number: number } | null
  /** received | cleared | null (recorded before states were kept: reads as cleared) (Nov 6 2026). */
  clearState: 'received' | 'cleared' | null; clearedOn: string | null
}

function useServerList<T>(path: string, failWords: string): { rows: T[] | null; error: string } {
  const [rows, setRows] = useState<T[] | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    sendJson('GET', path).then(r => {
      if (!live) return
      if (r.result.ok && Array.isArray(r.json?.data)) setRows(r.json.data); else setError(r.json?.error || failWords)
    })
    return () => { live = false }
  }, [path, failWords])
  return { rows, error }
}

/** What is owed on the payment schedules (one source with the job's Financial and Payments). */
export const useReceivables = () => useServerList<Receivable>('/api/payments/receivables', 'What is owed needs signal to load.')

/** Payments received on the payment schedules. */
export const useReceived = () => useServerList<ReceivedRow>('/api/payments/received', 'Payments received need signal to load.')

/**
 * The P&L's cash: the schedules' payments by the day they cleared (received and not cleared yet left out, Nov 6
 * 2026), and the hand-made Billing invoices' not taken into a schedule (no states: by the day paid).
 */
export function allReceived(rows: ReceivedRow[]): ReceivedPayment[] {
  return [...clearedCash(rows), ...legacyPaymentsReceived(getInvoices(), getPayments())]
}

/** Outstanding and overdue, exactly as the Billing page adds them up. */
export function receivablesNow(rows: Receivable[], today: string) {
  return receivablesTotal(rows, getInvoices(), today)
}

// ── Target Margin and the year's actuals (Budget, Reports, Dashboard) ────────

/** The Target Margin quotes are priced at (Settings › Pricing), as every screen shows it. */
export function companyTargets(): TargetMargins {
  const cfg = getConfig()
  return targetMargins(cfg.fenceStyles ?? [], overheadPctOf(cfg))
}

/** A style's Target Margin (Settings › Pricing) as a fraction; a style not in Settings gets the lowest one. */
export function styleTarget(styleName: string): number {
  const cfg = getConfig()
  return targetOfStyle(cfg.fenceStyles ?? [], styleName) ?? companyTargets().minPct / 100
}

/** One quote's price less cost against the Target Margin it was priced with (moneyTruth.quoteGrade). */
export function gradeOfQuote(q: QuoteForGrade): QuoteGrade {
  const cfg = getConfig()
  return quoteGrade(q, cfg.fenceStyles ?? [], targetMargins(cfg.fenceStyles ?? [], overheadPctOf(cfg)).minPct / 100)
}

/** One quote's grade as a tone; 'none' when it has no cost. */
export function quoteMarginTone(q: QuoteForGrade): MarginTone {
  return gradeOfQuote(q).tone
}

/**
 * The grade for a whole list: Settings read once, not once per quote.
 * getConfig() works every fence style out from Inventory, so counting 2,000
 * quotes one at a time held a phone's screen for seconds on every draw of the
 * Quotes page (Oct 31 2026). Same answers as quoteMarginTone.
 */
export function quoteGrader(): (q: QuoteForGrade) => QuoteGrade {
  const cfg = getConfig()
  const styles = cfg.fenceStyles ?? []
  const lowest = targetMargins(styles, overheadPctOf(cfg)).minPct / 100
  return q => quoteGrade(q, styles, lowest)
}

/** quoteGrader as a tone. Same answers as quoteMarginTone. */
export function quoteMarginToner(): (q: QuoteForGrade) => MarginTone {
  const grade = quoteGrader()
  return q => grade(q).tone
}

/** A group of quotes' Target Margin: each priced target, by price (moneyTruth.weightedTarget). */
export function groupTarget(quotes: Array<QuoteForMargin & Pick<QuoteForGrade, 'fenceStyle' | 'pricing' | 'work'>>): number {
  const t = companyTargets()
  return weightedTarget(getConfig().fenceStyles ?? [], quotes, t.minPct / 100) ?? t.minPct / 100
}

/**
 * A job's margin: graded through its quote (a job keeps only the saved after
 * commission figure, no price less cost). Null when no quote with a cost is on file.
 */
export function gradeOfJob(job: { quoteId?: string | null }): QuoteGrade | null {
  if (!job.quoteId) return null
  const q = getQuotes().find(x => x.id === job.quoteId) ?? (getArchivedQuotes() as SavedQuote[]).find(x => x.id === job.quoteId)
  return q && hasCost(q) ? gradeOfQuote(q) : null
}

/** Every quote (archived too) with sold ones at their contract (change orders added): what Reports and the Dashboard count. */
export function reportQuotes(): SavedQuote[] {
  return withChangeOrders([...getQuotes(), ...(getArchivedQuotes() as SavedQuote[])], [...getJobs(), ...getArchivedJobs()])
}

/** Installed revenue for a year, cents; this year's carried to the full year (projected). */
export function yearRevenueCents(year: number, today = businessDate(new Date())): { installedCents: number; yearCents: number; projected: boolean } {
  const jobs = [...getJobs(), ...getArchivedJobs()]
  const thisYear = Number(today.slice(0, 4)) === year
  // The whole year, as the Dashboard counts it (a completed date is never ahead of today).
  const installedCents = installedRevenue(jobs, `${year}-01-01`, `${year}-12-31`).cents
  return { installedCents, yearCents: thisYear ? projectYear(installedCents, today) : installedCents, projected: thisYear }
}

/**
 * The year's actual shares (Budget, Reports Budget Variance, Dashboard):
 * materials, labor and gross margin from that year's sold quotes with costs;
 * overhead = the budget's yearly overhead ÷ the year's installed revenue.
 */
export function yearActuals(year: number, yearlyOverheadDollars: number): BudgetActuals & { soldCount: number; yearRevenueCents: number; projected: boolean } {
  const sold = soldInYear(reportQuotes(), year)
  const rev = yearRevenueCents(year)
  return { ...budgetActuals(sold, toCents(yearlyOverheadDollars), rev.yearCents), soldCount: sold.length, yearRevenueCents: rev.yearCents, projected: rev.projected }
}

/** The lowest Target Margin in Settings › Pricing as a fraction (less half a point for whole dollar rounding): margin colors use it. */
export function lowTarget(): number {
  return companyTargets().minPct / 100 - 0.005
}
