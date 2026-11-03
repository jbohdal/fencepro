/**
 * A discount below the minimum job price (Jonathan, Nov 2 2026): "block it and
 * warn the salesman. Owner can override." The question the quote builder and
 * the server both ask, without a database (the routes:
 * discountMinimum.db.test.ts). Nothing here changes a price.
 */

import { describe, test, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import { jobMinimumCents, pricesUnderMinimum, newlyUnderMinimum, underMinimumWarning } from '../../web/src/discountMinimum'
import { priceOption } from '../../web/src/proposal'
import type { QuoteCalcInput, QuoteStyle } from '../../web/src/quoteCalc'
import { setMaterialPriceSource, priceSourceFromMap } from '../../web/src/materialCalculator'
import { DEFAULT_RAIL_OPTIMIZER_SETTINGS } from '../../web/src/railOptimizer'
import { can } from '../src/server/lib/permissions'

const MIN = 35000
const option = (fenceStyle: string, finalPrice: number, extra = {}) => ({ fenceStyle, label: fenceStyle, finalPrice, ...extra })

describe('which minimum', () => {
  test('moves and repairs always; a new fence only when Settings apply it to new fences', () => {
    expect(jobMinimumCents({ moveRepair: { minimumJobCents: 35000, minimumAppliesToNew: true } }, false)).toBe(35000)
    expect(jobMinimumCents({ moveRepair: { minimumJobCents: 35000, minimumAppliesToNew: false } }, false)).toBe(0)
    expect(jobMinimumCents({ moveRepair: { minimumJobCents: 35000, minimumAppliesToNew: false } }, true)).toBe(35000)
  })

  test('in whole dollars, as the prices are: a $350.50 minimum prices at $350, and $350 is not under it', () => {
    const cents = jobMinimumCents({ moveRepair: { minimumJobCents: 35050, minimumAppliesToNew: true } }, true)
    expect(cents).toBe(35000)
    expect(pricesUnderMinimum({ fenceStyle: 'A', finalPrice: 350 }, cents)).toEqual([])
  })
})

describe('prices under the minimum', () => {
  test('$350 even is not under; $349 is; $0 (nothing priced yet) is not', () => {
    expect(pricesUnderMinimum({ fenceStyle: 'A', finalPrice: 350 }, MIN)).toEqual([])
    expect(pricesUnderMinimum({ fenceStyle: 'A', finalPrice: 349 }, MIN).map(u => u.priceCents)).toEqual([34900])
    expect(pricesUnderMinimum({ fenceStyle: 'A', finalPrice: 0 }, MIN)).toEqual([])
  })

  test('no minimum: nothing is under it', () => {
    expect(pricesUnderMinimum({ fenceStyle: 'A', finalPrice: 100 }, 0)).toEqual([])
  })

  test('the quote\'s own price and its own option are one price; every other option is its own', () => {
    const under = pricesUnderMinimum({ fenceStyle: 'A', finalPrice: 300, proposal: { options: [option('A', 300, { tier: { label: 'Better' } }), option('B', 250, { tier: { label: 'Good' } }), option('C', 900)] } }, MIN)
    expect(under.map(u => [u.name, u.priceCents, u.own])).toEqual([['Better', 30000, true], ['Good', 25000, false]])
  })

  test('a quote with its own price under and no option of its own still counts', () => {
    expect(pricesUnderMinimum({ fenceStyle: 'A', finalPrice: 300 }, MIN)).toEqual([{ key: '(quote)', name: '', priceCents: 30000, own: true }])
  })

  test('a repair\'s "New fence instead" option: the minimum does not lift it, so it is not held to it', () => {
    expect(pricesUnderMinimum({ fenceStyle: 'A', finalPrice: 400, proposal: { options: [option('A', 400), { fenceStyle: 'A', label: 'New fence instead: A', finalPrice: 200 }] } }, MIN)).toEqual([])
  })
})

describe('new or lower than saved', () => {
  const saved = { fenceStyle: 'A', finalPrice: 300, proposal: { options: [option('A', 300), option('B', 320)] } }

  test('a new quote: every price under it', () => {
    expect(newlyUnderMinimum(saved, null, MIN).map(u => u.priceCents)).toEqual([30000, 32000])
  })

  test('an old quote saved again as it is: left alone', () => {
    expect(newlyUnderMinimum(saved, saved, MIN)).toEqual([])
  })

  test('a smaller discount on it: left alone; a bigger one: held', () => {
    expect(newlyUnderMinimum({ ...saved, finalPrice: 310, proposal: { options: [option('A', 310), option('B', 330)] } }, saved, MIN)).toEqual([])
    expect(newlyUnderMinimum({ ...saved, finalPrice: 290, proposal: { options: [option('A', 290), option('B', 320)] } }, saved, MIN).map(u => u.priceCents)).toEqual([29000])
  })

  test('a price that was over the minimum and goes under: held', () => {
    const was = { fenceStyle: 'A', finalPrice: 500, proposal: { options: [option('A', 500)] } }
    expect(newlyUnderMinimum({ ...was, finalPrice: 300, proposal: { options: [option('A', 300)] } }, was, MIN).map(u => u.priceCents)).toEqual([30000])
  })

  test('an option added under the minimum: held, though the rest stands', () => {
    expect(newlyUnderMinimum({ ...saved, proposal: { options: [...saved.proposal.options, option('C', 300)] } }, saved, MIN).map(u => u.key)).toEqual(['C|C'])
  })

  test('an old quote with no proposal, saved with one at the same price: left alone', () => {
    expect(newlyUnderMinimum({ fenceStyle: 'A', finalPrice: 250, proposal: { options: [option('A', 250)] } }, { fenceStyle: 'A', finalPrice: 250, proposal: null }, MIN)).toEqual([])
  })
})

describe('the words', () => {
  const one = [{ key: 'k', name: 'Good', priceCents: 30000, own: false }]
  const dashes = /[—–]| - /

  test('the Salesman: why, the minimum, what to do; no dashes', () => {
    const w = underMinimumWarning(one, MIN, false)
    expect(w).toBe('This cannot be saved. Good would be $300, under the $350 minimum job price. Take less off, or ask Jonathan.')
    expect(w).not.toMatch(dashes)
  })

  test('the owner: can save it anyway', () => {
    const w = underMinimumWarning(one, MIN, true)
    expect(w).toBe('Good would be $300, under the $350 minimum job price. As the owner you can save it anyway.')
    expect(w).not.toMatch(dashes)
  })

  test('several options, and the quote\'s own price; cents only when there are any', () => {
    expect(underMinimumWarning([{ key: 'q', name: '', priceCents: 29750, own: true }, ...one, { key: 'b', name: 'Best', priceCents: 34000, own: false }], MIN, false))
      .toBe('This cannot be saved. The price would be $297.50, Good would be $300 and Best would be $340, under the $350 minimum job price. Take less off, or ask Jonathan.')
  })
})

describe('who may go under', () => {
  test('the owner only: not an admin, a manager, the office or a Salesman', () => {
    expect(can('super_admin', 'quotes.underMinimum')).toBe(true)
    for (const role of ['admin', 'manager', 'office_staff', 'sales_rep', 'field_crew']) expect(can(role, 'quotes.underMinimum')).toBe(false)
  })
})

describe('on the real quote math', () => {
  const prices = JSON.parse(fs.readFileSync(new URL('./fixtures/inventory-prices-2026-10-14.json', import.meta.url), 'utf8'))
  beforeAll(() => setMaterialPriceSource(priceSourceFromMap(prices)))
  afterAll(() => setMaterialPriceSource(null))
  const style: QuoteStyle = { name: 'Small', category: 'Vinyl', margin: 0.58, sectionsPerMH: 1.2, mhPerWalkGate: 2.4, mhPerDblGate: 4.8 } as QuoteStyle
  const input = (overrides = {}): QuoteCalcInput => ({
    style, runs: [{ ft: 1 }], corners: 0, ends: 0, walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0, extraLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
    pricing: { laborMode: 'hourly', manHourRate: 25, commissionSalesman: 0.1, commissionNonSalesman: 0, tearOutFence: 9.5, tearOutGate: 27 } as QuoteCalcInput['pricing'], optimizer: DEFAULT_RAIL_OPTIMIZER_SETTINGS, minimumCents: MIN, overrides,
  })

  test('lifted to the minimum with no discount: at the minimum, so not under it, and left alone', () => {
    const o = priceOption(input(), style)
    expect(o.minimumLifted).toBe(true)
    expect(o.finalPrice).toBe(350)
    expect(pricesUnderMinimum({ fenceStyle: 'Small', finalPrice: o.finalPrice, proposal: { options: [o] } }, MIN)).toEqual([])
  })

  test('$50 off a lifted job goes under it, and the check does not change the price', () => {
    const o = priceOption(input({ priceAdjustmentCents: -5000 }), style)
    expect(o.finalPrice).toBe(300)
    expect(o.adjustmentCents).toBe(-5000)
    const before = JSON.stringify(o)
    expect(pricesUnderMinimum({ fenceStyle: 'Small', finalPrice: o.finalPrice, proposal: { options: [o] } }, MIN).map(u => u.priceCents)).toEqual([30000])
    expect(JSON.stringify(o)).toBe(before)
  })
})
