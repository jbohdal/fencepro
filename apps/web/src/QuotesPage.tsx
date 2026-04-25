import { useState, useMemo, useEffect } from 'react'
import type { LineItem } from './materialCalculator'
import { ChangeOrderPanel } from './ChangeOrders'
import { POButton } from './PurchaseOrder'
import { pullFromInventory, getLocations } from './inventoryStore'
import { createJobFromQuote, getJobByQuoteId } from './jobStore'
import QuoteDetailDrawer from './QuoteDetailDrawer'

export interface SavedQuote {
  id: string
  customerName: string
  customerPhone: string
  customerEmail: string
  customerAddress: string
  leadSource: string
  salesRep: string
  customerId?: string
  fenceStyle: string
  runs: number[]
  corners: number
  ends: number
  walkGates: number
  dblGates: number
  tearOutSections: number
  tearOutGates: number
  adjLaborHrs: number
  hasSalesman: boolean
  priceAdjust: number
  sections: number
  materialCost: number
  laborCost: number
  tearOutCost: number
  totalCOGS: number
  finalPrice: number
  gmPct: number
  pullSheet: LineItem[]
  status: 'DRAFT' | 'SENT' | 'SOLD' | 'LOST'
  date: string
  notes: string
  leadTemp: number
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT:  'bg-blue-100 text-blue-700',
  SOLD:  'bg-green-100 text-green-700',
  LOST:  'bg-red-100 text-red-700',
}

const STATUS_OPTIONS = ['DRAFT', 'SENT', 'SOLD', 'LOST']
const FENCE_CATEGORIES = ['All', 'Vinyl', 'Chainlink', 'Aluminum', 'Commercial', 'Other']
const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function marginColor(pct: number) {
  if (pct >= 0.34) return 'text-green-600'
  if (pct >= 0.27) return 'text-yellow-600'
  return 'text-red-500'
}

function fenceCategory(style: string): string {
  if (style.toLowerCase().includes('vinyl') || style.startsWith('WV') || style.startsWith('TV')) return 'Vinyl'
  if (style.toLowerCase().includes('alum')) return 'Aluminum'
  if (style.toLowerCase().includes('com')) return 'Commercial'
  if (style.startsWith('CL')) return 'Chainlink'
  return 'Other'
}

function FlameRating({
  value, onChange, readonly = false,
}: {
  value: number
  onChange?: (v: number) => void
  readonly?: boolean
}) {
  const [hover, setHover] = useState(0)
  const display = hover || value
  const colors = ['text-blue-400','text-cyan-400','text-yellow-400','text-orange-500','text-red-500']
  const labels = ['Cold', 'Cool', 'Warm', 'Hot', 'On Fire']
  return (
    <div className="flex items-center gap-0.5">
      {[1,2,3,4,5].map(i => (
        <button
          key={i}
          disabled={readonly}
          onClick={e => { e.stopPropagation(); onChange?.(i) }}
          onMouseEnter={() => !readonly && setHover(i)}
          onMouseLeave={() => setHover(0)}
          className={`text-lg leading-none transition-all ${i <= display ? colors[i - 1] : 'text-gray-200'} ${readonly ? 'cursor-default' : 'hover:scale-125 cursor-pointer'}`}
          title={labels[i - 1]}
        >🔥</button>
      ))}
      {!readonly && hover > 0 && <span className="text-xs text-gray-400 ml-1">{labels[hover - 1]}</span>}
    </div>
  )
}

