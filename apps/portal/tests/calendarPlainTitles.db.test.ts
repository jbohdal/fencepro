/**
 * The plain title switch is recorded once per company (dev database only:
 * DEV_DB=1 and ezbiz_dev; vitest does not load this file anywhere else). Done
 * twice, then three times at once, there is one record and every caller gets
 * the same moment. Runs on a company made for the test and removed after it.
 */
import 'dotenv/config'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('calendar plain titles switch (dev database)', () => {
  let prisma: any
  let accountId = ''
  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    accountId = (await prisma.crmAccount.create({ data: { name: `Test plaintitles-${Date.now().toString(36)}`, status: 'active' } })).id
  })
  afterAll(async () => {
    if (!accountId) return
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('recorded once; every later call gets the first moment', async () => {
    const { ensurePlainTitles, PLAIN_TITLES_KEY } = await import('../src/server/lib/calendarSync/index')
    const inputs = { baseUrl: '', workDays: [1, 2, 3, 4], crews: [], gridJobs: [], leads: [], contacts: [], appointments: [], styleLabel: (n: string) => n,
      jobs: [] }
    const first = await ensurePlainTitles(accountId, inputs, [], new Date('2026-10-19T14:00:00Z'))
    expect(first).toBe('2026-10-19T14:00:00.000Z')
    expect(await ensurePlainTitles(accountId, inputs, [], new Date('2026-10-25T00:00:00Z'))).toBe(first)
    const many = await Promise.all([1, 2, 3].map(d => ensurePlainTitles(accountId, inputs, [], new Date(`2026-11-0${d}T00:00:00Z`))))
    expect(many).toEqual([first, first, first])
    const rows = await prisma.accountKeyValue.findMany({ where: { accountId, key: PLAIN_TITLES_KEY } })
    expect(rows).toHaveLength(1)
    expect(rows[0].value).toMatchObject({ from: first, count: 0 })
  })
})
