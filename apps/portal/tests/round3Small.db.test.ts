/**
 * Round 3 walkthrough (Oct 26 2026), the small ones on the dev database
 * (DEV_DB=1, ezbiz_dev; refuses any other). Writes only inside the tests and
 * afterAll; removes what it made.
 *
 * - The customer signed: an estimate visit that has passed is marked done; one
 *   still to come stays booked and the owner and the office are told once.
 * - "We finished the whole job" in fewer days than booked: no "no longer fits".
 * - A lead that phoned in: the call is their last contact.
 */
import 'dotenv/config'
import { describe, test, expect, afterAll, beforeAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('round 3 small fixes (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { estimateVisitsAfterSigning } = await import('../src/server/lib/estimateVisits.js')
  const { scheduleFit } = await import('../src/server/lib/changeOrderWork.js')
  const { recordInstallTime } = await import('../src/server/lib/crewInstall.js')
  const { customerHistory } = await import('../src/server/lib/followUps.js')
  const stamp = Date.now().toString(36)
  const made = { contacts: [] as string[], quotes: [] as string[], jobs: [] as string[] }
  let accountId = ''

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
  })

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { link: { in: made.contacts.map(c => `/customers/${c}?tab=appointments`) } } })
    await prisma.appointment.deleteMany({ where: { crmContactId: { in: made.contacts } } })
    await prisma.activityLog.deleteMany({ where: { entityType: 'job', entityId: { in: made.jobs } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: made.jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: made.contacts } } })
  })

  async function customer(leadSource = 'Referral') {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'R3', lastName: `Small ${stamp}${made.contacts.length}`, phone: '3525550198', leadSource } as any })
    made.contacts.push(c.id)
    return c
  }

  test('signed: the passed estimate visit is done, the one to come is pointed out once', async () => {
    const c = await customer()
    const now = new Date()
    const visit = (h: number) => prisma.appointment.create({ data: { accountId, crmContactId: c.id, type: 'estimate', status: 'scheduled', startAt: new Date(now.getTime() + h * 3600_000), assignedTo: 'WT Christa' } })
    const past = await visit(-3), future = await visit(20)
    const q = await prisma.savedQuote.create({ data: { accountId, crmContactId: c.id, customerName: `R3 Small ${stamp}`, fenceStyle: "WV-ND 6'x8' Privacy", runs: [50], sections: 7, finalPrice: 3000, pullSheet: [], status: 'SOLD', soldAt: new Date(Date.now() + 1000) } as any })
    made.quotes.push(q.id)
    const r = await estimateVisitsAfterSigning(accountId, q.id, 'Pat Office', now)
    expect(r).toEqual({ done: [past.id], future: [future.id] })
    const p = (await prisma.appointment.findUnique({ where: { id: past.id } }))!
    expect(p.status).toBe('completed')
    expect((p.history as any[]).at(-1)).toMatchObject({ kind: 'status', to: 'completed', reason: 'Customer signed' })
    expect((await prisma.appointment.findUnique({ where: { id: future.id } }))!.status).toBe('scheduled')
    const told = () => prisma.notification.findMany({ where: { link: `/customers/${c.id}?tab=appointments` } })
    expect((await told()).map(n => n.recipientRole).sort()).toEqual(['admin', 'office_staff'])
    expect((await told())[0].title).toBe(`R3 Small ${stamp} signed: an estimate visit is still booked`)
    // Saved again (the quote kept as Sold): nothing new.
    await estimateVisitsAfterSigning(accountId, q.id, 'Pat Office', now)
    expect((await told()).length).toBe(2)
  })

  test('"We finished the whole job" on day 1 of 2: no "no longer fits"', async () => {
    const c = await customer()
    const job = await prisma.savedJob.create({ data: { accountId, crmContactId: c.id, customerName: `R3 Small ${stamp}`, fenceStyle: "WV-ND 6'x8' Privacy", status: 'in_progress', scheduledDate: '2026-11-02', scheduledEndDate: '2026-11-02', estimatedDays: 2, sections: 23 } as any })
    made.jobs.push(job.id)
    expect(await scheduleFit(accountId, job.id)).toMatch(/needs 2 crew days now and is booked for 1/)
    await recordInstallTime(job.id, 'finish', 'WT Installer', new Date('2026-11-02T20:00:00Z'), true)
    expect(await scheduleFit(accountId, job.id)).toBeNull()
  })

  test('a lead that phoned in: the call is the last contact', async () => {
    const c = await customer('Phone call')
    const h = await customerHistory(accountId, { customerId: c.id })
    expect(h.find(i => i.kind === 'call')).toMatchObject({ title: 'Call: phoned in (new lead)', at: c.createdAt.toISOString() })
    const other = await customer('Referral')
    expect((await customerHistory(accountId, { customerId: other.id })).some(i => i.kind === 'call')).toBe(false)
  })
})
