/**
 * Pricing engine — the one place a quote's labor, cost and price are computed.
 *
 * Pure: no React, no storage, no network. QuoteBuilder and quoteCalc
 * call it, so a change in Settings → Pricing shows up everywhere at once.
 *
 * Everything here is a setting or a per quote override, never a constant:
 *
 *   Labor      hourly        man hours × man hour rate
 *              subcontractor rate per foot or per section (per style, per
 *                            category, or one default) + per gate + tear out
 *              flat          a labor dollar amount typed on the quote
 *
 *   Price      cost_factor   priced from cost: cost ÷ (100% − Target Margin),
 *                            Target Margin = Overhead % + the style's Target Profit %
 *              per_foot      footage × the style's price per foot
 *              manual        a final price typed on the quote
 *
 *   Commission included      taken out of the price (margin drops)
 *              added         price is grossed up so the commission is on top
 *
 *   Rounding   whole dollar  the last step (Jonathan, Oct 21 2026): the price is
 *                            rounded DOWN to the whole dollar, after the slider,
 *                            a price typed by hand and the commission gross up
 *                            (and after a ± dollar adjustment on the quote, when
 *                            there is one). The cents come out of profit only:
 *                            commission and overhead stay on the price before
 *                            rounding, so the margin drops by exactly the cents.
 *                            A quote sent, sold or accepted before this keeps its
 *                            cents (wholeDollar: false on its pricing, keepsCents).
 *
 *   Adjustment ± dollars      (Jonathan, Oct 22 2026): a whole dollar amount typed
 *                            on the quote (priceAdjustmentCents, −3000 = $30 off),
 *                            applied after the slider and before the rounding, so
 *                            a typed final price comes out exact. Like the
 *                            rounding it comes out of profit only: commission and
 *                            overhead stay on the price before the adjustment
 *                            (the slider's price). It never takes the price
 *                            under cost (cost of goods + commission): such a
 *                            reduction is not applied and a note says so.
 */

export type LaborMode = 'hourly' | 'subcontractor'
export type SubUnit = 'foot' | 'section'
export type PriceMethod = 'cost_factor' | 'per_foot'
export type CommissionMode = 'included' | 'added'

/** The parts of Settings → Pricing the engine reads. */
export interface PricingSettings {
  manHourRate: number
  commissionSalesman: number
  commissionNonSalesman: number
  tearOutFence: number
  tearOutGate: number
  laborMode?: LaborMode
  subUnit?: SubUnit
  /** Subcontractor pay per unit when neither the style nor its category has one. */
  subRateDefault?: number
  /** Subcontractor pay per unit by style category ('Vinyl', 'Chainlink', ...). */
  subRateByCategory?: Record<string, number>
  subWalkGate?: number
  subDblGate?: number
  subTearOutSection?: number
  subTearOutGate?: number
  priceMethod?: PriceMethod
  commissionMode?: CommissionMode
  /** Men on a crew and hours in a crew day, for crew time on a quote. */
  crewSize?: number
  crewHoursPerDay?: number
}

/** The parts of a fence style the engine reads. */
export interface StylePricing {
  category?: string
  /** 1 − Target Margin (0.56 for 44%): cost ÷ this = price. */
  margin: number
  sectionsPerMH: number
  mhPerWalkGate?: number
  mhPerDblGate?: number
  /** Subcontractor pay per unit for this style (overrides category + default). */
  subRate?: number
  /** Customer price per foot for this style (used by the per_foot method). */
  pricePerFoot?: number
}

