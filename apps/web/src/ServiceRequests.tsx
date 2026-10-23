/**
 * Warranty and service requests on the screens (Jonathan, Oct 22 2026). The
 * server is apps/portal/src/server/routes/serviceTickets.ts; the words and
 * rules are lib/serviceTicketModel.ts (shared).
 *
 *   PastCustomerBadge        "Past customer · Lifetime Craftsmanship Warranty ·
 *                            installed Oct 20, 2026" on the customer page, the
 *                            card window and search results
 *   ServiceRequestButton     the big "Warranty / Service request" button
 *   ServiceTicketList        a customer's or a job's requests
 *   ServiceHost              mounted once: the request form and a ticket's
 *                            window, opened from anywhere (?ticket=<id>)
 *
 * The ticket window: the warranty and the hint, "Ask for photos" (the no login
 * link, then the text opens in this phone's own texting app; nothing is sent
 * by the server), the photos, Covered / Not covered with a reason (owner and
 * office), Make repair quote, the crew packet's $0 work order, Book the visit
 * (a Service appointment), Fixed (covered work's hours and materials), Close.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Wrench, X, Camera, Copy, CalendarPlus, FilePlus2, Check, ShieldCheck } from 'lucide-react'
import {
  getContext, getTicket, createTicket, askForPhotos, setStage, decide, linkAppointment, markFixed, useTickets, useBadges, badgeFor, badgeWords,
  OPEN_REQUEST_EVENT, OPEN_TICKET_EVENT, TICKETS_CHANGED, openServiceRequest, openTicket, dayWords, usd,
  type Ticket, type JobContext, type Issue,
} from './serviceStore'
import { ISSUES, STAGES, photoRequestText, HINT_LABEL } from '../../portal/src/server/lib/serviceTicketModel'
import { getJobs, getArchivedJobs, type Job } from './jobStore'
import { getQuotes, QUOTES_UPDATED_EVENT } from './quoteStore'
import { publicDoorUrl } from './publicDoor'
import { smsLink } from './appointmentLogic'
import { APPOINTMENTS_UPDATED } from './appointmentsStore'
import { openBooking } from './BookingDialog'
import { formatPhone, telHref } from './phoneFormat'
import { useBackLayer, takeOpenedParam, useNav } from './nav'
import { can } from './permissions'
import { toast } from './toast'
import { getInventory } from './inventoryStore'
import { useBookingTeam } from './bookingTeamStore'
import { sendInstallPacket, packetUrl, type Packet } from './installPacket'
import { fetchWithAuth } from './crmAuth'
import { API_ORIGIN } from './syncHttp'

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(16)}-0000-4000-8000-${Math.random().toString(16).slice(2, 14).padEnd(12, '0')}`)
const DONE = new Set(['completed', 'invoiced', 'paid'])
const todayYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })

const HINT_STYLE: Record<string, string> = {
  likely_covered: 'bg-green-100 text-green-800 border-green-200',
  likely_not_covered: 'bg-red-50 text-red-800 border-red-200',
  needs_look: 'bg-amber-50 text-amber-900 border-amber-200',
}
const STAGE_STYLE: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800', photos_requested: 'bg-amber-100 text-amber-900', photos_received: 'bg-purple-100 text-purple-800',
  scheduled: 'bg-cyan-100 text-cyan-800', fixed: 'bg-green-100 text-green-800', closed: 'bg-gray-100 text-gray-700',
}

// ── Badge ────────────────────────────────────────────────────────────────────

/** "Past customer · <warranty> · installed <date>", or nothing for a customer with no completed job. */
export function PastCustomerBadge({ customerId, className = '' }: { customerId: string | null | undefined; className?: string }) {
  useBadges()
  const b = badgeFor(customerId)
  if (!b) return null
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold border rounded-full px-2 py-1 bg-purple-50 text-purple-800 border-purple-200 ${className}`} data-past-customer={b.jobId}>
      <ShieldCheck size={13} aria-hidden="true" />{badgeWords(b)}
    </span>
  )
}

// ── Button and lists ─────────────────────────────────────────────────────────

/** The customer's jobs, newest first (archived ones too: a past customer's job may be archived). */
export function jobsOfCustomer(customerId: string): Job[] {
  return [...getJobs(), ...getArchivedJobs()].filter(j => j.customerId === customerId)
    .sort((a, b) => (b.completedDate || b.scheduledDate || '').localeCompare(a.completedDate || a.scheduledDate || ''))
}

export function ServiceRequestButton({ customerId, jobId, className = '' }: { customerId?: string | null; jobId?: string; className?: string }) {
  if (!jobId && (!customerId || jobsOfCustomer(customerId).length === 0)) return null
  return (
    <button type="button" className={`btn w-full h-14 text-base font-bold bg-purple-700 text-white hover:bg-purple-800 active:bg-purple-900 ${className}`}
      onClick={() => openServiceRequest(jobId ? { jobId } : { customerId: customerId! })} data-service-request-button>
      <Wrench size={20} aria-hidden="true" /> Warranty / Service request
    </button>
  )
}

/** A customer's or a job's requests; tap one to open it. */
export function ServiceTicketList({ customerId, jobId, title = 'Service requests' }: { customerId?: string; jobId?: string; title?: string }) {
  const { list, error } = useTickets({ customerId, jobId })
  if (error && !list) return <p className="text-xs text-red-700">Could not load the service requests. {error}</p>
  if (!list || list.length === 0) return null
  return (
    <div className="space-y-1" data-service-tickets={list.length}>
      <p className="text-xs font-semibold text-gray-600">{title}</p>
      {list.map(t => <TicketRow key={t.id} t={t} />)}
    </div>
  )
}

export function TicketRow({ t, showCustomer = false }: { t: Ticket; showCustomer?: boolean }) {
  return (
    <button type="button" onClick={() => openTicket(t.id)} className="w-full flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 min-h-[56px] text-left hover:bg-gray-50" data-service-ticket={t.id} data-stage={t.stage}>
      <span className="flex-1 min-w-0">
        <span className="block text-sm font-semibold text-gray-900 truncate">{showCustomer ? `${t.customerName} · ` : ''}{t.issueLabel}</span>
        <span className="block text-xs text-gray-600 truncate">
          {dayWords(t.createdAt)}{t.decision ? ` · ${t.decision === 'covered' ? 'Covered' : 'Not covered'}` : ` · ${t.hintLabel}`}
          {t.appointment?.startAt ? ` · visit ${dayWords(t.appointment.startAt)}` : ''}{t.photoCount ? ` · ${t.photoCount} photo${t.photoCount === 1 ? '' : 's'}` : ''}
        </span>
      </span>
      <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full ${STAGE_STYLE[t.stage] ?? ''}`}>{t.stageLabel}</span>
    </button>
  )
}

