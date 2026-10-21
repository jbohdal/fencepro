/**
 * Sales Pipeline state — singleton per account.
 * Mirrors the pattern of /api/schedule/settings.
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { findOrCreate, isUniqueViolation, oneById } from '../lib/once.js'
import { audit } from '../lib/auditLog.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { resolveSecret } from '../lib/secrets.js'
import { applyPipelineDelta } from '../lib/pipelineDelta.js'
import { syncCalendarAfterWrite } from '../lib/calendarSync/index.js'
import { plainZod } from '../lib/plainZod.js'
import { checkPipelineMoves, refuseBlocked } from '../lib/automations/stageRules.js'
import { recordCardMoves } from '../lib/automations/hooks.js'
import { onCardMoves } from '../lib/followUps.js'
import { pipelineChangeRefusal, refuse, removedIds, roleOf, requireCan } from '../lib/permissions.js'
import { DeleteError, deleteRecord, logRemovedCards, removedIdsAmong, setArchived } from '../lib/deletion.js'
import { loadPipelineStages } from '../lib/pipelineStages.js'
import { stageById } from '../lib/pipelineStageModel.js'

const router = Router()

// Anything saved here may carry a date: keep Google Calendar in step, in the background.
router.use(syncCalendarAfterWrite as any)
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

async function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({ where: { id: payload.sub }, select: { crmAccountId: true } })
      crmAccountId = u?.crmAccountId ?? null
    }
    req.user = { id: payload.sub, email: payload.email, role: payload.role, crmAccountId }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

function requireAccount(req: any, res: any, next: any) {
  if (!req.user?.crmAccountId) { res.status(403).json({ success: false, error: 'No tenant' }); return }
  next()
}

router.use(requireUser, requireAccount)

// `stages`: an old app still sends the board's stage list; it is ignored (Settings > Pipeline Stages is the one list).
const pipelineSchema = z.object({
  leads: z.array(z.any()).default([]),
  stages: z.array(z.any()).optional(),
})

/**
 * Cards a save would put into a stage that is not in Settings > Pipeline
 * Stages: new cards, and cards whose stage changed. (A card already in an
 * unknown word and not moved is left alone, so it never vanishes.)
 */
async function unknownStageMoves(accountId: string, before: any[], after: any[]): Promise<Array<{ id: string; stage: string; from: string | null }>> {
  const was = new Map(before.filter(l => l?.id).map(l => [l.id, l.stage]))
  const moved = after.filter(l => l?.id && (!was.has(l.id) || was.get(l.id) !== l.stage))
  if (!moved.length) return []
  const { stages } = await loadPipelineStages(accountId)
  return moved.filter(l => !stageById(stages, l.stage)).map(l => ({ id: String(l.id), stage: String(l.stage ?? ''), from: was.get(l.id) ?? null }))
}

/** 409 UNKNOWN_STAGE with the server's board (the app puts the cards back); logged, so a device still sending old stage names shows up. */
async function refuseUnknownStage(req: any, res: any, bad: Array<{ id: string; stage: string; from: string | null }>, current: any, route: string) {
  console.warn(`[pipeline] refused a save (${route}) by ${req.user?.email ?? req.user?.id}: stage not in Settings > Pipeline Stages: ${bad.map(b => `card ${b.id} -> "${b.stage}"`).join(', ')}`)
  await audit(req, 'update', 'PipelineState', current?.id ?? req.user.crmAccountId, { newValues: { refusedUnknownStage: bad, route } })
  res.status(409).json({ success: false, code: 'UNKNOWN_STAGE', error: `"${bad[0].stage}" is not one of the pipeline stages (Settings > Pipeline Stages). The card stays where it was.`, unknown: bad, data: current, version: current?.version ?? 0 })
}

/**
 * Cards a save may not bring back: a card deleted (in Settings > Deleted
 * Records until restored), archived, or of a deleted customer. An older screen
 * still holding one sends it again; only a card already on the board passes.
 */
async function cardsNotWelcome(accountId: string, current: { leads?: unknown; archivedLeads?: unknown } | null, incoming: any[]): Promise<Set<string>> {
  const onBoard = new Set(((current?.leads as any[]) ?? []).map(l => l?.id))
  const fresh = incoming.filter(l => l?.id && !onBoard.has(l.id))
  if (!fresh.length) return new Set()
  const archived = new Set(((current?.archivedLeads as any[]) ?? []).map(l => l?.id))
  const removed = await removedIdsAmong(prisma, accountId, fresh.map(l => l.id))
  const customerIds = [...new Set(fresh.map(l => l.customerId).filter((x: unknown): x is string => typeof x === 'string' && !!x))]
  const gone = customerIds.length ? new Set((await prisma.crmContact.findMany({ where: { id: { in: customerIds }, accountId, deletedAt: { not: null } }, select: { id: true } })).map(c => c.id)) : new Set<string>()
  return new Set(fresh.filter(l => archived.has(l.id) || removed.has(l.id) || (l.customerId && gone.has(l.customerId))).map(l => l.id))
}

