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
 *   GET  /quotes         — the customer's sent, sold and lost quotes (plain style, price, proposal link; never a cost)
 *   GET  /site-plans/:quoteId.svg — the site plan drawn on that quote's proposal (an image)
 *   GET  /projects       — the customer's jobs (status, install date)
 *   GET  /billing        — the payment schedule of each job: invoices, payments, receipt links, balance
 *   GET  /invoices       — the customer's sent invoices typed in Billing (before payment schedules)
 *   GET  /papers         — the stored signed PDFs (contracts, change orders), the signed contracts and warranty certificates
 *   GET  /contracts/:quoteId.pdf   — a signed contract (lib/contractPdf.ts)
 *   GET  /certificates/:jobId.pdf  — a warranty certificate (lib/walkthroughCertificate.ts)
 *   GET  /change-orders  — the customer's own change orders (sent, approved, void ones they were shown)
 *   POST /change-orders/:id/sign — approve and sign one ({ name, signature }), lib/changeOrders.ts
 *
 * What a portal login may see is an explicit list (lib/portalCustomer.ts, and
 * the serialize* functions below): never a pull sheet, material list, cost,
 * internal note, internal or crew photo, crew packet, follow up or call log.
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

import { workKindOf } from '../lib/installDays.js'
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
import { sendEmail, applyMergeTags, buildEmailHtml, isEmailServiceConfigured } from '../lib/emailService.js'
import { createNotification } from '../lib/notificationService.js'
import { portalPageUrl } from '../lib/urls.js'
import { isStaffRequest } from '../lib/secrets.js'
import { plainZod } from '../lib/plainZod.js'
import { requireStaffCan } from '../lib/permissions.js'
import { verifyStaffBearer } from '../lib/secrets.js'
import { emptySnapshot, logDeletion } from '../lib/deletion.js'
import { portalRequests } from '../lib/serviceTickets.js'
import { takeOneFile, receiveCustomerFile } from './servicePhotosPublic.js'

/** Soft delete a customer's portal photo or file and log it; false when it is not this company's (or already gone). */
async function softDeletePortalItem(model: 'portalPhoto' | 'portalFile', entityType: 'photo' | 'file', id: string, staff: { sub?: string; crmAccountId?: string | null } | null): Promise<boolean> {
  return prisma.$transaction(async (tx: any) => {
    const row = await tx[model].findUnique({ where: { id } })
    if (!row || row.deletedAt) return false
    const contact = await tx.crmContact.findUnique({ where: { id: row.crmCustomerId }, select: { accountId: true, firstName: true, lastName: true } })
    const accountId = contact?.accountId ?? null
    if (!accountId || (staff?.crmAccountId && staff.crmAccountId !== accountId)) return false
    const at = new Date()
    const after = await tx[model].update({ where: { id }, data: { deletedAt: at } })
    const snap = emptySnapshot()
    snap.rows.push({ model, id, row: JSON.parse(JSON.stringify(after)) })
    await logDeletion(tx, { accountId, userId: staff?.sub ?? null }, { entityType, entityId: id, entityLabel: `${entityType === 'photo' ? 'Customer photo' : 'Customer file'} ${row.originalFilename} (${[contact?.firstName, contact?.lastName].filter(Boolean).join(' ')})`, snapshot: snap, at })
    return true
  })
}
import { changeOrdersForContact, signByCustomer, customerView, contractAround } from '../lib/changeOrders.js'
import { quotesOf, jobsOf, quoteRowOf, planOf, isSigned, papersOf, billingOf } from '../lib/portalCustomer.js'
import { contractForQuote, CONTRACT_SELECT } from '../lib/contractPdf.js'
import { plainStyleName } from '../lib/estimates.js'
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
  // Through the public door (/p/portal/, routes/portalPublic.ts), so a customer can open it from anywhere.
  // The base is APP_URL → CLIENT_URL → PORTAL_APP_URL (lib/urls.ts). Links sent before keep working.
  return portalPageUrl(`#/portal/activate?token=${rawToken}`)
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

