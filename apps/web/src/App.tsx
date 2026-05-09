import { useState, useMemo, useRef, useEffect } from 'react'
import QuoteBuilder from './QuoteBuilder'
import AdminPage from './AdminPage'
import AdminSettingsPage from './AdminSettingsPage'
import BudgetPage from './BudgetPage'
import CustomersPage from './CustomersPage'
import QuotesPage, { type SavedQuote } from './QuotesPage'
import JobsPage from './JobsPage'
import SalesPipelineBoard from './SalesPipelineBoard'
import OperationsBoard from './OperationsBoard'
import AuditLogPage from './AuditLogPage'
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
import TeamManagementPage from './TeamManagementPage'
import BillingPage from './BillingPage'
import OperationsPage from './OperationsPage'
import LoginPage from './LoginPage'
import PLStatementPage from './PLStatementPage'
import BalanceSheetPage from './BalanceSheetPage'
import VendorsPage from './VendorsPage'
import AccountsPayablePage from './AccountsPayablePage'
import BundlesPage from './BundlesPage'
import PublicPresentationPage from './PublicPresentationPage'
import PendingOrdersPage from './PendingOrdersPage'
import SitePlansPage from './SitePlansPage'
import InventoryPage from './InventoryPage'
import CustomerPortalApp from './CustomerPortalApp'
import NotificationBell from './NotificationBell'
import MessagesInbox from './MessagesInbox'
import PublicQuotePage from './PublicQuotePage'
import { isAuthenticated, fetchCurrentUser, logout as crmLogout, canAccess, setSessionExpiredHandler, type CrmUser } from './crmAuth'
import { initCustomers, getCustomers } from './customerStore'
import { initQuotes, getQuotes, getQuoteById, upsertQuote } from './quoteStore'
import { initJobs } from './jobStore'
import { initSchedule } from './scheduleStore'
import { initPipeline, getPipeline } from './pipelineStore'
import { ToastContainer, toast } from './toast'
import { linkPullSheetToCustomer, getPullSheetsForCustomer } from './billingStore'
import { createJobFromQuote, getJobByQuoteId } from './jobStore'
import { syncQuote } from './portalSync'
import { createPendingOrderFromQuote, checkStockForOrder } from './pendingOrderStore'
import { fireQuoteSold } from './automationTrigger'

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
      { name: 'Sales Pipeline', icon: '🔨', roles: ['owner', 'admin', 'salesman'] },
      { name: 'Dashboard',      icon: '📊', roles: ['owner', 'admin', 'salesman', 'ops_manager'] },
      { name: 'Customers',      icon: '👥', roles: ['owner', 'admin', 'salesman'] },
      { name: 'Quotes',         icon: '📋', roles: ['owner', 'admin', 'salesman'] },
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
      { name: 'P&L Statement',     icon: '📊', roles: ['owner', 'admin'] },
      { name: 'Balance Sheet',     icon: '📑', roles: ['owner', 'admin'] },
      { name: 'Cash Flow',         icon: '💸', roles: ['owner', 'admin'] },
      { name: 'Billing',           icon: '💳', roles: ['owner', 'admin'] },
      { name: 'Accounts Payable',  icon: '🧾', roles: ['owner', 'admin', 'ops_manager'] },
      { name: 'Vendors',           icon: '🏢', roles: ['owner', 'admin', 'ops_manager'] },
      { name: 'Reports',           icon: '📈', roles: ['owner', 'admin'] },
      { name: 'Budget',            icon: '💰', roles: ['owner'] },
    ],
  },
  {
    label: 'Admin',
    items: [
      { name: 'Team',          icon: '👥', roles: ['owner', 'admin'] },
      { name: 'Bundles',       icon: '📦', roles: ['owner', 'admin'] },
      { name: 'EZ Budget',     icon: '💲', roles: ['owner', 'admin'] },
      { name: 'Automations',   icon: '⚡', roles: ['owner', 'admin'] },
      { name: 'Integrations', icon: '🔌', roles: ['owner', 'admin'] },
      { name: 'Portal',       icon: '🌐', roles: ['owner', 'admin'] },
      { name: 'Audit Log',    icon: '🛡️', roles: ['owner', 'admin'] },
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
  return getQuotes()
}

function loadBudget() {
  try {
    const raw = localStorage.getItem('fencepro_budget')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function loadPipelineCount(): number {
  const dead = new Set(['Lost Sale', 'No Answer', 'Paid & Closed'])
  return (getPipeline().leads || []).filter((l: any) => !dead.has(l.stage)).length
}

function loadCompanyName(): string {
  try {
    const raw = localStorage.getItem('fencepro_config')
    if (raw) {
      const cfg = JSON.parse(raw)
      if (cfg.company?.name) return cfg.company.name
    }
  } catch { /* fall through */ }
  return 'EZBiz'
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

function AuthGate({ children, onLogout }: { children: (user: CrmUser, logout: () => void) => React.ReactNode; onLogout?: () => void }) {
  const [authChecked, setAuthChecked] = useState(false)
  const [crmUser, setCrmUser] = useState<CrmUser | null>(null)

  useEffect(() => {
    function onFirstView(e: any) {
      const quoteId = e?.detail?.quoteId
      if (!quoteId) return
      try {
        const q = getQuoteById(quoteId)
        if (!q) return
        toast.success('Quote viewed', `${q.customerName || 'Customer'} just opened their quote — great time to follow up!`)
      } catch {}
    }
    window.addEventListener('fencepro:quote_first_viewed', onFirstView)
    return () => window.removeEventListener('fencepro:quote_first_viewed', onFirstView)
  }, [])

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setCrmUser(null)
      toast.warning('Your session has expired', 'Please log in again — your local work has been preserved.')
    })
    if (isAuthenticated()) {
      fetchCurrentUser().then(user => {
        setCrmUser(user)
        if (user) {
          const mapped: Record<string, UserRole> = {
            super_admin: 'owner', admin: 'admin', manager: 'admin',
            sales_rep: 'salesman', field_crew: 'shop', office_staff: 'ops_manager',
          }
          saveUserProfile({ name: `${user.firstName} ${user.lastName}`, role: mapped[user.role] || 'salesman' })
          initCustomers().catch(() => {})
          initQuotes().catch(() => {})
          initJobs().catch(() => {})
          initSchedule().catch(() => {})
          initPipeline().catch(() => {})
        }
        setAuthChecked(true)
      })
    } else {
      setAuthChecked(true)
    }
  }, [])

  function handleLogin(user: CrmUser) {
    setCrmUser(user)
    const mapped: Record<string, UserRole> = {
      super_admin: 'owner', admin: 'admin', manager: 'admin',
      sales_rep: 'salesman', field_crew: 'shop', office_staff: 'ops_manager',
    }
    saveUserProfile({ name: `${user.firstName} ${user.lastName}`, role: mapped[user.role] || 'salesman' })
    initCustomers().catch(() => {})
  }

  function handleLogout() {
    crmLogout()
    setCrmUser(null)
  }

  if (!authChecked) {
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center"><div className="text-gray-500">Loading...</div></div>
  }
  if (!crmUser) {
    return <LoginPage onLogin={handleLogin} />
  }

  return <>{children(crmUser, handleLogout)}</>
}

