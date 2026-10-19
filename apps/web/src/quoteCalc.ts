/**
 * The quote builder's math in one pure function: sections, the 6 ft / 8 ft
 * choice per run, the pull sheet, and labor, cost and price. QuoteBuilder
 * renders what this returns; tests call it directly, so what is tested is
 * what is quoted.
 *
 * Section width always comes from sectionWidthForStyle, the same function the
 * pull sheet uses, so the section count and the parts can never disagree.
 */

import {
  calculateMaterialsDetailed,
  calculateMixedMaterialsDetailed,
  totalMaterialCost,
  sectionWidthForStyle,
  materialUnitCost,
  withPriceSource,
  type LineItem,
  type MaterialResult,
  type RailWidth,
  type StyleJobLot,
} from './materialCalculator'
import {
  calculatePrice,
  type PricingSettings,
  type PriceResult,
  type QuotePricingOverrides,
  type StylePricing,
} from './pricingEngine'
import { sectionsForRun } from './sectionCount'
import { styleChoicesOf } from './legacyStyles'
import { optimizeJob, type OptimizerJobResult, type RailOptimizerSettings, type RunCostFn } from './railOptimizer'

export interface QuoteStyle extends StylePricing {
  name: string
  /** The plain name, as read from Settings. */
  label?: string
  panelWidth?: number
  autoRailMix?: boolean
  installMethod?: 'no-dig' | 'dig-set'
  colorFamily?: 'white' | 'tan'
  /** Styles made from Settings: the kit set an auto mix style reads (its own name). */
  kitKey?: string
  /** A color priced by the piece (job lot), filled in from Settings when the config is read. */
  jobLot?: StyleJobLot
  /** Made in Settings (a color or choice added later), copying this style. */
  madeFrom?: string
  /** Wood (wood.ts): the white vinyl style it is priced from, and the Wood factor (1.15). */
  woodOf?: string
  woodBase?: QuoteStyle
  woodFactor?: number
}

export interface QuoteRun {
  ft: number
  /** Auto mix only: the width chosen by hand, or 'auto'. */
  rail?: 'auto' | RailWidth
}

