/**
 * The labor mode when nothing says one (Nov 3 2026): Subcontractor, not Hourly
 * crew. Only the fallback changed: a quote or Settings that says hourly stays
 * hourly, and one that says subcontractor stays subcontractor. Covered: the
 * pricing engine, the "rate per unit" check, move and repair rates, a new
 * quote's choices, the Settings defaults, the quoted cost record at signing and
 * Job Costing's sub or crew guess.
 */

import { describe, test, expect } from 'vitest'
import { calculatePrice, subUnitRateMissing, type PriceInputs, type PricingSettings, type StylePricing } from '../../web/src/pricingEngine'
import { styleRates } from '../../web/src/moveRepair'
import { newQuoteOverrides } from '../../web/src/widgetPricing'
import { DEFAULT_CONFIG, mergeSavedConfig } from '../../web/src/configDefaults'
import { quotedCostOf } from '../src/server/lib/jobCostingMath'
import { workOutPrefill, type PrefillInput } from '../src/server/lib/jobCostPrefill'

const NONE: PricingSettings = {
  manHourRate: 22, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27,
  subUnit: 'foot', subRateByCategory: { Vinyl: 8 }, subWalkGate: 50, subDblGate: 90,
}
const vinyl: StylePricing = { category: 'Vinyl', margin: 0.64, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 }
const job: PriceInputs = {
  sections: 25, footage: 150, walkGates: 1, dblGates: 1, tearOutSections: 0, tearOutGates: 0,
  materialCost: 3000, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, style: vinyl, pricing: NONE,
}
const HOURLY = (25 / 1.2 + 2.4 + 4.8) * 22
const SUB = 150 * 8 + 50 + 90

describe('the pricing engine', () => {
  test('neither the quote nor Settings say: Subcontractor', () => {
    const r = calculatePrice(job)
    expect(r.laborMode).toBe('subcontractor')
    expect(r.laborCost).toBe(SUB)
  })
  test('Settings say hourly: hourly; the quote says hourly: hourly', () => {
    expect(calculatePrice({ ...job, pricing: { ...NONE, laborMode: 'hourly' } }).laborCost).toBeCloseTo(HOURLY, 2)
    expect(calculatePrice({ ...job, overrides: { laborMode: 'hourly' } }).laborCost).toBeCloseTo(HOURLY, 2)
    expect(calculatePrice({ ...job, pricing: { ...NONE, laborMode: 'subcontractor' }, overrides: { laborMode: 'hourly' } }).laborCost).toBeCloseTo(HOURLY, 2)
  })
  test('the quote says subcontractor over Settings hourly: subcontractor', () => {
    expect(calculatePrice({ ...job, pricing: { ...NONE, laborMode: 'hourly' }, overrides: { laborMode: 'subcontractor' } }).laborCost).toBe(SUB)
  })
  test('the rate per unit check runs with no labor mode (a sub quote), not with hourly', () => {
    expect(subUnitRateMissing({ subUnitPicked: true, subUnit: 'section' }, NONE, vinyl)).toMatch(/Type the rate per section/)
    expect(subUnitRateMissing({ subUnitPicked: true, subUnit: 'section', laborMode: 'hourly' }, NONE, vinyl)).toBeNull()
  })
})

describe('moves and repairs, a new quote, Settings', () => {
  const wv = { name: "WV-ND 6'x6' Privacy", category: 'Vinyl', margin: 0.56, sectionsPerMH: 1.2, panelWidth: 6 }
  test('move and repair rates: sub with no labor mode, hourly when it says so', () => {
    expect(styleRates(wv, NONE).laborMode).toBe('subcontractor')
    expect(styleRates(wv, { ...NONE, laborMode: 'hourly' }).laborMode).toBe('hourly')
    expect(styleRates(wv, NONE, { laborMode: 'hourly' }).laborMode).toBe('hourly')
  })
  test('a new quote: Settings with no labor mode start it as Subcontractor; hourly Settings, hourly', () => {
    expect(newQuoteOverrides({ pricing: { ...DEFAULT_CONFIG.pricing, laborMode: undefined as any } })).toMatchObject({ laborMode: 'subcontractor', subUnit: 'foot' })
    expect(newQuoteOverrides({ pricing: { ...DEFAULT_CONFIG.pricing, laborMode: 'hourly' } }).laborMode).toBe('hourly')
  })
  test('Settings saved with no labor mode read as Subcontractor; saved hourly stays hourly', () => {
    expect(DEFAULT_CONFIG.pricing.laborMode).toBe('subcontractor')
    expect(mergeSavedConfig({ pricing: { manHourRate: 25 } } as any).pricing.laborMode).toBe('subcontractor')
    expect(mergeSavedConfig({ pricing: { laborMode: 'hourly' } } as any).pricing.laborMode).toBe('hourly')
  })
})

describe('job costing', () => {
  const q = { id: 'q1', fenceStyle: 'WV', salesRep: '', sections: 10, runs: [60], materialCost: 500, laborCost: 300, tearOutCost: 0, totalCOGS: 800, finalPrice: 1500, pullSheet: [], pricing: {}, work: null }
  const at = { inventory: [], signedVia: 'app', signedAt: new Date('2026-11-03T12:00:00Z') }
  test('the quoted cost record: sub with no labor mode anywhere; crew when the quote or Settings say hourly', () => {
    expect(quotedCostOf(q, { ...at, pricing: { manHourRate: 22 } }).labor.mode).toBe('sub')
    expect(quotedCostOf(q, { ...at, pricing: { manHourRate: 22, laborMode: 'hourly' } }).labor.mode).toBe('crew')
    expect(quotedCostOf({ ...q, pricing: { laborMode: 'hourly' } }, { ...at, pricing: { manHourRate: 22, laborMode: 'subcontractor' } }).labor.mode).toBe('crew')
  })
  test('a new entry: an old quote with no labor mode and Settings with none either is a sub job', () => {
    const base: PrefillInput = { quote: { laborCents: 30000, materialCents: 50000, laborMode: null }, settingsLaborMode: null, takeoff: null, bills: [], invoices: [], orders: [] }
    expect(workOutPrefill(base).sub).toBe(true)
    expect(workOutPrefill({ ...base, settingsLaborMode: 'hourly' }).sub).toBe(false)
    expect(workOutPrefill({ ...base, quote: { ...base.quote, laborMode: 'hourly' } }).sub).toBe(false)
  })
})
