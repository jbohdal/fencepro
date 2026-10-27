/**
 * One source for every money number the owner reads (Oct 26, 2026 audit item 6:
 * the P&L, Balance Sheet, Budget, Reports and Dashboard disagreed).
 *
 * Pure: no browser, no stores. The screens hand it what they loaded and show
 * what it returns, so the same concept is worked out one way everywhere:
 *
 *   Revenue, cash basis      payments received in the period (the payment
 *                            schedules' "Payment received", by the day paid),
 *                            plus payments on hand-made Billing invoices that
 *                            were never taken into a schedule.
 *   Revenue, installed       jobs finished (completed date) in the period, at
 *   (accrual)                their contract value: what the Dashboard calls
 *                            "Revenue this year".
 *   Receivables              the open balances of the payment schedules, plus
 *                            hand-made Billing invoices not taken into one:
 *                            exactly the Billing page's Outstanding.
 *   Margin                   only sold quotes that carry a cost. A quote with
 *                            a price and no cost (the GD Schedule imports) is
 *                            left out, counted and named, never 100% margin.
 *   Target Margin            Settings › Pricing: Overhead % + each style's
 *                            Target Profit %, the number quotes are priced at.
 *   Balance sheet            Assets = Liabilities + Equity always; equity not
 *                            entered is worked out (assets minus liabilities)
 *                            and said so, with what is missing.
 *
 * Money in cents. Quotes and jobs carry dollars; each is turned into cents
 * once, on its own, before adding up.
 */

export const toCents = (dollars: number | null | undefined): number => Math.round((Number(dollars) || 0) * 100)

/** A YYYY-MM-DD day inside [from, to] (both YYYY-MM-DD, inclusive). */
export const dayIn = (day: string | null | undefined, from: string, to: string): boolean =>
  !!day && /^\d{4}-\d{2}-\d{2}/.test(day) && day.slice(0, 10) >= from && day.slice(0, 10) <= to

// ── Revenue ─────────────────────────────────────────────────────────────────

export type RevenueBasis = 'installed' | 'cash'

export const BASIS_WORDS: Record<RevenueBasis, { name: string; short: string; how: string }> = {
  installed: {
    name: 'Installed (accrual)',
    short: 'installed',
    how: 'Jobs finished in the period, at their contract value (the Dashboard\'s "Revenue this year").',
  },
  cash: {
    name: 'Payments received (cash)',
    short: 'payments received',
    how: 'Payments recorded with "Payment received" in the period, by the day paid. Voided payments are left out.',
  },
}

export interface ReceivedPayment { paidOn: string; amountCents: number }

/** Cash basis: payments received from `from` to `to` (YYYY-MM-DD, inclusive). */
export function cashReceived(payments: ReceivedPayment[], from: string, to: string): { cents: number; count: number } {
  let cents = 0, count = 0
  for (const p of payments) {
    if (!dayIn(p.paidOn, from, to)) continue
    cents += Math.round(Number(p.amountCents) || 0)
    count++
  }
  return { cents, count }
}

export interface JobForRevenue { completedDate?: string | null; contractValue?: number | null; quotePrice?: number | null }

/** A job's contract value in cents: the contract (with change orders) when there is one, else the quote's price. */
export const jobContractCents = (j: JobForRevenue): number => toCents(Number(j.contractValue) || Number(j.quotePrice) || 0)

/** Installed (accrual) basis: jobs finished from `from` to `to`, at contract value. */
export function installedRevenue(jobs: JobForRevenue[], from: string, to: string): { cents: number; count: number } {
  let cents = 0, count = 0
  for (const j of jobs) {
    if (!dayIn(j.completedDate, from, to)) continue
    cents += jobContractCents(j)
    count++
  }
  return { cents, count }
}

/**
 * Payments on hand-made Billing invoices (the old Billing store) that count as
 * received: only those whose invoice was never taken into a job's payment
 * schedule (an adopted invoice's payment is on the schedule already, so it
 * would be counted twice).
 */
export function legacyPaymentsReceived(
  invoices: Array<{ id: string; adoptedJobId?: string; status?: string }>,
  payments: Array<{ invoiceId: string; amountCents: number; paymentDate: string }>,
): ReceivedPayment[] {
  return legacyPaymentsCounted(invoices, payments).map(p => ({ paidOn: String(p.paymentDate || '').slice(0, 10), amountCents: p.amountCents }))
}

