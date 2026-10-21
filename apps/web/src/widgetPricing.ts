/**
 * The website quote's (EZ Budget, /p/quote) choices and prices. The price of
 * a drawn yard is the quote builder's own: the yard is turned into the
 * builder's layout (widgetDraw.ts toYardLayout), read with the builder's
 * deriveLayout at the style's section width, and priced with priceQuoteJob
 * (the same function the builder and the server's salesman view use) on a new
 * quote's Settings defaults. The options shown are the builder's Good Better
 * Best (or Dig set / No dig) for that material, resolved by tiers.ts.
 *
 * Pure: the server runs it through the estimate bundle; the page never
 * prices anything. Nothing here returns a cost.
 */

import { deriveLayout, type YardLayout } from './yardLayout'
import { layoutPanelFt } from './gateSlide'
import { priceQuoteJob, type QuoteJob, type QuoteJobRequest } from './quoteJob'
import { resolveTiers, type TierSet } from './tiers'
import { isQuotable } from './styleAvailability'
import type { AppConfig, FenceStyle } from './configStore'
import type { QuotePricingOverrides } from './pricingEngine'

// ── What the customer picks ──────────────────────────────────────────────────

export type WidgetMaterial = 'vinyl' | 'chain' | 'alum' | 'wood'
export const MATERIAL_LABEL: Record<WidgetMaterial, string> = { vinyl: 'Vinyl', chain: 'Chain link', alum: 'Aluminum', wood: 'Wood' }
const COLOR_NAME: Record<string, string> = { white: 'White', tan: 'Tan', galv: 'Galvanized', black: 'Black' }
const KIND_NAME: Record<string, string> = { privacy: 'privacy', bell: 'bell top', emily: 'Emily' }

/** One thing the customer can pick: material, color (where it applies), height and kind (privacy / bell top ...). */
export interface WidgetPick { material: WidgetMaterial; color: string; height: string; kind: string }

export interface WidgetCatalog {
  materials: Array<{
    material: WidgetMaterial
    label: string
    colors: Array<{ key: string; label: string }>
    /** Heights (with kind) offered for each color. */
    heights: Array<{ key: string; height: string; kind: string; label: string; colors: string[] }>
  }>
}

/** The picks a style stands for, or null when the widget does not offer it. */
export function pickOf(s: Pick<FenceStyle, 'material' | 'choices'>): WidgetPick | null {
  const c = s.choices ?? {}
  const m = s.material
  if (!c.height || !/^\d+$/.test(c.height)) return null
  if (m === 'vinyl') return c.color ? { material: 'vinyl', color: c.color, height: c.height, kind: c.style || 'privacy' } : null
  if (m === 'chain') return c.grade === 'res' && c.finish ? { material: 'chain', color: c.finish, height: c.height, kind: 'res' } : null
  if (m === 'alum') return { material: 'alum', color: '', height: c.height, kind: c.panel || '' }
  if (m === 'wood') return { material: 'wood', color: '', height: c.height, kind: c.style || 'privacy' }
  return null
}

const samePick = (a: WidgetPick, b: WidgetPick) => a.material === b.material && a.color === b.color && a.height === b.height && a.kind === b.kind

/** Styles available for quoting that the widget offers. */
export function widgetStyles(cfg: Pick<AppConfig, 'fenceStyles'>): FenceStyle[] {
  return cfg.fenceStyles.filter(s => isQuotable(s) && !!pickOf(s))
}

/** Materials, colors and heights the customer can pick from (only what is available for quoting). */
export function widgetCatalog(cfg: Pick<AppConfig, 'fenceStyles'>): WidgetCatalog {
  const order: WidgetMaterial[] = ['vinyl', 'chain', 'alum', 'wood']
  const out: WidgetCatalog = { materials: [] }
  for (const material of order) {
    const picks = widgetStyles(cfg).map(pickOf).filter((p): p is WidgetPick => !!p && p.material === material)
    if (!picks.length) continue
    const colors = [...new Set(picks.map(p => p.color))].filter(Boolean)
    const kinds = new Set(picks.map(p => p.kind))
    const hk = new Map<string, WidgetCatalog['materials'][number]['heights'][number]>()
    for (const p of picks) {
      const key = `${p.height}|${p.kind}`
      const h = hk.get(key) ?? { key, height: p.height, kind: p.kind, label: `${p.height} ft${kinds.size > 1 && KIND_NAME[p.kind] ? ` ${KIND_NAME[p.kind]}` : ''}`, colors: [] }
      if (!h.colors.includes(p.color)) h.colors.push(p.color)
      hk.set(key, h)
    }
    out.materials.push({
      material, label: MATERIAL_LABEL[material],
      colors: colors.map(k => ({ key: k, label: COLOR_NAME[k] ?? k.charAt(0).toUpperCase() + k.slice(1) })),
      heights: [...hk.values()].sort((a, b) => Number(a.height) - Number(b.height) || a.kind.localeCompare(b.kind)),
    })
  }
  return out
}

// ── The builder's request for a drawn yard ───────────────────────────────────

/** A new quote's pricing choices in the quote builder: Settings → Pricing, nothing typed. */
export function newQuoteOverrides(cfg: Pick<AppConfig, 'pricing'>): QuotePricingOverrides {
  const laborMode = cfg.pricing.laborMode ?? 'hourly'
  return {
    laborMode,
    subUnit: laborMode === 'subcontractor' ? (cfg.pricing.subUnit ?? 'foot') : undefined,
    priceMethod: cfg.pricing.priceMethod ?? 'cost_factor',
  } as QuotePricingOverrides
}

