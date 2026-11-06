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

import { priceOption, gateWarnings, type ProposalOption } from './proposal'
import { sectionWidthForStyle } from './materialCalculator'
import { deriveLayout, layoutForShape, type YardLayout } from './yardLayout'
import { layoutPanelFt } from './gateSlide'
import type { QuoteCalcInput, QuoteStyle } from './quoteCalc'
import { isQuotable } from './styleAvailability'
import { styleLabel, colorNamesOf } from './fenceCatalog'
import { styleParts, ownTierFold, sameFenceAs, type StyleParts, type StyleRecordOf } from './proposalOptions'
import { warrantyForStyle, type WarrantySettings } from './warranties'

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
/**
 * What the styles in a category let a tier change (Settings → Good / Better /
 * Best). Section width is offered only where the category has more than one
 * width (vinyl 6 and 8 ft); wood is 8 ft only, so its tiers never offer "All
 * 6 ft wide sections" or "Whichever width prices lower" (review Oct 30 2026).
 */
export function tierChoicesFor(styles: Array<Parameters<typeof styleParts>[1] & { name: string }>): { colors: TierColor[]; installs: TierInstall[]; widths: TierWidth[] } {
  const parts = styles.map(s => styleParts(s.name, s)).filter(Boolean)
  const colors = [...new Set(parts.map(p => p!.color).filter(Boolean))] as TierColor[]
  const installs = [...new Set(parts.map(p => p!.install).filter(Boolean))] as TierInstall[]
  const widths = new Set(parts.map(p => p!.width).filter(w => typeof w === 'number'))
  return {
    colors: ['same', ...colors] as TierColor[],
    installs: ['same', ...installs] as TierInstall[],
    widths: (widths.size > 1 ? ['same', 'cheapest', '6', '8'] : ['same']) as TierWidth[],
  }
}

export const WIDTH_LABEL: Record<TierWidth, string> = { same: 'Same as the quote', cheapest: '6 ft or 8 ft sections (best price)', '6': 'All 6 ft wide sections', '8': 'All 8 ft wide sections' }
/** Wood's picket grades are its tier "colors" (wood.ts WOOD_GRADES); they are a choice, not a color in Settings. */
export const COLOR_LABEL: Record<string, string> = {
  same: 'Same as the quote', pine: 'PT Pine pickets', premium: 'Alta Premium pickets',
  // Farm fence grades: wire and posts (farm.ts; proposalOptions.ts styleParts).
  'hutch-5': 'Hutchison Western wire, 5" posts', 'hutch-6': 'Hutchison Western wire, 6" posts',
  'redbrand-5': 'Red Brand wire, 5" posts', 'redbrand-6': 'Red Brand wire, 6" posts',
  'none-5': 'No wire, 5" posts', 'none-6': 'No wire, 6" posts',
}

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
  const what = p.family === 'vinyl' ? 'vinyl privacy' : p.family === 'chain' ? 'chain link' : p.family === 'wood' ? `wood ${p.model ?? ''}`.trim() : p.family === 'farm' ? 'farm fence' : `aluminum ${p.model ?? ''}`.trim()
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
  /** An option added on this quote ("Add option"), not one of the tier set's. */
  added?: boolean
  /** The style picked here is off for quoting now, so this tier went back to automatic: staff are told. */
  swapOff?: string
  /** Swapped to a style the tier would not have picked itself, so the tier's name, words and photo are not this fence's (tierOptions). */
  ownWords?: boolean
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

/**
 * How the tiers resolve. `ownCardAsSent`: a sent proposal that went out with the quote's own fence as a card of its
 * own (ownCardAsSent below): "whichever prices lower" takes a fixed width as it did then, the quote's own fence is not
 * put on a tier card and Most popular stays where it was, so a save keeps the cards as sent ("Sent quotes must never
 * reprice"; review Nov 3 2026: a Salesman's Good swapped to Aluminum put a warranty on every old card).
 */
export interface ResolveOptions { ownCardAsSent?: boolean }

