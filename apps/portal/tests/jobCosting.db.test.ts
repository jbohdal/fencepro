/**
 * Job costing against the dev database (DEV_DB=1; refuses any other).
 *
 * - Signing saves the quoted cost once: the customer's quote link (accept),
 *   and marking Sold in the app (a PATCH to SOLD). Sent twice it is one; the
 *   quote edited after signing does not change it.
 * - A quote already Sold before job costing gets no quoted cost when it is
 *   saved again (no backfill by guessing).
 * - The takeoff from the snapshot, as an Installer: quantities only, no cost
 *   anywhere in its answers; approving, the job's cost and the report are
 *   refused to it. The owner approves: the actual cost is frozen.
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
describe.skipIf(!process.env.DEV_DB || !onDev)('job costing (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: savedQuotes } = await import('../src/server/routes/saved-quotes.js')
  const { default: jobCosting } = await import('../src/server/routes/job-costing.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { isCostKey } = await import('../src/server/lib/costRedact.js')
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const ids = { quotes: [] as string[], jobs: [] as string[], token: crypto.randomBytes(24).toString('base64url') }
  let owner = '', installer = '', accountId = '', base = ''
  let server: ReturnType<express.Express['listen']>
  const call = (who: string, method: string, p: string, body?: unknown) => fetch(base + p, { method, headers: { ...(who ? { Authorization: `Bearer ${who}` } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => null) as any }))

  const sheet = [
    { item: 'E2E Job Costing Post', qty: 10, unitCost: 13.5, total: 135, costSource: 'inventory' },
    { item: 'E2E Job Costing Concrete', qty: 20, unitCost: 6.5, total: 130, costSource: 'inventory' },
  ]
  const quoteData = (status: 'DRAFT' | 'SOLD', extra: Record<string, unknown> = {}) => ({
    accountId, customerName: 'E2E Job Costing Test', fenceStyle: "WV-ND 6'x8' Privacy", runs: [40, 40], sections: 10,
    materialCost: 265, laborCost: 240, tearOutCost: 0, totalCOGS: 505, finalPrice: 1000, gmPct: 0.495, pullSheet: sheet,
    pricing: { laborMode: 'subcontractor', subUnit: 'section' }, status, salesRep: 'E2E Rep', ...extra,
  })
  const quotedRows = (quoteId: string) => prisma.jobQuotedCost.findMany({ where: { quoteId } })
  /** Every key in a JSON answer, at any depth. */
  const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
    if (Array.isArray(v)) v.forEach(x => keysOf(x, out))
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out) }
    return out
  }

  beforeAll(async () => {
    const user = (await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } }))!
    accountId = user.crmAccountId!
    const sign = (role: string) => jwt.sign({ sub: user.id, email: user.email, role, firstName: user.firstName, lastName: user.lastName, crmAccountId: accountId }, secret, { expiresIn: '10m' })
    owner = sign('super_admin')
    installer = sign('field_crew')
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-quotes', savedQuotes)
    app.use('/api/job-costing', jobCosting)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    await prisma.jobTakeoff.deleteMany({ where: { jobId: { in: ids.jobs } } })
    await prisma.jobQuotedCost.deleteMany({ where: { quoteId: { in: ids.quotes } } })
    await prisma.savedJob.deleteMany({ where: { id: { in: ids.jobs } } })
    await prisma.savedQuote.deleteMany({ where: { id: { in: ids.quotes } } })
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...ids.quotes, ...ids.jobs] } } })
    await prisma.crmAuditLog.deleteMany({ where: { entityType: 'JobTakeoff', entityId: { startsWith: 'e2e-jc-' } } })
    server?.close()
  })

  test('the customer\'s quote link: accepting saves the quoted cost once, in cents, as priced', async () => {
    const q = await prisma.savedQuote.create({ data: { ...quoteData('SENT' as any), shareToken: ids.token } as any })
    ids.quotes.push(q.id)
    expect(await quotedRows(q.id)).toHaveLength(0)
    const a = await call('', 'POST', `/api/saved-quotes/share/${ids.token}/accept`, { name: 'E2E Customer' })
    expect(a.status).toBe(200)
    // Sent again (no signal on the customer's phone): still one.
    await call('', 'POST', `/api/saved-quotes/share/${ids.token}/accept`, { name: 'E2E Customer' })
    const rows = await quotedRows(q.id)
    expect(rows).toHaveLength(1)
    const r = rows[0]
    expect([r.signedVia, r.priceCents, r.materialCents, r.laborCents, r.tearOutCents, r.totalCents, r.sections, r.footage, r.salesRep]).toEqual(['share', 100000, 26500, 24000, 0, 50500, 10, 80, 'E2E Rep'])
    expect((r.lines as any[]).map(l => [l.part, l.qty, l.unitCostCents, l.totalCostCents])).toEqual([['E2E Job Costing Post', 10, 1350, 13500], ['E2E Job Costing Concrete', 20, 650, 13000]])
    expect(r.labor).toMatchObject({ mode: 'sub', subUnit: 'section', subUnits: 10 })
  })

  test('marked Sold in the app saves it once; changing the quote afterwards does not change it', async () => {
    const q = await prisma.savedQuote.create({ data: quoteData('DRAFT') as any })
    ids.quotes.push(q.id)
    const p1 = await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, { status: 'SOLD' })
    expect(p1.status).toBe(200)
    const [r] = await quotedRows(q.id)
    expect(r?.signedVia).toBe('app')
    expect(r?.totalCents).toBe(50500)
    const p2 = await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, { pullSheet: [{ item: 'Changed', qty: 1, unitCost: 999, total: 999 }], materialCost: 999, totalCOGS: 1239 })
    expect(p2.status).toBe(200)
    const after = await quotedRows(q.id)
    expect(after).toHaveLength(1)
    expect(after[0].totalCents).toBe(50500)
    expect((after[0].lines as any[]).length).toBe(2)
  })

  test('a quote Sold before job costing gets no quoted cost when saved again (nothing backfilled)', async () => {
    const q = await prisma.savedQuote.create({ data: quoteData('SOLD') as any })
    ids.quotes.push(q.id)
    const p = await call(owner, 'PATCH', `/api/saved-quotes/${q.id}`, { notes: 'edited later' })
    expect(p.status).toBe(200)
    expect(await quotedRows(q.id)).toHaveLength(0)
  })

  test('takeoff: the installer sees quantities only and cannot approve; the owner approves and the cost is frozen', async () => {
    const quoteId = ids.quotes[1]
    const job = await prisma.savedJob.create({ data: { accountId, quoteId, customerName: 'E2E Job Costing Test', fenceStyle: "WV-ND 6'x8' Privacy", sections: 10, status: 'in_progress', contractValue: 1000, quotePrice: 1000, salesRep: 'E2E Rep', scheduledDate: '2026-10-14' } as any })
    ids.jobs.push(job.id)
    const tid = `e2e-jc-${crypto.randomUUID().slice(0, 8)}`
    const answers: unknown[] = []
    const asInstaller = async (method: string, p: string, body?: unknown) => { const r = await call(installer, method, p, body); answers.push(r.json); return r }

    const s = await asInstaller('POST', '/api/job-costing/takeoff', { id: tid, jobId: job.id })
    expect(s.status).toBe(201)
    expect((await asInstaller('POST', '/api/job-costing/takeoff', { id: tid, jobId: job.id })).status).toBe(200) // sent again: the one takeoff
    const t = s.json.data
    expect(t.lines.map((l: any) => [l.part, l.plannedQty, l.usedQty])).toEqual([['E2E Job Costing Post', 10, 10], ['E2E Job Costing Concrete', 20, 20]])
    expect(t.installDate).toBe('2026-10-14')
    const post = t.lines[0], concrete = t.lines[1]
    await asInstaller('PUT', `/api/job-costing/takeoff/${tid}/lines/${encodeURIComponent(post.id)}`, { usedQty: 11, shopReturnQty: 0, vendorReturnQty: 0, note: '' })
    await asInstaller('PUT', `/api/job-costing/takeoff/${tid}/lines/${encodeURIComponent(concrete.id)}`, { usedQty: 18, shopReturnQty: 2, vendorReturnQty: 0, note: '' })
    const ex = await asInstaller('PUT', `/api/job-costing/takeoff/${tid}/lines/${tid}:x1`, { part: 'E2E Broken Panel', inventoryItemId: null, usedQty: 1, extra: true, reason: 'broken', note: 'cracked' })
    expect(ex.status).toBe(200)
    // A pull sheet line this takeoff does not have is refused, not added.
    expect((await asInstaller('PUT', `/api/job-costing/takeoff/${tid}/lines/${tid}:q9`, { part: 'x', usedQty: 1 })).status).toBe(409)
    await asInstaller('PUT', `/api/job-costing/takeoff/${tid}/labor`, { mode: 'sub', subUnits: 10, crew: [] })
    const sub = await asInstaller('POST', `/api/job-costing/takeoff/${tid}/submit`)
    expect(sub.json.data.status).toBe('submitted')
    // Submitted: the crew can no longer change it.
    expect((await asInstaller('PUT', `/api/job-costing/takeoff/${tid}/lines/${encodeURIComponent(post.id)}`, { usedQty: 12 })).status).toBe(409)
    const refused = await Promise.all([
      asInstaller('POST', `/api/job-costing/takeoff/${tid}/approve`, {}),
      asInstaller('GET', `/api/job-costing/job/${job.id}`),
      asInstaller('GET', '/api/job-costing/report'),
      asInstaller('GET', '/api/job-costing/finance'),
    ])
    expect(refused.map(r => r.status)).toEqual([403, 403, 403, 403])
    expect((await asInstaller('GET', `/api/job-costing/takeoff?jobId=${job.id}`)).json.data.lines).toHaveLength(3)
    // Nothing the installer received holds a cost.
    const costKeys = [...keysOf(answers)].filter(isCostKey)
    expect(costKeys).toEqual([])

    const ap = await call(owner, 'POST', `/api/job-costing/takeoff/${tid}/approve`, { otherLaborCostCents: 2500 })
    expect(ap.status).toBe(200)
    expect(ap.json.data.status).toBe('approved')
    const row = (await prisma.jobTakeoff.findUnique({ where: { id: tid } }))!
    const actual = row.actualCost as any
    expect(actual.frozen).toBe(true)
    // Post and concrete at today's Inventory cost when they match an item (else the quote's), the panel has none: 0.
    const byPart = Object.fromEntries(actual.lines.map((l: any) => [l.part, l]))
    expect(byPart['E2E Job Costing Post'].usedQty).toBe(11)
    expect(byPart['E2E Job Costing Post'].costSource).toBe('quote')
    expect(byPart['E2E Job Costing Post'].totalCostCents).toBe(11 * 1350)
    expect(byPart['E2E Job Costing Concrete'].totalCostCents).toBe(18 * 650)
    expect(byPart['E2E Broken Panel'].costSource).toBe('none')
    expect(actual.laborCents).toBe(10 * 2400 + 2500)
    expect(actual.totalCents).toBe(11 * 1350 + 18 * 650 + 24000 + 2500)

    const cmp = await call(owner, 'GET', `/api/job-costing/job/${job.id}`)
    expect(cmp.status).toBe(200)
    expect(cmp.json.data.comparison.quoted.totalCents).toBe(50500)
    expect(cmp.json.data.comparison.actual.totalCents).toBe(actual.totalCents)
    expect(cmp.json.data.comparison.diffCents).toBe(actual.totalCents - 50500)
    // Approved: read only, for everyone, until reopened.
    expect((await call(owner, 'PUT', `/api/job-costing/takeoff/${tid}/lines/${encodeURIComponent(post.id)}`, { usedQty: 12 })).status).toBe(409)
    const rep = await call(owner, 'GET', '/api/job-costing/report')
    const mine = rep.json.data.jobs.find((j: any) => j.jobId === job.id)
    expect(mine).toMatchObject({ takeoff: 'approved', quotedCents: 50500, actualCents: actual.totalCents, priceCents: 100000, month: '2026-10' })
  })
})
