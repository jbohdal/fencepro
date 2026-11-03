/**
 * What Settings → Fence styles shows, worked out from the page's draft
 * (owner only). Pure (no browser code). Review, Nov 2 2026:
 *
 *   - A switch shows ON only when something under it can be quoted. A choice
 *     whose fences are all off reads "Off (nothing under it can be quoted)"
 *     with the reason; a fence that cannot be quoted shows its switch OFF with
 *     the reason, never ON with red text. Tapping a switch still turns that
 *     level's own setting on or off, and the words say which it is.
 *   - Fences held back by an archived choice are listed in an Archived part.
 *   - Each fence's Target Profit %, Target Margin and sub rates, where each
 *     comes from (fenceRates.ts), and a live example: cost and price of 100 ft.
 */

import type { AppConfig, FenceStyle } from './configStore'
import { catalogOf, resolveFenceStyles, styleChoicesOf, materialOf, type ChoiceDim, type FenceCatalog, type MaterialDef } from './fenceCatalog'
import { withTargetMargins } from './targetMargin'
import { isQuotable } from './styleAvailability'
import { calculateQuote } from './quoteCalc'
import { resolveSubGateRate, resolveSubRate } from './pricingEngine'
import { DEFAULT_CONFIG } from './configDefaults'
import { followedRates, ownRate, ownsProfit, materialRate, optionRate, type RateKey } from './fenceRates'

/** The fences as the quote builder would read them with this draft (at the Overhead % in use): holds, what each follows, Target Margins. */
export function draftView(cfg: AppConfig, overheadPct: number): AppConfig {
  const catalog = catalogOf(cfg)
  return withTargetMargins({ ...cfg, fenceStyles: resolveFenceStyles(cfg.fenceStyles ?? [], catalog) }, overheadPct)
}

// ── Honest switches ──────────────────────────────────────────────────────────

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The choices a fence is held back by because they are archived ("Privacy"), from its `held` reasons. */
export function archivedBy(s: Pick<FenceStyle, 'held'>): string[] {
  return (s.held ?? '').split('; ').map(r => r.match(/^(.+) is archived$/)?.[1]).filter((x): x is string => !!x)
}

/** Why one fence cannot be quoted, each reason on its own; empty when it can. `skip`: the level being described (its own reason is said already). */
function reasonsOf(s: FenceStyle, skip?: string): string[] {
  const out: string[] = []
  if (s.isActive === false) out.push('turned off')
  if (s.quotable === false) out.push('switched off')
  for (const r of (s.held ?? '').split('; ')) if (r && !(skip && r.startsWith(`${skip} is `))) out.push(r)
  return out
}

/** What a material's or a choice's switch shows. */
export interface GroupSwitch {
  /** The switch: on only when its own setting is on and a fence under it can be quoted. */
  on: boolean
  /** Its own setting (what a tap changes). */
  ownOn: boolean
  /** Its own setting is on but nothing under it can be quoted: why, in plain words. */
  offWhy: string | null
}

/**
 * A material's or a choice's switch from the fences under it (resolved, with
 * `held`). Fences held back by an archived choice are not counted.
 */
export function groupSwitch(ownOn: boolean, fences: FenceStyle[], label: string): GroupSwitch {
  const live = fences.filter(s => !archivedBy(s).some(a => a !== label))
  if (!ownOn) return { on: false, ownOn, offWhy: null }
  if (live.some(isQuotable)) return { on: true, ownOn, offWhy: null }
  if (!live.length) return { on: false, ownOn, offWhy: 'Off (nothing under it can be quoted): no fence is made with it.' }
  const count = new Map<string, number>()
  for (const s of live) for (const r of new Set(reasonsOf(s, label))) count.set(r, (count.get(r) ?? 0) + 1)
  const n = live.length
  const parts = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([r, k]) => {
    if (r === 'switched off' || r === 'turned off') return k === n ? `${n === 1 ? 'its fence is' : n === 2 ? 'both fences are' : `all ${n} fences are`} ${r}` : `${k} of ${n} fences are ${r}`
    return k === n ? r : `${r} (${k} of ${n} fences)`
  })
  return { on: false, ownOn, offWhy: `Off (nothing under it can be quoted): ${parts.join('; ')}.` }
}

/** What a fence row says under its name; null when it can be quoted. */
export function fenceStatus(s: FenceStyle): string | null {
  if (isQuotable(s)) return null
  const own = s.isActive === false ? 'Turned off' : s.quotable === false ? 'Switched off' : null
  if (own) return s.held ? `${own}. Also: ${s.held}.` : `${own}.`
  return `Off (cannot be quoted): ${s.held}.`
}

// ── Category ─────────────────────────────────────────────────────────────────

/** Every category a fence can have, in the order the Category list shows them. */
export const FENCE_CATEGORIES: ReadonlyArray<FenceStyle['category']> = ['Vinyl', 'Chainlink', 'Commercial', 'Aluminum', 'Wood', 'Other']

/**
 * The Category list for a fence: every category, and the fence's own when it
 * is not one of them, so the list always shows (and saves) what the fence has
 * (audit Nov 2 2026: wood fences read "Vinyl" because Wood was not in the list).
 */
export function categoryChoices(current: string | undefined): string[] {
  const all: string[] = [...FENCE_CATEGORIES]
  return current && !all.includes(current) ? [...all, current] : all
}

