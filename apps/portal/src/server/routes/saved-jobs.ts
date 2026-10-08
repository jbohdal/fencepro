/**
 * Saved Jobs API
 *
 * CRUD for the operational job records (the SavedJob model). Mirrors the
 * saved-quotes route pattern. Account scoped via JWT.
 *
 * Endpoints (all under /api/saved-jobs):
 *   GET    /          — list active jobs for caller's account
 *   GET    /:id       — single job
 *   POST   /          — create
 *   PATCH  /:id       — update (any field)
 *   DELETE /:id       — soft archive
 *   POST   /sync      — bulk push from a localStorage payload
 */

import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { audit } from '../lib/auditLog.js'
import { resolveSecret } from '../lib/secrets.js'

const router = Router()

const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

async function requireUser(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({
        where: { id: payload.sub },
        select: { crmAccountId: true },
      })
      crmAccountId = u?.crmAccountId ?? null
    }
    req.user = { id: payload.sub, email: payload.email, role: payload.role, crmAccountId }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

function requireAccount(req: any, res: any, next: any) {
  if (!req.user?.crmAccountId) {
    res.status(403).json({ success: false, error: 'Your user is not linked to a company; ask an admin to assign you to one.' })
    return
  }
  next()
}

const STATUSES = ['staging', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid', 'on_hold'] as const
const MATERIALS_STATUSES = ['not_ordered', 'ordered', 'received', 'loaded'] as const
const PAYMENT_STATUSES = ['not_invoiced', 'invoiced', 'partial', 'paid'] as const

const jobSchema = z.object({
  id: z.string().optional(),
  quoteId: z.string().optional().nullable(),
  crmContactId: z.string().optional().nullable(),
  status: z.enum(STATUSES).default('staging'),
  previousStatus: z.enum(STATUSES).optional().nullable(),
  customerName: z.string().default(''),
  customerPhone: z.string().default(''),
  customerEmail: z.string().default(''),
  customerAddress: z.string().default(''),
  fenceStyle: z.string().default(''),
  sections: z.number().int().default(0),
  totalFeet: z.number().int().default(0),
  walkGates: z.number().int().default(0),
  dblGates: z.number().int().default(0),
  tearOutSections: z.number().int().default(0),
  hasSalesman: z.boolean().default(false),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
  quotePrice: z.number().default(0),
  changeOrderTotal: z.number().default(0),
  contractValue: z.number().default(0),
  gmPct: z.number().default(0),
  materialsStatus: z.enum(MATERIALS_STATUSES).default('not_ordered'),
  pullSheetPulled: z.boolean().default(false),
  locatesDate: z.string().optional().nullable(),
  locatesExpDate: z.string().optional().nullable(),
  drawingComplete: z.boolean().default(false),
  crewAssigned: z.string().default(''),
  scheduledDate: z.string().default(''),
  scheduledEndDate: z.string().optional().nullable(),
  estimatedDays: z.number().int().default(0),
  completedDate: z.string().optional().nullable(),
  completedBy: z.string().optional().nullable(),
  actualDays: z.number().int().optional().nullable(),
  invoiceNumber: z.string().optional().nullable(),
  invoiceDate: z.string().optional().nullable(),
  paymentStatus: z.enum(PAYMENT_STATUSES).default('not_invoiced'),
  amountPaid: z.number().default(0),
  paymentDate: z.string().optional().nullable(),
  paymentMethod: z.string().optional().nullable(),
  notes: z.string().default(''),
  holdReason: z.string().optional().nullable(),
  salesRep: z.string().default(''),
  leadSource: z.string().default(''),
})

const jobUpdateSchema = jobSchema.partial()

// ── List ──
router.get('/', requireUser, requireAccount, async (req: any, res) => {
  try {
    const jobs = await prisma.savedJob.findMany({
      where: { accountId: req.user.crmAccountId, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
    })
    res.json({ success: true, data: jobs })
  } catch (err) {
    console.error('[saved-jobs] list error:', err)
    res.status(500).json({ success: false, error: 'Failed to list jobs' })
  }
})

// ── Read one ──
router.get('/:id', requireUser, requireAccount, async (req: any, res) => {
  try {
    const j = await prisma.savedJob.findUnique({ where: { id: req.params.id } })
    if (!j || j.accountId !== req.user.crmAccountId || j.archivedAt) {
      res.status(404).json({ success: false, error: 'Job not found' })
      return
    }
    res.json({ success: true, data: j })
  } catch (err) {
    console.error('[saved-jobs] read error:', err)
    res.status(500).json({ success: false, error: 'Failed to read job' })
  }
})

// ── Create ──
router.post('/', requireUser, requireAccount, async (req: any, res) => {
  try {
    const data = jobSchema.parse(req.body)
    const created = await prisma.savedJob.create({
      data: {
        accountId: req.user.crmAccountId,
        quoteId: data.quoteId || null,
        crmContactId: data.crmContactId || null,
        ...data,
        // Strip the keys we already set explicitly above
        id: undefined as any,
      },
    })
    await audit(req, 'create', 'SavedJob', created.id, { newValues: created })
    res.status(201).json({ success: true, data: created })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[saved-jobs] create error:', err)
    res.status(500).json({ success: false, error: 'Failed to create job' })
  }
})

// ── Update ──
router.patch('/:id', requireUser, requireAccount, async (req: any, res) => {
  try {
    const data = jobUpdateSchema.parse(req.body)
    const existing = await prisma.savedJob.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId || existing.archivedAt) {
      res.status(404).json({ success: false, error: 'Job not found' })
      return
    }
    const updated = await prisma.savedJob.update({
      where: { id: existing.id },
      data: {
        ...data,
        crmContactId: data.crmContactId === undefined ? undefined : (data.crmContactId || null),
        quoteId: data.quoteId === undefined ? undefined : (data.quoteId || null),
        id: undefined as any,
      },
    })
    await audit(req, 'update', 'SavedJob', updated.id, { oldValues: existing, newValues: updated })
    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[saved-jobs] update error:', err)
    res.status(500).json({ success: false, error: 'Failed to update job' })
  }
})

// ── Delete (soft) ──
router.delete('/:id', requireUser, requireAccount, async (req: any, res) => {
  try {
    const existing = await prisma.savedJob.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId || existing.archivedAt) {
      res.status(404).json({ success: false, error: 'Job not found' })
      return
    }
    await prisma.savedJob.update({ where: { id: existing.id }, data: { archivedAt: new Date() } })
    await audit(req, 'soft_delete', 'SavedJob', existing.id, { oldValues: existing })
    res.json({ success: true })
  } catch (err) {
    console.error('[saved-jobs] delete error:', err)
    res.status(500).json({ success: false, error: 'Failed to delete job' })
  }
})

