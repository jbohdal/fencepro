/**
 * Florida's lien notice addendum for contracts signed before the notice, on the dev database (DEV_DB=1 and
 * ezbiz_dev only; Jonathan, Nov 6 2026: "prepare the signed notice addendum for the 11 contracts not installed yet,
 * locked until I mark it attorney reviewed; don't send until then. Leave the installed ones alone."). Every row it
 * makes is taken off at the end, and the addendum's review mark is put back as it was.
 *   - who gets one: signed over $2,500, no notice, the job not installed; not a contract with the notice, not one
 *     of $2,500 or less, not a completed job, not a job with a final furnishing date;
 *   - the lock: sending is refused until the owner marks it reviewed; only the owner can mark it; its own mark,
 *     in its own record (no sub settings template); the link shows nothing while locked;
 *   - signing: the customer signs on the link once; the signed PDF is with the contract's documents on the job;
 *     the lien clock counts it as the notice given; it leaves the owner's list.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('lien notice addendum (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { LIEN_NOTICE_713015 } = await import('../src/server/lib/contractTerms.js')
  const { addendumCandidates, ADDENDUM_LOCKED, ADDENDUM_REVIEW_KEY } = await import('../src/server/lib/lienNoticeAddendum.js')
  const { storedPdf } = await import('../src/server/lib/signedDocuments.js')
  const { settingsFrom } = await import('../src/server/lib/subcontractors.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const ND = "WV-ND 6'x8' Privacy"
  const tag = `ln-${Date.now().toString(36)}`
  const made = { contacts: [] as string[], quotes: [] as string[], jobs: [] as string[] }
  let accountId = '', owner = '', office = '', sales = '', base = ''
  let keptReview: any = undefined
  let server: ReturnType<express.Express['listen']>
  const call = (who: string, method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => { const t = await r.text(); let json: any = null; try { json = JSON.parse(t) } catch { /* html */ } return { status: r.status, json, text: t } })
  // A tiny real PNG (the signature pad's ink), as the change order tests sign with.
  const ink = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

  async function soldJob(name: string, price: number, opts: { notice?: boolean; status?: string } = {}) {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'E2E Notice', lastName: `${name} ${tag}`, phone: '3525550166', email: `${tag}-${name.toLowerCase()}@example.invalid` } as any })
    made.contacts.push(c.id)
    const q = await prisma.savedQuote.create({ data: {
      accountId, crmContactId: c.id, customerName: `E2E Notice ${name} ${tag}`, customerAddress: '9 Notice Rd, Ocala FL', customerPhone: '3525550166', customerEmail: `${tag}-${name.toLowerCase()}@example.invalid`,
      fenceStyle: ND, runs: [100], sections: 13, corners: 0, ends: 2, walkGates: 1, dblGates: 0,
      materialCost: 1000, laborCost: 500, totalCOGS: 1500, finalPrice: price, gmPct: 0.25, pullSheet: [], status: 'SOLD', soldAt: new Date('2026-10-20T15:00:00Z'),
      proposal: { options: [{ label: 'Good', fenceStyle: ND, finalPrice: price }], ...(opts.notice ? { lienNotice: LIEN_NOTICE_713015 } : {}) },
    } as any })
    made.quotes.push(q.id)
    const r = await call(owner, 'POST', '/api/saved-jobs', { quoteId: q.id, crmContactId: c.id, customerName: q.customerName, customerAddress: q.customerAddress, fenceStyle: ND, quotePrice: price, contractValue: price, status: 'staging', sections: 13, estimatedDays: 1 })
    expect(r.status).toBe(201)
    made.jobs.push(r.json.data.id)
    return { jobId: r.json.data.id as string, quoteId: q.id }
  }

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    const tok = (role: string) => jwt.sign({ sub: user.id, email: user.email, role, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    owner = tok('super_admin'); office = tok('office_staff'); sales = tok('sales_rep')
    keptReview = (await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: ADDENDUM_REVIEW_KEY } } }))?.value ?? null
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/subcontractors', (await import('../src/server/routes/subcontractors.js')).default)
    app.use('/api/saved-jobs', (await import('../src/server/routes/saved-jobs.js')).default)
    app.use('/api/liens', (await import('../src/server/routes/liens.js')).default)
    app.use('/api/lien-addenda', (await import('../src/server/routes/lienAddenda.js')).default)
    app.use('/api/signed-documents', (await import('../src/server/routes/signed-documents.js')).default)
    app.use('/p/ln', (await import('../src/server/routes/lienNoticePublic.js')).lienNoticePublic)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    // Start locked, whatever dev had.
    await call(owner, 'POST', '/api/lien-addenda/reviewed', { reviewed: false })
  })

  afterAll(async () => {
    server?.close()
    const docs = await prisma.signedDocument.findMany({ where: { quoteId: { in: made.quotes } } })
    for (const d of docs) { const p = await storedPdf(accountId, d.id).catch(() => null); if (p) (await import('fs')).rmSync((await import('path')).resolve(process.env.UPLOAD_DIR || './uploads', d.fileKey), { force: true }) }
    await prisma.portalFile.deleteMany({ where: { id: { in: docs.map(d => d.portalFileId).filter((x): x is string => !!x) } } })
    await prisma.signedDocument.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.lienNoticeAddendum.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.task.deleteMany({ where: { jobId: { in: made.jobs } } }).catch(() => {})
    await prisma.activityLog.deleteMany({ where: { entityId: { in: made.jobs } } }).catch(() => {})
    await prisma.paymentSchedule.deleteMany({ where: { jobId: { in: made.jobs } } }).catch(() => {})
    await prisma.billingLog.deleteMany({ where: { jobId: { in: made.jobs } } }).catch(() => {})
    await prisma.savedJob.deleteMany({ where: { id: { in: made.jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: made.contacts } } })
    // The addendum's review mark as it was before this test (its own record: nothing else touches it).
    const key = { accountId_key: { accountId, key: ADDENDUM_REVIEW_KEY } }
    if (keptReview === null) await prisma.accountKeyValue.deleteMany({ where: { accountId, key: ADDENDUM_REVIEW_KEY } })
    else await prisma.accountKeyValue.update({ where: key, data: { value: keptReview } })
  })

  test('who gets one: signed over $2,500, no notice, not installed', async () => {
    const yes = await soldJob('Yes', 6400)
    const withNotice = await soldJob('HasNotice', 6400, { notice: true })
    const small = await soldJob('Small', 2500)
    const completed = await soldJob('Completed', 8000)
    await prisma.savedJob.update({ where: { id: completed.jobId }, data: { status: 'completed', completedDate: '2026-11-02' } as any })
    const subInstalled = await soldJob('SubInstalled', 8000)
    await prisma.savedJob.update({ where: { id: subInstalled.jobId }, data: { finalFurnishingDate: '2026-11-03' } as any })

    const { list } = await addendumCandidates(accountId)
    const mine = list.filter(c => made.quotes.includes(c.quoteId))
    expect(mine.map(c => c.quoteId)).toEqual([yes.quoteId])
    expect(mine[0]).toMatchObject({ jobId: yes.jobId, priceCents: 640000, signedOn: '2026-10-20', jobStatus: 'staging' })

    // The job page: the candidate shows it, locked; the others get nothing.
    const v = await call(office, 'GET', `/api/lien-addenda/job/${yes.jobId}`)
    expect(v.status).toBe(200)
    expect(v.json.data).toMatchObject({ applies: true, state: 'locked', reviewed: null, lockedWhy: ADDENDUM_LOCKED, notice: LIEN_NOTICE_713015 })
    expect(v.json.data.contractLine).toContain('signed October 20, 2026')
    expect(v.json.data.contractLine).toContain('$6,400.00')
    for (const j of [withNotice, small, completed, subInstalled]) {
      expect((await call(office, 'GET', `/api/lien-addenda/job/${j.jobId}`)).json.data).toEqual({ applies: false })
    }
    // The Salesman gets none of it.
    expect((await call(sales, 'GET', `/api/lien-addenda/job/${yes.jobId}`)).status).toBe(403)
    // The owner's list says the same, with its state.
    const l = await call(owner, 'GET', '/api/liens')
    const row = l.json.data.noNotice.find((x: any) => x.quoteId === yes.quoteId)
    expect(row).toMatchObject({ jobId: yes.jobId, addendum: 'locked' })
    expect(l.json.data.noNotice.some((x: any) => [withNotice, small, completed, subInstalled].some(j => j.quoteId === x.quoteId))).toBe(false)
  }, 30_000)

  test('locked until the owner marks it reviewed; the link shows nothing while locked; signed once and filed', async () => {
    const { jobId, quoteId } = await soldJob('Sign', 7300)
    // Locked: every send is refused with the reason; nothing is made.
    for (const channel of ['email', 'text', 'copy']) {
      const r = await call(office, 'POST', `/api/lien-addenda/job/${jobId}/send`, { channel })
      expect(r.status).toBe(409)
      expect(r.json.error).toBe(ADDENDUM_LOCKED)
    }
    expect(await prisma.lienNoticeAddendum.count({ where: { quoteId } })).toBe(0)
    // Only the owner marks it; its mark is its own (not one of the sub settings' templates).
    expect((await call(office, 'POST', '/api/lien-addenda/reviewed', { reviewed: true })).status).toBe(403)
    expect((await call(owner, 'POST', '/api/subcontractors/settings/reviewed', { reviewed: true, template: 'lien_notice_addendum' })).status).toBe(400)
    expect(Object.keys(settingsFrom({ reviews: { lien_notice_addendum: { at: '2026-11-06T12:00:00Z', by: 'x' } } }).reviews)).toEqual([])
    const mark = await call(owner, 'POST', '/api/lien-addenda/reviewed', { reviewed: true })
    expect(mark.status).toBe(200)
    expect(mark.json.data.reviewed.at).toBeTruthy()
    expect((await call(office, 'GET', `/api/lien-addenda/job/${jobId}`)).json.data.state).toBe('ready')

    // Email: through the server's email; under tests the outbound gate holds it (not sent, not marked sent).
    const em = await call(office, 'POST', `/api/lien-addenda/job/${jobId}/send`, { channel: 'email' })
    expect(em.status).toBe(200)
    expect(em.json.data.sent).toBe(false)
    expect(em.json.data.view.state).toBe('ready')
    // Text it: the office's own phone; marked sent with the link and the message.
    const tx = await call(office, 'POST', `/api/lien-addenda/job/${jobId}/send`, { channel: 'text' })
    expect(tx.status).toBe(200)
    expect(tx.json.data.sent).toBe(true)
    expect(tx.json.data.link).toMatch(/\/p\/ln\/[A-Za-z0-9_-]{20,}$/)
    expect(tx.json.data.message).toContain(tx.json.data.link)
    expect(tx.json.data.view.state).toBe('sent')
    const token = tx.json.data.addendum.token as string
    expect(tx.json.data.link).toBe(em.json.data.link) // one link per contract

    // The customer's link: the notice word for word and the contract it names.
    const page = await call('', 'GET', `/p/ln/${token}`)
    expect(page.status).toBe(200)
    expect(page.text).toContain('data-lien-notice')
    expect(page.text).toMatch(/ACCORDING TO FLORIDA(&#39;|&#x27;|')S CONSTRUCTION LIEN LAW \(SECTIONS 713\.001-713\.37, FLORIDA STATUTES\)/)
    expect(page.text).toContain('9 Notice Rd, Ocala FL')
    // The mark taken off: the link shows nothing, signing and sending are refused.
    await call(owner, 'POST', '/api/lien-addenda/reviewed', { reviewed: false })
    expect((await call('', 'GET', `/p/ln/${token}`)).status).toBe(404)
    expect((await call('', 'POST', `/p/ln/${token}/sign`, { name: 'Pat Owner', signature: ink })).status).toBe(409)
    expect((await call(office, 'POST', `/api/lien-addenda/job/${jobId}/send`, { channel: 'copy' })).json.error).toBe(ADDENDUM_LOCKED)
    expect((await call(office, 'GET', `/api/lien-addenda/job/${jobId}`)).json.data.state).toBe('locked')
    await call(owner, 'POST', '/api/lien-addenda/reviewed', { reviewed: true })

    // Signing: a name and the ink are needed; then signed once.
    expect((await call('', 'POST', `/p/ln/${token}/sign`, { name: '', signature: ink })).status).toBe(400)
    const s = await call('', 'POST', `/p/ln/${token}/sign`, { name: 'Pat Owner', signature: ink })
    expect(s.status).toBe(200)
    expect((await call('', 'POST', `/p/ln/${token}/sign`, { name: 'Someone Else', signature: ink })).status).toBe(200)
    const a = (await prisma.lienNoticeAddendum.findUnique({ where: { quoteId } }))!
    expect(a.signedBy).toBe('Pat Owner')
    expect(a.signedDocumentId).toBeTruthy()

    // The signed copy lives with the contract's documents on the job (and the customer's portal copy).
    const docs = await call(office, 'GET', `/api/signed-documents?jobId=${jobId}`)
    const d = docs.json.data.find((x: any) => x.kind === 'lien_notice')
    expect(d).toMatchObject({ title: 'Florida lien notice (addendum)', signedBy: 'Pat Owner', jobId, inPortal: true })
    expect(d.detail).toContain('signed October 20, 2026')
    const pdf = await fetch(`${base}${d.pdf}`, { headers: { Authorization: `Bearer ${office}` } })
    expect(pdf.status).toBe(200)
    expect(pdf.headers.get('content-type')).toBe('application/pdf')
    expect((await call('', 'GET', `/p/ln/${token}/signed.pdf`)).status).toBe(200)
    // The page now says signed; the job says signed; sending again is refused.
    expect((await call('', 'GET', `/p/ln/${token}`)).text).toContain('data-ln-signed')
    expect((await call(office, 'GET', `/api/lien-addenda/job/${jobId}`)).json.data.state).toBe('signed')
    expect((await call(office, 'POST', `/api/lien-addenda/job/${jobId}/send`, { channel: 'copy' })).status).toBe(409)

    // The owner's lien clock counts it as the notice given; it leaves the list of contracts without the notice.
    await prisma.savedJob.update({ where: { id: jobId }, data: { finalFurnishingDate: '2026-11-04' } as any })
    const lv = await call(owner, 'GET', `/api/liens/job/${jobId}`)
    expect(lv.json.data.notice).toMatchObject({ needed: true, given: true, how: 'addendum' })
    const l = await call(owner, 'GET', '/api/liens')
    expect(l.json.data.noNotice.some((x: any) => x.quoteId === quoteId)).toBe(false)
    // Installed after it was signed: the job still shows the signed addendum.
    expect((await call(office, 'GET', `/api/lien-addenda/job/${jobId}`)).json.data.state).toBe('signed')
  }, 30_000)
})
