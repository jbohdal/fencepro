/**
 * An unsent draft takes today's Target Profit when opened (web draftMargin.ts);
 * sent, viewed, signed and sold quotes, and margins typed on a quote, keep theirs.
 */

import { describe, test, expect } from 'vitest'
import { draftMarginNow, factorProfit, legacyProfit, isUnsentDraft, profitRecord, settingsFactor, styleEarn } from '../../web/src/draftMargin'

const draft = (pricing: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ status: 'DRAFT', pricing, ...extra })
const ds = { targetProfitPct: 11 }

describe('which quotes follow', () => {
  test('a draft never sent, shared, viewed, accepted or sold', () => {
    expect(isUnsentDraft({ status: 'DRAFT' })).toBe(true)
    for (const x of [{ status: 'SENT' }, { status: 'SOLD' }, { status: 'DRAFT', shareToken: 't' }, { status: 'DRAFT', viewCount: 1 }, { status: 'DRAFT', firstViewedAt: '2026-11-01' }, { status: 'DRAFT', acceptedAt: '2026-11-01' }, { status: 'DRAFT', soldAt: '2026-11-01' }]) {
      expect(isUnsentDraft(x), JSON.stringify(x)).toBe(false)
    }
  })
  test('the factor came from Settings only when the quote saved its Target Profit with it', () => {
    expect(factorProfit({ costFactor: settingsFactor(30, 16), overheadPct: 30, targetProfitPct: 16 })).toBe(16)
    expect(factorProfit({ costFactor: 0.5, overheadPct: 30, targetProfitPct: 16 })).toBeNull()       // typed after
    expect(factorProfit({ costFactor: 0.56, overheadPct: 30 })).toBeNull()                           // saved before this rule
  })
  test('saved before this rule: matched against today’s Target Profit only (aluminum drafts at 14% while aluminum is 12% keep theirs)', () => {
    expect(legacyProfit({ costFactor: 0.56, overheadPct: 30 }, { targetProfitPct: 14 })).toBe(14)
    expect(legacyProfit({ costFactor: 0.56, overheadPct: 30 }, { targetProfitPct: 12 })).toBeNull()
    expect(legacyProfit({ costFactor: 0.491, overheadPct: 30 }, { targetProfitPct: 14 })).toBeNull()
    expect(draftMarginNow(draft({ costFactor: 0.56, overheadPct: 30 }), { targetProfitPct: 12 })).toBeNull()
  })
})

describe('draftMarginNow', () => {
  test('Dig set went from 10% to 11%: the draft takes 11% at its saved overhead', () => {
    expect(draftMarginNow(draft({ costFactor: 0.6, overheadPct: 30, targetProfitPct: 10 }), ds)).toEqual({ costFactor: settingsFactor(30, 11), profitPct: 11, wasProfitPct: 10, overheadPct: 30 })
  })
  test('nothing changed: priced as saved', () => {
    expect(draftMarginNow(draft({ costFactor: 0.6, overheadPct: 30, targetProfitPct: 10 }), { targetProfitPct: 10 })).toBeNull()
  })
  test('sent, signed, sold, a typed margin, a per foot or typed price, a move or repair: priced as saved', () => {
    expect(draftMarginNow({ status: 'SENT', pricing: { costFactor: 0.6, overheadPct: 30, targetProfitPct: 10 } }, ds)).toBeNull()
    expect(draftMarginNow(draft({ costFactor: 0.6, overheadPct: 30, targetProfitPct: 10 }, { shareToken: 'x' }), ds)).toBeNull()
    expect(draftMarginNow(draft({ costFactor: 0.6, overheadPct: 30, targetProfitPct: 10 }, { soldAt: '2026-11-01' }), ds)).toBeNull()
    expect(draftMarginNow(draft({ costFactor: 0.491, overheadPct: 30 }), ds)).toBeNull()
    expect(draftMarginNow(draft({ costFactor: 0.6, overheadPct: 30, targetProfitPct: 10, priceMethod: 'per_foot' }), ds)).toBeNull()
    expect(draftMarginNow(draft({ costFactor: 0.6, overheadPct: 30, targetProfitPct: 10 }, { work: { type: 'repair' } }), ds)).toBeNull()
  })
  test('a fence’s own number and a color’s count as its Target Profit', () => {
    expect(styleEarn({ targetProfitPct: 15, colorTargetProfitPct: 18 })).toBe(18)
    expect(styleEarn({ targetProfitPct: 14, colorTargetProfitPct: 18, ownProfitPct: 16 })).toBe(16)
    expect(styleEarn({ targetProfitPct: 10, followed: { targetProfitPct: { value: 11, from: 'Dig set' } } })).toBe(11)
  })
})

describe('saved with a quote', () => {
  test('the Target Profit only when the factor is the Settings one', () => {
    expect(profitRecord(settingsFactor(25.6, 14), 25.6, { targetProfitPct: 14 })).toEqual({ targetProfitPct: 14 })
    expect(profitRecord(0.5, 25.6, { targetProfitPct: 14 })).toEqual({})
    expect(profitRecord(undefined, 25.6, { targetProfitPct: 14 })).toEqual({})
  })
})
