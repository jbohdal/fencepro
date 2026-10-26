/**
 * Documents: the signed contracts and signed change orders (server
 * routes/signed-documents.ts, lib/signedDocuments.ts). Each PDF was stored the
 * moment the customer signed, with the signature, the typed name, the date and
 * time, and the IP on its last page; "PDF" opens that stored copy as it was
 * signed. Shown on the customer page (Files), the quote and the job.
 */

import { useCallback, useEffect, useState } from 'react'
import { fetchWithAuth } from './crmAuth'
import { API_ORIGIN } from './syncHttp'
import { toast } from './toast'

export interface SignedDocumentRow {
  id: string
  kind: 'contract' | 'change_order'
  title: string
  detail: string
  signedAt: string
  signedOn: string
  signedBy: string
  quoteId: string
  jobId: string | null
  changeOrderId: string | null
  inPortal: boolean
  portalFileId: string | null
  pdf: string
}

export type SignedFor = { customerId: string } | { quoteId: string } | { jobId: string }

/** The signed documents of a customer, quote or job; null when they could not be loaded. */
export async function loadSignedDocuments(which: SignedFor): Promise<SignedDocumentRow[] | null> {
  const [k, v] = Object.entries(which)[0]
  const r = await fetchWithAuth(`${API_ORIGIN}/api/signed-documents?${k}=${encodeURIComponent(v)}`).catch(() => null)
  if (!r?.ok) return null
  const j = await r.json().catch(() => null)
  return j?.success ? (j.data as SignedDocumentRow[]) : null
}

/** Open the stored signed PDF in a new tab (it needs the staff sign in, so it is fetched, then shown). */
export async function openSignedPdf(d: Pick<SignedDocumentRow, 'pdf' | 'kind'>): Promise<void> {
  const tab = window.open('', '_blank')
  const r = await fetchWithAuth(`${API_ORIGIN}${d.pdf}`).catch(() => null)
  if (!r?.ok) { tab?.close(); toast.error(`Could not open the signed ${d.kind === 'contract' ? 'contract' : 'change order'}`, 'Check the connection and try again.'); return }
  const u = URL.createObjectURL(await r.blob())
  if (tab) tab.location.href = u; else window.location.href = u
}

export default function SignedDocuments({ which, heading = 'Documents', hideWhenEmpty = false, onLoaded }: {
  which: SignedFor
  heading?: string
  /** On a quote or job with nothing signed: show nothing. */
  hideWhenEmpty?: boolean
  onLoaded?: (rows: SignedDocumentRow[]) => void
}) {
  const [rows, setRows] = useState<SignedDocumentRow[] | null | undefined>(undefined)
  const key = JSON.stringify(which)
  const reload = useCallback(() => {
    // One quiet retry after a moment (a dropped signal, the server restarting) before saying it could not load.
    const once = () => loadSignedDocuments(JSON.parse(key))
    once().then(r => r ?? new Promise<SignedDocumentRow[] | null>(res => setTimeout(() => once().then(res), 2500)))
      .then(r => { setRows(r); if (r) onLoaded?.(r) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  useEffect(() => { reload() }, [reload])

  if (hideWhenEmpty && (!rows || rows.length === 0)) return null
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-3" data-signed-docs>
      <h3 className="text-sm font-semibold text-gray-900 mb-2">{heading}</h3>
      {rows === undefined && <p className="text-xs text-gray-500">Loading the signed documents…</p>}
      {rows === null && <p className="text-xs text-red-700">Could not load the signed documents. Check the connection. <button type="button" className="underline min-h-[48px]" onClick={reload}>Try again</button></p>}
      {rows && rows.length === 0 && <p className="text-xs text-gray-500" data-signed-docs-empty>Nothing signed yet. A contract or change order the customer signs shows here with its signed PDF.</p>}
      {rows && rows.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {rows.map(d => (
            <li key={d.id} className="py-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-signed-doc={d.id} data-signed-doc-kind={d.kind}>
              <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full border ${d.kind === 'contract' ? 'bg-purple-50 text-purple-800 border-purple-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
                {d.kind === 'contract' ? 'Contract' : 'Change order'}
              </span>
              <div className="flex-1 min-w-[180px]">
                <p className="text-sm font-medium text-gray-900 break-words" data-signed-doc-title>{d.detail || d.title}</p>
                <p className="text-xs text-gray-600" data-signed-doc-signed>Signed {d.signedOn} by {d.signedBy}{d.inPortal ? ' · a copy is in their customer portal' : ''}</p>
              </div>
              <button type="button" className="btn btn-secondary min-h-[48px] shrink-0" onClick={() => openSignedPdf(d)} data-signed-doc-open>
                {d.kind === 'contract' ? 'Signed contract (PDF)' : 'Signed change order (PDF)'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * The quote builder's header on a signed quote: one button per stored signed
 * PDF ("Signed contract (PDF)", "Change order #2 (PDF)") with who signed and
 * when. Nothing while there is none.
 */
export function SignedDocumentLinks({ quoteId }: { quoteId: string }) {
  const [rows, setRows] = useState<SignedDocumentRow[]>([])
  useEffect(() => { loadSignedDocuments({ quoteId }).then(r => setRows(r ?? [])) }, [quoteId])
  if (!rows.length) return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 mt-0.5" data-signed-doc-links>
      {rows.map(d => (
        <button key={d.id} type="button" className="text-xs font-semibold text-purple-700 underline min-h-[48px] md:min-h-0 text-left" onClick={() => openSignedPdf(d)}
          title={`Signed ${d.signedOn} by ${d.signedBy}`} data-signed-doc-link={d.id} data-signed-doc-kind={d.kind}>
          {d.kind === 'contract' ? 'Signed contract (PDF)' : `${d.title} (PDF)`}
          <span className="font-normal text-gray-600 no-underline"> · signed {d.signedOn} by {d.signedBy}</span>
        </button>
      ))}
    </div>
  )
}
