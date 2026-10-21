/**
 * The invoices and payments typed by hand in Billing (BusinessState.invoices
 * and .payments) that belong to a sold job, taken into the job's payment
 * schedule (lib/contractBilling.ts), once per company, at server start
 * (AccountKeyValue 'migration:contract-billing-2026-10'), in one transaction
 * holding the company's lock (lib/lockState.ts), in turn with the other
 * start-up steps.
 *
 *   - A hand-made invoice keeps its own amount and its payments. One labeled
 *     a deposit (its title or a line says "deposit") is the schedule's
 *     Deposit, at its own amount (not worked out again from the deposit
 *     percent). The Final is the contract less the hand-made invoices.
 *   - Each payment typed against it is recorded once (its old id is kept), as
 *     typed: amount, method, check number or reference, day. Never twice: an
 *     invoice or payment already taken in is left alone.
 *   - Which job: the invoice's own job, else the customer's one job (never by
 *     name, phone or email). A customer with no job or more than one is left
 *     as it is and listed by scripts/receipts-backfill.ts.
 *   - The Billing entries stay where they are, marked with the job they went
 *     to (adoptedJobId / adoptedPaymentId), so the Billing page shows them as
 *     on the schedule and offers no second "Record payment".
 *   - Nothing is sent and no receipt is made: receipts for past payments are
 *     a separate step after Jonathan's OK (scripts/receipts-backfill.ts --apply).
 *
 * Kristi Murphy on live (Oct 21, 2026): INV-1001 "Deposit" $4,457.00, paid
 * by check (reference "Cashiers check") on Oct 21 becomes her Deposit,
 * $4,457.00 paid; her Final is her contract less $4,457.00, open.
 */

import prisma from './prisma.js'
import { lockAccountState } from './lockState.js'
import { makeScheduleIn, settleIn, type Actor, type HandMade, ocalaDay } from './contractBilling.js'
import { moneyText } from './paymentMath.js'

export const ADOPTION_KEY = 'migration:contract-billing-2026-10'
const BY: Actor = { userId: null, name: 'Billing (typed by hand)' }

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)
const cents = (v: unknown) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : 0)

export interface LegacyInvoice { id: string; customerId?: string; customerName?: string; jobId?: string; invoiceNumber?: string; title?: string; status?: string; lineItems?: any[]; totalCents?: number; amountPaidCents?: number; createdAt?: string; adoptedJobId?: string }
export interface LegacyPayment { id: string; invoiceId?: string; amountCents?: number; paymentMethod?: string; referenceNumber?: string; paymentDate?: string; recordedBy?: string; notes?: string; createdAt?: string; adoptedPaymentId?: string }

/** Is this hand-made invoice the deposit? Its title, or one of its lines, says so. */
export function isDepositInvoice(inv: LegacyInvoice): boolean {
  if (/deposit/i.test(inv.title ?? '')) return true
  return Array.isArray(inv.lineItems) && inv.lineItems.some(l => /deposit/i.test(String(l?.description ?? '')))
}

/** The old Billing method, in the schedule's words. */
export function methodOf(p: LegacyPayment): { method: string; checkNumber: string | null; reference: string | null } {
  const ref = String(p.referenceNumber ?? '').trim()
  const m = String(p.paymentMethod ?? '')
  if (m === 'check') return /^\d{1,12}$/.test(ref) ? { method: 'check', checkNumber: ref, reference: null } : { method: 'check', checkNumber: null, reference: ref || null }
  if (m === 'cash') return { method: 'cash', checkNumber: null, reference: ref || null }
  if (m === 'credit_card' || m === 'payment_link') return { method: 'card', checkNumber: null, reference: ref || null }
  return { method: /zelle/i.test(ref) ? 'zelle' : 'other', checkNumber: null, reference: ref || null }
}

export interface PlanRow {
  invoice: LegacyInvoice
  payments: LegacyPayment[]
  jobId: string | null
  /** Why it is not taken in (no job, more than one, void, already taken in). */
  why: string | null
  deposit: boolean
  adopted: boolean
}