/** Per quote overrides. Anything left undefined falls back to style, then Settings. */
export interface QuotePricingOverrides {
  laborMode?: LaborMode
  /** The unit the sub is paid per. Read only with subUnitPicked or the quote's own subRate (subUnitOf). */
  subUnit?: SubUnit
  /** "Paid per" was picked by hand on this quote: it keeps its unit when Settings change (Oct 30 2026). */
  subUnitPicked?: boolean
  subRate?: number
  /** Flat labor dollars for this quote; replaces the calculated labor. */
  laborCost?: number
  priceMethod?: PriceMethod
  pricePerFoot?: number
  /** 1 − Target Margin for this quote (kept so the price never moves). */
  costFactor?: number
  commissionPct?: number
  commissionMode?: CommissionMode
  /** Final customer price typed by hand; replaces the calculated price. */
  finalPrice?: number
  /** Overhead % the quote was priced at (for "where every dollar goes"; the engine does not use it). */
  overheadPct?: number
  /**
   * false: priced to the cent, as every quote was before the whole dollar rule
   * (a quote sent, sold or accepted before Oct 21 2026 keeps it). Anything
   * else: the price is rounded down to the whole dollar.
   */
  wholeDollar?: boolean
  /** Saved with the quote: the cents the price was rounded down by (internal; the engine does not read it). */
  roundingCents?: number
  /**
   * A whole dollar ± adjustment on the price, in cents (−3000 = $30 off; an
   * increase is positive). After the slider, before the rounding, out of profit.
   */
  priceAdjustmentCents?: number
  /** The proposal shows the list price, a Discount line and the final (a reduction only); otherwise the final price only. */
  showDiscountOnProposal?: boolean
}

export interface PriceInputs {
  sections: number
  footage: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
  materialCost: number
  /** Extra hours on top of calculated labor, always billed at the man hour rate. */
  extraLaborHrs: number
  hasSalesman: boolean
  /** Slider adjustment, e.g. 0.05 = +5%. Ignored when finalPrice is set. */
  priceAdjust: number
  style?: StylePricing
  pricing: PricingSettings
  overrides?: QuotePricingOverrides
}

export interface PriceResult {
  laborMode: LaborMode | 'flat'
  subUnit: SubUnit
  /** Subcontractor rate actually used (0 in hourly mode). */
  subRate: number
  /** Projected man hours. Always computed, even on subcontractor jobs, for scheduling. */
  manHours: number
  /** Crew time for scheduling: man hours ÷ crew size, and that in crew days. */
  crewSize: number
  crewHours: number
  crewDays: number
  laborCost: number
  tearOutCost: number
  materialCost: number
  totalCOGS: number
  priceMethod: PriceMethod | 'manual'
  costFactor: number
  pricePerFootUsed: number
  /** Price before the slider and before any commission gross up. */
  basePrice: number
  commissionPct: number
  commissionMode: CommissionMode
  commissionAmt: number
  /** What the customer pays: the whole dollar price (to the cent on a quote that keeps its cents). */
  price: number
  /** The price before it was rounded down to the whole dollar. */
  priceBeforeRounding: number
  /** Cents the price was rounded down by (0 to 99), out of profit. */
  roundingCents: number
  /** The price after the slider and before the ± dollar adjustment (not rounded): commission and overhead are on it. */
  priceBeforeAdjustment: number
  /** What the price would be with no ± dollar adjustment (rounded like the price): the proposal's list price. */
  listPrice: number
  /** The ± dollar adjustment applied, in whole dollar cents (0 when there is none or it was refused). */
  adjustmentCents: number
  /** A reduction asked for that would put the price under cost, so it was not applied. */
  adjustmentRefused: boolean
  /** price − cost − commission. */
  grossMargin: number
  gmPct: number
  /** price ÷ footage. */
  pricePerFoot: number
  /** Things the estimator should know (missing rates, fallbacks). */
  notes: string[]
  /** Paid per a unit with no rate for it (subUnitRateMissing): the quote cannot be saved until a rate is typed. */
  subRateMissing: string | null
}

const DEFAULT_MH_WALK_GATE = 2.4
const DEFAULT_MH_DBL_GATE = 4.8
const DEFAULT_COST_FACTOR = 0.64

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function pos(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
}

