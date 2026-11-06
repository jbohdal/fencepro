/**
 * The estimate the website quote widget and the chat / phone agent give: the
 * quote builder's own math (quoteCalc: material kits, Inventory costs, labor,
 * Target Margin, commission) on the saved Settings, Inventory and kits. Pure,
 * so the server runs exactly this code (bundled into its build) and a job
 * priced here matches the same job in the quote builder.
 */

import { mergeSavedConfig } from './configDefaults'
import { withTargetMargins, typedOverheadPct, MAX_TARGET_MARGIN_PCT } from './targetMargin'
import { calculateQuote, type QuoteCalc } from './quoteCalc'
import { subUnitRateMissing, type QuotePricingOverrides } from './pricingEngine'
import { setMaterialPriceSource, inventoryPriceSource, setQtyBreakSource, inventoryQtyBreakSource, type LineItem, type GateWidths } from './materialCalculator'
import { setSavedKitSets, type KitSet } from './materialKits'
import type { AppConfig, FenceStyle } from './configStore'
import { isQuotable, isOnHold, NOT_QUOTABLE_MESSAGE } from './styleAvailability'
import { isTallVinyl, styleChoicesOf, catalogOf, materialOf } from './fenceCatalog'
import { followedRates, type FollowedRates } from './fenceRates'
import { draftMarginNow, type DraftMargin, type QuoteForDraft } from './draftMargin'
import { priceQuoteJob, quoteView, savedWorkOf, type QuoteJob, type QuoteJobRequest } from './quoteJob'
import { widgetCatalog, widgetOptions, widgetStyles, priceForStyle, type WidgetCatalog, type WidgetPick, type WidgetPriced } from './widgetPricing'
import type { YardLayout } from './yardLayout'
import { deriveRunsFor } from './changeOrderYard'
import type { TierSet } from './tiers'
import { pickList, pickPrice, type PickInput, type PickList } from './changeOrderPicks'
import { workWidth } from './moveRepair'
import { marginCheck, fenceTargetMargin } from './quoteChecks'
import { packetRunsFor } from './packetRuns'
export { importedOldPrice, keepsCents } from './pricingEngine'

/**
 * A quote's pricing choices paid per a unit Settings has no rate for, with no
 * rate typed (pricingEngine.subUnitRateMissing): what to tell the person, or
 * null. The server refuses such a save (lib/quotePriceCheck.ts).
 */
export function subRateMissingFor(saved: Partial<AppConfig> | null, pricing: unknown, fenceStyle: string | null | undefined): string | null {
  const cfg = estimateConfig(saved)
  const o = (pricing && typeof pricing === 'object' ? pricing : {}) as QuotePricingOverrides
  return subUnitRateMissing(o, cfg.pricing, cfg.fenceStyles.find(s => s.name === fenceStyle))
}

export { NOT_QUOTABLE_MESSAGE }
// The server's wood seed (lib/woodSeed.ts) runs these through the bundle.
export { planWood, planWoodRealKits } from './wood'
// The server's chain link dig set seed (lib/chainDigSetSeed.ts).
export { planChainDigSet, planChainDigSetPipesAndTies, planChainGateKits } from './chainDigSet'
// The server's tan dig set auto mix seed (lib/tanAutoDsSeed.ts).
export { planTanAutoDs } from './tanAutoDs'
// The server's tan no dig auto mix seed (lib/tanAutoNdSeed.ts).
export { planTanAutoNd } from './tanAutoNd'
// The server's farm fence seed (lib/farmSeed.ts).
export { planFarm, planFarmGates } from './farm'
import { planTwoTone as planTwoToneRaw, twoToneOf, oneColorFence } from './twoTone'
/**
 * Two tone vinyl in step with a company's colors (twoTone.ts planTwoTone; the server's lib/twoToneSeed.ts): the
 * two tone material and a fence per pair, size and method, copying the frame fence's labor and the Target Profit it
 * follows now. Pure: returns the Settings changed.
 */
