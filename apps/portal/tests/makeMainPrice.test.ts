/**
 * Make main prices the new main option as its card showed (review Nov 2 2026: a saved vinyl draft's aluminum card read
 * $15,250, Make main priced it $15,755 at vinyl's 0.604). The rule (proposal.ts); makeMainPrice.db.test.ts proves it
 * on the dev database's Settings and the server's Salesman path.
 */

import { describe, test, expect } from 'vitest'
import { mainPricingCleared, pricingForMain, costChoicesForMain } from '../../web/src/proposal'

const VINYL = { name: "WV-ND 6'x6' Privacy", category: 'Vinyl' }
const VINYL_DS = { name: "WV-DS 6'x6' Privacy", category: 'Vinyl' }
const ALUM = { name: 'Alum - ND - Emily - 48', category: 'Aluminum' }
const CHAIN = { name: "CL - 4' Galv", category: 'Chainlink' }
const opened = { costFactor: '0.604', finalPrice: '', laborCost: '', subRate: '', pricePerFoot: '' }

describe('what Make main takes off', () => {
  test('the same style: nothing', () => expect(mainPricingCleared(VINYL, VINYL)).toEqual([]))
  test('the same material: the margin and a typed final price; labor and per foot stay, as on its card', () =>
    expect(mainPricingCleared(VINYL, VINYL_DS)).toEqual(['costFactor', 'finalPrice']))
  test('another material: its labor, sub rate and per foot price too', () =>
    expect(mainPricingCleared(VINYL, ALUM)).toEqual(['costFactor', 'finalPrice', 'laborCost', 'subRate', 'pricePerFoot']))
})

describe('the quote builder\'s fields', () => {
  test('the reviewer\'s draft: aluminum takes no factor (its own), vinyl\'s is kept for Make main back', () => {
    const a = pricingForMain(opened, {}, VINYL, ALUM, '')
    expect(a.typed.costFactor).toBe('')
    expect(a.kept[VINYL.name]).toEqual(opened)
    const c = pricingForMain(a.typed, a.kept, ALUM, CHAIN, '')
    expect(c.typed.costFactor).toBe('')
    const back = pricingForMain(c.typed, c.kept, CHAIN, VINYL, '')
    expect(back.typed).toEqual(opened)
  })

  test('a margin and a final price typed by hand stay with the fence they were typed for', () => {
    const typed = { costFactor: '0.55', finalPrice: '9000', laborCost: '1200', subRate: '', pricePerFoot: '' }
    const a = pricingForMain(typed, {}, VINYL, ALUM, '')
    expect(a.typed).toEqual({ costFactor: '', finalPrice: '', laborCost: '', subRate: '', pricePerFoot: '' })
    expect(pricingForMain(a.typed, a.kept, ALUM, VINYL, '').typed).toEqual(typed)
  })

  test('labor typed on vinyl carries to another vinyl, as its card priced it', () => {
    const typed = { ...opened, laborCost: '1200' }
    expect(pricingForMain(typed, {}, VINYL, VINYL_DS, '').typed).toEqual({ ...typed, costFactor: '' })
  })

  test('Make main on the main option itself changes nothing', () => {
    const r = pricingForMain(opened, {}, VINYL, VINYL, '')
    expect(r.typed).toBe(opened)
    expect(r.kept).toEqual({})
  })
})

describe('the server\'s saved cost choices (Salesman)', () => {
  const saved = { costFactor: 0.604, laborCost: 1200, subRate: 3, commissionPct: 0.05, commissionMode: 'price', priceAdjustmentCents: -50000 }
  test('the saved style: as saved', () => expect(costChoicesForMain(saved, VINYL, VINYL)).toBe(saved))
  test('another material: factor, labor and sub rate left off; commission and the discount stay', () =>
    expect(costChoicesForMain(saved, VINYL, ALUM)).toEqual({ commissionPct: 0.05, commissionMode: 'price', priceAdjustmentCents: -50000 }))
  test('the same material: only the factor left off', () =>
    expect(costChoicesForMain(saved, VINYL, VINYL_DS)).toEqual({ laborCost: 1200, subRate: 3, commissionPct: 0.05, commissionMode: 'price', priceAdjustmentCents: -50000 }))
  test('an unknown style: as saved', () => expect(costChoicesForMain(saved, VINYL, undefined)).toBe(saved))
})

test('the +$505: cost over vinyl\'s factor against aluminum\'s own', () => {
  // The reviewer's aluminum card: $15,250 at 0.624 is cost of goods of $9,516. At vinyl's 0.604 it is $15,755.
  const cogs = 15250 * 0.624
  expect(Math.round(cogs / 0.604)).toBe(15755)
})
