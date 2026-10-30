/**
 * A quote on a style held now because its costs are missing is never
 * repriced (review Oct 29 2026: a saved 8 ft tall quote reopened after its
 * piece costs were cleared in Settings repriced at $0 a piece, $5,050 → $698,
 * and saved). A save that would change its price is refused (409
 * STYLE_NOT_QUOTABLE); a save that keeps the saved price (notes, customer
 * details, status) goes through. Drafts too: a draft may keep a style that is
 * switched off (it still prices), but a held one has nothing to price from.
 *
 * One check for every save route (routes/saved-quotes.ts POST and PATCH);
 * other routes that save a quote's price reuse heldPriceRefusal.
 */

import { pricingModule } from './estimates.js'
import { dataFor } from './quotePricing.js'

export const STYLE_NOT_QUOTABLE = 'STYLE_NOT_QUOTABLE'

const cents = (n: unknown) => Math.round((Number(n) || 0) * 100)

/**
 * Whether this save changes the price of a quote on a style held now, and why
 * the style is held; null when it may be saved. `next` is what the save
 * writes (a field left out stays as saved); `saved` the quote as it is, or
 * null for a new quote.
 */
export async function heldPriceRefusal(
  accountId: string,
  next: { fenceStyle?: string | null; finalPrice?: number | null },
  saved: { fenceStyle: string; finalPrice: number } | null,
): Promise<{ style: string; held: string } | null> {
  const style = (next.fenceStyle ?? saved?.fenceStyle ?? '').trim()
  if (!style) return null
  const price = next.finalPrice === undefined || next.finalPrice === null ? (saved ? saved.finalPrice : 0) : next.finalPrice
  const changes = saved ? cents(price) !== cents(saved.finalPrice) || (style !== saved.fenceStyle && cents(price) > 0) : cents(price) > 0
  if (!changes) return null
  const held = (await pricingModule()).heldStyleReason(await dataFor(accountId), style)
  return held ? { style, held } : null
}

/** The 409 answer: what is held and why; the saved quote is unchanged. */
export function refuseHeldPrice(res: any, r: { style: string; held: string }, label?: string): void {
  res.status(409).json({
    success: false, code: STYLE_NOT_QUOTABLE, style: r.style, held: r.held,
    error: `${label || r.style} is not available for quoting (${r.held}), so this quote's price cannot change. The saved quote is unchanged; notes and customer details can still be saved.`,
  })
}
