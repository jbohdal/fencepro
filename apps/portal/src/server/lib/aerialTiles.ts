/**
 * The aerial photo tiles behind /p/tiles (routes/aerialTiles.ts): every map
 * and drawing in the app and the website quote ask here, never the photo
 * services themselves.
 *
 *   esri   Esri World Imagery (ArcGIS Location Platform), when ESRI_API_KEY is
 *          set in the server's .env. Already cut into tiles on Esri's side,
 *          so a tile comes back in a fraction of a second. The key stays on
 *          the server. Esri's terms (Master Agreement 3.2(c): "may not
 *          otherwise scrape, download, or store Data") allow no storing, so
 *          these tiles are passed through only: nothing is written to disk,
 *          and the browser keeps them only as long as Esri's own
 *          Cache-Control says.
 *   naip   USGS NAIP Plus (public domain, no key). The service draws every
 *          picture on request and takes about 20 seconds for each one, any
 *          size up to 1024 px. So one 1024 px picture of a 4 x 4 block of
 *          zoom-19 tiles is asked for once, cut into its 16 tiles here, and
 *          kept on disk (public domain: allowed). The next tile of that block,
 *          and the next customer at that address, get it at once.
 *   aerial Esri first; when it fails or takes more than 3 seconds, NAIP. For
 *          pictures that cannot switch by themselves (the quote drawing's
 *          photo, the photo kept with a proposal).
 *
 * Only tiles in and around Florida are served (zoom 10 to 19): this is not a
 * tile server for anyone else's map.
 */

import fs from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import jpeg from 'jpeg-js'

export const NAIP_EXPORT = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage'
export const ESRI_TILES = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile'
export const ESRI_INFO = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer'
/** The World Imagery credit (the service's own copyrightText replaces it once read with the key). */
export const ESRI_CREDIT = 'Esri, Vantor, Earthstar Geographics, and the GIS User Community'
export const NAIP_CREDIT = 'USDA, USGS The National Map: Orthoimagery (NAIP, public domain)'

/** The closest zoom with real photo pixels (NAIP's 0.3 m; zoom 19 is 0.2986 m). */
export const MAX_Z = 19
export const MIN_Z = 10
/** Tiles per side of one NAIP picture (4 x 4 tiles = 1024 px: about as quick as one 256 px tile, 2048 px takes twice as long). */
export const BLOCK = 4
/** Esri slower than this: the photo comes from NAIP instead. */
export const ESRI_SWITCH_MS = 3000
/** Florida and a margin: the only area served. */
export const AREA = { south: 24.0, north: 31.5, west: -88.0, east: -79.5 }

export type TileSource = 'naip' | 'esri'
export interface TileResult { body: Buffer; type: string; source: TileSource; cache: 'hit' | 'miss' | 'pass'; cacheControl: string }

export class TileError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>

export interface AerialOptions {
  cacheDir: string
  /** Disk kept for NAIP tiles; the least recently used go first. */
  maxBytes?: number
  /** How long a NAIP tile is kept (the photo is flown every two or three years). */
  ttlMs?: number
  esriKey?: string
  fetch?: FetchFn
  now?: () => number
  /** One NAIP picture may take this long. */
  naipTimeoutMs?: number
  esriSwitchMs?: number
  /** One line per NAIP picture asked for (the server log). */
  log?: (line: string) => void
}

const WORLD = 2 * Math.PI * 6378137

/** Whole numbers, a real tile, at a served zoom. */
export function validTile(z: number, x: number, y: number): boolean {
  return Number.isInteger(z) && Number.isInteger(x) && Number.isInteger(y) && z >= MIN_Z && z <= MAX_Z && x >= 0 && y >= 0 && x < 2 ** z && y < 2 ** z
}

/** The tile's corners in degrees. */
export function tileBounds(z: number, x: number, y: number): { west: number; east: number; north: number; south: number } {
  const n = 2 ** z
  const lat = (t: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI
  return { west: (x / n) * 360 - 180, east: ((x + 1) / n) * 360 - 180, north: lat(y), south: lat(y + 1) }
}

export function inArea(z: number, x: number, y: number): boolean {
  const b = tileBounds(z, x, y)
  return b.east > AREA.west && b.west < AREA.east && b.north > AREA.south && b.south < AREA.north
}

/** The tile holding a point. */
export function tileAt(lat: number, lng: number, z: number): { x: number; y: number } {
  const n = 2 ** z, r = (lat * Math.PI) / 180
  return { x: Math.floor(((lng + 180) / 360) * n), y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n) }
}

