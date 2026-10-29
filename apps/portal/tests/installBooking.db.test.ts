/**
 * An install appointment is its job's install date (review Oct 28 2026:
 * booking an install for Nov 2 moved the job but the crew Schedule kept Oct 26;
 * cancelling it left the job "Scheduled, Mon 11/2, Crew 1"; the job's history
 * had no line). On the dev database (DEV_DB=1 and ezbiz_dev only), through the
 * appointments route, in a throwaway company removed afterwards:
 *
 *   - the Salesman books an install on the Salesman's own job: the job, its
 *     Schedule board entry and its history move to Nov 2;
 *   - cancelling it puts the job, the board and the stage back, with a line;
 *   - the Salesman on another salesman's job: 404, nothing booked or moved;
 *   - a Friday install (crew days Monday to Thursday): refused, nothing booked;
 *   - the owner books a job waiting to be scheduled (all day, two crew days):
 *     Scheduled, two entries; moved on the Schedule afterwards, the cancel
 *     leaves it there and says so.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { scheduleChangedSince, appointmentCrewDays, setsInstallDate } from '../src/server/lib/installBooking'
import { crewDayProblem, crewDaysOfWeek } from '../src/server/lib/installDays'

describe('install booking helpers', () => {
  test('an install on a job that still stands sets the install date', () => {
    const a = { type: 'install', status: 'scheduled', jobId: 'j', startAt: new Date() }
    expect(setsInstallDate(a)).toBe(true)
    expect(setsInstallDate({ ...a, status: 'cancelled' })).toBe(false)
    expect(setsInstallDate({ ...a, type: 'estimate' })).toBe(false)
    expect(setsInstallDate({ ...a, jobId: null })).toBe(false)
  })
  test('crew days of an all day install: the crew days within it; a timed one: left to the Schedule', () => {
    const week = [1, 2, 3, 4]
    // Mon Nov 9 to Wed Nov 11 midnight (Florida): Mon and Tue.
    expect(appointmentCrewDays({ allDay: true, startAt: new Date('2026-11-09T05:00:00Z'), endAt: new Date('2026-11-11T05:00:00Z') }, week)).toBe(2)
    // Thu to Mon midnight: Thu (Fri, Sat, Sun are not crew days).
    expect(appointmentCrewDays({ allDay: true, startAt: new Date('2026-11-12T05:00:00Z'), endAt: new Date('2026-11-16T05:00:00Z') }, week)).toBe(1)
    expect(appointmentCrewDays({ allDay: false, startAt: new Date('2026-11-09T13:00:00Z'), endAt: new Date('2026-11-09T15:00:00Z') }, week)).toBeNull()
  })
  test('crewDayProblem: the one rule the server and the booking dialog use', () => {
    const week = crewDaysOfWeek(null)
    expect(crewDayProblem('2026-11-02', week)).toBeNull()
    expect(crewDayProblem('2026-10-29', week)).toBeNull()
    expect(crewDayProblem('2026-10-30', week)).toBe('Installs go on crew days (Monday to Thursday). Fri, Oct 30 is not one. Pick a crew day, or book it on the Schedule with "The crew works weekends on this job" ticked.')
    expect(crewDayProblem('2026-10-31', week)).toMatch(/Sat, Oct 31 is not one/)
    expect(crewDayProblem('2026-11-01', week)).toMatch(/Sun, Nov 1 is not one/)
    // Friday ticked in Schedule settings; a job booked weekends too.
    expect(crewDayProblem('2026-10-30', crewDaysOfWeek([1, 2, 3, 4, 5]))).toBeNull()
    expect(crewDayProblem('2026-10-31', crewDaysOfWeek([1, 2, 3, 4, 5]))).toMatch(/^Installs go on crew days \(Monday to Friday\)/)
    expect(crewDayProblem('2026-11-01', crewDaysOfWeek(null, true))).toBeNull()
  })
  test('the schedule changed since the booking: another day, crew, stage or board entry', () => {
    const after = { scheduledDate: '2026-11-02', scheduledEndDate: '2026-11-02', status: 'scheduled', opsStage: 'scheduled', crewAssigned: 'Crew 1', estimatedDays: 1, grid: [{ date: '2026-11-02', crewId: 'c1' }] }
    expect(scheduleChangedSince(after, { ...after })).toBe(false)
    expect(scheduleChangedSince(after, { ...after, estimatedDays: 3 })).toBe(false)
    expect(scheduleChangedSince(after, { ...after, scheduledDate: '2026-11-09' })).toBe(true)
    expect(scheduleChangedSince(after, { ...after, crewAssigned: 'Crew 2' })).toBe(true)
    expect(scheduleChangedSince(after, { ...after, status: 'in_progress' })).toBe(true)
    expect(scheduleChangedSince(after, { ...after, grid: [{ date: '2026-11-02', crewId: 'c2' }] })).toBe(true)
  })
})

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('install appointments set the job\'s install date (dev database)', { timeout: 60_000 }, () => {
  let prisma: any
  let accountId = ''
  let base = ''
  let server: Server
  const tag = `instbook-${Date.now().toString(36)}`
  const users: Record<string, { id: string; token: string }> = {}
  const jobs: Record<string, string> = {}
  const contacts: Record<string, string> = {}

  const call = (who: string, method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { Authorization: `Bearer ${users[who].token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const job = (k: string) => prisma.savedJob.findUnique({ where: { id: jobs[k] } })
  const board = (k: string) => prisma.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, stagingJobId: jobs[k] }, orderBy: [{ date: 'asc' }] }).then((r: any[]) => r.map(g => `${g.date} ${g.crewId}`))
  const history = async (who: string, k: string) => ((await call(who, 'GET', `/api/change-orders/timeline?jobId=${jobs[k]}`)).json.data?.items ?? []).map((i: any) => i.title) as string[]

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const { salesScoped } = await import('../src/server/lib/salesScope.js')
    const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    await prisma.businessState.create({ data: { accountId } })
    await prisma.scheduleSettings.create({ data: { accountId, workDays: [1, 2, 3, 4], crews: [{ id: 'c1', name: 'Crew 1', color: 'bg-blue-500' }, { id: 'c2', name: 'Crew 2', color: 'bg-green-500' }] } })
    for (const [k, role, first] of [['owner', 'super_admin', 'Owen'], ['sally', 'sales_rep', 'Sally'], ['sam', 'sales_rep', 'Sam']] as const) {
      const email = `${tag}-${k}@example.invalid`
      const u = await prisma.crmUser.create({ data: { email, firstName: first, lastName: tag, role, crmAccountId: accountId, passwordHash: 'x' } as any })
      users[k] = { id: u.id, token: jwt.sign({ sub: u.id, email, role, crmAccountId: accountId, firstName: first, lastName: tag }, secret, { expiresIn: '10m' }) }
    }
    contacts.sally = (await prisma.crmContact.create({ data: { accountId, ownerId: users.sally.id, firstName: 'Manuel', lastName: tag, salesRep: 'Sally ' } })).id
    contacts.sam = (await prisma.crmContact.create({ data: { accountId, ownerId: users.sam.id, firstName: 'Bea', lastName: tag, salesRep: `Sam ${tag}` } })).id
    contacts.owner = (await prisma.crmContact.create({ data: { accountId, ownerId: users.owner.id, firstName: 'Cal', lastName: tag } })).id
    const mk = (k: string, contact: string, f: Record<string, unknown>) => prisma.savedJob.create({ data: { accountId, crmContactId: contacts[contact], customerName: `${k} ${tag}`, customerAddress: '12 Oak Rd, Ocala, FL 34470', fenceStyle: "WV-ND 6'x8' Privacy", sections: 10, contractValue: 5000, quotePrice: 5000, ...f } }).then((j: any) => { jobs[k] = j.id })
    // The review's job: Scheduled Mon Oct 26 on Crew 1, with its board entry.
    await mk('sally', 'sally', { status: 'scheduled', opsStage: 'scheduled', scheduledDate: '2026-10-26', scheduledEndDate: '2026-10-26', crewAssigned: 'Crew 1', estimatedDays: 1 })
    await prisma.scheduledGridJob.create({ data: { accountId, stagingJobId: jobs.sally, clientName: `sally ${tag}`, crewId: 'c1', date: '2026-10-26' } })
    await mk('sam', 'sam', { status: 'staging', opsStage: 'permit_pending', estimatedDays: 1 })
    await mk('owner', 'owner', { status: 'staging', opsStage: 'permit_pending', estimatedDays: 3 })
    const app = express()
    app.use(express.json())
    app.use('/api/appointments', salesScoped('appointments'))
    app.use('/api/appointments', (await import('../src/server/routes/appointments.js')).default)
    app.use('/api/change-orders', (await import('../src/server/routes/change-orders.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const apptIds = (await prisma.appointment.findMany({ where: { accountId }, select: { id: true } })).map((a: any) => a.id)
    const jobIds = [...Object.values(jobs), ...apptIds]
    await prisma.appointment.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: jobIds } } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: jobIds } } })
    for (const m of ['automationEvent', 'deletionLog', 'scheduledGridJob', 'scheduleSettings', 'accountKeyValue', 'billingLog', 'paymentSchedule', 'pipelineState', 'savedJob', 'crmContact', 'businessState']) {
      await prisma[m].deleteMany({ where: { accountId } }).catch((e: unknown) => console.error(`[install booking test] cleanup ${m}:`, e))
    }
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch((e: unknown) => console.error('[install booking test] cleanup:', e))
  })

  let sallyAppt = { id: '', version: 0 }

  test('the Salesman books an install on the Salesman\'s own job for Mon Nov 2: the job, the crew Schedule and the history move', async () => {
    // 8:00 to 10:00 AM in Florida, as the booking window sends it.
    const r = await call('sally', 'POST', '/api/appointments', { crmContactId: contacts.sally, type: 'install', jobId: jobs.sally, startAt: '2026-11-02T13:00:00.000Z', endAt: '2026-11-02T15:00:00.000Z', allDay: false, assignedTo: `Sally ${tag}` })
    expect(r.status, JSON.stringify(r.json)).toBe(201)
    expect(r.json.install).toMatchObject({ days: ['2026-11-02'], crew: { id: 'c1', name: 'Crew 1' } })
    sallyAppt = { id: r.json.data.id, version: r.json.version }
    expect(await job('sally')).toMatchObject({ scheduledDate: '2026-11-02', scheduledEndDate: '2026-11-02', status: 'scheduled', opsStage: 'scheduled', crewAssigned: 'Crew 1' })
    expect(await board('sally')).toEqual(['2026-11-02 c1'])
    expect(await history('sally', 'sally')).toContain('Install moved to Mon, Nov 2, Crew 1 (was Mon, Oct 26). Booked as an install appointment.')
  })

  test('the cancel says the job goes back; cancelling puts the job, the board and its history back', async () => {
    const pre = await call('sally', 'GET', `/api/appointments/${sallyAppt.id}/cancel-preview`)
    expect(pre.json.data).toEqual({ kind: 'restore', words: 'The job goes back to how it was before this booking: the install goes back to Mon, Oct 26, Crew 1.' })
    const r = await call('sally', 'PATCH', `/api/appointments/${sallyAppt.id}`, { status: 'cancelled', baseVersion: sallyAppt.version, reason: 'Customer cancelled' })
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    expect(r.json.installUndo.kind).toBe('restore')
    expect(await job('sally')).toMatchObject({ scheduledDate: '2026-10-26', scheduledEndDate: '2026-10-26', status: 'scheduled', opsStage: 'scheduled', crewAssigned: 'Crew 1' })
    expect(await board('sally')).toEqual(['2026-10-26 c1'])
    expect(await history('sally', 'sally')).toContain('Install appointment cancelled: install back to Mon, Oct 26, Crew 1 (was Mon, Nov 2)')
    expect((await call('sally', 'GET', `/api/appointments/${sallyAppt.id}/cancel-preview`)).json.data.kind).toBe('none')
  })

  test('the Salesman on another salesman\'s job: 404, nothing booked or moved', async () => {
    // Even with a customer of the Salesman's own, the job is Sam's.
    const r = await call('sally', 'POST', '/api/appointments', { crmContactId: contacts.sally, type: 'install', jobId: jobs.sam, startAt: '2026-11-02T13:00:00.000Z', endAt: '2026-11-02T15:00:00.000Z', allDay: false })
    expect(r.status).toBe(404)
    expect(await job('sam')).toMatchObject({ scheduledDate: '', status: 'staging', opsStage: 'permit_pending' })
    expect(await board('sam')).toEqual([])
    expect(await prisma.appointment.count({ where: { accountId, jobId: jobs.sam } })).toBe(0)
  })

  test('an install on a Friday (crew days Monday to Thursday): refused, nothing booked', async () => {
    const r = await call('sally', 'POST', '/api/appointments', { crmContactId: contacts.sally, type: 'install', jobId: jobs.sally, startAt: '2026-11-06T13:00:00.000Z', endAt: '2026-11-06T15:00:00.000Z', allDay: false })
    expect(r.status).toBe(400)
    expect(r.json.code).toBe('NOT_A_CREW_DAY')
    expect(r.json.error).toBe('Installs go on crew days (Monday to Thursday). Fri, Nov 6 is not one. Pick a crew day, or book it on the Schedule with "The crew works weekends on this job" ticked.')
    expect(await job('sally')).toMatchObject({ scheduledDate: '2026-10-26' })
    expect(await prisma.appointment.count({ where: { accountId, jobId: jobs.sally, status: { not: 'cancelled' } } })).toBe(0)
  })

  test('the owner books a waiting job all day Mon to Tue: Scheduled, two entries; moved on the Schedule after, the cancel leaves it and says so', async () => {
    const r = await call('owner', 'POST', '/api/appointments', { crmContactId: contacts.owner, type: 'install', jobId: jobs.owner, startAt: '2026-11-09T05:00:00.000Z', endAt: '2026-11-11T05:00:00.000Z', allDay: true })
    expect(r.status, JSON.stringify(r.json)).toBe(201)
    expect(await job('owner')).toMatchObject({ scheduledDate: '2026-11-09', scheduledEndDate: '2026-11-10', status: 'scheduled', opsStage: 'scheduled', crewAssigned: 'Crew 1', estimatedDays: 2 })
    expect(await board('owner')).toEqual(['2026-11-09 c1', '2026-11-10 c1'])
    expect(await history('owner', 'owner')).toEqual(expect.arrayContaining(['Install scheduled for Mon, Nov 9 to Tue, Nov 10, Crew 1. Booked as an install appointment.', 'Moved from Permit Pending to Scheduled']))

    // The office moves it on the Schedule screen.
    const S = await import('../src/server/lib/installScheduling.js')
    await S.scheduleInstall(accountId, { accountId, userId: users.owner.id }, { jobId: jobs.owner, start: '2026-11-16', crew: 'c2' })
    const pre = await call('owner', 'GET', `/api/appointments/${r.json.data.id}/cancel-preview`)
    expect(pre.json.data.kind).toBe('changed')
    expect(pre.json.data.words).toBe('The job\'s schedule was changed after this booking (now Mon 11/16, Crew 2), so the job stays as it is. Change it on the Schedule if it should move.')
    const c = await call('owner', 'PATCH', `/api/appointments/${r.json.data.id}`, { status: 'cancelled', baseVersion: r.json.version })
    expect(c.status).toBe(200)
    expect(c.json.installUndo.kind).toBe('changed')
    expect(await job('owner')).toMatchObject({ scheduledDate: '2026-11-16', crewAssigned: 'Crew 2', status: 'scheduled' })
    expect(await board('owner')).toEqual(['2026-11-16 c2', '2026-11-17 c2'])
  })

  test('the owner books, then cancels: the waiting job goes back to Permit Pending, off the Schedule', async () => {
    // Taken off first (the last test left it on the Schedule).
    const S = await import('../src/server/lib/installScheduling.js')
    await S.unscheduleInstall(accountId, { accountId, userId: users.owner.id }, jobs.owner)
    const before = await job('owner')
    const r = await call('owner', 'POST', '/api/appointments', { crmContactId: contacts.owner, type: 'install', jobId: jobs.owner, startAt: '2026-11-11T13:00:00.000Z', endAt: '2026-11-11T15:00:00.000Z', allDay: false })
    expect(r.status).toBe(201)
    expect((await job('owner')).opsStage).toBe('scheduled')
    const c = await call('owner', 'PATCH', `/api/appointments/${r.json.data.id}`, { status: 'cancelled', baseVersion: r.json.version })
    expect(c.json.installUndo).toEqual({ kind: 'restore', words: 'The job goes back to how it was before this booking: the install comes off the Schedule (no install date), as before the booking.' })
    expect(await job('owner')).toMatchObject({ scheduledDate: before.scheduledDate, scheduledEndDate: before.scheduledEndDate, status: before.status, opsStage: before.opsStage, crewAssigned: before.crewAssigned, estimatedDays: before.estimatedDays })
    expect(await board('owner')).toEqual([])
  })
})
