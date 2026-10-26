/**
 * Vendor invoices and bills, the second review round (Oct 26, 2026):
 *   - a bill from a vendor document keeps its freight and fees (Edit bill saved
 *     06-249853 as $2,760.27 without its $25 fuel);
 *   - words read as printed ("HOT DIP", not "DIP HOT"), and matches saved on
 *     the swapped wording still find their item;
 *   - unit presets both ways (300 EA ties to a box of 100 = 3 boxes), and
 *     never a $0.00 price;
 *   - the unit printed in the description is picked to start with;
 *   - an undone order's bill is voided, restorably;
 *   - suggestions: same finish and length first.
 */

import { describe, test, expect } from 'vitest'
import { wordsToRows, placeStrayWords, strayWord, type Word } from '../src/server/lib/invoiceReader'
import { matchKey, looseMatchKey, findLink, billWithCharges } from '../src/server/lib/invoiceMath'
import { contentKey, zeroPriceWhy, voidBillForUndo, suggestItems, finishOf, feetIn, dayWords } from '../src/server/lib/vendorInvoices'
import { unitPresets, startingPreset, unitPreview, unitHints, packOfName } from '../../web/src/invoiceUnits'
import { billTotalCents } from '../../web/src/billTotal'

const W = (t: string, x: number, w: number, extra: Partial<Word> = {}): Word => ({ t, x, y: 0.2999, w, h: 0.0133, c: 1, ...extra })

describe('words read as printed (06-249853)', () => {
  // The words of one row as PDFKit gives them, in reading order. "HOT" comes back
  // 312 pt wide (x 0.1196, w 0.5095): sorted by its middle it fell after "DIP".
  const row = [
    W('300', 0.0522, 0.0332), W('300', 0.1216, 0.0332), W('0', 0.2165, 0.0108), W('ft', 0.2333, 0.0218),
    W('HOT', 0.1196, 0.5095), W('DIP', 0.3320, 0.0173), W('2-3/8x11.5x60in', 0.3545, 0.1296), W('KK', 0.4894, 0.0242),
    W('50ft/rll', 0.5188, 0.0499), W('6', 0.7067, 0.0108), W('rll', 0.7290, 0.0328), W('2.2766', 0.8035, 0.0661), W('682.98', 0.9153, 0.0665),
  ]
  const aspect = 612 / 792

  test('a word far wider than its letters is a stray place, only for PDF text', () => {
    expect(strayWord(row[4], aspect)).toBe(true)
    expect(row.filter(w => strayWord(w, aspect))).toHaveLength(1)
    expect(strayWord({ ...row[4], l: 3 }, aspect)).toBe(false) // a photo's word (Vision / Tesseract)
  })

  test('it is put just before the next word, so the row reads as printed', () => {
    const placed = placeStrayWords(row, aspect)
    expect(placed[4].x + placed[4].w).toBeLessThan(row[5].x)
    expect(wordsToRows(row, 1, aspect)[0].text).toContain('ft HOT DIP 2-3/8x11.5x60in KK 50ft/rll')
  })

  test('the last word on its line goes after the one before it; nothing else moves', () => {
    const r = [W('ea', 0.2333, 0.0218), W('COLLAR', 0.33, 0.06), W('1-3/8in', 0.1182, 0.5109)]
    expect(wordsToRows(r, 1, aspect)[0].text).toBe('ea COLLAR 1-3/8in')
    const plain = row.filter((_, i) => i !== 4)
    expect(placeStrayWords(plain, aspect)).toBe(plain)
  })
})

describe('matches saved on the swapped wording still find their item', () => {
  const old = { key: matchKey('', 'DIP HOT 2-3/8x11.5x60in KK 50ft/rll'), item: 'fab' }
  const now = matchKey('', 'HOT DIP 2-3/8x11.5x60in KK 50ft/rll')

  test('the same words in another order are one vendor item', () => {
    expect(now).not.toBe(old.key)
    expect(looseMatchKey(now)).toBe(looseMatchKey(old.key))
    expect(looseMatchKey(matchKey('', 'GALV 1-5/8" x 6\' x 18ga-SPS'))).toBe(looseMatchKey(matchKey('', '1-5/8" GALV x 6\' x 18ga-SPS')))
    expect(looseMatchKey('item:ABC-1')).toBe('item:ABC-1')
  })

  test('the exact key first; else the only one with the same words; never a guess between two', () => {
    expect(findLink([old], now)).toBe(old)
    const exact = { key: now, item: 'other' }
    expect(findLink([old, exact], now)).toBe(exact)
    const twin = { key: matchKey('', 'HOT 2-3/8x11.5x60in DIP KK 50ft/rll'), item: 'x' }
    expect(findLink([old, twin], now)).toBeNull()
    expect(findLink([old], matchKey('', 'TENSION BAND 2-1/2in'))).toBeNull()
  })

  test('the same document read before and after the fix is still the same document', () => {
    const a = contentKey({ invoiceDate: '2026-10-06', totalCents: 278527 }, [{ description: 'DIP HOT 2-3/8x11.5x60in', qty: 300, unitPriceHc: 22766, totalCents: 68298 }])
    const b = contentKey({ invoiceDate: '2026-10-06', totalCents: 278527 }, [{ description: 'HOT DIP 2-3/8x11.5x60in', qty: 300, unitPriceHc: 22766, totalCents: 68298 }])
    expect(a).toBe(b)
  })
})

