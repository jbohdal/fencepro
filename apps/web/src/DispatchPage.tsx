import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import PhoneLink from './PhoneLink'
import { can } from './permissions'
import { styleLabel } from './fenceCatalog'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// Every map sits in its own layer, under the page's menus and dialogs (layers.css).
import './layers.css'
import { lookupPosition } from './appointmentsStore'
import { distanceMiles } from './geoUtils'
import {
  getJobs,
  updateJob,
  MATERIALS_STATUS_CONFIG,
  type Job,
} from './jobStore'
import { loadSchedule as storeLoadSchedule, SCHEDULE_UPDATED_EVENT } from './scheduleStore'
import { stageOf, stageInfo, useOpsStages } from './opsStagesStore'
import { dispatchCrews, findCrew, pinLook, pinElement, crewInitials, type DispatchCrew } from './dispatchPins'
import { scheduleInstall, type PreparedText } from './installScheduleApi'
import { InstallTextSheet } from './ScheduleInstall'
import { toast } from './toast'
import { crewDaysOfWeek, isCrewDay, plusDays } from '../../portal/src/server/lib/installDays'

/* ═══════════════════════════════════════════════
   DISPATCH COMMAND CENTER
   Map + Timeline + Context Sidebar
   ═══════════════════════════════════════════════ */

// ── Types ────────────────────────────────────────

type Crew = DispatchCrew

interface TimeBlock {
  job: Job
  startHour: number  // 7 = 7am
  durationHours: number
  driveMinutes?: number
}

type ViewMode = 'day' | 'week'

// ── Constants ────────────────────────────────────

const HOURS = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]
const HOUR_LABELS = HOURS.map(h => {
  if (h === 12) return '12 PM'
  return h > 12 ? `${h - 12} PM` : `${h} AM`
})

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

// The day as the office reads it here (local), not in UTC: after 8 pm the UTC date is already tomorrow.
const toDateStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** A job's crew days: its start to its end, crew working days only (a one day job: its start). */
function jobDays(j: Job, workDays: number[]): string[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(j.scheduledDate || '')) return []
  const end = j.scheduledEndDate && j.scheduledEndDate > j.scheduledDate ? j.scheduledEndDate : j.scheduledDate
  const week = crewDaysOfWeek(workDays)
  const out: string[] = []
  for (let d = j.scheduledDate, i = 0; d <= end && i < 90; d = plusDays(d, 1), i++) if (d === j.scheduledDate || isCrewDay(d, week)) out.push(d)
  return out
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d)
  result.setDate(result.getDate() + n)
  return result
}

/** Schedule's crews (Schedule > crews), plus crew names typed on jobs that are not in that list. */
function loadCrews(jobs: Job[]): Crew[] {
  const { settings } = storeLoadSchedule()
  return dispatchCrews((settings?.crews ?? []) as Array<{ id: string; name: string; color?: string; hexColor?: string }>, jobs.map(j => j.crewAssigned))
}

// ── Geocode helper ───────────────────────────────

const geocodeCache = new Map<string, { lat: number; lng: number } | null>()

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address) return null
  if (geocodeCache.has(address)) return geocodeCache.get(address) || null

  // The server's free lookup (US Census, kept on the Mac), the one appointments use.
  try {
    const p = await lookupPosition(address)
    if (p) {
      const coords = { lat: p.lat, lng: p.lng }
      geocodeCache.set(address, coords)
      return coords
    }
  } catch { /* ignore */ }
  geocodeCache.set(address, null)
  return null
}

// ═══ MAIN COMPONENT ══════════════════════════════

