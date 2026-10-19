/**
 * The estimate the website quote widget and the chat / phone agent give: the
 * quote builder's own math (quoteCalc: material kits, Inventory costs, labor,
 * Target Margin, commission) on the saved Settings, Inventory and kits. Pure,
 * so the server runs exactly this code (bundled into its build) and a job
 * priced here matches the same job in the quote builder.
 */

import { mergeSavedConfig } from './configDefaults'
import { withTargetMargins, typedOverheadPct } from './targetMargin'
import { calculateQuote, type QuoteCalc } from './quoteCalc'
import { setMaterialPriceSource, inventoryPriceSource, type LineItem } from './materialCalculator'
import { setSavedKitSets, type KitSet } from './materialKits'
import type { AppConfig, FenceStyle } from './configStore'
import { isQuotable, isOnHold, NOT_QUOTABLE_MESSAGE } from './styleAvailability'

export { NOT_QUOTABLE_MESSAGE }

export interface EstimateData {
  /** The saved Settings (business state config), as stored. */
  config: Partial<AppConfig> | null
  inventory: Array<{ name: string; unitCost: unknown; status?: string }>
  kits: KitSet[]
}

export interface EstimateJob {
  fenceStyle: string
  runs: number[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections?: number
  tearOutGates?: number
  extraLaborHrs?: number
  priceAdjust?: number
  hasSalesman?: boolean
}

export interface Estimate {
  label: 'Estimate'
  style: FenceStyle
  totalFootage: number
  sections: number
  /** Sections in each run, same order as the runs (for the site plan). */
  perRunSections: number[]
  materialCost: number
  laborCost: number
  tearOutCost: number
  totalCOGS: number
  basePrice: number
  commissionAmount: number
  price: number
  pricePerFoot: number
  grossMargin: number
  gmPct: number
  marginStatus: 'good' | 'warning' | 'danger'
  manHours: number
  pullSheet: LineItem[]
  notes: string[]
}

/** Settings filled in the way the app fills them in, with each style's Target Margin. */
export function estimateConfig(saved: Partial<AppConfig> | null): AppConfig {
  const merged = mergeSavedConfig(saved)
  // Live overhead is worked out in the app from the budget and installed jobs;
  // here the month's figure it recorded is used, else the typed Overhead %.
  const live = merged.pricing.liveOverhead?.on ? [...(merged.pricing.overheadHistory ?? [])].sort((a, b) => b.month.localeCompare(a.month))[0]?.pct : undefined
  return withTargetMargins(merged, typeof live === 'number' ? live : typedOverheadPct(merged))
}

/** Styles a customer can ask about: turned on and available for quoting. */
export function estimateStyles(saved: Partial<AppConfig> | null): FenceStyle[] {
  return estimateConfig(saved).fenceStyles.filter(isQuotable)
}

/** Styles turned on but not available for quoting (commercial and industrial, on hold), and the phone to call instead. */
export function onHoldStyles(saved: Partial<AppConfig> | null): { styles: Array<{ name: string; category: string }>; phone: string } {
  const cfg = estimateConfig(saved)
  return { styles: cfg.fenceStyles.filter(isOnHold).map(s => ({ name: s.name, category: s.category })), phone: cfg.company?.phone || '' }
}

/** Thrown for a style that is not available for quoting: the message is what the customer is told. */
export class NotQuotableError extends Error {
  readonly code = 'not_quotable'
  readonly fenceStyle: string
  constructor(fenceStyle: string) { super(NOT_QUOTABLE_MESSAGE); this.fenceStyle = fenceStyle }
}

export function estimate(data: EstimateData, job: EstimateJob): Estimate {
  const cfg = estimateConfig(data.config)
  const named = cfg.fenceStyles.find(s => s.name === job.fenceStyle && s.isActive !== false)
  if (named && !isQuotable(named)) throw new NotQuotableError(named.name)
  const style = named
  if (!style) throw new Error(`Unknown fence style: ${job.fenceStyle}`)
  setMaterialPriceSource(data.inventory.length ? inventoryPriceSource(data.inventory) : null)
  setSavedKitSets(() => data.kits)
  const calc: QuoteCalc = calculateQuote({
    style,
    runs: job.runs.map(ft => ({ ft, rail: 'auto' as const })),
    corners: job.corners, ends: job.ends, walkGates: job.walkGates, dblGates: job.dblGates,
    tearOutSections: job.tearOutSections ?? 0, tearOutGates: job.tearOutGates ?? 0,
    extraLaborHrs: job.extraLaborHrs ?? 0, hasSalesman: !!job.hasSalesman, priceAdjust: job.priceAdjust ?? 0,
    pricing: cfg.pricing, overrides: undefined, optimizer: cfg.railOptimizer!,
  })
  const p = calc.priced
  const good = cfg.margins?.good ?? 0.34, warning = cfg.margins?.warning ?? 0.27
  return {
    label: 'Estimate',
    style,
    totalFootage: job.runs.reduce((t, n) => t + (n > 0 ? n : 0), 0),
    sections: calc.sections,
    perRunSections: calc.perRunSections,
    materialCost: calc.materialCost,
    laborCost: p.laborCost,
    tearOutCost: p.tearOutCost,
    totalCOGS: p.totalCOGS,
    basePrice: p.basePrice,
    commissionAmount: p.commissionAmt,
    price: p.price,
    pricePerFoot: p.pricePerFoot,
    grossMargin: p.grossMargin,
    gmPct: p.gmPct,
    marginStatus: p.gmPct >= good ? 'good' : p.gmPct >= warning ? 'warning' : 'danger',
    manHours: p.manHours,
    pullSheet: calc.materials.items,
    notes: [...calc.materials.warnings, ...p.notes],
  }
}
