/**
 * Live overhead worked out on the server (Oct 30 2026): yearly overhead from
 * the budget ÷ installed revenue of every job of the company (not archived,
 * not deleted), the math in web/src/liveOverheadMath.ts.
 *
 * Why here: the app worked it out on each phone from the jobs that phone
 * holds. A Salesman's phone holds only her own jobs (lib/salesScope.ts), so
 * live overhead came out as "not available" there and her quotes were priced
 * at the typed 30% while the owner's were at the live 36.9%: about 12% lower
 * for the same yard, and the server saved them. Now:
 *
 *   - every read of Settings (GET /api/business-state) carries `overheadNow`
 *     (both bases), and every phone prices with it (web liveOverhead.ts);
 *   - the server's own pricing (Salesman's and Installer's view and save, the
 *     website quote, change orders, the #58 price check) puts the same figure
 *     on the Settings it prices with (withLiveOverhead: pricing.liveOverheadPct,
 *     never saved; web estimate.ts estimateOverheadPct);
 *   - the pricing stamp (lib/pricingStamp.ts) carries the figure in use, so a
 *     phone priced on an older figure reprices before it saves.
 *
 * A saved quote keeps the Overhead % it was priced at, as before.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'

type Json = any

export interface LiveOverhead { pct: number; overhead: number; revenue: number; basis: 'last12' | 'projection'; how: string }
export interface OverheadNow { last12: LiveOverhead | null; projection: LiveOverhead | null }

/** Read again at most every 30 seconds per company (the stamp check asks often); a Settings save forgets it. */
const HOLD_MS = 30_000
const cache = new Map<string, { at: number; now: OverheadNow }>()

/** Both bases now, from the saved budget and every job of the company. */
export async function overheadNowFor(accountId: string, today = new Date()): Promise<OverheadNow> {
  const held = cache.get(accountId)
  if (held && Date.now() - held.at < HOLD_MS) return held.now
  const [m, b, jobs] = await Promise.all([
    pricingModule() as Promise<Json>,
    prisma.businessState.findUnique({ where: { accountId }, select: { budget: true } }),
    prisma.savedJob.findMany({
      where: { accountId, deletedAt: null, archivedAt: null, completedDate: { not: null } },
      select: { completedDate: true, contractValue: true, quotePrice: true },
    }),
  ])
  const now = m.overheadNowOf(b?.budget ?? null, jobs, today) as OverheadNow
  cache.set(accountId, { at: Date.now(), now })
  return now
}

/** The live Overhead % in use for these Settings (null: off, or not available: the typed one). */
export async function liveOverheadPctFor(accountId: string, config: unknown): Promise<number | null> {
  const pricing = (config as Json)?.pricing
  if (!pricing?.liveOverhead?.on) return null
  const m = await pricingModule() as Json
  return m.liveOverheadPctIn(pricing, await overheadNowFor(accountId)) as number | null
}

/** The Overhead % a quote priced now is priced at: live when on and available, else the typed one (web targetMargin.ts typedOverheadPct). */
export async function overheadInUseFor(accountId: string): Promise<number> {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const live = await liveOverheadPctFor(accountId, b?.config ?? null)
  if (live != null) return live
  const typed = (b?.config as Json)?.pricing?.overheadPct
  return typeof typed === 'number' && Number.isFinite(typed) ? typed : DEFAULT_OVERHEAD_PCT
}

/** web targetMargin.ts DEFAULT_OVERHEAD_PCT. */
const DEFAULT_OVERHEAD_PCT = 30

/**
 * Settings with the live Overhead % in use put on them (pricing.liveOverheadPct;
 * null: the typed one), for the server's own pricing. Not for saving.
 */
export async function withLiveOverhead<C>(accountId: string, config: C): Promise<C> {
  const c = config as Json
  if (!c || typeof c !== 'object' || !c.pricing?.liveOverhead?.on) return config
  return { ...c, pricing: { ...c.pricing, liveOverheadPct: await liveOverheadPctFor(accountId, c) } }
}

/** Settings or the budget were saved (or a test changed the jobs): work it out again on the next ask. */
export function forgetOverheadNow(accountId?: string) {
  if (accountId) cache.delete(accountId)
  else cache.clear()
}
