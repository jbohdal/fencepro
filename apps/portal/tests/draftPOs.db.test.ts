/**
 * Draft purchase orders in Pending Orders, through the real business record
 * route, against the dev database (DEV_DB=1 and ezbiz_dev only), on a company
 * made for the test and removed after it:
 *
 *   - the office's Mark ordered on a draft: the job's Sales Order marked
 *     Ordered and the draft closed as ordered, in one save (the same PATCH
 *     the page makes), money still integer cents;
 *   - the office's Discard draft: closed as cancelled, the Sales Order as it was;
 *   - the Installer reads no drafts at all (no prices) and cannot change them;
 *     the Salesman reads them with their costs.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { closeDraft, shownDrafts } from '../../web/src/draftPOs'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('draft purchase orders in Pending Orders (dev database)', () => {
  let prisma: any
  let server: Server
  let base = ''
  let accountId = ''
  const tag = `dpo-${Date.now().toString(36)}`
  type Who = 'office' | 'crew' | 'sales'
  const users: Record<string, { id: string; token: string }> = {}
  const call = (who: Who, method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { Authorization: `Bearer ${users[who].token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))

  const now = new Date().toISOString()
  const line = (id: string, itemName: string, quantity: number, unitCostCents: number) => ({ id, itemName, quantity, unitCostCents, totalCents: quantity * unitCostCents })
  const draft = (id: string, jobId: string) => ({
    id, poNumber: `PO-${id}`, jobId, jobName: `Testy ${tag}`, jobAddress: '1 Test St, Ocala', supplier: 'Default Supplier', status: 'draft',
    lineItems: [line('l1', 'ND, Donut', 58, 412), line('l2', 'Vinyl, 5x6 WV Section', 12, 8950)],
    subtotalCents: 58 * 412 + 12 * 8950, notes: '', createdAt: now, createdBy: 'auto',
  })
  const order = (id: string, jobId: string) => ({ id, quoteId: `${tag}-q-${jobId}`, quoteName: `Test ${tag}`, jobId, customerName: `Testy ${tag}`, status: 'pending', totalCostCents: 131296, items: [], notes: '', createdAt: now, updatedAt: now })

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const { hideCostsFromLimitedLogins } = await import('../src/server/lib/costRedact.js')
    const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const roles: Record<Who, string> = { office: 'office_staff', crew: 'field_crew', sales: 'sales_rep' }
    for (const [who, role] of Object.entries(roles) as [Who, string][]) {
      const u = await prisma.crmUser.create({ data: { email: `${tag}-${who}@example.test`, firstName: 'Test', lastName: who, role, status: 'active', crmAccountId: accountId, mustChangePassword: false } })
      users[who] = { id: u.id, token: jwt.sign({ sub: u.id, email: u.email, role, firstName: 'Test', lastName: who, crmAccountId: accountId }, secret, { expiresIn: '15m' }) }
    }
    await prisma.businessState.create({ data: { accountId, purchaseOrders: [draft('a', 'job-a'), draft('b', 'job-b')], pendingOrders: [order('oa', 'job-a'), order('ob', 'job-b')] } })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    // As index.ts mounts it: a limited login's answers go out without costs.
    app.use('/api', hideCostsFromLimitedLogins)
    app.use('/api/business-state', (await import('../src/server/routes/business-state.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const ids = Object.values(users).map(u => u.id)
    await prisma.crmAuditLog.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
    await prisma.businessState.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmUserSession.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
    await prisma.crmUserActivity.deleteMany({ where: { userId: { in: ids } } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { id: { in: ids } } }).catch((e: unknown) => console.error('[draftPOs test] users cleanup:', e))
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch((e: unknown) => console.error('[draftPOs test] account cleanup:', e))
  })

  test('the Installer reads no drafts and cannot change them; the Salesman reads none of other people\'s jobs', async () => {
    const crew = await call('crew', 'GET', '/api/business-state')
    expect(crew.status).toBe(200)
    expect(crew.json.data.purchaseOrders).toBeUndefined()
    const sales = await call('sales', 'GET', '/api/business-state')
    // Jobs that are not the Salesman's: their drafts are left out (lib/salesScopeRecords.ts; Jonathan, Oct 28 2026).
    expect(shownDrafts(sales.json.data.purchaseOrders)).toEqual([])
    const v = crew.json.data.version
    const r = await call('crew', 'PATCH', '/api/business-state', { purchaseOrders: [], baseVersion: v })
    expect(r.status).toBe(403)
    expect((await prisma.businessState.findUnique({ where: { accountId } })).purchaseOrders).toHaveLength(2)
  })

  test("the office's Mark ordered: the Sales Order Ordered and the draft closed, in one save", async () => {
    const read = (await call('office', 'GET', '/api/business-state')).json.data
    const stamp = new Date().toISOString()
    const pos = closeDraft(read.purchaseOrders, 'a', 'ordered', stamp)!
    const orders = read.pendingOrders.map((o: any) => (o.id === 'oa' ? { ...o, status: 'ordered', orderedAt: stamp, updatedAt: stamp } : o))
    const r = await call('office', 'PATCH', '/api/business-state', { purchaseOrders: pos, pendingOrders: orders, baseVersion: read.version })
    expect(r.status).toBe(200)
    const s = await prisma.businessState.findUnique({ where: { accountId } })
    const a = (s.purchaseOrders as any[]).find(p => p.id === 'a')
    expect(a).toMatchObject({ status: 'ordered', orderedAt: stamp, subtotalCents: 131296 })
    for (const l of a.lineItems) expect(Number.isInteger(l.totalCents)).toBe(true)
    expect((s.pendingOrders as any[]).find(o => o.id === 'oa').status).toBe('ordered')
    expect(shownDrafts(s.purchaseOrders as any[]).map(p => p.id)).toEqual(['b'])
  })

  test("the office's Discard draft: closed as cancelled; the Sales Order stays pending", async () => {
    const read = (await call('office', 'GET', '/api/business-state')).json.data
    const stamp = new Date().toISOString()
    const r = await call('office', 'PATCH', '/api/business-state', { purchaseOrders: closeDraft(read.purchaseOrders, 'b', 'cancelled', stamp), baseVersion: read.version })
    expect(r.status).toBe(200)
    const s = await prisma.businessState.findUnique({ where: { accountId } })
    expect((s.purchaseOrders as any[]).find(p => p.id === 'b')).toMatchObject({ status: 'cancelled', cancelledAt: stamp })
    expect((s.pendingOrders as any[]).find(o => o.id === 'ob').status).toBe('pending')
    expect(shownDrafts(s.purchaseOrders as any[])).toEqual([])
  })
})
