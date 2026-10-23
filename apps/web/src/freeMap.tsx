/**
 * Free maps for the drawing and planning tools: Leaflet, and no key in the
 * browser. Two base layers:
 *  - street: OpenStreetMap tiles
 *  - aerial: the sharp photo from our own server (aerialTiles.ts): Esri World
 *    Imagery first when the server has an Esri key, USGS NAIP Plus (public
 *    domain) when it does not, or when an Esri tile fails or takes more than
 *    3 seconds. Under it, the soft older USGS tiles (zoom 16, quick) show at
 *    once, with "Loading your yard photo…" until the sharp tiles are in. The
 *    map stops at zoom 19 (about 0.3 m a pixel, the photo's real
 *    resolution): nothing is enlarged. Zooming in there says "Sharpest photo
 *    available here".
 */

import { useEffect, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
// Every map sits in its own layer, under the page's menus and dialogs (layers.css).
import './layers.css'
import { aerialConfig, again, esriTile, naipTile, AERIAL_MAX_ZOOM, LOW_MAX_ZOOM, LOW_TILES, NAIP_CREDIT } from './aerialTiles'

export type BaseKind = 'aerial' | 'street'

export const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
export const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
// Note the order: {y} before {x}.
export const USGS_TILES = LOW_TILES
export const USGS_ATTRIBUTION = 'USGS The National Map'
export const NAIP_ATTRIBUTION = NAIP_CREDIT
export const SHARPEST_TEXT = 'Sharpest photo available here'
export const LOADING_TEXT = 'Loading your yard photo…'

type AerialGrid = L.GridLayer & { esriDown: boolean; esriFails: number; usedNaip: boolean; usedEsri: boolean; source: () => 'esri' | 'naip' | '' }

/**
 * The sharp photo, tile by tile: Esri when the server has it, NAIP after an
 * Esri tile fails or is slower than the switch time (3 s); two such tiles and
 * the whole layer stays on NAIP. A NAIP tile that fails is asked once more.
 */
const Grid = L.GridLayer.extend({
  createTile(this: AerialGrid, coords: L.Coords, done: L.DoneCallback) {
    const img = document.createElement('img')
    img.alt = ''
    img.setAttribute('role', 'presentation')
    let settled = false
    let timer: number | undefined
    const finish = (err?: Error) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); done(err as Error, img) }
    const { z, x, y } = coords
    const naip = (n = 0) => {
      this.usedNaip = true
      this.fire('aerialsource')
      img.dataset.aerialSource = 'naip'
      img.onload = () => finish()
      img.onerror = () => { if (n < 1) setTimeout(() => naip(n + 1), 1000); else finish(new Error('photo tile')) }
      img.src = n ? again(naipTile(z, x, y), n) : naipTile(z, x, y)
    }
    const esriFailed = () => {
      if (++this.esriFails >= 2 && !this.esriDown) { this.esriDown = true; this.fire('aerialsource') }
      naip()
    }
    void aerialConfig().then(c => {
      if (settled) return
      if (!c.esri || this.esriDown) { naip(); return }
      this.usedEsri = true
      img.dataset.aerialSource = 'esri'
      img.onload = () => finish()
      img.onerror = () => { if (timer) clearTimeout(timer); img.onload = null; img.onerror = null; esriFailed() }
      timer = window.setTimeout(() => {
        timer = undefined; img.onload = null; img.onerror = null
        // A tile the map has already let go (panned or zoomed away): nothing more to ask.
        if (!img.isConnected) { finish(new Error('tile gone')); return }
        esriFailed()
      }, c.switchMs)
      img.src = esriTile(z, x, y)
    })
    return img
  },
})

