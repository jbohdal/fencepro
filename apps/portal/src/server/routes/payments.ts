/**
 * Payment schedules, payments and receipts at /api/payments (lib/contractBilling.ts).
 *
 *   GET   /job/:jobId                  the job's schedule (null: none yet, with whether one can be made)
 *   GET   /customer/:contactId         the customer's schedules, and their sold jobs with none yet
 *   POST  /job/:jobId/schedule         make the schedule of a signed job that has none (sold before Oct 21, 2026)
 *   POST  /                            record a payment { id, jobId, amountCents, method, checkNumber?, reference?, paidOn?,
 *                                      note?, photo?, receiptNumber?, receiptToken?, lienRelease?, email?: { to, link } }
 *                                      → { payment, receipt, schedule }; the same id again is the first one (no second email)
 *   POST  /receipt-numbers             the login's receipt numbers for no signal { count } → { numbers, made, stale }
 *                                      (its unused ones handed back; new ones only to fill the set back up)
 *   POST  /:id/email                   { to, link, once? } email the payment's receipt link (the server's email settings)
 *   POST  /:id/texted                  { to } the receipt link went to the phone's texting app (kept on the receipt)
 *   GET   /receipts/:id/pdf            the receipt PDF
 *   GET   /:id/photo                   the check's photo
 *   GET   /receivables                 every open invoice on the schedules (Billing, the Balance Sheet)
 *   GET   /received                    every payment received, not voided (P&L and Budget cash basis; owner and office)
 *   GET   /to-confirm                  payments a Salesman recorded, not confirmed yet (owner and office)
 *   POST  /:id/confirm                 confirm one (the receipt does not change)
 *   POST  /:id/void                    { reason } void a payment and its receipt
 *   PATCH /invoices/:id                { amountCents, reason } an invoice's amount (owner and admin)
 *   POST  /job/:jobId/adjustments      { amountCents, reason } a contract amount adjustment (owner and admin)
 *
 * Who: payments.record (owner, admin, manager, office, Salesman) records and
 * sends; billing.change (owner, admin, manager, office) confirms and voids;
 * billing.amounts (owner, admin) changes amounts. Every change is in the
 * audit log and the schedule's own log.
 */

import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { requireCan, roleOf, can } from '../lib/permissions.js'
import { plainZod } from '../lib/plainZod.js'
import { audit } from '../lib/auditLog.js'
import {
  scheduleView, ensureSchedule, recordPayment, reserveReceiptNumbers, emailReceipt, noteReceiptTexted, receiptPdfOf, fileReceipt,
  confirmPayment, voidPayment, editInvoiceAmount, addAdjustment, photoPath, receiptView, type Actor,
} from '../lib/contractBilling.js'
import { METHODS } from '../lib/paymentMath.js'
import { isSignedQuote } from '../lib/quoteLock.js'
import { closeOutIfDone, receivables, paymentsReceived, cardFollowsJob } from '../lib/jobTruth.js'
import { salesScopeOf } from '../lib/salesScope.js'

const router = Router()
router.use(requireUser, requireAccount)

// The Salesman (lib/salesScope.ts): a job's or customer's payments only for the Salesman's own jobs and
// customers (another's is not there: 404), and what is owed only on those.
router.use(async (req: any, res, next) => {
  const scope = await salesScopeOf(req)
  if (!scope) { next(); return }
  const m = /^\/(job|customer)\/([^/]+)/.exec(req.path)
  if (m && !(m[1] === 'job' ? scope.jobIds : scope.contactIds).has(decodeURIComponent(m[2]))) { res.status(404).json({ success: false, error: m[1] === 'job' ? 'Job not found' : 'Customer not found' }); return }
  if (req.method === 'GET' && req.path === '/receivables') {
    const json = res.json.bind(res)
    res.json = (body: any) => json(body && Array.isArray(body.data) ? { ...body, data: body.data.filter((r: any) => scope.jobIds.has(r.jobId) || (!!r.customerId && scope.contactIds.has(r.customerId))) } : body)
  }
  next()
})

async function actor(req: any): Promise<Actor> {
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  return { userId: req.user.id ?? null, name: (u ? `${u.firstName} ${u.lastName}`.trim() : '') || req.user.email || 'Staff', role: roleOf(req) }
}

