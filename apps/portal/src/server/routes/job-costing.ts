/**
 * Job costing at /api/job-costing (lib/jobCosting.ts).
 *
 * The takeoff (any staff login on the job; the crew's phone):
 *   GET  /takeoff?jobId=             the job's takeoff, quantities only, or null
 *   POST /takeoff                    start it { id (the phone's), jobId }
 *   PUT  /takeoff/:id/lines/:lineId  one line: used, back to shop, back to vendor, note, photo;
 *                                    an added item (extra) or its removal { removed: true }
 *   PUT  /takeoff/:id/labor          sub units paid (and "Sub paid $") or crew hours, and the install date
 *   POST /takeoff/:id/submit         the crew (or office) is done
 * Owner and office only (costs.view):
 *   POST /takeoff/:id/approve        { otherLaborCostCents? } freezes the actual cost; refused for an installer
 *   POST /takeoff/:id/reopen         back to submitted (the frozen cost is cleared)
 *   GET  /job/:jobId                 quoted vs actual, line by line
 *   GET  /report?from=&to=           every completed job, for Reports
 *   GET  /finance                    approved crew labor, for the P&L
 *
 * Changes come from the phone's save queue and may arrive more than once: the
 * takeoff and each line carry the id the phone chose, and each change sets
 * values (twice is the same as once). A takeoff that was submitted is the
 * office's to change; one approved is read only until reopened.
 */

import { Router } from 'express'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { requireCan, roleOf, can } from '../lib/permissions.js'
import { plainZod } from '../lib/plainZod.js'
import { audit } from '../lib/auditLog.js'
import { clientIdSchema } from '../lib/clientId.js'
import { salesScopedRoute, onlyScopedJobs } from '../lib/salesScope.js'
import {
  startTakeoff, mutateTakeoff, takeoffView, linesOf, laborOf, quotedNow, actualNow, jobComparison, reportJobs, financeLabor,
} from '../lib/jobCosting.js'
import { qty, type TakeoffLine } from '../lib/jobCostingMath.js'

const router = Router()
router.use(requireUser, requireAccount)
// The Salesman (lib/salesScope.ts; Jonathan, Oct 28 2026): the takeoff, job cost, report and labor of the Salesman's
// own and assigned jobs only (costs and all: the Salesman sees costs); another job, or a takeoff on one, is a 404.
router.use(salesScopedRoute({
  refs: async (req, first) => {
    const seg = String(req.path || '/').split('/').filter(Boolean)
    if (first === 'job' && seg[1]) return { jobs: seg[1] }
    if (first === 'takeoff' && seg[1]) {
      const t = await prisma.jobTakeoff.findFirst({ where: { id: seg[1], accountId: req.user.crmAccountId }, select: { jobId: true } })
      return t ? { jobs: t.jobId } : null
    }
    return null
  },
  list: (body, s, req) => (req.path === '/report' ? onlyScopedJobs('jobs')(body, s) : req.path === '/finance' ? onlyScopedJobs()(body, s) : body),
}))

async function who(req: any): Promise<string> {
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  return u ? `${u.firstName} ${u.lastName}`.trim() : req.user.email
}

const fail = (res: any, e: unknown, what: string) => {
  if (e instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(e) }); return }
  const status = (e as any)?.status
  if (status === 403 || status === 404 || status === 409) { res.status(status).json({ success: false, error: (e as Error).message }); return }
  console.error(`[job-costing] ${what}:`, e)
  res.status(500).json({ success: false, error: `Could not ${what}` })
}

const office = (req: any) => can(roleOf(req), 'costs.view')
const locked = (msg: string) => Object.assign(new Error(msg), { status: 409 })

/**
 * The takeoff a change is for. Two phones that started the same job with no
 * signal each chose an id; the server kept the first. A change sent with the
 * other id (and its job, ?jobId=) goes to the one takeoff.
 */
async function tid(req: any): Promise<string> {
  const id = String(req.params.id)
  const jobId = typeof req.query.jobId === 'string' ? req.query.jobId : ''
  if (!jobId) return id
  if (await prisma.jobTakeoff.findUnique({ where: { id }, select: { id: true } })) return id
  const t = await prisma.jobTakeoff.findUnique({ where: { jobId }, select: { id: true, accountId: true } })
  return t && t.accountId === req.user.crmAccountId ? t.id : id
}

/** Who may change it now: anyone while it is a draft, the office once submitted, no one once approved. */
function mayChange(req: any, status: string, same: boolean) {
  if (same) return
  if (status === 'approved') throw locked('This takeoff is approved; it can no longer be changed.')
  if (status === 'submitted' && !office(req)) throw locked('This takeoff was sent to the office; ask the office to change it.')
}

const view = async (id: string) => takeoffView((await prisma.jobTakeoff.findUnique({ where: { id } }))!)

