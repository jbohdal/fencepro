/**
 * Jonathan, Nov 2 2026: "Commission only applies when an actual Salesman
 * (Christa or another salesman login) is the rep." (lib/commissionRule.ts, web
 * salesmanCommission.ts, pricingEngine.ts.)
 */
import { describe, test, expect } from 'vitest'
import { repNamesSalesman, withoutCommission, gmPctAtSigning, carriesCommission } from '../src/server/lib/commissionRule'
import { calculatePrice, type PriceInputs, type PricingSettings } from '../../web/src/pricingEngine'
import { isSalesmanRep, repRulesOutCommission, salesmanSwitchDefault } from '../../web/src/salesmanCommission'

const LOGINS = [{ firstName: 'Christa', lastName: 'Feagin' }]
const TEAM = [{ name: 'Jonathan Bohdal', role: 'super_admin' }, { name: 'Christa Feagin', role: 'sales_rep' }, { name: 'Pat Office', role: 'office_staff' }]

describe('who counts as a Salesman rep', () => {
  test('a Salesman login: full name, first name, initials, any spacing', () => {
    for (const rep of ['Christa Feagin', 'christa  feagin ', 'Christa ', 'CF']) {
      expect(repNamesSalesman(rep, LOGINS), rep).toBe(true)
      expect(isSalesmanRep(rep, TEAM), rep).toBe(true)
      expect(repRulesOutCommission(rep, TEAM), rep).toBe(false)
    }
  })
  test('owner, office, Jb, blank: no', () => {
    for (const rep of ['Jonathan Bohdal', 'Jb', 'Pat Office', '', '   ', null]) expect(repNamesSalesman(rep, LOGINS), String(rep)).toBe(false)
    for (const rep of ['Jonathan Bohdal', 'Jb', 'Pat Office', '', null]) expect(repRulesOutCommission(rep, TEAM), String(rep)).toBe(true)
  })
})

describe('the builder\'s switch', () => {
  const saved = { id: 'q', status: 'SENT', hasSalesman: true }
  test('a saved quote keeps it only with a Salesman as the rep', () => {
    expect(salesmanSwitchDefault({ ...saved, salesRep: 'Christa Feagin' }, 'super_admin', TEAM)).toBe(true)
    expect(salesmanSwitchDefault({ ...saved, salesRep: 'Jonathan Bohdal' }, 'super_admin', TEAM)).toBe(false)
    expect(salesmanSwitchDefault({ ...saved, salesRep: '' }, 'super_admin', TEAM)).toBe(false)
  })
  test('a real Salesman written by first name or initials keeps it: never stripped', () => {
    for (const salesRep of ['Christa', 'christa ', 'CF', 'cf', 'Christa  Feagin']) expect(salesmanSwitchDefault({ ...saved, salesRep }, 'super_admin', TEAM), salesRep).toBe(true)
  })
  test('a signed quote keeps its own: only a logged fix changes it', () => {
    expect(salesmanSwitchDefault({ ...saved, status: 'SOLD', salesRep: '' }, 'super_admin', TEAM)).toBe(true)
  })
})

describe('the price', () => {
  const pricing: PricingSettings = { manHourRate: 25, commissionSalesman: 0.09, commissionNonSalesman: 0.05, commissionMode: 'included' } as any
  const input = (over: Partial<PriceInputs>): PriceInputs => ({
    sections: 30, footage: 180, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, materialCost: 5000, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
    style: { name: 'WV', margin: 0.56, sectionsPerMH: 1.5 } as any, pricing, overrides: {}, ...over,
  })
  test('commission included: the customer price is the same with it on or off; only the margin moves', () => {
    const on = calculatePrice(input({ hasSalesman: true })), off = calculatePrice(input({ hasSalesman: false }))
    expect(off.price).toBe(on.price)
    expect(off.totalCOGS).toBe(on.totalCOGS)
    expect(on.commissionAmt).toBeGreaterThan(0)
    expect(off.commissionAmt).toBe(0)
    expect(off.gmPct).toBeCloseTo((off.price - off.totalCOGS) / off.price, 6)
  })
  test('with no Salesman: $0, whatever Settings or the quote hold', () => {
    expect(calculatePrice(input({})).commissionPct).toBe(0)
    expect(calculatePrice(input({ overrides: { commissionPct: 0.09 } })).commissionAmt).toBe(0)
  })
  test('a Salesman quote does not move', () => {
    const on = calculatePrice(input({ hasSalesman: true }))
    expect(on.commissionPct).toBe(0.09)
    expect(on.gmPct).toBeCloseTo((on.price - on.totalCOGS - on.commissionAmt) / on.price, 6)
  })
})