/** The NAIP picture of the n x n tiles starting at tile (x0, y0), 256 px a tile. */
export function naipRegionUrl(z: number, x0: number, y0: number, n = BLOCK): string {
  const span = WORLD / 2 ** z
  const mx = -WORLD / 2 + x0 * span, my = WORLD / 2 - y0 * span
  const q = new URLSearchParams({
    bbox: `${mx},${my - span * n},${mx + span * n},${my}`,
    bboxSR: '3857', imageSR: '3857', size: `${256 * n},${256 * n}`, format: 'jpg', f: 'image',
  })
  return `${NAIP_EXPORT}?${q}`
}
/** The NAIP picture of the block of tiles starting at (bx * BLOCK, by * BLOCK), 1024 px. */
export function naipBlockUrl(z: number, bx: number, by: number): string {
  return naipRegionUrl(z, bx * BLOCK, by * BLOCK, BLOCK)
}

/** One n x n tile picture cut into its tiles (row by row), each a JPEG. */
export function sliceBlock(jpg: Buffer, quality = 85, n = BLOCK): Buffer[] {
  const img = jpeg.decode(jpg, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 })
  const side = 256
  if (img.width < side * n || img.height < side * n) throw new Error(`picture ${img.width}x${img.height}`)
  const out: Buffer[] = []
  for (let ty = 0; ty < n; ty++) {
    for (let tx = 0; tx < n; tx++) {
      const data = Buffer.alloc(side * side * 4)
      for (let row = 0; row < side; row++) {
        const from = ((ty * side + row) * img.width + tx * side) * 4
        Buffer.from(img.data.buffer, img.data.byteOffset + from, side * 4).copy(data, row * side * 4)
      }
      out.push(Buffer.from(jpeg.encode({ data, width: side, height: side }, quality).data))
    }
  }
  return out
}

