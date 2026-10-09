/**
 * Customer-facing portal — hash-routed inside the main web app.
 *
 * Routes:
 *   /#/portal/activate?token=…   — set initial password
 *   /#/portal/login              — email/password login
 *   /#/portal/dashboard          — overview
 *   /#/portal/quotes             — list of quotes
 *   /#/portal/projects           — list of jobs
 *   /#/portal/invoices           — invoices + balance
 *   /#/portal/documents          — file list + upload
 *   /#/portal/photos             — photo grid
 *   /#/portal/messages           — two-way messaging
 *   /#/portal/account            — settings
 *
 * All data is read from the shared localStorage stores — no separate API.
 * The portal has its own visual language (white/accent, top nav, no FencePro branding).
 */

import { useEffect, useMemo, useState } from 'react'
import {
  getCurrentSession, login, verifyAndActivate, setPassword, logout,
  type CurrentSession as PortalAccount,
} from './portalAccountStore'
import { getCustomerById } from './customerStore'
import { getQuotes } from './quoteStore'
import { getJobs } from './jobStore'
import { LOCAL_API_ORIGIN } from './apiOrigin'

function readCompanyInfo() {
  try {
    const r = localStorage.getItem('fencepro_config')
    if (!r) return { name: 'EZBiz', phone: '', email: '', address: '', portal: {} as any }
    const cfg = JSON.parse(r)
    return { ...cfg.company, portal: cfg.portal || {} }
  } catch { return { name: 'EZBiz', phone: '', email: '', address: '', portal: {} as any } }
}

function accentColor() {
  const info = readCompanyInfo()
  return info.portal?.accentColor || '#f97316'
}

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
    'Awaiting Locates': 'Locates Scheduled',
    'Permit Pending': 'Awaiting Permit',
    'Materials Ordered': 'Materials Ordered',
    'Scheduled': 'Installation Scheduled',
    'In Progress': 'Installation in Progress',
    'Punch List': 'Final Touches',
    'Complete': 'Complete',
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
  const [session, setSession] = useState<PortalAccount | null>(() => getCurrentSession())
  const company = readCompanyInfo()
  const accent = accentColor()

  useEffect(() => {
    const onUpdate = () => setSession(getCurrentSession())
    window.addEventListener('fencepro:portal:updated', onUpdate)
    return () => window.removeEventListener('fencepro:portal:updated', onUpdate)
  }, [])

  // Activation page — public
  if (route.startsWith('activate')) {
    return <ActivatePage company={company} accent={accent} onActivated={() => { window.location.hash = '#/portal/dashboard' }} />
  }

  // Login page — public
  if (route.startsWith('login') || !session) {
    return <LoginPage company={company} accent={accent} />
  }

  const customer = getCustomerById(session.customerId)

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col" style={{ ['--accent' as any]: accent }}>
      <TopNav session={session} company={company} accent={accent} />
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8">
        {route.startsWith('dashboard') && <DashboardPage session={session} customer={customer} accent={accent} company={company} />}
        {route.startsWith('quotes') && <QuotesPage session={session} customer={customer} accent={accent} />}
        {route.startsWith('projects') && <ProjectsPage session={session} customer={customer} accent={accent} />}
        {route.startsWith('invoices') && <InvoicesPage session={session} customer={customer} accent={accent} />}
        {route.startsWith('documents') && <DocumentsPage session={session} customer={customer} accent={accent} />}
        {route.startsWith('photos') && <PhotosPage session={session} customer={customer} accent={accent} />}
        {route.startsWith('messages') && <MessagesPage session={session} customer={customer} accent={accent} />}
        {route.startsWith('account') && <AccountPage session={session} customer={customer} accent={accent} />}
      </main>
      <footer className="border-t border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 text-xs text-gray-500 flex flex-wrap gap-4 justify-between">
          <span>© {new Date().getFullYear()} {company.name || 'EZBiz'}</span>
          <span>
            {company.portal?.supportEmail && <a href={`mailto:${company.portal.supportEmail}`} className="hover:underline">{company.portal.supportEmail}</a>}
            {company.portal?.supportPhone && <span className="ml-3">{company.portal.supportPhone}</span>}
            {(!company.portal?.supportEmail && !company.portal?.supportPhone) && company.phone && <span>{company.phone}</span>}
          </span>
        </div>
      </footer>
    </div>
  )
}

// ─────── Top navigation ───────

