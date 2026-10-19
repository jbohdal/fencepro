/**
 * Chain link dig set (web/src/chainDigSet.ts): the Install choice in a saved
 * choice tree, a Dig set twin of each residential chain link style, its kits
 * (no dig kits with new unpriced dig set post parts and concrete) and the new
 * post parts in Inventory with no price. Added once per company, ever:
 * recorded under a fixed key (AccountKeyValue 'migration:chain-dig-set-2026-10'),
 * so a dig set style or part Jonathan later edits or removes stays as he left it.
 * The existing chain link styles are not touched: they are the No dig choice,
 * same internal names, same prices.
 *
 * One transaction holds a lock for the company; Settings and Inventory are
 * saved with their versions raised, so a browser holding an older copy merges.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'

export const CHAIN_DS_KEY = 'migration:chain-dig-set-2026-10'

export async function ensureChainDigSet(accountId: string): Promise<{ styles: string[]; items: string[]; kits: string[]; catalog: boolean } | null> {
  const m = await pricingModule()
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'chain-dig-set:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: CHAIN_DS_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    // No saved styles yet: nothing to add to, and nothing recorded, so it applies once they are saved.
    if (!b || !Array.isArray(cfg.fenceStyles) || cfg.fenceStyles.length === 0) return null
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    if (!inv) return null
    const plan = m.planChainDigSet({
      fenceStyles: cfg.fenceStyles, fenceCatalog: cfg.fenceCatalog ?? null,
      items: Array.isArray(inv.items) ? inv.items : [], kits: Array.isArray(inv.kits) ? inv.kits : [],
    })
    const stylesChanged = JSON.stringify(plan.state.fenceStyles) !== JSON.stringify(cfg.fenceStyles)
    if (stylesChanged || plan.catalog) {
      const next: Record<string, unknown> = { ...cfg, fenceStyles: plan.state.fenceStyles }
      if (plan.catalog) next.fenceCatalog = plan.state.fenceCatalog
      await tx.businessState.update({ where: { accountId }, data: { config: next as any, version: { increment: 1 } } })
    }
    if (plan.items.length || plan.kits.length) {
      await tx.inventoryState.update({ where: { accountId }, data: { items: plan.state.items as any, kits: plan.state.kits as any, version: { increment: 1 } } })
    }
    const out = { styles: plan.styles, items: plan.items, kits: plan.kits, catalog: plan.catalog }
    await tx.accountKeyValue.create({ data: { accountId, key: CHAIN_DS_KEY, value: { at: new Date().toISOString(), ...out, concrete: plan.concrete } as any } })
    return out
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureChainDigSetAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureChainDigSet(r.accountId)
      if (out && (out.styles.length || out.catalog)) console.log(`[chain link] dig set added for ${r.accountId}: ${out.styles.length} styles, ${out.kits.length} kits, ${out.items.length} unpriced post parts in Inventory`)
    } catch (err) { console.error('[chain link] could not add the dig set:', err) }
  }
}
