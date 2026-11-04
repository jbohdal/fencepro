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
import fs from 'fs'
import path from 'path'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('a cut under the minimum job price, on the change order route (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: changeOrders } = await import('../src/server/routes/change-orders.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const { CUT_BELOW_MINIMUM_CODE } = await import('../src/server/lib/changeOrderMinimum.js')
  const { changeOrderPublic } = await import('../src/server/routes/changeOrderPublic.js')
  const started = new Date()

  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const quotes: string[] = [], orders: string[] = [], jobs: string[] = [], adjustments: string[] = []
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
    app.use('/p/co', changeOrderPublic)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    // What a signing made: its notices, its signed PDF (record and file).
    const notes = await prisma.notification.findMany({ where: { createdAt: { gte: started }, title: { contains: 'ZZ Test Cut Minimum' } }, select: { id: true } })
    for (const n of notes) await prisma.notification.deleteMany({ where: { id: n.id } })
    for (const q of quotes) {
      const docs = await prisma.signedDocument.findMany({ where: { quoteId: q } }) as any[]
      for (const d of docs) {
        if (d.fileKey) fs.rmSync(path.resolve(process.env.UPLOAD_DIR || 'uploads', d.fileKey), { force: true })
        if (d.portalFileId) {
          const f = await prisma.portalFile.findUnique({ where: { id: d.portalFileId } }) as any
          if (f?.fileKey) fs.rmSync(path.resolve(process.env.UPLOAD_DIR || 'uploads', f.fileKey), { force: true })
          await prisma.signedDocument.deleteMany({ where: { id: d.id } })
          await prisma.portalFile.deleteMany({ where: { id: d.portalFileId } })
        } else await prisma.signedDocument.deleteMany({ where: { id: d.id } })
      }
    }
    for (const id of orders) {
      await prisma.crmAuditLog.deleteMany({ where: { entityId: id, entityType: 'ChangeOrder' } })
      await prisma.changeOrder.deleteMany({ where: { id, accountId } })
    }
    for (const id of adjustments) await prisma.contractAdjustment.deleteMany({ where: { id, accountId } })
    for (const id of jobs) await prisma.savedJob.deleteMany({ where: { id, accountId } })
    for (const id of quotes) await prisma.savedQuote.deleteMany({ where: { id, accountId } })
  })

  const send = async (role: string, method: string, path: string, body: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) as any }
  }
  /** A signed new fence for $647, written directly (no job). */
  async function signed(price = 647, extra: Record<string, unknown> = {}) {
    const id = crypto.randomUUID()
    quotes.push(id)
    await prisma.savedQuote.create({ data: { id, accountId, ownerId, customerName: 'ZZ Test Cut Minimum', fenceStyle: "WV-ND 6'x8' Privacy", runs: [20], sections: 3, corners: 0, ends: 2, finalPrice: price, totalCOGS: 300, gmPct: 0.3, status: 'SOLD', soldAt: new Date(), pullSheet: [], ...extra } as any })
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

  test('a quote signed with dollars off is held to $350 itself (review Nov 3 2026: repair R, $427 with $146 off, cut to $250)', async () => {
    const q = await signed(427, { pricing: { priceAdjustmentCents: -14600 }, work: { type: 'repair' } })
    const r = await make('office_staff', q, -17700)
    expect(r.status).toBe(409)
    expect(r.json.error).toBe('This cannot be saved. It takes the job under the $350 minimum job price: the contract would be $250. Take less off, or ask Jonathan.')
    expect((await make('office_staff', q, -7700)).status).toBe(201)
    expect((await send('office_staff', 'GET', `/api/change-orders/cut-floor?quoteId=${q}`, undefined)).json.data).toEqual({ floorCents: 35000, contractCents: 35000 })
  })

  test('an addition counts once approved or signed; voiding an approved one that leaves the job under the minimum is the owner\'s call', async () => {
    // The review's steps: $840 signed, +$500 saved but not signed; a $7,520 cut was allowed against $1,340.
    const q = await signed(840)
    const add = await make('office_staff', q, 50000)
    expect(add.status).toBe(201)
    expect((await make('office_staff', q, -752000)).status).toBe(409)
    expect((await send('office_staff', 'GET', `/api/change-orders/cut-floor?quoteId=${q}`, undefined)).json.data.contractCents).toBe(84000)
    // Approved (written directly: no job here), it counts: $1,340, and a cut to $350 saves.
    await prisma.changeOrder.update({ where: { id: add.id }, data: { status: 'approved', approvedAt: new Date() } })
    const cut = await make('office_staff', q, -99000)
    expect(cut.status).toBe(201)
    // Voiding the approved +$500 now leaves $840 less the $990 cut: refused for the office ("cannot be voided", never "Take less off").
    const row = await prisma.changeOrder.findUnique({ where: { id: add.id } })
    const voidIt = (role: string, extra: Record<string, unknown> = {}) => send(role, 'PATCH', `/api/change-orders/${add.id}`, { baseVersion: row!.version, status: 'void', ...extra })
    const refused = await voidIt('office_staff')
    expect(refused.status).toBe(409)
    expect(refused.json.code).toBe(CUT_BELOW_MINIMUM_CODE)
    expect(refused.json.error).toBe('This cannot be voided. Voiding this, with the open change orders, takes the job under the $350 minimum job price: the contract would be −$150. Ask Jonathan.')
    expect((await prisma.changeOrder.findUnique({ where: { id: add.id } }))!.status).toBe('approved')
    // The owner too, until the box is ticked; then it goes through and is in the audit log.
    const asked = await voidIt('super_admin')
    expect(asked.status).toBe(409)
    expect(asked.json.error).toBe('Voiding this, with the open change orders, takes the job under the $350 minimum job price: the contract would be −$150. As the owner you can void it anyway.')
    const byOwner = await voidIt('super_admin', { minimumOverride: true })
    expect(byOwner.status).toBe(200)
    expect(byOwner.json.data.status).toBe('void')
    expect(await prisma.crmAuditLog.count({ where: { entityId: add.id, entityType: 'ChangeOrder', action: 'discount_override' } })).toBe(1)
  })

  test('approving or signing a cut the job no longer has room for (review Nov 3 2026: the owner voided the +$500, the office approved the open cut, −$150)', async () => {
    const q = await signed(7860)
    const add = await make('office_staff', q, 50000)
    await prisma.changeOrder.update({ where: { id: add.id }, data: { status: 'approved', approvedAt: new Date() } })
    const cut = await make('office_staff', q, -801000)
    expect(cut.status).toBe(201)
    const addRow = await prisma.changeOrder.findUnique({ where: { id: add.id } })
    expect((await send('super_admin', 'PATCH', `/api/change-orders/${add.id}`, { baseVersion: addRow!.version, status: 'void', minimumOverride: true })).status).toBe(200)
    const cutRow = (await prisma.changeOrder.findUnique({ where: { id: cut.id } }))!
    const approve = (role: string, extra: Record<string, unknown> = {}) => send(role, 'PATCH', `/api/change-orders/${cut.id}`, { baseVersion: cutRow.version, status: 'approved', verbalReason: 'Customer agreed on the phone', ...extra })
    const office = await approve('office_staff')
    expect(office.status).toBe(409)
    expect(office.json.error).toBe('This cannot be approved. It takes the job under the $350 minimum job price: the contract would be −$150. Ask Jonathan.')
    // Signed on the office's phone: refused the same way, nothing repriced.
    const sig = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAAABJRU5ErkJggg=='
    const signedHere = await send('office_staff', 'POST', `/api/change-orders/${cut.id}/sign`, { name: 'ZZ Customer', signature: sig })
    expect(signedHere.status).toBe(409)
    expect(signedHere.json.error).toBe(office.json.error)
    const after = (await prisma.changeOrder.findUnique({ where: { id: cut.id } }))!
    expect([after.status, after.totalCents, after.signedAt]).toEqual(['draft', -801000, null])
    const owner = await approve('super_admin', { minimumOverride: true })
    expect(owner.status).toBe(200)
    expect(owner.json.data.totalCents).toBe(-801000)
  })

  test('two cuts sent at once on one job: one gets through, the other is refused', async () => {
    const q = await signed(647)
    const [a, b] = await Promise.all([make('office_staff', q, -29700), make('office_staff', q, -29700)])
    expect([a.status, b.status].sort()).toEqual([201, 409])
    expect(await prisma.changeOrder.count({ where: { quoteId: q, deletedAt: null } })).toBe(1)
  })

  const SIG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const kept = async (id: string) => ((await prisma.$queryRaw`SELECT "minimumOverride" AS o FROM "ChangeOrder" WHERE id = ${id}`) as Array<{ o: any }>)[0]?.o ?? null
  /** Sent to the customer (its link), then signed on it as the customer. */
  async function signOnLink(id: string) {
    const link = await send('super_admin', 'POST', `/api/change-orders/${id}/link`, {})
    const row = (await prisma.changeOrder.findUnique({ where: { id } }))!
    if (row.status === 'draft') expect((await send('office_staff', 'PATCH', `/api/change-orders/${id}`, { baseVersion: row.version, status: 'sent' })).status).toBe(200)
    const r = await fetch(`${base}/p/co/${link.json.data.token}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'ZZ Signer', signature: SIG }) })
    return { status: r.status, json: await r.json().catch(() => ({})) as any }
  }

  test('the owner\'s full credit sent twice (the phone resends): the first one stands, no error, one override in the audit log', async () => {
    const q = await signed(647)
    const made = await make('super_admin', q, -47900, { minimumOverride: true })
    expect(made.status).toBe(201)
    const again = await send('super_admin', 'POST', '/api/change-orders', { id: made.id, quoteId: q, reason: 'Customer wants less fence', lines: [{ id: crypto.randomUUID(), description: 'Remove 12 ft of fence', amountCents: -47900 }], minimumOverride: true })
    expect(again.status).toBeLessThan(300)
    expect(again.json.data.id).toBe(made.id)
    expect(await prisma.changeOrder.count({ where: { quoteId: q } })).toBe(1)
    expect(await prisma.crmAuditLog.count({ where: { entityId: made.id, entityType: 'ChangeOrder', action: 'discount_override' } })).toBe(1)
  })

  test('the owner\'s full credit is kept on the change order: the customer signs it on their link, covered by it in the audit log', async () => {
    const q = await signed(647)
    const made = await make('super_admin', q, -47900, { minimumOverride: true })
    expect(made.status).toBe(201)
    expect(await kept(made.id)).toMatchObject({ totalCents: -47900, doing: 'cut', userId: ownerId })
    const signedIt = await signOnLink(made.id)
    expect(signedIt.status).toBe(200)
    const row = (await prisma.changeOrder.findUnique({ where: { id: made.id } }))!
    expect([row.status, row.totalCents, row.signedBy]).toEqual(['approved', -47900, 'ZZ Signer'])
    const logs = await prisma.crmAuditLog.findMany({ where: { entityId: made.id, entityType: 'ChangeOrder', action: 'update' } })
    expect(logs.some(l => (l.newValues as any)?.coveredByOwnerOverride?.totalCents === -47900)).toBe(true)
  })

  test('the owner\'s full credit, then its lines changed: the override no longer applies and the customer cannot sign it', async () => {
    const q = await signed(647)
    const made = await make('super_admin', q, -47900, { minimumOverride: true })
    const row = (await prisma.changeOrder.findUnique({ where: { id: made.id } }))!
    // The office changes the amount to one that still takes the job under: refused as a cut would be.
    expect((await send('office_staff', 'PATCH', `/api/change-orders/${made.id}`, { baseVersion: row.version, lines: [{ id: crypto.randomUUID(), description: 'Credit', amountCents: -48000 }] })).status).toBe(409)
    // Less off (allowed as a change), and its kept override is cleared.
    const less = await send('office_staff', 'PATCH', `/api/change-orders/${made.id}`, { baseVersion: row.version, lines: [{ id: crypto.randomUUID(), description: 'Credit', amountCents: -40000 }] })
    expect(less.status).toBe(200)
    expect(await kept(made.id)).toBeNull()
    const signedIt = await signOnLink(made.id)
    expect(signedIt.status).toBe(409)
    expect(signedIt.json.error).toBe('This change order needs another look from our office before it can be signed. Please call us.')
    expect((await prisma.changeOrder.findUnique({ where: { id: made.id } }))!.signedAt).toBeNull()
  })

  test('a login that is not the owner can never set the override', async () => {
    const q = await signed(647)
    const r = await make('office_staff', q, -47900, { minimumOverride: true, minimumOverrideRecord: { totalCents: -47900 } })
    expect(r.status).toBe(409)
    // A cut it may make is not marked either, however it asks.
    const ok = await make('office_staff', q, -29700, { minimumOverride: true })
    expect(ok.status).toBe(201)
    expect(await kept(ok.id)).toBeNull()
  })

  test('the contract adjustments on the payment schedule count too', async () => {
    const q = await signed(647)
    const jobId = crypto.randomUUID()
    jobs.push(jobId)
    await prisma.savedJob.create({ data: { id: jobId, accountId, quoteId: q, customerName: 'ZZ Test Cut Minimum', quotePrice: 647, contractValue: 547 } as any })
    const adj = await prisma.contractAdjustment.create({ data: { accountId, jobId, amountCents: -10000, reason: 'ZZ test' } })
    adjustments.push(adj.id)
    expect((await send('office_staff', 'GET', `/api/change-orders/cut-floor?quoteId=${q}`, undefined)).json.data.contractCents).toBe(54700)
    expect((await make('office_staff', q, -29700)).status).toBe(409)
    expect((await make('office_staff', q, -19700)).status).toBe(201)
  })

  test('a job signed above the minimum with a cut that stays above it: saved as made', async () => {
    const q = await signed(1200)
    const r = await make('office_staff', q, -47900)
    expect(r.status).toBe(201)
    expect(r.json.data.totalCents).toBe(-47900)
  })
})
