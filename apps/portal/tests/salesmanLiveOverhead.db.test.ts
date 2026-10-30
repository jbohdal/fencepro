/**
 * The Salesman prices at the owner's overhead (Oct 30 2026). A reviewer found
 * Christa's quote for a vinyl yard at $3,382 where the owner's builder and the
 * website said $3,822: live overhead (Settings → Pricing, from the budget) was
 * worked out on each phone from the jobs it holds, and a Salesman's phone
 * holds only her own, so hers fell back to the typed 30% while the owner's was
 * the live 36.9%; the server saved her quote without a word.
 *
 * Now live overhead is worked out on the server from the budget and every job
 * (lib/liveOverhead.ts) and handed to every phone with Settings. Here, on a
 * throwaway company on the dev database (DEV_DB=1; refuses any other), with
 * the routes as index.ts mounts them:
 *   - Sally (Salesman) holds none of the jobs, yet gets the owner's overhead;
 *   - the quote builder's price on her phone = on the owner's = the server's
 *     (her view, her save) = the website's, with live overhead on and off;
 *   - a save priced at another overhead is refused (409 PRICES_CHANGED); at
 *     the overhead in use it is saved at that price; a saved quote keeps the
 *     Overhead % it was priced at;
 *   - a budget change moves the stamp, so open phones reprice.
 */

import 'dotenv/config'
import crypto from 'crypto'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest'

