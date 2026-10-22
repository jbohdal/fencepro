/**
 * The customer portal shows only what Jonathan listed (Oct 22, 2026): photos
 * marked Customer, their site plan, billing (payment schedule, invoices,
 * payments, receipts, balance), their signed contract and warranty
 * certificate. Never pull sheets, material lists, costs, internal notes,
 * internal or crew photos, the crew packet, follow ups or call logs. Enforced
 * on the server: every answer a portal login can get is checked here.
 * Dev database only (DEV_DB=1, ezbiz_dev); removes everything it made.
 *
 * One customer whose records hold all of the forbidden things: an internal
 * note, an internal photo and a crew photo, a sent quote with a pull sheet and
 * costs (and a proposal whose options carry a cost snapshot), a sold quote
 * with its job, an install packet (crew link), a follow up and a call log, a
 * document the office kept internal, a photo the office uploaded, a payment
 * with an office note and check number. Signed in through the real
 * POST /api/portal/login, every customer route the portal app calls is walked
 * and no answer holds any of those values or field names; the allowed things
 * (photo marked Customer, site plan, schedule, payment, receipt link, contract
 * and certificate PDFs) are there.
 */

import 'dotenv/config'
import express from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('the customer portal shows only what Jonathan listed (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: portal } = await import('../src/server/routes/portal.js')
  const { portalPublicApi, CUSTOMER_ROUTES } = await import('../src/server/routes/portalPublic.js')
  const { hashPassword } = await import('../src/server/lib/auth.js')
  const billing = await import('../src/server/lib/contractBilling.js')
  const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'

  const stamp = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`
  const S = (x: string) => `${x}-${stamp}`
  // What must never reach the customer (values unique to this run).
  const SECRET = {
    note: S('INTERNAL NOTE gate code 4471'), followUp: S('FOLLOWUP call back after payday'), callLog: S('CALLLOG said wife decides'),
    jobNote: S('JOBNOTE dog bites'), quoteNote: S('QUOTENOTE margin is thin'), payNote: S('PAYNOTE check was post dated'),
    item: S('Pipe PT40 Secret Part'), internalDoc: S('internal-estimate'), staffPhoto: S('office-photo'), crew: S('Crew Alpha'),
    unitCost: '1234.56', packetToken: crypto.randomBytes(24).toString('base64url'), recordedBy: S('Office Person'),
  }
  const FORBIDDEN_FIELDS = ['materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'gmPct', 'pullSheet', 'unitCost', 'unitCostCents', 'totalCostCents', 'pricing', 'layout',
    'proposal', 'snapshot', 'notes', 'crewAssigned', 'recordedBy', 'photoKey', 'senderUser', 'visibility', 'takenBy', 'lat', 'lng', 'cardId', 'outcome', 'token']
  const made = { contact: '', portal: '', quotes: [] as string[], job: '', media: [] as string[], note: '', packet: '', callLog: '', walk: '', tmp: '', cardId: S('card') }
  let accountId = '', base = '', cookie = '', doorCookie = ''
  const ids: Record<string, string> = {}
  let server: ReturnType<express.Express['listen']>

  const get = async (p: string, ck = cookie) => {
    const r = await fetch(base + p, { headers: { Cookie: ck } })
    const buf = Buffer.from(await r.arrayBuffer())
    return { status: r.status, type: r.headers.get('content-type') || '', text: buf.toString('utf8'), buf }
  }
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    const app = express()
    app.set('trust proxy', 1)
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/portal', portal)
    app.use('/p/portal/api', portalPublicApi)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    made.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-only-'))

    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'E2E Only', lastName: stamp, phone: '3525550177', serviceAddress: '7 Only Way, Ocala' } as any })
    made.contact = c.id
    await prisma.crmContactNote.create({ data: { crmContactId: c.id, accountId, body: SECRET.note, visibility: 'internal', createdBy: 'Office' } })
    await prisma.callLog.create({ data: { id: S('calllog'), accountId, cardId: made.cardId, crmContactId: c.id, userId: user.id, outcome: 'deciding', note: SECRET.callLog } })
    made.callLog = S('calllog')
    await prisma.cardFollowUp.create({ data: { accountId, cardId: made.cardId, stage: 'quoted', stageSince: '2026-10-20', dueOn: '2026-10-25', lastOutcome: SECRET.followUp } })

    const sheet = [{ item: SECRET.item, qty: 21, unitCost: Number(SECRET.unitCost), total: 21 * Number(SECRET.unitCost) }]
    const planSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>${S('PLAN')}</title><rect width="10" height="10"/></svg>`
    const proposal = { version: 1, planSvg, options: [{ label: 'White vinyl', fenceStyle: "WV-ND 6'x6' Privacy", finalPrice: 4321, perFoot: 40, sections: 12, snapshot: { materialCost: 1111.11, laborCost: 999.99, pullSheet: sheet } }], depositPct: 50 }
    const quoteBase = { accountId, crmContactId: c.id, customerName: `E2E Only ${stamp}`, fenceStyle: "WV-ND 6'x6' Privacy", runs: [96], pullSheet: sheet, materialCost: 2591.76, laborCost: 777.77, totalCOGS: 3369.53, gmPct: 0.31, notes: SECRET.quoteNote, pricing: { laborMode: 'subcontractor', subRate: 9.87 }, layout: { yard: null, runSections: [12] }, proposal } as any
    const sent = await prisma.savedQuote.create({ data: { ...quoteBase, status: 'SENT', finalPrice: 4321, date: '2026-10-20', shareToken: crypto.randomBytes(16).toString('hex') } })
    const sold = await prisma.savedQuote.create({ data: { ...quoteBase, status: 'SOLD', finalPrice: 4321, date: '2026-10-19', acceptedAt: new Date(), acceptedBy: 'E2E Only', soldAt: new Date(), chosenOption: 0 } })
    made.quotes.push(sent.id, sold.id)
    ids.sent = sent.id; ids.sold = sold.id
    const job = await prisma.savedJob.create({ data: { accountId, quoteId: sold.id, crmContactId: c.id, customerName: `E2E Only ${stamp}`, fenceStyle: "WV-ND 6'x6' Privacy", status: 'scheduled', scheduledDate: '2026-11-03', quotePrice: 4321, contractValue: 4321, gmPct: 0.31, crewAssigned: SECRET.crew, notes: SECRET.jobNote } as any })
    made.job = job.id
    await prisma.installPacket.create({ data: { accountId, jobId: job.id, token: SECRET.packetToken, snapshot: { pullSheet: [{ item: SECRET.item, qty: 21 }] } } })
    // Billing: the schedule, a check with an office note.
    expect(await billing.ensureSchedule(accountId, job.id, 'button', { userId: user.id, name: SECRET.recordedBy }, { force: true })).toBeTruthy()
    // The payment and its receipt as rows (a number far from the company's sequence: recordPayment would take the
    // next real number, and contractBilling.db.test.ts, running at the same time, checks that sequence).
    const payId = S('pay').replace(/[^A-Za-z0-9_-]/g, '')
    const sched = (await prisma.paymentSchedule.findUnique({ where: { accountId_jobId: { accountId, jobId: job.id } } }))!
    await prisma.contractPayment.create({ data: { id: payId, accountId, jobId: job.id, quoteId: sold.id, crmContactId: c.id, amountCents: 216050, method: 'check', checkNumber: '5150', paidOn: '2026-10-22', note: SECRET.payNote, recordedById: user.id, recordedBy: SECRET.recordedBy } })
    const receipt = await prisma.receipt.create({ data: { accountId, number: 900_000_000 + Math.floor(Math.random() * 99_000_000), paymentId: payId, jobId: job.id, crmContactId: c.id, token: crypto.randomBytes(24).toString('base64url'), snapshot: { note: SECRET.payNote } } })
    void sched
    const pay = { payment: { id: payId }, receipt }
    ids.payment = pay.payment.id
    ids.receiptToken = pay.receipt.token
    // A finished walkthrough's certificate.
    const cert = path.join(made.tmp, 'cert.pdf')
    fs.writeFileSync(cert, '%PDF-1.4 certificate')
    const w = await prisma.walkthrough.create({ data: { accountId, jobId: job.id, status: 'completed', completedAt: new Date(), certificatePath: cert } })
    made.walk = w.id
    // Photos: one marked Customer (shown), one Internal, one Crew (never).
    for (const [vis, cat] of [['customer', 'Before'], ['internal', 'Site walk'], ['crew', 'Progress']] as const) {
      const f = path.join(made.tmp, `${vis}.png`)
      fs.writeFileSync(f, png)
      const m = await prisma.mediaItem.create({ data: { accountId, clientId: S(`only-${vis}`), kind: 'photo', mime: 'image/png', path: f, bytes: png.length, customerId: c.id, jobId: vis === 'crew' ? job.id : null, takenAt: new Date(), takenBy: 'Office Person', lat: 29.1, lng: -82.1, caption: S(`caption-${vis}`), category: cat, visibility: vis, status: 'ready' } })
      made.media.push(m.id)
      ids[`media_${vis}`] = m.id
    }
    // The office's own documents and photo: one internal document, one shared document, one photo uploaded on the customer page.
    ensureDir(path.resolve(UPLOAD_DIR, 'portal', c.id))
    const mk = async (model: 'portalFile' | 'portalPhoto', name: string, extra: Record<string, unknown>) => {
      const key = path.join('portal', c.id, `${crypto.randomUUID()}.${model === 'portalFile' ? 'pdf' : 'png'}`)
      fs.writeFileSync(path.resolve(UPLOAD_DIR, key), model === 'portalFile' ? '%PDF-1.4 x' : png)
      return (prisma as any)[model].create({ data: { crmCustomerId: c.id, uploadedByUser: SECRET.recordedBy, fileKey: key, fileUrl: `/api/portal/files/${encodeURIComponent(key)}`, originalFilename: name, fileSizeBytes: 10, mimeType: model === 'portalFile' ? 'application/pdf' : 'image/png', source: 'crm_staff', ...extra } })
    }
    ids.internalDoc = (await mk('portalFile', `${SECRET.internalDoc}.pdf`, { isVisibleToCustomer: false, label: SECRET.internalDoc })).id
    ids.sharedDoc = (await mk('portalFile', 'hoa-approval.pdf', { isVisibleToCustomer: true, label: 'HOA approval' })).id
    ids.staffPhoto = (await mk('portalPhoto', `${SECRET.staffPhoto}.png`, { caption: SECRET.staffPhoto })).id
    // A message from the office (signed by a staff login).
    await prisma.portalMessage.create({ data: { crmCustomerId: c.id, senderUser: SECRET.recordedBy, senderType: 'staff', body: 'Your fence is on the schedule.' } })

    const email = `e2e-only-${stamp}@example.invalid`
    const a = await prisma.portalAccount.create({ data: { email, crmCustomerId: c.id, status: 'active', passwordHash: await hashPassword('e2e-only-pass-1'), firstName: 'E2E Only' } })
    made.portal = a.id
    const signIn = async (door: string) => {
      const r = await fetch(`${base}${door}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'e2e-only-pass-1' }) })
      expect(r.status).toBe(200)
      return (r.headers.get('set-cookie') || '').split(';')[0]
    }
    cookie = await signIn('/api/portal')
    doorCookie = await signIn('/p/portal/api')
    // The customer's own photo, uploaded in the portal.
    const fd = new FormData()
    fd.append('file', new Blob([png], { type: 'image/png' }), 'my-yard.png')
    const up = await fetch(`${base}/api/portal/photos`, { method: 'POST', headers: { Cookie: cookie, 'X-Portal-Request': '1' }, body: fd })
    expect(up.status).toBe(200)
    ids.ownPhoto = (await up.json()).data.id
  }, 60_000)

  function ensureDir(d: string) { fs.mkdirSync(d, { recursive: true }) }

  afterAll(async () => {
    const receipts = await prisma.receipt.findMany({ where: { jobId: made.job } })
    const files = await prisma.portalFile.findMany({ where: { crmCustomerId: made.contact } })
    for (const f of files) { try { fs.unlinkSync(path.resolve(UPLOAD_DIR, f.fileKey)) } catch { /* gone */ } }
    const pays = await prisma.contractPayment.findMany({ where: { jobId: made.job } })
    await prisma.paymentApplication.deleteMany({ where: { paymentId: { in: pays.map(p => p.id) } } })
    await prisma.receipt.deleteMany({ where: { jobId: made.job } })
    await prisma.contractPayment.deleteMany({ where: { jobId: made.job } })
    await prisma.contractInvoice.deleteMany({ where: { jobId: made.job } })
    await prisma.billingLog.deleteMany({ where: { jobId: made.job } })
    await prisma.paymentSchedule.deleteMany({ where: { jobId: made.job } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [made.job, ...pays.map(p => p.id), ...receipts.map(r => r.id)] } } })
    await prisma.walkthrough.deleteMany({ where: { jobId: made.job } })
    await prisma.installPacket.deleteMany({ where: { jobId: made.job } })
    await prisma.mediaItem.deleteMany({ where: { id: { in: made.media } } })
    await prisma.jobChecklistItem.deleteMany({ where: { jobId: made.job } }).catch(() => {})
    await prisma.automationEvent.deleteMany({ where: { entityId: { in: [made.job, ...made.quotes, made.contact] } } as any }).catch(() => {})
    await prisma.savedJob.deleteMany({ where: { id: made.job } })
    await prisma.jobQuotedCost.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId, cardId: made.cardId } })
    await prisma.callLog.deleteMany({ where: { id: made.callLog } })
    await prisma.portalFile.deleteMany({ where: { crmCustomerId: made.contact } })
    await prisma.portalPhoto.deleteMany({ where: { crmCustomerId: made.contact } })
    await prisma.portalMessage.deleteMany({ where: { crmCustomerId: made.contact } })
    await prisma.notification.deleteMany({ where: { body: { contains: stamp } } }).catch(() => {})
    await prisma.portalAccount.deleteMany({ where: { id: made.portal } })
    await prisma.crmContactNote.deleteMany({ where: { crmContactId: made.contact } })
    await prisma.crmContact.deleteMany({ where: { id: made.contact } })
    fs.rmSync(path.resolve(UPLOAD_DIR, 'portal', made.contact), { recursive: true, force: true })
    if (made.tmp) fs.rmSync(made.tmp, { recursive: true, force: true })
    server?.close()
  })

  /** Every customer GET the portal app calls. */
  const READS = ['/me', '/company', '/quotes', '/projects', '/billing', '/invoices', '/papers', '/change-orders', '/photos', '/documents', '/media', '/messages']

  test('every customer route the portal calls is in the public door\'s list, and nothing else is', () => {
    const gets = CUSTOMER_ROUTES.filter(([m]) => m === 'GET').map(([, re]) => re)
    for (const p of [...READS, `/site-plans/x.svg`, `/contracts/x.pdf`, `/certificates/x.pdf`]) expect(gets.some(re => re.test(p)), p).toBe(true)
    for (const p of ['/pull-sheets', '/packet', '/follow-ups', '/call-logs', '/notes', '/install-packets']) expect(gets.some(re => re.test(p)), p).toBe(false)
  })

  test('no answer holds a pull sheet, cost, internal note, internal or crew photo, crew packet, follow up or call log', async () => {
    const forbiddenValues = [...Object.values(SECRET), ids.media_internal, ids.media_crew, ids.internalDoc, ids.staffPhoto, made.cardId, '1111.11', '999.99', '2591.76', '777.77', '3369.53', '9.87']
    const fieldRe = new RegExp(`"(${FORBIDDEN_FIELDS.join('|')})"\\s*:`)
    for (const door of ['/api/portal', '/p/portal/api']) {
      for (const p of READS) {
        const r = await get(door + p, door === '/api/portal' ? cookie : doorCookie)
        expect(r.status, door + p).toBe(200)
        for (const v of forbiddenValues) expect(r.text.includes(v), `${door}${p} holds ${v}`).toBe(false)
        expect(r.text.match(fieldRe)?.[1] ?? null, `${door}${p} field`).toBeNull()
      }
    }
    // The site plan and the PDFs are files, not data: none of it in them either.
    for (const p of [`/site-plans/${ids.sent}.svg`, `/contracts/${ids.sold}.pdf`, `/certificates/${made.job}.pdf`]) {
      const r = await get('/api/portal' + p)
      expect(r.status, p).toBe(200)
      for (const v of forbiddenValues) expect(r.text.includes(v), `${p} holds ${v}`).toBe(false)
    }
  })

  test('the allowed things are there', async () => {
    const j = async (p: string) => JSON.parse((await get('/api/portal' + p)).text).data
    const quotes = await j('/quotes')
    expect(quotes.map((q: any) => q.id).sort()).toEqual([ids.sent, ids.sold].sort())
    const sent = quotes.find((q: any) => q.id === ids.sent)
    expect(sent).toMatchObject({ priceCents: 432100, hasPlan: true, status: 'SENT' })
    expect(Object.keys(sent).sort()).toEqual(['date', 'hasContract', 'hasPlan', 'id', 'priceCents', 'shareToken', 'status', 'style'])
    expect(sent.style).not.toMatch(/WV-ND/) // the plain name, not the code
    expect(quotes.find((q: any) => q.id === ids.sold).hasContract).toBe(true)
    // Their site plan, as an image.
    const plan = await get(`/api/portal/site-plans/${ids.sent}.svg`)
    expect(plan.type).toMatch(/image\/svg\+xml/)
    expect(plan.text).toContain(S('PLAN'))
    // Photos: their own upload, and the one marked Customer; never the office's photo, internal or crew ones.
    expect((await j('/photos')).map((p: any) => p.id)).toEqual([ids.ownPhoto])
    expect((await j('/media')).map((m: any) => m.id)).toEqual([ids.media_customer])
    // Documents: shared and the receipt filed; never the internal one.
    const docs = (await j('/documents')).map((d: any) => d.id)
    expect(docs).toContain(ids.sharedDoc)
    expect(docs).not.toContain(ids.internalDoc)
    // Billing: the schedule, the payment, the receipt link and the balance.
    const b = (await j('/billing'))[0]
    expect(b).toMatchObject({ jobId: made.job, contractCents: 432100, paidCents: 216050, balanceCents: 216050 })
    expect(b.invoices.map((i: any) => i.label).length).toBeGreaterThanOrEqual(2)
    expect(b.payments[0]).toMatchObject({ amountCents: 216050, receipt: { link: `/p/r/${ids.receiptToken}`, pdf: `/p/r/${ids.receiptToken}.pdf` } })
    // The signed contract and the warranty certificate.
    const papers = await j('/papers')
    expect(papers.contracts.map((c: any) => c.quoteId)).toEqual([ids.sold])
    expect(papers.certificates.map((c: any) => c.jobId)).toEqual([made.job])
    const contract = await get(`/api/portal/contracts/${ids.sold}.pdf`)
    expect(contract.type).toBe('application/pdf')
    expect(contract.buf.subarray(0, 5).toString()).toBe('%PDF-')
    expect((await get(`/api/portal/certificates/${made.job}.pdf`)).buf.toString()).toBe('%PDF-1.4 certificate')
    // The job: its status and install date only.
    expect((await j('/projects'))[0]).toEqual({ id: made.job, style: expect.any(String), status: 'scheduled', scheduledDate: '2026-11-03', address: '' })
    // A quote not signed has no contract; another customer's quote or job: not found.
    expect((await get(`/api/portal/contracts/${ids.sent}.pdf`)).status).toBe(404)
    const other = await prisma.savedQuote.findFirst({ where: { accountId, crmContactId: { not: made.contact }, status: 'SOLD', deletedAt: null }, select: { id: true } })
    if (other) expect((await get(`/api/portal/contracts/${other.id}.pdf`)).status).toBe(404)
  })
})
