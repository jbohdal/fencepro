/**
 * The customer's older photos on the customer page's Photos tab (staff side):
 * what the customer sent from the portal and photos added before "Photos and
 * video" (GET /api/portal/customer/:id/photos, newest first), with a
 * "Customer" or "Staff" badge. Shown only when there are some.
 *
 * New photos are added in one place, "Photos and video" above it
 * (MediaGallery: Camera, Choose from gallery), so this list has no upload of
 * its own (review of the customer page, Oct 26 2026: two upload areas).
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from './toast'
import {
  listCustomerPhotos,
  deletePortalPhoto,
  resolveFileUrl,
  type PortalPhotoRow,
} from './portalStaffApi'
import { cloudStorage } from './cloudStorage'
import { useBackLayer } from './nav'
import { can } from './permissions'
import PopMenu, { PopItem } from './PopMenu'

/** Photos drawn at first and per "Show more" (a customer can have hundreds). */
const PHOTOS_PAGE = 48

const ACTIVITY_KEY = 'fencepro_customer_activity'
const uid = () => Math.random().toString(36).slice(2, 10)

function logActivity(customerId: string, action: string, meta?: any) {
  try {
    const raw = cloudStorage.getItem(ACTIVITY_KEY)
    const all = raw ? JSON.parse(raw) : []
    all.unshift({ id: uid(), customerId, action, meta, at: new Date().toISOString() })
    cloudStorage.setItem(ACTIVITY_KEY, JSON.stringify(all.slice(0, 1000)))
  } catch {}
}


function sourceBadge(source: PortalPhotoRow['source']) {
  switch (source) {
    case 'portal_customer':
      return { text: 'Customer', cls: 'bg-blue-100 text-blue-700 border-blue-200' }
    case 'crm_staff':
      return { text: 'Staff', cls: 'bg-gray-100 text-gray-700 border-gray-200' }
    case 'companycam':
      return { text: 'CompanyCam', cls: 'bg-orange-100 text-orange-700 border-orange-200' }
    case 'system_generated':
      return { text: 'System', cls: 'bg-purple-100 text-purple-700 border-purple-200' }
    default:
      return { text: source, cls: 'bg-gray-100 text-gray-700 border-gray-200' }
  }
}

export default function CustomerPhotosTab({ customerId }: { customerId: string }) {
  const [photos, setPhotos] = useState<PortalPhotoRow[]>([])
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [limit, setLimit] = useState(PHOTOS_PAGE)

  const refresh = useCallback(async () => {
    setLoading(true)
    const rows = await listCustomerPhotos(customerId)
    setPhotos(rows)
    setLoading(false)
  }, [customerId])

  useEffect(() => { setLimit(PHOTOS_PAGE); refresh() }, [refresh])

  async function handleDelete(photo: PortalPhotoRow) {
    if (!confirm(`Delete "${photo.name}"?`)) return
    const ok = await deletePortalPhoto(photo.id)
    if (!ok) { toast.error('Delete failed'); return }
    logActivity(customerId, 'photo_deleted', { name: photo.name })
    toast.success('Photo deleted')
    refresh()
  }

  function handleDownload(photo: PortalPhotoRow) {
    const url = resolveFileUrl(photo.fileUrl)
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = photo.name
    a.target = '_blank'
    a.rel = 'noopener'
    a.click()
  }

  // Nothing older and nothing from the customer: no second section at all.
  if (!loading && photos.length === 0) return null
  const visible = photos

  return (
    <div className="space-y-2" data-customer-older-photos>
      <div>
        <p className="text-sm font-semibold text-gray-900">Customer uploads and older photos <span className="font-normal text-gray-600">{loading ? '' : `(${photos.length})`}</span></p>
        <p className="text-xs text-gray-600">{loading ? 'Loading…' : 'Sent by the customer from the portal, or added before Photos and video. Newest first.'}</p>
      </div>
      {visible.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2" data-customer-photos-grid>
          {visible.slice(0, limit).map((p, i) => (
            <PhotoCard key={p.id} photo={p}
              onOpen={() => setLightboxIdx(i)}
              onDelete={() => handleDelete(p)}
              onDownload={() => handleDownload(p)}
            />
          ))}
        </div>
      )}
      {visible.length > limit && (
        <button type="button" className="btn btn-quiet btn-sm w-full mt-2" data-show-more="customer-photos" onClick={() => setLimit(l => l + PHOTOS_PAGE)}>
          Show {Math.min(PHOTOS_PAGE, visible.length - limit)} more <span className="font-normal text-gray-500">({limit} of {visible.length})</span>
        </button>
      )}

      {lightboxIdx !== null && visible[lightboxIdx] && (
        <Lightbox photos={visible} index={lightboxIdx}
          onClose={() => setLightboxIdx(null)}
          onPrev={() => setLightboxIdx(i => i !== null && i > 0 ? i - 1 : i)}
          onNext={() => setLightboxIdx(i => i !== null && i < visible.length - 1 ? i + 1 : i)}
        />
      )}
    </div>
  )
}

