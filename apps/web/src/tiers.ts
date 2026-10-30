/**
 * Good, Better, Best. Each fence category (Vinyl, Chainlink, Aluminum, ...)
 * has one tier set of up to three tiers, kept on the server (/api/tier-sets,
 * edited in Settings → Good Better Best; the server makes the starting sets
 * once). A tier says how it differs from the quote's own style: install
 * method, section width, color, or one specific style. For each quote it is
 * turned into a real style from Settings → Fence Styles and priced with
 * priceOption, the quote builder's own math. A tier that cannot be built for
 * this quote says why.
 */

import { priceOption, type ProposalOption } from './proposal'
import { sectionWidthForStyle } from './materialCalculator'
import { deriveLayout, layoutForShape, type YardLayout } from './yardLayout'
import { layoutPanelFt } from './gateSlide'
import type { QuoteCalcInput, QuoteStyle } from './quoteCalc'
import { isQuotable } from './styleAvailability'
import { styleLabel, colorNamesOf } from './fenceCatalog'
import { styleParts, ownTierFold, sameFenceAs, type StyleParts, type StyleRecordOf } from './proposalOptions'

export { styleParts, type StyleParts }

export type TierKey = string
export type TierInstall = 'same' | 'no-dig' | 'dig-set'
export type TierWidth = 'same' | 'cheapest' | '6' | '8'
/** 'same', or a color / finish key from Settings → Fence styles ('white', 'tan', 'galv', 'black', or one added later). */
export type TierColor = string

export interface TierSpec {
  /** Fixed when the tier is made; quotes remember tiers left off or swapped by it. */
  key: TierKey
  name: string
  install: TierInstall
  width: TierWidth
  color: TierColor
  /** One specific style; wins over install, width and color. */
  style?: string | null
  /** Added to the price, in percent (5 = 5% more). */
  priceAdjustPct?: number | null
  /** What makes this tier better, shown on the proposal. */
  text: string
}

export interface TierSet {
  id: string
  /** The fence style category it is for (Settings → Fence Styles). */
  category: string
  tiers: TierSpec[]
  /** The tier shown "Most popular", if any. */
  popular: TierKey | null
  sortOrder: number
  version: number
  updatedAt?: string
}

/** Most tiers in one set. */
export const MAX_TIERS = 3

export const INSTALL_LABEL: Record<TierInstall, string> = { same: 'Same as the quote', 'no-dig': 'No dig', 'dig-set': 'Dig set' }
export const WIDTH_LABEL: Record<TierWidth, string> = { same: 'Same as the quote', cheapest: 'Whichever width prices lower (6 or 8 ft)', '6': 'All 6 ft wide sections', '8': 'All 8 ft wide sections' }
export const COLOR_LABEL: Record<string, string> = { same: 'Same as the quote' }

/** A tier color's name: the color's name in Settings (fenceCatalog.ts colorNamesOf; the default tree when none is given). */
export function colorLabel(key: string, names: Record<string, string> = colorNamesOf(null)): string {
  return COLOR_LABEL[key] ?? names[key] ?? key
}

/** The style photo name a tier's own photo is kept under (Settings photos, /api/style-photos). */
export const tierPhotoName = (category: string, key: TierKey) => `tier:${category}:${key}`

// ── Reading a style name ─────────────────────────────────────────────────────

// styleParts lives with the proposal's option rules (proposalOptions.ts), which the server's proposal page uses too.

/** "tan, no dig, 6 ft tall, 6 ft wide vinyl privacy" */
function describe(p: { family: StyleParts['family']; color: string | null; install: string | null; height: string; width: number | 'auto' | null | 'any'; model?: string }): string {
  const bits: string[] = []
  if (p.color) bits.push(colorLabel(p.color).toLowerCase())
  if (p.install) bits.push(p.install === 'no-dig' ? 'no dig' : 'dig set')
  if (p.height) bits.push(`${p.height} ft tall`)
  if (p.width === 'auto') bits.push('auto mix (6 and 8 ft wide)')
  else if (typeof p.width === 'number') bits.push(`${p.width} ft wide`)
  const what = p.family === 'vinyl' ? 'vinyl privacy' : p.family === 'chain' ? 'chain link' : `aluminum ${p.model ?? ''}`.trim()
  return `${bits.join(', ')}${bits.length ? ' ' : ''}${what}`
}

