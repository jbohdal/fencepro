import { useState, useEffect, useMemo } from 'react'
import {
  getInventory, saveInventory, resetInventory,
  getBundles, saveBundles,
  getLocations, saveLocations,
  getStockLevels, saveStockLevels,
  getTransactions,
  stockIn, stockOut,
  getLowStockItems,
  getInventorySummary,
  reverseTransaction,
  findItemByBarcode,
} from './inventoryStore'
import BulkImportModal from './BulkImportModal'
import type {
  InventoryItem, Bundle, BundleItem,
  InventoryLocation, StockLevel,
  InventoryTransaction, TransactionType,
} from './inventoryStore'

const uid = () => Math.random().toString(36).slice(2, 10)

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n)

const CATEGORIES = [
  'Tear Out', 'Vinyl White', 'Vinyl Tan',
  'Chainlink Galv', 'Chainlink Black', 'Chainlink Green',
  'Commercial', 'Agricultural', 'Aluminum', 'Misc',
]

const TXN_TYPE_LABELS: Record<TransactionType, string> = {
  stock_in: 'Stock In',
  stock_out: 'Stock Out',
  adjustment: 'Adjustment',
  transfer: 'Transfer',
  pull_sheet: 'Pull Sheet',
}

const TXN_TYPE_COLORS: Record<TransactionType, string> = {
  stock_in: 'bg-green-100 text-green-700',
  stock_out: 'bg-red-100 text-red-700',
  adjustment: 'bg-blue-100 text-blue-700',
  transfer: 'bg-purple-100 text-purple-700',
  pull_sheet: 'bg-orange-100 text-orange-700',
}

/* ═══════════════════════════════════════════════
   TAB: DASHBOARD
   ═══════════════════════════════════════════════ */

