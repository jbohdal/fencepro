/**
 * A cut stops at the minimum job price, on the route (Jonathan, Nov 3 2026,
 * item 32: "yes, a cut stops at $350. Owner can override."). Against the dev
 * database (DEV_DB=1; refuses any other), on the company's own Settings, with a
 * throwaway signed quote removed by id. A crafted save that skips the screen
 * is held to it too. Nothing is sent: no job, no Salesman (no OK notices).
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('a cut under the minimum job price, on the change order route (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: changeOrders } = await import('../src/server/routes/change-orders.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const { CUT_BELOW_MINIMUM_CODE } = await import('../src/server/lib/changeOrderMinimum.js')

  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const quotes: string[] = [], orders: string[] = []
  let accountId = '', ownerId = '', base = '', server: any, floor = 0
  const tokens: Record<string, string> = {}

  beforeAll(async () => {
    accountId = (await resolveIntakeAccountId())!
    const owner = (await prisma.crmUser.findFirst({ where: { crmAccountId: accountId, role: 'super_admin' } }))!
    ownerId = owner.id
    const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const mr = (b?.config as any)?.moveRepair
    expect(mr?.minimumAppliesToNew).toBe(true)
    floor = Math.floor(mr.minimumJobCents / 100) * 100
    expect(floor).toBe(35000)
    for (const role of ['super_admin', 'office_staff', 'manager']) {
      tokens[role] = jwt.sign({ sub: owner.id, email: owner.email, role, firstName: 'Test', lastName: 'Cut', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    }
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/change-orders', changeOrders)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    for (const id of orders) {
      await prisma.crmAuditLog.deleteMany({ where: { entityId: id, entityType: 'ChangeOrder' } })
      await prisma.changeOrder.deleteMany({ where: { id, accountId } })
    }
    for (const id of quotes) await prisma.savedQuote.deleteMany({ where: { id, accountId } })
  })

  const send = async (role: string, method: string, path: string, body: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) as any }
  }
  /** A signed new fence for $647, written directly (no job). */
  async function signed(price = 647) {
    const id = crypto.randomUUID()
    quotes.push(id)
    await prisma.savedQuote.create({ data: { id, accountId, ownerId, customerName: 'ZZ Test Cut Minimum', fenceStyle: "WV-ND 6'x8' Privacy", runs: [20], sections: 3, corners: 0, ends: 2, finalPrice: price, totalCOGS: 300, gmPct: 0.3, status: 'SOLD', soldAt: new Date(), pullSheet: [] } as any })
    return id
  }
  const make = (role: string, quoteId: string, cents: number, extra: Record<string, unknown> = {}) => {
    const id = crypto.randomUUID()
    orders.push(id)
    return send(role, 'POST', '/api/change-orders', { id, quoteId, reason: 'Customer wants less fence', lines: [{ id: crypto.randomUUID(), description: 'Remove 12 ft of fence', amountCents: cents }], ...extra }).then(r => ({ ...r, id }))
  }

  test('the office: $647 cut by $479 is refused, in plain words; cut by $297 to the $350 minimum it saves', async () => {
    const q = await signed()
    const over = await make('office_staff', q, -47900)
    expect(over.status).toBe(409)
    expect(over.json.code).toBe(CUT_BELOW_MINIMUM_CODE)
    expect(over.json.error).toBe('This cannot be saved. It takes the job under the $350 minimum job price: the contract would be $168. Take less off, or ask Jonathan.')
    expect(await prisma.changeOrder.findUnique({ where: { id: over.id } })).toBeNull()
    // Saying it is an override does nothing for a login that is not the owner.
    const crafted = await make('manager', q, -47900, { minimumOverride: true })
    expect(crafted.status).toBe(409)
    const ok = await make('office_staff', q, -29700)
    expect(ok.status).toBe(201)
    expect(ok.json.data.totalCents).toBe(-29700)
  })

  test('counted with the other change orders: a second cut on a job already at the minimum is refused', async () => {
    const q = await signed()
    expect((await make('office_staff', q, -29700)).status).toBe(201)
    expect((await make('office_staff', q, -100)).status).toBe(409)
    // An add is never held to it.
    expect((await make('office_staff', q, 10000)).status).toBe(201)
  })

  test('the owner: told, then gives the full credit with the box ticked, in the audit log', async () => {
    const q = await signed()
    const asked = await make('super_admin', q, -47900)
    expect(asked.status).toBe(409)
    expect(asked.json.error).toBe('This takes the job under the $350 minimum job price. As the owner you can give the full credit anyway.')
    const given = await make('super_admin', q, -47900, { minimumOverride: true })
    expect(given.status).toBe(201)
    expect(given.json.data.totalCents).toBe(-47900)
    const log = await prisma.crmAuditLog.findFirst({ where: { entityId: given.id, entityType: 'ChangeOrder', action: 'discount_override' } })
    expect(log).not.toBeNull()
  })

  test('a saved change order: new lines that take more off are refused, the same lines again are not', async () => {
    const q = await signed()
    const made = await make('office_staff', q, -29700)
    expect(made.status).toBe(201)
    const more = await send('office_staff', 'PATCH', `/api/change-orders/${made.id}`, { baseVersion: made.json.data.version, lines: [{ id: crypto.randomUUID(), description: 'Remove 12 ft of fence', amountCents: -40000 }] })
    expect(more.status).toBe(409)
    expect(more.json.code).toBe(CUT_BELOW_MINIMUM_CODE)
    const same = await send('office_staff', 'PATCH', `/api/change-orders/${made.id}`, { baseVersion: made.json.data.version, lines: [{ id: crypto.randomUUID(), description: 'Remove 12 ft of fence (corrected words)', amountCents: -29700 }] })
    expect(same.status).toBe(200)
  })

  test('a job signed above the minimum with a cut that stays above it: saved as made', async () => {
    const q = await signed(1200)
    const r = await make('office_staff', q, -47900)
    expect(r.status).toBe(201)
    expect(r.json.data.totalCents).toBe(-47900)
  })
})