// ── Host ─────────────────────────────────────────────────────────────────────

export function ServiceHost() {
  const [req, setReq] = useState<{ customerId?: string; jobId?: string } | null>(null)
  const [ticketId, setTicketId] = useState<string | null>(null)
  const nav = useNav()
  useEffect(() => {
    const onReq = (e: Event) => setReq((e as CustomEvent).detail || {})
    const onTicket = (e: Event) => { setReq(null); setTicketId((e as CustomEvent).detail?.id ?? null) }
    window.addEventListener(OPEN_REQUEST_EVENT, onReq)
    window.addEventListener(OPEN_TICKET_EVENT, onTicket)
    return () => { window.removeEventListener(OPEN_REQUEST_EVENT, onReq); window.removeEventListener(OPEN_TICKET_EVENT, onTicket) }
  }, [])
  // A ticket named in the address (?ticket=<id>: a reload, a push, a link).
  useEffect(() => {
    const id = nav.params.get('ticket') ?? takeOpenedParam('ticket')
    if (id && id !== ticketId) setTicketId(id)
  }, [nav])  // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      {req && <NewRequest req={req} onClose={() => setReq(null)} onMade={id => { setReq(null); setTicketId(id) }} />}
      {ticketId && <TicketWindow key={ticketId} id={ticketId} onClose={() => setTicketId(null)} />}
    </>
  )
}

function Sheet({ title, sub, onClose, children, attr }: { title: string; sub?: React.ReactNode; onClose: () => void; children: React.ReactNode; attr: Record<string, string> }) {
  return (
    <div className="fixed inset-0 z-50 flex items-stretch md:items-center justify-center bg-black/40 md:p-6" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()} {...attr}
        className="bg-gray-50 w-full md:max-w-xl md:rounded-2xl shadow-2xl flex flex-col max-h-full md:max-h-[92vh] overflow-hidden">
        <div className="bg-white border-b border-gray-200 px-4 pt-[calc(12px+env(safe-area-inset-top))] md:pt-4 pb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            {sub}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="btn btn-quiet btn-icon shrink-0"><X size={22} aria-hidden="true" /></button>
        </div>
        <div className="overflow-y-auto px-4 py-4 space-y-4 pb-[calc(24px+env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  )
}

function WarrantyWords({ name, text, installDate, endText }: { name: string; text: string; installDate: string | null; endText: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="rounded-xl border border-purple-200 bg-white p-3" data-request-warranty>
      <p className="text-sm font-bold text-purple-800" data-request-warranty-name>{name || 'No warranty on file'}</p>
      <p className="text-xs text-gray-600">{installDate ? `Installed ${dayWords(installDate)}` : 'No install date recorded'} · {endText}</p>
      {text && <button type="button" className="text-sm text-purple-700 underline min-h-[44px]" onClick={() => setShow(s => !s)} data-request-warranty-toggle>{show ? 'Hide the warranty words' : 'Show the warranty words'}</button>}
      {show && <p className="text-sm text-gray-700 whitespace-pre-line border-l-2 border-purple-200 pl-3" data-request-warranty-text>{text}</p>}
    </div>
  )
}

function HintPill({ hint, why }: { hint: string; why: string }) {
  return (
    <div className={`rounded-xl border px-3 py-2 ${HINT_STYLE[hint] ?? ''}`} data-hint={hint}>
      <p className="text-sm font-bold">{HINT_LABEL[hint as keyof typeof HINT_LABEL] ?? hint}</p>
      <p className="text-xs">{why}</p>
      <p className="text-[11px] opacity-80 mt-0.5">A hint from the warranty. The owner or the office decide.</p>
    </div>
  )
}

