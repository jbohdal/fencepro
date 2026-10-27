/**
 * Contract billing (Oct 21, 2026): the payment schedule of a sold job, the
 * payments on it and a receipt for every payment. Jonathan took a $4,457.00
 * deposit check in a customer's driveway and had no receipt to hand her; with
 * this, a receipt is on the phone the moment the payment is saved, signal or
 * not.
 *
 *   ensureSchedule     made by the server when a quote is signed (Sold in the
 *                      app, accepted on the customer's link, the signed card),
 *                      never typed: Deposit = contract × the proposal's deposit
 *                      percent (50 when it has none), due at signing; Final =
 *                      contract − deposit − progress, due on completion (its
 *                      date is the install date). No contract defines progress
 *                      invoices today; the shape is there (progress-1 ...).
 *   contract total     the signed amount + approved change orders + the owner's
 *                      adjustments (ContractAdjustment). A signed amount is
 *                      never edited in place. The Final follows the total, and
 *                      every time it moves a BillingLog line says why.
 *   recordPayment      any amount; applied to the oldest open invoice first, the
 *                      rest carried to the next (lib/paymentMath.ts). Over or
 *                      under shows on the balance. Its id is the phone's, so a
 *                      repeat create is the first one. A receipt is made with it,
 *                      numbered in one company sequence: online, the next number;
 *                      with no signal, one of the few set aside for the login
 *                      while it had signal (reserveReceiptNumbers, handed back
 *                      unchanged until used, so the sequence has few gaps).
 *   void / confirm     owner and office. Voiding a payment voids its receipt.
 *                      Confirming a Salesman's payment does not change the receipt.
 *   edit amount        owner or admin: an invoice's amount (the Final is what is
 *                      left of the contract), logged.
 *
 * The receipt PDF (lib/receiptPdf.ts) goes in the customer's Documents
 * (PortalFile, visible in their portal) and opens on its own link
 * /p/r/<token> with no sign in (routes/receiptPublic.ts).
 */

import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import prisma from './prisma.js'
import { isSignedQuote } from './quoteLock.js'
import { approvedTotalCents } from './changeOrders.js'
import { applyPayments, depositOf, finalOf, moneyText, methodText, pricedWholeDollar, DEFAULT_DEPOSIT_PCT, METHODS } from './paymentMath.js'
import { receiptPdf, receiptName, type ReceiptSnapshot } from './receiptPdf.js'
import { effectiveQuoteWarranty, installDateOf } from './warranties.js'
import { plainStyleName } from './estimates.js'

const err = (status: number, message: string, code?: string) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })

const UPLOAD_DIR = () => process.env.UPLOAD_DIR || './uploads'

export interface Actor { userId: string | null; name: string; role?: string | null }

// ── Days ─────────────────────────────────────────────────────────────────────

/** YYYY-MM-DD in Ocala. */
export function ocalaDay(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}
/** "October 21, 2026" */
export function dayWords(day: string): string {
  const d = new Date(`${day}T12:00:00Z`)
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}

// ── The signed amount ────────────────────────────────────────────────────────

type QuoteRow = { id: string; status: string; acceptedAt: Date | null; soldAt: Date | null; finalPrice: number; proposal: unknown; pricing?: unknown; chosenOption: number | null; fenceStyle: string }

/** The amount signed, in cents: accepted on the link, the option's price; signed in person, the quote's (as the contract PDF prints it). */
export function signedCentsOf(q: QuoteRow | null, job: { quotePrice: number; contractValue: number }): number {
  if (q) {
    const p = q.proposal as any
    const opt = q.acceptedAt && p && Array.isArray(p.options) && typeof q.chosenOption === 'number' ? p.options[q.chosenOption] : null
    const price = opt && Number(opt.finalPrice) > 0 ? Number(opt.finalPrice) : q.finalPrice
    if (price > 0) return Math.round(price * 100)
  }
  return Math.round((job.quotePrice || job.contractValue || 0) * 100)
}

/** The deposit percent on the signed proposal (the frozen one), else 50. */
export function depositPctOf(q: { proposal: unknown } | null): number {
  const pct = Number((q?.proposal as any)?.depositPct)
  return pct > 0 && pct <= 100 ? pct : DEFAULT_DEPOSIT_PCT
}

/** Progress invoices a contract defines: none do today. The shape a proposal would carry: progressPayments [{ label, pct }]. */
export function progressOf(q: { proposal: unknown } | null): Array<{ label: string; pct: number }> {
  const list = (q?.proposal as any)?.progressPayments
  if (!Array.isArray(list)) return []
  return list.map((x: any) => ({ label: String(x?.label || 'Progress payment').slice(0, 80), pct: Number(x?.pct) })).filter(x => x.pct > 0 && x.pct < 100)
}

const QUOTE_SELECT = { id: true, status: true, acceptedAt: true, soldAt: true, finalPrice: true, proposal: true, pricing: true, chosenOption: true, fenceStyle: true } as const

async function adjustmentCents(tx: any, accountId: string, jobId: string): Promise<number> {
  const rows = await tx.contractAdjustment.findMany({ where: { accountId, jobId }, select: { amountCents: true } })
  return rows.reduce((s: number, r: { amountCents: number }) => s + r.amountCents, 0)
}

/** The contract total now: signed + approved change orders + adjustments. */
export async function contractParts(tx: any, accountId: string, schedule: { jobId: string; quoteId: string | null; signedCents: number }) {
  const changeOrderCents = schedule.quoteId ? await approvedTotalCents(accountId, schedule.quoteId, tx) : 0
  const adj = await adjustmentCents(tx, accountId, schedule.jobId)
  return { signedCents: schedule.signedCents, changeOrderCents, adjustmentCents: adj, contractCents: schedule.signedCents + changeOrderCents + adj }
}

// ── Making the schedule ─────────────────────────────────────────────────────

