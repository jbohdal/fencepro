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
import { priceQuoteJob, quoteView, savedWorkOf, type QuoteJob, type QuoteJobRequest } from './quoteJob'
export { importedOldPrice } from './pricingEngine'

export { NOT_QUOTABLE_MESSAGE }
// The server's wood seed (lib/woodSeed.ts) runs this through the bundle.
export { planWood } from './wood'
// The server's chain link dig set seed (lib/chainDigSetSeed.ts).
export { planChainDigSet, planChainDigSetPipesAndTies } from './chainDigSet'
// The server's tan dig set auto mix seed (lib/tanAutoDsSeed.ts).
export { planTanAutoDs } from './tanAutoDs'

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

/** Inventory and kits as the source of part costs and kits (also what decides whether a color added in Settings is fully priced). */
function useData(data: Pick<EstimateData, 'inventory' | 'kits'> | undefined) {
  if (!data) return
  setMaterialPriceSource(data.inventory.length ? inventoryPriceSource(data.inventory) : null)
  setSavedKitSets(() => data.kits)
}

/** Each style's plain name by its internal name (old code or generated), for what the server shows people. */
export function styleLabels(saved: Partial<AppConfig> | null, data?: Pick<EstimateData, 'inventory' | 'kits'>): Record<string, string> {
  useData(data)
  return Object.fromEntries(estimateConfig(saved).fenceStyles.map(s => [s.name, s.label || s.name]))
}

/** Settings filled in the way the app fills them in, with each style's Target Margin. */
export function estimateConfig(saved: Partial<AppConfig> | null): AppConfig {
  const merged = mergeSavedConfig(saved)
  return withTargetMargins(merged, estimateOverheadPct(merged))
}

/**
 * The Overhead % in use. Live overhead is worked out in the app from the
 * budget and installed jobs; here the month's figure it recorded is used,
 * else the typed Overhead %.
 */
export function estimateOverheadPct(merged: AppConfig): number {
  const live = merged.pricing.liveOverhead?.on ? [...(merged.pricing.overheadHistory ?? [])].sort((a, b) => b.month.localeCompare(a.month))[0]?.pct : undefined
  return typeof live === 'number' ? live : typedOverheadPct(merged)
}

/**
 * A quote priced on the server exactly as the quote builder prices it
 * (quoteJob.ts): for a Salesman's or Installer's phone (prices only, quoteView)
 * and to fill in the costs of a quote they save. A saved quote keeps the
 * Overhead % it was priced at (overheadPct); a new one uses today's.
 */
export function quoteJobFor(data: EstimateData, req: QuoteJobRequest, overheadPct?: number | null): QuoteJob {
  useData(data)
  const cfg = estimateConfig(data.config)
  return priceQuoteJob(cfg, req, typeof overheadPct === 'number' && Number.isFinite(overheadPct) ? overheadPct : estimateOverheadPct(cfg))
}
export { quoteView, savedWorkOf }

/** Styles a customer can ask about: turned on and available for quoting. */
export function estimateStyles(saved: Partial<AppConfig> | null, data?: Pick<EstimateData, 'inventory' | 'kits'>): FenceStyle[] {
  useData(data)
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
  useData(data)
  const cfg = estimateConfig(data.config)
  const named = cfg.fenceStyles.find(s => s.name === job.fenceStyle && s.isActive !== false)
  if (named && !isQuotable(named)) throw new NotQuotableError(named.name)
  const style = named
  if (!style) throw new Error(`Unknown fence style: ${job.fenceStyle}`)
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
