import { useState, useMemo } from 'react'
import type { SavedQuote } from './QuotesPage'
import { getOptions } from './bundleStore'

/* ───────── helpers ───────── */

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fenceCategory(style: string): string {
  if (style.toLowerCase().includes('vinyl') || style.startsWith('WV') || style.startsWith('TV')) return 'Vinyl'
  if (style.toLowerCase().includes('alum')) return 'Aluminum'
  if (style.toLowerCase().includes('com')) return 'Commercial'
  if (style.startsWith('CL')) return 'Chainlink'
  return 'Other'
}

function marginColor(pct: number) {
  if (pct >= 0.34) return 'text-green-600'
  if (pct >= 0.27) return 'text-yellow-600'
  return 'text-red-500'
}

function marginBg(pct: number) {
  if (pct >= 0.34) return 'bg-green-500'
  if (pct >= 0.27) return 'bg-yellow-500'
  return 'bg-red-500'
}

type Granularity = 'monthly' | 'quarterly'

interface OverheadItem {
  id: string
  label: string
  annual: number
  category: string
  parentId?: string
}

interface BudgetState {
  revenueGoal: number
  overheadPct: number
  laborPct: number
  materialsPct: number
  netProfitPct: number
  seasonality: number[]
  overhead: OverheadItem[]
}

