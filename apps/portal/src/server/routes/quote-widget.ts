/**
 * The website instant quote at /p/quote, behind the public door. No sign in,
 * no Firebase, no Google: the customer types the yard the way the quote
 * builder does, the address is found with the free US Census lookup, the
 * aerial photo is USGS (public domain), the style photos are the ones in
 * Settings > Proposals, and the price is the builder's math (an estimate).
 *
 * Only gdfencepro.com and www.gdfencepro.com may show it inside their pages
 * (frame-ancestors); anyone may open it directly.
 *
 *   GET  /p/quote/            the page (apps/web/dist/quote-widget)
 *   GET  /p/quote/api/config  styles (with photos), company name
 *   GET  /p/quote/api/place   ?address= where it is (for the aerial photo)
 *   POST /p/quote/api/estimate  the price for a yard and style
 *   POST /p/quote/api/photo   one photo of the yard
 *   POST /p/quote/api/submit  customer, quote and pipeline card, together
 */

import express, { Router } from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { estimateJob, estimateStyleList, widgetCatalog } from '../lib/estimates.js'
import { resolveIntakeAccountId } from '../lib/intake.js'
import { locate } from '../lib/appointments.js'
import { submitWidgetQuote } from '../lib/widgetQuote.js'
import { plainZod } from '../lib/plainZod.js'

/** The only sites allowed to show the widget inside their own pages. */
export const WIDGET_FRAME_ANCESTORS = ['https://gdfencepro.com', 'https://www.gdfencepro.com']

const router = Router()
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'

router.use((_req, res, next) => {
  // Replaces helmet's "same site only" frame rule for this page alone.
  res.removeHeader('X-Frame-Options')
  res.setHeader('Content-Security-Policy', `frame-ancestors ${WIDGET_FRAME_ANCESTORS.join(' ')}`)
  next()
})

const readLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many requests. Try again in a minute.' } })
const estimateLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many estimates. Try again in a minute.' } })
const submitLimiter = rateLimit({ windowMs: 60 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false, message: { success: false, error: 'Too many quotes from this address. Try again later.' } })
const photoLimiter = rateLimit({ windowMs: 60 * 60_000, max: 40, standardHeaders: true, legacyHeaders: false })

const api = Router()
api.use(express.json({ limit: '256kb' }))

api.get('/config', readLimiter, async (req, res) => {
  try {
    // The free outside monitor (UptimeRobot) checks this address; noted for the Finish setup list.
    if (/UptimeRobot/i.test(String(req.headers['user-agent'] || ''))) {
      const accountId = await resolveIntakeAccountId()
      if (accountId) await prisma.accountKeyValue.upsert({ where: { accountId_key: { accountId, key: 'uptimeRobotSeenAt' } }, create: { accountId, key: 'uptimeRobotSeenAt', value: new Date().toISOString() }, update: { value: new Date().toISOString() } }).catch(() => {})
    }
    const accountId = await resolveIntakeAccountId()
    const [styles, photos, account] = await Promise.all([
      estimateStyleList(),
      accountId ? prisma.stylePhoto.findMany({ where: { accountId }, select: { id: true, styleName: true } }) : Promise.resolve([]),
      accountId ? prisma.crmAccount.findUnique({ where: { id: accountId }, select: { name: true } }) : Promise.resolve(null),
    ])
    const photoOf = new Map(photos.map(p => [p.styleName, `/p/photo/${p.id}`]))
    const materials = widgetCatalog(styles).map(m => ({
      ...m,
      styles: m.styles.map(s => {
        const apps = Object.values(s.crm).flatMap(c => Object.values(c))
        return { ...s, photoUrl: apps.map(a => photoOf.get(a)).find(Boolean) ?? null }
      }),
    }))
    res.json({ success: true, company: account?.name || 'Getter Done Fence', logoUrl: '/p/logo.png', materials })
  } catch (err) {
    console.error('[widget] config error:', err)
    res.status(500).json({ success: false, error: 'Could not load the fence styles' })
  }
})

api.get('/place', readLimiter, async (req, res) => {
  const address = String(req.query.address || '').slice(0, 300).trim()
  if (address.length < 6) { res.status(400).json({ success: false, error: 'Type the full address' }); return }
  const accountId = await resolveIntakeAccountId()
  const p = accountId ? await locate(accountId, address).catch(() => null) : null
  res.json({ success: true, data: p ? { lat: p.lat, lng: p.lng } : null })
})

