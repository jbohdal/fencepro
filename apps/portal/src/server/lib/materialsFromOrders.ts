/**
 * The job's materials follow its Sales Order (review Oct 27 2026): the office
 * marked a job's Sales Order (Inventory > Sales Orders) Ordered, its "Order
 * materials for …" task closed by itself, but the job still said "Materials:
 * not ordered", its Materials Confirmed milestone "Not ordered yet" and the
 * Schedule window "Materials not ordered yet". Every one of those reads the
 * job's own materialsStatus, which nothing changed when the order did.
 *
 * The job's materialsStatus stays the one record every screen reads (job page,
 * milestones, Schedule window, Operations, the installer). When a Sales Order
 * is saved as Ordered or Received (business-state PATCH, the one place an
 * order's status is saved), its job's materialsStatus is raised to match:
 *
 *   order ordered    job not_ordered → ordered
 *   order received   job not_ordered or ordered → received
 *
 * Never backward: a job already received or loaded stays as it is, and an
 * order put back to pending or cancelled changes nothing on the job.
 *
 * The job is saved like any other job save (updatedAt moves, so every open
 * browser picks it up on its next read; stage moves and automation events
 * recorded; audit log). Marked Received also moves a job in its own waiting
 * stage on to the stage its records put it in (Ready to Pull once the locate
 * is clear and the permit issued or not needed), forward only, with a line in
 * its history (lib/waitingStageMove.ts; Jonathan, Oct 27 2026); a job still
 * to be drawn goes no further than Need Drawing (audit #50, heldForDrawing). Marked
 * Ordered changes only the materials, except for a job that already has its
 * drawing: it waited in Need Drawing for this order (round 2, Oct 28 2026: a
 * drawn job no longer lands in Materials Ordered before materials are
 * ordered), so it moves on to Materials Ordered (only there, forward only).
 *
 * The job of an order: its jobId, else the live job of its quote.
 */

import prisma from './prisma.js'
import { auditSystem } from './auditLog.js'
import { recordJobChanges } from './automations/hooks.js'
import { loadOpsStages } from './opsStages.js'
import { stageOfJob, waitsOnlyForDrawing } from './opsStageModel.js'
import { moveFactsOf, moveMoreWords, noteAutoMove, noteHeldForDrawing, waitingStageMove } from './waitingStageMove.js'

export type MaterialsStatus = 'not_ordered' | 'ordered' | 'received' | 'loaded'

const RANK: Record<string, number> = { not_ordered: 0, ordered: 1, received: 2, loaded: 3 }

/** What an order's status says about the job's materials, or null (pending, cancelled). */
export function materialsOfOrder(status: unknown): 'ordered' | 'received' | null {
  return status === 'ordered' ? 'ordered' : status === 'received' ? 'received' : null
}

/** The job's materials after an order says `to`: `to` when it is further along, else null (never backward). */
export function raisedMaterials(current: string | null | undefined, to: 'ordered' | 'received' | null): MaterialsStatus | null {
  if (!to) return null
  return RANK[to] > (RANK[current || 'not_ordered'] ?? 0) ? to : null
}

interface OrderLike { id?: unknown; status?: unknown; jobId?: unknown; quoteId?: unknown }

/** Orders in `after` that are Ordered or Received and were not that status in `before` (null `before`: all of them). */
export function ordersNowBought(before: unknown, after: unknown): OrderLike[] {
  const was = new Map<string, unknown>()
  const prev = Array.isArray(before) ? (before as OrderLike[]) : null
  if (prev) for (const o of prev) if (o && typeof o.id === 'string') was.set(o.id, o.status)
  return (Array.isArray(after) ? (after as OrderLike[]) : []).filter(o => {
    if (!o || !materialsOfOrder(o.status)) return false
    if (!prev) return true
    return typeof o.id !== 'string' || was.get(o.id) !== o.status
  })
}

export interface MaterialsChange { jobId: string; customer: string; from: string; to: MaterialsStatus; stageFrom: string; stageTo: string }

/**
 * Raise the materials of the jobs whose orders are now Ordered or Received.
 * `before` null: every Ordered or Received order is looked at (the backfill).
 * dryRun: only say what would change.
 */
