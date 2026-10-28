/**
 * A job's materials follow its Sales Order (review Oct 27 2026), against the
 * dev database (DEV_DB=1; refuses any other). Through the same save the
 * Sales Orders page makes (PATCH /api/business-state with the order list):
 *
 *   - an order marked Ordered: its job says ordered (job row, the list a
 *     second browser reads with ?since=, the Materials Confirmed milestone);
 *     a job in its own Need Drawing stage, locates in and permit not needed,
 *     keeps its board stage (Ordered only records the materials of a job
 *     still to be drawn);
 *   - a drawn job waiting in Need Drawing for its order (round 2, Oct 28
 *     2026): Ordered moves it to Materials Ordered, Received to Ready to
 *     Pull, each with a line in its history;
 *   - marked Received: the job says received; still to be drawn, it stays
 *     in Need Drawing with no move in its history (audit #50, Oct 28 2026:
 *     it went to Ready to Pull); Advance then takes it to Ready to Pull;
 *   - a job already Loaded stays Loaded when its order says Ordered (never backward);
 *   - an order found by its quote when it has no jobId;
 *   - an order put back to pending changes nothing on the job.
 *
 * Removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('materials follow the Sales Order (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: jobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: business } = await import('../src/server/routes/business-state.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { jobMilestones } = await import('../src/server/lib/jobTruth.js')

  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: { in: ['super_admin', 'admin'] as any } }, orderBy: { createdAt: 'asc' } }))!
  const accountId = user.crmAccountId!
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '30m' })
  const app = express()
  app.use(express.json({ limit: '10mb' }))
  app.use('/api/saved-jobs', jobs)
  app.use('/api/business-state', business)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  const tag = `mfo-${crypto.randomUUID().slice(0, 8)}`
  const ids = { a: '', b: '', c: '', d: '' }
  let quoteD = ''
  const quoteC = `${tag}-quote`
  const orderIds = [`${tag}-oa`, `${tag}-ob`, `${tag}-oc`, `${tag}-od`]

  const mk = (name: string, extra: Record<string, unknown>) => prisma.savedJob.create({ data: { accountId, customerName: `Testy ${tag} ${name}`, status: 'staging', ...extra } as any })
  const order = (id: string, extra: Record<string, unknown>) => ({ id, quoteName: `Test ${tag}`, customerName: `Testy ${tag}`, status: 'pending', totalCostCents: 1000, items: [], notes: '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...extra })

  /** The order list saved as the Sales Orders page saves it: the whole list, on the version it read. */
  async function mark(status: Record<string, string>) {
    const read = await call('GET', '/api/business-state')
    const list = (read.json.data.pendingOrders as any[]).map(o => (status[o?.id] ? { ...o, status: status[o.id] } : o))
    const r = await call('PATCH', '/api/business-state', { pendingOrders: list, baseVersion: read.json.data.version })
    expect(r.status).toBe(200)
  }
  const job = (id: string) => prisma.savedJob.findUniqueOrThrow({ where: { id } })

  beforeAll(async () => {
    ids.a = (await mk('A', { opsStage: 'need_drawing', locatesDate: '2026-10-20' })).id
    await prisma.permit.create({ data: { accountId, jobId: ids.a, status: 'not_needed' } })
    ids.b = (await mk('B', { materialsStatus: 'loaded' })).id
    ids.c = (await mk('C', { quoteId: quoteC })).id
    // Drawn in the quote builder, locate clear and permit in: it waits in Need Drawing for its materials order.
    quoteD = (await prisma.savedQuote.create({ data: { accountId, customerName: `Testy ${tag} D`, customerAddress: '1 Test Ln, Ocala, FL', fenceStyle: "WV-ND 6'x8' Privacy", runs: [40], pullSheet: [], finalPrice: 900, status: 'SOLD', soldAt: new Date(), layout: { yard: { sides: [] } } } as any })).id
    ids.d = (await mk('D', { opsStage: 'need_drawing', quoteId: quoteD, locateTicket: '1', locateCalledDate: '2026-10-15', locatesDate: '2026-10-20', locatesExpDate: '2099-12-31' })).id
    await prisma.permit.create({ data: { accountId, jobId: ids.d, status: 'approved' } })
    for (let i = 0; i < 10; i++) {
      const s = await prisma.businessState.findUnique({ where: { accountId } })
      const list = [order(orderIds[0], { jobId: ids.a, quoteId: `${tag}-qa` }), order(orderIds[1], { jobId: ids.b, quoteId: `${tag}-qb` }), order(orderIds[2], { quoteId: quoteC }), order(orderIds[3], { jobId: ids.d, quoteId: quoteD }), ...(((s?.pendingOrders as any[]) ?? []))]
      const d = await prisma.businessState.updateMany({ where: { accountId, version: s!.version }, data: { pendingOrders: list, version: { increment: 1 } } })
      if (d.count) break
    }
  })

  afterAll(async () => {
    for (let i = 0; i < 10; i++) {
      const s = await prisma.businessState.findUnique({ where: { accountId } })
      if (!s) break
      const d = await prisma.businessState.updateMany({ where: { accountId, version: s.version }, data: { pendingOrders: ((s.pendingOrders as any[]) ?? []).filter(o => !orderIds.includes(o?.id)), version: { increment: 1 } } })
      if (d.count) break
    }
    const jobIds = Object.values(ids).filter(Boolean)
    await prisma.permit.deleteMany({ where: { jobId: { in: jobIds } } })
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: jobIds } } })
    await prisma.automationRun.deleteMany({ where: { entityId: { in: jobIds } } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { jobId: { in: jobIds } } })
    await prisma.task.deleteMany({ where: { jobId: { in: jobIds } } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: jobIds } } })
    await prisma.activityLog.deleteMany({ where: { entityType: 'job', entityId: { in: jobIds } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: jobIds } } })
    if (quoteD) await prisma.savedQuote.deleteMany({ where: { id: quoteD } })
    server.close()
  })

  test('Ordered, then Received: the job follows; Loaded never goes back; found by quote; pending changes nothing', async () => {
    // A second browser's last read of the jobs.
    const first = await call('GET', '/api/saved-jobs')
    const since = first.json.serverTime as string
    expect((await job(ids.a)).materialsStatus).toBe('not_ordered')
    const bAt = (await job(ids.b)).updatedAt.getTime()

    await mark({ [orderIds[0]]: 'ordered', [orderIds[1]]: 'ordered', [orderIds[2]]: 'ordered' })
    const a = await job(ids.a)
    expect(a.materialsStatus).toBe('ordered')
    expect(a.opsStage).toBe('need_drawing') // Ordered does not move the card (Jonathan, Oct 27 2026)
    expect((await job(ids.b)).materialsStatus).toBe('loaded')
    expect((await job(ids.c)).materialsStatus).toBe('ordered')

    // The other browser picks it up on its next read.
    const next = await call('GET', `/api/saved-jobs?since=${encodeURIComponent(since)}`)
    const seen = (next.json.data as any[]).find(j => j.id === ids.a)
    expect(seen?.materialsStatus).toBe('ordered')
    // The Loaded job was not saved at all.
    expect((await job(ids.b)).updatedAt.getTime()).toBe(bAt)

    // The milestone says so.
    const ms = await jobMilestones(accountId, ids.a)
    expect(ms.milestones.find(m => m.label === 'Materials Confirmed')?.detail).toBe('Materials: Ordered, not received')

    // Received: recorded, but a job still to be drawn stays in Need Drawing (audit #50).
    await mark({ [orderIds[0]]: 'received' })
    const ar = await job(ids.a)
    expect([ar.opsStage, ar.materialsStatus, ar.status]).toEqual(['need_drawing', 'received', 'staging'])
    const lines = await prisma.activityLog.findMany({ where: { entityType: 'job', entityId: ids.a, metadata: { path: ['kind'], equals: 'ops.auto_move' } } })
    expect(lines).toEqual([])

    // Put back to pending: the job keeps what it has (D is looked at in its own test below).
    await mark({ [orderIds[0]]: 'pending', [orderIds[2]]: 'pending' })
    expect((await job(ids.a)).materialsStatus).toBe('received')
    expect((await job(ids.c)).materialsStatus).toBe('ordered')

    // An order Ordered again on a job already received: not backward.
    await mark({ [orderIds[0]]: 'ordered' })
    expect((await job(ids.a)).materialsStatus).toBe('received')
  }, 30_000)

  test('a drawn job waits in Need Drawing for its order: Ordered → Materials Ordered, Received → Ready to Pull', async () => {
    const lines = async () => (await prisma.activityLog.findMany({ where: { entityType: 'job', entityId: ids.d }, orderBy: { createdAt: 'asc' } })).map(l => l.body)
    expect((await job(ids.d)).opsStage).toBe('need_drawing')
    await mark({ [orderIds[3]]: 'ordered' })
    const d = await job(ids.d)
    expect([d.opsStage, d.materialsStatus, d.status]).toEqual(['materials_ordered', 'ordered', 'staging'])
    expect(await lines()).toEqual(['Moved to Materials Ordered by itself: materials ordered (Sales Order marked Ordered) and the drawing is done.'])

    // Dragged back to Need Drawing, then put back to pending and Ordered again: nothing changes (materials already ordered).
    await prisma.savedJob.update({ where: { id: ids.d }, data: { opsStage: 'need_drawing' } })
    await mark({ [orderIds[3]]: 'pending' })
    await mark({ [orderIds[3]]: 'ordered' })
    expect((await job(ids.d)).opsStage).toBe('need_drawing')

    await mark({ [orderIds[3]]: 'received' })
    const r = await job(ids.d)
    expect([r.opsStage, r.materialsStatus]).toEqual(['ready_to_pull', 'received'])
    expect((await lines()).at(-1)).toBe('Moved to Ready to Pull by itself: materials received (Sales Order marked Received).')
  }, 30_000)
})
