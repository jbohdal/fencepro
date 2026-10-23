/**
 * Staff sign ins are tied to a session row, not just to the signing secret.
 *
 * Until Oct 2026 a staff access token was a JWT signed with JWT_SECRET and
 * nothing else: anyone who could read the server's settings file could make
 * one, and the server could not tell it from a real sign in. Now every staff
 * token made by a real sign in carries `sid`, the id of its CrmUserSession
 * row (the row that holds the refresh token's hash). Sign in, refresh, accept
 * invite and change password are the only places that make one.
 *
 * Every request under /api that carries a staff token (reads and saves) must
 * name a session that exists, belongs to that login, is not revoked and has
 * not run out. Otherwise: 401 "Please sign in again". The app answers a 401 by
 * renewing its sign in once and trying again, so a token made before this
 * change (no `sid`) is swapped for one with a `sid` on its next call, and
 * nobody is signed out. A signed out device, a removed login, a revoked
 * session (Settings > Team > sessions) and a changed password stop at once.
 *
 * Reads are checked too: a token someone made by hand should not read the
 * customer list either. A read reuses a good answer for 15 seconds (one
 * screen makes about 15 calls); a save always asks the database.
 *
 * Not affected:
 *   - the server's own jobs (backups, duplicate check, calendar sync,
 *     automations, follow up push, data integrity, address refresh, start up
 *     steps): they use Prisma directly, never HTTP;
 *   - customer portal tokens (role customer / portal_customer) and the
 *     website widget, which has no staff token;
 *   - the sync key (X-API-Key): not a sign in; every save made with it is
 *     written to the log with the device and address.
 *
 * Signed in by the ezbiz_staff cookie (lib/staffSession.ts): checked there,
 * before this runs, on every request; this lets it through. With the stage D
 * switch on (STAFF_COOKIE_ONLY=1) a staff Bearer token is refused here.
 *
 * Dev only: on the practice database (ezbiz_dev, never in production) a staff
 * token without `sid` is still let through, so test tokens made for the
 * browser tests keep working. A token that names a session is checked the
 * same way everywhere. See scripts/dev-session-token.ts for a real dev session.
 */

import type { Request, Response, NextFunction } from 'express'
import prisma from './prisma.js'
import { verifyStaffBearer, syncKeyMatches, type StaffIdentity } from './secrets.js'
import { databaseNameOf } from './liveGuard.js'
import { noteStaffDevice } from './staffDevices.js'
import { cookieOnly } from './staffSession.js'

export const DEV_DATABASE_NAME = 'ezbiz_dev'


let sidlessOverride: boolean | null = null
/** Tests only: force the dev allowance on or off (null: decide from the environment). */
export function setSidlessAllowedForTest(value: boolean | null): void { sidlessOverride = value; okCache.clear() }

/** True only on the practice database outside production. */
export function sidlessAllowed(): boolean {
  if (sidlessOverride !== null) return sidlessOverride
  return process.env.NODE_ENV !== 'production' && databaseNameOf(process.env.DATABASE_URL) === DEV_DATABASE_NAME
}

export type SessionRefusal = 'NO_SESSION_ID' | 'SESSION_ENDED' | 'BEARER_RETIRED'

const READ_CACHE_MS = 15_000
const okCache = new Map<string, number>()   // `${sid}:${sub}` → good until

/** Why this staff token may not be used, or null when it may. */
export async function sessionRefusal(payload: Pick<StaffIdentity, 'sub'> & { sid?: unknown }, opts: { read?: boolean } = {}): Promise<SessionRefusal | null> {
  const sid = payload.sid
  if (sid === undefined || sid === null || sid === '') return sidlessAllowed() ? null : 'NO_SESSION_ID'
  if (typeof sid !== 'string' || sid.length > 64) return 'SESSION_ENDED'
  const key = `${sid}:${payload.sub}`
  if (opts.read) {
    const until = okCache.get(key)
    if (until && until > Date.now()) return null
  }
  const row = await prisma.crmUserSession.findUnique({ where: { id: sid }, select: { userId: true, revokedAt: true, expiresAt: true } })
  if (!row || row.userId !== payload.sub || row.revokedAt || row.expiresAt.getTime() <= Date.now()) {
    okCache.delete(key)
    return 'SESSION_ENDED'
  }
  if (okCache.size > 5000) okCache.clear()
  okCache.set(key, Date.now() + READ_CACHE_MS)
  return null
}

/** Sign in steps that must work without (or with an old) access token. */
const OPEN_PATHS = new Set([
  '/crm-auth/login', '/crm-auth/refresh', '/crm-auth/logout', '/crm-auth/accept-invite',
  '/crm-auth/forgot-password', '/crm-auth/reset-password', '/crm-auth/move-over', '/health', '/health/storage',
])

const isRead = (method: string) => method === 'GET' || method === 'HEAD'

/** Mounted on /api before every route (index.ts). */
export function requireLiveSession(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS' || OPEN_PATHS.has(req.path.replace(/\/+$/, ''))) { next(); return }
  // Signed in by the ezbiz_staff cookie: its session was looked up just now (lib/staffSession.ts).
  if (req.staffCookie) { (req as any).staffSessionId = req.staffCookie.sessionId; next(); return }
  const payload = verifyStaffBearer(req) as (StaffIdentity & { sid?: unknown }) | null
  // Stage D (STAFF_COOKIE_ONLY=1): the old Bearer sign in is refused; the app signs in again by cookie.
  if (payload && cookieOnly()) {
    console.warn(`[session-refused] ${req.method} ${req.originalUrl.split('?')[0]} BEARER_RETIRED user=${payload.email ?? payload.sub} from ${clientIp(req)}`)
    res.status(401).json({ success: false, code: 'BEARER_RETIRED', error: 'Please sign in again' }); return
  }
  if (!payload) {
    // Not a staff token (none, a customer's, or one that does not verify: the route answers that).
    if (!isRead(req.method) && !req.headers.authorization && syncKeyMatches(req.headers['x-api-key'])) {
      console.warn(`[sync-key-write] ${req.method} ${req.originalUrl.split('?')[0]} from ${clientIp(req)} device="${String(req.headers['user-agent'] ?? '').slice(0, 120)}"`)
    }
    next(); return
  }
  sessionRefusal(payload, { read: isRead(req.method) }).then(refusal => {
    if (!refusal) {
      (req as any).staffSessionId = typeof payload.sid === 'string' ? payload.sid : null
      // A proposal opened later on this same device is a staff view (lib/proposalViews.ts).
      noteStaffDevice(req, payload.sub, payload.crmAccountId)
      next(); return
    }
    console.warn(`[session-refused] ${req.method} ${req.originalUrl.split('?')[0]} ${refusal} user=${payload.email ?? payload.sub} from ${clientIp(req)} device="${String(req.headers['user-agent'] ?? '').slice(0, 120)}"`)
    res.status(401).json({ success: false, code: refusal, error: 'Please sign in again' })
  }).catch(err => {
    console.error('[session] check failed:', err)
    res.status(503).json({ success: false, error: 'Could not check your sign in. Try again in a moment.' })
  })
}

function clientIp(req: Request): string {
  return (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() || req.ip || '-'
}

if (sidlessAllowed() && process.env.VITEST !== 'true') {
  console.log('[sessions] practice database: staff test tokens without a session id are let through (never on live)')
}
