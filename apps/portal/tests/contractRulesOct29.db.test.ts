/**
 * Jonathan's Oct 29 2026 answers, signed for real on the dev database (DEV_DB=1; refuses any other), in a
 * company of its own made for the test (so no pipeline, bell or Settings of the dev company is touched):
 *
 *   D1  A proposal sent with cents ($5,532.39 shows $5,532) and signed on its link: the schedule bills $5,532,
 *       a $2,766 deposit and a $2,766 final; the contract (on the fly and the stored signed copy) prints the same.
 *   D2  0% and blank deposit: no deposit invoice, the Final is the whole contract; no deposit on the contract,
 *       and its Payment Terms say no deposit.
 *   #32 The signed contract says Getter Done Fence obtains the permits (Settings as saved on live had the
 *       customer get it, frozen on the sent proposal too).
 *   A sale from before the rules began (Oct 20, $7,113.83): billed and printed to the cent, its terms as signed.
 *   The job's price (review, Oct 29): a sale signed on the link, or marked Sold in the app (POST /api/saved-jobs, as
 *       an older phone sends the quote's cents), or a job whose schedule settles, reads the whole dollar the customer
 *       saw and is billed; deposit + final = the job's contract. A sale from before keeps its job price to the cent.
 *
 * Writes only inside beforeAll, test and afterAll; removes what it made.
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { pdfText } from './pdfText'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('Oct 29 2026: customers pay what they saw, deposit as asked, permits (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { acceptQuote, proposalPage, renderProposal } = await import('../src/server/routes/proposal.js')
  const billing = await import('../src/server/lib/contractBilling.js')
  const { contractForQuote, CONTRACT_SELECT } = await import('../src/server/lib/contractPdf.js')
  const { CUSTOMER_DOLLARS_KEY } = await import('../src/server/lib/customerDollars.js')
  const { default: savedJobs } = await import('../src/server/routes/saved-jobs.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')

  // Settings → Contract Templates as saved on live (Oct 29 2026).
  const PAYMENT = 'A 50% deposit is required to schedule the project. The remaining balance is due upon completion. We accept cash, check, ACH, and major credit cards.'
  const PERMIT_OLD = 'Unless noted otherwise, the customer is responsible for obtaining any required permits. If a permit is denied after materials are ordered, any non-refundable costs will be billed.'
  const SECTIONS = [
    { key: 'payment_terms', title: 'Payment Terms', body: PAYMENT, visible: true },
    { key: 'permits', title: 'Permits', body: PERMIT_OLD, visible: true },
  ]
  const FROZEN = [{ key: 'payment_terms', title: 'Payment Terms', text: PAYMENT }, { key: 'permits', title: 'Permits', text: PERMIT_OLD }]
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  let accountId = ''
  let owner = '', base = ''
  let server: ReturnType<express.Express['listen']> | null = null
  const post = (p: string, body: unknown) => fetch(base + p, { method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, json: await r.json() as any }))
  /** The job as Operations reads it, and its schedule: deposit + final must be the job's contract to the cent. */
  const jobAndBill = async (jobId: string) => {
    const job = (await prisma.savedJob.findUnique({ where: { id: jobId } }))!
    const s = await billing.scheduleView(accountId, jobId)
    return { job, s, billedCents: s.invoices.reduce((t: number, i: any) => t + i.amountCents, 0) }
  }
  const quotes: string[] = []
  const by = { userId: null, name: 'E2E test' }

  const option = (label: string, finalPrice: number) => ({ label, fenceStyle: label, finalPrice, perFoot: 0, sections: 10 })
  async function sentQuote(name: string, prices: number[], depositPct: number | undefined, extra: Record<string, unknown> = {}) {
    const proposal = { version: 1, company: { name: 'E2E Fence', phone: '' }, customer: { name, address: '1 Test Ln' }, ...(depositPct === undefined ? {} : { depositPct }), recommended: 0, options: prices.map((p, i) => option(`Style ${i}`, p)), terms: FROZEN }
    const q = await prisma.savedQuote.create({
      data: { accountId, customerName: name, customerAddress: '1 Test Ln, Ocala FL', fenceStyle: 'Style 0', runs: [80], pullSheet: [], finalPrice: prices[0], status: 'SENT', shareToken: crypto.randomBytes(12).toString('hex'), proposal: proposal as any, ...extra } as any,
    })
    quotes.push(q.id)
    return q
  }
  const sign = async (id: string, option = 0) => {
    const q = await prisma.savedQuote.findUnique({ where: { id } })
    const out = await acceptQuote(q, { option, name: 'E2E Customer', signature: SIG } as any, { ip: '203.0.113.9', userAgent: 'vitest' })
    expect(out.status).toBe(200)
    const job = await prisma.savedJob.findFirst({ where: { accountId, quoteId: id } })
    return { job: job!, view: await billing.scheduleView(accountId, job!.id) }
  }
  const kinds = (v: any) => v.invoices.map((i: any) => [i.kind, i.amountCents])
  const contractText = async (id: string) => pdfText((await contractForQuote((await prisma.savedQuote.findUnique({ where: { id }, select: CONTRACT_SELECT })) as any))!)
  const storedText = async (id: string) => {
    const d = await prisma.signedDocument.findUnique({ where: { sourceKey: `contract:${id}` } })
    return pdfText(fs.readFileSync(path.resolve(process.env.UPLOAD_DIR || './uploads', d!.fileKey)))
  }

  beforeAll(async () => {
    const acct = await prisma.crmAccount.create({ data: { name: 'E2E Oct 29 contract rules' } })
    accountId = acct.id
    await prisma.businessState.create({ data: { accountId, contractSections: SECTIONS as any } })
    // Schedules and the Oct 29 rules began a minute ago, as on live after the deploy.
    const before = new Date(Date.now() - 60_000).toISOString()
    await prisma.accountKeyValue.create({ data: { accountId, key: 'billing:schedules-from', value: before } })
    await prisma.accountKeyValue.create({ data: { accountId, key: CUSTOMER_DOLLARS_KEY, value: before } })
    // The office's phone, signed in to this test company, saving a job the way the app does (routes/saved-jobs.ts).
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '2mb' }))
    app.use('/api/saved-jobs', savedJobs)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const jobs = (await prisma.savedJob.findMany({ where: { accountId }, select: { id: true } })).map(j => j.id)
    const docs = await prisma.signedDocument.findMany({ where: { accountId } })
    for (const d of docs) { try { fs.unlinkSync(path.resolve(process.env.UPLOAD_DIR || './uploads', d.fileKey)) } catch { /* not written */ } }
    await prisma.signedDocument.deleteMany({ where: { accountId } })
    await prisma.portalFile.deleteMany({ where: { id: { in: docs.map(d => d.portalFileId).filter((x): x is string => !!x) } } })
    await prisma.contractInvoice.deleteMany({ where: { accountId } })
    await prisma.billingLog.deleteMany({ where: { accountId } })
    await prisma.paymentSchedule.deleteMany({ where: { accountId } })
    await prisma.jobChecklistItem.deleteMany({ where: { jobId: { in: jobs } } }).catch(() => {})
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: [...jobs, ...quotes] } } as any }).catch(() => {})
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...jobs, ...quotes] } } }).catch(() => {})
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.jobQuotedCost.deleteMany({ where: { quoteId: { in: quotes } } })
    await prisma.inventoryPendingOrder.deleteMany({ where: { quoteId: { in: quotes } } }).catch(() => {})
    await prisma.proposalView.deleteMany({ where: { quoteId: { in: quotes } } }).catch(() => {})
    await prisma.notification.deleteMany({ where: { title: { startsWith: 'Proposal accepted: E2E Oct29' } } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.deleteMany({ where: { id: accountId } })
  })

  test('D1: a proposal sent with cents, signed on its link, is billed and contracted at the whole dollar it showed', async () => {
    const q = await sentQuote('E2E Oct29 Cents', [5532.39, 4669.9], 50)
    // What the customer sees before signing: $5,532, a $2,766 deposit, and the new permit sentence.
    const { p, view } = await proposalPage(q as any, q.proposal as any)
    const page = renderProposal(q, p, q.shareToken!, 'n', [], null, '', view)
    expect(page).toContain('<span class="price">$5,532</span>')
    expect(page).toContain('50% to schedule: <b>$2,766</b>')
    expect(page).toContain('Getter Done Fence obtains all required permits.')
    expect(page).not.toContain('the customer is responsible for obtaining')

    const { job, view: s } = await sign(q.id)
    expect(s.signedCents).toBe(553_200)
    expect(s.contractCents).toBe(553_200)
    expect(kinds(s)).toEqual([['deposit', 276_600], ['final', 276_600]])
    // The job reads what the customer signed and is billed: its price and its contract, never the quote's cents.
    const j = await jobAndBill(job.id)
    expect(j.job.quotePrice).toBe(5532)
    expect(j.job.contractValue).toBe(5532)
    expect(j.billedCents).toBe(Math.round(j.job.contractValue * 100))
    // The quote keeps its price as priced (a sent quote is never repriced); the customer is billed what was shown.
    expect((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!.finalPrice).toBe(5532.39)
    // Frozen at signing: the terms as the page showed them.
    const frozen = ((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!.proposal as any).terms
    expect(frozen.find((t: any) => t.key === 'permits').text).toMatch(/^Getter Done Fence obtains all required permits\. Permit fees are billed separately at cost\./)
    for (const text of [await contractText(q.id), await storedText(q.id)]) {
      expect(text).toContain('Price $5,532.00')
      expect(text).toContain('50% to schedule: $2,766.00')
      expect(text).toContain('Style 0 at $5,532.00')
      expect(text).not.toContain('5,532.39')
      expect(text).toContain('Getter Done Fence obtains all required permits.')
      expect(text).toContain('A 50% deposit is required to schedule the project.')
    }
  })

  test('D2: 0% and blank deposit make no deposit invoice; the contract says no deposit', async () => {
    for (const [name, pct] of [['E2E Oct29 Zero', 0], ['E2E Oct29 Blank', undefined]] as const) {
      const q = await sentQuote(name, [8920.46, 7396.53], pct)
      const { p, view } = await proposalPage(q as any, q.proposal as any)
      const page = renderProposal(q, p, q.shareToken!, 'n', [], null, '', view)
      expect(page).not.toContain('<h2>Deposit</h2>')
      expect(page).toContain('No deposit is required to schedule the project.')
      const { view: s } = await sign(q.id)
      expect(s.depositPct).toBe(0)
      expect(kinds(s)).toEqual([['final', 892_000]])
      expect(s.log.some((l: any) => /no deposit: the proposal asks none/.test(l.text))).toBe(true)
      for (const text of [await contractText(q.id), await storedText(q.id)]) {
        expect(text).toContain('Price $8,920.00')
        expect(text).not.toContain('to schedule:')
        expect(text).toContain('No deposit is required to schedule the project. The full price is due upon completion.')
        expect(text).not.toContain('A 50% deposit')
      }
    }
  })

  test('a sale from before the rules began keeps its cents, its deposit to the cent and its terms as signed', async () => {
    const q = await sentQuote('E2E Oct29 Before', [7113.83], 50, { status: 'SOLD', soldAt: new Date('2026-10-20T15:00:00Z'), chosenOption: 0 })
    const job = await prisma.savedJob.create({ data: { accountId, quoteId: q.id, customerName: q.customerName, quotePrice: 7113.83, contractValue: 7113.83 } as any })
    await billing.ensureSchedule(accountId, job.id, 'sold', by, { force: true })
    const s = await billing.scheduleView(accountId, job.id)
    expect(s.signedCents).toBe(711_383)
    expect(kinds(s)).toEqual([['deposit', 355_692], ['final', 355_691]])
    // Its job is exactly as it was: the price to the cent, deposit + final = its contract.
    const j = await jobAndBill(job.id)
    expect(j.job.quotePrice).toBe(7113.83)
    expect(j.job.contractValue).toBe(7113.83)
    expect(j.billedCents).toBe(711_383)
    const text = await contractText(q.id)
    expect(text).toContain('Price $7,113.83')
    expect(text).toContain('50% to schedule: $3,556.92')
    expect(text).toContain('the customer is responsible for obtaining any required permits')
    expect(text).not.toContain('Getter Done Fence obtains')
    // Its page (sold, not signed on the link) shows the terms as signed too.
    const { p } = await proposalPage(q as any, q.proposal as any, true)
    expect(p.terms!.find(t => t.key === 'permits')!.text).toBe(PERMIT_OLD)
  })

  test('marked Sold in the app: the job reads the whole dollar, from any phone, and deposit + final = its contract', async () => {
    // An older phone copies the quote's cents ($5,532.39); the new one sends the whole dollar ($5,532, web jobPrice.ts).
    for (const [name, sent] of [['E2E Oct29 App Old Phone', 5532.39], ['E2E Oct29 App New Phone', 5532]] as const) {
      const q = await sentQuote(name, [5532.39], 50, { status: 'SOLD', soldAt: new Date() })
      const r = await post('/api/saved-jobs', { quoteId: q.id, customerName: q.customerName, customerAddress: q.customerAddress, fenceStyle: q.fenceStyle, quotePrice: sent, contractValue: sent, status: 'staging' })
      expect(r.status).toBe(201)
      expect(r.json.data.quotePrice).toBe(5532)
      expect(r.json.data.contractValue).toBe(5532)
      const j = await jobAndBill(r.json.data.id)
      expect(j.job.quotePrice).toBe(5532)
      expect(j.job.contractValue).toBe(5532)
      expect(kinds(j.s)).toEqual([['deposit', 276_600], ['final', 276_600]])
      expect(j.billedCents).toBe(553_200)
      // The quote keeps its own price as priced.
      expect((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!.finalPrice).toBe(5532.39)
    }
  })

  test('a price typed by hand on a sold job is left as typed (only a copy of the quote price is corrected)', async () => {
    const q = await sentQuote('E2E Oct29 App Typed', [5532.39], 50, { status: 'SOLD', soldAt: new Date() })
    const r = await post('/api/saved-jobs', { quoteId: q.id, customerName: q.customerName, quotePrice: 5000, contractValue: 5000, status: 'staging' })
    expect(r.status).toBe(201)
    expect(r.json.data.quotePrice).toBe(5000)
  })

  test("a job made with the quote's cents before this fix: its price follows the schedule when it settles", async () => {
    const q = await sentQuote('E2E Oct29 Settles', [7113.83], 50, { status: 'SOLD', soldAt: new Date() })
    const job = await prisma.savedJob.create({ data: { accountId, quoteId: q.id, customerName: q.customerName, quotePrice: 7113.83, contractValue: 7113.83 } as any })
    await billing.ensureSchedule(accountId, job.id, 'sold', by)
    const j = await jobAndBill(job.id)
    expect(j.s.signedCents).toBe(711_400)
    expect(j.job.quotePrice).toBe(7114)
    expect(j.job.contractValue).toBe(7114)
    expect(kinds(j.s)).toEqual([['deposit', 355_700], ['final', 355_700]])
    expect(j.billedCents).toBe(Math.round(j.job.contractValue * 100))
  })

  test('a sale from before the rules began, its job made in the app: kept to the cent', async () => {
    // Even a phone that rounded it gets the price as it was signed.
    for (const sent of [7113.83, 7114]) {
      const q = await sentQuote(`E2E Oct29 Before App ${sent}`, [7113.83], 50, { status: 'SOLD', soldAt: new Date('2026-10-20T15:00:00Z') })
      const r = await post('/api/saved-jobs', { quoteId: q.id, customerName: q.customerName, quotePrice: sent, contractValue: sent, status: 'staging' })
      expect([200, 201]).toContain(r.status)
      expect(r.json.data.quotePrice).toBe(7113.83)
      expect(r.json.data.contractValue).toBe(7113.83)
    }
  })
})
