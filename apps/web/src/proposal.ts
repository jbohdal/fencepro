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
import { adjustedPrice } from './pricingEngine'
import { kitSetFor } from './materialKits'
import { teePostFor, type TeePost } from './yardLayout'
import type { LineItem } from './materialCalculator'
import type { TierPrefs, TierSet } from './tiers'
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
  /**
   * Good, Better or Best, with what makes it better. `swapped`: a style picked for this one quote ("Change style" or
   * "Add option"), so its name and words are its own (tiers.ts tierOptions) and sending checks it (optionBlocks).
   */
  tier?: { key: string; label: string; blurb: string; swapped?: true }
  /** "Most popular" */
  badge?: string
  /**
   * The quote's ± dollar adjustment applied to this option's price, in cents
   * (−3000: $30 off). The list price is finalPrice − this. Every option on a
   * proposal carries the same adjustment (the salesman took $X off the job).
   */
  adjustmentCents?: number
  /** A ± dollar reduction the engine would not take: it would put this option under cost, so it is at full price. Staff only. */
  adjustmentRefused?: boolean
  /** Lifted to the minimum job price. Staff only. */
  minimumLifted?: boolean
  /** What is wrong or unsure about this option's price: `block` stops a swapped option being sent (optionBlocks). Staff only. */
  problems?: OptionProblems
  /** Priced snapshot copied onto the quote if the customer picks this option. Never shown to the customer. */
  snapshot: {
    materialCost: number; laborCost: number; tearOutCost: number; totalCOGS: number; gmPct: number
    pullSheet: LineItem[]; runRails?: Array<'auto' | '6ft' | '8ft'>; runSections: number[]
    /** Cents this option's price was rounded down by to the whole dollar (out of profit). */
    roundingCents?: number
    /** A move or repair option: the work the quote becomes if picked; null: a new fence (the quote stops being a move or repair). */
    work?: SavedWork | null
    /** An option of another style: its own cost factor (1 − margin), which goes on the quote with it when signed, so a change order follows its margin. */
    costFactor?: number
    /** An option of another material: signing it clears the labor and per foot price typed for the quote's own style (optionOverrides). */
    otherMaterial?: true
    /** An option of a style that posts a tee differently: its own post counts, which go on the quote with it when signed. */
    posts?: { corners: number; ends: number; teeLinePosts: number }
  }
}

/** block: the customer would read something wrong; warn: said to staff, sending goes on. */
export interface OptionProblems { block: string[]; warn: string[] }

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
  /** Tiers left off or swapped on this quote, options added and the Most popular pick, so it reopens the same way (tiers.ts TierPrefs). */
  tierPrefs?: { off: string[]; swap: Record<string, string> } & Pick<TierPrefs, 'added' | 'popular' | 'pin'>
  /** The tier set as it was when this proposal was made: a sent quote reopens with it, not with later Settings. */
  tierSet?: Pick<TierSet, 'category' | 'tiers' | 'popular'>
  /** A fence move or repair: the plain words of the work (no cost lines). */
  kind?: 'move' | 'repair'
  description?: string
  /** Priced to the whole dollar (Oct 21 2026 on): the deposit is whole dollars too, the final takes the rest. */
  wholeDollar?: boolean
  /** No option is Most popular, so no option is labeled (Nov 2 2026 on). A proposal saved before keeps its "Recommended". */
  noRecommendedLabel?: true
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

/**
 * The quote's pricing choices as another style's option takes them: never
 * the quote's typed final price, and never the cost factor the quote's own
 * style was priced at. A saved quote keeps its style's cost factor (so its
 * price stays as saved), and that factor used to be put on every Good /
 * Better / Best and Compare option too when the quote was opened again: a
 * website draft's Good (dig set, its own factor) read $668 more than the
 * website showed the customer (review, Oct 25, 2026). Each other style is
 * priced at its own factor, as on a new quote and on the website.
 *
 * The ± dollar adjustment is the main option's only ("A discount on one
 * option must never change the price of the other options", Jonathan, Nov 2
 * 2026): $5,000 off the main option had come off Good and Best too.
 */
export function optionOverrides(input: Pick<QuoteCalcInput, 'overrides' | 'style'>, style: Pick<QuoteStyle, 'name' | 'category'>): QuoteCalcInput['overrides'] {
  const same = !!input.style && input.style.name === style.name
  return {
    ...(input.overrides ?? {}), finalPrice: undefined, ...(same ? {} : { costFactor: undefined, ...noAdjustment }),
    // Labor or a per foot price typed for the quote's own material is not this material's (Nov 2 2026: "priced with its own kit, labor and margin").
    ...(otherMaterial(input.style, style) ? { laborCost: undefined, subRate: undefined, pricePerFoot: undefined } : {}),
  }
}

/** No ± dollar adjustment: an option that is not the quote's main one (optionOverrides, a repair's "New fence instead", "Move as is"). */
export const noAdjustment = { priceAdjustmentCents: undefined, showDiscountOnProposal: undefined } as const

