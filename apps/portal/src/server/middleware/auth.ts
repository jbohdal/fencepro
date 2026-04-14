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
    req.user = verifyAccessToken(token)
    next()
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' })
  }
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
