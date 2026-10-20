/**
 * Free maps for the drawing and planning tools: Leaflet with no key and no
 * paid account. Two base layers:
 *  - street: OpenStreetMap tiles
 *  - aerial: USGS NAIP Plus (public domain), the same photo service and
 *    request the quote's yard drawing uses (a picture of each tile's box), down
 *    to its real resolution (zoom 19, about 0.26 m a pixel here). The map stops
 *    there and says "Sharpest photo available here": nothing is enlarged.
 *    (The old USGS Imagery Only tiles stop at zoom 16, about 2 m a pixel, and
 *    were enlarged eight times at zoom 19.)
 */

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { naipTileUrl, NAIP_MAX_NATIVE_ZOOM, NAIP_EXPORT, USGS_BACKUP_MAX_ZOOM } from './sitePlanGeometry'

export type BaseKind = 'aerial' | 'street'

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
// Note the order: {y} before {x}.
export const USGS_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'
export const USGS_ATTRIBUTION = 'USGS The National Map'
export const NAIP_ATTRIBUTION = 'USGS The National Map: NAIP Plus (public domain)'
export const SHARPEST_TEXT = 'Sharpest photo available here'

/** The aerial layer: NAIP Plus pictures per tile, up to its real resolution and no further. */
const NaipLayer = L.TileLayer.extend({
  getTileUrl(coords: L.Coords) { return naipTileUrl(coords.z, coords.x, coords.y) },
})
export function naipLayer(): L.TileLayer {
  const layer = new (NaipLayer as unknown as new (url: string, o: L.TileLayerOptions) => L.TileLayer)(NAIP_EXPORT, {
    maxNativeZoom: NAIP_MAX_NATIVE_ZOOM, maxZoom: NAIP_MAX_NATIVE_ZOOM, attribution: NAIP_ATTRIBUTION,
  })
  // The photo service sometimes drops a request: a missing tile is asked for again, twice at most.
  layer.on('tileerror', (e: L.TileErrorEvent) => {
    const img = e.tile as HTMLImageElement
    const n = Number(img.dataset.retry || 0)
    if (n >= 2) return
    img.dataset.retry = String(n + 1)
    setTimeout(() => { img.src = `${naipTileUrl(e.coords.z, e.coords.x, e.coords.y)}&again=${n + 1}` }, 1500 * (n + 1))
  })
  return layer
}

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
  // Under the sharp photo, the old soft USGS tiles: a tile the photo service does not send in
  // time shows soft instead of gray. They are enlarged only where the sharp one is missing.
  const backup = L.tileLayer(USGS_TILES, { maxNativeZoom: USGS_BACKUP_MAX_ZOOM, maxZoom: NAIP_MAX_NATIVE_ZOOM, attribution: USGS_ATTRIBUTION })
  const aerial = L.featureGroup([backup, naipLayer()])
  let current: L.TileLayer | L.FeatureGroup = opts.base === 'aerial' ? aerial : street
  current.addTo(map)
  // The photo is never enlarged past its real resolution: the aerial map stops there and says so.
  el.setAttribute('data-aerial-source', NAIP_EXPORT)
  el.setAttribute('data-aerial-max-native-zoom', String(NAIP_MAX_NATIVE_ZOOM))
  const note = document.createElement('div')
  note.setAttribute('data-aerial-limit', '')
  note.textContent = SHARPEST_TEXT
  note.style.cssText = 'position:absolute;z-index:600;top:56px;left:50%;transform:translateX(-50%);background:rgba(17,24,39,.85);color:#fff;font:600 12px/1.2 system-ui,sans-serif;padding:6px 10px;border-radius:8px;pointer-events:none;white-space:nowrap;display:none'
  el.appendChild(note)
  const limits = () => {
    const onAerial = current === aerial
    map.setMaxZoom(onAerial ? NAIP_MAX_NATIVE_ZOOM : MAX_ZOOM)
    note.style.display = onAerial && map.getZoom() >= NAIP_MAX_NATIVE_ZOOM ? 'block' : 'none'
  }
  map.on('zoomend', limits)
  limits()

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
      // (The aerial pair keeps its own order: the sharp photo over the soft backup.)
      if (next instanceof L.TileLayer) next.bringToBack()
      current = next
      limits()
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
