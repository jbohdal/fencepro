import { useRef, useEffect, useCallback, useState } from 'react'
import L from 'leaflet'
import { distanceFeet } from './geoUtils'
import type { LatLng } from './geoUtils'
import AddressAutocomplete from './AddressAutocomplete'
import { lookupPosition } from './appointmentsStore'
import { createFreeMap, centeredIcon, aboveIcon, BaseToggle, type BaseKind, type FreeMap } from './freeMap'
import { prefetchAerial } from './aerialTiles'

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

// Free lookups: Marion County's address list on the Mac, then the US Census.
function AddressSearch({ onPlaceSelected }: { onPlaceSelected: (place: { address: string; location: LatLng }) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [missed, setMissed] = useState('')

  async function find(address: string, known?: { lat?: number; lng?: number }) {
    const a = address.trim()
    if (!a) return
    setMissed('')
    // The photo starts at once, before the map moves there.
    if (known?.lat != null && known?.lng != null) { prefetchAerial(known.lat, known.lng, { w: 1000, h: 700 }); onPlaceSelected({ address: a, location: { lat: known.lat, lng: known.lng } }); return }
    setBusy(true)
    try {
      const p = await lookupPosition(a)
      if (p) { prefetchAerial(p.lat, p.lng, { w: 1000, h: 700 }); onPlaceSelected({ address: a, location: { lat: p.lat, lng: p.lng } }) }
      else setMissed('Address not found. Pick a suggestion, or pan the map to the property.')
    } finally { setBusy(false) }
  }

  return (
    <form className="flex flex-wrap gap-2" onSubmit={e => { e.preventDefault(); find(text) }} data-map-quote-search>
      <AddressAutocomplete
        value={text}
        onChange={setText}
        onSelect={p => find(p.formatted, p)}
        placeholder="Enter property address..."
        wrapClassName="flex-1 min-w-0"
        className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        inputAttrs={{ 'data-map-quote-address': true }}
      />
      <button type="submit" disabled={busy || !text.trim()} className="shrink-0 min-h-[44px] px-4 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50 disabled:opacity-40">
        {busy ? '…' : 'Find'}
      </button>
      {missed && <p className="basis-full text-xs text-red-600" role="status">{missed}</p>}
    </form>
  )
}

/* ───────── Fence Map Drawing Tool ───────── */

function vertexIcon(isEnd: boolean, isCorner: boolean, title: string): L.DivIcon {
  const s = isEnd ? 16 : 14
  // A 32px touch target around the visible dot, so a post can be dragged with a thumb.
  return L.divIcon({
    className: '',
    html: `<div title="${title}" style="width:32px;height:32px;display:flex;align-items:center;justify-content:center;cursor:grab"><div style="width:${s}px;height:${s}px;background:${isCorner ? '#f59e0b' : '#f97316'};border:2px solid white;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div></div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  })
}

function FenceMapCanvas({
  center,
  propertyMarker,
  onPointsChange,
}: {
  center: LatLng
  propertyMarker?: { location: LatLng; address: string }
  onPointsChange: (points: LatLng[]) => void
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const freeRef = useRef<FreeMap | null>(null)
  const fenceLayerRef = useRef<L.LayerGroup | null>(null)
  const polylinesRef = useRef<L.Polyline[]>([])
  const propertyMarkerRef = useRef<L.Marker | null>(null)
  const pointsRef = useRef<LatLng[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [points, setPoints] = useState<LatLng[]>([])
  const [base, setBase] = useState<BaseKind>('aerial')

  const onPointsChangeRef = useRef(onPointsChange)
  onPointsChangeRef.current = onPointsChange

  const notify = useCallback((pts: LatLng[]) => {
    onPointsChangeRef.current(pts)
  }, [])

  // Render polylines and markers
  const renderFence = useCallback(() => {
    const group = fenceLayerRef.current
    if (!group) return
    const pts = pointsRef.current

    group.clearLayers()
    polylinesRef.current = []

    for (let i = 0; i < pts.length - 1; i++) {
      // Not interactive: a tap on a line places the next point, as on the bare map.
      const polyline = L.polyline([[pts[i].lat, pts[i].lng], [pts[i + 1].lat, pts[i + 1].lng]], {
        color: '#f97316', weight: 4, opacity: 0.9, interactive: false,
      }).addTo(group)
      polylinesRef.current.push(polyline)

      const midLat = (pts[i].lat + pts[i + 1].lat) / 2
      const midLng = (pts[i].lng + pts[i + 1].lng) / 2
      const feet = distanceFeet(pts[i], pts[i + 1])

      const labelEl = document.createElement('div')
      labelEl.style.cssText = 'background:#f97316;color:white;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,0.3);'
      labelEl.textContent = `Run ${i + 1}: ${feet.toFixed(1)} ft`
      L.marker([midLat, midLng], { icon: centeredIcon(labelEl), interactive: false, keyboard: false }).addTo(group)
    }

    pts.forEach((pt, i) => {
      const isEnd = i === 0 || i === pts.length - 1
      const isCorner = !isEnd && pts.length > 2

      const marker = L.marker([pt.lat, pt.lng], {
        icon: vertexIcon(isEnd, isCorner, isEnd ? 'End Post' : 'Corner Post'),
        draggable: true,
        zIndexOffset: 1000,
      }).addTo(group)

      const idx = i
      marker.on('drag', () => {
        const { lat, lng } = marker.getLatLng()
        pointsRef.current[idx] = { lat, lng }
        if (idx > 0 && polylinesRef.current[idx - 1]) {
          const a = pointsRef.current[idx - 1]
          polylinesRef.current[idx - 1].setLatLngs([[a.lat, a.lng], [lat, lng]])
        }
        if (idx < pointsRef.current.length - 1 && polylinesRef.current[idx]) {
          const b = pointsRef.current[idx + 1]
          polylinesRef.current[idx].setLatLngs([[lat, lng], [b.lat, b.lng]])
        }
      })

      marker.on('dragend', () => {
        setPoints([...pointsRef.current])
        notify(pointsRef.current)
        renderFence()
      })
    })
  }, [notify])

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || freeRef.current) return
    const fm = createFreeMap(mapRef.current, { center: [center.lat, center.lng], zoom: 19, base: 'aerial', loadingText: 'Loading the aerial photo…' })
    freeRef.current = fm
    fenceLayerRef.current = L.layerGroup().addTo(fm.map)

    fm.map.on('click', (e: L.LeafletMouseEvent) => {
      const newPoint: LatLng = { lat: e.latlng.lat, lng: e.latlng.lng }
      pointsRef.current = [...pointsRef.current, newPoint]
      setPoints([...pointsRef.current])
      notify(pointsRef.current)
      renderFence()
    })

    setIsLoaded(true)
    return () => {
      fm.destroy()
      freeRef.current = null
      fenceLayerRef.current = null
      polylinesRef.current = []
      propertyMarkerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the map is made once; `center` moves it below
  }, [])

  useEffect(() => { freeRef.current?.setBase(base) }, [base])

  useEffect(() => {
    if (freeRef.current && center.lat !== 0) {
      freeRef.current.map.setView([center.lat, center.lng], 19)
    }
  }, [center])

  // Render the property marker whenever `propertyMarker` changes
  useEffect(() => {
    const map = freeRef.current?.map
    if (!map) return
    // Remove existing
    if (propertyMarkerRef.current) { propertyMarkerRef.current.remove(); propertyMarkerRef.current = null }
    if (!propertyMarker) return

    const el = document.createElement('div')
    el.title = propertyMarker.address
    el.style.cssText = 'position:relative;width:32px;height:40px;'
    el.innerHTML = `
      <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter: drop-shadow(0 2px 4px rgba(0,0,0,0.35));">
        <path d="M16 2C9 2 3 7 3 14c0 9 13 24 13 24s13-15 13-24c0-7-6-12-13-12z" fill="#f97316" stroke="#fff" stroke-width="2"/>
        <circle cx="16" cy="14" r="5" fill="#fff"/>
      </svg>`
    // Not interactive, so a fence point can still be placed right at the pin.
    propertyMarkerRef.current = L.marker([propertyMarker.location.lat, propertyMarker.location.lng], {
      icon: aboveIcon(el), interactive: false, keyboard: false, title: propertyMarker.address,
    }).addTo(map)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redrawn when the pin's place or address changes
  }, [propertyMarker?.location.lat, propertyMarker?.location.lng, propertyMarker?.address])

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
    fenceLayerRef.current?.clearLayers()
    polylinesRef.current = []
    notify([])
  }

  const runLengths: number[] = []
  for (let i = 0; i < pointsRef.current.length - 1; i++) {
    runLengths.push(distanceFeet(pointsRef.current[i], pointsRef.current[i + 1]))
  }
  const totalFeet = runLengths.reduce((a, b) => a + b, 0)

  return (
    <div>
      <div className="relative map-layer">
        <div ref={mapRef} className="w-full h-[60vh] min-h-[320px] sm:h-[480px] rounded-xl border border-gray-200 z-0" data-map data-map-quote-map />

        {/* Controls */}
        <div className="absolute top-3 right-3 z-[500] flex flex-col gap-2">
          <button onClick={undoLastPoint} className="bg-white shadow-md rounded-lg px-3 min-h-[40px] text-sm font-medium hover:bg-gray-50" data-map-quote-undo>Undo</button>
          <button onClick={clearAll} className="bg-white shadow-md rounded-lg px-3 min-h-[40px] text-sm font-medium hover:bg-gray-50 text-red-600" data-map-quote-clear>Clear</button>
        </div>
        <BaseToggle base={base} onChange={setBase} className="absolute bottom-3 left-3" />

        {!isLoaded && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100 rounded-xl">
            <div className="text-gray-500">Loading map...</div>
          </div>
        )}
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
        Tap the map to place fence points. Each segment = one run. Orange dots = end posts. Yellow = corner posts. Drag to adjust.
        Aerial photos are Esri World Imagery when set up (else USGS NAIP, free), the same as the quote drawing; the map stops at their sharpest zoom. Measurements stay exact.
      </p>
    </div>
  )
}

/* ═══════════════════════════════════════════════
   MAP QUOTE BUILDER — full-screen modal
   ═══════════════════════════════════════════════ */

export default function MapQuoteBuilder({ onUseData, onClose }: MapQuoteBuilderProps) {
  const [address, setAddress] = useState('')
  const [center, setCenter] = useState<LatLng>({ lat: 29.1872, lng: -82.1401 }) // Ocala, FL default
  const [hasSelection, setHasSelection] = useState(false)
  const [mapPoints, setMapPoints] = useState<LatLng[]>([])

  function handlePlaceSelected(place: { address: string; location: LatLng }) {
    setAddress(place.address)
    setCenter(place.location)
    setHasSelection(true)
  }

  function handleClearSelection() {
    setAddress('')
    setHasSelection(false)
    setMapPoints([])
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
    <div className="fixed inset-0 z-50 bg-gray-900/80 flex flex-col" data-map-quote>
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-3 sm:px-6 py-2 sm:py-3 flex flex-wrap items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-4 min-w-0">
          <h2 className="text-lg font-bold text-gray-900">Map Quote</h2>
          <span className="hidden sm:inline text-xs text-gray-400">Draw fence lines on the aerial map</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {runs.length > 0 && (
            <div className="hidden sm:flex items-center gap-2 text-sm">
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
            className="btn btn-primary"
            data-map-quote-use
          >
            Use in Quote Builder
          </button>
          <button onClick={onClose} className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-gray-600 text-xl leading-none px-2">×</button>
        </div>
        {runs.length > 0 && (
          <div className="sm:hidden basis-full text-xs text-gray-500">
            {runs.length} runs · <span className="font-bold text-orange-600">{totalFeet.toFixed(0)} ft</span> · {corners} corners, {ends} ends
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        <div className="max-w-5xl mx-auto space-y-4">
          {/* Address search */}
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
            <div className="flex items-center gap-3">
              <span className="text-lg">📍</span>
              <div className="flex-1 min-w-0">
                <AddressSearch onPlaceSelected={handlePlaceSelected} />
              </div>
            </div>
            {hasSelection && address && (
              <div className="mt-3 flex items-center gap-3 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2.5">
                <span className="text-orange-500 text-lg shrink-0">🏠</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-orange-600">Selected Property</p>
                  <p className="text-sm font-medium text-gray-900 truncate" title={address}>{address}</p>
                </div>
                <button onClick={handleClearSelection}
                  className="min-w-[48px] min-h-[48px] inline-grid place-items-center text-gray-400 hover:text-red-500 text-xl leading-none px-2"
                  title="Clear selection">×</button>
              </div>
            )}
          </div>

          {/* Map */}
          <div className="bg-white rounded-xl border border-gray-200 p-2 sm:p-4">
            <FenceMapCanvas center={center} propertyMarker={hasSelection ? { location: center, address } : undefined} onPointsChange={handlePointsChange} />
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
