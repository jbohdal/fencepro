/**
 * Audit log helper.
 *
 * Records every significant data mutation to the AuditLog table so the Admin
 * Audit Log page can show "who changed what, when, and what changed exactly."
 * Designed to be called from inside a route handler with the request object
 * so we can capture user, IP, and user-agent automatically.
 *
 * Usage:
 *   await audit(req, 'create', 'CrmContact', created.id, { newValues: created })
 *   await audit(req, 'update', 'CrmContact', id, { oldValues: before, newValues: after })
 *   await audit(req, 'delete', 'CrmContact', id, { oldValues: before })
 *
 * Fail-open: if the AuditLog write throws (e.g. table missing during a partial
 * deploy) the audit error is logged to stderr but the underlying business
 * operation is NEVER blocked. Audit logging is observability, not a guard.
 */

import type { Request } from 'express'
import prisma from './prisma.js'

export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'soft_delete'
  | 'restore'
  | 'login'
  | 'login_failed'
  | 'logout'
  | 'invite_sent'
  | 'invite_resent'
  | 'invite_accepted'
  | 'password_changed'
  | 'role_changed'
  | 'settings_changed'
  | 'file_uploaded'
  | 'file_deleted'
  | 'stage_changed'
  | 'paid'
  | 'voided'
  | 'sent'
  | 'sold'

export interface AuditOptions {
  oldValues?: unknown
  newValues?: unknown
  /** Override entity ID (rare; default reads it from the second positional arg) */
  entityId?: string | null
}

interface AuditUserHint {
  id?: string
  email?: string
}

function userFromReq(req: Request | undefined): AuditUserHint {
  if (!req) return {}
  const r = req as Request & { user?: AuditUserHint; crmUser?: AuditUserHint }
  const u: AuditUserHint = r.user || r.crmUser || {}
  return { id: u.id, email: u.email }
}

function ipFromReq(req: Request | undefined): string | undefined {
  if (!req) return undefined
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || undefined
}

function uaFromReq(req: Request | undefined): string | undefined {
  if (!req) return undefined
  return (req.headers['user-agent'] as string) || undefined
}

/** Strip large or sensitive fields from a record before storing. */
function sanitize(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value
  // Avoid recording bcrypt hashes, tokens, secrets, etc.
  const REDACT = new Set([
    'passwordHash',
    'password',
    'inviteTokenHash',
    'tokenHash',
    'refreshToken',
    'refreshTokenHash',
    'apiKey',
    'apiKeyHash',
    'secret',
    'authorization',
  ])
  if (Array.isArray(value)) return value.map(sanitize)
  const obj = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT.has(k)) { out[k] = '[redacted]'; continue }
    out[k] = typeof v === 'object' ? sanitize(v) : v
  }
  return out
}

export async function audit(
  req: Request | undefined,
  action: AuditAction,
  entityType: string,
  entityId: string | null | undefined,
  opts: AuditOptions = {},
): Promise<void> {
  const user = userFromReq(req)
  try {
    await prisma.crmAuditLog.create({
      data: {
        userId: user.id,
        userEmail: user.email,
        action,
        entityType,
        entityId: opts.entityId ?? entityId ?? null,
        oldValues: opts.oldValues !== undefined ? (sanitize(opts.oldValues) as object) : undefined,
        newValues: opts.newValues !== undefined ? (sanitize(opts.newValues) as object) : undefined,
        ipAddress: ipFromReq(req),
        userAgent: uaFromReq(req),
      },
    })
  } catch (err) {
    // Audit failure must NEVER block a real operation. Just log it.
    console.error(`[audit] WARN: failed to record ${action} on ${entityType} ${entityId ?? ''}: ${(err as Error).message}`)
  }
}

/** Convenience helper for non-request contexts (cron jobs, scripts). */
export async function auditSystem(
  action: AuditAction,
  entityType: string,
  entityId: string | null | undefined,
  opts: AuditOptions = {},
): Promise<void> {
  try {
    await prisma.crmAuditLog.create({
      data: {
        userId: null,
        userEmail: 'system',
        action,
        entityType,
        entityId: opts.entityId ?? entityId ?? null,
        oldValues: opts.oldValues !== undefined ? (sanitize(opts.oldValues) as object) : undefined,
        newValues: opts.newValues !== undefined ? (sanitize(opts.newValues) as object) : undefined,
      },
    })
  } catch (err) {
    console.error(`[audit] system ${action} failed to record: ${(err as Error).message}`)
  }
}
