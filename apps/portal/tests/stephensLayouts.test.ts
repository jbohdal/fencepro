/**
 * Stephens Pipe & Steel quotations, one per layout, read the whole way from
 * the words the reader (tools/invoice-reader.swift) gives for the real PDF:
 * rows (lib/invoiceReader wordsToRows), then lib/invoiceParse. The words are
 * in tests/fixtures/stephens/*.words.txt, in the reader's order (only the
 * number, vendor and date rows and the items and totals; no customer rows),
 * so this runs anywhere.
 *
 * Jonathan's rules: a fuel charge is a fee (bill only, never in an item
 * price); freight is freight (spread over the lines); tax as printed, and no
 * tax line means estimated tax; the document adds up to the penny.
 *
 *   2023 (06-120125, 06-132612): the PDF draws "Fuel Charge 15.00" and the
 *     row under it as one block, so every word of the two rows has one place
 *     and height. Before Oct 28 the reader took them as an item line ("Fuel
 *     Freight Charge" $15.00, "Fuel Conven Charge Fee:" $45.90) and the
 *     document did not add up. They are split by the order the PDF draws them.
 *   2026: fuel and freight one above the other (06-251608), fuel and tax one
 *     above the other (06-238126 rev 1172886), freight + fuel + tax
 *     (06-238126 rev 1161133), no tax and a packing column (06-249853).
 */

import fs from 'fs'
import path from 'path'
import { describe, test, expect } from 'vitest'
import { wordsToRows, type Word } from '../src/server/lib/invoiceReader'
import { parseInvoice, splitByReadingOrder, type ParsedInvoice } from '../src/server/lib/invoiceParse'
import { checkTotals, landedParts, isFuelFee, estimatedTaxCents } from '../src/server/lib/invoiceMath'

function read(name: string): ParsedInvoice {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures/stephens', `${name}.words.txt`), 'utf8').split('\n')
  const [, , w, h] = text.find(l => l.startsWith('# page '))!.split(' ')
  const words: Word[] = text.filter(l => l && !l.startsWith('# ')).map(l => { const [t, x, y, ww, hh] = l.split('\t'); return { t, x: +x, y: +y, w: +ww, h: +hh, c: 1 } })
  return parseInvoice([{ page: 1, rows: wordsToRows(words, 1, Number(w) / Number(h)) }])
}

/** Every Stephens quotation: adds up to the penny, header read, no line problems, no fee taken as a line. */
function addsUp(p: ParsedInvoice, number: string, date: string) {
  const fees = p.fees.reduce((s, f) => s + f.cents, 0)
  expect(checkTotals(p.lines, { ...p, feesCents: fees }).problems).toEqual([])
  expect(p.problems).toEqual([])
  expect(p.lines.reduce((s, l) => s + l.totalCents!, 0)).toBe(p.subtotalCents)
  expect(p.subtotalCents! + fees + p.freightCents + p.taxCents).toBe(p.totalCents)
  expect(p).toMatchObject({ docType: 'quote', vendorName: 'Stephens Pipe & Steel, LLC', invoiceNumber: number, invoiceDate: date })
  for (const l of p.lines) {
    expect(l.problems).toEqual([])
    expect(l.description).not.toMatch(/fuel|freight|charge|conven/i)
  }
}

