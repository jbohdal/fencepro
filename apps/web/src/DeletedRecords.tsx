/**
 * Settings > Deleted Records (owner and admin).
 *
 * Every delete in the app writes one row to the server's deletion log with
 * what it took along (a customer's quotes, jobs, cards, ...). Newest first,
 * filter by type, and Restore puts back exactly what was captured: anything
 * changed since the deletion is skipped and named. Rows are never removed.
 * Reads GET /api/deleted-records; restores with POST /api/deleted-records/:id/restore.
 */

import { useEffect, useState } from 'react'
import { fetchWithAuth, getAccessToken } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { toast } from './toast'
import { refreshAfterRestore } from './recordArchive'

const API = window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : ''

interface Row {
  id: string
  entityType: string
  entityId: string
  entityLabel: string
  deletedAt: string
  deletedBy: string | null
  reason: string | null
  restoredAt: string | null
  restoredBy: string | null
  restoreResult: { restored: number; skipped: Array<{ what: string; why: string }> } | null
  counts: Record<string, number>
  children: string[]
}

export const TYPES: Array<{ key: string; label: string }> = [
  { key: '', label: 'All' },
  { key: 'customer', label: 'Customers' },
  { key: 'card', label: 'Pipeline cards' },
  { key: 'quote', label: 'Quotes' },
  { key: 'job', label: 'Jobs' },
  { key: 'login', label: 'Logins' },
  { key: 'inventory_item', label: 'Catalog items' },
  { key: 'vendor', label: 'Vendors' },
  { key: 'note', label: 'Notes' },
  { key: 'photo', label: 'Photos' },
  { key: 'schedule_entry', label: 'Schedule entries' },
  { key: 'rain_day', label: 'Rain days' },
]
const typeLabel = (k: string) => (TYPES.find(t => t.key === k)?.label ?? k).replace(/s$/, '')

const KIND: Record<string, [string, string]> = {
  savedQuote: ['quote', 'quotes'], savedJob: ['job', 'jobs'], appointment: ['appointment', 'appointments'],
  scheduledGridJob: ['schedule entry', 'schedule entries'], changeOrder: ['change order', 'change orders'],
  mediaItem: ['photo', 'photos'], crmContactNote: ['note', 'notes'], intakeLead: ['website or phone lead', 'website or phone leads'],
  'pipeline.leads': ['card', 'cards'], 'pipeline.archivedLeads': ['archived card', 'archived cards'],
  'business.invoices': ['invoice', 'invoices'], 'business.payments': ['payment', 'payments'],
  'business.pendingOrders': ['materials order', 'materials orders'], 'business.pullSheets': ['pull sheet', 'pull sheets'],
  'business.statements': ['statement', 'statements'], cardFollowUp: ['follow up', 'follow ups'], pendingTouch: ['pending call', 'pending calls'],
  'inventory.stockLevels': ['stock count', 'stock counts'],
}

