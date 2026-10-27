/**
 * Sales Orders follow each sold job's pull sheet, on every signing path (dev
 * database, DEV_DB=1; refuses any other). Audit Oct 26 2026 item 2.
 *
 * - The customer signs the tan option on the proposal link: the job gets an
 *   order, with the tan parts (not the quote's first, white, option).
 * - Marked Sold in the app (the job saved by the phone): the job gets an order.
 * - A change order approved: the pending order follows the new work; once
 *   ordered, a later change order puts only the difference on a new pending
 *   order and what was ordered stays as it was.
 *
 * Writes only inside beforeAll, test and afterAll; removes what it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('sales orders follow the job (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedJobs } = await import('../src/server/routes/saved-jobs.js')
  const { publicProposal } = await import('../src/server/routes/proposal.js') as any
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { applyToJob } = await import('../src/server/lib/changeOrders.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const ids = { quotes: [] as string[], jobs: [] as string[] }
  let owner = '', accountId = '', base = ''
  let server: ReturnType<express.Express['listen']>
  const call = (who: string, method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))

  const WHITE = [{ item: 'E2E SO White Post', qty: 11, unitCost: 13.5, total: 148.5 }, { item: 'E2E SO Tear Out Haul-Away Fence', qty: 4, unitCost: 9.5, total: 38 }]
  const TAN = [{ item: 'E2E SO Tan Post', qty: 11, unitCost: 15, total: 165 }, { item: 'E2E SO Tan Picket', qty: 200, unitCost: 2.5, total: 500 }, { item: 'E2E SO Section price', qty: 10, unitCost: 50, total: 500, jobLotPiece: true }]
  const quoteData = (status: string, extra: Record<string, unknown> = {}) => ({
    accountId, customerName: 'E2E Sales Order Test', customerPhone: '3525550178', fenceStyle: "WV-ND 6'x8' Privacy", runs: [80], sections: 10,
    corners: 0, ends: 2, walkGates: 0, materialCost: 186.5, laborCost: 240, tearOutCost: 0, totalCOGS: 426.5, finalPrice: 1000, gmPct: 0.5,
    pullSheet: WHITE, pricing: { laborMode: 'subcontractor' }, status, salesRep: 'E2E Rep',
    proposal: { version: 1, planSvg: '<svg/>', footageFt: 80, depositPct: 50, recommended: 0, options: [
      { label: 'White', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 1000, perFoot: 12.5, sections: 10, snapshot: { materialCost: 186.5, laborCost: 240, tearOutCost: 0, totalCOGS: 426.5, gmPct: 0.5, pullSheet: WHITE, runSections: [10] } },
      { label: 'Tan', fenceStyle: "TV-ND 6'x8' Privacy", finalPrice: 1400, perFoot: 17.5, sections: 10, snapshot: { materialCost: 665, laborCost: 240, tearOutCost: 0, totalCOGS: 905, gmPct: 0.35, pullSheet: TAN, runSections: [10] } },
    ] },
    ...extra,
  })
  const ordersOf = async (quoteId: string) => {
    const s = await prisma.businessState.findUnique({ where: { accountId }, select: { pendingOrders: true } })
    return ((s?.pendingOrders ?? []) as any[]).filter(o => o?.quoteId === quoteId)
  }
  const parts = (o: any) => (o.items as any[]).map(i => [i.itemName, i.requiredQuantity, i.totalCostCents])
  async function setOrderStatus(id: string, status: string) {
    for (;;) {
      const s = (await prisma.businessState.findUnique({ where: { accountId }, select: { pendingOrders: true, version: true } }))!
      const next = (s.pendingOrders as any[]).map(o => (o.id === id ? { ...o, status } : o))
      const d = await prisma.businessState.updateMany({ where: { accountId, version: s.version }, data: { pendingOrders: next, version: { increment: 1 } } })
      if (d.count) return
    }
  }

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-jobs', savedJobs)
    app.use('/api/proposal', publicProposal)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    const jobs = (await prisma.savedJob.findMany({ where: { quoteId: { in: ids.quotes } }, select: { id: true } })).map(j => j.id)
    ids.jobs.push(...jobs)
    for (;;) {
      const s = await prisma.businessState.findUnique({ where: { accountId }, select: { pendingOrders: true, version: true } })
      if (!s) break
      const all = (s.pendingOrders ?? []) as any[]
      const next = all.filter(o => !ids.quotes.includes(o?.quoteId))
      if (next.length === all.length) break
      const d = await prisma.businessState.updateMany({ where: { accountId, version: s.version }, data: { pendingOrders: next, version: { increment: 1 } } })
      if (d.count) break
    }
    await prisma.changeOrder.deleteMany({ where: { quoteId: { in: ids.quotes } } })
    await prisma.jobQuotedCost.deleteMany({ where: { quoteId: { in: ids.quotes } } })
    await prisma.signedDocument.deleteMany({ where: { quoteId: { in: ids.quotes } } })
    await prisma.paymentSchedule.deleteMany({ where: { quoteId: { in: ids.quotes } } })
    await prisma.jobChecklistItem.deleteMany({ where: { jobId: { in: ids.jobs } } }).catch(() => {})
    await prisma.savedJob.deleteMany({ where: { id: { in: ids.jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: ids.quotes } } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...ids.quotes, ...ids.jobs] } } })
    server?.close()
  })

  test('signed on the proposal link at the tan option: the job gets an order with the tan parts', async () => {
    const token = crypto.randomBytes(24).toString('base64url')
    const q = await prisma.savedQuote.create({ data: quoteData('SENT', { shareToken: token }) as any })
    ids.quotes.push(q.id)
    const a = await call('', 'POST', `/api/proposal/${token}/accept`, { option: 1, name: 'E2E Customer' })
    expect(a.status).toBe(200)
    const job = await prisma.savedJob.findFirst({ where: { quoteId: q.id } })
    expect(job).toBeTruthy()
    const [o, ...more] = await ordersOf(q.id)
    expect(more).toHaveLength(0)
    expect(o).toMatchObject({ status: 'pending', jobId: job!.id, customerName: 'E2E Sales Order Test' })
    // Parts only: the job lot section price line is money, not a part to order.
    expect(parts(o)).toEqual([['E2E SO Tan Post', 11, 16500], ['E2E SO Tan Picket', 200, 50000]])
    expect(o.quoteName).toMatch(/tan/i)
  })

  test('marked Sold in the app: the job the phone saves gets an order, without tear out', async () => {
    const q = await prisma.savedQuote.create({ data: quoteData('SOLD', { soldAt: new Date() }) as any })
    ids.quotes.push(q.id)
    const r = await call(owner, 'POST', '/api/saved-jobs', { quoteId: q.id, customerName: 'E2E Sales Order Test', fenceStyle: q.fenceStyle, quotePrice: 1000, contractValue: 1000, status: 'staging' })
    expect(r.status).toBe(201)
    const [o] = await ordersOf(q.id)
    expect(o).toBeTruthy()
    expect(o.jobId).toBe(r.json.data.id)
    expect(parts(o)).toEqual([['E2E SO White Post', 11, 14850]])
  })

  test('approved change orders: the pending order follows; once ordered, only the difference is a new pending order', async () => {
    const q = await prisma.savedQuote.create({ data: quoteData('SOLD', { soldAt: new Date() }) as any })
    ids.quotes.push(q.id)
    const job = await prisma.savedJob.create({ data: { accountId, quoteId: q.id, customerName: 'E2E Sales Order Test', fenceStyle: q.fenceStyle, quotePrice: 1000, contractValue: 1000, sections: 10, totalFeet: 80 } as any })
    ids.jobs.push(job.id)
    const work = (posts: number) => ({ fenceStyle: q.fenceStyle, runs: [80 + (posts - 11) * 8], sections: posts - 1, footage: 80 + (posts - 11) * 8, walkGates: 0, dblGates: 0, tearOutSections: 0, pullSheet: [{ item: 'E2E SO White Post', qty: posts, unitCost: 13.5, total: posts * 13.5 }] })
    await prisma.changeOrder.create({ data: { accountId, quoteId: q.id, number: 1, status: 'approved', approvedAt: new Date(Date.now() - 60_000), approvedBy: 'E2E', reason: '+16 ft', lines: [], totalCents: 20000, work: work(13) as any } })
    await applyToJob(accountId, q.id)
    let [o] = await ordersOf(q.id)
    expect(o.source).toBe('Change order CO-1')
    expect(parts(o)).toEqual([['E2E SO White Post', 13, 17550]])

    await setOrderStatus(o.id, 'ordered')
    await prisma.changeOrder.create({ data: { accountId, quoteId: q.id, number: 2, status: 'approved', approvedAt: new Date(), approvedBy: 'E2E', reason: '+16 ft', lines: [], totalCents: 20000, work: work(15) as any } })
    await applyToJob(accountId, q.id)
    const all = await ordersOf(q.id)
    expect(all).toHaveLength(2)
    const ordered = all.find(x => x.id === o.id)!
    expect(ordered.status).toBe('ordered')
    expect(parts(ordered)).toEqual([['E2E SO White Post', 13, 17550]])
    o = all.find(x => x.status === 'pending')!
    expect(parts(o)).toEqual([['E2E SO White Post', 2, 2700]])
    expect(o.source).toBe('Change order CO-2')
  })
})
