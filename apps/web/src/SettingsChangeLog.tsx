/**
 * Settings > Change log (owner only).
 *
 * Who changed which setting, when, from which device and address, and what
 * changed ("Permit Pending: isComplete false → true"). Every Settings save is
 * logged by the server (lib/settingsAudit.ts); this reads
 * GET /api/admin/settings-changes.
 */

import { useEffect, useMemo, useState } from 'react'
import { fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { plainText } from './plainError'

const API_BASE = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '')
const PAGE = 50

interface ChangeRow {
  id: string
  createdAt: string
  userEmail: string | null
  entityId: string | null
  newValues: { changes?: string[]; session?: string; hash?: string; version?: number } | null
  ipAddress: string | null
  userAgent: string | null
}

/** "Chrome 157 on Mac", "Chrome 155 on Android phone", "Safari on iPhone", or the raw text. */
export function deviceName(ua: string | null): string {
  if (!ua) return 'Unknown device'
  if (/^node\b/i.test(ua) || /node-fetch|undici|curl|python|axios/i.test(ua)) return `A script (${ua.slice(0, 30)})`
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
    : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'unknown system'
  const m = ua.match(/(Edg|OPR|SamsungBrowser|CriOS|Chrome|Firefox|FxiOS)\/(\d+)/)
  const names: Record<string, string> = { Edg: 'Edge', OPR: 'Opera', SamsungBrowser: 'Samsung Internet', CriOS: 'Chrome', FxiOS: 'Firefox' }
  const browser = m ? `${names[m[1]] ?? m[1]} ${m[2]}` : /Safari\//.test(ua) ? 'Safari' : 'Browser'
  return `${browser} on ${os}`
}

/** "ops-stages" → "Operations stages", "business-state/config" → "Company settings (config)". */
export function settingName(id: string | null): string {
  if (!id) return 'Setting'
  const fixed: Record<string, string> = {
    'ops-stages': 'Operations stages',
    'pipeline/stages': 'Pipeline stages',
    'follow-ups/settings': 'Follow up settings',
    'business-state/config': 'Settings (pricing, styles, appointments and the rest)',
    'business-state/settings': 'Settings (other)',
    'business-state/emailTemplates': 'Email templates',
    'business-state/contractSections': 'Contract sections',
    'business-state/quoteOptions': 'Quote options',
    'business-state/bundles': 'Bundles',
    'business-state/jobChecklists': 'Job checklists',
    'business-state/defaultMilestones': 'Default milestones',
    'business-state/automations': 'Automations (old list)',
    'business-state/budget': 'Budget',
  }
  if (fixed[id]) return fixed[id]
  if (id.startsWith('tier-set/')) return `Good Better Best: ${id.slice(9)}`
  if (id.startsWith('kv/')) return `Saved list: ${id.slice(3)}`
  return id
}

export default function SettingsChangeLog() {
  const [rows, setRows] = useState<ChangeRow[]>([])
  const [settings, setSettings] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const [setting, setSetting] = useState('')
  const [user, setUser] = useState('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const query = useMemo(() => {
    const p = new URLSearchParams()
    if (setting) p.set('setting', setting)
    if (user.trim()) p.set('user', user.trim())
    p.set('limit', String(PAGE))
    p.set('offset', String(offset))
    return p.toString()
  }, [setting, user, offset])

  useEffect(() => {
    let live = true
    setLoading(true); setError(null)
    fetchWithAuth(`${API_BASE}/api/admin/settings-changes?${query}`)
      .then(async r => {
        const json = await r.json().catch(() => ({}))
        if (!live) return
        if (!r.ok || !json.success) { setError(plainText(json.error) || 'Could not load the change log.'); return }
        setRows(json.data.rows); setTotal(json.data.total); setSettings(json.data.settings || [])
      })
      .catch(err => { if (live) setError((err as Error).message) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [query])

  const when = (d: string) => new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'medium', timeStyle: 'medium' })

  return (
    <div className="space-y-4" data-settings-change-log>
      <div>
        <h3 className="text-lg font-bold text-gray-900">Change log</h3>
        <p className="text-sm text-gray-500 mt-1">Every Settings save: who made it, when (Ocala time), from which device and address, and what changed. Only the owner sees this.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <select value={setting} onChange={e => { setSetting(e.target.value); setOffset(0) }} className="border border-gray-200 rounded-lg px-3 py-2 text-sm" aria-label="Setting">
          <option value="">Every setting</option>
          {settings.map(s => <option key={s} value={s}>{settingName(s)}</option>)}
        </select>
        <input value={user} onChange={e => { setUser(e.target.value); setOffset(0) }} placeholder="Who (email)" className="border border-gray-200 rounded-lg px-3 py-2 text-sm" aria-label="Who" />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-sm">{error}</div>}

      <ul className="space-y-2">
        {rows.map(r => (
          <li key={r.id} className="border border-gray-200 rounded-xl px-3 py-3" data-change-row>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <span className="font-semibold text-gray-900 text-sm">{settingName(r.entityId)}</span>
              <span className="text-xs text-gray-500">{when(r.createdAt)}</span>
            </div>
            <p className="text-xs text-gray-600 mt-1">
              {r.userEmail || 'Unknown'} · {deviceName(r.userAgent)} · {r.ipAddress || 'no address'}
              {r.newValues?.session ? ` · sign in ${r.newValues.session}` : ''}
            </p>
            <ul className="mt-2 space-y-0.5">
              {(r.newValues?.changes ?? []).map((c, i) => <li key={i} className="text-sm text-gray-800 break-words">{c}</li>)}
            </ul>
            {r.userAgent && <p className="text-[11px] text-gray-400 mt-2 break-all">{r.userAgent}</p>}
          </li>
        ))}
        {!loading && rows.length === 0 && !error && <li className="text-sm text-gray-400 py-8 text-center">No settings changes logged yet.</li>}
        {loading && <li className="text-sm text-gray-400 py-8 text-center">Loading…</li>}
      </ul>

      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{total ? `${Math.min(offset + 1, total)}–${Math.min(offset + PAGE, total)} of ${total}` : ''}</span>
        <div className="flex gap-2">
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} className="px-3 py-2 rounded-lg border border-gray-200 disabled:opacity-50">Newer</button>
          <button disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)} className="px-3 py-2 rounded-lg border border-gray-200 disabled:opacity-50">Older</button>
        </div>
      </div>
    </div>
  )
}