// ── Words on this screen ─────────────────────────────────────────────────────

/** A choice's heading on this screen: sections, not panels; "Picket type", not "Pickets". */
export function dimHeading(d: Pick<ChoiceDim, 'key' | 'label'>): string {
  if (d.key === 'picket' && /^pickets?$/i.test(d.label.trim())) return 'Picket type'
  return d.label.replace(/\bpanels\b/g, 'sections').replace(/\bpanel\b/g, 'section').replace(/\bPanels\b/g, 'Sections').replace(/\bPanel\b/g, 'Section')
}

/** A fence's plain name on this screen: "8 ft sections", not "8 ft panels". */
export function fenceName(s: Pick<FenceStyle, 'label' | 'name'>): string {
  return (s.label || s.name).replace(/\bpanels\b/g, 'sections').replace(/\bpanel\b/g, 'section')
}

// ── Target Profit and sub rates on a fence ───────────────────────────────────

/** Where a fence's number comes from, in words: "Own number", "Dig set", "Vinyl", "Settings → Pricing (Vinyl)". */
export interface RateShown {
  value: number
  /** Set on this fence (an override): shown with Reset. */
  own: boolean
  /** Where it comes from when not its own (or what Reset goes back to): a choice, a material, Settings → Pricing. */
  from: string
  /** What Reset gives: the number above this fence (null: nothing is set above it). */
  reset: { value: number; from: string } | null
}

const pos = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined)

/** A fence's Target Profit %, and where it comes from. `s`: resolved (draftView). */
export function profitShown(s: FenceStyle, m: MaterialDef | undefined): RateShown {
  const sc = styleChoicesOf(s)
  const above = followedRates(m, sc?.choices)  // with the color's
  const top = above.targetProfitPct
  const own = ownsProfit(s)
  const value = own ? s.targetProfitPct! : top ? top.value : s.targetProfitPct ?? 0
  return {
    value, own,
    from: own ? 'Own number' : top ? top.from : 'Set on this fence',
    reset: top ? { value: top.value, from: top.from } : null,
  }
}

/** A fence's sub rate (per foot or section), walk gate or double gate rate, and where it comes from. */
export function subShown(s: FenceStyle, m: MaterialDef | undefined, pricing: AppConfig['pricing'], key: Exclude<RateKey, 'targetProfitPct'>): RateShown {
  const sc = styleChoicesOf(s)
  const top = followedRates(m, sc?.choices)[key]
  const own = ownRate(s, key)
  // Without its own number: what the price reads (fenceRates.ts, then Settings → Pricing).
  const bare: FenceStyle = { ...s, subRate: undefined, subWalkGate: undefined, subDblGate: undefined, followed: top ? { [key]: top } : undefined }
  const followedValue = key === 'subRate' ? resolveSubRate(bare, pricing) : resolveSubGateRate(bare, pricing, key === 'subWalkGate' ? 'walk' : 'dbl')
  const settingsFrom = key === 'subRate' && pos(pricing.subRateByCategory?.[s.category]) ? `Settings → Pricing (${s.category})` : 'Settings → Pricing'
  const from = top ? top.from : settingsFrom
  return {
    value: own ?? followedValue, own: own !== undefined, from: own !== undefined ? 'Own number' : from,
    reset: followedValue > 0 ? { value: followedValue, from } : null,
  }
}

/** The unit a sub rate is paid per, as the price reads it (one unit for every fence: Settings → Pricing). */
export function subUnitWords(pricing: AppConfig['pricing']): { short: string; long: string } {
  return pricing.subUnit === 'section' ? { short: 'section', long: 'per section' } : { short: 'ft', long: 'per foot' }
}

/** The material's and each choice's own numbers (blank when not set there), for its editor. */
export function levelRate(m: MaterialDef, dim: ChoiceDim | null, key: RateKey, optKey?: string): number | undefined {
  if (!dim) return materialRate(m, key)
  return optionRate(dim.options.find(o => o.key === optKey), key)
}

// ── The live example ─────────────────────────────────────────────────────────

/** Cost and price of 100 ft of this fence, one straight run with two end posts, no gates, no Salesman, in cents; null when it cannot be priced. */
export function example100ft(s: FenceStyle | undefined, cfg: Pick<AppConfig, 'pricing' | 'railOptimizer'>): { costCents: number; priceCents: number; marginPct: number } | null {
  if (!s) return null
  try {
    const c = calculateQuote({
      style: s, runs: [{ ft: 100, rail: 'auto' }], corners: 0, ends: 2, walkGates: 0, dblGates: 0,
      tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
      pricing: cfg.pricing, optimizer: cfg.railOptimizer ?? DEFAULT_CONFIG.railOptimizer!,
    })
    if (!(c.materialCost > 0) || !(c.priced.price > 0)) return null
    return { costCents: Math.round(c.priced.totalCOGS * 100), priceCents: Math.round(c.priced.price * 100), marginPct: Math.round((1 - s.margin) * 1000) / 10 }
  } catch { return null }
}

/** The fences of a material, resolved, by material key. */
export function fencesOf(view: AppConfig, catalog: FenceCatalog, material: string): FenceStyle[] {
  return view.fenceStyles.filter(s => styleChoicesOf(s)?.material === material && !!materialOf(catalog, material))
}
