/**
 * Proposals: the same yard priced as the options that make sense for the
 * style (6 vs 8 ft wide, white vs tan, no dig vs dig set; galvanized vs black
 * chain link; aluminum no dig vs dig set), and the proposal frozen on the
 * quote when it is saved. The server shows the frozen proposal on the
 * customer's link (/p/<link>) and, when the customer accepts an option,
 * copies that option's priced snapshot onto the quote.
 *
 * Every option is priced by calculateQuote, the quote builder's own math.
 */

import { calculateQuote, type QuoteCalcInput, type QuoteStyle } from './quoteCalc'
import type { LineItem } from './materialCalculator'
import type { TierSet } from './tiers'
import { isQuotable } from './styleAvailability'
import { askedDepositPct } from './contractTerms'
import { styleLabel, styleChoicesOf } from './fenceCatalog'
import type { SavedWork, WorkResult } from './moveRepair'

export interface ProposalSettings {
  /** Extra "what's included" text, one item per line. */
  included?: string
  depositPct?: number
  depositNote?: string
  financing?: { provider?: string; apr?: number; months?: number; link?: string }
  /** Turned on once the public door for /p is open, so customers can open links. */
  publicLinks?: boolean
  /** Days a customer link works after it is made (default 30). */
  linkDays?: number
  /** Push to the card's owner when a customer opens a proposal (first open, and again after 2+ days). On unless false. */
  notifyOpened?: boolean
  // Good, Better, Best used to be set here (tiers, popular); they now live in
  // their own tier sets on the server (Settings → Good Better Best). The server
  // carried any old settings over when it made the sets.
}

export interface ProposalOption {
  label: string
  fenceStyle: string
  finalPrice: number
  perFoot: number
  sections: number
  photoId?: string | null
  /** Good, Better or Best, with what makes it better. */
  tier?: { key: string; label: string; blurb: string }
  /** "Most popular" */
  badge?: string
  /**
   * The quote's ± dollar adjustment applied to this option's price, in cents
   * (−3000: $30 off). The list price is finalPrice − this. Every option on a
   * proposal carries the same adjustment (the salesman took $X off the job).
   */
  adjustmentCents?: number
  /** Priced snapshot copied onto the quote if the customer picks this option. Never shown to the customer. */
  snapshot: {
    materialCost: number; laborCost: number; tearOutCost: number; totalCOGS: number; gmPct: number
    pullSheet: LineItem[]; runRails?: Array<'auto' | '6ft' | '8ft'>; runSections: number[]
    /** Cents this option's price was rounded down by to the whole dollar (out of profit). */
    roundingCents?: number
    /** A move or repair option: the work the quote becomes if picked; null: a new fence (the quote stops being a move or repair). */
    work?: SavedWork | null
  }
}

export interface QuoteProposal {
  version: 1
  createdAt: string
  company: { name: string; phone: string; email: string }
  customer: { name: string; address: string }
  planSvg?: string
  footageFt: number
  gatesText: string
  included: string[]
  includedNote: string
  warranty: string
  depositPct: number
  depositNote: string
  financing: { provider: string; apr: number; months: number; link: string } | null
  recommended: number
  options: ProposalOption[]
  /** Tiers left off or swapped on this quote, so it reopens the same way. */
  tierPrefs?: { off: string[]; swap: Record<string, string> }
  /** The tier set as it was when this proposal was made: a sent quote reopens with it, not with later Settings. */
  tierSet?: Pick<TierSet, 'category' | 'tiers' | 'popular'>
  /** A fence move or repair: the plain words of the work (no cost lines). */
  kind?: 'move' | 'repair'
  description?: string
  /** Priced to the whole dollar (Oct 21 2026 on): the deposit is whole dollars too, the final takes the rest. */
  wholeDollar?: boolean
  /** Show a reduction as the list price, a Discount line and the final price (the quote's "Show as discount on the proposal"). Otherwise the final price only. */
  showDiscount?: boolean
  /**
   * The quote list's copy (portal lib/quoteSlim.ts): no drawing (planSvg) and no option snapshots. The whole
   * proposal comes with the one quote when it is opened (quoteStore.ts loadFullQuote); a save never sends it.
   */
  slim?: true
}

// ── Which options make sense for a style ──────────────────────────────────────

type Choosable = { name: string; material?: string; choices?: Record<string, string>; autoRailMix?: boolean }

