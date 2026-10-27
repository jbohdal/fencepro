/**
 * Automation tasks close by themselves (recheck Oct 27 2026, gap 1), against
 * the dev database (DEV_DB=1; refuses any other). The "Signed Contract" rule's
 * three tasks for a test job, and one made on the card before the job was saved:
 *
 *   - the permit set to Approved on the Permit panel closes "File the fence permit";
 *   - Schedule (a start date on the job) closes "Schedule the install";
 *   - materials marked Ordered close "Order materials";
 *   - the job Paid closes what is still open, and a follow up task is left alone;
 *   - each says it was closed by itself, and why.
 *
 * Also a repair's "Schedule the install for {name}" task is made as "Schedule the repair for …".
 * Removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('automation tasks close by themselves (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: jobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: automations } = await import('../src/server/routes/automations.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { closeFinishedTasks } = await import('../src/server/lib/taskAutoClose.js')
  const { runStep } = await import('../src/server/lib/automations/steps.js')

  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: { in: ['super_admin', 'admin'] as any } }, orderBy: { createdAt: 'asc' } }))!
  const accountId = user.crmAccountId!
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '30m' })
  const app = express()
  app.use(express.json())
  app.use('/api/saved-jobs', jobs)
  app.use('/api/automations', automations)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  const tag = `tac-${crypto.randomUUID().slice(0, 8)}`
  const name = `Testy ${tag}`
  const jobIds: string[] = []
  const cardId = `${tag}-card`
  let jobId = ''

  const task = (title: string, onId: string) => prisma.task.create({ data: { title, jobId: onId, jobName: name, createdBy: `automation:${tag}:0`, automationId: null, dueDate: new Date(), priority: 'normal' } })
  const read = (id: string) => prisma.task.findUniqueOrThrow({ where: { id } })
  /** The close comes a moment after the save (closeTasksSoon): look until it is there. */
  async function closedSoon(id: string) {
    for (let i = 0; i < 40; i++) {
      const t = await read(id)
      if (t.status === 'completed') return t
      await new Promise(r => setTimeout(r, 150))
    }
    return read(id)
  }

  beforeAll(async () => {
    const j = await call('POST', '/api/saved-jobs', { customerName: name, customerAddress: '100 Pecan Dr, Ocala, FL 34472', fenceStyle: 'WV-6ft Privacy', sections: 12, contractValue: 4800, status: 'staging' })
    expect(j.status).toBe(201)
    jobId = j.json.data.id
    jobIds.push(jobId)
  })

  afterAll(async () => {
    await prisma.task.deleteMany({ where: { createdBy: { startsWith: `automation:${tag}` } } })
    await prisma.permit.deleteMany({ where: { jobId: { in: jobIds } } })
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: jobIds } } })
    await prisma.notification.deleteMany({ where: { jobId: { in: jobIds } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: jobIds } } })
    server.close()
  })

  test('each task closes when its job says it is done, and says why', async () => {
    const permit = await task(`File the fence permit for ${name}`, jobId)
    const schedule = await task(`Schedule the install for ${name}`, jobId)
    const materials = await task(`Order materials for ${name}`, jobId)
    const followUp = await task(`Follow up with ${name} (2 days, no answer)`, jobId)

    // Nothing is done yet: a sweep closes nothing of this job's.
    const none = await closeFinishedTasks({ jobIds: [jobId] })
    expect(none.closed).toEqual([])

    // Applied is not enough; Approved closes the permit task.
    expect((await call('PUT', `/api/automations/permits/${jobId}`, { status: 'applied' })).status).toBe(200)
    await new Promise(r => setTimeout(r, 2000))
    expect((await read(permit.id)).status).toBe('pending')
    expect((await call('PUT', `/api/automations/permits/${jobId}`, { status: 'approved', approvedAt: '2026-10-27' })).status).toBe(200)
    const p = await closedSoon(permit.id)
    expect(p.status).toBe('completed')
    expect(p.completedAt).not.toBeNull()
    expect(p.description).toMatch(/Closed by itself on \d{2}\/\d{2}\/\d{4}: the permit is Approved\.$/)
    expect((await read(schedule.id)).status).toBe('pending')

    // A start date on the job closes "Schedule the install".
    expect((await call('PATCH', `/api/saved-jobs/${jobId}`, { scheduledDate: '2026-11-02', crewAssigned: 'Crew 1' })).status).toBe(200)
    const s = await closedSoon(schedule.id)
    expect(s.status).toBe('completed')
    expect(s.description).toMatch(/the job is scheduled to start 11\/02\/2026\.$/)

    // Materials marked ordered close "Order materials".
    expect((await call('PATCH', `/api/saved-jobs/${jobId}`, { materialsStatus: 'ordered' })).status).toBe(200)
    expect((await closedSoon(materials.id)).description).toMatch(/materials are marked Ordered on the job\.$/)

    // A task that asks for nothing the job records stays open.
    expect((await read(followUp.id)).status).toBe('pending')
  }, 30_000)

  test('a task made on the card before the job, and the job Paid: closed', async () => {
    // The card points at the job (as the app stamps it); the task was made on the card id.
    for (let i = 0; i < 10; i++) {
      const st = await prisma.pipelineState.findUnique({ where: { accountId } })
      if (!st) break
      const leads = [...((st.leads as any[]) ?? []), { id: cardId, firstName: 'Testy', lastName: tag, stage: 'Signed Contract', jobId }]
      const d = await prisma.pipelineState.updateMany({ where: { accountId, version: st.version }, data: { leads, version: { increment: 1 } } })
      if (d.count) break
    }
    try {
      const onCard = await task(`Order materials for ${name}`, cardId)
      const r = await closeFinishedTasks({ jobIds: [jobId] })
      expect(r.closed.map(c => c.taskId)).toContain(onCard.id)
      expect((await read(onCard.id)).status).toBe('completed')

      // A dry run says what it would close and writes nothing.
      const later = await task(`File the fence permit for ${name}`, jobId)
      await prisma.permit.update({ where: { jobId }, data: { status: 'needed' } })
      await prisma.savedJob.update({ where: { id: jobId }, data: { status: 'paid' } })
      const dry = await closeFinishedTasks({ jobIds: [jobId], dryRun: true })
      expect(dry.closed.find(c => c.taskId === later.id)?.reason).toBe('the job is Paid')
      expect((await read(later.id)).status).toBe('pending')
      await closeFinishedTasks({ jobIds: [jobId] })
      expect((await read(later.id)).description).toMatch(/: the job is Paid\.$/)
    } finally {
      for (let i = 0; i < 10; i++) {
        const st = await prisma.pipelineState.findUnique({ where: { accountId } })
        if (!st) break
        const d = await prisma.pipelineState.updateMany({ where: { accountId, version: st.version }, data: { leads: ((st.leads as any[]) ?? []).filter(l => l?.id !== cardId), version: { increment: 1 } } })
        if (d.count) break
      }
    }
  }, 30_000)

  test('a repair job\'s "Schedule the install for {name}" is made as "Schedule the repair for …"', async () => {
    const entity = { board: 'ops', entityKind: 'job', entityId: jobId, card: null, job: { id: jobId }, name, firstName: 'Testy', lastName: tag, work: { type: 'repair' } } as any
    const step = { type: 'create_task', title: 'Schedule the install for {name}', description: '{address}', assignTo: '', dueInDays: 2 } as const
    const out = await runStep({ accountId, runId: tag, ruleId: tag, ruleName: 'test', stepIndex: 0, step, entity, now: new Date() })
    expect(out.detail).toContain(`"Schedule the repair for ${name}"`)
    const made = await prisma.task.findFirst({ where: { createdBy: `automation:${tag}:0`, title: { startsWith: 'Schedule the repair' } } })
    expect(made?.title).toBe(`Schedule the repair for ${name}`)
    await prisma.automationEffect.deleteMany({ where: { runId: tag } })
  })
})
