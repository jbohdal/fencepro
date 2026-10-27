/**
 * The installer's home screen (Field Crew login, on a phone): today's
 * installs and the ones coming up, from the install schedule (Schedule
 * install: one Schedule entry per crew day, lib/installScheduling.ts). Each
 * install opens its crew packet, has Start and Finish (the times go on the
 * job, with who tapped), the customer's notes ("have 2 dogs") and Progress
 * and Completed photos. Never a price or a cost.
 *
 * Walkthrough, Oct 24, 2026: the installer's login opened on a blank screen;
 * only the packet link worked.
 */

import { useEffect, useMemo, useState } from 'react'
import { Navigation, Phone, FileText, Play, Square, Camera, CheckCircle2, AlertTriangle } from 'lucide-react'
import { getJobs } from './jobStore'
import { getQuoteById } from './quoteStore'
import { loadSchedule, SCHEDULE_UPDATED_EVENT } from './scheduleStore'
import { soldStyleLabel } from './fenceCatalog'
import { fetchCrewInstall, fetchCrewVisits, markInstall, sendInstallPacket, packetUrl, crewInstallCached, putCrewInstall, jobDoneWords, CREW_INSTALL_EVENT, type CrewInstall, type CrewVisit, type InstallTime } from './installPacket'
import { APPOINTMENTS_UPDATED } from './appointmentsStore'
import { TYPE_SHORT } from './appointmentLogic'
import { API_ORIGIN } from './syncHttp'
import { workSummary } from './moveRepair'
import MediaGallery from './MediaGallery'
import { toast } from './toast'
import { formatPhone } from './phoneFormat'
import type { SavedQuote } from './QuotesPage'
import { crewDays, ymd, AHEAD_DAYS, type CrewDay } from './crewDays'

/** A media link from the server (/api/media/f/...), from this page. */
const apiUrl = (u: string) => (u.startsWith('/') ? API_ORIGIN + u : u)
const dayWords = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
const timeWords = (iso: string) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })

function useCrewDays(): CrewDay[] {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const h = () => setTick(t => t + 1)
    window.addEventListener('fencepro:jobs:updated', h)
    window.addEventListener(SCHEDULE_UPDATED_EVENT, h)
    return () => { window.removeEventListener('fencepro:jobs:updated', h); window.removeEventListener(SCHEDULE_UPDATED_EVENT, h) }
  }, [])
  return useMemo(() => {
    const s = loadSchedule()
    return crewDays(getJobs(), s.jobs, s.settings.crews, ymd(new Date()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])
}

/** The service and warranty visits booked with him (audit Oct 26 2026: one booked for Tuesday never showed). */
function useCrewVisits(): CrewVisit[] {
  const [list, setList] = useState<CrewVisit[]>([])
  useEffect(() => {
    let live = true
    const load = () => { void fetchCrewVisits().then(r => { if (live && r) setList(r) }) }
    load()
    // A visit booked or moved by the office shows without a reload.
    const t = setInterval(load, 60_000)
    window.addEventListener(APPOINTMENTS_UPDATED, load)
    window.addEventListener('focus', load)
    return () => { live = false; clearInterval(t); window.removeEventListener(APPOINTMENTS_UPDATED, load); window.removeEventListener('focus', load) }
  }, [])
  return list
}

export default function InstallerHome() {
  const all = useCrewDays()
  const visits = useCrewVisits()
  const today = ymd(new Date())
  const todays = all.filter(d => d.day === today)
  const todaysVisits = visits.filter(v => v.day === today)
  const byDay = new Map<string, { installs: CrewDay[]; visits: CrewVisit[] }>()
  const dayOf = (day: string) => { const e = byDay.get(day) ?? { installs: [], visits: [] }; byDay.set(day, e); return e }
  for (const d of all.filter(d => d.day > today)) dayOf(d.day).installs.push(d)
  for (const v of visits.filter(v => v.day > today)) dayOf(v.day).visits.push(v)
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b))

  return (
    <div className="max-w-xl mx-auto space-y-4 pb-24" data-installer-home>
      <div>
        <h1 className="text-xl font-bold text-gray-900">My installs</h1>
        <p className="text-sm text-gray-500">{dayWords(today)}</p>
      </div>

      <section className="space-y-3" data-installs-today>
        <h2 className="text-sm font-semibold text-gray-900">Today</h2>
        {todays.length === 0 && todaysVisits.length === 0
          ? <p className="bg-white rounded-2xl border border-gray-200 p-4 text-sm text-gray-600">No install or service visit today.</p>
          : <>
            {todays.map(d => <InstallCard key={`${d.job.id}-${d.day}`} d={d} today />)}
            {todaysVisits.map(v => <VisitCard key={v.id} v={v} />)}
          </>}
      </section>

      <section className="space-y-3" data-installs-upcoming>
        <h2 className="text-sm font-semibold text-gray-900">Coming up</h2>
        {days.length === 0
          ? <p className="bg-white rounded-2xl border border-gray-200 p-4 text-sm text-gray-600">Nothing booked in the next {AHEAD_DAYS} days.</p>
          : days.map(([day, list]) => (
            <div key={day} className="space-y-2">
              <p className="text-xs font-semibold text-gray-600">{dayWords(day)}</p>
              {list.installs.map(d => <InstallCard key={`${d.job.id}-${d.day}`} d={d} />)}
              {list.visits.map(v => <VisitCard key={v.id} v={v} />)}
            </div>
          ))}
      </section>
    </div>
  )
}

