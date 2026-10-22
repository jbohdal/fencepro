/**
 * The website quote at /p/quote (Jonathan calls it the EZ Budget), behind the
 * public door. No sign in, no Google, $0 to run: the customer types the
 * address (Marion County's property list), the USGS aerial photo (public
 * domain, the same photo as the quote drawing and Site Plans) opens on the
 * house with the county's lot lines, they tap the fence on it, pick the
 * fence, and the price is the quote builder's own math for that drawn yard.
 *
 * Only gdfencepro.com and www.gdfencepro.com may show it inside their pages
 * (frame-ancestors); anyone may open it directly. ?test=1 on the page: every
 * check and price runs, nothing is written (no draft, no lead).
 *
 *   GET  /p/quote/            the page (apps/web/dist/quote-widget)
 *   GET  /p/quote/api/config  materials, colors and heights, photos, settings
 *   GET  /p/quote/api/place   ?address= where it is (for the aerial photo)
 *   GET  /p/quote/api/suggest ?q= addresses as they are typed
 *   GET  /p/quote/api/draft   ?id= the saved drawing (else the draft cookie)
 *   PUT  /p/quote/api/draft   save the drawing (sets the draft cookie)
 *   POST /p/quote/api/price   the options and prices for a drawing (when Settings show prices before contact)
 *   POST /p/quote/api/photo   one photo of the yard
 *   POST /p/quote/api/submit  customer, quote and pipeline card, together; prices back
 *                             (and the customer's answer to the texting checkbox)
 */

import express, { Router, type Request, type Response } from 'express'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import multer from 'multer'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { estimateOnHold, pricingWithData, isNotQuotable, NOT_QUOTABLE_MESSAGE } from '../lib/estimates.js'
import { resolveIntakeAccountId } from '../lib/intake.js'
import { recordWebsiteTextConsent } from '../lib/textConsent.js'
import { audit } from '../lib/auditLog.js'
import { locate } from '../lib/appointments.js'
import { suggest } from '../lib/addressIndex.js'
import { tiles } from './aerialTiles.js'
import { plainZod } from '../lib/plainZod.js'
import {
  widgetSettingsOf, priceDrawing, optionView, submitDrawnQuote, readDraft, saveDraft, newDraftId, DRAFT_ID, DRAFT_DAYS, DrawingProblem,
} from '../lib/widgetDrawQuote.js'

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

const limit = (windowMs: number, max: number, error: string) => rateLimit({ windowMs, max, standardHeaders: true, legacyHeaders: false, message: { success: false, error } })
const readLimiter = limit(60_000, 60, 'Too many requests. Try again in a minute.')
const draftLimiter = limit(60_000, 40, 'Too many saves. Try again in a minute.')
const priceLimiter = limit(60_000, 30, 'Too many estimates. Try again in a minute.')
const submitLimiter = limit(60 * 60_000, 20, 'Too many quotes from this address. Try again later.')
const photoLimiter = rateLimit({ windowMs: 60 * 60_000, max: 40, standardHeaders: true, legacyHeaders: false })

const api = Router()
api.use(express.json({ limit: '600kb' }))

// ── The draft cookie ─────────────────────────────────────────────────────────
// httpOnly (the page never sees it), Secure + SameSite=None so it is sent
// inside the website's frame, Partitioned so browsers that block other sites'
// cookies keep it for this website only. The draft id also rides in the page
// address, for browsers that keep no cookie at all in a frame.
const COOKIE = 'ezq_draft'
function setDraftCookie(res: Response, id: string) {
  res.append('Set-Cookie', `${COOKIE}=${id}; Path=/p/quote; Max-Age=${DRAFT_DAYS * 86_400}; HttpOnly; Secure; SameSite=None; Partitioned`)
}
function draftCookie(req: Request): string | null {
  const raw = String(req.headers.cookie || '')
  const m = raw.split(/;\s*/).map(c => c.split('=')).find(([k]) => k === COOKIE)
  const v = m?.[1] ?? ''
  return DRAFT_ID.test(v) ? v : null
}
const isTest = (req: Request) => req.query.test === '1' || (req.body && typeof req.body === 'object' && req.body.test === true)

