/**
 * Makes the test invoices in tests/fixtures/invoices (made up vendors and
 * numbers, for tests only):
 *
 *   text.pdf          a text PDF: $1,000 subtotal, $70 tax, $50 freight
 *   two-page.pdf      lines on two pages, totals on the second
 *   photo.jpg         a phone photo of a paper invoice (tilted, grainy)
 *   scanned.pdf       the same photo inside a PDF (no text in it)
 *   bad-line.pdf      a line whose quantity x price is not its amount
 *   jump.pdf          tension bars well over 20% dearer than text.pdf's landed $3.36
 *   text-again.pdf    text.pdf drawn again: a different file, the same vendor and number
 *
 *   pnpm exec tsx scripts/make-test-invoices.ts
 *
 * The photo is drawn with the Mac's own tools: the PDF page is turned into a
 * picture (tools/invoice-reader.swift), then ffmpeg tilts it and adds grain.
 */

import fs from 'fs'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import PDFDocument from 'pdfkit'
import { readerBinary } from '../src/server/lib/invoiceReader.js'

const OUT = fileURLToPath(new URL('../tests/fixtures/invoices', import.meta.url))
const FFMPEG = process.env.FFMPEG_BIN || '/opt/homebrew/bin/ffmpeg'

export interface FixtureLine { item: string; desc: string; qty: number; um: string; price: string; amount: string }
export interface FixtureInvoice {
  vendor: string[]
  number: string
  date: string
  lines: FixtureLine[]
  subtotal: string
  tax: string
  freight?: string
  fuel?: string
  total: string
  /** Lines per page; the rest go on the next page. */
  perPage?: number
}

export const TEXT: FixtureInvoice = {
  vendor: ['GULF COAST FENCE SUPPLY', '1200 SW College Rd, Ocala FL 34471', '(352) 555-0142'],
  number: 'GC-10442', date: '10/02/2026',
  lines: [
    { item: 'HR-100', desc: 'Hog Rings Alum 1/2in Box of 100', qty: 4, um: 'BX', price: '25.00', amount: '100.00' },
    { item: 'TB-48G', desc: 'Tension Bar Galv 48in', qty: 60, um: 'EA', price: '3.00', amount: '180.00' },
    { item: 'PP-258', desc: 'Pipe Galv 2-1/2in x 8ft SS40', qty: 10, um: 'EA', price: '28.00', amount: '280.00' },
    { item: 'FAB-48K', desc: 'Fabric Galv 48in KK 50ft Roll', qty: 4, um: 'RL', price: '110.00', amount: '440.00' },
  ],
  subtotal: '1,000.00', tax: '70.00', freight: '50.00', total: '1,120.00',
}

export const TWO_PAGE: FixtureInvoice = {
  vendor: ['GULF COAST FENCE SUPPLY', '1200 SW College Rd, Ocala FL 34471', '(352) 555-0142'],
  number: 'GC-10518', date: '10/09/2026', perPage: 6,
  lines: [
    { item: 'HR-100', desc: 'Hog Rings Alum 1/2in Box of 100', qty: 2, um: 'BX', price: '25.00', amount: '50.00' },
    { item: 'TB-48G', desc: 'Tension Bar Galv 48in', qty: 30, um: 'EA', price: '3.00', amount: '90.00' },
    { item: 'PP-258', desc: 'Pipe Galv 2-1/2in x 8ft SS40', qty: 6, um: 'EA', price: '28.00', amount: '168.00' },
    { item: 'FAB-48K', desc: 'Fabric Galv 48in KK 50ft Roll', qty: 2, um: 'RL', price: '110.00', amount: '220.00' },
    { item: 'TP-158', desc: 'Pipe Galv 1-5/8in x 8ft SS40', qty: 12, um: 'EA', price: '16.50', amount: '198.00' },
    { item: 'BB-238', desc: 'Brace Band Galv 2-3/8in', qty: 40, um: 'EA', price: '0.70', amount: '28.00' },
    { item: 'TBD-238', desc: 'Tension Band Galv 2-3/8in', qty: 80, um: 'EA', price: '0.65', amount: '52.00' },
    { item: 'CAP-238', desc: 'Post Cap Alum 2-3/8in', qty: 20, um: 'EA', price: '0.95', amount: '19.00' },
    { item: 'TW-9', desc: 'Tie Wire Alum 9ga Bundle of 100', qty: 3, um: 'BDL', price: '14.00', amount: '42.00' },
  ],
  subtotal: '867.00', tax: '60.69', freight: '35.00', fuel: '7.50', total: '970.19',
}

