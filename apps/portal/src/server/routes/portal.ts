/**
 * Customer Portal API.
 *
 * Endpoints (all /api/portal):
 *   POST /invite         — create/refresh an invite for a CRM customer (staff authed via CRM sync key)
 *   POST /resend-invite  — customer-initiated resend by email (rate-limited)
 *   POST /activate       — accept the invite: validate token, set password, sign in (session cookie)
 *   POST /login          — customer login (session cookie)
 *   POST /logout         — end this session and clear the cookie
 *   GET  /me             — who is signed in, with their name, phone and address from the CRM
 *   POST /me/password    — change the password (ends the other sessions)
 *   GET  /company        — the company's name, phone and portal colors (no sign in needed)
 *   GET  /quotes         — the customer's sent, sold and lost quotes (price, never a cost)
 *   GET  /projects       — the customer's jobs (status, install date, crew)
 *   GET  /invoices       — the customer's sent invoices
 *   GET  /change-orders  — the customer's own change orders (sent, approved, void ones they were shown)
 *   POST /change-orders/:id/sign — approve and sign one ({ name, signature }), lib/changeOrders.ts
 *
 * Sign in: a server side session in an httpOnly cookie (lib/portalSession.ts).
 * Nothing about the sign in, and no business data, is kept in the browser's
 * storage. Every customer route reads the customer from the session's login
 * row on the server.
 *
 * Invite token architecture:
 *   - Raw tokens: crypto.randomBytes(32).toString('hex') → 64 hex chars, URL-safe
 *   - Stored: sha256(rawToken) — never the raw value
 *   - Validation: sha256 the incoming token, lookup by hash
 *   - Passwords: bcrypt (12 rounds)
 */

import { serializeMedia } from '../lib/media.js'
import { Router, type Request, type Response } from 'express'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { z } from 'zod'
import rateLimit, { ipKeyGenerator } from 'express-rate-limit'
import prisma from '../lib/prisma.js'
import { isUniqueViolation, requestIdOf } from '../lib/once.js'
import { hashPassword, verifyPassword } from '../lib/auth.js'
import { requirePortalAuth, startPortalSession, clearPortalCookie, endPortalSessionOf, revokePortalSessions, portalIdentityOf, type PortalIdentity } from '../lib/portalSession.js'
import { signedFileUrl, checkFileSig, isPublicFileKey } from '../lib/portalFiles.js'
import { resolveIntakeAccountId } from '../lib/intake.js'
import { sendEmail, applyMergeTags, buildEmailHtml } from '../lib/emailService.js'
import { createNotification } from '../lib/notificationService.js'
import { buildFrontendUrl } from '../lib/urls.js'
import { isStaffRequest } from '../lib/secrets.js'
import { plainZod } from '../lib/plainZod.js'
import { requireStaffCan } from '../lib/permissions.js'
import { changeOrdersForContact, signByCustomer, customerView } from '../lib/changeOrders.js'
import { signSchema as coSignSchema } from './changeOrderPublic.js'

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
  portalAccount?: PortalIdentity
}

// requirePortalAuth (lib/portalSession.ts): the session cookie, looked up on
// the server; writes also need the X-Portal-Request header.

// ── Sync-key auth for staff-initiated actions ──

// Staff actions need the sync key or a VERIFIED staff login token. This used
// to accept any Authorization header that started with "Bearer ".
function requireStaffSyncKey(req: Request, res: Response, next: Function): void {
  if (!isStaffRequest(req)) { res.status(401).json({ success: false, error: 'Auth required' }); return }
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
  return process.env.COMPANY_NAME || 'Getter Done Fence'
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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
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

    // Signed in: the session cookie (no token in the answer, nothing for the page to keep).
    await startPortalSession(req, res, updated.id)
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
      },
    })
  } catch (err: any) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: 'INVALID_TOKEN_FORMAT', detail: plainZod(err) })
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

    await startPortalSession(req, res, account.id)
    res.json({
      success: true,
      data: {
        user: {
          id: account.id, email: account.email,
          firstName: account.firstName, lastName: account.lastName,
          crmCustomerId: account.crmCustomerId,
        },
      },
    })
  } catch (err: any) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[portal-login]', err)
    res.status(500).json({ success: false, error: 'LOGIN_FAILED' })
  }
})

