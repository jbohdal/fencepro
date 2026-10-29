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
 *
 * The Salesman gets the Salesman's own jobs only, read only and without
 * costs (lib/salesmanJobs.ts).
 */

import { cancelRunsLeftBehind } from '../lib/automations/queue.js'
import { finishScheduleRows } from '../lib/installScheduling.js'
import { canonicalWord } from '../lib/optionLists.js'
import { Router } from 'express'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { DeleteError, deleteRecord, setArchived } from '../lib/deletion.js'
import { ensureJobChecklist } from '../lib/seeds.js'
import { audit } from '../lib/auditLog.js'
import { logScheduleChange, scheduleWords } from '../lib/jobActivity.js'
import { resolveSecret } from '../lib/secrets.js'
import { clientIdSchema, decideClientId } from '../lib/clientId.js'
import { syncCalendarAfterWrite } from '../lib/calendarSync/index.js'
import { plainZod } from '../lib/plainZod.js'
import { checkJobMove, refuseBlocked } from '../lib/automations/stageRules.js'
import { recordJobChanges } from '../lib/automations/hooks.js'
import { roleOf, requireCan, can } from '../lib/permissions.js'
import { repForJob } from '../lib/salesRep.js'
import { hidesCosts, hidesPrices, isPriceKey, crewTextBack } from '../lib/costRedact.js'
import { loadOpsStages } from '../lib/opsStages.js'
import { reconcileOpsStage, stageById, stageOfJob, fieldsForStage, isDonePhase, phaseOf, sortedStages, MATERIALS_RANK, type OpsStageDef } from '../lib/opsStageModel.js'
import { floridaDay } from '../lib/automations/context.js'
import { jobTotalsFor } from '../lib/changeOrders.js'
import { afterJobSaved, salePriceForJob } from '../lib/contractBilling.js'
import { syncSalesOrderSafe } from '../lib/salesOrders.js'
import { ordersFollowJobMaterials } from '../lib/materialsFromOrders.js'
import { saveLocate, jobMilestones, milestoneSummary, setHandTick, cardFollowsJob, closeOutIfDone } from '../lib/jobTruth.js'
import { salesmanJobScope } from '../lib/salesmanJobs.js'

const router = Router()

/** Back from a closed stage: to a stage that is not done (a hold too), or to one before it on the board. */
export function movesBack(stages: OpsStageDef[], from: string, to: string): boolean {
  if (!isDonePhase(phaseOf(stages, to))) return true
  const order = sortedStages(stages).map(s => s.id)
  return order.indexOf(to) < order.indexOf(from)
}

// Anything saved here may carry a date: keep Google Calendar in step, in the background.
router.use(syncCalendarAfterWrite as any)

// The Salesman: the Salesman's own jobs only, read only, without costs (lib/salesmanJobs.ts; audit #49, Oct 28 2026).
router.use(salesmanJobScope)

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

const jobUpdateSchema = jobSchema.partial().extend({
  /**
   * The job as this screen had it before the edit (the same fields). A field
   * the screen did not change is left as the server has it, and a stage move
   * made on a copy whose stage is not the server's any more is refused (409
   * STALE_JOB): an open job window that missed a close out can never move a
   * Paid job back (round 2b, Oct 26 2026). Older screens send none.
   */
  base: z.record(z.unknown()).optional(),
  /** Move a closed job (Complete, Invoiced, Paid) back: only with Reopen, by the owner or the office. */
  reopen: z.boolean().optional(),
})

/** Same value for a three way save: null, undefined and a missing field are one. */
const sameValue = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** A job save never writes these: the 811 locate has its own save (PUT /:id/locate), from the job page and the crew packet. */
const LOCATE_KEYS = ['locatesDate', 'locatesExpDate', 'locateTicket', 'locateCalledDate'] as const
/** With a payment schedule, the paid figures come from it (lib/contractBilling.ts settleIn), never from a screen's copy. */
const PAID_KEYS = ['amountPaid', 'paymentStatus', 'paymentDate', 'paymentMethod'] as const

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

