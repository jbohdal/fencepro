/**
 * Which options a proposal shows, and which one starts selected.
 *
 * Pure: the server (routes/proposal.ts, through the estimate bundle) and the
 * app (ProposalSend's "N options offered") use the same rules.
 *
 * The same fence twice: a vinyl "best price" quote (6 or 8 ft panels, the
 * cheaper per run) often comes out all 8 ft panels, so its own option is the
 * Better tier's fence at the same price (audit Oct 26, 2026: a fourth card at
 * $7,363 next to Better at $7,363). Two options are the same fence when they
 * cost the same to the cent, carry the same warranty and the same parts in
 * the same amounts (the pull sheet, in any order). The first one is shown and
 * the later one is hidden. Nothing is taken off the saved proposal, so every
 * option keeps its place (the chosen option and the time per option are kept
 * by place).
 *
 * The option that starts selected: the one the quote was made with (its
 * style at its price), so a customer who signs without tapping an option
 * signs what the Salesman quoted. When that option is hidden as the same
 * fence as another, the one shown in its place. Only when the quote's own
 * option is not on the proposal: the recommended one.
 */

interface OptionLike {
  fenceStyle?: string
  tier?: { key?: string } | null
  finalPrice?: number
  warranty?: { name?: string } | null
  snapshot?: { pullSheet?: Array<{ item?: string; name?: string; qty?: number }> } | null
}

const cents = (n: unknown) => Math.round((Number(n) || 0) * 100)

/** What makes two options the same fence for the customer: price, warranty and the parts. '' when an option has no parts list (never matched). */
export function sameFenceKey(o: OptionLike | null | undefined): string {
  const sheet = o?.snapshot?.pullSheet
  if (!Array.isArray(sheet) || sheet.length === 0) return ''
  const parts = sheet
    .map(l => `${String(l?.item ?? l?.name ?? '').trim()}×${Math.round((Number(l?.qty) || 0) * 1000) / 1000}`)
    .sort()
    .join('|')
  return `${cents(o?.finalPrice)}#${String(o?.warranty?.name ?? '')}#${parts}`
}

/** For each option: the place of the earlier option it is the same fence as, or -1 (shown). */
export function sameFenceAs(options: OptionLike[] | null | undefined): number[] {
  const list = Array.isArray(options) ? options : []
  const first = new Map<string, number>()
  return list.map((o, i) => {
    const k = sameFenceKey(o)
    if (!k) return -1
    const at = first.get(k)
    if (at === undefined) { first.set(k, i); return -1 }
    return at
  })
}

/** The places of the options the customer sees, in the order shown (a folded tier: the quote's own option in its place). */
export function shownOptions(options: OptionLike[] | null | undefined, fold: { own: number; tier: number } | null = null): number[] {
  const shown = sameFenceAs(options).map((d, i) => (d < 0 ? i : -1)).filter(i => i >= 0)
  if (!fold) return shown
  return shown.filter(i => i !== fold.own).map(i => (i === fold.tier ? fold.own : i))
}

/**
 * The option selected when the page opens (not yet accepted): the quote's own
 * (its style at its price, else its style), shown in its place by its twin,
 * else `recommended`.
 */
export function startingOption(options: OptionLike[] | null | undefined, quote: { fenceStyle?: string | null; finalPrice?: number | null }, recommended: number): number {
  const list = Array.isArray(options) ? options : []
  if (!list.length) return 0
  const dup = sameFenceAs(list)
  const style = String(quote.fenceStyle ?? '')
  let own = style ? list.findIndex(o => o?.fenceStyle === style && cents(o?.finalPrice) === cents(quote.finalPrice)) : -1
  if (own < 0 && style) own = list.findIndex(o => o?.fenceStyle === style)
  const rec = Math.min(Math.max(0, recommended || 0), list.length - 1)
  const pick = own >= 0 ? own : rec
  return dup[pick] >= 0 ? dup[pick] : pick
}

