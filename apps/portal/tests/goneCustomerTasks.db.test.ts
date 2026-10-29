/**
 * Today leaves off the open tasks of a customer who is deleted or archived
 * (review Oct 28 2026: two follow ups for "jj jj", a deleted customer, on the
 * Salesman's Today). lib/taskScope.ts taskSubjectGone, and taskLinkFacts on
 * the dev database (DEV_DB=1, ezbiz_dev only) in a throwaway company.
 */

import 'dotenv/config'
import crypto from 'crypto'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { taskSubjectGone, type TaskLinkFacts } from '../src/server/lib/taskScope'

describe('a task\'s customer is gone', () => {
  const f: TaskLinkFacts = {
    jobs: new Map([['j-live', { deleted: false, contactId: 'c-live' }], ['j-del', { deleted: true, contactId: 'c-live' }], ['j-arch-cust', { deleted: false, contactId: 'c-arch' }]]),
    cards: new Map([['k-live', 'c-live'], ['k-gone', 'c-del'], ['k-none', null]]),
    goneContacts: new Set(['c-del', 'c-arch']),
    removed: new Set(['accepted-q1']),
  }
  test('a deleted job, or a job or card whose customer is deleted or archived: gone', () => {
    expect(taskSubjectGone('j-del', f)).toBe(true)
    expect(taskSubjectGone('j-arch-cust', f)).toBe(true)
    expect(taskSubjectGone('k-gone', f)).toBe(true)
    expect(taskSubjectGone('accepted-q1', f)).toBe(true)
  })
  test('a live one, one naming nothing, or one not found: kept', () => {
    expect(taskSubjectGone('j-live', f)).toBe(false)
    expect(taskSubjectGone('k-live', f)).toBe(false)
    expect(taskSubjectGone('k-none', f)).toBe(false)
    expect(taskSubjectGone(null, f)).toBe(false)
    expect(taskSubjectGone('unknown', f)).toBe(false)
  })
})

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('the facts, read from the records (dev database)', () => {
  let prisma: any
  let accountId = ''
  const tag = `gonetask-${crypto.randomUUID().slice(0, 8)}`
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const c = (first: string, f: Record<string, unknown> = {}) => prisma.crmContact.create({ data: { accountId, firstName: first, lastName: tag, ...f } }).then((r: any) => r.id)
    ids.live = await c('Live')
    ids.archived = await c('Arch', { archivedAt: new Date() })
    ids.deleted = await c('Del', { deletedAt: new Date() })
    ids.jobLive = (await prisma.savedJob.create({ data: { accountId, crmContactId: ids.live, customerName: 'Live' } })).id
    ids.jobOfArchived = (await prisma.savedJob.create({ data: { accountId, crmContactId: ids.archived, customerName: 'Arch' } })).id
    await prisma.pipelineState.create({ data: { accountId, stages: [], leads: [{ id: `${tag}-k1`, customerId: ids.deleted }, { id: `${tag}-k2`, customerId: ids.live }], archivedLeads: [] } as any })
    await prisma.deletionLog.create({ data: { accountId, entityType: 'customer', entityId: ids.deleted, entityLabel: 'jj jj', snapshot: {}, ids: [ids.deleted, `accepted-${tag}`] } })
  })
  afterAll(async () => {
    if (!accountId) return
    for (const m of ['deletionLog', 'pipelineState', 'savedJob', 'crmContact']) await prisma[m].deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('jobs, cards and a card a deletion took: which are gone', async () => {
    const { taskLinkFacts } = await import('../src/server/lib/taskScope.js')
    const want = [ids.jobLive, ids.jobOfArchived, `${tag}-k1`, `${tag}-k2`, `accepted-${tag}`, 'not-there']
    const f = await taskLinkFacts(prisma, accountId, want)
    expect(want.map(id => [id, taskSubjectGone(id, f)])).toEqual([
      [ids.jobLive, false], [ids.jobOfArchived, true], [`${tag}-k1`, true], [`${tag}-k2`, false], [`accepted-${tag}`, true], ['not-there', false],
    ])
  })
})