/** One transaction per job at a time (payments, edits, the schedule itself). */
async function lockJob(tx: any, jobId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'contract-billing:' + jobId}))`
}

async function log(tx: any, accountId: string, jobId: string, l: { kind: string; text: string; invoiceId?: string | null; paymentId?: string | null; fromCents?: number | null; toCents?: number | null; by: Actor }) {
  await tx.billingLog.create({ data: { accountId, jobId, invoiceId: l.invoiceId ?? null, paymentId: l.paymentId ?? null, kind: l.kind, text: l.text, fromCents: l.fromCents ?? null, toCents: l.toCents ?? null, byName: l.by.name, byUserId: l.by.userId } })
}

export interface HandMade { legacyId: string; legacyNumber: string; label: string; deposit: boolean; amountCents: number; createdAt: Date }

/**
 * The job's schedule, made once (inside `tx`, holding the job's lock).
 * `handMade`: invoices typed in Billing that belong to this job (the
 * one-time adoption, lib/billingAdoption.ts): each keeps its own amount; one
 * labeled a deposit is the Deposit; with any of them there is no automatic
 * deposit, and the Final is what is left.
 */
export async function makeScheduleIn(tx: any, accountId: string, jobId: string, source: string, by: Actor, handMade: HandMade[] = []): Promise<any | null> {
  const have = await tx.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId } } })
  if (have) return have
  const job = await tx.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null } })
  if (!job) return null
  const q: QuoteRow | null = job.quoteId ? await tx.savedQuote.findFirst({ where: { id: job.quoteId, accountId }, select: QUOTE_SELECT }) : null
  const signedCents = signedCentsOf(q, job)
  const depositPct = depositPctOf(q)
  const schedule = await tx.paymentSchedule.create({
    data: { accountId, jobId, quoteId: job.quoteId ?? null, crmContactId: job.crmContactId ?? null, signedCents, depositPct, source, createdBy: by.name },
  })
  const { contractCents } = await contractParts(tx, accountId, schedule)
  const base = { accountId, scheduleId: schedule.id, jobId, quoteId: job.quoteId ?? null, crmContactId: job.crmContactId ?? null, contractCents }
  const others: number[] = []
  if (handMade.length) {
    let n = 0
    for (const h of handMade) {
      const asDeposit = h.deposit && !handMade.slice(0, n).some(x => x.deposit)
      n++
      await tx.contractInvoice.create({
        data: {
          ...base, key: asDeposit ? 'deposit' : `legacy-${h.legacyId}`, kind: asDeposit ? 'deposit' : 'other', label: asDeposit ? 'Deposit' : h.label || 'Invoice',
          sortOrder: asDeposit ? 0 : 50, originalCents: h.amountCents, amountCents: h.amountCents, dueOn: 'signing', dueDate: null,
          legacyId: h.legacyId, legacyNumber: h.legacyNumber, createdAt: h.createdAt,
        },
      })
      others.push(h.amountCents)
    }
  } else {
    // Whole dollars on a contract priced to the whole dollar, as its proposal and contract show it (routes/proposal.ts, lib/contractPdf.ts).
    const deposit = depositOf(signedCents, depositPct, pricedWholeDollar(q))
    await tx.contractInvoice.create({ data: { ...base, key: 'deposit', kind: 'deposit', label: 'Deposit', sortOrder: 0, originalCents: deposit, amountCents: deposit, dueOn: 'signing', dueDate: ocalaDay(q?.acceptedAt ?? q?.soldAt ?? new Date()) } })
    others.push(deposit)
    let i = 0
    for (const p of progressOf(q)) {
      i++
      const cents = Math.round((signedCents * p.pct) / 100)
      await tx.contractInvoice.create({ data: { ...base, key: `progress-${i}`, kind: 'progress', label: p.label, sortOrder: 10 + i, originalCents: cents, amountCents: cents, dueOn: 'date', dueDate: null } })
      others.push(cents)
    }
  }
  const fin = finalOf(contractCents, others)
  await tx.contractInvoice.create({
    data: { ...base, key: 'final', kind: 'final', label: 'Final', sortOrder: 99, originalCents: fin, amountCents: fin, dueOn: 'completion', dueDate: /^\d{4}-\d{2}-\d{2}$/.test(job.completedDate ?? '') ? job.completedDate : null },
  })
  await log(tx, accountId, jobId, {
    kind: 'made', by,
    text: `Payment schedule made from the contract (${moneyText(contractCents)}${handMade.length ? `, around ${handMade.length} invoice${handMade.length === 1 ? '' : 's'} typed in Billing` : `, ${depositPct}% deposit`}).`,
  })
  // The job's payment status follows the schedule from the moment it is made: invoiced (the deposit is due), not "Not invoiced yet".
  await settleIn(tx, accountId, jobId, 'payment schedule made', by)
  return schedule
}

/** The schedule of a job whose quote is signed (or `force`: made by hand from the job page). Null when it cannot be made. */
const SCHEDULES_FROM_KEY = 'billing:schedules-from'
/** When this company's payment schedules began (recorded the first time it is asked, kept for good). */
export async function schedulesFrom(accountId: string): Promise<Date> {
  const have = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: SCHEDULES_FROM_KEY } } })
  if (have) return new Date(String(have.value))
  const at = new Date().toISOString()
  // Two at once: the first one written is kept.
  await prisma.accountKeyValue.create({ data: { accountId, key: SCHEDULES_FROM_KEY, value: at } }).catch(() => {})
  const row = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: SCHEDULES_FROM_KEY } } })
  return new Date(String(row?.value ?? at))
}

export async function ensureSchedule(accountId: string, jobId: string, source: string, by: Actor, opts: { force?: boolean } = {}): Promise<any | null> {
  const have = await prisma.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId } } })
  if (have) return have
  const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId, deletedAt: null }, select: { id: true, quoteId: true, quotePrice: true, contractValue: true } })
  if (!job) return null
  const q = job.quoteId ? await prisma.savedQuote.findFirst({ where: { id: job.quoteId, accountId }, select: { status: true, acceptedAt: true, soldAt: true } }) : null
  if (!opts.force && !isSignedQuote(q)) return null
  // Only sales from the day schedules began are scheduled by themselves. The jobs sold before (the JobNimbus
  // history, most of them paid and complete) would otherwise show their whole contract as due the first time
  // they are saved; they get a schedule only through the backfill, after Jonathan's OK, or the hand-made invoice step.
  if (!opts.force) {
    const soldAt = q?.acceptedAt ?? q?.soldAt ?? null
    if (!soldAt || soldAt.getTime() < (await schedulesFrom(accountId)).getTime()) return null
  }
  if (opts.force && job.quoteId && !isSignedQuote(q)) return null
  if (!job.quoteId && !(job.quotePrice > 0 || job.contractValue > 0)) return null
  return prisma.$transaction(async tx => {
    await lockJob(tx, jobId)
    return makeScheduleIn(tx, accountId, jobId, source, by)
  }, { timeout: 20_000 })
}

/** After a quote is signed: the schedule of its job, when it has one. Never throws (a sale is never stopped by it). */
export async function scheduleAfterSigning(accountId: string, quoteId: string, source: string, by: Actor): Promise<void> {
  try {
    const job = await prisma.savedJob.findFirst({ where: { accountId, quoteId, deletedAt: null }, select: { id: true } })
    if (job) await ensureSchedule(accountId, job.id, source, by)
  } catch (e) { console.error('[billing] payment schedule after signing:', e) }
  // The customer's estimate visits: one that has passed is done, one still to come is pointed out (lib/estimateVisits.ts).
  try {
    const { estimateVisitsAfterSigning } = await import('./estimateVisits.js')
    await estimateVisitsAfterSigning(accountId, quoteId, by.name)
  } catch (e) { console.error('[appointments] estimate visits after signing:', e) }
}

/** After a job is made or saved: its schedule if its quote is signed, and the Final's due date (the install date). Never throws. */
export async function afterJobSaved(accountId: string, jobId: string, by: Actor): Promise<void> {
  try {
    await ensureSchedule(accountId, jobId, 'sold', by)
    const job = await prisma.savedJob.findFirst({ where: { id: jobId, accountId }, select: { completedDate: true } })
    const day = /^\d{4}-\d{2}-\d{2}$/.test(job?.completedDate ?? '') ? job!.completedDate! : null
    // (A plain "not this day" never matches an empty date in SQL, so both cases are spelled out.)
    await prisma.contractInvoice.updateMany({ where: { accountId, jobId, kind: 'final', ...(day ? { OR: [{ dueDate: null }, { dueDate: { not: day } }] } : { dueDate: { not: null } }) }, data: { dueDate: day } })
  } catch (e) { console.error('[billing] after job save:', e) }
}

// ── Keeping the Final and the applications right ────────────────────────────

/** Inside the job's lock: the Final = contract − the other invoices (logged when it moves), every invoice's contract amount, the applications rebuilt. */
export async function settleIn(tx: any, accountId: string, jobId: string, why: string, by: Actor): Promise<void> {
  const schedule = await tx.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId } } })
  if (!schedule) return
  const { contractCents } = await contractParts(tx, accountId, schedule)
  const invoices = await tx.contractInvoice.findMany({ where: { scheduleId: schedule.id } })
  const final = invoices.find((i: any) => i.key === 'final')
  const others = invoices.filter((i: any) => i.key !== 'final' && !i.voidedAt).map((i: any) => i.amountCents)
  const payments = await tx.contractPayment.findMany({ where: { accountId, jobId } })
  if (final) {
    // A paid invoice is never cut below what was paid on it: a credit after it was paid is a credit on the
    // balance (paid over the contract, owed back to the customer), not a smaller paid invoice (Oct 22 2026).
    const before = applyPayments(
      invoices.map((i: any) => ({ id: i.id, amountCents: i.amountCents, sortOrder: i.sortOrder, createdAt: i.createdAt, voided: !!i.voidedAt })),
      payments.map((p: any) => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, createdAt: p.createdAt, voided: !!p.voidedAt })),
    )
    const paidOnFinal = Math.min(final.amountCents, before.paidByInvoice.get(final.id) ?? 0)
    const to = Math.max(finalOf(contractCents, others), paidOnFinal)
    if (to !== final.amountCents) {
      await tx.contractInvoice.update({ where: { id: final.id }, data: { amountCents: to } })
      await log(tx, accountId, jobId, { kind: 'final_follows', invoiceId: final.id, fromCents: final.amountCents, toCents: to, by, text: `Final ${moneyText(final.amountCents)} → ${moneyText(to)}: ${why}` })
      final.amountCents = to
    }
    // Invoices over the contract now (a credit after the Final was paid): a change order invoice not paid yet
    // comes down first (newest first, never below what was paid on it); what is left is a credit on the balance.
    let excess = invoices.filter((i: any) => !i.voidedAt).reduce((s: number, i: any) => s + i.amountCents, 0) - contractCents
    const coInvoices = invoices.filter((i: any) => i.kind === 'change_order' && !i.voidedAt).sort((x: any, y: any) => y.sortOrder - x.sortOrder)
    for (const inv of coInvoices) {
      if (excess <= 0) break
      const cut = Math.min(excess, inv.amountCents - Math.min(inv.amountCents, before.paidByInvoice.get(inv.id) ?? 0))
      if (cut <= 0) continue
      await tx.contractInvoice.update({ where: { id: inv.id }, data: { amountCents: inv.amountCents - cut } })
      await log(tx, accountId, jobId, { kind: 'final_follows', invoiceId: inv.id, fromCents: inv.amountCents, toCents: inv.amountCents - cut, by, text: `${inv.label} ${moneyText(inv.amountCents)} → ${moneyText(inv.amountCents - cut)}: ${why}` })
      inv.amountCents -= cut
      excess -= cut
    }
  }
  await tx.contractInvoice.updateMany({ where: { scheduleId: schedule.id, NOT: { contractCents } }, data: { contractCents } })
  // The applications, rebuilt from the payments as they are now.
  const a = applyPayments(
    invoices.map((i: any) => ({ id: i.id, amountCents: i.amountCents, sortOrder: i.sortOrder, createdAt: i.createdAt, voided: !!i.voidedAt })),
    payments.map((p: any) => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, createdAt: p.createdAt, voided: !!p.voidedAt })),
  )
  await tx.paymentApplication.deleteMany({ where: { accountId, paymentId: { in: payments.map((p: any) => p.id) } } })
  if (a.applications.length) await tx.paymentApplication.createMany({ data: a.applications.map(x => ({ accountId, ...x })) })
  // The job's paid figures, for the boards that read them (dollars there).
  const paid = payments.filter((p: any) => !p.voidedAt).reduce((s: number, p: any) => s + p.amountCents, 0)
  const last = payments.filter((p: any) => !p.voidedAt).sort((x: any, y: any) => y.paidOn.localeCompare(x.paidOn))[0]
  await tx.savedJob.update({
    where: { id: jobId },
    // contractValue: the contract with its change orders and adjustments, as the schedule has it (lib/changeOrders.ts adds the same).
    data: { amountPaid: paid / 100, contractValue: contractCents / 100, paymentStatus: paid <= 0 ? 'invoiced' : paid >= contractCents ? 'paid' : 'partial', ...(last ? { paymentDate: last.paidOn, paymentMethod: last.method } : {}) },
  })
}

/**
 * A change order on the job's quote was approved or voided: the Final follows
 * (lib/changeOrders.ts applyToJob). `changedId`: the change order that moved,
 * billed on its own when the Final is already paid (billChangeOrderIn).
 */
export async function finalFollowsChangeOrders(tx: any, accountId: string, jobId: string, by: Actor = { userId: null, name: 'Change order' }, changedId: string | null = null): Promise<void> {
  // Called outside a transaction (the old change order list): one of its own, so the job's lock holds.
  if (typeof tx.$transaction === 'function') { await tx.$transaction((t: any) => finalFollowsChangeOrders(t, accountId, jobId, by, changedId), { timeout: 20_000 }); return }
  const schedule = await tx.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId } } })
  if (!schedule) return
  await lockJob(tx, jobId)
  if (changedId) await billChangeOrderIn(tx, accountId, jobId, schedule, changedId, by)
  const co = schedule.quoteId ? await approvedTotalCents(accountId, schedule.quoteId, tx) : 0
  await settleIn(tx, accountId, jobId, `approved change orders now ${moneyText(co)}`, by)
}

/**
 * After the Final is paid in full, an approved change order that adds money is
 * an invoice of its own, "Change order CO-n", for its amount (the paid Final
 * stays as it was). Voiding the change order voids that invoice. Before the
 * Final is paid the Final simply follows the contract (settleIn).
 */
export async function billChangeOrderIn(tx: any, accountId: string, jobId: string, schedule: any, changeOrderId: string, by: Actor): Promise<void> {
  const co = await tx.changeOrder.findUnique({ where: { id: changeOrderId } })
  if (!co || co.accountId !== accountId || co.quoteId !== schedule.quoteId) return
  const key = `co-${co.id}`
  const have = await tx.contractInvoice.findUnique({ where: { scheduleId_key: { scheduleId: schedule.id, key } } })
  if (co.status !== 'approved' || co.deletedAt) {
    if (have && !have.voidedAt) {
      await tx.contractInvoice.update({ where: { id: have.id }, data: { voidedAt: new Date() } })
      await log(tx, accountId, jobId, { kind: 'change_order_invoice_void', invoiceId: have.id, fromCents: have.amountCents, toCents: 0, by, text: `${have.label} ${moneyText(have.amountCents)} voided: the change order was voided.` })
    }
    return
  }
  if (have || co.totalCents <= 0) return
  const invoices = await tx.contractInvoice.findMany({ where: { scheduleId: schedule.id } })
  const final = invoices.find((i: any) => i.key === 'final')
  if (!final || final.voidedAt || final.amountCents <= 0) return
  const payments = await tx.contractPayment.findMany({ where: { accountId, jobId } })
  const a = applyPayments(
    invoices.map((i: any) => ({ id: i.id, amountCents: i.amountCents, sortOrder: i.sortOrder, createdAt: i.createdAt, voided: !!i.voidedAt })),
    payments.map((p: any) => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, createdAt: p.createdAt, voided: !!p.voidedAt })),
  )
  if ((a.paidByInvoice.get(final.id) ?? 0) < final.amountCents) return
  const { contractCents } = await contractParts(tx, accountId, schedule)
  const label = `Change order CO-${co.number}`
  const inv = await tx.contractInvoice.create({
    data: {
      accountId, scheduleId: schedule.id, jobId, quoteId: schedule.quoteId, crmContactId: schedule.crmContactId, key, kind: 'change_order', label,
      sortOrder: 100 + co.number, originalCents: co.totalCents, amountCents: co.totalCents, contractCents, dueOn: 'date', dueDate: ocalaDay(),
    },
  })
  await log(tx, accountId, jobId, { kind: 'change_order_invoice', invoiceId: inv.id, fromCents: null, toCents: co.totalCents, by, text: `${label} invoice ${moneyText(co.totalCents)}: the Final was already paid, so the change order is billed on its own.` })
}

// ── Receipt numbers ─────────────────────────────────────────────────────────

/** `count` numbers in a row from the company's sequence. One statement, so two at once never get the same ones. */
async function takeNumbers(tx: any, accountId: string, count: number): Promise<number> {
  const rows = await tx.$queryRaw`
    INSERT INTO "ReceiptCounter" ("accountId", "next") VALUES (${accountId}, ${1001 + count})
    ON CONFLICT ("accountId") DO UPDATE SET "next" = "ReceiptCounter"."next" + ${count}
    RETURNING "next" - ${count} AS first`
  return Number((rows as any[])[0].first)
}

export const RESERVE_SIZE = 5
/** Reserved numbers unused this long are handed back to the same login first on its next top-up (never to anyone else). */
export const STALE_RESERVE_DAYS = 30

/**
 * The receipt numbers set aside for one login, so a receipt made with no
 * signal has its real number (Oct 21, 2026: as few gaps as possible).
 *
 *   - The login's numbers not used yet are handed back as they are, oldest
 *     first (those unused for 30 days or more come first, for this login's
 *     next use only); new numbers are taken from the company sequence only to
 *     fill the set back up to `count` after some were used. So signing in
 *     again, or on another phone, makes no new numbers.
 *   - A reserved number stays this login's: it is never given to anyone else,
 *     and an online receipt takes the next company number, not one of these.
 *   - Two phones of the same login get the same set; if both use the same
 *     number with no signal, the second to reach the server gets the next
 *     company number instead (a number is never on two receipts).
 * Blocks whose numbers are all used are removed.
 */
export async function reserveReceiptNumbers(accountId: string, userId: string, count = RESERVE_SIZE): Promise<{ numbers: number[]; made: number; stale: number }> {
  const n = Math.max(1, Math.min(20, Math.floor(count)))
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'receipt-numbers:' + accountId + ':' + userId}))`
    const blocks = await tx.receiptNumberBlock.findMany({ where: { accountId, userId }, orderBy: { first: 'asc' } })
    const all: Array<{ n: number; at: Date; block: string }> = []
    for (const b of blocks) for (let x = b.first; x <= b.last; x++) all.push({ n: x, at: b.createdAt, block: b.id })
    const used = new Set((await tx.receipt.findMany({ where: { accountId, number: { in: all.map(x => x.n) } }, select: { number: true } })).map(r => r.number))
    const free = all.filter(x => !used.has(x.n))
    const staleBefore = Date.now() - STALE_RESERVE_DAYS * 86_400_000
    const stale = free.filter(x => x.at.getTime() < staleBefore).length
    // Housekeeping: a block with every number used is done.
    const done = blocks.filter(b => !free.some(x => x.block === b.id)).map(b => b.id)
    if (done.length) await tx.receiptNumberBlock.deleteMany({ where: { id: { in: done } } })
    // The oldest `n` (a login holding more, from before, keeps the rest for later: never anyone else's).
    const numbers = free.map(x => x.n).sort((a, b) => a - b).slice(0, n)
    const need = n - numbers.length
    if (need > 0) {
      const first = await takeNumbers(tx, accountId, need)
      await tx.receiptNumberBlock.create({ data: { accountId, userId, first, last: first + need - 1 } })
      for (let i = 0; i < need; i++) numbers.push(first + i)
    }
    return { numbers, made: Math.max(0, need), stale }
  })
}

