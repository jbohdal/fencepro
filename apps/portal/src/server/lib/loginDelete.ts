/**
 * Deleting a login, and what goes with it.
 *
 * One transaction removes the login's sessions, its activity rows, its push
 * subscriptions and its pending call or text (PendingTouch: "you called Smith, how did it go?"),
 * then the login itself. A follow up the login owned (CardFollowUp
 * ownerUserId) is let go, so it falls to the company owner and the next
 * person who logs a touch on the card takes it. The call history (CallLog)
 * is kept.
 *
 * PENDING_CALLS_CLEANUP_KEY: logins deleted before Oct 2026 left their pending
 * calls behind. ensureNoOrphanPendingCallsAll removes those once per company,
 * recorded under that key in AccountKeyValue.
 */

import prisma from './prisma.js'

export const PENDING_CALLS_CLEANUP_KEY = 'migration:orphan-pending-calls-2026-10'

/** Delete a login and its pending call, in one transaction. */
export async function deleteLogin(userId: string): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.crmUserSession.deleteMany({ where: { userId } })
    await tx.crmUserActivity.deleteMany({ where: { userId } })
    await tx.pendingTouch.deleteMany({ where: { userId } })
    // Its phones stop getting this company's notifications.
    await tx.pushSubscription.deleteMany({ where: { userId } })
    await tx.cardFollowUp.updateMany({ where: { ownerUserId: userId }, data: { ownerUserId: null } })
    await tx.crmUser.delete({ where: { id: userId } })
  }, { timeout: 15_000 })
}

/** Remove one company's pending calls whose login no longer exists, once. Returns how many (null when already done). */
export async function ensureNoOrphanPendingCalls(accountId: string): Promise<number | null> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'orphan-pending-calls:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: PENDING_CALLS_CLEANUP_KEY } } })
    if (done) return null
    const removed = await tx.$executeRaw`
      DELETE FROM "PendingTouch" p
      WHERE p."accountId" = ${accountId}
        AND NOT EXISTS (SELECT 1 FROM "CrmUser" u WHERE u.id = p."userId")`
    await tx.accountKeyValue.create({ data: { accountId, key: PENDING_CALLS_CLEANUP_KEY, value: { at: new Date().toISOString(), removed } } })
    return removed
  }, { timeout: 15_000 })
}

/** At server start: every company with saved settings. */
export async function ensureNoOrphanPendingCallsAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const removed = await ensureNoOrphanPendingCalls(r.accountId)
      if (removed !== null) console.log(`[follow ups] ${r.accountId}: ${removed} pending call${removed === 1 ? '' : 's'} of deleted logins removed`)
    } catch (err) { console.error('[follow ups] orphan pending call cleanup failed:', err) }
  }
}
