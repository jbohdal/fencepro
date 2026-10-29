/**
 * Scheduling an install, the one way it is done everywhere:
 *
 *   ReadyPanel             Schedule > Ready to schedule: every sold job not on
 *                          the schedule yet, with its customer, address, style,
 *                          footage, crew days, permit, 811, deposit, materials.
 *                          Drag a card onto a day (computer) or tap it (phone).
 *   ScheduleInstallDialog  Start day and crew; the crew days it fills (from the
 *                          quote's crew time, on crew working days only); what
 *                          is not ready yet (it can still be booked); Schedule.
 *                          A scheduled job: Move, or Take off the schedule.
 *   InstallTextSheet       The customer's text, prepared and shown; the office
 *                          opens it on their own phone and sends it, or not.
 *                          Never sent by the app, so every customer with a
 *                          phone number is offered it. After it is opened:
 *                          "Did you send the text?" Yes keeps it in the
 *                          customer's History and the card's, like a card text.
 *   MoveInstallConfirm     A booked install dragged to another day: move it?
 *   RainDayDialog          A rain day: what moves (one crew day later, from
 *                          that day on), then move it and the texts.
 *   ScheduleInstallButton  The job page's and the pipeline card's button.
 *
 * Everything is saved on the server (installScheduleApi.ts).
 */

import { locateOf, locateShortWarning } from '../../portal/src/server/lib/locates'
import { useEffect, useMemo, useState } from 'react'
import { canTextHere } from './textingDevice'
import { newId } from './recordSync'
import { loadSchedule, SCHEDULE_UPDATED_EVENT } from './scheduleStore'
import { monthEntries } from './monthEntries'
import { getJobs } from './jobStore'
import { jobInstallWord } from './jobWork'
import { stagePhase, stageName } from './opsStagesStore'
import { isDonePhase } from './opsStageModel'
import { smsLink } from './appointmentLogic'
import { businessDate } from './businessDate'
import { useBackLayer } from './nav'
import { can, REFUSAL } from './permissions'
import { toast } from './toast'
import {
  fetchReadyJobs, fetchJobFacts, scheduleInstall, unscheduleInstall, previewRainDay, applyRainDay, noteInstallTexted,
  type ReadyJob, type PreparedText, type RainMove, type InstallTextKind,
} from './installScheduleApi'
import {
  crewDaysOfWeek, installDays, isCrewDay, nextCrewDay, plusDays, scheduleWarnings, permitWords, locatesWords, usDate, phoneWords, PERMIT_ISSUED, firstInstallDay,
  crewConflicts, holidayOn, weekWords, shortDayWords,
} from '../../portal/src/server/lib/installDays'

/** The drag's data type: a Ready card's job id. */
export const READY_DRAG_TYPE = 'application/x-ezbiz-ready-job'

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const shortDay = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return `${WEEKDAY[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()]} ${m}/${dd}` }
// Whole dollars, or to the cent when there are cents (a contract priced before Oct 21 2026): the deposit invoice's own amount.
const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(cents / 100)

/** The first crew day after today, and not before the job's 811 good to dig date: where a new booking starts unless a day is picked. */
export function firstOpenDay(goodDate?: string | null): string {
  return firstInstallDay(businessDate(new Date()), crewDaysOfWeek(loadSchedule().settings.workDays), goodDate)
}

// What the job is in a line (a repair says its work): monthEntries.ts, shared with the month and the day.
export { jobScopeWords } from './monthEntries'
import { jobScopeWords } from './monthEntries'

/* ── Status chips ──────────────────────────────────────────────────────── */

type Tone = 'ok' | 'warn' | 'bad'
const TONE: Record<Tone, string> = { ok: 'bg-green-50 text-green-800 border-green-200', warn: 'bg-amber-50 text-amber-900 border-amber-200', bad: 'bg-red-50 text-red-800 border-red-200' }

