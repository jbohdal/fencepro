/**
 * CRM Auth Middleware
 *
 * Validates JWT from CRM frontend and enforces role-based access.
 * Separate from portal auth (which is for customer portal users).
 */

import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { resolveSecret, syncKeyMatches } from '../lib/secrets.js'

const JWT_SECRET = resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

export interface CrmUserPayload {
  sub: string
  email: string
  role: string
  firstName: string
  lastName: string
}

declare global {
  namespace Express {
    interface Request {
      crmUser?: CrmUserPayload
    }
  }
}

/** Require a valid CRM JWT — sets req.crmUser */
export function requireCrmAuth(req: Request, res: Response, next: NextFunction): void {
  // Check Bearer token
  const auth = req.headers.authorization
  if (auth?.startsWith('Bearer ')) {
    try {
      req.crmUser = jwt.verify(auth.slice(7), JWT_SECRET) as CrmUserPayload
      next()
      return
    } catch { /* fall through */ }
  }

  // Also accept X-API-Key for backward compat with sync endpoints
  if (syncKeyMatches(req.headers['x-api-key'])) {
    req.crmUser = { sub: 'sync', email: 'sync@system', role: 'admin', firstName: 'System', lastName: 'Sync' }
    next()
    return
  }

  res.status(401).json({ success: false, error: 'Authentication required' })
}

/** Require specific CRM roles */
export function requireCrmRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.crmUser) {
      res.status(401).json({ success: false, error: 'Authentication required' })
      return
    }
    // super_admin bypasses all role checks
    if (req.crmUser.role === 'super_admin') {
      next()
      return
    }
    if (!allowedRoles.includes(req.crmUser.role)) {
      res.status(403).json({ success: false, error: 'Insufficient permissions' })
      return
    }
    next()
  }
}

/** Permission check helper — use in route handlers for fine-grained control */
export function hasPermission(role: string, feature: string, action: 'full' | 'view' | 'own' | 'assigned' = 'full'): boolean {
  if (role === 'super_admin') return true

  const matrix: Record<string, Record<string, string>> = {
    admin:        { users: 'full', admin: 'full', api_keys: 'full', integrations: 'full', pipeline: 'full', contacts: 'full', jobs: 'full', schedule: 'full', invoices: 'full', reports: 'full', settings: 'full', automations: 'full', inventory: 'full' },
    manager:      { pipeline: 'full', contacts: 'full', jobs: 'full', schedule: 'full', invoices: 'full', reports: 'full', settings: 'view', automations: 'full', inventory: 'full', integrations: 'view' },
    sales_rep:    { pipeline: 'own', contacts: 'own', jobs: 'own', schedule: 'view', invoices: 'own', reports: 'own', inventory: 'view' },
    field_crew:   { jobs: 'assigned', schedule: 'assigned', inventory: 'view' },
    office_staff: { pipeline: 'view', contacts: 'full', jobs: 'full', schedule: 'full', invoices: 'full', reports: 'view', inventory: 'full' },
    customer:     { contacts: 'own', jobs: 'own', invoices: 'own' },
  }

  const perms = matrix[role]
  if (!perms) return false
  const level = perms[feature]
  if (!level) return false
  if (level === 'full') return true
  if (level === action) return true
  if (action === 'view' && ['full', 'own', 'assigned'].includes(level)) return true
  return false
}
