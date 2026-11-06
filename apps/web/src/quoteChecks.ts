/**
 * Plain warnings that catch a bad quote before it goes out. None of them
 * block saving; they say what to check. Pure, so each is tested on its own.
 */

import { styleLabel } from './fenceCatalog'
import { formatFtIn, sideGates, type YardLayout } from './yardLayout'
import { earnedProfitPct } from './targetMargin'
import type { FenceStyle } from './configStore'

/** "Back (150' 0")" for a layout run, "Run 2 (81' 0")" for a typed one. */
export interface NamedRun { ft: number; label: string }

const TAPE = 'Check this length with a tape measure. A few inches either way changes the number of sections.'

/**
 * A run that lands right on a whole number of sections, or up to 6 inches
 * over one, is where a short tape changes the order: 80' at 8' wide is 10
 * sections, 80' 1" is 11.
 */
export function tapeChecks(runs: NamedRun[], widthsFt: number[]): string[] {
  const out: string[] = []
  runs.forEach((r, i) => {
    const w = widthsFt[i]
    if (!(r.ft > 0) || !(w > 0)) return
    const inches = Math.round(r.ft * 12 * 8) / 8
    const over = inches % (w * 12)
    if (inches >= w * 12 && over <= 6 + 1e-9) out.push(`${r.label}: ${TAPE}`)
  })
  return out
}

/** Which runs need a tape check, by index, for marking them on the screen. */
export function tapeFlags(runs: NamedRun[], widthsFt: number[]): boolean[] {
  return runs.map((r, i) => tapeChecks([r], [widthsFt[i]]).length > 0)
}

/** A gate on a side under 6 ft, or wider than its side. */
export function gateChecks(layout: YardLayout | null): string[] {
  if (!layout) return []
  const out: string[] = []
  // A side left on without a length still gets its corner posts counted.
  if (layout.sides.some(s => s.on && s.lengthIn > 0)) {
    for (const s of layout.sides) if (s.on && !(s.lengthIn > 0)) out.push(`${s.name} has no length yet. Enter it, or turn it off if there is no fence there.`)
  }
  for (const s of layout.sides) {
    if (!s.on || !(s.lengthIn > 0)) continue
    for (const g of sideGates(s)) if (g.widthIn > s.lengthIn) out.push(`${s.name}: the gate (${formatFtIn(g.widthIn)}) is wider than the side (${formatFtIn(s.lengthIn)}).`)
    else if (s.lengthIn < 72) out.push(`${s.name} is under 6 ft (${formatFtIn(s.lengthIn)}) and has a gate. Check the measurement and the gate width.`)
  }
  return out
}

const pctWords = (n: number) => `${Math.round(n * 1000) / 10}%`

/**
 * The Target Margin a quote's fence is priced to reach (a fraction): the Overhead % the quote is priced at + the
 * fence's Target Profit as Settings resolve it (its own, its color's, the one it follows; targetMargin.ts). A move or
 * repair with a Repair Profit % in Settings: Overhead + Repair Profit, as moveRepair.ts prices it.
 */
export function fenceTargetMargin(style: TargetStyle, overheadPct: number, work: { repairProfitPct: number | null } | null = null): number {
  if (work && work.repairProfitPct !== null && overheadPct + work.repairProfitPct < 100) return (overheadPct + work.repairProfitPct) / 100
  const profit = earnedProfitPct(style)
  if (typeof profit === 'number' && Number.isFinite(profit) && Number.isFinite(overheadPct)) return (overheadPct + profit) / 100
  return 1 - (Number(style.margin) || 0)
}
type TargetStyle = Pick<FenceStyle, 'margin' | 'ownProfitPct' | 'colorTargetProfitPct' | 'followed' | 'targetProfitPct'>

/**
 * Price less cost (before commission: a Salesman's quote at target never warns for her commission) under the quote's
 * own fence's Target Margin (Jonathan, Nov 3 2026: "Warn only when a quote is under that fence's own target margin").
 * A quote priced at its target is rounded down to the whole dollar, so up to a dollar under it never warns.
 */
export function marginCheck(margin: number, target: number, price: number, from = 'Overhead + Target Profit'): string | null {
  if (!(price > 0) || !(target > 0)) return null
  if ((margin - target) * price > -1 - 1e-9) return null
  return `Margin is ${(margin * 100).toFixed(1)}% (price less cost), under this fence's ${pctWords(target)} Target Margin (${from} in Settings).`
}

export interface PastQuote { id?: string; fenceStyle: string; finalPrice: number; runs?: number[]; status?: string }

/**
 * The normal price per foot for a style, from saved quotes: the middle 80%
 * of them (10th to 90th percentile). Null with fewer than 5 quotes.
 */
export function normalPerFoot(style: string, past: PastQuote[], excludeId?: string): { low: number; high: number; n: number } | null {
  const ppf = past
    .filter(q => q.fenceStyle === style && q.id !== excludeId && q.finalPrice > 0)
    .map(q => ({ q, feet: (q.runs ?? []).reduce((s, n) => s + n, 0) }))
    .filter(x => x.feet > 0)
    .map(x => x.q.finalPrice / x.feet)
    .sort((a, b) => a - b)
  if (ppf.length < 5) return null
  const at = (p: number) => ppf[Math.min(ppf.length - 1, Math.max(0, Math.round(p * (ppf.length - 1))))]
  return { low: at(0.1), high: at(0.9), n: ppf.length }
}

/** Far outside = more than 15% beyond the normal range. */
export function perFootCheck(perFoot: number, style: string, past: PastQuote[], excludeId?: string): string | null {
  if (!(perFoot > 0)) return null
  const n = normalPerFoot(style, past, excludeId)
  if (!n) return null
  const money = (v: number) => `$${v.toFixed(2)}`
  const range = `usually ${money(n.low)} to ${money(n.high)} a foot, from ${n.n} past quotes`
  // The fence by its plain name, never its internal code (wood/stockade/6/pine/ds/8).
  const name = styleLabel(style) || style
  if (perFoot > n.high * 1.15) return `${money(perFoot)} a foot is far above your past ${name} quotes (${range}).`
  if (perFoot < n.low * 0.85) return `${money(perFoot)} a foot is far below your past ${name} quotes (${range}).`
  return null
}
