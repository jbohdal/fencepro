/**
 * Settings → Price List → Vinyl Colors (web/src/vinylColorForm.ts makes the
 * plan; this file saves it).
 *
 * Add, edit, archive (Remove), bring back and undo a vinyl color, each in one
 * transaction with the company's Settings and Inventory locked
 * (lockAccountState): the color in the choice tree, its fences, material
 * kits and catalog items, and a price history row (source 'color_form') for
 * every cost the form sets. Settings and Inventory are saved with their
 * versions raised, so an open screen with an older copy merges.
 *
 * What a color's adding made is kept under AccountKeyValue
 * 'vinyl-color:<key>' (the "color created" record), so Undo knows exactly
 * what to take away and the confirmation screen can list it. Undo is open
 * for 24 hours and only while no quote or job uses one of its fences (one in
 * Deleted Records does not count); Remove
 * archives, and is refused only while an active quote (not archived or
 * deleted) uses one. Saved quotes keep the pull sheet and prices they were
 * priced with: nothing here touches a quote.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { lockAccountState } from './lockState.js'
import { sameJson } from './permissions.js'

export const COLOR_FORM_SOURCE = 'color_form'
export const UNDO_HOURS = 24
export const recordKey = (key: string) => `vinyl-color:${key}`

export interface ColorActor { accountId: string; userId: string | null; name: string }

export class ColorError extends Error {
  constructor(public status: number, message: string, public extra: Record<string, unknown> = {}) { super(message) }
}

/** YYYY-MM-DD in Ocala. */
export function businessDay(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {})
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** Settings and Inventory, locked for the rest of the transaction. */
async function lockedState(tx: any, accountId: string) {
  await lockAccountState(tx, accountId)
  const b = await tx.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const inv = await tx.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true } })
  if (!b || !inv) throw new ColorError(409, 'Settings or Inventory are not set up for this company yet.')
  const cfg = obj(b.config)
  if (!arr(cfg.fenceStyles).length) throw new ColorError(409, 'There are no fence styles in Settings yet.')
  return { cfg, items: arr(inv.items), kits: arr(inv.kits) }
}

async function saveState(tx: any, accountId: string, cfg: Record<string, any>, state: { fenceStyles: unknown[]; fenceCatalog: unknown; items: unknown[]; kits: unknown[] }, before: { items: unknown[]; kits: unknown[] }) {
  await tx.businessState.update({ where: { accountId }, data: { config: { ...cfg, fenceStyles: state.fenceStyles, fenceCatalog: state.fenceCatalog } as any, version: { increment: 1 } } })
  if (!sameJson(before.items, state.items) || !sameJson(before.kits, state.kits)) {
    await tx.inventoryState.update({ where: { accountId }, data: { items: state.items as any, kits: state.kits as any, version: { increment: 1 } } })
  }
}

async function writeHistory(tx: any, actor: ColorActor, day: string, priced: Array<{ id: string; cents: number; prevCents: number | null }>, prevItems: any[]): Promise<string[]> {
  const ids: string[] = []
  for (const p of priced) {
    const was = prevItems.find(i => i?.id === p.id)
    const row = await tx.priceHistory.create({
      data: {
        accountId: actor.accountId, inventoryItemId: p.id, vendorName: '', day, unitLandedCents: p.cents, unitLandedExact: p.cents,
        prevUnitCents: p.prevCents, prevPriceUpdatedAt: typeof was?.priceUpdatedAt === 'string' ? was.priceUpdatedAt : null,
        prevPriceImported: typeof was?.priceImported === 'boolean' ? was.priceImported : null,
        appliedById: actor.userId, appliedBy: actor.name, approved: true, changedInventory: true, source: COLOR_FORM_SOURCE,
      },
      select: { id: true },
    })
    ids.push(row.id)
  }
  return ids
}

export interface ColorRecord {
  key: string
  label: string
  createdAt: string
  createdBy: string
  undoUntil: string
  /** Settings had no saved choice tree before (the app's own was in use). */
  catalogWasSaved: boolean
  created: {
    items: Array<{ id: string; name: string; cents: number | null; includedIn?: string }>
    priceHistoryIds: string[]
    styles: Array<{ name: string; label: string; madeFrom: string }>
    kits: Array<{ id: string; styleName: string; lines: Record<string, number> }>
    option: { key: string; label: string }
  }
  edits?: Array<{ at: string; by: string; priced: Array<{ name: string; cents: number; prevCents: number | null }>; priceHistoryIds: string[]; added: string[]; archived: string[] }>
  archivedAt?: string | null
  undoneAt?: string | null
}

