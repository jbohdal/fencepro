/**
 * The chain link gate kits step (lib/chainGateKits.ts; Jonathan, Oct 26, 2026:
 * chain link gates and hardware follow the takeoff sheet) runs once per
 * company, side by side with the other chain link step, and gives the saved
 * dig set kits (still on the old gate kits, as on live and dev) the no dig
 * style's gate kits. Nothing else in Inventory or Settings changes.
 *
 * A throwaway company is made from the dev company's Settings and Inventory.
 * Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
const GATE_KINDS = ['walkGate', 'dblGate', 'walkGate5', 'walkGate6', 'dblGate10', 'dblGate12', 'anyGate', 'anyWalkGate', 'anyDblGate']

describe.skipIf(!process.env.DEV_DB || !onDev)('chain link gate kits step (dev database)', () => {
  let prisma: any
  let accountId = ''

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    // The dev company (the one with the most saved quotes), never "the latest Settings row".
    const top = await prisma.savedQuote.groupBy({ by: ['accountId'], _count: { _all: true }, orderBy: { _count: { accountId: 'desc' } }, take: 1 })
    const src = await prisma.businessState.findUnique({ where: { accountId: top[0].accountId } })
    const srcInv = await prisma.inventoryState.findUnique({ where: { accountId: src.accountId } })
    const account = await prisma.crmAccount.create({ data: { name: `Test chain-gates-${Date.now().toString(36)}`, status: 'active' } })
    accountId = account.id
    await prisma.businessState.create({ data: { accountId, config: src.config } })
    const { id: _id, accountId: _a, createdAt: _c, updatedAt: _u, version: _v, ...rest } = srcInv
    await prisma.inventoryState.create({ data: { ...rest, accountId } })
  })

  afterAll(async () => {
    if (!accountId) return
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('the 6 dig set kits get the sheet gate kits once; nothing else changes', async () => {
    const { ensureChainGateKits, CHAIN_GATES_KEY } = await import('../src/server/lib/chainGateKits.js')
    const { ensureChainDigSetPipes } = await import('../src/server/lib/chainDigSetPipes.js')
    const before = await prisma.inventoryState.findUnique({ where: { accountId } })
    const beforeB = await prisma.businessState.findUnique({ where: { accountId } })
    const res = await Promise.all([ensureChainGateKits(accountId), ensureChainDigSetPipes(accountId), ensureChainGateKits(accountId)])
    const ran = [res[0], res[2]].filter(Boolean) as any[]
    expect(ran).toHaveLength(1)
    expect(ran[0].updated.sort()).toEqual(['chain/4/black/res/ds', 'chain/4/galv/res/ds', 'chain/5/black/res/ds', 'chain/5/galv/res/ds', 'chain/6/black/res/ds', 'chain/6/galv/res/ds'])
    expect(ran[0].skipped).toEqual([])
    expect(await prisma.accountKeyValue.count({ where: { accountId, key: CHAIN_GATES_KEY } })).toBe(1)
    expect(await ensureChainGateKits(accountId)).toBeNull()

    const after = await prisma.inventoryState.findUnique({ where: { accountId } })
    const afterB = await prisma.businessState.findUnique({ where: { accountId } })
    expect(after.items).toEqual(before.items)
    expect(afterB.config).toEqual(beforeB.config)
    expect(after.version).toBeGreaterThan(before.version)
    const kits = after.kits as any[], was = before.kits as any[]
    expect(kits.map(k => k.styleName)).toEqual(was.map(k => k.styleName))
    for (const k of kits) {
      const old = was.find(w => w.id === k.id)
      for (const kind of Object.keys({ ...k.kits, ...old.kits })) {
        if (GATE_KINDS.includes(kind) && /^chain\/\d\/(galv|black)\/res\/ds$/.test(k.styleName)) continue
        expect(k.kits[kind], `${k.styleName} ${kind}`).toEqual(old.kits[kind])
      }
    }
    const g4 = kits.find(k => k.styleName === 'chain/4/galv/res/ds')
    expect(g4.kits.dblGate10.find((p: any) => p.part === `Chainlink, Galv, Gate, 1-3/8", 4' x 5' (.055)`)?.qty).toBe(2)
    expect(g4.kits.anyDblGate.map((p: any) => p.part).sort()).toEqual(['G, Drop Rod, 24"', 'G, Fork, PS, 1-3/8"'])
  })
})
