import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { getJobs, updateJob } from './jobStore'
import { loadMaps, loadMarker, loadPlaces } from './mapsLoader'
import { clusterByDistance } from './geoUtils'
import type { LatLng } from './geoUtils'
import { cloudStorage } from './cloudStorage'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

const CLUSTER_COLORS = ['#f97316', '#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f59e0b', '#06b6d4', '#ec4899']

/* ───────── Unified schedulable job ───────── */

interface SchedulableJob {
  id: string
  source: 'jobs' | 'staging'
  customerName: string
  address: string
  fenceType: string
  sections: number
  estimatedDays: number
  contractValue: number
  tearOut: boolean
  materialsStatus: string
  locatesExpDate?: string
  locatesGoodDate?: string
  drawingComplete: boolean
  pullSheetPulled: boolean
  notes: string
  crewAssigned: string
  scheduledDate: string
  lat?: number
  lng?: number
  // staging-specific
  stagingStatus?: string
  manhoursSold?: number
}

/* ───────── Load from both stores ───────── */

function loadSchedulableJobs(): SchedulableJob[] {
  const result: SchedulableJob[] = []

  // From job store
  const jobs = getJobs()
  jobs.filter(j => j.status === 'staging' || j.status === 'scheduled' || j.status === 'on_hold')
    .forEach(j => {
      result.push({
        id: j.id,
        source: 'jobs',
        customerName: j.customerName,
        address: j.customerAddress,
        fenceType: j.fenceStyle,
        sections: j.sections,
        estimatedDays: j.estimatedDays,
        contractValue: j.contractValue,
        tearOut: j.tearOutSections > 0,
        materialsStatus: j.materialsStatus,
        locatesExpDate: j.locatesExpDate,
        locatesGoodDate: j.locatesDate,
        drawingComplete: j.drawingComplete,
        pullSheetPulled: j.pullSheetPulled,
        notes: j.notes,
        crewAssigned: j.crewAssigned,
        scheduledDate: j.scheduledDate,
        lat: j.lat,
        lng: j.lng,
        stagingStatus: j.status,
      })
    })

  // From staging store (catch jobs not yet in the unified store)
  try {
    const raw = cloudStorage.getItem('fencepro_staging')
    if (raw) {
      const staging = JSON.parse(raw) as any[]
      const jobIds = new Set(result.map(r => r.id))
      const stageStatuses = new Set([
        'Awaiting Locates', 'Need Drawing', 'Materials Ordered', 'Ready to Pull',
        'Scheduled', 'Customer Delay', 'Hold (HOA)', 'Deed Restricted', 'Backorder',
      ])

      staging.filter(s => stageStatuses.has(s.status) && !jobIds.has(s.id))
        .forEach(s => {
          result.push({
            id: s.id,
            source: 'staging',
            customerName: s.clientName,
            address: s.area || '',
            fenceType: s.fenceType,
            sections: s.sections,
            estimatedDays: Math.max(1, Math.ceil((s.sections || 10) / 15)),
            contractValue: s.jobPrice || 0,
            tearOut: s.tearout || false,
            materialsStatus: s.status === 'Materials Ordered' ? 'ordered' : s.status === 'Ready to Pull' ? 'received' : 'not_ordered',
            locatesExpDate: s.locatesExpDate,
            locatesGoodDate: s.locatesGoodDate,
            drawingComplete: s.status !== 'Need Drawing',
            pullSheetPulled: s.status === 'Ready to Pull',
            notes: s.notes || '',
            crewAssigned: '',
            scheduledDate: '',
            lat: undefined,
            lng: undefined,
            stagingStatus: s.status,
            manhoursSold: s.manhoursSold,
          })
        })
    }
  } catch { /* ignore */ }

  return result
}

/* ───────── Tags ───────── */

interface Tag { label: string; bg: string; text: string }