export const PHOTO: FixtureInvoice = {
  vendor: ['OCALA VINYL WHOLESALE', '455 NE 36th Ave, Ocala FL 34470'],
  number: '58213', date: '09/30/2026',
  lines: [
    { item: 'WV55-78C', desc: 'Vinyl White Corner Post 5x5x78', qty: 12, um: 'EA', price: '11.50', amount: '138.00' },
    { item: 'WV-PK62', desc: 'Vinyl White Picket 62-1/4', qty: 200, um: 'EA', price: '2.80', amount: '560.00' },
    { item: 'WV-R8', desc: 'Vinyl White Rail 8ft', qty: 30, um: 'EA', price: '9.40', amount: '282.00' },
  ],
  subtotal: '980.00', tax: '68.60', freight: '45.00', total: '1,093.60',
}

export const BAD_LINE: FixtureInvoice = {
  vendor: ['GULF COAST FENCE SUPPLY', '1200 SW College Rd, Ocala FL 34471'],
  number: 'GC-10600', date: '10/16/2026',
  lines: [
    { item: 'HR-100', desc: 'Hog Rings Alum 1/2in Box of 100', qty: 4, um: 'BX', price: '25.00', amount: '100.00' },
    // 60 x 3.00 is 180.00, not 210.00: the line does not add up.
    { item: 'TB-48G', desc: 'Tension Bar Galv 48in', qty: 60, um: 'EA', price: '3.00', amount: '210.00' },
  ],
  subtotal: '310.00', tax: '21.70', total: '331.70',
}

export const JUMP: FixtureInvoice = {
  vendor: ['GULF COAST FENCE SUPPLY', '1200 SW College Rd, Ocala FL 34471'],
  number: 'GC-10701', date: '10/15/2026',
  lines: [
    // Tension bars: $4.40, 31% over text.pdf's landed $3.36 (47% over the $3.00 before it). Hog rings about the same.
    { item: 'TB-48G', desc: 'Tension Bar Galv 48in', qty: 100, um: 'EA', price: '4.40', amount: '440.00' },
    { item: 'HR-100', desc: 'Hog Rings Alum 1/2in Box of 100', qty: 4, um: 'BX', price: '25.00', amount: '100.00' },
  ],
  subtotal: '540.00', tax: '0.00', total: '540.00',
}

