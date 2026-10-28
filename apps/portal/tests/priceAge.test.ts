/**
 * Material price freshness: every Inventory price carries the day it last
 * changed or was confirmed; imported prices say "imported, not yet confirmed";
 * a quote lists the parts older than the setting (6 months by default).
 */

import { describe, test, expect } from 'vitest'
import { staleCutoff, priceAge, stampPriceChanges, confirmPrices, stalePartsOnQuote, compareByPriceAge, priceAgeLabel, stalePricesHeading, DEFAULT_PRICE_STALE_MONTHS } from '../../web/src/priceAge'

const item = (id: string, unitCost: number, extra: Record<string, unknown> = {}) => ({ id, name: `*Vinyl, ${id}`, unitCost, ...extra })
const norm = (s: string) => s.replace(/^\*/, '').toLowerCase()

describe('price age', () => {
  test('six months back, the same day of the month (or the last day when shorter)', () => {
    expect(staleCutoff('2026-10-17', 6)).toBe('2026-04-17')
    expect(staleCutoff('2026-08-31', 6)).toBe('2026-02-28')
    expect(staleCutoff('2026-03-15', 6)).toBe('2025-09-15')
  })

  test('never confirmed, older than the setting, or fresh', () => {
    expect(priceAge(item('a', 1), '2026-10-17')).toBe('unconfirmed')
    expect(priceAge(item('a', 1, { priceUpdatedAt: '2026-10-01', priceImported: true }), '2026-10-17')).toBe('unconfirmed')
    expect(priceAge(item('a', 1, { priceUpdatedAt: '2026-04-17' }), '2026-10-17')).toBe('old')
    expect(priceAge(item('a', 1, { priceUpdatedAt: '2026-04-18' }), '2026-10-17')).toBe('fresh')
    expect(priceAge(item('a', 1, { priceUpdatedAt: '2026-08-01' }), '2026-10-17', 2)).toBe('old')
    expect(priceAgeLabel(item('a', 1))).toBe('Imported, not yet confirmed')
  })

  test('a cost that changes gets today; an unchanged cost keeps its date; an import is marked imported', () => {
    const before = new Map([['a', 5], ['b', 6]])
    const items = [item('a', 5, { priceUpdatedAt: '2025-01-01' }), item('b', 6.5), item('c', 3)]
    const typed = stampPriceChanges(items, before, '2026-10-17')
    expect(typed.map(i => [i.id, i.priceUpdatedAt, i.priceImported])).toEqual([['a', '2025-01-01', undefined], ['b', '2026-10-17', false], ['c', '2026-10-17', false]])
    const imported = stampPriceChanges(items, before, '2026-10-17', true)
    expect(imported.map(i => [i.id, i.priceUpdatedAt, i.priceImported])).toEqual([['a', '2025-01-01', undefined], ['b', '2026-10-17', true], ['c', '2026-10-17', true]])
  })

  test('confirm changes only the date, never the price', () => {
    const out = confirmPrices([item('a', 5, { priceImported: true }), item('b', 6)], new Set(['a']), '2026-10-17')
    expect(out).toEqual([item('a', 5, { priceImported: false, priceUpdatedAt: '2026-10-17' }), item('b', 6)])
  })

  test('the quote lists each old or unconfirmed part once, by the name the quote uses', () => {
    const inv = [item('a', 1, { priceUpdatedAt: '2026-01-01' }), item('b', 1, { priceUpdatedAt: '2026-10-01' }), item('c', 1)]
    const out = stalePartsOnQuote(['Vinyl, a', '*Vinyl, a', 'Vinyl, b', 'Vinyl, c', 'Not in inventory'], inv, '2026-10-17', 6, norm)
    expect(out.map(o => [o.item.id, o.age])).toEqual([['a', 'old'], ['c', 'unconfirmed']])
  })

  test('oldest first, never confirmed at the top', () => {
    const sorted = [item('new', 1, { priceUpdatedAt: '2026-09-01' }), item('none', 1), item('old', 1, { priceUpdatedAt: '2025-02-01' })].sort(compareByPriceAge)
    expect(sorted.map(i => i.id)).toEqual(['none', 'old', 'new'])
  })

  test("the quote's heading names the Settings months in plain words (review Oct 28 2026)", () => {
    expect(DEFAULT_PRICE_STALE_MONTHS).toBe(6)
    expect(stalePricesHeading(3, 6)).toBe('3 parts on this quote have prices not confirmed in the last 6 months')
    expect(stalePricesHeading(1, 3)).toBe('1 part on this quote has a price not confirmed in the last 3 months')
    expect(stalePricesHeading(2, 1)).toBe('2 parts on this quote have prices not confirmed in the last 1 month')
  })
})
