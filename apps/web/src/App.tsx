import { SyncBadge } from './SaveStatus'
import { startColorReadyWatch } from './colorReady'
import { styleLabel } from './fenceCatalog'
import { startOutbox, resumeAfterSignIn } from './outbox'
import { startLiveRefresh } from './liveRefresh'
import './liveOverhead'
import { useState, useMemo, useRef, useEffect, useLayoutEffect, Fragment, lazy, Suspense } from 'react'
import QuoteBuilder from './QuoteBuilder'
import { BarChart3, Building2, Calculator, CalendarClock, CalendarDays, ClipboardList, CreditCard, Globe, Kanban, LayoutDashboard, Map, MapPin, Package, PiggyBank, Plug, Receipt, Scale, Settings, ShieldCheck, Sun, TrendingUp, UserCog, Users, Wrench, Zap, Menu, ChevronsLeft, ChevronsRight, Plus, Search, type LucideIcon } from 'lucide-react'
import AdminPage from './AdminPage'
const AdminSettingsPage = lazy(() => import('./AdminSettingsPage'))
const BudgetPage = lazy(() => import('./BudgetPage'))
import CustomersPage from './CustomersPage'
import QuotesPage, { type SavedQuote } from './QuotesPage'
import JobsPage from './JobsPage'
import SalesPipelineBoard from './SalesPipelineBoard'
import { startNav, navigate, useNav, pagePath, pageForPath, takeOpenedParam, savedScroll, BackClose } from './nav'
const OperationsBoard = lazy(() => import('./OperationsBoard'))
const AuditLogPage = lazy(() => import('./AuditLogPage'))
const FeedbackPage = lazy(() => import('./FeedbackPage'))
import FeedbackButton from './FeedbackButton'
import { MessageSquarePlus, PhoneCall } from 'lucide-react'
const SchedulePage = lazy(() => import('./SchedulePage'))
const ReportsPage = lazy(() => import('./ReportsPage'))
const MapQuoteBuilder = lazy(() => import('./MapQuoteBuilder'))
import type { MapFenceData } from './MapQuoteBuilder'
const SitePlanTool = lazy(() => import('./SitePlanTool'))
const PortalInbox = lazy(() => import('./PortalInbox'))
const SmartSchedule = lazy(() => import('./SmartSchedule'))
const DispatchPage = lazy(() => import('./DispatchPage'))
const EZBudgetPage = lazy(() => import('./EZBudgetPage'))
const AutomationsPage = lazy(() => import('./AutomationsPage'))
const IntegrationsPage = lazy(() => import('./IntegrationsPage'))
const TeamManagementPage = lazy(() => import('./TeamManagementPage'))
const BillingPage = lazy(() => import('./BillingPage'))
import LoginPage from './LoginPage'
import ChangePasswordPage from './ChangePasswordPage'
const PLStatementPage = lazy(() => import('./PLStatementPage'))
const BalanceSheetPage = lazy(() => import('./BalanceSheetPage'))
const VendorsPage = lazy(() => import('./VendorsPage'))
const AccountsPayablePage = lazy(() => import('./AccountsPayablePage'))
const PendingOrdersPage = lazy(() => import('./PendingOrdersPage'))
const SitePlansPage = lazy(() => import('./SitePlansPage'))
const InventoryPage = lazy(() => import('./InventoryPage'))
import CustomerPortalApp from './CustomerPortalApp'
import NotificationBell from './NotificationBell'
import MessagesInbox from './MessagesInbox'
import PublicQuotePage from './PublicQuotePage'
import { isAuthenticated, checkSession, logout as crmLogout, canAccess, setSessionExpiredHandler, type CrmUser } from './crmAuth'
import { initCustomers, getCustomers, isCustomersHydrated } from './customerStore'
import { initQuotes, getQuotes, getQuoteById, upsertQuote, isQuotesHydrated } from './quoteStore'
import { initJobs, isJobsHydrated, getJobs } from './jobStore'
import type { Job } from './jobStore'
import { initSchedule, isScheduleHydrated } from './scheduleStore'
import { initPipeline, getPipeline, isPipelineHydrated } from './pipelineStore'
import { initInventory, isInventoryHydrated } from './inventoryStore'
import DeletionReminder from './DeletionReminder'
import FinishSetup, { DiskWarning, DuplicateWarning } from './FinishSetup'
import { initVendors, isVendorsHydrated } from './vendorStore'
import { initBusinessState, isBusinessStateHydrated } from './businessStateStore'
import { initCloudStorage, isCloudStorageHydrated } from './cloudStorage'
import { initOpsStages, isOpsStagesLoaded } from './opsStagesStore'
import { startIntakeSync } from './intakeStore'
import { initTierSets, isTierSetsLoaded } from './tierSetsApi'
import { ToastContainer, toast } from './toast'
import { setSignedInRole, isFullRole, can } from './permissions'
import { REFUSED_EVENT } from './outbox'
import StageBlockedNotice from './StageBlockedNotice'
import { isUpdateReady, reloadIfSafe, UPDATE_READY_EVENT } from './appUpdate'
import { linkPullSheetToCustomer, getPullSheetsForCustomer } from './billingStore'
import { createJobFromQuote, getJobByQuoteId } from './jobStore'
import { syncQuote } from './portalSync'
import { createPendingOrderFromQuote, checkStockForOrder } from './pendingOrderStore'
import { fireQuoteSold } from './automationTrigger'
import { installedRevenueForYear, soldNotInstalled, averageMargin } from './quoteStats'
import { initAppointments, isAppointmentsHydrated } from './appointmentsStore'
const AppointmentsPage = lazy(() => import('./AppointmentsPage'))
import TodayScreen from './TodayScreen'
import FollowUpsPage from './FollowUpsPage'
import { FollowUpPromptHost } from './FollowUpPrompt'
import { startFollowUps } from './followUpStore'
import { BookingHost, openBooking } from './BookingDialog'
import GlobalSearch from './GlobalSearch'
import { DashboardAppointments } from './AppointmentWidgets'
import { businessDate } from './businessDate'

