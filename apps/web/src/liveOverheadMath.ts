/**
 * Live overhead, pure (no browser): yearly overhead from the budget ÷ yearly
 * installed revenue (installed by install date, the way the GD Schedule counts
 * it). Worked out on the server only (portal lib/liveOverhead.ts), from the
 * budget and every job of the company, and handed to every phone with the
 * Settings: a Salesman's phone holds only her own jobs, and priced from those
 * it fell back to the typed Overhead % (30%) while the owner priced at the
 * live 36.9%, so her quotes came out about 12% lower (Oct 30 2026).
 */

import { businessDate } from './businessDate'

export type OverheadBasis = 'last12' | 'projection'

export interface LiveOverhead {
  pct: number
  overhead: number
  revenue: number
  basis: OverheadBasis
  /** How it was worked out, in words. */
  how: string
}

/** Live overhead for each basis (null: no budget overhead, or no installed revenue for that time). */
export type OverheadNow = Record<OverheadBasis, LiveOverhead | null>

export interface OverheadJob { completedDate?: string | null; contractValue?: number | null; quotePrice?: number | null }

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

/** Yearly overhead from the budget (top level items, so a group is not counted twice). */
export function budgetOverheadOf(budget: unknown): number {
  const b = budget as { overhead?: Array<{ annual?: number; parentId?: string | null }> } | null
  return (Array.isArray(b?.overhead) ? b!.overhead : []).filter(o => o && !o.parentId).reduce((t, o) => t + (Number(o.annual) || 0), 0)
}

const jobValue = (j: OverheadJob) => Number(j.contractValue) || Number(j.quotePrice) || 0

/** Live overhead on one basis from the budget and the company's jobs (not archived, not deleted). */
export function liveOverheadOf(budget: unknown, jobs: OverheadJob[], basis: OverheadBasis, today = new Date()): LiveOverhead | null {
  const overhead = budgetOverheadOf(budget)
  if (!(overhead > 0)) return null
  const day = businessDate(today)
  let revenue: number, how: string
  if (basis === 'last12') {
    const from = businessDate(new Date(today.getTime() - 365 * 86_400_000))
    revenue = jobs.filter(j => j.completedDate && j.completedDate > from && j.completedDate <= day).reduce((t, j) => t + jobValue(j), 0)
    how = `${money(overhead)} yearly overhead from the budget ÷ ${money(revenue)} installed from ${from} to ${day}`
  } else {
    const year = day.slice(0, 4)
    const ytd = jobs.filter(j => (j.completedDate || '').startsWith(`${year}-`) && j.completedDate! <= day).reduce((t, j) => t + jobValue(j), 0)
    const start = Date.parse(`${year}-01-01`), elapsed = (Date.parse(day) - start) / 86_400_000 + 1
    const daysInYear = (Date.parse(`${Number(year) + 1}-01-01`) - start) / 86_400_000
    revenue = elapsed > 0 ? ytd * daysInYear / elapsed : 0
    how = `${money(overhead)} yearly overhead from the budget ÷ ${money(revenue)} projected for ${year} (${money(ytd)} installed in ${Math.round(elapsed)} days, carried to the full year)`
  }
  if (!(revenue > 0)) return null
  return { pct: Math.round((overhead / revenue) * 1000) / 10, overhead, revenue, basis, how }
}

/** Both bases at once (what the server hands out). */
export function overheadNowOf(budget: unknown, jobs: OverheadJob[], today = new Date()): OverheadNow {
  return { last12: liveOverheadOf(budget, jobs, 'last12', today), projection: liveOverheadOf(budget, jobs, 'projection', today) }
}

/**
 * The live Overhead % in use for these Settings: the basis chosen in Settings,
 * while "Use live overhead from my budget" is on and it could be worked out.
 * Null: the typed Overhead % is used.
 */
export function liveOverheadPctIn(pricing: { liveOverhead?: { on?: boolean; basis?: OverheadBasis } } | null | undefined, now: OverheadNow | null | undefined): number | null {
  if (!pricing?.liveOverhead?.on || !now) return null
  const live = now[pricing.liveOverhead.basis ?? 'last12']
  return live && Number.isFinite(live.pct) ? live.pct : null
}
