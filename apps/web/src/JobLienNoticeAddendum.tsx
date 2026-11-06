/**
 * Florida's lien notice (713.015) addendum on the job page (Jonathan, Nov 6 2026): "prepare the signed notice
 * addendum for the 11 contracts not installed yet, locked until I mark it attorney reviewed; don't send until then.
 * Leave the installed ones alone." Shown only on a job whose contract was signed over $2,500 without the notice and
 * is not installed yet (or one already sent). Owner and office (billing.change).
 *
 *   Locked     the send buttons say why; the owner can read the words and mark it reviewed by an attorney
 *   Ready      Email it (the server's email), Text it (this phone's own messages), Copy link
 *   Sent       how and when; opened; send again
 *   Signed     who and when; the signed copy is with the contract's Documents below
 *
 * Server: routes/lienAddenda.ts, lib/lienNoticeAddendum.ts. Nothing is kept in the browser.
 */

import { useEffect, useState, type ReactNode } from 'react'
import { MessageSquare, Mail, Copy, Lock } from 'lucide-react'
import { toast } from './toast'
import { signedInRole } from './permissions'
import { getConfig } from './configStore'
import { smsLink } from './appointmentLogic'
import { customerText } from '../../portal/src/server/lib/customerText'
import { openSignedPdf } from './SignedDocuments'
import { addendumOf, sendAddendum, markAddendumReviewed, money, usDate, ADDENDUM_STATE_LABEL, type AddendumView } from './subsApi'

const when = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const CHANNEL: Record<string, string> = { email: 'by email', text: 'by text', copy: 'link copied' }
const TONE: Record<string, string> = { locked: 'bg-red-100 text-red-800', ready: 'bg-amber-100 text-amber-900', sent: 'bg-blue-100 text-blue-800', signed: 'bg-green-100 text-green-800' }

