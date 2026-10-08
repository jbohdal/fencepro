/**
 * Full-screen file viewer — PDF in iframe, images in a lightbox, site plans
 * in a read-only site plan viewer, text/docs with a safe preview + download.
 */

import { useEffect, useMemo, useState } from 'react'
import { toast } from './toast'
import { cloudStorage } from './cloudStorage'

export interface CustomerFileShape {
  id: string
  customerId: string
  name: string
  type: string
  size?: string
  url?: string         // http(s) URL when uploaded to object storage
  dataUrl?: string     // data URL fallback
  siteplanId?: string  // when file represents a site plan
  uploadedAt: string
  uploadedBy?: string
}

function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '')
  return m ? m[1].toLowerCase() : ''
}

type ViewerKind = 'pdf' | 'image' | 'text' | 'siteplan' | 'docx_xlsx' | 'unknown'

function classify(file: CustomerFileShape): ViewerKind {
  if (file.type?.toLowerCase() === 'site plan' || file.siteplanId) return 'siteplan'
  const ext = extOf(file.name)
  if (['pdf'].includes(ext)) return 'pdf'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif'].includes(ext)) return 'image'
  if (['txt', 'md', 'log', 'csv'].includes(ext)) return 'text'
  if (['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt'].includes(ext)) return 'docx_xlsx'
  return 'unknown'
}

export default function FileViewerModal({ file, siblingImages = [], onClose, onDelete }: {
  file: CustomerFileShape
  siblingImages?: CustomerFileShape[]
  onClose: () => void
  onDelete?: (id: string) => void
}) {
  const kind = classify(file)
  const url = file.url || file.dataUrl

  // For image viewer, find this file's index in siblingImages for prev/next
  const images = useMemo(
    () => siblingImages.length > 0 ? siblingImages : [file],
    [siblingImages, file]
  )
  const [imgIdx, setImgIdx] = useState(() => Math.max(0, images.findIndex(f => f.id === file.id)))
  const current = kind === 'image' ? images[imgIdx] || file : file

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (kind === 'image') {
        if (e.key === 'ArrowLeft') setImgIdx(i => Math.max(0, i - 1))
        if (e.key === 'ArrowRight') setImgIdx(i => Math.min(images.length - 1, i + 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [kind, images.length, onClose])

  function handleDownload() {
    if (!url) { toast.warning('No file URL available'); return }
    const a = document.createElement('a')
    a.href = url
    a.download = current.name
    a.click()
  }

  function handleDeleteClick() {
    if (!onDelete) return
    if (!confirm(`Delete "${file.name}"? This cannot be undone.`)) return
    onDelete(file.id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex flex-col" onClick={onClose}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-900 text-white" onClick={e => e.stopPropagation()}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{current.name}</p>
          <p className="text-xs text-white/60">
            {current.size ? `${current.size} · ` : ''}{current.uploadedAt}{current.uploadedBy ? ` · ${current.uploadedBy}` : ''}
            {kind === 'image' && images.length > 1 && ` · ${imgIdx + 1} of ${images.length}`}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleDownload} className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg">Download</button>
          {onDelete && <button onClick={handleDeleteClick} className="text-xs text-red-400 hover:bg-red-500/20 px-3 py-1.5 rounded-lg">Delete</button>}
          <button onClick={onClose} className="text-white/70 hover:text-white text-2xl leading-none px-2">×</button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 relative flex items-center justify-center overflow-hidden" onClick={e => e.stopPropagation()}>
        {kind === 'pdf' && url && (
          <iframe src={url} title={file.name} className="w-full h-full bg-white" />
        )}
        {kind === 'pdf' && !url && (
          <EmptyPreview message="PDF file URL is not available. Download to view." />
        )}
        {kind === 'image' && url && (
          <>
            <button onClick={() => setImgIdx(i => Math.max(0, i - 1))}
              disabled={imgIdx === 0}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white disabled:opacity-30 text-5xl z-10 select-none">‹</button>
            <button onClick={() => setImgIdx(i => Math.min(images.length - 1, i + 1))}
              disabled={imgIdx >= images.length - 1}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-white/70 hover:text-white disabled:opacity-30 text-5xl z-10 select-none">›</button>
            <img src={current.url || current.dataUrl} alt={current.name}
              className="max-w-full max-h-full object-contain" />
          </>
        )}
        {kind === 'image' && !url && (
          <EmptyPreview message="Image is not available — download to view." />
        )}
        {kind === 'siteplan' && (
          <SitePlanViewer siteplanId={file.siteplanId || file.id} />
        )}
        {kind === 'text' && url && (
          <TextPreview url={url} name={file.name} />
        )}
        {kind === 'docx_xlsx' && (
          <EmptyPreview message={`${extOf(file.name).toUpperCase()} preview is not supported in-browser. Click Download to open in the native app.`} />
        )}
        {kind === 'unknown' && (
          <EmptyPreview message="No preview available for this file type. Click Download to save it locally." />
        )}
      </div>
    </div>
  )
}

function EmptyPreview({ message }: { message: string }) {
  return (
    <div className="text-center text-white/80 p-8">
      <p className="text-5xl mb-3">📄</p>
      <p className="text-sm">{message}</p>
    </div>
  )
}

function TextPreview({ url, name }: { url: string; name: string }) {
  const [text, setText] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (url.startsWith('data:')) {
      try {
        const b64 = url.split(',')[1] || ''
        const decoded = atob(b64)
        if (!cancelled) setText(decoded)
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Could not decode')
      }
    } else {
      fetch(url).then(r => r.text()).then(t => { if (!cancelled) setText(t) })
        .catch(e => { if (!cancelled) setErr(e.message) })
    }
    return () => { cancelled = true }
  }, [url])

  return (
    <div className="w-full h-full p-8 overflow-auto">
      <div className="bg-white rounded-xl max-w-4xl mx-auto p-6">
        <p className="text-xs text-gray-400 mb-2 font-mono">{name}</p>
        {err && <p className="text-red-600 text-sm">{err}</p>}
        {text !== null && <pre className="whitespace-pre-wrap text-xs font-mono text-gray-800">{text}</pre>}
        {!text && !err && <p className="text-gray-400 text-sm">Loading…</p>}
      </div>
    </div>
  )
}

