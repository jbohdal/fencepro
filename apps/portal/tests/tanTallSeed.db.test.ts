/**
 * The Tan 8 ft tall start-up step (lib/tanTallSeed.ts), against the dev
 * database (DEV_DB=1; refuses any other) on a throwaway company made from the
 * dev company's Settings and Inventory with the Tan 8 ft styles taken out (as
 * live is before the update):
 *   - it adds the four styles once, and their $0 Tan section parts;
 *   - nothing else in Settings changes; Inventory only gains those parts;
 *   - they are held until priced; with prices typed, they quote.
 */

import 'dotenv/config'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import { estimateConfig, estimate } from '../../web/src/estimate'
import { isTallVinyl, styleChoicesOf } from '../../web/src/fenceCatalog'
import { applyTallPrices, tallKey } from '../../web/src/tallVinylPriceSave'
import { stripDerived } from '../../web/src/fenceCatalog'
import { isQuotable } from '../../web/src/styleAvailability'
import { TAN_TALL } from '../../web/src/tanTall'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
const TAN = TAN_TALL.map(([t]) => t)
const tanTall = (n: string) => TAN.includes(n)
const tanTallPart = (n: string) => /^\*Vinyl, Tan, (Mid Rail, [68]'|Picket, 4'|U Channel, 4')$/.test(n)

describe.skipIf(!process.env.DEV_DB || !onDev)('Tan 8 ft tall start-up step (dev database)', { timeout: 60_000 }, () => {
  let prisma: any
  let accountId = ''
  let before: { config: any; items: any[]; kits: any[] }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const top = await prisma.savedQuote.groupBy({ by: ['accountId'], _count: { _all: true }, orderBy: { _count: { accountId: 'desc' } }, take: 1 })
    const src = await prisma.businessState.findUnique({ where: { accountId: top[0].accountId } })
    const srcInv = await prisma.inventoryState.findUnique({ where: { accountId: src.accountId } })
    const account = await prisma.crmAccount.create({ data: { name: `Test tan-tall-${Date.now().toString(36)}`, status: 'active' } })
    accountId = account.id
    const config = { ...(src.config as any), fenceStyles: (src.config as any).fenceStyles.filter((s: any) => !tanTall(s.name)) }
    const items = (srcInv.items as any[]).filter(i => !tanTallPart(i.name))
    const { id: _id, accountId: _a, createdAt: _c, updatedAt: _u, version: _v, ...rest } = srcInv
    await prisma.businessState.create({ data: { accountId, config } })
    await prisma.inventoryState.create({ data: { ...rest, accountId, items } })
    before = { config, items, kits: (srcInv.kits as any[]) || [] }
  })

  afterAll(async () => {
    if (!accountId) return
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('adds the four once (and their $0 section parts); nothing else in Settings or Inventory changes', async () => {
    const { ensureTanTall, TAN_TALL_KEY } = await import('../src/server/lib/tanTallSeed.js')
    const [a, b] = await Promise.all([ensureTanTall(accountId), ensureTanTall(accountId)])
    const out = a ?? b
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(out!.added).toEqual(TAN)
    const row = await prisma.businessState.findUnique({ where: { accountId } })
    const inv = await prisma.inventoryState.findUnique({ where: { accountId } })
    const styles = row.config.fenceStyles as any[]
    // The four, once each, with no price on them.
    for (const n of TAN) {
      expect(styles.filter(s => s.name === n)).toHaveLength(1)
      const s = styles.find(s => s.name === n)
      expect(s.pieceCents).toBeUndefined()
      expect(s.pricePerFoot).toBeUndefined()
      expect(s.choices).toMatchObject({ color: 'tan', height: '8' })
    }
    // Every other style, and every other Settings key, exactly as before.
    expect(styles.filter(s => !tanTall(s.name))).toEqual(before.config.fenceStyles)
    const { fenceStyles: _x, ...restAfter } = row.config
    const { fenceStyles: _y, ...restBefore } = before.config
    expect(restAfter).toEqual(restBefore)
    // Inventory: the old items as they were, plus only the Tan 8 ft section parts at $0; kits untouched.
    const items = inv.items as any[]
    expect(items.slice(0, before.items.length)).toEqual(before.items)
    const made = items.slice(before.items.length)
    expect(made.every(i => tanTallPart(i.name) && i.unitCost === 0 && i.includedIn === '8 ft tall section price')).toBe(true)
    expect(made.map(i => i.name).sort()).toEqual(out!.parts.slice().sort())
    expect(inv.kits).toEqual(before.kits)
    // Recorded; later runs do nothing, even after Jonathan removes one.
    expect(await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: TAN_TALL_KEY } } })).not.toBeNull()
    await prisma.businessState.update({ where: { accountId }, data: { config: { ...row.config, fenceStyles: styles.filter(s => s.name !== TAN[3]) } } })
    expect(await ensureTanTall(accountId)).toBeNull()
    expect(((await prisma.businessState.findUnique({ where: { accountId } })).config.fenceStyles as any[]).some(s => s.name === TAN[3])).toBe(false)
    await prisma.businessState.update({ where: { accountId }, data: { config: row.config } })
  })

  test('held until priced; with prices typed in Settings, they quote', async () => {
    const row = await prisma.businessState.findUnique({ where: { accountId } })
    const inv = await prisma.inventoryState.findUnique({ where: { accountId } })
    const cfg = estimateConfig(row.config)
    for (const n of TAN) {
      const s = cfg.fenceStyles.find(x => x.name === n)!
      expect(isQuotable(s), n).toBe(false)
      expect(s.held).toMatch(/8 ft tall needs its section and post prices in Settings → Price List → 8 ft tall vinyl/)
    }
    const tall = cfg.fenceStyles.filter(s => s.isActive !== false && isTallVinyl(styleChoicesOf(s)))
    expect(tall.map(s => s.name)).toEqual(expect.arrayContaining(TAN))
    const typed = Object.fromEntries(TAN.flatMap(n => [[tallKey(n, 'section'), '430'], [tallKey(n, 'post'), '70']]))
    const r = applyTallPrices(cfg.fenceStyles, tall, typed, '2026-10-30')
    expect(r.bad).toEqual([])
    const config = { ...row.config, fenceStyles: stripDerived(r.fenceStyles) }
    const data = { config, inventory: inv.items, kits: inv.kits }
    for (const n of TAN) {
      expect(isQuotable(estimateConfig(config).fenceStyles.find(x => x.name === n)!)).toBe(true)
      const e = estimate(data, { fenceStyle: n, runs: [48], corners: 0, ends: 2, walkGates: 0, dblGates: 0 })
      expect(e.sections).toBe(/8'x8'/.test(n) ? 6 : 8)
      expect(e.materialCost).toBeCloseTo(430 * e.sections + 70 * (e.sections + 1), 2)
    }
  })
})
