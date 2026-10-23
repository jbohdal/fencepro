/**
 * Appointments API
 *
 * Staff (signed in):
 *   GET    /api/appointments                 list (?from=&to= ISO, ?contactId=, ?all=1 includes archived)
 *   GET    /api/appointments/:id             one
 *   POST   /api/appointments                 book
 *   PATCH  /api/appointments/:id             change; send baseVersion, and a reason when moving the time
 *   GET    /api/appointments/geo/lookup      ?address= where an address is on the map
 *   POST   /api/appointments/geo/pin         { address, lat, lng } a position set by hand
 *
 * Website chat (no sign in, Botpress webhook):
 *   POST   /api/appointments                 book an estimate; the customer is found or added
 *
 * Every save is version checked like the pipeline: a change built on an older
 * copy is refused with the current one, so two devices never overwrite each
 * other. Nothing is ever sent to the customer from here; confirmations are
 * texts and emails Jonathan sends from his own phone.
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/auditLog.js'
import { resolveSecret } from '../lib/secrets.js'
import { syncCalendarAfterWrite } from '../lib/calendarSync/index.js'
import { refuseStale } from '../lib/versioned.js'
import { recordIntake, resolveIntakeAccountId } from '../lib/intake.js'
import {
  APPOINTMENT_TYPES, APPOINTMENT_STATUSES, APPOINTMENT_OUTCOMES, DEFAULT_MINUTES,
  contactSelect, toClient, locate, pinAddress,
} from '../lib/appointments.js'
import { plainZod } from '../lib/plainZod.js'
import { suggest } from '../lib/addressIndex.js'
import { withReps, assignedUserIdFor } from '../lib/appointmentRep.js'

const router = Router()

// Every appointment change goes to Google Calendar, in the background.
router.use(syncCalendarAfterWrite as any)

const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
const BOTPRESS_WEBHOOK_SECRET = process.env.BOTPRESS_WEBHOOK_SECRET || ''

async function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({ where: { id: payload.sub }, select: { crmAccountId: true } })
      crmAccountId = u?.crmAccountId ?? null
    }
    req.user = { id: payload.sub, email: payload.email, role: payload.role, crmAccountId, name: `${payload.firstName || ''} ${payload.lastName || ''}`.trim() }
    if (!crmAccountId) { res.status(403).json({ success: false, error: 'Your user is not linked to a company.' }); return }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

const iso = z.string().refine(s => !Number.isNaN(Date.parse(s)), 'Not a date and time')
const fields = {
  type: z.enum(APPOINTMENT_TYPES),
  status: z.enum(APPOINTMENT_STATUSES),
  startAt: iso.nullable(),
  endAt: iso.nullable(),
  allDay: z.boolean(),
  address: z.string().max(500),
  lat: z.number().min(-90).max(90).nullable(),
  lng: z.number().min(-180).max(180).nullable(),
  assignedTo: z.string().max(120),
  notes: z.string().max(10_000),
  outcome: z.enum(APPOINTMENT_OUTCOMES).nullable(),
  outcomeNotes: z.string().max(10_000),
  measuredFeet: z.number().int().min(0).max(100_000).nullable(),
  nextStep: z.string().max(2000),
  quoteId: z.string().max(80).nullable(),
  jobId: z.string().max(80).nullable(),
  startedAt: iso.nullable(),
}
const createSchema = z.object({ crmContactId: z.string().min(1), ...fields }).partial({
  status: true, endAt: true, allDay: true, address: true, lat: true, lng: true, assignedTo: true, notes: true,
  outcome: true, outcomeNotes: true, measuredFeet: true, nextStep: true, quoteId: true, jobId: true, startAt: true, startedAt: true,
}).extend({ id: z.string().uuid().optional() })
const patchSchema = z.object(fields).partial().extend({
  baseVersion: z.number().int().min(0),
  /** Why the time moved; kept in the history. */
  reason: z.string().max(500).optional(),
})

const dateOrNull = (s: string | null | undefined) => (s ? new Date(s) : null)
/** An appointment as the browser gets it, with the login it is with (`rep`: whose Direct phone the texts give). */
const one = async (accountId: string, a: any) => (await withReps(accountId, [toClient(a)]))[0]
const actor = (req: any) => req.user?.name || req.user?.email || 'staff'

