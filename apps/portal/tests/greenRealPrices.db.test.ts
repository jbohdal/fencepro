/**
 * Real green prices and the "From Black" follow rule, against the dev database
 * (DEV_DB=1 and ezbiz_dev only), on a throwaway company copied from the dev
 * company (its Settings, Inventory with the green parts priced from Black,
 * Vendors, and its 06-251707 with the three plain bolts in Needs a match):
 *
 *   - the plain bolts priced on 06-251707 only (applyLineOnce): Green bolt
 *     prices, dated the document, price history; nothing remembered for later
 *     documents; 06-251707 leaves Needs a match; again → refused, unchanged;
 *   - the 2023 file prices (applyFilePrices): dated Jul 13 2023, history with
 *     the document's number; again → unchanged;
 *   - Black's price changed by a typed Inventory save (the real route), by
 *     the server start, and by a vendor document's OK: the green parts still
 *     from Black follow; the ones with their own price do not;
 *   - Undo of 06-251707 puts the bolts back to following Black.
 *
 * Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
const norm = (s: string) => String(s ?? '').toLowerCase().replace(/\s+/g, '')

describe.skipIf(!process.env.DEV_DB || !onDev)('green prices from documents, and From Black follows Black (dev database)', () => {
  let prisma: any
  let lib: typeof import('../src/server/lib/vendorInvoices.js')
  let server: Server
  let base = ''
  let accountId = ''
  let ownerToken = ''
  let ownerId = ''
  let invoiceId = ''
  let ready = false
  const tag = `green-${Date.now().toString(36)}`
  const actor = { id: null as string | null, name: 'Test owner' }

  const items = async () => (await prisma.inventoryState.findUnique({ where: { accountId } })).items as any[]
  const named = (list: any[], name: string) => list.find(i => norm(i.name) === norm(name))
  const centsOf = (i: any) => Math.round(Number(i?.unitCost) * 100)

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    lib = await import('../src/server/lib/vendorInvoices.js')
    const { GREEN_KEY } = await import('../src/server/lib/greenChainLink.js')
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    // The dev company that has Green and 06-251707.
    const src = await prisma.vendorInvoice.findFirst({ where: { invoiceKey: { contains: '251707' }, ordered: true, status: { in: ['needs_match', 'applied'] } }, include: { lines: true } })
    if (!src) return
    const srcAccount = src.accountId
    const b = await prisma.businessState.findUnique({ where: { accountId: srcAccount } })
    const inv = await prisma.inventoryState.findUnique({ where: { accountId: srcAccount } })
    const vs = await prisma.vendorState.findUnique({ where: { accountId: srcAccount } })
    const made = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId: srcAccount, key: GREEN_KEY } } })
    if (!made || !(inv.items as any[]).some(i => i?.priceFrom)) return
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    const u = await prisma.crmUser.create({ data: { email: `${tag}-owner@example.test`, firstName: 'Test', lastName: 'owner', role: 'super_admin', status: 'active', crmAccountId: accountId, mustChangePassword: false } })
    ownerId = u.id
    actor.id = u.id
    ownerToken = jwt.sign({ sub: u.id, email: u.email, role: 'super_admin', firstName: 'Test', lastName: 'owner', crmAccountId: accountId }, resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me'), { expiresIn: '30m' })
    await prisma.businessState.create({ data: { accountId, config: b.config } })
    const { id: _i, accountId: _a, createdAt: _c, updatedAt: _u, version: _v, ...rest } = inv
    await prisma.inventoryState.create({ data: { ...rest, accountId } })
    await prisma.vendorState.create({ data: { accountId, vendors: vs.vendors, bills: [], payments: [] } })
    await prisma.accountKeyValue.create({ data: { accountId, key: GREEN_KEY, value: made.value } })
    // 06-251707 as it is on dev: ordered, its three plain bolts waiting in Needs a match.
    const { id: _si, accountId: _sa, createdAt: _sc, updatedAt: _su, lines, ...head } = src
    const copy = await prisma.vendorInvoice.create({ data: { ...head, accountId, batchId: `${tag}-batch`, billId: null } })
    invoiceId = copy.id
    for (const l of lines) {
      const { id: _li, invoiceId: _lv, createdAt: _lc, updatedAt: _lu, ...lr } = l
      await prisma.vendorInvoiceLine.create({ data: { ...lr, invoiceId } })
    }
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/inventory-state', (await import('../src/server/routes/inventory.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    ready = true
  }, 60_000)

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    await prisma.vendorInvoice.deleteMany({ where: { accountId } })
    for (const m of ['priceHistory', 'vendorItemLink', 'accountKeyValue', 'businessState', 'inventoryState', 'vendorState']) {
      await prisma[m].deleteMany({ where: { accountId } }).catch((e: unknown) => console.error(`[green prices test] ${m} cleanup:`, e))
    }
    await prisma.crmAuditLog.deleteMany({ where: { userId: ownerId } }).catch(() => {})
    await prisma.crmUser.deleteMany({ where: { id: ownerId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  }, 60_000)

  const BOLTS: Array<[string, string, number]> = [
    ['BOLT/NUT 5/16x1-1/4in', 'Green, Bolt, 5/16 x 1-1/4" w/ Nut', 18],
    ['BOLT/NUT 3/8x2in', 'Green, Bolt, 3/8" x 2" w/ Nut', 40],
    ['BOLT/NUT 3/8x3in', 'Green, Bolt, 3/8" x 3" w/ Nut', 33],
  ]

  test('the dev copy has Green, its parts priced from Black and 06-251707 (refreshed from live after Oct 27)', () => {
    expect(ready).toBe(true)
  })

  test('the plain bolts on 06-251707 are the Green bolt prices there only; it leaves Needs a match', async () => {
    if (!ready) return
    const before = await items()
    const lines = await prisma.vendorInvoiceLine.findMany({ where: { invoiceId } })
    for (const [desc, part, cents] of BOLTS) {
      const line = lines.find((l: any) => l.description === desc)
      expect(line.state).toBe('needs_match')
      const r = await lib.applyLineOnce(accountId, line.id, { inventoryItemId: named(before, part).id, why: 'Jonathan: his green job.' }, actor)
      expect([r.changed, r.cents]).toEqual([true, cents])
    }
    const after = await items()
    for (const [, part, cents] of BOLTS) {
      const it = named(after, part)
      expect([centsOf(it), it.priceUpdatedAt, it.priceImported]).toEqual([cents, '2026-10-26', false])
    }
    // Nothing else changed in Inventory.
    const others = after.filter(i => !BOLTS.some(([, p]) => norm(p) === norm(i.name)))
    expect(others).toEqual(before.filter(i => !BOLTS.some(([, p]) => norm(p) === norm(i.name))))
    const inv = await prisma.vendorInvoice.findUnique({ where: { id: invoiceId }, include: { lines: true } })
    expect(inv.status).toBe('applied')
    expect(inv.lines.filter((l: any) => l.state === 'needs_match')).toEqual([])
    const bolt = inv.lines.find((l: any) => l.description === 'BOLT/NUT 3/8x3in')
    expect([bolt.state, bolt.inventoryName, bolt.unitLandedCents]).toEqual(['applied', 'Green, Bolt, 3/8" x 3" w/ Nut', 33])
    expect(bolt.stateNote).toMatch(/^Priced on this document only \(not remembered for later documents\)/)
    // Not remembered: a plain bolt on the next (galvanized) order still waits for a match.
    expect(await prisma.vendorItemLink.count({ where: { accountId } })).toBe(0)
    const hist = await prisma.priceHistory.findMany({ where: { accountId, invoiceId } })
    expect(hist.map((h: any) => [h.day, h.unitLandedCents, h.approved, !!h.lineId]).sort()).toEqual([['2026-10-26', 18, true, true], ['2026-10-26', 33, true, true], ['2026-10-26', 40, true, true]])
    // Again: refused, nothing changes.
    await expect(lib.applyLineOnce(accountId, bolt.id, { inventoryItemId: named(after, 'Green, Bolt, 3/8" x 3" w/ Nut').id, why: 'x' }, actor)).rejects.toThrow(/not waiting for a match/)
    expect(await items()).toEqual(after)
  })

  test('the 2023 file prices go in dated the document, with history; again changes nothing', async () => {
    if (!ready) return
    const before = await items()
    const vs = await prisma.vendorState.findUnique({ where: { accountId } })
    const sps = (vs.vendors as any[]).find(v => /stephens/i.test(v.name))
    const prices = [
      { inventoryItemId: named(before, `Chainlink, Green, Gate, 1-3/8", 4' x 5' (.065)`).id, vendorId: sps.id, vendorName: sps.name, docNumber: '06-120125', day: '2023-07-13', unitCents: 19822, unitExact: 198.2246, printedCents: 17230 },
      { inventoryItemId: named(before, 'Green, Fork, PS, 2-1/2"').id, vendorId: sps.id, vendorName: sps.name, docNumber: '06-120125', day: '2023-07-13', unitCents: 368, unitExact: 3.6815, printedCents: 320 },
    ]
    const r = await lib.applyFilePrices(accountId, prices, actor)
    expect(r.map(x => [x.item, x.changed, x.prevCents, x.cents])).toEqual([
      [`Chainlink, Green, Gate, 1-3/8", 4' x 5' (.065)`, true, 13369, 19822],
      ['Green, Fork, PS, 2-1/2"', true, 198, 368],
    ])
    const after = await items()
    const gate = named(after, `Chainlink, Green, Gate, 1-3/8", 4' x 5' (.065)`)
    expect([centsOf(gate), gate.priceUpdatedAt, gate.priceImported]).toEqual([19822, '2023-07-13', false])
    const hist = await prisma.priceHistory.findMany({ where: { accountId, source: 'vendor_file:06-120125' } })
    expect(hist.map((h: any) => [h.day, h.unitLandedCents, h.prevUnitCents]).sort()).toEqual([['2023-07-13', 19822, 13369], ['2023-07-13', 368, 198]])
    const again = await lib.applyFilePrices(accountId, prices, actor)
    expect(again.every(x => !x.changed)).toBe(true)
    expect(await items()).toEqual(after)
    expect(await prisma.priceHistory.count({ where: { accountId, source: 'vendor_file:06-120125' } })).toBe(2)
  })

  test('a Black price typed in Inventory: the green part still from Black follows on the same save; a priced one does not', async () => {
    if (!ready) return
    const s = await prisma.inventoryState.findUnique({ where: { accountId } })
    const list = (s.items as any[]).map(i => ({ ...i }))
    const bl = named(list, `DS, Pipe, Blk, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`)
    const bb = named(list, 'Black, Bolt, 3/8" x 2" w/ Nut')
    bl.unitCost = 12.34; bl.priceUpdatedAt = '2026-10-28'; bl.priceImported = false
    bb.unitCost = 0.77; bb.priceUpdatedAt = '2026-10-28'; bb.priceImported = false
    const { id: _i, accountId: _a, createdAt: _c, updatedAt: _u, version, ...body } = s
    const r = await fetch(`${base}/api/inventory-state`, { method: 'PUT', headers: { Authorization: `Bearer ${ownerToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, items: list, baseVersion: version }) })
    expect(r.status).toBe(200)
    const after = await items()
    const gl = named(after, `DS, Pipe, Green, Line Post, 1-5/8" 0.055 wall, 4' Chain Link`)
    expect(centsOf(gl)).toBe(1234)
    expect(gl.priceFrom.cents).toBe(1234)
    expect(gl.priceImported).toBe(true)
    // The green 3/8" x 2" bolt has its own price from 06-251707 now: it stays.
    expect(centsOf(named(after, 'Green, Bolt, 3/8" x 2" w/ Nut'))).toBe(40)
  })

  test('the server start: a Black price changed any other way reaches the green part; again nothing', async () => {
    if (!ready) return
    const { ensureGreenFollowsBlack } = await import('../src/server/lib/greenChainLinkFollow.js')
    const s = await prisma.inventoryState.findUnique({ where: { accountId } })
    const list = (s.items as any[]).map(i => (norm(i.name) === norm(`DS, Pipe, Blk, Terminal Post, 2-1/2" 0.055 wall, 4' Chain Link`) ? { ...i, unitCost: 17.5 } : i))
    await prisma.inventoryState.update({ where: { accountId }, data: { items: list } })
    const out = await ensureGreenFollowsBlack(accountId)
    expect(out!.pricesFollowed!.map(f => [f.part, f.wasCents, f.nowCents])).toEqual([[`DS, Pipe, Green, Terminal Post, 2-1/2" 0.055 wall, 4' Chain Link`, 1694, 1750]])
    expect(centsOf(named(await items(), `DS, Pipe, Green, Terminal Post, 2-1/2" 0.055 wall, 4' Chain Link`))).toBe(1750)
    const v = (await prisma.inventoryState.findUnique({ where: { accountId } })).version
    const again = await ensureGreenFollowsBlack(accountId)
    expect(again!.pricesFollowed).toEqual([])
    expect((await prisma.inventoryState.findUnique({ where: { accountId } })).version).toBe(v)
  })

  test('Undo of 06-251707 puts the bolts back to following Black', async () => {
    if (!ready) return
    const r = await lib.undoInvoice(accountId, invoiceId, actor)
    expect(r.restored.map(x => x.name).filter(n => /^Green, Bolt/.test(n)).sort()).toEqual(BOLTS.map(([, p]) => p).sort())
    const after = await items()
    const { borrowedPrice } = await import('../../web/src/priceAge.js')
    // Back to the borrowed price; the 3/8" x 2" one at Black's price as typed above (0.77), by the follow on the undo's save.
    expect(borrowedPrice(named(after, 'Green, Bolt, 3/8" x 3" w/ Nut'))?.cents).toBe(53)
    expect(centsOf(named(after, 'Green, Bolt, 3/8" x 2" w/ Nut'))).toBe(77)
    expect(borrowedPrice(named(after, 'Green, Bolt, 3/8" x 2" w/ Nut'))?.cents).toBe(77)
  })
})