/**
 * Did this proposal go out with the quote's own fence as a card of its own (no tier on it)? Proposals saved before
 * "make the main quote price equal Better" (Nov 2 2026) did; their tiers keep resolving as they went out.
 */
export function ownCardAsSent(p: { options?: Array<{ fenceStyle?: string | null; tier?: unknown } | null> | null } | null | undefined, ownName: string | null | undefined): boolean {
  return !!ownName && Array.isArray(p?.options) && p!.options!.some(o => !!o && o.fenceStyle === ownName && !o.tier)
}

/** The style a tier stands for on a quote of `own`, or why there is none. */
export function tierStyles<S extends QuoteStyle & { isActive?: boolean; quotable?: boolean }>(spec: TierSpec, own: QuoteStyle, styles: Active<S>[], opts: ResolveOptions = {}):
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
  // Farm fence with no wire (4 board): a tier never adds wire, it takes only the tier's post size (Jonathan, Nov 5 2026).
  const color = spec.color === 'same' ? p.color
    : p.family === 'farm' && p.color?.startsWith('none-') && /^[a-z]+-\d+$/.test(spec.color) ? `none-${spec.color.split('-')[1]}`
      : spec.color
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
    // Whichever prices lower: the best price mix (6 or 8 ft per run) is one of the widths, so Better on a best price
    // quote is the quote's own fence at the quote's price (Jonathan, Nov 2 2026: "make the main quote price equal Better").
    // A proposal sent with the quote's own card keeps the fixed widths it went out with (ResolveOptions).
    if (width === 'any') return !opts.ownCardAsSent || q.width !== 'auto'
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

/**
 * Styles priced for one yard, the cheapest first; on a tie the best price mix, then the wider width (fewer posts to
 * set). The tiers' "whichever width prices lower" and the Salesman's quote (salesmanPicks.ts) pick with this, so the
 * two land on the same fence.
 */
export function pricedCheapestFirst<S extends QuoteStyle>(input: QuoteCalcInput, styles: S[]): Array<{ s: S; o: ProposalOption; w: number | 'auto' | null | undefined }> {
  const priced = styles.map(s => ({ s, o: priceOption(input, s), w: styleParts(s.name, s as Parameters<typeof styleParts>[1])?.width }))
  // Like with like: the slider is the main option's only, so with one on the quote, the quote's own fence would rank
  // dearer than its other widths and lose "whichever prices lower" (review Nov 3 2026: the Salesman's +10% quote
  // became the 8 ft fence, no longer the Better card). Ranked as if every width took it, as before Nov 3 2026.
  const slider = !!input.priceAdjust || !!input.sliderOn
  const cents = slider
    ? new Map(styles.map(s => [s.name, Math.round(priceOption({ ...input, sliderOn: styles.map(x => x.name), sliderTier: undefined }, s).finalPrice * 100)]))
    : null
  const at = (x: { s: S; o: ProposalOption }) => cents ? cents.get(x.s.name)! : Math.round(x.o.finalPrice * 100)
  const rank = (w: unknown) => (w === 'auto' ? 100 : typeof w === 'number' ? w : 0)
  priced.sort((a, b) => at(a) - at(b) || rank(b.w) - rank(a.w))
  return priced
}

/** The cheapest of `styles` for this yard (pricedCheapestFirst); undefined when there are none. */
export function cheapestStyle<S extends QuoteStyle>(input: QuoteCalcInput, styles: S[]): S | undefined {
  if (styles.length <= 1) return styles[0]
  return pricedCheapestFirst(input, styles)[0]?.s
}

