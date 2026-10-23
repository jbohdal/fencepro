/**
 * Warranty and service requests, end to end on the server (dev database,
 * DEV_DB=1; refuses any other). In a throwaway company of its own, removed
 * afterwards:
 *
 * - a past customer's badge: the warranty of their install and its date;
 * - the request form's hints from the warranty (Lifetime no dig; 1 Year ended);
 * - a ticket made by a Salesman, once per screen id; "Ask for photos" makes a
 *   14 day link; the no login page and upload (wrong link, expired link, type
 *   and size limits, a resend saved once); the photo lands Internal on the
 *   ticket, which moves to Photos received and tells the owner once;
 * - covered or not covered: owner and office only, a reason required; the
 *   customer portal shows only its own field list, the decision only when shared;
 * - the visit (a service appointment), the crew packet's $0 work order (and the
 *   packet stays open for it), Fixed with covered work's cost (hours × the
 *   hourly rate, parts), Close (owner and office), the report's math;
 * - not covered: the customer's repair quote is found and linked.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('warranty and service requests (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: serviceRoutes } = await import('../src/server/routes/serviceTickets.js')
  const { servicePhotosPublic } = await import('../src/server/routes/servicePhotosPublic.js')
  const { default: portal } = await import('../src/server/routes/portal.js')
  const { customerRoute } = await import('../src/server/routes/portalPublic.js')
  const { packetPublic } = await import('../src/server/routes/installPacket.js')
  const { ensureWarranties } = await import('../src/server/lib/warranties.js')
  const { photosPush, forgetBadges } = await import('../src/server/lib/serviceTickets.js')
  const { hashPassword } = await import('../src/server/lib/auth.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const M = await import('../src/server/lib/serviceTicketModel.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const stamp = `${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`
  let accountId = '', contactId = '', jobId = '', oldJobId = '', base = '', portalCookie = '', ownerEmail = ''
  const extraEmails: string[] = []
  const tokens: Record<string, string> = {}
  const made = { portal: '', packet: '', quote: '', appt: '' }
  let server: ReturnType<express.Express['listen']>
  const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64')

  const call = (who: string, method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { Authorization: `Bearer ${tokens[who]}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))
  const upload = (p: string, file: Blob, name: string, extra: Record<string, string> = {}, headers: Record<string, string> = {}) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(extra)) fd.append(k, v)
    fd.append('file', file, name)
    return fetch(base + p, { method: 'POST', body: fd, headers }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))
  }

  beforeAll(async () => {
    const owner = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    const top = await prisma.savedQuote.groupBy({ by: ['accountId'], _count: { _all: true }, orderBy: { _count: { accountId: 'desc' } }, take: 1 })
    const src = await prisma.businessState.findUnique({ where: { accountId: top[0].accountId } })
    const account = await prisma.crmAccount.create({ data: { name: `Test service-${stamp}`, status: 'active' } })
    accountId = account.id
    await prisma.businessState.create({ data: { accountId, config: { fenceStyles: (src!.config as any).fenceStyles, fenceCatalog: (src!.config as any).fenceCatalog, pricing: { manHourRate: 30 }, company: { name: 'Getter Done Fence', phone: '3527894314' } } as any } })
    await ensureWarranties(accountId)
    // The owner of this throwaway company is told when photos arrive.
    const u = await prisma.crmUser.create({ data: { email: `e2e-service-owner-${stamp}@example.com`, firstName: 'E2E', lastName: 'Owner', role: 'super_admin', status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    ownerEmail = u.email
    const sign = (role: string) => jwt.sign({ sub: role === 'super_admin' ? u.id : owner.id, email: role === 'super_admin' ? u.email : owner.email, role, firstName: 'E2E', lastName: role, crmAccountId: accountId }, secret, { expiresIn: '15m' })
    for (const r of ['super_admin', 'office_staff', 'sales_rep', 'field_crew']) tokens[r] = sign(r)
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'Pat', lastName: `Service ${stamp}`, phone: '3525550166', serviceAddress: '12 Service Way, Ocala, FL', textConsent: 'no' } })
    contactId = c.id
    const job = await prisma.savedJob.create({ data: { accountId, crmContactId: c.id, customerName: `Pat Service ${stamp}`, customerAddress: '12 Service Way, Ocala, FL', fenceStyle: "WV-ND 6'x8' Privacy", status: 'paid', completedDate: '2026-03-10', crewAssigned: 'Crew A', notes: 'SECRET JOB NOTE' } as any })
    jobId = job.id
    const old = await prisma.savedJob.create({ data: { accountId, crmContactId: c.id, customerName: `Pat Service ${stamp}`, customerAddress: '12 Service Way, Ocala, FL', fenceStyle: "WV-DS 6'x8' Privacy", status: 'paid', completedDate: '2023-05-01', crewAssigned: 'Crew B' } as any })
    oldJobId = old.id
    const email = `e2e-service-${stamp}@example.com`
    made.portal = (await prisma.portalAccount.create({ data: { email, crmCustomerId: c.id, status: 'active', passwordHash: await hashPassword('e2e-service-pass-1'), firstName: 'Pat' } })).id

    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/service-tickets', serviceRoutes)
    app.use('/api/portal', portal)
    app.use('/p/s', servicePhotosPublic)
    app.use('/p/i', packetPublic)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const r = await fetch(`${base}/api/portal/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'e2e-service-pass-1' }) })
    expect(r.status).toBe(200)
    portalCookie = (r.headers.get('set-cookie') || '').split(';')[0]
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const media = await prisma.mediaItem.findMany({ where: { accountId } })
    for (const m of media) fs.rmSync(m.path, { force: true })
    await prisma.mediaItem.deleteMany({ where: { accountId } })
    const tickets = await prisma.serviceTicket.findMany({ where: { accountId }, select: { id: true } })
    for (const t of tickets) await prisma.automationEffect.deleteMany({ where: { key: { startsWith: `service-photos:${t.id}:` } } })
    await prisma.notification.deleteMany({ where: { recipientId: { in: [ownerEmail, ...extraEmails] } } })
    await prisma.cardFollowUp.deleteMany({ where: { accountId } })
    await prisma.pipelineState.deleteMany({ where: { accountId } })
    await prisma.serviceWorkCost.deleteMany({ where: { accountId } })
    await prisma.serviceTicket.deleteMany({ where: { accountId } })
    await prisma.installPacket.deleteMany({ where: { accountId } })
    await prisma.appointment.deleteMany({ where: { accountId } })
    await prisma.savedQuote.deleteMany({ where: { accountId } })
    await prisma.savedJob.deleteMany({ where: { accountId } })
    if (made.portal) { await prisma.portalSession.deleteMany({ where: { portalAccountId: made.portal } }).catch(() => {}); await prisma.portalAccount.delete({ where: { id: made.portal } }).catch(() => {}) }
    await prisma.crmAuditLog.deleteMany({ where: { entityType: 'ServiceTicket', entityId: { in: tickets.map(t => t.id) } } }).catch(() => {})
    await prisma.crmContact.deleteMany({ where: { accountId } })
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch(() => {})
  })

  test('a past customer badge: the warranty of the latest install and its date', async () => {
    forgetBadges(accountId)
    const all = await call('sales_rep', 'GET', '/api/service-tickets/badges')
    expect(all.status).toBe(200)
    expect(all.json.data).toHaveLength(1)
    const one = await call('field_crew', 'GET', `/api/service-tickets/badge/${contactId}`)
    expect(one.json.data).toMatchObject({ customerId: contactId, jobId, warrantyName: 'Lifetime Craftsmanship Warranty', installDate: '2026-03-10', jobs: 2 })
    expect(M.badgeText(one.json.data)).toBe('Past customer · Lifetime Craftsmanship Warranty · installed Mar 10, 2026')
    expect((await call('field_crew', 'GET', '/api/service-tickets/badge/nobody')).json.data).toBeNull()
  })

  test('the request form: the warranty, its words and a hint per issue', async () => {
    const ctx = (await call('sales_rep', 'GET', `/api/service-tickets/context?jobId=${jobId}`)).json.data
    expect(ctx.warranty.name).toBe('Lifetime Craftsmanship Warranty')
    expect(ctx.warranty.text).toContain('including posts or sections that lean or fail in high winds')
    expect(ctx.kind).toBe('lifetime')
    expect(ctx.hints.leaning_post.hint).toBe('likely_covered')
    expect(ctx.hints.storm_tree.hint).toBe('needs_look')
    expect(ctx.textConsent.state).toBe('no')
    const old = (await call('sales_rep', 'GET', `/api/service-tickets/context?jobId=${oldJobId}`)).json.data
    expect(old.warranty.name).toBe('1 Year Workmanship Warranty')
    expect(old.kind).toBe('ended')
    expect(Object.values(old.hints).every((h: any) => h.hint === 'likely_not_covered')).toBe(true)
    expect(old.hints.gate.why).toContain('ended May 1, 2024')
    expect((await call('sales_rep', 'GET', '/api/service-tickets/context?jobId=nope')).status).toBe(404)
  })

  let ticketId = '', token = ''
  test('a Salesman makes the request (once per screen id) and asks for photos: a 14 day link', async () => {
    const id = crypto.randomUUID()
    const made1 = await call('sales_rep', 'POST', '/api/service-tickets', { id, jobId, issue: 'leaning_post', notes: 'Two posts by the gate lean after the storm' })
    expect(made1.status).toBe(201)
    expect(made1.json.data).toMatchObject({ stage: 'new', hint: 'likely_covered', issueLabel: 'Leaning post', fenceStyle: expect.any(String), installer: 'Crew A' })
    expect(made1.json.data.warranty.name).toBe('Lifetime Craftsmanship Warranty')
    const again = await call('sales_rep', 'POST', '/api/service-tickets', { id, jobId, issue: 'leaning_post', notes: 'x' })
    expect(again.json.data.id).toBe(id)
    expect(await prisma.serviceTicket.count({ where: { accountId } })).toBe(1)
    expect((await call('sales_rep', 'POST', '/api/service-tickets', { jobId, issue: 'nonsense' })).status).toBe(400)
    ticketId = id
    const asked = await call('sales_rep', 'POST', `/api/service-tickets/${ticketId}/photo-link`)
    expect(asked.status).toBe(200)
    expect(asked.json.data.stage).toBe('photos_requested')
    expect(asked.json.data.link.path).toMatch(/^\/p\/s\/[A-Za-z0-9_-]{32}$/)
    expect(asked.json.data.textConsent.state).toBe('no')
    token = asked.json.data.link.path.slice(5)
    const days = (new Date(asked.json.data.link.expiresAt).getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(13.9); expect(days).toBeLessThanOrEqual(14)
    // Asked again while open: the same link, 14 days from now.
    expect((await call('sales_rep', 'POST', `/api/service-tickets/${ticketId}/photo-link`)).json.data.link.path).toBe(`/p/s/${token}`)
    expect(M.photoRequestText('Pat', `https://x.ts.net:8443/p/s/${token}`)).toBe(`Getter Done Fence: Hi Pat, sorry to hear about the issue with your fence. Please send us a few photos here so we can take a look: https://x.ts.net:8443/p/s/${token}. Reply STOP to opt out.`)
  })

  test('the no login link: a wrong link, the limits, then a photo lands Internal and the owner is told once', async () => {
    expect((await fetch(`${base}/p/s/not-a-real-link-at-all-000000`)).status).toBe(404)
    expect((await upload('/p/s/not-a-real-link-at-all-000000/media', new Blob([jpeg], { type: 'image/jpeg' }), 'a.jpg')).status).toBe(404)
    const page = await fetch(`${base}/p/s/${token}`)
    expect(page.status).toBe(200)
    const html = await page.text()
    expect(html).toContain('Hi Pat, show us your fence')
    expect(html).not.toContain('SECRET JOB NOTE')
    expect(html).not.toContain('Two posts by the gate')
    // Not a photo or video; a photo over 25 MB.
    const txt = await upload(`/p/s/${token}/media`, new Blob(['hello'], { type: 'text/plain' }), 'a.txt')
    expect(txt.status).toBe(400); expect(txt.json.error).toBe('Please send a photo or a video.')
    const big = await upload(`/p/s/${token}/media`, new Blob([Buffer.alloc(M.PHOTO_MAX_BYTES + 10)], { type: 'image/jpeg' }), 'big.jpg')
    expect(big.status).toBe(400); expect(big.json.error).toContain('25 MB')
    expect(await prisma.mediaItem.count({ where: { serviceTicketId: ticketId } })).toBe(0)
    // A photo, sent twice with the same id: saved once.
    const ok = await upload(`/p/s/${token}/media`, new Blob([jpeg], { type: 'image/jpeg' }), 'fence.jpg', { cid: 'abc123def456', caption: 'by the gate' })
    expect(ok.status).toBe(200)
    expect((await upload(`/p/s/${token}/media`, new Blob([jpeg], { type: 'image/jpeg' }), 'fence.jpg', { cid: 'abc123def456' })).status).toBe(200)
    const items = await prisma.mediaItem.findMany({ where: { serviceTicketId: ticketId } })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ visibility: 'internal', source: 'customer', jobId, customerId: contactId, category: 'Existing damage', caption: 'by the gate' })
    const t = (await call('office_staff', 'GET', `/api/service-tickets/${ticketId}`)).json.data
    expect(t.stage).toBe('photos_received')
    expect(t.photos).toHaveLength(1)
    // The owner's bell, once for this "Ask for photos" (the push is logged in the dev copy).
    await upload(`/p/s/${token}/media`, new Blob([jpeg], { type: 'image/jpeg' }), 'second.jpg', { cid: 'zzz999yyy888' })
    const bell = await prisma.notification.findMany({ where: { recipientId: ownerEmail } })
    expect(bell).toHaveLength(1)
    expect(bell[0].title).toBe(`Photos in: Pat Service ${stamp}`)
    expect(bell[0].link).toBe(`/service?ticket=${ticketId}`)
  })

  test('the push goes to the owner, once per request for photos', async () => {
    const row = (await prisma.serviceTicket.findUnique({ where: { id: ticketId } }))!
    const sent: any[] = []
    const fresh = { ...row, photosRequestedAt: new Date(row.photosRequestedAt!.getTime() + 1) }
    const first = await photosPush(fresh, { allowed: true, send: async (a, msg, ids) => { sent.push({ a, msg, ids }) } })
    expect(first).toMatchObject({ made: true, delivered: true })
    expect(await photosPush(fresh, { allowed: true, send: async (a, msg, ids) => { sent.push({ a, msg, ids }) } })).toEqual({ made: false, delivered: false })
    expect(sent).toHaveLength(1)
    expect(sent[0].msg.url).toBe(`/service?ticket=${ticketId}`)
    const owner = await prisma.crmUser.findFirst({ where: { email: ownerEmail } })
    expect(sent[0].ids).toEqual([owner!.id])
  })

  test('the push also goes to the customer\'s card owner: the salesman by exact full name, else the follow ups owner; never twice', async () => {
    const rep = await prisma.crmUser.create({ data: { email: `e2e-service-rep-${stamp}@example.com`, firstName: 'Sam', lastName: 'Seller', role: 'sales_rep', status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    const other = await prisma.crmUser.create({ data: { email: `e2e-service-other-${stamp}@example.com`, firstName: 'Olive', lastName: 'Office', role: 'office_staff', status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    extraEmails.push(rep.email, other.email)
    const owner = (await prisma.crmUser.findFirst({ where: { email: ownerEmail } }))!
    const card = { id: `card-${stamp}`, customerId: contactId, firstName: 'Pat', lastName: 'Service', stage: 'sold', assignedRep: '  sam   SELLER ' }
    await prisma.pipelineState.create({ data: { accountId, leads: [card] as any, stages: [] as any } as any })
    const row = (await prisma.serviceTicket.findUnique({ where: { id: ticketId } }))!
    let n = 10
    const push = async () => {
      const sent: any[] = []
      const r = await photosPush({ ...row, photosRequestedAt: new Date(row.photosRequestedAt!.getTime() + n++) }, { allowed: true, send: async (_a, msg, ids) => { sent.push({ msg, ids }) } })
      return { r, ids: sent[0]?.ids ?? [] }
    }
    const cardOwner = async () => (await import('../src/server/lib/serviceTickets.js')).cardOwnerOf(accountId, contactId)
    // The salesman named on the card (full name, case and spaces aside): Jonathan and Sam, a bell each.
    expect((await cardOwner())?.id).toBe(rep.id)
    const a = await push()
    expect(a.r).toMatchObject({ made: true, delivered: true })
    expect(a.ids).toEqual([owner.id, rep.id])
    const bells = await prisma.notification.findMany({ where: { recipientId: rep.email } })
    expect(bells).toHaveLength(1)
    expect(bells[0].link).toBe(`/service?ticket=${ticketId}`)
    // A first name alone is not a match (no guessing); with no follow ups owner nobody else is told.
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [{ ...card, assignedRep: 'Sam' }] as any } })
    expect(await cardOwner()).toBeNull()
    expect((await push()).ids).toEqual([owner.id])
    // No salesman on the card: the login its follow ups belong to (a login id).
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [{ ...card, assignedRep: '' }] as any } })
    await prisma.cardFollowUp.create({ data: { accountId, cardId: card.id, stage: 'sold', stageSince: '2026-10-01', ownerUserId: other.id } as any })
    expect((await push()).ids).toEqual([owner.id, other.id])
    // The card is Jonathan's own: told once, one bell.
    await prisma.pipelineState.update({ where: { accountId }, data: { leads: [{ ...card, assignedRep: 'E2E Owner' }] as any } })
    const before = await prisma.notification.count({ where: { recipientId: ownerEmail } })
    expect((await push()).ids).toEqual([owner.id])
    expect(await prisma.notification.count({ where: { recipientId: ownerEmail } })).toBe(before + 1)
  })

  test('an expired link stops taking photos', async () => {
    await prisma.serviceTicket.update({ where: { id: ticketId }, data: { uploadExpiresAt: new Date(Date.now() - 1000) } })
    const page = await fetch(`${base}/p/s/${token}`)
    expect(page.status).toBe(410)
    expect(await page.text()).toContain('This photo link has expired.')
    const up = await upload(`/p/s/${token}/media`, new Blob([jpeg], { type: 'image/jpeg' }), 'late.jpg')
    expect(up.status).toBe(410)
    await prisma.serviceTicket.update({ where: { id: ticketId }, data: { uploadExpiresAt: new Date(Date.now() + 86_400_000) } })
  })

  test('covered or not covered: owner and office only, with a reason', async () => {
    const no = await call('sales_rep', 'POST', `/api/service-tickets/${ticketId}/decision`, { decision: 'covered', reason: 'install failure' })
    expect(no.status).toBe(403)
    expect(no.json.error).toBe('Only the owner and the office decide warranty coverage. Ask Jonathan.')
    expect((await call('field_crew', 'POST', `/api/service-tickets/${ticketId}/decision`, { decision: 'covered', reason: 'x' })).status).toBe(403)
    expect((await call('office_staff', 'POST', `/api/service-tickets/${ticketId}/decision`, { decision: 'covered', reason: '' })).status).toBe(400)
    const yes = await call('office_staff', 'POST', `/api/service-tickets/${ticketId}/decision`, { decision: 'covered', reason: 'Posts leaned in high winds: install failure', shared: false })
    expect(yes.status).toBe(200)
    expect(yes.json.data).toMatchObject({ decision: 'covered', decisionReason: 'Posts leaned in high winds: install failure', decisionShared: false })
  })

  test('the portal: the open request from its own field list; the decision only when shared; photos added there', async () => {
    const get = async () => { const r = await fetch(`${base}/api/portal/service-requests`, { headers: { Cookie: portalCookie } }); return { status: r.status, json: await r.json() as any } }
    const r = await get()
    expect(r.status).toBe(200)
    expect(r.json.data).toHaveLength(1)
    const row = r.json.data[0]
    expect(Object.keys(row).sort()).toEqual(['canAddPhotos', 'decision', 'id', 'issue', 'madeOn', 'open', 'photosSent', 'status', 'visitOn'])
    expect(row).toMatchObject({ issue: 'Leaning post', status: 'Photos received, we are taking a look', decision: null, photosSent: 2, canAddPhotos: true })
    const text = JSON.stringify(r.json)
    for (const secretWord of ['Two posts by the gate', 'install failure', 'Crew A', 'likely_covered', 'SECRET JOB NOTE', token]) expect(text).not.toContain(secretWord)
    expect(customerRoute('GET', '/service-requests')).toBe(true)
    expect(customerRoute('POST', `/service-requests/${ticketId}/photos`)).toBe(true)
    expect(customerRoute('POST', `/service-requests/${ticketId}/decision`)).toBe(false)
    // Shared: the decision and its reason show.
    await call('super_admin', 'POST', `/api/service-tickets/${ticketId}/decision`, { decision: 'covered', reason: 'Covered under your Lifetime warranty.', shared: true })
    expect((await get()).json.data[0].decision).toEqual({ covered: true, reason: 'Covered under your Lifetime warranty.' })
    // "Show the customer" ticked off again: hidden again.
    await call('super_admin', 'POST', `/api/service-tickets/${ticketId}/decision`, { decision: 'covered', reason: 'Covered under your Lifetime warranty.', shared: false })
    expect((await get()).json.data[0].decision).toBeNull()
    await call('super_admin', 'POST', `/api/service-tickets/${ticketId}/decision`, { decision: 'covered', reason: 'Covered under your Lifetime warranty.', shared: true })
    expect((await get()).json.data[0].decision).toEqual({ covered: true, reason: 'Covered under your Lifetime warranty.' })
    // A photo from the portal: Internal on the request; without the portal's write header it is refused.
    expect((await upload(`/api/portal/service-requests/${ticketId}/photos`, new Blob([jpeg], { type: 'image/jpeg' }), 'p.jpg', {}, { Cookie: portalCookie })).status).toBe(403)
    const up = await upload(`/api/portal/service-requests/${ticketId}/photos`, new Blob([jpeg], { type: 'image/jpeg' }), 'p.jpg', { clientId: 'portal-photo-0001' }, { Cookie: portalCookie, 'X-Portal-Request': '1' })
    expect(up.status).toBe(200)
    expect(await prisma.mediaItem.count({ where: { serviceTicketId: ticketId, takenBy: 'Customer (portal)', visibility: 'internal' } })).toBe(1)
    expect((await upload(`/api/portal/service-requests/someone-else/photos`, new Blob([jpeg], { type: 'image/jpeg' }), 'p.jpg', {}, { Cookie: portalCookie, 'X-Portal-Request': '1' })).status).toBe(404)
  })

  test('the visit, the crew packet\'s $0 work order (open past 30 days for it), Fixed with the cost, Close', async () => {
    const a = await prisma.appointment.create({ data: { accountId, crmContactId: contactId, type: 'service', startAt: new Date(Date.now() + 2 * 86_400_000), jobId, address: '12 Service Way', assignedTo: 'Crew A' } })
    made.appt = a.id
    const booked = await call('sales_rep', 'POST', `/api/service-tickets/${ticketId}/appointment`, { appointmentId: a.id })
    expect(booked.json.data.stage).toBe('scheduled')
    expect(booked.json.data.appointment.id).toBe(a.id)
    // The job was finished in March: its packet would be closed, but covered work keeps it open.
    const p = await prisma.installPacket.create({ data: { accountId, jobId, token: crypto.randomBytes(24).toString('base64url'), snapshot: { companyName: 'Getter Done Fence' } } })
    const page = await (await fetch(`${base}/p/i/${p.token}`)).text()
    expect(page).toContain('Warranty work order: $0, no charge to the customer')
    expect(page).toContain(`data-packet-warranty-work="${ticketId}"`)
    // Covered work is costed: owner and office, with hours.
    expect((await call('sales_rep', 'POST', `/api/service-tickets/${ticketId}/fixed`, { fixedOn: '2026-10-22', crew: [{ name: 'Crew A', hours: 2 }] })).status).toBe(403)
    expect((await call('office_staff', 'POST', `/api/service-tickets/${ticketId}/fixed`, { fixedOn: '2026-10-22', crew: [] })).status).toBe(400)
    const fixed = await call('office_staff', 'POST', `/api/service-tickets/${ticketId}/fixed`, {
      fixedOn: '2026-10-22', crew: [{ name: 'Crew A', hours: 1.5 }, { name: 'Helper', hours: 1 }],
      materials: [{ part: 'Donut and concrete', qty: 2, unitCents: 1250 }, { part: 'Nothing', qty: 0, unitCents: 999 }],
    })
    expect(fixed.status).toBe(200)
    expect(fixed.json.data.stage).toBe('fixed')
    // 2.5 hours × $30.00 (Settings, no quoted cost) + 2 × $12.50.
    expect(fixed.json.data.cost).toMatchObject({ hours: 2.5, hourlyCostCents: 3000, laborCents: 7500, materialCents: 2500, totalCents: 10000 })
    expect(fixed.json.data.cost.materials).toHaveLength(1)
    // A Salesman sees the ticket, not its cost.
    expect((await call('sales_rep', 'GET', `/api/service-tickets/${ticketId}`)).json.data.cost).toBeNull()
    // Fixed: off the packet.
    expect(await (await fetch(`${base}/p/i/${p.token}`)).text()).not.toContain('Warranty work order')
    expect((await call('sales_rep', 'POST', `/api/service-tickets/${ticketId}/stage`, { stage: 'closed' })).status).toBe(403)
    const closed = await call('office_staff', 'POST', `/api/service-tickets/${ticketId}/stage`, { stage: 'closed' })
    expect(closed.json.data.stage).toBe('closed')
    // Closed: the link stops, the portal says so (shown 30 days), no more photos.
    expect((await fetch(`${base}/p/s/${token}`)).status).toBe(410)
  })

  let notId = ''
  test('not covered: the customer\'s repair quote is found and linked', async () => {
    const t = (await call('sales_rep', 'POST', '/api/service-tickets', { id: crypto.randomUUID(), jobId, issue: 'storm_tree', notes: 'A tree fell on two sections' })).json.data
    notId = t.id
    expect(t.hint).toBe('needs_look')
    await call('office_staff', 'POST', `/api/service-tickets/${notId}/decision`, { decision: 'not_covered', reason: 'A falling tree is not covered', shared: false })
    expect((await call('office_staff', 'GET', `/api/service-tickets/${notId}`)).json.data.repairQuote).toBeNull()
    const q = await prisma.savedQuote.create({ data: { accountId, crmContactId: contactId, customerName: `Pat Service ${stamp}`, fenceStyle: "WV-ND 6'x8' Privacy", status: 'DRAFT', finalPrice: 640, date: '2026-10-22', runs: [], pullSheet: [], work: { version: 1, type: 'repair', repair: { what: 'storm' } } } as any })
    made.quote = q.id
    const v = (await call('office_staff', 'GET', `/api/service-tickets/${notId}`)).json.data
    expect(v.repairQuote).toMatchObject({ id: q.id, status: 'DRAFT', finalPrice: 640 })
    expect((await prisma.serviceTicket.findUnique({ where: { id: notId } }))!.repairQuoteId).toBe(q.id)
    // Not covered work is marked fixed without a cost.
    expect((await call('sales_rep', 'POST', `/api/service-tickets/${notId}/fixed`, { fixedOn: '2026-10-23' })).json.data).toMatchObject({ stage: 'fixed', cost: null })
  })

  test('lists, the report\'s math, and remove (owner and admin)', async () => {
    const open = (await call('sales_rep', 'GET', '/api/service-tickets')).json.data
    expect(open.map((t: any) => t.id)).toEqual([notId])
    const mine = (await call('sales_rep', 'GET', `/api/service-tickets?customerId=${contactId}`)).json.data
    expect(mine).toHaveLength(2)
    expect(mine.find((t: any) => t.id === ticketId).photoCount).toBe(3)
    expect((await call('sales_rep', 'GET', '/api/service-tickets/report')).status).toBe(403)
    const rep = (await call('office_staff', 'GET', '/api/service-tickets/report')).json.data
    expect(rep.totals).toMatchObject({ tickets: 2, covered: 1, notCovered: 1, undecided: 0, open: 1, coveredCostCents: 10000, costed: 1 })
    expect(rep.byMonth[0]).toMatchObject({ tickets: 2, covered: 1, notCovered: 1, coveredCostCents: 10000 })
    expect(rep.byInstaller).toEqual([{ key: 'Crew A', tickets: 1, costed: 1, costCents: 10000, laborCents: 7500, materialCents: 2500, averageCents: 10000 }])
    expect(rep.byStyle).toHaveLength(1)
    expect(rep.byStyle[0].key).not.toBe('')
    expect((await call('office_staff', 'DELETE', `/api/service-tickets/${notId}`)).status).toBe(403)
    expect((await call('super_admin', 'DELETE', `/api/service-tickets/${notId}`)).status).toBe(200)
    expect((await call('super_admin', 'GET', `/api/service-tickets/${notId}`)).status).toBe(404)
  })
})
