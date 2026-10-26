/**
 * Jonathan's standing rules for vendor documents (Oct 2026), with the numbers
 * of Stephens quotes 06-251126 and 06-251608 (typed from the PDFs, so this
 * runs anywhere):
 *
 *   2. A fuel charge is never in an item's price: a flat charge per order, on
 *      the vendor bill only.
 *   3. Freight is spread over the lines of a real order ($125 on 06-251608).
 *   4. No tax line: 7.22% estimated tax (of the items) added to the landed
 *      cost, flagged "estimated tax".
 *   The dig set post pipe mapping: 6 ft long = 4 ft tall dig set, 7 ft long =
 *   5 ft tall, 1-5/8" = line post, 2-1/2" = terminal post; Galvanized
 *   "1-5/8" GALV x 6' x 18ga-SPS", Black "PLY BLK 1-5/8" x 6' x PP055".
 *   Also: the same document in two files is one document; a hand price that
 *   is the document's own printed price is not "newer"; two totals printed
 *   one above the other are split by height.
 */

import { describe, test, expect } from 'vitest'
import { landedParts, estimatedTaxCents, spreadExtras, unitLanded, isFuelFee, pctText, DEFAULT_EST_TAX_BP, checkTotals } from '../src/server/lib/invoiceMath'
import { digSetPipeFor, digSetPipeItem } from '../src/server/lib/digSetPipeMatch'
import { estTaxBpOf, contentKey, newerPriceKept, suggestItems, canRematch } from '../src/server/lib/vendorInvoices'
import { splitStackedTotals, parseInvoice } from '../src/server/lib/invoiceParse'
import type { Row } from '../src/server/lib/invoiceReader'
import { digSetPostName } from '../../web/src/chainDigSet'

// 06-251126 (Oct 19): eight pipes, one piece each; Fuel Charge $25.00; no tax line; total $117.63.
const Q126 = [
  { description: 'PLY BLK 1-5/8" x 6\' x PP055', cents: 1095, part: 'DS, Pipe, Blk, Line Post, 1-5/8" 0.055 wall, 4\' Chain Link' },
  { description: 'PLY BLK 1-5/8" x 7\' x PP055', cents: 1278, part: 'DS, Pipe, Blk, Line Post, 1-5/8" 0.055 wall, 5\' Chain Link' },
  { description: 'PLY BLK 2-1/2" x 6\' x PP055', cents: 1580, part: 'DS, Pipe, Blk, Terminal Post, 2-1/2" 0.055 wall, 4\' Chain Link' },
  { description: 'PLY BLK 2-1/2" x 7\' x PP055', cents: 1844, part: 'DS, Pipe, Blk, Terminal Post, 2-1/2" 0.055 wall, 5\' Chain Link' },
  { description: '1-5/8" GALV x 6\' x 18ga-SPS', cents: 655, part: 'DS, Pipe, Galv, Line Post, 1-5/8" 0.055 wall, 4\' Chain Link' },
  { description: '1-5/8" GALV x 7\' x 18ga-SPS', cents: 764, part: 'DS, Pipe, Galv, Line Post, 1-5/8" 0.055 wall, 5\' Chain Link' },
  { description: '2-1/2" GALV x 6\' x 18ga-SPS', cents: 945, part: 'DS, Pipe, Galv, Terminal Post, 2-1/2" 0.055 wall, 4\' Chain Link' },
  { description: '2-1/2" GALV x 7\' x 18ga-SPS', cents: 1102, part: 'DS, Pipe, Galv, Terminal Post, 2-1/2" 0.055 wall, 5\' Chain Link' },
]
// 06-251608 (Oct 23): 22 lines, $1,871.60; Fuel Charge $25.00; Freight $125.00; no tax line; total $2,021.60.
const Q608 = [34748, 30520, 24943, 27888, 3863, 6322, 4949, 589, 1178, 4980, 2962, 2439, 18638, 1574, 70, 57, 4768, 829, 762, 878, 9232, 4971]
const fuel = { label: 'Fuel Charge', cents: 2500 }

