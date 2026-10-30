/**
 * Prices kept current on an app that stays open (broken list #58, Oct 29 2026).
 *
 * The phone holds the Settings, Inventory and Good Better Best it loaded. The
 * server marks each read of them with a fingerprint of its price-bearing part
 * (portal lib/pricingStamp.ts: `pricingPart`); each store notes the one it
 * holds here. The app asks GET /api/quote-pricing/stamp (cheap) when it comes
 * back on screen, when signal returns, every minute (liveRefresh.ts), every
 * 30 seconds while the quote builder is open and right before a quote is
 * saved; a part that differs is read again from the server, and the quote
 * builder prices with it at once (no page reload, nothing typed is lost).
 *
 * A quote priced here carries the stamp of the copy it was priced with
 * (heldPricingStamp); the server refuses a save on an older one (409
 * PRICES_CHANGED) and the quote builder reprices and asks first.
 *
 * Nothing here is kept in the browser's storage: the parts live in memory for
 * this visit, like the data they describe.
 */

export type PricingKind = 'business' | 'inventory' | 'tiers'
export const PRICING_KINDS: readonly PricingKind[] = ['business', 'inventory', 'tiers']
export type PricingParts = Record<PricingKind, string | null>
export interface ServerStamp { stamp: string; business: string; inventory: string; tiers: string }

const held: PricingParts = { business: null, inventory: null, tiers: null }
const reloaders = new Map<PricingKind, () => Promise<void>>()

/** Sent when the server's price data differs from this phone's, just before it is read again: { changed: PricingKind[] }. */
export const PRICING_CHANGED_EVENT = 'ezbiz:pricing-changed'

/** A store read its record from the server: the part it now holds (ignored when the answer had none). */
export function notePricingPart(kind: PricingKind, part: unknown): void {
  if (typeof part === 'string' && part) held[kind] = part
}

/** How a store reads its record again (registered by the store itself, so this file imports none of them). */
export function registerPricingReload(kind: PricingKind, reload: () => Promise<void>): void {
  reloaders.set(kind, reload)
}

/** The stamp a quote priced now carries: "business.inventory.tiers", or null while a part is not known yet. */
export function heldPricingStamp(parts: PricingParts = held): string | null {
  return parts.business && parts.inventory && parts.tiers ? `${parts.business}.${parts.inventory}.${parts.tiers}` : null
}

/** The parts this phone holds that differ from the server's (a part not known yet counts as changed). */
export function changedPricingParts(parts: PricingParts, server: Pick<ServerStamp, PricingKind>): PricingKind[] {
  return PRICING_KINDS.filter(k => parts[k] !== server[k])
}

/** Is this answer a stamp? */
export function isServerStamp(v: unknown): v is ServerStamp {
  const s = v as ServerStamp | null
  return !!s && typeof s === 'object' && typeof s.stamp === 'string' && PRICING_KINDS.every(k => typeof s[k] === 'string' && !!s[k])
}

/** The server's stamp now; null with no signal (or a login that gets no prices). */
export async function fetchServerStamp(): Promise<ServerStamp | null> {
  // Read when asked (the stores import this file; it stays free of the sign in code, so the server's copy of the
  // pricing code and the tests load it without a browser).
  const { sendJson } = await import('./syncHttp')
  const r = await sendJson('GET', '/api/quote-pricing/stamp', undefined, 10_000)
  const d = r.result.ok ? r.json?.data : null
  return isServerStamp(d) ? d : null
}

export interface PricingCheck {
  /** The server answered (false: no signal; nothing was compared). */
  checked: boolean
  /** The parts that were out of date and read again. */
  changed: PricingKind[]
}

let going: Promise<PricingCheck> | null = null

/**
 * Compare with the server, and read again every part that changed. Resolves
 * once those reads are done (so a screen priced on them is current). Two asks
 * at once share one check.
 */
export function checkPricing(fetchStamp: () => Promise<ServerStamp | null> = fetchServerStamp): Promise<PricingCheck> {
  if (going) return going
  going = (async (): Promise<PricingCheck> => {
    const server = await fetchStamp().catch(() => null)
    if (!server) return { checked: false, changed: [] }
    const changed = changedPricingParts(held, server)
    // Said before the reads, so an open quote notes the price it showed before the new data arrives.
    if (changed.length) {
      try { window.dispatchEvent(new CustomEvent(PRICING_CHANGED_EVENT, { detail: { changed } })) } catch { /* no window (tests) */ }
    }
    for (const k of changed) {
      try { await reloaders.get(k)?.() } catch { /* read again on the next check */ }
    }
    return { checked: true, changed }
  })().finally(() => { going = null })
  return going
}

/** For tests: forget the parts and the reloads. */
export function _resetPricingForTests() {
  for (const k of PRICING_KINDS) held[k] = null
  reloaders.clear()
  going = null
}

// ── Saving a quote ───────────────────────────────────────────────────────────

/** "$5,662" (cents shown only when there are any). */
export function priceText(dollars: number): string {
  const cents = Math.round((Number(dollars) || 0) * 100)
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })
}

/** The same price to the cent? */
export const samePrice = (a: number, b: number) => Math.round((Number(a) || 0) * 100) === Math.round((Number(b) || 0) * 100)

/**
 * What happens to a save after the prices were read again: the price came out
 * the same (save as it is), changed (ask first, with the line to show), or the
 * fence is no longer available for quoting (pick another; nothing is saved).
 */
export type RepriceOutcome =
  | { kind: 'save' }
  | { kind: 'confirm'; line: string }
  | { kind: 'gone'; line: string }

export function repriceOutcome(was: number, now: number, fence: { name: string; available: boolean }): RepriceOutcome {
  if (!fence.available) return { kind: 'gone', line: `${fence.name || 'This fence'} is not available for quoting now (it was switched off or its prices were removed). Pick another fence, then save.` }
  if (samePrice(was, now)) return { kind: 'save' }
  return { kind: 'confirm', line: `Prices changed since you opened this quote. It is now ${priceText(now)} (was ${priceText(was)}).` }
}

/**
 * A draft opened after a price change: said, rather than silently showing the new price. Null when nothing changed.
 * `since`: 'opened' for a quote that never reached the server (its first save was sent back for new prices).
 */
export function draftPriceLine(savedPrice: number, nowPrice: number, since: 'saved' | 'opened' = 'saved'): string | null {
  if (!(nowPrice > 0) || samePrice(savedPrice, nowPrice)) return null
  return `Prices changed since ${since === 'opened' ? 'you opened this quote' : 'this quote was saved'}. It is now ${priceText(nowPrice)} (was ${priceText(savedPrice)}).`
}
