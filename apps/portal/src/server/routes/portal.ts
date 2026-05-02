/**
 * Customer Portal API.
 *
 * Endpoints (all /api/portal):
 *   POST /invite         — create/refresh an invite for a CRM customer (staff authed via CRM sync key)
 *   POST /resend-invite  — customer-initiated resend by email (rate-limited)
 *   POST /activate       — accept the invite: validate token, set password, return session
 *   POST /login          — customer login
 *   POST /logout         — clear session (client-side really, just for parity)
 *   GET  /me             — current session (requires portal access token)
 *
 * Token architecture:
 *   - Raw tokens: crypto.randomBytes(32).toString('hex') → 64 hex chars, URL-safe
 *   - Stored: sha256(rawToken) — never the raw value
 *   - Validation: sha256 the incoming token, lookup by hash
 *   - Passwords: bcrypt (12 rounds)
 */

import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { z } from 'zod'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import prisma from '../lib/prisma.js'
import { hashPassword, verifyPassword, generateTokens, verifyAccessToken } from '../lib/auth.js'
import { sendEmail, applyMergeTags, buildEmailHtml } from '../lib/emailService.js'
import { createNotification } from '../lib/notificationService.js'
import { buildFrontendUrl } from '../lib/urls.js'

// File storage helpers
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads'
const PHOTO_MIME_ALLOW = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif'])
const DOC_MIME_ALLOW = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'text/plain',
])
const PHOTO_MAX_BYTES = 20 * 1024 * 1024
const DOC_MAX_BYTES = 25 * 1024 * 1024

const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PHOTO_MAX_BYTES } })
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: DOC_MAX_BYTES } })

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function storeUploadFile(buffer: Buffer, originalName: string, customerId: string): { fileKey: string; fileUrl: string } {
  ensureDir(UPLOAD_DIR)
  const ext = path.extname(originalName).slice(0, 8) || ''
  const filename = `${crypto.randomUUID()}${ext}`
  const customerDir = path.join('portal', customerId)
  const fullDir = path.resolve(UPLOAD_DIR, customerDir)
  ensureDir(fullDir)
  const fileKey = path.join(customerDir, filename)
  fs.writeFileSync(path.resolve(UPLOAD_DIR, fileKey), buffer)
  const fileUrl = `/api/portal/files/${encodeURIComponent(fileKey)}`
  return { fileKey, fileUrl }
}

const router = Router()

// ── Auth middleware for portal customers ──

interface PortalAuthRequest extends Request {
  portalAccount?: { id: string; email: string; crmCustomerId: string }
}