export function resolveTiers<S extends QuoteStyle & { isActive?: boolean; quotable?: boolean }>(
  input: QuoteCalcInput, styles: Active<S>[], set: Pick<TierSet, 'category' | 'tiers' | 'popular'> | null | undefined,
  prefs: TierPrefs = { off: [], swap: {} },
  opts: ResolveOptions = {},
): ResolvedTier[] {
  const own = input.style
  if (!set || !own) return []
  const out: ResolvedTier[] = []
  // Tiers that picked "whichever width prices lower", by place: the quote's own fence among their choices, priced.
  const widthTiers = new Map<number, { s: S; o: ProposalOption } | null>()
  // Each tier's own price input (its Price adjust), by place: the quote's own fence put on a card is priced with it.
  const tierInputs = new Map<number, QuoteCalcInput>()
  const added = (prefs.added ?? []).filter(a => a?.key && a.style && !set.tiers.some(t => t.key === a.key)).slice(0, MAX_TIERS)
  const specs: TierSpec[] = [...set.tiers, ...added.map(a => ({ key: a.key, name: 'Option', install: 'same' as const, width: 'same' as const, color: 'same', style: a.style, text: '' }))]
  // The Most popular pick on this quote (null: none), else the tier set's; one at most.
  const popular = prefs.popular !== undefined ? prefs.popular : set.popular
  for (const spec of specs) {
    const isAdded = added.some(a => a.key === spec.key)
    const base = { spec, category: set.category, popular: spec.key === popular && !prefs.off.includes(spec.key), off: prefs.off.includes(spec.key), widthFt: null as number | null, otherWidth: null as ResolvedTier['otherWidth'], ...(isAdded ? { added: true } : {}) }
    // The price this tier adds on, with the quote's own Price adjust on the main option only (proposal.ts priceOption).
    // A sent proposal whose card for this tier went out with the slider keeps it (proposal.ts sentSliderStyles).
    const tierInput: QuoteCalcInput = { ...input, tierAdjust: (Number(spec.priceAdjustPct) || 0) / 100, ...(input.sliderOn?.includes(`tier:${spec.key}`) ? { sliderTier: true } : {}) }
    const swapName = prefs.swap[spec.key] ?? (isAdded ? spec.style ?? undefined : undefined)
    const swapStyle = swapName ? styles.find(s => s.name === swapName && isQuotable(s)) : undefined
    if (swapStyle) {
      // The style the tier would have picked anyway keeps the tier's own name and words.
      const auto = isAdded ? null : tierStyles(spec, own, styles, opts)
      const same = !!auto && 'styles' in auto && auto.styles.some(s => s.name === swapStyle.name)
      out.push({ ...base, swapped: true, ownWords: !same, style: swapStyle, option: priceOption(tierInput, swapStyle) })
      continue
    }
    tierInputs.set(out.length, tierInput)
    const r = tierStyles(spec, own, styles, opts)
    const swapOff = swapName && !isAdded ? { swapOff: swapName } : {}
    if ('reason' in r) { out.push({ ...base, ...swapOff, swapped: false, reason: r.reason }); continue }
    const priced = pricedCheapestFirst(tierInput, r.styles)
    const pick = priced[0]
    const res: ResolvedTier = { ...base, ...swapOff, swapped: false, style: pick.s, option: pick.o }
    if (r.pickCheaper) widthTiers.set(out.length, priced.find(x => x.s.name === own.name) ?? null)
    if (r.pickCheaper && typeof pick.w === 'number') {
      res.widthFt = pick.w
      const other = priced.find(x => typeof x.w === 'number' && x.w !== pick.w)
      if (other) res.otherWidth = { widthFt: other.w as number, price: other.o.finalPrice }
      else if (r.heldWidths?.length) res.otherWidthHeld = r.heldWidths[0]
    }
    out.push(res)
  }
  // The quote's own fence when no card is it (a width forced or picked by hand, or a best price mix a fixed width beat):
  // the first tier that picks a width among fences of the quote's own install and color is the quote's own fence at
  // the quote's price, never a card of its own (Jonathan, Nov 2 2026: "make the main quote price equal Better";
  // review Nov 3 2026: all 8 ft forced made a fourth card). A tier naming the quote's fence itself (Best, all 6 ft) keeps it.
  // Jonathan, Nov 5 2026: "the quote's own fence IS the Better option": Better at a fixed width (8 ft) of the same
  // fence family, color, install and height is the quote's own fence (best price) at the quote's price, so the proposal
  // shows Good, Better, Best only. Else the first tier picking a width as above; else any card of the same fence.
  if (!opts.ownCardAsSent && !out.some(t => !t.off && t.style?.name === own.name)) {
    const ownParts = styleParts(own.name, own as Parameters<typeof styleParts>[1])
    const sameFence = (t: ResolvedTier) => {
      if (t.off || t.swapped || t.added || !t.style || !ownParts) return false
      const p = styleParts(t.style.name, t.style as Parameters<typeof styleParts>[1])
      return !!p && p.family === ownParts.family && p.color === ownParts.color && p.install === ownParts.install && p.height === ownParts.height && (p.model ?? null) === (ownParts.model ?? null)
    }
    const put = (i: number) => {
      const o = priceOption(tierInputs.get(i) ?? input, own)
      out[i] = { ...out[i], style: own as unknown as S, option: o, widthFt: null, otherWidth: null, otherWidthHeld: undefined }
    }
    const better = out.findIndex(t => t.spec.key === 'better' && sameFence(t))
    const width = [...widthTiers].find(([i, mine]) => mine && !out[i].off)
    if (better >= 0) put(better)
    else if (width) { const [i, mine] = width; out[i] = { ...out[i], style: mine!.s, option: mine!.o, widthFt: null, otherWidth: null, otherWidthHeld: undefined } }
    else { const any = out.findIndex(sameFence); if (any >= 0) put(any) }
  }
  // Better at a fixed width on a quote of another fence (a dig set quote, the website's Good picked): Better is the best
  // price fence of its own kind when there is one, as on a best price quote, so the card reads the same whichever option
  // is the main one (the website's Better = the opened draft's Better). Good too (Jonathan, Nov 6 2026: "Vinyl Good is
  // the best price dig set"): Good at a fixed width is the best price fence of its kind, unless it is the quote's own fence.
  if (!opts.ownCardAsSent) {
    for (const key of ['good', 'better']) {
      const bi = out.findIndex(t => t.spec.key === key && !t.off && !t.swapped && !t.added && t.style && t.style.name !== own.name && /^\d+$/.test(String(t.spec.width)))
      const b = bi >= 0 ? out[bi] : null
      const bp = b?.style ? styleParts(b.style.name, b.style as Parameters<typeof styleParts>[1]) : null
      if (!b || !bp || (b.style as { autoRailMix?: boolean }).autoRailMix) continue
      const mix = styles.find(x => x.isActive !== false && isQuotable(x) && (x as { autoRailMix?: boolean }).autoRailMix && x.name !== b.style!.name && (() => {
        const xp = styleParts(x.name, x as Parameters<typeof styleParts>[1])
        return !!xp && xp.family === bp.family && xp.color === bp.color && xp.install === bp.install && xp.height === bp.height && (xp.model ?? null) === (bp.model ?? null)
      })())
      if (mix) out[bi] = { ...b, style: mix, option: priceOption(tierInputs.get(bi) ?? input, mix), widthFt: null, otherWidth: null, otherWidthHeld: undefined }
    }
  }
  for (let i = 0; i < out.length; i++) {
    const earlier = out.slice(0, i).find(t => t.style && out[i].style && t.style.name === out[i].style!.name)
    if (earlier) out[i].sameAs = earlier.spec.name
  }
  // Most popular is never on a card cheaper than the quote's own unless picked by hand on this quote (review Nov 3
  // 2026): the tier set's pick moves to the quote's own card, or none when no card is the quote's own.
  if (prefs.popular === undefined && !opts.ownCardAsSent) {
    const pop = out.find(t => t.popular)
    if (pop?.option && pop.style?.name !== own.name) {
      const ownCents = Math.round(priceOption(input, own).finalPrice * 100)
      if (Math.round(pop.option.finalPrice * 100) < ownCents) {
        pop.popular = false
        const mine = out.find(t => !t.off && t.style?.name === own.name)
        if (mine) mine.popular = true
      }
    }
  }
  return out
}

