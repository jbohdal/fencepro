/**
 * Customer payments: Received, Cleared, Bounced (Jonathan, Nov 6 2026).
 *
 * A payment is Received when it is logged. The owner taps Cleared when the bank
 * shows it, or Bounced (the payment is voided, as today, with the reason
 * "Bounced", and the balance goes back up). Sub pay counts only Cleared: the
 * job is "Ready to pay sub" once the cleared payments cover the contract, and
 * the owner gets a push.
 *
 * Payments recorded before this have no state (null). They count as they always
 * did (as cleared) until the owner OKs a starting status for each
 * (startingStatusPlan: a dry run, then applyStartingStatus with his OK).
 *
 * How the money screens treat them (Jonathan, Nov 6 2026: "Yes to all four:
 * Billing counts received, with a 'not cleared yet' line. The P&L goes by
 * cleared date. The Balance Sheet shows deposits in transit. A job reads Paid
 * only when cleared."): lib/paymentMath.ts isCleared / isNotCleared, web
 * moneyTruth.ts (Billing, P&L, Balance Sheet), lib/jobReadiness.ts
 * billingStatusOf (the job's Paid). Received in full closes the work out
 * (Complete); the Cleared tap that covers the contract moves it on to Paid.
 */

import prisma from './prisma.js'
import { contractParts, voidPayment, paymentStatusOf, fileReceipt, type Actor } from './contractBilling.js'
import { isCleared, clearSums } from './paymentMath.js'
import { floridaDay } from './automations/context.js'

type Json = any
const err = (status: number, message: string) => Object.assign(new Error(message), { status })

export type ClearState = 'received' | 'cleared' | 'bounced'

/** Counted as paid for sub pay: Cleared, or recorded before states were kept (until the owner sets a starting status). */
export const countsCleared = (p: { voidedAt: Date | null; clearState: string | null }) => isCleared(p)

/** The bank shows it: Cleared (the day it showed, today when not given). The job's sub may now be ready to pay. */
export async function markCleared(accountId: string, id: string, by: Actor, clearedOn?: string | null) {
  const p = await prisma.contractPayment.findUnique({ where: { id } })
  if (!p || p.accountId !== accountId) throw err(404, 'Payment not found')
  if (p.voidedAt) throw err(409, p.clearState === 'bounced' ? 'This payment bounced.' : 'This payment was voided.')
  const day = clearedOn && /^\d{4}-\d{2}-\d{2}$/.test(clearedOn) ? clearedOn : floridaDay(new Date())
  if (day > floridaDay(new Date())) throw err(400, 'The day it cleared is after today.')
  if (day < p.paidOn) throw err(400, 'The day it cleared is before the day it was paid.')
  const row = p.clearState === 'cleared' ? p : await prisma.contractPayment.update({ where: { id }, data: { clearState: 'cleared', clearedOn: day, clearedAt: new Date(), clearedBy: by.name } })
  await logBilling(accountId, p.jobId, `Payment of ${money(p.amountCents)} cleared ${day} (marked by ${by.name}).`, by)
  await checkReadyToPaySub(accountId, p.jobId)
  if (p.clearState !== 'cleared') await afterCleared(accountId, p.jobId)
  return row
}

/** Bounced: the payment is voided (the balance goes back up, the receipt says VOID) and kept as bounced. */
export async function markBounced(accountId: string, id: string, by: Actor, note = '') {
  const p = await prisma.contractPayment.findUnique({ where: { id } })
  if (!p || p.accountId !== accountId) throw err(404, 'Payment not found')
  if (p.voidedAt && p.clearState === 'bounced') return p
  if (p.voidedAt) throw err(409, 'This payment was voided.')
  // A check that showed Cleared can still bounce (the bank takes it back): marked here too.
  await voidPayment(accountId, id, `Bounced${note.trim() ? `: ${note.trim()}` : ''}`, by)
  const row = await prisma.contractPayment.update({ where: { id }, data: { clearState: 'bounced', clearedOn: null, clearedAt: null, clearedBy: null } })
  // The sub's pay waits again, and a lien release sent for it is withdrawn.
  await checkReadyToPaySub(accountId, p.jobId)
  // A job closed as Paid by this payment is not paid any more: it goes back to Complete (money owed).
  await reopenPaidJob(accountId, p.jobId, by).catch(e => console.error('[billing] reopen after bounce:', e))
  return row
}

