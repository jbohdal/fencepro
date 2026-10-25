/**
 * One source of truth for a job's state (Jonathan, Oct 25 2026, walkthrough
 * round 1 items 6 to 8 and 12):
 *
 *   saveLocate        the 811 locate, one record on the job (lib/locates.ts),
 *                     from the job page or the crew packet.
 *   jobMilestones     the Milestone Checklist worked out from the records
 *                     (lib/jobReadiness.ts); a hand tick is an override.
 *   setHandTick       tick or untick a milestone by hand (only where allowed).
 *   billingStatusOf   the job's payment status in words, from its payment
 *                     schedule: the same on the job's Financial section,
 *                     Payments and Billing.
 *   closeOutIfDone    a job whose final walkthrough is signed and that is paid
 *                     in full moves to the Complete stage by itself, with its
 *                     pipeline card to Job complete.
 */

import prisma from './prisma.js'
import { auditSystem } from './auditLog.js'
import { recordJobChanges, recordCardMoves } from './automations/hooks.js'
import { loadOpsStages } from './opsStages.js'
import { completeStage, fieldsForStage, isDonePhase, stageOfJob, stageById } from './opsStageModel.js'
import { floridaDay } from './automations/context.js'
import { cleanLocate, locateFields, locateOf, type LocateInput } from './locates.js'
import { milestones, milestoneOfLabel, labelKey, progressOf, billingStatusOf, invoiceDue, type InvoiceDueState, type Milestone, type ReadinessFacts, type StoredTick } from './jobReadiness.js'
export { billingStatusOf } from './jobReadiness.js'
import { applyPayments } from './paymentMath.js'
import { findOrCreate } from './once.js'
import { defaultChecklist, milestoneLabels, milestoneId } from './seeds.js'
import { loadPipelineStages } from './pipelineStages.js'
import { cardForCompletedJob, roleStageId, isSoldStage, isOpenStage, stageNameOf, hasRole, sortedStages, stageById as pipelineStageById, GROUPS, type PipelineStageDef } from './pipelineStageModel.js'
import { applyPipelineDelta } from './pipelineDelta.js'

type Json = any
const err = (status: number, message: string) => Object.assign(new Error(message), { status })

// ── The 811 locate ───────────────────────────────────────────────────────────

/** Save the job's 811 locate (job page or crew packet). Returns the job row. */
export async function saveLocate(accountId: string, jobId: string, input: LocateInput, by: string): Promise<Json> {
  const c = cleanLocate(input, floridaDay(new Date()))
  if (!c.ok) throw err(400, c.error)
  const existing = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null } })
  if (!existing) throw err(404, 'Job not found')
  const fields = locateFields(c.record)
  const same = (Object.keys(fields) as Array<keyof typeof fields>).every(k => ((existing as Json)[k] ?? null) === fields[k])
  if (same) return existing
  const updated = await prisma.$transaction(async tx => {
    const row = await tx.savedJob.update({ where: { id: jobId }, data: { ...fields, locateUpdatedBy: by.slice(0, 200) || null, locateUpdatedAt: new Date() } })
    await recordJobChanges(accountId, existing, row, tx)
    return row
  })
  await auditSystem('update', 'SavedJob', jobId, {
    oldValues: { locateTicket: existing.locateTicket, locateCalledDate: existing.locateCalledDate, locatesDate: existing.locatesDate, locatesExpDate: existing.locatesExpDate },
    newValues: { ...fields, by },
  })
  return updated
}

// ── Payment status ──────────────────────────────────────────────────────────

