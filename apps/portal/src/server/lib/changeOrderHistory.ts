/**
 * Change orders in the customer's history (the pipeline card window,
 * lib/followUps.ts customerHistory) and the job's timeline (the job page,
 * GET /api/change-orders/timeline): made, sent, approved verbally, signed by
 * the customer, approved ("Change order CO-1 approved: +$450 (added 12 ft and
 * a walk gate), by Jonathan, Oct 22"), voided; on the job also the contract
 * as signed (rev 1), the payment schedule lines that followed, the pull sheet
 * revisions, the stage moves and materials changes (lib/jobMoveHistory.ts)
 * and the schedule warning. Prices only, never a cost.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { approvedText, signedUsd, whatChanged, currentWorkRow } from './changeOrderWork.js'
import { scheduleFit } from './changeOrderWork.js'
import { moneyText } from './paymentMath.js'
import { AUTO_MOVE_KIND } from './waitingStageMove.js'
import { moveHistoryItems } from './jobMoveHistory.js'
import { loadOpsStages } from './opsStages.js'

export interface TimelineItem { at: string; kind: string; title: string; detail: string; by: string }

const VIA: Record<string, string> = { portal: 'in the customer portal', link: 'on their link', in_person: 'in person' }

async function labelsOf(accountId: string): Promise<(code: string) => string> {
  try {
    const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const labels = (await pricingModule()).styleLabels(b?.config ?? null)
    return (c: string) => labels[c] || c
  } catch { return (c: string) => c }
}

/** The change order lines of the history, for the quotes `quoteIds`. */
export async function changeOrderItems(accountId: string, quoteIds: string[]): Promise<TimelineItem[]> {
  if (!quoteIds.length) return []
  const rows = await prisma.changeOrder.findMany({ where: { accountId, quoteId: { in: quoteIds }, deletedAt: null }, orderBy: [{ number: 'asc' }] })
  if (!rows.length) return []
  const style = await labelsOf(accountId)
  const items: TimelineItem[] = []
  for (const r of rows) {
    const what = whatChanged(r, style)
    const rev = r.contractRev ? `Contract rev ${r.contractRev}, ` : ''
    items.push({ at: r.createdAt.toISOString(), kind: 'change_order', title: `Change order CO-${r.number} made: ${signedUsd(r.totalCents)} (${what})`, detail: r.reason || '', by: r.createdBy ?? '' })
    if (r.sentAt) items.push({ at: r.sentAt.toISOString(), kind: 'change_order', title: `Change order CO-${r.number} sent to the customer to sign`, detail: '', by: '' })
    if (r.verbalAt) items.push({ at: r.verbalAt.toISOString(), kind: 'change_order', title: `Change order CO-${r.number} approved verbally`, detail: `${r.verbalReason ?? ''}${r.signedAt ? '' : ' Not signed by the customer yet.'}`.trim(), by: r.verbalBy ?? '' })
    if (r.signedAt) items.push({ at: r.signedAt.toISOString(), kind: 'change_order', title: `Change order CO-${r.number} signed by ${r.signedBy ?? 'the customer'}${r.signedVia ? ` ${VIA[r.signedVia] ?? ''}` : ''}`.trim(), detail: '', by: '' })
    if (r.approvedAt && (r.status === 'approved' || r.voidedAt)) items.push({ at: r.approvedAt.toISOString(), kind: 'change_order', title: approvedText(r, style), detail: `${rev}change order CO-${r.number}.${r.warrantyAfter ? ` Warranty now ${(r.warrantyAfter as any).name}.` : ''}`, by: r.verbalBy ?? r.approvedBy ?? '' })
    if (r.voidedAt) items.push({ at: r.voidedAt.toISOString(), kind: 'change_order', title: `Change order CO-${r.number} voided${r.approvedAt ? ': taken off the contract' : ''}`, detail: '', by: '' })
  }
  return items
}

