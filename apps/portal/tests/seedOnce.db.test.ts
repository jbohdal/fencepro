/**
 * Made once, against the dev database (DEV_DB=1 and ezbiz_dev only; vitest
 * does not even load this file anywhere else). Everything runs on a company
 * made for the test and removed after it.
 *
 *   - What the server makes by itself (starter rules, the company's pipeline,
 *     settings and inventory records, a job's checklist, a lead's follow-ups):
 *     done twice, then three times at once, there is exactly one.
 *   - Creates with the screen's own id (automation rule, rain day, portal
 *     message) and an online proposal accepted: sent three times one after
 *     another and three times at once, there is exactly one, every answer a
 *     success.
 *   - Lists saved whole keep one entry per id; one kit set in use per style.
 *
 * Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('made once (dev database)', () => {
  let prisma: any
  let accountId = ''
  let token = ''
  let base = ''
  let server: Server
  const tag = `seedonce-${Date.now().toString(36)}`
  const customerId = `${tag}-cust`
  let leadId = ''
  let quoteId = ''
  const shareToken = `${tag}-share-${crypto.randomBytes(6).toString('hex')}`

  const call = (method: string, path: string, body?: unknown) =>
    fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const three = async (fn: () => Promise<{ status: number; json: any }>) => {
    const seq = [await fn(), await fn(), await fn()]
    const par = await Promise.all([fn(), fn(), fn()])
    return [...seq, ...par]
  }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const user = await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } })
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    token = jwt.sign({ sub: user.id, email: user.email, role: 'admin', firstName: 'Test', lastName: 'Seed', crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })

    const app = express()
    app.use(express.json({ limit: '2mb' }))
    app.use('/api/automations', (await import('../src/server/routes/automations.js')).default)
    app.use('/api/pipeline', (await import('../src/server/routes/pipeline.js')).default)
    app.use('/api/business-state', (await import('../src/server/routes/business-state.js')).default)
    app.use('/api/inventory-state', (await import('../src/server/routes/inventory.js')).default)
    app.use('/api/vendor-state', (await import('../src/server/routes/vendors-state.js')).default)
    app.use('/api/schedule', (await import('../src/server/routes/schedule.js')).default)
    app.use('/api/portal', (await import('../src/server/routes/portal.js')).default)
    app.use('/p', (await import('../src/server/routes/proposal.js')).publicProposal)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    await prisma.followUp.deleteMany({ where: { leadId } }).catch(() => {})
    if (leadId) await prisma.lead.deleteMany({ where: { id: leadId } })
    await prisma.portalMessage.deleteMany({ where: { crmCustomerId: customerId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.notification.deleteMany({ where: { OR: [{ title: { contains: tag } }, { body: { contains: tag } }] } }).catch(() => {})
    for (const m of ['automationRun', 'automationEvent', 'automationRule', 'stageRule', 'scheduleRainDay', 'scheduledGridJob', 'scheduleSettings', 'pipelineState', 'businessState', 'inventoryState', 'vendorState', 'accountKeyValue', 'crmAuditLog']) {
      await prisma[m].deleteMany({ where: { accountId } }).catch(() => {})
    }
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch((e: unknown) => console.error('[seedOnce test] account cleanup:', e))
  })

  test('starter rules: made twice, then three times at once, one of each', async () => {
    const { ensureStarters } = await import('../src/server/lib/automations/queue.js')
    const { STARTER_RULES, STARTER_STAGE_RULES } = await import('../src/server/lib/automations/types.js')
    await ensureStarters(accountId)
    await ensureStarters(accountId)
    // What the Automations screen does on open: both lists at the same moment, three times.
    const answers = await Promise.all([1, 2, 3].flatMap(() => [call('GET', '/api/automations/rules'), call('GET', '/api/automations/stage-rules')]))
    expect(answers.every(a => a.status === 200)).toBe(true)
    const rules = await prisma.automationRule.groupBy({ by: ['starter'], where: { accountId, starter: { not: null } }, _count: true })
    expect(rules).toHaveLength(STARTER_RULES.length)
    expect(rules.every((r: any) => r._count === 1)).toBe(true)
    const stages = await prisma.stageRule.groupBy({ by: ['starter'], where: { accountId, starter: { not: null } }, _count: true })
    expect(stages).toHaveLength(STARTER_STAGE_RULES.length)
    expect(stages.every((r: any) => r._count === 1)).toBe(true)
    // The database itself refuses a second copy.
    await expect(prisma.automationRule.create({ data: { accountId, name: 'copy', board: 'sales', trigger: {}, steps: [], starter: STARTER_RULES[0].starter } })).rejects.toMatchObject({ code: 'P2002' })
  })

  test('the company records (pipeline, settings, inventory, vendors, schedule): opened three times at once, one each, no errors', async () => {
    const paths = ['/api/pipeline', '/api/business-state', '/api/inventory-state', '/api/vendor-state', '/api/schedule/settings', '/api/schedule/board']
    const answers = await Promise.all([1, 2, 3].flatMap(() => paths.map(p => call('GET', p))))
    expect(answers.map(a => a.status)).toEqual(answers.map(() => 200))
    for (const m of ['pipelineState', 'businessState', 'inventoryState', 'vendorState', 'scheduleSettings']) {
      expect(await prisma[m].count({ where: { accountId } })).toBe(1)
    }
  })

  test('a job\'s checklist: made twice, then three times at once, one list of the default milestones', async () => {
    const { ensureJobChecklist, DEFAULT_MILESTONES, milestoneId } = await import('../src/server/lib/seeds.js')
    const jobId = `${tag}-job`
    await ensureJobChecklist(accountId, jobId)
    await ensureJobChecklist(accountId, jobId)
    await Promise.all([1, 2, 3].map(() => ensureJobChecklist(accountId, jobId)))
    const s = await prisma.businessState.findUnique({ where: { accountId } })
    const list = (s.jobChecklists as any)[jobId]
    expect(list).toHaveLength(DEFAULT_MILESTONES.length)
    expect(list[0].id).toBe(milestoneId(jobId, DEFAULT_MILESTONES[0]))
  })

  test('a lead\'s follow up texts: scheduled twice, then three times at once, one of each kind', async () => {
    const { scheduleFollowUps } = await import('../src/server/lib/followUpScheduler.js')
    const lead = await prisma.lead.create({ data: { firstName: 'Seed', lastName: tag, phone: '352-555-0199' } })
    leadId = lead.id
    await scheduleFollowUps(leadId)
    await scheduleFollowUps(leadId)
    await Promise.all([1, 2, 3].map(() => scheduleFollowUps(leadId)))
    const rows = await prisma.followUp.groupBy({ by: ['type'], where: { leadId }, _count: true })
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r: any) => r._count === 1)).toBe(true)
  })

  test('an automation rule saved 3 times one after another and 3 at once: one rule', async () => {
    const id = crypto.randomUUID()
    const body = { id, name: `${tag} rule`, board: 'sales', enabled: false, trigger: { type: 'card_entered', stage: 'Appointment' }, conditions: [], steps: [{ type: 'notify', title: 'x', body: 'y' }] }
    const answers = await three(() => call('POST', '/api/automations/rules', body))
    expect(answers.every(a => a.json.success === true && a.json.data.id === id)).toBe(true)
    expect(await prisma.automationRule.count({ where: { accountId, name: `${tag} rule` } })).toBe(1)
  })

  test('a rain day sent 3 times one after another and 3 at once: one entry', async () => {
    const id = crypto.randomUUID()
    const body = { id, jobId: `${tag}-grid`, clientName: tag, originalDate: '2026-10-19', rescheduleDate: '2026-10-20', reason: 'Rain' }
    const answers = await three(() => call('POST', '/api/schedule/rain-log', body))
    expect(answers.every(a => a.json.success === true && a.json.data.id === id)).toBe(true)
    expect(await prisma.scheduleRainDay.count({ where: { accountId, clientName: tag } })).toBe(1)
  })

  test('a message to a customer sent 3 times one after another and 3 at once: one message', async () => {
    const clientId = crypto.randomUUID()
    const answers = await three(() => call('POST', `/api/portal/customer/${customerId}/messages`, { body: `Hello from ${tag}`, sender: 'Test', clientId }))
    expect(answers.every(a => a.json.success === true)).toBe(true)
    expect(await prisma.portalMessage.count({ where: { crmCustomerId: customerId } })).toBe(1)
  })

  test('a proposal accepted 3 times at once (and again after): one acceptance, one job', async () => {
    const q = await prisma.savedQuote.create({
      data: {
        accountId, customerName: `Seed ${tag}`, fenceStyle: 'WV-ND 6x6 Privacy', finalPrice: 5000, sections: 10, runs: [80],
        pullSheet: [], shareToken, proposal: { options: [{ label: 'Good', fenceStyle: 'WV-ND 6x6 Privacy', finalPrice: 5000, sections: 10, snapshot: {} }] },
      },
    })
    quoteId = q.id
    const accept = () => fetch(`${base}/p/${shareToken}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ option: 0, name: 'Pat Seed' }) }).then(async r => ({ status: r.status, json: await r.json() as any }))
    const par = await Promise.all([accept(), accept(), accept()])
    const again = await accept()
    expect([...par, again].every(a => a.status === 200 && a.json.success)).toBe(true)
    expect(await prisma.savedJob.count({ where: { accountId, quoteId } })).toBe(1)
  })

  test('the board saved with the same card twice keeps one; two kit sets in use for a style keep one in use', async () => {
    const p = await prisma.pipelineState.findUnique({ where: { accountId } })
    const card = { id: `${tag}-card`, firstName: 'Seed', lastName: tag, stage: 'First Contact' }
    const put = await call('PUT', '/api/pipeline', { leads: [...((p.leads as any[]) ?? []), card, card], stages: p.stages ?? [], baseVersion: p.version })
    expect(put.status).toBe(200)
    const after = await prisma.pipelineState.findUnique({ where: { accountId } })
    expect((after.leads as any[]).filter(l => l.id === card.id)).toHaveLength(1)

    const inv = await prisma.inventoryState.findUnique({ where: { accountId } })
    const kits = [{ id: `${tag}-k1`, name: 'A', styleName: 'WV-ND 6x6 Privacy', kits: {}, roundUp: [] }, { id: `${tag}-k2`, name: 'B', styleName: 'WV-ND 6x6 Privacy', kits: {}, roundUp: [] }]
    const save = await call('PUT', '/api/inventory-state', { items: [], bundles: [], locations: [], stockLevels: [], transactions: [], kits, baseVersion: inv.version })
    expect(save.status).toBe(200)
    const saved = (await prisma.inventoryState.findUnique({ where: { accountId } })).kits as any[]
    expect(saved).toHaveLength(2)
    expect(saved.filter(k => !k.archived)).toHaveLength(1)
  })
})
