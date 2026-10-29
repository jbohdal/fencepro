/**
 * When a customer accepts a proposal: a notification in the app, and the
 * customer's pipeline card moved to the Signed stage (Settings > Pipeline
 * Stages; a new card when they have none), with the quote's id on it so the
 * job's completion later moves exactly this card. The pipeline is saved card by card with a version check, so
 * this is a normal versioned change; an open browser merges it on its next
 * save.
 */

import prisma from './prisma.js'
import { isUniqueViolation } from './once.js'
import { ensureJobChecklist } from './seeds.js'
import { applyPipelineDelta } from './pipelineDelta.js'
import { recordCardMoves, recordProposalAccepted, wakeJobWaiters } from './automations/hooks.js'
import { loadOpsStages } from './opsStages.js'
import { firstStage } from './opsStageModel.js'
import { loadPipelineStages } from './pipelineStages.js'
import { roleStageId, stageNameOf, isFinishedStage } from './pipelineStageModel.js'
import { nyDay } from './warranties.js'
import { customerFenceName, railsOf } from './customerFenceName.js'
import { shownJobPriceOf } from './contractBilling.js'
import { customerDollarsFrom } from './customerDollars.js'

export async function onProposalAccepted(q: { id: string; accountId: string; crmContactId: string | null; customerName: string; customerPhone: string; customerEmail: string; customerAddress: string; leadSource: string; salesRep: string }, chosen: { label: string; fenceStyle: string; finalPrice: number; sections: number }, acceptedBy: string): Promise<void> {
  const price = '$' + Math.round(chosen.finalPrice).toLocaleString('en-US')
  const { stages } = await loadPipelineStages(q.accountId)
  const STAGE = roleStageId(stages, 'signed') ?? ''
  await prisma.notification.create({
    data: {
      title: `Proposal accepted: ${q.customerName || acceptedBy}`,
      // The fence as the customer accepted it: a best price option names its panels, never "(best price)".
      body: `${acceptedBy} accepted ${customerFenceName(chosen.label, railsOf(chosen as any, (q as any).runRails))} at ${price}. The pipeline card is in ${stageNameOf(stages, STAGE)}.`,
      type: 'success',
      link: q.crmContactId ? `/?customer=${q.crmContactId}` : null,
    },
  }).catch(err => console.error('[proposal] notification failed:', err))

  // Move or add the card; try again if a browser saved in between.
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await prisma.pipelineState.findUnique({ where: { accountId: q.accountId } })
    if (!state) return
    const leads = (state.leads as any[]) ?? []
    const today = nyDay(new Date())
    const mine = leads.filter(l => q.crmContactId && l?.customerId === q.crmContactId)
    const card = mine.find(l => !isFinishedStage(stages, l.stage)) ?? mine[0]
    let lead: any
    if (card) {
      lead = { ...card, stage: STAGE, quoteId: q.id, lastMoved: today, jobValue: chosen.finalPrice, quotePrice: chosen.finalPrice, fenceType: chosen.fenceStyle, sections: chosen.sections }
    } else {
      const [firstName, ...rest] = (q.customerName || acceptedBy).trim().split(/\s+/)
      lead = {
        id: `lead-${q.id}`, firstName: firstName || '', lastName: rest.join(' '), phone: q.customerPhone, email: q.customerEmail,
        address: q.customerAddress, customerId: q.crmContactId ?? undefined, stage: STAGE, quoteId: q.id, leadSource: q.leadSource || '',
        assignedRep: q.salesRep || '', jobValue: chosen.finalPrice, quotePrice: chosen.finalPrice, fenceType: chosen.fenceStyle,
        sections: chosen.sections, leadTemp: 0, notes: 'Accepted the proposal online.', createdAt: today, lastMoved: today,
      }
    }
    const next = applyPipelineDelta({ leads, stages: (state.stages as any[]) ?? [] }, { upsert: [{ lead }], remove: [] })
    // The card's move is saved for automations in the same step.
    const done = await prisma.$transaction(async tx => {
      const d = await tx.pipelineState.updateMany({
        where: { accountId: q.accountId, version: state.version },
        data: { leads: JSON.parse(JSON.stringify(next.leads)), version: { increment: 1 } },
      })
      if (d.count === 1) await recordCardMoves(q.accountId, leads, next.leads, state.version + 1, tx)
      return d
    })
    if (done.count === 1) { await recordProposalAccepted(q.accountId, q, null, lead.id); return }
  }
  console.error(`[proposal] could not move the pipeline card for quote ${q.id}`)
}

/**
 * The job for a quote a customer accepted online, so it shows in Operations
 * like one sold in person. Once only: a quote that already has a job keeps it.
 */