export function planTwoToneFor(saved: Partial<AppConfig>): { config: Partial<AppConfig>; added: string[]; catalog: boolean; cleaned: boolean } {
  const catalog = JSON.parse(JSON.stringify(catalogOf(saved as AppConfig)))
  const styles = (saved.fenceStyles ?? []) as FenceStyle[]
  const followed = followedRatesByStyle(saved)
  const plan = planTwoToneRaw({ fenceStyles: styles, fenceCatalog: catalog }, s => styleChoicesOf(s), s => {
    const f = followed[s.name]?.targetProfitPct?.value
    return typeof s.targetProfitPct === 'number' && (s as { ownProfit?: boolean }).ownProfit ? s.targetProfitPct : typeof f === 'number' ? f : s.targetProfitPct
  })
  return { config: { ...saved, fenceStyles: plan.state.fenceStyles, fenceCatalog: plan.state.fenceCatalog }, added: plan.added, catalog: plan.catalog, cleaned: plan.cleaned }
}
// 8 ft tall vinyl section parts as $0 catalog items (lib/tallVinylParts.ts).
export { planTallVinylParts } from './tallVinylParts'
// Tan 8 ft tall vinyl, the four styles (lib/tanTallSeed.ts).
export { planTanTall, planTanTallParts } from './tanTall'
// A green part priced from Black follows Black's price until a green price is entered (Oct 27 2026).
export { followBorrowedPrices, borrowedPrice } from './priceAge'
// Settings → Price List → Vinyl Colors (server lib/vinylColors.ts).
export { planVinylColor, planArchiveVinylColor, planUndoVinylColor, inputFromColor, kitLineCounts } from './vinylColorForm'
export { walkSheetSvg, walkToYard, yardToWalk } from './walkList'
export { sitePlanNeeded } from './yardLayout'
export { planStyleForm, planArchiveStyle, planStylePrices, stylePartRows, proposedParts, stylesOfMaterial, STYLE_DIM } from './styleForm'
export { isUnsentDraft } from './draftMargin'
export { catalogOf as fenceCatalogOf, DEFAULT_CATALOG as DEFAULT_FENCE_CATALOG } from './fenceCatalog'
// Settings → Fence styles → Add color / turn a choice off (scripts/stephens-quotes-2026-10-26b.ts: Green chain link).
export { planAddColor, planUpdateOption, resolveFenceStyles, swapColor, isColorPart } from './fenceCatalog'
export { kitSetFor } from './materialKits'
// The contract terms frozen on a proposal and the company's address (server routes/proposal.ts, lib/contractPdf.ts).
export { stampTerms, proposalTerms, frozenTerms, companyAddressOf, termsAsAsked } from './contractTerms'
// Which proposal options are shown and which starts selected (server routes/proposal.ts).
export { sameFenceAs, shownOptions, startingOption, ownTierFold, proposalFold, ownTierToStamp, proposalStamp, addsPastLimit } from './proposalOptions'
export { optionBlocks } from './proposal'
// A discount under the minimum job price: the server asks the quote builder's own question (portal lib/discountMinimum.ts).
export { jobMinimumCents, newlyUnderMinimum, underMinimumWarning, cutFloorCents, cutContractCents, cutUnderMinimum, cutUnderMinimumWarning } from './discountMinimum'
// What a save would change on a sent proposal's cards (server routes/saved-quotes.ts refuses it unless chosen).
export { proposalPriceChanges } from './sentReprice'
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
  /** The tier sets (Settings → Good Better Best): a swapped option's words come from its own category's set. */
  tierSets?: Array<Pick<TierSet, 'category' | 'tiers'>> | null
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
  setQtyBreakSource(data.inventory.length ? inventoryQtyBreakSource(data.inventory) : null)
  setSavedKitSets(() => data.kits)
}

