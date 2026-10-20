/**
 * Final walkthrough on a job, phone first: the checklist (Pass or Needs
 * fixing, note, photo), the required photos (each side, each gate, one wide
 * shot; Customer visible), the punch list (fixed and re-photographed), and
 * two finger signatures with name, role, time and place. When the homeowner
 * is not there, the office sends them a link to sign on their own phone.
 * Once everything is in, the Certificate of Completion is made.
 *
 * Works with no signal: every change goes through the save queue
 * (walkthroughStore), photos through the media queue (mediaStore).
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Camera, Images, Check, AlertTriangle, PenLine, FileText, Copy, MessageSquare, Mail, ExternalLink, X, Minus, Plus, MapPin, Eye, EyeOff, Wrench } from 'lucide-react'
import type { Job } from './jobStore'
import { getQuotes } from './quoteStore'
import MediaCapture, { baseMime } from './MediaCapture'
import MarkupEditor from './MarkupEditor'
import { addCapture, localMedia, updateLocal, patchMedia, uploadMarkup, MEDIA_EVENT, type LocalMedia, type MediaMeta, type Visibility } from './mediaStore'
import { subscribe as outboxSubscribe, outboxVersion, hasSignal } from './outbox'
import { SaveStatus } from './SaveStatus'
import { SignaturePad } from './SignaturePad'
import { fetchCurrentUser } from './crmAuth'
import { getConfig } from './configStore'
import { smsLink, mailtoLink } from './appointmentLogic'
import { toast } from './toast'
import { useBackLayer } from './nav'
import {
  loadWalkthrough, getWalkthrough, startWalkthrough, setItem, setCounts, setSlotPhoto, fixPunch, sign, finishWalkthrough, homeownerLink, turnOffLink,
  certificateBlob, walkthroughUrl, photoSrc, missingNow, walkPending, isWalkOp, walkVersion, WALKTHROUGH_EVENT, ROLES, CATEGORY_LABEL, locationText,
  type Walkthrough, type PhotoSlot, type PunchItem, type Signature, type WalkItem,
} from './walkthroughStore'

// ── Data hooks ────────────────────────────────────────────────────────────────

function useWalk(jobId: string): Walkthrough | null | undefined {
  const sub = useCallback((f: () => void) => { window.addEventListener(WALKTHROUGH_EVENT, f); const off = outboxSubscribe(f); return () => { window.removeEventListener(WALKTHROUGH_EVENT, f); off() } }, [])
  useSyncExternalStore(sub, () => `${outboxVersion()}:${walkVersion()}`)
  return getWalkthrough(jobId)
}

/** Photos taken on this phone and not uploaded yet, by their phone id. */
function useLocalPhotos(jobId: string): Map<string, { m: LocalMedia; url: string }> {
  const [map, setMap] = useState(new Map<string, { m: LocalMedia; url: string }>())
  useEffect(() => {
    let alive = true
    const urls: string[] = []
    const read = () => localMedia({ jobId }).then(list => {
      if (!alive) return
      const next = new Map<string, { m: LocalMedia; url: string }>()
      for (const m of list) { const u = URL.createObjectURL(m.markupBlob ?? m.blob); urls.push(u); next.set(m.clientId, { m, url: u }) }
      setMap(next)
    }).catch(() => {})
    read()
    window.addEventListener(MEDIA_EVENT, read)
    return () => { alive = false; window.removeEventListener(MEDIA_EVENT, read); urls.forEach(u => URL.revokeObjectURL(u)) }
  }, [jobId])
  return map
}

/** Where the phone is, when allowed (8 seconds at most); null means "location not shared". */
function whereAmI(): Promise<{ lat: number; lng: number; accuracyM: number } | null> {
  return new Promise(res => {
    if (!navigator.geolocation) { res(null); return }
    let done = false
    const finish = (v: { lat: number; lng: number; accuracyM: number } | null) => { if (!done) { done = true; res(v) } }
    navigator.geolocation.getCurrentPosition(p => finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }), () => finish(null), { timeout: 8000, maximumAge: 60_000 })
    setTimeout(() => finish(null), 9000)
  })
}

const when = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const BIG = 'min-h-[48px]'

// ── On the job's detail panel ─────────────────────────────────────────────────

