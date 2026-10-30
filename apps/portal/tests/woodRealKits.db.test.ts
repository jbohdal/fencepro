/**
 * The real wood kits start-up step (lib/woodSeed.ts ensureWoodRealKits, Oct
 * 30 2026), against the dev database (DEV_DB=1; refuses any other) on a
 * throwaway company made from the dev company's Settings and Inventory (a
 * copy of live: the Oct 19 renamed vinyl parts and kits, wood switched off
 * by hand as Jonathan did on live):
 *   - archives (never deletes) every renamed part and the four old kits;
 *   - adds the six real wood styles (Stockade, Board on Board, Shadow Box ×
 *     PT Pine, Alta Premium pickets), their kits and their 12 new parts at
 *     Jonathan's costs (the self-tapping screw $0), reusing concrete and the
 *     drop rod;
 *   - adds them to the choice tree, archives wood's Privacy, No dig and 6 ft
 *     panel choices and turns wood back on;
 *   - runs once, even twice at the same moment; a second start changes nothing;
 *   - a sent quote on an old wood style keeps its saved price: a save that
 *     changes it is refused (lib/heldStylePrice.ts).
 * Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('real wood kits start-up step (dev database)', { timeout: 60_000 }, () => {
  let prisma: any
  let accountId = ''
  let before: { items: any[]; kits: any[] }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const top = await prisma.savedQuote.groupBy({ by: ['accountId'], _count: { _all: true }, orderBy: { _count: { accountId: 'desc' } }, take: 1 })
    const src = await prisma.businessState.findUnique({ where: { accountId: top[0].accountId } })
    const srcInv = await prisma.inventoryState.findUnique({ where: { accountId: src.accountId } })
    const account = await prisma.crmAccount.create({ data: { name: `Test wood-real-${Date.now().toString(36)}`, status: 'active' } })
    accountId = account.id
    // As live is: the old tree with wood switched off by hand, the Oct 19 parts and kits.
    const cfg = JSON.parse(JSON.stringify(src.config))
    const wood = cfg.fenceCatalog?.materials?.find((m: any) => m.key === 'wood')
    if (wood) {
      wood.quotable = false
      for (const d of wood.dims) for (const o of d.options) delete o.archived
      wood.dims[0].options = wood.dims[0].options.filter((o: any) => o.key === 'privacy')
      wood.dims = wood.dims.filter((d: any) => d.key !== 'picket')
      wood.nameTemplate = 'Wood {style}, {height} tall, {width}, {install}'
    }
    cfg.fenceStyles = cfg.fenceStyles.filter((s: any) => !/^wood\/(stockade|bob|sb)\//.test(s.name))
    const items = (srcInv.items as any[]).filter(i => i.madeFor !== 'wood-real')
    const kits = ((srcInv.kits as any[]) || []).filter(k => k.madeFor !== 'wood-real').map(k => (k.madeFor === 'wood' ? { ...k, archived: undefined } : k))
    const { id: _id, accountId: _a, createdAt: _c, updatedAt: _u, version: _v, ...rest } = srcInv
    await prisma.businessState.create({ data: { accountId, config: cfg } })
    await prisma.inventoryState.create({ data: { ...rest, accountId, items: items.map(i => (i.madeFor === 'wood' ? { ...i, status: 'active' } : i)), kits } })
    before = { items, kits }
  })

  afterAll(async () => {
    if (!accountId) return
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('archives the renamed parts and old kits (never deletes), adds the three styles, kits and parts, once', async () => {
    const { ensureWoodRealKits, WOOD_REAL_KEY } = await import('../src/server/lib/woodSeed.js')
    const oldItems = before.items.filter(i => i.madeFor === 'wood')
    const oldKits = before.kits.filter(k => k.madeFor === 'wood')
    expect(oldItems.length).toBeGreaterThan(0)
    expect(oldKits).toHaveLength(4)
    const [a, b] = await Promise.all([ensureWoodRealKits(accountId), ensureWoodRealKits(accountId)])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    const out = (a ?? b)!
    expect(out.archivedItems.sort()).toEqual(oldItems.map(i => i.name).sort())
    expect(out.archivedKits).toHaveLength(4)
    const STYLES = ['stockade', 'bob', 'sb'].flatMap(k => ['pine', 'premium'].map(g => `wood/${k}/6/${g}/ds/8`))
    expect(out.addedStyles).toEqual(STYLES)
    expect(out.addedKits).toEqual(STYLES)
    expect(out.addedItems).toHaveLength(12)
    expect(out.catalog).toHaveLength(9)

    const inv = await prisma.inventoryState.findUnique({ where: { accountId } })
    const items = inv.items as any[], kits = inv.kits as any[]
    // Nothing deleted: every item and kit that was there is still there.
    for (const i of before.items) expect(items.filter(x => x.id === i.id)).toHaveLength(1)
    for (const k of before.kits) expect(kits.filter(x => x.id === k.id)).toHaveLength(1)
    expect(items).toHaveLength(before.items.length + 12)
    expect(items.filter(i => i.madeFor === 'wood').every(i => i.status === 'archived')).toBe(true)
    expect(kits.filter(k => k.madeFor === 'wood').every(k => k.archived === true)).toBe(true)
    const added = items.filter(i => i.madeFor === 'wood-real')
    expect(added.map(i => i.name)).toEqual(out.addedItems)
    expect(added.every(i => i.category === 'Wood' && i.status === 'active')).toBe(true)
    expect(Object.fromEntries(added.map(i => [i.name, i.unitCost]))).toMatchObject({ "Wood, PT Rail, 2x4x8'": 5.23, 'Wood, Steel Gate Frame (hinges included)': 375.27, 'Wood, Screw, Self-Tapping, Picket to Steel Gate Frame': 0 })
    expect(added.filter(i => i.unitCost > 0).every(i => i.priceUpdatedAt === '2026-10-30' && i.priceImported === false)).toBe(true)
    for (const key of ['stockade', 'bob', 'sb']) {
      const real = kits.find(k => k.id === `kit_wood_real_${key}_6_premium_ds_8`)
      expect(real.styleName).toBe(`wood/${key}/6/premium/ds/8`)
      expect(real.kits.gatePost).toEqual([{ part: "Wood, PT Post, Gate, 6x6x8'", qty: 1, fallbackCost: 0 }, { part: 'Misc, Concrete', qty: 2, fallbackCost: 0 }])
    }
    // Concrete and the drop rod reused, at their prices.
    expect(items.filter(i => i.name === 'Misc, Concrete')).toHaveLength(1)
    expect(items.filter(i => i.name === 'Drop Rod, 48", Black')).toHaveLength(1)

    const cfg = (await prisma.businessState.findUnique({ where: { accountId } })).config
    const wood = cfg.fenceCatalog.materials.find((m: any) => m.key === 'wood')
    expect(wood.quotable).toBeUndefined()
    expect(wood.dims.find((d: any) => d.key === 'install').options.find((o: any) => o.key === 'nd').archived).toBe(true)
    expect(wood.dims.find((d: any) => d.key === 'width').options.find((o: any) => o.key === '6').archived).toBe(true)
    expect(wood.dims.find((d: any) => d.key === 'style').options.map((o: any) => [o.key, !!o.archived])).toEqual([['privacy', true], ['stockade', false], ['bob', false], ['sb', false]])
    expect(wood.dims.map((d: any) => d.key)).toEqual(['style', 'height', 'picket', 'install', 'width'])
    expect(cfg.fenceStyles.filter((s: any) => /^wood\//.test(s.name))).toHaveLength(10)
    expect(cfg.fenceStyles.filter((s: any) => STYLES.includes(s.name)).every((s: any) => s.woodOf === "WV-DS 6'x8' Privacy")).toBe(true)

    expect(await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: WOOD_REAL_KEY } } })).toBeTruthy()
    // A second start: nothing.
    const versions = inv.version
    expect(await ensureWoodRealKits(accountId)).toBeNull()
    expect((await prisma.inventoryState.findUnique({ where: { accountId } })).version).toBe(versions)
  })

  test('wood held with the reason until priced; the old wood styles held; a sent quote on one keeps its saved price', async () => {
    const { pricingModule } = await import('../src/server/lib/estimates.js')
    const { dataFor } = await import('../src/server/lib/quotePricing.js')
    const { heldPriceRefusal } = await import('../src/server/lib/heldStylePrice.js')
    const m: any = await pricingModule()
    const d = await dataFor(accountId)
    for (const k of ['stockade', 'bob', 'sb']) for (const g of ['pine', 'premium']) expect(m.heldStyleReason(d, `wood/${k}/6/${g}/ds/8`)).toBe('Wood is waiting for prices on 1 part in Inventory')
    expect(m.heldStyleReason(d, 'wood/privacy/6/nd/6')).toMatch(/Privacy is archived/)
    // The sent quote, as saved (505174a0 on dev, a copy of live's), read only.
    const sent = await prisma.savedQuote.findUnique({ where: { id: '505174a0-32bd-4146-944e-960919c93a96' } })
    const saved = sent ?? { fenceStyle: 'wood/privacy/6/nd/6', finalPrice: 1039, status: 'SENT' }
    const refused = await heldPriceRefusal(accountId, { ...saved, finalPrice: 1500 }, saved as any)
    expect(refused?.held).toMatch(/Privacy is archived/)
    expect(await heldPriceRefusal(accountId, { ...saved, notes: 'Called back' }, saved as any)).toBeNull()

    // The screw priced in Inventory (a test price): all six available for quoting, no other step.
    const inv = await prisma.inventoryState.findUnique({ where: { accountId } })
    await prisma.inventoryState.update({ where: { accountId }, data: { items: (inv.items as any[]).map(i => (/Self-Tapping/.test(i.name) && i.madeFor === 'wood-real' ? { ...i, unitCost: 0.05 } : i)), version: { increment: 1 } } })
    const d2 = await dataFor(accountId)
    expect(m.heldStyleReason(d2, 'wood/stockade/6/pine/ds/8')).toBeNull()
    expect(m.estimateStyles(d2.config, d2).filter((s: any) => /^wood\//.test(s.name)).map((s: any) => s.name)).toEqual(['stockade', 'bob', 'sb'].flatMap(k => ['pine', 'premium'].map(g => `wood/${k}/6/${g}/ds/8`)))
  })
})
