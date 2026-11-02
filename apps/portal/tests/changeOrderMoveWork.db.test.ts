/**
 * A move or repair changed in the quote builder keeps its work, as a new fence
 * does (Nov 2 2026; dev database, DEV_DB=1; refuses any other): the next change
 * order opens on it, the job, pull sheet and quoted cost follow, a void takes
 * it back. Typed lines stay price only.
 *
 * Writes only inside beforeAll, test and afterAll; removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('change orders on a move or repair keep their work (dev database)', { timeout: 90_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedJobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: changeOrders } = await import('../src/server/routes/change-orders.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { snapshotQuotedCost } = await import('../src/server/lib/jobCosting.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const STYLE = "WV-ND 6'x8' Privacy"
  const made = { contacts: [] as string[], quotes: [] as string[], jobs: [] as string[] }
  let accountId = '', owner = '', base = '', userId = '', n = 0
  let server: ReturnType<express.Express['listen']>
  const call = (method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => { const t = await r.text(); let json: any = null; try { json = JSON.parse(t) } catch { /* html */ } return { status: r.status, json, text: t } })

  const MOVE = { oldFt: 100, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd', newPostCaps: false }
  const REPAIR = { what: 'other', items: { replaceSection: 1 }, postType: 'nd', newPostCaps: false, gateKind: 'walk' }
  const request = (ft: number, walk: number, jobType: string, inputs: object = {}) => ({ fenceStyle: STYLE, runs: [{ ft, rail: 'auto' }], corners: 0, ends: 2, walkGates: walk, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides: {}, jobType, ...inputs })
  const lines = (cents: number, description = "Price difference at today's prices") => [{ id: `l${n++}`, description, amountCents: cents }]

  async function signed(work: object, sections = 13) {
    const c = await prisma.crmContact.create({ data: { accountId, firstName: 'E2E CO', lastName: `Move ${Date.now().toString(36)}${n++}`, phone: '3525550133' } as any })
    made.contacts.push(c.id)
    const q = await prisma.savedQuote.create({ data: {
      accountId, ownerId: userId, crmContactId: c.id, customerName: `E2E CO ${c.lastName}`, customerAddress: '3 Change Rd, Ocala FL', fenceStyle: STYLE, runs: [100], sections, corners: 0, ends: 2, work,
      materialCost: 1000, laborCost: 800, totalCOGS: 1800, finalPrice: 4000, gmPct: 0.3, pullSheet: [{ item: 'Vinyl post', qty: 14, unitCost: 10, total: 140 }], status: 'SOLD', soldAt: new Date(),
    } as any })
    made.quotes.push(q.id)
    await snapshotQuotedCost(accountId, q.id, 'app')
    const r = await call('POST', '/api/saved-jobs', { quoteId: q.id, crmContactId: c.id, customerName: q.customerName, customerAddress: q.customerAddress, fenceStyle: STYLE, quotePrice: 4000, contractValue: 4000, status: 'scheduled', sections, totalFeet: 100, scheduledDate: '2026-12-07', scheduledEndDate: '2026-12-07', estimatedDays: 1 })
    expect(r.status).toBe(201)
    made.jobs.push(r.json.data.id)
    return { quoteId: q.id, jobId: r.json.data.id as string }
  }
  const make = async (quoteId: string, body: object) => { const r = await call('POST', '/api/change-orders', { id: `co-${Date.now()}-${n++}`, quoteId, reason: 'Customer asked for it', ...body }); expect(r.status).toBe(201); return r.json.data }
  const approve = async (c: any) => { const r = await call('PATCH', `/api/change-orders/${c.id}`, { baseVersion: c.version, status: 'approved', verbalReason: 'Customer agreed on the phone' }); expect(r.status).toBe(200); return r.json.data }
  const job = (id: string) => prisma.savedJob.findUnique({ where: { id } })
  const start = async (quoteId: string) => (await call('GET', `/api/change-orders/start?quoteId=${quoteId}`)).json.data

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    userId = user.id
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-jobs', savedJobs)
    app.use('/api/change-orders', changeOrders)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    const jobs = made.jobs
    await prisma.billingLog.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.contractInvoice.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.paymentSchedule.deleteMany({ where: { jobId: { in: jobs } } })
    const cos = await prisma.changeOrder.findMany({ where: { quoteId: { in: made.quotes } }, select: { id: true } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...jobs, ...cos.map(c => c.id)] } } })
    await prisma.changeOrder.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.notification.deleteMany({ where: { jobId: { in: jobs } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: jobs } } })
    await prisma.jobQuotedCost.deleteMany({ where: { quoteId: { in: made.quotes } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: made.quotes } } })
    await prisma.crmContact.deleteMany({ where: { id: { in: made.contacts } } })
    server?.close()
  })

  test('a move: CO-1 20 ft, CO-2 a gate, CO-3 the gate out; each starts from the one before', async () => {
    const { quoteId, jobId } = await signed({ type: 'move', move: MOVE })
    expect(await start(quoteId)).toMatchObject({ runs: [100], walkGates: 0, move: MOVE })

    const co1 = await approve(await make(quoteId, { lines: lines(80000), work: { request: request(120, 0, 'move', { move: MOVE }), layout: { yard: null } } }))
    expect(co1.work).toMatchObject({ runs: [120], footage: 120, walkGates: 0 })
    expect(co1.scope.footageFt).toBe(20)
    expect(co1.costDelta.totalCents).toBeGreaterThan(0)
    expect(await job(jobId)).toMatchObject({ contractValue: 4800, totalFeet: 120, sections: co1.work.sections })
    expect(await start(quoteId)).toMatchObject({ runs: [120], walkGates: 0, move: MOVE })

    const co2 = await approve(await make(quoteId, { lines: lines(30000), work: { request: request(120, 1, 'move', { move: MOVE }), layout: { yard: null } } }))
    expect(co2.scope).toMatchObject({ walkGates: 1 })
    expect(co2.scope.footageFt).toBeUndefined()
    expect(await job(jobId)).toMatchObject({ contractValue: 5100, walkGates: 1 })
    expect(await start(quoteId)).toMatchObject({ runs: [120], walkGates: 1 })

    await approve(await make(quoteId, { lines: lines(-30000), work: { request: request(120, 0, 'move', { move: MOVE }), layout: { yard: null } } }))
    expect(await job(jobId)).toMatchObject({ contractValue: 4800, changeOrderTotal: 800, walkGates: 0, totalFeet: 120 })
  })

  test('the cost difference is of the move, never a new fence of the same runs', async () => {
    const { quoteId } = await signed({ type: 'move', move: MOVE })
    const co = await make(quoteId, { lines: lines(0, 'No change'), work: { request: request(100, 0, 'move', { move: MOVE }), layout: { yard: null } } })
    expect(co.costDelta.totalCents).toBe(0)
  })

  test('a move input changed: the next one opens on it, and its own void takes it back', async () => {
    const { quoteId } = await signed({ type: 'move', move: MOVE })
    const moved = { ...MOVE, newPostCaps: true }
    const co = await approve(await make(quoteId, { lines: lines(5000), work: { request: request(100, 0, 'move', { move: moved }), layout: { yard: null } } }))
    expect((await start(quoteId)).move.newPostCaps).toBe(true)
    const r = await call('PATCH', `/api/change-orders/${co.id}`, { baseVersion: co.version, status: 'void' })
    expect(r.status).toBe(200)
    expect((await start(quoteId)).move.newPostCaps).toBe(false)
  })

  test('a repair: two change orders, signed out of order, keep both; a void leaves the other', async () => {
    const { quoteId, jobId } = await signed({ type: 'repair', repair: REPAIR }, 1)
    const items1 = { ...REPAIR, items: { replaceSection: 1, resetPost: 1 } }
    const co1 = await make(quoteId, { lines: lines(70000, "Changes to the work, at today's prices"), work: { request: request(100, 0, 'repair', { repair: items1 }), layout: { yard: null } } })
    expect((await start(quoteId)).repair.items).toEqual({ replaceSection: 1, resetPost: 1 })
    const items2 = { ...REPAIR, items: { replaceSection: 1, resetPost: 1, replacePost: 1 } }
    const co2 = await make(quoteId, { lines: lines(50000, "Changes to the work, at today's prices"), work: { request: request(100, 0, 'repair', { repair: items2 }), layout: { yard: null } } })
    await approve(co2)
    const signed1 = await approve((await call('GET', `/api/change-orders?quoteId=${quoteId}`)).json.data.find((c: any) => c.id === co1.id))
    expect(await job(jobId)).toMatchObject({ contractValue: 5200, sections: 1 })
    expect((await start(quoteId)).repair.items).toEqual({ replaceSection: 1, resetPost: 1, replacePost: 1 })
    const r = await call('PATCH', `/api/change-orders/${signed1.id}`, { baseVersion: signed1.version, status: 'void' })
    expect(r.status).toBe(200)
    expect((await start(quoteId)).repair.items).toEqual({ replaceSection: 1, replacePost: 1 })
  })

  test('typed lines stay price only; a request for another kind of job keeps no work', async () => {
    const { quoteId, jobId } = await signed({ type: 'move', move: MOVE })
    const typed = await approve(await make(quoteId, { lines: lines(10000, 'Haul off the old slab') }))
    expect(typed.work).toBeNull()
    const other = await make(quoteId, { lines: lines(10000), work: { request: request(120, 0, 'new'), layout: { yard: null } } })
    expect(other.work).toBeNull()
    expect(await job(jobId)).toMatchObject({ contractValue: 4100, totalFeet: 100 })
    expect(await start(quoteId)).toMatchObject({ runs: [100], move: MOVE })
  })

  test('picked sections on a move stay price only (a new fence keeps the work they leave)', async () => {
    const { quoteId, jobId } = await signed({ type: 'move', move: MOVE })
    const co = await approve(await make(quoteId, { lines: [{ id: `l${n++}`, description: '1 × Add a section', amountCents: 30000, qty: 1, source: { kind: 'repair', ref: 'add:section', label: 'Add a section' } }] }))
    expect(co.work).toBeNull()
    expect(await job(jobId)).toMatchObject({ contractValue: 4300, totalFeet: 100 })
  })
})
