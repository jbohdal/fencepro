/**
 * Install packet for the crew: what the app sends when "Send install packet"
 * is tapped on a sold job, and the block on the job that sends, opens,
 * texts, emails or turns off the link. The packet itself is a page served
 * at /p/i/<link> (routes/installPacket.ts); it never shows prices.
 */

import { styleLabel } from './fenceCatalog'
import { useEffect, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Send, ExternalLink, MessageSquare, Mail, Copy } from 'lucide-react'
import SitePlan from './SitePlan'
import { bakedBackdrop } from './aerialBake'
import type { AerialBackdrop } from './sitePlanPhoto'
import { buildPlan } from './sitePlanGeometry'
import { deriveLayout, formatFtIn, postSpacing, GATE_LABEL } from './yardLayout'
import { gateWhereText } from './gateSlide'
import { quotePlanWidth } from './QuotePlan'
import { savedRunSections } from './quoteCalc'
import { listMedia, type ServerMedia } from './mediaStore'
import { fetchWithAuth } from './crmAuth'
import { LOCAL_API_ORIGIN } from './apiOrigin'
import { getConfig } from './configStore'
import { toast } from './toast'
import type { SavedQuote } from './QuotesPage'

const API = (typeof window !== 'undefined' && window.location.hostname === 'localhost' ? LOCAL_API_ORIGIN : '') + '/api/install-packets'

export interface PacketSnapshot {
  planSvg?: string
  style?: string
  footageFt?: number
  sections?: number
  posts?: { corners: number; ends: number; gatePosts: number }
  runs?: Array<{ label: string; length: string; sections: number; spacing: string }>
  gates?: string[]
  skips?: string[]
  pullSheet?: Array<{ item: string; qty: number }>
  crewNotes?: string[]
  notes?: string
  companyName?: string
  companyPhone?: string
  /** A fence move or repair: what to do, in order; the gate hardware; whether new posts need an 811 ticket. */
  work?: { type: 'move' | 'repair'; title: string; steps: string[]; gateHardware: string[]; needs811: boolean }
}

