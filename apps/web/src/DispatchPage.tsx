import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { loadMaps, loadMarker } from './mapsLoader'
import { distanceMiles } from './geoUtils'
import {
  getJobs,
  updateJob,
  STATUS_CONFIG,
  MATERIALS_STATUS_CONFIG,
  type Job,
  type JobStatus,
} from './jobStore'
import { loadSchedule as storeLoadSchedule } from './scheduleStore'

/* ═══════════════════════════════════════════════
   DISPATCH COMMAND CENTER
   Map + Timeline + Context Sidebar
   ═══════════════════════════════════════════════ */

// ── Types ────────────────────────────────────────

interface Crew {
  id: string
  name: string
  color: string     // tailwind bg class
  hexColor: string  // hex for map markers
}

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

const DEFAULT_CREWS: Crew[] = [
  { id: 'crew1', name: 'Crew 1', color: 'bg-blue-500', hexColor: '#3B82F6' },
  { id: 'crew2', name: 'Crew 2', color: 'bg-purple-500', hexColor: '#8B5CF6' },
]

const STATUS_PIN_COLORS: Record<string, string> = {
  staging: '#F59E0B',      // amber — not yet scheduled
  scheduled: '#3B82F6',    // blue — confirmed
  in_progress: '#F97316',  // orange — crew on site
  completed: '#9CA3AF',    // gray
  on_hold: '#EF4444',      // red
}

const UNASSIGNED_COLOR = '#EF4444'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const toDateStr = (d: Date) => d.toISOString().slice(0, 10)

function addDays(d: Date, n: number): Date {
  const result = new Date(d)
  result.setDate(result.getDate() + n)
  return result
}

function loadCrews(): Crew[] {
  const { settings } = storeLoadSchedule()
  if (settings?.crews?.length) {
    return settings.crews.map(c => ({
      ...c,
      hexColor: (c as any).hexColor || crewColorToHex(c.color),
    })) as Crew[]
  }
  return DEFAULT_CREWS
}

function crewColorToHex(twClass: string): string {
  const map: Record<string, string> = {
    'bg-blue-500': '#3B82F6',
    'bg-purple-500': '#8B5CF6',
    'bg-green-500': '#22C55E',
    'bg-orange-500': '#F97316',
    'bg-pink-500': '#EC4899',
    'bg-teal-500': '#14B8A6',
    'bg-red-500': '#EF4444',
    'bg-indigo-500': '#6366F1',
    'bg-yellow-500': '#EAB308',
    'bg-cyan-500': '#06B6D4',
  }
  return map[twClass] || '#3B82F6'
}

// ── Geocode helper ───────────────────────────────

const geocodeCache = new Map<string, { lat: number; lng: number } | null>()

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address) return null
  if (geocodeCache.has(address)) return geocodeCache.get(address) || null

  try {
    const geocoder = new google.maps.Geocoder()
    const result = await geocoder.geocode({ address })
    if (result.results.length > 0) {
      const loc = result.results[0].geometry.location
      const coords = { lat: loc.lat(), lng: loc.lng() }
      geocodeCache.set(address, coords)
      return coords
    }
  } catch { /* ignore */ }
  geocodeCache.set(address, null)
  return null
}

// ── Pin SVG builder ──────────────────────────────

function createPinContent(color: string, label: string, isSelected: boolean): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.style.position = 'relative'
  wrapper.style.cursor = 'pointer'
  wrapper.style.transition = 'transform 0.15s'
  if (isSelected) wrapper.style.transform = 'scale(1.3)'

  wrapper.innerHTML = `
    <svg width="32" height="42" viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 26 16 26s16-14 16-26C32 7.16 24.84 0 16 0z" fill="${color}" stroke="${isSelected ? '#111' : '#fff'}" stroke-width="2"/>
      <circle cx="16" cy="16" r="8" fill="white"/>
      <text x="16" y="20" text-anchor="middle" font-size="10" font-weight="bold" fill="${color}">${label}</text>
    </svg>
  `
  return wrapper
}

