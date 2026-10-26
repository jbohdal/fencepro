/**
 * Customer-facing portal — hash-routed, loaded on its own (main.tsx) so a
 * customer's browser never loads the office's code.
 *
 * Routes:
 *   /#/portal/activate?token=…   — set initial password
 *   /#/portal/login              — email/password login
 *   /#/portal/dashboard          — overview
 *   /#/portal/quotes             — list of quotes
 *   /#/portal/change-orders      — change orders: approve and sign the sent ones
 *   /#/portal/projects           — list of jobs (status and install date)
 *   /#/portal/invoices           — billing: payment schedule, invoices, payments, receipts, balance
 *   /#/portal/papers             — the signed contract and the warranty certificate
 *   /#/portal/documents          — file list + upload
 *   /#/portal/photos             — photo grid
 *   /#/portal/messages           — two-way messaging
 *   /#/portal/account            — settings
 *
 * Every page reads from the server (/api/portal/*, scoped on the server to the
 * signed in customer). What the server sends a customer is an explicit list
 * (lib/portalCustomer.ts): their photos, their site plan, billing, the signed
 * contract and warranty certificate, their quotes, change orders, documents
 * and messages; never a pull sheet, material list, cost, internal note,
 * internal or crew photo, crew packet, follow up or call log. The sign in is an httpOnly cookie the page never sees;
 * nothing is kept in the browser (portalApiClient.ts).
 * The portal has its own visual language (white/accent, top nav, no FencePro branding).
 */

import { styleLabel } from './fenceCatalog'
import { publicDoorUrl } from './publicDoor'
import { formatPhone } from './phoneFormat'
import { useEffect, useRef, useState } from 'react'
import { SignaturePad } from './SignaturePad'
import {
  fetchMe, login, verifyAndActivate, logout, resendPortalInvite, changePassword, fetchCompany,
  listPortalQuotes, listPortalProjects, listPortalInvoices, listPortalBilling, fetchPortalPapers, portalApiHref, listPortalChangeOrders, signPortalChangeOrder,
  listPortalDocuments, uploadPortalDocument, listPortalPhotos, uploadPortalPhoto, listPortalMedia,
  listPortalMessages, sendPortalMessage, fileHref, PORTAL_SIGNED_OUT_EVENT, listPortalServiceRequests, uploadServiceRequestPhoto,
  type PortalUser as PortalAccount, type PortalCompany, type PortalQuote, type PortalProject, type PortalInvoice, type PortalBilling, type PortalPapers,
  type PortalChangeOrder, type PortalFileRow, type PortalPhotoRow, type PortalMediaRow, type PortalMessage, type PortalServiceRequest,
} from './portalApiClient'

/** "Monday, Nov 2, 2026" for a YYYY-MM-DD install date (as typed otherwise). */
/** The install line's words: a repair is "Repair scheduled for", a move "Fence move starts", a new fence "Install starts". */
function workWords(kind: PortalProject['kind']): { starts: string; date: string } {
  if (kind === 'repair') return { starts: 'Repair scheduled for', date: 'Repair date' }
  if (kind === 'move') return { starts: 'Fence move starts', date: 'Fence move date' }
  return { starts: 'Install starts', date: 'Install date' }
}

function installDayWords(day: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day || '')
  if (!m) return day
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })
}

const DEFAULT_COMPANY: PortalCompany = { name: 'Getter Done Fence', phone: '', email: '', portal: { accentColor: '', supportEmail: '', supportPhone: '', welcomeMessage: '' } }

/** The company's name, phone and portal color, from the server. */
function useCompany(): PortalCompany {
  const [c, setC] = useState<PortalCompany>(DEFAULT_COMPANY)
  useEffect(() => { fetchCompany().then(r => { if (r) setC(r) }) }, [])
  return c
}

/** One server list for a page: null while loading, 'error' when it could not load. */
function useServerList<T>(load: () => Promise<T[] | null>, deps: unknown[] = []): [T[] | null | 'error', () => void] {
  const [rows, setRows] = useState<T[] | null | 'error'>(null)
  const reload = () => { load().then(r => setRows(r ?? 'error')) }
  useEffect(reload, deps)
  return [rows, reload]
}

/** The portal on its own page (main.tsx): follows the address's #/portal/<page>. */
export function PortalRoot() {
  const routeOf = () => (window.location.hash.match(/^#\/portal\/([a-zA-Z-]+)/)?.[1] ?? 'login')
  const [route, setRoute] = useState(routeOf)
  useEffect(() => {
    const on = () => {
      // Left the portal for the office's app: load it fresh (it is a different program).
      if (!window.location.hash.startsWith('#/portal/')) { window.location.reload(); return }
      setRoute(routeOf())
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return <CustomerPortalApp route={route} />
}

/** What the customer sees, by the job's status (not the office's stage names, which Jonathan can rename). */
function friendlyStage(stage?: string): string {
  if (!stage) return ''
  const map: Record<string, string> = {
    staging: 'Project in Setup',
    scheduled: 'Installation Scheduled',
    in_progress: 'Installation in Progress',
    completed: 'Installation Complete',
    invoiced: 'Invoice Sent',
    paid: 'Complete · Paid',
    on_hold: 'On Hold',
  }
  return map[stage] || stage
}

function parseHashQuery(): Record<string, string> {
  const q = window.location.hash.split('?')[1] || ''
  const out: Record<string, string> = {}
  for (const pair of q.split('&')) {
    const [k, v] = pair.split('=')
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || '')
  }
  return out
}

export default function CustomerPortalApp({ route }: { route: string }) {
  // Who is signed in: asked of the server (the cookie). undefined: still asking.
  const [session, setSession] = useState<PortalAccount | null | undefined>(undefined)
  const [offline, setOffline] = useState(false)
  const company = useCompany()
  const accent = company.portal?.accentColor || '#f97316'

  const refresh = () => fetchMe().then(me => {
    if (me === 'offline') { setOffline(true); setSession(s => s ?? null); return }
    setOffline(false); setSession(me)
  })
  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    const onOut = () => setSession(null)
    window.addEventListener(PORTAL_SIGNED_OUT_EVENT, onOut)
    return () => window.removeEventListener(PORTAL_SIGNED_OUT_EVENT, onOut)
  }, [])

  // Activation page — public
  if (route.startsWith('activate')) {
    return <ActivatePage company={company} accent={accent} onActivated={() => { void refresh().then(() => { window.location.hash = '#/portal/dashboard' }) }} />
  }

  if (session === undefined) {
    return <div className="min-h-screen bg-gray-50 flex items-center justify-center text-sm text-gray-500" data-portal-loading>Loading…</div>
  }

  // Login page — public
  if (route.startsWith('login') || !session) {
    return <LoginPage company={company} accent={accent} offline={offline} onSignedIn={() => { void refresh().then(() => { window.location.hash = '#/portal/dashboard' }) }} />
  }

  const customer = session.customer

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{ ['--accent' as any]: accent }}>
      <TopNav session={session} company={company} accent={accent} onSignedOut={() => setSession(null)} />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {route.startsWith('dashboard') && <DashboardPage session={session} customer={customer} accent={accent} company={company} />}
        {route.startsWith('quotes') && <QuotesPage session={session} customer={customer} accent={accent} />}
        {route.startsWith('change-orders') && <ChangeOrdersPage session={session} accent={accent} />}
        {route.startsWith('projects') && <ProjectsPage session={session} customer={customer} accent={accent} />}
        {route.startsWith('invoices') && <InvoicesPage session={session} customer={customer} accent={accent} />}
        {route.startsWith('papers') && <PapersPage accent={accent} />}
        {route.startsWith('documents') && <DocumentsPage session={session} customer={customer} accent={accent} />}
        {route.startsWith('photos') && <PhotosPage session={session} customer={customer} accent={accent} company={company} />}
        {route.startsWith('service') && <ServiceRequestsPage accent={accent} company={company} />}
        {route.startsWith('messages') && <MessagesPage session={session} customer={customer} accent={accent} />}
        {route.startsWith('account') && <AccountPage session={session} customer={customer} accent={accent} />}
      </main>
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-gray-500 flex flex-wrap gap-4 justify-between">
          <span>© {new Date().getFullYear()} {company.name || 'Getter Done Fence'}</span>
          <span>
            {company.portal?.supportEmail && <a href={`mailto:${company.portal.supportEmail}`} className="hover:underline">{company.portal.supportEmail}</a>}
            {company.portal?.supportPhone && <span className="ml-3">{formatPhone(company.portal.supportPhone)}</span>}
            {(!company.portal?.supportEmail && !company.portal?.supportPhone) && company.phone && <span>{formatPhone(company.phone)}</span>}
          </span>
        </div>
      </footer>
    </div>
  )
}