/** The aerial photo layer (sharp tiles only; see createFreeMap for the soft ones under it). */
export function aerialLayer(maxZoom = AERIAL_MAX_ZOOM): AerialGrid {
  const layer = new (Grid as unknown as new (o: L.GridLayerOptions) => AerialGrid)({ maxNativeZoom: AERIAL_MAX_ZOOM, maxZoom, tileSize: 256 })
  layer.esriDown = false; layer.esriFails = 0; layer.usedNaip = false; layer.usedEsri = false
  layer.source = () => (layer.usedEsri && !layer.esriDown ? 'esri' : layer.usedNaip ? 'naip' : '')
  // The credit: Esri's (with Powered by Esri) when its tiles are shown, NAIP's when those are.
  const credit = () => aerialConfig().then(c => {
    const parts = [layer.usedEsri && !layer.esriDown && c.credit.esri ? c.credit.esri : '', layer.usedNaip || !c.esri ? c.credit.naip : ''].filter(Boolean)
    const next = parts.join(' · ')
    const map = (layer as any)._map as L.Map | undefined
    if (next === layer.options.attribution) return
    if (map?.attributionControl && layer.options.attribution) map.attributionControl.removeAttribution(layer.options.attribution)
    layer.options.attribution = next
    if (map?.attributionControl && next) map.attributionControl.addAttribution(next)
  })
  layer.on('add aerialsource', () => { void credit() })
  layer.on('remove', () => { const map = (layer as any)._map as L.Map | undefined; if (map?.attributionControl && layer.options.attribution) map.attributionControl.removeAttribution(layer.options.attribution) })
  return layer
}
/** The old name (the magnifier and older screens). */
export const naipLayer = aerialLayer

export const MAX_ZOOM = 20

export interface FreeMap {
  map: L.Map
  setBase: (kind: BaseKind) => void
  destroy: () => void
}

