import { useState, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import type { DocumentView } from '../../types/index'

const ICON_MAP: Record<string, string> = {
  'application/pdf': '📕',
  'image/png': '🖼',
  'image/jpeg': '🖼',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DocumentsPage() {
  const [docs, setDocs] = useState<DocumentView[]>([])
  const [loading, setLoading] = useState(true)
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  function load() {
    setLoading(true)
    api.get<DocumentView[]>('/documents').then(setDocs).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      await api.upload('/documents', fd)
      load()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this document?')) return
    try { await api.delete(`/documents/${id}`); load() } catch {}
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{docs.length} documents</span>
        <div>
          <input ref={fileRef} type="file" className="hidden"
            accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg"
            onChange={handleUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-semibold text-sm px-4 py-2 rounded-lg">
            {uploading ? 'Uploading...' : '+ Upload File'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading documents...</div>
      ) : docs.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-2xl text-gray-400">
          <p className="text-4xl mb-3">📁</p>
          <p className="text-lg font-medium">No documents yet</p>
          <p className="text-sm mt-1">Upload PDFs, images, or spreadsheets</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-5 py-3 text-xs font-semibold text-gray-500 uppercase">File</th>
                <th className="text-left px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-20">Type</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-20">Size</th>
                <th className="text-right px-3 py-3 text-xs font-semibold text-gray-500 uppercase w-28">Uploaded</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {docs.map(doc => (
                <tr key={doc.id} className="hover:bg-gray-50 group">
                  <td className="px-5 py-3 flex items-center gap-2">
                    <span>{ICON_MAP[doc.mimeType] || '📄'}</span>
                    <span className="font-medium text-gray-900 truncate max-w-[300px]">{doc.originalName}</span>
                  </td>
                  <td className="px-3 py-3 text-xs text-gray-400">{doc.mimeType.split('/').pop()}</td>
                  <td className="px-3 py-3 text-right text-xs text-gray-500">{fmtSize(doc.sizeBytes)}</td>
                  <td className="px-3 py-3 text-right text-xs text-gray-400">{new Date(doc.uploadedAt).toLocaleDateString()}</td>
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100">
                      <a href={`/api/documents/${doc.id}/download`} className="text-xs text-orange-500 font-semibold hover:underline">Download</a>
                      <button onClick={() => handleDelete(doc.id)} className="text-xs text-red-400 font-semibold hover:text-red-600">Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
