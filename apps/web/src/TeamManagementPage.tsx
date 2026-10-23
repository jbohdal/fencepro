/**
 * Team Management — Admin Panel
 *
 * Invite team members, manage roles, view sessions, activity log.
 */

import { formatPhone } from './phoneFormat'
import { useState, useEffect, useCallback } from 'react'
import { authFetch } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { useBackLayer } from './nav'
import ConfirmByTyping from './ConfirmByTyping'
import { plainText } from './plainError'
import { inviteStepsText, INVITE_STEP_1_LINES } from '../../portal/src/server/lib/inviteSteps'

const AUTH_API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '') + '/api/crm-auth'

async function api<T = any>(path: string, opts?: RequestInit): Promise<T> {
  return authFetch<T>(`${AUTH_API}${path}`, opts)
}

interface TeamUser {
  id: string; email: string; firstName: string; lastName: string
  phone?: string; role: string; status: string; avatarUrl?: string
  lastLoginAt?: string; createdAt: string
}

interface Session {
  id: string; userId: string; ipAddress?: string; userAgent?: string
  createdAt: string; expiresAt: string
  /** null: the old app token; 'cookie': signed in by cookie; 'readonly': the Mac's read only checker. */
  kind?: string | null; lastUsedAt?: string | null; readOnly?: boolean; label?: string | null
  /** When it ends if not used again (cookie: 30 days after last use, 90 at most). */
  endsAt?: string; current?: boolean
  user: { firstName: string; lastName: string; email: string }
}

const when = (d?: string | null) => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''

const ROLES = [
  { value: 'admin', label: 'Admin', desc: 'Full access to all features', color: 'bg-red-100 text-red-700' },
  { value: 'manager', label: 'Manager', desc: 'Everything except the team, system tools and deleting (archives instead)', color: 'bg-purple-100 text-purple-700' },
  { value: 'sales_rep', label: 'Salesman', desc: 'Leads, customers, quotes and proposals, notes, appointments, moving pipeline cards, photos. No settings, prices, team or deleting. Archives customers and cards.', color: 'bg-blue-100 text-blue-700' },
  { value: 'field_crew', label: 'Field Crew', desc: 'Jobs, photos, notes, walkthroughs, checklists. No quotes, settings, prices or deleting.', color: 'bg-green-100 text-green-700' },
  { value: 'office_staff', label: 'Office Staff', desc: 'Customers, quotes, jobs, schedule, billing, vendors, stock. No settings, prices, team, or deleting customers, quotes or jobs (archives them instead).', color: 'bg-orange-100 text-orange-700' },
]

const STATUS_BADGES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  invited: 'bg-yellow-100 text-yellow-700',
  suspended: 'bg-red-100 text-red-700',
  deactivated: 'bg-gray-100 text-gray-500',
}

type Tab = 'team' | 'sessions' | 'activity'

/** What is typed to delete a login: the full name (the email when the login has no name). */
const loginName = (u: TeamUser) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.replace(/\s+/g, ' ').trim() || u.email

