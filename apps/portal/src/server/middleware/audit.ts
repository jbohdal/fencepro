import type { Request, Response, NextFunction } from 'express'
import prisma from '../lib/prisma.js'

export function auditLog(action: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    // Log after the request completes
    const originalEnd = _res.end.bind(_res)
    _res.end = function (...args: Parameters<typeof originalEnd>) {
      // Fire and forget — don't block the response
      prisma.auditLog.create({
        data: {
          customerId: req.user?.sub || null,
          action,
          metadata: JSON.parse(JSON.stringify({
            method: req.method,
            path: req.path,
            statusCode: _res.statusCode,
          })),
          ipAddress: req.ip || req.socket.remoteAddress || null,
          userAgent: req.headers['user-agent'] || null,
        },
      }).catch(() => { /* silently fail audit logging */ })

      return originalEnd(...args)
    } as typeof originalEnd
    next()
  }
}

/** Direct audit log write (for use outside middleware) */
export async function writeAuditLog(customerId: string | null, action: string, metadata?: Record<string, unknown>, ip?: string): Promise<void> {
  await prisma.auditLog.create({
    data: { customerId, action, metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : undefined, ipAddress: ip || null },
  }).catch(() => {})
}
