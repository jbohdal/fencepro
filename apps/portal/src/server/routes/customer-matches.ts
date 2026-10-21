/**
 * /api/customer-matches: possible matches on a customer a website or phone
 * lead made, merging, and Undo merge (lib/customerMerge.ts).
 *
 *   GET  /api/customer-matches/customer/:id   open matches, "merged into", merge history
 *   POST /api/customer-matches/:id/merge      merge the new customer into the one on file
 *   POST /api/customer-matches/:id/dismiss    Not the same person (kept, never offered again)
 *   POST /api/customer-matches/merges/:id/undo
 *
 * Merge, dismiss and undo: records.archive (whoever may archive customers).
 * Each is in the audit log with exactly what moved.
 */

import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requireCan } from '../lib/permissions.js'
import { audit } from '../lib/auditLog.js'
import { MergeError, matchView, mergeMatch, dismissMatch, undoMerge } from '../lib/customerMerge.js'

const router = Router()
router.use(requireAuth)

const accountOf = (req: any): string | null => req.user?.crmAccountId ?? req.user?.accountId ?? null
const actorOf = (req: any) => ({ accountId: accountOf(req) as string, userId: (req.user?.sub ?? req.user?.id ?? null) as string | null })

function fail(res: any, err: unknown, what: string) {
  if (err instanceof MergeError) { res.status(err.status).json({ success: false, error: err.message }); return }
  console.error(`[customer-matches] ${what} error:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}. Try again.` })
}

const STAFF = new Set(['super_admin', 'admin', 'manager', 'office_staff', 'sales_rep', 'field_crew'])
router.use((req: any, res, next) => {
  // Staff of a company only (a customer's portal login has none).
  if (!accountOf(req) || !STAFF.has(req.user?.crmRole ?? req.user?.role)) { res.status(403).json({ success: false, error: 'No company on this login' }); return }
  next()
})

router.get('/customer/:id', async (req: any, res) => {
  try {
    res.json({ success: true, data: await matchView(accountOf(req)!, String(req.params.id)) })
  } catch (err) { fail(res, err, 'load the possible matches') }
})

router.post('/:id/merge', requireCan('records.archive'), async (req: any, res) => {
  try {
    const r = await mergeMatch(actorOf(req), String(req.params.id))
    await audit(req, 'merged', 'CrmContact', r.keptId, { newValues: { mergeId: r.mergeId, kept: r.keptId, merged: r.mergedId, mergedName: r.mergedName, moved: r.movedIds } })
    const { movedIds: _ids, ...data } = r
    res.json({ success: true, data })
  } catch (err) { fail(res, err, 'merge') }
})

router.post('/:id/dismiss', requireCan('records.archive'), async (req: any, res) => {
  try {
    await dismissMatch(actorOf(req), String(req.params.id))
    await audit(req, 'update', 'CustomerPossibleMatch', String(req.params.id), { newValues: { status: 'dismissed' } })
    res.json({ success: true, data: { dismissed: true } })
  } catch (err) { fail(res, err, 'save that') }
})

router.post('/merges/:id/undo', requireCan('records.archive'), async (req: any, res) => {
  try {
    const r = await undoMerge(actorOf(req), String(req.params.id))
    await audit(req, 'merge_undone', 'CrmContact', r.keptId, { newValues: { mergeId: r.mergeId, kept: r.keptId, merged: r.mergedId, movedBack: r.moved, gone: r.gone } })
    res.json({ success: true, data: r })
  } catch (err) { fail(res, err, 'undo the merge') }
})

export default router
