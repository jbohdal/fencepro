import { useState, useEffect } from 'react'
import { styleLabel } from './fenceCatalog'
import {
  loadSchedule as storeLoadSchedule,
  saveSchedule as storeSaveSchedule,
  loadRainLog as storeLoadRainLog,
  SCHEDULE_UPDATED_EVENT,
  RAIN_LOG_UPDATED_EVENT,
} from './scheduleStore'
import { useMergedRefresh } from './useMergedRefresh'
import { useBackLayer } from './nav'
import ScheduleDay from './ScheduleDay'
import { can, REFUSAL } from './permissions'
import { toast } from './toast'
import { businessDate } from './businessDate'
import { ReadyPanel, useReadyJobs, ScheduleInstallDialog, MoveInstallConfirm, RainDayDialog, READY_DRAG_TYPE } from './ScheduleInstall'
import { crewDaysOfWeek, isCrewDay, plusDays, nextCrewDay, holidayOn, weekWords, sameCrewClashes, namesWords } from '../../portal/src/server/lib/installDays'
import { fetchWeekendJobs } from './installScheduleApi'
import { crewHex } from './dispatchPins'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScheduledJob {
  id: string
  clientName: string
  area: string
  sections: number
  fenceType: string
  jobPrice: number
  tearout: boolean
  crewId: string
  date: string
  notes: string
  stagingJobId?: string
  status: 'Scheduled' | 'In Progress' | 'Complete' | 'Rain Day' | 'Rolled Over'
}

export interface Crew {
  id: string
  name: string
  color: string
}

export interface ScheduleSettings {
  workDays: number[]
  crews: Crew[]
}

// ── Rain Day Log ──
export interface RainDayEntry {
  id: string
  jobId: string
  clientName: string
  originalDate: string
  rescheduleDate: string   // '' = TBD
  reason: string
  flaggedAt: string
}

const loadRainLog = (): RainDayEntry[] => storeLoadRainLog()

// ── Weather (OpenWeatherMap free tier) ──
interface WeatherDay { date: string; temp: number; description: string; icon: string; rain: boolean }
const OWM_KEY = typeof import.meta !== 'undefined' ? (import.meta as any).env?.VITE_OPENWEATHER_API_KEY || '' : ''

async function fetchForecast(lat = 28.538, lon = -81.379): Promise<WeatherDay[]> {
  if (!OWM_KEY) return []
  try {
    const res = await fetch(`https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=imperial&appid=${OWM_KEY}`)
    if (!res.ok) return []
    const data = await res.json()
    const days: WeatherDay[] = []
    const seen = new Set<string>()
    for (const entry of data.list) {
      const d = entry.dt_txt.slice(0, 10)
      if (seen.has(d)) continue
      seen.add(d)
      const desc = entry.weather?.[0]?.description || ''
      const icon = entry.weather?.[0]?.icon || '01d'
      const isRain = desc.includes('rain') || desc.includes('storm') || desc.includes('drizzle')
      days.push({ date: d, temp: Math.round(entry.main.temp), description: desc, icon, rain: isRain })
    }
    return days
  } catch { return [] }
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_FULL  = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const CREW_COLORS = [
  'bg-blue-500', 'bg-purple-500', 'bg-green-500', 'bg-orange-500',
  'bg-pink-500', 'bg-teal-500', 'bg-red-500', 'bg-indigo-500',
  'bg-yellow-500', 'bg-cyan-500',
]

const DEFAULT_SETTINGS: ScheduleSettings = {
  workDays: [1, 2, 3, 4],
  crews: [{ id: 'crew1', name: 'Crew 1', color: 'bg-blue-500' }],
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const uid = () => Math.random().toString(36).slice(2, 9)

function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d)
  result.setDate(result.getDate() + n)
  return result
}

