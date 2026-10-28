/**
 * Jonathan, Oct 26 2026: "Repairs: permit defaults to Not needed (office can
 * change it), no reminders unless set to Needed." Against the dev database
 * (DEV_DB=1; refuses any other). A repair job, a new fence job and a fence
 * move job are made on quotes of their kind; everything made is removed.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('a repair job\'s permit starts Not needed (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: jobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: automations } = await import('../src/server/routes/automations.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { runStep, describeSteps } = await import('../src/server/lib/automations/steps.js')
  const { buildContext } = await import('../src/server/lib/automations/context.js')
  const { ensurePermit, defaultPermitStatus } = await import('../src/server/lib/automations/permits.js')

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

  const tag = `permit-default-${crypto.randomUUID().slice(0, 8)}`
  const made = { quotes: [] as string[], jobs: [] as string[], contact: '' }

  async function jobOfKind(kind: 'repair' | 'move' | null) {
    if (!made.contact) made.contact = (await prisma.crmContact.create({ data: { accountId, firstName: 'Permit', lastName: tag, serviceAddress: '100 Pecan Dr, Ocala, FL 34472' } as any })).id
    const q = await prisma.savedQuote.create({ data: {
      accountId, crmContactId: made.contact, customerName: `Permit ${tag} ${kind ?? 'new'}`, customerAddress: '100 Pecan Dr, Ocala, FL 34472', fenceStyle: "WV-ND 6'x8' Privacy",
      runs: [40], pullSheet: [], finalPrice: 900, status: 'SOLD', soldAt: new Date(), ...(kind ? { work: { type: kind } } : {}),
    } as any })
    made.quotes.push(q.id)
    const j = await call('POST', '/api/saved-jobs', { customerName: `Permit ${tag} ${kind ?? 'new'}`, customerAddress: '100 Pecan Dr, Ocala, FL 34472', crmContactId: made.contact, quoteId: q.id, fenceStyle: "WV-ND 6'x8' Privacy", sections: 5, contractValue: 900, status: 'staging' })
    expect(j.status).toBe(201)
    made.jobs.push(j.json.data.id)
    await prisma.automationEvent.updateMany({ where: { entityId: j.json.data.id }, data: { processedAt: new Date() } })
    return j.json.data.id as string
  }

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { title: { contains: tag } } })
    await prisma.notification.deleteMany({ where: { jobId: { in: made.jobs } } })
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: made.jobs } } })
    await prisma.permit.deleteMany({ where: { jobId: { in: made.jobs } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: made.jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    if (made.contact) await prisma.crmContact.deleteMany({ where: { id: made.contact } })
    server.close()
  })

  test('the default: Not needed for a repair, Needed for a new fence and a fence move', () => {
    expect(defaultPermitStatus({ type: 'repair' })).toBe('not_needed')
    expect(defaultPermitStatus({ type: 'move' })).toBe('needed')
    expect(defaultPermitStatus(null)).toBe('needed')
    expect(defaultPermitStatus({})).toBe('needed')
  })

  test('a repair: the Permit panel shows Not needed; the Signed Contract step makes it Not needed with no packet and no filing task; the office can set it to Needed', async () => {
    const jobId = await jobOfKind('repair')
    const shown = await call('GET', `/api/automations/permits/${jobId}`)
    expect([shown.status, shown.json.data.permit, shown.json.data.defaultStatus]).toEqual([200, null, 'not_needed'])

    const ctx = (await buildContext(accountId, 'ops', jobId))!
    const step = { type: 'permit_packet', assignTo: '' }
    const dry = await describeSteps(accountId, [step as any], ctx, new Date())
    expect(dry[0].would).toMatch(/^nothing: the permit is Not needed/)
    const out = await runStep({ accountId, runId: `${tag}-run`, ruleId: `${tag}-rule`, ruleName: tag, stepIndex: 0, step: step as any, entity: ctx, now: new Date() })
    expect(out.detail).toMatch(/^permit Not needed/)
    expect(out.link).toBeUndefined()
    const row = await prisma.permit.findUnique({ where: { jobId } })
    expect([row?.status, row?.updatedBy]).toEqual(['not_needed', 'automation'])
    expect(await prisma.task.count({ where: { createdBy: { startsWith: `automation:${tag}-run:` } } })).toBe(0)

    // The office changes it: Needed is kept (the step never sets it back).
    const put = await call('PUT', `/api/automations/permits/${jobId}`, { status: 'needed', county: 'Marion' })
    expect([put.status, put.json.data.permit.status]).toEqual([200, 'needed'])
    expect((await ensurePermit(accountId, jobId)).status).toBe('needed')
  })

  test('one source: with no permit record, Advance (the board summary), the Schedule window and the stage check all read a repair as Not needed; a new fence stays Not set', async () => {
    const { milestoneSummary } = await import('../src/server/lib/jobTruth.js')
    const { jobScheduleFacts } = await import('../src/server/lib/installScheduling.js')
    const { permitStatusesOf } = await import('../src/server/lib/permitStatus.js')
    const { missingFor } = await import('../src/server/lib/automations/stageRules.js')
    const repair = await jobOfKind('repair')
    const fence = await jobOfKind(null)
    expect(await prisma.permit.count({ where: { jobId: { in: [repair, fence] } } })).toBe(0)

    const quoteOf = async (id: string) => (await prisma.savedJob.findUnique({ where: { id }, select: { quoteId: true } }))!.quoteId
    const st = await permitStatusesOf(accountId, [{ id: repair, quoteId: await quoteOf(repair) }, { id: fence, quoteId: await quoteOf(fence) }])
    expect([st.get(repair), st.get(fence)]).toEqual(['not_needed', null])

    const sum = await milestoneSummary(accountId)
    expect([sum[repair]?.permitOk, sum[fence]?.permitOk]).toEqual([true, false])
    expect((await jobScheduleFacts(accountId, repair))?.permitStatus).toBe('not_needed')
    expect((await jobScheduleFacts(accountId, fence))?.permitStatus).toBe(null)
    const rj = await prisma.savedJob.findUnique({ where: { id: repair } })
    expect(await missingFor(accountId, ['permit_approved'], rj, null)).toEqual([])

    // The office sets the repair's permit to Needed: every reader follows the record.
    await call('PUT', `/api/automations/permits/${repair}`, { status: 'needed', county: 'Marion' })
    expect((await milestoneSummary(accountId))[repair]?.permitOk).toBe(false)
    expect((await jobScheduleFacts(accountId, repair))?.permitStatus).toBe('needed')
  })

  test('a new fence and a fence move: the panel reads Not set (null, as every screen does) until saved; the automation makes it Needed', async () => {
    for (const kind of [null, 'move'] as const) {
      const jobId = await jobOfKind(kind)
      expect((await call('GET', `/api/automations/permits/${jobId}`)).json.data.defaultStatus).toBeNull()
      expect((await ensurePermit(accountId, jobId)).status).toBe('needed')
    }
  })
})
