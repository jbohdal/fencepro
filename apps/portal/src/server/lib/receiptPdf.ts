/**
 * A payment receipt as a PDF (pdfkit), in the same look as the signed
 * contract (lib/contractPdf.ts): the receipt number, the day, who paid, the
 * job address, the amount and how it was paid (the check number), what it is
 * for, the contract total, paid to date and the balance left. The final
 * payment says "Paid in full" with the job's warranty and the day it starts
 * (the install date, or "starts on the install date" until the fence is in),
 * and, when ticked, a Final Release of Lien.
 *
 * Made fresh each time from the receipt's frozen snapshot (Receipt.snapshot),
 * so it always says what it said on the day; a voided receipt is stamped VOID.
 */

import PDFDocument from 'pdfkit'
import { logoPath } from '../routes/proposal.js'
import { moneyText } from './paymentMath.js'

const PURPLE = '#5E28A1', INK = '#1C1030', GRAY = '#5F5769', LINE = '#E2DCEC', GREEN = '#167A3E', RED = '#B42318'
const phoneText = (p: string) => { const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : p }

/** What a receipt says, frozen when it is made (integer cents). */
export interface ReceiptSnapshot {
  number: number
  /** YYYY-MM-DD, the day it was paid. */
  paidOn: string
  company: { name: string; phone: string; email: string }
  customerName: string
  address: string
  phone: string
  email: string
  fenceStyle: string
  amountCents: number
  method: string
  methodText: string
  /** What it paid: [{ label: 'Deposit', cents }], a credit last. */
  forItems: Array<{ label: string; cents: number }>
  forText: string
  signedCents: number
  changeOrderCents: number
  adjustmentCents: number
  contractCents: number
  paidToDateCents: number
  balanceCents: number
  paidInFull: boolean
  warrantyName: string | null
  lienRelease: boolean
  recordedBy: string
  jobId: string
  quoteId: string | null
}

/** "Receipt 1001" */
export const receiptName = (n: number) => `Receipt ${n}`

/**
 * DRAFT, to be checked by Jonathan's lawyer before it is relied on. Written
 * after the Florida "Waiver and Release of Lien upon Final Payment" form
 * (Fla. Stat. 713.20(5)). Off unless ticked on the final payment.
 */
export const LIEN_RELEASE_DRAFT_NOTE = 'DRAFT wording, to be checked by a lawyer before it is relied on.'
export function lienReleaseText(s: Pick<ReceiptSnapshot, 'company' | 'customerName' | 'address' | 'amountCents' | 'contractCents' | 'paidOn'>, dayWords: string): string {
  return `The undersigned lienor, ${s.company.name}, in consideration of the final payment in the amount of ${moneyText(s.amountCents)}, `
    + `the contract price of ${moneyText(s.contractCents)} now being paid in full, hereby waives and releases its lien and right to claim a lien `
    + `for labor, services, or materials furnished to ${s.customerName} on the job of ${s.customerName} to the following described property: `
    + `${s.address || 'the property named on the contract'}. Dated ${dayWords}.`
}

export interface ReceiptPdfInput {
  s: ReceiptSnapshot
  voided: boolean
  /** "October 21, 2026" */
  dayWords: string
  /** The warranty start, in plain words: the install date, or null until installed. */
  installDay: string | null
}

