/**
 * Vendor invoices, after the independent re-check (Oct 26, 2026):
 *   - searching Inventory matches every word in any order, punctuation left
 *     out ("bolt 3/8" finds the 3/8" bolts);
 *   - suggestions for "BOLT/NUT 3/8x3in" (slash, fraction, size run together);
 *   - a size in inches counts like a length (Fabric 60in: the 60" item first);
 *   - a line with no finish word ranks by the finish of the rest of its document;
 *   - Change match: the item matched now is among the suggestions, first;
 *   - an undone order's voided bill comes back as it was when ordered again.
 */

import { describe, test, expect } from 'vitest'
import { matchWords, sizesIn, finishOf, documentFinish, suggestItems, unvoidBill, voidBillForUndo } from '../src/server/lib/vendorInvoices'
import { searchInventory, matchesSearch, searchWords } from '../../web/src/inventorySearch'

const BOLTS = [
  { id: 'g2', name: 'G, Bolt, 3/8" x 2" w/ Nut' },
  { id: 'g3', name: 'G, Bolt, 3/8" x 3" w/ Nut' },
  { id: 'gr3', name: 'Gr, Bolt, 3/8" x 3" w/ Nut' },
  { id: 'b3', name: 'Black, Bolt, 3/8" x 3" w/ Nut' },
  { id: 'g516', name: 'G, Bolt, 5/16 x 1-1/4" w/ Nut' },
  { id: 'hog', name: 'G, Hog Ring, 9GA, Alum', sku: 'HR-9' },
]
const FABRIC = [
  { id: 'f48', name: 'Fabric, Galv, 48" KK (11.5)' },
  { id: 'f60', name: 'Fabric, Galv, 60" KK (11.5)' },
  { id: 'f72', name: 'Fabric, Galv, 72" KK (11.5)' },
  { id: 'gf48', name: 'Gr, Fabric, 48" KK (9)' },
]

describe('Inventory search: every word, any order, punctuation left out', () => {
  test('"bolt 3/8" finds the 3/8" bolts; "bolt" alone still works', () => {
    expect(searchInventory(BOLTS, 'bolt 3/8').map(i => i.id)).toEqual(['g2', 'g3', 'gr3', 'b3'])
    expect(searchInventory(BOLTS, 'bolt').length).toBe(5)
  })
  test('any order, part words, punctuation and capitals', () => {
    expect(searchInventory(BOLTS, '3/8 BOLT').length).toBe(4)
    expect(searchInventory(BOLTS, 'bol 3/8 x 3').map(i => i.id)).toEqual(['g3', 'gr3', 'b3'])
    expect(searchInventory(BOLTS, 'bolt/nut, 3/8"').length).toBe(4)
    expect(searchInventory(BOLTS, 'black bolt 3"').map(i => i.id)).toEqual(['b3'])
    expect(searchInventory(BOLTS, '1-1/4').map(i => i.id)).toEqual(['g516'])
    expect(searchInventory(FABRIC, 'galv 60 11.5').map(i => i.id)).toEqual(['f60'])
  })
  test('the item number counts; a word not there finds nothing; empty finds nothing', () => {
    expect(matchesSearch(BOLTS[5], 'hr-9')).toBe(true)
    expect(searchInventory(BOLTS, 'bolt 7/16')).toEqual([])
    expect(searchInventory(BOLTS, '  , ')).toEqual([])
    expect(searchWords('BOLT/NUT 3/8x3in')).toEqual(['bolt', 'nut', '3/8x3in'])
  })
})

describe('suggestion words and sizes', () => {
  test('words alike on both sides: a slash between words, a size run into a fraction', () => {
    expect([...matchWords('BOLT/NUT 3/8x3in')]).toEqual(['bolt', 'nut', '3/8', '3'])
    expect([...matchWords('G, Bolt, 3/8" x 3" w/ Nut')]).toEqual(['bolt', '3/8', '3', 'nut'])
    expect([...matchWords('HOT DIP 2-3/8x11.5x60in KK 50ft/rll')]).toEqual(['hot', 'dip', '2', '3/8', '11.5', '60', 'kk', '50', 'rll'])
  })
  test('sizes in inches: feet, inches, never a fraction\'s parts', () => {
    expect(sizesIn('Fabric, Galv, 60" KK (11.5)')).toEqual([60])
    expect(sizesIn('HOT DIP 2-3/8x11.5x60in KK 50ft/rll')).toEqual([600, 60])
    expect(sizesIn('BOLT/NUT 3/8x3in')).toEqual([3])
    expect(sizesIn('G, Bolt, 3/8" x 2" w/ Nut')).toEqual([2])
    expect(sizesIn('GALV 1-3/8" x 10\'6" x SPS20 SW')).toEqual([126])
    expect(sizesIn('G, Bolt, 5/16 x 1-1/4" w/ Nut')).toEqual([])
  })
  test('hot dip is galvanized', () => expect(finishOf('HOT DIP 2-3/8x11.5x60in KK')).toBe('galv'))
})

