import React, { useState, useMemo } from 'react'
import JobCostingTab from './JobCostingTab'
import { getQuotes } from './quoteStore'

interface Employee {
  id: string
  name: string
  role: 'Foreman' | 'CO Foreman' | 'Installer' | 'Other'
  hourlyRate: number
  annualHours: number
}

interface OverheadItem {
  id: string
  label: string
  annual: number
  category: string
}

interface HistoricYear {
  year: number
  months: number[]
}

interface BudgetState {
  revenueGoal: number
  overheadPct: number
  laborPct: number
  materialsPct: number
  vinylPct: number
  aluminumPct: number
  chainlinkPct: number
  employees: Employee[]
  overhead: OverheadItem[]
  historic: HistoricYear[]
  seasonality: number[]
  seasonalityLocked: boolean
  overheadCategories: string[]
  netProfitPct: number
  miscPct: number
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const DEFAULT_SEASONALITY = [0.0175,0.0483,0.0633,0.0769,0.0842,0.1508,0.1467,0.1092,0.1267,0.0942,0.0665,0.0157]

// Crew from Excel budget — direct labor (COGS, not overhead)
const DEFAULT_EMPLOYEES: Employee[] = [
  { id: 'e1', name: 'Chris',  role: 'Foreman',    hourlyRate: 26, annualHours: 2040 },
  { id: 'e2', name: 'Juan',   role: 'CO Foreman', hourlyRate: 20, annualHours: 2040 },
  { id: 'e3', name: 'TBD',    role: 'Installer',  hourlyRate: 17, annualHours: 1750 },
  { id: 'e4', name: 'TBD',    role: 'Foreman',    hourlyRate: 23, annualHours: 1800 },
  { id: 'e5', name: 'TBD',    role: 'CO Foreman', hourlyRate: 20, annualHours: 1800 },
  { id: 'e6', name: 'TBD',    role: 'Installer',  hourlyRate: 17, annualHours: 1800 },
]

// Chart of accounts structured from Excel budget workbook
// Values from 2026 YTD P&L (Jan 1 – Apr 11, 101 days) annualized × 365/101 = 3.614
const DEFAULT_OVERHEAD: OverheadItem[] = [
  // ── Advertising & Promotion ──
  { id: 'o-adv',        label: 'Advertising & Promotion',     annual: 16922.00, category: 'Sales' },

  // ── Rent ──
  { id: 'o-rent',       label: 'Rent',                        annual: 66385.00, category: 'Facilities' },

  // ── Repairs & Maintenance ──
  { id: 'o-rm',         label: 'Repairs & Maintenance',       annual: 6369.00,  category: 'Operations' },
  { id: 'o-rm-jetta',   label: 'Kia Forte / Jetta',           annual: 6016.00,  category: 'Operations',  parentId: 'o-rm', order: 0 } as any,
  { id: 'o-rm-base',    label: 'R&M Other',                   annual: 353.00,   category: 'Operations',  parentId: 'o-rm', order: 1 } as any,

  // ── Vehicle Repairs ──
  { id: 'o-vrep',       label: 'Vehicle Repairs',             annual: 2644.00,  category: 'Operations' },

  // ── Shop Equipment Rental ──
  { id: 'o-shoprent',   label: 'Shop Equipment Rental',       annual: 550.00,   category: 'Operations' },

  // ── Shop Supplies ──
  { id: 'o-shopsup',    label: 'Shop Supplies',               annual: 3500.00,  category: 'Operations' },

  // ── Cellular Phones ──
  { id: 'o-phone',      label: 'Cellular Phones',             annual: 7271.00,  category: 'Operations' },

  // ── Utilities ──
  { id: 'o-util',       label: 'Utilities',                   annual: 5978.00,  category: 'Facilities' },

  // ── Dump Fees ──
  { id: 'o-dump',       label: 'Dump Fees',                   annual: 813.00,   category: 'Operations' },

  // ── Education & Training ──
  { id: 'o-edu',        label: 'Education & Training',        annual: 2168.00,  category: 'Admin' },

  // ── Team Member Benefits ──
  { id: 'o-benefits',   label: 'Team Member Benefits',        annual: 1807.00,  category: 'Admin' },

  // ── Insurance ──
  { id: 'o-ins',        label: 'Insurance',                   annual: 11189.00, category: 'Admin' },
  { id: 'o-ins-biz',    label: 'Business Insurance',          annual: 11189.00, category: 'Admin',       parentId: 'o-ins', order: 0 } as any,

  // ── Vehicle Insurance ──
  { id: 'o-vins',       label: 'Vehicle Insurance',           annual: 7830.00,  category: 'Operations' },

  // ── Lease Expense ──
  { id: 'o-lease',      label: 'Lease Expense',               annual: 0,        category: 'Operations' },

  // ── Dues & Subscriptions / Office Software ──
  { id: 'o-office',     label: 'Office Supplies & Software',  annual: 13297.00, category: 'Admin' },
  { id: 'o-office-sup', label: 'Office Supplies',             annual: 4121.00,  category: 'Admin',       parentId: 'o-office', order: 0 } as any,
  { id: 'o-office-soft',label: 'Software & Apps',             annual: 9176.00,  category: 'Admin',       parentId: 'o-office', order: 1 } as any,

  // ── Bank & Merchant Fees ──
  { id: 'o-fees',       label: 'Bank & Merchant Fees',        annual: 1733.00,  category: 'Admin' },
  { id: 'o-fees-bank',  label: 'Bank Fees',                   annual: 564.00,   category: 'Admin',       parentId: 'o-fees', order: 0 } as any,
  { id: 'o-fees-merch', label: 'Merchant Account Fees',       annual: 1169.00,  category: 'Admin',       parentId: 'o-fees', order: 1 } as any,

  // ── Payroll - Overhead ──
  { id: 'o-pay',        label: 'Payroll - Overhead',          annual: 53431.00, category: 'Admin' },
  { id: 'o-pay-base',   label: 'Payroll Processing',          annual: 2940.00,  category: 'Admin',       parentId: 'o-pay', order: 0 } as any,
  { id: 'o-pay-sal',    label: 'Salaries & Wages',            annual: 50491.00, category: 'Admin',       parentId: 'o-pay', order: 1 } as any,

  // ── Payroll Taxes ──
  { id: 'o-tax',        label: 'Taxes',                       annual: 14016.00, category: 'Admin' },
  { id: 'o-tax-pay',    label: 'Payroll Taxes',               annual: 13093.00, category: 'Admin',       parentId: 'o-tax', order: 0 } as any,
  { id: 'o-tax-base',   label: 'Other Taxes',                 annual: 923.00,   category: 'Admin',       parentId: 'o-tax', order: 1 } as any,

  // ── Vehicle Fuel ──
  { id: 'o-fuel',       label: 'Vehicle Fuel',                annual: 10447.00, category: 'Operations' },

  // ── Travel ──
  { id: 'o-trav',       label: 'Travel',                      annual: 2197.00,  category: 'Operations' },

  // ── Contract Labor (cleaning, etc.) ──
  { id: 'o-contract',   label: 'Contract Labor',              annual: 723.00,   category: 'Operations' },

  // ── Interest Expense ──
  { id: 'o-int',        label: 'Interest Expense',            annual: 12514.00, category: 'Finance' },

  // ── Medical & Safety ──
  { id: 'o-medical',    label: 'Medical & Safety',            annual: 500.00,   category: 'Operations' },
]

const DEFAULT_HISTORIC: HistoricYear[] = [
  { year: 2021, months: [20700,29300,36869,43700,50600,52900,48300,46000,41400,38800,0,0] },
  { year: 2022, months: [26650,32450,47500,96050,64900,67850,61950,59000,53100,47200,0,0] },
  { year: 2023, months: [32490,39600,57600,66400,79200,82800,76600,72000,64800,57600,0,0] },
  { year: 2024, months: [38700,47300,88569,81700,94600,88800,60100,58900,77400,68800,0,0] },
  { year: 2025, months: [42750,52250,76000,90250,104500,109250,0,0,0,0,0,0] },
]

const CATEGORY_COLOR_OPTIONS = [
  'bg-blue-100 text-blue-700 border-blue-200',
  'bg-purple-100 text-purple-700 border-purple-200',
  'bg-green-100 text-green-700 border-green-200',
  'bg-orange-100 text-orange-700 border-orange-200',
  'bg-red-100 text-red-700 border-red-200',
  'bg-yellow-100 text-yellow-700 border-yellow-200',
  'bg-pink-100 text-pink-700 border-pink-200',
  'bg-teal-100 text-teal-700 border-teal-200',
]

function getCategoryColor(categories: string[], cat: string): string {
  const idx = categories.indexOf(cat)
  return CATEGORY_COLOR_OPTIONS[idx % CATEGORY_COLOR_OPTIONS.length]
}

import { getBusinessField, setBusinessField } from './businessStateStore'

const STORAGE_KEY = 'fencepro_budget'

function mirrorBudget(state: any) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch {}
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`
const uid = () => Math.random().toString(36).slice(2, 9)

function calcSeasonality(historic: HistoricYear[]): number[] {
  const filled = historic.filter(y => y.months.some(m => m > 0))
  if (filled.length === 0) return DEFAULT_SEASONALITY
  const totals = Array(12).fill(0)
  for (const y of filled) {
    const yearTotal = y.months.reduce((a, b) => a + b, 0)
    if (yearTotal === 0) continue
    y.months.forEach((m, i) => { totals[i] += m / yearTotal })
  }
  const raw = totals.map(t => t / filled.length)
  const sum = raw.reduce((a, b) => a + b, 0)
  return sum > 0 ? raw.map(r => r / sum) : DEFAULT_SEASONALITY
}

function loadState(defaults: BudgetState): BudgetState {
  const saved = getBusinessField('budget') as Partial<BudgetState>
  const merged: BudgetState = (!saved || Object.keys(saved).length === 0)
    ? defaults
    : { ...defaults, ...saved }
  // Mirror so the inline localStorage.getItem('fencepro_budget') reads in
  // App.tsx + ReportsPage keep returning current values.
  mirrorBudget(merged)
  return merged
}

// ── SVG Bar Chart ─────────────────────────────────────────────────────────────

function BarChart({
  values, labels, colors, height = 200, showValues = false
}: {
  values: number[][], labels: string[], colors: string[], height?: number, showValues?: boolean
}) {
  const W = 700
  const H = height
  const PAD = { top: 16, right: 16, bottom: 32, left: 48 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const allVals = values.flat().filter(v => v > 0)
  const maxVal  = allVals.length > 0 ? Math.max(...allVals) : 1
  const niceMax = Math.ceil(maxVal / 20000) * 20000

  const groupW   = chartW / labels.length
  const barCount = values.length
  const barW     = Math.max((groupW * 0.7) / barCount, 4)
  const gap      = (groupW - barW * barCount) / 2

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => niceMax * f)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      {/* Y grid + labels */}
      {yTicks.map(tick => {
        const y = PAD.top + chartH - (tick / niceMax) * chartH
        return (
          <g key={tick}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} stroke="#f3f4f6" strokeWidth={1} />
            <text x={PAD.left - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#9ca3af">
              ${(tick / 1000).toFixed(0)}k
            </text>
          </g>
        )
      })}

      {/* Bars */}
      {labels.map((label, gi) => {
        const groupX = PAD.left + gi * groupW
        return (
          <g key={label}>
            {values.map((series, si) => {
              const val  = series[gi] || 0
              const barH = val > 0 ? Math.max((val / niceMax) * chartH, 2) : 0
              const x    = groupX + gap + si * barW
              const y    = PAD.top + chartH - barH
              return (
                <g key={si}>
                  <rect
                    x={x} y={y} width={barW - 1} height={barH}
                    fill={colors[si]} rx={2}
                  />
                  {showValues && val > 0 && (
                    <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={8} fill="#6b7280">
                      ${(val / 1000).toFixed(0)}k
                    </text>
                  )}
                </g>
              )
            })}
            <text
              x={groupX + groupW / 2} y={H - 6}
              textAnchor="middle" fontSize={10} fill="#9ca3af"
            >
              {label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── Shared components ─────────────────────────────────────────────────────────

function TabBar({ tabs, active, onChange }: { tabs: string[], active: string, onChange: (t: string) => void }) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-xl p-1 mb-8">
      {tabs.map(t => (
        <button
          key={t} onClick={() => onChange(t)}
          className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${active === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string, value: string, sub?: string, accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-5 ${accent ? 'bg-orange-500' : 'bg-white border border-gray-200'}`}>
      <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${accent ? 'text-orange-100' : 'text-gray-400'}`}>{label}</p>
      <p className={`text-2xl font-bold ${accent ? 'text-white' : 'text-gray-900'}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${accent ? 'text-orange-200' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  )
}