describe('taking commission off a saved quote', () => {
  const opt = (fenceStyle: string, finalPrice: number, totalCOGS: number, gmPct: number) => ({ label: fenceStyle, fenceStyle, finalPrice, perFoot: 12, sections: 33, tier: { key: 'b', label: 'Better', blurb: 'x' }, snapshot: { totalCOGS, gmPct, materialCost: 1, pullSheet: [{ item: 'p' }] } })
  const q = { finalPrice: 8914.27, totalCOGS: 4991.99, hasSalesman: true, pricing: { costFactor: 0.56, overheadPct: 30, commissionPct: 0.09 }, proposal: { terms: ['t'], options: [opt('A', 8914.27, 4991.99, 0.35), opt('B', 7000, 4000, 0.3)] } }
  test('switch off, margin is price less cost, the quote\'s own commission gone', () => {
    const out = withoutCommission(q)
    expect(out.hasSalesman).toBe(false)
    expect(out.gmPct).toBeCloseTo(0.44, 3)
    expect(out.pricing).toEqual({ costFactor: 0.56, overheadPct: 30 })
    expect(carriesCommission({ ...q, ...out })).toBe(false)
  })
  test('never a price, a cost or a word a customer reads', () => {
    const out = withoutCommission(q) as any
    expect(Object.keys(out).sort()).toEqual(['gmPct', 'hasSalesman', 'pricing', 'proposal'])
    const sees = (p: any) => JSON.stringify(p.options.map(({ snapshot: _s, ...o }: any) => o))
    expect(sees(out.proposal)).toBe(sees(q.proposal))
    expect(out.proposal.terms).toEqual(['t'])
    expect(out.proposal.options[0].snapshot.gmPct).toBeCloseTo(0.44, 3)
    expect(out.proposal.options[1].snapshot.gmPct).toBeCloseTo(3000 / 7000, 6)
    expect(out.proposal.options[1].snapshot.totalCOGS).toBe(4000)
  })
  test('a move\'s or repair\'s saved commission goes to the margin', () => {
    const out = withoutCommission({ finalPrice: 1000, totalCOGS: 500, work: { type: 'repair', description: 'd', priced: { commissionCents: 9000, grossMarginCents: 41000, priceCents: 100000 } } }) as any
    expect(out.work.priced).toEqual({ commissionCents: 0, grossMarginCents: 50000, priceCents: 100000 })
    expect(out.work.description).toBe('d')
  })
})

describe('the margin saved at signing', () => {
  const own = { fenceStyle: 'WV', finalPrice: 12145, totalCOGS: 7061.44, gmPct: 0.41856 }
  test('a typed price, no commission: the true margin, not the list price\'s (Jaziel Ortiz: 44.00 → 41.86)', () => {
    expect(gmPctAtSigning(own, { fenceStyle: 'WV', finalPrice: 12145 }, { totalCOGS: 7061.44, gmPct: 0.44 })).toBeCloseTo(0.41856, 4)
  })
  test('a typed price with a Salesman: the commission saved on the quote stays out', () => {
    const q = { ...own, hasSalesman: true, gmPct: 0.33 }
    expect(gmPctAtSigning(q, { fenceStyle: 'WV', finalPrice: 12145 }, { totalCOGS: 7061.44, gmPct: 0.35 })).toBeCloseTo(0.33, 6)
  })
  test('another option of a Salesman quote stays as priced', () => {
    const q = { ...own, hasSalesman: true, gmPct: 0.33 }
    expect(gmPctAtSigning(q, { fenceStyle: 'Tan', finalPrice: 13000 }, { totalCOGS: 7300, gmPct: 0.35 })).toBe(0.35)
  })
  test('another option of a quote with no commission: price less cost', () => {
    expect(gmPctAtSigning(own, { fenceStyle: 'Tan', finalPrice: 10000 }, { totalCOGS: 5600, gmPct: 0.35 })).toBeCloseTo(0.44, 6)
  })
})
