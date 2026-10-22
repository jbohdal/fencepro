/**
 * The aerial photo tiles at /p/tiles, behind the public door (the website
 * quote needs them) and used by every staff map too (lib/aerialTiles.ts).
 *
 *   GET /p/tiles/config               which photo comes first, and its credit
 *   GET /p/tiles/esri/:z/:x/:y.jpg    Esri World Imagery (ESRI_API_KEY; passed through, never kept)
 *   GET /p/tiles/naip/:z/:x/:y.jpg    USGS NAIP (public domain; kept on disk)
 *   GET /p/tiles/aerial/:z/:x/:y.jpg  Esri, or NAIP when Esri fails or is slower than 3 seconds
 *   GET /p/tiles/warm?lat=&lng=       start the photo for an address before the map asks
 *
 * Settings (server .env only): ESRI_API_KEY (empty: NAIP only),
 * AERIAL_CACHE_DIR (default ./data/aerial-cache), AERIAL_CACHE_MB (default 2048).
 */

import { Router, type Request, type Response } from 'express'
import path from 'path'
import rateLimit from 'express-rate-limit'
import { AerialTiles, TileError, NAIP_CREDIT, MAX_Z, type TileResult } from '../lib/aerialTiles.js'

export const tiles = new AerialTiles({
  cacheDir: path.resolve(process.env.AERIAL_CACHE_DIR || './data/aerial-cache'),
  maxBytes: Math.max(64, Number(process.env.AERIAL_CACHE_MB) || 2048) * 1024 * 1024,
  esriKey: process.env.ESRI_API_KEY || '',
  log: line => console.log(line),
})
if (tiles.esriOn) void tiles.readEsriCredit()

const router = Router()
// A map screen asks for a few dozen tiles at once; a pan or zoom, a few dozen more.
const tileLimiter = rateLimit({ windowMs: 60_000, max: 900, standardHeaders: true, legacyHeaders: false, message: 'Too many map tiles. Try again in a minute.' })
const warmLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { success: false } })

router.get('/config', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300')
  res.json({
    success: true,
    esri: tiles.esriUsable(),
    switchMs: tiles.esriSwitchMs,
    maxZoom: MAX_Z,
    credit: { esri: `Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Source: ${escapeHtml(tiles.esriCredit)}`, naip: NAIP_CREDIT },
  })
})

router.get('/warm', warmLimiter, (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng)
  const started = Number.isFinite(lat) && Number.isFinite(lng) ? tiles.warm(lat, lng) : 0
  res.status(202).json({ success: true, started })
})

router.get('/:source/:z/:x/:file', tileLimiter, async (req: Request, res: Response, next) => {
  const source = String(req.params.source)
  const m = /^(\d+)\.jpg$/.exec(String(req.params.file))
  if (!['esri', 'naip', 'aerial'].includes(source) || !m || !/^\d+$/.test(String(req.params.z)) || !/^\d+$/.test(String(req.params.x))) { next(); return }
  const z = Number(req.params.z), x = Number(req.params.x), y = Number(m[1])
  // Esri tiles only for this app's own pages (a browser on another site is refused): not a tile server for others.
  if (source !== 'naip' && req.get('sec-fetch-site') === 'cross-site') { res.status(403).type('text/plain').send('Not for other sites'); return }
  try {
    const t: TileResult = source === 'esri' ? await tiles.esri(z, x, y) : source === 'naip' ? await tiles.naip(z, x, y) : await tiles.auto(z, x, y)
    res.setHeader('Content-Type', t.type)
    res.setHeader('Cache-Control', t.cacheControl)
    res.setHeader('X-Tile-Source', t.source)
    res.setHeader('X-Tile-Cache', t.cache)
    // The same origin only (helmet's default), so no other site shows these from here.
    res.send(t.body)
  } catch (e) {
    const status = e instanceof TileError ? e.status : 502
    res.status(status).setHeader('Cache-Control', 'no-store')
    res.type('text/plain').send(e instanceof TileError ? e.message : 'Photo service did not answer')
  }
})

router.use((_req, res) => { res.status(404).type('text/plain').send('Not found') })

function escapeHtml(s: string) { return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)) }

export default router