function getJobTags(job: SchedulableJob): Tag[] {
  const tags: Tag[] = []

  // Fence type
  const ft = job.fenceType?.toLowerCase() || ''
  if (ft.includes('vinyl') || ft.startsWith('wv') || ft.startsWith('tv'))
    tags.push({ label: 'Vinyl', bg: 'bg-orange-100', text: 'text-orange-700' })
  else if (ft.includes('chain') || ft.startsWith('cl'))
    tags.push({ label: 'Chainlink', bg: 'bg-gray-200', text: 'text-gray-700' })
  else if (ft.includes('alum'))
    tags.push({ label: 'Aluminum', bg: 'bg-blue-100', text: 'text-blue-700' })
  else if (ft.includes('com'))
    tags.push({ label: 'Commercial', bg: 'bg-red-100', text: 'text-red-700' })
  else if (job.fenceType)
    tags.push({ label: job.fenceType.slice(0, 12), bg: 'bg-gray-100', text: 'text-gray-600' })

  // Materials
  if (job.materialsStatus === 'loaded')
    tags.push({ label: 'Loaded', bg: 'bg-green-100', text: 'text-green-700' })
  else if (job.materialsStatus === 'received')
    tags.push({ label: 'Materials In', bg: 'bg-green-50', text: 'text-green-600' })
  else if (job.materialsStatus === 'ordered')
    tags.push({ label: 'Mat. Ordered', bg: 'bg-blue-50', text: 'text-blue-600' })
  else
    tags.push({ label: 'No Materials', bg: 'bg-red-50', text: 'text-red-500' })

  // Tear out
  if (job.tearOut) tags.push({ label: 'Tear Out', bg: 'bg-purple-100', text: 'text-purple-700' })

  // Locates
  if (job.locatesExpDate) {
    const exp = new Date(job.locatesExpDate)
    const now = new Date()
    const daysUntil = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (daysUntil < 0) tags.push({ label: 'Locates EXPIRED', bg: 'bg-red-200', text: 'text-red-800' })
    else if (daysUntil <= 5) tags.push({ label: `Locates ${daysUntil}d`, bg: 'bg-yellow-100', text: 'text-yellow-800' })
  }

  // Drawing
  if (!job.drawingComplete) tags.push({ label: 'Need Drawing', bg: 'bg-yellow-50', text: 'text-yellow-700' })

  // Hold statuses
  if (job.stagingStatus === 'on_hold' || job.stagingStatus === 'Customer Delay' || job.stagingStatus === 'Hold (HOA)' || job.stagingStatus === 'Deed Restricted' || job.stagingStatus === 'Backorder')
    tags.push({ label: job.stagingStatus === 'on_hold' ? 'On Hold' : job.stagingStatus!, bg: 'bg-gray-200', text: 'text-gray-600' })

  return tags
}

/* ───────── Geocode ───────── */

async function geocodeAddress(address: string): Promise<{ coords: LatLng | null; error?: string }> {
  if (!address || address.trim().length < 5) return { coords: null, error: 'Address too short or empty' }
  try {
    // Ensure Google Maps is loaded
    if (typeof google === 'undefined' || !google.maps?.Geocoder) {
      return { coords: null, error: 'Google Maps not loaded' }
    }
    const geocoder = new google.maps.Geocoder()
    // Append state if address looks incomplete (no state/zip)
    const fullAddress = /\b(FL|florida)\b/i.test(address) ? address : `${address}, FL`
    const result = await geocoder.geocode({ address: fullAddress })
    if (result.results[0]?.geometry?.location) {
      return {
        coords: { lat: result.results[0].geometry.location.lat(), lng: result.results[0].geometry.location.lng() },
      }
    }
    return { coords: null, error: 'No results found for this address' }
  } catch (err) {
    return { coords: null, error: `Geocoding failed: ${err instanceof Error ? err.message : 'unknown error'}` }
  }
}

/* ═══════════════════════════════════════════════
   SMART SCHEDULE
   ═══════════════════════════════════════════════ */

