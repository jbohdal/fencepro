/**
 * Final quantity takeoff, after install and right before the final
 * walkthrough (job costing: quoted vs actual). Phone first, in the
 * walkthrough's style: the pull sheet line by line with - / + for what was
 * used, back to the shop and back to the vendor, items added on the job
 * (searchable Inventory), actual labor (sub sections paid or crew hours), a
 * photo per line, then "Send to the office". The owner or office approves it,
 * which freezes the actual cost.
 *
 * Quantities only: this screen never shows a cost, and the takeoff's answers
 * from the server carry none (routes/job-costing.ts). Works with no signal
 * (takeoffStore, mediaStore).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { partWithPair } from '../../portal/src/server/lib/partNames'
import { X, Minus, Plus, Camera, Search, Trash2, ClipboardList, Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { Job } from './jobStore'
import { jobInstallWord } from './jobWork'
import { getQuotes } from './quoteStore'
import { getInventory, initInventory } from './inventoryStore'
import { addCapture, localMedia, MEDIA_EVENT, type LocalMedia } from './mediaStore'
import { baseMime } from './MediaCapture'
import { subscribe as outboxSubscribe, outboxVersion, hasSignal } from './outbox'
import { SaveStatus } from './SaveStatus'
import { fetchCurrentUser } from './crmAuth'
import { useCan } from './permissions'
import { toast } from './toast'
import { useBackLayer } from './nav'
import {
  loadTakeoff, getTakeoff, startTakeoff, setLine, addItem, removeItem, setLabor, submitTakeoff, approveTakeoff, reopenTakeoff,
  takeoffPending, isTakeoffOp, takeoffVersion, TAKEOFF_EVENT, photoSrc, crewHoursTotal, newId,
  type Takeoff, type TakeoffLine, type TakeoffLabor,
} from './takeoffStore'

const BIG = 'min-h-[48px]'
const STATUS_WORDS: Record<string, string> = { draft: 'In progress', submitted: 'Sent to the office', approved: 'Approved' }
const REASONS = [{ key: 'extra', label: 'Extra' }, { key: 'broken', label: 'Broken' }, { key: 'other', label: 'Other' }] as const

function useTakeoff(jobId: string): Takeoff | null | undefined {
  const sub = useCallback((f: () => void) => { window.addEventListener(TAKEOFF_EVENT, f); const off = outboxSubscribe(f); return () => { window.removeEventListener(TAKEOFF_EVENT, f); off() } }, [])
  useSyncExternalStore(sub, () => `${outboxVersion()}:${takeoffVersion()}`)
  return getTakeoff(jobId)
}

function useLocalPhotos(jobId: string): Map<string, string> {
  const [map, setMap] = useState(new Map<string, string>())
  useEffect(() => {
    let alive = true
    const urls: string[] = []
    const read = () => localMedia({ jobId }).then((list: LocalMedia[]) => {
      if (!alive) return
      const next = new Map<string, string>()
      for (const m of list) { const u = URL.createObjectURL(m.markupBlob ?? m.blob); urls.push(u); next.set(m.clientId, u) }
      setMap(next)
    }).catch(() => {})
    read()
    window.addEventListener(MEDIA_EVENT, read)
    return () => { alive = false; window.removeEventListener(MEDIA_EVENT, read); urls.forEach(u => URL.revokeObjectURL(u)) }
  }, [jobId])
  return map
}

const fmtQty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('en-US')
const diffWords = (d: number) => (d > 0 ? `${fmtQty(d)} over` : d < 0 ? `${fmtQty(-d)} under` : 'as planned')

// ── On the job's page ─────────────────────────────────────────────────────────

export default function JobTakeoffPanel({ job }: { job: Job }) {
  const t = useTakeoff(job.id)
  const [open, setOpen] = useState(false)
  const [me, setMe] = useState<string | null>(null)
  useEffect(() => { loadTakeoff(job.id) }, [job.id])
  useEffect(() => { fetchCurrentUser().then(u => setMe(u ? `${u.firstName} ${u.lastName}`.trim() : null)).catch(() => {}) }, [])
  useEffect(() => { if (new URLSearchParams(window.location.search).get('takeoff') === job.id) setOpen(true) }, [job.id])

  async function start() {
    const quote = job.quoteId ? getQuotes().find(q => q.id === job.quoteId) : undefined
    const sheet = Array.isArray(quote?.pullSheet) ? quote!.pullSheet : []
    const laborMode = (quote as any)?.pricing?.laborMode === 'hourly' ? 'crew' : 'sub'
    await startTakeoff(job, { lines: sheet.filter((l: any) => l && typeof l.item === 'string' && l.item.trim()).map((l: any) => ({ part: String(l.item), qty: Number(l.qty) || 0 })), laborMode }, me)
    setOpen(true)
  }

  const changed = t ? t.lines.filter(l => l.extra || l.usedQty !== l.plannedQty).length : 0
  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-2" data-takeoff-panel={t ? t.status : 'none'}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-1.5"><ClipboardList size={16} aria-hidden="true" /> Final takeoff</h3>
        {t && <SaveStatus keys={[]} also={isTakeoffOp(t.id)} quietWhenSaved />}
      </div>
      {t === undefined && <p className="text-xs text-gray-500">Loading…</p>}
      {t === null && <p className="text-xs text-gray-600">After {jobInstallWord(job) === 'Repair' ? 'the repair' : 'install'}, before the walkthrough: confirm what was used from the pull sheet, add anything extra, mark returns and the labor.</p>}
      {t && (
        <p className="text-xs text-gray-700" data-takeoff-summary>
          {STATUS_WORDS[t.status]} · {t.lines.length} lines{changed ? ` · ${changed} changed or added` : ''}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {t === null && <button type="button" className={`btn btn-primary ${BIG} flex-1`} onClick={start} data-takeoff-start>Start takeoff</button>}
        {t && <button type="button" className={`btn ${t.status === 'approved' ? 'btn-secondary' : 'btn-primary'} ${BIG} flex-1`} onClick={() => setOpen(true)} data-takeoff-open>{t.status === 'approved' ? 'View takeoff' : 'Open takeoff'}</button>}
      </div>
      {open && t && <TakeoffScreen t={t} job={job} me={me} onClose={() => setOpen(false)} />}
    </div>
  )
}

// ── The takeoff screen ────────────────────────────────────────────────────────

function TakeoffScreen({ t, job, me, onClose }: { t: Takeoff; job: Job; me: string | null; onClose: () => void }) {
  useBackLayer(onClose, { key: 'takeoff', params: { takeoff: job.id } })
  const office = useCan('costs.view')
  const local = useLocalPhotos(job.id)
  const pending = takeoffPending(t)
  const readOnly = t.status === 'approved' || (t.status === 'submitted' && !office)
  const [adding, setAdding] = useState(false)
  // A photo finishing its upload (the phone's copy goes): look again for the server's copy.
  const tid = t.id
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const again = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { loadTakeoff(job.id) }, 1200) }
    window.addEventListener(MEDIA_EVENT, again)
    const every = setInterval(() => { const cur = getTakeoff(job.id); if (cur && !takeoffPending(cur)) loadTakeoff(job.id) }, 20_000)
    return () => { window.removeEventListener(MEDIA_EVENT, again); clearInterval(every); if (timer) clearTimeout(timer) }
  }, [job.id, tid])

  const photoUrl = (cid: string | null) => (cid ? (t.media[cid] ? photoSrc(t.media[cid]) : local.get(cid) ?? null) : null)
  const planned = t.lines.filter(l => !l.extra), extras = t.lines.filter(l => l.extra)

  return (
    <div className="fixed inset-0 z-[70] bg-gray-50 overflow-y-auto overflow-x-hidden" data-takeoff-screen={t.status}>
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 pt-[env(safe-area-inset-top)]">
        <div className="max-w-[560px] mx-auto flex items-center gap-2 px-2 py-1.5">
          <button type="button" className="w-12 h-12 grid place-items-center text-gray-600 shrink-0" aria-label="Close the takeoff" onClick={onClose}><X size={24} /></button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 truncate">Final takeoff</p>
            <p className="text-xs text-gray-500 truncate">{job.customerName} · {STATUS_WORDS[t.status]}</p>
          </div>
          <SaveStatus keys={[]} also={isTakeoffOp(t.id)} quietWhenSaved />
        </div>
      </div>

      <div className="max-w-[560px] mx-auto px-3 py-4 space-y-5 pb-24">
        {t.status !== 'draft' && (
          <div className={`rounded-xl border p-3 text-sm ${t.status === 'approved' ? 'bg-green-50 border-green-200 text-green-900' : 'bg-blue-50 border-blue-200 text-blue-900'}`} data-takeoff-state>
            {t.status === 'approved' ? `Approved${t.approvedBy ? ` by ${t.approvedBy}` : ''}${t.approvedAt ? ` on ${new Date(t.approvedAt).toLocaleDateString('en-US')}` : ''}.` : `Sent to the office${t.submittedBy ? ` by ${t.submittedBy}` : ''}.${office ? ' Check it and approve.' : ' The office can still change it.'}`}
          </div>
        )}

        <label className="block">
          <span className="text-xs text-gray-500">Install date</span>
          <input type="date" className={`w-full border border-gray-300 rounded-lg px-3 ${BIG} text-base bg-white`} value={t.installDate} disabled={readOnly}
            onChange={e => { if (e.target.value) void setLabor(t, t.labor, e.target.value, t.note) }} data-takeoff-date />
        </label>

        <Block title="Pull sheet" sub={`${planned.length} lines · tap − / + for what was used`}>
          {planned.length === 0 && <p className="text-sm text-gray-600">This job's quote has no pull sheet. Add what was used below.</p>}
          {planned.map(l => <LineRow key={l.id} t={t} line={l} job={job} photoUrl={photoUrl} readOnly={readOnly} />)}
        </Block>

        <Block title="Added on the job" sub={extras.length ? `${extras.length} items` : 'Extra post, extra concrete, a broken panel'}>
          {extras.map(l => <LineRow key={l.id} t={t} line={l} job={job} photoUrl={photoUrl} readOnly={readOnly} />)}
          {!readOnly && <button type="button" className={`btn btn-secondary ${BIG} w-full`} onClick={() => setAdding(true)} data-takeoff-add><Plus size={16} aria-hidden="true" /> Add an item</button>}
        </Block>

        <LaborBlock t={t} readOnly={readOnly} office={office} />

        <Block title="Note">
          <NoteBox value={t.note} disabled={readOnly} onSave={v => setLabor(t, t.labor, t.installDate, v)} testId="takeoff-note" />
        </Block>

        {t.status === 'draft' && (
          <Block title="Done">
            <p className="text-sm text-gray-700">{pending ? 'Saving on this phone; it goes to the office with signal.' : 'Everything is saved.'}</p>
            <button type="button" className={`btn btn-primary ${BIG} w-full`} onClick={async () => { await submitTakeoff(t, me); toast.success('Takeoff sent to the office', hasSignal() ? '' : 'It goes as soon as there is signal.') }} data-takeoff-submit>
              <Check size={16} aria-hidden="true" /> Send to the office
            </button>
          </Block>
        )}

        {office && <ApproveBlock t={t} />}
      </div>
      {adding && <AddItemSheet t={t} onClose={() => setAdding(false)} />}
    </div>
  )
}

function Block({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap"><h2 className="text-base font-bold text-gray-900">{title}</h2>{sub && <span className="text-xs text-gray-500">{sub}</span>}</div>
      {children}
    </section>
  )
}

/** − value + with the value typeable (a pull sheet line can be 800 pickets). */
function Qty({ label, value, onChange, disabled, testId, step = 1 }: { label: string; value: number; onChange: (n: number) => void; disabled: boolean; testId: string; step?: number }) {
  const [text, setText] = useState(String(value))
  useEffect(() => { setText(String(value)) }, [value])
  const commit = (s: string) => { const v = Math.max(0, Math.round((Number(s) || 0) * 100) / 100); if (v !== value) onChange(v); else setText(String(value)) }
  return (
    <div className="min-w-0">
      <p className="text-xs text-gray-500 truncate">{label}</p>
      <div className="grid grid-cols-[48px_minmax(0,1fr)_48px] gap-1 items-center">
        <button type="button" className="w-12 h-12 grid place-items-center rounded-lg border border-gray-200 bg-white disabled:opacity-30" disabled={disabled || value <= 0} aria-label={`One less: ${label}`} onClick={() => onChange(Math.max(0, Math.round((value - step) * 100) / 100))} data-qty-minus={testId}><Minus size={18} /></button>
        <input inputMode="decimal" className="h-12 w-full min-w-0 text-center text-lg font-bold tabular-nums border border-gray-200 rounded-lg bg-white disabled:bg-gray-50" value={text} disabled={disabled}
          onChange={e => setText(e.target.value.replace(/[^\d.]/g, ''))} onBlur={e => commit(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} aria-label={label} data-qty-value={testId} />
        <button type="button" className="w-12 h-12 grid place-items-center rounded-lg border border-gray-200 bg-white disabled:opacity-30" disabled={disabled} aria-label={`One more: ${label}`} onClick={() => onChange(Math.round((value + step) * 100) / 100)} data-qty-plus={testId}><Plus size={18} /></button>
      </div>
    </div>
  )
}

function NoteBox({ value, disabled, onSave, testId }: { value: string; disabled: boolean; onSave: (v: string) => void; testId: string }) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  return <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base bg-white" rows={2} maxLength={2000} value={v} disabled={disabled} onChange={e => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v) }} data-note={testId} />
}

