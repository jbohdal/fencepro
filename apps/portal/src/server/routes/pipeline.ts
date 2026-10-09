/**
 * Sales Pipeline state — singleton per account.
 * Mirrors the pattern of /api/schedule/settings.
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/auditLog.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { resolveSecret } from '../lib/secrets.js'
import { applyPipelineDelta } from '../lib/pipelineDelta.js'
import { syncCalendarAfterWrite } from '../lib/calendarSync/index.js'

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
    let p = await prisma.pipelineState.findUnique({ where: { accountId: req.user.crmAccountId } })
    if (!p) {
      p = await prisma.pipelineState.create({
        data: { accountId: req.user.crmAccountId, leads: [], stages: [] },
      })
    }
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
    const fields = { leads: JSON.parse(JSON.stringify(data.leads)), stages: JSON.parse(JSON.stringify(data.stages)) }
    // Applied only if nobody saved since `base`; the where clause makes that one atomic step.
    const done = await prisma.pipelineState.updateMany({ where: { accountId, version: base }, data: { ...fields, version: { increment: 1 } } })
    if (done.count === 0) {
      const current = await prisma.pipelineState.findUnique({ where: { accountId } })
      if (current || base !== 0) { refuseStale(res, current, current?.version ?? 0); return }
      await prisma.pipelineState.create({ data: { accountId, ...fields } })
    }
    const p = (await prisma.pipelineState.findUnique({ where: { accountId } }))!
    await audit(req, 'update', 'PipelineState', p.id, { newValues: { leadsCount: data.leads.length, stagesCount: data.stages.length } })
    res.json({ success: true, data: p })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
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
    const next = applyPipelineDelta({ leads: (current.leads as any[]) ?? [], stages: (current.stages as any[]) ?? [] }, delta)
    const fields = { leads: JSON.parse(JSON.stringify(next.leads)), stages: JSON.parse(JSON.stringify(next.stages)) }
    const done = await prisma.pipelineState.updateMany({ where: { accountId, version: base }, data: { ...fields, version: { increment: 1 } } })
    if (done.count === 0) {
      const now = await prisma.pipelineState.findUnique({ where: { accountId } })
      refuseStale(res, now, now?.version ?? 0); return
    }
    await audit(req, 'update', 'PipelineState', current.id, { newValues: { cardsSaved: delta.upsert.length, cardsRemoved: delta.remove.length, leadsCount: next.leads.length } })
    // Only the new version goes back: the browser already holds the cards.
    res.json({ success: true, version: base + 1 })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[pipeline] patch error:', err)
    res.status(500).json({ success: false, error: 'Failed to save pipeline' })
  }
})

export default router
