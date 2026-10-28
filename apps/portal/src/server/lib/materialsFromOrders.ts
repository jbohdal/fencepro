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
 * recorded; audit log). Only the materials change: a job's own Operations
 * stage is never moved by this (that waits for Jonathan, FEATURES 9ah).
 *
 * The job of an order: its jobId, else the live job of its quote.
 */

import prisma from './prisma.js'
import { auditSystem } from './auditLog.js'
import { recordJobChanges } from './automations/hooks.js'
import { loadOpsStages } from './opsStages.js'
import { stageOfJob } from './opsStageModel.js'

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
    // The job's own board stage is left alone: moving it on by itself waits for Jonathan (FEATURES 9ah, NEEDS JONATHAN).
    const stageTo = stageOfJob(stages, { ...job, ...data })
    out.push({ jobId, customer: job.customerName || '', from: job.materialsStatus, to: next, stageFrom: was, stageTo })
    if (opts.dryRun) continue
    // Only while it is still behind: a save a moment ago that already moved it on keeps it.
    const behind = Object.keys(RANK).filter(k => RANK[k] < RANK[next]) as MaterialsStatus[]
    const row = await prisma.$transaction(async tx => {
      const d = await tx.savedJob.updateMany({ where: { id: jobId, materialsStatus: { in: behind } }, data })
      if (!d.count) return null
      const r = await tx.savedJob.findUniqueOrThrow({ where: { id: jobId } })
      await recordJobChanges(accountId, job, r, tx)
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
