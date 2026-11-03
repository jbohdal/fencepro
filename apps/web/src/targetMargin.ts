/**
 * Target Margin math, pure (no browser): Overhead % + each style's Target
 * Profit %, and the number price is divided into = (100 − Target Margin) ÷ 100,
 * worked out in whole percents so 30 + 14 gives exactly 0.56.
 */

import type { AppConfig, FenceStyle } from './configStore'
import { woodFactorOf } from './wood'
import { ownsProfit } from './fenceRates'

export const DEFAULT_OVERHEAD_PCT = 30
/**
 * The most a Target Margin (Overhead % + Target Profit %) may be (review Nov 2
 * 2026: 80% profit on vinyl read 110% and priced lower; 69% priced about 100
 * times cost). Settings refuses more; a fence over it is not available for
 * quoting until it is lowered.
 */
export const MAX_TARGET_MARGIN_PCT = 80
const round2 = (n: number) => Math.round(n * 100) / 100

export function typedOverheadPct(cfg: Pick<AppConfig, 'pricing'>): number {
  const v = cfg.pricing?.overheadPct
  return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_OVERHEAD_PCT
}

/**
 * Each style's divisor from Overhead % and its Target Profit %. A style saved
 * before Target Profit existed gets it from its old number at the typed
 * overhead, so its price does not change. `overhead` is the overhead in use
 * (live from the budget when that is on).
 */
export function withTargetMargins<C extends Pick<AppConfig, 'pricing' | 'fenceStyles'> & { moveRepair?: AppConfig['moveRepair'] }>(cfg: C, overhead = typedOverheadPct(cfg)): C {
  const typed = typedOverheadPct(cfg)
  const styles = (cfg.fenceStyles ?? []).map((s: FenceStyle) => {
    const saved = typeof s.targetProfitPct === 'number' && Number.isFinite(s.targetProfitPct)
      ? s.targetProfitPct
      : round2((1 - (s.margin || 0.64)) * 100 - typed)
    // Its own number (set on the fence) wins; else its color's; else the one its choices or material set
    // (fenceRates.ts); else the one saved on it. The saved one is kept as it is (clearing a number above gives it back).
    const own = ownsProfit(s)
    const above = s.followed?.targetProfitPct?.value
    const earn = own ? s.ownProfitPct!
      : typeof s.colorTargetProfitPct === 'number' && Number.isFinite(s.colorTargetProfitPct) ? s.colorTargetProfitPct
        : typeof above === 'number' && Number.isFinite(above) ? above : saved
    const margin = (100 - overhead - earn) / 100
    const tm = round2(overhead + earn)
    const over = tm > MAX_TARGET_MARGIN_PCT ? `its Target Margin ${tm}% is over ${MAX_TARGET_MARGIN_PCT}%: lower its Target Profit in Settings → Fence styles` : ''
    return { ...s, targetProfitPct: saved, margin, ...(over ? { held: s.held ? `${s.held}; ${over}` : over } : {}) }
  })
  // Wood's install labor (and its moves and repairs) come from its white vinyl style × the Wood factor (wood.ts): that style as read, and the factor.
  const factor = woodFactorOf(cfg)
  const fenceStyles = styles.map(s => {
    if (!s.woodOf) return s
    const base = styles.find(v => v.name === s.woodOf)
    return base ? { ...s, woodBase: base, woodFactor: factor } : s
  })
  return { ...cfg, pricing: { ...cfg.pricing, overheadPct: typed }, fenceStyles }
}

/** The Target Profit a fence earns (its own, its color's, the one it follows, the one saved on it), as the price reads it. */
export function earnedProfitPct(s: Pick<FenceStyle, 'ownProfitPct' | 'colorTargetProfitPct' | 'followed' | 'targetProfitPct'>): number | undefined {
  const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
  if (ownsProfit(s)) return s.ownProfitPct
  if (ok(s.colorTargetProfitPct)) return s.colorTargetProfitPct
  if (ok(s.followed?.targetProfitPct?.value)) return s.followed!.targetProfitPct!.value
  return ok(s.targetProfitPct) ? s.targetProfitPct : undefined
}

/** The highest Target Profit % that keeps the Target Margin within MAX_TARGET_MARGIN_PCT at this overhead. */
export function maxProfitPct(overheadPct: number): number {
  return Math.max(0, round2(MAX_TARGET_MARGIN_PCT - overheadPct))
}

/** A style's Target Margin as a percent (44 for 44%). */
export function targetMarginPct(style: Pick<FenceStyle, 'margin'>): number {
  return round2((1 - style.margin) * 100)
}

/** "44", "44%", " 44.5 % " → 44.5. Null when it is not a percent. */
export function parsePercent(text: string): number | null {
  const m = String(text).trim().replace(/\s+/g, '').match(/^(-?\d+(?:\.\d+)?)%?$/)
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}
