/**
 * CRM Authentication Routes
 *
 * Invite flow, login, password reset, session management.
 * Separate from portal auth — this is for internal CRM users.
 */

import { Router } from 'express'
import { z } from 'zod'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import prisma from '../lib/prisma.js'
import { deleteLogin } from '../lib/loginDelete.js'
import { withLock } from '../lib/once.js'
import { sendEmail, applyMergeTags, buildEmailHtml, isEmailServiceConfigured, EMAIL_NOT_SET_UP, type EmailResult } from '../lib/emailService.js'
import { buildFrontendUrl } from '../lib/urls.js'
import { audit } from '../lib/auditLog.js'
import { resolveSecret } from '../lib/secrets.js'
import { plainZod } from '../lib/plainZod.js'
import { can, refuse } from '../lib/permissions.js'
import { inviteStepsHtml } from '../lib/inviteSteps.js'
import { startStaffSession, endStaffSessionOf, cookieOnly, sessionEndsAt, staffCookieOf, cookieHash, STAFF_WRITE_HEADER } from '../lib/staffSession.js'
import { sessionRefusal } from '../lib/sessionGuard.js'
import { verifyStaffBearer } from '../lib/secrets.js'

const router = Router()

/** What an invite answer says about its email: sent, or not sent and why. */
function emailOutcome(r: EmailResult): { emailSent: boolean; emailNotSetUp?: true; emailError?: string } {
  if (r.success) return { emailSent: true }
  return r.notConfigured ? { emailSent: false, emailNotSetUp: true, emailError: EMAIL_NOT_SET_UP } : { emailSent: false, emailError: r.error || 'The email did not go.' }
}

const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
const JWT_REFRESH_SECRET = resolveSecret('JWT_REFRESH_SECRET', 'dev-crm-refresh-secret-change-me')
const BCRYPT_ROUNDS = 12
const ACCESS_EXPIRY = '15m'
const REFRESH_EXPIRY_DAYS = 7
const INVITE_EXPIRY_HOURS = 72
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

// ── Helpers ──

/** `sid` is the CrmUserSession row this sign in lives in (lib/sessionGuard.ts): only the steps below make one. */
function generateAccessToken(user: { id: string; email: string; role: string; firstName: string; lastName: string; crmAccountId: string | null }, sid: string): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName, crmAccountId: user.crmAccountId, sid },
    JWT_SECRET,
    { expiresIn: ACCESS_EXPIRY }
  )
}

function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex')
}

function verifyAccess(token: string): any {
  return jwt.verify(token, JWT_SECRET)
}

/**
 * Sign in by cookie (lib/staffSession.ts): the app asks for it with
 * `{ cookie: true }` and the app header. An app from before the switch (an
 * old copy still open on a phone) gets the old tokens until stage D
 * (STAFF_COOKIE_ONLY=1), when every sign in is a cookie.
 */
function wantsCookie(req: any): boolean {
  return cookieOnly() || req.body?.cookie === true
}

/** A sign in by cookie must come from the app (the same header every cookie save carries). */
function appHeaderMissing(req: any, res: any): boolean {
  if (req.headers[STAFF_WRITE_HEADER] === '1') return false
  res.status(403).json({ success: false, code: 'APP_HEADER_REQUIRED', error: 'This sign in did not come from the EZ Biz app.' })
  return true
}

function publicUser(user: { id: string; email: string; firstName: string; lastName: string; role: any; status: any; mustChangePassword: boolean; avatarUrl: string | null }) {
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, status: user.status, mustChangePassword: user.mustChangePassword, avatarUrl: user.avatarUrl }
}

/** A cookie this browser already had (perhaps another login's) is replaced by the new one: its session ends. */
async function endPreviousCookie(req: any): Promise<void> {
  const previous = staffCookieOf(req)
  if (previous && previous.length <= 200) await prisma.crmUserSession.updateMany({ where: { tokenHash: cookieHash(previous), revokedAt: null }, data: { revokedAt: new Date() } })
}

function payloadFirstName(payload: any): string {
  return payload?.firstName || payload?.email || 'A teammate'
}

// ── Login ──

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