const actorOf = (req: any) => ({ accountId: req.user.crmAccountId as string, userId: (req.user.id ?? null) as string | null })

router.get('/', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const found = await prisma.pipelineState.findUnique({ where: { accountId } })
    // ?version=<n>: the board has not changed since that version, so nothing needs sending.
    const known = Number(req.query.version)
    if (found && Number.isInteger(known) && found.version === known) { res.json({ success: true, unchanged: true, version: found.version }); return }
    const p = found ?? await findOrCreate(
      () => prisma.pipelineState.findUnique({ where: { accountId } }),
      () => prisma.pipelineState.create({ data: { accountId, leads: [], stages: [] } }),
    )
    res.json({ success: true, data: p })
  } catch (err) {
    console.error('[pipeline] get error:', err)
    res.status(500).json({ success: false, error: 'Failed to load pipeline' })
  }
})

router.put('/', async (req: any, res) => {
  try {
    const data = pipelineSchema.parse(req.body)
    const base = baseVersionOf(req.body)
    if (base === null) { refuseUnversioned(res); return }
    const accountId = req.user.crmAccountId
    // One card per id: a card sent twice in the list is kept once.
    const fields = { leads: oneById(JSON.parse(JSON.stringify(data.leads)) as any[]) }
    // Stage rules: a card cannot enter a stage whose requirements are not met (the app puts it back and says what is missing).
    const prev = await prisma.pipelineState.findUnique({ where: { accountId } })
    const unwelcome = await cardsNotWelcome(accountId, prev, fields.leads)
    if (unwelcome.size) fields.leads = fields.leads.filter(l => !unwelcome.has(l?.id))
    // A whole board saved by a limited role may add and move cards, never drop one.
    const refusedPut = prev ? pipelineChangeRefusal(roleOf(req), { removed: removedIds(prev.leads, fields.leads) }) : null
    if (refusedPut) { refuse(res, refusedPut, { data: prev, version: prev?.version ?? 0 }); return }
    const badPut = await unknownStageMoves(accountId, (prev?.leads as any[]) ?? [], fields.leads)
    if (badPut.length) { await refuseUnknownStage(req, res, badPut, prev, 'PUT'); return }
    if (prev && prev.version === base) {
      const blocked = await checkPipelineMoves(accountId, (prev.leads as any[]) ?? [], fields.leads)
      if (blocked.length) { refuseBlocked(res, blocked, { data: prev, version: prev.version }); return }
    }
    // Applied only if nobody saved since `base`; the where clause makes that one atomic step.
    // Stage moves are saved for automations in the same step.
    const done = await prisma.$transaction(async tx => {
      const d = await tx.pipelineState.updateMany({ where: { accountId, version: base }, data: { ...fields, version: { increment: 1 } } })
      // A card taken off the board is a delete: one Deleted Records row each (before its follow up goes).
      if (d.count && prev) await logRemovedCards(tx, actorOf(req), (prev.leads as any[]) ?? [], fields.leads)
      if (d.count && prev) await recordCardMoves(accountId, (prev.leads as any[]) ?? [], fields.leads, base + 1, tx)
      // A card in a new stage starts that stage's follow up steps (stops on Signed or Lost).
      if (d.count && prev) await onCardMoves(tx, accountId, (prev.leads as any[]) ?? [], fields.leads)
      return d
    })
    if (done.count === 0) {
      const current = await prisma.pipelineState.findUnique({ where: { accountId } })
      if (current || base !== 0) { refuseStale(res, current, current?.version ?? 0); return }
      try { await prisma.pipelineState.create({ data: { accountId, ...fields, stages: [] } }) } catch (e) {
        if (!isUniqueViolation(e)) throw e
        const now = await prisma.pipelineState.findUnique({ where: { accountId } })
        refuseStale(res, now, now?.version ?? 0); return
      }
    }
    const p = (await prisma.pipelineState.findUnique({ where: { accountId } }))!
    await audit(req, 'update', 'PipelineState', p.id, { newValues: { leadsCount: data.leads.length, ...(data.stages ? { stagesIgnored: true } : {}) } })
    res.json({ success: true, data: p })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[pipeline] put error:', err)
    res.status(500).json({ success: false, error: 'Failed to save pipeline' })
  }
})

// One card moved is one card sent, not the whole board (see lib/pipelineDelta).
const deltaSchema = z.object({
  upsert: z.array(z.object({
    lead: z.object({ id: z.string().min(1) }).passthrough(),
    before: z.string().nullable().optional(),
  })).default([]),
  remove: z.array(z.string()).default([]),
  stages: z.array(z.any()).optional(),
})

