/**
 * Target Profit % and sub rates set once for many fences (Jonathan, Nov 2
 * 2026: "Set it at the material or style level and every fence under it
 * follows. A single fence or color can override it, and an override is
 * clearly marked with a reset to the default.").
 *
 * Four numbers, each set at any level of Settings → Fence styles:
 *
 *   targetProfitPct   Target Margin = Overhead % + this
 *   subRate           the sub's pay per foot or per section (Settings' unit)
 *   subWalkGate       the sub's pay per walk gate
 *   subDblGate        the sub's pay per double gate
 *
 * A fence uses, nearest first:
 *   1. its own number (a Target Profit marked ownProfit; a sub rate typed on it);
 *   2. its color's (a color's Target Profit lives on the color, as before);
 *   3. its other choices', the last chosen first (Vinyl: Panel width, then
 *      Install, Height, Style);
 *   4. its material's;
 *   5. then, as before: Target Profit the number saved on the fence; sub rates
 *      the category rate and the default in Settings → Pricing.
 *
 * Worked out on every read (resolveFenceStyles puts it on the fence as
 * `followed`, never saved), so a change reaches every fence under it at once.
 * A saved quote keeps the cost factor and the sub rate it was priced with
 * (QuoteBuilder, lib/quotePricing.ts), and a sent or signed quote's price is
 * never priced again: a change here reaches new quotes only.
 *
 * Pure: the server's estimates run it too.
 */

import type { FenceStyle } from './configStore'
import type { ChoiceOption, FenceCatalog, MaterialDef } from './fenceCatalog'

export type RateKey = 'targetProfitPct' | 'subRate' | 'subWalkGate' | 'subDblGate'
export const RATE_KEYS: readonly RateKey[] = ['targetProfitPct', 'subRate', 'subWalkGate', 'subDblGate']
/** Numbers set on a material or a choice for every fence under it; a key left out is not set there. */
export type RateDefaults = Partial<Record<RateKey, number>>
/** A number a fence follows, and the name of the material or choice it is set on. */
export interface Followed { value: number; from: string }
export type FollowedRates = Partial<Record<RateKey, Followed>>

const PROFIT_MAX = 80
/** Is this a number that can be set for this key? Target Profit 0 to 80; a sub rate above 0. */
export function validRate(key: RateKey, v: unknown): v is number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return false
  return key === 'targetProfitPct' ? v >= 0 && v <= PROFIT_MAX : v > 0
}

/** The number a choice sets for every fence under it. A color's Target Profit is the one on the color (ColorSpec). */
export function optionRate(opt: ChoiceOption | undefined, key: RateKey): number | undefined {
  if (!opt) return undefined
  const v = key === 'targetProfitPct' && opt.color ? opt.color.targetProfitPct : opt.rateDefaults?.[key]
  return validRate(key, v) ? v : undefined
}

/** The number a material sets for every fence under it. */
export function materialRate(m: MaterialDef | undefined, key: RateKey): number | undefined {
  const v = m?.rateDefaults?.[key]
  return validRate(key, v) ? v : undefined
}

/** Where a fence's numbers can come from, nearest first: its color, its other choices (last chosen first), its material. */
function sourcesOf(m: MaterialDef, choices: Record<string, string>): Array<{ label: string; color: boolean; rate: (k: RateKey) => number | undefined }> {
  const opts = m.dims.map(d => ({ d, opt: d.options.find(o => o.key === choices[d.key]) })).filter(x => !!x.opt)
  const colors = opts.filter(x => x.d.isColor)
  const others = opts.filter(x => !x.d.isColor).reverse()
  return [
    ...[...colors, ...others].map(x => ({ label: x.opt!.label, color: !!x.d.isColor, rate: (k: RateKey) => optionRate(x.opt, k) })),
    { label: m.label, color: false, rate: (k: RateKey) => materialRate(m, k) },
  ]
}

/**
 * What a fence follows from its choices and material, for each number set
 * above it. `withColorProfit` false leaves a color's Target Profit out (the
 * price reads it as colorTargetProfitPct, which a fence's own number beats).
 */
export function followedRates(m: MaterialDef | undefined, choices: Record<string, string> | undefined, withColorProfit = true): FollowedRates {
  const out: FollowedRates = {}
  if (!m || !choices) return out
  const sources = sourcesOf(m, choices)
  for (const key of RATE_KEYS) {
    for (const s of sources) {
      if (key === 'targetProfitPct' && s.color && !withColorProfit) continue
      const v = s.rate(key)
      if (v !== undefined) { out[key] = { value: v, from: s.label }; break }
    }
  }
  return out
}

/** The number a fence would follow for this key if it had none of its own, skipping one level (to show what a default replaces). */
export function followedWithout(m: MaterialDef | undefined, choices: Record<string, string> | undefined, key: RateKey, skip: { dim?: string; option?: string; material?: boolean }): Followed | undefined {
  if (!m || !choices) return undefined
  const trimmed: MaterialDef = {
    ...m,
    ...(skip.material ? { rateDefaults: undefined } : {}),
    dims: m.dims.map(d => (d.key !== skip.dim ? d : { ...d, options: d.options.map(o => (o.key !== skip.option ? o : { ...o, rateDefaults: undefined, ...(o.color ? { color: { ...o.color, targetProfitPct: undefined } } : {}) })) })),
  }
  return followedRates(trimmed, choices)[key]
}

/** Is the fence's Target Profit its own (an override), not the one above it? */
export function ownsProfit(s: Pick<FenceStyle, 'ownProfit' | 'targetProfitPct'>): boolean {
  return s.ownProfit === true && validRate('targetProfitPct', s.targetProfitPct)
}

/** The fence's own number for a key, or undefined when it follows. */
export function ownRate(s: Pick<FenceStyle, 'ownProfit' | 'targetProfitPct' | 'subRate' | 'subWalkGate' | 'subDblGate'>, key: RateKey): number | undefined {
  if (key === 'targetProfitPct') return ownsProfit(s) ? s.targetProfitPct : undefined
  const v = s[key]
  return validRate(key, v) ? v : undefined
}

/** A material or choice's numbers with one set (a number) or cleared (undefined); undefined when none is left. */
export function withRate(d: RateDefaults | undefined, key: RateKey, v: number | undefined): RateDefaults | undefined {
  const next: RateDefaults = { ...(d ?? {}) }
  if (validRate(key, v)) next[key] = v
  else delete next[key]
  return Object.keys(next).length ? next : undefined
}

/** Is any number set on a material or a choice of this catalog? */
export function catalogHasRates(c: FenceCatalog | null | undefined): boolean {
  return !!c?.materials?.some(m => !!m.rateDefaults && Object.keys(m.rateDefaults).length > 0
    || m.dims.some(d => d.options.some(o => !!o.rateDefaults && Object.keys(o.rateDefaults).length > 0)))
}