/**
 * Every CRM route is scoped by the user's company (crmAccountId). An owner or
 * admin created by the seed script or straight in the database has no company
 * link, which locks them out of every module with "not linked to a company".
 *
 * On a single company install that link is unambiguous, so set it here:
 *   - no company exists yet  → create one (COMPANY_NAME) and link it
 *   - exactly one exists     → link it
 *   - more than one exists   → leave it; an admin has to choose
 * Only super_admin and admin are linked this way. Everyone else gets their
 * company from the invite that created them.
 */
async function ensureStaffAccount<T extends { id: string; role: string; crmAccountId: string | null }>(user: T): Promise<T> {
  if (user.crmAccountId) return user
  if (user.role !== 'super_admin' && user.role !== 'admin') return user
  try {
    // Under one lock: two first logins at the same moment make one company.
    const accountId = await withLock('crm:first-company', async tx => {
      const accounts = await tx.crmAccount.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' }, take: 2 })
      if (accounts.length === 0) {
        const created = await tx.crmAccount.create({ data: { name: process.env.COMPANY_NAME || 'My Company', status: 'active' } })
        return created.id as string
      }
      return accounts.length === 1 ? accounts[0].id as string : null
    })
    if (!accountId) return user
    await prisma.crmUser.update({ where: { id: user.id }, data: { crmAccountId: accountId } })
    console.log(`[CRM Auth] Linked ${user.role} ${user.id} to company ${accountId}`)
    return { ...user, crmAccountId: accountId }
  } catch (err) {
    console.error('[CRM Auth] Could not link user to a company:', err)
    return user
  }
}

router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body)
    const byCookie = wantsCookie(req)
    if (byCookie && appHeaderMissing(req, res)) return

    let user = await prisma.crmUser.findUnique({ where: { email: email.toLowerCase() } })
    if (!user || !user.passwordHash) {
      res.status(401).json({ success: false, error: 'Invalid email or password' })
      return
    }

    // Check lockout
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
      res.status(423).json({ success: false, error: `Account locked. Try again in ${mins} minutes.` })
      return
    }

    // Check status
    if (user.status === 'deactivated') {
      res.status(403).json({ success: false, error: 'Account has been deactivated. Contact your administrator.' })
      return
    }
    if (user.status === 'invited') {
      res.status(403).json({ success: false, error: 'Please accept your invite first. Check your email.' })
      return
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) {
      const attempts = user.failedLoginAttempts + 1
      const lockout = attempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000) : null
      await prisma.crmUser.update({
        where: { id: user.id },
        data: { failedLoginAttempts: attempts, lockedUntil: lockout },
      })
      res.status(401).json({ success: false, error: attempts >= MAX_FAILED_ATTEMPTS ? `Too many attempts. Account locked for ${LOCKOUT_MINUTES} minutes.` : 'Invalid email or password' })
      return
    }

    // Success — reset failures, update last login
    await prisma.crmUser.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() },
    })

    // Make sure an owner/admin has a company before the token is issued
    user = await ensureStaffAccount(user)

    if (byCookie) {
      await endPreviousCookie(req)
      await startStaffSession(req, res, user.id)
      await prisma.crmUserActivity.create({ data: { userId: user.id, action: 'login', ipAddress: req.ip || null } }).catch(() => {})
      res.json({ success: true, data: { user: publicUser(user) } })
      return
    }

    // Store the session, then the access token that names it
    const refreshToken = generateRefreshToken()
    const refreshHash = await bcrypt.hash(refreshToken, 10)
    const session = await prisma.crmUserSession.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        ipAddress: req.ip || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
        expiresAt: new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    })
    const accessToken = generateAccessToken(user, session.id)

    // Log activity
    await prisma.crmUserActivity.create({
      data: { userId: user.id, action: 'login', ipAddress: req.ip || null },
    }).catch(() => {})

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          status: user.status,
          mustChangePassword: user.mustChangePassword,
          avatarUrl: user.avatarUrl,
        },
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[CRM Auth] Login error:', err)
    res.status(500).json({ success: false, error: 'Login failed' })
  }
})

// ── Refresh Token ──

