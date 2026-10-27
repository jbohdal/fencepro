import React, { useState, useMemo, useEffect, useRef } from 'react'
import JobCostingTab from './JobCostingTab'
import { getQuotes } from './quoteStore'
import { companyTargets, yearActuals } from './moneyLoad'
import { marginOf, type TargetMargins } from './moneyTruth'
import NumberField from './NumberField'
import { dollarsToCents, centsToDollars, fractionToPercent, percentToFraction, parseCents } from './numberText'

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

import { getBusinessField, setBusinessField, whenBusinessStateSaved, BUSINESS_STATE_UPDATED_EVENT } from './businessStateStore'
import { useBackLayer } from './nav'

/**
 * A change to the budget, saved when a box is left (not on every key):
 * `what` names it for the Saved line and Undo. Changes with the same `key`
 * made within a moment of each other (a slider being dragged) are one Undo.
 */
type Commit = (next: BudgetState, what: string, opts?: { key?: string }) => void

/** Money kept in the budget in dollars, edited as whole cents. */
const cents = (dollars: number) => dollarsToCents(Number(dollars) || 0)
const dollars = (c: number) => centsToDollars(c)

/** A name typed in a box, saved when the box is left (Enter too). An empty name keeps the old one. */
function NameField({ value, onCommit, className = '', label, autoFocus, onDone }: { value: string; onCommit: (v: string) => void; className?: string; label: string; autoFocus?: boolean; onDone?: () => void }) {
  const [text, setText] = useState(value)
  const [editing, setEditing] = useState(false)
  useEffect(() => { if (!editing) setText(value) }, [value, editing])
  return (
    <input
      aria-label={label} autoFocus={autoFocus} value={text} enterKeyHint="done"
      onFocus={() => setEditing(true)}
      onChange={e => setText(e.target.value)}
      onBlur={() => { setEditing(false); const v = text.trim(); if (v && v !== value) onCommit(v); else setText(value); onDone?.() }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(value); setEditing(false); onDone?.() } }}
      className={`min-h-[44px] ${className}`}
    />
  )
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
    // Three a row on a phone, so every tab shows; one row on a computer.
    <div className="grid grid-cols-3 lg:flex gap-1 bg-gray-100 rounded-xl p-1 mb-6 lg:mb-8">
      {tabs.map(t => (
        <button
          key={t} onClick={() => onChange(t)} aria-pressed={active === t}
          className={`lg:flex-1 py-2.5 px-2 lg:px-4 rounded-lg text-sm font-medium leading-tight transition-all ${active === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800'}`}
        >
          {t}
        </button>
      ))}
    </div>
  )
}

