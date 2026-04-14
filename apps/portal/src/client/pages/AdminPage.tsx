import { useState, useEffect } from 'react'
import { api } from '../lib/api'

interface AccountWithCustomers {
  id: string
  name: string
  status: string
  customers: {
    id: string
    email: string
    firstName: string
    lastName: string
    role: string
    portalEnabled: boolean
    lastLoginAt: string | null
  }[]
}

interface AuditEntry {
  id: string
  action: string
  metadata: Record<string, unknown>
  ipAddress: string | null
  createdAt: string
  customer: { email: string; firstName: string; lastName: string } | null
}

export default function AdminPage() {
  const [tab, setTab] = useState<'accounts' | 'audit'>('accounts')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {(['accounts', 'audit'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium capitalize transition-colors ${
              tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'accounts' ? 'Accounts & Users' : 'Audit Logs'}
          </button>
        ))}
      </div>

      {tab === 'accounts' && <AccountsTab />}
      {tab === 'audit' && <AuditTab />}
    </div>
  )
}

function AccountsTab() {
  const [accounts, setAccounts] = useState<AccountWithCustomers[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<AccountWithCustomers[]>('/admin/accounts').then(setAccounts).catch(() => {}).finally(() => setLoading(false))
  }, [])

  async function togglePortal(customerId: string, enabled: boolean) {
    try {
      await api.patch(`/admin/customers/${customerId}/portal`, { enabled })
      setAccounts(prev => prev.map(a => ({
        ...a,
        customers: a.customers.map(c => c.id === customerId ? { ...c, portalEnabled: enabled } : c),
      })))
    } catch {}
  }

  if (loading) return <div className="text-center py-16 text-gray-400">Loading accounts...</div>

  return (
    <div className="space-y-4">
      {accounts.map(acc => (
        <div key={acc.id} className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-semibold text-gray-900">{acc.name}</h3>
              <span className="text-xs text-gray-400 capitalize">{acc.status}</span>
            </div>
            <span className="text-xs text-gray-400">{acc.customers.length} users</span>
          </div>
          {acc.customers.length > 0 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left pb-2">User</th>
                  <th className="text-left pb-2 w-24">Role</th>
                  <th className="text-left pb-2 w-28">Last Login</th>
                  <th className="text-center pb-2 w-24">Portal</th>
                </tr>
              </thead>
              <tbody>
                {acc.customers.map(c => (
                  <tr key={c.id} className="border-b border-gray-50">
                    <td className="py-2">
                      <p className="font-medium text-gray-900">{c.firstName} {c.lastName}</p>
                      <p className="text-xs text-gray-400">{c.email}</p>
                    </td>
                    <td className="py-2 text-xs text-gray-500 capitalize">{c.role.replace('_', ' ')}</td>
                    <td className="py-2 text-xs text-gray-400">
                      {c.lastLoginAt ? new Date(c.lastLoginAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="py-2 text-center">
                      <button onClick={() => togglePortal(c.id, !c.portalEnabled)}
                        className={`text-xs px-3 py-1 rounded-full font-semibold ${
                          c.portalEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                        {c.portalEnabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  )
}

function AuditTab() {
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get<{ items: AuditEntry[] }>('/admin/audit-logs').then(d => setLogs(d.items)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-center py-16 text-gray-400">Loading audit logs...</div>

  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">Time</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase">User</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase">Action</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase">IP</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {logs.map(log => (
            <tr key={log.id} className="hover:bg-gray-50">
              <td className="px-5 py-2.5 text-xs text-gray-500 whitespace-nowrap">{new Date(log.createdAt).toLocaleString()}</td>
              <td className="px-3 py-2.5 text-xs text-gray-700">
                {log.customer ? `${log.customer.firstName} ${log.customer.lastName}` : '—'}
              </td>
              <td className="px-3 py-2.5">
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">{log.action}</span>
              </td>
              <td className="px-3 py-2.5 text-xs text-gray-400 font-mono">{log.ipAddress || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