export function receiptPdf({ s, voided, dayWords, installDay }: ReceiptPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: `${receiptName(s.number)} - ${s.customerName}`, Author: s.company.name } })
    const chunks: Buffer[] = []
    doc.on('data', b => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const W = doc.page.width - 96, L = 48
    const need = (h: number) => { if (doc.y + h > doc.page.height - 60) doc.addPage() }
    const heading = (t: string, keepWith = 0) => { need(40 + keepWith); doc.moveDown(0.8); doc.font('Helvetica-Bold').fontSize(13).fillColor(PURPLE).text(t, L); doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).strokeColor(LINE).stroke(); doc.moveDown(0.5) }

    const logo = logoPath()
    if (logo) { try { doc.image(logo, L, 40, { fit: [56, 56] }) } catch { /* not a drawable logo */ } }
    doc.font('Helvetica-Bold').fontSize(18).fillColor(PURPLE).text(s.company.name, L + 68, 46)
    doc.font('Helvetica').fontSize(10).fillColor(GRAY).text([phoneText(s.company.phone), s.company.email].filter(Boolean).join('  ·  '), L + 68, 68)
    doc.moveTo(L, 108).lineTo(L + W, 108).lineWidth(2).strokeColor(PURPLE).stroke().lineWidth(1)
    doc.font('Helvetica-Bold').fontSize(24).fillColor(INK).text('Payment Receipt', L, 124, { width: W, align: 'center' })
    doc.font('Helvetica').fontSize(12).fillColor(GRAY).text(`${receiptName(s.number)}  ·  ${dayWords}`, L, doc.y + 2, { width: W, align: 'center' })
    if (voided) {
      doc.moveDown(0.4)
      doc.font('Helvetica-Bold').fontSize(20).fillColor(RED).text('VOID', L, doc.y, { width: W, align: 'center' })
      doc.font('Helvetica').fontSize(10).fillColor(RED).text('This payment was voided. This receipt is no longer valid.', L, doc.y, { width: W, align: 'center' })
    }
    doc.moveDown(0.8)
    doc.font('Helvetica-Bold').fontSize(30).fillColor(voided ? GRAY : GREEN).text(moneyText(s.amountCents), L, doc.y, { width: W, align: 'center' })
    doc.font('Helvetica').fontSize(11).fillColor(INK).text(`${s.methodText}  ·  ${s.forText}`, L, doc.y, { width: W, align: 'center' })
    doc.moveDown(0.8)

    const facts: Array<[string, string]> = [
      ['Received from', s.customerName],
      ['Job address', s.address || 'Not given'],
      ...(s.fenceStyle ? [['Fence', s.fenceStyle] as [string, string]] : []),
      ['Date paid', dayWords],
      ['Amount', moneyText(s.amountCents)],
      ['Paid by', s.methodText],
      ['For', s.forItems.map(i => `${i.label} ${moneyText(i.cents)}`).join(', ') || s.forText],
    ]
    for (const [k, v] of facts) {
      const y = doc.y
      doc.font('Helvetica-Bold').fontSize(10).fillColor(GRAY).text(k, L, y, { width: 100 })
      doc.font('Helvetica').fontSize(11).fillColor(INK).text(v, L + 105, y, { width: W - 105 })
      doc.moveDown(0.2)
    }

    heading('The contract', 90)
    const rows: Array<[string, string, boolean?]> = [
      ['Contract as signed', moneyText(s.signedCents)],
      ...(s.changeOrderCents ? [['Change orders', moneyText(s.changeOrderCents)] as [string, string]] : []),
      ...(s.adjustmentCents ? [['Adjustments', moneyText(s.adjustmentCents)] as [string, string]] : []),
      ['Contract total', moneyText(s.contractCents), true],
      ['Paid to date', moneyText(s.paidToDateCents)],
      [s.balanceCents < 0 ? 'Credit (paid over the total)' : 'Balance remaining', moneyText(Math.abs(s.balanceCents)), true],
    ]
    for (const [k, v, bold] of rows) {
      const y = doc.y
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor(INK).text(k, L, y, { width: W - 140 })
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(11).fillColor(INK).text(v, L + W - 140, y, { width: 140, align: 'right' })
      doc.moveDown(0.25)
    }

    if (s.paidInFull) {
      heading('Paid in full', 70)
      doc.font('Helvetica-Bold').fontSize(14).fillColor(voided ? GRAY : GREEN).text('Paid in full. Thank you!', L, doc.y, { width: W })
      doc.moveDown(0.3)
      doc.font('Helvetica').fontSize(11).fillColor(INK).text(`Warranty: ${s.warrantyName || 'as written on your contract'}`, L, doc.y, { width: W })
      doc.font('Helvetica').fontSize(11).fillColor(INK).text(installDay ? `Your warranty starts on the install date: ${installDay}.` : 'Your warranty starts on the install date.', L, doc.y, { width: W })
    }

    if (s.lienRelease && s.paidInFull) {
      heading('Final Release of Lien', 160)
      doc.font('Helvetica-Bold').fontSize(9).fillColor(RED).text(LIEN_RELEASE_DRAFT_NOTE, L, doc.y, { width: W })
      doc.moveDown(0.3)
      doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text('WAIVER AND RELEASE OF LIEN UPON FINAL PAYMENT', L, doc.y, { width: W })
      doc.moveDown(0.3)
      doc.font('Helvetica').fontSize(10).fillColor(INK).text(lienReleaseText(s, dayWords), L, doc.y, { width: W })
      doc.moveDown(1.6)
      const y = doc.y
      doc.moveTo(L, y).lineTo(L + 260, y).strokeColor(INK).stroke()
      doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`Lienor: ${s.company.name}, by its authorized agent`, L, y + 4, { width: W })
    }

    doc.moveDown(1.5)
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`Received by ${s.recordedBy || s.company.name}. Thank you for choosing ${s.company.name}.${s.company.phone ? ` Questions: ${phoneText(s.company.phone)}.` : ''}`, L, doc.y, { width: W, align: 'center' })
    doc.end()
  })
}
