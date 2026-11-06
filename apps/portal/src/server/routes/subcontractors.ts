/**
 * Subcontractors, for the owner and office (subs.view; Jonathan, Nov 6 2026).
 * The Salesman and the Installer get none of it: no sub, no pay, no papers.
 * A W9 file opens for the owner only (subs.w9). lib/subcontractors.ts and
 * lib/subAssign.ts hold the rules; this is the office's API.
 *
 *   GET    /api/subcontractors                 the subs, with their papers' state
 *   POST   /api/subcontractors                 add a sub
 *   GET    /api/subcontractors/:id             one sub: papers, rates (theirs over Settings'), jobs
 *   PUT    /api/subcontractors/:id             change a sub (status "Do not use" needs a reason)
 *   POST   /api/subcontractors/:id/documents   upload a paper (PDF or photo), with its expiry
 *   GET    /api/subcontractors/:id/documents/:docId/file
 *   DELETE /api/subcontractors/:id/documents/:docId
 *   GET    /api/subcontractors/assign/preview  papers, days already booked, pay, before Confirm
 *   POST   /api/subcontractors/assign          assign and book the install
 *   GET    /api/subcontractors/job/:jobId      the job's sub: pay, link, what they reported
 *   PUT    /api/subcontractors/job/:jobId      pay by hand, notes for the sub, link off or on, a new link
 *   DELETE /api/subcontractors/job/:jobId      take the sub off the job
 */

import { Router } from 'express'
import express from 'express'
import crypto from 'crypto'
import fs from 'fs'
import multer from 'multer'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { can, requireCan, roleOf } from '../lib/permissions.js'
import { audit } from '../lib/auditLog.js'
import { plainZod } from '../lib/plainZod.js'
import { validateFile, storeFile, getFilePath } from '../lib/storage/index.js'
import { floridaDay } from '../lib/automations/context.js'
import {
  SUB_STATUSES, TRADES, SubError, papersOf, docKindsOf, subSettingsOf, SUB_SETTINGS_KEY, cleanRates, settingsRates, payTotal, refreshPay, type PayLine,
} from '../lib/subcontractors.js'
import { previewAssign, assignSub, unassignSub, newSubLink, linkOf, ensureSubCrew, dropSubCrew, type Actor } from '../lib/subAssign.js'
import { settingsOf as costSettingsOf } from '../lib/jobCosting.js'

type Json = any
const router = Router()
router.use(requireUser, requireAccount, requireCan('subs.view'))

async function actorOf(req: any): Promise<Actor> {
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  return { userId: req.user.id, name: u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || req.user.email : req.user.email, role: roleOf(req) ?? '' }
}

function fail(res: any, err: unknown, what: string) {
  if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
  if (err instanceof SubError) { res.status(err.status).json({ success: false, error: err.message, ...err.extra }); return }
  console.error(`[subcontractors] ${what}:`, err)
  res.status(500).json({ success: false, error: `Could not ${what}` })
}

async function configOf(accountId: string): Promise<Json> {
  return ((await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }))?.config ?? {}) as Json
}

const today = () => floridaDay(new Date())

/** A paper as the office sees it; a W9's file is the owner's only (its row still shows it is on file). */
const docView = (d: Json, ownerSees: boolean) => ({
  id: d.id, kind: d.kind, label: d.label, fileName: d.fileName, mime: d.mime, bytes: d.bytes, expiresOn: d.expiresOn, version: d.version,
  signedOn: d.signedOn, uploadedBy: d.uploadedBy, createdAt: d.createdAt, canOpen: d.kind !== 'w9' || ownerSees,
})

const subBody = z.object({
  businessName: z.string().trim().min(1, 'Give the business name').max(200),
  contactName: z.string().trim().max(200).default(''),
  phone: z.string().trim().max(40).default(''),
  email: z.string().trim().max(200).default('').refine(v => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'That email does not look right'),
  address: z.string().trim().max(300).default(''),
  payMethod: z.string().trim().max(200).default(''),
  notes: z.string().max(4000).default(''),
  trades: z.array(z.enum(TRADES)).default([]),
  crewSize: z.number().int().min(1).max(50).nullable().optional(),
  rates: z.record(z.any()).optional(),
  status: z.enum(SUB_STATUSES).default('active'),
  statusReason: z.string().trim().max(500).default(''),
  vendorId: z.string().max(100).nullable().optional(),
}).refine(b => b.status !== 'do_not_use' || b.statusReason.length > 0, { message: 'Say why: Do not use needs a reason', path: ['statusReason'] })

