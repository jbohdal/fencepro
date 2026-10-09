/**
 * Admin → Audit Log page.
 *
 * Calls /api/admin/audit-log with filters and renders a sortable table.
 * Each row is expandable to show old/new value diffs. CSV export hits
 * /api/admin/audit-log.csv with the same filters.
 */

import { useEffect, useMemo, useState } from 'react'
import { getAccessToken, fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'

const API_BASE = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '')

interface AuditRow {
  id: string
  userId: string | null
  userEmail: string | null
  action: string
  entityType: string
  entityId: string | null
  oldValues: any
  newValues: any
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
}

const ENTITY_TYPES = ['', 'CrmContact', 'CrmUser', 'PortalAccount', 'Customer', 'Invoice', 'Quote', 'Job', 'Settings']
const ACTIONS = ['', 'create', 'update', 'delete', 'soft_delete', 'restore', 'login', 'logout', 'invite_sent', 'invite_resent', 'invite_accepted', 'role_changed', 'settings_changed', 'file_uploaded', 'file_deleted', 'stage_changed']

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [user, setUser] = useState('')
  const [entityType, setEntityType] = useState('')
  const [action, setAction] = useState('')
  const [since, setSince] = useState('')
  const [until, setUntil] = useState('')
  const [offset, setOffset] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const limit = 100

  const queryString = useMemo(() => {
    const p = new URLSearchParams()
    if (user) p.set('user', user)
    if (entityType) p.set('entityType', entityType)
    if (action) p.set('action', action)
    if (since) p.set('since', new Date(since).toISOString())
    if (until) p.set('until', new Date(until).toISOString())
    p.set('limit', String(limit))
    p.set('offset', String(offset))
    return p.toString()
  }, [user, entityType, action, since, until, offset])

  async function load() {
    const token = getAccessToken()
    if (!token) { setError('Not authenticated'); return }
    setLoading(true); setError(null)
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/admin/audit-log?${queryString}`)
      if (res.status === 403) { setError('Admin access required'); return }
      const json = await res.json()
      if (!json.success) { setError(json.error || 'Failed to load'); return }
      setRows(json.data.rows)
      setTotal(json.data.total)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [queryString])

  function exportCsv() {
    const token = getAccessToken()
    if (!token) return
    // Open in new tab — server returns the CSV with Content-Disposition
    const a = document.createElement('a')
    a.href = `${API_BASE}/api/admin/audit-log.csv?${queryString}`
    // We need to send the auth header — easiest is fetch + blob
    fetch(a.href, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
        link.click()
        URL.revokeObjectURL(url)
      })
  }

  function fmt(d: string) {
    return new Date(d).toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'medium' })
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Audit Log</h1>
          <p className="text-xs text-gray-500">{total.toLocaleString()} entries · every important data change is logged here</p>
        </div>
        <button onClick={exportCsv} className="text-xs px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 self-start lg:self-auto">Export CSV</button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 mb-3 grid grid-cols-2 md:grid-cols-5 gap-2">
        <input value={user} onChange={e => { setUser(e.target.value); setOffset(0) }}
          placeholder="User (email or id)" className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <select value={entityType} onChange={e => { setEntityType(e.target.value); setOffset(0) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t || 'All entity types'}</option>)}
        </select>
        <select value={action} onChange={e => { setAction(e.target.value); setOffset(0) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm">
          {ACTIONS.map(a => <option key={a} value={a}>{a || 'All actions'}</option>)}
        </select>
        <input type="date" value={since} onChange={e => { setSince(e.target.value); setOffset(0) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
        <input type="date" value={until} onChange={e => { setUntil(e.target.value); setOffset(0) }}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm" />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm mb-3">{error}</div>}

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden flex-1 overflow-y-auto">
        <table className="w-full text-sm table-responsive-cards">
          <thead className="bg-gray-50 border-b border-gray-200 sticky top-0">
            <tr>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase w-44">When</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">User</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Action</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">Entity</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">ID</th>
              <th className="text-left px-3 py-2 text-xs font-semibold text-gray-500 uppercase">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(r => (
              <>
                <tr key={r.id} onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                  className="hover:bg-gray-50 cursor-pointer">
                  <td data-label="When" className="px-3 py-2 text-xs text-gray-600">{fmt(r.createdAt)}</td>
                  <td data-label="User" className="px-3 py-2 text-xs">{r.userEmail || r.userId || '—'}</td>
                  <td data-label="Action" className="px-3 py-2"><span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">{r.action}</span></td>
                  <td data-label="Entity" className="px-3 py-2 text-xs text-gray-700">{r.entityType}</td>
                  <td data-label="ID" className="px-3 py-2 text-xs font-mono text-gray-500">{r.entityId?.slice(0, 8) || '—'}</td>
                  <td data-label="IP" className="px-3 py-2 text-xs text-gray-400">{r.ipAddress || '—'}</td>
                </tr>
                {expandedId === r.id && (
                  <tr key={r.id + '-exp'}>
                    <td data-label="" colSpan={6} className="px-3 py-3 bg-gray-50">
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <div>
                          <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">Before</p>
                          <pre className="text-xs bg-white border border-gray-200 rounded-lg p-2 overflow-x-auto max-h-64">{r.oldValues ? JSON.stringify(r.oldValues, null, 2) : '—'}</pre>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">After</p>
                          <pre className="text-xs bg-white border border-gray-200 rounded-lg p-2 overflow-x-auto max-h-64">{r.newValues ? JSON.stringify(r.newValues, null, 2) : '—'}</pre>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-2">User-Agent: {r.userAgent || '—'}</p>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {!loading && rows.length === 0 && (
              <tr><td data-label="" colSpan={6} className="px-6 py-12 text-center text-gray-400 text-sm">No audit log entries match your filters.</td></tr>
            )}
            {loading && (
              <tr><td data-label="" colSpan={6} className="px-6 py-12 text-center text-gray-400 text-sm">Loading…</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
        <span>Showing {Math.min(offset + 1, total)}–{Math.min(offset + limit, total)} of {total.toLocaleString()}</span>
        <div className="flex gap-1.5">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - limit))}
            className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-50 hover:bg-gray-50">← Prev</button>
          <button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}
            className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-50 hover:bg-gray-50">Next →</button>
        </div>
      </div>
    </div>
  )
}