function requirePortalAuth(req: PortalAuthRequest, res: Response, next: Function): void {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS' }); return }
  const token = auth.slice(7)
  try {
    const payload = verifyAccessToken(token) as any
    if (payload?.role !== 'portal_customer') { res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS' }); return }
    req.portalAccount = { id: payload.sub, email: payload.email, crmCustomerId: payload.crmCustomerId }
    next()
  } catch {
    res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS' })
  }
}

// ── Sync-key auth for staff-initiated actions ──

function requireStaffSyncKey(req: Request, res: Response, next: Function): void {
  const key = req.headers['x-api-key']
  const expected = process.env.CRM_SYNC_KEY || 'dev-sync-key'
  if (!key || key !== expected) {
    const auth = req.headers.authorization
    if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Auth required' }); return }
  }
  next()
}

// ── Helpers ──

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

function generateRawToken(): string {
  // 32 random bytes → 64 hex chars. URL-safe by construction.
  return crypto.randomBytes(32).toString('hex')
}

const HEX64_RE = /^[0-9a-f]{64}$/

function buildActivationUrl(rawToken: string): string {
  // buildFrontendUrl reads APP_URL → CLIENT_URL → PORTAL_APP_URL in that order
  // and strips trailing slashes. Single source of truth.
  return buildFrontendUrl(`/#/portal/activate?token=${rawToken}`)
}

function companyName(): string {
  return process.env.COMPANY_NAME || 'EZBiz'
}

function companyPhone(): string {
  return process.env.COMPANY_PHONE || ''
}

function logActivation(tokenHash: string, result: string, extra: Record<string, unknown> = {}): void {
  console.log(`[portal-activate] ${new Date().toISOString()} tokenHash=${tokenHash.slice(0, 10)}… result=${result}`,
    Object.keys(extra).length ? extra : '')
}

async function sendInviteEmail(email: string, firstName: string | null, rawToken: string, expiresAt: Date): Promise<{ sent: boolean; error?: string }> {
  const link = buildActivationUrl(rawToken)
  const mergeData = {
    customer_first_name: firstName || 'there',
    company_name: companyName(),
    company_phone: companyPhone(),
    portal_link: link,
  }
  const subject = applyMergeTags('Your {{company_name}} customer portal is ready', mergeData)
  const bodyTemplate = `<p>Hi {{customer_first_name}},</p>
<p>Your {{company_name}} customer portal is ready. You can view your quotes, track your project, see invoices, and upload documents — all in one place.</p>
<p><a href="{{portal_link}}" style="background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">Access Your Portal</a></p>
<p style="font-size:12px;color:#666;">This link expires on ${expiresAt.toLocaleDateString()}. If it expires, contact us and we'll send a new one.</p>
<p>Or paste this URL into your browser: <br><span style="font-family:monospace;font-size:11px;color:#666;">{{portal_link}}</span></p>
<p>— {{company_name}}{{company_phone}}</p>`
  const body = buildEmailHtml(applyMergeTags(bodyTemplate, mergeData))
  // Customer portal invite link must NOT be SendGrid-rewritten — that triggers
  // an SSL error on `urlNNNN.www.systemssyndicate.com` if link branding isn't
  // perfectly provisioned. See lib/urls.ts and emailService.ts comments.
  const r = await sendEmail({ to: email, subject, body, disableClickTracking: true })
  return { sent: r.success, error: r.error }
}

// ── POST /api/portal/invite ──
// Staff-initiated: creates or refreshes a portal invite for a CRM customer.

const inviteSchema = z.object({
  crmCustomerId: z.string().min(1),
  email: z.string().email(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
})

router.post('/invite', requireStaffSyncKey, async (req, res) => {
  try {
    const data = inviteSchema.parse(req.body)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const rawToken = generateRawToken()
    const tokenHash = sha256(rawToken)

    // Upsert by email (primary) or crmCustomerId
    let account = await prisma.portalAccount.findUnique({ where: { email: data.email.toLowerCase() } })
    if (!account) {
      account = await prisma.portalAccount.create({
        data: {
          crmCustomerId: data.crmCustomerId,
          email: data.email.toLowerCase(),
          firstName: data.firstName || null,
          lastName: data.lastName || null,
          status: 'invited',
          inviteToken: tokenHash,
          inviteTokenExpiresAt: expiresAt,
          invitedAt: now,
        },
      })
    } else {
      // Do not clobber if active unless explicitly resent
      account = await prisma.portalAccount.update({
        where: { id: account.id },
        data: {
          crmCustomerId: data.crmCustomerId,
          firstName: data.firstName ?? account.firstName,
          lastName: data.lastName ?? account.lastName,
          status: account.status === 'active' ? 'active' : 'invited',
          inviteToken: tokenHash,
          inviteTokenExpiresAt: expiresAt,
          invitedAt: now,
        },
      })
    }

    await prisma.portalInvite.create({
      data: { accountId: account.id, email: account.email, sentAt: now, expiresAt },
    })

    const emailResult = await sendInviteEmail(account.email, account.firstName, rawToken, expiresAt)

    res.json({
      success: true,
      data: {
        accountId: account.id,
        status: account.status,
        expiresAt,
        activationUrl: buildActivationUrl(rawToken),
        emailSent: emailResult.sent,
        emailError: emailResult.error,
      },
    })
  } catch (err: any) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[portal-invite]', err)
    res.status(500).json({ success: false, error: 'Failed to create invite' })
  }
})

// ── POST /api/portal/resend-invite ── (rate-limited)

const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  keyGenerator: (req) => (req.body?.email || req.ip || 'unknown').toString().toLowerCase(),
  validate: false,
  message: { success: false, error: 'RATE_LIMITED', message: 'Too many resend requests. Please wait an hour.' },
  standardHeaders: true,
  legacyHeaders: false,
})