function widthOf(s: QuoteStyle, p: StyleParts): number | 'auto' {
  return p.width ?? sectionWidthForStyle(s.name, s.panelWidth)
}

// ── Turning a tier into a style for one quote ────────────────────────────────

export interface ResolvedTier {
  spec: TierSpec
  category: string
  popular: boolean
  /** Left off this quote's proposal. */
  off: boolean
  /** The style swapped in by hand on this quote, when it was. */
  swapped: boolean
  /** The style and its price; missing when the tier cannot be built for this quote. */
  style?: QuoteStyle
  option?: ProposalOption
  /** Why the tier has no style for this quote. */
  reason?: string
  /** The width used, and the other width's price, when the tier picked the cheaper one. */
  widthFt: number | null
  otherWidth: { widthFt: number; price: number } | null
  /**
   * The other width exists but is not available for quoting (8 ft tall
   * waiting for its Settings prices): the width used is the only one priced,
   * not the cheaper one. `held` says why.
   */
  otherWidthHeld?: { widthFt: number; held: string } | null
  /** An earlier tier that came out as the same style for this yard. */
  sameAs?: string
}

type Active<S> = S & { isActive?: boolean; quotable?: boolean }

/** The style a tier stands for on a quote of `own`, or why there is none. */
export function tierStyles<S extends QuoteStyle & { isActive?: boolean; quotable?: boolean }>(spec: TierSpec, own: QuoteStyle, styles: Active<S>[]):
  { styles: S[]; pickCheaper: boolean; heldWidths?: Array<{ widthFt: number; held: string }> } | { reason: string } {
  // Only styles that are turned on and available for quoting (commercial and industrial are on hold).
  const active = styles.filter(isQuotable)
  if (spec.style) {
    const s = active.find(x => x.name === spec.style)
    if (s) return { styles: [s], pickCheaper: false }
    const held = styles.find(x => x.name === spec.style && x.isActive !== false)
    return { reason: held ? `The style ${spec.style} is not available for quoting (Settings → Fence Styles).` : `The style ${spec.style} is not turned on in Settings → Fence Styles.` }
  }
  const p = styleParts(own.name, own as Parameters<typeof styleParts>[1])
  if (!p) return { reason: `This quote's style (${own.name}) is not one tiers can be built from. Pick a specific style for this tier in Settings → Good Better Best.` }
  const color = spec.color === 'same' ? p.color : spec.color
  const install = spec.install === 'same' ? p.install : spec.install
  if (p.color === null && spec.color !== 'same') return { reason: `${cap(describe({ ...p, color: null, install: null, width: null }))} has no color choice; set this tier's color to Same as the quote.` }
  if (p.install === null && spec.install !== 'same') return { reason: `Chain link has no ${spec.install === 'no-dig' ? 'no dig' : 'dig set'} choice; set this tier's install to Same as the quote.` }
  const width: number | 'auto' | 'any' | null =
    spec.width === 'same' ? p.width
      : spec.width === 'cheapest' ? (p.width === null ? null : 'any')
        : Number(spec.width)
  const fits = (s: Active<S>) => {
    const q = styleParts(s.name, s as Parameters<typeof styleParts>[1])
    if (!q || q.family !== p.family || q.height !== p.height || (q.model ?? '') !== (p.model ?? '')) return false
    if (q.color !== color || q.install !== install) return false
    if (width === 'any') return q.width !== 'auto'
    if (width === null) return true
    return widthOf(s, q) === width
  }
  const found = active.filter(fits)
  if (found.length === 0) {
    const want = describe({ ...p, color, install, width: width === 'any' ? null : width })
    // There is one, held back by the choice tree (a dig set waiting for its prices).
    const held = styles.find(s => s.isActive !== false && (s as { held?: string }).held && fits(s))
    if (held) return { reason: `${cap(want)} is not available for quoting yet: ${(held as { held?: string }).held}.` }
    return { reason: `No ${want} style is turned on in Settings → Fence Styles.` }
  }
  // The cheaper width: a width that exists but is held back is said, not compared.
  const heldWidths: Array<{ widthFt: number; held: string }> = []
  if (width === 'any') {
    for (const s of styles) {
      if (s.isActive === false || isQuotable(s) || !fits(s)) continue
      const w = widthOf(s, styleParts(s.name, s as Parameters<typeof styleParts>[1])!)
      if (typeof w !== 'number' || found.some(f => widthOf(f, styleParts(f.name, f as Parameters<typeof styleParts>[1])!) === w) || heldWidths.some(h => h.widthFt === w)) continue
      heldWidths.push({ widthFt: w, held: (s as { held?: string }).held || (s.quotable === false ? 'switched off in Settings → Fence Styles' : 'not available for quoting') })
    }
  }
  return { styles: found, pickCheaper: width === 'any', ...(heldWidths.length ? { heldWidths } : {}) }
}

