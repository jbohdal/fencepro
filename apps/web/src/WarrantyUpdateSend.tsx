/**
 * "Send updated warranty" on a sold job (the job page's Warranty) and on a sent
 * or sold quote (the quote's Proposal block). It makes a new customer link with
 * the warranty Settings → Warranties give the customer's option now; the price,
 * the stored proposal and the signed contract do not change (server
 * lib/warrantyUpdates.ts). Text it / Email it / Copy link open this phone's own
 * apps with the message filled in; nothing is sent by a service.
 */

import { recentMoved } from './movedNotice'
import { customerText } from '../../portal/src/server/lib/customerText'
import { useEffect, useState } from 'react'
import { ShieldCheck, MessageSquare, Mail, Copy, ExternalLink } from 'lucide-react'
import { sendJson } from './syncHttp'
import { smsLink } from './appointmentLogic'
import { getConfig } from './configStore'
import { toast } from './toast'

interface W { id: string | null; name: string; text: string; term: string; years?: number }
interface UpdateOption { index: number | null; label: string; fenceStyle: string; finalPrice: number; warranty: W | null; before: W | null; changed: boolean }
interface Summary {
  id: string; token: string; kind: string; warrantyName: string; createdAt: string; createdBy: string
  sentAt: string | null; sentChannel: string | null; openCount: number; lastOpenedAt: string | null
  acknowledgedAt: string | null; acknowledgedBy: string | null; acknowledgedHow: string | null
}
interface Preview {
  quoteId: string; kind: 'signed' | 'proposal'; available: boolean; why: string; options: UpdateOption[]; chosen: number | null
  customer: { name: string; firstName: string; phone: string; email: string }; latest: Summary | null; preview?: string
}

/** The customer's link: the public door address on the Tailscale name, else this server. */
export function warrantyUpdateUrl(token: string, preview?: string | null): string {
  const { protocol, hostname, origin } = window.location
  const url = hostname.endsWith('.ts.net') ? `${protocol}//${hostname}:8443/p/wu/${token}` : `${origin}/p/wu/${token}`
  return preview ? `${url}?sp=${encodeURIComponent(preview)}` : url
}

const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
const CHANNEL: Record<string, string> = { text: 'by text', email: 'by email', copy: 'link copied' }

/** One line about the last update: sent, opened, acknowledged. */
export function updateStatus(u: Summary): string {
  const parts = [u.sentAt ? `Warranty update sent ${day(u.sentAt)}${u.sentChannel ? ` (${CHANNEL[u.sentChannel] ?? u.sentChannel})` : ''}: ${u.warrantyName}` : `Warranty update made ${day(u.createdAt)}, not sent yet: ${u.warrantyName}`]
  if (u.openCount > 0) parts.push(`opened ${u.openCount} time${u.openCount === 1 ? '' : 's'}`)
  if (u.acknowledgedAt) parts.push(u.acknowledgedHow === 'accepted' ? `accepted by ${u.acknowledgedBy} ${day(u.acknowledgedAt)}` : `acknowledged by ${u.acknowledgedBy} ${day(u.acknowledgedAt)}`)
  return parts.join(' · ')
}

