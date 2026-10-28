/**
 * Green chain link keeps following Black 4 ft (Jonathan, Oct 26 2026: "copy
 * the black chain link setup and kits, swap in the green parts"). At every
 * server start, after the chain link steps (index.ts): each Green kit set that
 * still is what it was last derived as is derived again from its black kit as
 * that kit is now (lib/greenChainLink.ts planGreenFollowsBlack), so a chain
 * link rule change (a deploy) or a black kit edited in Material Kits (the next
 * start) reaches Green too. A Green kit Jonathan edited is left as he left it.
 * A green part still priced from Black (no green price entered yet) takes the
 * black part's price as it is now (lib/followBorrowed.ts), so a black price
 * changed by any path reaches it. Nothing to do (no Green, or already in
 * step) writes nothing. Saved quotes are not touched.
 *
 * One transaction holding the company's Settings and Inventory rows
 * (lockAccountState); Inventory is saved with its version raised, so a
 * browser holding an older copy merges.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'
import { GREEN_KEY, planGreenFollowsBlack, type GreenFollow, type GreenModule } from './greenChainLink.js'
import { followBorrowedReport } from './followBorrowed.js'

export async function ensureGreenFollowsBlack(accountId: string): Promise<GreenFollow | null> {
  const m = await pricingModule() as unknown as GreenModule & { fenceCatalogOf(cfg: unknown): unknown }
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'green-follows:' + accountId}))`
    const made = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: GREEN_KEY } } })
    if (!made) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    if (!b || !inv) return null
    const cfg = (b.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
    const plan = planGreenFollowsBlack(m, { fenceStyles: arr(cfg.fenceStyles), fenceCatalog: m.fenceCatalogOf(cfg), items: arr(inv.items), kits: arr(inv.kits) }, { madeAt: (made.value as any)?.at ?? null })
    // A green part still priced from Black takes Black's price now (Jonathan, Oct 27: it "follows Black's price changes until a green price is entered").
    const prices = await followBorrowedReport(plan.state.items)
    plan.state.items = prices.items
    plan.pricesFollowed = prices.followed
    if (plan.renamed?.length || plan.updated.length || plan.items.length || plan.marked.length || plan.tidied.length || plan.removed.length || prices.followed.length) {
      await tx.inventoryState.update({ where: { accountId }, data: { items: plan.state.items as any, kits: plan.state.kits as any, version: { increment: 1 } } })
    }
    return plan
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureGreenFollowsBlackAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureGreenFollowsBlack(r.accountId)
      if (!out) continue
      for (const n of out.renamed ?? []) console.log(`[green chain link] ${r.accountId}: named again: ${n}`)
      for (const u of out.updated) console.log(`[green chain link] ${r.accountId}: ${u.kit} follows ${u.from} again: ${u.changes.join(' | ')}`)
      for (const f of out.pricesFollowed ?? []) console.log(`[green chain link] ${r.accountId}: ${f.part} follows ${f.from}: $${(f.wasCents / 100).toFixed(2)} → $${(f.nowCents / 100).toFixed(2)}`)
      if (out.items.length) console.log(`[green chain link] ${r.accountId}: added with no price: ${out.items.join('; ')}`)
      if (out.tidied.length) console.log(`[green chain link] ${r.accountId}: names trimmed: ${out.tidied.join('; ')}`)
      if (out.removed.length) console.log(`[green chain link] ${r.accountId}: unused parts with no price taken out: ${out.removed.join('; ')}`)
      if (out.skipped.length) console.log(`[green chain link] ${r.accountId}: left as they are: ${out.skipped.join('; ')}`)
    } catch (err) { console.error('[green chain link] follow black failed:', err) }
  }
}
