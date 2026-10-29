/**
 * Pending Orders page — materials reserved from pull sheets on SOLD jobs, and
 * the draft purchase orders a job's materials marked Ordered makes, marked
 * Draft (draftPOs.ts; Jonathan, Oct 28 2026).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  usePendingOrders,
  getPendingOrders, updatePendingOrderStatus, deletePendingOrder,
  updatePendingOrderItem, checkStockForOrder,
  type PendingOrder, type PendingOrderStatus,
} from './pendingOrderStore'
import { toast } from './toast'
import { can, useCan, jobPagePath } from './permissions'
import { getPurchaseOrders, closeDraftPO, type PurchaseOrder } from './purchaseOrderStore'
import { shownDrafts, salesOrderOfDraft, compareToSalesOrder, relationText, orderedStep, supplierOf } from './draftPOs'
import { getJob } from './jobStore'
import { navigate } from './nav'
import { partWithPair } from '../../portal/src/server/lib/partNames'

const fmt = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(c / 100)
/** A cost, for the owner, admin, manager and office; a Salesman's or Installer's copy has none (—). */
const costText = (c: number | undefined) => (can('costs.view') && typeof c === 'number' ? fmt(c) : '—')

const STATUS_COLORS: Record<PendingOrderStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-700',
  ordered: 'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500',
}

