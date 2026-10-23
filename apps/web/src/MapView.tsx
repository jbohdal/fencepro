/**
 * A small map for appointments: OpenStreetMap tiles drawn by Leaflet, free
 * and with no key. Points are numbered circles in their type's colour. One
 * point can be draggable, to put a property in the right place when the
 * address lookup is off (rural addresses); the new position is reported back.
 */

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// Every map sits in its own layer, under the page's menus and dialogs (layers.css).
import './layers.css'

export interface MapPoint {
  id: string
  lat: number
  lng: number
  /** Shown inside the circle, e.g. its place in the day. */
  label: string
  color: string
  /** Shown when the point is tapped. */
  title: string
  draggable?: boolean
}

// Middle of Marion County, for a map with nothing on it yet.
const OCALA: [number, number] = [29.1872, -82.1401]

export default function MapView({ points, height = 260, onMove, className = '' }: {
  points: MapPoint[]
  height?: number
  /** Called when a draggable point is let go somewhere new. */
  onMove?: (id: string, lat: number, lng: number) => void
  className?: string
}) {
  const box = useRef<HTMLDivElement | null>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const moveRef = useRef(onMove)
  useEffect(() => { moveRef.current = onMove })

  useEffect(() => {
    if (!box.current || map.current) return
    // No zoom animations: a map closed mid-animation (a dialog shut quickly) would otherwise throw.
    const m = L.map(box.current, { zoomControl: true, attributionControl: true, zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false }).setView(OCALA, 10)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    // The map is often drawn inside a dialog that is still sizing itself.
    const t = setTimeout(() => { if (map.current === m) m.invalidateSize() }, 150)
    return () => { clearTimeout(t); m.stop(); m.off(); m.remove(); map.current = null; layer.current = null }
  }, [])

  const key = JSON.stringify(points.map(p => [p.id, p.lat, p.lng, p.label, p.color, p.draggable]))
  useEffect(() => {
    const m = map.current, g = layer.current
    if (!m || !g) return
    g.clearLayers()
    for (const p of points) {
      const icon = L.divIcon({
        className: '',
        html: `<div style="background:${p.color};color:#fff;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);border-radius:9999px;width:${p.draggable ? 30 : 24}px;height:${p.draggable ? 30 : 24}px;display:flex;align-items:center;justify-content:center;font:700 12px system-ui;cursor:${p.draggable ? 'grab' : 'pointer'}">${p.label}</div>`,
        iconSize: p.draggable ? [30, 30] : [24, 24],
        iconAnchor: p.draggable ? [15, 15] : [12, 12],
      })
      const mk = L.marker([p.lat, p.lng], { icon, draggable: !!p.draggable, title: p.title, zIndexOffset: p.draggable ? 1000 : 0 })
      mk.bindPopup(p.title)
      if (p.draggable) mk.on('dragend', () => { const ll = mk.getLatLng(); moveRef.current?.(p.id, ll.lat, ll.lng) })
      mk.addTo(g)
    }
    if (points.length === 1) m.setView([points[0].lat, points[0].lng], 14)
    else if (points.length > 1) m.fitBounds(L.latLngBounds(points.map(p => [p.lat, p.lng] as [number, number])), { padding: [24, 24], maxZoom: 14 })
    else m.setView(OCALA, 10)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redrawn when what is drawn changes (key)
  }, [key])

  return <div ref={box} className={`rounded-xl overflow-hidden border border-gray-200 z-0 ${className}`} style={{ height }} data-map />
}