// ── Bulk sync ──
const syncSchema = z.object({ jobs: z.array(jobSchema) })
router.post('/sync', requireUser, requireAccount, async (req: any, res) => {
  try {
    const { jobs } = syncSchema.parse(req.body)
    let created = 0, updated = 0, skipped = 0
    for (const j of jobs) {
      if (j.id) {
        const existing = await prisma.savedJob.findUnique({ where: { id: j.id } })
        if (existing && existing.accountId === req.user.crmAccountId) {
          await prisma.savedJob.update({
            where: { id: existing.id },
            data: { ...j, id: undefined as any, crmContactId: j.crmContactId || null, quoteId: j.quoteId || null },
          })
          updated++
          continue
        }
      }
      // Validate the contact + quote links are in our account; otherwise null them out.
      let safeContactId: string | null = null
      if (j.crmContactId) {
        const c = await prisma.crmContact.findUnique({ where: { id: j.crmContactId } })
        if (c && c.accountId === req.user.crmAccountId) safeContactId = c.id
      }
      let safeQuoteId: string | null = null
      if (j.quoteId) {
        const q = await prisma.savedQuote.findUnique({ where: { id: j.quoteId } })
        if (q && q.accountId === req.user.crmAccountId) safeQuoteId = q.id
      }
      try {
        await prisma.savedJob.create({
          data: {
            accountId: req.user.crmAccountId,
            ...j,
            id: undefined as any,
            crmContactId: safeContactId,
            quoteId: safeQuoteId,
          },
        })
        created++
      } catch {
        skipped++
      }
    }
    console.log(`[saved-jobs] sync: ${created} created, ${updated} updated, ${skipped} skipped for account ${req.user.crmAccountId}`)
    res.json({ success: true, data: { created, updated, skipped, total: jobs.length } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[saved-jobs] sync error:', err)
    res.status(500).json({ success: false, error: 'Failed to sync jobs' })
  }
})

export default router