router.post('/refresh', async (req, res) => {
  if (cookieOnly()) { res.status(401).json({ success: false, code: 'BEARER_RETIRED', error: 'Please sign in again' }); return }
  try {
    const { refreshToken } = req.body
    if (!refreshToken) { res.status(401).json({ success: false, error: 'Refresh token required' }); return }

    // Find all active sessions and check each
    const sessions = await prisma.crmUserSession.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: true },
    })

    let matchedSession = null
    for (const session of sessions) {
      if (await bcrypt.compare(refreshToken, session.tokenHash)) {
        matchedSession = session
        break
      }
    }

    if (!matchedSession) {
      res.status(401).json({ success: false, error: 'Invalid refresh token' })
      return
    }

    // Revoke old session
    await prisma.crmUserSession.update({
      where: { id: matchedSession.id },
      data: { revokedAt: new Date() },
    })

    // Issue new tokens
    // A token made before session ids (no `sid`) becomes one with a `sid` here (lib/sessionGuard.ts).
    const user = await ensureStaffAccount(matchedSession.user)
    const newRefreshToken = generateRefreshToken()
    const newRefreshHash = await bcrypt.hash(newRefreshToken, 10)

    const session = await prisma.crmUserSession.create({
      data: {
        userId: user.id,
        tokenHash: newRefreshHash,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        expiresAt: new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    })
    const accessToken = generateAccessToken(user, session.id)

    res.json({
      success: true,
      data: { accessToken, refreshToken: newRefreshToken },
    })
  } catch {
    res.status(500).json({ success: false, error: 'Refresh failed' })
  }
})

// ── Me (current user) ──

router.get('/me', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }

  try {
    const payload = verifyAccess(auth.slice(7))
    const user = await prisma.crmUser.findUnique({ where: { id: payload.sub } })
    if (!user || user.status === 'deactivated') {
      res.status(401).json({ success: false, error: 'Account not found' })
      return
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: user.status,
        mustChangePassword: user.mustChangePassword,
        avatarUrl: user.avatarUrl,
        lastLoginAt: user.lastLoginAt,
        signedInBy: req.staffCookie ? 'cookie' : 'token',
        readOnly: !!req.staffCookie?.readOnly,
      },
    })
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
})

// ── Logout ──

router.post('/logout', async (req, res) => {
  // Signed in by cookie: this session ends now and the cookie is cleared.
  await endStaffSessionOf(req, res).catch(() => false)
  const { refreshToken } = req.body ?? {}
  if (typeof refreshToken === 'string' && refreshToken) {
    const sessions = await prisma.crmUserSession.findMany({ where: { revokedAt: null } })
    for (const session of sessions) {
      if (await bcrypt.compare(refreshToken, session.tokenHash)) {
        await prisma.crmUserSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } })
        break
      }
    }
  }
  res.json({ success: true })
})

// ── Move over: the old stored sign in becomes a cookie, once ──
//
// A phone signed in before the switch has the old tokens in its storage. On
// its first load after the deploy the app sends them here once (one tab),
// gets the cookie, and deletes them. The refresh token (7 days) is tried
// first; it is used up, as a renewal would. Otherwise a still valid access
// token whose session is live. Neither: 401, and that person types their
// password once. Stage D (STAFF_COOKIE_ONLY=1): 410, nothing is swapped.
router.post('/move-over', async (req, res) => {
  if (cookieOnly()) { res.status(410).json({ success: false, code: 'MOVE_OVER_ENDED', error: 'Please sign in again' }); return }
  if (appHeaderMissing(req, res)) return
  try {
    let userId: string | null = null
    const refreshToken = req.body?.refreshToken
    if (typeof refreshToken === 'string' && /^[0-9a-f]{80}$/.test(refreshToken)) {
      const sessions = await prisma.crmUserSession.findMany({ where: { kind: null, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, userId: true, tokenHash: true } })
      for (const s of sessions) {
        if (await bcrypt.compare(refreshToken, s.tokenHash)) {
          await prisma.crmUserSession.update({ where: { id: s.id }, data: { revokedAt: new Date() } })
          userId = s.userId
          break
        }
      }
    }
    if (!userId) {
      const bearer = verifyStaffBearer(req) as any
      if (bearer && !(await sessionRefusal(bearer))) userId = bearer.sub
    }
    const user = userId ? await prisma.crmUser.findUnique({ where: { id: userId } }) : null
    if (!user || user.status !== 'active') {
      res.status(401).json({ success: false, code: 'SIGN_IN_AGAIN', error: 'Please sign in again' }); return
    }
    await endPreviousCookie(req)
    await startStaffSession(req, res, user.id)
    await prisma.crmUserActivity.create({ data: { userId: user.id, action: 'login', metadata: { how: 'move_over' }, ipAddress: req.ip || null } }).catch(() => {})
    res.json({ success: true, data: { user: publicUser(user) } })
  } catch (err) {
    console.error('[CRM Auth] move over error:', err)
    res.status(500).json({ success: false, error: 'Could not move the sign in over. Try again.' })
  }
})

