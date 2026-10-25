/**
 * A signed change order as a PDF (pdfkit), in the contract's look
 * (lib/contractPdf.ts): the change order's number, the customer and property,
 * the reason, each line and its amount, the total, the original price, and on
 * the last page the customer's signature with the signed record (typed name,
 * date and time with the time zone, IP, what was approved).
 *
 * Made once, when the customer signs (lib/signedDocuments.ts), from the change
 * order as it was signed; never a cost.
 */

import PDFDocument from 'pdfkit'
import { logoPath } from '../routes/proposal.js'
import { drawSignedRecord, type SignedRecord } from './contractPdf.js'
import type { ChangeOrderLine } from './changeOrders.js'

const PURPLE = '#5E28A1', INK = '#1C1030', GRAY = '#5F5769', LINE = '#E2DCEC'
const usd = (cents: number) => (cents < 0 ? '-' : '') + '$' + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const phoneText = (p: string) => { const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : p }

export interface ChangeOrderPdfInput {
  company: { name: string; phone: string; email: string }
  number: number
  customerName: string
  address: string
  reason: string
  lines: ChangeOrderLine[]
  totalCents: number
  /** The signed quote's price, in cents. */
  originalCents: number
  signedBy: string
  signedVia: string | null
  /** The contract revision it made (rev 1 is the contract as signed). */
  contractRev?: number | null
  /** The warranty it changes the contract to (no dig <-> dig set), and the one before. */
  warrantyBefore?: { name: string; text: string } | null
  warrantyAfter?: { name: string; text: string } | null
  signature: Buffer | null
  record: SignedRecord
}

/** "Change order CO-2: total $450.00" (a credit: "total credit -$75.00"). */
export function changeOrderAcceptedText(number: number, totalCents: number): string {
  return `Change order CO-${number}: ${totalCents < 0 ? 'total credit' : 'total'} ${usd(totalCents)}`
}

export function changeOrderPdf(c: ChangeOrderPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: `Signed change order #${c.number} - ${c.customerName}`, Author: c.company.name } })
    const chunks: Buffer[] = []
    doc.on('data', b => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const W = doc.page.width - 96, L = 48
    const need = (h: number) => { if (doc.y + h > doc.page.height - 60) doc.addPage() }
    const heading = (t: string, keepWith = 0) => { need(40 + keepWith); doc.moveDown(0.8); doc.font('Helvetica-Bold').fontSize(13).fillColor(PURPLE).text(t, L); doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).strokeColor(LINE).stroke(); doc.moveDown(0.5) }

    const logo = logoPath()
    if (logo) { try { doc.image(logo, L, 40, { fit: [56, 56] }) } catch { /* not a drawable logo */ } }
    doc.font('Helvetica-Bold').fontSize(18).fillColor(PURPLE).text(c.company.name, L + 68, 46)
    doc.font('Helvetica').fontSize(10).fillColor(GRAY).text([phoneText(c.company.phone), c.company.email].filter(Boolean).join('  ·  '), L + 68, 68)
    doc.moveTo(L, 108).lineTo(L + W, 108).lineWidth(2).strokeColor(PURPLE).stroke().lineWidth(1)
    doc.font('Helvetica-Bold').fontSize(24).fillColor(INK).text(`Change Order CO-${c.number}`, L, 124, { width: W, align: 'center' })
    if (c.contractRev) doc.font('Helvetica').fontSize(11).fillColor(GRAY).text(`Contract rev ${c.contractRev}`, L, doc.y + 2, { width: W, align: 'center' })
    doc.moveDown(0.8)
    const facts: Array<[string, string]> = [['Customer', c.customerName], ['Property', c.address || 'Not given']]
    for (const [k, v] of facts) {
      const y = doc.y
      doc.font('Helvetica-Bold').fontSize(10).fillColor(GRAY).text(k, L, y, { width: 90 })
      doc.font('Helvetica').fontSize(11).fillColor(INK).text(v, L + 95, y, { width: W - 95 })
      doc.moveDown(0.2)
    }
    if (c.reason) { heading('Why'); doc.font('Helvetica').fontSize(10).fillColor(INK).text(c.reason, L, doc.y, { width: W }) }

    heading('The change')
    for (const l of c.lines) {
      need(20)
      const y = doc.y
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(l.description || 'Change', L, y, { width: W - 110 })
      const after = doc.y
      doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(usd(l.amountCents), L + W - 100, y, { width: 100, align: 'right' })
      doc.y = Math.max(after, doc.y)
      doc.moveDown(0.3)
    }
    need(40)
    doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor(LINE).stroke()
    doc.moveDown(0.3)
    const ty = doc.y
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(c.totalCents < 0 ? 'Total credit' : 'Total', L, ty, { width: W - 110 })
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK).text(usd(c.totalCents), L + W - 100, ty, { width: 100, align: 'right' })
    doc.moveDown(0.6)
    doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(
      `The original price was ${usd(c.originalCents)}. This change ${c.totalCents < 0 ? 'takes off' : 'adds'} ${usd(Math.abs(c.totalCents))}. It is added to the contract.`, L, doc.y, { width: W })

    if (c.warrantyAfter) {
      heading('Your warranty changes')
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(`${c.warrantyBefore?.name ? `From ${c.warrantyBefore.name} to ` : 'To '}${c.warrantyAfter.name}, because the way the fence is installed changes.`, L, doc.y, { width: W })
      doc.moveDown(0.3)
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(c.warrantyAfter.text, L, doc.y, { width: W })
    }

    heading('Signed', 240)
    const sy = doc.y
    if (c.signature) { try { doc.image(c.signature, L, sy, { fit: [240, 70] }) } catch { /* unreadable ink */ } }
    doc.moveTo(L, sy + 76).lineTo(L + 260, sy + 76).strokeColor(INK).stroke()
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(c.signedBy, L, sy + 82, { width: W })
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`Approved and signed ${c.signedVia === 'portal' ? 'in the customer portal' : c.signedVia === 'in_person' ? 'in person' : 'on the change order link'}`, L, doc.y, { width: W })
    drawSignedRecord(doc, L, W, c.signedBy, c.record)
    doc.moveDown(1.5)
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`Thank you for choosing ${c.company.name}.${c.company.phone ? ` Questions: ${phoneText(c.company.phone)}.` : ''}`, L, doc.y, { width: W, align: 'center' })
    doc.end()
  })
}