/** A service or warranty visit: when, where, call, the issue and the office's notes, and the $0 work order. No prices. */
function VisitCard({ v }: { v: CrewVisit }) {
  const kind = v.type === 'warranty' ? 'Warranty visit' : v.type === 'service' ? 'Service visit' : TYPE_SHORT[v.type as keyof typeof TYPE_SHORT] ?? 'Visit'
  return (
    <article className="bg-white rounded-2xl border border-cyan-200 p-4 space-y-3" data-crew-visit={v.id}>
      <div>
        <p className="text-xs font-semibold text-cyan-800 uppercase tracking-wide">{kind}{v.allDay ? '' : ` · ${timeWords(v.startAt)}`}</p>
        <p className="text-lg font-bold text-gray-900">{v.customerName || 'Customer'}</p>
        <p className="text-sm text-gray-700">{v.address || 'No address on the visit'}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <a className={`btn btn-secondary min-h-[48px] ${v.address ? '' : 'pointer-events-none opacity-50'}`} href={v.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(v.address)}` : undefined} target="_blank" rel="noreferrer" data-visit-navigate>
          <Navigation size={18} aria-hidden="true" /> Navigate
        </a>
        <a className={`btn btn-secondary min-h-[48px] ${v.customerPhone ? '' : 'pointer-events-none opacity-50'}`} href={v.customerPhone ? `tel:${v.customerPhone.replace(/[^\d+]/g, '')}` : undefined} data-visit-call>
          <Phone size={18} aria-hidden="true" /> {v.customerPhone ? formatPhone(v.customerPhone) : 'No phone'}
        </a>
      </div>
      {v.ticket && (
        <div className="rounded-xl bg-cyan-50 border border-cyan-200 px-3 py-2 space-y-1" data-visit-ticket>
          <p className="text-sm font-semibold text-cyan-950">{v.ticket.issue}</p>
          {v.ticket.covered && <p className="text-sm text-cyan-950" data-visit-work-order>Warranty work order: no charge to the customer{v.ticket.warrantyName ? ` (${v.ticket.warrantyName})` : ''}.</p>}
          {v.ticket.notes && <p className="text-sm text-gray-800 whitespace-pre-wrap">{v.ticket.notes}</p>}
          {v.ticket.photos.length > 0 && (
            <div className="grid grid-cols-4 gap-1 pt-1" data-visit-photos>
              {v.ticket.photos.map(p => (
                <a key={p.id} href={apiUrl(p.url)} target="_blank" rel="noreferrer" className="block aspect-square bg-gray-100 rounded overflow-hidden">
                  {p.kind === 'video' ? <span className="grid place-items-center h-full text-xs text-gray-600">Video</span> : <img src={apiUrl(p.thumb ?? p.url)} alt="From the customer" className="w-full h-full object-cover" loading="lazy" />}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      {v.notes && <p className="text-sm text-gray-800 bg-gray-50 rounded-xl px-3 py-2 whitespace-pre-wrap" data-visit-notes>{v.notes}</p>}
      {v.packetToken
        ? <a className="btn btn-primary w-full min-h-[48px]" href={`${packetUrl(v.packetToken)}?visit=1`} target="_blank" rel="noreferrer" data-visit-packet><FileText size={18} aria-hidden="true" /> Open the work order (crew packet)</a>
        : v.ticket?.covered && <p className="text-xs text-gray-600">Take Completed photos when it is fixed and tell the office your hours and the materials used.</p>}
    </article>
  )
}

function lastTap(times: InstallTime[], kind: 'start' | 'finish', day: string): InstallTime | undefined {
  return [...times].reverse().find(t => t.kind === kind && t.day === day)
}

function InstallCard({ d, today = false }: { d: CrewDay; today?: boolean }) {
  const { job } = d
  // One copy per job (installPacket.tsx): day 1 and day 2 of a job show the same packet and taps.
  const [info, setInfo] = useState<CrewInstall | null>(() => crewInstallCached(job.id))
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [photos, setPhotos] = useState(false)
  const quote = (job.quoteId ? getQuoteById(job.quoteId) : null) as SavedQuote | null

  useEffect(() => {
    let live = true
    const h = (e: Event) => { if ((e as CustomEvent<{ jobId: string }>).detail?.jobId === job.id && live) setInfo(crewInstallCached(job.id)) }
    window.addEventListener(CREW_INSTALL_EVENT, h)
    fetchCrewInstall(job.id).then(r => { if (!live) return; if (!r) setLoadFailed(true) })
    return () => { live = false; window.removeEventListener(CREW_INSTALL_EVENT, h) }
  }, [job.id])

  const started = info ? lastTap(info.times, 'start', d.day) : undefined
  const finished = info ? lastTap(info.times, 'finish', d.day) : undefined
  const working = !!started && (!finished || finished.at < started.at)
  // The last crew day (or a one day job): Finish is the install finished. An earlier day: "Finish for today", and
  // "We finished the whole job" when it went faster than booked.
  const lastDay = d.dayNo >= d.days || (!!info?.lastDay && d.day >= info.lastDay)
  const jobDone = !!info?.jobDone

  async function tap(kind: 'start' | 'finish', wholeJob = false) {
    if (wholeJob && !window.confirm(`Finished the whole job for ${job.customerName}? The office is told the install is done.`)) return
    // Start while 811 is not clear: he is asked, and the office sees on the job that he was warned.
    const warn = kind === 'start' ? info?.locate?.warning : null
    if (warn && !window.confirm(`${warn}\n\nStart anyway? The office will see that you started before 811 was clear.`)) return
    setBusy(true)
    const r = await markInstall(job.id, kind, wholeJob)
    setBusy(false)
    if (!r) { toast.error(kind === 'start' ? 'Start was not saved' : 'Finish was not saved', 'No signal right now. Tap it again when you have signal.'); return }
    toast.success(kind === 'start' ? 'Started' : r.jobDone ? 'Job finished' : 'Finished for today', `${job.customerName}, ${timeWords(new Date().toISOString())}`)
  }

  async function makePacket() {
    // One tap makes it and opens it (review, Oct 27 2026). The tab opens on the tap: an iPhone blocks one opened after the wait.
    const tab = window.open('', '_blank')
    setBusy(true)
    const p = await sendInstallPacket(job.id, { fenceStyle: job.fenceStyle, notes: job.notes, walkGates: job.walkGates, dblGates: job.dblGates }, quote ?? undefined)
    setBusy(false)
    if (!p) { tab?.close(); toast.error('Could not make the crew packet', 'Check the signal and try again, or ask the office to send it.'); return }
    putCrewInstall(job.id, { packet: { token: p.token } })
    if (tab) { tab.opener = null; tab.location.href = new URL(packetUrl(p.token), window.location.href).href }
  }

  // A repair or a move: what is being done (the repair items), not the fence style and "0 sections" (round 2, Oct 26 2026).
  const work = workSummary(quote?.work)
  const facts = work ? [work] : [soldStyleLabel(job.fenceStyle, quote), job.totalFeet ? `${Math.round(job.totalFeet)} ft` : '', job.sections ? `${job.sections} sections` : '',
    job.walkGates ? `${job.walkGates} walk gate${job.walkGates > 1 ? 's' : ''}` : '', job.dblGates ? `${job.dblGates} double gate${job.dblGates > 1 ? 's' : ''}` : ''].filter(Boolean)

  return (
    <article className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3" data-install-card={job.id} data-install-day={d.day}>
      <div>
        <p className="text-lg font-bold text-gray-900">{job.customerName}</p>
        <p className="text-sm text-gray-700">{job.customerAddress || 'No address on the job'}</p>
        <p className="text-sm text-gray-600">{[d.crew, d.days > 1 ? `day ${d.dayNo} of ${d.days}` : ''].filter(Boolean).join(' · ')}</p>
        {facts.length > 0 && <p className="text-sm text-gray-600" data-install-facts>{facts.join(' · ')}</p>}
        {/* The job's 811 locate, the same record as the office's (the packet shows it in full). */}
        {info?.locate && <p className={`text-sm ${info.locate.status === 'clear' ? 'text-green-800' : info.locate.warning ? 'text-red-800 font-semibold' : 'text-gray-700'}`} data-install-locate={info.locate.status}>811{info.locate.ticket ? ` ticket ${info.locate.ticket}` : ''}: {info.locate.text}</p>}
      </div>

      {/* Not clear to dig yet, or expired: said plainly before he taps Start (audit Oct 26 2026). A warning, not a block. */}
      {info?.locate?.warning && !jobDone && (
        <p className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm font-semibold text-red-900" role="alert" data-install-locate-warn>
          <AlertTriangle size={16} className="inline -mt-0.5" aria-hidden="true" /> {info.locate.warning}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <a className={`btn btn-secondary min-h-[48px] ${job.customerAddress ? '' : 'pointer-events-none opacity-50'}`} href={job.customerAddress ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.customerAddress)}` : undefined} target="_blank" rel="noreferrer" data-install-navigate>
          <Navigation size={18} aria-hidden="true" /> Navigate
        </a>
        <a className={`btn btn-secondary min-h-[48px] ${job.customerPhone ? '' : 'pointer-events-none opacity-50'}`} href={job.customerPhone ? `tel:${job.customerPhone.replace(/[^\d+]/g, '')}` : undefined} data-install-call>
          <Phone size={18} aria-hidden="true" /> {job.customerPhone ? formatPhone(job.customerPhone) : 'No phone'}
        </a>
      </div>

      {info?.packet
        ? <a className="btn btn-primary w-full min-h-[48px]" href={packetUrl(info.packet.token)} target="_blank" rel="noreferrer" data-install-packet-open><FileText size={18} aria-hidden="true" /> Open crew packet</a>
        : info && <button type="button" className="btn btn-primary w-full min-h-[48px]" disabled={busy} onClick={makePacket} data-install-packet-make><FileText size={18} aria-hidden="true" /> Make the crew packet</button>}

      {today && (
        <div className="space-y-1" data-install-times data-install-last-day={lastDay ? 'yes' : 'no'}>
          {jobDone && !working
            ? <p className="rounded-xl bg-green-50 border border-green-200 px-3 py-2 text-sm text-green-900" data-install-job-done><CheckCircle2 size={16} className="inline -mt-0.5" aria-hidden="true" /> {jobDoneWords(info?.closeOut)}</p>
            : working
              ? (lastDay
                ? <button type="button" className="btn btn-primary w-full min-h-[48px] bg-green-700 hover:bg-green-800" disabled={busy} onClick={() => tap('finish')} data-install-finish data-install-finish-job><CheckCircle2 size={18} aria-hidden="true" /> Finish the job</button>
                : <>
                  <button type="button" className="btn btn-primary w-full min-h-[48px] bg-green-700 hover:bg-green-800" disabled={busy} onClick={() => tap('finish')} data-install-finish><Square size={18} aria-hidden="true" /> Finish for today (day {d.dayNo} of {d.days})</button>
                  <button type="button" className="btn btn-secondary w-full min-h-[48px]" disabled={busy} onClick={() => tap('finish', true)} data-install-finish-whole><CheckCircle2 size={18} aria-hidden="true" /> We finished the whole job</button>
                </>)
              : <button type="button" className="btn btn-primary w-full min-h-[48px]" disabled={busy || !info} onClick={() => tap('start')} data-install-start><Play size={18} aria-hidden="true" /> {finished ? 'Start again' : 'Start'}</button>}
          {started && <p className="text-sm text-gray-700" data-install-started>Started {timeWords(started.at)} by {started.by}{finished && finished.at > started.at ? `, ${finished.jobDone || lastDay ? 'finished the job' : 'finished for today'} ${timeWords(finished.at)} by ${finished.by}` : ''}.</p>}
          {!lastDay && !jobDone && <p className="text-xs text-gray-500">Finish on the last day ({d.days > 1 ? `day ${d.days}` : 'today'}) tells the office the install is done.</p>}
        </div>
      )}

      {info && info.customerNotes.length > 0 && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2" data-install-customer-notes>
          <p className="text-xs font-semibold text-amber-900">Customer notes</p>
          <ul className="text-sm text-amber-950 list-disc pl-5">{info.customerNotes.map(n => <li key={n}>{n}</li>)}</ul>
        </div>
      )}
      {loadFailed && <p className="text-sm text-gray-600">The packet, notes and times need signal. They load when the signal is back (pull down or reopen this screen).</p>}

      {photos
        ? <MediaGallery where={{ jobId: job.id, customerId: job.customerId }} defaultCategory="Progress" title="Progress and completed photos" />
        : <button type="button" className="btn btn-secondary w-full min-h-[48px]" onClick={() => setPhotos(true)} data-install-photos><Camera size={18} aria-hidden="true" /> Photos (progress, completed)</button>}
    </article>
  )
}