// ── Invite User ──

const inviteSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  role: z.enum(['admin', 'manager', 'sales_rep', 'field_crew', 'office_staff', 'customer']),
  phone: z.string().optional(),
})

router.post('/invite', async (req, res) => {
  // Require admin auth
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }

  try {
    const payload = verifyAccess(auth.slice(7))
    if (!can(payload.role, 'users.manage')) { refuse(res, 'users.manage'); return }

    const data = inviteSchema.parse(req.body)
    const email = data.email.toLowerCase()

    // Check if user exists
    const existing = await prisma.crmUser.findUnique({ where: { email } })
    if (existing) {
      res.status(409).json({ success: false, error: 'A user with this email already exists' })
      return
    }

    // Resolve inviter's crmAccountId — the new teammate inherits the inviter's
    // tenant so they share the same customer / job / quote visibility.
    const inviter = await prisma.crmUser.findUnique({
      where: { id: payload.sub },
      select: { crmAccountId: true },
    })
    if (!inviter?.crmAccountId) {
      res.status(409).json({ success: false, error: 'Your account is not linked to a company; cannot invite teammates until that is resolved.' })
      return
    }

    // Generate invite token
    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = await bcrypt.hash(rawToken, 10)

    const user = await prisma.crmUser.create({
      data: {
        email,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        role: data.role as any,
        status: 'invited',
        invitedById: payload.sub,
        crmAccountId: inviter.crmAccountId,
        inviteTokenHash: tokenHash,
        inviteTokenExpiresAt: new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000),
      },
    })

    // Send invite email — click tracking disabled by default in sendEmail() so
    // the recipient sees the original https://yourdomain.com URL instead of
    // SendGrid's `urlNNNN.www.yourdomain.com` rewrite (which can SSL-fail).
    const inviteUrl = buildFrontendUrl(`/accept-invite?token=${rawToken}&email=${encodeURIComponent(email)}`)
    const companyName = process.env.COMPANY_NAME || 'Getter Done Fence'
    const inviterName = `${payloadFirstName(payload)}`.trim() || 'A teammate'
    const roleLabel = data.role.replace(/_/g, ' ')
    const mail = await sendEmail({
      to: email,
      subject: `You've been invited to join ${companyName} on EZ Biz`,
      body: buildEmailHtml(`
        <p>Hi ${data.firstName},</p>
        <p>${inviterName} has invited you to join <strong>${companyName}</strong> on EZ Biz as <strong>${roleLabel}</strong>.</p>
        ${inviteStepsHtml(inviteUrl, 'Accept Invitation & Set Password')}
        <p style="color:#94a3b8;font-size:13px;">This invitation expires in ${INVITE_EXPIRY_HOURS} hours.</p>
      `),
      disableClickTracking: true,
    })

    await prisma.crmUserActivity.create({
      data: { userId: payload.sub, action: 'invite_sent', entityType: 'user', entityId: user.id, metadata: JSON.parse(JSON.stringify({ invitedEmail: email, role: data.role })) },
    }).catch(() => {})

    await audit(req, 'invite_sent', 'CrmUser', user.id, { newValues: { email, role: data.role, firstName: data.firstName, lastName: data.lastName } })
    // The link goes back to the owner or admin too, to text it when the email is slow or lands in spam.
    // emailSent is only true when a mail server took it; otherwise the screen says not sent (and why).
    res.status(201).json({ success: true, data: { id: user.id, email, status: 'invited', role: data.role, inviteUrl, expiresInHours: INVITE_EXPIRY_HOURS, ...emailOutcome(mail) } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[CRM Auth] Invite error:', err)
    res.status(500).json({ success: false, error: 'Failed to send invite' })
  }
})

