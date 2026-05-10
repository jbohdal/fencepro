import { useState } from 'react'

/* ───────── types ───────── */

export interface ChangeOrderItem {
  id: string
  description: string
  amount: number          // positive = add to contract, negative = credit
  type: 'ADD' | 'CREDIT'
}

export interface ChangeOrder {
  id: string
  quoteId: string
  orderNumber: number
  date: string
  items: ChangeOrderItem[]
  total: number
  status: 'PENDING' | 'APPROVED' | 'VOIDED'
  reason: string
  approvedBy: string
}

const STORAGE_KEY = 'fencepro_changeorders'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)

const uid = () => Math.random().toString(36).slice(2, 9)

/* ───────── persistence ───────── */

export function loadChangeOrders(): ChangeOrder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function saveAll(orders: ChangeOrder[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(orders))
}

/** Get total approved change order value for a quote */
export function getApprovedCOTotal(quoteId: string): number {
  return loadChangeOrders()
    .filter(co => co.quoteId === quoteId && co.status === 'APPROVED')
    .reduce((s, co) => s + co.total, 0)
}

/** Get all change orders for a quote */
export function getOrdersForQuote(quoteId: string): ChangeOrder[] {
  return loadChangeOrders().filter(co => co.quoteId === quoteId)
}

/* ───────── Quick CO Modal ───────── */