export default function SmartSchedule({ onClose }: { onClose: () => void }) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const markersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])

  const [allJobs, setAllJobs] = useState<SchedulableJob[]>([])
  const [radius, setRadius] = useState(5)
  const [geocoding, setGeocoding] = useState(false)
  const [mapReady, setMapReady] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null)
  const [crewName, setCrewName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [showClusters, setShowClusters] = useState(false)
  const [search, setSearch] = useState('')
  const [filterType, setFilterType] = useState('all')
  const [applied, setApplied] = useState('')

  useEffect(() => { setAllJobs(loadSchedulableJobs()) }, [])

  // Init map
  useEffect(() => {
    async function init() {
      if (!mapRef.current) return
      const { Map } = await loadMaps()
      await loadMarker()
      const map = new Map(mapRef.current, {
        center: { lat: 29.1872, lng: -82.1401 },
        zoom: 10,
        mapId: 'smart-schedule-v2',
        mapTypeId: 'roadmap',
        disableDefaultUI: false,
        zoomControl: true,
        fullscreenControl: false,
        streetViewControl: false,
      })
      mapInstanceRef.current = map
      setMapReady(true)
    }
    init()
    return () => { markersRef.current.forEach(m => { m.map = null }) }
  }, [])

  const [geocodeErrors, setGeocodeErrors] = useState<Record<string, string>>({})
  const [geocodeProgress, setGeocodeProgress] = useState({ current: 0, total: 0 })

  // Geocode
  async function geocodeAll() {
    setGeocoding(true)
    await loadPlaces()
    const updated = [...allJobs]
    const errors: Record<string, string> = {}
    const needsGeo = updated.filter(j => (!j.lat || !j.lng) && j.address)
    setGeocodeProgress({ current: 0, total: needsGeo.length })

    let completed = 0
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].lat && updated[i].lng) continue
      if (!updated[i].address) {
        errors[updated[i].id] = 'No address on record'
        continue
      }
      const result = await geocodeAddress(updated[i].address)
      if (result.coords) {
        updated[i] = { ...updated[i], lat: result.coords.lat, lng: result.coords.lng }
        if (updated[i].source === 'jobs') updateJob(updated[i].id, { lat: result.coords.lat, lng: result.coords.lng })
      } else {
        errors[updated[i].id] = result.error || 'Unknown error'
      }
      completed++
      setGeocodeProgress({ current: completed, total: needsGeo.length })
      if (i < updated.length - 1) await new Promise(r => setTimeout(r, 200))
    }
    setAllJobs(updated)
    setGeocodeErrors(errors)
    setGeocoding(false)
  }

  // Auto-geocode when map is ready and there are unplotted jobs with addresses
  useEffect(() => {
    if (mapReady && allJobs.length > 0 && !geocoding) {
      const needsGeo = allJobs.filter(j => (!j.lat || !j.lng) && j.address && j.address.trim().length >= 5)
      if (needsGeo.length > 0) geocodeAll()
    }
  }, [mapReady]) // eslint-disable-line react-hooks/exhaustive-deps

  const geoJobs = useMemo(() => allJobs.filter(j => j.lat && j.lng), [allJobs])
  const noGeoJobs = allJobs.filter(j => !j.lat || !j.lng)

  // Filter
  const filtered = useMemo(() => {
    let list = allJobs
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(j => j.customerName.toLowerCase().includes(q) || j.address.toLowerCase().includes(q) || j.fenceType.toLowerCase().includes(q))
    }
    if (filterType !== 'all') {
      list = list.filter(j => {
        const ft = j.fenceType?.toLowerCase() || ''
        if (filterType === 'vinyl') return ft.includes('vinyl') || ft.startsWith('wv') || ft.startsWith('tv')
        if (filterType === 'chainlink') return ft.includes('chain') || ft.startsWith('cl')
        if (filterType === 'aluminum') return ft.includes('alum')
        if (filterType === 'tearout') return j.tearOut
        if (filterType === 'ready') return j.materialsStatus === 'received' || j.materialsStatus === 'loaded'
        return true
      })
    }
    return list
  }, [allJobs, search, filterType])

  // Clusters
  const clusters = useMemo(() =>
    showClusters ? clusterByDistance(geoJobs, j => j.lat && j.lng ? { lat: j.lat, lng: j.lng } : null, radius) : [],
    [geoJobs, radius, showClusters]
  )

  // Map rendering
  const renderMap = useCallback(() => {
    if (!mapInstanceRef.current || !mapReady) return
    const map = mapInstanceRef.current

    markersRef.current.forEach(m => { m.map = null })
    markersRef.current = []

    const visibleGeo = filtered.filter(j => j.lat && j.lng)
    if (visibleGeo.length === 0) return

    const bounds = new google.maps.LatLngBounds()
    visibleGeo.forEach(j => bounds.extend({ lat: j.lat!, lng: j.lng! }))
    map.fitBounds(bounds, 60)

    if (showClusters && clusters.length > 0) {
      // Cluster mode: color by group
      clusters.forEach((cluster, ci) => {
        const color = CLUSTER_COLORS[ci % CLUSTER_COLORS.length]
        cluster.items.forEach(job => renderJobMarker(map, job, color, ci))
        // Centroid label
        if (cluster.items.length > 1) {
          const el = document.createElement('div')
          el.style.cssText = `background:${color};color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;box-shadow:0 1px 3px rgba(0,0,0,0.3);cursor:pointer;white-space:nowrap;`
          el.textContent = `Group ${ci + 1}: ${cluster.items.length} jobs`
          el.onclick = () => setSelectedCluster(ci === selectedCluster ? null : ci)
          const m = new google.maps.marker.AdvancedMarkerElement({ map, position: cluster.centroid, content: el })
          markersRef.current.push(m)
        }
      })
    } else {
      // Individual mode: color by readiness
      visibleGeo.forEach(job => {
        let color = '#94a3b8' // gray default
        if (job.materialsStatus === 'loaded') color = '#16a34a'      // green — ready to go
        else if (job.materialsStatus === 'received') color = '#22c55e' // light green
        else if (job.materialsStatus === 'ordered') color = '#3b82f6'  // blue — waiting
        else color = '#f97316'                                         // orange — needs attention

        if (job.tearOut) color = '#8b5cf6' // purple for tear-out jobs
        if (job.stagingStatus === 'on_hold' || job.stagingStatus === 'Customer Delay' || job.stagingStatus === 'Hold (HOA)') color = '#6b7280' // gray for holds

        renderJobMarker(map, job, color, null)
      })
    }
  }, [filtered, clusters, showClusters, mapReady, selectedCluster, selectedJobId])

  function renderJobMarker(map: google.maps.Map, job: SchedulableJob, color: string, _clusterIdx: number | null) {
    if (!job.lat || !job.lng) return
    const isSelected = job.id === selectedJobId

    const el = document.createElement('div')
    el.style.cssText = `
      width:${isSelected ? 22 : 14}px;height:${isSelected ? 22 : 14}px;
      background:${color};border:2px solid white;border-radius:50%;
      box-shadow:0 1px 4px rgba(0,0,0,0.3);cursor:pointer;
      ${isSelected ? 'outline:3px solid ' + color + ';outline-offset:2px;' : ''}
    `
    el.title = `${job.customerName} — ${job.address}\n${job.fenceType} · ${job.sections} sections\nStage: ${job.stagingStatus || 'staging'}${job.scheduledDate ? '\nScheduled: ' + job.scheduledDate : ''}`
    el.onclick = () => setSelectedJobId(job.id === selectedJobId ? null : job.id)

    const marker = new google.maps.marker.AdvancedMarkerElement({
      map, position: { lat: job.lat, lng: job.lng }, content: el,
    })
    markersRef.current.push(marker)

    // Name label for selected job
    if (isSelected) {
      const labelEl = document.createElement('div')
      labelEl.style.cssText = `background:${color};color:white;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.3);margin-top:-30px;`
      labelEl.textContent = `${job.customerName} · ${job.sections} sec`
      const lm = new google.maps.marker.AdvancedMarkerElement({
        map, position: { lat: job.lat + 0.0002, lng: job.lng }, content: labelEl,
      })
      markersRef.current.push(lm)
    }
  }

  useEffect(() => { renderMap() }, [renderMap])

  // Schedule actions
  function scheduleJob(jobId: string) {
    if (!crewName || !startDate) return
    const job = allJobs.find(j => j.id === jobId)
    if (!job) return
    if (job.source === 'jobs') {
      updateJob(jobId, { status: 'scheduled', crewAssigned: crewName, scheduledDate: startDate })
    }
    setApplied(`Scheduled ${job.customerName}`)
    setTimeout(() => { setApplied(''); setAllJobs(loadSchedulableJobs()) }, 1500)
  }

  function scheduleCluster(ci: number) {
    if (!crewName || !startDate) return
    const cluster = clusters[ci]
    if (!cluster) return
    let dateOffset = 0
    cluster.items.forEach(job => {
      const d = new Date(startDate)
      d.setDate(d.getDate() + dateOffset)
      if (job.source === 'jobs') {
        updateJob(job.id, { status: 'scheduled', crewAssigned: crewName, scheduledDate: d.toISOString().slice(0, 10) })
      }
      dateOffset += job.estimatedDays
    })
    setApplied(`Scheduled ${cluster.items.length} jobs`)
    setTimeout(() => { setApplied(''); setAllJobs(loadSchedulableJobs()); setSelectedCluster(null) }, 1500)
  }

  const selectedJob = allJobs.find(j => j.id === selectedJobId) || null

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/80 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-gray-900">Smart Schedule</h2>
          <span className="text-xs text-gray-400">{allJobs.length} jobs available · {geoJobs.length} on map</span>
        </div>
        <div className="flex items-center gap-3">
          {applied && <span className="text-green-600 font-semibold text-sm">{applied}</span>}
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2">×</button>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* ── LEFT: Job list sidebar ── */}
        <div className="w-80 bg-white border-r border-gray-200 flex flex-col shrink-0">
          {/* Search + filters */}
          <div className="p-3 border-b border-gray-100 space-y-2">
            <input className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
              placeholder="Search jobs..." value={search} onChange={e => setSearch(e.target.value)} />
            <div className="flex gap-1 flex-wrap">
              {[
                { key: 'all', label: 'All' },
                { key: 'ready', label: 'Ready' },
                { key: 'vinyl', label: 'Vinyl' },
                { key: 'chainlink', label: 'CL' },
                { key: 'aluminum', label: 'Alum' },
                { key: 'tearout', label: 'Tear Out' },
              ].map(f => (
                <button key={f.key} onClick={() => setFilterType(f.key)}
                  className={`text-[10px] px-2 py-1 rounded-full font-semibold ${filterType === f.key ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {/* Geocode + cluster controls */}
          <div className="p-3 border-b border-gray-100 space-y-2">
            {noGeoJobs.length > 0 && (
              <div className="space-y-1.5">
                <button onClick={geocodeAll} disabled={geocoding}
                  className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-300 text-white font-semibold text-xs py-1.5 rounded-lg">
                  {geocoding
                    ? `Locating... ${geocodeProgress.current}/${geocodeProgress.total}`
                    : `📍 Locate ${noGeoJobs.length} jobs on map`}
                </button>
                {Object.keys(geocodeErrors).length > 0 && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs">
                    <p className="font-semibold text-red-700 mb-1">{Object.keys(geocodeErrors).length} jobs couldn't be located:</p>
                    <div className="max-h-24 overflow-y-auto space-y-0.5">
                      {noGeoJobs.filter(j => geocodeErrors[j.id]).map(j => (
                        <p key={j.id} className="text-red-600 truncate">
                          <span className="font-medium">{j.customerName}</span>: {geocodeErrors[j.id]}
                        </p>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2">
              <button onClick={() => setShowClusters(!showClusters)}
                className={`flex-1 text-xs py-1.5 rounded-lg font-semibold border ${showClusters ? 'bg-orange-50 border-orange-300 text-orange-700' : 'border-gray-200 text-gray-500'}`}>
                {showClusters ? 'Clusters ON' : 'Show Groups'}
              </button>
              {showClusters && (
                <div className="flex items-center gap-1">
                  <input type="range" min={1} max={20} value={radius} onChange={e => setRadius(parseInt(e.target.value))}
                    className="w-16 accent-orange-500" />
                  <span className="text-[10px] text-gray-500 w-8">{radius}mi</span>
                </div>
              )}
            </div>
          </div>

          {/* Assign controls */}
          <div className="p-3 border-b border-gray-100 flex gap-2">
            <input className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-xs" placeholder="Crew..."
              value={crewName} onChange={e => setCrewName(e.target.value)} />
            <input type="date" className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs w-32"
              value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>

          {/* Cluster summary (when clusters are on) */}
          {showClusters && clusters.length > 0 && (
            <div className="p-3 border-b border-gray-100 space-y-1.5">
              <p className="text-[10px] font-bold text-gray-400 uppercase">{clusters.length} groups</p>
              {clusters.map((cl, ci) => {
                const color = CLUSTER_COLORS[ci % CLUSTER_COLORS.length]
                const isSel = selectedCluster === ci
                return (
                  <div key={ci} onClick={() => setSelectedCluster(isSel ? null : ci)}
                    className={`rounded-lg p-2 cursor-pointer border transition-all ${isSel ? 'border-current shadow' : 'border-gray-100 hover:border-gray-200'}`}
                    style={isSel ? { borderColor: color } : {}}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                        <span className="text-xs font-bold text-gray-900">Group {ci + 1}</span>
                      </div>
                      <span className="text-[10px] text-gray-400">{cl.items.length} jobs · {cl.items.reduce((s, j) => s + j.sections, 0)} sec</span>
                    </div>
                    {isSel && crewName && startDate && (
                      <button onClick={e => { e.stopPropagation(); scheduleCluster(ci) }}
                        className="w-full mt-1.5 bg-orange-500 text-white text-[10px] font-semibold py-1 rounded">
                        Schedule group → {crewName}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Job list */}
          <div className="flex-1 overflow-y-auto">
            {filtered.map(job => {
              const tags = getJobTags(job)
              const isSel = job.id === selectedJobId
              return (
                <div key={job.id}
                  onClick={() => { setSelectedJobId(isSel ? null : job.id); if (job.lat && job.lng && mapInstanceRef.current) mapInstanceRef.current.panTo({ lat: job.lat, lng: job.lng }) }}
                  className={`px-3 py-2.5 border-b border-gray-50 cursor-pointer transition-colors ${isSel ? 'bg-orange-50 border-l-2 border-l-orange-500' : 'hover:bg-gray-50'}`}>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900 truncate">{job.customerName}</p>
                    <span className="text-xs font-bold text-gray-500 shrink-0 ml-2">{job.sections} sec</span>
                  </div>
                  <p className="text-[10px] text-gray-400 truncate">{job.address || 'No address'}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {tags.map((t, i) => (
                      <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${t.bg} ${t.text}`}>{t.label}</span>
                    ))}
                  </div>
                  {isSel && crewName && startDate && (
                    <button onClick={e => { e.stopPropagation(); scheduleJob(job.id) }}
                      className="w-full mt-2 bg-orange-500 text-white text-xs font-semibold py-1.5 rounded-lg">
                      Schedule → {crewName} on {startDate}
                    </button>
                  )}
                </div>
              )
            })}
            {filtered.length === 0 && (
              <div className="text-center py-8 text-xs text-gray-400">
                {allJobs.length === 0 ? 'No jobs in staging' : 'No jobs match filter'}
              </div>
            )}
          </div>
        </div>

        {/* ── RIGHT: Map ── */}
        <div className="flex-1 relative">
          <div ref={mapRef} className="w-full h-full" />

          {/* Legend */}
          <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur rounded-lg px-3 py-2 shadow-lg text-[10px] space-y-1">
            <p className="font-bold text-gray-500 uppercase">Map Legend</p>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-green-500" /> Ready / Loaded</div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-blue-500" /> Materials Ordered</div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-orange-500" /> Needs Attention</div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-purple-500" /> Tear Out</div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-gray-400" /> On Hold</div>
          </div>

          {/* Selected job detail */}
          {selectedJob && (
            <div className="absolute top-4 right-4 bg-white rounded-xl shadow-lg border border-gray-200 w-72 p-4">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-bold text-gray-900 text-sm">{selectedJob.customerName}</h3>
                <button onClick={() => setSelectedJobId(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
              </div>
              <p className="text-xs text-gray-500 mb-2">{selectedJob.address}</p>
              <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400">Style:</span> <span className="font-semibold">{selectedJob.fenceType}</span></div>
                <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400">Sections:</span> <span className="font-semibold">{selectedJob.sections}</span></div>
                <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400">Est Days:</span> <span className="font-semibold">{selectedJob.estimatedDays}</span></div>
                <div className="bg-gray-50 rounded p-1.5"><span className="text-gray-400">Value:</span> <span className="font-semibold">{fmt(selectedJob.contractValue)}</span></div>
              </div>
              <div className="flex flex-wrap gap-1 mb-2">
                {getJobTags(selectedJob).map((t, i) => (
                  <span key={i} className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${t.bg} ${t.text}`}>{t.label}</span>
                ))}
              </div>
              {selectedJob.notes && <p className="text-[10px] text-gray-400 italic">{selectedJob.notes}</p>}
            </div>
          )}

          {!mapReady && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
              <p className="text-gray-500">Loading map...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
