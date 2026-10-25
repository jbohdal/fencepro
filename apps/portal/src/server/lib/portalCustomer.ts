/**
 * What the customer portal may show (Jonathan, Oct 22 2026): "Photos marked
 * Customer (the photos of their yard and survey). Their site plan. Billing:
 * payment schedule, invoices, payments, receipts, balance. Their signed
 * contract and warranty certificate. Never in the portal: pull sheets,
 * material lists, costs, internal notes, internal or crew photos, crew
 * packet, follow ups, call logs."
 *
 * Every answer a portal login gets is built here, or in routes/portal.ts, from
 * an explicit list of fields: never a database row as it is. A field that is
 * not named below does not leave the server.
 *
 *   billingOf     the payment schedule of each of the customer's jobs: the
 *                 contract (as signed, change orders, other changes), each
 *                 invoice with what is paid and due, each payment with its
 *                 receipt link (/p/r/<link>), the balance. Never the office's
 *                 billing log, who recorded a payment, a check's photo, a
 *                 payment's note or why an amount was changed.
 *   papersOf      the signed contracts (the customer's own signed quotes) and
 *                 the warranty certificates (their jobs' finished walkthroughs).
 *   quoteRowOf    a quote as the customer was sent it: the fence's plain name,
 *                 the price, the date, the status, the proposal link and
 *                 whether it has a site plan. Never its pull sheet, costs,
 *                 margin, pricing, layout, notes or the proposal's options.
 */

import prisma from './prisma.js'
import { plainStyleName } from './estimates.js'
import { applyPayments, methodText } from './paymentMath.js'
import { contractParts, dayWords } from './contractBilling.js'
import { nyDay } from './warranties.js'

/**
 * The day a warranty certificate says the job was completed: the job's own
 * completed date (as the certificate PDF uses it), else the walkthrough's
 * finish in Florida time. Never the UTC date: a walkthrough finished after
 * 8 pm in Florida is already the next day in UTC (Oct 24, 2026 walkthrough).
 */
export function certificateDay(completedDate: string | null | undefined, completedAt: Date | null | undefined): string {
  if (completedDate && /^\d{4}-\d{2}-\d{2}$/.test(completedDate)) return completedDate
  return completedAt ? nyDay(completedAt) : (completedDate ?? '')
}
import { safeSvg } from '../routes/proposal.js'
import { signedForPortal } from './signedDocuments.js'

/** The customer's own quotes (not deleted or archived), by their customer id and company. */
export async function quotesOf(contact: { id: string; accountId: string | null }) {
  if (!contact.accountId) return []
  return prisma.savedQuote.findMany({
    where: { accountId: contact.accountId, crmContactId: contact.id, deletedAt: null, archivedAt: null },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
    select: {
      id: true, fenceStyle: true, date: true, finalPrice: true, status: true, proposal: true, chosenOption: true, acceptedAt: true, soldAt: true,
      shareToken: true, shareDisabledAt: true, shareExpiresAt: true,
    },
  })
}

/** The customer's own jobs: theirs by id, or made from one of their quotes. */
export async function jobsOf(contact: { id: string; accountId: string | null }) {
  if (!contact.accountId) return []
  const quotes = await prisma.savedQuote.findMany({ where: { accountId: contact.accountId, crmContactId: contact.id, deletedAt: null }, select: { id: true } })
  return prisma.savedJob.findMany({
    where: { accountId: contact.accountId, deletedAt: null, archivedAt: null, OR: [{ crmContactId: contact.id }, ...(quotes.length ? [{ quoteId: { in: quotes.map(q => q.id) } }] : [])] },
    orderBy: { createdAt: 'desc' },
    select: { id: true, quoteId: true, fenceStyle: true, status: true, scheduledDate: true, customerAddress: true, completedDate: true, locatesDate: true, materialsStatus: true },
  })
}

type QuoteRow = Awaited<ReturnType<typeof quotesOf>>[number]

/** The proposal's site plan, drawn for the customer when the proposal was saved (only our own drawing: routes/proposal.ts safeSvg). */
export const planOf = (q: { proposal: unknown }) => safeSvg((q.proposal as any)?.planSvg)

export const isSigned = (q: { status: string; acceptedAt: Date | null; soldAt: Date | null }) => !!(q.acceptedAt || q.soldAt || q.status === 'SOLD')

/** A quote as the customer was sent it. */
export async function quoteRowOf(q: QuoteRow, now = Date.now()) {
  const p = q.proposal as any
  const signed = isSigned(q)
  return {
    id: q.id, style: await plainStyleName(q.fenceStyle), date: q.date, status: q.status,
    priceCents: Math.round((q.finalPrice || 0) * 100),
    // The customer's own proposal link, when the office made one and it still works.
    shareToken: q.shareToken && !q.shareDisabledAt && (!q.shareExpiresAt || q.shareExpiresAt.getTime() > now) ? q.shareToken : null,
    hasPlan: !!planOf(q),
    hasContract: signed && !!p && Array.isArray(p.options) && p.options.length > 0,
  }
}

