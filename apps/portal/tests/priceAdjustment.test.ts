/**
 * Dollar adjustment on the quote (Jonathan, Oct 22 2026): "Keep the percent
 * slider as is for setting margin. Below it add a Final Price field I can type
 * into directly, or a plus/minus dollar field, so I can take $30 off without
 * the price jumping in chunks. The engine stores it as priceAdjustmentCents
 * (negative for a reduction), applied after the slider, and it comes out of
 * profit, never out of overhead."
 *
 * After the slider, before the whole dollar rounding (so a typed final price
 * comes out exact); commission and overhead stay on the price before it; never
 * under cost; the same amount on every option of the proposal; the customer
 * sees list, Discount and final only when the quote says so.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { calculatePrice, adjustedPrice, adjustmentOf, type PriceInputs, type PricingSettings } from '../../web/src/pricingEngine'
import { calculateQuote, type QuoteCalcInput, type QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { buildProposal, priceOption, listPriceOf } from '../../web/src/proposal'
import { priceMove, moveRepairSettings, type WorkCommon } from '../../web/src/moveRepair'
import { quoteJobFor } from '../../web/src/estimate'
import { quoteView } from '../../web/src/quoteJob'
import { splitDollars } from '../../web/src/DollarPickets'
import { requestFrom } from '../src/server/lib/quotePricing'
import { optionPriceHtml, depositDollars } from '../src/server/routes/proposal.js'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

const pricing: PricingSettings = { manHourRate: 22, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27 }
const vinyl = { category: 'Vinyl', margin: 0.64, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 }
const job: PriceInputs = { sections: 25, footage: 150, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0, materialCost: 3000, extraLaborHrs: 0, hasSalesman: true, priceAdjust: 0.05, style: vinyl, pricing }

const st = (name: string, extra: Partial<QuoteStyle> = {}): QuoteStyle => ({ name, category: 'Vinyl', margin: 0.58, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8, panelWidth: 6, ...extra })
const calcPricing = { manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27, laborMode: 'subcontractor' as const, subUnit: 'section' as const, subRateByCategory: { Vinyl: 24 } }
const input = (style: QuoteStyle, extra: Partial<QuoteCalcInput> = {}): QuoteCalcInput => ({
  style, runs: [{ ft: 97.3 }, { ft: 41.5 }], corners: 1, ends: 2, walkGates: 1, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: true, priceAdjust: 0.03, pricing: calcPricing, optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, ...extra,
})

describe('the engine: after the slider, before the rounding, out of profit', () => {
  test('$30 off: the price drops $30 exactly, commission and costs do not move, margin drops $30', () => {
    const before = calculatePrice(job)
    const after = calculatePrice({ ...job, overrides: { priceAdjustmentCents: -3000 } })
    expect(before.adjustmentCents).toBe(0)
    expect(after.adjustmentCents).toBe(-3000)
    expect(after.adjustmentRefused).toBe(false)
    expect(after.price).toBe(before.price - 30)
    expect(after.listPrice).toBe(before.price)
    // After the slider: the price before the adjustment is the slider's price.
    expect(after.priceBeforeAdjustment).toBe(before.priceBeforeRounding)
    // Before the rounding: the same cents come off as without the adjustment.
    expect(after.roundingCents).toBe(before.roundingCents)
    // Out of profit: commission and costs unchanged, margin $30 lower.
    expect([after.commissionAmt, after.totalCOGS, after.basePrice]).toEqual([before.commissionAmt, before.totalCOGS, before.basePrice])
    expect(Math.round((before.grossMargin - after.grossMargin) * 100)).toBe(3000)
    expect(after.gmPct).toBeLessThan(before.gmPct)
  })

  test('the slider still moves the price in percent; the adjustment is on top of it', () => {
    const at0 = calculatePrice({ ...job, priceAdjust: 0, overrides: { priceAdjustmentCents: -3000 } })
    const at10 = calculatePrice({ ...job, priceAdjust: 0.1, overrides: { priceAdjustmentCents: -3000 } })
    expect(at10.listPrice).toBeGreaterThan(at0.listPrice)
    expect(at0.price).toBe(at0.listPrice - 30)
    expect(at10.price).toBe(at10.listPrice - 30)
  })

  test('an increase is allowed and goes to profit only', () => {
    const before = calculatePrice(job)
    const up = calculatePrice({ ...job, overrides: { priceAdjustmentCents: 5000 } })
    expect(up.price).toBe(before.price + 50)
    expect(up.commissionAmt).toBe(before.commissionAmt)
    expect(Math.round((up.grossMargin - before.grossMargin) * 100)).toBe(5000)
  })

  test('a typed final price comes out exact (the adjustment is list → typed, in whole dollars)', () => {
    const list = calculatePrice(job)
    const typed = 8914
    const adj = (typed - Math.round(list.listPrice)) * 100
    const r = calculatePrice({ ...job, overrides: { priceAdjustmentCents: adj } })
    expect(r.price).toBe(typed)
    expect(r.adjustmentCents).toBe(adj)
    // The two fields stay in step: list + adjustment = final.
    expect(r.listPrice + r.adjustmentCents / 100).toBe(r.price)
  })

  test('whole dollars only: cents typed are rounded to the dollar', () => {
    expect(adjustmentOf({ priceAdjustmentCents: -3049 })).toBe(-3000)
    expect(adjustmentOf({ priceAdjustmentCents: -3051 })).toBe(-3100)
    expect(adjustmentOf({ priceAdjustmentCents: NaN })).toBe(0)
    expect(adjustmentOf(undefined)).toBe(0)
  })

  test('never under cost: a reduction past cost + commission is refused (the price stays), with a note', () => {
    const before = calculatePrice(job)
    const tooMuch = Math.round((before.price - before.totalCOGS - before.commissionAmt + 1) * 100) * -1
    const r = calculatePrice({ ...job, overrides: { priceAdjustmentCents: tooMuch } })
    expect(r.adjustmentRefused).toBe(true)
    expect(r.adjustmentCents).toBe(0)
    expect(r.price).toBe(before.price)
    expect(r.notes.some(n => /under cost/.test(n))).toBe(true)
    // Right at cost is allowed (margin $0 or a little above, never below).
    const atCost = calculatePrice({ ...job, overrides: { priceAdjustmentCents: -Math.floor(before.grossMargin) * 100 } })
    expect(atCost.adjustmentRefused).toBe(false)
    expect(atCost.grossMargin).toBeGreaterThanOrEqual(0)
  })

  test('adjustedPrice: refused under $0 even with no cost', () => {
    expect(adjustedPrice(5000, { priceAdjustmentCents: -6000 }, 0)).toMatchObject({ refused: true, priceCents: 5000, adjustmentCents: 0 })
    expect(adjustedPrice(5027, { priceAdjustmentCents: -1000 }, 0)).toMatchObject({ priceCents: 4000, roundingCents: 27, listCents: 5000, adjustmentCents: -1000 })
    // A quote that keeps its cents: no rounding, the adjustment still whole dollars.
    expect(adjustedPrice(5027, { priceAdjustmentCents: -1000, wholeDollar: false }, 0)).toMatchObject({ priceCents: 4027, roundingCents: 0, listCents: 5027 })
  })

  test('no adjustment: every figure exactly as before (no saved quote changes)', () => {
    const a = calculatePrice(job)
    const b = calculatePrice({ ...job, overrides: { priceAdjustmentCents: 0, showDiscountOnProposal: true } })
    expect(b).toEqual(a)
    expect(a.listPrice).toBe(a.price)
  })
})

describe('where every dollar goes: overhead stays on the price before the adjustment', () => {
  test('profit drops by exactly the adjustment; overhead and commission do not move', () => {
    const before = calculatePrice(job)
    const after = calculatePrice({ ...job, overrides: { priceAdjustmentCents: -3000 } })
    const split = (r: typeof before) => splitDollars({ price: r.price, materials: r.materialCost, labor: r.laborCost + r.tearOutCost, commission: r.commissionAmt, overheadPct: 30, roundingCents: r.roundingCents, adjustmentCents: r.adjustmentCents })
    const b = Object.fromEntries(split(before).map(p => [p.part, p.dollars]))
    const a = Object.fromEntries(split(after).map(p => [p.part, p.dollars]))
    expect(a.overhead).toBeCloseTo(b.overhead, 6)
    expect(a.commission).toBeCloseTo(b.commission, 6)
    expect(b.profit - a.profit).toBeCloseTo(30, 6)
  })
})

describe('every option on the proposal gets the same adjustment', () => {
  const own = st("WV-ND 6'x8' Privacy")
  const other = st("WV-ND 6'x6' Privacy", { margin: 0.6 })
  test('each option $30 lower, each with its own list price; the box decides the Discount line', () => {
    const i = input(own, { overrides: { priceAdjustmentCents: -3000, showDiscountOnProposal: true } })
    const plain = input(own)
    const q = calculateQuote(i)
    const base = { company: { name: '', phone: '', email: '' }, customer: { name: '', address: '' }, warranty: '', settings: {}, photoIds: {} }
    const p = buildProposal({ ...base, input: i, styles: [own, other], ownPrice: q.priced.price, ownRoundingCents: q.priced.roundingCents, ownAdjustmentCents: q.priced.adjustmentCents, showDiscount: true })
    expect(p.showDiscount).toBe(true)
    for (const o of p.options) {
      expect(o.adjustmentCents, o.label).toBe(-3000)
      const without = priceOption(plain, o.fenceStyle === own.name ? own : other)
      expect(o.finalPrice).toBe(without.finalPrice - 30)
      expect(listPriceOf(o)).toBe(without.finalPrice)
    }
    // Unchecked: the proposal says final only.
    const off = buildProposal({ ...base, input: i, styles: [own, other], ownPrice: q.priced.price, ownAdjustmentCents: q.priced.adjustmentCents, showDiscount: false })
    expect(off.showDiscount).toBeUndefined()
  })
})

describe('the customer page', () => {
  test('checked: list price, Discount −$30, final; unchecked: the final price only', () => {
    const o = { finalPrice: 8914, adjustmentCents: -3000 }
    const on = optionPriceHtml({ showDiscount: true }, o)
    expect(on).toContain('data-list-price')
    expect(on).toContain('$8,944')
    expect(on).toContain('Discount −$30')
    expect(on).toContain('<span class="price" data-final-price>$8,914</span>')
    const off = optionPriceHtml({}, o)
    expect(off).toBe('<span class="price">$8,914</span>')
    // An increase is never shown to the customer as a line: the final only.
    expect(optionPriceHtml({ showDiscount: true }, { finalPrice: 9000, adjustmentCents: 5000 })).toBe('<span class="price">$9,000</span>')
  })

  test('the deposit comes from the final price', () => {
    expect(depositDollars({ depositPct: 50, wholeDollar: true }, 8914)).toBe(4457)
  })
})

describe('the quote builder\'s job (owner, office and the server for a salesman)', () => {
  const data = { config: null, inventory: [], kits: [] }
  const req = {
    fenceStyle: "WV-ND 6'x8' Privacy", runs: [{ ft: 97.3, rail: 'auto' as const }, { ft: 41.5, rail: 'auto' as const }], corners: 1, ends: 2, walkGates: 1, dblGates: 0,
    tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: true, priceAdjust: 0.03, overrides: {}, jobType: 'new' as const,
    compare: true, offer: ["WV-ND 6'x6' Privacy"],
  }
  test('frozen with the quote: the amount applied and the box; every option lower by the same amount', () => {
    const j0 = quoteJobFor(data, req, 30)
    const j = quoteJobFor(data, { ...req, overrides: { priceAdjustmentCents: -3000, showDiscountOnProposal: true } }, 30)
    expect(j.totals.price).toBe(j0.totals.price - 30)
    expect([j.totals.listPrice, j.totals.adjustmentCents]).toEqual([j0.totals.price, -3000])
    expect(j.totals.commission).toBe(j0.totals.commission)
    expect(j.pricing).toMatchObject({ priceAdjustmentCents: -3000, showDiscountOnProposal: true, wholeDollar: true })
    for (const o of j.proposalOptions) {
      const was = j0.proposalOptions.find(x => x.fenceStyle === o.fenceStyle)!
      expect(o.finalPrice, o.label).toBe(was.finalPrice - 30)
      expect(o.adjustmentCents).toBe(-3000)
    }
    // A salesman's phone: prices and the adjustment, never a cost.
    const v = quoteView(j) as any
    expect([v.price, v.listPrice, v.adjustmentCents, v.adjustmentRefused]).toEqual([j.totals.price, j0.totals.price, -3000, false])
    expect(JSON.stringify(v)).not.toMatch(/totalCOGS|grossMargin|commissionAmt/)
    // No adjustment: nothing about it is saved.
    expect(j0.pricing).not.toHaveProperty('priceAdjustmentCents')
    expect(j0.pricing).not.toHaveProperty('showDiscountOnProposal')
  })

  test('a refused reduction is not saved', () => {
    const j = quoteJobFor(data, { ...req, overrides: { priceAdjustmentCents: -999_999_00 } }, 30)
    expect(j.totals.adjustmentRefused).toBe(true)
    expect(j.pricing).not.toHaveProperty('priceAdjustmentCents')
  })

  test('the minimum job price: the adjustment goes on after it', () => {
    const tiny = quoteJobFor({ config: { moveRepair: { minimumJobCents: 150_000, minimumAppliesToNew: true } }, inventory: [], kits: [] }, { ...req, runs: [{ ft: 6, rail: 'auto' as const }], walkGates: 0, offer: [], compare: false, overrides: { priceAdjustmentCents: -3000 } }, 30)
    expect(tiny.newMin).toBe(true)
    expect([tiny.totals.listPrice, tiny.totals.price, tiny.totals.adjustmentCents]).toEqual([1500, 1470, -3000])
  })

  test('a salesman may send the adjustment like the slider; it is taken as a price choice', () => {
    const { req: r } = requestFrom({ fenceStyle: 'x', runs: [], overrides: { priceAdjustmentCents: -3000, showDiscountOnProposal: true, costFactor: 0.1 } }, null, () => null)
    expect(r.overrides).toEqual({ priceAdjustmentCents: -3000, showDiscountOnProposal: true })
  })
})

describe('a move or repair', () => {
  test('after the minimum, before the rounding; commission on the price before it', () => {
    const settings = moveRepairSettings({})
    const common = (extra: Partial<WorkCommon> = {}): WorkCommon => ({ style: st("WV-ND 6'x6' Privacy", { margin: 0.56 }), pricing: { ...calcPricing, commissionSalesman: 0.1 }, settings, overheadPct: 30, hasSalesman: true, priceAdjust: 0, extraLaborHrs: 0, ...extra })
    const m = { oldFt: 100, oldWalkGates: 0, oldDblGates: 0, oldPostType: 'nd' as const, newPostCaps: false }
    const line = { runs: [100], corners: 0, ends: 2, walkGates: 0, dblGates: 0 }
    const r0 = priceMove(common(), m, line)
    const r = priceMove(common({ overrides: { priceAdjustmentCents: -3000 } }), m, line)
    expect(r.priceCents).toBe(r0.priceCents - 3000)
    expect([r.listCents, r.adjustmentCents, r.roundingCents]).toEqual([r0.priceCents, -3000, r0.roundingCents])
    expect(r.commissionCents).toBe(r0.commissionCents)
    expect(r0.grossMarginCents - r.grossMarginCents).toBe(3000)
    const refused = priceMove(common({ overrides: { priceAdjustmentCents: -(r0.priceCents) } }), m, line)
    expect(refused.adjustmentRefused).toBe(true)
    expect(refused.priceCents).toBe(r0.priceCents)
    expect(refused.warnings.some(w => /under cost/.test(w))).toBe(true)
  })
})