// The phone's Settings store, as the server handed it to that login (web businessStateStore.ts).
const phone = vi.hoisted(() => ({ config: {} as any, overheadNow: null as any }))
vi.mock('../../web/src/businessStateStore', () => ({
  getBusinessField: (k: string) => (k === 'config' ? phone.config : {}),
  setBusinessField: () => {},
  getOverheadNow: () => phone.overheadNow,
}))
;(globalThis as any).window ??= { location: { hostname: 'test', protocol: 'http:', origin: 'http://test' }, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true }

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('the Salesman prices at the owner\'s overhead (dev database)', { timeout: 120_000 }, async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { salesScoped } = await import('../src/server/lib/salesScope.js')
  const { pricingModule } = await import('../src/server/lib/estimates.js')
  const { dataFor, quoteViewFor } = await import('../src/server/lib/quotePricing.js')
  const { forgetOverheadNow } = await import('../src/server/lib/liveOverhead.js')
  const { resolveSecret } = await import('../src/server/lib/secrets.js')
  const { DEFAULT_CONFIG } = await import('../../web/src/configDefaults')
  await import('../../web/src/liveOverhead')
  const { getConfig, overheadPctOf } = await import('../../web/src/configStore')
  const { priceQuoteJob } = await import('../../web/src/quoteJob')
  const { liveOverheadOf } = await import('../../web/src/liveOverheadMath')
  const m: any = await pricingModule()
  const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

  const tag = `slo-${crypto.randomUUID().slice(0, 8)}`
  const STYLE = "WV-ND 6'x8' Privacy"
  let accountId = '', base = '', owner = '', sally = ''
  let server: ReturnType<express.Express['listen']>
  let config: any
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)

  // A yard drawn on the photo (as the website takes it): a backyard with a walk gate.
  const at = { lat: 29.185118, lng: -82.134209 }
  const ft = (e: number, n: number) => ({ lat: at.lat + (n * 0.3048) / 110_860, lng: at.lng + (e * 0.3048) / 97_330 })
  const drawing = { v: 1, address: '110 SE Watula Ave, Ocala, FL 34471', at, runs: [{ id: 'r1', pts: [ft(-30, 15), ft(-55, 15), ft(-55, 95), ft(55, 95), ft(55, 15), ft(30, 15)], start: 'house', end: 'house', typedFt: [null, null, null, null, null], gates: [null, { type: 'walk', widthFt: 4, startFt: 11 }, null, null, null] }] }

  beforeAll(async () => {
    accountId = (await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })).id
    const user = (firstName: string, role: string) => prisma.crmUser.create({ data: { email: `${tag}-${firstName.toLowerCase()}@example.invalid`, firstName, lastName: tag, role, status: 'active', crmAccountId: accountId, passwordHash: 'x' } as any })
    const sign = (u: { id: string; email: string }, role: string) => jwt.sign({ sub: u.id, email: u.email, role, crmAccountId: accountId }, secret, { expiresIn: '15m' })
    owner = sign(await user('Olive', 'super_admin'), 'super_admin')
    sally = sign(await user('Sally', 'sales_rep'), 'sales_rep')
    // Typed 30%, live overhead on: $36,900 a year over $100,000 installed in the last 12 months = 36.9%.
    config = { fenceStyles: DEFAULT_CONFIG.fenceStyles, pricing: { ...DEFAULT_CONFIG.pricing, overheadPct: 30, liveOverhead: { on: true, basis: 'last12' } } }
    await prisma.businessState.create({ data: { accountId, config, budget: { overhead: [{ id: 'o1', name: 'Office', annual: 36_900 }] } } as any })
    // The dev company's parts and kits, so the yard is priced from real costs.
    const inv = await prisma.inventoryState.findFirst({ where: { NOT: { items: { equals: [] } } }, select: { items: true, kits: true } })
    await prisma.inventoryState.create({ data: { accountId, items: inv?.items ?? [], kits: inv?.kits ?? [], bundles: [], locations: [], stockLevels: [], transactions: [] } as any })
    // The owner's installed job (not Sally's).
    await prisma.savedJob.create({ data: { accountId, customerName: `E2E ${tag}`, status: 'completed', completedDate: yesterday, contractValue: 100_000, quotePrice: 100_000, salesRep: `Olive ${tag}` } })
    forgetOverheadNow()
    const app = express(); app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-jobs', salesScoped('jobs'))
    app.use('/api/saved-quotes', salesScoped('quotes'))
    app.use('/api/saved-jobs', (await import('../src/server/routes/saved-jobs.js')).default)
    app.use('/api/saved-quotes', (await import('../src/server/routes/saved-quotes.js')).default)
    app.use('/api/quote-pricing', (await import('../src/server/routes/quote-pricing.js')).default)
    app.use('/api/business-state', (await import('../src/server/routes/business-state.js')).default)
    app.use('/api/inventory-state', (await import('../src/server/routes/inventory.js')).default)
    app.use('/api/tier-sets', (await import('../src/server/routes/tier-sets.js')).default)
    server = app.listen(0); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    const quoteIds = (await prisma.savedQuote.findMany({ where: { accountId }, select: { id: true } })).map(q => q.id)
    const users = (await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true } })).map(x => x.id)
    await prisma.crmAuditLog.deleteMany({ where: { OR: [{ entityId: { in: quoteIds } }, { userId: { in: users } }] } }).catch(() => {})
    await prisma.jobQuotedCost.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.savedJob.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.savedQuote.deleteMany({ where: { accountId } }).catch(() => {})
    for (const k of ['proposalTierSet', 'inventoryState', 'businessState', 'accountKeyValue']) await (prisma as any)[k].deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { crmAccountId: accountId } }).catch(() => {})
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch((e: unknown) => console.error('[live overhead test] cleanup:', e))
    forgetOverheadNow()
  })

  const call = async (method: string, p: string, token: string, body?: unknown) => {
    const r = await fetch(`${base}${p}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: r.status, json: await r.json().catch(() => ({})) as any }
  }
  /** What the quote builder on this login's phone prices the request at (configStore getConfig + overheadPctOf, quoteJob.ts). */
  async function builderPrice(token: string, req: any): Promise<{ price: number; overhead: number; part: string }> {
    const b = await call('GET', '/api/business-state', token)
    expect(b.status).toBe(200)
    phone.config = b.json.data.config
    phone.overheadNow = b.json.overheadNow ?? null
    const cfg = getConfig()
    const overhead = overheadPctOf(cfg)
    m.quoteJobFor(await dataFor(accountId), req) // the parts and kits as the phone holds them (inventory store)
    return { price: priceQuoteJob(cfg, req, overhead).totals.price, overhead, part: b.json.pricingPart }
  }
  const websiteQuote = async () => m.widgetQuoteFor(await dataFor(accountId), m.toYardLayout(drawing), STYLE)
  const stamp = async (token: string) => (await call('GET', '/api/quote-pricing/stamp', token)).json.data.stamp as string

  test('the cause: Sally\'s phone holds none of the jobs, so live overhead from her jobs was not available (typed 30%)', async () => {
    const own = await call('GET', '/api/saved-jobs', owner)
    const hers = await call('GET', '/api/saved-jobs', sally)
    expect(own.json.data.length).toBe(1)
    expect(hers.json.data.length).toBe(0)
    const budget = (await prisma.businessState.findUnique({ where: { accountId } }))!.budget
    expect(liveOverheadOf(budget, own.json.data, 'last12')!.pct).toBe(36.9)
    expect(liveOverheadOf(budget, hers.json.data, 'last12')).toBeNull()
  })

  test('live overhead on: Sally\'s builder, the owner\'s, the server and the website give one price, at 36.9%', async () => {
    const web = await websiteQuote()
    const o = await builderPrice(owner, web.req)
    const s = await builderPrice(sally, web.req)
    expect(o.overhead).toBe(36.9)
    expect(s.overhead).toBe(36.9)
    expect(s.part).toBe(o.part)
    expect(s.price).toBe(o.price)
    expect(web.price).toBe(o.price)
    expect(m.quoteJobFor(await dataFor(accountId), web.req).totals.price).toBe(o.price)
    // The server's view of the quote (as an Installer's phone gets it) says the same.
    expect((await quoteViewFor(accountId, web.req)).price).toBe(o.price)
    // And it is the higher price, not the 30% one (the bug).
    const at30 = priceQuoteJob(m.estimateConfig({ ...config, pricing: { ...config.pricing, liveOverhead: { on: false } } }), web.req, 30).totals.price
    expect(o.price).toBeGreaterThan(at30)
  })

  test('Sally saves it: priced at 30% it is refused (409, nothing saved); at the overhead in use it is saved at the owner\'s price, and keeps it', async () => {
    const web = await websiteQuote()
    const s = await builderPrice(sally, web.req)
    const quote = (overheadPct: number, finalPrice: number, name: string) => ({
      customerName: `E2E ${tag} ${name}`, customerPhone: '3525550158', fenceStyle: STYLE, runs: web.req.runs.map((r: any) => r.ft), sections: 10,
      corners: web.req.corners, ends: web.req.ends, walkGates: web.req.walkGates, materialCost: 1000, laborCost: 500, totalCOGS: 1500,
      finalPrice, gmPct: 0.4, status: 'DRAFT', pricing: { costFactor: 0.5, overheadPct }, pricingStamp: '',
    })
    const low = await call('POST', '/api/saved-quotes', sally, { ...quote(30, s.price - 400, 'low'), pricingStamp: await stamp(sally) })
    expect(low.status, JSON.stringify(low.json)).toBe(409)
    expect(low.json.code).toBe('PRICES_CHANGED')
    expect(await prisma.savedQuote.count({ where: { accountId, customerName: `E2E ${tag} low` } })).toBe(0)
    const ok = await call('POST', '/api/saved-quotes', sally, { ...quote(36.9, s.price, 'ok'), pricingStamp: await stamp(sally) })
    expect(ok.status).toBe(201)
    expect(ok.json.data.finalPrice).toBe(s.price)
    // Saved with its own Overhead %: a later change to it keeps that one, even after live overhead moves.
    await prisma.savedJob.create({ data: { accountId, customerName: `E2E ${tag} 2`, status: 'completed', completedDate: yesterday, contractValue: 23_000, salesRep: `Olive ${tag}` } })
    forgetOverheadNow(accountId)
    const id = ok.json.data.id
    const again = await call('PATCH', `/api/saved-quotes/${id}`, sally, { ...ok.json.data, finalPrice: s.price + 1, pricingStamp: await stamp(sally), version: ok.json.data.version })
    expect([200, 201]).toContain(again.status)
    expect((await prisma.savedQuote.findUnique({ where: { id } }))!.finalPrice).toBe(s.price + 1)
    await prisma.savedJob.deleteMany({ where: { accountId, customerName: `E2E ${tag} 2` } })
    forgetOverheadNow(accountId)
  })

  test('a budget change moves the stamp (open phones reprice before saving)', async () => {
    const before = await stamp(owner)
    const b = await call('GET', '/api/business-state', owner)
    const r = await call('PATCH', '/api/business-state', owner, { budget: { overhead: [{ id: 'o1', name: 'Office', annual: 40_000 }] }, baseVersion: b.json.data.version })
    expect(r.status).toBe(200)
    const after = await stamp(owner)
    expect(after).not.toBe(before)
    const web = await websiteQuote()
    const o = await builderPrice(owner, web.req), s = await builderPrice(sally, web.req)
    expect(o.overhead).toBe(40)
    expect(s.overhead).toBe(40)
    expect(s.price).toBe(o.price)
    expect(web.price).toBe(o.price)
  })

  test('live overhead off: everyone at the typed 30%, one price', async () => {
    const b = await call('GET', '/api/business-state', owner)
    const off = { ...b.json.data.config, pricing: { ...b.json.data.config.pricing, liveOverhead: { on: false, basis: 'last12' } } }
    const r = await call('PATCH', '/api/business-state', owner, { config: off, baseVersion: b.json.data.version })
    expect(r.status).toBe(200)
    const web = await websiteQuote()
    const o = await builderPrice(owner, web.req), s = await builderPrice(sally, web.req)
    expect(o.overhead).toBe(30)
    expect(s.overhead).toBe(30)
    expect(s.price).toBe(o.price)
    expect(web.price).toBe(o.price)
    expect(m.quoteJobFor(await dataFor(accountId), web.req).totals.price).toBe(o.price)
  })
})
