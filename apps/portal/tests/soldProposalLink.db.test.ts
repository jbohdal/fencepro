/**
 * On the dev database (DEV_DB=1; refuses any other), in a throwaway company:
 *
 * - a quote marked Sold in the app, not yet signed on its link: the link shows
 *   only the sold option, the one to sign; signing another (a page opened
 *   before it was sold) is refused with the option and the number to call,
 *   nothing changes, and the owner and the office get one bell notice saying
 *   what the customer tried (a second tap within 10 minutes is the same
 *   notice); signing the sold option then settles that notice (read);
 * - once signed on the link, the link shows only the signed option, Accepted
 *   first; a signing of another option is refused and noticed too; the same
 *   option signed again (a dropped signal, or someone else of the household)
 *   stands as first signed, with no notice;
 * - Billing > Payments' source (lib/jobTruth.ts paymentsReceived): every
 *   payment not voided, with the customer, the job and its receipt.
 */

import 'dotenv/config'
import express from 'express'
import fs from 'fs'
import path from 'path'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('a sold quote\'s proposal link (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { publicProposal, conflictLink } = await import('../src/server/routes/proposal.js') as any
  const { paymentsReceived } = await import('../src/server/lib/jobTruth.js')

  const UPLOAD = path.resolve(process.env.UPLOAD_DIR || './uploads')
  const stamp = Date.now().toString(36)
  let accountId = '', contactId = '', base = ''
  let server: ReturnType<express.Express['listen']>
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const page = (tok: string, qs = '') => fetch(`${base}/p/${tok}${qs}`).then(r => r.text())
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
  // The bell notices about this quote's link (the quote's own link: routes/proposal.ts conflictLink).
  const notices = (q: { id: string }) => prisma.notification.findMany({ where: { link: conflictLink({ id: q.id, crmContactId: contactId }) } })

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
    if (!accountId) return
    await prisma.notification.deleteMany({ where: { OR: [{ link: { contains: contactId } }, { title: { startsWith: 'Proposal accepted: E2E Sold' } }] } })
    const quotes = (await prisma.savedQuote.findMany({ where: { accountId }, select: { id: true } })).map(q => q.id)
    const jobs = (await prisma.savedJob.findMany({ where: { accountId }, select: { id: true } })).map(j => j.id)
    // What signing on the link made: the signed contract (its file too), the job's schedule, quoted cost and takeoff.
    const docs = await prisma.signedDocument.findMany({ where: { accountId } })
    for (const d of docs) fs.rmSync(path.resolve(UPLOAD, d.fileKey), { force: true })
    try { fs.rmdirSync(path.resolve(UPLOAD, 'signed', accountId)) } catch { /* not empty or not there */ }
    await prisma.signedDocument.deleteMany({ where: { accountId } })
    await prisma.portalFile.deleteMany({ where: { crmCustomerId: contactId } })
    await prisma.receipt.deleteMany({ where: { accountId } })
    const pays = (await prisma.contractPayment.findMany({ where: { accountId }, select: { id: true } })).map(p => p.id)
    await prisma.paymentApplication.deleteMany({ where: { paymentId: { in: pays } } })
    await prisma.contractPayment.deleteMany({ where: { accountId } })
    await prisma.contractInvoice.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.billingLog.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.paymentSchedule.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.jobChecklistItem.deleteMany({ where: { jobId: { in: jobs } } }).catch(() => {})
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: [...jobs, ...quotes] } } as any }).catch(() => {})
    await prisma.jobTakeoff.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.jobQuotedCost.deleteMany({ where: { accountId } })
    await prisma.proposalView.deleteMany({ where: { quoteId: { in: quotes } } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...jobs, ...quotes] } } }).catch(() => {})
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('sold in the app: only the sold option shows; another is refused, unchanged, the office told once; signing the sold one settles it', async () => {
    const name = 'E2E Sold Pick'
    const q = await makeQuote(name, { status: 'SOLD', soldAt: new Date() })
    const html = await page(q.shareToken!)
    expect(html).toMatch(/data-option="1">\s*<input type="radio" name="option" value="1" checked>/)
    expect(html.match(/data-option="/g)).toHaveLength(1)
    expect(html).not.toContain('Tan no dig')
    expect(html).toContain('Your fence was signed with us for <b>No dig</b> at <b>$7,363</b>')

    const before = JSON.stringify(await prisma.savedQuote.findUnique({ where: { id: q.id } }))
    const r = await accept(q.shareToken!, 2, 'Pat Sold')
    expect(r.status).toBe(409)
    expect(r.json.error).toBe('Your fence was already signed for No dig. To change it, please call us at (352) 844 2677.')
    expect(r.json.reload).toBe(true)
    expect(JSON.stringify(await prisma.savedQuote.findUnique({ where: { id: q.id } }))).toBe(before)
    const n = await notices(q)
    expect(n).toHaveLength(1)
    expect(n[0]).toMatchObject({ recipientRole: 'office', type: 'warning', read: false, title: 'Proposal conflict: E2E Sold Pick tried Tan no dig; No dig stands', link: `/customers/${contactId}?tab=quotes&qv=${q.id}` })
    expect(n[0].body).toBe(`Pat Sold tried to accept Tan no dig at $7,924 on the proposal link, but it is already signed for No dig at $7,363. Nothing was changed. Call ${name} to sort it out.`)
    // A second tap: still one notice.
    expect((await accept(q.shareToken!, 2, 'Pat Sold')).status).toBe(409)
    expect(await notices(q)).toHaveLength(1)
    // The page it reloads to: why first, over the sold option.
    const back = await page(q.shareToken!, '?refused=1')
    expect(back).toMatch(/data-refused role="alert"><p>Your fence was already signed for No dig\. To change it, please call us at <a href="tel:3528442677"[^>]*>\(352\) 844 2677<\/a>\.<\/p>/)
    expect(back.match(/data-option="/g)).toHaveLength(1)

    // The customer signs the sold option: accepted, and the conflict is settled (read).
    const ok = await accept(q.shareToken!, 1, 'Pat Sold')
    expect(ok.status).toBe(200)
    const now = (await prisma.savedQuote.findUnique({ where: { id: q.id } }))!
    expect(now).toMatchObject({ chosenOption: 1, acceptedBy: 'Pat Sold', finalPrice: 7363 })
    expect((await notices(q)).map(x => x.read)).toEqual([true])
  })

  test('sold for a fence no longer on the proposal: nothing to sign on the link, the fence in plain words', async () => {
    const q = await makeQuote('E2E Sold Changed', { status: 'SOLD', soldAt: new Date(), finalPrice: 7000 })
    const html = await page(q.shareToken!)
    expect(html).toContain('data-already-signed')
    expect(html).toContain('<b>$7,000</b>')
    expect(html).not.toContain('id="accept"')
    expect(html).not.toContain('data-option="')
    const r = await accept(q.shareToken!, 1, 'Pat Changed')
    expect(r.status).toBe(409)
    expect(r.json.error).toMatch(/^Your fence was already signed for .+\. To change it, please call us at \(352\) 844 2677\.$/)
    expect(r.json.error).not.toContain("WV-ND 6'x8'")
  })

  test('accepted on the link: only that option, Accepted first; another is refused and noticed; the same one again stands', async () => {
    const name = 'E2E Sold Accepted'
    const q = await makeQuote(name, { status: 'SOLD', soldAt: new Date(), acceptedAt: new Date('2026-10-20T15:00:00Z'), acceptedBy: 'Pat Accepted', chosenOption: 1 })
    const html = await page(q.shareToken!)
    expect(html.match(/data-option="/g)).toHaveLength(1)
    expect(html).not.toContain('Save $')
    expect(html.indexOf('data-accepted')).toBeLessThan(html.indexOf('data-option="1"'))
    expect(html.indexOf('data-contract-pdf')).toBeLessThan(html.indexOf('data-option="1"'))

    const r = await accept(q.shareToken!, 0, 'Someone Else')
    expect(r.status).toBe(409)
    expect(r.json).toMatchObject({ error: 'This proposal was already accepted for No dig. To make a change, please call us at (352) 844 2677.', reload: true })
    const n = await notices(q)
    expect(n).toHaveLength(1)
    expect(n[0].title).toBe('Proposal conflict: E2E Sold Accepted tried Dig set; No dig stands')
    expect(n[0].body).toBe(`Someone Else tried to accept Dig set at $6,093 on the proposal link, but it was already accepted by Pat Accepted on October 20 for No dig at $7,363. Nothing was changed. Call ${name} to sort it out.`)

    // The same option, signed by someone else of the household: no error, no notice, it stands as first signed.
    const spouse = await accept(q.shareToken!, 1, 'Chris Accepted')
    expect(spouse.status).toBe(200)
    expect(spouse.json.success).toBe(true)
    // The same signing sent again (a dropped signal).
    expect((await accept(q.shareToken!, 1, 'Pat Accepted')).status).toBe(200)
    expect(await notices(q)).toHaveLength(1)
    expect((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!.acceptedBy).toBe('Pat Accepted')
  })

  test('not sold: the link signs as before (any option)', async () => {
    const q = await makeQuote('E2E Sold Open', { status: 'SENT' })
    const html = await page(q.shareToken!)
    expect(html.match(/data-option="/g)).toHaveLength(3)
    expect(html).toContain('Accept the selected option')
    const r = await accept(q.shareToken!, 2, 'Pat Open')
    expect(r.status).toBe(200)
    expect((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!).toMatchObject({ chosenOption: 2, fenceStyle: "TV-ND 6'x8' Privacy", finalPrice: 7924 })
    expect(await notices(q)).toHaveLength(0)
  })

  const tier = (o: ReturnType<typeof opt>, key: string, label: string, badge?: string) => ({ ...o, tier: { key, label, blurb: `${label} words` }, ...(badge ? { badge } : {}) })
  const bestPriceProposal = (name: string, extra: Record<string, unknown> = {}) => ({
    version: 1, company: { name: 'Getter Done Fence', phone: '3528442677' }, customer: { name }, depositPct: 50, recommended: 1, terms: [],
    tierSet: { category: 'Vinyl', popular: 'better', tiers: [{ key: 'good', width: 'cheapest' }, { key: 'better', width: 'cheapest' }, { key: 'best', width: '6' }] },
    options: [tier(options[0], 'good', 'Good'), tier(options[1], 'better', 'Better', 'Most popular'), tier(opt('6 ft panels, No dig', "WV-ND 6'x6' Privacy", 7924), 'best', 'Best'),
      { ...opt('White Vinyl Privacy, 6 ft tall, 6 or 8 ft panels (best price), No dig', 'WV-Auto ND Privacy', 7179), snapshot: { pullSheet: [{ item: 'mix', qty: 1 }], runRails: ['6ft', '8ft'] } }],
    ...extra,
  })

  test('a best price quote not yet sent: its own option shows as Better, in Better\'s place, at the quoted price, selected; three cards; signs at that price', async () => {
    const q = await makeQuote('E2E Sold Best Price', { status: 'DRAFT', fenceStyle: 'WV-Auto ND Privacy', finalPrice: 7179, proposal: bestPriceProposal('E2E Sold Best Price') })
    const html = await page(q.shareToken!)
    expect(html.match(/data-option="/g)).toHaveLength(3)
    expect([...html.matchAll(/data-option="(\d)"/g)].map(m => m[1])).toEqual(['0', '3', '2'])
    expect(html).toMatch(/data-option="3">\s*<input type="radio" name="option" value="3" checked>/)
    const card = html.slice(html.indexOf('data-option="3"'), html.indexOf('data-option="2"'))
    expect(card).toContain('Most popular')
    expect(card).toContain('<span class="tier">Better</span>')
    expect(card).toContain('6 or 8 ft panels (best price)')
    expect(card).toContain('$7,179')
    expect(html).not.toContain('$7,363')
    expect(html).toContain('Save $1,086')
    expect(html).toContain('$745 more')
    const r = await accept(q.shareToken!, 3, 'Pat Best')
    expect(r.status).toBe(200)
    expect((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!).toMatchObject({ chosenOption: 3, fenceStyle: 'WV-Auto ND Privacy', finalPrice: 7179 })
  })

  test('a best price quote already sent (or opened): exactly the four cards and prices it went out with; frozen ones stay frozen', async () => {
    const cards = (h: string) => [...h.matchAll(/data-option="(\d)"/g)].map(m => m[1])
    for (const extra of [{ status: 'SENT' }, { status: 'DRAFT', firstViewedAt: new Date(), viewCount: 1 }]) {
      const name = `E2E Sold Best Sent ${extra.status}`
      const q = await makeQuote(name, { ...extra, fenceStyle: 'WV-Auto ND Privacy', finalPrice: 7179, proposal: bestPriceProposal(name) })
      const html = await page(q.shareToken!)
      expect(cards(html)).toEqual(['0', '1', '2', '3'])
      expect(html).toContain('$7,363')
      expect(html).toContain('$7,179')
    }
    // Frozen when it was saved as a draft, then sent: still folded as it was shown.
    const frozen = await makeQuote('E2E Sold Best Frozen', { status: 'SENT', fenceStyle: 'WV-Auto ND Privacy', finalPrice: 7179, proposal: bestPriceProposal('E2E Sold Best Frozen', { ownTier: { own: 3, tier: 1 } }) })
    expect(cards(await page(frozen.shareToken!))).toEqual(['0', '3', '2'])
    // What a save freezes (routes/saved-quotes.ts): the fold for a proposal not yet sent; once sent, none that it did not already show.
    const { stampOwnTier } = await import('../src/server/lib/ownTier.js')
    expect((await stampOwnTier(bestPriceProposal('x'), 'WV-Auto ND Privacy', null, false) as any).ownTier).toEqual({ own: 3, tier: 1 })
    expect((await stampOwnTier(bestPriceProposal('x'), 'WV-Auto ND Privacy', bestPriceProposal('x'), true) as any).ownTier).toBeNull()
    expect((await stampOwnTier(bestPriceProposal('x'), 'WV-Auto ND Privacy', bestPriceProposal('x', { ownTier: { own: 3, tier: 1 } }), true) as any).ownTier).toEqual({ own: 3, tier: 1 })
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