/**
 * A payment cleared (Nov 6 2026: "A job reads Paid only when cleared"): the job's paid figure says Paid once the
 * cleared payments cover the contract, a finished job moves on to Paid with its card (lib/jobTruth.ts
 * closeOutIfDone), and the customer's filed receipts are written again (a check that cleared now reads Paid in full).
 */
async function afterCleared(accountId: string, jobId: string) {
  try {
    const c = await clearedCover(accountId, jobId)
    if (c) {
      const pays = await prisma.contractPayment.findMany({ where: { accountId, jobId, voidedAt: null }, select: { amountCents: true, clearState: true, voidedAt: true } })
      const paid = pays.reduce((t, x) => t + x.amountCents, 0)
      // Straight to the row (no job change event): the payment was received already; only its state moved.
      await prisma.savedJob.updateMany({ where: { id: jobId, accountId }, data: { paymentStatus: paymentStatusOf(paid, clearSums(pays).clearedCents, c.contractCents) } })
    }
    const { closeOutIfDone, cardFollowsJob } = await import('./jobTruth.js')
    await closeOutIfDone(accountId, jobId, 'the final payment cleared')
    await cardFollowsJob(accountId, jobId)
    const receipts = await prisma.receipt.findMany({ where: { accountId, jobId, voidedAt: null, portalFileId: { not: null } }, select: { id: true, snapshot: true } })
    for (const r of receipts.filter(x => (x.snapshot as Json)?.paidInFull)) await fileReceipt(r.id).catch(e => console.error('[billing] refile receipt after cleared:', e))
  } catch (e) { console.error('[billing] after cleared:', e) }
}

async function reopenPaidJob(accountId: string, jobId: string, by: Actor) {
  const c = await clearedCover(accountId, jobId)
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null } })
  if (!job || !c) return
  const pays = await prisma.contractPayment.findMany({ where: { accountId, jobId, voidedAt: null }, select: { amountCents: true } })
  if (pays.reduce((t, x) => t + x.amountCents, 0) >= c.contractCents) return
  const { loadOpsStages } = await import('./opsStages.js')
  const { phaseOf, stageById, firstStageFor, fieldsForStage, stageOfJob } = await import('./opsStageModel.js')
  const { stages } = await loadOpsStages(accountId)
  const now = stageOfJob(stages, job as Json)
  if (phaseOf(stages, now) !== 'paid') return
  const target = stageById(stages, 'completed') ? 'completed' : firstStageFor(stages, 'completed')
  if (!target) return
  const fields = fieldsForStage(stages, target, job as Json, floridaDay(new Date()), { stageOnly: true }) ?? {}
  const { recordJobChanges } = await import('./automations/hooks.js')
  await prisma.$transaction(async tx => {
    const row = await tx.savedJob.update({ where: { id: jobId }, data: { ...fields, opsStage: target, status: 'completed' as Json } })
    await recordJobChanges(accountId, job, row, tx)
  })
  await logBilling(accountId, jobId, `A payment bounced: the job is back to Complete, money owed (by ${by.name}).`, by)
  // Its card leaves Paid & Closed with it (review Nov 6 2026).
  const { cardFollowsJob } = await import('./jobTruth.js')
  await cardFollowsJob(accountId, jobId).catch(e => console.error('[billing] card after bounce:', e))
}

/** The job's contract and what cleared payments cover; null when it has no payment schedule. */
export async function clearedCover(accountId: string, jobId: string): Promise<{ contractCents: number; clearedCents: number; receivedCents: number } | null> {
  const schedule = await prisma.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId } } })
  if (!schedule) return null
  const parts = await contractParts(prisma, accountId, schedule)
  const pays = await prisma.contractPayment.findMany({ where: { accountId, jobId, voidedAt: null } })
  return {
    contractCents: parts.contractCents,
    clearedCents: pays.filter(countsCleared).reduce((t, x) => t + x.amountCents, 0),
    receivedCents: pays.filter(x => x.clearState === 'received').reduce((t, x) => t + x.amountCents, 0),
  }
}