/* ───────── role system ───────── */

export type UserRole = 'owner' | 'admin' | 'salesman' | 'ops_manager' | 'shop'

interface NavItem {
  name: string
  icon: LucideIcon
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
      { name: 'Sales Pipeline',  icon: Kanban, roles: ['owner', 'admin', 'salesman'] },
      { name: 'Appointments',    icon: CalendarDays, roles: ['owner', 'admin', 'salesman', 'ops_manager'] },
      { name: 'Today',           icon: Sun, roles: ['owner', 'admin', 'salesman', 'ops_manager'] },
      { name: 'Follow ups',      icon: PhoneCall, roles: ['owner', 'admin', 'salesman', 'ops_manager'] },
      { name: 'Dashboard',       icon: LayoutDashboard, roles: ['owner', 'admin', 'salesman', 'ops_manager'] },
      { name: 'Customers',       icon: Users, roles: ['owner', 'admin', 'salesman'] },
      { name: 'Quotes',          icon: ClipboardList, roles: ['owner', 'admin', 'salesman'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { name: 'Operations',  icon: Wrench, roles: ['owner', 'admin', 'ops_manager', 'shop'] },
      { name: 'Schedule',    icon: CalendarClock, roles: ['owner', 'admin', 'ops_manager', 'salesman'] },
      { name: 'Dispatch',    icon: MapPin, roles: ['owner', 'admin', 'ops_manager'] },
      { name: 'Site Plans',   icon: Map, roles: ['owner', 'admin', 'ops_manager', 'salesman'] },
      { name: 'Inventory',   icon: Package, roles: ['owner', 'admin', 'ops_manager', 'shop'] },
    ],
  },
  {
    label: 'Finance',
    items: [
      { name: 'P&L Statement',      icon: TrendingUp, roles: ['owner', 'admin'] },
      { name: 'Balance Sheet',      icon: Scale, roles: ['owner', 'admin'] },
      // Cash Flow comes back here once its statement is built.
      { name: 'Billing',            icon: CreditCard, roles: ['owner', 'admin'] },
      { name: 'Accounts Payable',   icon: Receipt, roles: ['owner', 'admin', 'ops_manager'] },
      { name: 'Vendors',            icon: Building2, roles: ['owner', 'admin', 'ops_manager'] },
      { name: 'Reports',            icon: BarChart3, roles: ['owner', 'admin'] },
      { name: 'Budget',             icon: PiggyBank, roles: ['owner'] },
    ],
  },
  {
    label: 'Admin',
    items: [
      { name: 'Team',           icon: UserCog, roles: ['owner', 'admin'] },
      { name: 'EZ Budget',      icon: Calculator, roles: ['owner', 'admin'] },
      { name: 'Automations',    icon: Zap, roles: ['owner', 'admin'] },
      { name: 'Integrations',  icon: Plug, roles: ['owner', 'admin'] },
      { name: 'Portal',        icon: Globe, roles: ['owner', 'admin'] },
      { name: 'Audit Log',     icon: ShieldCheck, roles: ['owner', 'admin'] },
      { name: 'Feedback',      icon: MessageSquarePlus, roles: ['owner', 'admin'] },
      { name: 'Settings',      icon: Settings, roles: ['owner', 'admin'] },
    ],
  },
]

const ALL_NAV_ITEMS = NAV_GROUPS.flatMap(g => g.items)
// Every page the app can show, for its address (/customers, /pipeline, ...).
const PAGE_NAMES = [...new Set([...ALL_NAV_ITEMS.map(i => i.name), 'Jobs', 'Staging'])]
const PAGES_WITH_HEADER = new Set(['Dashboard', 'Sales Pipeline', 'Follow ups', 'Operations', 'Jobs', 'Staging', 'Appointments', 'Today', 'Settings', 'Billing', 'Inventory', 'P&L Statement'])

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
  return 'Getter Done Fence'
}

/** Shown for the moment a page's code is still on its way (it loads on first use). */
function PageLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-9 w-64" />
      <div className="skeleton h-28 w-full" />
      <div className="grid gap-4 md:grid-cols-2"><div className="skeleton h-48" /><div className="skeleton h-48" /></div>
    </div>
  )
}

/** Good morning, afternoon or evening, by the Florida clock. */
function greeting(): string {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }))
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
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


/* ═══════════════════════════════════════════════
   APP SHELL
   ═══════════════════════════════════════════════ */

/**
 * Load every module's data from the server. Runs after login AND after a page
 * reload with an existing session, and the app does not render until it has
 * finished. (A fresh login used to load customers only. Quotes, jobs,
 * inventory, vendors, pipeline, schedule and settings stayed empty until the
 * page was reloaded, and anything saved in that state overwrote the server
 * with the empty copy.)
 */
const STORE_LOADERS: Array<{ name: string; load: () => Promise<void>; loaded: () => boolean }> = [
  { name: 'Customers', load: initCustomers, loaded: isCustomersHydrated },
  { name: 'Quotes', load: initQuotes, loaded: isQuotesHydrated },
  { name: 'Jobs', load: initJobs, loaded: isJobsHydrated },
  { name: 'Operations stages', load: initOpsStages, loaded: isOpsStagesLoaded },
  { name: 'Schedule', load: initSchedule, loaded: isScheduleHydrated },
  { name: 'Sales pipeline', load: initPipeline, loaded: isPipelineHydrated },
  { name: 'Appointments', load: initAppointments, loaded: isAppointmentsHydrated },
  { name: 'Inventory', load: initInventory, loaded: isInventoryHydrated },
  { name: 'Vendors', load: initVendors, loaded: isVendorsHydrated },
  { name: 'Settings and business data', load: initBusinessState, loaded: isBusinessStateHydrated },
  { name: 'Job costing, change orders, site plans and files', load: initCloudStorage, loaded: isCloudStorageHydrated },
  { name: 'Good Better Best tiers', load: initTierSets, loaded: isTierSetsLoaded },
]

async function hydrateStores(): Promise<string[]> {
  await Promise.all(STORE_LOADERS.map(s => s.load().catch(() => {})))
  return STORE_LOADERS.filter(s => !s.loaded()).map(s => s.name)
}

