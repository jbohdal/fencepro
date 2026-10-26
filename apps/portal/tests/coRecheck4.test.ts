/**
 * Change order re-check, round 4 (Oct 26 2026), the parts without a database:
 *
 * - every PDF writer draws only what its font has: "→" reads "to" (the signed
 *   change order said "40 ft !' 50 ft"), other characters mapped or dropped,
 *   and no PDF is made without the safe text (pdfDocument);
 * - the signed change order PDF states the contract before this change (and
 *   the change orders in it), this change, and the new contract total;
 * - the crew packet names a gate's side ("a walk gate in the Back side (4 ft
 *   of fence becomes the gate)", not "added a walk gate and removed 4 ft") and
 *   labels runs by their side names.
 */

import fs from 'fs'
import path from 'path'
import { describe, test, expect } from 'vitest'
import { pdfText } from './pdfText'
import { pdfSafeText, pdfCanDraw, pdfDocument } from '../src/server/lib/pdfText.js'
import { changeOrderPdf, contractMadeOf } from '../src/server/lib/changeOrderPdf.js'
import { ownWhat, packetWithChange, type PacketChange } from '../src/server/lib/changeOrderWork.js'
import { sideGateChanges, shapeOf } from '../src/server/lib/changeOrderMerge.js'

const docBuffer = (draw: (d: PDFKit.PDFDocument) => void) => new Promise<Buffer>(res => {
  const d = pdfDocument({ size: 'LETTER', margin: 48 })
  const chunks: Buffer[] = []
  d.on('data', b => chunks.push(b)); d.on('end', () => res(Buffer.concat(chunks)))
  draw(d); d.end()
})

describe('PDF text the font can draw', () => {
  test('"→" reads "to", with one space either side', () => {
    expect(pdfSafeText('Left side 40 ft → 50 ft')).toBe('Left side 40 ft to 50 ft')
    expect(pdfSafeText('40→50')).toBe('40 to 50')
    expect(pdfSafeText('(Left side 40 ft → 50 ft)')).toBe('(Left side 40 ft to 50 ft)')
  })
  test('other characters are mapped, accents kept or made plain, pictures dropped', () => {
    expect(pdfSafeText('≥ 6 ft, ≤ 8 ft, − $5')).toBe('>= 6 ft, <= 8 ft, - $5')
    expect(pdfSafeText('Zoë Ősz ✓ done 👍 ok')).toBe('Zoë Osz Yes done  ok')
    expect(pdfSafeText('9:55 AM')).toBe('9:55 AM')
    expect(pdfSafeText('⅜ in post cap')).toBe('3/8 in post cap')
  })
  test('what the font has is left exactly as it is', () => {
    const s = 'Café — “quoted” ‘yes’ • €5 … ½ ° © ™'
    expect(pdfSafeText(s)).toBe(s)
  })
  test('the result is always drawable', () => {
    const all = Array.from({ length: 0x2700 }, (_, i) => String.fromCodePoint(i)).join('') + '😀🏠✅'
    expect([...pdfSafeText(all)].every(pdfCanDraw)).toBe(true)
  })
  test('a PDF made with pdfDocument has no garbled arrow', async () => {
    const t = pdfText(await docBuffer(d => { d.font('Helvetica').text('Back 40 ft → 50 ft'); d.text('Zoë ≥ 6 ft') }))
    expect(t).toContain('Back 40 ft to 50 ft')
    expect(t).toContain('Zoë >= 6 ft')
    expect(t).not.toContain("!'")
  })
  test('every PDF writer (contracts, change orders, walkthrough certificate, receipts, pull sheets, permits, invoices) uses pdfDocument', () => {
    const root = path.resolve(__dirname, '../src/server')
    const files: string[] = []
    const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) files.push(p) } }
    walk(root)
    const raw = files.filter(f => !f.endsWith('pdfText.ts') && /new PDFDocument\(/.test(fs.readFileSync(f, 'utf8')))
    expect(raw).toEqual([])
    for (const f of ['lib/contractPdf.ts', 'lib/changeOrderPdf.ts', 'lib/walkthroughCertificate.ts', 'lib/receiptPdf.ts', 'lib/pullSheetPdf.ts', 'lib/automations/permits.ts', 'routes/invoices.ts']) {
      expect(fs.readFileSync(path.join(root, f), 'utf8')).toMatch(/pdfDocument\(/)
    }
  })
})