// ── Reading a style name (tiers.ts builds tiers from it too) ─────────────────

export interface StyleParts {
  family: 'vinyl' | 'chain' | 'alum' | 'wood'
  /** The color or finish; wood: the picket grade (pine, premium), which its Good / Better tiers swap (Oct 30 2026). */
  color: string | null
  install: 'no-dig' | 'dig-set' | null
  /** Height in feet, as written in the name. */
  height: string
  /** Section width in feet; 'auto' for the auto mix styles; null where the family has one width. */
  width: number | 'auto' | null
  /** Aluminum model (Emily - 48, Ind Abigail). */
  model?: string
}

const VINYL = /^(WV|TV)-(ND|DS) (\d+)'x(\d+)' Privacy$/
const VINYL_AUTO = /^(WV|TV)-Auto (ND|DS) Privacy$/
const CHAIN = /^CL - (\d+)' (Galv|Black)$/
const ALUM = /^Alum - (ND|DS) - (.+)$/

/** What a style is, from its old code; a combination made in Settings (a color added later) from its choices. */
export function styleParts(name: string, style?: { material?: string; choices?: Record<string, string>; madeFrom?: string } | null): StyleParts | null {
  const fromCode = partsFromCode(name)
  if (fromCode || !style?.material || !style.choices) return fromCode
  const c = style.choices
  const install = c.install === 'nd' ? 'no-dig' : c.install === 'ds' ? 'dig-set' : null
  // Wood (wood.ts) is made from choices, never from a code: style is the model, the picket grade the "color".
  if (style.material === 'wood') return { family: 'wood', color: c.picket ?? null, install, height: c.height ?? '', width: c.width ? Number(c.width) : null, model: c.style }
  if (!style.madeFrom) return null
  if (style.material === 'vinyl') {
    return { family: 'vinyl', color: c.color ?? null, install, height: c.height ?? '', width: c.width === 'auto' ? 'auto' : Number(c.width), ...(c.style && c.style !== 'privacy' ? { model: c.style } : {}) }
  }
  if (style.material === 'chain') return c.grade === 'res' ? { family: 'chain', color: c.finish ?? null, install: c.install === 'ds' ? 'dig-set' : 'no-dig', height: c.height ?? '', width: null } : null
  if (style.material === 'alum') return { family: 'alum', color: null, install, height: c.height ?? '', width: null, model: c.panel }
  return null
}

function partsFromCode(name: string): StyleParts | null {
  let m = name.match(VINYL)
  if (m) return { family: 'vinyl', color: m[1] === 'WV' ? 'white' : 'tan', install: m[2] === 'ND' ? 'no-dig' : 'dig-set', height: m[3], width: Number(m[4]) }
  m = name.match(VINYL_AUTO)
  if (m) return { family: 'vinyl', color: m[1] === 'WV' ? 'white' : 'tan', install: m[2] === 'ND' ? 'no-dig' : 'dig-set', height: '6', width: 'auto' }
  m = name.match(CHAIN)
  // Every chain link style priced before Oct 2026 is the no dig one.
  if (m) return { family: 'chain', color: m[2] === 'Galv' ? 'galv' : 'black', install: 'no-dig', height: m[1], width: null }
  m = name.match(ALUM)
  if (m) return { family: 'alum', color: null, install: m[1] === 'ND' ? 'no-dig' : 'dig-set', height: '', width: null, model: m[2] }
  return null
}

// ── The quote's own best price option, folded into its tier ──────────────────

/** A style's record, for a combination made in Settings (its choices); old codes read without one. */
export type StyleRecordOf = (name: string) => { material?: string; choices?: Record<string, string>; madeFrom?: string } | null | undefined

