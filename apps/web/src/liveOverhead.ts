/**
 * Overhead % from the budget: yearly overhead ÷ yearly installed revenue
 * (installed by install date, the way the GD Schedule counts it). Used for
 * Target Margin when "Use live overhead from my budget" is on and the budget
 * has its overhead filled in; otherwise the typed Overhead % is used.
 */

import { getBusinessField } from './businessStateStore'
import { getJobs } from './jobStore'
import { setLiveOverheadSource, type AppConfig } from './configStore'
import { businessDate } from './businessDate'

export interface LiveOverhead {
  pct: number
  overhead: number
  revenue: number
  basis: 'last12' | 'projection'
  /** How it was worked out, in words. */
  how: string
}

const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

/** Yearly overhead from the budget (top level items, so a group is not counted twice). */
export function budgetOverheadPerYear(): number {
  const b = getBusinessField('budget') as { overhead?: Array<{ annual?: number; parentId?: string | null }> } | null
  return (b?.overhead ?? []).filter(o => !o.parentId).reduce((t, o) => t + (Number(o.annual) || 0), 0)
}

const jobValue = (j: { contractValue?: number; quotePrice?: number }) => Number(j.contractValue) || Number(j.quotePrice) || 0

export function liveOverhead(basis: 'last12' | 'projection', today = new Date()): LiveOverhead | null {
  const overhead = budgetOverheadPerYear()
  if (!(overhead > 0)) return null
  const jobs = getJobs() as Array<{ completedDate?: string; contractValue?: number; quotePrice?: number }>
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

/**
 * Moved more than 3 points from the month before (from the monthly history in
 * Settings). Null when there is no earlier month to compare with.
 */
export function overheadMoved(cfg: AppConfig, now: LiveOverhead): { from: number; month: string } | null {
  const thisMonth = businessDate(new Date()).slice(0, 7)
  const earlier = (cfg.pricing.overheadHistory ?? []).filter(h => h.month < thisMonth).sort((a, b) => b.month.localeCompare(a.month))[0]
  if (!earlier) return null
  return Math.abs(now.pct - earlier.pct) > 3 ? { from: earlier.pct, month: earlier.month } : null
}

/** Live overhead is used for Target Margin from here on (cached briefly: Settings is read often). */
let cache: { at: number; basis: string; pct: number | null } | null = null
setLiveOverheadSource(cfg => {
  const basis = cfg.pricing.liveOverhead?.basis ?? 'last12'
  if (cache && cache.basis === basis && Date.now() - cache.at < 30_000) return cache.pct
  const live = liveOverhead(basis)
  cache = { at: Date.now(), basis, pct: live ? live.pct : null }
  return cache.pct
})