/** Fill a missing position from the address, without holding up the save for long. */
async function withPosition(accountId: string, data: any) {
  if (data.address && (data.lat == null || data.lng == null)) {
    const p = await locate(accountId, data.address).catch(() => null)
    if (p) { data.lat = p.lat; data.lng = p.lng }
  }
  return data
}

/* ── Map ─────────────────────────────────────────────────────────────────── */

router.get('/geo/lookup', requireUser, async (req: any, res) => {
  const address = String(req.query.address || '').slice(0, 500)
  if (!address.trim()) { res.status(400).json({ success: false, error: 'address is required' }); return }
  const p = await locate(req.user.crmAccountId, address)
  res.json({ success: true, data: p })
})

// Address suggestions as an address is typed (Marion County's property list, then the Census lookup).
router.get('/geo/suggest', requireUser, async (req: any, res) => {
  const q = String(req.query.q || '').slice(0, 200).trim()
  if (q.length < 3) { res.json({ success: true, data: [] }); return }
  res.json({ success: true, data: await suggest(q) })
})

router.post('/geo/pin', requireUser, async (req: any, res) => {
  try {
    const body = z.object({ address: z.string().min(1).max(500), lat: fields.lat.unwrap(), lng: fields.lng.unwrap() }).parse(req.body)
    const moved = await pinAddress(req.user.crmAccountId, body.address, { lat: body.lat, lng: body.lng })
    res.json({ success: true, data: { lat: body.lat, lng: body.lng, appointmentsMoved: moved } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    res.status(500).json({ success: false, error: 'Could not save the position' })
  }
})

/* ── Staff ───────────────────────────────────────────────────────────────── */

router.get('/', requireUser, async (req: any, res) => {
  // Deleted ones never (Settings > Deleted Records); ?all=1 also lists the archived (cancelled) ones.
  const where: any = { accountId: req.user.crmAccountId, deletedAt: null }
  if (!req.query.all) where.archivedAt = null
  if (req.query.contactId) where.crmContactId = String(req.query.contactId)
  if (req.query.from || req.query.to) {
    where.OR = [
      { startAt: { ...(req.query.from ? { gte: new Date(String(req.query.from)) } : {}), ...(req.query.to ? { lt: new Date(String(req.query.to)) } : {}) } },
      { startAt: null },
    ]
  }
  const rows = await prisma.appointment.findMany({ where: { ...where, deletedAt: null }, include: { contact: { select: contactSelect } }, orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }] })
  res.json({ success: true, data: await withReps(req.user.crmAccountId, rows.map(toClient)) })
})

router.get('/:id', requireUser, async (req: any, res) => {
  const a = await prisma.appointment.findFirst({ where: { id: String(req.params.id), accountId: req.user.crmAccountId, deletedAt: null }, include: { contact: { select: contactSelect } } })
  if (!a) { res.status(404).json({ success: false, error: 'Appointment not found' }); return }
  res.json({ success: true, data: await one(req.user.crmAccountId, a), version: a.version })
})

