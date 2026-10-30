/**
 * Broken list #58: the server refuses a quote saved at prices it no longer has
 * (dev database, DEV_DB=1; refuses any other).
 *
 * - The parts each read hands out (Settings, Inventory, Good Better Best) make
 *   the stamp GET /api/quote-pricing/stamp answers.
 * - A new quote on the current stamp: saved. After the owner raises a price,
 *   the old stamp: 409 PRICES_CHANGED, nothing saved. A stock count change
 *   does not change the stamp.
 * - A fence switched off for quoting: 409 STYLE_NOT_QUOTABLE, nothing saved;
 *   a draft that already had it keeps working.
 * - An older phone (no stamp): saved, and the audit log records it with
 *   today's price.
 * - A draft: a note on an old stamp is saved; a price change on an old stamp
 *   is refused. Sent and signed quotes are never refused for this.
 *
 * Its own throwaway company; removes everything it made.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('quotes saved at old prices are refused (dev database)', () => {
  let prisma: any
  let server: ReturnType<express.Express['listen']>
  let base = '', token = '', accountId = ''
  const tag = `price58-${Date.now().toString(36)}`
  const ON = "WV-ND 6'x8' Privacy", OFF = "TV-ND 6'x8' Privacy"
  let config: any

  const call = (method: string, path: string, body?: unknown) =>
    fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const stampNow = async () => (await call('GET', '/api/quote-pricing/stamp')).json.data.stamp as string
  const quote = (extra: Record<string, unknown> = {}) => ({
    customerName: `E2E ${tag}`, customerPhone: '3525550158', fenceStyle: ON, runs: [80], sections: 10, corners: 0, ends: 2, walkGates: 1,
    materialCost: 2000, laborCost: 900, totalCOGS: 2900, finalPrice: 5350, gmPct: 0.45, status: 'DRAFT', ...extra,
  })
  /** The owner changes a price in Settings > Price List (as a save does: the record's version goes up). */
  async function raisePrice(style: string, perFoot: number) {
    config = { ...config, fenceStyles: config.fenceStyles.map((s: any) => (s.name === style ? { ...s, pricePerFoot: perFoot } : s)) }
    await prisma.businessState.update({ where: { accountId }, data: { config, version: { increment: 1 } } })
  }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const { DEFAULT_CONFIG } = await import('../../web/src/configDefaults')
    const user = await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null } }, orderBy: { createdAt: 'asc' } })
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    // Tan switched off for quoting (the owner removed its prices, or switched it off).
    config = { fenceStyles: DEFAULT_CONFIG.fenceStyles.map((s: any) => (s.name === OFF ? { ...s, quotable: false } : s)), pricing: { overheadPct: 20 } }
    expect(config.fenceStyles.some((s: any) => s.name === ON)).toBe(true)
    expect(config.fenceStyles.some((s: any) => s.name === OFF)).toBe(true)
    await prisma.businessState.create({ data: { accountId, config } })
    await prisma.inventoryState.create({ data: { accountId, items: [{ id: 'p1', name: 'E2E Post', unitCost: 13.5, qtyOnHand: 4, category: 'Vinyl' }], bundles: [], locations: [], stockLevels: [], transactions: [] } })
    token = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', firstName: 'Test', lastName: 'Prices', crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/saved-quotes', (await import('../src/server/routes/saved-quotes.js')).default)
    app.use('/api/quote-pricing', (await import('../src/server/routes/quote-pricing.js')).default)
    app.use('/api/business-state', (await import('../src/server/routes/business-state.js')).default)
    app.use('/api/inventory-state', (await import('../src/server/routes/inventory.js')).default)
    app.use('/api/tier-sets', (await import('../src/server/routes/tier-sets.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId || !prisma) return
    const quoteIds = (await prisma.savedQuote.findMany({ where: { accountId }, select: { id: true } })).map((q: any) => q.id)
    const tierIds = (await prisma.proposalTierSet.findMany({ where: { accountId }, select: { id: true } })).map((r: any) => r.id)
    await prisma.crmAuditLog.deleteMany({ where: { entityId: { in: [...quoteIds, ...tierIds] } } }).catch(() => {})
    await prisma.jobQuotedCost.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.savedJob.deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.savedQuote.deleteMany({ where: { accountId } }).catch(() => {})
    for (const m of ['proposalTierSet', 'inventoryState', 'businessState', 'accountKeyValue']) await prisma[m].deleteMany({ where: { accountId } }).catch(() => {})
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch((e: unknown) => console.error('[price check test] account cleanup:', e))
  })

  test('each read hands out its part, and together they are the stamp', async () => {
    // The tier sets first: the first read makes the company's starting sets.
    const tiers = await call('GET', '/api/tier-sets')
    const [b, inv, s] = await Promise.all([call('GET', '/api/business-state'), call('GET', '/api/inventory-state'), call('GET', '/api/quote-pricing/stamp')])
    expect([b.status, inv.status, tiers.status, s.status]).toEqual([200, 200, 200, 200])
    expect(typeof b.json.pricingPart).toBe('string')
    expect(`${b.json.pricingPart}.${inv.json.pricingPart}.${tiers.json.pricingPart}`).toBe(s.json.data.stamp)
  })

  test('a new quote on the current stamp is saved; after the owner raises a price, the old stamp is refused and nothing is saved', async () => {
    const before = await stampNow()
    const ok = await call('POST', '/api/saved-quotes', { ...quote(), pricingStamp: before })
    expect(ok.status).toBe(201)
    await raisePrice(ON, 70)
    const after = await stampNow()
    expect(after).not.toBe(before)
    // Settings changed, Inventory and tiers did not.
    expect(after.split('.').slice(1)).toEqual(before.split('.').slice(1))
    const r = await call('POST', '/api/saved-quotes', { ...quote({ customerName: `E2E ${tag} stale` }), pricingStamp: before })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('PRICES_CHANGED')
    expect(r.json.error).toBe('Prices changed since this quote was priced. Open it to see the new price, then save it again.')
    expect(r.json.stamp).toBe(after)
    expect(await prisma.savedQuote.count({ where: { accountId, customerName: `E2E ${tag} stale` } })).toBe(0)
    // Repriced on the new data: saved.
    const again = await call('POST', '/api/saved-quotes', { ...quote({ customerName: `E2E ${tag} stale`, finalPrice: 5662 }), pricingStamp: after })
    expect(again.status).toBe(201)
    expect(again.json.data.finalPrice).toBe(5662)
  })

  test('a stock count or a price confirmed (same price) does not change the stamp; a part\'s cost does', async () => {
    const s0 = await stampNow()
    const inv = await prisma.inventoryState.findUnique({ where: { accountId } })
    await prisma.inventoryState.update({ where: { accountId }, data: { items: [{ ...(inv.items as any[])[0], qtyOnHand: 40, priceUpdatedAt: '2026-10-29' }], version: { increment: 1 } } })
    expect(await stampNow()).toBe(s0)
    await prisma.inventoryState.update({ where: { accountId }, data: { items: [{ ...(inv.items as any[])[0], unitCost: 14.25 }], version: { increment: 1 } } })
    const s1 = await stampNow()
    expect(s1).not.toBe(s0)
    expect(s1.split('.')[1]).not.toBe(s0.split('.')[1])
  })

  test('a fence not available for quoting is refused, even on the current stamp; nothing is saved', async () => {
    const r = await call('POST', '/api/saved-quotes', { ...quote({ fenceStyle: OFF, customerName: `E2E ${tag} off` }), pricingStamp: await stampNow() })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('STYLE_NOT_QUOTABLE')
    expect(r.json.error).toMatch(/is not available for quoting now\. Pick another fence, then save again\.$/)
    expect(await prisma.savedQuote.count({ where: { accountId, customerName: `E2E ${tag} off` } })).toBe(0)
    // As a proposal option too.
    const opt = await call('POST', '/api/saved-quotes', { ...quote({ customerName: `E2E ${tag} off` }), proposal: { version: 1, options: [{ fenceStyle: ON, finalPrice: 5350 }, { fenceStyle: OFF, finalPrice: 6000 }] }, pricingStamp: await stampNow() })
    expect(opt.status).toBe(409)
    expect(opt.json.code).toBe('STYLE_NOT_QUOTABLE')
  })

  test('an older phone (no stamp): saved, and the audit log records it with today\'s price', async () => {
    const r = await call('POST', '/api/saved-quotes', quote({ customerName: `E2E ${tag} old phone` }))
    expect(r.status).toBe(201)
    const row = await prisma.crmAuditLog.findFirst({ where: { entityId: r.json.data.id, action: 'price_check' } })
    expect(row).toBeTruthy()
    expect(row.newValues.savedCents).toBe(535000)
    expect(row.newValues.check).toBe('saved without a price stamp (older app)')
    expect(typeof row.newValues.differs).toBe('boolean')
    // A stamped save is not recorded so.
    const stamped = await call('POST', '/api/saved-quotes', { ...quote({ customerName: `E2E ${tag} stamped` }), pricingStamp: await stampNow() })
    expect(await prisma.crmAuditLog.count({ where: { entityId: stamped.json.data.id, action: 'price_check' } })).toBe(0)
  })

  test('a draft: a note on an old stamp is saved; a new price on an old stamp is refused, on the current one saved', async () => {
    const old = await stampNow()
    const made = await call('POST', '/api/saved-quotes', { ...quote({ customerName: `E2E ${tag} draft` }), pricingStamp: old })
    expect(made.status).toBe(201)
    await raisePrice(ON, 75)
    const id = made.json.data.id
    const note = await call('PATCH', `/api/saved-quotes/${id}`, { ...quote({ customerName: `E2E ${tag} draft` }), notes: 'gate code 1234', pricingStamp: old })
    expect(note.status).toBe(200)
    expect(note.json.data.notes).toBe('gate code 1234')
    const stale = await call('PATCH', `/api/saved-quotes/${id}`, { ...quote({ customerName: `E2E ${tag} draft`, runs: [100], finalPrice: 6700 }), pricingStamp: old })
    expect(stale.status).toBe(409)
    expect(stale.json.code).toBe('PRICES_CHANGED')
    expect((await prisma.savedQuote.findUnique({ where: { id } })).finalPrice).toBe(5350)
    const fresh = await call('PATCH', `/api/saved-quotes/${id}`, { ...quote({ customerName: `E2E ${tag} draft`, runs: [100], finalPrice: 7020 }), pricingStamp: await stampNow() })
    expect(fresh.status).toBe(200)
    expect(fresh.json.data.finalPrice).toBe(7020)
  })

  test('a draft that already had a fence now off for quoting keeps working (the quote builder keeps it)', async () => {
    const q = await prisma.savedQuote.create({ data: { accountId, ...quote({ fenceStyle: OFF, customerName: `E2E ${tag} kept` }), runs: [80], pullSheet: [] } })
    const r = await call('PATCH', `/api/saved-quotes/${q.id}`, { ...quote({ fenceStyle: OFF, customerName: `E2E ${tag} kept`, runs: [90], finalPrice: 6000 }), pricingStamp: await stampNow() })
    expect(r.status).toBe(200)
  })

  test('sent and signed quotes are never refused for this: their saved prices stand', async () => {
    const old = await stampNow()
    await raisePrice(ON, 80)
    const sent = await prisma.savedQuote.create({ data: { accountId, ...quote({ status: 'SENT', customerName: `E2E ${tag} sent` }), runs: [80], pullSheet: [] } })
    const s = await call('PATCH', `/api/saved-quotes/${sent.id}`, { ...quote({ status: 'SENT', customerName: `E2E ${tag} sent`, finalPrice: 5900 }), notes: 'called back', pricingStamp: old })
    expect(s.status).toBe(200)
    expect(s.json.code).toBeUndefined()
    const sold = await prisma.savedQuote.create({ data: { accountId, ...quote({ status: 'SOLD', customerName: `E2E ${tag} sold` }), runs: [80], pullSheet: [], soldAt: new Date() } })
    const note = await call('PATCH', `/api/saved-quotes/${sold.id}`, { notes: 'permit applied', pricingStamp: old })
    expect(note.status).toBe(200)
    // A price change on a signed quote is still the lock's 409, not a reprice.
    const price = await call('PATCH', `/api/saved-quotes/${sold.id}`, { finalPrice: 5900, pricingStamp: old })
    expect(price.status).toBe(409)
    expect(price.json.code).toBe('QUOTE_LOCKED')
    expect((await prisma.savedQuote.findUnique({ where: { id: sold.id } })).finalPrice).toBe(5350)
  })
  test('a Sent (or Lost) quote is never moved back to Draft by a plain save; Draft picked on it (backToDraft) does', async () => {
    for (const was of ['SENT', 'LOST']) {
      const q = await prisma.savedQuote.create({ data: { accountId, ...quote({ status: was, customerName: `E2E ${tag} ${was} draft` }), runs: [80], pullSheet: [], shareToken: was === 'SENT' ? `t-${tag}-${was}` : null } })
      // The phone's older copy (opened before Copy link made it Sent) saves with Draft selected.
      const plain = await call('PATCH', `/api/saved-quotes/${q.id}`, { ...quote({ status: 'DRAFT', customerName: `E2E ${tag} ${was} draft` }), notes: 'from an old copy', pricingStamp: await stampNow() })
      expect(plain.status).toBe(200)
      expect(plain.json.data.status).toBe(was)
      expect(plain.json.data.notes).toBe('from an old copy')
      // Draft picked on it on purpose.
      const back = await call('PATCH', `/api/saved-quotes/${q.id}`, { status: 'DRAFT', backToDraft: true })
      expect(back.status).toBe(200)
      expect(back.json.data.status).toBe('DRAFT')
    }
  })
  test('paid per section while Settings pays per foot, no rate typed: refused (owner and a Salesman\'s server pricing alike); with a rate typed: saved', async () => {
    // Settings: a sub at $5 per foot (Jonathan's since Oct 30 2026).
    config = { ...config, pricing: { ...config.pricing, laborMode: 'subcontractor', subUnit: 'foot', subRateDefault: 5, subRateByCategory: { Vinyl: 5 } } }
    await prisma.businessState.update({ where: { accountId }, data: { config, version: { increment: 1 } } })
    const name = `E2E ${tag} per section`
    const sub = { laborMode: 'subcontractor', subUnit: 'section', subUnitPicked: true }
    const r = await call('POST', '/api/saved-quotes', { ...quote({ customerName: name, pricing: sub }), pricingStamp: await stampNow() })
    expect(r.status).toBe(409)
    expect(r.json.code).toBe('SUB_RATE_MISSING')
    expect(r.json.error).toBe('Type the rate per section: Settings has $5 per foot.')
    expect(await prisma.savedQuote.count({ where: { accountId, customerName: name } })).toBe(0)
    // The server's own check, as a Salesman's save priced here (priceRequest) reaches it.
    const { checkQuotePrices } = await import('../src/server/lib/quotePriceCheck.js')
    const viaPhone = await checkQuotePrices(accountId, { priceRequest: {} }, { ...quote({ pricing: sub }) }, null)
    expect(viaPhone).toMatchObject({ kind: 'refuse', code: 'SUB_RATE_MISSING' })
    // A rate typed for the section: saved. Settings' unit, no rate: saved.
    const typed = await call('POST', '/api/saved-quotes', { ...quote({ customerName: name, pricing: { ...sub, subRate: 24 } }), pricingStamp: await stampNow() })
    expect(typed.status).toBe(201)
    const foot = await call('POST', '/api/saved-quotes', { ...quote({ customerName: `${name} foot`, pricing: { laborMode: 'subcontractor', subUnit: 'foot' } }), pricingStamp: await stampNow() })
    expect(foot.status).toBe(201)
    // An old draft saved per section with no pick follows Settings: not refused.
    expect(await checkQuotePrices(accountId, {}, quote({ pricing: { laborMode: 'subcontractor', subUnit: 'section' } }), null)).not.toMatchObject({ code: 'SUB_RATE_MISSING' })
  })
})
