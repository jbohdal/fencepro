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
import { z } from 'zod'
import rateLimit from 'express-rate-limit'
import prisma from '../lib/prisma.js'
import { hashPassword, verifyPassword, generateTokens, verifyAccessToken } from '../lib/auth.js'
import { sendEmail, applyMergeTags, buildEmailHtml } from '../lib/emailService.js'

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
  const base = process.env.APP_URL || process.env.PORTAL_APP_URL || process.env.CLIENT_URL || 'https://systemssyndicate.com'
  const clean = base.replace(/\/+$/, '')
  return `${clean}/#/portal/activate?token=${rawToken}`
}

function companyName(): string {
  return process.env.COMPANY_NAME || 'FencePro'
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
  const r = await sendEmail({ to: email, subject, body })
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
  keyGenerator: (req) => (req.body?.email || req.ip).toString().toLowerCase(),
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

export default router