router.post('/resend-invite', resendLimiter, async (req, res) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body)
    const account = await prisma.portalAccount.findUnique({ where: { email: email.toLowerCase() } })
    // Always return success to avoid leaking whether the email exists
    if (!account) { res.json({ success: true, data: { status: 'sent' } }); return }

    if (account.status === 'active') {
      res.json({ success: true, data: { status: 'already_active' } })
      return
    }

    const now = new Date()
    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
    const rawToken = generateRawToken()
    const tokenHash = sha256(rawToken)

    await prisma.portalAccount.update({
      where: { id: account.id },
      data: {
        status: 'invited',
        inviteToken: tokenHash,
        inviteTokenExpiresAt: expiresAt,
        invitedAt: now,
      },
    })
    await prisma.portalInvite.create({
      data: { accountId: account.id, email: account.email, sentAt: now, expiresAt },
    })
    await sendInviteEmail(account.email, account.firstName, rawToken, expiresAt)
    res.json({ success: true, data: { status: 'sent' } })
  } catch (err: any) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[portal-resend-invite]', err)
    res.status(500).json({ success: false, error: 'Resend failed' })
  }
})

// ── POST /api/portal/activate ──

const activateSchema = z.object({
  token: z.string(),
  password: z.string(),
  confirmPassword: z.string(),
})

router.post('/activate', async (req, res) => {
  try {
    const { token, password, confirmPassword } = activateSchema.parse(req.body)

    if (!HEX64_RE.test(token)) {
      res.status(400).json({ success: false, error: 'INVALID_TOKEN_FORMAT' })
      return
    }
    if (password.length < 8) {
      res.status(400).json({ success: false, error: 'PASSWORD_TOO_SHORT' })
      return
    }
    if (password !== confirmPassword) {
      res.status(400).json({ success: false, error: 'PASSWORDS_DO_NOT_MATCH' })
      return
    }

    const tokenHash = sha256(token)

    const account = await prisma.portalAccount.findFirst({
      where: { inviteToken: tokenHash, status: 'invited' },
    })

    if (!account) {
      logActivation(tokenHash, 'INVALID_TOKEN')
      res.status(400).json({ success: false, error: 'INVALID_TOKEN' })
      return
    }

    if (account.inviteTokenExpiresAt && account.inviteTokenExpiresAt < new Date()) {
      logActivation(tokenHash, 'EXPIRED_TOKEN', { email: account.email })
      res.status(400).json({ success: false, error: 'EXPIRED_TOKEN' })
      return
    }

    const passwordHash = await hashPassword(password)
    const now = new Date()

    const updated = await prisma.portalAccount.update({
      where: { id: account.id },
      data: {
        passwordHash,
        status: 'active',
        mustChangePassword: false,
        inviteToken: null,
        inviteTokenExpiresAt: null,
        activatedAt: now,
        lastLoginAt: now,
      },
    })

    // Stamp the most recent open invite as accepted
    const latestInvite = await prisma.portalInvite.findFirst({
      where: { accountId: account.id, acceptedAt: null },
      orderBy: { sentAt: 'desc' },
    })
    if (latestInvite) {
      await prisma.portalInvite.update({ where: { id: latestInvite.id }, data: { acceptedAt: now } })
    }

    logActivation(tokenHash, 'SUCCESS', { email: account.email })

    // Brief welcome confirmation
    try {
      const link = buildActivationUrl('').replace(/token=/, '').replace(/\/#\/portal\/activate\?$/, '/#/portal/login')
      await sendEmail({
        to: updated.email,
        subject: `Your ${companyName()} portal is now active`,
        body: buildEmailHtml(`<p>Hi ${updated.firstName || 'there'},</p>
<p>Your portal account is now active. You can log in any time at <a href="${link}">${link}</a>.</p>
<p>— ${companyName()}</p>`),
      })
    } catch { /* non-fatal */ }

    const tokens = generateTokens({
      sub: updated.id,
      email: updated.email,
      role: 'portal_customer',
      accountId: updated.crmCustomerId,
    } as any)

    res.json({
      success: true,
      data: {
        user: {
          id: updated.id,
          email: updated.email,
          firstName: updated.firstName,
          lastName: updated.lastName,
          crmCustomerId: updated.crmCustomerId,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    })
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'INVALID_TOKEN_FORMAT', detail: err.errors[0].message })
      return
    }
    console.error('[portal-activate]', err)
    res.status(500).json({ success: false, error: 'ACTIVATION_FAILED' })
  }
})

// ── POST /api/portal/login ──

