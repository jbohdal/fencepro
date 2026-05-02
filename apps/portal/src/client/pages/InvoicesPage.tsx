import { useState, useEffect } from 'react'
import { api, apiFetchBlob } from '../lib/api'
import type { InvoiceView, PaginatedResponse } from '../../types/index'

const fmt = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  overdue: 'bg-red-100 text-red-700',
  cancelled: 'bg-gray-100 text-gray-400',
  refunded: 'bg-purple-100 text-purple-700',
}

async function downloadBlob(path: string, filename: string) {
  const blob = await apiFetchBlob(path)
  const objectUrl = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = objectUrl
  a.download = filename
  a.click()
  URL.revokeObjectURL(objectUrl)
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceView[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [downloading, setDownloading] = useState<string | null>(null)
  const [statementLoading, setStatementLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api.get<PaginatedResponse<InvoiceView>>(`/invoices?status=${statusFilter}`)
      .then(d => setInvoices(d.items))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [statusFilter])

  const totalOwed = invoices.filter(i => i.status === 'pending' || i.status === 'overdue').reduce((s, i) => s + i.amountCents, 0)

  const handleDownloadInvoice = async (inv: InvoiceView) => {
    setDownloading(inv.id)
    setError(null)
    try {
      await downloadBlob(`/api/invoices/${inv.id}/pdf`, `invoice-${inv.invoiceNumber}.pdf`)
    } catch {
      setError('Could not download PDF. Please try again.')
    } finally {
      setDownloading(null)
    }
  }

  const handleDownloadStatement = async () => {
    setStatementLoading(true)
    setError(null)
    try {
      await downloadBlob('/api/invoices/statement/pdf', 'account-statement.pdf')
    } catch {
      setError('Could not download statement. Please try again.')
    } finally {
      setStatementLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
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
        <button
          onClick={handleDownloadStatement}
          disabled={statementLoading}
          className="inline-flex items-center gap-2 text-sm bg-gray-800 hover:bg-gray-900 disabled:bg-gray-400 text-white font-semibold px-4 py-2 rounded-lg transition"
        >
          {statementLoading ? (
            <>
              <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
              </svg>
              Generating…
            </>
          ) : (
            <>
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download Statement
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-600">{error}</div>
      )}

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
                <th className="w-36 px-3 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Actions</th>
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
                    <td className="px-3 py-3 text-right">
                      <button
                        onClick={() => handleDownloadInvoice(inv)}
                        disabled={downloading === inv.id}
                        className="inline-flex items-center gap-1.5 text-xs bg-orange-500 hover:bg-orange-600 disabled:bg-orange-300 text-white font-semibold px-3 py-1.5 rounded-lg transition"
                      >
                        {downloading === inv.id ? (
                          <>
                            <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                            </svg>
                            Generating…
                          </>
                        ) : (
                          <>
                            <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a1 1 0 001 1h16a1 1 0 001-1v-3" />
                            </svg>
                            Download PDF
                          </>
                        )}
                      </button>
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