// ─────── Top navigation ───────

function TopNav({ session, company, accent, onSignedOut }: { session: PortalAccount; company: PortalCompany; accent: string; onSignedOut: () => void }) {
  const [open, setOpen] = useState(false)
  const nav = [
    ['dashboard', 'Dashboard'],
    ['quotes', 'My Quotes'],
    ['change-orders', 'Change Orders'],
    ['projects', 'My Projects'],
    ['invoices', 'Billing'],
    ['papers', 'Contract & Warranty'],
    ['documents', 'Documents'],
    ['photos', 'Photos'],
    ['service', 'Service Requests'],
    ['messages', 'Messages'],
    ['account', 'Account'],
  ] as const

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-6">
        <a href="#/portal/dashboard" className="flex items-center gap-2 shrink-0">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold" style={{ backgroundColor: accent }}>
            {(company.name || 'F')[0]}
          </div>
          <div className="hidden sm:block">
            <p className="font-bold text-gray-900 text-sm leading-tight">{company.name || 'Customer Portal'}</p>
            <p className="text-[10px] text-gray-400">Customer Portal</p>
          </div>
        </a>
        <nav className="hidden lg:flex gap-1 flex-1">
          {nav.map(([key, label]) => {
            const active = window.location.hash.startsWith(`#/portal/${key}`)
            return (
              <a key={key} href={`#/portal/${key}`}
                className={`text-sm px-3 py-2 rounded-lg font-medium transition-colors ${active ? 'text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
                style={active ? { backgroundColor: `${accent}14`, color: accent } : {}}>
                {label}
              </a>
            )
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-gray-500">{session.firstName} {session.lastName}</span>
          <button onClick={() => { void logout().then(() => { onSignedOut(); window.location.hash = '#/portal/login' }) }} data-portal-signout
            className="text-xs text-gray-500 hover:text-gray-900">Sign out</button>
          <button className="lg:hidden text-gray-600" onClick={() => setOpen(o => !o)}>☰</button>
        </div>
      </div>
      {open && (
        <div className="lg:hidden border-t border-gray-100 bg-white">
          <nav className="max-w-6xl mx-auto px-4 py-2 grid grid-cols-2 gap-1">
            {nav.map(([key, label]) => (
              <a key={key} href={`#/portal/${key}`} onClick={() => setOpen(false)}
                className="text-sm px-3 py-2 rounded-lg text-gray-700 hover:bg-gray-100">{label}</a>
            ))}
          </nav>
        </div>
      )}
    </header>
  )
}

// ─────── Login / Activation ───────

function LoginPage({ company, accent, offline, onSignedIn }: { company: PortalCompany; accent: string; offline: boolean; onSignedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPasswordValue] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [showForgot, setShowForgot] = useState(false)

  const [busy, setBusy] = useState(false)
  const [needsActivation, setNeedsActivation] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setBusy(true); setNeedsActivation(false)
    const r = await login(email, password)
    setBusy(false)
    if (!r.ok) {
      const code = r.error || 'INVALID_CREDENTIALS'
      if (code === 'ACCOUNT_NOT_ACTIVATED') {
        setNeedsActivation(true)
        setErr('Your account has not been activated yet. Check your email for the activation link or click Resend below.')
        return
      }
      if (code === 'ACCOUNT_SUSPENDED') {
        setErr('This account has been suspended. Please contact us for help.'); return
      }
      if (code === 'NETWORK') { setErr('Could not reach us. Check your connection and try again.'); return }
      setErr('Invalid email or password. Please try again or contact us for help.')
      return
    }
    onSignedIn()
  }

  async function handleResendInvite() {
    if (!email) { setErr('Enter your email first.'); return }
    try {
      const r = await resendPortalInvite(email)
      if (r.ok && (r.status === 'not_configured' || r.status === 'failed')) setErr(r.message || 'Not sent. Please call or text us for a new link.')
      else if (r.ok) setErr('If an account exists for that email, a fresh activation link has been sent.')
      else if (r.error === 'RATE_LIMITED') setErr('Too many resend requests — please wait an hour and try again.')
      else setErr('Could not resend activation email — please contact us.')
    } catch { setErr('Could not resend. Please contact us.') }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" style={{ ['--accent' as any]: accent }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-white text-2xl font-bold mb-3" style={{ backgroundColor: accent }}>
            {(company.name || 'F')[0]}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{company.name || 'Customer Portal'}</h1>
          <p className="text-sm text-gray-500 mt-1">Customer Portal Sign-In</p>
          {company.portal?.welcomeMessage && (
            <p className="text-xs text-gray-500 mt-2">{company.portal.welcomeMessage}</p>
          )}
        </div>
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <div>
            <label className="text-xs text-gray-500 font-semibold mb-1 block">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{ ['--tw-ring-color' as any]: accent }} />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold mb-1 block">Password</label>
            <input type="password" value={password} onChange={e => setPasswordValue(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{ ['--tw-ring-color' as any]: accent }} />
          </div>
          {offline && !err && <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Could not reach us just now. Check your connection.</p>}
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2" data-portal-login-error>{err}</p>}
          <button type="submit" disabled={busy}
            className="w-full text-white font-semibold py-2.5 rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: accent }}>{busy ? 'Signing in…' : 'Sign In'}</button>
          {needsActivation && (
            <button type="button" onClick={handleResendInvite}
              className="w-full text-xs border border-orange-300 text-orange-700 rounded-lg py-2 hover:bg-orange-50">
              Resend Activation Email
            </button>
          )}
          <div className="text-center">
            <button type="button" onClick={() => setShowForgot(true)} className="text-xs text-gray-500 hover:underline">Forgot password?</button>
          </div>
        </form>
        {showForgot && (
          <div className="mt-4 text-xs text-gray-600 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-center">
            Please contact {company.name || 'your contractor'} at {company.portal?.supportEmail || company.email || (company.portal?.supportPhone || company.phone ? formatPhone(company.portal?.supportPhone || company.phone) : '') || 'the number on your last invoice'} to reset your password.
          </div>
        )}
        <p className="text-[10px] text-gray-400 text-center mt-4">
          Accounts are created by {company.name || 'your contractor'} — no public registration.
        </p>
      </div>
    </div>
  )
}

