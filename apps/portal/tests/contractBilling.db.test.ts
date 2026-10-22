/**
 * Payment schedules, payments and receipts (dev database, DEV_DB=1; refuses any other).
 *
 * - A job for a signed quote gets its schedule from the contract: $8,914.27 at
 *   50% is a $4,457.14 deposit and a $4,457.13 final, to the cent; the
 *   proposal's own deposit percent when it has one.
 * - Payments of any amount: oldest open invoice first, the rest carried; a
 *   short payment leaves a balance; over pays to a credit. The invoice's own
 *   amount never moves with a payment.
 * - The same payment sent twice (the phone resending) is one payment and one
 *   receipt. Receipt numbers set aside at the same moment never repeat.
 * - An approved change order moves the Final (logged); an owner's amount edit
 *   and contract adjustment are logged; a Salesman may not edit amounts, may
 *   record a payment (it waits to be confirmed; confirming leaves the receipt
 *   as it was); voiding a payment voids its receipt.
 * - The receipt link /p/r/<token> and its PDF, with no sign in.
 * - The one-time step for invoices typed in Billing, on a copy of Kristi
 *   Murphy's: her hand-made $4,457.00 deposit stays $4,457.00 with her check
 *   applied, the Final is the contract less that, never paid in full; a -27
 *   cent adjustment takes the Final to $4,457.00; running it again changes
 *   nothing and records no second payment. A hand-made invoice that is not a
 *   deposit: no automatic deposit, the Final is what is left.
 *
 * Writes only inside beforeAll, test and afterAll; removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { pdfText } from './pdfText'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('payment schedules, payments and receipts (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: payments } = await import('../src/server/routes/payments.js')
  const { default: savedJobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: changeOrders } = await import('../src/server/routes/change-orders.js')
  const { receiptPublic } = await import('../src/server/routes/receiptPublic.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const billing = await import('../src/server/lib/contractBilling.js')
  const { adoptHandMadeBilling, adoptIn } = await import('../src/server/lib/billingAdoption.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const made = { contacts: [] as string[], quotes: [] as string[], jobs: [] as string[], accounts: [] as string[], payments: [] as string[] }
  let accountId = '', ownerId = '', owner = '', sales = '', base = ''
  let server: ReturnType<express.Express['listen']>
  const call = (who: string, method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, type: r.headers.get('content-type') || '', buf: Buffer.from(await r.arrayBuffer()) }))
    .then(r => ({ ...r, json: r.type.includes('json') ? JSON.parse(r.buf.toString('utf8')) : null, text: r.type.includes('html') || r.type.includes('text') ? r.buf.toString('utf8') : '' }))
  let n = 0
  const pid = () => `e2epay${Date.now().toString(36)}${(n++).toString(36)}`

  async function soldJob(price: number, proposal: unknown = null, viaRoute = true) {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'E2E Pay', lastName: `Customer ${n++}`, phone: '3525550100', email: 'e2e-pay@example.invalid' } as any })
    made.contacts.push(c.id)
    const q = await prisma.savedQuote.create({ data: { accountId, crmContactId: c.id, customerName: `E2E Pay ${c.lastName}`, customerAddress: '1 Test Ln, Ocala FL', fenceStyle: "WV-ND 6'x8' Privacy", runs: [80], pullSheet: [], finalPrice: price, status: 'SOLD', soldAt: new Date(), proposal: proposal as any } as any })
    made.quotes.push(q.id)
    if (viaRoute) {
      const r = await call(owner, 'POST', '/api/saved-jobs', { quoteId: q.id, crmContactId: c.id, customerName: q.customerName, customerAddress: q.customerAddress, fenceStyle: q.fenceStyle, quotePrice: price, contractValue: price, status: 'staging' })
      expect(r.status).toBe(201)
      made.jobs.push(r.json.data.id)
      return { contactId: c.id, quoteId: q.id, jobId: r.json.data.id as string }
    }
    const j = await prisma.savedJob.create({ data: { accountId, quoteId: q.id, crmContactId: c.id, customerName: q.customerName, customerAddress: q.customerAddress, quotePrice: price, contractValue: price } as any })
    made.jobs.push(j.id)
    return { contactId: c.id, quoteId: q.id, jobId: j.id }
  }
  const view = async (jobId: string) => (await call(owner, 'GET', `/api/payments/job/${jobId}`)).json.data.schedule
  const byKind = (s: any, kind: string) => s.invoices.find((i: any) => i.kind === kind)
  const pay = async (who: string, jobId: string, amountCents: number, extra: Record<string, unknown> = {}) => {
    const id = pid()
    made.payments.push(id)
    const r = await call(who, 'POST', '/api/payments', { id, jobId, amountCents, method: 'check', checkNumber: '1042', ...extra })
    return { id, r }
  }

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    ownerId = user.id
    // Schedules began before this run's sales, as on live after the deploy.
    await billing.schedulesFrom(accountId)
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    sales = jwt.sign({ sub: user.id, email: user.email, role: 'sales_rep', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/payments', payments)
    app.use('/api/saved-jobs', savedJobs)
    app.use('/api/change-orders', changeOrders)
    app.use('/p/r', receiptPublic)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    const jobs = made.jobs
    const receipts = await prisma.receipt.findMany({ where: { jobId: { in: jobs } } })
    const files = await prisma.portalFile.findMany({ where: { id: { in: receipts.map(r => r.portalFileId).filter((x): x is string => !!x) } } })
    const pays = await prisma.contractPayment.findMany({ where: { jobId: { in: jobs } } })
    for (const f of [...files.map(f => f.fileKey), ...pays.map(p => p.photoKey).filter((x): x is string => !!x)]) { try { fs.unlinkSync(path.resolve(process.env.UPLOAD_DIR || './uploads', f)) } catch { /* not written */ } }
    await prisma.portalFile.deleteMany({ where: { id: { in: files.map(f => f.id) } } })
    await prisma.receipt.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.paymentApplication.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } })
    await prisma.contractPayment.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.contractInvoice.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.contractAdjustment.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.billingLog.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.paymentSchedule.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...jobs, ...pays.map(p => p.id), ...receipts.map(r => r.id)] } } })
    await prisma.changeOrder.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.jobChecklistItem.deleteMany({ where: { jobId: { in: jobs } } }).catch(() => {})
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: jobs } } as any }).catch(() => {})
    await prisma.savedJob.deleteMany({ where: { id: { in: jobs } } })
    await prisma.jobQuotedCost.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: made.contacts } } })
    for (const a of made.accounts) {
      await prisma.receiptCounter.deleteMany({ where: { accountId: a } })
      await prisma.receiptNumberBlock.deleteMany({ where: { accountId: a } })
      await prisma.accountKeyValue.deleteMany({ where: { accountId: a } })
      await prisma.businessState.deleteMany({ where: { accountId: a } })
      await prisma.crmAccount.deleteMany({ where: { id: a } })
    }
    await prisma.receiptNumberBlock.deleteMany({ where: { accountId, userId: ownerId, createdAt: { gte: new Date(Date.now() - 3600_000) } } })
    server?.close()
  })

  test('$8,914.27 sold at 50%: deposit $4,457.14 + final $4,457.13, due at signing and on completion', async () => {
    const { jobId } = await soldJob(8914.27)
    const s = await view(jobId)
    expect(s.signedCents).toBe(891427)
    expect(byKind(s, 'deposit').amountCents).toBe(445714)
    expect(byKind(s, 'final').amountCents).toBe(445713)
    expect(byKind(s, 'deposit').amountCents + byKind(s, 'final').amountCents).toBe(891427)
    expect(byKind(s, 'deposit').dueOn).toBe('signing')
    expect(byKind(s, 'final').dueOn).toBe('completion')
    expect(byKind(s, 'final').dueDate).toBeNull()
    expect(s.invoices.every((i: any) => i.contractCents === 891427)).toBe(true)
    // Marked installed: the Final is due on the install date.
    await call(owner, 'PATCH', `/api/saved-jobs/${jobId}`, { completedDate: '2026-10-30' })
    expect(byKind(await view(jobId), 'final').dueDate).toBe('2026-10-30')
  })

  test('a job sold before schedules began gets none when it is saved (the JobNimbus history is not shown as due)', async () => {
    const { quoteId, jobId } = await soldJob(5000, null, false)
    await prisma.savedQuote.update({ where: { id: quoteId }, data: { soldAt: new Date('2025-06-01T12:00:00Z') } })
    await billing.afterJobSaved(accountId, jobId, { userId: ownerId, name: 'test' } as any)
    expect(await prisma.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId } } })).toBeNull()
  })

  test("the proposal's own deposit percent", async () => {
    const { jobId } = await soldJob(3333.33, { depositPct: 30, options: [{ finalPrice: 3333.33 }] })
    const s = await view(jobId)
    expect(byKind(s, 'deposit').amountCents).toBe(100000)
    expect(byKind(s, 'final').amountCents).toBe(233333)
  })

  test('oldest first with carry; short and over; repeat create is one payment, one receipt; the invoice amount never moves', async () => {
    const { jobId } = await soldJob(8914.27)
    const a = await pay(owner, jobId, 400000)
    expect(a.r.status).toBe(201)
    const rec = a.r.json.data.receipt
    expect(rec.number).toBeGreaterThan(1000)
    expect(rec.says.balanceCents).toBe(491427)
    expect(rec.says.forText).toBe('Deposit')
    // Sent again (the answer was lost): the same payment and receipt.
    const again = await call(owner, 'POST', '/api/payments', { id: a.id, jobId, amountCents: 400000, method: 'check', checkNumber: '1042' })
    expect(again.status).toBe(200)
    expect(again.json.data.receipt.number).toBe(rec.number)
    expect(await prisma.contractPayment.count({ where: { jobId } })).toBe(1)
    expect(await prisma.receipt.count({ where: { jobId } })).toBe(1)
    const b = await pay(owner, jobId, 500000, { method: 'zelle', checkNumber: null })
    // 500,000 more: 45,714 finishes the deposit, 445,713 pays the final, 8,573 is over (a credit).
    expect(b.r.json.data.receipt.says.forItems).toEqual([{ label: 'Deposit', cents: 45714 }, { label: 'Final payment', cents: 445713 }, { label: 'Credit (over the balance)', cents: 8573 }])
    const s = await view(jobId)
    expect(byKind(s, 'deposit').amountCents).toBe(445714)
    expect(byKind(s, 'deposit').balanceCents).toBe(0)
    expect(byKind(s, 'final').amountCents).toBe(445713)
    expect(s.creditCents).toBe(900000 - 891427)
    expect(s.balanceCents).toBe(891427 - 900000)
    expect(b.r.json.data.receipt.says.paidInFull).toBe(true)
    // The job's paid figures follow.
    const job = await prisma.savedJob.findUnique({ where: { id: jobId } })
    expect(job!.amountPaid).toBe(9000)
    expect(job!.paymentStatus).toBe('paid')
  })

  test('a login keeps its set aside numbers: 10 sign ins make no new numbers; an online receipt takes the next number in sequence', async () => {
    // Numbers left set aside for this login by earlier runs on the dev copy would be handed back first.
    await prisma.receiptNumberBlock.deleteMany({ where: { accountId, userId: ownerId } })
    const first = await billing.reserveReceiptNumbers(accountId, ownerId, 5)
    expect(first.numbers).toHaveLength(5)
    for (let i = 0; i < 10; i++) {
      const again = await billing.reserveReceiptNumbers(accountId, ownerId, 5)
      expect(again.made).toBe(0)
      expect(again.numbers).toEqual(first.numbers)
    }
    // Online: the next company number, not one set aside.
    const next = (await prisma.receiptCounter.findUnique({ where: { accountId } }))!.next
    const { jobId } = await soldJob(1000)
    const online = await pay(owner, jobId, 1000)
    expect(online.r.json.data.receipt.number).toBe(next)
    expect(first.numbers).not.toContain(next)
    // No signal: one set aside is used as is; the next top up fills the set back with exactly one new number.
    const mine = first.numbers[0]
    const c = await pay(owner, jobId, 1000, { receiptNumber: mine })
    expect(c.r.json.data.receipt.number).toBe(mine)
    const refill = await billing.reserveReceiptNumbers(accountId, ownerId, 5)
    expect(refill.made).toBe(1)
    expect(refill.numbers.slice(0, 4)).toEqual(first.numbers.slice(1))
    expect(refill.numbers[4]).toBe(next + 1)
    // The same number twice (two phones of one login): the second gets the next company number, never a repeat.
    const d = await pay(owner, jobId, 1000, { receiptNumber: mine })
    expect(d.r.json.data.receipt.number).toBe(next + 2)
    // Not this login's: refused as a number, the next one given.
    const e = await pay(owner, jobId, 1000, { receiptNumber: 1 })
    expect(e.r.json.data.receipt.number).toBe(next + 3)
    const f = await pay(sales, jobId, 1000, { receiptNumber: refill.numbers[1] })
    expect(f.r.json.data.receipt.number).toBe(refill.numbers[1]) // the Salesman token here is the same login (role only differs)
  })

  test('other logins at the same moment never share a number; numbers unused 30 days go back to the same login only', async () => {
    const users = Array.from({ length: 8 }, (_, i) => `e2e-receipt-user-${i}`)
    const sets = await Promise.all(users.map(u => billing.reserveReceiptNumbers(accountId, u, 5)))
    const all = sets.flatMap(x => x.numbers)
    expect(new Set(all).size).toBe(40)
    // Payments at once, online: all different, none of the set aside ones.
    const { jobId } = await soldJob(1000)
    const outs = await Promise.all(Array.from({ length: 6 }, () => pay(owner, jobId, 1000)))
    const nums = outs.map(o => o.r.json.data.receipt.number)
    expect(new Set(nums).size).toBe(6)
    for (const x of nums) expect(all).not.toContain(x)
    // 40 days unused: handed back to that login first, never to another.
    await prisma.receiptNumberBlock.updateMany({ where: { accountId, userId: users[0] }, data: { createdAt: new Date(Date.now() - 40 * 86_400_000) } })
    const back = await billing.reserveReceiptNumbers(accountId, users[0], 5)
    expect(back).toMatchObject({ numbers: sets[0].numbers, made: 0, stale: 5 })
    const other = await billing.reserveReceiptNumbers(accountId, users[1], 5)
    for (const x of sets[0].numbers) expect(other.numbers).not.toContain(x)
    await prisma.receiptNumberBlock.deleteMany({ where: { accountId, userId: { in: users } } })
  })

  test('an approved change order moves the Final, logged; owner amount edit and adjustment are logged; a Salesman may not', async () => {
    const { jobId, quoteId } = await soldJob(5000)
    const co = await call(owner, 'POST', '/api/change-orders', { quoteId, reason: 'Add a gate', lines: [{ id: 'l1', description: 'Walk gate', amountCents: 50000 }], status: 'approved' })
    expect(co.status).toBeLessThan(300)
    let s = await view(jobId)
    expect(s.contractCents).toBe(550000)
    expect(byKind(s, 'final').amountCents).toBe(300000)
    expect(byKind(s, 'final').originalCents).toBe(250000)
    expect(s.log.some((l: any) => l.kind === 'final_follows' && /\$2,500\.00 → \$3,000\.00/.test(l.text))).toBe(true)
    // Salesman: no amount edits.
    expect((await call(sales, 'PATCH', `/api/payments/invoices/${byKind(s, 'deposit').id}`, { amountCents: 100000, reason: 'x' })).status).toBe(403)
    expect((await call(sales, 'POST', `/api/payments/job/${jobId}/adjustments`, { amountCents: -27, reason: 'x' })).status).toBe(403)
    // Owner: the deposit to $2,000.00 (the Final follows), then -27 cents on the contract.
    expect((await call(owner, 'PATCH', `/api/payments/invoices/${byKind(s, 'final').id}`, { amountCents: 1, reason: 'x' })).status).toBe(409)
    const e = await call(owner, 'PATCH', `/api/payments/invoices/${byKind(s, 'deposit').id}`, { amountCents: 200000, reason: 'Customer asked for a smaller deposit' })
    expect(e.status).toBe(200)
    s = e.json.data
    expect(byKind(s, 'deposit').amountCents).toBe(200000)
    expect(byKind(s, 'deposit').originalCents).toBe(250000)
    expect(byKind(s, 'final').amountCents).toBe(350000)
    const adj = await call(owner, 'POST', `/api/payments/job/${jobId}/adjustments`, { amountCents: -27, reason: 'Round to the dollar' })
    s = adj.json.data
    expect(s.contractCents).toBe(549973)
    expect(s.signedCents).toBe(500000)
    expect(byKind(s, 'final').amountCents).toBe(349973)
    expect(s.log.map((l: any) => l.kind)).toEqual(expect.arrayContaining(['amount_edit', 'adjustment', 'final_follows']))
    expect(await prisma.crmAuditLog.count({ where: { entityType: { in: ['ContractInvoice', 'ContractAdjustment'] }, entityId: { in: [byKind(s, 'deposit').id, s.adjustments[0].id] } } })).toBe(2)
  })

  test("a Salesman's payment waits to be confirmed; confirming leaves the receipt; voiding voids the receipt; the link and PDF", async () => {
    const { jobId } = await soldJob(2000)
    const a = await pay(sales, jobId, 100000, { photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==' })
    expect(a.r.status).toBe(201)
    const rec = a.r.json.data.receipt
    // A Salesman's phone gets answers with every cost field taken out (lib/costRedact.ts): the receipt's words stay.
    const { redactCosts } = await import('../src/server/lib/costRedact.js')
    expect((redactCosts(a.r.json) as any).data.receipt.says.amountCents).toBe(100000)
    const list = await call(owner, 'GET', '/api/payments/to-confirm')
    expect(list.json.data.some((p: any) => p.id === a.id && p.hasPhoto)).toBe(true)
    expect((await call(sales, 'POST', `/api/payments/${a.id}/confirm`)).status).toBe(403)
    expect((await call(owner, 'POST', `/api/payments/${a.id}/confirm`)).status).toBe(200)
    const after = await prisma.receipt.findUnique({ where: { id: rec.id } })
    expect(after!.snapshot).toEqual(rec.says)
    expect(after!.number).toBe(rec.number)
    expect((await call(owner, 'GET', '/api/payments/to-confirm')).json.data.some((p: any) => p.id === a.id)).toBe(false)
    expect((await call(owner, 'GET', `/api/payments/${a.id}/photo`)).status).toBe(200)
    // In the customer's Documents, visible to them.
    const file = await prisma.portalFile.findUnique({ where: { id: after!.portalFileId! } })
    expect(file).toMatchObject({ isVisibleToCustomer: true, mimeType: 'application/pdf' })
    // The link with no sign in, and the PDF.
    const page = await call('', 'GET', `/p/r/${rec.token}`)
    expect(page.status).toBe(200)
    expect(page.text).toContain('$1,000.00')
    const pdf = await call('', 'GET', `/p/r/${rec.token}.pdf`)
    expect(pdf.type).toContain('application/pdf')
    const words = pdfText(pdf.buf)
    expect(words).toContain(`Receipt ${rec.number}`)
    expect(words).toContain('Check #1042')
    expect(words).toContain('$2,000.00')
    expect(words).toContain('Balance remaining')
    // Email: the dev copy has no email settings, so it says so and sends nothing.
    const em = await call(owner, 'POST', `/api/payments/${a.id}/email`, { to: 'e2e-pay@example.invalid', link: `http://localhost:4001/p/r/${rec.token}` })
    expect(em.json.data.status).toBe('not_configured')
    // Void: Salesman no; owner yes, the receipt says VOID.
    expect((await call(sales, 'POST', `/api/payments/${a.id}/void`, { reason: 'x' })).status).toBe(403)
    expect((await call(owner, 'POST', `/api/payments/${a.id}/void`, { reason: '' })).status).toBe(400)
    const v = await call(owner, 'POST', `/api/payments/${a.id}/void`, { reason: 'Check bounced' })
    expect(v.status).toBe(200)
    expect(v.json.data.schedule.paidCents).toBe(0)
    expect((await prisma.receipt.findUnique({ where: { id: rec.id } }))!.voidedAt).not.toBeNull()
    expect((await call('', 'GET', `/p/r/${rec.token}`)).text).toContain('VOID')
    expect(pdfText((await call('', 'GET', `/p/r/${rec.token}.pdf`)).buf)).toContain('VOID')
    expect(await prisma.crmAuditLog.count({ where: { action: 'voided', entityId: { in: [a.id, rec.id] } } })).toBe(2)
  })

  test("the one-time step on a copy of Kristi Murphy's hand-made deposit: kept at its own amount, final = contract less it, no second payment", async () => {
    const acct = await prisma.crmAccount.create({ data: { name: 'E2E Billing Adoption' } })
    made.accounts.push(acct.id)
    const kristi = await prisma.crmContact.create({ data: { accountId: acct.id, firstName: 'E2E Kristi', lastName: 'Murphy' } as any })
    made.contacts.push(kristi.id)
    const q = await prisma.savedQuote.create({ data: { accountId: acct.id, crmContactId: kristi.id, customerName: 'E2E Kristi Murphy', fenceStyle: "WV-ND 6'x8' Privacy", runs: [100], pullSheet: [], finalPrice: 8914.27, status: 'SOLD', soldAt: new Date() } as any })
    made.quotes.push(q.id)
    const job = await prisma.savedJob.create({ data: { accountId: acct.id, quoteId: q.id, crmContactId: kristi.id, customerName: 'E2E Kristi Murphy', quotePrice: 8914.27, contractValue: 8914.27 } as any })
    made.jobs.push(job.id)
    // A second customer: a hand-made invoice that is not a deposit.
    const other = await prisma.crmContact.create({ data: { accountId: acct.id, firstName: 'E2E Other', lastName: 'Customer' } as any })
    made.contacts.push(other.id)
    const q2 = await prisma.savedQuote.create({ data: { accountId: acct.id, crmContactId: other.id, customerName: 'E2E Other', fenceStyle: 'CL', runs: [50], pullSheet: [], finalPrice: 3000, status: 'SOLD', soldAt: new Date() } as any })
    made.quotes.push(q2.id)
    const job2 = await prisma.savedJob.create({ data: { accountId: acct.id, quoteId: q2.id, crmContactId: other.id, customerName: 'E2E Other', quotePrice: 3000, contractValue: 3000 } as any })
    made.jobs.push(job2.id)
    // A customer with no job: left as it is.
    const nojob = await prisma.crmContact.create({ data: { accountId: acct.id, firstName: 'E2E No', lastName: 'Job' } as any })
    made.contacts.push(nojob.id)
    const invoices = [
      { id: 'k1001', customerId: kristi.id, customerName: 'Kristi Murphy', invoiceNumber: 'INV-1001', title: 'Deposit', status: 'paid', lineItems: [{ description: 'Deposit', quantity: 1, unitPriceCents: 445700, totalCents: 445700 }], totalCents: 445700, amountPaidCents: 445700, balanceDueCents: 0, createdAt: '2026-10-21T15:00:00.000Z' },
      { id: 'o1002', customerId: other.id, invoiceNumber: 'INV-1002', title: 'Materials', status: 'sent', lineItems: [], totalCents: 100000, amountPaidCents: 0, createdAt: '2026-10-21T15:00:00.000Z' },
      { id: 'n1003', customerId: nojob.id, invoiceNumber: 'INV-1003', title: 'Deposit', status: 'sent', lineItems: [], totalCents: 5000, amountPaidCents: 0, createdAt: '2026-10-21T15:00:00.000Z' },
    ]
    const pays = [{ id: 'kp1', invoiceId: 'k1001', invoiceNumber: 'INV-1001', customerId: kristi.id, amountCents: 445700, paymentMethod: 'check', referenceNumber: 'Cashiers check', paymentDate: '2026-10-21', recordedBy: 'Jonathan', notes: '', createdAt: '2026-10-21T15:01:00.000Z' }]
    await prisma.businessState.create({ data: { accountId: acct.id, invoices: invoices as any, payments: pays as any } })

    const out = await adoptHandMadeBilling(acct.id)
    expect(out).toMatchObject({ invoices: 2, payments: 1, jobs: 2 })
    expect(out!.skipped).toEqual([{ number: 'INV-1003', why: 'the customer has no sold job' }])
    // Never sent, no receipt made.
    expect(await prisma.receipt.count({ where: { jobId: { in: [job.id, job2.id] } } })).toBe(0)

    let s = await billing.scheduleView(acct.id, job.id)
    const dep = byKind(s, 'deposit'), fin = byKind(s, 'final')
    expect(dep).toMatchObject({ amountCents: 445700, paidCents: 445700, balanceCents: 0, legacyNumber: 'INV-1001' })
    expect(fin).toMatchObject({ amountCents: 891427 - 445700, paidCents: 0, balanceCents: 445727 })
    expect(s.payments).toHaveLength(1)
    expect(s.payments[0]).toMatchObject({ amountCents: 445700, method: 'check', reference: 'Cashiers check', paidOn: '2026-10-21', needsConfirm: false, source: 'adopted' })
    expect(s.balanceCents).toBe(445727)
    // The other customer's hand-made invoice: kept, no automatic deposit, the Final is what is left.
    const s2 = await billing.scheduleView(acct.id, job2.id)
    expect(s2.invoices.map((i: any) => [i.kind, i.amountCents])).toEqual([['other', 100000], ['final', 200000]])
    // The Billing entries are marked as on the schedule.
    const b = await prisma.businessState.findUnique({ where: { accountId: acct.id } })
    expect((b!.invoices as any[]).find(i => i.id === 'k1001').adoptedJobId).toBe(job.id)
    expect((b!.invoices as any[]).find(i => i.id === 'n1003').adoptedJobId).toBeUndefined()
    expect((b!.payments as any[])[0].adoptedPaymentId).toBe('adopted-kp1')

    // Once only; and taking it in again by hand records no second payment.
    expect(await adoptHandMadeBilling(acct.id)).toBeNull()
    const again = await prisma.$transaction(tx => adoptIn(tx, acct.id))
    expect(again.payments).toBe(0)
    expect(await prisma.contractPayment.count({ where: { jobId: job.id } })).toBe(1)

    // Jonathan's -27 cents (run by him on live after deploy): the contract $8,914.00, the Final $4,457.00, logged.
    await billing.addAdjustment(acct.id, job.id, -27, 'Contract rounded to $8,914.00', { userId: null, name: 'Test owner' })
    s = await billing.scheduleView(acct.id, job.id)
    expect(s.signedCents).toBe(891427)
    expect(s.contractCents).toBe(891400)
    expect(byKind(s, 'final').amountCents).toBe(445700)
    expect(s.balanceCents).toBe(445700)
    expect(s.log.some((l: any) => l.kind === 'adjustment' && /-\$0\.27/.test(l.text) && l.byName === 'Test owner')).toBe(true)
    // Never paid in full: a receipt for her check (the backfill) says $4,457.00 left.
    const r = await prisma.$transaction(tx => billing.makeReceiptIn(tx, acct.id, 'adopted-kp1'))
    expect((r.snapshot as any).paidInFull).toBe(false)
    expect((r.snapshot as any).balanceCents).toBe(445700)
    expect((r.snapshot as any).methodText).toBe('Check (Cashiers check)')
  })
})
