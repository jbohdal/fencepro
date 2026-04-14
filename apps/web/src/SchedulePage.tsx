import { useState, useRef } from 'react'

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

function loadSchedule(): { jobs: ScheduledJob[], settings: ScheduleSettings } {
  try {
    const raw = localStorage.getItem('fencepro_schedule')
    return raw ? JSON.parse(raw) : { jobs: [], settings: DEFAULT_SETTINGS }
  } catch { return { jobs: [], settings: DEFAULT_SETTINGS } }
}

function saveSchedule(jobs: ScheduledJob[], settings: ScheduleSettings) {
  localStorage.setItem('fencepro_schedule', JSON.stringify({ jobs, settings }))
}

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
      <div className="bg-white rounded-2xl shadow-2xl w-[480px] max-h-[90vh] overflow-y-auto">
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

  const unscheduled = stagingJobs.filter(
    (s: any) => !jobs.some(j => j.stagingJobId === s.id)
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={prevMonth} className="border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">&larr;</button>
          <h2 className="text-lg font-bold text-gray-900 w-48 text-center">{monthName}</h2>
          <button onClick={nextMonth} className="border border-gray-200 rounded-lg px-3 py-2 text-sm hover:bg-gray-50">&rarr;</button>
        </div>
        <div className="flex gap-2">
          <div className="flex gap-1.5 items-center mr-4">
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

      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
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
                      className={`align-top px-3 py-2 border-r border-gray-100 ${isThisMonth ? '' : 'bg-gray-50'}`}
                      style={{ minHeight: 80, width: `${100 / settings.workDays.length}%` }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        e.preventDefault()
                        const crewId = settings.crews[0]?.id || 'crew1'
                        const stagingData = e.dataTransfer.getData('staging')
                        if (stagingData) {
                          addFromStaging(JSON.parse(stagingData), dateStr, crewId)
                        } else {
                          handleDrop(dateStr, crewId)
                        }
                      }}
                    >
                      <p className={`text-xs font-medium mb-1 ${isThisMonth ? 'text-gray-900' : 'text-gray-400'}`}>
                        {day.getDate()}
                      </p>
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
                                  <p className="text-xs font-semibold text-gray-900 truncate">{j.clientName}</p>
                                  <p className="text-xs text-gray-500">{j.fenceType} &middot; {j.sections}sec &middot; {fmt(j.jobPrice)}</p>
                                </div>
                                <button onClick={() => removeJob(j.id)} className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 text-sm leading-none ml-1">&times;</button>
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
          <h3 className="font-semibold text-gray-900 mb-3">Unscheduled Jobs</h3>
          <p className="text-xs text-gray-400 mb-3">Drag onto the calendar to schedule</p>
          <div className="grid grid-cols-3 gap-2">
            {unscheduled.map((s: any) => (
              <div
                key={s.id}
                draggable
                onDragStart={e => e.dataTransfer.setData('staging', JSON.stringify(s))}
                className="border border-gray-200 rounded-xl p-3 cursor-grab hover:border-orange-300 transition-colors"
              >
                <p className="text-sm font-semibold text-gray-900">{s.clientName || s.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{s.fenceType || s.type} &middot; {s.sections || 0} sec</p>
                <p className="text-xs font-semibold text-gray-700 mt-1">{fmt(s.jobPrice || s.price || 0)}</p>
              </div>
            ))}
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