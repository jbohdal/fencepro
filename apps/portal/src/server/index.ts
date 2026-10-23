import 'dotenv/config'
import express from 'express'
import compression from 'compression'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { ensureUploadDir } from './lib/storage/index.js'
import prisma from './lib/prisma.js'
import { printEnvValidation } from './lib/urls.js'
import { mountStaticSites } from './lib/staticSites.js'
import { liveDatabaseMisuse } from './lib/liveGuard.js'
import { requireLiveSession } from './lib/sessionGuard.js'
import { staffCookieAuth } from './lib/staffSession.js'
import { retitleUpcomingCalendarEventsAll, startCalendarSyncRetry } from './lib/calendarSync/index.js'

// Before anything touches the database: only the live install may use the live database.
const misuse = liveDatabaseMisuse(process.env.DATABASE_URL, process.cwd())
if (misuse) {
  console.error(`[env] ${misuse}`)
  process.exit(1)
}

// Route imports
import authRoutes from './routes/auth.js'
import dashboardRoutes from './routes/dashboard.js'
import ticketRoutes from './routes/tickets.js'
import invoiceRoutes from './routes/invoices.js'
import documentRoutes from './routes/documents.js'
import contractRoutes from './routes/contracts.js'
import adminRoutes from './routes/admin.js'
import syncRoutes from './routes/sync.js'
import chatRoutes from './routes/chat.js'
import leadRoutes from './routes/leads.js'
import appointmentRoutes from './routes/appointments.js'
import pricingRoutes from './routes/pricing.js'
import quoteApiRoutes from './routes/quotes-api.js'
import savedQuoteRoutes from './routes/saved-quotes.js'
import { publicProposal, stylePhotos } from './routes/proposal.js'
import { warrantyUpdatePublic } from './routes/warrantyUpdatePublic.js'
import { changeOrderPublic } from './routes/changeOrderPublic.js'
import tierSetRoutes from './routes/tier-sets.js'
import voiceRoutes from './routes/voice.js'
import mediaRoutes from './routes/media.js'
import { packetPublic, packetStaff } from './routes/installPacket.js'
import { walkthroughPublic, walkthroughStaff } from './routes/walkthroughs.js'
import { startMediaWorker } from './lib/media.js'
import { startVoiceWorker } from './lib/voiceTranscribe.js'
import savedJobRoutes from './routes/saved-jobs.js'
import jobCostingRoutes from './routes/job-costing.js'
import pullSheetRoutes from './routes/pull-sheets.js'
import warrantyRoutes from './routes/warranties.js'
import signedDocumentRoutes from './routes/signed-documents.js'
import { ensureWarrantiesAll } from './lib/warranties.js'
import changeOrderRoutes from './routes/change-orders.js'
import scheduleRoutes from './routes/schedule.js'
import pipelineRoutes from './routes/pipeline.js'
import inventoryStateRoutes from './routes/inventory.js'
import vendorStateRoutes from './routes/vendors-state.js'
import businessStateRoutes from './routes/business-state.js'
import kvRoutes from './routes/kv.js'
import intakeRoutes, { quotingRouter, retellRouter } from './routes/intake.js'
import leadChatRoutes from './routes/lead-chat.js'
import knowledgeRoutes from './routes/knowledge.js'
import googleCalendarRoutes from './routes/google-calendar.js'
import ezBudgetRoutes, { ezBudgetPublicRoutes } from './routes/ez-budget.js'
import automationRoutes from './routes/automations.js'
import integrationRoutes from './routes/integrations.js'
import crmAuthRoutes from './routes/crm-auth.js'
import crmContactRoutes from './routes/crm-contacts.js'
import adminAuditRoutes from './routes/admin-audit.js'
import { promises as fsp } from 'fs'
import path from 'path'
import { startDataIntegrityCron } from './lib/dataIntegrityCron.js'
import { isEmailServiceConfigured } from './lib/emailService.js'
import { startScheduledDeletions } from './lib/scheduledDeletions.js'
import { startDoorWatch } from './lib/doorWatch.js'
import { startMediaShrink } from './lib/mediaShrink.js'
import { startAddressRefresh } from './lib/addressIndex.js'
import { startDuplicateCheck } from './lib/duplicateCheck.js'
import { startAutomationWorker } from './lib/automations/queue.js'
import { ensureStylesOnHoldAll } from './lib/stylesOnHold.js'
import { ensureCostReviewAll } from './lib/costReview.js'
import { ensureWoodAll } from './lib/woodSeed.js'
import vendorInvoiceRoutes from './routes/vendor-invoices.js'
import { resumeInvoiceReading } from './lib/vendorInvoices.js'
import { ensureChainDigSetAll } from './lib/chainDigSetSeed.js'
import { ensureChainDigSetPipesAll } from './lib/chainDigSetPipes.js'
import { ensureTanAutoDsAll } from './lib/tanAutoDsSeed.js'
import { ensureTallVinylPartsAll } from './lib/tallVinylParts.js'
import { backfillEverSoldAll } from './lib/everSold.js'
import { hideCostsFromLimitedLogins } from './lib/costRedact.js'
import quotePricingRoutes from './routes/quote-pricing.js'
import { ensureTwoOptionTiersAll } from './lib/tierSets.js'
import scheduledDeletionRoutes from './routes/scheduled-deletions.js'
import deletedRecordRoutes from './routes/deleted-records.js'
import customerMatchRoutes from './routes/customer-matches.js'
import quoteWidget from './routes/quote-widget.js'
import aerialTiles from './routes/aerialTiles.js'
import systemRoutes from './routes/system.js'
import cronRoutes from './routes/cron.js'
import portalRoutes from './routes/portal.js'
import feedbackRoutes from './routes/feedback.js'
import followUpRoutes from './routes/follow-ups.js'
import opsStagesRoutes from './routes/ops-stages.js'
import pipelineStagesRoutes from './routes/pipeline-stages.js'
import optionListsRoutes from './routes/option-lists.js'
import vinylColorRoutes from './routes/vinyl-colors.js'
import { ensureOptionListsAll } from './lib/optionLists.js'
import { ensurePipelineStageListAll } from './lib/pipelineStages.js'
import { ensureOpsStageListAll } from './lib/opsStages.js'
import { ensureStagingSheetRemovedAll } from './lib/stagingSheetCleanup.js'
import { ensureNoOrphanPendingCallsAll } from './lib/loginDelete.js'
import paymentRoutes from './routes/payments.js'
import { receiptPublic } from './routes/receiptPublic.js'
import { servicePhotosPublic } from './routes/servicePhotosPublic.js'
import serviceTicketRoutes from './routes/serviceTickets.js'
import { portalPublicApi, portalPublicPage } from './routes/portalPublic.js'
import { adoptHandMadeBillingAll } from './lib/billingAdoption.js'