export default function TeamManagementPage() {
  const [tab, setTab] = useState<Tab>('team')
  const [users, setUsers] = useState<TeamUser[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [editingUser, setEditingUser] = useState<TeamUser | null>(null)
  // Deleting a login asks for its full name to be typed (ConfirmByTyping), as deleting a customer does.
  const [deletingUser, setDeletingUser] = useState<TeamUser | null>(null)
  // The link from the last invite resent, to copy and text when the email is slow.
  const [resent, setResent] = useState<InviteOutcome | null>(null)

  const loadUsers = useCallback(() => {
    setLoading(true)
    api('/users').then(setUsers).catch(console.error).finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  useEffect(() => {
    if (tab === 'sessions') api('/sessions').then(setSessions).catch(console.error)
    if (tab === 'activity') api('/activity').then(setActivity).catch(console.error)
  }, [tab])

  async function revokeSession(id: string) {
    try {
      await api(`/sessions/${id}`, { method: 'DELETE' })
      setSessions(s => s.filter(x => x.id !== id))
    } catch (err) { alert(plainText(err)) }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Management</h1>
          <p className="text-sm text-gray-500 mt-1">Invite members, manage roles, and monitor access.</p>
        </div>
        <button onClick={() => setShowInvite(true)}
          className="btn btn-primary self-start lg:self-auto">
          + Invite Team Member
        </button>
      </div>

      {resent && <InviteLink invite={resent} onDone={() => setResent(null)} />}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit overflow-x-auto">
        {([['team', 'Team Members'], ['sessions', 'Active Sessions'], ['activity', 'Activity Log']] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Team Members */}
      {tab === 'team' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {loading ? <p className="text-gray-400 text-center py-12">Loading...</p> : users.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 font-medium">No team members yet</p>
              <p className="text-sm text-gray-400 mt-1">Invite your first team member to get started.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {users.map(user => (
                <div key={user.id} className="px-4 lg:px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 hover:bg-gray-50 transition group">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-orange-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
                      {user.firstName.charAt(0)}{user.lastName.charAt(0)}
                    </div>
                    <div>
                      <p className="font-medium text-gray-900">{user.firstName} {user.lastName}</p>
                      <p className="text-xs text-gray-500">{user.email}{user.phone ? ` · ${formatPhone(user.phone)}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 lg:gap-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLES.find(r => r.value === user.role)?.color || 'bg-gray-100 text-gray-700'}`}>
                      {user.role === 'super_admin' ? 'Super Admin' : ROLES.find(r => r.value === user.role)?.label || user.role}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGES[user.status] || 'bg-gray-100 text-gray-500'}`}>
                      {user.status}
                    </span>
                    {user.lastLoginAt && (
                      <span className="text-xs text-gray-400 hidden lg:inline">
                        Last login: {new Date(user.lastLoginAt).toLocaleDateString()}
                      </span>
                    )}
                    <div className="flex gap-1 lg:opacity-0 lg:group-hover:opacity-100 transition">
                      <button onClick={() => setEditingUser(user)} className="text-xs text-blue-600 hover:text-blue-800 px-2 py-1">Edit</button>
                      {user.status === 'invited' && (
                        <button onClick={async () => {
                          try {
                            const d = await api<InviteAnswer>(`/invite/${user.id}/resend`, { method: 'POST' })
                            if (d?.inviteUrl) setResent(outcomeOf(d, user.email))
                          } catch (err: any) { alert(plainText(err)) }
                          loadUsers()
                        }} className="text-xs text-orange-600 hover:text-orange-800 px-2 py-1" data-resend-invite>Resend</button>
                      )}
                      {user.role !== 'super_admin' && (
                        <button onClick={() => setDeletingUser(user)} className="text-xs text-red-500 hover:text-red-700 px-2 py-1" data-delete-login={user.id}>Delete</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Active Sessions */}
      {tab === 'sessions' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {sessions.length === 0 ? (
            <p className="text-gray-400 text-center py-12 text-sm">No active sessions</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {sessions.map(s => (
                <div key={s.id} data-session-row={s.id} data-session-kind={s.kind ?? 'token'} className="px-4 lg:px-6 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {s.user.firstName} {s.user.lastName}
                      {s.current && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">This device</span>}
                      {s.kind === 'readonly' && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700" data-readonly-session>{s.label || 'Read only checker on the Mac'}</span>}
                      {!s.kind && <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-700">Old sign in (moves over on next open)</span>}
                    </p>
                    <p className="text-xs text-gray-500">{s.user.email} · {s.ipAddress || 'Unknown IP'}</p>
                    <p className="text-xs text-gray-400">{s.userAgent?.slice(0, 60) || 'Unknown device'}</p>
                  </div>
                  <div className="flex flex-col lg:items-end gap-1">
                    <span className="text-xs text-gray-500">Signed in {when(s.createdAt)}{s.lastUsedAt ? ` · last used ${when(s.lastUsedAt)}` : ''}</span>
                    <span className="text-xs text-gray-500" data-session-ends>{s.kind === 'readonly' ? 'Read only, ends' : 'Ends if not used by'} {when(s.endsAt ?? s.expiresAt)}</span>
                    <button onClick={() => revokeSession(s.id)} data-end-session={s.id} className="self-start lg:self-end text-xs text-red-600 hover:text-red-800 px-2 py-1 min-h-[36px] border border-red-200 rounded-lg hover:bg-red-50">{s.current ? 'Sign this device out' : 'End this sign in'}</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Activity Log */}
      {tab === 'activity' && (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {activity.length === 0 ? (
            <p className="text-gray-400 text-center py-12 text-sm">No activity yet</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {activity.map((a: any) => (
                <div key={a.id} className="px-4 lg:px-6 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                  <div>
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{a.user?.firstName} {a.user?.lastName}</span>
                      {' — '}
                      <span className="text-gray-600">{a.action.replace(/_/g, ' ')}</span>
                    </p>
                    {a.entityType && <p className="text-xs text-gray-400">{a.entityType} {a.entityId ? `#${a.entityId.slice(0, 8)}` : ''}</p>}
                  </div>
                  <span className="text-xs text-gray-400">{new Date(a.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Invite Modal */}
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onInvited={() => { setShowInvite(false); loadUsers() }} />}

      {/* Edit Modal */}
      {deletingUser && (
        <ConfirmByTyping title={`Delete ${loginName(deletingUser)}?`} name={loginName(deletingUser)}
          body="Their login and its sign-ins are removed. This cannot be undone."
          action="Delete login"
          onCancel={() => setDeletingUser(null)}
          onConfirm={async () => {
            const u = deletingUser
            setDeletingUser(null)
            try {
              await api(`/users/${u.id}`, { method: 'DELETE' })
            } catch (err: any) { alert(plainText(err)) }
            loadUsers()
          }} />
      )}
      {editingUser && <EditUserModal user={editingUser} onClose={() => setEditingUser(null)} onSaved={() => { setEditingUser(null); loadUsers() }} />}
    </div>
  )
}

// ── The invite link, to copy and text ──

/** The server's answer to an invite or a resend: the link, and whether a mail server took the email. */
interface InviteAnswer { email: string; inviteUrl?: string; emailSent?: boolean; emailNotSetUp?: boolean; emailError?: string }
interface InviteOutcome { email: string; url: string; emailSent: boolean; notSent?: string }

function outcomeOf(d: InviteAnswer, email: string): InviteOutcome {
  const sent = d.emailSent === true
  return { email: d.email || email, url: d.inviteUrl || '', emailSent: sent, ...(sent ? {} : { notSent: d.emailNotSetUp ? 'email is not set up' : (d.emailError || 'the email did not go') }) }
}

function InviteLink({ invite, onDone }: { invite: InviteOutcome; onDone: () => void }) {
  const { email, url } = invite
  const [copied, setCopied] = useState(false)
  // The whole text to send: the Tailscale steps first (without Tailscale the link says "This site can't be reached"), then the link.
  const message = inviteStepsText(url, 72)
  async function copy() {
    try { await navigator.clipboard.writeText(message); setCopied(true) } catch { setCopied(false) }
  }
  return (
    <div className="bg-green-50 border border-green-200 rounded-xl p-4 space-y-2" data-invite-link data-invite-email-sent={invite.emailSent ? 'yes' : 'no'}>
      {invite.emailSent ? <>
        <p className="text-sm text-green-900 font-medium">Invite emailed to {email}.</p>
        <p className="text-xs text-green-900">If the email does not show up, copy this and text it. Tailscale must be on before the link opens.</p>
      </> : <>
        <p className="text-sm text-amber-800 font-medium" data-invite-not-sent>Not sent: {invite.notSent}. Nothing went to {email}.</p>
        <p className="text-xs text-green-900">Copy this and text it (or email it yourself). Tailscale must be on before the link opens.</p>
      </>}
      <div className="text-xs text-green-950 bg-white border border-green-200 rounded-lg px-3 py-2 space-y-1 break-words" data-invite-steps>
        {INVITE_STEP_1_LINES.map((l, i) => <p key={i} className={i === 0 ? 'font-semibold' : ''}>{l}</p>)}
        <p className="font-semibold pt-1">Step 2: Open this link, choose a password (8 characters or more), and you are signed in. It works for 72 hours, once:</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <input readOnly value={url} onFocus={e => e.currentTarget.select()} className="flex-1 min-w-[12rem] border border-green-200 rounded-lg px-3 py-2 text-xs bg-white" data-invite-url />
        <button type="button" onClick={copy} className="btn btn-secondary btn-sm shrink-0" data-invite-copy>{copied ? 'Copied' : 'Copy steps and link'}</button>
        <button type="button" onClick={onDone} className="btn btn-quiet btn-sm shrink-0">Done</button>
      </div>
    </div>
  )
}

// ── Invite Modal ──

function InviteModal({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  useBackLayer(onClose, { key: 'invite-modal' })
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('office_staff')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState<InviteOutcome | null>(null)

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      const d = await api<InviteAnswer>('/invite', { method: 'POST', body: JSON.stringify({ firstName, lastName, email, phone: phone || undefined, role }) })
      if (d?.inviteUrl) setSent(outcomeOf(d, email))
      else onInvited()
    } catch (err: any) { setError(plainText(err)) }
    setSaving(false)
  }

  if (sent) return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] p-6 mx-4 space-y-4 modal-responsive">
        <h2 className="font-bold text-gray-900 text-lg">{sent.emailSent ? 'Invite sent' : 'Login made, invite not emailed'}</h2>
        <InviteLink invite={sent} onDone={onInvited} />
      </div>
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form onSubmit={handleInvite} className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto p-6 mx-4 space-y-4 modal-responsive">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900 text-lg">Invite Team Member</h2>
          <button type="button" onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">First Name *</label>
            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Last Name *</label>
            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 outline-none" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Email *</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 outline-none" placeholder="team@company.com" />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Phone (optional)</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-400 outline-none" placeholder="352-555-0100" />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-2">Role *</label>
          <div className="space-y-2">
            {ROLES.map(r => (
              <label key={r.value} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition ${role === r.value ? 'border-orange-400 bg-orange-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <input type="radio" name="role" value={r.value} checked={role === r.value} onChange={() => setRole(r.value)}
                  className="accent-orange-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900">{r.label}</p>
                  <p className="text-xs text-gray-500">{r.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
          <button type="submit" disabled={saving || !firstName || !lastName || !email}
            className="btn btn-primary flex-1 disabled:opacity-40">
            {saving ? 'Sending invite...' : 'Send Invite'}
          </button>
        </div>

        <p className="text-xs text-gray-400 text-center">When email is set up, an email goes with the Tailscale steps and a link to set their password; the same steps and link are shown here to copy either way. Invite expires in 72 hours.</p>
      </form>
    </div>
  )
}

// ── Edit User Modal ──

function EditUserModal({ user, onClose, onSaved }: { user: TeamUser; onClose: () => void; onSaved: () => void }) {
  useBackLayer(onClose, { key: 'edit-user-modal' })
  const [firstName, setFirstName] = useState(user.firstName)
  const [lastName, setLastName] = useState(user.lastName)
  const [phone, setPhone] = useState(user.phone || '')
  const [role, setRole] = useState(user.role)
  const [status, setStatus] = useState(user.status)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await api(`/users/${user.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ firstName, lastName, phone: phone || undefined, role, status }),
      })
      onSaved()
    } catch (err: any) { setError(plainText(err)) }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto p-6 mx-4 space-y-4 modal-responsive">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900 text-lg">Edit {user.firstName} {user.lastName}</h2>
          <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl">×</button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">First Name</label>
            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Last Name</label>
            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Email</label>
          <input type="email" value={user.email} readOnly className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500" />
          <p className="text-xs text-gray-400 mt-0.5">Email cannot be changed — re-invite to change email</p>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Phone</label>
          <input type="tel" value={phone} onChange={e => setPhone(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Role</label>
          <select value={role} onChange={e => setRole(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" disabled={user.role === 'super_admin'}>
            {user.role === 'super_admin' && <option value="super_admin">Super Admin</option>}
            {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Status</label>
          <select value={status} onChange={e => setStatus(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="deactivated">Deactivated</option>
          </select>
          {status === 'suspended' && <p className="text-xs text-yellow-600 mt-0.5">User can log in but cannot take actions</p>}
          {status === 'deactivated' && <p className="text-xs text-red-600 mt-0.5">User cannot log in — all data preserved</p>}
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="btn btn-primary flex-1 disabled:opacity-40">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
