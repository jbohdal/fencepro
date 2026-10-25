/**
 * Warranty and service requests, at /api/service-tickets (lib/serviceTickets.ts). Staff only.
 *
 *   GET  /badges                     every past customer: { customerId, jobId, warrantyName, installDate, jobs }
 *   GET  /badge/:customerId          one customer's badge, or null (the reusable endpoint: a call screen can ask it too)
 *   GET  /context?jobId=             the request form for a job: its warranty, a hint per issue, the texting answer
 *   GET  /?customerId=|jobId=|all=1  tickets (the company's open ones when nothing is given)
 *   GET  /report?from=YYYY-MM&to=    tickets by month, covered vs not, covered work's cost by style and installer (costs.view)
 *   GET  /:id                        one ticket with its photos (and its covered work's cost for costs.view)
 *   POST /                           { id?, jobId, issue, notes } make one (anyone on staff)
 *   POST /:id/photo-link             "Ask for photos": the no login link /p/s/<link>, open 14 days (anyone on staff)
 *   POST /:id/stage                  { stage, note? } move it by hand; closing or reopening is service.decide
 *   POST /:id/decision               { decision: covered | not_covered | null, reason, shared } (service.decide)
 *   POST /:id/appointment            { appointmentId } the service appointment booked for it (anyone on staff)
 *   POST /:id/fixed                  { fixedOn, crew, materials } Fixed; covered work's cost (service.decide when covered)
 *   DELETE /:id                      remove it (records.delete); its photos stay on the job
 *
 * Nothing is sent to a customer from here: the office's phone sends the text.
 */

import { refuseCrewWith } from '../lib/crewScope.js'
import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { can, refuse, requireCan, roleOf } from '../lib/permissions.js'
import { plainZod } from '../lib/plainZod.js'
import { audit } from '../lib/auditLog.js'
import {
  pastCustomerBadges, pastCustomerBadge, jobContext, createTicket, ticketOf, ticketView, listTickets, askForPhotos, setStage, decide,
  linkAppointment, markFixed, report, today,
} from '../lib/serviceTickets.js'
import { ISSUE_KEYS, STAGE_KEYS } from '../lib/serviceTicketModel.js'

const router = Router()
router.use(requireUser, requireAccount)

async function actorOf(req: any) {
  const me = await prisma.crmUser.findUnique({ where: { id: String(req.user.id) }, select: { firstName: true, lastName: true } }).catch(() => null)
  return { id: req.user.id ?? null, name: `${me?.firstName || ''} ${me?.lastName || ''}`.trim() || String(req.user.email || 'Staff') }
}

function fail(res: any, e: unknown, what: string) {
  if (e instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(e) }); return }
  const status = (e as any)?.status
  if (typeof status === 'number') { res.status(status).json({ success: false, error: (e as Error).message }); return }
  console.error(`[service] ${what}:`, e)
  res.status(500).json({ success: false, error: `Could not ${what}` })
}

const view = (req: any, t: Parameters<typeof ticketView>[0]) => ticketView(t, { costs: can(roleOf(req), 'costs.view') })

router.get('/badges', async (req: any, res) => {
  try { res.json({ success: true, data: await pastCustomerBadges(req.user.crmAccountId) }) } catch (e) { fail(res, e, 'read the past customers') }
})

router.get('/badge/:customerId', async (req: any, res) => {
  try { res.json({ success: true, data: await pastCustomerBadge(req.user.crmAccountId, String(req.params.customerId)) }) } catch (e) { fail(res, e, 'read the past customer badge') }
})

router.get('/context', async (req: any, res) => {
  try {
    const c = await jobContext(req.user.crmAccountId, String(req.query.jobId || ''))
    if (!c) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    res.json({ success: true, data: c })
  } catch (e) { fail(res, e, 'read the job\'s warranty') }
})

router.get('/report', requireCan('costs.view'), async (req: any, res) => {
  try {
    const ym = /^\d{4}-\d{2}$/
    const now = today().slice(0, 7)
    const to = ym.test(String(req.query.to || '')) ? String(req.query.to) : now
    const [y, m] = to.split('-').map(Number)
    const back = new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 7)
    const from = ym.test(String(req.query.from || '')) ? String(req.query.from) : back
    if (from > to) { res.status(400).json({ success: false, error: 'The first month is after the last.' }); return }
    res.json({ success: true, data: await report(req.user.crmAccountId, from, to) })
  } catch (e) { fail(res, e, 'make the service report') }
})

router.get('/', async (req: any, res) => {
  try {
    const f = { customerId: req.query.customerId ? String(req.query.customerId) : undefined, jobId: req.query.jobId ? String(req.query.jobId) : undefined, all: req.query.all === '1' }
    res.json({ success: true, data: await listTickets(req.user.crmAccountId, f, can(roleOf(req), 'costs.view')) })
  } catch (e) { fail(res, e, 'read the service requests') }
})

router.get('/:id', async (req: any, res) => {
  try {
    const t = await ticketOf(req.user.crmAccountId, String(req.params.id))
    if (!t) { res.status(404).json({ success: false, error: 'Service request not found' }); return }
    res.json({ success: true, data: await view(req, t) })
  } catch (e) { fail(res, e, 'read the service request') }
})

const createSchema = z.object({
  id: z.string().uuid().optional(),
  jobId: z.string().min(1).max(100),
  issue: z.enum(ISSUE_KEYS),
  notes: z.string().trim().max(2000).default(''),
})

