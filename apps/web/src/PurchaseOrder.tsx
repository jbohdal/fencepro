import type { SavedQuote } from './QuotesPage'

/* ───────── config loader ───────── */

interface CompanyInfo {
  name: string; phone: string; email: string
  address: string; city: string; state: string; zip: string
}

function loadCompany(): CompanyInfo {
  try {
    const raw = localStorage.getItem('fencepro_config')
    if (raw) {
      const cfg = JSON.parse(raw)
      if (cfg.company) return cfg.company
    }
  } catch { /* fall through */ }
  return { name: 'GD Fence Pro', phone: '', email: '', address: '', city: '', state: 'FL', zip: '' }
}

/* ───────── PO generator ───────── */

export function generatePO(quote: SavedQuote, vendor?: string, notes?: string) {
  const co = loadCompany()
  const poNumber = `PO-${quote.id.slice(0, 6).toUpperCase()}`
  const today = new Date().toISOString().slice(0, 10)
  const items = quote.pullSheet || []
  const total = items.reduce((s, i) => s + i.total, 0)

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${poNumber} — ${quote.customerName}</title>
<style>
  @page { size: letter; margin: 0.6in; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; color: #1a1a1a; line-height: 1.5; }

  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 3px solid #f97316; }
  .company-name { font-size: 22px; font-weight: 800; color: #111; }
  .company-info { font-size: 10px; color: #666; margin-top: 2px; }
  .po-badge { text-align: right; }
  .po-title { font-size: 20px; font-weight: 800; color: #f97316; letter-spacing: 1px; }
  .po-number { font-size: 13px; font-weight: 700; color: #333; margin-top: 2px; }
  .po-date { font-size: 10px; color: #888; }

  .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 20px; }
  .info-box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; }
  .info-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #999; margin-bottom: 4px; }
  .info-value { font-size: 11px; color: #333; font-weight: 500; }
  .info-value strong { font-weight: 700; color: #111; }

  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  thead th { background: #111; color: #fff; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 10px; text-align: left; }
  thead th.r { text-align: right; }
  tbody td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; font-size: 11px; }
  tbody td.r { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:nth-child(even) { background: #fafafa; }
  tbody tr:hover { background: #fff7ed; }
  .item-name { font-weight: 600; }

  tfoot td { padding: 10px; border-top: 2px solid #111; font-weight: 800; font-size: 12px; }
  tfoot td.r { text-align: right; }

  .row-num { color: #ccc; font-size: 10px; width: 28px; }

  .footer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 20px; }
  .notes-box { border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; min-height: 60px; }
  .notes-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #999; margin-bottom: 4px; }
  .notes-text { font-size: 10px; color: #555; white-space: pre-wrap; }

  .totals-box { border: 2px solid #111; border-radius: 6px; padding: 12px; }
  .totals-row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
  .totals-row.grand { border-top: 1px solid #ddd; margin-top: 6px; padding-top: 8px; font-size: 14px; font-weight: 800; }

  .sig-line { margin-top: 40px; display: flex; gap: 48px; }
  .sig-block { flex: 1; }
  .sig-rule { border-top: 1px solid #aaa; margin-top: 32px; padding-top: 4px; font-size: 9px; color: #999; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="header">
  <div>
    <div class="company-name">${esc(co.name || 'GD Fence Pro')}</div>
    <div class="company-info">
      ${co.address ? esc(co.address) + '<br>' : ''}${co.city ? esc(co.city) + ', ' : ''}${esc(co.state)} ${esc(co.zip)}
      ${co.phone ? '<br>' + esc(co.phone) : ''}
      ${co.email ? ' · ' + esc(co.email) : ''}
    </div>
  </div>
  <div class="po-badge">
    <div class="po-title">PURCHASE ORDER</div>
    <div class="po-number">${esc(poNumber)}</div>
    <div class="po-date">Date: ${esc(today)}</div>
  </div>
</div>

<div class="info-grid">
  <div class="info-box">
    <div class="info-label">Vendor / Supplier</div>
    <div class="info-value"><strong>${esc(vendor || '______________________')}</strong></div>
  </div>
  <div class="info-box">
    <div class="info-label">Job / Ship To</div>
    <div class="info-value">
      <strong>${esc(quote.customerName)}</strong><br>
      ${esc(quote.customerAddress || '')}
    </div>
  </div>
  <div class="info-box">
    <div class="info-label">Job Details</div>
    <div class="info-value">
      <strong>${esc(quote.fenceStyle)}</strong><br>
      ${quote.sections} sections · ${quote.runs?.length || 0} runs<br>
      ${quote.walkGates} walk gates · ${quote.dblGates} dbl gates
    </div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:28px">#</th>
      <th>Material / Item</th>
      <th class="r" style="width:60px">Qty</th>
      <th class="r" style="width:80px">Unit Cost</th>
      <th class="r" style="width:90px">Total</th>
    </tr>
  </thead>
  <tbody>
    ${items.map((item, i) => `
    <tr>
      <td class="row-num">${i + 1}</td>
      <td class="item-name">${esc(item.item)}</td>
      <td class="r">${item.qty}</td>
      <td class="r">$${item.unitCost.toFixed(2)}</td>
      <td class="r">$${item.total.toFixed(2)}</td>
    </tr>`).join('')}
  </tbody>
  <tfoot>
    <tr>
      <td colspan="2">Total — ${items.length} line items</td>
      <td class="r">${items.reduce((s, i) => s + i.qty, 0)}</td>
      <td></td>
      <td class="r">$${total.toFixed(2)}</td>
    </tr>
  </tfoot>
</table>

<div class="footer-grid">
  <div class="notes-box">
    <div class="notes-label">Notes / Special Instructions</div>
    <div class="notes-text">${esc(notes || quote.notes || 'None')}</div>
  </div>
  <div class="totals-box">
    <div class="totals-row">
      <span>Subtotal</span>
      <span>$${total.toFixed(2)}</span>
    </div>
    <div class="totals-row">
      <span>Tax</span>
      <span>—</span>
    </div>
    <div class="totals-row">
      <span>Shipping</span>
      <span>—</span>
    </div>
    <div class="totals-row grand">
      <span>Total</span>
      <span>$${total.toFixed(2)}</span>
    </div>
  </div>
</div>

<div class="sig-line">
  <div class="sig-block">
    <div class="sig-rule">Authorized Signature</div>
  </div>
  <div class="sig-block">
    <div class="sig-rule">Date</div>
  </div>
</div>

</body>
</html>`

  const win = window.open('', '_blank')
  if (win) {
    win.document.write(html)
    win.document.close()
    // Auto-trigger print dialog after a brief render delay
    setTimeout(() => win.print(), 400)
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/* ───────── PO Button with optional vendor input ───────── */

export function POButton({ quote }: { quote: SavedQuote }) {
  const hasItems = quote.pullSheet && quote.pullSheet.length > 0
  if (!hasItems) return null

  return (
    <button
      onClick={() => generatePO(quote)}
      className="text-xs bg-gray-900 hover:bg-gray-800 text-white font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1.5"
    >
      <span>📄</span> Download PO
    </button>
  )
}
