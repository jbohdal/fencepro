/**
 * A quote on a style held now because its costs are missing is never
 * repriced (review Oct 29 2026: a saved 8 ft tall quote reopened after its
 * piece costs were cleared in Settings repriced at $0 a piece, $5,050 → $698,
 * and saved). A save that would change its price, or anything the price is
 * made from, is refused (409 STYLE_NOT_QUOTABLE); a save that changes only
 * words (notes, customer details, status, the proposal's words) goes through.
 * Drafts too: a draft may keep a style that is switched off (it still
 * prices), but a held one has nothing to price from.
 *
 * What counts as price-bearing is the signed quote lock's list
 * (lib/quoteLock.ts lockedChanges: the price, costs, margin, pull sheet,
 * style, runs and sections, posts, gates, tear out, labor and price
 * adjustments, pricing choices, the move or repair lines, the proposal's
 * options, prices and tiers, and the drawn yard's geometry). Review Oct 29
 * 2026: a save that kept the price but sent other sections, material $0 and
 * a new cost of goods was accepted before.
 *
 * One check for every save route (routes/saved-quotes.ts POST and PATCH);
 * other routes that save a quote's price reuse heldPriceRefusal.
 */

import { pricingModule } from './estimates.js'
import { dataFor } from './quotePricing.js'
import { lockedChanges } from './quoteLock.js'

export const STYLE_NOT_QUOTABLE = 'STYLE_NOT_QUOTABLE'

const cents = (n: unknown) => Math.round((Number(n) || 0) * 100)

/**
 * Whether this save changes the price, or what it is made from, on a quote
 * whose style is held now, and why the style is held; null when it may be
 * saved. `next` is what the save writes (a field left out stays as saved);
 * `saved` the quote as it is, or null for a new quote.
 */
export async function heldPriceRefusal(
  accountId: string,
  next: Record<string, any>,
  saved: ({ fenceStyle: string; finalPrice: number } & Record<string, any>) | null,
): Promise<{ style: string; held: string; fields: string[] } | null> {
  const style = String(next.fenceStyle ?? saved?.fenceStyle ?? '').trim()
  if (!style) return null
  let fields: string[]
  if (saved) {
    // Any price-bearing field changed (status is not one here: a held quote may be sent, marked Lost and so on).
    fields = lockedChanges(saved, next).filter(f => f !== 'status')
  } else {
    fields = cents(next.finalPrice) > 0 ? ['finalPrice'] : []
  }
  if (!fields.length) return null
  const held = (await pricingModule()).heldStyleReason(await dataFor(accountId), style)
  return held ? { style, held, fields } : null
}

/** The 409 answer: what is held and why; the saved quote is unchanged. */
export function refuseHeldPrice(res: any, r: { style: string; held: string; fields?: string[] }, label?: string): void {
  res.status(409).json({
    success: false, code: STYLE_NOT_QUOTABLE, style: r.style, held: r.held, fields: r.fields ?? [],
    error: `${label || r.style} is not available for quoting (${r.held}), so this quote's price and what it is made from cannot change. The saved quote is unchanged; notes and customer details can still be saved.`,
  })
}
