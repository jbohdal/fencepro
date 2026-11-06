/**
 * Settings → Fence Styles → Add style and Settings → Price List — /api/fence-style-forms (lib/styleForms.ts)
 *
 *   POST /                         → { input }: add a style from the form (copying another style's fences and kits)
 *   PUT  /:material/:key           → { input }: save the form again (prices, own or same part, a new name)
 *   GET  /:material/:key/archive-check → its fences and the quotes and jobs on them
 *   POST /:material/:key/remove    → archive it (the owner only; refused while an unsent draft uses it)
 *   POST /:material/:key/restore   → bring it back (the owner only)
 *   PUT  /prices                   → { prices: [{ part, cents }] }: the Price List's prices for a style's parts, as dated costs
 *
 * Changing a style changes prices and Settings: the owner and admin (prices.change and settings.change).
 */

import { Router } from 'express'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { resolveSecret } from '../lib/secrets.js'
import { requireCan } from '../lib/permissions.js'
import { audit } from '../lib/auditLog.js'
import { auditSettingChange } from '../lib/settingsAudit.js'
import { ColorError, type ColorActor } from '../lib/vinylColors.js'
import { archiveStyle, saveStyleForm, saveStylePrices, styleArchiveCheck } from '../lib/styleForms.js'

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
  console.error(`[fence-style-forms] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}. Nothing was changed. Try again; if it keeps happening, tell Jonathan.` })
}

const keyOf = (req: any) => String(req.params.key ?? '').slice(0, 80)
const matOf = (req: any) => String(req.params.material ?? '').slice(0, 20)
const changers = [requireCan('settings.change'), requireCan('prices.change')]
/** Archiving a whole style is the owner's, as a vinyl color (Jonathan, Nov 5, 2026). */
function ownerOnly(req: any, res: any, next: any) {
  if (req.user?.role !== 'super_admin') { res.status(403).json({ success: false, error: 'Only the owner can archive a style or bring one back.' }); return }
  next()
}

router.put('/prices', ...changers, async (req: any, res) => {
  try {
    const prices = Array.isArray(req.body?.prices) ? req.body.prices.slice(0, 300).map((p: any) => ({ part: String(p?.part ?? ''), cents: Number(p?.cents) })) : []
    const out = await saveStylePrices(await actorOf(req), prices)
    if (out.priced.length) {
      await audit(req, 'update', 'Inventory', 'price-list', { newValues: { priced: out.priced } })
      await auditSettingChange(req, 'price-list', null, { changedCosts: out.priced.map(p => `${p.name}: ${p.prevCents == null ? '(none)' : `$${(p.prevCents / 100).toFixed(2)}`} → $${(p.cents / 100).toFixed(2)}`) })
    }
    res.json({ success: true, data: out })
  } catch (err) { fail(res, err, 'save the prices') }
})

router.post('/', ...changers, async (req: any, res) => {
  try {
    const out = await saveStyleForm(await actorOf(req), req.body?.input)
    await audit(req, 'create', 'FenceStyleForm', `${out.record.material}:${out.record.key}`, { newValues: { label: out.record.label, styles: out.record.styles, items: out.record.items.map(i => i.name) } })
    await auditSettingChange(req, `fence-styles/${out.record.material}/${out.record.key}`, null, { styles: out.record.styles, items: out.record.items.map(i => i.name) })
    res.status(201).json({ success: true, data: out })
  } catch (err) { fail(res, err, 'add the style') }
})

router.put('/:material/:key', ...changers, async (req: any, res) => {
  try {
    const out = await saveStyleForm(await actorOf(req), { ...(req.body?.input ?? {}), material: matOf(req) }, keyOf(req))
    const edit = out.record.edits[out.record.edits.length - 1]
    await audit(req, 'update', 'FenceStyleForm', `${matOf(req)}:${keyOf(req)}`, { newValues: { label: out.record.label, edit } })
    await auditSettingChange(req, `fence-styles/${matOf(req)}/${keyOf(req)}`, null, { ...(edit?.renamed ? { renamed: `${edit.renamed.from} → ${edit.renamed.to}` } : {}), changedCosts: edit?.priced.map(p => `${p.name}: ${p.prevCents == null ? '(none)' : `$${(p.prevCents / 100).toFixed(2)}`} → $${(p.cents / 100).toFixed(2)}`) ?? [], added: edit?.added ?? [] })
    res.json({ success: true, data: out })
  } catch (err) { fail(res, err, 'save the style') }
})

router.get('/:material/:key/archive-check', ownerOnly, async (req: any, res) => {
  try { res.json({ success: true, data: await styleArchiveCheck(req.user.crmAccountId, matOf(req), keyOf(req)) }) }
  catch (err) { fail(res, err, 'check the style') }
})

for (const [path, archive] of [['remove', true], ['restore', false]] as const) {
  router.post(`/:material/:key/${path}`, ownerOnly, ...changers, async (req: any, res) => {
    try {
      const out = await archiveStyle(await actorOf(req), matOf(req), keyOf(req), archive)
      await audit(req, archive ? 'soft_delete' : 'restore', 'FenceStyleForm', `${matOf(req)}:${keyOf(req)}`, { newValues: { archived: archive, ...out } })
      await auditSettingChange(req, `fence-styles/${matOf(req)}/${keyOf(req)}`, { archived: !archive }, { archived: archive, styles: out.styles })
      res.json({ success: true, data: out })
    } catch (err) { fail(res, err, archive ? 'archive the style' : 'bring the style back') }
  })
}

export default router
