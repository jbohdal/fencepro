import { useState, useMemo, useRef, useEffect } from 'react'
import QuoteBuilder from './QuoteBuilder'
import AdminPage from './AdminPage'
import AdminSettingsPage from './AdminSettingsPage'
import BudgetPage from './BudgetPage'
import CustomersPage from './CustomersPage'
import QuotesPage, { type SavedQuote } from './QuotesPage'
import JobsPage from './JobsPage'
import StagingPage from './StagingPage'
import SchedulePage from './SchedulePage'
import ReportsPage from './ReportsPage'
import MapQuoteBuilder from './MapQuoteBuilder'
import type { MapFenceData } from './MapQuoteBuilder'
import SitePlanTool from './SitePlanTool'
import JobsPipeline from './JobsPipeline'
import PortalInbox from './PortalInbox'
import SmartSchedule from './SmartSchedule'
import DispatchPage from './DispatchPage'
import EZBudgetPage from './EZBudgetPage'
import AutomationsPage from './AutomationsPage'
import IntegrationsPage from './IntegrationsPage'
import OperationsPage from './OperationsPage'
import { createJobFromQuote, getJobByQuoteId } from './jobStore'
import { syncQuote } from './portalSync'

/* ───────── role system ───────── */

export type UserRole = 'owner' | 'admin' | 'salesman' | 'ops_manager' | 'shop'

interface NavItem {
  name: string
  icon: string
  roles: UserRole[]  // which roles can see this item
}

interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Sales',
    items: [
      { name: 'Dashboard',      icon: '📊', roles: ['owner', 'admin', 'salesman', 'ops_manager'] },
      { name: 'Customers',      icon: '👥', roles: ['owner', 'admin', 'salesman'] },
      { name: 'Quotes',         icon: '📋', roles: ['owner', 'admin', 'salesman'] },
      { name: 'Sales Pipeline', icon: '🔨', roles: ['owner', 'admin', 'salesman'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { name: 'Operations', icon: '🔧', roles: ['owner', 'admin', 'ops_manager', 'shop'] },
      { name: 'Schedule',   icon: '📅', roles: ['owner', 'admin', 'ops_manager'] },
      { name: 'Dispatch',   icon: '📍', roles: ['owner', 'admin', 'ops_manager'] },
      { name: 'Site Plans',  icon: '🗺', roles: ['owner', 'admin', 'ops_manager', 'salesman'] },
      { name: 'Inventory',  icon: '📦', roles: ['owner', 'admin', 'ops_manager', 'shop'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { name: 'Reports', icon: '📈', roles: ['owner', 'admin'] },
      { name: 'Budget',  icon: '💰', roles: ['owner'] },
    ],
  },
  {
    label: 'Admin',
    items: [
      { name: 'EZ Budget',     icon: '💲', roles: ['owner', 'admin'] },
      { name: 'Automations',   icon: '⚡', roles: ['owner', 'admin'] },
      { name: 'Integrations', icon: '🔌', roles: ['owner', 'admin'] },
      { name: 'Portal',       icon: '🌐', roles: ['owner', 'admin'] },
      { name: 'Settings',     icon: '⚙️', roles: ['owner', 'admin'] },
    ],
  },
]

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items)

const ROLE_LABELS: Record<UserRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  salesman: 'Sales',
  ops_manager: 'Operations',
  shop: 'Shop / Yard',
}