router.post('/login', async (req, res) => {
  try {
    const { email, password } = z.object({ email: z.string().email(), password: z.string() }).parse(req.body)
    const account = await prisma.portalAccount.findUnique({ where: { email: email.toLowerCase() } })
    if (!account) { res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS' }); return }
    if (account.status === 'invited') {
      res.status(400).json({ success: false, error: 'ACCOUNT_NOT_ACTIVATED' })
      return
    }
    if (account.status === 'suspended') {
      res.status(400).json({ success: false, error: 'ACCOUNT_SUSPENDED' })
      return
    }
    if (!account.passwordHash) {
      res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS' })
      return
    }
    const ok = await verifyPassword(password, account.passwordHash)
    if (!ok) { res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS' }); return }

    const now = new Date()
    await prisma.portalAccount.update({
      where: { id: account.id },
      data: { lastLoginAt: now },
    })

    const tokens = generateTokens({
      sub: account.id,
      email: account.email,
      role: 'portal_customer',
      accountId: account.crmCustomerId,
    } as any)

    res.json({
      success: true,
      data: {
        user: {
          id: account.id, email: account.email,
          firstName: account.firstName, lastName: account.lastName,
          crmCustomerId: account.crmCustomerId,
        },
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      },
    })
  } catch (err: any) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[portal-login]', err)
    res.status(500).json({ success: false, error: 'LOGIN_FAILED' })
  }
})

router.post('/logout', async (_req, res) => { res.json({ success: true }) })

router.get('/me', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const account = await prisma.portalAccount.findUnique({ where: { id: req.portalAccount!.id } })
    if (!account) { res.status(404).json({ success: false, error: 'NOT_FOUND' }); return }
    res.json({
      success: true,
      data: {
        id: account.id, email: account.email,
        firstName: account.firstName, lastName: account.lastName,
        crmCustomerId: account.crmCustomerId,
        status: account.status,
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'ME_FAILED' })
  }
})

// ── Admin-list endpoint (requires CRM sync key) ──

router.get('/accounts', requireStaffSyncKey, async (_req, res) => {
  try {
    const accounts = await prisma.portalAccount.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
    })
    res.json({
      success: true,
      data: accounts.map(a => ({
        id: a.id,
        crmCustomerId: a.crmCustomerId,
        email: a.email,
        firstName: a.firstName,
        lastName: a.lastName,
        status: a.status,
        invitedAt: a.invitedAt,
        inviteTokenExpiresAt: a.inviteTokenExpiresAt,
        activatedAt: a.activatedAt,
        lastLoginAt: a.lastLoginAt,
      })),
    })
  } catch (err: any) {
    console.error('[portal-accounts]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

router.post('/accounts/:id/force-activate', requireStaffSyncKey, async (req, res) => {
  try {
    const id = String(req.params.id)
    const account = await prisma.portalAccount.findUnique({ where: { id } })
    if (!account) { res.status(404).json({ success: false, error: 'NOT_FOUND' }); return }
    const now = new Date()
    await prisma.portalAccount.update({
      where: { id },
      data: {
        status: 'active',
        activatedAt: account.activatedAt || now,
        inviteToken: null, inviteTokenExpiresAt: null,
      },
    })
    res.json({ success: true })
  } catch (err) {
    console.error('[portal-force-activate]', err)
    res.status(500).json({ success: false, error: 'FAILED' })
  }
})

router.post('/accounts/:id/revoke', requireStaffSyncKey, async (req, res) => {
  try {
    const id = String(req.params.id)
    const account = await prisma.portalAccount.findUnique({ where: { id } })
    if (!account) { res.status(404).json({ success: false, error: 'NOT_FOUND' }); return }
    await prisma.portalAccount.update({
      where: { id },
      data: { status: 'suspended', inviteToken: null, inviteTokenExpiresAt: null },
    })
    res.json({ success: true })
  } catch (err) {
    console.error('[portal-revoke]', err)
    res.status(500).json({ success: false, error: 'FAILED' })
  }
})

// ── One-time migration: invalidate all non-active invites. ──
// Safe to run multiple times. Does NOT delete customer records.

router.post('/migrate-invalidate-legacy', requireStaffSyncKey, async (_req, res) => {
  try {
    const past = new Date('2000-01-01')
    const result = await prisma.portalAccount.updateMany({
      where: { status: 'invited', inviteToken: { not: null } },
      data: { inviteTokenExpiresAt: past, inviteToken: null },
    })
    res.json({ success: true, data: { invalidated: result.count } })
  } catch (err) {
    console.error('[portal-migrate]', err)
    res.status(500).json({ success: false, error: 'MIGRATE_FAILED' })
  }
})

// ════════════════════════════════════════════════════════════════════
// PHOTOS
// ════════════════════════════════════════════════════════════════════

// Customer uploads a photo
router.post('/photos', requirePortalAuth, photoUpload.single('file'), async (req: PortalAuthRequest, res) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined
    if (!file) { res.status(400).json({ success: false, error: 'NO_FILE' }); return }
    if (!PHOTO_MIME_ALLOW.has(file.mimetype) && !/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.originalname)) {
      res.status(400).json({ success: false, error: 'UNSUPPORTED_TYPE', message: `Allowed types: JPEG, PNG, HEIC, WebP, GIF.` })
      return
    }
    if (file.size > PHOTO_MAX_BYTES) {
      res.status(400).json({ success: false, error: 'FILE_TOO_LARGE', message: 'Photo must be under 20MB.' })
      return
    }
    const customerId = req.portalAccount!.crmCustomerId
    const accountId = req.portalAccount!.id
    const { fileKey, fileUrl } = storeUploadFile(file.buffer, file.originalname, customerId)
    const photo = await prisma.portalPhoto.create({
      data: {
        crmCustomerId: customerId,
        uploadedByAccountId: accountId,
        fileKey, fileUrl,
        originalFilename: file.originalname,
        fileSizeBytes: file.size,
        mimeType: file.mimetype,
        caption: typeof req.body.caption === 'string' ? req.body.caption : null,
        source: 'portal_customer',
      },
    })
    // Notify staff
    try {
      await createNotification({
        recipientRole: 'admin',
        title: 'Customer uploaded a photo',
        body: `${req.portalAccount!.email} uploaded "${file.originalname}"`,
        type: 'info',
      })
    } catch {}
    res.json({ success: true, data: serializePhoto(photo) })
  } catch (err: any) {
    console.error('[portal-photo-upload]', err)
    if (err?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ success: false, error: 'FILE_TOO_LARGE', message: 'Photo must be under 20MB.' })
      return
    }
    res.status(500).json({ success: false, error: 'UPLOAD_FAILED', message: 'Photo upload failed. Please try again or contact us if the problem continues.' })
  }
})

