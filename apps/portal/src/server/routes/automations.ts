/**
 * Automations API: rules (WHEN + IF + THEN), stage rules, runs and their logs,
 * dry run, push, Gmail, permits, tasks, and the notification bell.
 *
 *   GET    /meta                    stages, people, fields, Gmail and push status
 *   GET    /rules                   rules (starter rules are made, switched off, on first visit)
 *   POST   /rules                   new rule
 *   PUT    /rules/:id               save a rule
 *   PATCH  /rules/:id/enabled       pause or switch on
 *   DELETE /rules/:id
 *   POST   /rules/test              dry run against a sample card or job: what would happen, nothing done
 *   GET    /samples?board=&q=       cards or jobs to test against
 *   GET    /stage-rules             PUT /stage-rules  DELETE /stage-rules/:id
 *   POST   /stage-check             what is missing before a card can enter a stage
 *   GET    /runs?entityId=|status=|ruleId=   runs and their logs
 *   POST   /runs/:id/run-again
 *   GET    /runs/:id/files/:step    a file a step made (the permit packet)
 *   GET    /push/key  POST /push/subscribe  POST /push/unsubscribe  POST /push/test
 *   GET    /gmail/status  GET /gmail/connect-url  POST /gmail/disconnect
 *   GET    /permits/:jobId  PUT /permits/:jobId  POST /permits/:jobId/parcel  GET /permits/:jobId/packet.pdf
 *   GET    /tasks  PATCH /tasks/:id
 *   GET    /notifications  PATCH /notifications/:id/read  POST /notifications/read-all
 */

import { crewScope } from '../lib/crewScope.js'
import { OFFICE_NOTICE_ROLE, PERMIT_REMINDER_PREFIX } from '../lib/notificationService.js'
import { refuseNoPrices } from '../lib/costRedact.js'
import { Router } from 'express'
import { stageFollowsLocateAndPermit, permitReason } from '../lib/waitingStageMove.js'
import { permitStatusOf } from '../lib/permitStatus.js'
import { z } from 'zod'
import fs from 'fs'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { clientIdSchema, decideClientId } from '../lib/clientId.js'
import { isUniqueViolation } from '../lib/once.js'
import { resolveSecret } from '../lib/secrets.js'
import { plainZod } from '../lib/plainZod.js'
import { getFilePath } from '../lib/storage/index.js'
import { recordEvent } from '../lib/automationEvents.js'
import { ruleSchema, stageRuleSchema, REQUIREMENT_LABEL, REQUIREMENTS, STEP_TYPES, CONDITION_FIELDS, EVENT_TRIGGERS, type Board } from '../lib/automations/types.js'
import { dryRun, ensureStarters, runAgain, type LogEntry } from '../lib/automations/queue.js'
import { buildContext, loadLeads, jobForCard, opsStageOfJob, opsStageName, TEMPLATE_FIELDS } from '../lib/automations/context.js'
import { loadPipelineStages } from '../lib/pipelineStages.js'
import * as pipelineModel from '../lib/pipelineStageModel.js'
import { loadOpsStages } from '../lib/opsStages.js'
import { permitIsOk, pickableStages, stageById, stageIdsInRule } from '../lib/opsStageModel.js'
import { missingFor } from '../lib/automations/stageRules.js'
import { saveSubscription, sendPush, vapidKeys } from '../lib/automations/push.js'
import { HELD_TEXT } from '../lib/outboundGate.js'
import { disconnectGmail, gmailConsentUrl, gmailStatus } from '../lib/automations/gmail.js'
import { ensurePermit, lookupParcel, packetInputFor, PERMIT_PORTALS, PERMIT_STATUSES, portalFor, renderPacket, defaultPermitStatusOf } from '../lib/automations/permits.js'
import { walkthroughApi } from '../lib/automations/walkthroughAdapter.js'
import { can, refuse, requireCan, roleOf } from '../lib/permissions.js'
import { myTasksWhere, seesCompanyTasks } from '../lib/taskScope.js'
import { closeTasksSoon } from '../lib/taskAutoClose.js'

const router = Router()
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
const ADMIN_ROLES = new Set(['super_admin', 'admin'])

