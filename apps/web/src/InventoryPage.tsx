/**
 * Inventory module wrapper — renders the existing inventory admin page
 * as the Items tab, plus Sales Orders (formerly Pending Orders) and an
 * Operations sub-tab showing pending/in-progress/ordered jobs.
 */

import { useMemo, useState } from 'react'
import AdminPage from './AdminPage'
import VendorInvoicesTab from './VendorInvoicesTab'
import PendingOrdersPage from './PendingOrdersPage'
import { getPendingOrders, updatePendingOrderStatus, usePendingOrders, type PendingOrderStatus } from './pendingOrderStore'
import { replaceUrl } from './nav'
import { toast } from './toast'
import { can, useCan } from './permissions'
import { partWithPair } from '../../portal/src/server/lib/partNames'

type InvTab = 'items' | 'sales_orders' | 'operations' | 'invoices'

const fmt = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(c / 100)
/** A cost, for the owner, admin, manager and office; a Salesman's or Installer's copy has none (—). */
const costText = (c: number | undefined) => (can('costs.view') && typeof c === 'number' ? fmt(c) : '—')

export default function InventoryPage() {
  // Vendor invoices (upload, review, price history): owner and office only.
  const seesInvoices = useCan('invoices.manage')
  const [tab, setTab] = useState<InvTab>(() => (new URLSearchParams(window.location.search).get('tab') === 'invoices' ? 'invoices' : 'items'))
  // ?items=a,b: opened from a quote's price warning, showing just those parts.
  const [onlyIds, setOnlyIds] = useState<string[] | undefined>(() => {
    const ids = new URLSearchParams(window.location.search).get('items')
    return ids ? ids.split(',').filter(Boolean) : undefined
  })
  function showAll() { setOnlyIds(undefined); replaceUrl(window.location.pathname) }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Inventory</h1>
          <p className="text-sm text-gray-500 mt-0.5">Items, sales orders, and active job-material commitments.</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1 w-fit max-w-full">
        {([
          ['items', 'Items'],
          ['sales_orders', 'Sales Orders'],
          ['operations', 'Operations'],
          ...(seesInvoices ? [['invoices', 'Invoices']] : []),
        ] as [InvTab, string][]).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} data-inventory-tab={k}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            {l}
          </button>
        ))}
      </div>

      {tab === 'items' && <AdminPage onlyIds={onlyIds} onShowAll={showAll} />}
      {tab === 'sales_orders' && <PendingOrdersPage />}
      {tab === 'operations' && <OperationsView />}
      {tab === 'invoices' && seesInvoices && <VendorInvoicesTab />}
    </div>
  )
}

function OperationsView() {
  const [tick, setTick] = useState(0)
  // The server makes and updates the orders: read when this opens (not on every page load, audit #17), and each save as it lands.
  const { load, retry, tick: loadTick } = usePendingOrders()
  const orders = useMemo(() => {
    const all = getPendingOrders()
    return all.filter(o => o.status === 'pending' || o.status === 'ordered' || o.status === 'in_progress' as any)
  }, [tick, loadTick, load])
  const [expanded, setExpanded] = useState<string | null>(null)

  const grouped: Record<string, typeof orders> = { pending: [], ordered: [] }
  for (const o of orders) {
    if (o.status === 'pending') grouped.pending.push(o)
    else if (o.status === 'ordered') grouped.ordered.push(o)
  }

  function advance(orderId: string, to: PendingOrderStatus) {
    try { updatePendingOrderStatus(orderId, to) } catch (err: any) { toast.error('Could not update the order', err?.message || 'Unknown error.'); return }
    setTick(x => x + 1)
  }

  function sufficiencyIndicator(o: any) {
    const items = o.items || []
    const shortItems = items.filter((i: any) => i.isSufficientStock === false)
    if (items.length === 0) return <span className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">No items</span>
    if (shortItems.length === 0) return <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">All in stock</span>
    return <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{shortItems.length} short</span>
  }

  if (load !== 'ready') {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-12 text-center text-sm text-gray-500" data-orders-load={load}>
        {load === 'loading' ? 'Loading the Sales Orders…' : (<>Could not load the Sales Orders. Check the signal. <button type="button" onClick={retry} className="text-orange-700 font-semibold underline min-h-[44px] px-2">Try again</button></>)}
      </div>
    )
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
          <p className="text-xs font-bold text-gray-500">{title}</p>
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
                      <span className="text-sm font-bold text-gray-900">{costText(o.totalCostCents)}</span>
                    </div>
                  </div>
                  {isOpen && (
                    <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
                      <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-[10px] font-semibold text-gray-500">
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
                              <td className="py-1.5 text-gray-800">{partWithPair(i.itemName)}</td>
                              <td className="py-1.5 text-right text-gray-700">{i.requiredQuantity}</td>
                              <td className="py-1.5 text-right text-gray-500">{i.quantityOnHandAtTimeOfOrder ?? '—'}</td>
                              <td className="py-1.5 text-right text-gray-700">{costText(i.unitCostCents)}</td>
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
                          const rows = o.items.map(i => `<tr><td>${partWithPair(i.itemName)}</td><td class="r">${i.requiredQuantity}</td><td class="r">${costText(i.unitCostCents)}</td><td class="r">${costText(i.totalCostCents)}</td></tr>`).join('')
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
