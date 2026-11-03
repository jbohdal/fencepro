/**
 * A discount below the minimum job price, on the routes (Jonathan, Nov 2 2026): "block it and warn the salesman. Owner can
 * override." Against the dev database (DEV_DB=1; refuses any other), on the company's own Settings, with throwaway quotes
 * removed by id. What each login's save does, a crafted save that skips the screen included. Nothing is sent.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('a discount below the minimum, on the routes (dev database)', { timeout: 60_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { default: quotes } = await import('../src/server/routes/saved-quotes.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { resolveIntakeAccountId } = await import('../src/server/lib/intake.js')
  const { BELOW_MINIMUM_CODE } = await import('../src/server/lib/discountMinimum.js')

  const STYLE = "CL - 4' Galv", OTHER = "CL - 4' Black"
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
  const made: string[] = []
  let accountId = '', ownerId = '', tokens: Record<string, string> = {}, base = '', server: any, minimumDollars = 0

  beforeAll(async () => {
    accountId = (await resolveIntakeAccountId())!
    const owner = (await prisma.crmUser.findFirst({ where: { crmAccountId: accountId, role: 'super_admin' } }))!
    ownerId = owner.id
    const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const mr = (b?.config as any)?.moveRepair
    expect(mr?.minimumAppliesToNew).toBe(true)
    minimumDollars = Math.floor(mr.minimumJobCents / 100)
    for (const role of ['super_admin', 'admin', 'manager', 'office_staff', 'sales_rep']) {
      tokens[role] = jwt.sign({ sub: owner.id, email: owner.email, role, firstName: 'Test', lastName: 'Minimum', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    }
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-quotes', quotes)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    for (const id of made) {
      await prisma.crmAuditLog.deleteMany({ where: { entityId: id, entityType: 'SavedQuote' } })
      await prisma.savedQuote.deleteMany({ where: { id, accountId } })
    }
  })

  const send = async (role: string, method: string, path: string, body: unknown) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Bearer ${tokens[role]}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) as any }
  }
  const options = (own: number, other: number, adj: number) => [
    { label: STYLE, fenceStyle: STYLE, finalPrice: own, perFoot: 10, sections: 2, ...(adj ? { adjustmentCents: adj } : {}) },
    { label: OTHER, fenceStyle: OTHER, finalPrice: other, perFoot: 10, sections: 2, tier: { key: 'better', label: 'Better' }, ...(adj ? { adjustmentCents: adj } : {}) },
  ]
  /** What the quote builder sends: `own` and `other` as the option prices, the discount on each. */
  const body = (own: number, other: number, adj = 0, extra: Record<string, unknown> = {}) => ({
    customerName: 'ZZ Test Minimum', fenceStyle: STYLE, runs: [12], corners: 0, ends: 2, status: 'DRAFT', date: '2026-11-02', hasSalesman: true, finalPrice: own, totalCOGS: 100, gmPct: 0.3,
    pricing: { laborMode: 'subcontractor', ...(adj ? { priceAdjustmentCents: adj } : {}) }, proposal: { version: 1, options: options(own, other, adj), recommended: 0, wholeDollar: true }, ...extra,
  })
  const create = (role: string, b: Record<string, unknown>) => {
    const id = crypto.randomUUID()
    made.push(id)
    return send(role, 'POST', '/api/saved-quotes', { id, ...b }).then(r => ({ ...r, id }))
  }
  /** An old quote already on the books, written directly: nobody saved it through this check. */
  const old = async (own: number, other: number, adj: number, extra: Record<string, unknown> = {}) => {
    const id = crypto.randomUUID()
    made.push(id)
    const { hasSalesman: _h, ...b } = body(own, other, adj)
    await prisma.savedQuote.create({ data: { id, accountId, ownerId, salesRep: 'ZZ', ...b, runs: b.runs, pullSheet: [], ...extra } as any })
    return id
  }
  const row = (id: string) => prisma.savedQuote.findUnique({ where: { id } })

  test('a Salesman: blocked, told why and the minimum, nothing saved', async () => {
    const r = await create('sales_rep', body(297, 500, -10000))
    expect(r.status).toBe(409)
    expect(r.json.code).toBe(BELOW_MINIMUM_CODE)
    expect(r.json.error).toBe(`This cannot be saved. ${STYLE} would be $297, under the $${minimumDollars} minimum job price. Take less off, or ask Jonathan.`)
    expect(await row(r.id)).toBeNull()
  })

  test('another option under it blocks too, by name', async () => {
    const r = await create('sales_rep', body(500, 251, -10000))
    expect(r.status).toBe(409)
    expect(r.json.error).toContain('Better would be $251')
    expect(await row(r.id)).toBeNull()
  })

  test('a discount that stays at or over the minimum saves', async () => {
    const r = await create('sales_rep', body(minimumDollars, 900, -10000))
    expect(r.status).toBe(201)
    expect((await row(r.id))!.finalPrice).toBe(minimumDollars)
  })

  test('no discount: saved as it always was', async () => {
    const r = await create('sales_rep', body(397, 500))
    expect(r.status).toBe(201)
    const again = await send('sales_rep', 'PATCH', `/api/saved-quotes/${r.id}`, { ...body(397, 500), notes: 'called her' })
    expect(again.status).toBe(200)
    expect(again.json.data.finalPrice).toBe(397)
  })

  test('the owner: warned without the box, saved with it, the price as asked, recorded', async () => {
    const warned = await create('super_admin', body(297, 500, -10000))
    expect(warned.status).toBe(409)
    expect(warned.json.error).toContain('As the owner you can save it anyway')
    const r = await create('super_admin', body(297, 500, -10000, { minimumOverride: true }))
    expect(r.status).toBe(201)
    expect((await row(r.id))!.finalPrice).toBe(297)
    const logged = await prisma.crmAuditLog.findMany({ where: { entityId: r.id, action: 'discount_override' } })
    expect(logged).toHaveLength(1)
    expect((logged[0] as any).newValues).toMatchObject({ minimumCents: minimumDollars * 100, prices: [{ name: STYLE, priceCents: 29700 }] })
    // Saved again with nothing changed: nothing to override, nothing recorded twice.
    expect((await send('super_admin', 'PATCH', `/api/saved-quotes/${r.id}`, { ...body(297, 500, -10000), notes: 'ok', minimumOverride: true })).status).toBe(200)
    expect(await prisma.crmAuditLog.count({ where: { entityId: r.id, action: 'discount_override' } })).toBe(1)
    // The quote the owner let through is not stuck for the Salesman: her save of it as it is goes through.
    expect((await send('sales_rep', 'PATCH', `/api/saved-quotes/${r.id}`, { ...body(297, 500, -10000), notes: 'sent him the photos' })).status).toBe(200)
  })

  test('the owner on an update: a saved quote taken under it, with the box', async () => {
    const { id } = await create('sales_rep', body(397, 500))
    const r = await send('super_admin', 'PATCH', `/api/saved-quotes/${id}`, { ...body(297, 500, -10000), minimumOverride: true })
    expect(r.status).toBe(200)
    expect(r.json.data.finalPrice).toBe(297)
    expect(await prisma.crmAuditLog.count({ where: { entityId: id, action: 'discount_override' } })).toBe(1)
  })

  test('only the owner: admin, manager and office are blocked, box or no box', async () => {
    for (const role of ['admin', 'manager', 'office_staff', 'sales_rep']) {
      const r = await create(role, body(297, 500, -10000, { minimumOverride: true }))
      expect(r.status).toBe(409)
      expect(r.json.code).toBe(BELOW_MINIMUM_CODE)
      expect(r.json.error).toContain('ask Jonathan')
    }
  })

  test('an old quote nobody re-discounted: every save goes through, its price untouched', async () => {
    const id = await old(300, 320, -5000)
    const before = (await row(id))!
    const note = await send('sales_rep', 'PATCH', `/api/saved-quotes/${id}`, { notes: 'still thinking' })
    expect(note.status).toBe(200)
    const whole = await send('sales_rep', 'PATCH', `/api/saved-quotes/${id}`, { ...body(300, 320, -5000), notes: 'still thinking' })
    expect(whole.status).toBe(200)
    const after = (await row(id))!
    expect(after.finalPrice).toBe(before.finalPrice)
    expect((after.proposal as any).options.map((o: any) => o.finalPrice)).toEqual([300, 320])
  })

  test('an old quote re-discounted lower: blocked, the saved price stays', async () => {
    const id = await old(300, 320, -5000)
    const r = await send('sales_rep', 'PATCH', `/api/saved-quotes/${id}`, body(250, 320, -10000))
    expect(r.status).toBe(409)
    expect(r.json.code).toBe(BELOW_MINIMUM_CODE)
    expect((await row(id))!.finalPrice).toBe(300)
  })

  test('a crafted save that skips the screen: a low price with no discount on it, on the quote or one option, or typed', async () => {
    const { id } = await create('sales_rep', body(600, 700))
    for (const crafted of [
      { finalPrice: 100 },
      { proposal: { version: 1, options: options(600, 100, 0), recommended: 0 } },
      { finalPrice: 100, pricing: { finalPrice: 100 } },
      { finalPrice: 100, pricing: { priceAdjustmentCents: -50000 } },
      { ...body(100, 700), minimumOverride: true },
    ]) {
      const r = await send('sales_rep', 'PATCH', `/api/saved-quotes/${id}`, crafted)
      expect(r.status).toBe(409)
      expect(r.json.code).toBe(BELOW_MINIMUM_CODE)
    }
    const saved = (await row(id))!
    expect(saved.finalPrice).toBe(600)
    expect((saved.proposal as any).options.map((o: any) => o.finalPrice)).toEqual([600, 700])
  })

  test('a move or repair is held to it whatever Settings say about new fences', async () => {
    const r = await create('sales_rep', { ...body(297, 500, -10000), proposal: { version: 1, options: [{ label: 'Repair', fenceStyle: STYLE, finalPrice: 297, adjustmentCents: -10000 }], recommended: 0 }, work: { type: 'repair' } })
    expect(r.status).toBe(409)
    expect(r.json.error).toContain('Repair would be $297')
  })

  test('a sent quote: a save that does not choose new prices keeps the sent ones; "send it again" under the minimum is blocked', async () => {
    const id = await old(600, 700, 0, { status: 'SENT', shareToken: crypto.randomBytes(12).toString('base64url') })
    const kept = await send('sales_rep', 'PATCH', `/api/saved-quotes/${id}`, body(297, 700, -10000))
    expect(kept.status).toBe(200)
    expect(kept.json.keptSentPrices?.length).toBeGreaterThan(0)
    expect((await row(id))!.finalPrice).toBe(600)
    const resend = await send('sales_rep', 'PATCH', `/api/saved-quotes/${id}`, body(297, 700, -10000, { needsResend: true }))
    expect(resend.status).toBe(409)
    expect(resend.json.code).toBe(BELOW_MINIMUM_CODE)
    expect((await row(id))!.finalPrice).toBe(600)
  })

  test('a signed quote under the minimum: a note saves, nothing is asked of it', async () => {
    const id = await old(250, 320, 0, { status: 'SOLD', soldAt: new Date(), acceptedAt: new Date() })
    const r = await send('sales_rep', 'PATCH', `/api/saved-quotes/${id}`, { notes: 'gate code 1234' })
    expect(r.status).toBe(200)
    expect((await row(id))!.finalPrice).toBe(250)
  })

  test('the bulk import: held for an admin, a quote already there kept as it is; the owner\'s goes through, recorded', async () => {
    const id = crypto.randomUUID()
    const held = await send('admin', 'POST', '/api/saved-quotes/sync', { quotes: [{ id, ...body(297, 500, -10000) }] })
    expect(held.status).toBe(200)
    expect(held.json.data).toMatchObject({ created: 0, underMinimum: 1 })
    expect(await row(id)).toBeNull()
    const was = await old(500, 700, 0)
    const lowered = await send('admin', 'POST', '/api/saved-quotes/sync', { quotes: [{ id: was, ...body(297, 500, -10000) }] })
    expect(lowered.json.data).toMatchObject({ updated: 0, underMinimum: 1 })
    expect((await row(was))!.finalPrice).toBe(500)
    const before = await prisma.crmAuditLog.count({ where: { entityId: was, action: 'discount_override' } })
    const owners = await send('super_admin', 'POST', '/api/saved-quotes/sync', { quotes: [{ id: was, ...body(297, 500, -10000) }] })
    expect(owners.json.data).toMatchObject({ updated: 1, underMinimum: 0 })
    expect(await prisma.crmAuditLog.count({ where: { entityId: was, action: 'discount_override' } })).toBe(before + 1)
  })
})
