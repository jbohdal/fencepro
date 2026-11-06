/**
 * Fence styles added like vinyl colors (web/src/styleForm.ts; Jonathan, Nov 5
 * 2026), any material: the style, its fences copied with their kits and the
 * same quantities, its own parts (new, $0 until priced) and shared hardware
 * kept, saved in one transaction with Settings and Inventory; each price set
 * is a dated cost (price history, source style_form). Rename, Archive and
 * Bring back as for a vinyl color (lib/vinylColors.ts); a quote or job keeps
 * its price.
 *
 * The Price List's prices for any style's parts (planStylePrices) are saved
 * the same way, as dated costs (source price_list).
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { ColorError, businessDay, lockedState, saveState, writeHistory, quotesUsing, type ColorActor } from './vinylColors.js'

export const STYLE_FORM_SOURCE = 'style_form'
export const PRICE_LIST_SOURCE = 'price_list'
export const styleRecordKey = (material: string, key: string) => `style-form:${material}:${key}`

const arr = (v: unknown): any[] => (Array.isArray(v) ? v : [])
const uid = (p: string) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

export interface StyleRecord {
  material: string
  key: string
  label: string
  createdAt: string
  createdBy: string
  styles: string[]
  items: Array<{ id: string; name: string; cents: number | null }>
  edits: Array<{ at: string; by: string; renamed?: { from: string; to: string }; priced: Array<{ name: string; cents: number; prevCents: number | null }>; added: string[]; priceHistoryIds: string[] }>
  archivedAt?: string | null
}

/** Add a style from the form, or (key) save it again: prices, own or same part, a new name. */
export async function saveStyleForm(actor: ColorActor, input: any, key?: string): Promise<{ record: StyleRecord; message: string; waiting: string[] }> {
  const m = await pricingModule() as any
  return prisma.$transaction(async (tx: any) => {
    const { cfg, items, kits } = await lockedState(tx, actor.accountId)
    const day = businessDay()
    const st = { fenceStyles: arr(cfg.fenceStyles), fenceCatalog: m.fenceCatalogOf(cfg), items, kits }
    let plan: any
    try { plan = m.planStyleForm(st, input, { today: day, newId: uid, ...(key ? { key } : {}) }) } catch (err) { throw new ColorError(400, (err as Error).message) }
    await saveState(tx, actor.accountId, cfg, plan.state, { items, kits })
    const historyIds = await writeHistory(tx, actor, day, plan.priced, items, STYLE_FORM_SOURCE)
    const material = String(input?.material ?? '')
    const rk = styleRecordKey(material, plan.key)
    const old = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId: actor.accountId, key: rk } } })
    const now = new Date().toISOString()
    const edit = { at: now, by: actor.name, ...(plan.renamed ? { renamed: plan.renamed } : {}), priced: plan.priced.map((p: any) => ({ name: p.name, cents: p.cents, prevCents: p.prevCents })), added: plan.items.map((i: any) => i.name), priceHistoryIds: historyIds }
    const was = (old?.value ?? null) as StyleRecord | null
    const record: StyleRecord = was
      ? { ...was, label: plan.label, items: [...was.items, ...plan.items], edits: [...was.edits, edit], archivedAt: null }
      : { material, key: plan.key, label: plan.label, createdAt: now, createdBy: actor.name, styles: plan.styles, items: plan.items, edits: [edit], archivedAt: null }
    if (old) await tx.accountKeyValue.update({ where: { accountId_key: { accountId: actor.accountId, key: rk } }, data: { value: record as any, version: { increment: 1 }, updatedBy: actor.userId } })
    else await tx.accountKeyValue.create({ data: { accountId: actor.accountId, key: rk, value: record as any, updatedBy: actor.userId } })
    return { record, message: plan.message, waiting: plan.waiting }
  }, { timeout: 30_000 })
}

/** The fences of a style (by its choice), for the archive checks. */
function fencesOf(cfg: any, m: any, material: string, key: string): string[] {
  const dim = m.STYLE_DIM[material]
  return arr(cfg.fenceStyles).filter((s: any) => s?.material === material && s?.choices?.[dim] === key).map((s: any) => s.name)
}