describe('Stephens 2023 layout: fuel and the next totals row in one block', () => {
  test('06-120125 (Jul 13 2023): Fuel Charge $15 a fee, Freight $100, 7.0% tax $102.05 as printed', () => {
    const p = read('06-120125')
    addsUp(p, '06-120125', '2023-07-13')
    expect(p.lines).toHaveLength(21)
    expect(p).toMatchObject({ subtotalCents: 134288, freightCents: 10000, taxCents: 10205, taxFound: true, taxRate: '7.0%', totalCents: 155993 })
    expect(p.fees.map(f => [f.label, f.cents])).toEqual([['Fuel Charge', 1500]])
    // The fuel charge stays on the bill; freight and tax are spread over the lines.
    const parts = landedParts({ linesCents: 134288, taxCents: p.taxCents, freightCents: p.freightCents, fees: p.fees, taxFound: true, taxOk: false, estTaxBp: 722 })
    expect(parts).toMatchObject({ fuelCents: 1500, spreadCents: 10000 + 10205, estTaxCents: 0 })
    expect(p.lines.find(l => /GATE 5Wx4/.test(l.description))).toMatchObject({ qty: 1, unit: 'EA', totalCents: 17230 })
    expect(p.lines.find(l => /DROP FORK 2-1\/2/.test(l.description))).toMatchObject({ qty: 1, unit: 'EA', totalCents: 320 })
    // "1 1 0 can GRN PLY SPRAY PAINT": the can is the unit, not part of the description.
    expect(p.lines.find(l => /SPRAY PAINT/.test(l.description))).toMatchObject({ description: 'GRN PLY SPRAY PAINT', unit: 'CAN', qty: 1, totalCents: 1202 })
  })

  test('06-132612 (Oct 27 2023): Fuel Charge $15 and Conven Fee $45.90 fees, no tax printed (estimated)', () => {
    const p = read('06-132612')
    addsUp(p, '06-132612', '2023-10-27')
    expect(p.lines).toHaveLength(21)
    expect(p).toMatchObject({ subtotalCents: 223391, freightCents: 0, taxCents: 0, taxFound: false, totalCents: 229481 })
    expect(p.fees.map(f => [f.label, f.cents])).toEqual([['Fuel Charge', 1500], ['Conven Fee', 4590]])
    expect(p.fees.map(f => isFuelFee(f.label))).toEqual([true, false])
    // No tax line: 7.22% estimated tax; fuel on the bill only; the other fee spread like freight.
    const parts = landedParts({ linesCents: 223391, taxCents: 0, freightCents: 0, fees: p.fees, taxFound: false, taxOk: false, estTaxBp: 722 })
    expect(parts).toMatchObject({ fuelCents: 1500, spreadCents: 4590, estTaxCents: estimatedTaxCents(223391, 722) })
    expect(estimatedTaxCents(223391, 722)).toBe(16129)
    // A back ordered line priced $0.00 is left out, not a line.
    expect(p.skipped.some(s => s.why === 'zero')).toBe(true)
  })

  test('the split takes each amount after its own label, in the order the PDF draws them', () => {
    const at = { x: 0.7, y: 0.73, w: 0.05, h: 0.026, c: 1 }
    const words = [{ t: 'Fuel', ...at, n: 0 }, { t: 'Charge', ...at, n: 1 }, { t: '15.00', ...at, n: 2 }, { t: 'Freight', ...at, n: 3 }, { t: '100.00', ...at, n: 4 }]
    expect(splitByReadingOrder({ words })).toEqual([
      { kind: 'fee', label: 'Fuel Charge', cents: 1500 },
      { kind: 'freight', label: 'Freight', cents: 10000 },
    ])
    // Not totals: an item line (numbers in its words), an amount with no label, words without their order.
    expect(splitByReadingOrder({ words: [{ t: '1', ...at, n: 0 }, { t: 'Fuel', ...at, n: 1 }, { t: '15.00', ...at, n: 2 }, { t: '15.00', ...at, n: 3 }] })).toBeNull()
    expect(splitByReadingOrder({ words: [{ t: 'Freight', ...at, n: 0 }, { t: '15.00', ...at, n: 1 }, { t: '15.00', ...at, n: 2 }] })).toBeNull()
    expect(splitByReadingOrder({ words: words.map(({ n, ...w }) => w) })).toBeNull()
  })
})

describe('Stephens 2026 layouts still read the same', () => {
  test('06-251608 (Oct 23 2026): Fuel Charge over Freight, split by height; no tax printed', () => {
    const p = read('06-251608')
    addsUp(p, '06-251608', '2026-10-23')
    expect(p.lines).toHaveLength(22)
    expect(p).toMatchObject({ subtotalCents: 187160, freightCents: 12500, taxFound: false, totalCents: 202160 })
    expect(p.fees.map(f => [f.label, f.cents])).toEqual([['Fuel Charge', 2500]])
  })

  test('06-238126 rev 1172886 (Jun 19 2026): Fuel Charge over 7.5% Tax, split by the tax rate', () => {
    const p = read('06-238126-1172886')
    addsUp(p, '06-238126', '2026-06-19')
    expect(p).toMatchObject({ subtotalCents: 493061, freightCents: 0, taxCents: 36980, taxRate: '7.5%', totalCents: 532541 })
    expect(p.fees.map(f => [f.label, f.cents])).toEqual([['Fuel Charge', 2500]])
  })

  test('06-238126 rev 1161133 (Jun 19 2026): freight, fuel and tax each on their own row', () => {
    const p = read('06-238126-1161133')
    addsUp(p, '06-238126', '2026-06-19')
    expect(p).toMatchObject({ subtotalCents: 53113, freightCents: 12500, taxCents: 3983, taxRate: '7.5%', totalCents: 72096 })
    expect(p.fees.map(f => [f.label, f.cents])).toEqual([['Fuel Charge', 2500]])
  })

  test('06-249853 (Oct 6 2026): fuel only, no tax printed, packing column', () => {
    const p = read('06-249853')
    addsUp(p, '06-249853', '2026-10-06')
    expect(p.lines).toHaveLength(22)
    expect(p).toMatchObject({ subtotalCents: 276027, freightCents: 0, taxFound: false, totalCents: 278527 })
    expect(p.fees.map(f => [f.label, f.cents])).toEqual([['Fuel Charge', 2500]])
    expect(p.lines[0]).toMatchObject({ description: 'HOT DIP 2-3/8x11.5x60in KK 50ft/rll', packing: '6 rll', qty: 300, unit: 'FT', totalCents: 68298 })
  })
})
