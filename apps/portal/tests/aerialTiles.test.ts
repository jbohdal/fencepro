/**
 * The aerial photo tiles (lib/aerialTiles.ts), with made-up photo services:
 * NAIP is asked once per 4 x 4 block, cut into 16 tiles and kept on disk;
 * Esri tiles are passed through and never kept; Esri slower than 3 seconds
 * or failing gives NAIP; only Florida is served; the disk stays under its cap.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import jpeg from 'jpeg-js'
import {
  AerialTiles, TileError, naipBlockUrl, sliceBlock, tileAt, inArea, validTile, BLOCK, NAIP_EXPORT, ESRI_TILES, MAX_Z,
} from '../src/server/lib/aerialTiles'

const OCALA = { lat: 29.1851, lng: -82.1342 }
const c19 = tileAt(OCALA.lat, OCALA.lng, 19)

/** A 1024 px block picture whose 16 tiles each have their own gray (tile i: 10 + i * 15). */
function blockJpeg(): Buffer {
  const w = 256 * BLOCK, data = Buffer.alloc(w * w * 4)
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const i = Math.floor(y / 256) * BLOCK + Math.floor(x / 256), v = 10 + i * 15, o = (y * w + x) * 4
    data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255
  }
  return Buffer.from(jpeg.encode({ data, width: w, height: w }, 95).data)
}
const BLOCK_JPG = blockJpeg()
const ESRI_JPG = Buffer.from(jpeg.encode({ data: Buffer.alloc(256 * 256 * 4, 200), width: 256, height: 256 }, 80).data)
const grayOf = (b: Buffer) => { const d = jpeg.decode(b, { useTArray: true }); return d.data[(128 * 256 + 128) * 4] }