// ═══ MAIN COMPONENT ══════════════════════════════

export default function DispatchPage() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [jobs, setJobs] = useState<Job[]>([])
  const [crews] = useState<Crew[]>(loadCrews)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [mapReady, setMapReady] = useState(false)
  const [geocodedJobs, setGeocodedJobs] = useState<Map<string, { lat: number; lng: number }>>(new Map())
  const [dragJob, setDragJob] = useState<Job | null>(null)

  const mapRef = useRef<google.maps.Map | null>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map())
  const routeLinesRef = useRef<google.maps.Polyline[]>([])

  const selectedJob = useMemo(() => jobs.find(j => j.id === selectedJobId) || null, [jobs, selectedJobId])

  // ── Date navigation ────────────────────────────

  const dateStr = toDateStr(currentDate)
  const weekDates = useMemo(() => {
    const monday = new Date(currentDate)
    const day = monday.getDay()
    monday.setDate(monday.getDate() - (day === 0 ? 6 : day - 1))
    return Array.from({ length: 5 }, (_, i) => addDays(monday, i))
  }, [currentDate])

  const visibleDates = viewMode === 'day' ? [currentDate] : weekDates

  // ── Load jobs ──────────────────────────────────

  useEffect(() => {
    setJobs(getJobs())
  }, [])

  // Jobs for the current view (scheduled on visible dates + unassigned)
  const scheduledJobs = useMemo(() => {
    const dateStrs = new Set(visibleDates.map(toDateStr))
    return jobs.filter(j => j.scheduledDate && dateStrs.has(j.scheduledDate))
  }, [jobs, visibleDates])

  const unassignedJobs = useMemo(
    () => jobs.filter(j =>
      (j.status === 'staging' || j.status === 'scheduled') &&
      (!j.scheduledDate || !j.crewAssigned)
    ),
    [jobs]
  )

  // ── Init Google Maps ───────────────────────────

  useEffect(() => {
    let cancelled = false
    async function init() {
      try {
        const mapsLib = await loadMaps()
        await loadMarker()
        if (cancelled || !mapContainerRef.current) return

        const map = new mapsLib.Map(mapContainerRef.current, {
          center: { lat: 27.0, lng: -81.5 }, // Central FL default
          zoom: 10,
          mapId: 'dispatch-map',
          disableDefaultUI: true,
          zoomControl: true,
          mapTypeControl: true,
          mapTypeControlOptions: { position: google.maps.ControlPosition.TOP_RIGHT },
        })
        mapRef.current = map
        setMapReady(true)
      } catch (err) {
        console.error('Maps init failed:', err)
      }
    }
    init()
    return () => { cancelled = true }
  }, [])

  // ── Geocode jobs ───────────────────────────────

  useEffect(() => {
    const toGeocode = [...scheduledJobs, ...unassignedJobs].filter(
      j => j.customerAddress && !j.lat && !geocodedJobs.has(j.id)
    )
    if (toGeocode.length === 0) return

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
      if (!cancelled) setGeocodedJobs(newCoords)
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
        marker.map = null
        existingMarkers.delete(id)
      }
    })

    // Add/update markers
    const bounds = new google.maps.LatLngBounds()
    let hasMarkers = false

    for (const job of allJobs) {
      const coords = getJobCoords(job)
      if (!coords) continue

      hasMarkers = true
      bounds.extend(coords)

      const isSelected = job.id === selectedJobId
      const isUnassigned = !job.crewAssigned || !job.scheduledDate
      const crew = crews.find(c => c.id === job.crewAssigned)
      const pinColor = isUnassigned
        ? UNASSIGNED_COLOR
        : (crew?.hexColor || STATUS_PIN_COLORS[job.status] || '#3B82F6')
      const pinLabel = isUnassigned ? '?' : (crew?.name?.replace('Crew ', '') || '')

      const existing = existingMarkers.get(job.id)
      if (existing) {
        existing.position = coords
        existing.content = createPinContent(pinColor, pinLabel, isSelected)
      } else {
        const marker = new google.maps.marker.AdvancedMarkerElement({
          map,
          position: coords,
          content: createPinContent(pinColor, pinLabel, isSelected),
          title: `${job.customerName} — ${job.fenceStyle}`,
        })
        marker.addListener('click', () => {
          setSelectedJobId(job.id)
        })
        existingMarkers.set(job.id, marker)
      }
    }

    if (hasMarkers) {
      map.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 })
      if (map.getZoom()! > 14) map.setZoom(14)
    }
  }, [mapReady, scheduledJobs, unassignedJobs, selectedJobId, getJobCoords, crews])

  // ── Pan to selected job ────────────────────────

  useEffect(() => {
    if (!selectedJob || !mapRef.current) return
    const coords = getJobCoords(selectedJob)
    if (coords) {
      mapRef.current.panTo(coords)
      if (mapRef.current.getZoom()! < 13) mapRef.current.setZoom(13)
    }
  }, [selectedJobId])

  // ── Draw route lines per crew ──────────────────

  useEffect(() => {
    // Clean old lines
    routeLinesRef.current.forEach(l => l.setMap(null))
    routeLinesRef.current = []

    if (!mapReady || !mapRef.current) return

    for (const crew of crews) {
      const crewJobs = scheduledJobs
        .filter(j => j.crewAssigned === crew.id)
        .sort((a, b) => (a.scheduledDate + (a.notes || '')).localeCompare(b.scheduledDate + (b.notes || '')))

      const coords = crewJobs.map(j => getJobCoords(j)).filter(Boolean) as { lat: number; lng: number }[]
      if (coords.length < 2) continue

      const line = new google.maps.Polyline({
        path: coords,
        geodesic: true,
        strokeColor: crew.hexColor,
        strokeOpacity: 0.6,
        strokeWeight: 3,
        map: mapRef.current,
      })
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
          .filter(j => j.scheduledDate === ds && j.crewAssigned === crew.id)
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
  }, [scheduledJobs, visibleDates, crews, getJobCoords])

  // ── Drag & drop handlers ───────────────────────

  function handleDragStart(job: Job) {
    setDragJob(job)
  }

  function handleDropOnTimeline(crewId: string, date: string) {
    if (!dragJob) return
    const updated = updateJob(dragJob.id, {
      crewAssigned: crewId,
      scheduledDate: date,
      status: dragJob.status === 'staging' ? 'scheduled' : dragJob.status,
    })
    if (updated) {
      setJobs(getJobs())
      setSelectedJobId(dragJob.id)
    }
    setDragJob(null)
  }

  // ── Quick actions ──────────────────────────────

  function handleReassign(jobId: string, crewId: string) {
    updateJob(jobId, { crewAssigned: crewId })
    setJobs(getJobs())
  }

  function handleReschedule(jobId: string, newDate: string) {
    updateJob(jobId, { scheduledDate: newDate })
    setJobs(getJobs())
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
    <div className="h-[calc(100vh-120px)] flex flex-col gap-0 -mx-8 -mt-6 -mb-6">
      {/* ── Top bar: date nav + view toggle ── */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
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
        </div>

        <div className="flex items-center gap-2">
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
          {/* Crew legend */}
          <div className="flex items-center gap-3 ml-4">
            {crews.map(c => (
              <div key={c.id} className="flex items-center gap-1.5">
                <div className={`w-3 h-3 rounded-full ${c.color}`} />
                <span className="text-xs text-gray-600">{c.name}</span>
              </div>
            ))}
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500" />
              <span className="text-xs text-gray-600">Unassigned</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main 3-panel layout ── */}
      <div className="flex-1 flex overflow-hidden">

        {/* ═══ LEFT: MAP ═══ */}
        <div className="w-1/2 border-r border-gray-200 relative">
          <div ref={mapContainerRef} className="absolute inset-0" />
          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <p className="text-gray-400 text-sm">Loading map...</p>
            </div>
          )}
        </div>

        {/* ═══ RIGHT: TIMELINE + SIDEBAR ═══ */}
        <div className="w-1/2 flex flex-col overflow-hidden">

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
                <h3 className="font-semibold text-gray-900 mb-4">Today's Dispatch</h3>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <StatCard label="Jobs Scheduled" value={todayStats.totalJobs} />
                  <StatCard label="Total Feet" value={todayStats.totalFeet.toLocaleString()} />
                  <StatCard label="Unassigned" value={todayStats.unassigned} highlight={todayStats.unassigned > 0} />
                </div>
                <p className="text-xs text-gray-400 mb-2 font-semibold uppercase tracking-wide">
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
                            <span>{job.fenceStyle}</span>
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
    </div>
  )
}

