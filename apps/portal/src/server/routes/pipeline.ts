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
import { auditSettingChange } from '../lib/settingsAudit.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { resolveSecret } from '../lib/secrets.js'
import { applyPipelineDelta } from '../lib/pipelineDelta.js'
import { syncCalendarAfterWrite } from '../lib/calendarSync/index.js'
import { plainZod } from '../lib/plainZod.js'
import { checkPipelineMoves, refuseBlocked } from '../lib/automations/stageRules.js'
import { recordCardMoves } from '../lib/automations/hooks.js'
import { onCardMoves } from '../lib/followUps.js'
import { pipelineChangeRefusal, refuse, removedIds, roleOf } from '../lib/permissions.js'

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

const pipelineSchema = z.object({
  leads: z.array(z.any()).default([]),
  stages: z.array(z.any()).default([]),
})

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
    const fields = { leads: oneById(JSON.parse(JSON.stringify(data.leads)) as any[]), stages: JSON.parse(JSON.stringify(data.stages)) }
    // Stage rules: a card cannot enter a stage whose requirements are not met (the app puts it back and says what is missing).
    const prev = await prisma.pipelineState.findUnique({ where: { accountId } })
    // A whole board saved by a limited role may add and move cards, never drop one or change the stages.
    const refusedPut = prev ? pipelineChangeRefusal(roleOf(req), prev as any, { removed: removedIds(prev.leads, fields.leads), stages: fields.stages }) : null
    if (refusedPut) { refuse(res, refusedPut, { data: prev, version: prev?.version ?? 0 }); return }
    if (prev && prev.version === base) {
      const blocked = await checkPipelineMoves(accountId, (prev.leads as any[]) ?? [], fields.leads)
      if (blocked.length) { refuseBlocked(res, blocked, { data: prev, version: prev.version }); return }
    }
    // Applied only if nobody saved since `base`; the where clause makes that one atomic step.
    // Stage moves are saved for automations in the same step.
    const done = await prisma.$transaction(async tx => {
      const d = await tx.pipelineState.updateMany({ where: { accountId, version: base }, data: { ...fields, version: { increment: 1 } } })
      if (d.count && prev) await recordCardMoves(accountId, (prev.leads as any[]) ?? [], fields.leads, base + 1, tx)
      // A card in a new stage starts that stage's follow up steps (stops on Signed or Lost).
      if (d.count && prev) await onCardMoves(tx, accountId, (prev.leads as any[]) ?? [], fields.leads)
      return d
    })
    if (done.count === 0) {
      const current = await prisma.pipelineState.findUnique({ where: { accountId } })
      if (current || base !== 0) { refuseStale(res, current, current?.version ?? 0); return }
      try { await prisma.pipelineState.create({ data: { accountId, ...fields } }) } catch (e) {
        if (!isUniqueViolation(e)) throw e
        const now = await prisma.pipelineState.findUnique({ where: { accountId } })
        refuseStale(res, now, now?.version ?? 0); return
      }
    }
    const p = (await prisma.pipelineState.findUnique({ where: { accountId } }))!
    await audit(req, 'update', 'PipelineState', p.id, { newValues: { leadsCount: data.leads.length, stagesCount: data.stages.length } })
    // A change to the stage list itself goes to the change log (Settings > Change log).
    await auditSettingChange(req, 'pipeline/stages', prev?.stages ?? null, fields.stages)
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
    // Adding and moving cards is for everyone; removing a card or changing the stages is not.
    const refusedDelta = pipelineChangeRefusal(roleOf(req), current as any, { removed: delta.remove.filter(id => ((current.leads as any[]) ?? []).some(l => l?.id === id)), stages: delta.stages })
    if (refusedDelta) { refuse(res, refusedDelta, { data: current, version: current.version }); return }
    const next = applyPipelineDelta({ leads: (current.leads as any[]) ?? [], stages: (current.stages as any[]) ?? [] }, delta)
    const fields = { leads: JSON.parse(JSON.stringify(next.leads)), stages: JSON.parse(JSON.stringify(next.stages)) }
    const blocked = await checkPipelineMoves(accountId, (current.leads as any[]) ?? [], next.leads)
    if (blocked.length) { refuseBlocked(res, blocked, { data: current, version: current.version }); return }
    const done = await prisma.$transaction(async tx => {
      const d = await tx.pipelineState.updateMany({ where: { accountId, version: base }, data: { ...fields, version: { increment: 1 } } })
      if (d.count) await recordCardMoves(accountId, (current.leads as any[]) ?? [], next.leads, base + 1, tx)
      if (d.count) await onCardMoves(tx, accountId, (current.leads as any[]) ?? [], next.leads)
      return d
    })
    if (done.count === 0) {
      const now = await prisma.pipelineState.findUnique({ where: { accountId } })
      refuseStale(res, now, now?.version ?? 0); return
    }
    await audit(req, 'update', 'PipelineState', current.id, { newValues: { cardsSaved: delta.upsert.length, cardsRemoved: delta.remove.length, leadsCount: next.leads.length } })
    if (delta.stages) await auditSettingChange(req, 'pipeline/stages', current.stages, fields.stages)
    // Only the new version goes back: the browser already holds the cards.
    res.json({ success: true, version: base + 1 })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[pipeline] patch error:', err)
    res.status(500).json({ success: false, error: 'Failed to save pipeline' })
  }
})

export default router
