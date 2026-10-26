/**
 * Green chain link follows Black 4 ft at server start (lib/greenChainLinkFollow.ts),
 * on a throwaway copy of the dev company's Settings and Inventory (made from
 * the dev company, which has Green from Oct 26 with the old gate kits). The
 * step derives both Green kits again from the black kits as they are now,
 * adds the green parts they need with no price, and a second start (also two
 * at once) changes nothing. Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')

describe.skipIf(!process.env.DEV_DB || !onDev)('green chain link follows black at server start (dev database)', () => {
  let prisma: any
  let accountId = ''
  let hasGreen = false

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    const { GREEN_KEY } = await import('../src/server/lib/greenChainLink.js')
    const top = await prisma.savedQuote.groupBy({ by: ['accountId'], _count: { _all: true }, orderBy: { _count: { accountId: 'desc' } }, take: 1 })
    const src = await prisma.businessState.findUnique({ where: { accountId: top[0].accountId } })
    const srcInv = await prisma.inventoryState.findUnique({ where: { accountId: src.accountId } })
    const made = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId: src.accountId, key: GREEN_KEY } } })
    hasGreen = !!made
    const account = await prisma.crmAccount.create({ data: { name: `Test green-follows-${Date.now().toString(36)}`, status: 'active' } })
    accountId = account.id
    await prisma.businessState.create({ data: { accountId, config: src.config } })
    const { id: _id, accountId: _a, createdAt: _c, updatedAt: _u, version: _v, ...rest } = srcInv
    // The Green kits as made on Oct 26 (before they were marked): drop the mark if the dev copy has one.
    const kits = (srcInv.kits as any[]).map(k => { const { followsKit: _f, ...k2 } = k; return /green/.test(k.styleName ?? '') ? k2 : k })
    await prisma.inventoryState.create({ data: { ...rest, accountId, kits } })
    if (made) await prisma.accountKeyValue.create({ data: { accountId, key: GREEN_KEY, value: made.value } })
  })

  afterAll(async () => {
    if (!accountId) return
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('both Green kits are the black kits with green parts; once in step, starts change nothing', async () => {
    if (!hasGreen) return
    const { ensureGreenFollowsBlack } = await import('../src/server/lib/greenChainLinkFollow.js')
    const { pricingModule } = await import('../src/server/lib/estimates.js')
    const { greenKitFrom, kitKey } = await import('../src/server/lib/greenChainLink.js')
    const m: any = await pricingModule()
    const before = await prisma.inventoryState.findUnique({ where: { accountId } })

    const first = await ensureGreenFollowsBlack(accountId)
    expect(first).not.toBeNull()
    expect(first!.skipped).toEqual([])
    const after = await prisma.inventoryState.findUnique({ where: { accountId } })
    const kits = after.kits as any[], items = after.items as any[]
    const names = new Set(items.map(i => String(i.name).toLowerCase().replace(/\s+/g, '')))
    for (const [green, black] of [['chain/4/green/res/nd', "CL - 4' Black"], ['chain/4/green/res/ds', 'chain/4/black/res/ds']]) {
      const g = kits.find(k => k.styleName === green && !k.archived)
      expect(g.followsKit.from).toBe(black)
      expect(kitKey(g)).toBe(kitKey(greenKitFrom(m, m.kitSetFor(black, kits), ['Black', 'Blk'])))
      expect(g.kits.anyDblGate.map((p: any) => p.part).sort()).toEqual(['Drop Rod, 30", Green', 'Green, Fork, PS, 1-3/8"'])
      expect(g.kits.dblGate.find((p: any) => /Hinge, Female/.test(p.part)).qty).toBe(6)
      // Every part of the kit is in Inventory.
      for (const ps of Object.values(g.kits) as any[]) for (const p of ps) expect(names.has(String(p.part).toLowerCase().replace(/\s+/g, '')), p.part).toBe(true)
    }
    // Parts added are unpriced green parts; nothing else in Inventory changed.
    const added = items.filter(i => !(before.items as any[]).some((b: any) => b.id === i.id))
    expect(added.every(i => i.unitCost === 0 && i.category === 'Chainlink Green' && i.madeFor === 'chain:finish:green')).toBe(true)
    expect(items.filter(i => (before.items as any[]).some((b: any) => b.id === i.id))).toEqual(before.items)
    expect(after.version).toBeGreaterThan(before.version)

    const again = await Promise.all([ensureGreenFollowsBlack(accountId), ensureGreenFollowsBlack(accountId)])
    for (const r of again) expect([r!.updated, r!.items, r!.marked, r!.skipped]).toEqual([[], [], [], []])
    expect((await prisma.inventoryState.findUnique({ where: { accountId } })).version).toBe(after.version)
  })
})