const app = express()
const PORT = parseInt(process.env.PORT || '4000')
// Set HOST=127.0.0.1 when a local proxy (Tailscale, nginx) is the only way in.
// Unset means every address, as before.
const HOST = process.env.HOST as string
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

// ── Trust proxy (behind Nginx) ──
app.set('trust proxy', 1)

// ── Security ──
app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  contentSecurityPolicy: false, // Disabled for now: app uses inline styles + CDN sources; tighten later.
}))
app.disable('x-powered-by')

// ── Public intake, mounted before the app wide CORS and JSON parser ──
// The website quote widget lives on another domain and brings its own origin
// list; the phone agent webhook is verified against the raw request body.
app.use('/api/quoting', quotingRouter)
app.use('/api/intake/retell', retellRouter)

// Build allowed origins list: CLIENT_URL + optional CORS_ORIGINS (comma-separated)
const allowedOrigins: string[] = [CLIENT_URL]
if (process.env.CORS_ORIGINS) {
  process.env.CORS_ORIGINS.split(',').forEach(o => allowedOrigins.push(o.trim()))
}

// The app's own pages (any address this server is reached at: the Tailscale
// name, localhost, the Mac's network address) are always allowed. Another
// site gets no CORS headers, so its browser refuses to read the answer; the
// request itself is not turned into a server error (that made the app's own
// files fail to load when opened by any other address).
app.use(cors((req, cb) => {
  const origin = req.headers.origin
  const sameSite = (() => { try { return !!origin && new URL(origin).host === req.headers.host } catch { return false } })()
  const ok = process.env.NODE_ENV === 'development' || !origin || sameSite || allowedOrigins.includes(origin)
  cb(null, { origin: ok, credentials: true })
}))
// Everything sent is compressed (lists of customers and quotes shrink about
// ten times), which is what makes the app usable on weak cell signal.
// Photos and video are already compressed and are left alone.
app.use(compression())
app.use(express.json({ limit: '10mb' }))