// ── Milestones of every open job (the board cards' count; lib/jobTruth.ts) ──
router.get('/milestones/summary', requireUser, requireAccount, async (req: any, res) => {
  try {
    res.json({ success: true, data: await milestoneSummary(req.user.crmAccountId) })
  } catch (err) {
    console.error('[saved-jobs] milestone summary error:', err)
    res.status(500).json({ success: false, error: 'Could not read the milestones' })
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
    // No rep sent: the quote's (credited to whoever sold it, routes/saved-quotes.ts).
    if (!fields.salesRep?.trim() && data.quoteId) fields.salesRep = (await prisma.savedQuote.findFirst({ where: { id: data.quoteId, accountId: req.user.crmAccountId }, select: { salesRep: true } }))?.salesRep ?? ''
    // A job for a sale carries the price the sale is billed at (lib/contractBilling.ts salePriceForJob): signed from
    // Oct 29 2026 on, the whole dollar the customer saw (D1), not the quote's cents an older screen copied; signed
    // before, the quote's price to the cent. Only a copy of it is corrected (within a dollar): a price typed by hand
    // is left as sent, and anything on top of the price (contractValue) stays on top.
    if (data.quoteId && fields.quotePrice > 0) {
      const sale = await salePriceForJob(req.user.crmAccountId, data.quoteId)
      const saleCents = sale === null ? 0 : Math.round(sale * 100)
      const sentCents = Math.round(fields.quotePrice * 100)
      if (saleCents > 0 && sentCents !== saleCents && Math.abs(sentCents - saleCents) < 100) {
        const contractCents = Math.round((fields.contractValue || 0) * 100)
        fields.quotePrice = saleCents / 100
        fields.contractValue = (contractCents > 0 ? contractCents - sentCents + saleCents : saleCents) / 100
      }
    }
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
    // The sales card follows the job (Job Prep, Pending Start, ... by Settings > Pipeline Stages; lib/jobTruth.ts).
    await cardFollowsJob(req.user.crmAccountId, created.id)
    // Its materials to order (Inventory > Sales Orders) from its pull sheet as signed (lib/salesOrders.ts).
    await syncSalesOrderSafe(req.user.crmAccountId, created.quoteId)
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
    // One record each: the locate (its own save) and the paid figures (the payment schedule).
    for (const k of LOCATE_KEYS) delete (data as any)[k]
    if (await prisma.paymentSchedule.findFirst({ where: { accountId: req.user.crmAccountId, jobId: req.params.id }, select: { id: true } })) for (const k of PAID_KEYS) delete (data as any)[k]
    const existing = await prisma.savedJob.findUnique({ where: { id: req.params.id } })
    if (!existing || existing.accountId !== req.user.crmAccountId || existing.deletedAt) {
      res.status(404).json({ success: false, error: 'Job not found' })
      return
    }
    // The Installer's notes came with dollar amounts left out: they go back in as saved (lib/costRedact.ts).
    // He read the notes without the sentences about a price (lib/costRedact.ts forCrew): those stay as saved.
    if (hidesPrices(roleOf(req)) && typeof data.notes === 'string') data.notes = crewTextBack(data.notes, existing.notes ?? '')
    // The Installer changes his job's notes only: moving the stage, holding, the status and the rest are the
    // office's (review, Oct 25, 2026). A move or hold is refused; anything else his phone sends back is left as saved.
    if (hidesPrices(roleOf(req))) {
      const moved = (['opsStage', 'status', 'holdReason'] as const).some(k => (data as any)[k] !== undefined && String((data as any)[k] ?? '') !== String((existing as any)[k] ?? ''))
      if (moved) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Your role cannot move or hold jobs. Ask the office.', data: existing }); return }
      for (const k of Object.keys(data)) if (k !== 'notes') delete (data as any)[k]
    }
    // Three way: what this screen did not change stays as the server has it (a payment or a signature may have
    // closed the job since the screen read it); a stage move from an old copy is refused, nothing is saved.
    const base = (data as any).base as Record<string, unknown> | undefined
    const reopen = (data as any).reopen === true
    delete (data as any).base; delete (data as any).reopen
    if (base) for (const k of Object.keys(data)) if (k in base && sameValue((data as any)[k], base[k])) delete (data as any)[k]
    const { stages } = await loadOpsStages(req.user.crmAccountId)
    const movesStage = (data.opsStage !== undefined && data.opsStage !== '' && data.opsStage !== existing.opsStage) || (data.status !== undefined && data.status !== existing.status)
    if (base && movesStage) {
      const seen = stageOfJob(stages, base as any)
      const now = stageOfJob(stages, existing as any)
      if (seen !== now || (typeof base.status === 'string' && base.status !== existing.status)) {
        res.status(409).json({ success: false, code: 'STALE_JOB', error: `${existing.customerName || 'This job'} is in ${stageById(stages, now)?.name ?? now} now (it changed after this screen opened). Nothing was moved. Look at it again and move it from there.`, data: existing })
        return
      }
    }
    // A rep already on the job stays when a blank one is sent (an older copy); a job with none takes its quote's (lib/salesRep.ts).
    if (data.salesRep !== undefined && !data.salesRep.trim()) {
      if (existing.salesRep?.trim()) delete (data as any).salesRep
      else data.salesRep = (await repForJob(req, data.salesRep, data.quoteId === undefined ? existing.quoteId : data.quoteId)) ?? ''
    }
    // The stage, by id (Settings > Operations Stages): moved on purpose, or as a status change moves it.
    if (data.opsStage && !stageById(stages, data.opsStage)) {
      res.status(400).json({ success: false, error: 'That stage is not in Settings > Operations Stages any more. Reload and pick another.' })
      return
    }
    const wasStage = stageOfJob(stages, existing as any)
    const nextStage = reconcileOpsStage(stages, existing as any, { ...existing, ...data } as any)
    // Moved on purpose: the status (and the rest) that stage stands for, whatever an older screen sent.
    // A closed job (Complete, Invoiced, Paid) never goes back by itself or from an old screen: only Reopen, by the owner or the office.
    if (nextStage !== wasStage && isDonePhase(existing.status) && movesBack(stages, wasStage, nextStage) && !(reopen && can(roleOf(req), 'schedule.change'))) {
      const to = stageById(stages, nextStage)?.name ?? nextStage
      res.status(409).json({ success: false, code: 'REOPEN_NEEDED', error: `${existing.customerName || 'This job'} is ${stageById(stages, wasStage)?.name ?? existing.status}, a closed job. Moving it back to ${to} reopens it: only the owner or the office can, with Reopen.`, data: existing })
      return
    }
    if (nextStage !== wasStage && data.opsStage === nextStage) {
      Object.assign(data, fieldsForStage(stages, nextStage, existing as any, floridaDay(new Date())) ?? {})
      // A stage move never lowers the materials, whatever an older screen sent (audit #43: a Received job dragged back was marked Ordered).
      if (data.materialsStatus !== undefined && (MATERIALS_RANK[data.materialsStatus as string] ?? 0) < (MATERIALS_RANK[existing.materialsStatus as string] ?? 0)) delete (data as any).materialsStatus
    }
    // Reopened (Reopen said, and allowed above): no longer done, so no completed date.
    if (nextStage !== wasStage && isDonePhase(existing.status) && !isDonePhase(phaseOf(stages, nextStage))) { (data as any).completedDate = null; (data as any).completedBy = null }
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
    // Materials raised by hand (a move into Materials Ordered or Ready to Pull): its pending Sales Order is marked Ordered, never Received (audit #54, lib/materialsFromOrders.ts).
    if ((MATERIALS_RANK[updated.materialsStatus as string] ?? 0) > (MATERIALS_RANK[existing.materialsStatus as string] ?? 0)) {
      await ordersFollowJobMaterials(req.user.crmAccountId, updated, updated.materialsStatus, req.user.email ?? 'staff')
    }
    // Its install day changed here (an older screen): kept on the job's activity (lib/jobActivity.ts).
    if ((existing.scheduledDate || '') !== (updated.scheduledDate || '')) {
      const ymd = (x: string) => /^\d{4}-\d{2}-\d{2}$/.test(x)
      const words = !ymd(updated.scheduledDate || '') ? (ymd(existing.scheduledDate || '') ? scheduleWords('off', { was: existing.scheduledDate }) : '')
        : scheduleWords(ymd(existing.scheduledDate || '') ? 'moved' : 'scheduled', { start: updated.scheduledDate, end: updated.scheduledEndDate, crew: updated.crewAssigned, was: ymd(existing.scheduledDate || '') ? existing.scheduledDate : undefined })
      if (words) await logScheduleChange(updated.id, words, { userId: req.user.id ?? null })
    }
    // The payment schedule: made if the quote is signed now, and the Final due on the install date (lib/contractBilling.ts).
    await afterJobSaved(req.user.crmAccountId, updated.id, { userId: req.user.id ?? null, name: req.user.email ?? '' })
    await cardFollowsJob(req.user.crmAccountId, updated.id)
    // A stage it has moved on from: its queued runs for that stage are cancelled.
    if (existing.opsStage !== updated.opsStage) await cancelRunsLeftBehind(req.user.crmAccountId, 'ops', updated.id).catch(e => console.error('[saved-jobs] cancel runs:', e))
    // Finished now: its crew days done, any still ahead taken off the Schedule (lib/installScheduling.ts).
    const DONE = ['completed', 'invoiced', 'paid']
    if (!DONE.includes(existing.status) && DONE.includes(updated.status)) {
      await finishScheduleRows(req.user.crmAccountId, updated.id, { accountId: req.user.crmAccountId, userId: req.user.id ?? null }, updated.completedDate || floridaDay(new Date())).catch(e => console.error('[saved-jobs] finish schedule rows:', e))
      // Marked Complete by hand and already paid in full: on to Paid by itself (lib/jobTruth.ts closeOutIfDone).
      if (updated.status !== 'paid') {
        const out = await closeOutIfDone(req.user.crmAccountId, updated.id, 'marked complete, already paid in full')
        if (out.moved) { res.json({ success: true, data: await prisma.savedJob.findUnique({ where: { id: updated.id } }) }); return }
      }
    }
    res.json({ success: true, data: updated })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[saved-jobs] update error:', err)
    res.status(500).json({ success: false, error: 'Failed to update job' })
  }
})