export function readyChips(j: ReadyJob): Array<{ key: string; label: string; tone: Tone }> {
  const today = businessDate(new Date())
  const permitOk = j.permitStatus === 'not_needed' || PERMIT_ISSUED.includes(j.permitStatus ?? '')
  const loc = locatesWords(j, today)
  // Booked: the ticket against its own install days, so a "Clear to dig" chip never sits above a warning about the same ticket.
  const locWarn = /^\d{4}-\d{2}-\d{2}$/.test(j.scheduledDate || '') ? locateShortWarning(locateOf(j), j.scheduledDate, j.scheduledEndDate || j.scheduledDate) : null
  return [
    { key: 'permit', label: `Permit: ${permitWords(j.permitStatus)}`, tone: permitOk ? 'ok' : 'warn' },
    { key: 'locates', label: locWarn && loc.state === 'ok' ? `⚠ ${locWarn}` : `811: ${loc.text}`, tone: loc.state === 'expired' ? 'bad' : loc.state === 'ok' && !locWarn ? 'ok' : 'warn' },
    { key: 'deposit', label: j.deposit === 'paid' ? `Deposit paid${j.depositCents ? ` (${money(j.depositCents)})` : ''}` : j.deposit === 'part' ? `Deposit part paid (${money(j.depositPaidCents)} of ${money(j.depositCents)})` : j.deposit === 'unpaid' ? `Deposit not paid (${money(j.depositCents)})` : 'No deposit recorded', tone: j.deposit === 'paid' ? 'ok' : 'warn' },
    { key: 'materials', label: `Materials: ${j.materialsStatus === 'not_ordered' ? 'not ordered' : j.materialsStatus.replace('_', ' ')}`, tone: j.materialsStatus === 'not_ordered' ? 'warn' : 'ok' },
  ]
}

function Chips({ job }: { job: ReadyJob }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {readyChips(job).map(c => (
        <span key={c.key} className={`text-[11px] font-semibold border rounded-full px-2 py-0.5 ${TONE[c.tone]}`} data-ready-chip={c.key} data-tone={c.tone}>{c.label}</span>
      ))}
    </div>
  )
}

/* ── Ready to schedule ─────────────────────────────────────────────────── */

export function useReadyJobs(): { jobs: ReadyJob[] | null; error: string; reload: () => void } {
  const [jobs, setJobs] = useState<ReadyJob[] | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    fetchReadyJobs().then(r => { if (!live) return; if (r.ok) { setJobs(r.data); setError('') } else setError(r.error) })
    return () => { live = false }
  }, [tick])
  useEffect(() => {
    // A job scheduled anywhere (this screen, another device) leaves the list; a new sale joins it.
    const on = () => setTick(t => t + 1)
    window.addEventListener(SCHEDULE_UPDATED_EVENT, on)
    window.addEventListener('fencepro:jobs:updated', on)
    return () => { window.removeEventListener(SCHEDULE_UPDATED_EVENT, on); window.removeEventListener('fencepro:jobs:updated', on) }
  }, [])
  return { jobs, error, reload: () => setTick(t => t + 1) }
}

