/**
 * The old Staging sheet (AccountKeyValue 'fencepro_staging') is gone from the
 * app (Oct 2026): sold jobs live in Jobs and move through Settings >
 * Operations Stages. Once per company, an empty sheet row is removed. A sheet
 * that still holds anything is kept as it is and a warning is logged, so
 * nothing is lost. Recorded under STAGING_SHEET_CLEANUP_KEY either way.
 */

import prisma from './prisma.js'

export const STAGING_SHEET_KEY = 'fencepro_staging'
export const STAGING_SHEET_CLEANUP_KEY = 'migration:staging-sheet-removed-2026-10'

/** True for a sheet with nothing in it: no value, an empty list, or an empty text. */
export function isEmptySheet(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'string') {
    const t = value.trim()
    if (t === '' || t === 'null') return true
    try { const v = JSON.parse(t); return Array.isArray(v) && v.length === 0 } catch { return false }
  }
  return false
}

export type StagingSheetStep = 'none' | 'removed' | 'kept'

/** For one company, once. Null when it was already done. */
export async function ensureStagingSheetRemoved(accountId: string): Promise<StagingSheetStep | null> {
  return prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'staging-sheet:' + accountId}))`
    const done = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: STAGING_SHEET_CLEANUP_KEY } } })
    if (done) return null
    const row = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: STAGING_SHEET_KEY } } })
    let step: StagingSheetStep = 'none'
    if (row) {
      if (isEmptySheet(row.value)) {
        await tx.accountKeyValue.delete({ where: { accountId_key: { accountId, key: STAGING_SHEET_KEY } } })
        step = 'removed'
      } else {
        step = 'kept'
      }
    }
    await tx.accountKeyValue.create({ data: { accountId, key: STAGING_SHEET_CLEANUP_KEY, value: { at: new Date().toISOString(), step } } })
    return step
  }, { timeout: 15_000 })
}

/** At server start: every company with saved settings. */
export async function ensureStagingSheetRemovedAll(): Promise<void> {
  const rows = await prisma.businessState.findMany({ select: { accountId: true } })
  for (const r of rows) {
    try {
      const step = await ensureStagingSheetRemoved(r.accountId)
      if (step === 'removed') console.log(`[staging] ${r.accountId}: empty old Staging sheet removed`)
      else if (step === 'kept') console.warn(`[staging] ${r.accountId}: the old Staging sheet (${STAGING_SHEET_KEY}) still has rows; kept as it is, not shown in the app`)
      else if (step === 'none') console.log(`[staging] ${r.accountId}: no old Staging sheet`)
    } catch (err) { console.error('[staging] old sheet check failed:', err) }
  }
}
