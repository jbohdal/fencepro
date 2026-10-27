/**
 * Signed documents (dev database, DEV_DB=1; refuses any other):
 *
 * - accepting a proposal stores the signed contract PDF once: its last page
 *   has the typed name, the IP the request came from (X-Forwarded-For through
 *   one trusted proxy, as Tailscale Funnel sends it), the date and time with
 *   the zone, and the option and price accepted; the record is linked to the
 *   customer (their file, visible in the portal), the quote and the job;
 * - accepting again, or filing it three times at once, never makes a second;
 * - a change order signed on its link: the same, with its own PDF;
 * - staff lists by customer, quote and job, and the stored PDF as stored;
 * - the portal's papers list the stored PDFs with file links;
 * - the backfill script reports, and --apply builds the missing one from the
 *   frozen proposal and stored signature with "IP not recorded at the time".
 *
 * Everything happens in a throwaway company, removed afterwards (the backfill's
 * --apply runs over the whole dev database: what it made is removed too).
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import zlib from 'zlib'
import { execFileSync } from 'child_process'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { pdfText } from './pdfText'

/** The text of the last page: pdfkit writes one content stream per page, in order. */
function lastPageText(pdf: Buffer): string {
  const raw = pdf.toString('latin1')
  const pages: Buffer[] = []
  for (const s of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body = Buffer.from(s[1], 'latin1')
    try { body = zlib.inflateSync(body) } catch { /* not compressed */ }
    if (/\bBT\b/.test(body.toString('latin1'))) pages.push(body)
  }
  const last = pages[pages.length - 1]
  // pdfText reads streams out of a PDF; give it just this one.
  return pdfText(Buffer.from(`stream\n${last.toString('latin1')}\nendstream`, 'latin1'))
}
const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('signed documents (dev database)', { timeout: 120_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { publicProposal } = await import('../src/server/routes/proposal.js') as any
  const { changeOrderPublic } = await import('../src/server/routes/changeOrderPublic.js')
  const { default: signedRoutes } = await import('../src/server/routes/signed-documents.js')
  const S = await import('../src/server/lib/signedDocuments.js')
  const { whenSigned } = await import('../src/server/lib/contractPdf.js')
  const { papersOf } = await import('../src/server/lib/portalCustomer.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const UPLOAD = path.resolve(process.env.UPLOAD_DIR || './uploads')
  const started = new Date()

  let accountId = '', contactId = '', owner = '', base = ''
  const quotes: string[] = []
  let server: ReturnType<express.Express['listen']>
  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const post = (p: string, body: unknown, ip: string) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip, 'User-Agent': 'E2E signed docs phone' }, body: JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))
  const staff = (p: string) => fetch(base + p, { headers: { Authorization: `Bearer ${owner}` } })

  const opt = (label: string, tier: string, price: number) => ({
    label, fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: price, perFoot: price / 150, sections: 19, tier: { key: tier, label: tier[0].toUpperCase() + tier.slice(1), blurb: '' },
    warranty: { id: 'lifetime-craftsmanship', name: 'Lifetime Craftsmanship Warranty', text: 'E2E lifetime words.' },
    snapshot: { materialCost: price * 0.4, laborCost: price * 0.2, tearOutCost: 0, totalCOGS: price * 0.6, gmPct: 0.4, pullSheet: [], runSections: [19] },
  })
  async function sentQuote(name: string, extra: Record<string, unknown> = {}) {
    const q = await prisma.savedQuote.create({
      data: {
        accountId, crmContactId: contactId, customerName: name, customerAddress: '5 Signed Way, Ocala, FL', fenceStyle: "WV-ND 6'x8' Privacy", runs: [150], sections: 19,
        finalPrice: 10000, materialCost: 4000, laborCost: 2000, totalCOGS: 6000, gmPct: 0.4, pullSheet: [], status: 'SENT', shareToken: crypto.randomBytes(24).toString('base64url'),
        proposal: { version: 1, footageFt: 150, gatesText: '1 walk gate', included: ['150 ft of new fence'], depositPct: 50, recommended: 1, company: { name: 'Getter Done Fence', phone: '3527894314', email: '' }, customer: { name, address: '5 Signed Way, Ocala, FL' }, options: [opt('Good', 'good', 9000), opt('Better', 'better', 10000)] },
        ...extra,
      } as any,
    })
    quotes.push(q.id)
    return q
  }

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    const top = await prisma.savedQuote.groupBy({ by: ['accountId'], _count: { _all: true }, orderBy: { _count: { accountId: 'desc' } }, take: 1 })
    const src = await prisma.businessState.findUnique({ where: { accountId: top[0].accountId } })
    accountId = (await prisma.crmAccount.create({ data: { name: `Test signed-docs-${Date.now().toString(36)}`, status: 'active' } })).id
    await prisma.businessState.create({ data: { accountId, config: { fenceStyles: (src!.config as any).fenceStyles, fenceCatalog: (src!.config as any).fenceCatalog, company: { name: 'Getter Done Fence', phone: '3527894314' } } as any } })
    contactId = (await prisma.crmContact.create({ data: { accountId, firstName: 'E2E Signed', lastName: 'Docs', phone: '3525550177', serviceAddress: '5 Signed Way, Ocala, FL' } })).id
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express()
    app.set('trust proxy', 1) // as the server (index.ts): one proxy, Tailscale Funnel
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/signed-documents', signedRoutes)
    app.use('/p/co', changeOrderPublic)
    app.use('/p', publicProposal)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    // This company's documents, and whatever the backfill's --apply made on the dev copy during this run.
    // Also any left by other tests that sign on the dev copy and then remove their quotes (no quote any more).
    const all = await prisma.signedDocument.findMany({ select: { id: true, quoteId: true } })
    const live = new Set((await prisma.savedQuote.findMany({ where: { id: { in: all.map(d => d.quoteId) } }, select: { id: true } })).map(q => q.id))
    const docs = await prisma.signedDocument.findMany({ where: { OR: [{ accountId }, { madeBy: 'backfill', createdAt: { gte: started } }, { id: { in: all.filter(d => !live.has(d.quoteId)).map(d => d.id) } }] } })
    for (const d of docs) fs.rmSync(path.resolve(UPLOAD, d.fileKey), { force: true })
    for (const dir of new Set([path.resolve(UPLOAD, 'signed', accountId), ...docs.map(d => path.dirname(path.resolve(UPLOAD, d.fileKey)))])) { try { fs.rmdirSync(dir) } catch { /* not empty or not there */ } }
    try { fs.rmdirSync(path.resolve(UPLOAD, 'signed')) } catch { /* not empty or not there */ }
    await prisma.portalFile.deleteMany({ where: { id: { in: docs.map(d => d.portalFileId).filter((x): x is string => !!x) } } })
    await prisma.signedDocument.deleteMany({ where: { id: { in: docs.map(d => d.id) } } })
    if (!accountId) return
    const jobs = (await prisma.savedJob.findMany({ where: { accountId }, select: { id: true } })).map(j => j.id)
    const pays = (await prisma.contractPayment.findMany({ where: { jobId: { in: jobs } }, select: { id: true } })).map(p => p.id)
    await prisma.paymentApplication.deleteMany({ where: { paymentId: { in: pays } } })
    await prisma.contractPayment.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.contractInvoice.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.billingLog.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.paymentSchedule.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.changeOrder.deleteMany({ where: { accountId } })
    await prisma.jobChecklistItem.deleteMany({ where: { jobId: { in: jobs } } }).catch(() => {})
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: [...jobs, ...quotes] } } as any }).catch(() => {})
    await prisma.appointment.deleteMany({ where: { accountId } })
    await prisma.proposalView.deleteMany({ where: { quoteId: { in: quotes } } })
    await prisma.jobQuotedCost.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...jobs, ...quotes] } } }).catch(() => {})
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.portalFile.deleteMany({ where: { crmCustomerId: contactId } })
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.notification.deleteMany({ where: { title: { startsWith: 'Proposal accepted: E2E Signed' } } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  let quoteId = '', jobId = '', docId = ''
  test('accepting stores the signed contract once, with the name, IP and time on its last page, linked to customer, quote and job', async () => {
    const q = await sentQuote('E2E Signed Docs')
    quoteId = q.id
    const acc = await post(`/p/${q.shareToken}/accept`, { option: 1, name: 'Pat E2E Signer', signature: SIG }, '203.0.113.7')
    expect(acc.status).toBe(200)
    const saved = (await prisma.savedQuote.findUnique({ where: { id: q.id } }))!
    expect(saved.acceptedIp).toBe('203.0.113.7')
    expect(saved.acceptedUserAgent).toBe('E2E signed docs phone')
    const docs = await prisma.signedDocument.findMany({ where: { quoteId: q.id } })
    expect(docs).toHaveLength(1)
    const d = docs[0]
    docId = d.id
    const job = await prisma.savedJob.findFirst({ where: { accountId, quoteId: q.id } })
    jobId = job!.id
    expect(d).toMatchObject({ kind: 'contract', accountId, quoteId: q.id, jobId, signedBy: 'Pat E2E Signer', signedIp: '203.0.113.7', signedUserAgent: 'E2E signed docs phone', madeBy: 'signing', sourceKey: `contract:${q.id}` })
    expect(d.signedAt.getTime()).toBe(saved.acceptedAt!.getTime())
    const pdf = fs.readFileSync(path.resolve(UPLOAD, d.fileKey))
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(crypto.createHash('sha256').update(pdf).digest('hex')).toBe(d.sha256)
    const last = lastPageText(pdf)
    expect(last).toContain('Signed by Pat E2E Signer')
    expect(last).toContain('IP address 203.0.113.7')
    expect(last).toContain(`Date and time ${whenSigned(saved.acceptedAt!)}`)
    expect(whenSigned(saved.acceptedAt!)).toMatch(/ (EDT|EST)$/)
    expect(last).toContain('Accepted Better at $10,000.00')
    // As signed: the warranty's start is not known yet, whatever happens to the job later.
    expect(pdfText(pdf)).toContain('Warranty starts on the install date (set when the fence is installed).')
    // The customer's copy: their file, a contract, visible to them.
    const f = (await prisma.portalFile.findUnique({ where: { id: d.portalFileId! } }))!
    expect(f).toMatchObject({ crmCustomerId: contactId, fileKey: d.fileKey, fileKind: 'contract', source: 'system_generated', isVisibleToCustomer: true, mimeType: 'application/pdf' })
  })

  test('the terms the customer read are frozen at signing and print on every copy, with the IP; a later edit in Settings changes neither', async () => {
    const saved = (await prisma.savedQuote.findUnique({ where: { id: quoteId } }))!
    const terms = (saved.proposal as any).terms as Array<{ key: string; title: string; text: string }>
    // Sent before terms were frozen: Settings' terms (the defaults here, never saved) frozen when it was signed, all but the warranty.
    expect(terms.map(x => x.key)).toEqual(['payment_terms', 'scope_exclusions', 'property_access', 'permits', 'cancellation', 'dispute_resolution'])
    const stored = pdfText(fs.readFileSync(path.resolve(UPLOAD, (await prisma.signedDocument.findUniqueOrThrow({ where: { id: docId } })).fileKey)))
    expect(stored).toContain('Cancellation Policy')
    expect(stored).toContain(terms.find(x => x.key === 'cancellation')!.text)
    // Settings → Contract Templates edited after signing.
    await prisma.businessState.update({ where: { accountId }, data: { contractSections: [{ key: 'cancellation', title: 'Cancellation Policy', body: 'E2E changed later: no cancellations.', visible: true }] as any } })
    const copy = await fetch(`${base}/p/${saved.shareToken}/contract.pdf`)
    expect(copy.status).toBe(200)
    const words = pdfText(Buffer.from(await copy.arrayBuffer()))
    expect(words).toContain(terms.find(x => x.key === 'cancellation')!.text)
    expect(words).not.toContain('E2E changed later')
    // The customer's copy has the IP too, not only the stored one.
    expect(words).toContain('IP address 203.0.113.7')
    // The page itself shows the terms as signed.
    const page = await (await fetch(`${base}/p/${saved.shareToken}`)).text()
    expect(page).toContain('data-proposal-terms')
    expect(page).not.toContain('E2E changed later')
    // An unsigned proposal sent before terms were frozen shows today's terms.
    const fresh = await sentQuote('E2E Signed Terms Today')
    expect(await (await fetch(`${base}/p/${fresh.shareToken}`)).text()).toContain('E2E changed later: no cancellations.')
    await prisma.businessState.update({ where: { accountId }, data: { contractSections: [] as any } })
  })

  test('a repeat accept, a second link accept and three filings at once make no second one', async () => {
    const q = (await prisma.savedQuote.findUnique({ where: { id: quoteId } }))!
    expect((await post(`/p/${q.shareToken}/accept`, { option: 1, name: 'Pat E2E Signer', signature: SIG }, '203.0.113.7')).status).toBe(200)
    expect((await post(`/p/${q.shareToken}/accept`, { option: 0, name: 'Someone Else', signature: SIG }, '198.51.100.2')).status).toBe(409)
    const outs = await Promise.all([1, 2, 3].map(() => S.fileSignedContract(quoteId)))
    expect(outs.every(o => o?.doc.id === docId && o.made === false)).toBe(true)
    expect(await prisma.signedDocument.count({ where: { quoteId, kind: 'contract' } })).toBe(1)
    expect(await prisma.portalFile.count({ where: { crmCustomerId: contactId, fileKind: 'contract' } })).toBe(1)
    // Two at once on a quote with none yet: one record, one file on disk.
    const q2 = await sentQuote('E2E Signed Race', { status: 'SOLD', acceptedAt: new Date(), acceptedBy: 'Race Signer', acceptedSignature: SIG, chosenOption: 0, soldAt: new Date() })
    const race = await Promise.all([1, 2, 3, 4].map(() => S.fileSignedContract(q2.id)))
    expect(new Set(race.map(r => r!.doc.id)).size).toBe(1)
    expect(race.filter(r => r!.made)).toHaveLength(1)
    const files = fs.readdirSync(path.resolve(UPLOAD, 'signed', accountId)).filter(n => n.startsWith(`contract-${q2.id}`))
    expect(files).toHaveLength(1)
    expect(await prisma.portalFile.count({ where: { crmCustomerId: contactId, fileKind: 'contract' } })).toBe(2)
  })

  test('a change order signed on its link: its own signed PDF, once, linked to the quote and job', async () => {
    const token = crypto.randomBytes(32).toString('base64url')
    const co = await prisma.changeOrder.create({ data: { accountId, quoteId, number: 1, status: 'sent', reason: 'Ten more feet', lines: [{ id: 'l1', description: 'Add 10 ft of fence', amountCents: 45000 }], totalCents: 45000, shareToken: token, sentAt: new Date() } })
    const s1 = await post(`/p/co/${token}/sign`, { name: 'Pat E2E Signer', signature: SIG }, '203.0.113.9')
    expect(s1.status).toBe(200)
    expect((await post(`/p/co/${token}/sign`, { name: 'Pat E2E Signer', signature: SIG }, '203.0.113.9')).status).toBe(200)
    const docs = await prisma.signedDocument.findMany({ where: { changeOrderId: co.id } })
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ kind: 'change_order', quoteId, jobId, signedIp: '203.0.113.9', signedBy: 'Pat E2E Signer', sourceKey: `change-order:${co.id}` })
    const signed = (await prisma.changeOrder.findUnique({ where: { id: co.id } }))!
    const pdf = fs.readFileSync(path.resolve(UPLOAD, docs[0].fileKey))
    const all = pdfText(pdf), last = lastPageText(pdf)
    expect(all).toContain('Change Order CO-1')
    expect(all).toContain('Add 10 ft of fence')
    expect(last).toContain('Signed by Pat E2E Signer')
    expect(last).toContain('IP address 203.0.113.9')
    expect(last).toContain(`Date and time ${whenSigned(signed.signedAt!)}`)
    expect(last).toContain('Accepted Change order CO-1: total $450.00')
    expect((await prisma.portalFile.findUnique({ where: { id: docs[0].portalFileId! } }))?.crmCustomerId).toBe(contactId)
  })

  test('staff: Documents by customer, quote and job; the PDF is the stored copy', async () => {
    const byCustomer = (await (await staff(`/api/signed-documents?customerId=${contactId}`)).json()).data
    const byQuote = (await (await staff(`/api/signed-documents?quoteId=${quoteId}`)).json()).data
    const byJob = (await (await staff(`/api/signed-documents?jobId=${jobId}`)).json()).data
    expect(byCustomer.map((d: any) => d.kind).sort()).toEqual(['change_order', 'contract', 'contract'])
    expect(byQuote.map((d: any) => d.title).sort()).toEqual(['Change order CO-1', 'Contract'])
    expect(byJob.map((d: any) => d.id).sort()).toEqual(byQuote.map((d: any) => d.id).sort())
    const c = byQuote.find((d: any) => d.kind === 'contract')
    expect(c).toMatchObject({ signedBy: 'Pat E2E Signer', quoteId, jobId, inPortal: true, detail: 'Better at $10,000.00' })
    expect(c.signedOn).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/)
    expect(c).not.toHaveProperty('signedIp')
    const r = await staff(c.pdf)
    expect(r.headers.get('content-type')).toContain('application/pdf')
    const buf = Buffer.from(await r.arrayBuffer())
    expect(crypto.createHash('sha256').update(buf).digest('hex')).toBe((await prisma.signedDocument.findUnique({ where: { id: c.id } }))!.sha256)
    expect((await fetch(base + c.pdf)).status).toBe(401)
    expect((await staff('/api/signed-documents/not-a-doc/pdf')).status).toBe(404)
  })

  test('the portal: the stored signed PDFs, with file links, from its own field list', async () => {
    const papers = await papersOf({ id: contactId, accountId })
    expect(papers.signed.map(d => d.kind).sort()).toEqual(['change_order', 'contract', 'contract'])
    for (const d of papers.signed) {
      expect(Object.keys(d).sort()).toEqual(['detail', 'id', 'kind', 'quoteId', 'signedBy', 'signedOn', 'title', 'url'])
      expect(d.url).toMatch(/^\/api\/portal\/files\/signed%2F.+\?e=\d+&s=/)
    }
    expect(papers.contracts.find(c => c.quoteId === quoteId)?.stored).toBe(true)
  })

  test('backfill: the report counts it; --apply builds it from the frozen proposal and stored signature, "IP not recorded at the time"', async () => {
    const old = await sentQuote('E2E Signed Backfill', { status: 'SOLD', acceptedAt: new Date('2026-10-01T15:30:00Z'), acceptedBy: 'Old Signer', acceptedSignature: SIG, chosenOption: 0, soldAt: new Date('2026-10-01T15:30:00Z') })
    const run = (...args: string[]) => execFileSync('npx', ['tsx', 'scripts/signed-contracts-backfill.ts', ...args], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, NODE_ENV: 'test' }, timeout: 90_000 }).toString()
    const report = run()
    expect(report).toContain('report only (nothing is written)')
    expect(report).toMatch(/E2E Signed Backfill: 1 \/ 0 \/ 1/)
    expect(report).toContain('Nothing was written.')
    expect(await prisma.signedDocument.count({ where: { quoteId: old.id } })).toBe(0)
    const applied = run('--apply')
    expect(applied).toContain('After:')
    expect(applied).toMatch(/Made \d+ signed PDFs?;/)
    const d = (await prisma.signedDocument.findFirst({ where: { quoteId: old.id } }))!
    expect(d).toMatchObject({ madeBy: 'backfill', signedIp: null, signedBy: 'Old Signer' })
    const pdf = fs.readFileSync(path.resolve(UPLOAD, d.fileKey))
    const last = lastPageText(pdf)
    expect(last).toContain('IP address not recorded at the time')
    expect(last).toContain('Signed by Old Signer')
    expect(last).toContain('Accepted Good at $9,000.00')
    expect(last).toContain('October 1, 2026 at 11:30:00 AM EDT')
    expect(pageCount(pdf)).toBeGreaterThanOrEqual(1)
    // Run again: this one is not made again (other tests may be signing on the dev copy at the same time).
    expect(run('--apply')).toContain('After:')
    expect(await prisma.signedDocument.count({ where: { quoteId: old.id } })).toBe(1)
    expect(run()).toMatch(/E2E Signed Backfill: 1 \/ 1 \/ 0/)
  })
})
