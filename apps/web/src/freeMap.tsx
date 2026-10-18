/**
 * Free maps for the drawing and planning tools: Leaflet with no key and no
 * paid account. Two base layers:
 *  - street: OpenStreetMap tiles
 *  - aerial: USGS The National Map imagery (public domain). Its tiles stop at
 *    zoom 16, so closer zooms are the zoom-16 picture enlarged. Points placed
 *    on the map are exact at any zoom; only the picture gets softer.
 */

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

export type BaseKind = 'aerial' | 'street'

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
// Note the order: {y} before {x}.
export const USGS_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'
export const USGS_ATTRIBUTION = 'USGS The National Map'

export const MAX_ZOOM = 20

export interface FreeMap {
  map: L.Map
  setBase: (kind: BaseKind) => void
  destroy: () => void
}

export function createFreeMap(el: HTMLElement, opts: { center: [number, number]; zoom: number; base: BaseKind; doubleClickZoom?: boolean }): FreeMap {
  // No zoom animations: a map closed mid-animation (a dialog shut quickly) would otherwise throw.
  const map = L.map(el, {
    zoomControl: true, attributionControl: true,
    zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
    doubleClickZoom: opts.doubleClickZoom ?? true,
    maxZoom: MAX_ZOOM,
  }).setView(opts.center, opts.zoom)

  const street = L.tileLayer(OSM_TILES, { maxNativeZoom: 19, maxZoom: MAX_ZOOM, attribution: OSM_ATTRIBUTION })
  const aerial = L.tileLayer(USGS_TILES, { maxNativeZoom: 16, maxZoom: MAX_ZOOM, attribution: USGS_ATTRIBUTION })
  let current: L.TileLayer = opts.base === 'aerial' ? aerial : street
  current.addTo(map)

  // The map often sits in a dialog or a panel that is still sizing itself.
  const t = setTimeout(() => map.invalidateSize(), 150)
  let ro: ResizeObserver | null = null
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => map.invalidateSize())
    ro.observe(el)
  }

  return {
    map,
    setBase(kind) {
      const next = kind === 'aerial' ? aerial : street
      if (next === current) return
      map.removeLayer(current)
      next.addTo(map)
      next.bringToBack()
      current = next
    },
    destroy() {
      clearTimeout(t)
      ro?.disconnect()
      map.stop(); map.off(); map.remove()
    },
  }
}

/** A marker icon whose content (any size) is centred on the point. */
export function centeredIcon(content: HTMLElement): L.DivIcon {
  const wrap = document.createElement('div')
  wrap.style.cssText = 'position:absolute;left:0;top:0;transform:translate(-50%,-50%);'
  wrap.appendChild(content)
  return L.divIcon({ className: '', html: wrap, iconSize: [0, 0], iconAnchor: [0, 0] })
}

/** A marker icon whose content sits above the point, its bottom centre on it (pins, name tags). */
export function aboveIcon(content: HTMLElement, gap = 0): L.DivIcon {
  const wrap = document.createElement('div')
  wrap.style.cssText = `position:absolute;left:0;bottom:${gap}px;transform:translateX(-50%);`
  wrap.appendChild(content)
  return L.divIcon({ className: '', html: wrap, iconSize: [0, 0], iconAnchor: [0, 0] })
}

/** Aerial / Street switch drawn over a map. */
export function BaseToggle({ base, onChange, className = '' }: { base: BaseKind; onChange: (b: BaseKind) => void; className?: string }) {
  return (
    <div className={`z-[500] inline-flex rounded-lg shadow-md overflow-hidden border border-gray-300 bg-white ${className}`} data-map-base-toggle>
      {(['aerial', 'street'] as BaseKind[]).map(k => (
        <button key={k} type="button" onClick={() => onChange(k)} data-map-base={k} aria-pressed={base === k}
          className={`min-h-[40px] px-3 text-xs font-semibold ${base === k ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>
          {k === 'aerial' ? 'Aerial' : 'Street'}
        </button>
      ))}
    </div>
  )
}