/** The hand-made Billing payments themselves that count as received (legacyPaymentsReceived): the Billing page lists them. */
export function legacyPaymentsCounted<P extends { invoiceId: string }>(invoices: Array<{ id: string; adoptedJobId?: string; status?: string }>, payments: P[]): P[] {
  const skip = new Set(invoices.filter(i => i.adoptedJobId || i.status === 'void').map(i => i.id))
  return payments.filter(p => !skip.has(p.invoiceId))
}

// ── Receivables ─────────────────────────────────────────────────────────────

export interface ScheduleReceivable { balanceCents: number; state: string }
export interface LegacyInvoice { status: string; balanceDueCents: number; dueDate: string; adoptedJobId?: string }

/**
 * What customers owe: open payment schedule invoices plus hand-made Billing
 * invoices that were not taken into a schedule. The Billing page's
 * Outstanding and the Balance Sheet's Accounts Receivable both come from here.
 */
export function receivablesTotal(rows: ScheduleReceivable[], legacy: LegacyInvoice[], today: string): { outstandingCents: number; overdueCents: number; openCount: number } {
  let outstandingCents = 0, overdueCents = 0, openCount = 0
  for (const r of rows) {
    if (!(r.balanceCents > 0)) continue
    outstandingCents += r.balanceCents
    if (r.state === 'overdue') overdueCents += r.balanceCents
    openCount++
  }
  for (const i of legacy) {
    if (i.adoptedJobId || i.status === 'void' || !(i.balanceDueCents > 0)) continue
    outstandingCents += i.balanceDueCents
    if (i.dueDate && i.dueDate.slice(0, 10) < today) overdueCents += i.balanceDueCents
    openCount++
  }
  return { outstandingCents, overdueCents, openCount }
}

// ── Margin ──────────────────────────────────────────────────────────────────

export interface QuoteForMargin {
  id?: string
  customerName?: string
  finalPrice: number
  totalCOGS: number
  materialCost?: number
  laborCost?: number
  tearOutCost?: number
}

/** A sold quote says something about margin only when it carries a cost. */
export const hasCost = (q: Pick<QuoteForMargin, 'totalCOGS'>): boolean => (Number(q.totalCOGS) || 0) > 0

export interface MarginResult {
  /** Price of the quotes with costs, cents. */
  revenueCents: number
  costCents: number
  materialCents: number
  laborCents: number
  tearOutCents: number
  grossProfitCents: number
  /** Gross profit ÷ price of the quotes with costs; null when none has a cost. */
  margin: number | null
  withCosts: number
  /** Sold quotes with no cost: never counted as profit. */
  leftOut: Array<{ id: string; customerName: string; priceCents: number }>
  leftOutCents: number
}

/** Gross margin over the quotes that carry a cost; the others are counted and named as left out. */
export function marginOf(quotes: QuoteForMargin[]): MarginResult {
  let revenueCents = 0, costCents = 0, materialCents = 0, laborCents = 0, tearOutCents = 0, withCosts = 0, leftOutCents = 0
  const leftOut: MarginResult['leftOut'] = []
  for (const q of quotes) {
    const price = toCents(q.finalPrice)
    if (!hasCost(q)) { leftOut.push({ id: q.id ?? '', customerName: q.customerName ?? '', priceCents: price }); leftOutCents += price; continue }
    withCosts++
    revenueCents += price
    costCents += toCents(q.totalCOGS)
    materialCents += toCents(q.materialCost)
    laborCents += toCents(q.laborCost)
    tearOutCents += toCents(q.tearOutCost)
  }
  const grossProfitCents = revenueCents - costCents
  return {
    revenueCents, costCents, materialCents, laborCents, tearOutCents, grossProfitCents,
    margin: revenueCents > 0 ? grossProfitCents / revenueCents : null,
    withCosts, leftOut, leftOutCents,
  }
}

/** "94 sold without costs left out" (or ''), for under a margin. */
export function leftOutWords(m: Pick<MarginResult, 'leftOut'>): string {
  const n = m.leftOut.length
  return n ? `${n} sold ${n === 1 ? 'quote' : 'quotes'} without costs left out` : ''
}

/**
 * Sold quotes at their contract: the signed price plus the job's approved
 * change orders (the job's changeOrderTotal). What Reports, the Dashboard and
 * the Budget count. The quotes themselves are not changed.
 */