api.get('/config', readLimiter, async (req, res) => {
  try {
    // The free outside monitor (UptimeRobot) checks this address; noted for the Finish setup list.
    if (/UptimeRobot/i.test(String(req.headers['user-agent'] || ''))) {
      const accountId = await resolveIntakeAccountId()
      if (accountId) await prisma.accountKeyValue.upsert({ where: { accountId_key: { accountId, key: 'uptimeRobotSeenAt' } }, create: { accountId, key: 'uptimeRobotSeenAt', value: new Date().toISOString() }, update: { value: new Date().toISOString() } }).catch(() => {})
    }
    const accountId = await resolveIntakeAccountId()
    const [{ m, data }, hold, photos, account] = await Promise.all([
      pricingWithData(),
      estimateOnHold(),
      accountId ? prisma.stylePhoto.findMany({ where: { accountId }, select: { id: true, styleName: true } }) : Promise.resolve([]),
      accountId ? prisma.crmAccount.findUnique({ where: { id: accountId }, select: { name: true } }) : Promise.resolve(null),
    ])
    const catalog = m.widgetCatalogFor(data)
    // A material's picture: a Settings style photo of one of its styles, else the drawn picture on the page.
    const styles: Array<{ name: string; material?: string }> = m.estimateStyles((data as any).config, data)
    const photoOf = new Map(photos.map(p => [p.styleName, `/p/photo/${p.id}`]))
    const materials = catalog.materials.map((mt: any) => ({ ...mt, photoUrl: styles.filter(s => s.material === mt.material).map(s => photoOf.get(s.name)).find(Boolean) ?? null }))
    // Styles not available for quoting (commercial and industrial, on hold): one choice that says to call.
    const onHold = hold.styles.length ? { label: 'Commercial / Industrial', message: NOT_QUOTABLE_MESSAGE, phone: hold.phone } : null
    res.json({ success: true, company: account?.name || 'Getter Done Fence', materials, onHold, settings: widgetSettingsOf((data as any).config) })
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
  res.json({ success: true, data: p ? { lat: p.lat, lng: p.lng, source: p.source } : null })
})

// Address suggestions as the customer types (Marion County's property list, then the Census lookup).
api.get('/suggest', readLimiter, async (req, res) => {
  const q = String(req.query.q || '').slice(0, 200).trim()
  const list = q.length < 3 ? [] : await suggest(q, 5)
  // One or two addresses left: the first one's photo starts now (NAIP takes about 20 seconds the first time; routes/aerialTiles.ts).
  if (list.length >= 1 && list.length <= 2 && Number.isFinite(list[0].lat) && Number.isFinite(list[0].lng)) tiles.warm(list[0].lat, list[0].lng)
  res.json({ success: true, data: list.map(s => ({ formatted: s.formatted, line1: s.line1, city: s.city, state: s.state, zip: s.zip, lat: s.lat, lng: s.lng, source: s.source })) })
})

// ── Drafts ───────────────────────────────────────────────────────────────────

const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
const gate = z.object({ type: z.enum(['walk', 'double']), widthFt: z.number().min(3).max(20), startFt: z.number().min(0).max(5000) })
const run = z.object({
  id: z.string().trim().min(1).max(40),
  pts: z.array(latLng).max(40),
  start: z.enum(['free', 'house']),
  end: z.enum(['free', 'house']),
  closed: z.boolean().optional(),
  typedFt: z.array(z.number().positive().max(5000).nullable()).max(41),
  gates: z.array(gate.nullable()).max(41),
})
const drawing = z.object({ v: z.literal(1), address: z.string().trim().max(300), at: latLng, runs: z.array(run).max(12) })
const pick = z.object({ material: z.enum(['vinyl', 'chain', 'alum', 'wood']), color: z.string().trim().max(20), height: z.string().trim().regex(/^\d{1,2}$/), kind: z.string().trim().max(30) })
/** What a draft keeps: no name, phone or email. */
const draftData = z.object({
  step: z.number().int().min(0).max(6),
  address: z.string().trim().max(300),
  at: latLng.nullable(),
  atSource: z.string().trim().max(20).optional(),
  drawing: drawing.nullable(),
  pick: pick.nullable(),
  fenceStyle: z.string().trim().max(120).nullable().optional(),
  snap: z.boolean().optional(),
})

api.get('/draft', readLimiter, async (req, res) => {
  if (isTest(req)) { res.json({ success: true, data: null }); return }
  const id = typeof req.query.id === 'string' && DRAFT_ID.test(req.query.id) ? req.query.id : draftCookie(req)
  const d = id ? await readDraft(id) : null
  if (!d) { res.json({ success: true, data: null }); return }
  res.json({ success: true, data: { id: d.id, ...(d.data as object), sent: !!d.quoteId } })
})

api.put('/draft', draftLimiter, async (req, res) => {
  try {
    const body = z.object({ id: z.string().regex(DRAFT_ID).nullable().optional(), data: draftData, test: z.boolean().optional() }).parse(req.body)
    if (JSON.stringify(body.data).length > 64_000) { res.status(400).json({ success: false, error: 'The drawing is too big to save.' }); return }
    // Test mode: nothing is written.
    if (body.test || isTest(req)) { res.json({ success: true, id: body.id ?? null, test: true }); return }
    const id = body.id ?? newDraftId()
    await saveDraft(id, JSON.parse(JSON.stringify(body.data)), await resolveIntakeAccountId())
    setDraftCookie(res, id)
    res.json({ success: true, id })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: 'The drawing did not save. Start over, or call us.' }); return }
    console.error('[widget] draft error:', err)
    res.status(500).json({ success: false, error: 'The drawing did not save' })
  }
})

// ── Prices ───────────────────────────────────────────────────────────────────

