/**
 * Photos and video: where the files live, signed links to view them, and the
 * work done on this Mac after an upload (ffmpeg, free): a thumbnail for each
 * photo, and for each video a poster frame and a smaller 720p copy for
 * viewing. The original is always kept.
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFile } from 'child_process'
import { promisify } from 'util'
import prisma from './prisma.js'
import { resolveSecret } from './secrets.js'
import { FFMPEG_BIN } from './voiceTranscribe.js'

const run = promisify(execFile)
const FFPROBE_BIN = process.env.FFPROBE_BIN || FFMPEG_BIN.replace(/ffmpeg$/, 'ffprobe')
// Its own secret when set; otherwise the login secret, so links survive restarts.
const SECRET = process.env.MEDIA_LINK_SECRET || resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

export const CATEGORIES = ['Site walk', 'Before', 'Gate location', 'Utilities and obstacles', 'HOA', 'Existing damage', 'Progress', 'Completed'] as const
export const VISIBILITY = ['internal', 'crew', 'customer'] as const
export type Variant = 'original' | 'markup' | 'preview' | 'thumb'

export function mediaDir(...parts: string[]): string {
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'media', ...parts)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// ── Signed links: an <img> or <video> cannot send a login header ──

export function signMedia(id: string, variant: Variant, expiresAt: number): string {
  return crypto.createHmac('sha256', SECRET).update(`${id}.${variant}.${expiresAt}`).digest('base64url').slice(0, 32)
}
export function mediaUrl(id: string, variant: Variant, ttlMs = 7 * 86_400_000, now = Date.now()): string {
  // Rounded to the hour so the same link comes back for a while (browser cache).
  const exp = Math.ceil((now + ttlMs) / 3_600_000) * 3_600_000
  return `/api/media/f/${id}/${variant}?e=${exp}&s=${signMedia(id, variant, exp)}`
}
export function checkMediaSig(id: string, variant: string, e: string, s: string): boolean {
  const exp = Number(e)
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  const want = signMedia(id, variant as Variant, exp)
  return want.length === s.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))
}

/** What the app gets for one item: its details and links to each version. */
export function serializeMedia(m: any, ttlMs?: number) {
  const link = (v: Variant) => mediaUrl(m.id, v, ttlMs)
  return {
    id: m.id, clientId: m.clientId, kind: m.kind, mime: m.mime, bytes: m.bytes, width: m.width, height: m.height, durationMs: m.durationMs,
    quoteKey: m.quoteKey, jobId: m.jobId, customerId: m.customerId, takenBy: m.takenBy, takenAt: m.takenAt,
    lat: m.lat, lng: m.lng, accuracyM: m.accuracyM, heading: m.heading, caption: m.caption, category: m.category,
    visibility: m.visibility, pin: m.pin, status: m.status, source: m.source,
    url: link('original'),
    markupUrl: m.markupPath ? link('markup') : null,
    previewUrl: m.previewPath ? link('preview') : null,
    thumbUrl: m.thumbPath ? link('thumb') : null,
  }
}

// ── After upload ──

let busy = false

export async function processMediaQueue(): Promise<void> {
  if (busy || !fs.existsSync(FFMPEG_BIN)) return
  busy = true
  try {
    for (;;) {
      const m = await prisma.mediaItem.findFirst({ where: { status: 'processing', deletedAt: null }, orderBy: { createdAt: 'asc' } })
      if (!m) return
      try {
        const base = m.path.replace(/\.[^.]+$/, '')
        const info = await probe(m.path)
        const data: any = { width: info.width, height: info.height, durationMs: info.durationMs, status: 'ready' }
        if (m.kind === 'video') {
          const poster = `${base}.thumb.jpg`
          await run(FFMPEG_BIN, ['-loglevel', 'error', '-y', '-ss', info.durationMs && info.durationMs > 1500 ? '1' : '0', '-i', m.path, '-frames:v', '1', '-vf', "scale='min(640,iw)':-2", '-q:v', '4', poster], { timeout: 120_000 })
          data.thumbPath = poster
          // A smaller copy for watching on a phone; the original stays as it was.
          const preview = `${base}.preview.mp4`
          await run(FFMPEG_BIN, ['-loglevel', 'error', '-y', '-i', m.path, '-vf', "scale=-2:'min(720,ih)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', preview], { timeout: 30 * 60_000 })
          data.previewPath = preview
        } else {
          const thumb = `${base}.thumb.jpg`
          await run(FFMPEG_BIN, ['-loglevel', 'error', '-y', '-i', m.path, '-vf', "scale='min(640,iw)':-2", '-q:v', '4', thumb], { timeout: 120_000 })
          data.thumbPath = thumb
        }
        await prisma.mediaItem.update({ where: { id: m.id }, data })
      } catch (err) {
        console.error('[media] processing failed for', m.id, String((err as Error)?.message || err).slice(0, 300))
        // The original is still there and still shown.
        await prisma.mediaItem.update({ where: { id: m.id }, data: { status: 'failed' } })
      }
    }
  } finally {
    busy = false
  }
}

async function probe(file: string): Promise<{ width: number | null; height: number | null; durationMs: number | null }> {
  try {
    const { stdout } = await run(FFPROBE_BIN, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file], { timeout: 60_000 })
    const j = JSON.parse(stdout)
    const s = j.streams?.[0] ?? {}
    const d = Number(j.format?.duration)
    return { width: s.width ?? null, height: s.height ?? null, durationMs: Number.isFinite(d) ? Math.round(d * 1000) : null }
  } catch { return { width: null, height: null, durationMs: null } }
}

export async function startMediaWorker(): Promise<void> {
  if (process.env.MEDIA_WORKER === 'off') return
  processMediaQueue().catch(err => console.error('[media] queue:', err))
  setInterval(() => { processMediaQueue().catch(err => console.error('[media] queue:', err)) }, 60_000).unref()
  // Uploads that never finished are dropped after 14 days.
  setInterval(async () => {
    const old = await prisma.mediaUpload.findMany({ where: { updatedAt: { lt: new Date(Date.now() - 14 * 86_400_000) } } }).catch(() => [])
    for (const u of old) { fs.rm(u.path, { force: true }, () => {}); await prisma.mediaUpload.delete({ where: { clientId: u.clientId } }).catch(() => {}) }
  }, 12 * 3_600_000).unref()
}
