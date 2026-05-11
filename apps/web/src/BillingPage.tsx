/**
 * Accounts Receivable / Billing Dashboard
 */

import { useState, useMemo } from 'react'
import jsPDF from 'jspdf'
import { getInvoices, getPayments, getARSummary, type Invoice, type Payment } from './billingStore'

const fmtD = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })

type Tab = 'ar' | 'invoices' | 'overdue' | 'payments'

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-700',
  partially_paid: 'bg-yellow-100 text-yellow-700', paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700', void: 'bg-gray-100 text-gray-400',
}

function getCompanyInfo() {
  try {
    const raw = localStorage.getItem('fencepro_config')
    if (raw) {
      const c = JSON.parse(raw)
      return c.company || {}
    }
  } catch {}
  return {}
}

// ─── Logo loader (browser canvas → base64) ─────────────────────────────────

function loadLogoDataUrl(url: string): Promise<string | null> {
  return new Promise(resolve => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) { resolve(null); return }
        ctx.drawImage(img, 0, 0)
        resolve(canvas.toDataURL('image/png'))
      } catch { resolve(null) }
    }
    img.onerror = () => resolve(null)
    img.src = url
    setTimeout(() => resolve(null), 5000)
  })
}

// ─── Invoice PDF (binary download via jsPDF) ───────────────────────────────