/**
 * Choices made on one quote: tiers left off, tiers swapped to another style (any style on for quoting, Nov 2 2026),
 * options added beyond the tier set, and the Most popular pick. Only what was chosen is kept: a quote nobody touched
 * has none of `added`, `popular` or `pin`.
 */
export interface TierPrefs {
  off: TierKey[]
  swap: Partial<Record<TierKey, string>>
  /** Options added on this quote: each its own key and style. */
  added?: Array<{ key: TierKey; style: string }>
  /** The option marked Most popular on this quote; null: none. Not set: the tier set's. */
  popular?: TierKey | null
  /** Another option was made the quote's main one: the tier set stays the one it was (`category`) while the quote's style is `main`. */
  pin?: { category: string; main: string }
}

/** The category whose tier set a quote uses: its own, or the one it stayed on when another material was made main. */
export function tierCategory(prefs: TierPrefs, style: { name?: string; category?: string } | undefined): string | undefined {
  return prefs.pin && style?.name === prefs.pin.main ? prefs.pin.category : style?.category
}

/** Names that say nothing about the fence, so they stay on a swapped option. "Dig set with concrete" would not. */
const RANK_NAME = /^(good|better|best)$/i

const MATERIAL_WORD: Record<StyleParts['family'], string> = { vinyl: 'Vinyl', chain: 'Chain link', alum: 'Aluminum', wood: 'Wood', farm: 'Farm fence' }

