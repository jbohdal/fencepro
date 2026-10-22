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
  const w = view.w ?? 400, h = view.h ?? 500, z = Math.min(view.zoom ?? AERIAL_MAX_ZOOM, AERIAL_MAX_ZOOM)
  const load = (src: string) => { const i = new Image(); i.decoding = 'async'; i.src = src; held.push(i); if (held.length > 60) held.shift() }
  for (const t of viewTiles(lat, lng, LOW_MAX_ZOOM, w / 8, h / 8)) load(lowTile(LOW_MAX_ZOOM, t.x, t.y))
  void aerialConfig().then(c => {
    if (c.esri) for (const t of viewTiles(lat, lng, z, w, h)) load(esriTile(z, t.x, t.y))
    else fetch(`${TILES}/warm?lat=${lat}&lng=${lng}`, { credentials: 'same-origin', keepalive: true }).catch(() => {})
  })
}