/** The number a phone took from its block, if it is really one set aside for this login and not used yet. */
async function numberFromBlock(tx: any, accountId: string, userId: string | null, n: unknown): Promise<number | null> {
  if (!userId || typeof n !== 'number' || !Number.isInteger(n) || n <= 0) return null
  const block = await tx.receiptNumberBlock.findFirst({ where: { accountId, userId, first: { lte: n }, last: { gte: n } }, select: { id: true } })
  if (!block) return null
  const used = await tx.receipt.findUnique({ where: { accountId_number: { accountId, number: n } }, select: { id: true } })
  return used ? null : n
}

// ── Payments ────────────────────────────────────────────────────────────────

export interface NewPayment {
  id: string
  jobId: string
  amountCents: number
  method: string
  checkNumber?: string | null
  reference?: string | null
  paidOn?: string | null
  note?: string | null
  /** The check's photo as a data URL (a JPEG the phone made smaller). */
  photo?: string | null
  /** The receipt number the phone took from its block, and the link token it made (so the link was known with no signal). */
  receiptNumber?: number | null
  receiptToken?: string | null
  lienRelease?: boolean
}

export const TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/

function savePhoto(accountId: string, paymentId: string, dataUrl: string | null | undefined): string | null {
  const m = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '')
  if (!m) return null
  const buf = Buffer.from(m[2], 'base64')
  if (!buf.length || buf.length > 8 * 1024 * 1024) return null
  const key = path.join('payments', accountId, `${paymentId}.${m[1] === 'jpg' ? 'jpeg' : m[1]}`)
  const full = path.resolve(UPLOAD_DIR(), key)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, buf)
  return key
}