/** The job's schedule as billingStatusOf reads it, or null. */
export async function billingViewFor(accountId: string, jobId: string): Promise<Parameters<typeof billingStatusOf>[0]> {
  const schedule = await prisma.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId } } })
  if (!schedule) return null
  const [invoices, payments, job] = await Promise.all([
    prisma.contractInvoice.findMany({ where: { scheduleId: schedule.id, voidedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.contractPayment.findMany({ where: { accountId, jobId } }),
    prisma.savedJob.findUnique({ where: { id: jobId }, select: { completedDate: true } }),
  ])
  const a = applyPayments(
    invoices.map(i => ({ id: i.id, amountCents: i.amountCents, sortOrder: i.sortOrder, createdAt: i.createdAt, voided: false })),
    payments.map(p => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, createdAt: p.createdAt, voided: !!p.voidedAt })),
  )
  const contractCents = invoices[0]?.contractCents ?? schedule.signedCents
  const paid = payments.filter(p => !p.voidedAt).reduce((s, p) => s + p.amountCents, 0)
  return {
    contractCents, paidCents: paid, completedDate: job?.completedDate ?? null,
    invoices: invoices.map(i => ({ kind: i.kind, label: i.label, amountCents: i.amountCents, balanceCents: i.amountCents - (a.paidByInvoice.get(i.id) ?? 0), dueOn: i.dueOn, dueDate: i.dueDate })),
  }
}

// ── Accounts receivable ─────────────────────────────────────────────────────

export interface Receivable {
  invoiceId: string; jobId: string; customerId: string | null; customerName: string; address: string; fenceStyle: string
  label: string; kind: string; amountCents: number; balanceCents: number
  state: InvoiceDueState; dueDate: string | null; daysOver: number
}

/**
 * Every open invoice on the payment schedules (lib/contractBilling.ts): what
 * the Billing page (Accounts Receivable) lists, with the same due and overdue
 * rule as the job's Financial section (jobReadiness.invoiceDue). Jobs deleted
 * are left out; archived ones still owe.
 */
export async function receivables(accountId: string, today = floridaDay(new Date())): Promise<Receivable[]> {
  const [invoices, payments, jobs] = await Promise.all([
    prisma.contractInvoice.findMany({ where: { accountId, voidedAt: null } }),
    prisma.contractPayment.findMany({ where: { accountId } }),
    prisma.savedJob.findMany({ where: { accountId, deletedAt: null }, select: { id: true, crmContactId: true, customerName: true, customerAddress: true, fenceStyle: true, completedDate: true } }),
  ])
  const byJob = new Map(jobs.map(j => [j.id, j]))
  const out: Receivable[] = []
  const ids = [...new Set(invoices.map(i => i.jobId))]
  for (const jobId of ids) {
    const j = byJob.get(jobId)
    if (!j) continue
    const inv = invoices.filter(i => i.jobId === jobId)
    const a = applyPayments(
      inv.map(i => ({ id: i.id, amountCents: i.amountCents, sortOrder: i.sortOrder, createdAt: i.createdAt, voided: false })),
      payments.filter(p => p.jobId === jobId).map(p => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, createdAt: p.createdAt, voided: !!p.voidedAt })),
    )
    for (const i of inv.sort((x, y) => x.sortOrder - y.sortOrder)) {
      const balanceCents = i.amountCents - (a.paidByInvoice.get(i.id) ?? 0)
      if (balanceCents <= 0) continue
      const d = invoiceDue({ balanceCents, dueOn: i.dueOn, dueDate: i.dueDate }, j.completedDate, today)
      out.push({ invoiceId: i.id, jobId, customerId: j.crmContactId, customerName: j.customerName, address: j.customerAddress, fenceStyle: j.fenceStyle, label: i.label, kind: i.kind, amountCents: i.amountCents, balanceCents, state: d.state, dueDate: d.dueDate, daysOver: d.daysOver })
    }
  }
  return out.sort((x, y) => y.daysOver - x.daysOver || x.customerName.localeCompare(y.customerName))
}

// ── Milestones ──────────────────────────────────────────────────────────────