export function resolveTiers<S extends QuoteStyle & { isActive?: boolean; quotable?: boolean }>(
  input: QuoteCalcInput, styles: Active<S>[], set: Pick<TierSet, 'category' | 'tiers' | 'popular'> | null | undefined,
  prefs: TierPrefs = { off: [], swap: {} },
): ResolvedTier[] {
  const own = input.style
  if (!set || !own) return []
  const out: ResolvedTier[] = []
  for (const spec of set.tiers) {
    const base = { spec, category: set.category, popular: spec.key === set.popular, off: prefs.off.includes(spec.key), widthFt: null as number | null, otherWidth: null as ResolvedTier['otherWidth'] }
    // The price this tier adds on, through the quote's own Price adjust.
    const tierInput: QuoteCalcInput = { ...input, priceAdjust: (input.priceAdjust || 0) + (Number(spec.priceAdjustPct) || 0) / 100 }
    const swapName = prefs.swap[spec.key]
    const swapStyle = swapName ? styles.find(s => s.name === swapName && isQuotable(s)) : undefined
    if (swapStyle) {
      out.push({ ...base, swapped: true, style: swapStyle, option: priceOption(tierInput, swapStyle) })
      continue
    }
    const r = tierStyles(spec, own, styles)
    if ('reason' in r) { out.push({ ...base, swapped: false, reason: r.reason }); continue }
    const priced = r.styles.map(s => ({ s, o: priceOption(tierInput, s), w: styleParts(s.name, s as Parameters<typeof styleParts>[1])?.width }))
    // The cheaper width; on a tie the wider one (fewer posts to set).
    priced.sort((a, b) => a.o.finalPrice - b.o.finalPrice || (typeof b.w === 'number' && typeof a.w === 'number' ? b.w - a.w : 0))
    const pick = priced[0]
    const res: ResolvedTier = { ...base, swapped: false, style: pick.s, option: pick.o }
    if (r.pickCheaper && typeof pick.w === 'number') {
      res.widthFt = pick.w
      const other = priced.find(x => typeof x.w === 'number' && x.w !== pick.w)
      if (other) res.otherWidth = { widthFt: other.w as number, price: other.o.finalPrice }
      else if (r.heldWidths?.length) res.otherWidthHeld = r.heldWidths[0]
    }
    out.push(res)
  }
  for (let i = 0; i < out.length; i++) {
    const earlier = out.slice(0, i).find(t => t.style && out[i].style && t.style.name === out[i].style!.name)
    if (earlier) out[i].sameAs = earlier.spec.name
  }
  return out
}

/** Choices made on one quote: tiers left off, and tiers swapped to another style. */
export interface TierPrefs { off: TierKey[]; swap: Partial<Record<TierKey, string>> }

/** Tier options as they go on the proposal: name, text, badge and the tier's own photo. */
export function tierOptions(tiers: ResolvedTier[], photoIds: Record<string, string> = {}): ProposalOption[] {
  return tiers.filter(t => !t.off && t.option && t.style).map(t => ({
    ...t.option!,
    label: styleLabel(t.style!.name),
    tier: { key: t.spec.key, label: t.spec.name, blurb: t.spec.text },
    badge: t.popular ? 'Most popular' : undefined,
    photoId: photoIds[tierPhotoName(t.category, t.spec.key)] ?? undefined,
  }))
}

/**
 * The tier whose card shows a best price quote's own option on the proposal (proposalOptions.ts ownTierFold),
 * worked out on the options exactly as the proposal is saved: the tiers offered first, then the quote's own
 * option at the quote's price (`own`). The quote builder's Price step shows that tier at the quote's price and
 * panels, so the Salesman reads the number the customer reads (review Oct 27 2026: the builder said Better
 * $8,593, all 8 ft panels; the proposal's Better card said $8,409, 6 ft and 8 ft panels). null: no fold.
 */
