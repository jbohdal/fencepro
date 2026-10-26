/**
 * Visit photos reach the quote and the proposal (walkthrough round 2, item 8).
 * The rule on one item (no database), then against the dev database
 * (DEV_DB=1; refuses any other database): a customer with two visit photos
 * (one Internal, one Customer), a photo on another job, a photo on another
 * quote and a photo from long ago; the quote's list has the quote's own and
 * the two visit photos, the proposal has only the Customer one.
 *
 * Round 2 review (Oct 26, 2026): a new fence proposal shows its Customer
 * photos too; the customer never sees a staff caption; once sold, the job's
 * photos and the crew packet carry the quote's and the visit's photos
 * (Internal too, never a price in a caption), while the job's Photos Uploaded
 * milestone still counts only photos taken on the job.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, afterAll } from 'vitest'
import { belongsToQuote, quoteMediaOr, visitPhotoSince, VISIT_PHOTO_DAYS } from '../src/server/lib/quoteMedia.js'
import { renderProposal } from '../src/server/routes/proposal.js'

const DAY = 86_400_000

describe('which photos belong to a quote', () => {
  const now = new Date('2026-10-26T15:00:00Z')
  const customer = { id: 'c1', since: visitPhotoSince(now) }
  const base = { quoteKey: null, jobId: null, customerId: 'c1', serviceTicketId: null, createdAt: new Date(now.getTime() - DAY) }
  test('the quote\'s own, and the customer\'s own from the 60 days before it was made', () => {
    expect(VISIT_PHOTO_DAYS).toBe(60)
    expect(belongsToQuote({ ...base, quoteKey: 'q1', customerId: null }, 'q1', null)).toBe(true)
    expect(belongsToQuote(base, 'q1', customer)).toBe(true)
    expect(belongsToQuote({ ...base, createdAt: new Date(now.getTime() - 59 * DAY) }, 'q1', customer)).toBe(true)
  })
  test('never another quote\'s, a job\'s, a service request\'s, an old one, another customer\'s, or with no customer known', () => {
    expect(belongsToQuote({ ...base, quoteKey: 'q2' }, 'q1', customer)).toBe(false)
    expect(belongsToQuote({ ...base, jobId: 'j1' }, 'q1', customer)).toBe(false)
    expect(belongsToQuote({ ...base, serviceTicketId: 't1' }, 'q1', customer)).toBe(false)
    expect(belongsToQuote({ ...base, createdAt: new Date(now.getTime() - 61 * DAY) }, 'q1', customer)).toBe(false)
    expect(belongsToQuote({ ...base, customerId: 'c2' }, 'q1', customer)).toBe(false)
    expect(belongsToQuote(base, 'q1', null)).toBe(false)
  })
  test('the database clause says the same', () => {
    expect(quoteMediaOr('q1', null)).toEqual([{ quoteKey: 'q1' }])
    expect(quoteMediaOr('q1', customer)[1]).toEqual({ customerId: 'c1', quoteKey: null, jobId: null, serviceTicketId: null, createdAt: { gte: customer.since } })
  })
})

describe('the proposal page\'s photos', () => {
  const p = { version: 1, options: [{ label: 'White vinyl', fenceStyle: 'WV', finalPrice: 5000, perFoot: 40, sections: 16 }] }
  test('a new fence proposal shows its photos, with no staff caption', () => {
    const html = renderProposal({ customerName: 'Test', customerAddress: '', acceptedAt: null }, p as any, 'tok123', 'nonce', [{ id: 'm1' }, { id: 'm2' }])
    expect(html).toContain('data-proposal-photos')
    expect(html).toContain('tok123/media/m1')
    expect(html).toContain('tok123/media/m2')
    expect(html).not.toContain('figcaption')
    expect(html).not.toContain('Ready to quote visit')
  })
  test('no photos: no Photos section', () => {
    expect(renderProposal({ customerName: 'Test', customerAddress: '', acceptedAt: null }, p as any, 'tok123', 'nonce', [])).not.toContain('data-proposal-photos')
  })
})

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('visit photos on the quote and proposal (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { quoteCustomer, proposalPhotos } = await import('../src/server/lib/quoteMedia.js')
  const account = (await prisma.crmAccount.findFirst({ orderBy: { createdAt: 'asc' } }))!
  const tag = `e2e-qm-${Date.now()}`
  const made: { contact?: string; quotes: string[]; jobs: string[]; media: string[] } = { quotes: [], jobs: [], media: [] }
  afterAll(async () => {
    await prisma.mediaItem.deleteMany({ where: { id: { in: made.media } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: made.jobs } } })
    if (made.contact) await prisma.crmContact.deleteMany({ where: { id: made.contact } })
  })

  test('the quote lists its own and the visit\'s photos; the proposal only the Customer ones', async () => {
    const c = await prisma.crmContact.create({ data: { accountId: account.id, firstName: 'E2E', lastName: `Visit photos ${tag}` } as any })
    made.contact = c.id
    const q = await prisma.savedQuote.create({ data: { accountId: account.id, crmContactId: c.id, customerName: `E2E Visit photos ${tag}`, fenceStyle: 'repair', runs: [], pullSheet: [], finalPrice: 500 } as any })
    const other = await prisma.savedQuote.create({ data: { accountId: account.id, crmContactId: c.id, customerName: `E2E Visit photos ${tag}`, fenceStyle: 'repair', runs: [], pullSheet: [], finalPrice: 900 } as any })
    const job = await prisma.savedJob.create({ data: { accountId: account.id, crmContactId: c.id, customerName: `E2E Visit photos ${tag}` } as any })
    made.quotes.push(q.id, other.id); made.jobs.push(job.id)
    const mk = async (n: string, data: Record<string, unknown>) => {
      const m = await prisma.mediaItem.create({ data: { accountId: account.id, clientId: `${tag}-${n}`, kind: 'photo', mime: 'image/jpeg', path: '/nonexistent.jpg', takenAt: new Date(), status: 'ready', ...data } as any })
      made.media.push(m.id); return m.id
    }
    const visitInternal = await mk('vi', { customerId: c.id, caption: 'Ready to quote visit', category: 'Site walk', visibility: 'internal' })
    const visitCustomer = await mk('vc', { customerId: c.id, caption: 'Ready to quote visit', category: 'Site walk', visibility: 'customer' })
    const own = await mk('own', { quoteKey: q.id, customerId: c.id, visibility: 'customer' })
    const onOther = await mk('oq', { quoteKey: other.id, customerId: c.id, visibility: 'customer' })
    const onJob = await mk('job', { jobId: job.id, customerId: c.id, visibility: 'customer' })
    const old = await mk('old', { customerId: c.id, visibility: 'customer', createdAt: new Date(Date.now() - 90 * DAY) })

    const cust = await quoteCustomer(account.id, q.id)
    expect(cust?.id).toBe(c.id)
    const { quoteMediaOr } = await import('../src/server/lib/quoteMedia.js')
    const listed = await prisma.mediaItem.findMany({ where: { accountId: account.id, deletedAt: null, OR: quoteMediaOr(q.id, cust) }, select: { id: true } })
    const ids = new Set(listed.map(m => m.id))
    expect([visitInternal, visitCustomer, own].every(i => ids.has(i))).toBe(true)
    expect([onOther, onJob, old].some(i => ids.has(i))).toBe(false)

    const shown = (await proposalPhotos(q)).map(p => p.id).sort()
    expect(shown).toEqual([visitCustomer, own].sort())

    // A draft not saved yet: the builder names its customer; another account's id is ignored.
    const draft = await quoteCustomer(account.id, `draft-${tag}`, c.id)
    expect(draft?.id).toBe(c.id)
    expect(await quoteCustomer('no-such-account', `draft-${tag}`, c.id)).toBeNull()
    expect(await quoteCustomer(account.id, `draft-${tag}`)).toBeNull()
  })
})

describe.skipIf(!process.env.DEV_DB || !onDev)('visit photos on a new fence proposal, the job and the crew packet (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: mediaRoutes } = await import('../src/server/routes/media.js')
  const { publicProposal } = await import('../src/server/routes/proposal.js')
  const { packetPublic } = await import('../src/server/routes/installPacket.js')
  const { readinessFactsFor } = await import('../src/server/lib/jobTruth.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const account = (await prisma.crmAccount.findFirst({ orderBy: { createdAt: 'asc' } }))!
  const tag = `e2e-qm2-${Date.now()}`
  const made: { contact?: string; quotes: string[]; jobs: string[]; media: string[]; packets: string[] } = { quotes: [], jobs: [], media: [], packets: [] }
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const owner = jwt.sign({ sub: crypto.randomUUID(), email: `${tag}@example.invalid`, role: 'super_admin', crmAccountId: account.id }, secret, { expiresIn: '10m' })
  const app = express()
  app.use('/api/media', mediaRoutes)
  app.use('/p/i', packetPublic)
  app.use('/p', publicProposal)
  const server = app.listen(0)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  afterAll(async () => {
    server.close()
    await prisma.installPacket.deleteMany({ where: { id: { in: made.packets } } })
    await prisma.mediaItem.deleteMany({ where: { id: { in: made.media } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: made.jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    if (made.contact) await prisma.crmContact.deleteMany({ where: { id: made.contact } })
  })

  test('the customer sees only Customer photos (no caption) on a new fence proposal; the job and the packet get the quote\'s and the visit\'s', async () => {
    const c = await prisma.crmContact.create({ data: { accountId: account.id, firstName: 'E2E', lastName: `Visit photos 2 ${tag}` } as any })
    made.contact = c.id
    const token = `tok-${tag}-${crypto.randomBytes(6).toString('hex')}`
    const q = await prisma.savedQuote.create({ data: {
      accountId: account.id, crmContactId: c.id, customerName: `E2E Visit photos 2 ${tag}`, fenceStyle: "WV-ND 6'x8' Privacy", runs: [100], pullSheet: [], finalPrice: 5000, shareToken: token,
      proposal: { version: 1, options: [{ label: 'White vinyl', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 5000, perFoot: 50, sections: 13 }] },
    } as any })
    made.quotes.push(q.id)
    const job = await prisma.savedJob.create({ data: { accountId: account.id, crmContactId: c.id, quoteId: q.id, customerName: q.customerName } as any })
    made.jobs.push(job.id)
    const mk = async (n: string, data: Record<string, unknown>) => {
      const m = await prisma.mediaItem.create({ data: { accountId: account.id, clientId: `${tag}-${n}`, kind: 'photo', mime: 'image/jpeg', path: '/nonexistent.jpg', takenAt: new Date(), status: 'ready', ...data } as any })
      made.media.push(m.id); return m.id
    }
    const visitInternal = await mk('vi', { customerId: c.id, caption: 'Ready to quote visit', category: 'Site walk', visibility: 'internal' })
    const visitCustomer = await mk('vc', { customerId: c.id, caption: 'Ready to quote visit', category: 'Site walk', visibility: 'customer' })
    const quoteInternal = await mk('qi', { quoteKey: q.id, customerId: c.id, caption: 'Supplier invoice, paid $1,093.60', visibility: 'internal' })
    const jobInternal = await mk('ji', { jobId: job.id, customerId: c.id, visibility: 'internal', source: 'staff' })
    const jobCrew = await mk('jc', { jobId: job.id, customerId: c.id, visibility: 'crew', category: 'Progress' })

    // The customer's proposal (a new fence, no kind): only the visit photo marked Customer, no caption.
    const html = await fetch(`${base}/p/${token}`).then(r => r.text())
    const shown = [...html.matchAll(/\/media\/([0-9a-f-]{36})/g)].map(m => m[1])
    expect(shown).toEqual([visitCustomer])
    expect(html).not.toContain('Ready to quote visit')
    expect(html).not.toContain('Supplier invoice')
    // The Internal ones' links are refused; the Customer one's is allowed (its file is not on disk here: 404 after the check).
    for (const id of [visitInternal, quoteInternal]) expect((await fetch(`${base}/p/${token}/media/${id}`)).status).toBe(404)

    // The job's Photos and video: its own, its quote's and the visit's.
    const list = await fetch(`${base}/api/media?jobId=${job.id}`, { headers: { Authorization: `Bearer ${owner}` } }).then(r => r.json()) as any
    const onJob = new Set((list.data ?? []).map((m: any) => m.id))
    expect([visitInternal, visitCustomer, quoteInternal, jobInternal, jobCrew].every(i => onJob.has(i))).toBe(true)

    // The crew packet: the quote's and the visit's (Internal too), the job's Crew one; never the job's own Internal one or a price.
    const pk = await prisma.installPacket.create({ data: { accountId: account.id, jobId: job.id, token: `pk${tag}${crypto.randomBytes(8).toString('hex')}`, snapshot: { companyName: 'Getter Done Fence' } as any } })
    made.packets.push(pk.id)
    const packet = await fetch(`${base}/p/i/${pk.token}`).then(r => r.text())
    for (const id of [visitInternal, visitCustomer, quoteInternal, jobCrew]) expect(packet).toContain(`m/${id}/`)
    expect(packet).not.toContain(`m/${jobInternal}/`)
    expect(packet).not.toContain('1,093.60')

    // Photos Uploaded counts only the photos taken on the job.
    const facts = await readinessFactsFor(account.id, [{ ...job, status: 'staging' } as any])
    expect(facts.get(job.id)?.photos).toBe(2)
  })
})
