/**
 * Where a change stands, in words: Saved, Saving…, Waiting for signal, or
 * Couldn't save (tap to retry). "Saved" only once the server has confirmed it.
 *
 *   <SaveStatus keys={['customer:<id>']} />   beside a record
 *   <SyncBadge />                             top bar: anything still waiting
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Check, CloudOff, Loader2, AlertTriangle, CloudUpload, X } from 'lucide-react'
import { subscribe, outboxVersion, statusOf, allOps, retry, discard, hasSignal, isDurable, type RecordStatus, type Op } from './outbox'
import { waitingCount, uploadAll, MEDIA_EVENT } from './mediaStore'
import { BackClose } from './nav'

/** Re-render when anything in the outbox changes. */
export function useOutbox(): number {
  return useSyncExternalStore(subscribe, outboxVersion, outboxVersion)
}

const LOOK: Record<RecordStatus, { text: string; cls: string; Icon: typeof Check }> = {
  saved: { text: 'Saved', cls: 'bg-green-50 text-green-800', Icon: Check },
  saving: { text: 'Saving…', cls: 'bg-blue-50 text-blue-800', Icon: Loader2 },
  waiting: { text: 'Waiting for signal', cls: 'bg-amber-100 text-amber-900', Icon: CloudOff },
  failed: { text: "Couldn't save, tap to retry", cls: 'bg-red-100 text-red-800', Icon: AlertTriangle },
}

/** Changes to one pipeline card (they travel together as pipeline changes). */
export const cardChange = (cardId: string) => (op: Op) => op.kind === 'pipeline.delta' && (op.payload?.upsert?.some((u: any) => u.lead?.id === cardId) || op.payload?.remove?.includes(cardId))

export function SaveStatus({ keys, also, quietWhenSaved = false, className = '' }: { keys: string[]; also?: (op: Op) => boolean; quietWhenSaved?: boolean; className?: string }) {
  useOutbox()
  const s = statusOf(keys, also)
  if (quietWhenSaved && s.status === 'saved') return null
  const { text, cls, Icon } = LOOK[s.status]
  const body = (
    <>
      <Icon size={14} aria-hidden="true" className={s.status === 'saving' ? 'animate-spin' : ''} />
      <span>{text}</span>
    </>
  )
  const common = `inline-flex items-center gap-1 rounded-full px-2.5 min-h-[32px] text-xs font-semibold ${cls} ${className}`
  if (s.status === 'failed') {
    return (
      <button type="button" className={common} title={s.error} data-save-status="failed"
        onClick={e => { e.stopPropagation(); s.ops.filter(o => o.state === 'failed').forEach(o => retry(o.id)) }}>{body}</button>
    )
  }
  return <span className={common} title={s.error} data-save-status={s.status} role="status">{body}</span>
}

/** Top bar: how many changes and photos are still waiting; tap for the list. */
export function SyncBadge() {
  useOutbox()
  const [photos, setPhotos] = useState(0)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const read = () => { waitingCount().then(setPhotos).catch(() => {}) }
    read()
    window.addEventListener(MEDIA_EVENT, read)
    const off = subscribe(read)
    const t = setInterval(read, 5_000)
    return () => { window.removeEventListener(MEDIA_EVENT, read); off(); clearInterval(t) }
  }, [])
  const ops = allOps()
  const failed = ops.filter(o => o.state === 'failed').length
  const n = ops.length + photos
  if (n === 0 && !open) return null
  const offline = !hasSignal()
  const cls = failed ? 'bg-red-100 text-red-800' : offline ? 'bg-amber-100 text-amber-900' : 'bg-blue-50 text-blue-800'
  const word = failed ? "couldn't save" : offline ? 'waiting for signal' : 'saving'
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-sync-badge={failed ? 'failed' : offline ? 'waiting' : 'saving'}
        className={`flex items-center gap-1 rounded-full text-xs font-semibold px-3 min-h-[44px] ${cls}`} aria-label={`${n} ${word}. Show what is waiting.`}>
        {failed ? <AlertTriangle size={16} aria-hidden="true" /> : offline ? <CloudOff size={16} aria-hidden="true" /> : <CloudUpload size={16} aria-hidden="true" />}
        {n}<span className="hidden sm:inline">&nbsp;{word}</span>
      </button>
      {open && <WaitingList photos={photos} onClose={() => setOpen(false)} />}
    </>
  )
}

function WaitingList({ photos, onClose }: { photos: number; onClose: () => void }) {
  useOutbox()
  const ops = allOps()
  const offline = !hasSignal()
  return (
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-end md:items-center justify-center" onClick={onClose} data-waiting-list>
      <BackClose name="waiting-list" onClose={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Waiting to save" onClick={e => e.stopPropagation()}
        className="bg-white w-full md:max-w-lg md:rounded-2xl rounded-t-2xl shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Waiting to save</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-quiet btn-icon"><X size={22} aria-hidden="true" /></button>
        </div>
        <div className="overflow-y-auto p-4 space-y-3 pb-[calc(16px+env(safe-area-inset-bottom))]">
          <p className="text-sm text-gray-700">
            {offline ? 'No signal right now. Everything below is kept on this phone and will be sent by itself when there is signal.' : 'These are being sent to the server now.'}
            {!isDurable() && ' This browser is not letting the app keep them if it is closed, so keep this page open until they are sent.'}
          </p>
          {ops.length === 0 && photos === 0 && <p className="text-sm text-gray-600">Everything is saved.</p>}
          {ops.map(o => {
            const st = o.state === 'failed' ? 'failed' : (o.errorKind === 'offline' || offline) ? 'waiting' : 'saving'
            const { text, cls, Icon } = LOOK[st]
            return (
              <div key={o.id} className="rounded-xl border border-gray-200 p-3" data-waiting-item={o.kind}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-gray-900">{o.label}</p>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold shrink-0 ${cls}`}><Icon size={12} aria-hidden="true" />{st === 'failed' ? "Couldn't save" : text}</span>
                </div>
                {o.error && <p className="text-sm text-gray-700 mt-1">{o.error}</p>}
                {o.state === 'failed' && (
                  <div className="flex gap-2 mt-2">
                    <button type="button" className="btn btn-primary btn-sm min-h-[44px]" onClick={() => retry(o.id)}>Try again</button>
                    <button type="button" className="btn btn-quiet btn-sm min-h-[44px]" onClick={() => {
                      if (window.confirm('Throw this change away? It is not on the server, so it will be gone.')) discard(o.id)
                    }}>Throw away</button>
                  </div>
                )}
              </div>
            )
          })}
          {photos > 0 && (
            <div className="rounded-xl border border-gray-200 p-3 flex items-center justify-between gap-2" data-waiting-item="photos">
              <p className="text-sm font-semibold text-gray-900">{photos} photo{photos === 1 ? '' : 's'} or video{photos === 1 ? '' : 's'} waiting to upload</p>
              <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => uploadAll()}>Send now</button>
            </div>
          )}
          {ops.length > 0 && <button type="button" className="btn btn-secondary w-full min-h-[48px]" onClick={() => retry()}>Try everything again now</button>}
        </div>
      </div>
    </div>
  )
}
