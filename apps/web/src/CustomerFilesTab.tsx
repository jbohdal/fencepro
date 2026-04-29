/**
 * Files / Documents tab for a customer profile (staff side).
 *
 * Server-backed via the portal data plane. Customer-uploaded documents appear
 * here with a "Customer" source badge. Staff uploads with "Staff". Legacy
 * localStorage files (site plans, etc.) still render below in a fallback list
 * so existing site-plan workflows continue to work.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from './toast'
import {
  listCustomerDocuments,
  uploadStaffDocumentForCustomer,
  deletePortalDocument,
  resolveFileUrl,
  type PortalFileRow,
} from './portalApiClient'

interface LegacyFile {
  id: string
  customerId: string
  name: string
  size: string
  type: string
  uploadedAt: string
  url?: string
  dataUrl?: string
}

function sourceBadge(source: PortalFileRow['source']) {
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

function fileIcon(mime: string) {
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('image')) return '🖼️'
  if (mime.includes('word') || mime.includes('document')) return '📝'
  if (mime.includes('sheet') || mime.includes('excel')) return '📊'
  return '📎'
}

function formatSize(bytes: number) {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(0)} KB`
}

export default function CustomerFilesTab({
  customerId,
  uploadedBy,
  legacyFiles,
  onLegacyFileClick,
  onLegacyFileDelete,
}: {
  customerId: string
  uploadedBy: string
  legacyFiles: LegacyFile[]
  onLegacyFileClick?: (f: LegacyFile) => void
  onLegacyFileDelete?: (id: string) => void
}) {
  const [docs, setDocs] = useState<PortalFileRow[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const rows = await listCustomerDocuments(customerId)
    setDocs(rows)
    setLoading(false)
  }, [customerId])

  useEffect(() => { refresh() }, [refresh])

  async function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    const r = await uploadStaffDocumentForCustomer(customerId, file, undefined, uploadedBy)
    setUploading(false)
    if (r.ok) {
      toast.success('File uploaded')
      refresh()
    } else {
      toast.error('Upload failed', r.error)
    }
  }

  async function handleDelete(doc: PortalFileRow) {
    if (!confirm(`Delete "${doc.name}"?`)) return
    const ok = await deletePortalDocument(doc.id)
    if (!ok) { toast.error('Delete failed'); return }
    toast.success('File deleted')
    refresh()
  }

  function handleOpen(doc: PortalFileRow) {
    const url = resolveFileUrl(doc.fileUrl)
    if (!url) return
    window.open(url, '_blank', 'noopener')
  }

  function handleDownload(doc: PortalFileRow) {
    const url = resolveFileUrl(doc.fileUrl)
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = doc.name
    a.target = '_blank'
    a.rel = 'noopener'
    a.click()
  }

  const totalCount = docs.length + legacyFiles.length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {loading ? 'Loading…' : `${totalCount} file${totalCount === 1 ? '' : 's'} uploaded`}
        </p>
        <label className={`bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold px-4 py-2 rounded-lg cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}`}>
          {uploading ? 'Uploading…' : '+ Upload File'}
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileInput} />
        </label>
      </div>

      {totalCount === 0 ? (
        <label className="block border-2 border-dashed border-gray-200 rounded-2xl p-12 text-center cursor-pointer hover:border-orange-300 transition-colors">
          <p className="text-4xl mb-3">📎</p>
          <p className="text-gray-500 font-medium">Drop files here or click to upload</p>
          <p className="text-gray-400 text-sm mt-1">Contracts, HOA approvals, site photos, anything relevant</p>
          <input type="file" className="hidden" onChange={handleFileInput} />
        </label>
      ) : (
        <>
          {docs.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">File</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Size</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Uploaded</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {docs.map(d => {
                    const badge = sourceBadge(d.source)
                    return (
                      <tr key={d.id} className="hover:bg-orange-50 group cursor-pointer transition-colors" onClick={() => handleOpen(d)}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{fileIcon(d.mimeType || '')}</span>
                            <span className="font-medium text-gray-800 truncate max-w-[260px]">{d.name}</span>
                            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${badge.cls}`}>{badge.text}</span>
                            {d.label && (
                              <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{d.label}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400 text-xs">{formatSize(d.size)}</td>
                        <td className="px-4 py-3 text-right text-gray-400 text-xs">{new Date(d.uploadedAt).toLocaleDateString()}</td>
                        <td className="px-3 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <button onClick={() => handleOpen(d)} className="text-xs text-blue-600 hover:underline mr-3">View</button>
                          <button onClick={() => handleDownload(d)} className="text-xs text-gray-500 hover:underline mr-3">Download</button>
                          <button onClick={() => handleDelete(d)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {legacyFiles.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
              <div className="px-5 py-3 bg-gray-50 border-b border-gray-200">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Site Plans &amp; Local Files</p>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">File</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Size</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase">Uploaded</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {legacyFiles.map(f => (
                    <tr key={f.id} className="hover:bg-orange-50 group cursor-pointer transition-colors" onClick={() => onLegacyFileClick?.(f)}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{fileIcon(f.type)}</span>
                          <span className="font-medium text-gray-800">{f.name}</span>
                          {f.type === 'Site Plan' && (
                            <span className="ml-1 text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Site Plan</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">{f.size}</td>
                      <td className="px-4 py-3 text-right text-gray-400 text-xs">{f.uploadedAt}</td>
                      <td className="px-3 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <button onClick={() => onLegacyFileClick?.(f)} className="text-xs text-blue-600 hover:underline mr-3">View</button>
                        <button onClick={() => {
                          const url = f.url || f.dataUrl
                          if (url) { const a = document.createElement('a'); a.href = url; a.download = f.name; a.click() }
                        }} className="text-xs text-gray-500 hover:underline mr-3">Download</button>
                        <button onClick={() => onLegacyFileDelete?.(f.id)} className="text-gray-300 hover:text-red-500 text-lg leading-none">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