async function bookByStaff(req: any, res: any) {
  try {
    const d = createSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    const contact = await prisma.crmContact.findFirst({ where: { id: d.crmContactId, accountId, deletedAt: null }, select: { id: true, serviceAddress: true } })
    if (!contact) { res.status(400).json({ success: false, error: 'That customer is not saved on the server yet. It will be booked once the customer is.' }); return }
    // Sent again because the phone did not hear the answer: the first one stands.
    if (d.id) {
      const already = await prisma.appointment.findFirst({ where: { id: d.id, accountId }, include: { contact: { select: contactSelect } } })
      if (already) { res.status(200).json({ success: true, data: await one(accountId, already), version: already.version }); return }
    }
    const start = dateOrNull(d.startAt)
    const allDay = d.allDay ?? d.type === 'install'
    const end = dateOrNull(d.endAt) ?? (start ? new Date(start.getTime() + (DEFAULT_MINUTES[d.type] || 60) * 60_000) : null)
    const data = await withPosition(accountId, {
      ...(d.id ? { id: d.id } : {}),
      accountId, crmContactId: contact.id, type: d.type, status: d.status ?? 'scheduled',
      startAt: start, endAt: end, allDay,
      address: d.address ?? contact.serviceAddress ?? '', lat: d.lat ?? null, lng: d.lng ?? null,
      assignedTo: d.assignedTo ?? '', assignedToUserId: await assignedUserIdFor(accountId, d.assignedTo), notes: d.notes ?? '', quoteId: d.quoteId ?? null, jobId: d.jobId ?? null,
      outcome: d.outcome ?? null, outcomeNotes: d.outcomeNotes ?? '', measuredFeet: d.measuredFeet ?? null, nextStep: d.nextStep ?? '',
      source: 'manual', createdBy: actor(req),
      history: [{ at: new Date().toISOString(), by: actor(req), kind: 'booked', to: { startAt: start?.toISOString() ?? null, endAt: end?.toISOString() ?? null } }],
    })
    const a = await prisma.appointment.create({ data, include: { contact: { select: contactSelect } } })
    await audit(req, 'create', 'Appointment', a.id, { newValues: { type: a.type, startAt: a.startAt, assignedTo: a.assignedTo } })
    res.status(201).json({ success: true, data: await one(accountId, a), version: a.version })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    if ((err as any)?.code === 'P2002') {
      // The same booking arrived twice at once: the first one is the booking.
      const id = typeof req.body?.id === 'string' ? req.body.id : null
      const row = id ? await prisma.appointment.findFirst({ where: { id, accountId: req.user.crmAccountId }, include: { contact: { select: contactSelect } } }).catch(() => null) : null
      if (row) { res.status(200).json({ success: true, data: await one(req.user.crmAccountId, row), version: row.version }); return }
      res.status(409).json({ success: false, error: 'That appointment already exists' }); return
    }
    console.error('[appointments] create error:', err)
    res.status(500).json({ success: false, error: 'Could not book the appointment' })
  }
}

router.patch('/:id', requireUser, async (req: any, res) => {
  try {
    const { baseVersion, reason, ...d } = patchSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    const cur = await prisma.appointment.findFirst({ where: { id: String(req.params.id), accountId, deletedAt: null }, include: { contact: { select: contactSelect } } })
    if (!cur) { res.status(404).json({ success: false, error: 'Appointment not found' }); return }
    if (cur.version !== baseVersion) { refuseStale(res, await one(accountId, cur), cur.version); return }

    const data: any = { ...d }
    if ('startAt' in d) data.startAt = dateOrNull(d.startAt)
    if ('endAt' in d) data.endAt = dateOrNull(d.endAt)
    if ('startedAt' in d) data.startedAt = dateOrNull(d.startedAt)
    const history = Array.isArray(cur.history) ? [...(cur.history as any[])] : []
    const now = new Date().toISOString()
    const moved = ('startAt' in d && (data.startAt?.getTime() ?? null) !== (cur.startAt?.getTime() ?? null))
      || ('endAt' in d && (data.endAt?.getTime() ?? null) !== (cur.endAt?.getTime() ?? null))
    if (moved) {
      history.push({
        at: now, by: actor(req), kind: 'rescheduled', reason: reason || '',
        from: { startAt: cur.startAt?.toISOString() ?? null, endAt: cur.endAt?.toISOString() ?? null },
        to: { startAt: (data.startAt ?? cur.startAt)?.toISOString() ?? null, endAt: (data.endAt ?? cur.endAt)?.toISOString() ?? null },
      })
      // A time that changed is a rescheduled appointment, unless a status was given with it.
      if (!d.status && cur.startAt && ['scheduled', 'confirmed'].includes(cur.status)) data.status = 'rescheduled'
    }
    if (d.status && d.status !== cur.status) {
      history.push({ at: now, by: actor(req), kind: 'status', from: cur.status, to: d.status, ...(reason && !moved ? { reason } : {}) })
      if (d.status === 'completed' || d.status === 'no_show') data.completedAt = new Date()
    }
    if (d.status === 'on_my_way' && !cur.startedAt) data.startedAt = new Date()
    // Another person: the login it is with is matched again.
    if ('assignedTo' in d && d.assignedTo !== cur.assignedTo) data.assignedToUserId = await assignedUserIdFor(accountId, d.assignedTo)
    if ('address' in d && d.address !== cur.address && !('lat' in d)) { data.lat = null; data.lng = null; await withPosition(accountId, data) }
    data.history = history

    const done = await prisma.appointment.updateMany({ where: { id: cur.id, version: baseVersion }, data: { ...data, version: { increment: 1 } } })
    if (done.count === 0) {
      const now2 = await prisma.appointment.findUnique({ where: { id: cur.id }, include: { contact: { select: contactSelect } } })
      refuseStale(res, now2 ? await one(accountId, now2) : null, now2?.version ?? 0); return
    }
    const a = (await prisma.appointment.findUnique({ where: { id: cur.id }, include: { contact: { select: contactSelect } } }))!
    await audit(req, 'update', 'Appointment', a.id, { newValues: { ...d, reason } })
    res.json({ success: true, data: await one(accountId, a), version: a.version })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[appointments] update error:', err)
    res.status(500).json({ success: false, error: 'Could not save the appointment' })
  }
})