/** Section width a style's gates are placed with (QuoteBuilder: auto mix 8, else the style's width). */
export function layoutWidthFt(style: Pick<FenceStyle, 'name' | 'panelWidth' | 'autoRailMix'>): number {
  return layoutPanelFt(style)
}

/** Exactly what the quote builder sends to priceQuoteJob for this yard and style on a new quote. */
export function builderRequest(cfg: AppConfig, yard: YardLayout, style: FenceStyle, priceAdjust = 0, tierSet: Pick<TierSet, 'category' | 'tiers' | 'popular'> | null = null): QuoteJobRequest {
  const r = deriveLayout(yard, layoutWidthFt(style) * 12)
  return {
    fenceStyle: style.name,
    runs: r.runs.map(x => ({ ft: x.ft, rail: 'auto' as const })),
    corners: r.corners, ends: r.ends, walkGates: r.walkGates, dblGates: r.dblGates,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust,
    overrides: newQuoteOverrides(cfg), jobType: 'new', move: null, repair: null,
    tierSet, tierPrefs: { off: [], swap: {} }, compare: false, offer: [], offerNewFence: false, offerMoveAsIs: true, photoIds: {}, keepStyle: null,
  }
}

// ── The options and their prices ─────────────────────────────────────────────

export interface WidgetOption {
  /** Good / Better / Best (or Dig set / No dig), or the style's plain name. */
  key: string
  name: string
  text: string
  popular: boolean
  fenceStyle: string
  styleLabel: string
  /** The quote's price, dollars and cents, as the quote builder shows it for this yard. */
  price: number
  /** Price per foot of fence (gates not counted), dollars and cents. */
  perFoot: number
  /** Price adjust the tier adds (0.05 = 5% more), kept on the saved quote so the builder prices it the same. */
  priceAdjust: number
}

export interface WidgetPriced {
  options: WidgetOption[]
  footageFt: number
  sections: number
}

const cents = (n: number) => Math.round(n * 100) / 100

/** One style priced for the drawn yard, exactly as the quote builder prices it. */
export function priceForStyle(cfg: AppConfig, overheadPct: number, yard: YardLayout, style: FenceStyle, priceAdjust = 0): { job: QuoteJob; req: QuoteJobRequest; price: number; perFoot: number; footageFt: number } {
  const req = builderRequest(cfg, yard, style, priceAdjust)
  const job = priceQuoteJob(cfg, req, overheadPct)
  const footageFt = req.runs.reduce((t, x) => t + (x.ft > 0 ? x.ft : 0), 0)
  const price = cents(job.totals.price)
  return { job, req, price, perFoot: footageFt > 0 ? cents(price / footageFt) : 0, footageFt }
}

/**
 * The options for what the customer picked, each priced for their yard:
 * the builder's tier set for that category (Good Better Best for vinyl, Dig
 * set / No dig for aluminum and chain link), resolved from a style of their
 * pick; without a tier set, each style of their pick.
 */
export function widgetOptions(cfg: AppConfig, overheadPct: number, yard: YardLayout, pick: WidgetPick, tierSets: Array<Pick<TierSet, 'category' | 'tiers' | 'popular'>>): WidgetPriced {
  const mine = widgetStyles(cfg).filter(s => { const p = pickOf(s); return !!p && samePick(p, pick) })
  if (!mine.length) return { options: [], footageFt: 0, sections: 0 }
  // The quote's own style: a fixed width, no dig first (the tiers set install and width themselves).
  const base = [...mine].sort((a, b) => Number(!!a.autoRailMix) - Number(!!b.autoRailMix) || (a.choices?.install === 'nd' ? -1 : 0) - (b.choices?.install === 'nd' ? -1 : 0))[0]
  const set = tierSets.find(t => t.category.trim().toLowerCase() === String(base.category).trim().toLowerCase()) ?? null
  const options: WidgetOption[] = []
  if (set) {
    const req = builderRequest(cfg, yard, base)
    const calcInput = priceQuoteJob(cfg, req, overheadPct).calcInput
    const tiers = resolveTiers(calcInput, cfg.fenceStyles, set, { off: [], swap: {} })
    for (const t of tiers) {
      // resolveTiers hands back the Settings styles it was given.
      const ts = t.style as FenceStyle | undefined
      if (!ts || t.sameAs || !pickOf(ts)) continue
      const adj = (Number(t.spec.priceAdjustPct) || 0) / 100
      const p = priceForStyle(cfg, overheadPct, yard, ts, adj)
      options.push({ key: t.spec.key, name: t.spec.name, text: t.spec.text, popular: t.popular, fenceStyle: ts.name, styleLabel: ts.label || ts.name, price: p.price, perFoot: p.perFoot, priceAdjust: adj })
    }
  }
  if (!options.length) {
    for (const s of mine) {
      const p = priceForStyle(cfg, overheadPct, yard, s)
      const install = s.choices?.install === 'ds' ? 'Dig set' : s.choices?.install === 'nd' ? 'No dig' : ''
      const width = s.autoRailMix ? '' : s.choices?.width ? `${s.choices.width} ft sections` : ''
      options.push({ key: s.name, name: [install, width].filter(Boolean).join(', ') || (s.label || s.name), text: '', popular: false, fenceStyle: s.name, styleLabel: s.label || s.name, price: p.price, perFoot: p.perFoot, priceAdjust: 0 })
    }
    options.sort((a, b) => a.price - b.price)
  }
  const first = options[0] ? priceForStyle(cfg, overheadPct, yard, cfg.fenceStyles.find(s => s.name === options[0].fenceStyle)!) : null
  return { options, footageFt: first?.footageFt ?? 0, sections: first?.job.calc.sections ?? 0 }
}
