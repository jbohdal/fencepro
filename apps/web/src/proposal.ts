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
  /** Priced snapshot copied onto the quote if the customer picks this option. Never shown to the customer. */
  snapshot: {
    materialCost: number; laborCost: number; tearOutCost: number; totalCOGS: number; gmPct: number
    pullSheet: LineItem[]; runRails?: Array<'auto' | '6ft' | '8ft'>; runSections: number[]
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
export function priceOption(input: QuoteCalcInput, style: QuoteStyle): ProposalOption {
  const q = calculateQuote({ ...input, style, overrides: { ...(input.overrides ?? {}), finalPrice: undefined } })
  const filled = input.runs.map((r, i) => ({ r, i })).filter(x => x.r.ft > 0)
  return {
    label: optionLabel(style.name),
    fenceStyle: style.name,
    finalPrice: q.priced.price,
    perFoot: q.priced.pricePerFoot,
    sections: q.sections,
    snapshot: {
      materialCost: q.priced.materialCost, laborCost: q.priced.laborCost, tearOutCost: q.priced.tearOutCost,
      totalCOGS: q.priced.totalCOGS, gmPct: q.priced.gmPct, pullSheet: q.materials.items,
      runRails: style.autoRailMix ? filled.map(x => q.perRunRail[x.i] ?? '6ft') : undefined,
      runSections: filled.map(x => q.perRunSections[x.i]),
    },
  }
}

export function gatesText(walk: number, dbl: number): string {
  const parts = [walk ? `${walk} walk gate${walk > 1 ? 's' : ''}` : '', dbl ? `${dbl} double gate${dbl > 1 ? 's' : ''}` : ''].filter(Boolean)
  return parts.join(', ') || 'no gates'
}

/** Plain facts from the quote, for "What's included". */
export function includedFacts(f: { footageFt: number; corners: number; ends: number; walkGates: number; dblGates: number; tearOutSections: number; tearOutGates: number }): string[] {
  const out = [`${Math.round(f.footageFt)} ft of new fence, all materials and installation`]
  out.push(`${f.corners} corner post${f.corners === 1 ? '' : 's'} and ${f.ends} end and gate post${f.ends === 1 ? '' : 's'}`)
  if (f.walkGates || f.dblGates) out.push(gatesText(f.walkGates, f.dblGates).replace(/^./, c => c.toUpperCase()))
  if (f.tearOutSections || f.tearOutGates) out.push(`Tear out and haul away of the old fence (${f.tearOutSections} section${f.tearOutSections === 1 ? '' : 's'}${f.tearOutGates ? `, ${f.tearOutGates} gate${f.tearOutGates === 1 ? '' : 's'}` : ''})`)
  return out
}

export function buildProposal(args: {
  input: QuoteCalcInput
  styles: QuoteStyle[]
  /** The quote's own price, as shown on the quote (it may be typed by hand). */
  ownPrice: number
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
    depositPct: settings.depositPct && settings.depositPct > 0 ? settings.depositPct : 0,
    depositNote: settings.depositNote?.trim() ?? '',
    financing: fin && (fin.months ?? 0) > 0 ? { provider: fin.provider ?? '', apr: fin.apr ?? 0, months: fin.months!, link: fin.link ?? '' } : null,
    tierPrefs: args.tierPrefs,
    tierSet: args.tierSet ? { category: args.tierSet.category, tiers: args.tierSet.tiers.map(t => ({ ...t })), popular: args.tierSet.popular } : undefined,
    recommended: popular >= 0 ? popular : Math.max(0, options.findIndex(o => o.fenceStyle === own.name)),
    options,
  }
}

/** The customer's link: the public door on a Tailscale address, the app's own address otherwise. */
export function proposalUrl(token: string): string {
  const { protocol, hostname, origin } = window.location
  return hostname.endsWith('.ts.net') ? `${protocol}//${hostname}:8443/p/${token}` : `${origin}/p/${token}`
}

// ── Moves and repairs ────────────────────────────────────────────────────────

/** A move or repair as a proposal option: one price, its plain words as the label; the work it was priced with rides in the snapshot. */
export function workOption(label: string, styleName: string, w: WorkResult, saved: SavedWork, runSections: number[]): ProposalOption {
  return {
    label, fenceStyle: styleName, finalPrice: w.priceCents / 100, perFoot: 0, sections: w.sections,
    snapshot: {
      materialCost: w.materialCents / 100, laborCost: w.laborCents / 100, tearOutCost: w.disposalCents / 100, totalCOGS: w.costCents / 100,
      gmPct: w.gmPct, pullSheet: w.pullSheet, runSections, work: saved,
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
    depositPct: settings.depositPct && settings.depositPct > 0 ? settings.depositPct : 0,
    depositNote: settings.depositNote?.trim() ?? '',
    financing: fin && (fin.months ?? 0) > 0 ? { provider: fin.provider ?? '', apr: fin.apr ?? 0, months: fin.months!, link: fin.link ?? '' } : null,
    recommended: 0,
    options: args.options.map(o => ({ ...o, photoId: o.photoId || args.photoIds[o.fenceStyle] || null })),
  }
}
