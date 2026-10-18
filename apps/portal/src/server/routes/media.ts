/**
 * Photos and video on quotes, jobs and customers.
 *
 * Uploads are resumable: the phone starts an upload, sends the file in
 * chunks (each says where it starts), and finishes it. A chunk sent twice is
 * ignored, and after lost signal the phone asks how much arrived and carries
 * on from there. The item is made once per phone id (clientId), so nothing
 * is doubled. Files are served through signed links (lib/media.ts).
 */

import { Router } from 'express'
import crypto from 'crypto'
import express from 'express'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { withLock } from '../lib/once.js'
import { recordPhotoUploaded } from '../lib/automations/hooks.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { mediaDir, serializeMedia, processMediaQueue, checkMediaSig, CATEGORIES, VISIBILITY } from '../lib/media.js'
import { plainZod } from '../lib/plainZod.js'

const router = Router()
const MAX_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB
const CHUNK_LIMIT = '12mb'
const TYPES = /^(image\/(jpeg|png|webp|heic|heif)|video\/(mp4|quicktime|webm|3gpp))$/

const extFor = (mime: string) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'video/3gpp': '3gp' } as Record<string, string>)[mime] ?? 'bin'

// ── Viewing: signed links, no login header (an <img> cannot send one) ──

router.get('/f/:id/:variant', (req, res) => serveSignedMedia(req, res))

/** A signed media link: checks the signature, then sends the file with Range support. */
export async function serveSignedMedia(req: any, res: any) {
  const { id, variant } = req.params
  if (!checkMediaSig(id, variant, String(req.query.e || ''), String(req.query.s || ''))) { res.status(403).end(); return }
  const m = await prisma.mediaItem.findUnique({ where: { id } }).catch(() => null)
  if (!m || m.deletedAt) { res.status(404).end(); return }
  const file = variant === 'markup' ? m.markupPath : variant === 'preview' ? m.previewPath : variant === 'thumb' ? m.thumbPath : m.path
  if (!file || !fs.existsSync(file)) { res.status(404).end(); return }
  const type = variant === 'thumb' || variant === 'markup' ? 'image/jpeg' : variant === 'preview' ? 'video/mp4' : m.mime
  sendWithRange(req, res, file, type)
}

/** Serves a file, honoring Range so video plays (and seeks) on an iPhone. */
function sendWithRange(req: any, res: any, file: string, type: string) {
  const size = fs.statSync(file).size
  res.setHeader('Content-Type', type)
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''))
  if (m) {
    let start = m[1] === '' ? size - Number(m[2]) : Number(m[1])
    let end = m[1] === '' || m[2] === '' ? size - 1 : Number(m[2])
    if (!(start >= 0) || start >= size) { res.status(416).setHeader('Content-Range', `bytes */${size}`); res.end(); return }
    end = Math.min(end, size - 1); start = Math.max(0, start)
    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', String(end - start + 1))
    fs.createReadStream(file, { start, end }).pipe(res)
    return
  }
  res.setHeader('Content-Length', String(size))
  fs.createReadStream(file).pipe(res)
}

// Everything below needs a signed in staff user.
router.use(requireUser, requireAccount)

