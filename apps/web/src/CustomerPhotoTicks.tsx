/**
 * "Show these to the customer": a quote's photos (its own and its site
 * visit's) as thumbnails with a tick each. A ticked photo is set to Customer
 * and goes on the proposal; anything not ticked stays Internal. One tap a
 * photo, saved at once.
 *
 * Why (round 2 review, Oct 26 2026): the visit's photos are saved Internal,
 * so a repair proposal went out with no photos at all while its photo check
 * counted the Internal ones. Now the check counts only photos the customer
 * will see, and the Send box offers this list when none are ticked.
 */

import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { listMedia, localMedia, patchMedia, updateLocal, MEDIA_EVENT, type Visibility } from './mediaStore'
import { toast } from './toast'

export interface TickPhoto {
  key: string
  serverId: string | null
  clientId: string
  src: string
  visibility: Visibility
}

const objectUrls = new Map<Blob, string>()
const urlFor = (b: Blob) => { let u = objectUrls.get(b); if (!u) { u = URL.createObjectURL(b); objectUrls.set(b, u) } return u }

/** The quote's photos (null while loading), and a tap to show or hide one to the customer. */
export function useQuotePhotos(quoteId: string, customerId: string | null | undefined) {
  const [photos, setPhotos] = useState<TickPhoto[] | null>(null)
  const load = useCallback(async () => {
    const where = { quoteKey: quoteId, quoteCustomerId: customerId ?? null }
    const [srv, loc] = await Promise.all([listMedia(where).catch(() => []), localMedia(where).catch(() => [])])
    const onServer = new Set(srv.map(s => s.clientId))
    const list: TickPhoto[] = [
      ...srv.filter(m => m.kind === 'photo').map(m => ({ key: m.clientId, serverId: m.id, clientId: m.clientId, src: m.markupUrl ?? m.thumbUrl ?? m.url, visibility: (m.visibility ?? 'internal') as Visibility })),
      ...loc.filter(l => l.meta.kind === 'photo' && !onServer.has(l.clientId)).map(l => ({ key: l.clientId, serverId: null, clientId: l.clientId, src: urlFor(l.markupBlob ?? l.blob), visibility: (l.meta.visibility ?? 'internal') as Visibility })),
    ]
    // A steady order (taken, then id): photos taken in the same second never swap places between taps.
    const taken = new Map([...srv.map(m => [m.clientId, String(m.takenAt ?? '')] as const), ...loc.map(l => [l.clientId, String(l.meta.takenAt ?? '')] as const)])
    list.sort((a, b) => (taken.get(a.key) ?? '').localeCompare(taken.get(b.key) ?? '') || a.key.localeCompare(b.key))
    setPhotos(list)
  }, [quoteId, customerId])
  useEffect(() => {
    let live = true
    const run = () => { if (live) void load() }
    run()
    window.addEventListener(MEDIA_EVENT, run)
    return () => { live = false; window.removeEventListener(MEDIA_EVENT, run) }
  }, [load])

  /** Tick (Customer) or untick (Internal) one photo, wherever it is now: on the server, or still on this phone. */
  const toggle = useCallback(async (p: TickPhoto) => {
    const visibility: Visibility = p.visibility === 'customer' ? 'internal' : 'customer'
    setPhotos(list => list?.map(x => x.key === p.key ? { ...x, visibility } : x) ?? list)
    let ok = true
    if (p.serverId) ok = await patchMedia(p.serverId, { visibility })
    else {
      const [mine] = (await localMedia({})).filter(l => l.clientId === p.clientId)
      if (mine) await updateLocal(p.clientId, { meta: { ...mine.meta, visibility } })
      // It may have finished uploading meanwhile: the change goes there too.
      const srv = (await listMedia({ quoteKey: quoteId, quoteCustomerId: customerId ?? null }, { fresh: true }).catch(() => [])).find(s => s.clientId === p.clientId)
      if (srv) ok = await patchMedia(srv.id, { visibility })
    }
    if (!ok) {
      setPhotos(list => list?.map(x => x.key === p.key ? { ...x, visibility: p.visibility } : x) ?? list)
      toast.error('Not saved', 'No signal right now. Tap the photo again when you have signal.')
      return
    }
    // Every list of these photos on screen (the quote's Photos, the Send box) reads it again.
    window.dispatchEvent(new Event(MEDIA_EVENT))
  }, [quoteId, customerId])

  return { photos, toggle, reload: load }
}

/** The thumbnails with their ticks. */
export function PhotoTickGrid({ photos, onToggle }: { photos: TickPhoto[]; onToggle: (p: TickPhoto) => void }) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2" data-photo-ticks={photos.length}>
      {photos.map((p, i) => {
        const on = p.visibility === 'customer'
        return (
          <button key={p.key} type="button" onClick={() => onToggle(p)} aria-pressed={on}
            aria-label={`Photo ${i + 1}: ${on ? 'shown to the customer. Tap to keep it inside the company.' : 'not shown to the customer. Tap to show it.'}`}
            className={`relative aspect-square rounded-lg overflow-hidden bg-gray-200 border-4 ${on ? 'border-green-600' : 'border-transparent'}`}
            data-photo-tick={p.key} data-ticked={on ? 'yes' : 'no'}>
            {p.src ? <img src={p.src} alt="" className="w-full h-full object-cover" loading="lazy" /> : null}
            <span className={`absolute top-1 right-1 w-7 h-7 rounded-full grid place-items-center border-2 ${on ? 'bg-green-600 border-white text-white' : 'bg-white/90 border-gray-500 text-transparent'}`} aria-hidden="true">
              <Check size={16} strokeWidth={3} />
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** The list with its heading, for the quote's photos section. */
export default function CustomerPhotoTicks({ quoteId, customerId }: { quoteId: string; customerId: string | null | undefined }) {
  const { photos, toggle } = useQuotePhotos(quoteId, customerId)
  if (!photos || photos.length === 0) return null
  const shown = photos.filter(p => p.visibility === 'customer').length
  return (
    <div className="space-y-2" data-customer-photo-ticks>
      <p className="text-sm font-semibold text-gray-900">Show these to the customer</p>
      <p className="text-xs text-gray-600" data-photo-ticks-count={shown}>
        Tap a photo to tick it: ticked photos go on the proposal. The rest stay inside the company. {shown === 0 ? 'None ticked yet.' : `${shown} of ${photos.length} ticked.`}
      </p>
      <PhotoTickGrid photos={photos} onToggle={toggle} />
    </div>
  )
}