function getMonthWeeks(year: number, month: number, workDays: number[]): Date[][] {
  const weeks: Date[][] = []
  const firstDay = new Date(year, month, 1)
  const lastDay  = new Date(year, month + 1, 0)
  let current    = getMondayOfWeek(firstDay)
  while (current <= lastDay) {
    const week: Date[] = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(current)
      d.setDate(current.getDate() + i)
      if (workDays.includes(d.getDay())) week.push(d)
    }
    if (week.some(d => d.getMonth() === month)) weeks.push(week)
    current = addDays(current, 7)
  }
  return weeks
}

const loadSchedule = (): { jobs: ScheduledJob[], settings: ScheduleSettings } => storeLoadSchedule()
const saveSchedule = (jobs: ScheduledJob[], settings: ScheduleSettings) => storeSaveSchedule(jobs, settings)

// ── Settings Modal ────────────────────────────────────────────────────────────

function SettingsModal({
  settings,
  onSave,
  onClose,
}: {
  settings: ScheduleSettings
  onSave: (s: ScheduleSettings) => void
  onClose: () => void
}) {
  useBackLayer(onClose, { key: 'settings-modal' })
  // Monday to Friday only: Saturday and Sunday are per job ("weekends too"), never a setting.
  const [workDays, setWorkDays] = useState<number[]>(() => crewDaysOfWeek(settings.workDays))
  const [crews, setCrews]       = useState<Crew[]>([...settings.crews])

  function toggleDay(d: number) {
    setWorkDays(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort()
    )
  }

  function addCrew() {
    setCrews(prev => [...prev, {
      id: uid(),
      name: `Crew ${prev.length + 1}`,
      color: CREW_COLORS[prev.length % CREW_COLORS.length],
    }])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px] max-h-[90vh] overflow-y-auto mx-4 lg:mx-0 modal-responsive">
        <div className="px-6 py-5 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">Schedule Settings</h2>
          <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Work Days</h3>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map(d => (
                <button
                  key={d}
                  onClick={() => toggleDay(d)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
                    workDays.includes(d)
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'border-gray-200 text-gray-500 hover:border-orange-300'
                  }`}
                >{DAY_NAMES[d]}</button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-2" data-settings-week>Crew days: {weekWords(crewDaysOfWeek(workDays))}. Saturday and Sunday are only worked on a job booked with "The crew works weekends on this job".</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Crews</h3>
              <button onClick={addCrew} className="text-xs text-orange-500 hover:underline">+ Add crew</button>
            </div>
            <div className="space-y-2">
              {crews.map((crew, i) => (
                <div key={crew.id} className="flex items-center gap-2">
                  <div className={`w-4 h-4 rounded-full shrink-0 ${crew.color}`} />
                  <input
                    className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    value={crew.name}
                    onChange={e => setCrews(prev => prev.map(c => c.id === crew.id ? { ...c, name: e.target.value } : c))}
                  />
                  <select
                    className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none"
                    value={crew.color}
                    onChange={e => setCrews(prev => prev.map(c => c.id === crew.id ? { ...c, color: e.target.value } : c))}
                  >
                    {CREW_COLORS.map(c => (
                      <option key={c} value={c}>{c.replace('bg-','').replace('-500','')}</option>
                    ))}
                  </select>
                  {crews.length > 1 && (
                    <button
                      onClick={() => setCrews(prev => prev.filter(c => c.id !== crew.id))}
                      className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-300 hover:text-red-400 text-lg leading-none"
                    >×</button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
            <button
              onClick={() => { onSave({ workDays: crewDaysOfWeek(workDays), crews }); onClose() }}
              className="btn btn-primary flex-1"
            >Save settings</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Schedule Page ───────────────────────────────────────────────────────

/** Which job an entry belongs to: its job, else (an entry made by hand) its client's name. */
/** The name on a month card: in full (two lines at most); a long one as "D. King". */
function cardName(name: string): string {
  const n = (name || '').trim()
  if (n.length <= 22) return n
  const w = n.split(/\s+/)
  return w.length > 1 ? `${w[0][0]}. ${w.slice(1).join(' ')}` : n
}

const jobKeyOf = (j: ScheduledJob) => (j.stagingJobId ? `job:${j.stagingJobId}` : `name:${j.clientName.trim().toLowerCase()}`)

export default function SchedulePage() {
  const [data, setData] = useState(() => loadSchedule())
  const readOnly = !can('schedule.change')
  // Another device's schedule changes were merged into a save from this tab.
  useMergedRefresh('Schedule', () => setData(loadSchedule()))
  // The board read again (an install scheduled here or elsewhere, a rain day).
  useEffect(() => {
    const on = () => setData(loadSchedule())
    window.addEventListener(SCHEDULE_UPDATED_EVENT, on)
    window.addEventListener(RAIN_LOG_UPDATED_EVENT, on)
    return () => { window.removeEventListener(SCHEDULE_UPDATED_EVENT, on); window.removeEventListener(RAIN_LOG_UPDATED_EVENT, on) }
  }, [])
  const [showSettings, setShowSettings] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => new Date())
  const [dragJob, setDragJob] = useState<ScheduledJob | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const [showRainLog, setShowRainLog] = useState(false)
  const [forecast, setForecast] = useState<WeatherDay[]>([])
  const ready = useReadyJobs()
  // Phone: the calendar and Ready to schedule are two tabs. Computer: side by side.
  const [tab, setTab] = useState<'calendar' | 'ready'>('calendar')
  // Days off (Friday to Sunday by default) are left out of the month unless asked for.
  const [showDaysOff, setShowDaysOff] = useState(false)
  const [booking, setBooking] = useState<{ jobId: string; start?: string } | null>(null)
  const [moving, setMoving] = useState<{ jobId: string; name: string; from: string; to: string } | null>(null)
  const [rainDay, setRainDay] = useState<string | null>(null)

  // Load weather forecast
  useEffect(() => { fetchForecast().then(setForecast) }, [])

  const { jobs, settings } = data
  const rainLog = loadRainLog()
  const crewWeek = crewDaysOfWeek(settings.workDays)
  // Jobs booked "weekends too" (on purpose): their weekend days are not a warning.
  const [weekendJobs, setWeekendJobs] = useState<Set<string>>(new Set())
  useEffect(() => { fetchWeekendJobs().then(r => { if (r.ok) setWeekendJobs(new Set(r.data)) }) }, [data])
  const monthKey = `${viewMonth.getFullYear()}-${String(viewMonth.getMonth() + 1).padStart(2, '0')}`
  // A day off is shown when an install is booked on it this month (never hidden), else only with "Show days off".
  const offWithJobs = [...new Set(jobs.filter(j => j.date && j.date.slice(0, 7) === monthKey && !isCrewDay(j.date, crewWeek)).map(j => new Date(`${j.date}T12:00:00Z`).getUTCDay()))]
  const shownWeek = showDaysOff ? [1, 2, 3, 4, 5, 6, 0] : [1, 2, 3, 4, 5, 6, 0].filter(d => crewWeek.includes(d) || offWithJobs.includes(d))

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const weeks = getMonthWeeks(year, month, shownWeek)
  const monthName = viewMonth.toLocaleString('default', { month: 'long', year: 'numeric' })

  // Each job's booked days, in order: "Day 2 of 3" on its card, and a drag of any day moves the whole job.
  const daysOfJob = new Map<string, ScheduledJob[]>()
  for (const j of jobs) { if (!j.date) continue; const k = jobKeyOf(j); daysOfJob.set(k, [...(daysOfJob.get(k) ?? []), j]) }
  for (const list of daysOfJob.values()) list.sort((a, b) => a.date.localeCompare(b.date))

  function updateData(jobs: ScheduledJob[], s?: ScheduleSettings) {
    // A salesman or the crew sees the schedule; only the office and up change it (the server refuses anyone else).
    if (readOnly) { toast.error('Not saved', REFUSAL['schedule.change']); return }
    const updated = { jobs, settings: s ?? settings }
    saveSchedule(updated.jobs, updated.settings)
    setData(updated)
  }

  /** A drop on a day: a Ready card opens Schedule install on that day; a booked install asks to move. */
  function handleDrop(e: React.DragEvent, dateStr: string) {
    if (readOnly) { toast.error('Not saved', REFUSAL['schedule.change']); return }
    const readyId = e.dataTransfer.getData(READY_DRAG_TYPE)
    if (readyId) { setBooking({ jobId: readyId, start: dateStr }); return }
    const dragged = dragJob
    setDragJob(null)
    if (!dragged || dragged.date === dateStr) return
    if (dragged.stagingJobId) {
      // The whole job moves: dropping its second day on Thursday makes Wednesday its first.
      const own = daysOfJob.get(jobKeyOf(dragged)) ?? [dragged]
      const at = Math.max(0, own.findIndex(x => x.id === dragged.id))
      const week = own.some(x => !isCrewDay(x.date, crewWeek)) ? [0, 1, 2, 3, 4, 5, 6] : crewWeek
      let start = dateStr
      for (let left = at; left > 0;) { start = plusDays(start, -1); if (isCrewDay(start, week)) left-- }
      if (start === own[0].date) return
      setMoving({ jobId: dragged.stagingJobId, name: dragged.clientName, from: own[0].date, to: start })
      return
    }
    // An entry made by hand (no job behind it): just its day.
    updateData(jobs.map(j => j.id === dragged.id ? { ...j, date: dateStr } : j))
  }

  function removeJob(id: string) {
    updateData(jobs.filter(j => j.id !== id))
  }

  /** Looking at a later month: a tapped job starts on its first crew day; this month: the next crew day. */
  function startInView(): string | undefined {
    const today = businessDate(new Date())
    const first = `${monthKey}-01`
    return first > today ? nextCrewDay(first, crewWeek) : undefined
  }

  function prevMonth() { setViewMonth(new Date(year, month - 1, 1)) }
  function nextMonth() { setViewMonth(new Date(year, month + 1, 1)) }

  const readyCount = ready.jobs?.length
  // One crew with two installs (different jobs) on a day.
  const clashes = sameCrewClashes(jobs.filter(j => j.date && j.status !== 'Complete' && j.status !== 'Rolled Over').map(j => ({ id: j.id, jobKey: jobKeyOf(j), clientName: j.clientName, crewId: j.crewId, date: j.date })))
  const clashIds = new Set(clashes.flatMap(c => c.ids))

  return (
    <div className="space-y-4">
      {/* Phone: two tabs. */}
      <div className="lg:hidden grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1" role="tablist" data-schedule-tabs>
        <button type="button" role="tab" aria-selected={tab === 'calendar'} onClick={() => setTab('calendar')} data-schedule-tab="calendar"
          className={`min-h-[44px] rounded-lg text-sm font-semibold ${tab === 'calendar' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}>Calendar</button>
        <button type="button" role="tab" aria-selected={tab === 'ready'} onClick={() => setTab('ready')} data-schedule-tab="ready"
          className={`min-h-[44px] rounded-lg text-sm font-semibold ${tab === 'ready' ? 'bg-white shadow text-gray-900' : 'text-gray-600'}`}>
          Ready to schedule{readyCount !== undefined ? ` (${readyCount})` : ''}
        </button>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_290px] xl:grid-cols-[minmax(0,1fr)_330px] lg:gap-4 lg:items-start">
        <div className={`space-y-6 min-w-0 ${tab === 'ready' ? 'hidden lg:block' : ''}`}>
          {/* One day at a time: installs and that day's appointments (the phone's Schedule tab lands here). */}
          <ScheduleDay jobs={jobs} crews={settings.crews} />
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={prevMonth} className="btn btn-secondary" aria-label="Month before" data-month-prev>&larr;</button>
              <h2 className="text-lg font-bold text-gray-900 flex-1 lg:w-48 text-center" data-month={`${year}-${String(month + 1).padStart(2, '0')}`}>{monthName}</h2>
              <button onClick={nextMonth} className="btn btn-secondary" aria-label="Next month" data-month-next>&rarr;</button>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <div className="flex gap-1.5 items-center flex-wrap mr-2 lg:mr-4">
                {settings.crews.map(c => (
                  <div key={c.id} className="flex items-center gap-1.5">
                    <div className={`w-3 h-3 rounded-full ${c.color}`} />
                    <span className="text-xs text-gray-500">{c.name}</span>
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-700 min-h-[44px]">
                <input type="checkbox" checked={showDaysOff} onChange={e => setShowDaysOff(e.target.checked)} className="w-4 h-4 accent-orange-500" data-show-days-off />
                Show days off
              </label>
              {!readOnly && <button onClick={() => setRainDay('')} className="btn btn-secondary" data-rain-day-open>🌧 Rain day</button>}
              {can('settings.change') && <button onClick={() => setShowSettings(true)} className="btn btn-secondary" data-schedule-settings>Settings</button>}
              {readOnly && <span className="text-xs text-gray-500" data-view-only>View only</span>}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
            {/* Fixed columns: the work days always fit the width, whatever is on them (cards cut their words short). */}
            <table className="w-full table-fixed text-sm calendar-table" data-month-days={shownWeek.join(',')}>
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  {shownWeek.map(d => (
                    <th key={d} className={`text-left px-2 lg:px-4 py-3 text-xs font-semibold ${crewWeek.includes(d) ? 'text-gray-500' : 'text-gray-400'}`}>
                      <span className="hidden lg:inline">{DAY_FULL[d]}</span><span className="lg:hidden">{DAY_NAMES[d]}</span>
                      {!crewWeek.includes(d) && <span className="block font-normal">day off</span>}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, wi) => (
                  <tr key={wi} className="border-b border-gray-100">
                    {week.map(day => {
                      const dateStr = toDateStr(day)
                      const isThisMonth = day.getMonth() === month
                      const dayOff = !crewWeek.includes(day.getDay())
                      const dayJobs = jobs.filter(j => j.date === dateStr)
                      return (
                        <td
                          key={dateStr}
                          data-day={dateStr}
                          className={`align-top px-1.5 lg:px-3 py-2 border-r border-gray-100 transition-colors ${
                            dragOverDate === dateStr
                              ? (dayJobs.length >= 3 ? 'bg-red-50 border-2 border-red-300' : 'bg-orange-50 border-2 border-orange-400')
                              : (dayOff ? 'bg-gray-100' : isThisMonth ? '' : 'bg-gray-50')
                          }`}
                          style={{ minHeight: 80, width: `${100 / shownWeek.length}%` }}
                          onDragOver={e => { e.preventDefault(); setDragOverDate(dateStr) }}
                          onDragEnter={e => { e.preventDefault(); setDragOverDate(dateStr) }}
                          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDate(null) }}
                          onDrop={e => { e.preventDefault(); setDragOverDate(null); handleDrop(e, dateStr) }}
                        >
                          {dragOverDate === dateStr && (
                            <div className={`text-center text-xs font-medium mb-1 ${dayJobs.length >= 3 ? 'text-red-500' : 'text-orange-500'}`}>
                              {dayJobs.length >= 3 ? '⚠ Full day' : '↓ Drop here'}
                            </div>
                          )}
                          <div className="flex items-center justify-between mb-1 min-w-0">
                            <p className={`text-xs font-medium ${isThisMonth ? 'text-gray-900' : 'text-gray-400'}`}>
                              {day.getDate()}
                            </p>
                            {holidayOn(dateStr) && <span className="text-[10px] font-semibold text-red-700 truncate ml-1" title={holidayOn(dateStr)!} data-holiday={dateStr}>{holidayOn(dateStr)}</span>}
                            {(() => {
                              const wx = forecast.find(f => f.date === dateStr)
                              if (!wx) return null
                              return (
                                <span title={wx.description} className={`text-xs ${wx.rain ? 'text-blue-500 font-semibold' : 'text-gray-400'}`}>
                                  {wx.rain ? '🌧' : '☀'} {wx.temp}°
                                </span>
                              )
                            })()}
                          </div>
                          {/* One crew with two installs this day: said on the day, and both cards edged red. */}
                          {clashes.filter(c => c.date === dateStr).map(c => (
                            <p key={c.crewId} className="mb-1 text-[11px] font-semibold text-white bg-red-600 rounded px-1.5 py-0.5 leading-tight" data-day-clash={`${dateStr}|${c.crewId}`} title={namesWords(c.names)}>
                              {c.names.length} jobs on {settings.crews.find(x => x.id === c.crewId)?.name ?? c.crewId}
                            </p>
                          ))}
                          <div className="space-y-1">
                            {dayJobs.map(j => {
                              const crew = settings.crews.find(c => c.id === j.crewId)
                              // The crew's color down the left edge; the card itself light, so the words read.
                              const crewColor = crew ? crewHex(crew.color, crew.name) : '#9ca3af'
                              const own = daysOfJob.get(jobKeyOf(j)) ?? [j]
                              const nth = own.findIndex(x => x.id === j.id) + 1
                              // Booked on a day that is not a crew day any more (Friday switched off), and not a "weekends too" job.
                              const offDay = !isCrewDay(dateStr, crewWeek) && !(j.stagingJobId && weekendJobs.has(j.stagingJobId))
                              return (
                                <div
                                  key={j.id}
                                  draggable={!readOnly}
                                  onDragStart={() => setDragJob(j)}
                                  onClick={() => { if (j.stagingJobId) setBooking({ jobId: j.stagingJobId }) }}
                                  data-install-entry={j.stagingJobId || j.id}
                                  data-install-day={`${nth}/${own.length}`}
                                  data-install-offday={offDay ? 'yes' : undefined}
                                  data-install-clash={clashIds.has(j.id) ? 'yes' : undefined}
                                  // Everything on hover; a tap opens the job (Move install).
                                  title={[j.clientName, j.area, styleLabel(j.fenceType), j.sections ? `${j.sections} sections` : '', own.length > 1 ? `day ${nth} of ${own.length}` : '', crew?.name].filter(Boolean).join('\n')}
                                  style={{ borderLeftColor: clashIds.has(j.id) ? '#dc2626' : crewColor, backgroundColor: `${crewColor}1f` }}
                                  className={`border-l-4 rounded px-1.5 py-1 ${clashIds.has(j.id) ? 'ring-2 ring-red-500' : ''} ${readOnly ? '' : 'cursor-grab'} ${j.stagingJobId ? 'cursor-pointer' : ''} group`}
                                >
                                  {/* The day of the job first, always readable; the hover buttons beside it. */}
                                  <div className="flex items-center justify-between gap-1 min-h-[16px]">
                                    {own.length > 1
                                      ? <span className="text-[10px] font-bold text-gray-800 bg-white/80 border border-gray-300 rounded px-1 leading-tight whitespace-nowrap" data-install-daybadge>{nth}/{own.length}</span>
                                      : <span />}
                                    {!readOnly && <span className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition">
                                      <button onClick={e => { e.stopPropagation(); setRainDay(j.date) }} title="Rain day from this day" aria-label="Rain day from this day" className="text-gray-400 hover:text-blue-500 text-xs leading-none">🌧</button>
                                      {!j.stagingJobId && <button onClick={e => { e.stopPropagation(); removeJob(j.id) }} aria-label="Remove" className="text-gray-400 hover:text-red-400 text-xs leading-none ml-0.5">&times;</button>}
                                    </span>}
                                  </div>
                                  <p className="text-xs font-semibold text-gray-900 leading-tight break-words line-clamp-2" data-install-name>
                                    {j.status === 'Rain Day' && <span title="Rain Day">🌧 </span>}
                                    {cardName(j.clientName)}
                                  </p>
                                  {j.sections > 0 && <p className="text-[11px] text-gray-600 leading-tight">{j.sections} sec</p>}
                                  {offDay && <p className="text-[11px] font-semibold text-red-700 leading-tight" data-offday-warning>{DAY_FULL[day.getDay()]} is not a work day any more. Move this day?</p>}
                                </div>
                              )
                            })}
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Weather Forecast Strip */}
          {forecast.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">5-Day Forecast</h3>
              <div className="flex gap-3">
                {forecast.slice(0, 5).map(wx => (
                  <div key={wx.date} className={`flex-1 rounded-xl p-3 text-center ${wx.rain ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'}`}>
                    <p className="text-xs font-medium text-gray-500">{new Date(wx.date + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</p>
                    <p className="text-2xl my-1">{wx.rain ? '🌧' : wx.description.includes('cloud') ? '⛅' : '☀️'}</p>
                    <p className="text-sm font-bold text-gray-900">{wx.temp}°F</p>
                    <p className="text-xs text-gray-500 capitalize">{wx.description}</p>
                    {wx.rain && <p className="text-xs font-semibold text-blue-600 mt-1">Rain Expected</p>}
                  </div>
                ))}
              </div>
              {!OWM_KEY && <p className="text-xs text-gray-400 mt-2">Set VITE_OPENWEATHER_API_KEY for live weather data</p>}
            </div>
          )}

          {/* Rain Day Log */}
          <div className="bg-white rounded-2xl border border-gray-200">
            <button onClick={() => setShowRainLog(!showRainLog)} className="w-full px-5 py-3 flex items-center justify-between hover:bg-gray-50 transition">
              <h3 className="text-sm font-semibold text-gray-700">🌧 Rain Day Log ({rainLog.length})</h3>
              <span className="text-xs text-gray-400">{showRainLog ? '▲ Hide' : '▼ Show'}</span>
            </button>
            {showRainLog && (
              <div className="border-t border-gray-100">
                {rainLog.length === 0 ? (
                  <p className="text-sm text-gray-400 text-center py-6">No rain days logged yet</p>
                ) : (
                  <div className="divide-y divide-gray-50">
                    {rainLog.map(entry => (
                      <div key={entry.id} className="px-5 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{entry.clientName}</p>
                          <p className="text-xs text-gray-500">
                            Original: {entry.originalDate} • Reason: {entry.reason}
                            {entry.rescheduleDate ? ` • Rescheduled: ${entry.rescheduleDate}` : ' • TBD'}
                          </p>
                        </div>
                        <span className="text-xs text-gray-400">{new Date(entry.flaggedAt).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Ready to schedule: a side panel on a computer, its own tab on a phone. */}
        <aside className={`lg:sticky lg:top-4 ${tab === 'calendar' ? 'hidden lg:block' : ''}`}>
          <ReadyPanel ready={ready} canDrag={!readOnly} onPick={j => { if (readOnly) { toast.error('Not saved', REFUSAL['schedule.change']); return } setBooking({ jobId: j.id, start: startInView() }) }} />
        </aside>
      </div>

      {booking && <ScheduleInstallDialog jobId={booking.jobId} start={booking.start} onClose={() => setBooking(null)} onDone={() => ready.reload()} />}
      {moving && <MoveInstallConfirm {...moving} onClose={() => setMoving(null)} />}
      {rainDay !== null && <RainDayDialog date={rainDay || undefined} onClose={() => setRainDay(null)} />}

      {showSettings && (
        <SettingsModal
          settings={settings}
          onSave={s => updateData(jobs, s)}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}