export interface QuoteCalcInput {
  style: QuoteStyle | undefined
  /** In screen order; empty runs (0 ft) are allowed and count 0 sections. */
  runs: QuoteRun[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
  extraLaborHrs: number
  hasSalesman: boolean
  priceAdjust: number
  pricing: PricingSettings
  overrides?: QuotePricingOverrides
  optimizer: RailOptimizerSettings
}

export interface QuoteCalc {
  /** Sections for each input run, same order. */
  perRunSections: number[]
  /** Auto mix only: the width used for each input run (null for an empty run). */
  perRunRail: Array<RailWidth | null>
  sections: number
  materials: MaterialResult
  materialCost: number
  priced: PriceResult
  /** Auto mix: the decision behind the pull sheet. Locked 6 ft tall vinyl:
   *  what the picker would choose, for information. Otherwise null. */
  optimizer: OptimizerJobResult | null
}

export interface VinylKind {
  installMethod: 'no-dig' | 'dig-set'
  colorFamily: 'white' | 'tan'
  /** A style made from Settings: its own kit set. */
  kitKey?: string
  /** A color priced by the piece. */
  jobLot?: StyleJobLot
}

/** Color and install method of a 6 ft tall vinyl privacy style the 6/8 picker
 *  can price, or null. Tan dig set has no mixed width parts list. */
export function vinylKind(style: QuoteStyle): VinylKind | null {
  if (style.autoRailMix) {
    if (!style.installMethod || !style.colorFamily) return null
    const kind: VinylKind = { installMethod: style.installMethod, colorFamily: style.colorFamily }
    if (style.kitKey) kind.kitKey = style.kitKey
    if (style.jobLot) kind.jobLot = style.jobLot
    return kind
  }
  const m = style.name.match(/^(WV|TV)-(ND|DS) 6'x[68]'/)
  if (!m || (m[1] === 'TV' && m[2] === 'DS')) return null
  return { installMethod: m[2] === 'ND' ? 'no-dig' : 'dig-set', colorFamily: m[1] === 'WV' ? 'white' : 'tan' }
}

/**
 * Full cost of building one run at one width: the material calculator's own
 * pull sheet for that run (panel goods, line posts, pipe, donuts or concrete,
 * caps, hardware) plus labor from the pricing engine with the style's
 * sections per man hour. An 8 ft section takes the same labor as a 6 ft one.
 * Corner and end posts and gates are the same at either width, so they are
 * left out of the comparison.
 */
export function makeRunCost(
  kind: VinylKind,
  style: QuoteStyle,
  pricing: PricingSettings,
  overrides?: QuotePricingOverrides,
): RunCostFn {
  const laborChoice: QuotePricingOverrides = { laborMode: overrides?.laborMode, subUnit: overrides?.subUnit, subRate: overrides?.subRate }
  return (ft, rail) => {
    const items = calculateMixedMaterialsDetailed({
      ...kind,
      runs: [{ ft, rail }],
      corners: 0, ends: 0, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
    }).items
    const labor = calculatePrice({
      sections: sectionsForRun(ft, rail === '8ft' ? 8 : 6),
      footage: ft,
      walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
      materialCost: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
      style, pricing, overrides: laborChoice,
    }).laborCost
    return totalMaterialCost(items) + labor
  }
}

export function calculateQuote(input: QuoteCalcInput): QuoteCalc {
  const { style } = input
  if (style?.woodBase) return woodQuote(input, style, style.woodBase)
  const runs = input.runs.map(r => ({ ft: Number.isFinite(r.ft) && r.ft > 0 ? r.ft : 0, rail: r.rail }))
  const kind = style ? vinylKind(style) : null
  const isAuto = !!style?.autoRailMix && !!kind

  let optimizer: OptimizerJobResult | null = null
  const filled = runs.filter(r => r.ft > 0)
  if (style && kind && filled.length > 0) {
    optimizer = optimizeJob({
      runs: filled.map(r => ({ footage: r.ft, override: isAuto ? r.rail : undefined })),
      runCost: makeRunCost(kind, style, input.pricing, input.overrides),
      settings: input.optimizer,
    })
  }

  let k = 0
  const perRunRail: Array<RailWidth | null> = runs.map(r => (isAuto && r.ft > 0 ? optimizer!.perRun[k++].railType : null))
  const width = style ? sectionWidthForStyle(style.name, style.panelWidth) : 0
  const perRunSections = runs.map((r, i) =>
    !style ? 0 : isAuto ? sectionsForRun(r.ft, perRunRail[i] === '8ft' ? 8 : 6) : sectionsForRun(r.ft, width))
  const sections = perRunSections.reduce((s, n) => s + n, 0)

  let materials: MaterialResult = { items: [], warnings: [] }
  if (style && sections > 0) {
    const jobParts = {
      corners: input.corners, ends: input.ends, walkGates: input.walkGates, dblGates: input.dblGates,
      tearOutSections: input.tearOutSections, tearOutGates: input.tearOutGates,
    }
    materials = isAuto
      ? calculateMixedMaterialsDetailed({
          ...kind!,
          runs: runs.map((r, i) => ({ ft: r.ft, rail: perRunRail[i] ?? '6ft' })).filter(r => r.ft > 0),
          ...jobParts,
        })
      : calculateMaterialsDetailed({
          fenceStyle: style.name, runs: filled.map(r => r.ft), ...jobParts,
          ...(style.jobLot ? { jobLot: style.jobLot } : {}),
          // A style made in Settings: its kits are counted at its own section width (old styles: by their code, as always).
          ...(style.madeFrom ? { sectionWidth: width } : {}),
        })
  }
  const materialCost = totalMaterialCost(materials.items)

  const priced = calculatePrice({
    sections,
    footage: runs.reduce((s, r) => s + r.ft, 0),
    walkGates: input.walkGates,
    dblGates: input.dblGates,
    tearOutSections: input.tearOutSections,
    tearOutGates: input.tearOutGates,
    materialCost,
    extraLaborHrs: input.extraLaborHrs,
    hasSalesman: input.hasSalesman,
    priceAdjust: input.priceAdjust,
    style,
    pricing: input.pricing,
    overrides: input.overrides,
  })

  return { perRunSections, perRunRail, sections, materials, materialCost, priced, optimizer }
}

/**
 * The same job priced at 6 ft and at 8 ft wide, for the line under a vinyl
 * quote's total. Auto mix styles force every run to one width; a locked style
 * is priced as its 6 ft and 8 ft wide twins from Settings (WV-ND 6'x6' and
 * WV-ND 6'x8', WV-DS 8'x6' and WV-DS 8'x8', ...), each with its own Settings.
 * A price typed by hand is left out so the two can be compared.
 */
export function widthComparison(input: QuoteCalcInput, styles: QuoteStyle[]): { at6: number; at8: number } | null {
  const { style } = input
  if (!style || !input.runs.some(r => r.ft > 0)) return null
  const overrides = { ...(input.overrides ?? {}), finalPrice: undefined }
  const priceWith = (s: QuoteStyle, rail?: RailWidth) =>
    calculateQuote({ ...input, style: s, overrides, runs: input.runs.map(r => ({ ft: r.ft, rail: rail ?? r.rail })) }).priced.price

  if (style.autoRailMix) {
    if (!vinylKind(style)) return null
    return { at6: priceWith(style, '6ft'), at8: priceWith(style, '8ft') }
  }
  // The same vinyl privacy fence (same height, color and install, a color
  // added in Settings included) in 6 ft and 8 ft panels, read from the choices.
  const sc = styleChoicesOf(style)
  if (!sc || sc.material !== 'vinyl' || sc.choices.style !== 'privacy' || (sc.choices.width !== '6' && sc.choices.width !== '8')) return null
  const twin = (w: '6' | '8') => styles.find(s => {
    const o = styleChoicesOf(s as QuoteStyle & { material?: string; choices?: Record<string, string> })
    return !!o && o.material === 'vinyl' && Object.keys(sc.choices).every(k => (k === 'width' ? o.choices.width === w : o.choices[k] === sc.choices[k]))
      && Object.keys(o.choices).length === Object.keys(sc.choices).length
  })
  const s6 = twin('6'), s8 = twin('8')
  if (!s6 || !s8) return null
  return { at6: priceWith(s6), at8: priceWith(s8) }
}

/**
 * Sections in each run of a saved quote, as it was priced. Quotes saved with
 * a layout record them; for older quotes the width is the one whose per run
 * total matches the sections the quote was priced with.
 */
export function savedRunSections(
  quote: { runs?: number[]; sections?: number; fenceStyle?: string; layout?: { runSections?: number[] } | null },
  savedWidth?: number,
): number[] {
  const runs = quote.runs ?? []
  const rec = quote.layout?.runSections
  if (Array.isArray(rec) && rec.length === runs.length) return rec
  const today = sectionWidthForStyle(quote.fenceStyle ?? '', savedWidth)
  const at = (w: number) => runs.map(ft => sectionsForRun(ft, w))
  const sum = (w: number) => at(w).reduce((s, n) => s + n, 0)
  const width = [today, 6, 8, 10, 4].find(w => sum(w) === quote.sections) ?? today
  return at(width)
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * A wood fence (wood.ts): the same job priced on its white vinyl style, then
 * that style's material and install labor each times the Wood factor, rounded
 * to the cent once on each total. Tear out and extra hours are not wood rates
 * and are added as they are. The pull sheet names the wood parts from the wood
 * style's own kit at $0 (for the crew) and carries the wood material as one
 * money only line.
 */
function woodQuote(input: QuoteCalcInput, style: QuoteStyle, base: QuoteStyle): QuoteCalc {
  const f = typeof style.woodFactor === 'number' && style.woodFactor > 0 ? style.woodFactor : 1.15
  const o = input.overrides ?? {}
  const laborChoice: QuotePricingOverrides = { laborMode: o.laborMode, subUnit: o.subUnit, subRate: o.subRate }
  const v = calculateQuote({
    ...input, style: base, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
    overrides: laborChoice,
  })
  const woodMaterial = round2(v.materialCost * f)
  const woodLabor = round2(v.priced.laborCost * f)
  // Tear out and extra hours at their own rates (not wood rates).
  const other = calculatePrice({
    sections: 0, footage: 0, walkGates: 0, dblGates: 0, tearOutSections: input.tearOutSections, tearOutGates: input.tearOutGates,
    materialCost: 0, extraLaborHrs: input.extraLaborHrs, hasSalesman: false, priceAdjust: 0, style: base, pricing: input.pricing, overrides: laborChoice,
  })
  const filled = input.runs.filter(r => r.ft > 0).map(r => r.ft)
  const width = sectionWidthForStyle(style.name, style.panelWidth)
  const items: LineItem[] = []
  const tear = (item: string, qty: number, fallback: number) => {
    if (!(qty > 0)) return
    const unit = materialUnitCost(item, fallback)
    items.push({ item, qty, unitCost: unit, total: round2(qty * unit), costSource: 'inventory' })
  }
  tear('Tear Out Haul-Away Fence', input.tearOutSections, 9.50)
  tear('Tear Out Haul-Away Gate', input.tearOutGates, 27.00)
  if (v.sections > 0) {
    // The wood parts by name, for the crew: never priced.
    const parts = withPriceSource(() => 0, () => calculateMaterialsDetailed({
      fenceStyle: style.name, runs: filled, corners: input.corners, ends: input.ends, walkGates: input.walkGates, dblGates: input.dblGates,
      tearOutSections: 0, tearOutGates: 0, sectionWidth: width,
    }))
    for (const i of parts.items) items.push({ item: i.item, qty: i.qty, unitCost: 0, total: 0, costSource: 'wood' })
    items.push({ item: `Wood material: ${baseLabel(base)} material × ${Math.round(f * 1000) / 10}%`, qty: 1, unitCost: woodMaterial, total: woodMaterial, costSource: 'wood', moneyOnly: true })
  }
  const materialCost = totalMaterialCost(items)
  const warnings = [...v.materials.warnings]
  if (v.sections > 0 && !items.some(i => i.costSource === 'wood' && !i.moneyOnly)) warnings.push(`"${style.label || style.name}" has no wood parts list (Inventory > Material Kits), so the pull sheet names no wood parts. The price is not affected.`)
  const flat = typeof o.laborCost === 'number' && Number.isFinite(o.laborCost) && o.laborCost >= 0
  const priced0 = calculatePrice({
    sections: v.sections, footage: filled.reduce((t, n) => t + n, 0), walkGates: input.walkGates, dblGates: input.dblGates,
    tearOutSections: input.tearOutSections, tearOutGates: input.tearOutGates, materialCost, extraLaborHrs: input.extraLaborHrs,
    hasSalesman: input.hasSalesman, priceAdjust: input.priceAdjust, style: { ...base, margin: style.margin, pricePerFoot: style.pricePerFoot },
    pricing: input.pricing, overrides: { ...o, laborCost: flat ? o.laborCost : round2(woodLabor + other.laborCost) },
  })
  const priced: PriceResult = flat ? priced0 : { ...priced0, laborMode: v.priced.laborMode, subRate: v.priced.subRate, notes: [...v.priced.notes, ...other.notes] }
  return { perRunSections: v.perRunSections, perRunRail: v.perRunRail, sections: v.sections, materials: { items, warnings }, materialCost, priced, optimizer: null }
}

function baseLabel(s: QuoteStyle & { label?: string }): string {
  return s.label || s.name
}
