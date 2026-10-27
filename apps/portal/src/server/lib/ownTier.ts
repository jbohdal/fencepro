/**
 * A best price quote's own option shown as the tier it is the fence of
 * (web/src/proposalOptions.ts ownTierFold), frozen on the proposal as
 * `ownTier` when it is saved, so a sent proposal never changes its cards or
 * prices ("Sent proposals must never reprice", Jonathan, Oct 27 2026):
 *
 * - saved while not yet sent: the fold worked out now (or null, none);
 * - saved after it was sent: only the fold it already showed;
 * - sent with no fold frozen yet (a draft saved before this): the fold it
 *   showed while a draft is frozen at the moment it is sent.
 *
 * The customer's page reads it with proposalFold (routes/proposal.ts).
 */

import { pricingModule, estimateStyleList } from './estimates.js'

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Whether a quote's proposal has gone to the customer (web/src/proposalOptions.ts proposalSent, the same rule). */
export function proposalSent(q: { status?: string | null; acceptedAt?: unknown; soldAt?: unknown; firstViewedAt?: unknown; viewCount?: number | null }): boolean {
  return (q.status != null && q.status !== 'DRAFT') || !!q.acceptedAt || !!q.soldAt || !!q.firstViewedAt || (Number(q.viewCount) || 0) > 0
}

/** A style's record by name, for a combination made in Settings (old codes read without one). */
export async function styleRecords(): Promise<(name: string) => { material?: string; choices?: Record<string, string>; madeFrom?: string } | undefined> {
  const list = new Map((await estimateStyleList().catch(() => [])).map(s => [s.name, s]))
  return (name: string) => list.get(name)
}

/** The proposal with its fold frozen (`ownTier`), as a save keeps it. `sent`: the quote had gone to the customer before this save. */
export async function stampOwnTier(proposal: unknown, fenceStyle: string | null | undefined, before: unknown, sent: boolean): Promise<unknown> {
  if (!isObj(proposal) || !Array.isArray(proposal.options)) return proposal
  const m = await pricingModule()
  const ownTier = m.ownTierToStamp(proposal as any, { fenceStyle }, isObj(before) ? before as any : null, sent, await styleRecords())
  return { ...proposal, ownTier }
}