export function photoPath(key: string): string | null {
  const root = path.resolve(UPLOAD_DIR())
  const full = path.resolve(root, key)
  return full.startsWith(root + path.sep) && fs.existsSync(full) ? full : null
}

/**
 * Record a payment and make its receipt, in one step. The same id sent again
 * (the phone resending after the answer was lost) returns the first one and
 * makes nothing new. `created` false for a repeat.
 */
export async function recordPayment(accountId: string, p: NewPayment, by: Actor, needsConfirm: boolean): Promise<{ payment: any; receipt: any; created: boolean }> {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(p.id)) throw err(400, 'This payment has no usable id. Reload and try again.')
  const again = await prisma.contractPayment.findUnique({ where: { id: p.id } })
  if (again) {
    if (again.accountId !== accountId) throw err(409, 'Invalid id')
    return { payment: again, receipt: await prisma.receipt.findUnique({ where: { paymentId: again.id } }), created: false }
  }
  if (!Number.isInteger(p.amountCents) || p.amountCents <= 0) throw err(400, 'Enter the amount received.')
  if (!(METHODS as readonly string[]).includes(p.method)) throw err(400, 'Pick how it was paid.')
  const paidOn = /^\d{4}-\d{2}-\d{2}$/.test(p.paidOn ?? '') ? p.paidOn! : ocalaDay()
  const schedule = await ensureSchedule(accountId, p.jobId, 'button', by, { force: true })
  if (!schedule) throw err(409, 'This job has no signed contract, so it has no payment schedule yet.')
  const photoKey = savePhoto(accountId, p.id, p.photo)
  try {
    const out = await prisma.$transaction(async tx => {
      await lockJob(tx, p.jobId)
      const raced = await tx.contractPayment.findUnique({ where: { id: p.id } })
      if (raced) return { payment: raced, receipt: await tx.receipt.findUnique({ where: { paymentId: raced.id } }), created: false }
      const payment = await tx.contractPayment.create({
        data: {
          id: p.id, accountId, jobId: p.jobId, quoteId: schedule.quoteId, crmContactId: schedule.crmContactId,
          amountCents: p.amountCents, method: p.method, checkNumber: p.method === 'check' ? (p.checkNumber?.trim().slice(0, 40) || null) : null,
          reference: p.reference?.trim().slice(0, 200) || null, paidOn, note: (p.note ?? '').slice(0, 1000), photoKey,
          recordedById: by.userId, recordedBy: by.name, recordedRole: by.role ?? null, needsConfirm, source: 'app',
        },
      })
      await settleIn(tx, accountId, p.jobId, 'payment recorded', by)
      const fromBlock = await numberFromBlock(tx, accountId, by.userId, p.receiptNumber)
      const receipt = await makeReceiptIn(tx, accountId, payment.id, { number: fromBlock, token: p.receiptToken, lienRelease: !!p.lienRelease })
      return { payment, receipt, created: true }
    }, { timeout: 20_000 })
    return out
  } catch (e) {
    if ((e as any)?.code === 'P2002') {
      const won = await prisma.contractPayment.findUnique({ where: { id: p.id } })
      if (won && won.accountId === accountId) return { payment: won, receipt: await prisma.receipt.findUnique({ where: { paymentId: won.id } }), created: false }
    }
    throw e
  }
}