function cents(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Crew time for any man hours, at the crew size and day length a price was
 * worked out with (calculatePrice's own math). A move or a repair has its own
 * man hours: its crew time is from those, never the new fence's (round 2
 * review, Oct 26 2026: a repair said 1.7 man hours and "0.0 hr · 0.0 days").
 */
export function crewTime(manHours: number, p: Pick<PriceResult, 'crewSize' | 'crewHours' | 'crewDays'>, hoursPerDay?: number | null): { size: number; hours: number; days: number } {
  const size = pos(p.crewSize) ?? 3
  const day = pos(p.crewHours) && pos(p.crewDays) ? p.crewHours / p.crewDays : pos(hoursPerDay) ?? 10
  const hours = Math.max(0, Number(manHours) || 0) / size
  return { size, hours, days: hours / day }
}

/**
 * The whole dollar rule on an amount in cents: rounded DOWN to the whole
 * dollar (a credit, below zero, goes to the larger whole dollar credit), so
 * the customer never pays the cents. `on` false: the amount as it is.
 */
export function wholeDollarCents(amountCents: number, on = true): { cents: number; roundingCents: number } {
  const c = Math.round(amountCents)
  if (!on) return { cents: c, roundingCents: 0 }
  const whole = Math.floor(c / 100) * 100
  return { cents: whole, roundingCents: c - whole }
}

/** Whether these pricing choices round to the whole dollar (every quote but one that keeps its cents). */
export function roundsToWholeDollar(o: QuotePricingOverrides | null | undefined): boolean {
  return o?.wholeDollar !== false
}

/** The ± dollar adjustment asked for on a quote, in whole dollar cents (0: none). */
export function adjustmentOf(o: QuotePricingOverrides | null | undefined): number {
  const v = o?.priceAdjustmentCents
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0
  return Math.round(v / 100) * 100 || 0
}

export interface AdjustedPrice {
  /** The price the customer pays, in cents (rounded per the whole dollar rule). */
  priceCents: number
  roundingCents: number
  /** The same price with no adjustment, in cents. */
  listCents: number
  /** The adjustment applied (0 when there is none or it was refused). */
  adjustmentCents: number
  refused: boolean
}

/**
 * The ± dollar adjustment on a price before rounding (`unroundedCents`, the
 * price after the slider), then the whole dollar rule. A reduction that would
 * leave the price under `floorCents` (cost of goods + commission) or under $0
 * is refused: the price stays as it was.
 */
export function adjustedPrice(unroundedCents: number, o: QuotePricingOverrides | null | undefined, floorCents: number): AdjustedPrice {
  const on = roundsToWholeDollar(o)
  const list = wholeDollarCents(unroundedCents, on)
  const wanted = adjustmentOf(o)
  if (wanted === 0 || !(unroundedCents > 0)) return { priceCents: list.cents, roundingCents: list.roundingCents, listCents: list.cents, adjustmentCents: 0, refused: false }
  const r = wholeDollarCents(unroundedCents + wanted, on)
  if (wanted < 0 && r.cents < Math.max(0, Math.ceil(Math.round(floorCents * 100) / 100))) {
    return { priceCents: list.cents, roundingCents: list.roundingCents, listCents: list.cents, adjustmentCents: 0, refused: true }
  }
  return { priceCents: r.cents, roundingCents: r.roundingCents, listCents: list.cents, adjustmentCents: wanted, refused: false }
}

/** The note shown when a reduction is refused. */
export function refusedNote(adjustmentCents: number): string {
  return `Taking $${Math.abs(Math.round(adjustmentCents / 100)).toLocaleString('en-US')} off would put the price under cost, so it is not applied.`
}

/**
 * A quote that keeps its cents: one sent, sold or accepted (or given a
 * customer link) before the whole dollar rule, and never priced with it.
 * Its prices stay exactly as the customer saw or signed them. A draft is
 * priced to the whole dollar the next time it is opened and saved.
 */
export function keepsCents(q: { pricing?: QuotePricingOverrides | null; status?: string | null; shareToken?: string | null; acceptedAt?: unknown; soldAt?: unknown } | null | undefined): boolean {
  if (!q) return false
  const w = q.pricing?.wholeDollar
  if (w === false) return true
  if (w === true) return false
  return q.status === 'SENT' || q.status === 'SOLD' || !!q.shareToken || !!q.acceptedAt || !!q.soldAt
}

/** Subcontractor rate for a style: quote override → style → category → default. */
export function resolveSubRate(
  style: StylePricing | undefined,
  pricing: PricingSettings,
  override?: number,
): number {
  return pos(override)
    ?? pos(style?.subRate)
    ?? pos(style?.category ? pricing.subRateByCategory?.[style.category] : undefined)
    ?? pos(pricing.subRateDefault)
    ?? 0
}

/**
 * The unit a quote's sub is paid per (Jonathan, Oct 30 2026): the rate and the
 * unit travel together. A quote with no sub rate of its own follows Settings
 * for both, whatever unit it was saved with; it keeps its own unit only when
 * "Paid per" was picked on it (subUnitPicked) or it has its own typed rate (a
 * rate means nothing without its unit).
 */
export function subUnitOf(o: Pick<QuotePricingOverrides, 'subUnit' | 'subUnitPicked' | 'subRate'> | null | undefined, pricing: Pick<PricingSettings, 'subUnit'>): SubUnit {
  return (keepsOwnSubUnit(o) ? o?.subUnit : undefined) ?? pricing.subUnit ?? 'foot'
}

/**
 * "Paid per" as the quote builder opens a quote: a new quote, or one with no
 * unit of its own, on Settings' unit; one picked on it or with its own rate on
 * its saved unit. `picked` says whether it was picked by hand.
 */
export function subUnitOnOpen(saved: Pick<QuotePricingOverrides, 'subUnit' | 'subUnitPicked' | 'subRate'> | null | undefined, pricing: Pick<PricingSettings, 'subUnit'>): { unit: SubUnit; picked: boolean; own: boolean } {
  return { unit: subUnitOf(saved, pricing), picked: saved?.subUnitPicked === true, own: keepsOwnSubUnit(saved) }
}

/**
 * A sub rate is for one unit (Jonathan, Oct 30 2026): Settings' rates are per
 * Settings' unit, so a quote paid per the other unit with no rate of its own
 * has no rate at all. It is never charged Settings' per foot rate per section
 * (or the other way round), and nothing converts one into the other. Returns
 * what to tell the person ("Type the rate per section: Settings has $5 per
 * foot."), or null when there is a rate. The quote cannot be priced or saved
 * until a rate is typed (or "Paid per" goes back to Settings' unit).
 */
export function subUnitRateMissing(
  o: Pick<QuotePricingOverrides, 'laborMode' | 'subUnit' | 'subUnitPicked' | 'subRate' | 'laborCost'> | null | undefined,
  pricing: Pick<PricingSettings, 'laborMode' | 'subUnit' | 'subRateDefault' | 'subRateByCategory'>,
  style?: StylePricing,
): string | null {
  if ((o?.laborMode ?? pricing.laborMode ?? 'hourly') !== 'subcontractor') return null
  if (typeof o?.laborCost === 'number' && Number.isFinite(o.laborCost) && o.laborCost >= 0) return null
  if (pos(o?.subRate) !== undefined) return null
  const settingsUnit: SubUnit = pricing.subUnit ?? 'foot'
  const unit = subUnitOf(o, pricing)
  if (unit === settingsUnit) return null
  const rate = resolveSubRate(style, pricing as PricingSettings)
  const has = rate > 0 ? `$${Number.isInteger(rate) ? rate : rate.toFixed(2)} per ${settingsUnit}` : `its rates per ${settingsUnit}`
  return `Type the rate per ${unit}: Settings has ${has}.`
}

/** Does a quote keep the sub unit saved on it (picked on it, or with its own rate)? Else it follows Settings. */
export function keepsOwnSubUnit(o: Pick<QuotePricingOverrides, 'subUnitPicked' | 'subRate'> | null | undefined): boolean {
  return o?.subUnitPicked === true || pos(o?.subRate) !== undefined
}

export function calculatePrice(input: PriceInputs): PriceResult {
  const { style, pricing } = input
  const o = input.overrides ?? {}
  const notes: string[] = []

  const sections = Math.max(0, num(input.sections))
  const footage = Math.max(0, num(input.footage))
  const walkGates = Math.max(0, num(input.walkGates))
  const dblGates = Math.max(0, num(input.dblGates))
  const tearOutSections = Math.max(0, num(input.tearOutSections))
  const tearOutGates = Math.max(0, num(input.tearOutGates))
  const materialCost = Math.max(0, num(input.materialCost))
  const extraLaborHrs = num(input.extraLaborHrs)
  const manHourRate = num(pricing.manHourRate)

  // ── Man hours (always, for scheduling and for hourly labor) ──
  const sectionsPerMH = pos(style?.sectionsPerMH)
  const baseMH = style && sectionsPerMH
    ? sections / sectionsPerMH
      + walkGates * num(style.mhPerWalkGate, DEFAULT_MH_WALK_GATE)
      + dblGates * num(style.mhPerDblGate, DEFAULT_MH_DBL_GATE)
    : 0
  const manHours = baseMH + extraLaborHrs
  const crewSize = pos(pricing.crewSize) ?? 3
  const crewHours = manHours / crewSize
  const crewDays = crewHours / (pos(pricing.crewHoursPerDay) ?? 10)

  // ── Labor ──
  const requestedMode: LaborMode = o.laborMode ?? pricing.laborMode ?? 'hourly'
  const subUnit: SubUnit = subUnitOf(o, pricing)
  let laborMode: PriceResult['laborMode'] = requestedMode
  let subRate = 0
  let subRateMissing: string | null = null
  let laborCost: number

  if (typeof o.laborCost === 'number' && Number.isFinite(o.laborCost) && o.laborCost >= 0) {
    laborMode = 'flat'
    laborCost = o.laborCost
  } else if (requestedMode === 'subcontractor') {
    // Paid per a unit Settings has no rate for, and none typed: no rate (never Settings' rate for the other unit).
    const unitMissing = subUnitRateMissing(o, pricing, style)
    subRate = unitMissing ? 0 : resolveSubRate(style, pricing, o.subRate)
    if (unitMissing) {
      subRateMissing = unitMissing
      notes.push(unitMissing)
    } else if (subRate <= 0 && (sections > 0 || footage > 0)) {
      notes.push('No subcontractor rate is set for this style, so install labor is $0. Set a rate in Settings → Pricing or type one on this quote.')
    }
    // Any piece of the job with no sub rate is called out, never charged $0 quietly.
    const missing: string[] = []
    if (walkGates > 0 && !(num(pricing.subWalkGate) > 0)) missing.push('walk gate')
    if (dblGates > 0 && !(num(pricing.subDblGate) > 0)) missing.push('double gate')
    if (tearOutSections > 0 && !(num(pricing.subTearOutSection) > 0)) missing.push('tear out section')
    if (tearOutGates > 0 && !(num(pricing.subTearOutGate) > 0)) missing.push('tear out gate')
    if (missing.length > 0) {
      notes.push(`No subcontractor rate per ${missing.join(', per ')} is set, so that labor is $0. Set it in Settings → Pricing, or switch this quote to Hourly crew.`)
    }
    const units = subUnit === 'section' ? sections : footage
    laborCost = units * subRate
      + walkGates * num(pricing.subWalkGate)
      + dblGates * num(pricing.subDblGate)
      + tearOutSections * num(pricing.subTearOutSection)
      + tearOutGates * num(pricing.subTearOutGate)
      + extraLaborHrs * manHourRate
  } else {
    laborCost = manHours * manHourRate
  }

  // ── Cost ──
  const tearOutCost = tearOutSections * num(pricing.tearOutFence) + tearOutGates * num(pricing.tearOutGate)
  const totalCOGS = laborCost + materialCost + tearOutCost

  // ── Base price ──
  const requestedMethod: PriceMethod = o.priceMethod ?? pricing.priceMethod ?? 'cost_factor'
  const costFactor = pos(o.costFactor) ?? pos(style?.margin) ?? DEFAULT_COST_FACTOR
  const perFoot = pos(o.pricePerFoot) ?? pos(style?.pricePerFoot) ?? 0
  let priceMethod: PriceResult['priceMethod'] = requestedMethod
  let basePrice: number

  if (requestedMethod === 'per_foot' && perFoot > 0) {
    basePrice = footage * perFoot
  } else {
    if (requestedMethod === 'per_foot') {
      notes.push('No per foot price is set for this style, so the price was built from cost instead.')
      priceMethod = 'cost_factor'
    }
    basePrice = totalCOGS / costFactor
  }

  // ── Commission ──
  const commissionMode: CommissionMode = o.commissionMode ?? pricing.commissionMode ?? 'included'
  const rawPct = typeof o.commissionPct === 'number' && Number.isFinite(o.commissionPct)
    ? o.commissionPct
    : (input.hasSalesman ? num(pricing.commissionSalesman) : num(pricing.commissionNonSalesman))
  const commissionPct = Math.min(Math.max(rawPct, 0), 0.95)

  // ── Final price ──
  let unrounded: number
  if (typeof o.finalPrice === 'number' && Number.isFinite(o.finalPrice) && o.finalPrice > 0) {
    priceMethod = 'manual'
    unrounded = o.finalPrice
  } else {
    const withCommission = commissionMode === 'added' ? basePrice / (1 - commissionPct) : basePrice
    unrounded = withCommission * (1 + num(input.priceAdjust))
  }
  // Commission (and overhead) are on the price after the slider, before the ± dollar adjustment and the rounding.
  const priceBeforeAdjustment = unrounded
  const commissionAmt = priceBeforeAdjustment * commissionPct

  // ── ± dollar adjustment (out of profit, never under cost), then whole dollar (last) ──
  const a = adjustedPrice(unrounded * 100, o, (totalCOGS + commissionAmt) * 100)
  if (a.refused) notes.push(refusedNote(adjustmentOf(o)))
  unrounded += a.adjustmentCents / 100
  const r = { cents: a.priceCents, roundingCents: a.roundingCents }
  const price = r.roundingCents > 0 || a.adjustmentCents !== 0 ? r.cents / 100 : unrounded
  const listPrice = r.roundingCents > 0 || a.adjustmentCents !== 0 ? a.listCents / 100 : priceBeforeAdjustment
  const grossMargin = price - totalCOGS - commissionAmt
  const gmPct = price > 0 ? grossMargin / price : 0

  return {
    laborMode,
    subUnit,
    subRate,
    manHours,
    crewSize,
    crewHours,
    crewDays,
    laborCost: cents(laborCost),
    tearOutCost: cents(tearOutCost),
    materialCost: cents(materialCost),
    totalCOGS: cents(totalCOGS),
    priceMethod,
    costFactor,
    pricePerFootUsed: perFoot,
    basePrice: cents(basePrice),
    commissionPct,
    commissionMode,
    commissionAmt: cents(commissionAmt),
    price: cents(price),
    priceBeforeRounding: cents(unrounded),
    roundingCents: r.roundingCents,
    priceBeforeAdjustment: cents(priceBeforeAdjustment),
    listPrice: cents(listPrice),
    adjustmentCents: a.adjustmentCents,
    adjustmentRefused: a.refused,
    grossMargin: cents(grossMargin),
    gmPct,
    pricePerFoot: footage > 0 ? cents(price / footage) : 0,
    notes,
    subRateMissing,
  }
}

/** Drop empty values so a quote only stores the overrides that are really set. */
export function cleanOverrides(o: QuotePricingOverrides | undefined | null): QuotePricingOverrides | undefined {
  if (!o) return undefined
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '') continue
    if (typeof v === 'number' && !Number.isFinite(v)) continue
    out[k] = v
  }
  return Object.keys(out).length > 0 ? (out as QuotePricingOverrides) : undefined
}

/**
 * The old system's price on a quote brought in from JobNimbus: those quotes
 * came with no measurements and their invoice total as a typed price. That
 * price was never typed here, so it is not a price set by hand: an open or
 * lost one is priced from its parts like any quote once it is measured. A
 * sold one keeps it (it is what the customer agreed to). Null otherwise.
 */
export function importedOldPrice(q: { pricing?: QuotePricingOverrides | null; runs?: unknown[] | null; status?: string } | null | undefined): number | null {
  const p = q?.pricing
  if (!p || typeof p.finalPrice !== 'number' || !(p.finalPrice > 0)) return null
  if (Object.keys(p).some(k => k !== 'finalPrice')) return null
  if (Array.isArray(q?.runs) && q!.runs!.length > 0) return null
  return p.finalPrice
}
