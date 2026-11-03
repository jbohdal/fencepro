/**
 * Jonathan, Nov 2 2026, margin audit: a quote is graded like with like: price
 * less cost against the Target Margin it was priced with (moneyTruth.ts).
 */
import { describe, test, expect } from 'vitest'
import { marginOnPrice, pricedTarget, quoteGrade, weightedTarget, withChangeOrders } from '../../web/src/moneyTruth'
import { afterCommission } from '../../web/src/salesmanCommission'
import { heldSavedNumbers } from '../../web/src/heldQuote'
import { marginCheck, fenceTargetMargin } from '../../web/src/quoteChecks'

// Today's Settings: overhead 36.9 + Target Profit 14 = 50.9.
const STYLES = [{ name: 'WV', margin: 0.491, targetProfitPct: 14 }, { name: 'Alum', margin: 0.511, targetProfitPct: 12 }, { name: 'Tan', margin: 0.491, targetProfitPct: 14, colorTargetProfitPct: 16 }]
const LOW = 0.489

describe('a quote is graded on price less cost against what it was priced with', () => {
  test('a Salesman quote at target shows as at target (Kristi Murphy: 35 after commission, 44.0 price less cost)', () => {
    const kristi = { finalPrice: 8914.27, totalCOGS: 4991.99, gmPct: 0.35, hasSalesman: true, fenceStyle: 'WV', pricing: { costFactor: 0.56, overheadPct: 30 } }
    const g = quoteGrade(kristi, STYLES, LOW)
    expect(g.margin).toBeCloseTo(0.44, 3)
    expect(g.target).toBeCloseTo(0.44, 6)
    expect(g.tone).toBe('good')
    expect(afterCommission(kristi)).toBe(0.35)
  })
  test('an old quote is graded on its own overhead, not today\'s', () => {
    const old = { finalPrice: 10000, totalCOGS: 5800, fenceStyle: 'Alum', pricing: { costFactor: 0.58, overheadPct: 30 } }
    expect(quoteGrade(old, STYLES, LOW)).toMatchObject({ tone: 'good' })
    expect(pricedTarget(old, STYLES, LOW)).toBeCloseTo(0.42, 6)
    // On today's 48.9 target the same quote would read 6.9 points under.
    expect(marginOnPrice(old)!).toBeLessThan(0.489 - 0.05)
  })
  test('a typed price saves no cost factor: its saved overhead + the style\'s Target Profit (Jaziel Ortiz: 41.86 against 44)', () => {
    const jaziel = { finalPrice: 12145, totalCOGS: 7061.44, gmPct: 0.44, fenceStyle: 'WV', pricing: { overheadPct: 30, finalPrice: 12145.78 } }
    const g = quoteGrade(jaziel, STYLES, LOW)
    expect(g.target).toBeCloseTo(0.44, 6)
    expect(g.margin).toBeCloseTo(0.4186, 4)
    expect(g.tone).toBe('near')
  })
  test('a color\'s own Target Profit counts; a repair\'s saved target wins; no record: today\'s style; unknown style: the lowest', () => {
    expect(pricedTarget({ fenceStyle: 'Tan', pricing: { overheadPct: 30 } }, STYLES, LOW)).toBeCloseTo(0.46, 6)
    expect(pricedTarget({ fenceStyle: 'WV', pricing: { costFactor: 0.56 }, work: { priced: { targetMarginPct: 50 } } }, STYLES, LOW)).toBeCloseTo(0.5, 6)
    expect(pricedTarget({ fenceStyle: 'WV', pricing: null }, STYLES, LOW)).toBeCloseTo(0.509, 6)
    expect(pricedTarget({ fenceStyle: 'Gone', pricing: { overheadPct: 30 } }, STYLES, LOW)).toBe(LOW)
  })
  test('no cost: no margin, no grade', () => {
    expect(quoteGrade({ finalPrice: 5000, totalCOGS: 0, fenceStyle: 'WV' }, STYLES, LOW)).toMatchObject({ margin: null, tone: 'none' })
  })
  test('a group\'s target is each quote\'s own, by price', () => {
    const t = weightedTarget(STYLES, [
      { finalPrice: 1000, totalCOGS: 560, fenceStyle: 'WV', pricing: { costFactor: 0.56 } },
      { finalPrice: 3000, totalCOGS: 1500, fenceStyle: 'WV', pricing: { costFactor: 0.5 } },
    ], LOW)
    expect(t).toBeCloseTo((1000 * 0.44 + 3000 * 0.5) / 4000, 6)
  })
  test('a change order adds to the contract, not to the signed work\'s margin', () => {
    const [q] = withChangeOrders([{ id: 'a', status: 'SOLD', finalPrice: 1000, totalCOGS: 560 }], [{ quoteId: 'a', changeOrderTotal: 500 }])
    expect(q.finalPrice).toBe(1500)
    expect(marginOnPrice(q)).toBeCloseTo(0.44, 6)
  })
  test('a held quote\'s margin is price less cost too: no commission shown in it', () => {
    expect(heldSavedNumbers({ finalPrice: 1000, totalCOGS: 560, gmPct: 0.35 }).marginPct).toBeCloseTo(0.44, 6)
  })
})