// ── The takeoff ───────────────────────────────────────────────────────────────

router.get('/takeoff', async (req: any, res) => {
  const jobId = String(req.query.jobId || '')
  if (!jobId) { res.status(400).json({ success: false, error: 'jobId is required' }); return }
  const t = await prisma.jobTakeoff.findUnique({ where: { jobId } })
  res.json({ success: true, data: t && t.accountId === req.user.crmAccountId ? await takeoffView(t) : null })
})

router.post('/takeoff', async (req: any, res) => {
  try {
    const b = z.object({ id: clientIdSchema.unwrap(), jobId: z.string().min(1).max(100) }).parse(req.body)
    const r = await startTakeoff(req.user.crmAccountId, b.jobId, await who(req), b.id)
    if (r.created) await audit(req, 'create', 'JobTakeoff', r.id, { newValues: { jobId: b.jobId } }).catch(() => {})
    res.status(r.created ? 201 : 200).json({ success: true, data: await view(r.id) })
  } catch (e) { fail(res, e, 'start the takeoff') }
})

const n = z.number().min(0).max(100_000)
const lineSchema = z.object({
  part: z.string().trim().min(1).max(300).optional(),
  inventoryItemId: z.string().max(200).nullable().optional(),
  usedQty: n, shopReturnQty: n.default(0), vendorReturnQty: n.default(0),
  extra: z.boolean().optional(),
  reason: z.enum(['', 'extra', 'broken', 'other']).default(''),
  note: z.string().max(2000).default(''),
  photoClientId: z.string().min(8).max(100).nullable().optional(),
  removed: z.boolean().optional(),
})

router.put('/takeoff/:id/lines/:lineId', async (req: any, res) => {
  try {
    const b = lineSchema.parse(req.body)
    const lineId = String(req.params.lineId)
    if (!/^[A-Za-z0-9_:-]{4,140}$/.test(lineId)) { res.status(400).json({ success: false, error: 'Invalid line' }); return }
    const id = await tid(req)
    await mutateTakeoff(req.user.crmAccountId, id, async (t, tx) => {
      const list = linesOf(t)
      const at = list.findIndex(l => l.id === lineId)
      if (b.removed) {
        if (at < 0) return // removed already
        if (!list[at].extra) throw Object.assign(new Error('A pull sheet line stays; set what was used to 0 instead.'), { status: 409 })
        mayChange(req, t.status, false)
        list.splice(at, 1)
      } else if (at >= 0) {
        const cur = list[at]
        const next: TakeoffLine = {
          ...cur, usedQty: qty(b.usedQty), shopReturnQty: qty(b.shopReturnQty), vendorReturnQty: qty(b.vendorReturnQty), note: b.note,
          photoClientId: b.photoClientId === undefined ? cur.photoClientId : b.photoClientId, reason: cur.extra ? (b.reason || cur.reason) : cur.reason,
        }
        const same = JSON.stringify(cur) === JSON.stringify(next)
        mayChange(req, t.status, same)
        if (same) return
        list[at] = next
      } else {
        // An item added on the job: needs its name. A pull sheet line this takeoff does not have is refused.
        if (b.extra !== true) throw Object.assign(new Error('That line is not on this takeoff'), { status: 409 })
        if (!b.part) throw Object.assign(new Error('Pick the item'), { status: 409 })
        mayChange(req, t.status, false)
        list.push({
          id: lineId, key: null, part: b.part, inventoryItemId: b.inventoryItemId ?? null, plannedQty: 0, usedQty: qty(b.usedQty),
          shopReturnQty: qty(b.shopReturnQty), vendorReturnQty: qty(b.vendorReturnQty), extra: true, reason: b.reason || 'extra', note: b.note, photoClientId: b.photoClientId ?? null,
        })
      }
      await tx.jobTakeoff.update({ where: { id: t.id }, data: { lines: list as any } })
    })
    res.json({ success: true, data: await view(id) })
  } catch (e) { fail(res, e, 'save the line') }
})

router.put('/takeoff/:id/labor', async (req: any, res) => {
  try {
    const b = z.object({
      mode: z.enum(['sub', 'crew']),
      subUnits: n.default(0),
      // "Sub paid $": what the sub was actually paid, in cents. A cost, so owner and office only (an
      // installer's is ignored, and never sees it: costRedact). null clears it; left out keeps it.
      subPaidCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
      crew: z.array(z.object({ id: z.string().min(1).max(64), name: z.string().max(100).default(''), hours: z.number().min(0).max(1000) })).max(30).default([]),
      installDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the install date').optional(),
      note: z.string().max(2000).optional(),
    }).parse(req.body)
    const id = await tid(req)
    await mutateTakeoff(req.user.crmAccountId, id, async (t, tx) => {
      const cur = laborOf(t)
      const labor = { ...cur, mode: b.mode, subUnits: qty(b.subUnits), subPaidCents: b.subPaidCents === undefined || !can(roleOf(req), 'costs.view') ? cur.subPaidCents ?? null : b.subPaidCents, crew: b.crew.map(c => ({ id: c.id, name: c.name, hours: qty(c.hours) })) }
      const installDate = b.installDate ?? t.installDate
      const note = b.note ?? t.note
      const same = JSON.stringify(cur) === JSON.stringify(labor) && installDate === t.installDate && note === t.note
      mayChange(req, t.status, same)
      if (same) return
      await tx.jobTakeoff.update({ where: { id: t.id }, data: { labor: labor as any, installDate, note } })
    })
    res.json({ success: true, data: await view(id) })
  } catch (e) { fail(res, e, 'save the labor') }
})

