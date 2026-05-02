/**
 * Server-side mirror of apps/web/src/railOptimizer.ts.
 *
 * Same logic — kept here so the portal vitest suite can exercise it without
 * pulling in the web package. Pure math; no Prisma / no React.
 */

import { sectionsForRun } from './sectionCount.js'

export type RailType = '6ft' | '8ft'

export interface RailOptimizerSettings {
  enabled: boolean
  shortRunCutoffFt: number
  costPreferenceThreshold: number
}

export const DEFAULT_RAIL_OPTIMIZER_SETTINGS: RailOptimizerSettings = {
  enabled: true,
  shortRunCutoffFt: 6,
  costPreferenceThreshold: 0.02,
}

export interface PanelCosts {
  picketsPerSection: number
  picketCost: number
  railsPerSection: number
  railCost: number
  uTrimPerSection: number
  uTrimCost: number
  hasStiffener: boolean
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
  footage: number
  override?: RailType | 'auto'
}

export interface OptimizerRunResult {
  index: number
  footage: number
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

export interface OptimizerJobResult {
  perRun: OptimizerRunResult[]
  totals: {
    totalSections: number
    sections6ft: number
    sections8ft: number
    runs6ft: number
    runs8ft: number
    materialCost: number
    materialCostAll6ft: number
    materialSavings: number
    sectionsSavedVsAll6ft: number
  }
}

function panelMaterialCost(sectionCount: number, costs: PanelCosts): number {
  const pickets = sectionCount * costs.picketsPerSection * costs.picketCost
  const rails = sectionCount * costs.railsPerSection * costs.railCost
  const uTrim = sectionCount * costs.uTrimPerSection * costs.uTrimCost
  const stiffener = costs.hasStiffener ? sectionCount * costs.stiffenerCost : 0
  return pickets + rails + uTrim + stiffener
}

export function runMaterialCost(footage: number, costs: PanelCosts, panelLength: 6 | 8): number {
  const sections = sectionsForRun(footage, panelLength)
  return panelMaterialCost(sections, costs)
}

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

  const pctDiff = cost6 > 0 ? (cost6 - cost8) / cost6 : 0

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
