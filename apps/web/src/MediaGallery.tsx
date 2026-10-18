/**
 * Photos and video on a quote, job or customer: take them with the in-app
 * camera or pick many from the phone's gallery, see what is still waiting to
 * upload, and open one to caption it, set who can see it, mark it up or pin
 * it to the site plan.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Images, Play, Check, CloudOff, MapPin } from 'lucide-react'
import MediaCapture, { baseMime } from './MediaCapture'
import MarkupEditor from './MarkupEditor'
import PinStep, { planAngle } from './PinStep'
import {
  addCapture, localMedia, listMedia, patchMedia, updateLocal, uploadMarkup, deleteMedia, discardLocal, uploadAll, uploadProgress, storageWarning,
  CATEGORIES, VISIBILITY_LABEL, MEDIA_EVENT, type Category, type LocalMedia, type ServerMedia, type MediaPin, type Visibility,
} from './mediaStore'
import { autoCaption } from './autoCaption'
import { fetchCurrentUser } from './crmAuth'
import type { YardLayout } from './yardLayout'
import { useBackLayer } from './nav'
import { can } from './permissions'

export type Where = { quoteKey?: string; jobId?: string; customerId?: string }

/** One item to show: still on the phone, or on the Mac. */
export interface ShownMedia {
  key: string
  local?: LocalMedia
  server?: ServerMedia
  kind: 'photo' | 'video'
  thumb: string
  full: string
  marked: string | null
  caption: string
  category: string
  visibility: Visibility
  pin: MediaPin | null
  takenAt: string
  takenBy: string | null
  uploaded: boolean
  heading: number | null
}

const objectUrls = new Map<Blob, string>()
const urlFor = (b: Blob) => { let u = objectUrls.get(b); if (!u) { u = URL.createObjectURL(b); objectUrls.set(b, u) } return u }

function shownLocal(m: LocalMedia, me: string | null): ShownMedia {
  const u = urlFor(m.blob)
  return {
    key: m.clientId, local: m, kind: m.meta.kind, thumb: m.meta.kind === 'photo' ? u : '', full: u,
    marked: m.markupBlob ? urlFor(m.markupBlob) : null, caption: m.meta.caption ?? '', category: m.meta.category ?? 'Site walk',
    visibility: m.meta.visibility ?? 'internal', pin: m.meta.pin ?? null, takenAt: m.meta.takenAt, takenBy: me, uploaded: false, heading: m.meta.heading ?? null,
  }
}
function shownServer(m: ServerMedia): ShownMedia {
  return {
    key: m.clientId, server: m, kind: m.kind, thumb: m.thumbUrl ?? (m.kind === 'photo' ? m.url : ''), full: m.kind === 'video' ? (m.previewUrl ?? m.url) : m.url,
    marked: m.markupUrl, caption: m.caption ?? '', category: m.category ?? 'Site walk', visibility: (m.visibility ?? 'internal') as Visibility,
    pin: (m.pin as MediaPin) ?? null, takenAt: m.takenAt, takenBy: m.takenBy, uploaded: true, heading: m.heading ?? null,
  }
}

