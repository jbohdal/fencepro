/**
 * Feedback (owner and admins): what people sent with "Send feedback", newest
 * first. Each one shows the picture of the screen (tap to see it big), what
 * was written, who, when, the page (tap to open it), the device, and New /
 * Seen / Done.
 */

import { useEffect, useState } from 'react'
import { X, ExternalLink, RefreshCw } from 'lucide-react'
import { loadFeedback, setFeedbackStatus, screenshotUrl, type FeedbackItem, type FeedbackStatus } from './feedback'
import { navigate, BackClose } from './nav'
import { toast } from './toast'

const STATUS: { value: FeedbackStatus; label: string; on: string }[] = [
  { value: 'new', label: 'New', on: 'bg-orange-500 text-white border-orange-500' },
  { value: 'seen', label: 'Seen', on: 'bg-blue-600 text-white border-blue-600' },
  { value: 'done', label: 'Done', on: 'bg-green-600 text-white border-green-600' },
]
const ROLE: Record<string, string> = { super_admin: 'Owner', admin: 'Admin', manager: 'Manager', sales_rep: 'Sales', office_staff: 'Office', field_crew: 'Crew' }

/** "iPhone, Safari" from the browser's description of itself. */
export function deviceText(ua: string): string {
  const dev = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh|Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown device'
  const br = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'browser'
  return `${dev}, ${br}`
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function Shot({ id, onOpen }: { id: string; onOpen: (url: string) => void }) {
  const [url, setUrl] = useState<string | null | undefined>(undefined)
  useEffect(() => { let live = true; void screenshotUrl(id).then(u => { if (live) setUrl(u) }); return () => { live = false } }, [id])
  if (url === undefined) return <div className="w-28 h-40 md:w-36 md:h-48 rounded-lg bg-gray-100 animate-pulse shrink-0" />
  if (!url) return <div className="w-28 h-20 md:w-36 rounded-lg bg-gray-50 border border-dashed border-gray-300 text-[11px] text-gray-400 grid place-items-center text-center p-2 shrink-0">Picture not loaded</div>
  return (
    <button type="button" onClick={() => onOpen(url)} className="shrink-0" aria-label="See the picture big" data-feedback-shot>
      <img src={url} alt="Picture of the screen" className="w-28 md:w-36 max-h-48 object-cover object-top rounded-lg border border-gray-200" />
    </button>
  )
}

export default function FeedbackPage() {
  const [items, setItems] = useState<FeedbackItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | FeedbackStatus>('all')
  const [big, setBig] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function load() {
    const r = await loadFeedback()
    if (r.ok) { setItems(r.items); setError(null) } else setError(r.error)
  }
  useEffect(() => { void load() }, [])

  async function mark(f: FeedbackItem, status: FeedbackStatus) {
    if (f.status === status || busy) return
    setBusy(f.id)
    const row = await setFeedbackStatus(f.id, status)
    setBusy(null)
    if (!row) { toast.error('Not changed', 'No signal right now, or the server did not answer. Try again.'); return }
    setItems(cur => (cur ?? []).map(x => (x.id === row.id ? row : x)))
  }

  const shown = (items ?? []).filter(f => filter === 'all' || f.status === filter)
  const count = (s: FeedbackStatus) => (items ?? []).filter(f => f.status === s).length

  return (
    <div className="max-w-4xl mx-auto" data-feedback-page>
      <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
        <div className="flex gap-1.5 flex-wrap" role="tablist">
          {(['all', 'new', 'seen', 'done'] as const).map(v => (
            <button key={v} type="button" role="tab" aria-selected={filter === v} onClick={() => setFilter(v)}
              className={`px-3 min-h-[40px] rounded-full text-sm font-semibold border ${filter === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200'}`}>
              {v === 'all' ? `All ${items?.length ?? ''}` : `${STATUS.find(s => s.value === v)!.label} ${items ? count(v) : ''}`}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => void load()} className="btn btn-secondary btn-sm min-h-[40px]"><RefreshCw size={14} aria-hidden="true" /> Refresh</button>
      </div>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}
      {items === null && !error && <p className="text-sm text-gray-500">Loading feedback...</p>}
      {items && shown.length === 0 && <p className="text-sm text-gray-500 bg-white border border-gray-200 rounded-xl p-6 text-center">{items.length ? 'Nothing here with this filter.' : 'No feedback yet. It arrives here when someone taps Send feedback at the top of any page.'}</p>}

      <ul className="space-y-3">
        {shown.map(f => (
          <li key={f.id} data-feedback-item={f.id} className={`bg-white border rounded-xl p-3 md:p-4 flex gap-3 ${f.status === 'new' ? 'border-orange-300' : 'border-gray-200'}`}>
            {f.hasScreenshot ? <Shot id={f.id} onOpen={setBig} /> : <div className="w-28 md:w-36 shrink-0 text-[11px] text-gray-400 border border-dashed border-gray-200 rounded-lg grid place-items-center p-2 text-center">No picture</div>}
            <div className="min-w-0 flex-1">
              <p className="text-sm text-gray-900 whitespace-pre-wrap break-words" data-feedback-text>{f.text || <span className="text-gray-400">(no text)</span>}</p>
              <p className="text-xs text-gray-600 mt-2"><span className="font-semibold">{f.userName || 'Someone'}</span>{f.role ? ` (${ROLE[f.role] ?? f.role})` : ''} · {when(f.createdAt)}</p>
              {f.path && (
                <button type="button" onClick={() => navigate(f.path)} className="text-xs text-orange-600 hover:underline mt-1 flex items-center gap-1 max-w-full" data-feedback-path>
                  <ExternalLink size={12} aria-hidden="true" className="shrink-0" /><span className="truncate">{f.path}</span>
                </button>
              )}
              <p className="text-[11px] text-gray-400 mt-1 break-words" title={f.userAgent}>{deviceText(f.userAgent)} · {f.screen}{f.appFile ? ` · ${f.appFile.split('/').pop()}` : ''}</p>
              {f.errors?.length > 0 && (
                <details className="mt-1 text-[11px] text-red-700">
                  <summary className="cursor-pointer">{f.errors.length} app error{f.errors.length > 1 ? 's' : ''} before sending</summary>
                  <ul className="mt-1 space-y-0.5">{f.errors.map((e, i) => <li key={i} className="break-words">{when(e.at)}: {e.message}</li>)}</ul>
                </details>
              )}
              <div className="flex gap-1.5 mt-2" role="group" aria-label="Status">
                {STATUS.map(s => (
                  <button key={s.value} type="button" onClick={() => void mark(f, s.value)} disabled={busy === f.id} aria-pressed={f.status === s.value} data-feedback-status={s.value}
                    className={`px-3 min-h-[36px] rounded-lg text-xs font-semibold border ${f.status === s.value ? s.on : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </li>
        ))}
      </ul>

      {big && (
        <div className="fixed inset-0 z-[180] bg-black/85 flex items-center justify-center p-3" onClick={() => setBig(null)} data-feedback-big>
          <BackClose name="feedback-shot" onClose={() => setBig(null)} />
          <img src={big} alt="Picture of the screen" className="max-w-full max-h-full object-contain rounded" />
          <button type="button" onClick={() => setBig(null)} aria-label="Close" className="absolute top-3 right-3 w-11 h-11 grid place-items-center bg-white/90 rounded-full text-gray-900"><X size={20} aria-hidden="true" /></button>
        </div>
      )}
    </div>
  )
}
