/**
 * The aerial photo under the site plan: its true ground scale, how far it is
 * turned, and where the plan sits on it. Pure (no browser), so the unit tests
 * check exactly what the app draws.
 *
 * The plan is always drawn square and level, at the photo's real ground
 * scale (143 ft on the plan covers 143 ft of ground). Only the photo turns:
 * `rotDeg` turns it clockwise on screen about its own center, which is the
 * middle of the drawing. `planAt` is where the middle of the plan sits on the
 * drawing, in feet right and up of that center. Both are saved with the
 * quote's yard (layout.plan.aerial); a quote saved before these existed has
 * neither and draws as it always did (photo north up, plan where its points
 * put it). Neither ever changes footage, sections or price.
 */

import { planVertices, naipTileUrl, usgsBackupTileUrl, NAIP_MAX_NATIVE_ZOOM, USGS_BACKUP_MAX_ZOOM } from './sitePlanGeometry'
import type { PlanPoint, YardLayout } from './yardLayout'

/** Earth radius used by Web Mercator (EPSG:3857), meters. */
export const MERCATOR_R = 6378137
/** Web Mercator meters per pixel at zoom 0 on the equator (256 px tiles). */
export const MERCATOR_M_PER_PX_Z0 = 156543.03392
export const M_PER_FT = 0.3048

/** Pixels across the drawing's frame (the photo frame is square). */
export const FRAME_PX = 800
/** The photo is fetched this much bigger than the frame, so a turned photo still fills the corners (more than the square root of 2). */
export const PHOTO_PAD = 1.5

/** Real ground feet per pixel of a Web Mercator map tile at `zoom`, at latitude `lat`. */
export function mercatorFtPerPx(lat: number, zoom: number): number {
  return (MERCATOR_M_PER_PX_Z0 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom / M_PER_FT
}

/** Web Mercator x and y (meters) of a point. */
export function toMercator(lat: number, lng: number): { x: number; y: number } {
  const x = (MERCATOR_R * lng * Math.PI) / 180
  const y = MERCATOR_R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))
  return { x, y }
}

/** The lat/lng box the photo of `halfM` meters each way around a point asks for. */
export function photoBox(lat: number, lng: number, halfM: number): { west: number; south: number; east: number; north: number } {
  const dLat = halfM / 111320
  const dLng = halfM / (111320 * Math.cos((lat * Math.PI) / 180))
  return { west: lng - dLng, south: lat - dLat, east: lng + dLng, north: lat + dLat }
}

/**
 * Real ground feet per pixel of the photo of that box at `sizePx` across.
 * The photo comes back in Web Mercator (imageSR 3857), so a pixel is the box's
 * Mercator width over the pixels, times cos(latitude) to get back to ground.
 */
export function photoGroundFtPerPx(lat: number, lng: number, halfM: number, sizePx: number): number {
  const b = photoBox(lat, lng, halfM)
  const w = toMercator(lat, b.east).x - toMercator(lat, b.west).x
  return ((w / sizePx) * Math.cos((lat * Math.PI) / 180)) / M_PER_FT
}

/** One map tile of the photo, placed on the drawing: units from the photo's center (y down), `size` across. */
export interface PhotoTile { href: string; x: number; y: number; size: number }

/**
 * The photo as zoom-19 map tiles from the same service and request the Site
 * Plans map uses (NAIP Plus, 256 px, its real resolution: never enlarged by
 * the server), covering `halfM` meters each way around the point, placed at
 * the drawing's scale (`ftPerPx` feet per drawing unit). Small requests also
 * come back when one big picture of the same yard would time out.
 */
export function photoTiles(lat: number, lng: number, halfM: number, ftPerPx: number, z = NAIP_MAX_NATIVE_ZOOM, url: (z: number, x: number, y: number) => string = naipTileUrl): PhotoTile[] {
  const world = 2 * Math.PI * MERCATOR_R, tileM = world / 2 ** z
  const cos = Math.cos((lat * Math.PI) / 180)
  const c = toMercator(lat, lng)
  const xc = (c.x + world / 2) / tileM, yc = (world / 2 - c.y) / tileM
  const unit = (tileM * cos) / M_PER_FT / ftPerPx
  const half = halfM / cos / tileM
  const out: PhotoTile[] = []
  for (let ty = Math.floor(yc - half); ty <= Math.floor(yc + half); ty++) {
    for (let tx = Math.floor(xc - half); tx <= Math.floor(xc + half); tx++) {
      out.push({ href: url(z, tx, ty), x: (tx - xc) * unit, y: (ty - yc) * unit, size: unit })
    }
  }
  return out
}

/** Degrees in (−180, 180]. */
export function normDeg(d: number): number {
  if (!Number.isFinite(d)) return 0
  let r = ((d % 360) + 360) % 360
  if (r > 180) r -= 360
  // Keep a tenth of a degree, and never "-0".
  r = Math.round(r * 10) / 10
  return r === 0 ? 0 : r
}

/** One-degree steps (the slider, the +/- buttons and the two-finger twist). */
export function stepDeg(d: number): number {
  return normDeg(Math.round(d))
}

/**
 * Line up: two taps along one wall of the house on the photo (drawing units,
 * y down, as the screen). The drawn house is square and level, so its walls
 * run at 0, 90, 180 or 270 degrees; the photo turns by the smallest amount
 * that puts the tapped wall on the nearest of those. Returns the new turn.
 */
export function lineUpRotation(rotDeg: number, a: PlanPoint, b: PlanPoint): number {
  const dx = b.x - a.x, dy = b.y - a.y
  if (Math.hypot(dx, dy) < 1e-6) return normDeg(rotDeg)
  const wall = (Math.atan2(dy, dx) * 180) / Math.PI
  const level = Math.round(wall / 90) * 90
  return normDeg(rotDeg + (level - wall))
}

