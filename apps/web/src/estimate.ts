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
import { setMaterialPriceSource, inventoryPriceSource, type LineItem, type GateWidths } from './materialCalculator'
import { setSavedKitSets, type KitSet } from './materialKits'
import type { AppConfig, FenceStyle } from './configStore'
import { isQuotable, isOnHold, NOT_QUOTABLE_MESSAGE } from './styleAvailability'
import { priceQuoteJob, quoteView, savedWorkOf, type QuoteJob, type QuoteJobRequest } from './quoteJob'
import { widgetCatalog, widgetOptions, widgetStyles, priceForStyle, type WidgetCatalog, type WidgetPick, type WidgetPriced } from './widgetPricing'
import type { YardLayout } from './yardLayout'
import { deriveRunsFor } from './changeOrderYard'
import type { TierSet } from './tiers'
import { pickList, pickPrice, type PickInput, type PickList } from './changeOrderPicks'
export { importedOldPrice, keepsCents } from './pricingEngine'

export { NOT_QUOTABLE_MESSAGE }
// The server's wood seed (lib/woodSeed.ts) runs this through the bundle.
export { planWood } from './wood'
// The server's chain link dig set seed (lib/chainDigSetSeed.ts).
export { planChainDigSet, planChainDigSetPipesAndTies, planChainGateKits } from './chainDigSet'
// The server's tan dig set auto mix seed (lib/tanAutoDsSeed.ts).
export { planTanAutoDs } from './tanAutoDs'
// 8 ft tall vinyl section parts as $0 catalog items (lib/tallVinylParts.ts).
export { planTallVinylParts } from './tallVinylParts'
// Settings → Price List → Vinyl Colors (server lib/vinylColors.ts).
export { planVinylColor, planArchiveVinylColor, planUndoVinylColor, inputFromColor, kitLineCounts } from './vinylColorForm'
export { catalogOf as fenceCatalogOf, DEFAULT_CATALOG as DEFAULT_FENCE_CATALOG } from './fenceCatalog'
// Settings → Fence styles → Add color / turn a choice off (scripts/stephens-quotes-2026-10-26b.ts: Green chain link).
export { planAddColor, planUpdateOption, resolveFenceStyles, swapColor, isColorPart } from './fenceCatalog'
export { kitSetFor } from './materialKits'
// The contract terms frozen on a proposal and the company's address (server routes/proposal.ts, lib/contractPdf.ts).
export { stampTerms, proposalTerms, frozenTerms, companyAddressOf } from './contractTerms'
// Which proposal options are shown and which starts selected (server routes/proposal.ts).
export { sameFenceAs, shownOptions, startingOption, ownTierFold } from './proposalOptions'
// Warranties per option (server lib/warranties.ts).
export {
  defaultWarrantySettings, warrantySettingsOf, warrantyForStyle, installKeyOf, signedOptionWarranty, warrantyFromText,
  warrantyPeriod, serviceCoverage, isOneYearText, isNoDigStyle, dayText,
} from './warranties'
import { stampWarranties as stampOptionWarranties, warrantySettingsOf as warrantySettingsFrom, warrantyForStyle as warrantyForStyleOf } from './warranties'

/** Each proposal option's warranty, from the saved Settings (warranties.ts stampWarranties). */
export function stampWarranties(saved: Partial<AppConfig> | null, proposal: unknown, savedProposal: unknown, frozen: boolean): unknown {
  const styles = estimateConfig(saved).fenceStyles
  return stampOptionWarranties(proposal, warrantySettingsFrom(saved), name => styles.find(s => s.name === name), savedProposal, frozen)
}

/** A style's warranty from the saved Settings (by name; an old code is read from its name). */
export function styleWarranty(saved: Partial<AppConfig> | null, styleName: string, kind?: 'move' | 'repair' | null) {
  const style = estimateConfig(saved).fenceStyles.find(s => s.name === styleName) ?? { name: styleName }
  return warrantyForStyleOf(warrantySettingsFrom(saved), style, kind)
}

