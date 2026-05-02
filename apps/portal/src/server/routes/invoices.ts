import { Router } from 'express'
import PDFDocument from 'pdfkit'
import prisma from '../lib/prisma.js'
import { str } from '../lib/helpers.js'
import { requireAuth } from '../middleware/auth.js'
import { auditLog } from '../middleware/audit.js'

const router = Router()

const COMPANY_NAME = process.env.COMPANY_NAME || 'EZBiz'
const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS || ''
const COMPANY_CITY_STATE_ZIP = process.env.COMPANY_CITY_STATE_ZIP || ''
const COMPANY_PHONE = process.env.COMPANY_PHONE || ''
const COMPANY_EMAIL = process.env.COMPANY_EMAIL || ''
const COMPANY_LOGO_URL = process.env.COMPANY_LOGO_URL || ''

function sanitizeFilename(name: string): string {
  return name.replace(/[^\w\s.-]/g, '').replace(/\s+/g, '-').slice(0, 100)
}

async function loadLogoBuffer(url: string): Promise<Buffer | null> {
  if (!url) return null
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return null
    return Buffer.from(await res.arrayBuffer())
  } catch {
    return null
  }
}

// ── List invoices (account-scoped) ──
router.get('/', requireAuth, async (req, res) => {
  try {
    const accountId = req.user!.accountId
    const status = String(req.query.status || '') || undefined
    const page = Math.max(1, parseInt(String(req.query.page)) || 1)
    const pageSize = Math.min(50, parseInt(String(req.query.pageSize)) || 20)

    const where = {
      accountId,
      ...(status && status !== 'all' ? { status: status as 'pending' | 'paid' | 'overdue' | 'cancelled' | 'refunded' } : {}),
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        orderBy: { dueDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.invoice.count({ where }),
    ])

    res.json({
      success: true,
      data: {
        items: invoices.map(inv => ({
          id: inv.id,
          invoiceNumber: inv.invoiceNumber,
          amountCents: inv.amountCents,
          currency: inv.currency,
          dueDate: inv.dueDate.toISOString(),
          paidAt: inv.paidAt?.toISOString() || null,
          status: inv.status,
          hasPdf: true,
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load invoices' })
  }
})

// ── Generate account statement PDF ──
router.get('/statement/pdf', requireAuth, auditLog('statement_download'), async (req, res) => {
  try {
    const accountId = req.user!.accountId
    const account = await prisma.crmAccount.findUnique({ where: { id: accountId } })
    if (!account) {
      res.status(404).json({ success: false, error: 'Account not found' })
      return
    }

    const invoices = await prisma.invoice.findMany({
      where: { accountId },
      orderBy: { dueDate: 'desc' },
    })

    const fmtCurrency = (cents: number, currency = 'USD') =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)

    const logoBuffer = await loadLogoBuffer(COMPANY_LOGO_URL)

    const doc = new PDFDocument({ margin: 50, size: 'LETTER' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="statement-${sanitizeFilename(account.name)}.pdf"`)
    doc.pipe(res)

    // ── Header bar ──
    doc.rect(0, 0, doc.page.width, 8).fill('#f97316')

    // ── Logo (if configured) ──
    let textX = 50
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 50, 14, { fit: [52, 38] })
        textX = 110
      } catch { /* unsupported format — skip logo */ }
    }

    // ── Company info ──
    doc.fontSize(20).fillColor('#111827').font('Helvetica-Bold')
      .text(COMPANY_NAME, textX, logoBuffer ? 16 : 30)
    doc.fontSize(9).fillColor('#6b7280').font('Helvetica')
    let companyY = logoBuffer ? 38 : 56
    if (COMPANY_ADDRESS) { doc.text(COMPANY_ADDRESS, textX, companyY); companyY += 13 }
    if (COMPANY_CITY_STATE_ZIP) { doc.text(COMPANY_CITY_STATE_ZIP, textX, companyY); companyY += 13 }
    if (COMPANY_PHONE) { doc.text(COMPANY_PHONE, textX, companyY); companyY += 13 }
    if (COMPANY_EMAIL) { doc.text(COMPANY_EMAIL, textX, companyY); companyY += 13 }

    // ── Statement title ──
    doc.fontSize(24).fillColor('#f97316').font('Helvetica-Bold')
      .text('ACCOUNT STATEMENT', 0, 30, { align: 'right' })
    doc.fontSize(10).fillColor('#6b7280').font('Helvetica')
      .text(`As of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`, 0, 58, { align: 'right' })

    // ── Bill to ──
    const billToY = Math.max(companyY, 88) + 10
    doc.rect(50, billToY, doc.page.width - 100, 50).fill('#f9fafb')
    doc.fontSize(8).fillColor('#9ca3af').font('Helvetica-Bold')
      .text('ACCOUNT', 62, billToY + 8)
    doc.fontSize(14).fillColor('#111827').font('Helvetica-Bold')
      .text(account.name, 62, billToY + 20)

    // ── Summary bar ──
    const outstanding = invoices.filter(i => i.status === 'pending' || i.status === 'overdue')
      .reduce((s, i) => s + i.amountCents, 0)
    const overdue = invoices.filter(i => i.status === 'overdue')
      .reduce((s, i) => s + i.amountCents, 0)
    const paid = invoices.filter(i => i.status === 'paid')
      .reduce((s, i) => s + i.amountCents, 0)

    const sumY = billToY + 68
    const colW = (doc.page.width - 100) / 3
    const summaryItems = [
      { label: 'Total Outstanding', value: fmtCurrency(outstanding), color: outstanding > 0 ? '#d97706' : '#059669' },
      { label: 'Overdue', value: fmtCurrency(overdue), color: overdue > 0 ? '#dc2626' : '#059669' },
      { label: 'Paid (all time)', value: fmtCurrency(paid), color: '#059669' },
    ]
    summaryItems.forEach((item, i) => {
      const x = 50 + i * colW
      doc.rect(x, sumY, colW - 4, 44).fill('#ffffff').stroke('#e5e7eb')
      doc.fontSize(8).fillColor('#6b7280').font('Helvetica').text(item.label, x + 8, sumY + 8)
      doc.fontSize(14).fillColor(item.color).font('Helvetica-Bold').text(item.value, x + 8, sumY + 22)
    })

    // ── Invoice table ──
    const tableTop = sumY + 58
    doc.rect(50, tableTop, doc.page.width - 100, 22).fill('#111827')
    const cols = { num: 50, due: 180, issued: 280, amount: 360, paid: 430, status: 490 }
    doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
    doc.text('Invoice #', cols.num + 4, tableTop + 7)
    doc.text('Due Date', cols.due, tableTop + 7)
    doc.text('Issued', cols.issued, tableTop + 7)
    doc.text('Amount', cols.amount, tableTop + 7, { align: 'right', width: 60 })
    doc.text('Paid At', cols.paid, tableTop + 7)
    doc.text('Status', cols.status, tableTop + 7)

    let rowY = tableTop + 28
    const rowH = 20

    for (const inv of invoices) {
      if (rowY + rowH > doc.page.height - 60) {
        doc.addPage()
        rowY = 50
      }
      const isEven = invoices.indexOf(inv) % 2 === 0
      if (isEven) doc.rect(50, rowY - 4, doc.page.width - 100, rowH).fill('#f9fafb')

      const statusColor = inv.status === 'paid' ? '#059669'
        : inv.status === 'overdue' ? '#dc2626'
        : inv.status === 'pending' ? '#d97706'
        : '#6b7280'

      doc.fontSize(9).fillColor('#111827').font('Helvetica')
      doc.text(inv.invoiceNumber, cols.num + 4, rowY)
      doc.text(inv.dueDate.toLocaleDateString('en-US'), cols.due, rowY)
      doc.text(inv.createdAt.toLocaleDateString('en-US'), cols.issued, rowY)
      doc.font('Helvetica-Bold').text(fmtCurrency(inv.amountCents, inv.currency), cols.amount, rowY, { align: 'right', width: 60 })
      doc.font('Helvetica').fillColor('#6b7280')
        .text(inv.paidAt ? inv.paidAt.toLocaleDateString('en-US') : '—', cols.paid, rowY)
      doc.fillColor(statusColor).font('Helvetica-Bold')
        .text(inv.status.charAt(0).toUpperCase() + inv.status.slice(1), cols.status, rowY)

      rowY += rowH
    }

    if (invoices.length === 0) {
      doc.fontSize(11).fillColor('#9ca3af').font('Helvetica')
        .text('No invoices on record.', 50, rowY + 10, { align: 'center', width: doc.page.width - 100 })
    }

    // ── Total row ──
    rowY += 8
    doc.moveTo(50, rowY).lineTo(doc.page.width - 50, rowY).strokeColor('#e5e7eb').lineWidth(1).stroke()
    rowY += 10
    doc.fontSize(11).fillColor('#111827').font('Helvetica-Bold')
    doc.text('Total Outstanding', 50, rowY)
    doc.fillColor(outstanding > 0 ? '#d97706' : '#059669')
      .text(fmtCurrency(outstanding), cols.amount, rowY, { align: 'right', width: 60 })

    // ── Footer ──
    const footerY = doc.page.height - 50
    doc.moveTo(50, footerY).lineTo(doc.page.width - 50, footerY).strokeColor('#e5e7eb').lineWidth(0.5).stroke()
    doc.fontSize(8).fillColor('#9ca3af').font('Helvetica')
      .text(`Generated ${new Date().toLocaleString()} · ${COMPANY_NAME} · Thank you for your business`,
        50, footerY + 10, { align: 'center', width: doc.page.width - 100 })

    doc.end()
  } catch (err) {
    console.error('Statement PDF error:', err)
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to generate statement PDF' })
    }
  }
})

// ── Generate and stream invoice PDF on demand ──
router.get('/:id/pdf', requireAuth, auditLog('invoice_download'), async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: str(req.params.id) },
      include: { account: true },
    })

    if (!invoice || invoice.accountId !== req.user!.accountId) {
      res.status(404).json({ success: false, error: 'Invoice not found' })
      return
    }

    const fmtMoney = (cents: number) =>
      new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency || 'USD' }).format(cents / 100)

    type LineItem = { description: string; quantity: number; unitPriceCents: number; totalCents: number }
    const lineItems: LineItem[] = Array.isArray(invoice.lineItems) ? invoice.lineItems as LineItem[] : []

    const subtotalCents = lineItems.length > 0
      ? lineItems.reduce((s, li) => s + (li.totalCents || 0), 0)
      : invoice.amountCents - invoice.taxCents

    const statusLabel: Record<string, string> = {
      pending: 'Pending', paid: 'Paid', overdue: 'Overdue',
      cancelled: 'Cancelled', refunded: 'Refunded',
    }
    const statusColor = invoice.status === 'paid' ? '#059669'
      : invoice.status === 'overdue' ? '#dc2626'
      : '#d97706'

    const logoBuffer = await loadLogoBuffer(COMPANY_LOGO_URL)

    const doc = new PDFDocument({ margin: 50, size: 'LETTER' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${sanitizeFilename(invoice.invoiceNumber)}.pdf"`)
    doc.pipe(res)

    // ── Header bar ──
    doc.rect(0, 0, doc.page.width, 8).fill('#f97316')

    // ── Logo (if configured) ──
    let companyTextX = 50
    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 50, 14, { fit: [52, 38] })
        companyTextX = 110
      } catch { /* unsupported format — skip logo */ }
    }

    // ── Company block (left) ──
    doc.fontSize(20).fillColor('#111827').font('Helvetica-Bold')
      .text(COMPANY_NAME, companyTextX, logoBuffer ? 16 : 30)
    doc.fontSize(9).fillColor('#6b7280').font('Helvetica')
    let cy = logoBuffer ? 38 : 56
    if (COMPANY_ADDRESS) { doc.text(COMPANY_ADDRESS, companyTextX, cy); cy += 13 }
    if (COMPANY_CITY_STATE_ZIP) { doc.text(COMPANY_CITY_STATE_ZIP, companyTextX, cy); cy += 13 }
    if (COMPANY_PHONE) { doc.text(COMPANY_PHONE, companyTextX, cy); cy += 13 }
    if (COMPANY_EMAIL) { doc.text(COMPANY_EMAIL, companyTextX, cy); cy += 13 }

    // ── Invoice label + meta (right) ──
    doc.fontSize(28).fillColor('#f97316').font('Helvetica-Bold')
      .text('INVOICE', 0, 30, { align: 'right' })

    const metaStartY = 64
    const metaRightX = doc.page.width - 50
    const metaLabelX = metaRightX - 190
    const metaValueX = metaRightX - 90

    const metaRows = [
      ['Invoice #', invoice.invoiceNumber],
      ['Issue Date', invoice.createdAt.toLocaleDateString('en-US')],
      ['Due Date', invoice.dueDate.toLocaleDateString('en-US')],
    ]
    metaRows.forEach(([label, value], i) => {
      const y = metaStartY + i * 16
      doc.fontSize(8).fillColor('#9ca3af').font('Helvetica').text(label, metaLabelX, y)
      doc.fontSize(9).fillColor('#111827').font('Helvetica-Bold')
        .text(value, metaValueX, y, { align: 'right', width: 90 })
    })
    // Status badge
    const statusY = metaStartY + metaRows.length * 16
    doc.fontSize(9).fillColor(statusColor).font('Helvetica-Bold')
      .text(statusLabel[invoice.status] || invoice.status, metaValueX, statusY, { align: 'right', width: 90 })

    // ── Divider ──
    const divY = Math.max(cy, statusY) + 18
    doc.moveTo(50, divY).lineTo(doc.page.width - 50, divY).strokeColor('#e5e7eb').lineWidth(1).stroke()

    // ── Bill To ──
    doc.fontSize(8).fillColor('#9ca3af').font('Helvetica-Bold')
      .text('BILL TO', 50, divY + 12)
    doc.fontSize(13).fillColor('#111827').font('Helvetica-Bold')
      .text(invoice.account.name, 50, divY + 24)

    // ── Line items table ──
    const tableTop = divY + 60
    doc.rect(50, tableTop, doc.page.width - 100, 24).fill('#111827')
    doc.fontSize(8).fillColor('#ffffff').font('Helvetica-Bold')
    doc.text('DESCRIPTION', 60, tableTop + 8)
    doc.text('QTY', doc.page.width - 240, tableTop + 8, { align: 'right', width: 40 })
    doc.text('UNIT PRICE', doc.page.width - 190, tableTop + 8, { align: 'right', width: 70 })
    doc.text('TOTAL', doc.page.width - 110, tableTop + 8, { align: 'right', width: 60 })

    let itemY = tableTop + 30
    const itemH = 20
    const items = lineItems.length > 0
      ? lineItems
      : [{ description: `Services — ${invoice.invoiceNumber}`, quantity: 1, unitPriceCents: subtotalCents, totalCents: subtotalCents }]

    items.forEach((li, idx) => {
      if (idx % 2 === 1) doc.rect(50, itemY - 4, doc.page.width - 100, itemH).fill('#f9fafb')
      doc.fontSize(10).fillColor('#111827').font('Helvetica')
      doc.text(li.description, 60, itemY, { width: doc.page.width - 290, ellipsis: true })
      doc.text(String(li.quantity), doc.page.width - 240, itemY, { align: 'right', width: 40 })
      doc.text(fmtMoney(li.unitPriceCents), doc.page.width - 190, itemY, { align: 'right', width: 70 })
      doc.font('Helvetica-Bold')
        .text(fmtMoney(li.totalCents), doc.page.width - 110, itemY, { align: 'right', width: 60 })
      itemY += itemH
    })

    // ── Totals ──
    const totalsTop = itemY + 16
    doc.moveTo(50, totalsTop - 8).lineTo(doc.page.width - 50, totalsTop - 8).strokeColor('#e5e7eb').lineWidth(0.5).stroke()

    const tLabelX = doc.page.width - 210
    const tValueX = doc.page.width - 110
    const tWidth = 60

    doc.fontSize(9).fillColor('#6b7280').font('Helvetica')
    doc.text('Subtotal', tLabelX, totalsTop)
    doc.fillColor('#111827').font('Helvetica-Bold')
      .text(fmtMoney(subtotalCents), tValueX, totalsTop, { align: 'right', width: tWidth })

    if (invoice.taxCents > 0) {
      doc.fontSize(9).fillColor('#6b7280').font('Helvetica')
        .text('Tax', tLabelX, totalsTop + 16)
      doc.fillColor('#111827').font('Helvetica-Bold')
        .text(fmtMoney(invoice.taxCents), tValueX, totalsTop + 16, { align: 'right', width: tWidth })
    }

    const totalY = totalsTop + (invoice.taxCents > 0 ? 36 : 20)
    doc.rect(tLabelX - 10, totalY - 4, 170, 26).fill('#111827')
    doc.fontSize(11).fillColor('#ffffff').font('Helvetica-Bold')
    doc.text('Total Due', tLabelX, totalY + 3)
    doc.text(fmtMoney(invoice.amountCents), tValueX, totalY + 3, { align: 'right', width: tWidth })

    // ── Paid badge ──
    if (invoice.paidAt) {
      const paidY = totalY + 36
      doc.rect(50, paidY, doc.page.width - 100, 34).fill('#d1fae5')
      doc.fontSize(10).fillColor('#065f46').font('Helvetica-Bold')
        .text('PAYMENT RECEIVED', 64, paidY + 8)
      doc.fontSize(9).fillColor('#065f46').font('Helvetica')
        .text(`${invoice.paidAt.toLocaleDateString('en-US')} · ${fmtMoney(invoice.amountCents)}`, 64, paidY + 21)
    }

    // ── Notes ──
    if (invoice.notes) {
      const noteY = (invoice.paidAt ? totalY + 80 : totalY + 44)
      doc.rect(50, noteY, doc.page.width - 100, 10).fill('#f9fafb')
      doc.fontSize(8).fillColor('#6b7280').font('Helvetica-Bold').text('NOTES', 60, noteY + 2)
      doc.fontSize(9).fillColor('#374151').font('Helvetica')
        .text(invoice.notes, 60, noteY + 18, { width: doc.page.width - 120 })
    }

    // ── Footer ──
    const footerY = doc.page.height - 50
    doc.moveTo(50, footerY).lineTo(doc.page.width - 50, footerY).strokeColor('#e5e7eb').lineWidth(0.5).stroke()
    doc.fontSize(8).fillColor('#9ca3af').font('Helvetica')
      .text(`Generated ${new Date().toLocaleString()} · ${COMPANY_NAME} · Thank you for your business`,
        50, footerY + 10, { align: 'center', width: doc.page.width - 100 })

    doc.end()
  } catch (err) {
    console.error('PDF generation error:', err)
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: 'Failed to generate invoice PDF' })
    }
  }
})

export default router