// Staff signed in by the ezbiz_staff cookie: the session is looked up and the
// login's identity (role from the database) is set on the request, before the
// cost hiding below and every route read it (lib/staffSession.ts).
app.use('/api', staffCookieAuth)

// Every save the server refuses or fails is written to the log, with who and
// from what device, so a change that did not save can always be traced.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next()
  const json = res.json.bind(res)
  res.json = (body: any) => {
    if (res.statusCode >= 400) {
      const who = (req as any).user?.email ?? '-'
      console.warn(`[save-refused] ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} "${String(body?.error ?? '').slice(0, 200)}" user=${who} device="${String(req.headers['user-agent'] ?? '').slice(0, 90)}"`)
    }
    return json(body)
  }
  next()
})

// A Salesman's or Installer's login gets prices only: every answer is sent
// without a cost, margin, profit, sub rate, wage, overhead or commission figure
// (lib/costRedact.ts), whichever route answers.
// The role comes from the cookie's session (staffCookieAuth above), or the old token's.
app.use('/api', hideCostsFromLimitedLogins)

// ── Rate Limiting ──
// Limits can be set from the environment. The API default allows a real
// working session:
// one screen load is about 15 calls, and saves, polling and imports add up
// fast. At the old fixed 100 a minute a busy minute answered 429.
const envInt = (name: string, fallback: number) => {
  const n = parseInt(process.env[name] || '', 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: envInt('RATE_LIMIT_LOGIN_FAILS_PER_15MIN', 10),
  message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  // Only failed attempts count, so signing in on several devices is never blocked.
  skipSuccessfulRequests: true,
})

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: envInt('RATE_LIMIT_UPLOADS_PER_HOUR', 60),
  message: { success: false, error: 'Upload limit reached. Try again in an hour.' },
})

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: envInt('RATE_LIMIT_API_PER_MIN', 600),
  message: { success: false, error: 'Too many requests. Wait a moment and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
})

// ── Apply rate limits ──
app.use('/api', apiLimiter)
app.use('/api/auth/login', loginLimiter)
app.use('/api/crm-auth/login', loginLimiter)
app.use('/api/crm-auth/forgot-password', loginLimiter)
app.use('/api/crm-auth/move-over', loginLimiter)
app.use('/api/portal/login', loginLimiter)
app.use('/api/portal/activate', loginLimiter)
app.use('/api/documents', uploadLimiter)

// A staff token must name a live sign in session (not just carry the signing secret): lib/sessionGuard.ts.
app.use('/api', requireLiveSession)