export default function DispatchPage() {
  // ?date=YYYY-MM-DD opens on that day (a link from a scheduled install); else today.
  const [currentDate, setCurrentDate] = useState(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(new URLSearchParams(window.location.search).get('date') || '')
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : new Date()
  })
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [jobs, setJobs] = useState<Job[]>(getJobs)
  // Schedule's crew list, kept current (a crew added or recolored on Schedule shows here).
  const [scheduleRev, setScheduleRev] = useState(0)
  useEffect(() => {
    const h = () => setScheduleRev(r => r + 1)
    window.addEventListener(SCHEDULE_UPDATED_EVENT, h)
    return () => window.removeEventListener(SCHEDULE_UPDATED_EVENT, h)
  }, [])
  const crews = useMemo(() => loadCrews(jobs), [jobs, scheduleRev])
  const workDays = useMemo(() => storeLoadSchedule().settings.workDays, [scheduleRev])
  // Settings > Operations Stages: the pins' colors, kept current.
  const opsStages = useOpsStages()
  const [legendOpen, setLegendOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia?.('(max-width: 767px)').matches)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [geocodedJobs, setGeocodedJobs] = useState<Map<string, { lat: number; lng: number }>>(new Map())
  const [dragJob, setDragJob] = useState<Job | null>(null)
  const [done, setDone] = useState<{ text: PreparedText; title: string; summary: string } | null>(null)

  // The map: OpenStreetMap tiles drawn by Leaflet, free and with no key (as on Appointments).
  const mapRef = useRef<L.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<Map<string, L.Marker>>(new Map())
  const routeLinesRef = useRef<L.Polyline[]>([])

  const selectedJob = useMemo(() => jobs.find(j => j.id === selectedJobId) || null, [jobs, selectedJobId])

  // ── Date navigation ────────────────────────────

  const dateStr = toDateStr(currentDate)
  const weekDates = useMemo(() => {
    const monday = new Date(currentDate)
    const day = monday.getDay()
    monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1))
    return Array.from({ length: 5 }, (_, i) => addDays(monday, i))
  }, [currentDate])

  // The same array until the day or view changes: the jobs, pins and lookups below key off it.
  const visibleDates = useMemo(() => (viewMode === 'day' ? [currentDate] : weekDates), [viewMode, currentDate, weekDates])

  // ── Load jobs ──────────────────────────────────

  useEffect(() => {
    // Jobs loaded or changed elsewhere (another screen, another device) show without a reload.
    const h = () => setJobs(getJobs())
    window.addEventListener('fencepro:jobs:updated', h)
    return () => window.removeEventListener('fencepro:jobs:updated', h)
  }, [])

  // Jobs for the current view (scheduled on visible dates + unassigned)
  const scheduledJobs = useMemo(() => {
    const dateStrs = new Set(visibleDates.map(toDateStr))
    // A job of several crew days shows on each of them.
    return jobs.filter(j => jobDays(j, workDays).some(d => dateStrs.has(d)))
  }, [jobs, visibleDates, workDays])

  const unassignedJobs = useMemo(
    () => jobs.filter(j =>
      (j.status === 'staging' || j.status === 'scheduled') &&
      (!j.scheduledDate || !j.crewAssigned)
    ),
    [jobs]
  )

  // ── Init the map ───────────────────────────────

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return
    const map = L.map(mapContainerRef.current, { zoomControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView([29.1872, -82.1401], 10)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map)
    mapRef.current = map
    setMapReady(true)
    const t = setTimeout(() => { if (mapRef.current === map) map.invalidateSize() }, 150)
    return () => { clearTimeout(t); map.stop(); map.off(); map.remove(); mapRef.current = null; markersRef.current.clear(); routeLinesRef.current = [] }
  }, [])

  // ── Geocode jobs ───────────────────────────────

  // Addresses already looked up (found or not): each is asked once per visit, not on every redraw.
  const triedRef = useRef(new Set<string>())
  useEffect(() => {
    const toGeocode = [...scheduledJobs, ...unassignedJobs].filter(
      j => j.customerAddress && !j.lat && !geocodedJobs.has(j.id) && !triedRef.current.has(j.id)
    )
    if (toGeocode.length === 0) return
    for (const j of toGeocode) triedRef.current.add(j.id)

    let cancelled = false
    async function run() {
      const newCoords = new Map(geocodedJobs)
      for (const job of toGeocode) {
        if (cancelled) return
        // Use existing lat/lng from job if available
        if (job.lat && job.lng) {
          newCoords.set(job.id, { lat: job.lat, lng: job.lng })
          continue
        }
        const coords = await geocodeAddress(job.customerAddress)
        if (coords) {
          newCoords.set(job.id, coords)
          // Persist back to job
          updateJob(job.id, { lat: coords.lat, lng: coords.lng })
        }
      }
      if (!cancelled && newCoords.size !== geocodedJobs.size) setGeocodedJobs(newCoords)
    }
    run()
    return () => { cancelled = true }
  }, [scheduledJobs, unassignedJobs])

  // Merge job.lat/lng with geocoded
  const getJobCoords = useCallback((job: Job): { lat: number; lng: number } | null => {
    if (job.lat && job.lng) return { lat: job.lat, lng: job.lng }
    return geocodedJobs.get(job.id) || null
  }, [geocodedJobs])

  // ── Render map markers ─────────────────────────

  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    const map = mapRef.current
    const existingMarkers = markersRef.current
    const allJobs = [...scheduledJobs, ...unassignedJobs]
    const activeIds = new Set(allJobs.map(j => j.id))

    // Remove stale markers
    existingMarkers.forEach((marker, id) => {
      if (!activeIds.has(id)) {
        marker.remove()
        existingMarkers.delete(id)
      }
    })

    // Add/update markers
    const bounds = L.latLngBounds([])
    let hasMarkers = false

    for (const job of allJobs) {
      const coords = getJobCoords(job)
      if (!coords) continue

      hasMarkers = true
      bounds.extend([coords.lat, coords.lng])

      const isSelected = job.id === selectedJobId
      const stage = stageInfo(stageOf(job))
      const crew = findCrew(crews, job.crewAssigned)
      const look = pinLook(stage?.color ?? '#9CA3AF', crew, job.customerName)
      const html = pinElement(look, isSelected, {
        'dispatch-pin': job.id, stage: stage?.id ?? '', crew: crew?.id ?? '', label: look.label, fill: look.fill, ring: look.ring,
      })
      const icon = L.divIcon({ className: '', html, iconSize: [34, 44], iconAnchor: [17, 44] })
      const existing = existingMarkers.get(job.id)
      if (existing) {
        existing.setLatLng([coords.lat, coords.lng])
        existing.setIcon(icon)
      } else {
        const marker = L.marker([coords.lat, coords.lng], { icon, title: `${job.customerName} — ${styleLabel(job.fenceStyle)}` }).addTo(map)
        marker.on('click', () => setSelectedJobId(job.id))
        existingMarkers.set(job.id, marker)
      }
    }

    if (hasMarkers) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 })
  }, [mapReady, scheduledJobs, unassignedJobs, selectedJobId, getJobCoords, crews, opsStages])

  // ── Pan to selected job ────────────────────────

  useEffect(() => {
    if (!selectedJob || !mapRef.current) return
    const coords = getJobCoords(selectedJob)
    if (coords) {
      mapRef.current.setView([coords.lat, coords.lng], Math.max(mapRef.current.getZoom(), 13))
    }
  }, [selectedJobId])

  // ── Draw route lines per crew ──────────────────

  useEffect(() => {
    // Clean old lines
    routeLinesRef.current.forEach(l => l.remove())
    routeLinesRef.current = []

    if (!mapReady || !mapRef.current) return

    for (const crew of crews) {
      const crewJobs = scheduledJobs
        .filter(j => findCrew(crews, j.crewAssigned)?.id === crew.id)
        .sort((a, b) => (a.scheduledDate + (a.notes || '')).localeCompare(b.scheduledDate + (b.notes || '')))

      const coords = crewJobs.map(j => getJobCoords(j)).filter(Boolean) as { lat: number; lng: number }[]
      if (coords.length < 2) continue

      const line = L.polyline(coords.map(c => [c.lat, c.lng] as [number, number]), { color: crew.hex, opacity: 0.6, weight: 3 }).addTo(mapRef.current)
      routeLinesRef.current.push(line)
    }
  }, [mapReady, scheduledJobs, crews, getJobCoords])

  // ── Build timeline blocks ──────────────────────

  const timelineData = useMemo(() => {
    const data: Record<string, Record<string, TimeBlock[]>> = {}

    for (const date of visibleDates) {
      const ds = toDateStr(date)
      data[ds] = {}

      for (const crew of crews) {
        const crewJobs = scheduledJobs
          .filter(j => jobDays(j, workDays).includes(ds) && findCrew(crews, j.crewAssigned)?.id === crew.id)
          .sort((a, b) => a.customerName.localeCompare(b.customerName))

        const blocks: TimeBlock[] = []
        let currentHour = 7

        for (let i = 0; i < crewJobs.length; i++) {
          const job = crewJobs[i]
          const duration = Math.max(1, (job.estimatedDays || 1) >= 1 ? Math.min(job.totalFeet / 100, 8) : job.estimatedDays * 8)
          const hours = Math.min(Math.max(duration, 1.5), 4) // clamp 1.5-4 hrs per job block

          // Drive time from previous job
          let driveMinutes: number | undefined
          if (i > 0) {
            const prevCoords = getJobCoords(crewJobs[i - 1])
            const thisCoords = getJobCoords(job)
            if (prevCoords && thisCoords) {
              const miles = distanceMiles(prevCoords, thisCoords)
              driveMinutes = Math.round(miles * 2) // ~30mph avg
              currentHour += driveMinutes / 60
            }
          }

          blocks.push({
            job,
            startHour: currentHour,
            durationHours: hours,
            driveMinutes,
          })

          currentHour += hours
        }

        data[ds][crew.id] = blocks
      }
    }

    return data
  }, [scheduledJobs, visibleDates, crews, getJobCoords, workDays])

  // ── Drag & drop handlers ───────────────────────

  function handleDragStart(job: Job) {
    setDragJob(job)
  }

  // Every change of day or crew is the Schedule install step (installScheduleApi.ts): crew days on
  // work days, the Scheduled stage, the Schedule board and the calendar, the same as on the Schedule.
  async function book(jobId: string, start: string, crew: string, what: string) {
    if (!can('schedule.change')) { toast.error('Not saved', 'Your role cannot change the crew schedule. Ask Jonathan.'); return }
    const r = await scheduleInstall({ jobId, start, crew })
    if (!r.ok) { toast.error(`Not ${what}`, r.error); return }
    setJobs(getJobs())
    setSelectedJobId(jobId)
    // The customer's text, prepared and shown: sent from this phone, or not.
    setDone({ text: r.data.text, title: r.data.rescheduled ? 'Install moved' : 'Install scheduled', summary: `${r.data.text.customerName}: ${r.data.days.length} crew day${r.data.days.length === 1 ? '' : 's'} from ${r.data.days[0]}, ${r.data.crew.name}. ${r.data.calendar}` })
  }

  function handleDropOnTimeline(crewId: string, date: string) {
    if (!dragJob) return
    const j = dragJob
    setDragJob(null)
    void book(j.id, date, crewId, 'scheduled')
  }

  // ── Quick actions ──────────────────────────────

  function handleReassign(jobId: string, crewId: string) {
    const j = jobs.find(x => x.id === jobId)
    if (!j) return
    // No date yet: the crew is kept on the job until it is booked.
    if (!j.scheduledDate) { updateJob(jobId, { crewAssigned: crewId }); setJobs(getJobs()); return }
    void book(jobId, j.scheduledDate, crewId, 'changed')
  }

  function handleReschedule(jobId: string, newDate: string) {
    const j = jobs.find(x => x.id === jobId)
    if (!j || !newDate) return
    void book(jobId, newDate, j.crewAssigned, 'moved')
  }

  // ── Today's summary stats ──────────────────────

  const todayStats = useMemo(() => {
    const todayJobs = scheduledJobs.filter(j => j.scheduledDate === dateStr)
    return {
      totalJobs: todayJobs.length,
      totalValue: todayJobs.reduce((s, j) => s + j.contractValue, 0),
      byStatus: todayJobs.reduce((acc, j) => {
        acc[j.status] = (acc[j.status] || 0) + 1
        return acc
      }, {} as Record<string, number>),
      totalFeet: todayJobs.reduce((s, j) => s + j.totalFeet, 0),
      unassigned: unassignedJobs.length,
    }
  }, [scheduledJobs, unassignedJobs, dateStr])

  // ═══ RENDER ════════════════════════════════════

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col gap-0 -mx-4 lg:-mx-8 -mt-4 lg:-mt-6 -mb-4 lg:-mb-6">
      {/* ── Top bar: date nav + view toggle ── */}
      <div className="bg-white border-b border-gray-200 px-4 lg:px-6 py-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentDate(d => addDays(d, viewMode === 'day' ? -1 : -7))}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            &larr;
          </button>
          <button
            onClick={() => setCurrentDate(new Date())}
            className="px-3 py-1 rounded-lg text-sm font-medium bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            Today
          </button>
          <button
            onClick={() => setCurrentDate(d => addDays(d, viewMode === 'day' ? 1 : 7))}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            &rarr;
          </button>
          <h3 className="text-sm font-semibold text-gray-900 ml-2">
            {viewMode === 'day'
              ? currentDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
              : `Week of ${weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} — ${weekDates[4].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
            }
          </h3>
          {/* Jump to a day. */}
          <input type="date" aria-label="Go to a day" value={dateStr} data-dispatch-date
            onChange={e => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.target.value); if (m) setCurrentDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)) }}
            className="ml-2 border border-gray-300 rounded-lg px-2 py-1 text-sm min-h-[40px]" />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(['day', 'week'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  viewMode === mode ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {mode === 'day' ? 'Day' : 'Week'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Main 3-panel layout ── */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">

        {/* ═══ LEFT: MAP ═══ */}
        <div className="w-full h-64 lg:h-auto lg:w-1/2 border-b lg:border-b-0 lg:border-r border-gray-200 map-layer shrink-0" data-dispatch-map>
          <div ref={mapContainerRef} className="absolute inset-0" />
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <p className="text-gray-400 text-sm">Loading map...</p>
            </div>
          )}
          {mapReady && <MapLegend jobs={[...scheduledJobs, ...unassignedJobs]} crews={crews} open={legendOpen} onToggle={() => setLegendOpen(o => !o)} />}
        </div>

        {/* ═══ RIGHT: TIMELINE + SIDEBAR ═══ */}
        <div className="w-full lg:w-1/2 flex-1 flex flex-col overflow-hidden">

          {/* ── Timeline (Gantt) ── */}
          <div className="flex-1 overflow-auto border-b border-gray-200 bg-white">
            {viewMode === 'day' ? (
              <DayTimeline
                date={dateStr}
                crews={crews}
                blocks={timelineData[dateStr] || {}}
                selectedJobId={selectedJobId}
                onSelectJob={setSelectedJobId}
                onDrop={handleDropOnTimeline}
                dragActive={!!dragJob}
              />
            ) : (
              <WeekTimeline
                dates={weekDates}
                crews={crews}
                timelineData={timelineData}
                selectedJobId={selectedJobId}
                onSelectJob={setSelectedJobId}
                onDrop={handleDropOnTimeline}
                dragActive={!!dragJob}
              />
            )}
          </div>

          {/* ── Context Sidebar ── */}
          <div className="h-[320px] shrink-0 overflow-y-auto bg-gray-50 border-t border-gray-200">
            {selectedJob ? (
              <JobDetailPanel
                job={selectedJob}
                crews={crews}
                onReassign={handleReassign}
                onReschedule={handleReschedule}
                onClose={() => setSelectedJobId(null)}
                coords={getJobCoords(selectedJob)}
              />
            ) : (
              <div className="p-5">
                <h3 className="font-semibold text-gray-900 mb-4">{dateStr === toDateStr(new Date()) ? "Today's Dispatch" : `Dispatch for ${currentDate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}`}</h3>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <StatCard label="Jobs Scheduled" value={todayStats.totalJobs} />
                  <StatCard label="Total Feet" value={todayStats.totalFeet.toLocaleString()} />
                  <StatCard label="Unassigned" value={todayStats.unassigned} highlight={todayStats.unassigned > 0} />
                </div>
                <p className="text-xs text-gray-400 mb-2 font-semibold">
                  Contract Value: {fmt(todayStats.totalValue)}
                </p>

                {/* Unassigned queue */}
                {unassignedJobs.length > 0 && (
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-red-600 mb-2">
                      Unassigned Jobs ({unassignedJobs.length})
                    </p>
                    <div className="space-y-1.5 max-h-[140px] overflow-y-auto">
                      {unassignedJobs.slice(0, 20).map(job => (
                        <div
                          key={job.id}
                          draggable
                          onDragStart={() => handleDragStart(job)}
                          onDragEnd={() => setDragJob(null)}
                          onClick={() => setSelectedJobId(job.id)}
                          className={`bg-white border rounded-lg px-3 py-2 cursor-grab hover:border-orange-300 transition-colors text-xs ${
                            job.id === selectedJobId ? 'border-orange-500 ring-1 ring-orange-200' : 'border-gray-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-gray-900">{job.customerName}</span>
                            <span className="text-gray-400">{job.totalFeet} ft</span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-gray-400">
                            <span>{styleLabel(job.fenceStyle)}</span>
                            <span>&middot;</span>
                            <span className={MATERIALS_STATUS_CONFIG[job.materialsStatus].color}>
                              {MATERIALS_STATUS_CONFIG[job.materialsStatus].label}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      {done && <InstallTextSheet text={done.text} title={done.title} summary={done.summary} onClose={() => setDone(null)} />}
    </div>
  )
}