const ROLE_MAP: Record<string, UserRole> = {
  super_admin: 'owner', admin: 'admin', manager: 'admin',
  sales_rep: 'salesman', field_crew: 'shop', office_staff: 'ops_manager',
}

function AuthGate({ children, onLogout }: { children: (user: CrmUser, logout: () => void, changePassword: () => void) => React.ReactNode; onLogout?: () => void }) {
  const [authChecked, setAuthChecked] = useState(false)
  const [crmUser, setCrmUser] = useState<CrmUser | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [notLoaded, setNotLoaded] = useState<string[]>([])
  const [showChangePassword, setShowChangePassword] = useState(false)
  // Signed in, but the server could not be reached to check it (no signal, or the server restarting).
  const [unreachable, setUnreachable] = useState(false)

  async function loadData(user: CrmUser) {
    setLoadingData(true)
    // What this phone still has waiting goes back on screen as each module loads, then is sent.
    await startOutbox(user.id)
    resumeAfterSignIn()
    const failed = await hydrateStores()
    setNotLoaded(failed)
    setLoadingData(false)
    // Follow up badges, and this phone's answers still waiting for signal back on screen.
    void startFollowUps()
    // Website quotes and phone calls that came in while nobody was looking.
    startIntakeSync()
    startLiveRefresh()
    // A color added in Settings says so when it becomes fully priced.
    startColorReadyWatch()
  }

  function startSession(user: CrmUser) {
    setSignedInRole(user.role)
    saveUserProfile({ name: `${user.firstName} ${user.lastName}`, role: ROLE_MAP[user.role] || 'salesman' })
    setLoadingData(true)
    setCrmUser(user)
    void loadData(user)
  }

  async function checkAgain() {
    const s = await checkSession()
    if (s.kind === 'user') { setUnreachable(false); startSession(s.user) }
    else if (s.kind === 'signed-out') setUnreachable(false)
    else setUnreachable(true)
    setAuthChecked(true)
  }
  useEffect(() => {
    if (!unreachable) return
    const again = () => { void checkAgain() }
    window.addEventListener('online', again)
    const t = setInterval(again, 15_000)
    return () => { window.removeEventListener('online', again); clearInterval(t) }
  })

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

  // A save the server refused for this login's role: the screen is already put back; say why.
  useEffect(() => {
    const onRefused = (e: Event) => toast.error('Not saved', String((e as CustomEvent).detail?.message || 'Your login is not allowed to do this. Ask Jonathan.'))
    window.addEventListener(REFUSED_EVENT, onRefused)
    return () => window.removeEventListener(REFUSED_EVENT, onRefused)
  }, [])

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setCrmUser(null)
      toast.warning('Your session has expired', 'Please log in again — your local work has been preserved.')
    })
    if (isAuthenticated()) {
      void checkAgain()
    } else {
      setAuthChecked(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleLogin(user: CrmUser) {
    startSession(user)
  }

  function handleLogout() {
    // Reload after signing out so no data from this session stays in memory
    // for whoever logs in next on this browser.
    crmLogout().finally(() => { window.location.reload() })
    setCrmUser(null)
  }

  if (!authChecked) {
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center"><div className="text-gray-500">Loading...</div></div>
  }
  if (unreachable && !crmUser) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6" data-no-signal-screen>
        <div className="max-w-sm text-center space-y-4">
          <h1 className="text-xl font-bold text-gray-900">No signal</h1>
          <p className="text-base text-gray-700">EZ Biz cannot reach the office server right now. You are still signed in, and anything saved on this phone is kept and will be sent when there is signal.</p>
          <button type="button" className="btn btn-primary w-full min-h-[48px]" onClick={() => { void checkAgain() }}>Try again</button>
          <p className="text-sm text-gray-500">This page tries again by itself every 15 seconds.</p>
        </div>
      </div>
    )
  }
  if (!crmUser) {
    return <LoginPage onLogin={handleLogin} />
  }
  if (crmUser.mustChangePassword) {
    return (
      <ChangePasswordPage
        forced
        onDone={() => { setCrmUser({ ...crmUser, mustChangePassword: false }); toast.success('Password changed') }}
        onCancel={handleLogout}
      />
    )
  }
  if (loadingData) {
    return <div className="min-h-screen bg-gray-900 flex items-center justify-center"><div className="text-gray-500">Loading your data...</div></div>
  }

  return (
    <>
      {notLoaded.length > 0 && (
        <div className="fixed top-0 inset-x-0 z-[200] bg-red-600 text-white text-sm px-4 py-2 flex items-center justify-center gap-3 flex-wrap">
          <span>
            <strong>{notLoaded.join(', ')} did not load.</strong> Usually that is weak signal. Tap Try again when you have signal; changes to those are not shown until they load.
          </span>
          <button onClick={() => void loadData(crmUser)} className="bg-white text-red-700 font-semibold text-sm px-4 min-h-[44px] rounded">Try again</button>
        </div>
      )}
      <UpdateReady />
      {children(crmUser, handleLogout, () => setShowChangePassword(true))}
      {showChangePassword && (
        <ChangePasswordPage
          forced={false}
          onDone={() => { setShowChangePassword(false); toast.success('Password changed', 'Your other devices have been signed out.') }}
          onCancel={() => setShowChangePassword(false)}
        />
      )}
    </>
  )
}

export default function App() {
  // Public quote route: /#/quote/:token — no auth required
  const [hash, setHash] = useState(typeof window !== 'undefined' ? window.location.hash : '')
  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])
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
      <StageBlockedNotice />
      <AuthGate>
        {(crmUser, logout, changePassword) => <AppShell crmUser={crmUser} onLogout={logout} onChangePassword={changePassword} />}
      </AuthGate>
    </>
  )
}