/** Pricing choices with the ± dollar adjustment left off. */
export function withoutAdjustment<O extends QuoteCalcInput['overrides']>(o: O): O {
  return (o ? { ...o, ...noAdjustment } : o) as O
}

/** Another material than the quote's own (Settings category): Vinyl, Chainlink, Aluminum, Wood. */
function otherMaterial(own: Pick<QuoteStyle, 'category'> | undefined, style: Pick<QuoteStyle, 'category'>): boolean {
  return !!own && String(own.category ?? '').trim().toLowerCase() !== String(style.category ?? '').trim().toLowerCase()
}

/** A tee's post by how the quote's style counted it, moved to how `style` posts it. */
function teePosts(input: QuoteCalcInput, style: QuoteStyle): { corners: number; ends: number; extraLinePosts: number } | null {
  const tees = input.tees ?? 0
  const from: TeePost = teePostFor(input.style), to: TeePost = teePostFor(style)
  if (!(tees > 0) || from === to) return null
  const n: Record<TeePost, number> = { corner: input.corners, end: input.ends, line: input.extraLinePosts ?? 0 }
  n[from] = Math.max(0, n[from] - tees)
  n[to] += tees
  return { corners: n.corner, ends: n.end, extraLinePosts: n.line }
}

/** The gate widths with parts lists of their own, and the standard gate's words. */
const GATE_WIDTH_KIT: Array<{ side: 'walk' | 'dbl'; ft: number; kit: 'walkGate5' | 'walkGate6' | 'dblGate10' | 'dblGate12' }> = [
  { side: 'walk', ft: 5, kit: 'walkGate5' },
  { side: 'walk', ft: 6, kit: 'walkGate6' },
  { side: 'dbl', ft: 10, kit: 'dblGate10' },
  { side: 'dbl', ft: 12, kit: 'dblGate12' },
]

/**
 * Odd gate sizes ("warn the salesman (never the customer), don't block sending", Jonathan, Nov 2 2026): a gate on this
 * yard whose width has no parts list of its own for this style. It is priced and pulled with the standard gate's parts
 * (materialKits.ts GATE_WIDTH_FALLBACK). For any style, picked or automatic; staff only.
 */
export function gateWarnings(style: Pick<QuoteStyle, 'name'>, gateWidths: QuoteCalcInput['gateWidths'], walkGates = 0, dblGates = 0): string[] {
  const kit = kitSetFor(style.name)
  if (!kit || kit === 'archived') return []
  const walk = ((gateWidths?.walk ?? []) as number[]).slice(0, walkGates || undefined), dbl = ((gateWidths?.dbl ?? []) as number[]).slice(0, dblGates || undefined)
  const out: string[] = []
  for (const g of GATE_WIDTH_KIT) {
    const there = (g.side === 'walk' ? walk : dbl).some(w => Math.abs(w - g.ft) < 0.05)
    if (there && !kit.kits[g.kit]?.length) out.push(g.side === 'walk' ? `${g.ft} ft walk gate: this style has no parts list for it, so it is priced and pulled as a 4 ft walk gate. Check the pull sheet.` : `${g.ft} ft double gate: this style has no parts list for it, so it is priced and pulled as an 8 ft double gate (two 4 ft leaves). Check the pull sheet.`)
  }
  const odd = [...walk.filter(w => ![4, 5, 6].includes(w)).map(w => `${w} ft walk`), ...dbl.filter(w => ![8, 10, 12].includes(w)).map(w => `${w} ft double`)]
  if (odd.length) out.push(`${odd.join(', ')} gate: no parts list for that size, so it is priced and pulled with the standard gate's parts. Check the pull sheet.`)
  return out
}

/** Words on a material warning that mean parts are left out, so the price would be wrong (materialCalculator.ts). */
const PARTS_LEFT_OUT = /no material kit yet|gate material is not included|add the color premium by hand/i

/** What is wrong or unsure about an option priced for this yard: nothing here changes its price. */
export function optionProblems(q: ReturnType<typeof calculateQuote>): OptionProblems {
  const block: string[] = [], warn: string[] = []
  const sum = q.materials.items.reduce((t, i) => t + (Number(i.total) || 0), 0)
  if (q.sections > 0 && (!q.materials.items.length || !(sum > 0))) block.push('No parts are priced for this style.')
  if (!(q.priced.price > 0)) block.push('This style has no price for this yard.')
  if (!(q.priced.laborCost > 0)) block.push('No install labor is set for this style.')
  for (const n of q.priced.notes) if (/labor is \$0|no subcontractor rate|paid per/i.test(n)) block.push(n)
  for (const w of q.materials.warnings) (PARTS_LEFT_OUT.test(w) ? block : warn).push(w)
  return { block: [...new Set(block)], warn: [...new Set(warn)] }
}

/**
 * Why a proposal's picked style cannot go to the customer: what its option says is wrong (optionProblems), or no
 * warranty (Settings → Warranties gives its install none, so the page and the contract would print none). Only options
 * picked by hand ("Change style", "Add option"): today's automatic options go out as they always did. Sent proposals
 * were saved without `swapped`, so they are never stopped here. Empty: it may be sent.
 */
