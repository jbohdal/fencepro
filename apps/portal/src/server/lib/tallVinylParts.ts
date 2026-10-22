/**
 * 8 ft tall vinyl, Oct 21, 2026 (web/src/tallVinylParts.ts): an 8 ft tall
 * section is listed by its parts and priced by the piece, so the parts
 * Inventory has no item for (each color's 4 ft picket, 4 ft U channel and 6 /
 * 8 ft mid rail) are made as catalog items at $0, marked as included in the 8
 * ft tall section price. Done once per company, ever: recorded under a fixed
 * key (AccountKeyValue 'migration:tall-vinyl-parts-2026-10'), so an item
 * Jonathan later renames or removes stays as he left it. Nothing else in
 * Inventory, the kits or Settings is touched; saved quotes are not touched.
 *
 * One transaction holding the company's Settings and Inventory rows
 * (lockAccountState); Inventory is saved with its version raised, so a
 * browser holding an older copy merges.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'

export const TALL_VINYL_PARTS_KEY = 'migration:tall-vinyl-parts-2026-10'

export async function ensureTallVinylParts(accountId: string): Promise<{ added: string[] } | null> {
  const m = await pricingModule()
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tall-vinyl-parts:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: TALL_VINYL_PARTS_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    // No saved styles or Inventory yet: nothing recorded, so it applies once they are there.
    if (!inv || !Array.isArray(cfg.fenceStyles) || cfg.fenceStyles.length === 0) return null
    const plan = m.planTallVinylParts({
      fenceStyles: cfg.fenceStyles, items: Array.isArray(inv.items) ? inv.items : [], kits: Array.isArray(inv.kits) ? inv.kits : [],
    })
    if (plan.added.length) {
      await tx.inventoryState.update({ where: { accountId }, data: { items: plan.items as any, version: { increment: 1 } } })
    }
    await tx.accountKeyValue.create({ data: { accountId, key: TALL_VINYL_PARTS_KEY, value: { at: new Date().toISOString(), added: plan.added } as any } })
    return { added: plan.added }
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureTallVinylPartsAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureTallVinylParts(r.accountId)
      if (out?.added.length) console.log(`[8 ft tall vinyl] ${r.accountId}: ${out.added.length} section parts added at $0 (included in the section price): ${out.added.join('; ')}`)
    } catch (err) { console.error('[8 ft tall vinyl] could not add the section parts:', err) }
  }
}
