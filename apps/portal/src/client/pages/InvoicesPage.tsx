import { useState, useEffect } from 'react'
import { api } from '../lib/api'
import type { InvoiceView, PaginatedResponse } from '../../types/index'

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
  refunded: 'bg-purple-100 text-purple-700',
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceView[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')

  useEffect(() => {
    setLoading(true)
    api.get<PaginatedResponse<InvoiceView>>(`/invoices?status=${statusFilter}`)
      .then(d => setInvoices(d.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [statusFilter])

  const totalOwed = invoices.filter(i => i.status === 'pending' || i.status === 'overdue').reduce((s, i) => s + i.amountCents, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Invoices</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
          <option value="paid">Paid</option>
        </select>
        {totalOwed > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2">
            <span className="text-sm text-orange-600">Total Due: </span>
            <span className="text-lg font-bold text-orange-700">{fmt(totalOwed)}</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading invoices...</div>
      ) : invoices.length === 0 ? (
        <div className="text-center py-16 text-gray-400">No invoices found</div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Invoice #</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Amount</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Due Date</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Paid</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Status</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {invoices.map(inv => {
                const isOverdue = inv.status === 'overdue' || (inv.status === 'pending' && new Date(inv.dueDate) < new Date())
                return (
                  <tr key={inv.id} className={`hover:bg-gray-50 ${isOverdue ? 'bg-red-50/30' : ''}`}>
                    <td className="px-5 py-3 font-medium text-gray-900">{inv.invoiceNumber}</td>
                    <td className="px-3 py-3 text-right font-bold text-gray-900">{fmt(inv.amountCents)}</td>
                    <td className={`px-3 py-3 text-xs ${isOverdue ? 'text-red-600 font-semibold' : 'text-gray-500'}`}>
                      {new Date(inv.dueDate).toLocaleDateString()}
                      {isOverdue && ' ⚠'}
                    </td>
                    <td className="px-3 py-3 text-xs text-gray-500">
                      {inv.paidAt ? new Date(inv.paidAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-3 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[inv.status] || 'bg-gray-100'}`}>
                        {inv.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      {inv.hasPdf && (
                        <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noreferrer"
                          className="text-xs text-orange-500 hover:text-orange-600 font-semibold">
                          PDF
                        </a>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