function LineRow({ t, line, job, photoUrl, readOnly }: { t: Takeoff; line: TakeoffLine; job: Job; photoUrl: (c: string | null) => string | null; readOnly: boolean }) {
  const [more, setMore] = useState(line.extra || line.shopReturnQty > 0 || line.vendorReturnQty > 0 || !!line.note || !!line.photoClientId)
  const file = useRef<HTMLInputElement | null>(null)
  const save = (patch: Partial<TakeoffLine>) => setLine(t, { ...line, ...patch })
  const d = Math.round((line.usedQty - line.plannedQty) * 100) / 100
  const src = photoUrl(line.photoClientId)
  async function picked(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    try {
      const m = await addCapture(f, { kind: 'photo', mime: baseMime(f.type || 'image/jpeg'), takenAt: new Date(f.lastModified || Date.now()).toISOString(), jobId: job.id, customerId: job.customerId ?? null, quoteKey: null, category: 'Completed', visibility: 'internal', caption: `Takeoff: ${line.part}` })
      await save({ photoClientId: m.clientId })
    } catch { toast.error('This phone did not keep that photo', 'Free up space and try again.') }
    if (file.current) file.current.value = ''
  }
  return (
    <div className={`rounded-xl bg-white border p-3 space-y-2 ${line.extra ? 'border-orange-300' : d !== 0 ? 'border-amber-300' : 'border-gray-200'}`} data-takeoff-line={line.id} data-takeoff-part={line.part}>
      <div className="flex items-start gap-2">
        <p className="flex-1 min-w-0 text-sm font-medium text-gray-900 break-words">{partWithPair(line.part)}</p>
        {line.extra && <span className="text-[11px] font-semibold rounded-full px-2 py-0.5 bg-orange-100 text-orange-800 shrink-0">{REASONS.find(r => r.key === line.reason)?.label ?? 'Added'}</span>}
      </div>
      {!line.extra && <p className="text-xs text-gray-600" data-takeoff-diff={d}>Pull sheet {fmtQty(line.plannedQty)} · {diffWords(d)}</p>}
      <Qty label="Used on the job" value={line.usedQty} onChange={v => save({ usedQty: v })} disabled={readOnly} testId={`used:${line.id}`} />
      <button type="button" className={`w-full ${BIG} flex items-center justify-between text-sm text-gray-700 px-1`} onClick={() => setMore(m => !m)} aria-expanded={more} data-takeoff-more={line.id}>
        <span>Returns, note, photo{line.shopReturnQty || line.vendorReturnQty ? ` · ${fmtQty(line.shopReturnQty + line.vendorReturnQty)} back` : ''}{line.photoClientId ? ' · photo' : ''}</span>
        {more ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
      </button>
      {more && (
        <div className="space-y-2">
          <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2">
            <Qty label="Back to the shop" value={line.shopReturnQty} onChange={v => save({ shopReturnQty: v })} disabled={readOnly} testId={`shop:${line.id}`} />
            <Qty label="Back to the vendor" value={line.vendorReturnQty} onChange={v => save({ vendorReturnQty: v })} disabled={readOnly} testId={`vendor:${line.id}`} />
          </div>
          <NoteBox value={line.note} disabled={readOnly} onSave={v => save({ note: v })} testId={`line:${line.id}`} />
          <div className="flex items-center gap-2">
            {src ? <img src={src} alt={line.part} className="w-16 h-16 rounded-lg object-cover bg-gray-100 shrink-0" data-takeoff-photo={line.id} /> : null}
            {!readOnly && <button type="button" className={`btn btn-secondary ${BIG} flex-1`} onClick={() => file.current?.click()} data-takeoff-photo-btn={line.id}><Camera size={16} aria-hidden="true" /> {src ? 'New photo' : 'Photo'}</button>}
            {!readOnly && line.extra && <button type="button" className={`btn btn-secondary ${BIG} text-red-700`} onClick={() => removeItem(t, line)} aria-label={`Remove ${line.part}`} data-takeoff-remove={line.id}><Trash2 size={16} /></button>}
          </div>
          <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={e => picked(e.target.files)} data-takeoff-file={line.id} />
        </div>
      )}
    </div>
  )
}

// ── Adding an item ────────────────────────────────────────────────────────────

function AddItemSheet({ t, onClose }: { t: Takeoff; onClose: () => void }) {
  useBackLayer(onClose, { key: 'takeoff-add' })
  const [q, setQ] = useState('')
  const [reason, setReason] = useState<'extra' | 'broken' | 'other'>('extra')
  const [items, setItems] = useState(() => getInventory())
  useEffect(() => { if (!items.length) initInventory().then(() => setItems(getInventory())).catch(() => {}) }, [items.length])
  const hits = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return items.filter(i => i.status !== 'inactive' && i.status !== 'discontinued' && words.every(w => `${i.name} ${i.category} ${i.sku ?? ''}`.toLowerCase().includes(w))).slice(0, 60)
  }, [items, q])
  async function pick(part: string, inventoryItemId: string | null) {
    const line = await addItem(t, { part, inventoryItemId, reason })
    toast.success('Added', line.part)
    onClose()
  }
  return (
    <div className="fixed inset-0 z-[80] bg-white flex flex-col" data-takeoff-add-sheet>
      <div className="border-b border-gray-200 pt-[env(safe-area-inset-top)]">
        <div className="max-w-[560px] mx-auto flex items-center gap-2 px-2 py-1.5">
          <button type="button" className="w-12 h-12 grid place-items-center text-gray-600 shrink-0" aria-label="Close" onClick={onClose}><X size={24} /></button>
          <p className="font-bold text-gray-900 flex-1">Add an item</p>
        </div>
        <div className="max-w-[560px] mx-auto px-3 pb-3 space-y-2">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" aria-hidden="true" />
            <input autoFocus type="search" className={`w-full border border-gray-300 rounded-lg pl-10 pr-3 ${BIG} text-base`} placeholder="Search Inventory: post, concrete, panel…" value={q} onChange={e => setQ(e.target.value)} data-takeoff-search />
          </div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Why">
            {REASONS.map(r => (
              <button key={r.key} type="button" role="radio" aria-checked={reason === r.key} className={`${BIG} rounded-lg border text-sm font-medium ${reason === r.key ? 'bg-orange-600 border-orange-600 text-white' : 'bg-white border-gray-300 text-gray-800'}`} onClick={() => setReason(r.key)} data-takeoff-reason={r.key}>{r.label}</button>
            ))}
          </div>
        </div>
      </div>
      <ul className="flex-1 overflow-y-auto max-w-[560px] w-full mx-auto divide-y divide-gray-100">
        {hits.map(i => (
          <li key={i.id}>
            <button type="button" className={`w-full text-left px-4 py-2 ${BIG}`} onClick={() => pick(i.name, i.id)} data-takeoff-item={i.id}>
              <span className="block text-sm text-gray-900 break-words">{i.name}</span>
              <span className="block text-xs text-gray-500">{i.category}</span>
            </button>
          </li>
        ))}
        {q.trim() && (
          <li>
            <button type="button" className={`w-full text-left px-4 py-2 ${BIG} text-orange-700 font-medium`} onClick={() => pick(q.trim(), null)} data-takeoff-free>Not in the list: add "{q.trim()}"</button>
          </li>
        )}
        {!hits.length && !q.trim() && <li className="px-4 py-6 text-sm text-gray-500">Type to search Inventory.</li>}
      </ul>
    </div>
  )
}

