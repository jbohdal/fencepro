/**
 * A Possible match is offered only while both customers are on file (review
 * Oct 28 2026: an open match stayed on a customer after the customer was
 * archived). lib/customerMerge.ts matchView, on the dev database (DEV_DB=1,
 * ezbiz_dev only), in a throwaway company. The match row is never changed, so
 * Unarchive offers it again.
 */

import 'dotenv/config'
import crypto from 'crypto'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('possible matches of archived or deleted customers (dev database)', () => {
  let prisma: any
  let matchView: (accountId: string, contactId: string) => Promise<{ matches: Array<{ customer: { id: string } }> }>
  let accountId = ''
  const tag = `pmarch-${crypto.randomUUID().slice(0, 8)}`
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    matchView = (await import('../src/server/lib/customerMerge.js')).matchView
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    ids.newOne = (await prisma.crmContact.create({ data: { accountId, firstName: 'Nina', lastName: tag, phone: '3525550190' } })).id
    ids.onFile = (await prisma.crmContact.create({ data: { accountId, firstName: 'Nora', lastName: tag, phone: '3525550190' } })).id
    ids.match = (await prisma.customerPossibleMatch.create({ data: { accountId, contactId: ids.newOne, matchId: ids.onFile, reason: 'phone' } })).id
  })
  afterAll(async () => {
    if (!accountId) return
    await prisma.customerPossibleMatch.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  const shown = async () => (await matchView(accountId, ids.newOne)).matches.map(m => m.customer.id)
  const setOn = (id: string, data: Record<string, unknown>) => prisma.crmContact.update({ where: { id }, data })

  test('both on file: offered', async () => {
    expect(await shown()).toEqual([ids.onFile])
  })
  test('the customer archived: not offered; unarchived: offered again, the match row unchanged', async () => {
    await setOn(ids.newOne, { archivedAt: new Date() })
    expect(await shown()).toEqual([])
    await setOn(ids.newOne, { archivedAt: null })
    expect(await shown()).toEqual([ids.onFile])
    expect((await prisma.customerPossibleMatch.findUnique({ where: { id: ids.match } })).status).toBe('open')
  })
  test('the one on file archived or deleted: not offered', async () => {
    await setOn(ids.onFile, { archivedAt: new Date() })
    expect(await shown()).toEqual([])
    await setOn(ids.onFile, { archivedAt: null, deletedAt: new Date() })
    expect(await shown()).toEqual([])
    await setOn(ids.onFile, { deletedAt: null })
  })
})
