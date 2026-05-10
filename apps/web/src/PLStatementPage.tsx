/**
 * Profit & Loss Statement
 *
 * Combines AR invoices + vendor bills + job costing labor + manual entries
 * into a standard P&L with EBITDA highlighted.
 */

import { useState, useMemo } from 'react'
import {
  calculatePl,
  calculateMonthlyPl,
  periodMTD, periodQTD, periodYTD, periodLast12, periodCustom,
  type PeriodRange, type PlStatement,
} from './plEngine'
import {
  getPlEntries, createPlEntry, updatePlEntry, deletePlEntry, ensureRecurringForPeriod,
  type PlManualEntry, type PlCategory,
} from './financeStore'

const fmt = (c: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(c / 100)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

type PresetKey = 'mtd' | 'qtd' | 'ytd' | 'last12' | 'custom'

const PL_CATEGORIES: { key: PlCategory; label: string }[] = [
  { key: 'revenue', label: 'Other Revenue' },
  { key: 'operating_expense', label: 'Operating Expense' },
  { key: 'depreciation', label: 'Depreciation' },
  { key: 'amortization', label: 'Amortization' },
  { key: 'interest', label: 'Interest Expense' },
  { key: 'tax', label: 'Tax Provision' },
  { key: 'ebitda_adjustment', label: 'EBITDA Adjustment' },
  { key: 'other', label: 'Other' },
]

export default function PLStatementPage() {
  const [preset, setPreset] = useState<PresetKey>('ytd')
  const [customFrom, setCustomFrom] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3)
    return d.toISOString().slice(0, 10)
  })
  const [customTo, setCustomTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [viewMode, setViewMode] = useState<'summary' | 'monthly'>('summary')
  const [showEntries, setShowEntries] = useState(false)
  const [bumpKey, setBumpKey] = useState(0)

  const period: PeriodRange = useMemo(() => {
    switch (preset) {
      case 'mtd': return periodMTD()
      case 'qtd': return periodQTD()
      case 'ytd': return periodYTD()
      case 'last12': return periodLast12()
      case 'custom': return periodCustom(customFrom, customTo)
    }
  }, [preset, customFrom, customTo])

  const pl: PlStatement = useMemo(() => {
    // Auto-populate recurring entries for the period
    const d = new Date()
    ensureRecurringForPeriod(d.getFullYear(), d.getMonth() + 1)
    return calculatePl(period.from, period.to, period.label)
  }, [period, bumpKey])

  const monthlyPl: PlStatement[] = useMemo(() => {
    const d = new Date()
    return calculateMonthlyPl(d.getFullYear(), d.getMonth() + 1, 12)
  }, [bumpKey])

  const positive = pl.ebitda >= 0

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profit &amp; Loss Statement</h1>
          <p className="text-sm text-gray-500 mt-1">Revenue, COGS, operating expenses, and EBITDA for the selected period.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowEntries(true)}
            className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-4 py-2 rounded-lg">Manage Entries</button>
          <button onClick={() => exportPlPdf(pl)}
            className="text-sm bg-gray-900 hover:bg-gray-800 text-white px-4 py-2 rounded-lg">Export PDF</button>
          <button onClick={() => exportPlCsv(pl)}
            className="text-sm bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg">Export CSV</button>
        </div>
      </div>

      {/* Period selector */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
          {([['mtd', 'MTD'], ['qtd', 'QTD'], ['ytd', 'YTD'], ['last12', 'Last 12'], ['custom', 'Custom']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setPreset(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${preset === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{l}</button>
          ))}
        </div>
        {preset === 'custom' && (
          <div className="flex gap-2 items-center">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5" />
            <span className="text-gray-400">to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
              className="text-sm border border-gray-200 rounded-lg px-3 py-1.5" />
          </div>
        )}
        <div className="lg:ml-auto flex gap-1 bg-gray-100 rounded-xl p-1">
          <button onClick={() => setViewMode('summary')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${viewMode === 'summary' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Summary</button>
          <button onClick={() => setViewMode('monthly')}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${viewMode === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Monthly (12)</button>
        </div>
      </div>

      {/* KPI summary row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Revenue</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(pl.revenue.total)}</p>
          <p className="text-xs text-gray-400 mt-1">{period.label}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Gross Profit</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{fmt(pl.grossProfit)}</p>
          <p className="text-xs text-gray-400 mt-1">Margin: {fmtPct(pl.grossMargin)}</p>
        </div>
        <div className={`rounded-2xl border p-5 ${positive ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">EBITDA</p>
          <p className={`text-2xl font-bold mt-1 ${positive ? 'text-green-700' : 'text-red-700'}`}>{fmt(pl.ebitda)}</p>
          <p className="text-xs text-gray-500 mt-1">Margin: {fmtPct(pl.ebitdaMargin)}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Net Income</p>
          <p className={`text-2xl font-bold mt-1 ${pl.netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>{fmt(pl.netIncome)}</p>
          <p className="text-xs text-gray-400 mt-1">After D&amp;A, interest, tax</p>
        </div>
      </div>

      {viewMode === 'monthly' ? (
        <MonthlyView monthly={monthlyPl} />
      ) : (
        <SummaryView pl={pl} />
      )}

      {showEntries && (
        <ManageEntriesModal
          onClose={() => setShowEntries(false)}
          onSaved={() => setBumpKey(k => k + 1)}
        />
      )}
    </div>
  )
}

// ── Summary view ──

function SummaryView({ pl }: { pl: PlStatement }) {
  const positive = pl.ebitda >= 0
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
        <h3 className="font-semibold text-gray-900">{pl.period.label}</h3>
      </div>
      <div className="divide-y divide-gray-50">
        <Section label="REVENUE" />
        <Row label="Fence Installation Revenue" amount={pl.revenue.fenceInstallation} indent={1} />
        <Row label="Other Revenue" amount={pl.revenue.otherRevenue} indent={1} />
        <Row label="Total Revenue" amount={pl.revenue.total} bold indent={0} />

        <Section label="COST OF GOODS SOLD" />
        <Row label="Materials" amount={pl.cogs.materials} indent={1} />
        <Row label="Direct Labor" amount={pl.cogs.directLabor} indent={1} />
        <Row label="Subcontractors" amount={pl.cogs.subcontractors} indent={1} />
        <Row label="Equipment" amount={pl.cogs.equipment} indent={1} />
        <Row label="Total COGS" amount={pl.cogs.total} bold indent={0} />

        <Row label="Gross Profit" amount={pl.grossProfit} bold indent={0} highlight="neutral" />
        <div className="px-6 py-2 flex items-center justify-between text-sm bg-gray-50">
          <span className="text-gray-500 italic">Gross Margin</span>
          <span className="text-gray-700 font-semibold">{fmtPct(pl.grossMargin)}</span>
        </div>

        <Section label="OPERATING EXPENSES" />
        <Row label="Overhead" amount={pl.opex.overhead} indent={1} />
        <Row label="Utilities" amount={pl.opex.utilities} indent={1} />
        <Row label="Insurance" amount={pl.opex.insurance} indent={1} />
        <Row label="Other Operating Expenses" amount={pl.opex.other} indent={1} />
        <Row label="Total Operating Expenses" amount={pl.opex.total} bold indent={0} />

        <div className={`px-4 lg:px-6 py-5 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 ${positive ? 'bg-green-50' : 'bg-red-50'}`}>
          <div>
            <p className={`text-sm font-bold uppercase tracking-wide ${positive ? 'text-green-800' : 'text-red-800'}`}>EBITDA</p>
            <p className="text-xs text-gray-600 mt-0.5">Earnings before interest, taxes, depreciation &amp; amortization</p>
          </div>
          <div className="text-left lg:text-right">
            <p className={`text-2xl lg:text-3xl font-bold ${positive ? 'text-green-700' : 'text-red-700'}`}>{fmt(pl.ebitda)}</p>
            <p className="text-xs text-gray-600 mt-0.5">Margin: {fmtPct(pl.ebitdaMargin)}</p>
          </div>
        </div>

        <Section label="BELOW THE LINE" />
        <Row label="Depreciation" amount={pl.depreciation} indent={1} />
        <Row label="Amortization" amount={pl.amortization} indent={1} />
        <Row label="EBIT" amount={pl.ebit} bold indent={0} />
        <Row label="Interest Expense" amount={pl.interest} indent={1} />
        <Row label="Earnings Before Tax (EBT)" amount={pl.ebt} bold indent={0} />
        <Row label="Tax Provision" amount={pl.tax} indent={1} />
        <Row label="Net Income" amount={pl.netIncome} bold indent={0} highlight={pl.netIncome >= 0 ? 'positive' : 'negative'} />
      </div>
    </div>
  )
}

function Section({ label }: { label: string }) {
  return <div className="px-6 py-2 bg-gray-50 text-xs font-bold text-gray-500 uppercase tracking-widest">{label}</div>
}

function Row({ label, amount, indent = 0, bold, highlight }: { label: string; amount: number; indent?: number; bold?: boolean; highlight?: 'positive' | 'negative' | 'neutral' }) {
  const fc =
    highlight === 'positive' ? 'text-green-700'
      : highlight === 'negative' ? 'text-red-700'
      : 'text-gray-900'
  return (
    <div className={`px-6 py-2 flex items-center justify-between text-sm ${bold ? 'bg-gray-50 font-semibold' : ''}`}>
      <span className={`${bold ? 'text-gray-900' : 'text-gray-600'}`} style={{ paddingLeft: indent * 16 }}>{label}</span>
      <span className={fc}>{fmt(amount)}</span>
    </div>
  )
}

// ── Monthly 12-column view ──

function MonthlyView({ monthly }: { monthly: PlStatement[] }) {
  const labels = monthly.map(m => m.period.label.split(' ')[0]) // "Jan" etc.
  const revenueSeries = monthly.map(m => m.revenue.total)
  const gpSeries = monthly.map(m => m.grossProfit)
  const ebitdaSeries = monthly.map(m => m.ebitda)
  const totalRev = revenueSeries.reduce((a, b) => a + b, 0)
  const totalEbitda = ebitdaSeries.reduce((a, b) => a + b, 0)

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Trailing 12 Months</h3>
        <Sparklines
          labels={labels}
          series={[
            { data: revenueSeries, color: '#f97316', label: 'Revenue' },
            { data: gpSeries, color: '#06b6d4', label: 'Gross Profit' },
            { data: ebitdaSeries, color: '#10b981', label: 'EBITDA' },
          ]}
        />
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-[10px] uppercase font-semibold text-gray-500 tracking-widest">
            <tr>
              <th className="px-4 py-3 text-left">Line Item</th>
              {labels.map((l, i) => (
                <th key={i} className="px-3 py-3 text-right">{l}</th>
              ))}
              <th className="px-4 py-3 text-right bg-gray-100">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            <MonthRow label="Revenue" values={revenueSeries} bold />
            <MonthRow label="Materials" values={monthly.map(m => m.cogs.materials)} />
            <MonthRow label="Direct Labor" values={monthly.map(m => m.cogs.directLabor)} />
            <MonthRow label="Subcontractors" values={monthly.map(m => m.cogs.subcontractors)} />
            <MonthRow label="Equipment" values={monthly.map(m => m.cogs.equipment)} />
            <MonthRow label="Total COGS" values={monthly.map(m => m.cogs.total)} bold />
            <MonthRow label="Gross Profit" values={gpSeries} bold highlight />
            <MonthRow label="Overhead" values={monthly.map(m => m.opex.overhead)} />
            <MonthRow label="Utilities" values={monthly.map(m => m.opex.utilities)} />
            <MonthRow label="Insurance" values={monthly.map(m => m.opex.insurance)} />
            <MonthRow label="Other OpEx" values={monthly.map(m => m.opex.other)} />
            <MonthRow label="Total OpEx" values={monthly.map(m => m.opex.total)} bold />
            <MonthRow label="EBITDA" values={ebitdaSeries} bold highlight />
          </tbody>
          <tfoot className="bg-gray-50 font-semibold text-xs">
            <tr>
              <td className="px-4 py-3 text-gray-700">Summary</td>
              {labels.map((_, i) => <td key={i}></td>)}
              <td className="px-4 py-3 text-right text-gray-900">
                Rev: {fmt(totalRev)} · EBITDA: {fmt(totalEbitda)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  )
}

function MonthRow({ label, values, bold, highlight }: { label: string; values: number[]; bold?: boolean; highlight?: boolean }) {
  const total = values.reduce((a, b) => a + b, 0)
  return (
    <tr className={bold ? 'bg-gray-50/50' : ''}>
      <td className={`px-4 py-2 ${bold ? 'font-semibold text-gray-900' : 'text-gray-600'}`}>{label}</td>
      {values.map((v, i) => (
        <td key={i} className={`px-3 py-2 text-right ${bold ? 'font-semibold' : ''} ${highlight && v < 0 ? 'text-red-600' : highlight && bold ? 'text-green-700' : 'text-gray-700'}`}>
          {v === 0 ? '—' : fmt(v)}
        </td>
      ))}
      <td className={`px-4 py-2 text-right bg-gray-50 ${bold ? 'font-bold text-gray-900' : 'text-gray-700'}`}>{fmt(total)}</td>
    </tr>
  )
}

function Sparklines({ labels, series }: { labels: string[]; series: { data: number[]; color: string; label: string }[] }) {
  const W = 640, H = 160, PAD = 20
  const allValues = series.flatMap(s => s.data)
  const min = Math.min(0, ...allValues)
  const max = Math.max(1, ...allValues)
  const range = max - min || 1
  const xStep = (W - PAD * 2) / Math.max(1, labels.length - 1)
  const yAt = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2)

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {series.map((s, si) => {
          const path = s.data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${PAD + i * xStep} ${yAt(v)}`).join(' ')
          return (
            <g key={si}>
              <path d={path} fill="none" stroke={s.color} strokeWidth={2} />
              {s.data.map((v, i) => (
                <circle key={i} cx={PAD + i * xStep} cy={yAt(v)} r={2.5} fill={s.color} />
              ))}
            </g>
          )
        })}
        {labels.map((l, i) => (
          <text key={i} x={PAD + i * xStep} y={H - 4} fontSize={9} textAnchor="middle" fill="#94a3b8">{l}</text>
        ))}
      </svg>
      <div className="flex gap-4 mt-3 text-xs">
        {series.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <span style={{ backgroundColor: s.color }} className="w-3 h-3 rounded-sm inline-block" />
            <span className="text-gray-600">{s.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Manage Entries modal ──

function ManageEntriesModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [entries, setEntries] = useState<PlManualEntry[]>(() => getPlEntries())
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<PlManualEntry | null>(null)

  function reload() {
    setEntries(getPlEntries())
    onSaved()
  }

  function handleDelete(id: string) {
    if (!confirm('Delete this entry?')) return
    deletePlEntry(id)
    reload()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col modal-responsive">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Manage P&amp;L Entries</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="p-6 flex-1 overflow-y-auto">
          <div className="flex justify-between items-center mb-4">
            <p className="text-sm text-gray-500">Manual entries for items not captured by invoices or vendor bills — depreciation, owner salary, vehicle payments, etc.</p>
            <button onClick={() => { setEditing(null); setShowForm(true) }}
              className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">+ Add Entry</button>
          </div>
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-xs text-gray-500 uppercase font-semibold">
                  <th className="px-4 py-2 text-left">Period</th>
                  <th className="px-4 py-2 text-left">Category</th>
                  <th className="px-4 py-2 text-left">Label</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2 text-center">Recurring</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {entries.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-gray-400">No manual entries yet</td></tr>
                ) : entries.map(e => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-700">{MONTHS[e.periodMonth - 1]} {e.periodYear}</td>
                    <td className="px-4 py-2 text-gray-600">{e.category.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-2 text-gray-900">{e.label}</td>
                    <td className="px-4 py-2 text-right font-medium">{fmt(e.amountCents)}</td>
                    <td className="px-4 py-2 text-center">{e.isRecurring ? '✓' : '—'}</td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => { setEditing(e); setShowForm(true) }} className="text-blue-600 hover:underline text-xs mr-2">Edit</button>
                      <button onClick={() => handleDelete(e.id)} className="text-red-600 hover:underline text-xs">Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {showForm && (
          <EntryForm
            initial={editing}
            onCancel={() => setShowForm(false)}
            onSaved={() => { setShowForm(false); reload() }}
          />
        )}
      </div>
    </div>
  )
}

function EntryForm({ initial, onCancel, onSaved }: { initial: PlManualEntry | null; onCancel: () => void; onSaved: () => void }) {
  const now = new Date()
  const [periodMonth, setPeriodMonth] = useState(initial?.periodMonth ?? now.getMonth() + 1)
  const [periodYear, setPeriodYear] = useState(initial?.periodYear ?? now.getFullYear())
  const [category, setCategory] = useState<PlCategory>(initial?.category ?? 'operating_expense')
  const [label, setLabel] = useState(initial?.label ?? '')
  const [amount, setAmount] = useState(initial ? (initial.amountCents / 100).toFixed(2) : '')
  const [isRecurring, setIsRecurring] = useState(initial?.isRecurring ?? false)
  const [notes, setNotes] = useState(initial?.notes ?? '')

  function handleSave() {
    if (!label.trim() || !amount) return
    const amountCents = Math.round(parseFloat(amount) * 100)
    const data = {
      periodMonth, periodYear, category, label: label.trim(),
      amountCents, isRecurring, notes, createdBy: 'user',
    }
    if (initial) updatePlEntry(initial.id, data)
    else createPlEntry(data)
    onSaved()
  }

  return (
    <div className="fixed inset-0 z-60 bg-black/50 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto modal-responsive">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">{initial ? 'Edit' : 'Add'} P&amp;L Entry</h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-2xl">×</button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 font-semibold uppercase">Month</label>
              <select value={periodMonth} onChange={e => setPeriodMonth(parseInt(e.target.value))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1">
                {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 font-semibold uppercase">Year</label>
              <input type="number" value={periodYear} onChange={e => setPeriodYear(parseInt(e.target.value))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase">Category</label>
            <select value={category} onChange={e => setCategory(e.target.value as PlCategory)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1">
              {PL_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase">Label</label>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Owner Salary, Truck Lease"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase">Amount ($)</label>
            <input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} />
            <span>Recurring monthly (auto-copy to each new month)</span>
          </label>
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1" />
          </div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onCancel} className="text-sm text-gray-600 hover:text-gray-900 px-4 py-2">Cancel</button>
          <button onClick={handleSave}
            className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg">Save</button>
        </div>
      </div>
    </div>
  )
}

// ── Exports ──

function exportPlCsv(pl: PlStatement) {
  const rows = [
    ['Period', pl.period.label],
    [],
    ['REVENUE'],
    ['Fence Installation Revenue', (pl.revenue.fenceInstallation / 100).toFixed(2)],
    ['Other Revenue', (pl.revenue.otherRevenue / 100).toFixed(2)],
    ['Total Revenue', (pl.revenue.total / 100).toFixed(2)],
    [],
    ['COST OF GOODS SOLD'],
    ['Materials', (pl.cogs.materials / 100).toFixed(2)],
    ['Direct Labor', (pl.cogs.directLabor / 100).toFixed(2)],
    ['Subcontractors', (pl.cogs.subcontractors / 100).toFixed(2)],
    ['Equipment', (pl.cogs.equipment / 100).toFixed(2)],
    ['Total COGS', (pl.cogs.total / 100).toFixed(2)],
    ['Gross Profit', (pl.grossProfit / 100).toFixed(2)],
    ['Gross Margin %', (pl.grossMargin * 100).toFixed(1) + '%'],
    [],
    ['OPERATING EXPENSES'],
    ['Overhead', (pl.opex.overhead / 100).toFixed(2)],
    ['Utilities', (pl.opex.utilities / 100).toFixed(2)],
    ['Insurance', (pl.opex.insurance / 100).toFixed(2)],
    ['Other Operating Expenses', (pl.opex.other / 100).toFixed(2)],
    ['Total OpEx', (pl.opex.total / 100).toFixed(2)],
    [],
    ['EBITDA', (pl.ebitda / 100).toFixed(2)],
    ['EBITDA Margin %', (pl.ebitdaMargin * 100).toFixed(1) + '%'],
    [],
    ['Depreciation', (pl.depreciation / 100).toFixed(2)],
    ['Amortization', (pl.amortization / 100).toFixed(2)],
    ['EBIT', (pl.ebit / 100).toFixed(2)],
    ['Interest', (pl.interest / 100).toFixed(2)],
    ['EBT', (pl.ebt / 100).toFixed(2)],
    ['Tax', (pl.tax / 100).toFixed(2)],
    ['Net Income', (pl.netIncome / 100).toFixed(2)],
  ]
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pl_${pl.period.label.replace(/[^a-z0-9]/gi, '_')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function exportPlPdf(pl: PlStatement) {
  // Lightweight PDF: print-friendly HTML opened in new window → user prints to PDF.
  const company = (() => {
    try {
      const raw = localStorage.getItem('fencepro_config')
      if (raw) { const c = JSON.parse(raw); return c.company?.name || 'EZBiz' }
    } catch {}
    return 'EZBiz'
  })()

  const html = `
<!doctype html>
<html><head><meta charset="utf-8"><title>Profit & Loss — ${pl.period.label}</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; padding: 40px; color: #1f2937; }
  h1 { margin: 0; font-size: 22px; }
  h2 { margin: 0 0 16px; font-size: 13px; color: #6b7280; font-weight: 500; }
  .section { background: #f9fafb; padding: 6px 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; color: #6b7280; margin-top: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  td { padding: 5px 10px; border-bottom: 1px solid #f3f4f6; }
  td.amt { text-align: right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight: 700; background: #f9fafb; }
  tr.ebitda td { background: ${pl.ebitda >= 0 ? '#d1fae5' : '#fee2e2'}; color: ${pl.ebitda >= 0 ? '#065f46' : '#991b1b'}; font-size: 14px; font-weight: 700; }
  .right { text-align: right; }
  .meta { margin-top: 32px; font-size: 11px; color: #9ca3af; }
</style></head><body>
<h1>${company}</h1>
<h2>Profit &amp; Loss Statement — ${pl.period.label}</h2>
<div class="section">Revenue</div>
<table>
  <tr><td>Fence Installation Revenue</td><td class="amt">${fmt(pl.revenue.fenceInstallation)}</td></tr>
  <tr><td>Other Revenue</td><td class="amt">${fmt(pl.revenue.otherRevenue)}</td></tr>
  <tr class="total"><td>Total Revenue</td><td class="amt">${fmt(pl.revenue.total)}</td></tr>
</table>
<div class="section">Cost of Goods Sold</div>
<table>
  <tr><td>Materials</td><td class="amt">${fmt(pl.cogs.materials)}</td></tr>
  <tr><td>Direct Labor</td><td class="amt">${fmt(pl.cogs.directLabor)}</td></tr>
  <tr><td>Subcontractors</td><td class="amt">${fmt(pl.cogs.subcontractors)}</td></tr>
  <tr><td>Equipment</td><td class="amt">${fmt(pl.cogs.equipment)}</td></tr>
  <tr class="total"><td>Total COGS</td><td class="amt">${fmt(pl.cogs.total)}</td></tr>
  <tr class="total"><td>Gross Profit</td><td class="amt">${fmt(pl.grossProfit)}</td></tr>
  <tr><td>Gross Margin %</td><td class="amt">${fmtPct(pl.grossMargin)}</td></tr>
</table>
<div class="section">Operating Expenses</div>
<table>
  <tr><td>Overhead</td><td class="amt">${fmt(pl.opex.overhead)}</td></tr>
  <tr><td>Utilities</td><td class="amt">${fmt(pl.opex.utilities)}</td></tr>
  <tr><td>Insurance</td><td class="amt">${fmt(pl.opex.insurance)}</td></tr>
  <tr><td>Other Operating Expenses</td><td class="amt">${fmt(pl.opex.other)}</td></tr>
  <tr class="total"><td>Total Operating Expenses</td><td class="amt">${fmt(pl.opex.total)}</td></tr>
</table>
<table>
  <tr class="ebitda"><td>EBITDA</td><td class="amt">${fmt(pl.ebitda)}</td></tr>
  <tr><td>EBITDA Margin %</td><td class="amt">${fmtPct(pl.ebitdaMargin)}</td></tr>
</table>
<div class="section">Below the Line</div>
<table>
  <tr><td>Depreciation</td><td class="amt">${fmt(pl.depreciation)}</td></tr>
  <tr><td>Amortization</td><td class="amt">${fmt(pl.amortization)}</td></tr>
  <tr class="total"><td>EBIT</td><td class="amt">${fmt(pl.ebit)}</td></tr>
  <tr><td>Interest Expense</td><td class="amt">${fmt(pl.interest)}</td></tr>
  <tr class="total"><td>Earnings Before Tax</td><td class="amt">${fmt(pl.ebt)}</td></tr>
  <tr><td>Tax Provision</td><td class="amt">${fmt(pl.tax)}</td></tr>
  <tr class="total"><td>Net Income</td><td class="amt">${fmt(pl.netIncome)}</td></tr>
</table>
<div class="meta">Generated ${new Date().toLocaleString()}</div>
<script>window.print()</script>
</body></html>`

  const w = window.open('', '_blank')
  if (w) { w.document.write(html); w.document.close() }
}
