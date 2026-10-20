/**
 * Where saves become automation events. Each function compares the record
 * before and after one save and records what really happened (a card moved
 * into a stage, a payment came in). Pass the save's transaction so the event
 * is stored exactly when the change is. Every dedupeKey names the happening
 * itself (card, stage and pipeline version; payment id), so a save sent twice
 * is one event.
 */

import { recordEvent } from '../automationEvents.js'
import { loadOpsStages } from '../opsStages.js'
import { stageOfJob } from '../opsStageModel.js'

type Db = Parameters<typeof recordEvent>[1]

const nameOf = (l: any) => `${l?.firstName ?? ''} ${l?.lastName ?? ''}`.trim()

/** Sales pipeline: every card whose stage differs between `before` and `after` (saved as `version`). */
export async function recordCardMoves(accountId: string, before: any[], after: any[], version: number, db?: Db): Promise<number> {
  const was = new Map(before.filter(l => l?.id).map(l => [l.id, l]))
  let n = 0
  for (const l of after) {
    if (!l?.id || !l.stage) continue
    const prev = was.get(l.id)
    if (prev && prev.stage === l.stage) continue
    const data = { stage: l.stage, from: prev?.stage ?? null, to: l.stage, name: nameOf(l), customerId: l.customerId ?? null, version }
    if (prev?.stage) {
      await recordEvent({ accountId, type: 'card_left', board: 'sales', entityKind: 'card', entityId: l.id, data: { ...data, stage: prev.stage }, dedupeKey: `sales:${l.id}:left:${prev.stage}:v${version}` }, db)
      n++
    }
    await recordEvent({ accountId, type: 'card_entered', board: 'sales', entityKind: 'card', entityId: l.id, data, dedupeKey: `sales:${l.id}:entered:${l.stage}:v${version}` }, db)
    n++
  }
  return n
}

/** Operations: a job save that changes the stage it shows in, and a payment marked on the job. */
export async function recordJobChanges(accountId: string, before: any | null, after: any, db?: Db): Promise<void> {
  const at = new Date(after.updatedAt ?? Date.now()).getTime()
  // By stage id (Settings > Operations Stages), so a renamed stage is the same stage.
  const { stages } = await loadOpsStages(accountId, db ?? undefined)
  const to = stageOfJob(stages, after)
  const from = before ? stageOfJob(stages, before) : null
  if (from !== to) {
    const data = { stage: to, from, to, name: after.customerName ?? '', customerId: after.crmContactId ?? null }
    if (from) await recordEvent({ accountId, type: 'card_left', board: 'ops', entityKind: 'job', entityId: after.id, data: { ...data, stage: from }, dedupeKey: `ops:${after.id}:left:${from}:${at}` }, db)
    await recordEvent({ accountId, type: 'card_entered', board: 'ops', entityKind: 'job', entityId: after.id, data, dedupeKey: `ops:${after.id}:entered:${to}:${at}` }, db)
  }
  if (before) {
    const paidMore = Number(after.amountPaid || 0) > Number(before.amountPaid || 0)
    const nowPaid = after.paymentStatus === 'paid' && before.paymentStatus !== 'paid'
    if (paidMore || nowPaid) {
      const amountCents = Math.round((Number(after.amountPaid || 0) - Number(before.amountPaid || 0)) * 100)
      await recordEvent({
        accountId, type: 'payment_received', board: 'ops', entityKind: 'job', entityId: after.id,
        data: { jobId: after.id, customerId: after.crmContactId ?? null, amountCents, paymentStatus: after.paymentStatus, source: 'job' },
        dedupeKey: `payment:job:${after.id}:${Math.round(Number(after.amountPaid || 0) * 100)}:${after.paymentStatus}`,
      }, db)
    }
  }
}

/** Billing: payments recorded in the business record (each has its own id). */
export async function recordNewPayments(accountId: string, before: unknown, after: unknown, invoices: unknown, db?: Db): Promise<void> {
  if (!Array.isArray(after)) return
  const had = new Set(Array.isArray(before) ? (before as any[]).map(p => p?.id) : [])
  for (const p of after as any[]) {
    if (!p?.id || had.has(p.id)) continue
    const inv = (Array.isArray(invoices) ? (invoices as any[]) : []).find(i => i?.id === p.invoiceId)
    const jobId: string | null = inv?.jobId ?? null
    await recordEvent({
      accountId, type: 'payment_received', board: jobId ? 'ops' : 'sales', entityKind: jobId ? 'job' : 'customer', entityId: jobId ?? String(p.customerId ?? p.id),
      data: { jobId, customerId: p.customerId ?? null, invoiceId: p.invoiceId ?? null, amountCents: Number(p.amountCents) || 0, method: p.paymentMethod ?? '', source: 'billing' },
      dedupeKey: `payment:${p.id}`,
    }, db)
  }
}

/** A photo or video finished uploading. */
export async function recordPhotoUploaded(accountId: string, item: { id: string; clientId: string; jobId?: string | null; customerId?: string | null; kind?: string; category?: string }, db?: Db): Promise<void> {
  await recordEvent({
    accountId, type: 'photo_uploaded', board: item.jobId ? 'ops' : 'sales', entityKind: item.jobId ? 'job' : 'customer', entityId: item.jobId ?? item.customerId ?? item.id,
    data: { jobId: item.jobId ?? null, customerId: item.customerId ?? null, mediaId: item.id, kind: item.kind ?? 'photo', category: item.category ?? '' },
    dedupeKey: `photo:${item.clientId}`,
  }, db)
}

/** A customer accepted a proposal online. */
export async function recordProposalAccepted(accountId: string, quote: { id: string; crmContactId: string | null }, jobId: string | null, cardId: string | null): Promise<void> {
  await recordEvent({
    accountId, type: 'proposal_accepted', board: 'sales', entityKind: 'quote', entityId: quote.id,
    data: { quoteId: quote.id, customerId: quote.crmContactId, jobId, cardId },
    dedupeKey: `proposal_accepted:${quote.id}`,
  })
}