async function checklistState(accountId: string) {
  const s = await prisma.businessState.findUnique({ where: { accountId }, select: { jobChecklists: true, defaultMilestones: true } })
  const map = (s?.jobChecklists && typeof s.jobChecklists === 'object' && !Array.isArray(s.jobChecklists) ? s.jobChecklists : {}) as unknown as Record<string, StoredTick[]>
  return { map, labels: milestoneLabels(s?.defaultMilestones) }
}

/** The facts behind the milestones, for many jobs at once. */
export async function readinessFactsFor(accountId: string, jobs: Json[], today = floridaDay(new Date())): Promise<Map<string, ReadinessFacts>> {
  const ids = jobs.map(j => j.id)
  const out = new Map<string, ReadinessFacts>()
  if (!ids.length) return out
  const quoteKeys = jobs.map(j => j.quoteId).filter(Boolean) as string[]
  const [permits, vendor, takeoffs, walks, media, invoices, payments, sched] = await Promise.all([
    prisma.permit.findMany({ where: { accountId, jobId: { in: ids } }, select: { jobId: true, status: true } }),
    prisma.vendorInvoice.groupBy({ by: ['jobId'], where: { accountId, jobId: { in: ids }, docType: 'invoice', status: { notIn: ['refused', 'undone', 'failed', 'replaced'] } }, _count: { _all: true } }),
    prisma.jobTakeoff.findMany({ where: { accountId, jobId: { in: ids } }, select: { jobId: true } }),
    prisma.walkthrough.findMany({ where: { accountId, jobId: { in: ids } }, select: { jobId: true, homeownerSig: true, repSig: true, signedAt: true, status: true } }),
    // Counted as the job's gallery counts them: the job's own and its quote's (routes/media.ts).
    prisma.mediaItem.findMany({ where: { accountId, deletedAt: null, OR: [{ jobId: { in: ids } }, ...(quoteKeys.length ? [{ quoteKey: { in: quoteKeys } }] : [])] }, select: { id: true, jobId: true, quoteKey: true } }),
    prisma.contractInvoice.findMany({ where: { accountId, jobId: { in: ids }, voidedAt: null } }),
    prisma.contractPayment.findMany({ where: { accountId, jobId: { in: ids } } }),
    prisma.scheduleSettings.findUnique({ where: { accountId }, select: { crews: true } }),
  ])
  const crews = (Array.isArray(sched?.crews) ? sched!.crews : []) as Array<{ id: string; name: string }>
  const norm = (x: string) => String(x || '').toLowerCase().replace(/\s+/g, '')
  const crewNameOf = (v: string) => { const t = (v || '').trim(); const c = crews.find(x => x.id === t || norm(x.name) === norm(t)); return c ? c.name : t }
  for (const j of jobs) {
    const w = walks.find(x => x.jobId === j.id)
    const inv = invoices.filter(i => i.jobId === j.id).sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime())
    let billing: ReadinessFacts['billing'] = null
    if (inv.length) {
      const pays = payments.filter(p => p.jobId === j.id)
      const a = applyPayments(
        inv.map(i => ({ id: i.id, amountCents: i.amountCents, sortOrder: i.sortOrder, createdAt: i.createdAt, voided: false })),
        pays.map(p => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, createdAt: p.createdAt, voided: !!p.voidedAt })),
      )
      const st = billingStatusOf({
        contractCents: inv[0].contractCents, paidCents: pays.filter(p => !p.voidedAt).reduce((s, p) => s + p.amountCents, 0), completedDate: j.completedDate ?? null,
        invoices: inv.map(i => ({ kind: i.kind, label: i.label, amountCents: i.amountCents, balanceCents: i.amountCents - (a.paidByInvoice.get(i.id) ?? 0), dueOn: i.dueOn, dueDate: i.dueDate })),
      })
      billing = { finalCents: st.finalCents, finalDue: st.finalDue, balanceCents: st.balanceCents, paidInFull: st.paidInFull }
    }
    const homeowner = (w?.homeownerSig as Json)?.name ?? null
    out.set(j.id, {
      today, status: j.status, previousStatus: j.previousStatus ?? null, locate: locateOf(j),
      permitStatus: permits.find(p => p.jobId === j.id)?.status ?? null,
      materialsStatus: j.materialsStatus, vendorInvoices: vendor.find(v => v.jobId === j.id)?._count._all ?? 0,
      crewAssigned: crewNameOf(j.crewAssigned || ''), scheduledDate: j.scheduledDate || '',
      takeoffStarted: takeoffs.some(t => t.jobId === j.id),
      walkthrough: w ? { signed: !!w.homeownerSig && !!w.repSig, signedAt: w.signedAt ? floridaDay(w.signedAt) : null, homeowner, open: w.status === 'open' } : null,
      photos: media.filter(m => m.jobId === j.id || (j.quoteId && m.quoteKey === j.quoteId)).length,
      billing,
    })
  }
  return out
}