async function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId && payload.sub) {
      const u = await prisma.crmUser.findUnique({ where: { id: payload.sub }, select: { crmAccountId: true } }).catch(() => null)
      crmAccountId = u?.crmAccountId ?? null
    }
    if (!crmAccountId) { res.status(403).json({ success: false, error: 'Your login is not linked to a company.' }); return }
    req.user = { id: payload.sub, email: payload.email, role: payload.role, firstName: payload.firstName ?? '', lastName: payload.lastName ?? '', crmAccountId }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}
/** Automation rules and stage rules: owner, admin and manager (lib/permissions). */
function requireAdmin(req: any, res: any, next: any) {
  if (!can(req.user?.role, 'automations.change')) { refuse(res, 'automations.change'); return }
  next()
}
/** The Gmail connection is the owner's or an admin's. */
function requireOwnerOrAdmin(req: any, res: any, next: any) {
  if (!ADMIN_ROLES.has(req.user?.role)) { refuse(res, 'system'); return }
  next()
}
router.use(requireUser)

const fail = (res: any, err: unknown, what: string) => {
  if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
  console.error(`[automations] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}. Try again; if it keeps happening, tell Jonathan.` })
}

/** Settings > Pipeline Stages, shown ones in order; rules keep the id. */
async function salesStages(accountId: string): Promise<Array<{ key: string; label: string }>> {
  return pipelineModel.pickableStages((await loadPipelineStages(accountId)).stages).map(s => ({ key: s.id, label: s.name }))
}

/**
 * A sales rule names stages by id; its trigger and move steps must be in
 * Settings > Pipeline Stages. A stage condition may also be a stage's name.
 */
async function unknownSalesStage(accountId: string, r: { board: string; trigger: any; conditions: any; steps: any }): Promise<string | null> {
  if (r.board !== 'sales') return null
  const { stages } = await loadPipelineStages(accountId)
  const named = (v: string) => !!pipelineModel.stageById(stages, v) || stages.some(s => s.name.trim().toLowerCase() === v.trim().toLowerCase())
  const strict = [r.trigger?.stage, ...(Array.isArray(r.steps) ? r.steps : []).filter((x: any) => x?.type === 'move_card').map((x: any) => x.stage)].filter((x): x is string => typeof x === 'string' && !!x)
  const bad = strict.find(id => !pipelineModel.stageById(stages, id)) ?? (Array.isArray(r.conditions) ? r.conditions : []).filter((c: any) => c?.field === 'stage' && typeof c.value === 'string' && c.value).map((c: any) => c.value as string).find((v: string) => !named(v))
  return bad ? `"${bad}" is not one of the pipeline stages (Settings > Pipeline Stages). Pick a stage from the list.` : null
}

/** An Operations rule names stages by id; every one must be in Settings > Operations Stages. */
async function unknownOpsStage(accountId: string, r: { board: string; trigger: any; conditions: any; steps: any }): Promise<string | null> {
  if (r.board !== 'ops') return null
  const { stages } = await loadOpsStages(accountId)
  const bad = stageIdsInRule(r).find(id => !stageById(stages, id))
  return bad ? `"${bad}" is not one of the Operations stages (Settings > Operations Stages). Pick a stage from the list.` : null
}

// ── Meta ──

router.get('/meta', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const people = await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true, firstName: true, lastName: true, email: true, role: true }, orderBy: { firstName: 'asc' } })
    const subs = await prisma.pushSubscription.count({ where: { accountId, userId: req.user.id } })
    res.json({
      success: true,
      data: {
        salesStages: await salesStages(accountId),
        // Settings > Operations Stages, shown ones in order; rules keep the id.
        opsStages: pickableStages((await loadOpsStages(accountId)).stages).map(s => ({ key: s.id, label: s.name })),
        people: people.map(p => ({ id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), email: p.email, role: p.role })),
        templateFields: TEMPLATE_FIELDS, stepTypes: STEP_TYPES, conditionFields: CONDITION_FIELDS, events: EVENT_TRIGGERS,
        requirements: REQUIREMENTS.map(r => ({ type: r, label: REQUIREMENT_LABEL[r] })),
        gmail: await gmailStatus(accountId),
        push: { mySubscriptions: subs },
        walkthroughInstalled: !!(await walkthroughApi()),
        permitPortals: PERMIT_PORTALS,
        isAdmin: can(req.user.role, 'automations.change'),
      },
    })
  } catch (err) { fail(res, err, 'load the automation settings') }
})

// ── Rules ──