export default function JobLienNoticeAddendum({ jobId, wrap = c => c }: { jobId: string; wrap?: (children: ReactNode) => ReactNode }) {
  const [v, setV] = useState<AddendumView | null>(null)
  const [busy, setBusy] = useState('')
  const [link, setLink] = useState('')
  const load = () => { void addendumOf(jobId).then(r => { if (r.ok) setV(r.data) }) }
  useEffect(load, [jobId])
  if (!v || !v.applies) return null
  const owner = signedInRole() === 'super_admin'
  const locked = !v.reviewed
  const a = v.addendum
  const customer = v.customer

  async function send(channel: 'email' | 'text' | 'copy') {
    setBusy(channel)
    const r = await sendAddendum(jobId, channel)
    setBusy('')
    if (!r.ok) { toast.error('Not sent', r.error); load(); return }
    setV(r.data.view); setLink(r.data.link)
    if (channel === 'text') {
      // The text in the registered form: "Company: ... Reply STOP to opt out." (lib/customerText.ts).
      window.location.href = smsLink(customer.phone, customerText(r.data.message, getConfig().company?.name))
      return
    }
    if (channel === 'copy') { await navigator.clipboard?.writeText(r.data.link).catch(() => {}); toast.success('Link copied'); return }
    if (r.data.sent) toast.success('Emailed', `To ${customer.email}`)
    else toast.error('Not emailed', r.data.how)
  }

  async function review(on: boolean) {
    if (on && !window.confirm("Mark the lien notice addendum reviewed by your attorney? The office can then send it to each customer on the list to sign.")) return
    if (!on && !window.confirm('Take the review mark off? Nothing can be sent, and the customer links show nothing, until you mark it again.')) return
    setBusy('review')
    const r = await markAddendumReviewed(on)
    setBusy('')
    if (!r.ok) { toast.error('Not changed', r.error); return }
    load()
  }

  return wrap(
    <div className="rounded-xl border border-gray-200 bg-white p-3 space-y-2 min-w-0" data-job-lien-addendum={v.state}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-gray-900">Florida lien notice addendum (713.015)</p>
        <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap ${TONE[v.state]}`} data-addendum-state>{ADDENDUM_STATE_LABEL[v.state]}</span>
      </div>
      <p className="text-xs text-gray-700">This contract was signed{v.contract.signedOn ? ` ${usDate(v.contract.signedOn)}` : ''} for {money(v.contract.priceCents)} without Florida's lien notice. The addendum is prepared: one page with the notice, naming this contract, for the customer to sign on their link.</p>
      {v.state === 'signed' && a?.signedAt && (
        <div className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-900" data-addendum-signed>
          Signed by {a.signedBy} on {when(a.signedAt)}. The signed copy is with the contract's Documents.
          {a.signedDocumentId && <button type="button" className="block underline min-h-[44px]" onClick={() => void openSignedPdf({ pdf: `/api/signed-documents/${a.signedDocumentId}/pdf`, kind: 'lien_notice' })} data-addendum-open-signed>Open the signed copy</button>}
        </div>
      )}
      {a?.sentAt && v.state !== 'signed' && <p className="text-xs text-gray-700" data-addendum-sent>Sent {when(a.sentAt)}{a.sentChannel ? ` (${CHANNEL[a.sentChannel] ?? a.sentChannel})` : ''}{a.sentBy ? ` by ${a.sentBy}` : ''}{a.openCount ? ` · opened ${a.openCount} time${a.openCount === 1 ? '' : 's'}` : ' · not opened yet'}</p>}
      {locked && v.state !== 'signed' && (
        <p className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-900 flex items-start gap-2" data-addendum-locked><Lock size={16} className="shrink-0 mt-0.5" aria-hidden="true" />{v.lockedWhy}</p>
      )}
      {v.state !== 'signed' && (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-primary" disabled={locked || !!busy || !v.customer.phone} title={locked ? v.lockedWhy ?? '' : ''} onClick={() => void send('text')} data-addendum-text><MessageSquare size={16} aria-hidden="true" /> Text it</button>
          <button type="button" className="btn btn-secondary" disabled={locked || !!busy || !v.customer.email} title={locked ? v.lockedWhy ?? '' : ''} onClick={() => void send('email')} data-addendum-email><Mail size={16} aria-hidden="true" /> {busy === 'email' ? 'Emailing…' : 'Email it'}</button>
          <button type="button" className="btn btn-secondary col-span-2" disabled={locked || !!busy} title={locked ? v.lockedWhy ?? '' : ''} onClick={() => void send('copy')} data-addendum-copy><Copy size={16} aria-hidden="true" /> Copy link</button>
        </div>
      )}
      {!locked && v.state !== 'signed' && (!v.customer.phone || !v.customer.email) && <p className="text-xs text-gray-600">{[!v.customer.phone ? 'Text it: add a phone number to the customer first.' : '', !v.customer.email ? 'Email it: add an email to the customer first.' : ''].filter(Boolean).join(' ')}</p>}
      {link && v.state !== 'signed' && <p className="text-xs text-gray-500 break-all" data-addendum-link>{link}</p>}
      <details>
        <summary className="text-xs text-gray-700 underline min-h-[44px] flex items-center">Read the addendum</summary>
        <div className="rounded-lg bg-gray-50 p-3 space-y-2" data-addendum-words>
          <p className="text-xs text-gray-700">{v.contractLine}</p>
          <p className="text-xs font-bold uppercase text-gray-900">{v.notice}</p>
          <p className="text-xs text-gray-600">Then the customer's typed name, finger signature and the date.</p>
        </div>
      </details>
      {owner && v.state !== 'signed' && (
        <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
          <span className="text-xs text-gray-600" data-addendum-review>{v.reviewed ? `Reviewed by ${v.reviewed.by} ${when(v.reviewed.at)}` : 'Attorney review required'}</span>
          <button type="button" className="btn btn-secondary !min-h-[44px]" disabled={!!busy} onClick={() => void review(!v.reviewed)} data-addendum-mark>{v.reviewed ? 'Take the review mark off' : 'Mark reviewed by attorney'}</button>
        </div>
      )}
    </div>
  )
}