/**
 * The quote's own "best price" option (6 or 8 ft panels, the cheaper per run) and the tier it is the fence
 * of: the same family, color, install, height and model, the tier taking whichever width prices lower (or
 * the quote's width). Shown once, as that tier with the quote's own price, and selected (review Oct 27
 * 2026: a fourth unlabeled card, cheaper than Better and selected). A best price quote that came out all
 * one width is the tier's fence at the same price already (sameFenceAs). Prices never change; only the
 * card the customer sees: the tier's card is the quote's own option, so signing it signs what was quoted.
 * null when there is nothing to fold.
 */
export function ownTierFold(options: OptionLike[] | null | undefined, quote: { fenceStyle?: string | null }, styleOf: StyleRecordOf = () => null, tierSpecs?: Array<{ key: string; width?: string }> | null): { own: number; tier: number } | null {
  const list = Array.isArray(options) ? options : []
  const style = String(quote.fenceStyle ?? '')
  if (!style) return null
  const dup = sameFenceAs(list)
  const own = list.findIndex(o => !o?.tier && o?.fenceStyle === style)
  if (own < 0 || dup[own] >= 0) return null
  const p = styleParts(style, styleOf(style))
  if (!p || p.width !== 'auto') return null
  const tier = list.findIndex((o, i) => {
    if (i === own || !o?.tier || dup[i] >= 0 || !o.fenceStyle) return false
    const spec = tierSpecs?.find(t => t.key === o.tier?.key)
    if (spec && spec.width !== 'cheapest' && spec.width !== 'same') return false
    const q = styleParts(o.fenceStyle, styleOf(o.fenceStyle))
    return !!q && q.family === p.family && q.color === p.color && q.install === p.install && q.height === p.height && (q.model ?? '') === (p.model ?? '')
  })
  return tier >= 0 ? { own, tier } : null
}

// ── Sent proposals never change ──────────────────────────────────────────────

/** Whether a quote's proposal has gone to the customer: no longer a draft, opened by the customer, signed or sold. */
export function proposalSent(q: { status?: string | null; acceptedAt?: unknown; soldAt?: unknown; firstViewedAt?: unknown; viewCount?: number | null } | null | undefined): boolean {
  if (!q) return false
  return (q.status != null && q.status !== 'DRAFT') || !!q.acceptedAt || !!q.soldAt || !!q.firstViewedAt || (Number(q.viewCount) || 0) > 0
}

type Fold = { own: number; tier: number }
interface FoldProposal { options?: OptionLike[] | null; tierSet?: { tiers?: Array<{ key: string; width?: string }> } | null; ownTier?: Fold | null }

/**
 * The fold the customer sees ("Sent proposals must never reprice", Jonathan, Oct 27 2026): the one frozen on
 * the proposal when it was saved (ownTier: the fold, or null for none), else, only for a proposal not yet
 * sent, the one worked out now. A proposal sent before folding existed keeps exactly the cards and prices it
 * went out with.
 */
export function proposalFold(p: FoldProposal | null | undefined, quote: Parameters<typeof proposalSent>[0] & { fenceStyle?: string | null }, styleOf: StyleRecordOf = () => null): Fold | null {
  if (!p || !quote) return null
  const now = ownTierFold(p.options, quote, styleOf, p.tierSet?.tiers)
  if (p.ownTier !== undefined) return p.ownTier && now && now.own === p.ownTier.own && now.tier === p.ownTier.tier ? now : null
  return proposalSent(quote) ? null : now
}

/**
 * What a save freezes on the proposal (the server's create and update): not yet sent, the fold worked out now;
 * sent, only the fold it already showed (none for one sent before folding existed), so a save never changes
 * the cards or prices of a sent proposal.
 */
export function ownTierToStamp(p: FoldProposal, quote: { fenceStyle?: string | null }, before: FoldProposal | null | undefined, sent: boolean, styleOf: StyleRecordOf = () => null): Fold | null {
  const now = ownTierFold(p.options, quote, styleOf, p.tierSet?.tiers)
  if (!sent) return now
  const was = before?.ownTier
  return was && now && was.own === now.own && was.tier === now.tier ? now : null
}
