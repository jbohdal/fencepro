/**
 * Tan 8 ft tall vinyl (Jonathan, Oct 29, 2026: "OK Tan 8 ft."): adds the four
 * Tan styles TV-ND / TV-DS 8'x6' and 8'x8' to a company's saved fence styles
 * (web/src/tanTall.ts), with the settings of its own matching White 8 ft
 * style. They are priced by the piece and held from quoting until Jonathan
 * types their section and post costs in Settings → Price List → 8 ft tall
 * vinyl; no price is copied. With them, the Tan 8 ft section parts Inventory
 * has no item for (4 ft pickets, 4 ft U channels, 6 and 8 ft mid rails) are
 * made at $0, included in the section price, as the White ones were
 * (web/src/tanTall.ts planTanTallParts; only for the styles added here, and
 * never a rail, which 6 ft fences price from Inventory).
 *
 * Added once per company, ever: recorded under a fixed key (AccountKeyValue
 * 'migration:tan-tall-vinyl-2026-10-29'), so if Jonathan later edits or
 * removes a style it stays as he left it. Nothing else in Settings, the
 * choice tree, Inventory or the kits is touched; saved quotes are not touched.
 *
 * One transaction holds the company's Settings and Inventory rows; both are
 * saved with their version raised, so a browser holding an older copy merges.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'

export const TAN_TALL_KEY = 'migration:tan-tall-vinyl-2026-10-29'

export interface TanTallOut { added: string[]; copiedFrom: Record<string, string>; parts: string[] }

export async function ensureTanTall(accountId: string): Promise<TanTallOut | null> {
  const m = await pricingModule()
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'tan-tall:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: TAN_TALL_KEY } } })
    if (done) return null
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    // No saved styles yet: the defaults already have them; nothing recorded, so it applies once styles are saved.
    if (!b || !Array.isArray(cfg.fenceStyles) || cfg.fenceStyles.length === 0) return null
    const plan = m.planTanTall(cfg.fenceStyles)
    let parts: string[] = []
    if (plan.added.length) {
      await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceStyles: plan.fenceStyles } as any, version: { increment: 1 } } })
      const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
      if (inv) {
        const p = m.planTanTallParts({ fenceStyles: plan.fenceStyles, items: Array.isArray(inv.items) ? inv.items : [], kits: Array.isArray(inv.kits) ? inv.kits : [] }, plan.added)
        if (p.added.length) await tx.inventoryState.update({ where: { accountId }, data: { items: p.items as any, version: { increment: 1 } } })
        parts = p.added
      }
    }
    const out: TanTallOut = { added: plan.added, copiedFrom: plan.copiedFrom, parts }
    await tx.accountKeyValue.create({ data: { accountId, key: TAN_TALL_KEY, value: { at: new Date().toISOString(), ...out } as any } })
    return out
  }, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureTanTallAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureTanTall(r.accountId)
      if (out?.added.length) {
        console.log(`[tan 8 ft tall] ${r.accountId}: added ${out.added.map(n => `${n} (settings from ${out.copiedFrom[n]})`).join('; ')}; held until their section and post costs are typed`)
        if (out.parts.length) console.log(`[tan 8 ft tall] ${r.accountId}: ${out.parts.length} section parts added at $0 (included in the section price): ${out.parts.join('; ')}`)
      } else if (out) console.log(`[tan 8 ft tall] ${r.accountId}: already in Settings, nothing added`)
    } catch (err) { console.error('[tan 8 ft tall] could not add the styles:', err) }
  }
}
