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
import prisma from '../lib/prisma.js'
import { salesScopeOf } from '../lib/salesScope.js'

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

const EMPTY_VIEW = { textConsent: 'unknown', matches: [], mergedInto: null, merges: [] }

/**
 * The Salesman (lib/salesScope.ts): the possible matches on the Salesman's own customers, only with customers
 * the Salesman may see. A match with someone else's customer stays for the owner and office to decide (they
 * see it on the customer's page); the Salesman is never shown that customer's name, phone or address.
 * A customer outside the scope reads as one not on file (nothing to show).
 */
router.get('/customer/:id', async (req: any, res) => {
  try {
    const scope = await salesScopeOf(req)
    if (scope && !scope.contactIds.has(String(req.params.id))) { res.json({ success: true, data: EMPTY_VIEW }); return }
    const view = await matchView(accountOf(req)!, String(req.params.id))
    if (scope) {
      view.matches = view.matches.filter(m => scope.contactIds.has(m.customer.id))
      if (view.mergedInto && !scope.contactIds.has(view.mergedInto.id)) view.mergedInto = { ...view.mergedInto, name: 'another customer' }
    }
    res.json({ success: true, data: view })
  } catch (err) {
    // Not on the server (yet: a brand new customer still being saved), or not this company's: nothing to show, not a 404.
    if (err instanceof MergeError && err.status === 404) { res.json({ success: true, data: { textConsent: 'unknown', matches: [], mergedInto: null, merges: [] } }); return }
    fail(res, err, 'load the possible matches')
  }
})

/** Merge or Not the same person by the Salesman: both customers must be ones the Salesman sees (else 404). */
async function bothInScope(req: any, res: any, next: any) {
  const scope = await salesScopeOf(req)
  if (!scope) { next(); return }
  const m = await prisma.customerPossibleMatch.findFirst({ where: { id: String(req.params.id), accountId: accountOf(req)! }, select: { contactId: true, matchId: true } }).catch(() => null)
  if (!m || !scope.contactIds.has(m.contactId) || !scope.contactIds.has(m.matchId)) { res.status(404).json({ success: false, error: 'That possible match is not there any more.' }); return }
  next()
}

/** Undo a merge by the Salesman: only of a customer the Salesman sees (else 404). */
async function keptInScope(req: any, res: any, next: any) {
  const scope = await salesScopeOf(req)
  if (!scope) { next(); return }
  const mg = await prisma.customerMerge.findFirst({ where: { id: String(req.params.id), accountId: accountOf(req)! }, select: { keptId: true } }).catch(() => null)
  if (!mg || !scope.contactIds.has(mg.keptId)) { res.status(404).json({ success: false, error: 'That merge is not there.' }); return }
  next()
}

router.post('/:id/merge', requireCan('records.archive'), bothInScope, async (req: any, res) => {
  try {
    const r = await mergeMatch(actorOf(req), String(req.params.id))
    await audit(req, 'merged', 'CrmContact', r.keptId, { newValues: { mergeId: r.mergeId, kept: r.keptId, merged: r.mergedId, mergedName: r.mergedName, moved: r.movedIds } })
    const { movedIds: _ids, ...data } = r
    res.json({ success: true, data })
  } catch (err) { fail(res, err, 'merge') }
})

router.post('/:id/dismiss', requireCan('records.archive'), bothInScope, async (req: any, res) => {
  try {
    await dismissMatch(actorOf(req), String(req.params.id))
    await audit(req, 'update', 'CustomerPossibleMatch', String(req.params.id), { newValues: { status: 'dismissed' } })
    res.json({ success: true, data: { dismissed: true } })
  } catch (err) { fail(res, err, 'save that') }
})

router.post('/merges/:id/undo', requireCan('records.archive'), keptInScope, async (req: any, res) => {
  try {
    const r = await undoMerge(actorOf(req), String(req.params.id))
    await audit(req, 'merge_undone', 'CrmContact', r.keptId, { newValues: { mergeId: r.mergeId, kept: r.keptId, merged: r.mergedId, movedBack: r.moved, gone: r.gone } })
    res.json({ success: true, data: r })
  } catch (err) { fail(res, err, 'undo the merge') }
})

export default router