const summarize = async (accountId: string) => {
  const since = new Date(Date.now() - 30 * 86_400_000)
  const runs = await prisma.automationRun.groupBy({ by: ['ruleId', 'status'], where: { accountId, createdAt: { gte: since } }, _count: true })
  const map: Record<string, Record<string, number>> = {}
  for (const r of runs) (map[r.ruleId] ??= {})[r.status] = r._count
  return map
}

router.get('/rules', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    await ensureStarters(accountId)
    const rules = await prisma.automationRule.findMany({ where: { accountId }, orderBy: [{ createdAt: 'asc' }] })
    const counts = await summarize(accountId)
    res.json({ success: true, data: rules.map(r => ({ ...r, runs30d: counts[r.id] ?? {} })) })
  } catch (err) { fail(res, err, 'load the rules') }
})

router.post('/rules', requireAdmin, async (req: any, res) => {
  try {
    const r = ruleSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    const badStage = await unknownOpsStage(accountId, r) ?? await unknownSalesStage(accountId, r)
    if (badStage) { res.status(400).json({ success: false, error: badStage }); return }
    // The id the screen chose when the editor opened: the same Save sent again returns the rule already made.
    const decision = await decideClientId(clientIdSchema.parse(req.body?.id), accountId, id => prisma.automationRule.findUnique({ where: { id } }))
    if (decision.kind === 'exists') { res.status(200).json({ success: true, data: decision.row }); return }
    let row
    try {
      row = await prisma.automationRule.create({
      data: { ...(decision.kind === 'use' ? { id: decision.id } : {}), accountId, name: r.name, board: r.board, enabled: r.enabled, enabledAt: r.enabled ? new Date() : null, trigger: r.trigger as any, conditions: r.conditions as any, steps: r.steps as any, createdBy: req.user.email },
      })
    } catch (e) {
      // Sent twice at the same moment: the first one is the rule.
      if (!isUniqueViolation(e) || decision.kind !== 'use') throw e
      const won = await prisma.automationRule.findUnique({ where: { id: decision.id } })
      if (!won || won.accountId !== accountId) throw e
      res.status(200).json({ success: true, data: won }); return
    }
    res.status(201).json({ success: true, data: row })
  } catch (err) { fail(res, err, 'save the rule') }
})

router.put('/rules/:id', requireAdmin, async (req: any, res) => {
  try {
    const r = ruleSchema.parse(req.body)
    const cur = await prisma.automationRule.findFirst({ where: { id: req.params.id, accountId: req.user.crmAccountId } })
    if (!cur) { res.status(404).json({ success: false, error: 'This rule was deleted on another device.' }); return }
    const badStage = await unknownOpsStage(req.user.crmAccountId, r) ?? await unknownSalesStage(req.user.crmAccountId, r)
    if (badStage) { res.status(400).json({ success: false, error: badStage }); return }
    const row = await prisma.automationRule.update({
      where: { id: cur.id },
      data: { name: r.name, board: r.board, enabled: r.enabled, enabledAt: r.enabled && !cur.enabled ? new Date() : cur.enabledAt, trigger: r.trigger as any, conditions: r.conditions as any, steps: r.steps as any },
    })
    res.json({ success: true, data: row })
  } catch (err) { fail(res, err, 'save the rule') }
})

router.patch('/rules/:id/enabled', requireAdmin, async (req: any, res) => {
  try {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body)
    const cur = await prisma.automationRule.findFirst({ where: { id: req.params.id, accountId: req.user.crmAccountId } })
    if (!cur) { res.status(404).json({ success: false, error: 'This rule was deleted on another device.' }); return }
    const row = await prisma.automationRule.update({ where: { id: cur.id }, data: { enabled, ...(enabled && !cur.enabled ? { enabledAt: new Date() } : {}) } })
    res.json({ success: true, data: row })
  } catch (err) { fail(res, err, 'switch the rule') }
})