async function withTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try { return await run(ctl.signal) } finally { clearTimeout(t) }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export class AerialTiles {
  readonly cacheDir: string
  readonly maxBytes: number
  readonly ttlMs: number
  private esriKey: string
  private fetchFn: FetchFn
  private now: () => number
  private naipTimeoutMs: number
  readonly esriSwitchMs: number
  /** NAIP tiles on disk: key "z/x/y" → bytes, when written and when last used (the order of the map is the use order). */
  private index = new Map<string, { bytes: number; written: number; used: number }>()
  private bytes = 0
  private ready: Promise<void>
  /** NAIP pictures on their way, by each tile they hold ("z/x/y"). */
  private coming = new Map<string, Promise<void>>()
  /** Esri failures in a row; after 3 it is skipped for a minute (then tried again). */
  private esriFails = 0
  private esriOffUntil = 0
  esriCredit = ESRI_CREDIT
  private log: (line: string) => void
  readonly stats = { naipHit: 0, naipMiss: 0, naipBlocks: 0, naipErrors: 0, esri: 0, esriErrors: 0, switched: 0 }

  constructor(o: AerialOptions) {
    this.cacheDir = o.cacheDir
    this.maxBytes = o.maxBytes ?? 2 * 1024 ** 3
    this.ttlMs = o.ttlMs ?? 180 * 86_400_000
    this.esriKey = (o.esriKey ?? '').trim()
    this.fetchFn = o.fetch ?? ((url, init) => fetch(url, init) as any)
    this.now = o.now ?? Date.now
    this.naipTimeoutMs = o.naipTimeoutMs ?? 60_000
    this.esriSwitchMs = o.esriSwitchMs ?? ESRI_SWITCH_MS
    this.log = o.log ?? (() => {})
    this.ready = this.scan()
  }

  get esriOn(): boolean { return !!this.esriKey }
  /** Esri is set up and not resting after failures. */
  esriUsable(): boolean { return this.esriOn && this.now() >= this.esriOffUntil }

  private file(z: number, x: number, y: number) { return path.join(this.cacheDir, 'naip', String(z), String(x), `${y}.jpg`) }

  /** What is on disk already (once, at start). */
  private async scan(): Promise<void> {
    const root = path.join(this.cacheDir, 'naip')
    const found: Array<{ key: string; bytes: number; written: number; used: number }> = []
    const walk = async (dir: string, parts: string[]) => {
      let names: fs.Dirent[] = []
      try { names = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const d of names) {
        const p = path.join(dir, d.name)
        if (d.isDirectory()) await walk(p, [...parts, d.name])
        else if (d.name.endsWith('.jpg') && parts.length === 2) {
          const st = await fsp.stat(p).catch(() => null)
          if (st) found.push({ key: `${parts[0]}/${parts[1]}/${d.name.slice(0, -4)}`, bytes: st.size, written: st.mtimeMs, used: Math.max(st.mtimeMs, st.atimeMs) })
        }
      }
    }
    await walk(root, [])
    found.sort((a, b) => a.used - b.used)
    for (const f of found) { this.index.set(f.key, { bytes: f.bytes, written: f.written, used: f.used }); this.bytes += f.bytes }
  }

  /** Room for more: the least recently used tiles go. */
  private async trim(): Promise<void> {
    if (this.bytes <= this.maxBytes) return
    for (const [key, v] of this.index) {
      if (this.bytes <= this.maxBytes * 0.9) break
      this.index.delete(key); this.bytes -= v.bytes
      const [z, x, y] = key.split('/')
      await fsp.unlink(path.join(this.cacheDir, 'naip', z, x, `${y}.jpg`)).catch(() => {})
    }
  }

  private async readCached(z: number, x: number, y: number): Promise<Buffer | null> {
    await this.ready
    const key = `${z}/${x}/${y}`
    const v = this.index.get(key)
    if (!v) return null
    const f = this.file(z, x, y)
    const body = this.now() - v.written > this.ttlMs ? null : await fsp.readFile(f).catch(() => null)
    if (!body) {
      this.index.delete(key); this.bytes -= v.bytes
      await fsp.unlink(f).catch(() => {})
      return null
    }
    // Most recently used: to the end of the order.
    this.index.delete(key); this.index.set(key, { ...v, used: this.now() })
    return body
  }

  private async write(z: number, x: number, y: number, body: Buffer): Promise<void> {
    const f = this.file(z, x, y)
    await fsp.mkdir(path.dirname(f), { recursive: true })
    const tmp = `${f}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
    await fsp.writeFile(tmp, body)
    await fsp.rename(tmp, f)
    const key = `${z}/${x}/${y}`
    const old = this.index.get(key)
    if (old) { this.bytes -= old.bytes; this.index.delete(key) }
    this.index.set(key, { bytes: body.length, written: this.now(), used: this.now() })
    this.bytes += body.length
  }

  /**
   * The NAIP picture of the n x n tiles from (x0, y0), cut and kept; while it
   * is on its way, every tile it holds waits for it (asked for once however
   * many of its tiles are wanted together).
   */
  private region(z: number, x0: number, y0: number, n = BLOCK): Promise<void> {
    const key = `${z}/${x0}/${y0}+${n}`
    const job = (async () => {
      const url = naipRegionUrl(z, x0, y0, n)
      let last: unknown = null
      // The service sometimes answers 502 at once: asked again, three times in all.
      for (let attempt = 0; attempt < 3; attempt++) {
        const t0 = Date.now()
        try {
          const body = await withTimeout(this.naipTimeoutMs, async signal => {
            const r = await this.fetchFn(url, { signal })
            if (!r.ok) throw new TileError(502, `NAIP answered ${r.status}`)
            const type = r.headers.get('content-type') || ''
            if (!/image\/jpe?g/.test(type)) throw new TileError(502, `NAIP sent ${type || 'no type'}`)
            return Buffer.from(await r.arrayBuffer())
          })
          const tiles = sliceBlock(body, 85, n)
          this.stats.naipBlocks++
          this.log(`[tiles] NAIP ${key} in ${Date.now() - t0} ms${attempt ? ` (try ${attempt + 1})` : ''}`)
          await Promise.all(tiles.map((t, i) => this.write(z, x0 + (i % n), y0 + Math.floor(i / n), t)))
          await this.trim()
          return
        } catch (e) {
          last = e
          this.log(`[tiles] NAIP ${key} failed after ${Date.now() - t0} ms: ${String((e as any)?.message || e)}`)
          if ((e as any)?.name === 'AbortError') break
          if (attempt < 2) await sleep(1000 * (attempt + 1))
        }
      }
      this.stats.naipErrors++
      throw last instanceof TileError ? last : new TileError(504, `NAIP did not answer (${String((last as any)?.message || last)})`)
    })()
    const keys: string[] = []
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = `${z}/${x0 + i}/${y0 + j}`; if (!this.coming.has(k)) { this.coming.set(k, job); keys.push(k) } }
    const done = () => { for (const k of keys) if (this.coming.get(k) === job) this.coming.delete(k) }
    job.then(done, done)
    return job
  }

  async naip(z: number, x: number, y: number): Promise<TileResult> {
    this.check(z, x, y)
    const cacheControl = 'public, max-age=2592000'
    const hit = await this.readCached(z, x, y)
    if (hit) { this.stats.naipHit++; return { body: hit, type: 'image/jpeg', source: 'naip', cache: 'hit', cacheControl } }
    this.stats.naipMiss++
    // A picture already on its way with this tile in it (the address's own, from warm), else this tile's block
    // (one request for the block, however many of its tiles were waiting).
    const k = `${z}/${x}/${y}`
    const ownBlock = () => this.coming.get(k) ?? this.region(z, Math.floor(x / BLOCK) * BLOCK, Math.floor(y / BLOCK) * BLOCK)
    const going = this.coming.get(k)
    await (going ? going.catch(ownBlock) : ownBlock())
    const body = await this.readCached(z, x, y)
    if (!body) throw new TileError(502, 'NAIP tile missing after the picture came')
    return { body, type: 'image/jpeg', source: 'naip', cache: 'miss', cacheControl }
  }

  /** An Esri tile, passed straight through (never kept on the server). */
  async esri(z: number, x: number, y: number, timeoutMs = 8000): Promise<TileResult> {
    this.check(z, x, y)
    if (!this.esriKey) throw new TileError(404, 'Esri imagery is not set up (ESRI_API_KEY)')
    try {
      const out = await withTimeout(timeoutMs, async signal => {
        const r = await this.fetchFn(`${ESRI_TILES}/${z}/${y}/${x}?token=${encodeURIComponent(this.esriKey)}`, { signal })
        const type = r.headers.get('content-type') || ''
        if (!r.ok || !/^image\//.test(type)) throw new TileError(502, `Esri answered ${r.status} ${type}`)
        return { body: Buffer.from(await r.arrayBuffer()), type, cacheControl: r.headers.get('cache-control') || 'private, max-age=3600' }
      })
      this.esriFails = 0
      this.stats.esri++
      return { ...out, source: 'esri', cache: 'pass' }
    } catch (e) {
      this.stats.esriErrors++
      if (++this.esriFails >= 3) { this.esriOffUntil = this.now() + 60_000; this.esriFails = 0 }
      throw e instanceof TileError ? e : new TileError(504, (e as any)?.name === 'AbortError' ? 'Esri too slow' : String((e as any)?.message || e))
    }
  }

  /** Esri when it answers within the switch time, else NAIP. */
  async auto(z: number, x: number, y: number): Promise<TileResult> {
    this.check(z, x, y)
    if (this.esriUsable()) {
      try { return await this.esri(z, x, y, this.esriSwitchMs) } catch { this.stats.switched++ }
    }
    return this.naip(z, x, y)
  }

  /**
   * Start the NAIP picture for the drawing view around a point: one 1024 px
   * picture of the 4 x 4 zoom-19 tiles centered on it (1.5 tiles each way:
   * a phone's whole drawing view, in one request instead of up to four
   * blocks). With Esri on, nothing (Esri tiles are not kept, and come quickly).
   * Returns how many pictures were started (0 or 1).
   */
  warm(lat: number, lng: number): number {
    if (this.esriUsable()) return 0
    if (!(lat >= AREA.south && lat <= AREA.north && lng >= AREA.west && lng <= AREA.east)) return 0
    const n = 2 ** MAX_Z, r = (lat * Math.PI) / 180
    const fx = ((lng + 180) / 360) * n, fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
    const x0 = Math.round(fx) - BLOCK / 2, y0 = Math.round(fy) - BLOCK / 2
    const key = `${MAX_Z}/${x0}/${y0}`
    if (this.warming.has(key)) return 0
    this.warming.add(key)
    void (async () => {
      await this.ready
      const keys: string[] = []
      for (let j = 0; j < BLOCK; j++) for (let i = 0; i < BLOCK; i++) keys.push(`${MAX_Z}/${x0 + i}/${y0 + j}`)
      // Everything there already kept or on its way: nothing to ask.
      if (keys.every(k => this.index.has(k) || this.coming.has(k))) return
      await this.region(MAX_Z, x0, y0, BLOCK)
    })().catch(() => {}).finally(() => this.warming.delete(key))
    return 1
  }
  private warming = new Set<string>()

  /** The World Imagery credit from the service itself (once, with the key). */
  async readEsriCredit(): Promise<string> {
    if (!this.esriKey) return this.esriCredit
    try {
      const j = await withTimeout(8000, async signal => {
        const r = await this.fetchFn(`${ESRI_INFO}?f=json&token=${encodeURIComponent(this.esriKey)}`, { signal })
        return JSON.parse(Buffer.from(await r.arrayBuffer()).toString('utf8'))
      })
      const t = typeof j?.copyrightText === 'string' ? j.copyrightText.trim() : ''
      if (t) this.esriCredit = t.replace(/^Source:\s*/i, '')
    } catch { /* the built-in credit stays */ }
    return this.esriCredit
  }

  private check(z: number, x: number, y: number) {
    if (!validTile(z, x, y)) throw new TileError(400, 'Not a tile')
    if (!inArea(z, x, y)) throw new TileError(404, 'Outside the area served')
  }

  /** Disk in use (for the tests and the log). */
  async diskBytes(): Promise<number> { await this.ready; return this.bytes }
}