/** A material in a word, for an option with no tier name of its own. */
export function materialWord(style: (QuoteStyle & { material?: string }) | undefined): string {
  const p = style ? styleParts(style.name, style as Parameters<typeof styleParts>[1]) : null
  if (p) return MATERIAL_WORD[p.family]
  return String(style?.category ?? 'Option').trim() || 'Option'
}

/**
 * The owner's own words and photo for a fence, from its own category's tier set (Settings → Good Better Best): the tier
 * of that set this style is, by a named style, or by install, color and width. Nothing when no tier says this fence:
 * styles have no description of their own, and none is made up.
 */
export function styleWords(style: QuoteStyle & { material?: string }, sets: Array<Pick<TierSet, 'category' | 'tiers'>> | null | undefined, photoIds: Record<string, string> = {}): { blurb: string; photoId?: string } {
  const set = tierSetFor(sets ?? [], style)
  const p = styleParts(style.name, style as Parameters<typeof styleParts>[1])
  if (!set || !p) return { blurb: '' }
  const spec = set.tiers.find(t => t.style === style.name) ?? set.tiers.find(t => {
    if (t.style) return false
    if (t.install !== 'same' && t.install !== p.install) return false
    if (t.color !== 'same' && t.color !== p.color) return false
    return t.width === 'same' || t.width === 'cheapest' || p.width === 'auto' || Number(t.width) === p.width
  })
  return spec ? { blurb: spec.text ?? '', photoId: photoIds[tierPhotoName(set.category, spec.key)] } : { blurb: '' }
}

/**
 * A farm fence with no wire (4 board) under a farm grade tier: the tier took only its post size (tierStyles), so its
 * words must not promise the grade's wire (review Nov 5 2026: "Red Brand no climb wire on 6" posts" on a no-wire fence).
 */
function farmNoWireWords(style: QuoteStyle & { material?: string; choices?: Record<string, string> }, spec: TierSpec): string | null {
  if (style.material !== 'farm' || style.choices?.wire !== 'none' || spec.color === 'same') return null
  return `${style.choices.post}" round treated posts, no wire.`
}

/**
 * Tier options as they go on the proposal: name, text, badge and the tier's own photo. A style swapped in by hand has
 * none of the tier's words (a wood option must not read "Steel pipe driven deep"): its name stays a plain rank (Good)
 * or becomes its material, its words and photo come from styleWords, else the style's photo (buildProposal).
 */