// ── Resend Invite (admin) ──
//
// Used after the click-tracking outage to re-send activation emails to anyone
// whose previous invite contained a broken SendGrid-rewritten URL. Generates a
// fresh raw token, rotates the hash, refreshes the expiry, and sends the email
// through the new (click-tracking-disabled) sendEmail() path.
router.post('/invite/:userId/resend', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = verifyAccess(auth.slice(7))
    if (!can(payload.role, 'users.manage')) { refuse(res, 'users.manage'); return }

    const user = await prisma.crmUser.findUnique({ where: { id: req.params.userId } })
    if (!user) { res.status(404).json({ success: false, error: 'User not found' }); return }
    if (user.status !== 'invited') {
      res.status(400).json({ success: false, error: `Cannot resend invite — user status is "${user.status}".` })
      return
    }

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = await bcrypt.hash(rawToken, 10)
    await prisma.crmUser.update({
      where: { id: user.id },
      data: {
        inviteTokenHash: tokenHash,
        inviteTokenExpiresAt: new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000),
      },
    })

    const inviteUrl = buildFrontendUrl(`/accept-invite?token=${rawToken}&email=${encodeURIComponent(user.email)}`)
    const companyName = process.env.COMPANY_NAME || 'Getter Done Fence'
    const inviterName = `${payloadFirstName(payload)}`.trim()
    const roleLabel = (user.role || '').replace(/_/g, ' ')
    const mail = await sendEmail({
      to: user.email,
      subject: `Reissued: your invitation to ${companyName} on EZ Biz`,
      body: buildEmailHtml(`
        <p>Hi ${user.firstName},</p>
        <p>${inviterName} has resent your invitation to join <strong>${companyName}</strong> on EZ Biz as <strong>${roleLabel}</strong>.</p>
        ${inviteStepsHtml(inviteUrl, 'Accept Invitation & Set Password')}
        <p style="color:#94a3b8;font-size:13px;">This invitation expires in ${INVITE_EXPIRY_HOURS} hours.</p>
      `),
      disableClickTracking: true,
    })
    console.log(`[CRM Auth] Invite reissued for ${user.email}: ${mail.success ? 'emailed' : `not emailed (${mail.error})`}`)

    res.json({ success: true, data: { id: user.id, email: user.email, inviteUrl, expiresInHours: INVITE_EXPIRY_HOURS, ...emailOutcome(mail) } })
  } catch (err) {
    console.error('[CRM Auth] resend error:', err)
    res.status(500).json({ success: false, error: 'Failed to resend invite' })
  }
})

// ── Resend ALL pending invites (admin batch) ──
//
// Useful right after the click-tracking fix lands: rotates and resends every
// outstanding (status='invited') invite so any users whose previous link landed
// at url4845.www.systemssyndicate.com get a working one.
router.post('/invites/resend-all-pending', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = verifyAccess(auth.slice(7))
    if (!can(payload.role, 'users.manage')) { refuse(res, 'users.manage'); return }
    // Without email nothing would reach anyone, and new tokens would break links already texted.
    if (!isEmailServiceConfigured()) { res.status(409).json({ success: false, error: `Not sent: ${EMAIL_NOT_SET_UP}. Use Resend on each person to get a link to text.` }); return }
    const pending = await prisma.crmUser.findMany({ where: { status: 'invited' } })
    let sent = 0, failed = 0
    for (const user of pending) {
      try {
        const rawToken = crypto.randomBytes(32).toString('hex')
        const tokenHash = await bcrypt.hash(rawToken, 10)
        await prisma.crmUser.update({
          where: { id: user.id },
          data: {
            inviteTokenHash: tokenHash,
            inviteTokenExpiresAt: new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000),
          },
        })
        const inviteUrl = buildFrontendUrl(`/accept-invite?token=${rawToken}&email=${encodeURIComponent(user.email)}`)
        const companyName = process.env.COMPANY_NAME || 'Getter Done Fence'
        const mail = await sendEmail({
          to: user.email,
          subject: `Reissued: your invitation to ${companyName} on EZ Biz`,
          body: buildEmailHtml(`
            <p>Hi ${user.firstName},</p>
            <p>We've reissued your invitation to <strong>${companyName}</strong> on EZ Biz. The previous link may not have worked due to a temporary delivery issue.</p>
            ${inviteStepsHtml(inviteUrl, 'Accept Invitation & Set Password')}
            <p style="color:#94a3b8;font-size:13px;">This invitation expires in ${INVITE_EXPIRY_HOURS} hours.</p>
          `),
          disableClickTracking: true,
        })
        if (!mail.success) throw new Error(mail.error || 'not sent')
        console.log(`[CRM Auth] ✉️  Reissued invite to ${user.email}`)
        sent++
      } catch (err) {
        console.error(`[CRM Auth] Failed to reissue invite for ${user.email}:`, err)
        failed++
      }
    }
    res.json({ success: true, data: { totalPending: pending.length, sent, failed } })
  } catch (err) {
    console.error('[CRM Auth] batch resend error:', err)
    res.status(500).json({ success: false, error: 'Failed to resend pending invites' })
  }
})

