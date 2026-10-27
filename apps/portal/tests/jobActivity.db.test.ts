/**
 * The customer page's Activity has the customer's jobs too (lib/jobActivity.ts;
 * walkthrough recheck, Oct 27 2026): payments, scheduling (booked, moved,
 * taken off), install Start and Finish, and the final walkthrough. On the dev
 * database (DEV_DB=1, ezbiz_dev; refuses any other). Removes what it made.
 */
import 'dotenv/config'
import { describe, test, expect, afterAll, beforeAll } from 'vitest'
import { scheduleWords, daysWords } from '../src/server/lib/jobActivity'

describe('schedule words', () => {
  test('booked, moved, taken off, rain day', () => {
    expect(daysWords('2026-10-27', '2026-10-28')).toBe('Tue, Oct 27 to Wed, Oct 28')
    expect(scheduleWords('scheduled', { start: '2026-10-27', end: '2026-10-27', crew: 'Crew 1' })).toBe('Install scheduled for Tue, Oct 27, Crew 1')
    expect(scheduleWords('moved', { start: '2026-10-28', end: '2026-10-29', crew: 'Crew 1', was: '2026-10-27' })).toBe('Install moved to Wed, Oct 28 to Thu, Oct 29, Crew 1 (was Tue, Oct 27)')
    expect(scheduleWords('off', { was: '2026-10-27' })).toBe('Install taken off the schedule (was Tue, Oct 27)')
    expect(scheduleWords('rain', { was: '2026-10-27', start: '2026-10-28', end: '2026-10-28' })).toBe('Rain day: install moved from Tue, Oct 27 to Wed, Oct 28')
  })
})

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('a customer\'s jobs in their Activity (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { customerHistory } = await import('../src/server/lib/followUps.js')
  const { recordInstallTime } = await import('../src/server/lib/crewInstall.js')
  const { logScheduleChange } = await import('../src/server/lib/jobActivity.js')
  const stamp = Date.now().toString(36)
  const made = { contacts: [] as string[], jobs: [] as string[], payments: [] as string[] }
  let accountId = ''

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
  })

  afterAll(async () => {
    await prisma.walkthrough.deleteMany({ where: { jobId: { in: made.jobs } } })
    await prisma.contractPayment.deleteMany({ where: { id: { in: made.payments } } })
    await prisma.activityLog.deleteMany({ where: { entityType: 'job', entityId: { in: made.jobs } } })
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: made.jobs } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: made.jobs } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: made.contacts } } })
  })

  test('payments, schedule changes, Start and Finish, the walkthrough; a login without prices gets no amounts', async () => {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'JA', lastName: `Activity ${stamp}`, phone: '3525550197', leadSource: 'Referral' } as any })
    made.contacts.push(c.id)
    const job = await prisma.savedJob.create({ data: { accountId, crmContactId: c.id, customerName: `JA Activity ${stamp}`, fenceStyle: "WV-ND 6'x8' Privacy", status: 'scheduled', opsStage: 'scheduled', scheduledDate: '2026-11-02', scheduledEndDate: '2026-11-03', crewAssigned: 'Crew 1', sections: 23 } as any })
    made.jobs.push(job.id)
    const pay = (id: string, cents: number, method: string, extra: object = {}) => prisma.contractPayment.create({ data: { id, accountId, jobId: job.id, crmContactId: c.id, amountCents: cents, method, paidOn: '2026-10-27', recordedBy: 'Pat Office', ...extra } as any })
    const p1 = `ja-${stamp}-1`, p2 = `ja-${stamp}-2`
    made.payments.push(p1, p2)
    await pay(p1, 358_900, 'check', { checkNumber: '1042' })
    await pay(p2, 10_000, 'zelle', { voidedAt: new Date(), voidedBy: 'Pat Office', voidReason: 'Typed twice' })
    await logScheduleChange(job.id, 'Install scheduled for Mon, Nov 2 to Tue, Nov 3, Crew 1', { name: 'Pat Office' })
    await recordInstallTime(job.id, 'start', 'WT Installer', new Date('2026-11-02T12:00:00Z'))
    await recordInstallTime(job.id, 'finish', 'WT Installer', new Date('2026-11-03T20:00:00Z'), true)
    await prisma.walkthrough.create({ data: { accountId, jobId: job.id, startedBy: 'WT Installer', signedAt: new Date('2026-11-03T21:00:00Z'), homeownerSig: { name: 'Lee Owner' }, repSig: { name: 'WT Installer' }, completedAt: new Date('2026-11-03T21:05:00Z'), completedBy: 'WT Installer', status: 'completed' } as any })

    const h = await customerHistory(accountId, { customerId: c.id })
    const titles = h.map(i => `${i.kind}: ${i.title}`)
    expect(titles).toEqual(expect.arrayContaining([
      'payment: Payment received: $3,589.00 by check #1042',
      'payment: Payment received: $100.00 by Zelle',
      'payment: Payment voided: $100.00 by Zelle',
      'schedule: Install scheduled for Mon, Nov 2 to Tue, Nov 3, Crew 1',
      'install: Install started',
      'install: Install finished: job done',
      'walkthrough: Final walkthrough started',
      'walkthrough: Final walkthrough signed',
      'walkthrough: Final walkthrough completed',
    ]))
    expect(h.find(i => i.title.startsWith('Install scheduled'))!.by).toBe('Pat Office')
    expect(h.find(i => i.title === 'Final walkthrough signed')!.detail).toBe('Homeowner: Lee Owner. For us: WT Installer.')
    expect(h.find(i => i.title === 'Payment voided: $100.00 by Zelle')!.detail).toBe('Typed twice')
    // Newest first, as the rest of the Activity.
    expect([...h].sort((a, b) => b.at.localeCompare(a.at)).map(i => i.at)).toEqual(h.map(i => i.at))

    // The Installer (no prices): the payments without amounts.
    const crew = await customerHistory(accountId, { customerId: c.id, prices: false })
    expect(crew.filter(i => i.kind === 'payment').map(i => i.title).sort()).toEqual(['Payment received by Zelle', 'Payment received by check #1042', 'Payment voided (Zelle)'])
    expect(crew.some(i => /\$/.test(i.title))).toBe(false)
  })

  test('a job booked before schedule changes were kept: its move into Scheduled, with its dates', async () => {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'JA', lastName: `Older ${stamp}`, phone: '3525550196', leadSource: 'Referral' } as any })
    made.contacts.push(c.id)
    const job = await prisma.savedJob.create({ data: { accountId, crmContactId: c.id, customerName: `JA Older ${stamp}`, fenceStyle: "WV-ND 6'x8' Privacy", status: 'scheduled', opsStage: 'scheduled', scheduledDate: '2026-11-04', crewAssigned: 'Crew 2', sections: 10 } as any })
    made.jobs.push(job.id)
    await prisma.automationEvent.create({ data: { accountId, type: 'card_entered', board: 'ops', entityKind: 'job', entityId: job.id, data: { stage: 'scheduled', to: 'scheduled', from: 'ready' }, dedupeKey: `ja-test:${job.id}`, processedAt: new Date() } })
    const h = await customerHistory(accountId, { customerId: c.id })
    expect(h.find(i => i.kind === 'schedule')).toMatchObject({ title: 'Install scheduled for Wed, Nov 4, Crew 2' })
  })
})