function ActivatePage({ company, accent, onActivated }: { company: PortalCompany; accent: string; onActivated: () => void }) {
  const qs = parseHashQuery()
  const token = qs.token || ''
  const [password, setPasswordValue] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [resent, setResent] = useState(false)

  const tokenLooksValid = /^[0-9a-f]{64}$/.test(token)
  const invalidFormatNote = !tokenLooksValid
    ? 'This activation link appears to be corrupted. Please click the link directly from your email or contact us.'
    : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErr(null); setBusy(true)
    if (password !== confirm) { setErr('Passwords do not match. Please try again.'); setBusy(false); return }
    if (password.length < 8) { setErr('Your password must be at least 8 characters.'); setBusy(false); return }
    const r = await verifyAndActivate(token, password, confirm)
    setBusy(false)
    if (!r.ok) {
      const code = r.error || 'ACTIVATION_FAILED'
      const friendly: Record<string, string> = {
        INVALID_TOKEN_FORMAT: 'This activation link appears to be corrupted. Please click the link directly from your email or contact us.',
        INVALID_TOKEN: 'This activation link is not valid. It may have already been used. Please contact us for a new link.',
        EXPIRED_TOKEN: 'This activation link has expired. Please contact us and we will send you a new one.',
        PASSWORD_TOO_SHORT: 'Your password must be at least 8 characters.',
        PASSWORDS_DO_NOT_MATCH: 'Passwords do not match. Please try again.',
        NETWORK: 'Could not reach us. Check your connection and try again.',
      }
      setErr(friendly[code] || 'Activation failed — please contact us for a new link.')
      return
    }
    onActivated()
  }

  async function requestResend() {
    if (resent) return
    try {
      // We don't know the email at this point, so ask the backend to resend
      // by prompting the user to type their email. Keep UX simple with a prompt.
      const email = prompt('Enter your email to get a fresh activation link:')
      if (!email) return
      const r = await resendPortalInvite(email.trim())
      if (r.ok && (r.status === 'not_configured' || r.status === 'failed')) setErr(r.message || 'Not sent. Please contact us directly for a new link.')
      else if (r.ok) { setResent(true); setErr('If an account exists for that email, a fresh link has been sent.') }
      else if (r.error === 'RATE_LIMITED') setErr('Too many resend requests — please wait an hour and try again.')
      else setErr('Could not send a new link — please contact us directly.')
    } catch {
      setErr('Could not reach the server — please contact us directly.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" style={{ ['--accent' as any]: accent }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center text-white text-2xl font-bold mb-3" style={{ backgroundColor: accent }}>
            {(company.name || 'F')[0]}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Welcome to your portal</h1>
          <p className="text-sm text-gray-500 mt-1">Set a password and you're in.</p>
        </div>
        {invalidFormatNote ? (
          <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-3 mb-4">{invalidFormatNote}</p>
            <button type="button" onClick={requestResend}
              className="w-full text-white font-semibold py-2.5 rounded-lg hover:opacity-90" style={{ backgroundColor: accent }}>
              Send me a new link
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4 shadow-sm">
          <div>
            <label className="text-xs text-gray-500 font-semibold mb-1 block">Password</label>
            <input type="password" minLength={8} value={password} onChange={e => setPasswordValue(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2" />
            <p className="text-[10px] text-gray-400 mt-1">At least 8 characters.</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold mb-1 block">Confirm Password</label>
            <input type="password" minLength={8} value={confirm} onChange={e => setConfirm(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2" />
          </div>
          {err && (
            <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-2">
              <p>{err}</p>
              <button type="button" onClick={requestResend}
                className="text-red-700 font-medium underline hover:no-underline">
                Send me a new activation link
              </button>
            </div>
          )}
          <button type="submit" disabled={busy}
            className="w-full text-white font-semibold py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: accent }}>
            {busy ? 'Activating…' : 'Set Password and Access Portal'}
          </button>
        </form>
        )}
      </div>
    </div>
  )
}

// ─────── Dashboard ───────

function DashboardPage({ session, customer, accent }: { session: PortalAccount; customer: PortalAccount['customer']; accent: string; company: PortalCompany }) {
  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'

  const [jobRows] = useServerList(listPortalProjects)
  const [quoteRows] = useServerList(listPortalQuotes)
  const [invoiceRows] = useServerList(listPortalInvoices)
  const [billingRows] = useServerList(listPortalBilling)
  const jobs = Array.isArray(jobRows) ? jobRows : []
  const quotes = Array.isArray(quoteRows) ? quoteRows : []
  const invoices = Array.isArray(invoiceRows) ? invoiceRows : []
  const billing = Array.isArray(billingRows) ? billingRows : []

  const activeJob = jobs.find(j => j.status !== 'completed' && j.status !== 'paid')
  const pendingQuotes = quotes.filter(q => q.status === 'SENT')
  const outstanding = invoices.reduce((s, i) => s + (i.balanceDueCents || 0), 0) + billing.reduce((s, b) => s + Math.max(0, b.balanceCents), 0)

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-3xl border border-gray-200 p-6 sm:p-8 shadow-sm">
        <p className="text-sm text-gray-500">{greeting},</p>
        <h1 className="text-3xl sm:text-4xl font-black text-gray-900 mt-1">{session.firstName || customer?.firstName || 'there'}</h1>
        {customer?.serviceAddress && <p className="text-sm text-gray-500 mt-1">📍 {customer.serviceAddress}</p>}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {activeJob && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs font-bold" style={{ color: accent }}>Active Project</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{activeJob.style || 'Project'}</p>
            <p className="text-sm text-gray-500 mt-1">{friendlyStage(activeJob.status)}</p>
            {activeJob.scheduledDate ? <p className="text-xs text-gray-500 mt-2" data-portal-install-date={activeJob.scheduledDate}>📅 {workWords(activeJob.kind).starts} {installDayWords(activeJob.scheduledDate)}</p>
              : (activeJob.status === 'staging' || activeJob.status === 'scheduled') && <p className="text-xs text-gray-500 mt-2" data-portal-install-date="">📅 {workWords(activeJob.kind).date}: to be set</p>}
            <a href="#/portal/projects" className="inline-block mt-3 text-sm font-medium" style={{ color: accent }}>View Project →</a>
          </div>
        )}
        {pendingQuotes.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs font-bold" style={{ color: accent }}>Quotes Awaiting Review</p>
            <p className="text-3xl font-black text-gray-900 mt-1">{pendingQuotes.length}</p>
            <p className="text-sm text-gray-500 mt-1">{pendingQuotes[0].style || ''} · {money(pendingQuotes[0].priceCents)}</p>
            <a href="#/portal/quotes" className="inline-block mt-3 text-sm font-medium" style={{ color: accent }}>Review and Accept →</a>
          </div>
        )}
        <ChangeOrdersToSign accent={accent} />
        <OpenServiceRequest accent={accent} />
        {outstanding > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs font-bold" style={{ color: accent }}>Balance Due</p>
            <p className="text-3xl font-black text-gray-900 mt-1">{money(outstanding)}</p>
            <a href="#/portal/invoices" className="inline-block mt-3 text-sm font-medium" style={{ color: accent }}>View Billing →</a>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickLink href="#/portal/quotes" label="My Quotes" icon="📋" accent={accent} />
        <QuickLink href="#/portal/invoices" label="Billing" icon="💳" accent={accent} />
        <QuickLink href="#/portal/documents" label="Upload Document" icon="📄" accent={accent} />
        <QuickLink href="#/portal/messages" label="Contact Us" icon="💬" accent={accent} />
      </div>
    </div>
  )
}

function QuickLink({ href, label, icon, accent }: { href: string; label: string; icon: string; accent: string }) {
  return (
    <a href={href} className="bg-white rounded-2xl border border-gray-200 p-4 text-center hover:shadow-md transition-all">
      <p className="text-2xl">{icon}</p>
      <p className="text-xs font-medium text-gray-700 mt-1">{label}</p>
    </a>
  )
}

// ─────── Quotes ───────

function QuotesPage({ accent }: { session: PortalAccount; customer: PortalAccount['customer']; accent: string }) {
  const [rows] = useServerList(listPortalQuotes)
  if (rows === null) return <p className="text-sm text-gray-500">Loading…</p>
  if (rows === 'error') return <EmptyState emoji="⚠️" title="Could not load your quotes" body="Check your connection and try again." />
  const quotes = rows
  return (
    <div className="space-y-5" data-portal-quotes>
      <h1 className="text-2xl font-bold text-gray-900">My Quotes</h1>
      {quotes.length === 0 ? (
        <EmptyState emoji="📋" title="No quotes yet" body="Quotes sent to you by our team will appear here." />
      ) : (
        <div className="space-y-3">
          {quotes.map(q => {
            const statusLabel = q.status === 'SOLD' ? 'Accepted' : q.status === 'SENT' ? 'Pending Review' : q.status === 'LOST' ? 'Closed' : q.status
            const statusBg = q.status === 'SOLD' ? 'bg-green-100 text-green-700' : q.status === 'SENT' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
            return (
              <div key={q.id} className="bg-white border border-gray-200 rounded-2xl p-5" data-portal-quote={q.id}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-gray-400">Quote #{q.id.slice(-6).toUpperCase()}</p>
                  <p className="font-semibold text-gray-900 truncate">{q.style}</p>
                  <p className="text-xs text-gray-500">{q.date}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xl font-bold text-gray-900">{money(q.priceCents)}</p>
                  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBg}`}>{statusLabel}</span>
                </div>
                <QuoteViewButton shareToken={q.shareToken} accent={accent} />
              </div>
              {q.hasPlan && (
                <details className="mt-3" data-portal-plan>
                  <summary className="text-sm font-semibold cursor-pointer" style={{ color: accent }}>See the site plan</summary>
                  <img src={portalApiHref(`site-plans/${encodeURIComponent(q.id)}.svg`)} alt={`Site plan for ${q.style}`} className="mt-2 w-full max-h-[70vh] object-contain bg-white border border-gray-100 rounded-xl" loading="lazy" data-portal-plan-img />
                </details>
              )}
              {q.hasContract && (
                <a href={portalApiHref(`contracts/${encodeURIComponent(q.id)}.pdf`)} target="_blank" rel="noreferrer" className="inline-block mt-3 text-sm font-semibold" style={{ color: accent }} data-portal-contract-link>Your signed contract (PDF)</a>
              )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The quote's own page, when the office made a link for it (the server says which, and that it still works). */
function QuoteViewButton({ shareToken, accent }: { shareToken: string | null; accent: string }) {
  // The quote's customer page under the public door (/p/<link>), like the proposal link the office sends.
  const url = shareToken ? publicDoorUrl(`/p/${shareToken}`) : null
  if (!url) return <span className="text-[10px] text-gray-400 px-3">not shared</span>
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="text-xs font-semibold text-white px-3 py-2 rounded-lg hover:opacity-90"
      style={{ backgroundColor: accent }}>
      View Quote
    </a>
  )
}

// ─────── Change orders (server: /api/portal/change-orders) ───────

const coMoney = (cents: number) => (cents < 0 ? '−' : '') + '$' + (Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const coDay = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

/** The dashboard's card: change orders waiting for the customer's signature. */
function ChangeOrdersToSign({ accent }: { accent: string }) {
  const [n, setN] = useState(0)
  useEffect(() => { listPortalChangeOrders().then(r => setN((r ?? []).filter(c => c.needsSignature ?? c.status === 'sent').length)) }, [])
  if (!n) return null
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm" data-portal-co-waiting>
      <p className="text-xs font-bold" style={{ color: accent }}>Change Orders to Sign</p>
      <p className="text-3xl font-black text-gray-900 mt-1">{n}</p>
      <a href="#/portal/change-orders" className="inline-block mt-3 text-sm font-medium" style={{ color: accent }}>Review and sign →</a>
    </div>
  )
}

function ChangeOrdersPage({ session, accent }: { session: PortalAccount; accent: string }) {
  const [rows, setRows] = useState<PortalChangeOrder[] | null | 'error'>(null)
  const load = () => listPortalChangeOrders().then(r => setRows(r ?? 'error'))
  useEffect(() => { void load() }, [])
  if (rows === null) return <p className="text-sm text-gray-500">Loading…</p>
  if (rows === 'error') return <EmptyState emoji="⚠️" title="Could not load your change orders" body="Check your connection and try again." />
  // To sign: sent, or approved verbally with the office and not signed by the customer yet.
  const toSign = (r: PortalChangeOrder) => r.needsSignature ?? r.status === 'sent'
  const open = rows.filter(toSign)
  const history = rows.filter(r => !toSign(r))
  const defaultName = `${session.firstName ?? ''} ${session.lastName ?? ''}`.trim()
  return (
    <div className="space-y-5" data-portal-change-orders>
      <h1 className="text-2xl font-bold text-gray-900">Change Orders</h1>
      {rows.length === 0 && <EmptyState emoji="📝" title="No change orders" body="If the work on your fence changes after you sign, the change will appear here for you to approve." />}
      {open.map(co => <ChangeOrderCard key={co.id} co={co} accent={accent} defaultName={defaultName} onSigned={() => void load()} />)}
      {history.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold text-gray-900">History</h2>
          {history.map(co => <ChangeOrderCard key={co.id} co={co} accent={accent} defaultName={defaultName} onSigned={() => void load()} />)}
        </section>
      )}
    </div>
  )
}

function ChangeOrderCard({ co, accent, defaultName, onSigned }: { co: PortalChangeOrder; accent: string; defaultName: string; onSigned: () => void }) {
  const [name, setName] = useState(defaultName)
  const [ink, setInk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function sign() {
    if (!name.trim()) { setError('Please type your name.'); return }
    if (!ink) { setError('Please sign in the box.'); return }
    setBusy(true); setError('')
    const r = await signPortalChangeOrder(co.id, name.trim(), ink)
    setBusy(false)
    if (!r.ok) { setError(r.error || 'Could not sign. Please try again.'); return }
    onSigned()
  }
  const toSign = co.needsSignature ?? co.status === 'sent'
  const verbal = co.status === 'approved' && toSign
  const badge = verbal ? ['Not signed by you yet', 'bg-orange-100 text-orange-700'] : co.status === 'approved' ? ['Approved', 'bg-green-100 text-green-700'] : co.status === 'void' ? ['Cancelled', 'bg-gray-100 text-gray-600'] : ['Waiting for your signature', 'bg-orange-100 text-orange-700']
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3 min-w-0" data-portal-co={co.id} data-portal-co-status={co.status}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-gray-400">Change order CO-{co.number}{co.contractRev && co.status === 'approved' ? ` · Contract rev ${co.contractRev}` : ''}{co.quote?.fenceStyle ? ` · ${styleLabel(co.quote.fenceStyle)}` : ''}</p>
          {co.reason && <p className="font-semibold text-gray-900 break-words">{co.reason}</p>}
        </div>
        <span className={`shrink-0 inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${badge[1]}`}>{badge[0]}</span>
      </div>
      <table className="w-full text-sm">
        <tbody>
          {co.lines.map(l => (
            <tr key={l.id} className="border-b border-gray-100">
              <td className="py-2 pr-3 text-gray-700 break-words">{l.description || 'Change'}</td>
              <td className="py-2 text-right font-semibold tabular-nums whitespace-nowrap">{coMoney(l.amountCents)}</td>
            </tr>
          ))}
          <tr>
            <td className="pt-2 pr-3 font-bold text-gray-900">{co.totalCents < 0 ? 'Total credit' : 'Total'}</td>
            <td className="pt-2 text-right text-lg font-black tabular-nums whitespace-nowrap" data-portal-co-total>{coMoney(co.totalCents)}</td>
          </tr>
        </tbody>
      </table>
      {co.contract ? (
        <table className="w-full text-sm" data-portal-co-contract><tbody>
          <tr><td className="py-1 pr-3 text-gray-700">Your contract {co.status === 'approved' ? 'before this change' : 'now'}</td><td className="py-1 text-right tabular-nums whitespace-nowrap">{money(co.contract.beforeCents)}</td></tr>
          <tr><td className="py-1 pr-3 text-gray-700">This change</td><td className="py-1 text-right tabular-nums whitespace-nowrap">{co.totalCents >= 0 ? '+' : ''}{coMoney(co.totalCents)}</td></tr>
          <tr><td className="pt-1 pr-3 font-bold text-gray-900">{co.status === 'approved' ? 'Your contract with this change' : 'New contract total'}</td><td className="pt-1 text-right font-black tabular-nums whitespace-nowrap" data-portal-co-new-contract>{money(co.contract.afterCents)}</td></tr>
        </tbody></table>
      ) : co.quote && <p className="text-xs text-gray-500">The original price was {coMoney(co.quote.priceCents)}. This change {co.totalCents < 0 ? 'takes off' : 'adds'} {coMoney(Math.abs(co.totalCents))}.</p>}
      {co.warrantyAfter && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900" data-portal-co-warranty>
          <p className="font-semibold">Your warranty changes{co.warrantyBefore?.name ? ` from ${co.warrantyBefore.name}` : ''} to {co.warrantyAfter.name}</p>
          <p className="text-xs mt-1 whitespace-pre-line">{co.warrantyAfter.text}</p>
        </div>
      )}
      {verbal && <p className="rounded-lg bg-orange-50 border border-orange-200 px-3 py-2 text-sm text-orange-900" data-portal-co-not-signed>Not signed by you yet. You approved this change with us{co.approvedAt ? ` on ${coDay(co.approvedAt)}` : ''}; please sign it below for your records.</p>}
      {co.status === 'approved' && !verbal && (
        <p className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-900" data-portal-co-signed>
          {co.signedBy && co.signedAt ? `Approved and signed by ${co.signedBy} on ${coDay(co.signedAt)}.` : co.approvedAt ? `Approved on ${coDay(co.approvedAt)}.` : 'Approved.'}
        </p>
      )}
      {co.status === 'void' && <p className="text-sm text-gray-600">This change order was cancelled and is not part of your contract.</p>}
      {toSign && co.status !== 'void' && (
        <div className="space-y-3 pt-1" data-portal-co-sign>
          <p className="text-sm font-semibold text-gray-900">{verbal ? 'Sign' : 'Approve and sign'}</p>
          <p className="text-xs text-gray-500">If this change looks right, type your name and sign with your finger. It is added to your contract.</p>
          <label className="block text-sm text-gray-700">Your name
            <input value={name} onChange={e => setName(e.target.value)} autoComplete="name" maxLength={200}
              className="mt-1 w-full h-12 border border-gray-300 rounded-lg px-3 text-base" data-portal-co-name />
          </label>
          <SignaturePad onChange={setInk} />
          {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
          <button type="button" onClick={sign} disabled={busy} className="w-full min-h-[52px] rounded-xl text-white font-bold disabled:opacity-60"
            style={{ backgroundColor: accent }} data-portal-co-approve>
            {busy ? 'Sending…' : verbal ? 'Sign' : 'Approve and sign'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─────── Projects ───────

function ProjectsPage({ accent }: { session: PortalAccount; customer: PortalAccount['customer']; accent: string }) {
  const [rows] = useServerList(listPortalProjects)
  if (rows === null) return <p className="text-sm text-gray-500">Loading…</p>
  if (rows === 'error') return <EmptyState emoji="⚠️" title="Could not load your projects" body="Check your connection and try again." />
  const jobs: PortalProject[] = rows

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">My Projects</h1>
      {jobs.length === 0 ? (
        <EmptyState emoji="🏗" title="No active projects" body="Your fence project will appear here once scheduled." />
      ) : jobs.map(j => {
        // Each step is done only when it really is: the steps before the install from what is recorded on the job.
        const milestones = projectSteps(j)
        return (
          <div key={j.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm" data-portal-project={j.id}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-bold text-gray-900 text-lg">{j.style || 'Project'}</p>
                <p className="text-xs text-gray-500">{j.address || ''}</p>
                <p className="text-sm mt-1 font-medium" style={{ color: accent }}>{friendlyStage(j.status)}</p>
              </div>
              {j.scheduledDate ? (
                <div className="text-right text-xs text-gray-500" data-portal-install-date={j.scheduledDate}>
                  <p>{workWords(j.kind).starts}</p>
                  <p className="font-bold text-gray-900">📅 {installDayWords(j.scheduledDate)}</p>
                </div>
              ) : (j.status === 'staging' || j.status === 'scheduled') && (
                <div className="text-right text-xs text-gray-500" data-portal-install-date="">
                  <p>{workWords(j.kind).date}</p>
                  <p className="font-bold text-gray-900">To be set</p>
                </div>
              )}
            </div>
            {/* Milestone timeline */}
            <ol className="relative border-l-2 border-gray-100 pl-6 space-y-3">
              {milestones.map(({ label: m, done, current }) => {
                return (
                  <li key={m} className="relative" data-portal-step={m} data-done={done ? 'yes' : 'no'}>
                    <span className="absolute -left-[29px] top-0.5 w-4 h-4 rounded-full border-2 border-white"
                      style={{ backgroundColor: done ? accent : current ? accent : '#e5e7eb', boxShadow: current ? `0 0 0 3px ${accent}40` : undefined }} />
                    <p className={`text-sm ${done ? 'text-gray-900' : current ? 'text-gray-900 font-bold' : 'text-gray-400'}`}>
                      {m}{done && ' ✓'}
                    </p>
                  </li>
                )
              })}
            </ol>
          </div>
        )
      })}
    </div>
  )
}

/** The project's steps, each done only when it is: the permit, 811 and materials as recorded, the rest by the job's status. */
function projectSteps(j: PortalProject): Array<{ label: string; done: boolean; current: boolean }> {
  const at = mapStatusToMilestone(j.status)
  const st = j.steps
  const before: Array<{ label: string; done: boolean }> = [
    { label: 'Quote Accepted', done: true },
    { label: 'Locates Marked (811)', done: st ? st.locates : at > 1 },
    ...(st?.permit === 'not_needed' ? [] : [{ label: 'Permit Approved', done: st ? st.permit === 'done' : at > 2 }]),
    { label: 'Materials Ordered', done: st ? st.materials : at > 3 },
  ]
  const after = [{ label: 'Installation Scheduled', done: at >= 4 && !!j.scheduledDate || at >= 5 }, { label: 'Installation Complete', done: at >= 6 }, { label: 'Invoice Sent', done: at >= 7 }, { label: 'Complete', done: at >= 8 }]
  const steps = [...before, ...after]
  // The current step: the first one not done.
  const cur = steps.findIndex(s => !s.done)
  return steps.map((s, i) => ({ ...s, current: i === cur }))
}

function mapStatusToMilestone(status: string | undefined): number {
  switch (status) {
    case 'staging': return 2
    case 'scheduled': return 4
    case 'in_progress': return 5
    case 'completed': return 6
    case 'invoiced': return 7
    case 'paid': return 8
    default: return 1
  }
}

// ─────── Billing: payment schedule, invoices, payments, receipts, balance ───────

function InvoicesPage({ accent }: { session: PortalAccount; customer: PortalAccount['customer']; accent: string }) {
  const [rows] = useServerList(listPortalBilling)
  const [oldRows] = useServerList(listPortalInvoices)
  if (rows === null || oldRows === null) return <p className="text-sm text-gray-500">Loading…</p>
  if (rows === 'error' || oldRows === 'error') return <EmptyState emoji="⚠️" title="Could not load your billing" body="Check your connection and try again." />
  const schedules: PortalBilling[] = rows
  const invoices: PortalInvoice[] = oldRows
  const outstanding = schedules.reduce((s, b) => s + Math.max(0, b.balanceCents), 0) + invoices.reduce((s, i) => s + (i.balanceDueCents || 0), 0)

  return (
    <div className="space-y-5" data-portal-billing>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <div className="text-right">
          <p className="text-xs text-gray-500 font-bold">Balance</p>
          <p className="text-2xl font-black" style={{ color: outstanding > 0 ? accent : '#10b981' }} data-portal-balance>{money(outstanding)}</p>
        </div>
      </div>
      {schedules.length === 0 && invoices.length === 0 && (
        <EmptyState emoji="🧾" title="No billing yet" body="Once you sign, your payment schedule, payments and receipts show here." />
      )}
      {schedules.map(b => (
        <section key={b.jobId} className="bg-white border border-gray-200 rounded-2xl p-5 space-y-4 min-w-0" data-portal-schedule={b.jobId}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs text-gray-400">Payment schedule</p>
              <p className="font-semibold text-gray-900 break-words">{b.style || 'Your fence'}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Balance</p>
              <p className="text-xl font-bold text-gray-900 tabular-nums">{money(b.balanceCents)}</p>
            </div>
          </div>
          <table className="w-full text-sm">
            <tbody>
              <tr><td className="py-1 text-gray-600">Contract as signed</td><td className="py-1 text-right tabular-nums">{money(b.signedCents)}</td></tr>
              {b.changeOrderCents !== 0 && <tr><td className="py-1 text-gray-600">Change orders</td><td className="py-1 text-right tabular-nums">{signedMoney(b.changeOrderCents)}</td></tr>}
              {b.otherChangesCents !== 0 && <tr><td className="py-1 text-gray-600">Other changes</td><td className="py-1 text-right tabular-nums">{signedMoney(b.otherChangesCents)}</td></tr>}
              <tr className="font-semibold"><td className="py-1">Contract total</td><td className="py-1 text-right tabular-nums">{money(b.contractCents)}</td></tr>
              <tr><td className="py-1 text-gray-600">Paid</td><td className="py-1 text-right tabular-nums">{money(b.paidCents)}</td></tr>
            </tbody>
          </table>
          <div>
            <h2 className="text-sm font-bold text-gray-700 mb-2">Invoices</h2>
            <div className="space-y-2">
              {b.invoices.map(i => {
                const status = i.balanceCents <= 0 ? 'Paid' : i.paidCents > 0 ? 'Part paid' : 'Due'
                const statusBg = status === 'Paid' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                return (
                  <div key={i.id} className="border border-gray-100 rounded-xl px-3 py-2 flex items-center gap-3" data-portal-invoice={i.id}>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 break-words">{i.label}{i.number ? ` (#${i.number})` : ''}</p>
                      {i.due && <p className="text-xs text-gray-500">{i.due}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-gray-900 tabular-nums">{money(i.amountCents)}</p>
                      <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBg}`}>{status}{status === 'Part paid' ? `: ${money(i.balanceCents)} left` : ''}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-700 mb-2">Payments</h2>
            {b.payments.length === 0 ? <p className="text-sm text-gray-500">No payments yet.</p> : (
              <div className="space-y-2">
                {b.payments.map(p => (
                  <div key={p.id} className="border border-gray-100 rounded-xl px-3 py-2 flex items-center gap-3 flex-wrap" data-portal-payment={p.id}>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{money(p.amountCents)} · {p.method}</p>
                      <p className="text-xs text-gray-500">{p.paidOnText}</p>
                    </div>
                    {p.receipt && (
                      <span className="flex gap-3 text-sm font-semibold shrink-0">
                        <a href={publicDoorUrl(p.receipt.link)} target="_blank" rel="noreferrer" style={{ color: accent }} data-portal-receipt={p.receipt.number}>Receipt {p.receipt.number}</a>
                        <a href={publicDoorUrl(p.receipt.pdf)} target="_blank" rel="noreferrer" style={{ color: accent }}>PDF</a>
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ))}
      {invoices.length > 0 && (
        <section className="space-y-2">
          {schedules.length > 0 && <h2 className="text-lg font-semibold text-gray-900">Other invoices</h2>}
          {invoices.map(i => {
            const status = i.balanceDueCents <= 0 ? 'Paid' : new Date(i.dueDate) < new Date() ? 'Overdue' : 'Due'
            const statusBg = status === 'Paid' ? 'bg-green-100 text-green-700' : status === 'Overdue' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
            return (
              <div key={i.id} className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-4" data-portal-invoice={i.id}>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">#{i.invoiceNumber || i.id.slice(-6).toUpperCase()}{i.title ? ` · ${i.title}` : ''}</p>
                  <p className="text-xs text-gray-500">Due {i.dueDate}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">{money(i.totalCents)}</p>
                  <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${statusBg}`}>{status}</span>
                </div>
              </div>
            )
          })}
        </section>
      )}
    </div>
  )
}

/** A change to the contract: +$450 or −$75. */
function signedMoney(cents: number): string {
  return (cents < 0 ? '−' : '+') + money(Math.abs(cents))
}

// ─────── The signed contract and the warranty certificate ───────

function PapersPage({ accent }: { accent: string }) {
  const [papers, setPapers] = useState<PortalPapers | null | 'error'>(null)
  useEffect(() => { fetchPortalPapers().then(p => setPapers(p ?? 'error')) }, [])
  if (papers === null) return <p className="text-sm text-gray-500">Loading…</p>
  if (papers === 'error') return <EmptyState emoji="⚠️" title="Could not load your contract" body="Check your connection and try again." />
  const day = (d: string) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '')
  const signed = papers.signed ?? []
  // A contract with its signed copy stored shows once, as signed (above).
  const contracts = papers.contracts.filter(c => !c.stored)
  return (
    <div className="space-y-5" data-portal-papers>
      <h1 className="text-2xl font-bold text-gray-900">Contract &amp; Warranty</h1>
      {signed.length === 0 && contracts.length === 0 && papers.certificates.length === 0 && (
        <EmptyState emoji="📄" title="Nothing here yet" body="Your signed contract shows here once you sign, and your warranty certificate once your fence is installed and walked through." />
      )}
      {/* The signed PDFs as they were signed (stored at signing): contracts and change orders. */}
      {signed.map(d => (
        <a key={d.id} href={fileHref(d.url)} target="_blank" rel="noreferrer" data-portal-signed-doc={d.id} data-portal-signed-kind={d.kind}
          className="bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:shadow-md transition-all">
          <span className="text-xl">✍️</span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 break-words">{d.kind === 'contract' ? 'Signed contract' : `Signed ${d.title.toLowerCase()}`}{d.detail ? `: ${d.detail}` : ''}</p>
            <p className="text-xs text-gray-500">Signed {d.signedOn} by {d.signedBy}</p>
          </div>
          <span className="text-xs font-semibold shrink-0" style={{ color: accent }}>PDF</span>
        </a>
      ))}
      {contracts.map(c => (
        <a key={c.quoteId} href={portalApiHref(c.url)} target="_blank" rel="noreferrer" data-portal-contract={c.quoteId}
          className="bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:shadow-md transition-all">
          <span className="text-xl">✍️</span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 break-words">Signed contract: {c.style}</p>
            <p className="text-xs text-gray-500">Signed {day(c.signedOn)}</p>
          </div>
          <span className="text-xs font-semibold shrink-0" style={{ color: accent }}>PDF</span>
        </a>
      ))}
      {papers.certificates.map(c => (
        <a key={c.jobId} href={portalApiHref(c.url)} target="_blank" rel="noreferrer" data-portal-certificate={c.jobId}
          className="bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:shadow-md transition-all">
          <span className="text-xl">🛡️</span>
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900 break-words">Warranty certificate: {c.style}</p>
            <p className="text-xs text-gray-500">Completed {day(c.completedOn)}</p>
          </div>
          <span className="text-xs font-semibold shrink-0" style={{ color: accent }}>PDF</span>
        </a>
      ))}
    </div>
  )
}

// ─────── Documents ───────

function DocumentsPage({ accent }: { session: PortalAccount; customer: PortalAccount['customer']; accent: string }) {
  const [files, setFiles] = useState<PortalFileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    const r = await listPortalDocuments()
    if (r) setFiles(r)
    else setError('Could not load your documents. Check your connection and try again.')
    setLoading(false)
  }

  useEffect(() => { reload() }, [])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null); setUploading(true)
    const r = await uploadPortalDocument(file, label.trim() || undefined)
    setUploading(false)
    if (!r.ok) {
      const code = r.error
      let msg = 'Upload failed. Please try again or contact us.'
      if (code === 'FILE_TOO_LARGE') msg = 'Document must be under 25MB.'
      else if (code === 'UNSUPPORTED_TYPE') msg = 'Allowed types: PDF, DOCX, PNG, JPG.'
      setError(msg); return
    }
    setLabel('')
    await reload()
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Documents</h1>
      <div className="bg-white border border-gray-200 rounded-2xl p-5">
        <p className="text-xs font-bold text-gray-500 mb-2">Upload a Document</p>
        <p className="text-xs text-gray-500 mb-3">HOA approvals, property surveys, or anything else you'd like to share with us. PDF / DOCX / PNG / JPG up to 25MB.</p>
        <div className="flex gap-2">
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (optional)"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <label className="text-white text-sm font-semibold px-4 py-2 rounded-lg cursor-pointer hover:opacity-90"
            style={{ backgroundColor: accent }}>
            {uploading ? 'Uploading…' : '+ Upload'}
            <input type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.txt"
              className="hidden" onChange={handleUpload} disabled={uploading} />
          </label>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-6">Loading…</p>
      ) : files.length === 0 ? (
        <EmptyState emoji="📄" title="No documents yet" body="Your contracts, permits, and other documents will appear here." />
      ) : (
        <div className="space-y-1">
          {files.map(f => (
            <a key={f.id} href={fileHref(f.fileUrl)} target="_blank" rel="noreferrer" data-portal-doc={f.id}
              className="bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:shadow-md transition-all">
              <span className="text-xl">📄</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{f.label ? `${f.label} — ` : ''}{f.name}</p>
                <p className="text-xs text-gray-500">{new Date(f.uploadedAt).toLocaleDateString()} · {f.fromYou ? 'You' : 'From us'}</p>
              </div>
              <span className="text-xs text-gray-400">{(f.size / 1024).toFixed(1)} KB</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────── Photos ───────

function PhotosPage({ accent, company }: { session: PortalAccount; customer: PortalAccount['customer']; accent: string; company: PortalCompany }) {
  const [photos, setPhotos] = useState<PortalPhotoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  async function reload() {
    setLoading(true)
    const list = await listPortalPhotos()
    if (list) setPhotos(list)
    else setError('Could not load your photos. Check your connection and try again.')
    setLoading(false)
  }

  useEffect(() => { reload() }, [])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return
    setUploading(true); setError(null)
    let okCount = 0
    let lastErr: string | null = null
    for (const f of files) {
      const r = await uploadPortalPhoto(f)
      if (r.ok) okCount++
      else lastErr = errorMessage(r.error)
    }
    setUploading(false)
    if (lastErr) setError(lastErr)
    if (okCount > 0) await reload()
  }

  function errorMessage(code?: string): string {
    if (!code) return 'Upload failed. Please try again.'
    if (code === 'FILE_TOO_LARGE') return 'Photo must be under 20MB.'
    if (code === 'UNSUPPORTED_TYPE') return 'Allowed types: JPEG, PNG, HEIC, WebP, GIF.'
    if (code === 'NO_FILE') return 'No file was selected.'
    return 'Upload failed. Please try again or contact us.'
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-2xl font-bold text-gray-900">Photos</h1>
        <label className="text-white text-sm font-semibold px-4 py-2 rounded-lg cursor-pointer hover:opacity-90"
          style={{ backgroundColor: accent }}>
          {uploading ? 'Uploading…' : '+ Upload Photo'}
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      <SharedMedia accent={accent} companyName={company.name} />
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
      ) : photos.length === 0 ? (
        <EmptyState emoji="📷" title="No photos yet" body="Tap Upload Photo above to share photos with us." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map((p, i) => (
            <button key={p.id} onClick={() => setLightboxIdx(i)} data-portal-photo={p.id}
              className="aspect-square bg-gray-100 rounded-xl overflow-hidden group">
              <img src={fileHref(p.fileUrl)} alt={p.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
            </button>
          ))}
        </div>
      )}
      {lightboxIdx !== null && photos[lightboxIdx] && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6" onClick={() => setLightboxIdx(null)}>
          <img src={fileHref(photos[lightboxIdx].fileUrl)} alt={photos[lightboxIdx].name}
            className="max-w-full max-h-full object-contain" />
          <button onClick={() => setLightboxIdx(null)} className="min-w-[48px] min-h-[48px] inline-grid place-items-center absolute top-4 right-4 text-white text-3xl">×</button>
        </div>
      )}
    </div>
  )
}