api.post('/price', priceLimiter, async (req, res) => {
  try {
    const body = z.object({ drawing, pick, draftId: z.string().regex(DRAFT_ID).nullable().optional(), test: z.boolean().optional() }).parse(req.body)
    const accountId = await resolveIntakeAccountId()
    if (!accountId) throw new Error('No company is set up on this server yet')
    const { data } = await pricingWithData()
    // Contact before price (the default): prices come back with the sent quote, not here.
    if (!widgetSettingsOf((data as any).config).showPriceBeforeContact) {
      const d = body.draftId ? await readDraft(body.draftId) : null
      if (!d?.quoteId) { res.status(403).json({ success: false, contactFirst: true, error: 'Add your name and phone to see the prices.' }); return }
    }
    const { priced } = await priceDrawing(accountId, body.drawing, body.pick)
    res.json({ success: true, label: 'Estimate', options: priced.options.map(optionView), footageFt: priced.footageFt })
  } catch (err) { refuse(res, err, 'Could not work out the estimate') }
})

function refuse(res: Response, err: unknown, fallback: string) {
  if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
  if (err instanceof DrawingProblem) { res.status(400).json({ success: false, error: err.message }); return }
  if (isNotQuotable(err)) { res.status(400).json({ success: false, notQuotable: true, error: NOT_QUOTABLE_MESSAGE }); return }
  if (err instanceof Error && /Unknown fence style/.test(err.message)) { res.status(400).json({ success: false, error: 'That fence style is not offered' }); return }
  console.error('[widget]', fallback, err)
  res.status(500).json({ success: false, error: fallback })
}

// ── Photos and sending ───────────────────────────────────────────────────────

const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } })
api.post('/photo', photoLimiter, photoUpload.single('file'), (req: any, res) => {
  try {
    if (req.query.test === '1') { res.status(201).json({ success: true, url: null, test: true }); return }
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

const submitSchema = z.object({
  draftId: z.string().regex(DRAFT_ID, 'Start the quote again'),
  name: z.string().trim().min(2, 'Your name is required').max(120),
  phone: z.string().trim().refine(v => v.replace(/\D/g, '').length >= 10, 'A 10 digit phone number is required').pipe(z.string().max(40)),
  email: z.string().trim().max(200).email('That email does not look right').optional().or(z.literal('')),
  address: z.string().trim().min(6, 'The property address is required').max(300),
  drawing,
  pick,
  fenceStyle: z.string().trim().max(120).nullable().optional(),
  wantsVisit: z.boolean().default(true),
  /** The "Text me updates" checkbox (unchecked by default): checked is a yes to texts, unchecked a no. */
  textConsent: z.boolean().default(false),
  notes: z.string().trim().max(2000).optional(),
  photos: z.array(z.string().regex(/^\/api\/portal\/files\/intake\/[0-9a-f-]{36}\.(jpg|png|webp|heic)$/)).max(10).optional(),
  snapshot: z.string().max(560_000).nullable().optional(),
  /** Left empty by people; filled in by form robots (hidden on the page). */
  website: z.string().max(200).optional(),
  test: z.boolean().optional(),
})

// A test run (?test=1) writes nothing, so it is held to the estimates' limit; a real quote to the hourly one.
const submitLimit = (req: Request, res: Response, next: express.NextFunction) => (isTest(req) ? priceLimiter(req, res, next) : submitLimiter(req, res, next))
api.post('/submit', submitLimit, async (req, res) => {
  try {
    const data = submitSchema.parse(req.body)
    const test = !!data.test || isTest(req)
    // A robot filled the hidden box: it is told all went well, and nothing is saved.
    if (data.website) {
      const accountId = await resolveIntakeAccountId()
      const { priced } = await priceDrawing(accountId!, data.drawing, data.pick)
      res.status(201).json({ success: true, options: priced.options.map(optionView), chosen: optionView(priced.options[0]) })
      return
    }
    const r = await submitDrawnQuote({ ...data, email: data.email || undefined, test, notes: [data.notes, data.photos?.length ? `Photos: ${data.photos.join(' ')}` : ''].filter(Boolean).join('\n') || undefined })
    // The texting checkbox on the customer the quote was filed under (a test run writes nothing).
    if (!r.test && r.contactId) {
      const done = await recordWebsiteTextConsent(r.contactId, data.textConsent, { ip: req.ip, userAgent: String(req.headers['user-agent'] || '') })
        .catch(err => { console.error('[widget] text consent error:', err); return null })
      if (done) await audit(req, 'update', 'CrmContact', r.contactId, { newValues: { textConsent: done.contact.textConsent, textConsentSource: 'website_checkbox', textConsentAt: done.contact.textConsentAt } })
    }
    res.status(r.test || r.duplicate ? 200 : 201).json({ success: true, test: r.test, duplicate: r.duplicate, options: r.options, chosen: r.chosen, ...(r.test ? { preview: r.preview } : {}) })
  } catch (err) { refuse(res, err, 'Your quote did not send. Please try again, or call us.') }
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
