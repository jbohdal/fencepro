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
import { sendEmail, applyMergeTags, buildEmailHtml } from '../lib/emailService.js'

const router = Router()

const JWT_SECRET = process.env.JWT_SECRET || 'dev-crm-jwt-secret-change-me'
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-crm-refresh-secret-change-me'
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:5173'
const BCRYPT_ROUNDS = 12
const ACCESS_EXPIRY = '15m'
const REFRESH_EXPIRY_DAYS = 7
const INVITE_EXPIRY_HOURS = 72
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

// ── Helpers ──

function generateAccessToken(user: { id: string; email: string; role: string; firstName: string; lastName: string }): string {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, firstName: user.firstName, lastName: user.lastName }, JWT_SECRET, { expiresIn: ACCESS_EXPIRY })
}

function generateRefreshToken(): string {
  return crypto.randomBytes(40).toString('hex')
}

function verifyAccess(token: string): any {
  return jwt.verify(token, JWT_SECRET)
}

// ── Login ──

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body)

    const user = await prisma.crmUser.findUnique({ where: { email: email.toLowerCase() } })
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

    // Generate tokens
    const accessToken = generateAccessToken(user)
    const refreshToken = generateRefreshToken()
    const refreshHash = await bcrypt.hash(refreshToken, 10)

    // Store session
    await prisma.crmUserSession.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        ipAddress: req.ip || req.socket.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
        expiresAt: new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    })

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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[CRM Auth] Login error:', err)
    res.status(500).json({ success: false, error: 'Login failed' })
  }
})

// ── Refresh Token ──

router.post('/refresh', async (req, res) => {
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
    const user = matchedSession.user
    const accessToken = generateAccessToken(user)
    const newRefreshToken = generateRefreshToken()
    const newRefreshHash = await bcrypt.hash(newRefreshToken, 10)

    await prisma.crmUserSession.create({
      data: {
        userId: user.id,
        tokenHash: newRefreshHash,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        expiresAt: new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    })

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
      },
    })
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
})

// ── Logout ──

router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body
  if (refreshToken) {
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
    if (!['super_admin', 'admin'].includes(payload.role)) {
      res.status(403).json({ success: false, error: 'Admin access required' })
      return
    }

    const data = inviteSchema.parse(req.body)
    const email = data.email.toLowerCase()

    // Check if user exists
    const existing = await prisma.crmUser.findUnique({ where: { email } })
    if (existing) {
      res.status(409).json({ success: false, error: 'A user with this email already exists' })
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
        inviteTokenHash: tokenHash,
        inviteTokenExpiresAt: new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000),
      },
    })

    // Send invite email
    const inviteUrl = `${CLIENT_URL}/accept-invite?token=${rawToken}&email=${encodeURIComponent(email)}`
    await sendEmail({
      to: email,
      subject: `You're invited to ${process.env.COMPANY_NAME || 'FencePro CRM'}`,
      body: buildEmailHtml(`
        <p>Hi ${data.firstName},</p>
        <p>You've been invited to join ${process.env.COMPANY_NAME || 'FencePro CRM'} as <strong>${data.role.replace('_', ' ')}</strong>.</p>
        <p><a href="${inviteUrl}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Accept Invite & Set Password</a></p>
        <p style="color:#94a3b8;font-size:13px;">This link expires in ${INVITE_EXPIRY_HOURS} hours.</p>
      `),
    })

    await prisma.crmUserActivity.create({
      data: { userId: payload.sub, action: 'invite_sent', entityType: 'user', entityId: user.id, metadata: JSON.parse(JSON.stringify({ invitedEmail: email, role: data.role })) },
    }).catch(() => {})

    res.status(201).json({ success: true, data: { id: user.id, email, status: 'invited' } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    console.error('[CRM Auth] Invite error:', err)
    res.status(500).json({ success: false, error: 'Failed to send invite' })
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
    const accessToken = generateAccessToken(user)
    const refreshToken = generateRefreshToken()
    const refreshHash = await bcrypt.hash(refreshToken, 10)

    await prisma.crmUserSession.create({
      data: {
        userId: user.id,
        tokenHash: refreshHash,
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        expiresAt: new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
      },
    })

    res.json({
      success: true,
      data: {
        accessToken,
        refreshToken,
        user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to accept invite' })
  }
})

// ── Forgot Password ──

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = z.object({ email: z.string().email() }).parse(req.body)
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

    const resetUrl = `${CLIENT_URL}/reset-password?token=${rawToken}&email=${encodeURIComponent(email)}`
    await sendEmail({
      to: email,
      subject: 'Password Reset',
      body: buildEmailHtml(`
        <p>Hi ${user.firstName},</p>
        <p>Click below to reset your password:</p>
        <p><a href="${resetUrl}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a></p>
        <p style="color:#94a3b8;font-size:13px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
      `),
    })

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
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Reset failed' })
  }
})

