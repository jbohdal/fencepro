/**
 * Lead sources and customer tags — /api/option-lists (lib/optionLists.ts)
 *
 *   GET  /                → { leadSources: { options, version }, customerTags: { options, version } }; every signed in staff login
 *   GET  /:kind           → { options, version } (kind: leadSources | customerTags)
 *   PUT  /:kind           → { options, baseVersion }: save the whole list (lists.change: owner, admin)
 *   GET  /:kind/words     → every word on records with how many records have it (Settings: counts, "Found on records")
 *
 * Refusals: 409 STALE (someone saved first; the answer carries their list),
 * 409 IN_USE (an option on records was deleted instead of merged), 400 with
 * the reason in words.
 */

import { Router } from 'express'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { resolveSecret } from '../lib/secrets.js'
import { requireCan } from '../lib/permissions.js'
import { baseVersionOf } from '../lib/versioned.js'
import { loadOptionList, saveOptionList, recordWords, isOptionKind, type SaveAnswer } from '../lib/optionLists.js'
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

const fail = (res: any, err: unknown, what: string) => {
  console.error(`[option-lists] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}. Try again; if it keeps happening, tell Jonathan.` })
}
function kindOf(req: any, res: any) {
  const k = String(req.params.kind)
  if (!isOptionKind(k)) { res.status(404).json({ success: false, error: 'No such list.' }); return null }
  return k
}

router.get('/', async (req: any, res) => {
  try {
    const a = req.user.crmAccountId
    res.json({ success: true, data: { leadSources: await loadOptionList(a, 'leadSources'), customerTags: await loadOptionList(a, 'customerTags') } })
  } catch (err) { fail(res, err, 'load the lead sources and tags') }
})

router.get('/:kind', async (req: any, res) => {
  const kind = kindOf(req, res); if (!kind) return
  try { res.json({ success: true, data: await loadOptionList(req.user.crmAccountId, kind) }) }
  catch (err) { fail(res, err, 'load the list') }
})

router.get('/:kind/words', async (req: any, res) => {
  const kind = kindOf(req, res); if (!kind) return
  try { res.json({ success: true, data: (await recordWords(req.user.crmAccountId, kind)).map(w => ({ word: w.word, count: w.count, tables: w.tables })) }) }
  catch (err) { fail(res, err, 'count the words on records') }
})

router.put('/:kind', requireCan('lists.change'), async (req: any, res) => {
  const kind = kindOf(req, res); if (!kind) return
  const base = baseVersionOf(req.body)
  if (base === null) { res.status(400).json({ success: false, error: 'baseVersion is required' }); return }
  if (!Array.isArray(req.body?.options)) { res.status(400).json({ success: false, error: 'options is required' }); return }
  try {
    const before = await loadOptionList(req.user.crmAccountId, kind)
    const r: SaveAnswer = await saveOptionList(req.user.crmAccountId, kind, req.body.options, base, req.user.id ?? null)
    if (r.ok) {
      await auditSettingChange(req, `option-lists/${kind}`, before.options, r.list.options, { version: r.list.version })
      res.json({ success: true, data: r.list }); return
    }
    res.status(r.status).json({ success: false, code: r.code, error: r.error, ...(r.list ? { data: r.list } : {}), ...(r.inUse ? { inUse: r.inUse } : {}) })
  } catch (err) { fail(res, err, 'save the list') }
})

export default router