// ═══ SUB-COMPONENTS ══════════════════════════════

// What the pins mean: fill = Operations stage (Settings), ring and letters = crew.
// Lists the stages and crews of the jobs on the map. Top right, clear of the zoom
// buttons; folded on a phone until tapped.
function MapLegend({ jobs, crews, open, onToggle }: { jobs: Job[]; crews: Crew[]; open: boolean; onToggle: () => void }) {
  const stages = useOpsStages()
  const seen = new Map<string, number>()
  const crewSeen = new Map<string, number>()
  let noCrew = 0
  for (const j of jobs) {
    const id = stageOf(j)
    seen.set(id, (seen.get(id) || 0) + 1)
    const c = findCrew(crews, j.crewAssigned)
    if (c) crewSeen.set(c.id, (crewSeen.get(c.id) || 0) + 1); else noCrew++
  }
  const stageRows = stages.filter(st => seen.has(st.id))
  const crewRows = crews.filter(c => crewSeen.has(c.id) || !c.fromJob)
  return (
    <div className="absolute right-2 top-2 z-(--z-map-ui) max-w-[calc(100%-4rem)] text-[11px] flex flex-col items-end" data-dispatch-legend>
      <button type="button" onClick={onToggle} aria-expanded={open} data-dispatch-legend-toggle
        className="bg-white/95 backdrop-blur shadow-md border border-gray-200 rounded-lg px-3 min-h-[36px] font-semibold text-gray-800">
        {open ? 'Hide legend' : 'Legend'}
      </button>
      {open && (
        <div className="mt-1 bg-white/95 backdrop-blur shadow-lg border border-gray-200 rounded-lg p-2 max-h-40 lg:max-h-72 overflow-y-auto w-56" data-dispatch-legend-body>
          <p className="font-semibold text-gray-500 mb-1">Pin color: stage</p>
          {stageRows.length === 0 && <p className="text-gray-500">No jobs on the map</p>}
          {stageRows.map(st => (
            <p key={st.id} className="flex items-center gap-1.5 leading-5" data-legend-stage={st.id}>
              <span className="w-3 h-3 rounded-full shrink-0 border border-white shadow" style={{ backgroundColor: st.color }} />
              <span className="truncate text-gray-800">{st.name}</span>
              <span className="ml-auto text-gray-500 tabular-nums">{seen.get(st.id)}</span>
            </p>
          ))}
          <p className="font-semibold text-gray-500 mt-2 mb-1">Ring and letters: crew</p>
          {crewRows.map(c => (
            <p key={c.id} className="flex items-center gap-1.5 leading-5" data-legend-crew={c.id}>
              <span className="w-5 h-5 rounded-full shrink-0 bg-white grid place-items-center text-[7px] font-extrabold text-gray-800" style={{ border: `2.5px solid ${c.hex}` }}>{crewInitials(c.name)}</span>
              <span className="truncate text-gray-800">{c.name}</span>
              <span className="ml-auto text-gray-500 tabular-nums">{crewSeen.get(c.id) || 0}</span>
            </p>
          ))}
          <p className="flex items-center gap-1.5 leading-5" data-legend-crew="">
            <span className="w-4 h-4 rounded-full shrink-0 bg-white border-2 border-dashed border-gray-500" />
            <span className="text-gray-800">No crew yet (customer's initials)</span>
            <span className="ml-auto text-gray-500 tabular-nums">{noCrew}</span>
          </p>
        </div>
      )}
    </div>
  )
}

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${highlight ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <p className={`text-lg font-bold ${highlight ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      <p className="text-[10px] text-gray-400 font-semibold mt-0.5">{label}</p>
    </div>
  )
}

// ── Day Timeline ─────────────────────────────────

function DayTimeline({
  date,
  crews,
  blocks,
  selectedJobId,
  onSelectJob,
  onDrop,
  dragActive,
}: {
  date: string
  crews: Crew[]
  blocks: Record<string, TimeBlock[]>
  selectedJobId: string | null
  onSelectJob: (id: string) => void
  onDrop: (crewId: string, date: string) => void
  dragActive: boolean
}) {
  const hourWidth = 100 // px per hour
  const rowHeight = 64

  return (
    <div className="min-w-0">
      {/* Hour headers */}
      <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
        <div className="w-28 shrink-0 px-3 py-2 text-xs font-semibold text-gray-500 border-r border-gray-200">
          Crew
        </div>
        <div className="flex">
          {HOURS.map((h, i) => (
            <div
              key={h}
              className="border-r border-gray-100 text-center text-[10px] text-gray-400 font-semibold py-2"
              style={{ width: hourWidth }}
            >
              {HOUR_LABELS[i]}
            </div>
          ))}
        </div>
      </div>

      {/* Crew rows */}
      {crews.map(crew => {
        const crewBlocks = blocks[crew.id] || []
        return (
          <div
            key={crew.id}
            className={`flex border-b border-gray-100 ${dragActive ? 'bg-blue-50/30' : ''}`}
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('bg-orange-50') }}
            onDragLeave={e => e.currentTarget.classList.remove('bg-orange-50')}
            onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('bg-orange-50'); onDrop(crew.id, date) }}
            style={{ height: rowHeight }}
          >
            {/* Crew label */}
            <div className="w-28 shrink-0 flex items-center gap-2 px-3 border-r border-gray-200">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: crew.hex }} />
              <span className="text-xs font-semibold text-gray-700 truncate">{crew.name}</span>
            </div>

            {/* Timeline track */}
            <div className="relative flex-1" style={{ width: HOURS.length * hourWidth }}>
              {/* Hour grid lines */}
              {HOURS.map(h => (
                <div
                  key={h}
                  className="absolute top-0 bottom-0 border-r border-gray-50"
                  style={{ left: (h - 7) * hourWidth }}
                />
              ))}

              {/* Job blocks */}
              {crewBlocks.map(block => {
                const left = (block.startHour - 7) * hourWidth
                const width = block.durationHours * hourWidth
                const isSelected = block.job.id === selectedJobId

                return (
                  <div key={block.job.id}>
                    {/* Drive time indicator */}
                    {block.driveMinutes != null && block.driveMinutes > 0 && (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 flex items-center justify-center"
                        style={{
                          left: left - (block.driveMinutes / 60) * hourWidth,
                          width: (block.driveMinutes / 60) * hourWidth,
                        }}
                      >
                        <div className="bg-gray-200 text-gray-500 text-[9px] px-1 py-0.5 rounded whitespace-nowrap">
                          {block.driveMinutes}m
                        </div>
                      </div>
                    )}

                    {/* Job block */}
                    <div
                      onClick={() => onSelectJob(block.job.id)}
                      data-dispatch-block={block.job.id}
                      data-dispatch-block-day={date}
                      className={`absolute top-1 bottom-1 rounded-lg cursor-pointer transition-all overflow-hidden flex flex-col justify-center px-2.5 ${
                        isSelected
                          ? 'ring-2 ring-orange-500 shadow-lg z-20'
                          : 'hover:shadow-md z-10'
                      }`}
                      style={{
                        left,
                        width: Math.max(width, 60),
                        backgroundColor: crew.hex + (isSelected ? 'FF' : 'E6'),
                      }}
                    >
                      <p className="text-white text-xs font-semibold truncate leading-tight">
                        {block.job.customerName}
                      </p>
                      <p className="text-white/80 text-[10px] truncate leading-tight">
                        {styleLabel(block.job.fenceStyle)} &middot; {block.job.totalFeet} ft
                      </p>
                      {block.job.materialsStatus !== 'loaded' && block.job.materialsStatus !== 'received' && (
                        <div className="absolute top-1 right-1">
                          <div className="w-2 h-2 rounded-full bg-yellow-400" title={`Materials: ${block.job.materialsStatus}`} />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Week Timeline ────────────────────────────────

function WeekTimeline({
  dates,
  crews,
  timelineData,
  selectedJobId,
  onSelectJob,
  onDrop,
  dragActive,
}: {
  dates: Date[]
  crews: Crew[]
  timelineData: Record<string, Record<string, TimeBlock[]>>
  selectedJobId: string | null
  onSelectJob: (id: string) => void
  onDrop: (crewId: string, date: string) => void
  dragActive: boolean
}) {
  return (
    <div>
      {/* Day headers */}
      <div className="flex border-b border-gray-200 bg-gray-50 sticky top-0 z-10">
        <div className="w-28 shrink-0 px-3 py-2 text-xs font-semibold text-gray-500 border-r border-gray-200">
          Crew
        </div>
        {dates.map(d => {
          const ds = toDateStr(d)
          const isToday = ds === toDateStr(new Date())
          return (
            <div key={ds} className={`flex-1 text-center py-2 border-r border-gray-200 ${isToday ? 'bg-orange-50' : ''}`}>
              <p className="text-[10px] text-gray-400 font-semibold">
                {d.toLocaleDateString('en-US', { weekday: 'short' })}
              </p>
              <p className={`text-sm font-bold ${isToday ? 'text-orange-600' : 'text-gray-700'}`}>
                {d.getDate()}
              </p>
            </div>
          )
        })}
      </div>

      {/* Crew rows */}
      {crews.map(crew => (
        <div key={crew.id} className="flex border-b border-gray-100">
          <div className="w-28 shrink-0 flex items-center gap-2 px-3 border-r border-gray-200 py-2">
            <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: crew.hex }} />
            <span className="text-xs font-semibold text-gray-700 truncate">{crew.name}</span>
          </div>
          {dates.map(d => {
            const ds = toDateStr(d)
            const dayBlocks = timelineData[ds]?.[crew.id] || []
            const isToday = ds === toDateStr(new Date())
            return (
              <div
                key={ds}
                className={`flex-1 border-r border-gray-100 p-1 min-h-[56px] ${isToday ? 'bg-orange-50/30' : ''} ${dragActive ? 'bg-blue-50/20' : ''}`}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('bg-orange-100/50') }}
                onDragLeave={e => e.currentTarget.classList.remove('bg-orange-100/50')}
                onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('bg-orange-100/50'); onDrop(crew.id, ds) }}
              >
                {dayBlocks.map(block => {
                  const isSelected = block.job.id === selectedJobId
                  return (
                    <div
                      key={block.job.id}
                      onClick={() => onSelectJob(block.job.id)}
                      className={`rounded-md px-1.5 py-1 mb-0.5 cursor-pointer text-white text-[10px] truncate transition-all ${
                        isSelected ? 'ring-2 ring-orange-500 shadow-md' : 'hover:shadow-sm'
                      }`}
                      style={{ backgroundColor: crew.hex + (isSelected ? 'FF' : 'CC') }}
                    >
                      <span className="font-semibold">{block.job.customerName}</span>
                      <br />
                      <span className="opacity-75">{block.job.totalFeet} ft</span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ── Job Detail Panel ─────────────────────────────

function JobDetailPanel({
  job,
  crews,
  onReassign,
  onReschedule,
  onClose,
  coords,
}: {
  job: Job
  crews: Crew[]
  onReassign: (jobId: string, crewId: string) => void
  onReschedule: (jobId: string, date: string) => void
  onClose: () => void
  coords: { lat: number; lng: number } | null
}) {
  useOpsStages()
  const stage = stageInfo(stageOf(job))
  const crewId = findCrew(crews, job.crewAssigned)?.id ?? ''
  const matCfg = MATERIALS_STATUS_CONFIG[job.materialsStatus]

  return (
    <div className="p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-bold text-gray-900 text-sm">{job.customerName}</h3>
          <p className="text-xs text-gray-500 mt-0.5">{job.customerAddress}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg leading-none">&times;</button>
      </div>

      {/* Status badges */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {stage && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold text-white" style={{ backgroundColor: stage.color }} data-ops-stage-pill={stage.id}>
            {stage.name}
          </span>
        )}
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold bg-gray-100 ${matCfg.color}`}>
          Materials: {matCfg.label}
        </span>
        {job.drawingComplete && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-green-100 text-green-700">Drawing Done</span>
        )}
        {!job.drawingComplete && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-yellow-100 text-yellow-700">No Drawing</span>
        )}
        {job.locatesExpDate && new Date(job.locatesExpDate) < new Date() && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-100 text-red-700">Locates Expired</span>
        )}
        {job.tearOutSections > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-orange-100 text-orange-700">Tear-out</span>
        )}
      </div>

      {/* Details grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs mb-3">
        <div className="flex justify-between">
          <span className="text-gray-400">Style</span>
          <span className="font-medium text-gray-900">{styleLabel(job.fenceStyle)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Total Feet</span>
          <span className="font-medium text-gray-900">{job.totalFeet}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Sections</span>
          <span className="font-medium text-gray-900">{job.sections}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Contract</span>
          <span className="font-medium text-gray-900">{fmt(job.contractValue)}</span>
        </div>
        {can('costs.view') && <div className="flex justify-between">
          <span className="text-gray-400">Margin</span>
          <span className={`font-medium ${job.gmPct >= 0.34 ? 'text-green-600' : job.gmPct >= 0.27 ? 'text-yellow-600' : 'text-red-600'}`}>
            {(job.gmPct * 100).toFixed(1)}%
          </span>
        </div>}
        <div className="flex justify-between">
          <span className="text-gray-400">Est. Days</span>
          <span className="font-medium text-gray-900">{job.estimatedDays}</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
        <div className="flex-1">
          <label className="text-[10px] text-gray-400 font-semibold block mb-0.5">Crew</label>
          <select
            value={crewId}
            onChange={e => onReassign(job.id, e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
          >
            <option value="">Unassigned</option>
            {crews.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-gray-400 font-semibold block mb-0.5">Date</label>
          <input
            type="date"
            value={job.scheduledDate}
            onChange={e => onReschedule(job.id, e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-orange-400"
          />
        </div>
      </div>

      {/* Contact */}
      {(job.customerPhone || job.customerEmail) && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-gray-200 text-xs text-gray-500">
          {job.customerPhone && <PhoneLink phone={job.customerPhone} customerId={job.customerId ?? null} name={job.customerName} />}
          {job.customerEmail && <span>{job.customerEmail}</span>}
        </div>
      )}

      {job.notes && (
        <p className="mt-2 text-xs text-gray-500 italic border-t border-gray-200 pt-2">{job.notes}</p>
      )}
    </div>
  )
}
