/**
 * Good, Better, Best on vinyl quotes. Each tier is a kind of vinyl (color,
 * no dig or dig set, height); for the yard being quoted it uses whichever
 * section width, 6 or 8 ft, prices lower. The lineup, the words under each
 * tier and the "Most popular" pick are set in Settings → Proposals.
 *
 * Every price comes from priceOption, the quote builder's own math.
 */

import { priceOption, optionLabel, type ProposalOption } from './proposal'
import type { QuoteCalcInput, QuoteStyle } from './quoteCalc'

export type TierKey = 'good' | 'better' | 'best'

export interface TierSpec {
  key: TierKey
  label: string
  color: 'white' | 'tan'
  install: 'no-dig' | 'dig-set'
  heightFt: 6 | 8
  /** What makes this tier better, shown on the proposal. */
  blurb: string
}

export const DEFAULT_TIERS: TierSpec[] = [
  { key: 'good', label: 'Good', color: 'white', install: 'dig-set', heightFt: 6, blurb: 'Dig set: posts set in concrete.' },
  { key: 'better', label: 'Better', color: 'white', install: 'no-dig', heightFt: 6, blurb: 'No dig: steel pipe driven deep, no concrete, faster install.' },
  { key: 'best', label: 'Best', color: 'tan', install: 'no-dig', heightFt: 6, blurb: 'Tan: premium color, on steel pipe driven deep with no concrete.' },
]
export const DEFAULT_POPULAR: TierKey = 'better'

/** Choices made on one quote: tiers left off, and tiers swapped to another style. */
export interface TierPrefs { off: TierKey[]; swap: Partial<Record<TierKey, string>> }

export interface ResolvedTier {
  spec: TierSpec
  popular: boolean
  /** Left off this quote's proposal. */
  off: boolean
  /** The style swapped in by hand, when it was. */
  swapped: boolean
  style: QuoteStyle
  option: ProposalOption
  /** The width used, and the other width's price, when the tier picked one. */
  widthFt: number | null
  otherWidth: { widthFt: number; price: number } | null
}

const VINYL = /^(WV|TV)-(ND|DS) ([68])'x([68])' Privacy$/

/** The 6 ft wide and 8 ft wide styles for a tier (active ones). */
export function tierCandidates<S extends QuoteStyle & { isActive?: boolean }>(spec: TierSpec, styles: S[]): S[] {
  return styles.filter(s => {
    const m = s.name.match(VINYL)
    return !!m && s.isActive !== false
      && m[1] === (spec.color === 'white' ? 'WV' : 'TV')
      && m[2] === (spec.install === 'no-dig' ? 'ND' : 'DS')
      && Number(m[3]) === spec.heightFt
  })
}

export function resolveTiers<S extends QuoteStyle & { isActive?: boolean }>(
  input: QuoteCalcInput, styles: S[], specs: TierSpec[] = DEFAULT_TIERS, popular: TierKey = DEFAULT_POPULAR, prefs: TierPrefs = { off: [], swap: {} },
): ResolvedTier[] {
  const out: ResolvedTier[] = []
  for (const spec of specs) {
    const swapName = prefs.swap[spec.key]
    const swapStyle = swapName ? styles.find(s => s.name === swapName) : undefined
    let style: QuoteStyle | undefined, option: ProposalOption | undefined
    let widthFt: number | null = null, otherWidth: ResolvedTier['otherWidth'] = null
    if (swapStyle) {
      style = swapStyle
      option = priceOption(input, swapStyle)
    } else {
      const priced = tierCandidates(spec, styles).map(s => ({ s, o: priceOption(input, s), w: Number(s.name.match(VINYL)![4]) }))
      if (priced.length === 0) continue
      priced.sort((a, b) => a.o.finalPrice - b.o.finalPrice || b.w - a.w)
      style = priced[0].s; option = priced[0].o; widthFt = priced[0].w
      if (priced[1]) otherWidth = { widthFt: priced[1].w, price: priced[1].o.finalPrice }
    }
    out.push({ spec, popular: spec.key === popular, off: prefs.off.includes(spec.key), swapped: !!swapStyle, style: style!, option: option!, widthFt, otherWidth })
  }
  return out
}

/** Tier options as they go on the proposal: label, blurb and badge added. */
export function tierOptions(tiers: ResolvedTier[]): ProposalOption[] {
  return tiers.filter(t => !t.off).map(t => ({
    ...t.option,
    label: optionLabel(t.style.name),
    tier: { key: t.spec.key, label: t.spec.label, blurb: t.spec.blurb },
    badge: t.popular ? 'Most popular' : undefined,
  }))
}

export function isVinylStyle(style: QuoteStyle | undefined): boolean {
  return !!style && (style.category === 'Vinyl' || /^(WV|TV)-/.test(style.name))
}