describe('a bill from a vendor document keeps its freight and fees', () => {
  const b249853 = { id: 'vi-1', invoiceId: 'i1', billNumber: '06-249853', subtotalCents: 276027, taxCents: 0, freightCents: 0, fees: [{ label: 'Fuel Charge', cents: 2500 }], feesCents: 2500, amountPaidCents: 0 }
  const b251608 = { id: 'vi-2', invoiceId: 'i2', billNumber: '06-251608', subtotalCents: 187160, taxCents: 0, freightCents: 12500, fees: [{ label: 'Fuel Charge', cents: 2500 }], feesCents: 2500, amountPaidCents: 0 }

  test('saved as lines + tax only (the old Edit bill), the total is put right', () => {
    expect(billWithCharges({ ...b249853, totalCents: 276027, balanceDueCents: 276027 })).toMatchObject({ totalCents: 278527, balanceDueCents: 278527 })
    expect(billWithCharges({ ...b251608, totalCents: 187160, balanceDueCents: 187160 })).toMatchObject({ totalCents: 202160, balanceDueCents: 202160 })
  })

  test('a right bill is left as it is; a bill typed by hand is never touched', () => {
    const right = { ...b249853, totalCents: 278527, balanceDueCents: 278527 }
    expect(billWithCharges(right)).toBe(right)
    const typed = { id: 'b', billNumber: 'X', subtotalCents: 1000, taxCents: 70, freightCents: 500, totalCents: 1070 }
    expect(billWithCharges(typed)).toBe(typed)
  })

  test('marked paid on the short total: open again for what is left', () => {
    const paid = billWithCharges({ ...b249853, totalCents: 276027, amountPaidCents: 276027, balanceDueCents: 0, status: 'paid', paidAt: '2026-10-20' })
    expect(paid).toMatchObject({ totalCents: 278527, balanceDueCents: 2500, status: 'received' })
    expect(paid.paidAt).toBeUndefined()
  })

  test('the Edit bill form adds the same: lines + tax + freight + fees', () => {
    expect(billTotalCents({ subtotalCents: 187160, taxCents: 0, freightCents: 12500, fees: [{ cents: 2500 }] })).toBe(202160)
    expect(billTotalCents({ subtotalCents: 276027, taxCents: 0, fees: [{ cents: 2500 }] })).toBe(278527)
  })

  test('an undone order\'s bill is voided and keeps what it was (Restore puts it back)', () => {
    const v = voidBillForUndo({ ...b249853, status: 'approved' }, 'Jonathan', '2026-10-26T12:00:00Z')
    expect(v).toMatchObject({ status: 'void', statusBeforeVoid: 'approved', voidedBy: 'Jonathan', subtotalCents: 276027, fees: [{ label: 'Fuel Charge', cents: 2500 }] })
    expect(v.voidReason).toMatch(/order was undone/)
  })
})