// ── Sub settings: paper types and the Subcontractor Agreement ────────────────

router.get('/settings', async (req: any, res) => {
  try { res.json({ success: true, data: await subSettingsOf(req.user.crmAccountId) }) } catch (err) { fail(res, err, 'read the sub settings') }
})

/** Paper types and the agreement's words (settings.change). New words or months: the review comes off, the version goes up. */
router.put('/settings', requireCan('settings.change'), express.json({ limit: '128kb' }), async (req: any, res) => {
  try {
    const b = z.object({
      docTypes: z.array(z.object({ key: z.string().max(60).optional(), label: z.string().trim().min(1).max(80), expires: z.boolean().default(true) })).max(30).optional(),
      agreement: z.object({ text: z.string().trim().min(50, 'The agreement is too short').max(40_000), callbackMonths: z.number().int().min(1).max(120).nullable() }).optional(),
    }).parse(req.body)
    const accountId = req.user.crmAccountId
    const cur = await subSettingsOf(accountId)
    const next = { ...cur }
    if (b.docTypes) next.docTypes = b.docTypes.map(t => ({ key: t.key || t.label, label: t.label, expires: t.expires }))
    if (b.agreement && (b.agreement.text !== cur.agreement.text || b.agreement.callbackMonths !== cur.agreement.callbackMonths)) {
      next.agreement = { text: b.agreement.text, callbackMonths: b.agreement.callbackMonths, version: cur.agreement.version + 1, reviewedAt: null, reviewedBy: null }
    }
    await prisma.accountKeyValue.upsert({ where: { accountId_key: { accountId, key: SUB_SETTINGS_KEY } }, create: { accountId, key: SUB_SETTINGS_KEY, value: next as Json, updatedBy: req.user.id }, update: { value: next as Json, updatedBy: req.user.id, version: { increment: 1 } } })
    await audit(req, 'update', 'SubSettings', accountId, { oldValues: { agreementVersion: cur.agreement.version, reviewed: !!cur.agreement.reviewedAt }, newValues: { agreementVersion: next.agreement.version, reviewed: !!next.agreement.reviewedAt, docTypes: next.docTypes.length } })
    res.json({ success: true, data: next })
  } catch (err) { fail(res, err, 'save the sub settings') }
})

/** The owner marks the agreement reviewed by an attorney (or takes the mark off): only then can it be sent. */
router.post('/settings/reviewed', express.json({ limit: '4kb' }), async (req: any, res) => {
  try {
    if (roleOf(req) !== 'super_admin') throw new SubError(403, 'Only the owner can mark the agreement reviewed.')
    const b = z.object({ reviewed: z.boolean() }).parse(req.body)
    const accountId = req.user.crmAccountId
    const cur = await subSettingsOf(accountId)
    const actor = await actorOf(req)
    const next = { ...cur, agreement: { ...cur.agreement, reviewedAt: b.reviewed ? new Date().toISOString() : null, reviewedBy: b.reviewed ? actor.name : null } }
    await prisma.accountKeyValue.upsert({ where: { accountId_key: { accountId, key: SUB_SETTINGS_KEY } }, create: { accountId, key: SUB_SETTINGS_KEY, value: next as Json, updatedBy: req.user.id }, update: { value: next as Json, updatedBy: req.user.id, version: { increment: 1 } } })
    await audit(req, 'update', 'SubSettings', accountId, { newValues: { agreementReviewed: b.reviewed, version: cur.agreement.version } })
    res.json({ success: true, data: next })
  } catch (err) { fail(res, err, 'mark the agreement') }
})

// ── The Subs dashboard (owner and office) ───────────────────────────────────

