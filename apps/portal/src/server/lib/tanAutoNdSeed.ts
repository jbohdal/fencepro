/**
 * Tan no dig, 6 or 8 ft sections (best price): adds "TV-Auto ND Privacy" to a
 * company's saved fence styles (web/src/tanAutoNd.ts), with the settings of
 * its own TV-ND 6'x6' style. Added once per company, ever: recorded under a
 * fixed key (AccountKeyValue 'migration:tan-auto-nd-2026-11'), so if Jonathan
 * later edits or removes the style it stays as he left it. Existing styles,
 * the choice tree, Inventory and the kits are not touched (the style uses its
 * built in kit set, from the TV-ND 6'x6' and 6'x8' parts lists).
 *
 * One transaction holds a lock for the company; Settings are saved with the
 * version raised, so a browser holding an older copy merges.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'

export const TAN_AUTO_ND_KEY = 'migration:tan-auto-nd-2026-11'

export async function ensureTanAutoNd(accountId: string): Promise<{ added: string | null; copiedFrom: string | null; skipped?: string } | null> {
  const m = await pricingModule()
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tan-auto-nd:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: TAN_AUTO_ND_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    // No saved styles yet: the defaults already have it; nothing recorded, so it applies once styles are saved.
    if (!b || !Array.isArray(cfg.fenceStyles) || cfg.fenceStyles.length === 0) return null
    const plan = m.planTanAutoNd(cfg.fenceStyles)
    if (plan.added) {
      await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceStyles: plan.fenceStyles } as any, version: { increment: 1 } } })
    }
    const out = { added: plan.added, copiedFrom: plan.copiedFrom, ...(plan.skipped ? { skipped: plan.skipped } : {}) }
    await tx.accountKeyValue.create({ data: { accountId, key: TAN_AUTO_ND_KEY, value: { at: new Date().toISOString(), ...out } as any } })
    return out
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureTanAutoNdAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureTanAutoNd(r.accountId)
      if (out?.added) console.log(`[tan no dig] ${out.added} added for ${r.accountId} (settings from ${out.copiedFrom})`)
      else if (out?.skipped) console.log(`[tan no dig] not added for ${r.accountId}: ${out.skipped}`)
    } catch (err) { console.error('[tan no dig] could not add the 6/8 ft mix:', err) }
  }
}
