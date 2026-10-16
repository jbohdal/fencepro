/**
 * Settings → Google Calendar. Connect, see what is connected, push
 * everything upcoming, disconnect. The sync itself runs on the server.
 */

import { useEffect, useState } from 'react'
import { fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { toast } from './toast'
import { replaceUrl } from './nav'

const API = (window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '') + '/api/google-calendar'

interface Status {
  configured: boolean
  connected: boolean
  active: boolean
  email: string | null
  calendarName: string | null
  expectedCalendarName: string
  lastSyncAt: string | null
  lastError: string | null
  eventsOnCalendar: number
  failing: Array<{ source: string; recordId: string; attempts: number; error: string | null }>
}
interface PushResult { created: number; updated: number; deleted: number; unchanged: number; failed: number; errors: Array<{ summary: string; error: string }> }

async function api<T>(path: string, method = 'GET'): Promise<{ ok: boolean; data?: T; error?: string }> {
  try {
    const res = await fetchWithAuth(`${API}${path}`, { method, headers: { 'Content-Type': 'application/json' } })
    const json = await res.json().catch(() => ({}))
    return res.ok && json?.success ? { ok: true, data: json.data as T } : { ok: false, error: json?.error || `The server answered ${res.status}` }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'The server could not be reached' }
  }
}

export default function CalendarSyncSettings() {
  const [status, setStatus] = useState<Status | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState<'' | 'connect' | 'push' | 'disconnect'>('')
  const [lastPush, setLastPush] = useState<PushResult | null>(null)

  async function load() {
    const r = await api<Status>('/status')
    if (r.ok && r.data) { setStatus(r.data); setLoadError('') } else setLoadError(r.error || 'Could not load')
  }

  useEffect(() => {
    load()
    // Coming back from Google: say what happened, then tidy the address bar.
    const q = new URLSearchParams(window.location.search)
    const result = q.get('gcal')
    if (result === 'connected') toast.success('Google Calendar connected', `${q.get('detail') || ''}. Press "Push all upcoming" to start sending events.`)
    if (result === 'error') toast.error('Google Calendar was not connected', q.get('detail') || 'Try again.')
    if (result) replaceUrl(window.location.pathname + window.location.hash)
  }, [])

  async function connect() {
    setBusy('connect')
    const r = await api<{ url: string }>(`/connect-url?returnTo=${encodeURIComponent(window.location.origin)}`)
    if (r.ok && r.data) { window.location.href = r.data.url; return }
    setBusy('')
    toast.error('Could not start the connection', r.error)
  }

  async function pushAll() {
    setBusy('push')
    const r = await api<PushResult>('/push-all', 'POST')
    setBusy('')
    if (!r.ok || !r.data) { toast.error('Push did not finish', r.error); await load(); return }
    setLastPush(r.data)
    const d = r.data
    if (d.failed > 0) toast.error(`${d.failed} event${d.failed === 1 ? '' : 's'} could not be sent`, 'They will be tried again automatically. Details are below.')
    else toast.success('Calendar is up to date', `${d.created} added, ${d.updated} changed, ${d.deleted} removed.`)
    await load()
  }

  async function disconnect() {
    if (!window.confirm('Disconnect Google Calendar? EZ Biz stops sending events. Events already on the calendar stay there.')) return
    setBusy('disconnect')
    const r = await api('/disconnect', 'POST')
    setBusy('')
    if (!r.ok) toast.error('Could not disconnect', r.error)
    setLastPush(null)
    await load()
  }

  if (loadError) return <p className="text-sm text-red-600">Could not load the calendar connection: {loadError}</p>
  if (!status) return <p className="text-sm text-gray-400">Loading…</p>

  const btn = 'text-sm font-semibold px-4 py-2 rounded-lg transition-colors disabled:opacity-50'
  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h3 className="text-base font-bold text-gray-900">Google Calendar</h3>
        <p className="text-sm text-gray-500 mt-1">
          Estimates and installs are sent one way, from EZ Biz to a calendar of their own named <strong>{status.expectedCalendarName}</strong>.
          EZ Biz can only see and change that calendar, never your main one.
        </p>
      </div>

      {!status.configured && (
        <div className="rounded-xl border border-yellow-200 bg-yellow-50 p-4 text-sm text-yellow-800">
          Google is not set up on this server yet. The settings file needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_REDIRECT_URI. See GO_LIVE.md, "Google Calendar".
        </div>
      )}

      {status.configured && !status.connected && (
        <div className="rounded-xl border border-gray-200 p-4">
          <p className="text-sm text-gray-700 mb-3">Not connected.</p>
          <button onClick={connect} disabled={busy !== ''} className={`${btn} bg-orange-500 hover:bg-orange-600 text-white`}>
            {busy === 'connect' ? 'Opening Google…' : 'Connect Google Calendar'}
          </button>
          <p className="text-xs text-gray-400 mt-2">Do this from the browser on the Mac mini, at the localhost address. Google sends you back there.</p>
        </div>
      )}

      {status.connected && (
        <div className="rounded-xl border border-gray-200 p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><p className="text-xs text-gray-400">Connected account</p><p className="font-semibold text-gray-900 break-all">{status.email}</p></div>
            <div><p className="text-xs text-gray-400">Calendar</p><p className="font-semibold text-gray-900">{status.calendarName}</p></div>
            <div><p className="text-xs text-gray-400">Events on the calendar</p><p className="font-semibold text-gray-900">{status.eventsOnCalendar}</p></div>
            <div><p className="text-xs text-gray-400">Last sync</p><p className="font-semibold text-gray-900">{status.lastSyncAt ? new Date(status.lastSyncAt).toLocaleString() : 'Not yet'}</p></div>
          </div>
          {!status.active && (
            <p className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
              Connected, but nothing has been sent yet. Press "Push all upcoming" to send everything dated today or later. After that, saves sync by themselves.
            </p>
          )}
          {status.active && <p className="text-sm text-green-700">Syncing is on. Anything you date, move or remove in EZ Biz follows on the calendar within a few seconds.</p>}
          {status.lastError && <p className="text-sm text-red-600">Last problem: {status.lastError}. It is retried automatically; nothing in EZ Biz is affected.</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            <button onClick={pushAll} disabled={busy !== ''} className={`${btn} bg-orange-500 hover:bg-orange-600 text-white`}>
              {busy === 'push' ? 'Pushing…' : 'Push all upcoming'}
            </button>
            <button onClick={disconnect} disabled={busy !== ''} className={`${btn} border border-red-200 text-red-600 hover:bg-red-50`}>
              {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect'}
            </button>
          </div>
        </div>
      )}

      {lastPush && (
        <div className="rounded-xl border border-gray-200 p-4 text-sm text-gray-700">
          <p className="font-semibold text-gray-900 mb-1">Last push</p>
          <p>{lastPush.created} added · {lastPush.updated} changed · {lastPush.deleted} removed · {lastPush.unchanged} already right · {lastPush.failed} failed</p>
          {lastPush.errors.slice(0, 5).map((e, i) => <p key={i} className="text-xs text-red-600 mt-1">{e.summary || 'An event'}: {e.error}</p>)}
        </div>
      )}

      {status.failing.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <p className="font-semibold mb-1">{status.failing.length} event{status.failing.length === 1 ? '' : 's'} waiting to be retried</p>
          {status.failing.slice(0, 5).map((f, i) => <p key={i} className="text-xs">{f.source} {f.recordId.slice(0, 8)} · tried {f.attempts} time{f.attempts === 1 ? '' : 's'} · {f.error}</p>)}
        </div>
      )}
    </div>
  )
}