// ── Accept Invite ──

const acceptSchema = z.object({
  token: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

router.post('/accept-invite', async (req, res) => {
  try {
    const { token, email, password } = acceptSchema.parse(req.body)
    const byCookie = wantsCookie(req)
    if (byCookie && appHeaderMissing(req, res)) return

    // Find the user by email with invited status
    const user = await prisma.crmUser.findUnique({ where: { email: email.toLowerCase() } })
    if (!user || user.status !== 'invited' || !user.inviteTokenHash) {
      res.status(400).json({ success: false, error: 'Invalid or expired invite' })
      return
    }

    // Check expiry
    if (user.inviteTokenExpiresAt && user.inviteTokenExpiresAt < new Date()) {
      res.status(400).json({ success: false, error: 'Invite has expired. Ask your admin to resend.' })
      return
    }

    // Verify token
    const valid = await bcrypt.compare(token, user.inviteTokenHash)
    if (!valid) {
      res.status(400).json({ success: false, error: 'Invalid invite token' })
      return
    }

    // Set password and activate
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)
    await prisma.crmUser.update({
      where: { id: user.id },
      data: {
        passwordHash,
        status: 'active',
        mustChangePassword: false,
        inviteTokenHash: null,
        inviteTokenExpiresAt: null,
        lastLoginAt: new Date(),
      },
    })

    // Auto-login
    if (byCookie) {
      await endPreviousCookie(req)
      await startStaffSession(req, res, user.id)
      res.json({ success: true, data: { user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role } } })
      return
    }
    const refreshToken = generateRefreshToken()
    const refreshHash = await bcrypt.hash(refreshToken, 10)

    const session = await prisma.crmUserSession.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        expiresAt: new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    })
    const accessToken = generateAccessToken(user, session.id)

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    res.status(500).json({ success: false, error: 'Failed to accept invite' })
  }
})

// ── Forgot Password ──

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body)
    // No email on this server: say so to everyone (it does not tell whether the account exists).
    if (!isEmailServiceConfigured()) {
      res.status(503).json({ success: false, notConfigured: true, error: 'Not sent: email is not set up on this server yet. Ask the owner to reset your password from Team.' })
      return
    }
    const user = await prisma.crmUser.findUnique({ where: { email: email.toLowerCase() } })

    // Always return success to prevent email enumeration
    if (!user || user.status !== 'active') {
      res.json({ success: true, data: { message: 'If an account exists, a reset link has been sent.' } })
      return
    }

    const rawToken = crypto.randomBytes(32).toString('hex')
    const tokenHash = await bcrypt.hash(rawToken, 10)

    await prisma.crmUser.update({
      where: { id: user.id },
      data: {
        inviteTokenHash: tokenHash,
        inviteTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      },
    })

    const resetUrl = buildFrontendUrl(`/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`)
    const mail = await sendEmail({
      to: email,
      subject: 'Password Reset',
      body: buildEmailHtml(`
        <p>Hi ${user.firstName},</p>
        <p>Click below to reset your password:</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a></p>
        <p style="color:#64748b;font-size:13px;">If the button doesn't work, copy this link into your browser:<br><span style="color:#475569;word-break:break-all;">${resetUrl}</span></p>
        <p style="color:#94a3b8;font-size:13px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      `),
      disableClickTracking: true,
    })
    // The answer stays the same (no telling whether the account exists); the failure is in the log.
    if (!mail.success) console.warn(`[CRM Auth] Password reset email for ${email} not sent: ${mail.error}`)

    res.json({ success: true, data: { message: 'If an account exists, a reset link has been sent.' } })
  } catch {
    res.json({ success: true, data: { message: 'If an account exists, a reset link has been sent.' } })
  }
})

// ── Reset Password ──