/** Read-only site plan viewer — renders the saved plan on a Google Map. */
function SitePlanViewer({ siteplanId }: { siteplanId: string }) {
  const [plan, setPlan] = useState<any>(null)
  useEffect(() => {
    try {
      const raw = cloudStorage.getItem('fencepro_siteplans')
      const all = raw ? JSON.parse(raw) : []
      setPlan(all.find((p: any) => p.id === siteplanId) || null)
    } catch {}
  }, [siteplanId])

  if (!plan) return <EmptyPreview message="Site plan not found." />

  return (
    <div className="w-full h-full bg-white p-6 overflow-auto">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-xl font-bold text-gray-900">{plan.name || 'Site Plan'}</h2>
        <p className="text-sm text-gray-500">{plan.address || ''} · Created {new Date(plan.createdAt).toLocaleDateString()}</p>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Lines</p>
            <p className="text-3xl font-black text-gray-900">{plan.lines?.length || 0}</p>
            <div className="mt-3 space-y-1">
              {(plan.lines || []).slice(0, 10).map((l: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: l.color || '#6b7280' }} />
                  <span className="text-gray-700">{l.type}{l.utilityKind ? ` · ${l.utilityKind}` : ''}</span>
                  {l.label && <span className="text-gray-400 ml-auto">{l.label}</span>}
                </div>
              ))}
            </div>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Markers</p>
            <p className="text-3xl font-black text-gray-900">{plan.markers?.length || 0}</p>
            <div className="mt-3 space-y-1">
              {(plan.markers || []).slice(0, 10).map((m: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: m.color || '#6b7280' }} />
                  <span className="text-gray-700">{m.type}</span>
                  {m.label && <span className="text-gray-400 ml-auto truncate max-w-[180px]">{m.label}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
        {plan.notes && (
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-3">
            <p className="text-xs font-bold text-blue-800 uppercase">Notes</p>
            <p className="text-sm text-blue-900 whitespace-pre-wrap mt-1">{plan.notes}</p>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-6 italic">This is a summary view. Open the full Site Plans page to edit or view on the satellite map.</p>
      </div>
    </div>
  )
}