function drawInvoice(inv: FixtureInvoice, file: string, title = inv.number): Promise<void> {
  return new Promise(resolve => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: title } })
    const out = fs.createWriteStream(file)
    doc.pipe(out)
    const perPage = inv.perPage ?? inv.lines.length
    const pages = Math.ceil(inv.lines.length / perPage)
    const cols = { item: 48, desc: 130, qty: 360, um: 400, price: 440, amount: 510 }
    for (let p = 0; p < pages; p++) {
      if (p > 0) doc.addPage()
      doc.font('Helvetica-Bold').fontSize(16).text(inv.vendor[0], 48, 48)
      doc.font('Helvetica').fontSize(9)
      inv.vendor.slice(1).forEach((l, i) => doc.text(l, 48, 70 + i * 12))
      doc.font('Helvetica-Bold').fontSize(14).text('INVOICE', 430, 48)
      doc.font('Helvetica').fontSize(10)
      doc.text(`Invoice No: ${inv.number}`, 430, 70)
      doc.text(`Invoice Date: ${inv.date}`, 430, 84)
      doc.text(`Page ${p + 1} of ${pages}`, 430, 98)
      doc.text('Sold To: Getter Done Fence', 48, 120)
      let y = 160
      doc.font('Helvetica-Bold').fontSize(9)
      doc.text('ITEM #', cols.item, y); doc.text('DESCRIPTION', cols.desc, y); doc.text('QTY', cols.qty, y)
      doc.text('UM', cols.um, y); doc.text('PRICE', cols.price, y); doc.text('AMOUNT', cols.amount, y)
      doc.moveTo(48, y + 13).lineTo(570, y + 13).stroke()
      doc.font('Helvetica').fontSize(10)
      y += 22
      for (const l of inv.lines.slice(p * perPage, (p + 1) * perPage)) {
        doc.text(l.item, cols.item, y); doc.text(l.desc, cols.desc, y, { width: 225, lineBreak: false })
        doc.text(String(l.qty), cols.qty, y, { width: 30, align: 'right' }); doc.text(l.um, cols.um, y)
        doc.text(l.price, cols.price, y, { width: 55, align: 'right' }); doc.text(l.amount, cols.amount, y, { width: 60, align: 'right' })
        y += 20
      }
      if (p === pages - 1) {
        y += 20
        const tot = (label: string, v: string) => { doc.text(label, 400, y); doc.text(v, cols.amount, y, { width: 60, align: 'right' }); y += 16 }
        tot('Subtotal', inv.subtotal)
        tot('Sales Tax', inv.tax)
        if (inv.freight) tot('Freight', inv.freight)
        if (inv.fuel) tot('Fuel Surcharge', inv.fuel)
        doc.font('Helvetica-Bold')
        tot('TOTAL', inv.total)
        doc.font('Helvetica')
        doc.text('Terms: Net 30. Thank you for your business.', 48, 700)
      } else {
        doc.text('Continued on next page', 48, 700)
      }
    }
    doc.end()
    out.on('finish', () => resolve())
  })
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  await drawInvoice(TEXT, path.join(OUT, 'text.pdf'))
  await drawInvoice(TWO_PAGE, path.join(OUT, 'two-page.pdf'))
  await drawInvoice(BAD_LINE, path.join(OUT, 'bad-line.pdf'))
  await drawInvoice(JUMP, path.join(OUT, 'jump.pdf'))
  await drawInvoice(TEXT, path.join(OUT, 'text-again.pdf'), `${TEXT.number} (copy)`)
  // The photo: draw the page, take its picture, tilt it and add grain like a phone shot.
  const tmp = fs.mkdtempSync(path.join(OUT, '.tmp-'))
  try {
    await drawInvoice(PHOTO, path.join(tmp, 'photo-src.pdf'))
    execFileSync(await readerBinary(), [path.join(tmp, 'photo-src.pdf'), tmp])
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', path.join(tmp, 'page-1.jpg'),
      '-vf', 'scale=iw*1.4:-1,rotate=2.2*PI/180:fillcolor=0xe8e4da:ow=rotw(2.2*PI/180):oh=roth(2.2*PI/180),eq=brightness=-0.04:contrast=0.9,noise=alls=14:allf=t',
      '-q:v', '4', path.join(OUT, 'photo.jpg')])
    // The same photo as a scanned PDF (no text layer).
    await new Promise<void>(resolve => {
      const doc = new PDFDocument({ size: 'LETTER', margin: 0 })
      const out = fs.createWriteStream(path.join(OUT, 'scanned.pdf'))
      doc.pipe(out)
      doc.image(path.join(OUT, 'photo.jpg'), 0, 0, { fit: [612, 792] })
      doc.end()
      out.on('finish', () => resolve())
    })
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
  console.log('Test invoices written to', OUT)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error(err); process.exit(1) })
}