function AppShell({ crmUser, onLogout, onChangePassword }: { crmUser: CrmUser; onLogout: () => void; onChangePassword: () => void }) {
  // Every screen has its own address, so Back, reloads and links work (see
  // nav.ts). Links from outside the app: ?customer=<id> (a calendar event's
  // "Open in EZ Biz") opens that customer; ?settings=calendar (back from
  // Google) opens Settings.
  useState(() => {
    const q = new URLSearchParams(window.location.search)
    const id = q.get('customer')
    if (id) { q.delete('customer'); startNav(`/customers/${encodeURIComponent(id)}${q.toString() ? `?${q}` : ''}${window.location.hash}`) }
    else if (q.get('settings') && window.location.pathname === '/') startNav(`/settings${window.location.search}${window.location.hash}`)
    else startNav()
    return true
  })
  const nav = useNav()
  const active = pageForPath(nav.path, PAGE_NAMES)
  const setActive = (page: string) => navigate(pagePath(page))
  const [showQuote, setShowQuote]       = useState(false)
  const [editingQuote, setEditingQuote] = useState<SavedQuote | null>(null)
  const [quotes, setQuotes]             = useState<SavedQuote[]>(loadQuotes)
  const [jobs, setJobs]                 = useState<Job[]>(getJobs)
  // Back to a screen puts its scroll back; a new screen starts at the top.
  const pageScroll = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const el = pageScroll.current
    if (!el) return
    const want = savedScroll() ?? 0
    el.scrollTop = want
    // Pages that draw after loading: keep trying for a moment.
    let tries = 0, frame = 0
    const again = () => { if (el.scrollTop !== want && tries++ < 40) { el.scrollTop = want; frame = requestAnimationFrame(again) } }
    frame = requestAnimationFrame(again)
    const stop = () => cancelAnimationFrame(frame)
    el.addEventListener('wheel', stop, { once: true }); el.addEventListener('touchstart', stop, { once: true })
    return () => { stop(); el.removeEventListener('wheel', stop); el.removeEventListener('touchstart', stop) }
  }, [nav.path])

  // When a save was refused and another device's changes were merged in (see
  // syncGuard), the page on screen may still hold its own older copy of that
  // record. Screens that can refresh in place do (useMergedRefresh); for the
  // rest the page is remounted so it reads the merged data, but never while
  // the user is typing in a field.
  const [dataEpoch, setDataEpoch] = useState(0)
  useEffect(() => {
    let pending = false
    const typing = () => {
      const el = document.activeElement as HTMLElement | null
      return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    }
    const refresh = () => {
      if (!pending || typing()) return
      pending = false
      setDataEpoch(e => e + 1)
    }
    const onReload = () => { pending = true; refresh() }
    const onFocusOut = () => setTimeout(refresh, 0)
    window.addEventListener('ezbiz:reload-page-data', onReload)
    window.addEventListener('focusout', onFocusOut)
    return () => {
      window.removeEventListener('ezbiz:reload-page-data', onReload)
      window.removeEventListener('focusout', onFocusOut)
    }
  }, [])
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

  // Revenue on the dashboard comes from jobs, so follow them as they change.
  useEffect(() => {
    const onJobs = () => setJobs([...getJobs()])
    window.addEventListener('fencepro:jobs:updated', onJobs)
    return () => window.removeEventListener('fencepro:jobs:updated', onJobs)
  }, [])

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

  // A limited login (salesman, crew, office) opening a page that is not in its menu, by link or address: back to Today.
  const pageItem = ALL_NAV_ITEMS.find(i => i.name === active)
  const pageBlocked = !isFullRole() && !!pageItem && !pageItem.roles.includes(role)
  const toldBlocked = useRef('')
  useEffect(() => {
    if (!pageBlocked) { toldBlocked.current = ''; return }
    if (toldBlocked.current !== active) { toldBlocked.current = active; toast.info(`${active} is not open to your login`, 'Ask Jonathan if you need it.') }
    setActive('Today')
  })

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
            quoteName: `${styleLabel(q.fenceStyle)} — ${q.customerName}`,
            versionSnapshot: JSON.parse(JSON.stringify(q.pullSheet)),
            versionNumber,
            linkedAt: new Date().toISOString(),
            linkedBy: 'auto',
          })
        } catch { /* silent — pull sheet link is non-critical */ }
      }

      // Not "saved" until the server has it: the quote shows Saved then, and the badge at the top until then.
      toast.info(q.status === 'SOLD' ? 'Quote sold, job created' : 'Quote stored', 'Sending it now. The quote shows Saved once it has gone through; with no signal it waits on this phone and goes by itself.')

      // Sync to customer portal — surface errors
      syncQuote(q).catch((err: any) => {
        toast.warning('The customer portal copy did not update', 'The quote itself is kept. Open and save the quote again later to update the portal.')
      })
    } catch (err: any) {
      toast.error('Could not save quote', err?.message || 'Unknown error. Your data may be at risk — try again.')
    }
  }

  function handleOpenQuote(q: SavedQuote) {
    setEditingQuote(q)
    setShowQuote(true)
  }

  /** A new quote for a customer: from their page, or from an appointment closed out "Ready to quote" (with its property and measurements). */
  function openQuoteFor(c: { id: string; firstName: string; lastName: string; phone?: string; email?: string; serviceAddress?: string; leadSource?: string; salesRep?: string }, extra: { address?: string; notes?: string } = {}) {
    setEditingQuote({
      id: undefined as unknown as string,
      customerId: c.id,
      customerName: `${c.firstName} ${c.lastName}`.trim(),
      customerPhone: c.phone || '',
      customerEmail: c.email || '',
      customerAddress: extra.address || c.serviceAddress || '',
      leadSource: c.leadSource || '',
      salesRep: c.salesRep || '',
      fenceStyle: '', runs: [], corners: 0, ends: 0,
      walkGates: 0, dblGates: 0, tearOutSections: 0, tearOutGates: 0,
      adjLaborHrs: 0, hasSalesman: false, priceAdjust: 0,
      sections: 0, materialCost: 0, laborCost: 0, tearOutCost: 0,
      totalCOGS: 0, finalPrice: 0, gmPct: 0, pullSheet: [],
      status: 'DRAFT', date: businessDate(new Date()),
      notes: extra.notes || '', leadTemp: 0,
    } as SavedQuote)
    setShowQuote(true)
  }

  // An appointment closed out "Ready to quote" opens the quote builder, filled in.
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ customerId: string; address?: string; notes?: string }>).detail
      const c = d?.customerId ? getCustomers().find(x => x.id === d.customerId) : null
      if (c) openQuoteFor(c, { address: d.address, notes: d.notes })
    }
    window.addEventListener('ezbiz:new-quote', h)
    return () => window.removeEventListener('ezbiz:new-quote', h)
  })

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
      date: businessDate(new Date()),
      notes: '',
      leadTemp: 0,
    } as SavedQuote)
    setShowQuote(true)
  }

  // A quote named in the address opens: after a reload, from a link, or when
  // Back or Forward lands on it. ?quote=<id>, or ?quote=new&for=<customer>.
  useEffect(() => {
    const q = nav.params.get('quote') ?? takeOpenedParam('quote')
    const forId = nav.params.get('for') ?? takeOpenedParam('for')
    if (!q || showQuote) return
    if (q === 'new') {
      const c = forId ? getCustomers().find(x => x.id === forId) : null
      if (c) openQuoteFor(c); else { setEditingQuote(null); setShowQuote(true) }
      return
    }
    const found = getQuoteById(q) ?? quotes.find(x => x.id === q)
    if (found) handleOpenQuote(found as SavedQuote)
  }, [nav])  // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Search ── */
  function openCustomerFromAnywhere(customerId: string, tab?: string) {
    navigate(`/customers/${encodeURIComponent(customerId)}`)
    if (tab) setTimeout(() => { try { window.dispatchEvent(new CustomEvent('fencepro:select-customer', { detail: { customerId, tab } })) } catch {} }, 50)
  }

  /* ── Dashboard stats ── */

  const thisMonth    = new Date().getMonth()
  const thisYear     = new Date().getFullYear()
  // Installed revenue by install date, the way the GD Schedule counts it.
  const ytdRevenue   = installedRevenueForYear(jobs, thisYear)
  const openSold     = soldNotInstalled(jobs)
  const monthQuotes  = quotes.filter(q => {
    if (!q.date) return false
    const d = new Date(q.date)
    return d.getMonth() === thisMonth && d.getFullYear() === thisYear
  })
  const monthSold    = monthQuotes.filter(q => q.status === 'SOLD').length
  const openQuotes   = quotes.filter(q => q.status === 'DRAFT' || q.status === 'SENT').length
  const avgMargin    = averageMargin(quotes)
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
    { label: 'Revenue this year', value: fmt(ytdRevenue), sub: `${fmtPct(ytdRevenue / revenueGoal)} of the ${fmt(revenueGoal)} goal`, sub2: `Sold, not installed: ${fmt(openSold.total)} (${openSold.count} ${openSold.count === 1 ? 'job' : 'jobs'})`, tone: 'hero' as const },
    { label: 'Sold this month', value: String(monthSold), sub: `${monthQuotes.length} quoted · ${monthQuotes.length > 0 ? fmtPct(monthSold / monthQuotes.length) : '0%'} close rate`, tone: 'plain' as const },
    { label: 'Open quotes', value: String(openQuotes), sub: fmt(quotes.filter(q => q.status === 'DRAFT' || q.status === 'SENT').reduce((s, q) => s + q.finalPrice, 0)), tone: 'plain' as const },
    { label: 'Active pipeline', value: String(activePipeline), sub: 'leads in progress', tone: 'plain' as const },
    { label: 'Average margin', value: avgMargin === null ? '—' : fmtPct(avgMargin), sub: avgMargin === null ? 'Needs quotes with costs' : avgMargin >= 0.34 ? 'On target' : 'Below the 34% target', tone: avgMargin !== null && avgMargin < 0.34 ? 'bad' as const : 'plain' as const },
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
      {mobileMenuOpen && <BackClose name="menu" onClose={() => setMobileMenuOpen(false)} />}
      <div className={`mobile-nav-drawer bg-gray-900 flex flex-col ${mobileMenuOpen ? 'open' : ''}`} data-popup="nav-drawer">
        <div className="border-b border-white/10 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/logo.png" alt="" className="w-10 h-10 rounded-lg bg-white object-contain shrink-0" />
            <div>
              <p className="text-white text-base font-extrabold leading-tight [font-stretch:112%]">{companyName}</p>
              <p className="text-[#9C8FB5] text-xs mt-0.5">EZ Biz</p>
            </div>
          </div>
          <button onClick={() => setMobileMenuOpen(false)} aria-label="Close menu" className="text-[#CFC4E2] hover:text-white text-2xl leading-none w-11 h-11 grid place-items-center">×</button>
        </div>
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {visibleGroups.map(group => (
            <div key={group.label}>
              <p className="px-3 mb-1.5 text-xs font-semibold text-[#9C8FB5]">{group.label}</p>
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <button
                    key={item.name}
                    onClick={() => { setActive(item.name); setMobileMenuOpen(false) }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                      active === item.name ? 'bg-orange-500 text-white font-semibold' : 'text-[#CFC4E2] hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <item.icon size={18} strokeWidth={2} aria-hidden="true" />
                    <span>{item.name}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-orange-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
              {userProfile.name.charAt(0).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-medium truncate">{userProfile.name}</p>
              {isFullRole() ? <select
                value={role}
                onChange={e => handleRoleChange(e.target.value as UserRole)}
                className="bg-transparent text-[#CFC4E2] text-xs outline-none cursor-pointer hover:text-white -ml-0.5"
              >
                {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(([k, v]) => (
                  <option key={k} value={k} className="bg-gray-900 text-gray-300">{v}</option>
                ))}
              </select> : <p className="text-[#CFC4E2] text-xs" data-role-label>{ROLE_LABELS[role]}</p>}
            </div>
          </div>
          <button onClick={onChangePassword} className="mt-2 w-full text-xs text-[#9C8FB5] hover:text-white text-left py-1">
            Change password
          </button>
          <button onClick={onLogout} className="mt-1 w-full text-xs text-[#9C8FB5] hover:text-white text-left py-1">
            Sign out
          </button>
        </div>
      </div>

      {/* ═══ SIDEBAR (desktop only — hidden on mobile via CSS) ═══ */}
      <div className={`sidebar-desktop ${sidebarW} bg-gray-900 flex flex-col transition-all duration-200 shrink-0`}>

        {/* Brand */}
        <div className={`border-b border-white/10 flex items-center ${sidebarCollapsed ? 'px-3 py-4 justify-center' : 'px-5 py-4'}`}>
          {sidebarCollapsed ? (
            <img src="/logo.png" alt={companyName} className="w-9 h-9 rounded-lg bg-white object-contain" />
          ) : (
            <div className="flex items-center gap-3">
              <img src="/logo.png" alt="" className="w-10 h-10 rounded-lg bg-white object-contain shrink-0" />
              <div className="min-w-0">
                <p className="text-white text-[15px] font-extrabold leading-tight [font-stretch:112%]">{companyName}</p>
                <p className="text-[#9C8FB5] text-xs mt-0.5">EZ Biz</p>
              </div>
            </div>
          )}
        </div>

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-4">
          {visibleGroups.map(group => (
            <div key={group.label}>
              {!sidebarCollapsed && (
                <p className="px-3 mb-1.5 text-xs font-semibold text-[#9C8FB5]">{group.label}</p>
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
                        ? 'bg-orange-500 text-white font-semibold'
                        : 'text-[#CFC4E2] hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <item.icon size={18} strokeWidth={2} aria-hidden="true" />
                    {!sidebarCollapsed && <span>{item.name}</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <div className="px-2 py-2 border-t border-white/10">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-[#9C8FB5] hover:text-white hover:bg-white/10 transition-colors text-sm"
          >
            {sidebarCollapsed ? <ChevronsRight size={18} aria-hidden="true" /> : <ChevronsLeft size={18} aria-hidden="true" />}
            {!sidebarCollapsed && <span className="text-xs">Collapse</span>}
          </button>
        </div>

        {/* User profile + role */}
        <div className={`border-t border-white/10 ${sidebarCollapsed ? 'px-2 py-3' : 'px-4 py-3'}`}>
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
                {isFullRole() ? <select
                  value={role}
                  onChange={e => handleRoleChange(e.target.value as UserRole)}
                  className="bg-transparent text-[#CFC4E2] text-xs outline-none cursor-pointer hover:text-white -ml-0.5"
                >
                  {(Object.entries(ROLE_LABELS) as [UserRole, string][]).map(([k, v]) => (
                    <option key={k} value={k} className="bg-gray-900 text-gray-300">{v}</option>
                  ))}
                </select> : <p className="text-[#CFC4E2] text-xs" data-role-label>{ROLE_LABELS[role]}</p>}
              </div>
            </div>
          )}
          {!sidebarCollapsed && (
            <>
              <button onClick={onChangePassword} className="mt-2 w-full text-xs text-[#9C8FB5] hover:text-white text-left py-1">
                Change password
              </button>
              <button onClick={onLogout} className="mt-1 w-full text-xs text-[#9C8FB5] hover:text-white text-left py-1">
                Sign out
              </button>
            </>
          )}
        </div>
      </div>

      {/* ═══ MAIN CONTENT ═══ */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Top header bar */}
        <div className="bg-white border-b border-gray-200 px-3 md:px-6 h-14 md:h-auto md:py-3 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 md:gap-4 min-w-0">
            {/* Hamburger — mobile only (hidden on desktop via CSS) */}
            <button onClick={() => setMobileMenuOpen(true)} aria-label="Open menu" className="mobile-only max-md:!hidden text-gray-600 hover:text-gray-900 w-11 h-11 grid place-items-center -ml-2">
              <Menu size={24} aria-hidden="true" />
            </button>
            {/* Pages with their own header show their title there; the bar shows it only on the phone. */}
            {PAGES_WITH_HEADER.has(active) ? (
              <span className="flex items-center gap-2 min-w-0 lg:hidden">
                <img src="/logo.png" alt="" className="w-8 h-8 rounded-md object-contain" />
                <span className="text-base font-extrabold text-gray-900 truncate [font-stretch:112%]">{companyName}</span>
              </span>
            ) : (
              <h2 className="text-lg font-bold text-gray-900 truncate">{active}</h2>
            )}
          </div>

          <div className="flex items-center gap-1 md:gap-3 shrink-0">
            <MessagesInbox onNavigateToCustomer={(customerId) => openCustomerFromAnywhere(customerId, 'messages')} />
            <SyncBadge />
            <FeedbackButton />
            <NotificationBell />
            {/* Command search */}
            <button
              onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 50) }}
              aria-label="Search"
              className="flex items-center justify-center md:justify-start gap-2 md:bg-gray-100 hover:bg-gray-200 md:border border-gray-200 rounded-lg md:px-3 w-11 h-11 md:h-9 text-sm text-gray-600 transition-colors md:w-80" data-header-search
            >
              <Search size={20} className="md:w-4 md:h-4" aria-hidden="true" />
              <span className="flex-1 text-left hidden md:inline">Search customers, quotes, jobs</span>
              <kbd className="text-[10px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-mono hidden md:inline">⌘K</kbd>
            </button>

            {/* On the phone these live in the pages and the tab bar instead. */}
            <div data-topbar-actions className="hidden md:flex items-center gap-3">
            {/* Book an appointment from any page */}
            <button onClick={() => openBooking()} data-global-appointment className="btn btn-secondary btn-sm">
              <Plus size={16} aria-hidden="true" /> Appointment
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
                  className="btn btn-primary"
                >
                  + New quote
                </button>
              </div>
            )}
            </div>
          </div>
        </div>

        {/* Page content */}
        <div ref={pageScroll} data-page-scroll className="flex-1 overflow-y-auto overflow-x-hidden px-4 md:px-8 py-4 md:py-6 max-md:pb-[calc(92px+env(safe-area-inset-bottom))]">
          {/* Keyed so the open page reloads its data after another device's changes are merged in. */}
          <Suspense fallback={<PageLoading />}>
          {!pageBlocked && <Fragment key={dataEpoch}>
          {active === 'Team' && <TeamManagementPage />}
          {active === 'EZ Budget' && <EZBudgetPage />}
          {active === 'Automations' && <AutomationsPage />}
          {active === 'Integrations' && <IntegrationsPage />}
          {active === 'Portal'    && <PortalInbox />}
          {active === 'Audit Log' && <AuditLogPage />}
          {active === 'Feedback'  && <FeedbackPage />}
          {active === 'Settings'  && <AdminSettingsPage />}
          {active === 'Inventory' && <InventoryPage />}
          {active === 'Pending Orders' && <PendingOrdersPage />}
          {active === 'Budget'    && <BudgetPage />}
          {active === 'Billing'   && <BillingPage />}
          {active === 'P&L Statement' && <PLStatementPage />}
          {active === 'Balance Sheet' && <BalanceSheetPage />}
          {active === 'Accounts Payable' && <AccountsPayablePage />}
          {active === 'Vendors'   && <VendorsPage />}
          {active === 'Customers' && <CustomersPage
            onNewQuote={(c) => {
            if (c) openQuoteFor(c)
            else { setEditingQuote(null); setShowQuote(true) }
          }} />}
          {active === 'Quotes'    && <QuotesPage quotes={quotes} onOpenQuote={handleOpenQuote} onNewQuote={() => { setEditingQuote(null); setShowQuote(true) }} />}
          {active === 'Sales Pipeline' && <SalesPipelineBoard onNewQuote={c => openQuoteFor(c)} onOpenQuote={q => handleOpenQuote(q)} />}
          {active === 'Operations'     && <OperationsBoard />}
          {active === 'Jobs'           && <OperationsBoard />}
          {active === 'Staging'        && <OperationsBoard />}
          {active === 'Schedule'  && <SchedulePage />}
          {active === 'Appointments' && <AppointmentsPage />}
          {active === 'Today'     && <TodayScreen />}
          {active === 'Follow ups' && <FollowUpsPage />}
          {active === 'Dispatch'  && <DispatchPage />}
          {active === 'Reports'   && <ReportsPage quotes={quotes} />}
          {active === 'Site Plans' && <SitePlansPage />}

          {active === 'Dashboard' && (
            <div className="space-y-6">
              {/* Scheduled deletions and the Mac's disk are the owner's and admins' (system tools). */}
              {can('system') && <DeletionReminder />}
              {can('system') && <DiskWarning />}
              {role === 'owner' && <FinishSetup />}
              {role === 'owner' && <DuplicateWarning />}
              <div className="page-header !mb-0">
                <div>
                  <h1>{greeting()}, {userProfile.name.split(' ')[0] || 'there'}</h1>
                  <div className="facts"><span><b>{fmt(ytdRevenue)}</b> installed this year</span><span><b>{openQuotes}</b> open quotes</span></div>
                </div>
                <div className="actions">
                  <button onClick={() => { setEditingQuote(null); setShowQuote(true) }} className="btn btn-secondary"><Plus size={18} aria-hidden="true" /> New quote</button>
                  <button onClick={() => openBooking()} className="btn btn-primary"><Plus size={18} aria-hidden="true" /> Book appointment</button>
                </div>
              </div>
              {/* Key numbers: one band, the most important first */}
              <div className="panel grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 overflow-hidden">
                {kpis.map((kpi, i) => (
                  <div key={kpi.label} className={`p-4 sm:p-5 border-gray-200 ${i > 0 ? 'border-l' : ''} ${i > 1 ? 'max-sm:border-t' : ''} ${i === 2 ? 'max-sm:border-l-0' : ''} ${kpi.tone === 'hero' ? 'bg-orange-500 text-white col-span-2 sm:col-span-1' : ''}`}>
                    <p className={`text-sm font-semibold ${kpi.tone === 'hero' ? 'text-[#E6DAF7]' : 'text-gray-600'}`}>{kpi.label}</p>
                    <p className={`text-2xl sm:text-[28px] font-bold tabular-nums mt-1 tracking-tight ${kpi.tone === 'bad' ? 'text-red-700' : kpi.tone === 'hero' ? 'text-white' : 'text-gray-900'}`}>{kpi.value}</p>
                    <p className={`text-sm mt-1 ${kpi.tone === 'hero' ? 'text-[#E6DAF7]' : 'text-gray-500'}`}>{kpi.sub}</p>
                    {'sub2' in kpi && kpi.sub2 && <p className={`text-sm mt-0.5 ${kpi.tone === 'hero' ? 'text-[#E6DAF7]' : 'text-gray-500'}`}>{kpi.sub2}</p>}
                  </div>
                ))}
              </div>
              <DashboardAppointments />

              {/* Revenue goal progress */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-900">Revenue goal</h3>
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
                    <h3 className="font-semibold text-gray-900">Recent quotes</h3>
                    <button onClick={() => setActive('Quotes')} className="btn btn-quiet btn-sm">All quotes</button>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {recentQuotes.length === 0 ? (
                      <div className="px-6 py-8 text-center text-gray-400 text-sm">No quotes yet</div>
                    ) : recentQuotes.map(q => (
                      <div key={q.id} className="px-6 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50" onClick={() => handleOpenQuote(q)}>
                        <div>
                          <p className="text-sm font-medium text-gray-900">{q.customerName}</p>
                          <p className="text-sm text-gray-500">{[styleLabel(q.fenceStyle), q.sections ? `${q.sections} sections` : '', q.date].filter(Boolean).join(' · ')}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          {q.totalCOGS > 0 && <span className={`text-sm ${marginColor(q.gmPct)}`}>{fmtPct(q.gmPct)}</span>}
                          <span className="text-sm font-semibold text-gray-900">{fmt(q.finalPrice)}</span>
                          <span className={`chip ${STATUS_COLORS[q.status]}`}>{q.status.charAt(0) + q.status.slice(1).toLowerCase()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* This month at a glance */}
                <div className="bg-white rounded-2xl border border-gray-200">
                  <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">This month at a glance</h3>
                    <span className="text-xs text-gray-400">{new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</span>
                  </div>
                  <div className="px-6 py-5 space-y-4">
                    {[
                      { label: 'Quotes Created', value: monthQuotes.length },
                      { label: 'Quotes Sold', value: monthSold },
                      { label: 'Close Rate', value: monthQuotes.length > 0 ? fmtPct(monthSold / monthQuotes.length) : '0%' },
                      { label: 'Revenue Closed', value: fmt(monthQuotes.filter(q => q.status === 'SOLD').reduce((s, q) => s + q.finalPrice, 0)) },
                      { label: 'Avg Deal Size', value: monthSold > 0 ? fmt(monthQuotes.filter(q => q.status === 'SOLD').reduce((s, q) => s + q.finalPrice, 0) / monthSold) : '$0' },
                      { label: 'Target Margin', value: fmtPct(1 - magicNumber) },
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
                    <p className="text-xs text-gray-400 mt-0.5">Target Margin: <span className="font-bold text-gray-700">{fmtPct(1 - magicNumber)}</span> · Revenue Goal: <span className="font-bold text-gray-700">{fmt(revenueGoal)}</span></p>
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
          </Fragment>}
          </Suspense>
        </div>
      </div>

      {/* ═══ COMMAND SEARCH OVERLAY ═══ */}
      {searchOpen && <BackClose name="search" onClose={() => { setSearchOpen(false); setSearchQuery('') }} />}
      {searchOpen && (
        <GlobalSearch
          onClose={() => { setSearchOpen(false); setSearchQuery('') }}
          quotes={quotes}
          jobs={jobs}
          pages={ALL_NAV_ITEMS.filter(i => i.roles.includes(role)).map(i => i.name)}
          openCustomer={openCustomerFromAnywhere}
          openQuote={q => handleOpenQuote(q as SavedQuote)}
          newQuoteFor={c => { if (c) openQuoteFor(c); else { setEditingQuote(null); setShowQuote(true) } }}
          newCustomer={() => navigate('/customers/new')}
          goTo={p => setActive(p)}
        />
      )}

      {/* ═══ BOOKING DIALOG (opened from anywhere with openBooking) ═══ */}
      <BookingHost />
      {/* "How'd it go?" after a Call or Text tap, and Log a call */}
      <FollowUpPromptHost />

      {/* ═══ PHONE TAB BAR ═══ */}
      <nav data-tabbar aria-label="Main" className="md:hidden fixed inset-x-0 bottom-0 z-40 bg-white border-t border-gray-200 grid grid-cols-6 pb-[env(safe-area-inset-bottom)]">
        {([['Today', Sun, 'Today'], ['Pipeline', Kanban, 'Sales Pipeline'], ['Follow ups', PhoneCall, 'Follow ups'], ['Customers', Users, 'Customers'], ['Schedule', CalendarDays, role !== 'salesman' && ALL_NAV_ITEMS.find(i => i.name === 'Schedule')?.roles.includes(role) ? 'Schedule' : 'Appointments']] as const).map(([label, Icon, page]) => (
          <button key={label} onClick={() => setActive(page)} aria-current={active === page ? 'page' : undefined}
            className={`h-16 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${active === page ? 'text-orange-500' : 'text-gray-500'}`}>
            <span className={`grid place-items-center h-8 w-14 rounded-full ${active === page ? 'bg-orange-100' : ''}`}><Icon size={22} aria-hidden="true" /></span>{label}
          </button>
        ))}
        <button onClick={() => setMobileMenuOpen(true)} aria-haspopup="menu" aria-expanded={mobileMenuOpen} data-popup-trigger="nav-drawer" className={`h-16 flex flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${mobileMenuOpen ? 'text-orange-500' : 'text-gray-500'}`}>
          <span className="grid place-items-center h-8 w-14 rounded-full"><Menu size={22} aria-hidden="true" /></span>More
        </button>
      </nav>

      {/* ═══ SMART SCHEDULE ═══ */}
      {showSmartSchedule && (
        <Suspense fallback={null}><BackClose name="smart-schedule" onClose={() => setShowSmartSchedule(false)} /><SmartSchedule onClose={() => setShowSmartSchedule(false)} /></Suspense>
      )}

      {/* ═══ SITE PLAN TOOL ═══ */}
      {showSitePlan && (
        <Suspense fallback={null}><BackClose name="site-plan-tool" onClose={() => setShowSitePlan(false)} /><SitePlanTool onClose={() => setShowSitePlan(false)} /></Suspense>
      )}

      {/* ═══ MAP QUOTE MODAL ═══ */}
      {showMapQuote && (
        <Suspense fallback={null}><BackClose name="map-quote" onClose={() => setShowMapQuote(false)} /><MapQuoteBuilder
          onUseData={handleMapQuoteData}
          onClose={() => setShowMapQuote(false)}
        /></Suspense>
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

/** A new version is on the Mac but this phone has unsaved work or changes still waiting to send: one tap takes it when ready. */
function UpdateReady() {
  const [ready, setReady] = useState(isUpdateReady())
  useEffect(() => { const h = () => setReady(true); window.addEventListener(UPDATE_READY_EVENT, h); return () => window.removeEventListener(UPDATE_READY_EVENT, h) }, [])
  if (!ready) return null
  return (
    <div className="fixed bottom-24 md:bottom-4 inset-x-0 z-[190] flex justify-center px-4 pointer-events-none" data-update-ready>
      <div className="pointer-events-auto bg-gray-900 text-white text-sm rounded-xl shadow-lg px-4 py-2 flex items-center gap-3">
        <span>A newer version of EZ Biz is ready.</span>
        <button type="button" className="bg-white text-gray-900 font-semibold rounded px-3 min-h-[44px]" onClick={() => { if (!reloadIfSafe()) toast.info('Not yet', 'Save or finish what is open, and let waiting changes send, then tap Update.') }}>Update</button>
      </div>
    </div>
  )
}