// ── User Management (admin only) ──

router.get('/users', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = verifyAccess(auth.slice(7))
    if (!['super_admin', 'admin'].includes(payload.role)) {
      res.status(403).json({ success: false, error: 'Admin access required' })
      return
    }

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
    if (!['super_admin', 'admin'].includes(payload.role)) {
      res.status(403).json({ success: false, error: 'Admin access required' })
      return
    }

    const data = z.object({
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      phone: z.string().optional(),
      role: z.enum(['super_admin', 'admin', 'manager', 'sales_rep', 'field_crew', 'office_staff', 'customer']).optional(),
      status: z.enum(['active', 'suspended', 'deactivated']).optional(),
    }).parse(req.body)

    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id
    const user = await prisma.crmUser.update({
      where: { id: userId },
      data: data as any,
    })

    res.json({ success: true, data: { id: user.id, role: user.role, status: user.status } })
  } catch (err) {
    if (err instanceof z.ZodError) { res.status(400).json({ success: false, error: err.errors[0].message }); return }
    res.status(500).json({ success: false, error: 'Failed to update user' })
  }
})

// Active sessions
router.get('/sessions', async (req, res) => {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) { res.status(401).json({ success: false, error: 'Not authenticated' }); return }
  try {
    const payload = verifyAccess(auth.slice(7))
    if (!['super_admin', 'admin'].includes(payload.role)) {
      res.status(403).json({ success: false, error: 'Admin access required' })
      return
    }

    const sessions = await prisma.crmUserSession.findMany({
      where: { revokedAt: null, expiresAt: { gt: new Date() } },
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

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
    if (!['super_admin', 'admin'].includes(payload.role)) {
      res.status(403).json({ success: false, error: 'Admin access required' })
      return
    }

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
    if (!['super_admin', 'admin'].includes(payload.role)) {
      res.status(403).json({ success: false, error: 'Admin access required' })
      return
    }

    const userId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id

    // Prevent deleting yourself
    if (userId === payload.sub) {
      res.status(400).json({ success: false, error: 'Cannot delete your own account' })
      return
    }

    // Prevent deleting super_admin unless you are super_admin
    const target = await prisma.crmUser.findUnique({ where: { id: userId } })
    if (!target) { res.status(404).json({ success: false, error: 'User not found' }); return }
    if (target.role === 'super_admin' && payload.role !== 'super_admin') {
      res.status(403).json({ success: false, error: 'Cannot delete a super admin' })
      return
    }

    // Delete sessions and activity first, then user
    await prisma.crmUserSession.deleteMany({ where: { userId } })
    await prisma.crmUserActivity.deleteMany({ where: { userId } })
    await prisma.crmUser.delete({ where: { id: userId } })

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
    if (!['super_admin', 'admin'].includes(payload.role)) {
      res.status(403).json({ success: false, error: 'Admin access required' })
      return
    }

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
