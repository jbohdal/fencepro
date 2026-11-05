/**
 * Two tone vinyl (Jonathan, Nov 5 2026; web/src/twoTone.ts): the two tone
 * material and a fence for every frame and infill pair of the per piece vinyl
 * colors on for quoting, each size and set method, copying the frame fence's
 * labor and Target Profit. Kept in step at every server start (each deploy):
 * a new color gets its pairs; a color no longer usable has its choice
 * archived, its fences kept (held). A fence already there is left as Jonathan
 * set it. (Not inside a Vinyl Colors save: Undo leaves Settings exactly as
 * they were.)
 *
 * One transaction holds a lock for the company; Settings are saved with the
 * version raised, so a browser holding an older copy merges.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'

export async function ensureTwoTone(accountId: string, tx0?: any): Promise<{ added: string[]; catalog: boolean } | null> {
  const m = await pricingModule() as any
  const run = async (tx: any) => {
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : null) as Record<string, any> | null
    if (!cfg || !Array.isArray(cfg.fenceStyles) || !cfg.fenceStyles.length || !cfg.fenceCatalog) return null
    const plan = m.planTwoToneFor(cfg)
    if (plan.added.length || plan.catalog) {
      await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceStyles: plan.config.fenceStyles, fenceCatalog: plan.config.fenceCatalog } as any, version: { increment: 1 } } })
    }
    return { added: plan.added, catalog: plan.catalog }
  }
  return tx0 ? run(tx0) : prisma.$transaction(run, { timeout: 20_000 })
}

/** At server start: every company with saved settings. */
export async function ensureTwoToneAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const out = await ensureTwoTone(r.accountId)
      if (out?.added.length) console.log(`[two tone] ${out.added.length} two tone fences added for ${r.accountId}`)
    } catch (err) { console.error('[two tone] could not keep two tone in step:', err) }
  }
}