describe('units both ways, never $0.00', () => {
  const ties = { description: 'ALUM TIE 9gax6-1/2in', unit: 'EA', qty: 300, totalCents: 5073, landedCents: 5439 }
  const box = 'Chainlink, Galv, Hardware, Hook Ties, 6-1/2" x 9ga (100)'

  test('vendor each to an Inventory box: "100 EA = 1 box" (300 EA = 3 boxes)', () => {
    const p = unitPresets(ties, box)
    expect(p[0]).toEqual({ label: '100 EA = 1 box', vendorPer: 100, invPer: 1 })
    expect(p.some(x => x.vendorPer === 1 && x.invPer === 100)).toBe(false) // "1 EA = 100 each" is not offered for each
    expect(startingPreset(ties, box)).toMatchObject({ vendorPer: 100, invPer: 1 })
    expect(unitPreview(ties, 100, 1)).toEqual({ invQty: 3, cents: 1813, zero: false })
  })

  test('vendor box to Inventory each: "1 BX = 100 each"', () => {
    const p = unitPresets({ description: 'HOOK TIES 6-1/2', unit: 'BX' })
    expect(p).toContainEqual({ label: '1 BX = 100 each', vendorPer: 1, invPer: 100 })
    expect(p.some(x => x.vendorPer === 100 && x.invPer === 1)).toBe(false)
    expect(unitPreview({ qty: 4, landedCents: 11200, totalCents: 10000 }, 1, 100)).toEqual({ invQty: 400, cents: 28, zero: false })
  })

  test('300 EA as "1 = 100" is 30,000 each at $0.00: flagged, and the server refuses it', () => {
    expect(unitPreview(ties, 1, 100)).toMatchObject({ invQty: 30000, zero: true })
    expect(zeroPriceWhy(ties, { vendorPer: 1, invPer: 100 })).toMatch(/\$0\.00 each: 300 EA would be 30,000 Inventory units/)
    expect(zeroPriceWhy(ties, { vendorPer: 100, invPer: 1 })).toBe('')
    expect(zeroPriceWhy({ ...ties, totalCents: 0, landedCents: 0 }, { vendorPer: 1, invPer: 100 })).toBe('')
  })

  test('the unit printed in the description is picked to start with', () => {
    expect(startingPreset({ description: 'HOT DIP 2-3/8x11.5x60in KK 50ft/rll', unit: 'FT' })).toEqual({ label: '50 ft = 1 roll', vendorPer: 50, invPer: 1 })
    expect(startingPreset({ description: 'ALM HOG RING 9ga (220/lb)', unit: 'LB' })).toMatchObject({ vendorPer: 1, invPer: 220 })
    expect(startingPreset({ description: 'GRN VNL STEEL HOG RING (140/#)', unit: 'LB' })).toMatchObject({ vendorPer: 1, invPer: 140 })
    expect(unitHints({ description: 'DOM TENS WIRE 9ga SMTH @1000ft', unit: 'RLL' })).toEqual([{ label: '1 roll = 1000 ft', vendorPer: 1, invPer: 1000 }])
    expect(startingPreset({ description: 'TENSION BAND 2-1/2in', unit: 'EA' })).toMatchObject({ label: 'Same unit' })
  })

  test('"Box of 100" printed on a box line starts on "1 BX = 100 each"', () => {
    expect(startingPreset({ description: 'Hog Rings Alum 1/2in Box of 100', unit: 'BX' })).toEqual({ label: '1 BX = 100 each', vendorPer: 1, invPer: 100 })
  })

  test('pack counts in Inventory names', () => {
    expect(packOfName(box)).toBe(100)
    expect(packOfName('G, Tension Bar, 48"')).toBeNull()
    expect(packOfName('Bolts, box of 50')).toBe(50)
  })
})

describe('Needs a match suggestions: same finish and length first', () => {
  const items = [
    { id: 'b', name: 'Black, Hog Ring, 9GA, Alum' },
    { id: 'g', name: 'G, Hog Ring, 9GA, Alum' },
    { id: 'gr', name: 'Gr, Hog Ring, 9GA, Alum' },
    { id: 'p8', name: 'Pipe, Galv, 1-5/8" X 8\' (SS40)' },
    { id: 'p9', name: 'Pipe, Galv, 1-5/8" X 9\' (SS40)' },
  ]

  test('finish and length words', () => {
    expect(finishOf('GRN VNL STEEL HOG RING')).toBe('green')
    expect(finishOf('Gr, Hog Ring, 9GA, Alum')).toBe('green')
    expect(finishOf('G, Hog Ring')).toBe('galv')
    expect(finishOf('BLK PLY 1-5/8"')).toBe('black')
    expect(finishOf('TENSION BAND 2-1/2in')).toBeNull()
    expect(feetIn('GALV 1-5/8" x 9\' x SPS40-G210')).toEqual([9])
    expect(feetIn('GALV 1-3/8" x 10\'6" x SPS20 SW')).toEqual([10.5])
  })

  test('a green hog ring suggests the green one first', () => {
    const s = suggestItems({ itemNumber: '', description: 'GRN VNL STEEL HOG RING (140/#)' }, items)
    expect(s[0]).toMatchObject({ id: 'gr', why: expect.stringMatching(/same finish \(green\)/) })
  })

  test('a 9 ft galvanized pipe suggests 9\' before 8\'', () => {
    const s = suggestItems({ itemNumber: '', description: 'GALV 1-5/8" x 9\' x SPS40-G210' }, items)
    expect(s[0].id).toBe('p9')
    expect(s.findIndex(x => x.id === 'p9')).toBeLessThan(s.findIndex(x => x.id === 'p8'))
  })

  test('dates in words', () => expect(dayWords('2026-10-09')).toBe('Oct 9, 2026'))
})
