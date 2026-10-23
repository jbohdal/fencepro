/**
 * Change orders at /api/change-orders (lib/changeOrders.ts).
 *
 *   GET   /?quoteId= | ?jobId=   a quote's (or a job's) change orders; no query: all of them
 *   POST  /                      make one on a signed quote { id?, quoteId | jobId, reason, lines, scope?, status? }
 *   PATCH /:id                   { baseVersion, reason?, lines?, status? } (sent, approved, void)
 *   POST  /:id/link              the customer's link token (/p/co/<token>), made once; the app sends it from the phone
 *   POST  /:id/sign              the customer signs on this phone, in person { name, signature }
 *   GET   /timeline?jobId=       the job's timeline (contract, change orders, billing lines, pull sheet revisions) and a schedule warning
 *   GET   /pick-list?quoteId= | ?jobId=   the Repair price list and the Inventory catalog priced for the job's style (prices only)
 *   GET   /pick-price?quoteId=&source=&qty=   one picked item at a quantity
 *
 * Approving (at once, or a sent one) is "approved verbally" with a reason:
 * the customer's copy stays "not signed by you yet" until they sign. A change
 * from the yard drawing sends `work` ({ request, layout, planSvg }): the
 * server prices it (lib/changeOrderWork.ts) and keeps the new work, its cost
 * difference and a warranty switch.
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
import { createChangeOrder, editChangeOrder, importFromKv, view, quoteOfJob, linkFor, signByCustomer, CO_STATUSES } from '../lib/changeOrders.js'
import { hidesCosts } from '../lib/costRedact.js'
import { scheduleFit } from '../lib/changeOrderWork.js'
import { jobTimeline } from '../lib/changeOrderHistory.js'
import { signSchema } from './changeOrderPublic.js'
import { pickListFor, pickPriceFor } from '../lib/changeOrderPicks.js'

const router = Router()
router.use(requireUser, requireAccount)

const lineSchema = z.object({
  id: z.string().min(1).max(64),
  description: z.string().max(500),
  amountCents: z.number().int().min(-100_000_000).max(100_000_000),
  // Picked from the pick list: how many, and where it came from (kept for history).
  qty: z.number().int().min(1).max(10_000).optional(),
  source: z.object({
    kind: z.enum(['repair', 'catalog']), ref: z.string().min(1).max(200), label: z.string().max(300).default(''),
    fenceStyle: z.string().max(200).optional(), listCents: z.number().int().min(-100_000_000).max(100_000_000).optional(),
  }).strict().optional().nullable(),
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
  // Approved at once: approved verbally, why (required then).
  verbalReason: z.string().max(500).optional(),
  // From the yard drawing: what to price (the quote builder's request), the drawing and its plan picture.
  work: z.object({ request: z.record(z.string(), z.any()), layout: z.any().optional(), planSvg: z.string().max(400_000).optional().nullable() }).optional().nullable(),
})
const editSchema = z.object({
  reason: z.string().max(1000).optional(),
  lines: z.array(lineSchema).min(1).max(50).optional(),
  status: z.enum(CO_STATUSES as [string, ...string[]]).optional(),
  verbalReason: z.string().max(500).optional(),
})

async function who(req: any): Promise<string> {
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  return u ? `${u.firstName} ${u.lastName}`.trim() || req.user.email : req.user.email
}

/** The view for this login: the cost difference only for a login that sees costs. */
const viewFor = (req: any) => (r: any) => ({ ...view(r), ...(hidesCosts(roleOf(req)) ? {} : { costDelta: r.costDelta ?? null }) })

/** The schedule warning of the quote's job after an approval (null: it fits, or no job). */
async function warningFor(accountId: string, quoteId: string): Promise<string | null> {
  const job = await prisma.savedJob.findFirst({ where: { accountId, quoteId, deletedAt: null, archivedAt: null }, select: { id: true } })
  return job ? scheduleFit(accountId, job.id) : null
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
    const rows = await prisma.changeOrder.findMany({ where: { accountId, deletedAt: null, ...(quoteId ? { quoteId } : {}) }, orderBy: [{ quoteId: 'asc' }, { number: 'asc' }] })
    res.json({ success: true, data: rows.map(viewFor(req)) })
  } catch (e) { fail(res, e, 'load change orders') }
})

