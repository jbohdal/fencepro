/**
 * Chain link, Oct 2026 (web/src/chainDigSet.ts planChainDigSetPipesAndTies):
 * the 12 dig set post parts get "0.055 wall" and their diameter in the name
 * (Inventory and every kit line naming them), and saved residential chain
 * link kits still on the old hook tie count get the per section count. Done
 * once per company, ever: recorded under a fixed key (AccountKeyValue
 * 'migration:chain-ds-pipes-hook-ties-2026-10'), so a part or kit Jonathan
 * later edits stays as he left it. Saved quotes are not touched: their stored
 * pull sheets keep the old names.
 *
 * Runs after the chain link dig set step (index.ts, one after another), in one
 * transaction holding the company's Settings and Inventory rows
 * (lockAccountState), and saves Inventory with its version raised, so a
 * browser holding an older copy merges.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'

export const CHAIN_DS_PIPES_KEY = 'migration:chain-ds-pipes-hook-ties-2026-10'

export interface ChainDsPipesResult { renamed: Array<{ from: string; to: string }>; kitLines: number; ties: string[]; skipped: string[] }

export async function ensureChainDigSetPipes(accountId: string): Promise<ChainDsPipesResult | null> {
  const m = await pricingModule()
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'chain-ds-pipes:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: CHAIN_DS_PIPES_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    // No Inventory yet: nothing to rename, and nothing recorded, so it applies once there is one.
    if (!inv) return null
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    const plan = m.planChainDigSetPipesAndTies({
      fenceStyles: Array.isArray(cfg.fenceStyles) ? cfg.fenceStyles : [],
      items: Array.isArray(inv.items) ? inv.items : [], kits: Array.isArray(inv.kits) ? inv.kits : [],
    })
    if (plan.renamed.length || plan.kitLines.length || plan.ties.length) {
      await tx.inventoryState.update({ where: { accountId }, data: { items: plan.state.items as any, kits: plan.state.kits as any, version: { increment: 1 } } })
    }
    const out: ChainDsPipesResult = { renamed: plan.renamed, kitLines: plan.kitLines.length, ties: plan.ties, skipped: plan.skipped }
    await tx.accountKeyValue.create({ data: { accountId, key: CHAIN_DS_PIPES_KEY, value: { at: new Date().toISOString(), ...out } as any } })
    return out
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureChainDigSetPipesAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureChainDigSetPipes(r.accountId)
      if (out && (out.renamed.length || out.ties.length || out.skipped.length)) {
        console.log(`[chain link] ${r.accountId}: ${out.renamed.length} dig set post parts renamed (${out.kitLines} kit lines), hook ties per section on ${out.ties.length} saved kits${out.skipped.length ? `; left as they were: ${out.skipped.join('; ')}` : ''}`)
      }
    } catch (err) { console.error('[chain link] dig set pipe names / hook ties failed:', err) }
  }
}