export default function MediaGallery({ where, layout, onLayout, defaultCategory = 'Site walk', title = 'Photos and video', onItems, openKey, onOpened, cameraSignal }: {
  where: Where
  layout?: YardLayout | null
  onLayout?: (l: YardLayout) => void
  defaultCategory?: Category
  title?: string
  /** Every item, for drawing pins on the plan. */
  onItems?: (items: ShownMedia[]) => void
  /** Open these items' viewer (a pin was tapped on the plan). */
  openKey?: string | null
  onOpened?: () => void
  /** Opens the camera each time it changes (voice: "photo"). */
  cameraSignal?: number
}) {
  const [items, setItems] = useState<ShownMedia[]>([])
  const [me, setMe] = useState<string | null>(null)
  const [camera, setCamera] = useState(false)
  const [pinFor, setPinFor] = useState<ShownMedia[] | null>(null)
  const [open, setOpen] = useState<ShownMedia | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [, tick] = useState(0)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const whereKey = JSON.stringify(where)

  useEffect(() => { if (cameraSignal) setCamera(true) }, [cameraSignal])
  useEffect(() => { fetchCurrentUser().then(u => setMe(u ? `${u.firstName} ${u.lastName}`.trim() : null)).catch(() => {}) }, [])

  const refresh = useCallback(async () => {
    const [loc, srv] = await Promise.all([localMedia(where), (where.quoteKey || where.jobId || where.customerId) ? listMedia(where) : Promise.resolve([])])
    const onServer = new Set(srv.map(s => s.clientId))
    const list = [...srv.map(shownServer), ...loc.filter(l => !onServer.has(l.clientId)).map(l => shownLocal(l, me))]
      .sort((a, b) => a.takenAt.localeCompare(b.takenAt))
    setItems(list)
    onItems?.(list)
  }, [whereKey, me])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    refresh()
    const on = () => { refresh(); tick(n => n + 1) }
    window.addEventListener(MEDIA_EVENT, on)
    const t = setInterval(refresh, 15_000)
    storageWarning().then(setWarn)
    return () => { window.removeEventListener(MEDIA_EVENT, on); clearInterval(t) }
  }, [refresh])

  useEffect(() => {
    if (!openKey) return
    const hit = items.find(i => i.key === openKey)
    if (hit) { setOpen(hit); onOpened?.() }
  }, [openKey, items])  // eslint-disable-line react-hooks/exhaustive-deps

  /** Change one item wherever it is now (still on the phone, or on the Mac). */
  async function change(item: ShownMedia, patch: { caption?: string; category?: Category; visibility?: Visibility; pin?: MediaPin | null }) {
    if (item.local) {
      await updateLocal(item.local.clientId, { meta: { ...item.local.meta, ...patch } })
      // It may have finished uploading meanwhile: send the change there too.
      const srv = (await listMedia(where)).find(s => s.clientId === item.local!.clientId)
      if (srv) await patchMedia(srv.id, patch)
    } else if (item.server) await patchMedia(item.server.id, patch)
    await refresh()
  }

  async function afterCapture(taken: LocalMedia[]) {
    setCamera(false)
    await refresh()
    if (!taken.length) return
    const fresh = (await localMedia(where)).filter(l => taken.some(t => t.clientId === l.clientId)).map(l => shownLocal(l, me))
    const list = fresh.length ? fresh : items.filter(i => taken.some(t => t.clientId === i.key))
    if (layout && list.length) setPinFor(list)
    else for (const i of list) await change(i, { caption: autoCaption({ category: i.category, takenAt: i.takenAt, takenBy: me }) })
  }

  async function pick(files: FileList | null) {
    if (!files?.length) return
    const taken: LocalMedia[] = []
    for (const f of Array.from(files)) {
      const kind = f.type.startsWith('video/') ? 'video' : 'photo'
      const mime = baseMime(f.type || (kind === 'video' ? 'video/mp4' : 'image/jpeg'))
      taken.push(await addCapture(f, { ...where, kind, mime, takenAt: new Date(f.lastModified || Date.now()).toISOString(), category: defaultCategory }))
    }
    if (fileRef.current) fileRef.current.value = ''
    await afterCapture(taken)
  }

  async function pinAll(list: ShownMedia[], pin: MediaPin | null) {
    for (const i of list) {
      const caption = i.caption && i.caption !== autoCaption({ category: i.category, takenAt: i.takenAt, takenBy: i.takenBy ?? me })
        ? i.caption
        : autoCaption({ layout, pin, category: i.category, takenAt: i.takenAt, takenBy: i.takenBy ?? me })
      await change(i, { pin, caption })
    }
    setPinFor(null)
  }

  const waiting = items.filter(i => !i.uploaded).length
  const pins = useMemo(() => items.filter(i => i.pin), [items])

  return (
    <div className="space-y-2" data-media-gallery>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-900 w-full sm:w-auto sm:flex-1 min-w-0">{title} <span className="font-normal text-gray-600">({items.length})</span>
          {waiting > 0 && <span className="ml-2 text-xs font-semibold text-amber-800 bg-amber-100 rounded-full px-2 py-0.5" data-media-waiting>{waiting} waiting to upload</span>}
        </p>
        <button type="button" className="btn btn-primary btn-sm flex-1 sm:flex-none" onClick={() => setCamera(true)} data-media-camera><Camera size={16} aria-hidden="true" /> Camera</button>
        <label className="btn btn-secondary btn-sm cursor-pointer flex-1 sm:flex-none" data-media-pick>
          <Images size={16} aria-hidden="true" /> Choose from gallery
          <input ref={fileRef} type="file" accept="image/*,video/*" multiple className="sr-only" onChange={e => pick(e.target.files)} />
        </label>
      </div>
      {warn && <p className="text-sm text-amber-900 bg-amber-50 rounded-lg px-3 py-2">{warn}</p>}
      {items.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2" data-media-grid>
          {items.map(i => (
            <button key={i.key} type="button" onClick={() => setOpen(i)} className="relative aspect-square rounded-lg overflow-hidden bg-gray-200 text-left" data-media-item={i.uploaded ? 'uploaded' : 'waiting'}>
              {i.thumb ? <img src={i.marked ?? i.thumb} alt={i.caption || i.category} className="w-full h-full object-cover" loading="lazy" />
                : <span className="w-full h-full grid place-items-center bg-gray-800 text-white"><Play size={28} /></span>}
              {i.kind === 'video' && i.thumb && <span className="absolute inset-0 grid place-items-center"><Play size={28} className="text-white drop-shadow" /></span>}
              <span className={`absolute top-1 right-1 rounded-full w-6 h-6 grid place-items-center ${i.uploaded ? 'bg-green-600' : 'bg-amber-500'} text-white`} title={i.uploaded ? 'Uploaded' : 'Waiting to upload'}>
                {i.uploaded ? <Check size={14} /> : <CloudOff size={14} />}
              </span>
              {!i.uploaded && i.local && uploadProgress(i.local.clientId) > 0 && (
                <span className="absolute bottom-0 left-0 h-1 bg-amber-500" style={{ width: `${Math.round(uploadProgress(i.local.clientId) * 100)}%` }} />
              )}
              {i.pin && <span className="absolute top-1 left-1 rounded-full w-6 h-6 grid place-items-center bg-white/90 text-gray-800"><MapPin size={14} /></span>}
              {i.visibility !== 'internal' && <span className="absolute bottom-1 left-1 text-[10px] font-bold bg-white/90 rounded px-1">{VISIBILITY_LABEL[i.visibility]}</span>}
            </button>
          ))}
        </div>
      ) : <p className="text-sm text-gray-600">No photos or video yet.</p>}
      {waiting > 0 && <button type="button" className="btn btn-quiet btn-sm" onClick={() => uploadAll().then(refresh)}>Upload now</button>}

      {camera && <MediaCapture where={where} defaultCategory={defaultCategory} onDone={afterCapture} onClose={() => setCamera(false)} />}
      {pinFor && layout && (
        <PinStep layout={layout} onLayout={l => onLayout?.(l)} count={pinFor.length}
          gps={pinFor.find(i => i.local?.meta.lat != null)?.local?.meta as any ?? (pinFor[0].server?.lat != null ? { lat: pinFor[0].server.lat!, lng: pinFor[0].server.lng! } : null)}
          heading={pinFor.find(i => i.heading != null)?.heading ?? null}
          existing={pins.filter(p => !pinFor.some(x => x.key === p.key)).map(p => ({ id: p.key, ...p.pin! }))}
          onPin={pin => pinAll(pinFor, pin)}
          onSkip={() => pinAll(pinFor, null)} />
      )}
      {open && (
        <MediaViewer item={items.find(i => i.key === open.key) ?? open} layout={layout ?? null} me={me}
          onClose={() => setOpen(null)}
          onChange={patch => change(items.find(i => i.key === open.key) ?? open, patch)}
          onPin={() => { setPinFor([items.find(i => i.key === open.key) ?? open]); setOpen(null) }}
          onMarkup={async blob => {
            const cur = items.find(i => i.key === open.key) ?? open
            if (cur.local) await updateLocal(cur.local.clientId, { markupBlob: blob })
            else if (cur.server) await uploadMarkup(cur.server.id, blob)
            await refresh()
          }}
          onFrame={async blob => {
            const cur = items.find(i => i.key === open.key) ?? open
            const m = await addCapture(blob, { ...where, kind: 'photo', mime: 'image/jpeg', takenAt: new Date().toISOString(), category: cur.category as Category, pin: cur.pin, caption: cur.caption ? `Frame from video: ${cur.caption}` : 'Frame from video' })
            await refresh()
            return m.clientId
          }}
          onDelete={async () => {
            const cur = items.find(i => i.key === open.key) ?? open
            if (!window.confirm(cur.uploaded ? 'Remove this from the app? The file stays on the Mac.' : 'Delete this capture? It has not uploaded yet, so it will be gone.')) return
            if (cur.server) await deleteMedia(cur.server.id); else if (cur.local) await discardLocal(cur.local.clientId)
            setOpen(null); await refresh()
          }} />
      )}
    </div>
  )
}

