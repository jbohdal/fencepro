/**
 * A change the office site plan asks of its quote (SitePlanEditor.tsx): "Use
 * the drawn length", a count to match the plan, "Add a gate here", "Make this
 * side longer". The quote builder opens on the quote with the walk list or the
 * drawing changed (an unsigned quote), or in change order mode with the same
 * change (a signed quote), shows the old and new prices, and saves through its
 * own save or its own Make change order. The plan hears back here once it did.
 *
 * Nothing here prices or saves: the builder (QuoteBuilder.tsx) and App's quote
 * save do, as for any other quote change.
 */

import type { SavedQuote } from './QuotesPage'
import type { ChangeOrder } from './ChangeOrders'
import { quoteWithChanges, refreshChangeOrders, isSignedForChange } from './ChangeOrders'
import { getQuoteById, loadFullQuote, isSlimQuote } from './quoteStore'
import type { QuoteEdit } from './sitePlanEdit'

export interface PlanQuoteChange {
  /** What is changed, in plain words ("Side 3 to the drawn 142 ft"). */
  title: string
  /** The walk list or drawing change; none: the office makes the change in the builder (a count to match the plan). */
  edit: QuoteEdit | null
  /** Saved: the quote (unsigned), or the change order made (signed). */
  onSaved: (r: { quote?: SavedQuote; changeOrder?: ChangeOrder }) => void
  /** The builder closed (saved or not). */
  onClosed: () => void
}

/** Open the quote builder for the plan's change. False (and nothing opens) when the quote is not on this device and did not load. */
export async function openPlanChange(quoteId: string, change: PlanQuoteChange): Promise<boolean> {
  let q = getQuoteById(quoteId)
  if (!q || isSlimQuote(q)) {
    const full = await loadFullQuote(quoteId)
    if (full) q = full
  }
  if (!q) return false
  const signed = isSignedForChange(q)
  if (signed) await refreshChangeOrders(q.id)
  window.dispatchEvent(new CustomEvent('ezbiz:open-quote', { detail: { id: q.id, quote: signed ? quoteWithChanges(q) : q, changeOrder: signed, onYard: true, planChange: change } }))
  return true
}
