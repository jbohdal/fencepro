/**
 * Intake routes.
 *
 *   /api/quoting/*       public, for the EZ Quote website widget
 *                        (the endpoint contract in that app's README)
 *   /api/intake/retell   public webhook for the Retell phone agent
 *   /api/intake          staff: the queue the CRM reads to add pipeline cards
 *
 * Each public router is mounted before the app wide CORS and JSON middleware
 * (see index.ts) because it needs its own: the widget is on another domain,
 * and the Retell signature is computed over the raw request body.
 */

import { Router } from 'express'
import express from 'express'
import cors from 'cors'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import jwt from 'jsonwebtoken'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { resolveSecret } from '../lib/secrets.js'
import { recordIntake, resolveIntakeAccountId, digits } from '../lib/intake.js'
import { verifyRetellSignature, summarizeRetellCall } from '../lib/retell.js'

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'
const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

// ═════════════════════════════════════════════════════════════════════════
// EZ Quote website widget — /api/quoting
// ═════════════════════════════════════════════════════════════════════════

export const quotingRouter = Router()

// The widget runs on the company website, so it gets its own origin list.
const widgetOrigins = () => (process.env.EZ_QUOTE_ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean)

quotingRouter.use(cors({
  origin: (origin, cb) => {
    const allowed = widgetOrigins()
    // No Origin header (server to server, curl) is fine; the token still gates it.
    if (!origin || process.env.NODE_ENV !== 'production' || allowed.includes(origin.replace(/\/$/, ''))) cb(null, true)
    else cb(null, false)
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))
quotingRouter.use(express.json({ limit: '1mb' }))

const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false,
  message: { success: false, error: 'Too many quotes from this address. Try again later.' } })
const readLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false })

/** The widget token is public (it ships in the website's code). It identifies the widget; it is not a password. */
function requireWidgetToken(req: any, res: any, next: any) {
  const expected = process.env.EZ_QUOTE_WIDGET_TOKEN
  if (!expected) { res.status(503).json({ success: false, error: 'Website quote intake is not set up on this server (EZ_QUOTE_WIDGET_TOKEN).' }); return }
  const auth = req.headers.authorization
  const provided = (typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '') || String(req.query.token || '')
  if (!provided || !safeEqual(provided, expected)) { res.status(401).json({ success: false, error: 'Invalid widget token' }); return }
  next()
}

quotingRouter.use(requireWidgetToken)

// Pricing, theme and range. Returning none tells the widget to use its own
// (it falls back to the pricing it already has), so the widget keeps working
// exactly as it does today while its completed quotes land in the CRM.
quotingRouter.get('/config', readLimiter, (_req, res) => {
  res.json({ pricing: [], theme: null, quoteRange: null })
})

const latLng = z.object({ lat: z.number(), lng: z.number() })
const submitSchema = z.object({
  userId: z.string().max(200).optional(),
  customerName: z.string().trim().min(1, 'Name is required').max(200),
  customerEmail: z.string().max(200).optional().nullable(),
  customerPhone: z.string().max(40).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  coordinates: latLng.optional().nullable(),
  runs: z.array(z.object({ lengthFeet: z.number().optional(), sections: z.number().optional() }).passthrough()).max(300).optional(),
  layout: z.object({ corners: z.number().optional(), ends: z.number().optional() }).passthrough().optional(),
  gateConfig: z.object({ walkGates: z.number().optional(), doubleGates: z.number().optional() }).passthrough().optional(),
  material: z.string().max(80).optional(),
  style: z.string().max(120).optional(),
  height: z.string().max(20).optional(),
  color: z.string().max(60).optional(),
  linearFeet: z.number().nonnegative().max(1_000_000).optional(),
  totalEstimate: z.number().nonnegative().max(100_000_000).optional(),
  requestOnSiteEstimate: z.boolean().optional(),
  photos: z.array(z.string().max(2000)).max(30).optional(),
  notes: z.string().max(5000).optional(),
}).passthrough()

