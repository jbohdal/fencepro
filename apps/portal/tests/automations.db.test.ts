/**
 * Pipeline automations against the dev database (DEV_DB=1; refuses any other).
 *
 * A test customer, pipeline card and Operations job are made, rules are made
 * switched on for the test only, and the worker is driven by hand with a
 * pretend clock (tick(now)), so settle times, waits, retries and missed time
 * triggers are tested without waiting. Everything made is removed at the end.
 *
 * Covers: each trigger type (moved in, moved out, days in a stage, days before
 * a date, events), retries with backoff, no duplicates when a card is dragged
 * back and forth, catch up after downtime, stage rules, a crash in the middle
 * of a run, dry run doing nothing, email through a fake Gmail, push through a
 * fake push service.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import http from 'http'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('automations (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: pipeline } = await import('../src/server/routes/pipeline.js')
  const { default: jobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: automations } = await import('../src/server/routes/automations.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const Q = await import('../src/server/lib/automations/queue.js')
  const { recordEvent } = await import('../src/server/lib/automationEvents.js')
  const { recordPhotoUploaded } = await import('../src/server/lib/automations/hooks.js')
  const { setEmailSenderForTests } = await import('../src/server/lib/automations/gmail.js')
  const { setPushSenderForTests } = await import('../src/server/lib/automations/push.js')
  const { setWalkthroughForTests } = await import('../src/server/lib/automations/walkthroughAdapter.js')
  const { runStep } = await import('../src/server/lib/automations/steps.js')
  const { buildContext, floridaDay } = await import('../src/server/lib/automations/context.js')

  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: { in: ['super_admin', 'admin'] as any } }, orderBy: { createdAt: 'asc' } }))!
  const accountId = user.crmAccountId!
  const token = jwt.sign({ sub: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '30m' })

  const app = express()
  app.use(express.json({ limit: '20mb' }))
  app.use('/api/pipeline', pipeline)
  app.use('/api/saved-jobs', jobs)
  app.use('/api/automations', automations)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  // What the tests make.
  const tag = `auto-test-${crypto.randomUUID().slice(0, 8)}`
  const ruleIds: string[] = []
  const cardIds: string[] = []
  const jobIds: string[] = []
  let contactId = ''
  const emails: Array<{ to: string; subject: string }> = []
  const pushes: string[] = []

  const MIN = 60_000
  const later = (ms: number) => new Date(Date.now() + ms)

  async function makeRule(r: { name?: string; board: 'sales' | 'ops'; trigger: any; conditions?: any[]; steps: any[] }) {
    const row = await prisma.automationRule.create({ data: { accountId, name: `${tag} ${r.name ?? 'rule'}`, board: r.board, enabled: true, enabledAt: new Date(Date.now() - 3600_000), trigger: r.trigger, conditions: r.conditions ?? [], steps: r.steps } })
    ruleIds.push(row.id)
    return row
  }
  async function pause(id: string) { await prisma.automationRule.update({ where: { id }, data: { enabled: false } }) }
  async function addCard(stage: string, extra: Record<string, unknown> = {}) {
    const id = `${tag}-${cardIds.length}`
    cardIds.push(id)
    const lead = { id, firstName: 'Testy', lastName: `Automation ${cardIds.length}`, phone: '352-555-0100', email: 'testy@example.com', address: '100 Pecan Dr, Ocala, FL 34472', stage, customerId: contactId, lastMoved: floridaDay(new Date()), createdAt: floridaDay(new Date()), ...extra }
    const r = await patchPipeline(() => ({ upsert: [{ lead, before: null }], remove: [] }))
    expect(r.status).toBe(200)
    return id
  }
  /** Other test files save the same pipeline at the same time: build on the newest copy, as the app does. */
  async function patchPipeline(delta: (leads: any[]) => unknown) {
    for (let i = 0; ; i++) {
      const p = await call('GET', '/api/pipeline')
      const r = await call('PATCH', '/api/pipeline', { ...(delta(p.json.data.leads) as object), baseVersion: p.json.data.version })
      if (r.status !== 409 || r.json?.code !== 'STALE_VERSION' || i > 10) return r
    }
  }
  async function move(cardId: string, stage: string) {
    return patchPipeline(leads => ({ upsert: [{ lead: { ...leads.find(l => l.id === cardId), stage } }], remove: [] }))
  }
  const tasksOf = (ruleId: string) => prisma.task.findMany({ where: { automationId: ruleId } })
  const runsOf = (ruleId: string) => prisma.automationRun.findMany({ where: { ruleId }, orderBy: { createdAt: 'asc' } })

  beforeAll(async () => {
    Q.stopAutomationWorkerForTests()
    setEmailSenderForTests({ from: 'test@example.com', async send(m) { emails.push({ to: m.to, subject: m.subject }); return { id: `fake-${emails.length}` } } })
    setPushSenderForTests({ async send(sub) { pushes.push(sub.endpoint) } })
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Testy', lastName: tag, email: 'testy@example.com', phone: '352-555-0100', serviceAddress: '100 Pecan Dr, Ocala, FL 34472', city: 'Ocala', tags: ['Residential'] } as any })
    contactId = c.id
    const j = await call('POST', '/api/saved-jobs', { customerName: `Testy ${tag}`, customerEmail: 'testy@example.com', customerPhone: '352-555-0100', customerAddress: '100 Pecan Dr, Ocala, FL 34472', crmContactId: contactId, fenceStyle: 'WV-6ft Privacy', sections: 12, contractValue: 4800, status: 'staging' })
    expect(j.status).toBe(201)
    jobIds.push(j.json.data.id)
    // Events from the job's creation are not this test's business.
    await prisma.automationEvent.updateMany({ where: { entityId: j.json.data.id }, data: { processedAt: new Date() } })
  })

  afterAll(async () => {
    setEmailSenderForTests(undefined); setPushSenderForTests(null); setWalkthroughForTests(null)
    const runs = await prisma.automationRun.findMany({ where: { ruleId: { in: ruleIds } }, select: { id: true } })
    const runIds = runs.map(r => r.id)
    await prisma.task.deleteMany({ where: { OR: [{ automationId: { in: ruleIds } }, ...runIds.map(id => ({ createdBy: { startsWith: `automation:${id}` } }))] } })
    await prisma.notification.deleteMany({ where: { OR: [{ jobId: { in: jobIds } }, { title: { contains: tag } }, { body: { contains: tag } }] } })
    await prisma.automationEffect.deleteMany({ where: { runId: { in: runIds } } })
    await prisma.automationRun.deleteMany({ where: { ruleId: { in: ruleIds } } })
    await prisma.automationRule.deleteMany({ where: { id: { in: ruleIds } } })
    await prisma.automationEvent.deleteMany({ where: { OR: [{ entityId: { in: [...cardIds, ...jobIds, contactId] } }, { dedupeKey: { contains: tag } }] } })
    await prisma.stageRule.deleteMany({ where: { accountId, stage: { in: ['Pending Start', 'completed'] }, starter: null } })
    await prisma.stageRule.updateMany({ where: { accountId, starter: { not: null } }, data: { enabled: false } })
    await prisma.permit.deleteMany({ where: { jobId: { in: jobIds } } })
    // Only onto the copy it read (other test files save the board at the same time).
    for (let i = 0; i < 10; i++) {
      const p = await prisma.pipelineState.findUnique({ where: { accountId } })
      if (!p) break
      const done = await prisma.pipelineState.updateMany({ where: { accountId, version: p.version }, data: { leads: ((p.leads as any[]) ?? []).filter(l => !cardIds.includes(l?.id)), version: { increment: 1 } } })
      if (done.count) break
    }
    await prisma.savedJob.deleteMany({ where: { id: { in: jobIds } } })
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { contains: tag } } })
    await prisma.crmContact.deleteMany({ where: { id: contactId } })
    server.close()
  })

  test('moved into a stage: event saved with the move, runs after the settle time, logged on the card', async () => {
    const rule = await makeRule({ name: 'entered Estimating', board: 'sales', trigger: { type: 'card_entered', stage: 'Estimating', settleMinutes: 2, onlyWhileInStage: true }, steps: [{ type: 'create_task', title: 'Measure {first name} at {address}', description: '', assignTo: '', dueInDays: 1 }] })
    const card = await addCard('First Contact')
    expect((await move(card, 'Estimating')).status).toBe(200)
    expect(await prisma.automationEvent.count({ where: { entityId: card, type: 'card_entered' } })).toBe(2) // added, then moved
    await Q.tick(new Date(), { scan: false })
    expect((await runsOf(rule.id))[0].status).toBe('queued') // settling
    expect(await tasksOf(rule.id)).toHaveLength(0)
    await Q.tick(later(3 * MIN), { scan: false })
    // Another test file's clean up can put the whole board back from an older copy while this runs; then the
    // card really left Estimating and the run is rightly skipped. Move it again and check once more.
    for (let i = 0; i < 3 && (await tasksOf(rule.id)).length === 0; i++) {
      await prisma.automationRun.deleteMany({ where: { ruleId: rule.id, status: 'skipped' } })
      await move(card, 'First Contact'); await move(card, 'Estimating')
      await Q.tick(later((4 + i) * MIN), { scan: false })
    }
    const tasks = await tasksOf(rule.id)
    expect(tasks, JSON.stringify((await runsOf(rule.id)).map(r => [r.status, r.log]))).toHaveLength(1)
    expect(tasks[0].title).toBe('Measure Testy at 100 Pecan Dr, Ocala, FL 34472')
    const log = await call('GET', `/api/automations/runs?entityId=${card}`)
    expect(log.json.data[0].status).toBe('succeeded')
    expect(log.json.data[0].ruleName).toContain('entered Estimating')
    expect(log.json.data[0].log.some((l: any) => l.result === 'done' && /task made/.test(l.detail))).toBe(true)
    await pause(rule.id)
  })

  test('dragged back and forth quickly: one run, and not again for the same stage within 24 hours', async () => {
    const rule = await makeRule({ name: 'entered Appointment', board: 'sales', trigger: { type: 'card_entered', stage: 'Appointment', settleMinutes: 2, onlyWhileInStage: true }, steps: [{ type: 'create_task', title: 'Confirm {name}', description: '', assignTo: '', dueInDays: 0 }] })
    const card = await addCard('First Contact')
    for (const s of ['Appointment', 'First Contact', 'Appointment', 'First Contact', 'Appointment']) expect((await move(card, s)).status).toBe(200)
    await Q.tick(later(3 * MIN), { scan: false })
    expect(await tasksOf(rule.id)).toHaveLength(1)
    const runs = await runsOf(rule.id)
    expect(runs.filter(r => r.status === 'succeeded')).toHaveLength(1)
    expect(runs.filter(r => r.status === 'skipped').length).toBe(runs.length - 1)
    // Away and back an hour later: still once in 24 hours.
    await move(card, 'First Contact'); await move(card, 'Appointment')
    await Q.tick(later(10 * MIN), { scan: false })
    expect(await tasksOf(rule.id)).toHaveLength(1)
    // Left before the settle time was up: nothing.
    const card2 = await addCard('First Contact')
    await move(card2, 'Appointment'); await move(card2, 'First Contact')
    await Q.tick(later(3 * MIN), { scan: false })
    const r2 = (await prisma.automationRun.findMany({ where: { ruleId: rule.id, entityId: card2 } }))
    expect(r2.every(r => r.status === 'skipped')).toBe(true)
    await pause(rule.id)
  }, 30_000) // a full run on the shared dev copy can take longer than the default 5 s

  test('moved out of a stage, with conditions', async () => {
    const rule = await makeRule({
      name: 'left Pending Signature', board: 'sales', trigger: { type: 'card_left', stage: 'Pending Signature' },
      conditions: [{ field: 'city', op: 'is', value: 'Ocala' }, { field: 'tag', op: 'has', value: 'Residential' }],
      steps: [{ type: 'notify', title: `${tag} {name} left Pending Signature`, body: 'now {stage}', push: false }],
    })
    const card = await addCard('Pending Signature')
    await move(card, 'Lost Sale')
    await Q.tick(new Date(), { scan: false })
    const n = await prisma.notification.findMany({ where: { title: { contains: tag } } })
    expect(n).toHaveLength(1)
    expect(n[0].body).toBe('now Lost Sale')
    // A condition not met: skipped, and the log says why.
    await prisma.automationRule.update({ where: { id: rule.id }, data: { conditions: [{ field: 'county', op: 'is', value: 'Lake' }] } })
    await move(card, 'Pending Signature'); await move(card, 'Estimating')
    await Q.tick(new Date(), { scan: false })
    const last = (await runsOf(rule.id)).at(-1)!
    expect(last.status).toBe('skipped')
    expect(JSON.stringify(last.log)).toMatch(/Conditions not met: county is Marion/)
    await pause(rule.id)
  })

  test('in a stage for X days: fires once when due, catches up after downtime, never twice', async () => {
    const rule = await makeRule({ name: '3 days in Job Prep', board: 'sales', trigger: { type: 'in_stage_days', stage: 'Job Prep', days: 3 }, steps: [{ type: 'create_task', title: 'Job Prep is slow for {name}', description: '', assignTo: '', dueInDays: 0 }] })
    const card = await addCard('Job Prep')
    expect(await Q.scanTimeTriggers(later(1 * 86_400_000))).toBe(0)
    // The app was down from day 2 to day 6: on start it catches up, once.
    const made = await prisma.automationEvent.count({ where: { entityId: card, type: 'time' } })
    expect(made).toBe(0)
    await Q.tick(later(6 * 86_400_000), { scan: true })
    await Q.tick(later(6 * 86_400_000 + 5 * MIN), { scan: true })
    await Q.tick(later(7 * 86_400_000), { scan: true })
    expect(await prisma.automationEvent.count({ where: { entityId: card, type: 'time', data: { path: ['ruleId'], equals: rule.id } } })).toBe(1)
    expect(await tasksOf(rule.id)).toHaveLength(1)
    await pause(rule.id)
  })

  test('X days before the install date: email from Gmail (fake), caught up once; Gmail not connected fails clearly, retries with backoff, Run again', async () => {
    const jobId = jobIds[0]
    const install = floridaDay(later(5 * 86_400_000))
    await call('PATCH', `/api/saved-jobs/${jobId}`, { scheduledDate: install, status: 'scheduled' })
    await prisma.automationEvent.updateMany({ where: { entityId: jobId, processedAt: null }, data: { processedAt: new Date() } })
    const rule = await makeRule({ name: '2 days before install', board: 'ops', trigger: { type: 'date_offset', dateField: 'install', days: 2, when: 'before' }, steps: [{ type: 'email_customer', subject: `${tag} install on {install date}`, body: 'Hi {first name}, see you {install date}.' }] })
    await Q.tick(later(1 * 86_400_000), { scan: true })
    expect(emails.filter(e => e.subject.includes(tag))).toHaveLength(0)
    // Down on the due day (day 3), back on day 4: it goes once.
    await Q.tick(later(4 * 86_400_000), { scan: true })
    await Q.tick(later(4 * 86_400_000 + 10 * MIN), { scan: true })
    const sent = emails.filter(e => e.subject.includes(tag))
    expect(sent).toHaveLength(1)
    expect(sent[0].to).toBe('testy@example.com')
    expect(sent[0].subject).toMatch(/install on \w+day, \w+ \d+/)
    await pause(rule.id)

    // Gmail not connected: the step fails with that reason after its retries, then Jonathan is told.
    setEmailSenderForTests(null)
    const r2 = await makeRule({ name: 'email on photo', board: 'ops', trigger: { type: 'event', event: 'photo_uploaded' }, steps: [{ type: 'email_customer', subject: `${tag} photo`, body: 'A photo was added.' }] })
    const t0 = later(10 * 86_400_000)
    await recordEvent({ accountId, type: 'photo_uploaded', board: 'ops', entityKind: 'job', entityId: jobId, data: { jobId }, dedupeKey: `${tag}:photo:1`, occurredAt: t0 })
    await Q.tick(t0, { scan: false })
    let run = (await runsOf(r2.id))[0]
    expect(run.status).toBe('queued')
    expect(run.attempts).toBe(1)
    expect(run.lastError).toMatch(/Gmail is not connected/)
    expect(run.nextRunAt.getTime() - t0.getTime()).toBe(60_000)
    const waits: number[] = []
    let clock = t0
    for (let i = 0; i < 6 && run.status === 'queued'; i++) {
      clock = new Date(run.nextRunAt.getTime())
      await Q.tick(clock, { scan: false })
      const next = (await runsOf(r2.id))[0]
      if (next.status === 'queued') waits.push(next.nextRunAt.getTime() - clock.getTime())
      run = next
    }
    expect(waits).toEqual([5 * MIN, 15 * MIN, 60 * MIN])
    expect(run.status).toBe('failed')
    expect(run.attempts).toBe(5)
    const told = await prisma.notification.findMany({ where: { link: `/automations?run=${run.id}` } })
    expect(told).toHaveLength(1)
    expect(told[0].body).toMatch(/Gmail is not connected/)
    // Connected now: Run again sends it once.
    setEmailSenderForTests({ from: 'test@example.com', async send(m) { emails.push({ to: m.to, subject: m.subject }); return { id: 'x' } } })
    expect((await call('POST', `/api/automations/runs/${run.id}/run-again`)).status).toBe(200)
    await Q.tick(new Date(clock.getTime() + MIN), { scan: false })
    expect((await runsOf(r2.id))[0].status).toBe('succeeded')
    expect(emails.filter(e => e.subject === `${tag} photo`)).toHaveLength(1)
    await pause(r2.id)
  })

  test('events: payment received (saved on the job), photo uploaded, proposal accepted, walkthrough signed', async () => {
    const jobId = jobIds[0]
    const rules = await Promise.all((['payment_received', 'photo_uploaded', 'proposal_accepted', 'walkthrough_signed'] as const).map(ev =>
      makeRule({ name: `on ${ev}`, board: 'ops', trigger: { type: 'event', event: ev }, steps: [{ type: 'create_task', title: `${ev} for {name}`, description: '', assignTo: '', dueInDays: 0 }] })))
    expect((await call('PATCH', `/api/saved-jobs/${jobId}`, { amountPaid: 1200, paymentStatus: 'partial' })).status).toBe(200)
    // The same save again is not a second payment.
    expect((await call('PATCH', `/api/saved-jobs/${jobId}`, { amountPaid: 1200, paymentStatus: 'partial' })).status).toBe(200)
    await recordPhotoUploaded(accountId, { id: crypto.randomUUID(), clientId: `${tag}-photo`, jobId })
    await recordEvent({ accountId, type: 'proposal_accepted', board: 'sales', entityKind: 'quote', entityId: `${tag}-quote`, data: { customerId: contactId }, dedupeKey: `${tag}:accepted` })
    await recordEvent({ accountId, type: 'walkthrough_signed', board: 'ops', entityKind: 'job', entityId: jobId, data: { jobId }, dedupeKey: `${tag}:walk` })
    await Q.tick(later(MIN), { scan: false })
    for (const r of rules) expect(await tasksOf(r.id), r.name).toHaveLength(1)
    for (const r of rules) await pause(r.id)
  })

  test('stage rules: refused with what is missing, then allowed; for cards and for jobs', async () => {
    const card = await addCard('Job Prep')
    await call('PUT', '/api/automations/stage-rules', { board: 'sales', stage: 'Pending Start', requirements: [{ type: 'permit_approved' }], enabled: true })
    const refused = await move(card, 'Pending Start')
    expect(refused.status).toBe(409)
    expect(refused.json.code).toBe('STAGE_BLOCKED')
    expect(refused.json.blocked[0].missing[0].label).toMatch(/Permit approved/)
    expect(refused.json.error).toMatch(/cannot move to Pending Start yet/)
    expect(typeof refused.json.version).toBe('number')
    const check = await call('POST', '/api/automations/stage-check', { board: 'sales', entityId: card, stage: 'Pending Start' })
    expect(check.json.data.ok).toBe(false)
    const put = await call('PUT', `/api/automations/permits/${jobIds[0]}`, { status: 'approved', permitNumber: 'TEST-1', county: 'Marion' })
    expect(put.status).toBe(200)
    expect((await move(card, 'Pending Start')).status).toBe(200)

    // Operations: Complete needs the walkthrough signed.
    await call('PUT', '/api/automations/stage-rules', { board: 'ops', stage: 'completed', requirements: [{ type: 'walkthrough_signed' }], enabled: true })
    let signed = false
    setWalkthroughForTests({ isWalkthroughSigned: async () => signed, startWalkthrough: async () => ({ id: 'w1' }) })
    const no = await call('PATCH', `/api/saved-jobs/${jobIds[0]}`, { status: 'completed' })
    expect(no.status).toBe(409)
    expect(no.json.blocked[0].missing[0].detail).toMatch(/not been signed/)
    signed = true
    expect((await call('PATCH', `/api/saved-jobs/${jobIds[0]}`, { status: 'completed' })).status).toBe(200)
    await call('PATCH', `/api/saved-jobs/${jobIds[0]}`, { status: 'scheduled' })
    await call('PUT', '/api/automations/stage-rules', { board: 'ops', stage: 'completed', requirements: [{ type: 'walkthrough_signed' }], enabled: false })
    await call('PUT', '/api/automations/stage-rules', { board: 'sales', stage: 'Pending Start', requirements: [{ type: 'permit_approved' }], enabled: false })
    await prisma.automationEvent.updateMany({ where: { entityId: { in: [card, jobIds[0]] }, processedAt: null }, data: { processedAt: new Date() } })
  })

  test('a crash in the middle of a run: done steps are not done again', async () => {
    const rule = await makeRule({ name: 'crash', board: 'ops', trigger: { type: 'event', event: 'punch_list_cleared' }, steps: [
      { type: 'create_task', title: `${tag} first`, description: '', assignTo: '', dueInDays: 0 },
      { type: 'notify', title: `${tag} second`, body: '', push: true },
    ] })
    await prisma.pushSubscription.create({ data: { accountId, userId: user.id, endpoint: `https://push.example/${tag}`, p256dh: 'BKey-for-tests-only-0123456789', auth: 'authtest' } })
    const at = later(20 * 86_400_000)
    await recordEvent({ accountId, type: 'punch_list_cleared', board: 'ops', entityKind: 'job', entityId: jobIds[0], data: { jobId: jobIds[0] }, dedupeKey: `${tag}:punch`, occurredAt: at })
    await Q.processEvent((await prisma.automationEvent.findFirst({ where: { dedupeKey: `${tag}:punch` } }))!)
    const run = (await runsOf(rule.id))[0]
    // The worker made the task, then stopped before noting the step done.
    const ctx = (await buildContext(accountId, 'ops', jobIds[0]))!
    await runStep({ accountId, runId: run.id, ruleId: rule.id, ruleName: rule.name, stepIndex: 0, step: (rule.steps as any)[0], entity: ctx, now: at })
    await prisma.$executeRawUnsafe(`UPDATE "AutomationRun" SET status = 'running', "updatedAt" = now() - interval '1 hour' WHERE id = $1`, run.id)
    await Q.tick(at, { scan: false })
    const after = (await runsOf(rule.id))[0]
    expect(after.status).toBe('succeeded')
    expect(await prisma.task.count({ where: { title: `${tag} first` } })).toBe(1)
    expect(await prisma.notification.count({ where: { title: `${tag} second` } })).toBe(1)
    expect(pushes.filter(p => p.includes(tag))).toHaveLength(1)
    // Running it again by hand (as if the queue were replayed) still does nothing twice.
    await prisma.automationRun.update({ where: { id: run.id }, data: { status: 'queued', stepIndex: 0 } })
    await Q.tick(at, { scan: false })
    expect(await prisma.task.count({ where: { title: `${tag} first` } })).toBe(1)
    expect(await prisma.notification.count({ where: { title: `${tag} second` } })).toBe(1)
    expect(pushes.filter(p => p.includes(tag))).toHaveLength(1)
    await pause(rule.id)
  })

  test('a failing webhook is tried again with backoff and the same Idempotency-Key, then succeeds', async () => {
    const keys: string[] = []
    const hook = http.createServer((req, res) => { keys.push(String(req.headers['idempotency-key'])); res.statusCode = keys.length < 3 ? 503 : 200; res.end() }).listen(0)
    const url = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`
    const rule = await makeRule({ name: 'webhook', board: 'sales', trigger: { type: 'card_left', stage: 'Estimating' }, steps: [{ type: 'webhook', url }] })
    const card = await addCard('Estimating')
    await move(card, 'Pending Signature')
    const t0 = later(MIN)
    await Q.tick(t0, { scan: false })
    let run = (await runsOf(rule.id))[0]
    expect(run.status).toBe('queued')
    await Q.tick(new Date(run.nextRunAt.getTime()), { scan: false })
    run = (await runsOf(rule.id))[0]
    await Q.tick(new Date(run.nextRunAt.getTime()), { scan: false })
    run = (await runsOf(rule.id))[0]
    expect(run.status).toBe('succeeded')
    expect(keys).toHaveLength(3)
    expect(new Set(keys).size).toBe(1)
    hook.close()
    await pause(rule.id)
  })

  test('dry run shows what would happen and changes nothing', async () => {
    const card = await addCard('Signed Contract')
    // Only what this card could have caused: other test files write to the same dev copy at the same time.
    const since = new Date()
    const count = async () => {
      const runs = (await prisma.automationRun.findMany({ where: { entityId: card }, select: { id: true } })).map((x: any) => x.id)
      const lead = ((await prisma.pipelineState.findUnique({ where: { accountId } }))!.leads as any[]).find(l => l.id === card)
      return [
        await prisma.task.count({ where: { title: { startsWith: 'Order materials for Testy' }, createdAt: { gte: since } } }),
        await prisma.notification.count({ where: { title: { contains: 'Testy' }, createdAt: { gte: since } } }),
        runs.length, await prisma.automationEvent.count({ where: { entityId: card } }),
        await prisma.automationEffect.count({ where: { runId: { in: runs } } }), lead?.stage, JSON.stringify(lead),
        await prisma.permit.count({ where: { createdAt: { gte: since } } }),
      ]
    }
    const before = await count()
    const r = await call('POST', '/api/automations/rules/test', { entityId: card, rule: {
      board: 'sales', trigger: { type: 'card_entered', stage: 'Signed Contract', settleMinutes: 2, onlyWhileInStage: false },
      conditions: [{ field: 'price', op: 'between', value: { minCents: 100000, maxCents: null } }],
      steps: [
        { type: 'create_task', title: 'Order materials for {first name}', description: '', assignTo: '', dueInDays: 1 },
        { type: 'wait', minutes: 60 },
        { type: 'email_customer', subject: 'Hi {first name}', body: 'Proposal: {proposal link}' },
        { type: 'move_card', stage: 'Job Prep' },
        { type: 'permit_packet', assignTo: '' },
      ],
    } })
    expect(r.status).toBe(200)
    expect(r.json.data.steps[0].would).toBe(`make a task "Order materials for Testy", due ${floridaDay(later(86_400_000))}`)
    expect(r.json.data.steps[2].would).toMatch(/email testy@example.com: "Hi Testy"/)
    expect(r.json.data.steps[4].would).toMatch(/Marion County Civic Access/)
    expect(r.json.data.conditions[0].field).toBe('price')
    expect(await count()).toEqual(before)
  })
})