export default function PendingOrdersPage() {
  const [bump, setBump] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'draft' | PendingOrderStatus>('all')
  // Drafts carry costs only: the owner, office and Salesman (the server leaves them out for the Installer).
  const seesDrafts = useCan('costs.view')
  // The orders are read when this opens, not on every page load (audit #17), and again on each save.
  const { load, retry, tick } = usePendingOrders()

  const orders = useMemo(() => {
    const all = getPendingOrders()
    return filter === 'all' ? all : filter === 'draft' ? [] : all.filter(o => o.status === filter)
  }, [bump, filter, tick, load])
  const drafts = useMemo(() => (seesDrafts && (filter === 'all' || filter === 'draft') ? shownDrafts(getPurchaseOrders() as PurchaseOrder[]) : []), [bump, filter, tick, load, seesDrafts])

  const selectedDraft = selectedId?.startsWith('po:') ? drafts.find(p => `po:${p.id}` === selectedId) ?? null : null
  const selected = selectedId && !selectedDraft ? orders.find(o => o.id === selectedId) || getPendingOrders().find(o => o.id === selectedId) || null : null

  // On a phone the detail sits under the list: bring it into view when one is picked.
  const detailRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (selectedId && window.matchMedia?.('(max-width: 1023px)').matches) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [selectedId])

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
    try { deletePendingOrder(order.id) } catch (err: any) { toast.error('Could not delete the order', err?.message || 'Unknown error.'); return }
    setSelectedId(null)
    reload()
  }

  /** The Sales Order a draft goes with: the job's own, else its quote's. */
  function orderOf(po: PurchaseOrder): PendingOrder | null {
    return salesOrderOfDraft(po, getPendingOrders(), getJob(po.jobId)?.quoteId ?? null)
  }

  function markDraftOrdered(po: PurchaseOrder) {
    const so = orderOf(po)
    const step = orderedStep(so)
    const cmp = so ? compareToSalesOrder(po, so) : null
    if (so && cmp && !cmp.same && !confirm(`This draft is not the same as the job's Sales Order. Mark ordered marks the Sales Order${step === 'mark_sales_order' ? ' Ordered' : ''} as the order placed, with its parts, and closes this draft. Go on?`)) return
    if (getPurchaseOrders().find(p => p.id === po.id)?.status !== 'draft') { toast.error('This draft is already closed', 'It was closed on another screen.'); reload(); return }
    try {
      // The Sales Order is the one record that says the materials are ordered: marked there, the same as its own Mark Ordered.
      if (step === 'mark_sales_order' && so) updatePendingOrderStatus(so.id, 'ordered')
      closeDraftPO(po.id, 'ordered')
    } catch (err: any) {
      toast.error('Could not mark the draft ordered', err?.message || 'Unknown error.')
      return
    }
    toast.success('Draft closed as ordered',
      step === 'mark_sales_order' ? "The job's Sales Order is marked Ordered." : step === 'sales_order_already' ? "The job's Sales Order was already marked Ordered." : 'This job has no Sales Order; its materials are tracked on the job.')
    setSelectedId(step === 'mark_sales_order' && so ? so.id : null)
    reload()
  }

  function discardDraft(po: PurchaseOrder) {
    if (!confirm(`Discard draft ${po.poNumber} for ${po.jobName || 'this job'}? The job and its Sales Order stay as they are.`)) return
    try {
      if (!closeDraftPO(po.id, 'cancelled')) { toast.error('This draft is already closed', 'It was closed on another screen.'); reload(); return }
    } catch (err: any) { toast.error('Could not discard the draft', err?.message || 'Unknown error.'); return }
    toast.success('Draft discarded')
    setSelectedId(null)
    reload()
  }

  const FILTERS: Array<['all' | 'draft' | PendingOrderStatus, string]> = [
    ['all', 'All'], ...(seesDrafts ? [['draft', 'Drafts'] as ['draft', string]] : []),
    ['pending', 'Pending'], ['ordered', 'Ordered'], ['received', 'Received'], ['cancelled', 'Cancelled'],
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Orders</h1>
          <p className="text-sm text-gray-500 mt-1">The materials each sold job needs, from its pull sheet as signed and its approved change orders, waiting to be ordered and received.</p>
        </div>
        <div className="flex flex-wrap gap-1 bg-gray-100 rounded-xl p-1">
          {FILTERS.map(([s, label]) => (
            <button key={s} onClick={() => setFilter(s)} data-orders-filter={s}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${filter === s ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* list */}
        <div className="space-y-4 min-w-0">
        {seesDrafts && (filter === 'draft' || drafts.length > 0) && (
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden" data-draft-pos>
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500">
              Draft purchase orders ({drafts.length})
            </div>
            {drafts.length === 0 ? (
              <div className="text-center py-8 px-4 text-gray-400 text-sm">No drafts. A job's materials marked Ordered on the Operations board make one.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {drafts.map(p => (
                  <button key={p.id} onClick={() => setSelectedId(`po:${p.id}`)} data-draft-po={p.id}
                    className={`w-full text-left px-4 py-3 min-h-[48px] hover:bg-orange-50 transition-colors ${selectedId === `po:${p.id}` ? 'bg-orange-50' : ''}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{p.jobName || '—'}</p>
                        <p className="text-xs text-gray-500 truncate">{p.poNumber} · {supplierOf(p) ?? 'Supplier not set'}</p>
                        <p className="text-[10px] text-gray-400 mt-0.5">Made {new Date(p.createdAt).toLocaleDateString()}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-700" data-draft-mark>Draft</span>
                        <p className="text-sm font-bold text-gray-900 mt-1">{costText(p.subtotalCents)}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {filter !== 'draft' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 text-xs font-semibold text-gray-500">
            Orders ({orders.length})
          </div>
          {load !== 'ready' ? (
            <div className="text-center py-12 text-gray-500 text-sm" data-orders-load={load}>
              {load === 'loading' ? 'Loading the Sales Orders…' : (<>Could not load the Sales Orders. Check the signal. <button type="button" onClick={retry} className="text-orange-700 font-semibold underline min-h-[44px] px-2">Try again</button></>)}
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No orders. Each sold job gets one by itself, from its pull sheet.</div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
              {orders.map(o => (
                <button key={o.id} onClick={() => setSelectedId(o.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-orange-50 transition-colors ${selectedId === o.id ? 'bg-orange-50' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{o.customerName || '—'}</p>
                      <p className="text-xs text-gray-500 truncate">{o.quoteName}</p>
                      {o.source && <p className="text-[10px] text-gray-400 truncate" data-order-source>From: {o.source}</p>}
                      <p className="text-[10px] text-gray-400 mt-0.5">{new Date(o.createdAt).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[o.status]}`}>{o.status}</span>
                      <p className="text-sm font-bold text-gray-900 mt-1">{costText(o.totalCostCents)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        )}
        </div>

        {/* detail */}
        <div className="lg:col-span-2 min-w-0 scroll-mt-4" ref={detailRef}>
          {selectedDraft ? (
            <DraftDetail po={selectedDraft} order={orderOf(selectedDraft)} onOrdered={markDraftOrdered} onDiscard={discardDraft}
              onShowOrder={id => { setFilter('all'); setSelectedId(id) }} />
          ) : selected ? (
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
    const rows = order.items.map(i => `<tr><td>${partWithPair(i.itemName)}</td><td class="r">${i.requiredQuantity}</td><td class="r">${costText(i.unitCostCents)}</td><td class="r">${costText(i.totalCostCents)}</td></tr>`).join('')
    const html = `<!doctype html><html><head><title>Pull Sheet — ${order.customerName}</title>
<style>body{font-family:-apple-system,Segoe UI,sans-serif;padding:32px;color:#1f2937}h1{margin:0;font-size:20px}h2{margin:4px 0 16px;font-size:12px;color:#6b7280}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#f9fafb;padding:6px;font-size:9px;text-transform:uppercase;color:#6b7280;text-align:left;font-weight:700}td{padding:6px;border-bottom:1px solid #f3f4f6}td.r{text-align:right}tfoot td{font-weight:700;background:#f9fafb}</style></head><body>
<h1>Pull Sheet — ${order.customerName}</h1><h2>${order.quoteName} · ${new Date(order.createdAt).toLocaleDateString()}</h2>
<table><thead><tr><th>Item</th><th style="text-align:right">Qty</th><th style="text-align:right">Unit Cost</th><th style="text-align:right">Total</th></tr></thead>
<tbody>${rows}</tbody><tfoot><tr><td colspan="3">TOTAL</td><td class="r">${costText(order.totalCostCents)}</td></tr></tfoot></table>
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
            {/* Why it was cancelled, when a deletion cancelled it (portal lib/deletion.ts), and any other note. */}
            {order.notes?.trim() && <p className="text-xs text-gray-700 mt-2 whitespace-pre-line break-words" data-order-notes>{order.notes}</p>}
          </div>
          <span className={`text-[10px] font-bold px-3 py-1 rounded-full ${STATUS_COLORS[order.status]}`}>{order.status}</span>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="mx-6 mt-4 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
          <p className="text-xs font-bold text-yellow-800">⚠ Low stock on {warnings.length} item{warnings.length === 1 ? '' : 's'}</p>
          <ul className="mt-2 text-xs text-yellow-900 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{partWithPair(w.itemName)}: need {w.required}, have {w.available} (short {w.short})</li>
            ))}
          </ul>
        </div>
      )}

      <div className="px-6 py-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 font-semibold border-b border-gray-100">
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
                <td className="py-2 text-gray-900">{partWithPair(i.itemName)}</td>
                <td className="py-2 text-right">{i.requiredQuantity}</td>
                <td className="py-2 text-right">
                  <input type="number" value={i.quantityReceived} min={0} max={i.requiredQuantity}
                    onChange={e => updatePendingOrderItem(order.id, i.id, { quantityReceived: Number(e.target.value) })}
                    className="w-16 border border-gray-200 rounded px-2 py-1 text-xs text-right" />
                </td>
                <td className="py-2 text-right text-gray-600">{costText(i.unitCostCents)}</td>
                <td className="py-2 text-right font-medium">{costText(i.totalCostCents)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold border-t border-gray-200">
              <td colSpan={4} className="py-2 text-right text-gray-700">Total</td>
              <td className="py-2 text-right text-gray-900">{costText(order.totalCostCents)}</td>
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
          <button onClick={() => onAdvance(order, 'cancelled')} className="btn btn-secondary">Cancel order</button>
        )}
        {can('records.delete') && <button onClick={() => onRemove(order)} className="text-sm text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg">Delete</button>}
      </div>
    </div>
  )
}

/**
 * One draft purchase order (draftPOs.ts): what it is for, its lines, how it
 * stands against the job's Sales Order, and what the office does next. Laid
 * out as stacked lines, so it reads in a phone's narrow column without
 * scrolling sideways.
 */
function DraftDetail({ po, order, onOrdered, onDiscard, onShowOrder }: {
  po: PurchaseOrder
  order: PendingOrder | null
  onOrdered: (po: PurchaseOrder) => void
  onDiscard: (po: PurchaseOrder) => void
  onShowOrder: (orderId: string) => void
}) {
  const job = getJob(po.jobId)
  const cmp = order ? compareToSalesOrder(po, order) : null
  const step = orderedStep(order)
  const supplier = supplierOf(po)
  const address = po.jobAddress || job?.customerAddress || ''
  const scope = job ? [job.fenceStyle, job.totalFeet ? `${job.totalFeet} ft` : ''].filter(Boolean).join(', ') : ''

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden" data-draft-detail={po.id}>
      <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-gray-900 break-words">{po.jobName || job?.customerName || '—'}</h2>
            {address && <p className="text-xs text-gray-500 mt-0.5 break-words">{address}</p>}
            {scope && <p className="text-xs text-gray-500 break-words">{scope}</p>}
          </div>
          <span className="shrink-0 text-[10px] font-bold px-3 py-1 rounded-full bg-purple-100 text-purple-700">Draft</span>
        </div>
        <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-gray-500">Purchase order</dt><dd className="text-gray-900 min-w-0 break-words">{po.poNumber}</dd>
          <dt className="text-gray-500">Supplier</dt><dd className={`min-w-0 break-words ${supplier ? 'text-gray-900' : 'text-gray-500'}`}>{supplier ?? 'Not set'}</dd>
          <dt className="text-gray-500">Made</dt><dd className="text-gray-900 min-w-0">{new Date(po.createdAt).toLocaleDateString()}, when the job's materials were marked Ordered</dd>
        </dl>
      </div>

      <div className={`mx-4 sm:mx-6 mt-4 rounded-lg border p-3 text-xs ${!order || cmp?.same ? 'bg-gray-50 border-gray-200 text-gray-700' : 'bg-yellow-50 border-yellow-200 text-yellow-900'}`} data-draft-relation={!order ? 'none' : cmp?.same ? 'same' : 'differs'}>
        <p>{relationText(order, cmp)}</p>
        {cmp && !cmp.same && (
          <ul className="mt-2 space-y-0.5">
            {cmp.qtyDiffers.map(d => <li key={`q-${d.itemName}`} className="break-words">{partWithPair(d.itemName)}: {d.draft} here, {d.order} on the Sales Order</li>)}
            {cmp.onlyDraft.map(n => <li key={`d-${n}`} className="break-words">{partWithPair(n)}: only on this draft</li>)}
            {cmp.onlyOrder.map(n => <li key={`o-${n}`} className="break-words">{partWithPair(n)}: only on the Sales Order</li>)}
          </ul>
        )}
        {order && (
          <button type="button" onClick={() => onShowOrder(order.id)} className="mt-2 text-orange-700 font-semibold underline min-h-[44px]" data-draft-show-order>
            Show the Sales Order
          </button>
        )}
      </div>

      <ul className="px-4 sm:px-6 py-3 divide-y divide-gray-50">
        {(po.lineItems ?? []).map(l => (
          <li key={l.id} className="py-2 flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className="text-gray-900 break-words">{partWithPair(l.itemName)}</p>
              <p className="text-xs text-gray-500">Qty {l.quantity} × {costText(l.unitCostCents)}</p>
            </div>
            <p className="shrink-0 font-medium text-gray-900">{costText(l.totalCents)}</p>
          </li>
        ))}
      </ul>
      <div className="px-4 sm:px-6 py-3 border-t border-gray-200 flex items-center justify-between text-sm font-bold">
        <span className="text-gray-700">Subtotal</span>
        <span className="text-gray-900" data-draft-subtotal>{costText(po.subtotalCents)}</span>
      </div>

      <div className="px-4 sm:px-6 py-4 border-t border-gray-100 flex flex-wrap gap-2 justify-end">
        {job
          ? <button type="button" onClick={() => navigate(jobPagePath(po.jobId), { from: 'Inventory' })} className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg min-h-[44px]" data-draft-open-job>Open job</button>
          : <span className="text-xs text-gray-500 self-center">The job is no longer on the board.</span>}
        <button type="button" onClick={() => onOrdered(po)} className="text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg min-h-[44px]" data-draft-ordered
          title={step === 'mark_sales_order' ? "Marks the job's Sales Order Ordered and closes this draft" : 'Closes this draft as ordered'}>
          Mark ordered
        </button>
        <button type="button" onClick={() => onDiscard(po)} className="text-sm text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg min-h-[44px]" data-draft-discard>Discard draft</button>
      </div>
    </div>
  )
}
