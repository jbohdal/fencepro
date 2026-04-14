import { useRef, useEffect, useCallback, useState } from 'react'
import { loadMaps, loadPlaces, loadMarker, loadGeometry } from './mapsLoader'
import { distanceFeet } from './geoUtils'
import type { LatLng } from './geoUtils'

/* ───────── types ───────── */

export interface MapFenceData {
  address: string
  coordinates: LatLng
  runs: { lengthFeet: number }[]
  corners: number
  ends: number
  totalFeet: number
  // For site plan
  points: LatLng[]
}

interface MapQuoteBuilderProps {
  onUseData: (data: MapFenceData) => void
  onClose: () => void
}

/* ───────── Address Search ───────── */

function AddressSearch({ onPlaceSelected }: { onPlaceSelected: (place: { address: string; location: LatLng }) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    async function init() {
      if (!inputRef.current) return
      await loadPlaces()

      const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
        types: ['address'],
        componentRestrictions: { country: 'us' },
        fields: ['formatted_address', 'geometry'],
      })

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        if (place.geometry?.location) {
          onPlaceSelected({
            address: place.formatted_address || '',
            location: { lat: place.geometry.location.lat(), lng: place.geometry.location.lng() },
          })
        }
      })
      setLoaded(true)
    }
    init()
  }, [onPlaceSelected])

  return (
    <input
      ref={inputRef}
      type="text"
      placeholder={loaded ? 'Enter property address...' : 'Loading maps...'}
      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
    />
  )
}

/* ───────── Fence Map Drawing Tool ───────── */

