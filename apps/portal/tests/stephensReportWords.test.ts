/**
 * The Stephens dry run in plain words (review, Oct 26 2026; scripts/stephensReportWords.ts):
 * a yard total with $0 parts says INCOMPLETE (never a cheaper price, no green − black
 * number); "OK limit" explained; quotes told apart; +$0.00 explained; the pipe's
 * own effect apart from other price changes since a quote was saved; sold quotes
 * keep their price and show only what their materials cost.
 */
import { describe, test, expect } from 'vitest'
import { yardTotalsWords, openRowWords, soldRowWords, unmovedWhy, quoteTitle, okLimitWords, shortId, type YardSide, type RepriceRow } from '../scripts/stephensReportWords'

const side = (priceCents: number, unpriced = 0): YardSide => ({ materialCents: 93921, laborCents: 18500, cogsCents: 112421, priceCents, perFootCents: 2019, gmPct: 0.42, unpriced })

describe('test yard totals', () => {
  test('a side with parts that have no price says INCOMPLETE and no difference is given', () => {
    const w = yardTotalsWords(side(193800), side(241900, 4)).join('\n')
    expect(w).toMatch(/^TOTALS: black \$1,938\.00 · green INCOMPLETE: 4 parts have no price \(listed\)/)
    expect(w).not.toMatch(/green − black\s+[+-]?\$/)
    expect(w).not.toMatch(/\$2,419\.00/)
    expect(w).toMatch(/Price\s+black\s+\$1,938\.00\s+green\s+INCOMPLETE/)
    expect(w).toMatch(/green, the parts that have a price only \(not a price to quote\): material \$939\.21/)
  })
  test('one part: "1 part has no price"', () => {
    expect(yardTotalsWords(side(100), side(200, 1))[0]).toMatch(/INCOMPLETE: 1 part has no price \(listed\)/)
  })
  test('both complete: the totals and the difference', () => {
    const w = yardTotalsWords(side(193800), side(241900))
    expect(w[0]).toBe('TOTALS: black $1,938.00 · green $2,419.00 · green − black +$481.00')
    expect(w.join('\n')).toMatch(/Gross margin\s+black\s+42\.0%\s+green\s+42\.0%/)
  })
})

describe('saved quotes', () => {
  const row = (o: Partial<RepriceRow> = {}): RepriceRow => ({
    what: 'the quote', fence: 'White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig', pipes: 47, savedCents: 1236370,
    nowCents: 1236300, afterCents: 1219600, materialNowCents: 586867, materialAfterCents: 577514, method: 'cost_factor', wholeDollar: true, ...o,
  })
  test('open: saved, today with the pipe now, today with the new pipe price; the pipe apart from other changes', () => {
    const w = openRowWords(row(), '$18.05', '$16.06')
    expect(w[0]).toBe('the quote (White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig), 47 pipes: saved $12,363.70 | today with pipe at $18.05: $12,363.00 | today with pipe at $16.06: $12,196.00')
    expect(w[1]).toMatch(/the pipe's own effect -\$167\.00 \(materials \$5,868\.67 → \$5,775\.14\); other price changes since it was saved -\$0\.70/)
  })
  test('a price that does not move says why', () => {
    expect(unmovedWhy(row({ afterCents: 1236300, method: 'manual' }))).toMatch(/typed by hand/)
    expect(unmovedWhy(row({ afterCents: 1236300, method: 'per_foot' }))).toMatch(/per foot/)
    expect(unmovedWhy(row({ afterCents: 1236300, materialAfterCents: 586800 }))).toMatch(/whole dollar/)
    expect(openRowWords(row({ afterCents: 1236300, method: 'manual' }), '$18.05', '$16.06')[1]).toMatch(/the pipe's own effect \$0\.00 .*the price does not move: its price was typed by hand/)
    expect(unmovedWhy(row())).toBeNull()
  })
  test('sold: the signed price is kept; only the materials change', () => {
    expect(soldRowWords(row({ savedCents: 1214500 }))).toBe('the quote (White Vinyl Privacy, 6 ft tall, 8 ft panels, No dig), 47 pipes: price $12,145.00 (kept) | materials $5,868.67 → $5,775.14 (-$93.53)')
  })
  test('two quotes for the same customer are told apart', () => {
    const a = quoteTitle({ id: '4ec75ae7-a684-4a95-adc4-485264f2470b', customerName: 'Jaziel Ortiz', date: '2026-10-21', status: 'DRAFT' })
    const b = quoteTitle({ id: '9a0b1c2d-0000-4000-8000-000000000000', customerName: 'Jaziel Ortiz', date: '2026-10-21', status: 'DRAFT' })
    expect(a).toBe('Jaziel Ortiz · Oct 21, 2026 · Draft · quote 4ec75ae')
    expect(a).not.toBe(b)
    expect(quoteTitle({ id: 'x', customerName: 'G N', date: '2026-10-23', status: 'SENT', work: { type: 'repair' }, archivedAt: new Date() })).toBe('G N · Oct 23, 2026 · Sent, archived (a repair) · quote x')
    expect(shortId('4ec75ae7-a684')).toBe('4ec75ae')
  })
  test('OK limit in words', () => {
    expect(okLimitWords(20)).toBe('a price that moves more than 20% is not changed until Jonathan OKs it in Inventory > Invoices')
  })
})
