/**
 * Photos tab for a customer profile (staff side).
 *
 * Uses the server-backed portal data plane via portalApiClient. Customer-uploaded
 * photos appear here with a "Customer" source badge; staff uploads appear with a
 * "Staff" badge. CompanyCam sub-tab is preserved when the integration is linked.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from './toast'
import {
  listCustomerPhotos,
  uploadStaffPhotoForCustomer,
  deletePortalPhoto,
  resolveFileUrl,
  type PortalPhotoRow,
} from './portalApiClient'
import { cloudStorage } from './cloudStorage'

const ACCEPTED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
const ACCEPT_ATTR = 'image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif'

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

function companyCamProjectForCustomer(customerId: string): string | null {
  try {
    const raw = localStorage.getItem('fencepro_integrations')
    if (!raw) return null
    const intg = JSON.parse(raw)
    const cc = intg?.companycam
    if (!cc?.connected) return null
    return cc?.customerProjects?.[customerId] || null
  } catch { return null }
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

export default function CustomerPhotosTab({ customerId, uploadedBy }: { customerId: string; uploadedBy: string }) {
  const [photos, setPhotos] = useState<PortalPhotoRow[]>([])
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)
  const [uploading, setUploading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [subTab, setSubTab] = useState<'all' | 'companycam'>('all')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragRef = useRef<HTMLDivElement>(null)

  const ccProjectId = useMemo(() => companyCamProjectForCustomer(customerId), [customerId])

  const refresh = useCallback(async () => {
    setLoading(true)
    const rows = await listCustomerPhotos(customerId)
    setPhotos(rows)
    setLoading(false)
  }, [customerId])

  useEffect(() => { refresh() }, [refresh])

  async function handleFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList)
    if (files.length === 0) return
    setUploading(true)
    const rejected: string[] = []
    const accepted: File[] = []
    for (const f of files) {
      if (!ACCEPTED.includes(f.type) && !/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(f.name)) {
        rejected.push(`${f.name}: unsupported type`)
      } else if (f.size > 20 * 1024 * 1024) {
        rejected.push(`${f.name}: over 20MB`)
      } else {
        accepted.push(f)
      }
    }
    if (rejected.length > 0) {
      toast.warning(`${rejected.length} photo${rejected.length === 1 ? '' : 's'} skipped`, rejected.join('\n'))
    }
    if (accepted.length === 0) { setUploading(false); return }

    let okCount = 0
    for (const f of accepted) {
      const r = await uploadStaffPhotoForCustomer(customerId, f, undefined, uploadedBy)
      if (r.ok) {
        okCount++
        logActivity(customerId, 'photo_uploaded', { name: f.name, by: uploadedBy })
      } else {
        toast.error(`Upload failed: ${f.name}`, r.error)
      }
    }
    if (okCount > 0) {
      toast.success(`${okCount} photo${okCount === 1 ? '' : 's'} uploaded`)
      await refresh()
    }
    setUploading(false)
  }

  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const fl = e.target.files
    if (fl) handleFiles(fl)
    e.target.value = ''
  }

  function onDragOver(e: React.DragEvent) { e.preventDefault(); e.stopPropagation() }
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation()
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files)
  }

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

  const visible = subTab === 'all' ? photos : []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">Photos</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {loading ? 'Loading…' : `${photos.length} photo${photos.length === 1 ? '' : 's'} for this customer`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white text-sm font-medium px-4 py-2 rounded-lg">
            {uploading ? 'Uploading…' : '+ Upload Photos'}
          </button>
          <input ref={fileInputRef} type="file" multiple accept={ACCEPT_ATTR}
            onChange={onFilePick} className="hidden" />
        </div>
      </div>

      {ccProjectId && (
        <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
          {(['all', 'companycam'] as const).map(t => (
            <button key={t} onClick={() => setSubTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition capitalize ${subTab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              {t === 'companycam' ? 'CompanyCam' : 'All Photos'}
            </button>
          ))}
        </div>
      )}

      {subTab === 'all' && (
        <div
          ref={dragRef}
          onDragOver={onDragOver}
          onDrop={onDrop}
          className={`border-2 border-dashed ${visible.length === 0 ? 'border-gray-300' : 'border-transparent'} rounded-2xl transition-colors hover:border-orange-300`}
        >
          {visible.length === 0 ? (
            <div className="py-16 text-center">
              <p className="text-5xl mb-2">📷</p>
              <p className="text-gray-500 font-medium">{loading ? 'Loading photos…' : 'No photos yet'}</p>
              <p className="text-xs text-gray-400 mt-1">Drag photos here or click Upload Photos · JPG, PNG, HEIC, WebP up to 20MB each</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-1">
              {visible.map((p, i) => (
                <PhotoCard key={p.id} photo={p}
                  onOpen={() => setLightboxIdx(i)}
                  onDelete={() => handleDelete(p)}
                  onDownload={() => handleDownload(p)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {subTab === 'companycam' && ccProjectId && (
        <div className="bg-gray-50 rounded-2xl border border-gray-200 p-8 text-center">
          <p className="text-4xl mb-2">📸</p>
          <p className="text-sm font-medium text-gray-700">CompanyCam Project Linked</p>
          <p className="text-xs text-gray-500 mt-1 mb-3">Project ID: {ccProjectId}</p>
          <p className="text-xs text-gray-400 max-w-md mx-auto">Live photos from CompanyCam will appear here once the integration is fully wired on the portal backend.</p>
        </div>
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
  const [menu, setMenu] = useState(false)
  const src = resolveFileUrl(photo.fileUrl)
  const badge = sourceBadge(photo.source)
  return (
    <div className="relative group rounded-xl overflow-hidden bg-gray-100 border border-gray-200">
      <button onClick={onOpen} className="block w-full aspect-square">
        {src ? <img src={src} alt={photo.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          : <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">No preview</div>}
      </button>
      <div className="absolute top-2 left-2">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.text}</span>
      </div>
      <div className="px-3 py-2 flex items-center justify-between">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-900 truncate">{photo.name}</p>
          <p className="text-[10px] text-gray-400">{new Date(photo.uploadedAt).toLocaleDateString()}</p>
        </div>
        <button onClick={() => setMenu(!menu)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">⋮</button>
      </div>
      {menu && (
        <div className="absolute bottom-10 right-2 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10 text-sm" onMouseLeave={() => setMenu(false)}>
          <button onClick={() => { setMenu(false); onOpen() }} className="block w-full text-left px-3 py-1.5 hover:bg-orange-50">View Full Size</button>
          <button onClick={() => { setMenu(false); onDownload() }} className="block w-full text-left px-3 py-1.5 hover:bg-orange-50">Download</button>
          <button onClick={() => { setMenu(false); onDelete() }} className="block w-full text-left px-3 py-1.5 text-red-600 hover:bg-red-50">Delete</button>
        </div>
      )}
    </div>
  )
}

function Lightbox({ photos, index, onClose, onPrev, onNext }: {
  photos: PortalPhotoRow[]; index: number; onClose: () => void; onPrev: () => void; onNext: () => void;
}) {
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
      <button onClick={onClose} className="absolute top-4 right-4 text-white/70 hover:text-white text-3xl">×</button>
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