// ── The 811 locate: one record on the job (lib/locates.ts); the crew packet saves the same fields ──
/** The person, by name (Settings > Team), for "Ticked by hand by ..." and the locate's "Last saved by". */
async function whoOf(req: any): Promise<string> {
  const u = req.user?.id ? await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null) : null
  return `${u?.firstName ?? ''} ${u?.lastName ?? ''}`.trim() || String(req.user?.email || 'staff')
}
router.put('/:id/locate', requireUser, requireAccount, requireCan('schedule.change'), async (req: any, res) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>
    const row = await saveLocate(req.user.crmAccountId, String(req.params.id), { ticket: b.ticket, calledDate: b.calledDate, goodDate: b.goodDate, expDate: b.expDate }, await whoOf(req))
    res.json({ success: true, data: row })
  } catch (err: any) {
    if (err?.status) { res.status(err.status).json({ success: false, error: err.message }); return }
    console.error('[saved-jobs] locate error:', err)
    res.status(500).json({ success: false, error: 'Could not save the locate' })
  }
})

// ── Milestones: worked out from the job's records; a tick by hand where allowed (lib/jobReadiness.ts) ──
router.get('/:id/milestones', requireUser, requireAccount, async (req: any, res) => {
  try {
    res.json({ success: true, data: await jobMilestones(req.user.crmAccountId, String(req.params.id)) })
  } catch (err: any) {
    if (err?.status) { res.status(err.status).json({ success: false, error: err.message }); return }
    console.error('[saved-jobs] milestones error:', err)
    res.status(500).json({ success: false, error: 'Could not read the milestones' })
  }
})
router.post('/:id/milestones', requireUser, requireAccount, requireCan('schedule.change'), async (req: any, res) => {
  try {
    const b = z.object({ label: z.string().min(1).max(200), ticked: z.boolean() }).parse(req.body)
    await setHandTick(req.user.crmAccountId, String(req.params.id), b.label, b.ticked, await whoOf(req))
    await audit(req, 'update', 'SavedJob', String(req.params.id), { newValues: { milestone: b.label, tickedByHand: b.ticked } })
    res.json({ success: true, data: await jobMilestones(req.user.crmAccountId, String(req.params.id)) })
  } catch (err: any) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    if (err?.status) { res.status(err.status).json({ success: false, error: err.message }); return }
    console.error('[saved-jobs] milestone tick error:', err)
    res.status(500).json({ success: false, error: 'Could not save the tick' })
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
        await syncSalesOrderSafe(req.user.crmAccountId, safeQuoteId)
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