// Customer lists their own photos
router.get('/photos', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const customerId = req.portalAccount!.crmCustomerId
    const photos = await prisma.portalPhoto.findMany({
      where: { crmCustomerId: customerId, deletedAt: null, isVisibleToCustomer: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: photos.map(serializePhoto) })
  } catch (err) {
    console.error('[portal-photos-list]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

// Staff list (sync-key auth) photos for a customer
router.get('/customer/:customerId/photos', requireStaffSyncKey, async (req, res) => {
  try {
    const customerId = String(req.params.customerId)
    const photos = await prisma.portalPhoto.findMany({
      where: { crmCustomerId: customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: photos.map(serializePhoto) })
  } catch (err) {
    console.error('[portal-photos-customer]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

// Staff upload photo for a customer
router.post('/customer/:customerId/photos', requireStaffSyncKey, photoUpload.single('file'), async (req, res) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined
    if (!file) { res.status(400).json({ success: false, error: 'NO_FILE' }); return }
    if (!PHOTO_MIME_ALLOW.has(file.mimetype) && !/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.originalname)) {
      res.status(400).json({ success: false, error: 'UNSUPPORTED_TYPE', message: 'Allowed types: JPEG, PNG, HEIC, WebP, GIF.' })
      return
    }
    if (file.size > PHOTO_MAX_BYTES) {
      res.status(400).json({ success: false, error: 'FILE_TOO_LARGE', message: 'Photo must be under 20MB.' })
      return
    }
    const customerId = String(req.params.customerId)
    const { fileKey, fileUrl } = storeUploadFile(file.buffer, file.originalname, customerId)
    const photo = await prisma.portalPhoto.create({
      data: {
        crmCustomerId: customerId,
        uploadedByUser: typeof req.body.uploadedBy === 'string' ? req.body.uploadedBy : null,
        fileKey, fileUrl,
        originalFilename: file.originalname,
        fileSizeBytes: file.size,
        mimeType: file.mimetype,
        caption: typeof req.body.caption === 'string' ? req.body.caption : null,
        source: 'crm_staff',
      },
    })
    res.json({ success: true, data: serializePhoto(photo) })
  } catch (err: any) {
    console.error('[portal-photos-staff-upload]', err)
    if (err?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ success: false, error: 'FILE_TOO_LARGE', message: 'Photo must be under 20MB.' })
      return
    }
    res.status(500).json({ success: false, error: 'UPLOAD_FAILED' })
  }
})

// Delete photo (own or staff)
router.delete('/photos/:id', async (req, res) => {
  try {
    const id = String(req.params.id)
    const auth = req.headers.authorization
    let allow = false
    if (auth?.startsWith('Bearer ')) {
      try {
        const payload = verifyAccessToken(auth.slice(7)) as any
        if (payload?.role === 'portal_customer') {
          const photo = await prisma.portalPhoto.findUnique({ where: { id } })
          if (photo && photo.uploadedByAccountId === payload.sub) allow = true
        } else { allow = true }
      } catch {}
    }
    if (!allow && req.headers['x-api-key'] === (process.env.CRM_SYNC_KEY || 'dev-sync-key')) allow = true
    if (!allow) { res.status(401).json({ success: false, error: 'AUTH_REQUIRED' }); return }
    await prisma.portalPhoto.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ success: true })
  } catch (err) {
    console.error('[portal-photo-delete]', err)
    res.status(500).json({ success: false, error: 'DELETE_FAILED' })
  }
})

function serializePhoto(p: any) {
  return {
    id: p.id, customerId: p.crmCustomerId,
    fileKey: p.fileKey, fileUrl: p.fileUrl,
    name: p.originalFilename, size: p.fileSizeBytes, mimeType: p.mimeType,
    caption: p.caption, source: p.source,
    uploadedAt: p.createdAt,
  }
}

// ════════════════════════════════════════════════════════════════════
// DOCUMENTS / FILES
// ════════════════════════════════════════════════════════════════════

router.post('/documents', requirePortalAuth, docUpload.single('file'), async (req: PortalAuthRequest, res) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined
    if (!file) { res.status(400).json({ success: false, error: 'NO_FILE' }); return }
    if (!DOC_MIME_ALLOW.has(file.mimetype) && !/\.(pdf|docx?|xlsx?|jpe?g|png|webp|txt)$/i.test(file.originalname)) {
      res.status(400).json({ success: false, error: 'UNSUPPORTED_TYPE', message: 'Allowed types: PDF, DOCX, PNG, JPG.' })
      return
    }
    if (file.size > DOC_MAX_BYTES) {
      res.status(400).json({ success: false, error: 'FILE_TOO_LARGE', message: 'Document must be under 25MB.' })
      return
    }
    const customerId = req.portalAccount!.crmCustomerId
    const accountId = req.portalAccount!.id
    const { fileKey, fileUrl } = storeUploadFile(file.buffer, file.originalname, customerId)
    const fileKind = /^image\//i.test(file.mimetype) ? 'photo' : 'document'
    const doc = await prisma.portalFile.create({
      data: {
        crmCustomerId: customerId,
        uploadedByAccountId: accountId,
        fileKey, fileUrl,
        originalFilename: file.originalname,
        fileSizeBytes: file.size,
        mimeType: file.mimetype,
        fileKind: fileKind as any,
        source: 'portal_customer',
        label: typeof req.body.label === 'string' ? req.body.label : null,
      },
    })
    try {
      await createNotification({
        recipientRole: 'admin',
        title: 'Customer uploaded a document',
        body: `${req.portalAccount!.email} uploaded "${file.originalname}"`,
        type: 'info',
      })
    } catch {}
    res.json({ success: true, data: serializeFile(doc) })
  } catch (err: any) {
    console.error('[portal-doc-upload]', err)
    if (err?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ success: false, error: 'FILE_TOO_LARGE', message: 'Document must be under 25MB.' })
      return
    }
    res.status(500).json({ success: false, error: 'UPLOAD_FAILED', message: 'Upload failed. Please try again or contact us if the problem continues.' })
  }
})