// ── Labor ─────────────────────────────────────────────────────────────────────

function LaborBlock({ t, readOnly, office }: { t: Takeoff; readOnly: boolean; office: boolean }) {
  const l = t.labor
  const save = (next: TakeoffLabor) => setLabor(t, next, t.installDate, t.note)
  return (
    <Block title="Labor" sub={l.mode === 'sub' ? 'Subcontractor' : `${crewHoursTotal(l)} crew hours`}>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Who did the install">
        {(['sub', 'crew'] as const).map(m => (
          <button key={m} type="button" role="radio" aria-checked={l.mode === m} disabled={readOnly} className={`${BIG} rounded-lg border text-sm font-medium ${l.mode === m ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-300 text-gray-800'}`} onClick={() => save({ ...l, mode: m })} data-takeoff-labor-mode={m}>
            {m === 'sub' ? 'Sub (paid per section)' : 'Our crew (hours)'}
          </button>
        ))}
      </div>
      {l.mode === 'sub' ? (
        <div className="space-y-2">
          <Qty label={l.subUnit === 'foot' ? 'Feet paid to the sub' : 'Sections paid to the sub'} value={l.subUnits} onChange={v => save({ ...l, subUnits: v })} disabled={readOnly} testId="sub-units" />
          {/* What the sub was paid is a cost: owner and office only (an installer's phone never shows a cost). */}
          {office && <SubPaidBox cents={l.subPaidCents ?? null} disabled={readOnly} onSave={c => save({ ...l, subPaidCents: c })} />}
        </div>
      ) : (
        <div className="space-y-2">
          {l.crew.map((c, i) => (
            <div key={c.id} className="rounded-lg bg-white border border-gray-200 p-2 space-y-2" data-takeoff-crew={c.id}>
              <div className="flex gap-2">
                <NameBox value={c.name} disabled={readOnly} onSave={name => save({ ...l, crew: l.crew.map((x, j) => (j === i ? { ...x, name } : x)) })} />
                {!readOnly && <button type="button" className="w-12 h-12 grid place-items-center rounded-lg border border-gray-200 text-red-700 shrink-0" aria-label="Remove this person" onClick={() => save({ ...l, crew: l.crew.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>}
              </div>
              <Qty label="Hours" value={c.hours} step={0.5} onChange={hours => save({ ...l, crew: l.crew.map((x, j) => (j === i ? { ...x, hours } : x)) })} disabled={readOnly} testId={`hours:${c.id}`} />
            </div>
          ))}
          {!readOnly && <button type="button" className={`btn btn-secondary ${BIG} w-full`} onClick={() => save({ ...l, crew: [...l.crew, { id: newId().slice(0, 18), name: '', hours: 8 }] })} data-takeoff-add-person><Plus size={16} aria-hidden="true" /> Add a person</button>}
        </div>
      )}
    </Block>
  )
}

/** "Sub paid $": what the sub was actually paid (blank: the sections paid x the sub rate saved at signing). */
function SubPaidBox({ cents, disabled, onSave }: { cents: number | null; disabled: boolean; onSave: (c: number | null) => void }) {
  const shown = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2))
  const [v, setV] = useState(shown(cents))
  useEffect(() => { setV(shown(cents)) }, [cents])
  const commit = () => {
    const t = v.trim()
    const next = t === '' ? null : Math.max(0, Math.round((Number(t) || 0) * 100))
    if (next !== cents) onSave(next); else setV(shown(cents))
  }
  return (
    <label className="block">
      <span className="text-xs text-gray-500">Sub paid $ (optional; blank uses the sections paid × the sub rate saved at signing)</span>
      <input inputMode="decimal" className={`w-full border border-gray-300 rounded-lg px-3 ${BIG} text-base bg-white disabled:bg-gray-50`} value={v} disabled={disabled}
        onChange={e => setV(e.target.value.replace(/[^\d.]/g, ''))} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        aria-label="Sub paid, dollars" data-takeoff-sub-paid />
    </label>
  )
}

function NameBox({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => { setV(value) }, [value])
  return <input className={`flex-1 min-w-0 border border-gray-300 rounded-lg px-3 ${BIG} text-base`} placeholder="Name" maxLength={100} value={v} disabled={disabled} onChange={e => setV(e.target.value)} onBlur={() => { if (v !== value) onSave(v) }} />
}

// ── Approve (owner and office) ────────────────────────────────────────────────

function ApproveBlock({ t }: { t: Takeoff }) {
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = takeoffPending(t)
  async function approve() {
    if (!hasSignal()) { toast.warning('Approving needs signal'); return }
    setBusy(true)
    const r = await approveTakeoff(t, Math.round((Number(other) || 0) * 100))
    setBusy(false)
    if (r.ok) toast.success('Takeoff approved', 'The actual cost is saved on the job.')
    else toast.error('Not approved', r.error)
  }
  async function reopen() {
    setBusy(true)
    const r = await reopenTakeoff(t)
    setBusy(false)
    if (!r.ok) toast.error('Could not reopen', r.error)
  }
  if (t.status === 'approved') {
    return (
      <Block title="Approved">
        <p className="text-sm text-gray-700">The actual cost is frozen. Reopen to change the takeoff; it is worked out again when approved.</p>
        <button type="button" className={`btn btn-secondary ${BIG} w-full`} disabled={busy} onClick={reopen} data-takeoff-reopen>Reopen</button>
      </Block>
    )
  }
  return (
    <Block title="Approve" sub="Owner and office">
      <label className="block">
        <span className="text-xs text-gray-500">Other labor pay, $ (gates, extra hours paid; optional)</span>
        <input inputMode="decimal" className={`w-full border border-gray-300 rounded-lg px-3 ${BIG} text-base bg-white`} value={other} onChange={e => setOther(e.target.value.replace(/[^\d.]/g, ''))} data-takeoff-other-labor />
      </label>
      <button type="button" className={`btn btn-primary ${BIG} w-full`} disabled={busy || pending} onClick={approve} data-takeoff-approve>
        {pending ? 'Saving the last changes…' : busy ? 'Approving…' : 'Approve takeoff'}
      </button>
    </Block>
  )
}