// ── The request form ─────────────────────────────────────────────────────────

function NewRequest({ req, onClose, onMade }: { req: { customerId?: string; jobId?: string }; onClose: () => void; onMade: (id: string) => void }) {
  useBackLayer(onClose, { key: 'service-request' })
  const jobs = useMemo(() => (req.customerId ? jobsOfCustomer(req.customerId) : []), [req.customerId])
  const [jobId, setJobId] = useState<string>(() => req.jobId ?? (jobs.find(j => DONE.has(j.status) || j.completedDate) ?? jobs[0])?.id ?? '')
  const [ctx, setCtx] = useState<JobContext | null | undefined>(undefined)
  const [issue, setIssue] = useState<Issue | null>(null)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [id] = useState(newId)
  useEffect(() => {
    if (!jobId) { setCtx(null); return }
    setCtx(undefined)
    getContext(jobId).then(r => setCtx(r.ok ? r.data : null))
  }, [jobId])

  async function save() {
    if (!issue || !jobId || busy) return
    setBusy(true)
    const r = await createTicket({ id, jobId, issue, notes: notes.trim() })
    setBusy(false)
    if (!r.ok) { toast.error('Request not saved', r.error); return }
    toast.success('Service request made', `${r.data.issueLabel} · ${r.data.hintLabel}`)
    onMade(r.data.id)
  }

  const h = issue && ctx ? ctx.hints[issue] : null
  return (
    <Sheet title="Warranty / Service request" onClose={onClose} attr={{ 'data-service-request-form': jobId }}
      sub={ctx ? <p className="text-sm text-gray-600 truncate">{ctx.customerName}{ctx.address ? ` · ${ctx.address}` : ''}</p> : null}>
      {jobs.length > 1 && (
        <label className="block text-sm font-semibold text-gray-900">Which fence
          <select value={jobId} onChange={e => setJobId(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-lg h-12 px-3 text-base bg-white" data-request-job>
            {jobs.map(j => <option key={j.id} value={j.id}>{[j.fenceStyle || 'Fence', j.completedDate ? `installed ${dayWords(j.completedDate.slice(0, 10))}` : j.status.replace(/_/g, ' '), j.customerAddress].filter(Boolean).join(' · ')}</option>)}
          </select>
        </label>
      )}
      {!jobId && <p className="text-sm text-gray-700">This customer has no job yet. A request is made on an installed fence.</p>}
      {ctx === undefined && jobId && <p className="text-sm text-gray-500">Loading the warranty…</p>}
      {ctx === null && jobId && <p className="text-sm text-red-700">Could not load the job's warranty. Check the connection.</p>}
      {ctx && (
        <>
          {!ctx.completed && <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">This job is not marked complete yet.</p>}
          <WarrantyWords name={ctx.warranty?.name ?? ''} text={ctx.warranty?.text ?? ''} installDate={ctx.installDate} endText={ctx.endText} />
          <div>
            <p className="text-sm font-semibold text-gray-900 mb-1">What is wrong</p>
            <div className="grid grid-cols-2 gap-2" data-request-issues>
              {ISSUES.map(i => (
                <button key={i.key} type="button" onClick={() => setIssue(i.key)} data-issue={i.key} aria-pressed={issue === i.key}
                  className={`min-h-[56px] rounded-xl border px-3 text-sm font-semibold text-left ${issue === i.key ? 'border-purple-600 bg-purple-50 text-purple-900 ring-2 ring-purple-300' : 'border-gray-200 bg-white text-gray-800'}`}>
                  {i.label}
                </button>
              ))}
            </div>
          </div>
          {h && <HintPill hint={h.hint} why={h.why} />}
          <label className="block text-sm font-semibold text-gray-900">Notes
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} maxLength={2000} placeholder="What the customer said, where on the fence"
              className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-base" data-request-notes />
          </label>
          <button type="button" className="btn btn-primary w-full h-14 text-lg" disabled={!issue || busy} onClick={save} data-request-save>{busy ? 'Saving…' : 'Open the request'}</button>
        </>
      )}
    </Sheet>
  )
}

// ── The ticket window ────────────────────────────────────────────────────────

function TicketWindow({ id, onClose }: { id: string; onClose: () => void }) {
  useBackLayer(onClose, { key: 'ticket', params: { ticket: id } })
  const [t, setT] = useState<Ticket | null | undefined>(undefined)
  const [err, setErr] = useState('')
  const reload = useCallback(() => { getTicket(id).then(r => { if (r.ok) { setT(r.data); setErr('') } else { setErr(r.error); setT(x => x ?? null) } }) }, [id])
  useEffect(() => { reload() }, [reload])
  // A repair quote saved, a visit moved, a change on another screen: load it again.
  useEffect(() => {
    const evs = [QUOTES_UPDATED_EVENT, APPOINTMENTS_UPDATED, TICKETS_CHANGED]
    let timer: ReturnType<typeof setTimeout> | null = null
    const h = () => { if (timer) clearTimeout(timer); timer = setTimeout(reload, 400) }
    evs.forEach(e => window.addEventListener(e, h))
    return () => { evs.forEach(e => window.removeEventListener(e, h)); if (timer) clearTimeout(timer) }
  }, [reload])
  const apply = (r: { ok: true; data: Ticket } | { ok: false; error: string }, done?: string) => {
    if (!r.ok) { toast.error('Not saved', r.error); return false }
    setT(r.data); if (done) toast.success(done); return true
  }

  if (t === undefined) return <Sheet title="Service request" onClose={onClose} attr={{ 'data-ticket-window': id }}><p className="text-sm text-gray-500">Loading…</p></Sheet>
  if (t === null) return <Sheet title="Service request" onClose={onClose} attr={{ 'data-ticket-window': id }}><p className="text-sm text-red-700">Could not load this request. {err}</p></Sheet>
  const decider = can('service.decide')
  const stageAt = STAGES.findIndex(s => s.key === t.stage)
  return (
    <Sheet title={`${t.issueLabel}: ${t.customerName}`} onClose={onClose} attr={{ 'data-ticket-window': t.id, 'data-stage': t.stage }}
      sub={<p className="text-sm text-gray-600 truncate">{[t.fenceStyle, t.address].filter(Boolean).join(' · ')}{t.phone ? <> · <a href={telHref(t.phone)} className="text-blue-600">{formatPhone(t.phone)}</a></> : null}</p>}>
      <ol className="grid grid-cols-6 gap-1" aria-label="Stage" data-ticket-stages>
        {STAGES.map((s, i) => (
          <li key={s.key} className={`text-[10px] leading-tight text-center rounded-lg px-1 py-1.5 ${i === stageAt ? `${STAGE_STYLE[s.key]} font-bold ring-1 ring-current` : i < stageAt ? 'bg-gray-200 text-gray-700' : 'bg-white text-gray-400 border border-gray-200'}`} data-ticket-stage={s.key} aria-current={i === stageAt ? 'step' : undefined}>{s.label}</li>
        ))}
      </ol>

      <WarrantyWords name={t.warranty.name} text={t.warranty.text} installDate={t.warranty.installDate} endText={t.warranty.end ? `Through ${dayWords(t.warranty.end)}` : t.warranty.term === 'lifetime' ? 'For as long as they own the home' : ''} />
      {!t.decision && <HintPill hint={t.hint} why={t.hintWhy} />}
      {t.notes && <p className="text-sm text-gray-800 whitespace-pre-wrap bg-white border border-gray-200 rounded-xl p-3" data-ticket-notes>{t.notes}</p>}

      <PhotosBlock t={t} onTicket={r => apply(r)} />
      <DecisionBlock t={t} decider={decider} onTicket={(r, m) => apply(r, m)} />
      {t.decision === 'not_covered' && <RepairQuoteBlock t={t} />}
      {t.decision === 'covered' && t.open && <CrewPacketBlock t={t} />}
      <VisitBlock t={t} onTicket={r => apply(r, 'Visit booked')} />
      <FixedBlock t={t} decider={decider} onTicket={r => apply(r, 'Marked fixed')} />
      {t.cost && <CostBlock t={t} />}

      {decider && (
        <div className="flex flex-wrap gap-2">
          {t.stage !== 'closed'
            ? <button type="button" className="btn btn-secondary flex-1 min-h-[48px]" onClick={async () => apply(await setStage(t.id, 'closed'), 'Request closed')} data-ticket-close>Close request</button>
            : <button type="button" className="btn btn-secondary flex-1 min-h-[48px]" onClick={async () => apply(await setStage(t.id, 'new'), 'Request reopened')} data-ticket-reopen>Reopen</button>}
        </div>
      )}

      <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3" data-ticket-history>
        <h3 className="text-sm font-semibold text-gray-900">History</h3>
        <ol className="mt-1 space-y-1">
          {t.history.slice().reverse().map((h, i) => (
            <li key={i} className="text-sm text-gray-800">{h.text}<span className="block text-xs text-gray-500">{new Date(h.at).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}{h.by ? ` · ${h.by}` : ''}</span></li>
          ))}
        </ol>
      </section>
    </Sheet>
  )
}

function Block({ title, children, attr }: { title: string; children: React.ReactNode; attr?: Record<string, string> }) {
  return (
    <section className="bg-white rounded-2xl border border-gray-200 px-4 py-3 space-y-2" {...attr}>
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {children}
    </section>
  )
}

const CONSENT_STYLE = { yes: 'bg-green-100 text-green-800 border-green-200', no: 'bg-red-50 text-red-800 border-red-200', unknown: 'bg-gray-100 text-gray-700 border-gray-200' }

function PhotosBlock({ t, onTicket }: { t: Ticket; onTicket: (r: Awaited<ReturnType<typeof askForPhotos>>) => void }) {
  const [busy, setBusy] = useState(false)
  const link = t.link ? publicDoorUrl(t.link.path) : ''
  const text = link ? photoRequestText(t.firstName, link) : ''
  async function ask() {
    if (busy) return
    setBusy(true)
    const r = await askForPhotos(t.id)
    setBusy(false)
    onTicket(r)
    if (!r.ok) return
    const url = publicDoorUrl(r.data.link!.path)
    // The text opens in this phone's own texting app (an sms: link); the office sends it, never the server.
    if (r.data.phone) {
      const a = document.createElement('a')
      a.href = smsLink(r.data.phone, photoRequestText(r.data.firstName, url))
      a.setAttribute('data-ticket-sms', '')
      document.body.appendChild(a)
      a.click()
      a.remove()
    } else toast.info('Photo link made', 'No phone on file: copy the link and send it another way.')
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); toast.success('Copied', 'The text with the link is ready to paste.') }
    catch { toast.error('Could not copy', link) }
  }
  return (
    <Block title="Photos" attr={{ 'data-ticket-photos-block': '' }}>
      {t.open && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-xs font-semibold border rounded-full px-2 py-1 ${CONSENT_STYLE[t.textConsent.state]}`} data-ticket-consent={t.textConsent.state}>Texts: {t.textConsent.words}</span>
          </div>
          {t.textConsent.state === 'no' && <p className="text-sm text-red-800 bg-red-50 border border-red-200 rounded-lg p-2" data-ticket-consent-warning>This customer said no to texts. Call them instead, or text only if they asked you to just now.</p>}
          <button type="button" className="btn btn-primary w-full h-12" disabled={busy} onClick={ask} data-ask-photos><Camera size={18} aria-hidden="true" /> {t.link?.open ? 'Ask for photos again' : 'Ask for photos'}</button>
          {t.link && (
            <div className="text-xs text-gray-600 space-y-1" data-ticket-link={t.link.open ? 'open' : 'expired'}>
              <p className="break-all"><a href={link} target="_blank" rel="noreferrer" className="text-blue-700 underline" data-ticket-link-url>{link}</a></p>
              <p>{t.link.open ? `Open until ${dayWords(t.link.expiresAt)}.` : 'Expired: ask again for a new 14 days.'}{t.photosRequestedAt ? ` Asked ${dayWords(t.photosRequestedAt)}.` : ''}</p>
              {t.link.open && (
                <div className="flex flex-wrap gap-2">
                  {t.phone && <a href={smsLink(t.phone, text)} className="btn btn-quiet btn-sm" data-ticket-sms-again>Open the text again</a>}
                  <button type="button" className="btn btn-quiet btn-sm" onClick={copy} data-ticket-copy-text><Copy size={14} aria-hidden="true" /> Copy the text</button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      {t.photos && t.photos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2" data-ticket-photos={t.photos.length}>
          {t.photos.map(m => (
            <a key={m.id} href={API_ORIGIN + (m.markupUrl ?? m.url)} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden border border-gray-200 bg-black" data-ticket-photo={m.id}>
              {m.kind === 'video'
                ? (m.thumbUrl ? <img src={API_ORIGIN + m.thumbUrl} alt="Video from the customer" className="w-full h-24 object-cover opacity-80" /> : <span className="flex h-24 items-center justify-center text-white text-xs">Video</span>)
                : <img src={API_ORIGIN + (m.thumbUrl ?? m.url)} alt={m.caption || 'Photo from the customer'} className="w-full h-24 object-cover" loading="lazy" />}
            </a>
          ))}
        </div>
      ) : <p className="text-xs text-gray-500">No photos yet. They land here as Internal (and on the job's photos).</p>}
    </Block>
  )
}

function DecisionBlock({ t, decider, onTicket }: { t: Ticket; decider: boolean; onTicket: (r: Awaited<ReturnType<typeof decide>>, msg: string) => boolean }) {
  const [choice, setChoice] = useState<'covered' | 'not_covered' | null>(null)
  const [reason, setReason] = useState('')
  const [shared, setShared] = useState(false)
  const [busy, setBusy] = useState(false)
  async function save() {
    if (!choice || !reason.trim()) return
    setBusy(true)
    const ok = onTicket(await decide(t.id, { decision: choice, reason: reason.trim(), shared }), choice === 'covered' ? 'Marked covered' : 'Marked not covered')
    setBusy(false)
    if (ok) { setChoice(null); setReason(''); setShared(false) }
  }
  return (
    <Block title="Covered by warranty?" attr={{ 'data-ticket-decision': t.decision ?? 'none' }}>
      {t.decision ? (
        <div className={`rounded-xl border p-3 ${t.decision === 'covered' ? 'bg-green-50 border-green-200 text-green-900' : 'bg-red-50 border-red-200 text-red-900'}`}>
          <p className="text-sm font-bold">{t.decision === 'covered' ? 'Covered: $0 to the customer' : 'Not covered'}</p>
          <p className="text-sm">{t.decisionReason}</p>
          <p className="text-xs opacity-80">{t.decisionBy}{t.decisionAt ? `, ${dayWords(t.decisionAt)}` : ''} · {t.decisionShared ? 'Shown to the customer in their portal' : 'Not shown to the customer'}</p>
        </div>
      ) : <p className="text-sm text-gray-600">Not decided yet.</p>}
      {decider && t.open && (choice ? (
        <div className="space-y-2">
          <label className="block text-sm text-gray-700">Why is it {choice === 'covered' ? 'covered' : 'not covered'}?
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} maxLength={1000} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-base" data-decision-reason />
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700 min-h-[44px]">
            <input type="checkbox" checked={shared} onChange={e => setShared(e.target.checked)} className="w-5 h-5" data-decision-shared />
            Show the customer this decision and the reason in their portal
          </label>
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1 min-h-[48px]" disabled={!reason.trim() || busy} onClick={save} data-decision-save>Save</button>
            <button type="button" className="btn btn-secondary min-h-[48px]" onClick={() => { setChoice(null); setReason('') }}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn min-h-[52px] bg-green-600 text-white hover:bg-green-700" onClick={() => setChoice('covered')} data-decide="covered"><Check size={18} aria-hidden="true" /> {t.decision === 'covered' ? 'Covered (change why)' : 'Covered'}</button>
          <button type="button" className="btn min-h-[52px] bg-red-600 text-white hover:bg-red-700" onClick={() => setChoice('not_covered')} data-decide="not_covered">{t.decision === 'not_covered' ? 'Not covered (change why)' : 'Not covered'}</button>
        </div>
      ))}
      {!decider && !t.decision && <p className="text-xs text-gray-500">The owner or the office decide.</p>}
    </Block>
  )
}

const REPAIR_WHAT: Record<string, 'leaning' | 'storm' | 'gate' | 'other'> = { leaning_post: 'leaning', storm_tree: 'storm', gate: 'gate', damaged_section: 'other', other: 'other' }

function RepairQuoteBlock({ t }: { t: Ticket }) {
  const job = [...getJobs(), ...getArchivedJobs()].find(j => j.id === t.jobId)
  function make() {
    if (!t.customerId) { toast.error('No customer on this job', 'Link the job to a customer first.'); return }
    // The quote builder opens in repair mode with the customer, the address and the fence's style set.
    window.dispatchEvent(new CustomEvent('ezbiz:new-quote', {
      detail: { customerId: t.customerId, address: t.address, notes: `Service request: ${t.issueLabel}.${t.notes ? ` ${t.notes}` : ''}`, repair: { what: REPAIR_WHAT[t.issue] ?? 'other', fenceStyle: job?.fenceStyle ?? '' } },
    }))
  }
  const q = t.repairQuote ? getQuotes().find(x => x.id === t.repairQuote!.id) : null
  return (
    <Block title="Repair quote" attr={{ 'data-ticket-repair': t.repairQuote?.id ?? 'none' }}>
      {t.repairQuote ? (
        <button type="button" className="w-full text-left text-sm text-gray-800 rounded-lg border border-gray-200 p-2 min-h-[48px]" onClick={() => q && window.dispatchEvent(new CustomEvent('ezbiz:open-quote', { detail: { id: q.id } }))} disabled={!q} data-ticket-repair-quote>
          {t.repairQuote.status.charAt(0) + t.repairQuote.status.slice(1).toLowerCase()} · ${Math.round(t.repairQuote.finalPrice).toLocaleString('en-US')} · {t.repairQuote.date}
        </button>
      ) : <p className="text-sm text-gray-600">Not covered: price the repair from the Repair price list.</p>}
      <button type="button" className="btn btn-primary w-full h-12" onClick={make} data-make-repair-quote><FilePlus2 size={18} aria-hidden="true" /> {t.repairQuote ? 'Make another repair quote' : 'Make repair quote'}</button>
    </Block>
  )
}

function CrewPacketBlock({ t }: { t: Ticket }) {
  const [packet, setPacket] = useState<Packet | null | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    fetchWithAuth(`${API_ORIGIN}/api/install-packets?jobId=${encodeURIComponent(t.jobId)}`).then(r => r.json()).then(j => setPacket(j?.data ?? null)).catch(() => setPacket(null))
  }, [t.jobId])
  async function send() {
    const job = [...getJobs(), ...getArchivedJobs()].find(j => j.id === t.jobId)
    if (!job) { toast.error('Job not found on this phone', 'Open the job page once, then try again.'); return }
    setBusy(true)
    const p = await sendInstallPacket(job.id, { fenceStyle: job.fenceStyle, notes: job.notes, walkGates: job.walkGates, dblGates: job.dblGates }, job.quoteId ? getQuotes().find(q => q.id === job.quoteId) : undefined)
    setBusy(false)
    if (!p) { toast.error('Could not make the crew packet', 'Check the connection and try again.'); return }
    setPacket(p); toast.success('Work order on the crew packet')
  }
  const live = packet && !packet.disabledAt
  return (
    <Block title="Work order for the crew ($0)" attr={{ 'data-ticket-packet': live ? 'on' : 'off' }}>
      <p className="text-sm text-gray-600">Covered work shows on the job's crew packet as a $0 work order, with the customer's photos, until it is Fixed.</p>
      {packet === undefined ? <p className="text-xs text-gray-500">Loading…</p> : live ? (
        <div className="flex flex-wrap gap-2 items-center">
          <a href={packetUrl(packet.token)} target="_blank" rel="noreferrer" className="btn btn-secondary min-h-[48px]" data-ticket-packet-link>Open the crew packet</a>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => navigator.clipboard.writeText(packetUrl(packet.token)).then(() => toast.success('Crew link copied'), () => toast.error('Could not copy'))}><Copy size={14} aria-hidden="true" /> Copy the crew link</button>
        </div>
      ) : can('packets.change')
        ? <button type="button" className="btn btn-primary w-full h-12" disabled={busy} onClick={send} data-ticket-packet-send>{busy ? 'Making it…' : 'Send to the crew packet'}</button>
        : <p className="text-xs text-gray-500">Ask the office to send the crew packet.</p>}
    </Block>
  )
}

function VisitBlock({ t, onTicket }: { t: Ticket; onTicket: (r: Awaited<ReturnType<typeof linkAppointment>>) => void }) {
  function book() {
    if (!t.customerId) { toast.error('No customer on this job', 'Link the job to a customer first.'); return }
    openBooking({
      customerId: t.customerId, type: 'service', jobId: t.jobId,
      ...(t.appointment ? { appointmentId: t.appointment.id } : {}),
      onBooked: async a => { if (a.id !== t.appointmentId || t.stage !== 'scheduled') onTicket(await linkAppointment(t.id, a.id)) },
    })
  }
  return (
    <Block title="Visit" attr={{ 'data-ticket-visit': t.appointment?.id ?? 'none' }}>
      {t.appointment ? (
        <p className="text-sm text-gray-800" data-ticket-visit-day>{t.appointment.startAt ? new Date(t.appointment.startAt).toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No time yet'}{t.appointment.assignedTo ? ` · ${t.appointment.assignedTo}` : ''}{t.appointment.status !== 'scheduled' ? ` · ${t.appointment.status.replace(/_/g, ' ')}` : ''}</p>
      ) : <p className="text-sm text-gray-600">Not booked.</p>}
      {t.open && t.stage !== 'fixed' && <button type="button" className="btn btn-secondary w-full h-12" onClick={book} data-ticket-book><CalendarPlus size={18} aria-hidden="true" /> {t.appointment ? 'Change the visit' : 'Book the visit'}</button>}
    </Block>
  )
}

interface MatLine { part: string; qty: string; unit: string }

function FixedBlock({ t, decider, onTicket }: { t: Ticket; decider: boolean; onTicket: (r: Awaited<ReturnType<typeof markFixed>>) => boolean }) {
  const [open, setOpen] = useState(false)
  const [day, setDay] = useState(todayYmd)
  // Crew names offered: the team (the active logins, bookingTeamStore.ts); any name can still be typed.
  const team = useBookingTeam().map(m => m.name)
  const [crew, setCrew] = useState<Array<{ name: string; hours: string }>>([{ name: t.appointment?.assignedTo || team[0] || '', hours: '' }])
  const [mats, setMats] = useState<MatLine[]>([{ part: '', qty: '', unit: '' }])
  const [busy, setBusy] = useState(false)
  const items = useMemo(() => getInventory(), [])
  const covered = t.decision === 'covered'
  if (!t.open || t.stage === 'fixed') return null
  if (covered && !decider) return <Block title="Fixed"><p className="text-xs text-gray-500">Covered work is costed: the owner or the office mark it fixed with the crew hours and materials.</p></Block>
  const costs = can('costs.view')
  async function save() {
    setBusy(true)
    const body = covered ? {
      fixedOn: day,
      crew: crew.map(c => ({ name: c.name.trim(), hours: Number(c.hours) || 0 })).filter(c => c.name || c.hours),
      materials: mats.filter(m => m.part.trim() && Number(m.qty) > 0).map(m => {
        const item = items.find(i => i.name.toLowerCase() === m.part.trim().toLowerCase())
        return { inventoryItemId: item?.id ?? null, part: m.part.trim(), qty: Number(m.qty), unitCents: item ? null : (m.unit ? Math.round(Number(m.unit) * 100) : null) }
      }),
    } : { fixedOn: day }
    const ok = onTicket(await markFixed(t.id, body))
    setBusy(false)
    if (ok) setOpen(false)
  }
  return (
    <Block title="Fixed" attr={{ 'data-ticket-fixed-block': '' }}>
      {!open ? <button type="button" className="btn btn-secondary w-full h-12" onClick={() => setOpen(true)} data-ticket-fixed>Mark fixed</button> : (
        <div className="space-y-3" data-ticket-fixed-form>
          <label className="block text-sm text-gray-700">Day fixed<input type="date" value={day} onChange={e => setDay(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-lg h-11 px-2 text-base" data-fixed-day /></label>
          {covered && (
            <>
              <div>
                <p className="text-sm font-semibold text-gray-900">Crew hours</p>
                {crew.map((c, i) => (
                  <div key={i} className="grid grid-cols-[1fr_6rem] gap-2 mt-1">
                    <input list="svc-team" value={c.name} onChange={e => setCrew(cs => cs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" className="border border-gray-300 rounded-lg h-11 px-2 text-base" data-fixed-crew-name={i} />
                    <input value={c.hours} onChange={e => setCrew(cs => cs.map((x, j) => (j === i ? { ...x, hours: e.target.value } : x)))} inputMode="decimal" placeholder="Hours" className="border border-gray-300 rounded-lg h-11 px-2 text-base" data-fixed-crew-hours={i} />
                  </div>
                ))}
                <datalist id="svc-team">{team.map(n => <option key={n} value={n} />)}</datalist>
                <button type="button" className="btn btn-quiet btn-sm mt-1" onClick={() => setCrew(cs => [...cs, { name: '', hours: '' }])}>+ Person</button>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Materials used</p>
                {mats.map((m, i) => {
                  const item = items.find(x => x.name.toLowerCase() === m.part.trim().toLowerCase())
                  return (
                    <div key={i} className={`grid ${costs && !item && m.part ? 'grid-cols-[1fr_4.5rem_5.5rem]' : 'grid-cols-[1fr_4.5rem]'} gap-2 mt-1`}>
                      <input list="svc-items" value={m.part} onChange={e => setMats(ms => ms.map((x, j) => (j === i ? { ...x, part: e.target.value } : x)))} placeholder="Part (from Inventory)" className="border border-gray-300 rounded-lg h-11 px-2 text-base min-w-0" data-fixed-part={i} />
                      <input value={m.qty} onChange={e => setMats(ms => ms.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} inputMode="decimal" placeholder="Qty" className="border border-gray-300 rounded-lg h-11 px-2 text-base" data-fixed-qty={i} />
                      {costs && !item && m.part && <input value={m.unit} onChange={e => setMats(ms => ms.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} inputMode="decimal" placeholder="$ each" className="border border-gray-300 rounded-lg h-11 px-2 text-base" data-fixed-unit={i} />}
                    </div>
                  )
                })}
                <datalist id="svc-items">{items.map(x => <option key={x.id} value={x.name} />)}</datalist>
                <button type="button" className="btn btn-quiet btn-sm mt-1" onClick={() => setMats(ms => [...ms, { part: '', qty: '', unit: '' }])}>+ Part</button>
                <p className="text-xs text-gray-500">Costed like job costing: hours × the hourly rate saved when the job was signed; each Inventory part at its landed cost on the day fixed.</p>
              </div>
            </>
          )}
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1 min-h-[48px]" disabled={busy || !day || (covered && !crew.some(c => Number(c.hours) > 0))} onClick={save} data-fixed-save>{busy ? 'Saving…' : 'Save: fixed'}</button>
            <button type="button" className="btn btn-secondary min-h-[48px]" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </Block>
  )
}

function CostBlock({ t }: { t: Ticket }) {
  const c = t.cost!
  return (
    <Block title="Covered work's cost" attr={{ 'data-ticket-cost': String(c.totalCents) }}>
      <p className="text-sm text-gray-800">Labor: {c.hours} crew hours × {usd(c.hourlyCostCents)}/hr = <b>{usd(c.laborCents)}</b> <span className="text-xs text-gray-500">({c.hourlySource})</span></p>
      {c.materials.map((m, i) => <p key={i} className="text-sm text-gray-800">{m.part}: {m.qty} × {usd(m.unitCents)} = {usd(m.totalCents)} <span className="text-xs text-gray-500">({m.source === 'invoice' ? 'landed cost' : m.source === 'inventory' ? 'Inventory cost' : m.source === 'entered' ? 'cost typed' : 'no cost found'})</span></p>)}
      <p className="text-sm font-bold text-gray-900">Total: {usd(c.totalCents)} <span className="font-normal text-xs text-gray-500">fixed {dayWords(c.fixedOn)}, entered by {c.enteredBy}</span></p>
    </Block>
  )
}

// ── Pages and sections that list tickets ─────────────────────────────────────

/** Requests that need someone: new, photos in, photos asked 3+ days ago with none back, visits today. For Today and Follow ups. */
export function needsAttention(list: Ticket[], today = todayYmd()): { kind: string; t: Ticket; why: string }[] {
  const out: { kind: string; t: Ticket; why: string }[] = []
  const threeDays = Date.now() - 3 * 86_400_000
  for (const t of list) {
    if (!t.open) continue
    if (t.stage === 'new') out.push({ kind: 'new', t, why: 'New: ask for photos' })
    else if (t.stage === 'photos_received' && !t.decision) out.push({ kind: 'decide', t, why: 'Photos in: decide covered or not covered' })
    else if (t.stage === 'photos_requested' && t.photosRequestedAt && new Date(t.photosRequestedAt).getTime() < threeDays) out.push({ kind: 'no_photos', t, why: `No photos since ${dayWords(t.photosRequestedAt)}: call or ask again` })
    else if (t.appointment?.startAt && new Date(t.appointment.startAt).toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) === today && t.stage === 'scheduled') out.push({ kind: 'today', t, why: 'Visit today' })
  }
  return out
}

export function ServiceNeedsYou({ title = 'Service requests', list }: { title?: string; list: Ticket[] | null }) {
  const rows = list ? needsAttention(list) : []
  if (!rows.length) return null
  return (
    <section className="bg-white rounded-2xl border border-purple-200 p-4 space-y-2" data-service-needs={rows.length}>
      <h2 className="text-sm font-bold text-purple-800">{title} <span className="font-semibold text-gray-500">({rows.length})</span></h2>
      {rows.map(r => (
        <button key={r.t.id} type="button" onClick={() => openTicket(r.t.id)} className="w-full text-left rounded-xl border border-gray-200 px-3 py-2 min-h-[52px] hover:bg-gray-50" data-service-need={r.kind} data-service-ticket={r.t.id}>
          <span className="block text-sm font-semibold text-gray-900 truncate">{r.t.customerName} · {r.t.issueLabel}</span>
          <span className="block text-xs text-gray-600">{r.why}</span>
        </button>
      ))}
    </section>
  )
}

export { openTicket, openServiceRequest }
