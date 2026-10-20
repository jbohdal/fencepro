/**
 * Good, Better, Best tier sets (/api/tier-sets): one set per fence category.
 * Listing makes the company's starting sets first, once (lib/tierSets.ts).
 *
 *   GET    /             every set, in order
 *   POST   /             a new set for a category (body id: the screen's own id; sent twice, one set)
 *   PUT    /:id          tiers, Most popular, order (body version: refused if someone saved since)
 *   DELETE /:id
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/auditLog.js'
import { auditSettingChange } from '../lib/settingsAudit.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { clientIdSchema } from '../lib/clientId.js'
import { createOnce, isUniqueViolation } from '../lib/once.js'
import { plainZod } from '../lib/plainZod.js'
import { ensureTierSets, tierSetBodySchema } from '../lib/tierSets.js'
import { requireCan } from '../lib/permissions.js'

const router = Router()
router.use(requireUser, requireAccount)

const order = [{ sortOrder: 'asc' as const }, { category: 'asc' as const }]

function fail(res: any, err: unknown, what: string) {
  if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
  console.error(`[tier-sets] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}.` })
}

router.get('/', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    await ensureTierSets(accountId)
    const rows = await prisma.proposalTierSet.findMany({ where: { accountId }, orderBy: order })
    res.json({ success: true, data: rows })
  } catch (err) { fail(res, err, 'load the tier sets') }
})

const createSchema = tierSetBodySchema.extend({ category: z.string().trim().min(1, 'Pick a category').max(80) })

router.post('/', requireCan('prices.change'), async (req: any, res) => {
  try {
    const body = createSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    const id = clientIdSchema.parse(req.body?.id)
    const taken = await prisma.proposalTierSet.findFirst({ where: { accountId, category: { equals: body.category, mode: 'insensitive' } } })
    if (taken && taken.id !== id) { res.status(409).json({ success: false, error: `There is already a set for ${taken.category}.`, data: taken }); return }
    const max = await prisma.proposalTierSet.aggregate({ where: { accountId }, _max: { sortOrder: true } })
    let made
    try {
      made = await createOnce(id,
        x => prisma.proposalTierSet.findUnique({ where: { id: x } }),
        row => row.accountId === accountId,
        x => prisma.proposalTierSet.create({ data: {
          ...(x ? { id: x } : {}), accountId, category: body.category, tiers: body.tiers as any,
          popular: body.popular ?? null, sortOrder: body.sortOrder ?? (max._max.sortOrder ?? -1) + 1,
        } }))
    } catch (e) {
      // The same category made at the same moment by another request (another id).
      if (!isUniqueViolation(e)) throw e
      const won = await prisma.proposalTierSet.findFirst({ where: { accountId, category: body.category } })
      res.status(409).json({ success: false, error: `There is already a set for ${body.category}.`, data: won }); return
    }
    if (made.created) await audit(req, 'create', 'ProposalTierSet', made.row.id, { newValues: { category: made.row.category } }).catch(() => {})
    if (made.created) await auditSettingChange(req, `tier-set/${made.row.category}`, null, { tiers: made.row.tiers, popular: made.row.popular })
    res.status(made.created ? 201 : 200).json({ success: true, data: made.row })
  } catch (err) { fail(res, err, 'add the tier set') }
})

router.put('/:id', requireCan('prices.change'), async (req: any, res) => {
  try {
    const body = tierSetBodySchema.parse(req.body)
    const version = z.number().int().optional().parse(req.body?.version)
    const accountId = req.user.crmAccountId
    const cur = await prisma.proposalTierSet.findFirst({ where: { id: String(req.params.id), accountId } })
    if (!cur) { res.status(404).json({ success: false, error: 'This tier set was deleted on another device.' }); return }
    const popular = body.popular && body.tiers.some(t => t.key === body.popular) ? body.popular : null
    const done = await prisma.proposalTierSet.updateMany({
      where: { id: cur.id, ...(version != null ? { version } : {}) },
      data: { tiers: body.tiers as any, popular, ...(body.sortOrder != null ? { sortOrder: body.sortOrder } : {}), version: { increment: 1 } },
    })
    const row = await prisma.proposalTierSet.findUnique({ where: { id: cur.id } })
    if (done.count === 0) { res.status(409).json({ success: false, error: 'Someone else saved this tier set just now. Their version is shown; make your change again.', data: row }); return }
    await audit(req, 'update', 'ProposalTierSet', cur.id, { oldValues: { tiers: cur.tiers, popular: cur.popular }, newValues: { tiers: body.tiers, popular } }).catch(() => {})
    await auditSettingChange(req, `tier-set/${cur.category}`, { tiers: cur.tiers, popular: cur.popular }, { tiers: row?.tiers, popular: row?.popular })
    res.json({ success: true, data: row })
  } catch (err) { fail(res, err, 'save the tier set') }
})

router.delete('/:id', requireCan('prices.change'), async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const gone = await prisma.proposalTierSet.findFirst({ where: { id: String(req.params.id), accountId } })
    const n = await prisma.proposalTierSet.deleteMany({ where: { id: String(req.params.id), accountId } })
    if (n.count) await audit(req, 'delete', 'ProposalTierSet', String(req.params.id), {}).catch(() => {})
    if (n.count && gone) await auditSettingChange(req, `tier-set/${gone.category}`, { tiers: gone.tiers, popular: gone.popular }, null, { deleted: true })
    res.json({ success: true, data: { deleted: n.count } })
  } catch (err) { fail(res, err, 'delete the tier set') }
})

export default router
