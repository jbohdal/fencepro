/**
 * Pending Orders page — materials reserved from pull sheets on SOLD jobs.
 */

import { useMemo, useState } from 'react'
import {
  getPendingOrders, updatePendingOrderStatus, deletePendingOrder,
  updatePendingOrderItem, checkStockForOrder,
  type PendingOrder, type PendingOrderStatus,
} from './pendingOrderStore'
import { toast } from './toast'

const fmt = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(c / 100)

const STATUS_COLORS: Record<PendingOrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  ordered: 'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

export default function PendingOrdersPage() {
  const [bump, setBump] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | PendingOrderStatus>('all')

  const orders = useMemo(() => {
    const all = getPendingOrders()
    return filter === 'all' ? all : all.filter(o => o.status === filter)
  }, [bump, filter])

  const selected = selectedId ? orders.find(o => o.id === selectedId) || getPendingOrders().find(o => o.id === selectedId) || null : null

  function reload() { setBump(b => b + 1) }

  function advance(order: PendingOrder, to: PendingOrderStatus) {
    try {
      updatePendingOrderStatus(order.id, to)
      toast.success(`Order marked ${to}`, to === 'received' ? 'Inventory deducted.' : undefined)
      reload()
    } catch (err: any) {
      toast.error('Could not update order', err?.message || 'Unknown error.')
    }
  }

  function remove(order: PendingOrder) {
    if (!confirm(`Delete this pending order for ${order.customerName}?`)) return
    deletePendingOrder(order.id)
    setSelectedId(null)
    reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Pending Orders</h1>
          <p className="text-sm text-gray-500 mt-1">Materials reserved from pull sheets on sold jobs, awaiting ordering and receipt.</p>
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {(['all', 'pending', 'ordered', 'received', 'cancelled'] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition capitalize ${filter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* list */}
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-widest">
            Orders ({orders.length})
          </div>
          {orders.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No pending orders. They're created automatically when a quote is marked SOLD.</div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
              {orders.map(o => (
                <button key={o.id} onClick={() => setSelectedId(o.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-orange-50 transition-colors ${selectedId === o.id ? 'bg-orange-50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{o.customerName || '—'}</p>
                      <p className="text-xs text-gray-500 truncate">{o.quoteName}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{new Date(o.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${STATUS_COLORS[o.status]}`}>{o.status}</span>
                      <p className="text-sm font-bold text-gray-900 mt-1">{fmt(o.totalCostCents)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* detail */}
        <div className="lg:col-span-2">
          {selected ? (
            <OrderDetail order={selected} onAdvance={advance} onRemove={remove} />
          ) : (
            <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-gray-400 text-sm">
              Select a pending order on the left to view line items and advance its status.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function OrderDetail({ order, onAdvance, onRemove }: {
  order: PendingOrder;
  onAdvance: (o: PendingOrder, to: PendingOrderStatus) => void;
  onRemove: (o: PendingOrder) => void;
}) {
  const warnings = checkStockForOrder(order)

  function printPullSheet() {
    const w = window.open('', '_blank')
    if (!w) return
    const rows = order.items.map(i => `<tr><td>${i.itemName}</td><td class="r">${i.requiredQuantity}</td><td class="r">${fmt(i.unitCostCents)}</td><td class="r">${fmt(i.totalCostCents)}</td></tr>`).join('')
    const html = `<!doctype html><html><head><title>Pull Sheet — ${order.customerName}</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;padding:32px;color:#1f2937}h1{margin:0;font-size:20px}h2{margin:4px 0 16px;font-size:12px;color:#6b7280}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f9fafb;padding:6px;font-size:9px;text-transform:uppercase;color:#6b7280;text-align:left;font-weight:700}td{padding:6px;border-bottom:1px solid #f3f4f6}td.r{text-align:right}tfoot td{font-weight:700;background:#f9fafb}</style></head><body>
<h1>Pull Sheet — ${order.customerName}</h1><h2>${order.quoteName} · ${new Date(order.createdAt).toLocaleDateString()}</h2>
<table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Cost</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${rows}</tbody><tfoot><tr><td colspan="3">TOTAL</td><td class="r">${fmt(order.totalCostCents)}</td></tr></tfoot></table>
<script>window.print()</script></body></html>`
    w.document.write(html); w.document.close()
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{order.customerName}</h2>
            <p className="text-xs text-gray-500 mt-0.5">{order.quoteName}</p>
            <p className="text-[10px] text-gray-400 mt-1">Created {new Date(order.createdAt).toLocaleString()}</p>
          </div>
          <span className={`text-[10px] font-bold uppercase px-3 py-1 rounded-full ${STATUS_COLORS[order.status]}`}>{order.status}</span>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mx-6 mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="text-xs font-bold text-yellow-800 uppercase tracking-widest">⚠ Low stock on {warnings.length} item{warnings.length === 1 ? '' : 's'}</p>
          <ul className="mt-2 text-xs text-yellow-900 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w.itemName}: need {w.required}, have {w.available} (short {w.short})</li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-6 py-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 uppercase font-semibold border-b border-gray-100">
              <th className="text-left py-2">Item</th>
              <th className="text-right py-2">Required</th>
              <th className="text-right py-2">Received</th>
              <th className="text-right py-2">Unit Cost</th>
              <th className="text-right py-2">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {order.items.map(i => (
              <tr key={i.id}>
                <td className="py-2 text-gray-900">{i.itemName}</td>
                <td className="py-2 text-right">{i.requiredQuantity}</td>
                <td className="py-2 text-right">
                  <input type="number" value={i.quantityReceived} min={0} max={i.requiredQuantity}
                    onChange={e => updatePendingOrderItem(order.id, i.id, { quantityReceived: Number(e.target.value) })}
                    className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-right" />
                </td>
                <td className="py-2 text-right text-gray-600">{fmt(i.unitCostCents)}</td>
                <td className="py-2 text-right font-medium">{fmt(i.totalCostCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold border-t border-gray-200">
              <td colSpan={4} className="py-2 text-right text-gray-700">Total</td>
              <td className="py-2 text-right text-gray-900">{fmt(order.totalCostCents)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="px-6 py-4 border-t border-gray-100 flex flex-wrap gap-2 justify-end">
        <button onClick={printPullSheet} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg">Print Pull Sheet</button>
        {order.status === 'pending' && (
          <button onClick={() => onAdvance(order, 'ordered')} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg">Mark Ordered</button>
        )}
        {order.status === 'ordered' && (
          <button onClick={() => onAdvance(order, 'received')} className="text-sm bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg">Mark Received</button>
        )}
        {order.status !== 'cancelled' && order.status !== 'received' && (
          <button onClick={() => onAdvance(order, 'cancelled')} className="text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 px-3 py-1.5 rounded-lg">Cancel Order</button>
        )}
        <button onClick={() => onRemove(order)} className="text-sm text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg">Delete</button>
      </div>
    </div>
  )
}