/** Archive a style or bring it back (the owner). Archive waits only for unsent drafts on its fences. */
export async function archiveStyle(actor: ColorActor, material: string, key: string, archive: boolean): Promise<{ styles: string[]; items: string[]; kits: string[] }> {
  const m = await pricingModule() as any
  return prisma.$transaction(async (tx: any) => {
    const { cfg, items, kits } = await lockedState(tx, actor.accountId)
    if (archive) {
      const names = fencesOf(cfg, m, material, key)
      const quotes = names.length ? await tx.savedQuote.findMany({ where: { accountId: actor.accountId, fenceStyle: { in: names }, deletedAt: null, archivedAt: null }, select: { id: true, customerName: true, status: true, shareToken: true, acceptedAt: true, soldAt: true, firstViewedAt: true, viewCount: true } }) : []
      const drafts = quotes.filter((q: any) => m.isUnsentDraft(q))
      if (drafts.length) throw new ColorError(409, `It cannot be archived while the unsent draft for ${drafts.map((q: any) => q.customerName || 'a customer').slice(0, 3).join(', ')} uses it: a draft on an archived fence cannot be priced or sent. Change that draft's fence, or archive the draft, first.`, { usedBy: drafts.map((q: any) => ({ id: q.id, what: `the unsent draft for ${q.customerName || 'a customer'}` })) })
    }
    let plan: any
    try { plan = m.planArchiveStyle({ fenceStyles: arr(cfg.fenceStyles), fenceCatalog: m.fenceCatalogOf(cfg), items, kits }, material, key, archive) } catch (err) { throw new ColorError(400, (err as Error).message) }
    await saveState(tx, actor.accountId, cfg, plan.state, { items, kits })
    const rk = styleRecordKey(material, key)
    const row = await tx.accountKeyValue.findUnique({ where: { accountId_key: { accountId: actor.accountId, key: rk } } })
    if (row) await tx.accountKeyValue.update({ where: { accountId_key: { accountId: actor.accountId, key: rk } }, data: { value: { ...(row.value as any), archivedAt: archive ? new Date().toISOString() : null } as any, version: { increment: 1 }, updatedBy: actor.userId } })
    return { styles: plan.styles, items: plan.items, kits: plan.kits }
  }, { timeout: 30_000 })
}

/** What archiving a style does: its fences, and the quotes and jobs on them (they keep their prices). */
export async function styleArchiveCheck(accountId: string, material: string, key: string) {
  const m = await pricingModule() as any
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const names = fencesOf(b?.config ?? {}, m, material, key)
  // The unsent drafts on its fences stop an archive: said before anything is asked (review, Nov 5 2026).
  const quotes = names.length ? await prisma.savedQuote.findMany({ where: { accountId, fenceStyle: { in: names }, deletedAt: null, archivedAt: null }, select: { id: true, customerName: true, status: true, shareToken: true, acceptedAt: true, soldAt: true, firstViewedAt: true, viewCount: true } }) : []
  const blocking = quotes.filter((q: any) => m.isUnsentDraft(q)).map((q: any) => ({ id: q.id, what: `the unsent draft for ${q.customerName || 'a customer'}` }))
  const usedBy = (await quotesUsing(prisma, accountId, names, true)).filter(u => !blocking.some(b => b.id === u.id))
  return { fences: names.length, usedBy, blocking }
}

/** Prices typed on the Price List for a style's parts: Inventory prices as dated costs. */
export async function saveStylePrices(actor: ColorActor, prices: Array<{ part: string; cents: number }>): Promise<{ priced: Array<{ name: string; cents: number; prevCents: number | null }> }> {
  const m = await pricingModule() as any
  return prisma.$transaction(async (tx: any) => {
    const { cfg, items, kits } = await lockedState(tx, actor.accountId)
    const day = businessDay()
    let plan: any
    try { plan = m.planStylePrices({ fenceStyles: arr(cfg.fenceStyles), fenceCatalog: m.fenceCatalogOf(cfg), items, kits }, prices, day) } catch (err) { throw new ColorError(400, (err as Error).message) }
    if (!plan.priced.length) return { priced: [] }
    await tx.inventoryState.update({ where: { accountId: actor.accountId }, data: { items: plan.state.items as any, version: { increment: 1 } } })
    await writeHistory(tx, actor, day, plan.priced, items, PRICE_LIST_SOURCE)
    return { priced: plan.priced.map((p: any) => ({ name: p.name, cents: p.cents, prevCents: p.prevCents })) }
  }, { timeout: 30_000 })
}