export function createFreeMap(el: HTMLElement, opts: { center: [number, number]; zoom: number; base: BaseKind; doubleClickZoom?: boolean; loadingText?: string }): FreeMap {
  // No zoom animations: a map closed mid-animation (a dialog shut quickly) would otherwise throw.
  const map = L.map(el, {
    zoomControl: true, attributionControl: true,
    zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
    doubleClickZoom: opts.doubleClickZoom ?? true,
    maxZoom: MAX_ZOOM,
  }).setView(opts.center, opts.zoom)

  const street = L.tileLayer(OSM_TILES, { maxNativeZoom: 19, maxZoom: MAX_ZOOM, attribution: OSM_ATTRIBUTION })
  // Under the sharp photo, the soft older USGS tiles: they come at once, and a sharp tile still on its way shows soft, not gray.
  const backup = L.tileLayer(USGS_TILES, { maxNativeZoom: LOW_MAX_ZOOM, maxZoom: AERIAL_MAX_ZOOM, attribution: USGS_ATTRIBUTION })
  const sharp = aerialLayer()
  const aerial = L.featureGroup([backup, sharp])
  let current: L.TileLayer | L.FeatureGroup = opts.base === 'aerial' ? aerial : street
  el.setAttribute('data-aerial-max-native-zoom', String(AERIAL_MAX_ZOOM))
  const showSource = () => { const s = sharp.source(); if (s) el.setAttribute('data-aerial-source', s) }
  sharp.on('aerialsource tileload', showSource)

  // "Loading your yard photo…" over the map until the sharp tiles in view are in (after a quarter second, so a quick photo never flashes it).
  const loading = document.createElement('div')
  loading.setAttribute('data-aerial-loading', '')
  loading.setAttribute('role', 'status')
  loading.style.cssText = 'position:absolute;inset:0;z-index:640;display:none;align-items:center;justify-content:center;pointer-events:none;background:rgba(17,24,39,.28)'
  loading.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;gap:6px;max-width:80%;background:rgba(17,24,39,.88);color:#fff;font:600 15px/1.3 system-ui,sans-serif;padding:12px 16px;border-radius:12px;text-align:center"><span style="display:flex;align-items:center;gap:10px"><span data-aerial-spinner style="width:18px;height:18px;border:3px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:ezspin .8s linear infinite"></span><span data-aerial-loading-text></span></span><span data-aerial-loading-slow style="display:none;font-weight:500;font-size:12px;opacity:.85">The first look at a new address can take up to 30 seconds.</span></div>'
  ;(loading.querySelector('[data-aerial-loading-text]') as HTMLElement).textContent = opts.loadingText ?? LOADING_TEXT
  if (!document.getElementById('ezspin-style')) {
    const st = document.createElement('style'); st.id = 'ezspin-style'
    st.textContent = '@keyframes ezspin{to{transform:rotate(360deg)}}'
    document.head.appendChild(st)
  }
  el.appendChild(loading)
  let showT: number | undefined, slowT: number | undefined, busy = false
  const setLoading = (on: boolean) => {
    busy = on
    clearTimeout(showT); clearTimeout(slowT)
    const slow = loading.querySelector('[data-aerial-loading-slow]') as HTMLElement
    if (!on) { loading.style.display = 'none'; slow.style.display = 'none'; el.setAttribute('data-aerial-state', current === aerial ? 'sharp' : 'street'); limits(); return }
    el.setAttribute('data-aerial-state', 'loading')
    showT = window.setTimeout(() => { if (busy && current === aerial) { loading.style.display = 'flex'; limits() } }, 250)
    slowT = window.setTimeout(() => { if (busy && current === aerial && sharp.source() !== 'esri') slow.style.display = 'block' }, 6000)
  }
  sharp.on('loading', () => setLoading(true))
  sharp.on('load', () => setLoading(false))

  // The photo is never enlarged past its real resolution: the aerial map stops there, and says so when zoomed in to it.
  const note = document.createElement('div')
  note.setAttribute('data-aerial-limit', '')
  note.textContent = SHARPEST_TEXT
  note.style.cssText = 'position:absolute;z-index:600;top:56px;left:50%;transform:translateX(-50%);background:rgba(17,24,39,.85);color:#fff;font:600 12px/1.2 system-ui,sans-serif;padding:6px 10px;border-radius:8px;pointer-events:none;white-space:nowrap;display:none'
  el.appendChild(note)
  // Only after the person zooms (a button, the wheel, a pinch, a double tap): opening at the closest zoom says nothing.
  let zoomedByHand = false
  const limits = () => {
    const onAerial = current === aerial
    map.setMaxZoom(onAerial ? AERIAL_MAX_ZOOM : MAX_ZOOM)
    note.style.display = onAerial && zoomedByHand && !busy && map.getZoom() >= AERIAL_MAX_ZOOM ? 'block' : 'none'
  }
  const byHand = () => { zoomedByHand = true; setTimeout(limits, 0) }
  const zoomIn = el.querySelector('.leaflet-control-zoom-in')
  const zoomOut = el.querySelector('.leaflet-control-zoom-out')
  zoomIn?.addEventListener('click', byHand)
  zoomOut?.addEventListener('click', byHand)
  const wheel = () => byHand()
  const touch = (e: TouchEvent) => { if (e.touches.length >= 2) byHand() }
  el.addEventListener('wheel', wheel, { passive: true })
  el.addEventListener('touchstart', touch, { passive: true })
  map.on('dblclick', byHand)
  map.on('zoomend', limits)
  current.addTo(map)
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
      if (current === aerial) setLoading(false)
      next.addTo(map)
      // (The aerial pair keeps its own order: the sharp photo over the soft backup.)
      if (next instanceof L.TileLayer) next.bringToBack()
      current = next
      limits()
    },
    destroy() {
      clearTimeout(t); clearTimeout(showT); clearTimeout(slowT)
      ro?.disconnect()
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('touchstart', touch)
      map.stop(); map.off(); map.remove()
      loading.remove(); note.remove()
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
    <div className={`z-(--z-map-ui) inline-flex rounded-lg shadow-md overflow-hidden border border-gray-300 bg-white ${className}`} data-map-base-toggle>
      {(['aerial', 'street'] as BaseKind[]).map(k => (
        <button key={k} type="button" onClick={() => onChange(k)} data-map-base={k} aria-pressed={base === k}
          className={`min-h-[40px] px-3 text-xs font-semibold ${base === k ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>
          {k === 'aerial' ? 'Aerial' : 'Street'}
        </button>
      ))}
    </div>
  )
}

/** The photo's credit in words, under a drawing or map: Esri's when the server has Esri, else NAIP's. */
export function AerialCredit({ className = '', prefix = 'Photo', extra = '' }: { className?: string; prefix?: string; extra?: string }) {
  const [esri, setEsri] = useState<boolean | null>(null)
  useEffect(() => { let live = true; void aerialConfig().then(c => { if (live) setEsri(c.esri) }); return () => { live = false } }, [])
  return (
    <p className={className} data-aerial-credit={esri === null ? '' : esri ? 'esri' : 'naip'}>
      {prefix}: {esri ? <>Esri World Imagery, Powered by <a href="https://www.esri.com" target="_blank" rel="noopener noreferrer" className="underline">Esri</a> (USGS NAIP, public domain, where Esri is slow)</> : 'USGS National Map (NAIP), public domain'}.{extra ? ` ${extra}` : ''}
    </p>
  )
}