router.delete('/rules/:id', requireAdmin, async (req: any, res) => {
  try {
    const cur = await prisma.automationRule.findFirst({ where: { id: req.params.id, accountId: req.user.crmAccountId } })
    if (!cur) { res.json({ success: true }); return }
    // Runs still to come stop: they find the rule gone and say so.
    await prisma.automationRule.delete({ where: { id: cur.id } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'delete the rule') }
})

router.post('/rules/test', async (req: any, res) => {
  try {
    const body = z.object({ entityId: z.string().min(1), rule: z.object({ name: z.string().optional(), board: z.enum(['sales', 'ops']), trigger: z.any(), conditions: z.any(), steps: z.any() }) }).parse(req.body)
    const out = await dryRun(req.user.crmAccountId, { ...body.rule, trigger: body.rule.trigger, conditions: body.rule.conditions, steps: body.rule.steps }, body.entityId)
    if (!out) { res.status(404).json({ success: false, error: 'That card or job is not there any more. Pick another.' }); return }
    res.json({ success: true, data: out })
  } catch (err) { fail(res, err, 'test the rule') }
})

router.get('/samples', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const board: Board = req.query.board === 'ops' ? 'ops' : 'sales'
    const q = String(req.query.q || '').trim().toLowerCase()
    if (board === 'sales') {
      const { leads } = await loadLeads(accountId)
      const { stages: ps } = await loadPipelineStages(accountId)
      const list = leads
        .filter(l => l?.id && (!q || `${l.firstName} ${l.lastName} ${l.address ?? ''}`.toLowerCase().includes(q)))
        .sort((a, b) => Number(pipelineModel.isFinishedStage(ps, a.stage)) - Number(pipelineModel.isFinishedStage(ps, b.stage)))
        .slice(0, 40)
        .map(l => ({ id: l.id, name: `${l.firstName ?? ''} ${l.lastName ?? ''}`.trim() || '(no name)', stage: pipelineModel.stageNameOf(ps, l.stage), address: l.address ?? '' }))
      res.json({ success: true, data: list }); return
    }
    const jobs = await prisma.savedJob.findMany({
      where: { accountId, deletedAt: null, archivedAt: null, ...(q ? { OR: [{ customerName: { contains: q, mode: 'insensitive' } }, { customerAddress: { contains: q, mode: 'insensitive' } }] } : {}) },
      orderBy: { updatedAt: 'desc' }, take: 40,
    })
    const { stages } = await loadOpsStages(accountId)
    res.json({ success: true, data: jobs.map(j => ({ id: j.id, name: j.customerName || '(no name)', stage: opsStageName(stages, opsStageOfJob(j, stages)), address: j.customerAddress })) })
  } catch (err) { fail(res, err, 'load cards to test with') }
})

// ── Stage rules ──

router.get('/stage-rules', async (req: any, res) => {
  try {
    await ensureStarters(req.user.crmAccountId)
    const rows = await prisma.stageRule.findMany({ where: { accountId: req.user.crmAccountId }, orderBy: [{ board: 'desc' }, { stage: 'asc' }] })
    res.json({ success: true, data: rows })
  } catch (err) { fail(res, err, 'load the stage rules') }
})

router.put('/stage-rules', requireAdmin, async (req: any, res) => {
  try {
    const r = stageRuleSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    // An Operations stage rule keeps the stage id from Settings > Operations Stages.
    if (r.board === 'ops' && !stageById((await loadOpsStages(accountId)).stages, r.stage)) {
      res.status(400).json({ success: false, error: `"${r.stage}" is not one of the Operations stages (Settings > Operations Stages).` }); return
    }
    // A sales stage rule keeps the stage id from Settings > Pipeline Stages.
    if (r.board === 'sales' && !pipelineModel.stageById((await loadPipelineStages(accountId)).stages, r.stage)) {
      res.status(400).json({ success: false, error: `"${r.stage}" is not one of the pipeline stages (Settings > Pipeline Stages).` }); return
    }
    const row = await prisma.stageRule.upsert({
      where: { accountId_board_stage: { accountId, board: r.board, stage: r.stage } },
      create: { accountId, board: r.board, stage: r.stage, requirements: r.requirements as any, enabled: r.enabled },
      update: { requirements: r.requirements as any, enabled: r.enabled },
    })
    res.json({ success: true, data: row })
  } catch (err) { fail(res, err, 'save the stage rule') }
})