export async function ensureJobForAcceptedQuote(q: {
  id: string; accountId: string; crmContactId: string | null; customerName: string; customerPhone: string; customerEmail: string; customerAddress: string
  fenceStyle: string; sections: number; runs: unknown; walkGates: number; dblGates: number; tearOutSections: number; hasSalesman: boolean
  finalPrice: number; gmPct: number; notes: string; salesRep: string; leadSource: string
  status: string; acceptedAt: Date | null; soldAt: Date | null; proposal: unknown; pricing?: unknown; chosenOption: number | null
}): Promise<string | null> {
  const existing = await prisma.savedJob.findFirst({ where: { accountId: q.accountId, quoteId: q.id, deletedAt: null, archivedAt: null }, select: { id: true } })
  if (existing) return existing.id
  // The job's price: signed from Oct 29 2026 on, the whole dollar the customer saw and is billed (D1, the payment
  // schedule's own function); signed before, the quote's price to the cent, as it always was.
  const price = shownJobPriceOf(q, await customerDollarsFrom(q.accountId)) ?? q.finalPrice
  const runs = Array.isArray(q.runs) ? (q.runs as unknown[]).map(Number).filter(n => Number.isFinite(n)) : []
  // The same job (same customer, sold within 60 days, price within 10%): the
  // customer accepted another proposal for the same fence. One job, now
  // following the quote accepted last, with a note of the change.
  if (q.crmContactId) {
    const since = new Date(Date.now() - 60 * 86_400_000)
    const open = await prisma.savedJob.findMany({
      where: { accountId: q.accountId, crmContactId: q.crmContactId, deletedAt: null, archivedAt: null, createdAt: { gte: since }, status: { notIn: ['completed', 'invoiced', 'paid'] } },
      orderBy: { createdAt: 'desc' },
    })
    const same = open.find(j => j.contractValue > 0 && Math.abs(j.contractValue - q.finalPrice) <= 0.1 * Math.max(j.contractValue, q.finalPrice))
    if (same) {
      const day = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' })
      await prisma.savedJob.update({
        where: { id: same.id },
        data: {
          quoteId: q.id, fenceStyle: q.fenceStyle, sections: q.sections, totalFeet: Math.round(runs.reduce((t, n) => t + n, 0)),
          walkGates: q.walkGates, dblGates: q.dblGates, tearOutSections: q.tearOutSections,
          quotePrice: price, contractValue: price, gmPct: q.gmPct,
          notes: `${same.notes ? same.notes + '\n' : ''}${day}: the customer accepted another proposal for this job (${q.fenceStyle}, $${Math.round(price).toLocaleString('en-US')}); the job follows it now. It was ${same.fenceStyle}, $${Math.round(same.contractValue).toLocaleString('en-US')}.`,
        },
      })
      console.log(`[proposal] quote ${q.id} accepted for the same job as ${same.id}; job follows it now`)
      return same.id
    }
  }
  // A fixed id per accepted quote: the same acceptance handled twice at once makes one job.
  const jobId = `accepted-${q.id}`
  // It lands in the stage marked first in Settings > Operations Stages.
  const opsStage = firstStage((await loadOpsStages(q.accountId)).stages)?.id ?? ''
  let job: { id: string }
  try {
    job = await prisma.savedJob.create({
    data: {
      id: jobId, accountId: q.accountId, quoteId: q.id, crmContactId: q.crmContactId, status: 'staging', opsStage,
      customerName: q.customerName, customerPhone: q.customerPhone, customerEmail: q.customerEmail, customerAddress: q.customerAddress,
      fenceStyle: q.fenceStyle, sections: q.sections, totalFeet: Math.round(runs.reduce((s, n) => s + n, 0)),
      walkGates: q.walkGates, dblGates: q.dblGates, tearOutSections: q.tearOutSections, hasSalesman: q.hasSalesman,
      quotePrice: price, contractValue: price, gmPct: q.gmPct,
      estimatedDays: Math.max(1, Math.ceil(q.sections / 15)),
      notes: q.notes || '', salesRep: q.salesRep || '', leadSource: q.leadSource || '',
    },
    })
  } catch (err) {
    if (!isUniqueViolation(err)) throw err
    return jobId
  }
  await ensureJobChecklist(q.accountId, job.id).catch(err => console.error('[proposal] checklist:', err))
  // A "Signed Contract" automation that reached the card first and waits for its job runs now (lib/automations/hooks.ts).
  await wakeJobWaiters(q.accountId).catch(err => console.error('[proposal] wake automations:', err))
  console.log(`[proposal] job ${job.id} created for accepted quote ${q.id}`)
  return job.id
}
