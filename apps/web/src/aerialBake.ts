/**
 * The aerial photo for the proposal and the crew packet: turned the way it was
 * saved and cut to the plan's frame on a canvas, then kept in the saved
 * drawing as a small JPEG. Those pages allow no outside pictures, and the
 * permit PDF cannot turn a picture, so the turn is done here once. Kept in
 * memory only (never in browser storage); the drawing is saved on the server
 * with the quote.
 */

import { photoBackdrop, normDeg, type AerialBackdrop } from './sitePlanPhoto'
import { again } from './aerialTiles'
import type { YardLayout } from './yardLayout'

/** Pixels across the baked photo (the drawing is 800 units; this keeps the saved drawing small). */
export const BAKED_PX = 640
/** Largest baked photo kept in a drawing (characters of its data URL); the saved drawing has a 400,000 character limit. */
export const BAKED_MAX = 250_000

const cache = new Map<string, Promise<string | null>>()

/** A picture, tried twice (the photo service sometimes drops a request). */
async function loadTwice(src: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  return (await loadImage(src, timeoutMs)) ?? (await loadImage(again(src, 1), timeoutMs))
}

export function loadImage(src: string, timeoutMs: number): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image()
    // Our own server (or the USGS soft tiles, which allow it), so the canvas can be read back.
    img.crossOrigin = 'anonymous'
    const t = setTimeout(() => resolve(null), timeoutMs)
    img.onload = () => { clearTimeout(t); resolve(img) }
    img.onerror = () => { clearTimeout(t); resolve(null) }
    img.src = src
  })
}

/** The photo turned `rotDeg` and cut to the frame, as a JPEG data URL; null when it cannot be had. */
export function bakePhoto(b: AerialBackdrop, outPx = BAKED_PX): Promise<string | null> {
  const rot = normDeg(b.rotDeg ?? 0)
  const key = `${b.href}|${rot}|${outPx}`
  const hit = cache.get(key)
  if (hit) return hit
  const job = (async () => {
    const tiles = b.tiles ?? [{ href: b.href, x: -(b.imagePx ?? b.sizePx) / 2, y: -(b.imagePx ?? b.sizePx) / 2, size: b.imagePx ?? b.sizePx }]
    const imgs = await Promise.all(tiles.map(t => loadTwice(t.href, 70_000)))
    if (!imgs.some(Boolean)) return null
    const canvas = document.createElement('canvas')
    canvas.width = outPx; canvas.height = outPx
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const W = b.sizePx
    // Exactly what the live drawing does: the photo centered on the frame, turned about its middle.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, outPx, outPx)
    ctx.scale(outPx / W, outPx / W)
    ctx.translate(W / 2, W / 2)
    ctx.rotate((rot * Math.PI) / 180)
    tiles.forEach((t, i) => { const img = imgs[i]; if (img) ctx.drawImage(img, t.x, t.y, t.size + 0.6, t.size + 0.6) })
    // The photo a little faded, as on screen (90% over white), with no darker seams where tiles meet.
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 0.1
    ctx.fillRect(0, 0, outPx, outPx)
    try {
      for (const q of [0.72, 0.6, 0.48]) {
        const url = canvas.toDataURL('image/jpeg', q)
        if (url.length <= BAKED_MAX) return url
      }
    } catch { /* the photo came without permission to read it back */ }
    return null
  })()
  cache.set(key, job)
  // A failure is not kept, so the next save tries again.
  job.then(u => { if (!u) cache.delete(key) })
  return job
}

/** The yard's photo, baked, for a saved drawing; null when the photo is off or could not be had in time. */
export async function bakedBackdrop(layout: YardLayout | null | undefined, waitMs = 15_000): Promise<AerialBackdrop | null> {
  if (!layout?.plan?.aerial?.shown) return null
  const b = photoBackdrop(layout)
  if (!b) return null
  const href = await Promise.race([bakePhoto(b), new Promise<null>(r => setTimeout(() => r(null), waitMs))])
  return href ? { ...b, href, baked: true } : null
}
