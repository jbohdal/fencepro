import type { Request, Response, NextFunction } from 'express'
import { verifyAccessToken } from '../lib/auth.js'
import type { TokenPayload } from '../../types/index.js'

// Extend Express Request to include authenticated user
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload
    }
  }
}

/** Require a valid JWT access token */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }

  try {
    const token = header.slice(7)
    req.user = normalizeStaffToken(verifyAccessToken(token))
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' })
  }
}

/**
 * The routes behind requireAuth were written for the customer portal's roles
 * (admin / support_agent / customer). CRM staff log in with CRM roles
 * (super_admin, admin, manager, ...) and a crmAccountId, so the owner's
 * super_admin login was refused by every `role !== 'admin'` check: EZ Budget,
 * automations, integrations, API keys, leads, appointments, the knowledge
 * base and the audit log all answered "Admin access required".
 *
 * Map a CRM token onto the role those checks expect, and carry the company
 * id across. Portal tokens pass through untouched.
 */
const CRM_ROLE_TO_PORTAL_ROLE: Record<string, TokenPayload['role']> = {
  super_admin: 'admin',
  admin: 'admin',
  manager: 'support_agent',
  office_staff: 'support_agent',
  sales_rep: 'support_agent',
}

function normalizeStaffToken(payload: TokenPayload): TokenPayload {
  const raw = payload as any
  const mapped = CRM_ROLE_TO_PORTAL_ROLE[raw.role as string]
  if (!mapped) return payload
  // A portal 'admin' token has no crmAccountId and is already in the right shape.
  if (raw.role === 'admin' && raw.crmAccountId === undefined) return payload
  return {
    ...raw,
    role: mapped,
    crmRole: raw.role,
    accountId: raw.accountId ?? raw.crmAccountId ?? undefined,
  } as TokenPayload
}

/** Require specific roles */
export function requireRole(...roles: TokenPayload['role'][]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required' })
      return
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' })
      return
    }
    next()
  }
}

/** Ensure customer can only access their own account's data */
export function enforceAccountScope(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, error: 'Authentication required' })
    return
  }
  // Admins and support agents can access any account
  if (req.user.role === 'admin' || req.user.role === 'support_agent') {
    next()
    return
  }
  // Customers can only access their own account
  const requestedAccountId = req.params.accountId || req.query.accountId
  if (requestedAccountId && requestedAccountId !== req.user.accountId) {
    res.status(403).json({ success: false, error: 'Access denied' })
    return
  }
  next()
}
