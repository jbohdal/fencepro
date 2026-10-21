/**
 * Before Oct 20, 2026 the Delete button only set archivedAt (on the customer
 * alone: their cards, quotes and jobs stayed on the boards). Archive now means
 * the everyday, reversible "off the boards, still in search and reports", so
 * a row the Delete button made must become a real delete, or it would come
 * back into search and the KPIs.
 *
 * Only rows with evidence move, never a guess:
 *   - a customer, quote or job archived with a "soft_delete" audit row (the
 *     Delete button wrote one each time);
 *   - a customer still waiting in a scheduled deletion (the Oct 17 duplicates
 *     merged away), which deletes it for good on its date anyway.
 * Every other archived row (imports and cleanups, no audit) stays archived.
 *
 * Each one moved is deleted the new way, as of the moment it was archived:
 * deletedAt = the old archivedAt, archivedAt cleared, its cards, quotes, jobs
 * and the rest with it (lib/deletion.ts), one Deleted Records row each, so it
 * can be restored. Jobs and quotes first, then customers.
 *
 * Not a start-up step: it runs from scripts/map-archived-to-deleted.ts once
 * Jonathan has said yes. Recorded under ARCHIVED_TO_DELETED_KEY so it runs
 * once per company.
 */

import prisma from './prisma.js'
import { deleteRecordTx } from './deletion.js'
import { lockAccountState } from './lockState.js'

export const ARCHIVED_TO_DELETED_KEY = 'migration:archived-to-deleted-2026-10'

type MovedType = 'customer' | 'quote' | 'job'
export interface MoveCandidate { type: MovedType; id: string; accountId: string; archivedAt: Date; why: 'delete button' | 'scheduled deletion'; byUserId: string | null }

const MODEL = { customer: 'crmContact', quote: 'savedQuote', job: 'savedJob' } as const
const ENTITY = { customer: 'CrmContact', quote: 'SavedQuote', job: 'SavedJob' } as const

/** What would move, read only. */
export async function archivedToDeletedPlan(db: any = prisma): Promise<{ move: MoveCandidate[]; stay: Array<{ type: MovedType; id: string; archivedAt: Date }> }> {
  const move: MoveCandidate[] = []
  const stay: Array<{ type: MovedType; id: string; archivedAt: Date }> = []
  const scheduled = new Set<string>()
  for (const d of await db.scheduledDeletion.findMany({ where: { status: 'scheduled', model: 'CrmContact' }, select: { recordIds: true } })) {
    for (const id of Array.isArray(d.recordIds) ? d.recordIds : []) if (typeof id === 'string') scheduled.add(id)
  }
  for (const type of ['job', 'quote', 'customer'] as const) {
    const rows = await db[MODEL[type]].findMany({ where: { archivedAt: { not: null }, deletedAt: null }, select: { id: true, accountId: true, archivedAt: true }, orderBy: { archivedAt: 'asc' } })
    for (const r of rows) {
      const audit = await db.crmAuditLog.findFirst({ where: { entityType: ENTITY[type], entityId: r.id, action: 'soft_delete' }, orderBy: { createdAt: 'desc' }, select: { userId: true } })
      const why = audit ? 'delete button' : type === 'customer' && scheduled.has(r.id) ? 'scheduled deletion' : null
      if (why && r.accountId) move.push({ type, id: r.id, accountId: r.accountId, archivedAt: r.archivedAt, why, byUserId: audit?.userId ?? null })
      else stay.push({ type, id: r.id, archivedAt: r.archivedAt })
    }
  }
  return { move, stay }
}

/** Move them, one company at a time, each in one transaction; a company already done is skipped. */
export async function applyArchivedToDeleted(): Promise<Array<{ accountId: string; moved: number; logIds: string[] } | { accountId: string; skipped: 'already done' }>> {
  const { move } = await archivedToDeletedPlan()
  const out: Array<{ accountId: string; moved: number; logIds: string[] } | { accountId: string; skipped: 'already done' }> = []
  for (const accountId of [...new Set(move.map(m => m.accountId))]) {
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ARCHIVED_TO_DELETED_KEY + ':' + accountId}))`
      await lockAccountState(tx, accountId)
      if (await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: ARCHIVED_TO_DELETED_KEY } } })) return null
      const logIds: string[] = []
      for (const m of move.filter(x => x.accountId === accountId)) {
        // Taken by an earlier one in this run (a quote of a customer moved before it).
        const row = await tx[MODEL[m.type]].findFirst({ where: { id: m.id, deletedAt: null, archivedAt: { not: null } }, select: { id: true } })
        if (!row) continue
        await tx[MODEL[m.type]].update({ where: { id: m.id }, data: { archivedAt: null } })
        const r = await deleteRecordTx(tx, { accountId, userId: m.byUserId }, m.type, m.id, {
          at: m.archivedAt,
          reason: m.why === 'delete button' ? 'Deleted with the old Delete button (before Deleted Records); moved Oct 2026' : 'Duplicate merged away Oct 17, waiting for its scheduled deletion; moved Oct 2026',
        })
        logIds.push(r.logId)
      }
      await tx.accountKeyValue.create({ data: { accountId, key: ARCHIVED_TO_DELETED_KEY, value: { at: new Date().toISOString(), moved: logIds.length, logIds } } })
      return logIds
    }, { timeout: 120_000 })
    out.push(result ? { accountId, moved: result.length, logIds: result } : { accountId, skipped: 'already done' })
  }
  return out
}
