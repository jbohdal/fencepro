/**
 * The one-time start-up steps that change Settings and Inventory, run at the
 * same moment, keep each other's additions (lib/lockState.ts). On live, Oct
 * 19, 2026, the chain link dig set step saved over the wood step's styles,
 * kits and parts; the wood restore key adds them back once.
 *
 * A throwaway company is made from the dev company's Settings and Inventory
 * with the wood and chain link dig set additions taken out (as live was before
 * the update). Database writes happen only inside beforeAll / test / afterAll.
 */

import 'dotenv/config'
import { describe, test, expect, beforeAll, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('start-up steps side by side (dev database)', () => {
  let prisma: any
  let accountId = ''
  const added = (name: string) => /^wood\//.test(name) || /^chain\/.*\/ds$/.test(name)
  const addedItem = (name: string) => /^Wood, /.test(name) || /^DS, Pipe, /.test(name)

  const state = async () => {
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    const inv = await prisma.inventoryState.findUnique({ where: { accountId } })
    const styles = ((b.config as any).fenceStyles as any[]).map(s => s.name)
    return { styles, items: (inv.items as any[]).map(i => i.name), kits: ((inv.kits as any[]) || []).map(k => k.styleName) }
  }

  beforeAll(async () => {
    prisma = (await import('../src/server/lib/prisma.js')).default
    // The dev company (the one with the most saved quotes), never "the latest Settings row":
    // other database tests make throwaway companies while this runs.
    const top = await prisma.savedQuote.groupBy({ by: ['accountId'], _count: { _all: true }, orderBy: { _count: { accountId: 'desc' } }, take: 1 })
    const src = await prisma.businessState.findUnique({ where: { accountId: top[0].accountId } })
    const srcInv = await prisma.inventoryState.findUnique({ where: { accountId: src.accountId } })
    const account = await prisma.crmAccount.create({ data: { name: `Test startup-seeds-${Date.now().toString(36)}`, status: 'active' } })
    accountId = account.id
    const cfg = { ...(src.config as any), fenceStyles: (src.config as any).fenceStyles.filter((s: any) => !added(s.name)) }
    delete cfg.fenceCatalog
    await prisma.businessState.create({ data: { accountId, config: cfg } })
    const { id: _id, accountId: _a, createdAt: _c, updatedAt: _u, version: _v, ...rest } = srcInv
    await prisma.inventoryState.create({ data: {
      ...rest,
      accountId,
      items: (srcInv.items as any[]).filter(i => !addedItem(i.name)),
      kits: ((srcInv.kits as any[]) || []).filter(k => !added(k.styleName)),
    } })
  })

  afterAll(async () => {
    if (!accountId) return
    await prisma.accountKeyValue.deleteMany({ where: { accountId } })
    await prisma.inventoryState.deleteMany({ where: { accountId } })
    await prisma.businessState.deleteMany({ where: { accountId } })
    await prisma.crmAccount.delete({ where: { id: accountId } })
  })

  test('wood, chain link dig set and styles on hold at the same moment: every addition is kept', async () => {
    const { ensureWood } = await import('../src/server/lib/woodSeed.js')
    const { ensureChainDigSet } = await import('../src/server/lib/chainDigSetSeed.js')
    const { ensureStylesOnHold } = await import('../src/server/lib/stylesOnHold.js')
    const { ensureCostReview } = await import('../src/server/lib/costReview.js')
    const before = await state()
    expect(before.styles.some(added)).toBe(false)
    await Promise.all([ensureChainDigSet(accountId), ensureWood(accountId), ensureStylesOnHold(accountId), ensureCostReview(accountId), ensureChainDigSet(accountId), ensureWood(accountId)])
    const after = await state()
    expect(after.styles.filter(n => /^wood\//.test(n))).toHaveLength(6)   // Stockade, Board on Board, Shadow Box × PT Pine, Alta Premium (Oct 30 2026)
    expect(after.styles.filter(n => /^chain\/.*\/ds$/.test(n))).toHaveLength(6)
    expect(after.items.filter(n => /^Wood, /.test(n))).toHaveLength(12)   // the real wood kits' parts (Oct 30 2026), never renamed vinyl parts
    expect(after.items.filter(n => /^DS, Pipe, /.test(n))).toHaveLength(12)
    expect(after.kits.filter(n => /^wood\//.test(n))).toHaveLength(6)   // a real kit a style
    expect(after.kits.filter(n => /^chain\/.*\/ds$/.test(n))).toHaveLength(6)
    // The Bell flagged "needs cost review" alongside (lib/costReview.ts).
    const bell = ((await prisma.businessState.findUnique({ where: { accountId } })).config.fenceStyles as any[]).find(s => s.name === "WV-ND Bell 4'x6'")
    expect(bell?.needsCostReview).toBe(true)
    // Nothing that was there before is lost or doubled.
    for (const n of before.styles) expect(after.styles.filter(s => s === n)).toHaveLength(1)
    expect(after.items.length).toBe(before.items.length + 24)
  })

  test('restore: wood recorded as added but saved over (as on live) comes back once; later runs change nothing', async () => {
    const { ensureWood, WOOD_RESTORE_KEY } = await import('../src/server/lib/woodSeed.js')
    // Live's state after the update: the wood key recorded, the wood additions gone.
    const b = await prisma.businessState.findUnique({ where: { accountId } })
    await prisma.businessState.update({ where: { accountId }, data: { config: { ...(b.config as any), fenceStyles: (b.config as any).fenceStyles.filter((s: any) => !/^wood\//.test(s.name)) } } })
    const inv = await prisma.inventoryState.findUnique({ where: { accountId } })
    await prisma.inventoryState.update({ where: { accountId }, data: {
      items: (inv.items as any[]).filter(i => !/^Wood, /.test(i.name)),
      kits: (inv.kits as any[]).filter(k => !/^wood\//.test(k.styleName)),
    } })
    await prisma.accountKeyValue.deleteMany({ where: { accountId, key: WOOD_RESTORE_KEY } })
    const lost = await state()
    expect(lost.styles.some(n => /^wood\//.test(n))).toBe(false)

    const out = await ensureWood(accountId)
    expect(out?.styles).toHaveLength(6)
    const back = await state()
    expect(back.styles.filter(n => /^wood\//.test(n))).toHaveLength(6)
    expect(back.items.filter(n => /^Wood, /.test(n))).toHaveLength(12)
    expect(back.kits.filter(n => /^wood\//.test(n))).toHaveLength(6)
    expect(back.styles.filter(n => /^chain\/.*\/ds$/.test(n))).toHaveLength(6)

    expect(await ensureWood(accountId)).toBeNull()
    expect((await state()).items.length).toBe(back.items.length)
  })
})
