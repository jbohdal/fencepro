import { Router } from 'express'
import { z } from 'zod'
import prisma from '../lib/prisma.js'
import { hashPassword, verifyPassword, generateTokens, verifyRefreshToken, getRefreshExpiry } from '../lib/auth.js'
import { writeAuditLog } from '../middleware/audit.js'
import type { TokenPayload } from '../../types/index.js'

const router = Router()

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  phone: z.string().optional(),
  accountId: z.string().uuid(),
})

// ── Login ──
router.post('/login', async (req, res) => {
  try {
    const { email, password } = loginSchema.parse(req.body)

    const customer = await prisma.customer.findUnique({
      where: { email },
      include: { account: true },
    })

    if (!customer || !customer.portalEnabled) {
      res.status(401).json({ success: false, error: 'Invalid credentials' })
      return
    }

    const valid = await verifyPassword(password, customer.passwordHash)
    if (!valid) {
      await writeAuditLog(customer.id, 'login_failed', { email }, req.ip || undefined)
      res.status(401).json({ success: false, error: 'Invalid credentials' })
      return
    }

    const payload: TokenPayload = {
      sub: customer.id,
      email: customer.email,
      role: customer.role,
      accountId: customer.accountId,
    }

    const tokens = generateTokens(payload)

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        customerId: customer.id,
        token: tokens.refreshToken,
        expiresAt: getRefreshExpiry(),
      },
    })

    // Update last login
    await prisma.customer.update({ where: { id: customer.id }, data: { lastLoginAt: new Date() } })
    await writeAuditLog(customer.id, 'login', { email }, req.ip || undefined)

    res.json({
      success: true,
      data: {
        ...tokens,
        user: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          role: customer.role,
          accountName: customer.account.name,
        },
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Internal server error' })
  }
})

// ── Register ──
router.post('/register', async (req, res) => {
  try {
    const data = registerSchema.parse(req.body)

    const existing = await prisma.customer.findUnique({ where: { email: data.email } })
    if (existing) {
      res.status(409).json({ success: false, error: 'Email already registered' })
      return
    }

    const account = await prisma.crmAccount.findUnique({ where: { id: data.accountId } })
    if (!account) {
      res.status(404).json({ success: false, error: 'Account not found' })
      return
    }

    const passwordHash = await hashPassword(data.password)

    const customer = await prisma.customer.create({
      data: {
        email: data.email,
        passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        phone: data.phone,
        accountId: data.accountId,
      },
    })

    const payload: TokenPayload = {
      sub: customer.id,
      email: customer.email,
      role: customer.role,
      accountId: customer.accountId,
    }

    const tokens = generateTokens(payload)
    await prisma.refreshToken.create({
      data: { customerId: customer.id, token: tokens.refreshToken, expiresAt: getRefreshExpiry() },
    })

    await writeAuditLog(customer.id, 'register', { email: data.email }, req.ip || undefined)

    res.status(201).json({
      success: true,
      data: {
        ...tokens,
        user: {
          id: customer.id,
          email: customer.email,
          firstName: customer.firstName,
          lastName: customer.lastName,
          role: customer.role,
          accountName: account.name,
        },
      },
    })
  } catch (err) {
    if (err instanceof z.ZodError) {
      res.status(400).json({ success: false, error: err.errors[0].message })
      return
    }
    res.status(500).json({ success: false, error: 'Internal server error' })
  }
})

// ── Refresh Token ──
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body
    if (!refreshToken) {
      res.status(400).json({ success: false, error: 'Refresh token required' })
      return
    }

    const decoded = verifyRefreshToken(refreshToken)

    const stored = await prisma.refreshToken.findUnique({ where: { token: refreshToken } })
    if (!stored || stored.expiresAt < new Date()) {
      res.status(401).json({ success: false, error: 'Invalid refresh token' })
      return
    }

    const customer = await prisma.customer.findUnique({ where: { id: decoded.sub } })
    if (!customer || !customer.portalEnabled) {
      res.status(401).json({ success: false, error: 'Account disabled' })
      return
    }

    // Rotate refresh token
    await prisma.refreshToken.delete({ where: { id: stored.id } })

    const payload: TokenPayload = {
      sub: customer.id,
      email: customer.email,
      role: customer.role,
      accountId: customer.accountId,
    }

    const tokens = generateTokens(payload)
    await prisma.refreshToken.create({
      data: { customerId: customer.id, token: tokens.refreshToken, expiresAt: getRefreshExpiry() },
    })

    res.json({ success: true, data: tokens })
  } catch {
    res.status(401).json({ success: false, error: 'Invalid refresh token' })
  }
})

// ── Logout ──
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body
  if (refreshToken) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } }).catch(() => {})
  }
  res.json({ success: true })
})

// ── Me (get current user) ──
router.get('/me', async (req, res) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Not authenticated' })
    return
  }
  try {
    const { verifyAccessToken } = await import('../lib/auth.js')
    const payload = verifyAccessToken(header.slice(7))
    const customer = await prisma.customer.findUnique({
      where: { id: payload.sub },
      include: { account: true },
    })
    if (!customer) {
      res.status(404).json({ success: false, error: 'User not found' })
      return
    }
    res.json({
      success: true,
      data: {
        id: customer.id,
        email: customer.email,
        firstName: customer.firstName,
        lastName: customer.lastName,
        role: customer.role,
        accountId: customer.accountId,
        accountName: customer.account.name,
        assignedRep: customer.account.assignedRepName,
        assignedRepEmail: customer.account.assignedRepEmail,
      },
    })
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token' })
  }
})

export default router
