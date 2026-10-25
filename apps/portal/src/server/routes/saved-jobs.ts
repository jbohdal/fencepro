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

import { canonicalWord } from '../lib/optionLists.js'
import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { DeleteError, deleteRecord, setArchived } from '../lib/deletion.js'
import { ensureJobChecklist } from '../lib/seeds.js'
import { audit } from '../lib/auditLog.js'
import { resolveSecret } from '../lib/secrets.js'
import { clientIdSchema, decideClientId } from '../lib/clientId.js'
import { syncCalendarAfterWrite } from '../lib/calendarSync/index.js'
import { plainZod } from '../lib/plainZod.js'
import { checkJobMove, refuseBlocked } from '../lib/automations/stageRules.js'
import { recordJobChanges } from '../lib/automations/hooks.js'
import { roleOf, requireCan } from '../lib/permissions.js'
import { repForJob } from '../lib/salesRep.js'
import { hidesCosts, hidesPrices, isPriceKey, withMoneyBack } from '../lib/costRedact.js'
import { loadOpsStages } from '../lib/opsStages.js'
import { reconcileOpsStage, stageById, stageOfJob, fieldsForStage } from '../lib/opsStageModel.js'
import { floridaDay } from '../lib/automations/context.js'
import { jobTotalsFor } from '../lib/changeOrders.js'
import { afterJobSaved } from '../lib/contractBilling.js'

const router = Router()

// Anything saved here may carry a date: keep Google Calendar in step, in the background.
router.use(syncCalendarAfterWrite as any)

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
  /** The Operations stage id (Settings > Operations Stages); '' or left out: worked out from the status. */
  opsStage: z.string().max(64).optional(),
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
    // ?since=<time>: only what changed after it (removed ones too, with archivedAt), so the
    // phone's refresh is small. A few seconds of overlap covers saves in flight.
    const sinceRaw = typeof req.query.since === 'string' ? Date.parse(req.query.since) : NaN
    const serverTime = new Date(Date.now() - 5000).toISOString()
    const jobs = await prisma.savedJob.findMany({
      where: Number.isFinite(sinceRaw)
        ? { accountId: req.user.crmAccountId, updatedAt: { gt: new Date(sinceRaw) } }
        : req.query.archived === '1' ? { accountId: req.user.crmAccountId, deletedAt: null, archivedAt: { not: null } }
        : { accountId: req.user.crmAccountId, deletedAt: null, archivedAt: null },
      orderBy: { updatedAt: 'desc' },
    })
    // ?archived=1 above: the archived ones (search, reports, Unarchive). A small refresh marks a deleted
    // one with archivedAt too, so an older screen drops it (a new screen checks deletedAt first).
    const data = Number.isFinite(sinceRaw) ? jobs.map(x => (x.deletedAt && !x.archivedAt ? { ...x, archivedAt: x.deletedAt } : x)) : jobs
    res.json({ success: true, data, serverTime, partial: Number.isFinite(sinceRaw) })
  } catch (err) {
    console.error('[saved-jobs] list error:', err)
    res.status(500).json({ success: false, error: 'Failed to list jobs' })
  }
})

