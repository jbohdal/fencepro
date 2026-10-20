/**
 * "Was ever sold" is permanent (Jonathan, Oct 20, 2026): a quote that was
 * Sold, accepted on a customer's link, had its quoted cost saved at signing,
 * or has a job made from it stays locked (lib/quoteLock.ts) even if it is
 * later marked Lost. SavedQuote.soldAt holds the first moment that happened;
 * it is set once and never cleared.
 *
 *   markEverSold     after any write that can make a quote Sold or accepted
 *                    (going forward that is the rule: first Sold or accepted;
 *                    a job made from a quote that was never Sold does not lock it)
 *   backfillEverSold the one-time step for quotes sold before soldAt existed:
 *                    Sold now, acceptedAt set, a JobQuotedCost, or a SavedJob
 *                    linked by quoteId. Recorded under a fixed key per company
 *                    (AccountKeyValue 'migration:ever-sold-2026-10'), run once,
 *                    in one transaction holding the company's lock, in turn
 *                    with the other start-up steps.
 */

import prisma from './prisma.js'
import { lockAccountState } from './lockState.js'

export const EVER_SOLD_KEY = 'migration:ever-sold-2026-10'

/** Stamp soldAt on this quote if it is Sold or accepted and has none yet. */
export async function markEverSold(accountId: string, quoteId: string, tx: any = prisma): Promise<void> {
  await tx.savedQuote.updateMany({
    where: { id: quoteId, accountId, soldAt: null, OR: [{ status: 'SOLD' }, { acceptedAt: { not: null } }] },
    data: { soldAt: new Date() },
  })
}

/** The same for a quote whose quoted cost was just saved at signing, whatever its status now. */
export async function markSignedNow(accountId: string, quoteId: string | null | undefined, tx: any = prisma): Promise<void> {
  if (!quoteId) return
  await tx.savedQuote.updateMany({ where: { id: quoteId, accountId, soldAt: null }, data: { soldAt: new Date() } })
}

export interface EverSoldCounts { sold: number; accepted: number; quotedCost: number; job: number; total: number; alreadySet: number }

/**
 * The quotes of one company that were ever sold and have no soldAt yet, by
 * reason (a quote can have several). Read only: used by the step and by a dry
 * run against a database that must not be written.
 */
export async function everSoldCandidates(accountId: string, tx: any = prisma): Promise<{ ids: Map<string, Date>; counts: EverSoldCounts }> {
  const [quotes, costs, jobs, alreadySet] = await Promise.all([
    tx.savedQuote.findMany({ where: { accountId, soldAt: null }, select: { id: true, status: true, acceptedAt: true, updatedAt: true, createdAt: true } }),
    tx.jobQuotedCost.findMany({ where: { accountId }, select: { quoteId: true, signedAt: true } }),
    tx.savedJob.findMany({ where: { accountId, quoteId: { not: null } }, select: { quoteId: true, createdAt: true } }),
    tx.savedQuote.count({ where: { accountId, soldAt: { not: null } } }),
  ])
  const cost = new Map<string, Date>(costs.map((c: any) => [c.quoteId, c.signedAt]))
  const job = new Map<string, Date>()
  for (const j of jobs) { const was = job.get(j.quoteId); if (!was || j.createdAt < was) job.set(j.quoteId, j.createdAt) }
  const counts: EverSoldCounts = { sold: 0, accepted: 0, quotedCost: 0, job: 0, total: 0, alreadySet }
  const ids = new Map<string, Date>()
  for (const q of quotes) {
    const reasons: Date[] = []
    if (q.status === 'SOLD') { counts.sold++; reasons.push(q.updatedAt) }
    if (q.acceptedAt) { counts.accepted++; reasons.push(q.acceptedAt) }
    if (cost.has(q.id)) { counts.quotedCost++; reasons.push(cost.get(q.id)!) }
    if (job.has(q.id)) { counts.job++; reasons.push(job.get(q.id)!) }
    if (!reasons.length) continue
    // The earliest moment we know of (never before the quote existed).
    const at = new Date(Math.max(q.createdAt.getTime(), Math.min(...reasons.map(d => d.getTime()))))
    ids.set(q.id, at)
  }
  counts.total = ids.size
  return { ids, counts }
}

/** The one-time step for one company. Returns the counts, or null when it already ran. */
export async function backfillEverSold(accountId: string): Promise<EverSoldCounts | null> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'ever-sold:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: EVER_SOLD_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const { ids, counts } = await everSoldCandidates(accountId, tx)
    for (const [id, at] of ids) await tx.savedQuote.updateMany({ where: { id, accountId, soldAt: null }, data: { soldAt: at } })
    await tx.accountKeyValue.create({ data: { accountId, key: EVER_SOLD_KEY, value: { at: new Date().toISOString(), ...counts } as any } })
    return counts
  }, { timeout: 60_000 })
}

/** At server start: every company with quotes. */
export async function backfillEverSoldAll(): Promise<void> {
  const rows = await prisma.savedQuote.groupBy({ by: ['accountId'] })
  for (const r of rows) {
    try {
      const out = await backfillEverSold(r.accountId)
      if (out) console.log(`[ever sold] ${out.total} quotes marked as sold once for ${r.accountId} (Sold ${out.sold}, accepted ${out.accepted}, quoted cost ${out.quotedCost}, job ${out.job})`)
    } catch (err) { console.error('[ever sold] could not mark the quotes sold before:', err) }
  }
}