export function withChangeOrders<Q extends { id: string; status: string; finalPrice: number }>(quotes: Q[], jobs: Array<{ quoteId?: string | null; changeOrderTotal?: number | null }>): Q[] {
  const co = new Map<string, number>()
  for (const j of jobs) if (j.quoteId && j.changeOrderTotal) co.set(j.quoteId, Number(j.changeOrderTotal) || 0)
  return quotes.map(q => (q.status === 'SOLD' && co.get(q.id) ? { ...q, finalPrice: (toCents(q.finalPrice) + toCents(co.get(q.id))) / 100 } : q))
}

/** Sold quotes whose sale date (the quote's date) is in `year`, read off the date text. */
export function soldInYear<Q extends { status: string; date?: string | null }>(quotes: Q[], year: number): Q[] {
  return quotes.filter(q => q.status === 'SOLD' && String(q.date || '').startsWith(`${year}-`))
}

// ── Target Margin (Settings › Pricing) ──────────────────────────────────────

export interface StyleForTarget { name: string; margin: number; isActive?: boolean; woodOf?: string }

export interface TargetMargins {
  /** Overhead % in use (typed, or live from the budget when switched on). */
  overheadPct: number
  /** Each distinct Target Margin and how many styles use it, highest first. */
  levels: Array<{ pct: number; styles: string[] }>
  minPct: number
  maxPct: number
  /** "40% to 44%" or "44%". */
  words: string
}

