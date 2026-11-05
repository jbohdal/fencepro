/**
 * Farm fence (Jonathan, Nov 5 2026; web/src/farm.ts): adds the farm material
 * to a saved choice tree, its 18 styles, a kit each and its parts to
 * Inventory (shelf prices + 7.22% estimated tax, TSC item numbers, the 6"
 * post's quantity break; staples, screws, brace parts, the hinge set and a
 * 5 ft gate at $0 for him to price). Anything already there is kept as it is.
 * Added once per company, ever (AccountKeyValue 'migration:farm-fence-2026-11'),
 * so what Jonathan later edits or removes stays as he left it. Each priced
 * part gets a dated price history row (source 'farm_fence'), as the Vinyl
 * Colors form writes them.
 *
 * One transaction holds a lock for the company; Settings and Inventory are
 * saved with their versions raised, so a browser holding an older copy merges.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'

export const FARM_KEY = 'migration:farm-fence-2026-11'

export async function ensureFarm(accountId: string): Promise<{ styles: string[]; items: string[]; kits: string[]; catalog: boolean } | null> {
  const m = await pricingModule() as any
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'farm-fence:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: FARM_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    // No saved styles yet: nothing to add to, and nothing recorded, so it applies once they are saved.
    if (!b || !Array.isArray(cfg.fenceStyles) || cfg.fenceStyles.length === 0) return null
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    if (!inv) return null
    const items = Array.isArray(inv.items) ? inv.items as any[] : []
    const plan = m.planFarm({ fenceStyles: cfg.fenceStyles, fenceCatalog: cfg.fenceCatalog ?? null, items, kits: Array.isArray(inv.kits) ? inv.kits : [] })
    if (plan.styles.length || plan.catalog) {
      const next: Record<string, unknown> = { ...cfg, fenceStyles: plan.state.fenceStyles }
      if (plan.catalog) next.fenceCatalog = plan.state.fenceCatalog
      await tx.businessState.update({ where: { accountId }, data: { config: next as any, version: { increment: 1 } } })
    }
    if (plan.items.length || plan.kits.length) {
      await tx.inventoryState.update({ where: { accountId }, data: { items: plan.state.items as any, kits: plan.state.kits as any, version: { increment: 1 } } })
    }
    // A dated cost for each part added with a price.
    for (const it of plan.state.items as any[]) {
      if (!plan.items.includes(it.name) || !(it.unitCost > 0)) continue
      const c = Math.round(it.unitCost * 100)
      await tx.priceHistory.create({ data: {
        accountId, inventoryItemId: it.id, vendorName: it.supplier ?? '', day: it.priceUpdatedAt ?? new Date().toISOString().slice(0, 10), unitLandedCents: c, unitLandedExact: c,
        prevUnitCents: null, prevPriceUpdatedAt: null, prevPriceImported: null, appliedById: null, appliedBy: 'Farm fence (shelf price + 7.22% estimated tax)', approved: true, changedInventory: true, source: 'farm_fence',
      } })
    }
    const out = { styles: plan.styles, items: plan.items, kits: plan.kits, catalog: plan.catalog }
    await tx.accountKeyValue.create({ data: { accountId, key: FARM_KEY, value: { at: new Date().toISOString(), ...out } as any } })
    return out
  }, { timeout: 30_000 })
}

export const FARM_GATES_KEY = 'migration:farm-gates-2026-11'

/** Once per company: the gate kit lines taken off farm kits (gates go by opening width, Nov 5 2026; web farm.ts planFarmGates). */
export async function ensureFarmGates(accountId: string): Promise<string[] | null> {
  const m = await pricingModule() as any
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'farm-gates:' + accountId}))`
    if (await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: FARM_GATES_KEY } } })) return null
    await lockAccountState(tx, accountId)
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { kits: true } })
    if (!inv) return null
    const plan = m.planFarmGates(Array.isArray(inv.kits) ? inv.kits : [])
    if (plan.changed.length) await tx.inventoryState.update({ where: { accountId }, data: { kits: plan.kits as any, version: { increment: 1 } } })
    await tx.accountKeyValue.create({ data: { accountId, key: FARM_GATES_KEY, value: { at: new Date().toISOString(), kits: plan.changed } as any } })
    return plan.changed
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureFarmAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureFarm(r.accountId)
      if (out && (out.styles.length || out.items.length)) console.log(`[farm fence] added for ${r.accountId}: ${out.styles.length} styles, ${out.kits.length} kits, ${out.items.length} parts`)
    } catch (err) { console.error('[farm fence] could not add farm fence:', err) }
    try {
      const gates = await ensureFarmGates(r.accountId)
      if (gates?.length) console.log(`[farm fence] gate kit lines taken off ${gates.length} farm kits for ${r.accountId} (gates go by opening width)`)
    } catch (err) { console.error('[farm fence] could not update the farm gate kits:', err) }
  }
}