async function exportInvoicePdf(inv: Invoice) {
  const company = getCompanyInfo()
  const companyName: string = company.name || 'EZBiz'
  const addrParts = [company.address, [company.city, company.state, company.zip].filter(Boolean).join(', ')].filter(Boolean)
  const contactParts = [company.phone, company.email].filter(Boolean)

  const logoUrl: string | undefined = company.logoUrl || company.logo_url
  const logoDataUrl = logoUrl ? await loadLogoDataUrl(logoUrl) : null

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 50
  const right = W - margin

  // Accent bar
  doc.setFillColor(249, 115, 22)
  doc.rect(0, 0, W, 6, 'F')

  // Logo (if available)
  let companyTextX = margin
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', margin, 12, 44, 32)
    companyTextX = margin + 52
  }

  // Company name
  doc.setFontSize(18).setFont('helvetica', 'bold').setTextColor(17, 24, 39)
  doc.text(companyName, companyTextX, logoDataUrl ? 20 : 36)

  // Company address / contact
  doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(107, 114, 128)
  let cy = logoDataUrl ? 33 : 52
  for (const line of [...addrParts, ...contactParts]) {
    doc.text(line, companyTextX, cy)
    cy += 13
  }

  // INVOICE label (top-right)
  doc.setFontSize(26).setFont('helvetica', 'bold').setTextColor(249, 115, 22)
  doc.text('INVOICE', right, 36, { align: 'right' })

  // Meta block (right-aligned)
  const metaY = 52
  const metaRows: [string, string][] = [
    ['Invoice #', inv.invoiceNumber],
    ['Issued', inv.issuedDate],
    ['Due', inv.dueDate],
    ['Status', inv.status.replace(/_/g, ' ')],
  ]
  doc.setFontSize(8.5)
  metaRows.forEach(([label, value], i) => {
    const y = metaY + i * 15
    doc.setFont('helvetica', 'normal').setTextColor(107, 114, 128)
    doc.text(label, right - 130, y)
    doc.setFont('helvetica', 'bold').setTextColor(17, 24, 39)
    doc.text(value, right, y, { align: 'right' })
  })

  // Divider
  const divY = Math.max(cy, metaY + metaRows.length * 15) + 14
  doc.setDrawColor(229, 231, 235).setLineWidth(0.5)
  doc.line(margin, divY, right, divY)

  // Bill To
  doc.setFontSize(8).setFont('helvetica', 'bold').setTextColor(156, 163, 175)
  doc.text('BILL TO', margin, divY + 16)
  doc.setFontSize(13).setFont('helvetica', 'bold').setTextColor(17, 24, 39)
  doc.text(inv.customerName, margin, divY + 30)
  if (inv.jobName) {
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(107, 114, 128)
    doc.text(`Job: ${inv.jobName}`, margin, divY + 44)
  }

  // Line items table header
  const tableTop = divY + 62
  doc.setFillColor(17, 24, 39)
  doc.rect(margin, tableTop, W - 2 * margin, 22, 'F')
  doc.setFontSize(8).setFont('helvetica', 'bold').setTextColor(255, 255, 255)
  doc.text('DESCRIPTION', margin + 8, tableTop + 14)
  doc.text('QTY', right - 195, tableTop + 14, { align: 'right' })
  doc.text('UNIT PRICE', right - 100, tableTop + 14, { align: 'right' })
  doc.text('TOTAL', right, tableTop + 14, { align: 'right' })

  // Line items rows
  const items = inv.lineItems?.length > 0
    ? inv.lineItems
    : [{ description: inv.title || `Invoice ${inv.invoiceNumber}`, quantity: 1, unitPriceCents: inv.subtotalCents, totalCents: inv.subtotalCents }]

  let rowY = tableTop + 28
  items.forEach((li, idx) => {
    if (idx % 2 === 1) {
      doc.setFillColor(249, 250, 251)
      doc.rect(margin, rowY - 4, W - 2 * margin, 18, 'F')
    }
    doc.setFontSize(9.5).setFont('helvetica', 'normal').setTextColor(17, 24, 39)
    doc.text(li.description, margin + 8, rowY + 8, { maxWidth: W - 2 * margin - 220 })
    doc.text(String(li.quantity), right - 195, rowY + 8, { align: 'right' })
    doc.text(fmtD(li.unitPriceCents), right - 100, rowY + 8, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(fmtD(li.totalCents), right, rowY + 8, { align: 'right' })
    rowY += 20
  })

  // Totals section
  const totY = rowY + 14
  doc.setDrawColor(229, 231, 235).setLineWidth(0.5).line(margin, totY - 6, right, totY - 6)

  const totLabelX = right - 160
  doc.setFontSize(9.5).setFont('helvetica', 'normal').setTextColor(107, 114, 128)
  doc.text('Subtotal', totLabelX, totY)
  doc.setFont('helvetica', 'bold').setTextColor(17, 24, 39)
  doc.text(fmtD(inv.subtotalCents), right, totY, { align: 'right' })

  let nextY = totY + 16
  if (inv.discountCents > 0) {
    doc.setFont('helvetica', 'normal').setTextColor(107, 114, 128).text('Discount', totLabelX, nextY)
    doc.setFont('helvetica', 'bold').setTextColor(5, 150, 105).text(`−${fmtD(inv.discountCents)}`, right, nextY, { align: 'right' })
    nextY += 16
  }
  if (inv.taxCents > 0) {
    doc.setFont('helvetica', 'normal').setTextColor(107, 114, 128).text(`Tax (${(inv.taxRate * 100).toFixed(1)}%)`, totLabelX, nextY)
    doc.setFont('helvetica', 'bold').setTextColor(17, 24, 39).text(fmtD(inv.taxCents), right, nextY, { align: 'right' })
    nextY += 16
  }

  // Total Due box
  doc.setFillColor(17, 24, 39).rect(totLabelX - 12, nextY - 6, 172, 24, 'F')
  doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(255, 255, 255)
  doc.text('Total Due', totLabelX, nextY + 9)
  doc.text(fmtD(inv.totalCents), right, nextY + 9, { align: 'right' })
  nextY += 32

  if (inv.amountPaidCents > 0) {
    doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(107, 114, 128)
    doc.text('Amount Paid', totLabelX, nextY)
    doc.setFont('helvetica', 'bold').setTextColor(5, 150, 105)
    doc.text(`−${fmtD(inv.amountPaidCents)}`, right, nextY, { align: 'right' })
    nextY += 16
    if (inv.balanceDueCents > 0) {
      doc.setFont('helvetica', 'bold').setTextColor(220, 38, 38).setFontSize(11)
      doc.text('Balance Due', totLabelX, nextY)
      doc.text(fmtD(inv.balanceDueCents), right, nextY, { align: 'right' })
      nextY += 16
    }
  }

  // Paid stamp
  if (inv.status === 'paid') {
    doc.setFillColor(209, 250, 229).rect(margin, nextY + 6, W - 2 * margin, 28, 'F')
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(6, 95, 70)
    doc.text(`Payment received${inv.paidAt ? ' on ' + inv.paidAt : ''}`, margin + 12, nextY + 23)
    nextY += 42
  }

  // Notes
  if (inv.notes) {
    nextY += 8
    doc.setFillColor(249, 250, 251).rect(margin, nextY, W - 2 * margin, 14, 'F')
    doc.setFontSize(8).setFont('helvetica', 'bold').setTextColor(107, 114, 128)
    doc.text('NOTES', margin + 8, nextY + 10)
    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(55, 65, 81)
    doc.text(inv.notes, margin + 8, nextY + 26, { maxWidth: W - 2 * margin - 16 })
  }

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 36
  doc.setDrawColor(229, 231, 235).line(margin, footerY - 8, right, footerY - 8)
  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(156, 163, 175)
  doc.text(`Generated ${new Date().toLocaleString()} · ${companyName}`, W / 2, footerY, { align: 'center' })

  doc.save(`invoice-${inv.invoiceNumber}.pdf`)
}