export default function FinalWalkthroughPanel({ job }: { job: Job }) {
  const w = useWalk(job.id)
  const [open, setOpen] = useState(false)
  const [me, setMe] = useState<string | null>(null)
  useEffect(() => { loadWalkthrough(job.id) }, [job.id])
  useEffect(() => { fetchCurrentUser().then(u => setMe(u ? `${u.firstName} ${u.lastName}`.trim() : null)).catch(() => {}) }, [])
  // Opened from a link or a reload (?walkthrough=<job>): open it again.
  useEffect(() => { if (new URLSearchParams(window.location.search).get('walkthrough') === job.id) setOpen(true) }, [job.id])

  async function start() {
    const quote = job.quoteId ? getQuotes().find(q => q.id === job.quoteId) : undefined
    await startWalkthrough({ id: job.id, fenceStyle: job.fenceStyle, walkGates: job.walkGates, dblGates: job.dblGates }, { layout: quote?.layout?.yard ?? null, runCount: quote?.runs?.length, by: me })
    setOpen(true)
  }

  const missing = w ? missingNow(w) : []
  const marked = w ? w.items.filter(i => i.result).length : 0
  const openPunch = w ? w.punch.filter(p => p.status === 'open').length : 0
  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-2" data-walkthrough-panel={w ? w.status : 'none'}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Final walkthrough</h3>
        {w && <SaveStatus keys={[]} also={isWalkOp(w.id)} quietWhenSaved />}
      </div>
      {w === undefined && <p className="text-xs text-gray-500">Loading…</p>}
      {w === null && <p className="text-xs text-gray-600">Walk the job with the homeowner: checklist, photos of each side and gate, and both signatures. Makes the Certificate of Completion.</p>}
      {w && w.status === 'open' && (
        <p className="text-xs text-gray-700" data-walkthrough-summary>
          {CATEGORY_LABEL[w.category]} checklist: {marked} of {w.items.length} checked
          {openPunch ? ` · ${openPunch} to fix` : ''}{missing.length ? ` · ${missing.length} thing${missing.length === 1 ? '' : 's'} left` : ' · ready to finish'}
        </p>
      )}
      {w && w.status === 'completed' && (
        <p className="text-xs text-green-800 bg-green-50 border border-green-200 rounded-lg px-2 py-1.5" data-walkthrough-done>
          Finished {w.completedAt ? when(w.completedAt) : ''}. Certificate saved to the job and the customer portal.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {w === null && <button type="button" className={`btn btn-primary ${BIG} flex-1`} onClick={start} data-walkthrough-start>Start final walkthrough</button>}
        {w && <button type="button" className={`btn ${w.status === 'open' ? 'btn-primary' : 'btn-secondary'} ${BIG} flex-1`} onClick={() => setOpen(true)} data-walkthrough-open>{w.status === 'open' ? 'Open walkthrough' : 'View walkthrough'}</button>}
        {w?.hasCertificate && <CertificateButton w={w} />}
      </div>
      {w && w.status === 'open' && !w.homeownerSig && <SendToHomeowner w={w} job={job} compact />}
      {open && w && <WalkthroughScreen w={w} job={job} me={me} onClose={() => setOpen(false)} />}
    </div>
  )
}

function CertificateButton({ w }: { w: Walkthrough }) {
  const [busy, setBusy] = useState(false)
  async function openIt() {
    // Opened first (a phone allows a new tab only straight from the tap), then filled.
    const tab = window.open('', '_blank')
    setBusy(true)
    const b = await certificateBlob(w)
    setBusy(false)
    if (!b) { tab?.close(); toast.error('Could not open the certificate', 'Check the connection and try again.'); return }
    const u = URL.createObjectURL(b)
    if (tab) tab.location.href = u; else window.location.href = u
  }
  return <button type="button" className={`btn btn-secondary ${BIG}`} disabled={busy} onClick={openIt} data-walkthrough-certificate><FileText size={16} aria-hidden="true" /> Certificate of Completion</button>
}

// ── The walkthrough screen ───────────────────────────────────────────────────

function WalkthroughScreen({ w, job, me, onClose }: { w: Walkthrough; job: Job; me: string | null; onClose: () => void }) {
  useBackLayer(onClose, { key: 'walkthrough', params: { walkthrough: job.id } })
  const local = useLocalPhotos(job.id)
  const done = w.status === 'completed'
  const pending = walkPending(w)
  const missing = missingNow(w)
  const [finishing, setFinishing] = useState(false)
  const [serverMissing, setServerMissing] = useState<string[] | null>(null)
  const tried = useRef('')

  // Photos finishing their upload change what is missing: look again.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null
    const again = () => { if (t) clearTimeout(t); t = setTimeout(() => { loadWalkthrough(job.id) }, 1200) }
    window.addEventListener(MEDIA_EVENT, again)
    const every = setInterval(() => loadWalkthrough(job.id), 20_000)
    return () => { window.removeEventListener(MEDIA_EVENT, again); clearInterval(every); if (t) clearTimeout(t) }
  }, [job.id])

  const finish = useCallback(async (quiet = false) => {
    if (!hasSignal()) { if (!quiet) toast.warning('Finishing needs signal', 'Everything is saved on this phone. Finish once there is signal.'); return }
    setFinishing(true)
    const r = await finishWalkthrough(w)
    setFinishing(false)
    if (r.ok) { toast.success('Walkthrough finished', 'The Certificate of Completion is saved to the job and the customer portal.'); setServerMissing(null) }
    else { setServerMissing(r.missing ?? null); if (!quiet) toast.error('Not ready to finish', r.missing?.join(' · ') ?? r.error) }
  }, [w])

  // Everything in and saved: finish by itself (once for each state of the record).
  useEffect(() => {
    const stamp = `${w.id}:${w.photos.map(p => p.clientId).join()}:${Object.keys(w.media).length}`
    if (!done && !pending && missing.length === 0 && tried.current !== stamp) { tried.current = stamp; void finish(true) }
  }, [done, pending, missing.length, w, finish])

  const photoUrl = (cid: string | null) => (cid ? (w.media[cid] ? photoSrc(w.media[cid]) : local.get(cid)?.url ?? null) : null)
  const sideSlots = w.photos.filter(s => s.kind === 'side'), gateSlots = w.photos.filter(s => s.kind === 'gate')
  const byCount = w.photos.some(s => /^side:\d+$/.test(s.key))

  return (
    <div className="fixed inset-0 z-[70] bg-gray-50 overflow-y-auto" data-walkthrough-screen={w.status}>
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 pt-[env(safe-area-inset-top)]">
        <div className="max-w-[560px] mx-auto flex items-center gap-2 px-2 py-1.5">
          <button type="button" className="w-12 h-12 grid place-items-center text-gray-600" aria-label="Close the walkthrough" onClick={onClose}><X size={24} /></button>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 truncate">Final walkthrough</p>
            <p className="text-xs text-gray-500 truncate">{job.customerName} · {CATEGORY_LABEL[w.category]}</p>
          </div>
          <SaveStatus keys={[]} also={isWalkOp(w.id)} />
        </div>
      </div>

      <div className="max-w-[560px] mx-auto px-3 py-4 space-y-5 pb-24">
        {done && (
          <div className="rounded-xl bg-green-50 border border-green-200 p-3 space-y-2" data-walkthrough-finished>
            <p className="font-semibold text-green-900">Finished {w.completedAt ? when(w.completedAt) : ''}</p>
            <p className="text-sm text-green-900">The Certificate of Completion is saved to the job and the customer portal.</p>
            {w.hasCertificate && <CertificateButton w={w} />}
          </div>
        )}

        <Block title="Checklist" sub={`${w.items.filter(i => i.result).length} of ${w.items.length} checked`}>
          {w.items.map(i => <ItemRow key={i.id} w={w} item={i} job={job} photoUrl={photoUrl} readOnly={done} />)}
        </Block>

        {w.punch.length > 0 && (
          <Block title="Punch list" sub={`${w.punch.filter(p => p.status === 'open').length} open`}>
            <p className="text-xs text-gray-600">The walkthrough stays open until each is fixed and photographed again.</p>
            {w.punch.map(p => <PunchRow key={p.id} w={w} p={p} job={job} me={me} photoUrl={photoUrl} readOnly={done} />)}
          </Block>
        )}

        <Block title="Required photos" sub="Each side, each gate, and one wide shot">
          {byCount && !done && (
            <div className="grid grid-cols-2 gap-2" data-walkthrough-counts>
              <Stepper label="Sides" value={sideSlots.length} min={1} onChange={n => setCounts(w, n, gateSlots.length)} />
              <Stepper label="Gates" value={gateSlots.length} min={0} onChange={n => setCounts(w, sideSlots.length, n)} />
            </div>
          )}
          {w.photos.map(s => <SlotRow key={s.key} w={w} slot={s} job={job} photoUrl={photoUrl} local={local} readOnly={done} />)}
        </Block>

        <Block title="Signatures">
          <SignBlock w={w} who="rep" defaultName={me ?? ''} readOnly={done} />
          <SignBlock w={w} who="homeowner" defaultName={job.customerName} readOnly={done} />
          {!w.homeownerSig && !done && (
            <div className="rounded-lg border border-dashed border-gray-300 p-3">
              <p className="text-sm font-semibold text-gray-800">Homeowner not here?</p>
              <p className="text-xs text-gray-600 mb-2">Send them a link to see the checklist and photos and sign on their own phone.</p>
              <SendToHomeowner w={w} job={job} />
            </div>
          )}
        </Block>

        {!done && (
          <Block title="Finish">
            {missing.length > 0 ? (
              <ul className="space-y-1" data-walkthrough-missing>
                {missing.map(m => <li key={m} className="text-sm text-gray-800 flex gap-2"><AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />{m}</li>)}
              </ul>
            ) : pending ? <p className="text-sm text-gray-700">Saving the last changes; it finishes once they are on the server.</p>
              : <p className="text-sm text-green-800">Everything is in.</p>}
            {serverMissing && serverMissing.length > 0 && missing.length === 0 && <p className="text-xs text-amber-800">The office copy still needs: {serverMissing.join(' · ')}</p>}
            <button type="button" className={`btn btn-primary ${BIG} w-full`} disabled={finishing || missing.length > 0} onClick={() => finish(false)} data-walkthrough-finish>
              {finishing ? 'Finishing…' : 'Finish and make the certificate'}
            </button>
          </Block>
        )}
      </div>
    </div>
  )
}