/** "2 quotes, 1 job, 1 card" (the record itself is not counted). */
export function countsLine(counts: Record<string, number>, entityType: string): string {
  const self: Record<string, string> = { customer: 'crmContact', quote: 'savedQuote', job: 'savedJob', card: 'pipeline.leads', login: 'crmUser', inventory_item: 'inventory.items', vendor: 'vendors.vendors', note: 'crmContactNote', photo: 'mediaItem', schedule_entry: 'scheduledGridJob', rain_day: 'scheduleRainDay' }
  return Object.entries(counts)
    .map(([k, n]) => [k, k === self[entityType] ? n - 1 : n] as const)
    .filter(([k, n]) => n > 0 && KIND[k])
    .map(([k, n]) => `${n} ${KIND[k][n === 1 ? 0 : 1]}`)
    .join(', ')
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export default function DeletedRecords() {
  const [type, setType] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  async function load(t = type) {
    setError('')
    const r = await fetchWithAuth(`${API}/api/deleted-records${t ? `?type=${encodeURIComponent(t)}` : ''}`, { headers: { Authorization: `Bearer ${getAccessToken()}` } }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    if (r?.ok && j?.success) setRows(j.data)
    else { setRows([]); setError(j?.error || 'Could not load Deleted Records. Check the connection.') }
  }
  useEffect(() => { void load(type) }, [type])  // eslint-disable-line react-hooks/exhaustive-deps

  async function restore(row: Row) {
    setBusy(row.id)
    const r = await fetchWithAuth(`${API}/api/deleted-records/${row.id}/restore`, { method: 'POST', headers: { Authorization: `Bearer ${getAccessToken()}` } }).catch(() => null)
    const j = r ? await r.json().catch(() => null) : null
    setBusy(null)
    if (!r?.ok || !j?.success) { toast.error('Not restored', j?.error || 'Check the connection and try again.'); return }
    const skipped: Array<{ what: string; why: string }> = j.data?.skipped ?? []
    if (skipped.length) toast.info(`${row.entityLabel} restored`, `Left as it is: ${skipped.map(s => `${s.what} (${s.why})`).join('; ')}.`)
    else toast.success(`${row.entityLabel} restored`, 'Everything deleted with it is back.')
    refreshAfterRestore(row.entityType)
    await load()
  }

  return (
    <div data-deleted-records className="space-y-4 min-w-0">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Deleted Records</h2>
        <p className="text-sm text-gray-600 mt-1">Everything deleted, newest first, with what went with it. Restore puts it all back; anything changed since is left as it is and named. Nothing here is ever removed.</p>
      </div>
      <label className="block max-w-xs">
        <span className="text-xs text-gray-600">Show</span>
        <select value={type} onChange={e => setType(e.target.value)} data-deleted-filter className="mt-1 w-full min-h-[44px] border border-gray-300 rounded-lg px-3 text-base bg-white">
          {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </label>
      {error && <p className="text-sm text-red-700" role="alert">{error}</p>}
      {rows === null && <p className="text-sm text-gray-500">Loading…</p>}
      {rows?.length === 0 && !error && <p className="text-sm text-gray-600" data-deleted-empty>Nothing deleted{type ? ` of this type` : ''}.</p>}
      <ul className="divide-y divide-gray-200 border border-gray-200 rounded-xl overflow-hidden">
        {rows?.map(r => {
          const counts = countsLine(r.counts, r.entityType)
          return (
            <li key={r.id} data-deleted-row={r.entityId} data-deleted-type={r.entityType} className="p-3 sm:p-4 bg-white min-w-0">
              <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
                <div className="flex-1 min-w-0 basis-52">
                  <p className="text-[15px] font-semibold text-gray-900 break-words">{r.entityLabel || '(no name)'}</p>
                  <p className="text-sm text-gray-600 break-words">
                    {typeLabel(r.entityType)} · deleted {when(r.deletedAt)}{r.deletedBy ? ` by ${r.deletedBy}` : ''}
                  </p>
                  {counts && <p className="text-sm text-gray-700 break-words" data-deleted-counts>With it: {counts}</p>}
                  {r.reason && <p className="text-sm text-gray-600 break-words">Why: {r.reason}</p>}
                  {r.restoredAt && (
                    <p className="text-sm text-green-800 break-words" data-deleted-restored>
                      Restored {when(r.restoredAt)}{r.restoredBy ? ` by ${r.restoredBy}` : ''}
                      {r.restoreResult?.skipped?.length ? `. Left as it was: ${r.restoreResult.skipped.map(s => `${s.what} (${s.why})`).join('; ')}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  {r.children.length > 0 && (
                    <button className="btn btn-quiet btn-sm min-h-[44px]" aria-expanded={open === r.id} onClick={() => setOpen(o => (o === r.id ? null : r.id))}>
                      {open === r.id ? 'Hide' : 'Details'}
                    </button>
                  )}
                  {!r.restoredAt && (
                    <button className="btn btn-secondary btn-sm min-h-[44px]" disabled={busy === r.id} onClick={() => restore(r)} data-deleted-restore={r.entityId}>
                      {busy === r.id ? 'Restoring…' : 'Restore'}
                    </button>
                  )}
                </div>
              </div>
              {open === r.id && (
                <ul className="mt-2 pl-4 list-disc text-sm text-gray-700 space-y-0.5 break-words" data-deleted-children>
                  {r.children.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
