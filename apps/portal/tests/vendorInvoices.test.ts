/**
 * Vendor invoices, the rules without a database: reading the test invoices
 * (text PDF, two pages, a photo of paper, a scanned PDF), the total check,
 * spreading tax and freight, units, matching keys, the 20% hold.
 * Reading needs this Mac's Vision (macOS with swiftc); elsewhere those tests skip.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { describe, test, expect } from 'vitest'
import { checkTotals, spreadExtras, toInventoryQty, unitLanded, needsOk, changePct, matchKey, invoiceNumberKey } from '../src/server/lib/invoiceMath'
import { parseInvoice, moneyToCents, moneyToHc, parseDate, totalKind, lineAddsUp, findVendor } from '../src/server/lib/invoiceParse'
import { lineProblemsFor, suggestItems, vendorTotalsByMonth } from '../src/server/lib/vendorInvoices'
import { wordsToRows } from '../src/server/lib/invoiceReader'

const FIX = path.resolve(__dirname, 'fixtures/invoices')
const canRead = process.platform === 'darwin' && (() => { try { execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' }); return true } catch { return false } })()

describe('spreading tax, freight and fees (landed cost)', () => {
  test('$100 line on a $1,000 subtotal with $70 tax and $50 freight carries $12 extra', () => {
    const lines = [10000, 18000, 28000, 44000]
    const extras = spreadExtras(lines, 7000 + 5000)
    expect(extras[0]).toBe(1200)
    expect(extras).toEqual([1200, 2160, 3360, 5280])
  })
  test('the extras always add up exactly (largest remainder)', () => {
    expect(spreadExtras([100, 100, 100], 100)).toEqual([34, 33, 33])
    for (let k = 0; k < 200; k++) {
      const lines = Array.from({ length: 1 + (k % 9) }, (_, i) => 137 * (i + 1) + k * 7)
      const extra = (k * 9973) % 50000
      const s = spreadExtras(lines, extra)
      expect(s.reduce((a, b) => a + b, 0)).toBe(extra)
      expect(s.every(x => x >= 0)).toBe(true)
    }
  })
  test('a discount (negative fee) spreads too, and still adds up', () => {
    const s = spreadExtras([10000, 20000], -301)
    expect(s.reduce((a, b) => a + b, 0)).toBe(-301)
  })
  test('credit lines get no share', () => {
    expect(spreadExtras([10000, -2000, 10000], 1000)).toEqual([500, 0, 500])
  })
  test('unit landed cost: 4 boxes of 100 for $100 + $12 = $0.28 each', () => {
    const qty = toInventoryQty(4, { vendorPer: 1, invPer: 100 })
    expect(qty).toBe(400)
    expect(unitLanded(10000, 1200, qty)).toEqual({ cents: 28, exact: 28 })
  })
  test('rounds half up to the cent and keeps the exact value', () => {
    const u = unitLanded(21000, 1470, 60) // 224.70 / 60 = 3.745
    expect(u.cents).toBe(375)
    expect(u.exact).toBeCloseTo(374.5, 6)
  })
})

describe('units', () => {
  test('box of 100 to each', () => expect(toInventoryQty(3, { vendorPer: 1, invPer: 100 })).toBe(300))
  test('bundle of 10 to each', () => expect(toInventoryQty(2, { vendorPer: 1, invPer: 10 })).toBe(20))
  test('per foot to a 50 ft roll', () => expect(toInventoryQty(150, { vendorPer: 50, invPer: 1 })).toBe(3))
  test('each to each', () => expect(toInventoryQty(7, { vendorPer: 1, invPer: 1 })).toBe(7))
  test('a zero conversion is refused', () => expect(() => toInventoryQty(1, { vendorPer: 0, invPer: 1 })).toThrow())
})

describe('the total check', () => {
  const ok = { subtotalCents: 100000, taxCents: 7000, freightCents: 5000, feesCents: 0, totalCents: 112000 }
  const lines = [10000, 18000, 28000, 44000].map(c => ({ totalCents: c, problems: [] as string[] }))
  test('lines + tax + freight + fees = total passes', () => expect(checkTotals(lines, ok).ok).toBe(true))
  test('a line that does not add up stops it', () => {
    const r = checkTotals([...lines.slice(0, 3), { totalCents: 44000, problems: ['math'] }], ok)
    expect(r.ok).toBe(false)
    expect(r.problems).toEqual([{ kind: 'unclear_lines', lines: [3] }])
  })
  test('lines that miss the subtotal stop it', () => {
    const r = checkTotals(lines.slice(0, 3), ok)
    expect(r.problems.map(p => p.kind)).toContain('subtotal')
  })
  test('a total one cent off stops it', () => {
    const r = checkTotals(lines, { ...ok, totalCents: 112001 })
    expect(r.problems).toEqual([{ kind: 'total', computedCents: 112000, totalCents: 112001 }])
  })
  test('no printed subtotal: the lines are the subtotal', () => expect(checkTotals(lines, { ...ok, subtotalCents: null }).ok).toBe(true))
  test('no total read: stops it', () => expect(checkTotals(lines, { ...ok, totalCents: null }).ok).toBe(false))
  test('an ignored line is left out', () => expect(checkTotals([...lines, { totalCents: 999, problems: ['math'], ignored: true }], ok).ok).toBe(true))
})

describe('the 20% hold', () => {
  test('30% up waits', () => expect(needsOk(300, 390, 20)).toBe(true))
  test('30% down waits', () => expect(needsOk(300, 210, 20)).toBe(true))
  test('exactly 20% applies', () => expect(needsOk(300, 360, 20)).toBe(false))
  test('12% applies', () => expect(needsOk(300, 336, 20)).toBe(false))
  test('no earlier price: nothing to compare, applies', () => expect(needsOk(null, 999, 20)).toBe(false))
  test('the limit is a setting', () => expect(needsOk(300, 390, 35)).toBe(false))
  test('percent change', () => expect(changePct(300, 390)).toBeCloseTo(30, 9))
})

describe('matching and duplicates keys', () => {
  test('by item number first, else by description', () => {
    expect(matchKey(' hr-100 ', 'Hog rings')).toBe('item:HR-100')
    expect(matchKey('', 'Hog Rings, Alum 1/2"')).toBe('desc:hog rings alum 1 2')
  })
  test('invoice numbers compare without INV, #, spaces or leading zeros', () => {
    expect(invoiceNumberKey('INV #00123')).toBe(invoiceNumberKey('123'))
    expect(invoiceNumberKey('GC-10442')).toBe('GC10442')
  })
  test('suggestions are only suggestions, best first; the same item number ranks first', () => {
    const items = [{ id: 'a', name: 'G, Tension Bar, 48"' }, { id: 'b', name: 'Pipe, Galv, 2-1/2" X 8\' (SS40)' }, { id: 'c', name: 'Hog ring', sku: 'HR-100' }]
    expect(suggestItems({ itemNumber: 'TB-48G', description: 'Tension Bar Galv 48in' }, items)[0].id).toBe('a')
    expect(suggestItems({ itemNumber: 'HR-100', description: 'whatever' }, items)[0]).toMatchObject({ id: 'c', why: 'Same item number' })
  })
  test('a vendor is found by its name or a name its invoices use', () => {
    const v = [{ id: '1', name: 'Gulf Coast Fence Supply, Inc.' }, { id: '2', name: 'Ocala Vinyl', aliases: ['OCALA VINYL WHOLESALE'] }]
    expect(findVendor('GULF COAST FENCE SUPPLY\n1200 SW College Rd', v)?.id).toBe('1')
    expect(findVendor('OCALA VINYL WHOLESALE', v)?.id).toBe('2')
    expect(findVendor('Some Other Supply', v)).toBeNull()
  })
})

describe('numbers, dates and labels', () => {
  test('money', () => {
    expect(moneyToCents('$1,093.60')).toBe(109360)
    expect(moneyToCents('(12.00)')).toBe(-1200)
    expect(moneyToCents('12.00-')).toBe(-1200)
    expect(moneyToCents('0.0425')).toBeNull()
    expect(moneyToHc('0.0425')).toBe(425)
    expect(moneyToCents('12a')).toBeNull()
  })
  test('dates', () => {
    expect(parseDate('Invoice Date: 10/02/2026')).toBe('2026-10-02')
    expect(parseDate('10-2-26')).toBe('2026-10-02')
    expect(parseDate('Oct 2, 2026')).toBe('2026-10-02')
    expect(parseDate('13/45/2026')).toBeNull()
  })
  test('total labels', () => {
    expect(totalKind('Subtotal')).toBe('subtotal')
    expect(totalKind('Sales Tax 7%')).toBe('tax')
    expect(totalKind('Delivery Charge')).toBe('freight')
    expect(totalKind('Fuel Surcharge')).toBe('fee')
    expect(totalKind('Amount Due')).toBe('total')
    expect(totalKind('Total Qty')).toBeNull()
    expect(totalKind('Page Total')).toBeNull()
  })
  test('a line adds up to the cent, per hundred too', () => {
    expect(lineAddsUp(60, 30000, 18000)).toBe(true)
    expect(lineAddsUp(60, 30000, 21000)).toBe(false)
    expect(lineAddsUp(500, 425, 2125)).toBe(true) // 500 x $0.0425
    expect(lineAddsUp(500, 1250000, 62500, 'C')).toBe(true) // $125.00 per hundred
  })
  test('a fixed line is checked again; a confirmed one keeps only what a person cannot clear', () => {
    expect(lineProblemsFor({ qty: 60, unitPriceHc: 30000, totalCents: 21000, unit: 'EA', conf: 1, edited: true })).toEqual(['math'])
    expect(lineProblemsFor({ qty: 60, unitPriceHc: 30000, totalCents: 18000, unit: 'EA', conf: 0.2, edited: false })).toEqual(['unclear'])
    expect(lineProblemsFor({ qty: null, unitPriceHc: 30000, totalCents: 18000, unit: 'EA', conf: 1, edited: true })).toEqual(['no_quantity'])
  })
})

describe('rows from a tilted photo', () => {
  test('words on one tilted line land on one row', () => {
    const tilt = 0.04 // about 2.3 degrees
    const words = [0.1, 0.3, 0.5, 0.7, 0.9].flatMap((x, i) => [0.2, 0.23, 0.26].map((y, r) => ({ t: `r${r}w${i}`, x, y: y + x * tilt, w: 0.05, h: 0.012, c: 1, l: r })))
    const rows = wordsToRows(words, 1, 1)
    expect(rows.length).toBe(3)
    expect(rows[0].cells.join(' ')).toBe('r0w0 r0w1 r0w2 r0w3 r0w4')
  })
})

describe('vendor totals by month', () => {
  test('bills add up per vendor per month; void bills are left out', () => {
    const r = vendorTotalsByMonth(
      [{ id: 'v1', name: 'Gulf Coast' }, { id: 'v2', name: 'Ocala Vinyl' }],
      [
        { vendorId: 'v1', billDate: '2026-10-02', totalCents: 112000, status: 'received' },
        { vendorId: 'v1', billDate: '2026-10-09', totalCents: 97019, status: 'paid' },
        { vendorId: 'v2', billDate: '2026-09-30', totalCents: 109360, status: 'received' },
        { vendorId: 'v2', billDate: '2026-09-30', totalCents: 5000, status: 'void' },
      ], 3, '2026-10-19')
    expect(r.months).toEqual(['2026-08', '2026-09', '2026-10'])
    expect(r.rows[0]).toMatchObject({ name: 'Gulf Coast', totalCents: 209019, bills: 2, byMonth: { '2026-10': 209019 } })
    expect(r.rows[1]).toMatchObject({ name: 'Ocala Vinyl', totalCents: 109360, bills: 1 })
  })
})

describe.skipIf(!canRead)('reading the test invoices on this Mac (Vision)', () => {
  const read = async (file: string) => {
    const { readInvoiceFile } = await import('../src/server/lib/invoiceReader')
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'inv-'))
    try {
      const r = await readInvoiceFile(path.join(FIX, file), out)
      return { r, p: parseInvoice(r.pages, [{ id: 'g', name: 'Gulf Coast Fence Supply' }]) }
    } finally { fs.rmSync(out, { recursive: true, force: true }) }
  }
  const check = (p: ReturnType<typeof parseInvoice>) => checkTotals(p.lines, { ...p, feesCents: p.fees.reduce((s, f) => s + f.cents, 0) })

  test('a text PDF is read from its text, and adds up', async () => {
    const { r, p } = await read('text.pdf')
    expect(r.engine).toBe('pdf-text')
    expect(p).toMatchObject({ vendorName: 'Gulf Coast Fence Supply', invoiceNumber: 'GC-10442', invoiceDate: '2026-10-02', subtotalCents: 100000, taxCents: 7000, freightCents: 5000, totalCents: 112000 })
    expect(p.lines.map(l => [l.itemNumber, l.qty, l.unit, l.unitPriceHc, l.totalCents])).toEqual([
      ['HR-100', 4, 'BX', 250000, 10000], ['TB-48G', 60, 'EA', 30000, 18000], ['PP-258', 10, 'EA', 280000, 28000], ['FAB-48K', 4, 'RL', 1100000, 44000],
    ])
    expect(check(p).ok).toBe(true)
  }, 120_000)
  test('a two page invoice: lines from both pages, totals and a fuel surcharge from the last', async () => {
    const { p } = await read('two-page.pdf')
    expect(p.lines).toHaveLength(9)
    expect(p.lines.map(l => l.page)).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2])
    expect(p.fees).toEqual([expect.objectContaining({ label: 'Fuel Surcharge', cents: 750 })])
    expect(check(p).ok).toBe(true)
  }, 120_000)
  test('a photo of paper (tilted, grainy) is read by the Mac and adds up', async () => {
    const { r, p } = await read('photo.jpg')
    expect(r.engine).toBe('vision')
    expect(p).toMatchObject({ vendorName: 'OCALA VINYL WHOLESALE', invoiceNumber: '58213', invoiceDate: '2026-09-30', totalCents: 109360 })
    expect(p.lines.map(l => [l.itemNumber, l.qty, l.totalCents])).toEqual([['WV55-78C', 12, 13800], ['WV-PK62', 200, 56000], ['WV-R8', 30, 28200]])
    expect(check(p).ok).toBe(true)
  }, 120_000)
  test('a scanned PDF (only a picture inside) is read by the Mac too', async () => {
    const { r, p } = await read('scanned.pdf')
    expect(r.pages[0].source).toBe('ocr')
    expect(check(p).ok).toBe(true)
  }, 120_000)
  test('a line that does not add up is found, and the invoice does not pass', async () => {
    const { p } = await read('bad-line.pdf')
    expect(p.lines[1].problems).toContain('math')
    expect(check(p).ok).toBe(false)
  }, 120_000)
})