/**
 * The signed contracts and the warranty certificates of the customer.
 * `signed`: the stored signed PDFs (contracts and change orders, as signed:
 * lib/signedDocuments.ts signedForPortal, its own field list). `contracts`:
 * the contract made fresh (with the install date) for each signed quote; a
 * quote with a stored signed contract is marked `stored`.
 */
export async function papersOf(contact: { id: string; accountId: string | null }) {
  const signed = await signedForPortal(contact.id)
  const quotes = (await quotesOf(contact)).filter(q => isSigned(q))
  const contracts = []
  for (const q of quotes) {
    const row = await quoteRowOf(q)
    if (row.hasContract) contracts.push({ quoteId: q.id, style: row.style, signedOn: ((d) => (d ? nyDay(d) : q.date))(q.acceptedAt ?? q.soldAt), url: `contracts/${q.id}.pdf`, stored: signed.some(d => d.kind === 'contract' && d.quoteId === q.id) })
  }
  const jobs = await jobsOf(contact)
  const walks = jobs.length ? await prisma.walkthrough.findMany({ where: { jobId: { in: jobs.map(j => j.id) }, status: 'completed', certificatePath: { not: null } }, select: { jobId: true, completedAt: true } }) : []
  const certificates = []
  for (const w of walks) {
    const j = jobs.find(x => x.id === w.jobId)!
    certificates.push({ jobId: j.id, style: await plainStyleName(j.fenceStyle), completedOn: certificateDay(j.completedDate, w.completedAt), url: `certificates/${j.id}.pdf` })
  }
  return { signed, contracts, certificates }
}

/** The payment schedule of each of the customer's jobs, as the customer may see it. */
export async function billingOf(contact: { id: string; accountId: string | null }) {
  if (!contact.accountId) return []
  const accountId = contact.accountId
  const jobs = await jobsOf(contact)
  if (!jobs.length) return []
  const schedules = await prisma.paymentSchedule.findMany({ where: { accountId, jobId: { in: jobs.map(j => j.id) } } })
  const out = []
  for (const s of schedules) {
    const job = jobs.find(j => j.id === s.jobId)!
    const [invoices, payments, receipts] = await Promise.all([
      prisma.contractInvoice.findMany({ where: { scheduleId: s.id, voidedAt: null }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      prisma.contractPayment.findMany({ where: { accountId, jobId: s.jobId, voidedAt: null }, orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }] }),
      prisma.receipt.findMany({ where: { accountId, jobId: s.jobId, voidedAt: null } }),
    ])
    const parts = await contractParts(prisma, accountId, s)
    const a = applyPayments(
      invoices.map(i => ({ id: i.id, amountCents: i.amountCents, sortOrder: i.sortOrder, createdAt: i.createdAt, voided: false })),
      payments.map(p => ({ id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, createdAt: p.createdAt, voided: false })),
    )
    const paid = payments.reduce((sum, p) => sum + p.amountCents, 0)
    const rByPay = new Map(receipts.map(r => [r.paymentId, r]))
    out.push({
      jobId: job.id, style: await plainStyleName(job.fenceStyle),
      signedCents: parts.signedCents, changeOrderCents: parts.changeOrderCents, otherChangesCents: parts.adjustmentCents, contractCents: parts.contractCents,
      paidCents: paid, balanceCents: parts.contractCents - paid,
      invoices: invoices.map(i => {
        const p = a.paidByInvoice.get(i.id) ?? 0
        return {
          id: i.id, label: i.label, amountCents: i.amountCents, paidCents: p, balanceCents: i.amountCents - p,
          due: i.dueOn === 'signing' ? 'Due at signing' : i.dueOn === 'completion' ? (i.dueDate ? `Due on completion (${dayWords(i.dueDate)})` : 'Due on completion') : i.dueDate ? `Due ${dayWords(i.dueDate)}` : '',
          number: i.legacyNumber ?? null,
        }
      }),
      payments: payments.map(p => {
        const r = rByPay.get(p.id)
        return {
          id: p.id, amountCents: p.amountCents, paidOn: p.paidOn, paidOnText: dayWords(p.paidOn), method: methodText(p.method, p.checkNumber, null),
          receipt: r ? { number: r.number, link: `/p/r/${r.token}`, pdf: `/p/r/${r.token}.pdf` } : null,
        }
      }),
    })
  }
  return out
}