quotingRouter.post('/submit', submitLimiter, async (req, res) => {
  try {
    const data = submitSchema.parse(req.body)
    if (!data.customerPhone && !data.customerEmail) {
      res.status(400).json({ success: false, error: 'A phone number or an email is required' })
      return
    }
    const accountId = await resolveIntakeAccountId()
    if (!accountId) { res.status(503).json({ success: false, error: 'No company is set up on this server yet' }); return }

    const feet = Math.round(data.linearFeet ?? 0)
    const fence = [data.material, data.style, data.height, data.color].filter(Boolean).join(', ')
    const walk = data.gateConfig?.walkGates ?? 0
    const dbl = data.gateConfig?.doubleGates ?? 0
    const lines = [
      'Website quote (EZ Quote)',
      `${feet} ft${fence ? ' of ' + fence : ''}`,
      (walk || dbl) ? `Gates: ${walk} walk, ${dbl} double` : 'No gates',
      typeof data.totalEstimate === 'number' ? `Budget shown to the customer: ${money(data.totalEstimate)}` : '',
      `Asked for an on site estimate: ${data.requestOnSiteEstimate ? 'yes' : 'no'}`,
      data.address ? `Address: ${data.address}` : '',
      data.photos?.length ? `Photos: ${data.photos.length}\n${data.photos.join('\n')}` : '',
      data.notes ? `Customer notes: ${data.notes}` : '',
    ].filter(Boolean)

    const id = crypto.randomUUID()
    const result = await recordIntake(accountId, {
      source: 'ez_quote',
      sourceRef: id,
      name: data.customerName,
      phone: data.customerPhone || undefined,
      email: data.customerEmail || undefined,
      address: data.address || undefined,
      fenceType: fence,
      summary: lines.join('\n'),
      estimate: data.totalEstimate ?? null,
      leadSource: 'Website Quote',
      payload: { ...data, id, submittedAt: new Date().toISOString() },
    })
    res.status(201).json({ success: true, id: result.intakeId })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[quoting] submit error:', err)
    res.status(500).json({ success: false, error: 'Could not save the quote' })
  }
})

// The CRM raises its own notification when the quote is saved, so this only
// has to acknowledge the widget's follow up call.
quotingRouter.post('/notify', readLimiter, (_req, res) => { res.json({ success: true }) })

const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })
const uploadLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false })

quotingRouter.post('/upload', uploadLimiter, photoUpload.single('file'), (req: any, res) => {
  try {
    const file = req.file
    const ext = file ? PHOTO_TYPES[file.mimetype] : undefined
    if (!file || !ext) { res.status(400).json({ success: false, error: 'Send one photo (JPG, PNG, WEBP or HEIC, up to 10 MB)' }); return }
    const dir = path.resolve(UPLOAD_DIR, 'intake')
    fs.mkdirSync(dir, { recursive: true })
    const name = `${crypto.randomUUID()}.${ext}`
    fs.writeFileSync(path.join(dir, name), file.buffer)
    const base = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '')
    res.status(201).json({ success: true, url: `${base}/api/portal/files/intake/${name}` })
  } catch (err) {
    console.error('[quoting] upload error:', err)
    res.status(500).json({ success: false, error: 'Upload failed' })
  }
})

/** What the widget's "My Quotes" pages get back: the quote as it was submitted. */
function quoteForWidget(row: { id: string; payload: unknown; createdAt: Date }) {
  const p = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>
  return { ...p, id: row.id, createdAt: row.createdAt.toISOString(), updatedAt: row.createdAt.toISOString() }
}