const metaSchema = z.object({
  kind: z.enum(['photo', 'video']),
  mime: z.string().regex(TYPES, 'Not a photo or video this app takes'),
  quoteKey: z.string().max(100).optional().nullable(),
  jobId: z.string().max(100).optional().nullable(),
  customerId: z.string().max(100).optional().nullable(),
  takenAt: z.string().datetime().optional(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  accuracyM: z.number().min(0).optional().nullable(),
  heading: z.number().min(0).max(360).optional().nullable(),
  caption: z.string().max(2000).optional(),
  category: z.enum(CATEGORIES).optional(),
  visibility: z.enum(VISIBILITY).optional(),
  pin: z.object({ x: z.number(), y: z.number(), angle: z.number().nullable().optional() }).nullable().optional(),
})

const startSchema = z.object({ clientId: z.string().min(8).max(100), size: z.number().int().positive().max(MAX_BYTES), meta: metaSchema })

// Start (or resume) an upload: says how many bytes already arrived.
router.post('/uploads', express.json({ limit: '64kb' }), async (req: any, res) => {
  try {
    const b = startSchema.parse(req.body)
    const done = await prisma.mediaItem.findUnique({ where: { clientId: b.clientId } })
    if (done && done.accountId !== req.user.crmAccountId) { res.status(409).json({ success: false, error: 'Invalid id' }); return }
    if (done) { res.json({ success: true, data: { done: true, item: serializeMedia(done) } }); return }
    const existing = await prisma.mediaUpload.findUnique({ where: { clientId: b.clientId } })
    if (existing) {
      const onDisk = fs.existsSync(existing.path) ? fs.statSync(existing.path).size : 0
      if (onDisk !== existing.received) await prisma.mediaUpload.update({ where: { clientId: b.clientId }, data: { received: onDisk } })
      res.json({ success: true, data: { received: onDisk } }); return
    }
    const tmp = path.join(mediaDir('incoming'), `${b.clientId.replace(/[^\w-]/g, '')}.part`)
    fs.writeFileSync(tmp, Buffer.alloc(0))
    await prisma.mediaUpload.create({ data: { clientId: b.clientId, accountId: req.user.crmAccountId, userId: req.user.id, size: b.size, path: tmp, meta: b.meta as any } })
    res.json({ success: true, data: { received: 0 } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[media] start:', err); res.status(500).json({ success: false, error: 'Could not start the upload' })
  }
})

// One chunk, starting at ?offset=. A chunk already received is ignored.
router.put('/uploads/:clientId', express.raw({ type: '*/*', limit: CHUNK_LIMIT }), async (req: any, res) => {
  const u = await prisma.mediaUpload.findUnique({ where: { clientId: String(req.params.clientId) } })
  if (!u || u.accountId !== req.user.crmAccountId) { res.status(404).json({ success: false, error: 'No such upload' }); return }
  const offset = Number(req.query.offset)
  const body: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  const have = fs.existsSync(u.path) ? fs.statSync(u.path).size : 0
  if (!Number.isInteger(offset) || offset < 0) { res.status(400).json({ success: false, error: 'offset is required' }); return }
  if (offset > have) { res.status(409).json({ success: false, error: 'Missing bytes before this chunk', data: { received: have } }); return }
  if (offset + body.length <= have) { res.json({ success: true, data: { received: have } }); return }
  // Part of the chunk may already be here (sent, but the reply was lost).
  const fresh = body.subarray(have - offset)
  if (have + fresh.length > u.size) { res.status(400).json({ success: false, error: 'More bytes than the file has' }); return }
  fs.appendFileSync(u.path, fresh)
  const received = have + fresh.length
  await prisma.mediaUpload.update({ where: { clientId: u.clientId }, data: { received } })
  res.json({ success: true, data: { received } })
})

// All bytes are in: make the item and start the work on this Mac.
router.post('/uploads/:clientId/finish', async (req: any, res) => {
  const clientId = String(req.params.clientId)
  // Finish sent twice at the same moment: the second waits for the first, then returns its item.
  try {
    await withLock(`media:${clientId}`, () => finishUpload(req, res, clientId))
  } catch (err) {
    console.error('[media] finish:', err)
    if (!res.headersSent) res.status(500).json({ success: false, error: 'Could not save the photo' })
  }
})

async function finishUpload(req: any, res: any, clientId: string): Promise<void> {
  const done = await prisma.mediaItem.findUnique({ where: { clientId } })
  if (done && done.accountId !== req.user.crmAccountId) { res.status(404).json({ success: false, error: 'No such upload' }); return }
  if (done) { res.json({ success: true, data: serializeMedia(done) }); return }
  const u = await prisma.mediaUpload.findUnique({ where: { clientId } })
  if (!u || u.accountId !== req.user.crmAccountId) { res.status(404).json({ success: false, error: 'No such upload' }); return }
  const have = fs.existsSync(u.path) ? fs.statSync(u.path).size : 0
  if (have !== u.size) { res.status(409).json({ success: false, error: 'Not all of the file has arrived', data: { received: have } }); return }
  const meta = metaSchema.parse(u.meta)
  const user = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  const id = crypto.randomUUID()
  const final = path.join(mediaDir(u.accountId), `${id}.${extFor(meta.mime)}`)
  fs.renameSync(u.path, final)
  // The photo and its "photo uploaded" automation event are saved together.
  const item = await prisma.$transaction(async tx => { const made = await tx.mediaItem.create({
    data: {
      id, accountId: u.accountId, clientId, kind: meta.kind, mime: meta.mime, path: final, bytes: have,
      quoteKey: meta.quoteKey ?? null, jobId: meta.jobId ?? null, customerId: meta.customerId ?? null,
      takenBy: user ? `${user.firstName} ${user.lastName}`.trim() : req.user.email, takenById: req.user.id,
      takenAt: meta.takenAt ? new Date(meta.takenAt) : new Date(),
      lat: meta.lat ?? null, lng: meta.lng ?? null, accuracyM: meta.accuracyM ?? null, heading: meta.heading ?? null,
      caption: meta.caption ?? '', category: meta.category ?? 'Site walk', visibility: meta.visibility ?? 'internal',
      pin: meta.pin ?? undefined,
    },
  }); await recordPhotoUploaded(u.accountId, made, tx); return made })
  await prisma.mediaUpload.delete({ where: { clientId } }).catch(() => {})
  processMediaQueue().catch(err => console.error('[media] queue:', err))
  res.json({ success: true, data: serializeMedia(item) })
}

// ── List: a quote's, a job's (and its quote's), a customer's (and their quotes' and jobs') ──

router.get('/', async (req: any, res) => {
  const accountId = req.user.crmAccountId
  const quoteKey = req.query.quoteKey ? String(req.query.quoteKey) : null
  const jobId = req.query.jobId ? String(req.query.jobId) : null
  const customerId = req.query.customerId ? String(req.query.customerId) : null
  const or: any[] = []
  if (quoteKey) or.push({ quoteKey })
  if (jobId) {
    or.push({ jobId })
    const job = await prisma.savedJob.findUnique({ where: { id: jobId }, select: { quoteId: true, accountId: true } }).catch(() => null)
    if (job?.quoteId && job.accountId === accountId) or.push({ quoteKey: job.quoteId })
  }
  if (customerId) {
    or.push({ customerId })
    const quotes = await prisma.savedQuote.findMany({ where: { accountId, crmContactId: customerId }, select: { id: true } })
    const jobs = await prisma.savedJob.findMany({ where: { accountId, crmContactId: customerId }, select: { id: true } }).catch(() => [])
    if (quotes.length) or.push({ quoteKey: { in: quotes.map(q => q.id) } })
    if (jobs.length) or.push({ jobId: { in: jobs.map(j => j.id) } })
  }
  if (or.length === 0) { res.status(400).json({ success: false, error: 'quoteKey, jobId or customerId is required' }); return }
  const items = await prisma.mediaItem.findMany({ where: { accountId, deletedAt: null, OR: or }, orderBy: { takenAt: 'asc' } })
  res.json({ success: true, data: items.map(m => serializeMedia(m)) })
})

const patchSchema = metaSchema.pick({ caption: true, category: true, visibility: true, pin: true, quoteKey: true, jobId: true, customerId: true }).partial()

router.patch('/:id', express.json({ limit: '64kb' }), async (req: any, res) => {
  try {
    const b = patchSchema.parse(req.body)
    const m = await prisma.mediaItem.findFirst({ where: { id: String(req.params.id), accountId: req.user.crmAccountId, deletedAt: null } })
    if (!m) { res.status(404).json({ success: false, error: 'Not found' }); return }
    const updated = await prisma.mediaItem.update({ where: { id: m.id }, data: { ...b, pin: b.pin === null ? (null as any) : b.pin } })
    res.json({ success: true, data: serializeMedia(updated) })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[media] patch:', err); res.status(500).json({ success: false, error: 'Could not save' })
  }
})

// The marked up version, saved beside the original.
const markupUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } })
router.post('/:id/markup', markupUpload.single('image'), async (req: any, res) => {
  const m = await prisma.mediaItem.findFirst({ where: { id: String(req.params.id), accountId: req.user.crmAccountId, deletedAt: null } })
  if (!m) { res.status(404).json({ success: false, error: 'Not found' }); return }
  if (!req.file || !/^image\/(jpeg|png)$/.test(req.file.mimetype)) { res.status(400).json({ success: false, error: 'A JPEG or PNG is required' }); return }
  const file = m.path.replace(/\.[^.]+$/, '') + `.markup.${req.file.mimetype === 'image/png' ? 'png' : 'jpg'}`
  fs.writeFileSync(file, req.file.buffer)
  const updated = await prisma.mediaItem.update({ where: { id: m.id }, data: { markupPath: file } })
  res.json({ success: true, data: serializeMedia(updated) })
})
router.delete('/:id/markup', async (req: any, res) => {
  const m = await prisma.mediaItem.findFirst({ where: { id: String(req.params.id), accountId: req.user.crmAccountId, deletedAt: null } })
  if (!m) { res.status(404).json({ success: false, error: 'Not found' }); return }
  const updated = await prisma.mediaItem.update({ where: { id: m.id }, data: { markupPath: null } })
  res.json({ success: true, data: serializeMedia(updated) })
})

// Removed from the app; the files stay on the Mac (and in the backup).
router.delete('/:id', async (req: any, res) => {
  const n = await prisma.mediaItem.updateMany({ where: { id: String(req.params.id), accountId: req.user.crmAccountId, deletedAt: null }, data: { deletedAt: new Date() } })
  res.json({ success: true, data: { deleted: n.count } })
})

/** Disk space on this Mac, for the storage note in Settings. */
router.get('/storage', async (req: any, res) => {
  const agg = await prisma.mediaItem.aggregate({ where: { accountId: req.user.crmAccountId, deletedAt: null }, _sum: { bytes: true }, _count: true })
  let freeBytes: number | null = null
  try { const st = (fs as any).statfsSync(mediaDir()); freeBytes = st.bavail * st.bsize } catch { /* older Node */ }
  res.json({ success: true, data: { items: agg._count, bytes: agg._sum.bytes ?? 0, freeBytes } })
})

export default router

