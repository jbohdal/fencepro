/**
 * A pull sheet as a PDF (pdfkit), the same look as the contract and receipt:
 * the logo and company, the customer and property, the fence, then the
 * material lines. With costs (owner and office) it has Unit cost and Total
 * columns and the total; without (Salesman, Installer) quantities only. A
 * job's Final takeoff follows on the same PDF once the crew or office sent it.
 * Made by routes/pull-sheets.ts; the entry it prints is lib/customerPullSheets.ts.
 */

import PDFDocument from 'pdfkit'
import { logoPath } from '../routes/proposal.js'
import type { PullSheetEntry } from './customerPullSheets.js'

const PURPLE = '#5E28A1', INK = '#1C1030', GRAY = '#5F5769', LINE = '#E2DCEC'
const usd = (c: number) => (c < 0 ? '−' : '') + '$' + (Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const phoneText = (p: string) => { const d = p.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''); return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)} ${d.slice(6)}` : p }
const dayText = (iso: string) => {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  return iso && !Number.isNaN(d.getTime()) ? d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' }) : ''
}
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2))

export interface PullSheetPdfInput {
  company: { name: string; phone: string; email: string }
  customerName: string
  address: string
  entry: PullSheetEntry
  /** Owner and office: unit costs and totals. */
  withCosts: boolean
}

export function pullSheetPdf(c: PullSheetPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 48, info: { Title: `Pull sheet - ${c.customerName}`, Author: c.company.name } })
    const chunks: Buffer[] = []
    doc.on('data', b => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const W = doc.page.width - 96, L = 48
    const need = (h: number) => { if (doc.y + h > doc.page.height - 60) doc.addPage() }
    const heading = (t: string) => { need(70); doc.moveDown(0.8); doc.font('Helvetica-Bold').fontSize(13).fillColor(PURPLE).text(t, L); doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).strokeColor(LINE).stroke(); doc.moveDown(0.5) }

    const logo = logoPath()
    if (logo) { try { doc.image(logo, L, 40, { fit: [56, 56] }) } catch { /* not a drawable logo */ } }
    doc.font('Helvetica-Bold').fontSize(18).fillColor(PURPLE).text(c.company.name, L + 68, 46)
    doc.font('Helvetica').fontSize(10).fillColor(GRAY).text([phoneText(c.company.phone), c.company.email].filter(Boolean).join('  ·  '), L + 68, 68)
    doc.moveTo(L, 108).lineTo(L + W, 108).lineWidth(2).strokeColor(PURPLE).stroke().lineWidth(1)
    doc.font('Helvetica-Bold').fontSize(24).fillColor(INK).text('Pull Sheet', L, 124, { width: W, align: 'center' })
    doc.moveDown(0.8)
    const e = c.entry
    const facts: Array<[string, string]> = [
      ['Customer', c.customerName || 'Not given'], ['Property', c.address || 'Not given'],
      ['Fence', e.style || 'Not given'],
      ...(e.footageFt > 0 ? [['Footage', `${e.footageFt} ft${e.sections ? `, ${e.sections} sections` : ''}`] as [string, string]] : []),
      ['Status', `${e.status}${e.kind === 'job' ? ' (job)' : ''}${e.archived ? ', archived' : ''}`],
      ...(e.date ? [['Date', dayText(e.date)] as [string, string]] : []),
      ['Lines', e.source],
    ]
    for (const [k, v] of facts) {
      const y = doc.y
      doc.font('Helvetica-Bold').fontSize(10).fillColor(GRAY).text(k, L, y, { width: 90 })
      doc.font('Helvetica').fontSize(11).fillColor(INK).text(v, L + 95, y, { width: W - 95 })
      doc.moveDown(0.2)
    }
    if (e.changeNote) {
      doc.moveDown(0.5)
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#92400E').text(e.changeNote, L, doc.y, { width: W })
    }

    /** A table: columns [label, width, align]; rows of text. */
    const table = (cols: Array<[string, number, 'left' | 'right']>, rows: string[][], bold: number[] = []) => {
      const x0 = cols.reduce<number[]>((xs, _c, i) => [...xs, i ? xs[i - 1] + cols[i - 1][1] : L], [])
      const head = () => {
        need(40)
        const y = doc.y
        cols.forEach(([t, w, a], i) => doc.font('Helvetica-Bold').fontSize(9).fillColor(GRAY).text(t, x0[i], y, { width: w - 6, align: a }))
        doc.y = y + 14
        doc.moveTo(L, doc.y).lineTo(L + W, doc.y).strokeColor(LINE).stroke()
        doc.y += 4
      }
      head()
      rows.forEach((r, ri) => {
        const h = Math.max(...r.map((t, i) => doc.font('Helvetica').fontSize(10).heightOfString(t, { width: cols[i][1] - 6 }))) + 6
        if (doc.y + h > doc.page.height - 60) { doc.addPage(); head() }
        const y = doc.y
        r.forEach((t, i) => doc.font(bold.includes(ri) ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(INK).text(t, x0[i], y, { width: cols[i][1] - 6, align: cols[i][2] }))
        doc.y = y + h
      })
    }

    heading('Material')
    const lines = c.withCosts ? e.lines : e.lines.filter(l => !l.moneyOnly)
    if (!lines.length) doc.font('Helvetica').fontSize(10).fillColor(GRAY).text('No pull sheet lines.', L, doc.y, { width: W })
    else if (c.withCosts) {
      table([['Material', W - 230, 'left'], ['Qty', 60, 'right'], ['Unit cost', 80, 'right'], ['Total', 90, 'right']], [
        ...lines.map(l => [`${l.item}${l.moneyOnly ? ' (money only, not pulled)' : ''}`, n(l.qty), usd(l.unitCostCents ?? 0), usd(l.totalCostCents ?? 0)]),
        ['Total', '', '', usd(lines.reduce((s, l) => s + (l.totalCostCents ?? 0), 0))],
      ], [lines.length])
    } else {
      table([['Material', W - 80, 'left'], ['Qty', 80, 'right']], lines.map(l => [l.item, n(l.qty)]))
    }

    const t = e.finalTakeoff
    if (t) {
      heading(`Final takeoff (${t.status === 'approved' ? `approved${t.approvedBy ? ` by ${t.approvedBy}` : ''}` : `sent${t.submittedBy ? ` by ${t.submittedBy}` : ''}, not approved yet`})`)
      if (t.installDate) { doc.font('Helvetica').fontSize(10).fillColor(GRAY).text(`Install date: ${dayText(t.installDate)}`, L, doc.y, { width: W }); doc.moveDown(0.4) }
      const cols: Array<[string, number, 'left' | 'right']> = c.withCosts
        ? [['Material', W - 330, 'left'], ['Planned', 55, 'right'], ['Used', 50, 'right'], ['To shop', 55, 'right'], ['To vendor', 60, 'right'], ['Cost', 110, 'right']]
        : [['Material', W - 220, 'left'], ['Planned', 55, 'right'], ['Used', 50, 'right'], ['To shop', 55, 'right'], ['To vendor', 60, 'right']]
      const rows = t.lines.map(l => {
        const r = [`${l.item}${l.extra ? ' (added on the job)' : ''}${l.note ? `: ${l.note}` : ''}`, n(l.plannedQty), n(l.usedQty), n(l.shopReturnQty), n(l.vendorReturnQty)]
        return c.withCosts ? [...r, l.totalCostCents != null ? usd(l.totalCostCents) : ''] : r
      })
      if (c.withCosts && t.materialCostCents != null) rows.push([t.costFrozen ? 'Actual material cost' : 'Actual material cost (preview until approved)', '', '', '', '', usd(t.materialCostCents)])
      table(cols, rows, c.withCosts && t.materialCostCents != null ? [rows.length - 1] : [])
    }

    doc.moveDown(1.5)
    need(30)
    doc.font('Helvetica').fontSize(9).fillColor(GRAY).text(`${c.company.name} · printed ${dayText(new Date().toISOString())}${c.withCosts ? ' · internal: has costs, not for the customer' : ''}`, L, doc.y, { width: W, align: 'center' })
    doc.end()
  })
}
