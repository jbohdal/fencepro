/**
 * Team Management — Admin Panel
 *
 * Invite team members, manage roles, view sessions, activity log.
 */

import { useState, useEffect, useCallback } from 'react'
import { authFetch } from './crmAuth'

const AUTH_API = (window.location.hostname === 'localhost' ? 'http://localhost:4000' : '') + '/api/crm-auth'

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
  user: { firstName: string; lastName: string; email: string }
}

const ROLES = [
  { value: 'admin', label: 'Admin', desc: 'Full access to all features', color: 'bg-red-100 text-red-700' },
  { value: 'manager', label: 'Manager', desc: 'Operations, sales, scheduling, reports', color: 'bg-purple-100 text-purple-700' },
  { value: 'sales_rep', label: 'Sales Rep', desc: 'Own pipeline, contacts, quotes', color: 'bg-blue-100 text-blue-700' },
  { value: 'field_crew', label: 'Field Crew', desc: 'Assigned jobs and schedule', color: 'bg-green-100 text-green-700' },
  { value: 'office_staff', label: 'Office Staff', desc: 'Contacts, jobs, invoices, schedule', color: 'bg-orange-100 text-orange-700' },
]

const STATUS_BADGES: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  invited: 'bg-yellow-100 text-yellow-700',
  suspended: 'bg-red-100 text-red-700',
  deactivated: 'bg-gray-100 text-gray-500',
}

type Tab = 'team' | 'sessions' | 'activity'

export default function TeamManagementPage() {
  const [tab, setTab] = useState<Tab>('team')
  const [users, setUsers] = useState<TeamUser[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [activity, setActivity] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [showInvite, setShowInvite] = useState(false)
  const [editingUser, setEditingUser] = useState<TeamUser | null>(null)

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
    await api(`/sessions/${id}`, { method: 'DELETE' })
    setSessions(s => s.filter(x => x.id !== id))
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Management</h1>
          <p className="text-sm text-gray-500 mt-1">Invite members, manage roles, and monitor access.</p>
        </div>
        <button onClick={() => setShowInvite(true)}
          className="bg-orange-500 hover:bg-orange-600 text-white px-4 py-2 rounded-lg text-sm font-medium self-start lg:self-auto">
          + Invite Team Member
        </button>
      </div>

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
                      <p className="text-xs text-gray-500">{user.email}{user.phone ? ` · ${user.phone}` : ''}</p>
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
                          await api('/invite', { method: 'POST', body: JSON.stringify({ firstName: user.firstName, lastName: user.lastName, email: user.email, role: user.role }) }).catch(() => {})
                          loadUsers()
                        }} className="text-xs text-orange-600 hover:text-orange-800 px-2 py-1">Resend</button>
                      )}
                      {user.role !== 'super_admin' && (
                        <button onClick={async () => {
                          if (!confirm(`Delete ${user.firstName} ${user.lastName}? This cannot be undone.`)) return
                          try {
                            await api(`/users/${user.id}`, { method: 'DELETE' })
                            loadUsers()
                          } catch (err: any) { alert(err.message) }
                        }} className="text-xs text-red-500 hover:text-red-700 px-2 py-1">Delete</button>
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
                <div key={s.id} className="px-4 lg:px-6 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{s.user.firstName} {s.user.lastName}</p>
                    <p className="text-xs text-gray-500">{s.user.email} · {s.ipAddress || 'Unknown IP'}</p>
                    <p className="text-xs text-gray-400">{s.userAgent?.slice(0, 60) || 'Unknown device'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">{new Date(s.createdAt).toLocaleString()}</span>
                    <button onClick={() => revokeSession(s.id)} className="text-xs text-red-600 hover:text-red-800 px-2 py-1 border border-red-200 rounded-lg hover:bg-red-50">Revoke</button>
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
      {editingUser && <EditUserModal user={editingUser} onClose={() => setEditingUser(null)} onSaved={() => { setEditingUser(null); loadUsers() }} />}
    </div>
  )
}

// ── Invite Modal ──

function InviteModal({ onClose, onInvited }: { onClose: () => void; onInvited: () => void }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState('office_staff')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setError('')
    try {
      await api('/invite', { method: 'POST', body: JSON.stringify({ firstName, lastName, email, phone: phone || undefined, role }) })
      onInvited()
    } catch (err: any) { setError(err.message) }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <form onSubmit={handleInvite} className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto p-6 mx-4 space-y-4 modal-responsive">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900 text-lg">Invite Team Member</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
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
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-40">
            {saving ? 'Sending invite...' : 'Send Invite'}
          </button>
        </div>

        <p className="text-xs text-gray-400 text-center">An email will be sent with a link to set their password. Invite expires in 72 hours.</p>
      </form>
    </div>
  )
}

// ── Edit User Modal ──

function EditUserModal({ user, onClose, onSaved }: { user: TeamUser; onClose: () => void; onSaved: () => void }) {
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
    } catch (err: any) { setError(err.message) }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto p-6 mx-4 space-y-4 modal-responsive">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-gray-900 text-lg">Edit {user.firstName} {user.lastName}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
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
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2.5 rounded-xl disabled:opacity-40">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
