/**
 * The signed contract as a PDF (pdfkit): the option the customer accepted, its
 * price, what is included, the deposit, the warranty of that option word for
 * word, and "Warranty starts on the install date: <date>" once the job is
 * installed (until then it says the date is set when the fence is
 * installed). Made fresh each time it is opened, from the proposal frozen on
 * the quote, so the words are the ones signed and the install date appears
 * as soon as it is known.
 *
 * Opened by the customer from their accepted proposal (/p/<link>/contract.pdf)
 * and by staff from the job page (/api/warranties/quote/<id>/contract.pdf).
 */

import { pdfDocument } from './pdfText.js'
import prisma from './prisma.js'
import { logoPath } from '../routes/proposal.js'
import { quoteWarranty, installDateOf, type OptionWarranty } from './warranties.js'
import { pricingModule } from './estimates.js'
import { acceptedOnUpdate } from './warrantyUpdates.js'
import { depositOf, pricedWholeDollar } from './paymentMath.js'
import { termsOn, companyAddress, type Term } from './contractTerms.js'
import { plainIp } from './signedDocuments.js'

const PURPLE = '#5E28A1', INK = '#1C1030', GRAY = '#5F5769', LINE = '#E2DCEC'
const TZ = 'America/New_York'
const money = (n: number) => '$' + (Math.round((n || 0) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const phoneText = (p: string) => { const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : p }
const when = (d: Date) => d.toLocaleString('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
/** "October 22, 2026 at 3:04:09 PM EDT": the signed record's time, to the second, with the time zone. */
export const whenSigned = (d: Date) => d.toLocaleString('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }).replace(/[\u202f\u00a0]/g, ' ')
export const IP_NOT_RECORDED = 'not recorded at the time'

/** The signed record printed at the end of the last page of a stored signed PDF (lib/signedDocuments.ts). */
export interface SignedRecord {
  at: Date
  ip: string | null
  /** What was accepted: "Better: WV-ND 6'x8' Privacy at $10,000.00" or "Change order #2: total $450.00". */
  accepted: string
}

export interface ContractInput {
  /** address: Settings → Company's street, city, state and ZIP ('' when not filled in: no line is printed). */
  company: { name: string; phone: string; email: string; address?: string }
  customerName: string
  address: string
  optionLabel: string
  tierLabel: string
  price: number
  footageFt: number
  gatesText: string
  included: string[]
  includedNote: string
  depositPct: number
  depositNote: string
  /** Priced to the whole dollar (Oct 21 2026 on): the deposit is whole dollars, as the payment schedule makes it. */
  wholeDollar?: boolean
  description: string
  warranty: OptionWarranty | null
  /** Plain words ("October 20, 2026"), null until installed. */
  installDate: string | null
  acceptedBy: string
  acceptedAt: Date | null
  /** How it was signed: on the customer's link, or in person (marked Sold in the app). */
  signedHow: 'link' | 'in_person'
  signature: Buffer | null
  /** The signed record (time with zone, IP, what was accepted) under the signature: the stored copy's, or as recorded at signing. */
  signedRecord?: SignedRecord | null
  /** Settings → Contract Templates as frozen on the proposal when it was signed (lib/contractTerms.ts). */
  terms?: Term[]
}

/**
 * The signed record under a signature: the typed name, date and time with
 * the time zone, the IP and what was accepted. Drawn by the contract and the
 * change order PDFs, as the last thing on the last page.
 */
export function drawSignedRecord(doc: PDFKit.PDFDocument, L: number, W: number, name: string, r: SignedRecord): void {
  const lines: Array<[string, string]> = [
    ['Signed by', name],
    ['Date and time', whenSigned(r.at)],
    ['IP address', r.ip || IP_NOT_RECORDED],
    ['Accepted', r.accepted],
  ]
  doc.moveDown(0.4)
  for (const [k, v] of lines) {
    const y = doc.y
    doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text(k, L, y, { width: 90 })
    doc.font('Helvetica').fontSize(9).fillColor(INK).text(v, L + 95, y, { width: W - 95 })
    doc.moveDown(0.15)
  }
}

/** The warranty lines exactly as the contract prints them (the job page and tests use the same words). */
export function warrantyLines(w: OptionWarranty | null, installDate: string | null): { title: string; text: string; start: string } {
  return {
    title: w?.name || 'Warranty',
    text: w?.text || 'No warranty is written on this proposal.',
    start: installDate ? `Warranty starts on the install date: ${installDate}` : 'Warranty starts on the install date (set when the fence is installed).',
  }
}

export function contractPdf(c: ContractInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = pdfDocument({ size: 'LETTER', margin: 48, info: { Title: `Signed contract - ${c.customerName}`, Author: c.company.name } })
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
    // The company's address only when Settings → Company has it: no empty line otherwise.
    if (c.company.address) doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(c.company.address, L + 68, 82, { width: W - 68 })
    doc.moveTo(L, 108).lineTo(L + W, 108).lineWidth(2).strokeColor(PURPLE).stroke().lineWidth(1)
    doc.font('Helvetica-Bold').fontSize(24).fillColor(INK).text('Fence Contract', L, 124, { width: W, align: 'center' })
    doc.moveDown(0.8)
    const facts: Array<[string, string]> = [
      ['Customer', c.customerName], ['Property', c.address || 'Not given'],
      ['Fence', `${c.tierLabel ? `${c.tierLabel}: ` : ''}${c.optionLabel}`],
      ...(c.footageFt > 0 ? [['Footage', `${Math.round(c.footageFt)} ft${c.gatesText ? `, ${c.gatesText}` : ''}`] as [string, string]] : []),
      ['Price', money(c.price)],
      ...(c.depositPct > 0 ? [['Deposit', `${c.depositPct}% to schedule: ${money(c.wholeDollar ? depositOf(Math.round(c.price * 100), c.depositPct, true) / 100 : c.price * c.depositPct / 100)}${c.depositNote ? ` (${c.depositNote})` : ''}`] as [string, string]] : []),
      ['Warranty', c.warranty?.name || 'None written'],
    ]
    for (const [k, v] of facts) {
      const y = doc.y
      doc.font('Helvetica-Bold').fontSize(10).fillColor(GRAY).text(k, L, y, { width: 90 })
      doc.font('Helvetica').fontSize(11).fillColor(INK).text(v, L + 95, y, { width: W - 95 })
      doc.moveDown(0.2)
    }
    if (c.description) { heading('The work'); doc.font('Helvetica').fontSize(10).fillColor(INK).text(c.description, L, doc.y, { width: W }) }
    if (c.included.length || c.includedNote) {
      heading("What's included")
      for (const x of c.included) doc.font('Helvetica').fontSize(10).fillColor(INK).text(`•  ${x}`, L, doc.y, { width: W })
      if (c.includedNote) { doc.moveDown(0.3); doc.font('Helvetica').fontSize(10).fillColor(INK).text(c.includedNote, L, doc.y, { width: W }) }
    }
    const w = warrantyLines(c.warranty, c.installDate)
    heading(`Warranty: ${w.title}`, 60)
    doc.font('Helvetica').fontSize(10).fillColor(INK).text(w.text, L, doc.y, { width: W })
    doc.moveDown(0.4)
    doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(w.start, L, doc.y, { width: W })

    // The terms the customer read on the proposal and signed, word for word.
    const terms = (c.terms ?? []).filter(x => x && x.text)
    if (terms.length) {
      heading('Terms', 60)
      for (const x of terms) {
        need(40)
        doc.font('Helvetica-Bold').fontSize(10).fillColor(INK).text(x.title, L, doc.y, { width: W })
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(x.text, L, doc.y, { width: W })
        doc.moveDown(0.5)
      }
    }

    // The signature block (and the signed record of a stored copy) stays together on the last page.
    heading('Signed', c.signedRecord ? 240 : 110)
    const sy = doc.y
    if (c.signature) { try { doc.image(c.signature, L, sy, { fit: [240, 70] }) } catch { /* unreadable ink */ } }
    doc.moveTo(L, sy + 76).lineTo(L + 260, sy + 76).strokeColor(INK).stroke()
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK).text(c.acceptedBy || c.customerName, L, sy + 82, { width: W })
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(
      `${c.signedHow === 'link' ? 'Accepted and signed on the proposal link' : 'Signed in person'}${c.acceptedAt ? ` on ${when(c.acceptedAt)}` : ''}`, L, doc.y, { width: W })
    if (c.signedRecord) drawSignedRecord(doc, L, W, c.acceptedBy || c.customerName, c.signedRecord)
    doc.moveDown(1.5)
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`Thank you for choosing ${c.company.name}.${c.company.phone ? ` Questions or warranty service: ${phoneText(c.company.phone)}.` : ''}`, L, doc.y, { width: W, align: 'center' })
    doc.end()
  })
}