router.delete('/stage-rules/:id', requireAdmin, async (req: any, res) => {
  try {
    await prisma.stageRule.deleteMany({ where: { id: req.params.id, accountId: req.user.crmAccountId } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'delete the stage rule') }
})

router.post('/stage-check', async (req: any, res) => {
  try {
    const b = z.object({ board: z.enum(['sales', 'ops']), entityId: z.string().min(1), stage: z.string().min(1) }).parse(req.body)
    const accountId = req.user.crmAccountId
    const rule = await prisma.stageRule.findFirst({ where: { accountId, board: b.board, stage: b.stage, enabled: true } })
    if (!rule) { res.json({ success: true, data: { ok: true, missing: [] } }); return }
    const ctx = await buildContext(accountId, b.board, b.entityId)
    const reqs = ((rule.requirements as any[]) ?? []).map(x => x.type)
    const missing = await missingFor(accountId, reqs, ctx?.job ?? null, ctx?.card ?? null)
    res.json({ success: true, data: { ok: missing.length === 0, missing } })
  } catch (err) { fail(res, err, 'check the stage') }
})

// ── Runs ──

router.get('/runs', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const where: any = { accountId }
    if (typeof req.query.entityId === 'string') where.entityId = req.query.entityId
    // A job's runs, and its pipeline card's (the Signed Contract rule runs on the card, round 6 review Oct 27 2026:
    // the job said "No automation has run for this yet" when it had).
    let cardIds = new Set<string>()
    if (typeof req.query.jobId === 'string') {
      const job = await prisma.savedJob.findFirst({ where: { id: req.query.jobId, accountId }, select: { id: true, quoteId: true, crmContactId: true } })
      if (job) cardIds = new Set(await cardsOfJob(accountId, job))
      where.entityId = { in: [req.query.jobId, ...cardIds] }
    }
    if (typeof req.query.ruleId === 'string') where.ruleId = req.query.ruleId
    if (typeof req.query.status === 'string') where.status = { in: req.query.status.split(',') }
    if (typeof req.query.id === 'string') where.id = req.query.id
    const runs = await prisma.automationRun.findMany({ where, orderBy: { createdAt: 'desc' }, take: Math.min(100, Number(req.query.limit) || 50) })
    const rules = await prisma.automationRule.findMany({ where: { id: { in: [...new Set(runs.map(r => r.ruleId))] } }, select: { id: true, name: true, board: true } })
    const names = new Map(rules.map(r => [r.id, r]))
    res.json({ success: true, data: runs.map(r => ({ ...r, ruleName: names.get(r.ruleId)?.name ?? '(deleted rule)', board: names.get(r.ruleId)?.board ?? null, ...(cardIds.has(r.entityId) ? { onCard: true } : {}) })) })
  } catch (err) { fail(res, err, 'load the run log') }
})

/** The pipeline cards whose job is this one (context.ts jobForCard: the card's job, its quote's, else its customer's newest). */
async function cardsOfJob(accountId: string, job: { id: string; quoteId: string | null; crmContactId: string | null }): Promise<string[]> {
  const { leads } = await loadLeads(accountId)
  const maybe = leads.filter(l => l?.id && (l.jobId === job.id || (job.quoteId && l.quoteId === job.quoteId) || (job.crmContactId && l.customerId === job.crmContactId)))
  const out: string[] = []
  for (const card of maybe) if ((await jobForCard(accountId, card))?.id === job.id) out.push(String(card.id))
  return out
}

router.post('/runs/:id/run-again', requireAdmin, async (req: any, res) => {
  try {
    const run = await runAgain(req.params.id, req.user.crmAccountId)
    if (!run) { res.status(404).json({ success: false, error: 'That run is not there any more.' }); return }
    res.json({ success: true, data: run })
  } catch (err) { fail(res, err, 'run it again') }
})

router.get('/runs/:id/files/:step', async (req: any, res) => {
  try {
    const run = await prisma.automationRun.findFirst({ where: { id: req.params.id, accountId: req.user.crmAccountId } })
    const eff = run ? await prisma.automationEffect.findUnique({ where: { key: `${run.id}:${Number(req.params.step)}:packet` } }) : null
    const p = (eff?.result as any)?.storagePath
    if (!p) { res.status(404).json({ success: false, error: 'That file is not there.' }); return }
    const full = getFilePath(p)
    if (!fs.existsSync(full)) { res.status(404).json({ success: false, error: 'That file is not there any more.' }); return }
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline; filename="permit-packet.pdf"')
    fs.createReadStream(full).pipe(res)
  } catch (err) { fail(res, err, 'open the file') }
})

// ── Push ──

