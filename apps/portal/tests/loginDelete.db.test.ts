/**
 * Deleting a login, and the two one-time clean ups, against the dev database
 * (DEV_DB=1 and ezbiz_dev only), on a company made for the test and removed after:
 *   - deleting a login removes its pending call; another login's stays; a
 *     follow up it owned is let go
 *   - the one-time step removes pending calls of logins that no longer exist, once
 *   - the old Staging sheet: removed when empty, kept when it has rows, once
 * Database writes happen only inside beforeAll / test / afterAll.
 */
import 'dotenv/config'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('deleting a login (dev database)', () => {
  let prisma: any
  let D: typeof import('../src/server/lib/loginDelete.js')
  let S: typeof import('../src/server/lib/stagingSheetCleanup.js')
  const tag = `ld-${Date.now().toString(36)}`
  let accountId = ''
  const u: Record<string, string> = {}

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    D = await import('../src/server/lib/loginDelete.js')
    S = await import('../src/server/lib/stagingSheetCleanup.js')
    const a = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = a.id
    for (const k of ['gone', 'stays']) {
      const x = await prisma.crmUser.create({ data: { email: `${tag}-${k}@example.test`, firstName: 'Test', lastName: `${k} ${tag}`, role: 'sales_rep', status: 'active', crmAccountId: accountId, mustChangePassword: false } })
      u[k] = x.id
    }
  })
  afterAll(async () => {
    if (!accountId) return
    await prisma.pendingTouch.deleteMany({ where: { accountId } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('deleting a login removes its pending call, not anyone else\'s', async () => {
    await prisma.pendingTouch.create({ data: { userId: u.gone, accountId, cardId: 'c1', name: 'Smith' } })
    await prisma.pendingTouch.create({ data: { userId: u.stays, accountId, cardId: 'c2', name: 'Jones' } })
    await prisma.cardFollowUp.create({ data: { accountId, cardId: 'c1', stage: 'Estimating', stageSince: '2026-10-01', ownerUserId: u.gone } })
    await D.deleteLogin(u.gone)
    expect(await prisma.crmUser.findUnique({ where: { id: u.gone } })).toBeNull()
    expect(await prisma.pendingTouch.findUnique({ where: { userId: u.gone } })).toBeNull()
    expect(await prisma.pendingTouch.findUnique({ where: { userId: u.stays } })).not.toBeNull()
    const fu = await prisma.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId: 'c1' } } })
    expect(fu.ownerUserId).toBeNull()
  })

  test('the one-time step removes pending calls of deleted logins, once', async () => {
    const ghost = `${tag}-ghost`
    await prisma.pendingTouch.create({ data: { userId: ghost, accountId, cardId: 'c3', name: 'Brown' } })
    expect(await D.ensureNoOrphanPendingCalls(accountId)).toBe(1)
    expect(await prisma.pendingTouch.findUnique({ where: { userId: ghost } })).toBeNull()
    expect(await prisma.pendingTouch.findUnique({ where: { userId: u.stays } })).not.toBeNull()
    const mark = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: D.PENDING_CALLS_CLEANUP_KEY } } })
    expect(mark.value.removed).toBe(1)
    await prisma.pendingTouch.create({ data: { userId: ghost, accountId, cardId: 'c3', name: 'Brown' } })
    expect(await D.ensureNoOrphanPendingCalls(accountId)).toBeNull()
    expect(await prisma.pendingTouch.findUnique({ where: { userId: ghost } })).not.toBeNull()
  })

  test('an empty old Staging sheet is removed; one with rows is kept', async () => {
    const key = { accountId_key: { accountId, key: S.STAGING_SHEET_KEY } }
    const mark = { accountId_key: { accountId, key: S.STAGING_SHEET_CLEANUP_KEY } }
    await prisma.accountKeyValue.create({ data: { accountId, key: S.STAGING_SHEET_KEY, value: [] } })
    expect(await S.ensureStagingSheetRemoved(accountId)).toBe('removed')
    expect(await prisma.accountKeyValue.findUnique({ where: key })).toBeNull()
    expect(await S.ensureStagingSheetRemoved(accountId)).toBeNull()

    await prisma.accountKeyValue.delete({ where: mark })
    await prisma.accountKeyValue.create({ data: { accountId, key: S.STAGING_SHEET_KEY, value: [{ id: 's1', clientName: 'Keep me' }] } })
    expect(await S.ensureStagingSheetRemoved(accountId)).toBe('kept')
    expect((await prisma.accountKeyValue.findUnique({ where: key })).value).toEqual([{ id: 's1', clientName: 'Keep me' }])

    await prisma.accountKeyValue.delete({ where: mark })
    await prisma.accountKeyValue.delete({ where: key })
    expect(await S.ensureStagingSheetRemoved(accountId)).toBe('none')
  })

  test('what counts as an empty sheet', () => {
    for (const v of [null, [], '', '[]', ' null ']) expect(S.isEmptySheet(v)).toBe(true)
    for (const v of [[{}], '[1]', 'x', { a: 1 }]) expect(S.isEmptySheet(v)).toBe(false)
  })
})
