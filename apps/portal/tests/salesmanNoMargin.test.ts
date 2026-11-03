/**
 * The Salesman never sees margin (Jonathan, Nov 2 2026): every reply she gets
 * leaves out margin, Target Profit, overhead, cost factor, gross margin, sub
 * rates and commission %; material and labor costs and every price stay (the
 * Oct 25 rule). What her phone sends back never loses the saved ones.
 */

import { describe, test, expect } from 'vitest'
import { redactCosts, restoreCosts, hidesMargin, hidesCosts, hideFor, isMarginKey, withoutHandCommission } from '../src/server/lib/costRedact'
import { keepSavedCosts } from '../src/server/lib/quotePricing'

const quote = {
  id: 'q1', finalPrice: 10069, materialCost: 3100.5, laborCost: 1720, tearOutCost: 0, totalCOGS: 4820.5, gmPct: 0.41,
  pricing: { costFactor: 0.56, overheadPct: 30, subRate: 6, commissionPct: 0.09, wholeDollar: true, priceMethod: 'cost_factor', commissionMode: 'included', targetProfitPct: 14 },
  pullSheet: [{ item: 'Post', qty: 10, unitCost: 13.5, total: 135 }],
  proposal: { options: [{ fenceStyle: 'WV', finalPrice: 10069, snapshot: { gmPct: 0.41, costFactor: 0.56, materialCost: 3100.5, targetMarginPct: 44 } }] },
}
const config = {
  pricing: { manHourRate: 25, overheadPct: 30, liveOverhead: { on: true }, overheadHistory: [{ month: '2026-10', pct: 25.6 }], subRateByCategory: { Vinyl: 5 }, subWalkGate: 10, commissionSalesman: 0.09, tearOutFence: 13.5, laborMode: 'subcontractor', subUnit: 'foot' },
  margins: { good: 0.396, warning: 0.27 },
  fenceStyles: [{ name: 'WV', margin: 0.56, targetProfitPct: 14, ownProfitPct: 16, subRate: 6, followed: { subRate: { value: 6 } }, sectionsPerMH: 1.2, pricePerFoot: 40 }],
  fenceCatalog: { materials: [{ key: 'vinyl', rateDefaults: { targetProfitPct: 15 } }] },
}
const keysOf = (v: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(v)) v.forEach(x => keysOf(x, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out) }
  return out
}

describe('the Salesman: costs yes, margin never', () => {
  test('only the Salesman', () => {
    expect(hidesMargin('sales_rep')).toBe(true)
    for (const r of ['super_admin', 'admin', 'manager', 'office_staff', 'field_crew']) expect(hidesMargin(r)).toBe(false)
    expect(hidesCosts('sales_rep')).toBe(false)
    expect(hideFor('sales_rep')).toEqual({ margin: true })
  })
  test('a quote: no margin, cost factor, overhead, sub rate or commission %; costs, the pull sheet and the price stay', () => {
    const out = redactCosts(quote, { margin: true }) as any
    const keys = keysOf(out)
    for (const k of ['gmPct', 'costFactor', 'overheadPct', 'subRate', 'commissionPct', 'targetProfitPct', 'targetMarginPct']) expect(keys.has(k), k).toBe(false)
    expect([out.finalPrice, out.materialCost, out.laborCost, out.totalCOGS]).toEqual([10069, 3100.5, 1720, 4820.5])
    expect(out.pullSheet[0]).toEqual({ item: 'Post', qty: 10, unitCost: 13.5, total: 135 })
    expect(out.pricing).toEqual({ wholeDollar: true, priceMethod: 'cost_factor' })  // commissionMode too (review Nov 3 2026)
    expect(out.proposal.options[0].snapshot).toEqual({ materialCost: 3100.5 })
  })
  test('Settings: no margin, Target Profit, overhead, sub rates, commission %, margin thresholds; the man hour rate and tear out stay', () => {
    const out = redactCosts(config, { margin: true }) as any
    expect([...keysOf(out)].filter(isMarginKey)).toEqual([])
    expect(out.margins).toBeUndefined()
    expect(out.pricing).toEqual({ manHourRate: 25, tearOutFence: 13.5, laborMode: 'subcontractor', subUnit: 'foot' })
    expect(out.fenceStyles[0]).toEqual({ name: 'WV', sectionsPerMH: 1.2, pricePerFoot: 40 })
    expect(out.fenceCatalog.materials[0]).toEqual({ key: 'vinyl' })
  })
  test('her hand edited commission is still only "set by hand"', () => {
    expect(redactCosts(withoutHandCommission({ pricing: { commissionHandCents: 50000 } }), { margin: true })).toEqual({ pricing: { commissionByHand: true } })
  })
})

describe('what her phone sends back keeps the saved margin', () => {
  test('a Settings record: each margin field put back as saved', () => {
    const sent = redactCosts(config, { margin: true })
    expect(restoreCosts(sent, config, { margin: true })).toEqual(config)
  })
  test('a quote saved without a price request (a note, a stage): cost factor, overhead, sub rate and commission % back as saved; gmPct left to the database', () => {
    const sent = redactCosts(quote, { margin: true }) as any
    const out = keepSavedCosts({ ...sent, notes: 'called back' }, quote, hideFor('sales_rep'))
    expect(out.pricing).toEqual(quote.pricing)
    expect('gmPct' in out).toBe(false)
    expect(out.proposal.options[0].snapshot.costFactor).toBe(0.56)
  })
})