// Booking a service call is the office's and the sales side's, not the Installer's (review, Oct 25, 2026).
router.post('/', refuseCrewWith('Service calls are booked by the office. Tell the office what you saw.'), async (req: any, res) => {
  try {
    const b = createSchema.parse(req.body)
    const t = await createTicket(req.user.crmAccountId, await actorOf(req), b)
    await audit(req, 'create', 'ServiceTicket', t.id, { newValues: { jobId: t.jobId, issue: t.issue, hint: t.hint } })
    res.status(201).json({ success: true, data: await view(req, t) })
  } catch (e) { fail(res, e, 'make the service request') }
})

/** Load the ticket or answer 404. */
async function load(req: any, res: any) {
  const t = await ticketOf(req.user.crmAccountId, String(req.params.id))
  if (!t) res.status(404).json({ success: false, error: 'Service request not found' })
  return t
}

router.post('/:id/photo-link', async (req: any, res) => {
  try {
    const t = await load(req, res); if (!t) return
    const out = await askForPhotos(t, await actorOf(req))
    await audit(req, 'update', 'ServiceTicket', t.id, { newValues: { photoLink: true, expiresAt: out.uploadExpiresAt } })
    res.json({ success: true, data: await view(req, out) })
  } catch (e) { fail(res, e, 'make the photo link') }
})

const stageSchema = z.object({ stage: z.enum(STAGE_KEYS), note: z.string().trim().max(500).default('') })

router.post('/:id/stage', async (req: any, res) => {
  try {
    const b = stageSchema.parse(req.body)
    const t = await load(req, res); if (!t) return
    if ((b.stage === 'closed' || t.stage === 'closed') && !can(roleOf(req), 'service.decide')) { refuse(res, 'service.decide'); return }
    if (b.stage === 'fixed') { res.status(400).json({ success: false, error: 'Use Fixed: covered work needs its hours and materials.' }); return }
    const out = await setStage(t, b.stage, await actorOf(req), b.note)
    await audit(req, 'update', 'ServiceTicket', t.id, { oldValues: { stage: t.stage }, newValues: { stage: out.stage } })
    res.json({ success: true, data: await view(req, out) })
  } catch (e) { fail(res, e, 'move the service request') }
})

const decisionSchema = z.object({
  decision: z.enum(['covered', 'not_covered']).nullable(),
  reason: z.string().trim().max(1000).default(''),
  shared: z.boolean().default(false),
}).refine(v => v.decision === null || v.reason.length > 0, { message: 'Please say why', path: ['reason'] })

router.post('/:id/decision', requireCan('service.decide'), async (req: any, res) => {
  try {
    const b = decisionSchema.parse(req.body)
    const t = await load(req, res); if (!t) return
    const out = await decide(t, b, await actorOf(req))
    await audit(req, 'update', 'ServiceTicket', t.id, { oldValues: { decision: t.decision, reason: t.decisionReason }, newValues: { decision: out.decision, reason: out.decisionReason, shared: out.decisionShared } })
    res.json({ success: true, data: await view(req, out) })
  } catch (e) { fail(res, e, 'save the decision') }
})

router.post('/:id/appointment', async (req: any, res) => {
  try {
    const b = z.object({ appointmentId: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, 'Not an appointment') }).parse(req.body)
    const t = await load(req, res); if (!t) return
    const out = await linkAppointment(t, b.appointmentId, await actorOf(req))
    await audit(req, 'update', 'ServiceTicket', t.id, { newValues: { appointmentId: out.appointmentId, stage: out.stage } })
    res.json({ success: true, data: await view(req, out) })
  } catch (e) { fail(res, e, 'book the visit') }
})

const fixedSchema = z.object({
  fixedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the day it was fixed'),
  crew: z.array(z.object({ name: z.string().trim().max(100), hours: z.number().min(0).max(200) })).max(20).default([]),
  materials: z.array(z.object({
    inventoryItemId: z.string().max(100).nullable().optional(), part: z.string().trim().max(200), qty: z.number().min(0).max(10_000),
    unitCents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  })).max(100).default([]),
})

router.post('/:id/fixed', async (req: any, res) => {
  try {
    const t = await load(req, res); if (!t) return
    // Covered work is costed: the owner and the office enter it.
    if (t.decision === 'covered' && !can(roleOf(req), 'service.decide')) { refuse(res, 'service.decide'); return }
    const b = t.decision === 'covered' ? fixedSchema.parse(req.body) : fixedSchema.partial().parse(req.body ?? {})
    if (t.decision === 'covered' && !b.crew!.some(c => c.hours > 0)) { res.status(400).json({ success: false, error: 'Enter the crew hours: covered work is costed.' }); return }
    const out = await markFixed(t, b.fixedOn ? { fixedOn: b.fixedOn, crew: b.crew ?? [], materials: b.materials ?? [] } : null, await actorOf(req))
    await audit(req, 'update', 'ServiceTicket', t.id, { oldValues: { stage: t.stage }, newValues: { stage: 'fixed' } })
    res.json({ success: true, data: await view(req, out) })
  } catch (e) { fail(res, e, 'mark it fixed') }
})

router.delete('/:id', requireCan('records.delete'), async (req: any, res) => {
  try {
    const t = await load(req, res); if (!t) return
    await prisma.serviceTicket.update({ where: { id: t.id }, data: { deletedAt: new Date(), uploadExpiresAt: new Date(), version: { increment: 1 } } })
    await audit(req, 'delete', 'ServiceTicket', t.id, { oldValues: { jobId: t.jobId, issue: t.issue, stage: t.stage } })
    res.json({ success: true })
  } catch (e) { fail(res, e, 'remove the service request') }
})

export default router