/** Add a vinyl color from the form (or, with `key`, save the form again for one it made). */
export async function saveVinylColor(actor: ColorActor, input: unknown, key?: string): Promise<{ record: ColorRecord; message: string; priced: number }> {
  const m = await pricingModule() as any
  return prisma.$transaction(async (tx: any) => {
    const { cfg, items, kits } = await lockedState(tx, actor.accountId)
    const day = businessDay()
    const st = { fenceStyles: arr(cfg.fenceStyles), fenceCatalog: m.fenceCatalogOf(cfg), items, kits }
    let plan: any
    try {
      plan = m.planVinylColor(st, input, { today: day, newId: uid, ...(key ? { key } : {}) })
    } catch (err) { throw new ColorError(400, (err as Error).message) }
    await saveState(tx, actor.accountId, cfg, plan.state, { items, kits })
    const historyIds = await writeHistory(tx, actor, day, plan.priced, items)
    const now = new Date()
    const rk = recordKey(plan.key)
    const old = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId: actor.accountId, key: rk } } })
    let record: ColorRecord
    if (!key) {
      record = {
        key: plan.key, label: plan.label, createdAt: now.toISOString(), createdBy: actor.name,
        undoUntil: new Date(now.getTime() + UNDO_HOURS * 3600_000).toISOString(),
        catalogWasSaved: !!cfg.fenceCatalog,
        created: { ...plan.created, priceHistoryIds: historyIds },
        archivedAt: null, undoneAt: null,
      }
    } else {
      const was = (old?.value ?? null) as ColorRecord | null
      if (!was) throw new ColorError(404, 'That color has no record of being made by the form.')
      // What an edit adds (a new size or method) is the color's too: Undo takes it away with the rest.
      record = {
        ...was,
        created: {
          ...was.created,
          items: [...was.created.items, ...plan.created.items],
          styles: [...was.created.styles, ...plan.created.styles],
          kits: [...was.created.kits, ...plan.created.kits],
          priceHistoryIds: [...was.created.priceHistoryIds, ...historyIds],
        },
        edits: [...(was.edits ?? []), { at: now.toISOString(), by: actor.name, priced: plan.priced.map((p: any) => ({ name: p.name, cents: p.cents, prevCents: p.prevCents })), priceHistoryIds: historyIds, added: plan.created.styles.map((s: any) => s.name), archived: plan.archived }],
        archivedAt: null,
      }
    }
    if (old) await tx.accountKeyValue.update({ where: { accountId_key: { accountId: actor.accountId, key: rk } }, data: { value: record as any, version: { increment: 1 }, updatedBy: actor.userId } })
    else await tx.accountKeyValue.create({ data: { accountId: actor.accountId, key: rk, value: record as any, updatedBy: actor.userId } })
    return { record, message: plan.message, priced: plan.priced.length }
  }, { timeout: 30_000 })
}

/**
 * Quotes and jobs that carry one of these fences. A quote or job in Deleted
 * Records does not count; activeOnly: an archived quote does not count either.
 */
export async function quotesUsing(db: any, accountId: string, styles: string[], activeOnly: boolean): Promise<Array<{ id: string; what: string }>> {
  if (!styles.length) return []
  const quotes = await db.savedQuote.findMany({ where: { accountId, fenceStyle: { in: styles }, deletedAt: null, ...(activeOnly ? { archivedAt: null } : {}) }, select: { id: true, customerName: true, fenceStyle: true, date: true }, take: 5 })
  const out = quotes.map((q: any) => ({ id: q.id, what: `the quote for ${q.customerName || 'a customer'}${q.date ? ` (${q.date})` : ''}` }))
  // A fence offered as another option on a saved proposal counts too (Good Better Best, Compare).
  if (!activeOnly || !out.length) {
    const like = styles.map(s => `%"${s.replace(/[%_\\]/g, m => `\\${m}`)}"%`)
    const rows: Array<{ id: string; customerName: string }> = await db.$queryRawUnsafe(
      `SELECT id, "customerName" FROM "SavedQuote" WHERE "accountId" = $1 AND "deletedAt" IS NULL ${activeOnly ? 'AND "archivedAt" IS NULL' : ''} AND proposal::text LIKE ANY($2::text[]) LIMIT 5`, accountId, like)
    for (const r of rows) if (!out.some((o: any) => o.id === r.id)) out.push({ id: r.id, what: `the proposal for ${r.customerName || 'a customer'}` })
  }
  const jobs = await db.savedJob.findMany({ where: { accountId, fenceStyle: { in: styles }, deletedAt: null, ...(activeOnly ? { archivedAt: null } : {}) }, select: { id: true, customerName: true }, take: 5 })
  for (const j of jobs) out.push({ id: j.id, what: `the job for ${j.customerName || 'a customer'}` })
  return out
}

const stylesOfColor = (cfg: Record<string, any>, key: string): string[] =>
  arr(cfg.fenceStyles).filter(s => s?.material === 'vinyl' && s?.choices?.color === key).map(s => s.name)

