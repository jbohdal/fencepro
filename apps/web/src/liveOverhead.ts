/**
 * Overhead % from the budget: yearly overhead ÷ yearly installed revenue
 * (installed by install date, the way the GD Schedule counts it). Used for
 * Target Margin when "Use live overhead from my budget" is on and the budget
 * has its overhead filled in; otherwise the typed Overhead % is used.
 *
 * Worked out on the server from the budget and every job of the company
 * (portal lib/liveOverhead.ts, liveOverheadMath.ts) and read with Settings
 * (businessStateStore.ts getOverheadNow), never from the jobs this phone
 * holds: a Salesman's phone holds only her own, and her quotes came out at the
 * typed 30% while the owner's were at the live 36.9% (Oct 30 2026). So the
 * owner, the office, the Salesman and the website all price at one figure.
 */

import { getOverheadNow } from './businessStateStore'
import { setLiveOverheadSource, type AppConfig } from './configStore'
import { businessDate } from './businessDate'
import { liveOverheadPctIn, type LiveOverhead, type OverheadBasis } from './liveOverheadMath'

export type { LiveOverhead } from './liveOverheadMath'

/** Live overhead on a basis, as the server last worked it out (null: not available, the typed one is used). */
export function liveOverhead(basis: OverheadBasis): LiveOverhead | null {
  return getOverheadNow()?.[basis] ?? null
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

/** Live overhead is used for Target Margin from here on: the server's figure for the basis chosen in Settings. */
setLiveOverheadSource(cfg => liveOverheadPctIn(cfg.pricing, getOverheadNow()))