export function ReadyPanel({ ready, onPick, canDrag }: { ready: ReturnType<typeof useReadyJobs>; onPick: (job: ReadyJob) => void; canDrag: boolean }) {
  const { jobs, error, reload } = ready
  return (
    <section className="bg-white rounded-2xl border border-gray-200 flex flex-col min-h-0" data-ready-panel>
      <div className="px-4 pt-3 pb-2 border-b border-gray-100">
        <h3 className="text-sm font-bold text-gray-900">Ready to schedule {jobs ? <span className="text-gray-500 font-semibold" data-ready-count={jobs.length}>({jobs.length})</span> : null}</h3>
        <p className="text-xs text-gray-600 mt-0.5">{canDrag ? <><span className="hidden lg:inline">Drag a job onto a day, or click it.</span><span className="lg:hidden">Tap a job to pick its start day and crew.</span></> : 'Only the office and the owner schedule installs.'}</p>
      </div>
      {error && <div className="px-4 py-3 text-sm text-red-700">{error} <button type="button" className="underline" onClick={reload}>Try again</button></div>}
      {!jobs && !error && <p className="px-4 py-6 text-sm text-gray-500">Loading…</p>}
      {jobs && jobs.length === 0 && <p className="px-4 py-6 text-sm text-gray-600" data-ready-empty>Every sold job is on the schedule.</p>}
      {jobs && jobs.length > 0 && (
        <ul className="divide-y divide-gray-100 overflow-y-auto lg:max-h-[calc(100vh-220px)]">
          {jobs.map(j => (
            <li key={j.id}>
              <button
                type="button"
                draggable={canDrag}
                onDragStart={e => { e.dataTransfer.setData(READY_DRAG_TYPE, j.id); e.dataTransfer.setData('text/plain', j.customerName); e.dataTransfer.effectAllowed = 'move' }}
                onClick={() => onPick(j)}
                className={`w-full text-left px-4 py-3 hover:bg-orange-50 min-h-[56px] ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
                data-ready-job={j.id}
              >
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-gray-900 truncate" data-ready-name>{j.customerName}</span>
                    <span className="block text-xs text-gray-600 truncate" data-ready-address>{j.address || 'No address'}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-bold text-gray-900" data-ready-days={j.crewDays}>{j.crewDays} crew day{j.crewDays === 1 ? '' : 's'}</span>
                    <span className="block text-[11px] text-gray-500">{j.crewDaysFrom === 'quote' ? 'from the quote' : 'estimate'}</span>
                  </span>
                </span>
                <span className="block text-xs text-gray-700 mt-1" data-ready-scope>{jobScopeWords(j)}</span>
                <span className="block text-[11px] text-gray-500">{j.stageName}</span>
                <Chips job={j} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ── The window ────────────────────────────────────────────────────────── */

function Sheet({ children, onClose, label, attr }: { children: React.ReactNode; onClose: () => void; label: string; attr?: Record<string, string> }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/40 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-label={label} onClick={e => e.stopPropagation()} {...attr}
        className="bg-white w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl shadow-2xl pb-[env(safe-area-inset-bottom)]">
        {children}
      </div>
    </div>
  )
}

function Head({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="sticky top-0 bg-white z-10 border-b border-gray-100 px-5 py-3 flex items-center justify-between">
      <h2 className="text-base font-bold text-gray-900">{title}</h2>
      <button type="button" onClick={onClose} aria-label="Close" className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-700 text-xl">✕</button>
    </div>
  )
}

/**
 * Pick the start day and crew, see the crew days and what is not ready, book
 * it. Open on a job (its id): from the Ready list, a day on the Schedule, the
 * job page or the pipeline card. A job already scheduled opens to move it.
 */
export function ScheduleInstallDialog({ jobId, start: startAt, onClose, onDone }: {
  jobId: string
  /** The day it was dropped on (or tapped); else its own start, else the next crew day. */
  start?: string
  onClose: () => void
  onDone?: () => void
}) {
  useBackLayer(onClose, { key: 'schedule-install' })
  // "Schedule repair" for a repair job (jobWork.ts jobInstallWord; recheck Oct 27 2026).
  const W = jobInstallWord(getJobs().find(j => j.id === jobId)), w = W.toLowerCase()
  const { settings } = loadSchedule()
  const crews = settings.crews
  const [facts, setFacts] = useState<ReadyJob | null>(null)
  const [error, setError] = useState('')
  const [start, setStart] = useState(startAt || '')
  const [crew, setCrew] = useState('')
  const [days, setDays] = useState(0)
  const [weekends, setWeekends] = useState(false)
  const [saving, setSaving] = useState(false)
  const [text, setText] = useState<{ text: PreparedText; title: string; summary: string; what: InstallTextKind } | null>(null)
  const [confirmOff, setConfirmOff] = useState(false)

  useEffect(() => {
    let live = true
    fetchJobFacts(jobId).then(r => {
      if (!live) return
      if (!r.ok) { setError(r.error); return }
      const f = r.data
      setFacts(f)
      setStart(s => s || f.scheduledDate || firstOpenDay(f.locatesDate))
      const booked = f.bookedDays.length
      setDays(booked || f.crewDays || 1)
      setCrew(crews.find(c => c.name === f.crewAssigned || c.id === f.crewAssigned)?.id ?? crews[0]?.id ?? '')
      // Only ticked when it was booked that way on purpose; never guessed from the days (a Friday switched off is not a weekend).
      setWeekends(f.allowWeekend)
    })
    return () => { live = false }
  }, [jobId])  // eslint-disable-line react-hooks/exhaustive-deps

  const week = crewDaysOfWeek(settings.workDays, weekends)
  const planned = useMemo(() => (start ? installDays(start, days || 1, week) : []), [start, days, week.join(',')])  // eslint-disable-line react-hooks/exhaustive-deps
  const crewName = crews.find(c => c.id === crew)?.name ?? 'This crew'
  const warnings: Array<{ key: string; text: string }> = facts && planned.length ? [
    ...scheduleWarnings(facts, planned[0], planned[planned.length - 1]),
    // Double booking: the crew already has another install on one of the days (still allowed).
    // The same list the month shows: the entries and the jobs dated the old way with none (monthEntries.ts).
    ...crewConflicts(monthEntries(getJobs(), loadSchedule().jobs, settings).map(j => ({ id: j.id, stagingJobId: j.stagingJobId, clientName: j.clientName, crewId: j.crewId, date: j.date, status: j.status })), jobId, crew, planned)
      .map(c => ({ key: 'crew', text: `${crewName} already has ${c.clientName} on ${shortDayWords(c.date)}.` })),
    ...planned.filter(d => holidayOn(d)).map(d => ({ key: 'holiday', text: `${shortDayWords(d)} is ${holidayOn(d)}.` })),
  ] : []
  const scheduled = !!facts?.scheduledDate
  const closedJob = !!facts && isDonePhase(stagePhase(facts.stage))
  // Days it is booked on that are not crew days any more (Friday switched off): shown, and Move puts them on crew days.
  const offDays = facts && !facts.allowWeekend ? facts.bookedDays.filter(d => !isCrewDay(d, crewDaysOfWeek(settings.workDays))) : []

  async function save() {
    if (!facts || saving || !start) return
    if (!can('schedule.change')) { toast.error('Not saved', REFUSAL['schedule.change']); return }
    setSaving(true)
    const r = await scheduleInstall({ jobId, start, crew, days: days || 1, allowWeekend: weekends })
    setSaving(false)
    if (!r.ok) { toast.error('Not scheduled', r.error); return }
    const d = r.data
    const note = d.movedFrom ? ` ${usDate(d.movedFrom)} is not a crew day, so it starts ${usDate(d.days[0])}.` : ''
    setText({ text: d.text, title: d.rescheduled ? `${W} moved` : `${W} scheduled`, what: d.rescheduled ? 'moved' : 'scheduled',
      summary: `${d.text.customerName}: ${d.days.length} crew day${d.days.length === 1 ? '' : 's'}, ${d.days.map(shortDay).join(', ')}, ${d.crew.name}.${note} ${d.calendar}` })
    onDone?.()
  }

  async function takeOff() {
    if (saving) return
    setSaving(true)
    const r = await unscheduleInstall(jobId)
    setSaving(false)
    if (!r.ok) { toast.error('Not changed', r.error); return }
    setText({ text: r.data.text, title: 'Off the schedule', what: 'off', summary: `${facts?.customerName ?? 'The job'} is back in Ready to schedule, in ${r.data.stageName}. The crew and dates are cleared.` })
    onDone?.()
  }

  if (text) {
    return <InstallTextSheet text={text.text} what={text.what} onClose={onClose} title={text.title} summary={text.summary} />
  }

  return (
    <Sheet onClose={onClose} label={`Schedule ${w}`} attr={{ 'data-schedule-install': jobId }}>
      <Head title={closedJob ? W : scheduled ? `Move ${w}` : `Schedule ${w}`} onClose={onClose} />
      {error && <p className="p-5 text-sm text-red-700">{error}</p>}
      {!facts && !error && <p className="p-5 text-sm text-gray-500">Loading…</p>}
      {facts && (
        <div className="p-5 space-y-4">
          <div>
            <p className="text-base font-semibold text-gray-900" data-si-name>{facts.customerName}</p>
            <p className="text-sm text-gray-600">{facts.address || 'No address'}</p>
            <p className="text-sm text-gray-700 mt-1" data-si-scope>{jobScopeWords(facts)}</p>
            {scheduled && <p className="text-sm text-gray-700 mt-1" data-si-current>Now: {facts.bookedDays.length ? facts.bookedDays.map(shortDay).join(', ') : usDate(facts.scheduledDate)}{facts.crewAssigned ? `, ${facts.crewAssigned}` : ''}</p>}
            {!closedJob && <Chips job={facts} />}
          </div>

          {/* A closed job (Complete, Invoiced, Paid): its days are history; nothing to move or take off. */}
          {closedJob ? (
            <div className="space-y-3" data-si-closed>
              <p className="rounded-xl bg-green-50 border border-green-200 p-3 text-sm text-green-900">{facts.customerName}'s job is {stageName(facts.stage) || 'closed'}: installed and closed. Its install days stay on the month as a record.</p>
              <button type="button" className="btn btn-secondary w-full min-h-[48px]" onClick={onClose}>Close</button>
            </div>
          ) : <>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Starts</span>
              <input type="date" value={start} onChange={e => setStart(e.target.value)} data-si-start
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[48px]" />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Crew</span>
              <select value={crew} onChange={e => setCrew(e.target.value)} data-si-crew
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base h-12 min-h-[48px] bg-white appearance-auto">
                {crews.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold text-gray-600">Crew days</span>
            <button type="button" className="btn btn-secondary btn-icon" aria-label="One day less" onClick={() => setDays(d => Math.max(1, d - 1))} data-si-days-less>−</button>
            <span className="text-lg font-bold w-8 text-center tabular-nums" data-si-days>{days || 1}</span>
            <button type="button" className="btn btn-secondary btn-icon" aria-label="One day more" onClick={() => setDays(d => Math.min(60, d + 1))} data-si-days-more>+</button>
            <span className="text-xs text-gray-500">{facts.crewDaysFrom === 'quote' ? `Quote: ${facts.crewDays}` : `Estimate: ${facts.crewDays}`}</span>
          </div>

          <div className="rounded-xl bg-gray-50 border border-gray-200 p-3" data-si-plan={planned.join(',')}>
            <p className="text-xs font-semibold text-gray-600">Crew days booked</p>
            <p className="text-sm font-semibold text-gray-900 mt-0.5">{planned.map(shortDay).join(' · ')}</p>
            {start && planned[0] && planned[0] !== start && <p className="text-xs text-amber-800 mt-1" data-si-moved-start>{shortDay(start)} is not a crew day: it starts {shortDay(planned[0])}.</p>}
            <p className="text-[11px] text-gray-500 mt-1" data-si-week>{weekends ? 'Every day, weekends too, for this job.' : `Crew days: ${weekWords(crewDaysOfWeek(settings.workDays))} (Schedule > Settings).`}</p>
            <label className="flex items-center gap-2 mt-2 text-sm text-gray-700 min-h-[44px]">
              <input type="checkbox" checked={weekends} onChange={e => setWeekends(e.target.checked)} className="w-5 h-5 accent-orange-500" data-si-weekends />
              The crew works weekends on this job
            </label>
          </div>

          {offDays.length > 0 && (
            <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900" data-si-offdays={offDays.join(',')}>
              {offDays.map(d => <p key={d}>{shortDayWords(d)}: {DAY_NAME[new Date(`${d}T12:00:00Z`).getUTCDay()]} is not a work day any more. Move install puts every day on crew days.</p>)}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3" data-si-warnings={warnings.map(w => w.key).join(',')}>
              <p className="text-sm font-semibold text-amber-900">Not ready yet. You can still schedule it.</p>
              <ul className="mt-1 space-y-0.5 list-disc pl-5 text-sm text-amber-900">
                {warnings.map(w => <li key={`${w.key}:${w.text}`} data-si-warning={w.key}>{w.text}</li>)}
              </ul>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <button type="button" className="btn btn-primary flex-1 min-h-[48px]" disabled={saving || !start || !crew} onClick={save} data-si-save>
              {saving ? 'Saving…' : scheduled ? `Move ${w}` : warnings.length ? 'Schedule anyway' : `Schedule ${w}`}
            </button>
            <button type="button" className="btn btn-secondary min-h-[48px]" onClick={onClose}>Cancel</button>
          </div>
          {scheduled && (confirmOff ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
              Take {facts.customerName} off the schedule? The crew days come off and the job goes back to Ready to schedule.
              <div className="flex gap-2 mt-2">
                <button type="button" className="btn btn-danger btn-sm min-h-[44px]" onClick={takeOff} disabled={saving} data-si-off-yes>Take it off</button>
                <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => setConfirmOff(false)}>Keep it</button>
              </div>
            </div>
          ) : (
            <button type="button" className="text-sm text-red-700 underline min-h-[44px]" onClick={() => setConfirmOff(true)} data-si-off>Take off the schedule</button>
          ))}
          </>}
        </div>
      )}
    </Sheet>
  )
}

/* ── The customer's text ───────────────────────────────────────────────── */

/**
 * The prepared text, shown; it opens in this phone's own texting app, never
 * sent by the app. Once opened it asks "Did you send the text?", as a card's
 * Text does: Yes keeps it in the customer's History (and the card's); No keeps
 * nothing. On a computer, which may not send texts, it also offers the words
 * to copy and send from a phone (as "Text the receipt" does there).
 */
export function TextPreview({ text, what, onLogged }: { text: PreparedText; what: InstallTextKind; onLogged?: () => void }) {
  const [ask, setAsk] = useState(false)
  const [logged, setLogged] = useState<'no' | 'saving' | 'yes'>('no')
  // One id for this text: a second Yes (a retry) is the same History row.
  const [id] = useState(() => newId())
  const computer = !canTextHere()
  async function sent() {
    if (logged !== 'no') return
    setLogged('saving')
    const r = await noteInstallTexted(text.jobId, what, text.phone, id)
    if (r.ok) { setLogged('yes'); setAsk(false); onLogged?.(); toast.success('Saved in History', `Text to ${text.customerName}`) }
    else { setLogged('no'); toast.error('Not saved in History', r.error) }
  }
  return (
    <div className="rounded-xl border border-gray-200 p-3 space-y-2" data-install-text={text.jobId} data-text-allowed={text.allowed ? 'yes' : 'no'}>
      <p className="text-xs font-semibold text-gray-600">Text to {text.customerName}{text.phone ? `, ${phoneWords(text.phone)}` : ''}</p>
      <p className="text-sm text-gray-900 whitespace-pre-wrap bg-gray-50 rounded-lg p-2" data-install-text-body>{text.body}</p>
      {text.allowed && text.phone ? (
        <>
          <a href={smsLink(text.phone, text.body)} onClick={() => { if (logged !== 'yes') setAsk(true) }} className="btn btn-primary w-full min-h-[48px]" data-install-text-open>{logged === 'yes' ? 'Open the text again' : 'Open the text to send'}</a>
          {logged === 'yes' && <p className="text-sm text-green-800" data-install-text-logged>Saved in {text.customerName}'s History as texted.</p>}
          {ask && logged !== 'yes' && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 space-y-2" data-install-text-ask>
              {computer && (
                <>
                  <p className="text-sm text-gray-800">This computer may not send texts. Send this from your phone if it did not open:</p>
                  <button type="button" className="text-sm text-blue-700 underline min-h-[36px]" onClick={() => { navigator.clipboard?.writeText(text.body).then(() => toast.success('Copied'), () => toast.error('Could not copy', 'Select the words and copy them.')) }} data-install-text-copy>Copy the text</button>
                </>
              )}
              <p className="text-sm font-semibold text-gray-900">Did you send the text?</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn btn-primary min-h-[48px]" disabled={logged === 'saving'} onClick={sent} data-install-text-sent>{logged === 'saving' ? 'Saving…' : 'Yes, I sent it'}</button>
                <button type="button" className="btn btn-secondary min-h-[48px]" disabled={logged === 'saving'} onClick={() => setAsk(false)} data-install-text-not-sent>No</button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-red-800" data-install-text-blocked>{text.reason || 'No phone number on the customer.'}</p>
      )}
      {text.callFrom === 'company' && <p className="text-[11px] text-gray-500">The text gives the company number: the job's salesman has no Direct phone in Settings {'>'} Team.</p>}
    </div>
  )
}

export function InstallTextSheet({ text, what, title, summary, onClose }: { text: PreparedText; what: InstallTextKind; title: string; summary: string; onClose: () => void }) {
  const [texted, setTexted] = useState(false)
  return (
    <Sheet onClose={onClose} label={title} attr={{ 'data-install-done': text.jobId }}>
      <Head title={title} onClose={onClose} />
      <div className="p-5 space-y-4">
        <p className="text-sm text-gray-800" data-install-summary>{summary}</p>
        <p className="text-sm font-semibold text-gray-900">Text the customer?</p>
        <TextPreview text={text} what={what} onLogged={() => setTexted(true)} />
        <button type="button" className="btn btn-secondary w-full min-h-[48px]" onClick={onClose} data-install-text-skip>{texted ? 'Done' : text.allowed ? "Don't text, close" : 'Close'}</button>
      </div>
    </Sheet>
  )
}

/* ── A booked install dragged to another day ───────────────────────────── */

export function MoveInstallConfirm({ jobId, name, from, to, onClose }: { jobId: string; name: string; from: string; to: string; onClose: () => void }) {
  useBackLayer(onClose, { key: 'move-install' })
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<{ text: PreparedText; days: string[]; crew: string } | null>(null)
  async function move() {
    if (saving) return
    setSaving(true)
    const r = await scheduleInstall({ jobId, start: to })
    setSaving(false)
    if (!r.ok) { toast.error('Not moved', r.error); onClose(); return }
    setDone({ text: r.data.text, days: r.data.days, crew: `${r.data.crew.name}. ${r.data.calendar}` })
  }
  if (done) return <InstallTextSheet text={done.text} what="moved" onClose={onClose} title="Install moved"
    summary={`${name}: now ${done.days.map(shortDay).join(', ')}, ${done.crew}`} />
  return (
    <Sheet onClose={onClose} label="Move install" attr={{ 'data-move-install': jobId }}>
      <Head title="Move install?" onClose={onClose} />
      <div className="p-5 space-y-4">
        <p className="text-sm text-gray-800">Move <span className="font-semibold">{name}</span> from {usDate(from)} to start {usDate(to)}? Its crew days move with it, on crew days only.</p>
        <p className="text-sm text-gray-600">Next you can text the customer the new date, or not.</p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-primary flex-1 min-h-[48px]" onClick={move} disabled={saving} data-move-install-yes>{saving ? 'Moving…' : 'Move it'}</button>
          <button type="button" className="btn btn-secondary min-h-[48px]" onClick={onClose} data-move-install-no>Cancel</button>
        </div>
      </div>
    </Sheet>
  )
}

/* ── Rain day ──────────────────────────────────────────────────────────── */

export function RainDayDialog({ date: dateAt, onClose }: { date?: string; onClose: () => void }) {
  useBackLayer(onClose, { key: 'rain-day' })
  // The day is picked first (a card's 🌧 brings its own day): nothing is listed until then.
  const [date, setDate] = useState(dateAt || '')
  const [confirming, setConfirming] = useState(false)
  const [shift, setShift] = useState(1)
  const [reason, setReason] = useState('Weather — rain')
  const [preview, setPreview] = useState<RainMove[] | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<RainMove[] | null>(null)

  useEffect(() => {
    let live = true
    setPreview(null)
    setConfirming(false)
    if (!date) return
    previewRainDay(date, shift).then(r => { if (!live) return; if (r.ok) { setPreview(r.data); setError('') } else setError(r.error) })
    return () => { live = false }
  }, [date, shift])

  async function apply() {
    if (saving || !preview?.length) return
    if (!can('schedule.change')) { toast.error('Not saved', REFUSAL['schedule.change']); return }
    setSaving(true)
    const r = await applyRainDay(date, shift, reason)
    setSaving(false)
    if (!r.ok) { toast.error('Not moved', r.error); return }
    setDone(r.data)
  }

  const list = done ?? preview
  const clashes = [...new Set((list ?? []).flatMap(m => m.clashes ?? []))]
  return (
    <Sheet onClose={onClose} label="Rain day" attr={{ 'data-rain-day': done ? 'done' : 'preview' }}>
      <Head title={done ? 'Rain day: moved' : 'Rain day'} onClose={onClose} />
      <div className="p-5 space-y-4">
        {!done && (
          <>
            <p className="text-sm text-gray-700">Every install from this day on moves {shift === 1 ? 'one crew day' : `${shift} crew days`} later. Days before it stay.</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-semibold text-gray-600 mb-1">Rain day</span>
                <input type="date" value={date} onChange={e => e.target.value && setDate(e.target.value)} data-rain-date className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base min-h-[48px]" />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-gray-600 mb-1">Move by (crew days)</span>
                <select value={shift} onChange={e => setShift(Number(e.target.value))} data-rain-shift className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base h-12 min-h-[48px] bg-white">
                  {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="block text-xs font-semibold text-gray-600 mb-1">Reason</span>
              <select value={reason} onChange={e => setReason(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base h-12 min-h-[48px] bg-white">
                {['Weather — rain', 'Weather — storm', 'Weather — extreme heat', 'Weather — cold/freeze', 'Ground conditions — too wet', 'Other weather delay'].map(x => <option key={x}>{x}</option>)}
              </select>
            </label>
          </>
        )}
        {error && <p className="text-sm text-red-700">{error}</p>}
        {!date && <p className="text-sm text-gray-600" data-rain-pick>Pick the rain day to see what moves.</p>}
        {date && !list && !error && <p className="text-sm text-gray-500">Working it out…</p>}
        {list && list.length === 0 && <p className="text-sm text-gray-600" data-rain-none>No installs on or after {usDate(date)}.</p>}
        {clashes.length > 0 && (
          <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900" data-rain-clashes={clashes.length}>
            <p className="font-semibold">Two installs on one crew after the move:</p>
            <ul className="list-disc pl-5 mt-1">{clashes.map(c => <li key={c} data-rain-clash>{c}</li>)}</ul>
            <p className="text-xs mt-1">You can still move them, then move one of the two on the Schedule.</p>
          </div>
        )}
        {list && list.length > 0 && (
          <ul className="space-y-3" data-rain-moves={list.length}>
            {list.map((m, i) => (
              <li key={`${m.jobId ?? 'x'}-${i}`} className="rounded-xl border border-gray-200 p-3" data-rain-move={m.jobId ?? ''}>
                <p className="text-sm font-semibold text-gray-900">{m.customerName}</p>
                <p className="text-xs text-gray-700" data-rain-days>{m.days.map(d => `${shortDay(d.from)} → ${shortDay(d.to)}`).join(' · ')}</p>
                {m.startTo === m.startFrom && <p className="text-[11px] text-gray-500">Already under way: it runs a day longer. No new start date to text.</p>}
                {done && m.text && <div className="mt-2"><TextPreview text={m.text} what="rain" /></div>}
                {!done && m.text && <p className="text-[11px] text-gray-500 mt-1">A text with the new start ({usDate(m.startTo)}) is prepared after you move it.</p>}
              </li>
            ))}
          </ul>
        )}
        {!done && confirming && preview?.length ? (
          <div className="rounded-xl border border-blue-300 bg-blue-50 p-3 space-y-2" data-rain-confirm-box>
            <p className="text-sm text-blue-900">Move these {preview.length} install{preview.length === 1 ? '' : 's'}, from {shortDay(date)} on, {shift === 1 ? 'one crew day' : `${shift} crew days`} later?{clashes.length ? ` ${clashes.length === 1 ? 'One day has' : `${clashes.length} days have`} two installs on one crew (above).` : ''}</p>
            <div className="flex gap-2">
              <button type="button" className="btn btn-primary flex-1 min-h-[48px]" disabled={saving} onClick={apply} data-rain-confirm>{saving ? 'Moving…' : 'Yes, move them'}</button>
              <button type="button" className="btn btn-secondary min-h-[48px]" onClick={() => setConfirming(false)}>Go back</button>
            </div>
          </div>
        ) : !done ? (
          <div className="flex gap-2">
            <button type="button" className="btn btn-primary flex-1 min-h-[48px]" disabled={saving || !preview?.length} onClick={() => setConfirming(true)} data-rain-apply>
              {!date ? 'Pick the day first' : preview?.length ? `Move ${preview.length} install${preview.length === 1 ? '' : 's'}…` : 'Nothing to move'}
            </button>
            <button type="button" className="btn btn-secondary min-h-[48px]" onClick={onClose}>Cancel</button>
          </div>
        ) : (
          <button type="button" className="btn btn-secondary w-full min-h-[48px]" onClick={onClose} data-rain-close>Done</button>
        )}
      </div>
    </Sheet>
  )
}

/* ── The button on the job page and the pipeline card ──────────────────── */

/** `word`: "Repair" on a repair job ("Schedule repair", "Move repair"); "Install" otherwise (jobWork.ts jobInstallWord). */
export function ScheduleInstallButton({ jobId, scheduledDate, className = 'btn btn-primary w-full min-h-[48px]', word = 'Install' }: { jobId: string; scheduledDate?: string; className?: string; word?: 'Install' | 'Repair' }) {
  const [open, setOpen] = useState(false)
  const w = word.toLowerCase()
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} data-schedule-install-button={jobId}>
        {scheduledDate ? `Move ${w}` : `Schedule ${w}`}
      </button>
      {open && <ScheduleInstallDialog jobId={jobId} onClose={() => setOpen(false)} />}
    </>
  )
}

/** "Mon 11/2, Tue 11/3" for a booked job's crew days (or its start and end when it has no board entries). */
export function bookedWords(start: string, end: string | null | undefined, workDays: number[]): string {
  if (!start) return 'Not scheduled'
  if (!end || end <= start) return shortDay(start)
  const days: string[] = []
  const week = crewDaysOfWeek(workDays)
  for (let d = start, i = 0; d <= end && i < 90; d = plusDays(d, 1), i++) if (isCrewDay(d, week) || d === start || d === end) days.push(d)
  return days.map(shortDay).join(', ')
}
