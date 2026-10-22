/**
 * Signed quotes are locked; changes go on a change order (dev database,
 * DEV_DB=1; refuses any other).
 *
 * - PATCH on a Sold quote changing its price: 409 with the sentence, nothing saved.
 * - A note, the customer's phone and the aerial photo's turn: saved.
 * - The old browser sync and the customer's proposal link cannot reprice it either.
 * - A change order made and approved: the job's contract value includes it;
 *   voided, it comes off again; a job save with an old figure does not undo it.
 * - A Salesman makes a change order but cannot approve it, and gets no cost
 *   field in any answer (the 409 included).
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
describe.skipIf(!process.env.DEV_DB || !onDev)('signed quotes are locked (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedQuotes } = await import('../src/server/routes/saved-quotes.js')
  const { default: savedJobs } = await import('../src/server/routes/saved-jobs.js')
  const { default: changeOrders } = await import('../src/server/routes/change-orders.js')
  const { publicProposal } = await import('../src/server/routes/proposal.js') as any
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { isCostKey, hidesCosts, staffRoleOf, redactCosts } = await import('../src/server/lib/costRedact.js')
  const { LOCKED_MESSAGE } = await import('../src/server/lib/quoteLock.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const ids = { quotes: [] as string[], jobs: [] as string[], token: crypto.randomBytes(24).toString('base64url') }
  let owner = '', salesman = '', accountId = '', base = ''
  let server: ReturnType<express.Express['listen']>
  const call = (who: string, method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))
  const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach(x => keysOf(x, out))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out) }
    return out
  }
  const costKeys = (v: unknown) => [...keysOf(v)].filter(k => isCostKey(k))

  const yard = { shape: 'straight', closed: false, sides: [{ id: 's1', name: 'Back', on: true, lengthIn: 960, startFinish: 'free', endFinish: 'free', heading: 0 }], plan: { aerial: { lat: 29.18, lng: -82.13, halfM: 40, address: '1 Lock Test Way', rotDeg: 0, shown: true } } }
  const quoteData = (status: string, extra: Record<string, unknown> = {}) => ({
    accountId, customerName: 'E2E Quote Lock Test', customerPhone: '3525550177', fenceStyle: "WV-ND 6'x8' Privacy", runs: [80], sections: 10,
    corners: 0, ends: 2, walkGates: 1, materialCost: 265, laborCost: 240, tearOutCost: 0, totalCOGS: 505, finalPrice: 1000, gmPct: 0.495,
    pullSheet: [{ item: 'E2E Lock Post', qty: 11, unitCost: 13.5, total: 148.5 }], pricing: { laborMode: 'subcontractor' },
    layout: { yard, runSections: [10] }, status, salesRep: 'E2E Rep',
    proposal: { version: 1, planSvg: '<svg/>', footageFt: 80, depositPct: 50, recommended: 0, options: [
      { label: 'White', fenceStyle: "WV-ND 6'x8' Privacy", finalPrice: 1000, perFoot: 12.5, sections: 10, snapshot: { materialCost: 265, laborCost: 240, tearOutCost: 0, totalCOGS: 505, gmPct: 0.495, pullSheet: [], runSections: [10] } },
      { label: 'Tan', fenceStyle: "TV-ND 6'x8' Privacy", finalPrice: 1200, perFoot: 15, sections: 10, snapshot: { materialCost: 365, laborCost: 240, tearOutCost: 0, totalCOGS: 605, gmPct: 0.45, pullSheet: [], runSections: [10] } },
    ] },
    ...extra,
  })

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    const sign = (role: string) => jwt.sign({ sub: user.id, email: user.email, role, firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    owner = sign('super_admin')
    salesman = sign('sales_rep')
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    // As index.ts: a Salesman's answers go out without costs.
    app.use('/api', (req, res, next) => {
      if (!hidesCosts(staffRoleOf(req))) return next()
      const json = res.json.bind(res)
      res.json = (body: any) => json(redactCosts(body))
      next()
    })
    app.use('/api/saved-quotes', savedQuotes)
    app.use('/api/saved-jobs', savedJobs)
    app.use('/api/change-orders', changeOrders)
    app.use('/api/proposal', publicProposal)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await prisma.changeOrder.deleteMany({ where: { quoteId: { in: ids.quotes } } })
    await prisma.jobQuotedCost.deleteMany({ where: { quoteId: { in: ids.quotes } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: ids.jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: ids.quotes } } })
    const coIds = (await prisma.crmAuditLog.findMany({ where: { entityType: 'ChangeOrder', newValues: { path: ['quoteId'], string_contains: '' } }, select: { id: true, newValues: true } }))
      .filter(r => ids.quotes.includes((r.newValues as any)?.quoteId)).map(r => r.id)
    await prisma.crmAuditLog.deleteMany({ where: { OR: [{ entityId: { in: [...ids.quotes, ...ids.jobs] } }, { id: { in: coIds } }] } })
    server?.close()
  })

  async function soldQuote(extra: Record<string, unknown> = {}) {
    const q = await prisma.savedQuote.create({ data: quoteData('SOLD', extra) as any })
    ids.quotes.push(q.id)
    return q
  }

  test('a Sold quote: changing the price, footage, pull sheet or style is refused with 409, nothing saved', async () => {
    const q = await soldQuote()
    for (const change of [{ finalPrice: 1200 }, { runs: [100], sections: 13 }, { pullSheet: [{ item: 'E2E Lock Post', qty: 14, unitCost: 13.5, total: 189 }] }, { fenceStyle: "TV-ND 6'x8' Privacy" }, { walkGates: 2 }, { status: 'DRAFT' }]) {
      const r = await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, { ...change, notes: 'should not save' })
      expect(r.status).toBe(409)
      expect(r.json.code).toBe('QUOTE_LOCKED')
      if (!('status' in change)) expect(r.json.error).toBe(LOCKED_MESSAGE)
    }
    const after = await prisma.savedQuote.findUnique({ where: { id: q.id } })
    expect(after!.finalPrice).toBe(1000)
    expect(after!.runs).toEqual([80])
    expect(after!.notes).toBe('')
    expect(after!.status).toBe('SOLD')
    expect(after!.updatedAt.getTime()).toBe(q.updatedAt.getTime())
  })

  test('a Sold quote: a note, the customer\'s phone, the aerial photo turned and Lost are saved', async () => {
    const q = await soldQuote()
    const turned = { yard: { ...yard, sides: [{ ...yard.sides[0], name: 'Back fence' }], plan: { aerial: { ...yard.plan.aerial, rotDeg: 30 } } }, runSections: [10] }
    // As the app sends it: the whole quote, prices as saved.
    const whole = { ...quoteData('SOLD'), accountId: undefined, notes: 'gate code 4411', customerPhone: '3525550178', layout: turned }
    const r = await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, whole)
    expect(r.status).toBe(200)
    const after = await prisma.savedQuote.findUnique({ where: { id: q.id } })
    expect([after!.notes, after!.customerPhone, (after!.layout as any).yard.plan.aerial.rotDeg, after!.finalPrice]).toEqual(['gate code 4411', '3525550178', 30, 1000])
    expect((await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, { status: 'LOST' })).status).toBe(200)
    // Sold before job costing (no quoted cost) and now Lost: it was sold once (soldAt, set on the first save
    // while Sold and never cleared), so it stays locked (Jonathan, Oct 20, 2026).
    expect((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!.soldAt).not.toBeNull()
    expect((await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, { finalPrice: 1 })).status).toBe(409)
    expect((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!.finalPrice).toBe(1000)
  })

  test('ever sold: soldAt is set on Sold and kept through Lost; the backfill marks Sold, accepted, quoted cost and job quotes once', async () => {
    const { everSoldCandidates, backfillEverSold, EVER_SOLD_KEY } = await import('../src/server/lib/everSold.js')
    // Through the app: Draft -> Sold sets it; Lost keeps it; nothing clears it.
    const q = await prisma.savedQuote.create({ data: quoteData('DRAFT') as any })
    ids.quotes.push(q.id)
    expect((await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, { status: 'SOLD' })).status).toBe(200)
    const sold = (await prisma.savedQuote.findUnique({ where: { id: q.id } }))!.soldAt
    expect(sold).not.toBeNull()
    expect((await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, { status: 'LOST' })).status).toBe(200)
    expect((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!.soldAt).toEqual(sold)

    // The one-time step, on a company of its own: four quotes sold before soldAt existed, one never sold.
    const acct = (await prisma.crmAccount.create({ data: { name: `Test ever-sold-${Date.now().toString(36)}`, status: 'active' } })).id
    try {
      const mk = async (status: string, extra: Record<string, unknown> = {}) => {
        const r = await prisma.savedQuote.create({ data: { ...quoteData(status), accountId: acct, ...extra } as any })
        return r.id
      }
      const soldNow = await mk('SOLD')
      const accepted = await mk('SENT', { acceptedAt: new Date() })
      const costed = await mk('LOST')
      await prisma.jobQuotedCost.create({ data: { accountId: acct, quoteId: costed, priceCents: 100000 } })
      const jobbed = await mk('LOST')
      await prisma.savedJob.create({ data: { accountId: acct, quoteId: jobbed, customerName: 'E2E Ever Sold Job' } as any })
      const never = await mk('LOST')
      const dry = await everSoldCandidates(acct)
      expect([...dry.ids.keys()].sort()).toEqual([soldNow, accepted, costed, jobbed].sort())
      expect(dry.counts).toMatchObject({ sold: 1, accepted: 1, quotedCost: 1, job: 1, total: 4, alreadySet: 0 })
      const ran = await backfillEverSold(acct)
      expect(ran).toMatchObject({ total: 4 })
      expect(await backfillEverSold(acct)).toBeNull() // once
      const rows = await prisma.savedQuote.findMany({ where: { accountId: acct }, select: { id: true, soldAt: true } })
      expect(rows.filter(r => r.soldAt).map(r => r.id).sort()).toEqual([soldNow, accepted, costed, jobbed].sort())
      expect(rows.find(r => r.id === never)!.soldAt).toBeNull()
      expect(await prisma.accountKeyValue.count({ where: { accountId: acct, key: EVER_SOLD_KEY } })).toBe(1)
    } finally {
      await prisma.savedJob.deleteMany({ where: { accountId: acct } })
      await prisma.jobQuotedCost.deleteMany({ where: { accountId: acct } })
      await prisma.savedQuote.deleteMany({ where: { accountId: acct } })
      await prisma.accountKeyValue.deleteMany({ where: { accountId: acct } })
      await prisma.crmAccount.delete({ where: { id: acct } }).catch(() => {})
    }
  })

  test('signed through the app (quoted cost saved), then Lost: still locked', async () => {
    const q = await prisma.savedQuote.create({ data: quoteData('DRAFT') as any })
    ids.quotes.push(q.id)
    expect((await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, { status: 'SOLD' })).status).toBe(200)
    expect(await prisma.jobQuotedCost.count({ where: { quoteId: q.id } })).toBe(1)
    expect((await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, { status: 'LOST' })).status).toBe(200)
    const r = await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, { finalPrice: 1500 })
    expect(r.status).toBe(409)
    expect((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!.finalPrice).toBe(1000)
  })

  test('the old browser sync and the proposal link cannot reprice a signed quote', async () => {
    const q = await soldQuote({ shareToken: ids.token })
    const s = await call(owner, 'POST', '/api/saved-quotes/sync', { quotes: [{ ...quoteData('SOLD'), accountId: undefined, id: q.id, finalPrice: 2000 }] })
    expect(s.status).toBe(200)
    expect(s.json.data.locked).toBe(1)
    expect((await prisma.savedQuote.findUnique({ where: { id: q.id } }))!.finalPrice).toBe(1000)
    // The customer picks the other option on a quote already signed in the app: refused, nothing changes.
    const a = await call('', 'POST', `/api/proposal/${ids.token}/accept`, { option: 1, name: 'E2E Customer' })
    expect(a.status).toBe(409)
    const after = await prisma.savedQuote.findUnique({ where: { id: q.id } })
    expect([after!.finalPrice, after!.fenceStyle, after!.acceptedAt]).toEqual([1000, "WV-ND 6'x8' Privacy", null])
  })

  test('a change order made and approved: the job\'s contract value includes it; void takes it off', async () => {
    const q = await soldQuote()
    const job = await prisma.savedJob.create({ data: { accountId, quoteId: q.id, customerName: 'E2E Quote Lock Test', fenceStyle: q.fenceStyle, sections: 10, status: 'staging', quotePrice: 1000, contractValue: 1000 } as any })
    ids.jobs.push(job.id)
    // Not on an unsigned quote.
    const draftQ = await prisma.savedQuote.create({ data: quoteData('SENT') as any })
    ids.quotes.push(draftQ.id)
    expect((await call(owner, 'POST', '/api/change-orders', { quoteId: draftQ.id, lines: [{ id: 'a', description: 'x', amountCents: 100 }] })).status).toBe(409)

    const coId = crypto.randomUUID()
    const made = await call(owner, 'POST', '/api/change-orders', {
      id: coId, quoteId: q.id, reason: 'Customer added the side yard',
      lines: [{ id: 'l1', description: 'Add 16 ft of fence', amountCents: 24_050 }, { id: 'l2', description: 'Add a walk gate', amountCents: 39_500 }],
      scope: { footageFt: 16, walkGates: 1 },
    })
    expect(made.status).toBe(201)
    // Whole dollar lines (Oct 21 2026): $240.50 is saved as $240, the cents out of profit.
    expect([made.json.data.number, made.json.data.status, made.json.data.totalCents]).toEqual([1, 'draft', 63_500])
    expect(made.json.data.lines.map((l: any) => l.amountCents)).toEqual([24_000, 39_500])
    // Sent twice (no signal): one.
    expect((await call(owner, 'POST', '/api/change-orders', { id: coId, quoteId: q.id, lines: [{ id: 'l1', description: 'Add 16 ft of fence', amountCents: 24_050 }] })).json.data.id).toBe(coId)
    expect(await prisma.changeOrder.count({ where: { quoteId: q.id } })).toBe(1)
    // A draft does not change the contract value.
    expect((await prisma.savedJob.findUnique({ where: { id: job.id } }))!.contractValue).toBe(1000)

    const sent = await call(owner, 'PATCH', `/api/change-orders/${coId}`, { baseVersion: 1, status: 'sent' })
    expect(sent.status).toBe(200)
    // Built on an old version: refused with the current copy.
    expect((await call(owner, 'PATCH', `/api/change-orders/${coId}`, { baseVersion: 1, status: 'approved' })).status).toBe(409)
    // Approved by the office (verbally): a reason is required.
    expect((await call(owner, 'PATCH', `/api/change-orders/${coId}`, { baseVersion: 2, status: 'approved' })).status).toBe(400)
    const ok = await call(owner, 'PATCH', `/api/change-orders/${coId}`, { baseVersion: 2, status: 'approved', verbalReason: 'Customer agreed on site' })
    expect(ok.status).toBe(200)
    expect(ok.json.data.approvedBy).toBeTruthy()
    let j = await prisma.savedJob.findUnique({ where: { id: job.id } })
    expect([j!.changeOrderTotal, j!.contractValue]).toEqual([635, 1635])
    // Lines of an approved one cannot change.
    expect((await call(owner, 'PATCH', `/api/change-orders/${coId}`, { baseVersion: 3, lines: [{ id: 'l1', description: 'x', amountCents: 1 }] })).status).toBe(409)
    // A job save from an older screen with the old figures: the server keeps the change orders'.
    expect((await call(owner, 'PATCH', `/api/saved-jobs/${job.id}`, { notes: 'crew note', changeOrderTotal: 0, contractValue: 1000 })).status).toBe(200)
    j = await prisma.savedJob.findUnique({ where: { id: job.id } })
    expect([j!.notes, j!.contractValue]).toEqual(['crew note', 1635])
    // Approved at once (agreed on site), a credit: 1635.00 - 100.00.
    const credit = await call(owner, 'POST', '/api/change-orders', { quoteId: q.id, status: 'approved', verbalReason: 'Customer agreed on site', lines: [{ id: 'c1', description: 'Credit: no tear out', amountCents: -10_000 }] })
    expect([credit.status, credit.json.data.number]).toEqual([201, 2])
    expect((await prisma.savedJob.findUnique({ where: { id: job.id } }))!.contractValue).toBe(1535)
    // Voided: off again.
    expect((await call(owner, 'PATCH', `/api/change-orders/${coId}`, { baseVersion: 3, status: 'void' })).status).toBe(200)
    expect((await prisma.savedJob.findUnique({ where: { id: job.id } }))!.contractValue).toBe(900)
    // The list by job.
    const list = await call(owner, 'GET', `/api/change-orders?jobId=${job.id}`)
    expect(list.json.data.map((c: any) => [c.number, c.status])).toEqual([[1, 'void'], [2, 'approved']])
  })

  test('a Salesman: makes a change order, cannot approve one, and never gets a cost field', async () => {
    const q = await soldQuote()
    const made = await call(salesman, 'POST', '/api/change-orders', { quoteId: q.id, lines: [{ id: 's1', description: 'Add 8 ft', amountCents: 12_000 }] })
    expect(made.status).toBe(201)
    expect(costKeys(made.json)).toEqual([])
    const approve = await call(salesman, 'PATCH', `/api/change-orders/${made.json.data.id}`, { baseVersion: 1, status: 'approved' })
    expect(approve.status).toBe(403)
    expect((await call(salesman, 'POST', '/api/change-orders', { quoteId: q.id, status: 'approved', lines: [{ id: 's2', description: 'x', amountCents: 1 }] })).status).toBe(403)
    const list = await call(salesman, 'GET', `/api/change-orders?quoteId=${q.id}`)
    expect(list.json.data).toHaveLength(1)
    expect(costKeys(list.json)).toEqual([])
    // Their save that would reprice the signed quote: refused, and the answer carries no cost.
    const r = await call(salesman, 'PATCH', `/api/saved-quotes/${q.id}`, { runs: [96], priceRequest: { fenceStyle: q.fenceStyle, runs: [{ ft: 96, rail: 'auto' }], corners: 0, ends: 2, walkGates: 1, dblGates: 0 } })
    expect(r.status).toBe(409)
    expect(r.json.error).toBe(LOCKED_MESSAGE)
    expect(costKeys(r.json)).toEqual([])
    // Their note on it: saved, costs as they were.
    expect((await call(salesman, 'PATCH', `/api/saved-quotes/${q.id}`, { notes: 'salesman note' })).status).toBe(200)
    const after = await prisma.savedQuote.findUnique({ where: { id: q.id } })
    expect([after!.notes, after!.materialCost, after!.finalPrice]).toEqual(['salesman note', 265, 1000])
  })
})