router.get('/push/key', async (req: any, res) => {
  try { res.json({ success: true, data: { publicKey: (await vapidKeys(req.user.crmAccountId)).publicKey } }) } catch (err) { fail(res, err, 'get the push key') }
})

const subSchema = z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(4) }) })
router.post('/push/subscribe', async (req: any, res) => {
  try {
    const sub = subSchema.parse(req.body?.subscription ?? req.body)
    await saveSubscription(req.user.crmAccountId, req.user.id, sub, String(req.headers['user-agent'] || ''))
    res.json({ success: true })
  } catch (err) { fail(res, err, 'turn on push') }
})

router.post('/push/unsubscribe', async (req: any, res) => {
  try {
    const { endpoint } = z.object({ endpoint: z.string().min(1) }).parse(req.body)
    await prisma.pushSubscription.deleteMany({ where: { endpoint, accountId: req.user.crmAccountId } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'turn off push') }
})

router.post('/push/test', async (req: any, res) => {
  try {
    const r = await sendPush(req.user.crmAccountId, { title: 'EZ Biz push works', body: 'Automations will tell you here when something needs you.', url: '/automations', tag: 'test' }, { userIds: [req.user.id] })
    if (!r.subscribers) { res.status(400).json({ success: false, error: 'Push is not turned on for this phone yet. Press Turn on push first.' }); return }
    if (!r.sent && r.held) { res.status(409).json({ success: false, error: HELD_TEXT }); return }
    if (!r.sent && r.removed && !r.failed) { res.status(410).json({ success: false, error: 'This phone\'s push sign up had expired and was removed. Press Turn on push again.' }); return }
    if (!r.sent) { res.status(502).json({ success: false, error: `The push did not go through: ${r.errors[0] ?? 'no answer from the push service'}` }); return }
    res.json({ success: true, data: r })
  } catch (err) { fail(res, err, 'send a test push') }
})

// ── Gmail ──

router.get('/gmail/status', async (req: any, res) => {
  try { res.json({ success: true, data: await gmailStatus(req.user.crmAccountId) }) } catch (err) { fail(res, err, 'check Gmail') }
})

/** Where the browser may come back to after connecting (same rule as Google Calendar). */
function safeReturnTo(value: unknown): string {
  const fallback = (process.env.CLIENT_URL || process.env.APP_URL || '').replace(/\/+$/, '')
  if (typeof value !== 'string') return fallback
  try {
    const u = new URL(value)
    const allowed = [process.env.CLIENT_URL, process.env.APP_URL].filter(Boolean).map(x => new URL(x as string).origin)
    if (allowed.includes(u.origin) || ['localhost', '127.0.0.1'].includes(u.hostname)) return u.origin
  } catch { /* fall through */ }
  return fallback
}

router.get('/gmail/connect-url', requireOwnerOrAdmin, (req: any, res) => {
  try {
    // The Google project's redirect is the calendar callback; it hands "gmail" sign ins to lib/automations/gmail.
    const state = jwt.sign({ purpose: 'gmail', accountId: req.user.crmAccountId, returnTo: safeReturnTo(req.query.returnTo) }, JWT_SECRET, { expiresIn: '10m' })
    res.json({ success: true, data: { url: gmailConsentUrl(state) } })
  } catch (err) {
    res.status(400).json({ success: false, error: String((err as Error)?.message || err) })
  }
})

router.post('/gmail/disconnect', requireOwnerOrAdmin, async (req: any, res) => {
  try { await disconnectGmail(req.user.crmAccountId); res.json({ success: true }) } catch (err) { fail(res, err, 'disconnect Gmail') }
})

// ── Permits ──

const permitSchema = z.object({
  status: z.enum(PERMIT_STATUSES),
  permitNumber: z.string().max(80).default(''),
  county: z.string().max(60).default('Marion'),
  parcelId: z.string().max(40).default(''),
  appliedAt: z.string().max(10).default(''),
  approvedAt: z.string().max(10).default(''),
  inspectionAt: z.string().max(10).default(''),
  passedAt: z.string().max(10).default(''),
  notes: z.string().max(2000).default(''),
})

async function jobOf(req: any) {
  return prisma.savedJob.findFirst({ where: { id: req.params.jobId, accountId: req.user.crmAccountId, deletedAt: null, archivedAt: null } })
}

router.get('/permits/:jobId', async (req: any, res) => {
  try {
    const job = await jobOf(req)
    if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    const permit = await prisma.permit.findUnique({ where: { jobId: job.id } })
    // No record yet: what it starts as (Needed; Not needed for a repair), for the Permit panel to show.
    const defaultStatus = permit ? null : await defaultPermitStatusOf(req.user.crmAccountId, job)
    res.json({ success: true, data: { permit, defaultStatus, portal: portalFor(permit?.county ?? 'Marion') } })
  } catch (err) { fail(res, err, 'load the permit') }
})

router.put('/permits/:jobId', requireCan('permits.change'), async (req: any, res) => {
  try {
    const job = await jobOf(req)
    if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    const p = permitSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    const before = await prisma.permit.findUnique({ where: { jobId: job.id } })
    // The permit as every screen read it before this save (a repair with no record: Not needed).
    const statusBefore = before?.status ?? await permitStatusOf(accountId, job)
    const save = () => prisma.$transaction(async tx => {
      const row = await tx.permit.upsert({ where: { jobId: job.id }, create: { accountId, jobId: job.id, ...p, updatedBy: req.user.email }, update: { ...p, updatedBy: req.user.email } })
      if (before?.status !== row.status) {
        await recordEvent({ accountId, type: 'permit_changed', board: 'ops', entityKind: 'job', entityId: job.id, data: { jobId: job.id, from: before?.status ?? null, to: row.status }, dedupeKey: `permit:${row.id}:${row.status}:${row.updatedAt.getTime()}` }, tx)
      }
      return row
    })
    // Two saves of a job's first permit at the same moment: the second finds the first and updates it.
    const permit = await save().catch(e => { if (isUniqueViolation(e)) return save(); throw e })
    // "File the fence permit for …" closes by itself once it is Approved or Not needed (lib/taskAutoClose.ts).
    if (before?.status !== permit.status) closeTasksSoon(job.id)
    // The permit just became issued or Not needed: a job waiting on it moves on (lib/waitingStageMove.ts). Only at that change.
    if (!permitIsOk(statusBefore) && permitIsOk(permit.status)) await stageFollowsLocateAndPermit(accountId, job.id, permitReason(permit.status), `Permit saved, ${req.user.email ?? 'staff'}`)
    res.json({ success: true, data: { permit, portal: portalFor(permit.county) } })
  } catch (err) { fail(res, err, 'save the permit') }
})

router.post('/permits/:jobId/parcel', requireCan('permits.change'), async (req: any, res) => {
  try {
    const job = await jobOf(req)
    if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    let parcel = null
    try { parcel = await lookupParcel(job.customerAddress) } catch (err) {
      res.status(502).json({ success: false, error: `The county parcel service could not be reached (${String((err as Error).message).slice(0, 100)}). Try again later or type the parcel ID.` }); return
    }
    if (!parcel) { res.status(404).json({ success: false, error: 'No county parcel was found for this address. Check the address, or type the parcel ID from the Property Appraiser site.' }); return }
    const permit = await ensurePermit(req.user.crmAccountId, job.id, req.user.email)
    const row = await prisma.permit.update({ where: { id: permit.id }, data: { parcelId: parcel.parcel } })
    res.json({ success: true, data: { permit: row, parcel } })
  } catch (err) { fail(res, err, 'look up the parcel') }
})

// The permit packet carries the job's value: never the Installer's.
router.get('/permits/:jobId/packet.pdf', refuseNoPrices, async (req: any, res) => {
  try {
    const job = await jobOf(req)
    if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    const pdf = await renderPacket(await packetInputFor(req.user.crmAccountId, job.id, { lookup: req.query.lookup !== '0' }))
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="permit-packet-${(job.customerName || 'job').replace(/[^a-z0-9]+/gi, '-')}.pdf"`)
    res.send(pdf)
  } catch (err) { fail(res, err, 'make the permit packet') }
})

// ── Tasks: what is on each person's list ──

router.get('/tasks', async (req: any, res) => {
  try {
    const me = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true, email: true } }).catch(() => null)
    const names = [req.user.email, me?.email, me ? `${me.firstName} ${me.lastName}`.trim() : '', me?.firstName].filter((x): x is string => !!x)
    const status = typeof req.query.status === 'string' ? req.query.status.split(',') : ['pending', 'in_progress']
    // A Salesman's or Installer's list is theirs only; the owner's and office's also has the company's unnamed tasks (lib/taskScope.ts).
    const mine = req.query.all === '1' && seesCompanyTasks(roleOf(req)) ? {} : myTasksWhere(roleOf(req), names)
    // As many as asked for (the list's "Show more"; round 6 review, Oct 27 2026: a fixed 100 hid newer tasks).
    const take = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500)
    // Done: the ones closed in the last `days` days (14 unless asked), newest first, with why they closed (in the description).
    const done = status.length === 1 && status[0] === 'completed'
    const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90)
    const tasks = done
      ? await prisma.task.findMany({ where: { status: 'completed', completedAt: { gte: new Date(Date.now() - days * 86_400_000) }, ...mine }, orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }], take })
      // Open: overdue first, then today's, then later ones, then those with no due day.
      : await prisma.task.findMany({ where: { status: { in: status as any }, ...mine }, orderBy: [{ dueDate: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], take })
    res.json({ success: true, data: tasks })
  } catch (err) { fail(res, err, 'load tasks') }
})

router.patch('/tasks/:id', async (req: any, res) => {
  try {
    const { status } = z.object({ status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']) }).parse(req.body)
    const task = await prisma.task.update({ where: { id: String(req.params.id) }, data: { status: status as any, completedAt: status === 'completed' ? new Date() : null } })
    res.json({ success: true, data: task })
  } catch (err) { fail(res, err, 'update the task') }
})

// ── Notifications (the bell) ──

const portalRole = (role: string) => ADMIN_ROLES.has(role) ? 'admin' : 'support_agent'

/**
 * Which notices a login sees (Oct 25 2026: everyone, the installer and the
 * salesman too, saw 50 office notices such as "Possible duplicates"):
 *   owner, admin, manager, office   their own, their role's, and the company's (no recipient)
 *   salesman                        her own, her role's, and company notices about her own jobs
 *   installer                       his own, his role's, and company notices about his crew's jobs
 */
async function bellWhere(req: any): Promise<any> {
  const role = String(req.user.role || '')
  const own: any[] = [{ recipientId: req.user.email }, { recipientRole: portalRole(role) }, { recipientRole: role }]
  // The office's notices about a job (a permit still to apply for, an automation that failed) are the owner's and
  // the office's, never the Salesman's or the Installer's (audit Oct 26 2026: the installer got "Permit still Needed").
  if (!['sales_rep', 'field_crew'].includes(role)) return { OR: [...own, { recipientId: null, recipientRole: null }, { recipientRole: OFFICE_NOTICE_ROLE }] }
  let jobIds: string[] = []
  if (role === 'field_crew') {
    const scope = await crewScope(req.user.id).catch(() => null)
    jobIds = scope ? [...scope.jobIds] : []
  } else {
    const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
    const name = `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim()
    if (name) jobIds = (await prisma.savedJob.findMany({ where: { accountId: req.user.crmAccountId, deletedAt: null, salesRep: { equals: name, mode: 'insensitive' } }, select: { id: true } })).map(j => j.id)
  }
  // Notices from before they were marked the office's: the permit reminders and failed automations, by their words.
  const officeKinds = { NOT: { OR: [{ title: { startsWith: PERMIT_REMINDER_PREFIX } }, { type: 'error' }] } }
  return { OR: [...own, ...(jobIds.length ? [{ recipientId: null, recipientRole: null, jobId: { in: jobIds }, ...officeKinds }] : [])] }
}

router.get('/notifications', async (req: any, res) => {
  try {
    const where = await bellWhere(req)
    const notifications = await prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, take: 50 })
    res.json({ success: true, data: { notifications, unread: notifications.filter(n => !n.read).length } })
  } catch (err) { fail(res, err, 'load notifications') }
})

router.patch('/notifications/:id/read', async (req: any, res) => {
  try {
    await prisma.notification.update({ where: { id: String(req.params.id) }, data: { read: true, readAt: new Date() } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'mark it read') }
})

router.post('/notifications/read-all', async (req: any, res) => {
  try {
    // Only what this login sees (bellWhere): marking all read never clears the office's notices from a crew phone.
    const where = { read: false, ...(await bellWhere(req)) }
    await prisma.notification.updateMany({ where, data: { read: true, readAt: new Date() } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'mark all read') }
})

export type { LogEntry }
export default router