/** Which job each hand-made invoice belongs to, and whether it can be taken in. Read only. */
export async function planAdoption(tx: any, accountId: string, invoices: LegacyInvoice[], payments: LegacyPayment[]): Promise<PlanRow[]> {
  const rows: PlanRow[] = []
  const taken = new Set((await tx.contractInvoice.findMany({ where: { accountId, legacyId: { not: null } }, select: { legacyId: true } })).map((r: any) => r.legacyId))
  for (const inv of invoices) {
    if (!isObj(inv) || typeof inv.id !== 'string') continue
    const pays = payments.filter(p => isObj(p) && p.invoiceId === inv.id)
    const row: PlanRow = { invoice: inv, payments: pays, jobId: null, why: null, deposit: isDepositInvoice(inv), adopted: false }
    rows.push(row)
    if (taken.has(inv.id) || inv.adoptedJobId) { row.adopted = true; row.jobId = inv.adoptedJobId ?? null; row.why = 'already on the schedule'; continue }
    if (inv.status === 'void') { row.why = 'void'; continue }
    if (cents(inv.totalCents) <= 0) { row.why = 'no amount'; continue }
    // all rows here are this company's; a deleted job is not a sold job.
    if (inv.jobId) {
      const j = await tx.savedJob.findFirst({ where: { id: inv.jobId, accountId, deletedAt: null }, select: { id: true } })
      if (j) { row.jobId = j.id; continue }
    }
    if (!inv.customerId) { row.why = 'no customer on the invoice'; continue }
    const jobs = await tx.savedJob.findMany({ where: { accountId, crmContactId: inv.customerId, deletedAt: null }, select: { id: true, quoteId: true, archivedAt: true } })
    const sold: string[] = []
    for (const j of jobs) {
      if (!j.quoteId) { sold.push(j.id); continue }
      const q = await tx.savedQuote.findFirst({ where: { id: j.quoteId, accountId }, select: { status: true, acceptedAt: true, soldAt: true } })
      if (q && (q.status === 'SOLD' || q.acceptedAt || q.soldAt)) sold.push(j.id)
    }
    if (sold.length === 1) row.jobId = sold[0]
    else row.why = sold.length ? `the customer has ${sold.length} sold jobs; pick one by hand` : 'the customer has no sold job'
  }
  return rows
}

export interface AdoptionResult { invoices: number; payments: number; jobs: number; skipped: Array<{ number: string; why: string }> }

