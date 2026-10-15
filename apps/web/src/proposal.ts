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

export interface ProposalSettings {
  /** Extra "what's included" text, one item per line. */
  included?: string
  depositPct?: number
  depositNote?: string
  financing?: { provider?: string; apr?: number; months?: number; link?: string }
  /** Turned on once the public door for /p is open, so customers can open links. */
  publicLinks?: boolean
}

export interface ProposalOption {
  label: string
  fenceStyle: string
  finalPrice: number
  perFoot: number
  sections: number
  photoId?: string | null
  /** Priced snapshot copied onto the quote if the customer picks this option. Never shown to the customer. */
  snapshot: {
    materialCost: number; laborCost: number; tearOutCost: number; totalCOGS: number; gmPct: number
    pullSheet: LineItem[]; runRails?: Array<'auto' | '6ft' | '8ft'>; runSections: number[]
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
}

// ── Which options make sense for a style ──────────────────────────────────────

const VINYL = /^(WV|TV)-(ND|DS) ([68])'x([68])' Privacy$/
const CHAIN = /^CL - (\d)' (Galv|Black)$/
const EMILY = /^Alum - (ND|DS) - Emily - 48$/

/** The styles to compare with this one (itself first), from the active styles in Settings. */
export function compareStyles<S extends QuoteStyle & { isActive?: boolean }>(style: S, styles: S[]): S[] {
  const active = styles.filter(s => s.isActive !== false || s.name === style.name)
  let family: S[] = []
  if (style.autoRailMix) {
    family = active.filter(s => { const m = s.name.match(VINYL); return !!m && m[3] === '6' })
  } else if (VINYL.test(style.name)) {
    const tall = style.name.match(VINYL)![3]
    family = active.filter(s => { const m = s.name.match(VINYL); return !!m && m[3] === tall })
  } else if (CHAIN.test(style.name)) {
    const h = style.name.match(CHAIN)![1]
    family = active.filter(s => { const m = s.name.match(CHAIN); return !!m && m[1] === h })
  } else if (EMILY.test(style.name)) {
    family = active.filter(s => EMILY.test(s.name))
  }
  if (family.length === 0) return [style]
  return [style, ...family.filter(s => s.name !== style.name)]
}

/** "White vinyl privacy, no dig, 6 ft tall, 8 ft wide sections". */
export function optionLabel(styleName: string): string {
  const v = styleName.match(VINYL)
  if (v) return `${v[1] === 'WV' ? 'White' : 'Tan'} vinyl privacy, ${v[2] === 'ND' ? 'no dig' : 'dig set'}, ${v[3]} ft tall, ${v[4]} ft wide sections`
  const auto = styleName.match(/^(WV|TV)-Auto (ND|DS)/)
  if (auto) return `${auto[1] === 'WV' ? 'White' : 'Tan'} vinyl privacy, ${auto[2] === 'ND' ? 'no dig' : 'dig set'}, 6 ft tall, 6 and 8 ft wide sections`
  const c = styleName.match(CHAIN)
  if (c) return `Chain link, ${c[1]} ft tall, ${c[2] === 'Galv' ? 'galvanized' : 'black'}`
  const e = styleName.match(EMILY)
  if (e) return `Aluminum Emily, 4 ft tall, ${e[1] === 'ND' ? 'no dig' : 'dig set'}`
  return styleName
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
}): QuoteProposal {
  const { input, settings } = args
  const own = input.style!
  const options = args.styles.map((s, i) => {
    const o = priceOption(input, s)
    // The quote's own option keeps the price on the quote, even one typed by hand.
    if (i === 0 && s.name === own.name && args.ownPrice > 0) {
      const feet = input.runs.reduce((t, r) => t + (r.ft > 0 ? r.ft : 0), 0)
      o.finalPrice = args.ownPrice
      o.perFoot = feet > 0 ? Math.round((args.ownPrice / feet) * 100) / 100 : 0
    }
    o.photoId = args.photoIds[s.name] ?? null
    return o
  })
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
    recommended: 0,
    options,
  }
}

/** The customer's link: the public door on a Tailscale address, the app's own address otherwise. */
export function proposalUrl(token: string): string {
  const { protocol, hostname, origin } = window.location
  return hostname.endsWith('.ts.net') ? `${protocol}//${hostname}:8443/p/${token}` : `${origin}/p/${token}`
}