export function ownTierKey(tiers: ResolvedTier[], own: ProposalOption | null | undefined, styleOf: StyleRecordOf = () => null, tierSpecs?: Array<{ key: string; width?: string }> | null): TierKey | null {
  if (!own) return null
  const opts = tierOptions(tiers)
  if (opts.some(o => o.fenceStyle === own.fenceStyle)) return null
  const fold = ownTierFold([...opts, own], { fenceStyle: own.fenceStyle }, styleOf, tierSpecs)
  return fold ? opts[fold.tier]?.tier?.key ?? null : null
}

/**
 * The tier whose card is the quote's own fence when a best price quote came out all one width (a uniform yard):
 * its own option is the same fence at the same price as that tier (proposalOptions.ts sameFenceAs), so the
 * proposal shows the tier's own card and opens with it selected (startingOption). The Price step marks that card
 * "Main option" (review Oct 28 2026: a uniform yard showed "Make main" on all three cards, none highlighted).
 * null when the quote's style is itself a tier's style (that card is main by name) or no tier is its twin.
 */
export function twinTierKey(tiers: ResolvedTier[], own: ProposalOption | null | undefined): TierKey | null {
  if (!own) return null
  const opts = tierOptions(tiers)
  if (opts.some(o => o.fenceStyle === own.fenceStyle)) return null
  const at = sameFenceAs([...opts, own])[opts.length]
  return at >= 0 ? opts[at]?.tier?.key ?? null : null
}

/**
 * The fold a quote's proposal keeps once sent ("Sent proposals must never reprice", lib/ownTier.ts): the tier key of
 * the fold frozen on it when saved; null when none was frozen (sent before folding existed, or nothing to fold).
 */
export function frozenOwnTierKey(p: { ownTier?: { own: number; tier: number } | null; options?: Array<{ tier?: { key?: string } | null }> | null } | null | undefined): TierKey | null {
  const f = p?.ownTier
  if (!f || !Array.isArray(p?.options)) return null
  return p!.options![f.tier]?.tier?.key ?? null
}

/** The tier set for a style's category, if there is one. */
export function tierSetFor<T extends { category: string }>(sets: T[] | null | undefined, style: { category?: string } | undefined): T | null {
  if (!sets || !style?.category) return null
  const c = style.category.trim().toLowerCase()
  return sets.find(s => s.category.trim().toLowerCase() === c) ?? null
}

// ── Sample yards for the Settings preview ────────────────────────────────────

export interface SampleYard { key: string; label: string; layout: () => YardLayout }

function withLengths(shape: 'straight' | 'backyard', feet: number[], gates: Array<[number, 'walk' | 'double']>): YardLayout {
  const l = layoutForShape(shape)
  l.sides = l.sides.map((s, i) => {
    const g = gates.find(([at]) => at === i)
    return { ...s, lengthIn: feet[i] * 12, gate: g ? { type: g[1], widthIn: g[1] === 'walk' ? 48 : 120, position: 'middle' } : null }
  })
  return l
}

export const SAMPLE_YARDS: SampleYard[] = [
  { key: 'straight150', label: '150 ft straight line, 1 walk gate', layout: () => withLengths('straight', [150], [[0, 'walk']]) },
  { key: 'backyard300', label: '300 ft backyard, 1 walk gate and 1 double gate', layout: () => withLengths('backyard', [30, 60, 120, 60, 30], [[0, 'walk'], [2, 'double']]) },
  { key: 'backyard450', label: '450 ft backyard, 1 walk gate', layout: () => withLengths('backyard', [30, 120, 150, 120, 30], [[0, 'walk']]) },
]

/** A sample yard as the quote math takes it, measured and counted by the same yard layout rules as a quote. */
export function sampleInput(yardKey: string, style: QuoteStyle, pricing: QuoteCalcInput['pricing'], optimizer: QuoteCalcInput['optimizer']): QuoteCalcInput {
  const yard = (SAMPLE_YARDS.find(y => y.key === yardKey) ?? SAMPLE_YARDS[0]).layout()
  const widthFt = layoutPanelFt(style)
  const r = deriveLayout(yard, widthFt * 12)
  return {
    style, runs: r.runs.map(x => ({ ft: x.ft, rail: 'auto' as const })),
    corners: r.corners, ends: r.ends, walkGates: r.walkGates, dblGates: r.dblGates,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
    pricing, overrides: {}, optimizer,
  }
}

function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1) }
