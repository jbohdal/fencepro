/**
 * Operations stages against the dev database (DEV_DB=1; refuses any other).
 *
 * A throwaway company gets the old Settings screen's saved list (as live has
 * it) and jobs in every old board position, saved before stages were kept on
 * the job. Then:
 *   - the one-time step runs once (side by side twice), writes the one list,
 *     and changes no job row at all; the count per stage is the same;
 *   - renaming a stage changes no job's stage, status or row, and a stage rule
 *     and an automation on it still work;
 *   - a save that drops a stage in use, an old version, or a bad list is refused;
 *   - delete is refused while in use, and with a stage picked moves the jobs,
 *     the automation and the stage rule, then deletes, in one step;
 *   - a job moved into an added stage keeps its id; a payment then moves it;
 *   - /api/kv cannot write the list.
 * Database writes happen only inside beforeAll / test / afterAll; the company
 * and everything in it are removed at the end.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

const OLD_LIST = [
  { id: '9vriucdp', name: 'Awaiting Locates', color: '#3b82f6', isActive: true, sortOrder: 0, isFirstStage: true, isCompletionStage: false },
  { id: 'wjyh8yvs', name: 'Permit Pending', color: '#f59e0b', isActive: true, sortOrder: 1, isFirstStage: false, isCompletionStage: true },
  { id: 'kjzhb2gv', name: 'Materials Ordered', color: '#f97316', isActive: true, sortOrder: 2, isFirstStage: false, isCompletionStage: false },
  { id: '3944xrf3', name: 'Scheduled', color: '#10b981', isActive: true, sortOrder: 3, isFirstStage: false, isCompletionStage: false },
  { id: '9jhfbbbs', name: 'In Progress', color: '#06b6d4', isActive: true, sortOrder: 4, isFirstStage: false, isCompletionStage: false },
  { id: 'xpxxdtun', name: 'Punch List', color: '#8b5cf6', isActive: true, sortOrder: 5, isFirstStage: false, isCompletionStage: false },
  { id: 'derxpdp0', name: 'Complete', color: '#16a34a', isActive: true, sortOrder: 6, isFirstStage: false, isCompletionStage: true },
  { id: 'j56cfg8s', name: 'On Hold', color: '#6b7280', isActive: true, sortOrder: 7, isFirstStage: false, isCompletionStage: false },
]

describe.skipIf(!process.env.DEV_DB || !onDev)('Operations stages (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: opsStagesRoute } = await import('../src/server/routes/ops-stages.js')
  const { default: jobsRoute } = await import('../src/server/routes/saved-jobs.js')
  const { default: kvRoute } = await import('../src/server/routes/kv.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const L = await import('../src/server/lib/opsStages.js')
  const M = await import('../src/server/lib/opsStageModel.js')
  const { buildContext } = await import('../src/server/lib/automations/context.js')

  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: { in: ['super_admin', 'admin'] as any } }, orderBy: { createdAt: 'asc' } }))!
  const tag = `ops-stages-${crypto.randomUUID().slice(0, 8)}`
  let accountId = ''
  let token = ''
  const app = express()
  app.use(express.json())
  app.use('/api/ops-stages', opsStagesRoute)
  app.use('/api/saved-jobs', jobsRoute)
  app.use('/api/kv', kvRoute)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, body?: unknown) => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  // Jobs in every old board position, saved before the stage was kept on the job (opsStage '').
  const SEED: Array<[string, Record<string, unknown>, string]> = [
    ['locates', { status: 'staging' }, 'awaiting_locates'],
    ['drawing', { status: 'staging', locatesDate: '2026-10-01' }, 'need_drawing'],
    ['ordered', { status: 'staging', materialsStatus: 'ordered' }, 'materials_ordered'],
    ['pull', { status: 'staging', materialsStatus: 'loaded' }, 'ready_to_pull'],
    ['sched', { status: 'scheduled', scheduledDate: '2026-11-03' }, 'scheduled'],
    ['prog', { status: 'in_progress' }, 'in_progress'],
    ['done', { status: 'completed', completedDate: '2026-10-01' }, 'completed'],
    ['inv', { status: 'invoiced', completedDate: '2026-09-01' }, 'invoiced'],
    ['paid', { status: 'paid', completedDate: '2026-08-01' }, 'paid'],
    ['paid-archived', { status: 'paid', completedDate: '2026-07-01', archivedAt: new Date() }, 'paid'],
    ['hold', { status: 'on_hold', previousStatus: 'scheduled' }, 'on_hold'],
  ]
  const jobId: Record<string, string> = {}
  let ruleId = ''
  let stageRuleId = ''
  const rows = async () => prisma.savedJob.findMany({ where: { accountId }, orderBy: { id: 'asc' } })
  const counts = (list: any[], jobs: any[]) => { const m: Record<string, number> = {}; for (const j of jobs) { const s = M.stageOfJob(list, j); m[s] = (m[s] ?? 0) + 1 } return m }

  beforeAll(async () => {
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    token = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '30m' })
    await prisma.businessState.create({ data: { accountId } })
    await prisma.accountKeyValue.create({ data: { accountId, key: L.OPS_STAGES_KEY, value: OLD_LIST as any, version: 2 } })
    for (const [k, f] of SEED) {
      const j = await prisma.savedJob.create({ data: { accountId, customerName: `${tag} ${k}`, ...f } as any })
      jobId[k] = j.id
    }
    const r = await prisma.automationRule.create({ data: { accountId, name: `${tag} rule`, board: 'ops', enabled: false, trigger: { type: 'card_entered', stage: 'punch_list', settleMinutes: 0, onlyWhileInStage: true }, conditions: [{ field: 'stage', op: 'is', value: 'punch_list' }], steps: [{ type: 'move_card', stage: 'punch_list' }] } })
    ruleId = r.id
    const sr = await prisma.stageRule.create({ data: { accountId, board: 'ops', stage: 'completed', requirements: [{ type: 'paid_in_full' }], enabled: true } })
    stageRuleId = sr.id
  })

  afterAll(async () => {
    server.close()
    if (!accountId) return
    await prisma.automationEvent.deleteMany({ where: { accountId } })
    await prisma.automationRule.deleteMany({ where: { accountId } })
    await prisma.stageRule.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: Object.values(jobId) } } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('the one-time step runs once, writes the one list, and changes no job row', async () => {
    const before = await rows()
    const legacy = counts(M.START_OPS_STAGES, before.map(j => ({ ...j, opsStage: '' })))
    for (const [k, , want] of SEED) expect(M.legacyStageOfJob(before.find(j => j.id === jobId[k]) as any)).toBe(want)
    const [a, b] = await Promise.all([L.ensureOpsStageList(accountId), L.ensureOpsStageList(accountId)])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect((a ?? b)!.wrote).toBe(true)
    expect((a ?? b)!.kept).toEqual([])
    expect(await L.ensureOpsStageList(accountId)).toBeNull()
    const list = await L.loadOpsStages(accountId)
    expect(list.stages.map(s => s.id)).toEqual(M.START_OPS_STAGES.map(s => s.id))
    expect(list.version).toBe(3)
    const rec = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: L.OPS_STAGES_MIGRATION_KEY } } })
    expect((rec!.value as any).oldList).toEqual(OLD_LIST)
    const after = await rows()
    expect(after).toEqual(before)                                   // not one job row changed
    expect(counts(list.stages, after)).toEqual(legacy)              // the same count per stage
    expect(legacy).toEqual({ awaiting_locates: 1, need_drawing: 1, materials_ordered: 1, ready_to_pull: 1, scheduled: 1, in_progress: 1, completed: 1, invoiced: 1, paid: 2, on_hold: 1 })
  })

  test('renaming a stage changes no job and breaks no stage rule or automation', async () => {
    const before = await rows()
    const cur = (await call('GET', '/api/ops-stages')).json.data
    const renamed = cur.stages.map((s: any) => ({ ...s, name: `${s.name} ${tag}`, color: '#123456' }))
    const saved = await call('PUT', '/api/ops-stages', { stages: renamed, baseVersion: cur.version })
    expect(saved.status).toBe(200)
    expect(saved.json.data.stages.find((s: any) => s.id === 'completed').name).toBe(`Complete ${tag}`)
    expect(await rows()).toEqual(before)
    expect((await prisma.automationRule.findUnique({ where: { id: ruleId } }))!.trigger).toMatchObject({ stage: 'punch_list' })
    expect((await prisma.stageRule.findUnique({ where: { id: stageRuleId } }))!.stage).toBe('completed')
    // The stage rule still refuses a move into the (renamed) Complete stage, and says it by its new name.
    const blocked = await call('PATCH', `/api/saved-jobs/${jobId.prog}`, { status: 'completed' })
    expect(blocked.status).toBe(409)
    expect(blocked.json.code).toBe('STAGE_BLOCKED')
    expect(blocked.json.blocked[0].to).toBe(`Complete ${tag}`)
    // Automations see the stage by id and say it by its new name.
    const ctx = await buildContext(accountId, 'ops', jobId.sched)
    expect(ctx!.stage).toBe('scheduled')
    expect(ctx!.stageLabel).toBe(`Scheduled ${tag}`)
    // Back to the names they had.
    const now = (await call('GET', '/api/ops-stages')).json.data
    expect((await call('PUT', '/api/ops-stages', { stages: cur.stages, baseVersion: now.version })).status).toBe(200)
    expect(await rows()).toEqual(before)
  })

  test('refused: a stage in use dropped from the list, an old version, a bad list, a made up id', async () => {
    const cur = (await call('GET', '/api/ops-stages')).json.data
    const dropped = await call('PUT', '/api/ops-stages', { stages: cur.stages.filter((s: any) => s.id !== 'need_drawing'), baseVersion: cur.version })
    expect(dropped.status).toBe(409)
    expect(dropped.json.code).toBe('STAGE_IN_USE')
    expect(dropped.json.inUse.jobs.map((j: any) => j.id)).toEqual([jobId.drawing])
    expect((await call('PUT', '/api/ops-stages', { stages: cur.stages, baseVersion: cur.version - 1 })).json.code).toBe('STALE')
    const twoFirst = await call('PUT', '/api/ops-stages', { stages: cur.stages.map((s: any) => ({ ...s, isFirst: s.id === 'paid' || s.isFirst })), baseVersion: cur.version })
    expect(twoFirst.status).toBe(400)
    const madeUp = await call('PUT', '/api/ops-stages', { stages: [...cur.stages, { id: 'need_drawing_2', name: 'Again', color: '#000000', order: 99, hidden: false, isFirst: false, isComplete: false, lane: 'main' }], baseVersion: cur.version })
    expect(madeUp.status).toBe(400)
    // An unused stage can go with a plain save.
    const noBackorder = await call('PUT', '/api/ops-stages', { stages: cur.stages.filter((s: any) => s.id !== 'backorder'), baseVersion: cur.version })
    expect(noBackorder.status).toBe(200)
    expect(noBackorder.json.data.stages.some((s: any) => s.id === 'backorder')).toBe(false)
  })

  test('a job moved into an added stage keeps its id; a status change elsewhere moves it on', async () => {
    const cur = (await call('GET', '/api/ops-stages')).json.data
    const added = { id: `stage_${crypto.randomUUID().slice(0, 8)}`, name: `Inspection ${tag}`, color: '#000000', order: 0, hidden: false, isFirst: false, isComplete: false, lane: 'main' }
    const list = [...cur.stages]
    list.splice(list.findIndex((s: any) => s.id === 'completed'), 0, added)
    const saved = await call('PUT', '/api/ops-stages', { stages: list.map((s: any, i: number) => ({ ...s, order: i })), baseVersion: cur.version })
    expect(saved.status).toBe(200)
    const moved = await call('PATCH', `/api/saved-jobs/${jobId.sched}`, { opsStage: added.id })
    expect(moved.status).toBe(200)
    expect(moved.json.data).toMatchObject({ opsStage: added.id, status: 'in_progress' })
    const notes = await call('PATCH', `/api/saved-jobs/${jobId.sched}`, { notes: 'still here' })
    expect(notes.json.data.opsStage).toBe(added.id)
    const paid = await call('PATCH', `/api/saved-jobs/${jobId.sched}`, { status: 'paid', paymentStatus: 'paid', amountPaid: 1 })
    expect(paid.json.data.opsStage).toBe('paid')
    expect((await call('PATCH', `/api/saved-jobs/${jobId.sched}`, { opsStage: 'nope' })).status).toBe(400)
    // Put it back for the next test: a Paid job goes back only with Reopen (round 2b).
    expect((await call('PATCH', `/api/saved-jobs/${jobId.sched}`, { opsStage: 'punch_list' })).json.code).toBe('REOPEN_NEEDED')
    const back = await call('PATCH', `/api/saved-jobs/${jobId.sched}`, { opsStage: 'punch_list', reopen: true })
    expect(back.json.data).toMatchObject({ opsStage: 'punch_list', status: 'in_progress' })
    // A new job lands in the first stage.
    const made = await call('POST', '/api/saved-jobs', { customerName: `${tag} new`, status: 'staging' })
    expect(made.json.data.opsStage).toBe('awaiting_locates')
    jobId.new = made.json.data.id
  })

  test('delete: refused while in use; with a stage picked, jobs, automation and stage rule move, then it goes', async () => {
    let cur = (await call('GET', '/api/ops-stages')).json.data
    const refused = await call('POST', '/api/ops-stages/punch_list/delete', { moveTo: null, baseVersion: cur.version })
    expect(refused.status).toBe(409)
    expect(refused.json.inUse.jobs.map((j: any) => j.id)).toEqual([jobId.sched])
    expect(refused.json.inUse.rules.map((r: any) => r.id)).toEqual([ruleId])
    expect((await call('POST', '/api/ops-stages/completed/delete', { moveTo: 'paid', baseVersion: cur.version })).status).toBe(400)  // the Complete stage
    await prisma.stageRule.create({ data: { accountId, board: 'ops', stage: 'punch_list', requirements: [{ type: 'has_price' }], enabled: false } })
    const done = await call('POST', '/api/ops-stages/punch_list/delete', { moveTo: 'in_progress', baseVersion: cur.version })
    expect(done.status).toBe(200)
    expect(done.json.moved).toEqual({ jobs: 1, rules: 1, stageRules: 1 })
    expect(done.json.data.stages.some((s: any) => s.id === 'punch_list')).toBe(false)
    expect((await prisma.savedJob.findUnique({ where: { id: jobId.sched } }))).toMatchObject({ opsStage: 'in_progress', status: 'in_progress' })
    const r = (await prisma.automationRule.findUnique({ where: { id: ruleId } }))!
    expect(M.stageIdsInRule(r as any)).toEqual(['in_progress'])
    expect(await prisma.stageRule.count({ where: { accountId, stage: 'punch_list' } })).toBe(0)
    expect(await prisma.stageRule.count({ where: { accountId, stage: 'in_progress' } })).toBe(1)
    // Other jobs did not move.
    for (const k of ['locates', 'drawing', 'ordered', 'pull', 'done', 'inv', 'paid', 'hold']) {
      const j = await prisma.savedJob.findUnique({ where: { id: jobId[k] } })
      expect(M.stageOfJob(done.json.data.stages, j as any)).toBe(SEED.find(s => s[0] === k)![2])
    }
    // An unused stage: no question.
    cur = (await call('GET', '/api/ops-stages')).json.data
    expect((await call('POST', '/api/ops-stages/customer_delay/delete', { moveTo: null, baseVersion: cur.version })).status).toBe(200)
  })

  test('delete: the jobs moved out change only their stage; materials and drawing stay as recorded (review Oct 28 2026)', async () => {
    // Moving them to Ready to Pull, Materials Ordered or Need Drawing records nothing: the box says "Nothing else about the jobs changes".
    for (const [to, jobs] of [
      ['ready_to_pull', [{ materialsStatus: 'not_ordered', drawingComplete: true }, { materialsStatus: 'ordered', drawingComplete: false }]],
      ['materials_ordered', [{ materialsStatus: 'not_ordered', drawingComplete: true }]],
      ['need_drawing', [{ materialsStatus: 'not_ordered', drawingComplete: true }]],
    ] as Array<[string, Array<{ materialsStatus: string; drawingComplete: boolean }>]>) {
      const cur = (await call('GET', '/api/ops-stages')).json.data
      const temp = { id: `stage_${crypto.randomUUID().slice(0, 8)}`, name: `Temp ${to} ${tag}`, color: '#000000', order: 0, hidden: false, isFirst: false, isComplete: false, lane: 'main' }
      const list = [...cur.stages]
      list.splice(list.findIndex((s: any) => s.id === 'scheduled'), 0, temp)
      expect((await call('PUT', '/api/ops-stages', { stages: list.map((s: any, i: number) => ({ ...s, order: i })), baseVersion: cur.version })).status).toBe(200)
      const made = []
      for (const [i, f] of jobs.entries()) made.push(await prisma.savedJob.create({ data: { accountId, customerName: `${tag} temp ${to} ${i}`, status: 'staging', opsStage: temp.id, locatesDate: '2026-10-01', ...f } as any }))
      const now = (await call('GET', '/api/ops-stages')).json.data
      const done = await call('POST', `/api/ops-stages/${temp.id}/delete`, { moveTo: to, baseVersion: now.version })
      expect(done.status).toBe(200)
      expect(done.json.moved.jobs).toBe(jobs.length)
      for (const [i, j] of made.entries()) {
        const after = (await prisma.savedJob.findUnique({ where: { id: j.id } }))!
        expect(after).toMatchObject({ opsStage: to, status: 'staging', materialsStatus: jobs[i].materialsStatus, drawingComplete: jobs[i].drawingComplete })
      }
    }
  })

  test('an automation\'s Move step changes only the stage, never the materials or drawing', async () => {
    const { runStep } = await import('../src/server/lib/automations/steps.js')
    const j = await prisma.savedJob.create({ data: { accountId, customerName: `${tag} auto move`, status: 'staging', opsStage: 'need_drawing', locatesDate: '2026-10-01', materialsStatus: 'not_ordered', drawingComplete: true } as any })
    for (const to of ['materials_ordered', 'ready_to_pull']) {
      const ctx = (await buildContext(accountId, 'ops', j.id))!
      const out = await runStep({ accountId, runId: `${tag}-run`, ruleId: `${tag}-rule`, ruleName: tag, stepIndex: 0, step: { type: 'move_card', stage: to } as any, entity: ctx, now: new Date() })
      expect(out.detail).toMatch(/moved the job/)
      expect(await prisma.savedJob.findUnique({ where: { id: j.id } })).toMatchObject({ opsStage: to, status: 'staging', materialsStatus: 'not_ordered', drawingComplete: true })
    }
  })

  test('/api/kv cannot write the list', async () => {
    const kv = await call('PUT', `/api/kv/${L.OPS_STAGES_KEY}`, { value: [{ id: 'x', name: 'X' }], baseVersion: 0 })
    expect(kv.status).toBe(403)
    expect(L.isStageList((await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: L.OPS_STAGES_KEY } } }))!.value)).toBe(true)
  })
})