function loadBudget(): BudgetState | null {
  try {
    const raw = localStorage.getItem('fencepro_budget')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/* ───────── grouping helpers ───────── */

function getPeriodKey(dateStr: string, gran: Granularity): string {
  const d = new Date(dateStr)
  const y = d.getFullYear()
  const m = d.getMonth()
  if (gran === 'monthly') return `${y}-${String(m + 1).padStart(2, '0')}`
  return `${y}-Q${Math.floor(m / 3) + 1}`
}

function generatePeriodKeys(year: number, gran: Granularity): string[] {
  if (gran === 'quarterly') return [1,2,3,4].map(q => `${year}-Q${q}`)
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

/* ───────── SVG bar chart ───────── */

function BarChart({ data, labels, color = '#f97316', secondaryData, secondaryColor = '#94a3b8', height = 220, barLabel }: {
  data: number[]
  labels: string[]
  color?: string
  secondaryData?: number[]
  secondaryColor?: string
  height?: number
  barLabel?: (v: number) => string
}) {
  const maxVal = Math.max(...data, ...(secondaryData || []), 1)
  const barW = Math.min(32, Math.floor(600 / data.length) - 12)
  const chartW = data.length * (barW + (secondaryData ? barW + 4 : 0) + 16) + 40
  const chartH = height
  const plotH = chartH - 30

  return (
    <div className="overflow-x-auto">
      <svg width={Math.max(chartW, 300)} height={chartH} className="block">
        {/* grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(pct => (
          <g key={pct}>
            <line
              x1={40} y1={plotH - pct * (plotH - 10)} x2={chartW} y2={plotH - pct * (plotH - 10)}
              stroke="#e5e7eb" strokeWidth={1}
            />
            <text x={36} y={plotH - pct * (plotH - 10) + 4} textAnchor="end" className="fill-gray-400" fontSize={10}>
              {barLabel ? barLabel(maxVal * pct) : fmt(maxVal * pct)}
            </text>
          </g>
        ))}
        {/* bars */}
        {data.map((v, i) => {
          const groupW = barW + (secondaryData ? barW + 4 : 0)
          const x = 44 + i * (groupW + 16)
          const h = maxVal > 0 ? (v / maxVal) * (plotH - 10) : 0
          return (
            <g key={i}>
              <rect x={x} y={plotH - h} width={barW} height={h} rx={3} fill={color} opacity={0.9} />
              {secondaryData && (
                <rect
                  x={x + barW + 4}
                  y={plotH - (maxVal > 0 ? (secondaryData[i] / maxVal) * (plotH - 10) : 0)}
                  width={barW}
                  height={maxVal > 0 ? (secondaryData[i] / maxVal) * (plotH - 10) : 0}
                  rx={3} fill={secondaryColor} opacity={0.5}
                />
              )}
              <text
                x={x + (secondaryData ? groupW / 2 : barW / 2)}
                y={chartH - 2}
                textAnchor="middle" className="fill-gray-500" fontSize={10}
              >
                {labels[i]}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/* ───────── Horizontal bar chart (for categories) ───────── */

function HorizontalBarChart({ items, valueLabel }: {
  items: { label: string; value: number; color: string }[]
  valueLabel: (v: number) => string
}) {
  const maxVal = Math.max(...items.map(i => i.value), 1)
  return (
    <div className="space-y-3">
      {items.map(item => (
        <div key={item.label}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-gray-700">{item.label}</span>
            <span className="text-sm font-bold text-gray-900">{valueLabel(item.value)}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3">
            <div
              className={`h-3 rounded-full transition-all ${item.color}`}
              style={{ width: `${Math.min((item.value / maxVal) * 100, 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

/* ───────── Margin distribution histogram ───────── */

function MarginHistogram({ quotes }: { quotes: SavedQuote[] }) {
  const buckets = [
    { label: '< 20%', min: -Infinity, max: 0.20, color: 'bg-red-500' },
    { label: '20-25%', min: 0.20, max: 0.25, color: 'bg-red-400' },
    { label: '25-27%', min: 0.25, max: 0.27, color: 'bg-orange-400' },
    { label: '27-30%', min: 0.27, max: 0.30, color: 'bg-yellow-400' },
    { label: '30-34%', min: 0.30, max: 0.34, color: 'bg-yellow-300' },
    { label: '34-38%', min: 0.34, max: 0.38, color: 'bg-green-400' },
    { label: '38-44%', min: 0.38, max: 0.44, color: 'bg-green-500' },
    { label: '> 44%', min: 0.44, max: Infinity, color: 'bg-green-600' },
  ]

  const counts = buckets.map(b => ({
    ...b,
    count: quotes.filter(q => q.gmPct >= b.min && q.gmPct < b.max).length,
  }))
  const maxCount = Math.max(...counts.map(c => c.count), 1)

  return (
    <div className="flex items-end gap-2 h-40">
      {counts.map(b => (
        <div key={b.label} className="flex-1 flex flex-col items-center">
          <span className="text-xs font-bold text-gray-700 mb-1">{b.count}</span>
          <div
            className={`w-full rounded-t ${b.color} transition-all`}
            style={{ height: `${(b.count / maxCount) * 100}%`, minHeight: b.count > 0 ? 4 : 0 }}
          />
          <span className="text-[10px] text-gray-500 mt-1 whitespace-nowrap">{b.label}</span>
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   REPORTS PAGE — TIER 1: Revenue & Margin Analysis
   ═══════════════════════════════════════════════ */

interface ReportsPageProps {
  quotes: SavedQuote[]
}

export default function ReportsPage({ quotes }: ReportsPageProps) {
  const currentYear = new Date().getFullYear()
  const years = useMemo(() => {
    const yrs = new Set<number>()
    quotes.forEach(q => { if (q.date) yrs.add(new Date(q.date).getFullYear()) })
    yrs.add(currentYear)
    return Array.from(yrs).sort((a, b) => b - a)
  }, [quotes, currentYear])

  const [year, setYear] = useState(currentYear)
  const [gran, setGran] = useState<Granularity>('monthly')
  const [section, setSection] = useState<'tier1' | 'tier2' | 'tier3' | 'tier4'>('tier1')
  const [tab, setTab] = useState<'revenue' | 'margin' | 'style' | 'deals' | 'close_rate' | 'lead_source' | 'sales_rep' | 'pipeline' | 'budget_rev' | 'budget_cost' | 'budget_overhead' | 'cust_revenue' | 'cust_repeat' | 'cust_segments'>('revenue')

  const budget = useMemo(() => loadBudget(), [])

  // Filter quotes for selected year
  const yearQuotes = useMemo(() =>
    quotes.filter(q => q.date && new Date(q.date).getFullYear() === year),
    [quotes, year]
  )
  const soldQuotes = useMemo(() => yearQuotes.filter(q => q.status === 'SOLD'), [yearQuotes])

  // Period keys for the selected year & granularity
  const periodKeys = useMemo(() => generatePeriodKeys(year, gran), [year, gran])

  // ── Revenue by period ──
  const revenueByPeriod = useMemo(() => {
    const map: Record<string, number> = {}
    periodKeys.forEach(k => { map[k] = 0 })
    soldQuotes.forEach(q => {
      const key = getPeriodKey(q.date, gran)
      if (map[key] !== undefined) map[key] += q.finalPrice
    })
    return periodKeys.map(k => map[k])
  }, [soldQuotes, periodKeys, gran])

  // Budget target by period (from seasonality)
  const budgetByPeriod = useMemo(() => {
    if (!budget) return periodKeys.map(() => 0)
    const seasonality = budget.seasonality || [1/12,1/12,1/12,1/12,1/12,1/12,1/12,1/12,1/12,1/12,1/12,1/12]
    const goal = budget.revenueGoal || 0
    if (gran === 'monthly') {
      return seasonality.map((s: number) => goal * s)
    }
    // quarterly: sum 3 months
    return [0,1,2,3].map(q =>
      seasonality.slice(q * 3, q * 3 + 3).reduce((a: number, b: number) => a + b, 0) * goal
    )
  }, [budget, periodKeys, gran])

  const periodLabels = useMemo(() =>
    periodKeys.map(k => {
      if (gran === 'monthly') return MONTHS[parseInt(k.split('-')[1]) - 1]
      return k.split('-')[1]
    }),
    [periodKeys, gran]
  )

  // ── KPIs ──
  const ytdRevenue = soldQuotes.reduce((s, q) => s + q.finalPrice, 0)
  const ytdTarget = budgetByPeriod.reduce((a, b) => a + b, 0)
  const avgMargin = soldQuotes.length > 0
    ? soldQuotes.reduce((s, q) => s + q.gmPct, 0) / soldQuotes.length : 0
  const avgDeal = soldQuotes.length > 0
    ? ytdRevenue / soldQuotes.length : 0
  const totalCOGS = soldQuotes.reduce((s, q) => s + q.totalCOGS, 0)
  const grossProfit = ytdRevenue - totalCOGS

  // ── Margin by fence style ──
  const styleBreakdown = useMemo(() => {
    const map: Record<string, { revenue: number; cogs: number; count: number }> = {}
    soldQuotes.forEach(q => {
      const cat = fenceCategory(q.fenceStyle)
      if (!map[cat]) map[cat] = { revenue: 0, cogs: 0, count: 0 }
      map[cat].revenue += q.finalPrice
      map[cat].cogs += q.totalCOGS
      map[cat].count += 1
    })
    return Object.entries(map)
      .map(([label, d]) => ({
        label,
        revenue: d.revenue,
        margin: d.revenue > 0 ? (d.revenue - d.cogs) / d.revenue : 0,
        count: d.count,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [soldQuotes])

  // ── Avg deal size by period ──
  const avgDealByPeriod = useMemo(() => {
    const revMap: Record<string, number> = {}
    const cntMap: Record<string, number> = {}
    periodKeys.forEach(k => { revMap[k] = 0; cntMap[k] = 0 })
    soldQuotes.forEach(q => {
      const key = getPeriodKey(q.date, gran)
      if (revMap[key] !== undefined) {
        revMap[key] += q.finalPrice
        cntMap[key] += 1
      }
    })
    return periodKeys.map(k => cntMap[k] > 0 ? revMap[k] / cntMap[k] : 0)
  }, [soldQuotes, periodKeys, gran])

  // ── Margin by period ──
  const marginByPeriod = useMemo(() => {
    const revMap: Record<string, number> = {}
    const cogsMap: Record<string, number> = {}
    periodKeys.forEach(k => { revMap[k] = 0; cogsMap[k] = 0 })
    soldQuotes.forEach(q => {
      const key = getPeriodKey(q.date, gran)
      if (revMap[key] !== undefined) {
        revMap[key] += q.finalPrice
        cogsMap[key] += q.totalCOGS
      }
    })
    return periodKeys.map(k => revMap[k] > 0 ? (revMap[k] - cogsMap[k]) / revMap[k] : 0)
  }, [soldQuotes, periodKeys, gran])

  // ── Quoted vs Sold by period (all statuses) ──
  const quotedByPeriod = useMemo(() => {
    const map: Record<string, number> = {}
    periodKeys.forEach(k => { map[k] = 0 })
    yearQuotes.forEach(q => {
      const key = getPeriodKey(q.date, gran)
      if (map[key] !== undefined) map[key] += q.finalPrice
    })
    return periodKeys.map(k => map[k])
  }, [yearQuotes, periodKeys, gran])

  // ═══ TIER 2: Sales Performance data ═══

  // ── Close rate by period ──
  const closeRateByPeriod = useMemo(() => {
    const soldMap: Record<string, number> = {}
    const totalMap: Record<string, number> = {}
    periodKeys.forEach(k => { soldMap[k] = 0; totalMap[k] = 0 })
    yearQuotes.forEach(q => {
      const key = getPeriodKey(q.date, gran)
      if (totalMap[key] !== undefined) {
        totalMap[key] += 1
        if (q.status === 'SOLD') soldMap[key] += 1
      }
    })
    return periodKeys.map(k => totalMap[k] > 0 ? soldMap[k] / totalMap[k] : 0)
  }, [yearQuotes, periodKeys, gran])

  // ── Lead source analysis ──
  const leadSourceBreakdown = useMemo(() => {
    const map: Record<string, { total: number; sold: number; revenue: number; avgMargin: number; marginSum: number }> = {}
    yearQuotes.forEach(q => {
      const src = q.leadSource || 'Unknown'
      if (!map[src]) map[src] = { total: 0, sold: 0, revenue: 0, avgMargin: 0, marginSum: 0 }
      map[src].total += 1
      if (q.status === 'SOLD') {
        map[src].sold += 1
        map[src].revenue += q.finalPrice
        map[src].marginSum += q.gmPct
      }
    })
    return Object.entries(map)
      .map(([source, d]) => ({
        source,
        total: d.total,
        sold: d.sold,
        closeRate: d.total > 0 ? d.sold / d.total : 0,
        revenue: d.revenue,
        avgMargin: d.sold > 0 ? d.marginSum / d.sold : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [yearQuotes])

  // ── Sales rep analysis ──
  const salesRepBreakdown = useMemo(() => {
    const map: Record<string, { total: number; sold: number; revenue: number; marginSum: number }> = {}
    yearQuotes.forEach(q => {
      const rep = q.salesRep || 'Unassigned'
      if (!map[rep]) map[rep] = { total: 0, sold: 0, revenue: 0, marginSum: 0 }
      map[rep].total += 1
      if (q.status === 'SOLD') {
        map[rep].sold += 1
        map[rep].revenue += q.finalPrice
        map[rep].marginSum += q.gmPct
      }
    })
    return Object.entries(map)
      .map(([rep, d]) => ({
        rep,
        total: d.total,
        sold: d.sold,
        closeRate: d.total > 0 ? d.sold / d.total : 0,
        revenue: d.revenue,
        avgMargin: d.sold > 0 ? d.marginSum / d.sold : 0,
        avgDeal: d.sold > 0 ? d.revenue / d.sold : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [yearQuotes])

  // ── Pipeline by status ──
  const pipelineByStatus = useMemo(() => {
    const statuses: Array<'DRAFT' | 'SENT' | 'SOLD' | 'LOST'> = ['DRAFT', 'SENT', 'SOLD', 'LOST']
    return statuses.map(status => ({
      status,
      count: yearQuotes.filter(q => q.status === status).length,
      value: yearQuotes.filter(q => q.status === status).reduce((s, q) => s + q.finalPrice, 0),
    }))
  }, [yearQuotes])

  // ── Lead temperature analysis ──
  const leadTempBreakdown = useMemo(() => {
    const temps = [1, 2, 3, 4, 5]
    return temps.map(t => {
      const qs = yearQuotes.filter(q => q.leadTemp === t)
      const sold = qs.filter(q => q.status === 'SOLD')
      return {
        temp: t,
        total: qs.length,
        sold: sold.length,
        closeRate: qs.length > 0 ? sold.length / qs.length : 0,
        revenue: sold.reduce((s, q) => s + q.finalPrice, 0),
      }
    })
  }, [yearQuotes])

  const TABS_TIER1 = [
    { key: 'revenue' as const, label: 'Revenue', icon: '💰' },
    { key: 'margin' as const, label: 'Margins', icon: '📊' },
    { key: 'style' as const, label: 'By Style', icon: '🏠' },
    { key: 'deals' as const, label: 'Deal Size', icon: '📐' },
  ]

  const TABS_TIER2 = [
    { key: 'close_rate' as const, label: 'Close Rate', icon: '🎯' },
    { key: 'lead_source' as const, label: 'Lead Sources', icon: '📡' },
    { key: 'sales_rep' as const, label: 'Sales Reps', icon: '👤' },
    { key: 'pipeline' as const, label: 'Pipeline', icon: '🔄' },
  ]

  // ═══ TIER 3: Budget Variance data ═══

  const revenueGoal = budget?.revenueGoal || 0
  const seasonality = budget?.seasonality || Array(12).fill(1 / 12) as number[]

  // Monthly budget targets from seasonality
  const monthlyBudgetTargets = useMemo(() => {
    if (gran === 'monthly') return seasonality.map((s: number) => revenueGoal * s)
    return [0, 1, 2, 3].map(q =>
      seasonality.slice(q * 3, q * 3 + 3).reduce((a: number, b: number) => a + b, 0) * revenueGoal
    )
  }, [revenueGoal, seasonality, gran])

  // Variance (actual - target) by period
  const varianceByPeriod = useMemo(() =>
    revenueByPeriod.map((actual, i) => actual - monthlyBudgetTargets[i]),
    [revenueByPeriod, monthlyBudgetTargets]
  )

  // Actual cost breakdown from sold quotes
  const actualCostBreakdown = useMemo(() => {
    const matCost = soldQuotes.reduce((s, q) => s + q.materialCost, 0)
    const labCost = soldQuotes.reduce((s, q) => s + q.laborCost, 0)
    const tearCost = soldQuotes.reduce((s, q) => s + q.tearOutCost, 0)
    return { materialCost: matCost, laborCost: labCost, tearOutCost: tearCost, totalCOGS }
  }, [soldQuotes, totalCOGS])

  // Overhead from budget
  const budgetOverhead = useMemo(() => {
    if (!budget?.overhead) return { total: 0, items: [] as { label: string; annual: number; category: string }[] }
    const parents = budget.overhead.filter(o => !o.parentId)
    const total = parents.reduce((s, o) => s + (o.annual || 0), 0)
    return {
      total,
      items: parents.map(o => ({ label: o.label, annual: o.annual || 0, category: o.category || 'Other' }))
        .sort((a, b) => b.annual - a.annual),
    }
  }, [budget])

  // Cost percentages: actual vs budget targets
  const costComparison = useMemo(() => {
    const matPct = ytdRevenue > 0 ? actualCostBreakdown.materialCost / ytdRevenue : 0
    const labPct = ytdRevenue > 0 ? actualCostBreakdown.laborCost / ytdRevenue : 0
    const overPct = ytdRevenue > 0 ? budgetOverhead.total / ytdRevenue : 0 // annualized overhead vs revenue
    const netPct = ytdRevenue > 0 ? (ytdRevenue - actualCostBreakdown.totalCOGS - budgetOverhead.total) / ytdRevenue : 0
    return {
      materials: { actual: matPct, target: budget?.materialsPct || 0.45 },
      labor: { actual: labPct, target: budget?.laborPct || 0.158 },
      overhead: { actual: overPct, target: budget?.overheadPct || 0.30 },
      netProfit: { actual: netPct, target: budget?.netProfitPct || 0.092 },
    }
  }, [ytdRevenue, actualCostBreakdown, budgetOverhead, budget])

  const TABS_TIER3 = [
    { key: 'budget_rev' as const, label: 'Revenue vs Goal', icon: '🎯' },
    { key: 'budget_cost' as const, label: 'Cost Breakdown', icon: '💸' },
    { key: 'budget_overhead' as const, label: 'Overhead', icon: '🏢' },
  ]

  // ═══ TIER 4: Customer Intelligence data ═══

  // All quotes (not just year-filtered) for lifetime analysis
  const allSoldQuotes = useMemo(() => quotes.filter(q => q.status === 'SOLD'), [quotes])

  // Customer revenue ranking (lifetime)
  const customerRevenue = useMemo(() => {
    const map: Record<string, { name: string; revenue: number; count: number; marginSum: number; firstDate: string; lastDate: string; styles: Set<string> }> = {}
    allSoldQuotes.forEach(q => {
      const key = q.customerId || q.customerName
      if (!map[key]) map[key] = { name: q.customerName, revenue: 0, count: 0, marginSum: 0, firstDate: q.date, lastDate: q.date, styles: new Set() }
      map[key].revenue += q.finalPrice
      map[key].count += 1
      map[key].marginSum += q.gmPct
      map[key].styles.add(fenceCategory(q.fenceStyle))
      if (q.date < map[key].firstDate) map[key].firstDate = q.date
      if (q.date > map[key].lastDate) map[key].lastDate = q.date
    })
    return Object.entries(map)
      .map(([id, d]) => ({
        id,
        name: d.name,
        revenue: d.revenue,
        count: d.count,
        avgMargin: d.count > 0 ? d.marginSum / d.count : 0,
        avgDeal: d.count > 0 ? d.revenue / d.count : 0,
        firstDate: d.firstDate,
        lastDate: d.lastDate,
        styles: Array.from(d.styles),
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }, [allSoldQuotes])

  // Repeat vs one-time customers
  const repeatStats = useMemo(() => {
    const repeat = customerRevenue.filter(c => c.count > 1)
    const oneTime = customerRevenue.filter(c => c.count === 1)
    return {
      repeatCount: repeat.length,
      oneTimeCount: oneTime.length,
      repeatRevenue: repeat.reduce((s, c) => s + c.revenue, 0),
      oneTimeRevenue: oneTime.reduce((s, c) => s + c.revenue, 0),
      repeatAvgDeal: repeat.length > 0 ? repeat.reduce((s, c) => s + c.avgDeal, 0) / repeat.length : 0,
      oneTimeAvgDeal: oneTime.length > 0 ? oneTime.reduce((s, c) => s + c.avgDeal, 0) / oneTime.length : 0,
    }
  }, [customerRevenue])

  // Customer segments by revenue tier
  const customerSegments = useMemo(() => {
    const tiers = [
      { label: 'VIP ($20K+)', min: 20000, max: Infinity, color: 'bg-purple-500' },
      { label: 'High ($10K–$20K)', min: 10000, max: 20000, color: 'bg-blue-500' },
      { label: 'Medium ($5K–$10K)', min: 5000, max: 10000, color: 'bg-green-500' },
      { label: 'Standard ($1K–$5K)', min: 1000, max: 5000, color: 'bg-yellow-500' },
      { label: 'Small (< $1K)', min: 0, max: 1000, color: 'bg-gray-400' },
    ]
    return tiers.map(t => {
      const custs = customerRevenue.filter(c => c.revenue >= t.min && c.revenue < t.max)
      return {
        ...t,
        count: custs.length,
        revenue: custs.reduce((s, c) => s + c.revenue, 0),
      }
    })
  }, [customerRevenue])

  const TABS_TIER4 = [
    { key: 'cust_revenue' as const, label: 'Top Customers', icon: '🏆' },
    { key: 'cust_repeat' as const, label: 'Repeat Business', icon: '🔁' },
    { key: 'cust_segments' as const, label: 'Segments', icon: '📊' },
  ]

  const styleColors = ['bg-orange-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500']

  return (
    <div className="space-y-6">

      <OptionConversionReport />

      {/* ── Header controls ── */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold text-gray-900">
            {section === 'tier1' ? 'Revenue & Margin Analysis' : section === 'tier2' ? 'Sales Performance' : section === 'tier3' ? 'Budget Variance' : 'Customer Intelligence'}
          </h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {section === 'tier1' ? 'Sold quote financials' : section === 'tier2' ? 'Close rates, lead sources & rep performance' : section === 'tier3' ? 'Actual vs budget targets' : 'Revenue per customer, repeat business & segmentation'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Year selector */}
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          {/* Granularity toggle */}
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(['monthly', 'quarterly'] as Granularity[]).map(g => (
              <button
                key={g}
                onClick={() => setGran(g)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  gran === g ? 'bg-white shadow text-gray-900 font-medium' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {g === 'monthly' ? 'Monthly' : 'Quarterly'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── KPI strip ── */}
      <div className="grid grid-cols-5 gap-4">
        {[
          {
            label: 'Revenue (Sold)',
            value: fmt(ytdRevenue),
            sub: budget ? `${fmtPct(ytdRevenue / (budget.revenueGoal || 1))} of ${fmt(budget.revenueGoal || 0)} goal` : 'No budget set',
            icon: '💰',
            color: budget && ytdRevenue >= ytdTarget ? 'text-green-600' : 'text-orange-500',
          },
          {
            label: 'Gross Profit',
            value: fmt(grossProfit),
            sub: `COGS: ${fmt(totalCOGS)}`,
            icon: '📈',
            color: 'text-green-600',
          },
          {
            label: 'Avg Gross Margin',
            value: fmtPct(avgMargin),
            sub: avgMargin >= 0.34 ? 'Above target ✓' : 'Below target ⚠',
            icon: '🎯',
            color: avgMargin >= 0.34 ? 'text-green-600' : 'text-yellow-600',
          },
          {
            label: 'Avg Deal Size',
            value: fmt(avgDeal),
            sub: `${soldQuotes.length} sold jobs`,
            icon: '📐',
            color: 'text-blue-600',
          },
          {
            label: 'Quoted Total',
            value: fmt(yearQuotes.reduce((s, q) => s + q.finalPrice, 0)),
            sub: `${yearQuotes.length} quotes created`,
            icon: '📋',
            color: 'text-purple-600',
          },
        ].map(kpi => (
          <div key={kpi.label} className="bg-white rounded-2xl border border-gray-200 p-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">{kpi.label}</p>
              <span className="text-lg">{kpi.icon}</span>
            </div>
            <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
            <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Section selector ── */}
      <div className="flex items-center gap-4">
        <div className="flex bg-gray-200 rounded-lg p-0.5">
          {([
            { key: 'tier1' as const, label: 'Revenue & Margins' },
            { key: 'tier2' as const, label: 'Sales Performance' },
            { key: 'tier3' as const, label: 'Budget Variance' },
            { key: 'tier4' as const, label: 'Customers' },
          ]).map(s => (
            <button
              key={s.key}
              onClick={() => {
                setSection(s.key)
                setTab(s.key === 'tier1' ? 'revenue' : s.key === 'tier2' ? 'close_rate' : s.key === 'tier3' ? 'budget_rev' : 'cust_revenue')
              }}
              className={`px-4 py-1.5 text-sm rounded-md transition-colors ${
                section === s.key
                  ? 'bg-white shadow text-gray-900 font-semibold'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab navigation ── */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {(section === 'tier1' ? TABS_TIER1 : section === 'tier2' ? TABS_TIER2 : section === 'tier3' ? TABS_TIER3 : TABS_TIER4).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm transition-colors ${
              tab === t.key
                ? 'bg-white shadow text-gray-900 font-medium'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}

      {tab === 'revenue' && (
        <div className="space-y-6">
          {/* Revenue vs Budget Target */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-semibold text-gray-900">Revenue vs Budget Target</h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  Sold revenue (orange) vs seasonality-adjusted budget target (gray)
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-orange-500 inline-block" /> Actual
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-gray-400 inline-block opacity-50" /> Target
                </span>
              </div>
            </div>
            <BarChart
              data={revenueByPeriod}
              secondaryData={budgetByPeriod}
              labels={periodLabels}
            />
          </div>

          {/* Quoted vs Sold */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-semibold text-gray-900">Quoted vs Sold</h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  Total quoted value (blue) vs closed/sold revenue (green)
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-blue-500 inline-block" /> Quoted
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded bg-green-500 inline-block opacity-50" /> Sold
                </span>
              </div>
            </div>
            <BarChart
              data={quotedByPeriod}
              secondaryData={revenueByPeriod}
              color="#3b82f6"
              secondaryColor="#22c55e"
              labels={periodLabels}
            />
          </div>

          {/* Cumulative revenue progress */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Cumulative Revenue Progress</h4>
            <p className="text-xs text-gray-400 mb-4">Running total of sold revenue through the year</p>
            {(() => {
              const cumActual = revenueByPeriod.reduce<number[]>((acc, v) => {
                acc.push((acc[acc.length - 1] || 0) + v)
                return acc
              }, [])
              const cumTarget = budgetByPeriod.reduce<number[]>((acc, v) => {
                acc.push((acc[acc.length - 1] || 0) + v)
                return acc
              }, [])
              const maxVal = Math.max(...cumActual, ...cumTarget, 1)
              const w = 700
              const h = 200
              const pad = 50
              const plotW = w - pad - 10
              const plotH = h - 30
              const pts = cumActual.length

              function linePoints(data: number[]): string {
                return data.map((v, i) =>
                  `${pad + (i / (pts - 1)) * plotW},${plotH - (v / maxVal) * (plotH - 10)}`
                ).join(' ')
              }

              return (
                <div className="overflow-x-auto">
                  <svg width={w} height={h} className="block">
                    {/* grid */}
                    {[0, 0.25, 0.5, 0.75, 1].map(pct => (
                      <g key={pct}>
                        <line x1={pad} y1={plotH - pct * (plotH - 10)} x2={w - 10} y2={plotH - pct * (plotH - 10)} stroke="#e5e7eb" strokeWidth={1} />
                        <text x={pad - 4} y={plotH - pct * (plotH - 10) + 4} textAnchor="end" className="fill-gray-400" fontSize={10}>
                          {fmt(maxVal * pct)}
                        </text>
                      </g>
                    ))}
                    {/* target line */}
                    <polyline points={linePoints(cumTarget)} fill="none" stroke="#94a3b8" strokeWidth={2} strokeDasharray="6 3" />
                    {/* actual line */}
                    <polyline points={linePoints(cumActual)} fill="none" stroke="#f97316" strokeWidth={2.5} />
                    {/* dots */}
                    {cumActual.map((v, i) => (
                      <circle
                        key={i}
                        cx={pad + (i / (pts - 1)) * plotW}
                        cy={plotH - (v / maxVal) * (plotH - 10)}
                        r={4} fill="#f97316"
                      />
                    ))}
                    {/* labels */}
                    {periodLabels.map((l, i) => (
                      <text
                        key={i}
                        x={pad + (i / (pts - 1)) * plotW}
                        y={h - 2}
                        textAnchor="middle" className="fill-gray-500" fontSize={10}
                      >
                        {l}
                      </text>
                    ))}
                  </svg>
                </div>
              )
            })()}
            <div className="flex items-center gap-6 mt-2 text-xs text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-6 h-0.5 bg-orange-500 inline-block" /> Actual
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-6 h-0.5 bg-gray-400 inline-block border-dashed" style={{ borderTop: '2px dashed #94a3b8', height: 0 }} /> Target
              </span>
            </div>
          </div>
        </div>
      )}

      {tab === 'margin' && (
        <div className="space-y-6">
          {/* Margin distribution */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="font-semibold text-gray-900">Gross Margin Distribution</h4>
                <p className="text-xs text-gray-400 mt-0.5">
                  How {year} sold quotes distribute across margin ranges · Target: 34%+
                </p>
              </div>
              <div className="text-right">
                <p className={`text-xl font-bold ${marginColor(avgMargin)}`}>{fmtPct(avgMargin)}</p>
                <p className="text-xs text-gray-400">avg margin</p>
              </div>
            </div>
            <MarginHistogram quotes={soldQuotes} />
            <div className="flex items-center justify-center gap-2 mt-3 text-xs text-gray-400">
              <span className="w-3 h-3 rounded bg-red-500 inline-block" /> Below 27%
              <span className="w-3 h-3 rounded bg-yellow-400 inline-block ml-2" /> 27–34%
              <span className="w-3 h-3 rounded bg-green-500 inline-block ml-2" /> 34%+ (target)
            </div>
          </div>

          {/* Margin trend by period */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Margin Trend</h4>
            <p className="text-xs text-gray-400 mb-4">Blended gross margin % by {gran === 'monthly' ? 'month' : 'quarter'}</p>
            <BarChart
              data={marginByPeriod.map(m => m * 100)}
              labels={periodLabels}
              color="#10b981"
              height={180}
              barLabel={(v) => `${v.toFixed(0)}%`}
            />
            {/* 40% target line reference */}
            <p className="text-xs text-gray-400 mt-2 text-center">
              Target: 34% · Bars represent blended GM% for each period
            </p>
          </div>

          {/* Top & bottom margin quotes */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h4 className="font-semibold text-green-700 mb-3">Top 5 Margin Quotes</h4>
              <div className="space-y-2">
                {[...soldQuotes].sort((a, b) => b.gmPct - a.gmPct).slice(0, 5).map(q => (
                  <div key={q.id} className="flex items-center justify-between py-1.5 border-b border-gray-50">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{q.customerName}</p>
                      <p className="text-xs text-gray-400">{q.fenceStyle} · {q.date}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-green-600">{fmtPct(q.gmPct)}</p>
                      <p className="text-xs text-gray-400">{fmt(q.finalPrice)}</p>
                    </div>
                  </div>
                ))}
                {soldQuotes.length === 0 && <p className="text-sm text-gray-400">No sold quotes</p>}
              </div>
            </div>
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h4 className="font-semibold text-red-600 mb-3">Bottom 5 Margin Quotes</h4>
              <div className="space-y-2">
                {[...soldQuotes].sort((a, b) => a.gmPct - b.gmPct).slice(0, 5).map(q => (
                  <div key={q.id} className="flex items-center justify-between py-1.5 border-b border-gray-50">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{q.customerName}</p>
                      <p className="text-xs text-gray-400">{q.fenceStyle} · {q.date}</p>
                    </div>
                    <div className="text-right">
                      <p className={`text-sm font-bold ${marginColor(q.gmPct)}`}>{fmtPct(q.gmPct)}</p>
                      <p className="text-xs text-gray-400">{fmt(q.finalPrice)}</p>
                    </div>
                  </div>
                ))}
                {soldQuotes.length === 0 && <p className="text-sm text-gray-400">No sold quotes</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'style' && (
        <div className="space-y-6">
          {/* Revenue by fence style */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Revenue by Fence Style</h4>
            <p className="text-xs text-gray-400 mb-4">Sold revenue breakdown by product category</p>
            <HorizontalBarChart
              items={styleBreakdown.map((s, i) => ({
                label: `${s.label} (${s.count} jobs)`,
                value: s.revenue,
                color: styleColors[i % styleColors.length],
              }))}
              valueLabel={fmt}
            />
          </div>

          {/* Margin by fence style */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Gross Margin by Style</h4>
            <p className="text-xs text-gray-400 mb-4">Which product categories are most profitable</p>
            <div className="space-y-3">
              {styleBreakdown.map(s => (
                <div key={s.label} className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-700 w-28">{s.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 relative">
                    <div
                      className={`h-5 rounded-full transition-all ${marginBg(s.margin)}`}
                      style={{ width: `${s.margin * 100}%` }}
                    />
                    {/* 40% target marker */}
                    <div className="absolute top-0 h-5 border-l-2 border-dashed border-gray-600" style={{ left: '34%' }} />
                  </div>
                  <span className={`text-sm font-bold w-14 text-right ${marginColor(s.margin)}`}>
                    {fmtPct(s.margin)}
                  </span>
                </div>
              ))}
              {styleBreakdown.length === 0 && <p className="text-sm text-gray-400">No sold quotes to analyze</p>}
            </div>
            <p className="text-xs text-gray-400 mt-3">Dashed line = target GM</p>
          </div>

          {/* Style mix table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h4 className="font-semibold text-gray-900">Product Mix Detail</h4>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Style</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Jobs</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Revenue</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">% of Total</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Avg Margin</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Avg Deal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {styleBreakdown.map(s => (
                  <tr key={s.label} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{s.label}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{s.count}</td>
                    <td className="px-6 py-3 text-right font-semibold text-gray-900">{fmt(s.revenue)}</td>
                    <td className="px-6 py-3 text-right text-gray-500">
                      {ytdRevenue > 0 ? fmtPct(s.revenue / ytdRevenue) : '0%'}
                    </td>
                    <td className={`px-6 py-3 text-right font-semibold ${marginColor(s.margin)}`}>
                      {fmtPct(s.margin)}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-700">
                      {s.count > 0 ? fmt(s.revenue / s.count) : '$0'}
                    </td>
                  </tr>
                ))}
                {styleBreakdown.length > 0 && (
                  <tr className="bg-gray-50 font-semibold">
                    <td className="px-6 py-3 text-gray-900">Total</td>
                    <td className="px-6 py-3 text-right text-gray-900">{soldQuotes.length}</td>
                    <td className="px-6 py-3 text-right text-gray-900">{fmt(ytdRevenue)}</td>
                    <td className="px-6 py-3 text-right text-gray-500">100%</td>
                    <td className={`px-6 py-3 text-right ${marginColor(avgMargin)}`}>{fmtPct(avgMargin)}</td>
                    <td className="px-6 py-3 text-right text-gray-900">{fmt(avgDeal)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'deals' && (
        <div className="space-y-6">
          {/* Avg deal size trend */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Average Deal Size Trend</h4>
            <p className="text-xs text-gray-400 mb-4">Average sold quote value by {gran === 'monthly' ? 'month' : 'quarter'}</p>
            <BarChart
              data={avgDealByPeriod}
              labels={periodLabels}
              color="#6366f1"
              height={200}
            />
          </div>

          {/* Deal size distribution */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Deal Size Distribution</h4>
            <p className="text-xs text-gray-400 mb-4">How sold deals distribute across price ranges</p>
            {(() => {
              const ranges = [
                { label: '< $1K', min: 0, max: 1000 },
                { label: '$1K–$3K', min: 1000, max: 3000 },
                { label: '$3K–$5K', min: 3000, max: 5000 },
                { label: '$5K–$10K', min: 5000, max: 10000 },
                { label: '$10K–$20K', min: 10000, max: 20000 },
                { label: '$20K+', min: 20000, max: Infinity },
              ]
              const counts = ranges.map(r => ({
                ...r,
                count: soldQuotes.filter(q => q.finalPrice >= r.min && q.finalPrice < r.max).length,
                revenue: soldQuotes.filter(q => q.finalPrice >= r.min && q.finalPrice < r.max)
                  .reduce((s, q) => s + q.finalPrice, 0),
              }))
              const maxCount = Math.max(...counts.map(c => c.count), 1)

              return (
                <div className="space-y-2">
                  {counts.map(r => (
                    <div key={r.label} className="flex items-center gap-3">
                      <span className="text-sm text-gray-600 w-20">{r.label}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-6 relative overflow-hidden">
                        <div
                          className="h-6 rounded-full bg-indigo-500 transition-all"
                          style={{ width: `${(r.count / maxCount) * 100}%` }}
                        />
                      </div>
                      <span className="text-sm font-bold text-gray-700 w-8 text-right">{r.count}</span>
                      <span className="text-sm text-gray-400 w-24 text-right">{fmt(r.revenue)}</span>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Largest deals table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h4 className="font-semibold text-gray-900">Top 10 Deals by Value</h4>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">#</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Style</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Price</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {[...soldQuotes].sort((a, b) => b.finalPrice - a.finalPrice).slice(0, 10).map((q, i) => (
                  <tr key={q.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-gray-400 font-mono">{i + 1}</td>
                    <td className="px-6 py-3 font-medium text-gray-900">{q.customerName}</td>
                    <td className="px-6 py-3 text-gray-600">{q.fenceStyle}</td>
                    <td className="px-6 py-3 text-gray-500">{q.date}</td>
                    <td className="px-6 py-3 text-right font-bold text-gray-900">{fmt(q.finalPrice)}</td>
                    <td className={`px-6 py-3 text-right font-semibold ${marginColor(q.gmPct)}`}>{fmtPct(q.gmPct)}</td>
                  </tr>
                ))}
                {soldQuotes.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">No sold quotes</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════
         TIER 2: Sales Performance
         ═══════════════════════════════════════════════ */}

      {tab === 'close_rate' && (
        <div className="space-y-6">
          {/* Close rate KPI strip */}
          <div className="grid grid-cols-4 gap-4">
            {(() => {
              const totalQ = yearQuotes.length
              const soldQ = yearQuotes.filter(q => q.status === 'SOLD').length
              const lostQ = yearQuotes.filter(q => q.status === 'LOST').length
              const openQ = yearQuotes.filter(q => q.status === 'DRAFT' || q.status === 'SENT').length
              const overallClose = totalQ > 0 ? soldQ / totalQ : 0
              return [
                { label: 'Overall Close Rate', value: fmtPct(overallClose), sub: `${soldQ} of ${totalQ} quotes`, color: overallClose >= 0.4 ? 'text-green-600' : 'text-orange-500' },
                { label: 'Open Quotes', value: String(openQ), sub: fmt(yearQuotes.filter(q => q.status === 'DRAFT' || q.status === 'SENT').reduce((s, q) => s + q.finalPrice, 0)), color: 'text-blue-600' },
                { label: 'Won', value: String(soldQ), sub: fmt(ytdRevenue), color: 'text-green-600' },
                { label: 'Lost', value: String(lostQ), sub: fmt(yearQuotes.filter(q => q.status === 'LOST').reduce((s, q) => s + q.finalPrice, 0)), color: 'text-red-500' },
              ].map(kpi => (
                <div key={kpi.label} className="bg-white rounded-2xl border border-gray-200 p-5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{kpi.label}</p>
                  <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>
                </div>
              ))
            })()}
          </div>

          {/* Close rate trend */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Close Rate Trend</h4>
            <p className="text-xs text-gray-400 mb-4">Percentage of quotes closed (SOLD) by {gran === 'monthly' ? 'month' : 'quarter'}</p>
            <BarChart
              data={closeRateByPeriod.map(r => r * 100)}
              labels={periodLabels}
              color="#10b981"
              height={180}
              barLabel={(v) => `${v.toFixed(0)}%`}
            />
          </div>

          {/* Sales funnel */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Sales Funnel</h4>
            <p className="text-xs text-gray-400 mb-4">Quote progression from created to closed</p>
            {(() => {
              const total = yearQuotes.length
              const sent = yearQuotes.filter(q => q.status !== 'DRAFT').length
              const sold = yearQuotes.filter(q => q.status === 'SOLD').length
              const stages = [
                { label: 'Quotes Created', count: total, color: 'bg-blue-500' },
                { label: 'Sent to Customer', count: sent, color: 'bg-indigo-500' },
                { label: 'Closed / Won', count: sold, color: 'bg-green-500' },
              ]
              return (
                <div className="space-y-3">
                  {stages.map(s => (
                    <div key={s.label} className="flex items-center gap-4">
                      <span className="text-sm text-gray-600 w-40">{s.label}</span>
                      <div className="flex-1 bg-gray-100 rounded-full h-8 relative overflow-hidden">
                        <div
                          className={`h-8 rounded-full ${s.color} transition-all flex items-center justify-end pr-3`}
                          style={{ width: `${total > 0 ? (s.count / total) * 100 : 0}%`, minWidth: s.count > 0 ? 60 : 0 }}
                        >
                          <span className="text-white text-sm font-bold">{s.count}</span>
                        </div>
                      </div>
                      <span className="text-sm text-gray-500 w-16 text-right">
                        {total > 0 ? fmtPct(s.count / total) : '0%'}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Lead temperature vs close rate */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Lead Temperature vs Close Rate</h4>
            <p className="text-xs text-gray-400 mb-4">Does a hotter lead actually close more often?</p>
            <div className="space-y-3">
              {leadTempBreakdown.map(lt => {
                const flames = '🔥'.repeat(lt.temp)
                const labels = ['Cold', 'Cool', 'Warm', 'Hot', 'On Fire']
                return (
                  <div key={lt.temp} className="flex items-center gap-4">
                    <span className="w-28 text-sm">
                      {flames} <span className="text-gray-500">{labels[lt.temp - 1]}</span>
                    </span>
                    <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                      <div
                        className="h-5 rounded-full bg-orange-500 transition-all"
                        style={{ width: `${lt.closeRate * 100}%` }}
                      />
                    </div>
                    <span className="text-sm font-bold text-gray-700 w-14 text-right">{fmtPct(lt.closeRate)}</span>
                    <span className="text-xs text-gray-400 w-20 text-right">{lt.sold}/{lt.total} quotes</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'lead_source' && (
        <div className="space-y-6">
          {/* Lead source revenue chart */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Revenue by Lead Source</h4>
            <p className="text-xs text-gray-400 mb-4">Which marketing channels drive the most closed revenue</p>
            <HorizontalBarChart
              items={leadSourceBreakdown.map((s, i) => ({
                label: s.source,
                value: s.revenue,
                color: ['bg-orange-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500', 'bg-yellow-500'][i % 8],
              }))}
              valueLabel={fmt}
            />
          </div>

          {/* Lead source conversion */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Conversion Rate by Source</h4>
            <p className="text-xs text-gray-400 mb-4">Close rate for each lead source</p>
            <div className="space-y-3">
              {[...leadSourceBreakdown].sort((a, b) => b.closeRate - a.closeRate).map(s => (
                <div key={s.source} className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-700 w-36 truncate">{s.source}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-5 relative overflow-hidden">
                    <div
                      className={`h-5 rounded-full transition-all ${s.closeRate >= 0.4 ? 'bg-green-500' : s.closeRate >= 0.25 ? 'bg-yellow-500' : 'bg-red-400'}`}
                      style={{ width: `${s.closeRate * 100}%` }}
                    />
                  </div>
                  <span className="text-sm font-bold text-gray-700 w-14 text-right">{fmtPct(s.closeRate)}</span>
                  <span className="text-xs text-gray-400 w-20 text-right">{s.sold}/{s.total}</span>
                </div>
              ))}
              {leadSourceBreakdown.length === 0 && <p className="text-sm text-gray-400">No quotes with lead source data</p>}
            </div>
          </div>

          {/* Lead source full table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h4 className="font-semibold text-gray-900">Lead Source Detail</h4>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Source</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Quotes</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Sold</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Close Rate</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Revenue</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Avg Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {leadSourceBreakdown.map(s => (
                  <tr key={s.source} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{s.source}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{s.total}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{s.sold}</td>
                    <td className={`px-6 py-3 text-right font-semibold ${s.closeRate >= 0.4 ? 'text-green-600' : s.closeRate >= 0.25 ? 'text-yellow-600' : 'text-red-500'}`}>
                      {fmtPct(s.closeRate)}
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-gray-900">{fmt(s.revenue)}</td>
                    <td className={`px-6 py-3 text-right font-semibold ${marginColor(s.avgMargin)}`}>
                      {s.sold > 0 ? fmtPct(s.avgMargin) : '—'}
                    </td>
                  </tr>
                ))}
                {leadSourceBreakdown.length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">No quotes</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'sales_rep' && (
        <div className="space-y-6">
          {/* Rep KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {salesRepBreakdown.map(r => (
              <div key={r.rep} className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-sm">
                    {r.rep.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-900">{r.rep}</p>
                    <p className="text-xs text-gray-400">{r.total} quotes · {r.sold} sold</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-400">Revenue</p>
                    <p className="text-lg font-bold text-gray-900">{fmt(r.revenue)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Close Rate</p>
                    <p className={`text-lg font-bold ${r.closeRate >= 0.4 ? 'text-green-600' : 'text-orange-500'}`}>{fmtPct(r.closeRate)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Avg Deal</p>
                    <p className="text-sm font-semibold text-gray-700">{r.sold > 0 ? fmt(r.avgDeal) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-400">Avg Margin</p>
                    <p className={`text-sm font-semibold ${marginColor(r.avgMargin)}`}>{r.sold > 0 ? fmtPct(r.avgMargin) : '—'}</p>
                  </div>
                </div>
              </div>
            ))}
            {salesRepBreakdown.length === 0 && (
              <div className="col-span-3 bg-white rounded-2xl border border-gray-200 p-8 text-center text-gray-400">
                No quotes with sales rep data
              </div>
            )}
          </div>

          {/* Rep comparison table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h4 className="font-semibold text-gray-900">Sales Rep Comparison</h4>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Rep</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Quotes</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Sold</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Close Rate</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Revenue</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Avg Deal</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Avg Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {salesRepBreakdown.map(r => (
                  <tr key={r.rep} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{r.rep}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{r.total}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{r.sold}</td>
                    <td className={`px-6 py-3 text-right font-semibold ${r.closeRate >= 0.4 ? 'text-green-600' : 'text-orange-500'}`}>
                      {fmtPct(r.closeRate)}
                    </td>
                    <td className="px-6 py-3 text-right font-bold text-gray-900">{fmt(r.revenue)}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{r.sold > 0 ? fmt(r.avgDeal) : '—'}</td>
                    <td className={`px-6 py-3 text-right font-semibold ${marginColor(r.avgMargin)}`}>
                      {r.sold > 0 ? fmtPct(r.avgMargin) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Revenue by rep bar chart */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Revenue by Rep</h4>
            <p className="text-xs text-gray-400 mb-4">Total closed revenue per sales rep</p>
            <HorizontalBarChart
              items={salesRepBreakdown.map((r, i) => ({
                label: r.rep,
                value: r.revenue,
                color: ['bg-orange-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500'][i % 5],
              }))}
              valueLabel={fmt}
            />
          </div>
        </div>
      )}

      {tab === 'pipeline' && (
        <div className="space-y-6">
          {/* Pipeline status cards */}
          <div className="grid grid-cols-4 gap-4">
            {pipelineByStatus.map(p => {
              const colors: Record<string, string> = {
                DRAFT: 'border-gray-300 bg-gray-50',
                SENT: 'border-blue-300 bg-blue-50',
                SOLD: 'border-green-300 bg-green-50',
                LOST: 'border-red-300 bg-red-50',
              }
              const textColors: Record<string, string> = {
                DRAFT: 'text-gray-700',
                SENT: 'text-blue-700',
                SOLD: 'text-green-700',
                LOST: 'text-red-700',
              }
              return (
                <div key={p.status} className={`rounded-2xl border-2 p-5 ${colors[p.status]}`}>
                  <p className={`text-xs font-semibold uppercase tracking-wide ${textColors[p.status]}`}>{p.status}</p>
                  <p className={`text-3xl font-bold mt-2 ${textColors[p.status]}`}>{p.count}</p>
                  <p className="text-sm font-semibold text-gray-700 mt-1">{fmt(p.value)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {p.count > 0 ? `Avg: ${fmt(p.value / p.count)}` : 'No quotes'}
                  </p>
                </div>
              )
            })}
          </div>

          {/* Pipeline value waterfall */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Pipeline Value by Status</h4>
            <p className="text-xs text-gray-400 mb-4">Total quote value in each stage</p>
            <BarChart
              data={pipelineByStatus.map(p => p.value)}
              labels={pipelineByStatus.map(p => p.status)}
              color="#f97316"
              height={200}
            />
          </div>

          {/* Win/loss breakdown */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h4 className="font-semibold text-gray-900 mb-3">Win/Loss Ratio</h4>
              {(() => {
                const won = yearQuotes.filter(q => q.status === 'SOLD').length
                const lost = yearQuotes.filter(q => q.status === 'LOST').length
                const decided = won + lost
                const winPct = decided > 0 ? won / decided : 0
                return (
                  <div>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-3xl font-bold text-green-600">{won}</span>
                      <span className="text-xl text-gray-300">:</span>
                      <span className="text-3xl font-bold text-red-500">{lost}</span>
                    </div>
                    <div className="w-full bg-red-200 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-4 bg-green-500 rounded-l-full transition-all"
                        style={{ width: `${winPct * 100}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-xs text-green-600 font-semibold">Won {fmtPct(winPct)}</span>
                      <span className="text-xs text-red-500 font-semibold">Lost {fmtPct(1 - winPct)}</span>
                    </div>
                    <p className="text-xs text-gray-400 mt-2">{decided} decided quotes · {yearQuotes.filter(q => q.status === 'DRAFT' || q.status === 'SENT').length} still open</p>
                  </div>
                )
              })()}
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h4 className="font-semibold text-gray-900 mb-3">Avg Value: Won vs Lost</h4>
              {(() => {
                const wonQs = yearQuotes.filter(q => q.status === 'SOLD')
                const lostQs = yearQuotes.filter(q => q.status === 'LOST')
                const avgWon = wonQs.length > 0 ? wonQs.reduce((s, q) => s + q.finalPrice, 0) / wonQs.length : 0
                const avgLost = lostQs.length > 0 ? lostQs.reduce((s, q) => s + q.finalPrice, 0) / lostQs.length : 0
                const maxAvg = Math.max(avgWon, avgLost, 1)
                return (
                  <div className="space-y-4 mt-2">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-green-700 font-medium">Won ({wonQs.length})</span>
                        <span className="text-sm font-bold text-green-700">{fmt(avgWon)}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-4">
                        <div className="h-4 rounded-full bg-green-500" style={{ width: `${(avgWon / maxAvg) * 100}%` }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-red-600 font-medium">Lost ({lostQs.length})</span>
                        <span className="text-sm font-bold text-red-600">{fmt(avgLost)}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-4">
                        <div className="h-4 rounded-full bg-red-400" style={{ width: `${(avgLost / maxAvg) * 100}%` }} />
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">
                      {avgWon > avgLost
                        ? 'Won deals average higher value — good sign'
                        : avgLost > avgWon
                        ? 'Lost deals average higher — may be pricing out on larger jobs'
                        : 'Similar average values'}
                    </p>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ═════════════════��═════════════════════════════
         TIER 3: Budget Variance
         ════════════════════════════���══════════════════ */}

      {tab === 'budget_rev' && (
        <div className="space-y-6">
          {/* Revenue vs Goal KPIs */}
          <div className="grid grid-cols-4 gap-4">
            {(() => {
              const pctOfGoal = revenueGoal > 0 ? ytdRevenue / revenueGoal : 0
              const ytdBudgetTarget = monthlyBudgetTargets.reduce((a, b) => a + b, 0)
              const variance = ytdRevenue - ytdBudgetTarget
              const onTrack = variance >= 0
              return [
                { label: 'Annual Goal', value: fmt(revenueGoal), sub: `${fmtPct(pctOfGoal)} achieved`, color: 'text-gray-900' },
                { label: 'YTD Revenue', value: fmt(ytdRevenue), sub: `${soldQuotes.length} sold jobs`, color: pctOfGoal >= 0.5 ? 'text-green-600' : 'text-orange-500' },
                { label: 'YTD Target', value: fmt(ytdBudgetTarget), sub: 'Seasonality-adjusted', color: 'text-blue-600' },
                { label: 'Variance', value: `${variance >= 0 ? '+' : ''}${fmt(variance)}`, sub: onTrack ? 'Ahead of target' : 'Behind target', color: onTrack ? 'text-green-600' : 'text-red-500' },
              ].map(kpi => (
                <div key={kpi.label} className="bg-white rounded-2xl border border-gray-200 p-5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{kpi.label}</p>
                  <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>
                </div>
              ))
            })()}
          </div>

          {/* Actual vs Target by period with variance */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Revenue: Actual vs Seasonality Target</h4>
            <p className="text-xs text-gray-400 mb-4">Orange = actual, gray = target based on your budget seasonality curve</p>
            <BarChart
              data={revenueByPeriod}
              secondaryData={monthlyBudgetTargets}
              labels={periodLabels}
            />
          </div>

          {/* Variance chart */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Variance (Actual - Target)</h4>
            <p className="text-xs text-gray-400 mb-4">Positive = ahead, negative = behind target</p>
            <div className="space-y-2">
              {varianceByPeriod.map((v, i) => (
                <div key={periodLabels[i]} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 w-12">{periodLabels[i]}</span>
                  <div className="flex-1 flex items-center">
                    <div className="w-1/2 flex justify-end">
                      {v < 0 && (
                        <div
                          className="h-5 bg-red-400 rounded-l"
                          style={{ width: `${Math.min(Math.abs(v) / (Math.max(...varianceByPeriod.map(Math.abs), 1)) * 100, 100)}%` }}
                        />
                      )}
                    </div>
                    <div className="w-px h-5 bg-gray-400" />
                    <div className="w-1/2">
                      {v > 0 && (
                        <div
                          className="h-5 bg-green-500 rounded-r"
                          style={{ width: `${Math.min(Math.abs(v) / (Math.max(...varianceByPeriod.map(Math.abs), 1)) * 100, 100)}%` }}
                        />
                      )}
                    </div>
                  </div>
                  <span className={`text-sm font-bold w-20 text-right ${v >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {v >= 0 ? '+' : ''}{fmt(v)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Goal progress bar */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-3">Annual Goal Progress</h4>
            <div className="relative">
              <div className="w-full bg-gray-100 rounded-full h-6 overflow-hidden">
                <div
                  className="h-6 rounded-full bg-orange-500 transition-all"
                  style={{ width: `${Math.min((ytdRevenue / (revenueGoal || 1)) * 100, 100)}%` }}
                />
              </div>
              {/* Month marker */}
              <div
                className="absolute top-0 h-6 border-l-2 border-dashed border-gray-600"
                style={{ left: `${((new Date().getMonth() + 1) / 12) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-xs text-gray-400">$0</span>
              <span className="text-xs text-gray-500 font-medium">
                Dashed line = where you should be ({MONTHS[new Date().getMonth()]})
              </span>
              <span className="text-xs text-gray-400">{fmt(revenueGoal)}</span>
            </div>
          </div>
        </div>
      )}

      {tab === 'budget_cost' && (
        <div className="space-y-6">
          {/* Budget bucket comparison */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Budget Buckets: Actual vs Target</h4>
            <p className="text-xs text-gray-400 mb-4">How your actual cost ratios compare to budget allocations</p>
            <div className="space-y-5">
              {[
                { label: 'Materials', actual: costComparison.materials.actual, target: costComparison.materials.target, amount: actualCostBreakdown.materialCost },
                { label: 'Labor', actual: costComparison.labor.actual, target: costComparison.labor.target, amount: actualCostBreakdown.laborCost },
                { label: 'Overhead', actual: costComparison.overhead.actual, target: costComparison.overhead.target, amount: budgetOverhead.total },
                { label: 'Net Profit', actual: costComparison.netProfit.actual, target: costComparison.netProfit.target, amount: ytdRevenue - actualCostBreakdown.totalCOGS - budgetOverhead.total },
              ].map(b => {
                const diff = b.actual - b.target
                const isProfit = b.label === 'Net Profit'
                // For costs, under target is good. For profit, over target is good.
                const isGood = isProfit ? diff >= -0.02 : diff <= 0.02
                return (
                  <div key={b.label}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold text-gray-900">{b.label}</span>
                      <div className="flex items-center gap-4">
                        <span className="text-xs text-gray-400">Target: {fmtPct(b.target)}</span>
                        <span className={`text-sm font-bold ${isGood ? 'text-green-600' : 'text-red-500'}`}>
                          {fmtPct(b.actual)}
                        </span>
                        <span className="text-xs text-gray-500">{fmt(b.amount)}</span>
                      </div>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-4 relative">
                      {/* Target marker */}
                      <div
                        className="absolute top-0 h-4 border-l-2 border-dashed border-gray-600 z-10"
                        style={{ left: `${Math.min(b.target * 100, 100)}%` }}
                      />
                      {/* Actual bar */}
                      <div
                        className={`h-4 rounded-full transition-all ${isGood ? 'bg-green-500' : 'bg-red-400'}`}
                        style={{ width: `${Math.min(b.actual * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-gray-400 mt-3">Dashed line = budget target percentage</p>
          </div>

          {/* Cost breakdown pie-like display */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h4 className="font-semibold text-gray-900 mb-3">Cost Breakdown (Sold Jobs)</h4>
              <div className="space-y-3">
                {[
                  { label: 'Materials', value: actualCostBreakdown.materialCost, color: 'bg-blue-500' },
                  { label: 'Labor', value: actualCostBreakdown.laborCost, color: 'bg-orange-500' },
                  { label: 'Tear-Out', value: actualCostBreakdown.tearOutCost, color: 'bg-purple-500' },
                ].map(item => (
                  <div key={item.label}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-gray-700 flex items-center gap-2">
                        <span className={`w-3 h-3 rounded ${item.color} inline-block`} />
                        {item.label}
                      </span>
                      <span className="text-sm font-bold text-gray-900">{fmt(item.value)}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full ${item.color}`}
                        style={{ width: `${totalCOGS > 0 ? (item.value / totalCOGS) * 100 : 0}%` }}
                      />
                    </div>
                  </div>
                ))}
                <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                  <span className="text-sm font-semibold text-gray-900">Total COGS</span>
                  <span className="text-sm font-bold text-gray-900">{fmt(totalCOGS)}</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 p-6">
              <h4 className="font-semibold text-gray-900 mb-3">Magic Number Check</h4>
              {(() => {
                const overheadPct = budget?.overheadPct || 0.30
                const netProfitPct = budget?.netProfitPct || 0.092
                const magic = 1 - overheadPct - netProfitPct
                const actualMagic = ytdRevenue > 0 ? totalCOGS / ytdRevenue : 0
                const isHealthy = actualMagic <= magic + 0.02
                return (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Budget Magic Number</span>
                      <span className="text-lg font-bold text-gray-900">{fmtPct(magic)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Actual COGS %</span>
                      <span className={`text-lg font-bold ${isHealthy ? 'text-green-600' : 'text-red-500'}`}>{fmtPct(actualMagic)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-500">Variance</span>
                      <span className={`text-lg font-bold ${isHealthy ? 'text-green-600' : 'text-red-500'}`}>
                        {(actualMagic - magic) >= 0 ? '+' : ''}{fmtPct(actualMagic - magic)}
                      </span>
                    </div>
                    <div className={`p-3 rounded-lg text-sm ${isHealthy ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
                      {isHealthy
                        ? 'COGS is within range of your magic number — pricing is on track.'
                        : 'COGS exceeds your magic number — review pricing or cost structure.'}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>
        </div>
      )}

      {tab === 'budget_overhead' && (
        <div className="space-y-6">
          {/* Overhead summary */}
          <div className="grid grid-cols-3 gap-4">
            {(() => {
              const overPctTarget = budget?.overheadPct || 0.30
              const actualPct = ytdRevenue > 0 ? budgetOverhead.total / ytdRevenue : 0
              const isOk = actualPct <= overPctTarget + 0.02
              return [
                { label: 'Total Overhead', value: fmt(budgetOverhead.total), sub: 'Annual from chart of accounts', color: 'text-gray-900' },
                { label: 'Overhead % of Revenue', value: fmtPct(actualPct), sub: `Target: ${fmtPct(overPctTarget)}`, color: isOk ? 'text-green-600' : 'text-red-500' },
                { label: 'Monthly Avg', value: fmt(budgetOverhead.total / 12), sub: `${budgetOverhead.items.length} expense categories`, color: 'text-blue-600' },
              ].map(kpi => (
                <div key={kpi.label} className="bg-white rounded-2xl border border-gray-200 p-5">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{kpi.label}</p>
                  <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                  <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>
                </div>
              ))
            })()}
          </div>

          {/* Overhead by category */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Overhead by Category</h4>
            <p className="text-xs text-gray-400 mb-4">Top-level expense categories from your chart of accounts</p>
            <HorizontalBarChart
              items={budgetOverhead.items.map((item, i) => ({
                label: item.label,
                value: item.annual,
                color: ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-blue-500', 'bg-indigo-500', 'bg-purple-500', 'bg-pink-500'][i % 8],
              }))}
              valueLabel={fmt}
            />
          </div>

          {/* Overhead detail table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h4 className="font-semibold text-gray-900">Overhead Detail</h4>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Category</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Type</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Annual</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Monthly</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">% of Overhead</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {budgetOverhead.items.map(item => (
                  <tr key={item.label} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{item.label}</td>
                    <td className="px-6 py-3 text-gray-500">{item.category}</td>
                    <td className="px-6 py-3 text-right font-semibold text-gray-900">{fmt(item.annual)}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{fmt(item.annual / 12)}</td>
                    <td className="px-6 py-3 text-right text-gray-500">
                      {budgetOverhead.total > 0 ? fmtPct(item.annual / budgetOverhead.total) : '0%'}
                    </td>
                  </tr>
                ))}
                {budgetOverhead.items.length > 0 && (
                  <tr className="bg-gray-50 font-semibold">
                    <td className="px-6 py-3 text-gray-900">Total</td>
                    <td className="px-6 py-3" />
                    <td className="px-6 py-3 text-right text-gray-900">{fmt(budgetOverhead.total)}</td>
                    <td className="px-6 py-3 text-right text-gray-900">{fmt(budgetOverhead.total / 12)}</td>
                    <td className="px-6 py-3 text-right text-gray-500">100%</td>
                  </tr>
                )}
                {budgetOverhead.items.length === 0 && (
                  <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400">No overhead data — set up in Budget module</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════
         TIER 4: Customer Intelligence
         ═══════════════════════════════════════════════ */}

      {tab === 'cust_revenue' && (
        <div className="space-y-6">
          {/* Customer KPIs */}
          <div className="grid grid-cols-4 gap-4">
            {[
              { label: 'Total Customers', value: String(customerRevenue.length), sub: 'with sold quotes', color: 'text-blue-600' },
              { label: 'Total Lifetime Revenue', value: fmt(allSoldQuotes.reduce((s, q) => s + q.finalPrice, 0)), sub: `${allSoldQuotes.length} sold jobs`, color: 'text-green-600' },
              { label: 'Avg Revenue / Customer', value: fmt(customerRevenue.length > 0 ? allSoldQuotes.reduce((s, q) => s + q.finalPrice, 0) / customerRevenue.length : 0), sub: 'lifetime average', color: 'text-purple-600' },
              { label: 'Avg Jobs / Customer', value: customerRevenue.length > 0 ? (allSoldQuotes.length / customerRevenue.length).toFixed(1) : '0', sub: 'repeat factor', color: 'text-orange-500' },
            ].map(kpi => (
              <div key={kpi.label} className="bg-white rounded-2xl border border-gray-200 p-5">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{kpi.label}</p>
                <p className={`text-2xl font-bold ${kpi.color}`}>{kpi.value}</p>
                <p className="text-xs text-gray-400 mt-1">{kpi.sub}</p>
              </div>
            ))}
          </div>

          {/* Top customers table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h4 className="font-semibold text-gray-900">Top 20 Customers by Revenue</h4>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">#</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Jobs</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Revenue</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Avg Deal</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Avg Margin</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Styles</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customerRevenue.slice(0, 20).map((c, i) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 text-gray-400 font-mono">{i + 1}</td>
                    <td className="px-6 py-3 font-medium text-gray-900">
                      {c.name}
                      {c.count > 1 && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Repeat</span>}
                    </td>
                    <td className="px-6 py-3 text-right text-gray-700">{c.count}</td>
                    <td className="px-6 py-3 text-right font-bold text-gray-900">{fmt(c.revenue)}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{fmt(c.avgDeal)}</td>
                    <td className={`px-6 py-3 text-right font-semibold ${marginColor(c.avgMargin)}`}>{fmtPct(c.avgMargin)}</td>
                    <td className="px-6 py-3 text-gray-500 text-xs">{c.styles.join(', ')}</td>
                  </tr>
                ))}
                {customerRevenue.length === 0 && (
                  <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">No sold quotes</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Revenue concentration */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Revenue Concentration</h4>
            <p className="text-xs text-gray-400 mb-4">What percentage of revenue comes from your top customers</p>
            {(() => {
              const totalRev = customerRevenue.reduce((s, c) => s + c.revenue, 0)
              const tiers = [
                { label: 'Top 5 customers', count: 5 },
                { label: 'Top 10 customers', count: 10 },
                { label: 'Top 20 customers', count: 20 },
              ]
              return (
                <div className="space-y-3">
                  {tiers.map(t => {
                    const tierRev = customerRevenue.slice(0, t.count).reduce((s, c) => s + c.revenue, 0)
                    const pct = totalRev > 0 ? tierRev / totalRev : 0
                    return (
                      <div key={t.label}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm text-gray-700">{t.label}</span>
                          <span className="text-sm font-bold text-gray-900">{fmtPct(pct)} ({fmt(tierRev)})</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-3">
                          <div className="h-3 rounded-full bg-purple-500 transition-all" style={{ width: `${pct * 100}%` }} />
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {tab === 'cust_repeat' && (
        <div className="space-y-6">
          {/* Repeat vs one-time */}
          <div className="grid grid-cols-2 gap-6">
            <div className="bg-white rounded-2xl border-2 border-blue-200 p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">🔁</span>
                <h4 className="font-semibold text-blue-900">Repeat Customers</h4>
              </div>
              <p className="text-3xl font-bold text-blue-700">{repeatStats.repeatCount}</p>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Total Revenue</span>
                  <span className="text-sm font-bold text-gray-900">{fmt(repeatStats.repeatRevenue)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Avg Deal Size</span>
                  <span className="text-sm font-bold text-gray-900">{fmt(repeatStats.repeatAvgDeal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">% of Customers</span>
                  <span className="text-sm font-bold text-blue-700">
                    {customerRevenue.length > 0 ? fmtPct(repeatStats.repeatCount / customerRevenue.length) : '0%'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">% of Revenue</span>
                  <span className="text-sm font-bold text-blue-700">
                    {(repeatStats.repeatRevenue + repeatStats.oneTimeRevenue) > 0
                      ? fmtPct(repeatStats.repeatRevenue / (repeatStats.repeatRevenue + repeatStats.oneTimeRevenue))
                      : '0%'}
                  </span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border-2 border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-lg">1️⃣</span>
                <h4 className="font-semibold text-gray-900">One-Time Customers</h4>
              </div>
              <p className="text-3xl font-bold text-gray-700">{repeatStats.oneTimeCount}</p>
              <div className="mt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Total Revenue</span>
                  <span className="text-sm font-bold text-gray-900">{fmt(repeatStats.oneTimeRevenue)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">Avg Deal Size</span>
                  <span className="text-sm font-bold text-gray-900">{fmt(repeatStats.oneTimeAvgDeal)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">% of Customers</span>
                  <span className="text-sm font-bold text-gray-700">
                    {customerRevenue.length > 0 ? fmtPct(repeatStats.oneTimeCount / customerRevenue.length) : '0%'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500">% of Revenue</span>
                  <span className="text-sm font-bold text-gray-700">
                    {(repeatStats.repeatRevenue + repeatStats.oneTimeRevenue) > 0
                      ? fmtPct(repeatStats.oneTimeRevenue / (repeatStats.repeatRevenue + repeatStats.oneTimeRevenue))
                      : '0%'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Repeat customers list */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h4 className="font-semibold text-gray-900">Repeat Customers</h4>
              <p className="text-xs text-gray-400 mt-0.5">Customers with 2+ sold jobs</p>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Customer</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Jobs</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Lifetime Revenue</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Avg Deal</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">First Job</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Last Job</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customerRevenue.filter(c => c.count > 1).map(c => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-6 py-3 text-right font-bold text-blue-700">{c.count}</td>
                    <td className="px-6 py-3 text-right font-bold text-gray-900">{fmt(c.revenue)}</td>
                    <td className="px-6 py-3 text-right text-gray-700">{fmt(c.avgDeal)}</td>
                    <td className="px-6 py-3 text-gray-500">{c.firstDate}</td>
                    <td className="px-6 py-3 text-gray-500">{c.lastDate}</td>
                  </tr>
                ))}
                {customerRevenue.filter(c => c.count > 1).length === 0 && (
                  <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">No repeat customers yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'cust_segments' && (
        <div className="space-y-6">
          {/* Segment cards */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Customer Segments by Revenue Tier</h4>
            <p className="text-xs text-gray-400 mb-4">Customers grouped by their total lifetime spend</p>
            <div className="space-y-4">
              {customerSegments.map(seg => (
                <div key={seg.label} className="flex items-center gap-4">
                  <span className="text-sm font-medium text-gray-700 w-40">{seg.label}</span>
                  <div className="flex-1 bg-gray-100 rounded-full h-6 relative overflow-hidden">
                    <div
                      className={`h-6 rounded-full ${seg.color} transition-all flex items-center px-3`}
                      style={{ width: `${customerRevenue.length > 0 ? Math.max((seg.count / customerRevenue.length) * 100, seg.count > 0 ? 8 : 0) : 0}%` }}
                    >
                      {seg.count > 0 && <span className="text-white text-xs font-bold">{seg.count}</span>}
                    </div>
                  </div>
                  <span className="text-sm text-gray-700 w-24 text-right">{fmt(seg.revenue)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Segment detail table */}
          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h4 className="font-semibold text-gray-900">Segment Summary</h4>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase">Segment</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Customers</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">% of Customers</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Revenue</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">% of Revenue</th>
                  <th className="px-6 py-3 text-xs font-semibold text-gray-500 uppercase text-right">Avg / Customer</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {customerSegments.map(seg => {
                  const totalRev = customerRevenue.reduce((s, c) => s + c.revenue, 0)
                  return (
                    <tr key={seg.label} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium text-gray-900 flex items-center gap-2">
                        <span className={`w-3 h-3 rounded ${seg.color} inline-block`} />
                        {seg.label}
                      </td>
                      <td className="px-6 py-3 text-right text-gray-700">{seg.count}</td>
                      <td className="px-6 py-3 text-right text-gray-500">
                        {customerRevenue.length > 0 ? fmtPct(seg.count / customerRevenue.length) : '0%'}
                      </td>
                      <td className="px-6 py-3 text-right font-bold text-gray-900">{fmt(seg.revenue)}</td>
                      <td className="px-6 py-3 text-right text-gray-500">
                        {totalRev > 0 ? fmtPct(seg.revenue / totalRev) : '0%'}
                      </td>
                      <td className="px-6 py-3 text-right text-gray-700">
                        {seg.count > 0 ? fmt(seg.revenue / seg.count) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Lead source by customer count */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6">
            <h4 className="font-semibold text-gray-900 mb-1">Customer Acquisition by Lead Source</h4>
            <p className="text-xs text-gray-400 mb-4">How many unique customers came from each source (all-time)</p>
            {(() => {
              const srcMap: Record<string, Set<string>> = {}
              allSoldQuotes.forEach(q => {
                const src = q.leadSource || 'Unknown'
                if (!srcMap[src]) srcMap[src] = new Set()
                srcMap[src].add(q.customerId || q.customerName)
              })
              const srcData = Object.entries(srcMap)
                .map(([source, ids]) => ({ source, count: ids.size }))
                .sort((a, b) => b.count - a.count)

              return (
                <HorizontalBarChart
                  items={srcData.map((s, i) => ({
                    label: `${s.source} (${s.count})`,
                    value: s.count,
                    color: ['bg-orange-500', 'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-pink-500', 'bg-indigo-500'][i % 6],
                  }))}
                  valueLabel={(v) => `${v} customers`}
                />
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}

/* ───────── Option Conversion Report ───────── */

function OptionConversionReport() {
  const options = useMemo(() => getOptions(), [])
  if (options.length === 0) return null

  // Group by quoteId
  const byQuote = new Map<string, typeof options>()
  for (const o of options) {
    if (!byQuote.has(o.quoteId)) byQuote.set(o.quoteId, [])
    byQuote.get(o.quoteId)!.push(o)
  }

  const multiOptionQuotes = Array.from(byQuote.values()).filter(opts => opts.length > 1)
  const acceptedByTier = new Map<string, number>()
  const revenueByTier = new Map<string, number>()
  let totalPresented = 0
  let totalAccepted = 0

  for (const opts of multiOptionQuotes) {
    totalPresented++
    const accepted = opts.find(o => o.status === 'accepted')
    if (accepted) {
      totalAccepted++
      const tier = accepted.tierLabel.toLowerCase()
      acceptedByTier.set(tier, (acceptedByTier.get(tier) || 0) + 1)
      revenueByTier.set(tier, (revenueByTier.get(tier) || 0) + accepted.quotePriceCents)
    }
  }

  const conversionRate = totalPresented > 0 ? totalAccepted / totalPresented : 0
  const avgTier = totalAccepted > 0
    ? Array.from(acceptedByTier.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : '—'

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">Good / Better / Best — Option Conversion</h3>
          <p className="text-xs text-gray-500 mt-0.5">Of quotes where multiple options were presented, conversion rate and tier preference.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs uppercase text-gray-500 font-semibold">Quotes w/ Options</p><p className="text-2xl font-bold text-gray-900 mt-1">{totalPresented}</p></div>
        <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs uppercase text-gray-500 font-semibold">Accepted</p><p className="text-2xl font-bold text-green-700 mt-1">{totalAccepted}</p></div>
        <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs uppercase text-gray-500 font-semibold">Conversion</p><p className="text-2xl font-bold text-orange-600 mt-1">{(conversionRate * 100).toFixed(1)}%</p></div>
        <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs uppercase text-gray-500 font-semibold">Top Tier</p><p className="text-2xl font-bold text-gray-900 mt-1 capitalize">{avgTier}</p></div>
      </div>
      {totalAccepted > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {(['good', 'better', 'best'] as const).map(tier => {
            const count = acceptedByTier.get(tier) || 0
            const rev = revenueByTier.get(tier) || 0
            return (
              <div key={tier} className="border border-gray-200 rounded-xl p-4">
                <p className="text-xs uppercase font-bold text-gray-500 tracking-widest">{tier}</p>
                <p className="text-lg font-bold text-gray-900 mt-1">{count} sold</p>
                <p className="text-xs text-gray-500">{fmt(rev / 100)} revenue</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