const fail = (res: any, e: unknown, what: string) => {
  if (e instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(e) }); return }
  const status = (e as any)?.status
  if (status === 400 || status === 403 || status === 404 || status === 409) { res.status(status).json({ success: false, error: (e as Error).message }); return }
  console.error(`[payments] ${what}:`, e)
  res.status(500).json({ success: false, error: `Could not ${what}` })
}

/** The job's sold-ness, for "Make the payment schedule". */
async function canMakeFor(accountId: string, job: { quoteId: string | null; quotePrice: number; contractValue: number }): Promise<boolean> {
  if (!job.quoteId) return job.quotePrice > 0 || job.contractValue > 0
  const q = await prisma.savedQuote.findFirst({ where: { id: job.quoteId, accountId }, select: { status: true, acceptedAt: true, soldAt: true } })
  return isSignedQuote(q)
}

router.get('/job/:jobId', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const job = await prisma.savedJob.findFirst({ where: { id: req.params.jobId, accountId, deletedAt: null }, select: { id: true, quoteId: true, quotePrice: true, contractValue: true } })
    if (!job) { res.status(404).json({ success: false, error: 'Job not found' }); return }
    const schedule = await scheduleView(accountId, job.id)
    res.json({ success: true, data: { schedule, canMake: !schedule && await canMakeFor(accountId, job) } })
  } catch (e) { fail(res, e, 'load the payment schedule') }
})

// Accounts Receivable: every open invoice on the payment schedules, due and overdue (lib/jobTruth.ts receivables).
router.get('/receivables', async (req: any, res) => {
  try { res.json({ success: true, data: await receivables(req.user.crmAccountId) }) } catch (e) { fail(res, e, 'load what is owed') }
})

// Payments received (cash basis revenue for the P&L and the Budget: web moneyTruth.ts).
router.get('/received', requireCan('billing.change'), async (req: any, res) => {
  try { res.json({ success: true, data: await paymentsReceived(req.user.crmAccountId) }) } catch (e) { fail(res, e, 'load the payments received') }
})

router.get('/customer/:contactId', async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const jobs = await prisma.savedJob.findMany({ where: { accountId, crmContactId: req.params.contactId, deletedAt: null }, select: { id: true, quoteId: true, quotePrice: true, contractValue: true, fenceStyle: true, customerAddress: true, createdAt: true }, orderBy: { createdAt: 'desc' } })
    const schedules: any[] = []
    const without: any[] = []
    for (const j of jobs) {
      const s = await scheduleView(accountId, j.id)
      if (s) schedules.push(s)
      else if (await canMakeFor(accountId, j)) without.push({ jobId: j.id, fenceStyle: j.fenceStyle, address: j.customerAddress, contractCents: Math.round((j.contractValue || j.quotePrice || 0) * 100) })
    }
    res.json({ success: true, data: { schedules, without } })
  } catch (e) { fail(res, e, "load the customer's payments") }
})

router.post('/job/:jobId/schedule', requireCan('payments.record'), async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const by = await actor(req)
    const s = await ensureSchedule(accountId, req.params.jobId, 'button', by, { force: true })
    if (!s) { res.status(409).json({ success: false, error: 'This job has no signed contract, so it has no payment schedule yet.' }); return }
    await audit(req, 'create', 'PaymentSchedule', s.id, { newValues: s })
    res.json({ success: true, data: await scheduleView(accountId, req.params.jobId) })
  } catch (e) { fail(res, e, 'make the payment schedule') }
})

const paymentSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  jobId: z.string().min(1).max(100),
  amountCents: z.number().int().min(1).max(100_000_000),
  method: z.enum(METHODS as unknown as [string, ...string[]]),
  checkNumber: z.string().max(40).optional().nullable(),
  reference: z.string().max(200).optional().nullable(),
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  note: z.string().max(1000).optional().nullable(),
  photo: z.string().max(9_000_000).optional().nullable(),
  receiptNumber: z.number().int().positive().optional().nullable(),
  receiptToken: z.string().max(64).optional().nullable(),
  lienRelease: z.boolean().optional(),
  email: z.object({ to: z.string().max(200), link: z.string().max(500) }).optional().nullable(),
})