function MediaViewer({ item, layout, me, onClose, onChange, onPin, onMarkup, onFrame, onDelete }: {
  item: ShownMedia
  layout: YardLayout | null
  me: string | null
  onClose: () => void
  onChange: (patch: { caption?: string; category?: Category; visibility?: Visibility }) => Promise<void>
  onPin: () => void
  onMarkup: (blob: Blob) => Promise<void>
  onFrame: (blob: Blob) => Promise<string>
  onDelete: () => void
}) {
  useBackLayer(onClose, { key: 'media-viewer' })
  const [caption, setCaption] = useState(item.caption)
  const [showOriginal, setShowOriginal] = useState(false)
  const [markup, setMarkup] = useState<string | null>(null)
  const [frameMarkup, setFrameMarkup] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  useEffect(() => { setCaption(item.caption) }, [item.key, item.caption])

  function grabFrame() {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    v.pause()
    const c = document.createElement('canvas')
    c.width = v.videoWidth; c.height = v.videoHeight
    try { c.getContext('2d')!.drawImage(v, 0, 0) } catch { return }
    c.toBlob(b => { if (b) setFrameMarkup(URL.createObjectURL(b)) }, 'image/jpeg', 0.92)
  }

  const img = item.kind === 'photo' ? (item.marked && !showOriginal ? item.marked : item.full) : null
  const when = new Date(item.takenAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="fixed inset-0 z-[84] bg-black/60 flex items-end md:items-center justify-center" data-media-viewer>
      <div className="bg-white w-full md:max-w-3xl rounded-t-2xl md:rounded-2xl max-h-[96vh] overflow-y-auto">
        <div className="bg-black relative">
          {img ? <img src={img} alt={item.caption} className="w-full max-h-[55vh] object-contain" data-viewer-image />
            : <video ref={videoRef} src={item.full} controls playsInline crossOrigin="anonymous" className="w-full max-h-[55vh]" data-viewer-video />}
          <button type="button" className="absolute top-2 right-2 btn btn-secondary btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            {item.kind === 'photo' && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setMarkup(item.full)} data-viewer-markup>Mark up</button>}
            {item.kind === 'photo' && item.marked && <button type="button" className="btn btn-quiet btn-sm" onClick={() => setShowOriginal(s => !s)} data-viewer-original>{showOriginal ? 'Show marked up' : 'Show original'}</button>}
            {item.kind === 'video' && <button type="button" className="btn btn-secondary btn-sm" onClick={grabFrame} data-viewer-frame>Mark up this frame</button>}
            {layout && <button type="button" className="btn btn-secondary btn-sm" onClick={onPin} data-viewer-pin><MapPin size={16} aria-hidden="true" /> {item.pin ? 'Move pin' : 'Pin on the plan'}</button>}
            {(can('ops.delete') || !item.server) && <button type="button" className="btn btn-quiet btn-sm text-red-700 ml-auto" onClick={onDelete}>{item.server ? 'Delete' : 'Discard'}</button>}
          </div>
          <label className="block">
            <span className="text-xs text-gray-600">Caption</span>
            <textarea rows={3} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" value={caption} onChange={e => setCaption(e.target.value)}
              onBlur={() => caption !== item.caption && onChange({ caption })} data-viewer-caption />
          </label>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { const c = autoCaption({ layout, pin: item.pin, category: item.category, takenAt: item.takenAt, takenBy: item.takenBy ?? me }); setCaption(c); onChange({ caption: c }) }}>Write the caption for me</button>
          <div className="grid grid-cols-2 gap-2">
            <label className="block"><span className="text-xs text-gray-600">Category</span>
              <select className="w-full border border-gray-300 rounded-lg px-2 h-11 text-sm bg-white" value={item.category} onChange={e => onChange({ category: e.target.value as Category })} data-viewer-category>
                {CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label className="block"><span className="text-xs text-gray-600">Who can see it</span>
              <select className="w-full border border-gray-300 rounded-lg px-2 h-11 text-sm bg-white" value={item.visibility} onChange={e => onChange({ visibility: e.target.value as Visibility })} data-viewer-visibility>
                {(Object.keys(VISIBILITY_LABEL) as Visibility[]).map(v => <option key={v} value={v}>{VISIBILITY_LABEL[v]}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-gray-600">
            Only items set to Customer show in the customer portal. {item.takenBy ? `Taken by ${item.takenBy}, ` : ''}{when}.{' '}
            {item.uploaded ? 'Uploaded.' : 'Waiting to upload; it is safe on this phone.'}
            {item.heading == null ? '' : ` Facing ${Math.round(item.heading)}° from north${layout && planAngle(layout, item.heading) == null ? '' : ''}.`}
          </p>
        </div>
      </div>
      {markup && <MarkupEditor src={markup} onClose={() => setMarkup(null)} onSave={async b => { await onMarkup(b); setMarkup(null) }} />}
      {frameMarkup && <MarkupEditor src={frameMarkup} onClose={() => setFrameMarkup(null)} onSave={async b => {
        // The frame becomes its own photo, with the marked up copy beside it.
        const frame = await (await fetch(frameMarkup)).blob()
        const id = await onFrame(frame)
        await updateLocal(id, { markupBlob: b })
        setFrameMarkup(null)
      }} />}
    </div>
  )
}