/** Each style's plain name by its internal name (old code or generated), for what the server shows people. */
export function styleLabels(saved: Partial<AppConfig> | null, data?: Pick<EstimateData, 'inventory' | 'kits'>): Record<string, string> {
  useData(data)
  return Object.fromEntries(estimateConfig(saved).fenceStyles.map(s => [s.name, s.label || s.name]))
}

/**
 * Why a style is held back from quoting now because something it is priced
 * from is missing (8 ft tall piece costs, a color not fully priced, parts
 * waiting for prices: fenceCatalog.ts resolveFenceStyles `held`), or null.
 * Switched off by hand (quotable false) is not "held": it still prices.
 * Server: lib/heldStylePrice.ts refuses a save that changes such a price.
 */
export function heldStyleReason(data: EstimateData, name: string): string | null {
  useData(data)
  const s = estimateConfig(data.config).fenceStyles.find(x => x.name === name)
  return s?.held ? s.held : null
}

/**
 * The sub rates and Target Profit % each fence follows from its material and
 * choices (fenceRates.ts), by internal name: for the server's job costing,
 * which reads the saved fence styles as they are. A fence that follows none is left out.
 */
export function followedRatesByStyle(saved: Partial<AppConfig> | null): Record<string, FollowedRates> {
  const catalog = catalogOf(saved as AppConfig)
  const out: Record<string, FollowedRates> = {}
  for (const s of (saved?.fenceStyles ?? []) as FenceStyle[]) {
    const sc = styleChoicesOf(s)
    const f = sc ? followedRates(materialOf(catalog, sc.material), sc.choices, false) : {}
    if (Object.keys(f).length) out[s.name] = f
  }
  // Two tone: the frame color's fence's numbers (its own, else what it follows), unless set on the two tone fence.
  const styles = (saved?.fenceStyles ?? []) as FenceStyle[]
  for (const s of styles) {
    const t = s.material === 'twotone' ? twoToneOf(s.name) : null
    const frame = t ? oneColorFence(styles, t.frame, t.install, t.width, x => styleChoicesOf(x)) : undefined
    if (!frame) continue
    const ff = out[frame.name] ?? {}
    const mine: FollowedRates = {}
    for (const k of ['subRate', 'subWalkGate', 'subDblGate'] as const) {
      if (typeof s[k] === 'number') continue
      const v = typeof frame[k] === 'number' && (frame[k] as number) > 0 ? { value: frame[k] as number, from: frame.name } : ff[k]
      if (v) mine[k] = v
    }
    const p = typeof frame.ownProfitPct === 'number' ? { value: frame.ownProfitPct, from: frame.name } : ff.targetProfitPct
    if (p && typeof s.ownProfitPct !== 'number') mine.targetProfitPct = p
    if (Object.keys(mine).length) out[s.name] = mine; else delete out[s.name]
  }
  return out
}

/**
 * The fences whose Target Margin (Overhead % + Target Profit %) is over the
 * most allowed (MAX_TARGET_MARGIN_PCT), by plain name. The server refuses a
 * Settings save that adds one (routes/business-state.ts).
 */
export function overMaxTargetMargin(saved: Partial<AppConfig> | null): string[] {
  return estimateConfig(saved).fenceStyles.filter(s => (1 - s.margin) * 100 > MAX_TARGET_MARGIN_PCT + 1e-9).map(s => s.label || s.name)
}

/**
 * An unsent draft whose Target Margin came from Settings, opened again: the
 * cost factor at its fence's Target Profit and the Overhead % today (draftMargin.ts), or null.
 * The server prices a Salesman's draft with it (lib/quotePricing.ts).
 */
export function draftMarginFor(saved: Partial<AppConfig> | null, quote: QuoteForDraft & { fenceStyle?: string | null }): DraftMargin | null {
  if (!quote?.fenceStyle) return null
  const cfg = estimateConfig(saved)
  return draftMarginNow(quote, cfg.fenceStyles.find(s => s.name === quote.fenceStyle), estimateOverheadPct(cfg))
}