type Q = {
  id: string; accountId: string; proposal: unknown; chosenOption: number | null; fenceStyle: string; status: string; finalPrice: number
  acceptedAt: Date | null; acceptedBy: string | null; acceptedSignature: string | null; acceptedIp?: string | null; soldAt: Date | null; work: unknown
  customerName: string; customerAddress: string
}

/** The option the customer accepted and its price, as the contract prints them ("Better: White vinyl privacy at $10,000.00"). */
export function acceptedOptionText(q: Pick<Q, 'proposal' | 'chosenOption' | 'fenceStyle' | 'finalPrice' | 'acceptedAt'>): string {
  const p = q.proposal as any
  const opts = Array.isArray(p?.options) ? p.options : []
  const idx = typeof q.chosenOption === 'number' && opts[q.chosenOption] ? q.chosenOption : Math.max(0, opts.findIndex((o: any) => o?.fenceStyle === q.fenceStyle))
  const opt = opts[idx] ?? opts[0] ?? {}
  const price = q.acceptedAt ? Number(opt.finalPrice) || q.finalPrice : q.finalPrice
  const tier = String(opt.tier?.label || '')
  const label = String(opt.label || q.fenceStyle)
  return `${tier && tier !== label ? `${tier}: ` : ''}${label} at ${money(price)}`
}