// ─────── Warranty and service requests ───────

function dayText(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}

/** The dashboard card: the customer's open request and where it is. */
function OpenServiceRequest({ accent }: { accent: string }) {
  const [rows] = useServerList(listPortalServiceRequests)
  const open = Array.isArray(rows) ? rows.filter(r => r.open) : []
  if (!open.length) return null
  const r = open[0]
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm" data-portal-service-card={r.id}>
      <p className="text-xs font-bold" style={{ color: accent }}>Your service request</p>
      <p className="text-lg font-bold text-gray-900 mt-1">{r.issue}</p>
      <p className="text-sm text-gray-600 mt-1">{r.status}{r.visitOn ? ` · visit ${dayText(r.visitOn)}` : ''}</p>
      <a href="#/portal/service" className="inline-block mt-3 text-sm font-medium" style={{ color: accent }}>{r.canAddPhotos ? 'See it or add photos →' : 'See it →'}</a>
    </div>
  )
}

/**
 * The customer's warranty and service requests: the issue, the status in
 * plain words, the visit day, the photos sent, and Add photos while it is
 * open. The covered or not covered decision only when the office shared it.
 */
function ServiceRequestsPage({ accent, company }: { accent: string; company: PortalCompany }) {
  const [rows, reload] = useServerList(listPortalServiceRequests)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<{ id: string; ok: boolean; text: string } | null>(null)

  async function add(r: PortalServiceRequest, e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length) return
    setBusy(r.id); setNote(null)
    let ok = 0, last = ''
    for (const f of files) {
      const out = await uploadServiceRequestPhoto(r.id, f)
      if (out.ok) ok++; else last = out.error || 'The upload failed.'
    }
    setBusy(null)
    setNote({ id: r.id, ok: !last, text: last ? `${ok ? `${ok} sent. ` : ''}${last}` : `${ok} sent. Thank you, we will take a look.` })
    reload()
  }

  return (
    <div className="space-y-5" data-portal-service>
      <h1 className="text-2xl font-bold text-gray-900">Service Requests</h1>
      {rows === null ? <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
        : rows === 'error' ? <p className="text-sm text-red-700">Could not load your requests. Check your connection and try again.</p>
        : rows.length === 0 ? <EmptyState emoji="🛠" title="No service requests" body={`Something wrong with your fence? Call us${company.phone ? ` at ${formatPhone(company.phone)}` : ''} or send us a message, and we will open one.`} />
        : rows.map(r => (
          <div key={r.id} className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm space-y-2" data-portal-service-request={r.id} data-open={r.open ? '1' : '0'}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-bold text-gray-900">{r.issue}</p>
                <p className="text-xs text-gray-500">Opened {dayText(r.madeOn)}</p>
              </div>
              <span className="text-xs font-bold px-2 py-1 rounded-full" style={{ backgroundColor: `${accent}14`, color: accent }} data-portal-service-status>{r.status}</span>
            </div>
            {r.visitOn && <p className="text-sm text-gray-700">Visit scheduled: {dayText(r.visitOn)}</p>}
            {r.decision && (
              <p className={`text-sm rounded-xl px-3 py-2 ${r.decision.covered ? 'bg-green-50 text-green-900' : 'bg-gray-100 text-gray-800'}`} data-portal-service-decision={r.decision.covered ? 'covered' : 'not_covered'}>
                {r.decision.covered ? 'Covered by your warranty: no charge.' : 'Not covered by the warranty.'}{r.decision.reason ? ` ${r.decision.reason}` : ''}
              </p>
            )}
            <p className="text-sm text-gray-600" data-portal-service-photos={r.photosSent}>{r.photosSent ? `${r.photosSent} photo${r.photosSent === 1 ? '' : 's'} or video${r.photosSent === 1 ? '' : 's'} sent` : 'No photos sent yet'}</p>
            {r.canAddPhotos && (
              <label className="inline-block text-white text-sm font-semibold px-4 py-3 rounded-lg cursor-pointer hover:opacity-90" style={{ backgroundColor: accent }} data-portal-service-add>
                {busy === r.id ? 'Sending…' : '+ Add photos or a short video'}
                <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={e => add(r, e)} disabled={busy === r.id} />
              </label>
            )}
            {note?.id === r.id && <p className={`text-sm ${note.ok ? 'text-green-700' : 'text-red-700'}`} role="status">{note.text}</p>}
          </div>
        ))}
    </div>
  )
}