export function optionBlocks(p: { options?: Array<Partial<ProposalOption> & { warranty?: unknown }> | null } | null | undefined): string[] {
  const out: string[] = []
  for (const o of Array.isArray(p?.options) ? p!.options! : []) {
    if (!o?.tier?.swapped) continue
    const name = o.label || o.fenceStyle || 'An option'
    for (const b of o.problems?.block ?? []) out.push(`${name}: ${b}`)
    if (!o.warranty) out.push(`${name}: no warranty is set for this style. Set it in Settings → Warranties.`)
  }
  return [...new Set(out)]
}

/** An option lifted to the minimum job price (input.minimumCents, a new fence only), or null: over it, or typed by hand. */
function minimumFor(input: QuoteCalcInput, q: ReturnType<typeof calculateQuote>, overrides: QuoteCalcInput['overrides']) {
  const cents = input.minimumCents ?? 0
  const p = q.priced
  if (!(cents > 0) || p.priceMethod === 'manual' || !(p.price > 0) || Math.round(p.priceBeforeAdjustment * 100) >= cents) return null
  const commissionCents = Math.round(cents * p.commissionPct)
  // The option's own pricing choices: another option than the main one takes no ± dollar adjustment.
  const r = adjustedPrice(cents, overrides, Math.round(p.totalCOGS * 100) + commissionCents)
  const price = r.priceCents / 100
  const margin = Math.round((price - p.totalCOGS - commissionCents / 100) * 100) / 100
  return { price, roundingCents: r.roundingCents, adjustmentCents: r.adjustmentCents, adjustmentRefused: r.refused, gmPct: price > 0 ? margin / price : 0 }
}

export function priceOption(input: QuoteCalcInput, style: QuoteStyle): ProposalOption {
  const posts = teePosts(input, style)
  const overrides = optionOverrides(input, style)
  const q = calculateQuote({ ...input, ...(posts ?? {}), style, overrides })
  const filled = input.runs.map((r, i) => ({ r, i })).filter(x => x.r.ft > 0)
  const other = !!input.style && input.style.name !== style.name
  const problems = other ? optionProblems(q) : null
  // The minimum job price, on every option ("The minimum job price applies to every option", Jonathan, Nov 2 2026).
  const min = minimumFor(input, q, overrides)
  const price = min ? min.price : q.priced.price
  const adjustment = min ? min.adjustmentCents : q.priced.adjustmentCents
  const refused = min ? min.adjustmentRefused : q.priced.adjustmentRefused
  const feet = filled.reduce((t, x) => t + x.r.ft, 0)
  return {
    label: optionLabel(style.name),
    fenceStyle: style.name,
    finalPrice: price,
    perFoot: min ? (feet > 0 ? Math.round((price / feet) * 100) / 100 : 0) : q.priced.pricePerFoot,
    sections: q.sections,
    ...(adjustment ? { adjustmentCents: adjustment } : {}),
    ...(refused ? { adjustmentRefused: true } : {}),
    ...(min ? { minimumLifted: true } : {}),
    ...(problems && (problems.block.length || problems.warn.length) ? { problems } : {}),
    snapshot: {
      materialCost: q.priced.materialCost, laborCost: q.priced.laborCost, tearOutCost: q.priced.tearOutCost,
      totalCOGS: q.priced.totalCOGS, gmPct: min ? min.gmPct : q.priced.gmPct, pullSheet: q.materials.items,
      runRails: style.autoRailMix ? filled.map(x => q.perRunRail[x.i] ?? '6ft') : undefined,
      runSections: filled.map(x => q.perRunSections[x.i]),
      roundingCents: min ? min.roundingCents : q.priced.roundingCents,
      ...(other && q.priced.costFactor > 0 ? { costFactor: q.priced.costFactor } : {}),
      ...(otherMaterial(input.style, style) ? { otherMaterial: true as const } : {}),
      ...(posts ? { posts: { corners: posts.corners, ends: posts.ends, teeLinePosts: posts.extraLinePosts } } : {}),
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
  /** The quote's own margin at that price: a typed price is not the price the snapshot's margin was worked out on. */
  ownGmPct?: number
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
      // Signing copies this margin onto the quote: it has to be the margin at this price (Jaziel Ortiz, 44.00% saved on $12,145 that made 41.86%).
      if (typeof args.ownGmPct === 'number') o.snapshot = { ...o.snapshot, gmPct: args.ownGmPct }
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
    ...(popular >= 0 ? {} : { noRecommendedLabel: true as const }),
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
    noRecommendedLabel: true,
    options: args.options.map(o => ({ ...o, photoId: o.photoId || args.photoIds[o.fenceStyle] || null })),
    ...(args.wholeDollar === false ? {} : { wholeDollar: true }),
    ...(args.showDiscount && args.options.some(o => (o.adjustmentCents ?? 0) < 0) ? { showDiscount: true } : {}),
  }
}