router.post('/reset-password', async (req, res) => {
  try {
    const { token, email, password } = z.object({
      token: z.string(), email: z.string().email(), password: z.string().min(8),
    }).parse(req.body)

    const user = await prisma.crmUser.findUnique({ where: { email: email.toLowerCase() } })
    if (!user || !user.inviteTokenHash) {
      res.status(400).json({ success: false, error: 'Invalid or expired reset link' })
      return
    }
    if (user.inviteTokenExpiresAt && user.inviteTokenExpiresAt < new Date()) {
      res.status(400).json({ success: false, error: 'Reset link has expired' })
      return
    }
    const valid = await bcrypt.compare(token, user.inviteTokenHash)
    if (!valid) {
      res.status(400).json({ success: false, error: 'Invalid reset token' })
      return
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS)

    // Update password, clear token, revoke all sessions
    await prisma.crmUser.update({
      where: { id: user.id },
      data: { passwordHash, inviteTokenHash: null, inviteTokenExpiresAt: null, mustChangePassword: false },
    })
    await prisma.crmUserSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })

    res.json({ success: true, data: { message: 'Password reset. Please log in.' } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    res.status(500).json({ success: false, error: 'Reset failed' })
  }
})

// ── Change Password (logged in) ──
//
// The only other way to change a password is the emailed reset link, which
// needs working outbound email. This lets a logged in user change it directly,
// and is what clears mustChangePassword for the seeded owner login.
router.post('/change-password', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }

  let payload: any
  try { payload = verifyAccess(auth.slice(7)) } catch {
    res.status(401).json({ success: false, error: 'Invalid token' }); return
  }

  try {
    const { currentPassword, newPassword } = z.object({
      currentPassword: z.string().min(1, 'Current password is required'),
      newPassword: z.string().min(8, 'New password must be at least 8 characters').max(200),
    }).parse(req.body)

    const user = await prisma.crmUser.findUnique({ where: { id: payload.sub } })
    if (!user || !user.passwordHash || user.status === 'deactivated') {
      res.status(401).json({ success: false, error: 'Account not found' })
      return
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash)
    if (!valid) {
      res.status(400).json({ success: false, error: 'Current password is incorrect' })
      return
    }
    if (newPassword === currentPassword) {
      res.status(400).json({ success: false, error: 'New password must be different from the current one' })
      return
    }

    const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS)
    await prisma.crmUser.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null },
    })

    // Signed in by cookie: every other device is signed out at once; this one keeps its cookie.
    if (req.staffCookie) {
      await prisma.crmUserSession.updateMany({
        where: { userId: user.id, revokedAt: null, id: { not: req.staffCookie.sessionId } },
        data: { revokedAt: new Date() },
      })
      await prisma.crmUserActivity.create({ data: { userId: user.id, action: 'password_changed', ipAddress: req.ip || null } }).catch(() => {})
      res.json({ success: true, data: {} })
      return
    }

    // Sign every other device out, then hand this one a fresh session.
    await prisma.crmUserSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    const refreshToken = generateRefreshToken()
    const session = await prisma.crmUserSession.create({
      data: {
        userId: user.id,
        tokenHash: await bcrypt.hash(refreshToken, 10),
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        expiresAt: new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    })
    const accessToken = generateAccessToken(user, session.id)
    await prisma.crmUserActivity.create({
      data: { userId: user.id, action: 'password_changed', ipAddress: req.ip || null },
    }).catch(() => {})

    res.json({ success: true, data: { accessToken, refreshToken } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    console.error('[CRM Auth] Change password error:', err)
    res.status(500).json({ success: false, error: 'Could not change password' })
  }
})

// ── User Management (admin only) ──

router.get('/users', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = verifyAccess(auth.slice(7))
    if (!can(payload.role, 'users.manage')) { refuse(res, 'users.manage'); return }

    const users = await prisma.crmUser.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true,
        role: true, status: true, avatarUrl: true, lastLoginAt: true, createdAt: true,
      },
    })
    res.json({ success: true, data: users })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load users' })
  }
})