/** Settings filled in the way the app fills them in, with each style's Target Margin. */
export function estimateConfig(saved: Partial<AppConfig> | null): AppConfig {
  const merged = mergeSavedConfig(saved)
  return withTargetMargins(merged, estimateOverheadPct(merged))
}

/**
 * The Overhead % in use. Live overhead is worked out on the server from the
 * budget and every job (portal lib/liveOverhead.ts) and put on the Settings it
 * prices with as pricing.liveOverheadPct (never saved): the same figure every
 * phone gets with Settings (liveOverhead.ts), so a Salesman, the owner and the
 * website price alike. Null there: not available, the typed Overhead %. Only
 * Settings read without it fall back to the month's figure recorded in
 * Settings.
 */
export function estimateOverheadPct(merged: AppConfig): number {
  if (!merged.pricing.liveOverhead?.on) return typedOverheadPct(merged)
  const now = (merged.pricing as { liveOverheadPct?: number | null }).liveOverheadPct
  if (now !== undefined) return typeof now === 'number' && Number.isFinite(now) ? now : typedOverheadPct(merged)
  const live = [...(merged.pricing.overheadHistory ?? [])].sort((a, b) => b.month.localeCompare(a.month))[0]?.pct
  return typeof live === 'number' ? live : typedOverheadPct(merged)
}

export { overheadNowOf, liveOverheadPctIn } from './liveOverheadMath'

/**
 * A quote priced on the server exactly as the quote builder prices it
 * (quoteJob.ts): for a Salesman's or Installer's phone (prices only, quoteView)
 * and to fill in the costs of a quote they save. A saved quote keeps the
 * Overhead % it was priced at (overheadPct); a new one uses today's.
 */
export function quoteJobFor(data: EstimateData, req: QuoteJobRequest, overheadPct?: number | null): QuoteJob {
  useData(data)
  const cfg = estimateConfig(data.config)
  return priceQuoteJob(cfg, req, typeof overheadPct === 'number' && Number.isFinite(overheadPct) ? overheadPct : estimateOverheadPct(cfg), data.tierSets)
}
export { quoteView, savedWorkOf }

/** The change order pick list for a job's style (changeOrderPicks.ts), at Settings today: prices only. */
export function changeOrderPicksFor(data: EstimateData, input: PickInput): PickList {
  useData(data)
  const cfg = estimateConfig(data.config)
  return pickList(cfg, data.inventory as never, input, estimateOverheadPct(cfg))
}

/** The section width a change order's picked sections are added at, for a style (moveRepair.ts workWidth); 0 for an unknown style. */
/** The crew's run table and gate lines for a job's work as it is now (packetRuns.ts), with the style from Settings (server routes/installPacket.ts). */
export function packetRunsForWork(data: EstimateData, yard: YardLayout | null, runs: number[], sections: number[], fenceStyle: string) {
  useData(data)
  const style = estimateConfig(data.config).fenceStyles.find(s => s.name === fenceStyle) ?? (fenceStyle ? { name: fenceStyle } : null)
  return packetRunsFor(yard, runs, sections, style)
}

export function changeOrderSectionWidthFor(data: EstimateData, fenceStyle: string): number {
  useData(data)
  const style = estimateConfig(data.config).fenceStyles.find(s => s.name === fenceStyle)
  return style ? workWidth(style) : 0
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
    if (named && !isQuotable(named)) throw new NotQuotableError(named)
    throw new Error(`Unknown fence style: ${fenceStyle}`)
  }
  return priceForStyle(cfg, estimateOverheadPct(cfg), yard, style, priceAdjust)
}

/** Styles a customer can ask about: turned on and available for quoting. */
export function estimateStyles(saved: Partial<AppConfig> | null, data?: Pick<EstimateData, 'inventory' | 'kits'>): FenceStyle[] {
  useData(data)
  return estimateConfig(saved).fenceStyles.filter(isQuotable)
}

