/**
 * Scheduled deletions against the dev database (DEV_DB=1; refuses any other
 * database). Makes its own test contacts, backup log row and schedules, and
 * removes them after.
 */

import 'dotenv/config'
import { describe, test, expect, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('scheduled deletions (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { runDueDeletions } = await import('../src/server/lib/scheduledDeletions.js')
  const account = await prisma.crmAccount.findFirst({ orderBy: { createdAt: 'asc' } })
  const made: { contacts: string[]; schedules: string[]; backups: string[] } = { contacts: [], schedules: [], backups: [] }
  const contact = async (name: string, archived: boolean) => {
    const c = await prisma.crmContact.create({ data: { firstName: 'E2E', lastName: name, accountId: account!.id, archivedAt: archived ? new Date() : null } })
    made.contacts.push(c.id)
    return c.id
  }
  const schedule = async (ids: string[], deleteOn: string) => {
    const s = await prisma.scheduledDeletion.create({ data: { accountId: account!.id, what: 'E2E duplicates', model: 'CrmContact', recordIds: ids, labels: ids.map(() => 'E2E'), remindOn: '2030-01-01', deleteOn } })
    made.schedules.push(s.id)
    return s.id
  }
  afterAll(async () => {
    await prisma.scheduledDeletion.deleteMany({ where: { id: { in: made.schedules } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: made.contacts } } })
    await prisma.backupLog.deleteMany({ where: { id: { in: made.backups } } })
  })

  test('waits for a recent backup, then deletes only what is still archived and unused', async () => {
    const a = await contact('Dup A', true)
    const b = await contact('Dup B', true)
    const back = await contact('Brought back', false)
    const id = await schedule([a, b, back], '2030-01-02')
    // A day long before the date: nothing happens.
    expect((await runDueDeletions(new Date('2029-12-31T15:00:00Z'))).some(r => r.startsWith(id))).toBe(false)
    // On the day, with no backup in the 26 hours before: it waits.
    const day = new Date('2030-01-02T15:00:00Z')
    expect((await runDueDeletions(day)).find(r => r.startsWith(id))).toMatch(/waiting for a backup/)
    expect(await prisma.crmContact.count({ where: { id: { in: [a, b] } } })).toBe(2)
    // After the nightly backup: deleted, the one brought back is left alone.
    const bk = await prisma.backupLog.create({ data: { backupType: 'daily', filePath: 'e2e', status: 'success', startedAt: new Date('2030-01-02T07:00:00Z'), completedAt: new Date('2030-01-02T07:01:00Z') } })
    made.backups.push(bk.id)
    expect((await runDueDeletions(day)).find(r => r.startsWith(id))).toMatch(/Deleted 2 of 3.*no longer archived: 1/)
    expect(await prisma.crmContact.count({ where: { id: { in: [a, b] } } })).toBe(0)
    expect(await prisma.crmContact.count({ where: { id: back } })).toBe(1)
    expect((await prisma.scheduledDeletion.findUnique({ where: { id } }))!.status).toBe('done')
    // Done once: the next check does nothing.
    expect((await runDueDeletions(day)).some(r => r.startsWith(id))).toBe(false)
  })
})