// ─────── Messages ───────

function MessagesPage({ accent }: { session: PortalAccount; customer: PortalAccount['customer']; accent: string }) {
  const [messages, setMessages] = useState<PortalMessage[]>([])
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  async function reload() {
    const data = await listPortalMessages()
    if (data) { setMessages(data); setError(null) }
    else setError('Could not load your messages. Check your connection.')
    setLoading(false)
  }

  useEffect(() => {
    reload()
    const t = setInterval(reload, 30_000)
    return () => clearInterval(t)
  }, [])

  const requestId = useRef(crypto.randomUUID())
  const inFlight = useRef(false)

  async function send() {
    if (!draft.trim() || inFlight.current) return
    inFlight.current = true
    setSending(true)
    // One id per message typed: tapped twice, or sent again after an error, it is saved once.
    const r = await sendPortalMessage(draft.trim(), requestId.current)
    inFlight.current = false
    setSending(false)
    if (r.ok) { setDraft(''); requestId.current = crypto.randomUUID(); await reload() }
    else setError('Your message was not sent. Check your connection and tap Send again.')
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Messages</h1>
      <div className="bg-white border border-gray-200 rounded-2xl p-4 min-h-[320px] max-h-[60vh] overflow-y-auto space-y-2">
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-10">No messages yet — send one below.</p>
        ) : messages.map(m => (
          <div key={m.id} className={`flex ${m.senderType === 'customer' ? 'justify-end' : 'justify-start'}`} data-portal-message={m.id}>
            <div className={`max-w-[70%] rounded-2xl px-4 py-2 text-sm ${m.senderType === 'customer' ? 'text-white' : 'bg-gray-100 text-gray-900'}`}
              style={m.senderType === 'customer' ? { backgroundColor: accent } : {}}>
              <p className="whitespace-pre-wrap">{m.body}</p>
              <p className={`text-[10px] mt-0.5 ${m.senderType === 'customer' ? 'text-white/70' : 'text-gray-400'}`}>
                {new Date(m.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
        ))}
      </div>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      <div className="bg-white border border-gray-200 rounded-2xl p-3 flex gap-2">
        <textarea data-portal-message-draft value={draft} onChange={e => setDraft(e.target.value)} rows={2}
          placeholder="Type your message…"
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          className="flex-1 border-0 resize-none text-sm focus:outline-none focus:ring-0 placeholder:text-gray-400" />
        <button onClick={send} disabled={sending || !draft.trim()}
          className="text-white text-sm font-semibold px-4 py-2 rounded-lg h-fit self-center hover:opacity-90 disabled:opacity-50"
          style={{ backgroundColor: accent }}>{sending ? 'Sending…' : 'Send'}</button>
      </div>
    </div>
  )
}