/** A point on the drawing (y down) turned clockwise by `deg` about (cx, cy). */
export function turnAbout(p: PlanPoint, deg: number, cx: number, cy: number): PlanPoint {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  const x = p.x - cx, y = p.y - cy
  return { x: cx + x * c - y * s, y: cy + x * s + y * c }
}

/** Ground feet (east, north of the photo center) to drawing feet (right, up of the frame center) with the photo turned `rotDeg` clockwise. */
export function groundToFrame(g: PlanPoint, rotDeg: number): PlanPoint {
  const r = (rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r)
  return { x: g.x * c + g.y * s, y: -g.x * s + g.y * c }
}

/** Which way true north points on the drawing: degrees clockwise from straight up. */
export function northDeg(rotDeg: number): number {
  return normDeg(rotDeg)
}

export interface PhotoView { rotDeg: number; planAt: PlanPoint | null }

/** The saved turn and position (none on an older quote: 0 and "where the points put it"). */
export function photoView(layout: YardLayout | null | undefined): PhotoView {
  const a = layout?.plan?.aerial
  const rot = typeof a?.rotDeg === 'number' && Number.isFinite(a.rotDeg) ? normDeg(a.rotDeg) : 0
  const p = a?.planAt
  const planAt = p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x, y: p.y } : null
  return { rotDeg: rot, planAt }
}

/** The middle of the plan's corners, in plan feet. */
export function planMiddle(layout: YardLayout): PlanPoint {
  const v = planVertices(layout)
  if (!v.length) return { x: 0, y: 0 }
  const xs = v.map(p => p.x), ys = v.map(p => p.y)
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

/** How far the plan is shifted on the drawing (feet): a plan point p is drawn at p + shift. */
export function planShift(layout: YardLayout): PlanPoint {
  const { planAt } = photoView(layout)
  if (!planAt) return { x: 0, y: 0 }
  const m = planMiddle(layout)
  return { x: planAt.x - m.x, y: planAt.y - m.y }
}

/** Where the plan's middle is on the drawing now (a saved spot, or where its points put it). */
export function currentPlanAt(layout: YardLayout): PlanPoint {
  return photoView(layout).planAt ?? planMiddle(layout)
}

/** The layout with a new turn and/or position for the photo. Footage, sections and price are not touched. */
export function withPhotoView(layout: YardLayout, v: Partial<PhotoView>): YardLayout {
  const a = layout.plan?.aerial
  if (!a) return layout
  const next = { ...a }
  if (v.rotDeg !== undefined) next.rotDeg = normDeg(v.rotDeg)
  if (v.planAt !== undefined) next.planAt = v.planAt ? { x: Math.round(v.planAt.x * 10) / 10, y: Math.round(v.planAt.y * 10) / 10 } : null
  return { ...layout, plan: { ...(layout.plan ?? {}), aerial: next } }
}

/**
 * The photo as the site plan draws it. `href` is the photo; `ftPerPx` is
 * feet per drawing unit (the photo's real ground scale), `sizePx` the frame,
 * `imagePx` how big the photo is drawn (centered on the frame), `rotDeg` how
 * far it is turned and `shiftFt` how far the plan is moved on it. `baked`:
 * `href` is already turned and cut to the frame (proposal, crew packet).
 */
export interface AerialBackdrop {
  /** The picture (baked), or a key naming the tiles below. */
  href: string
  /** The photo as map tiles, centered on the frame (the live drawing). */
  tiles?: PhotoTile[]
  ftPerPx: number
  sizePx: number
  imagePx?: number
  rotDeg?: number
  shiftFt?: PlanPoint
  baked?: boolean
}

/** The photo for this yard (null when it has none), turned and moved as saved. */
export function photoBackdrop(layout: YardLayout | null | undefined): AerialBackdrop | null {
  const a = layout?.plan?.aerial
  if (!layout || !a) return null
  const imagePx = Math.round(FRAME_PX * PHOTO_PAD)
  const ftPerPx = photoGroundFtPerPx(a.lat, a.lng, a.halfM * PHOTO_PAD, imagePx)
  return {
    href: `naip-z${NAIP_MAX_NATIVE_ZOOM}:${a.lat},${a.lng},${a.halfM * PHOTO_PAD}`,
    // The soft older tiles first, under the sharp ones: a sharp tile the service does not send shows soft, not white.
    tiles: [
      ...photoTiles(a.lat, a.lng, a.halfM * PHOTO_PAD, ftPerPx, USGS_BACKUP_MAX_ZOOM, usgsBackupTileUrl),
      ...photoTiles(a.lat, a.lng, a.halfM * PHOTO_PAD, ftPerPx),
    ],
    ftPerPx,
    sizePx: FRAME_PX, imagePx,
    rotDeg: photoView(layout).rotDeg,
    shiftFt: planShift(layout),
  }
}

/** A GPS position as a spot on the plan (feet), with the photo turned and the plan moved. */
export function gpsToPlan(layout: YardLayout, ground: PlanPoint): PlanPoint {
  const { rotDeg } = photoView(layout)
  const f = groundToFrame(ground, rotDeg)
  const s = planShift(layout)
  return { x: f.x - s.x, y: f.y - s.y }
}

/** A compass heading as an angle on the drawing (0 = up the page, clockwise). */
export function headingOnPhoto(layout: YardLayout, heading: number): number {
  const r = photoView(layout).rotDeg
  return (((heading + r) % 360) + 360) % 360
}
