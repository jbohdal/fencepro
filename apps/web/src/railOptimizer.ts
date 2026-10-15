/**
 * Smart Rail Optimizer: picks 6 ft or 8 ft wide sections for each vinyl run.
 *
 * Each run is priced both ways with the full cost of building it (see
 * runCost.ts: the material calculator's own pull sheet for the run, line
 * posts, pipe, donuts or concrete, caps and hardware included, plus labor
 * from the pricing engine). The cheaper width wins, with a small tilt toward
 * 8 ft: when 8 ft costs no more than `costPreferenceThreshold` above 6 ft, 8 ft
 * is used for the fewer sections. Runs at or under the short run cutoff
 * always use 6 ft.
 *
 * Both the quote builder's pull sheet and its recommendation panel use this
 * module, so what is recommended is what is quoted.
 */

import { sectionsForRun } from './sectionCount'

export type RailType = '6ft' | '8ft'

export interface RailOptimizerSettings {
  /** Master switch. When false every run uses 6 ft. */
  enabled: boolean
  /** Runs at or below this footage are forced to 6ft sections. Default 6. */
  shortRunCutoffFt: number
  /** When 8ft costs no more than this fraction above 6ft, prefer 8ft for the
   *  fewer sections. Default 0.02 (2%). */
  costPreferenceThreshold: number
}

export const DEFAULT_RAIL_OPTIMIZER_SETTINGS: RailOptimizerSettings = {
  enabled: true,
  shortRunCutoffFt: 6,
  costPreferenceThreshold: 0.02,
}

/** Full cost in dollars of building one run of `footage` at one width. */
export type RunCostFn = (footage: number, rail: RailType) => number

export interface OptimizerRunInput {
  footage: number
  /** Optional manual choice; bypasses the cost compare and the cutoff. */
  override?: RailType | 'auto'
}

export interface OptimizeRunOutput {
  railType: RailType
  /** Sections at the selected width. */
  sectionCount: number
  /** Full cost of this run at 6 ft wide. */
  cost6ft: number
  /** Full cost of this run at 8 ft wide. */
  cost8ft: number
  /** How much the chosen width saves over the other (0 when forced). */
  savings: number
  isShortRun: boolean
  isOverridden: boolean
  isDisabled: boolean
  /** Plain English why, for the screen. */
  reason: string
}

export interface OptimizerRunResult extends OptimizeRunOutput {
  index: number
  footage: number
}

export interface OptimizerJobResult {
  perRun: OptimizerRunResult[]
  totals: {
    totalSections: number
    sections6ft: number
    sections8ft: number
    runs6ft: number
    runs8ft: number
    /** Full cost of the runs at the chosen widths. */
    cost: number
    /** Full cost of the runs if every run were 6 ft. */
    costAll6ft: number
    /** costAll6ft − cost. Positive = the mix saves money. */
    savingsVsAll6ft: number
    /** Sections saved against all 6 ft. */
    sectionsSavedVsAll6ft: number
  }
}

export interface OptimizeRunInput {
  footage: number
  runCost: RunCostFn
  settings: RailOptimizerSettings
  override?: RailType | 'auto'
}

const money = (n: number) => `$${n.toFixed(2)}`

export function optimizeRun(input: OptimizeRunInput): OptimizeRunOutput {
  const ft = input.footage
  const cost6 = input.runCost(ft, '6ft')
  const cost8 = input.runCost(ft, '8ft')
  const sec6 = sectionsForRun(ft, 6)
  const sec8 = sectionsForRun(ft, 8)
  const base = { cost6ft: cost6, cost8ft: cost8, isShortRun: false, isOverridden: false, isDisabled: false }

  if (input.override === '6ft' || input.override === '8ft') {
    const railType: RailType = input.override
    return { ...base, railType, sectionCount: railType === '6ft' ? sec6 : sec8, savings: 0, isOverridden: true, reason: `Set by hand: ${railType} wide` }
  }
  if (!input.settings.enabled) {
    return { ...base, railType: '6ft', sectionCount: sec6, savings: 0, isDisabled: true, reason: 'Optimizer is off, so 6 ft wide' }
  }
  if (ft <= input.settings.shortRunCutoffFt) {
    return { ...base, railType: '6ft', sectionCount: sec6, savings: 0, isShortRun: true, reason: `Short run (${input.settings.shortRunCutoffFt} ft or less), so 6 ft wide` }
  }
  if (cost8 < cost6) {
    return { ...base, railType: '8ft', sectionCount: sec8, savings: cost6 - cost8, reason: `8 ft wide saves ${money(cost6 - cost8)}` }
  }
  // 6 ft is cheaper or equal: still 8 ft when within the tilt, for fewer sections.
  const over = cost6 > 0 ? (cost8 - cost6) / cost6 : 0
  if (over <= input.settings.costPreferenceThreshold) {
    return { ...base, railType: '8ft', sectionCount: sec8, savings: 0, reason: `8 ft wide: within ${Math.round(input.settings.costPreferenceThreshold * 100)}% of 6 ft, fewer sections` }
  }
  return { ...base, railType: '6ft', sectionCount: sec6, savings: cost8 - cost6, reason: `6 ft wide saves ${money(cost8 - cost6)}` }
}

export interface OptimizeJobInput {
  runs: OptimizerRunInput[]
  runCost: RunCostFn
  settings: RailOptimizerSettings
}

export function optimizeJob(input: OptimizeJobInput): OptimizerJobResult {
  const perRun: OptimizerRunResult[] = input.runs.map((r, i) => ({
    index: i,
    footage: r.footage,
    ...optimizeRun({ footage: r.footage, runCost: input.runCost, settings: input.settings, override: r.override }),
  }))

  let sections6ft = 0, sections8ft = 0, runs6ft = 0, runs8ft = 0, cost = 0, costAll6ft = 0
  for (const r of perRun) {
    if (r.railType === '6ft') { sections6ft += r.sectionCount; runs6ft += 1; cost += r.cost6ft }
    else { sections8ft += r.sectionCount; runs8ft += 1; cost += r.cost8ft }
    costAll6ft += r.cost6ft
  }
  const totalSections = sections6ft + sections8ft
  const sectionsAll6ft = perRun.reduce((s, r) => s + sectionsForRun(r.footage, 6), 0)

  return {
    perRun,
    totals: {
      totalSections,
      sections6ft,
      sections8ft,
      runs6ft,
      runs8ft,
      cost: round2(cost),
      costAll6ft: round2(costAll6ft),
      savingsVsAll6ft: round2(costAll6ft - cost),
      sectionsSavedVsAll6ft: sectionsAll6ft - totalSections,
    },
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
