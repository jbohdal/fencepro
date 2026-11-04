/**
 * An unsent draft takes today's Target Profit (Jonathan, Nov 2 2026: "A
 * change only affects new quotes and unsent drafts. Sent and signed quotes
 * never change.").
 *
 * A saved quote keeps the cost factor it was priced with (pricing.costFactor:
 * 1 − Target Margin). For a draft that was never sent, shared, viewed, signed
 * or sold, and whose Target Margin came from Settings (not typed on the
 * quote), opening it again prices it at its fence's Target Profit and the
 * Overhead % in use today (Jonathan, Nov 3 2026: "and overhead follows too").
 * The quote builder says so, with the old and new price, before it is saved
 * (QuoteBuilder draftLine). Sub rates already follow Settings on a draft: a
 * quote keeps a sub rate only when one was typed on it.
 *
 * Which Target Profit the factor came from is saved with the quote since this
 * rule (pricing.targetProfitPct, only when the factor is the Settings one). A
 * quote saved before keeps its factor until it is saved again: its factor
 * cannot tell a margin typed by hand from one Settings gave (dev, Nov 2 2026:
 * three aluminum drafts at 14% while aluminum is 12% would have dropped $505
 * each with no Settings change). legacyProfit says which of them match
 * Settings today (for a one time stamp, if Jonathan wants one).
 *
 * Pure: the server runs it for a Salesman's quote (lib/quotePricing.ts).
 */

import { proposalSent } from './proposalOptions'
import { earnedProfitPct } from './targetMargin'

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The parts of a fence the Target Profit is read from (resolved Settings: targetMargin.ts). */
export type StyleProfit = Parameters<typeof earnedProfitPct>[0]

/** The Target Profit a fence earns today, as its price reads it (targetMargin.ts earnedProfitPct). */
export function styleEarn(s: StyleProfit | null | undefined): number | undefined {
  return s ? earnedProfitPct(s) : undefined
}

/** The cost factor Settings gives at this overhead and Target Profit, worked out as withTargetMargins does (bit for bit). */
export function settingsFactor(overheadPct: number, profitPct: number): number {
  return (100 - overheadPct - profitPct) / 100
}

/** Saved with a quote: the Target Profit its cost factor came from, when it came from Settings (undefined: typed, or no factor). */
export function profitRecord(costFactor: number | undefined, overheadPct: number, style: StyleProfit | null | undefined): { targetProfitPct?: number } {
  const earn = styleEarn(style)
  return fin(costFactor) && earn !== undefined && costFactor === settingsFactor(overheadPct, earn) ? { targetProfitPct: earn } : {}
}

export interface QuoteForDraft {
  status?: string | null
  shareToken?: string | null
  acceptedAt?: unknown
  soldAt?: unknown
  firstViewedAt?: unknown
  viewCount?: number | null
  work?: unknown
  pricing?: { costFactor?: number; overheadPct?: number; targetProfitPct?: number; priceMethod?: string; finalPrice?: number } | null
}

/** Never sent: a draft not shared, viewed, accepted or sold (the quote builder's pricesStand is the opposite). */
export function isUnsentDraft(q: QuoteForDraft | null | undefined): boolean {
  return !!q && (q.status ?? 'DRAFT') === 'DRAFT' && !q.shareToken && !proposalSent(q)
}

/** The Target Profit a saved quote's cost factor came from, saved with it; null when typed by hand or saved before this rule. */
export function factorProfit(p: QuoteForDraft['pricing']): number | null {
  if (!p || !fin(p.costFactor) || !fin(p.overheadPct) || !fin(p.targetProfitPct)) return null
  return p.costFactor === settingsFactor(p.overheadPct, p.targetProfitPct) ? p.targetProfitPct : null
}

/** A quote saved before this rule: the Target Profit its factor and Overhead % give, when that is its fence's Target Profit today; else null. */
export function legacyProfit(p: QuoteForDraft['pricing'], style: StyleProfit | null | undefined): number | null {
  if (!p || !fin(p.costFactor) || !fin(p.overheadPct) || fin(p.targetProfitPct)) return null
  const earn = styleEarn(style)
  return earn !== undefined && p.costFactor === settingsFactor(p.overheadPct, earn) ? earn : null
}

export interface DraftMargin {
  /** The cost factor it is priced with now. */
  costFactor: number
  profitPct: number
  wasProfitPct: number
  /** The Overhead % it is priced with now: today's. */
  overheadPct: number
  /** The Overhead % it was saved with. */
  wasOverheadPct: number
}

/** Overheads this close are the same one (a live overhead read back from a saved quote). */
const sameOverhead = (a: number, b: number) => Math.abs(a - b) < 0.005

/**
 * An unsent draft whose Target Margin came from Settings and whose fence's
 * Target Profit, or the Overhead % in use (overheadToday), has changed since:
 * the cost factor it takes now. Null: it is priced as saved (sent, signed, a
 * move or repair, a typed margin or price, or nothing changed).
 */
export function draftMarginNow(q: QuoteForDraft | null | undefined, style: StyleProfit | null | undefined, overheadToday?: number): DraftMargin | null {
  if (!q || !isUnsentDraft(q) || q.work) return null
  const p = q.pricing
  if (!p || (p.priceMethod && p.priceMethod !== 'cost_factor')) return null
  const was = factorProfit(p)
  const now = styleEarn(style)
  if (was === null || now === undefined) return null
  const wasOverhead = p.overheadPct!
  const overhead = fin(overheadToday) && !sameOverhead(overheadToday, wasOverhead) ? overheadToday : wasOverhead
  if (now === was && overhead === wasOverhead) return null
  return { costFactor: settingsFactor(overhead, now), profitPct: now, wasProfitPct: was, overheadPct: overhead, wasOverheadPct: wasOverhead }
}

const pctText = (n: number) => `${Math.round(n * 10) / 10}%`

/** What the quote builder says about it: "Target Profit for this fence is now 11% (was 10%) in Settings, so …" */
export function draftMarginWords(d: DraftMargin): string {
  const changed = [
    ...(d.profitPct !== d.wasProfitPct ? [`Target Profit for this fence is now ${d.profitPct}% (was ${d.wasProfitPct}%)`] : []),
    ...(d.overheadPct !== d.wasOverheadPct ? [`Overhead is now ${pctText(d.overheadPct)} (was ${pctText(d.wasOverheadPct)})`] : []),
  ]
  return `${changed.join(' and ')} in Settings, so this unsent draft is priced at the new Target Margin.`
}