function StatCard({ label, value, sub, accent }: { label: string, value: string, sub?: string, accent?: boolean }) {
  return (
    <div className={`rounded-2xl p-4 lg:p-5 min-w-0 ${accent ? 'bg-orange-500' : 'bg-white border border-gray-200'}`}>
      <p className={`text-xs font-semibold mb-1 ${accent ? 'text-orange-100' : 'text-gray-400'}`}>{label}</p>
      <p className={`text-xl lg:text-2xl font-bold break-words ${accent ? 'text-white' : 'text-gray-900'}`} data-budget-stat={label}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${accent ? 'text-orange-200' : 'text-gray-400'}`}>{sub}</p>}
    </div>
  )
}

/** Each Target Margin in Settings › Pricing and the styles at it ("44%: 12 styles, e.g. WV-ND 6'x8' Privacy"). */
function TargetLevels({ targets }: { targets: TargetMargins }) {
  return (
    <div className="text-gray-400 text-xs mt-2 space-y-0.5" data-budget-target-levels>
      <p>Overhead {targets.overheadPct}% + each style's Target Profit %. Price = (materials + labor) ÷ (100% − Target Margin).</p>
      {targets.levels.map(l => (
        <p key={l.pct}><span className="text-white font-semibold">{l.pct}%</span>: {l.styles.length} {l.styles.length === 1 ? 'style' : 'styles'}, e.g. {l.styles[0]}</p>
      ))}
    </div>
  )
}

function BucketBar({ label, actual: known, target, color, invertColor }: { label: string, actual: number | null, target: number, color: string, invertColor?: boolean }) {
  // Not known yet (no sold job with costs, or no overhead in the budget): a dash, never a made up number.
  if (known === null) return (
    <div data-budget-bucket={label} data-actual="">
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-sm font-medium text-gray-700">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">target {fmtPct(target)}</span>
          <span className="text-sm font-bold text-gray-400">—</span>
        </div>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden" />
    </div>
  )
  const actual = known
  const over = actual > target
  // For costs, over target is bad (red). For profit, over target is good (green).
  const isGood = invertColor ? over || Math.abs(actual - target) < 0.02 : !over
  return (
    <div data-budget-bucket={label} data-actual={actual.toFixed(4)}>
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

function BudgetTab({ state, onChange }: { state: BudgetState, onChange: Commit }) {
  const { revenueGoal, overheadPct, laborPct, materialsPct, vinylPct, aluminumPct, chainlinkPct, employees, overhead, seasonality } = state

  // Added up in whole cents, the way the Crew and Overhead tabs show them.
  const totalLaborCost    = dollars(employees.reduce((s, e) => s + Math.round(cents(e.hourlyRate) * (Number(e.annualHours) || 0)), 0))
  const totalOverheadCost = dollars(overhead.filter(o => !(o as any).parentId).reduce((s, o) => s + cents(o.annual), 0))
  const actualLaborPct    = revenueGoal > 0 ? totalLaborCost / revenueGoal : 0
  const actualOverheadPct = revenueGoal > 0 ? totalOverheadCost / revenueGoal : 0

  // Target net profit from the editable 4-bucket inputs (the same default as the box below)
  const targetNetProfitPct = state.netProfitPct ?? 0.106

  // The budget plan's split: overhead + net profit. Not what quotes are priced at (that is Settings › Pricing, below).
  const planMargin = overheadPct + targetNetProfitPct

  // Target Margin: one setting, Settings › Pricing (Overhead % + each style's Target Profit %), the same on every screen.
  const targets = companyTargets()
  const planDiffers = Math.abs(overheadPct * 100 - targets.overheadPct) >= 0.05

  // Actuals from real records only (moneyTruth.budgetActuals): sold quotes with costs this year, and the
  // budget's overhead over this year's installed revenue (projected to the full year).
  const currentYear = new Date().getFullYear()
  const act = useMemo(() => yearActuals(currentYear, totalOverheadCost), [currentYear, totalOverheadCost])
  const leftOutWords = act.leftOut ? `; ${act.leftOut} sold without costs left out` : ''

  const monthlyGoals      = seasonality.map(s => revenueGoal * s)
  const avg               = revenueGoal / 12

  return (
    <div className="space-y-8">

      {/* Target Margin = overhead + profit (Settings › Pricing) */}
      <div className="bg-gray-900 rounded-2xl p-4 lg:p-8 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <p className="text-gray-400 text-xs font-semibold mb-2">Target Margin — overhead plus profit, from Settings › Pricing</p>
          <p className="text-4xl lg:text-7xl font-black text-white leading-none" data-budget-target-margin>{targets.words}</p>
          <TargetLevels targets={targets} />
          <p className="text-gray-400 text-xs mt-2" data-budget-plan-note>
            Budget plan: overhead {fmtPct(overheadPct)} + net profit {fmtPct(targetNetProfitPct)} = <span data-budget-plan-margin>{fmtPct(planMargin)}</span>
            {planDiffers && <span className="text-yellow-300"> · Pricing uses overhead {targets.overheadPct}%: change one so they match.</span>}
          </p>
          <div className="flex flex-wrap gap-4 lg:gap-6 mt-4">
            <div>
              <p className="text-gray-500 text-xs">Labor Target</p>
              <p className="text-white font-bold text-lg">{fmtPct(laborPct)}</p>
              <p className="text-xs text-gray-300">actual {act.laborPct === null ? '—' : fmtPct(act.laborPct)}</p>
            </div>
            <div className="w-px bg-gray-700" />
            <div>
              <p className="text-gray-500 text-xs">Materials Target</p>
              <p className="text-white font-bold text-lg">{fmtPct(materialsPct)}</p>
              <p className="text-xs text-gray-300">actual {act.materialsPct === null ? '—' : fmtPct(act.materialsPct)}</p>
            </div>
            <div className="w-px bg-gray-700" />
            <div>
              <p className="text-gray-500 text-xs">Overhead Target</p>
              <p className="text-white font-bold text-lg">{fmtPct(overheadPct)}</p>
              <p className={`text-xs ${act.overheadPct === null ? 'text-gray-300' : act.overheadPct <= overheadPct + 0.02 ? 'text-green-400' : 'text-yellow-400'}`}>
                actual {act.overheadPct === null ? '—' : fmtPct(act.overheadPct)}
              </p>
            </div>
            <div className="w-px bg-gray-700" />
            <div>
              <p className="text-gray-500 text-xs">Net Profit Target</p>
              <p className={`font-bold text-lg ${targetNetProfitPct > 0.10 ? 'text-green-400' : targetNetProfitPct > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                {fmtPct(targetNetProfitPct)}
              </p>
              <p className={`text-xs ${act.netProfitPct === null ? 'text-gray-300' : act.netProfitPct >= targetNetProfitPct - 0.02 ? 'text-green-400' : 'text-red-400'}`}>
                estimated {act.netProfitPct === null ? '—' : fmtPct(act.netProfitPct)}
              </p>
            </div>
          </div>
        </div>
        <div className="text-left lg:text-right">
          <label htmlFor="budget-revenue-goal" className="block text-gray-400 text-xs mb-2">Annual Revenue Goal</label>
          <NumberField
            id="budget-revenue-goal" kind="money" look="plain" min={0}
            data-budget-field="revenueGoal"
            className="!text-2xl lg:!text-4xl font-black text-orange-400 text-left lg:text-right lg:w-64 border-b-2 border-gray-700 focus:border-orange-400 transition-colors pb-1"
            width="w-full lg:w-64"
            value={cents(revenueGoal)}
            onCommit={c => onChange({ ...state, revenueGoal: dollars(c) }, 'Annual revenue goal')}
          />
          <p className="text-gray-500 text-xs mt-2">tap to change</p>
        </div>
      </div>

      {/* KPI strip: actuals from real records, plans from this budget */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Net Profit (estimated)"
          value={act.netProfitPct === null ? '—' : fmtPct(act.netProfitPct)}
          sub={act.netProfitPct === null
            ? (act.withCosts ? 'Needs the yearly overhead in this budget' : 'Needs sold jobs with costs')
            : `${fmtPct(act.grossMargin ?? 0)} gross margin on ${act.withCosts} sold jobs with costs − ${fmtPct(act.overheadPct ?? 0)} overhead${leftOutWords} · target ${fmtPct(targetNetProfitPct)}`}
          accent={act.netProfitPct !== null && act.netProfitPct >= targetNetProfitPct - 0.02}
        />
        <StatCard label="Crew Wages (budget)" value={fmt(totalLaborCost)} sub={`${fmtPct(actualLaborPct)} of the revenue goal · target ${fmtPct(laborPct)}`} />
        <StatCard label="Overhead (budget)" value={fmt(totalOverheadCost)}
          sub={`${fmtPct(actualOverheadPct)} of the revenue goal${act.overheadPct === null ? '' : ` · ${fmtPct(act.overheadPct)} of ${fmt(act.yearRevenueCents / 100)} installed${act.projected ? ' (this year, projected)' : ''}`} · target ${fmtPct(overheadPct)}`} />
        <StatCard
          label="Materials"
          value={act.materialsPct === null ? '—' : fmtPct(act.materialsPct)}
          sub={act.materialsPct === null ? `No sold jobs with costs yet · target ${fmtPct(materialsPct)}` : `of the price on ${act.withCosts} sold jobs with costs${leftOutWords} · target ${fmtPct(materialsPct)}`}
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
              onClick={() => onChange({ ...state, seasonalityLocked: !state.seasonalityLocked }, state.seasonalityLocked ? 'Seasonality unlocked' : 'Seasonality locked')}
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
          <p className="text-xs text-gray-400 mb-5">Every revenue dollar flows into one of these. Actual: materials and labor on sold jobs with costs, overhead over installed revenue, net profit what is left.</p>
          <div className="space-y-5">
            <BucketBar label="Overhead"      actual={act.overheadPct}     target={overheadPct}        color="bg-blue-400" />
            <BucketBar label="Labor & Comms" actual={act.laborPct}        target={laborPct}           color="bg-purple-400" />
            <BucketBar label="Materials"     actual={act.materialsPct}    target={materialsPct}       color="bg-yellow-400" />
            <BucketBar label="Net Profit"    actual={act.netProfitPct}    target={targetNetProfitPct} color="bg-green-400" invertColor />
          </div>
          <div className="mt-6 pt-5 border-t border-gray-100 space-y-3">
            {[
              { label: 'Overhead',    key: 'overheadPct',  val: overheadPct },
              { label: 'Labor',       key: 'laborPct',     val: laborPct },
              { label: 'Materials',   key: 'materialsPct', val: materialsPct },
              { label: 'Net Profit',  key: 'netProfitPct', val: state.netProfitPct ?? 0.106 },
            ].map(f => (
              <div key={f.key} className="flex items-center justify-between gap-3">
                <label htmlFor={`budget-${f.key}`} className="text-sm text-gray-600">{f.label} target</label>
                <NumberField
                  id={`budget-${f.key}`} kind="percent" decimals={2} min={0} max={100} width="w-28"
                  data-budget-field={f.key}
                  value={fractionToPercent(f.val)}
                  onCommit={p => onChange({ ...state, [f.key]: percentToFraction(p) }, `${f.label} target`)}
                />
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
                    <span className={`text-xs font-bold ${over || under ? 'text-red-500' : 'text-green-600'}`} data-budget-bucket-total>
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
      <div className="bg-white rounded-2xl border border-gray-200 p-4 lg:p-6">
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
        <p className="text-sm text-gray-400 mb-5">Must total exactly 100%. Type a percent or drag the slider until the indicator turns green.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {[
            { label: 'Vinyl',     key: 'vinylPct',     val: vinylPct,            color: 'bg-orange-400' },
            { label: 'Aluminum',  key: 'aluminumPct',  val: aluminumPct,         color: 'bg-blue-400' },
            { label: 'Chainlink', key: 'chainlinkPct', val: chainlinkPct,        color: 'bg-gray-400' },
            { label: 'Misc/Other',key: 'miscPct',      val: state.miscPct ?? 0.02, color: 'bg-green-300' },
          ].map(f => (
            <div key={f.label}>
              <div className="flex items-center justify-between gap-3 mb-2">
                <label htmlFor={`budget-${f.key}`} className="text-sm font-medium text-gray-700">{f.label}</label>
                <NumberField
                  id={`budget-${f.key}`} kind="percent" decimals={2} min={0} max={100} width="w-28"
                  data-budget-field={f.key}
                  value={fractionToPercent(f.val)}
                  onCommit={p => onChange({ ...state, [f.key]: percentToFraction(p) }, `${f.label} share`)}
                />
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
                <div className={`h-full ${f.color} rounded-full`} style={{ width: `${Math.min(f.val * 100, 100)}%` }} />
              </div>
              <p className="text-xs text-gray-400" data-budget-mix-dollars={f.key}>{fmt(revenueGoal * f.val)} a year</p>
              <input
                type="range" min={0} max={100} step={1}
                aria-label={`${f.label} share slider`}
                className="w-full mt-2 accent-orange-500"
                value={Math.round(f.val * 100)}
                onChange={e => onChange({ ...state, [f.key]: Number(e.target.value) / 100 }, `${f.label} share`, { key: `slider-${f.key}` })}
              />
            </div>
          ))}
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
                <span className={`text-sm font-bold ${over || under ? 'text-red-500' : 'text-green-600'}`} data-budget-mix-total>{pct}%</span>
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
    </div>
  )
}

// ── Historic Revenue Tab ──────────────────────────────────────────────────────

function HistoricTab({ state, onChange }: { state: BudgetState, onChange: Commit }) {
  const { historic } = state
  const computedSeasonality = useMemo(() => calcSeasonality(historic), [historic])

  function updateMonth(yearIdx: number, monthIdx: number, valueCents: number) {
    const updated = historic.map((y, yi) =>
      yi === yearIdx
        ? { ...y, months: y.months.map((m, mi) => mi === monthIdx ? dollars(valueCents) : m) }
        : y
    )
    onChange({ ...state, historic: updated, seasonality: calcSeasonality(updated), seasonalityLocked: true }, `${MONTHS[monthIdx]} ${historic[yearIdx].year} revenue`)
  }

  const monthBox = (y: HistoricYear, yi: number, m: number, mi: number, width: string) => (
    <NumberField
      kind="money" min={0} width={width} placeholder="$0"
      label={`${MONTHS[mi]} ${y.year} revenue`}
      data-budget-field={`historic-${y.year}-${mi}`}
      className="!text-xs lg:!text-xs"
      value={cents(m)}
      onCommit={c => updateMonth(yi, mi, c)}
    />
  )

  const yearColors = ['rgba(99,102,241,0.7)', 'rgba(59,130,246,0.7)', 'rgba(16,185,129,0.7)', 'rgba(249,115,22,0.7)', 'rgba(236,72,153,0.7)']

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Historic Revenue</h2>
          <p className="text-sm text-gray-400 mt-0.5">Enter monthly actuals. Seasonality auto-calculates and locks in to drive projections.</p>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 md:text-right">
          <p className="text-xs text-orange-600 font-semibold">Seasonality locked from historic data</p>
          <p className="text-xs text-gray-400 mt-0.5">Edit any cell to recalculate</p>
        </div>
      </div>

      {/* Year legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {historic.map((y, i) => (
          <div key={y.year} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: yearColors[i] }} />
            <span className="text-xs text-gray-500 font-medium">{y.year}</span>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
        <h3 className="font-bold text-gray-900 mb-4">Revenue by Year</h3>
        <BarChart
          values={historic.map(y => y.months)}
          labels={MONTHS}
          colors={yearColors}
          height={220}
        />
      </div>

      {/* Phone: one card a year, three months a row */}
      <div className="md:hidden space-y-4">
        {historic.map((y, yi) => (
          <div key={y.year} className="bg-white rounded-2xl border border-gray-200 p-4">
            <div className="flex items-baseline justify-between mb-3">
              <p className="font-bold text-gray-900">{y.year}</p>
              <p className="text-sm font-bold text-gray-900" data-budget-historic-total={y.year}>{fmt(y.months.reduce((a, b) => a + b, 0))}</p>
            </div>
            <div className="grid grid-cols-3 gap-x-2 gap-y-3">
              {y.months.map((m, mi) => (
                <div key={mi} className="min-w-0">
                  <p className="text-xs text-gray-500 mb-1">{MONTHS[mi]}</p>
                  {monthBox(y, yi, m, mi, 'w-full')}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Input table */}
      <div className="hidden md:block bg-white rounded-2xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 w-16">Year</th>
              {MONTHS.map(m => <th key={m} className="text-right px-1 py-3 text-xs font-semibold text-gray-500">{m}</th>)}
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Total</th>
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
                      {monthBox(y, yi, m, mi, 'w-[76px]')}
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right font-bold text-gray-900 text-xs whitespace-nowrap" data-budget-historic-total={y.year}>{fmt(total)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Seasonality bars */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
        <h3 className="font-bold text-gray-900 mb-5">Seasonality Distribution</h3>
        <div className="flex items-end gap-0.5 md:gap-2" style={{ height: 100 }}>
          {computedSeasonality.map((pct, i) => (
            <div key={i} className="flex-1 min-w-0 flex flex-col items-center gap-1">
              <span className="text-[9px] md:text-xs text-gray-500 font-medium whitespace-nowrap">{fmtPct(pct)}</span>
              <div
                className="w-full bg-orange-400 rounded-t"
                style={{ height: `${Math.max((pct / Math.max(...computedSeasonality)) * 64, 4)}px` }}
              />
              <span className="text-[10px] md:text-xs text-gray-400">{MONTHS[i]}</span>
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
  useBackLayer(onClose, { key: 'overhead-drawer' })
  const [mode, setMode] = useState<'single' | 'bulk'>('single')
  const [label, setLabel] = useState('')
  const [annualCents, setAnnualCents] = useState(0)
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
      annual: dollars(annualCents),
      category,
      parentId,
      order: accounts.filter(a => a.category === category).length,
    }
    onAdd([newItem])
    setLabel('')
    setAnnualCents(0)
  }

  function handleBulk() {
    setBulkError('')
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    const parsed: OverheadAccount[] = []
    for (const line of lines) {
      // The name is up to the first comma; the rest is the amount, so "Fuel, $15,000" is $15,000.
      const cut = line.indexOf(',')
      const itemLabel = (cut < 0 ? line : line.slice(0, cut)).trim().replace(/^[-*]\s*/, '')
      const rawAmt = cut < 0 ? '0' : line.slice(cut + 1).trim() || '0'
      const amtCents = parseCents(rawAmt)
      if (!itemLabel) continue
      parsed.push({
        id: uid(),
        label: itemLabel,
        annual: amtCents == null ? 0 : dollars(amtCents),
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
      <div className="w-full max-w-sm bg-white shadow-2xl flex flex-col h-full overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Add Expense</h2>
          <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
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
                <label htmlFor="budget-new-expense-annual" className="text-xs text-gray-500 mb-1 block font-medium">Annual Amount</label>
                <NumberField
                  id="budget-new-expense-annual" kind="money" min={0} className="!text-left"
                  value={annualCents} onCommit={setAnnualCents}
                />
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
                className="btn btn-primary w-full"
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
                className="btn btn-primary w-full"
              >
                Import Items
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Overhead Tab ──────────────────────────────────────────────────────────────

/**
 * A group's own amount is the sum of the lines under it: the totals (and
 * live overhead for pricing, liveOverhead.ts) add up top level lines only,
 * so a group has to carry its lines' sum.
 */
function withGroupTotals(accounts: OverheadAccount[]): OverheadAccount[] {
  const sums = new Map<string, number>()
  for (const a of accounts) if (a.parentId) sums.set(a.parentId, (sums.get(a.parentId) ?? 0) + cents(a.annual))
  return accounts.map(a => sums.has(a.id) ? { ...a, annual: dollars(sums.get(a.id)!) } : a)
}

/** Yearly and monthly are linked: a month is a twelfth of the year, to the cent. */
const monthlyCents = (annualDollars: number) => Math.round(cents(annualDollars) / 12)

function AccountRow({
  account, depth, children, expanded, editingName, categories, revenueGoal,
  onToggle, onRename, onStartRename, onStopRename, onField, onAmount, onMove, onRemove,
}: {
  account: OverheadAccount
  depth: number
  children: OverheadAccount[]
  expanded: boolean
  editingName: boolean
  categories: string[]
  revenueGoal: number
  onToggle: () => void
  onRename: (label: string) => void
  onStartRename: () => void
  onStopRename: () => void
  onField: (field: 'category', val: string) => void
  onAmount: (annualCents: number, what: string) => void
  onMove: (dir: 'up' | 'down') => void
  onRemove: () => void
}) {
  const hasChildren = children.length > 0
  const displayAmt = hasChildren ? dollars(children.reduce((s, c) => s + cents(c.annual), 0)) : account.annual
  const name = account.label
  return (
    <div
      className="group grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_9rem_9rem_8rem_4rem_8.5rem] lg:items-center lg:gap-y-0 lg:py-1.5 hover:bg-gray-50"
      data-budget-account={account.id}
    >
      {/* Name */}
      <div className="col-span-2 lg:col-span-1 flex items-center gap-1 min-w-0" style={{ paddingLeft: `${depth * 20}px` }}>
        {hasChildren ? (
          <button
            onClick={onToggle} aria-expanded={expanded} aria-label={`${expanded ? 'Hide' : 'Show'} the lines under ${name}`}
            className="min-w-[44px] min-h-[44px] -ml-3 inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xs"
          >{expanded ? '▼' : '▶'}</button>
        ) : <span className="w-8 shrink-0" />}
        {editingName ? (
          <NameField
            autoFocus label={`Name of ${name}`} value={name}
            onCommit={onRename} onDone={onStopRename}
            className="flex-1 min-w-0 border-b border-orange-400 outline-none text-sm font-medium text-gray-900 bg-transparent"
          />
        ) : (
          <button
            onClick={onStartRename} title="Tap to rename"
            className={`flex-1 min-w-0 text-left text-sm hover:text-orange-600 ${depth > 0 ? 'text-gray-600' : 'font-medium text-gray-800'}`}
          >{name}</button>
        )}
      </div>

      {/* Yearly */}
      <div className="min-w-0 lg:order-2">
        <span className="block text-xs text-gray-500 mb-1 lg:hidden">Yearly</span>
        {hasChildren ? (
          <p className="min-h-[44px] flex items-center justify-end text-sm font-bold text-gray-700 font-mono" data-budget-group-total={account.id} title="The sum of the lines under it">{fmt(displayAmt)}</p>
        ) : (
          <NumberField
            kind="money" min={0} label={`${name}, yearly`}
            data-budget-field={`overhead-${account.id}-annual`}
            value={cents(account.annual)}
            onCommit={c => onAmount(c, `${name}, yearly`)}
          />
        )}
      </div>

      {/* Monthly */}
      <div className="min-w-0 lg:order-3">
        <span className="block text-xs text-gray-500 mb-1 lg:hidden">Monthly</span>
        {hasChildren ? (
          <p className="min-h-[44px] flex items-center justify-end text-sm text-gray-500 font-mono">{fmt(displayAmt / 12)}</p>
        ) : (
          <NumberField
            kind="money" min={0} label={`${name}, monthly`}
            data-budget-field={`overhead-${account.id}-monthly`}
            value={monthlyCents(account.annual)}
            onCommit={c => onAmount(c * 12, `${name}, monthly`)}
          />
        )}
      </div>

      {/* Category */}
      <div className="min-w-0 lg:order-1">
        <span className="block text-xs text-gray-500 mb-1 lg:hidden">Category</span>
        <select
          aria-label={`Category of ${name}`}
          className="w-full min-h-[44px] text-sm lg:text-xs text-gray-600 border border-gray-200 rounded-lg px-2 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white"
          value={account.category}
          onChange={e => onField('category', e.target.value)}
        >
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* % of revenue */}
      <div className="min-w-0 lg:order-4 flex items-end lg:items-center lg:justify-end">
        <span className="text-xs text-gray-500 mr-1 lg:hidden">Of revenue</span>
        <span className="text-sm lg:text-xs font-medium text-gray-500" data-budget-account-pct={account.id}>{revenueGoal > 0 ? fmtPct(displayAmt / revenueGoal) : '—'}</span>
      </div>

      {/* Move and remove: always there on a phone, on hover on a computer */}
      <div className="col-span-2 lg:col-span-1 flex items-center justify-end gap-0.5 lg:order-5 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100 transition-opacity">
        <button onClick={() => onMove('up')} aria-label={`Move ${name} up`} title="Move up" className="min-w-[44px] min-h-[44px] inline-grid place-items-center text-gray-400 hover:text-gray-700 text-xs rounded">▲</button>
        <button onClick={() => onMove('down')} aria-label={`Move ${name} down`} title="Move down" className="min-w-[44px] min-h-[44px] inline-grid place-items-center text-gray-400 hover:text-gray-700 text-xs rounded">▼</button>
        <button onClick={onRemove} aria-label={`Remove ${name}`} title="Remove" className="min-w-[44px] min-h-[44px] inline-grid place-items-center text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
      </div>
    </div>
  )
}

function OverheadTab({ state, onChange }: { state: BudgetState, onChange: Commit }) {
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

  const setAccounts = (next: OverheadAccount[], what: string) => onChange({ ...state, overhead: withGroupTotals(next) as any }, what)

  function addCategory() {
    if (!newCatName.trim()) return
    if (categories.includes(newCatName.trim())) { setNewCatName(''); return }
    onChange({ ...state, overheadCategories: [...categories, newCatName.trim()] }, `New category ${newCatName.trim()}`)
    setNewCatName('')
  }

  function renameCategory(idx: number, val: string) {
    const oldName = categories[idx]
    // Two categories with one name would merge their lines for good: keep the old name.
    if (!val || categories.some((c, i) => i !== idx && c === val)) return
    const updated = categories.map((c, i) => i === idx ? val : c)
    const updatedAccounts = accounts.map(a => a.category === oldName ? { ...a, category: val } : a)
    onChange({ ...state, overheadCategories: updated, overhead: updatedAccounts as any }, `Category ${oldName} renamed`)
  }

  function removeCategory(idx: number) {
    const cat = categories[idx]
    if (accounts.some(a => a.category === cat)) {
      alert(`Move or delete all expenses in "${cat}" before removing it.`)
      return
    }
    onChange({ ...state, overheadCategories: categories.filter((_, i) => i !== idx) }, `Category ${cat} removed`)
  }

  const sumDollars = (list: OverheadAccount[]) => dollars(list.reduce((s, a) => s + cents(a.annual), 0))
  const total = sumDollars(accounts.filter(a => a.parentId === null))
  const actualPct = revenueGoal > 0 ? total / revenueGoal : 0
  const overTarget = actualPct > overheadPct

  const byCategory = categories.map(cat => {
    const topLevel = accounts
      .filter(a => a.category === cat && a.parentId === null)
      .sort((a, b) => a.order - b.order)
    return { cat, topLevel, total: sumDollars(topLevel) }
  })

  function getChildren(parentId: string) {
    return accounts.filter(a => a.parentId === parentId).sort((a, b) => a.order - b.order)
  }

  function updateAccount(id: string, field: 'label' | 'category', val: string, what: string) {
    setAccounts(accounts.map(a => a.id === id ? { ...a, [field]: val } : a), what)
  }

  function setAmount(id: string, annualCents: number, what: string) {
    setAccounts(accounts.map(a => a.id === id ? { ...a, annual: dollars(annualCents) } : a), what)
  }

  function removeAccount(id: string) {
    const a = accounts.find(x => x.id === id)
    setAccounts(accounts.filter(x => x.id !== id && x.parentId !== id), `${a?.label ?? 'Expense'} removed`)
  }

  function addAccounts(items: OverheadAccount[]) {
    setAccounts([...accounts, ...items], items.length === 1 ? `${items[0].label} added` : `${items.length} expenses added`)
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
    setAccounts(updated, `${item.label} moved ${dir}`)
  }

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // A plain function, not a component: a component made here would be new on
  // every change, and React would throw away the box being typed in.
  function rows(account: OverheadAccount, depth: number): React.ReactNode {
    const children = getChildren(account.id)
    const expanded = expandedIds.has(account.id)
    return (
      <React.Fragment key={account.id}>
        <AccountRow
          account={account} depth={depth} children={children} expanded={expanded}
          editingName={editingId === account.id} categories={categories} revenueGoal={revenueGoal}
          onToggle={() => toggleExpand(account.id)}
          onStartRename={() => setEditingId(account.id)}
          onStopRename={() => setEditingId(null)}
          onRename={label => updateAccount(account.id, 'label', label, `${account.label} renamed`)}
          onField={(field, val) => updateAccount(account.id, field, val, `${account.label} category`)}
          onAmount={(c, what) => setAmount(account.id, c, what)}
          onMove={dir => moveItem(account.id, dir)}
          onRemove={() => removeAccount(account.id)}
        />
        {children.length > 0 && expanded && children.map(child => rows(child, depth + 1))}
      </React.Fragment>
    )
  }

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Overhead Expenses</h2>
          <p className="text-sm text-gray-400 mt-0.5">Full chart of accounts. Tap a name to rename it. Type a yearly or a monthly amount; the other follows. Changes update the Budget tab instantly.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className={`rounded-2xl px-5 py-3 text-right ${overTarget ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
            <p className={`text-2xl font-black ${overTarget ? 'text-red-600' : 'text-green-600'}`} data-budget-overhead-pct>{fmtPct(actualPct)}</p>
            <p className="text-xs text-gray-500 mt-0.5">target {fmtPct(overheadPct)} · <span data-budget-overhead-total>{fmt(total)}</span>/yr</p>
          </div>
          <button
            onClick={() => setShowDrawer(true)}
            className="btn btn-primary"
          >
            + Add Expense
          </button>
        </div>
      </div>

      {/* Category summary pills */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {byCategory.map(({ cat, topLevel, total: catTotal }, idx) => (
          <div key={idx} className={`rounded-xl border p-4 group relative min-w-0 ${getCategoryColor(categories, cat)}`}>
            {editingCatIdx === idx ? (
              <NameField
                autoFocus label={`Name of category ${cat}`} value={cat}
                onCommit={v => renameCategory(idx, v)} onDone={() => setEditingCatIdx(null)}
                className="text-xs font-bold bg-transparent outline-none border-b border-current w-full mb-1 pr-10"
              />
            ) : (
              <button
                className="block text-left text-xs font-semibold opacity-70 cursor-pointer hover:opacity-100 pr-10"
                onClick={() => setEditingCatIdx(idx)}
                title="Tap to rename"
              >
                {cat} ✎
              </button>
            )}
            <p className="text-xl font-bold mt-1" data-budget-category-total={cat}>{fmt(catTotal)}</p>
            <p className="text-xs opacity-60 mt-0.5">{topLevel.length} items · {fmt(catTotal / 12)}/mo</p>
            <button
              onClick={() => removeCategory(idx)}
              aria-label={`Remove category ${cat}`}
              className="min-w-[44px] min-h-[44px] inline-grid place-items-center absolute top-0 right-0 text-current opacity-40 lg:opacity-0 lg:group-hover:opacity-40 hover:opacity-100 text-sm leading-none"
              title="Remove category"
            >×</button>
          </div>
        ))}

        {/* Add category tile */}
        <div className="rounded-xl border border-dashed border-gray-300 p-4 flex flex-col justify-center min-w-0">
          <label htmlFor="budget-new-category" className="text-xs text-gray-400 mb-2 font-medium">New Category</label>
          <input
            id="budget-new-category"
            className="min-h-[44px] border border-gray-300 rounded-lg px-2 py-1 text-sm lg:text-xs focus:outline-none focus:ring-2 focus:ring-orange-400 mb-2"
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

      {/* Chart of accounts: a table on a computer, one card a line on a phone */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="px-4 lg:px-5 py-3 bg-gray-50 border-b border-gray-200 flex flex-wrap items-center justify-between gap-1">
          <p className="text-xs font-semibold text-gray-500">Chart of Accounts</p>
          <p className="text-xs text-gray-400">Tap a name to rename · Enter goes to the next box</p>
        </div>
        <div className="hidden lg:grid grid-cols-[minmax(0,1fr)_9rem_9rem_8rem_4rem_8.5rem] gap-x-3 px-4 py-2.5 border-b border-gray-100 text-xs font-semibold text-gray-400">
          <span className="pl-9">Expense</span>
          <span>Category</span>
          <span className="text-right">Yearly</span>
          <span className="text-right">Monthly</span>
          <span className="text-right">% Rev</span>
          <span />
        </div>
        <div className="divide-y divide-gray-100">
          {byCategory.map(({ cat, topLevel }) =>
            topLevel.length === 0 ? null : (
              <React.Fragment key={cat}>
                <div className="bg-gray-50 px-4 lg:px-5 py-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${getCategoryColor(categories, cat)}`}>
                    {cat}
                  </span>
                </div>
                {topLevel.map(account => rows(account, 0))}
              </React.Fragment>
            )
          )}
        </div>
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
            <p className="text-white font-bold text-lg" data-budget-overhead-monthly>{fmt(total / 12)}</p>
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

function CrewTab({ state, onChange }: { state: BudgetState, onChange: Commit }) {
  const { employees, revenueGoal, laborPct } = state
  // Each person's yearly cost to the cent: rate (cents) × hours.
  const annualOf = (e: Employee) => dollars(Math.round(cents(e.hourlyRate) * (Number(e.annualHours) || 0)))
  const totalCost = employees.reduce((s, e) => s + annualOf(e), 0)
  const actualPct = revenueGoal > 0 ? totalCost / revenueGoal : 0
  const overTarget = actualPct > laborPct

  function updateEmp(id: string, field: keyof Employee, val: string | number, what: string) {
    onChange({ ...state, employees: employees.map(e => e.id === id ? { ...e, [field]: val } : e) }, what)
  }

  function addEmp() {
    onChange({ ...state, employees: [...employees, { id: uid(), name: 'New', role: 'Installer', hourlyRate: 20, annualHours: 2040 }] }, 'Team member added')
  }

  function removeEmp(id: string) {
    const e = employees.find(x => x.id === id)
    onChange({ ...state, employees: employees.filter(e => e.id !== id) }, `${e?.name ?? 'Team member'} removed`)
  }

  const cols = 'lg:grid-cols-[2rem_minmax(0,1fr)_9rem_8rem_8rem_8rem_4.5rem_3rem]'

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Crew & Labor</h2>
          <p className="text-sm text-gray-400 mt-0.5">Every team member ties directly into the labor bucket.</p>
        </div>
        <div className={`rounded-2xl px-4 lg:px-6 py-4 text-right ${overTarget ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          <p className={`text-2xl lg:text-3xl font-black ${overTarget ? 'text-red-600' : 'text-green-600'}`} data-budget-labor-pct>{fmtPct(actualPct)}</p>
          <p className="text-xs text-gray-500 mt-1">target {fmtPct(laborPct)} · <span data-budget-labor-total>{fmt(totalCost)}</span>/yr</p>
        </div>
      </div>

      {/* A table on a computer, one card a person on a phone */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className={`hidden lg:grid ${cols} gap-x-3 bg-gray-50 border-b border-gray-200 px-4 py-3 text-xs font-semibold text-gray-500`}>
          <span>#</span>
          <span>Name</span>
          <span>Role</span>
          <span className="text-right">$/hr</span>
          <span className="text-right">Hrs/yr</span>
          <span className="text-right">Annual Cost</span>
          <span className="text-right">% Rev</span>
          <span />
        </div>
        <div className="divide-y divide-gray-100">
          {employees.map((emp, idx) => {
            const annual = annualOf(emp)
            return (
              <div key={emp.id} className={`group grid grid-cols-2 gap-x-3 gap-y-2 px-4 py-3 lg:items-center lg:gap-y-0 lg:py-1.5 ${cols} hover:bg-gray-50`} data-budget-employee={emp.id}>
                <span className="hidden lg:block text-gray-400 text-xs">{idx + 1}</span>
                <div className="col-span-2 lg:col-span-1 min-w-0 flex items-center gap-2">
                  <NameField
                    label={`Name of team member ${idx + 1}`} value={emp.name}
                    onCommit={v => updateEmp(emp.id, 'name', v, `${emp.name} renamed`)}
                    className="flex-1 min-w-0 border-b border-transparent hover:border-gray-200 focus:border-orange-400 outline-none text-sm font-medium text-gray-900 bg-transparent"
                  />
                  <button onClick={() => removeEmp(emp.id)} aria-label={`Remove ${emp.name}`} title="Remove" className="lg:hidden min-w-[44px] min-h-[44px] inline-grid place-items-center text-gray-400 hover:text-red-500 text-lg leading-none">×</button>
                </div>
                <div className="col-span-2 lg:col-span-1 min-w-0">
                  <span className="block text-xs text-gray-500 mb-1 lg:hidden">Role</span>
                  <select
                    aria-label={`Role of ${emp.name}`}
                    className="w-full min-h-[44px] text-sm lg:text-xs text-gray-600 border border-gray-200 rounded-lg px-2 focus:outline-none focus:ring-1 focus:ring-orange-400 bg-white"
                    value={emp.role}
                    onChange={e => updateEmp(emp.id, 'role', e.target.value, `${emp.name} role`)}
                  >
                    {['Foreman', 'CO Foreman', 'Installer', 'Other'].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div className="min-w-0">
                  <span className="block text-xs text-gray-500 mb-1 lg:hidden">$ an hour</span>
                  <NumberField
                    kind="money" min={0} cents={true} label={`${emp.name}, dollars an hour`}
                    data-budget-field={`employee-${emp.id}-rate`}
                    value={cents(emp.hourlyRate)}
                    onCommit={c => updateEmp(emp.id, 'hourlyRate', dollars(c), `${emp.name}, $ an hour`)}
                  />
                </div>
                <div className="min-w-0">
                  <span className="block text-xs text-gray-500 mb-1 lg:hidden">Hours a year</span>
                  <NumberField
                    kind="number" decimals={2} min={0} max={8784} label={`${emp.name}, hours a year`}
                    data-budget-field={`employee-${emp.id}-hours`}
                    value={Number(emp.annualHours) || 0}
                    onCommit={h => updateEmp(emp.id, 'annualHours', h, `${emp.name}, hours a year`)}
                  />
                </div>
                <div className="min-w-0 lg:text-right">
                  <span className="text-xs text-gray-500 mr-1 lg:hidden">Yearly cost</span>
                  <span className="font-bold text-gray-900 font-mono text-sm" data-budget-employee-annual={emp.id}>{fmt(annual)}</span>
                </div>
                <div className="min-w-0 text-right">
                  <span className="text-xs text-gray-500 mr-1 lg:hidden">Of revenue</span>
                  <span className="text-xs font-medium text-gray-500">{revenueGoal > 0 ? fmtPct(annual / revenueGoal) : '—'}</span>
                </div>
                <div className="hidden lg:flex justify-end">
                  <button onClick={() => removeEmp(emp.id)} aria-label={`Remove ${emp.name}`} title="Remove" className="min-w-[44px] min-h-[44px] inline-grid place-items-center text-gray-300 hover:text-red-400 lg:opacity-0 lg:group-hover:opacity-100 lg:focus:opacity-100 text-lg leading-none">×</button>
                </div>
              </div>
            )
          })}
        </div>
        <div className={`grid grid-cols-2 gap-x-3 ${cols} bg-gray-50 border-t border-gray-200 px-4 py-3`}>
          <span className="lg:col-span-5 font-bold text-gray-900">{employees.length} team members</span>
          <span className="text-right font-bold text-gray-900 font-mono">{fmt(totalCost)}</span>
          <span className={`hidden lg:block text-right font-bold text-sm ${overTarget ? 'text-red-500' : 'text-green-600'}`}>{fmtPct(actualPct)}</span>
          <span className="hidden lg:block" />
        </div>
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
  const targets = companyTargets()

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
        // Gross margin of the month's sold quotes with costs (null: none has a cost).
        margin: marginOf(soldQuotes).margin,
        quotedValue: monthQuotes.reduce((s, q) => s + q.finalPrice, 0),
      }
    })
  }, [yearQuotes])

  const totalRevenue = monthlyData.reduce((s, m) => s + m.revenue, 0)
  const totalQuoted  = monthlyData.reduce((s, m) => s + m.quoted, 0)
  const totalSold    = monthlyData.reduce((s, m) => s + m.sold, 0)
  const closingRate  = totalQuoted > 0 ? totalSold / totalQuoted : 0
  const pctOfGoal    = revenueGoal > 0 ? totalRevenue / revenueGoal : 0

  // Actual shares: the same as the Budget tab and Reports (moneyTruth.budgetActuals): sold jobs with costs only.
  const totalOverhead = state.overhead.filter((o: any) => !(o as any).parentId).reduce((s: number, o: any) => s + (o.annual || 0), 0)
  const act = useMemo(() => yearActuals(currentYear, totalOverhead), [currentYear, totalOverhead])

  const goals    = seasonality.map(s => revenueGoal * s)
  const actRevs  = monthlyData.map(m => m.revenue)

  return (
    <div className="space-y-6">
      {/* Hero KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-gray-900 rounded-2xl p-5 sm:col-span-2">
          <p className="text-gray-400 text-xs font-semibold mb-1">Revenue vs Goal (from Sold Quotes)</p>
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
        <StatCard label="Actual Gross Margin" value={act.grossMargin === null ? '—' : fmtPct(act.grossMargin)} sub={`${act.withCosts} sold jobs with costs${act.leftOut ? `, ${act.leftOut} without left out` : ''} · Target Margin ${targets.words}`} accent={act.grossMargin !== null && act.grossMargin * 100 >= targets.minPct - 0.5} />
      </div>

      {/* Actual vs Goal chart */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
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
      <div className="bg-white rounded-2xl border border-gray-200 p-4 md:p-6">
        <h3 className="font-bold text-gray-900 mb-1">Budget Health — Actual vs Targets</h3>
        <p className="text-xs text-gray-400 mb-5">Materials and labor from the {act.withCosts} sold jobs with costs{act.leftOut ? ` (${act.leftOut} without costs left out)` : ''}; overhead from this budget over installed revenue</p>
        <div className="space-y-5">
          <BucketBar label="Materials (from jobs)"  actual={act.materialsPct}  target={materialsPct}       color="bg-yellow-400" />
          <BucketBar label="Labor (from jobs)"      actual={act.laborPct}      target={laborPct}           color="bg-purple-400" />
          <BucketBar label="Overhead (annualized)"  actual={act.overheadPct}   target={overheadPct}        color="bg-blue-400" />
          <BucketBar label="Net Profit (estimated)" actual={act.netProfitPct}  target={targetNetProfitPct} color="bg-green-400" invertColor />
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
              <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500">Month</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Goal</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Actual</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Variance</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Quoted</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Sold</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Close %</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Avg GM</th>
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
                    {monthlyData[i].margin !== null && (
                      <span className={`text-xs font-bold ${monthlyData[i].margin! * 100 >= targets.minPct - 0.5 ? 'text-green-600' : 'text-yellow-600'}`}>
                        {fmtPct(monthlyData[i].margin!)}
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
                {act.grossMargin !== null && <span className={`text-xs ${act.grossMargin * 100 >= targets.minPct - 0.5 ? 'text-green-600' : 'text-yellow-600'}`}>{fmtPct(act.grossMargin)}</span>}
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

interface SaveNote { what: string; status: 'saving' | 'saved' | 'waiting'; undone?: boolean }

export default function BudgetPage() {
  const [tab, setTab]     = useState('Budget')
  const [state, setState] = useState<BudgetState>(buildInitialState)
  const [note, setNote]   = useState<SaveNote | null>(null)
  // The last change, for Undo: the budget before it, and after it.
  const [last, setLast]   = useState<{ prev: BudgetState; next: BudgetState; what: string; key: string; at: number } | null>(null)
  // The saved budget this screen last read or wrote, to tell a change from elsewhere.
  const seen = useRef<unknown>(getBusinessField('budget'))
  const seq = useRef(0)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Saved from another phone or computer (or merged after a clash): show it.
  useEffect(() => {
    const onUpdate = () => {
      const raw = getBusinessField('budget')
      if (raw === seen.current) return
      seen.current = raw
      setState(buildInitialState())
      setLast(null)
    }
    window.addEventListener(BUSINESS_STATE_UPDATED_EVENT, onUpdate)
    return () => {
      window.removeEventListener(BUSINESS_STATE_UPDATED_EVENT, onUpdate)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    }
  }, [])

  function save(next: BudgetState, what: string, undone = false) {
    seen.current = next
    setState(next)
    setBusinessField('budget', next)
    const n = ++seq.current
    if (hideTimer.current) clearTimeout(hideTimer.current)
    setNote({ what, status: 'saving', undone })
    void whenBusinessStateSaved().then(ok => {
      if (seq.current !== n) return
      setNote({ what, status: ok ? 'saved' : 'waiting', undone })
      // The Saved line (and its Undo) stays a while, then goes.
      hideTimer.current = setTimeout(() => { if (seq.current === n) setNote(null) }, 12_000)
    })
  }

  const commit: Commit = (next, what, opts) => {
    const key = opts?.key ?? what
    // A slider being dragged is one change for Undo.
    const same = !!opts?.key && !!last && last.key === key && last.next === state && Date.now() - last.at < 2_000
    setLast({ prev: same && last ? last.prev : state, next, what, key, at: Date.now() })
    save(next, what)
  }

  // Undo only while nothing else has changed the budget since.
  const canUndo = !!last && last.next === state
  function undo() {
    if (!last || last.next !== state) return
    setLast(null)
    save(last.prev, last.what, true)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 lg:px-8 py-6 lg:py-8">
        <div className="mb-6 lg:mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Budget & Planning</h1>
          <p className="text-gray-400 mt-1">Your financial command center. Every number is connected.</p>
        </div>
        <TabBar tabs={TABS} active={tab} onChange={setTab} />
        {tab === 'Budget'           && <BudgetTab   state={state} onChange={commit} />}
        {tab === 'Historic Revenue' && <HistoricTab state={state} onChange={commit} />}
        {tab === 'Overhead'         && <OverheadTab state={state} onChange={commit} />}
        {tab === 'Crew & Labor'     && <CrewTab     state={state} onChange={commit} />}
        {tab === 'KPIs'             && <KPIsTab     state={state} />}
        {tab === 'Job Costing'     && <JobCostingTab state={state} />}
      </div>

      {/* Saved, with Undo for the last change: above the phone's tab bar, bottom right on a computer. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 z-40 flex justify-center lg:justify-end lg:left-auto lg:right-6 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] lg:bottom-6">
        {note && (
          <div data-budget-save={note.status} className="pointer-events-auto flex max-w-full items-center gap-3 rounded-xl bg-gray-900 pl-4 pr-1.5 py-1.5 text-sm text-white shadow-lg">
            <span className="min-w-0 truncate">
              {note.status === 'saving' && <>Saving… <span className="text-gray-400">{note.what}</span></>}
              {note.status === 'saved' && <><span className="text-green-400 font-bold" aria-hidden>✓</span> {note.undone ? 'Undone' : 'Saved'} <span className="text-gray-400">{note.what}</span></>}
              {note.status === 'waiting' && <>Not sent yet: no signal. It is kept and sent when there is. <span className="text-gray-400">{note.what}</span></>}
            </span>
            {canUndo && !note.undone && (
              <button onClick={undo} data-budget-undo className="min-h-[40px] shrink-0 rounded-lg px-3 font-semibold text-orange-300 hover:bg-white/10">Undo</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}