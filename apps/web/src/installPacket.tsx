/**
 * Install packet for the crew: what the app sends when "Send install packet"
 * is tapped on a sold job, and the block on the job that sends, opens,
 * texts, emails or turns off the link. The packet itself is a page served
 * at /p/i/<link> (routes/installPacket.ts); it never shows prices.
 */

import { can } from './permissions'
import { locateOf, locateWords } from '../../portal/src/server/lib/locates'
import { getJob, refreshJobs } from './jobStore'
import { reloadSchedule } from './scheduleStore'
import { businessDate } from './businessDate'
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
import { refreshChangeOrders, quoteWithChanges, signedQuoteOf, CO_EVENT } from './ChangeOrders'
import { partWithPair } from '../../portal/src/server/lib/partNames'
import { installWord } from './moveRepair'

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

/**
 * The job's and the quote's notes, each line once: a job made from a quote
 * starts with the quote's notes, so the packet printed them twice
 * (walkthrough, Oct 24, 2026).
 */
export function packetNoteLines(...texts: Array<string | null | undefined>): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of texts) {
    for (const line of String(t ?? '').split('\n')) {
      const key = line.trim().replace(/\s+/g, ' ').toLowerCase()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(line.trimEnd())
    }
  }
  return out
}

/** Everything the crew needs from the quote, without a single price. */
export function buildPacketSnapshot(job: { fenceStyle?: string; notes?: string; walkGates?: number; dblGates?: number }, quote: SavedQuote | undefined, media: ServerMedia[], photo: AerialBackdrop | null = null): PacketSnapshot {
  const cfg = getConfig()
  const snap: PacketSnapshot = { style: styleLabel(quote?.fenceStyle || job.fenceStyle), companyName: cfg.company?.name || 'Getter Done Fence', companyPhone: cfg.company?.phone || '' }
  const notes = packetNoteLines(job.notes, quote?.notes).join('\n')
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
      gateHardware: (quote.pullSheet ?? []).filter(i => !i.moneyOnly && /hinge|latch|\bfork\b/i.test(i.item)).map(i => `${i.qty} × ${partWithPair(i.item).replace(/^\*+/, '')}`),
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

/** "Change order CO-1 changed the work (added 10 ft)" / "Change orders CO-1 (added 10 ft) and CO-2 (added a walk gate) changed the work". */
export function packetChangedWords(c: NonNullable<Packet['changedBy']>): string {
  const all = c.all?.length ? c.all : [{ number: c.number, what: c.what }]
  if (all.length === 1) return `Change order CO-${all[0].number} changed the work (${all[0].what})`
  const bits = all.map(a => `CO-${a.number} (${a.what})`)
  return `Change orders ${bits.slice(0, -1).join(', ')} and ${bits[bits.length - 1]} changed the work`
}

export interface Packet { id: string; token: string; disabledAt: string | null; sentAt: string; changedBy?: { number: number; what: string; all?: Array<{ number: number; what: string }> } | null }

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
export async function sendInstallPacket(jobId: string, job: { fenceStyle?: string; notes?: string; walkGates?: number; dblGates?: number }, signedQuote: SavedQuote | undefined): Promise<Packet | null> {
  // The work now: an approved change order from the yard drawing changes the plan, runs, gates and pull sheet (ChangeOrders.tsx).
  let quote = signedQuote
  if (quote) {
    const orders = await refreshChangeOrders(quote.id)
    if (orders) quote = quoteWithChanges(signedQuoteOf(quote))
    else {
      // This login may not read change orders (the installer sees no prices): the work now, price free, from the packet route.
      const w = await call<{ number: number; work: any } | null>(`/work?jobId=${encodeURIComponent(jobId)}`)
      if (w?.work) quote = { ...quote, ...w.work, layout: w.work.layout ?? quote.layout, pullSheet: (w.work.pullSheet ?? []).map((l: any) => ({ item: l.item, qty: l.qty, unitCost: 0, total: 0 })), proposal: quote.proposal ? { ...quote.proposal, ...(w.work.planSvg ? { planSvg: w.work.planSvg } : {}) } : quote.proposal } as SavedQuote
    }
  }
  if (quote && (quote.walkGates !== signedQuote?.walkGates || quote.dblGates !== signedQuote?.dblGates)) job = { ...job, walkGates: quote.walkGates, dblGates: quote.dblGates }
  const media = await listMedia({ jobId })
  // The aerial photo, turned as saved with the quote, under the plan (when it was on).
  const photo = await bakedBackdrop(quote?.layout?.yard ?? null)
  const snapshot = buildPacketSnapshot(job, quote, media, photo)
  return call<Packet>('', { method: 'POST', body: JSON.stringify({ jobId, snapshot }) })
}

// ── The installer's home (InstallerHome.tsx) ─────────────────────────────────

export interface InstallTime { kind: 'start' | 'finish'; at: string; by: string; day: string; jobDone?: boolean }
export interface CrewInstall {
  packet: { token: string } | null; customerNotes: string[]; times: InstallTime[]
  /** The job's last crew day; whether the crew finished the whole job; the 811 locate in words (null: none on the job). */
  lastDay?: string | null; jobDone?: boolean; locate?: { status: string; text: string; ticket: string | null; warning?: string | null } | null
  /** The crew days booked, in order ("Finished day 1 of 2"). */
  crewDays?: string[]
  /** Where the close out stands: closed (Complete or Paid), the final walkthrough signed, paid in full. Never an amount. */
  closeOut?: { closed: boolean; walkthroughSigned: boolean; paidInFull: boolean } | null
  /** Starts made while 811 was not clear (he was warned and went ahead): who, when and the warning. */
  locateWarned?: Array<{ at: string; by: string; text: string }>
}

// Start and Finish in words, and the installer's "Job finished" from the real close out (crewWords.ts).
export { finishWords, jobDoneWords } from './crewWords'
import { finishWords } from './crewWords'

/**
 * One copy per job for every card of it on the installer's home (day 1 and
 * day 2 of a job are two cards): a packet made, or a tap, on one card shows
 * on the other at once (round 2, Oct 26 2026: day 2 still said "Make the crew
 * packet" after day 1's was made).
 */
const crewCache = new Map<string, CrewInstall>()
export const CREW_INSTALL_EVENT = 'ezbiz:crew-install'
export function crewInstallCached(jobId: string): CrewInstall | null { return crewCache.get(jobId) ?? null }
export function putCrewInstall(jobId: string, patch: Partial<CrewInstall>): void {
  const was = crewCache.get(jobId)
  crewCache.set(jobId, { packet: null, customerNotes: [], times: [], ...was, ...patch })
  window.dispatchEvent(new CustomEvent(CREW_INSTALL_EVENT, { detail: { jobId } }))
}

/** A service or warranty visit booked with the signed in login (server lib/crewVisits.ts). Never a price. */
export interface CrewVisit {
  id: string; type: string; startAt: string; endAt: string | null; allDay: boolean; day: string
  customerName: string; customerPhone: string; address: string; notes: string
  ticket: { id: string; issue: string; notes: string; covered: boolean; warrantyName: string; photos: Array<{ id: string; kind: string; thumb: string | null; url: string }> } | null
  packetToken: string | null
}
/** His visits from today on; null with no signal. */
export async function fetchCrewVisits(): Promise<CrewVisit[] | null> {
  return call<CrewVisit[]>('/visits')
}

/** An install's packet link, the customer's notes, Start / Finish so far and the job's finish; null with no signal. */
export async function fetchCrewInstall(jobId: string): Promise<CrewInstall | null> {
  const r = await call<CrewInstall>(`/crew/${encodeURIComponent(jobId)}`)
  if (r) putCrewInstall(jobId, r)
  return r
}

/**
 * Start or Finish on an install (needs signal: the time is the server's).
 * `jobDone`: "Finished the job" on a day before the last one (Finish on the
 * last crew day is the job finished anyway). What the server has after, or null.
 */
export async function markInstall(jobId: string, kind: 'start' | 'finish', jobDone = false): Promise<(Partial<CrewInstall> & { times: InstallTime[] }) | null> {
  const r = await call<Partial<CrewInstall> & { times: InstallTime[] }>(`/crew/${encodeURIComponent(jobId)}/${kind}`, { method: 'POST', body: JSON.stringify(jobDone ? { jobDone: true } : {}) })
  if (r) putCrewInstall(jobId, r)
  // Start moves the job to In Progress, Finish can close it out (on the server): read the jobs again.
  if (r) void refreshJobs()
  // The whole job finished early: its later crew days came off the Schedule (on the server); read it again.
  if (r && jobDone) void reloadSchedule()
  return r ?? null
}

/** On a sold job: send the packet, then open, copy, text, email or turn it off. */
export function InstallPacketPanel({ jobId, job, quote }: { jobId: string; job: { fenceStyle?: string; notes?: string; walkGates?: number; dblGates?: number; customerName?: string }; quote: SavedQuote | undefined }) {
  const [packet, setPacket] = useState<Packet | null>(null)
  const [busy, setBusy] = useState(false)
  const [crewInfo, setCrewInfo] = useState<CrewInstall | null>(() => crewInstallCached(jobId))
  const times = crewInfo?.times ?? []
  // A repair's packet is the "Repair packet" (workWords.ts installWord; recheck Oct 27 2026).
  const W = installWord(quote?.work), w = W.toLowerCase()
  useEffect(() => {
    let live = true
    void call<Packet>(`?jobId=${encodeURIComponent(jobId)}`).then(p => { if (live) setPacket(p) })
    // A change order signed since the packet was sent: the notice above the packet shows it without a reload
    // (a read that fails keeps what is on screen).
    const again = () => { void call<Packet>(`?jobId=${encodeURIComponent(jobId)}`).then(p => { if (live && p) setPacket(p) }) }
    window.addEventListener(CO_EVENT, again)
    return () => { live = false; window.removeEventListener(CO_EVENT, again) }
  }, [jobId])
  useEffect(() => {
    let live = true
    const h = (e: Event) => { if ((e as CustomEvent<{ jobId: string }>).detail?.jobId === jobId && live) setCrewInfo(crewInstallCached(jobId)) }
    window.addEventListener(CREW_INSTALL_EVENT, h)
    void fetchCrewInstall(jobId)
    return () => { live = false; window.removeEventListener(CREW_INSTALL_EVENT, h) }
  }, [jobId])

  async function send() {
    setBusy(true)
    const p = await sendInstallPacket(jobId, job, quote)
    setBusy(false)
    if (!p) { toast.error(`Could not make the ${w} packet. Try again.`); return }
    setPacket(p)
    toast.success(packet && !packet.disabledAt ? `${W} packet updated` : `${W} packet ready`)
  }
  async function off() {
    if (!packet || !window.confirm(`Turn off this ${w} packet link? The crew will see a page asking them to call the office.`)) return
    if (await call(`/${packet.id}/off`, { method: 'POST' })) setPacket({ ...packet, disabledAt: new Date().toISOString() })
  }

  const live = packet && !packet.disabledAt
  const office = can('packets.change')
  const url = live ? packetUrl(packet!.token) : ''
  const msg = `${W} packet for ${job.customerName || 'the job'}: ${url}`
  return (
    <div className="space-y-2" data-install-packet>
      <p className="text-xs text-gray-600">A private link for the crew: plan with post spacing, counts, gates, pull sheet, photos and notes. No prices. It closes 30 days after the job is marked complete.</p>
      {/* Every change order signed since the packet was sent, not only the last (round 3 recheck). */}
      {live && packet?.changedBy && <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5" data-packet-outdated>{packetChangedWords(packet.changedBy)} after this packet was sent. The crew's link already shows the new pull sheet; update the packet for the new site plan.</p>}
      {/* The office sends and updates the packet; the crew may only make a job's first one. */}
      {(office || !live) && <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={send} data-packet-send>
        <Send size={16} aria-hidden="true" /> {live ? `Update the ${w} packet` : `Send ${w} packet`}
      </button>}
      {live && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <a className="btn btn-secondary" href={url} target="_blank" rel="noreferrer" data-packet-open><ExternalLink size={16} aria-hidden="true" /> Open</a>
            <button type="button" className="btn btn-secondary" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success('Link copied'))}><Copy size={16} aria-hidden="true" /> Copy link</button>
            <a className="btn btn-secondary" href={`sms:?&body=${encodeURIComponent(msg)}`} data-packet-text><MessageSquare size={16} aria-hidden="true" /> Text it</a>
            <a className="btn btn-secondary" href={`mailto:?subject=${encodeURIComponent(`${W} packet: ${job.customerName || ''}`)}&body=${encodeURIComponent(msg)}`}><Mail size={16} aria-hidden="true" /> Email it</a>
          </div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-gray-600 break-all" data-packet-url>{url}</p>
            {office && <button type="button" className="btn btn-quiet btn-sm shrink-0" onClick={off} data-packet-off>Turn off link</button>}
          </div>
          {!getConfig().proposal?.publicLinks && <p className="text-xs text-amber-900 bg-amber-50 rounded-lg px-2 py-1">Right now the crew can open this only on your own phones and computers. Once outside access is set up (Settings → Proposals), it opens on any phone.</p>}
        </>
      )}
      {packet?.disabledAt && <p className="text-xs text-gray-600" data-packet-state>Link turned off. Sending again makes a new link.</p>}
      {/* The packet shows and edits the job's own 811 locate (the 811 locate section on this page). */}
      {live && <p className="text-xs text-gray-700" data-packet-locate>811 locate on the packet: {locateWords(locateOf(getJob(jobId)), businessDate(new Date())).text}. The crew can fill it in there; it is the same locate as on this page.</p>}
      {/* Start and Finish from the installer's home (InstallerHome.tsx). */}
      <div className="text-xs text-gray-700" data-job-install-times>
        <p className="font-semibold">{W} times</p>
        {times.length === 0 ? <p>The crew has not tapped Start yet.</p> : (
          <ul>{times.map(t => <li key={t.at} data-install-time={t.kind}>{finishWords(t, crewInfo)} {new Date(t.at).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {t.by}</li>)}</ul>
        )}
        {/* Started while 811 was not clear: he was warned on his phone and went ahead. */}
        {(crewInfo?.locateWarned ?? []).map(w => <p key={w.at} className="mt-1 rounded-lg bg-red-50 border border-red-200 px-2 py-1 text-red-900" data-install-locate-warned>⚠ {w.text} ({w.by}, {new Date(w.at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})</p>)}
      </div>
    </div>
  )
}
