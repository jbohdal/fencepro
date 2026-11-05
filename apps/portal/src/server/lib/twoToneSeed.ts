/**
 * Two tone vinyl (Jonathan, Nov 5 2026; web/src/twoTone.ts): the two tone
 * material and a fence for every frame and infill pair of the per piece vinyl
 * colors on for quoting, each size and set method, copying the frame fence's
 * labor and Target Profit. Kept in step at every server start and inside
 * every Vinyl Colors save, archive and bring back (lib/vinylColors.ts): a new
 * color, or one switched to per piece, gets its pairs at once; a color no
 * longer usable has its choice archived, its fences kept (held). The color's
 * record keeps what its adding made here (the two tone material before, the
 * fences added), so Undo takes exactly that away (undoTwoTone).
 *
 * One transaction holds a lock for the company; Settings are saved with the
 * version raised, so a browser holding an older copy merges.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'

export interface TwoToneResult { added: string[]; catalog: boolean; /** The two tone material before this step (null: none). */ before: unknown }

export async function ensureTwoTone(accountId: string, tx0?: any): Promise<TwoToneResult | null> {
  const m = await pricingModule() as any
  const run = async (tx: any) => {
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : null) as Record<string, any> | null
    if (!cfg || !Array.isArray(cfg.fenceStyles) || !cfg.fenceStyles.length || !cfg.fenceCatalog) return null
    const before = JSON.parse(JSON.stringify((cfg.fenceCatalog.materials ?? []).find((x: any) => x?.key === 'twotone') ?? null))
    const plan = m.planTwoToneFor(cfg)
    if (plan.added.length || plan.catalog || plan.cleaned) {
      await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceStyles: plan.config.fenceStyles, fenceCatalog: plan.config.fenceCatalog } as any, version: { increment: 1 } } })
    }
    return { added: plan.added, catalog: plan.catalog, before }
  }
  return tx0 ? run(tx0) : prisma.$transaction(run, { timeout: 20_000 })
}

/**
 * Undo of a color's adding (lib/vinylColors.ts undoVinylColor), in its
 * transaction: the two tone fences of that color and those its adding made are
 * taken away, and the two tone material put back as it was before the color
 * (taken away if there was none). `made` is the color record's twoTone.
 */
export async function undoTwoTone(tx: any, accountId: string, key: string, made: { before?: unknown; added?: string[] } | undefined): Promise<string[]> {
  const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const cfg = (b?.config ?? null) as Record<string, any> | null
  if (!cfg || !Array.isArray(cfg.fenceStyles)) return []
  const added = new Set(made?.added ?? [])
  const mine = (s: any) => s?.material === 'twotone' && typeof s.name === 'string' && (added.has(s.name) || s.choices?.frame === key || s.choices?.infill === key)
  const removed = cfg.fenceStyles.filter(mine).map((s: any) => s.name)
  const materials = Array.isArray(cfg.fenceCatalog?.materials) ? [...cfg.fenceCatalog.materials] : null
  if (materials) {
    const at = materials.findIndex((x: any) => x?.key === 'twotone')
    if (made && 'before' in made) {
      if (made.before == null) { if (at >= 0) materials.splice(at, 1) }
      else if (at >= 0) materials[at] = made.before
      else materials.push(made.before)
    } else if (at >= 0) {
      // A color added before two tone kept a record: its choices taken off.
      materials[at] = { ...materials[at], dims: materials[at].dims.map((d: any) => (d.key === 'frame' || d.key === 'infill' ? { ...d, options: d.options.filter((o: any) => o.key !== key) } : d)) }
    }
  }
  if (removed.length || materials) {
    await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceStyles: cfg.fenceStyles.filter((s: any) => !mine(s)), ...(materials ? { fenceCatalog: { ...cfg.fenceCatalog, materials } } : {}) } as any } })
  }
  return removed
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
