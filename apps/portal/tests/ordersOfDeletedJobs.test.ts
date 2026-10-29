/**
 * Sales Orders of a deleted job (lib/ordersOfDeletedJobs.ts; review Oct 28
 * 2026: the Sales Order list held Pending orders whose jobs were gone): which
 * ones the backfill cancels, and what a cancelled one says. The delete and
 * restore themselves: deleteArchive.db.test.ts.
 */
import { describe, test, expect } from 'vitest'
import { ordersOfDeletedJobs, cancelOrderForDeletion, cancelledOrderNote, sameJson, ORPHAN_WHY, type JobFact } from '../src/server/lib/ordersOfDeletedJobs.js'

const order = (id: string, status: string, extra: Record<string, unknown> = {}) => ({ id, quoteId: `q-${id}`, status, notes: '', ...extra })
const jobs = (list: Array<JobFact & { quoteId?: string }>) => {
  const byId = new Map(list.map(j => [j.id, j]))
  const byQuote = new Map<string, JobFact[]>()
  for (const j of list) if (j.quoteId) byQuote.set(j.quoteId, [...(byQuote.get(j.quoteId) ?? []), j])
  return [byId, byQuote] as const
}

describe('the Sales Orders whose job is deleted or gone', () => {
  test('by the order\'s job: deleted, gone or live', () => {
    const [byId, byQuote] = jobs([{ id: 'live', deletedAt: null }, { id: 'del', deletedAt: '2026-10-27T10:00:00.000Z' }])
    const found = ordersOfDeletedJobs([
      order('a', 'pending', { jobId: 'live' }),
      order('b', 'pending', { jobId: 'del' }),
      order('c', 'ordered', { jobId: 'del' }),
      order('d', 'pending', { jobId: 'missing' }),
    ], byId, byQuote)
    expect(found).toEqual([
      { id: 'b', kind: 'job_deleted', jobId: 'del' },
      { id: 'c', kind: 'job_deleted', jobId: 'del' },
      { id: 'd', kind: 'job_gone', jobId: 'missing' },
    ])
  })

  test('Received and Cancelled are never touched', () => {
    const [byId, byQuote] = jobs([{ id: 'del', deletedAt: new Date() }])
    expect(ordersOfDeletedJobs([order('r', 'received', { jobId: 'del' }), order('x', 'cancelled', { jobId: 'del' }), order('g', 'received', { jobId: 'gone' })], byId, byQuote)).toEqual([])
  })

  test('an older order with no job named goes with its quote\'s jobs', () => {
    const [byId, byQuote] = jobs([
      { id: 'j1', quoteId: 'q-live', deletedAt: null },
      { id: 'j2', quoteId: 'q-del', deletedAt: '2026-10-20T10:00:00.000Z' },
      { id: 'j3', quoteId: 'q-del', deletedAt: '2026-10-25T10:00:00.000Z' },
      { id: 'j4', quoteId: 'q-mixed', deletedAt: '2026-10-25T10:00:00.000Z' },
      { id: 'j5', quoteId: 'q-mixed', deletedAt: null },
    ])
    expect(ordersOfDeletedJobs([
      order('a', 'pending', { quoteId: 'q-live' }),
      order('b', 'pending', { quoteId: 'q-del' }),
      order('c', 'pending', { quoteId: 'q-mixed' }),
      order('d', 'pending', { quoteId: 'q-none' }),
    ], byId, byQuote)).toEqual([
      { id: 'b', kind: 'job_deleted', jobId: 'j3' },
      { id: 'd', kind: 'job_gone', jobId: null },
    ])
    expect(ordersOfDeletedJobs(undefined, byId, byQuote)).toEqual([])
  })
})

describe('a cancelled order says why', () => {
  const at = new Date('2026-10-29T01:30:00.000Z') // Oct 28 in Florida
  test('the note, under any it had; restorable or not', () => {
    expect(cancelledOrderNote(ORPHAN_WHY.job_deleted, at)).toBe('Cancelled Oct 28, 2026: its job was deleted. Restoring it (Settings > Deleted Records) brings this order back as it was.')
    expect(cancelledOrderNote(ORPHAN_WHY.job_gone, at, false)).toBe('Cancelled Oct 28, 2026: its job no longer exists.')
    const o = cancelOrderForDeletion(order('a', 'ordered', { notes: 'Stephens PO 4471', totalCostCents: 41200 }), ORPHAN_WHY.job_deleted, at)
    expect(o).toMatchObject({ id: 'a', status: 'cancelled', cancelledAt: at.toISOString(), updatedAt: at.toISOString(), totalCostCents: 41200 })
    expect(o.notes.split('\n')).toEqual(['Stephens PO 4471', cancelledOrderNote(ORPHAN_WHY.job_deleted, at)])
  })
  test('the same JSON with its keys in another order is the same', () => {
    expect(sameJson({ a: 1, b: { c: [1, { d: 2, e: 3 }] } }, { b: { c: [1, { e: 3, d: 2 }] }, a: 1 })).toBe(true)
    expect(sameJson({ a: 1 }, { a: 2 })).toBe(false)
  })
})
