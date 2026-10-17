/**
 * Media made smaller after a job has been Complete long enough, against the
 * dev database and real files (DEV_DB=1; refuses any other database). Makes a
 * finished job with a 4000 x 3000 photo (and its marked up copy) and a video
 * with its viewing copy, shrinks, checks, and removes them.
 */

import 'dotenv/config'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { describe, test, expect, afterAll } from 'vitest'

const onDev = /\/ezbiz_dev(\?|$)/.test(process.env.DATABASE_URL || '')
describe.skipIf(!process.env.DEV_DB || !onDev)('media shrink (dev database)', async () => {
  const { default: prisma } = await import('../src/server/lib/prisma.js')
  const { shrinkDueMedia, shrinkCutoff } = await import('../src/server/lib/mediaShrink.js')
  const { FFMPEG_BIN } = await import('../src/server/lib/voiceTranscribe.js')
  const account = (await prisma.crmAccount.findFirst({ orderBy: { createdAt: 'asc' } }))!
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ezbiz-shrink-'))
  const ff = (...a: string[]) => execFileSync(FFMPEG_BIN, ['-loglevel', 'error', '-y', ...a])
  const made: { job?: string; media: string[] } = { media: [] }
  afterAll(async () => {
    await prisma.mediaItem.deleteMany({ where: { id: { in: made.media } } })
    if (made.job) await prisma.savedJob.deleteMany({ where: { id: made.job } })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  test('a finished job: video keeps its viewing copy only, photo to 2400 px, markup untouched; a recent job is left alone', async () => {
    const photo = path.join(dir, 'big.jpg'), markup = path.join(dir, 'big.markup.png'), video = path.join(dir, 'clip.mov'), preview = path.join(dir, 'clip.preview.mp4')
    ff('-f', 'lavfi', '-i', 'testsrc2=size=4000x3000', '-frames:v', '1', '-q:v', '2', photo)
    ff('-f', 'lavfi', '-i', 'testsrc2=size=4000x3000', '-frames:v', '1', markup)
    ff('-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30', '-t', '3', '-c:v', 'libx264', '-crf', '12', video)
    ff('-i', video, '-vf', "scale=-2:720", '-c:v', 'libx264', '-crf', '28', preview)
    const markupBefore = fs.readFileSync(markup)
    const videoBytes = fs.statSync(video).size

    const finished = new Date(Date.parse(`${shrinkCutoff(new Date(), 90)}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10)
    const job = await prisma.savedJob.create({ data: { accountId: account.id, customerName: 'E2E Shrink', status: 'completed', completedDate: finished } as any })
    made.job = job.id
    const base = { accountId: account.id, jobId: job.id, takenAt: new Date(), status: 'ready' }
    const p = await prisma.mediaItem.create({ data: { ...base, clientId: `e2e-shrink-p-${Date.now()}`, kind: 'photo', mime: 'image/jpeg', path: photo, markupPath: markup, width: 4000, height: 3000, bytes: fs.statSync(photo).size } })
    const v = await prisma.mediaItem.create({ data: { ...base, clientId: `e2e-shrink-v-${Date.now()}`, kind: 'video', mime: 'video/quicktime', path: video, previewPath: preview, bytes: videoBytes } })
    made.media.push(p.id, v.id)

    const r = await shrinkDueMedia()
    expect(r.videos).toBeGreaterThanOrEqual(1)
    expect(r.photos).toBeGreaterThanOrEqual(1)
    const p2 = (await prisma.mediaItem.findUnique({ where: { id: p.id } }))!
    const v2 = (await prisma.mediaItem.findUnique({ where: { id: v.id } }))!
    const dims = execFileSync(FFMPEG_BIN.replace(/ffmpeg$/, 'ffprobe'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', photo], { encoding: 'utf8' }).trim()
    expect(dims).toBe('2400,1800')
    expect([p2.width, p2.height, !!p2.shrunkAt]).toEqual([2400, 1800, true])
    expect(fs.readFileSync(markup).equals(markupBefore)).toBe(true)
    expect(fs.existsSync(video)).toBe(false)
    expect([v2.path, v2.mime, !!v2.shrunkAt]).toEqual([preview, 'video/mp4', true])
    // Once only: a second run does nothing more.
    const again = await shrinkDueMedia()
    expect(again.videos + again.photos).toBe(0)

    // A job finished yesterday is not touched.
    const recent = await prisma.savedJob.create({ data: { accountId: account.id, customerName: 'E2E Shrink recent', status: 'completed', completedDate: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10) } as any })
    const fresh = path.join(dir, 'fresh.jpg'); ff('-f', 'lavfi', '-i', 'testsrc2=size=4000x3000', '-frames:v', '1', fresh)
    const f = await prisma.mediaItem.create({ data: { ...base, jobId: recent.id, clientId: `e2e-shrink-f-${Date.now()}`, kind: 'photo', mime: 'image/jpeg', path: fresh, width: 4000, height: 3000 } })
    made.media.push(f.id)
    await shrinkDueMedia()
    expect((await prisma.mediaItem.findUnique({ where: { id: f.id } }))!.shrunkAt).toBeNull()
    await prisma.savedJob.delete({ where: { id: recent.id } })
  }, 120_000)
})