/**
 * The contract for a signed quote (accepted on the link or sold), or null when it is not signed or has no proposal.
 * `signed`: the stored signed copy (lib/signedDocuments.ts): as it stood at signing (no install date yet) with the signed record.
 */
export async function contractForQuote(q: Q, signed?: SignedRecord | null): Promise<Buffer | null> {
  const p = q.proposal as any
  if (!p || !Array.isArray(p.options) || !p.options.length) return null
  if (!(q.acceptedAt || q.status === 'SOLD' || q.soldAt)) return null
  const idx = typeof q.chosenOption === 'number' && p.options[q.chosenOption] ? q.chosenOption : Math.max(0, p.options.findIndex((o: any) => o?.fenceStyle === q.fenceStyle))
  const opt = p.options[idx] ?? p.options[0]
  const b = await prisma.businessState.findUnique({ where: { accountId: q.accountId }, select: { config: true } })
  const co = (b?.config as any)?.company ?? {}
  // Signed on a warranty update link (lib/warrantyUpdates.ts): the warranty that link showed for the option. Otherwise as signed.
  const fromUpdate = await acceptedOnUpdate(q)
  const warranty = fromUpdate ?? (await quoteWarranty({ ...q, chosenOption: idx }, q.fenceStyle, b?.config ?? null)).warranty
  const job = signed ? null : await prisma.savedJob.findFirst({ where: { accountId: q.accountId, quoteId: q.id, deletedAt: null, archivedAt: null }, select: { id: true, completedDate: true } })
  const day = job ? await installDateOf(job) : null
  const m = await pricingModule()
  const sig = /^data:image\/png;base64,(.+)$/.exec(q.acceptedSignature || '')
  // Accepted on the link: the price the customer accepted; signed in person: the quote's price.
  const price = q.acceptedAt ? Number(opt.finalPrice) || q.finalPrice : q.finalPrice
  // Signed on the link: the signed record (time, IP, what was accepted) on every copy, not only the stored one.
  const record = signed ?? (q.acceptedAt ? { at: q.acceptedAt, ip: plainIp(q.acceptedIp ?? null), accepted: acceptedOptionText(q) } : null)
  return contractPdf({
    company: {
      name: String(p.company?.name || co.name || 'Getter Done Fence'), phone: String(p.company?.phone || co.phone || ''), email: String(p.company?.email || co.email || ''),
      address: String(p.company?.address || await companyAddress(q.accountId) || ''),
    },
    customerName: String(p.customer?.name || q.customerName || ''), address: String(p.customer?.address || q.customerAddress || ''),
    optionLabel: String(opt.label || q.fenceStyle), tierLabel: String(opt.tier?.label || ''), price,
    footageFt: Number(p.footageFt) || 0, gatesText: p.kind ? '' : String(p.gatesText || ''),
    included: Array.isArray(p.included) ? p.included.map(String) : [], includedNote: String(p.includedNote || ''),
    depositPct: Number(p.depositPct) || 0, depositNote: String(p.depositNote || ''), wholeDollar: pricedWholeDollar(q), description: p.kind ? String(p.description || '') : '',
    warranty, installDate: day ? m.dayText(day) : null,
    acceptedBy: String(q.acceptedBy || ''), acceptedAt: q.acceptedAt ?? q.soldAt ?? null, signedHow: q.acceptedAt ? 'link' : 'in_person',
    signature: sig ? Buffer.from(sig[1], 'base64') : null,
    signedRecord: record,
    // Only the terms frozen on the proposal: what the customer read and signed.
    terms: (await termsOn(p)) ?? [],
  })
}

export const CONTRACT_SELECT = {
  id: true, accountId: true, proposal: true, chosenOption: true, fenceStyle: true, status: true, finalPrice: true,
  acceptedAt: true, acceptedBy: true, acceptedSignature: true, acceptedIp: true, soldAt: true, work: true, customerName: true, customerAddress: true,
} as const