// ─────── Account ───────

function AccountPage({ session, customer, accent }: { session: PortalAccount; customer: PortalAccount['customer']; accent: string }) {
  const [current, setCurrent] = useState('')
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function changePw(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (pw1 !== pw2) { setMsg('Passwords do not match'); return }
    if (pw1.length < 8) { setMsg('Password must be at least 8 characters'); return }
    setBusy(true)
    const r = await changePassword(current, pw1, pw2)
    setBusy(false)
    if (r.ok) { setMsg('Password updated. Any other device you were signed in on is signed out.'); setCurrent(''); setPw1(''); setPw2(''); return }
    setMsg(r.error === 'WRONG_PASSWORD' ? 'Your current password is not right.' : r.error === 'NETWORK' ? 'Could not reach us. Try again.' : 'Could not update your password. Please try again.')
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">My Account</h1>
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <p className="text-xs font-bold text-gray-500 mb-3">Your Info</p>
        <div className="space-y-1 text-sm">
          <p><span className="text-gray-500">Name:</span> {customer?.firstName ?? session.firstName} {customer?.lastName ?? session.lastName}</p>
          <p><span className="text-gray-500">Email:</span> {session.email}</p>
          <p><span className="text-gray-500">Phone:</span> {customer?.phone ? formatPhone(customer.phone) : '—'}</p>
          <p><span className="text-gray-500">Service Address:</span> {customer?.serviceAddress || '—'}</p>
        </div>
        <p className="text-xs text-gray-400 mt-3">To update your info, send us a message.</p>
      </div>
      <form onSubmit={changePw} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-3" data-portal-password>
        <p className="text-xs font-bold text-gray-500">Change Password</p>
        <input type="password" value={current} onChange={e => setCurrent(e.target.value)} placeholder="Current password" autoComplete="current-password" required
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <input type="password" value={pw1} onChange={e => setPw1(e.target.value)} placeholder="New password" autoComplete="new-password" required
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Confirm new password" autoComplete="new-password" required
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        {msg && <p className="text-xs text-gray-600" role="status">{msg}</p>}
        <button type="submit" disabled={busy} className="text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: accent }}>
          {busy ? 'Saving…' : 'Update Password'}
        </button>
      </form>
    </div>
  )
}

