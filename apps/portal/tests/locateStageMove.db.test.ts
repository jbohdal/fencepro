/**
 * A job waiting on its 811 locate or permit moves on once they are in (review
 * Oct 27 2026: a signed job stayed in Awaiting Locates after the office entered
 * its 811 ticket, Clear to dig, and an Approved permit). Against the dev
 * database (DEV_DB=1; refuses any other), through the same saves the job page
 * makes (PUT /api/saved-jobs/:id/locate, PUT /api/automations/permits/:jobId):
 *
 *   - locate in, permit not set: Awaiting Locates → Permit Pending; permit
 *     Approved: → Need Drawing; a second browser reads it with ?since=;
 *   - permit Approved first: stays in Awaiting Locates until the locate is in;
 *   - a repair (permit Not needed) is never put in Need Drawing: it stays;
 *   - a job the office put in Materials Ordered stays there (never backward);
 *   - materials already ordered: Awaiting Locates → Materials Ordered.
 *
 * Removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('the job leaves Awaiting Locates once the 811 locate and permit are in (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: jobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: automations } = await import('../src/server/routes/automations.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')

  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: { in: ['super_admin', 'admin'] as any } }, orderBy: { createdAt: 'asc' } }))!
  const accountId = user.crmAccountId!
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '30m' })
  const app = express()
  app.use(express.json({ limit: '5mb' }))
  app.use('/api/saved-jobs', jobs)
  app.use('/api/automations', automations)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  const tag = `lsm-${crypto.randomUUID().slice(0, 8)}`
  const made = { jobs: [] as string[], quotes: [] as string[] }
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
  const locate = { ticket: '302610270001', calledDate: today, goodDate: today, expDate: '2099-12-31' }
  const permit = (status: string) => ({ status })

  async function mk(name: string, extra: Record<string, unknown>, work?: unknown) {
    let quoteId: string | undefined
    if (work) {
      const q = await prisma.savedQuote.create({ data: { accountId, customerName: `Testy ${tag} ${name}`, customerAddress: '1 Test Ln, Ocala, FL', fenceStyle: "WV-ND 6'x8' Privacy", runs: [40], pullSheet: [], finalPrice: 900, status: 'SOLD', soldAt: new Date(), work } as any })
      made.quotes.push(q.id)
      quoteId = q.id
    }
    const j = await prisma.savedJob.create({ data: { accountId, customerName: `Testy ${tag} ${name}`, status: 'staging', opsStage: 'awaiting_locates', ...(quoteId ? { quoteId } : {}), ...extra } as any })
    made.jobs.push(j.id)
    return j.id
  }
  const job = (id: string) => prisma.savedJob.findUniqueOrThrow({ where: { id } })

  afterAll(async () => {
    await prisma.permit.deleteMany({ where: { jobId: { in: made.jobs } } })
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: made.jobs } } })
    await prisma.automationRun.deleteMany({ where: { entityId: { in: made.jobs } } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { jobId: { in: made.jobs } } })
    await prisma.task.deleteMany({ where: { jobId: { in: made.jobs } } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: made.jobs } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: made.jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    server.close()
  })

  test('locate in, then the permit Approved: Awaiting Locates → Permit Pending → Need Drawing; another browser sees it', async () => {
    const id = await mk('A', {})
    const first = await call('GET', '/api/saved-jobs')
    const since = first.json.serverTime as string

    const r = await call('PUT', `/api/saved-jobs/${id}/locate`, locate)
    expect(r.status).toBe(200)
    expect(r.json.data.opsStage).toBe('permit_pending')
    expect((await job(id)).opsStage).toBe('permit_pending')

    const p = await call('PUT', `/api/automations/permits/${id}`, permit('approved'))
    expect(p.status).toBe(200)
    const after = await job(id)
    expect([after.opsStage, after.status, after.materialsStatus, after.drawingComplete]).toEqual(['need_drawing', 'staging', 'not_ordered', false])

    const next = await call('GET', `/api/saved-jobs?since=${encodeURIComponent(since)}`)
    expect((next.json.data as any[]).find(j => j.id === id)?.opsStage).toBe('need_drawing')
    // The moves are on record (stage moves for automations, the audit log).
    const entered = await prisma.automationEvent.findMany({ where: { entityId: id, type: 'card_entered' } })
    expect(entered.map(e => (e.data as any).stage).sort()).toEqual(['need_drawing', 'permit_pending'])
  })

  test('the permit Approved first: it waits in Awaiting Locates until the locate is in', async () => {
    const id = await mk('B', {})
    expect((await call('PUT', `/api/automations/permits/${id}`, permit('approved'))).status).toBe(200)
    expect((await job(id)).opsStage).toBe('awaiting_locates')
    await call('PUT', `/api/saved-jobs/${id}/locate`, locate)
    expect((await job(id)).opsStage).toBe('need_drawing')
  })

  test('a repair (permit Not needed) is not put in Need Drawing: it stays', async () => {
    const id = await mk('C', {}, { type: 'repair' })
    await call('PUT', `/api/saved-jobs/${id}/locate`, locate)
    const j = await job(id)
    expect(j.locatesDate).toBe(today)
    expect(j.opsStage).toBe('awaiting_locates')
  })

  test('never backward: a job the office put in Materials Ordered stays there', async () => {
    const id = await mk('D', { opsStage: 'materials_ordered' })
    await call('PUT', `/api/saved-jobs/${id}/locate`, locate)
    expect((await job(id)).opsStage).toBe('materials_ordered')
  })

  test('materials already ordered, permit Not needed: Awaiting Locates → Materials Ordered', async () => {
    const id = await mk('E', { materialsStatus: 'ordered' })
    await prisma.permit.create({ data: { accountId, jobId: id, status: 'not_needed' } })
    await call('PUT', `/api/saved-jobs/${id}/locate`, locate)
    expect((await job(id)).opsStage).toBe('materials_ordered')
  })
})