/**
 * Which compare family a style is in, read from its choices (fenceCatalog.ts),
 * so a color, finish or install added in Settings joins its family like the
 * built in ones:
 *   vinyl privacy, one panel width     same height, any color, install and width
 *   vinyl privacy, auto mix            the 6 ft tall ones of one panel width
 *   residential chain link             same height, any finish and install
 *   aluminum                           same panel style and height
 * For the old codes this is exactly the families they always had (WV/TV
 * ND/DS 6'x6' to 8'x8' privacy, CL - 4/5/6' Galv/Black, Alum Emily 48).
 */
function familyOf(s: Choosable): { key: string; fixedWidth: boolean } | null {
  const sc = styleChoicesOf(s)
  if (!sc) return null
  const c = sc.choices
  if (sc.material === 'vinyl' && c.style === 'privacy') {
    const auto = c.width === 'auto' || !!s.autoRailMix
    return { key: `vinyl:${auto ? '6' : c.height}`, fixedWidth: !auto }
  }
  if (sc.material === 'chain' && c.grade === 'res') return { key: `chain:${c.height}`, fixedWidth: true }
  if (sc.material === 'alum' && c.panel === 'emily') return { key: `alum:${c.panel}:${c.height}`, fixedWidth: true }
  return null
}

/** The styles to compare with this one (itself first), from the active styles in Settings. */
export function compareStyles<S extends QuoteStyle & { isActive?: boolean; quotable?: boolean }>(style: S, styles: S[]): S[] {
  // Styles turned on and available for quoting; the quote's own style always.
  const active = styles.filter(s => isQuotable(s) || s.name === style.name)
  const mine = familyOf(style as Choosable)
  // Auto mix styles are compared with the fixed width ones, never with each other.
  const family = mine ? active.filter(s => { const f = familyOf(s as Choosable); return !!f && f.fixedWidth && f.key === mine.key }) : []
  if (family.length === 0) return [style]
  return [style, ...family.filter(s => s.name !== style.name)]
}

/** The plain name a person sees: "White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig" (fenceCatalog.ts). */
export function optionLabel(styleName: string): string {
  return styleLabel(styleName)
}

/** Standard amortized loan payment; the server uses the same formula. */
export function monthlyPayment(price: number, aprPct: number, months: number): number {
  if (!(price > 0) || !(months > 0)) return 0
  const r = (aprPct || 0) / 100 / 12
  return r > 0 ? (price * r) / (1 - Math.pow(1 + r, -months)) : price / months
}

/** The same job priced as another style. A price typed by hand is left out. */
/**
 * The quote's pricing choices as another style's option takes them: never
 * the quote's typed final price, and never the cost factor the quote's own
 * style was priced at. A saved quote keeps its style's cost factor (so its
 * price stays as saved), and that factor used to be put on every Good /
 * Better / Best and Compare option too when the quote was opened again: a
 * website draft's Good (dig set, its own factor) read $668 more than the
 * website showed the customer (review, Oct 25, 2026). Each other style is
 * priced at its own factor, as on a new quote and on the website.
 */
export function optionOverrides(input: Pick<QuoteCalcInput, 'overrides' | 'style'>, style: Pick<QuoteStyle, 'name'>): QuoteCalcInput['overrides'] {
  const same = !!input.style && input.style.name === style.name
  return { ...(input.overrides ?? {}), finalPrice: undefined, ...(same ? {} : { costFactor: undefined }) }
}

export function priceOption(input: QuoteCalcInput, style: QuoteStyle): ProposalOption {
  const q = calculateQuote({ ...input, style, overrides: optionOverrides(input, style) })
  const filled = input.runs.map((r, i) => ({ r, i })).filter(x => x.r.ft > 0)
  return {
    label: optionLabel(style.name),
    fenceStyle: style.name,
    finalPrice: q.priced.price,
    perFoot: q.priced.pricePerFoot,
    sections: q.sections,
    ...(q.priced.adjustmentCents ? { adjustmentCents: q.priced.adjustmentCents } : {}),
    snapshot: {
      materialCost: q.priced.materialCost, laborCost: q.priced.laborCost, tearOutCost: q.priced.tearOutCost,
      totalCOGS: q.priced.totalCOGS, gmPct: q.priced.gmPct, pullSheet: q.materials.items,
      runRails: style.autoRailMix ? filled.map(x => q.perRunRail[x.i] ?? '6ft') : undefined,
      runSections: filled.map(x => q.perRunSections[x.i]),
      roundingCents: q.priced.roundingCents,
    },
  }
}

export function gatesText(walk: number, dbl: number): string {
  const parts = [walk ? `${walk} walk gate${walk > 1 ? 's' : ''}` : '', dbl ? `${dbl} double gate${dbl > 1 ? 's' : ''}` : ''].filter(Boolean)
  return parts.join(', ') || 'no gates'
}

