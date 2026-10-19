/**
 * Good, Better, Best tier sets: the rules for a saved set and the starting
 * sets (pure; lib/tierSets.ts makes them in the database).
 *
 * Tier sets (model ProposalTierSet): one set per fence
 * category per company, up to three tiers each. The web app turns a tier into
 * a style and prices it (apps/web/src/tiers.ts); the server keeps the sets.
 *
 * The starting sets are made in the database once per company by
 * lib/tierSets.ts ensureTierSets.
 *
 * Starting sets use only styles that exist in Settings → Fence Styles:
 *   Vinyl     Good dig set, Better no dig (Most popular), Best no dig all 6 ft
 *             wide; color always the quote's own.
 *   Chainlink Two options (Oct 2026): Dig set with concrete, No dig (Most
 *             popular). The dig set one shows once its prices are in.
 *   Aluminum  Two options: Dig set with concrete, No dig (Most popular).
 * A category whose styles are not there starts empty, and Settings asks for
 * tiers to be added.
 *
 * Old settings: before tier sets, the lineup lived in config.proposal.tiers
 * (label, color, install, height, blurb) and config.proposal.popular. When the
 * vinyl set is first made, anything there that differs from the old defaults
 * (his own edits) is kept; untouched old defaults take the new lineup.
 */

import { z } from 'zod'

export const MAX_TIERS = 3

export const tierSpecSchema = z.object({
  key: z.string().min(1).max(40).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1, 'Every tier needs a name').max(40),
  install: z.enum(['same', 'no-dig', 'dig-set']),
  width: z.enum(['same', 'cheapest', '6', '8']),
  color: z.enum(['same', 'white', 'tan', 'galv', 'black']),
  style: z.string().max(200).nullable().optional(),
  priceAdjustPct: z.number().min(-50).max(100).nullable().optional(),
  text: z.string().max(400).default(''),
})
export type TierSpec = z.infer<typeof tierSpecSchema>

export const tierSetBodySchema = z.object({
  tiers: z.array(tierSpecSchema).max(MAX_TIERS, `A set has at most ${MAX_TIERS} tiers`)
    .refine(list => new Set(list.map(t => t.key)).size === list.length, 'Two tiers have the same key'),
  popular: z.string().max(40).nullable().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
})

// ── The starting sets ────────────────────────────────────────────────────────

export const VINYL_STARTER: TierSpec[] = [
  { key: 'good', name: 'Good', install: 'dig-set', width: 'cheapest', color: 'same', text: 'Posts set in concrete. Solid fence at the best price.' },
  { key: 'better', name: 'Better', install: 'no-dig', width: 'cheapest', color: 'same', text: 'Steel pipe driven deep, no concrete, faster install.' },
  { key: 'best', name: 'Best', install: 'no-dig', width: '6', color: 'same', text: 'More posts per foot for the strongest fence we build.' },
]
/** Aluminum and chain link show two options, not Good Better Best (Jonathan, Oct 2026). */
export const CHAIN_STARTER: TierSpec[] = [
  { key: 'good', name: 'Dig set with concrete', install: 'dig-set', width: 'same', color: 'same', text: 'Posts set in concrete.' },
  { key: 'better', name: 'No dig', install: 'no-dig', width: 'same', color: 'same', text: 'Thick Schedule 40 steel pipe, no concrete.' },
]
export const ALUM_STARTER: TierSpec[] = [
  { key: 'good', name: 'Dig set with concrete', install: 'dig-set', width: 'same', color: 'same', text: 'Standard aluminum post set in concrete.' },
  { key: 'better', name: 'No dig', install: 'no-dig', width: 'same', color: 'same', text: 'Aluminum post with a steel I beam insert inside, no concrete.' },
]
/** The tier marked Most popular in the two option sets: No dig. */
export const TWO_OPTION_POPULAR = 'better'

