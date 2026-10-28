/**
 * How fresh each Inventory price is. An item's `priceUpdatedAt` is set the day
 * its cost changes or someone confirms it; items that came in with the price
 * book (or a bulk import) and were never confirmed say so. A quote warns
 * (never blocks) when a part it uses is older than the setting.
 */

export const DEFAULT_PRICE_STALE_MONTHS = 6

export interface PricedItem {
  id: string
  name: string
  unitCost: number
  /** YYYY-MM-DD: the day the cost last changed or was confirmed. */
  priceUpdatedAt?: string
  /** Came in by import and nobody has confirmed it since. */
  priceImported?: boolean
  /** Priced from another part until it has its own price (green chain link parts at the black part's price, Oct 27 2026). */
  priceFrom?: PriceFrom
}

/** Where a borrowed price came from: the part, its price then (cents), the day, and the words shown. */
export interface PriceFrom { part: string; cents: number; on: string; words: string }

/** The borrowed price still stands: the cost is still that part's price and nobody has confirmed it. */
export function borrowedPrice(item: PricedItem): PriceFrom | null {
  const f = item.priceFrom
  if (!f || typeof f.cents !== 'number') return null
  if (Math.round(Number(item.unitCost) * 100) !== f.cents) return null
  if (item.priceUpdatedAt && !item.priceImported) return null
  return f
}

export type PriceAge = 'unconfirmed' | 'old' | 'fresh'

/** The date `months` before `today` (YYYY-MM-DD); a price on or before it is old. */
export function staleCutoff(today: string, months: number): string {
  const [y, m, d] = today.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1 - months, 1))
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate()
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

export function priceAge(item: PricedItem, today: string, months = DEFAULT_PRICE_STALE_MONTHS): PriceAge {
  if (!item.priceUpdatedAt || item.priceImported) return 'unconfirmed'
  return item.priceUpdatedAt <= staleCutoff(today, months) ? 'old' : 'fresh'
}

/** Oldest first; never confirmed before everything else. */
export function compareByPriceAge(a: PricedItem, b: PricedItem): number {
  const key = (i: PricedItem) => (!i.priceUpdatedAt || i.priceImported ? '' : i.priceUpdatedAt)
  return key(a).localeCompare(key(b))
}

/** "Mar 4, 2026", "Imported, not yet confirmed", or where a borrowed price came from ("From Black until a green price is entered (Black, Bolt, ...)"). */
export function priceAgeLabel(item: PricedItem): string {
  const from = borrowedPrice(item)
  if (from) return `${from.words} (${from.part})`
  if (!item.priceUpdatedAt || item.priceImported) return 'Imported, not yet confirmed'
  const [y, m, d] = item.priceUpdatedAt.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * Stamp the date on every item whose cost changed since `before` (by id).
 * Items from an import are marked imported; anything else is a price someone
 * typed, so it counts as confirmed today.
 */
export function stampPriceChanges<T extends PricedItem>(items: T[], before: ReadonlyMap<string, number>, today: string, imported = false): T[] {
  return items.map(i => {
    const was = before.get(i.id)
    const changed = was === undefined ? true : Number(was) !== Number(i.unitCost)
    if (!changed) return i
    if (was === undefined && !imported && i.priceUpdatedAt) return i
    return { ...i, priceUpdatedAt: today, priceImported: imported }
  })
}

/** Confirm prices as they are: today's date, no longer "imported". */
export function confirmPrices<T extends PricedItem>(items: T[], ids: ReadonlySet<string>, today: string): T[] {
  return items.map(i => (ids.has(i.id) ? { ...i, priceUpdatedAt: today, priceImported: false } : i))
}

/** The parts on a quote whose price is old or never confirmed (by name, the way quotes find their costs). */
export function stalePartsOnQuote<T extends PricedItem>(
  partNames: string[], items: T[], today: string, months: number, normalize: (s: string) => string,
): Array<{ item: T; age: Exclude<PriceAge, 'fresh'> }> {
  const byName = new Map(items.map(i => [normalize(i.name), i]))
  const out: Array<{ item: T; age: Exclude<PriceAge, 'fresh'> }> = []
  const seen = new Set<string>()
  for (const n of partNames) {
    const item = byName.get(normalize(n))
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    const age = priceAge(item, today, months)
    if (age !== 'fresh') out.push({ item, age })
  }
  return out
}