/**
 * The posts line of "What's included": no zero counts, and "end posts" when
 * there are no gates ("2 end posts"; review Oct 27 2026: a no gate fence read
 * "0 corner posts and 2 end and gate posts"). '' when there are none.
 */
export function postsFact(corners: number, ends: number, gates: boolean): string {
  const n = (k: number, what: string) => (k > 0 ? `${k} ${what}${k === 1 ? '' : 's'}` : '')
  return [n(corners, 'corner post'), n(ends, gates ? 'end and gate post' : 'end post')].filter(Boolean).join(' and ')
}

/** Plain facts from the quote, for "What's included". */
export function includedFacts(f: { footageFt: number; corners: number; ends: number; walkGates: number; dblGates: number; tearOutSections: number; tearOutGates: number }): string[] {
  const out = [`${Math.round(f.footageFt)} ft of new fence, all materials and installation`]
  const posts = postsFact(f.corners, f.ends, f.walkGates + f.dblGates > 0)
  if (posts) out.push(posts)
  if (f.walkGates || f.dblGates) out.push(gatesText(f.walkGates, f.dblGates).replace(/^./, c => c.toUpperCase()))
  if (f.tearOutSections || f.tearOutGates) out.push(`Tear out and haul away of the old fence (${f.tearOutSections} section${f.tearOutSections === 1 ? '' : 's'}${f.tearOutGates ? `, ${f.tearOutGates} gate${f.tearOutGates === 1 ? '' : 's'}` : ''})`)
  return out
}

export function buildProposal(args: {
  input: QuoteCalcInput
  styles: QuoteStyle[]
  /** The quote's own price, as shown on the quote (it may be typed by hand). */
  ownPrice: number
  /** The cents the quote's own price was rounded down by. */
  ownRoundingCents?: number
  /** The ± dollar adjustment in the quote's own price (cents). */
  ownAdjustmentCents?: number
  /** "Show as discount on the proposal" on the quote. */
  showDiscount?: boolean
  /** Priced to the whole dollar (false: a quote that keeps its cents). */
  wholeDollar?: boolean
  company: { name: string; phone: string; email: string }
  customer: { name: string; address: string }
  planSvg?: string
  warranty: string
  settings: ProposalSettings
  photoIds: Record<string, string>
  /** Good, Better, Best options (tiers.ts), shown first. */
  tiers?: ProposalOption[]
  tierPrefs?: { off: string[]; swap: Record<string, string> }
  tierSet?: Pick<TierSet, 'category' | 'tiers' | 'popular'>
}): QuoteProposal {
  const { input, settings } = args
  const own = input.style!
  // Tiers first, then this quote's own style and anything else ticked.
  const options: ProposalOption[] = (args.tiers ?? []).map(o => ({ ...o }))
  for (const s of args.styles) if (!options.some(o => o.fenceStyle === s.name)) options.push(priceOption(input, s))
  for (const o of options) {
    // The quote's own option keeps the price on the quote, even one typed by hand.
    if (o.fenceStyle === own.name && args.ownPrice > 0) {
      const feet = input.runs.reduce((t, r) => t + (r.ft > 0 ? r.ft : 0), 0)
      o.finalPrice = args.ownPrice
      o.perFoot = feet > 0 ? Math.round((args.ownPrice / feet) * 100) / 100 : 0
      if (typeof args.ownRoundingCents === 'number') o.snapshot = { ...o.snapshot, roundingCents: args.ownRoundingCents }
      if (typeof args.ownAdjustmentCents === 'number') {
        if (args.ownAdjustmentCents) o.adjustmentCents = args.ownAdjustmentCents
        else delete o.adjustmentCents
      }
    }
    // A tier's own photo, else the style's photo.
    o.photoId = o.photoId || args.photoIds[o.fenceStyle] || null
  }
  const popular = options.findIndex(o => o.badge === 'Most popular')
  const footageFt = input.runs.reduce((t, r) => t + (r.ft > 0 ? r.ft : 0), 0)
  const fin = settings.financing
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    company: args.company,
    customer: args.customer,
    planSvg: args.planSvg,
    footageFt,
    gatesText: gatesText(input.walkGates, input.dblGates),
    included: includedFacts({ footageFt, corners: input.corners, ends: input.ends, walkGates: input.walkGates, dblGates: input.dblGates, tearOutSections: input.tearOutSections, tearOutGates: input.tearOutGates }),
    includedNote: settings.included?.trim() ?? '',
    warranty: args.warranty,
    depositPct: askedDepositPct(settings.depositPct) ?? 0,  // 0% or blank: none (Oct 29 2026, D2), as the link and the contract read it
    depositNote: settings.depositNote?.trim() ?? '',
    financing: fin && (fin.months ?? 0) > 0 ? { provider: fin.provider ?? '', apr: fin.apr ?? 0, months: fin.months!, link: fin.link ?? '' } : null,
    tierPrefs: args.tierPrefs,
    tierSet: args.tierSet ? { category: args.tierSet.category, tiers: args.tierSet.tiers.map(t => ({ ...t })), popular: args.tierSet.popular } : undefined,
    recommended: popular >= 0 ? popular : Math.max(0, options.findIndex(o => o.fenceStyle === own.name)),
    options,
    ...(args.wholeDollar === false ? {} : { wholeDollar: true }),
    ...(args.showDiscount && options.some(o => (o.adjustmentCents ?? 0) < 0) ? { showDiscount: true } : {}),
  }
}