// ─────── Utilities ───────

function EmptyState({ emoji, title, body }: { emoji: string; title: string; body: string }) {
  return (
    <div className="text-center py-16 bg-white border border-dashed border-gray-200 rounded-2xl">
      <p className="text-5xl mb-2">{emoji}</p>
      <p className="text-gray-700 font-medium">{title}</p>
      <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">{body}</p>
    </div>
  )
}

/** Whole cents as dollars ($1,234.50). */
function money(cents: number): string {
  return '$' + ((cents || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })
}

/** Photos and video from the company, with their captions (only items marked Customer). */
function SharedMedia({ accent, companyName }: { accent: string; companyName: string }) {
  const [items, setItems] = useState<PortalMediaRow[]>([])
  useEffect(() => { listPortalMedia().then(r => setItems(r ?? [])) }, [])
  if (items.length === 0) return null
  return (
    <section className="space-y-3" data-portal-media>
      <h2 className="text-lg font-semibold text-gray-900">From {companyName || 'Getter Done Fence'}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {items.map(m => (
          <figure key={m.id} className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            {m.kind === 'video'
              ? <video src={m.previewUrl ?? m.originalUrl} poster={m.thumbUrl ?? undefined} controls playsInline className="w-full max-h-80 bg-black" />
              : <a href={m.url} target="_blank" rel="noreferrer"><img src={m.url} alt={m.caption || m.category} className="w-full max-h-80 object-cover" loading="lazy" /></a>}
            <figcaption className="p-3 text-sm text-gray-700">
              <span className="block text-xs font-semibold" style={{ color: accent }}>{m.category}</span>
              {m.caption}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}
