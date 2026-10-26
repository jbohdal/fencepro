/**
 * Chain link gates and hardware follow the takeoff sheet (Jonathan, Oct 26,
 * 2026; web/src/chainDigSet.ts planChainGateKits): saved residential chain
 * link kit sets copied from a no dig style (the dig set twins) that still
 * carry the old gate kits get the no dig style's gate kits (gate leaves by
 * width, hinges, forks, collar, drop rod, bolts). Done once per company, ever:
 * recorded under a fixed key (AccountKeyValue 'migration:chain-gates-sheet-2026-10-26'),
 * so a kit Jonathan later edits stays as he left it. Saved quotes are not
 * touched: they keep the prices and pull sheets they were saved with.
 *
 * Runs after the chain link dig set steps (index.ts), in one transaction
 * holding the company's Settings and Inventory rows (lockAccountState), and
 * saves Inventory with its version raised, so a browser holding an older copy merges.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'

export const CHAIN_GATES_KEY = 'migration:chain-gates-sheet-2026-10-26'

export interface ChainGatesResult { updated: string[]; skipped: string[] }

export async function ensureChainGateKits(accountId: string): Promise<ChainGatesResult | null> {
  const m = await pricingModule()
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'chain-gates:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: CHAIN_GATES_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    // No Inventory yet: no saved kits, and nothing recorded, so it applies once there is one.
    if (!inv) return null
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    const plan = m.planChainGateKits({
      fenceStyles: Array.isArray(cfg.fenceStyles) ? cfg.fenceStyles : [],
      items: Array.isArray(inv.items) ? inv.items : [], kits: Array.isArray(inv.kits) ? inv.kits : [],
    })
    if (plan.updated.length) {
      await tx.inventoryState.update({ where: { accountId }, data: { kits: plan.state.kits as any, version: { increment: 1 } } })
    }
    const out: ChainGatesResult = { updated: plan.updated, skipped: plan.skipped }
    await tx.accountKeyValue.create({ data: { accountId, key: CHAIN_GATES_KEY, value: { at: new Date().toISOString(), ...out } as any } })
    return out
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureChainGateKitsAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureChainGateKits(r.accountId)
      if (out && (out.updated.length || out.skipped.length)) {
        console.log(`[chain link] ${r.accountId}: gate kits follow the takeoff sheet on ${out.updated.length} saved kits${out.skipped.length ? `; left as they were: ${out.skipped.join('; ')}` : ''}`)
      }
    } catch (err) { console.error('[chain link] gate kits failed:', err) }
  }
}