export function tierOptions(tiers: ResolvedTier[], photoIds: Record<string, string> = {}, sets?: Array<Pick<TierSet, 'category' | 'tiers'>> | null): ProposalOption[] {
  return tiers.filter(t => !t.off && t.option && t.style).map(t => {
    const own = t.added || t.ownWords
    const words = own ? styleWords(t.style!, sets, photoIds) : null
    return {
      ...t.option!,
      label: styleLabel(t.style!.name),
      tier: {
        key: t.spec.key,
        label: own ? (!t.added && RANK_NAME.test(t.spec.name.trim()) ? t.spec.name : materialWord(t.style)) : t.spec.name,
        blurb: own ? words!.blurb : farmNoWireWords(t.style!, t.spec) ?? t.spec.text,
        ...(own ? { swapped: true as const } : {}),
      },
      badge: t.popular ? 'Most popular' : undefined,
      photoId: (own ? words!.photoId : photoIds[tierPhotoName(t.category, t.spec.key)]) ?? undefined,
    }
  })
}

/** What an option's card tells staff (the quote builder, and a Salesman's phone from the server): the name and words the customer reads, and what is missing. */
export interface OptionCard { name: string; blurb: string; warranty: string | null; hasPhoto: boolean; block: string[]; warn: string[]; gates: string[] }

export function optionCard(t: ResolvedTier, photoIds: Record<string, string>, sets: Array<Pick<TierSet, 'category' | 'tiers'>> | null | undefined, warranties: WarrantySettings, yard?: Pick<QuoteCalcInput, 'gateWidths' | 'walkGates' | 'dblGates'>): OptionCard | null {
  if (!t.option || !t.style) return null
  const o = tierOptions([{ ...t, off: false }], photoIds, sets)[0]
  const w = warrantyForStyle(warranties, t.style)
  const own = !!o.tier?.swapped
  return {
    name: o.tier?.label ?? '', blurb: o.tier?.blurb ?? '', warranty: w?.name ?? null,
    hasPhoto: !!(o.photoId || photoIds[t.style.name]),
    block: own ? [...(t.option.problems?.block ?? []), ...(w ? [] : ['No warranty is set for this style in Settings → Warranties.'])] : [],
    warn: own ? t.option.problems?.warn ?? [] : [],
    gates: yard ? gateWarnings(t.style, yard.gateWidths, yard.walkGates, yard.dblGates) : [],
  }
}

/** How many options a proposal saved now would show: the tiers on, the quote's own when no tier is its card, and the styles ticked. */
export function offeredCount(tiers: ResolvedTier[], ownName: string | undefined, foldedOrTwin: boolean, ticked: string[] = []): number {
  const on = new Set(tiers.filter(t => !t.off && t.option && t.style).map(t => t.style!.name))
  const own = ownName && !on.has(ownName) && !foldedOrTwin ? 1 : 0
  return on.size + own + ticked.filter(n => n !== ownName && !on.has(n)).length
}

/** A key for a new added option. */
export function newOptionKey(prefs: TierPrefs): TierKey {
  const taken = new Set((prefs.added ?? []).map(a => a.key))
  for (let i = 1; ; i++) if (!taken.has(`added${i}`)) return `added${i}`
}

/**
 * The tiers fixed at the styles they are now, so another option can be made the main one without the rest following it
 * (a tier's own rules read the quote's style): `main` becomes the main style on `tierKey`'s card, the old main stays offered.
 */
export function pinnedForMain(prefs: TierPrefs, tiers: ResolvedTier[], tierKey: TierKey, main: string, category: string, ownName?: string, ownCard?: TierKey | null): TierPrefs {
  const swap: TierPrefs['swap'] = { ...prefs.swap }
  for (const t of tiers) if (t.style) swap[t.spec.key] = t.style.name
  // The card that was the main one: the quote's own style, a best price mix included.
  if (ownCard && ownName && ownCard !== tierKey) swap[ownCard] = ownName
  swap[tierKey] = main
  return { ...prefs, swap, pin: { category, main } }
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