describe('rule 2: a fuel charge is never in item prices', () => {
  test('fuel is told apart by its label', () => {
    expect(isFuelFee('Fuel Charge')).toBe(true)
    expect(isFuelFee('FUEL SURCHARGE')).toBe(true)
    expect(isFuelFee('Pallet fee')).toBe(false)
    expect(isFuelFee('Freight')).toBe(false)
  })
  test('06-251126: the $25 fuel is not spread; it stays for the bill', () => {
    const lines = Q126.map(l => l.cents)
    const p = landedParts({ linesCents: 9263, taxCents: 0, freightCents: 0, fees: [fuel], taxFound: false, taxOk: true, estTaxBp: 722 })
    expect(p).toEqual({ spreadCents: 0, estTaxCents: 0, fuelCents: 2500 })
    expect(spreadExtras(lines, p.spreadCents).every(c => c === 0)).toBe(true)
    // The printed total still reconciles with the fuel in it (the bill is the printed total).
    expect(checkTotals(lines.map(c => ({ totalCents: c, problems: [] })), { subtotalCents: 9263, taxCents: 0, freightCents: 0, feesCents: 2500, totalCents: 11763 }).ok).toBe(true)
  })
  test('other fees (a pallet fee, a discount) are still spread; only fuel is left out', () => {
    const p = landedParts({ linesCents: 10000, taxCents: 700, freightCents: 0, fees: [fuel, { label: 'Pallet fee', cents: 1000 }, { label: 'Discount', cents: -500 }], taxFound: true, taxOk: false, estTaxBp: 722 })
    expect(p).toEqual({ spreadCents: 700 + 1000 - 500, estTaxCents: 0, fuelCents: 2500 })
  })
})

describe('rule 3: freight is spread over the lines of a real order', () => {
  test('06-251608: $125 freight spread by amount, to the cent; fuel not', () => {
    const p = landedParts({ linesCents: 187160, taxCents: 0, freightCents: 12500, fees: [fuel], taxFound: false, taxOk: false, estTaxBp: 722 })
    expect(p.spreadCents).toBe(12500)
    expect(p.fuelCents).toBe(2500)
    const spread = spreadExtras(Q608, p.spreadCents)
    expect(spread.reduce((a, b) => a + b, 0)).toBe(12500)
    // Fabric $347.48 of $1,871.60 → $23.21 of the freight (23.207...).
    expect(spread[0]).toBe(2321)
  })
})

describe('rule 4: no tax line → estimated tax 7.22%, flagged', () => {
  test('7.22% of the items, rounded half up to the cent; integer math', () => {
    expect(DEFAULT_EST_TAX_BP).toBe(722)
    expect(estimatedTaxCents(9263, 722)).toBe(669) // 06-251126: $92.63 x 7.22% = $6.6879
    expect(estimatedTaxCents(187160, 722)).toBe(13513) // 06-251608: $1,871.60 x 7.22% = $135.1295
    expect(estimatedTaxCents(0, 722)).toBe(0)
    expect(pctText(722)).toBe('7.22%')
    expect(pctText(750)).toBe('7.5%')
  })
  test('only when no tax was printed, and not when someone said no tax is right', () => {
    const base = { linesCents: 9263, taxCents: 0, freightCents: 0, fees: [fuel], estTaxBp: 722 }
    expect(landedParts({ ...base, taxFound: false, taxOk: false }).estTaxCents).toBe(669)
    expect(landedParts({ ...base, taxFound: true, taxOk: false, taxCents: 695 })).toMatchObject({ estTaxCents: 0, spreadCents: 695 })
    expect(landedParts({ ...base, taxFound: false, taxOk: true }).estTaxCents).toBe(0)
  })
  test('freight is not taxed (Stephens taxes the goods only)', () => {
    expect(landedParts({ linesCents: 187160, taxCents: 0, freightCents: 12500, fees: [fuel], taxFound: false, taxOk: false, estTaxBp: 722 }).estTaxCents).toBe(13513)
  })
  test('the rate is a setting: Settings → Material prices (a percent), 7.22% when not set', () => {
    expect(estTaxBpOf(null)).toBe(722)
    expect(estTaxBpOf({ pricing: {} })).toBe(722)
    expect(estTaxBpOf({ pricing: { invoiceEstTaxPct: 7.5 } })).toBe(750)
    expect(estTaxBpOf({ pricing: { invoiceEstTaxPct: 0 } })).toBe(0)
    expect(estTaxBpOf({ pricing: { invoiceEstTaxPct: 'x' } })).toBe(722)
  })
  test('06-251126 landed each: printed + its share of $6.69 estimated tax, no fuel', () => {
    const lines = Q126.map(l => l.cents)
    const p = landedParts({ linesCents: 9263, taxCents: 0, freightCents: 0, fees: [fuel], taxFound: false, taxOk: false, estTaxBp: 722 })
    const est = spreadExtras(lines, p.estTaxCents)
    expect(est.reduce((a, b) => a + b, 0)).toBe(669)
    const landed = lines.map((c, k) => unitLanded(c, est[k], 1).cents)
    expect(landed).toEqual([1174, 1370, 1694, 1977, 703, 819, 1013, 1182])
  })
})

