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
import { Navigation, Phone, FileText, Play, Square, Camera } from 'lucide-react'
import { getJobs } from './jobStore'
import { getQuoteById } from './quoteStore'
import { loadSchedule, SCHEDULE_UPDATED_EVENT } from './scheduleStore'
import { styleLabel } from './fenceCatalog'
import { fetchCrewInstall, markInstall, sendInstallPacket, packetUrl, type CrewInstall, type InstallTime } from './installPacket'
import MediaGallery from './MediaGallery'
import { toast } from './toast'
import { formatPhone } from './phoneFormat'
import type { SavedQuote } from './QuotesPage'
import { crewDays, ymd, AHEAD_DAYS, type CrewDay } from './crewDays'

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

export default function InstallerHome() {
  const all = useCrewDays()
  const today = ymd(new Date())
  const todays = all.filter(d => d.day === today)
  const later = all.filter(d => d.day > today)
  const byDay = new Map<string, CrewDay[]>()
  for (const d of later) byDay.set(d.day, [...(byDay.get(d.day) ?? []), d])

  return (
    <div className="max-w-xl mx-auto space-y-4 pb-24" data-installer-home>
      <div>
        <h1 className="text-xl font-bold text-gray-900">My installs</h1>
        <p className="text-sm text-gray-500">{dayWords(today)}</p>
      </div>

      <section className="space-y-3" data-installs-today>
        <h2 className="text-sm font-semibold text-gray-900">Today</h2>
        {todays.length === 0
          ? <p className="bg-white rounded-2xl border border-gray-200 p-4 text-sm text-gray-600">No install today.</p>
          : todays.map(d => <InstallCard key={`${d.job.id}-${d.day}`} d={d} today />)}
      </section>

      <section className="space-y-3" data-installs-upcoming>
        <h2 className="text-sm font-semibold text-gray-900">Coming up</h2>
        {byDay.size === 0
          ? <p className="bg-white rounded-2xl border border-gray-200 p-4 text-sm text-gray-600">Nothing booked in the next {AHEAD_DAYS} days.</p>
          : [...byDay.entries()].map(([day, list]) => (
            <div key={day} className="space-y-2">
              <p className="text-xs font-semibold text-gray-600">{dayWords(day)}</p>
              {list.map(d => <InstallCard key={`${d.job.id}-${d.day}`} d={d} />)}
            </div>
          ))}
      </section>
    </div>
  )
}

function lastTap(times: InstallTime[], kind: 'start' | 'finish', day: string): InstallTime | undefined {
  return [...times].reverse().find(t => t.kind === kind && t.day === day)
}

function InstallCard({ d, today = false }: { d: CrewDay; today?: boolean }) {
  const { job } = d
  const [info, setInfo] = useState<CrewInstall | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [photos, setPhotos] = useState(false)
  const quote = (job.quoteId ? getQuoteById(job.quoteId) : null) as SavedQuote | null

  useEffect(() => {
    let live = true
    fetchCrewInstall(job.id).then(r => { if (!live) return; if (r) setInfo(r); else setLoadFailed(true) })
    return () => { live = false }
  }, [job.id])

  const started = info ? lastTap(info.times, 'start', d.day) : undefined
  const finished = info ? lastTap(info.times, 'finish', d.day) : undefined
  const working = !!started && (!finished || finished.at < started.at)

  async function tap(kind: 'start' | 'finish') {
    setBusy(true)
    const times = await markInstall(job.id, kind)
    setBusy(false)
    if (!times) { toast.error(kind === 'start' ? 'Start was not saved' : 'Finish was not saved', 'No signal right now. Tap it again when you have signal.'); return }
    setInfo(i => (i ? { ...i, times } : i))
    toast.success(kind === 'start' ? 'Started' : 'Finished', `${job.customerName}, ${timeWords(new Date().toISOString())}`)
  }

  async function makePacket() {
    setBusy(true)
    const p = await sendInstallPacket(job.id, { fenceStyle: job.fenceStyle, notes: job.notes, walkGates: job.walkGates, dblGates: job.dblGates }, quote ?? undefined)
    setBusy(false)
    if (!p) { toast.error('Could not make the crew packet', 'Check the signal and try again, or ask the office to send it.'); return }
    setInfo(i => (i ? { ...i, packet: { token: p.token } } : i))
  }

  const facts = [styleLabel(job.fenceStyle), job.totalFeet ? `${Math.round(job.totalFeet)} ft` : '', job.sections ? `${job.sections} sections` : '',
    job.walkGates ? `${job.walkGates} walk gate${job.walkGates > 1 ? 's' : ''}` : '', job.dblGates ? `${job.dblGates} double gate${job.dblGates > 1 ? 's' : ''}` : ''].filter(Boolean)

  return (
    <article className="bg-white rounded-2xl border border-gray-200 p-4 space-y-3" data-install-card={job.id} data-install-day={d.day}>
      <div>
        <p className="text-lg font-bold text-gray-900">{job.customerName}</p>
        <p className="text-sm text-gray-700">{job.customerAddress || 'No address on the job'}</p>
        <p className="text-sm text-gray-600">{[d.crew, d.days > 1 ? `day ${d.dayNo} of ${d.days}` : ''].filter(Boolean).join(' · ')}</p>
        {facts.length > 0 && <p className="text-sm text-gray-600">{facts.join(' · ')}</p>}
      </div>

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
        <div className="space-y-1" data-install-times>
          {working
            ? <button type="button" className="btn btn-primary w-full min-h-[48px] bg-green-700 hover:bg-green-800" disabled={busy} onClick={() => tap('finish')} data-install-finish><Square size={18} aria-hidden="true" /> Finish for today</button>
            : <button type="button" className="btn btn-primary w-full min-h-[48px]" disabled={busy || !info} onClick={() => tap('start')} data-install-start><Play size={18} aria-hidden="true" /> {finished ? 'Start again' : 'Start'}</button>}
          {started && <p className="text-sm text-gray-700" data-install-started>Started {timeWords(started.at)} by {started.by}{finished && finished.at > started.at ? `, finished ${timeWords(finished.at)} by ${finished.by}` : ''}.</p>}
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
