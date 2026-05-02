/**
 * Smart Rail Optimizer (Milestone A — recommendation engine).
 *
 * For a vinyl fence job, decides per run whether 6' or 8' rails minimize
 * material cost while maximizing labor productivity (same labor per section,
 * fewer sections on long runs at 8').
 *
 * This module is intentionally calculator-agnostic: it takes per-run
 * footages plus the per-section material costs for each rail option and
 * returns a recommendation. It does NOT yet drive the actual material list
 * in materialCalculator.ts — that's Milestone B.
 *
 * Defaults reflect the EZ-Quote spreadsheet ($ values per panel for white
 * vinyl ND), but every cost is overridable so the optimizer also serves
 * tan ND / white DS / tan DS once those costs are passed in.
 */

import { sectionsForRun } from './sectionCount'

/* ──────────────────────────────────────────────────────────────────────────
 * Types
 * ────────────────────────────────────────────────────────────────────────── */

export type RailType = '6ft' | '8ft'

export interface RailOptimizerSettings {
  /** Master switch. When false, the optimizer returns all '6ft' decisions
   *  with `disabled: true` and zero savings. */
  enabled: boolean
  /** Runs at or below this footage are forced to 6ft sections. Default 6. */
  shortRunCutoffFt: number
  /** When 8ft cost is within this fraction of 6ft cost, prefer 8ft for the
   *  productivity gain (fewer sections = fewer man-hours). Default 0.02 (2%). */
  costPreferenceThreshold: number
}

export const DEFAULT_RAIL_OPTIMIZER_SETTINGS: RailOptimizerSettings = {
  enabled: true,
  shortRunCutoffFt: 6,
  costPreferenceThreshold: 0.02,
}

/** Per-section material costs for a single rail option. Defaults match the
 *  white-vinyl ND values from the EZ-Quote spreadsheet; pass in different
 *  numbers for tan / DS variants. */
export interface PanelCosts {
  /** Number of pickets per section. White vinyl: 11 (6x6) / 15 (6x8). */
  picketsPerSection: number
  /** Cost per picket. */
  picketCost: number
  /** Number of rails per section (always 2 — top + bottom). */
  railsPerSection: number
  /** Cost per rail. White vinyl: $5.98 (6'), $9.26 (8'). */
  railCost: number
  /** U-trim count per section (always 2). */
  uTrimPerSection: number
  /** Cost per u-trim. White vinyl: $1.62. Same SKU for both widths. */
  uTrimCost: number
  /** Whether this option needs a metal stiffener (Vinyl, Rail Insert, 8') */
  hasStiffener: boolean
  /** Stiffener cost. White vinyl: $8.00. */
  stiffenerCost: number
}

export const WHITE_VINYL_6X6_COSTS: PanelCosts = {
  picketsPerSection: 11,
  picketCost: 2.71,
  railsPerSection: 2,
  railCost: 5.98,
  uTrimPerSection: 2,
  uTrimCost: 1.62,
  hasStiffener: false,
  stiffenerCost: 8.0,
}

export const WHITE_VINYL_6X8_COSTS: PanelCosts = {
  picketsPerSection: 15,
  picketCost: 2.71,
  railsPerSection: 2,
  railCost: 9.26,
  uTrimPerSection: 2,
  uTrimCost: 1.62,
  hasStiffener: true,
  stiffenerCost: 8.0,
}

export interface OptimizerRunInput {
  /** Footage of this run. */
  footage: number
  /** Optional manual override; bypasses cost compare + cutoff. */
  override?: RailType | 'auto'
}

