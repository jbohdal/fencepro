import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { ensureUploadDir } from './lib/storage/index.js'

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
import leadChatRoutes from './routes/lead-chat.js'
import knowledgeRoutes from './routes/knowledge.js'
import googleCalendarRoutes from './routes/google-calendar.js'
import ezBudgetRoutes, { ezBudgetPublicRoutes } from './routes/ez-budget.js'
import automationRoutes from './routes/automations.js'
import integrationRoutes from './routes/integrations.js'
import crmAuthRoutes from './routes/crm-auth.js'
import cronRoutes from './routes/cron.js'

const app = express()
const PORT = parseInt(process.env.PORT || '4000')
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'

// ── Trust proxy (behind Nginx) ──
app.set('trust proxy', 1)

// ── Security ──
app.use(helmet())

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
app.use('/api/lead-chat', leadChatRoutes)
app.use('/api/knowledge', knowledgeRoutes)
app.use('/api/google-calendar', googleCalendarRoutes)
app.use('/api/ez-budget', ezBudgetPublicRoutes) // Public widget endpoints (no auth)
app.use('/api/ez-budget', ezBudgetRoutes)       // Admin endpoints (auth required)
app.use('/api/automations', automationRoutes)
app.use('/api/integrations', integrationRoutes)
app.use('/api/crm-auth', crmAuthRoutes)
app.use('/api/cron', cronRoutes)                // Vercel cron jobs

// ── Health check ──
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ── Error handler ──
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err)
  res.status(500).json({ success: false, error: 'Internal server error' })
})

// ── Start ──
ensureUploadDir()

// Only start the HTTP server when run directly (local dev / Docker).
// On Vercel, the app is exported and Vercel manages the serverless lifecycle.
const isVercel = process.env.VERCEL === '1'
if (!isVercel) {
  app.listen(PORT, () => {
    console.log(`🚀 FencePro Portal API running on port ${PORT}`)
    console.log(`   CORS origin: ${CLIENT_URL}`)
    console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`)
    console.log('   Follow-up cron: use /api/cron/follow-ups endpoint (or setInterval for local dev)')
  })
}

export default app
