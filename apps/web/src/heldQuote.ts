/**
 * A saved quote whose style is held now because its costs are missing (8 ft
 * tall with its piece costs cleared in Settings; review Oct 29 2026: it
 * reopened at $0 a piece, $5,050 → $698, and "Update quote" saved that). The
 * quote builder shows the saved price, never today's, and a save keeps it:
 * only words (notes, customer details, status) change. A change to what the
 * price is worked out from cannot be saved until the costs are in. The server
 * refuses such a change too (portal lib/heldStylePrice.ts).
 *
 * While held, the Price step shows the saved numbers (per foot, material,
 * cost of goods, margin, pull sheet), never today's $0 cost math, and the
 * saved Good, Better, Best options as saved (review Oct 29 2026: "$6.98 per
 * foot", Materials $0, every tier "Not offered on this quote").
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

type SavedNumbers = {
  finalPrice?: number | null; materialCost?: number | null; laborCost?: number | null; tearOutCost?: number | null
  totalCOGS?: number | null; gmPct?: number | null; runs?: unknown; pullSheet?: unknown; proposal?: { footageFt?: unknown } | null
}

/** The saved quote's footage: its runs, else the proposal's footage. */
export function savedFootage(q: SavedNumbers): number {
  const runs = Array.isArray(q.runs) ? q.runs : []
  const ft = runs.reduce((t: number, r: unknown) => {
    const v = typeof r === 'number' ? r : Number((r as { ft?: unknown } | null)?.ft)
    return t + (Number.isFinite(v) && v > 0 ? v : 0)
  }, 0)
  if (ft > 0) return ft
  const p = Number(q.proposal?.footageFt)
  return Number.isFinite(p) && p > 0 ? p : 0
}

/** The numbers the Price step shows for a held quote: all from the saved quote (dollars). */
export function heldSavedNumbers(q: SavedNumbers): { price: number; perFoot: number | null; material: number; labor: number; cogs: number; marginPct: number | null; pullSheet: Array<{ item: string; qty: number; unitCost: number; total: number; jobLotPiece?: boolean; costSource?: string }> } {
  const price = Number(q.finalPrice) || 0
  const ft = savedFootage(q)
  const material = Number(q.materialCost) || 0
  const labor = (Number(q.laborCost) || 0) + (Number(q.tearOutCost) || 0)
  const cogs = Number(q.totalCOGS) || material + labor
  const gm = Number(q.gmPct)
  return {
    price, perFoot: ft > 0 ? Math.round((price / ft) * 100) / 100 : null, material, labor, cogs,
    marginPct: Number.isFinite(gm) && price > 0 ? gm : null,
    pullSheet: (Array.isArray(q.pullSheet) ? q.pullSheet : []).filter(l => l && typeof l === 'object' && typeof (l as any).item === 'string')
      .map((l: any) => ({ item: String(l.item), qty: Number(l.qty) || 0, unitCost: Number(l.unitCost) || 0, total: Number(l.total) || 0, ...(l.jobLotPiece ? { jobLotPiece: true } : {}), ...(l.costSource ? { costSource: l.costSource } : {}) })),
  }
}

const ask = (canPrice: boolean) => (canPrice ? '' : ' (ask Jonathan)')

/** Under the style picker: why the quote keeps its saved price (the reason once). */
export function heldNote(label: string, held: string, savedPrice: string, canPrice: boolean): string {
  return `${label} is not available for quoting: ${held}${ask(canPrice)}. This quote keeps its saved price (${savedPrice}); notes and customer details can be saved, a change to the fence or its price cannot until the costs are in.`
}

/** Under Update quote when a change to the fence or its price was made. */
export function heldNotSaved(label: string, held: string, canPrice: boolean): string {
  return `Not saved: ${label}'s price cannot change until its costs are in (${held})${ask(canPrice)}. Undo the change, or close without saving to keep the saved quote.`
}

/** Beside the bottom bar's Update quote (any step): the short reason it is grey. */
export function heldBarReason(canPrice: boolean): string {
  return `Can't update: our costs for this fence are missing, so its fence and price can't change${ask(canPrice)}. Undo the change or close without saving.`
}