/** One job's milestones and progress. */
export async function jobMilestones(accountId: string, jobId: string): Promise<{ milestones: Milestone[]; complete: number; total: number; closeOut: 'mark_installed' | null }> {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null } })
  if (!job) throw err(404, 'Job not found')
  const [facts, cl] = await Promise.all([readinessFactsFor(accountId, [job]), checklistState(accountId)])
  const list = milestones(facts.get(job.id)!, cl.map[job.id], cl.labels)
  return { milestones: list, ...progressOf(list), closeOut: await closeOutPrompt(accountId, job) }
}

/** Every open job's milestone count (the board cards). */
export async function milestoneSummary(accountId: string): Promise<Record<string, { complete: number; total: number }>> {
  const jobs = await prisma.savedJob.findMany({ where: { accountId, deletedAt: null, archivedAt: null } })
  const [facts, cl] = await Promise.all([readinessFactsFor(accountId, jobs), checklistState(accountId)])
  const out: Record<string, { complete: number; total: number }> = {}
  for (const j of jobs) out[j.id] = progressOf(milestones(facts.get(j.id)!, cl.map[j.id], cl.labels))
  return out
}

/** Tick or untick a milestone by hand. Refused where the record decides (locate, permit, crew). */
export async function setHandTick(accountId: string, jobId: string, label: string, ticked: boolean, by: string): Promise<void> {
  const def = milestoneOfLabel(label)
  if (def && !def.byHand) throw err(409, `${def.label} follows the job's ${def.key === 'locate' ? '811 locate' : def.key === 'permit' ? 'Permit' : 'Schedule install'}: change it there.`)
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null }, select: { id: true } })
  if (!job) throw err(404, 'Job not found')
  for (let attempt = 0; attempt < 8; attempt++) {
    const s = await findOrCreate(
      () => prisma.businessState.findUnique({ where: { accountId } }),
      () => prisma.businessState.create({ data: { accountId } }),
    )
    const map = (s.jobChecklists && typeof s.jobChecklists === 'object' && !Array.isArray(s.jobChecklists) ? { ...(s.jobChecklists as Json) } : {}) as Record<string, Json[]>
    const now = new Date().toISOString()
    const list: Json[] = Array.isArray(map[jobId]) && map[jobId].length ? map[jobId].map((x: Json) => ({ ...x })) : defaultChecklist(jobId, milestoneLabels(s.defaultMilestones), now)
    let item = list.find(x => labelKey(String(x.label ?? '')) === labelKey(label))
    if (!item) throw err(404, 'That milestone is not on this job.')
    item.isComplete = ticked
    item.completedBy = ticked ? by.slice(0, 200) || 'by hand' : undefined
    item.completedAt = ticked ? now : undefined
    item.updatedAt = now
    map[jobId] = list
    const done = await prisma.businessState.updateMany({ where: { accountId, version: s.version }, data: { jobChecklists: map as any, version: { increment: 1 } } })
    if (done.count === 1) return
  }
  throw err(503, 'Could not save the tick (the settings record kept changing). Try again.')
}