describe('Needs a match suggestions after the re-check', () => {
  test('"BOLT/NUT 3/8x3in" gets suggestions, 3" before 2"', () => {
    const s = suggestItems({ itemNumber: '', description: 'BOLT/NUT 3/8x3in' }, BOLTS)
    expect(s.length).toBeGreaterThan(0)
    const at = (id: string) => s.findIndex(x => x.id === id)
    expect(at('g3')).toBeGreaterThanOrEqual(0)
    expect(at('g3')).toBeLessThan(at('g2'))
    expect(s[0].why).toMatch(/same size/)
  })
  test('"Fabric 60in": the 60" item before the 48" one', () => {
    const s = suggestItems({ itemNumber: '', description: 'HOT DIP 2-3/8x11.5x60in KK 50ft/rll' }, FABRIC)
    expect(s[0].id).toBe('f60')
    expect(s.findIndex(x => x.id === 'f60')).toBeLessThan(s.findIndex(x => x.id === 'f48'))
    const plain = suggestItems({ itemNumber: '', description: 'Fabric 60in' }, FABRIC)
    expect(plain[0].id).toBe('f60')
  })
  test('no finish word on the line: the finish of the document\'s other lines ranks first', () => {
    const doc = [
      { id: 'a', description: 'TENSION BAR 60"x5/8"', inventoryName: 'G, Tension Bar, 60"' },
      { id: 'b', description: 'GALV 1-5/8" x 9\' x SPS40', inventoryName: '' },
      { id: 'c', description: 'BOLT/NUT 3/8x3in', inventoryName: '' },
      { id: 'd', description: 'GRN cap', inventoryName: '', ignored: true },
    ]
    expect(documentFinish(doc, 'c')).toBe('galv')
    const s = suggestItems({ itemNumber: '', description: 'BOLT/NUT 3/8x3in' }, BOLTS, 5, { docFinish: documentFinish(doc, 'c') })
    expect(s[0]).toMatchObject({ id: 'g3', why: expect.stringMatching(/same finish as the rest of the document \(galvanized\)/) })
    // The line's own finish word wins over the document's.
    expect(suggestItems({ itemNumber: '', description: 'GRN BOLT/NUT 3/8x3in' }, BOLTS, 5, { docFinish: 'galv' })[0].id).toBe('gr3')
    // A tie (one green, one galvanized) says nothing.
    expect(documentFinish([{ description: 'GRN cap' }, { description: 'GALV cap' }])).toBeNull()
  })
  test('Change match: the item matched now is in the suggestions, first, once', () => {
    const s = suggestItems({ itemNumber: '', description: 'BOLT/NUT 3/8x3in', inventoryItemId: 'b3' }, BOLTS)
    expect(s[0]).toEqual({ id: 'b3', name: 'Black, Bolt, 3/8" x 3" w/ Nut', why: 'matched now' })
    expect(s.filter(x => x.id === 'b3')).toHaveLength(1)
    // Matched to an item no longer in Inventory: just the suggestions.
    expect(suggestItems({ itemNumber: '', description: 'BOLT/NUT 3/8x3in', inventoryItemId: 'gone' }, BOLTS)[0].why).not.toBe('matched now')
  })
})

describe('an undone order\'s bill, ordered again', () => {
  test('voided by the undo, then back exactly as it was', () => {
    const bill = { id: 'vi-1', billNumber: '06-251608', status: 'approved', totalCents: 202160, amountPaidCents: 0, balanceDueCents: 202160 }
    const voided = voidBillForUndo(bill, 'Jonathan', '2026-10-26T10:00:00.000Z')
    const back = unvoidBill(voided, '2026-10-26T11:00:00.000Z')
    expect(back).toEqual({ ...bill, updatedAt: '2026-10-26T11:00:00.000Z' })
    expect(unvoidBill({ ...voided, statusBeforeVoid: undefined }, 'x').status).toBe('received')
  })
})