// Update user
router.patch('/users/:id', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = verifyAccess(auth.slice(7))
    if (!can(payload.role, 'users.manage')) { refuse(res, 'users.manage'); return }

    const data = z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      phone: z.string().optional(),
      role: z.enum(['super_admin', 'admin', 'manager', 'sales_rep', 'field_crew', 'office_staff', 'customer']).optional(),
      status: z.enum(['active', 'suspended', 'deactivated']).optional(),
    }).parse(req.body)

    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    // Only the owner makes an owner, or changes one.
    if (payload.role !== 'super_admin') {
      const target = await prisma.crmUser.findUnique({ where: { id: userId }, select: { role: true } })
      if (data.role === 'super_admin' || target?.role === 'super_admin') { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Only the owner can change an owner login.' }); return }
    }
    if (userId === payload.sub && ((data.role && data.role !== payload.role) || (data.status && data.status !== 'active'))) {
      res.status(400).json({ success: false, error: 'You cannot change your own role or switch off your own login.' }); return
    }
    const user = await prisma.crmUser.update({
      where: { id: userId },
      data: data as any,
    })
    // A new role or a switched off login takes effect now: that person signs in again (a sign in lasts at most 15 minutes without a refresh).
    if (data.role || (data.status && data.status !== 'active')) {
      await prisma.crmUserSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }).catch(() => {})
    }
    await audit(req, 'update', 'CrmUser', user.id, { newValues: data }).catch(() => {})

    res.json({ success: true, data: { id: user.id, role: user.role, status: user.status } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: plainZod(err) }); return }
    res.status(500).json({ success: false, error: 'Failed to update user' })
  }
})

// Active sessions
router.get('/sessions', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = verifyAccess(auth.slice(7))
    if (!can(payload.role, 'users.manage')) { refuse(res, 'users.manage'); return }

    // Never the token's or the cookie's hash.
    const rows = await prisma.crmUserSession.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, userId: true, ipAddress: true, userAgent: true, createdAt: true, expiresAt: true, revokedAt: true, kind: true, lastUsedAt: true, readOnly: true, label: true, user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    // A cookie sign in ends 30 days after its last use (lib/staffSession.ts): one past that is not shown.
    const now = Date.now()
    const sessions = rows
      .map((s: any) => ({ ...s, endsAt: sessionEndsAt(s), current: s.id === req.staffCookie?.sessionId }))
      .filter((s: any) => s.endsAt.getTime() > now)
      .slice(0, 100)

    res.json({ success: true, data: sessions })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load sessions' })
  }
})

// Revoke session
router.delete('/sessions/:id', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = verifyAccess(auth.slice(7))
    if (!can(payload.role, 'users.manage')) { refuse(res, 'users.manage'); return }

    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    await prisma.crmUserSession.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    })
    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to revoke session' })
  }
})

// Delete user
router.delete('/users/:id', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = verifyAccess(auth.slice(7))
    if (!can(payload.role, 'users.manage')) { refuse(res, 'users.manage'); return }

    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id

    // Prevent deleting yourself
    if (userId === payload.sub) {
      res.status(400).json({ success: false, error: 'Cannot delete your own account' })
      return
    }

    // Prevent deleting super_admin unless you are super_admin
    const target = await prisma.crmUser.findUnique({ where: { id: userId } })
    // Only a login of the caller's own company: another company's login is "not found".
    const callerAccountId = payload.crmAccountId ?? (await prisma.crmUser.findUnique({ where: { id: payload.sub }, select: { crmAccountId: true } }))?.crmAccountId ?? null
    if (!target || !callerAccountId || target.crmAccountId !== callerAccountId) { res.status(404).json({ success: false, error: 'User not found' }); return }
    if (target.role === 'super_admin' && payload.role !== 'super_admin') {
      res.status(403).json({ success: false, error: 'Cannot delete a super admin' })
      return
    }

    // Sessions, activity and the pending call go with the login, in one transaction (lib/loginDelete.ts).
    await deleteLogin(userId, payload.sub)

    // Log the deletion
    await prisma.crmUserActivity.create({
      data: { userId: payload.sub, action: 'user_deleted', entityType: 'user', entityId: userId, metadata: JSON.parse(JSON.stringify({ deletedEmail: target.email, deletedName: `${target.firstName} ${target.lastName}` })) },
    }).catch(() => {})

    res.json({ success: true })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to delete user' })
  }
})

// Activity log
router.get('/activity', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = verifyAccess(auth.slice(7))
    if (!can(payload.role, 'users.manage')) { refuse(res, 'users.manage'); return }

    const logs = await prisma.crmUserActivity.findMany({
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    res.json({ success: true, data: logs })
  } catch {
    res.status(500).json({ success: false, error: 'Failed to load activity' })
  }
})

export default router