const round1 = (n: number) => Math.round(n * 10) / 10
const pctText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`

/**
 * The Target Margin quotes are priced at, from Settings › Pricing (the
 * styles as getConfig() returns them, so `margin` is already Overhead % +
 * Target Profit %). Styles switched off are left out unless every one is.
 */
export function targetMargins(styles: StyleForTarget[], overheadPct: number): TargetMargins {
  const active = styles.filter(s => s.isActive !== false && !s.woodOf)
  const use = active.length ? active : styles
  const by = new Map<number, string[]>()
  for (const s of use) {
    const pct = round1((1 - (Number(s.margin) || 0)) * 100)
    by.set(pct, [...(by.get(pct) ?? []), s.name])
  }
  const levels = [...by.entries()].map(([pct, names]) => ({ pct, styles: names })).sort((a, b) => b.pct - a.pct)
  const minPct = levels.length ? levels[levels.length - 1].pct : 0
  const maxPct = levels.length ? levels[0].pct : 0
  return { overheadPct, levels, minPct, maxPct, words: !levels.length ? 'not set' : minPct === maxPct ? pctText(maxPct) : `${pctText(minPct)} to ${pctText(maxPct)}` }
}

/** One style's Target Margin as a fraction (0.44), or null when the style is not in Settings. */
export function targetOfStyle(styles: StyleForTarget[], styleName: string): number | null {
  const s = styles.find(x => x.name === styleName)
  return s ? 1 - (Number(s.margin) || 0) : null
}

/**
 * The Target Margin a group of quotes should reach: each quote's style
 * target, weighted by its price (a style not in Settings counts at the
 * lowest target). Only quotes with costs. Null when there are none.
 */
export function weightedTarget(styles: StyleForTarget[], quotes: Array<QuoteForMargin & { fenceStyle?: string }>, fallback: number): number | null {
  let price = 0, weighted = 0
  for (const q of quotes) {
    if (!hasCost(q)) continue
    const p = toCents(q.finalPrice)
    price += p
    weighted += p * (targetOfStyle(styles, q.fenceStyle ?? '') ?? fallback)
  }
  return price > 0 ? weighted / price : null
}

/** On target (green), up to 5 points under (amber), or further under (red). */
export function marginTone(margin: number | null, target: number): 'good' | 'near' | 'bad' | 'none' {
  if (margin === null) return 'none'
  if (margin >= target - 0.005) return 'good'
  if (margin >= target - 0.05) return 'near'
  return 'bad'
}

// ── Budget: actual shares of revenue ────────────────────────────────────────

export interface BudgetActuals {
  /** Materials ÷ price, labor ÷ price, gross margin: sold quotes with costs. */
  materialsPct: number | null
  laborPct: number | null
  grossMargin: number | null
  /** Yearly overhead from the budget ÷ yearly installed revenue (projected). */
  overheadPct: number | null
  /** Gross margin − overhead share: an estimate, null when either is unknown. */
  netProfitPct: number | null
  withCosts: number
  leftOut: number
}

/**
 * The Budget's "actual" percents, from real records only: materials, labor
 * and gross margin from sold quotes that carry a cost; overhead from the
 * budget's yearly overhead over the installed revenue for the year
 * (projected to the full year); net profit = gross margin − overhead share.
 */
export function budgetActuals(sold: QuoteForMargin[], yearlyOverheadCents: number, yearlyRevenueCents: number): BudgetActuals {
  const m = marginOf(sold)
  const materialsPct = m.revenueCents > 0 ? (m.materialCents) / m.revenueCents : null
  const laborPct = m.revenueCents > 0 ? (m.laborCents + m.tearOutCents) / m.revenueCents : null
  const overheadPct = yearlyRevenueCents > 0 && yearlyOverheadCents > 0 ? yearlyOverheadCents / yearlyRevenueCents : null
  const netProfitPct = m.margin !== null && overheadPct !== null ? m.margin - overheadPct : null
  return { materialsPct, laborPct, grossMargin: m.margin, overheadPct, netProfitPct, withCosts: m.withCosts, leftOut: m.leftOut.length }
}

/** Installed revenue so far this year carried to the full year (how live overhead projects it). */
export function projectYear(ytdCents: number, today: string): number {
  const year = today.slice(0, 4)
  const start = Date.parse(`${year}-01-01T00:00:00Z`)
  const elapsed = (Date.parse(`${today}T00:00:00Z`) - start) / 86_400_000 + 1
  const days = (Date.parse(`${Number(year) + 1}-01-01T00:00:00Z`) - start) / 86_400_000
  return elapsed > 0 ? Math.round(ytdCents * days / elapsed) : 0
}

// ── Balance sheet ───────────────────────────────────────────────────────────

export interface BalanceInput {
  /** Accounts receivable (receivablesTotal), cents. */
  arCents: number
  /** Accounts payable (open vendor bills), cents. */
  apCents: number
  entries: Array<{ category: 'current_asset' | 'fixed_asset' | 'other_asset' | 'current_liability' | 'long_term_liability' | 'equity'; amountCents: number }>
}

export interface BalanceResult {
  currentAssetsCents: number
  fixedAssetsCents: number
  otherAssetsCents: number
  assetsCents: number
  currentLiabilitiesCents: number
  longTermLiabilitiesCents: number
  liabilitiesCents: number
  /** Equity typed in the Balance Sheet Editor. */
  enteredEquityCents: number
  /** Equity not typed: assets − liabilities − entered equity (shown as worked out). */
  workedOutEquityCents: number
  equityCents: number
  liabilitiesAndEquityCents: number
  /** What has not been entered yet, in words, for the note under the sheet. */
  missing: string[]
}

/**
 * Assets = Liabilities + Equity, always. Receivables and payables come from
 * the records; everything else is typed in the editor. Whatever equity the
 * typed lines do not explain is shown as its own line, "worked out", with
 * what is missing, instead of an "Out of balance" warning.
 */
export function balanceSheet(input: BalanceInput): BalanceResult {
  const sum = (c: BalanceInput['entries'][number]['category']) => input.entries.filter(e => e.category === c).reduce((s, e) => s + Math.round(e.amountCents || 0), 0)
  const currentAssetsCents = sum('current_asset') + input.arCents
  const fixedAssetsCents = sum('fixed_asset')
  const otherAssetsCents = sum('other_asset')
  const assetsCents = currentAssetsCents + fixedAssetsCents + otherAssetsCents
  const currentLiabilitiesCents = sum('current_liability') + input.apCents
  const longTermLiabilitiesCents = sum('long_term_liability')
  const liabilitiesCents = currentLiabilitiesCents + longTermLiabilitiesCents
  const enteredEquityCents = sum('equity')
  const workedOutEquityCents = assetsCents - liabilitiesCents - enteredEquityCents
  const has = (c: BalanceInput['entries'][number]['category']) => input.entries.some(e => e.category === c)
  const missing: string[] = []
  if (!has('current_asset')) missing.push('cash in the bank')
  if (!has('fixed_asset')) missing.push('trucks, trailers and equipment')
  if (!has('long_term_liability') && !has('current_liability')) missing.push('loans and credit cards')
  if (!has('equity')) missing.push("owner's equity (the opening balance)")
  return {
    currentAssetsCents, fixedAssetsCents, otherAssetsCents, assetsCents,
    currentLiabilitiesCents, longTermLiabilitiesCents, liabilitiesCents,
    enteredEquityCents, workedOutEquityCents,
    equityCents: enteredEquityCents + workedOutEquityCents,
    liabilitiesAndEquityCents: liabilitiesCents + enteredEquityCents + workedOutEquityCents,
    missing,
  }
}
