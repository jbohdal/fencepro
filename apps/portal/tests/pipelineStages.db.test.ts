/**
 * Sales Pipeline stages against the dev database (DEV_DB=1; refuses any other).
 *
 * A throwaway company gets a board as live has it (the 13 names in
 * PipelineState.stages and Settings' plain list, cards in several stages, one
 * archived), follow ups, a sales automation and a stage rule. Then:
 *   - the one-time step runs once (twice side by side), writes the list only,
 *     and changes no card, follow up, rule or stage rule;
 *   - renaming every stage (Signed Contract to "Sold") moves nothing; an
 *     accepted proposal still lands the card in the Signed stage (with its
 *     quote id), and moving a card there still stops its follow ups;
 *   - refused: a stage in use dropped, a missing or doubled role, an old
 *     version, a made up id, a salesman or manager saving, /api/kv;
 *   - a card moved into a stage not in the list is refused (409, logged); a
 *     stage list an old app still sends is ignored;
 *   - delete with a stage picked moves the cards (archived too), the rule, the
 *     stage rule, the follow up steps and the cards' follow ups (same dates),
 *     in one step, and no automation fires.
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
const THIRTEEN = ['First Contact', 'Appointment', 'Estimating', 'Pending Signature', 'Signed Contract', 'Job Prep', 'Pending Start', 'Jobs In Progress', 'Job Complete', 'Pending Payment', 'Paid & Closed', 'Lost Sale', 'No Answer']

describe.skipIf(!process.env.DEV_DB || !onDev)('Pipeline stages (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: stagesRoute } = await import('../src/server/routes/pipeline-stages.js')
  const { default: pipelineRoute } = await import('../src/server/routes/pipeline.js')
  const { default: kvRoute } = await import('../src/server/routes/kv.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const L = await import('../src/server/lib/pipelineStages.js')
  const M = await import('../src/server/lib/pipelineStageModel.js')
  const F = await import('../src/server/lib/followUps.js')
  const { onProposalAccepted } = await import('../src/server/lib/proposalAccepted.js')
  const { buildContext } = await import('../src/server/lib/automations/context.js')

  const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: { in: ['super_admin', 'admin'] as any } }, orderBy: { createdAt: 'asc' } }))!
  const tag = `pipe-stages-${crypto.randomUUID().slice(0, 8)}`
  let accountId = ''
  const tokens: Record<string, string> = {}
  let token = ''
  const app = express()
  app.use(express.json())
  app.use('/api/pipeline-stages', stagesRoute)
  app.use('/api/pipeline', pipelineRoute)
  app.use('/api/kv', kvRoute)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = (method: string, path: string, body?: unknown, as = token) => fetch(base + path, { method, headers: { Authorization: `Bearer ${as}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  const card = (k: string, stage: string, more: Record<string, unknown> = {}) => ({ id: `${tag}-${k}`, customerId: `${tag}-cust-${k}`, firstName: 'Test', lastName: `${tag} ${k}`, phone: '', email: '', address: '', leadSource: '', stage, createdAt: '2026-10-01', lastMoved: '2026-10-01', ...more })
  const CARDS = [card('fc', 'First Contact'), card('est', 'Estimating'), card('ps', 'Pending Signature'), card('prep', 'Job Prep'), card('paid', 'Paid & Closed'), card('lost', 'Lost Sale'), card('na', 'No Answer')]
  const ARCHIVED = [card('arch', 'Job Prep')]
  let ruleId = ''
  let stageRuleId = ''
  const snapshot = async () => {
    const p = await prisma.pipelineState.findUnique({ where: { accountId } })
    return {
      leads: p!.leads, archivedLeads: p!.archivedLeads,
      fu: await prisma.cardFollowUp.findMany({ where: { accountId }, orderBy: { cardId: 'asc' }, select: { cardId: true, stage: true, stageSince: true, stepIndex: true, dueOn: true, stoppedReason: true } }),
      rules: await prisma.automationRule.findMany({ where: { accountId }, select: { id: true, trigger: true, conditions: true, steps: true } }),
      stageRules: await prisma.stageRule.findMany({ where: { accountId }, select: { id: true, stage: true } }),
    }
  }

  beforeAll(async () => {
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    const sign = (role: string) => jwt.sign({ sub: user.id, email: user.email, role, crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '30m' })
    for (const r of ['super_admin', 'admin', 'manager', 'sales_rep']) tokens[r] = sign(r)
    token = tokens.super_admin
    await prisma.businessState.create({ data: { accountId, config: { pipelineStages: THIRTEEN } as any } })
    await prisma.pipelineState.create({ data: { accountId, leads: CARDS as any, archivedLeads: ARCHIVED as any, stages: THIRTEEN as any } })
    await prisma.cardFollowUp.create({ data: { accountId, cardId: `${tag}-ps`, stage: 'Pending Signature', stageSince: '2026-10-01', stepIndex: 1, dueOn: '2026-10-06', dueKind: 'text' } })
    await prisma.cardFollowUp.create({ data: { accountId, cardId: `${tag}-prep`, stage: 'Job Prep', stageSince: '2026-10-01', stepIndex: 2, dueOn: '2026-10-09', dueKind: 'call' } })
    await prisma.followUpSettings.create({ data: { accountId, steps: { 'Job Prep': [{ day: 3, kind: 'call' }], 'Pending Signature': [{ day: 2, kind: 'call' }] } as any, templates: [] as any } })
    ruleId = (await prisma.automationRule.create({ data: { accountId, name: `${tag} rule`, board: 'sales', enabled: false, trigger: { type: 'card_entered', stage: 'Job Prep', settleMinutes: 0, onlyWhileInStage: true }, conditions: [{ field: 'stage', op: 'is', value: 'Job Prep' }], steps: [{ type: 'move_card', stage: 'Job Prep' }] } })).id
    stageRuleId = (await prisma.stageRule.create({ data: { accountId, board: 'sales', stage: 'Job Prep', requirements: [{ type: 'has_price' }], enabled: false } })).id
  })

  afterAll(async () => {
    server.close()
    if (!accountId) return
    await prisma.automationEvent.deleteMany({ where: { accountId } })
    await prisma.automationRule.deleteMany({ where: { accountId } })
    await prisma.stageRule.deleteMany({ where: { accountId } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } })
    await prisma.followUpSettings.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { OR: [{ entityId: accountId }, { entityId: { startsWith: tag } }] } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { title: { contains: tag } } }).catch(() => {})
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('the one-time step runs once, writes the list only, and changes no card, follow up, rule or stage rule', async () => {
    const before = await snapshot()
    const [a, b] = await Promise.all([L.ensurePipelineStageList(accountId), L.ensurePipelineStageList(accountId)])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(a ?? b).toEqual({ wrote: true, added: [], hiddenStart: [], fromCards: [] })
    expect(await L.ensurePipelineStageList(accountId)).toBeNull()
    const list = await L.loadPipelineStages(accountId)
    expect(list.stages).toEqual(M.START_PIPELINE_STAGES)
    expect(list.version).toBe(1)
    const rec = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: L.PIPELINE_STAGES_MIGRATION_KEY } } })
    expect((rec!.value as any).oldSettingsList).toEqual(THIRTEEN)
    expect(await snapshot()).toEqual(before)
  })

  test('rename every stage (Signed Contract to "Sold"): nothing moves; roles still work', async () => {
    const before = await snapshot()
    const cur = (await call('GET', '/api/pipeline-stages')).json.data
    const renamed = cur.stages.map((s: any) => ({ ...s, name: s.id === 'Signed Contract' ? `Sold ${tag}` : `${s.name} ${tag}` }))
    const saved = await call('PUT', '/api/pipeline-stages', { stages: renamed, baseVersion: cur.version })
    expect(saved.status).toBe(200)
    expect(await snapshot()).toEqual(before)
    // Automations see the stage by id and say it by its new name.
    const ctx = await buildContext(accountId, 'sales', `${tag}-prep`)
    expect(ctx).toMatchObject({ stage: 'Job Prep', stageLabel: `Job Prep ${tag}` })
    // Follow ups: a card moved into the Signed stage ("Sold") stops its steps.
    const v = (await prisma.pipelineState.findUnique({ where: { accountId } }))!.version
    const ps = CARDS.find(c => c.id === `${tag}-ps`)!
    const moved = await call('PATCH', '/api/pipeline', { upsert: [{ lead: { ...ps, stage: 'Signed Contract', lastMoved: '2026-10-20' } }], remove: [], baseVersion: v })
    expect(moved.status).toBe(200)
    expect((await prisma.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId: ps.id } } }))!.stoppedReason).toBe('signed')
    const rows = (await F.cardRows(accountId)).rows
    expect(rows.find(r => r.cardId === ps.id)!.stopped).toBe('signed')
    expect(rows.find(r => r.cardId === `${tag}-na`)!.stopped).toBeNull()        // No Answer never stops them
    // An accepted proposal lands the customer's card in the Signed stage, with the quote id on it.
    await onProposalAccepted({ id: `${tag}-q1`, accountId, crmContactId: `${tag}-cust-est`, customerName: `Test ${tag} est`, customerPhone: '', customerEmail: '', customerAddress: '', leadSource: '', salesRep: '' }, { label: 'Better', fenceStyle: 'WV', finalPrice: 5000, sections: 10 }, 'Test')
    const est = ((await prisma.pipelineState.findUnique({ where: { accountId } }))!.leads as any[]).find(l => l.id === `${tag}-est`)
    expect(est).toMatchObject({ stage: 'Signed Contract', quoteId: `${tag}-q1` })
    const note = await prisma.notification.findFirst({ where: { title: { contains: tag } }, orderBy: { createdAt: 'desc' } })
    expect(note!.body).toContain(`Sold ${tag}`)
    // Back to the names they had.
    const now = (await call('GET', '/api/pipeline-stages')).json.data
    expect((await call('PUT', '/api/pipeline-stages', { stages: cur.stages, baseVersion: now.version })).status).toBe(200)
  })

  test('refused: a stage in use dropped, a missing or doubled role, an old version, a made up id; a salesman or manager saving; /api/kv', async () => {
    const cur = (await call('GET', '/api/pipeline-stages')).json.data
    const dropped = await call('PUT', '/api/pipeline-stages', { stages: cur.stages.filter((s: any) => s.id !== 'No Answer'), baseVersion: cur.version })
    expect(dropped.status).toBe(409); expect(dropped.json.code).toBe('STAGE_IN_USE')
    expect(dropped.json.inUse.cards.map((c: any) => c.id)).toEqual([`${tag}-na`])
    const noLost = await call('PUT', '/api/pipeline-stages', { stages: cur.stages.map((s: any) => ({ ...s, roles: s.roles.filter((r: string) => r !== 'lost') })), baseVersion: cur.version })
    expect(noLost.status).toBe(400); expect(noLost.json.error).toMatch(/Lost/)
    const twoSigned = await call('PUT', '/api/pipeline-stages', { stages: cur.stages.map((s: any) => (s.id === 'Job Prep' ? { ...s, roles: ['signed'] } : s)), baseVersion: cur.version })
    expect(twoSigned.status).toBe(400); expect(twoSigned.json.error).toMatch(/Only one stage/)
    expect((await call('PUT', '/api/pipeline-stages', { stages: cur.stages, baseVersion: cur.version - 1 })).json.code).toBe('STALE')
    const madeUp = await call('PUT', '/api/pipeline-stages', { stages: [...cur.stages, { ...cur.stages[0], id: 'Hot Lead', name: 'Hot Lead', roles: [] }], baseVersion: cur.version })
    expect(madeUp.status).toBe(400)
    for (const role of ['sales_rep', 'manager']) {
      const r = await call('PUT', '/api/pipeline-stages', { stages: cur.stages, baseVersion: cur.version }, tokens[role])
      expect(r.status).toBe(403); expect(r.json.code).toBe('NOT_ALLOWED')
      expect((await call('POST', '/api/pipeline-stages/No Answer/delete', { moveTo: 'Lost Sale', baseVersion: cur.version }, tokens[role])).status).toBe(403)
    }
    expect((await call('GET', '/api/pipeline-stages', undefined, tokens.sales_rep)).status).toBe(200)
    expect((await call('PUT', '/api/pipeline-stages', { stages: cur.stages, baseVersion: cur.version }, tokens.admin)).status).toBe(200)
    const kv = await call('PUT', `/api/kv/${L.PIPELINE_STAGES_KEY}`, { value: [{ id: 'x' }], baseVersion: 0 })
    expect(kv.status).toBe(403)
    expect((await call('PUT', `/api/kv/${L.PIPELINE_STAGES_KEY}`, { value: [{ id: 'x' }], baseVersion: 0 }, tokens.manager)).status).toBe(403)
    expect((await L.loadPipelineStages(accountId)).stages.map(s => s.id)).toEqual(M.START_PIPELINE_STAGES.map(s => s.id))
  })

  test('a card moved into a stage not in the list is refused and logged; a stage list from an old app is ignored', async () => {
    const p = (await prisma.pipelineState.findUnique({ where: { accountId } }))!
    const fc = (p.leads as any[]).find(l => l.id === `${tag}-fc`)
    const bad = await call('PATCH', '/api/pipeline', { upsert: [{ lead: { ...fc, stage: 'Hot Lead' } }], remove: [], baseVersion: p.version })
    expect(bad.status).toBe(409); expect(bad.json.code).toBe('UNKNOWN_STAGE')
    expect(bad.json.unknown).toEqual([{ id: fc.id, stage: 'Hot Lead', from: 'First Contact' }])
    const logged = await prisma.crmAuditLog.findFirst({ where: { entityType: 'PipelineState', entityId: p.id }, orderBy: { createdAt: 'desc' } })
    expect(JSON.stringify(logged?.newValues)).toContain('Hot Lead')
    const put = await call('PUT', '/api/pipeline', { leads: (p.leads as any[]).map(l => (l.id === fc.id ? { ...l, stage: 'Hot Lead' } : l)), baseVersion: p.version })
    expect(put.status).toBe(409); expect(put.json.code).toBe('UNKNOWN_STAGE')
    // An old app sends its stage list with a move: the move saves, the list is ignored.
    const old = await call('PATCH', '/api/pipeline', { upsert: [{ lead: { ...fc, stage: 'Appointment' } }], remove: [], stages: ['Only', 'These'], baseVersion: p.version })
    expect(old.status).toBe(200)
    const after = (await prisma.pipelineState.findUnique({ where: { accountId } }))!
    expect(after.stages).toEqual(THIRTEEN)
    expect((after.leads as any[]).find(l => l.id === fc.id).stage).toBe('Appointment')
    // Even a salesman's old app: ignored, not refused.
    const rep = await call('PATCH', '/api/pipeline', { upsert: [{ lead: { ...fc, stage: 'First Contact' } }], remove: [], stages: [], baseVersion: after.version }, tokens.sales_rep)
    expect(rep.status).toBe(200)
  })

  test('delete Job Prep into Pending Start: cards (archived too), rule, stage rule, steps and follow ups move in one step; no automation fires', async () => {
    const cur = (await call('GET', '/api/pipeline-stages')).json.data
    const refused = await call('POST', `/api/pipeline-stages/${encodeURIComponent('Job Prep')}/delete`, { moveTo: null, baseVersion: cur.version })
    expect(refused.status).toBe(409)
    expect(refused.json.inUse.cards.map((c: any) => c.id).sort()).toEqual([`${tag}-arch`, `${tag}-prep`])
    expect(refused.json.inUse).toMatchObject({ steps: 1, followUps: 1 })
    expect((await call('POST', `/api/pipeline-stages/${encodeURIComponent('Lost Sale')}/delete`, { moveTo: 'No Answer', baseVersion: cur.version })).status).toBe(400)   // the Lost stage
    const before = await prisma.pipelineState.findUnique({ where: { accountId } })
    const fuBefore = await prisma.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId: `${tag}-prep` } } })
    const events = await prisma.automationEvent.count({ where: { accountId } })
    const done = await call('POST', `/api/pipeline-stages/${encodeURIComponent('Job Prep')}/delete`, { moveTo: 'Pending Start', baseVersion: cur.version })
    expect(done.status).toBe(200)
    expect(done.json.moved).toEqual({ cards: 2, rules: 1, stageRules: 1, steps: 1, followUps: 1 })
    expect(done.json.data.stages.some((s: any) => s.id === 'Job Prep')).toBe(false)
    const after = (await prisma.pipelineState.findUnique({ where: { accountId } }))!
    expect(after.version).toBe(before!.version + 1)
    const prep = (after.leads as any[]).find(l => l.id === `${tag}-prep`)
    expect(prep).toMatchObject({ stage: 'Pending Start', lastMoved: '2026-10-01' })
    expect((after.archivedLeads as any[]).find(l => l.id === `${tag}-arch`).stage).toBe('Pending Start')
    // Every other card as it was.
    for (const l of after.leads as any[]) if (l.id !== prep.id) expect(l).toEqual((before!.leads as any[]).find(x => x.id === l.id))
    const fu = await prisma.cardFollowUp.findUnique({ where: { accountId_cardId: { accountId, cardId: `${tag}-prep` } } })
    expect(fu).toMatchObject({ stage: 'Pending Start', stageSince: fuBefore!.stageSince, stepIndex: fuBefore!.stepIndex, dueOn: fuBefore!.dueOn })
    const steps = (await prisma.followUpSettings.findUnique({ where: { accountId } }))!.steps as any
    expect(steps['Job Prep']).toBeUndefined(); expect(steps['Pending Start']).toEqual([{ day: 3, kind: 'call' }])
    expect(M.stageIdsInSalesRule((await prisma.automationRule.findUnique({ where: { id: ruleId } })) as any)).toEqual(['Pending Start'])
    expect((await prisma.stageRule.findUnique({ where: { id: stageRuleId } }))!.stage).toBe('Pending Start')
    expect(await prisma.automationEvent.count({ where: { accountId } })).toBe(events)
    // A follow up step key that is not a stage any more is refused on save.
    await expect(F.saveConfig(accountId, { steps: { 'Job Prep': [{ day: 1, kind: 'call' }] }, templates: [] }, 99, user.id)).rejects.toThrow(/not one of the pipeline stages/)
    // An unused stage: no question.
    const now = (await call('GET', '/api/pipeline-stages')).json.data
    expect((await call('POST', `/api/pipeline-stages/${encodeURIComponent('Pending Payment')}/delete`, { moveTo: null, baseVersion: now.version })).status).toBe(200)
  })
})