router.post('/', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const body = createSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    if (body.status === 'approved' && !can(roleOf(req), 'billing.change')) { refuse(res, 'billing.change'); return }
    const quoteId = body.quoteId ?? (body.jobId ? await quoteOfJob(accountId, body.jobId) : null)
    if (!quoteId) { res.status(400).json({ success: false, error: 'This job has no quote, so a change order cannot be added to it.' }); return }
    const row = await createChangeOrder(accountId, { id: body.id, quoteId, reason: body.reason, lines: body.lines, scope: body.scope ?? null, status: body.status, by: await who(req), verbalReason: body.verbalReason ?? null, work: body.work ?? null })
    await audit(req, 'create', 'ChangeOrder', row.id, { newValues: view(row) })
    res.status(201).json({ success: true, data: viewFor(req)(row), ...(row.status === 'approved' ? { scheduleWarning: await warningFor(accountId, quoteId) } : {}) })
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
    res.json({ success: true, data: viewFor(req)(row), ...(row.status !== cur.status ? { scheduleWarning: await warningFor(accountId, row.quoteId) } : {}) })
  } catch (e) { fail(res, e, 'save the change order') }
})

router.post('/:id/link', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const { token, row } = await linkFor(req.user.crmAccountId, String(req.params.id))
    res.json({ success: true, data: { token, changeOrder: view(row) } })
  } catch (e) { fail(res, e, 'make the customer link') }
})

// The customer signs on this phone, in person (the phone handed to them). A draft is signed too (it was never sent).
router.post('/:id/sign', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const b = signSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    const cur = await prisma.changeOrder.findUnique({ where: { id: String(req.params.id) } })
    if (!cur || cur.accountId !== accountId || cur.deletedAt) { res.status(404).json({ success: false, error: 'Change order not found' }); return }
    const witness = await who(req)
    const { row, again } = await signByCustomer(accountId, cur.id, { name: b.name, signature: b.signature, ip: req.ip ?? null, userAgent: String(req.headers['user-agent'] ?? '') || null, via: 'in_person', witness })
    if (!again) await audit(req, 'update', 'ChangeOrder', row.id, { oldValues: view(cur), newValues: { ...view(row), signedInPersonWith: witness } })
    res.json({ success: true, data: viewFor(req)(row), scheduleWarning: await warningFor(accountId, row.quoteId) })
  } catch (e) { fail(res, e, 'save the signature') }
})

/** The quote asked about: ?quoteId=, else the job's (?jobId=). */
async function quoteAsked(req: any): Promise<string | null> {
  if (typeof req.query.quoteId === 'string' && req.query.quoteId) return req.query.quoteId
  if (typeof req.query.jobId === 'string' && req.query.jobId) return quoteOfJob(req.user.crmAccountId, req.query.jobId)
  return null
}

router.get('/pick-list', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const quoteId = await quoteAsked(req)
    if (!quoteId) { res.status(400).json({ success: false, error: 'Which quote? This job has no quote.' }); return }
    res.json({ success: true, data: await pickListFor(req.user.crmAccountId, quoteId) })
  } catch (e) { fail(res, e, 'load the price list') }
})

router.get('/pick-price', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const quoteId = await quoteAsked(req)
    if (!quoteId) { res.status(400).json({ success: false, error: 'Which quote? This job has no quote.' }); return }
    const source = String(req.query.source ?? '')
    const qty = Number(req.query.qty ?? 1)
    if (!source || source.length > 250 || !Number.isInteger(qty) || qty < 1 || qty > 10_000) { res.status(400).json({ success: false, error: 'Pick an item and a quantity from 1 to 10,000.' }); return }
    res.json({ success: true, data: await pickPriceFor(req.user.crmAccountId, quoteId, source, qty) })
  } catch (e) { fail(res, e, 'price the item') }
})

router.get('/timeline', async (req: any, res) => {
  try {
    const out = await jobTimeline(req.user.crmAccountId, String(req.query.jobId ?? ''))
    if (!out) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    res.json({ success: true, data: out })
  } catch (e) { fail(res, e, 'load the job history') }
})

export default router