export interface OptimizerRunResult {
  index: number
  footage: number
  /** Final selected rail type for this run. */
  railType: RailType
  /** Sections at the selected rail width. */
  sectionCount: number
  /** Material cost for this run if we used 6ft sections. */
  materialCost6ft: number
  /** Material cost for this run if we used 8ft sections (incl. stiffener). */
  materialCost8ft: number
  /** Math.abs(cost6 - cost8). 0 if a forced/short run. */
  savings: number
  /** True when forced by the short-run cutoff. */
  isShortRun: boolean
  /** True when the user manually overrode the optimizer. */
  isOverridden: boolean
  /** True when the optimizer was disabled and 6ft was used by default. */
  isDisabled: boolean
  /** Plain-English why for the UI. */
  reason: string
}

export interface OptimizerJobResult {
  perRun: OptimizerRunResult[]
  totals: {
    /** Sum of section counts across all runs. */
    totalSections: number
    /** Sum of section counts where 6' was selected. */
    sections6ft: number
    /** Sum of section counts where 8' was selected. */
    sections8ft: number
    /** Number of runs using 6'. */
    runs6ft: number
    /** Number of runs using 8'. */
    runs8ft: number
    /** Total material cost at the optimizer's recommendation. */
    materialCost: number
    /** Total material cost if everything used 6'. Used for "savings vs all-6'". */
    materialCostAll6ft: number
    /** Material cost difference vs all-6'. Positive = optimizer saved money. */
    materialSavings: number
    /** Sections saved vs all-6' (= productivity gain). Positive = fewer sections. */
    sectionsSavedVsAll6ft: number
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Per-run cost model
 * ────────────────────────────────────────────────────────────────────────── */

function panelMaterialCost(sectionCount: number, costs: PanelCosts): number {
  const pickets = sectionCount * costs.picketsPerSection * costs.picketCost
  const rails = sectionCount * costs.railsPerSection * costs.railCost
  const uTrim = sectionCount * costs.uTrimPerSection * costs.uTrimCost
  const stiffener = costs.hasStiffener ? sectionCount * costs.stiffenerCost : 0
  return pickets + rails + uTrim + stiffener
}

/** Material cost for a single run at one rail option. */
export function runMaterialCost(footage: number, costs: PanelCosts, panelLength: 6 | 8): number {
  const sections = sectionsForRun(footage, panelLength)
  return panelMaterialCost(sections, costs)
}

/* ──────────────────────────────────────────────────────────────────────────
 * Single-run decision
 * ────────────────────────────────────────────────────────────────────────── */

export interface OptimizeRunInput {
  footage: number
  costs6ft: PanelCosts
  costs8ft: PanelCosts
  settings: RailOptimizerSettings
  override?: RailType | 'auto'
}

export interface OptimizeRunOutput {
  railType: RailType
  sectionCount: number
  materialCost6ft: number
  materialCost8ft: number
  savings: number
  isShortRun: boolean
  isOverridden: boolean
  isDisabled: boolean
  reason: string
}

export function optimizeRun(input: OptimizeRunInput): OptimizeRunOutput {
  const ft = input.footage
  const cost6 = runMaterialCost(ft, input.costs6ft, 6)
  const cost8 = runMaterialCost(ft, input.costs8ft, 8)
  const sec6 = sectionsForRun(ft, 6)
  const sec8 = sectionsForRun(ft, 8)
  const fmtSav = Math.abs(cost6 - cost8)

  // Override is the highest-priority decision.
  if (input.override === '6ft' || input.override === '8ft') {
    const railType: RailType = input.override
    return {
      railType,
      sectionCount: railType === '6ft' ? sec6 : sec8,
      materialCost6ft: cost6,
      materialCost8ft: cost8,
      savings: 0,
      isShortRun: false,
      isOverridden: true,
      isDisabled: false,
      reason: `Manual override: ${railType} rails`,
    }
  }

  // Optimizer disabled → all-6.
  if (!input.settings.enabled) {
    return {
      railType: '6ft',
      sectionCount: sec6,
      materialCost6ft: cost6,
      materialCost8ft: cost8,
      savings: 0,
      isShortRun: false,
      isOverridden: false,
      isDisabled: true,
      reason: 'Optimizer disabled — using 6ft rails',
    }
  }

  // Short-run cutoff: always 6ft.
  if (ft <= input.settings.shortRunCutoffFt) {
    return {
      railType: '6ft',
      sectionCount: sec6,
      materialCost6ft: cost6,
      materialCost8ft: cost8,
      savings: 0,
      isShortRun: true,
      isOverridden: false,
      isDisabled: false,
      reason: `Short run (≤ ${input.settings.shortRunCutoffFt}ft) — 6ft rails`,
    }
  }

  // Compare: lower cost wins, with a productivity-tilt threshold.
  // If 8ft is strictly cheaper → 8ft.
  // If 6ft is strictly cheaper but only by < threshold → 8ft (productivity gain).
  // Otherwise → 6ft.
  const pctDiff = cost6 > 0 ? (cost6 - cost8) / cost6 : 0 // positive means 8ft is cheaper

  if (cost8 < cost6) {
    return {
      railType: '8ft',
      sectionCount: sec8,
      materialCost6ft: cost6,
      materialCost8ft: cost8,
      savings: cost6 - cost8,
      isShortRun: false,
      isOverridden: false,
      isDisabled: false,
      reason: `Long run — 8ft rails (saves $${(cost6 - cost8).toFixed(2)} vs 6ft)`,
    }
  }

  // 6ft is cheaper or equal. If within threshold, prefer 8ft for productivity.
  if (-pctDiff <= input.settings.costPreferenceThreshold) {
    return {
      railType: '8ft',
      sectionCount: sec8,
      materialCost6ft: cost6,
      materialCost8ft: cost8,
      savings: 0,
      isShortRun: false,
      isOverridden: false,
      isDisabled: false,
      reason: 'Long run — 8ft rails (same cost, fewer sections)',
    }
  }

  return {
    railType: '6ft',
    sectionCount: sec6,
    materialCost6ft: cost6,
    materialCost8ft: cost8,
    savings: cost8 - cost6,
    isShortRun: false,
    isOverridden: false,
    isDisabled: false,
    reason: `6ft rails (saves $${(cost8 - cost6).toFixed(2)} vs 8ft)`,
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * Whole-job aggregation
 * ────────────────────────────────────────────────────────────────────────── */

export interface OptimizeJobInput {
  runs: OptimizerRunInput[]
  costs6ft: PanelCosts
  costs8ft: PanelCosts
  settings: RailOptimizerSettings
}

export function optimizeJob(input: OptimizeJobInput): OptimizerJobResult {
  const perRun: OptimizerRunResult[] = input.runs.map((r, i) => {
    const out = optimizeRun({
      footage: r.footage,
      costs6ft: input.costs6ft,
      costs8ft: input.costs8ft,
      settings: input.settings,
      override: r.override,
    })
    return { index: i, footage: r.footage, ...out }
  })

  let sections6ft = 0
  let sections8ft = 0
  let runs6ft = 0
  let runs8ft = 0
  let materialCost = 0
  let materialCostAll6ft = 0

  for (const r of perRun) {
    if (r.railType === '6ft') {
      sections6ft += r.sectionCount
      runs6ft += 1
      materialCost += r.materialCost6ft
    } else {
      sections8ft += r.sectionCount
      runs8ft += 1
      materialCost += r.materialCost8ft
    }
    materialCostAll6ft += r.materialCost6ft
  }

  const totalSections = sections6ft + sections8ft
  const sectionsAll6ft = perRun.reduce((s, r) => s + sectionsForRun(r.footage, 6), 0)
  const materialSavings = round2(materialCostAll6ft - materialCost)
  const sectionsSavedVsAll6ft = sectionsAll6ft - totalSections

  return {
    perRun,
    totals: {
      totalSections,
      sections6ft,
      sections8ft,
      runs6ft,
      runs8ft,
      materialCost: round2(materialCost),
      materialCostAll6ft: round2(materialCostAll6ft),
      materialSavings,
      sectionsSavedVsAll6ft,
    },
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