function Block({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-2"><h2 className="text-base font-bold text-gray-900">{title}</h2>{sub && <span className="text-xs text-gray-500">{sub}</span>}</div>
      {children}
    </section>
  )
}

function Stepper({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (n: number) => void }) {
  return (
    <div className="rounded-lg bg-white border border-gray-200 p-2">
      <p className="text-xs text-gray-500">{label}</p>
      <div className="flex items-center justify-between">
        <button type="button" className="w-12 h-12 grid place-items-center rounded-lg border border-gray-200 disabled:opacity-30" disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`} onClick={() => onChange(value - 1)} data-stepper={`${label}-minus`}><Minus size={18} /></button>
        <span className="text-xl font-bold tabular-nums" data-stepper-value={label}>{value}</span>
        <button type="button" className="w-12 h-12 grid place-items-center rounded-lg border border-gray-200 disabled:opacity-30" disabled={value >= 30} aria-label={`More ${label.toLowerCase()}`} onClick={() => onChange(value + 1)} data-stepper={`${label}-plus`}><Plus size={18} /></button>
      </div>
    </div>
  )
}

// ── A photo: the in-app camera, or one from the phone ──────────────────────────

type Shot = { caption: string; visibility: Visibility }

function PhotoButtons({ job, shot, onPhoto, testId, label = 'Take photo' }: { job: Job; shot: Shot; onPhoto: (clientId: string) => void; testId: string; label?: string }) {
  const [camera, setCamera] = useState(false)
  const file = useRef<HTMLInputElement | null>(null)
  const where = { jobId: job.id, customerId: job.customerId ?? null, quoteKey: null }
  const meta = (m: Pick<MediaMeta, 'kind' | 'mime' | 'takenAt'>): MediaMeta => ({ ...where, ...m, category: 'Completed', visibility: shot.visibility, caption: shot.caption })
  async function picked(files: FileList | null) {
    const f = files?.[0]
    if (!f) return
    try {
      const m = await addCapture(f, meta({ kind: 'photo', mime: baseMime(f.type || 'image/jpeg'), takenAt: new Date(f.lastModified || Date.now()).toISOString() }))
      onPhoto(m.clientId)
    } catch { toast.error('This phone did not keep that photo', 'Free up space and try again.') }
    if (file.current) file.current.value = ''
  }
  async function taken(list: LocalMedia[]) {
    setCamera(false)
    const last = [...list].reverse().find(m => m.meta.kind === 'photo')
    if (!last) return
    await updateLocal(last.clientId, { meta: { ...last.meta, category: 'Completed', visibility: shot.visibility, caption: shot.caption } })
    onPhoto(last.clientId)
  }
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={`btn btn-secondary ${BIG}`} onClick={() => setCamera(true)} data-wt-camera={testId}><Camera size={16} aria-hidden="true" /> {label}</button>
        <button type="button" className={`btn btn-secondary ${BIG}`} onClick={() => file.current?.click()}><Images size={16} aria-hidden="true" /> Choose</button>
      </div>
      <input ref={file} type="file" accept="image/*" hidden onChange={e => picked(e.target.files)} data-wt-file={testId} />
      {camera && <MediaCapture where={where} defaultCategory="Completed" onDone={taken} onClose={() => setCamera(false)} />}
    </>
  )
}

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  return src ? <img src={src} alt={alt} className="w-20 h-20 rounded-lg object-cover bg-gray-100 shrink-0" /> : <span className="w-20 h-20 rounded-lg bg-gray-100 grid place-items-center text-gray-400 shrink-0"><Camera size={22} /></span>
}

// ── Checklist item ────────────────────────────────────────────────────────────

function ItemRow({ w, item, job, photoUrl, readOnly }: { w: Walkthrough; item: WalkItem; job: Job; photoUrl: (c: string | null) => string | null; readOnly: boolean }) {
  const [note, setNote] = useState(item.note)
  const [more, setMore] = useState(!!item.note || !!item.photoClientId)
  useEffect(() => { setNote(item.note) }, [item.note])
  const save = (patch: Partial<Pick<WalkItem, 'result' | 'note' | 'photoClientId'>>) => setItem(w, item.id, { result: item.result, note, photoClientId: item.photoClientId, ...patch })
  const src = photoUrl(item.photoClientId)
  return (
    <div className={`rounded-xl bg-white border p-3 space-y-2 ${item.result === 'fix' ? 'border-amber-300' : item.result === 'pass' ? 'border-green-300' : 'border-gray-200'}`} data-wt-item={item.id} data-wt-result={item.result ?? ''}>
      <p className="text-sm font-medium text-gray-900">{item.label}</p>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={readOnly} onClick={() => save({ result: 'pass' })} data-wt-pass={item.id}
          className={`${BIG} rounded-lg text-sm font-semibold border flex items-center justify-center gap-1 ${item.result === 'pass' ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300'}`}><Check size={16} aria-hidden="true" /> Pass</button>
        <button type="button" disabled={readOnly} onClick={() => { setMore(true); save({ result: 'fix' }) }} data-wt-fix={item.id}
          className={`${BIG} rounded-lg text-sm font-semibold border flex items-center justify-center gap-1 ${item.result === 'fix' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white text-gray-700 border-gray-300'}`}><Wrench size={16} aria-hidden="true" /> Needs fixing</button>
      </div>
      {!more && !readOnly && <button type="button" className={`text-sm text-[color:var(--color-brand)] font-semibold ${BIG}`} onClick={() => setMore(true)}>Add a note or photo</button>}
      {(more || readOnly) && (
        <div className="space-y-2">
          {readOnly ? (item.note && <p className="text-sm text-gray-700">{item.note}</p>) : (
            <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[48px]" rows={2} placeholder={item.result === 'fix' ? 'What needs fixing' : 'Note (optional)'}
              value={note} onChange={e => setNote(e.target.value)} onBlur={() => { if (note !== item.note) save({ note }) }} data-wt-note={item.id} />
          )}
          {src && <Thumb src={src} alt={item.label} />}
          {!readOnly && <PhotoButtons job={job} shot={{ caption: `Final walkthrough: ${item.label}`, visibility: 'internal' }} onPhoto={c => save({ photoClientId: c })} testId={`item-${item.id}`} label={item.photoClientId ? 'Retake' : 'Photo'} />}
        </div>
      )}
    </div>
  )
}

// ── Punch item ────────────────────────────────────────────────────────────────

function PunchRow({ w, p, job, me, photoUrl, readOnly }: { w: Walkthrough; p: PunchItem; job: Job; me: string | null; photoUrl: (c: string | null) => string | null; readOnly: boolean }) {
  const [fixNote, setFixNote] = useState(p.fixNote)
  const [photo, setPhoto] = useState<string | null>(p.fixPhotoClientId)
  const fixed = p.status === 'fixed'
  return (
    <div className={`rounded-xl bg-white border p-3 space-y-2 ${fixed ? 'border-green-300' : 'border-amber-300'}`} data-wt-punch={p.itemId} data-wt-punch-status={p.status}>
      <div className="flex items-start gap-2">
        <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${fixed ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>{fixed ? 'Fixed' : 'To fix'}</span>
        <div className="flex-1"><p className="text-sm font-medium">{p.label}</p>{p.note && <p className="text-xs text-gray-600">{p.note}</p>}</div>
      </div>
      {fixed ? (
        <div className="flex gap-2 items-center">
          <Thumb src={photoUrl(p.fixPhotoClientId)} alt={`Fixed: ${p.label}`} />
          <p className="text-xs text-gray-600">{p.fixNote}{p.fixedAt ? ` · ${when(p.fixedAt)}` : ''}{p.fixedBy ? ` · ${p.fixedBy}` : ''}</p>
        </div>
      ) : !readOnly && (
        <>
          {photo && <Thumb src={photoUrl(photo)} alt="The fix" />}
          <PhotoButtons job={job} shot={{ caption: `Fixed: ${p.label}`, visibility: 'customer' }} onPhoto={setPhoto} testId={`punch-${p.itemId}`} label={photo ? 'Retake' : 'Photo of the fix'} />
          <input className="w-full border border-gray-300 rounded-lg px-3 text-base min-h-[48px]" placeholder="What was done (optional)" value={fixNote} onChange={e => setFixNote(e.target.value)} />
          <button type="button" className={`btn btn-primary ${BIG} w-full`} disabled={!photo} onClick={() => photo && fixPunch(w, p, photo, fixNote, me)} data-wt-punch-fixed={p.itemId}>
            {photo ? 'Mark fixed' : 'Take a photo of the fix first'}
          </button>
        </>
      )}
    </div>
  )
}

// ── Required photo ────────────────────────────────────────────────────────────

function SlotRow({ w, slot, job, photoUrl, local, readOnly }: { w: Walkthrough; slot: PhotoSlot; job: Job; photoUrl: (c: string | null) => string | null; local: Map<string, { m: LocalMedia; url: string }>; readOnly: boolean }) {
  const [markup, setMarkup] = useState(false)
  const cid = slot.clientId
  const src = photoUrl(cid)
  const server = cid ? w.media[cid] : undefined
  const mine = cid ? local.get(cid) : undefined
  const visibility = (server?.visibility ?? mine?.m.meta.visibility ?? 'customer') as Visibility
  const state = !cid ? 'needed' : server ? 'uploaded' : 'waiting'
  async function setVisibility(v: Visibility) {
    if (server) { await patchMedia(server.id, { visibility: v }); await loadWalkthrough(job.id) }
    else if (mine) await updateLocal(mine.m.clientId, { meta: { ...mine.m.meta, visibility: v } })
  }
  async function saveMarkup(blob: Blob) {
    setMarkup(false)
    if (server) { if (!(await uploadMarkup(server.id, blob))) toast.error('Could not save the markup', 'Check the connection and try again.'); await loadWalkthrough(job.id) }
    else if (mine) await updateLocal(mine.m.clientId, { markupBlob: blob })
  }
  return (
    <div className="rounded-xl bg-white border border-gray-200 p-3 space-y-2" data-wt-slot={slot.key} data-wt-slot-state={state}>
      <div className="flex gap-3 items-start">
        <Thumb src={src} alt={slot.label} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900">{slot.label}</p>
          <p className="text-xs text-gray-500">{state === 'needed' ? 'Photo needed' : state === 'waiting' ? 'On this phone, uploading when there is signal' : 'Uploaded'}</p>
          {cid && (
            <button type="button" disabled={readOnly && !server} onClick={() => setVisibility(visibility === 'customer' ? 'internal' : 'customer')} data-wt-visibility={slot.key}
              className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold rounded-full px-3 min-h-[40px] ${visibility === 'customer' ? 'bg-purple-50 text-purple-800' : 'bg-gray-100 text-gray-700'}`}>
              {visibility === 'customer' ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}{visibility === 'customer' ? 'Customer visible' : 'Internal only'}
            </button>
          )}
        </div>
      </div>
      {!readOnly && (
        <>
          <PhotoButtons job={job} shot={{ caption: `Final walkthrough: ${slot.label}`, visibility: 'customer' }} onPhoto={c => setSlotPhoto(w, slot, c)} testId={`slot-${slot.key}`} label={cid ? 'Retake' : 'Take photo'} />
          {src && <button type="button" className={`btn btn-quiet ${BIG} w-full`} onClick={() => setMarkup(true)} data-wt-markup={slot.key}><PenLine size={16} aria-hidden="true" /> Mark up</button>}
        </>
      )}
      {markup && src && <MarkupEditor src={server ? API_URL(server) : src} onSave={saveMarkup} onClose={() => setMarkup(false)} />}
    </div>
  )
}
/** The original (not a marked up copy) to draw on. */
const API_URL = (m: { url: string }) => photoSrc({ ...m, markupUrl: null, thumbUrl: null } as any)

// ── Signatures ────────────────────────────────────────────────────────────────

// The finger signature pad lives in SignaturePad.tsx (the customer portal signs change orders with it too).
export { SignaturePad }

function SignBlock({ w, who, defaultName, readOnly }: { w: Walkthrough; who: 'homeowner' | 'rep'; defaultName: string; readOnly: boolean }) {
  const s = who === 'rep' ? w.repSig : w.homeownerSig
  const [again, setAgain] = useState(false)
  const [name, setName] = useState(defaultName)
  const [role, setRole] = useState<string>(who === 'rep' ? '' : 'Homeowner')
  const [ink, setInk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (!name && defaultName) setName(defaultName) }, [defaultName])  // eslint-disable-line react-hooks/exhaustive-deps
  const title = who === 'rep' ? 'Our representative' : 'Homeowner'
  async function save() {
    if (!name.trim()) { toast.error('Type the name'); return }
    if (who === 'rep' && !role) { toast.error('Choose the role'); return }
    if (!ink) { toast.error('Sign in the box'); return }
    setBusy(true)
    const at = await whereAmI()
    const sig: Signature = { name: name.trim(), role: who === 'rep' ? role : 'Homeowner', signedAt: new Date().toISOString(), lat: at?.lat ?? null, lng: at?.lng ?? null, accuracyM: at?.accuracyM ?? null, image: ink, via: 'device' }
    await sign(w, who, sig)
    setBusy(false); setAgain(false); setInk(null)
  }
  if (s && !again) {
    return (
      <div className="rounded-xl bg-white border border-green-300 p-3 space-y-1" data-wt-signed={who}>
        <p className="text-xs font-semibold text-gray-500">{title}</p>
        <img src={s.image} alt={`Signature of ${s.name}`} className="h-16 object-contain" />
        <p className="text-sm font-semibold text-gray-900">{s.name}{s.role !== 'Homeowner' ? `, ${s.role}` : ''}</p>
        <p className="text-xs text-gray-600 flex items-center gap-1"><MapPin size={12} aria-hidden="true" />{when(s.signedAt)} · {locationText(s)}{s.via === 'link' ? ' · signed on their phone' : ''}</p>
        {!readOnly && <button type="button" className={`text-sm text-gray-600 underline ${BIG}`} onClick={() => setAgain(true)}>Sign again</button>}
      </div>
    )
  }
  if (readOnly) return null
  return (
    <div className="rounded-xl bg-white border border-gray-200 p-3 space-y-2" data-wt-sign={who}>
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      {who === 'rep' && (
        <div className="grid gap-2" role="radiogroup" aria-label="Role">
          {ROLES.map(r => (
            <button key={r} type="button" role="radio" aria-checked={role === r} onClick={() => setRole(r)} data-wt-role={r}
              className={`${BIG} rounded-lg border text-sm font-medium px-3 text-left ${role === r ? 'border-[color:var(--color-brand)] bg-purple-50 text-purple-900' : 'border-gray-300 text-gray-700'}`}>{r}</button>
          ))}
        </div>
      )}
      <label className="block text-xs text-gray-600">Name
        <input className="mt-1 w-full border border-gray-300 rounded-lg px-3 text-base min-h-[48px]" value={name} onChange={e => setName(e.target.value)} autoComplete="name" data-wt-sign-name={who} />
      </label>
      <SignaturePad onChange={setInk} />
      <p className="text-xs text-gray-500">The date, time and place (if this phone allows location) are recorded with the signature.</p>
      <button type="button" className={`btn btn-primary ${BIG} w-full`} disabled={busy} onClick={save} data-wt-sign-save={who}>{busy ? 'Saving…' : `Save ${who === 'rep' ? 'our' : "homeowner's"} signature`}</button>
    </div>
  )
}

// ── Homeowner's link ──────────────────────────────────────────────────────────

function SendToHomeowner({ w, job, compact = false }: { w: Walkthrough; job: Job; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [url, setUrl] = useState<string | null>(w.link && !w.link.state ? walkthroughUrl(w.link.token) : null)
  const cfg = getConfig()
  const company = cfg.company?.name || 'Getter Done Fence'
  const first = (job.customerName || '').split(' ')[0] || 'there'
  const message = (u: string) => `Hi ${first}, here is the final walkthrough for your new fence from ${company}: the checklist and photos. Please look it over and sign on your phone: ${u}`
  async function link(): Promise<string | null> {
    if (url) return url
    if (!hasSignal()) { toast.warning('Making the link needs signal'); return null }
    setBusy(true)
    const l = await homeownerLink(w)
    setBusy(false)
    if (!l) { toast.error('Could not make the link', 'Check the connection and try again.'); return null }
    const u = walkthroughUrl(l.token)
    setUrl(u)
    return u
  }
  async function go(kind: 'open' | 'copy' | 'text' | 'email') {
    const u = await link()
    if (!u) return
    if (kind === 'open') window.open(u, '_blank', 'noopener')
    // Texts and emails go from this phone's own apps: nothing is sent by a service.
    if (kind === 'text') window.location.href = smsLink(job.customerPhone || '', message(u))
    if (kind === 'email') window.location.href = mailtoLink(job.customerEmail || '', `Your final walkthrough from ${company}`, message(u))
    if (kind === 'copy') { await navigator.clipboard?.writeText(u).catch(() => {}); toast.success('Link copied') }
  }
  async function off() {
    if (!window.confirm('Turn off this link? The homeowner will see a page asking them to call you. Sending it again makes a new link.')) return
    setBusy(true)
    const ok = await turnOffLink(w)
    setBusy(false)
    if (ok) { setUrl(null); toast.success('Link turned off') } else toast.error('Could not turn the link off. Try again.')
  }
  const day = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const state = w.link?.state === 'off' ? 'Link turned off. Sending it again makes a new link.'
    : w.link?.state === 'expired' ? 'Link ran out. Sending it again makes a new link.'
    : w.link?.expiresAt ? `Link works until ${day(w.link.expiresAt)}.` : 'No link sent yet.'
  return (
    <div className="space-y-2" data-walkthrough-send>
      {compact && <p className="text-xs font-semibold text-gray-700">Homeowner's signature: send a link</p>}
      {!cfg.proposal?.publicLinks && !compact && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">Right now links open only on your own phones and computers. Once outside access is set up, turn it on in Settings → Proposals.</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={`btn btn-secondary ${BIG}`} disabled={busy} onClick={() => go('copy')} data-wt-link-copy><Copy size={16} aria-hidden="true" /> Copy link</button>
        <button type="button" className={`btn btn-secondary ${BIG}`} disabled={busy} onClick={() => go('open')} data-wt-link-open><ExternalLink size={16} aria-hidden="true" /> Open</button>
        <button type="button" className={`btn btn-primary ${BIG}`} disabled={busy || !job.customerPhone} onClick={() => go('text')} data-wt-link-text><MessageSquare size={16} aria-hidden="true" /> Text it</button>
        <button type="button" className={`btn btn-secondary ${BIG}`} disabled={busy || !job.customerEmail} onClick={() => go('email')}><Mail size={16} aria-hidden="true" /> Email it</button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-600" data-wt-link-state>{state}</p>
        {w.link && !w.link.state && <button type="button" className={`btn btn-quiet btn-sm ${BIG}`} disabled={busy} onClick={off} data-wt-link-off>Turn off link</button>}
      </div>
      {url && <p className="text-xs text-gray-500 break-all" data-wt-link-url>{url}</p>}
    </div>
  )
}
