/**
 * Operations stages — /api/ops-stages (lib/opsStages.ts)
 *
 *   GET    /                 → { stages, version }: the company's one list; every signed in staff login
 *   PUT    /                 → { stages, baseVersion }: save the whole list (settings.change)
 *   GET    /:id/usage        → the jobs, Operations automations and stage rule that use a stage
 *   POST   /:id/delete       → { moveTo, baseVersion }: delete a stage; what uses it moves to `moveTo`
 *                              first, in the same transaction (settings.change)
 *
 * Refusals: 409 STALE (someone saved first; the answer carries their list),
 * 409 STAGE_IN_USE (with `inUse`: what uses it), 400 with the reason in words.
 */

import { Router } from 'express'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { resolveSecret } from '../lib/secrets.js'
import { requireCan } from '../lib/permissions.js'
import { baseVersionOf } from '../lib/versioned.js'
import { loadOpsStages, saveOpsStages, deleteOpsStage, stageUsage, type ChangeAnswer } from '../lib/opsStages.js'
import { floridaDay } from '../lib/automations/context.js'

const router = Router()
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

async function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    if (payload.role === 'customer') { res.status(403).json({ success: false, error: 'Staff only' }); return }
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({ where: { id: payload.sub }, select: { crmAccountId: true } })
      crmAccountId = u?.crmAccountId ?? null
    }
    if (!crmAccountId) { res.status(403).json({ success: false, error: 'Your user is not linked to a company; ask an admin to assign you to one.' }); return }
    req.user = { id: payload.sub, email: payload.email, role: payload.role, crmAccountId }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}
router.use(requireUser)

function answer(res: any, r: ChangeAnswer) {
  if (r.ok) { res.json({ success: true, data: r.list, ...(r.moved ? { moved: r.moved } : {}) }); return }
  res.status(r.status).json({ success: false, code: r.code, error: r.error, ...(r.list ? { data: r.list } : {}), ...(r.inUse ? { inUse: r.inUse } : {}) })
}
const fail = (res: any, err: unknown, what: string) => {
  console.error(`[ops-stages] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}. Try again; if it keeps happening, tell Jonathan.` })
}

router.get('/', async (req: any, res) => {
  try { res.json({ success: true, data: await loadOpsStages(req.user.crmAccountId) }) }
  catch (err) { fail(res, err, 'load the Operations stages') }
})

router.put('/', requireCan('settings.change'), async (req: any, res) => {
  const base = baseVersionOf(req.body)
  if (base === null) { res.status(400).json({ success: false, error: 'baseVersion is required' }); return }
  if (!Array.isArray(req.body?.stages)) { res.status(400).json({ success: false, error: 'stages is required' }); return }
  try { answer(res, await saveOpsStages(req.user.crmAccountId, req.body.stages, base, req.user.id ?? null)) }
  catch (err) { fail(res, err, 'save the Operations stages') }
})

router.get('/:id/usage', async (req: any, res) => {
  try {
    const { stages } = await loadOpsStages(req.user.crmAccountId)
    res.json({ success: true, data: await stageUsage(req.user.crmAccountId, stages, String(req.params.id)) })
  } catch (err) { fail(res, err, 'check what uses the stage') }
})

router.post('/:id/delete', requireCan('settings.change'), async (req: any, res) => {
  const base = baseVersionOf(req.body)
  if (base === null) { res.status(400).json({ success: false, error: 'baseVersion is required' }); return }
  const moveTo = typeof req.body?.moveTo === 'string' && req.body.moveTo ? req.body.moveTo : null
  try { answer(res, await deleteOpsStage(req.user.crmAccountId, String(req.params.id), moveTo, base, req.user.id ?? null, floridaDay(new Date()))) }
  catch (err) { fail(res, err, 'delete the stage') }
})

export default router
