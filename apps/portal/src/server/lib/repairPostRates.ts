/**
 * The per post repair rates Jonathan set on Oct 29 2026 (#31). First answer:
 *
 *   "Pulling old posts: $10 per post. Hauling away: $10 per post. Concrete
 *   footer disposal: $15 per post."
 *
 * Corrected the same day:
 *
 *   "#31: $10 applies to no dig posts only. Dig set posts keep $12 to pull
 *   and $24 to haul, since they come out with concrete."
 *
 * Settings > Moves and Repairs (config.moveRepair, web moveRepair.ts):
 *
 *   pulling old posts, no dig     pullNdLaborCents                    1000
 *   hauling away, no dig          pullNdDisposalCents                 1000
 *   concrete footer disposal      footerDisposalCents (the repair     1500
 *                                 item "Concrete footer disposal
 *                                 (per post)")
 *
 * The dig set pull and disposal (pullDsLaborCents, pullDsDisposalCents) are
 * never touched: whatever is saved stays (live: $12.00 / $24.00; blank stays
 * blank). Before, live had no dig pull $2.50 and disposal $7.50 and no footer
 * rate; the dev copy had them blank ($0 with a warning).
 *
 * Once per company, ever, at server start (AccountKeyValue
 * 'migration:repair-post-rates-2026-10-29b'; the first version of this step,
 * key '...-2026-10-29', also set dig set to $10 and never reached live), so it
 * reaches live only when the code is deployed there (update.sh restarts the
 * server), and a rate changed by hand in Settings afterwards is never put
 * back. Effective dated (rule 7): an entry in moveRepair.rateHistory with the
 * day it ran (Ocala), the rates that changed and the ones they replaced, and
 * an audit line; a rate already at its new value is left out of both, and
 * when none changes there is no entry and no line. Saved quotes keep their
 * priced cost lines (SavedWork.priced), so none changes; a quote re-priced
 * after this (edited and saved again) uses the new rates, as with any
 * Settings rate.
 */

import prisma from './prisma.js'
import { lockAccountState } from './lockState.js'
import { auditSystem } from './auditLog.js'
import { nyDay } from './warranties.js'

export const REPAIR_POST_RATES_KEY = 'migration:repair-post-rates-2026-10-29b'

/** The rates this step sets. Dig set pull and disposal are not among them. */
export const REPAIR_POST_RATES = {
  pullNdLaborCents: 1000,
  pullNdDisposalCents: 1000,
  footerDisposalCents: 1500,
} as const

type RateKey = keyof typeof REPAIR_POST_RATES
type Rates = Partial<Record<RateKey, number | null>>
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const NOTE = 'typed Oct 29 2026: no dig pull $10, no dig haul away $10, concrete footer $15 per post; dig set unchanged'

/**
 * Settings' moveRepair with the new rates and, when any changed, their
 * history entry. `rates` and `previous` hold only the rates that changed. Pure.
 */
export function withRepairPostRates(moveRepair: unknown, day: string): { moveRepair: Record<string, unknown>; rates: Rates; previous: Rates } {
  const mr = isObj(moveRepair) ? moveRepair : {}
  const rates: Rates = {}
  const previous: Rates = {}
  for (const k of Object.keys(REPAIR_POST_RATES) as RateKey[]) {
    const was = typeof mr[k] === 'number' ? mr[k] : null
    if (was === REPAIR_POST_RATES[k]) continue
    rates[k] = REPAIR_POST_RATES[k]
    previous[k] = was
  }
  if (!Object.keys(rates).length) return { moveRepair: mr, rates, previous }
  const history = Array.isArray(mr.rateHistory) ? mr.rateHistory : []
  return {
    rates,
    previous,
    moveRepair: {
      ...mr,
      ...rates,
      rateHistory: [...history, { effectiveFrom: day, rates: { ...rates }, previous: { ...previous }, by: 'Jonathan', note: NOTE }],
    },
  }
}

/**
 * Once per company: the new rates into Settings. null when already done (or
 * no Settings); otherwise the rates that changed and what they replaced
 * (both empty when every rate was already set).
 */
export async function ensureRepairPostRates(accountId: string, now = new Date()): Promise<{ rates: Rates; previous: Rates } | null> {
  const out = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'repair-post-rates:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: REPAIR_POST_RATES_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    if (!b) return null
    const cfg = (isObj(b.config) ? b.config : {}) as Record<string, unknown>
    const day = nyDay(now)
    const next = withRepairPostRates(cfg.moveRepair, day)
    if (Object.keys(next.rates).length) {
      await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, moveRepair: next.moveRepair } as any, version: { increment: 1 } } })
    }
    await tx.accountKeyValue.create({ data: { accountId, key: REPAIR_POST_RATES_KEY, value: { at: now.toISOString(), effectiveFrom: day, previous: next.previous, rates: next.rates } as any } })
    return { rates: next.rates, previous: next.previous }
  }, { timeout: 20_000 })
  if (out && Object.keys(out.rates).length) {
    await auditSystem('update', 'BusinessState', accountId, {
      oldValues: { moveRepair: out.previous },
      newValues: { moveRepair: out.rates, why: 'Repair per post rates typed by Jonathan, Oct 29 2026 (#31): no dig $10 pull and $10 haul away, concrete footer $15; dig set unchanged', by: 'start-up step' },
    })
  }
  return out
}

/** At server start: every company with saved settings. */
export async function ensureRepairPostRatesAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureRepairPostRates(r.accountId)
      if (out && Object.keys(out.rates).length) console.log(`[repair rates] ${r.accountId}: set ${JSON.stringify(out.rates)} (were ${JSON.stringify(out.previous)}); dig set pull and disposal unchanged`)
    } catch (err) { console.error('[repair rates] could not set the per post repair rates:', err) }
  }
}
