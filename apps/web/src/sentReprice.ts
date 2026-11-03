/**
 * What a save would change on a sent or shared proposal, as the customer reads it (Jonathan's rule: a sent
 * proposal never reprices unless the office chooses it). The quote builder asks before such a save; the server
 * (routes/saved-quotes.ts, through the estimate bundle) keeps the sent prices on any save that did not choose.
 *
 * Pure, and no imports from the server's files: the server loads it from source too.
 */

import { proposalFold, type StyleRecordOf } from './proposalOptions'

interface CardOption {
  tier?: { key?: string; label?: string } | null
  fenceStyle?: string
  label?: string
  finalPrice?: number
  snapshot?: { runRails?: unknown } | null
}
interface CardProposal { options?: CardOption[] | null; ownTier?: { own: number; tier: number } | null; tierSet?: { tiers?: Array<{ key: string; width?: string }> } | null }
type CardQuote = { fenceStyle?: string | null; runRails?: unknown; status?: string | null; acceptedAt?: unknown; soldAt?: unknown; firstViewedAt?: unknown; viewCount?: number | null }
type SentProposal = CardProposal

/** A fence's plain name as people read it: no "(best price)" tag, "sections" never "panels". */
export function plainFence(label: unknown): string {
  return String(label ?? '').replace(/\s*\((?:best price|auto)\)/gi, '').replace(/(\d+ ft) panels\b/g, '$1 sections').trim()
}


/** Each card the customer reads on a proposal: its price in cents and its fence (a folded tier: the quote's own option in its place). */
function customerCards(p: SentProposal | null | undefined, quote: CardQuote, styleOf: StyleRecordOf): Map<string, { name: string; cents: number; label: string }> {
  const out = new Map<string, { name: string; cents: number; label: string }>()
  const options = Array.isArray(p?.options) ? p!.options! : []
  const fold = proposalFold(p as Parameters<typeof proposalFold>[0], quote as Parameters<typeof proposalFold>[1], styleOf)
  options.forEach((o, i) => {
    if (fold && i === fold.own) return
    const shown = fold && fold.tier === i ? options[fold.own] : o
    if (!shown) return
    // The fence: its words and the panels its runs took (the customer reads them: lib/customerFenceName.ts).
    const rails = Array.isArray(shown.snapshot?.runRails) && (shown.snapshot!.runRails as unknown[]).length ? shown.snapshot!.runRails : shown.fenceStyle === quote.fenceStyle ? quote.runRails : null
    const label = `${String(shown.label ?? '')}|${JSON.stringify(rails ?? null)}`
    const key = o?.tier?.key ? `tier:${o.tier.key}` : `fence:${o?.fenceStyle ?? ''}`
    const tierName = (o?.tier as { label?: string } | null | undefined)?.label
    // Named by its fence, not its card (one word per thing, Nov 2 2026: "No dig would be $340" read like a choice).
    const fence = plainFence(shown.label)
    if (!out.has(key)) out.set(key, { name: fence || tierName || String(shown.fenceStyle ?? ''), cents: Math.round((Number(shown.finalPrice) || 0) * 100), label })
  })
  return out
}

export interface ProposalPriceChange { name: string; wasCents: number | null; nowCents: number | null }

/**
 * What a save would change on the customer's proposal: each card whose price or fence differs, one that is new,
 * one that is gone (Jonathan's rule: a sent proposal never reprices unless the office chooses it). `after` is
 * the proposal as the save keeps it, its fold already stamped (lib/ownTier.ts). Empty: the customer sees the same.
 */
export function proposalPriceChanges(before: SentProposal | null | undefined, beforeQuote: CardQuote, after: SentProposal | null | undefined, afterQuote: CardQuote, styleOf: StyleRecordOf = () => null): ProposalPriceChange[] {
  const a = customerCards(before, beforeQuote, styleOf), b = customerCards(after, afterQuote, styleOf)
  const out: ProposalPriceChange[] = []
  for (const [k, was] of a) {
    const now = b.get(k)
    if (!now || now.cents !== was.cents || now.label !== was.label) out.push({ name: was.name, wasCents: was.cents, nowCents: now ? now.cents : null })
  }
  for (const [k, now] of b) if (!a.has(k)) out.push({ name: now.name, wasCents: null, nowCents: now.cents })
  return out
}