/** Everything the crew needs from the quote, without a single price. */
export function buildPacketSnapshot(job: { fenceStyle?: string; notes?: string; walkGates?: number; dblGates?: number }, quote: SavedQuote | undefined, media: ServerMedia[], photo: AerialBackdrop | null = null): PacketSnapshot {
  const cfg = getConfig()
  const snap: PacketSnapshot = { style: styleLabel(quote?.fenceStyle || job.fenceStyle), companyName: cfg.company?.name || 'Getter Done Fence', companyPhone: cfg.company?.phone || '' }
  const notes = [job.notes, quote?.notes].filter(n => n && n.trim()).join('\n')
  if (notes) {
    // Notes said by voice as "Crew note: …" are listed on their own.
    const lines = notes.split('\n')
    snap.crewNotes = lines.filter(l => /^crew note:/i.test(l)).map(l => l.replace(/^crew note:\s*/i, ''))
    snap.notes = lines.filter(l => !/^crew note:/i.test(l)).join('\n').trim() || undefined
  }
  if (!quote) return snap
  const runs = quote.runs ?? []
  const styleCfg = cfg.fenceStyles.find(s => s.name === quote.fenceStyle)
  const sections = savedRunSections(quote, styleCfg?.panelWidth)
  const yard = quote.layout?.yard ?? null
  // A gate "near the house / corner" sits one panel of the style in, as the builder placed it.
  const plan = yard ? quotePlanWidth(yard, quote, styleCfg) : null
  const derived = yard ? deriveLayout(yard, plan!.nearIn) : null
  const named = derived && derived.runs.length === runs.length ? derived.runs : null
  snap.runs = runs.map((ft, i) => ({
    label: named ? (named[i].pieces > 1 ? `${named[i].sideName} (${named[i].piece} of ${named[i].pieces})` : named[i].sideName) : `Run ${i + 1}`,
    length: formatFtIn(ft * 12), sections: sections[i] ?? 0, spacing: postSpacing(ft, sections[i] ?? 0),
  }))
  snap.footageFt = runs.reduce((s, n) => s + n, 0)
  snap.sections = sections.reduce((s, n) => s + n, 0)
  const gatePosts = derived ? derived.counted.gatePosts : 2 * ((quote.walkGates ?? 0) + (quote.dblGates ?? 0))
  snap.posts = { corners: quote.corners ?? 0, ends: quote.ends ?? 0, gatePosts: Math.min(gatePosts, quote.ends ?? gatePosts) }
  // Parts only: a money line (wood material) is not something to load.
  snap.pullSheet = (quote.pullSheet ?? []).filter(i => !i.moneyOnly).map(i => ({ item: i.item, qty: i.qty }))
  if (quote.work) {
    snap.work = {
      type: quote.work.type, title: quote.work.type === 'move' ? 'Fence move: what to do' : 'Repair: what to do', steps: quote.work.crew,
      gateHardware: (quote.pullSheet ?? []).filter(i => !i.moneyOnly && /hinge|latch|\bfork\b/i.test(i.item)).map(i => `${i.qty} × ${i.item.replace(/^\*+/, '')}`),
      needs811: quote.work.needs811,
    }
  }
  if (yard && derived) {
    snap.gates = []; snap.skips = []
    // Swing and hinge come from the drawing (left / right as seen from inside the yard).
    const planGates = new Map(buildPlan(yard, derived, undefined, plan!.widthFt).sides.map(p => [p.sideId, p.gate]))
    yard.sides.forEach((s, i) => {
      if (!s.on) return
      const r = derived.sides[i]
      if (s.gate && r.gateAtIn != null) {
        // Both ways, by the side's real ends: "Back: 5 ft walk gate, 12 ft from the Left side corner, 31 ft to the Right side corner".
        const where = gateWhereText(yard, i, plan!.nearIn) ?? `${formatFtIn(s.gate.widthIn)} ${GATE_LABEL[s.gate.type].toLowerCase()}`
        snap.gates!.push(`${s.name}: ${where}; ${planGates.get(s.id)?.swingText ?? 'swings in'} (as seen from inside the yard)`)
      }
      if (s.skip && r.skipAtIn != null) snap.skips!.push(`${s.name}: ${formatFtIn(s.skip.lengthIn)} ${s.skip.kind === 'existing' ? 'existing fence' : 'with no fence'}, starting ${formatFtIn(r.skipAtIn)} from the start of the side`)
    })
    // The plan with the photo pins the crew can see.
    const pins = media.filter(m => m.pin && (m.visibility === 'crew' || m.visibility === 'customer'))
      .map(m => ({ id: m.id, x: m.pin!.x, y: m.pin!.y, angle: m.pin!.angle ?? null }))
    const runSections = quote.layout?.runSections && quote.layout.runSections.length === derived.runs.length ? quote.layout.runSections : undefined
    const mv = quote.work?.type === 'move' ? quote.work.move : undefined
    snap.planSvg = renderToStaticMarkup(<SitePlan layout={yard} result={derived} runSections={runSections} widthFt={plan!.widthFt} pins={pins} title="Site plan" aerial={photo}
      oldLine={mv?.oldLinePlan ? { ...mv.oldLinePlan, ft: mv.oldFt, label: `Old line ${Math.round(mv.oldFt)} ft` } : null}
      damaged={quote.work?.type === 'repair' ? quote.work.repair?.tapped : undefined} />)
  } else {
    const g: string[] = []
    if (quote.walkGates) g.push(`${quote.walkGates} walk gate${quote.walkGates > 1 ? 's' : ''}`)
    if (quote.dblGates) g.push(`${quote.dblGates} double gate${quote.dblGates > 1 ? 's' : ''}`)
    snap.gates = g
  }
  return snap
}

/** The crew's link: the public door on a Tailscale address, the app's own address otherwise. */
export function packetUrl(token: string): string {
  const { protocol, hostname, origin } = window.location
  return hostname.endsWith('.ts.net') ? `${protocol}//${hostname}:8443/p/i/${token}` : `${origin}/p/i/${token}`
}

export interface Packet { id: string; token: string; disabledAt: string | null; locateTicket: string | null; locateDate: string | null; sentAt: string }