// ── Receipts ────────────────────────────────────────────────────────────────

/** What the receipt for `paymentId` says, as of that payment (paid to date counts it and the ones before it). */
export async function receiptSnapshotIn(tx: any, accountId: string, paymentId: string, number: number, lienRelease: boolean): Promise<ReceiptSnapshot> {
  const pay = await tx.contractPayment.findUnique({ where: { id: paymentId } })
  const schedule = await tx.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId: pay.jobId } } })
  const job = await tx.savedJob.findUnique({ where: { id: pay.jobId } })
  const parts = await contractParts(tx, accountId, schedule)
  const invoices = await tx.contractInvoice.findMany({ where: { scheduleId: schedule.id } })
  const all = await tx.contractPayment.findMany({ where: { accountId, jobId: pay.jobId } })
  const a = applyPayments(
    invoices.map((i: any) => ({ id: i.id, amountCents: i.amountCents, sortOrder: i.sortOrder, createdAt: i.createdAt, voided: !!i.voidedAt })),
    all.map((p: any) => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, createdAt: p.createdAt, voided: !!p.voidedAt && p.id !== paymentId })),
  )
  const byId = new Map(invoices.map((i: any) => [i.id, i]))
  const forItems: Array<{ label: string; cents: number }> = a.applications.filter(x => x.paymentId === paymentId).map(x => {
    const inv: any = byId.get(x.invoiceId)
    const label = inv.kind === 'final' ? (parts.changeOrderCents ? 'Final payment (with change orders)' : 'Final payment') : inv.kind === 'deposit' ? 'Deposit' : inv.label
    return { label, cents: x.amountCents }
  })
  const over = a.unappliedByPayment.get(paymentId) ?? 0
  if (over > 0) forItems.push({ label: 'Credit (over the balance)', cents: over })
  // Paid to date: this payment and the ones that came before it.
  const order = all.filter((p: any) => !p.voidedAt || p.id === paymentId).sort((x: any, y: any) => x.paidOn.localeCompare(y.paidOn) || x.createdAt.getTime() - y.createdAt.getTime() || x.id.localeCompare(y.id))
  const upTo = order.slice(0, order.findIndex((p: any) => p.id === paymentId) + 1)
  const paidToDate = upTo.reduce((s: number, p: any) => s + p.amountCents, 0)
  const balance = parts.contractCents - paidToDate
  const final = invoices.find((i: any) => i.kind === 'final')
  const paidInFull = balance <= 0 && !!final
  const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const co = (b?.config as any)?.company ?? {}
  const contact = pay.crmContactId ? await tx.crmContact.findUnique({ where: { id: pay.crmContactId }, select: { firstName: true, lastName: true, phone: true, email: true, serviceAddress: true } }) : null
  const q = schedule.quoteId ? await tx.savedQuote.findUnique({ where: { id: schedule.quoteId } }) : null
  let warrantyName: string | null = null
  if (paidInFull) {
    const w = await effectiveQuoteWarranty(q as any, job?.fenceStyle ?? '').catch(() => null)
    warrantyName = w?.warranty?.name ?? null
  }
  return {
    number, paidOn: pay.paidOn,
    company: { name: String(co.name || 'Getter Done Fence'), phone: String(co.phone || ''), email: String(co.email || '') },
    customerName: job?.customerName || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || q?.customerName || '',
    address: job?.customerAddress || contact?.serviceAddress || q?.customerAddress || '',
    phone: job?.customerPhone || contact?.phone || '', email: job?.customerEmail || contact?.email || '',
    fenceStyle: job?.fenceStyle || q?.fenceStyle || '',
    amountCents: pay.amountCents, method: pay.method, methodText: methodText(pay.method, pay.checkNumber, pay.reference),
    forItems, forText: forItems.map(i => i.label).join(' and ') || 'Payment',
    ...parts, paidToDateCents: paidToDate, balanceCents: balance, paidInFull, warrantyName, lienRelease: lienRelease && paidInFull,
    recordedBy: pay.recordedBy, jobId: pay.jobId, quoteId: schedule.quoteId ?? null,
  }
}