router.get('/dashboard', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const t = today()
    const { plusDays, weekdayOf } = await import('../lib/installDays.js')
    const usDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
    const { businessDaysBefore } = await import('../lib/subcontractors.js')
    // The next 7 days from today (on a Friday: through next Thursday).
    void weekdayOf
    const week = Array.from({ length: 7 }, (_, i) => plusDays(t, i))
    const [rows, subs, settings] = await Promise.all([
      prisma.subJob.findMany({ where: { accountId }, include: { sub: { select: { businessName: true } } } }),
      prisma.subcontractor.findMany({ where: { accountId, deletedAt: null, status: 'active' }, include: { documents: { where: { deletedAt: null } } } }),
      subSettingsOf(accountId),
    ])
    const jobs = rows.length ? await prisma.savedJob.findMany({ where: { id: { in: rows.map(r => r.jobId) }, deletedAt: null, archivedAt: null }, select: { id: true, customerName: true, customerAddress: true, scheduledDate: true, scheduledEndDate: true, locateTicket: true, locatesExpDate: true, completedDate: true } }) : []
    const grid = await prisma.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, date: { in: week }, stagingJobId: { in: rows.map(r => r.jobId) } }, select: { date: true, stagingJobId: true } })
    const card = (r: typeof rows[number]) => { const j = jobs.find(x => x.id === r.jobId)!; return { jobId: r.jobId, sub: r.sub.businessName, customerName: j.customerName, address: j.customerAddress, installDate: j.scheduledDate } }
    const live = rows.filter(r => jobs.some(j => j.id === r.jobId))
    const days = week.map(d => ({ date: d, jobs: grid.filter(g => g.date === d).map(g => live.find(r => r.jobId === g.stagingJobId)).filter(Boolean).map(r => card(r!)) }))
    const locate = live.flatMap(r => {
      const j = jobs.find(x => x.id === r.jobId)!
      if (r.confirmedAt || !j.scheduledDate || j.scheduledDate < t) return []
      const end = j.scheduledEndDate || j.scheduledDate
      if (!j.locateTicket?.trim()) return [{ ...card(r), problem: `No 811 ticket yet (call by ${usDate(businessDaysBefore(j.scheduledDate, 3))})` }]
      if (j.locatesExpDate && j.locatesExpDate < end) return [{ ...card(r), problem: `811 ticket expires ${usDate(j.locatesExpDate)}, before the install ends` }]
      return []
    })
    const papers = subs.flatMap(s => {
      const p = papersOf(s.documents as Json, t, docKindsOf(settings))
      return [...p.expired.map(e => ({ subId: s.id, sub: s.businessName, label: e.label, expiresOn: e.expiresOn, days: -1 })), ...p.expiring.map(e => ({ subId: s.id, sub: s.businessName, label: e.label, expiresOn: e.expiresOn, days: e.days }))]
    }).sort((a, b) => a.expiresOn.localeCompare(b.expiresOn))
    res.json({ success: true, data: {
      week: days,
      locate,
      materialOut: live.filter(r => (r.checkout as Json)?.at && !(r.checkin as Json)?.at).map(card),
      waitingOnSub: live.filter(r => !r.submittedAt && jobs.find(j => j.id === r.jobId)!.scheduledDate && jobs.find(j => j.id === r.jobId)!.scheduledDate! < t).map(card),
      waitingOnYou: live.filter(r => r.submittedAt && !r.confirmedAt).map(r => ({ ...card(r), flags: (r.flags as Json[])?.length ?? 0 })),
      papers,
    } })
  } catch (err) { fail(res, err, 'read the dashboard') }
})

// ── The list ─────────────────────────────────────────────────────────────────

router.get('/', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const [subs, settings, jobs] = await Promise.all([
      prisma.subcontractor.findMany({ where: { accountId, deletedAt: null }, include: { documents: { where: { deletedAt: null } } }, orderBy: { businessName: 'asc' } }),
      subSettingsOf(accountId),
      prisma.subJob.groupBy({ by: ['subId'], where: { accountId }, _count: { _all: true } }),
    ])
    const kinds = docKindsOf(settings)
    const t = today()
    res.json({ success: true, data: subs.map(s => {
      const p = papersOf(s.documents as Json, t, kinds)
      return {
        id: s.id, businessName: s.businessName, contactName: s.contactName, phone: s.phone, email: s.email, status: s.status, statusReason: s.statusReason,
        trades: s.trades, crewSize: s.crewSize, jobs: jobs.find(j => j.subId === s.id)?._count._all ?? 0,
        missing: p.missing, expired: p.expired, expiring: p.expiring, insuranceProblems: p.insuranceProblems,
      }
    }) })
  } catch (err) { fail(res, err, 'list the subs') }
})

router.post('/', express.json({ limit: '64kb' }), async (req: any, res) => {
  try {
    const b = subBody.parse(req.body)
    const row = await prisma.subcontractor.create({ data: { ...b, rates: cleanRates(b.rates) as Json, accountId: req.user.crmAccountId, crewSize: b.crewSize ?? null, vendorId: b.vendorId ?? null } })
    await audit(req, 'create', 'Subcontractor', row.id, { newValues: { businessName: row.businessName } })
    res.status(201).json({ success: true, data: row })
  } catch (err) { fail(res, err, 'add the sub') }
})

