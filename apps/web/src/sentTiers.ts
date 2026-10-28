/**
 * The Good / Better / Best cards of a proposal that has gone out, as the customer reads them: the quote
 * builder's Price step shows these under "As sent to the customer" while the fence is unchanged
 * (review Oct 27 2026: Carlton Williams' sent best price quote read Good $8,780 on the Price step, priced
 * at today's dig set costs, while his proposal said Good $9,407).
 *
 * Read only from the options frozen on the proposal when it was saved ("Sent proposals must never reprice"):
 * each tier's price, per foot and fence name; a best price quote folded into a tier (proposalOptions.ts
 * proposalFold, the customer page's rule) shows its own option in that tier's place. Nothing is priced here.
 */

import { proposalFold, type StyleRecordOf } from './proposalOptions'
import { customerFenceName, railsOf } from '../../portal/src/server/lib/customerFenceName'

export interface SentTierCard {
  /** The tier's price on the proposal, in dollars (cents exact: the frozen option's finalPrice). */
  price: number
  perFoot: number
  /** The fence as the customer reads it ("White Vinyl Privacy, 6 ft tall, 6 ft and 8 ft panels, No dig"). */
  label: string
  /** The option's place on the proposal (the quote's own option when folded into this tier). */
  at: number
  /** The quote's own best price option shown as this tier. */
  own: boolean
}

interface SentOption {
  tier?: { key?: string } | null
  fenceStyle?: string
  label?: string
  finalPrice?: number
  perFoot?: number
  snapshot?: { runRails?: unknown } | null
}

interface SentProposal {
  options?: SentOption[] | null
  ownTier?: { own: number; tier: number } | null
  tierSet?: { tiers?: Array<{ key: string; width?: string }> } | null
}

/** Each tier key on the proposal → its card as the customer reads it. Empty when the proposal has no tier options. */
export function sentTierCards(
  p: SentProposal | null | undefined,
  quote: { fenceStyle?: string | null; runRails?: unknown; status?: string | null; acceptedAt?: unknown; soldAt?: unknown; firstViewedAt?: unknown; viewCount?: number | null },
  styleOf: StyleRecordOf = () => null,
): Record<string, SentTierCard> {
  const out: Record<string, SentTierCard> = {}
  const options = Array.isArray(p?.options) ? p!.options! : []
  if (!options.length) return out
  const fold = proposalFold(p as Parameters<typeof proposalFold>[0], quote as Parameters<typeof proposalFold>[1], styleOf)
  options.forEach((o, i) => {
    const key = o?.tier?.key
    if (!key || out[key]) return
    const at = fold && fold.tier === i ? fold.own : i
    const shown = options[at]
    if (!shown) return
    out[key] = {
      price: Number(shown.finalPrice) || 0,
      perFoot: Number(shown.perFoot) || 0,
      label: customerFenceName(shown.label, railsOf(shown, shown.fenceStyle === quote.fenceStyle ? quote.runRails : null)),
      at,
      own: at !== i,
    }
  })
  return out
}

/**
 * The line over the tiers of a quote that has gone out, said as it is (review Oct 27 2026: after the yard was
 * changed it still said "as they were when this proposal was sent" over all new prices). A save freezes the
 * options it is saved with (routes/saved-quotes.ts); sending again freezes nothing new, so once the fence is
 * changed, saving the quote is what puts the new prices on the customer's link. A signed quote's proposal
 * never changes (a change order carries the change).
 */
export function sentTiersNote(s: { asSent: boolean; fenceChanged: boolean; signed: boolean; sentPricesChanged: boolean }): { kind: 'sent' | 'changed' | 'repriced'; text: string } {
  const went = s.signed ? 'signed' : 'sent'
  if (s.asSent) return { kind: 'sent', text: `As ${went}: the prices on the customer's proposal.` }
  if (!s.fenceChanged) return { kind: 'repriced', text: `The choices this proposal was ${went} with, priced today.` }
  if (s.signed) return { kind: 'changed', text: 'The fence was changed after it was signed: these are new prices. The signed proposal does not change; the change goes on a change order.' }
  return {
    kind: 'changed',
    text: `The fence was changed after this proposal was sent: these are new prices. The customer's proposal keeps the sent prices until this quote is saved; saving puts these new prices on it${s.sentPricesChanged ? ' (unless you keep the sent prices when asked)' : ''}.`,
  }
}