function PhotoCard({ photo, onOpen, onDelete, onDownload }: {
  photo: PortalPhotoRow; onOpen: () => void; onDelete: () => void; onDownload: () => void;
}) {
  const src = resolveFileUrl(photo.fileUrl)
  const badge = sourceBadge(photo.source)
  return (
    <div className="relative group rounded-xl overflow-hidden bg-gray-100 border border-gray-200" data-customer-photo>
      <button onClick={onOpen} className="block w-full aspect-square">
        {src ? <img src={src} alt={photo.name} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          : <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">No preview</div>}
      </button>
      <div className="absolute top-2 left-2">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.text}</span>
      </div>
      <div className="pl-2 py-1 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-gray-900 truncate">{photo.name}</p>
          <p className="text-[10px] text-gray-400">{new Date(photo.uploadedAt).toLocaleDateString()}</p>
        </div>
        <PopMenu name="photo-actions" label="⋮" title={photo.name} width={176}
          triggerClassName="text-gray-400 hover:text-gray-600 text-lg leading-none min-w-[44px] min-h-[44px] -mr-2 grid place-items-center"
          triggerProps={{ 'aria-label': 'Photo actions' }}>
          {close => <>
            <PopItem onClick={() => { close(); onOpen() }}>View Full Size</PopItem>
            <PopItem onClick={() => { close(); onDownload() }}>Download</PopItem>
            {can('ops.delete') && <PopItem danger onClick={() => { close(); onDelete() }}>Delete</PopItem>}
          </>}
        </PopMenu>
      </div>
    </div>
  )
}

function Lightbox({ photos, index, onClose, onPrev, onNext }: {
  photos: PortalPhotoRow[]; index: number; onClose: () => void; onPrev: () => void; onNext: () => void;
}) {
  useBackLayer(onClose, { key: 'lightbox' })
  const p = photos[index]
  const src = resolveFileUrl(p.fileUrl)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onPrev()
      if (e.key === 'ArrowRight') onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-6" onClick={onClose}>
      <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center absolute top-4 right-4 text-white/70 hover:text-white text-3xl">×</button>
      <button onClick={(e) => { e.stopPropagation(); onPrev() }} disabled={index === 0}
        className="absolute left-4 text-white/70 hover:text-white disabled:opacity-30 text-4xl">‹</button>
      <button onClick={(e) => { e.stopPropagation(); onNext() }} disabled={index === photos.length - 1}
        className="absolute right-4 text-white/70 hover:text-white disabled:opacity-30 text-4xl">›</button>
      <img src={src} alt={p.name} onClick={(e) => e.stopPropagation()}
        className="max-w-full max-h-full object-contain rounded" />
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 rounded-full px-4 py-1.5 text-white text-xs">
        {p.name} · {index + 1} / {photos.length}
      </div>
    </div>
  )
}