interface Call { url: string }
function upstream(opts: { esri?: 'ok' | 'slow' | 'fail'; naip?: 'ok' | 'fail' | 'flaky' } = {}) {
  const calls: Call[] = []
  let flaky = 0
  const res = (status: number, type: string, body: Buffer, cc?: string) => ({
    ok: status >= 200 && status < 300, status,
    headers: { get: (n: string) => (n.toLowerCase() === 'content-type' ? type : n.toLowerCase() === 'cache-control' ? cc ?? null : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  })
  const fetch = async (url: string, init?: { signal?: AbortSignal }) => {
    calls.push({ url })
    if (url.startsWith(NAIP_EXPORT)) {
      if (opts.naip === 'fail') return res(502, 'text/html', Buffer.from('bad gateway'))
      if (opts.naip === 'flaky' && flaky++ === 0) return res(502, 'text/html', Buffer.from('bad gateway'))
      return res(200, 'image/jpeg', BLOCK_JPG)
    }
    if (url.startsWith(ESRI_TILES)) {
      if (opts.esri === 'fail') return res(500, 'application/json', Buffer.from('{}'))
      if (opts.esri === 'slow') {
        await new Promise((ok, bad) => { const t = setTimeout(ok, 10_000); init?.signal?.addEventListener('abort', () => { clearTimeout(t); bad(Object.assign(new Error('aborted'), { name: 'AbortError' })) }) })
      }
      return res(200, 'image/jpeg', ESRI_JPG, 'public, max-age=86400')
    }
    if (url.includes('World_Imagery/MapServer?f=json')) return res(200, 'application/json', Buffer.from(JSON.stringify({ copyrightText: 'Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community' })))
    throw new Error(`unexpected ${url}`)
  }
  return { calls, fetch }
}

let dir = ''
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerial-')) })
const make = (u: ReturnType<typeof upstream>, extra: Partial<ConstructorParameters<typeof AerialTiles>[0]> = {}) =>
  new AerialTiles({ cacheDir: dir, fetch: u.fetch as any, esriSwitchMs: 150, ...extra })

describe('tiles', () => {
  test('only real tiles in and around Florida, zoom 10 to 19', () => {
    expect(validTile(19, c19.x, c19.y)).toBe(true)
    expect(validTile(20, 1, 1)).toBe(false)
    expect(validTile(19, -1, 1)).toBe(false)
    expect(validTile(19, 2 ** 19, 1)).toBe(false)
    expect(inArea(19, c19.x, c19.y)).toBe(true)
    const nyc = tileAt(40.71, -74.0, 19)
    expect(inArea(19, nyc.x, nyc.y)).toBe(false)
  })

  test('a NAIP block picture is 1024 px of a 4 x 4 block of zoom-19 tiles', () => {
    const u = new URL(naipBlockUrl(19, Math.floor(c19.x / 4), Math.floor(c19.y / 4)))
    expect(u.origin + u.pathname).toBe(NAIP_EXPORT)
    expect(u.searchParams.get('size')).toBe('1024,1024')
    const [x0, y0, x1, y1] = u.searchParams.get('bbox')!.split(',').map(Number)
    expect(x1 - x0).toBeCloseTo(4 * 76.437, 2); expect(y1 - y0).toBeCloseTo(4 * 76.437, 2)
  })

  test('cutting the block: 16 tiles in rows, each its own part of the picture', () => {
    const parts = sliceBlock(BLOCK_JPG)
    expect(parts.length).toBe(16)
    parts.forEach((p, i) => { const d = jpeg.decode(p); expect(d.width).toBe(256); expect(d.height).toBe(256); expect(Math.abs(grayOf(p) - (10 + i * 15))).toBeLessThan(6) })
  })
})

describe('NAIP: asked once per block, kept on disk', () => {
  test('16 tiles of one block at once: one picture asked for; the second time from disk', async () => {
    const u = upstream()
    const t = make(u)
    const bx = Math.floor(c19.x / 4) * 4, by = Math.floor(c19.y / 4) * 4
    const all = await Promise.all(Array.from({ length: 16 }, (_, i) => t.naip(19, bx + (i % 4), by + Math.floor(i / 4))))
    expect(u.calls.filter(c => c.url.startsWith(NAIP_EXPORT)).length).toBe(1)
    all.forEach((r, i) => { expect(r.source).toBe('naip'); expect(Math.abs(grayOf(r.body) - (10 + i * 15))).toBeLessThan(6) })
    const again = await t.naip(19, bx + 1, by + 2)
    expect(again.cache).toBe('hit')
    expect(u.calls.length).toBe(1)
    // On disk: a server started again finds them.
    const t2 = make(u)
    expect((await t2.naip(19, bx + 3, by + 3)).cache).toBe('hit')
    expect(u.calls.length).toBe(1)
    expect(fs.existsSync(path.join(dir, 'naip', '19', String(bx), `${by}.jpg`))).toBe(true)
  })

  test('a 502 is asked again; a service that keeps failing is an error, nothing kept', async () => {
    const flaky = upstream({ naip: 'flaky' })
    expect((await make(flaky).naip(19, c19.x, c19.y)).source).toBe('naip')
    expect(flaky.calls.length).toBe(2)
    const down = upstream({ naip: 'fail' })
    await expect(make(down).naip(19, c19.x + 8, c19.y)).rejects.toBeInstanceOf(TileError)
    expect(down.calls.length).toBe(3)
  }, 20_000)

  test('the disk stays under its cap: the least recently used go first', async () => {
    const u = upstream()
    const one = sliceBlock(BLOCK_JPG).reduce((a, b) => a + b.length, 0)
    const t = make(u, { maxBytes: Math.floor(one * 1.5) })
    await t.naip(19, c19.x, c19.y)
    await t.naip(19, c19.x + 8, c19.y)
    expect(await t.diskBytes()).toBeLessThanOrEqual(Math.floor(one * 1.5))
    // The newer block is the one kept.
    expect((await t.naip(19, c19.x + 8, c19.y)).cache).toBe('hit')
  })

  test('kept no longer than the time allowed', async () => {
    const u = upstream()
    let now = Date.now()
    const t = make(u, { now: () => now, ttlMs: 1000 })
    await t.naip(19, c19.x, c19.y)
    expect((await t.naip(19, c19.x, c19.y)).cache).toBe('hit')
    now += 5000
    expect((await t.naip(19, c19.x, c19.y)).cache).toBe('miss')
    expect(u.calls.length).toBe(2)
    expect((await t.naip(19, c19.x, c19.y)).cache).toBe('hit')
  })

  test('warm: one picture of the 4 x 4 tiles centered on the address, before the map asks; the map then waits for it', async () => {
    const u = upstream()
    const t = make(u)
    expect(t.warm(OCALA.lat, OCALA.lng)).toBe(1)
    // Asked twice at once (the suggestion, then the pick): still one picture.
    expect(t.warm(OCALA.lat, OCALA.lng)).toBe(0)
    await new Promise(r => setTimeout(r, 30))
    // The map's tiles of the drawing view, while the picture is on its way: no second request.
    const view = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1]].map(([dx, dy]) => t.naip(19, c19.x + dx, c19.y + dy))
    const got = await Promise.all(view)
    expect(got.every(g => g.source === 'naip')).toBe(true)
    expect(u.calls.length).toBe(1)
    const url = new URL(u.calls[0].url)
    const [x0, , x1] = url.searchParams.get('bbox')!.split(',').map(Number)
    const world = 2 * Math.PI * 6378137, span = world / 2 ** 19
    const fx = (OCALA.lng + 180) / 360 * 2 ** 19
    // Centered: the address is within half a tile of the picture's middle.
    expect(Math.abs((x0 + x1) / 2 - (-world / 2 + fx * span))).toBeLessThanOrEqual(span / 2 + 1e-6)
    expect((await t.naip(19, c19.x, c19.y)).cache).toBe('hit')
    // Already kept: nothing more asked. Outside the area: nothing.
    await new Promise(r => setTimeout(r, 50))
    expect(t.warm(OCALA.lat, OCALA.lng)).toBe(1)
    await new Promise(r => setTimeout(r, 50))
    expect(u.calls.length).toBe(1)
    expect(t.warm(40.7, -74)).toBe(0)
  })
})

