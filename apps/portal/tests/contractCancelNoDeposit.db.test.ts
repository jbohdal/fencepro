/**
 * Jonathan, Oct 29 2026 (late): "No deposit contracts: replace the sentence with 'Once materials are ordered,
 * their cost is non-refundable.'" Signed for real on the dev database (DEV_DB=1; refuses any other), in a
 * company of its own made for the test, with Settings → Contract Templates as saved on live:
 *   - 0% and blank: the proposal page, the terms frozen at signing, the contract on the fly and the stored
 *     signed copy say the new sentence;
 *   - 30%: the deposit sentence;
 *   - signed after the deposit rules but before this one: its Cancellation Policy as signed;
 *   - signed before every Oct 29 rule: as signed.
 * Writes only inside beforeAll, test and afterAll; removes what it made.
 */

import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { pdfText } from './pdfText'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('no deposit contracts: Cancellation Policy (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { acceptQuote, proposalPage, renderProposal } = await import('../src/server/routes/proposal.js')
  const { contractForQuote, CONTRACT_SELECT } = await import('../src/server/lib/contractPdf.js')
  const { CUSTOMER_DOLLARS_KEY, NO_DEPOSIT_CANCEL_KEY } = await import('../src/server/lib/customerDollars.js')

  const PAYMENT = 'A 50% deposit is required to schedule the project. The remaining balance is due upon completion. We accept cash, check, ACH, and major credit cards.'
  const CANCEL = 'The deposit is non-refundable once materials are ordered. Change orders requested after materials are ordered may incur additional costs. Cancellation within 3 days of signing is accepted with no penalty.'
  const NEW_SENTENCE = 'Once materials are ordered, their cost is non-refundable.'
  const OLD_SENTENCE = 'The deposit is non-refundable once materials are ordered.'
  const SECTIONS = [
    { key: 'payment_terms', title: 'Payment Terms', body: PAYMENT, visible: true },
    { key: 'cancellation', title: 'Cancellation Policy', body: CANCEL, visible: true },
  ]
  const FROZEN = [{ key: 'payment_terms', title: 'Payment Terms', text: PAYMENT }, { key: 'cancellation', title: 'Cancellation Policy', text: CANCEL }]
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const flat = (s: string) => s.replace(/\s+/g, ' ')

  let accountId = ''
  const quotes: string[] = []
  const option = (label: string, finalPrice: number) => ({ label, fenceStyle: label, finalPrice, perFoot: 0, sections: 10 })
  async function sentQuote(name: string, depositPct: number | undefined, extra: Record<string, unknown> = {}) {
    const proposal = { version: 1, company: { name: 'E2E Fence', phone: '' }, customer: { name, address: '1 Test Ln' }, ...(depositPct === undefined ? {} : { depositPct }), recommended: 0, options: [option('Style 0', 8920)], terms: FROZEN }
    const q = await prisma.savedQuote.create({
      data: { accountId, customerName: name, customerAddress: '1 Test Ln, Ocala FL', fenceStyle: 'Style 0', runs: [80], pullSheet: [], finalPrice: 8920, status: 'SENT', shareToken: crypto.randomBytes(12).toString('hex'), proposal: proposal as any, ...extra } as any,
    })
    quotes.push(q.id)
    return q
  }
  const contractText = async (id: string) => flat(pdfText((await contractForQuote((await prisma.savedQuote.findUnique({ where: { id }, select: CONTRACT_SELECT })) as any))!))
  const storedText = async (id: string) => {
    const d = await prisma.signedDocument.findUnique({ where: { sourceKey: `contract:${id}` } })
    return flat(pdfText(fs.readFileSync(path.resolve(process.env.UPLOAD_DIR || './uploads', d!.fileKey))))
  }

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: 'E2E no deposit cancellation' } })).id
    await prisma.businessState.create({ data: { accountId, contractSections: SECTIONS as any } })
    // The deposit rules began an hour ago (as on live, Oct 29 21:43); this rule a minute ago, at the deploy.
    await prisma.accountKeyValue.create({ data: { accountId, key: 'billing:schedules-from', value: new Date(Date.now() - 3_600_000).toISOString() } })
    await prisma.accountKeyValue.create({ data: { accountId, key: CUSTOMER_DOLLARS_KEY, value: new Date(Date.now() - 3_600_000).toISOString() } })
    await prisma.accountKeyValue.create({ data: { accountId, key: NO_DEPOSIT_CANCEL_KEY, value: new Date(Date.now() - 60_000).toISOString() } })
  })

  afterAll(async () => {
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
    await prisma.notification.deleteMany({ where: { title: { startsWith: 'Proposal accepted: E2E NoDep' } } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.deleteMany({ where: { id: accountId } })
  })

  test('0% and blank: the page, the frozen terms, the contract and its stored copy say the new sentence', async () => {
    for (const [name, pct] of [['E2E NoDep Zero', 0], ['E2E NoDep Blank', undefined]] as const) {
      const q = await sentQuote(name, pct)
      const { p, view } = await proposalPage(q as any, q.proposal as any)
      const page = renderProposal(q, p, q.shareToken!, 'n', [], null, '', view)
      expect(page).toContain(NEW_SENTENCE)
      expect(page).not.toContain(OLD_SENTENCE)
      const out = await acceptQuote(await prisma.savedQuote.findUnique({ where: { id: q.id } }), { option: 0, name: 'E2E Customer', signature: SIG } as any, { ip: '203.0.113.9', userAgent: 'vitest' })
      expect(out.status).toBe(200)
      const frozen = ((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!.proposal as any).terms
      expect(frozen.find((t: any) => t.key === 'cancellation').text).toBe(CANCEL.replace(OLD_SENTENCE, NEW_SENTENCE))
      for (const text of [await contractText(q.id), await storedText(q.id)]) {
        expect(text).toContain(NEW_SENTENCE)
        expect(text).not.toContain(OLD_SENTENCE)
        expect(text).toContain('No deposit is required to schedule the project.')
      }
    }
  })

  test('30%: the deposit sentence stays', async () => {
    const q = await sentQuote('E2E NoDep Thirty', 30)
    const { p, view } = await proposalPage(q as any, q.proposal as any)
    expect(renderProposal(q, p, q.shareToken!, 'n', [], null, '', view)).toContain(OLD_SENTENCE)
    expect((await acceptQuote(await prisma.savedQuote.findUnique({ where: { id: q.id } }), { option: 0, name: 'E2E Customer', signature: SIG } as any)).status).toBe(200)
    for (const text of [await contractText(q.id), await storedText(q.id)]) {
      expect(text).toContain(OLD_SENTENCE)
      expect(text).not.toContain(NEW_SENTENCE)
      expect(text).toContain('A 30% deposit is required to schedule the project.')
    }
  })

  test('signed after the deposit rules, before this one: its Cancellation Policy as signed', async () => {
    const signedTerms = [{ key: 'payment_terms', title: 'Payment Terms', text: PAYMENT.replace('A 50% deposit is required to schedule the project.', 'No deposit is required to schedule the project.').replace('The remaining balance', 'The full price') }, FROZEN[1]]
    const q = await sentQuote('E2E NoDep Between', 0, { status: 'SOLD', soldAt: new Date(Date.now() - 30 * 60_000), acceptedAt: new Date(Date.now() - 30 * 60_000), acceptedBy: 'E2E Customer', chosenOption: 0 })
    await prisma.savedQuote.update({ where: { id: q.id }, data: { proposal: { ...(q.proposal as any), terms: signedTerms } } })
    const text = await contractText(q.id)
    expect(text).toContain(OLD_SENTENCE)
    expect(text).not.toContain(NEW_SENTENCE)
    expect(text).toContain('No deposit is required to schedule the project.')
    const fresh = (await prisma.savedQuote.findUnique({ where: { id: q.id } }))!
    const { p } = await proposalPage(fresh as any, fresh.proposal as any, true)
    expect(p.terms!.find(t => t.key === 'cancellation')!.text).toBe(CANCEL)
  })

  test('signed before every Oct 29 rule: as signed', async () => {
    const q = await sentQuote('E2E NoDep Before', 0, { status: 'SOLD', soldAt: new Date('2026-10-20T15:00:00Z'), chosenOption: 0 })
    const text = await contractText(q.id)
    expect(text).toContain(OLD_SENTENCE)
    expect(text).toContain('A 50% deposit is required to schedule the project.')
    expect(text).not.toContain(NEW_SENTENCE)
  })
})