function MiniBarChart({ opp, closed, labels }: { opp: number[], closed: number[], labels: string[] }) {
  const W = 600, H = 140
  const PAD = { top: 12, right: 8, bottom: 28, left: 32 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom
  const maxVal = Math.max(...opp, ...closed, 1)
  const groupW = chartW / labels.length
  const barW = groupW * 0.35
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
      {[0, 0.5, 1].map(f => {
        const y = PAD.top + chartH - f * chartH
        return (
          <g key={f}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#f3f4f6" strokeWidth={1} />
            <text x={PAD.left - 4} y={y + 4} textAnchor="end" fontSize={9} fill="#9ca3af">{Math.round(maxVal * f)}</text>
          </g>
        )
      })}
      {labels.map((label, gi) => {
        const gx = PAD.left + gi * groupW
        const oppH = Math.max((opp[gi] / maxVal) * chartH, opp[gi] > 0 ? 2 : 0)
        const clH  = Math.max((closed[gi] / maxVal) * chartH, closed[gi] > 0 ? 2 : 0)
        return (
          <g key={label}>
            <rect x={gx + groupW * 0.1} y={PAD.top + chartH - oppH} width={barW} height={oppH} fill="rgba(209,213,219,0.9)" rx={2} />
            <rect x={gx + groupW * 0.1 + barW + 2} y={PAD.top + chartH - clH} width={barW} height={clH} fill="rgba(249,115,22,0.85)" rx={2} />
            <text x={gx + groupW / 2} y={H - 6} textAnchor="middle" fontSize={9} fill="#9ca3af">{label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function PipelineAnalytics({ quotes }: { quotes: SavedQuote[] }) {
  const year = new Date().getFullYear()

  const monthlyData = useMemo(() => {
    const opp = Array(12).fill(0)
    const closed = Array(12).fill(0)
    quotes.forEach(q => {
      if (!q.date) return
      const d = new Date(q.date)
      if (d.getFullYear() !== year) return
      const m = d.getMonth()
      opp[m]++
      if (q.status === 'SOLD') closed[m]++
    })
    return { opp, closed }
  }, [quotes, year])

  const byCategory = useMemo(() => {
    const cats: Record<string, { opp: number, sold: number }> = {}
    quotes.forEach(q => {
      const cat = fenceCategory(q.fenceStyle)
      if (!cats[cat]) cats[cat] = { opp: 0, sold: 0 }
      cats[cat].opp++
      if (q.status === 'SOLD') cats[cat].sold++
    })
    return Object.entries(cats).sort((a, b) => b[1].opp - a[1].opp)
  }, [quotes])

  const byLeadSource = useMemo(() => {
    const sources: Record<string, { opp: number, sold: number }> = {}
    quotes.forEach(q => {
      const src = q.leadSource || 'Unknown'
      if (!sources[src]) sources[src] = { opp: 0, sold: 0 }
      sources[src].opp++
      if (q.status === 'SOLD') sources[src].sold++
    })
    return Object.entries(sources).sort((a, b) => b[1].opp - a[1].opp).slice(0, 6)
  }, [quotes])

  const totalOpp    = quotes.length
  const totalSold   = quotes.filter(q => q.status === 'SOLD').length
  const totalRev    = quotes.filter(q => q.status === 'SOLD').reduce((s, q) => s + q.finalPrice, 0)
  const closingRate = totalOpp > 0 ? totalSold / totalOpp : 0
  const avgDeal     = totalSold > 0 ? totalRev / totalSold : 0
  const openPipe    = quotes.filter(q => q.status === 'DRAFT' || q.status === 'SENT').reduce((s, q) => s + q.finalPrice, 0)
  const avgMargin   = quotes.length > 0 ? quotes.reduce((s, q) => s + q.gmPct, 0) / quotes.length : 0

  if (quotes.length === 0) return null

  return (
    <div className="space-y-4 mb-4">
      <div className="grid grid-cols-5 gap-3">
        {[
          { label: 'Total Quoted',   value: String(totalOpp),  sub: 'all time' },
          { label: 'Closed',         value: String(totalSold), sub: fmtPct(closingRate) + ' close rate', accent: true },
          { label: 'Closed Revenue', value: fmt(totalRev),     sub: `avg ${fmt(avgDeal)}/job` },
          { label: 'Open Pipeline',  value: fmt(openPipe),     sub: `${quotes.filter(q => q.status === 'DRAFT' || q.status === 'SENT').length} active` },
          { label: 'Avg Margin',     value: fmtPct(avgMargin), sub: quotes.filter(q => q.gmPct >= 0.34).length + ' above target' },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 ${s.accent ? 'bg-orange-500' : 'bg-white border border-gray-200'}`}>
            <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${s.accent ? 'text-orange-100' : 'text-gray-400'}`}>{s.label}</p>
            <p className={`text-xl font-bold ${s.accent ? 'text-white' : 'text-gray-900'}`}>{s.value}</p>
            <p className={`text-xs mt-0.5 ${s.accent ? 'text-orange-200' : 'text-gray-400'}`}>{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="col-span-1 bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-gray-900 text-sm">{year} Pipeline</h3>
            <div className="flex gap-3">
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-gray-300" /><span className="text-xs text-gray-400">Quoted</span></div>
              <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-sm bg-orange-400" /><span className="text-xs text-gray-400">Sold</span></div>
            </div>
          </div>
          <MiniBarChart opp={monthlyData.opp} closed={monthlyData.closed} labels={MONTHS} />
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-3">Close Rate by Type</h3>
          <div className="space-y-2.5">
            {byCategory.map(([cat, data]) => {
              const rate = data.opp > 0 ? data.sold / data.opp : 0
              return (
                <div key={cat}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">{cat}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{data.sold}/{data.opp}</span>
                      <span className={`text-xs font-bold ${rate >= 0.5 ? 'text-green-600' : rate >= 0.3 ? 'text-yellow-600' : 'text-red-500'}`}>{fmtPct(rate)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${rate >= 0.5 ? 'bg-green-500' : rate >= 0.3 ? 'bg-yellow-400' : 'bg-red-400'}`} style={{ width: `${rate * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <h3 className="font-bold text-gray-900 text-sm mb-3">Lead Source Conversion</h3>
          <div className="space-y-2.5">
            {byLeadSource.map(([src, data]) => {
              const rate = data.opp > 0 ? data.sold / data.opp : 0
              return (
                <div key={src}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-medium text-gray-700">{src}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{data.sold}/{data.opp}</span>
                      <span className={`text-xs font-bold ${rate >= 0.5 ? 'text-green-600' : rate >= 0.3 ? 'text-yellow-600' : 'text-red-500'}`}>{fmtPct(rate)}</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-orange-400" style={{ width: `${rate * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function QuoteDrawer({
  quote, onClose, onEdit, onStatusChange, onTempChange,
}: {
  quote: SavedQuote
  onClose: () => void
  onEdit: () => void
  onStatusChange: (id: string, status: SavedQuote['status']) => void
  onTempChange: (id: string, temp: number) => void
}) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-[520px] bg-white shadow-2xl flex flex-col overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">{quote.customerName}</h2>
            <p className="text-sm text-gray-400">{quote.fenceStyle} · {quote.sections} sections · {quote.date}</p>
          </div>
          <div className="flex items-center gap-2">
            <POButton quote={quote} />
            <button onClick={onEdit} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-3 py-1.5 rounded-lg">Edit Quote</button>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="px-6 py-5 space-y-6">
          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Lead Temperature</p>
            <FlameRating value={quote.leadTemp ?? 0} onChange={v => onTempChange(quote.id, v)} />
          </div>

          <div>
            <p className="text-xs text-gray-400 mb-2 font-medium uppercase tracking-wide">Status</p>
            <div className="flex gap-2">
              {STATUS_OPTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => onStatusChange(quote.id, s as SavedQuote['status'])}
                  className={`text-xs px-3 py-1.5 rounded-lg font-semibold border transition-colors ${
                    quote.status === s ? STATUS_COLORS[s] + ' border-transparent' : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >{s}</button>
              ))}
            </div>
          </div>

          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Customer</p>
            {[
              { label: 'Name',        value: quote.customerName },
              { label: 'Phone',       value: quote.customerPhone },
              { label: 'Email',       value: quote.customerEmail },
              { label: 'Address',     value: quote.customerAddress },
              { label: 'Lead Source', value: quote.leadSource },
              { label: 'Sales Rep',   value: quote.salesRep },
            ].filter(r => r.value).map(r => (
              <div key={r.label} className="flex gap-3">
                <span className="text-xs text-gray-400 w-24 shrink-0">{r.label}</span>
                <span className="text-sm text-gray-800">{r.value}</span>
              </div>
            ))}
          </div>

          <div className="bg-gray-900 rounded-xl p-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Pricing</p>
            <div className="space-y-2">
              {[
                { label: 'Material Cost', value: fmt(quote.materialCost) },
                { label: 'Labor Cost',    value: fmt(quote.laborCost) },
                { label: 'Tear Out',      value: fmt(quote.tearOutCost) },
                { label: 'Total COGS',    value: fmt(quote.totalCOGS), bold: true },
              ].map(r => (
                <div key={r.label} className="flex justify-between">
                  <span className={`text-sm ${r.bold ? 'text-white font-semibold' : 'text-gray-400'}`}>{r.label}</span>
                  <span className={`text-sm ${r.bold ? 'text-white font-semibold' : 'text-gray-300'}`}>{r.value}</span>
                </div>
              ))}
              <div className="border-t border-gray-700 pt-2 flex justify-between">
                <span className="text-white font-bold">Final Price</span>
                <span className="text-orange-400 font-bold text-lg">{fmt(quote.finalPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400 text-sm">Gross Margin</span>
                <span className={`font-bold text-sm ${quote.gmPct >= 0.34 ? 'text-green-400' : quote.gmPct >= 0.27 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {fmtPct(quote.gmPct)}
                </span>
              </div>
            </div>
          </div>

          {/* Change Orders — only for SOLD quotes */}
          {quote.status === 'SOLD' && (
            <ChangeOrderPanel quoteId={quote.id} originalPrice={quote.finalPrice} />
          )}

          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Job Details</p>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Sections',   value: quote.sections },
                { label: 'Corners',    value: quote.corners },
                { label: 'Ends',       value: quote.ends },
                { label: 'Walk Gates', value: quote.walkGates },
                { label: 'Dbl Gates',  value: quote.dblGates },
                { label: 'Tear Out',   value: `${quote.tearOutSections} sec` },
              ].map(r => (
                <div key={r.label} className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400">{r.label}</p>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">{r.value}</p>
                </div>
              ))}
            </div>
            {quote.runs?.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {quote.runs.map((r, i) => (
                  <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">Run {i + 1}: {r} ft</span>
                ))}
              </div>
            )}
          </div>

          {quote.pullSheet?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Material Pull Sheet ({quote.pullSheet.length} items)
              </p>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="text-left px-3 py-2 text-gray-500">Item</th>
                      <th className="text-right px-3 py-2 text-gray-500">Qty</th>
                      <th className="text-right px-3 py-2 text-gray-500">Unit</th>
                      <th className="text-right px-3 py-2 text-gray-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {quote.pullSheet.map((item, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-800 font-medium">{item.item}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{item.qty}</td>
                        <td className="px-3 py-2 text-right text-gray-400">${item.unitCost}</td>
                        <td className="px-3 py-2 text-right font-semibold text-gray-900">${item.total.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-gray-200 bg-gray-50">
                    <tr>
                      <td colSpan={3} className="px-3 py-2 font-bold text-gray-700">Total Material</td>
                      <td className="px-3 py-2 text-right font-bold text-gray-900">{fmt(quote.materialCost)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {quote.notes && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</p>
              <p className="text-sm text-gray-700 bg-gray-50 rounded-xl p-3">{quote.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function QuotesPage({
  quotes,
  onOpenQuote,
  onNewQuote,
}: {
  quotes: SavedQuote[]
  onOpenQuote: (q: SavedQuote) => void
  onNewQuote: () => void
}) {
  const [search, setSearch]             = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [categoryFilter, setCategoryFilter] = useState('All')
  const [selectedQuote, setSelectedQuote] = useState<SavedQuote | null>(null)
  const [pullConfirm, setPullConfirm]   = useState<SavedQuote | null>(null)
  const [pullLocationId, setPullLocationId] = useState('')
  const [pullResult, setPullResult]     = useState<string | null>(null)
  const [localQuotes, setLocalQuotes]   = useState<SavedQuote[]>(() => {
    try {
      const raw = localStorage.getItem('fencepro_quotes')
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })

  function persist(updated: SavedQuote[]) {
    localStorage.setItem('fencepro_quotes', JSON.stringify(updated))
    setLocalQuotes(updated)
    try { window.dispatchEvent(new CustomEvent('fencepro:quotes:updated')) } catch {}
  }

  const allIds = quotes.map(q => q.id).join(',')
  useEffect(() => {
    const localIds = new Set(localQuotes.map(q => q.id))
    const newOnes = quotes.filter(q => !localIds.has(q.id))
    if (newOnes.length > 0) persist([...newOnes, ...localQuotes])
  }, [allIds])

  // Live-refresh when quotes are saved from anywhere else
  useEffect(() => {
    const reload = () => {
      try {
        const raw = localStorage.getItem('fencepro_quotes')
        if (raw) setLocalQuotes(JSON.parse(raw))
      } catch {}
    }
    window.addEventListener('fencepro:quotes:updated', reload)
    return () => window.removeEventListener('fencepro:quotes:updated', reload)
  }, [])

  function handleStatusChange(id: string, status: SavedQuote['status']) {
    const quote = localQuotes.find(q => q.id === id)
    const wasSold = quote?.status === 'SOLD'
    const updated = localQuotes.map(q => q.id === id ? { ...q, status } : q)
    persist(updated)
    if (selectedQuote?.id === id) setSelectedQuote({ ...selectedQuote, status })

    // When changing TO sold: create job + offer to pull inventory
    if (status === 'SOLD' && !wasSold && quote) {
      if (!getJobByQuoteId(quote.id)) createJobFromQuote(quote)

      if (quote.pullSheet?.length) {
        const locs = getLocations().filter(l => l.isActive)
        setPullLocationId(locs[0]?.id || '')
        setPullConfirm(quote)
      }
    }
  }

  function handlePullConfirm() {
    if (!pullConfirm || !pullLocationId) return
    const sheet = pullConfirm.pullSheet.map(item => ({ item: item.item, qty: item.qty }))
    const txns = pullFromInventory(sheet, pullLocationId, pullConfirm.id)
    setPullResult(`Pulled ${txns.length} items from inventory`)
    setPullConfirm(null)
    setTimeout(() => setPullResult(null), 4000)
  }

  function handleTempChange(id: string, leadTemp: number) {
    const updated = localQuotes.map(q => q.id === id ? { ...q, leadTemp } : q)
    persist(updated)
    if (selectedQuote?.id === id) setSelectedQuote({ ...selectedQuote, leadTemp })
  }

  const filtered = localQuotes.filter(q => {
    const s = search.toLowerCase()
    const matchSearch = !s ||
      q.customerName.toLowerCase().includes(s) ||
      q.fenceStyle.toLowerCase().includes(s) ||
      (q.customerPhone || '').includes(s) ||
      (q.customerAddress || '').toLowerCase().includes(s)
    const matchStatus = statusFilter === 'All' || q.status === statusFilter
    const matchCat    = categoryFilter === 'All' || fenceCategory(q.fenceStyle) === categoryFilter
    return matchSearch && matchStatus && matchCat
  })

  return (
    <div>
      <PipelineAnalytics quotes={localQuotes} />

      <div className="bg-white rounded-2xl border border-gray-200 p-4 mb-4 flex items-center gap-3 flex-wrap">
        <input
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 flex-1 min-w-48"
          placeholder="Search by customer, style, phone, address..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="flex gap-1">
          {['All', 'DRAFT', 'SENT', 'SOLD', 'LOST'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${
                statusFilter === s ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >{s}</button>
          ))}
        </div>
        <div className="flex gap-1">
          {FENCE_CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-colors ${
                categoryFilter === c ? 'bg-orange-500 text-white border-orange-500' : 'border-gray-200 text-gray-500 hover:border-orange-300'
              }`}
            >{c}</button>
          ))}
        </div>
        <button onClick={onNewQuote} className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg ml-auto">
          + New Quote
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-4xl mb-3">📋</p>
            <p className="text-gray-500 font-medium">{localQuotes.length === 0 ? 'No quotes yet' : 'No quotes match your filters'}</p>
            {localQuotes.length === 0 && (
              <button onClick={onNewQuote} className="mt-4 text-orange-500 text-sm hover:underline">Create your first quote</button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Style</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Sections</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Price</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Margin</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Heat</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Rep</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(q => (
                <tr
                  key={q.id}
                  className="hover:bg-orange-50 cursor-pointer transition-colors"
                  onClick={() => setSelectedQuote(q)}
                >
                  <td className="px-5 py-3">
                    <p className="font-semibold text-gray-900">{q.customerName}</p>
                    {q.customerPhone && <p className="text-xs text-gray-400">{q.customerPhone}</p>}
                  </td>
                  <td className="px-4 py-3 text-gray-700">{q.fenceStyle}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{q.sections}</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900">{fmt(q.finalPrice)}</td>
                  <td className={`px-4 py-3 text-right font-bold text-sm ${marginColor(q.gmPct)}`}>{fmtPct(q.gmPct)}</td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <FlameRating value={q.leadTemp ?? 0} onChange={v => handleTempChange(q.id, v)} />
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 text-xs uppercase">{q.salesRep || '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-400 text-xs">{q.date}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[q.status]}`}>{q.status}</span>
                    <EngagementIndicator quote={q} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-xs text-gray-400 mt-2 text-right">
        {filtered.length} of {localQuotes.length} quotes
      </div>

      {selectedQuote && (
        <QuoteDetailDrawer
          quote={selectedQuote}
          onClose={() => setSelectedQuote(null)}
          onEdit={() => { onOpenQuote(selectedQuote); setSelectedQuote(null) }}
          onChange={() => {
            try {
              const raw = localStorage.getItem('fencepro_quotes')
              if (raw) {
                const all: SavedQuote[] = JSON.parse(raw)
                setLocalQuotes(all)
                const refreshed = all.find(q => q.id === selectedQuote.id) || null
                setSelectedQuote(refreshed)
              }
            } catch {}
          }}
        />
      )}

      {/* Pull result toast */}
      {pullResult && (
        <div className="fixed bottom-6 right-6 z-50 bg-green-600 text-white px-5 py-3 rounded-xl shadow-lg text-sm font-semibold">
          {pullResult}
        </div>
      )}

      {/* Pull from inventory confirmation */}
      {pullConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPullConfirm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[440px] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="font-bold text-gray-900">Pull Materials from Inventory?</h3>
              <p className="text-xs text-gray-400 mt-0.5">
                {pullConfirm.customerName} — {pullConfirm.pullSheet.length} items on pull sheet
              </p>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium mb-1 block">Pull from location</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={pullLocationId}
                  onChange={e => setPullLocationId(e.target.value)}
                >
                  {getLocations().filter(l => l.isActive).map(l => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 max-h-48 overflow-y-auto">
                <p className="text-xs text-gray-400 font-semibold uppercase mb-2">Items to pull</p>
                {pullConfirm.pullSheet.slice(0, 15).map((item, i) => (
                  <div key={i} className="flex justify-between text-xs py-0.5">
                    <span className="text-gray-700 truncate pr-2">{item.item}</span>
                    <span className="text-gray-500 shrink-0">×{item.qty}</span>
                  </div>
                ))}
                {pullConfirm.pullSheet.length > 15 && (
                  <p className="text-xs text-gray-400 mt-1">+{pullConfirm.pullSheet.length - 15} more items</p>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3">
              <button
                onClick={() => setPullConfirm(null)}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
              >
                Skip
              </button>
              <button
                onClick={handlePullConfirm}
                className="bg-orange-500 hover:bg-orange-600 text-white font-semibold px-5 py-2 rounded-xl text-sm"
              >
                Pull from Inventory
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
function EngagementIndicator({ quote }: { quote: SavedQuote & { viewCount?: number; viewedAt?: string; acceptedAt?: string } }) {
  if (quote.acceptedAt || quote.status === 'SOLD') {
    return <span className="ml-2 text-xs text-green-600" title={`Accepted${quote.acceptedAt ? ' ' + new Date(quote.acceptedAt).toLocaleDateString() : ''}`}>✓</span>
  }
  if ((quote.viewCount || 0) > 0) {
    return <span className="ml-2 text-[10px] text-gray-500" title={`${quote.viewCount} view${quote.viewCount === 1 ? '' : 's'}${quote.viewedAt ? ' · first ' + new Date(quote.viewedAt).toLocaleDateString() : ''}`}>👁 {quote.viewCount}</span>
  }
  if (quote.status === 'SENT' && quote.date) {
    const days = Math.floor((Date.now() - new Date(quote.date).getTime()) / 864e5)
    if (days >= 0) {
      return <span className="ml-2 text-[10px] text-gray-400" title={`Sent ${days} day${days === 1 ? '' : 's'} ago, not yet viewed`}>⌛ {days}d</span>
    }
  }
  return null
}