function FenceMapCanvas({
  center,
  onPointsChange,
}: {
  center: LatLng
  onPointsChange: (points: LatLng[]) => void
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<google.maps.Map | null>(null)
  const polylinesRef = useRef<google.maps.Polyline[]>([])
  const vertexMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  const labelMarkersRef = useRef<google.maps.marker.AdvancedMarkerElement[]>([])
  const pointsRef = useRef<LatLng[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [points, setPoints] = useState<LatLng[]>([])

  const onPointsChangeRef = useRef(onPointsChange)
  onPointsChangeRef.current = onPointsChange

  const notify = useCallback((pts: LatLng[]) => {
    onPointsChangeRef.current(pts)
  }, [])

  // Render polylines and markers
  const renderFence = useCallback(() => {
    if (!mapInstanceRef.current) return
    const map = mapInstanceRef.current
    const pts = pointsRef.current

    polylinesRef.current.forEach(p => p.setMap(null))
    polylinesRef.current = []
    vertexMarkersRef.current.forEach(m => { m.map = null })
    vertexMarkersRef.current = []
    labelMarkersRef.current.forEach(m => { m.map = null })
    labelMarkersRef.current = []

    for (let i = 0; i < pts.length - 1; i++) {
      const polyline = new google.maps.Polyline({
        map,
        path: [pts[i], pts[i + 1]],
        strokeColor: '#f97316',
        strokeWeight: 4,
        strokeOpacity: 0.9,
      })
      polylinesRef.current.push(polyline)

      const midLat = (pts[i].lat + pts[i + 1].lat) / 2
      const midLng = (pts[i].lng + pts[i + 1].lng) / 2
      const feet = distanceFeet(pts[i], pts[i + 1])

      const labelEl = document.createElement('div')
      labelEl.style.cssText = 'background:#f97316;color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.3);'
      labelEl.textContent = `Run ${i + 1}: ${feet.toFixed(1)} ft`

      const labelMarker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: { lat: midLat, lng: midLng },
        content: labelEl,
      })
      labelMarkersRef.current.push(labelMarker)
    }

    pts.forEach((pt, i) => {
      const isEnd = i === 0 || i === pts.length - 1
      const isCorner = !isEnd && pts.length > 2

      const el = document.createElement('div')
      el.style.cssText = `width:${isEnd ? 16 : 14}px;height:${isEnd ? 16 : 14}px;background:${isCorner ? '#f59e0b' : '#f97316'};border:2px solid white;border-radius:50%;cursor:grab;box-shadow:0 1px 3px rgba(0,0,0,0.3);`
      el.title = isEnd ? 'End Post' : 'Corner Post'

      const marker = new google.maps.marker.AdvancedMarkerElement({
        map,
        position: pt,
        content: el,
        gmpDraggable: true,
      })

      const idx = i
      marker.addListener('drag', () => {
        const p = marker.position
        if (p) {
          const lat = typeof p.lat === 'function' ? (p as google.maps.LatLng).lat() : (p.lat as number)
          const lng = typeof p.lng === 'function' ? (p as google.maps.LatLng).lng() : (p.lng as number)
          pointsRef.current[idx] = { lat, lng }

          if (idx > 0 && polylinesRef.current[idx - 1]) {
            polylinesRef.current[idx - 1].setPath([pointsRef.current[idx - 1], { lat, lng }])
          }
          if (idx < pointsRef.current.length - 1 && polylinesRef.current[idx]) {
            polylinesRef.current[idx].setPath([{ lat, lng }, pointsRef.current[idx + 1]])
          }
        }
      })

      marker.addListener('dragend', () => {
        setPoints([...pointsRef.current])
        notify(pointsRef.current)
        renderFence()
      })

      vertexMarkersRef.current.push(marker)
    })
  }, [notify])

  // Initialize map
  useEffect(() => {
    async function init() {
      if (!mapRef.current) return
      const { Map } = await loadMaps()
      await loadMarker()
      await loadGeometry()

      const map = new Map(mapRef.current, {
        center,
        zoom: 19,
        mapTypeId: 'satellite',
        tilt: 0,
        mapId: 'fence-map-crm',
        disableDefaultUI: false,
        zoomControl: true,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
      })

      mapInstanceRef.current = map

      map.addListener('click', (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return
        const newPoint: LatLng = { lat: e.latLng.lat(), lng: e.latLng.lng() }
        pointsRef.current = [...pointsRef.current, newPoint]
        setPoints([...pointsRef.current])
        notify(pointsRef.current)
        renderFence()
      })

      setIsLoaded(true)
    }
    init()
    return () => {
      polylinesRef.current.forEach(p => p.setMap(null))
      vertexMarkersRef.current.forEach(m => { m.map = null })
      labelMarkersRef.current.forEach(m => { m.map = null })
    }
  }, [])

  useEffect(() => {
    if (mapInstanceRef.current && center.lat !== 0) {
      mapInstanceRef.current.panTo(center)
      mapInstanceRef.current.setZoom(19)
    }
  }, [center])

  function undoLastPoint() {
    if (pointsRef.current.length === 0) return
    pointsRef.current = pointsRef.current.slice(0, -1)
    setPoints([...pointsRef.current])
    notify(pointsRef.current)
    renderFence()
  }

  function clearAll() {
    pointsRef.current = []
    setPoints([])
    polylinesRef.current.forEach(p => p.setMap(null))
    polylinesRef.current = []
    vertexMarkersRef.current.forEach(m => { m.map = null })
    vertexMarkersRef.current = []
    labelMarkersRef.current.forEach(m => { m.map = null })
    labelMarkersRef.current = []
    notify([])
  }

  const runLengths: number[] = []
  for (let i = 0; i < pointsRef.current.length - 1; i++) {
    runLengths.push(distanceFeet(pointsRef.current[i], pointsRef.current[i + 1]))
  }
  const totalFeet = runLengths.reduce((a, b) => a + b, 0)

  return (
    <div className="relative">
      <div ref={mapRef} className="w-full h-[480px] rounded-xl border border-gray-200" />

      {/* Controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-2">
        <button onClick={undoLastPoint} className="bg-white shadow-md rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-50">Undo</button>
        <button onClick={clearAll} className="bg-white shadow-md rounded-lg px-3 py-2 text-sm font-medium hover:bg-gray-50 text-red-600">Clear</button>
      </div>

      {/* Stats */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="bg-orange-50 border border-orange-200 rounded-lg px-4 py-2">
          <span className="text-sm text-orange-600">Total: </span>
          <span className="text-lg font-bold text-orange-700">{totalFeet.toFixed(1)} ft</span>
        </div>
        <div className="bg-gray-50 border border-gray-200 rounded-lg px-4 py-2">
          <span className="text-sm text-gray-500">Runs: </span>
          <span className="font-medium">{runLengths.length}</span>
        </div>
        {points.length > 2 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
            <span className="text-sm text-amber-600">Corners: </span>
            <span className="font-medium text-amber-700">{points.length - 2}</span>
          </div>
        )}
        {points.length >= 2 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
            <span className="text-sm text-blue-600">Ends: </span>
            <span className="font-medium text-blue-700">2</span>
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 mt-2">
        Click on the map to place fence points. Each segment = one run. Orange dots = end posts. Yellow = corner posts. Drag to adjust.
      </p>

      {!isLoaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-xl">
          <div className="text-gray-500">Loading map...</div>
        </div>
      )}
    </div>
  )
}

