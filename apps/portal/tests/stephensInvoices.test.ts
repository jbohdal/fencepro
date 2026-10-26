/**
 * Jonathan's real vendor documents: 17 quotations from Stephens Pipe & Steel
 * (text PDFs), read where he keeps them. They are not copied into the repo;
 * this file skips when the folder is not on this Mac.
 *
 * Every one must read and reconcile to the penny:
 *   lines (to the subtotal) + fuel + freight + tax = Total Order.
 * Also: QUOTATION (not an invoice), number, date, the $25 fuel charge, a tax
 * line on 14 of them (the 3 without are flagged for an OK), *Fab notes and
 * $0.00 lines skipped, the packing column taken out of the description, units
 * (ft, pc, ea, set, rll, lb), and which revision of a repeated quote is newer.
 */

import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { describe, test, expect } from 'vitest'
import { parseInvoice, type ParsedInvoice } from '../src/server/lib/invoiceParse'
import { checkTotals } from '../src/server/lib/invoiceMath'
import { revisionOf, newerRevision } from '../src/server/lib/vendorInvoices'

const DIR = process.env.STEPHENS_DIR || '/Users/jonathanbohdal/Downloads/stephens pipe and steel'
const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter(f => f.toLowerCase().endsWith('.pdf')).sort() : []
const canRead = process.platform === 'darwin' && (() => { try { execFileSync('xcrun', ['--find', 'swiftc'], { stdio: 'ignore' }); return true } catch { return false } })()

// Without a tax row (checked by hand against the PDFs).
const NO_TAX = ['06-249217', '06-249218', '06-249853']

describe.skipIf(!files.length || !canRead)("Stephens Pipe & Steel: Jonathan's 17 real quotations", () => {
  const read = new Map<string, ParsedInvoice>()
  const get = async (f: string) => {
    if (!read.has(f)) {
      const { readInvoiceFile } = await import('../src/server/lib/invoiceReader')
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'sps-'))
      try { read.set(f, parseInvoice((await readInvoiceFile(path.join(DIR, f), out)).pages)) } finally { fs.rmSync(out, { recursive: true, force: true }) }
    }
    return read.get(f)!
  }

  test('there are 17 files', () => expect(files).toHaveLength(17))

  test.each(files)('%s reads and reconciles to the penny', async f => {
    const p = await get(f)
    const fees = p.fees.reduce((s, x) => s + x.cents, 0)
    const c = checkTotals(p.lines, { ...p, feesCents: fees })
    expect(c.problems).toEqual([])
    expect(p.problems).toEqual([])
    // Lines + fuel + freight + tax = Total Order, to the penny.
    expect(p.lines.reduce((s, l) => s + l.totalCents!, 0)).toBe(p.subtotalCents)
    expect(p.subtotalCents! + fees + p.freightCents + p.taxCents).toBe(p.totalCents)
    expect(p.docType).toBe('quote')
    expect(p.vendorName).toBe('Stephens Pipe & Steel, LLC')
    expect(p.invoiceNumber).toBe(`06-${f.slice(1, 7)}`)
    expect(p.invoiceDate).toMatch(/^2026-(0[6-9]|10)-\d{2}$/)
    expect(p.fees).toEqual([expect.objectContaining({ label: 'Fuel Charge', cents: 2500 })])
    expect(p.taxFound).toBe(!NO_TAX.includes(p.invoiceNumber))
    for (const l of p.lines) {
      expect(['FT', 'PC', 'EA', 'SET', 'RLL', 'LB']).toContain(l.unit)
      expect(l.itemNumber).toBe('')
      expect(l.problems).toEqual([])
      expect(l.totalCents).toBeGreaterThan(0)
    }
    // Notes are never lines.
    expect(p.lines.some(l => l.description.startsWith('*'))).toBe(false)
  }, 60_000)

  test('the newest (06-249853, 10/6/2026): 22 lines, packing out of the description, *Fab note skipped, no tax', async () => {
    const p = await get(files.find(f => f.startsWith('6249853'))!)
    expect(p.invoiceDate).toBe('2026-10-06')
    expect(p.lines).toHaveLength(22)
    expect(p.lines[0]).toMatchObject({ description: 'HOT DIP 2-3/8x11.5x60in KK 50ft/rll', qty: 300, unit: 'FT', unitPriceHc: 22766, totalCents: 68298, packing: '6 rll' })
    expect(p.lines.find(l => l.unit === 'LB')).toMatchObject({ description: 'ALM HOG RING 9ga (220/lb)', qty: 5, totalCents: 6586 })
    expect(p.lines.find(l => l.unit === 'SET')).toMatchObject({ description: 'COLLAR 1-3/8in', qty: 1 })
    expect(p.skipped.map(s => s.why)).toContain('note')
    expect(p).toMatchObject({ subtotalCents: 276027, taxFound: false, totalCents: 278527 })
  })

  test('freight and tax when both are printed (06-238126, first revision)', async () => {
    const p = await get(files.find(f => f.startsWith('6238126') && f.includes('1161133'))!)
    expect(p).toMatchObject({ subtotalCents: 53113, freightCents: 12500, taxCents: 3983, totalCents: 72096, taxRate: '7.5%' })
  })

  test('a Fuel and Tax row printed on top of each other is split by the tax rate', async () => {
    const p = await get(files.find(f => f.startsWith('6238126') && f.includes('1172886'))!)
    expect(p).toMatchObject({ taxCents: 36980, totalCents: 532541 })
    expect(p.fees[0].cents).toBe(2500)
  })

  test('amounts with commas', async () => {
    const p = await get(files.find(f => f.startsWith('6249218'))!)
    expect(p.subtotalCents).toBe(4929672)
    expect(p.totalCents).toBe(4932172)
  })

  test('revisions: the same quote number twice, the higher document id is the newer one', async () => {
    const byNumber = new Map<string, string[]>()
    for (const f of files) { const n = (await get(f)).invoiceNumber; byNumber.set(n, [...(byNumber.get(n) ?? []), f]) }
    const repeated = [...byNumber.entries()].filter(([, fs2]) => fs2.length > 1)
    expect(repeated.map(([n]) => n).sort()).toEqual(['06-188237', '06-238126', '06-247840'])
    for (const [, [a, b]] of repeated) {
      const pa = await get(a), pb = await get(b)
      const ra = { invoiceDate: pa.invoiceDate, revision: revisionOf(a), createdAt: new Date(0) }
      const rb = { invoiceDate: pb.invoiceDate, revision: revisionOf(b), createdAt: new Date(0) }
      expect(newerRevision(rb, ra)).toBe(Number(revisionOf(b)) > Number(revisionOf(a)))
    }
    expect(revisionOf('6240192 Getter Done LLC-1210603 (1).pdf')).toBe('1210603')
  })
})