/** The job's timeline, newest first: contract signed, change orders, payment schedule lines, pull sheet revisions, stage moves, materials. */
export async function jobTimeline(accountId: string, jobId: string): Promise<{ items: TimelineItem[]; scheduleWarning: string | null; contractRev: number } | null> {
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null }, select: { id: true, quoteId: true, quotePrice: true, createdAt: true } })
  if (!job) return null
  const items: TimelineItem[] = []
  let contractRev = 1
  if (job.quoteId) {
    const q = await prisma.savedQuote.findFirst({ where: { id: job.quoteId, accountId }, select: { acceptedAt: true, acceptedBy: true, soldAt: true, finalPrice: true } })
    const at = q?.acceptedAt ?? q?.soldAt
    if (at) items.push({ at: at.toISOString(), kind: 'contract', title: `Contract rev 1 signed: ${moneyText(Math.round((q!.finalPrice || job.quotePrice) * 100))}`, detail: q?.acceptedBy ? `Accepted online by ${q.acceptedBy}.` : 'Marked sold.', by: '' })
    items.push(...await changeOrderItems(accountId, [job.quoteId]))
    const rows = await prisma.changeOrder.findMany({ where: { accountId, quoteId: job.quoteId, deletedAt: null }, select: { id: true, number: true, status: true, approvedAt: true, work: true, contractRev: true, deletedAt: true } })
    contractRev = Math.max(1, ...rows.filter(r => r.status === 'approved').map(r => r.contractRev ?? 1))
    for (const r of rows) {
      if (r.status === 'approved' && r.work && r.approvedAt) items.push({ at: new Date(r.approvedAt.getTime() + 1).toISOString(), kind: 'pull_sheet', title: `Pull sheet rev ${r.contractRev ?? ''} for the crew (change order CO-${r.number})`.replace('rev  ', 'rev '), detail: currentWorkRow(rows)?.id === r.id ? 'The current pull sheet; the earlier ones are kept in the Pullsheets tab.' : 'Replaced by a later change.', by: '' })
    }
  }
  const logs = await prisma.billingLog.findMany({ where: { accountId, jobId, kind: { in: ['final_follows', 'change_order_invoice', 'change_order_invoice_void', 'made'] } }, orderBy: { at: 'desc' }, take: 50 })
  for (const l of logs) items.push({ at: l.at.toISOString(), kind: 'billing', title: l.text, detail: '', by: l.byName })
  // Board moves and materials changes, by whom or by itself with the reason (lib/jobMoveHistory.ts, audit #47). A move the
  // job made by itself also left a note ("Moved to Permit Pending by itself: …"; lib/waitingStageMove.ts): one line, its reason.
  const notes = (await prisma.activityLog.findMany({ where: { entityType: 'job', entityId: jobId, metadata: { path: ['kind'], equals: AUTO_MOVE_KIND } }, orderBy: { createdAt: 'desc' }, take: 50 }))
    .map(m => ({ createdAt: m.createdAt, body: m.body, to: typeof (m.metadata as any)?.to === 'string' ? (m.metadata as any).to : null }))
  const audits = await prisma.crmAuditLog.findMany({ where: { entityType: 'SavedJob', entityId: jobId, action: { in: ['create', 'update'] } }, orderBy: { createdAt: 'desc' }, take: 300, select: { createdAt: true, userId: true, userEmail: true, action: true, oldValues: true, newValues: true } })
  // Names for the people: who saved, and who a move by itself names ("Sales Order, jane@…").
  const emails = new Set<string>()
  for (const a of audits) {
    if (a.userEmail && a.userEmail !== 'system') emails.add(a.userEmail)
    const e = String((a.newValues as any)?.by ?? '').match(/[^\s,]+@[^\s,]+/)?.[0]
    if (e) emails.add(e)
  }
  // Billing lines and change orders that kept who by email ("aud-office@…") get the name too (review, Oct 28 2026).
  for (const it of items) if (it.by.includes('@')) emails.add(it.by)
  const ids = audits.map(a => a.userId).filter((x): x is string => !!x)
  const users = await prisma.crmUser.findMany({ where: { OR: [{ id: { in: ids } }, { email: { in: [...emails] } }] }, select: { id: true, email: true, firstName: true, lastName: true } })
  const fullName = (u: { firstName: string; lastName: string } | undefined) => (u ? `${u.firstName} ${u.lastName}`.trim() || null : null)
  const byEmail = (e: string) => fullName(users.find(u => u.email.toLowerCase() === e.toLowerCase()))
  const { stages } = await loadOpsStages(accountId)
  const used = new Set<number>()
  items.push(...moveHistoryItems(stages, audits.map(a => ({ ...a, userName: fullName(users.find(u => u.id === a.userId)) ?? (a.userEmail ? byEmail(a.userEmail) : null) })), notes, byEmail, used))
  notes.forEach((m, i) => { if (!used.has(i)) items.push({ at: m.createdAt.toISOString(), kind: 'stage', title: m.body, detail: '', by: '' }) })
  for (const it of items) if (it.by.includes('@')) it.by = byEmail(it.by) ?? it.by
  return { items: items.sort((a, b) => b.at.localeCompare(a.at)), scheduleWarning: await scheduleFit(accountId, jobId), contractRev }
}