/** The customer's final payment cleared: the sub is ready to be paid (once), and the owner gets a push. */
export async function checkReadyToPaySub(accountId: string, jobId: string): Promise<boolean> {
  const sj = await prisma.subJob.findFirst({ where: { accountId, jobId }, include: { sub: { select: { businessName: true } } } })
  if (!sj || sj.paidAt) return false
  const c = await clearedCover(accountId, jobId)
  // Installed and confirmed by the owner, and the final payment cleared: never before the work is done.
  const ready = !!sj.confirmedAt && !!c && c.contractCents > 0 && c.clearedCents >= c.contractCents
  if (ready && !sj.readyToPayAt) {
    await prisma.subJob.update({ where: { id: sj.id }, data: { readyToPayAt: new Date() } })
    const job = await prisma.savedJob.findUnique({ where: { id: jobId }, select: { customerName: true } })
    const { sendPush } = await import('./automations/push.js')
    await sendPush(accountId, { title: `Ready to pay sub: ${sj.sub.businessName}`, body: `${job?.customerName ?? 'The job'}'s final payment cleared. Their pay: ${money(netPay(sj as Json))}.`, url: `/operations?job=${jobId}`, tag: `sub-ready-${jobId}` }).catch(() => null)
  }
  if (!ready && sj.readyToPayAt) {
    await prisma.subJob.update({ where: { id: sj.id }, data: { readyToPayAt: null } })
    // Not ready any more (a bounce): a lien release sent and not yet paid against is withdrawn.
    await prisma.subSignRequest.updateMany({ where: { accountId, jobId, kind: 'lien_release', voidedAt: null }, data: { voidedAt: new Date() } })
  }
  return ready
}

/** The sub's pay for the job, less backcharges and advances. */
export function netPay(sj: { payCents: number; deductions?: unknown }): number {
  const d = Array.isArray(sj.deductions) ? sj.deductions as Json[] : []
  return sj.payCents - d.reduce((t, x) => t + (Number(x?.cents) || 0), 0)
}

// ── The starting status of payments recorded before states were kept (owner's OK first) ──

export interface StartingRow { id: string; jobId: string; customerName: string; amountCents: number; method: string; checkNumber: string | null; paidOn: string; propose: ClearState; why: string }

/**
 * A dry run: each payment recorded before Nov 6 2026 with the state it would get. Cash, card and Zelle are cleared
 * when taken; a check paid 10 or more days ago is proposed Cleared (a bounce comes back within days); a newer check
 * stays Received for the owner to tap. Nothing is changed.
 */
export async function startingStatusPlan(accountId: string, today = floridaDay(new Date())): Promise<StartingRow[]> {
  const rows = await prisma.contractPayment.findMany({ where: { accountId, clearState: null, voidedAt: null }, orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }] })
  // all rows: a payment on a job deleted since still shows whose it was.
  const jobs = rows.length ? await prisma.savedJob.findMany({ where: { id: { in: rows.map(r => r.jobId) } }, select: { id: true, customerName: true } }) : []
  const daysAgo = (d: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000)
  return rows.map(r => {
    const instant = ['cash', 'card', 'zelle'].includes(r.method)
    const old = daysAgo(r.paidOn) >= 10
    return {
      id: r.id, jobId: r.jobId, customerName: jobs.find(j => j.id === r.jobId)?.customerName ?? '', amountCents: r.amountCents, method: r.method, checkNumber: r.checkNumber, paidOn: r.paidOn,
      propose: instant || old ? 'cleared' : 'received',
      why: instant ? `${r.method} is cleared when taken` : old ? `check paid ${daysAgo(r.paidOn)} days ago, no bounce` : `check paid ${daysAgo(r.paidOn)} days ago: tap Cleared when the bank shows it`,
    }
  })
}

/** Apply the starting states (only with the owner's typed OK; the ids from the plan he saw). */
export async function applyStartingStatus(accountId: string, ids: string[], by: Actor): Promise<number> {
  const plan = (await startingStatusPlan(accountId)).filter(r => ids.includes(r.id))
  for (const r of plan) {
    await prisma.contractPayment.update({ where: { id: r.id }, data: r.propose === 'cleared' ? { clearState: 'cleared', clearedOn: r.paidOn, clearedAt: new Date(), clearedBy: `${by.name} (starting status)` } : { clearState: 'received' } })
  }
  return plan.length
}

const money = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

async function logBilling(accountId: string, jobId: string, text: string, by: Actor) {
  await prisma.billingLog.create({ data: { accountId, jobId, kind: 'cleared', byUserId: by.userId, byName: by.name, text } as Json }).catch(() => null)
}
