/**
 * Accounts Payable Dashboard.
 *
 * Shows outstanding vendor balances, aging buckets, upcoming & overdue bills,
 * category breakdown, and export.
 */

import { useMemo, useState } from 'react'
import {
  getBills, getAPSummary, getVendorAging,
  refreshOverdueBills, recordVendorPayment,
  type VendorBill, type VendorBillCategory, type VendorPaymentMethod,
} from './vendorStore'

const fmt = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(c / 100)

const CATEGORY_LABELS: Record<VendorBillCategory, string> = {
  materials: 'Materials', labor: 'Labor', equipment: 'Equipment',
  overhead: 'Overhead', subcontractor: 'Subcontractor', utilities: 'Utilities',
  insurance: 'Insurance', other: 'Other',
}

const CATEGORY_COLORS: Record<VendorBillCategory, string> = {
  materials: '#f97316', labor: '#06b6d4', equipment: '#8b5cf6',
  overhead: '#10b981', subcontractor: '#ec4899', utilities: '#f59e0b',
  insurance: '#14b8a6', other: '#94a3b8',
}

export default function AccountsPayablePage() {
  const [bump, setBump] = useState(0)
  const [payingBill, setPayingBill] = useState<VendorBill | null>(null)

  const summary = useMemo(() => { refreshOverdueBills(); return getAPSummary() }, [bump])
  const aging = useMemo(() => getVendorAging(), [bump])
  const allBills = useMemo(() => getBills(), [bump])

  const now = new Date()
  const fortnightLater = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

  const upcoming = allBills
    .filter(b => b.status !== 'void' && b.status !== 'paid' && b.balanceDueCents > 0)
    .filter(b => {
      const due = new Date(b.dueDate)
      return due >= now && due <= fortnightLater
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  const overdue = allBills
    .filter(b => b.status !== 'void' && b.status !== 'paid' && b.balanceDueCents > 0)
    .filter(b => new Date(b.dueDate) < now)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  const categoryTotals = new Map<VendorBillCategory, number>()
  for (const b of allBills) {
    if (b.status === 'void' || b.status === 'paid') continue
    if (b.balanceDueCents <= 0) continue
    categoryTotals.set(b.category, (categoryTotals.get(b.category) || 0) + b.balanceDueCents)
  }
  const catMax = Math.max(1, ...categoryTotals.values())

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts Payable</h1>
          <p className="text-sm text-gray-500 mt-1">Outstanding vendor balances, upcoming payments, and aging report.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportAgingPdf(aging, summary)}
            className="text-sm bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg">Export PDF</button>
          <button onClick={() => exportAgingCsv(aging)}
            className="text-sm bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg">Export CSV</button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
        <Card label="Total Outstanding" value={fmt(summary.totalOutstandingCents)} />
        <Card label="Total Overdue" value={fmt(summary.totalOverdueCents)} color="text-red-600" />
        <Card label="Due This Week" value={fmt(summary.dueThisWeekCents)} color="text-orange-600" />
        <Card label="Due This Month" value={fmt(summary.dueThisMonthCents)} color="text-yellow-600" />
        <Card label="Paid YTD" value={fmt(summary.paidYtdCents)} color="text-green-600" />
      </div>

      {/* Aging report */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 font-semibold text-sm text-gray-900">Vendor Aging Report</div>
        <div className="px-6 py-2 bg-gray-50 border-b border-gray-100 grid grid-cols-8 gap-2 text-xs font-semibold text-gray-500 uppercase">
          <div className="col-span-2">Vendor</div>
          <div className="text-right">Current</div>
          <div className="text-right">1-30</div>
          <div className="text-right">31-60</div>
          <div className="text-right">61-90</div>
          <div className="text-right">90+</div>
          <div className="text-right">Total</div>
        </div>
        {aging.length === 0 ? (
          <div className="text-center py-8 text-gray-400 text-sm">No outstanding balances</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {aging.map(r => (
              <div key={r.vendorId} className="px-6 py-2 grid grid-cols-8 gap-2 items-center text-sm hover:bg-gray-50">
                <div className="col-span-2 font-medium text-gray-900">{r.vendorName}</div>
                <div className="text-right text-gray-600">{r.current > 0 ? fmt(r.current) : '—'}</div>
                <div className="text-right text-yellow-600">{r.d1to30 > 0 ? fmt(r.d1to30) : '—'}</div>
                <div className="text-right text-orange-600">{r.d31to60 > 0 ? fmt(r.d31to60) : '—'}</div>
                <div className="text-right text-red-600">{r.d61to90 > 0 ? fmt(r.d61to90) : '—'}</div>
                <div className="text-right text-red-700">{r.d90plus > 0 ? fmt(r.d90plus) : '—'}</div>
                <div className="text-right font-semibold text-gray-900">{fmt(r.total)}</div>
              </div>
            ))}
            <div className="px-6 py-3 grid grid-cols-8 gap-2 bg-gray-50 font-semibold text-sm">
              <div className="col-span-2">Total</div>
              <div className="text-right">{fmt(aging.reduce((s, r) => s + r.current, 0))}</div>
              <div className="text-right text-yellow-600">{fmt(aging.reduce((s, r) => s + r.d1to30, 0))}</div>
              <div className="text-right text-orange-600">{fmt(aging.reduce((s, r) => s + r.d31to60, 0))}</div>
              <div className="text-right text-red-600">{fmt(aging.reduce((s, r) => s + r.d61to90, 0))}</div>
              <div className="text-right text-red-700">{fmt(aging.reduce((s, r) => s + r.d90plus, 0))}</div>
              <div className="text-right">{fmt(summary.totalOutstandingCents)}</div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-100 font-semibold text-sm text-gray-900">Upcoming Payments (14 days)</div>
          {upcoming.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">No upcoming payments in the next 14 days</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {upcoming.map(b => (
                <div key={b.id} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{b.vendorName}</p>
                    <p className="text-xs text-gray-500">{b.billNumber} · Due {b.dueDate} · {CATEGORY_LABELS[b.category]}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-orange-600">{fmt(b.balanceDueCents)}</span>
                    <button onClick={() => setPayingBill(b)}
                      className="text-xs bg-green-600 hover:bg-green-700 text-white px-2.5 py-1 rounded">Pay</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Overdue */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-3 bg-red-50 border-b border-red-100 font-semibold text-sm text-red-900">Overdue Bills</div>
          {overdue.length === 0 ? (
            <div className="text-center py-6 text-gray-400 text-sm">No overdue bills</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {overdue.map(b => {
                const days = Math.floor((Date.now() - new Date(b.dueDate).getTime()) / (1000 * 60 * 60 * 24))
                return (
                  <div key={b.id} className="px-6 py-3 flex items-center justify-between hover:bg-gray-50">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{b.vendorName}</p>
                      <p className="text-xs text-gray-500">{b.billNumber} · Due {b.dueDate}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded font-bold">{days}d late</span>
                      <span className="text-sm font-semibold text-red-600">{fmt(b.balanceDueCents)}</span>
                      <button onClick={() => setPayingBill(b)}
                        className="text-xs bg-red-600 hover:bg-red-700 text-white px-2.5 py-1 rounded">Pay Now</button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Outstanding by Category</h3>
        {categoryTotals.size === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">No outstanding bills to categorize</div>
        ) : (
          <div className="space-y-2">
            {Array.from(categoryTotals.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([cat, total]) => (
                <div key={cat} className="flex items-center gap-3">
                  <div className="w-32 text-sm text-gray-700">{CATEGORY_LABELS[cat]}</div>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="h-5 rounded-full transition-all"
                      style={{ width: `${(total / catMax) * 100}%`, backgroundColor: CATEGORY_COLORS[cat] }} />
                  </div>
                  <div className="w-28 text-right text-sm font-semibold text-gray-900">{fmt(total)}</div>
                </div>
              ))}
          </div>
        )}
      </div>

      {payingBill && (
        <PayBillModal bill={payingBill} onClose={() => setPayingBill(null)} onSaved={() => { setPayingBill(null); setBump(b => b + 1) }} />
      )}
    </div>
  )
}

function Card({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color || 'text-gray-900'}`}>{value}</p>
    </div>
  )
}

function PayBillModal({ bill, onClose, onSaved }: { bill: VendorBill; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState((bill.balanceDueCents / 100).toFixed(2))
  const [paymentMethod, setPaymentMethod] = useState<VendorPaymentMethod>('check')
  const [referenceNumber, setReferenceNumber] = useState('')
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')

  function handleSave() {
    const amountCents = Math.round(parseFloat(amount) * 100)
    if (amountCents <= 0) return
    recordVendorPayment({
      billId: bill.id, billNumber: bill.billNumber,
      vendorId: bill.vendorId, vendorName: bill.vendorName,
      amountCents, paymentMethod, referenceNumber, paymentDate,
      recordedBy: 'user', notes,
    })
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl w-full max-w-md">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Record Payment</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <p className="text-gray-500 text-xs uppercase font-semibold">Paying Bill</p>
            <p className="font-medium text-gray-900">{bill.billNumber} · {bill.vendorName}</p>
            <p className="text-xs text-gray-500 mt-1">Balance: {fmt(bill.balanceDueCents)}</p>
          </div>
          <div><label className="text-xs text-gray-500 font-semibold uppercase block mb-1">Amount ($)</label>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="text-xs text-gray-500 font-semibold uppercase block mb-1">Method</label>
            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value as VendorPaymentMethod)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
              <option value="check">Check</option><option value="ach">ACH</option><option value="wire">Wire</option><option value="credit_card">Credit Card</option><option value="cash">Cash</option><option value="other">Other</option>
            </select></div>
          <div><label className="text-xs text-gray-500 font-semibold uppercase block mb-1">Reference</label>
            <input value={referenceNumber} onChange={e => setReferenceNumber(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="text-xs text-gray-500 font-semibold uppercase block mb-1">Date</label>
            <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
          <div><label className="text-xs text-gray-500 font-semibold uppercase block mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" /></div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2">Cancel</button>
          <button onClick={handleSave} className="bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg">Record Payment</button>
        </div>
      </div>
    </div>
  )
}

function exportAgingCsv(aging: ReturnType<typeof getVendorAging>) {
  const header = ['Vendor', 'Current', '1-30', '31-60', '61-90', '90+', 'Total']
  const rows = aging.map(r => [r.vendorName, r.current / 100, r.d1to30 / 100, r.d31to60 / 100, r.d61to90 / 100, r.d90plus / 100, r.total / 100])
  const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `ap_aging_${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

function exportAgingPdf(aging: ReturnType<typeof getVendorAging>, summary: ReturnType<typeof getAPSummary>) {
  const company = (() => {
    try { const raw = localStorage.getItem('fencepro_config'); if (raw) { const c = JSON.parse(raw); return c.company?.name || 'FencePro' } } catch {}
    return 'FencePro'
  })()
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>AP Aging Report</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;padding:32px;color:#1f2937}h1{margin:0;font-size:20px}h2{margin:4px 0 16px;font-size:12px;color:#6b7280}.cards{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:16px 0}.card{border:1px solid #e5e7eb;border-radius:8px;padding:10px}.card .l{font-size:9px;color:#6b7280;text-transform:uppercase;font-weight:700}.card .v{font-size:16px;font-weight:700;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:11px}th{background:#f9fafb;padding:6px;font-size:9px;text-transform:uppercase;color:#6b7280;text-align:left;font-weight:700}td{padding:6px;border-bottom:1px solid #f3f4f6}td.r{text-align:right;font-variant-numeric:tabular-nums}tr.total td{font-weight:700;background:#f9fafb}</style></head><body>
<h1>${company}</h1><h2>Accounts Payable Aging — ${new Date().toLocaleDateString()}</h2>
<div class="cards">
<div class="card"><div class="l">Outstanding</div><div class="v">${fmt(summary.totalOutstandingCents)}</div></div>
<div class="card"><div class="l">Overdue</div><div class="v" style="color:#dc2626">${fmt(summary.totalOverdueCents)}</div></div>
<div class="card"><div class="l">Due This Week</div><div class="v">${fmt(summary.dueThisWeekCents)}</div></div>
<div class="card"><div class="l">Due This Month</div><div class="v">${fmt(summary.dueThisMonthCents)}</div></div>
<div class="card"><div class="l">Paid YTD</div><div class="v" style="color:#059669">${fmt(summary.paidYtdCents)}</div></div>
</div>
<table><thead><tr><th>Vendor</th><th style="text-align:right">Current</th><th style="text-align:right">1-30</th><th style="text-align:right">31-60</th><th style="text-align:right">61-90</th><th style="text-align:right">90+</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${aging.map(r => `<tr><td>${r.vendorName}</td><td class="r">${fmt(r.current)}</td><td class="r">${fmt(r.d1to30)}</td><td class="r">${fmt(r.d31to60)}</td><td class="r">${fmt(r.d61to90)}</td><td class="r">${fmt(r.d90plus)}</td><td class="r">${fmt(r.total)}</td></tr>`).join('')}
<tr class="total"><td>Total</td>
<td class="r">${fmt(aging.reduce((s, r) => s + r.current, 0))}</td>
<td class="r">${fmt(aging.reduce((s, r) => s + r.d1to30, 0))}</td>
<td class="r">${fmt(aging.reduce((s, r) => s + r.d31to60, 0))}</td>
<td class="r">${fmt(aging.reduce((s, r) => s + r.d61to90, 0))}</td>
<td class="r">${fmt(aging.reduce((s, r) => s + r.d90plus, 0))}</td>
<td class="r">${fmt(summary.totalOutstandingCents)}</td></tr></tbody></table>
<script>window.print()</script></body></html>`
  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}