/* ───────── helpers ───────── */

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT:  'bg-blue-100 text-blue-700',
  SOLD:  'bg-green-100 text-green-700',
  LOST:  'bg-red-100 text-red-700',
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`

function marginColor(pct: number) {
  if (pct >= 0.34) return 'text-green-600 font-semibold'
  if (pct >= 0.27) return 'text-yellow-600 font-semibold'
  return 'text-red-600 font-semibold'
}

function loadQuotes(): SavedQuote[] {
  try {
    const raw = localStorage.getItem('fencepro_quotes')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

function loadBudget() {
  try {
    const raw = localStorage.getItem('fencepro_budget')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function loadPipelineCount(): number {
  try {
    const raw = localStorage.getItem('fencepro_pipeline')
    if (!raw) return 0
    const data = JSON.parse(raw)
    const dead = new Set(['Lost Sale', 'No Answer', 'Paid & Closed'])
    return (data.leads || []).filter((l: any) => !dead.has(l.stage)).length
  } catch { return 0 }
}

function loadCompanyName(): string {
  try {
    const raw = localStorage.getItem('fencepro_config')
    if (raw) {
      const cfg = JSON.parse(raw)
      if (cfg.company?.name) return cfg.company.name
    }
  } catch { /* fall through */ }
  return 'FencePro'
}

function loadUserProfile(): { name: string; role: UserRole } {
  try {
    const raw = localStorage.getItem('fencepro_user')
    if (raw) return JSON.parse(raw)
  } catch { /* fall through */ }
  return { name: 'Jonathan', role: 'owner' }
}

function saveUserProfile(profile: { name: string; role: UserRole }) {
  localStorage.setItem('fencepro_user', JSON.stringify(profile))
}

/* ───────── command search ───────── */

interface SearchResult {
  type: 'customer' | 'quote' | 'page'
  label: string
  sub: string
  action: () => void
}

/* ═══════════════════════════════════════════════
   APP SHELL
   ═══════════════════════════════════════════════ */

export default function App() {
  const [active, setActive]             = useState('Dashboard')
  const [showQuote, setShowQuote]       = useState(false)
  const [editingQuote, setEditingQuote] = useState<SavedQuote | null>(null)
  const [quotes, setQuotes]             = useState<SavedQuote[]>(loadQuotes)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [userProfile, setUserProfile]   = useState(loadUserProfile)
  const [showMapQuote, setShowMapQuote] = useState(false)
  const [showSitePlan, setShowSitePlan] = useState(false)
  const [showSmartSchedule, setShowSmartSchedule] = useState(false)
  const [searchOpen, setSearchOpen]     = useState(false)
  const [searchQuery, setSearchQuery]   = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const companyName = useMemo(() => loadCompanyName(), [])
  const role = userProfile.role

  // Keyboard shortcut: Cmd+K or Ctrl+K to open search
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchRef.current?.focus(), 50)
      }
      if (e.key === 'Escape') setSearchOpen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [])

  function handleRoleChange(newRole: UserRole) {
    const updated = { ...userProfile, role: newRole }
    setUserProfile(updated)
    saveUserProfile(updated)
    // If current page isn't visible for the new role, go to Dashboard
    const visible = ALL_NAV_ITEMS.find(i => i.name === active)
    if (visible && !visible.roles.includes(newRole)) {
      setActive('Dashboard')
    }
  }

  // Filtered nav based on role
  const visibleGroups = NAV_GROUPS.map(g => ({
    ...g,
    items: g.items.filter(i => i.roles.includes(role)),
  })).filter(g => g.items.length > 0)

  /* ── Quote handlers ── */

  function handleSaveQuote(q: SavedQuote) {
    const wasSold = quotes.find(x => x.id === q.id)?.status === 'SOLD'

    setQuotes(prev => {
      const updated = prev.find(x => x.id === q.id)
        ? prev.map(x => x.id === q.id ? q : x)
        : [q, ...prev]
      localStorage.setItem('fencepro_quotes', JSON.stringify(updated))
      return updated
    })
    setShowQuote(false)
    setEditingQuote(null)

    // Auto-create a Job when quote is first saved as SOLD
    if (q.status === 'SOLD' && !wasSold && !getJobByQuoteId(q.id)) {
      createJobFromQuote(q)
    }

    // Sync to customer portal (fire and forget)
    syncQuote(q).catch(() => {})
  }

  function handleOpenQuote(q: SavedQuote) {
    setEditingQuote(q)
    setShowQuote(true)
  }

  function handleMapQuoteData(data: MapFenceData) {
    setShowMapQuote(false)
    // Pre-fill the QuoteBuilder with map data: runs become run lengths, corners/ends are set
    setEditingQuote({
      id: '',
      customerName: '',
      customerPhone: '',
      customerEmail: '',
      customerAddress: data.address,
      leadSource: '',
      salesRep: '',
      fenceStyle: '',
      runs: data.runs.map(r => Math.round(r.lengthFeet)),
      corners: data.corners,
      ends: data.ends,
      walkGates: 0,
      dblGates: 0,
      tearOutSections: 0,
      tearOutGates: 0,
      adjLaborHrs: 0,
      hasSalesman: false,
      priceAdjust: 0,
      sections: 0,
      materialCost: 0,
      laborCost: 0,
      tearOutCost: 0,
      totalCOGS: 0,
      finalPrice: 0,
      gmPct: 0,
      pullSheet: [],
      status: 'DRAFT',
      date: new Date().toISOString().slice(0, 10),
      notes: '',
      leadTemp: 0,
    } as SavedQuote)
    setShowQuote(true)
  }

  /* ── Search results ── */

  const searchResults: SearchResult[] = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return []
    const q = searchQuery.toLowerCase()
    const results: SearchResult[] = []

    // Pages
    ALL_NAV_ITEMS.filter(i => i.roles.includes(role)).forEach(item => {
      if (item.name.toLowerCase().includes(q)) {
        results.push({ type: 'page', label: item.name, sub: 'Page', action: () => { setActive(item.name); setSearchOpen(false); setSearchQuery('') } })
      }
    })

    // Quotes
    quotes.forEach(quote => {
      if (quote.customerName.toLowerCase().includes(q) || quote.fenceStyle.toLowerCase().includes(q)) {
        results.push({
          type: 'quote',
          label: quote.customerName,
          sub: `${quote.fenceStyle} · ${fmt(quote.finalPrice)} · ${quote.status}`,
          action: () => { handleOpenQuote(quote); setSearchOpen(false); setSearchQuery('') },
        })
      }
    })

    // Customers
    try {
      const raw = localStorage.getItem('fencepro_customers')
      if (raw) {
        const custs = JSON.parse(raw)
        custs.forEach((c: any) => {
          const name = `${c.firstName || ''} ${c.lastName || ''}`.trim()
          if (name.toLowerCase().includes(q) || (c.phone || '').includes(q)) {
            results.push({
              type: 'customer',
              label: name,
              sub: c.phone || c.email || 'Customer',
              action: () => { setActive('Customers'); setSearchOpen(false); setSearchQuery('') },
            })
          }
        })
      }
    } catch { /* ignore */ }

    return results.slice(0, 12)
  }, [searchQuery, quotes, role])

  /* ── Dashboard stats ── */

  const ytdRevenue   = quotes.filter(q => q.status === 'SOLD').reduce((s, q) => s + q.finalPrice, 0)
  const thisMonth    = new Date().getMonth()
  const thisYear     = new Date().getFullYear()
  const monthQuotes  = quotes.filter(q => {
    if (!q.date) return false
    const d = new Date(q.date)
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear
  })
  const monthSold    = monthQuotes.filter(q => q.status === 'SOLD').length
  const openQuotes   = quotes.filter(q => q.status === 'DRAFT' || q.status === 'SENT').length
  const avgMargin    = quotes.length > 0 ? quotes.reduce((s, q) => s + q.gmPct, 0) / quotes.length : 0
  const activePipeline = loadPipelineCount()
  const recentQuotes = [...quotes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5)

  const budget = loadBudget()
  const revenueGoal  = budget?.revenueGoal ?? 613000
  const overheadPct  = budget?.overheadPct ?? 0.24
  const laborPct     = budget?.laborPct ?? 0.214
  const materialsPct = budget?.materialsPct ?? 0.44
  const netProfitPct = budget?.netProfitPct ?? 0.106
  const magicNumber  = 1 - overheadPct - netProfitPct

  const totalOverhead = budget?.overhead
    ? budget.overhead.filter((o: any) => !o.parentId).reduce((s: number, o: any) => s + (o.annual || 0), 0)
    : 0

  const actualOverheadPct  = revenueGoal > 0 ? totalOverhead / revenueGoal : 0
  const actualLaborAmt     = revenueGoal * laborPct
  const actualMaterialsAmt = revenueGoal * materialsPct
  const actualNetProfit    = revenueGoal * netProfitPct
  const ytdGoal            = revenueGoal * (thisMonth + 1) / 12

  const kpis = [
    { label: 'Revenue YTD', value: fmt(ytdRevenue), sub: `${fmtPct(ytdRevenue / revenueGoal)} of ${fmt(revenueGoal)} goal`, icon: '💰', color: ytdRevenue >= ytdGoal ? 'text-green-600' : 'text-orange-500' },
    { label: 'Sold This Month', value: String(monthSold), sub: `${monthQuotes.length} quoted · ${monthQuotes.length > 0 ? fmtPct(monthSold / monthQuotes.length) : '0%'} close rate`, icon: '📋', color: 'text-blue-600' },
    { label: 'Open Quotes', value: String(openQuotes), sub: fmt(quotes.filter(q => q.status === 'DRAFT' || q.status === 'SENT').reduce((s, q) => s + q.finalPrice, 0)), icon: '⏳', color: 'text-orange-500' },
    { label: 'Active Pipeline', value: String(activePipeline), sub: 'leads in progress', icon: '🔨', color: 'text-purple-600' },
    { label: 'Avg Gross Margin', value: fmtPct(avgMargin), sub: avgMargin >= 0.34 ? 'Above target ✓' : 'Below target ⚠', icon: '📈', color: avgMargin >= 0.34 ? 'text-green-600' : 'text-yellow-600' },
  ]

  const budgetBuckets = [
    { label: 'Overhead', target: fmtPct(overheadPct), actual: fmtPct(actualOverheadPct), amount: fmt(totalOverhead), ok: actualOverheadPct <= overheadPct + 0.02 },
    { label: 'Labor & Commission', target: fmtPct(laborPct), actual: fmtPct(laborPct), amount: fmt(actualLaborAmt), ok: true },
    { label: 'Materials', target: fmtPct(materialsPct), actual: fmtPct(materialsPct), amount: fmt(actualMaterialsAmt), ok: true },
    { label: 'Net Profit', target: fmtPct(netProfitPct), actual: fmtPct(netProfitPct), amount: fmt(actualNetProfit), ok: netProfitPct >= 0.08 },
  ]

  const sidebarW = sidebarCollapsed ? 'w-16' : 'w-56'

  return (
    <div className="flex h-screen bg-gray-50 font-sans">

      {/* ═══ SIDEBAR ═══ */}
      <div className={`${sidebarW} bg-gray-900 flex flex-col transition-all duration-200 shrink-0`}>

        {/* Brand */}
        <div className={`border-b border-gray-700 flex items-center ${sidebarCollapsed ? 'px-3 py-4 justify-center' : 'px-5 py-4'}`}>
          {sidebarCollapsed ? (
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center text-white text-sm font-bold">F</div>
          ) : (
            <div>
              <h1 className="text-white text-lg font-bold tracking-tight">{companyName}</h1>
              <p className="text-gray-500 text-xs mt-0.5">Management Platform</p>
            </div>
          )}
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {visibleGroups.map(group => (
            <div key={group.label}>
              {!sidebarCollapsed && (
                <p className="px-3 mb-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-widest">{group.label}</p>
              )}
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <button
                    key={item.name}
                    onClick={() => setActive(item.name)}
                    title={sidebarCollapsed ? item.name : undefined}
                    className={`w-full flex items-center gap-3 rounded-lg text-sm transition-colors ${
                      sidebarCollapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2'
                    } ${
                      active === item.name
                        ? 'bg-orange-500 text-white font-medium'
                        : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <span className={sidebarCollapsed ? 'text-lg' : ''}>{item.icon}</span>
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="px-2 py-2 border-t border-gray-700">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-gray-500 hover:text-gray-300 hover:bg-gray-800 transition-colors text-sm"
          >
            {sidebarCollapsed ? '▶' : '◀'}
            {!sidebarCollapsed && <span className="text-xs">Collapse</span>}
          </button>
        </div>

        {/* User profile + role */}
        <div className={`border-t border-gray-700 ${sidebarCollapsed ? 'px-2 py-3' : 'px-4 py-3'}`}>
          {sidebarCollapsed ? (
            <div className="w-8 h-8 mx-auto rounded-full bg-orange-500 flex items-center justify-center text-white text-sm font-bold">
              {userProfile.name.charAt(0).toUpperCase()}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                {userProfile.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white text-sm font-medium truncate">{userProfile.name}</p>
                <select
                  value={role}
                  onChange={e => handleRoleChange(e.target.value as UserRole)}
                  className="bg-transparent text-gray-400 text-xs outline-none cursor-pointer hover:text-gray-300 -ml-0.5"
                >
                  {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(([k, v]) => (
                    <option key={k} value={k} className="bg-gray-900 text-gray-300">{v}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top header bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-900">{active}</h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Command search */}
            <button
              onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50) }}
              className="flex items-center gap-2 bg-gray-100 hover:bg-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-500 transition-colors w-64"
            >
              <span className="text-gray-400">🔍</span>
              <span className="flex-1 text-left">Search...</span>
              <kbd className="text-[10px] bg-gray-200 text-gray-400 px-1.5 py-0.5 rounded font-mono">⌘K</kbd>
            </button>

            {/* Action buttons */}
            {(active === 'Schedule' || active === 'Operations' || active === 'Jobs' || active === 'Dispatch') && (
              <button
                onClick={() => setShowSmartSchedule(true)}
                className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <span>🗺</span> Smart Schedule
              </button>
            )}
            {(active === 'Customers' || active === 'Quotes' || active === 'Dashboard') && (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowMapQuote(true)}
                  className="bg-gray-900 hover:bg-gray-800 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <span>🗺</span> Map Quote
                </button>
                <button
                  onClick={() => { setEditingQuote(null); setShowQuote(true) }}
                  className="bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                >
                  + New Quote
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {active === 'EZ Budget' && <EZBudgetPage />}
          {active === 'Automations' && <AutomationsPage />}
          {active === 'Integrations' && <IntegrationsPage />}
          {active === 'Portal'    && <PortalInbox />}
          {active === 'Settings'  && <AdminSettingsPage />}
          {active === 'Inventory' && <AdminPage />}
          {active === 'Budget'    && <BudgetPage />}
          {active === 'Customers' && <CustomersPage onNewQuote={() => { setEditingQuote(null); setShowQuote(true) }} />}
          {active === 'Quotes'    && <QuotesPage quotes={quotes} onOpenQuote={handleOpenQuote} onNewQuote={() => { setEditingQuote(null); setShowQuote(true) }} />}
          {active === 'Sales Pipeline' && <JobsPage />}
          {active === 'Operations'     && <OperationsPage />}
          {active === 'Jobs'           && <OperationsPage />}
          {active === 'Staging'        && <OperationsPage />}
          {active === 'Schedule'  && <SchedulePage />}
          {active === 'Dispatch'  && <DispatchPage />}
          {active === 'Reports'   && <ReportsPage quotes={quotes} />}
          {active === 'Site Plans' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">Site Plans</h2>
                  <p className="text-sm text-gray-400 mt-0.5">Create construction site plans with satellite imagery, fence lines, gates, and annotations.</p>
                </div>
                <button onClick={() => setShowSitePlan(true)}
                  className="bg-orange-500 hover:bg-orange-600 text-white font-semibold text-sm px-5 py-2.5 rounded-xl">
                  + New Site Plan
                </button>
              </div>
              {(() => {
                let plans: { id: string; name: string; address: string; createdAt: string; lines: unknown[]; markers: unknown[] }[] = []
                try { const raw = localStorage.getItem('fencepro_siteplans'); if (raw) plans = JSON.parse(raw) } catch {}
                return plans.length === 0 ? (
                  <div className="text-center py-24 border border-dashed border-gray-200 rounded-2xl">
                    <p className="text-4xl mb-3">🗺</p>
                    <p className="text-gray-500 text-lg font-medium">No site plans yet</p>
                    <p className="text-gray-400 text-sm mt-1 mb-4">Draw fence lines on satellite imagery for your crew</p>
                    <button onClick={() => setShowSitePlan(true)} className="text-orange-500 hover:underline text-sm font-semibold">Create your first site plan</button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    {plans.map(p => (
                      <div key={p.id} onClick={() => setShowSitePlan(true)}
                        className="bg-white rounded-2xl border border-gray-200 p-5 hover:border-orange-300 cursor-pointer transition-colors">
                        <h3 className="font-semibold text-gray-900">{p.name}</h3>
                        <p className="text-xs text-gray-400 mt-0.5">{p.address || 'No address'}</p>
                        <div className="flex gap-3 mt-2 text-xs text-gray-500">
                          <span>{p.lines?.length || 0} lines</span>
                          <span>{p.markers?.length || 0} markers</span>
                          <span>{new Date(p.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}

          {active === 'Dashboard' && (
            <div className="space-y-6">
              {/* KPI strip */}
              <div className="grid grid-cols-5 gap-4">
                {kpis.map(kpi => (
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

              {/* Revenue goal progress */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">Revenue Goal Progress</h3>
                    <p className="text-xs text-gray-400 mt-0.5">{fmt(ytdRevenue)} of {fmt(revenueGoal)} annual goal</p>
                  </div>
                  <div className="text-right">
                    <p className="text-2xl font-bold text-gray-900">{fmtPct(ytdRevenue / revenueGoal)}</p>
                    <p className="text-xs text-gray-400">YTD completion</p>
                  </div>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-3">
                  <div className="h-3 rounded-full bg-orange-500 transition-all" style={{ width: `${Math.min((ytdRevenue / revenueGoal) * 100, 100)}%` }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-xs text-gray-400">$0</span>
                  <span className="text-xs text-gray-400">YTD target: {fmt(ytdGoal)}</span>
                  <span className="text-xs text-gray-400">{fmt(revenueGoal)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Recent quotes */}
                <div className="bg-white rounded-2xl border border-gray-200">
                  <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">Recent Quotes</h3>
                    <button onClick={() => setActive('Quotes')} className="text-orange-500 text-sm hover:underline">View all</button>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {recentQuotes.length === 0 ? (
                      <div className="px-6 py-8 text-center text-gray-400 text-sm">No quotes yet</div>
                    ) : recentQuotes.map(q => (
                      <div key={q.id} className="px-6 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50" onClick={() => handleOpenQuote(q)}>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{q.customerName}</p>
                          <p className="text-xs text-gray-400">{q.fenceStyle} · {q.sections} sec · {q.date}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className={`text-sm ${marginColor(q.gmPct)}`}>{fmtPct(q.gmPct)}</span>
                          <span className="text-sm font-semibold text-gray-900">{fmt(q.finalPrice)}</span>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLORS[q.status]}`}>{q.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* This month at a glance */}
                <div className="bg-white rounded-2xl border border-gray-200">
                  <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">This Month at a Glance</h3>
                    <span className="text-xs text-gray-400">{new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    {[
                      { label: 'Quotes Created', value: monthQuotes.length },
                      { label: 'Quotes Sold', value: monthSold },
                      { label: 'Close Rate', value: monthQuotes.length > 0 ? fmtPct(monthSold / monthQuotes.length) : '0%' },
                      { label: 'Revenue Closed', value: fmt(monthQuotes.filter(q => q.status === 'SOLD').reduce((s, q) => s + q.finalPrice, 0)) },
                      { label: 'Avg Deal Size', value: monthSold > 0 ? fmt(monthQuotes.filter(q => q.status === 'SOLD').reduce((s, q) => s + q.finalPrice, 0) / monthSold) : '$0' },
                      { label: 'Magic Number', value: fmtPct(magicNumber) },
                    ].map(row => (
                      <div key={row.label} className="flex items-center justify-between">
                        <span className="text-sm text-gray-500">{row.label}</span>
                        <span className="text-sm font-bold text-gray-900">{row.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Budget buckets */}
              <div className="bg-white rounded-2xl border border-gray-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">Budget Targets</h3>
                    <p className="text-xs text-gray-400 mt-0.5">Magic Number: <span className="font-bold text-gray-700">{fmtPct(magicNumber)}</span> · Revenue Goal: <span className="font-bold text-gray-700">{fmt(revenueGoal)}</span></p>
                  </div>
                  <button onClick={() => setActive('Budget')} className="text-orange-500 text-sm hover:underline">Edit in Budget</button>
                </div>
                <div className="grid grid-cols-4 gap-4">
                  {budgetBuckets.map(b => (
                    <div key={b.label} className="bg-gray-50 rounded-xl p-4">
                      <p className="text-xs text-gray-500 font-medium">{b.label}</p>
                      <p className={`text-2xl font-bold mt-1 ${b.ok ? 'text-green-600' : 'text-red-500'}`}>{b.actual}</p>
                      <p className="text-xs text-gray-400 mt-1">{b.amount}</p>
                      <p className="text-xs text-gray-300 mt-0.5">Target: {b.target}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ COMMAND SEARCH OVERLAY ═══ */}
      {searchOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40" onClick={() => setSearchOpen(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-[520px] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
              <span className="text-gray-400">🔍</span>
              <input
                ref={searchRef}
                className="flex-1 text-sm outline-none placeholder-gray-400"
                placeholder="Search customers, quotes, or pages..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                autoFocus
              />
              <kbd className="text-[10px] bg-gray-100 text-gray-400 px-2 py-1 rounded font-mono">ESC</kbd>
            </div>
            {searchResults.length > 0 && (
              <div className="max-h-80 overflow-y-auto">
                {searchResults.map((r, i) => (
                  <button
                    key={i}
                    onClick={r.action}
                    className="w-full flex items-center gap-3 px-5 py-3 hover:bg-orange-50 text-left transition-colors"
                  >
                    <span className="text-gray-400 text-xs w-16 shrink-0 uppercase font-semibold">
                      {r.type === 'page' ? '📄' : r.type === 'quote' ? '📋' : '👤'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{r.label}</p>
                      <p className="text-xs text-gray-400 truncate">{r.sub}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
            {searchQuery.length >= 2 && searchResults.length === 0 && (
              <div className="px-5 py-8 text-center text-gray-400 text-sm">No results for "{searchQuery}"</div>
            )}
            {searchQuery.length < 2 && (
              <div className="px-5 py-6 text-center text-gray-400 text-xs">
                Type to search customers, quotes, or pages
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ SMART SCHEDULE ═══ */}
      {showSmartSchedule && (
        <SmartSchedule onClose={() => setShowSmartSchedule(false)} />
      )}

      {/* ═══ SITE PLAN TOOL ═══ */}
      {showSitePlan && (
        <SitePlanTool onClose={() => setShowSitePlan(false)} />
      )}

      {/* ═══ MAP QUOTE MODAL ═══ */}
      {showMapQuote && (
        <MapQuoteBuilder
          onUseData={handleMapQuoteData}
          onClose={() => setShowMapQuote(false)}
        />
      )}

      {/* ═══ QUOTE BUILDER MODAL ═══ */}
      {showQuote && (
        <QuoteBuilder
          onClose={() => { setShowQuote(false); setEditingQuote(null) }}
          onSave={handleSaveQuote}
          initialQuote={editingQuote}
        />
      )}
    </div>
  )
}
