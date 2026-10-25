/**
 * Scheduling installs against the dev database (DEV_DB=1; refuses any other):
 * lib/installScheduling.ts on a throwaway company.
 *
 *   - Ready to schedule lists the waiting job with its permit, 811, deposit
 *     and materials, and not a scheduled one or one on hold;
 *   - scheduling a 3 crew day job started Thursday fills Thu, Mon, Tue (crew
 *     days Monday to Thursday), moves it to Scheduled, sets its start, end,
 *     crew and days, puts one board entry per day and bumps the board;
 *   - the text is prepared (and held back: the customer has not said yes);
 *   - moving it keeps its crew days; fewer days takes the extra entry off;
 *   - a rain day moves it and everything after, and logs it;
 *   - taking it off clears the dates and the entries and puts it back.
 * The company and everything in it are removed at the end.
 */

import 'dotenv/config'
import crypto from 'crypto'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('Scheduling installs (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const S = await import('../src/server/lib/installScheduling.js')
  const tag = `install-sched-${crypto.randomUUID().slice(0, 8)}`
  let accountId = ''
  const actor = () => ({ accountId, userId: null })
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    await prisma.businessState.create({ data: { accountId, config: { company: { name: 'Getter Done Fence', phone: '3527894314' } } as any } })
    await prisma.scheduleSettings.create({ data: { accountId, workDays: [1, 2, 3, 4], crews: [{ id: 'c1', name: 'Crew One', color: 'bg-blue-500' }, { id: 'c2', name: 'Crew Two', color: 'bg-green-500' }] } })
    const contact = await prisma.crmContact.create({ data: { accountId, firstName: 'Kristi', lastName: tag, phone: '3525550142' } as any })
    ids.contact = contact.id
    const mk = (k: string, f: Record<string, unknown>) => prisma.savedJob.create({ data: { accountId, crmContactId: contact.id, customerName: `Kristi ${tag}`, customerPhone: '3525550142', customerAddress: '12 Oak Rd, Ocala, FL 34470', fenceStyle: "WV-ND 6'x8' Privacy", sections: 40, totalFeet: 320, contractValue: 9000, ...f } as any }).then(j => { ids[k] = j.id })
    await mk('ready', { status: 'staging', opsStage: 'permit_pending', materialsStatus: 'received', locatesDate: '2026-10-20', locatesExpDate: '2026-11-03', estimatedDays: 4 })
    await mk('next', { status: 'scheduled', opsStage: 'scheduled', scheduledDate: '2026-11-05', scheduledEndDate: '2026-11-05', crewAssigned: 'Crew One' })
    await mk('hold', { status: 'on_hold', opsStage: 'customer_delay', previousStatus: 'staging' })
    await prisma.scheduledGridJob.create({ data: { accountId, stagingJobId: ids.next, clientName: 'Next Job', crewId: 'c1', date: '2026-11-05' } })
    await prisma.permit.create({ data: { accountId, jobId: ids.ready, status: 'applied' } })
  })

  afterAll(async () => {
    if (!accountId) return
    const jobIds = Object.values(ids)
    await prisma.automationEvent.deleteMany({ where: { accountId } })
    await prisma.deletionLog.deleteMany({ where: { accountId } })
    await prisma.scheduleRainDay.deleteMany({ where: { accountId } })
    await prisma.scheduledGridJob.deleteMany({ where: { accountId } })
    await prisma.scheduleSettings.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.permit.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: jobIds } } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  const board = () => prisma.scheduledGridJob.findMany({ where: { accountId, deletedAt: null }, orderBy: [{ date: 'asc' }] })
  const version = async () => (await prisma.scheduleSettings.findUnique({ where: { accountId } }))!.version

  test('Ready to schedule: the waiting job with its facts, not the scheduled one or the one on hold', async () => {
    const list = await S.readyToSchedule(accountId)
    expect(list.map(j => j.id)).toEqual([ids.ready])
    const r = list[0]
    expect(r).toMatchObject({ permitStatus: 'applied', locatesExpDate: '2026-11-03', deposit: 'none', materialsStatus: 'received', footage: 320, sections: 40, stage: 'permit_pending', crewDaysFrom: 'estimate', crewDays: 4, allowWeekend: false })
  })

  test('schedule a 3 day job from Thursday: Thu, Mon, Tue on crew Two, stage Scheduled, one entry a day', async () => {
    const v0 = await version()
    const r = await S.scheduleInstall(accountId, actor(), { jobId: ids.ready, start: '2026-10-29', crew: 'c2', days: 3 })
    expect(r.days).toEqual(['2026-10-29', '2026-11-02', '2026-11-03'])
    expect(r.rescheduled).toBe(false)
    const job = (await prisma.savedJob.findUnique({ where: { id: ids.ready } }))!
    expect(job).toMatchObject({ status: 'scheduled', opsStage: 'scheduled', scheduledDate: '2026-10-29', scheduledEndDate: '2026-11-03', crewAssigned: 'Crew Two', estimatedDays: 3, materialsStatus: 'received' })
    const mine = (await board()).filter(g => g.stagingJobId === ids.ready)
    expect(mine.map(g => [g.date, g.crewId, g.area])).toEqual([['2026-10-29', 'c2', '12 Oak Rd, Ocala, FL 34470'], ['2026-11-02', 'c2', '12 Oak Rd, Ocala, FL 34470'], ['2026-11-03', 'c2', '12 Oak Rd, Ocala, FL 34470']])
    expect(await version()).toBe(v0 + 1)
    expect((await S.readyToSchedule(accountId)).map(j => j.id)).toEqual([])
  })

  test('the text is prepared word for word, and held back without a yes to texts', async () => {
    const r = await S.scheduleInstall(accountId, actor(), { jobId: ids.ready, start: '2026-10-29', crew: 'c2', days: 3 })
    expect(r.text.body).toBe('Getter Done Fence: Hi Kristi, your fence installation has moved and is now scheduled to start on 10/29/2026. Our crew will arrive in the morning. Questions? Call (352) 789 4314. Reply STOP to opt out.')
    expect(r.text.allowed).toBe(false)
    expect(r.text.reason).toMatch(/has not agreed to texts/)
    await prisma.crmContact.update({ where: { id: ids.contact }, data: { textConsent: 'yes' } })
    expect((await S.scheduleInstall(accountId, actor(), { jobId: ids.ready, start: '2026-10-29', crew: 'c2' })).text.allowed).toBe(true)
  })

  test('a start on a Friday moves to Monday; the days booked are kept on a move; fewer days takes one off', async () => {
    const r = await S.scheduleInstall(accountId, actor(), { jobId: ids.ready, start: '2026-10-30' })
    expect(r.movedFrom).toBe('2026-10-30')
    expect(r.days).toEqual(['2026-11-02', '2026-11-03', '2026-11-04'])
    expect(r.crew.id).toBe('c2')
    const r2 = await S.scheduleInstall(accountId, actor(), { jobId: ids.ready, start: '2026-11-02', days: 2 })
    expect(r2.days).toEqual(['2026-11-02', '2026-11-03'])
    expect((await board()).filter(g => g.stagingJobId === ids.ready).map(g => g.date)).toEqual(['2026-11-02', '2026-11-03'])
    expect(await prisma.deletionLog.count({ where: { accountId, entityType: 'schedule_entry' } })).toBe(1)
  })

  test('rain day on Tuesday: Tuesday moves to Wednesday, Thursday\'s job to Monday; Monday stays; logged', async () => {
    const preview = await S.rainDayPreview(accountId, '2026-11-03', 1)
    expect(preview.map(m => [m.customerName, m.days.map(d => `${d.from}>${d.to}`).join(' ')])).toEqual([
      [`Kristi ${tag}`, '2026-11-03>2026-11-04'],
      ['Next Job', '2026-11-05>2026-11-09'],
    ])
    // Kristi's job already started on Monday: no new start, no text. The next job's start moves: its text is ready.
    expect(preview[0].text).toBeNull()
    expect(preview[1].text?.body).toMatch(/now scheduled to start on 11\/09\/2026/)
    expect(await board().then(b => b.find(g => g.stagingJobId === ids.next)!.date)).toBe('2026-11-05')
    await S.applyRainDay(accountId, '2026-11-03', 1, 'Weather — rain')
    expect((await board()).filter(g => g.stagingJobId === ids.ready).map(g => g.date)).toEqual(['2026-11-02', '2026-11-04'])
    const next = (await prisma.savedJob.findUnique({ where: { id: ids.next } }))!
    expect([next.scheduledDate, next.scheduledEndDate]).toEqual(['2026-11-09', '2026-11-09'])
    const ready = (await prisma.savedJob.findUnique({ where: { id: ids.ready } }))!
    expect([ready.scheduledDate, ready.scheduledEndDate]).toEqual(['2026-11-02', '2026-11-04'])
    expect(await prisma.scheduleRainDay.count({ where: { accountId } })).toBe(2)
  })

  test('off the schedule: back to the stage it was in (Permit Pending), crew and dates cleared, its own crew-day estimate (4) kept, the customer text prepared', async () => {
    const r = await S.unscheduleInstall(accountId, actor(), ids.ready)
    const job = (await prisma.savedJob.findUnique({ where: { id: ids.ready } }))!
    expect(job).toMatchObject({ status: 'staging', opsStage: 'permit_pending', scheduledDate: '', scheduledEndDate: null, crewAssigned: '', estimatedDays: 4, materialsStatus: 'received' })
    expect(r.stageName).toBe('Permit Pending')
    expect(r.text.body).toBe('Getter Done Fence: Hi Kristi, your fence installation date is being changed. We\'ll call you with a new date. Questions? Call (352) 789 4314. Reply STOP to opt out.')
    expect((await board()).filter(g => g.stagingJobId === ids.ready)).toEqual([])
    expect((await S.readyToSchedule(accountId)).map(j => j.id)).toEqual([ids.ready])
    expect(await S.installMetaOf(accountId, ids.ready)).toBeNull()
  })

  test('a job booked before the stage was kept: taken off, its stage comes from what is recorded (no 811 ticket: Awaiting Locates), never Ready to Pull', async () => {
    await S.unscheduleInstall(accountId, actor(), ids.next)
    const job = (await prisma.savedJob.findUnique({ where: { id: ids.next } }))!
    expect(job).toMatchObject({ status: 'staging', opsStage: 'awaiting_locates', scheduledDate: '', crewAssigned: '' })
  })

  test('weekends: only when ticked; a day left on a Friday after Friday is switched off is not a weekend tick', async () => {
    // Booked Thu, Fri with Friday on.
    await prisma.scheduleSettings.update({ where: { accountId }, data: { workDays: [1, 2, 3, 4, 5] } })
    const a = await S.scheduleInstall(accountId, actor(), { jobId: ids.next, start: '2026-12-03', crew: 'c1', days: 2 })
    expect(a.days).toEqual(['2026-12-03', '2026-12-04'])
    // Friday switched off: the job still has its Friday, the window does not tick weekends, and a move books crew days only.
    await prisma.scheduleSettings.update({ where: { accountId }, data: { workDays: [1, 2, 3, 4] } })
    const facts = await S.jobScheduleFacts(accountId, ids.next)
    expect(facts).toMatchObject({ allowWeekend: false, bookedDays: ['2026-12-03', '2026-12-04'] })
    const b = await S.scheduleInstall(accountId, actor(), { jobId: ids.next, start: '2026-12-03' })
    expect(b.days).toEqual(['2026-12-03', '2026-12-07'])
    // Ticked on purpose: kept on the next move.
    const c = await S.scheduleInstall(accountId, actor(), { jobId: ids.next, start: '2026-12-04', allowWeekend: true })
    expect(c.days).toEqual(['2026-12-04', '2026-12-05'])
    expect((await S.scheduleInstall(accountId, actor(), { jobId: ids.next, start: '2026-12-05' })).days).toEqual(['2026-12-05', '2026-12-06'])
    expect(await S.weekendJobIds(accountId)).toEqual([ids.next])
    await S.unscheduleInstall(accountId, actor(), ids.next)
  })

  test('a job on hold, archived or missing is refused with plain words', async () => {
    await expect(S.scheduleInstall(accountId, actor(), { jobId: 'nope', start: '2026-11-02' })).rejects.toThrow(/not there any more/)
    await expect(S.scheduleInstall(accountId, actor(), { jobId: ids.ready, start: 'soon' })).rejects.toThrow(/Pick the day/)
  })
})