/** A yard's runs and posts for a style, as the quote builder counts them (change orders rebuild a job's drawing with it). */
export function deriveYardRuns(saved: Partial<AppConfig> | null, yard: YardLayout, fenceStyle: string) {
  return deriveRunsFor(estimateConfig(saved).fenceStyles, yard, fenceStyle)
}

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
  /** Each gate's width in feet (a drawing's, deriveYardRuns gateWidths): chain link gate leaves go by width. */
  gateWidths?: GateWidths | null
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

/** The change order pick list for a job's style (changeOrderPicks.ts), at Settings today: prices only. */
export function changeOrderPicksFor(data: EstimateData, input: PickInput): PickList {
  useData(data)
  const cfg = estimateConfig(data.config)
  return pickList(cfg, data.inventory as never, input, estimateOverheadPct(cfg))
}

/** One change order pick at a quantity (changeOrderPicks.ts). */
export function changeOrderPickPriceFor(data: EstimateData, input: PickInput, source: string, qty: number) {
  useData(data)
  const cfg = estimateConfig(data.config)
  return pickPrice(cfg, data.inventory as never, input, estimateOverheadPct(cfg), source, qty)
}

// ── The website quote (EZ Budget, /p/quote): drawn on the photo ──────────────
export { toYardLayout, drawingProblem, totalFt as drawingTotalFt, runSides as drawingRunSides, joinRuns as drawingJoinRuns } from './widgetDraw'

/** What the website quote offers: materials, colors and heights available for quoting. */
export function widgetCatalogFor(data: EstimateData): WidgetCatalog {
  useData(data)
  return widgetCatalog(estimateConfig(data.config))
}

/** The options for a pick, each priced for the drawn yard exactly as the quote builder prices it (prices only). */
export function widgetPricesFor(data: EstimateData, yard: YardLayout, pick: WidgetPick, tierSets: Array<Pick<TierSet, 'category' | 'tiers' | 'popular'>>): WidgetPriced {
  useData(data)
  const cfg = estimateConfig(data.config)
  return widgetOptions(cfg, estimateOverheadPct(cfg), yard, pick, tierSets)
}

/** One style for the drawn yard, priced as the quote builder prices a new quote: what the saved quote keeps. */
export function widgetQuoteFor(data: EstimateData, yard: YardLayout, fenceStyle: string, priceAdjust = 0): { job: QuoteJob; req: QuoteJobRequest; price: number; perFoot: number; footageFt: number } {
  useData(data)
  const cfg = estimateConfig(data.config)
  const style = widgetStyles(cfg).find(s => s.name === fenceStyle)
  if (!style) {
    const named = cfg.fenceStyles.find(s => s.name === fenceStyle && s.isActive !== false)
    if (named && !isQuotable(named)) throw new NotQuotableError(named.name)
    throw new Error(`Unknown fence style: ${fenceStyle}`)
  }
  return priceForStyle(cfg, estimateOverheadPct(cfg), yard, style, priceAdjust)
}

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

/**
 * `preview`: price a style that is not available for quoting yet (a color
 * made in Settings and still switched off), to look at it before switching it
 * on; its notes say why it is held. Never used for anything a customer sees.
 */
export function estimate(data: EstimateData, job: EstimateJob, opts: { preview?: boolean } = {}): Estimate {
  useData(data)
  const cfg = estimateConfig(data.config)
  const named = cfg.fenceStyles.find(s => s.name === job.fenceStyle && s.isActive !== false)
  if (named && !isQuotable(named) && !opts.preview) throw new NotQuotableError(named.name)
  const held = named && !isQuotable(named) ? [`Preview only, not available for quoting: ${named.held || (named.quotable === false ? 'turned off' : 'held')}.`] : []
  const style = named
  if (!style) throw new Error(`Unknown fence style: ${job.fenceStyle}`)
  const calc: QuoteCalc = calculateQuote({
    style,
    runs: job.runs.map(ft => ({ ft, rail: 'auto' as const })),
    corners: job.corners, ends: job.ends, walkGates: job.walkGates, dblGates: job.dblGates,
    ...(job.gateWidths ? { gateWidths: job.gateWidths } : {}),
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
    notes: [...held, ...calc.materials.warnings, ...p.notes],
  }
}
