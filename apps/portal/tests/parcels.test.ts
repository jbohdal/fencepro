/**
 * Property lines for the office site plan (lib/parcels.ts), from answers the
 * Marion County Property Appraiser's parcel service gave on Nov 6 2026
 * (tests/fixtures/marionParcels.json; only the parcel number and its shape):
 * a house whose point lands in its lot, downtown Ocala whose point lands in
 * the road (the nearest lot is picked), the backup when the first source
 * fails, a county with no source, Settings' sources, and the hour's cache.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { parcelsAt, parcelSourcesOf, ringsOf, forgetParcels, countyName, MARION_PA, OCALA_PARCELS, DEFAULT_PARCEL_SOURCES } from '../src/server/lib/parcels'

const rec = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'marionParcels.json'), 'utf8'))
const HOUSE = { lat: 29.07, lng: -82.21 }
const DOWNTOWN = { lat: 29.1872, lng: -82.1401 }

/** Answers like the county's: by the place and point or box in the URL. */
function county(opts: { fail?: string } = {}) {
  const asked: string[] = []
  const fn = async (url: string) => {
    asked.push(url)
    if (opts.fail && url.startsWith(opts.fail)) return { ok: false, status: 503, json: async () => ({}) }
    const place = url.includes('-82.21') ? 'residential' : 'downtown'
    const kind = url.includes('esriGeometryPoint') ? 'point' : 'envelope'
    return { ok: true, status: 200, json: async () => rec[`${place}_${kind}`] }
  }
  return { fn, asked }
}

beforeEach(() => forgetParcels())

describe('the parcel at a spot', () => {
  test('a house: its lot from the point, its outline as latitude and longitude, the neighbors as thin lines', async () => {
    const c = county()
    const a = await parcelsAt(HOUSE, 'Marion', DEFAULT_PARCEL_SOURCES, c.fn)
    expect(a.parcel?.id).toBe('3513-003-022')
    expect(a.parcel?.source).toBe('Marion County Property Appraiser')
    expect(a.parcel!.rings[0].length).toBe(4)
    for (const p of a.parcel!.rings[0]) { expect(Math.abs(p.lat - 29.07)).toBeLessThan(0.01); expect(Math.abs(p.lng + 82.21)).toBeLessThan(0.01) }
    expect(a.neighbors.length).toBe(8)
    expect(a.note).toMatch(/not a survey/)
    // Asked as latitude and longitude both ways, the point and a box about 400 ft across.
    expect(c.asked.every(u => u.includes('outSR=4326') && u.includes('inSR=4326'))).toBe(true)
    expect(c.asked.some(u => u.includes('esriGeometryEnvelope'))).toBe(true)
  })

  test('downtown Ocala: the point is in the road, so the lot around it or nearest (within 100 ft) is picked', async () => {
    expect(rec.downtown_point.features).toEqual([])
    const a = await parcelsAt(DOWNTOWN, 'Marion County', DEFAULT_PARCEL_SOURCES, county().fn)
    expect(a.parcel?.id).toBe('2854-023-000')
    expect(a.neighbors.length).toBe(6)
  })

  test('the Property Appraiser down: the City of Ocala copy answers', async () => {
    const c = county({ fail: MARION_PA.url })
    const a = await parcelsAt(HOUSE, 'Marion', DEFAULT_PARCEL_SOURCES, c.fn)
    expect(a.source).toBe(OCALA_PARCELS.name)
    expect(a.parcel?.id).toBe('3513-003-022')
    expect(c.asked.some(u => u.startsWith(OCALA_PARCELS.url))).toBe(true)
  })

  test('every source down: no parcel, said plainly', async () => {
    const c = county({ fail: 'https://' })
    const a = await parcelsAt(HOUSE, 'Marion', DEFAULT_PARCEL_SOURCES, c.fn)
    expect(a.parcel).toBeNull()
    expect(a.note).toMatch(/could not be reached/)
  })

  test('a county with no source: no parcel and the note', async () => {
    const c = county()
    const a = await parcelsAt(HOUSE, 'lake', DEFAULT_PARCEL_SOURCES, c.fn)
    expect(a).toEqual({ parcel: null, neighbors: [], source: '', note: 'No property line source is set for Lake County. The plan works without property lines.' })
    expect(c.asked).toEqual([])
  })

  test('kept for an hour by the rounded spot', async () => {
    const c = county()
    await parcelsAt(HOUSE, 'Marion', DEFAULT_PARCEL_SOURCES, c.fn, 1_000)
    const n = c.asked.length
    await parcelsAt({ lat: 29.070001, lng: -82.210001 }, 'Marion', DEFAULT_PARCEL_SOURCES, c.fn, 1_000 + 59 * 60_000)
    expect(c.asked.length).toBe(n)
    await parcelsAt(HOUSE, 'Marion', DEFAULT_PARCEL_SOURCES, c.fn, 1_000 + 61 * 60_000)
    expect(c.asked.length).toBe(n * 2)
  })
})

describe('sources from Settings', () => {
  test('a county added (one source or a list), Marion kept by default, a bad address ignored', () => {
    const s = parcelSourcesOf({ 'Lake County': { url: 'https://gis.fdacs.gov/mapping/rest/services/GIO_Parcels_for_OAWP_Optimized/FeatureServer/0/query', idField: 'PARCEL_ID', where: 'CO_NO=45' }, Sumter: { url: 'http://insecure/query', idField: 'X' } })
    expect(s.Lake).toEqual([{ url: 'https://gis.fdacs.gov/mapping/rest/services/GIO_Parcels_for_OAWP_Optimized/FeatureServer/0/query', idField: 'PARCEL_ID', where: 'CO_NO=45' }])
    expect(s.Marion).toEqual([MARION_PA, OCALA_PARCELS])
    expect(s.Sumter).toBeUndefined()
    expect(countyName(' MARION county ')).toBe('Marion')
  })

  test('a where from Settings goes with every question', async () => {
    const c = county()
    await parcelsAt(HOUSE, 'Lake', { Lake: [{ url: 'https://x.example/query', idField: 'PARCEL' , where: 'CO_NO=45' }] }, c.fn)
    expect(c.asked.every(u => new URL(u).searchParams.get('where') === 'CO_NO=45')).toBe(true)
  })

  test('rings: the closing corner dropped, the biggest first, nonsense left out', () => {
    const r = ringsOf({ geometry: { rings: [[[0, 0], [0, 0.0001], [0.0001, 0], [0, 0]], [[0, 0], [0, 0.01], [0.01, 0.01], [0.01, 0], [0, 0]], [[0, 'x']]] } })
    expect(r.map(x => x.length)).toEqual([4, 3])
  })
})