/** Take the plan in, inside `tx` (the company's Settings row already locked). */
export async function adoptIn(tx: any, accountId: string): Promise<AdoptionResult> {
  const b = await tx.businessState.findUnique({ where: { accountId }, select: { invoices: true, payments: true } })
  const invoices: LegacyInvoice[] = Array.isArray(b?.invoices) ? b.invoices : []
  const payments: LegacyPayment[] = Array.isArray(b?.payments) ? b.payments : []
  const out: AdoptionResult = { invoices: 0, payments: 0, jobs: 0, skipped: [] }
  if (!invoices.length) return out
  const plan = await planAdoption(tx, accountId, invoices, payments)
  const byJob = new Map<string, PlanRow[]>()
  for (const r of plan) {
    if (r.adopted) continue
    if (!r.jobId) { out.skipped.push({ number: r.invoice.invoiceNumber ?? r.invoice.id, why: r.why ?? '' }); continue }
    byJob.set(r.jobId, [...(byJob.get(r.jobId) ?? []), r])
  }
  const invMark = new Map<string, string>()
  const payMark = new Map<string, string>()
  for (const [jobId, rows] of byJob) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'contract-billing:' + jobId}))`
    // Deposits first, then oldest first.
    rows.sort((a, b) => Number(b.deposit) - Number(a.deposit) || String(a.invoice.createdAt ?? '').localeCompare(String(b.invoice.createdAt ?? '')))
    const hand: HandMade[] = rows.map(r => ({
      legacyId: r.invoice.id, legacyNumber: String(r.invoice.invoiceNumber ?? ''), label: String(r.invoice.title || r.invoice.invoiceNumber || 'Invoice').slice(0, 80),
      deposit: r.deposit, amountCents: cents(r.invoice.totalCents), createdAt: r.invoice.createdAt && !Number.isNaN(Date.parse(r.invoice.createdAt)) ? new Date(r.invoice.createdAt) : new Date(),
    }))
    const had = await tx.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId } } })
    const schedule = had ?? await makeScheduleIn(tx, accountId, jobId, 'adopted', BY, hand)
    if (!schedule) { for (const r of rows) out.skipped.push({ number: r.invoice.invoiceNumber ?? r.invoice.id, why: 'the job could not be read' }); continue }
    if (had) {
      // A schedule made since: the hand-made invoices go on it (the deposit takes the automatic one's place if nothing is paid on it).
      for (const h of hand) {
        const dep = h.deposit ? await tx.contractInvoice.findUnique({ where: { scheduleId_key: { scheduleId: had.id, key: 'deposit' } } }) : null
        const depPaid = dep ? await tx.paymentApplication.count({ where: { invoiceId: dep.id } }) : 1
        if (dep && !dep.legacyId && !depPaid) {
          await tx.contractInvoice.update({ where: { id: dep.id }, data: { amountCents: h.amountCents, legacyId: h.legacyId, legacyNumber: h.legacyNumber } })
          await tx.billingLog.create({ data: { accountId, jobId, invoiceId: dep.id, kind: 'adopted', fromCents: dep.amountCents, toCents: h.amountCents, text: `Deposit ${moneyText(dep.amountCents)} → ${moneyText(h.amountCents)}: ${h.legacyNumber} typed in Billing is the deposit.`, byName: BY.name } })
        } else {
          await tx.contractInvoice.create({ data: { accountId, scheduleId: had.id, jobId, quoteId: had.quoteId, crmContactId: had.crmContactId, key: `legacy-${h.legacyId}`, kind: 'other', label: h.label, sortOrder: 50, originalCents: h.amountCents, amountCents: h.amountCents, contractCents: 0, dueOn: 'signing', legacyId: h.legacyId, legacyNumber: h.legacyNumber, createdAt: h.createdAt } })
        }
      }
    }
    for (const r of rows) {
      invMark.set(r.invoice.id, jobId)
      out.invoices++
      await tx.billingLog.create({ data: { accountId, jobId, kind: 'adopted', toCents: cents(r.invoice.totalCents), text: `${r.invoice.invoiceNumber ?? 'Invoice'} "${r.invoice.title ?? ''}" ${moneyText(cents(r.invoice.totalCents))} typed in Billing, taken into the schedule${r.deposit ? ' as the Deposit' : ''}.`, byName: BY.name } })
      for (const p of r.payments) {
        if (p.adoptedPaymentId) continue
        const amount = cents(p.amountCents)
        if (amount <= 0) continue
        const id = `adopted-${p.id}`.slice(0, 64)
        if (await tx.contractPayment.findUnique({ where: { id } })) { payMark.set(p.id, id); continue }
        const m = methodOf(p)
        const day = /^\d{4}-\d{2}-\d{2}$/.test(p.paymentDate ?? '') ? p.paymentDate! : ocalaDay(p.createdAt ? new Date(p.createdAt) : new Date())
        await tx.contractPayment.create({
          data: {
            id, accountId, jobId, quoteId: schedule.quoteId, crmContactId: schedule.crmContactId, amountCents: amount, ...m, paidOn: day,
            note: String(p.notes ?? '').slice(0, 1000), recordedBy: String(p.recordedBy || 'Billing').slice(0, 120), needsConfirm: false,
            confirmedAt: new Date(), confirmedBy: 'Typed in Billing', source: 'adopted', legacyId: p.id,
            createdAt: p.createdAt && !Number.isNaN(Date.parse(p.createdAt)) ? new Date(p.createdAt) : new Date(),
          },
        })
        payMark.set(p.id, id)
        out.payments++
      }
    }
    await settleIn(tx, accountId, jobId, 'invoices typed in Billing taken in', BY)
    out.jobs++
  }
  if (invMark.size || payMark.size) {
    const nextInv = invoices.map(i => (isObj(i) && invMark.has(i.id) ? { ...i, adoptedJobId: invMark.get(i.id) } : i))
    const nextPay = payments.map(p => (isObj(p) && payMark.has(p.id) ? { ...p, adoptedPaymentId: payMark.get(p.id) } : p))
    await tx.businessState.update({ where: { accountId }, data: { invoices: nextInv as any, payments: nextPay as any, version: { increment: 1 } } })
  }
  return out
}

/** The one-time step for one company. Null when it already ran. */
export async function adoptHandMadeBilling(accountId: string): Promise<AdoptionResult | null> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'contract-billing-adopt:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: ADOPTION_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const out = await adoptIn(tx, accountId)
    await tx.accountKeyValue.create({ data: { accountId, key: ADOPTION_KEY, value: { at: new Date().toISOString(), ...out } as any } })
    return out
  }, { timeout: 60_000 })
}

/** At server start: every company with saved settings. */
export async function adoptHandMadeBillingAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await adoptHandMadeBilling(r.accountId)
      if (out && (out.invoices || out.skipped.length)) console.log(`[billing] hand-made Billing taken into payment schedules for ${r.accountId}: ${out.invoices} invoices, ${out.payments} payments, ${out.jobs} jobs; left as they are: ${out.skipped.map(s => `${s.number} (${s.why})`).join(', ') || 'none'}`)
    } catch (err) { console.error('[billing] could not take in the hand-made Billing:', err) }
  }
}
