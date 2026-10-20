/**
 * A portal customer can never see another customer's files, photos, messages,
 * quotes or change orders (Jonathan, Oct 20, 2026). Dev database only
 * (DEV_DB=1, ezbiz_dev); writes only inside beforeAll, test and afterAll and
 * removes everything it made (rows and files).
 *
 * Two customers, A and B, each with a portal login (signed in through the real
 * POST /api/portal/login, so the session cookie), an uploaded photo and
 * document, a message each way, a sent quote, a sold quote with its job, a
 * sent change order and a photo the office shared (MediaItem, Customer).
 *
 * Signed in as A:
 *   - every portal list holds A's things and nothing of B's (no B id and no
 *     B customer id anywhere in any answer);
 *   - B's things asked for directly: B's file paths (unsigned, A's cookie, a
 *     signature made for another file, a run out one), B's media links, the
 *     office's per customer routes for B, deleting B's photo or document,
 *     signing B's change order, and re-using B's ids as upload or message ids
 *     all give 401 / 403 / 404 and change nothing of B's.
 * Also: a made up cookie, the old Bearer token (even signed with the real
 * secret, naming B), a login with no customer, a signed out session, a
 * suspended login, and a write without the portal's write header.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('portal isolation: customer A never sees customer B (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: portal } = await import('../src/server/routes/portal.js')
  const { default: changeOrders } = await import('../src/server/routes/change-orders.js')
  const { serveSignedMedia } = await import('../src/server/routes/media.js')
  const { mediaUrl } = await import('../src/server/lib/media.js')
  const { signedFileUrl } = await import('../src/server/lib/portalFiles.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { hashPassword } = await import('../src/server/lib/auth.js')
  const staffSecret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const portalSecret = resolveSecret('JWT_SECRET', 'dev-secret-change-me')
  const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'

  const stamp = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`
  const made = { contacts: [] as string[], quotes: [] as string[], jobs: [] as string[], portal: [] as string[], media: [] as string[], tmp: '' }
  let accountId = '', owner = '', base = '', noCustomer = ''
  let server: ReturnType<express.Express['listen']>

  interface Who {
    contactId: string; cookie: string; portalId: string
    photo: any; doc: any; staffDoc: any; msg: any; staffMsg: any; sentQuote: string; soldQuote: string; job: string; co: string; media: string
  }
  const A = {} as Who, B = {} as Who

  type Ans = { status: number; json: any; text: string }
  const call = async (who: string, method: string, p: string, body?: unknown, extra: Record<string, string> = {}): Promise<Ans> => {
    const headers: Record<string, string> = { ...extra }
    if (who.startsWith('ezbiz_portal=')) { headers.Cookie = who; if (method !== 'GET' && !('X-Portal-Request' in extra)) headers['X-Portal-Request'] = '1' }
    else if (who) headers.Authorization = `Bearer ${who}`
    if (body !== undefined && !(body instanceof FormData)) headers['Content-Type'] = 'application/json'
    for (const [k, v] of Object.entries(extra)) if (v === '') delete headers[k]
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) })
    const text = await r.text()
    let json: any = null
    try { json = JSON.parse(text) } catch { /* a file or empty */ }
    return { status: r.status, json, text }
  }
  const pngBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  const form = (name: string, type: string, bytes: Buffer, fields: Record<string, string> = {}) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(fields)) fd.append(k, v)
    fd.append('file', new Blob([bytes], { type }), name)
    return fd
  }
  const filePath = (u: string) => u.replace(/^https?:\/\/[^/]+/, '')

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, staffSecret, { expiresIn: '10m' })
    const app = express()
    app.set('trust proxy', 1)
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/portal', portal)
    app.use('/api/change-orders', changeOrders)
    app.get('/api/media/f/:id/:variant', (req, res) => { void serveSignedMedia(req, res) })
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    made.tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-iso-'))

    const passwordHash = await hashPassword('e2e-iso-pass-1')
    const signIn = async (email: string, crmCustomerId: string) => {
      const a = await prisma.portalAccount.create({ data: { email, crmCustomerId, status: 'active', passwordHash, firstName: 'E2E Iso' } })
      made.portal.push(a.id)
      const r = await fetch(`${base}/api/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'e2e-iso-pass-1' }) })
      const raw = r.headers.get('set-cookie') || ''
      expect(raw).toMatch(/HttpOnly/i)
      expect(raw).toMatch(/SameSite=Strict/i)
      expect(raw).toMatch(/Path=\/api\/portal/)
      const json = await r.json()
      expect(JSON.stringify(json)).not.toMatch(/accessToken|refreshToken/)
      return { cookie: raw.split(';')[0], portalId: a.id }
    }

    for (const [w, n] of [[A, 'A'], [B, 'B']] as const) {
      const c = await prisma.crmContact.create({ data: { accountId, firstName: 'E2E Iso', lastName: `${n} ${stamp}`, phone: n === 'A' ? '3525550101' : '3525550102', serviceAddress: `${n} Iso Street` } as any })
      made.contacts.push(c.id)
      w.contactId = c.id
      Object.assign(w, await signIn(`e2e-iso-${n.toLowerCase()}-${stamp}@example.invalid`, c.id))
      const sent = await prisma.savedQuote.create({ data: { accountId, crmContactId: c.id, customerName: `E2E Iso ${n}`, fenceStyle: "WV-ND 6'x6' Privacy", runs: [40], pullSheet: [], finalPrice: n === 'A' ? 1111 : 2222, totalCOGS: 600, materialCost: 400, status: 'SENT', date: '2026-10-20' } as any })
      const sold = await prisma.savedQuote.create({ data: { accountId, crmContactId: c.id, customerName: `E2E Iso ${n}`, fenceStyle: "WV-ND 6'x8' Privacy", runs: [80], pullSheet: [], finalPrice: n === 'A' ? 3333 : 4444, totalCOGS: 900, materialCost: 500, status: 'SOLD', soldAt: new Date(), date: '2026-10-19' } as any })
      made.quotes.push(sent.id, sold.id)
      w.sentQuote = sent.id; w.soldQuote = sold.id
      const job = await prisma.savedJob.create({ data: { accountId, quoteId: sold.id, customerName: `E2E Iso ${n}`, fenceStyle: "WV-ND 6'x8' Privacy", status: 'scheduled', scheduledDate: '2026-11-02', quotePrice: 4444, contractValue: 4444 } as any })
      made.jobs.push(job.id)
      w.job = job.id
      const co = (await call(owner, 'POST', '/api/change-orders', { quoteId: sold.id, reason: `Iso ${n}`, lines: [{ id: 'l1', description: `Gate for ${n}`, amountCents: 30000 }] })).json.data
      expect((await call(owner, 'PATCH', `/api/change-orders/${co.id}`, { baseVersion: co.version, status: 'sent' })).status).toBe(200)
      w.co = co.id
      // The customer's own uploads and message, through the portal.
      const ph = await call(w.cookie, 'POST', '/api/portal/photos', form(`iso-${n}.png`, 'image/png', pngBytes, { clientId: `iso-photo-${n}-${stamp}` }))
      expect(ph.status).toBe(200)
      w.photo = ph.json.data
      const doc = await call(w.cookie, 'POST', '/api/portal/documents', form(`iso-${n}.pdf`, 'application/pdf', Buffer.from(`%PDF-1.4 iso ${n}`), { clientId: `iso-doc-${n}-${stamp}`, label: `Doc ${n}` }))
      expect(doc.status).toBe(200)
      w.doc = doc.json.data
      const msg = await call(w.cookie, 'POST', '/api/portal/messages', { body: `Hello from ${n}`, clientId: `iso-msg-${n}-${stamp}` })
      expect(msg.status).toBe(200)
      w.msg = msg.json.data
      // The office's side: a document and a reply for this customer.
      const sd = await call(owner, 'POST', `/api/portal/customer/${c.id}/documents`, form(`office-${n}.pdf`, 'application/pdf', Buffer.from(`%PDF-1.4 office ${n}`), { label: `Office doc ${n}` }))
      expect(sd.status).toBe(200)
      w.staffDoc = sd.json.data
      const sm = await call(owner, 'POST', `/api/portal/customer/${c.id}/messages`, { body: `Office reply to ${n}`, sender: 'E2E' })
      expect(sm.status).toBe(200)
      w.staffMsg = sm.json.data
      // A photo the office shared with the customer.
      const f = path.join(made.tmp, `media-${n}.png`)
      fs.writeFileSync(f, pngBytes)
      const m = await prisma.mediaItem.create({ data: { accountId, clientId: `iso-media-${n}-${stamp}`, kind: 'photo', mime: 'image/png', path: f, bytes: pngBytes.length, customerId: c.id, takenAt: new Date(), caption: `Shared with ${n}`, category: 'Progress', visibility: 'customer', status: 'ready' } })
      made.media.push(m.id)
      w.media = m.id
    }
    noCustomer = (await signIn(`e2e-iso-none-${stamp}@example.invalid`, '')).cookie
  }, 60_000)

  afterAll(async () => {
    await prisma.changeOrder.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: made.jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: made.quotes } } })
    await prisma.mediaItem.deleteMany({ where: { id: { in: made.media } } })
    await prisma.portalPhoto.deleteMany({ where: { crmCustomerId: { in: made.contacts } } })
    await prisma.portalFile.deleteMany({ where: { crmCustomerId: { in: made.contacts } } })
    await prisma.portalMessage.deleteMany({ where: { crmCustomerId: { in: made.contacts } } })
    await prisma.notification.deleteMany({ where: { body: { contains: stamp } } }).catch(() => {})
    await prisma.portalAccount.deleteMany({ where: { id: { in: made.portal } } }) // sessions go with them
    await prisma.crmContact.deleteMany({ where: { id: { in: made.contacts } } })
    for (const c of made.contacts) fs.rmSync(path.resolve(UPLOAD_DIR, 'portal', c), { recursive: true, force: true })
    if (made.tmp) fs.rmSync(made.tmp, { recursive: true, force: true })
    server?.close()
  })

  const idsOf = (w: Who) => [w.contactId, w.photo.id, w.doc.id, w.staffDoc.id, w.msg.id, w.staffMsg.id, w.sentQuote, w.soldQuote, w.job, w.co, w.media, w.photo.fileKey, w.doc.fileKey]

  test('every portal list signed in as A holds A\'s things and nothing of B\'s', async () => {
    const me = await call(A.cookie, 'GET', '/api/portal/me')
    expect(me.status).toBe(200)
    expect(me.json.data).toMatchObject({ crmCustomerId: A.contactId, customer: { serviceAddress: 'A Iso Street' } })
    const lists: Record<string, Ans> = {}
    for (const p of ['/me', '/quotes', '/projects', '/invoices', '/photos', '/documents', '/messages', '/change-orders', '/media']) {
      lists[p] = await call(A.cookie, 'GET', `/api/portal${p}`)
      expect(lists[p].status, p).toBe(200)
      // Nothing of B's, anywhere in the answer.
      for (const id of idsOf(B)) expect(lists[p].text.includes(id), `${p} holds B's ${id}`).toBe(false)
      expect(lists[p].text, p).not.toMatch(/Iso B|Gate for B|Hello from B|Office reply to B|Shared with B|B Iso Street|2222|4444/)
    }
    const ids = (p: string) => (lists[p].json.data as any[]).map(x => x.id)
    expect(ids('/quotes').sort()).toEqual([A.sentQuote, A.soldQuote].sort())
    expect(lists['/quotes'].json.data.find((q: any) => q.id === A.sentQuote).priceCents).toBe(111100)
    expect(lists['/quotes'].text).not.toMatch(/totalCOGS|materialCost|gmPct|pullSheet/)
    expect(ids('/projects')).toEqual([A.job])
    expect(ids('/photos')).toEqual([A.photo.id])
    expect(ids('/documents').sort()).toEqual([A.doc.id, A.staffDoc.id].sort())
    expect(lists['/messages'].json.data.messages.map((m: any) => m.id).sort()).toEqual([A.msg.id, A.staffMsg.id].sort())
    expect(ids('/change-orders')).toEqual([A.co])
    expect(ids('/media')).toEqual([A.media])
    // And B, signed in, sees B's own (the lists are not just empty).
    expect((await call(B.cookie, 'GET', '/api/portal/quotes')).json.data.map((q: any) => q.id).sort()).toEqual([B.sentQuote, B.soldQuote].sort())
  })

  test('B\'s files and media asked for directly: 404 / 403; A\'s own links work', async () => {
    const own = await call(A.cookie, 'GET', filePath(A.photo.fileUrl))
    expect(own.status).toBe(200)
    // B's signed link was only ever given to B; without it, B's file is not there.
    const bareB = `/api/portal/files/${encodeURIComponent(B.photo.fileKey)}`
    for (const u of [bareB, `/api/portal/files/${B.photo.fileKey}`, `/api/portal/files/${encodeURIComponent(B.doc.fileKey)}`]) {
      expect((await call('', 'GET', u)).status, u).toBe(404)
      expect((await call(A.cookie, 'GET', u)).status, u).toBe(404)
    }
    // A's own signature on B's path: refused. A made up or run out signature: refused.
    const aQuery = A.photo.fileUrl.split('?')[1]
    expect((await call(A.cookie, 'GET', `${bareB}?${aQuery}`)).status).toBe(404)
    expect((await call(A.cookie, 'GET', `${bareB}?e=${Date.now() + 3_600_000}&s=${'x'.repeat(32)}`)).status).toBe(404)
    const old = signedFileUrl(B.photo.fileKey, Date.now() - 8 * 86_400_000)
    expect((await call(A.cookie, 'GET', old)).status).toBe(404)
    // Not a way out of the folder either.
    expect((await call(A.cookie, 'GET', `/api/portal/files/${encodeURIComponent('../.env')}`)).status).toBe(404)
    // B's media: no signature, or A's signature on B's id: refused.
    expect((await call(A.cookie, 'GET', `/api/media/f/${B.media}/original`)).status).toBe(403)
    const aMedia = mediaUrl(A.media, 'original').split('?')[1]
    expect((await call(A.cookie, 'GET', `/api/media/f/${B.media}/original?${aMedia}`)).status).toBe(403)
    const aList = await call(A.cookie, 'GET', '/api/portal/media')
    expect((await call('', 'GET', filePath(aList.json.data[0].originalUrl))).status).toBe(200)
  })

  test('B\'s things through every other door: refused, and nothing of B\'s changes', async () => {
    // The office's per customer routes, with A's cookie.
    for (const p of [`/customer/${B.contactId}/photos`, `/customer/${B.contactId}/documents`, `/customer/${B.contactId}/messages`, '/accounts', '/messages/inbox']) {
      const r = await call(A.cookie, 'GET', `/api/portal${p}`)
      expect(r.status, p).toBe(401)
      for (const id of idsOf(B)) expect(r.text.includes(id), p).toBe(false)
    }
    expect((await call(A.cookie, 'POST', `/api/portal/customer/${B.contactId}/messages`, { body: 'not mine' })).status).toBe(401)
    // Deleting B's photo or document (the portal has no delete; the office's needs a staff sign in).
    expect((await call(A.cookie, 'DELETE', `/api/portal/photos/${B.photo.id}`)).status).toBe(401)
    expect((await call(A.cookie, 'DELETE', `/api/portal/documents/${B.doc.id}`)).status).toBe(401)
    // No "one by id" routes exist for customers.
    for (const p of [`/photos/${B.photo.id}`, `/documents/${B.doc.id}`, `/messages/${B.msg.id}`, `/quotes/${B.sentQuote}`, `/change-orders/${B.co}`, `/projects/${B.job}`]) {
      const r = await call(A.cookie, 'GET', `/api/portal${p}`)
      expect([404, 401], p).toContain(r.status)
      // Express's own "Cannot GET <path>" page repeats the path asked for; nothing else of B's.
      const rest = r.text.split(`/api/portal${p}`).join('')
      for (const id of idsOf(B)) expect(rest.includes(id), p).toBe(false)
    }
    // Signing B's change order as A: not found, and it stays waiting for B.
    const sig = 'data:image/png;base64,' + pngBytes.toString('base64')
    expect((await call(A.cookie, 'POST', `/api/portal/change-orders/${B.co}/sign`, { name: 'Intruder', signature: sig })).status).toBe(404)
    expect((await prisma.changeOrder.findUnique({ where: { id: B.co } }))!.status).toBe('sent')
    // Re-using B's ids as A's upload and message ids: a new row of A's, never B's row back.
    const p2 = await call(A.cookie, 'POST', '/api/portal/photos', form('again.png', 'image/png', pngBytes, { clientId: B.photo.id }))
    expect(p2.status).toBe(200)
    expect(p2.json.data.id).not.toBe(B.photo.id)
    expect(p2.json.data.customerId).toBe(A.contactId)
    const d2 = await call(A.cookie, 'POST', '/api/portal/documents', form('again.pdf', 'application/pdf', Buffer.from('%PDF-1.4 again'), { clientId: B.doc.id }))
    expect(d2.json.data.id).not.toBe(B.doc.id)
    const m2 = await call(A.cookie, 'POST', '/api/portal/messages', { body: 'again', clientId: B.msg.id })
    expect(m2.json.data.id).not.toBe(B.msg.id)
    expect(m2.json.data.customerId).toBe(A.contactId)
    expect(await prisma.portalPhoto.findUnique({ where: { id: B.photo.id } })).toMatchObject({ crmCustomerId: B.contactId, deletedAt: null })
    expect(await prisma.portalFile.findUnique({ where: { id: B.doc.id } })).toMatchObject({ crmCustomerId: B.contactId, deletedAt: null })
    expect((await prisma.portalMessage.findMany({ where: { crmCustomerId: B.contactId } })).map(m => m.body).sort()).toEqual(['Hello from B', 'Office reply to B'])
  })

  test('made up, old style, customerless, signed out and suspended sign ins read nothing; writes need the portal header', async () => {
    const reads = ['/me', '/quotes', '/projects', '/invoices', '/photos', '/documents', '/messages', '/change-orders', '/media']
    const forged = `ezbiz_portal=${crypto.randomBytes(32).toString('base64url')}`
    // The old portal token, made with the real secret and naming B, as a header and as the cookie.
    const oldJwt = jwt.sign({ sub: B.portalId, email: 'x@example.invalid', role: 'portal_customer', accountId: B.contactId, crmCustomerId: B.contactId }, portalSecret, { expiresIn: '10m' })
    for (const who of [forged, oldJwt, `ezbiz_portal=${oldJwt}`, noCustomer, '']) {
      for (const p of reads) {
        const r = await call(who, 'GET', `/api/portal${p}`)
        expect(r.status, `${who.slice(0, 24)} ${p}`).toBe(401)
        for (const id of idsOf(B)) expect(r.text.includes(id)).toBe(false)
      }
      // 401 (no live session), or 403 first when the portal's write header is missing.
      expect([401, 403]).toContain((await call(who, 'POST', `/api/portal/change-orders/${B.co}/sign`, { name: 'Forged', signature: 'data:image/png;base64,' + pngBytes.toString('base64') })).status)
      expect((await call(who, 'POST', `/api/portal/change-orders/${B.co}/sign`, { name: 'Forged', signature: 'data:image/png;base64,' + pngBytes.toString('base64') }, { 'X-Portal-Request': '1' })).status).toBe(401)
    }
    // A write without the portal's header (what a form on another site would send): refused before anything.
    const noHeader = await call(A.cookie, 'POST', '/api/portal/messages', { body: 'cross site' }, { 'X-Portal-Request': '' })
    expect(noHeader.status).toBe(403)
    expect(await prisma.portalMessage.count({ where: { crmCustomerId: A.contactId, body: 'cross site' } })).toBe(0)

    // Signed out: that cookie no longer works (a second sign in of A's still does).
    const second = await fetch(`${base}/api/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `e2e-iso-a-${stamp}@example.invalid`, password: 'e2e-iso-pass-1' }) })
    const secondCookie = (second.headers.get('set-cookie') || '').split(';')[0]
    const out = await call(A.cookie, 'POST', '/api/portal/logout', {})
    expect(out.status).toBe(200)
    expect((await call(A.cookie, 'GET', '/api/portal/quotes')).status).toBe(401)
    expect((await call(secondCookie, 'GET', '/api/portal/quotes')).status).toBe(200)
    // Suspended by the office: every session of that login stops at once.
    expect((await call(owner, 'POST', `/api/portal/accounts/${B.portalId}/revoke`)).status).toBe(200)
    expect((await call(B.cookie, 'GET', '/api/portal/quotes')).status).toBe(401)
    expect(await prisma.portalSession.count({ where: { portalAccountId: B.portalId, revokedAt: null } })).toBe(0)
  })
})
