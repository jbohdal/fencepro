/**
 * Secrets and staff authentication helpers — one place, so no route can fall
 * back to a secret that is sitting in the public repo.
 *
 * Development keeps the old behavior (placeholder fallbacks) so a fresh
 * checkout still runs. Production never uses a placeholder:
 *   - JWT secrets: a missing or placeholder value is replaced with a random
 *     secret for the life of the process, with a loud log line. The app stays
 *     up; everyone is logged out on each restart until the env var is set.
 *   - Sync key: a missing or placeholder CRM_SYNC_KEY disables API key auth.
 */

import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import type { Request } from 'express'

const isProd = process.env.NODE_ENV === 'production'

function isPlaceholder(value: string | undefined): boolean {
  return !value || /change-me|^dev-/i.test(value)
}

const generated = new Map<string, string>()

/** Resolve a signing secret by env var name. `devFallback` is only ever used outside production. */
export function resolveSecret(name: string, devFallback: string): string {
  const value = process.env[name]
  if (!isPlaceholder(value)) return value as string
  if (!isProd) return value || devFallback
  let secret = generated.get(name)
  if (!secret) {
    secret = crypto.randomBytes(48).toString('hex')
    generated.set(name, secret)
    console.error(
      `[SECURITY] ${name} is missing or still a placeholder. A random secret is in use for this process, ` +
      `so every login is dropped on restart. Set ${name} to a long random string in the server environment.`,
    )
  }
  return secret
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

let warnedSyncKey = false

/** True when the X-API-Key header carries the configured sync key. */
export function syncKeyMatches(provided: unknown): boolean {
  if (typeof provided !== 'string' || provided.length === 0) return false
  const expected = process.env.CRM_SYNC_KEY
  if (isPlaceholder(expected)) {
    if (isProd) {
      if (!warnedSyncKey) {
        warnedSyncKey = true
        console.error('[SECURITY] CRM_SYNC_KEY is missing or still the development default, so API key access is disabled. Staff logins are not affected.')
      }
      return false
    }
    return safeEqual(provided, expected || 'dev-sync-key')
  }
  return safeEqual(provided, expected as string)
}

export interface StaffIdentity {
  sub: string
  email?: string
  role: string
  firstName?: string
  lastName?: string
  crmAccountId?: string | null
}

const NON_STAFF_ROLES = new Set(['customer', 'portal_customer'])

/**
 * Verify the Bearer token on a request and return the staff identity, or null.
 * The signature is checked; a header that merely starts with "Bearer " is not
 * enough. Customer and portal customer tokens are not staff.
 */
export function verifyStaffBearer(req: Request): StaffIdentity | null {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  for (const fallback of ['dev-crm-jwt-secret-change-me', 'dev-secret-change-me']) {
    try {
      const payload = jwt.verify(token, resolveSecret('JWT_SECRET', fallback)) as StaffIdentity
      if (!payload?.sub || !payload.role || NON_STAFF_ROLES.has(payload.role)) return null
      return payload
    } catch { /* try the other development fallback */ }
  }
  return null
}

/** Staff request = a valid sync key, or a verified staff login token. */
export function isStaffRequest(req: Request): boolean {
  return syncKeyMatches(req.headers['x-api-key']) || verifyStaffBearer(req) !== null
}