function TopNav({ session, company, accent }: { session: PortalAccount; company: any; accent: string }) {
  const [open, setOpen] = useState(false)
  const nav = [
    ['dashboard', 'Dashboard'],
    ['quotes', 'My Quotes'],
    ['projects', 'My Projects'],
    ['invoices', 'Invoices'],
    ['documents', 'Documents'],
    ['photos', 'Photos'],
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
          <button onClick={() => { logout(); window.location.hash = '#/portal/login' }}
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

function LoginPage({ company, accent }: { company: any; accent: string }) {
  const [email, setEmail] = useState(() => (getCurrentSession()?.email) || '')
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
      setErr('Invalid email or password. Please try again or contact us for help.')
      return
    }
    window.location.hash = '#/portal/dashboard'
  }

  async function handleResendInvite() {
    if (!email) { setErr('Enter your email first.'); return }
    try {
      const mod = await import('./portalAccountStore')
      const r = await mod.resendPortalInvite(email)
      if (r.ok) setErr('If an account exists for that email, a fresh activation link has been sent.')
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
            <label className="text-xs text-gray-500 font-semibold uppercase mb-1 block">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{ ['--tw-ring-color' as any]: accent }} />
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase mb-1 block">Password</label>
            <input type="password" value={password} onChange={e => setPasswordValue(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2"
              style={{ ['--tw-ring-color' as any]: accent }} />
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{err}</p>}
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
            Please contact {company.name || 'your contractor'} at {company.portal?.supportEmail || company.email || company.portal?.supportPhone || company.phone || 'the number on your last invoice'} to reset your password.
          </div>
        )}
        <p className="text-[10px] text-gray-400 text-center mt-4">
          Accounts are created by {company.name || 'your contractor'} — no public registration.
        </p>
      </div>
    </div>
  )
}

