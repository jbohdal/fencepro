/**
 * Wood privacy fence (web/src/wood.ts).
 *
 * ensureWood: the wood styles, the wood material in a saved choice tree, and
 * (since Oct 30 2026) the six real wood styles (Stockade, Board on Board,
 * Shadow Box, each with PT Pine or Alta Premium pickets) with their kits and
 * parts in Inventory. Added once per company, ever: recorded under a fixed key
 * (AccountKeyValue 'migration:wood-styles-2026-10'), so a wood style Jonathan
 * later turns off or edits stays as he left it. It never makes a renamed
 * vinyl part or kit any more.
 *
 * ensureWoodRealKits (Oct 30 2026, 'migration:wood-real-kits-2026-10-30'):
 * once per company, after ensureWood. Archives (never deletes) the white
 * vinyl parts renamed as wood on Oct 19 and the kits made from them, adds the
 * six real wood styles, their kits and their new parts at Jonathan's costs
 * (wood.ts WOOD_PARTS: every part priced, so wood quotes at once), adds
 * the styles and picket grades to the choice tree and archives
 * wood's Privacy, No dig and 6 ft panel choices, and turns the wood material
 * back on (its parts' prices hold it until they are typed). If Jonathan turns wood off again afterwards, it
 * stays off: this never runs twice.
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
      if (out && (out.styles.length || out.items.length)) console.log(`[wood] added for ${r.accountId}: ${out.styles.length} styles, ${out.kits.length} kits, ${out.items.length} wood parts in Inventory at $0`)
    } catch (err) { console.error('[wood] could not add wood styles:', err) }
  }
}

export const WOOD_REAL_KEY = 'migration:wood-real-kits-2026-10-30'

export interface WoodRealOut { archivedItems: string[]; archivedKits: string[]; addedStyles: string[]; addedKits: string[]; addedItems: string[]; catalog: string[] }

export async function ensureWoodRealKits(accountId: string): Promise<WoodRealOut | null> {
  const m = await pricingModule()
  return prisma.$transaction(async tx => {
    // The same lock as ensureWood: the two never run side by side for a company.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'wood-styles:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: WOOD_REAL_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    // No saved styles yet: nothing recorded, so it applies once they are saved (ensureWood adds the real wood then anyway).
    if (!b || !Array.isArray(cfg.fenceStyles) || cfg.fenceStyles.length === 0) return null
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    if (!inv) return null
    const plan = m.planWoodRealKits({
      fenceStyles: cfg.fenceStyles, fenceCatalog: cfg.fenceCatalog ?? null,
      items: Array.isArray(inv.items) ? inv.items : [], kits: Array.isArray(inv.kits) ? inv.kits : [],
    })
    if (plan.catalog.length || plan.addedStyles.length) {
      const next: Record<string, unknown> = { ...cfg, fenceStyles: plan.state.fenceStyles }
      if (plan.catalog.length) next.fenceCatalog = plan.state.fenceCatalog
      await tx.businessState.update({ where: { accountId }, data: { config: next as any, version: { increment: 1 } } })
    }
    if (plan.archivedItems.length || plan.archivedKits.length || plan.addedKits.length || plan.addedItems.length) {
      await tx.inventoryState.update({ where: { accountId }, data: { items: plan.state.items as any, kits: plan.state.kits as any, version: { increment: 1 } } })
    }
    const out: WoodRealOut = { archivedItems: plan.archivedItems, archivedKits: plan.archivedKits, addedStyles: plan.addedStyles, addedKits: plan.addedKits, addedItems: plan.addedItems, catalog: plan.catalog }
    await tx.accountKeyValue.create({ data: { accountId, key: WOOD_REAL_KEY, value: { at: new Date().toISOString(), ...out } as any } })
    return out
  }, { timeout: 20_000 })
}

/** At server start, after ensureWoodAll: every company with saved settings. */
export async function ensureWoodRealKitsAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureWoodRealKits(r.accountId)
      if (out) console.log(`[wood] real kits for ${r.accountId}: ${out.archivedItems.length} renamed vinyl parts and ${out.archivedKits.length} kits archived; ${out.addedStyles.length} styles and ${out.addedKits.length} kits added, ${out.addedItems.length} new parts${out.catalog.length ? `; ${out.catalog.join('; ')}` : ''}`)
    } catch (err) { console.error('[wood] could not add the real wood kits:', err) }
  }
}
