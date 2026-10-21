/**
 * Settings → Price List → Vinyl Colors — /api/vinyl-colors (lib/vinylColors.ts)
 *
 *   GET  /               → { records }: what adding each color made, and until when Undo is open
 *   POST /               → { input }: add a color from the form
 *   PUT  /:key           → { input }: save the form again for a color it made (costs as new dated costs)
 *   POST /:key/undo      → take away everything adding it made (24 hours, no quote or job on it)
 *   POST /:key/remove    → archive it (refused while an active quote uses it)
 *   POST /:key/restore   → bring an archived color back
 *
 * Changing a color changes prices and Settings: the owner and admin
 * (prices.change and settings.change). Every change is in the change log.
 */

import { Router } from 'express'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { resolveSecret } from '../lib/secrets.js'
import { requireCan } from '../lib/permissions.js'
import { audit } from '../lib/auditLog.js'
import { auditSettingChange } from '../lib/settingsAudit.js'
import { archiveVinylColor, colorRecords, ColorError, saveVinylColor, undoVinylColor, recordKey, type ColorActor } from '../lib/vinylColors.js'

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

async function actorOf(req: any): Promise<ColorActor> {
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true, email: true } }).catch(() => null) as any
  const name = [u?.firstName, u?.lastName].filter(Boolean).join(' ') || u?.email || req.user.email || 'Staff'
  return { accountId: req.user.crmAccountId, userId: req.user.id ?? null, name }
}

function fail(res: any, err: unknown, what: string) {
  if (err instanceof ColorError) { res.status(err.status).json({ success: false, error: err.message, ...err.extra }); return }
  console.error(`[vinyl-colors] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}. Nothing was changed. Try again; if it keeps happening, tell Jonathan.` })
}

const keyOf = (req: any) => String(req.params.key ?? '').slice(0, 80)
const changers = [requireCan('settings.change'), requireCan('prices.change')]

router.get('/', async (req: any, res) => {
  try { res.json({ success: true, data: { records: await colorRecords(req.user.crmAccountId) } }) }
  catch (err) { fail(res, err, 'load the vinyl colors') }
})

router.post('/', ...changers, async (req: any, res) => {
  try {
    const out = await saveVinylColor(await actorOf(req), req.body?.input)
    await audit(req, 'create', 'VinylColor', out.record.key, { newValues: { label: out.record.label, created: { items: out.record.created.items.map(i => `${i.name}${i.cents == null ? ' ($0, in the section kit)' : ` $${(i.cents / 100).toFixed(2)}`}`), styles: out.record.created.styles.map(s => s.name), kits: out.record.created.kits.length, priceHistory: out.record.created.priceHistoryIds.length } } })
    await auditSettingChange(req, `vinyl-colors/${out.record.key}`, null, { styles: out.record.created.styles.map(s => s.name), items: out.record.created.items.map(i => i.name) })
    res.status(201).json({ success: true, data: out })
  } catch (err) { fail(res, err, 'add the color') }
})

router.put('/:key', ...changers, async (req: any, res) => {
  const key = keyOf(req)
  try {
    const out = await saveVinylColor(await actorOf(req), req.body?.input, key)
    const edit = out.record.edits?.[out.record.edits.length - 1]
    await audit(req, 'update', 'VinylColor', key, { newValues: { label: out.record.label, edit } })
    await auditSettingChange(req, `vinyl-colors/${key}`, null, { changedCosts: edit?.priced.map(p => `${p.name}: ${p.prevCents == null ? '(none)' : `$${(p.prevCents / 100).toFixed(2)}`} → $${(p.cents / 100).toFixed(2)}`) ?? [], added: edit?.added ?? [], switchedOff: edit?.archived ?? [] })
    res.json({ success: true, data: out })
  } catch (err) { fail(res, err, 'save the color') }
})

router.post('/:key/undo', ...changers, async (req: any, res) => {
  const key = keyOf(req)
  try {
    const before = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId: req.user.crmAccountId, key: recordKey(key) } } })
    const out = await undoVinylColor(await actorOf(req), key)
    await audit(req, 'delete', 'VinylColor', key, { oldValues: before?.value ?? null, newValues: { undone: true, removed: out.removed } })
    await auditSettingChange(req, `vinyl-colors/${key}`, { styles: out.removed.styles, items: out.removed.items }, null)
    res.json({ success: true, data: out })
  } catch (err) { fail(res, err, 'undo adding the color') }
})

for (const [path, archive] of [['remove', true], ['restore', false]] as const) {
  router.post(`/:key/${path}`, ...changers, async (req: any, res) => {
    const key = keyOf(req)
    try {
      const out = await archiveVinylColor(await actorOf(req), key, archive)
      await audit(req, archive ? 'soft_delete' : 'restore', 'VinylColor', key, { newValues: { archived: archive, styles: out.styles, items: out.items } })
      await auditSettingChange(req, `vinyl-colors/${key}`, { archived: !archive }, { archived: archive, styles: out.styles })
      res.json({ success: true, data: out })
    } catch (err) { fail(res, err, archive ? 'remove the color' : 'bring the color back') }
  })
}

export default router
