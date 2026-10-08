import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { ensureUploadDir } from './lib/storage/index.js'
import prisma from './lib/prisma.js'
import { printEnvValidation } from './lib/urls.js'

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
import savedJobRoutes from './routes/saved-jobs.js'
import scheduleRoutes from './routes/schedule.js'
import pipelineRoutes from './routes/pipeline.js'
import inventoryStateRoutes from './routes/inventory.js'
import vendorStateRoutes from './routes/vendors-state.js'
import businessStateRoutes from './routes/business-state.js'
import kvRoutes from './routes/kv.js'
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
import cronRoutes from './routes/cron.js'
import portalRoutes from './routes/portal.js'

const app = express()
const PORT = parseInt(process.env.PORT || '4000')
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

// Build allowed origins list: CLIENT_URL + optional CORS_ORIGINS (comma-separated)
const allowedOrigins: string[] = [CLIENT_URL]
if (process.env.CORS_ORIGINS) {
  process.env.CORS_ORIGINS.split(',').forEach(o => allowedOrigins.push(o.trim()))
}

app.use(cors({
  origin: process.env.NODE_ENV === 'development'
    ? (_origin: any, cb: any) => cb(null, true)  // allow all origins in dev
    : (origin, cb) => {
        if (!origin || allowedOrigins.includes(origin)) {
          cb(null, true)
        } else {
          cb(new Error(`CORS: origin ${origin} not allowed`))
        }
      },
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))

// ── Rate Limiting ──
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
})

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { success: false, error: 'Upload limit reached. Try again in an hour.' },
})

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
})

// ── Apply rate limits ──
app.use('/api', apiLimiter)
app.use('/api/auth/login', loginLimiter)
app.use('/api/crm-auth/login', loginLimiter)
app.use('/api/crm-auth/forgot-password', loginLimiter)
app.use('/api/portal/login', loginLimiter)
app.use('/api/portal/activate', loginLimiter)
app.use('/api/documents', uploadLimiter)

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
app.use('/api/saved-jobs', savedJobRoutes)
app.use('/api/schedule', scheduleRoutes)
app.use('/api/pipeline', pipelineRoutes)
app.use('/api/inventory-state', inventoryStateRoutes)
app.use('/api/vendor-state', vendorStateRoutes)
app.use('/api/business-state', businessStateRoutes)
app.use('/api/kv', kvRoutes)
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
      prisma.crmContact.count({ where: { archivedAt: null } }).catch(() => -1),
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
  out.email = { status: process.env.SENDGRID_API_KEY ? 'ok' : 'not_configured' }
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

// ── Error handler ──
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ success: false, error: 'Internal server error' })
})

// ── Start ──
ensureUploadDir()

// Validate critical env vars. In production this exits the process if APP_URL,
// DATABASE_URL, JWT_SECRET, or JWT_REFRESH_SECRET are missing or look like
// dev placeholders. Set STRICT_ENV_VALIDATION=false to bypass.
printEnvValidation()

// Only start the HTTP server when run directly (local dev / Docker).
// On Vercel, the app is exported and Vercel manages the serverless lifecycle.
const isVercel = process.env.VERCEL === '1'
if (!isVercel) {
  const server = app.listen(PORT, () => {
    console.log(`🚀 EZBiz Portal API running on port ${PORT}`)
    console.log(`   CORS origin: ${CLIENT_URL}`)
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log('   Follow-up cron: use /api/cron/follow-ups endpoint (or setInterval for local dev)')

    // Start in-process data-integrity cron (snapshot + backup-staleness)
    try { startDataIntegrityCron() } catch (err) {
      console.warn('[startup] data-integrity cron failed to start:', (err as Error).message)
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