async function call<T>(path: string, init: RequestInit = {}): Promise<T | null> {
  const r = await fetchWithAuth(`${API}${path}`, { ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } }).catch(() => null)
  if (!r?.ok) return null
  const j = await r.json().catch(() => null)
  return (j?.data ?? null) as T | null
}

/**
 * Make (or refresh) a sold job's install packet: the snapshot drawn here from
 * the job, its quote and its photos, sent to the server. The packet, or null
 * when it could not be made. Used by "Send install packet" on the job and
 * "Share to crew" on a customer's pull sheet.
 */
export async function sendInstallPacket(jobId: string, job: { fenceStyle?: string; notes?: string; walkGates?: number; dblGates?: number }, quote: SavedQuote | undefined): Promise<Packet | null> {
  const media = await listMedia({ jobId })
  // The aerial photo, turned as saved with the quote, under the plan (when it was on).
  const photo = await bakedBackdrop(quote?.layout?.yard ?? null)
  const snapshot = buildPacketSnapshot(job, quote, media, photo)
  return call<Packet>('', { method: 'POST', body: JSON.stringify({ jobId, snapshot }) })
}

/** On a sold job: send the packet, then open, copy, text, email or turn it off. */
export function InstallPacketPanel({ jobId, job, quote }: { jobId: string; job: { fenceStyle?: string; notes?: string; walkGates?: number; dblGates?: number; customerName?: string }; quote: SavedQuote | undefined }) {
  const [packet, setPacket] = useState<Packet | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { call<Packet>(`?jobId=${encodeURIComponent(jobId)}`).then(setPacket) }, [jobId])

  async function send() {
    setBusy(true)
    const p = await sendInstallPacket(jobId, job, quote)
    setBusy(false)
    if (!p) { toast.error('Could not make the install packet. Try again.'); return }
    setPacket(p)
    toast.success(packet && !packet.disabledAt ? 'Install packet updated' : 'Install packet ready')
  }
  async function off() {
    if (!packet || !window.confirm('Turn off this install packet link? The crew will see a page asking them to call the office.')) return
    if (await call(`/${packet.id}/off`, { method: 'POST' })) setPacket({ ...packet, disabledAt: new Date().toISOString() })
  }

  const live = packet && !packet.disabledAt
  const url = live ? packetUrl(packet!.token) : ''
  const msg = `Install packet for ${job.customerName || 'the job'}: ${url}`
  return (
    <div className="space-y-2" data-install-packet>
      <p className="text-xs text-gray-600">A private link for the crew: plan with post spacing, counts, gates, pull sheet, photos and notes. No prices. It closes 30 days after the job is marked complete.</p>
      <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={send} data-packet-send>
        <Send size={16} aria-hidden="true" /> {live ? 'Update the install packet' : 'Send install packet'}
      </button>
      {live && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer" data-packet-open><ExternalLink size={16} aria-hidden="true" /> Open</a>
            <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success('Link copied'))}><Copy size={16} aria-hidden="true" /> Copy link</button>
            <a className="btn btn-secondary" href={`sms:?&body=${encodeURIComponent(msg)}`} data-packet-text><MessageSquare size={16} aria-hidden="true" /> Text it</a>
            <a className="btn btn-secondary" href={`mailto:?subject=${encodeURIComponent(`Install packet: ${job.customerName || ''}`)}&body=${encodeURIComponent(msg)}`}><Mail size={16} aria-hidden="true" /> Email it</a>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-600 break-all" data-packet-url>{url}</p>
            <button type="button" className="btn btn-quiet btn-sm shrink-0" onClick={off} data-packet-off>Turn off link</button>
          </div>
          {!getConfig().proposal?.publicLinks && <p className="text-xs text-amber-900 bg-amber-50 rounded-lg px-2 py-1">Right now the crew can open this only on your own phones and computers. Once outside access is set up (Settings → Proposals), it opens on any phone.</p>}
        </>
      )}
      {packet?.disabledAt && <p className="text-xs text-gray-600" data-packet-state>Link turned off. Sending again makes a new link.</p>}
      <p className="text-xs text-gray-700" data-packet-locate>811 locate: {packet?.locateTicket ? `ticket ${packet.locateTicket}${packet.locateDate ? ` on ${packet.locateDate}` : ''}` : 'not entered on the packet yet'}</p>
    </div>
  )
}