async function sendInviteEmail(email: string, firstName: string | null, rawToken: string, expiresAt: Date): Promise<{ sent: boolean; notSetUp?: boolean; error?: string }> {
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
  if (!r.success) console.warn(`[portal-invite] email to ${email} not sent: ${r.error}`)
  return { sent: r.success, ...(r.notConfigured ? { notSetUp: true } : {}), ...(r.success ? {} : { error: r.error }) }
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
        // Only true when a mail server took it. Not set up: the screen says not sent and opens the staff's own email.
        emailSent: emailResult.sent,
        ...(emailResult.notSetUp ? { emailNotSetUp: true } : {}),
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
    // No email on this server: say so to everyone, and keep the current link working (no new token).
    if (!isEmailServiceConfigured()) { res.json({ success: true, data: { status: 'not_configured', message: 'Not sent: email is not set up yet. Call or text us for a new link.' } }); return }
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
    const mail = await sendInviteEmail(account.email, account.firstName, rawToken, expiresAt)
    res.json({ success: true, data: mail.sent ? { status: 'sent' } : { status: 'failed', message: 'The email did not go. Call or text us for a new link.' } })
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
      const link = portalPageUrl('#/portal/login')
      const mail = await sendEmail({
        to: updated.email,
        subject: `Your ${companyName()} portal is now active`,
        body: buildEmailHtml(`<p>Hi ${updated.firstName || 'there'},</p>
<p>Your portal account is now active. You can log in any time at <a href="${link}">${link}</a>.</p>
<p>— ${companyName()}</p>`),
      })
      if (!mail.success) console.warn(`[portal-activate] welcome email not sent: ${mail.error}`)
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
  // A deleted customer (Settings > Deleted Records) has no portal until restored.
  return prisma.crmContact.findFirst({
    where: { id: crmCustomerId, deletedAt: null },
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

const QUOTE_STATUSES_SHOWN: readonly string[] = ['SENT', 'SOLD', 'LOST']

router.get('/quotes', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    if (!c?.accountId) { res.json({ success: true, data: [] }); return }
    const rows = (await quotesOf(c)).filter(q => QUOTE_STATUSES_SHOWN.includes(q.status))
    const now = Date.now()
    res.json({ success: true, data: await Promise.all(rows.map(q => quoteRowOf(q, now))) })
  } catch (err) {
    console.error('[portal-quotes]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

// The site plan on one of the customer's own quotes, as the proposal showed it: an image (no script can run in it).
router.get('/site-plans/:quoteId.svg', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    const q = c?.accountId ? (await quotesOf(c)).find(x => x.id === String(req.params.quoteId) && QUOTE_STATUSES_SHOWN.includes(x.status)) : null
    const svg = q ? planOf(q) : ''
    if (!svg) { res.status(404).json({ success: false, error: 'NOT_FOUND' }); return }
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8')
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src data:; style-src 'unsafe-inline'")
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'private, no-store')
    res.send(svg)
  } catch (err) {
    console.error('[portal-site-plan]', err)
    res.status(500).json({ success: false, error: 'FAILED' })
  }
})

router.get('/projects', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    if (!c?.accountId) { res.json({ success: true, data: [] }); return }
    const jobs = await jobsOf(c)
    // The job's status and install date for the customer: never the crew, notes or anything of the office's.
    // The steps before the install, from what is really recorded on the job (never shown done when they are not).
    const permits = await prisma.permit.findMany({ where: { jobId: { in: jobs.map(j => j.id) } }, select: { jobId: true, status: true } })
    const installed = (st: string) => ['in_progress', 'completed', 'invoiced', 'paid'].includes(st)
    // A repair or a fence move says so ("Repair scheduled for ..."), from the job's quote's work.
    const quoteIds = jobs.map(j => j.quoteId).filter((x): x is string => !!x)
    const works = quoteIds.length ? await prisma.savedQuote.findMany({ where: { id: { in: quoteIds }, accountId: c.accountId, deletedAt: null }, select: { id: true, work: true } }) : []
    res.json({ success: true, data: await Promise.all(jobs.map(async j => {
      const permit = permits.find(p => p.jobId === j.id)?.status ?? null
      const steps = {
        locates: installed(j.status) || !!j.locatesDate,
        permit: permit === 'not_needed' ? 'not_needed' : installed(j.status) || ['approved', 'inspection_scheduled', 'passed'].includes(permit ?? '') ? 'done' : 'not_yet',
        materials: installed(j.status) || ['ordered', 'received', 'loaded'].includes(j.materialsStatus),
      }
      const kind = workKindOf(works.find(w => w.id === j.quoteId)?.work)
      return { id: j.id, style: await plainStyleName(j.fenceStyle), kind, status: j.status, scheduledDate: j.scheduledDate, address: j.customerAddress, steps }
    })) })
  } catch (err) {
    console.error('[portal-projects]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

router.get('/billing', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    res.json({ success: true, data: c?.accountId ? await billingOf(c) : [] })
  } catch (err) {
    console.error('[portal-billing]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0)

// Invoices typed in Billing before payment schedules (BusinessState.invoices). One taken into a
// payment schedule (ContractInvoice.legacyId) shows there instead, never twice.
router.get('/invoices', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    if (!c?.accountId) { res.json({ success: true, data: [] }); return }
    const b = await prisma.businessState.findUnique({ where: { accountId: c.accountId }, select: { invoices: true } })
    const all = Array.isArray(b?.invoices) ? (b!.invoices as any[]) : []
    const mine = all.filter(i => i && i.customerId === c.id && i.status !== 'draft' && i.status !== 'void')
    const adopted = mine.length ? new Set((await prisma.contractInvoice.findMany({ where: { accountId: c.accountId, legacyId: { in: mine.map(i => String(i.id)) } }, select: { legacyId: true } })).map(x => x.legacyId)) : new Set()
    res.json({
      success: true,
      data: mine.filter(i => !adopted.has(String(i.id))).map(i => ({
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

// ── The signed contract and the warranty certificate ──

router.get('/papers', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    res.json({ success: true, data: c?.accountId ? await papersOf(c) : { signed: [], contracts: [], certificates: [] } })
  } catch (err) {
    console.error('[portal-papers]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

// ── Warranty and service requests (lib/serviceTickets.ts portalRequests: its own field list) ──

router.get('/service-requests', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    if (!c?.accountId) { res.json({ success: true, data: [] }); return }
    const jobs = await jobsOf(c)
    res.json({ success: true, data: await portalRequests(c, jobs.map(j => j.id)) })
  } catch (err) {
    console.error('[portal-service-requests]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

// The customer adds photos or a short video to their open request: Internal on the request, as from the photo link.
router.post('/service-requests/:id/photos', requirePortalAuth, takeOneFile, async (req: PortalAuthRequest, res) => {
  const file = (req as any).file as Express.Multer.File | undefined
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    const jobs = c?.accountId ? await jobsOf(c) : []
    const t = c?.accountId ? await prisma.serviceTicket.findFirst({ where: { id: String(req.params.id), accountId: c.accountId, deletedAt: null, OR: [{ crmContactId: c.id }, ...(jobs.length ? [{ jobId: { in: jobs.map(j => j.id) } }] : [])] } }) : null
    if (!t) { if (file) fs.rm(file.path, { force: true }, () => {}); res.status(404).json({ success: false, error: 'NOT_FOUND', message: 'That request was not found.' }); return }
    if (t.stage === 'closed' || t.stage === 'fixed') { if (file) fs.rm(file.path, { force: true }, () => {}); res.status(409).json({ success: false, error: 'CLOSED', message: 'This request is finished. Send us a message if something is still wrong.' }); return }
    const out = await receiveCustomerFile(t, file, { via: 'portal', cid: requestIdOf(req) ?? (typeof req.body?.clientId === 'string' ? req.body.clientId : null), caption: typeof req.body?.caption === 'string' ? req.body.caption : '' })
    if (out.error) { res.status(out.status).json({ success: false, error: 'REFUSED', message: out.error }); return }
    res.json({ success: true, data: { received: true } })
  } catch (err) {
    if (file) fs.rm(file.path, { force: true }, () => {})
    console.error('[portal-service-photo]', err)
    res.status(500).json({ success: false, error: 'UPLOAD_FAILED', message: 'The upload failed. Please try again.' })
  }
})

const pdfHeaders = (res: Response, name: string) => {
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${name}"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
}

router.get('/contracts/:quoteId.pdf', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    // Only one of the customer's own signed quotes; anyone else's is "not found".
    const q = c?.accountId ? await prisma.savedQuote.findFirst({ where: { id: String(req.params.quoteId), accountId: c.accountId, crmContactId: c.id, deletedAt: null, archivedAt: null }, select: CONTRACT_SELECT }) : null
    const pdf = q && isSigned(q) ? await contractForQuote(q) : null
    if (!pdf) { res.status(404).json({ success: false, error: 'NOT_FOUND' }); return }
    pdfHeaders(res, 'Signed contract.pdf')
    res.end(pdf)
  } catch (err) {
    console.error('[portal-contract]', err)
    res.status(500).json({ success: false, error: 'FAILED' })
  }
})

router.get('/certificates/:jobId.pdf', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const c = await contactOf(req.portalAccount!.crmCustomerId)
    const job = c?.accountId ? (await jobsOf(c)).find(j => j.id === String(req.params.jobId)) : null
    const w = job ? await prisma.walkthrough.findUnique({ where: { jobId: job.id }, select: { status: true, certificatePath: true } }) : null
    if (!w || w.status !== 'completed' || !w.certificatePath || !fs.existsSync(w.certificatePath)) { res.status(404).json({ success: false, error: 'NOT_FOUND' }); return }
    pdfHeaders(res, 'Warranty certificate.pdf')
    res.end(fs.readFileSync(w.certificatePath))
  } catch (err) {
    console.error('[portal-certificate]', err)
    res.status(500).json({ success: false, error: 'FAILED' })
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
    res.json({ success: true, data: customerView(row, q, await contractAround(row, q.finalPrice)) })
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
    if (again && again.crmCustomerId === customerId && !again.deletedAt) { res.json({ success: true, data: customerPhoto(again) }); return }
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
    res.json({ success: true, data: customerPhoto(photo) })
  } catch (err: any) {
    console.error('[portal-photo-upload]', err)
    if (err?.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ success: false, error: 'FILE_TOO_LARGE', message: 'Photo must be under 20MB.' })
      return
    }
    res.status(500).json({ success: false, error: 'UPLOAD_FAILED', message: 'Photo upload failed. Please try again or contact us if the problem continues.' })
  }
})

// Customer lists the photos they uploaded (of their yard, their survey). The office's own photos
// (uploaded on the customer page, or from CompanyCam) are not shown: what the office shares with
// the customer is a photo it marked Customer (GET /media).
router.get('/photos', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const customerId = req.portalAccount!.crmCustomerId
    const photos = await prisma.portalPhoto.findMany({
      where: { crmCustomerId: customerId, deletedAt: null, isVisibleToCustomer: true, source: 'portal_customer' },
      orderBy: { createdAt: 'desc' },
    })
    res.json({ success: true, data: photos.map(customerPhoto) })
  } catch (err) {
    console.error('[portal-photos-list]', err)
    res.status(500).json({ success: false, error: 'LIST_FAILED' })
  }
})

// Photos and video the company marked Customer (Stage 6 media), for the portal.
router.get('/media', requirePortalAuth, async (req: PortalAuthRequest, res) => {
  try {
    const customerId = req.portalAccount!.crmCustomerId
    const quotes = await prisma.savedQuote.findMany({ where: { crmContactId: customerId, deletedAt: null }, select: { id: true } })
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
    // Only one of the caller's company, soft deleted and kept in Settings > Deleted Records.
    const done = await softDeletePortalItem('portalPhoto', 'photo', id, verifyStaffBearer(req))
    if (!done) { res.status(404).json({ success: false, error: 'NOT_FOUND' }); return }
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

/** A photo as the customer sees it: the picture and its caption, never who at the office uploaded it. */
function customerPhoto(p: any) {
  return { id: p.id, customerId: p.crmCustomerId, fileKey: p.fileKey, fileUrl: fileLink(p), name: p.originalFilename, mimeType: p.mimeType, caption: p.caption ?? null, uploadedAt: p.createdAt }
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
    if (again && again.crmCustomerId === customerId && !again.deletedAt) { res.json({ success: true, data: customerFile(again) }); return }
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
    res.json({ success: true, data: customerFile(doc) })
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
    res.json({ success: true, data: files.map(customerFile) })
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
    // Only one of the caller's company, soft deleted and kept in Settings > Deleted Records.
    const done = await softDeletePortalItem('portalFile', 'file', id, verifyStaffBearer(req))
    if (!done) { res.status(404).json({ success: false, error: 'NOT_FOUND' }); return }
    res.json({ success: true })
  } catch (err) {
    console.error('[portal-doc-delete]', err)
    res.status(500).json({ success: false, error: 'DELETE_FAILED' })
  }
})

/** A document as the customer sees it: the file, its label and whether they sent it; never who at the office did. */
function customerFile(f: any) {
  return {
    id: f.id, customerId: f.crmCustomerId, fileKey: f.fileKey, fileUrl: fileLink(f), name: f.originalFilename, size: f.fileSizeBytes, mimeType: f.mimeType,
    label: f.label ?? null, uploadedAt: f.createdAt, fromYou: f.source === 'portal_customer',
  }
}

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
    if (again && again.crmCustomerId === customerId) { res.json({ success: true, data: customerMessage(again) }); return }
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
    res.json({ success: true, data: customerMessage(msg) })
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
    res.json({ success: true, data: { messages: messages.map(customerMessage), unreadByCustomer } })
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
        const mail = await sendEmail({
          to: account.email,
          subject: `New message from ${companyName()}`,
          body: buildEmailHtml(`<p>Hi ${account.firstName || 'there'},</p>
<p>You have a new message from ${companyName()}. Log in to your portal to view it.</p>
<p><a href="${portalPageUrl('#/portal/messages')}">Open Messages</a></p>
<p>— ${companyName()}</p>`),
        })
        if (!mail.success) console.warn(`[portal-messages] new message email not sent: ${mail.error}`)
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

/** A message as the customer sees it: who wrote it (them or the company), the words and when; never the staff member's login. */
function customerMessage(m: any) {
  return { id: m.id, customerId: m.crmCustomerId, senderType: m.senderType, body: m.body, createdAt: m.createdAt }
}

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
