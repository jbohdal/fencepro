/**
 * Pricing engine — labor modes, price methods, commission modes, overrides.
 *
 * The engine lives in the web app (apps/web/src/pricingEngine.ts) and is pure,
 * so it is tested here alongside the other calculator tests.
 */
import { describe, test, expect } from 'vitest'
import { calculatePrice, resolveSubRate, cleanOverrides } from '../../web/src/pricingEngine'
import type { PriceInputs, PricingSettings, StylePricing } from '../../web/src/pricingEngine'

const pricing: PricingSettings = {
  manHourRate: 22,
  commissionSalesman: 0.10,
  commissionNonSalesman: 0,
  tearOutFence: 9.5,
  tearOutGate: 27,
}

const vinyl: StylePricing = { category: 'Vinyl', margin: 0.64, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 }

const job: PriceInputs = {
  sections: 25,
  footage: 150,
  walkGates: 1,
  dblGates: 1,
  tearOutSections: 0,
  tearOutGates: 0,
  materialCost: 3000,
  extraLaborHrs: 0,
  hasSalesman: false,
  priceAdjust: 0,
  style: vinyl,
  pricing,
}

describe('defaults reproduce the original EZ Biz quote math', () => {
  test('hourly labor, cost ÷ magic number, no commission', () => {
    const r = calculatePrice(job)
    const mh = 25 / 1.2 + 2.4 + 4.8
    expect(r.laborMode).toBe('hourly')
    expect(r.manHours).toBeCloseTo(mh, 6)
    expect(r.laborCost).toBeCloseTo(mh * 22, 2)
    expect(r.totalCOGS).toBeCloseTo(3000 + mh * 22, 2)
    expect(r.price).toBeCloseTo((3000 + mh * 22) / 0.64, 2)
    expect(r.commissionAmt).toBe(0)
    expect(r.gmPct).toBeCloseTo(0.36, 4)
  })

  test('salesman commission comes out of the price by default', () => {
    const r = calculatePrice({ ...job, hasSalesman: true })
    const noComm = calculatePrice(job)
    expect(r.price).toBe(noComm.price)
    expect(r.commissionAmt).toBeCloseTo(r.price * 0.10, 2)
    expect(r.gmPct).toBeCloseTo(0.26, 4)
  })

  test('price adjust slider scales the price', () => {
    const base = calculatePrice(job)
    const up = calculatePrice({ ...job, priceAdjust: 0.10 })
    expect(up.price).toBeCloseTo(base.price * 1.10, 1)
  })

  test('tear out is costed from Settings', () => {
    const r = calculatePrice({ ...job, tearOutSections: 10, tearOutGates: 2 })
    expect(r.tearOutCost).toBeCloseTo(10 * 9.5 + 2 * 27, 2)
  })
})

describe('subcontractor labor', () => {
  const sub: PricingSettings = {
    ...pricing,
    laborMode: 'subcontractor',
    subUnit: 'foot',
    subRateDefault: 6,
    subRateByCategory: { Vinyl: 8 },
    subWalkGate: 50,
    subDblGate: 90,
    subTearOutSection: 3,
    subTearOutGate: 10,
  }

  test('rate resolves quote → style → category → default', () => {
    expect(resolveSubRate({ ...vinyl, subRate: 9 }, sub, 11)).toBe(11)
    expect(resolveSubRate({ ...vinyl, subRate: 9 }, sub)).toBe(9)
    expect(resolveSubRate(vinyl, sub)).toBe(8)
    expect(resolveSubRate({ ...vinyl, category: 'Chainlink' }, sub)).toBe(6)
    expect(resolveSubRate(undefined, pricing)).toBe(0)
  })

  test('per foot rate + gates + tear out', () => {
    const r = calculatePrice({ ...job, pricing: sub, tearOutSections: 4, tearOutGates: 1 })
    expect(r.laborMode).toBe('subcontractor')
    expect(r.laborCost).toBeCloseTo(150 * 8 + 50 + 90 + 4 * 3 + 10, 2)
    // man hours are still projected for scheduling
    expect(r.manHours).toBeGreaterThan(0)
  })

  test('per section rate', () => {
    const r = calculatePrice({ ...job, pricing: { ...sub, subUnit: 'section' }, style: { ...vinyl, subRate: 40 } })
    expect(r.laborCost).toBeCloseTo(25 * 40 + 50 + 90, 2)
  })

  test('extra hours are billed at the man hour rate on top of sub pay', () => {
    const r = calculatePrice({ ...job, pricing: sub, extraLaborHrs: 3 })
    expect(r.laborCost).toBeCloseTo(150 * 8 + 50 + 90 + 3 * 22, 2)
  })

  test('a quote can switch a subcontractor default back to hourly', () => {
    const r = calculatePrice({ ...job, pricing: sub, overrides: { laborMode: 'hourly' } })
    expect(r.laborMode).toBe('hourly')
    expect(r.laborCost).toBeCloseTo((25 / 1.2 + 2.4 + 4.8) * 22, 2)
  })

  test('missing rate is reported, never silent', () => {
    const r = calculatePrice({ ...job, pricing: { ...pricing, laborMode: 'subcontractor' } })
    expect(r.laborCost).toBe(0)
    expect(r.notes.join(' ')).toMatch(/No subcontractor rate/)
  })

  test('flat labor override replaces calculated labor in either mode', () => {
    const r = calculatePrice({ ...job, pricing: sub, overrides: { laborCost: 1234 } })
    expect(r.laborMode).toBe('flat')
    expect(r.laborCost).toBe(1234)
  })
})

