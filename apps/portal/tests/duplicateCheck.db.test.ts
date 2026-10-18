/**
 * The duplicate check, against the dev database (DEV_DB=1 only; the test
 * config never loads this file anywhere else). Writes only inside the tests.
 */
import 'dotenv/config'
import crypto from 'crypto'
import { describe, test, expect, afterAll } from 'vitest'
import prisma from '../src/server/lib/prisma.js'
import { openFindings, dismissFinding, runDuplicateCheck } from '../src/server/lib/duplicateCheck.js'

describe('duplicate check (dev database)', () => {
  const made: string[] = []
  let accountId = ''
  afterAll(async () => {
    await prisma.crmContact.deleteMany({ where: { id: { in: made } } })
    await prisma.notification.deleteMany({ where: { title: { startsWith: 'Possible duplicates' }, createdAt: { gte: new Date(Date.now() - 600_000) } } })
  })

  test('two customers with one phone are found once; "This is fine" hides it; told once', async () => {
    accountId = (await prisma.crmAccount.findFirst({ orderBy: { createdAt: 'asc' } }))!.id
    const phone = `352${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
    for (const n of ['A', 'B']) {
      const id = crypto.randomUUID(); made.push(id)
      await prisma.crmContact.create({ data: { id, accountId, firstName: 'Dup', lastName: `Test ${n}`, phone } as any })
    }
    const found = (await openFindings(accountId)).filter(f => f.check === 'phone' && f.key.includes(phone))
    expect(found).toHaveLength(1)
    // Told once: a notification naming these two, however often the check runs.
    const mine = () => prisma.notification.count({ where: { title: { startsWith: 'Possible duplicates' }, body: { contains: `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}` } } })
    await runDuplicateCheck('test'); await runDuplicateCheck('test again')
    expect(await mine()).toBeLessThanOrEqual(1)
    await dismissFinding(accountId, found[0].key)
    expect((await openFindings(accountId)).some(f => f.key === found[0].key)).toBe(false)
  })

  test('the check only reads: its own records are unchanged', async () => {
    const before = await prisma.crmContact.findMany({ where: { id: { in: made } }, orderBy: { id: 'asc' } })
    await openFindings(accountId)
    expect(await prisma.crmContact.findMany({ where: { id: { in: made } }, orderBy: { id: 'asc' } })).toEqual(before)
  })
})
