/**
 * The Salesman's job page (Jonathan, Oct 28 2026, audit #49: "Open the job
 * page to the Salesman read only, without costs"), on the dev database
 * (DEV_DB=1 and ezbiz_dev only):
 *
 * - the Salesman reads the Salesman's own job (quote made by the Salesman, or
 *   customer assigned to the Salesman), its milestones and its history;
 * - another salesman's job answers 404, and the lists leave it out;
 * - nothing the Salesman gets carries a cost field or a cost figure in words;
 * - every job write from the Salesman is refused, and nothing changes, but
 *   one: booking an install appointment on the Salesman's own job gives the
 *   job its days and "scheduled", as before;
 * - the owner is unchanged: costs, every job, writes.
 *
 * Everything happens in a throwaway company, removed afterwards.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { withoutCostFigures, namesSalesman } from '../src/server/lib/salesmanJobs'
import { isCostKey } from '../src/server/lib/costRedact'

describe('the Salesman job page helpers', () => {
  test('a sentence about a cost loses its figures; a price sentence keeps them', () => {
    expect(withoutCostFigures('Gate on the left. Material cost went up $212 at the supplier.'))
      .toBe('Gate on the left. Material cost went up $ (left out) at the supplier.')
    expect(withoutCostFigures('Margin 38% on this one.')).toBe('Margin (left out) on this one.')
    expect(withoutCostFigures('Change order CO-1 approved: +$450 (added 12 ft)')).toBe('Change order CO-1 approved: +$450 (added 12 ft)')
    expect(withoutCostFigures('Contract rev 1 signed: $5,000.00')).toBe('Contract rev 1 signed: $5,000.00')
  })
  test('the rep names the Salesman by full name, or by first name alone', () => {
    const me = { name: 'Sally Seller', firstName: 'Sally' }
    expect(namesSalesman(me, ' sally  seller ')).toBe(true)
    expect(namesSalesman(me, 'Sally')).toBe(true)
    expect(namesSalesman(me, 'Sally Other')).toBe(false)
    expect(namesSalesman(me, '')).toBe(false)
  })
})

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('the Salesman job page (dev database)', { timeout: 60_000 }, () => {
  let prisma: any
  let accountId = ''
  let base = ''
  let server: Server
  const tag = `smjob-${Date.now().toString(36)}`
  const users: Record<string, { id: string; token: string }> = {}
  const jobs: Record<string, string> = {}

  const call = (who: string, method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { Authorization: `Bearer ${users[who].token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  /** Every field name in an answer that is a cost (lib/costRedact.ts isCostKey). */
  const costKeys = (v: unknown, out: string[] = []): string[] => {
    if (Array.isArray(v)) v.forEach(x => costKeys(x, out))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (isCostKey(k)) out.push(k); costKeys(x, out) }
    return out
  }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    await prisma.businessState.create({ data: { accountId } })
    for (const [k, role, first] of [['owner', 'super_admin', 'Owen'], ['sally', 'sales_rep', 'Sally'], ['sam', 'sales_rep', 'Sam']] as const) {
      const email = `${tag}-${k}@example.invalid`
      const u = await prisma.crmUser.create({ data: { email, firstName: first, lastName: tag, role, crmAccountId: accountId, passwordHash: 'x' } as any })
      users[k] = { id: u.id, token: jwt.sign({ sub: u.id, email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' }) }
    }
    // Sally's quote (Sally made it), sold for $5,000.
    const q = await prisma.savedQuote.create({ data: { accountId, ownerId: users.sally.id, customerName: `A ${tag}`, runs: [], pullSheet: [], finalPrice: 5000, gmPct: 0.38, materialCost: 2000, status: 'SOLD', soldAt: new Date() } as any })
    // Sam's customer (Sam entered them); and a customer the owner entered but assigned to Sally.
    const samC = await prisma.crmContact.create({ data: { accountId, ownerId: users.sam.id, firstName: 'B', lastName: tag, salesRep: `Sam ${tag}` } })
    const assigned = await prisma.crmContact.create({ data: { accountId, ownerId: users.owner.id, firstName: 'C', lastName: tag, salesRep: `Sally ${tag}` } })
    jobs.a = (await prisma.savedJob.create({ data: { accountId, quoteId: q.id, customerName: `A ${tag}`, quotePrice: 5000, contractValue: 5000, gmPct: 0.38, notes: 'Gate on the left. Material cost went up $212 at the supplier.' } })).id
    jobs.b = (await prisma.savedJob.create({ data: { accountId, crmContactId: samC.id, customerName: `B ${tag}`, quotePrice: 3000, contractValue: 3000, gmPct: 0.3 } })).id
    jobs.c = (await prisma.savedJob.create({ data: { accountId, crmContactId: assigned.id, customerName: `C ${tag}`, quotePrice: 4000, contractValue: 4000, gmPct: 0.35 } })).id
    // The job history: a billing line that talks about a cost.
    await prisma.billingLog.create({ data: { accountId, jobId: jobs.a, kind: 'made', text: 'Payment schedule made. Vendor bill cost $1,234 matched to this job.', byName: 'Owen' } })
    const app = express()
    app.use(express.json())
    app.use('/api/saved-jobs', (await import('../src/server/routes/saved-jobs.js')).default)
    app.use('/api/change-orders', (await import('../src/server/routes/change-orders.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const jobIds = Object.values(jobs)
    await prisma.appointment.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: jobIds } } })
    await prisma.activityLog.deleteMany({ where: { entityId: { in: jobIds } } })
    for (const m of ['billingLog', 'paymentSchedule', 'savedJob', 'savedQuote', 'crmContact', 'businessState']) {
      await prisma[m].deleteMany({ where: { accountId } })
    }
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch((e: unknown) => console.error('[salesman job test] cleanup:', e))
  })

  test('the Salesman reads the Salesman\'s own job: the job, its milestones and its history, without costs', async () => {
    const one = await call('sally', 'GET', `/api/saved-jobs/${jobs.a}`)
    expect(one.status).toBe(200)
    expect(one.json.data.id).toBe(jobs.a)
    expect(one.json.data.contractValue).toBe(5000)
    expect(one.json.data.gmPct).toBeUndefined()
    expect(one.json.data.notes).toBe('Gate on the left. Material cost went up $ (left out) at the supplier.')
    expect(costKeys(one.json)).toEqual([])

    const ms = await call('sally', 'GET', `/api/saved-jobs/${jobs.a}/milestones`)
    expect(ms.status).toBe(200)
    expect(Array.isArray(ms.json.data.milestones)).toBe(true)
    expect(costKeys(ms.json)).toEqual([])

    const tl = await call('sally', 'GET', `/api/change-orders/timeline?jobId=${jobs.a}`)
    expect(tl.status).toBe(200)
    const titles = (tl.json.data.items as any[]).map(i => i.title)
    expect(titles.some(t => /^Contract rev 1 signed: \$5,000/.test(t))).toBe(true)
    expect(titles).toContain('Payment schedule made. Vendor bill cost $ (left out) matched to this job.')
    expect(JSON.stringify(tl.json)).not.toContain('1,234')
    expect(costKeys(tl.json)).toEqual([])
  })

  test('a job assigned to the Salesman through its customer is the Salesman\'s too', async () => {
    expect((await call('sally', 'GET', `/api/saved-jobs/${jobs.c}`)).status).toBe(200)
  })

  test('another salesman\'s job: 404 everywhere, and the lists leave it out', async () => {
    expect((await call('sally', 'GET', `/api/saved-jobs/${jobs.b}`)).status).toBe(404)
    expect((await call('sally', 'GET', `/api/saved-jobs/${jobs.b}/milestones`)).status).toBe(404)
    expect((await call('sally', 'GET', `/api/change-orders/timeline?jobId=${jobs.b}`)).status).toBe(404)
    const list = await call('sally', 'GET', '/api/saved-jobs')
    expect(list.status).toBe(200)
    expect((list.json.data as any[]).map(j => j.id).sort()).toEqual([jobs.a, jobs.c].sort())
    expect(costKeys(list.json)).toEqual([])
    const summary = await call('sally', 'GET', '/api/saved-jobs/milestones/summary')
    expect(summary.status).toBe(200)
    expect(Object.keys(summary.json.data).sort()).toEqual([jobs.a, jobs.c].sort())
    // Sam sees Sam's, not Sally's.
    expect((await call('sam', 'GET', `/api/saved-jobs/${jobs.b}`)).status).toBe(200)
    expect((await call('sam', 'GET', `/api/saved-jobs/${jobs.a}`)).status).toBe(404)
  })

  test('the Salesman\'s job writes are refused, and the job is as it was', async () => {
    const before = await prisma.savedJob.findUnique({ where: { id: jobs.a } })
    const tries = [
      ['PATCH', `/api/saved-jobs/${jobs.a}`, { notes: 'changed by the Salesman' }],
      ['PATCH', `/api/saved-jobs/${jobs.a}`, { status: 'scheduled', opsStage: 'scheduled' }],
      ['PATCH', `/api/saved-jobs/${jobs.a}`, { materialsStatus: 'ordered' }],
      ['PATCH', `/api/saved-jobs/${jobs.a}`, { scheduledDate: '2026-11-02', crewAssigned: 'c1' }],
      ['PUT', `/api/saved-jobs/${jobs.a}/locate`, { ticket: '123', calledDate: '2026-10-28', goodDate: '', expDate: '' }],
      ['POST', `/api/saved-jobs/${jobs.a}/milestones`, { label: 'Materials ordered', ticked: true }],
      ['POST', `/api/saved-jobs/${jobs.a}/archive`, {}],
      ['DELETE', `/api/saved-jobs/${jobs.a}`, undefined],
      ['POST', '/api/saved-jobs/sync', { jobs: [] }],
    ] as const
    for (const [m, p, b] of tries) {
      const r = await call('sally', m, p, b)
      expect(r.status, `${m} ${p}`).toBe(403)
      expect(r.json.code).toBe('NOT_ALLOWED')
    }
    // Someone else's job: refused the same.
    expect((await call('sally', 'PATCH', `/api/saved-jobs/${jobs.b}`, { notes: 'x' })).status).toBe(403)
    const after = await prisma.savedJob.findUnique({ where: { id: jobs.a } })
    expect(after.notes).toBe(before.notes)
    expect(after.status).toBe(before.status)
    expect(after.materialsStatus).toBe(before.materialsStatus)
    expect(after.scheduledDate).toBe(before.scheduledDate)
    expect(after.archivedAt).toBeNull()
    expect(after.deletedAt).toBeNull()
  })

  test('booking an install on the Salesman\'s own job gives the job its days, as before; nothing else rides along', async () => {
    const contact = await prisma.crmContact.create({ data: { accountId, ownerId: users.sally.id, firstName: 'D', lastName: tag } })
    // The appointment, as BookingDialog saves it first: Mon Nov 2 to Tue Nov 3, 2026 (Florida days).
    const appt = (job: string) => prisma.appointment.create({ data: { accountId, crmContactId: contact.id, jobId: job, type: 'install', allDay: true, startAt: new Date('2026-11-02T12:00:00Z'), endAt: new Date('2026-11-03T22:00:00Z') } })
    await appt(jobs.a)
    await appt(jobs.b)
    // Then the job save from the phone (jobStore updateJob): the whole job as the Salesman's phone has it, and the copy it was edited from.
    const shown = (await call('sally', 'GET', `/api/saved-jobs/${jobs.a}`)).json.data
    const job = { status: shown.status, opsStage: shown.opsStage, customerName: shown.customerName, notes: shown.notes, contractValue: shown.contractValue, materialsStatus: shown.materialsStatus, crewAssigned: shown.crewAssigned, scheduledDate: shown.scheduledDate, scheduledEndDate: shown.scheduledEndDate }
    const booked = { ...job, scheduledDate: '2026-11-02', scheduledEndDate: '2026-11-03', status: 'scheduled', opsStage: 'scheduled' }
    const beforeA = await prisma.savedJob.findUnique({ where: { id: jobs.a } })

    // Something else riding along (notes, materials, another day, another status): refused, nothing saved.
    for (const extra of [{ notes: 'changed' }, { materialsStatus: 'ordered' }, { crewAssigned: 'c1' }, { status: 'completed' }, { scheduledDate: '2026-11-09' }]) {
      const r = await call('sally', 'PATCH', `/api/saved-jobs/${jobs.a}`, { ...booked, ...extra, base: job })
      expect(r.status, JSON.stringify(extra)).toBe(403)
    }
    // Sam's job, even with its install booked: refused.
    const shownB = (await call('owner', 'GET', `/api/saved-jobs/${jobs.b}`)).json.data
    const jobB = { status: shownB.status, scheduledDate: shownB.scheduledDate, scheduledEndDate: shownB.scheduledEndDate }
    expect((await call('sally', 'PATCH', `/api/saved-jobs/${jobs.b}`, { ...jobB, scheduledDate: '2026-11-02', scheduledEndDate: '2026-11-03', status: 'scheduled', base: jobB })).status).toBe(403)
    expect((await prisma.savedJob.findUnique({ where: { id: jobs.b } })).scheduledDate).toBe(shownB.scheduledDate)
    expect(await prisma.savedJob.findUnique({ where: { id: jobs.a } })).toMatchObject({ scheduledDate: beforeA.scheduledDate, status: beforeA.status, notes: beforeA.notes })

    // The booking itself: saved, and the answer has no cost.
    const ok = await call('sally', 'PATCH', `/api/saved-jobs/${jobs.a}`, { ...booked, base: job })
    expect(ok.status).toBe(200)
    expect(ok.json.data).toMatchObject({ scheduledDate: '2026-11-02', scheduledEndDate: '2026-11-03', status: 'scheduled' })
    expect(costKeys(ok.json)).toEqual([])
    const after = await prisma.savedJob.findUnique({ where: { id: jobs.a } })
    expect(after).toMatchObject({ scheduledDate: '2026-11-02', scheduledEndDate: '2026-11-03', status: 'scheduled' })
    // The notes the Salesman's phone had (figures left out) never replace the saved ones; the margin stays.
    expect(after.notes).toBe(beforeA.notes)
    expect(after.gmPct).toBe(0.38)
  })

  test('the owner is unchanged: every job, the costs, and writes', async () => {
    const one = await call('owner', 'GET', `/api/saved-jobs/${jobs.a}`)
    expect(one.status).toBe(200)
    expect(one.json.data.gmPct).toBe(0.38)
    expect(one.json.data.notes).toBe('Gate on the left. Material cost went up $212 at the supplier.')
    const list = await call('owner', 'GET', '/api/saved-jobs')
    expect((list.json.data as any[]).map(j => j.id).sort()).toEqual([jobs.a, jobs.b, jobs.c].sort())
    const tl = await call('owner', 'GET', `/api/change-orders/timeline?jobId=${jobs.a}`)
    expect(JSON.stringify(tl.json)).toContain('$1,234')
    const w = await call('owner', 'PATCH', `/api/saved-jobs/${jobs.b}`, { notes: 'Owner note' })
    expect(w.status).toBe(200)
    expect((await prisma.savedJob.findUnique({ where: { id: jobs.b } })).notes).toBe('Owner note')
  })
})
