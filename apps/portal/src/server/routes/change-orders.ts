/**
 * Change orders at /api/change-orders (lib/changeOrders.ts).
 *
 *   GET   /?quoteId= | ?jobId=   a quote's (or a job's) change orders; no query: all of them
 *   POST  /                      make one on a signed quote { id?, quoteId | jobId, reason (required), lines, scope?, status? }
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
 * and is for billing (owner, admin, manager, office). A Salesman's change order
 * waits for the owner's or office's OK, and her later change to its lines,
 * prices or words sends it back to wait again. A change order holds prices
 * only, never a cost.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { requireCan, roleOf, can, refuse } from '../lib/permissions.js'
import { plainZod } from '../lib/plainZod.js'
import { audit } from '../lib/auditLog.js'
import { baseVersionOf, refuseStale, refuseUnversioned } from '../lib/versioned.js'
import { createChangeOrder, editChangeOrder, importFromKv, view, quoteOfJob, linkFor, signByCustomer, CO_STATUSES, contractAround, alsoInDrawing, alsoInDrawingWords, reasonProblem } from '../lib/changeOrders.js'
import { hidesCosts } from '../lib/costRedact.js'
import { scheduleFit, startOfChange, effectiveWork } from '../lib/changeOrderWork.js'
import { shapeOf, sameShape, ownChangeWords } from '../lib/changeOrderMerge.js'
import { jobTimeline } from '../lib/changeOrderHistory.js'
import { isSalesman, salesmanLogin, salesmanOwnsJob, forSalesman } from '../lib/salesmanJobs.js'
import { signSchema } from './changeOrderPublic.js'
import { safeSvg } from './proposal.js'
import { changeOrderPhonesFor } from '../lib/signedDocuments.js'
import { pickListFor, pickPriceFor } from '../lib/changeOrderPicks.js'
import { askForOk, okGiven } from '../lib/changeOrderNotices.js'

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
const viewFor = (req: any, siblings: any[] = []) => (r: any) => ({ ...view(r, siblings.filter(s => s.quoteId === r.quoteId)), ...(hidesCosts(roleOf(req)) ? {} : { costDelta: r.costDelta ?? null }) })
/** The quote's change orders, for what a change order's drawing also shows (lib/changeOrders.ts alsoInDrawing). */
const siblingsOf = (r: { accountId: string; quoteId: string }) => prisma.changeOrder.findMany({ where: { accountId: r.accountId, quoteId: r.quoteId, deletedAt: null } })

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
    res.json({ success: true, data: rows.map(viewFor(req, rows)) })
  } catch (e) { fail(res, e, 'load change orders') }
})

router.post('/', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const body = createSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    if (body.status === 'approved' && !can(roleOf(req), 'billing.change')) { refuse(res, 'billing.change'); return }
    const quoteId = body.quoteId ?? (body.jobId ? await quoteOfJob(accountId, body.jobId) : null)
    if (!quoteId) { res.status(400).json({ success: false, error: 'This job has no quote, so a change order cannot be added to it.' }); return }
    // A Salesman's change order waits for the owner's or the office's OK before it goes to the customer (round 2, Oct 26 2026).
    const needsOk = !can(roleOf(req), 'billing.change')
    const by = await who(req)
    const known = body.id ? await prisma.changeOrder.findUnique({ where: { id: body.id }, select: { id: true } }) : null
    // The reason is required on a new one (a resend of one already saved is not refused).
    const noReason = known ? null : reasonProblem(body.reason)
    if (noReason) { res.status(400).json({ success: false, error: noReason }); return }
    const row = await createChangeOrder(accountId, { id: body.id, quoteId, reason: body.reason.trim(), lines: body.lines, scope: body.scope ?? null, status: needsOk ? 'needs_ok' : body.status, by, verbalReason: body.verbalReason ?? null, work: body.work ?? null })
    await audit(req, 'create', 'ChangeOrder', row.id, { newValues: view(row) })
    if (needsOk && !known) await askForOk(row, by)
    res.status(201).json({ success: true, data: viewFor(req, await siblingsOf(row))(row), ...(row.notice ? { notice: row.notice } : {}), ...(row.status === 'approved' ? { scheduleWarning: await warningFor(accountId, quoteId) } : {}) })
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
    // Approving, or taking an approved one back off the contract value, is billing's; so is the OK on a Salesman's.
    if ((edit.status === 'approved' || (edit.status === 'void' && cur.status === 'approved') || (edit.status === 'draft' && cur.status === 'needs_ok')) && !can(roleOf(req), 'billing.change')) { refuse(res, 'billing.change'); return }
    const by = await who(req)
    // A Salesman's change to an OK'd one goes back to "Waiting for OK" (lib/changeOrders.ts editChangeOrder).
    const { row, stale, backToOk } = await editChangeOrder(accountId, cur.id, base, edit as any, by, { needsOk: !can(roleOf(req), 'billing.change') })
    if (stale) { refuseStale(res, view(row), row.version); return }
    await audit(req, 'update', 'ChangeOrder', row.id, { oldValues: view(cur), newValues: view(row) })
    if (backToOk) await askForOk(row, by, true)
    // The OK (or a void before it): the "to OK" notices are cleared and the maker is told (lib/changeOrderNotices.ts).
    if (cur.status === 'needs_ok' && row.status !== 'needs_ok') await okGiven(row, by, row.status === 'void', roleOf(req))
    res.json({ success: true, data: viewFor(req, await siblingsOf(row))(row), ...(row.status !== cur.status ? { scheduleWarning: await warningFor(accountId, row.quoteId) } : {}) })
  } catch (e) { fail(res, e, 'save the change order') }
})