export async function materialsFollowOrders(accountId: string, before: unknown, after: unknown, opts: { dryRun?: boolean; by?: string } = {}): Promise<MaterialsChange[]> {
  const bought = ordersNowBought(before, after)
  if (!bought.length) return []
  // The furthest an order says, per job.
  const want = new Map<string, 'ordered' | 'received'>()
  const jobs = new Map<string, any>()
  for (const o of bought) {
    const jobId = typeof o.jobId === 'string' && o.jobId ? o.jobId : null
    const quoteId = typeof o.quoteId === 'string' && o.quoteId ? o.quoteId : null
    let job = jobId ? await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null } }) : null
    if (!job && quoteId) job = await prisma.savedJob.findFirst({ where: { accountId, quoteId, deletedAt: null, archivedAt: null }, orderBy: { createdAt: 'desc' } })
    if (!job) continue
    jobs.set(job.id, job)
    const to = materialsOfOrder(o.status)!
    const had = want.get(job.id)
    if (!had || RANK[to] > RANK[had]) want.set(job.id, to)
  }
  if (!want.size) return []
  const { stages } = await loadOpsStages(accountId)
  const out: MaterialsChange[] = []
  for (const [jobId, to] of want) {
    const job = jobs.get(jobId)
    const next = raisedMaterials(job.materialsStatus, to)
    if (!next) continue
    const data: Record<string, unknown> = { materialsStatus: next }
    const was = stageOfJob(stages, job)
    let stageTo = stageOfJob(stages, { ...job, ...data })
    // Received moves the card on to the stage its records put it in (lib/waitingStageMove.ts); Ordered only records the materials (Jonathan,
    // Oct 27 2026), except that a drawn job moves to Materials Ordered: it waited in Need Drawing only for this (round 2, Oct 28 2026).
    const facts = await moveFactsOf(accountId, job)
    const w = next === 'received' ? await waitingStageMove(accountId, stages, job, { ...job, ...data }, facts)
      : facts.drawing && !facts.repair ? await waitingStageMove(accountId, stages, job, { ...job, ...data }, facts, { to: ['materials_ordered'] })
      : null
    const why = next === 'received' ? 'materials received (Sales Order marked Received)' : 'materials ordered (Sales Order marked Ordered) and the drawing is done'
    if (w) { data.opsStage = w; stageTo = w }
    out.push({ jobId, customer: job.customerName || '', from: job.materialsStatus, to: next, stageFrom: was, stageTo })
    if (opts.dryRun) continue
    // Only while it is still behind: a save a moment ago that already moved it on keeps it.
    const behind = Object.keys(RANK).filter(k => RANK[k] < RANK[next]) as MaterialsStatus[]
    const row = await prisma.$transaction(async tx => {
      const d = await tx.savedJob.updateMany({ where: { id: jobId, materialsStatus: { in: behind } }, data })
      if (!d.count) return null
      const r = await tx.savedJob.findUniqueOrThrow({ where: { id: jobId } })
      await recordJobChanges(accountId, job, r, tx)
      if (w) await noteAutoMove(jobId, stages, w, why, tx, moveMoreWords(w, facts, next))
      // Still to be drawn, its materials now in, it stays in Need Drawing: said once, here (audit #55).
      else if (next === 'received' && waitsOnlyForDrawing(was, next, facts)) await noteHeldForDrawing(jobId, 'Sales Order marked Received', tx)
      return r
    })
    if (!row) { out.pop(); continue }
    await auditSystem('update', 'SavedJob', jobId, {
      oldValues: { materialsStatus: job.materialsStatus, opsStage: job.opsStage },
      newValues: { ...data, by: opts.by ?? 'Sales Order' },
    })
  }
  return out
}

/**
 * The other way round (audit #54, Oct 28 2026): a hand move (Materials
 * Ordered, Ready to Pull: opsStageModel fieldsForStage) records the job's
 * materials Ordered or Received, after the office said yes to "Mark the
 * materials Ordered and move it?". Its Sales Order stayed Pending, so
 * Inventory > Sales Orders offered only Mark Ordered and the job and its order
 * disagreed. Now the job's orders follow, forward only, as Mark Ordered and
 * Mark Received set them (web pendingOrderStore updatePendingOrderStatus):
 *
 *   job ordered    order pending → ordered (orderedAt)
 *   job received   order pending or ordered → received (orderedAt kept or set, receivedAt)
 *
 * A cancelled or received order stays as it is. Only the order's status and
 * dates change: what Mark Received does to stock in the browser (on hand and
 * set aside counts) is not done here; the hand move does not say the parts
 * were counted in. The job's orders: those with its jobId, and those of its
 * quote that name no job (the same link materialsFollowOrders reads).
 */
export function ordersAfterJobMaterials(orders: unknown, job: { id: string; quoteId?: string | null }, to: 'ordered' | 'received', now: string): { orders: unknown[]; changed: string[] } {
  const all = Array.isArray(orders) ? (orders as any[]) : []
  const from = to === 'ordered' ? ['pending'] : ['pending', 'ordered']
  const changed: string[] = []
  const out = all.map(o => {
    if (!o || typeof o !== 'object') return o
    const mine = o.jobId ? o.jobId === job.id : !!job.quoteId && o.quoteId === job.quoteId
    if (!mine || !from.includes(o.status)) return o
    changed.push(String(o.id))
    return { ...o, status: to, updatedAt: now, orderedAt: o.orderedAt || now, ...(to === 'received' ? { receivedAt: now } : {}) }
  })
  return { orders: out, changed }
}

/**
 * Bring the job's Sales Orders up to its materials after a save that raised
 * them by hand (routes/saved-jobs.ts PATCH). Saved version checked, like every
 * write to the business record; it does not run materialsFollowOrders (the
 * job already says so). The ids of the orders changed. Never throws.
 */
export async function ordersFollowJobMaterials(accountId: string, job: { id: string; quoteId?: string | null; customerName?: string | null }, to: string | null | undefined, by: string): Promise<string[]> {
  if (to !== 'ordered' && to !== 'received') return []
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const s = await prisma.businessState.findUnique({ where: { accountId }, select: { pendingOrders: true, version: true } })
      if (!s) return []
      const plan = ordersAfterJobMaterials(s.pendingOrders, job, to, new Date().toISOString())
      if (!plan.changed.length) return []
      const done = await prisma.businessState.updateMany({ where: { accountId, version: s.version }, data: { pendingOrders: plan.orders as any, version: { increment: 1 } } })
      if (done.count === 1) {
        await auditSystem('update', 'BusinessState', accountId, { newValues: { salesOrders: plan.changed, status: to, why: `${job.customerName || 'job'}'s materials marked ${to === 'ordered' ? 'Ordered' : 'Received'} by a stage move`, by } })
        return plan.changed
      }
    }
    console.error(`[orders follow job] ${job.id}: the business record kept changing; its Sales Order was not marked ${to}`)
    return []
  } catch (e) {
    console.error('[orders follow job]:', e)
    return []
  }
}
