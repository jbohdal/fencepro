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
  type AddedTo,
  type GateWidths,
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
  /** Wood (wood.ts): the white vinyl style its install labor comes from, and the Wood factor (1.15) on that labor. */
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
  /** Line posts beyond the runs' own: vinyl tees from the yard layout (deriveLayout `linePosts`). */
  extraLinePosts?: number
  walkGates: number
  dblGates: number
  /** Each gate's width in feet, from the drawing (yardLayout.ts gateWidthsOf): chain link gate leaves go by width. */
  gateWidths?: GateWidths | null
  tearOutSections: number
  tearOutGates: number
  extraLaborHrs: number
  hasSalesman: boolean
  priceAdjust: number
  pricing: PricingSettings
  overrides?: QuotePricingOverrides
  optimizer: RailOptimizerSettings
  /**
   * Pieces added to a sold job that has these gates (a change order line,
   * moveRepair.ts priceAddedPieces): no once per job parts, nothing rounded up
   * (materialCalculator.ts addedCounts), and the parts are counted even with
   * no section (a gate on its own).
   */
  addedTo?: AddedTo | null
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
 *  can price, or null. */
export function vinylKind(style: QuoteStyle): VinylKind | null {
  if (style.autoRailMix) {
    if (!style.installMethod || !style.colorFamily) return null
    const kind: VinylKind = { installMethod: style.installMethod, colorFamily: style.colorFamily }
    if (style.kitKey) kind.kitKey = style.kitKey
    if (style.jobLot) kind.jobLot = style.jobLot
    return kind
  }
  const m = style.name.match(/^(WV|TV)-(ND|DS) 6'x[68]'/)
  if (!m) return null
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
  if (style && (sections > 0 || input.addedTo)) {
    const jobParts = {
      corners: input.corners, ends: input.ends, walkGates: input.walkGates, dblGates: input.dblGates,
      tearOutSections: input.tearOutSections, tearOutGates: input.tearOutGates,
      ...(input.extraLinePosts ? { extraLinePosts: input.extraLinePosts } : {}),
      ...(input.addedTo ? { addedTo: input.addedTo } : {}),
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
          ...(input.gateWidths ? { gateWidths: input.gateWidths } : {}),
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

const dollars = (n: number) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

/**
 * The quote builder's labor line label. Wood (review Oct 30 2026: the line
 * read "Labor (sub, $5/ft)" while wood is figured at $5.75/ft): the wood sub
 * rate and where it comes from, "Labor (sub, $5.75/ft, vinyl $5 × 115%)".
 */
export function laborLabel(p: Pick<PriceResult, 'laborMode' | 'subRate' | 'subUnit'>, style?: Pick<QuoteStyle, 'woodBase' | 'woodFactor'> | null): string {
  if (p.laborMode === 'flat') return 'Labor (flat)'
  if (p.laborMode !== 'subcontractor') return 'Labor Cost'
  const unit = p.subUnit === 'section' ? 'sec' : 'ft'
  if (!style?.woodBase) return `Labor (sub, ${dollars(p.subRate)}/${unit})`
  const f = typeof style.woodFactor === 'number' && style.woodFactor > 0 ? style.woodFactor : 1.15
  return `Labor (sub, ${dollars(round2(p.subRate * f))}/${unit}, vinyl ${dollars(p.subRate)} × ${Math.round(f * 1000) / 10}%)`
}

/**
 * A wood fence (wood.ts, Oct 30 2026). Materials: the wood style's own
 * material kit priced from Inventory, the normal way (sections counted per
 * run at its own panel width; each wood part on the pull sheet at its
 * Inventory price). Labor: the same job's install labor on its White Vinyl
 * style (woodBase) times the Wood factor, rounded to the cent once. Tear out
 * and extra hours are not wood rates and are added as they are.
 */
function woodQuote(input: QuoteCalcInput, style: QuoteStyle, base: QuoteStyle): QuoteCalc {
  const f = typeof style.woodFactor === 'number' && style.woodFactor > 0 ? style.woodFactor : 1.15
  const o = input.overrides ?? {}
  const laborChoice: QuotePricingOverrides = { laborMode: o.laborMode, subUnit: o.subUnit, subRate: o.subRate }
  // The White Vinyl job, for its install labor only (its material is never used).
  const v = calculateQuote({
    ...input, style: base, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
    overrides: laborChoice,
  })
  const woodLabor = round2(v.priced.laborCost * f)
  // Tear out and extra hours at their own rates (not wood rates).
  const other = calculatePrice({
    sections: 0, footage: 0, walkGates: 0, dblGates: 0, tearOutSections: input.tearOutSections, tearOutGates: input.tearOutGates,
    materialCost: 0, extraLaborHrs: input.extraLaborHrs, hasSalesman: false, priceAdjust: 0, style: base, pricing: input.pricing, overrides: laborChoice,
  })
  const filled = input.runs.filter(r => r.ft > 0).map(r => r.ft)
  const width = sectionWidthForStyle(style.name, style.panelWidth)
  const perRunSections = input.runs.map(r => (Number.isFinite(r.ft) && r.ft > 0 ? sectionsForRun(r.ft, width) : 0))
  const sections = perRunSections.reduce((t, n) => t + n, 0)
  const materials: MaterialResult = sections > 0 || input.addedTo
    ? calculateMaterialsDetailed({
        fenceStyle: style.name, runs: filled, corners: input.corners, ends: input.ends, walkGates: input.walkGates, dblGates: input.dblGates,
        tearOutSections: input.tearOutSections, tearOutGates: input.tearOutGates, sectionWidth: width,
        ...(input.extraLinePosts ? { extraLinePosts: input.extraLinePosts } : {}),
        ...(input.gateWidths ? { gateWidths: input.gateWidths } : {}),
        ...(input.addedTo ? { addedTo: input.addedTo } : {}),
      })
    : { items: [], warnings: [] }
  const materialCost = totalMaterialCost(materials.items)
  const flat = typeof o.laborCost === 'number' && Number.isFinite(o.laborCost) && o.laborCost >= 0
  const priced0 = calculatePrice({
    sections, footage: filled.reduce((t, n) => t + n, 0), walkGates: input.walkGates, dblGates: input.dblGates,
    tearOutSections: input.tearOutSections, tearOutGates: input.tearOutGates, materialCost, extraLaborHrs: input.extraLaborHrs,
    hasSalesman: input.hasSalesman, priceAdjust: input.priceAdjust, style: { ...base, margin: style.margin, pricePerFoot: style.pricePerFoot },
    pricing: input.pricing, overrides: { ...o, laborCost: flat ? o.laborCost : round2(woodLabor + other.laborCost) },
  })
  const priced: PriceResult = flat ? priced0 : { ...priced0, laborMode: v.priced.laborMode, subRate: v.priced.subRate, notes: [...v.priced.notes, ...other.notes] }
  return { perRunSections, perRunRail: input.runs.map(() => null), sections, materials, materialCost, priced, optimizer: null }
}
