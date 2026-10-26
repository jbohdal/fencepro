/**
 * The chain link dig set pipe names and hook ties step (lib/chainDigSetPipes.ts)
 * runs once, and side by side with the other start-up steps nothing is lost.
 *
 * A throwaway company is made from the dev company's Settings and Inventory,
 * with the 12 galvanized and black dig set post parts back on their first
 * names and the dig set kits back on the old hook tie count (as live is
 * before the update). Parts the step never named (the Green chain link dig set
 * posts, made Oct 26 with the 0.055 wall names already) are left as they are.
 * Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
const KINDS = ['corner', 'end', 'line', 'blank', 'section', 'section8', 'perFoot', 'perJob', 'walkGate', 'dblGate']
const oldName = (n: string) => n.replace(/^(DS, Pipe, (?:Galv|Blk), (?:Line|Terminal) Post), [^,]+ 0\.055 wall, /, '$1, ')
const STEP_PIPE = /^DS, Pipe, (Galv|Blk), (Line|Terminal) Post, /
const isTie = (p: string) => /Hook Ties, 6-1\/2"/.test(p)

describe.skipIf(!process.env.DEV_DB || !onDev)('chain link dig set pipe names and hook ties step (dev database)', () => {
  let prisma: any
  let accountId = ''

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    // The dev company (the one with the most saved quotes), never "the latest Settings row":
    // other database tests make throwaway companies while this runs.
    const top = await prisma.savedQuote.groupBy({ by: ['accountId'], _count: { _all: true }, orderBy: { _count: { accountId: 'desc' } }, take: 1 })
    const src = await prisma.businessState.findUnique({ where: { accountId: top[0].accountId } })
    const srcInv = await prisma.inventoryState.findUnique({ where: { accountId: src.accountId } })
    const account = await prisma.crmAccount.create({ data: { name: `Test chain-ds-pipes-${Date.now().toString(36)}`, status: 'active' } })
    accountId = account.id
    await prisma.businessState.create({ data: { accountId, config: src.config } })
    const kits = JSON.parse(JSON.stringify(srcInv.kits ?? []))
    for (const k of kits) {
      if (!/^chain\/\d\/(galv|black)\/res\/ds$/.test(k.styleName ?? '')) continue
      const h = Number(k.styleName.split('/')[1])
      for (const kind of KINDS) for (const p of k.kits[kind] ?? []) p.part = oldName(p.part)
      const tie = (k.kits.section ?? []).find((p: any) => isTie(p.part)) ?? [...(k.kits.perFoot ?? []), ...(k.kits.line ?? [])].find((p: any) => isTie(p.part))
      for (const kind of KINDS) if (k.kits[kind]) k.kits[kind] = k.kits[kind].filter((p: any) => !isTie(p.part))
      k.kits.perFoot = [...(k.kits.perFoot ?? []), { part: tie.part, qty: 0.05, fallbackCost: tie.fallbackCost }]
      k.kits.line = [...(k.kits.line ?? []), { part: tie.part, qty: (h - 1) / 100, fallbackCost: tie.fallbackCost }]
    }
    const items = (srcInv.items as any[]).map(i => ({ ...i, name: oldName(i.name) }))
    const { id: _id, accountId: _a, createdAt: _c, updatedAt: _u, version: _v, ...rest } = srcInv
    await prisma.inventoryState.create({ data: { ...rest, accountId, items, kits } })
    // The dig set and wood steps already ran for this company (as on live).
    const { CHAIN_DS_KEY } = await import('../src/server/lib/chainDigSetSeed.js')
    await prisma.accountKeyValue.create({ data: { accountId, key: CHAIN_DS_KEY, value: { test: true } } })
  })

  afterAll(async () => {
    if (!accountId) return
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('side by side with the other start-up steps: renamed once, kits still linked, ties per section, recorded once', async () => {
    const { ensureChainDigSetPipes, CHAIN_DS_PIPES_KEY } = await import('../src/server/lib/chainDigSetPipes.js')
    const { ensureChainDigSet } = await import('../src/server/lib/chainDigSetSeed.js')
    const { ensureWood } = await import('../src/server/lib/woodSeed.js')
    const { ensureStylesOnHold } = await import('../src/server/lib/stylesOnHold.js')
    const before = await prisma.inventoryState.findUnique({ where: { accountId } })
    const beforeB = await prisma.businessState.findUnique({ where: { accountId } })
    expect((before.items as any[]).filter(i => /^DS, Pipe, \w+, (Line|Terminal) Post, \d' Chain Link$/.test(i.name))).toHaveLength(12)
    const others = (before.items as any[]).filter(i => /^DS, Pipe, /.test(i.name) && !STEP_PIPE.test(i.name))

    const res = await Promise.all([ensureChainDigSetPipes(accountId), ensureWood(accountId), ensureChainDigSetPipes(accountId), ensureStylesOnHold(accountId), ensureChainDigSet(accountId)])
    const ran = [res[0], res[2]].filter(Boolean) as any[]
    expect(ran).toHaveLength(1)
    expect(ran[0].renamed).toHaveLength(12)
    expect(ran[0].kitLines).toBe(18)
    expect(ran[0].ties).toHaveLength(6)
    expect(ran[0].skipped).toEqual([])
    expect(await prisma.accountKeyValue.count({ where: { accountId, key: CHAIN_DS_PIPES_KEY } })).toBe(1)

    const after = await prisma.inventoryState.findUnique({ where: { accountId } })
    const afterB = await prisma.businessState.findUnique({ where: { accountId } })
    const items = after.items as any[]
    // Same parts (by id), nothing lost or doubled, 12 new names; Settings untouched.
    expect(items.map(i => i.id)).toEqual((before.items as any[]).map(i => i.id))
    expect(items.filter(i => STEP_PIPE.test(i.name) && / 0\.055 wall, \d' Chain Link$/.test(i.name))).toHaveLength(12)
    // Any other dig set post part (Green, on the dev copy) is exactly as it was.
    expect(items.filter(i => /^DS, Pipe, /.test(i.name) && !STEP_PIPE.test(i.name))).toEqual(others)
    expect(after.version).toBeGreaterThan(before.version)
    expect((afterB.config as any).fenceStyles.length).toBe((beforeB.config as any).fenceStyles.length)
    // Every dig set kit line names a part in Inventory.
    const names = new Set(items.map(i => i.name))
    const ds = (after.kits as any[]).filter(k => /^chain\/\d\/(galv|black)\/res\/ds$/.test(k.styleName ?? ''))
    expect(ds).toHaveLength(6)
    for (const k of ds) {
      const h = Number(k.styleName.split('/')[1])
      for (const kind of ['line', 'corner', 'end']) {
        const pipe = k.kits[kind].find((p: any) => /^DS, Pipe, /.test(p.part))
        expect(names.has(pipe.part), pipe.part).toBe(true)
        expect(k.kits[kind].find((p: any) => p.part === 'Misc, Concrete')?.qty).toBe(0.5)
      }
      expect(k.kits.section.find((p: any) => isTie(p.part))?.qty).toBe((h + 5) / 100)
      expect([...(k.kits.perFoot ?? []), ...(k.kits.line ?? [])].some((p: any) => isTie(p.part))).toBe(false)
    }

    // Once: a later start changes nothing.
    expect(await ensureChainDigSetPipes(accountId)).toBeNull()
    const again = await prisma.inventoryState.findUnique({ where: { accountId } })
    expect(again.version).toBe(after.version)
  })
})
