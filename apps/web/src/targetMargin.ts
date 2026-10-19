/**
 * Target Margin math, pure (no browser): Overhead % + each style's Target
 * Profit %, and the number price is divided into = (100 − Target Margin) ÷ 100,
 * worked out in whole percents so 30 + 14 gives exactly 0.56.
 */

import type { AppConfig, FenceStyle } from './configStore'
import { woodFactorOf } from './wood'

export const DEFAULT_OVERHEAD_PCT = 30
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
    const profit = typeof s.targetProfitPct === 'number' && Number.isFinite(s.targetProfitPct)
      ? s.targetProfitPct
      : round2((1 - (s.margin || 0.64)) * 100 - typed)
    // A color with its own Target Profit % (Settings → Fence styles) earns that instead.
    const earn = typeof s.colorTargetProfitPct === 'number' && Number.isFinite(s.colorTargetProfitPct) ? s.colorTargetProfitPct : profit
    return { ...s, targetProfitPct: profit, margin: (100 - overhead - earn) / 100 }
  })
  // Wood is priced from its white vinyl style (wood.ts): that style as read, and the Wood factor.
  const factor = woodFactorOf(cfg)
  const fenceStyles = styles.map(s => {
    if (!s.woodOf) return s
    const base = styles.find(v => v.name === s.woodOf)
    return base ? { ...s, woodBase: base, woodFactor: factor } : s
  })
  return { ...cfg, pricing: { ...cfg.pricing, overheadPct: typed }, fenceStyles }
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