// ─── AR Statement PDF (binary download via jsPDF) ──────────────────────────

async function exportStatementPdf(invoices: Invoice[]) {
  const company = getCompanyInfo()
  const companyName: string = company.name || 'EZBiz'
  const addrParts = [company.address, [company.city, company.state, company.zip].filter(Boolean).join(', ')].filter(Boolean)
  const contactParts = [company.phone, company.email].filter(Boolean)

  const logoUrl: string | undefined = company.logoUrl || company.logo_url
  const logoDataUrl = logoUrl ? await loadLogoDataUrl(logoUrl) : null

  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const margin = 50
  const right = W - margin

  // Accent bar
  doc.setFillColor(249, 115, 22)
  doc.rect(0, 0, W, 6, 'F')

  // Logo (if available)
  let companyTextX = margin
  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', margin, 12, 44, 32)
    companyTextX = margin + 52
  }

  // Company name
  doc.setFontSize(18).setFont('helvetica', 'bold').setTextColor(17, 24, 39)
  doc.text(companyName, companyTextX, logoDataUrl ? 20 : 36)

  let cy = logoDataUrl ? 33 : 52
  doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(107, 114, 128)
  for (const line of [...addrParts, ...contactParts]) { doc.text(line, companyTextX, cy); cy += 13 }

  // Statement title
  doc.setFontSize(24).setFont('helvetica', 'bold').setTextColor(249, 115, 22)
  doc.text('AR STATEMENT', right, 36, { align: 'right' })
  doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(107, 114, 128)
  doc.text(`As of ${new Date().toLocaleDateString()}`, right, 50, { align: 'right' })

  // Summary KPIs
  const outstanding = invoices.filter(i => i.status !== 'void' && i.balanceDueCents > 0)
    .reduce((s, i) => s + i.balanceDueCents, 0)
  const overdue = invoices.filter(i => i.balanceDueCents > 0 && new Date(i.dueDate) < new Date() && i.status !== 'void' && i.status !== 'paid')
    .reduce((s, i) => s + i.balanceDueCents, 0)
  const totalBilled = invoices.filter(i => i.status !== 'void').reduce((s, i) => s + i.totalCents, 0)

  const sumY = Math.max(cy, 60) + 16
  const sumW = (W - 2 * margin) / 3
  const kpis = [
    { label: 'Total Billed', value: fmtD(totalBilled), color: [17, 24, 39] as [number, number, number] },
    { label: 'Outstanding', value: fmtD(outstanding), color: outstanding > 0 ? [217, 119, 6] as [number, number, number] : [5, 150, 105] as [number, number, number] },
    { label: 'Overdue', value: fmtD(overdue), color: overdue > 0 ? [220, 38, 38] as [number, number, number] : [5, 150, 105] as [number, number, number] },
  ]
  kpis.forEach(({ label, value, color }, i) => {
    const x = margin + i * sumW
    doc.setDrawColor(229, 231, 235).setLineWidth(0.5)
    doc.rect(x + 2, sumY, sumW - 6, 40)
    doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(107, 114, 128)
    doc.text(label, x + 10, sumY + 14)
    doc.setFontSize(14).setFont('helvetica', 'bold').setTextColor(...color)
    doc.text(value, x + 10, sumY + 32)
  })

  // Table header
  const tableTop = sumY + 56
  doc.setFillColor(17, 24, 39).rect(margin, tableTop, W - 2 * margin, 22, 'F')
  doc.setFontSize(8).setFont('helvetica', 'bold').setTextColor(255, 255, 255)
  const cols = { num: margin + 4, cust: 160, due: 300, amount: 380, bal: 450, status: 510 }
  doc.text('Invoice #', cols.num, tableTop + 14)
  doc.text('Customer', cols.cust, tableTop + 14)
  doc.text('Due Date', cols.due, tableTop + 14)
  doc.text('Amount', cols.amount, tableTop + 14)
  doc.text('Balance', cols.bal, tableTop + 14)
  doc.text('Status', cols.status, tableTop + 14)

  let rowY = tableTop + 28
  const rowH = 18
  const pageH = doc.internal.pageSize.getHeight()

  const displayed = [...invoices]
    .filter(i => i.status !== 'void')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

  displayed.forEach((inv, idx) => {
    if (rowY + rowH > pageH - 60) {
      doc.addPage()
      rowY = 50
    }
    if (idx % 2 === 1) {
      doc.setFillColor(249, 250, 251).rect(margin, rowY - 3, W - 2 * margin, rowH, 'F')
    }

    const statusCol: [number, number, number] = inv.status === 'paid' ? [5, 150, 105]
      : inv.status === 'overdue' ? [220, 38, 38]
      : [17, 24, 39]

    doc.setFontSize(9).setFont('helvetica', 'normal').setTextColor(17, 24, 39)
    doc.text(inv.invoiceNumber, cols.num, rowY + 11)
    doc.text(inv.customerName.slice(0, 18), cols.cust, rowY + 11)
    doc.text(inv.dueDate, cols.due, rowY + 11)
    doc.text(fmtD(inv.totalCents), cols.amount, rowY + 11)
    doc.text(fmtD(inv.balanceDueCents), cols.bal, rowY + 11)
    doc.setFont('helvetica', 'bold').setTextColor(...statusCol)
    doc.text(inv.status.replace(/_/g, ' '), cols.status, rowY + 11)
    rowY += rowH
  })

  if (displayed.length === 0) {
    doc.setFontSize(11).setFont('helvetica', 'normal').setTextColor(156, 163, 175)
    doc.text('No invoices on record.', W / 2, rowY + 12, { align: 'center' })
    rowY += 28
  }

  // Totals row
  doc.setDrawColor(229, 231, 235).line(margin, rowY + 4, right, rowY + 4)
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(17, 24, 39)
  doc.text('Total Outstanding', cols.num, rowY + 18)
  doc.setTextColor(...(outstanding > 0 ? [217, 119, 6] as [number, number, number] : [5, 150, 105] as [number, number, number]))
  doc.text(fmtD(outstanding), cols.bal, rowY + 18)

  // Footer
  const footerY = doc.internal.pageSize.getHeight() - 36
  doc.setDrawColor(229, 231, 235).line(margin, footerY - 8, right, footerY - 8)
  doc.setFontSize(8).setFont('helvetica', 'normal').setTextColor(156, 163, 175)
  doc.text(`Generated ${new Date().toLocaleString()} · ${companyName} · Accounts Receivable Statement`, W / 2, footerY, { align: 'center' })

  doc.save(`ar-statement-${new Date().toISOString().slice(0, 10)}.pdf`)
}