/* ═══════════════════════════════════════════════
   MAP QUOTE BUILDER — full-screen modal
   ═══════════════════════════════════════════════ */

export default function MapQuoteBuilder({ onUseData, onClose }: MapQuoteBuilderProps) {
  const [address, setAddress] = useState('')
  const [center, setCenter] = useState<LatLng>({ lat: 29.1872, lng: -82.1401 }) // Ocala, FL default
  const [mapPoints, setMapPoints] = useState<LatLng[]>([])

  function handlePlaceSelected(place: { address: string; location: LatLng }) {
    setAddress(place.address)
    setCenter(place.location)
  }

  function handlePointsChange(pts: LatLng[]) {
    setMapPoints([...pts])
  }

  const runs: { lengthFeet: number }[] = []
  for (let i = 0; i < mapPoints.length - 1; i++) {
    runs.push({ lengthFeet: distanceFeet(mapPoints[i], mapPoints[i + 1]) })
  }
  const corners = mapPoints.length > 2 ? mapPoints.length - 2 : 0
  const ends = mapPoints.length >= 2 ? 2 : 0
  const totalFeet = runs.reduce((s, r) => s + r.lengthFeet, 0)

  function handleUse() {
    if (runs.length === 0) return
    onUseData({
      address,
      coordinates: center,
      runs,
      corners,
      ends,
      totalFeet,
      points: mapPoints,
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-900/80 flex flex-col">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-gray-900">Map Quote</h2>
          <span className="text-xs text-gray-400">Draw fence lines on the satellite map</span>
        </div>
        <div className="flex items-center gap-3">
          {runs.length > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500">{runs.length} runs</span>
              <span className="text-gray-300">·</span>
              <span className="font-bold text-orange-600">{totalFeet.toFixed(0)} ft</span>
              <span className="text-gray-300">·</span>
              <span className="text-gray-500">{corners} corners, {ends} ends</span>
            </div>
          )}
          <button
            onClick={handleUse}
            disabled={runs.length === 0}
            className="bg-orange-500 hover:bg-orange-600 disabled:bg-gray-200 disabled:text-gray-400 text-white font-semibold text-sm px-5 py-2 rounded-lg transition-colors"
          >
            Use in Quote Builder
          </button>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none px-2">×</button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* Address search */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <span className="text-lg">📍</span>
              <div className="flex-1">
                <AddressSearch onPlaceSelected={handlePlaceSelected} />
              </div>
            </div>
            {address && (
              <p className="text-sm text-gray-600 mt-2 ml-9">{address}</p>
            )}
          </div>

          {/* Map */}
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <FenceMapCanvas center={center} onPointsChange={handlePointsChange} />
          </div>

          {/* Run details */}
          {runs.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="font-semibold text-gray-900 mb-3">Fence Runs</h3>
              <div className="space-y-2">
                {runs.map((r, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50">
                    <span className="text-sm text-gray-700">Run {i + 1}</span>
                    <span className="text-sm font-bold text-gray-900">{r.lengthFeet.toFixed(1)} ft</span>
                  </div>
                ))}
                <div className="flex items-center justify-between pt-2 font-bold">
                  <span className="text-sm text-gray-900">Total</span>
                  <span className="text-lg text-orange-600">{totalFeet.toFixed(1)} ft</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