export function QuickChangeOrderModal({
  quoteId,
  customerName,
  existingCount,
  onSave,
  onClose,
}: {
  quoteId: string
  customerName: string
  existingCount: number
  onSave: (co: ChangeOrder) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<ChangeOrderItem[]>([
    { id: uid(), description: '', amount: 0, type: 'ADD' },
  ])
  const [reason, setReason] = useState('')

  function addItem() {
    setItems(prev => [...prev, { id: uid(), description: '', amount: 0, type: 'ADD' }])
  }

  function updateItem(id: string, field: keyof ChangeOrderItem, val: string | number) {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item
      if (field === 'type') {
        const newType = val as 'ADD' | 'CREDIT'
        return { ...item, type: newType, amount: newType === 'CREDIT' ? -Math.abs(item.amount) : Math.abs(item.amount) }
      }
      if (field === 'amount') {
        const num = Number(val) || 0
        return { ...item, amount: item.type === 'CREDIT' ? -Math.abs(num) : Math.abs(num) }
      }
      return { ...item, [field]: val }
    }))
  }

  function removeItem(id: string) {
    if (items.length <= 1) return
    setItems(prev => prev.filter(i => i.id !== id))
  }

  const total = items.reduce((s, i) => s + i.amount, 0)
  const canSave = items.some(i => i.description.trim() && i.amount !== 0)

  function handleSave() {
    if (!canSave) return
    const co: ChangeOrder = {
      id: uid(),
      quoteId,
      orderNumber: existingCount + 1,
      date: new Date().toISOString().slice(0, 10),
      items: items.filter(i => i.description.trim()),
      total,
      status: 'PENDING',
      reason,
      approvedBy: '',
    }
    onSave(co)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] max-h-[85vh] overflow-y-auto mx-4 lg:mx-0 modal-responsive" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900">Change Order #{existingCount + 1}</h2>
            <p className="text-xs text-gray-400 mt-0.5">{customerName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-gray-500 font-semibold uppercase">Line Items</label>
              <button onClick={addItem} className="text-xs text-orange-500 hover:text-orange-600 font-semibold">+ Add line</button>
            </div>
            <div className="space-y-2">
              {items.map(item => (
                <div key={item.id} className="flex items-center gap-2">
                  <select
                    className="border border-gray-300 rounded-lg px-2 py-2 text-xs w-20 shrink-0"
                    value={item.type}
                    onChange={e => updateItem(item.id, 'type', e.target.value)}
                  >
                    <option value="ADD">Add</option>
                    <option value="CREDIT">Credit</option>
                  </select>
                  <input
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="Description — e.g. Add walk gate north side"
                    value={item.description}
                    onChange={e => updateItem(item.id, 'description', e.target.value)}
                  />
                  <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden w-28 shrink-0 focus-within:ring-2 focus-within:ring-orange-400">
                    <span className="px-2 text-gray-400 bg-gray-50 border-r border-gray-300 py-2 text-xs">$</span>
                    <input
                      type="number" min={0} step={1}
                      className="w-full px-2 py-2 text-sm text-right outline-none"
                      placeholder="0"
                      value={Math.abs(item.amount) || ''}
                      onChange={e => updateItem(item.id, 'amount', e.target.value)}
                    />
                  </div>
                  {items.length > 1 && (
                    <button onClick={() => removeItem(item.id)} className="text-gray-300 hover:text-red-400 text-lg leading-none shrink-0">×</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Reason */}
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Reason for Change (optional)</label>
            <input
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="e.g. Customer requested additional gate during install"
              value={reason}
              onChange={e => setReason(e.target.value)}
            />
          </div>

          {/* Total */}
          <div className={`rounded-xl p-4 flex items-center justify-between ${total >= 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <span className="text-sm font-semibold text-gray-700">Contract Change</span>
            <span className={`text-xl font-bold ${total >= 0 ? 'text-green-700' : 'text-red-600'}`}>
              {total >= 0 ? '+' : ''}{fmt(total)}
            </span>
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Cancel</button>
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!canSave}
              className="bg-gray-900 hover:bg-gray-800 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
            >
              Save as Pending
            </button>
            <button
              onClick={() => {
                if (!canSave) return
                const co: ChangeOrder = {
                  id: uid(),
                  quoteId,
                  orderNumber: existingCount + 1,
                  date: new Date().toISOString().slice(0, 10),
                  items: items.filter(i => i.description.trim()),
                  total,
                  status: 'APPROVED',
                  reason,
                  approvedBy: 'Customer (verbal)',
                }
                onSave(co)
              }}
              disabled={!canSave}
              className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold px-5 py-2 rounded-xl text-sm transition-colors"
            >
              Approve & Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ───────── Change Order List (embedded in QuoteDrawer) ───────── */

export function ChangeOrderPanel({ quoteId, originalPrice }: { quoteId: string; originalPrice: number }) {
  const [orders, setOrders] = useState<ChangeOrder[]>(() => getOrdersForQuote(quoteId))
  const [showModal, setShowModal] = useState(false)

  const approvedTotal = orders.filter(o => o.status === 'APPROVED').reduce((s, o) => s + o.total, 0)
  const currentContractValue = originalPrice + approvedTotal

  function handleSave(co: ChangeOrder) {
    const allOrders = loadChangeOrders()
    const updated = [...allOrders, co]
    saveAll(updated)
    setOrders(getOrdersForQuote(quoteId))
    setShowModal(false)
  }

  function handleStatusChange(coId: string, status: ChangeOrder['status']) {
    const allOrders = loadChangeOrders()
    const updated = allOrders.map(o => o.id === coId ? { ...o, status } : o)
    saveAll(updated)
    setOrders(getOrdersForQuote(quoteId))
  }

  function handleDelete(coId: string) {
    const allOrders = loadChangeOrders()
    const updated = allOrders.filter(o => o.id !== coId)
    saveAll(updated)
    setOrders(getOrdersForQuote(quoteId))
  }

  const STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-yellow-100 text-yellow-700',
    APPROVED: 'bg-green-100 text-green-700',
    VOIDED: 'bg-gray-100 text-gray-500 line-through',
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Change Orders</p>
        <button
          onClick={() => setShowModal(true)}
          className="text-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold px-3 py-1.5 rounded-lg"
        >
          + Change Order
        </button>
      </div>

      {/* Contract value summary */}
      {orders.length > 0 && (
        <div className="bg-gray-900 rounded-xl p-3 mb-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-400 text-xs">Original Contract</span>
            <span className="text-gray-300 text-sm">{fmt(originalPrice)}</span>
          </div>
          {orders.filter(o => o.status === 'APPROVED').length > 0 && (
            <div className="flex items-center justify-between mt-1">
              <span className="text-gray-400 text-xs">Approved Changes</span>
              <span className={`text-sm font-semibold ${approvedTotal >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {approvedTotal >= 0 ? '+' : ''}{fmt(approvedTotal)}
              </span>
            </div>
          )}
          <div className="border-t border-gray-700 mt-2 pt-2 flex items-center justify-between">
            <span className="text-white text-xs font-semibold">Current Contract Value</span>
            <span className="text-orange-400 font-bold text-lg">{fmt(currentContractValue)}</span>
          </div>
        </div>
      )}

      {/* CO list */}
      {orders.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-3">No change orders</p>
      ) : (
        <div className="space-y-2">
          {orders.sort((a, b) => a.orderNumber - b.orderNumber).map(co => (
            <div key={co.id} className="border border-gray-200 rounded-xl p-3 group">
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-700">CO #{co.orderNumber}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${STATUS_COLORS[co.status]}`}>{co.status}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${co.total >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {co.total >= 0 ? '+' : ''}{fmt(co.total)}
                  </span>
                  <button
                    onClick={() => handleDelete(co.id)}
                    className="text-gray-200 hover:text-red-400 text-sm leading-none opacity-0 group-hover:opacity-100"
                  >×</button>
                </div>
              </div>
              <p className="text-xs text-gray-400 mb-1">{co.date}</p>
              {co.items.map(item => (
                <div key={item.id} className="flex items-center justify-between text-xs py-0.5">
                  <span className="text-gray-600">
                    <span className={`font-semibold ${item.type === 'CREDIT' ? 'text-red-500' : 'text-green-600'}`}>
                      {item.type === 'CREDIT' ? '−' : '+'}
                    </span>{' '}
                    {item.description}
                  </span>
                  <span className="text-gray-500">{fmt(Math.abs(item.amount))}</span>
                </div>
              ))}
              {co.reason && <p className="text-xs text-gray-400 mt-1 italic">{co.reason}</p>}

              {/* Status controls */}
              {co.status === 'PENDING' && (
                <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => handleStatusChange(co.id, 'APPROVED')}
                    className="text-xs bg-green-500 hover:bg-green-600 text-white font-semibold px-3 py-1 rounded-lg"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => handleStatusChange(co.id, 'VOIDED')}
                    className="text-xs border border-gray-300 text-gray-500 hover:text-gray-700 font-semibold px-3 py-1 rounded-lg"
                  >
                    Void
                  </button>
                </div>
              )}
              {co.status === 'APPROVED' && (
                <div className="flex gap-2 mt-2 pt-2 border-t border-gray-100">
                  <button
                    onClick={() => handleStatusChange(co.id, 'VOIDED')}
                    className="text-xs border border-gray-300 text-gray-500 hover:text-gray-700 font-semibold px-3 py-1 rounded-lg"
                  >
                    Void
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <QuickChangeOrderModal
          quoteId={quoteId}
          customerName=""
          existingCount={orders.length}
          onSave={handleSave}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
