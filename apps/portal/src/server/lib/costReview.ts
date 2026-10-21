/**
 * "Needs cost review" on a fence style (Settings fence style `needsCostReview`).
 *
 * WV-ND Bell 4'x6' is priced as a 6'x6' vinyl privacy section for now (same
 * pickets, rails, U trim and 78" posts), not with the $154.34 "Misc, 6'
 * Section" placeholder. Jonathan, Oct 21, 2026: "Flag WV-ND Bell 4'x6'
 * needsCostReview so I'm reminded to enter the real supplier cost."
 *
 * Set once per company, ever: recorded under a fixed key (AccountKeyValue
 * 'migration:bell-cost-review-2026-10'), so once the flag clears it is never
 * set again. The reminder shows on the Finish setup list and as a badge on
 * the style in Settings → Fence styles.
 *
 * The real cost is entered the way every style's own parts are: Inventory >
 * Material Kits, the Bell's kits (its section, and each gate leaf's section
 * parts), with the part's cost in the Catalog. When a company's saved kit set
 * for a flagged style is made or changed, the flag clears (clearCostReviewOnKitSave).
 */

import prisma from './prisma.js'
import { lockAccountState } from './lockState.js'

export const COST_REVIEW_STYLES = ["WV-ND Bell 4'x6'"] as const
export const COST_REVIEW_KEY = 'migration:bell-cost-review-2026-10'

type Style = { name?: unknown; needsCostReview?: unknown }

/** Settings' fence styles with the flag set on the listed styles; the same list when none is there or all are flagged. */
export function flagStyles(styles: unknown[], names: readonly string[] = COST_REVIEW_STYLES): { styles: unknown[]; changed: string[] } {
  const changed: string[] = []
  const out = styles.map(s => {
    const st = s as Style
    if (!st || typeof st !== 'object' || typeof st.name !== 'string' || !names.includes(st.name)) return s
    if (st.needsCostReview === true) return s
    changed.push(st.name)
    return { ...st, needsCostReview: true }
  })
  return { styles: changed.length ? out : styles, changed }
}

/** Flag the Bell for one company, once. Returns the styles flagged (none on every later run). */
export async function ensureCostReview(accountId: string): Promise<string[]> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'cost-review:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: COST_REVIEW_KEY } } })
    if (done) return []
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    // No saved styles yet: nothing to change, and nothing recorded, so it applies once they are saved.
    if (!b || !Array.isArray(cfg.fenceStyles) || cfg.fenceStyles.length === 0) return []
    const { styles, changed } = flagStyles(cfg.fenceStyles)
    if (changed.length) {
      await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceStyles: styles } as any, version: { increment: 1 } } })
    }
    await tx.accountKeyValue.create({ data: { accountId, key: COST_REVIEW_KEY, value: { at: new Date().toISOString(), changed } } })
    return changed
  }, { timeout: 15_000 })
}

/** At server start: every company with saved settings. */
export async function ensureCostReviewAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const changed = await ensureCostReview(r.accountId)
      if (changed.length) console.log(`[cost review] flagged (${r.accountId}): ${changed.join(', ')}`)
    } catch (err) { console.error('[cost review] could not flag the Bell:', err) }
  }
}

type Kit = { id?: unknown; styleName?: unknown; archived?: unknown }

/** The style's saved kit set in use (not archived), as JSON, or '' when it has none. */
const activeSet = (kits: unknown, style: string): string => {
  const set = (Array.isArray(kits) ? kits : []).find((k: Kit) => k && k.styleName === style && !k.archived)
  return set ? JSON.stringify(set) : ''
}

/** Flagged styles whose saved kit set in use was made or changed between two Inventory copies. */
export function kitsEditedFor(flagged: string[], before: unknown, after: unknown): string[] {
  return flagged.filter(name => { const a = activeSet(after, name); return !!a && a !== activeSet(before, name) })
}

/**
 * After an Inventory save: clear the flag on each flagged style whose saved
 * kit set in use was made or changed. Settings' version goes up, so an open
 * screen with the older copy merges. Returns the styles cleared.
 */
export async function clearCostReviewOnKitSave(accountId: string, before: unknown, after: unknown): Promise<string[]> {
  return prisma.$transaction(async tx => {
    await lockAccountState(tx, accountId)
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    const styles = Array.isArray(cfg.fenceStyles) ? cfg.fenceStyles as Style[] : []
    const flagged = styles.filter(s => s && s.needsCostReview === true && typeof s.name === 'string').map(s => s.name as string)
    const cleared = kitsEditedFor(flagged, before, after)
    if (!cleared.length) return []
    const next = styles.map(s => {
      if (!s || typeof s.name !== 'string' || !cleared.includes(s.name)) return s
      const { needsCostReview: _drop, costReviewNote: _note, ...rest } = s as Style & { costReviewNote?: unknown }
      return rest
    })
    await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceStyles: next } as any, version: { increment: 1 } } })
    return cleared
  }, { timeout: 15_000 })
}