// ── One sub ──────────────────────────────────────────────────────────────────

async function subOf(req: any) {
  const s = await prisma.subcontractor.findFirst({ where: { id: String(req.params.id), accountId: req.user.crmAccountId, deletedAt: null }, include: { documents: { where: { deletedAt: null }, orderBy: { createdAt: 'desc' } } } })
  if (!s) throw new SubError(404, 'That sub is not there any more.')
  return s
}

router.get('/:id', async (req: any, res, next) => {
  if (['assign', 'job', 'dashboard', 'settings'].includes(req.params.id)) { next(); return }
  try {
    const accountId = req.user.crmAccountId
    const s = await subOf(req)
    const [settings, cost, jobs] = await Promise.all([
      subSettingsOf(accountId), costSettingsOf(accountId),
      prisma.subJob.findMany({ where: { accountId, subId: s.id }, orderBy: { assignedAt: 'desc' } }),
    ])
    const jobRows = jobs.length ? await prisma.savedJob.findMany({ where: { id: { in: jobs.map(j => j.jobId) }, deletedAt: null }, select: { id: true, customerName: true, customerAddress: true, scheduledDate: true, status: true, opsStage: true } }) : []
    const ownerSees = can(roleOf(req), 'subs.w9')
    // The categories the fences use (Settings → Fence styles), for "their rate" by material.
    const categories = [...new Set((cost.styles as Json[]).map(x => String(x?.category ?? '').trim()).filter(Boolean))].sort()
    res.json({ success: true, data: {
      sub: { ...s, documents: undefined },
      documents: s.documents.map(d => docView(d, ownerSees)),
      kinds: docKindsOf(settings),
      papers: papersOf(s.documents as Json, today(), docKindsOf(settings)),
      rates: { own: cleanRates(s.rates), settings: settingsRates(cost.pricing), categories },
      jobs: jobs.filter(j => jobRows.some(x => x.id === j.jobId)).map(j => {
        const job = jobRows.find(x => x.id === j.jobId)
        return { jobId: j.jobId, customerName: job?.customerName ?? '', address: job?.customerAddress ?? '', installDate: job?.scheduledDate ?? null, status: job?.status ?? '', stage: job?.opsStage ?? '', payCents: j.payCents, submittedAt: j.submittedAt, confirmedAt: j.confirmedAt }
      }),
    } })
  } catch (err) { fail(res, err, 'open the sub') }
})

router.put('/:id', express.json({ limit: '64kb' }), async (req: any, res) => {
  try {
    const s = await subOf(req)
    const b = subBody.parse(req.body)
    const row = await prisma.subcontractor.update({ where: { id: s.id }, data: { ...b, rates: cleanRates(b.rates) as Json, crewSize: b.crewSize ?? null, vendorId: b.vendorId ?? null, statusReason: b.status === 'active' ? '' : b.statusReason } })
    // Their name on the Schedule follows (their crew row), when they have one.
    if (row.businessName !== s.businessName && row.status === 'active') {
      const has = await prisma.subJob.count({ where: { subId: s.id } })
      if (has) await ensureSubCrew(row.accountId, row)
    }
    // Inactive or Do not use: their crew row comes off the Schedule once nothing is booked on it from today on.
    if (row.status !== 'active') await dropSubCrew(row.accountId, row.id, today())
    await audit(req, 'update', 'Subcontractor', row.id, { oldValues: { ...s, documents: undefined }, newValues: row })
    res.json({ success: true, data: row })
  } catch (err) { fail(res, err, 'save the sub') }
})

// ── Papers ───────────────────────────────────────────────────────────────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } })

