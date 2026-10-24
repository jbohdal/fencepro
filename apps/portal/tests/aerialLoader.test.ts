/**
 * The browser side of the aerial photo (web/src/aerialTiles.ts), the same for
 * the website quote, Site Plans and every staff map: every sharp tile from our
 * own /p/tiles; a prefetch sized to the view; a map already open asks the
 * browser for nothing extra (only the server warm, with NAIP); Esri slow twice
 * puts the map on NAIP for a minute, then Esri is tried again.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { EsriSwitch, ESRI_REST_MS, prefetchPlan, viewTiles, AERIAL_MAX_ZOOM, TILES } from '../../web/src/aerialTiles'

const YARD = { lat: 29.0634, lng: -82.3519 } // a rural yard near Dunnellon

describe('EsriSwitch', () => {
  test('one slow Esri tile does not move the map; the second puts it on NAIP for a minute, then Esri again', () => {
    let now = 1_000
    const s = new EsriSwitch(() => now)
    expect(s.down).toBe(false)
    expect(s.failed()).toBe(false)
    expect(s.down).toBe(false)
    expect(s.failed()).toBe(true)
    expect(s.down).toBe(true)
    // While down, more failures change nothing.
    expect(s.failed()).toBe(false)
    now += ESRI_REST_MS - 1
    expect(s.down).toBe(true)
    now += 1
    expect(s.down).toBe(false)
    // Back on Esri, it takes two new slow tiles to switch again.
    expect(s.failed()).toBe(false)
    expect(s.down).toBe(false)
    expect(s.failed()).toBe(true)
  })
})

describe('prefetchPlan', () => {
  test('with Esri: the sharp tiles are our own /p/tiles Esri tiles at zoom 19, only as many as a phone view needs', () => {
    const p = prefetchPlan(YARD.lat, YARD.lng, true, { w: 390, h: 380 })
    expect(p.warm).toBe(false)
    expect(p.sharp.length).toBeGreaterThan(0)
    expect(p.sharp.length).toBeLessThanOrEqual(9)
    for (const u of p.sharp) expect(u).toMatch(new RegExp(`^${TILES}/esri/${AERIAL_MAX_ZOOM}/\\d+/\\d+\\.jpg$`))
    expect(p.sharp.length).toBe(viewTiles(YARD.lat, YARD.lng, AERIAL_MAX_ZOOM, 390, 380).length)
  })
  test('a desktop view asks for more than a phone, never the other way round', () => {
    const phone = prefetchPlan(YARD.lat, YARD.lng, true, { w: 390, h: 380 }).sharp.length
    const desk = prefetchPlan(YARD.lat, YARD.lng, true, { w: 1000, h: 700 }).sharp.length
    expect(desk).toBeGreaterThan(phone)
  })
  test('with NAIP only: no sharp tiles from the browser, the server is warmed instead; the soft tiles are the few USGS ones', () => {
    const p = prefetchPlan(YARD.lat, YARD.lng, false, { w: 390, h: 380 })
    expect(p.sharp).toEqual([])
    expect(p.warm).toBe(true)
    expect(p.low.length).toBeGreaterThan(0)
    expect(p.low.length).toBeLessThanOrEqual(4)
    for (const u of p.low) expect(u).toMatch(/USGSImageryOnly\/MapServer\/tile\/16\//)
  })
})

describe('warmAerial (a map already open on the address)', () => {
  const calls: string[] = []
  let esri = false
  beforeEach(() => {
    calls.length = 0
    vi.resetModules()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url))
      if (String(url).endsWith('/config')) return { ok: true, json: async () => ({ success: true, esri, switchMs: 3000, credit: { esri: 'E', naip: 'N' } }) }
      return { ok: true, json: async () => ({ success: true }) }
    }))
  })
  afterEach(() => { vi.unstubAllGlobals() })

  test('with NAIP: the server is told once per address, and nothing else is asked for', async () => {
    esri = false
    const m = await import('../../web/src/aerialTiles')
    m.warmAerial(YARD.lat, YARD.lng)
    m.warmAerial(YARD.lat, YARD.lng)
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(calls.filter(u => u.includes('/warm?'))).toEqual([`${TILES}/warm?lat=${YARD.lat}&lng=${YARD.lng}`])
    expect(calls.filter(u => !u.endsWith('/config') && !u.includes('/warm?'))).toEqual([])
  })
  test('with Esri: nothing at all (the map asks for exactly the tiles it shows)', async () => {
    esri = true
    const m = await import('../../web/src/aerialTiles')
    m.warmAerial(YARD.lat, YARD.lng)
    await new Promise(r => setTimeout(r, 0))
    await new Promise(r => setTimeout(r, 0))
    expect(calls.filter(u => !u.endsWith('/config'))).toEqual([])
  })
  test('no position, no request', async () => {
    const m = await import('../../web/src/aerialTiles')
    m.warmAerial(Number.NaN, YARD.lng)
    await new Promise(r => setTimeout(r, 0))
    expect(calls).toEqual([])
  })
})
