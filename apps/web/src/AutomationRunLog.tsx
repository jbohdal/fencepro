/**
 * What automations did for one card or job: each run, when, each step's
 * result, and Run again on a failed one. Read from the server each time it
 * opens (and every 20 seconds while open).
 */

import { useCallback, useEffect, useState } from 'react'
import { api, openPdf, STATUS_STYLE, STATUS_WORD, type Run } from './automationsApi'
import { toast } from './toast'
import { API_ORIGIN } from './syncHttp'

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

export function RunCard({ run, onChanged, open: startOpen = false }: { run: Run; onChanged?: () => void; open?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const [busy, setBusy] = useState(false)
  async function again() {
    setBusy(true)
    try { await api('POST', `/runs/${run.id}/run-again`); toast.success('Running again', run.ruleName); onChanged?.() }
    catch (err) { toast.error('Could not run it again', (err as Error).message) }
    finally { setBusy(false) }
  }
  const lines = (run.log ?? []).filter(l => l.result !== 'queued' || run.log.length === 1)
  return (
    <li className="py-3" data-run={run.id} data-run-status={run.status}>
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-start gap-2 text-left min-h-[44px]">
        <span className={`chip ${STATUS_STYLE[run.status] ?? 'bg-gray-100 text-gray-700'}`}>{STATUS_WORD[run.status] ?? run.status}</span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-semibold text-gray-900">{run.ruleName}{run.onCard ? <span className="font-normal text-gray-500" data-run-on-card> · on the pipeline card</span> : null}</span>
          <span className="block text-xs text-gray-600">{when(run.createdAt)}{run.status === 'waiting' || run.status === 'queued' ? ` · next ${when(run.nextRunAt)}` : ''}</span>
          {run.status === 'failed' && run.lastError && <span className="block text-xs text-red-700 mt-0.5">{run.lastError}</span>}
        </span>
      </button>
      {open && (
        <ol className="mt-2 ml-2 border-l-2 border-gray-200 pl-3 space-y-1.5">
          {lines.map((l, i) => (
            <li key={i} className="text-xs text-gray-700">
              <span className="text-gray-500">{when(l.at)}</span>{' '}
              {l.step != null && <span className="font-semibold">Step {l.step + 1}: </span>}
              <span className={l.result === 'failed' ? 'text-red-700' : l.result === 'retry' ? 'text-amber-700' : ''}>{l.detail}</span>
              {l.link && l.link.startsWith('/api/') && (
                <button type="button" className="ml-1 underline text-[color:var(--color-brand)]" onClick={() => openPdf(l.link!.replace(API_ORIGIN, '')).catch(err => toast.error('Could not open it', (err as Error).message))}>open</button>
              )}
              {l.link && l.link.startsWith('sms:') && <a className="ml-1 underline text-[color:var(--color-brand)]" href={l.link}>send text</a>}
            </li>
          ))}
        </ol>
      )}
      {run.status === 'failed' && (
        <button type="button" className="btn btn-secondary btn-sm mt-2" disabled={busy} onClick={again} data-run-again={run.id}>Run again</button>
      )}
    </li>
  )
}

/** `job`: entityId is a job, so its pipeline card's runs show too (the Signed Contract rule runs on the card). */
export default function AutomationRunLog({ entityId, title = 'Automations', job = false }: { entityId: string; title?: string; job?: boolean }) {
  const [runs, setRuns] = useState<Run[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    try { setRuns(await api<Run[]>('GET', `/runs?${job ? 'jobId' : 'entityId'}=${encodeURIComponent(entityId)}&limit=30`)); setError('') }
    catch (err) { setError((err as Error).message) }
  }, [entityId, job])
  useEffect(() => { void load(); const t = setInterval(load, 20_000); return () => clearInterval(t) }, [load])
  return (
    <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3" data-run-log={entityId}>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {error && <p className="text-sm text-red-700 mt-1">{error}</p>}
      {runs && runs.length === 0 && <p className="text-sm text-gray-600 mt-1">No automation has run for this yet.</p>}
      {runs && runs.length > 0 && <ul className="divide-y divide-gray-100">{runs.map(r => <RunCard key={r.id} run={r} onChanged={load} />)}</ul>}
    </section>
  )
}