describe('the dig set post pipe mapping (Jonathan\'s rule)', () => {
  test.each(Q126)('$description → $part', ({ description, part }) => {
    expect(digSetPipeFor(description)?.part).toBe(part)
  })
  test('the names are the dig set post parts the chain link dig set made (web digSetPostName)', () => {
    expect(digSetPipeFor('1-5/8" GALV x 6\' x 18ga-SPS')!.part).toBe(digSetPostName('Pipe, Galv, 1-5/8" X 8\' (SS40)', 'line', '4'))
    expect(digSetPipeFor('PLY BLK 2-1/2" x 7\' x PP055')!.part).toBe(digSetPostName('Pipe, Blk, 2-1/2" X 8\' (SS40)', 'corner', '5'))
  })
  test('his spelling too ("GALV 1-5/8"", "BLK PLY"), and the rule in words', () => {
    expect(digSetPipeFor('GALV 1-5/8" x 7\' x 18ga-SPS')).toMatchObject({ finish: 'Galv', role: 'Line Post', heightFt: 5 })
    expect(digSetPipeFor('BLK PLY 2-1/2" x 6\' x PP055')).toMatchObject({ finish: 'Blk', role: 'Terminal Post', heightFt: 4, why: 'Jonathan\'s rule: 6 ft long = 4 ft tall dig set, 2-1/2" = terminal post' })
  })
  test('nothing beyond the rule: 8 ft long, other walls, green, no dig pipe', () => {
    expect(digSetPipeFor('PLY BLK 1-5/8" x 8\' x PP055')).toBeNull() // 6 ft tall: not in his rule yet
    expect(digSetPipeFor('PLY GRN 1-5/8" x 8\' x PP40')).toBeNull()
    expect(digSetPipeFor('1-5/8" GALV x 9\' x SPS40-G210')).toBeNull()
    expect(digSetPipeFor('2-1/2" GALV x 9\' x SPS40-G210')).toBeNull()
    expect(digSetPipeFor('1-3/8" GALV x 10\'6" x SPS20 SW')).toBeNull()
  })
  test('matched to the Inventory part by name; none when Inventory has no such part', () => {
    const items = [{ id: 'a', name: Q126[4].part, unitCost: 0 }, { id: 'b', name: 'Misc, Concrete', unitCost: 6.25 }]
    expect(digSetPipeItem(Q126[4].description, items)?.item.id).toBe('a')
    expect(digSetPipeItem(Q126[0].description, items)).toBeNull()
  })
  test('Needs a match suggests the part by the rule first, and says why', () => {
    const items = [{ id: 'x', name: '1-5/8" GALV x 6\' x 18ga-SPS', unitCost: 0 }, { id: 'a', name: Q126[4].part, unitCost: 0 }]
    const s = suggestItems({ itemNumber: '', description: Q126[4].description }, items)
    expect(s[0]).toEqual({ id: 'a', name: Q126[4].part, why: 'Jonathan\'s rule: 6 ft long = 4 ft tall dig set, 1-5/8" = line post' })
    expect(s.map(x => x.id)).toEqual(['a', 'x'])
  })
})

describe('duplicates and matches', () => {
  const lines = Q126.map(l => ({ description: l.description, qty: 1, unitPriceHc: l.cents * 100, totalCents: l.cents }))
  test('the same quote in two files (06-251126, documents 1464095 and 1466412) is the same document', () => {
    expect(contentKey({ invoiceDate: '2026-10-19', totalCents: 11763 }, lines)).toBe(contentKey({ invoiceDate: '2026-10-19', totalCents: 11763 }, lines.map(l => ({ ...l, description: ` ${l.description.toUpperCase()} ` }))))
  })
  test('a real revision (a price, a quantity, the date or the total) is not', () => {
    const k = contentKey({ invoiceDate: '2026-10-19', totalCents: 11763 }, lines)
    expect(contentKey({ invoiceDate: '2026-10-20', totalCents: 11763 }, lines)).not.toBe(k)
    expect(contentKey({ invoiceDate: '2026-10-19', totalCents: 11764 }, lines)).not.toBe(k)
    expect(contentKey({ invoiceDate: '2026-10-19', totalCents: 11763 }, lines.map((l, i) => (i ? l : { ...l, qty: 2 })))).not.toBe(k)
    // A line marked "not a line" is left out.
    expect(contentKey({ invoiceDate: '2026-10-19', totalCents: 11763 }, [...lines, { description: 'Call today', qty: null, unitPriceHc: null, totalCents: 2500, ignored: true }])).toBe(k)
  })
  test('a match can be changed on a quote not yet ordered, never once it is priced', () => {
    expect(canRematch({ state: 'quoted' }, { status: 'quote' })).toBe(true)
    expect(canRematch({ state: 'skipped' }, { status: 'quote' })).toBe(true)
    expect(canRematch({ state: 'applied' }, { status: 'applied' })).toBe(false)
    expect(canRematch({ state: 'quoted' }, { status: 'needs_match' })).toBe(false)
  })
})