router.post('/logout', async (req, res) => {
  try { await endPortalSessionOf(req) } catch (err) { console.error('[portal-logout]', err) }
  clearPortalCookie(req, res)
  res.json({ success: true })
})

/** The customer's CRM record (the portal login's customer), or null. */
async function contactOf(crmCustomerId: string) {
  return prisma.crmContact.findUnique({
    where: { id: crmCustomerId },
    select: { id: true, accountId: true, firstName: true, lastName: true, phone: true, serviceAddress: true },
  })
}

router.get('/me', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const account = await prisma.portalAccount.findUnique({ where: { id: req.portalAccount!.id } })
    if (!account) { res.status(404).json({ success: false, error: 'NOT_FOUND' }); return }
    const c = await contactOf(account.crmCustomerId)
    res.json({
      success: true,
      data: {
        id: account.id, email: account.email,
        firstName: account.firstName ?? c?.firstName ?? '', lastName: account.lastName ?? c?.lastName ?? '',
        crmCustomerId: account.crmCustomerId,
        status: account.status,
        customer: c ? { firstName: c.firstName, lastName: c.lastName, phone: c.phone ?? '', serviceAddress: c.serviceAddress ?? '' } : null,
      },
    })
  } catch {
    res.status(500).json({ success: false, error: 'ME_FAILED' })
  }
})

// Change the password: the current one, then the new one twice. Every other
// session of this login ends; this one stays signed in.
router.post('/me/password', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const b = z.object({ currentPassword: z.string().min(1).max(200), password: z.string().max(200), confirmPassword: z.string().max(200) }).parse(req.body)
    if (b.password.length < 8) { res.status(400).json({ success: false, error: 'PASSWORD_TOO_SHORT' }); return }
    if (b.password !== b.confirmPassword) { res.status(400).json({ success: false, error: 'PASSWORDS_DO_NOT_MATCH' }); return }
    const account = await prisma.portalAccount.findUnique({ where: { id: req.portalAccount!.id } })
    if (!account?.passwordHash || !(await verifyPassword(b.currentPassword, account.passwordHash))) {
      res.status(401).json({ success: false, error: 'WRONG_PASSWORD' }); return
    }
    await prisma.portalAccount.update({ where: { id: account.id }, data: { passwordHash: await hashPassword(b.password), mustChangePassword: false } })
    const ended = await revokePortalSessions(account.id, req.portalAccount!.sessionId)
    console.log(`[portal] ${account.email} changed their password; ${ended} other sign in(s) ended`)
    res.json({ success: true })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[portal-password]', err)
    res.status(500).json({ success: false, error: 'PASSWORD_FAILED' })
  }
})

// ── The company: name, phone, email and the portal's look (Settings → Company / Portal) ──
// No sign in needed (the sign in page shows it). Only these fields leave the server.

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

router.get('/company', async (req, res) => {
  try {
    const who = await portalIdentityOf(req)
    const accountId = (who ? (await contactOf(who.crmCustomerId))?.accountId : null) ?? await resolveIntakeAccountId()
    const b = accountId ? await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } }) : null
    const cfg = obj(b?.config), company = obj(cfg.company), portal = obj(cfg.portal)
    res.json({
      success: true,
      data: {
        name: str(company.name) || companyName(), phone: str(company.phone), email: str(company.email),
        portal: {
          accentColor: /^#[0-9a-f]{3,8}$/i.test(str(portal.accentColor)) ? str(portal.accentColor) : '',
          supportEmail: str(portal.supportEmail), supportPhone: str(portal.supportPhone), welcomeMessage: str(portal.welcomeMessage),
        },
      },
    })
  } catch (err) {
    console.error('[portal-company]', err)
    res.status(500).json({ success: false, error: 'COMPANY_FAILED' })
  }
})

// ── Quotes, projects and invoices: this customer's only ──
// Every query is filtered by the session's customer and that customer's
// company. Prices the customer was given, never a cost or margin.

const QUOTE_STATUSES_SHOWN = ['SENT', 'SOLD', 'LOST'] as const