/** The lineup before tier sets (web tiers.ts DEFAULT_TIERS as of Oct 2026). */
const OLD_DEFAULTS: Record<string, { label: string; color: string; install: string; blurb: string }> = {
  good: { label: 'Good', color: 'white', install: 'dig-set', blurb: 'Dig set: posts set in concrete.' },
  better: { label: 'Better', color: 'white', install: 'no-dig', blurb: 'No dig: steel pipe driven deep, no concrete, faster install.' },
  best: { label: 'Best', color: 'tan', install: 'no-dig', blurb: 'Tan: premium color, on steel pipe driven deep with no concrete.' },
}

/** The vinyl set, with any edits made to the old Settings → Proposals lineup kept. */
export function vinylFromOldSettings(proposal: unknown): { tiers: TierSpec[]; popular: string | null } {
  const p = (proposal && typeof proposal === 'object' ? proposal : {}) as { tiers?: unknown; popular?: unknown }
  const old = Array.isArray(p.tiers) ? (p.tiers as any[]).filter(t => t && typeof t === 'object' && typeof t.key === 'string') : []
  const tiers = VINYL_STARTER.map(t => {
    const o = old.find(x => x.key === t.key)
    const d = OLD_DEFAULTS[t.key]
    if (!o || !d) return { ...t }
    const out: TierSpec = { ...t }
    if (typeof o.label === 'string' && o.label.trim() && o.label.trim() !== d.label) out.name = o.label.trim().slice(0, 40)
    if (typeof o.blurb === 'string' && o.blurb.trim() !== d.blurb) out.text = o.blurb.trim().slice(0, 400)
    if ((o.install === 'no-dig' || o.install === 'dig-set') && o.install !== d.install) out.install = o.install
    if ((o.color === 'white' || o.color === 'tan') && o.color !== d.color) out.color = o.color
    return out
  })
  const popular = typeof p.popular === 'string' && p.popular !== 'better' && tiers.some(t => t.key === p.popular) ? p.popular : 'better'
  return { tiers, popular }
}

interface Starter { key: string; category: string; tiers: TierSpec[]; popular: string | null; sortOrder: number }

/** The starting sets for a company, from its styles (and old tier settings). */
export function startersFor(config: unknown): Starter[] {
  const cfg = (config && typeof config === 'object' ? config : {}) as { fenceStyles?: unknown; proposal?: unknown }
  const styles = (Array.isArray(cfg.fenceStyles) ? cfg.fenceStyles : []) as Array<{ name?: unknown; category?: unknown; isActive?: unknown }>
  const named = styles.filter(s => typeof s?.name === 'string' && s.isActive !== false) as Array<{ name: string; category?: string }>
  const catOf = (re: RegExp, fallback: string) => named.find(s => re.test(s.name) && typeof s.category === 'string' && s.category.trim())?.category?.trim() ?? fallback

  const vinyl = vinylFromOldSettings(cfg.proposal)

  const chainOk = named.some(s => /^CL - \d+' (Galv|Black)$/.test(s.name))

  const alumModels = (m: string) => new Set(named.map(s => s.name.match(new RegExp(`^Alum - ${m} - (.+)$`))?.[1]).filter(Boolean))
  const nd = alumModels('ND'), ds = alumModels('DS')
  const alumOk = [...nd].some(x => ds.has(x))

  return [
    { key: 'vinyl', category: catOf(/^(WV|TV)-/, 'Vinyl'), tiers: vinyl.tiers, popular: vinyl.popular, sortOrder: 0 },
    { key: 'chainlink', category: catOf(/^CL - \d+' (Galv|Black)$/, 'Chainlink'), tiers: chainOk ? CHAIN_STARTER : [], popular: chainOk ? TWO_OPTION_POPULAR : null, sortOrder: 1 },
    { key: 'aluminum', category: catOf(/^Alum - (ND|DS) - /, 'Aluminum'), tiers: alumOk ? ALUM_STARTER : [], popular: alumOk ? TWO_OPTION_POPULAR : null, sortOrder: 2 },
  ]
}