describe('a newer Inventory price is kept, unless it is this document\'s own price typed in early', () => {
  test('black dig set posts typed from 06-251126 on Oct 20: not newer (within a cent of the printed price)', () => {
    expect(newerPriceKept({ unitCost: 10.96, priceUpdatedAt: '2026-10-20', priceImported: false }, '2026-10-19', 1095)).toBe(false)
    expect(newerPriceKept({ unitCost: 18.43, priceUpdatedAt: '2026-10-20', priceImported: false }, '2026-10-19', 1844)).toBe(false)
  })
  test('a different later price is kept (the older document goes into history only)', () => {
    expect(newerPriceKept({ unitCost: 12.0, priceUpdatedAt: '2026-10-20', priceImported: false }, '2026-10-19', 1095)).toBe(true)
  })
  test('an older or imported price is replaced', () => {
    expect(newerPriceKept({ unitCost: 12.0, priceUpdatedAt: '2026-10-01', priceImported: false }, '2026-10-19', 1095)).toBe(false)
    expect(newerPriceKept({ unitCost: 12.0, priceUpdatedAt: '2026-10-20', priceImported: true }, '2026-10-19', 1095)).toBe(false)
    expect(newerPriceKept({ unitCost: 0 }, '2026-10-19', 1095)).toBe(false)
  })
})

describe('two totals rows printed one above the other (06-251608)', () => {
  // The words as the PDF gives them: "Fuel Charge 25.00" over "Freight 125.00", read as one row.
  const w = (t: string, x: number, y: number, h = 0.014) => ({ t, x, y, w: 0.05, h, c: 1 })
  const words = [
    w('Call', 0.0196, 0.6898, 0.0128), w('today', 0.0702, 0.6898, 0.0128), w('email.', 0.4945, 0.6898, 0.0128),
    w('Fuel', 0.7055, 0.6826), w('Freight', 0.7055, 0.6947), w('Charge', 0.7608, 0.6826), w('125.00', 0.9153, 0.6947), w('25.00', 0.9263, 0.6826),
  ]
  test('each amount takes the label at its own height', () => {
    expect(splitStackedTotals({ words })).toEqual([
      { kind: 'freight', label: 'Freight', cents: 12500 },
      { kind: 'fee', label: 'Fuel Charge', cents: 2500 },
    ])
  })
  test('amounts on one line are a line, not stacked totals', () => {
    expect(splitStackedTotals({ words: [w('Fuel', 0.7, 0.5), w('Freight', 0.75, 0.5), w('125.00', 0.9, 0.5), w('25.00', 0.95, 0.5)] })).toBeNull()
  })
  test('the whole document reads: $1,871.60 + fuel $25 + freight $125 = $2,021.60', () => {
    const row = (i: number, cells: string[], ws = cells.join(' ').split(/\s+/).map((t, k) => w(t, 0.05 + k * 0.04, 0.3 + i * 0.012))): Row => ({ i, page: 1, text: cells.join('  '), cells, words: ws, conf: 1, box: { x: 0, y: 0.3 + i * 0.012, w: 1, h: 0.01 } })
    const rows: Row[] = [
      row(0, ['STEPHENS PIPE & STEEL']), row(1, ['QUOTATION #: 06-251608']), row(2, ['Billing Date : 10/23/2026']),
      row(3, ['Ordered', 'Shipped', 'BackOrder', 'Unit', 'Product Item Description', 'Price', 'Amount']),
      row(4, ['150', '150', '0 ft', 'VNL Ext GRN 2x9(13core)x48in KK 50ft/rll', '2.3165', '347.48']),
      row(5, ['147', '147', '0 ft', 'PLY GRN 1-3/8" x 21\' x PP40 x 7pc', '2.0762', '305.20']),
      row(6, ['652.68']),
      { i: 7, page: 1, text: 'Call today email.  Fuel Freight Charge  125.00 25.00', cells: ['Call today email.', 'Fuel Freight Charge', '125.00 25.00'], words, conf: 1, box: { x: 0, y: 0.68, w: 1, h: 0.02 } },
      row(8, ['802.68Total Order']),
    ]
    const p = parseInvoice([{ page: 1, rows }])
    expect(p).toMatchObject({ docType: 'quote', invoiceNumber: '06-251608', subtotalCents: 65268, freightCents: 12500, totalCents: 80268, taxFound: false })
    expect(p.fees).toEqual([expect.objectContaining({ label: 'Fuel Charge', cents: 2500 })])
  })
})