function ActivatePage({ company, accent, onActivated }: { company: any; accent: string; onActivated: () => void }) {
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
      }
      setErr(friendly[code] || 'Activation failed — please contact us for a new link.')
      return
    }
    onActivated()
  }

  async function requestResend() {
    if (resent) return
    try {
      const mod = await import('./portalAccountStore')
      // We don't know the email at this point, so ask the backend to resend
      // by prompting the user to type their email. Keep UX simple with a prompt.
      const email = prompt('Enter your email to get a fresh activation link:')
      if (!email) return
      const r = await mod.resendPortalInvite(email.trim())
      if (r.ok) { setResent(true); setErr('If an account exists for that email, a fresh link has been sent.') }
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
            <label className="text-xs text-gray-500 font-semibold uppercase mb-1 block">Password</label>
            <input type="password" minLength={8} value={password} onChange={e => setPasswordValue(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2" />
            <p className="text-[10px] text-gray-400 mt-1">At least 8 characters.</p>
          </div>
          <div>
            <label className="text-xs text-gray-500 font-semibold uppercase mb-1 block">Confirm Password</label>
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

function DashboardPage({ session, customer, accent, company }: { session: PortalAccount; customer: any; accent: string; company: any }) {
  const now = new Date()
  const greeting = now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'

  const jobs = useMemo(() => readJobsFor(session.customerId), [session.customerId])
  const quotes = useMemo(() => readQuotesFor(session.customerId), [session.customerId])
  const invoices = useMemo(() => readInvoicesFor(session.customerId), [session.customerId])
  const activity = useMemo(() => readActivityFor(session.customerId).slice(0, 5), [session.customerId])

  const activeJob = jobs.find(j => j.status !== 'completed' && j.status !== 'paid')
  const pendingQuotes = quotes.filter(q => q.status === 'SENT')
  const outstanding = invoices.reduce((s, i) => s + (i.balanceDueCents || 0), 0)

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
            <p className="text-xs uppercase tracking-widest font-bold" style={{ color: accent }}>Active Project</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{activeJob.fenceStyle || activeJob.type || 'Project'}</p>
            <p className="text-sm text-gray-500 mt-1">{friendlyStage(activeJob.status || activeJob.stage)}</p>
            {activeJob.scheduledDate && <p className="text-xs text-gray-500 mt-2">📅 Scheduled {activeJob.scheduledDate}</p>}
            {activeJob.crewAssigned && <p className="text-xs text-gray-500">👷 Crew: {activeJob.crewAssigned}</p>}
            <a href="#/portal/projects" className="inline-block mt-3 text-sm font-medium" style={{ color: accent }}>View Project →</a>
          </div>
        )}
        {pendingQuotes.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs uppercase tracking-widest font-bold" style={{ color: accent }}>Quotes Awaiting Review</p>
            <p className="text-3xl font-black text-gray-900 mt-1">{pendingQuotes.length}</p>
            <p className="text-sm text-gray-500 mt-1">{pendingQuotes[0].fenceStyle || ''} · ${pendingQuotes[0].finalPrice?.toLocaleString() || 0}</p>
            <a href="#/portal/quotes" className="inline-block mt-3 text-sm font-medium" style={{ color: accent }}>Review and Accept →</a>
          </div>
        )}
        {outstanding > 0 && (
          <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
            <p className="text-xs uppercase tracking-widest font-bold" style={{ color: accent }}>Balance Due</p>
            <p className="text-3xl font-black text-gray-900 mt-1">${(outstanding / 100).toLocaleString()}</p>
            <a href="#/portal/invoices" className="inline-block mt-3 text-sm font-medium" style={{ color: accent }}>View Invoices →</a>
          </div>
        )}
      </div>

      {activity.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5 shadow-sm">
          <p className="text-xs uppercase tracking-widest font-bold text-gray-500 mb-3">Recent Activity</p>
          <ul className="space-y-2">
            {activity.map(a => (
              <li key={a.id} className="text-sm text-gray-700 flex items-start gap-2">
                <span style={{ color: accent }}>●</span>
                <div className="flex-1">
                  <p>{a.body}</p>
                  <p className="text-[10px] text-gray-400">{new Date(a.at).toLocaleDateString()}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <QuickLink href="#/portal/quotes" label="My Quotes" icon="📋" accent={accent} />
        <QuickLink href="#/portal/invoices" label="Pay Invoice" icon="💳" accent={accent} />
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

function QuotesPage({ session, accent }: { session: PortalAccount; customer: any; accent: string }) {
  const quotes = readQuotesFor(session.customerId)
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">My Quotes</h1>
      {quotes.length === 0 ? (
        <EmptyState emoji="📋" title="No quotes yet" body="Quotes sent to you by our team will appear here." />
      ) : (
        <div className="space-y-3">
          {quotes.map((q: any) => {
            const statusLabel = q.status === 'SOLD' ? 'Accepted' : q.status === 'SENT' ? 'Pending Review' : q.status === 'LOST' ? 'Closed' : q.status
            const statusBg = q.status === 'SOLD' ? 'bg-green-100 text-green-700' : q.status === 'SENT' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
            return (
              <div key={q.id} className="bg-white border border-gray-200 rounded-2xl p-5 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-xs text-gray-400">Quote #{q.id?.slice(-6)?.toUpperCase()}</p>
                  <p className="font-semibold text-gray-900 truncate">{q.fenceStyle}</p>
                  <p className="text-xs text-gray-500">{q.date}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xl font-bold text-gray-900">${Math.round(q.finalPrice || 0).toLocaleString()}</p>
                  <span className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${statusBg}`}>{statusLabel}</span>
                </div>
                <QuoteViewButton quoteId={q.id} accent={accent} />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function QuoteViewButton({ quoteId, accent }: { quoteId: string; accent: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('fencepro_quote_shares')
      const shares = raw ? JSON.parse(raw) : []
      const share = shares.find((s: any) => s.quoteId === quoteId)
      if (share) setUrl(`${window.location.origin}/#/quote/${share.token}`)
    } catch {}
  }, [quoteId])
  if (!url) return <span className="text-[10px] text-gray-400 px-3">not shared</span>
  return (
    <a href={url} target="_blank" rel="noreferrer"
      className="text-xs font-semibold text-white px-3 py-2 rounded-lg hover:opacity-90"
      style={{ backgroundColor: accent }}>
      View Quote
    </a>
  )
}

// ─────── Projects ───────

function ProjectsPage({ session, accent }: { session: PortalAccount; customer: any; accent: string }) {
  const jobs = readJobsFor(session.customerId)
  const milestones = ['Quote Accepted', 'Locates Scheduled', 'Permit Approved', 'Materials Ordered', 'Installation Scheduled', 'Installation Complete', 'Invoice Sent', 'Complete']

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">My Projects</h1>
      {jobs.length === 0 ? (
        <EmptyState emoji="🏗" title="No active projects" body="Your fence project will appear here once scheduled." />
      ) : jobs.map((j: any) => {
        const currentIdx = mapStatusToMilestone(j.status)
        return (
          <div key={j.id} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="font-bold text-gray-900 text-lg">{j.fenceStyle || 'Project'}</p>
                <p className="text-xs text-gray-500">{j.customerAddress || ''}</p>
                <p className="text-sm mt-1 font-medium" style={{ color: accent }}>{friendlyStage(j.status)}</p>
              </div>
              {j.scheduledDate && (
                <div className="text-right text-xs text-gray-500">
                  <p className="font-bold text-gray-900">📅 {j.scheduledDate}</p>
                  {j.crewAssigned && <p>Crew: {j.crewAssigned}</p>}
                </div>
              )}
            </div>
            {/* Milestone timeline */}
            <ol className="relative border-l-2 border-gray-100 pl-6 space-y-3">
              {milestones.map((m, i) => {
                const done = i < currentIdx
                const current = i === currentIdx
                return (
                  <li key={m} className="relative">
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

// ─────── Invoices ───────

function InvoicesPage({ session, accent }: { session: PortalAccount; customer: any; accent: string }) {
  const invoices = readInvoicesFor(session.customerId)
  const outstanding = invoices.reduce((s, i) => s + (i.balanceDueCents || 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Invoices &amp; Payments</h1>
        <div className="text-right">
          <p className="text-xs text-gray-500 uppercase font-bold tracking-widest">Total Outstanding</p>
          <p className="text-2xl font-black" style={{ color: outstanding > 0 ? accent : '#10b981' }}>${(outstanding / 100).toLocaleString()}</p>
        </div>
      </div>
      {invoices.length === 0 ? (
        <EmptyState emoji="🧾" title="No invoices yet" body="Invoices will appear here once sent." />
      ) : (
        <div className="space-y-2">
          {invoices.map((i: any) => {
            const status = i.balanceDueCents <= 0 ? 'Paid' : new Date(i.dueDate) < new Date() ? 'Overdue' : 'Due'
            const statusBg = status === 'Paid' ? 'bg-green-100 text-green-700' : status === 'Overdue' ? 'bg-red-100 text-red-700' : 'bg-orange-100 text-orange-700'
            return (
              <div key={i.id} className="bg-white border border-gray-200 rounded-2xl p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">#{i.invoiceNumber || i.id?.slice(-6)?.toUpperCase()}</p>
                  <p className="text-xs text-gray-500">Due {i.dueDate}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-gray-900">${((i.totalCents || 0) / 100).toLocaleString()}</p>
                  <span className={`inline-block text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${statusBg}`}>{status}</span>
                </div>
                {i.balanceDueCents > 0 && (
                  <button className="text-xs text-white px-3 py-2 rounded-lg hover:opacity-90" style={{ backgroundColor: accent }}>Pay Now</button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─────── Documents ───────

function DocumentsPage({ accent }: { session: PortalAccount; customer: any; accent: string }) {
  const [files, setFiles] = useState<import('./portalApiClient').PortalFileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    const mod = await import('./portalApiClient')
    setFiles(await mod.listPortalDocuments())
    setLoading(false)
  }

  useEffect(() => { reload() }, [])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(null); setUploading(true)
    const mod = await import('./portalApiClient')
    const r = await mod.uploadPortalDocument(file, label.trim() || undefined)
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
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Upload a Document</p>
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
            <a key={f.id} href={resolveFileUrlSync(f.fileUrl)} target="_blank" rel="noreferrer"
              className="bg-white border border-gray-200 rounded-2xl px-4 py-3 flex items-center gap-3 hover:shadow-md transition-all">
              <span className="text-xl">📄</span>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 truncate">{f.label ? `${f.label} — ` : ''}{f.name}</p>
                <p className="text-xs text-gray-500">{new Date(f.uploadedAt).toLocaleDateString()} · {f.source === 'portal_customer' ? 'You' : (f.uploadedBy || 'company')}</p>
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

function PhotosPage({ accent }: { session: PortalAccount; customer: any; accent: string }) {
  const [photos, setPhotos] = useState<import('./portalApiClient').PortalPhotoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  async function reload() {
    setLoading(true)
    const mod = await import('./portalApiClient')
    const list = await mod.listPortalPhotos()
    setPhotos(list)
    setLoading(false)
  }

  useEffect(() => { reload() }, [])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return
    setUploading(true); setError(null)
    const mod = await import('./portalApiClient')
    let okCount = 0
    let lastErr: string | null = null
    for (const f of files) {
      const r = await mod.uploadPortalPhoto(f)
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
      {loading ? (
        <p className="text-sm text-gray-400 text-center py-10">Loading…</p>
      ) : photos.length === 0 ? (
        <EmptyState emoji="📷" title="No photos yet" body="Tap Upload Photo above to share photos with us." />
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {photos.map((p, i) => (
            <button key={p.id} onClick={() => setLightboxIdx(i)}
              className="aspect-square bg-gray-100 rounded-xl overflow-hidden group">
              <img src={resolveFileUrlSync(p.fileUrl)} alt={p.name}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
            </button>
          ))}
        </div>
      )}
      {lightboxIdx !== null && photos[lightboxIdx] && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6" onClick={() => setLightboxIdx(null)}>
          <img src={resolveFileUrlSync(photos[lightboxIdx].fileUrl)} alt={photos[lightboxIdx].name}
            className="max-w-full max-h-full object-contain" />
          <button onClick={() => setLightboxIdx(null)} className="absolute top-4 right-4 text-white text-3xl">×</button>
        </div>
      )}
    </div>
  )
}

function resolveFileUrlSync(fileUrl: string): string {
  if (!fileUrl) return ''
  if (/^https?:\/\//i.test(fileUrl)) return fileUrl
  const base = window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''
  return `${base}${fileUrl}`
}

// ─────── Messages ───────

function MessagesPage({ accent }: { session: PortalAccount; customer: any; accent: string }) {
  const [messages, setMessages] = useState<import('./portalApiClient').PortalMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  async function reload() {
    setLoading(true)
    const mod = await import('./portalApiClient')
    const data = await mod.listPortalMessages()
    setMessages(data.messages || [])
    setLoading(false)
  }

  useEffect(() => {
    reload()
    const t = setInterval(reload, 30_000)
    return () => clearInterval(t)
  }, [])

  async function send() {
    if (!draft.trim()) return
    setSending(true)
    const mod = await import('./portalApiClient')
    const r = await mod.sendPortalMessage(draft.trim())
    setSending(false)
    if (r.ok) { setDraft(''); await reload() }
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
          <div key={m.id} className={`flex ${m.senderType === 'customer' ? 'justify-end' : 'justify-start'}`}>
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
      <div className="bg-white border border-gray-200 rounded-2xl p-3 flex gap-2">
        <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={2}
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

function AccountPage({ session, customer, accent }: { session: PortalAccount; customer: any; accent: string }) {
  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<string | null>(null)

  function changePw(e: React.FormEvent) {
    e.preventDefault()
    setMsg(null)
    if (pw1 !== pw2) { setMsg('Passwords do not match'); return }
    if (pw1.length < 8) { setMsg('Password must be at least 8 characters'); return }
    const ok = setPassword(session.id, pw1)
    setMsg(ok ? 'Password updated.' : 'Could not update password.')
    setPw1(''); setPw2('')
  }

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">My Account</h1>
      <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Your Info</p>
        <div className="space-y-1 text-sm">
          <p><span className="text-gray-500">Name:</span> {customer?.firstName} {customer?.lastName}</p>
          <p><span className="text-gray-500">Email:</span> {session.email}</p>
          <p><span className="text-gray-500">Phone:</span> {customer?.phone || '—'}</p>
          <p><span className="text-gray-500">Service Address:</span> {customer?.serviceAddress || '—'}</p>
        </div>
        <p className="text-xs text-gray-400 mt-3">To update your info, send us a message.</p>
      </div>
      <form onSubmit={changePw} className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm space-y-3">
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Change Password</p>
        <input type="password" value={pw1} onChange={e => setPw1(e.target.value)} placeholder="New password"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        <input type="password" value={pw2} onChange={e => setPw2(e.target.value)} placeholder="Confirm new password"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        {msg && <p className="text-xs text-gray-600">{msg}</p>}
        <button type="submit" className="text-white text-sm font-semibold px-4 py-2 rounded-lg hover:opacity-90" style={{ backgroundColor: accent }}>
          Update Password
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

function readJobsFor(customerId: string): any[] {
  return getJobs().filter(j => j.customerId === customerId)
}

function readQuotesFor(customerId: string): any[] {
  return getQuotes()
    .filter(q => q.customerId === customerId)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

function readInvoicesFor(customerId: string): any[] {
  try {
    const r = localStorage.getItem('fencepro_invoices')
    const all: any[] = r ? JSON.parse(r) : []
    return all.filter((i: any) => i.customerId === customerId)
  } catch { return [] }
}

function readFilesFor(customerId: string): any[] {
  try {
    const r = localStorage.getItem('fencepro_files')
    const all: any[] = r ? JSON.parse(r) : []
    return all.filter((f: any) => f.customerId === customerId)
  } catch { return [] }
}

function readActivityFor(customerId: string): any[] {
  try {
    const r = localStorage.getItem('fencepro_customer_activity')
    const all: any[] = r ? JSON.parse(r) : []
    return all.filter((a: any) => a.customerId === customerId)
  } catch { return [] }
}
