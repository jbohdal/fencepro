/**
 * The aerial photo under the site plan: true ground scale, the turn (slider,
 * twist and Line up), where the plan sits on it, the save and load round
 * trip, and the drawing the proposal and crew packet keep. None of it ever
 * changes footage, sections or price.
 */

import { describe, test, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from '../../web/node_modules/react-dom/server'
import SitePlan from '../../web/src/SitePlan'
import { layoutForShape, deriveLayout, type YardLayout } from '../../web/src/yardLayout'
import { aerialFtPerPx } from '../../web/src/sitePlanGeometry'
import {
  mercatorFtPerPx, photoGroundFtPerPx, photoBox, toMercator, normDeg, stepDeg, lineUpRotation, turnAbout,
  photoView, withPhotoView, planShift, planMiddle, photoBackdrop, gpsToPlan, headingOnPhoto, groundToFrame,
  FRAME_PX, PHOTO_PAD, MERCATOR_M_PER_PX_Z0, photoTiles,
} from '../../web/src/sitePlanPhoto'
import { naipTileUrl, NAIP_MAX_NATIVE_ZOOM } from '../../web/src/sitePlanGeometry'

/** Our own tile address (/p/tiles/<source>/z/x/y.jpg): its zoom and tile, and the tile's Mercator box. */
const SHARP = /^\/p\/tiles\/aerial\/(\d+)\/(\d+)\/(\d+)\.jpg$/
function tileOf(href: string) {
  const m = SHARP.exec(href)!
  const [z, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const world = 2 * Math.PI * 6378137, span = world / 2 ** z, x0 = -world / 2 + x * span, y1 = world / 2 - y * span
  return { z, x, y, bbox: [x0, y1 - span, x0 + span, y1] }
}

const OCALA = { lat: 29.19, lng: -82.14 }
const ft = (n: number) => n * 12

function straight(n: number): YardLayout {
  const l = layoutForShape('straight')
  l.sides[0].lengthIn = ft(n)
  return l
}
function backyard(): YardLayout {
  const l = layoutForShape('backyard')
  ;[30, 120, 150, 100, 30].forEach((n, i) => { l.sides[i].lengthIn = ft(n) })
  return l
}
function onPhoto(l: YardLayout, extra: Record<string, unknown> = {}): YardLayout {
  return { ...l, plan: { ...(l.plan ?? {}), aerial: { ...OCALA, halfM: 60, address: '1 Test Ln, Ocala, FL', shown: true, ...extra } } }
}

describe('true ground scale of the photo', () => {
  test('Web Mercator feet per pixel at Ocala (29.19°)', () => {
    // 156543.03392 × cos(29.19°) / 2^19 m = 0.26066 m = 0.85519 ft
    expect(mercatorFtPerPx(29.19, 19)).toBeCloseTo(0.85519, 4)
    expect(mercatorFtPerPx(29.19, 20)).toBeCloseTo(0.85519 / 2, 4)
    expect(mercatorFtPerPx(0, 0)).toBeCloseTo(MERCATOR_M_PER_PX_Z0 / 0.3048, 1)
  })

  test('the photo the app asks for is at real ground scale, the same as Mercator at its zoom', () => {
    for (const halfM of [40, 60, 150]) {
      const size = 800
      const b = photoBox(OCALA.lat, OCALA.lng, halfM)
      const mercPerPx = (toMercator(OCALA.lat, b.east).x - toMercator(OCALA.lat, b.west).x) / size
      // The photo's own zoom level, as a map tile would have it.
      const zoom = Math.log2(MERCATOR_M_PER_PX_Z0 / mercPerPx)
      const f = photoGroundFtPerPx(OCALA.lat, OCALA.lng, halfM, size)
      expect(f).toBeCloseTo(mercatorFtPerPx(OCALA.lat, zoom), 9)
      // halfM meters each way across 800 px: 2 × halfM m of ground.
      expect(f * size * 0.3048).toBeCloseTo(2 * halfM, 2)
      expect(Math.abs(f / aerialFtPerPx(halfM) - 1)).toBeLessThan(1e-4)
      // The bigger photo fetched (so a turned photo fills the corners) has the same scale.
      expect(photoGroundFtPerPx(OCALA.lat, OCALA.lng, halfM * PHOTO_PAD, size * PHOTO_PAD)).toBeCloseTo(f, 9)
    }
  })

  test('143 ft on the plan covers 143 ft of the photo', () => {
    const l = onPhoto(straight(143))
    const bd = photoBackdrop(l)!
    expect(bd.sizePx).toBe(FRAME_PX)
    expect(bd.imagePx).toBe(FRAME_PX * PHOTO_PAD)
    // Asked for as zoom-19 map tiles (the photo's real resolution), never more.
    const sharp = bd.tiles!.filter(t => SHARP.test(t.href)), soft = bd.tiles!.filter(t => !SHARP.test(t.href))
    expect(sharp.length).toBeGreaterThan(4)
    expect(sharp.every(t => tileOf(t.href).z === 19)).toBe(true)
    // Under them, the soft zoom-16 tiles (drawn first), only seen where a sharp tile is missing.
    expect(soft.length).toBeGreaterThan(0)
    expect(soft.every(t => /USGSImageryOnly\/MapServer\/tile\/16\//.test(t.href))).toBe(true)
    expect(bd.tiles!.indexOf(sharp[0])).toBe(soft.length)
    expect(soft[0].size / sharp[0].size).toBeCloseTo(8, 9)
    const svg = renderToStaticMarkup(createElement(SitePlan, { layout: l, result: deriveLayout(l), aerial: bd }))
    const m = svg.match(/<line x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)" stroke="#5E28A1"/)!
    const lenUnits = Math.hypot(Number(m[3]) - Number(m[1]), Number(m[4]) - Number(m[2]))
    // A drawing unit is one photo pixel.
    expect(lenUnits * bd.ftPerPx).toBeCloseTo(143, 1)
  })
})

describe('one photo source, never enlarged', () => {
  test('the quote photo and the map tiles: the same photo (our /p/tiles), the same closest zoom (19)', () => {
    expect(NAIP_MAX_NATIVE_ZOOM).toBe(19)
    // A zoom-19 tile is 256 px of 0.2986 Mercator meters: NAIP's own pixel (0.3 m).
    expect(naipTileUrl(19, 142518, 217669)).toBe('/p/tiles/aerial/19/142518/217669.jpg')
    const [x0, y0, x1, y1] = tileOf(naipTileUrl(19, 142518, 217669)).bbox
    expect(x1 - x0).toBeCloseTo(76.437, 2); expect(y1 - y0).toBeCloseTo(76.437, 2)
    // Ocala's tile at zoom 19 has Ocala in it.
    const lng = (x0 / 6378137) * 180 / Math.PI
    expect(lng).toBeCloseTo(-82.14, 2)
    // The quote photo is those same tiles, placed at the drawing's scale, covering the whole photo.
    for (const halfM of [60, 90, 225]) {
      const f = photoGroundFtPerPx(OCALA.lat, OCALA.lng, halfM, 1200)
      const tiles = photoTiles(OCALA.lat, OCALA.lng, halfM, f)
      for (const tl of tiles) {
        const [bx0, , bx1] = tileOf(tl.href).bbox
        expect(Math.log2(MERCATOR_M_PER_PX_Z0 / ((bx1 - bx0) / 256))).toBeCloseTo(NAIP_MAX_NATIVE_ZOOM, 9)
        // A tile's ground width over its drawn width is the drawing's scale.
        expect(((bx1 - bx0) * Math.cos(OCALA.lat * Math.PI / 180) / 0.3048) / tl.size).toBeCloseTo(f, 9)
      }
      const minX = Math.min(...tiles.map(t => t.x)), maxX = Math.max(...tiles.map(t => t.x + t.size))
      const minY = Math.min(...tiles.map(t => t.y)), maxY = Math.max(...tiles.map(t => t.y + t.size))
      expect(minX).toBeLessThanOrEqual(-600); expect(maxX).toBeGreaterThanOrEqual(600)
      expect(minY).toBeLessThanOrEqual(-600); expect(maxY).toBeGreaterThanOrEqual(600)
      // The point itself is at the photo's center: the tile holding it starts where the Mercator math says.
      const world = 2 * Math.PI * 6378137, tileM = world / 2 ** 19
      const c = toMercator(OCALA.lat, OCALA.lng)
      const hold = tiles.find(t => t.x <= 0 && t.x + t.size > 0 && t.y <= 0 && t.y + t.size > 0)!
      const hb = tileOf(hold.href).bbox
      expect(-hold.x / hold.size).toBeCloseTo((c.x - hb[0]) / tileM, 6)
      expect(-hold.y / hold.size).toBeCloseTo((hb[3] - c.y) / tileM, 6)
    }
  })
})

describe('turning the photo', () => {
  test('degrees are kept in (−180, 180]', () => {
    expect(normDeg(0)).toBe(0)
    expect(normDeg(-0)).toBe(0)
    expect(normDeg(180)).toBe(180)
    expect(normDeg(-180)).toBe(180)
    expect(normDeg(190)).toBe(-170)
    expect(normDeg(359)).toBe(-1)
    expect(normDeg(-361)).toBe(-1)
    expect(normDeg(12.34)).toBe(12.3)
    expect(normDeg(NaN)).toBe(0)
  })

  test('slider and twist move in whole degrees', () => {
    expect(stepDeg(12.4)).toBe(12)
    expect(stepDeg(12.6)).toBe(13)
    expect(stepDeg(180.4)).toBe(180)
    expect(stepDeg(181)).toBe(-179)
  })

  test('Line up: the tapped wall turns to the nearest level or upright wall of the drawn house', () => {
    const at = (deg: number, len = 100) => ({ x: 400 + len * Math.cos((deg * Math.PI) / 180), y: 400 + len * Math.sin((deg * Math.PI) / 180) })
    const o = { x: 400, y: 400 }
    // A wall 12° clockwise of level (screen, y down): the photo turns 12° back.
    expect(lineUpRotation(0, o, at(12))).toBeCloseTo(-12, 5)
    // 80°: nearest the upright wall, 10° more.
    expect(lineUpRotation(0, o, at(80))).toBeCloseTo(10, 5)
    // Tapped the other way along the wall: the same answer.
    expect(lineUpRotation(0, at(12), o)).toBeCloseTo(-12, 5)
    // Already turned 5°: adds to it.
    expect(lineUpRotation(5, o, at(3))).toBeCloseTo(2, 5)
    expect(lineUpRotation(170, o, at(20))).toBeCloseTo(150, 5)
    // Two taps on the same spot: no turn.
    expect(lineUpRotation(7, o, o)).toBe(7)
  })

  test('after Line up the two marks, turned with the photo, are level', () => {
    const a = { x: 300, y: 420 }, b = { x: 520, y: 470 }
    const next = lineUpRotation(0, a, b)
    const [a2, b2] = [a, b].map(p => turnAbout(p, next, FRAME_PX / 2, FRAME_PX / 2))
    // Kept to a tenth of a degree: level to within a fifth of a pixel over this wall.
    expect(Math.abs(a2.y - b2.y)).toBeLessThan(0.2)
    // The length along the wall is kept.
    expect(Math.hypot(b2.x - a2.x, b2.y - a2.y)).toBeCloseTo(Math.hypot(b.x - a.x, b.y - a.y), 6)
  })

  test('north turns with the photo; GPS spots and photo pins follow it', () => {
    // Turned a quarter clockwise: ground north points right on the drawing.
    const n = groundToFrame({ x: 0, y: 100 }, 90)
    expect(n.x).toBeCloseTo(100, 6); expect(n.y).toBeCloseTo(0, 6)
    const l = withPhotoView(onPhoto(backyard()), { rotDeg: 90, planAt: { x: 0, y: 0 } })
    expect(headingOnPhoto(l, 0)).toBe(90)
    expect(headingOnPhoto(l, 300)).toBe(30)
    // 50 ft north of the photo's center, with the plan's middle on the center.
    const m = planMiddle(l)
    const p = gpsToPlan(l, { x: 0, y: 50 })
    expect(p.x - m.x).toBeCloseTo(50, 6); expect(p.y - m.y).toBeCloseTo(0, 6)
    // An older quote (no turn, plan where its points are): as before, ground feet are plan feet.
    const old = onPhoto(backyard())
    expect(gpsToPlan(old, { x: 12, y: -7 })).toEqual({ x: 12, y: -7 })
    expect(headingOnPhoto(old, 45)).toBe(45)
  })
})

describe('saved with the quote', () => {
  test('turn and position round trip through the saved JSON; an older quote has neither', () => {
    const l = withPhotoView(onPhoto(backyard()), { rotDeg: -23, planAt: { x: 12.34, y: -5.06 } })
    const back = JSON.parse(JSON.stringify(l)) as YardLayout
    expect(photoView(back)).toEqual({ rotDeg: -23, planAt: { x: 12.3, y: -5.1 } })
    expect(back.plan?.aerial?.shown).toBe(true)
    const old = onPhoto(backyard())
    expect(photoView(old)).toEqual({ rotDeg: 0, planAt: null })
    expect(planShift(old)).toEqual({ x: 0, y: 0 })
    // No photo: nothing to turn.
    const plain = backyard()
    expect(withPhotoView(plain, { rotDeg: 30 })).toBe(plain)
  })

  test('turning or moving the photo never changes footage, sections or posts', () => {
    const l = onPhoto(backyard())
    const before = deriveLayout(l)
    const after = deriveLayout(withPhotoView(l, { rotDeg: 37, planAt: { x: 40, y: -12 } }))
    expect(after.runs).toEqual(before.runs)
    expect(after.totalIn).toBe(before.totalIn)
    expect([after.corners, after.ends]).toEqual([before.corners, before.ends])
  })

  test('the plan sits where it was moved: its middle at planAt on the drawing', () => {
    const l = withPhotoView(onPhoto(backyard()), { rotDeg: 10, planAt: { x: 20, y: -10 } })
    const bd = photoBackdrop(l)!
    const svg = renderToStaticMarkup(createElement(SitePlan, { layout: l, result: deriveLayout(l), aerial: bd, onPlanMove: () => {} }))
    const xs = [...svg.matchAll(/<rect x="([\d.]+)" y="([\d.]+)" width="12" height="12" fill="#5E28A1"/g)].map(m => [Number(m[1]) + 6, Number(m[2]) + 6])
    // The 4 corner posts: their middle is 20 ft right and 10 ft down of the frame's middle.
    const cx = (Math.min(...xs.map(p => p[0])) + Math.max(...xs.map(p => p[0]))) / 2
    expect((cx - FRAME_PX / 2) * bd.ftPerPx).toBeCloseTo(20, 0)
    expect(svg).toContain('data-plan-move')
    // On the photo the plan is not stretched: no corner handles, only the move button.
    expect(svg).not.toContain('data-plan-corner')
  })
})

describe('the drawing kept for the proposal and crew packet', () => {
  test('the photo turned, the north arrow turned the same, the angle on the drawing', () => {
    const l = withPhotoView(onPhoto(backyard()), { rotDeg: 30 })
    const bd = { ...photoBackdrop(l)!, href: 'data:image/jpeg;base64,/9j/AAAA', baked: true }
    const svg = renderToStaticMarkup(createElement(SitePlan, { layout: l, result: deriveLayout(l), aerial: bd }))
    expect(svg).toContain('data-photo-rotation="30"')
    expect(svg).toContain('data-plan-north="30"')
    // Baked: drawn flat, no transform (the PDF draws no transforms).
    expect(svg).toMatch(/<image href="data:image\/jpeg;base64,[^"]*" x="0" y="0" width="800" height="800"/)
    expect(svg).not.toContain('transform=')
    // The arrow's tip: 30° clockwise of straight up from its middle.
    const g = svg.match(/data-plan-north="30"><circle cx="([\d.]+)" cy="([\d.]+)"[^>]*><\/circle><polygon points="([^"]+)"/)!
    const [cx, cy] = [Number(g[1]), Number(g[2])]
    const [tx, ty] = g[3].split(' ')[0].split(',').map(Number)
    const ang = (Math.atan2(tx - cx, cy - ty) * 180) / Math.PI
    expect(ang).toBeCloseTo(30, 0)
    // The house is drawn on the photo, for lining up.
    expect(svg).toContain('data-plan-house')
  })

  test('live: the photo is turned under the square plan; no photo, no north arrow', () => {
    const l = withPhotoView(onPhoto(backyard()), { rotDeg: -15 })
    const svg = renderToStaticMarkup(createElement(SitePlan, { layout: l, result: deriveLayout(l), aerial: photoBackdrop(l) }))
    expect(svg).toContain('transform="translate(400 400) rotate(-15)"')
    expect((svg.match(/<image href="(\/p\/tiles\/aerial\/|https:\/\/basemap\.nationalmap\.gov)/g) ?? []).length).toBe(photoBackdrop(l)!.tiles!.length)
    const plain = renderToStaticMarkup(createElement(SitePlan, { layout: backyard(), result: deriveLayout(backyard()) }))
    expect(plain).not.toContain('data-plan-north')
    expect(plain).not.toContain('data-photo-rotation')
  })
})