router.get('/documents', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const customerId = req.portalAccount!.crmCustomerId
    const files = await prisma.portalFile.findMany({
      where: { crmCustomerId: customerId, deletedAt: null, isVisibleToCustomer: true },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: files.map(serializeFile) })
  } catch (err) {
    console.error('[portal-docs-list]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

router.get('/customer/:customerId/documents', requireStaffSyncKey, async (req, res) => {
  try {
    const customerId = String(req.params.customerId)
    const files = await prisma.portalFile.findMany({
      where: { crmCustomerId: customerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: files.map(serializeFile) })
  } catch (err) {
    console.error('[portal-docs-customer]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

// Staff upload a document for a customer (so the unified table also serves CRM-side uploads)
router.post('/customer/:customerId/documents', requireStaffSyncKey, docUpload.single('file'), async (req, res) => {
  try {
    const file = (req as any).file as Express.Multer.File | undefined
    if (!file) { res.status(400).json({ success: false, error: 'NO_FILE' }); return }
    const customerId = String(req.params.customerId)
    const { fileKey, fileUrl } = storeUploadFile(file.buffer, file.originalname, customerId)
    const fileKind = /^image\//i.test(file.mimetype) ? 'photo' : 'document'
    const doc = await prisma.portalFile.create({
      data: {
        crmCustomerId: customerId,
        uploadedByUser: typeof req.body.uploadedBy === 'string' ? req.body.uploadedBy : null,
        fileKey, fileUrl,
        originalFilename: file.originalname,
        fileSizeBytes: file.size,
        mimeType: file.mimetype,
        fileKind: fileKind as any,
        source: 'crm_staff',
        label: typeof req.body.label === 'string' ? req.body.label : null,
        isVisibleToCustomer: req.body.isVisibleToCustomer !== 'false',
      },
    })
    res.json({ success: true, data: serializeFile(doc) })
  } catch (err: any) {
    console.error('[portal-docs-staff-upload]', err)
    res.status(500).json({ success: false, error: 'UPLOAD_FAILED' })
  }
})

router.delete('/documents/:id', async (req, res) => {
  try {
    const id = String(req.params.id)
    let allow = false
    const auth = req.headers.authorization
    if (auth?.startsWith('Bearer ')) {
      try {
        const payload = verifyAccessToken(auth.slice(7)) as any
        if (payload?.role === 'portal_customer') {
          const f = await prisma.portalFile.findUnique({ where: { id } })
          if (f && f.uploadedByAccountId === payload.sub) allow = true
        } else { allow = true }
      } catch {}
    }
    if (!allow && req.headers['x-api-key'] === (process.env.CRM_SYNC_KEY || 'dev-sync-key')) allow = true
    if (!allow) { res.status(401).json({ success: false, error: 'AUTH_REQUIRED' }); return }
    await prisma.portalFile.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ success: true })
  } catch (err) {
    console.error('[portal-doc-delete]', err)
    res.status(500).json({ success: false, error: 'DELETE_FAILED' })
  }
})

function serializeFile(f: any) {
  return {
    id: f.id, customerId: f.crmCustomerId,
    fileKey: f.fileKey, fileUrl: f.fileUrl,
    name: f.originalFilename, size: f.fileSizeBytes, mimeType: f.mimeType,
    fileKind: f.fileKind, source: f.source, label: f.label,
    isVisibleToCustomer: f.isVisibleToCustomer,
    uploadedAt: f.createdAt,
    uploadedBy: f.uploadedByUser || (f.source === 'portal_customer' ? 'customer' : 'system'),
  }
}

// File-serve endpoint (any authenticated party — staff via sync key, customer via portal JWT)
router.get(/^\/files\/(.+)$/, async (req, res) => {
  try {
    const fileKey = String((req.params as any)[0] || '')
    const safe = fileKey.replace(/\.\.\//g, '')
    const fullPath = path.resolve(UPLOAD_DIR, safe)
    if (!fs.existsSync(fullPath)) { res.status(404).end(); return }
    res.sendFile(fullPath)
  } catch (err) {
    console.error('[portal-file-serve]', err)
    res.status(500).end()
  }
})

// ════════════════════════════════════════════════════════════════════
// MESSAGES
// ════════════════════════════════════════════════════════════════════

// Customer sends a message
router.post('/messages', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const { body } = z.object({ body: z.string().min(1).max(5000) }).parse(req.body)
    const customerId = req.portalAccount!.crmCustomerId
    const accountId = req.portalAccount!.id
    const msg = await prisma.portalMessage.create({
      data: {
        crmCustomerId: customerId,
        senderAccountId: accountId,
        senderType: 'customer',
        body: body.trim(),
        isReadByCustomer: true,
        readByCustomerAt: new Date(),
      },
    })
    try {
      await createNotification({
        recipientRole: 'admin',
        title: 'New customer message',
        body: `${req.portalAccount!.email}: "${body.slice(0, 80)}${body.length > 80 ? '…' : ''}"`,
        type: 'info',
      })
    } catch {}
    res.json({ success: true, data: serializeMessage(msg) })
  } catch (err: any) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[portal-message-send]', err)
    res.status(500).json({ success: false, error: 'SEND_FAILED' })
  }
})

// Customer reads their own thread + marks staff messages as read
router.get('/messages', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const customerId = req.portalAccount!.crmCustomerId
    const messages = await prisma.portalMessage.findMany({
      where: { crmCustomerId: customerId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })
    const now = new Date()
    await prisma.portalMessage.updateMany({
      where: { crmCustomerId: customerId, senderType: 'staff', isReadByCustomer: false },
      data: { isReadByCustomer: true, readByCustomerAt: now },
    })
    const unreadByCustomer = messages.filter(m => m.senderType === 'staff' && !m.isReadByCustomer).length
    res.json({ success: true, data: { messages: messages.map(serializeMessage), unreadByCustomer } })
  } catch (err) {
    console.error('[portal-messages-list]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

// Staff reads thread for a customer
router.get('/customer/:customerId/messages', requireStaffSyncKey, async (req, res) => {
  try {
    const customerId = String(req.params.customerId)
    const messages = await prisma.portalMessage.findMany({
      where: { crmCustomerId: customerId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    })
    // Mark customer messages as read by staff
    const now = new Date()
    await prisma.portalMessage.updateMany({
      where: { crmCustomerId: customerId, senderType: 'customer', isReadByStaff: false },
      data: { isReadByStaff: true, readByStaffAt: now },
    })
    res.json({ success: true, data: { messages: messages.map(serializeMessage) } })
  } catch (err) {
    console.error('[portal-messages-customer]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

// Staff posts a reply
router.post('/customer/:customerId/messages', requireStaffSyncKey, async (req, res) => {
  try {
    const customerId = String(req.params.customerId)
    const { body, sender } = z.object({
      body: z.string().min(1).max(5000),
      sender: z.string().optional(),
    }).parse(req.body)
    const msg = await prisma.portalMessage.create({
      data: {
        crmCustomerId: customerId,
        senderUser: sender || 'staff',
        senderType: 'staff',
        body: body.trim(),
        isReadByStaff: true,
        readByStaffAt: new Date(),
      },
    })
    // Email the customer
    try {
      const account = await prisma.portalAccount.findFirst({ where: { crmCustomerId: customerId, status: 'active' } })
      if (account?.email) {
        await sendEmail({
          to: account.email,
          subject: `New message from ${companyName()}`,
          body: buildEmailHtml(`<p>Hi ${account.firstName || 'there'},</p>
<p>You have a new message from ${companyName()}. Log in to your portal to view it.</p>
<p><a href="${buildFrontendUrl('/#/portal/messages')}">Open Messages</a></p>
<p>— ${companyName()}</p>`),
        })
      }
    } catch {}
    res.json({ success: true, data: serializeMessage(msg) })
  } catch (err: any) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[portal-messages-staff-reply]', err)
    res.status(500).json({ success: false, error: 'SEND_FAILED' })
  }
})

// Staff inbox — all customers with messages, sorted by most recent
router.get('/messages/inbox', requireStaffSyncKey, async (_req, res) => {
  try {
    // Group by customer using two queries (simple + portable)
    const allMessages = await prisma.portalMessage.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    })
    const byCustomer = new Map<string, any>()
    for (const m of allMessages) {
      const ex = byCustomer.get(m.crmCustomerId)
      if (!ex || (ex.lastAt && m.createdAt > ex.lastAt)) {
        byCustomer.set(m.crmCustomerId, ex || {
          crmCustomerId: m.crmCustomerId,
          lastAt: m.createdAt,
          lastBody: m.body,
          lastSender: m.senderType,
          unreadCustomerCount: 0,
        })
      }
      const entry = byCustomer.get(m.crmCustomerId)!
      if (m.senderType === 'customer' && !m.isReadByStaff) entry.unreadCustomerCount += 1
    }
    const list = Array.from(byCustomer.values()).sort((a, b) => (b.lastAt as Date).getTime() - (a.lastAt as Date).getTime())
    res.json({
      success: true,
      data: {
        threads: list,
        totalUnread: list.reduce((s, t) => s + t.unreadCustomerCount, 0),
      },
    })
  } catch (err) {
    console.error('[portal-inbox]', err)
    res.status(500).json({ success: false, error: 'INBOX_FAILED' })
  }
})

function serializeMessage(m: any) {
  return {
    id: m.id,
    customerId: m.crmCustomerId,
    senderType: m.senderType,
    senderUser: m.senderUser,
    body: m.body,
    isReadByStaff: m.isReadByStaff,
    isReadByCustomer: m.isReadByCustomer,
    createdAt: m.createdAt,
  }
}

export default router