// ── Routes ──
app.use('/api/auth', authRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/tickets', ticketRoutes)
app.use('/api/invoices', invoiceRoutes)
app.use('/api/documents', documentRoutes)
app.use('/api/contracts', contractRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/sync', syncRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/leads', leadRoutes)
app.use('/api/appointments', appointmentRoutes)
app.use('/api/pricing-rules', pricingRoutes)
app.use('/api/quotes', quoteApiRoutes)
app.use('/api/saved-quotes', savedQuoteRoutes)
app.use('/api/quote-pricing', quotePricingRoutes)
app.use('/api/style-photos', stylePhotos)
app.use('/api/tier-sets', tierSetRoutes)
app.use('/api/voice', voiceRoutes)
app.use('/api/media', mediaRoutes)
app.use('/api/install-packets', packetStaff)
// Crew install packets and customer proposals: the paths meant for the public door.
app.use('/p/quote', quoteWidget)
app.use('/p/tiles', aerialTiles)  // The aerial photo tiles for every map and the website quote (routes/aerialTiles.ts)
app.use('/p/i', packetPublic)
app.use('/api/walkthroughs', walkthroughStaff)
app.use('/p/w', walkthroughPublic)
app.use('/p/co', changeOrderPublic)  // A change order's customer link (routes/changeOrderPublic.ts)
app.use('/p/wu', warrantyUpdatePublic)  // A warranty update's customer link (routes/warrantyUpdatePublic.ts)
app.use('/p/r', receiptPublic)  // A payment receipt's customer link and PDF (routes/receiptPublic.ts)
app.use('/p/s', servicePhotosPublic)  // A service request's no login photo link (routes/servicePhotosPublic.ts)
app.use('/p/portal/api', portalPublicApi)  // The customer portal's API through the public door: customer routes only (routes/portalPublic.ts)
app.use('/p/portal', portalPublicPage)     // The customer portal's page through the public door
app.use('/p', publicProposal)
app.use('/api/saved-jobs', savedJobRoutes)
app.use('/api/job-costing', jobCostingRoutes)  // Quoted vs actual: takeoff after install (lib/jobCosting.ts)
app.use('/api/pull-sheets', pullSheetRoutes)  // A customer's pull sheets from their quotes and jobs (lib/customerPullSheets.ts)
app.use('/api/warranties', warrantyRoutes)  // A job's warranty, service call coverage, the signed contract PDF (lib/warranties.ts)
app.use('/api/service-tickets', serviceTicketRoutes)  // Warranty and service requests (lib/serviceTickets.ts)
app.use('/api/signed-documents', signedDocumentRoutes)  // Stored signed contract and change order PDFs (lib/signedDocuments.ts)
app.use('/api/change-orders', changeOrderRoutes)  // Change orders on signed quotes (lib/changeOrders.ts)
app.use('/api/payments', paymentRoutes)  // Payment schedules, payments and receipts (lib/contractBilling.ts)
app.use('/api/schedule', scheduleRoutes)
app.use('/api/pipeline', pipelineRoutes)
app.use('/api/inventory-state', inventoryStateRoutes)
app.use('/api/vendor-state', vendorStateRoutes)
app.use('/api/vendor-invoices', vendorInvoiceRoutes) // Vendor invoices update Inventory prices (lib/vendorInvoices.ts)
app.use('/api/business-state', businessStateRoutes)
app.use('/api/kv', kvRoutes)
app.use('/api/ops-stages', opsStagesRoutes)
app.use('/api/pipeline-stages', pipelineStagesRoutes)
app.use('/api/option-lists', optionListsRoutes)
app.use('/api/vinyl-colors', vinylColorRoutes)
app.use('/api/intake', intakeRoutes)
app.use('/api/scheduled-deletions', scheduledDeletionRoutes)
app.use('/api/deleted-records', deletedRecordRoutes)
app.use('/api/customer-matches', customerMatchRoutes) // Possible matches on website and phone leads; merge and Undo merge (lib/customerMerge.ts)
app.use('/api/system', systemRoutes)
app.use('/api/lead-chat', leadChatRoutes)
app.use('/api/knowledge', knowledgeRoutes)
app.use('/api/google-calendar', googleCalendarRoutes)
app.use('/api/ez-budget', ezBudgetPublicRoutes) // Public widget endpoints (no auth)
app.use('/api/ez-budget', ezBudgetRoutes)       // Admin endpoints (auth required)
app.use('/api/automations', automationRoutes)
app.use('/api/integrations', integrationRoutes)
app.use('/api/crm-auth', crmAuthRoutes)
app.use('/api/crm-contacts', crmContactRoutes)
app.use('/api/admin', adminAuditRoutes)
app.use('/api/cron', cronRoutes)                // Vercel cron jobs
app.use('/api/portal', portalRoutes)            // Customer portal accounts + activation
app.use('/api/feedback', feedbackRoutes)        // "Send feedback" from inside the app
app.use('/api/follow-ups', followUpRoutes)      // Follow ups: calls, answers, next dates (lib/followUps.ts)

// ── Health check (expanded) ──
//
// Returns:
//   {
//     status: 'ok' | 'degraded',
//     timestamp,
//     database: { status, responseTimeMs, customerCount, contactCount, invoiceCount, ... },
//     storage:  { status, lastBackupAt, lastBackupSizeBytes },
//     email:    { status }
//   }
app.get('/api/health', async (_req, res) => {
  const out: Record<string, any> = { status: 'ok', timestamp: new Date().toISOString() }
  // DB
  try {
    const t0 = Date.now()
    await prisma.$queryRaw`SELECT 1`
    const dt = Date.now() - t0
    const [customerCount, contactCount, invoiceCount, portalAccountCount] = await Promise.all([
      prisma.customer.count().catch(() => -1),
      prisma.crmContact.count({ where: { deletedAt: null, archivedAt: null } }).catch(() => -1),
      prisma.invoice.count().catch(() => -1),
      prisma.portalAccount.count().catch(() => -1),
    ])
    out.database = { status: 'ok', responseTimeMs: dt, customerCount, contactCount, invoiceCount, portalAccountCount }
  } catch (err) {
    out.status = 'degraded'
    out.database = { status: 'error', error: (err as Error).message }
  }
  // Storage
  try {
    const lastBackup = await prisma.backupLog.findFirst({
      where: { status: 'success' },
      orderBy: { completedAt: 'desc' },
    })
    out.storage = lastBackup
      ? { status: 'ok', lastBackupAt: lastBackup.completedAt, lastBackupSizeBytes: Number(lastBackup.fileSizeBytes), lastBackupType: lastBackup.backupType }
      : { status: 'unknown', lastBackupAt: null }
  } catch {
    out.storage = { status: 'unknown' }
  }
  // Email
  out.email = { status: isEmailServiceConfigured() ? 'ok' : 'not_configured' }
  // Version (from package.json best-effort)
  try {
    out.version = (await import('../../package.json', { with: { type: 'json' } })).default.version
  } catch { /* ignore */ }
  res.status(out.status === 'ok' ? 200 : 503).json(out)
})

// ── Storage health: write/read/delete a 12-byte test object ──
app.get('/api/health/storage', async (_req, res) => {
  const dir = process.env.UPLOAD_DIR || './uploads'
  const testFile = path.join(dir, `.health-${Date.now()}.txt`)
  try {
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(testFile, 'health-check')
    const back = await fsp.readFile(testFile, 'utf8')
    if (back !== 'health-check') throw new Error('read content mismatch')
    await fsp.unlink(testFile)
    res.json({ status: 'ok', driver: process.env.STORAGE_DRIVER || 'local', path: dir })
  } catch (err) {
    res.status(503).json({ status: 'error', message: (err as Error).message, driver: process.env.STORAGE_DRIVER || 'local', path: dir })
  }
})

// ── Web app and customer portal (single process, no nginx) ──
// After every /api route, so the API always wins. Off unless the folders are set.
mountStaticSites(app, {
  webDistDir: process.env.WEB_DIST_DIR,
  portalDistDir: process.env.PORTAL_DIST_DIR,
})

// ── Error handler ──
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ success: false, error: 'Internal server error' })
})

