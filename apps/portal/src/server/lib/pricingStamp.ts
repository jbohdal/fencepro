/**
 * The pricing stamp (broken list #58, Oct 29 2026): which copy of the price
 * data a quote was priced with.
 *
 * A phone keeps the Settings, Inventory and Good Better Best it loaded. When
 * the owner changes a price, an app already open priced quotes at the old
 * prices and the server saved them. Now each of the three records has a short
 * fingerprint of its price-bearing part:
 *
 *   business   Settings (business state config: fence styles, the catalog,
 *              Pricing with overhead and margins, move and repair, the 6 / 8 ft
 *              optimizer...), without the parts that never change a price
 *              (company details, appointments, voice, words on the proposal...),
 *              and the budget's overhead while live overhead is on;
 *   inventory  every part's price and status, and the material kits (not the
 *              stock counts, dates or bar codes);
 *   tiers      the Good Better Best sets.
 *
 * Each read of those records (GET /api/business-state, /api/inventory-state,
 * /api/tier-sets) carries its part as `pricingPart`, worked out from the very
 * row it hands out, so the phone always knows which copy it holds. The phone
 * sends "business.inventory.tiers" with a quote it priced; a save on an older
 * stamp is refused (routes/saved-quotes.ts, lib/quotePriceCheck.ts) and the
 * phone reprices first. GET /api/quote-pricing/stamp is the cheap check the
 * phone makes on focus, on signal back and on a timer: it reads only the
 * records' versions and works a part out again only when its version moved.
 */

import crypto from 'crypto'
import prisma from './prisma.js'

type Json = any

/** Settings parts that never change a price: left out, so editing them does not make every open quote reprice. */
export const NOT_PRICE_SETTINGS = new Set([
  'appointments', 'appointmentMessages', 'company', 'customerTags', 'leadSources', 'media', 'notifications',
  'pipelineStages', 'portal', 'proposal', 'quote', 'quoteWidget', 'voice', 'warranties',
])

/** Inventory item fields that are not its price: stock, dates, codes and suppliers. */
const NOT_PRICE_ITEM = new Set(['qtyOnHand', 'reorderPoint', 'reorderQty', 'maxQty', 'locationId', 'barcodes', 'sku', 'supplier', 'priceUpdatedAt', 'priceImported'])

/** JSON with object keys in order, so the same data always gives the same text. */
export function canonical(v: unknown): string {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
}

const short = (text: string) => crypto.createHash('sha256').update(text).digest('hex').slice(0, 12)

/** Settings' price-bearing part. `budget`: the business state's budget (its overhead counts while live overhead is on). */
export function businessPart(config: unknown, budget?: unknown): string {
  const c = config && typeof config === 'object' && !Array.isArray(config) ? config as Record<string, unknown> : {}
  const kept: Record<string, unknown> = {}
  for (const k of Object.keys(c)) if (!NOT_PRICE_SETTINGS.has(k)) kept[k] = c[k]
  const live = !!(c.pricing as Json)?.liveOverhead?.on
  const overhead = live && budget && typeof budget === 'object' ? (budget as Json).overhead ?? null : null
  return short(canonical({ config: kept, overhead }))
}

/** Inventory's price-bearing part: each part's price and status, and the material kits. */
export function inventoryPart(items: unknown, kits: unknown): string {
  const list = (Array.isArray(items) ? items : []).map((i: Json) => {
    if (!i || typeof i !== 'object') return i
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(i)) if (!NOT_PRICE_ITEM.has(k)) out[k] = i[k]
    return out
  })
  return short(canonical({ items: list, kits: Array.isArray(kits) ? kits : [] }))
}

/** The Good Better Best sets, in id order (their order on screen and save dates do not change a price). */
export function tierPart(rows: unknown): string {
  const list = (Array.isArray(rows) ? rows : [])
    .map((r: Json) => ({ id: r?.id ?? null, category: r?.category ?? null, tiers: r?.tiers ?? null, popular: r?.popular ?? null }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
  return short(canonical(list))
}

export interface PricingStamp {
  /** "business.inventory.tiers": what a quote carries. */
  stamp: string
  business: string
  inventory: string
  tiers: string
}

export const joinStamp = (p: { business: string; inventory: string; tiers: string }) => `${p.business}.${p.inventory}.${p.tiers}`

/** Per company: the versions last seen and the parts worked out from them. */
const cache = new Map<string, { business: { v: number; part: string } | null; inventory: { v: number; part: string } | null; tiers: { key: string; part: string } | null }>()

/**
 * The company's current stamp. Reads only the versions; a part is worked out
 * again only when its record's version moved since the last ask.
 */
export async function currentPricingStamp(accountId: string): Promise<PricingStamp> {
  const [b, inv, sets] = await Promise.all([
    prisma.businessState.findUnique({ where: { accountId }, select: { version: true } }),
    prisma.inventoryState.findUnique({ where: { accountId }, select: { version: true } }),
    prisma.proposalTierSet.findMany({ where: { accountId }, select: { id: true, version: true }, orderBy: { id: 'asc' } }),
  ])
  const held = cache.get(accountId) ?? { business: null, inventory: null, tiers: null }
  const bv = b?.version ?? -1, iv = inv?.version ?? -1
  const tkey = sets.map(s => `${s.id}:${s.version}`).join(',')
  if (!held.business || held.business.v !== bv) {
    const row = bv < 0 ? null : await prisma.businessState.findUnique({ where: { accountId }, select: { config: true, budget: true, version: true } })
    held.business = { v: row?.version ?? -1, part: businessPart(row?.config ?? null, row?.budget ?? null) }
  }
  if (!held.inventory || held.inventory.v !== iv) {
    const row = iv < 0 ? null : await prisma.inventoryState.findUnique({ where: { accountId }, select: { items: true, kits: true, version: true } })
    held.inventory = { v: row?.version ?? -1, part: inventoryPart(row?.items ?? [], row?.kits ?? []) }
  }
  if (!held.tiers || held.tiers.key !== tkey) {
    // A set saved between the two reads: its part is the newer one and the key the older, so the next ask works it out again.
    const rows = await prisma.proposalTierSet.findMany({ where: { accountId }, select: { id: true, category: true, tiers: true, popular: true } })
    held.tiers = { key: tkey, part: tierPart(rows) }
  }
  cache.set(accountId, held)
  const parts = { business: held.business.part, inventory: held.inventory.part, tiers: held.tiers.part }
  return { stamp: joinStamp(parts), ...parts }
}

/** For tests: forget what was worked out. */
export function _forgetPricingStamps() { cache.clear() }
