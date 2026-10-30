/**
 * Deleting a customer closes out what hangs off it, and a restore reopens
 * exactly that (lib/closeOut.ts; Jonathan, Oct 30 2026, after "jj jj" was
 * deleted with its contract Active, four tasks Pending, its estimate visit
 * Scheduled, its permit Needed and its job's steps still kept).
 *
 * A company made for the test (dev database) and removed after: two customers
 * with a quote, a job, the quote's contract, tasks, appointments, a permit, an
 * unread notice, job steps and a queued automation step each. Deleting one:
 * its open ones close, its finished ones and the other customer stay as they
 * are, nothing is sent. Restore: exactly those reopen; one changed since is
 * skipped and named. The clean up of customers deleted before (the script
 * close-out-deleted-customers-2026-10-30.ts) closes the same, and the restore
 * of such a deletion still brings everything back.
 */

import 'dotenv/config'
import fs from 'fs'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('a deletion closes out, a restore reopens (dev database)', () => {
  let prisma: any
  let del: typeof import('../src/server/lib/deletion.js')
  let co: typeof import('../src/server/lib/closeOut.js')
  const tag = `co-${Date.now().toString(36)}`
  let accountId = ''
  let userId = ''
  const jobIds: string[] = []
  const cardIds: string[] = []
  const actor = () => ({ accountId, userId })

  async function makeCustomer(name: string) {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Test', lastName: `${name} ${tag}`, phone: '3525550100' } })
    const q = await prisma.savedQuote.create({ data: { accountId, crmContactId: c.id, customerName: `Test ${name}`, fenceStyle: 'WV 6ft Privacy', runs: [100], pullSheet: [], finalPrice: 5000, status: 'SOLD' } })
    const j = await prisma.savedJob.create({ data: { id: `accepted-${q.id}`, accountId, crmContactId: c.id, quoteId: q.id, customerName: `Test ${name}`, contractValue: 5000 } })
    jobIds.push(j.id)
    const card = { id: `card-${name}-${tag}`, customerId: c.id, firstName: 'Test', lastName: name, stage: 'Signed Contract', createdAt: new Date().toISOString() }
    cardIds.push(card.id)
    const p = await prisma.pipelineState.findUnique({ where: { accountId } })
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [...(p.leads as any[]), card], version: { increment: 1 } } })
    const contract = await prisma.contract.create({ data: { accountId, externalCrmId: q.id, name: `WV — 20 sections ${name}`, startDate: new Date(), status: 'active' } })
    const tOpen = await prisma.task.create({ data: { title: `Order materials for ${name}`, jobId: j.id, jobName: name, status: 'pending' } })
    const tBusy = await prisma.task.create({ data: { title: `Schedule the install for ${name}`, jobId: j.id, jobName: name, status: 'in_progress' } })
    const tDone = await prisma.task.create({ data: { title: `File the permit for ${name}`, jobId: j.id, jobName: name, status: 'completed', completedAt: new Date('2026-10-20T12:00:00Z') } })
    const tCard = await prisma.task.create({ data: { title: `Follow up with ${name}`, jobId: card.id, jobName: name, status: 'pending', assignedTo: 'Christa' } })
    const aOpen = await prisma.appointment.create({ data: { accountId, crmContactId: c.id, type: 'estimate', status: 'scheduled', startAt: new Date('2026-11-03T15:00:00Z') } })
    const aJob = await prisma.appointment.create({ data: { accountId, crmContactId: c.id, jobId: j.id, type: 'install', status: 'confirmed', startAt: new Date('2026-11-04T12:00:00Z') } })
    const aDone = await prisma.appointment.create({ data: { accountId, crmContactId: c.id, type: 'estimate', status: 'completed', startAt: new Date('2026-10-10T15:00:00Z') } })
    const permit = await prisma.permit.create({ data: { accountId, jobId: j.id, status: 'needed' } })
    const nUnread = await prisma.notification.create({ data: { title: `Permit still Needed: ${name}`, body: 'x', jobId: j.id } })
    const nRead = await prisma.notification.create({ data: { title: `Proposal accepted: ${name}`, body: 'x', jobId: j.id, read: true, readAt: new Date('2026-10-20T12:00:00Z') } })
    const run = await prisma.automationRun.create({ data: { accountId, ruleId: `rule-${tag}`, eventId: `ev-${name}-${tag}`, entityKind: 'job', entityId: j.id, status: 'queued' } })
    const steps = [{ label: 'Locate Complete', done: true, by: 'Office', at: '2026-10-21T12:00:00.000Z' }, { label: 'Permit Approved', done: false }]
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    await prisma.businessState.update({ where: { accountId }, data: { jobChecklists: { ...(b.jobChecklists as any), [j.id]: steps }, version: { increment: 1 } } })
    return { c, q, j, card, contract, tOpen, tBusy, tDone, tCard, aOpen, aJob, aDone, permit, nUnread, nRead, run, steps }
  }
  type X = Awaited<ReturnType<typeof makeCustomer>>

  /** Everything of one customer as it stands (statuses, read, steps). */
  async function stateOf(x: X) {
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    return {
      contract: (await prisma.contract.findUnique({ where: { id: x.contract.id } })).status,
      tasks: await Promise.all([x.tOpen, x.tBusy, x.tDone, x.tCard].map(async t => { const r = await prisma.task.findUnique({ where: { id: t.id } }); return [r.status, r.completedAt?.toISOString() ?? null] })),
      appts: await Promise.all([x.aOpen, x.aJob, x.aDone].map(async a => (await prisma.appointment.findUnique({ where: { id: a.id } })).status)),
      permit: (await prisma.permit.findUnique({ where: { id: x.permit.id } })).status,
      notices: await Promise.all([x.nUnread, x.nRead].map(async n => { const r = await prisma.notification.findUnique({ where: { id: n.id } }); return [r.read, r.readAt?.toISOString() ?? null] })),
      steps: (b.jobChecklists as any)[x.j.id] ?? null,
    }
  }
  /** Every row of a customer's, for "nothing else changed". */
  async function rowsOf(x: X) {
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    return JSON.stringify({
      c: await prisma.crmContact.findUnique({ where: { id: x.c.id } }), q: await prisma.savedQuote.findUnique({ where: { id: x.q.id } }), j: await prisma.savedJob.findUnique({ where: { id: x.j.id } }),
      contract: await prisma.contract.findUnique({ where: { id: x.contract.id } }),
      tasks: await prisma.task.findMany({ where: { jobId: { in: [x.j.id, x.card.id] } }, orderBy: { id: 'asc' } }),
      appts: await prisma.appointment.findMany({ where: { crmContactId: x.c.id }, orderBy: { id: 'asc' } }),
      permit: await prisma.permit.findUnique({ where: { id: x.permit.id } }),
      notices: await prisma.notification.findMany({ where: { jobId: x.j.id }, orderBy: { id: 'asc' } }),
      run: await prisma.automationRun.findUnique({ where: { id: x.run.id } }),
      steps: (b.jobChecklists as any)[x.j.id],
      card: ((await prisma.pipelineState.findUnique({ where: { accountId } })).leads as any[]).find(l => l.id === x.card.id),
    })
  }
  const outboxSize = () => { try { return fs.statSync(process.env.DEV_OUTBOX_FILE!).size } catch { return 0 } }
  const sentRows = async () => ({
    notices: await prisma.notification.count({ where: { jobId: { in: jobIds } } }),
    events: await prisma.automationEvent.count({ where: { accountId } }),
    runs: await prisma.automationRun.count({ where: { accountId } }),
  })
  const OPEN = (x: X) => ({
    contract: 'active',
    tasks: [['pending', null], ['in_progress', null], ['completed', '2026-10-20T12:00:00.000Z'], ['pending', null]],
    appts: ['scheduled', 'confirmed', 'completed'],
    permit: 'needed',
    notices: [[false, null], [true, '2026-10-20T12:00:00.000Z']],
    steps: x.steps,
  })

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    del = await import('../src/server/lib/deletion.js')
    co = await import('../src/server/lib/closeOut.js')
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    userId = (await prisma.crmUser.create({ data: { email: `${tag}-owner@example.test`, firstName: 'Test', lastName: 'owner', role: 'super_admin', status: 'active', mustChangePassword: false, crmAccountId: accountId } })).id
    await prisma.pipelineState.create({ data: { accountId, leads: [], stages: [{ id: 'Signed Contract', name: 'Signed Contract' }] } })
    await prisma.businessState.create({ data: { accountId } })
  })

  afterAll(async () => {
    if (!prisma || !accountId) return
    // Test data only: this throwaway company's rows go with it.
    await prisma.task.deleteMany({ where: { jobId: { in: [...jobIds, ...cardIds] } } })
    await prisma.notification.deleteMany({ where: { jobId: { in: jobIds } } })
    for (const m of ['deletionLog', 'automationRun', 'automationEvent', 'permit', 'contract', 'cardFollowUp', 'pendingTouch', 'appointment', 'savedJob', 'savedQuote', 'crmContact', 'pipelineState', 'businessState']) await prisma[m].deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('delete a customer: its contract, open tasks, appointments and permit are cancelled, notices read, steps off; nothing sent; the other customer untouched', async () => {
    const x = await makeCustomer('gone')
    const other = await makeCustomer('kept')
    expect(await stateOf(x)).toEqual(OPEN(x))
    const otherBefore = await rowsOf(other)
    const outbox = outboxSize()
    const sent = await sentRows()

    const r = await del.deleteRecord(actor(), 'customer', x.c.id)
    expect(await stateOf(x)).toEqual({
      contract: 'cancelled',
      tasks: [['cancelled', null], ['cancelled', null], ['completed', '2026-10-20T12:00:00.000Z'], ['cancelled', null]],
      appts: ['cancelled', 'cancelled', 'completed'],
      permit: 'cancelled',
      notices: [[true, expect.any(String)], [true, '2026-10-20T12:00:00.000Z']],
      steps: null,
    })
    expect((await prisma.automationRun.findUnique({ where: { id: x.run.id } })).status).toBe('skipped')
    // Soft deleted as before, and the log holds what closed (Deleted Records counts them).
    expect((await prisma.appointment.findUnique({ where: { id: x.aOpen.id } })).deletedAt).not.toBeNull()
    expect(r.counts).toMatchObject({ 'contract.cancelled': 1, 'task.cancelled': 3, 'appointment.cancelled': 2, 'permit.cancelled': 1, 'notification.read': 1, jobSteps: 1 })
    const log = await prisma.deletionLog.findUnique({ where: { id: r.logId } })
    expect(log.snapshot.closed.map((c: any) => c.id).sort()).toEqual([x.contract.id, x.tOpen.id, x.tBusy.id, x.tCard.id, x.aOpen.id, x.aJob.id, x.permit.id, x.nUnread.id].sort())
    expect(log.snapshot.steps).toEqual([{ jobId: x.j.id, label: 'Job steps: Test gone', items: x.steps }])

    // Nothing sent: no held message, no new notice, event or automation step.
    expect(outboxSize()).toBe(outbox)
    expect(await sentRows()).toEqual(sent)
    // The other customer: not one field changed.
    expect(await rowsOf(other)).toBe(otherBefore)

    // Restore: exactly what it closed reopens; the finished ones stay finished.
    const back = await del.restoreDeletion(actor(), r.logId)
    expect(back.skipped.filter(s => !/automation step/.test(s.what))).toEqual([])
    expect(await stateOf(x)).toEqual(OPEN(x))
    expect((await prisma.appointment.findUnique({ where: { id: x.aOpen.id } })).deletedAt).toBeNull()
    // A queued text stays stopped (never sent again by a restore).
    expect((await prisma.automationRun.findUnique({ where: { id: x.run.id } })).status).toBe('skipped')
    expect(outboxSize()).toBe(outbox)
    expect(await rowsOf(other)).toBe(otherBefore)
  })

  test('restore: one changed after the delete is skipped and named, the rest reopen', async () => {
    const x = await makeCustomer('changed')
    const r = await del.deleteRecord(actor(), 'customer', x.c.id)
    await prisma.task.update({ where: { id: x.tOpen.id }, data: { status: 'completed', completedAt: new Date() } })
    const back = await del.restoreDeletion(actor(), r.logId)
    expect(back.skipped.filter(s => !/automation step/.test(s.what))).toEqual([{ what: `Task: Order materials for changed`, why: 'it changed after it was deleted' }])
    const s = await stateOf(x)
    expect(s.tasks[0][0]).toBe('completed')
    expect(s.tasks[1][0]).toBe('in_progress')
    expect(s.permit).toBe('needed')
    expect(s.contract).toBe('active')
  })

  test('a job deleted on its own closes out its tasks, permit and steps too; restore reopens', async () => {
    const x = await makeCustomer('job')
    const r = await del.deleteRecord(actor(), 'job', x.j.id)
    const s = await stateOf(x)
    expect(s.permit).toBe('cancelled')
    expect(s.tasks.map(t => t[0])).toEqual(['cancelled', 'cancelled', 'completed', 'pending'])
    expect(s.appts).toEqual(['scheduled', 'cancelled', 'completed'])
    expect(s.steps).toBeNull()
    await del.restoreDeletion(actor(), r.logId)
    expect(await stateOf(x)).toEqual(OPEN(x))
  })

  test('the clean up of a customer deleted before: closes the same, once; the restore still brings all of it back', async () => {
    const x = await makeCustomer('old')
    const other = await makeCustomer('bystander')
    const otherBefore = await rowsOf(other)
    // A deletion as made before Oct 30 2026: soft deleted, nothing closed.
    const r = await del.deleteRecord(actor(), 'customer', x.c.id)
    const log = await prisma.deletionLog.findUnique({ where: { id: r.logId } })
    const { closed: _c, steps: _s, ...oldSnap } = log.snapshot
    await prisma.deletionLog.update({ where: { id: r.logId }, data: { snapshot: oldSnap } })
    await prisma.contract.update({ where: { id: x.contract.id }, data: { status: 'active' } })
    for (const [t, st] of [[x.tOpen, 'pending'], [x.tBusy, 'in_progress'], [x.tCard, 'pending']] as const) await prisma.task.update({ where: { id: t.id }, data: { status: st } })
    // Raw, as an old deletion left them: the appointment rows keep the updatedAt the deletion log holds.
    await prisma.$executeRawUnsafe(`UPDATE "CrmAppointment" SET status = CASE id WHEN $1 THEN 'scheduled' ELSE 'confirmed' END WHERE id IN ($1, $2)`, x.aOpen.id, x.aJob.id)
    await prisma.permit.update({ where: { id: x.permit.id }, data: { status: 'needed' } })
    await prisma.notification.update({ where: { id: x.nUnread.id }, data: { read: false, readAt: null } })
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    await prisma.businessState.update({ where: { accountId }, data: { jobChecklists: { ...(b.jobChecklists as any), [x.j.id]: x.steps } } })
    const outbox = outboxSize()

    const found = await prisma.$transaction((tx: any) => co.leftoversOfDeletedCustomers(tx, accountId))
    expect(found.map((l: any) => [l.contactId, l.logId, l.found.closed.length, l.found.steps.length])).toEqual([[x.c.id, r.logId, 8, 1]])
    await prisma.$transaction(async (tx: any) => { for (const l of found) await co.closeOutLeftover(tx, l, new Date()) })
    const s = await stateOf(x)
    expect([s.contract, s.permit, s.steps, ...s.appts, ...s.tasks.map(t => t[0])]).toEqual(['cancelled', 'cancelled', null, 'cancelled', 'cancelled', 'completed', 'cancelled', 'cancelled', 'completed', 'cancelled'])
    // Run again: nothing left.
    expect(await prisma.$transaction((tx: any) => co.leftoversOfDeletedCustomers(tx, accountId))).toEqual([])
    expect(outboxSize()).toBe(outbox)
    expect(await rowsOf(other)).toBe(otherBefore)

    // Restoring that old deletion brings the customer and every closed one back, nothing skipped.
    const back = await del.restoreDeletion(actor(), r.logId)
    expect(back.skipped.filter(s2 => !/automation step/.test(s2.what))).toEqual([])
    expect(await stateOf(x)).toEqual(OPEN(x))
    expect((await prisma.crmContact.findUnique({ where: { id: x.c.id } })).deletedAt).toBeNull()
  })
})