/** The receipt of a payment, made once. `number`: one the phone took from its block (checked), else the next in the sequence. */
export async function makeReceiptIn(tx: any, accountId: string, paymentId: string, o: { number?: number | null; token?: string | null; lienRelease?: boolean } = {}): Promise<any> {
  const have = await tx.receipt.findUnique({ where: { paymentId } })
  if (have) return have
  const number = o.number ?? await takeNumbers(tx, accountId, 1)
  const token = o.token && TOKEN_RE.test(o.token) && !(await tx.receipt.findUnique({ where: { token: o.token }, select: { id: true } })) ? o.token : crypto.randomBytes(24).toString('base64url')
  const snapshot = await receiptSnapshotIn(tx, accountId, paymentId, number, !!o.lienRelease)
  const pay = await tx.contractPayment.findUnique({ where: { id: paymentId }, select: { jobId: true, crmContactId: true } })
  return tx.receipt.create({ data: { accountId, number, paymentId, jobId: pay.jobId, crmContactId: pay.crmContactId, token, snapshot: snapshot as any, lienRelease: snapshot.lienRelease } })
}

/** The PDF of a receipt as it is now (VOID once voided), with the warranty's start day looked up fresh. */
export async function receiptPdfOf(r: { snapshot: unknown; voidedAt: Date | null; jobId: string }): Promise<Buffer> {
  const s = r.snapshot as ReceiptSnapshot
  let installDay: string | null = null
  if (s.paidInFull) {
    const job = await prisma.savedJob.findUnique({ where: { id: r.jobId }, select: { id: true, completedDate: true } })
    const day = job ? await installDateOf(job).catch(() => null) : null
    installDay = day ? dayWords(day) : null
  }
  // The fence in plain words ("White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig"), never the style code the receipt was saved with.
  const fenceStyle = s.fenceStyle ? await plainStyleName(s.fenceStyle) : ''
  return receiptPdf({ s: { ...s, fenceStyle }, voided: !!r.voidedAt, dayWords: dayWords(s.paidOn), installDay })
}

/**
 * The receipt in the customer's Documents (visible in their portal): the PDF
 * written to the upload folder and a PortalFile for it, once. Again after a
 * void, so the file says VOID. Nothing is sent.
 */
export async function fileReceipt(receiptId: string): Promise<void> {
  const r = await prisma.receipt.findUnique({ where: { id: receiptId } })
  if (!r || !r.crmContactId) return
  const pdf = await receiptPdfOf(r)
  const s = r.snapshot as unknown as ReceiptSnapshot
  const label = `${receiptName(r.number)}${r.voidedAt ? ' (void)' : ''}: ${moneyText(s.amountCents)} ${s.forText.toLowerCase()}`
  const name = `receipt-${r.number}.pdf`
  if (r.portalFileId) {
    const f = await prisma.portalFile.findUnique({ where: { id: r.portalFileId } })
    if (f) {
      fs.writeFileSync(path.resolve(UPLOAD_DIR(), f.fileKey), pdf)
      await prisma.portalFile.update({ where: { id: f.id }, data: { label, fileSizeBytes: pdf.length } })
      return
    }
  }
  const fileKey = path.join('portal', r.crmContactId, `${name.replace('.pdf', '')}-${r.id}.pdf`)
  const full = path.resolve(UPLOAD_DIR(), fileKey)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, pdf)
  const file = await prisma.portalFile.create({
    data: {
      crmCustomerId: r.crmContactId, uploadedByUser: 'EZ Biz', fileKey, fileUrl: `/api/portal/files/${encodeURIComponent(fileKey)}`,
      originalFilename: name, fileSizeBytes: pdf.length, mimeType: 'application/pdf', fileKind: 'document', source: 'system_generated', label, isVisibleToCustomer: true,
    },
  })
  await prisma.receipt.updateMany({ where: { id: r.id, portalFileId: null }, data: { portalFileId: file.id } })
}

// ── Owner and office ────────────────────────────────────────────────────────

/** Confirm a payment a Salesman recorded. The receipt does not change. */
export async function confirmPayment(accountId: string, id: string, by: Actor): Promise<any> {
  return prisma.$transaction(async tx => {
    const p = await tx.contractPayment.findUnique({ where: { id } })
    if (!p || p.accountId !== accountId) throw err(404, 'Payment not found')
    if (p.voidedAt) throw err(409, 'This payment was voided.')
    if (p.confirmedAt) return p
    const row = await tx.contractPayment.update({ where: { id }, data: { confirmedAt: new Date(), confirmedBy: by.name } })
    await log(tx, accountId, p.jobId, { kind: 'confirm', paymentId: id, by, text: `${moneyText(p.amountCents)} ${methodText(p.method, p.checkNumber, p.reference)} recorded by ${p.recordedBy}: confirmed.` })
    return row
  })
}