router.post('/:id/documents', upload.single('file'), async (req: any, res) => {
  try {
    const s = await subOf(req)
    const settings = await subSettingsOf(s.accountId)
    const b = z.object({
      kind: z.string().min(1).max(60),
      expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick the day it expires').optional().or(z.literal('')),
      version: z.string().max(60).optional(),
      signedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
    }).parse(req.body ?? {})
    const kind = docKindsOf(settings).find(k => k.kind === b.kind)
    if (!kind) throw new SubError(400, 'Pick what this paper is.')
    if (kind.kind === 'w9' && !can(roleOf(req), 'subs.w9')) throw new SubError(403, 'Only the owner can file a W9.')
    if (kind.expires && !b.expiresOn) throw new SubError(400, `Give the day the ${kind.label.toLowerCase()} expires.`)
    const file = req.file as Express.Multer.File | undefined
    if (!file) throw new SubError(400, 'Pick the PDF or photo.')
    const bad = validateFile(file)
    if (bad) throw new SubError(400, bad)
    const stored = storeFile(file.buffer, file.originalname, s.accountId)
    const actor = await actorOf(req)
    const row = await prisma.subDocument.create({ data: {
      accountId: s.accountId, subId: s.id, kind: kind.kind, label: kind.label, fileName: file.originalname.slice(0, 200), mime: file.mimetype, bytes: file.size,
      path: stored.storagePath, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'),
      expiresOn: kind.expires ? b.expiresOn || null : null, version: b.version || null, signedOn: b.signedOn || null, uploadedBy: actor.name,
    } })
    await audit(req, 'create', 'SubDocument', row.id, { newValues: { subId: s.id, kind: row.kind, expiresOn: row.expiresOn } })
    res.status(201).json({ success: true, data: docView(row, can(roleOf(req), 'subs.w9')) })
  } catch (err) { fail(res, err, 'file the paper') }
})

