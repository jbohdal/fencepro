/**
 * Change orders at /api/change-orders (lib/changeOrders.ts).
 *
 *   GET   /?quoteId= | ?jobId=   a quote's (or a job's) change orders; no query: all of them
 *   POST  /                      make one on a signed quote { id?, quoteId | jobId, reason, lines, scope?, status? }
 *   PATCH /:id                   { baseVersion, reason?, lines?, status? } (sent, approved, void)
 *
 * Who: anyone who may change quotes (a Salesman too) makes, edits and sends
 * them; approving one, or voiding an approved one, changes the contract value
 * and is for billing (owner, admin, manager, office). A change order holds
 * prices only, never a cost.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { requireCan, roleOf, can, refuse } from '../lib/permissions.js'
import { plainZod } from '../lib/plainZod.js'
import { audit } from '../lib/auditLog.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { createChangeOrder, editChangeOrder, importFromKv, view, quoteOfJob, CO_STATUSES } from '../lib/changeOrders.js'

const router = Router()
router.use(requireUser, requireAccount)

const lineSchema = z.object({
  id: z.string().min(1).max(64),
  description: z.string().max(500),
  amountCents: z.number().int().min(-100_000_000).max(100_000_000),
})
const createSchema = z.object({
  id: z.string().min(8).max(64).optional(),
  quoteId: z.string().min(1).optional(),
  jobId: z.string().min(1).optional(),
  reason: z.string().max(1000).default(''),
  lines: z.array(lineSchema).min(1).max(50),
  scope: z.object({
    footageFt: z.number().optional(), walkGates: z.number().optional(), dblGates: z.number().optional(), sections: z.number().optional(),
    fromStyle: z.string().max(200).optional(), toStyle: z.string().max(200).optional(),
  }).strict().optional().nullable(),
  status: z.enum(['draft', 'approved']).default('draft'),
})
const editSchema = z.object({
  reason: z.string().max(1000).optional(),
  lines: z.array(lineSchema).min(1).max(50).optional(),
  status: z.enum(CO_STATUSES as [string, ...string[]]).optional(),
})

async function who(req: any): Promise<string> {
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  return u ? `${u.firstName} ${u.lastName}`.trim() || req.user.email : req.user.email
}

const fail = (res: any, e: unknown, what: string) => {
  if (e instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(e) }); return }
  const status = (e as any)?.status
  if (status === 400 || status === 403 || status === 404 || status === 409) { res.status(status).json({ success: false, error: (e as Error).message }); return }
  console.error(`[change-orders] ${what}:`, e)
  res.status(500).json({ success: false, error: `Could not ${what}` })
}

router.get('/', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    await importFromKv(accountId)
    let quoteId = typeof req.query.quoteId === 'string' ? req.query.quoteId : null
    if (!quoteId && typeof req.query.jobId === 'string') quoteId = await quoteOfJob(accountId, req.query.jobId)
    if (!quoteId && (req.query.quoteId || req.query.jobId)) { res.json({ success: true, data: [] }); return }
    const rows = await prisma.changeOrder.findMany({ where: { accountId, ...(quoteId ? { quoteId } : {}) }, orderBy: [{ quoteId: 'asc' }, { number: 'asc' }] })
    res.json({ success: true, data: rows.map(view) })
  } catch (e) { fail(res, e, 'load change orders') }
})

router.post('/', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const body = createSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    if (body.status === 'approved' && !can(roleOf(req), 'billing.change')) { refuse(res, 'billing.change'); return }
    const quoteId = body.quoteId ?? (body.jobId ? await quoteOfJob(accountId, body.jobId) : null)
    if (!quoteId) { res.status(400).json({ success: false, error: 'This job has no quote, so a change order cannot be added to it.' }); return }
    const row = await createChangeOrder(accountId, { id: body.id, quoteId, reason: body.reason, lines: body.lines, scope: body.scope ?? null, status: body.status, by: await who(req) })
    await audit(req, 'create', 'ChangeOrder', row.id, { newValues: view(row) })
    res.status(201).json({ success: true, data: view(row) })
  } catch (e) { fail(res, e, 'save the change order') }
})

router.patch('/:id', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const edit = editSchema.parse(req.body)
    const base = baseVersionOf(req.body)
    if (base === null) { refuseUnversioned(res); return }
    const accountId = req.user.crmAccountId
    const cur = await prisma.changeOrder.findUnique({ where: { id: req.params.id } })
    if (!cur || cur.accountId !== accountId) { res.status(404).json({ success: false, error: 'Change order not found' }); return }
    // Approving, or taking an approved one back off the contract value, is billing's.
    if ((edit.status === 'approved' || (edit.status === 'void' && cur.status === 'approved')) && !can(roleOf(req), 'billing.change')) { refuse(res, 'billing.change'); return }
    const { row, stale } = await editChangeOrder(accountId, cur.id, base, edit as any, await who(req))
    if (stale) { refuseStale(res, view(row), row.version); return }
    await audit(req, 'update', 'ChangeOrder', row.id, { oldValues: view(cur), newValues: view(row) })
    res.json({ success: true, data: view(row) })
  } catch (e) { fail(res, e, 'save the change order') }
})

export default router