describe('price methods', () => {
  test('per foot price ignores cost for the price but still reports margin', () => {
    const r = calculatePrice({ ...job, style: { ...vinyl, pricePerFoot: 32 }, pricing: { ...pricing, priceMethod: 'per_foot' } })
    expect(r.priceMethod).toBe('per_foot')
    expect(r.price).toBe(150 * 32)
    expect(r.grossMargin).toBeCloseTo(4800 - r.totalCOGS, 2)
    expect(r.pricePerFoot).toBe(32)
  })

  test('per foot with no price set falls back to cost and says so', () => {
    const r = calculatePrice({ ...job, pricing: { ...pricing, priceMethod: 'per_foot' } })
    expect(r.priceMethod).toBe('cost_factor')
    expect(r.price).toBeCloseTo(r.totalCOGS / 0.64, 1)
    expect(r.notes.join(' ')).toMatch(/No per foot price/)
  })

  test('magic number override on the quote', () => {
    const r = calculatePrice({ ...job, overrides: { costFactor: 0.5 } })
    expect(r.price).toBeCloseTo(r.totalCOGS / 0.5, 1)
  })

  test('manual final price wins over everything, slider included', () => {
    const r = calculatePrice({ ...job, priceAdjust: 0.2, overrides: { finalPrice: 7000 } })
    expect(r.priceMethod).toBe('manual')
    expect(r.price).toBe(7000)
    expect(r.gmPct).toBeCloseTo((7000 - r.totalCOGS) / 7000, 6)
  })
})

describe('commission modes', () => {
  test('added: price is grossed up so the company nets the same', () => {
    const noComm = calculatePrice(job)
    const added = calculatePrice({ ...job, hasSalesman: true, pricing: { ...pricing, commissionMode: 'added' } })
    expect(added.price).toBeCloseTo(noComm.price / 0.9, 1)
    expect(added.price - added.commissionAmt).toBeCloseTo(noComm.price, 1)
  })

  test('commission percent comes from Settings, not a constant', () => {
    const r = calculatePrice({ ...job, hasSalesman: true, pricing: { ...pricing, commissionSalesman: 0.07 } })
    expect(r.commissionPct).toBe(0.07)
    expect(r.commissionAmt).toBeCloseTo(r.price * 0.07, 2)
  })
})

describe('edge cases', () => {
  test('no style: no labor, price from material only', () => {
    const r = calculatePrice({ ...job, style: undefined })
    expect(r.manHours).toBe(0)
    expect(r.price).toBeCloseTo(3000 / 0.64, 2)
  })

  test('empty job prices at zero without NaN', () => {
    const r = calculatePrice({ ...job, sections: 0, footage: 0, walkGates: 0, dblGates: 0, materialCost: 0 })
    expect(r.price).toBe(0)
    expect(r.gmPct).toBe(0)
    expect(r.pricePerFoot).toBe(0)
  })

  test('cleanOverrides keeps only what is set', () => {
    expect(cleanOverrides({ laborMode: 'hourly', subRate: undefined, finalPrice: NaN })).toEqual({ laborMode: 'hourly' })
    expect(cleanOverrides({})).toBeUndefined()
    expect(cleanOverrides(null)).toBeUndefined()
  })
})
