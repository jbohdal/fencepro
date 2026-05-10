/**
 * Inventory module wrapper — renders the existing inventory admin page
 * as the Items tab, plus Sales Orders (formerly Pending Orders) and an
 * Operations sub-tab showing pending/in-progress/ordered jobs.
 */

import { useMemo, useState } from 'react'
import AdminPage from './AdminPage'
import PendingOrdersPage from './PendingOrdersPage'
import { getPendingOrders, updatePendingOrderStatus, type PendingOrderStatus } from './pendingOrderStore'

type InvTab = 'items' | 'sales_orders' | 'operations'

const fmt = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(c / 100)

export default function InventoryPage() {
  const [tab, setTab] = useState<InvTab>('items')

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">Items, sales orders, and active job-material commitments.</p>
        </div>
      </div>

      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {([
          ['items', 'Items'],
          ['sales_orders', 'Sales Orders'],
          ['operations', 'Operations'],
        ] as [InvTab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'items' && <AdminPage />}
      {tab === 'sales_orders' && <PendingOrdersPage />}
      {tab === 'operations' && <OperationsView />}
    </div>
  )
}

function OperationsView() {
  const orders = useMemo(() => {
    const all = getPendingOrders()
    return all.filter(o => o.status === 'pending' || o.status === 'ordered' || o.status === 'in_progress' as any)
  }, [])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [, setTick] = useState(0)

  const grouped: Record<string, typeof orders> = { pending: [], ordered: [] }
  for (const o of orders) {
    if (o.status === 'pending') grouped.pending.push(o)
    else if (o.status === 'ordered') grouped.ordered.push(o)
  }

  function advance(orderId: string, to: PendingOrderStatus) {
    updatePendingOrderStatus(orderId, to)
    setTick(x => x + 1)
  }

  function sufficiencyIndicator(o: any) {
    const items = o.items || []
    const shortItems = items.filter((i: any) => i.isSufficientStock === false)
    if (items.length === 0) return <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">No items</span>
    if (shortItems.length === 0) return <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">All in stock</span>
    return <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{shortItems.length} short</span>
  }

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center">
        <p className="text-4xl mb-2">📦</p>
        <p className="text-gray-700 font-medium">No active sales orders</p>
        <p className="text-xs text-gray-400 mt-1">When a quote is marked sold, the sales order appears here until it's fulfilled.</p>
      </div>
    )
  }

  function renderSection(title: string, list: typeof orders, emptyMsg: string) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">{title}</p>
          <span className="text-xs text-gray-400">{list.length}</span>
        </div>
        {list.length === 0 ? (
          <div className="text-center py-6 text-xs text-gray-400">{emptyMsg}</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {list.map(o => {
              const isOpen = expanded === o.id
              return (
                <div key={o.id}>
                  <div className="px-5 py-3 hover:bg-orange-50 cursor-pointer flex items-center gap-4"
                    onClick={() => setExpanded(isOpen ? null : o.id)}>
                    <span className="text-gray-300 text-xs">{isOpen ? '▾' : '▸'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{o.customerName || 'Unknown customer'}</p>
                      <p className="text-xs text-gray-500 truncate">{o.quoteName} · {new Date(o.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      {sufficiencyIndicator(o)}
                      <span className="text-sm font-bold text-gray-900">{fmt(o.totalCostCents)}</span>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                      <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-[10px] uppercase font-semibold text-gray-500 tracking-widest">
                            <th className="text-left py-1.5">Item</th>
                            <th className="text-right py-1.5">Required</th>
                            <th className="text-right py-1.5">On Hand</th>
                            <th className="text-right py-1.5">Unit Cost</th>
                            <th className="text-right py-1.5">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {o.items.map(i => (
                            <tr key={i.id}>
                              <td className="py-1.5 text-gray-800">{i.itemName}</td>
                              <td className="py-1.5 text-right text-gray-700">{i.requiredQuantity}</td>
                              <td className="py-1.5 text-right text-gray-500">{i.quantityOnHandAtTimeOfOrder ?? '—'}</td>
                              <td className="py-1.5 text-right text-gray-700">{fmt(i.unitCostCents)}</td>
                              <td className="py-1.5 text-right">
                                {i.isSufficientStock === false
                                  ? <span className="text-[10px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full">Short</span>
                                  : i.isSufficientStock === true
                                    ? <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">OK</span>
                                    : <span className="text-[10px] text-gray-400">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </div>
                      <div className="mt-3 flex gap-2 flex-wrap justify-end">
                        {o.status === 'pending' && (
                          <button onClick={() => advance(o.id, 'ordered')}
                            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg">Mark as Ordered</button>
                        )}
                        {o.status === 'ordered' && (
                          <button onClick={() => advance(o.id, 'received')}
                            className="text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded-lg">Mark as Fulfilled</button>
                        )}
                        <button onClick={() => {
                          const w = window.open('', '_blank')
                          if (!w) return
                          const rows = o.items.map(i => `<tr><td>${i.itemName}</td><td class="r">${i.requiredQuantity}</td><td class="r">${fmt(i.unitCostCents)}</td><td class="r">${fmt(i.totalCostCents)}</td></tr>`).join('')
                          w.document.write(`<!doctype html><html><head><title>Pull Sheet — ${o.customerName}</title><style>body{font-family:system-ui;padding:32px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f9fafb;text-align:left;padding:6px;font-size:9px;text-transform:uppercase;color:#6b7280}td{padding:6px;border-bottom:1px solid #f3f4f6}td.r{text-align:right}</style></head><body><h1>Pull Sheet — ${o.customerName}</h1><h2>${o.quoteName} · ${new Date(o.createdAt).toLocaleDateString()}</h2><table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit</th><th style="text-align:right">Total</th></tr></thead><tbody>${rows}</tbody></table><script>window.print()</script></body></html>`)
                          w.document.close()
                        }}
                          className="text-xs border border-gray-200 text-gray-700 hover:bg-gray-50 px-3 py-1.5 rounded-lg">Print Pull Sheet</button>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {renderSection('Pending — Awaiting Material Order', grouped.pending, 'Nothing pending')}
      {renderSection('Ordered — Waiting for Material Arrival', grouped.ordered, 'Nothing on order')}
    </div>
  )
}