router.get('/quotes', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    if (!c?.accountId) { res.json({ success: true, data: [] }); return }
    const now = Date.now()
    const rows = await prisma.savedQuote.findMany({
      where: { accountId: c.accountId, crmContactId: c.id, archivedAt: null, status: { in: [...QUOTE_STATUSES_SHOWN] as any } },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, fenceStyle: true, date: true, finalPrice: true, status: true, layout: true, runs: true, shareToken: true, shareDisabledAt: true, shareExpiresAt: true },
    })
    res.json({
      success: true,
      data: rows.map(q => ({
        id: q.id, fenceStyle: q.fenceStyle, date: q.date, status: q.status,
        priceCents: Math.round((q.finalPrice || 0) * 100),
        layout: q.layout ?? null, runs: Array.isArray(q.runs) ? q.runs : [],
        // The customer's own quote link, when the office made one and it still works.
        shareToken: q.shareToken && !q.shareDisabledAt && (!q.shareExpiresAt || q.shareExpiresAt.getTime() > now) ? q.shareToken : null,
      })),
    })
  } catch (err) {
    console.error('[portal-quotes]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

router.get('/projects', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    if (!c?.accountId) { res.json({ success: true, data: [] }); return }
    const quotes = await prisma.savedQuote.findMany({ where: { accountId: c.accountId, crmContactId: c.id }, select: { id: true } })
    const jobs = await prisma.savedJob.findMany({
      where: { accountId: c.accountId, archivedAt: null, OR: [{ crmContactId: c.id }, ...(quotes.length ? [{ quoteId: { in: quotes.map(q => q.id) } }] : [])] },
      orderBy: { createdAt: 'desc' },
      select: { id: true, fenceStyle: true, status: true, scheduledDate: true, crewAssigned: true, customerAddress: true },
    })
    res.json({ success: true, data: jobs })
  } catch (err) {
    console.error('[portal-projects]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0)

router.get('/invoices', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    if (!c?.accountId) { res.json({ success: true, data: [] }); return }
    const b = await prisma.businessState.findUnique({ where: { accountId: c.accountId }, select: { invoices: true } })
    const all = Array.isArray(b?.invoices) ? (b!.invoices as any[]) : []
    const mine = all.filter(i => i && i.customerId === c.id && i.status !== 'draft' && i.status !== 'void')
    res.json({
      success: true,
      data: mine.map(i => ({
        id: str(i.id), invoiceNumber: str(i.invoiceNumber), title: str(i.title), status: str(i.status),
        dueDate: str(i.dueDate), issuedDate: str(i.issuedDate),
        totalCents: int(i.totalCents), amountPaidCents: int(i.amountPaidCents), balanceDueCents: int(i.balanceDueCents),
      })),
    })
  } catch (err) {
    console.error('[portal-invoices]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

// ── Change orders: the customer's own, and "Approve and sign" ──
// Only change orders on quotes whose customer is this portal login's customer
// (the portal token's crmCustomerId); lines, amounts and totals, never a cost.

router.get('/change-orders', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    res.json({ success: true, data: await changeOrdersForContact(req.portalAccount!.crmCustomerId) })
  } catch (err) {
    console.error('[portal-change-orders]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

router.post('/change-orders/:id/sign', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const b = coSignSchema.parse(req.body)
    const co = await prisma.changeOrder.findUnique({ where: { id: String(req.params.id) } })
    const q = co ? await prisma.savedQuote.findFirst({ where: { id: co.quoteId, accountId: co.accountId }, select: { crmContactId: true, archivedAt: true, fenceStyle: true, finalPrice: true } }) : null
    // Someone else's change order is "not found", the same as one that does not exist.
    if (!co || !q || q.archivedAt || !q.crmContactId || q.crmContactId !== req.portalAccount!.crmCustomerId) { res.status(404).json({ success: false, error: 'This change order is not available.' }); return }
    const { row, again } = await signByCustomer(co.accountId, co.id, { name: b.name, signature: b.signature, ip: req.ip ?? null, userAgent: String(req.headers['user-agent'] ?? '') || null, via: 'portal' })
    if (!again) console.log(`[portal] customer signed change order ${row.id} (#${row.number}) in the portal as "${b.name}"`)
    res.json({ success: true, data: customerView(row, q) })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    const status = (err as any)?.status
    if (status === 404 || status === 409) { res.status(status).json({ success: false, error: (err as Error).message }); return }
    console.error('[portal-change-order-sign]', err)
    res.status(500).json({ success: false, error: 'Something went wrong. Please call us.' })
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

router.post('/accounts/:id/force-activate', requireStaffSyncKey, requireStaffCan('users.manage'), async (req, res) => {
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

router.post('/accounts/:id/revoke', requireStaffSyncKey, requireStaffCan('users.manage'), async (req, res) => {
  try {
    const id = String(req.params.id)
    const account = await prisma.portalAccount.findUnique({ where: { id } })
    if (!account) { res.status(404).json({ success: false, error: 'NOT_FOUND' }); return }
    await prisma.portalAccount.update({
      where: { id },
      data: { status: 'suspended', inviteToken: null, inviteTokenExpiresAt: null },
    })
    // Signed in browsers are signed out at once (the session check also refuses a suspended login).
    await revokePortalSessions(id)
    res.json({ success: true })
  } catch (err) {
    console.error('[portal-revoke]', err)
    res.status(500).json({ success: false, error: 'FAILED' })
  }
})

// ── One-time migration: invalidate all non-active invites. ──
// Safe to run multiple times. Does NOT delete customer records.

router.post('/migrate-invalidate-legacy', requireStaffSyncKey, requireStaffCan('system'), async (_req, res) => {
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
    // The screen's own id for this photo: sent twice, it is saved once.
    const rid = requestIdOf(req)
    const again = rid ? await prisma.portalPhoto.findUnique({ where: { id: rid } }) : null
    if (again && again.crmCustomerId === customerId && !again.deletedAt) { res.json({ success: true, data: serializePhoto(again) }); return }
    const { fileKey, fileUrl } = storeUploadFile(file.buffer, file.originalname, customerId)
    const photo = await prisma.portalPhoto.create({
      data: {
        ...(rid && !again ? { id: rid } : {}),
        crmCustomerId: customerId,
        uploadedByAccountId: accountId,
        fileKey, fileUrl,
        originalFilename: file.originalname,
        fileSizeBytes: file.size,
        mimeType: file.mimetype,
        caption: typeof req.body.caption === 'string' ? req.body.caption : null,
        source: 'portal_customer',
      },
    }).catch(async (e: unknown) => {
      // Both copies arrived at the same moment: the first one is kept.
      const won = rid && isUniqueViolation(e) ? await prisma.portalPhoto.findUnique({ where: { id: rid } }) : null
      if (won && won.crmCustomerId === customerId) return won
      throw e
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

// Photos and video the company marked Customer (Stage 6 media), for the portal.
router.get('/media', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const customerId = req.portalAccount!.crmCustomerId
    const quotes = await prisma.savedQuote.findMany({ where: { crmContactId: customerId }, select: { id: true } })
    const items = await prisma.mediaItem.findMany({
      where: { deletedAt: null, visibility: 'customer', OR: [{ customerId }, ...(quotes.length ? [{ quoteKey: { in: quotes.map(q => q.id) } }] : [])] },
      orderBy: { takenAt: 'asc' },
    })
    // Only what a customer should see: no who took it or where they stood.
    res.json({ success: true, data: items.map(m => { const x = serializeMedia(m); return { id: x.id, kind: x.kind, caption: x.caption, category: x.category, takenAt: x.takenAt, url: x.markupUrl ?? x.url, originalUrl: x.url, previewUrl: x.previewUrl, thumbUrl: x.thumbUrl } }) })
  } catch (err) {
    console.error('[portal-media]', err)
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
    // The screen's own id for this photo: sent twice, it is saved once.
    const rid = requestIdOf(req)
    const again = rid ? await prisma.portalPhoto.findUnique({ where: { id: rid } }) : null
    if (again && again.crmCustomerId === customerId && !again.deletedAt) { res.json({ success: true, data: serializePhoto(again) }); return }
    const { fileKey, fileUrl } = storeUploadFile(file.buffer, file.originalname, customerId)
    const photo = await prisma.portalPhoto.create({
      data: {
        ...(rid && !again ? { id: rid } : {}),
        crmCustomerId: customerId,
        uploadedByUser: typeof req.body.uploadedBy === 'string' ? req.body.uploadedBy : null,
        fileKey, fileUrl,
        originalFilename: file.originalname,
        fileSizeBytes: file.size,
        mimeType: file.mimetype,
        caption: typeof req.body.caption === 'string' ? req.body.caption : null,
        source: 'crm_staff',
      },
    }).catch(async (e: unknown) => {
      // Both copies arrived at the same moment: the first one is kept.
      const won = rid && isUniqueViolation(e) ? await prisma.portalPhoto.findUnique({ where: { id: rid } }) : null
      if (won && won.crmCustomerId === customerId) return won
      throw e
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
router.delete('/photos/:id', requireStaffCan('ops.delete'), async (req, res) => {
  try {
    const id = String(req.params.id)
    // The office only (the portal has no delete); a customer's sign in is not a staff one.
    if (!isStaffRequest(req)) { res.status(401).json({ success: false, error: 'AUTH_REQUIRED' }); return }
    await prisma.portalPhoto.update({ where: { id }, data: { deletedAt: new Date() } })
    res.json({ success: true })
  } catch (err) {
    console.error('[portal-photo-delete]', err)
    res.status(500).json({ success: false, error: 'DELETE_FAILED' })
  }
})

/** A file's link: signed when it is one of ours (lib/portalFiles.ts), else the outside address (CompanyCam). */
function fileLink(p: { fileKey: string; fileUrl: string | null }): string {
  if (p.fileUrl && /^https?:\/\//i.test(p.fileUrl)) return p.fileUrl
  return signedFileUrl(p.fileKey)
}

function serializePhoto(p: any) {
  return {
    id: p.id, customerId: p.crmCustomerId,
    fileKey: p.fileKey, fileUrl: fileLink(p),
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
    // The screen's own id for this doc: sent twice, it is saved once.
    const rid = requestIdOf(req)
    const again = rid ? await prisma.portalFile.findUnique({ where: { id: rid } }) : null
    if (again && again.crmCustomerId === customerId && !again.deletedAt) { res.json({ success: true, data: serializeFile(again) }); return }
    const { fileKey, fileUrl } = storeUploadFile(file.buffer, file.originalname, customerId)
    const fileKind = /^image\//i.test(file.mimetype) ? 'photo' : 'document'
    const doc = await prisma.portalFile.create({
      data: {
        ...(rid && !again ? { id: rid } : {}),
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
    }).catch(async (e: unknown) => {
      // Both copies arrived at the same moment: the first one is kept.
      const won = rid && isUniqueViolation(e) ? await prisma.portalFile.findUnique({ where: { id: rid } }) : null
      if (won && won.crmCustomerId === customerId) return won
      throw e
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
    // The screen's own id for this doc: sent twice, it is saved once.
    const rid = requestIdOf(req)
    const again = rid ? await prisma.portalFile.findUnique({ where: { id: rid } }) : null
    if (again && again.crmCustomerId === customerId && !again.deletedAt) { res.json({ success: true, data: serializeFile(again) }); return }
    const { fileKey, fileUrl } = storeUploadFile(file.buffer, file.originalname, customerId)
    const fileKind = /^image\//i.test(file.mimetype) ? 'photo' : 'document'
    const doc = await prisma.portalFile.create({
      data: {
        ...(rid && !again ? { id: rid } : {}),
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
    }).catch(async (e: unknown) => {
      // Both copies arrived at the same moment: the first one is kept.
      const won = rid && isUniqueViolation(e) ? await prisma.portalFile.findUnique({ where: { id: rid } }) : null
      if (won && won.crmCustomerId === customerId) return won
      throw e
    })
    res.json({ success: true, data: serializeFile(doc) })
  } catch (err: any) {
    console.error('[portal-docs-staff-upload]', err)
    res.status(500).json({ success: false, error: 'UPLOAD_FAILED' })
  }
})

router.delete('/documents/:id', requireStaffCan('ops.delete'), async (req, res) => {
  try {
    const id = String(req.params.id)
    if (!isStaffRequest(req)) { res.status(401).json({ success: false, error: 'AUTH_REQUIRED' }); return }
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
    fileKey: f.fileKey, fileUrl: fileLink(f),
    name: f.originalFilename, size: f.fileSizeBytes, mimeType: f.mimeType,
    fileKind: f.fileKind, source: f.source, label: f.label,
    isVisibleToCustomer: f.isVisibleToCustomer,
    uploadedAt: f.createdAt,
    uploadedBy: f.uploadedByUser || (f.source === 'portal_customer' ? 'customer' : 'system'),
  }
}

// File-serve endpoint: a signed link (lib/portalFiles.ts) handed out with a
// list the asker may see; website intake pictures (intake/) need none. A file
// with no link, a wrong or run out signature, or a file that was deleted: 404,
// the same as one that does not exist.
router.get(/^\/files\/(.+)$/, async (req, res) => {
  try {
    const fileKey = String((req.params as any)[0] || '')
    if (!isPublicFileKey(fileKey)) {
      if (!checkFileSig(fileKey, req.query.e, req.query.s)) { res.status(404).end(); return }
      const live = (await prisma.portalPhoto.count({ where: { fileKey, deletedAt: null } })) + (await prisma.portalFile.count({ where: { fileKey, deletedAt: null } }))
      if (!live) { res.status(404).end(); return }
    }
    // Containment check, not string scrubbing: resolve the requested key under
    // the upload folder and refuse anything that lands outside it. (Stripping
    // "../" let "....//" and absolute paths like "//etc/passwd" through, which
    // exposed every file the server process could read.)
    const root = path.resolve(UPLOAD_DIR)
    const fullPath = path.resolve(root, '.' + path.sep + fileKey)
    if (fileKey.includes('\0') || !fullPath.startsWith(root + path.sep)) { res.status(404).end(); return }
    let real: string
    try { real = fs.realpathSync(fullPath) } catch { res.status(404).end(); return }
    const realRoot = fs.realpathSync(root)
    if (!real.startsWith(realRoot + path.sep) || !fs.statSync(real).isFile()) { res.status(404).end(); return }
    // Serve relative to the upload root so dotfiles inside it stay hidden even
    // when the root itself sits under a dot folder.
    res.sendFile(path.relative(realRoot, real), { root: realRoot, dotfiles: 'deny' })
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
    // The screen's own id for this msg: sent twice, it is saved once.
    const rid = requestIdOf(req)
    const again = rid ? await prisma.portalMessage.findUnique({ where: { id: rid } }) : null
    if (again && again.crmCustomerId === customerId) { res.json({ success: true, data: serializeMessage(again) }); return }
    const msg = await prisma.portalMessage.create({
      data: {
        ...(rid && !again ? { id: rid } : {}),
        crmCustomerId: customerId,
        senderAccountId: accountId,
        senderType: 'customer',
        body: body.trim(),
        isReadByCustomer: true,
        readByCustomerAt: new Date(),
      },
    }).catch(async (e: unknown) => {
      // Both copies arrived at the same moment: the first one is kept.
      const won = rid && isUniqueViolation(e) ? await prisma.portalMessage.findUnique({ where: { id: rid } }) : null
      if (won && won.crmCustomerId === customerId) return won
      throw e
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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
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
    // The screen's own id for this msg: sent twice, it is saved once.
    const rid = requestIdOf(req)
    const again = rid ? await prisma.portalMessage.findUnique({ where: { id: rid } }) : null
    if (again && again.crmCustomerId === customerId) { res.json({ success: true, data: serializeMessage(again) }); return }
    const msg = await prisma.portalMessage.create({
      data: {
        ...(rid && !again ? { id: rid } : {}),
        crmCustomerId: customerId,
        senderUser: sender || 'staff',
        senderType: 'staff',
        body: body.trim(),
        isReadByStaff: true,
        readByStaffAt: new Date(),
      },
    }).catch(async (e: unknown) => {
      // Both copies arrived at the same moment: the first one is kept.
      const won = rid && isUniqueViolation(e) ? await prisma.portalMessage.findUnique({ where: { id: rid } }) : null
      if (won && won.crmCustomerId === customerId) return won
      throw e
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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
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
