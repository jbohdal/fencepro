/**
 * /api/deleted-records: Settings > Deleted Records (owner and admin).
 *
 *   GET  /api/deleted-records?type=customer   newest first, with what each took with it
 *   POST /api/deleted-records/:id/restore     put back what the snapshot captured
 *
 * Log rows are never deleted (there is no DELETE here).
 */

import { Router } from 'express'
import prisma from '../lib/prisma.js'
import { requireAuth } from '../middleware/auth.js'
import { requireCan } from '../lib/permissions.js'
import { audit } from '../lib/auditLog.js'
import { countsOf, DeleteError, labelOf, restoreDeletion, type Snapshot } from '../lib/deletion.js'

const router = Router()
router.use(requireAuth, requireCan('records.delete'))

const accountOf = (req: any): string | null => req.user?.crmAccountId ?? req.user?.accountId ?? null

/** What a person reads under the row: each thing the deletion took, by name. */
function summaryOf(s: Snapshot, entityId: string): string[] {
  return [
    ...s.rows.filter(r => r.id !== entityId).map(r => labelOf(r.model, r.row)),
    ...s.items.filter(i => i.id !== entityId).map(i => labelOf(i.doc, i.item)),
    ...s.hard.filter(h => h.id !== entityId).map(h => labelOf(h.model, h.row)),
  ]
}

router.get('/', async (req: any, res) => {
  try {
    const accountId = accountOf(req)
    if (!accountId) { res.status(403).json({ success: false, error: 'No tenant' }); return }
    const type = typeof req.query.type === 'string' && req.query.type ? req.query.type : undefined
    const take = Math.min(500, Math.max(1, Number(req.query.limit) || 200))
    const rows = await prisma.deletionLog.findMany({ where: { accountId, ...(type ? { entityType: type } : {}) }, orderBy: { deletedAt: 'desc' }, take })
    const userIds = [...new Set(rows.flatMap(r => [r.deletedByUserId, r.restoredByUserId]).filter((x): x is string => !!x))]
    const users = userIds.length ? await prisma.crmUser.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true, email: true } }) : []
    const who = (id: string | null) => { const u = users.find(x => x.id === id); return u ? `${u.firstName} ${u.lastName}`.trim() || u.email : null }
    res.json({ success: true, data: rows.map(r => {
      const snap = r.snapshot as unknown as Snapshot
      return {
        id: r.id, entityType: r.entityType, entityId: r.entityId, entityLabel: r.entityLabel,
        deletedAt: r.deletedAt, deletedBy: who(r.deletedByUserId), reason: r.reason,
        restoredAt: r.restoredAt, restoredBy: who(r.restoredByUserId), restoreResult: r.restoreResult,
        counts: countsOf(snap), children: summaryOf(snap, r.entityId),
      }
    }) })
  } catch (err) {
    console.error('[deleted-records] list error:', err)
    res.status(500).json({ success: false, error: 'Could not load Deleted Records' })
  }
})

router.post('/:id/restore', async (req: any, res) => {
  try {
    const accountId = accountOf(req)
    if (!accountId) { res.status(403).json({ success: false, error: 'No tenant' }); return }
    const result = await restoreDeletion({ accountId, userId: req.user?.sub ?? req.user?.id ?? null }, String(req.params.id))
    await audit(req, 'restore', 'DeletionLog', String(req.params.id), { newValues: result })
    res.json({ success: true, data: result })
  } catch (err) {
    if (err instanceof DeleteError) { res.status(err.status).json({ success: false, error: err.message }); return }
    console.error('[deleted-records] restore error:', err)
    res.status(500).json({ success: false, error: 'Could not restore' })
  }
})

export default router