quotingRouter.get('/quotes', readLimiter, async (req, res) => {
  try {
    const userId = String(req.query.userId || '')
    if (!userId) { res.json({ quotes: [] }); return }
    const rows = await prisma.intakeLead.findMany({
      where: { source: 'ez_quote', payload: { path: ['userId'], equals: userId } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    res.json({ quotes: rows.map(quoteForWidget) })
  } catch (err) {
    console.error('[quoting] list error:', err)
    res.status(500).json({ success: false, error: 'Could not load quotes' })
  }
})

quotingRouter.get('/quotes/:id', readLimiter, async (req, res) => {
  try {
    const row = await prisma.intakeLead.findUnique({ where: { id: String(req.params.id) } })
    if (!row || row.source !== 'ez_quote') { res.status(404).json({ success: false, error: 'Quote not found' }); return }
    res.json(quoteForWidget(row))
  } catch (err) {
    console.error('[quoting] get error:', err)
    res.status(500).json({ success: false, error: 'Could not load the quote' })
  }
})

// ═════════════════════════════════════════════════════════════════════════
// Retell phone agent — /api/intake/retell
// ═════════════════════════════════════════════════════════════════════════

export const retellRouter = Router()
// Raw body: the signature is computed over the exact bytes Retell sent.
retellRouter.use(express.raw({ type: '*/*', limit: '5mb' }))

retellRouter.post('/', async (req: any, res) => {
  const apiKey = process.env.RETELL_API_KEY
  if (!apiKey) { res.status(503).json({ success: false, error: 'Phone agent intake is not set up on this server (RETELL_API_KEY).' }); return }

  const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : ''
  if (!verifyRetellSignature(raw, req.headers['x-retell-signature'], apiKey)) {
    res.status(401).json({ success: false, error: 'Invalid signature' })
    return
  }

  let body: any
  try { body = JSON.parse(raw) } catch { res.status(400).json({ success: false, error: 'Invalid JSON' }); return }

  // Only the analyzed call carries the summary and what the agent collected.
  // Everything else (call_started, call_ended, transcript updates, transfers)
  // is acknowledged and ignored. Retell retries anything that is not a 2xx.
  if (body?.event !== 'call_analyzed' || !body?.call?.call_id) { res.status(204).end(); return }

  try {
    const accountId = await resolveIntakeAccountId()
    if (!accountId) { res.status(503).json({ success: false, error: 'No company is set up on this server yet' }); return }

    const call = body.call
    const info = summarizeRetellCall(call)
    if (digits(info.phone).length < 7 && !info.email) {
      // A web test call or a blocked number with nothing to call back: nothing to file.
      res.status(204).end()
      return
    }

    const result = await recordIntake(accountId, {
      source: 'retell',
      sourceRef: String(call.call_id),
      name: info.name,
      phone: info.phone,
      email: info.email,
      address: info.address,
      fenceType: info.fenceType,
      summary: info.summary,
      callbackAt: info.callbackAt || null,
      leadSource: 'Phone (AI receptionist)',
      payload: {
        call_id: call.call_id,
        agent_id: call.agent_id,
        direction: call.direction,
        from_number: call.from_number,
        to_number: call.to_number,
        start_timestamp: call.start_timestamp,
        end_timestamp: call.end_timestamp,
        disconnection_reason: call.disconnection_reason,
        recording_url: call.recording_url,
        transcript: call.transcript,
        call_analysis: call.call_analysis,
      },
    })

    if (!result.duplicate) {
      await prisma.task.create({
        data: {
          title: `Call back ${result.contactName || info.name}${info.phone ? ' at ' + info.phone : ''}${info.callbackAt ? ' (' + info.callbackAt + ')' : ''}`,
          description: info.summary.slice(0, 4000),
          assignedRole: 'owner',
          priority: 'high',
          createdBy: 'phone-agent',
        },
      }).catch(err => console.error('[intake] task failed:', err))
    }
    res.status(204).end()
  } catch (err) {
    console.error('[intake] retell error:', err)
    res.status(500).json({ success: false, error: 'Could not record the call' })
  }
})

// ═════════════════════════════════════════════════════════════════════════
// Staff queue — /api/intake
// ═════════════════════════════════════════════════════════════════════════

const router = Router()
const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

async function requireStaff(req: any, res: any, next: any) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as any
    if (payload.role === 'customer') { res.status(403).json({ success: false, error: 'Staff only' }); return }
    let crmAccountId: string | null = payload.crmAccountId ?? null
    if (!crmAccountId) {
      const u = await prisma.crmUser.findUnique({ where: { id: payload.sub }, select: { crmAccountId: true } })
      crmAccountId = u?.crmAccountId ?? null
    }
    if (!crmAccountId) { res.status(403).json({ success: false, error: 'No tenant' }); return }
    req.user = { id: payload.sub, crmAccountId }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
}

router.use(requireStaff)

const publicFields = {
  id: true, source: true, crmContactId: true, name: true, phone: true, email: true, address: true,
  fenceType: true, summary: true, estimate: true, callbackAt: true, status: true, createdAt: true,
} as const

// Leads waiting to be added to the pipeline (or recent ones with ?status=all).
router.get('/', async (req: any, res) => {
  try {
    const all = req.query.status === 'all'
    const rows = await prisma.intakeLead.findMany({
      where: { accountId: req.user.crmAccountId, ...(all ? {} : { status: 'new' }) },
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: publicFields,
    })
    res.json({ success: true, data: rows })
  } catch (err) {
    console.error('[intake] list error:', err)
    res.status(500).json({ success: false, error: 'Could not load new leads' })
  }
})

// The CRM added the pipeline card; take the lead off the queue.
router.post('/:id/ack', async (req: any, res) => {
  try {
    const r = await prisma.intakeLead.updateMany({
      where: { id: String(req.params.id), accountId: req.user.crmAccountId, status: 'new' },
      data: { status: 'imported', importedAt: new Date() },
    })
    res.json({ success: true, data: { updated: r.count } })
  } catch (err) {
    console.error('[intake] ack error:', err)
    res.status(500).json({ success: false, error: 'Could not update the lead' })
  }
})

export default router