// ── Read one ──
router.get('/:id', requireUser, requireAccount, async (req: any, res) => {
  try {
    const j = await prisma.savedJob.findUnique({ where: { id: req.params.id } })
    if (!j || j.accountId !== req.user.crmAccountId || j.deletedAt) {
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
router.post('/', requireUser, requireAccount, requireCan('quotes.change'), async (req: any, res) => {
  try {
    const data = jobSchema.parse(req.body)
    // Lead source and tags by Settings > Lead Sources and Customer Tags: an id or linked word kept, a name in any capital letters becomes its id, anything else as typed.
    if (typeof data.leadSource === 'string') data.leadSource = (await canonicalWord(req.user.crmAccountId, 'leadSources', data.leadSource)) ?? ''
    // A Salesman's phone has no margin: the job takes its quote's, as saved (lib/costRedact.ts).
    if (hidesCosts(roleOf(req))) {
      const q = data.quoteId ? await prisma.savedQuote.findFirst({ where: { id: data.quoteId, accountId: req.user.crmAccountId }, select: { gmPct: true } }) : null
      ;(data as any).gmPct = q?.gmPct ?? 0
    }
    // Who sold it: as sent, else its quote's rep (lib/salesRep.ts).
    data.salesRep = (await repForJob(req, data.salesRep, data.quoteId)) ?? ''
    const clientId = clientIdSchema.parse(data.id)
    const decision = await decideClientId(clientId, req.user.crmAccountId, id => prisma.savedJob.findUnique({ where: { id } }))
    if (decision.kind === 'exists') {
      // A retried create: the job is already here.
      res.status(200).json({ success: true, data: decision.row })
      return
    }
    // Only link to a contact that exists in this company; otherwise keep the
    // job (it carries the customer's details) and drop the link.
    let contactId: string | null = null
    if (data.crmContactId) {
      const c = await prisma.crmContact.findUnique({ where: { id: data.crmContactId }, select: { id: true, accountId: true, deletedAt: true } })
      if (c && c.accountId === req.user.crmAccountId && !c.deletedAt) contactId = c.id
      else console.warn(`[saved-jobs] contact ${data.crmContactId} not found for this company; saving the job without the link`)
    }
    const { id: _ignored, ...fields } = data
    // The new job lands in the stage marked first in Settings (or the one its status stands for).
    const { stages } = await loadOpsStages(req.user.crmAccountId)
    const opsStage = reconcileOpsStage(stages, null, { ...data, opsStage: data.opsStage && stageById(stages, data.opsStage) ? data.opsStage : '' } as any)
    // The new job enters its first Operations stage: saved for automations in the same step.
    const created = await prisma.$transaction(async tx => {
      const row = await tx.savedJob.create({
        data: {
          ...fields,
          opsStage,
          ...(decision.kind === 'use' ? { id: decision.id } : {}),
          accountId: req.user.crmAccountId,
          quoteId: data.quoteId || null,
          crmContactId: contactId,
        },
      })
      await recordJobChanges(req.user.crmAccountId, null, row, tx)
      return row
    })
    await audit(req, 'create', 'SavedJob', created.id, { newValues: created })
    // The job's milestone checklist is made here, once (see lib/seeds).
    await ensureJobChecklist(req.user.crmAccountId, created.id).catch(err => console.error('[saved-jobs] checklist:', err))
    // A job for a signed quote gets its payment schedule from the contract (lib/contractBilling.ts).
    await afterJobSaved(req.user.crmAccountId, created.id, { userId: req.user.id ?? null, name: req.user.email ?? '' })
    res.status(201).json({ success: true, data: created })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    // The same job arrived twice at once: the first one is the job.
    if ((err as any)?.code === 'P2002' && (typeof req.body?.id === 'string' || typeof req.body?.quoteId === 'string')) {
      // The same job (its id), or another job for the same quote (one job per quote): the first one is the job.
      const row = (typeof req.body?.id === 'string' ? await prisma.savedJob.findUnique({ where: { id: req.body.id } }).catch(() => null) : null)
        ?? (req.body?.quoteId ? await prisma.savedJob.findFirst({ where: { accountId: req.user.crmAccountId, quoteId: String(req.body.quoteId) } }).catch(() => null) : null)
      if (row && row.accountId === req.user.crmAccountId) { res.status(200).json({ success: true, data: row }); return }
    }
    console.error('[saved-jobs] create error:', err)
    res.status(500).json({ success: false, error: 'Failed to create job' })
  }
})

// ── Update ──
router.patch('/:id', requireUser, requireAccount, async (req: any, res) => {
  try {
    const data = jobUpdateSchema.parse(req.body)
    // Lead source and tags by Settings > Lead Sources and Customer Tags: an id or linked word kept, a name in any capital letters becomes its id, anything else as typed.
    if (typeof data.leadSource === 'string') data.leadSource = (await canonicalWord(req.user.crmAccountId, 'leadSources', data.leadSource)) ?? ''
    // A login that never had the margin, or the prices (the Installer), leaves them as saved.
    if (hidesCosts(roleOf(req))) delete (data as any).gmPct
    if (hidesPrices(roleOf(req))) for (const k of Object.keys(data)) if (isPriceKey(k)) delete (data as any)[k]
    const existing = await prisma.savedJob.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId || existing.deletedAt) {
      res.status(404).json({ success: false, error: 'Job not found' })
      return
    }
    // The Installer's notes came with dollar amounts left out: they go back in as saved (lib/costRedact.ts).
    if (hidesPrices(roleOf(req)) && typeof data.notes === 'string') data.notes = withMoneyBack(data.notes, existing.notes ?? '')
    // A rep already on the job stays when a blank one is sent (an older copy); a job with none takes its quote's (lib/salesRep.ts).
    if (data.salesRep !== undefined && !data.salesRep.trim()) {
      if (existing.salesRep?.trim()) delete (data as any).salesRep
      else data.salesRep = (await repForJob(req, data.salesRep, data.quoteId === undefined ? existing.quoteId : data.quoteId)) ?? ''
    }
    // The stage, by id (Settings > Operations Stages): moved on purpose, or as a status change moves it.
    const { stages } = await loadOpsStages(req.user.crmAccountId)
    if (data.opsStage && !stageById(stages, data.opsStage)) {
      res.status(400).json({ success: false, error: 'That stage is not in Settings > Operations Stages any more. Reload and pick another.' })
      return
    }
    const wasStage = stageOfJob(stages, existing as any)
    const nextStage = reconcileOpsStage(stages, existing as any, { ...existing, ...data } as any)
    // Moved on purpose: the status (and the rest) that stage stands for, whatever an older screen sent.
    if (nextStage !== wasStage && data.opsStage === nextStage) Object.assign(data, fieldsForStage(stages, nextStage, existing as any, floridaDay(new Date())) ?? {})
    ;(data as any).opsStage = nextStage
    // Change orders: the change order total and contract value come from the approved ones (lib/changeOrders.ts), whatever an older screen sent.
    const coTotals = await jobTotalsFor(req.user.crmAccountId, data.quoteId === undefined ? existing.quoteId : data.quoteId, data.quotePrice ?? existing.quotePrice)
    if (coTotals) Object.assign(data, coTotals)
    // Stage rules: a job cannot enter a stage whose requirements are not met.
    const blocked = await checkJobMove(req.user.crmAccountId, existing, { ...existing, ...data })
    if (blocked) { refuseBlocked(res, [blocked], { data: existing, version: 0 }); return }
    const updated = await prisma.$transaction(async tx => {
      const row = await tx.savedJob.update({
        where: { id: existing.id },
        data: {
          ...data,
          crmContactId: data.crmContactId === undefined ? undefined : (data.crmContactId || null),
          quoteId: data.quoteId === undefined ? undefined : (data.quoteId || null),
          id: undefined as any,
        },
      })
      // Stage moves and payments, saved for automations in the same step.
      await recordJobChanges(req.user.crmAccountId, existing, row, tx)
      return row
    })
    await audit(req, 'update', 'SavedJob', updated.id, { oldValues: existing, newValues: updated })
    // The payment schedule: made if the quote is signed now, and the Final due on the install date (lib/contractBilling.ts).
    await afterJobSaved(req.user.crmAccountId, updated.id, { userId: req.user.id ?? null, name: req.user.email ?? '' })
    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[saved-jobs] update error:', err)
    res.status(500).json({ success: false, error: 'Failed to update job' })
  }
})

// ── Delete (soft, owner and admin) ──
// With everything that hangs off it, in one transaction, logged in Settings >
// Deleted Records with a snapshot to restore from (lib/deletion.ts).
const actorOf = (req: any) => ({ accountId: req.user.crmAccountId as string, userId: (req.user.id ?? null) as string | null })
router.delete('/:id', requireUser, requireAccount, requireCan('records.delete'), async (req: any, res) => {
  try {
    const r = await deleteRecord(actorOf(req), 'job', String(req.params.id), typeof req.body?.reason === 'string' ? req.body.reason : null)
    await audit(req, 'soft_delete', 'SavedJob', String(req.params.id), { newValues: r })
    res.json({ success: true, data: r })
  } catch (err) {
    if (err instanceof DeleteError) { res.status(err.status).json({ success: false, error: err.status === 404 ? 'Job not found' : err.message }); return }
    console.error('[saved-jobs] delete error:', err)
    res.status(500).json({ success: false, error: 'Failed to delete job' })
  }
})

// ── Archive / Unarchive (everyday, reversible; no Deleted Records row) ──
for (const [path, on] of [['archive', true], ['unarchive', false]] as const) {
  router.post(`/:id/${path}`, requireUser, requireAccount, requireCan('records.archive'), requireCan('schedule.change'), async (req: any, res) => {
    try {
      const r = await setArchived(actorOf(req), 'job', String(req.params.id), on)
      await audit(req, 'update', 'SavedJob', String(req.params.id), { newValues: { archivedAt: r.archivedAt } })
      res.json({ success: true, data: r })
    } catch (err) {
      if (err instanceof DeleteError) { res.status(err.status).json({ success: false, error: err.message }); return }
      console.error(`[saved-jobs] ${path} error:`, err)
      res.status(500).json({ success: false, error: `Failed to ${path} job` })
    }
  })
}

// ── Bulk sync ──
const syncSchema = z.object({ jobs: z.array(jobSchema) })
router.post('/sync', requireUser, requireAccount, requireCan('records.import'), async (req: any, res) => {
  try {
    const { jobs } = syncSchema.parse(req.body)
    const { stages } = await loadOpsStages(req.user.crmAccountId)
    let created = 0, updated = 0, skipped = 0
    for (const j of jobs) {
      if (j.id) {
        const existing = await prisma.savedJob.findUnique({ where: { id: j.id } })
        if (existing && existing.accountId === req.user.crmAccountId) {
          await prisma.$transaction(async tx => {
            const row = await tx.savedJob.update({
              where: { id: existing.id },
              data: { ...j, id: undefined as any, crmContactId: j.crmContactId || null, quoteId: j.quoteId || null, opsStage: reconcileOpsStage(stages, existing as any, { ...existing, ...j, opsStage: j.opsStage && stageById(stages, j.opsStage) ? j.opsStage : '' } as any) },
            })
            await recordJobChanges(req.user.crmAccountId, existing, row, tx)
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
            opsStage: reconcileOpsStage(stages, null, { ...j, opsStage: j.opsStage && stageById(stages, j.opsStage) ? j.opsStage : '' } as any),
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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[saved-jobs] sync error:', err)
    res.status(500).json({ success: false, error: 'Failed to sync jobs' })
  }
})

export default router