/** Clear hand ticks that the records contradict and that cannot be ticked by hand (the backfill). Returns the labels cleared. */
export async function clearStaleTicks(accountId: string, jobId: string, labels: string[]): Promise<string[]> {
  if (!labels.length) return []
  const keys = new Set(labels.map(labelKey))
  for (let attempt = 0; attempt < 8; attempt++) {
    const s = await prisma.businessState.findUnique({ where: { accountId } })
    if (!s) return []
    const map = { ...((s.jobChecklists as Json) ?? {}) } as Record<string, Json[]>
    if (!Array.isArray(map[jobId])) return []
    const cleared: string[] = []
    map[jobId] = map[jobId].map((x: Json) => {
      if (!x?.isComplete || !keys.has(labelKey(String(x.label ?? '')))) return x
      cleared.push(String(x.label))
      return { ...x, isComplete: false, completedBy: undefined, completedAt: undefined, updatedAt: new Date().toISOString() }
    })
    if (!cleared.length) return []
    const done = await prisma.businessState.updateMany({ where: { accountId, version: s.version }, data: { jobChecklists: map as any, version: { increment: 1 } } })
    if (done.count === 1) return cleared
  }
  throw new Error('Could not clear the ticks (the settings record kept changing).')
}

export { milestoneId }

// ── Close out ───────────────────────────────────────────────────────────────

/**
 * The job's pipeline card to the Job complete stage (the same card rule as
 * the web app's jobCompleteFlow.ts: the card with the job's quote, else the
 * customer's only Sold, work ahead card). Never throws.
 */
export async function moveCardToJobComplete(accountId: string, job: Json): Promise<string | null> {
  try {
    const { stages } = await loadPipelineStages(accountId)
    const target = roleStageId(stages, 'complete')
    if (!target) return null
    const q = job.quoteId ? await prisma.savedQuote.findFirst({ where: { id: job.quoteId, accountId }, select: { crmContactId: true } }) : null
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await prisma.pipelineState.findUnique({ where: { accountId } })
      if (!state) return null
      const leads = (state.leads as Json[]) ?? []
      const pick = cardForCompletedJob({ id: job.id, quoteId: job.quoteId, customerId: job.crmContactId }, q?.crmContactId ?? null, leads, stages)
      if (!pick.cardId) return null
      const card = leads.find(l => l.id === pick.cardId)
      if (!card || card.stage === target) return card?.id ?? null
      const lead = { ...card, stage: target, lastMoved: floridaDay(new Date()), isCompleted: true, quoteId: card.quoteId || job.quoteId || undefined, jobId: card.jobId || job.id }
      const next = applyPipelineDelta({ leads, stages: (state.stages as Json[]) ?? [] }, { upsert: [{ lead }], remove: [] })
      const done = await prisma.$transaction(async tx => {
        const d = await tx.pipelineState.updateMany({ where: { accountId, version: state.version }, data: { leads: JSON.parse(JSON.stringify(next.leads)), version: { increment: 1 } } })
        if (d.count === 1) await recordCardMoves(accountId, leads, next.leads, state.version + 1, tx)
        return d
      })
      if (done.count === 1) return card.id
    }
  } catch (e) { console.error('[close out] pipeline card:', e) }
  return null
}

export interface CardBehind { jobId: string; customerName: string; jobStatus: string; cardId: string; from: string; fromName: string; to: string; toName: string }

/**
 * The pipeline stage a sold job's card belongs in, from the job (Settings >
 * Pipeline Stages, by role and by order, never by name):
 *   staging (permit, 811, materials)  the Sold, work ahead stage after Signed (Job Prep)
 *   scheduled                         the next one (Pending Start)
 *   in progress                       the next one (Jobs In Progress)
 *   done, money still owed            the Job complete stage
 *   done and paid in full             the last Sold, work done stage (Paid & Closed)
 * A list with fewer stages uses the last one there is. On hold: no move.
 */
