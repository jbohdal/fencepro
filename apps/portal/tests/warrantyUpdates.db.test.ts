/**
 * "Send updated warranty" (lib/warrantyUpdates.ts) on the dev database
 * (DEV_DB=1; refuses any other):
 *
 * - a sent, unsigned proposal from before warranties were per option (one
 *   1 Year block): the update link shows the same proposal, prices identical,
 *   each option with today's warranty (Lifetime on no dig, 1 Year on dig set);
 *   the quote as stored is not changed by a byte; the old link still shows what
 *   was sent; accepting on the new link signs it with the Lifetime words;
 * - a sold quote (accepted before the change): the update keeps the quote as
 *   stored; Acknowledge (a typed name) makes the job's warranty Lifetime, the
 *   Warranty Certificate (made again in place) says so with "Warranty updated
 *   on <date>", and the signed contract stays as signed;
 * - the customer's history shows the update sent and acknowledged.
 *
 * Everything happens in a throwaway company, removed afterwards. Writes only
 * inside beforeAll, test and afterAll.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import path from 'path'
import { pdfText } from './pdfText'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('warranty updates (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: warrantyRoutes } = await import('../src/server/routes/warranties.js')
  const { publicProposal } = await import('../src/server/routes/proposal.js') as any
  const { warrantyUpdatePublic } = await import('../src/server/routes/warrantyUpdatePublic.js')
  const { ensureWarranties } = await import('../src/server/lib/warranties.js')
  const { customerHistory } = await import('../src/server/lib/followUps.js')
  const { makeCertificate } = await import('../src/server/lib/walkthroughCertificate.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const W = await import('../../web/src/warranties')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  let accountId = '', contactId = '', owner = '', base = ''
  const certFiles: string[] = []
  let server: ReturnType<express.Express['listen']>
  const call = (method: string, p: string, body?: unknown, auth = true) => fetch(base + p, { method, headers: { ...(auth ? { Authorization: `Bearer ${owner}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))
  const raw = (p: string) => fetch(base + p).then(async r => ({ status: r.status, type: r.headers.get('content-type') || '', buf: Buffer.from(await r.arrayBuffer()) }))
  const html = async (p: string) => (await raw(p)).buf.toString()
  const prices = (page: string) => [...page.matchAll(/<span class="price">([^<]+)</g)].map(m => m[1])
  const badges = (page: string) => [...page.matchAll(/data-warranty-badge>([^<]+)</g)].map(m => m[1])
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  const opt = (label: string, fenceStyle: string, price: number) => ({
    label, fenceStyle, finalPrice: price, perFoot: price / 150, sections: 19,
    snapshot: { materialCost: price * 0.4, laborCost: price * 0.2, tearOutCost: 0, totalCOGS: price * 0.6, gmPct: 0.4, pullSheet: [], runSections: [19] },
  })
  /** A proposal as it went out before Oct 20, 2026: one 1 Year block for every option, no warranty per option. */
  const oldProposal = (name: string) => ({
    version: 1, footageFt: 150, gatesText: '1 walk gate', included: ['150 ft of new fence'], includedNote: '', warranty: W.ONE_YEAR_TEXT,
    depositPct: 50, depositNote: '', financing: null, recommended: 0, company: { name: 'Getter Done Fence', phone: '3527894314', email: '' },
    customer: { name, address: '7 Update Test Way, Ocala, FL' },
    options: [opt("WV-DS 6'x8' Privacy", "WV-DS 6'x8' Privacy", 10655.85), opt("WV-ND 6'x8' Privacy", "WV-ND 6'x8' Privacy", 12900.91), opt("TV-ND 6'x8' Privacy", "TV-ND 6'x8' Privacy", 14814.7)],
  })
  const makeQuote = (name: string, token: string) => prisma.savedQuote.create({
    data: {
      accountId, crmContactId: contactId, customerName: name, customerPhone: '3525550177', customerEmail: 'update-test@example.invalid', customerAddress: '7 Update Test Way, Ocala, FL',
      fenceStyle: "WV-DS 6'x8' Privacy", runs: [150], sections: 19, corners: 0, ends: 2, walkGates: 1,
      materialCost: 4262.34, laborCost: 2131.17, tearOutCost: 0, totalCOGS: 6393.51, finalPrice: 10655.85, gmPct: 0.4, pullSheet: [], status: 'SENT',
      proposal: oldProposal(name) as any, shareToken: token, shareExpiresAt: new Date(Date.now() + 20 * 86_400_000),
    } as any,
  })
  /** Everything stored on the quote, for "not changed by a byte". */
  const stored = async (id: string) => JSON.stringify(await prisma.savedQuote.findUnique({ where: { id } }))

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    const top = await prisma.savedQuote.groupBy({ by: ['accountId'], _count: { _all: true }, orderBy: { _count: { accountId: 'desc' } }, take: 1 })
    const src = await prisma.businessState.findUnique({ where: { accountId: top[0].accountId } })
    const account = await prisma.crmAccount.create({ data: { name: `Test warranty updates-${Date.now().toString(36)}`, status: 'active' } })
    accountId = account.id
    await prisma.businessState.create({ data: { accountId, config: { fenceStyles: (src!.config as any).fenceStyles, fenceCatalog: (src!.config as any).fenceCatalog } as any } })
    await ensureWarranties(accountId)
    contactId = (await prisma.crmContact.create({ data: { accountId, firstName: 'E2E', lastName: 'Update Test', phone: '3525550177', serviceAddress: '7 Update Test Way, Ocala, FL' } })).id
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/warranties', warrantyRoutes)
    app.use('/p/wu', warrantyUpdatePublic)
    app.use('/p', publicProposal)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const quotes = (await prisma.savedQuote.findMany({ where: { accountId }, select: { id: true } })).map(q => q.id)
    await prisma.warrantyUpdate.deleteMany({ where: { accountId } })
    await prisma.walkthrough.deleteMany({ where: { accountId } })
    await prisma.appointment.deleteMany({ where: { accountId } })
    await prisma.proposalView.deleteMany({ where: { quoteId: { in: quotes } } })
    await prisma.jobQuotedCost.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    for (const f of certFiles) { fs.rmSync(f, { force: true }); try { fs.rmdirSync(path.dirname(f)) } catch { /* not empty */ } }
    if (contactId) await prisma.portalFile.deleteMany({ where: { crmCustomerId: contactId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.notification.deleteMany({ where: { OR: [{ title: { startsWith: 'Proposal accepted: E2E Update' } }, { title: { startsWith: 'Warranty update acknowledged: E2E Update' } }] } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('a sent proposal (one old 1 Year block): the new link has today\'s warranty per option, prices identical, the quote unchanged', async () => {
    const q = await makeQuote('E2E Update Sent', `wu-test-sent-${Date.now().toString(36)}-abcdef`)
    const before = await stored(q.id)
    const pre = await call('GET', `/api/warranties/quote/${q.id}/update`)
    expect(pre.status).toBe(200)
    expect(pre.json.data).toMatchObject({ kind: 'proposal', available: true, chosen: null })
    expect(pre.json.data.options.map((o: any) => [o.warranty.name, o.before.name, o.changed])).toEqual([
      ['1 Year Workmanship Warranty', '1 Year Workmanship Warranty', false],
      ['Lifetime Craftsmanship Warranty', '1 Year Workmanship Warranty', true],
      ['Lifetime Craftsmanship Warranty', '1 Year Workmanship Warranty', true],
    ])
    expect(pre.json.data.options.map((o: any) => o.finalPrice)).toEqual([10655.85, 12900.91, 14814.7])

    const made = await call('POST', `/api/warranties/quote/${q.id}/update`)
    expect(made.status).toBe(201)
    const tok = made.json.data.latest.token
    expect(made.json.data.latest).toMatchObject({ kind: 'proposal', warrantyName: 'Lifetime Craftsmanship Warranty', sentAt: null })
    // Tapping again (Copy link after Text it) gives the same link.
    const again = await call('POST', `/api/warranties/quote/${q.id}/update`)
    expect(again.status).toBe(200)
    expect(again.json.data.latest.token).toBe(tok)
    const sent = await call('POST', `/api/warranties/update/${made.json.data.latest.id}/sent`, { channel: 'text' })
    expect(sent.json.data).toMatchObject({ sentChannel: 'text' })
    expect(await stored(q.id)).toBe(before)

    const page = await html(`/p/wu/${tok}`)
    expect(page).toContain('We\'ve updated the warranty on your fence: <b>Lifetime Craftsmanship Warranty</b>. Your price and everything else stay the same.')
    expect(badges(page)).toEqual(['1 Year Workmanship Warranty', 'Lifetime Craftsmanship Warranty', 'Lifetime Craftsmanship Warranty'])
    expect(page).toContain(JSON.stringify(W.LIFETIME_TEXT).slice(1, 60))
    expect(page).toContain('class="opt on" data-option="0"')
    expect(page).toContain('id="sig"')
    const old = await html(`/p/${q.shareToken}`)
    expect(prices(page)).toEqual(prices(old))
    expect(prices(page)).toEqual(['$10,656', '$12,901', '$14,815'])
    // The old link, as sent: one 1 Year block, no badges.
    expect(badges(old)).toEqual([])
    expect(old).toContain('Workmanship is warranted for 1 year')
    expect(old).not.toContain('Lifetime')
    expect(await stored(q.id)).toBe(before)

    // Accepting the Lifetime option on the new link: the price as offered, the contract with the Lifetime words.
    const acc = await call('POST', `/p/wu/${tok}/accept`, { option: 1, name: 'E2E Update Sent', signature: SIG }, false)
    expect(acc.status).toBe(200)
    const sold = (await prisma.savedQuote.findUnique({ where: { id: q.id } }))!
    expect(sold).toMatchObject({ status: 'SOLD', chosenOption: 1, finalPrice: 12900.91, fenceStyle: "WV-ND 6'x8' Privacy" })
    // The proposal as sent, plus the terms the customer read on the page, frozen at signing (lib/contractTerms.ts).
    const { terms, ...asSent } = sold.proposal as any
    expect(JSON.stringify(asSent)).toBe(JSON.stringify(JSON.parse(before).proposal))
    expect(terms.map((x: any) => x.key)).toContain('payment_terms')
    const u = (await prisma.warrantyUpdate.findUnique({ where: { token: tok } }))!
    expect(u).toMatchObject({ acknowledgedBy: 'E2E Update Sent', acknowledgedHow: 'accepted', acknowledgedOption: 1 })
    const contract = pdfText((await raw(`/p/wu/${tok}/contract.pdf`)).buf)
    expect(contract).toContain('Lifetime Craftsmanship Warranty')
    expect(contract).toContain(W.LIFETIME_TEXT)
    // Signed today: the contract shows the whole dollar the proposal showed (D1, Oct 29 2026).
    expect(contract).toContain('$12,901.00')
    expect(pdfText((await raw(`/p/${q.shareToken}/contract.pdf`)).buf)).toContain(W.LIFETIME_TEXT)
    const accepted = await html(`/p/wu/${tok}`)
    expect(accepted).toContain('section class="done"')
    expect(accepted).toMatch(/id="wname">Lifetime Craftsmanship Warranty</)
    const job = (await prisma.savedJob.findFirst({ where: { accountId, quoteId: q.id } }))!
    const jw = (await call('GET', `/api/warranties/job/${job.id}`)).json.data
    expect(jw).toMatchObject({ from: 'update', warranty: { id: W.LIFETIME_ID, term: 'lifetime' }, updated: { by: 'E2E Update Sent', how: 'accepted' } })
  })

  test('a sold quote: acknowledging changes the job\'s warranty and the certificate; the quote and the signed contract stay as signed', async () => {
    const q = await makeQuote('E2E Update Sold', `wu-test-sold-${Date.now().toString(36)}-abcdef`)
    // Accepted before the change, on the old link: TV-ND, with the old 1 Year block.
    expect((await call('POST', `/p/${q.shareToken}/accept`, { option: 2, name: 'E2E Update Sold', signature: SIG }, false)).status).toBe(200)
    const job = (await prisma.savedJob.findFirst({ where: { accountId, quoteId: q.id } }))!
    await prisma.savedJob.update({ where: { id: job.id }, data: { completedDate: '2026-10-01', status: 'completed' } })
    let jw = (await call('GET', `/api/warranties/job/${job.id}`)).json.data
    expect(jw).toMatchObject({ from: 'proposal', warranty: { name: '1 Year Workmanship Warranty' }, updated: null, signed: true })
    // Its certificate, made at the walkthrough before the update.
    const w = await prisma.walkthrough.create({ data: { accountId, jobId: job.id, category: 'vinyl', status: 'completed', completedAt: new Date('2026-10-01T18:00:00Z') } })
    const cert = await makeCertificate(w, [])
    certFiles.push(cert.path)
    await prisma.walkthrough.update({ where: { id: w.id }, data: { certificatePath: cert.path, certificateFileId: cert.portalFileId } })
    let ct = pdfText(fs.readFileSync(cert.path))
    expect(ct).toContain('1 Year Workmanship Warranty')
    expect(ct).not.toContain('Warranty updated on')

    const before = await stored(q.id)
    const pre = (await call('GET', `/api/warranties/quote/${q.id}/update`)).json.data
    expect(pre).toMatchObject({ kind: 'signed', available: true, chosen: 2 })
    expect(pre.options).toHaveLength(1)
    expect(pre.options[0]).toMatchObject({ index: 2, finalPrice: 14814.7, changed: true, warranty: { name: 'Lifetime Craftsmanship Warranty' }, before: { name: '1 Year Workmanship Warranty' } })
    const made = await call('POST', `/api/warranties/quote/${q.id}/update`)
    expect(made.status).toBe(201)
    const tok = made.json.data.latest.token
    await call('POST', `/api/warranties/update/${made.json.data.latest.id}/sent`, { channel: 'email' })

    const page = await html(`/p/wu/${tok}`)
    expect(page).toContain('We\'ve updated the warranty on your fence: <b>Lifetime Craftsmanship Warranty</b>. Your price and everything else stay the same.')
    expect(page).toContain('data-wu-price>$14,815<')
    expect(page).toContain(W.LIFETIME_TEXT.slice(0, 60))
    expect(page).toContain('Before: 1 Year Workmanship Warranty')
    expect(page).toContain('data-wu-ack-form')
    expect(page).toContain('Warranty starts on the install date: October 1, 2026')
    expect(page).not.toContain('id="sig"')
    // Not acknowledged yet: the job keeps the warranty as signed.
    expect((await call('GET', `/api/warranties/job/${job.id}`)).json.data.from).toBe('proposal')
    expect((await call('POST', `/p/wu/${tok}/accept`, { option: 1, name: 'x', signature: SIG }, false)).status).toBe(409)
    expect((await call('POST', `/p/wu/${tok}/acknowledge`, { name: '  ' }, false)).status).toBe(400)
    const ack = await call('POST', `/p/wu/${tok}/acknowledge`, { name: 'Manny Test' }, false)
    expect(ack.status).toBe(200)
    expect((await call('POST', `/p/wu/${tok}/acknowledge`, { name: 'Someone else' }, false)).status).toBe(200)
    const u = (await prisma.warrantyUpdate.findUnique({ where: { token: tok } }))!
    expect(u).toMatchObject({ acknowledgedBy: 'Manny Test', acknowledgedHow: 'acknowledged', acknowledgedOption: 2, jobId: job.id })
    expect(await html(`/p/wu/${tok}`)).toContain('Acknowledged by Manny Test')
    expect(await stored(q.id)).toBe(before)

    jw = (await call('GET', `/api/warranties/job/${job.id}`)).json.data
    expect(jw).toMatchObject({ from: 'update', warranty: { id: W.LIFETIME_ID, name: 'Lifetime Craftsmanship Warranty', term: 'lifetime' }, endText: 'For as long as the customer owns the home', updated: { by: 'Manny Test', how: 'acknowledged', previousName: '1 Year Workmanship Warranty' } })
    // The certificate was made again in place: Lifetime, with the day it was updated.
    ct = pdfText(fs.readFileSync(cert.path))
    expect(ct).toContain('Warranty Lifetime Craftsmanship Warranty')
    expect(ct).toContain(W.LIFETIME_TEXT)
    expect(ct).toMatch(/Warranty updated on [A-Z][a-z]+ \d{1,2}, 20\d\d/)
    expect(ct).toContain('Starts October 1, 2026')
    // The signed contract stays as signed.
    const contract = pdfText((await raw(`/p/${q.shareToken}/contract.pdf`)).buf)
    expect(contract).toContain(W.ONE_YEAR_TEXT)
    expect(contract).not.toContain('Lifetime')
    expect(contract).toContain('$14,815.00')
    // Sending again now: nothing changed for them.
    const after = (await call('GET', `/api/warranties/quote/${q.id}/update`)).json.data
    expect(after.options[0]).toMatchObject({ changed: false, before: { name: 'Lifetime Craftsmanship Warranty' } })

    const hist = await customerHistory(accountId, { customerId: contactId })
    const titles = hist.map(h => h.title)
    expect(titles).toContain('Warranty update sent (Lifetime Craftsmanship Warranty)')
    expect(titles).toContain('Warranty update acknowledged by Manny Test')
    expect(titles).toContain('Proposal accepted on the warranty update by E2E Update Sent')
  })

  test('a draft quote cannot be sent an update; an unknown link is not found', async () => {
    const q = await makeQuote('E2E Update Draft', `wu-test-draft-${Date.now().toString(36)}-abcdef`)
    await prisma.savedQuote.update({ where: { id: q.id }, data: { status: 'DRAFT' } })
    const pre = (await call('GET', `/api/warranties/quote/${q.id}/update`)).json.data
    expect(pre.available).toBe(false)
    expect(pre.why).toMatch(/Send the proposal first/)
    expect((await call('POST', `/api/warranties/quote/${q.id}/update`)).status).toBe(409)
    expect((await raw('/p/wu/not-a-real-link-0000000000')).status).toBe(404)
  })
})
