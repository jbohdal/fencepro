/**
 * Voice: clips recorded on a phone for transcribing on this Mac, and each
 * phone's voice check (what its browser can do), for the "what works where"
 * table. See lib/voiceTranscribe.ts.
 */

import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import multer from 'multer'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { clientIdSchema, decideClientId } from '../lib/clientId.js'
import { isUniqueViolation } from '../lib/once.js'
import { requireUser, requireAccount } from './saved-quotes.js'
import { voiceDir, processVoiceQueue, transcriberReady } from '../lib/voiceTranscribe.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 40 * 1024 * 1024, files: 1 } })
const AUDIO = /^(audio|video)\/(webm|mp4|mpeg|ogg|wav|x-wav|aac|x-m4a|m4a|3gpp)/

router.use(requireUser, requireAccount)

router.get('/status', (_req, res) => { res.json({ success: true, data: transcriberReady() }) })

router.post('/clips', upload.single('audio'), async (req: any, res) => {
  const file = req.file
  const quoteKey = String(req.body?.quoteKey || '').trim().slice(0, 100)
  if (!file || !quoteKey) { res.status(400).json({ success: false, error: 'A recording and a quote are required' }); return }
  if (!AUDIO.test(file.mimetype)) { res.status(400).json({ success: false, error: `Not a recording: ${file.mimetype}` }); return }
  // The phone's own id for the clip: the same clip sent again returns the one already here.
  const accountId = req.user.crmAccountId
  const sel = { id: true, status: true, createdAt: true } as const
  const decision = await decideClientId(clientIdSchema.safeParse(req.body?.id || undefined).data, accountId, id => prisma.voiceClip.findUnique({ where: { id }, select: { ...sel, accountId: true } }))
  if (decision.kind === 'exists') { const { accountId: _a, ...row } = decision.row; res.json({ success: true, data: row }); return }
  const ext = /mp4|m4a|aac/.test(file.mimetype) ? 'm4a' : /ogg/.test(file.mimetype) ? 'ogg' : /wav/.test(file.mimetype) ? 'wav' : /mpeg/.test(file.mimetype) ? 'mp3' : 'webm'
  const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`
  const full = path.join(voiceDir(), name)
  fs.writeFileSync(full, file.buffer)
  let clip
  try {
    clip = await prisma.voiceClip.create({
    data: { ...(decision.kind === 'use' ? { id: decision.id } : {}), accountId, userId: req.user.id, quoteKey, hint: String(req.body?.hint || '').slice(0, 100) || null, mime: file.mimetype, path: full, bytes: file.size },
    select: sel,
    })
  } catch (e) {
    if (!isUniqueViolation(e) || decision.kind !== 'use') throw e
    fs.rmSync(full, { force: true })
    const won = await prisma.voiceClip.findUnique({ where: { id: decision.id }, select: { ...sel, accountId: true } })
    if (!won || won.accountId !== accountId) throw e
    const { accountId: _a, ...row } = won
    res.json({ success: true, data: row }); return
  }
  processVoiceQueue().catch(err => console.error('[voice] queue:', err))
  res.json({ success: true, data: clip })
})

router.get('/clips', async (req: any, res) => {
  const quoteKey = String(req.query.quoteKey || '')
  const list = await prisma.voiceClip.findMany({
    where: { accountId: req.user.crmAccountId, ...(quoteKey ? { quoteKey } : {}) },
    orderBy: { createdAt: 'asc' },
    select: { id: true, quoteKey: true, hint: true, status: true, transcript: true, error: true, appliedAt: true, createdAt: true, bytes: true },
  })
  res.json({ success: true, data: list })
})

router.post('/clips/:id/applied', async (req: any, res) => {
  const n = await prisma.voiceClip.updateMany({ where: { id: String(req.params.id), accountId: req.user.crmAccountId }, data: { appliedAt: new Date() } })
  res.json({ success: true, data: { updated: n.count } })
})

router.delete('/clips/:id', async (req: any, res) => {
  const clip = await prisma.voiceClip.findFirst({ where: { id: String(req.params.id), accountId: req.user.crmAccountId } })
  if (clip) { fs.rm(clip.path, { force: true }, () => {}); await prisma.voiceClip.delete({ where: { id: clip.id } }) }
  res.json({ success: true, data: { deleted: clip ? 1 : 0 } })
})

const checkSchema = z.object({ results: z.record(z.any()) })
router.post('/checks', async (req: any, res) => {
  const body = checkSchema.parse(req.body)
  const saved = await prisma.voiceCheck.create({
    data: { accountId: req.user.crmAccountId, userId: req.user.id, userAgent: String(req.headers['user-agent'] || '').slice(0, 400), results: JSON.parse(JSON.stringify(body.results)) },
    select: { id: true, createdAt: true },
  })
  res.json({ success: true, data: saved })
})

router.get('/checks', async (req: any, res) => {
  const list = await prisma.voiceCheck.findMany({ where: { accountId: req.user.crmAccountId }, orderBy: { createdAt: 'desc' }, take: 50 })
  res.json({ success: true, data: list })
})

export default router
