/**
 * Commercial and industrial pricing is on hold (Oct 2026). These five styles
 * are made not available for quoting (fence style `quotable: false`) once per
 * company, ever: the change is recorded with the company under a fixed key
 * (AccountKeyValue 'migration:styles-on-hold-2026-10'), so after Jonathan
 * turns one back on in Settings → Fence Styles it stays on.
 *
 * One transaction holds a lock for the company; the settings record is saved
 * with its version raised, so a browser holding the older copy merges.
 */

import prisma from './prisma.js'

export const STYLES_ON_HOLD = ["CL - Com 6'", "CL - Com 6'+1'", "CL - Com 6'+1' Black", 'Alum - DS - Ind Abigail', 'Durafence'] as const
export const STYLES_ON_HOLD_KEY = 'migration:styles-on-hold-2026-10'

/** Settings' fence styles with the five on hold; the same list when none is there or all are already off. */
export function holdStyles(styles: unknown[]): { styles: unknown[]; changed: string[] } {
  const changed: string[] = []
  const out = styles.map(s => {
    const st = s as { name?: unknown; quotable?: unknown }
    if (!st || typeof st !== 'object' || typeof st.name !== 'string' || !(STYLES_ON_HOLD as readonly string[]).includes(st.name)) return s
    if (st.quotable === false) return s
    changed.push(st.name)
    return { ...st, quotable: false }
  })
  return { styles: changed.length ? out : styles, changed }
}

/** Put the five styles on hold for one company, once. Returns the styles changed (none on every later run). */
export async function ensureStylesOnHold(accountId: string): Promise<string[]> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'styles-on-hold:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: STYLES_ON_HOLD_KEY } } })
    if (done) return []
    const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true, version: true } })
    const cfg = (b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {}) as Record<string, unknown>
    // No saved styles yet: nothing to change, and nothing recorded, so it applies once they are saved.
    if (!b || !Array.isArray(cfg.fenceStyles) || cfg.fenceStyles.length === 0) return []
    const { styles, changed } = holdStyles(cfg.fenceStyles)
    if (changed.length) {
      await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceStyles: styles } as any, version: { increment: 1 } } })
    }
    await tx.accountKeyValue.create({ data: { accountId, key: STYLES_ON_HOLD_KEY, value: { at: new Date().toISOString(), changed } } })
    return changed
  }, { timeout: 15_000 })
}

/** At server start: every company with saved settings. */
export async function ensureStylesOnHoldAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const changed = await ensureStylesOnHold(r.accountId)
      if (changed.length) console.log(`[styles] on hold for quoting (${r.accountId}): ${changed.join(', ')}`)
    } catch (err) { console.error('[styles] could not put commercial and industrial on hold:', err) }
  }
}