export default function BillingPage() {
  const [tab, setTab] = useState<Tab>('ar')
  const [invSearch, setInvSearch] = useState('')
  const [invStatus, setInvStatus] = useState('all')
  const invoices = useMemo(() => getInvoices(), [])
  const payments = useMemo(() => getPayments(), [])
  const arData = useMemo(() => getARSummary(), [])

  const totalOutstanding = arData.reduce((s, r) => s + r.summary.outstandingCents, 0)
  const totalOverdue = arData.reduce((s, r) => s + r.summary.overdueCents, 0)
  const dueThisWeek = invoices.filter(i => {
    const due = new Date(i.dueDate)
    const now = new Date()
    const weekEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    return i.balanceDueCents > 0 && due >= now && due <= weekEnd
  }).reduce((s, i) => s + i.balanceDueCents, 0)

  const overdueInvoices = invoices.filter(i => {
    if (i.status === 'void' || i.status === 'paid') return false
    return i.balanceDueCents > 0 && new Date(i.dueDate) < new Date()
  }).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())

  const filteredInvoices = useMemo(() => {
    let list = [...invoices]
    if (invStatus !== 'all') list = list.filter(i => i.status === invStatus)
    if (invSearch.trim()) {
      const q = invSearch.toLowerCase()
      list = list.filter(i =>
        i.invoiceNumber.toLowerCase().includes(q) ||
        i.customerName.toLowerCase().includes(q) ||
        (i.jobName || '').toLowerCase().includes(q)
      )
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }, [invoices, invStatus, invSearch])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts Receivable</h1>
          <p className="text-sm text-gray-500 mt-1">Track outstanding balances, overdue invoices, and payment history.</p>
        </div>
        <button
          onClick={() => exportStatementPdf(invoices)}
          className="inline-flex items-center gap-2 text-sm bg-gray-800 hover:bg-gray-900 text-white font-semibold px-4 py-2 rounded-lg transition"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          Download AR Statement
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5"><p className="text-xs text-gray-400 uppercase">Outstanding</p><p className="text-2xl font-bold text-gray-900">{fmtD(totalOutstanding)}</p></div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5"><p className="text-xs text-gray-400 uppercase">Overdue</p><p className="text-2xl font-bold text-red-600">{fmtD(totalOverdue)}</p></div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5"><p className="text-xs text-gray-400 uppercase">Due This Week</p><p className="text-2xl font-bold text-orange-600">{fmtD(dueThisWeek)}</p></div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5"><p className="text-xs text-gray-400 uppercase">Total Invoices</p><p className="text-2xl font-bold text-gray-900">{invoices.length}</p></div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5"><p className="text-xs text-gray-400 uppercase">Customers w/ Balance</p><p className="text-2xl font-bold text-gray-900">{arData.length}</p></div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([['ar', 'Aging Report'], ['invoices', 'Invoices'], ['overdue', 'Overdue'], ['payments', 'Payments']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{label}</button>
        ))}
      </div>

      {/* Aging Report */}
      {tab === 'ar' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 grid grid-cols-8 gap-2 text-xs font-medium text-gray-500 uppercase">
            <div className="col-span-2">Customer</div><div className="text-right">Current</div><div className="text-right">1-30</div><div className="text-right">31-60</div><div className="text-right">61-90</div><div className="text-right">90+</div><div className="text-right">Total</div>
          </div>
          {arData.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No outstanding balances</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {arData.map(r => (
                <div key={r.customerId} className="px-6 py-3 grid grid-cols-8 gap-2 items-center text-sm hover:bg-gray-50">
                  <div className="col-span-2 font-medium text-gray-900">{r.customerName}</div>
                  <div className="text-right text-gray-600">{r.summary.agingCurrent > 0 ? fmtD(r.summary.agingCurrent) : '—'}</div>
                  <div className="text-right text-yellow-600">{r.summary.aging1to30 > 0 ? fmtD(r.summary.aging1to30) : '—'}</div>
                  <div className="text-right text-orange-600">{r.summary.aging31to60 > 0 ? fmtD(r.summary.aging31to60) : '—'}</div>
                  <div className="text-right text-red-600">{r.summary.aging61to90 > 0 ? fmtD(r.summary.aging61to90) : '—'}</div>
                  <div className="text-right text-red-700">{r.summary.aging90plus > 0 ? fmtD(r.summary.aging90plus) : '—'}</div>
                  <div className="text-right font-semibold text-gray-900">{fmtD(r.summary.outstandingCents)}</div>
                </div>
              ))}
              <div className="px-6 py-3 grid grid-cols-8 gap-2 bg-gray-50 font-semibold text-sm">
                <div className="col-span-2">Total</div>
                <div className="text-right">{fmtD(arData.reduce((s, r) => s + r.summary.agingCurrent, 0))}</div>
                <div className="text-right text-yellow-600">{fmtD(arData.reduce((s, r) => s + r.summary.aging1to30, 0))}</div>
                <div className="text-right text-orange-600">{fmtD(arData.reduce((s, r) => s + r.summary.aging31to60, 0))}</div>
                <div className="text-right text-red-600">{fmtD(arData.reduce((s, r) => s + r.summary.aging61to90, 0))}</div>
                <div className="text-right text-red-700">{fmtD(arData.reduce((s, r) => s + r.summary.aging90plus, 0))}</div>
                <div className="text-right">{fmtD(totalOutstanding)}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Invoices */}
      {tab === 'invoices' && (
        <div className="space-y-3">
          <div className="flex gap-3 items-center">
            <input
              type="text"
              placeholder="Search invoices…"
              value={invSearch}
              onChange={e => setInvSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
            <select
              value={invStatus}
              onChange={e => setInvStatus(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Statuses</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="partially_paid">Partially Paid</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
              <option value="void">Void</option>
            </select>
            <span className="text-sm text-gray-400">{filteredInvoices.length} invoice{filteredInvoices.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 grid grid-cols-12 gap-2 text-xs font-semibold text-gray-500 uppercase">
              <div className="col-span-3">Invoice</div>
              <div className="col-span-3">Customer</div>
              <div className="text-right col-span-2">Amount</div>
              <div className="col-span-2">Due Date</div>
              <div className="col-span-1">Status</div>
              <div className="col-span-1 text-right">PDF</div>
            </div>
            {filteredInvoices.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">No invoices found</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {filteredInvoices.map(inv => (
                  <div key={inv.id} className="px-5 py-3 grid grid-cols-12 gap-2 items-center text-sm hover:bg-gray-50">
                    <div className="col-span-3">
                      <p className="font-medium text-gray-900">{inv.invoiceNumber}</p>
                      {inv.jobName && <p className="text-xs text-gray-400 truncate">{inv.jobName}</p>}
                    </div>
                    <div className="col-span-3 text-gray-700 truncate">{inv.customerName}</div>
                    <div className="col-span-2 text-right font-semibold text-gray-900">{fmtD(inv.totalCents)}</div>
                    <div className="col-span-2 text-xs text-gray-500">{inv.dueDate}</div>
                    <div className="col-span-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${statusColors[inv.status] || 'bg-gray-100'}`}>
                        {inv.status.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <button
                        onClick={() => exportInvoicePdf(inv)}
                        title="Download PDF"
                        className="inline-flex items-center gap-1 text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-2.5 py-1.5 rounded-lg transition"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a1 1 0 001 1h16a1 1 0 001-1v-3" />
                        </svg>
                        PDF
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Overdue */}
      {tab === 'overdue' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {overdueInvoices.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No overdue invoices</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {overdueInvoices.map(inv => {
                const daysOver = Math.floor((Date.now() - new Date(inv.dueDate).getTime()) / (1000 * 60 * 60 * 24))
                return (
                  <div key={inv.id} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{inv.customerName}</p>
                      <p className="text-xs text-gray-500">{inv.invoiceNumber} · Due: {inv.dueDate}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-red-600">{fmtD(inv.balanceDueCents)}</span>
                      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{daysOver}d overdue</span>
                      <button
                        onClick={() => exportInvoicePdf(inv)}
                        title="Download PDF"
                        className="inline-flex items-center gap-1 text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-2.5 py-1.5 rounded-lg transition"
                      >
                        <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a1 1 0 001 1h16a1 1 0 001-1v-3" />
                        </svg>
                        PDF
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Payments */}
      {tab === 'payments' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {payments.length === 0 ? (
            <div className="text-center py-8 text-gray-400 text-sm">No payments recorded</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {payments.map((p: Payment) => (
                <div key={p.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{p.customerName}</p>
                    <p className="text-xs text-gray-500">{p.paymentDate} · {p.paymentMethod} · Inv: {p.invoiceNumber}</p>
                  </div>
                  <span className="text-sm font-semibold text-green-600">{fmtD(p.amountCents)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