function DashboardTab() {
  const summary = useMemo(() => getInventorySummary(), [])
  const lowStock = useMemo(() => getLowStockItems(), [])
  const txns = useMemo(() => getTransactions().slice(0, 10), [])
  const locations = useMemo(() => getLocations(), [])
  const items = useMemo(() => getInventory(), [])

  const getName = (id: string) => items.find(i => i.id === id)?.name ?? id
  const getLocName = (id: string) => locations.find(l => l.id === id)?.name ?? id

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: 'Total Items', value: String(summary.totalItems), sub: `${Object.keys(summary.categoryCounts).length} categories`, color: 'text-blue-600' },
          { label: 'Total Stock Value', value: fmt(summary.totalValue), sub: 'based on unit cost × qty', color: 'text-green-600' },
          { label: 'Low Stock', value: String(summary.lowStockCount), sub: 'at or below reorder point', color: summary.lowStockCount > 0 ? 'text-red-500' : 'text-green-600' },
          { label: 'Out of Stock', value: String(summary.outOfStockCount), sub: 'zero quantity on hand', color: summary.outOfStockCount > 0 ? 'text-red-500' : 'text-green-600' },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-2xl border border-gray-200 p-5">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">{kpi.label}</p>
            <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
            <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Low stock alerts */}
        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Low Stock Alerts</h3>
          </div>
          {lowStock.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">No items below reorder point</div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
              {lowStock.map(ls => (
                <div key={`${ls.itemId}-${ls.locationId}`} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{getName(ls.itemId)}</p>
                    <p className="text-xs text-gray-400">{getLocName(ls.locationId)}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-sm font-bold ${ls.quantity === 0 ? 'text-red-500' : 'text-yellow-600'}`}>{ls.quantity}</p>
                    <p className="text-xs text-gray-400">reorder at {ls.reorderPoint}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent transactions */}
        <div className="bg-white rounded-2xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="font-semibold text-gray-900">Recent Transactions</h3>
          </div>
          {txns.length === 0 ? (
            <div className="px-6 py-8 text-center text-gray-400 text-sm">No transactions yet</div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
              {txns.map(t => (
                <div key={t.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{t.itemName}</p>
                    <p className="text-xs text-gray-400">{new Date(t.createdAt).toLocaleDateString()} · {getLocName(t.locationId)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${t.quantityDelta > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {t.quantityDelta > 0 ? '+' : ''}{t.quantityDelta}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${TXN_TYPE_COLORS[t.type]}`}>
                      {TXN_TYPE_LABELS[t.type]}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Items by Category</h3>
        <div className="grid grid-cols-5 gap-3">
          {Object.entries(summary.categoryCounts).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
            <div key={cat} className="bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-lg font-bold text-gray-900">{count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{cat}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   TAB: CATALOG (item list with stock columns)
   ═══════════════════════════════════════════════ */

function CatalogTab() {
  const [items, setItems]                   = useState<InventoryItem[]>([])
  const [levels, setLevels]                 = useState<StockLevel[]>([])
  const [search, setSearch]                 = useState('')
  const [category, setCategory]             = useState('All')
  const [saved, setSaved]                   = useState(false)
  const [editingId, setEditingId]           = useState<string | null>(null)
  const [thresholdExpandId, setThresholdExpandId] = useState<string | null>(null)
  const [barcodesEditId, setBarcodesEditId] = useState<string | null>(null)
  const [barcodesInput, setBarcodesInput]   = useState('')
  const [showBulkImport, setShowBulkImport] = useState(false)
  const locations = useMemo(() => getLocations(), [])

  useEffect(() => { setItems(getInventory()); setLevels(getStockLevels()) }, [])

  const filtered = items.filter(i => {
    const matchCat  = category === 'All' || i.category === category
    const matchText = i.name.toLowerCase().includes(search.toLowerCase())
    return matchCat && matchText
  })

  function getQty(itemId: string): number {
    return levels.filter(s => s.itemId === itemId).reduce((sum, s) => sum + s.quantity, 0)
  }

  function getLocReorder(itemId: string, locationId: string): number {
    return levels.find(s => s.itemId === itemId && s.locationId === locationId)?.reorderPoint ?? 0
  }

  function countThresholdsSet(itemId: string): number {
    return levels.filter(s => s.itemId === itemId && s.reorderPoint > 0).length
  }

  function updateItem(id: string, field: string, val: string | number) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: val } : i))
  }

  function updateReorderPoint(itemId: string, locationId: string, val: number) {
    setLevels(prev => {
      const idx = prev.findIndex(s => s.itemId === itemId && s.locationId === locationId)
      if (idx >= 0) {
        const updated = [...prev]
        updated[idx] = { ...updated[idx], reorderPoint: val }
        return updated
      }
      return [...prev, { itemId, locationId, quantity: 0, minQuantity: 0, maxQuantity: 0, reorderPoint: val, reorderQty: 0, lastUpdated: new Date().toISOString() }]
    })
  }

  function openBarcodesEdit(item: InventoryItem) {
    setBarcodesEditId(item.id)
    setBarcodesInput((item.barcodes ?? []).join(', '))
  }

  function commitBarcodes(itemId: string) {
    const parsed = barcodesInput.split(',').map(s => s.trim()).filter(Boolean)
    setItems(prev => prev.map(i => i.id === itemId ? { ...i, barcodes: parsed } : i))
    setBarcodesEditId(null)
    setBarcodesInput('')
  }

  function addItem() {
    const newItem: InventoryItem = {
      id: uid(), name: 'New Item', unitCost: 0,
      category: category === 'All' ? 'Vinyl White' : category,
      status: 'active',
    }
    setItems(prev => [...prev, newItem])
    setEditingId(newItem.id)
  }

  function deleteItem(id: string) {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  function handleSave() {
    saveInventory(items)
    saveStockLevels(levels)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function handleReset() {
    if (confirm('Reset all inventory to factory defaults? This cannot be undone.')) {
      resetInventory()
      setItems(getInventory())
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Item Catalog</h2>
          <p className="text-sm text-gray-400 mt-0.5">{items.length} items · click name to edit · changes apply to future quotes</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleReset} className="text-xs text-gray-400 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">Reset defaults</button>
          <button onClick={() => setShowBulkImport(true)} className="text-sm text-blue-600 border border-blue-300 rounded-lg px-3 py-2 hover:bg-blue-50">📥 Bulk Import</button>
          <button onClick={addItem} className="text-sm text-orange-500 border border-orange-300 rounded-lg px-3 py-2 hover:bg-orange-50">+ Add item</button>
          <button onClick={handleSave} className={`text-sm font-semibold px-4 py-2 rounded-lg transition-colors ${saved ? 'bg-green-500 text-white' : 'bg-orange-500 hover:bg-orange-600 text-white'}`}>
            {saved ? '✓ Saved' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="flex gap-3 mb-4">
        <input
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          placeholder="Search items..." value={search} onChange={e => setSearch(e.target.value)}
        />
        <select
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          value={category} onChange={e => setCategory(e.target.value)}
        >
          <option value="All">All Categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Item Name</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-32">Category</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Unit Cost</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-20">On Hand</th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Thresholds</th>
              <th className="text-center px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Barcodes</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map(item => {
              const qty = getQty(item.id)
              const hasStock = levels.some(s => s.itemId === item.id)
              const thresholdCount = countThresholdsSet(item.id)
              const barcodeCount = (item.barcodes ?? []).length
              const isThresholdExpanded = thresholdExpandId === item.id
              const isBarcodesEditing = barcodesEditId === item.id

              return (
                <>
                  <tr key={item.id} className="hover:bg-gray-50 group">
                    <td className="px-4 py-2.5">
                      {editingId === item.id ? (
                        <input autoFocus className="w-full border border-orange-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                          value={item.name} onChange={e => updateItem(item.id, 'name', e.target.value)} onBlur={() => setEditingId(null)} />
                      ) : (
                        <span className="cursor-pointer hover:text-orange-600" onClick={() => setEditingId(item.id)}>{item.name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-gray-500 text-xs">{item.category}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end">
                        <span className="text-gray-400 mr-1 text-xs">$</span>
                        <input type="number" step="0.01" min="0"
                          className="w-20 text-right border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400 font-mono"
                          value={item.unitCost} onChange={e => updateItem(item.id, 'unitCost', parseFloat(e.target.value) || 0)} />
                      </div>
                    </td>
                    <td className={`px-3 py-2.5 text-right font-bold text-xs ${qty < 0 ? 'text-red-500' : qty === 0 && hasStock ? 'text-gray-400' : 'text-gray-700'}`}>
                      {hasStock ? qty : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <button
                        onClick={() => setThresholdExpandId(isThresholdExpanded ? null : item.id)}
                        className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${isThresholdExpanded ? 'bg-orange-100 border-orange-300 text-orange-700' : thresholdCount > 0 ? 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-orange-50 hover:border-orange-200' : 'border-dashed border-gray-200 text-gray-400 hover:border-orange-300 hover:text-orange-500'}`}
                      >
                        {thresholdCount > 0 ? `${thresholdCount} set` : '+ Set'}
                      </button>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      {isBarcodesEditing ? (
                        <input
                          autoFocus
                          className="w-full border border-orange-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                          placeholder="123,456,789"
                          value={barcodesInput}
                          onChange={e => setBarcodesInput(e.target.value)}
                          onBlur={() => commitBarcodes(item.id)}
                          onKeyDown={e => e.key === 'Enter' && commitBarcodes(item.id)}
                        />
                      ) : (
                        <button
                          onClick={() => openBarcodesEdit(item)}
                          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${barcodeCount > 0 ? 'bg-gray-100 border-gray-200 text-gray-600 hover:bg-orange-50 hover:border-orange-200' : 'border-dashed border-gray-200 text-gray-400 hover:border-orange-300 hover:text-orange-500'}`}
                        >
                          {barcodeCount > 0 ? `${barcodeCount} barcode${barcodeCount > 1 ? 's' : ''}` : '+ Add'}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      <button onClick={() => deleteItem(item.id)} className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 text-lg leading-none">×</button>
                    </td>
                  </tr>
                  {isThresholdExpanded && (
                    <tr key={`${item.id}-thresholds`} className="bg-orange-50">
                      <td colSpan={7} className="px-6 py-3">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-semibold text-orange-700 uppercase tracking-wide">Per-Location Reorder Points</span>
                          <span className="text-xs text-gray-400">— alert triggers when a location's qty drops to or below its threshold</span>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          {locations.filter(l => l.isActive).map(loc => (
                            <div key={loc.id} className="flex items-center gap-2 bg-white border border-orange-200 rounded-lg px-3 py-2">
                              <span className="text-xs font-medium text-gray-700 min-w-[80px]">{loc.name}</span>
                              <span className="text-xs text-gray-400">reorder at</span>
                              <input
                                type="number" min="0" step="1"
                                className="w-16 text-right border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400 font-mono"
                                value={getLocReorder(item.id, loc.id) || ''}
                                placeholder="0"
                                onChange={e => updateReorderPoint(item.id, loc.id, parseInt(e.target.value) || 0)}
                              />
                              <span className="text-xs text-gray-400">{loc.type}</span>
                            </div>
                          ))}
                          {locations.filter(l => l.isActive).length === 0 && (
                            <p className="text-xs text-gray-400">No active locations — add one in the Locations tab first.</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-center py-12 text-gray-400 text-sm">No items match your search</div>}
      </div>
      <p className="text-xs text-gray-400 mt-2">{filtered.length} of {items.length} items · barcodes: comma-separate multiple values, press Enter to save</p>
      {showBulkImport && (
        <BulkImportModal
          onClose={() => setShowBulkImport(false)}
          onComplete={() => { setItems(getInventory()); setLevels(getStockLevels()) }}
        />
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   TAB: STOCK MOVEMENT (batch stock in/out)
   ═══════════════════════════════════════════════ */

function StockMovementTab() {
  const [items] = useState<InventoryItem[]>(() => getInventory())
  const [locations] = useState<InventoryLocation[]>(() => getLocations())
  const [mode, setMode] = useState<'in' | 'out'>('in')
  const [locationId, setLocationId] = useState(locations[0]?.id || '')
  const [search, setSearch] = useState('')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeMsg, setBarcodeMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [lines, setLines] = useState<{ itemId: string; itemName: string; qty: number; note: string }[]>([])
  const [processed, setProcessed] = useState(false)

  const searchResults = search.length > 1
    ? items.filter(i => i.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : []

  function addLine(item: InventoryItem) {
    if (lines.find(l => l.itemId === item.id)) {
      setLines(prev => prev.map(l => l.itemId === item.id ? { ...l, qty: l.qty + 1 } : l))
      return
    }
    setLines(prev => [...prev, { itemId: item.id, itemName: item.name, qty: 1, note: '' }])
    setSearch('')
  }

  function handleBarcodeScan(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return
    const code = barcodeInput.trim()
    if (!code) return
    const item = findItemByBarcode(code, items)
    if (!item) {
      setBarcodeMsg({ ok: false, text: `No item found for barcode "${code}"` })
      setBarcodeInput('')
      setTimeout(() => setBarcodeMsg(null), 3000)
      return
    }
    addLine(item)
    setBarcodeInput('')
    setBarcodeMsg({ ok: true, text: `Added: ${item.name}` })
    setTimeout(() => setBarcodeMsg(null), 2000)
  }

  function updateLine(itemId: string, field: string, val: string | number) {
    setLines(prev => prev.map(l => l.itemId === itemId ? { ...l, [field]: val } : l))
  }

  function removeLine(itemId: string) {
    setLines(prev => prev.filter(l => l.itemId !== itemId))
  }

  function processAll() {
    if (!locationId || lines.length === 0) return
    for (const line of lines) {
      if (line.qty <= 0) continue
      if (mode === 'in') {
        const item = items.find(i => i.id === line.itemId)
        stockIn(line.itemId, locationId, line.qty, { notes: line.note, unitCost: item?.unitCost })
      } else {
        stockOut(line.itemId, locationId, line.qty, { notes: line.note })
      }
    }
    setLines([])
    setProcessed(true)
    setTimeout(() => setProcessed(false), 3000)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Stock Movement</h2>
          <p className="text-sm text-gray-400 mt-0.5">Batch stock in or out. Add multiple items, then process all at once.</p>
        </div>
        {processed && <span className="text-green-600 font-semibold text-sm">✓ Processed successfully</span>}
      </div>

      {/* Controls */}
      <div className="flex gap-4">
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          {(['in', 'out'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className={`px-5 py-2 rounded-md text-sm font-medium transition-colors ${mode === m
                ? m === 'in' ? 'bg-green-500 text-white shadow' : 'bg-red-500 text-white shadow'
                : 'text-gray-500 hover:text-gray-700'}`}
            >
              Stock {m === 'in' ? 'In' : 'Out'}
            </button>
          ))}
        </div>
        <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={locationId} onChange={e => setLocationId(e.target.value)}>
          {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </div>

      {/* Barcode scanner + search */}
      <div className="grid grid-cols-2 gap-3">
        {/* Barcode scanner */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5">
            <span>📷</span> Scan Barcode
          </label>
          <input
            className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 font-mono"
            placeholder="Scan or type a barcode, press Enter..."
            value={barcodeInput}
            onChange={e => setBarcodeInput(e.target.value)}
            onKeyDown={handleBarcodeScan}
          />
          {barcodeMsg && (
            <p className={`text-xs font-medium ${barcodeMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
              {barcodeMsg.ok ? '✓' : '✗'} {barcodeMsg.text}
            </p>
          )}
        </div>

        {/* Text search */}
        <div className="space-y-1">
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Search by Name</label>
          <div className="relative">
            <input className="w-full border border-gray-300 rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="Search items to add to batch..." value={search} onChange={e => setSearch(e.target.value)} />
            {searchResults.length > 0 && (
              <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg mt-1 shadow-lg max-h-56 overflow-y-auto">
                {searchResults.map(item => (
                  <button key={item.id} onClick={() => addLine(item)}
                    className="w-full text-left px-4 py-2.5 text-sm hover:bg-orange-50 flex justify-between items-center">
                    <span className="text-gray-800">{item.name}</span>
                    <span className="text-gray-400 text-xs">{item.category} · {fmt(item.unitCost)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Batch lines */}
      {lines.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Item</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Qty</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-48">Note</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {lines.map(line => (
                <tr key={line.itemId} className="group">
                  <td className="px-4 py-2.5 font-medium text-gray-900">{line.itemName}</td>
                  <td className="px-3 py-2.5 text-right">
                    <input type="number" min={1} step={1}
                      className="w-20 text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
                      value={line.qty} onChange={e => updateLine(line.itemId, 'qty', parseInt(e.target.value) || 0)} />
                  </td>
                  <td className="px-3 py-2.5">
                    <input className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400"
                      placeholder="Optional note..." value={line.note} onChange={e => updateLine(line.itemId, 'note', e.target.value)} />
                  </td>
                  <td className="px-2 py-2.5">
                    <button onClick={() => removeLine(line.itemId)} className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 text-lg leading-none">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-t border-gray-200">
            <span className="text-sm text-gray-500">{lines.length} items · {lines.reduce((s, l) => s + l.qty, 0)} total units</span>
            <button onClick={processAll}
              className={`font-semibold text-sm px-6 py-2 rounded-xl text-white transition-colors ${mode === 'in' ? 'bg-green-500 hover:bg-green-600' : 'bg-red-500 hover:bg-red-600'}`}>
              Process {mode === 'in' ? 'Stock In' : 'Stock Out'}
            </button>
          </div>
        </div>
      )}

      {lines.length === 0 && !processed && (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-2xl text-gray-400 text-sm">
          Search for items above to build a batch
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   TAB: TRANSACTION HISTORY
   ═══════════════════════════════════════════════ */

function TransactionsTab() {
  const [txns, setTxns] = useState<InventoryTransaction[]>(() => getTransactions())
  const [typeFilter, setTypeFilter] = useState<string>('All')
  const [search, setSearch] = useState('')
  const locations = useMemo(() => getLocations(), [])
  const getLocName = (id: string) => locations.find(l => l.id === id)?.name ?? id

  const filtered = txns.filter(t => {
    if (typeFilter !== 'All' && t.type !== typeFilter) return false
    if (search && !t.itemName.toLowerCase().includes(search.toLowerCase()) && !t.notes.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  function handleReverse(txnId: string) {
    const note = prompt('Reason for reversal:')
    if (note === null) return
    reverseTransaction(txnId, note || 'Reversed')
    setTxns(getTransactions())
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Transaction History</h2>
          <p className="text-sm text-gray-400 mt-0.5">Immutable log of all stock movements</p>
        </div>
        <span className="text-xs text-gray-400">{filtered.length} transactions</span>
      </div>

      <div className="flex gap-3">
        <input className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          placeholder="Search items or notes..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="All">All Types</option>
          {Object.entries(TXN_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase">Item</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Type</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-24">Location</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-16">Delta</th>
              <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-16">After</th>
              <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase">Notes</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr><td colSpan={8} className="px-6 py-12 text-center text-gray-400">No transactions</td></tr>
            ) : filtered.slice(0, 200).map(t => (
              <tr key={t.id} className={`hover:bg-gray-50 group ${t.reversedBy ? 'opacity-40 line-through' : ''}`}>
                <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{new Date(t.createdAt).toLocaleString()}</td>
                <td className="px-3 py-2.5 font-medium text-gray-900 text-xs">{t.itemName}</td>
                <td className="px-3 py-2.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${TXN_TYPE_COLORS[t.type]}`}>{TXN_TYPE_LABELS[t.type]}</span>
                </td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{getLocName(t.locationId)}</td>
                <td className={`px-3 py-2.5 text-right font-bold text-xs ${t.quantityDelta > 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {t.quantityDelta > 0 ? '+' : ''}{t.quantityDelta}
                </td>
                <td className="px-3 py-2.5 text-right text-xs text-gray-600">{t.quantityAfter}</td>
                <td className="px-3 py-2.5 text-xs text-gray-500 truncate max-w-[200px]">{t.notes}</td>
                <td className="px-2 py-2.5">
                  {!t.reversedBy && !t.isReversalOf && (
                    <button onClick={() => handleReverse(t.id)}
                      className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs" title="Reverse">↩</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   TAB: LOCATIONS
   ═══════════════════════════════════════════════ */

function LocationsTab() {
  const [locations, setLocations] = useState<InventoryLocation[]>(() => getLocations())
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<InventoryLocation['type']>('yard')

  function addLocation() {
    if (!newName.trim()) return
    const loc: InventoryLocation = { id: uid(), name: newName.trim(), type: newType, isActive: true }
    const updated = [...locations, loc]
    setLocations(updated)
    saveLocations(updated)
    setNewName('')
  }

  function toggleActive(id: string) {
    const updated = locations.map(l => l.id === id ? { ...l, isActive: !l.isActive } : l)
    setLocations(updated)
    saveLocations(updated)
  }

  function removeLocation(id: string) {
    if (!confirm('Remove this location?')) return
    const updated = locations.filter(l => l.id !== id)
    setLocations(updated)
    saveLocations(updated)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Locations</h2>
        <p className="text-sm text-gray-400 mt-0.5">Manage where your materials are stored. Stock is tracked per location.</p>
      </div>

      <div className="flex gap-3">
        <input className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          placeholder="New location name..." value={newName} onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addLocation()} />
        <select className="border border-gray-300 rounded-lg px-3 py-2 text-sm" value={newType} onChange={e => setNewType(e.target.value as InventoryLocation['type'])}>
          <option value="yard">Yard</option>
          <option value="warehouse">Warehouse</option>
          <option value="truck">Truck</option>
          <option value="virtual">Virtual</option>
        </select>
        <button onClick={addLocation} disabled={!newName.trim()}
          className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm px-4 py-2 rounded-lg">
          + Add
        </button>
      </div>

      <div className="space-y-3">
        {locations.map(loc => (
          <div key={loc.id} className={`border rounded-xl p-4 flex items-center justify-between ${loc.isActive ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-900">{loc.name}</p>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full capitalize">{loc.type}</span>
              </div>
              {loc.address && <p className="text-xs text-gray-400 mt-0.5">{loc.address}</p>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => toggleActive(loc.id)}
                className={`text-xs px-3 py-1 rounded-lg border font-medium ${loc.isActive ? 'border-green-300 text-green-700 bg-green-50' : 'border-gray-200 text-gray-500'}`}>
                {loc.isActive ? 'Active' : 'Inactive'}
              </button>
              <button onClick={() => removeLocation(loc.id)} className="text-gray-300 hover:text-red-400 text-lg leading-none">×</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   TAB: BUNDLES (preserved from original)
   ═══════════════════════════════════════════════ */

function BundleEditor({
  bundle, inventory, onSave, onCancel
}: {
  bundle: Bundle; inventory: InventoryItem[]; onSave: (b: Bundle) => void; onCancel: () => void
}) {
  const [name, setName]               = useState(bundle.name)
  const [description, setDescription] = useState(bundle.description)
  const [bundleItems, setBundleItems] = useState<BundleItem[]>(bundle.items)
  const [itemSearch, setItemSearch]   = useState('')

  const filtered = inventory.filter(i => i.name.toLowerCase().includes(itemSearch.toLowerCase()))

  function addBundleItem(inv: InventoryItem) {
    if (bundleItems.find(bi => bi.inventoryId === inv.id)) return
    setBundleItems(prev => [...prev, { inventoryId: inv.id, qty: 1, scaleWithSections: false }])
    setItemSearch('')
  }

  function getName(id: string) { return inventory.find(i => i.id === id)?.name ?? id }
  function getCost(id: string) { return inventory.find(i => i.id === id)?.unitCost ?? 0 }
  const totalCost = bundleItems.reduce((sum, bi) => sum + bi.qty * getCost(bi.inventoryId), 0)

  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-900">{bundle.id ? 'Edit Bundle' : 'New Bundle'}</h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Bundle Name</label>
          <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Description</label>
          <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={description} onChange={e => setDescription(e.target.value)} />
        </div>
      </div>
      <div className="relative">
        <input className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          placeholder="Search inventory to add..." value={itemSearch} onChange={e => setItemSearch(e.target.value)} />
        {itemSearch && (
          <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg mt-1 shadow-lg max-h-48 overflow-y-auto">
            {filtered.slice(0, 12).map(inv => (
              <button key={inv.id} onClick={() => addBundleItem(inv)} className="w-full text-left px-3 py-2 text-sm hover:bg-orange-50 flex justify-between">
                <span className="truncate">{inv.name}</span>
                <span className="text-gray-400 text-xs ml-2">{fmt(inv.unitCost)}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {bundleItems.length > 0 && (
        <div className="border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Item</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase w-24">Qty</th>
                <th className="text-center px-3 py-2 text-xs font-semibold text-gray-500 uppercase w-28">Scale</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-500 uppercase w-24">Subtotal</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {bundleItems.map(bi => (
                <tr key={bi.inventoryId} className="group">
                  <td className="px-3 py-2 text-xs">{getName(bi.inventoryId)}</td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min={0} step={0.5} className="w-20 text-right border border-gray-200 rounded px-2 py-1 text-xs"
                      value={bi.qty} onChange={e => setBundleItems(prev => prev.map(b => b.inventoryId === bi.inventoryId ? { ...b, qty: parseFloat(e.target.value) || 0 } : b))} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button onClick={() => setBundleItems(prev => prev.map(b => b.inventoryId === bi.inventoryId ? { ...b, scaleWithSections: !b.scaleWithSections } : b))}
                      className={`text-xs px-2 py-0.5 rounded-full border ${bi.scaleWithSections ? 'bg-orange-100 border-orange-300 text-orange-700' : 'bg-gray-100 border-gray-200 text-gray-400'}`}>
                      {bi.scaleWithSections ? '× sections' : 'fixed'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{fmt(bi.qty * getCost(bi.inventoryId))}</td>
                  <td className="px-2 py-2">
                    <button onClick={() => setBundleItems(prev => prev.filter(b => b.inventoryId !== bi.inventoryId))}
                      className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 text-lg leading-none">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bg-gray-50 px-3 py-2 flex justify-between border-t border-gray-200">
            <span className="text-xs text-gray-500">{bundleItems.length} items</span>
            <span className="text-sm font-bold">{fmt(totalCost)}</span>
          </div>
        </div>
      )}
      <div className="flex gap-2 pt-2">
        <button onClick={onCancel} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-xl text-sm hover:bg-gray-50">Cancel</button>
        <button disabled={!name} onClick={() => onSave({ ...bundle, name, description, items: bundleItems })}
          className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-semibold py-2 rounded-xl text-sm">Save Bundle</button>
      </div>
    </div>
  )
}

function BundlesTab() {
  const [bundles, setBundles]     = useState<Bundle[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [editing, setEditing]     = useState<Bundle | null>(null)

  useEffect(() => { setBundles(getBundles()); setInventory(getInventory()) }, [])

  function handleSave(b: Bundle) {
    const updated = b.id ? bundles.map(x => x.id === b.id ? b : x) : [...bundles, { ...b, id: uid() }]
    setBundles(updated); saveBundles(updated); setEditing(null)
  }

  function deleteBundle(id: string) {
    if (!confirm('Delete this bundle?')) return
    const updated = bundles.filter(b => b.id !== id)
    setBundles(updated); saveBundles(updated)
  }

  function getName(id: string) { return inventory.find(i => i.id === id)?.name ?? id }
  function getCost(id: string) { return inventory.find(i => i.id === id)?.unitCost ?? 0 }

  if (editing) return <BundleEditor bundle={editing} inventory={inventory} onSave={handleSave} onCancel={() => setEditing(null)} />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Bundles</h2>
          <p className="text-sm text-gray-400 mt-0.5">Preset collections of inventory items for quotes.</p>
        </div>
        <button onClick={() => setEditing({ id: '', name: '', description: '', items: [] })}
          className="bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm px-4 py-2 rounded-lg">+ New Bundle</button>
      </div>
      {bundles.length === 0 ? (
        <div className="text-center py-24 border border-dashed border-gray-200 rounded-2xl">
          <p className="text-gray-400 text-sm mb-4">No bundles yet</p>
          <button onClick={() => setEditing({ id: '', name: '', description: '', items: [] })} className="text-orange-500 hover:underline text-sm">Create your first bundle</button>
        </div>
      ) : (
        <div className="space-y-3">
          {bundles.map(b => {
            const totalCost = b.items.reduce((sum, bi) => sum + bi.qty * getCost(bi.inventoryId), 0)
            return (
              <div key={b.id} className="border border-gray-200 rounded-2xl p-5 hover:border-orange-200 transition-colors">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900">{b.name}</h3>
                    {b.description && <p className="text-sm text-gray-400 mt-0.5">{b.description}</p>}
                    <div className="flex gap-3 mt-2">
                      <span className="text-xs text-gray-400">{b.items.length} items</span>
                      <span className="text-xs font-semibold text-gray-700">{fmt(totalCost)} base cost</span>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button onClick={() => setEditing(b)} className="text-sm text-gray-500 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50">Edit</button>
                    <button onClick={() => deleteBundle(b.id)} className="text-sm text-red-400 border border-red-100 rounded-lg px-3 py-1.5 hover:bg-red-50">Delete</button>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-1">
                  {b.items.slice(0, 6).map(bi => (
                    <div key={bi.inventoryId} className="flex justify-between text-xs text-gray-500">
                      <span className="truncate pr-2">{getName(bi.inventoryId)}</span>
                      <span className="whitespace-nowrap">{bi.scaleWithSections ? `${bi.qty}×/sec` : `×${bi.qty}`}</span>
                    </div>
                  ))}
                  {b.items.length > 6 && <div className="text-xs text-gray-400 col-span-2">+{b.items.length - 6} more</div>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   MAIN PAGE
   ═══════════════════════════════════════════════ */

type InvTab = 'dashboard' | 'catalog' | 'stock' | 'transactions' | 'locations' | 'bundles'

const TAB_LABELS: { key: InvTab; label: string; icon: string }[] = [
  { key: 'dashboard', label: 'Dashboard', icon: '📊' },
  { key: 'catalog', label: 'Catalog', icon: '📦' },
  { key: 'stock', label: 'Stock In/Out', icon: '↕️' },
  { key: 'transactions', label: 'History', icon: '📜' },
  { key: 'locations', label: 'Locations', icon: '📍' },
  { key: 'bundles', label: 'Bundles', icon: '🔗' },
]

export default function AdminPage() {
  const [tab, setTab] = useState<InvTab>('dashboard')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-8 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Inventory Management</h1>
          <p className="text-gray-400 mt-1">Track materials, manage stock levels, and monitor consumption.</p>
        </div>

        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-8">
          {TAB_LABELS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
                tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}>
              <span>{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'dashboard'    && <DashboardTab />}
        {tab === 'catalog'      && <CatalogTab />}
        {tab === 'stock'        && <StockMovementTab />}
        {tab === 'transactions' && <TransactionsTab />}
        {tab === 'locations'    && <LocationsTab />}
        {tab === 'bundles'      && <BundlesTab />}
      </div>
    </div>
  )
}