function BucketBar({ label, actual, target, color, invertColor }: { label: string, actual: number, target: number, color: string, invertColor?: boolean }) {
  const over = actual > target
  // For costs, over target is bad (red). For profit, over target is good (green).
  const isGood = invertColor ? over || Math.abs(actual - target) < 0.02 : !over
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">target {fmtPct(target)}</span>
          <span className={`text-sm font-bold ${isGood ? 'text-green-600' : 'text-red-500'}`}>{fmtPct(actual)}</span>
        </div>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${isGood ? color : 'bg-red-400'}`}
          style={{ width: `${Math.min(Math.abs(actual) / (target || 0.01) * 100, 100)}%` }}
        />
      </div>
    </div>
  )
}

// ── Budget Tab ────────────────────────────────────────────────────────────────

function BudgetTab({ state, onChange }: { state: BudgetState, onChange: (s: BudgetState) => void }) {
  const { revenueGoal, overheadPct, laborPct, materialsPct, vinylPct, aluminumPct, chainlinkPct, employees, overhead, seasonality } = state

  const totalLaborCost    = employees.reduce((s, e) => s + e.hourlyRate * e.annualHours, 0)
  const totalOverheadCost = overhead.filter(o => !(o as any).parentId).reduce((s, o) => s + o.annual, 0)
  const actualLaborPct    = revenueGoal > 0 ? totalLaborCost / revenueGoal : 0
  const actualOverheadPct = revenueGoal > 0 ? totalOverheadCost / revenueGoal : 0

  // Target net profit from the editable 4-bucket inputs
  const targetNetProfitPct = state.netProfitPct ?? 0.1195

  // Magic Number = 1 - Overhead% - Net Profit% = COGS target %
  // This is the reciprocal of (overhead + desired profit)
  // Used in pricing: Price = COGS / MagicNumber
  const magicNumber = 1 - overheadPct - targetNetProfitPct

  // Implied GM from the magic number (what quotes should produce)
  const impliedGM = 1 - magicNumber

  // Actual material cost from sold quotes
  const quotes = useMemo(() => loadQuotes(), [])
  const currentYear = new Date().getFullYear()
  const soldQuotes = useMemo(() => quotes.filter(q =>
    q.status === 'SOLD' && q.date && new Date(q.date).getFullYear() === currentYear
  ), [quotes, currentYear])
  const ytdRevenue = soldQuotes.reduce((s, q) => s + q.finalPrice, 0)
  const ytdMaterialCost = soldQuotes.reduce((s, q) => s + q.materialCost, 0)
  const actualMaterialsPct = ytdRevenue > 0 ? ytdMaterialCost / ytdRevenue : materialsPct

  // Actual net profit = what's left after actual overhead, actual labor, actual materials
  const actualNetProfitPct = ytdRevenue > 0
    ? 1 - actualMaterialsPct - (ytdRevenue > 0 ? soldQuotes.reduce((s, q) => s + q.laborCost, 0) / ytdRevenue : actualLaborPct) - actualOverheadPct
    : 1 - actualOverheadPct - actualLaborPct - materialsPct

  const monthlyGoals      = seasonality.map(s => revenueGoal * s)
  const avg               = revenueGoal / 12

  return (
    <div className="space-y-8">

      {/* Magic Number */}
      <div className="bg-gray-900 rounded-2xl p-4 lg:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-widest mb-2">Magic Number — Cost of Goods Target</p>
          <p className="text-4xl lg:text-7xl font-black text-white leading-none">{fmtPct(magicNumber)}</p>
          <p className="text-gray-500 text-xs mt-1">Price = COGS ÷ {fmtPct(magicNumber)} → implied GM of {fmtPct(impliedGM)}</p>
          <div className="flex flex-wrap gap-4 lg:gap-6 mt-4">
            <div>
              <p className="text-gray-500 text-xs">Labor Target</p>
              <p className="text-white font-bold text-lg">{fmtPct(laborPct)}</p>
              <p className={`text-xs ${Math.abs(actualLaborPct - laborPct) < 0.02 ? 'text-green-400' : 'text-yellow-400'}`}>
                actual {fmtPct(actualLaborPct)}
              </p>
            </div>
            <div className="w-px bg-gray-700" />
            <div>
              <p className="text-gray-500 text-xs">Materials Target</p>
              <p className="text-white font-bold text-lg">{fmtPct(materialsPct)}</p>
            </div>
            <div className="w-px bg-gray-700" />
            <div>
              <p className="text-gray-500 text-xs">Overhead Target</p>
              <p className="text-white font-bold text-lg">{fmtPct(overheadPct)}</p>
              <p className={`text-xs ${Math.abs(actualOverheadPct - overheadPct) < 0.02 ? 'text-green-400' : 'text-yellow-400'}`}>
                actual {fmtPct(actualOverheadPct)}
              </p>
            </div>
            <div className="w-px bg-gray-700" />
            <div>
              <p className="text-gray-500 text-xs">Net Profit Target</p>
              <p className={`font-bold text-lg ${targetNetProfitPct > 0.10 ? 'text-green-400' : targetNetProfitPct > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                {fmtPct(targetNetProfitPct)}
              </p>
              <p className={`text-xs ${actualNetProfitPct >= targetNetProfitPct - 0.02 ? 'text-green-400' : 'text-red-400'}`}>
                actual {fmtPct(actualNetProfitPct)}
              </p>
            </div>
          </div>
        </div>
        <div className="text-left lg:text-right">
          <p className="text-gray-500 text-xs uppercase tracking-wide mb-2">Annual Revenue Goal</p>
          <input
            type="number"
            className="text-2xl lg:text-4xl font-black text-orange-400 bg-transparent text-left lg:text-right outline-none w-full lg:w-56 border-b-2 border-gray-700 focus:border-orange-400 transition-colors pb-1"
            value={revenueGoal}
            onChange={e => onChange({ ...state, revenueGoal: Number(e.target.value) })}
          />
          <p className="text-gray-600 text-xs mt-2">click to edit</p>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Actual Net Profit"
          value={fmtPct(actualNetProfitPct)}
          sub={`${fmt(revenueGoal * actualNetProfitPct)} · target ${fmtPct(targetNetProfitPct)}`}
          accent={actualNetProfitPct >= targetNetProfitPct - 0.02}
        />
        <StatCard label="Total Labor" value={fmt(totalLaborCost)} sub={`${fmtPct(actualLaborPct)} of revenue · target ${fmtPct(laborPct)}`} />
        <StatCard label="Total Overhead" value={fmt(totalOverheadCost)} sub={`${fmtPct(actualOverheadPct)} of revenue · target ${fmtPct(overheadPct)}`} />
        <StatCard
          label="Materials"
          value={ytdRevenue > 0 ? fmt(ytdMaterialCost) : fmt(revenueGoal * materialsPct)}
          sub={ytdRevenue > 0
            ? `${fmtPct(actualMaterialsPct)} actual · target ${fmtPct(materialsPct)}`
            : `${fmtPct(materialsPct)} of revenue (budget)`}
        />
      </div>

      {/* Chart + Buckets */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 bg-white rounded-2xl border border-gray-200 p-4 lg:p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-gray-900">Monthly Revenue Projection</h3>
              <p className="text-xs text-gray-400 mt-0.5">Orange = above average · Gray = below average</p>
            </div>
            <button
              onClick={() => onChange({ ...state, seasonalityLocked: !state.seasonalityLocked })}
              className={`text-xs px-3 py-1.5 rounded-lg border font-medium ${state.seasonalityLocked ? 'bg-orange-50 border-orange-300 text-orange-600' : 'border-gray-200 text-gray-500'}`}
            >
              {state.seasonalityLocked ? '🔒 Locked' : '🔓 Unlocked'}
            </button>
          </div>
          <BarChart
            values={[monthlyGoals]}
            labels={MONTHS}
            colors={monthlyGoals.map(v => v >= avg ? 'rgba(249,115,22,0.85)' : 'rgba(209,213,219,0.8)')}
            height={200}
            showValues
          />
        </div>

        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-200 p-4 lg:p-6">
          <h3 className="font-bold text-gray-900 mb-1">4 Buckets</h3>
          <p className="text-xs text-gray-400 mb-5">Every revenue dollar flows into one of these.</p>
          <div className="space-y-5">
            <BucketBar label="Overhead"      actual={actualOverheadPct}   target={overheadPct}        color="bg-blue-400" />
            <BucketBar label="Labor & Comms" actual={actualLaborPct}      target={laborPct}           color="bg-purple-400" />
            <BucketBar label="Materials"     actual={actualMaterialsPct}  target={materialsPct}       color="bg-yellow-400" />
            <BucketBar label="Net Profit"    actual={actualNetProfitPct}  target={targetNetProfitPct} color="bg-green-400" invertColor />
          </div>
          <div className="mt-6 pt-5 border-t border-gray-100 space-y-3">
            {[
              { label: 'Overhead',    key: 'overheadPct',  val: overheadPct },
              { label: 'Labor',       key: 'laborPct',     val: laborPct },
              { label: 'Materials',   key: 'materialsPct', val: materialsPct },
              { label: 'Net Profit',  key: 'netProfitPct', val: state.netProfitPct ?? 0.106 },
            ].map(f => (
              <div key={f.key} className="flex items-center justify-between">
                <label className="text-xs text-gray-400">{f.label}</label>
                <div className="flex items-center gap-1 border border-gray-200 rounded-lg px-2 py-1 w-24">
                  <input
                    type="number" min={0} max={100} step={0.5}
                    className="w-full text-right text-sm font-semibold text-gray-900 outline-none"
                    value={Math.round(f.val * 1000) / 10}
                    onChange={e => onChange({ ...state, [f.key]: Number(e.target.value) / 100 })}
                  />
                  <span className="text-gray-400 text-xs">%</span>
                </div>
              </div>
            ))}

            {/* 4 bucket total indicator */}
            {(() => {
              const total = overheadPct + laborPct + materialsPct + (state.netProfitPct ?? 0.106)
              const pct   = Math.round(total * 1000) / 10
              const over  = total > 1.001
              const under = total < 0.999
              return (
                <div className="pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs text-gray-400">Total allocation</span>
                    <span className={`text-xs font-bold ${over || under ? 'text-red-500' : 'text-green-600'}`}>
                      {pct}%
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${over ? 'bg-red-400' : under ? 'bg-yellow-400' : 'bg-green-500'}`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  {over && <p className="text-xs text-red-500 mt-1 font-medium">Over by {Math.round((total - 1) * 1000) / 10}% — buckets must equal 100%</p>}
                  {under && <p className="text-xs text-yellow-600 mt-1 font-medium">Under by {Math.round((1 - total) * 1000) / 10}% — buckets must equal 100%</p>}
                  {!over && !under && <p className="text-xs text-green-600 mt-1 font-medium">✓ Buckets balanced</p>}
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* Product mix */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-bold text-gray-900">Revenue by Product Mix</h3>
          {(() => {
            const total = vinylPct + aluminumPct + chainlinkPct + (state.miscPct ?? 0)
            const diff = Math.round((total - 1) * 1000) / 10
            if (Math.abs(diff) < 0.1) return (
              <span className="text-xs font-semibold text-green-600 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">✓ 100%</span>
            )
            return (
              <span className="text-xs font-semibold text-red-500 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
                {diff > 0 ? `+${diff}% over` : `${Math.abs(diff)}% under`} 100%
              </span>
            )
          })()}
        </div>
        <p className="text-sm text-gray-400 mb-5">Must total exactly 100%. Adjust sliders until the indicator turns green.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { label: 'Vinyl',     key: 'vinylPct',     val: vinylPct,            color: 'bg-orange-400' },
            { label: 'Aluminum',  key: 'aluminumPct',  val: aluminumPct,         color: 'bg-blue-400' },
            { label: 'Chainlink', key: 'chainlinkPct', val: chainlinkPct,        color: 'bg-gray-400' },
            { label: 'Misc/Other',key: 'miscPct',      val: state.miscPct ?? 0.02, color: 'bg-green-300' },
          ].map(f => (
            <div key={f.label}>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium text-gray-700">{f.label}</span>
                <span className="text-sm font-bold text-gray-900">{Math.round(f.val * 100)}%</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
                <div className={`h-full ${f.color} rounded-full`} style={{ width: `${f.val * 100}%` }} />
              </div>
              <p className="text-xs text-gray-400">{fmt(revenueGoal * f.val)}</p>
              <input
                type="range" min={0} max={100} step={1}
                className="w-full mt-2 accent-orange-500"
                value={Math.round(f.val * 100)}
                onChange={e => onChange({ ...state, [f.key]: Number(e.target.value) / 100 })}
              />
            </div>
          ))}
        </div>
      </div>
    {(() => {
          const total = vinylPct + aluminumPct + chainlinkPct + (state.miscPct ?? 0)
          const pct = Math.round(total * 1000) / 10
          const over = total > 1.001
          const under = total < 0.999
          return (
            <div className="mt-5 pt-4 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-500 font-medium">Total allocation</span>
                <span className={`text-sm font-bold ${over || under ? 'text-red-500' : 'text-green-600'}`}>{pct}%</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${over ? 'bg-red-400' : under ? 'bg-yellow-400' : 'bg-green-500'}`}
                  style={{ width: `${Math.min(pct, 100)}%` }}
                />
              </div>
              {over && <p className="text-xs text-red-500 mt-1.5 font-medium">Over by {Math.round((total - 1) * 1000) / 10}% — reduce one or more categories</p>}
              {under && <p className="text-xs text-yellow-600 mt-1.5 font-medium">Under by {Math.round((1 - total) * 1000) / 10}% — increase one or more categories</p>}
              {!over && !under && <p className="text-xs text-green-600 mt-1.5 font-medium">Perfectly balanced</p>}
            </div>
          )
        })()}
        </div>
  )
}// ── Historic Revenue Tab ──────────────────────────────────────────────────────