router.post('/', requireCan('payments.record'), async (req: any, res) => {
  try {
    const body = paymentSchema.parse(req.body)
    const accountId = req.user.crmAccountId
    const by = await actor(req)
    // A Salesman's payment is confirmed by the owner or the office; theirs need none.
    const needsConfirm = !can(roleOf(req), 'billing.change')
    const out = await recordPayment(accountId, body, by, needsConfirm)
    let email: { status: string; error?: string } | null = null
    if (out.created) {
      await audit(req, 'paid', 'ContractPayment', out.payment.id, { newValues: { ...out.payment, photoKey: out.payment.photoKey ? '(photo)' : null, receipt: out.receipt?.number } })
      if (out.receipt) await fileReceipt(out.receipt.id).catch(err => console.error('[payments] receipt to Documents:', err))
      // Asked for on the receipt screen (maybe with no signal): sent once, with the first save only.
      if (body.email?.to && out.receipt) email = await emailReceipt(accountId, out.receipt.id, body.email.to, body.email.link, by).catch(e => ({ status: 'failed', error: (e as Error).message }))
      // Paid in full with the final walkthrough signed: the job moves to Complete by itself (lib/jobTruth.ts).
      await closeOutIfDone(accountId, out.payment.jobId, 'final payment recorded')
      // Paid in full on a finished job: its card to the last Sold, work done stage (Paid & Closed).
      await cardFollowsJob(accountId, out.payment.jobId)
    }
    const receipt = out.receipt ? await prisma.receipt.findUnique({ where: { id: out.receipt.id } }) : null
    res.status(out.created ? 201 : 200).json({ success: true, data: { payment: out.payment, receipt: receipt ? receiptView(receipt) : null, email, again: !out.created, schedule: await scheduleView(accountId, out.payment.jobId) } })
  } catch (e) { fail(res, e, 'record the payment') }
})

router.post('/receipt-numbers', requireCan('payments.record'), async (req: any, res) => {
  try {
    const count = Number(req.body?.count) || 5
    // The login's unused numbers handed back as they are; new ones only to fill the set back up (lib/contractBilling.ts).
    res.json({ success: true, data: await reserveReceiptNumbers(req.user.crmAccountId, req.user.id, count) })
  } catch (e) { fail(res, e, 'set receipt numbers aside') }
})

// By payment id: the phone asks for it from the receipt screen, also with no signal (it waits in the outbox
// behind the payment). `once`: a resend of that same request does not email twice.
router.post('/:id/email', requireCan('payments.record'), async (req: any, res) => {
  try {
    const body = z.object({ to: z.string().max(200), link: z.string().max(500), once: z.boolean().optional() }).parse(req.body)
    const r = await prisma.receipt.findUnique({ where: { paymentId: req.params.id } })
    if (!r || r.accountId !== req.user.crmAccountId) { res.status(404).json({ success: false, error: 'Receipt not found' }); return }
    if (body.once && r.emailTo === body.to.trim() && r.emailStatus) { res.json({ success: true, data: { status: r.emailStatus, again: true } }); return }
    const out = await emailReceipt(req.user.crmAccountId, r.id, body.to, body.link, await actor(req))
    await audit(req, 'sent', 'Receipt', r.id, { newValues: { email: body.to, status: out.status } })
    res.json({ success: true, data: out })
  } catch (e) { fail(res, e, 'email the receipt') }
})

router.post('/:id/texted', requireCan('payments.record'), async (req: any, res) => {
  try {
    const r = await prisma.receipt.findUnique({ where: { paymentId: req.params.id } })
    if (!r || r.accountId !== req.user.crmAccountId) { res.status(404).json({ success: false, error: 'Receipt not found' }); return }
    await noteReceiptTexted(req.user.crmAccountId, r.id, String(req.body?.to ?? ''), await actor(req))
    res.json({ success: true })
  } catch (e) { fail(res, e, 'note the text') }
})