export function cardStageForJob(list: PipelineStageDef[], job: { status: string; previousStatus?: string | null; scheduledDate?: string | null }, paidInFull: boolean): string | null {
  const shown = sortedStages(list).filter(s => !s.hidden)
  const ahead = shown.filter(s => s.group === 'sold_ahead')
  const done = shown.filter(s => s.group === 'sold_done')
  const signed = roleStageId(list, 'signed')
  const complete = roleStageId(list, 'complete')
  const at = signed ? ahead.findIndex(s => s.id === signed) : -1
  const pick = (n: number) => (ahead.length ? ahead[Math.min(ahead.length - 1, Math.max(0, at) + n)].id : signed)
  switch (job.status) {
    // A job with an install date waits to start, whatever its prep stage says (Manuel: Ready to Pull, installs 10/26).
    case 'staging': return /^\d{4}-\d{2}-\d{2}$/.test(job.scheduledDate || '') ? pick(2) : pick(1)
    case 'scheduled': return pick(2)
    case 'in_progress': return pick(3)
    case 'completed': case 'invoiced': case 'paid':
      return paidInFull ? (done[done.length - 1]?.id ?? complete) : complete
    default: return null
  }
}

/** Where a stage sits on the board, left to right (group, then order). */
function boardRank(list: PipelineStageDef[], id: string): number {
  const st = pipelineStageById(list, id)
  if (!st) return -1
  return GROUPS.indexOf(st.group) * 1000 + st.order
}

/** The card of a job: the one carrying its quote or id, else the customer's only open card with no quote. */
function cardOfJob(list: PipelineStageDef[], leads: Json[], j: { id: string; quoteId: string | null; crmContactId: string | null }): Json | null {
  const own = leads.filter(l => (j.quoteId && l.quoteId === j.quoteId) || l.jobId === j.id)
  if (own.length === 1) return own[0]
  if (own.length > 1 || !j.crmContactId) return null
  // The customer's only card with no quote, selling or sold (never one in a dead stage).
  const o = leads.filter(l => l.customerId === j.crmContactId && !l.quoteId && (isOpenStage(list, l.stage) || isSoldStage(list, l.stage)))
  return o.length === 1 ? o[0] : null
}

/** Is a card behind its job (and where should it go)? Only forward, never out of a dead stage. */
function behindTarget(list: PipelineStageDef[], card: Json, target: string | null): string | null {
  if (!target || card.stage === target) return null
  const cur = pipelineStageById(list, card.stage)
  if (cur?.group === 'dead') return null
  return boardRank(list, target) > boardRank(list, card.stage) ? target : null
}

/**
 * Pipeline cards behind their job (cardStageForJob): listed by the backfill,
 * moved with --apply (moveCardTo), and kept in step after every job change
 * (cardFollowsJob).
 */
export async function cardsBehind(accountId: string, onlyJobId?: string): Promise<CardBehind[]> {
  const { stages } = await loadPipelineStages(accountId)
  const state = await prisma.pipelineState.findUnique({ where: { accountId } })
  const leads = ((state?.leads as Json[]) ?? []).filter(Boolean)
  // One job: it and its customer's other jobs (so a card two jobs could claim is never moved).
  const one = onlyJobId ? await prisma.savedJob.findFirst({ where: { id: onlyJobId, accountId }, select: { crmContactId: true } }) : null
  const jobs = await prisma.savedJob.findMany({ where: { accountId, deletedAt: null, ...(onlyJobId ? { OR: [{ id: onlyJobId }, ...(one?.crmContactId ? [{ crmContactId: one.crmContactId }] : [])] } : {}) }, select: { id: true, quoteId: true, crmContactId: true, customerName: true, status: true, previousStatus: true, scheduledDate: true } })
  const out: CardBehind[] = []
  for (const j of jobs) {
    const card = cardOfJob(stages, leads, j)
    if (!card) continue
    const paid = isDonePhase(j.status) ? billingStatusOf(await billingViewFor(accountId, j.id)).paidInFull : false
    const to = behindTarget(stages, card, cardStageForJob(stages, j, paid))
    if (!to) continue
    out.push({ jobId: j.id, customerName: j.customerName, jobStatus: j.status, cardId: card.id, from: card.stage, fromName: stageNameOf(stages, card.stage), to, toName: stageNameOf(stages, to) })
  }
  // One card for two of a customer's jobs (no quote on it to tell them apart): left alone, never guessed.
  const n = new Map<string, number>()
  for (const c of out) n.set(c.cardId, (n.get(c.cardId) ?? 0) + 1)
  return out.filter(c => n.get(c.cardId) === 1 && (!onlyJobId || c.jobId === onlyJobId))
}