describe('the builder warning: under the quote\'s own fence\'s Target Margin (Jonathan, Nov 3 2026)', () => {
  // No dig: overhead 25.6 + Target Profit 14 = 39.6, the number the old fixed "good margin" sat at.
  const ND = { name: 'WV-ND', margin: 0.604, targetProfitPct: 14 }
  // Dig set with its own Target Profit on the fence (18): 25.6 + 18 = 43.6.
  const DS = { name: 'WV-DS', margin: 0.564, targetProfitPct: 14, ownProfitPct: 18 }
  // Tan follows its color's 16: 25.6 + 16 = 41.6.
  const TAN = { name: 'TV-ND', margin: 0.584, targetProfitPct: 14, colorTargetProfitPct: 16 }

  test('a quote priced right at its target does not warn, whole dollar rounding included', () => {
    expect(fenceTargetMargin(ND, 25.6)).toBeCloseTo(0.396, 9)
    expect(marginCheck(0.396, fenceTargetMargin(ND, 25.6), 9000)).toBeNull()
    for (const cogs of [1234.56, 5432.1, 7061.44, 333.33, 99.99]) {
      // Rounded down to the whole dollar: up to 99 cents under the exact target.
      const price = Math.floor(cogs / (1 - 0.396))
      expect(marginCheck((price - cogs) / price, fenceTargetMargin(ND, 25.6), price), String(cogs)).toBeNull()
    }
  })

  test('below its target warns, in words, at that fence\'s number', () => {
    expect(marginCheck(0.35, fenceTargetMargin(ND, 25.6), 5000)).toBe('Margin is 35.0% (price less cost), under this fence\'s 39.6% Target Margin (Overhead + Target Profit in Settings).')
    // $5 under the target price on a $6,622 quote: under, not rounding.
    const price = Math.floor(4000 / (1 - 0.396)) - 5
    expect(marginCheck((price - 4000) / price, 0.396, price)).toMatch(/^Margin is 39\.\d% \(price less cost\), under this fence's 39\.6% Target Margin/)
  })

  test('a fence with its own Target Profit is held to its own number', () => {
    const t = fenceTargetMargin(DS, 25.6)
    expect(t).toBeCloseTo(0.436, 9)
    // 41% is over the No dig 39.6 but under this fence's 43.6.
    expect(marginCheck(0.41, t, 8000)).toBe('Margin is 41.0% (price less cost), under this fence\'s 43.6% Target Margin (Overhead + Target Profit in Settings).')
    expect(marginCheck(0.436, t, 8000)).toBeNull()
  })

  test('a different fence\'s target: the same margin warns on one and not on the other', () => {
    expect(fenceTargetMargin(TAN, 25.6)).toBeCloseTo(0.416, 9)
    expect(marginCheck(0.40, fenceTargetMargin(ND, 25.6), 7000)).toBeNull()
    expect(marginCheck(0.40, fenceTargetMargin(TAN, 25.6), 7000)).toMatch(/under this fence's 41\.6% Target Margin/)
  })

  test('at the overhead the quote is priced at; a move or repair at Overhead + Repair Profit', () => {
    expect(fenceTargetMargin(ND, 30)).toBeCloseTo(0.44, 9)
    expect(fenceTargetMargin(ND, 25.6, { repairProfitPct: 20 })).toBeCloseTo(0.456, 9)
    expect(fenceTargetMargin(ND, 25.6, { repairProfitPct: null })).toBeCloseTo(0.396, 9)
    expect(marginCheck(0.44, 0.456, 3000, 'Overhead + Repair Profit')).toMatch(/45\.6% Target Margin \(Overhead \+ Repair Profit in Settings\)/)
    // A style with no Target Profit on record: its Target Margin as Settings resolved it.
    expect(fenceTargetMargin({ margin: 0.6 }, 25.6)).toBeCloseTo(0.4, 9)
  })

  test('a Salesman quote at target does not: price less cost 44, 35 after commission', () => {
    expect(marginCheck(0.44, fenceTargetMargin(ND, 30), 5000)).toBeNull()
  })
})
