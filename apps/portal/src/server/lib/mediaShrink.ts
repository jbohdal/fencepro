/**
 * Space on the Mac: once a job has been Complete for a while (Settings,
 * default 90 days), its media is made smaller. A video keeps only its small
 * copy for viewing (the 720p one made at upload) and the large original is
 * removed; a photo bigger than 2400 px on its long side is scaled down to
 * 2400 px. Marked up copies are never touched, and nothing else is deleted.
 * Done once per item (shrunkAt). Twice a day, on the Mac, with ffmpeg (free).
 */

import fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import prisma from './prisma.js'
import { FFMPEG_BIN } from './voiceTranscribe.js'

const run = promisify(execFile)
export const DEFAULT_SHRINK_AFTER_DAYS = 90
export const PHOTO_MAX_PX = 2400

const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d)

/** The day on or before which a job's completion makes its media due (YYYY-MM-DD). */
export function shrinkCutoff(today: Date, days: number): string {
  return ymd(new Date(today.getTime() - days * 86_400_000))
}

async function settingDays(accountId: string): Promise<number> {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }).catch(() => null)
  const n = Number((b?.config as any)?.media?.shrinkAfterDays)
  return Number.isFinite(n) && n >= 30 ? Math.round(n) : DEFAULT_SHRINK_AFTER_DAYS
}

const size = (p: string) => { try { return fs.statSync(p).size } catch { return 0 } }

/** Shrink the media of jobs complete long enough. Returns what it did. */
export async function shrinkDueMedia(now = new Date()): Promise<{ videos: number; photos: number; savedBytes: number }> {
  const out = { videos: 0, photos: 0, savedBytes: 0 }
  if (!fs.existsSync(FFMPEG_BIN)) return out
  const accounts = await prisma.crmAccount.findMany({ select: { id: true } })
  for (const { id: accountId } of accounts) {
    const cutoff = shrinkCutoff(now, await settingDays(accountId))
    // all rows: photos of a deleted job are kept (and shrunk) so a restore gets them back.
    const jobs = await prisma.savedJob.findMany({
      where: { accountId, completedDate: { not: null, lte: cutoff }, NOT: { completedDate: '' } },
      select: { id: true, quoteId: true },
    })
    if (!jobs.length) continue
    const jobIds = jobs.map(j => j.id)
    const quoteIds = jobs.map(j => j.quoteId).filter((q): q is string => !!q)
    const items = await prisma.mediaItem.findMany({
      where: { accountId, deletedAt: null, shrunkAt: null, status: 'ready', OR: [{ jobId: { in: jobIds } }, ...(quoteIds.length ? [{ quoteKey: { in: quoteIds } }] : [])] },
    })
    for (const m of items) {
      try {
        if (m.kind === 'video') {
          // Keep the viewing copy only (it is what plays on a phone anyway).
          if (!m.previewPath || !fs.existsSync(m.previewPath) || m.previewPath === m.path) { await prisma.mediaItem.update({ where: { id: m.id }, data: { shrunkAt: now } }); continue }
          const before = size(m.path)
          await prisma.mediaItem.update({ where: { id: m.id }, data: { path: m.previewPath, mime: 'video/mp4', bytes: size(m.previewPath), shrunkAt: now } })
          fs.rmSync(m.path, { force: true })
          out.videos++; out.savedBytes += before
        } else {
          const long = Math.max(m.width ?? 0, m.height ?? 0)
          if (long > 0 && long <= PHOTO_MAX_PX) { await prisma.mediaItem.update({ where: { id: m.id }, data: { shrunkAt: now } }); continue }
          const before = size(m.path)
          const tmp = m.path.replace(/(\.[^.]+)$/, '.shrink$1')
          // Long side to 2400 px; the marked up copy (markupPath) stays as drawn.
          await run(FFMPEG_BIN, ['-loglevel', 'error', '-y', '-i', m.path, '-vf', `scale='if(gt(iw,ih),min(${PHOTO_MAX_PX},iw),-2)':'if(gt(iw,ih),-2,min(${PHOTO_MAX_PX},ih))'`, '-q:v', '3', tmp], { timeout: 120_000 })
          if (size(tmp) > 0 && size(tmp) < before) {
            fs.renameSync(tmp, m.path)
            const w = m.width ?? 0, h = m.height ?? 0
            const k = long > 0 ? PHOTO_MAX_PX / long : 1
            await prisma.mediaItem.update({ where: { id: m.id }, data: { bytes: size(m.path), width: w ? Math.round(w * k) : null, height: h ? Math.round(h * k) : null, shrunkAt: now } })
            out.photos++; out.savedBytes += before - size(m.path)
          } else {
            fs.rmSync(tmp, { force: true })
            await prisma.mediaItem.update({ where: { id: m.id }, data: { shrunkAt: now } })
          }
        }
      } catch (err) {
        console.error('[media-shrink] could not shrink', m.id, String((err as Error)?.message || err).slice(0, 200))
      }
    }
  }
  if (out.videos || out.photos) console.log(`[media-shrink] ${out.videos} videos and ${out.photos} photos made smaller, ${(out.savedBytes / 1e9).toFixed(2)} GB freed`)
  return out
}

export function startMediaShrink(): void {
  if (process.env.MEDIA_WORKER === 'off' || process.env.DISABLE_CRON === '1') return
  const tick = () => { shrinkDueMedia().catch(err => console.error('[media-shrink]', err)) }
  setTimeout(tick, 5 * 60_000).unref()
  setInterval(tick, 12 * 3_600_000).unref()
}
