/**
 * A saved quote whose style is held now because its costs are missing (8 ft
 * tall with its piece costs cleared in Settings; review Oct 29 2026: it
 * reopened at $0 a piece, $5,050 → $698, and "Update quote" saved that). The
 * quote builder shows the saved price, never today's, and a save keeps it:
 * only words (notes, customer details, status) change. A change to what the
 * price is worked out from cannot be saved until the costs are in. The server
 * refuses such a price change too (portal lib/heldStylePrice.ts).
 */

import { keepPrices } from '../../portal/src/server/lib/quoteLock'

/** The quote was saved before, on this style, and the style is held now (its `held` reason, worked out on read). */
export function isHeldSavedQuote(saved: { id?: string | null; fenceStyle?: string | null } | null | undefined, style: { name: string; held?: string } | null | undefined): boolean {
  return !!saved?.id && !!style && style.name === saved.fenceStyle && !!style.held
}

/** What a save of such a quote writes: the saved quote with only its words from `edited`; null when the price inputs changed (not saved). */
export function heldQuoteSave<T extends Record<string, any>>(saved: T, edited: Record<string, any>, priceInputsChanged: boolean): T | null {
  if (priceInputsChanged) return null
  return keepPrices(saved, { ...edited, date: saved.date })
}