/** Void a payment and its receipt (logged). The balance goes back up; the receipt says VOID. */
export async function voidPayment(accountId: string, id: string, reason: string, by: Actor): Promise<{ payment: any; receipt: any | null }> {
  if (!reason.trim()) throw err(400, 'Say why it is voided.')
  const out = await prisma.$transaction(async tx => {
    const p = await tx.contractPayment.findUnique({ where: { id } })
    if (!p || p.accountId !== accountId) throw err(404, 'Payment not found')
    await lockJob(tx, p.jobId)
    if (p.voidedAt) return { payment: p, receipt: await tx.receipt.findUnique({ where: { paymentId: id } }) }
    const at = new Date()
    const payment = await tx.contractPayment.update({ where: { id }, data: { voidedAt: at, voidedBy: by.name, voidReason: reason.trim().slice(0, 500) } })
    const receipt = await tx.receipt.findUnique({ where: { paymentId: id } })
    if (receipt) await tx.receipt.update({ where: { id: receipt.id }, data: { voidedAt: at } })
    await log(tx, accountId, p.jobId, { kind: 'void', paymentId: id, fromCents: p.amountCents, toCents: 0, by, text: `${moneyText(p.amountCents)} ${methodText(p.method, p.checkNumber, p.reference)} voided${receipt ? ` with ${receiptName(receipt.number)}` : ''}: ${reason.trim()}` })
    await settleIn(tx, accountId, p.jobId, 'payment voided', by)
    return { payment, receipt: receipt ? { ...receipt, voidedAt: at } : null }
  }, { timeout: 20_000 })
  if (out.receipt) await fileReceipt(out.receipt.id).catch(e => console.error('[billing] void receipt file:', e))
  return out
}

/** Owner or admin: change an invoice's amount (never the Final: it is what is left of the contract). Logged. */
export async function editInvoiceAmount(accountId: string, invoiceId: string, amountCents: number, reason: string, by: Actor): Promise<any> {
  if (!Number.isInteger(amountCents) || amountCents < 0) throw err(400, 'Enter the amount in dollars and cents.')
  if (!reason.trim()) throw err(400, 'Say why the amount changes.')
  return prisma.$transaction(async tx => {
    const inv = await tx.contractInvoice.findUnique({ where: { id: invoiceId } })
    if (!inv || inv.accountId !== accountId) throw err(404, 'Invoice not found')
    await lockJob(tx, inv.jobId)
    if (inv.kind === 'final') throw err(409, 'The Final is what is left of the contract. To change it, change the contract with an adjustment.')
    if (inv.amountCents === amountCents) return inv
    const row = await tx.contractInvoice.update({ where: { id: invoiceId }, data: { amountCents } })
    await log(tx, accountId, inv.jobId, { kind: 'amount_edit', invoiceId, fromCents: inv.amountCents, toCents: amountCents, by, text: `${inv.label} ${moneyText(inv.amountCents)} → ${moneyText(amountCents)}: ${reason.trim()}` })
    await settleIn(tx, accountId, inv.jobId, `${inv.label} changed`, by)
    return row
  }, { timeout: 20_000 })
}

/**
 * Owner or admin: a contract amount adjustment (−27 cents to make it $8,914.00).
 * The signed amount stays as signed; this line changes the contract total and
 * the Final, logged with who, when and why.
 */
export async function addAdjustment(accountId: string, jobId: string, amountCents: number, reason: string, by: Actor): Promise<any> {
  if (!Number.isInteger(amountCents) || amountCents === 0) throw err(400, 'Enter the adjustment in dollars and cents (a minus for less).')
  if (!reason.trim()) throw err(400, 'Say why the contract amount changes.')
  return prisma.$transaction(async tx => {
    await lockJob(tx, jobId)
    const schedule = await tx.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId } } })
    if (!schedule) throw err(409, 'This job has no payment schedule yet.')
    const before = (await contractParts(tx, accountId, schedule)).contractCents
    const row = await tx.contractAdjustment.create({ data: { accountId, jobId, amountCents, reason: reason.trim().slice(0, 500), byUserId: by.userId, byName: by.name } })
    await log(tx, accountId, jobId, { kind: 'adjustment', fromCents: before, toCents: before + amountCents, by, text: `Contract ${moneyText(before)} → ${moneyText(before + amountCents)} (adjustment ${moneyText(amountCents)}): ${reason.trim()}` })
    await settleIn(tx, accountId, jobId, `contract adjustment ${moneyText(amountCents)}`, by)
    return row
  }, { timeout: 20_000 })
}

// ── What the screens show ───────────────────────────────────────────────────

/** A job's schedule for the screens: invoices with paid and balance, payments with their receipts, adjustments and the log. */
export async function scheduleView(accountId: string, jobId: string): Promise<any | null> {
  const schedule = await prisma.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId } } })
  if (!schedule) return null
  const [job, invoices, payments, receipts, adjustments, logs] = await Promise.all([
    prisma.savedJob.findUnique({ where: { id: jobId } }),
    prisma.contractInvoice.findMany({ where: { scheduleId: schedule.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.contractPayment.findMany({ where: { accountId, jobId }, orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }] }),
    prisma.receipt.findMany({ where: { accountId, jobId } }),
    prisma.contractAdjustment.findMany({ where: { accountId, jobId }, orderBy: { createdAt: 'asc' } }),
    prisma.billingLog.findMany({ where: { accountId, jobId }, orderBy: { at: 'desc' }, take: 50 }),
  ])
  const parts = await contractParts(prisma, accountId, schedule)
  const a = applyPayments(
    invoices.map(i => ({ id: i.id, amountCents: i.amountCents, sortOrder: i.sortOrder, createdAt: i.createdAt, voided: !!i.voidedAt })),
    payments.map(p => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, createdAt: p.createdAt, voided: !!p.voidedAt })),
  )
  const paid = payments.filter(p => !p.voidedAt).reduce((s, p) => s + p.amountCents, 0)
  const rByPay = new Map(receipts.map(r => [r.paymentId, r]))
  const contact = schedule.crmContactId ? await prisma.crmContact.findUnique({ where: { id: schedule.crmContactId }, select: { firstName: true, lastName: true, phone: true, email: true } }) : null
  // The warranty a paid in full receipt names (the phone's offline receipt needs it too).
  const q = schedule.quoteId ? await prisma.savedQuote.findUnique({ where: { id: schedule.quoteId } }) : null
  const warrantyName = (await effectiveQuoteWarranty(q as any, job?.fenceStyle ?? '').catch(() => null))?.warranty?.name ?? null
  return {
    jobId, quoteId: schedule.quoteId, customerId: schedule.crmContactId,
    customerName: job?.customerName || [contact?.firstName, contact?.lastName].filter(Boolean).join(' '),
    address: job?.customerAddress ?? '', phone: contact?.phone || job?.customerPhone || '', email: contact?.email || job?.customerEmail || '',
    fenceStyle: job?.fenceStyle ?? '', completedDate: job?.completedDate ?? null, depositPct: schedule.depositPct, source: schedule.source, warrantyName,
    // Paid over the contract (a credit change order after the Final was paid): owed back to the customer.
    ...parts, paidCents: paid, balanceCents: parts.contractCents - paid, creditCents: Math.max(a.creditCents, paid - parts.contractCents),
    invoices: invoices.filter(i => !i.voidedAt).map(i => {
      const p = a.paidByInvoice.get(i.id) ?? 0
      return { id: i.id, key: i.key, kind: i.kind, label: i.label, amountCents: i.amountCents, originalCents: i.originalCents, contractCents: i.contractCents, paidCents: p, balanceCents: i.amountCents - p, dueOn: i.dueOn, dueDate: i.dueDate, legacyNumber: i.legacyNumber }
    }),
    payments: payments.map(p => {
      const r = rByPay.get(p.id)
      return {
        id: p.id, amountCents: p.amountCents, method: p.method, checkNumber: p.checkNumber, reference: p.reference, methodText: methodText(p.method, p.checkNumber, p.reference),
        paidOn: p.paidOn, note: p.note, recordedBy: p.recordedBy, needsConfirm: p.needsConfirm, confirmedAt: p.confirmedAt, confirmedBy: p.confirmedBy,
        voidedAt: p.voidedAt, voidedBy: p.voidedBy, voidReason: p.voidReason, hasPhoto: !!p.photoKey, source: p.source,
        receipt: r ? receiptView(r) : null,
      }
    }),
    adjustments: adjustments.map(x => ({ id: x.id, amountCents: x.amountCents, reason: x.reason, byName: x.byName, at: x.createdAt })),
    log: logs.map(l => ({ id: l.id, kind: l.kind, text: l.text, byName: l.byName, at: l.at })),
  }
}