describe('the signed change order PDF', () => {
  const base = {
    company: { name: 'Getter Done Fence', phone: '3528442677', email: '' }, number: 1, customerName: 'R3S Nora Quinn', address: '3011 SE 18th Ave, Ocala, FL 34471',
    reason: 'Changed after the quote was signed.', lines: [{ id: 'a', description: 'Add 10 ft of fence, 2 panels more (Left side 40 ft → 50 ft)', amountCents: 49200 }],
    totalCents: 49200, originalCents: 564000, signedBy: 'R3S Nora Quinn', signedVia: 'in_person', contractRev: 3, signature: null,
    record: { at: new Date('2026-10-26T13:55:08Z'), ip: '127.0.0.1', accepted: 'Change order CO-1: total $492.00' },
  }
  test('says the contract before (with CO-2 in it), this change, and the new total; the arrow reads "to"', async () => {
    const t = pdfText(await changeOrderPdf({ ...base, contract: { beforeCents: 653200, afterCents: 702400, quoteCents: 564000, earlier: [{ number: 2, totalCents: 89200 }], adjustmentsCents: 0 } }))
    expect(t).toContain('(Left side 40 ft to 50 ft)')
    expect(t).not.toContain("!'")
    expect(t).toContain('Your contract before this change $6,532.00')
    expect(t).toContain('The price you signed, $5,640.00, plus CO-2 +$892.00 (a change order approved before this one).')
    expect(t).toContain('This change +$492.00')
    expect(t).toContain('New contract total $7,024.00')
    expect(t).not.toContain('The original price was')
  })
  test('the first change order: before is the price signed', async () => {
    const t = pdfText(await changeOrderPdf({ ...base, contract: { beforeCents: 564000, afterCents: 613200, quoteCents: 564000, earlier: [], adjustmentsCents: 0 } }))
    expect(t).toContain('Your contract before this change $5,640.00 The price you signed.')
    expect(t).toContain('New contract total $6,132.00')
  })
  test('words for several change orders and an adjustment, and a credit', () => {
    expect(contractMadeOf({ quoteCents: 500000, earlier: [{ number: 1, totalCents: 10000 }, { number: 3, totalCents: -5000 }], adjustmentsCents: -2500 }))
      .toBe('The price you signed, $5,000.00, plus CO-1 +$100.00, CO-3 -$50.00 and contract adjustments -$25.00 (change orders approved before this one).')
  })
})

describe('the crew packet names the side', () => {
  const side = (id: string, name: string, ft: number, gate?: { type: 'walk' | 'double'; widthIn?: number }) => ({ id, name, on: true, lengthIn: ft * 12, ...(gate ? { gate: { ...gate, position: 'middle' } } : {}) })
  const yard = (...sides: unknown[]) => ({ sides })
  const work = (before: unknown[], after: unknown[], runs: number[]) => ({ base: { fenceStyle: 'WV', runs, yard: yard(...before) }, fenceStyle: 'WV', runs, layout: { yard: yard(...after) } })

  test('a walk gate put into the Back side', () => {
    const w = work([side('l', 'Left side', 40), side('b', 'Back', 60)], [side('l', 'Left side', 40), side('b', 'Back', 60, { type: 'walk', widthIn: 48 })], [40, 56])
    expect(ownWhat({ work: w, scope: { footageFt: -4, walkGates: 1 }, lines: [] })).toBe('added a walk gate in the Back side (4 ft of fence becomes the gate)')
  })
  test('a gate taken out, a gate changed, a side made longer', () => {
    const w = work(
      [side('l', 'Left side', 40), side('b', 'Back', 60, { type: 'walk' }), side('f', 'Front', 20, { type: 'walk' })],
      [side('l', 'Left side', 50), side('b', 'Back', 60), side('f', 'Front', 20, { type: 'double', widthIn: 120 })], [50, 60, 10])
    expect(sideGateChanges(shapeOf(w.base), shapeOf(w)).map(g => g.words)).toEqual(['the walk gate in the Back side taken out', 'the gate in the Front side is now a double gate (10 ft)'])
    expect(ownWhat({ work: w, scope: {}, lines: [] })).toBe('the walk gate in the Back side taken out, the gate in the Front side is now a double gate (10 ft) and Left side 40 ft → 50 ft')
  })
  test('no gate change: as before', () => {
    const w = work([side('l', 'Left side', 40)], [side('l', 'Left side', 50)], [50])
    expect(ownWhat({ work: w, scope: { footageFt: 10 }, lines: [] })).toBe('added 10 ft (Left side 40 ft → 50 ft)')
  })
  test('runs are labeled by the drawing\'s side names', () => {
    const c = { number: 2, rev: 3, approvedAt: new Date(), what: 'x', all: [], runNames: ['Left side', 'Back (1 of 2)', 'Back (2 of 2)'],
      work: { fenceStyle: 'WV', runs: [40, 26, 30], walkGates: 1, dblGates: 0, sections: 13, footage: 96, layout: { runSections: [5, 4, 4] }, planSvg: null, pullSheet: [] } } as unknown as PacketChange
    const s = packetWithChange({ runs: [] } as Record<string, any>, c)
    expect(s.runs.map((r: any) => r.label)).toEqual(['Left side', 'Back (1 of 2)', 'Back (2 of 2)'])
    expect(packetWithChange({ runs: [] } as Record<string, any>, { ...c, runNames: null }).runs.map((r: any) => r.label)).toEqual(['Run 1', 'Run 2', 'Run 3'])
  })
})