describe('NAIP: a failed address picture', () => {
  test('the tiles waiting for it ask for their block once, not once each', async () => {
    let n = 0
    const u = upstream()
    const base = u.fetch
    const t = make(u, { fetch: (async (url: string, init?: any) => (url.startsWith(NAIP_EXPORT) && n++ < 3 ? { ok: false, status: 502, headers: { get: () => 'text/html' }, arrayBuffer: async () => new ArrayBuffer(0) } : base(url, init))) as any })
    t.warm(OCALA.lat, OCALA.lng)
    await new Promise(r => setTimeout(r, 30))
    const bx = Math.floor(c19.x / 4) * 4, by = Math.floor(c19.y / 4) * 4
    const got = await Promise.all([0, 1, 2, 3].map(i => t.naip(19, bx + 1 + (i % 2), by + 1 + Math.floor(i / 2))))
    expect(got.every(g => g.source === 'naip')).toBe(true)
    // 3 failed tries of the address picture, then one block picture for the 4 waiting tiles.
    expect(n).toBe(4)
  }, 20_000)
})

describe('Esri: the key stays on the server, tiles pass through', () => {
  test('no key: Esri is off and NAIP is used', async () => {
    const u = upstream({ esri: 'ok' })
    const t = make(u)
    expect(t.esriOn).toBe(false)
    await expect(t.esri(19, c19.x, c19.y)).rejects.toMatchObject({ status: 404 })
    expect((await t.auto(19, c19.x, c19.y)).source).toBe('naip')
    expect(t.warm(OCALA.lat, OCALA.lng)).toBeGreaterThan(0)
  })

  test('with a key: Esri, its own Cache-Control, nothing written to disk', async () => {
    const u = upstream({ esri: 'ok' })
    const t = make(u, { esriKey: 'test-key' })
    const r = await t.esri(19, c19.x, c19.y)
    expect(r.source).toBe('esri'); expect(r.cache).toBe('pass'); expect(r.cacheControl).toBe('public, max-age=86400')
    expect(u.calls[0].url).toBe(`${ESRI_TILES}/19/${c19.y}/${c19.x}?token=test-key`)
    expect(fs.readdirSync(dir).length).toBe(0)
    expect((await t.auto(19, c19.x, c19.y)).source).toBe('esri')
    // With Esri on, nothing is warmed (Esri tiles are not kept).
    expect(t.warm(OCALA.lat, OCALA.lng)).toBe(0)
    expect(await t.readEsriCredit()).toBe('Esri, Vantor, Earthstar Geographics, and the GIS User Community')
  })

  test('Esri slower than the switch time: NAIP instead; three failures and Esri rests a minute', async () => {
    const slow = upstream({ esri: 'slow' })
    let now = Date.now()
    const t = make(slow, { esriKey: 'k', now: () => now })
    const t0 = Date.now()
    const r = await t.auto(19, c19.x, c19.y)
    expect(r.source).toBe('naip')
    expect(Date.now() - t0).toBeLessThan(3000)
    await t.auto(19, c19.x + 8, c19.y)
    await t.auto(19, c19.x + 16, c19.y)
    expect(t.esriUsable()).toBe(false)
    const esriCalls = slow.calls.filter(c => c.url.startsWith(ESRI_TILES)).length
    await t.auto(19, c19.x + 1, c19.y)
    expect(slow.calls.filter(c => c.url.startsWith(ESRI_TILES)).length).toBe(esriCalls)
    now += 61_000
    expect(t.esriUsable()).toBe(true)
  })

  test('Esri failing: NAIP', async () => {
    const u = upstream({ esri: 'fail' })
    const t = make(u, { esriKey: 'k' })
    expect((await t.auto(19, c19.x, c19.y)).source).toBe('naip')
    expect(t.stats.switched).toBe(1)
  })

  test('outside the area or past zoom 19: refused, nothing asked', async () => {
    const u = upstream({ esri: 'ok' })
    const t = make(u, { esriKey: 'k' })
    const nyc = tileAt(40.71, -74.0, 19)
    await expect(t.auto(19, nyc.x, nyc.y)).rejects.toMatchObject({ status: 404 })
    await expect(t.naip(MAX_Z + 1, 1, 1)).rejects.toMatchObject({ status: 400 })
    expect(u.calls.length).toBe(0)
  })
})