/**
 * A receipt for the screens. What it says is `says` (the saved snapshot): a
 * field named "snapshot" is taken out of every answer to a Salesman's phone
 * (lib/costRedact.ts, a proposal option's internal snapshot), and a Salesman
 * hands receipts to customers too.
 */
export function receiptView(r: any) {
  return { id: r.id, number: r.number, token: r.token, voided: !!r.voidedAt, says: r.snapshot, lienRelease: r.lienRelease, emailTo: r.emailTo, emailStatus: r.emailStatus, emailedAt: r.emailedAt, textedTo: r.textedTo, textedAt: r.textedAt, createdAt: r.createdAt, filed: !!r.portalFileId }
}

// ── Sending ─────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Email the receipt link to `to` (the customer's saved email, or what was
 * typed on the receipt screen), with the receipt PDF attached. Only through the server's email settings
 * (empty on the dev copy: it says "not set up" and nothing goes out). The
 * result is kept on the receipt.
 */
export async function emailReceipt(accountId: string, receiptId: string, to: string, link: string, by: Actor): Promise<{ status: 'sent' | 'failed' | 'not_configured'; error?: string }> {
  const r = await prisma.receipt.findUnique({ where: { id: receiptId } })
  if (!r || r.accountId !== accountId) throw err(404, 'Receipt not found')
  const addr = to.trim()
  if (!EMAIL_RE.test(addr)) throw err(400, 'That email address does not look right.')
  if (!/^https?:\/\/[^\s]+\/p\/r\/[A-Za-z0-9_-]+$/.test(link) || !link.endsWith(`/p/r/${r.token}`)) throw err(400, 'The receipt link is not right. Reload and try again.')
  const { isEmailServiceConfigured, sendEmail, buildEmailHtml } = await import('./emailService.js')
  const s = r.snapshot as unknown as ReceiptSnapshot
  let status: 'sent' | 'failed' | 'not_configured'
  let error: string | undefined
  if (!isEmailServiceConfigured()) {
    status = 'not_configured'
  } else {
    // The receipt PDF goes along with the link (the link alone when the PDF cannot be made).
    const pdf = await receiptPdfOf(r).catch((e) => { console.warn('[receipt email] PDF not attached:', (e as Error).message); return null })
    const out = await sendEmail({
      to: addr,
      ...(pdf ? { attachments: [{ filename: `receipt-${r.number}.pdf`, content: pdf, contentType: 'application/pdf' }] } : {}),
      subject: `${s.company.name}: ${receiptName(r.number)}, ${moneyText(s.amountCents)} received`,
      body: buildEmailHtml(`<p>Hi ${s.customerName.split(' ')[0] || 'there'},</p><p>Thank you! We received ${moneyText(s.amountCents)} (${s.methodText}) for ${s.forText.toLowerCase()}.${s.paidInFull ? ' Your contract is paid in full.' : ` Balance remaining: ${moneyText(Math.max(0, s.balanceCents))}.`}</p><p>Your receipt: <a href="${link}">${link}</a></p><p>${s.company.name}${s.company.phone ? ` · ${s.company.phone}` : ''}</p>`),
    })
    status = out.success ? 'sent' : out.notConfigured ? 'not_configured' : 'failed'
    if (!out.success && !out.notConfigured) error = out.error
  }
  await prisma.receipt.update({ where: { id: r.id }, data: { emailTo: addr, emailStatus: status, ...(status === 'sent' ? { emailedAt: new Date() } : {}) } })
  await prisma.billingLog.create({ data: { accountId, jobId: r.jobId, paymentId: r.paymentId, kind: 'email', text: `${receiptName(r.number)} email to ${addr}: ${status === 'sent' ? 'sent' : status === 'not_configured' ? 'not sent, email is not set up on this server' : `failed (${error ?? 'unknown'})`}`, byName: by.name, byUserId: by.userId } })
  return { status, ...(error ? { error } : {}) }
}

/** The receipt link was handed to the phone's texting app (sms: link). Kept on the receipt; nothing is sent by the server. */
export async function noteReceiptTexted(accountId: string, receiptId: string, to: string, by: Actor): Promise<void> {
  const r = await prisma.receipt.findUnique({ where: { id: receiptId } })
  if (!r || r.accountId !== accountId) throw err(404, 'Receipt not found')
  await prisma.receipt.update({ where: { id: r.id }, data: { textedTo: to.slice(0, 40), textedAt: new Date() } })
  await prisma.billingLog.create({ data: { accountId, jobId: r.jobId, paymentId: r.paymentId, kind: 'text', text: `${receiptName(r.number)} link opened in the phone's texting app for ${to}`, byName: by.name, byUserId: by.userId } })
}