// ═══ SUB-COMPONENTS ══════════════════════════════

function StatCard({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border px-3 py-2.5 ${highlight ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white'}`}>
      <p className={`text-lg font-bold ${highlight ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
      <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide mt-0.5">{label}</p>
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
              <div className={`w-3 h-3 rounded-full shrink-0 ${crew.color}`} />
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
                const statusCfg = STATUS_CONFIG[block.job.status]

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
                      className={`absolute top-1 bottom-1 rounded-lg cursor-pointer transition-all overflow-hidden flex flex-col justify-center px-2.5 ${
                        isSelected
                          ? 'ring-2 ring-orange-500 shadow-lg z-20'
                          : 'hover:shadow-md z-10'
                      }`}
                      style={{
                        left,
                        width: Math.max(width, 60),
                        backgroundColor: crew.hexColor + (isSelected ? 'FF' : 'E6'),
                      }}
                    >
                      <p className="text-white text-xs font-semibold truncate leading-tight">
                        {block.job.customerName}
                      </p>
                      <p className="text-white/80 text-[10px] truncate leading-tight">
                        {block.job.fenceStyle} &middot; {block.job.totalFeet} ft
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
              <p className="text-[10px] text-gray-400 font-semibold uppercase">
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
            <div className={`w-3 h-3 rounded-full shrink-0 ${crew.color}`} />
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
                      style={{ backgroundColor: crew.hexColor + (isSelected ? 'FF' : 'CC') }}
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
  const statusCfg = STATUS_CONFIG[job.status]
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
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${statusCfg.bgColor} ${statusCfg.color}`}>
          {statusCfg.icon} {statusCfg.label}
        </span>
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
          <span className="font-medium text-gray-900">{job.fenceStyle}</span>
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
        <div className="flex justify-between">
          <span className="text-gray-400">Margin</span>
          <span className={`font-medium ${job.gmPct >= 0.34 ? 'text-green-600' : job.gmPct >= 0.27 ? 'text-yellow-600' : 'text-red-600'}`}>
            {(job.gmPct * 100).toFixed(1)}%
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">Est. Days</span>
          <span className="font-medium text-gray-900">{job.estimatedDays}</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex items-center gap-2 pt-2 border-t border-gray-200">
        <div className="flex-1">
          <label className="text-[10px] text-gray-400 font-semibold uppercase block mb-0.5">Crew</label>
          <select
            value={job.crewAssigned}
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
          <label className="text-[10px] text-gray-400 font-semibold uppercase block mb-0.5">Date</label>
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
          {job.customerPhone && <span>{job.customerPhone}</span>}
          {job.customerEmail && <span>{job.customerEmail}</span>}
        </div>
      )}

      {job.notes && (
        <p className="mt-2 text-xs text-gray-500 italic border-t border-gray-200 pt-2">{job.notes}</p>
      )}
    </div>
  )
}