const jobSchema = z.object({
  fenceStyle: z.string().trim().min(1, 'Choose a fence style').max(120),
  runs: z.array(z.number().positive().max(100_000)).min(1, 'Enter at least one side').max(300),
  corners: z.number().int().min(0).max(500),
  ends: z.number().int().min(0).max(500),
  walkGates: z.number().int().min(0).max(50),
  dblGates: z.number().int().min(0).max(50),
})

api.post('/estimate', estimateLimiter, async (req, res) => {
  try {
    const job = jobSchema.parse(req.body)
    const e = await estimateJob(job)
    const price = Math.round(e.price)
    // The customer's price only: no costs, margins or parts.
    res.json({ success: true, label: 'Estimate', estimate: price, low: Math.round(price * 0.95 / 10) * 10, high: Math.round(price * 1.15 / 10) * 10, sections: e.sections, totalFootage: e.totalFootage })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    if (err instanceof Error && /Unknown fence style/.test(err.message)) { res.status(400).json({ success: false, error: 'That fence style is not offered' }); return }
    console.error('[widget] estimate error:', err)
    res.status(500).json({ success: false, error: 'Could not work out the estimate' })
  }
})

const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })
api.post('/photo', photoLimiter, photoUpload.single('file'), (req: any, res) => {
  try {
    const file = req.file
    const ext = file ? PHOTO_TYPES[file.mimetype] : undefined
    if (!file || !ext) { res.status(400).json({ success: false, error: 'Send one photo (JPG, PNG, WEBP or HEIC, up to 10 MB)' }); return }
    const dir = path.resolve(UPLOAD_DIR, 'intake')
    fs.mkdirSync(dir, { recursive: true })
    const name = `${crypto.randomUUID()}.${ext}`
    fs.writeFileSync(path.join(dir, name), file.buffer)
    res.status(201).json({ success: true, url: `/api/portal/files/intake/${name}` })
  } catch (err) {
    console.error('[widget] photo error:', err)
    res.status(500).json({ success: false, error: 'The photo did not upload' })
  }
})

const submitSchema = jobSchema.extend({
  submissionId: z.string().uuid(),
  name: z.string().trim().min(2, 'Your name is required').max(120),
  phone: z.string().trim().refine(v => v.replace(/\D/g, '').length >= 10, 'A 10 digit phone number is required').pipe(z.string().max(40)),
  email: z.string().trim().max(200).email('That email does not look right').optional().or(z.literal('')),
  address: z.string().trim().min(6, 'The property address is required').max(300),
  choice: z.string().trim().max(200),
  yard: z.unknown(),
  wantsVisit: z.boolean().default(true),
  notes: z.string().trim().max(2000).optional(),
  photos: z.array(z.string().regex(/^\/api\/portal\/files\/intake\/[0-9a-f-]{36}\.(jpg|png|webp|heic)$/)).max(10).optional(),
})

api.post('/submit', submitLimiter, async (req, res) => {
  try {
    const data = submitSchema.parse(req.body)
    const r = await submitWidgetQuote({ ...data, email: data.email || undefined })
    res.status(r.duplicate ? 200 : 201).json({ success: true, estimate: r.price })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    if (err instanceof Error && /Unknown fence style/.test(err.message)) { res.status(400).json({ success: false, error: 'That fence style is not offered' }); return }
    console.error('[widget] submit error:', err)
    res.status(500).json({ success: false, error: 'Your quote did not send. Please try again, or call us.' })
  }
})

router.use('/api', api)

// The page itself (built into the web app's dist folder by `vite build --config vite.widget.config.ts`).
const root = process.env.WEB_DIST_DIR ? path.resolve(process.env.WEB_DIST_DIR, 'quote-widget') : null
if (root) {
  router.use('/assets', express.static(path.join(root, 'assets'), { index: false, setHeaders: r => r.setHeader('Cache-Control', 'public, max-age=31536000, immutable') }))
  router.get(['/', '/index.html'], readLimiter, (_req, res) => {
    if (!fs.existsSync(path.join(root, 'index.html'))) { res.status(503).type('text/plain').send('The instant quote page is not built on this server.'); return }
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile('index.html', { root })
  })
}
router.use((_req, res) => { res.status(404).type('text/plain').send('Not found') })

export default router
