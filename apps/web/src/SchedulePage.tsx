import { useState, useRef, useEffect } from 'react'
import { fireRainDayFlagged } from './automationTrigger'
import {
  loadSchedule as storeLoadSchedule,
  saveSchedule as storeSaveSchedule,
  loadRainLog as storeLoadRainLog,
  saveRainLog as storeSaveRainLog,
} from './scheduleStore'

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
const saveRainLog = (log: RainDayEntry[]) => storeSaveRainLog(log)

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

function loadStagingJobs() {
  try {
    const raw = localStorage.getItem('fencepro_staging')
    return raw ? JSON.parse(raw) : []
  } catch { return [] }
}

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
  const [workDays, setWorkDays] = useState<number[]>([...settings.workDays])
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
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-6 py-5 space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Work Days</h3>
            <div className="flex gap-2">
              {[1,2,3,4,5,6,0].map(d => (
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
            <p className="text-xs text-gray-400 mt-2">{workDays.length} days selected</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Crews</h3>
              <button onClick={addCrew} className="text-xs text-orange-500 hover:underline">+ Add Crew</button>
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
                      className="text-gray-300 hover:text-red-400 text-lg leading-none"
                    >×</button>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50">Cancel</button>
            <button
              onClick={() => { onSave({ workDays, crews }); onClose() }}
              className="flex-1 bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold py-2.5 rounded-xl"
            >Save Settings</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Schedule Page ───────────────────────────────────────────────────────

export default function SchedulePage() {
  const [data, setData] = useState(() => loadSchedule())
  const [showSettings, setShowSettings] = useState(false)
  const [viewMonth, setViewMonth] = useState(() => new Date())
  const [dragJob, setDragJob] = useState<ScheduledJob | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const [rainDayJob, setRainDayJob] = useState<ScheduledJob | null>(null)
  const [rainReason, setRainReason] = useState('Weather — rain')
  const [rainReschedule, setRainReschedule] = useState('')
  const [showRainLog, setShowRainLog] = useState(false)
  const [rainLog, setRainLog] = useState<RainDayEntry[]>(() => loadRainLog())
  const [forecast, setForecast] = useState<WeatherDay[]>([])

  // Load weather forecast
  useEffect(() => { fetchForecast().then(setForecast) }, [])

  const { jobs, settings } = data
  const stagingJobs = loadStagingJobs()

  const year = viewMonth.getFullYear()
  const month = viewMonth.getMonth()
  const weeks = getMonthWeeks(year, month, settings.workDays)
  const monthName = viewMonth.toLocaleString('default', { month: 'long', year: 'numeric' })

  function updateData(jobs: ScheduledJob[], s?: ScheduleSettings) {
    const updated = { jobs, settings: s ?? settings }
    saveSchedule(updated.jobs, updated.settings)
    setData(updated)
  }

  function handleDrop(dateStr: string, crewId: string) {
    if (!dragJob) return
    const updated = jobs.map(j => j.id === dragJob.id ? { ...j, date: dateStr, crewId } : j)
    updateData(updated)
    setDragJob(null)
  }

  function addFromStaging(staging: any, dateStr: string, crewId: string) {
    const newJob: ScheduledJob = {
      id: uid(),
      clientName: staging.clientName || staging.name || 'Unknown',
      area: staging.area || '',
      sections: staging.sections || 0,
      fenceType: staging.fenceType || staging.type || '',
      jobPrice: staging.jobPrice || staging.price || 0,
      tearout: staging.tearout || false,
      crewId,
      date: dateStr,
      notes: staging.notes || '',
      stagingJobId: staging.id,
      status: 'Scheduled',
    }
    updateData([...jobs, newJob])
  }

  function removeJob(id: string) {
    updateData(jobs.filter(j => j.id !== id))
  }

  function prevMonth() { setViewMonth(new Date(year, month - 1, 1)) }
  function nextMonth() { setViewMonth(new Date(year, month + 1, 1)) }

  // ── Cascading reschedule state ──
  const [showCascade, setShowCascade] = useState(false)
  const [cascadeShiftDays, setCascadeShiftDays] = useState(1)
  const [cascadeSelections, setCascadeSelections] = useState<Set<string>>(new Set())

  // Find next available workday from a date, skipping non-work days
  function nextWorkday(from: string, daysToShift: number): string {
    let d = new Date(from + 'T12:00:00')
    let shifted = 0
    while (shifted < daysToShift) {
      d.setDate(d.getDate() + 1)
      if (settings.workDays.includes(d.getDay())) shifted++
    }
    return toDateStr(d)
  }

  // Get all jobs affected by a rain day on a specific date (same date + downstream)
  function getAffectedJobs(): { job: ScheduledJob; newDate: string }[] {
    if (!rainDayJob) return []
    const rainDate = rainDayJob.date
    // All jobs on or after the rain date that are scheduled
    const affected = jobs
      .filter(j => j.date >= rainDate && j.id !== rainDayJob.id && (j.status === 'Scheduled' || j.status === 'In Progress'))
      .sort((a, b) => a.date.localeCompare(b.date))
    return affected.map(j => ({
      job: j,
      newDate: nextWorkday(j.date, cascadeShiftDays),
    }))
  }

  function flagRainDay() {
    if (!rainDayJob) return
    const entry: RainDayEntry = {
      id: uid(),
      jobId: rainDayJob.id,
      clientName: rainDayJob.clientName,
      originalDate: rainDayJob.date,
      rescheduleDate: rainReschedule,
      reason: rainReason,
      flaggedAt: new Date().toISOString(),
    }
    const newLog = [entry, ...rainLog]
    setRainLog(newLog)
    saveRainLog(newLog)

    // Update the rained-out job
    let updated = jobs.map(j => {
      if (j.id !== rainDayJob.id) return j
      return {
        ...j,
        status: (rainReschedule ? 'Scheduled' : 'Rain Day') as ScheduledJob['status'],
        ...(rainReschedule ? { date: rainReschedule } : {}),
      }
    })

    // Apply cascade selections
    if (showCascade && cascadeSelections.size > 0) {
      const affected = getAffectedJobs()
      for (const { job, newDate } of affected) {
        if (!cascadeSelections.has(job.id)) continue
        // Log each cascaded job
        const cascadeEntry: RainDayEntry = {
          id: uid(),
          jobId: job.id,
          clientName: job.clientName,
          originalDate: job.date,
          rescheduleDate: newDate,
          reason: `Cascaded from ${rainDayJob.clientName} rain day`,
          flaggedAt: new Date().toISOString(),
        }
        newLog.push(cascadeEntry)

        updated = updated.map(j => j.id === job.id ? { ...j, date: newDate } : j)
      }
      saveRainLog(newLog)
      setRainLog(newLog)
    }

    updateData(updated)

    // Fire automation
    fireRainDayFlagged(rainDayJob.id, {
      jobName: rainDayJob.clientName,
      scheduledDate: rainDayJob.date,
      extraData: {
        reason: rainReason,
        rescheduleDate: rainReschedule,
        cascadedJobs: showCascade ? cascadeSelections.size : 0,
      },
    })

    setRainDayJob(null)
    setRainReason('Weather — rain')
    setRainReschedule('')
    setShowCascade(false)
    setCascadeSelections(new Set())
  }

  const unscheduled = stagingJobs.filter(
    (s: any) => !jobs.some(j => j.stagingJobId === s.id)
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">&larr;</button>
          <h2 className="text-lg font-bold text-gray-900 flex-1 lg:w-48 text-center">{monthName}</h2>
          <button onClick={nextMonth} className="border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">&rarr;</button>
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="flex gap-1.5 items-center flex-wrap mr-2 lg:mr-4">
            {settings.crews.map(c => (
              <div key={c.id} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded-full ${c.color}`} />
                <span className="text-xs text-gray-500">{c.name}</span>
              </div>
            ))}
          </div>
          <button onClick={() => setShowSettings(true)} className="border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50">Settings</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden overflow-x-auto">
        <table className="w-full text-sm calendar-table">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {settings.workDays.map(d => (
                <th key={d} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {DAY_FULL[d]}
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
                  const dayJobs = jobs.filter(j => j.date === dateStr)
                  return (
                    <td
                      key={dateStr}
                      className={`align-top px-3 py-2 border-r border-gray-100 transition-colors ${
                        dragOverDate === dateStr
                          ? (dayJobs.length >= 3 ? 'bg-red-50 border-2 border-red-300' : 'bg-orange-50 border-2 border-orange-400')
                          : (isThisMonth ? '' : 'bg-gray-50')
                      }`}
                      style={{ minHeight: 80, width: `${100 / settings.workDays.length}%` }}
                      onDragOver={e => { e.preventDefault(); setDragOverDate(dateStr) }}
                      onDragEnter={e => { e.preventDefault(); setDragOverDate(dateStr) }}
                      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverDate(null) }}
                      onDrop={e => {
                        e.preventDefault()
                        setDragOverDate(null)
                        const crewId = settings.crews[0]?.id || 'crew1'
                        const stagingData = e.dataTransfer.getData('staging')
                        if (stagingData) {
                          addFromStaging(JSON.parse(stagingData), dateStr, crewId)
                        } else {
                          handleDrop(dateStr, crewId)
                        }
                      }}
                    >
                      {dragOverDate === dateStr && (
                        <div className={`text-center text-xs font-medium mb-1 ${dayJobs.length >= 3 ? 'text-red-500' : 'text-orange-500'}`}>
                          {dayJobs.length >= 3 ? '⚠ Full day' : '↓ Drop here'}
                        </div>
                      )}
                      <div className="flex items-center justify-between mb-1">
                        <p className={`text-xs font-medium ${isThisMonth ? 'text-gray-900' : 'text-gray-400'}`}>
                          {day.getDate()}
                        </p>
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
                      <div className="space-y-1">
                        {dayJobs.map(j => {
                          const crew = settings.crews.find(c => c.id === j.crewId)
                          const colorClass = crew?.color ?? 'bg-gray-400'
                          return (
                            <div
                              key={j.id}
                              draggable
                              onDragStart={() => setDragJob(j)}
                              className={`${colorClass} bg-opacity-15 border-l-[3px] ${colorClass.replace('bg-', 'border-')} rounded px-2 py-1 cursor-grab group`}
                            >
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="text-xs font-semibold text-gray-900 truncate">
                                    {j.status === 'Rain Day' && <span title="Rain Day">🌧 </span>}
                                    {j.clientName}
                                  </p>
                                  <p className="text-xs text-gray-500">{j.fenceType} &middot; {j.sections}sec &middot; {fmt(j.jobPrice)}</p>
                                </div>
                                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                                  <button onClick={() => { setRainDayJob(j); setRainReschedule('') }} title="Flag Rain Day" className="text-gray-300 hover:text-blue-500 text-sm leading-none">🌧</button>
                                  <button onClick={() => removeJob(j.id)} className="text-gray-300 hover:text-red-400 text-sm leading-none ml-0.5">&times;</button>
                                </div>
                              </div>
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

      {unscheduled.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Unscheduled Jobs ({unscheduled.length})</h3>
            <p className="text-xs text-gray-400">Drag onto the calendar to schedule</p>
          </div>
          <div className="grid grid-cols-4 lg:grid-cols-6 gap-1.5">
            {unscheduled.map((s: any) => {
              const name = s.clientName || s.name || 'Unknown'
              const city = (s.area || s.address || '').split(',')[0] || ''
              const phone = s.phone || s.customerPhone || ''
              return (
                <div
                  key={s.id}
                  draggable
                  onDragStart={e => e.dataTransfer.setData('staging', JSON.stringify(s))}
                  className="border border-gray-200 rounded-lg px-2.5 py-2 cursor-grab hover:border-orange-400 hover:shadow-sm transition-all group relative"
                  title={`${name}\n${s.fenceType || s.type} · ${s.sections || 0} sections\n${city}\n${phone}\n${fmt(s.jobPrice || s.price || 0)}`}
                >
                  <p className="text-xs font-semibold text-gray-900 truncate">{name}</p>
                  <p className="text-[10px] text-gray-500 truncate">{city || s.fenceType || s.type}</p>
                  {phone && <p className="text-[10px] text-gray-400 truncate">{phone}</p>}
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="text-[10px] font-medium text-gray-700">{fmt(s.jobPrice || s.price || 0)}</span>
                    <span className="px-1 py-0.5 bg-blue-100 text-blue-700 rounded text-[9px] font-medium">{s.status || 'Ready'}</span>
                  </div>
                  {/* Hover tooltip with full details */}
                  <div className="absolute left-0 bottom-full mb-1 z-40 bg-gray-900 text-white rounded-lg p-3 text-xs w-56 opacity-0 group-hover:opacity-100 pointer-events-none transition shadow-lg">
                    <p className="font-semibold">{name}</p>
                    <p className="text-gray-300">{s.fenceType || s.type} · {s.sections || 0} sections</p>
                    {city && <p className="text-gray-300">{city}</p>}
                    {phone && <p className="text-gray-300">{phone}</p>}
                    <p className="text-gray-300 mt-1">{fmt(s.jobPrice || s.price || 0)}</p>
                    {s.tearout && <p className="text-amber-400 mt-0.5">⚠ Has tear-out</p>}
                    {s.notes && <p className="text-gray-400 mt-1 truncate">{s.notes}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

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

      {/* Rain Day Modal with Cascade */}
      {rainDayJob && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] max-h-[85vh] overflow-y-auto p-4 lg:p-6 mx-4 lg:mx-0 space-y-4 modal-responsive">
            <h2 className="font-bold text-gray-900 text-lg">🌧 Flag Rain Day</h2>
            <p className="text-sm text-gray-500">
              <span className="font-medium text-gray-900">{rainDayJob.clientName}</span> — scheduled for {rainDayJob.date}
            </p>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Reason</label>
              <select value={rainReason} onChange={e => setRainReason(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option>Weather — rain</option>
                <option>Weather — storm</option>
                <option>Weather — extreme heat</option>
                <option>Weather — cold/freeze</option>
                <option>Ground conditions — too wet</option>
                <option>Other weather delay</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Reschedule to</label>
              <div className="flex gap-2">
                <input type="date" value={rainReschedule} onChange={e => setRainReschedule(e.target.value)}
                  className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                <button onClick={() => setRainReschedule('')}
                  className="text-xs text-gray-500 border border-gray-200 rounded-lg px-3 py-2 hover:bg-gray-50">
                  TBD
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">{rainReschedule ? `Will move to ${rainReschedule}` : 'No reschedule date — marked as TBD'}</p>
            </div>

            {/* Cascade Reschedule */}
            <div className="border-t border-gray-100 pt-4">
              <label className="flex items-center gap-2 text-sm font-medium text-gray-900 cursor-pointer">
                <input type="checkbox" checked={showCascade} onChange={e => {
                  setShowCascade(e.target.checked)
                  if (e.target.checked) {
                    const affected = getAffectedJobs()
                    setCascadeSelections(new Set(affected.map(a => a.job.id)))
                  }
                }} className="w-4 h-4 accent-orange-500" />
                Cascade Reschedule — shift other affected jobs
              </label>

              {showCascade && (() => {
                const affected = getAffectedJobs()
                return (
                  <div className="mt-3 space-y-3">
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-gray-500">Shift by:</label>
                      <input type="number" min={1} max={7} value={cascadeShiftDays} onChange={e => setCascadeShiftDays(Math.max(1, parseInt(e.target.value) || 1))}
                        className="w-16 border border-gray-200 rounded-lg px-2 py-1 text-sm text-center" />
                      <span className="text-xs text-gray-500">work day{cascadeShiftDays > 1 ? 's' : ''}</span>
                      <button onClick={() => setCascadeSelections(new Set(affected.map(a => a.job.id)))} className="text-xs text-orange-600 ml-auto">Select all</button>
                      <button onClick={() => setCascadeSelections(new Set())} className="text-xs text-gray-500">Clear</button>
                    </div>

                    {affected.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-2">No other jobs affected on or after this date.</p>
                    ) : (
                      <div className="border border-gray-200 rounded-xl overflow-hidden max-h-48 overflow-y-auto">
                        <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-100 grid grid-cols-12 text-xs font-medium text-gray-500">
                          <div className="col-span-1"></div><div className="col-span-4">Job</div><div className="col-span-3">Current</div><div className="col-span-1">→</div><div className="col-span-3">New Date</div>
                        </div>
                        {affected.map(({ job, newDate }) => (
                          <div key={job.id} className="px-3 py-2 border-b border-gray-50 grid grid-cols-12 items-center text-sm">
                            <div className="col-span-1">
                              <input type="checkbox" checked={cascadeSelections.has(job.id)}
                                onChange={e => {
                                  const s = new Set(cascadeSelections)
                                  e.target.checked ? s.add(job.id) : s.delete(job.id)
                                  setCascadeSelections(s)
                                }} className="w-3.5 h-3.5 accent-orange-500" />
                            </div>
                            <div className="col-span-4 truncate font-medium text-gray-900">{job.clientName}</div>
                            <div className="col-span-3 text-gray-500">{job.date}</div>
                            <div className="col-span-1 text-gray-400">→</div>
                            <div className="col-span-3 font-medium text-orange-600">{newDate}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-gray-400">{cascadeSelections.size} job{cascadeSelections.size !== 1 ? 's' : ''} will be moved</p>
                  </div>
                )
              })()}
            </div>

            <div className="flex gap-2 pt-2">
              <button onClick={() => { setRainDayJob(null); setShowCascade(false); setCascadeSelections(new Set()) }}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-xl hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={flagRainDay}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2.5 rounded-xl">
                Flag Rain Day{showCascade && cascadeSelections.size > 0 ? ` + Move ${cascadeSelections.size} Jobs` : ''}
              </button>
            </div>
          </div>
        </div>
      )}

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