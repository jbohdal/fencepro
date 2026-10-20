/**
 * On a saved quote: open, text, email or copy the customer's proposal link,
 * and what the customer chose once they accept. Texts and emails go from the
 * salesman's own phone or mail app; nothing is sent by a service.
 */

import { useEffect, useState } from 'react'
import { ExternalLink, MessageSquare, Mail, Copy } from 'lucide-react'
import type { SavedQuote } from './QuotesPage'
import { issueShareToken, turnOffShare } from './savedQuotesApi'
import { proposalUrl } from './proposal'
import { smsLink } from './appointmentLogic'
import { getConfig } from './configStore'
import { toast } from './toast'
import { updateQuote } from './quoteStore'
import { listMedia, localMedia } from './mediaStore'
import { moveRepairSettings } from './moveRepair'

export default function ProposalSend({ quote }: { quote: SavedQuote }) {
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // The link as the server last said: open until a date, turned off, or none yet.
  const [expiresAt, setExpiresAt] = useState<string | null>(quote.shareExpiresAt ?? null)
  const [offAt, setOffAt] = useState<string | null>(quote.shareDisabledAt ?? null)
  const hasLink = !!quote.shareToken || !!url
  const cfg = getConfig()
  const company = cfg.company?.name || 'Getter Done Fence'
  const p = quote.proposal
  // A move or repair: at least N photos before it is sent (Settings → Moves and Repairs), or one tap to send anyway with a reason.
  const isWork = !!quote.work
  const need = isWork ? moveRepairSettings(cfg).photosRequired : 0
  const [photos, setPhotos] = useState<number | null>(isWork ? null : 0)
  const [override, setOverride] = useState(quote.work?.photoOverride ?? null)
  const [asking, setAsking] = useState(false)
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (!isWork) return
    let live = true
    Promise.all([listMedia({ quoteKey: quote.id }).catch(() => []), localMedia({ quoteKey: quote.id }).catch(() => [])])
      .then(([server, local]) => { if (live) setPhotos(server.filter(m => m.kind === 'photo').length + local.filter(m => m.meta.kind === 'photo' && !m.serverId).length) })
    return () => { live = false }
  }, [isWork, quote.id])
  const photoBlock = isWork && !override && (photos ?? 0) < need
  function sendAnyway() {
    const r = reason.trim()
    if (!r || !quote.work) return
    const o = { reason: r, at: new Date().toISOString() }
    updateQuote(quote.id, { work: { ...quote.work, photoOverride: o } })
    setOverride(o); setAsking(false)
  }
  if (!p) {
    return <p className="text-sm text-gray-600" data-proposal-missing>Open this quote and save it once to make its proposal.</p>
  }
  const first = (quote.customerName || '').split(' ')[0] || 'there'

  async function link(): Promise<string | null> {
    if (url) return url
    setBusy(true)
    const t = await issueShareToken(quote.id).catch(() => null)
    setBusy(false)
    if (!t?.shareToken) { toast.error('Could not make the link. Check the connection and try again.'); return null }
    const u = proposalUrl(t.shareToken)
    setUrl(u); setExpiresAt(t.expiresAt); setOffAt(null)
    return u
  }
  async function turnOff() {
    if (!window.confirm('Turn off this link? The customer will see a page asking them to call you. Sending it again makes a new link.')) return
    setBusy(true)
    const ok = await turnOffShare(quote.id).catch(() => false)
    setBusy(false)
    if (!ok) { toast.error('Could not turn the link off. Try again.'); return }
    setOffAt(new Date().toISOString()); setUrl(null)
    toast.success('Link turned off')
  }
  const message = (u: string) => `Hi ${first}, here is your fence proposal from ${company}. You can pick an option and sign right on your phone: ${u}`

  async function go(kind: 'open' | 'text' | 'email' | 'copy') {
    if (kind !== 'open' && photoBlock) { toast.error(`Take at least ${need} photos of the fence first, or tap Send anyway.`); return }
    const u = await link()
    if (!u) return
    if (kind === 'open') window.open(u, '_blank', 'noopener')
    if (kind === 'text') window.location.href = smsLink(quote.customerPhone || '', message(u))
    if (kind === 'email') window.location.href = `mailto:${encodeURIComponent(quote.customerEmail || '')}?subject=${encodeURIComponent(`Your fence proposal from ${company}`)}&body=${encodeURIComponent(message(u))}`
    if (kind === 'copy') { await navigator.clipboard?.writeText(u).catch(() => {}); toast.success('Link copied') }
    // Given to the customer (texted, emailed or copied to send): the quote is Sent. Opening it yourself is not.
    if (kind !== 'open' && quote.status === 'DRAFT') updateQuote(quote.id, { status: 'SENT', needsResend: false })
    // A new version (saved at today's prices) has now gone to the customer.
    else if (kind !== 'open' && quote.needsResend) updateQuote(quote.id, { needsResend: false })
  }

  const chosen = quote.acceptedAt != null && quote.chosenOption != null ? p.options[quote.chosenOption] : null
  const day = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const expired = !offAt && !!expiresAt && new Date(expiresAt).getTime() < Date.now()
  const linkLine = offAt ? `Link turned off ${day(offAt)}. Sending it again makes a new link.`
    : expired ? `Link ran out ${day(expiresAt!)}. Sending it again makes a new link.`
    : hasLink && expiresAt ? `Link works until ${day(expiresAt)}.`
    : 'No link sent yet.'
  return (
    <div className="space-y-3" data-proposal-send>
      {quote.needsResend && !quote.acceptedAt && (
        <p className="rounded-lg bg-amber-50 border border-amber-300 px-3 py-2 text-sm text-amber-900" data-proposal-needs-resend>
          This quote was saved at new prices after it was sent. Send it to the customer again.
        </p>
      )}
      {chosen && (
        <p className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-900" data-proposal-chosen>
          Accepted by {quote.acceptedBy} on {new Date(quote.acceptedAt!).toLocaleDateString()}: {chosen.label}, ${Math.round(chosen.finalPrice).toLocaleString('en-US')}.
        </p>
      )}
      <p className="text-sm text-gray-700">{p.options.length} option{p.options.length === 1 ? '' : 's'} offered{p.depositPct ? `, ${p.depositPct}% deposit` : ''}{p.financing ? `, financing over ${p.financing.months} months` : ''}.</p>
      {!cfg.proposal?.publicLinks && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900" data-proposal-private>
          Right now this link opens only on your own phones and computers, not on the customer's phone. Once outside access is set up, turn it on in Settings → Proposals.
        </p>
      )}
      {isWork && (photoBlock ? (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900 space-y-2" data-photos-needed>
          <p>{photos === null ? 'Counting photos…' : `${photos} of ${need} photos. A ${quote.work!.type === 'move' ? 'move' : 'repair'} proposal needs at least ${need} photos of the fence before it is sent (open the quote, tap the camera).`}</p>
          {!asking
            ? <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAsking(true)} data-photos-override>Send anyway</button>
            : <div className="flex gap-2"><input className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-sm" placeholder="Why (required)" value={reason} onChange={e => setReason(e.target.value)} data-photos-reason />
                <button type="button" className="btn btn-primary btn-sm" disabled={!reason.trim()} onClick={sendAnyway} data-photos-override-ok>OK</button></div>}
        </div>
      ) : override ? <p className="text-xs text-gray-600" data-photos-overridden>Sent without the photos: {override.reason}</p> : null)}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => go('open')} data-proposal-open><ExternalLink size={16} aria-hidden="true" /> Open</button>
        <button type="button" className="btn btn-secondary" disabled={busy || photoBlock} onClick={() => go('copy')} data-proposal-copy><Copy size={16} aria-hidden="true" /> Copy link</button>
        <button type="button" className="btn btn-primary" disabled={busy || !quote.customerPhone || photoBlock} onClick={() => go('text')} data-proposal-text><MessageSquare size={16} aria-hidden="true" /> Text it</button>
        <button type="button" className="btn btn-secondary" disabled={busy || !quote.customerEmail || photoBlock} onClick={() => go('email')}><Mail size={16} aria-hidden="true" /> Email it</button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-600" data-link-state>{linkLine}</p>
        {hasLink && !offAt && !expired && <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={turnOff} data-link-off>Turn off link</button>}
      </div>
      {url && <p className="text-xs text-gray-500 break-all">{url}</p>}
    </div>
  )
}