export default function App() {
  // Public presentation route: /#/present/:token — no auth required
  const [hash, setHash] = useState(typeof window !== 'undefined' ? window.location.hash : '')
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
  const presentMatch = hash.match(/^#\/present\/([a-zA-Z0-9_-]+)/)
  if (presentMatch) {
    return <PublicPresentationPage token={presentMatch[1]} />
  }
  const quoteMatch = hash.match(/^#\/quote\/([a-zA-Z0-9_-]+)/)
  if (quoteMatch) {
    return <PublicQuotePage token={quoteMatch[1]} />
  }
  const portalMatch = hash.match(/^#\/portal\/([a-zA-Z]+)(?:\?.*)?$/)
  if (portalMatch) {
    return <CustomerPortalApp route={portalMatch[1]} />
  }

  return (
    <>
      <ToastContainer />
      <AuthGate>
        {(crmUser, logout) => <AppShell crmUser={crmUser} onLogout={logout} />}
      </AuthGate>
    </>
  )
}

function AppShell({ crmUser, onLogout }: { crmUser: CrmUser; onLogout: () => void }) {
  const [active, setActive]             = useState('Dashboard')
  const [showQuote, setShowQuote]       = useState(false)
  const [editingQuote, setEditingQuote] = useState<SavedQuote | null>(null)
  const [quotes, setQuotes]             = useState<SavedQuote[]>(loadQuotes)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
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
    try {
      const wasSold = quotes.find(x => x.id === q.id)?.status === 'SOLD'

      const saved = upsertQuote(q)
      // Reflect locally — store will fire fencepro:quotes:updated when the
      // server response swaps the temp id, but the page also tracks its own
      // copy of `quotes` so update it now to keep the UI snappy.
      setQuotes(prev => {
        const exists = prev.find(x => x.id === saved.id)
        return exists ? prev.map(x => x.id === saved.id ? saved : x) : [saved, ...prev]
      })
      setShowQuote(false)
      setEditingQuote(null)
      // Use the saved record for downstream side effects so we get the canonical id.
      q = saved

      // Auto-create a Job + pending order when quote is first saved as SOLD
      if (q.status === 'SOLD' && !wasSold && !getJobByQuoteId(q.id)) {
        createJobFromQuote(q)
        fireQuoteSold(q.id, q.customerId, Math.round(q.finalPrice * 100), {
          jobName: q.customerName, customerName: q.customerName,
          customerEmail: q.customerEmail, customerPhone: q.customerPhone,
          jobAddress: q.customerAddress, fenceType: q.fenceStyle,
          assignedRep: q.salesRep, quotePrice: q.finalPrice,
          contractValue: q.finalPrice,
        })
        const order = createPendingOrderFromQuote(q)
        if (order) {
          const warnings = checkStockForOrder(order)
          if (warnings.length > 0) {
            toast.warning('Low stock on some materials',
              warnings.slice(0, 3).map(w => `${w.itemName}: need ${w.required}, have ${w.available}`).join('\n')
            )
          }
        }
      }

      // Auto-link pull sheet to customer file
      if (q.pullSheet?.length > 0 && q.customerId) {
        try {
          const existing = getPullSheetsForCustomer(q.customerId)
          const versionNumber = existing.filter(ps => ps.quoteId === q.id).length + 1
          const job = q.status === 'SOLD' ? getJobByQuoteId(q.id) : null
          linkPullSheetToCustomer({
            customerId: q.customerId,
            customerName: q.customerName,
            jobId: job?.id,
            jobName: job ? q.customerName : undefined,
            quoteId: q.id,
            quoteName: `${q.fenceStyle} — ${q.customerName}`,
            versionSnapshot: JSON.parse(JSON.stringify(q.pullSheet)),
            versionNumber,
            linkedAt: new Date().toISOString(),
            linkedBy: 'auto',
          })
        } catch { /* silent — pull sheet link is non-critical */ }
      }

      toast.success('Quote saved', q.status === 'SOLD' ? 'Job created and pending order queued.' : undefined)

      // Sync to customer portal — surface errors
      syncQuote(q).catch((err: any) => {
        toast.warning('Portal sync failed', 'Saved locally — will retry on next save. ' + (err?.message || ''))
      })
    } catch (err: any) {
      toast.error('Could not save quote', err?.message || 'Unknown error. Your data may be at risk — try again.')
    }
  }

  function handleOpenQuote(q: SavedQuote) {
    setEditingQuote(q)
    setShowQuote(true)
  }

  function handleMapQuoteData(data: MapFenceData) {
    setShowMapQuote(false)
    // Pre-fill the QuoteBuilder with map data: runs become run lengths, corners/ends are set
    setEditingQuote({
      // intentionally missing id — QuoteBuilder will mint a fresh one on save.
      // Cast below to SavedQuote; the `|| uid()` in QuoteBuilder handles it.
      id: undefined as unknown as string,
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
    getCustomers().forEach(c => {
      const name = `${c.firstName || ''} ${c.lastName || ''}`.trim()
      if (name.toLowerCase().includes(q) || (c.phone || '').includes(q)) {
        results.push({
          type: 'customer',
          label: name,
          sub: c.phone || c.email || 'Customer',
          action: () => {
            setActive('Customers')
            setSearchOpen(false)
            setSearchQuery('')
            try { window.dispatchEvent(new CustomEvent('fencepro:select-customer', { detail: { customerId: c.id } })) } catch {}
          },
        })
      }
    })

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

      {/* ═══ MOBILE NAV OVERLAY + DRAWER (hidden on desktop via CSS) ═══ */}
      <div className={`mobile-nav-backdrop ${mobileMenuOpen ? 'open' : ''}`} onClick={() => setMobileMenuOpen(false)} />
      <div className={`mobile-nav-drawer bg-gray-900 flex flex-col ${mobileMenuOpen ? 'open' : ''}`}>
        <div className="border-b border-gray-700 px-5 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-white text-lg font-bold tracking-tight">{companyName}</h1>
            <p className="text-gray-500 text-xs mt-0.5">Management Platform</p>
          </div>
          <button onClick={() => setMobileMenuOpen(false)} className="text-gray-400 hover:text-white text-2xl leading-none p-1">×</button>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {visibleGroups.map(group => (
            <div key={group.label}>
              <p className="px-3 mb-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-widest">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <button
                    key={item.name}
                    onClick={() => { setActive(item.name); setMobileMenuOpen(false) }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      active === item.name ? 'bg-orange-500 text-white font-medium' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
                    }`}
                  >
                    <span>{item.icon}</span>
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-gray-700 px-4 py-3">
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
          <button onClick={onLogout} className="mt-2 w-full text-xs text-gray-500 hover:text-gray-300 text-left">
            Sign out
          </button>
        </div>
      </div>

      {/* ═══ SIDEBAR (desktop only — hidden on mobile via CSS) ═══ */}
      <div className={`sidebar-desktop ${sidebarW} bg-gray-900 flex flex-col transition-all duration-200 shrink-0`}>

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
          {!sidebarCollapsed && (
            <button onClick={onLogout} className="mt-2 w-full text-xs text-gray-500 hover:text-gray-300 text-left">
              Sign out
            </button>
          )}
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top header bar */}
        <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-4">
            {/* Hamburger — mobile only (hidden on desktop via CSS) */}
            <button onClick={() => setMobileMenuOpen(true)} className="mobile-only text-gray-600 hover:text-gray-900 p-1 -ml-2">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
              </svg>
            </button>
            <h2 className="text-lg font-semibold text-gray-900">{active}</h2>
          </div>

          <div className="flex items-center gap-3">
            <MessagesInbox onNavigateToCustomer={(customerId) => {
              setActive('Customers')
              setTimeout(() => {
                try { window.dispatchEvent(new CustomEvent('fencepro:select-customer', { detail: { customerId, tab: 'messages' } })) } catch {}
              }, 50)
            }} />
            <NotificationBell />
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
            {active === 'Quotes' && (
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
          {active === 'Team' && <TeamManagementPage />}
          {active === 'EZ Budget' && <EZBudgetPage />}
          {active === 'Automations' && <AutomationsPage />}
          {active === 'Integrations' && <IntegrationsPage />}
          {active === 'Portal'    && <PortalInbox />}
          {active === 'Audit Log' && <AuditLogPage />}
          {active === 'Settings'  && <AdminSettingsPage />}
          {active === 'Inventory' && <InventoryPage />}
          {active === 'Pending Orders' && <PendingOrdersPage />}
          {active === 'Budget'    && <BudgetPage />}
          {active === 'Billing'   && <BillingPage />}
          {active === 'P&L Statement' && <PLStatementPage />}
          {active === 'Balance Sheet' && <BalanceSheetPage />}
          {active === 'Accounts Payable' && <AccountsPayablePage />}
          {active === 'Vendors'   && <VendorsPage />}
          {active === 'Bundles'   && <BundlesPage />}
          {active === 'Cash Flow' && <div className="bg-white rounded-2xl border border-gray-200 p-8 text-center"><p className="text-4xl mb-3">💸</p><h2 className="text-lg font-bold text-gray-900">Cash Flow</h2><p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">Cash Flow statement coming soon. For now, check the P&amp;L Statement and Accounts Receivable/Payable dashboards.</p></div>}
          {active === 'Customers' && <CustomersPage onNewQuote={(c) => {
            if (c) {
              // NOTE: leave `id` undefined so QuoteBuilder generates a fresh one
              // per quote. Previously `id: ''` caused every new-for-customer
              // quote to share the same empty string id and overwrite prior
              // quotes. Keep this as undefined.
              setEditingQuote({
                id: undefined as unknown as string,
                customerId: c.id,
                customerName: `${c.firstName} ${c.lastName}`.trim(),
                customerPhone: c.phone || '',
                customerEmail: c.email || '',
                customerAddress: c.serviceAddress || '',
                leadSource: c.leadSource || '',
                salesRep: c.salesRep || '',
                fenceStyle: '', runs: [], corners: 0, ends: 0,
                walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
                adjLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
                sections: 0, materialCost: 0, laborCost: 0, tearOutCost: 0,
                totalCOGS: 0, finalPrice: 0, gmPct: 0, pullSheet: [],
                status: 'DRAFT', date: new Date().toISOString().slice(0, 10),
                notes: '', leadTemp: 0,
              } as SavedQuote)
            } else {
              setEditingQuote(null)
            }
            setShowQuote(true)
          }} />}
          {active === 'Quotes'    && <QuotesPage quotes={quotes} onOpenQuote={handleOpenQuote} onNewQuote={() => { setEditingQuote(null); setShowQuote(true) }} />}
          {active === 'Sales Pipeline' && <SalesPipelineBoard />}
          {active === 'Operations'     && <OperationsBoard />}
          {active === 'Jobs'           && <OperationsBoard />}
          {active === 'Staging'        && <OperationsBoard />}
          {active === 'Schedule'  && <SchedulePage />}
          {active === 'Dispatch'  && <DispatchPage />}
          {active === 'Reports'   && <ReportsPage quotes={quotes} />}
          {active === 'Site Plans' && <SitePlansPage />}

          {active === 'Dashboard' && (
            <div className="space-y-6">
              {/* KPI strip */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
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
