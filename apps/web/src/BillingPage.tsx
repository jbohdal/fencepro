/**
 * Accounts Receivable / Billing Dashboard
 */

import { useState, useMemo } from 'react'
import { getInvoices, getPayments, getARSummary, type Invoice, type Payment } from './billingStore'

const fmtD = (c: number) => '$' + (c / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })

type Tab = 'ar' | 'overdue' | 'payments'

const statusColors: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600', sent: 'bg-blue-100 text-blue-700',
  partially_paid: 'bg-yellow-100 text-yellow-700', paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700', void: 'bg-gray-100 text-gray-400',
}

export default function BillingPage() {
  const [tab, setTab] = useState<Tab>('ar')
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Accounts Receivable</h1>
        <p className="text-sm text-gray-500 mt-1">Track outstanding balances, overdue invoices, and payment history.</p>
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
        {([['ar', 'Aging Report'], ['overdue', 'Overdue'], ['payments', 'Payments']] as const).map(([k, label]) => (
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
              {payments.map(p => (
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
