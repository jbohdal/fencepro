/**
 * Sales Pipeline stages — /api/pipeline-stages (lib/pipelineStages.ts)
 *
 *   GET    /                 → { stages, version }: the company's one list; every signed in staff login
 *   PUT    /                 → { stages, baseVersion }: save the whole list (lists.change: owner, admin)
 *   GET    /:id/usage        → the cards, sales automations, stage rule and follow ups that use a stage
 *   POST   /:id/delete       → { moveTo, baseVersion }: delete a stage; what uses it moves to `moveTo`
 *                              first, in the same transaction (lists.change)
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
import { loadPipelineStages, savePipelineStages, deletePipelineStage, stageUsage, type ChangeAnswer } from '../lib/pipelineStages.js'
import { auditSettingChange } from '../lib/settingsAudit.js'

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
  console.error(`[pipeline-stages] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}. Try again; if it keeps happening, tell Jonathan.` })
}

router.get('/', async (req: any, res) => {
  try { res.json({ success: true, data: await loadPipelineStages(req.user.crmAccountId) }) }
  catch (err) { fail(res, err, 'load the pipeline stages') }
})

router.put('/', requireCan('lists.change'), async (req: any, res) => {
  const base = baseVersionOf(req.body)
  if (base === null) { res.status(400).json({ success: false, error: 'baseVersion is required' }); return }
  if (!Array.isArray(req.body?.stages)) { res.status(400).json({ success: false, error: 'stages is required' }); return }
  try {
    const before = await loadPipelineStages(req.user.crmAccountId)
    const r = await savePipelineStages(req.user.crmAccountId, req.body.stages, base, req.user.id ?? null)
    // Who changed which stage, from which device (Settings > Change log).
    if (r.ok) await auditSettingChange(req, 'pipeline-stages', before.stages, r.list.stages, { version: r.list.version })
    answer(res, r)
  }
  catch (err) { fail(res, err, 'save the pipeline stages') }
})

router.get('/:id/usage', async (req: any, res) => {
  try { res.json({ success: true, data: await stageUsage(req.user.crmAccountId, String(req.params.id)) }) }
  catch (err) { fail(res, err, 'check what uses the stage') }
})

router.post('/:id/delete', requireCan('lists.change'), async (req: any, res) => {
  const base = baseVersionOf(req.body)
  if (base === null) { res.status(400).json({ success: false, error: 'baseVersion is required' }); return }
  const moveTo = typeof req.body?.moveTo === 'string' && req.body.moveTo ? req.body.moveTo : null
  try {
    const before = await loadPipelineStages(req.user.crmAccountId)
    const r = await deletePipelineStage(req.user.crmAccountId, String(req.params.id), moveTo, base, req.user.id ?? null)
    if (r.ok) await auditSettingChange(req, 'pipeline-stages', before.stages, r.list.stages, { version: r.list.version, deleted: String(req.params.id), movedTo: moveTo, moved: r.moved ?? null })
    answer(res, r)
  }
  catch (err) { fail(res, err, 'delete the stage') }
})

export default router
