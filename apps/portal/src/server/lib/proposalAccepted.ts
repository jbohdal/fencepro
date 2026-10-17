/**
 * When a customer accepts a proposal: a notification in the app, and the
 * customer's pipeline card moved to Signed Contract (a new card when they
 * have none). The pipeline is saved card by card with a version check, so
 * this is a normal versioned change; an open browser merges it on its next
 * save.
 */

import prisma from './prisma.js'
import { applyPipelineDelta } from './pipelineDelta.js'

const STAGE = 'Signed Contract'
const CLOSED = new Set(['Lost Sale', 'No Answer', 'Paid & Closed'])

export async function onProposalAccepted(q: { id: string; accountId: string; crmContactId: string | null; customerName: string; customerPhone: string; customerEmail: string; customerAddress: string; leadSource: string; salesRep: string }, chosen: { label: string; fenceStyle: string; finalPrice: number; sections: number }, acceptedBy: string): Promise<void> {
  const price = '$' + Math.round(chosen.finalPrice).toLocaleString('en-US')
  await prisma.notification.create({
    data: {
      title: `Proposal accepted: ${q.customerName || acceptedBy}`,
      body: `${acceptedBy} accepted ${chosen.label} at ${price}. The pipeline card is in ${STAGE}.`,
      type: 'success',
      link: q.crmContactId ? `/?customer=${q.crmContactId}` : null,
    },
  }).catch(err => console.error('[proposal] notification failed:', err))

  // Move or add the card; try again if a browser saved in between.
  for (let attempt = 0; attempt < 4; attempt++) {
    const state = await prisma.pipelineState.findUnique({ where: { accountId: q.accountId } })
    if (!state) return
    const leads = (state.leads as any[]) ?? []
    const today = new Date().toISOString().slice(0, 10)
    const mine = leads.filter(l => q.crmContactId && l?.customerId === q.crmContactId)
    const card = mine.find(l => !CLOSED.has(l.stage)) ?? mine[0]
    let lead: any
    if (card) {
      lead = { ...card, stage: STAGE, lastMoved: today, jobValue: chosen.finalPrice, quotePrice: chosen.finalPrice, fenceType: chosen.fenceStyle, sections: chosen.sections }
    } else {
      const [firstName, ...rest] = (q.customerName || acceptedBy).trim().split(/\s+/)
      lead = {
        id: `lead-${q.id}`, firstName: firstName || '', lastName: rest.join(' '), phone: q.customerPhone, email: q.customerEmail,
        address: q.customerAddress, customerId: q.crmContactId ?? undefined, stage: STAGE, leadSource: q.leadSource || '',
        assignedRep: q.salesRep || '', jobValue: chosen.finalPrice, quotePrice: chosen.finalPrice, fenceType: chosen.fenceStyle,
        sections: chosen.sections, leadTemp: 0, notes: 'Accepted the proposal online.', createdAt: today, lastMoved: today,
      }
    }
    const next = applyPipelineDelta({ leads, stages: (state.stages as any[]) ?? [] }, { upsert: [{ lead }], remove: [] })
    const done = await prisma.pipelineState.updateMany({
      where: { accountId: q.accountId, version: state.version },
      data: { leads: JSON.parse(JSON.stringify(next.leads)), version: { increment: 1 } },
    })
    if (done.count === 1) return
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
}): Promise<string | null> {
  const existing = await prisma.savedJob.findFirst({ where: { accountId: q.accountId, quoteId: q.id, archivedAt: null }, select: { id: true } })
  if (existing) return existing.id
  const runs = Array.isArray(q.runs) ? (q.runs as unknown[]).map(Number).filter(n => Number.isFinite(n)) : []
  const job = await prisma.savedJob.create({
    data: {
      accountId: q.accountId, quoteId: q.id, crmContactId: q.crmContactId, status: 'staging',
      customerName: q.customerName, customerPhone: q.customerPhone, customerEmail: q.customerEmail, customerAddress: q.customerAddress,
      fenceStyle: q.fenceStyle, sections: q.sections, totalFeet: Math.round(runs.reduce((s, n) => s + n, 0)),
      walkGates: q.walkGates, dblGates: q.dblGates, tearOutSections: q.tearOutSections, hasSalesman: q.hasSalesman,
      quotePrice: q.finalPrice, contractValue: q.finalPrice, gmPct: q.gmPct,
      estimatedDays: Math.max(1, Math.ceil(q.sections / 15)),
      notes: q.notes || '', salesRep: q.salesRep || '', leadSource: q.leadSource || '',
    },
  })
  console.log(`[proposal] job ${job.id} created for accepted quote ${q.id}`)
  return job.id
}