router.get('/:id/documents/:docId/file', async (req: any, res) => {
  try {
    const s = await subOf(req)
    const d = await prisma.subDocument.findFirst({ where: { id: String(req.params.docId), subId: s.id, deletedAt: null } })
    if (!d) throw new SubError(404, 'That paper is not there any more.')
    if (d.kind === 'w9' && !can(roleOf(req), 'subs.w9')) throw new SubError(403, 'Only the owner can open a W9.')
    const p = getFilePath(d.path)
    if (!fs.existsSync(p)) throw new SubError(404, 'The file is missing.')
    res.setHeader('Content-Type', d.mime || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${d.fileName.replace(/[^\w .,-]+/g, '_')}"`)
    res.setHeader('Cache-Control', 'private, no-store')
    fs.createReadStream(p).pipe(res)
  } catch (err) { fail(res, err, 'open the paper') }
})

router.delete('/:id/documents/:docId', async (req: any, res) => {
  try {
    const s = await subOf(req)
    const d = await prisma.subDocument.findFirst({ where: { id: String(req.params.docId), subId: s.id, deletedAt: null } })
    if (!d) throw new SubError(404, 'That paper is not there any more.')
    if (d.kind === 'w9' && !can(roleOf(req), 'subs.w9')) throw new SubError(403, 'Only the owner can take off a W9.')
    await prisma.subDocument.update({ where: { id: d.id }, data: { deletedAt: new Date() } })
    await audit(req, 'delete', 'SubDocument', d.id, { oldValues: { subId: s.id, kind: d.kind, expiresOn: d.expiresOn } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'take off the paper') }
})

/** Send the Subcontractor Agreement to sign (locked until the owner marked it reviewed). */
router.post('/:id/agreement', async (req: any, res) => {
  try {
    const s = await subOf(req)
    const { sendAgreement } = await import('../lib/subSign.js')
    const out = await sendAgreement(s.accountId, s.id, (await actorOf(req)).name)
    await audit(req, 'create', 'SubSignRequest', out.id, { newValues: { subId: s.id, kind: 'agreement', how: out.how } })
    res.json({ success: true, data: out })
  } catch (err) { fail(res, err, 'send the agreement') }
})

// ── Assigning ────────────────────────────────────────────────────────────────

router.get('/assign/preview', async (req: any, res) => {
  try {
    const q = z.object({ jobId: z.string().min(1), subId: z.string().min(1), start: z.string().optional() }).parse(req.query)
    res.json({ success: true, data: await previewAssign(req.user.crmAccountId, q.jobId, q.subId, q.start ?? null) })
  } catch (err) { fail(res, err, 'check the sub') }
})

router.post('/assign', requireCan('schedule.change'), express.json({ limit: '8kb' }), async (req: any, res) => {
  try {
    const b = z.object({ jobId: z.string().min(1), subId: z.string().min(1), start: z.string(), override: z.boolean().optional() }).parse(req.body)
    const out = await assignSub(req.user.crmAccountId, await actorOf(req), b)
    await audit(req, 'update', 'SavedJob', b.jobId, { newValues: { subAssigned: b.subId, start: b.start, ...(out.override ? { papersOverride: out.override } : {}) } })
    res.json({ success: true, data: { ...out, subJob: undefined, payCents: out.subJob.payCents } })
  } catch (err) { fail(res, err, 'assign the sub') }
})

// ── The job's sub ────────────────────────────────────────────────────────────

async function jobSubOf(req: any) {
  const sj = await prisma.subJob.findFirst({ where: { accountId: req.user.crmAccountId, jobId: String(req.params.jobId) }, include: { sub: true } })
  return sj
}

router.get('/job/:jobId', async (req: any, res) => {
  try {
    const sj = await jobSubOf(req)
    if (!sj) { res.json({ success: true, data: null }); return }
    res.json({ success: true, data: {
      subId: sj.subId, businessName: sj.sub.businessName, phone: sj.sub.phone, email: sj.sub.email,
      assignedAt: sj.assignedAt, assignedBy: sj.assignedBy, docOverride: sj.docOverride,
      payLines: sj.payLines as unknown as PayLine[], payCents: sj.payCents, payEdited: sj.payEdited,
      link: sj.linkDisabledAt ? null : linkOf(sj), linkOff: !!sj.linkDisabledAt, lastOpenedAt: sj.lastOpenedAt,
      subNotes: sj.subNotes, checkout: sj.checkout, report: sj.report, checkin: sj.checkin,
      submittedAt: sj.submittedAt, confirmedAt: sj.confirmedAt, confirmedBy: sj.confirmedBy, flags: sj.flags, events: sj.events,
    } })
  } catch (err) { fail(res, err, 'open the job\'s sub') }
})

router.put('/job/:jobId', express.json({ limit: '64kb' }), async (req: any, res) => {
  try {
    const sj = await jobSubOf(req)
    if (!sj) throw new SubError(404, 'No sub on this job.')
    const b = z.object({
      payCents: z.number().int().min(0).max(100_000_00).optional(),
      payReset: z.boolean().optional(),
      subNotes: z.string().max(4000).optional(),
      linkOff: z.boolean().optional(),
      newLink: z.boolean().optional(),
    }).parse(req.body)
    const accountId = req.user.crmAccountId
    if (b.payReset) await refreshPay(accountId, sj.jobId, { force: true })
    else if (b.payCents !== undefined && b.payCents !== sj.payCents) await prisma.subJob.update({ where: { id: sj.id }, data: { payCents: b.payCents, payEdited: true } })
    if (b.subNotes !== undefined) await prisma.subJob.update({ where: { id: sj.id }, data: { subNotes: b.subNotes } })
    if (b.linkOff !== undefined) await prisma.subJob.update({ where: { id: sj.id }, data: { linkDisabledAt: b.linkOff ? new Date() : null } })
    let link: string | null = null
    if (b.newLink) link = await newSubLink(accountId, sj.jobId)
    await audit(req, 'update', 'SubJob', sj.id, { oldValues: { payCents: sj.payCents, linkOff: !!sj.linkDisabledAt }, newValues: { ...b, subNotes: b.subNotes !== undefined ? '(changed)' : undefined } })
    const now = await prisma.subJob.findUniqueOrThrow({ where: { id: sj.id } })
    res.json({ success: true, data: { payCents: now.payCents, payEdited: now.payEdited, payLines: now.payLines, linkOff: !!now.linkDisabledAt, link: now.linkDisabledAt ? null : link ?? linkOf(now), subNotes: now.subNotes } })
  } catch (err) { fail(res, err, 'save the job\'s sub') }
})

/** "Installed, confirm": one tap moves the job to Complete with its final furnishing date (lib/subLink.ts). */
router.post('/job/:jobId/confirm', requireCan('schedule.change'), express.json({ limit: '4kb' }), async (req: any, res) => {
  try {
    const b = z.object({ finalFurnishingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).parse(req.body ?? {})
    const actor = await actorOf(req)
    const { confirmInstalled } = await import('../lib/subLink.js')
    const out = await confirmInstalled(req.user.crmAccountId, String(req.params.jobId), { userId: actor.userId, name: actor.name }, b.finalFurnishingDate ?? null)
    await audit(req, 'update', 'SavedJob', String(req.params.jobId), { newValues: { installedConfirmed: true, finalFurnishingDate: out.finalFurnishingDate } })
    res.json({ success: true, data: out })
  } catch (err) { fail(res, err, 'confirm the install') }
})

router.delete('/job/:jobId', requireCan('schedule.change'), async (req: any, res) => {
  try {
    const gone = await unassignSub(req.user.crmAccountId, String(req.params.jobId), await actorOf(req))
    if (gone) await audit(req, 'delete', 'SubJob', gone.id, { oldValues: { jobId: gone.jobId, subId: gone.subId, payCents: gone.payCents } })
    res.json({ success: true })
  } catch (err) { fail(res, err, 'take the sub off') }
})

export { payTotal }
export default router