/** An option's list price (before the quote's ± dollar adjustment), in dollars. */
export function listPriceOf(o: Pick<ProposalOption, 'finalPrice' | 'adjustmentCents'>): number {
  return Math.round(o.finalPrice * 100 - (o.adjustmentCents ?? 0)) / 100
}

/** The customer's link: the public door on a Tailscale address, the app's own address otherwise.
 *  `preview`: staff opening it from the app (a signed mark, never sent to the customer; the page drops it from the address). */
export function proposalUrl(token: string, preview?: string | null): string {
  const { protocol, hostname, origin } = window.location
  const url = hostname.endsWith('.ts.net') ? `${protocol}//${hostname}:8443/p/${token}` : `${origin}/p/${token}`
  return preview ? `${url}?sp=${encodeURIComponent(preview)}` : url
}

// ── Moves and repairs ────────────────────────────────────────────────────────

/** A move or repair as a proposal option: one price, its plain words as the label; the work it was priced with rides in the snapshot. */
export function workOption(label: string, styleName: string, w: WorkResult, saved: SavedWork, runSections: number[]): ProposalOption {
  return {
    label, fenceStyle: styleName, finalPrice: w.priceCents / 100, perFoot: 0, sections: w.sections,
    ...(w.adjustmentCents ? { adjustmentCents: w.adjustmentCents } : {}),
    snapshot: {
      materialCost: w.materialCents / 100, laborCost: w.laborCents / 100, tearOutCost: w.disposalCents / 100, totalCOGS: w.costCents / 100,
      gmPct: w.gmPct, pullSheet: w.pullSheet, runSections, work: saved, roundingCents: w.roundingCents,
    },
  }
}

/** The customer's proposal for a move or repair: the plain description, the plan, one price per option, no cost lines. Good, Better, Best are off. */
export function buildWorkProposal(args: {
  kind: 'move' | 'repair'
  description: string
  options: ProposalOption[]
  company: { name: string; phone: string; email: string }
  customer: { name: string; address: string }
  planSvg?: string
  warranty: string
  settings: ProposalSettings
  footageFt: number
  gatesText: string
  photoIds: Record<string, string>
  /** Priced to the whole dollar (false: a quote that keeps its cents). */
  wholeDollar?: boolean
  /** "Show as discount on the proposal" on the quote. */
  showDiscount?: boolean
}): QuoteProposal {
  const { settings } = args
  const fin = settings.financing
  return {
    version: 1,
    createdAt: new Date().toISOString(),
    kind: args.kind,
    description: args.description,
    company: args.company,
    customer: args.customer,
    planSvg: args.planSvg,
    footageFt: args.footageFt,
    gatesText: args.gatesText,
    included: [args.description],
    includedNote: settings.included?.trim() ?? '',
    warranty: args.warranty,
    depositPct: askedDepositPct(settings.depositPct) ?? 0,  // 0% or blank: none (Oct 29 2026, D2), as the link and the contract read it
    depositNote: settings.depositNote?.trim() ?? '',
    financing: fin && (fin.months ?? 0) > 0 ? { provider: fin.provider ?? '', apr: fin.apr ?? 0, months: fin.months!, link: fin.link ?? '' } : null,
    recommended: 0,
    options: args.options.map(o => ({ ...o, photoId: o.photoId || args.photoIds[o.fenceStyle] || null })),
    ...(args.wholeDollar === false ? {} : { wholeDollar: true }),
    ...(args.showDiscount && args.options.some(o => (o.adjustmentCents ?? 0) < 0) ? { showDiscount: true } : {}),
  }
}