/* ── Website chat (Botpress) ─────────────────────────────────────────────── */

const chatSchema = z.object({
  botpressConversationId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  scheduledAt: iso,
  duration: z.number().positive().optional(),
  type: z.string().default('estimate'),
  notes: z.string().optional(),
})

async function bookFromChat(req: any, res: any) {
  if (BOTPRESS_WEBHOOK_SECRET) {
    const secret = req.headers['x-botpress-secret'] || req.headers['x-webhook-secret']
    if (secret !== BOTPRESS_WEBHOOK_SECRET) { res.status(401).json({ success: false, error: 'Invalid webhook secret' }); return }
  }
  try {
    const d = chatSchema.parse(req.body)
    const accountId = await resolveIntakeAccountId()
    if (!accountId) { res.status(503).json({ success: false, error: 'No company is set up on this server yet' }); return }
    const name = `${d.firstName || ''} ${d.lastName || ''}`.trim() || d.email || d.phone || 'Website visitor'
    const start = new Date(d.scheduledAt)
    const ref = `chat:${d.botpressConversationId || `${d.email || d.phone || name}|${start.toISOString()}`}`
    const when = start.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    // The customer, a note and a pipeline card, exactly as for a website quote.
    const intake = await recordIntake(accountId, {
      source: 'website_chat', sourceRef: ref, name, phone: d.phone, email: d.email, address: d.address,
      summary: [`Booked an estimate on the website chat for ${when}.`, d.notes ? `Notes: ${d.notes}` : ''].filter(Boolean).join('\n'),
      leadSource: 'Website chat', payload: req.body,
    })
    if (!intake.contactId) { res.status(500).json({ success: false, error: 'Could not record the customer' }); return }
    const type = (APPOINTMENT_TYPES as readonly string[]).includes(d.type) ? d.type : 'estimate'
    // Its length: what the chat sent, else Settings > Appointments for this type, else an hour.
    const cfg = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const set = Number((cfg?.config as any)?.appointments?.durations?.[type])
    const minutes = d.duration ?? (Number.isFinite(set) && set > 0 ? set : 60)
    const data = await withPosition(accountId, {
      accountId, crmContactId: intake.contactId, type, status: 'scheduled', source: 'website_chat', sourceRef: ref,
      startAt: start, endAt: new Date(start.getTime() + minutes * 60_000),
      address: d.address || '', notes: d.notes || '', createdBy: 'Website chat',
      history: [{ at: new Date().toISOString(), by: 'Website chat', kind: 'booked', to: { startAt: start.toISOString() } }],
    })
    const a = await prisma.appointment.upsert({ where: { accountId_sourceRef: { accountId, sourceRef: ref } }, create: data, update: {} })
    res.status(201).json({ success: true, data: { id: a.id, customerId: intake.contactId, scheduledAt: a.startAt, type: a.type } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[appointments] chat booking error:', err)
    res.status(500).json({ success: false, error: 'Failed to book appointment' })
  }
}

// One address for both: staff send a sign in, the website chat does not.
router.post('/', (req: any, res, next) => {
  if (req.headers.authorization?.startsWith('Bearer ')) requireUser(req, res, () => bookByStaff(req, res))
  else bookFromChat(req, res).catch(next)
})

export default router