router.post('/takeoff/:id/submit', async (req: any, res) => {
  try {
    const id = await tid(req)
    const by = await who(req)
    await mutateTakeoff(req.user.crmAccountId, id, async (t, tx) => {
      if (t.status !== 'draft') return // sent again: it stands
      await tx.jobTakeoff.update({ where: { id: t.id }, data: { status: 'submitted', submittedAt: new Date(), submittedBy: by } })
    })
    await audit(req, 'update', 'JobTakeoff', id, { newValues: { status: 'submitted' } }).catch(() => {})
    res.json({ success: true, data: await view(id) })
  } catch (e) { fail(res, e, 'send the takeoff') }
})

// ── Owner and office ──────────────────────────────────────────────────────────

router.post('/takeoff/:id/approve', requireCan('costs.view'), async (req: any, res) => {
  try {
    const b = z.object({ otherLaborCostCents: z.number().int().min(0).max(100_000_000).default(0) }).parse(req.body ?? {})
    const id = await tid(req)
    const by = await who(req)
    const accountId = req.user.crmAccountId
    // Worked out first (it reads prices), then frozen under the lock if nothing changed meanwhile.
    const t0 = await prisma.jobTakeoff.findUnique({ where: { id } })
    if (!t0 || t0.accountId !== accountId) { res.status(404).json({ success: false, error: 'Takeoff not found' }); return }
    if (t0.status === 'approved') { res.json({ success: true, data: await view(id) }); return }
    const quoted = await quotedNow(accountId, t0.quoteId)
    const actual = await actualNow(accountId, t0, quoted, b.otherLaborCostCents, true)
    await mutateTakeoff(accountId, id, async (t, tx) => {
      if (t.status === 'approved') return
      if (t.updatedAt.getTime() !== t0.updatedAt.getTime()) throw locked('The takeoff changed a moment ago; open it again and approve.')
      await tx.jobTakeoff.update({ where: { id: t.id }, data: { status: 'approved', approvedAt: new Date(), approvedBy: by, submittedAt: t.submittedAt ?? new Date(), submittedBy: t.submittedBy ?? by, actualCost: actual as any } })
    })
    await audit(req, 'update', 'JobTakeoff', id, { newValues: { status: 'approved', totalCents: actual.totalCents } }).catch(() => {})
    res.json({ success: true, data: await view(id) })
  } catch (e) { fail(res, e, 'approve the takeoff') }
})

router.post('/takeoff/:id/reopen', requireCan('costs.view'), async (req: any, res) => {
  try {
    const id = await tid(req)
    await mutateTakeoff(req.user.crmAccountId, id, async (t, tx) => {
      if (t.status !== 'approved') return
      await tx.jobTakeoff.update({ where: { id: t.id }, data: { status: 'submitted', approvedAt: null, approvedBy: null, actualCost: Prisma.DbNull } })
    })
    await audit(req, 'update', 'JobTakeoff', id, { newValues: { status: 'submitted', reopened: true } }).catch(() => {})
    res.json({ success: true, data: await view(id) })
  } catch (e) { fail(res, e, 'reopen the takeoff') }
})

router.get('/job/:jobId', requireCan('costs.view'), async (req: any, res) => {
  try { res.json({ success: true, data: await jobComparison(req.user.crmAccountId, String(req.params.jobId)) }) } catch (e) { fail(res, e, 'load the job cost') }
})

router.get('/report', requireCan('costs.view'), async (req: any, res) => {
  try {
    const from = typeof req.query.from === 'string' && /^\d{4}-\d{2}/.test(req.query.from) ? req.query.from : undefined
    const to = typeof req.query.to === 'string' && /^\d{4}-\d{2}/.test(req.query.to) ? req.query.to : undefined
    res.json({ success: true, data: { jobs: await reportJobs(req.user.crmAccountId, from, to) } })
  } catch (e) { fail(res, e, 'load the report') }
})

router.get('/finance', requireCan('costs.view'), async (req: any, res) => {
  try { res.json({ success: true, data: await financeLabor(req.user.crmAccountId) }) } catch (e) { fail(res, e, 'load job labor') }
})

export default router