function HistoricTab({ state, onChange }: { state: BudgetState, onChange: (s: BudgetState) => void }) {
  const { historic } = state
  const computedSeasonality = useMemo(() => calcSeasonality(historic), [historic])

  function updateMonth(yearIdx: number, monthIdx: number, val: string) {
    const updated = historic.map((y, yi) =>
      yi === yearIdx
        ? { ...y, months: y.months.map((m, mi) => mi === monthIdx ? (Number(val) || 0) : m) }
        : y
    )
    onChange({ ...state, historic: updated, seasonality: calcSeasonality(updated), seasonalityLocked: true })
  }

  const yearColors = ['rgba(99,102,241,0.7)', 'rgba(59,130,246,0.7)', 'rgba(16,185,129,0.7)', 'rgba(249,115,22,0.7)', 'rgba(236,72,153,0.7)']

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Historic Revenue</h2>
          <p className="text-sm text-gray-400 mt-0.5">Enter monthly actuals. Seasonality auto-calculates and locks in to drive projections.</p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 text-right">
          <p className="text-xs text-orange-600 font-semibold">Seasonality locked from historic data</p>
          <p className="text-xs text-gray-400 mt-0.5">Edit any cell to recalculate</p>
        </div>
      </div>

      {/* Year legend */}
      <div className="flex gap-4">
        {historic.map((y, i) => (
          <div key={y.year} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: yearColors[i] }} />
            <span className="text-xs text-gray-500 font-medium">{y.year}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-bold text-gray-900 mb-4">Revenue by Year</h3>
        <BarChart
          values={historic.map(y => y.months)}
          labels={MONTHS}
          colors={yearColors}
          height={220}
        />
      </div>

      {/* Input table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-16">Year</th>
              {MONTHS.map(m => <th key={m} className="text-right px-1 py-3 text-xs font-semibold text-gray-500 uppercase">{m}</th>)}
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {historic.map((y, yi) => {
              const total = y.months.reduce((a, b) => a + b, 0)
              return (
                <tr key={y.year} className="hover:bg-gray-50">
                  <td className="px-4 py-2 font-bold text-gray-900">{y.year}</td>
                  {y.months.map((m, mi) => (
                    <td key={mi} className="px-0.5 py-1.5 text-right">
                      <input
                        type="number"
                        className="w-[68px] text-right text-xs border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400 font-mono"
                        value={m || ''}
                        placeholder="0"
                        onChange={e => updateMonth(yi, mi, e.target.value)}
                      />
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-bold text-gray-900 text-xs whitespace-nowrap">{fmt(total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Seasonality bars */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-bold text-gray-900 mb-5">Seasonality Distribution</h3>
        <div className="flex items-end gap-2" style={{ height: 100 }}>
          {computedSeasonality.map((pct, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs text-gray-500 font-medium">{fmtPct(pct)}</span>
              <div
                className="w-full bg-orange-400 rounded-t"
                style={{ height: `${Math.max((pct / Math.max(...computedSeasonality)) * 64, 4)}px` }}
              />
              <span className="text-xs text-gray-400">{MONTHS[i]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Overhead Tab ──────────────────────────────────────────────────────────────

// ── Chart of Accounts types ───────────────────────────────────────────────────

interface OverheadAccount {
  id: string
  label: string
  annual: number
  category: string
  parentId: string | null
  order: number
}

// ── Overhead Drawer ───────────────────────────────────────────────────────────

function OverheadDrawer({
  accounts,
  onAdd,
  onClose,
}: {
  accounts: OverheadAccount[]
  onAdd: (items: OverheadAccount[]) => void
  onClose: () => void
}) {
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [label, setLabel] = useState('')
  const [annual, setAnnual] = useState('')
  const [category, setCategory] = useState('Operations')
  const [parentId, setParentId] = useState<string | null>(null)
  const [bulkText, setBulkText] = useState('')
  const [bulkError, setBulkError] = useState('')

  const categories = accounts
    .map(a => a.category)
    .filter((c, i, arr) => arr.indexOf(c) === i)
    .concat(['Facilities', 'Admin', 'Sales', 'Operations'])
    .filter((c, i, arr) => arr.indexOf(c) === i)
  const parents = accounts.filter(a => a.parentId === null)

  function handleSingle() {
    if (!label.trim()) return
    const newItem: OverheadAccount = {
      id: uid(),
      label: label.trim(),
      annual: Number(annual) || 0,
      category,
      parentId,
      order: accounts.filter(a => a.category === category).length,
    }
    onAdd([newItem])
    setLabel('')
    setAnnual('')
  }

  function handleBulk() {
    setBulkError('')
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    const parsed: OverheadAccount[] = []
    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim())
      if (parts.length < 1) continue
      const itemLabel = parts[0].replace(/^[-*]\s*/, '')
      const rawAmt = parts[1] || '0'
      const amt = Number(rawAmt.replace(/[$,\s]/g, ''))
      if (!itemLabel) continue
      parsed.push({
        id: uid(),
        label: itemLabel,
        annual: isNaN(amt) ? 0 : amt,
        category,
        parentId,
        order: accounts.length + parsed.length,
      })
    }
    if (parsed.length === 0) {
      setBulkError('Could not parse any items. Use format: Expense Name, $amount')
      return
    }
    onAdd(parsed)
    setBulkText('')
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-96 bg-white shadow-2xl flex flex-col h-full overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Add Expense</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-4 flex gap-1 bg-gray-50 border-b border-gray-200">
          {(['single', 'bulk'] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${mode === m ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            >
              {m === 'single' ? 'Single Item' : 'Paste in Bulk'}
            </button>
          ))}
        </div>

        <div className="flex-1 px-6 py-6 space-y-4">
          {mode === 'single' ? (
            <>
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-medium">Expense Name</label>
                <input
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="e.g. Vehicle Insurance"
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleSingle()}
                />
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block font-medium">Annual Amount</label>
                <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-orange-400">
                  <span className="px-3 text-gray-400 bg-gray-50 border-r border-gray-300 py-2 text-sm">$</span>
                  <input
                    type="number" min={0}
                    className="flex-1 px-3 py-2 text-sm outline-none"
                    placeholder="0"
                    value={annual}
                    onChange={e => setAnnual(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block font-medium">Category</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                >
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block font-medium">Parent Expense (optional)</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={parentId || ''}
                  onChange={e => setParentId(e.target.value || null)}
                >
                  <option value="">None (top level)</option>
                  {parents.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
                {parentId && <p className="text-xs text-gray-400 mt-1">This will appear as a sub-item indented under the parent.</p>}
              </div>

              <button
                onClick={handleSingle}
                disabled={!label.trim()}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                Add Expense
              </button>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs text-gray-500 mb-1 block font-medium">Category for all items</label>
                <select
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                >
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500 mb-1 block font-medium">Paste your list</label>
                <p className="text-xs text-gray-400 mb-2">One item per line. Format: <span className="font-mono bg-gray-100 px-1 rounded">Expense Name, $amount</span></p>
                <textarea
                  autoFocus
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 font-mono resize-none"
                  rows={10}
                  placeholder={'Fuel, $15000\nInsurance, $18000\nRepairs, $8000'}
                  value={bulkText}
                  onChange={e => { setBulkText(e.target.value); setBulkError('') }}
                />
                {bulkError && <p className="text-xs text-red-500 mt-1">{bulkError}</p>}
                <p className="text-xs text-gray-400 mt-1">
                  {bulkText.split('\n').filter(l => l.trim()).length} lines detected
                </p>
              </div>

              <button
                onClick={handleBulk}
                disabled={!bulkText.trim()}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold py-2.5 rounded-xl text-sm transition-colors"
              >
                Import Items
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}// ── Overhead Tab ──────────────────────────────────────────────────────────────

function OverheadTab({ state, onChange }: { state: BudgetState, onChange: (s: BudgetState) => void }) {
  const { revenueGoal, overheadPct } = state
  const categories: string[] = state.overheadCategories ?? ['Facilities', 'Admin', 'Sales', 'Operations']
  const [showDrawer, setShowDrawer] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingCatIdx, setEditingCatIdx] = useState<number | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [newCatName, setNewCatName] = useState('')
    // migrate old OverheadItem[] to OverheadAccount[] on first load
  const accounts: OverheadAccount[] = useMemo(() => {
    return (state.overhead as any[]).map((o, i) => ({
      id: o.id,
      label: o.label,
      annual: o.annual,
      category: o.category,
      parentId: o.parentId ?? null,
      order: o.order ?? i,
    }))
  }, [state.overhead])

  function addCategory() {
    if (!newCatName.trim()) return
    onChange({ ...state, overheadCategories: [...categories, newCatName.trim()] })
    setNewCatName('')
  }

  function renameCategory(idx: number, val: string) {
    const oldName = categories[idx]
    const updated = categories.map((c, i) => i === idx ? val : c)
    const updatedAccounts = accounts.map(a => a.category === oldName ? { ...a, category: val } : a)
    onChange({ ...state, overheadCategories: updated, overhead: updatedAccounts as any })
  }

  function removeCategory(idx: number) {
    const cat = categories[idx]
    if (accounts.some(a => a.category === cat)) {
      alert(`Move or delete all expenses in "${cat}" before removing it.`)
      return
    }
    onChange({ ...state, overheadCategories: categories.filter((_, i) => i !== idx) })
  }

  const total = accounts.filter(a => a.parentId === null).reduce((s, a) => s + a.annual, 0)
  const actualPct = revenueGoal > 0 ? total / revenueGoal : 0
  const overTarget = actualPct > overheadPct

  const byCategory = categories.map(cat => {
    const topLevel = accounts
      .filter(a => a.category === cat && a.parentId === null)
      .sort((a, b) => a.order - b.order)
    return { cat, topLevel, total: topLevel.reduce((s, a) => s + a.annual, 0) }
  })

  function getChildren(parentId: string) {
    return accounts.filter(a => a.parentId === parentId).sort((a, b) => a.order - b.order)
  }

  function updateAccount(id: string, field: string, val: string | number) {
    const updated = accounts.map(a => a.id === id ? { ...a, [field]: val } : a)
    onChange({ ...state, overhead: updated as any })
  }

  function removeAccount(id: string) {
    const updated = accounts.filter(a => a.id !== id && a.parentId !== id)
    onChange({ ...state, overhead: updated as any })
  }

  function addAccounts(items: OverheadAccount[]) {
    onChange({ ...state, overhead: [...accounts, ...items] as any })
  }

  function moveItem(id: string, dir: 'up' | 'down') {
    const item = accounts.find(a => a.id === id)
    if (!item) return
    const siblings = accounts
      .filter(a => a.category === item.category && a.parentId === item.parentId)
      .sort((a, b) => a.order - b.order)
    const idx = siblings.findIndex(a => a.id === id)
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= siblings.length) return
    const swapItem = siblings[swapIdx]
    const updated = accounts.map(a => {
      if (a.id === id) return { ...a, order: swapItem.order }
      if (a.id === swapItem.id) return { ...a, order: item.order }
      return a
    })
    onChange({ ...state, overhead: updated as any })
  }

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function AccountRow({ account, depth = 0 }: { account: OverheadAccount, depth?: number }) {
    const children = getChildren(account.id)
    const hasChildren = children.length > 0
    const isExpanded = expandedIds.has(account.id)
    const isEditing = editingId === account.id
    const childTotal = children.reduce((s, c) => s + c.annual, 0)
    const displayAmt = hasChildren ? childTotal : account.annual

    return (
      <>
        <tr className="hover:bg-gray-50 group">
          <td className="px-5 py-2.5" style={{ paddingLeft: `${20 + depth * 24}px` }}>
            <div className="flex items-center gap-2">
              {hasChildren && (
                <button
                  onClick={() => toggleExpand(account.id)}
                  className="text-gray-400 hover:text-gray-600 w-4 h-4 flex items-center justify-center text-xs"
                >
                  {isExpanded ? '▼' : '▶'}
                </button>
              )}
              {!hasChildren && <span className="w-4" />}
              {isEditing ? (
                <input
                  autoFocus
                  className="border-b border-orange-400 outline-none text-sm font-medium text-gray-900 bg-transparent flex-1"
                  value={account.label}
                  onChange={e => updateAccount(account.id, 'label', e.target.value)}
                  onBlur={() => setEditingId(null)}
                  onKeyDown={e => e.key === 'Enter' && setEditingId(null)}
                />
              ) : (
                <span
                  className={`text-sm cursor-pointer hover:text-orange-600 ${depth > 0 ? 'text-gray-600' : 'font-medium text-gray-800'}`}
                  onClick={() => setEditingId(account.id)}
                >
                  {account.label}
                </span>
              )}
            </div>
          </td>

          <td className="px-3 py-2.5">
            <select
              className="text-xs text-gray-500 border border-gray-200 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
              value={account.category}
              onChange={e => updateAccount(account.id, 'category', e.target.value)}
            >
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </td>

          <td className="px-3 py-2.5 text-right">
            {hasChildren ? (
              <span className="text-sm font-bold text-gray-700 font-mono">{fmt(displayAmt)}</span>
            ) : (
              <div className="flex items-center justify-end gap-1">
                <span className="text-gray-400 text-xs">$</span>
                <input
                  type="number" min={0}
                  className="w-24 text-right border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400 font-mono"
                  value={account.annual}
                  onChange={e => updateAccount(account.id, 'annual', Number(e.target.value))}
                />
              </div>
            )}
          </td>

          <td className="px-3 py-2.5 text-right text-gray-400 font-mono text-xs whitespace-nowrap">
            {fmt(displayAmt / 12)}/mo
          </td>

          <td className="px-3 py-2.5 text-right text-xs font-medium text-gray-400 w-16">
            {revenueGoal > 0 ? fmtPct(displayAmt / revenueGoal) : '—'}
          </td>

          <td className="px-2 py-2.5 w-20">
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={() => moveItem(account.id, 'up')}
                className="text-gray-300 hover:text-gray-600 text-xs px-1 py-0.5 rounded"
                title="Move up"
              >▲</button>
              <button
                onClick={() => moveItem(account.id, 'down')}
                className="text-gray-300 hover:text-gray-600 text-xs px-1 py-0.5 rounded"
                title="Move down"
              >▼</button>
              <button
                onClick={() => removeAccount(account.id)}
                className="text-gray-200 hover:text-red-400 text-lg leading-none ml-1"
              >×</button>
            </div>
          </td>
        </tr>

        {hasChildren && isExpanded && children.map(child => (
          <AccountRow key={child.id} account={child} depth={depth + 1} />
        ))}
      </>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Overhead Expenses</h2>
          <p className="text-sm text-gray-400 mt-0.5">Full chart of accounts. Click any name to rename. Changes update the Budget tab instantly.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={`rounded-2xl px-5 py-3 text-right ${overTarget ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
            <p className={`text-2xl font-black ${overTarget ? 'text-red-600' : 'text-green-600'}`}>{fmtPct(actualPct)}</p>
            <p className="text-xs text-gray-500 mt-0.5">target {fmtPct(overheadPct)} · {fmt(total)}/yr</p>
          </div>
          <button
            onClick={() => setShowDrawer(true)}
            className="bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm px-4 py-2.5 rounded-xl"
          >
            + Add Expense
          </button>
        </div>
      </div>

      {/* Category summary pills */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {byCategory.map(({ cat, topLevel, total: catTotal }, idx) => (
          <div key={cat} className={`rounded-xl border p-4 group relative ${getCategoryColor(categories, cat)}`}>
            {editingCatIdx === idx ? (
              <input
                autoFocus
                className="text-xs font-bold uppercase tracking-wide bg-transparent outline-none border-b border-current w-full mb-1"
                value={cat}
                onChange={e => renameCategory(idx, e.target.value)}
                onBlur={() => setEditingCatIdx(null)}
                onKeyDown={e => e.key === 'Enter' && setEditingCatIdx(null)}
              />
            ) : (
              <p
                className="text-xs font-semibold uppercase tracking-wide opacity-70 cursor-pointer hover:opacity-100"
                onClick={() => setEditingCatIdx(idx)}
                title="Click to rename"
              >
                {cat} ✎
              </p>
            )}
            <p className="text-xl font-bold mt-1">{fmt(catTotal)}</p>
            <p className="text-xs opacity-60 mt-0.5">{topLevel.length} items · {fmt(catTotal / 12)}/mo</p>
            <button
              onClick={() => removeCategory(idx)}
              className="absolute top-2 right-2 text-current opacity-0 group-hover:opacity-40 hover:opacity-100 text-sm leading-none"
              title="Remove category"
            >×</button>
          </div>
        ))}

        {/* Add category tile */}
        <div className="rounded-xl border border-dashed border-gray-300 p-4 flex flex-col justify-center">
          <p className="text-xs text-gray-400 mb-2 font-medium">New Category</p>
          <input
            className="border border-gray-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400 mb-2"
            placeholder="Category name..."
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addCategory()}
          />
          <button
            onClick={addCategory}
            disabled={!newCatName.trim()}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-semibold py-1.5 rounded-lg"
          >
            + Add
          </button>
        </div>
      </div>

      {/* Chart of accounts table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden overflow-x-auto">
        <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between min-w-[640px]">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Chart of Accounts</p>
          <p className="text-xs text-gray-400">Click name to rename · hover for controls</p>
        </div>
        <table className="w-full text-sm min-w-[640px]">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-gray-400 uppercase">Expense</th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase w-36">Category</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase w-36">Annual</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase w-28">Monthly</th>
              <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-400 uppercase w-16">% Rev</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {byCategory.map(({ cat, topLevel }) =>
            topLevel.length === 0 ? null : (
            <React.Fragment key={cat}>
               <tr className="bg-gray-50">
                    <td colSpan={6} className="px-5 py-2">
                      <span className={`text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${getCategoryColor(categories, cat)}`}>
                        {cat}
                      </span>
                    </td>
                  </tr>
                  {topLevel.map(account => (
                    <AccountRow key={account.id} account={account} depth={0} />
                  ))}
                </React.Fragment>
              )
            )}
          </tbody>
        </table>
      </div>

      {/* Total footer */}
      <div className="bg-gray-900 rounded-2xl px-4 lg:px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <span className="font-bold text-white">Total Overhead</span>
        <div className="flex flex-wrap items-center gap-4 lg:gap-8">
          <div className="text-right">
            <p className="text-gray-400 text-xs">Annual</p>
            <p className="text-white font-bold text-lg">{fmt(total)}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-400 text-xs">Monthly avg</p>
            <p className="text-white font-bold text-lg">{fmt(total / 12)}</p>
          </div>
          <div className="text-right">
            <p className="text-gray-400 text-xs">% of Revenue</p>
            <p className={`font-bold text-lg ${overTarget ? 'text-red-400' : 'text-green-400'}`}>{fmtPct(actualPct)}</p>
          </div>
        </div>
      </div>

      {showDrawer && (
        <OverheadDrawer
          accounts={accounts}
          onAdd={items => { addAccounts(items); setShowDrawer(false) }}
          onClose={() => setShowDrawer(false)}
        />
      )}
    </div>
  )
}

// ── Crew & Labor Tab ──────────────────────────────────────────────────────────

function CrewTab({ state, onChange }: { state: BudgetState, onChange: (s: BudgetState) => void }) {
  const { employees, revenueGoal, laborPct } = state
  const totalCost = employees.reduce((s, e) => s + e.hourlyRate * e.annualHours, 0)
  const actualPct = revenueGoal > 0 ? totalCost / revenueGoal : 0
  const overTarget = actualPct > laborPct

  function updateEmp(id: string, field: keyof Employee, val: string | number) {
    onChange({ ...state, employees: employees.map(e => e.id === id ? { ...e, [field]: val } : e) })
  }

  function addEmp() {
    onChange({ ...state, employees: [...employees, { id: uid(), name: 'New', role: 'Installer', hourlyRate: 20, annualHours: 2040 }] })
  }

  function removeEmp(id: string) {
    onChange({ ...state, employees: employees.filter(e => e.id !== id) })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Crew & Labor</h2>
          <p className="text-sm text-gray-400 mt-0.5">Every team member ties directly into the labor bucket.</p>
        </div>
        <div className={`rounded-2xl px-4 lg:px-6 py-4 text-right ${overTarget ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          <p className={`text-2xl lg:text-3xl font-black ${overTarget ? 'text-red-600' : 'text-green-600'}`}>{fmtPct(actualPct)}</p>
          <p className="text-xs text-gray-500 mt-1">target {fmtPct(laborPct)} · {fmt(totalCost)}/yr</p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-8">#</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-36">Role</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-28">$/hr</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Hrs/yr</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-32">Annual Cost</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-20">% Rev</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {employees.map((emp, idx) => {
              const annual = emp.hourlyRate * emp.annualHours
              return (
                <tr key={emp.id} className="hover:bg-gray-50 group">
                  <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <input
                      className="border-b border-transparent hover:border-gray-200 focus:border-orange-400 outline-none text-sm font-medium text-gray-900 bg-transparent w-28"
                      value={emp.name}
                      onChange={e => updateEmp(emp.id, 'name', e.target.value)}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      className="text-xs text-gray-600 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-orange-400"
                      value={emp.role}
                      onChange={e => updateEmp(emp.id, 'role', e.target.value)}
                    >
                      {['Foreman', 'CO Foreman', 'Installer', 'Other'].map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-gray-400 text-xs">$</span>
                      <input
                        type="number" min={0}
                        className="w-20 text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 font-mono"
                        value={emp.hourlyRate}
                        onChange={e => updateEmp(emp.id, 'hourlyRate', Number(e.target.value))}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <input
                      type="number" min={0}
                      className="w-20 text-right border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400 font-mono"
                      value={emp.annualHours}
                      onChange={e => updateEmp(emp.id, 'annualHours', Number(e.target.value))}
                    />
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900 font-mono text-sm">{fmt(annual)}</td>
                  <td className="px-4 py-3 text-right text-xs font-medium text-gray-500">
                    {revenueGoal > 0 ? fmtPct(annual / revenueGoal) : '—'}
                  </td>
                  <td className="px-2 py-3">
                    <button onClick={() => removeEmp(emp.id)} className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 text-lg leading-none">×</button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t border-gray-200">
            <tr>
              <td colSpan={5} className="px-4 py-3 font-bold text-gray-900">{employees.length} team members</td>
              <td className="px-4 py-3 text-right font-bold text-gray-900 font-mono">{fmt(totalCost)}</td>
              <td className={`px-4 py-3 text-right font-bold text-sm ${overTarget ? 'text-red-500' : 'text-green-600'}`}>{fmtPct(actualPct)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <button onClick={addEmp} className="text-orange-500 border border-orange-300 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-orange-50">
        + Add Team Member
      </button>
    </div>
  )
}

// ── KPIs Tab ──────────────────────────────────────────────────────────────────

interface QuoteRecord {
  id: string
  date: string
  status: 'DRAFT' | 'SENT' | 'SOLD' | 'LOST'
  finalPrice: number
  totalCOGS: number
  materialCost: number
  laborCost: number
  gmPct: number
}

function loadQuotes(): QuoteRecord[] {
  return getQuotes() as unknown as QuoteRecord[]
}

function KPIsTab({ state }: { state: BudgetState }) {
  const { revenueGoal, seasonality, laborPct, materialsPct, overheadPct } = state
  const targetNetProfitPct = state.netProfitPct ?? 0.106
  const magicNumber = 1 - overheadPct - targetNetProfitPct

  const quotes = useMemo(() => loadQuotes(), [])
  const currentYear = new Date().getFullYear()
  const yearQuotes = useMemo(() => quotes.filter(q => {
    if (!q.date) return false
    return new Date(q.date).getFullYear() === currentYear
  }), [quotes, currentYear])

  // Monthly actuals derived from real quote data
  const monthlyData = useMemo(() => {
    return MONTHS.map((_, i) => {
      const monthQuotes = yearQuotes.filter(q => new Date(q.date).getMonth() === i)
      const soldQuotes = monthQuotes.filter(q => q.status === 'SOLD')
      return {
        quoted: monthQuotes.length,
        sold: soldQuotes.length,
        revenue: soldQuotes.reduce((s, q) => s + q.finalPrice, 0),
        cogs: soldQuotes.reduce((s, q) => s + q.totalCOGS, 0),
        materialCost: soldQuotes.reduce((s, q) => s + q.materialCost, 0),
        laborCost: soldQuotes.reduce((s, q) => s + q.laborCost, 0),
        avgMargin: soldQuotes.length > 0 ? soldQuotes.reduce((s, q) => s + q.gmPct, 0) / soldQuotes.length : 0,
        quotedValue: monthQuotes.reduce((s, q) => s + q.finalPrice, 0),
      }
    })
  }, [yearQuotes])

  const totalRevenue = monthlyData.reduce((s, m) => s + m.revenue, 0)
  const totalCOGS    = monthlyData.reduce((s, m) => s + m.cogs, 0)
  const totalQuoted  = monthlyData.reduce((s, m) => s + m.quoted, 0)
  const totalSold    = monthlyData.reduce((s, m) => s + m.sold, 0)
  const closingRate  = totalQuoted > 0 ? totalSold / totalQuoted : 0
  const pctOfGoal    = revenueGoal > 0 ? totalRevenue / revenueGoal : 0
  const actualGM     = totalRevenue > 0 ? (totalRevenue - totalCOGS) / totalRevenue : 0

  // Actual bucket percentages based on real job data
  const actualMaterialPct = totalRevenue > 0 ? monthlyData.reduce((s, m) => s + m.materialCost, 0) / totalRevenue : 0
  const actualLaborPct    = totalRevenue > 0 ? monthlyData.reduce((s, m) => s + m.laborCost, 0) / totalRevenue : 0
  const totalOverhead     = state.overhead.filter((o: any) => !(o as any).parentId).reduce((s: number, o: any) => s + (o.annual || 0), 0)
  const actualOverheadPct = totalRevenue > 0 ? totalOverhead / totalRevenue : 0
  const actualNetProfitPct= totalRevenue > 0 ? 1 - actualMaterialPct - actualLaborPct - actualOverheadPct : 0

  const goals    = seasonality.map(s => revenueGoal * s)
  const actRevs  = monthlyData.map(m => m.revenue)

  return (
    <div className="space-y-6">
      {/* Hero KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900 rounded-2xl p-5 sm:col-span-2">
          <p className="text-gray-400 text-xs font-semibold uppercase tracking-wide mb-1">Revenue vs Goal (from Sold Quotes)</p>
          <div className="flex items-baseline gap-3">
            <p className="text-white text-3xl font-black">{fmt(totalRevenue)}</p>
            <p className="text-gray-400 text-sm">of {fmt(revenueGoal)}</p>
          </div>
          <div className="mt-3 h-2 bg-gray-700 rounded-full overflow-hidden">
            <div className="h-full bg-orange-500 rounded-full transition-all" style={{ width: `${Math.min(pctOfGoal * 100, 100)}%` }} />
          </div>
          <p className={`text-xs mt-1.5 font-semibold ${pctOfGoal >= 1 ? 'text-green-400' : pctOfGoal >= 0.75 ? 'text-yellow-400' : 'text-gray-400'}`}>
            {fmtPct(pctOfGoal)} of annual goal
          </p>
        </div>
        <StatCard label="Closing Rate" value={`${(closingRate * 100).toFixed(0)}%`} sub={`${totalSold} sold / ${totalQuoted} quoted`} accent={closingRate >= 0.40} />
        <StatCard label="Actual Gross Margin" value={fmtPct(actualGM)} sub={`Magic # target: ${fmtPct(magicNumber)} COGS`} accent={actualGM >= (1 - magicNumber - 0.03)} />
      </div>

      {/* Actual vs Goal chart */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-bold text-gray-900 mb-1">Actual vs Goal by Month</h3>
        <p className="text-xs text-gray-400 mb-4">Data pulled live from sold quotes in the system</p>
        <BarChart
          values={[goals, actRevs]}
          labels={MONTHS}
          colors={['rgba(209,213,219,0.8)', 'rgba(249,115,22,0.85)']}
          height={200}
        />
        <div className="flex gap-4 mt-3">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-gray-300" /><span className="text-xs text-gray-500">Goal</span></div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-orange-400" /><span className="text-xs text-gray-500">Actual (Sold)</span></div>
        </div>
      </div>

      {/* Actual bucket health */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        <h3 className="font-bold text-gray-900 mb-1">Budget Health — Actual vs Targets</h3>
        <p className="text-xs text-gray-400 mb-5">Based on {totalSold} sold jobs totaling {fmt(totalRevenue)} in revenue</p>
        <div className="space-y-5">
          <BucketBar label="Materials (from jobs)"  actual={actualMaterialPct}  target={materialsPct}       color="bg-yellow-400" />
          <BucketBar label="Labor (from jobs)"      actual={actualLaborPct}     target={laborPct}           color="bg-purple-400" />
          <BucketBar label="Overhead (annualized)"  actual={actualOverheadPct}  target={overheadPct}        color="bg-blue-400" />
          <BucketBar label="Net Profit (implied)"   actual={actualNetProfitPct} target={targetNetProfitPct} color="bg-green-400" invertColor />
        </div>
        {totalRevenue === 0 && (
          <p className="text-sm text-gray-400 mt-4 text-center">No sold quotes yet — create and close quotes to see actual budget health</p>
        )}
      </div>

      {/* Monthly scoreboard */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden overflow-x-auto">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-bold text-gray-900">Monthly Scoreboard</h3>
          <p className="text-sm text-gray-400 mt-0.5">Auto-populated from quote data. Green = on pace or ahead.</p>
        </div>
        <table className="w-full text-sm min-w-[800px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Month</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Goal</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Actual</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Variance</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Quoted</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Sold</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Close %</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Avg GM</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {MONTHS.map((m, i) => {
              const goal     = revenueGoal * seasonality[i]
              const actual   = monthlyData[i].revenue
              const variance = actual - goal
              const cr       = monthlyData[i].quoted > 0 ? monthlyData[i].sold / monthlyData[i].quoted : 0
              return (
                <tr key={m} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 font-semibold text-gray-700">{m}</td>
                  <td className="px-4 py-2.5 text-right text-gray-400 font-mono text-xs">{fmt(goal)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-xs font-bold text-gray-900">{actual > 0 ? fmt(actual) : '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    {actual > 0 && (
                      <span className={`text-xs font-bold ${variance >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {variance >= 0 ? '+' : ''}{fmt(variance)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700 text-xs">{monthlyData[i].quoted || '—'}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 text-xs">{monthlyData[i].sold || '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    {monthlyData[i].quoted > 0 && (
                      <span className={`text-xs font-bold ${cr >= 0.40 ? 'text-green-600' : 'text-yellow-600'}`}>{fmtPct(cr)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {monthlyData[i].sold > 0 && (
                      <span className={`text-xs font-bold ${monthlyData[i].avgMargin >= (1 - magicNumber - 0.03) ? 'text-green-600' : 'text-yellow-600'}`}>
                        {fmtPct(monthlyData[i].avgMargin)}
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot className="bg-gray-50 border-t border-gray-200">
            <tr className="font-bold">
              <td className="px-5 py-3 text-gray-900">Total</td>
              <td className="px-4 py-3 text-right text-gray-400 font-mono text-xs">{fmt(revenueGoal)}</td>
              <td className="px-4 py-3 text-right font-mono text-xs text-gray-900">{fmt(totalRevenue)}</td>
              <td className="px-4 py-3 text-right">
                <span className={`text-xs ${totalRevenue - revenueGoal >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                  {totalRevenue - revenueGoal >= 0 ? '+' : ''}{fmt(totalRevenue - revenueGoal)}
                </span>
              </td>
              <td className="px-4 py-3 text-right text-xs text-gray-700">{totalQuoted}</td>
              <td className="px-4 py-3 text-right text-xs text-gray-700">{totalSold}</td>
              <td className="px-4 py-3 text-right">
                <span className={`text-xs ${closingRate >= 0.40 ? 'text-green-600' : 'text-yellow-600'}`}>{fmtPct(closingRate)}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <span className={`text-xs ${actualGM >= (1 - magicNumber - 0.03) ? 'text-green-600' : 'text-yellow-600'}`}>{fmtPct(actualGM)}</span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS = ['Budget', 'Historic Revenue', 'Overhead', 'Crew & Labor', 'KPIs', 'Job Costing']

function buildInitialState(): BudgetState {
  // Budget TARGETS from Excel budget workbook (aspirational)
  // Magic Number = 1 - Overhead(24%) - Profit(10.6%) = 0.654 → 0.64 rounded
  // Overhead chart of accounts values from 2026 YTD P&L (annualized × 3.614)
  // Revenue goal = annualized 2026 YTD pace ($169,523 × 3.614)
  const defaults: BudgetState = {
    revenueGoal:       613000,
    overheadPct:       0.24,
    laborPct:          0.214,
    materialsPct:      0.44,
    vinylPct:          0.60,
    aluminumPct:       0.10,
    chainlinkPct:      0.20,
    employees:         DEFAULT_EMPLOYEES,
    overhead:          DEFAULT_OVERHEAD,
    historic:          DEFAULT_HISTORIC,
    seasonality:       calcSeasonality(DEFAULT_HISTORIC),
    seasonalityLocked: true,
    overheadCategories: ['Facilities', 'Admin', 'Sales', 'Operations', 'Finance'],
    netProfitPct: 0.106,
    miscPct: 0.10,
  }
  return loadState(defaults)
}

export default function BudgetPage() {
  const [tab, setTab]     = useState('Budget')
  const [state, setState] = useState<BudgetState>(buildInitialState)

  function handleChange(next: BudgetState) {
    setState(next)
    setBusinessField('budget', next)
    mirrorBudget(next)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 lg:py-8">
        <div className="mb-6 lg:mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Budget & Planning</h1>
          <p className="text-gray-400 mt-1">Your financial command center. Every number is connected.</p>
        </div>
        <TabBar tabs={TABS} active={tab} onChange={setTab} />
        {tab === 'Budget'           && <BudgetTab   state={state} onChange={handleChange} />}
        {tab === 'Historic Revenue' && <HistoricTab state={state} onChange={handleChange} />}
        {tab === 'Overhead'         && <OverheadTab state={state} onChange={handleChange} />}
        {tab === 'Crew & Labor'     && <CrewTab     state={state} onChange={handleChange} />}
        {tab === 'KPIs'             && <KPIsTab     state={state} />}
        {tab === 'Job Costing'     && <JobCostingTab state={state} />}
      </div>
    </div>
  )
}