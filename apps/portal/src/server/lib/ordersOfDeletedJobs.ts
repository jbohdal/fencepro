/**
 * Sales Orders (BusinessState.pendingOrders) of a deleted job. Review Oct 28
 * 2026: the Sales Order list held Pending orders whose jobs were gone. Since
 * then deleting a job (or its quote or customer) marks its Sales Order
 * Cancelled when it is still Pending or Ordered, with a note saying why, and
 * a restore puts it back as it was (lib/deletion.ts). A Received one is left
 * as it is: it is the record of what came in and the stock counts it changed.
 *
 * ordersOfDeletedJobs finds the orders left from before (the backfill,
 * scripts/sales-orders-of-deleted-jobs-2026-10-28.ts). Pure (no database).
 */

/** The Sales Order statuses a deletion cancels: not bought in yet. Received (and Cancelled) are left as they are. */
export const ORDER_TO_CANCEL = new Set(['pending', 'ordered'])

const floridaDate = (at: Date) => at.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })

/**
 * The note a Sales Order cancelled by a deletion gets ("Cancelled Oct 28,
 * 2026: its job was deleted. ..."). `restorable`: the deletion is in Deleted
 * Records, and restoring it brings the order back (not so for a job that no
 * longer exists at all).
 */
export function cancelledOrderNote(why: string, at: Date, restorable = true): string {
  return `Cancelled ${floridaDate(at)}: ${why}.${restorable ? ' Restoring it (Settings > Deleted Records) brings this order back as it was.' : ''}`
}

/** A Sales Order marked Cancelled by a deletion at `at`, its note added under any it had. */
export function cancelOrderForDeletion(order: any, why: string, at: Date, restorable = true): any {
  const iso = at.toISOString()
  const note = cancelledOrderNote(why, at, restorable)
  const notes = typeof order?.notes === 'string' && order.notes.trim() ? `${order.notes}\n${note}` : note
  return { ...order, status: 'cancelled', cancelledAt: iso, updatedAt: iso, notes }
}

/** The same JSON, keys in any order (Postgres keeps a JSON document's keys in its own order). */
export function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: any): any => (Array.isArray(v) ? v.map(norm) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, norm(v[k])])) : v)
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b))
}

/** A job as the backfill needs it. */
export interface JobFact { id: string; deletedAt: Date | string | null }

/** Why an order is to be cancelled: its job is in Deleted Records, or no longer exists at all. */
export type OrphanKind = 'job_deleted' | 'job_gone'

export interface OrphanOrder { id: string; kind: OrphanKind; jobId: string | null }

/**
 * The Pending or Ordered Sales Orders whose job is deleted or gone. The job is
 * the order's jobId; an older order with none goes with its quote's jobs (a
 * Sales Order is only made for a quote with a job, lib/salesOrders.ts): kept
 * while one of them is live, its job deleted when all are deleted (the last
 * deleted named), gone when there are none.
 */
export function ordersOfDeletedJobs(orders: unknown, jobsById: Map<string, JobFact>, jobsByQuote: Map<string, JobFact[]>): OrphanOrder[] {
  const out: OrphanOrder[] = []
  for (const o of Array.isArray(orders) ? orders : []) {
    if (!o?.id || !ORDER_TO_CANCEL.has(o.status)) continue
    if (o.jobId) {
      const j = jobsById.get(String(o.jobId))
      if (!j) out.push({ id: String(o.id), kind: 'job_gone', jobId: String(o.jobId) })
      else if (j.deletedAt) out.push({ id: String(o.id), kind: 'job_deleted', jobId: j.id })
      continue
    }
    const jobs = o.quoteId ? jobsByQuote.get(String(o.quoteId)) ?? [] : []
    if (!jobs.length) { out.push({ id: String(o.id), kind: 'job_gone', jobId: null }); continue }
    if (jobs.some(j => !j.deletedAt)) continue
    const last = [...jobs].sort((a, b) => new Date(b.deletedAt!).getTime() - new Date(a.deletedAt!).getTime())[0]
    out.push({ id: String(o.id), kind: 'job_deleted', jobId: last.id })
  }
  return out
}

/** The words of the note: why it was cancelled. */
export const ORPHAN_WHY: Record<OrphanKind, string> = { job_deleted: 'its job was deleted', job_gone: 'its job no longer exists' }