// ── Start ──
ensureUploadDir()
startVoiceWorker().catch(err => console.error('[voice] worker:', err))
startMediaWorker().catch(err => console.error('[media] worker:', err))

// Validate critical env vars. In production this exits the process if APP_URL,
// DATABASE_URL, JWT_SECRET, or JWT_REFRESH_SECRET are missing or look like
// dev placeholders. Set STRICT_ENV_VALIDATION=false to bypass.
printEnvValidation()

// Only start the HTTP server when run directly (local dev / Docker).
// On Vercel, the app is exported and Vercel manages the serverless lifecycle.
const isVercel = process.env.VERCEL === '1'
if (!isVercel) {
  const server = app.listen(PORT, HOST, () => {
    console.log(`🚀 EZ Biz API running on port ${PORT}`)
    console.log(`   CORS origin: ${CLIENT_URL}`)
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log('   Follow-up cron: use /api/cron/follow-ups endpoint (or setInterval for local dev)')

    // Start in-process data-integrity cron (snapshot + backup-staleness)
    try { startCalendarSyncRetry() } catch (err) {
      console.warn('[startup] calendar sync retry failed to start:', (err as Error).message)
    }
    // Plain style names in calendar titles, upcoming events only: once per company (lib/calendarSync/index.ts).
    retitleUpcomingCalendarEventsAll().catch(err => console.error('[calendar] plain title check failed:', err))
    try { startDataIntegrityCron() } catch (err) {
      console.warn('[startup] data-integrity cron failed to start:', (err as Error).message)
    }
    try { startScheduledDeletions() } catch (err) {
      console.warn('[startup] scheduled deletions failed to start:', (err as Error).message)
    }
    try { startDoorWatch() } catch (err) {
      console.warn('[startup] door watch failed to start:', (err as Error).message)
    }
    try { startAddressRefresh() } catch (err) { console.error('[addresses] could not start:', err) }
    try { startDuplicateCheck() } catch (err) { console.error('[duplicates] could not start:', err) }
    try { startAutomationWorker() } catch (err) { console.error('[automations] worker could not start:', err) }
    // One-time changes to Settings and Inventory, one after another (each also
    // locks the rows, lib/lockState.ts): side by side, a later save erased an
    // earlier one's additions.
    ;(async () => {
      // Commercial and industrial styles not available for quoting: once per company (lib/stylesOnHold.ts).
      await ensureStylesOnHoldAll().catch(err => console.error('[styles] on hold check failed:', err))
      // Wood privacy styles, kits and unpriced wood parts: once per company (lib/woodSeed.ts).
      await ensureWoodAll().catch(err => console.error('[wood] check failed:', err))
      // Chain link Install choice and the unpriced dig set styles: once per company (lib/chainDigSetSeed.ts).
      await ensureChainDigSetAll().catch(err => console.error('[chain link] dig set check failed:', err))
      // Chain link dig set post names with 0.055 wall and size, and hook ties per section on saved kits: once per company (lib/chainDigSetPipes.ts).
      await ensureChainDigSetPipesAll().catch(err => console.error('[chain link] dig set pipe names check failed:', err))
      // Tan dig set, 6 or 8 ft panels (best price), TV-Auto DS Privacy: once per company (lib/tanAutoDsSeed.ts).
      await ensureTanAutoDsAll().catch(err => console.error('[tan dig set] 6/8 ft mix check failed:', err))
      // 8 ft tall vinyl section parts (4 ft pickets, 4 ft U channels, mid rails) at $0, included in the section price: once per company (lib/tallVinylParts.ts).
      await ensureTallVinylPartsAll().catch(err => console.error('[8 ft tall vinyl] section parts check failed:', err))
      // The one Operations stage list from the old Settings one; no job changes: once per company (lib/opsStages.ts).
      await ensureOpsStageListAll().catch(err => console.error('[ops stages] one list check failed:', err))
      // The one Sales Pipeline stage list; ids are the old names, so no card changes: once per company (lib/pipelineStages.ts).
      await ensurePipelineStageListAll().catch(err => console.error('[pipeline stages] one list check failed:', err))
      // Lead sources and tags as option lists from the words already saved; no record changes: once per company (lib/optionLists.ts).
      await ensureOptionListsAll().catch(err => console.error('[option lists] one-time lists check failed:', err))
      // The old Staging sheet, removed when empty, kept with a warning when not: once per company (lib/stagingSheetCleanup.ts).
      await ensureStagingSheetRemovedAll().catch(err => console.error('[staging] old sheet check failed:', err))
      // Pending calls of logins deleted before Oct 2026: once per company (lib/loginDelete.ts).
      await ensureNoOrphanPendingCallsAll().catch(err => console.error('[follow ups] orphan pending call cleanup failed:', err))
      // "Was ever sold" for quotes sold before soldAt existed: once per company (lib/everSold.ts).
      await backfillEverSoldAll().catch(err => console.error('[ever sold] check failed:', err))
      // Settings → Warranties: Lifetime for vinyl no dig, 1 Year for the rest: once per company (lib/warranties.ts).
      await ensureWarrantiesAll().catch(err => console.error('[warranties] check failed:', err))
      // WV-ND Bell 4'x6' flagged "needs cost review" (real supplier cost to enter): once per company (lib/costReview.ts).
      await ensureCostReviewAll().catch(err => console.error('[cost review] check failed:', err))
      // Invoices and payments typed in Billing for a sold job, into its payment schedule; nothing sent, no receipt made: once per company (lib/billingAdoption.ts).
      await adoptHandMadeBillingAll().catch(err => console.error('[billing] hand-made Billing check failed:', err))
    })()
    // Aluminum and chain link tier sets as two options: once per company (lib/tierSets.ts).
    ensureTwoOptionTiersAll().catch(err => console.error('[tiers] two option check failed:', err))
    // Vendor invoices that were being read when the server stopped.
    resumeInvoiceReading().catch(err => console.error('[invoices] resume failed:', err))
    try { startMediaShrink() } catch (err) {
      console.warn('[startup] media shrink failed to start:', (err as Error).message)
    }
  })

  // ── Graceful shutdown ──
  // pm2 sends SIGINT (default kill_signal) or SIGTERM (--update-env restarts).
  // Stop accepting new connections, finish in-flight requests, close prisma,
  // then exit. This prevents users mid-save from getting an EOF on a deploy.
  const SHUTDOWN_TIMEOUT_MS = 30_000
  let shuttingDown = false
  function gracefulShutdown(signal: string) {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`[shutdown] ${signal} received — closing HTTP listener…`)
    const force = setTimeout(() => {
      console.error(`[shutdown] forced exit after ${SHUTDOWN_TIMEOUT_MS}ms`)
      process.exit(1)
    }, SHUTDOWN_TIMEOUT_MS)
    force.unref()
    server.close(async (err) => {
      if (err) console.error('[shutdown] server.close error:', err)
      try { await prisma.$disconnect() } catch (e) { console.warn('[shutdown] prisma disconnect:', (e as Error).message) }
      console.log('[shutdown] clean exit')
      process.exit(0)
    })
  }
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
}

export default app
