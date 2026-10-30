/**
 * The sub's "Paid per" travels with the rate (Jonathan, Oct 30 2026).
 *
 * Settings → Pricing went from $23 per section to $5 per foot at 9:23 am.
 * Every quote saved before kept `subUnit: 'section'` while its rate (blank =
 * Settings) followed Settings, so reopening it paid $5 per SECTION. Now a
 * quote with no sub rate of its own follows Settings for both the rate and the
 * unit; it keeps its own unit only when "Paid per" was picked on it
 * (subUnitPicked) or it has its own typed rate. A new quote starts on the
 * Settings unit on every path.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { calculatePrice, subUnitOf, subUnitOnOpen, keepsOwnSubUnit, subUnitRateMissing, type PriceInputs, type PricingSettings } from '../../web/src/pricingEngine'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { styleRates } from '../../web/src/moveRepair'
import { quoteJobFor, subRateMissingFor } from '../../web/src/estimate'
import { newQuoteOverrides } from '../../web/src/widgetPricing'
import { quotedCostOf } from '../src/server/lib/jobCostingMath'
import { requestFrom } from '../src/server/lib/quotePricing'

const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
afterAll(() => setMaterialPriceSource(null))

// Settings on live since Oct 30 9:23 am.
const perFoot: PricingSettings = {
  manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27,
  laborMode: 'subcontractor', subUnit: 'foot', subRateDefault: 5,
  subRateByCategory: { Vinyl: 5, Aluminum: 4, Chainlink: 3.9, Other: 5, Commercial: 6 },
  subWalkGate: 10, subDblGate: 20, subTearOutSection: 4, subTearOutGate: 12,
}
const vinyl = { category: 'Vinyl', margin: 0.64, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 }
// 258 ft in 43 sections, no gates: labor is the sub's pay for the fence only.
const job: PriceInputs = { sections: 43, footage: 258, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, materialCost: 3000, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, style: vinyl, pricing: perFoot }

describe('the engine: a blank rate follows Settings for the unit too', () => {
  test('a quote saved with Section and no rate of its own prices per foot at Settings\' rate', () => {
    const r = calculatePrice({ ...job, overrides: { laborMode: 'subcontractor', subUnit: 'section' } })
    expect(r.subUnit).toBe('foot')
    expect(r.subRate).toBe(5)
    expect(r.laborCost).toBe(258 * 5)
  })

  test('a typed rate keeps the unit it was saved with', () => {
    const r = calculatePrice({ ...job, overrides: { laborMode: 'subcontractor', subUnit: 'section', subRate: 26 } })
    expect([r.subUnit, r.subRate, r.laborCost]).toEqual(['section', 26, 43 * 26])
  })

  test('"Paid per" picked as Section with no rate: no rate for a section (Settings\' $5 is per foot), never $5 per section', () => {
    const r = calculatePrice({ ...job, overrides: { laborMode: 'subcontractor', subUnit: 'section', subUnitPicked: true } })
    expect(r.subUnit).toBe('section')
    expect(r.subRate).toBe(0)
    expect(r.laborCost).toBe(0)
    expect(r.subRateMissing).toBe('Type the rate per section: Settings has $5 per foot.')
    expect(r.notes).toContain('Type the rate per section: Settings has $5 per foot.')
    // With gates: the gates are still paid, the fence is not priced at a rate it does not have.
    expect(calculatePrice({ ...job, walkGates: 1, overrides: { laborMode: 'subcontractor', subUnit: 'section', subUnitPicked: true } }).laborCost).toBe(10)
  })

  test('picked Section with a rate typed: that rate per section', () => {
    const r = calculatePrice({ ...job, overrides: { laborMode: 'subcontractor', subUnit: 'section', subUnitPicked: true, subRate: 24 } })
    expect([r.subUnit, r.laborCost, r.subRateMissing]).toEqual(['section', 43 * 24, null])
  })

  test('the other way round: Settings per section, Foot picked, no rate', () => {
    const r = calculatePrice({ ...job, pricing: { ...perFoot, subUnit: 'section', subRateByCategory: { Vinyl: 23 } }, overrides: { laborMode: 'subcontractor', subUnit: 'foot', subUnitPicked: true } })
    expect([r.laborCost, r.subRateMissing]).toEqual([0, 'Type the rate per foot: Settings has $23 per section.'])
  })

  test('subUnitRateMissing: only a sub quote on the other unit with no rate of its own', () => {
    const picked = { laborMode: 'subcontractor' as const, subUnit: 'section' as const, subUnitPicked: true }
    expect(subUnitRateMissing(picked, perFoot, vinyl)).toBe('Type the rate per section: Settings has $5 per foot.')
    expect(subUnitRateMissing({ ...picked, subRate: 24 }, perFoot, vinyl)).toBeNull()
    expect(subUnitRateMissing({ ...picked, laborCost: 900 }, perFoot, vinyl)).toBeNull()
    expect(subUnitRateMissing({ ...picked, laborMode: 'hourly' }, perFoot, vinyl)).toBeNull()
    expect(subUnitRateMissing({ laborMode: 'subcontractor', subUnit: 'section' }, perFoot, vinyl)).toBeNull()
    expect(subUnitRateMissing({ laborMode: 'subcontractor', subUnit: 'foot', subUnitPicked: true }, perFoot, vinyl)).toBeNull()
    // A Salesman's phone has no rates (costs are not sent to her): the words still say what to do.
    expect(subUnitRateMissing(picked, { laborMode: 'subcontractor', subUnit: 'foot' })).toBe('Type the rate per section: Settings has its rates per foot.')
    // The server's check through the estimate bundle.
    expect(subRateMissingFor({ pricing: perFoot } as any, picked, "WV-ND 6'x6' Privacy")).toBe('Type the rate per section: Settings has $5 per foot.')
    expect(subRateMissingFor({ pricing: perFoot } as any, { ...picked, subRate: 30 }, "WV-ND 6'x6' Privacy")).toBeNull()
  })

  test('Settings per section: a blank-rate quote saved per foot follows it back', () => {
    const r = calculatePrice({ ...job, pricing: { ...perFoot, subUnit: 'section', subRateByCategory: { Vinyl: 23 } }, overrides: { laborMode: 'subcontractor', subUnit: 'foot' } })
    expect([r.subUnit, r.laborCost]).toEqual(['section', 43 * 23])
  })

  test('subUnitOf and keepsOwnSubUnit', () => {
    expect(subUnitOf(undefined, perFoot)).toBe('foot')
    expect(subUnitOf({ subUnit: 'section' }, perFoot)).toBe('foot')
    expect(subUnitOf({ subUnit: 'section', subRate: 0 }, perFoot)).toBe('foot')
    expect(subUnitOf({ subUnit: 'section', subRate: 26 }, perFoot)).toBe('section')
    expect(subUnitOf({ subUnit: 'section', subUnitPicked: true }, perFoot)).toBe('section')
    expect(subUnitOf({ subUnitPicked: true }, perFoot)).toBe('foot')
    expect(subUnitOf({}, {})).toBe('foot')
    expect(keepsOwnSubUnit({ subUnit: 'section' })).toBe(false)
    expect(keepsOwnSubUnit({ subRate: 26 })).toBe(true)
  })

  test('a move or repair\'s section labor follows the same rule', () => {
    const style = { name: "WV-ND 6'x6' Privacy", category: 'Vinyl', margin: 0.64, sectionsPerMH: 1.2, panelWidth: 6 }
    expect(styleRates(style, perFoot, { laborMode: 'subcontractor', subUnit: 'section' }).perSection).toBe(30)
    const picked = styleRates(style, perFoot, { laborMode: 'subcontractor', subUnit: 'section', subUnitPicked: true })
    expect([picked.perSection, picked.sectionText]).toEqual([null, 'Type the rate per section: Settings has $5 per foot.'])
    expect(styleRates(style, perFoot, { laborMode: 'subcontractor', subUnit: 'section', subUnitPicked: true, subRate: 24 }).perSection).toBe(24)
    expect(styleRates(style, perFoot, { laborMode: 'subcontractor', subUnit: 'section', subRate: 26 }).perSection).toBe(26)
  })
})

describe('the quote builder opens on the right unit', () => {
  test('a new quote (nothing saved) starts on Settings\' unit', () => {
    expect(subUnitOnOpen(undefined, perFoot)).toEqual({ unit: 'foot', picked: false, own: false })
    expect(subUnitOnOpen({}, { subUnit: 'section' })).toEqual({ unit: 'section', picked: false, own: false })
  })
  test('a draft saved per section before the Settings change opens per foot', () => {
    expect(subUnitOnOpen({ laborMode: 'subcontractor', subUnit: 'section' } as any, perFoot)).toEqual({ unit: 'foot', picked: false, own: false })
  })
  test('picked, or with its own rate: its saved unit', () => {
    expect(subUnitOnOpen({ subUnit: 'section', subUnitPicked: true }, perFoot)).toEqual({ unit: 'section', picked: true, own: true })
    expect(subUnitOnOpen({ subUnit: 'section', subRate: 26 }, perFoot)).toEqual({ unit: 'section', picked: false, own: true })
  })
})

const data = { config: { pricing: perFoot }, inventory: [], kits: [] }
const req = (overrides: Record<string, unknown>) => ({
  fenceStyle: "WV-ND 6'x6' Privacy", runs: [{ ft: 120, rail: 'auto' as const }, { ft: 60, rail: 'auto' as const }], corners: 1, ends: 2, walkGates: 0, dblGates: 0,
  tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, overrides, jobType: 'new' as const,
})

describe('the quote builder\'s job (owner, office, the server for a Salesman, the website)', () => {
  test('a blank-rate quote saved per section is priced and saved per foot', () => {
    const j = quoteJobFor(data, req({ laborMode: 'subcontractor', subUnit: 'section' }), 30)
    expect(j.calc.sections).toBe(30)
    expect(j.totals.laborCost).toBe(180 * 5)
    // What it saves says how it was priced: per foot, nothing picked.
    expect(j.pricing).toMatchObject({ laborMode: 'subcontractor', subUnit: 'foot' })
    expect(j.pricing).not.toHaveProperty('subUnitPicked')
  })
  test('picked Section with no rate: no labor at a per foot rate, and the job says a rate is missing', () => {
    const j = quoteJobFor(data, req({ laborMode: 'subcontractor', subUnit: 'section', subUnitPicked: true }), 30)
    expect(j.totals.laborCost).toBe(0)
    expect(j.calc.priced.subRateMissing).toBe('Type the rate per section: Settings has $5 per foot.')
  })
  test('picked Section with a rate typed: priced and saved per section, still marked picked', () => {
    const j = quoteJobFor(data, req({ laborMode: 'subcontractor', subUnit: 'section', subUnitPicked: true, subRate: 24 }), 30)
    expect(j.totals.laborCost).toBe(30 * 24)
    expect(j.pricing).toMatchObject({ subUnit: 'section', subUnitPicked: true, subRate: 24 })
  })
  test('a typed rate is saved with the unit it was priced at', () => {
    const j = quoteJobFor(data, req({ laborMode: 'subcontractor', subUnit: 'section', subRate: 26 }), 30)
    expect(j.totals.laborCost).toBe(30 * 26)
    expect(j.pricing).toMatchObject({ subUnit: 'section', subRate: 26 })
  })

  test('the Salesman phone: a saved blank-rate quote per section is priced per foot on the server', () => {
    const existing = { id: 'q1', status: 'DRAFT', fenceStyle: "WV-ND 6'x6' Privacy", runs: [120, 60], pricing: { laborMode: 'subcontractor', subUnit: 'section' } }
    // The phone sends the builder's choices: Settings' unit, nothing picked.
    const sent = { ...req({ laborMode: 'subcontractor', subUnit: 'foot' }) }
    const r = requestFrom(sent, existing, () => null)
    expect(quoteJobFor(data, r.req, 30).totals.laborCost).toBe(180 * 5)
    // An older phone still sending the saved Section: Settings' unit all the same.
    const old = requestFrom({ ...sent, overrides: { laborMode: 'subcontractor', subUnit: 'section' } }, existing, () => null)
    expect(quoteJobFor(data, old.req, 30).totals.laborCost).toBe(180 * 5)
    // Section picked on her phone, no rate: kept, but there is no rate for a section (never $5 per section).
    const picked = requestFrom({ ...sent, overrides: { laborMode: 'subcontractor', subUnit: 'section', subUnitPicked: true } }, existing, () => null)
    expect(picked.req.overrides).toMatchObject({ subUnit: 'section', subUnitPicked: true })
    const pj = quoteJobFor(data, picked.req, 30)
    expect(pj.totals.laborCost).toBe(0)
    expect(pj.calc.priced.subRateMissing).toBe('Type the rate per section: Settings has $5 per foot.')
    expect(subRateMissingFor(data.config as any, pj.pricing, "WV-ND 6'x6' Privacy")).toBe('Type the rate per section: Settings has $5 per foot.')
  })
  test('the Salesman phone: a quote with its own rate keeps the rate and its unit', () => {
    const existing = { id: 'q2', status: 'DRAFT', fenceStyle: "WV-ND 6'x6' Privacy", runs: [120, 60], pricing: { laborMode: 'subcontractor', subUnit: 'section', subRate: 26 } }
    const r = requestFrom(req({ laborMode: 'subcontractor', subUnit: 'section' }), existing, () => null)
    expect(r.req.overrides).toMatchObject({ subRate: 26, subUnit: 'section' })
    expect(quoteJobFor(data, r.req, 30).totals.laborCost).toBe(30 * 26)
  })
  test('the Salesman phone: a new quote starts on Settings\' unit', () => {
    const r = requestFrom(req({ laborMode: 'subcontractor', subUnit: 'foot' }), null, () => null)
    const j = quoteJobFor(data, r.req, 30)
    expect(j.totals.laborCost).toBe(180 * 5)
    expect(j.pricing).toMatchObject({ subUnit: 'foot' })
    // Settings per section: the same new quote per section.
    const sec = { ...data, config: { pricing: { ...perFoot, subUnit: 'section', subRateByCategory: { Vinyl: 23 } } } }
    expect(quoteJobFor(sec, requestFrom(req({ laborMode: 'subcontractor', subUnit: 'section' }), null, () => null).req, 30).totals.laborCost).toBe(30 * 23)
  })
  test('the website\'s instant quote (lead and draft) starts on Settings\' unit', () => {
    expect(newQuoteOverrides({ pricing: perFoot } as any)).toMatchObject({ laborMode: 'subcontractor', subUnit: 'foot' })
    expect(newQuoteOverrides({ pricing: { ...perFoot, subUnit: 'section' } } as any)).toMatchObject({ subUnit: 'section' })
    expect(newQuoteOverrides({ pricing: perFoot } as any)).not.toHaveProperty('subUnitPicked')
  })
  test('the website draft saved before the change reopens on Settings\' unit (the price check reprices it the same)', () => {
    // A "Website Quote" draft saved while Settings said section: { laborMode, subUnit: 'section', priceMethod, ... }.
    const saved = { laborMode: 'subcontractor', subUnit: 'section', priceMethod: 'cost_factor', costFactor: 0.64, overheadPct: 30, wholeDollar: true, roundingCents: 12 }
    const r = requestFrom({ ...req({}), overrides: saved }, { id: 'w', status: 'DRAFT', pricing: saved }, () => null)
    expect(quoteJobFor(data, r.req, 30).totals.laborCost).toBe(180 * 5)
  })
})

describe('job costing (signed from now on): the sub units go with the rate', () => {
  const q = (pricing: Record<string, unknown>) => ({
    id: 'q', fenceStyle: "WV-ND 6'x6' Privacy", salesRep: '', runs: [120, 60], sections: 30,
    materialCost: 1000, laborCost: 900, tearOutCost: 0, totalCOGS: 1900, finalPrice: 4000, pullSheet: [], pricing, work: null,
  })
  const ctx = { inventory: [], pricing: perFoot, style: { name: "WV-ND 6'x6' Privacy", category: 'Vinyl' }, signedVia: 'app', signedAt: new Date('2026-10-30T15:00:00Z') }
  test('blank rate saved per section: per foot at Settings\' rate', () => {
    expect(quotedCostOf(q({ laborMode: 'subcontractor', subUnit: 'section' }), ctx).labor).toMatchObject({ subUnit: 'foot', subUnits: 180, subRateCostCents: 500 })
  })
  test('own rate or picked: its unit', () => {
    expect(quotedCostOf(q({ laborMode: 'subcontractor', subUnit: 'section', subRate: 26 }), ctx).labor).toMatchObject({ subUnit: 'section', subUnits: 30, subRateCostCents: 2600 })
    expect(quotedCostOf(q({ laborMode: 'subcontractor', subUnit: 'section', subUnitPicked: true }), ctx).labor).toMatchObject({ subUnit: 'section', subUnits: 30 })
  })
})