router.get('/receipts/:id/pdf', async (req: any, res) => {
  try {
    const r = await prisma.receipt.findUnique({ where: { id: req.params.id } })
    if (!r || r.accountId !== req.user.crmAccountId) { res.status(404).json({ success: false, error: 'Receipt not found' }); return }
    const pdf = await receiptPdfOf(r)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="receipt-${r.number}.pdf"`)
    res.send(pdf)
  } catch (e) { fail(res, e, 'make the receipt PDF') }
})

router.get('/to-confirm', requireCan('billing.change'), async (req: any, res) => {
  try {
    const accountId = req.user.crmAccountId
    const rows = await prisma.contractPayment.findMany({ where: { accountId, needsConfirm: true, confirmedAt: null, voidedAt: null }, orderBy: { createdAt: 'asc' } })
    const receipts = await prisma.receipt.findMany({ where: { paymentId: { in: rows.map(r => r.id) } } })
    // all rows: the names of the jobs these payments are on, deleted or not (a payment on it still needs confirming).
    const jobs = await prisma.savedJob.findMany({ where: { id: { in: rows.map(r => r.jobId) } }, select: { id: true, customerName: true, customerAddress: true } })
    const rBy = new Map(receipts.map(r => [r.paymentId, r]))
    const jBy = new Map(jobs.map(j => [j.id, j]))
    res.json({
      success: true,
      data: rows.map(p => ({
        id: p.id, jobId: p.jobId, customerId: p.crmContactId, customerName: jBy.get(p.jobId)?.customerName ?? '', address: jBy.get(p.jobId)?.customerAddress ?? '',
        amountCents: p.amountCents, method: p.method, checkNumber: p.checkNumber, reference: p.reference, paidOn: p.paidOn, recordedBy: p.recordedBy, hasPhoto: !!p.photoKey,
        createdAt: p.createdAt, receipt: rBy.get(p.id) ? receiptView(rBy.get(p.id)) : null,
      })),
    })
  } catch (e) { fail(res, e, 'load the payments to confirm') }
})

router.get('/:id/photo', async (req: any, res) => {
  try {
    const p = await prisma.contractPayment.findUnique({ where: { id: req.params.id }, select: { accountId: true, photoKey: true } })
    const file = p && p.accountId === req.user.crmAccountId && p.photoKey ? photoPath(p.photoKey) : null
    if (!file) { res.status(404).json({ success: false, error: 'No photo' }); return }
    res.sendFile(file)
  } catch (e) { fail(res, e, 'open the photo') }
})

router.post('/:id/confirm', requireCan('billing.change'), async (req: any, res) => {
  try {
    const row = await confirmPayment(req.user.crmAccountId, req.params.id, await actor(req))
    await audit(req, 'update', 'ContractPayment', row.id, { newValues: { confirmedAt: row.confirmedAt, confirmedBy: row.confirmedBy } })
    res.json({ success: true, data: { payment: row, schedule: await scheduleView(req.user.crmAccountId, row.jobId) } })
  } catch (e) { fail(res, e, 'confirm the payment') }
})

router.post('/:id/void', requireCan('billing.change'), async (req: any, res) => {
  try {
    const reason = String(req.body?.reason ?? '')
    const out = await voidPayment(req.user.crmAccountId, req.params.id, reason, await actor(req))
    await audit(req, 'voided', 'ContractPayment', out.payment.id, { newValues: { voidedAt: out.payment.voidedAt, reason, receipt: out.receipt?.number ?? null } })
    if (out.receipt) await audit(req, 'voided', 'Receipt', out.receipt.id, { newValues: { number: out.receipt.number, reason } })
    res.json({ success: true, data: { payment: out.payment, schedule: await scheduleView(req.user.crmAccountId, out.payment.jobId) } })
  } catch (e) { fail(res, e, 'void the payment') }
})

router.patch('/invoices/:id', requireCan('billing.amounts'), async (req: any, res) => {
  try {
    const body = z.object({ amountCents: z.number().int().min(0).max(100_000_000), reason: z.string().max(500) }).parse(req.body)
    const before = await prisma.contractInvoice.findUnique({ where: { id: req.params.id } })
    const row = await editInvoiceAmount(req.user.crmAccountId, req.params.id, body.amountCents, body.reason, await actor(req))
    await audit(req, 'update', 'ContractInvoice', row.id, { oldValues: { amountCents: before?.amountCents }, newValues: { amountCents: row.amountCents, reason: body.reason } })
    res.json({ success: true, data: await scheduleView(req.user.crmAccountId, row.jobId) })
  } catch (e) { fail(res, e, 'change the amount') }
})

router.post('/job/:jobId/adjustments', requireCan('billing.amounts'), async (req: any, res) => {
  try {
    const body = z.object({ amountCents: z.number().int().min(-100_000_000).max(100_000_000), reason: z.string().max(500) }).parse(req.body)
    const row = await addAdjustment(req.user.crmAccountId, req.params.jobId, body.amountCents, body.reason, await actor(req))
    await audit(req, 'create', 'ContractAdjustment', row.id, { newValues: row })
    // A credit that leaves it paid in full closes it out like a payment does.
    await closeOutIfDone(req.user.crmAccountId, req.params.jobId, 'contract adjusted to what was paid')
    res.json({ success: true, data: await scheduleView(req.user.crmAccountId, req.params.jobId) })
  } catch (e) { fail(res, e, 'adjust the contract amount') }
})

export default router