export default function WarrantyUpdateSend({ quoteId, onChange }: { quoteId: string; onChange?: () => void }) {
  const [open, setOpen] = useState(false)
  const [p, setP] = useState<Preview | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  // The link made in this panel (the same link for Text it, Email it and Copy link).
  const [made, setMade] = useState<Summary | null>(null)

  useEffect(() => {
    let live = true
    sendJson('GET', `/api/warranties/quote/${encodeURIComponent(quoteId)}/update`).then(r => { if (live) setP(r.result.ok ? r.result.data as Preview : null) })
    return () => { live = false }
  }, [quoteId])

  const latest = made ?? p?.latest ?? null
  const company = getConfig().company?.name || 'Getter Done Fence'

  async function ensure(): Promise<{ s: Summary; preview: string | null } | null> {
    setBusy(true)
    const r = await sendJson('POST', `/api/warranties/quote/${encodeURIComponent(quoteId)}/update`)
    setBusy(false)
    if (!r.result.ok) { toast.error('Could not make the link', r.result.error || 'Check the connection and try again.'); return null }
    const d = r.result.data as Preview & { latest: Summary }
    setP(d); setMade(d.latest)
    return { s: d.latest, preview: d.preview ?? null }
  }

  async function go(kind: 'open' | 'text' | 'email' | 'copy') {
    const m = await ensure()
    if (!m || !p) return
    const url = warrantyUpdateUrl(m.s.token)
    if (kind === 'open') { window.open(warrantyUpdateUrl(m.s.token, m.preview), '_blank', 'noopener'); onChange?.(); return }
    const message = `Hi ${p.customer.firstName}, here is your updated warranty from ${company}: ${url}`
    // The text in the registered form: "Company: ... Reply STOP to opt out." (lib/customerText.ts).
    if (kind === 'text') window.location.href = smsLink(p.customer.phone, customerText(message, company))
    if (kind === 'email') window.location.href = `mailto:${encodeURIComponent(p.customer.email)}?subject=${encodeURIComponent(`Your updated warranty from ${company}`)}&body=${encodeURIComponent(message)}`
    if (kind === 'copy') { await navigator.clipboard?.writeText(url).catch(() => {}); toast.success('Link copied') }
    const s = await sendJson('POST', `/api/warranties/update/${encodeURIComponent(m.s.id)}/sent`, { channel: kind })
    if (s.result.ok) setMade(s.result.data as Summary)
    onChange?.()
  }

  if (p === undefined) return null
  if (p === null) return <p className="text-xs text-red-700">{recentMoved() ?? 'Could not load the warranty update. Check the connection.'}</p>
  const anyChanged = p.options.some(o => o.changed)

  return (
    <div className="space-y-2" data-warranty-update={p.kind}>
      {latest && <p className="text-xs text-gray-700" data-wu-status>{updateStatus(latest)}</p>}
      {!open ? (
        <button type="button" className="btn btn-secondary min-h-[48px]" onClick={() => setOpen(true)} data-wu-start>
          <ShieldCheck size={16} aria-hidden="true" /> Send updated warranty
        </button>
      ) : (
        <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-3 space-y-2" data-wu-panel>
          <p className="text-sm font-semibold text-gray-900">Send updated warranty</p>
          <p className="text-xs text-gray-600">
            {p.kind === 'signed'
              ? 'A new link with the warranty Settings give their option now. They type their name to acknowledge it; then this job and its Warranty Certificate use it. The price and the signed contract stay the same.'
              : 'A new link to the same proposal, prices identical, with each option\'s current warranty. The link already sent keeps working as it was sent.'}
          </p>
          {!p.available && <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-900" data-wu-why>{p.why}</p>}
          <ul className="space-y-1.5">
            {p.options.map((o, i) => (
              <li key={i} className="rounded-lg bg-white border border-gray-200 px-3 py-2 text-sm" data-wu-option={o.index ?? 'style'}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="font-medium text-gray-900">{o.label}</span>
                  <span className="text-gray-600">${Math.round(o.finalPrice).toLocaleString('en-US')} (unchanged)</span>
                </div>
                <p className="mt-1"><span className="font-semibold text-purple-800" data-wu-now>{o.warranty?.name ?? 'No warranty in Settings'}</span>
                  {o.changed ? <span className="text-xs text-gray-500"> · was {o.before?.name ?? 'none on the proposal'}</span> : <span className="text-xs text-gray-500"> · no change</span>}</p>
              </li>
            ))}
          </ul>
          {p.available && !anyChanged && <p className="text-xs text-amber-800" data-wu-nochange>They already have these warranties. You can still send the link.</p>}
          {p.available && (
            <>
              <p className="text-xs text-gray-600 border-l-2 border-purple-200 pl-2">Hi {p.customer.firstName}, here is your updated warranty from {company}: (link)</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => go('open')} data-wu-open><ExternalLink size={16} aria-hidden="true" /> Open</button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => go('copy')} data-wu-copy><Copy size={16} aria-hidden="true" /> Copy link</button>
                <button type="button" className="btn btn-primary" disabled={busy || !p.customer.phone} onClick={() => go('text')} data-wu-text><MessageSquare size={16} aria-hidden="true" /> Text it</button>
                <button type="button" className="btn btn-secondary" disabled={busy || !p.customer.email} onClick={() => go('email')} data-wu-email><Mail size={16} aria-hidden="true" /> Email it</button>
              </div>
            </>
          )}
          {made && <p className="text-xs text-gray-500 break-all" data-wu-url>{warrantyUpdateUrl(made.token)}</p>}
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>Close</button>
        </div>
      )}
    </div>
  )
}