/** After a job change: its card goes where the job is (only forward). Never throws. */
export async function cardFollowsJob(accountId: string, jobId: string): Promise<void> {
  try {
    for (const c of await cardsBehind(accountId, jobId)) {
      const j = await prisma.savedJob.findUnique({ where: { id: c.jobId }, select: { quoteId: true } })
      await moveCardTo(accountId, c.cardId, c.to, { quoteId: j?.quoteId ?? null, jobId: c.jobId })
    }
  } catch (e) { console.error('[card follows job]', e) }
}

/** Move one pipeline card to a stage (version checked, retried), with the job's quote and id on it. True when moved. */
export async function moveCardTo(accountId: string, cardId: string, stage: string, stamp: { quoteId?: string | null; jobId?: string | null } = {}): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await prisma.pipelineState.findUnique({ where: { accountId } })
    if (!state) return false
    const leads = (state.leads as Json[]) ?? []
    const card = leads.find(l => l?.id === cardId)
    if (!card) return false
    if (card.stage === stage) return false
    const lead = { ...card, stage, lastMoved: floridaDay(new Date()), ...(stamp.quoteId && !card.quoteId ? { quoteId: stamp.quoteId } : {}), ...(stamp.jobId && !card.jobId ? { jobId: stamp.jobId } : {}) }
    const next = applyPipelineDelta({ leads, stages: (state.stages as Json[]) ?? [] }, { upsert: [{ lead }], remove: [] })
    const done = await prisma.$transaction(async tx => {
      const d = await tx.pipelineState.updateMany({ where: { accountId, version: state.version }, data: { leads: JSON.parse(JSON.stringify(next.leads)), version: { increment: 1 } } })
      if (d.count === 1) await recordCardMoves(accountId, leads, next.leads, state.version + 1, tx)
      return d
    })
    if (done.count === 1) return true
  }
  return false
}

/**
 * Did the install happen? The job was In Progress, the crew tapped Finish, or
 * its last crew day (the Schedule's entries, else its end or start date) is
 * today or past.
 */
export async function installHappened(accountId: string, job: { id: string; status: string; scheduledDate: string; scheduledEndDate: string | null }, today = floridaDay(new Date())): Promise<boolean> {
  if (job.status === 'in_progress') return true
  const { installTimes } = await import('./crewInstall.js')
  if ((await installTimes(job.id)).some(t => t.kind === 'finish')) return true
  const days = (await prisma.scheduledGridJob.findMany({ where: { accountId, deletedAt: null, stagingJobId: job.id }, select: { date: true } })).map(d => d.date).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort()
  const last = days[days.length - 1] ?? (/^\d{4}-\d{2}-\d{2}$/.test(job.scheduledEndDate || '') ? job.scheduledEndDate! : /^\d{4}-\d{2}-\d{2}$/.test(job.scheduledDate || '') ? job.scheduledDate : null)
  return !!last && last <= today
}

