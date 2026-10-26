/**
 * Visit photos reach the quote and the proposal (walkthrough round 2, item 8).
 * The rule on one item (no database), then against the dev database
 * (DEV_DB=1; refuses any other database): a customer with two visit photos
 * (one Internal, one Customer), a photo on another job, a photo on another
 * quote and a photo from long ago; the quote's list has the quote's own and
 * the two visit photos, the proposal has only the Customer one.
 */

import 'dotenv/config'
import { describe, test, expect, afterAll } from 'vitest'
import { belongsToQuote, quoteMediaOr, visitPhotoSince, VISIT_PHOTO_DAYS } from '../src/server/lib/quoteMedia.js'

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