router.post('/:id/link', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const { token, row } = await linkFor(req.user.crmAccountId, String(req.params.id))
    res.json({ success: true, data: { token, changeOrder: view(row, await siblingsOf(row)) } })
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
    res.json({ success: true, data: viewFor(req, await siblingsOf(row))(row), scheduleWarning: await warningFor(accountId, row.quoteId) })
  } catch (e) { fail(res, e, 'save the signature') }
})

/**
 * What the customer sees when signing on this phone, exactly as their link
 * shows it (routes/changeOrderPublic.ts, round 3 recheck): the contract before
 * and with it, the new layout, its own change and the other change orders the
 * drawing also shows. Never a cost.
 */
router.get('/:id/for-signing', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const co = await prisma.changeOrder.findUnique({ where: { id: String(req.params.id) } })
    if (!co || co.accountId !== accountId || co.deletedAt) { res.status(404).json({ success: false, error: 'Change order not found' }); return }
    const q = await prisma.savedQuote.findFirst({ where: { id: co.quoteId, accountId }, select: { finalPrice: true, proposal: true } })
    const work = co.work as any
    const planSvg = work?.planSvg ? safeSvg(work.planSvg) || null : null
    const also = planSvg ? alsoInDrawingWords(alsoInDrawing(co, await siblingsOf(co))) : []
    // "Questions? Call ...": the number the signed PDF and the customer's link give.
    const questionsPhone = (await changeOrderPhonesFor(accountId, q?.proposal)).questions || null
    res.json({ success: true, data: { contract: await contractAround(co, q?.finalPrice ?? 0), planSvg, own: planSvg && also.length ? ownChangeWords(work) : null, alsoInDrawing: also, questionsPhone } })
  } catch (e) { fail(res, e, 'load the change order to sign') }
})

/** The quote asked about: ?quoteId=, else the job's (?jobId=). */
async function quoteAsked(req: any): Promise<string | null> {
  if (typeof req.query.quoteId === 'string' && req.query.quoteId) return req.query.quoteId
  if (typeof req.query.jobId === 'string' && req.query.jobId) return quoteOfJob(req.user.crmAccountId, req.query.jobId)
  return null
}

/**
 * What a change from the yard drawing starts from (round 3, Oct 26 2026): the
 * signed quote with every approved change order's change and every still open
 * one's (lib/changeOrderWork.ts startOfChange), quantities only, and the open
 * ones it includes, so the quote builder opens on the latest drawing.
 */
router.get('/start', requireCan('quotes.change'), async (req: any, res) => {
  try {
    const quoteId = await quoteAsked(req)
    if (!quoteId) { res.status(400).json({ success: false, error: 'Which quote? This job has no quote.' }); return }
    const start = await startOfChange(req.user.crmAccountId, quoteId)
    if (!start) { res.status(404).json({ success: false, error: 'Quote not found' }); return }
    const last = start.steps[start.steps.length - 1]
    const known: any = last ? effectiveWork(last.row) : start.quote
    const same = sameShape(shapeOf(known), start.shape)
    const layout = same && known?.layout && typeof known.layout === 'object' ? known.layout : { yard: start.shape.yard, runSections: [], ...(!start.shape.yard && start.shape.gateWidths ? { gateWidths: start.shape.gateWidths } : {}) }
    res.json({ success: true, data: {
      ...start.shape, layout, sections: same ? (known?.sections ?? null) : null,
      planSvg: same ? (last ? known?.planSvg ?? null : known?.proposal?.planSvg ?? null) : null,
      open: start.steps.filter(s => ['needs_ok', 'draft', 'sent'].includes(s.row.status)).map(s => ({ id: s.row.id, number: s.row.number, status: s.row.status })),
    } })
  } catch (e) { fail(res, e, 'load the drawing') }
})

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

// The contract price is in it: the owner, admin, manager, office and Salesman only (an Installer's window has no Job history).
// The Salesman: the Salesman's own jobs only, and no cost figure in its words (lib/salesmanJobs.ts; audit #49).
router.get('/timeline', requireCan('prices.view'), async (req: any, res) => {
  try {
    const jobId = String(req.query.jobId ?? '')
    const salesman = isSalesman(roleOf(req)) ? await salesmanLogin(String(req.user.id)) : null
    if (isSalesman(roleOf(req)) && (!salesman || !(await salesmanOwnsJob(salesman, jobId)))) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    const out = await jobTimeline(req.user.crmAccountId, jobId)
    if (!out) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    res.json({ success: true, data: salesman ? forSalesman(out) : out })
  } catch (e) { fail(res, e, 'load the job history') }
})

export default router
