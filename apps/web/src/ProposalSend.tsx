/**
 * On a saved quote: open, text, email or copy the customer's proposal link,
 * and what the customer chose once they accept. Texts and emails go from the
 * salesman's own phone or mail app; nothing is sent by a service.
 */

import { useState } from 'react'
import { ExternalLink, MessageSquare, Mail, Copy } from 'lucide-react'
import type { SavedQuote } from './QuotesPage'
import { issueShareToken, turnOffShare } from './savedQuotesApi'
import { proposalUrl } from './proposal'
import { smsLink } from './appointmentLogic'
import { getConfig } from './configStore'
import { toast } from './toast'

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
    const u = await link()
    if (!u) return
    if (kind === 'open') window.open(u, '_blank', 'noopener')
    if (kind === 'text') window.location.href = smsLink(quote.customerPhone || '', message(u))
    if (kind === 'email') window.location.href = `mailto:${encodeURIComponent(quote.customerEmail || '')}?subject=${encodeURIComponent(`Your fence proposal from ${company}`)}&body=${encodeURIComponent(message(u))}`
    if (kind === 'copy') { await navigator.clipboard?.writeText(u).catch(() => {}); toast.success('Link copied') }
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
      {chosen && (
        <p className="rounded-lg bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-900" data-proposal-chosen>
          Accepted by {quote.acceptedBy} on {new Date(quote.acceptedAt!).toLocaleDateString()}: {chosen.label}, ${Math.round(chosen.finalPrice).toLocaleString('en-US')}.
        </p>
      )}
      <p className="text-sm text-gray-700">{p.options.length} option{p.options.length === 1 ? '' : 's'} offered{p.depositPct ? `, ${p.depositPct}% deposit` : ''}{p.financing ? `, financing over ${p.financing.months} months` : ''}.</p>
      {!cfg.proposal?.publicLinks && (
        <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900" data-proposal-private>
          Customers cannot open proposal links yet: the public door for proposals is off. The link works on your own devices. Turn it on in Settings → Proposals once it is set up.
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => go('open')} data-proposal-open><ExternalLink size={16} aria-hidden="true" /> Open</button>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => go('copy')}><Copy size={16} aria-hidden="true" /> Copy link</button>
        <button type="button" className="btn btn-primary" disabled={busy || !quote.customerPhone} onClick={() => go('text')} data-proposal-text><MessageSquare size={16} aria-hidden="true" /> Text it</button>
        <button type="button" className="btn btn-secondary" disabled={busy || !quote.customerEmail} onClick={() => go('email')}><Mail size={16} aria-hidden="true" /> Email it</button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-gray-600" data-link-state>{linkLine}</p>
        {hasLink && !offAt && !expired && <button type="button" className="btn btn-quiet btn-sm" disabled={busy} onClick={turnOff} data-link-off>Turn off link</button>}
      </div>
      {url && <p className="text-xs text-gray-500 break-all">{url}</p>}
    </div>
  )
}
