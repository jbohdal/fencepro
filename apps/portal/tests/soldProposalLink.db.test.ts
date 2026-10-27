/**
 * On the dev database (DEV_DB=1; refuses any other), in a throwaway company:
 *
 * - a quote marked Sold in the app, not yet signed on its link: the link shows
 *   the sold option as the only one to sign; signing another (a page opened
 *   before it was sold) is refused, nothing changes, and the owner and the
 *   office get one bell notice saying what the customer tried (a second tap
 *   within 10 minutes is the same notice);
 * - a signing after the proposal was accepted is refused and noticed too;
 * - Billing > Payments' source (lib/jobTruth.ts paymentsReceived): every
 *   payment not voided, with the customer, the job and its receipt.
 */

import 'dotenv/config'
import express from 'express'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('a sold quote\'s proposal link (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { publicProposal } = await import('../src/server/routes/proposal.js') as any
  const { paymentsReceived } = await import('../src/server/lib/jobTruth.js')

  const stamp = Date.now().toString(36)
  let accountId = '', contactId = '', base = ''
  let server: ReturnType<express.Express['listen']>
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const page = (tok: string) => fetch(`${base}/p/${tok}`).then(r => r.text())
  const accept = (tok: string, option: number, name: string) => fetch(`${base}/p/${tok}/accept`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ option, name, signature: SIG }) }).then(async r => ({ status: r.status, json: await r.json() as any }))
  const opt = (label: string, fenceStyle: string, finalPrice: number) => ({ label, fenceStyle, finalPrice, perFoot: 0, sections: 19, snapshot: { pullSheet: [{ item: label, qty: 1 }] } })
  const options = [opt('Dig set', "WV-DS 6'x8' Privacy", 6093), opt('No dig', "WV-ND 6'x8' Privacy", 7363), opt('Tan no dig', "TV-ND 6'x8' Privacy", 7924)]
  const makeQuote = (name: string, extra: Record<string, unknown>) => prisma.savedQuote.create({
    data: {
      accountId, crmContactId: contactId, customerName: name, customerPhone: '3525550166', customerEmail: '', customerAddress: '9 Sold Test Way, Ocala, FL',
      fenceStyle: "WV-ND 6'x8' Privacy", runs: [150], sections: 19, corners: 0, ends: 2, walkGates: 1,
      materialCost: 3000, laborCost: 1000, tearOutCost: 0, totalCOGS: 4000, finalPrice: 7363, gmPct: 0.45, pullSheet: [],
      proposal: { version: 1, company: { name: 'Getter Done Fence', phone: '3528442677' }, customer: { name }, depositPct: 50, recommended: 0, terms: [], options } as any,
      shareToken: `sold-test-${name.replace(/\W/g, '')}-${stamp}`, shareExpiresAt: new Date(Date.now() + 20 * 86_400_000),
      ...extra,
    } as any,
  })
  const notices = (name: string) => prisma.notification.findMany({ where: { title: `Proposal not signed: ${name}` } })

  beforeAll(async () => {
    const account = await prisma.crmAccount.create({ data: { name: `Test sold proposal-${stamp}`, status: 'active' } })
    accountId = account.id
    contactId = (await prisma.crmContact.create({ data: { accountId, firstName: 'E2E', lastName: 'Sold Test', phone: '3525550166', serviceAddress: '9 Sold Test Way, Ocala, FL' } })).id
    const app = express()
    app.use('/p', publicProposal)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    await prisma.notification.deleteMany({ where: { title: { startsWith: 'Proposal not signed: E2E Sold' } } })
    if (!accountId) return
    const quotes = (await prisma.savedQuote.findMany({ where: { accountId }, select: { id: true } })).map(q => q.id)
    await prisma.receipt.deleteMany({ where: { accountId } })
    await prisma.contractPayment.deleteMany({ where: { accountId } })
    await prisma.proposalView.deleteMany({ where: { quoteId: { in: quotes } } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('sold in the app: only the sold option can be signed; another is refused, unchanged, and the office is told once', async () => {
    const name = 'E2E Sold Pick'
    const q = await makeQuote(name, { status: 'SOLD', soldAt: new Date() })
    const html = await page(q.shareToken!)
    expect(html).toMatch(/data-option="1">\s*<input type="radio" name="option" value="1" checked>/)
    expect(html.match(/data-not-available/g)).toHaveLength(2)
    expect(html).toContain('Your fence was signed with us for <b>No dig</b> at <b>$7,363</b>')

    const before = JSON.stringify(await prisma.savedQuote.findUnique({ where: { id: q.id } }))
    const r = await accept(q.shareToken!, 2, 'Pat Sold')
    expect(r.status).toBe(409)
    expect(r.json.error).toBe('This proposal was already signed for a different option. Please call us to make a change.')
    expect(JSON.stringify(await prisma.savedQuote.findUnique({ where: { id: q.id } }))).toBe(before)
    const n = await notices(name)
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ recipientRole: 'office', type: 'warning', link: `/?customer=${contactId}` })
    expect(n[0].body).toBe(`Pat Sold tried to accept Tan no dig at $7,924 on the proposal link, but it is already signed for No dig at $7,363. Nothing was changed. Call ${name} to sort it out.`)
    // A second tap: still one notice.
    expect((await accept(q.shareToken!, 2, 'Pat Sold')).status).toBe(409)
    expect(await notices(name)).toHaveLength(1)
  })

  test('sold for a fence no longer on the proposal: nothing to sign on the link', async () => {
    const q = await makeQuote('E2E Sold Changed', { status: 'SOLD', soldAt: new Date(), finalPrice: 7000 })
    const html = await page(q.shareToken!)
    expect(html).toContain('data-already-signed')
    expect(html).not.toContain('id="accept"')
  })

  test('accepted already: another signing is refused and the office is told what was tried', async () => {
    const name = 'E2E Sold Accepted'
    const q = await makeQuote(name, { status: 'SOLD', soldAt: new Date(), acceptedAt: new Date('2026-10-20T15:00:00Z'), acceptedBy: 'Pat Accepted', chosenOption: 1 })
    const r = await accept(q.shareToken!, 0, 'Someone Else')
    expect(r.status).toBe(409)
    const n = await notices(name)
    expect(n).toHaveLength(1)
    expect(n[0].body).toBe(`Someone Else tried to accept Dig set at $6,093 on the proposal link, but it was already accepted by Pat Accepted on October 20 for No dig at $7,363. Nothing was changed. Call ${name} to sort it out.`)
  })

  test('not sold: the link signs as before (any option)', async () => {
    const q = await makeQuote('E2E Sold Open', { status: 'SENT' })
    const html = await page(q.shareToken!)
    expect(html).not.toContain('data-not-available')
    expect(html).toContain('Accept the selected option')
  })

  test('Billing > Payments\' source: every payment not voided, with its customer, job and receipt', async () => {
    const q = await makeQuote('E2E Sold Paid', { status: 'SOLD', soldAt: new Date() })
    const job = await prisma.savedJob.create({ data: { accountId, quoteId: q.id, crmContactId: contactId, customerName: 'E2E Sold Paid', customerAddress: '9 Sold Test Way, Ocala, FL', fenceStyle: "WV-ND 6'x8' Privacy", quotePrice: 7363, contractValue: 7363, status: 'staging' } as any })
    const pay = (id: string, cents: number, extra: Record<string, unknown> = {}) => prisma.contractPayment.create({ data: { id, accountId, jobId: job.id, quoteId: q.id, crmContactId: contactId, amountCents: cents, method: 'check', checkNumber: '1042', paidOn: '2026-10-21', ...extra } as any })
    await pay(`sold-pay-a-${stamp}`, 368150)
    await pay(`sold-pay-b-${stamp}`, 100000, { method: 'zelle', checkNumber: null, voidedAt: new Date() })
    const rc = await prisma.receipt.create({ data: { accountId, number: 900000 + Math.floor(Math.random() * 99999), paymentId: `sold-pay-a-${stamp}`, jobId: job.id, crmContactId: contactId, token: `sold-rc-${stamp}`, snapshot: {} } })
    const rows = (await paymentsReceived(accountId))
    expect(rows).toEqual([{
      id: `sold-pay-a-${stamp}`, jobId: job.id, customerName: 'E2E Sold Paid', amountCents: 368150, paidOn: '2026-10-21', method: 'check',
      customerId: contactId, address: '9 Sold Test Way, Ocala, FL', fenceStyle: "WV-ND 6'x8' Privacy", checkNumber: '1042', reference: null,
      receipt: { id: rc.id, number: rc.number },
    }])
  })
})