/** Signed off and paid in full but not installed by the records: the owner is asked to mark it installed. */
export async function closeOutPrompt(accountId: string, job: { id: string; status: string; scheduledDate: string; scheduledEndDate: string | null }): Promise<'mark_installed' | null> {
  if (isDonePhase(job.status) || job.status === 'on_hold') return null
  const w = await prisma.walkthrough.findUnique({ where: { jobId: job.id }, select: { accountId: true, homeownerSig: true, repSig: true } })
  if (!w || w.accountId !== accountId || !w.homeownerSig || !w.repSig) return null
  if (!billingStatusOf(await billingViewFor(accountId, job.id)).paidInFull) return null
  return (await installHappened(accountId, job)) ? null : 'mark_installed'
}

export type CloseOut = { moved: true; stage: string } | { moved: false; why: string }

/**
 * A job whose final walkthrough is signed (homeowner and us) and that is paid
 * in full moves to the Complete stage, once, by itself; its pipeline card
 * goes to Job complete. A job already done, on hold, or missing either is left
 * where it is. Never throws (a payment or a signature is never stopped by it).
 */
export async function closeOutIfDone(accountId: string, jobId: string, why: string): Promise<CloseOut> {
  try {
    const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null, archivedAt: null } })
    if (!job) return { moved: false, why: 'no job' }
    if (isDonePhase(job.status)) return { moved: false, why: 'already done' }
    if (job.status === 'on_hold') return { moved: false, why: 'on hold' }
    const w = await prisma.walkthrough.findUnique({ where: { jobId }, select: { accountId: true, homeownerSig: true, repSig: true } })
    if (!w || w.accountId !== accountId || !w.homeownerSig || !w.repSig) return { moved: false, why: 'walkthrough not signed' }
    const status = billingStatusOf(await billingViewFor(accountId, jobId))
    if (!status.paidInFull) return { moved: false, why: 'not paid in full' }
    // Only a job that was really installed (Oct 25 2026: a job never scheduled closed out on a signature and a
    // payment). Not installed: the job page asks the owner "Paid and signed off: mark installed?".
    if (!(await installHappened(accountId, job))) return { moved: false, why: 'not installed' }
    const { stages } = await loadOpsStages(accountId)
    const done = completeStage(stages)
    if (!done) return { moved: false, why: 'no Complete stage' }
    const fields = fieldsForStage(stages, done.id, job as Json, floridaDay(new Date()))
    if (!fields) return { moved: false, why: 'no Complete stage' }
    const updated = await prisma.$transaction(async tx => {
      // Only while it is still not done: two of these at once move it once.
      const n = await tx.savedJob.updateMany({ where: { id: jobId, status: { notIn: ['completed', 'invoiced', 'paid'] } }, data: { ...(fields as Json), completedBy: 'Automatic: walkthrough signed and paid in full' } })
      if (n.count !== 1) return null
      const row = await tx.savedJob.findUnique({ where: { id: jobId } })
      await recordJobChanges(accountId, job, row, tx)
      return row
    })
    if (!updated) return { moved: false, why: 'already done' }
    await auditSystem('update', 'SavedJob', jobId, { oldValues: { status: job.status, opsStage: job.opsStage }, newValues: { status: updated.status, opsStage: updated.opsStage, completedDate: updated.completedDate, why: `Closed out by itself: ${why}` } })
    // The Final's due date is the install date (lib/contractBilling.ts afterJobSaved).
    const { afterJobSaved } = await import('./contractBilling.js')
    await afterJobSaved(accountId, jobId, { userId: null, name: 'Close out' })
    // The card follows: Job Complete, or the last Sold, work done stage (Paid & Closed) when paid in full.
    await cardFollowsJob(accountId, jobId)
    return { moved: true, stage: stageById(stages, stageOfJob(stages, updated as Json))?.name ?? done.name }
  } catch (e) {
    console.error('[close out]', e)
    return { moved: false, why: 'error' }
  }
}