/**
 * Undo adding a color: within 24 hours, and only while no quote or job uses
 * one of its fences. Takes away the color, its fences, kits, catalog items and
 * the price history rows the form wrote, leaving Settings and Inventory as
 * they were.
 */
export async function undoVinylColor(actor: ColorActor, key: string, now = new Date()): Promise<{ removed: { styles: string[]; kits: string[]; items: string[]; priceHistory: number } }> {
  const m = await pricingModule() as any
  return prisma.$transaction(async (tx: any) => {
    const rk = recordKey(key)
    const row = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId: actor.accountId, key: rk } } })
    const record = row?.value as ColorRecord | undefined
    if (!record || record.undoneAt) throw new ColorError(404, 'There is nothing to undo for that color.')
    if (now.getTime() > Date.parse(record.undoUntil)) throw new ColorError(409, `Undo was open for ${UNDO_HOURS} hours after ${record.label} was added. Use Remove instead: it archives the color.`)
    const { cfg, items, kits } = await lockedState(tx, actor.accountId)
    const styles = stylesOfColor(cfg, key)
    const used = await quotesUsing(tx, actor.accountId, styles, false)
    if (used.length) throw new ColorError(409, `${record.label} cannot be undone: ${used.map(u => u.what).join(', ')} uses it. Use Remove instead: it archives the color and those keep working.`, { usedBy: used })
    let plan: any
    try { plan = m.planUndoVinylColor({ fenceStyles: arr(cfg.fenceStyles), fenceCatalog: m.fenceCatalogOf(cfg), items, kits }, key) } catch (err) { throw new ColorError(400, (err as Error).message) }
    await saveState(tx, actor.accountId, cfg, plan.state, { items, kits })
    // Settings that had no saved choice tree before go back to having none, if nothing else changed it since.
    if (!record.catalogWasSaved && sameJson(plan.state.fenceCatalog, m.DEFAULT_FENCE_CATALOG)) {
      const b = await tx.businessState.findUnique({ where: { accountId: actor.accountId }, select: { config: true } })
      const { fenceCatalog: _drop, ...rest } = obj(b.config)
      await tx.businessState.update({ where: { accountId: actor.accountId }, data: { config: rest as any } })
    }
    const ids = plan.items.map((i: any) => i.id)
    const ph = ids.length ? await tx.priceHistory.deleteMany({ where: { accountId: actor.accountId, inventoryItemId: { in: ids }, source: COLOR_FORM_SOURCE } }) : { count: 0 }
    await tx.accountKeyValue.delete({ where: { accountId_key: { accountId: actor.accountId, key: rk } } })
    return { removed: { styles: plan.styles, kits: plan.kits, items: plan.items.map((i: any) => i.name), priceHistory: ph.count } }
  }, { timeout: 30_000 })
}

/** Remove (archive) a color, or bring it back. Remove is refused while an active quote uses one of its fences. */
export async function archiveVinylColor(actor: ColorActor, key: string, archive: boolean): Promise<{ styles: string[]; items: string[] }> {
  const m = await pricingModule() as any
  return prisma.$transaction(async (tx: any) => {
    const { cfg, items, kits } = await lockedState(tx, actor.accountId)
    if (archive) {
      const used = await quotesUsing(tx, actor.accountId, stylesOfColor(cfg, key), true)
      if (used.length) throw new ColorError(409, `It cannot be removed while ${used.map(u => u.what).join(', ')} uses it. Archive or finish those quotes first.`, { usedBy: used })
    }
    let plan: any
    try { plan = m.planArchiveVinylColor({ fenceStyles: arr(cfg.fenceStyles), fenceCatalog: m.fenceCatalogOf(cfg), items, kits }, key, archive) } catch (err) { throw new ColorError(400, (err as Error).message) }
    await saveState(tx, actor.accountId, cfg, plan.state, { items, kits })
    const rk = recordKey(key)
    const row = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId: actor.accountId, key: rk } } })
    if (row) await tx.accountKeyValue.update({ where: { accountId_key: { accountId: actor.accountId, key: rk } }, data: { value: { ...(row.value as any), archivedAt: archive ? new Date().toISOString() : null } as any, version: { increment: 1 }, updatedBy: actor.userId } })
    return { styles: plan.styles, items: plan.items }
  }, { timeout: 30_000 })
}

/** The "color created" records, newest first (the confirmation and Undo on the Vinyl Colors screen). */
export async function colorRecords(accountId: string): Promise<ColorRecord[]> {
  const rows = await prisma.accountKeyValue.findMany({ where: { accountId, key: { startsWith: 'vinyl-color:' } } })
  return rows.map(r => r.value as unknown as ColorRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