router.patch('/', async (req: any, res) => {
  try {
    const delta = deltaSchema.parse(req.body)
    const base = baseVersionOf(req.body)
    if (base === null) { refuseUnversioned(res); return }
    const accountId = req.user.crmAccountId
    const current = await prisma.pipelineState.findUnique({ where: { accountId } })
    // Same rule as a whole save: only onto the version it was built on.
    if (!current || current.version !== base) { refuseStale(res, current, current?.version ?? 0); return }
    const unwelcome = await cardsNotWelcome(accountId, current, delta.upsert.map(u => u.lead))
    if (unwelcome.size) delta.upsert = delta.upsert.filter(u => !unwelcome.has(u.lead.id))
    // Adding and moving cards is for everyone; removing a card is not.
    const refusedDelta = pipelineChangeRefusal(roleOf(req), { removed: delta.remove.filter(id => ((current.leads as any[]) ?? []).some(l => l?.id === id)) })
    if (refusedDelta) { refuse(res, refusedDelta, { data: current, version: current.version }); return }
    // A stage list an old app still sends is ignored, not refused.
    const sentStages = !!delta.stages
    delete delta.stages
    const next = applyPipelineDelta({ leads: (current.leads as any[]) ?? [], stages: (current.stages as any[]) ?? [] }, delta)
    const badDelta = await unknownStageMoves(accountId, (current.leads as any[]) ?? [], next.leads)
    if (badDelta.length) { await refuseUnknownStage(req, res, badDelta, current, 'PATCH'); return }
    const fields = { leads: JSON.parse(JSON.stringify(next.leads)) }
    const blocked = await checkPipelineMoves(accountId, (current.leads as any[]) ?? [], next.leads)
    if (blocked.length) { refuseBlocked(res, blocked, { data: current, version: current.version }); return }
    const done = await prisma.$transaction(async tx => {
      const d = await tx.pipelineState.updateMany({ where: { accountId, version: base }, data: { ...fields, version: { increment: 1 } } })
      if (d.count) await logRemovedCards(tx, actorOf(req), (current.leads as any[]) ?? [], next.leads)
      if (d.count) await recordCardMoves(accountId, (current.leads as any[]) ?? [], next.leads, base + 1, tx)
      if (d.count) await onCardMoves(tx, accountId, (current.leads as any[]) ?? [], next.leads)
      return d
    })
    if (done.count === 0) {
      const now = await prisma.pipelineState.findUnique({ where: { accountId } })
      refuseStale(res, now, now?.version ?? 0); return
    }
    await audit(req, 'update', 'PipelineState', current.id, { newValues: { cardsSaved: delta.upsert.length, cardsRemoved: delta.remove.length, leadsCount: next.leads.length, ...(sentStages ? { stagesIgnored: true } : {}) } })
    // Only the new version goes back: the browser already holds the cards.
    res.json({ success: true, version: base + 1 })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[pipeline] patch error:', err)
    res.status(500).json({ success: false, error: 'Failed to save pipeline' })
  }
})

// ── One card: archive, unarchive, delete ──
// Archive moves the card to archivedLeads (off the board, kept for search and
// reports); Unarchive puts it back. Delete (owner, admin) sends it to
// Settings > Deleted Records with its follow up.
async function cardAction(req: any, res: any, run: () => Promise<unknown>) {
  try {
    const data = await run()
    const p = await prisma.pipelineState.findUnique({ where: { accountId: req.user.crmAccountId }, select: { version: true } })
    res.json({ success: true, data, version: p?.version ?? null })
  } catch (err) {
    if (err instanceof DeleteError) { res.status(err.status).json({ success: false, error: err.message }); return }
    console.error('[pipeline] card action error:', err)
    res.status(500).json({ success: false, error: 'Failed to change the card' })
  }
}
router.post('/cards/:id/archive', requireCan('records.archive'), (req: any, res) => cardAction(req, res, async () => {
  const r = await setArchived(actorOf(req), 'card', String(req.params.id), true)
  await audit(req, 'update', 'PipelineCard', String(req.params.id), { newValues: { archivedAt: r.archivedAt } })
  return r
}))
router.post('/cards/:id/unarchive', requireCan('records.archive'), (req: any, res) => cardAction(req, res, async () => {
  const r = await setArchived(actorOf(req), 'card', String(req.params.id), false)
  await audit(req, 'update', 'PipelineCard', String(req.params.id), { newValues: { archivedAt: null } })
  return r
}))
router.delete('/cards/:id', requireCan('records.delete'), (req: any, res) => cardAction(req, res, async () => {
  const r = await deleteRecord(actorOf(req), 'card', String(req.params.id), typeof req.body?.reason === 'string' ? req.body.reason : null)
  await audit(req, 'soft_delete', 'PipelineCard', String(req.params.id), { newValues: r })
  return r
}))

export default router
