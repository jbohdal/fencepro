/**
 * Settings → Price List → Vinyl Colors on the dev database (DEV_DB=1 and
 * ezbiz_dev only), through /api/vinyl-colors, in a throwaway company removed
 * afterwards. Writes only inside beforeAll, test and afterAll.
 *
 * - Add Chai Gray: one transaction makes the color, its two fences, kits and
 *   catalog items, and a price history row (source color_form, dated today)
 *   per priced item; the role without prices.change is refused.
 * - Edit: a new section cost is a new dated cost; a saved quote on the color
 *   keeps its stored prices to the cent.
 * - Remove: refused while an active quote uses it; archives once that quote
 *   is archived; Bring back restores it. Undo is refused while any quote uses
 *   it (archived too; one in Deleted Records does not count) and after 24 hours.
 * - Undo: Settings, Inventory and kits are exactly as before (deep equal),
 *   the price history rows and the record are gone.
 */

import 'dotenv/config'
import express from 'express'
import jwt from 'jsonwebtoken'
import type { AddressInfo } from 'net'
import type { Server } from 'http'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { estimateConfig } from '../../web/src/estimate'
import { CHAI_GRAY } from './fixtures/chaiGray'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('vinyl colors (dev database)', () => {
  let prisma: any
  let accountId = ''
  let owner = '', salesRep = ''
  let base = ''
  let server: Server
  let quoteId = ''
  const tag = `vinylcolor-${Date.now().toString(36)}`
  const call = (token: string, method: string, p: string, body?: unknown) =>
    fetch(base + p, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
      .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) as any }))
  const snapshot = async () => {
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    const i = await prisma.inventoryState.findUnique({ where: { accountId } })
    return { config: b.config, items: i.items, kits: i.kits }
  }
  const styles = estimateConfig({}).fenceStyles.map(s => { const c: any = { ...s }; delete c.label; delete c.held; delete c.jobLot; return c })
  const items = [
    { id: 'wv-cp-78', name: '*Vinyl, White, Post, Corner, 5" x 5" x 78"', unitCost: 13.5, category: 'Vinyl White' },
    { id: 'other', name: 'Misc, Concrete', unitCost: 6.25, category: 'Misc' },
  ]

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { resolveSecret } = await import('../src/server/lib/secrets.js')
    const user = await prisma.crmUser.findFirst({ where: { crmAccountId: { not: null }, role: 'super_admin' }, orderBy: { createdAt: 'asc' } })
    const account = await prisma.crmAccount.create({ data: { name: `Test ${tag}`, status: 'active' } })
    accountId = account.id
    // No saved choice tree: the app's own is in use, as on a new company.
    await prisma.businessState.create({ data: { accountId, config: { fenceStyles: styles, pricing: {} } } })
    await prisma.inventoryState.create({ data: { accountId, items, bundles: [], locations: [], stockLevels: [], transactions: [], kits: [] } })
    const secret = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
    owner = jwt.sign({ sub: user.id, email: user.email, role: 'super_admin', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    salesRep = jwt.sign({ sub: user.id, email: user.email, role: 'sales_rep', crmAccountId: accountId }, secret, { expiresIn: '10m' })
    const app = express()
    app.use(express.json({ limit: '10mb' }))
    app.use('/api/vinyl-colors', (await import('../src/server/routes/vinyl-colors.js')).default)
    server = app.listen(0)
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    server?.close()
    if (!accountId) return
    await prisma.savedQuote.deleteMany({ where: { accountId } }).catch(() => {})
    for (const m of ['priceHistory', 'inventoryState', 'businessState', 'accountKeyValue']) {
      await prisma[m]?.deleteMany({ where: { accountId } }).catch(() => {})
    }
    await prisma.crmAccount.delete({ where: { id: accountId } }).catch((e: unknown) => console.error('[vinyl colors test] account cleanup:', e))
  })

  test('add, edit, remove, undo', async () => {
    const before = await snapshot()

    // A role that cannot change prices is refused, and nothing changes.
    expect((await call(salesRep, 'POST', '/api/vinyl-colors', { input: CHAI_GRAY })).status).toBe(403)
    expect(await snapshot()).toEqual(before)
    // A form with something missing is refused with the reason, and nothing changes.
    const bad = await call(owner, 'POST', '/api/vinyl-colors', { input: { ...CHAI_GRAY, capCents: null } })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toMatch(/post cap cost/)
    expect(await snapshot()).toEqual(before)

    // ── Add ──
    const add = await call(owner, 'POST', '/api/vinyl-colors', { input: CHAI_GRAY })
    expect(add.status).toBe(201)
    const rec = add.json.data.record
    expect(rec.key).toBe('chai-gray')
    expect(rec.created.styles.map((s: any) => s.name)).toEqual(['vinyl/privacy/6/chai-gray/nd/8', 'vinyl/privacy/6/chai-gray/ds/8'])
    expect(rec.created.kits.length).toBe(2)
    expect(rec.created.items.length).toBe(11)
    expect(Date.parse(rec.undoUntil) - Date.parse(rec.createdAt)).toBe(24 * 3600_000)
    const after = await snapshot()
    expect(after.config.fenceStyles.filter((s: any) => s.choices?.color === 'chai-gray').length).toBe(2)
    expect(after.config.fenceCatalog.materials.find((m: any) => m.key === 'vinyl').dims.find((d: any) => d.key === 'color').options.map((o: any) => o.key)).toEqual(['white', 'tan', 'chai-gray'])
    const section = after.items.find((i: any) => i.name === '*Vinyl, Chai Gray, Section, 6x8')
    expect(section).toMatchObject({ unitCost: 184, madeFor: 'vinyl:color:chai-gray', status: 'active' })
    const history = await prisma.priceHistory.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' } })
    expect(history.length).toBe(6)
    const { businessDay } = await import('../src/server/lib/vinylColors.js')
    expect(history.every((h: any) => h.source === 'color_form' && h.day === businessDay())).toBe(true)
    expect(history.find((h: any) => h.inventoryItemId === section.id)).toMatchObject({ unitLandedCents: 18400, prevUnitCents: null, source: 'color_form' })
    // Same name again: refused.
    expect((await call(owner, 'POST', '/api/vinyl-colors', { input: CHAI_GRAY })).json.error).toMatch(/already a vinyl color called Chai Gray/)

    // ── A saved quote on it keeps its prices through an edit ──
    const q = await prisma.savedQuote.create({ data: {
      accountId, customerName: 'Test vinyl color', fenceStyle: 'vinyl/privacy/6/chai-gray/nd/8', runs: [50, 50], corners: 2, ends: 2, walkGates: 1,
      sections: 14, materialCost: 4123.45, finalPrice: 9876.54, pullSheet: [{ item: '*Vinyl, Chai Gray, Section, 6x8', qty: 15, unitCost: 184, total: 2760 }],
    } })
    quoteId = q.id
    const quoteBefore = await prisma.savedQuote.findUnique({ where: { id: quoteId } })
    const edit = await call(owner, 'PUT', '/api/vinyl-colors/chai-gray', { input: { ...CHAI_GRAY, sections: { '6x8': { ...CHAI_GRAY.sections['6x8'], costCents: 19150 } } } })
    expect(edit.status).toBe(200)
    expect(edit.json.data.priced).toBe(1)
    const h2 = await prisma.priceHistory.findMany({ where: { accountId, inventoryItemId: section.id }, orderBy: { createdAt: 'asc' } })
    expect(h2.map((h: any) => [h.unitLandedCents, h.prevUnitCents])).toEqual([[18400, null], [19150, 18400]])
    expect((await snapshot()).items.find((i: any) => i.id === section.id).unitCost).toBe(191.5)
    const quoteAfter = await prisma.savedQuote.findUnique({ where: { id: quoteId } })
    expect({ ...quoteAfter, updatedAt: null }).toEqual({ ...quoteBefore, updatedAt: null })
    expect(quoteAfter.updatedAt.getTime()).toBe(quoteBefore.updatedAt.getTime())

    // ── Remove: refused while an active quote uses it; Undo refused while any quote does ──
    const r1 = await call(owner, 'POST', '/api/vinyl-colors/chai-gray/remove')
    expect(r1.status).toBe(409)
    expect(r1.json.error).toMatch(/Test vinyl color/)
    expect(r1.json.usedBy[0].id).toBe(quoteId)
    const u1 = await call(owner, 'POST', '/api/vinyl-colors/chai-gray/undo')
    expect(u1.status).toBe(409)
    // The quote archived: Remove archives the color; Bring back restores it.
    await prisma.savedQuote.update({ where: { id: quoteId }, data: { archivedAt: new Date() } })
    const r2 = await call(owner, 'POST', '/api/vinyl-colors/chai-gray/remove')
    expect(r2.status).toBe(200)
    let s = await snapshot()
    expect(s.config.fenceStyles.filter((x: any) => x.choices?.color === 'chai-gray').every((x: any) => x.isActive === false)).toBe(true)
    expect(s.items.filter((i: any) => i.madeFor === 'vinyl:color:chai-gray').every((i: any) => i.status === 'archived')).toBe(true)
    expect((await call(owner, 'POST', '/api/vinyl-colors/chai-gray/undo')).status).toBe(409) // the archived quote still uses it
    expect((await call(owner, 'POST', '/api/vinyl-colors/chai-gray/restore')).status).toBe(200)
    s = await snapshot()
    expect(s.config.fenceStyles.filter((x: any) => x.choices?.color === 'chai-gray').every((x: any) => x.isActive === true)).toBe(true)

    // ── Undo: only within 24 hours ──
    // The quote deleted (in Deleted Records): it no longer holds Undo back.
    await prisma.savedQuote.update({ where: { id: quoteId }, data: { deletedAt: new Date() } })
    const { undoVinylColor } = await import('../src/server/lib/vinylColors.js')
    await expect(undoVinylColor({ accountId, userId: null, name: 'Test' }, 'chai-gray', new Date(Date.now() + 25 * 3600_000))).rejects.toThrow(/Undo was open for 24 hours/)
    const undo = await call(owner, 'POST', '/api/vinyl-colors/chai-gray/undo')
    expect(undo.status).toBe(200)
    expect(undo.json.data.removed.priceHistory).toBe(7)
    const back = await snapshot()
    expect(back).toEqual(before)
    expect('fenceCatalog' in back.config).toBe(false)
    expect(await prisma.priceHistory.count({ where: { accountId } })).toBe(0)
    expect(await prisma.accountKeyValue.count({ where: { accountId, key: { startsWith: 'vinyl-color:' } } })).toBe(0)
    expect((await call(owner, 'GET', '/api/vinyl-colors')).json.data.records).toEqual([])
  })

  test('a fence flagged "cost to review" with a note is cleared when its color is saved with the missing part; other flags stay', async () => {
    const add = await call(owner, 'POST', '/api/vinyl-colors', { input: { ...CHAI_GRAY, name: 'Flag Gray' } })
    expect(add.status).toBe(201)
    const names = ['vinyl/privacy/6/flag-gray/nd/8', 'vinyl/privacy/6/flag-gray/ds/8']
    const BELL = "WV-ND Bell 4'x6'"
    const flag = async () => {
      const b = await prisma.businessState.findUnique({ where: { accountId } })
      const cfg = b.config as any
      cfg.fenceStyles = cfg.fenceStyles.map((s: any) => (names.includes(s.name) || s.name === BELL ? { ...s, needsCostReview: true, costReviewNote: s.name === BELL ? 'Bell section cost' : 'black rivet price needed' } : s))
      await prisma.businessState.update({ where: { accountId }, data: { config: cfg } })
    }
    const flags = async () => ((await snapshot()).config as any).fenceStyles.filter((s: any) => [...names, BELL].includes(s.name)).map((s: any) => [s.name, s.needsCostReview ?? false, s.costReviewNote ?? null])
    await flag()
    // A save that sets no price and adds no part leaves the flags.
    expect((await call(owner, 'PUT', '/api/vinyl-colors/flag-gray', { input: { ...CHAI_GRAY, name: 'Flag Gray' } })).status).toBe(200)
    expect((await flags()).filter((f: any) => f[1]).length).toBe(3)
    // Black rivets entered: both Flag Gray fences cleared, note and all; the Bell (its kits untouched) keeps its flag.
    expect((await call(owner, 'PUT', '/api/vinyl-colors/flag-gray', { input: { ...CHAI_GRAY, name: 'Flag Gray', rivets: { color: 'Black', cents: 36 } } })).status).toBe(200)
    expect(await flags()).toEqual(expect.arrayContaining([[names[0], false, null], [names[1], false, null], [BELL, true, 'Bell section cost']]))
  })
})
