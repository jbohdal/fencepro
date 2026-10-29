/**
 * The per post repair rates Jonathan typed on Oct 29 2026 (#31):
 *
 *   "Pulling old posts: $10 per post. Hauling away: $10 per post. Concrete
 *   footer disposal: $15 per post."
 *
 * Settings > Moves and Repairs (config.moveRepair, web moveRepair.ts):
 *
 *   pulling old posts      pullNdLaborCents, pullDsLaborCents        1000
 *   hauling away           pullNdDisposalCents, pullDsDisposalCents  1000
 *   concrete footer        footerDisposalCents (the repair item      1500
 *   disposal               "Concrete footer disposal (per post)")
 *
 * Before, live had pull $2.50 / $12.00 and disposal $7.50 / $24.00 (no dig /
 * dig set) and no footer rate; the dev copy had them blank ($0 with a warning).
 *
 * Once per company, ever, at server start (AccountKeyValue
 * 'migration:repair-post-rates-2026-10-29'), so it reaches live only when the
 * code is deployed there (update.sh restarts the server), and a rate changed
 * by hand in Settings afterwards is never put back. Effective dated (rule 7):
 * an entry in moveRepair.rateHistory with the day it ran (Ocala), the rates
 * and the ones they replaced; the step's key keeps the same, and the audit log
 * gets a line. Saved quotes keep their priced cost lines (SavedWork.priced),
 * so none changes; a quote re-priced after this (edited and saved again)
 * uses the new rates, as with any Settings rate.
 */

import prisma from './prisma.js'
import { lockAccountState } from './lockState.js'
import { auditSystem } from './auditLog.js'
import { nyDay } from './warranties.js'

export const REPAIR_POST_RATES_KEY = 'migration:repair-post-rates-2026-10-29'

export const REPAIR_POST_RATES = {
  pullNdLaborCents: 1000,
  pullDsLaborCents: 1000,
  pullNdDisposalCents: 1000,
  pullDsDisposalCents: 1000,
  footerDisposalCents: 1500,
} as const

type Rates = Record<keyof typeof REPAIR_POST_RATES, number | null>
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Settings' moveRepair with the new rates and their history entry. Pure. */
export function withRepairPostRates(moveRepair: unknown, day: string): { moveRepair: Record<string, unknown>; previous: Rates } {
  const mr = isObj(moveRepair) ? moveRepair : {}
  const previous = Object.fromEntries(Object.keys(REPAIR_POST_RATES).map(k => [k, typeof mr[k] === 'number' ? mr[k] : null])) as Rates
  const history = Array.isArray(mr.rateHistory) ? mr.rateHistory : []
  return {
    previous,
    moveRepair: {
      ...mr,
      ...REPAIR_POST_RATES,
      rateHistory: [...history, { effectiveFrom: day, rates: { ...REPAIR_POST_RATES }, previous, by: 'Jonathan', note: 'typed Oct 29 2026: pull $10, haul away $10, concrete footer $15 per post' }],
    },
  }
}

/** Once per company: the new rates into Settings. null when already done (or no Settings). */
export async function ensureRepairPostRates(accountId: string, now = new Date()): Promise<{ previous: Rates } | null> {
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
    await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, moveRepair: next.moveRepair } as any, version: { increment: 1 } } })
    await tx.accountKeyValue.create({ data: { accountId, key: REPAIR_POST_RATES_KEY, value: { at: now.toISOString(), effectiveFrom: day, previous: next.previous, rates: REPAIR_POST_RATES } as any } })
    return { previous: next.previous }
  }, { timeout: 20_000 })
  if (out) {
    await auditSystem('update', 'BusinessState', accountId, {
      oldValues: { moveRepair: out.previous },
      newValues: { moveRepair: REPAIR_POST_RATES, why: 'Repair per post rates typed by Jonathan, Oct 29 2026 (#31)', by: 'start-up step' },
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
      if (out) console.log(`[repair rates] ${r.accountId}: pull $10, haul away $10, concrete footer $15 per post (were ${JSON.stringify(out.previous)})`)
    } catch (err) { console.error('[repair rates] could not set the per post repair rates:', err) }
  }
}