/**
 * The styles the website offers (instant quote, its chat): available for
 * quoting, of a material not kept off the website (MaterialDef.website false:
 * farm fence until Jonathan switches it on, Nov 5 2026).
 */
export function websiteStyles(saved: Partial<AppConfig> | null, data?: Pick<EstimateData, 'inventory' | 'kits'>): FenceStyle[] {
  useData(data)
  const cfg = estimateConfig(saved)
  const off = new Set(catalogOf(cfg).materials.filter(m => m.website === false).map(m => m.key))
  return cfg.fenceStyles.filter(s => isQuotable(s) && !off.has(styleChoicesOf(s)?.material ?? ''))
}

/** Styles turned on but not available for quoting (commercial and industrial, on hold), and the phone to call instead. */
export function onHoldStyles(saved: Partial<AppConfig> | null): { styles: Array<{ name: string; category: string }>; phone: string } {
  const cfg = estimateConfig(saved)
  return { styles: cfg.fenceStyles.filter(isOnHold).map(s => ({ name: s.name, category: s.category })), phone: cfg.company?.phone || '' }
}

/**
 * What a customer is told for a style that cannot be quoted. Commercial and
 * industrial are on hold (switched off): "Call us for commercial and
 * industrial fencing". A fence held back only because its prices are not in
 * yet (8 ft tall vinyl waiting for its Settings prices, Oct 29, 2026) is not
 * commercial: "Call us for a price on 8 ft tall fence".
 */
export function notQuotableMessage(s: Pick<FenceStyle, 'quotable' | 'held' | 'name' | 'material' | 'choices'>): string {
  if (s.quotable === false) return NOT_QUOTABLE_MESSAGE
  return isTallVinyl(styleChoicesOf(s as FenceStyle)) ? 'Call us for a price on 8 ft tall fence' : 'Call us for a price on this fence'
}

/** Thrown for a style that is not available for quoting: the message is what the customer is told; `held` is why (for staff). */
export class NotQuotableError extends Error {
  readonly code = 'not_quotable'
  readonly fenceStyle: string
  readonly held: string
  constructor(style: FenceStyle) {
    super(notQuotableMessage(style))
    this.fenceStyle = style.name
    this.held = style.quotable === false ? 'switched off in Settings → Fence Styles' : (style.held ?? '')
  }
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
  if (named && !isQuotable(named) && !opts.preview) throw new NotQuotableError(named)
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
  // Good at or over the fence's own Target Margin (Jonathan, Nov 3 2026), as the quote builder's warning reads it.
  const warning = cfg.margins?.warning ?? 0.27
  const onPrice = p.price > 0 ? (p.price - p.totalCOGS) / p.price : 0
  const atTarget = !marginCheck(onPrice, fenceTargetMargin(style, estimateOverheadPct(cfg)), p.price)
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
    // Graded on price less cost (before commission), as the quote builder does.
    marginStatus: atTarget ? 'good' : onPrice >= warning ? 'warning' : 'danger',
    manHours: p.manHours,
    pullSheet: calc.materials.items,
    notes: [...held, ...calc.materials.warnings, ...p.notes],
  }
}
export { planFromYard, planFlags, openFlags, crewPosts, walkingOrder, applyChange, withPending, drawnFt, builtFt, feetBetween, toFeet, fromFeet, propertyLineWarnings, sectionsAt, quoteSectionsOf, DEFAULT_FLAG_SETTINGS, type SitePlanData, type PlanFlag, type CrewPost, type CrewSide, type PendingChange } from './sitePlanData'
// The site plan as a picture: the crew's sheet, the customer's portal, the permit sheet (server lib/sitePlans.ts).
export { sitePlanSvg, crewSheetSize, planFrame, planExtent, gateLeaves, insideOf, feetLabel } from './sitePlanSvg'
