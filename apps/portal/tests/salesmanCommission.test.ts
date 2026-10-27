/**
 * Jonathan, Oct 27 2026: "Commission: 9% on by default for Christa's quotes.
 * It comes out of the price; the customer price never changes. Hidden from
 * her view of costs as before." (web/src/salesmanCommission.ts, the quote
 * builder's "Salesman on this job?" switch.)
 */
import { describe, test, expect } from 'vitest'
import { salesmanSwitchDefault, seesCommission, isSalesmanName, isFreshQuote } from '../../web/src/salesmanCommission'
import { calculatePrice, type PriceInputs, type PricingSettings, type StylePricing } from '../../web/src/pricingEngine'
import { seesCosts } from '../../web/src/moveRepair'

const TEAM = [
  { name: 'Jonathan Bohdal', role: 'super_admin' },
  { name: 'Christa Feagin', role: 'sales_rep' },
  { name: 'Pat Office', role: 'office_staff' },
]

describe('"Salesman on this job?" starts on for a Salesman\'s new quote', () => {
  test('a new quote made by a Salesman login: on', () => {
    expect(salesmanSwitchDefault(null, 'sales_rep', TEAM)).toBe(true)
    expect(salesmanSwitchDefault({ id: undefined, hasSalesman: false, salesRep: '' }, 'sales_rep', TEAM)).toBe(true)
  })
  test('the owner and the office keep off for their own new quotes', () => {
    for (const role of ['super_admin', 'admin', 'manager', 'office_staff']) {
      expect(salesmanSwitchDefault(null, role, TEAM)).toBe(false)
      expect(salesmanSwitchDefault({ hasSalesman: false, salesRep: 'Jonathan Bohdal' }, role, TEAM)).toBe(false)
    }
  })
  test('a new quote for a customer whose sales rep is a Salesman: on, whoever makes it', () => {
    expect(salesmanSwitchDefault({ hasSalesman: false, salesRep: '  christa  feagin ' }, 'super_admin', TEAM)).toBe(true)
    expect(salesmanSwitchDefault({ hasSalesman: false, salesRep: 'Pat Office' }, 'office_staff', TEAM)).toBe(false)
    expect(isSalesmanName('Someone Gone', TEAM)).toBe(false)
    expect(isSalesmanName('', TEAM)).toBe(false)
  })
  test('a saved quote opens as it was saved (its price and commission stay)', () => {
    const saved = { id: 'q1', status: 'SENT', hasSalesman: false, salesRep: 'Christa Feagin', shareToken: 't' }
    expect(salesmanSwitchDefault(saved, 'sales_rep', TEAM)).toBe(false)
    expect(salesmanSwitchDefault({ ...saved, hasSalesman: true }, 'super_admin', TEAM)).toBe(true)
    // A draft someone on staff saved with the switch off stays off.
    expect(salesmanSwitchDefault({ id: 'q2', status: 'DRAFT', hasSalesman: false, salesRep: '' }, 'sales_rep', TEAM)).toBe(false)
  })
  test('the website\'s draft, not sent yet, counts as new; once sent it keeps its own', () => {
    const web = { id: 'w1', status: 'DRAFT', hasSalesman: false, salesRep: '', layout: { widgetDrawing: {} } }
    expect(isFreshQuote(web)).toBe(true)
    expect(salesmanSwitchDefault(web, 'sales_rep', TEAM)).toBe(true)
    expect(salesmanSwitchDefault(web, 'super_admin', TEAM)).toBe(false)
    expect(salesmanSwitchDefault({ ...web, shareToken: 'tok' }, 'sales_rep', TEAM)).toBe(false)
    expect(salesmanSwitchDefault({ ...web, status: 'SOLD' }, 'sales_rep', TEAM)).toBe(false)
  })
})

describe('the commission is hidden from the Salesman', () => {
  test('owner, admin, manager and office see it; the Salesman and the Installer do not', () => {
    for (const role of ['super_admin', 'admin', 'manager', 'office_staff']) expect(seesCommission(role, seesCosts(role))).toBe(true)
    expect(seesCosts('sales_rep')).toBe(true)            // she still sees costs (Oct 25 2026)
    expect(seesCommission('sales_rep', seesCosts('sales_rep'))).toBe(false)
    expect(seesCommission('field_crew', seesCosts('field_crew'))).toBe(false)
    expect(seesCommission(null, false)).toBe(false)
  })
})

describe('9% commission comes out of the price: the customer price never changes', () => {
  // Live's Settings (Oct 27 2026): Salesman 9%, non-salesman 0, commission taken out of the price.
  const pricing: PricingSettings = {
    manHourRate: 25, commissionSalesman: 0.09, commissionNonSalesman: 0, tearOutFence: 13.5, tearOutGate: 27,
    laborMode: 'subcontractor', subUnit: 'section', subRateDefault: 0, subRateByCategory: { Vinyl: 24 },
    subWalkGate: 10, subDblGate: 20, priceMethod: 'cost_factor', commissionMode: 'included',
  }
  const vinyl: StylePricing = { category: 'Vinyl', margin: 0.56, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 }
  const job: PriceInputs = {
    sections: 25, footage: 150, walkGates: 1, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
    materialCost: 3000, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0, style: vinyl, pricing,
  }

  test('ticked or not, same price; the 9% is a cost out of the margin', () => {
    const off = calculatePrice(job)
    const on = calculatePrice({ ...job, hasSalesman: true })
    expect(on.price).toBe(off.price)
    expect(on.totalCOGS).toBe(off.totalCOGS)
    expect(on.commissionPct).toBe(0.09)
    expect(on.commissionAmt).toBeCloseTo(on.priceBeforeAdjustment * 0.09, 2)
    expect(on.grossMargin).toBeCloseTo(off.grossMargin - on.commissionAmt, 2)
    // 3000 + 25 × 24 + 10 = 3610 cost; ÷ 0.56 = 6446.43, whole dollar 6446.
    expect(on.price).toBe(6446)
  })
  test('with the slider and a typed final price, still the same price', () => {
    for (const extra of [{ priceAdjust: 0.05 }, { priceAdjust: -0.03 }]) {
      expect(calculatePrice({ ...job, ...extra, hasSalesman: true }).price).toBe(calculatePrice({ ...job, ...extra }).price)
    }
    const typed = { ...job, overrides: { finalPrice: 7000 } }
    expect(calculatePrice({ ...typed, hasSalesman: true }).price).toBe(7000)
    expect(calculatePrice(typed).price).toBe(7000)
  })
})
