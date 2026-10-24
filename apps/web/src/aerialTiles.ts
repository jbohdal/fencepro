/**
 * Where every aerial photo tile comes from: our own server at /p/tiles
 * (apps/portal routes/aerialTiles.ts), never the photo services directly.
 *
 *   esri    Esri World Imagery, when the server has an Esri key (first choice:
 *           already cut into tiles, back in a fraction of a second)
 *   naip    USGS NAIP Plus (public domain), cut and kept on the server
 *   aerial  the server picks: Esri, or NAIP when Esri fails or is slow
 *
 * The map layer (freeMap.tsx) asks Esri first and switches a tile to NAIP
 * when Esri has not sent it in 3 seconds or fails; after two such tiles the
 * whole layer uses NAIP. The key never reaches the browser.
 */

/** Same server as the page (the website quote and the staff app both are). */
export const TILES = '/p/tiles'
/** The closest zoom with real photo pixels, for every source. */
export const AERIAL_MAX_ZOOM = 19
/** The soft older USGS tiles under the sharp ones (cut into tiles by USGS, quick; they stop at zoom 16). */
export const LOW_MAX_ZOOM = 16
export const LOW_TILES = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}'
export const NAIP_CREDIT = 'USDA, USGS The National Map: Orthoimagery (NAIP, public domain)'

export const naipTile = (z: number, x: number, y: number) => `${TILES}/naip/${z}/${x}/${y}.jpg`
export const esriTile = (z: number, x: number, y: number) => `${TILES}/esri/${z}/${x}/${y}.jpg`
/** The server's choice (Esri, else NAIP): for pictures that cannot switch by themselves. */
export const autoTile = (z: number, x: number, y: number) => `${TILES}/aerial/${z}/${x}/${y}.jpg`
export const lowTile = (z: number, x: number, y: number) => LOW_TILES.replace('{z}', String(z)).replace('{y}', String(y)).replace('{x}', String(x))

/** The same picture asked for again (a new address, so nothing in between hands back the failure). */
export function again(url: string, n: number): string {
  return `${url}${url.includes('?') ? '&' : '?'}again=${n}`
}

export interface AerialConfig {
  esri: boolean
  /** Esri slower than this (ms): NAIP instead. */
  switchMs: number
  credit: { esri: string; naip: string }
}
const NAIP_ONLY: AerialConfig = { esri: false, switchMs: 3000, credit: { esri: '', naip: NAIP_CREDIT } }

let cfg: Promise<AerialConfig> | null = null
/** Which source comes first (asked once per page; NAIP if the server does not say within 2.5 seconds). */
export function aerialConfig(): Promise<AerialConfig> {
  if (cfg) return cfg
  cfg = (async () => {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 2500)
    try {
      const r = await fetch(`${TILES}/config`, { signal: ctl.signal, credentials: 'same-origin' })
      const j = await r.json()
      if (!r.ok || !j?.success) return NAIP_ONLY
      return { esri: !!j.esri, switchMs: Number(j.switchMs) || 3000, credit: { esri: String(j.credit?.esri || ''), naip: String(j.credit?.naip || NAIP_CREDIT) } }
    } catch { cfg = null; return NAIP_ONLY } finally { clearTimeout(t) }
  })()
  return cfg
}

/** How long a map stays on NAIP after Esri was slow twice, before it tries Esri again (as the server does). */
export const ESRI_REST_MS = 60_000

/**
 * One map's choice between Esri and NAIP (freeMap.tsx): an Esri tile that
 * fails or is slower than the switch time goes to NAIP; after two such tiles
 * the whole map uses NAIP for a minute, then tries Esri again (a bad moment
 * on the phone's signal must not leave the map on the slower NAIP for good).
 */
export class EsriSwitch {
  private fails = 0
  private downUntil = 0
  private now: () => number
  constructor(now: () => number = () => Date.now()) { this.now = now }
  /** True while the map uses NAIP for every tile. */
  get down(): boolean { return this.now() < this.downUntil }
  /** An Esri tile failed or was too slow. True when that turned the whole map to NAIP. */
  failed(): boolean {
    if (this.down) return false
    if (++this.fails < 2) return false
    this.fails = 0
    this.downUntil = this.now() + ESRI_REST_MS
    return true
  }
}

/** The Web Mercator tile holding a point (fractional). */
export function tileXY(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z, r = (lat * Math.PI) / 180
  return { x: ((lng + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n }
}

/** The tiles a w x h px view centered on the point needs at zoom z. */
export function viewTiles(lat: number, lng: number, z: number, w: number, h: number): Array<{ x: number; y: number }> {
  const c = tileXY(lat, lng, z)
  const hw = w / 512, hh = h / 512
  const out: Array<{ x: number; y: number }> = []
  for (let y = Math.floor(c.y - hh); y <= Math.floor(c.y + hh); y++) for (let x = Math.floor(c.x - hw); x <= Math.floor(c.x + hw); x++) out.push({ x, y })
  return out
}

const started = new Set<string>()
const held: HTMLImageElement[] = []
/**
 * Start the photo of an address before its map opens: the soft low-detail
 * tiles first, then the sharp drawing-zoom ones. With Esri, the browser asks
 * for the tiles itself (kept in its cache as long as Esri allows); with NAIP
 * the server starts its pictures (they take about 20 seconds the first time).
 */
export function prefetchAerial(lat: number, lng: number, view: { w?: number; h?: number; zoom?: number } = {}): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
  if (started.has(key)) return
  started.add(key)
  const load = (src: string) => { const i = new Image(); i.decoding = 'async'; i.src = src; held.push(i); if (held.length > 60) held.shift() }
  for (const src of prefetchPlan(lat, lng, false, view).low) load(src)
  void aerialConfig().then(c => {
    const p = prefetchPlan(lat, lng, c.esri, view)
    p.sharp.forEach(load)
    if (p.warm) warm(lat, lng)
  })
}

const warmed = new Set<string>()
function warm(lat: number, lng: number): void {
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`
  if (warmed.has(key)) return
  warmed.add(key)
  fetch(`${TILES}/warm?lat=${lat}&lng=${lng}`, { credentials: 'same-origin', keepalive: true }).catch(() => {})
}

/**
 * For a map or photo already on the screen that is about to show this
 * address: it asks for exactly the tiles it shows, so the browser asks for
 * nothing more here (a second set of the same tiles, or a wider one, only
 * slows the first ones on a phone). With NAIP, the server is told to start
 * its pictures for the address at once.
 */
export function warmAerial(lat: number, lng: number): void {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  void aerialConfig().then(c => { if (!c.esri) warm(lat, lng) })
}

/** What prefetchAerial / warmAerial would ask the browser for (for tests): the soft and the sharp tile addresses. */
export function prefetchPlan(lat: number, lng: number, esri: boolean, view: { w?: number; h?: number; zoom?: number } = {}): { low: string[]; sharp: string[]; warm: boolean } {
  const w = view.w ?? 400, h = view.h ?? 500, z = Math.min(view.zoom ?? AERIAL_MAX_ZOOM, AERIAL_MAX_ZOOM)
  return {
    low: viewTiles(lat, lng, LOW_MAX_ZOOM, w / 8, h / 8).map(t => lowTile(LOW_MAX_ZOOM, t.x, t.y)),
    sharp: esri ? viewTiles(lat, lng, z, w, h).map(t => esriTile(z, t.x, t.y)) : [],
    warm: !esri,
  }
}
