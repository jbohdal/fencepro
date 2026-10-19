/**
 * Wood privacy fence (web/src/wood.ts): the four wood styles, the wood
 * material in a saved choice tree, a wood material kit per style and the wood
 * parts in Inventory (named, no price: wood is priced from white vinyl × the
 * Wood factor, so their cost is never used). Added once per company, ever:
 * recorded under a fixed key (AccountKeyValue 'migration:wood-styles-2026-10'),
 * so a wood style Jonathan later turns off or edits stays as he left it.
 *
 * One transaction holds a lock for the company; Settings and Inventory are
 * saved with their versions raised, so a browser holding an older copy merges.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'

export const WOOD_KEY = 'migration:wood-styles-2026-10'
// Once more, for companies where the first run's additions were saved over
// (live, Oct 19, 2026: the chain link dig set step ran at the same moment and
// saved Settings and Inventory without them). It only adds what is missing,
// so where wood is already there it changes nothing.
export const WOOD_RESTORE_KEY = 'migration:wood-styles-2026-10-restore'

export async function ensureWood(accountId: string): Promise<{ styles: string[]; items: string[]; kits: string[]; catalog: boolean } | null> {
  const m = await pricingModule()
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'wood-styles:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: WOOD_KEY } } })
    const restored = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: WOOD_RESTORE_KEY } } })
    if (done && restored) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    // No saved styles yet: nothing to add to, and nothing recorded, so it applies once they are saved.
    if (!b || !Array.isArray(cfg.fenceStyles) || cfg.fenceStyles.length === 0) return null
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    if (!inv) return null
    const plan = m.planWood({
      fenceStyles: cfg.fenceStyles, fenceCatalog: cfg.fenceCatalog ?? null,
      items: Array.isArray(inv.items) ? inv.items : [], kits: Array.isArray(inv.kits) ? inv.kits : [],
    })
    if (plan.styles.length || plan.catalog) {
      const next: Record<string, unknown> = { ...cfg, fenceStyles: plan.state.fenceStyles }
      if (plan.catalog) next.fenceCatalog = plan.state.fenceCatalog
      await tx.businessState.update({ where: { accountId }, data: { config: next as any, version: { increment: 1 } } })
    }
    if (plan.items.length || plan.kits.length) {
      await tx.inventoryState.update({ where: { accountId }, data: { items: plan.state.items as any, kits: plan.state.kits as any, version: { increment: 1 } } })
    }
    const out = { styles: plan.styles, items: plan.items, kits: plan.kits, catalog: plan.catalog }
    const value = { at: new Date().toISOString(), ...out }
    if (!done) await tx.accountKeyValue.create({ data: { accountId, key: WOOD_KEY, value } })
    await tx.accountKeyValue.create({ data: { accountId, key: WOOD_RESTORE_KEY, value } })
    return out
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureWoodAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureWood(r.accountId)
      if (out && (out.styles.length || out.items.length)) console.log(`[wood] added for ${r.accountId}: ${out.styles.length} styles, ${out.kits.length} kits, ${out.items.length} unpriced wood parts in Inventory`)
    } catch (err) { console.error('[wood] could not add wood styles:', err) }
  }
}
