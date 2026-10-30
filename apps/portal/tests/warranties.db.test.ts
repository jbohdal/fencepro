/**
 * Warranties per option, end to end on the server (dev database, DEV_DB=1;
 * refuses any other):
 *
 * - the one-time step saves the two warranties and the mapping, once;
 * - a Good / Better / Best quote saved: each option carries its warranty; the
 *   customer's page shows a badge per option and the recommended option's words;
 * - a Settings warranty edit afterwards leaves the sent proposal's words as sent;
 * - accepting Better (no dig) puts the Lifetime words in the signed contract
 *   PDF, then the install date once the job is done; the job's warranty and a
 *   service call's coverage (and staff override) follow;
 * - accepting a dig set option puts the 1 Year words in, never Lifetime.
 *
 * Everything happens in a throwaway company (its own Settings, a copy of the
 * dev company's fence styles), removed afterwards. Writes only inside
 * beforeAll, test and afterAll.
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
describe.skipIf(!process.env.DEV_DB || !onDev)('warranties per option (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedQuotes } = await import('../src/server/routes/saved-quotes.js')
  const { default: warrantyRoutes } = await import('../src/server/routes/warranties.js')
  const { publicProposal } = await import('../src/server/routes/proposal.js') as any
  const { ensureWarranties, WARRANTIES_KEY } = await import('../src/server/lib/warranties.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const W = await import('../../web/src/warranties')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  let accountId = '', contactId = '', owner = '', base = ''
  const certFiles: string[] = []
  let server: ReturnType<express.Express['listen']>
  const call = (method: string, p: string, body?: unknown, auth = true) => fetch(base + p, { method, headers: { ...(auth ? { Authorization: `Bearer ${owner}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))
  const raw = (p: string) => fetch(base + p).then(async r => ({ status: r.status, type: r.headers.get('content-type') || '', buf: Buffer.from(await r.arrayBuffer()) }))
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  const opt = (label: string, tier: string, fenceStyle: string, price: number) => ({
    label, fenceStyle, finalPrice: price, perFoot: price / 150, sections: 19, tier: { key: tier, label, blurb: '' },
    snapshot: { materialCost: price * 0.4, laborCost: price * 0.2, tearOutCost: 0, totalCOGS: price * 0.6, gmPct: 0.4, pullSheet: [], runSections: [19] },
  })
  const quote = (name: string, options: any[], recommended: number) => ({
    customerName: name, customerPhone: '3525550188', customerAddress: '9 Warranty Test Way, Ocala, FL', crmContactId: contactId,
    fenceStyle: options[recommended].fenceStyle, runs: [150], sections: 19, corners: 0, ends: 2, walkGates: 1,
    materialCost: 4000, laborCost: 2000, tearOutCost: 0, totalCOGS: 6000, finalPrice: options[recommended].finalPrice, gmPct: 0.4,
    pullSheet: [], status: 'DRAFT',
    proposal: { version: 1, footageFt: 150, gatesText: '1 walk gate', included: ['150 ft of new fence'], includedNote: '', warranty: 'Contract Templates words',
      depositPct: 50, depositNote: '', financing: null, recommended, options, company: { name: 'Getter Done Fence', phone: '3527894314', email: '' },
      customer: { name, address: '9 Warranty Test Way, Ocala, FL' } },
  })
  const GBB = () => [
    opt('Good', 'good', "WV-DS 6'x8' Privacy", 9000),
    opt('Better', 'better', "WV-ND 6'x8' Privacy", 10000),
    opt('Best', 'best', 'wood/sb/6/premium/ds/8', 11000),
  ]

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    // The dev company's styles (wood included), in a throwaway company of its own.
    const top = await prisma.savedQuote.groupBy({ by: ['accountId'], _count: { _all: true }, orderBy: { _count: { accountId: 'desc' } }, take: 1 })
    const src = await prisma.businessState.findUnique({ where: { accountId: top[0].accountId } })
    const account = await prisma.crmAccount.create({ data: { name: `Test warranties-${Date.now().toString(36)}`, status: 'active' } })
    accountId = account.id
    // With the real wood styles and their kits, every wood part priced (Oct 30 2026: wood is held until it is).
    const { planWoodRealKits } = await import('../../web/src/wood')
    const wood = planWoodRealKits({ fenceStyles: (src!.config as any).fenceStyles, fenceCatalog: (src!.config as any).fenceCatalog, items: [], kits: [] })
    await prisma.businessState.create({ data: { accountId, config: { fenceStyles: wood.state.fenceStyles, fenceCatalog: wood.state.fenceCatalog } as any } })
    await prisma.inventoryState.create({ data: { accountId, items: wood.state.items.map(i => ({ ...i, unitCost: i.unitCost || 0.05 })) as any, kits: wood.state.kits as any, bundles: [], locations: [], stockLevels: [], transactions: [] } })
    contactId = (await prisma.crmContact.create({ data: { accountId, firstName: 'E2E', lastName: 'Warranty Test', phone: '3525550188', serviceAddress: '9 Warranty Test Way, Ocala, FL' } })).id
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-quotes', savedQuotes)
    app.use('/api/warranties', warrantyRoutes)
    app.use('/p', publicProposal)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const quotes = (await prisma.savedQuote.findMany({ where: { accountId }, select: { id: true } })).map(q => q.id)
    await prisma.appointment.deleteMany({ where: { accountId } })
    await prisma.proposalView.deleteMany({ where: { quoteId: { in: quotes } } })
    await prisma.jobQuotedCost.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    for (const f of certFiles) { fs.rmSync(f, { force: true }); try { fs.rmdirSync(path.dirname(f)) } catch { /* not empty */ } }
    if (contactId) await prisma.portalFile.deleteMany({ where: { crmCustomerId: contactId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.notification.deleteMany({ where: { title: { startsWith: 'Proposal accepted: E2E Warranty' } } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('the one-time step saves both warranties and the mapping, once', async () => {
    expect(await ensureWarranties(accountId)).toEqual({ added: true })
    expect(await ensureWarranties(accountId)).toBeNull()
    const cfg = (await prisma.businessState.findUnique({ where: { accountId } }))!.config as any
    expect(cfg.warranties).toEqual(W.defaultWarrantySettings())
    expect(cfg.fenceStyles.length).toBeGreaterThan(10)
    expect(await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: WARRANTIES_KEY } } })).not.toBeNull()
  })

  let sentId = '', token = ''
  test('Good / Better / Best: a badge and the words per option; the page switches the words as the customer picks', async () => {
    const made = await call('POST', '/api/saved-quotes', quote('E2E Warranty GBB', GBB(), 1))
    expect(made.status).toBe(201)
    sentId = made.json.data.id
    const p = made.json.data.proposal
    expect(p.options.map((o: any) => o.warranty.name)).toEqual(['1 Year Workmanship Warranty', 'Lifetime Craftsmanship Warranty', '1 Year Workmanship Warranty'])
    expect(p.options[1].warranty.text).toBe(W.LIFETIME_TEXT)
    expect(p.options[2].warranty.text).toBe(`${W.ONE_YEAR_TEXT}\n${W.WOOD_EXTRA}`)
    expect(p.warranty).toBe(W.LIFETIME_TEXT)
    // Sent.
    expect((await call('PATCH', `/api/saved-quotes/${sentId}`, { status: 'SENT', proposal: p })).status).toBe(200)
    token = (await call('POST', `/api/saved-quotes/${sentId}/share-token`)).json.data.shareToken
    const page = (await raw(`/p/${token}`)).buf.toString()
    const badges = [...page.matchAll(/data-warranty-badge>([^<]+)</g)].map(m => m[1])
    expect(badges).toEqual(['1 Year Workmanship Warranty', 'Lifetime Craftsmanship Warranty', '1 Year Workmanship Warranty'])
    expect(page).toMatch(/id="wname">Lifetime Craftsmanship Warranty</)
    expect(page).toContain('For as long as you own your home, Getter Done Fence will repair or replace')
    // The words of every option ride in the page's script for the switch.
    expect(page).toContain(JSON.stringify(W.ONE_YEAR_TEXT).slice(1, 60))
  })

  test('a Settings warranty edit leaves the sent proposal as sent', async () => {
    const b = (await prisma.businessState.findUnique({ where: { accountId } }))!
    const cfg = b.config as any
    const edited = { ...cfg, warranties: { ...cfg.warranties, list: cfg.warranties.list.map((w: any) => (w.id === W.LIFETIME_ID ? { ...w, name: 'Edited Lifetime', text: 'Edited lifetime words' } : w)) } }
    await prisma.businessState.update({ where: { accountId }, data: { config: edited, version: { increment: 1 } } })
    const before = (await prisma.savedQuote.findUnique({ where: { id: sentId } }))!.proposal as any
    // The quote builder saves the quote again (a note), with the proposal rebuilt (no warranties on it).
    const rebuilt = { ...quote('E2E Warranty GBB', GBB(), 1).proposal, warranty: 'Contract Templates words' }
    const saved = await call('PATCH', `/api/saved-quotes/${sentId}`, { notes: 'called back', proposal: rebuilt })
    expect(saved.status).toBe(200)
    const after = saved.json.data.proposal
    expect(after.options.map((o: any) => o.warranty)).toEqual(before.options.map((o: any) => o.warranty))
    expect(after.warranty).toBe(before.warranty)
    const page = (await raw(`/p/${token}`)).buf.toString()
    expect(page).not.toContain('Edited')
    // A new quote saved now gets the edited words.
    const fresh = await call('POST', '/api/saved-quotes', quote('E2E Warranty Fresh', GBB(), 1))
    expect(fresh.json.data.proposal.options[1].warranty.name).toBe('Edited Lifetime')
    // Back to the starting words for the rest.
    await prisma.businessState.update({ where: { accountId }, data: { config: cfg, version: { increment: 1 } } })
  })

  test('Contract Templates terms and the company address are frozen on the proposal when saved; a sent one keeps them', async () => {
    const b = (await prisma.businessState.findUnique({ where: { accountId } }))!
    const cfg = b.config as any
    // The sent proposal was saved with today's terms (the defaults: never edited on this company), none of them the warranty.
    const sent = (await prisma.savedQuote.findUnique({ where: { id: sentId } }))!.proposal as any
    expect(sent.terms.map((x: any) => x.key)).toEqual(['payment_terms', 'scope_exclusions', 'property_access', 'permits', 'cancellation', 'dispute_resolution'])
    expect(sent.company?.address).toBeUndefined()
    await prisma.businessState.update({ where: { accountId }, data: { contractSections: [{ key: 'payment_terms', title: 'Payment Terms', body: 'E2E edited: paid in full up front.', visible: true }] as any, config: { ...cfg, company: { ...(cfg.company ?? {}), address: '1 E2E Way', city: 'Ocala', state: 'FL', zip: '34470' } }, version: { increment: 1 } } })
    const again = await call('PATCH', `/api/saved-quotes/${sentId}`, { notes: 'called again', proposal: quote('E2E Warranty GBB', GBB(), 1).proposal })
    expect(again.json.data.proposal.terms).toEqual(sent.terms)
    expect(again.json.data.proposal.company?.address).toBeUndefined()
    const page = (await raw(`/p/${token}`)).buf.toString()
    expect(page).toContain('data-proposal-terms')
    expect(page).not.toContain('E2E edited')
    const fresh = await call('POST', '/api/saved-quotes', quote('E2E Terms Fresh', GBB(), 1))
    expect(fresh.json.data.proposal.terms.find((x: any) => x.key === 'payment_terms').text).toBe('E2E edited: paid in full up front.')
    expect(fresh.json.data.proposal.company.address).toBe('1 E2E Way, Ocala, FL 34470')
    await prisma.businessState.update({ where: { accountId }, data: { contractSections: [] as any, config: cfg, version: { increment: 1 } } })
  })

  test('accepting Better (no dig): the signed contract has the Lifetime words; the install date once known; job and service calls', async () => {
    const acc = await call('POST', `/p/${token}/accept`, { option: 1, name: 'E2E Warranty GBB', signature: SIG }, false)
    expect(acc.status).toBe(200)
    const page = (await raw(`/p/${token}`)).buf.toString()
    expect(page).toContain('data-contract-pdf')
    expect(page).toMatch(/id="wname">Lifetime Craftsmanship Warranty</)
    expect(page).toContain('Warranty starts on the install date (set when the fence is installed).')
    const pdf = await raw(`/p/${token}/contract.pdf`)
    expect(pdf.type).toContain('application/pdf')
    const text = pdfText(pdf.buf)
    expect(text).toContain('Lifetime Craftsmanship Warranty')
    expect(text).toContain(W.LIFETIME_TEXT)
    expect(text).not.toContain(W.ONE_YEAR_TEXT)
    expect(text).toContain('Warranty starts on the install date (set when the fence is installed).')

    // Installed: the date shows on the contract and the job.
    const job = (await prisma.savedJob.findFirst({ where: { accountId, quoteId: sentId } }))!
    expect(job).toBeTruthy()
    await prisma.savedJob.update({ where: { id: job.id }, data: { completedDate: '2026-11-03', status: 'completed' } })
    expect(pdfText((await raw(`/p/${token}/contract.pdf`)).buf)).toContain('Warranty starts on the install date: November 3, 2026')
    const staffPdf = await fetch(`${base}/api/warranties/quote/${sentId}/contract.pdf`, { headers: { Authorization: `Bearer ${owner}` } })
    expect(pdfText(Buffer.from(await staffPdf.arrayBuffer()))).toContain(W.LIFETIME_TEXT)

    // A service call ten years on is covered (lifetime); staff can say otherwise, with a reason.
    const a = await prisma.appointment.create({ data: { accountId, crmContactId: contactId, jobId: job.id, type: 'service', startAt: new Date('2036-05-05T14:00:00Z'), notes: 'Post leaning' } })
    let jw = (await call('GET', `/api/warranties/job/${job.id}`)).json.data
    expect(jw.warranty).toMatchObject({ id: W.LIFETIME_ID, name: 'Lifetime Craftsmanship Warranty', term: 'lifetime' })
    expect(jw).toMatchObject({ from: 'option', start: '2026-11-03', end: null, endText: 'For as long as the customer owns the home', contract: true })
    expect(jw.serviceCalls[0]).toMatchObject({ id: a.id, day: '2036-05-05', coverage: { covered: true, label: 'Covered by warranty' } })
    expect((await call('POST', `/api/warranties/service/${a.id}/override`, { covered: false, reason: '' })).status).toBe(400)
    jw = (await call('POST', `/api/warranties/service/${a.id}/override`, { covered: false, reason: 'Hit by a car' })).json.data
    expect(jw.serviceCalls[0].coverage).toMatchObject({ covered: false, label: 'Not covered', overridden: true })
    expect(jw.serviceCalls[0].coverage.why).toContain('Hit by a car')
    jw = (await call('POST', `/api/warranties/service/${a.id}/override`, { covered: null, reason: '' })).json.data
    expect(jw.serviceCalls[0].coverage).toMatchObject({ covered: true, overridden: false })

    // The completion certificate is the warranty certificate: type, start date, address, coverage.
    const { makeCertificate } = await import('../src/server/lib/walkthroughCertificate.js')
    const cert = await makeCertificate({ id: 'e2e-warranty-walk', accountId, jobId: job.id, category: 'vinyl', items: [], photos: [], homeownerSig: null, repSig: null }, [])
    certFiles.push(cert.path)
    const ct = pdfText(fs.readFileSync(cert.path))
    expect(ct).toContain('Warranty Certificate')
    expect(ct).toContain('Certificate of Completion')
    expect(ct).toContain('Warranty Lifetime Craftsmanship Warranty')
    expect(ct).toContain('Starts November 3, 2026')
    expect(ct).toContain('Covers For as long as the customer owns the home')
    expect(ct).toContain('9 Warranty Test Way, Ocala, FL')
    expect(ct).toContain(W.LIFETIME_TEXT)
  })

  test('accepting a dig set option: the contract has the 1 Year words, the job ends a year after install', async () => {
    const made = await call('POST', '/api/saved-quotes', quote('E2E Warranty DS', GBB(), 1))
    const id = made.json.data.id
    await call('PATCH', `/api/saved-quotes/${id}`, { status: 'SENT', proposal: made.json.data.proposal })
    const t = (await call('POST', `/api/saved-quotes/${id}/share-token`)).json.data.shareToken
    expect((await call('POST', `/p/${t}/accept`, { option: 0, name: 'E2E Warranty DS', signature: SIG }, false)).status).toBe(200)
    const text = pdfText((await raw(`/p/${t}/contract.pdf`)).buf)
    expect(text).toContain('1 Year Workmanship Warranty')
    expect(text).toContain(W.ONE_YEAR_TEXT)
    expect(text).not.toContain('Lifetime')
    const job = (await prisma.savedJob.findFirst({ where: { accountId, quoteId: id } }))!
    await prisma.savedJob.update({ where: { id: job.id }, data: { completedDate: '2026-11-03', status: 'completed' } })
    await prisma.appointment.create({ data: { accountId, crmContactId: contactId, jobId: job.id, type: 'service', startAt: new Date('2027-06-01T14:00:00Z') } })
    await prisma.appointment.create({ data: { accountId, crmContactId: contactId, jobId: job.id, type: 'warranty', startAt: new Date('2028-01-15T14:00:00Z') } })
    const jw = (await call('GET', `/api/warranties/job/${job.id}`)).json.data
    expect(jw.warranty).toMatchObject({ id: W.ONE_YEAR_ID, term: 'years', years: 1 })
    expect(jw).toMatchObject({ start: '2026-11-03', end: '2027-11-03', endText: 'Through November 3, 2027' })
    expect(jw.serviceCalls.map((c: any) => c.coverage.label)).toEqual(['Covered by warranty', 'Not covered'])
  })
})
