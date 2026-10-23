/**
 * Staff sign in by cookie (plan of Oct 20, 2026, stage A).
 *
 * Until now the staff app kept a 15 minute access token and a 7 day refresh
 * token in the browser's storage and sent them as a Bearer header. Now a sign
 * in is a server side session carried by the cookie `ezbiz_staff`:
 *
 *   - Its value is 32 random bytes. The CrmUserSession row keeps only its
 *     SHA-256 (in tokenHash, prefixed `ck1:`), never the value.
 *   - HttpOnly (the page's script never sees it), SameSite=Strict (never sent
 *     from another site), Path=/api (sent only to the API, not to the public
 *     doors under /p/), Secure (https only; plain http is let through only on
 *     localhost, the developer's own machine and the Mac's own checks).
 *   - It lasts 30 days since it was last used, and 90 days at most.
 *   - It ends at once on: sign out, ending the session in Settings > Team, a
 *     password change (every other device), the login switched off or given a
 *     new role, the login deleted. Every request looks the session up; nothing
 *     is remembered between requests.
 *   - Every request that changes something must carry `X-Staff-Request: 1`
 *     to count as signed in by cookie; without it the cookie is ignored for
 *     that request (a staff route answers 401, nothing is saved as the
 *     login). A form or image on another site cannot send a
 *     custom header, and a script there needs a CORS preflight the server
 *     refuses, so with SameSite=Strict a page elsewhere cannot make a signed
 *     in browser save anything. Same as the customer portal (lib/portalSession.ts,
 *     `X-Portal-Request`), whose cookie `ezbiz_portal` is separate.
 *
 * How the rest of the server sees it: once the cookie checks out, the request
 * is given the identity from the database (the login's role as it is now, not
 * as the browser says) in `req.staffCookie`, and a short lived signed token
 * with the same identity is put in the Authorization header for the routes
 * that read the header themselves. lib/secrets.ts verifyStaffBearer prefers
 * req.staffCookie, so the cost hiding (lib/costRedact.ts), requireCan /
 * roleOf (lib/permissions.ts, through middleware/auth.ts) and every route see
 * the cookie's login. This runs before the cost hiding middleware (index.ts),
 * so a salesman signed in by cookie gets no costs.
 *
 * The old Bearer token keeps working during the switch window (30 days after
 * go live). Stage D: STAFF_COOKIE_ONLY=1 in the server settings refuses every
 * staff Bearer token and the one time move over (POST /api/crm-auth/move-over).
 *
 * Read only sessions (kind 'readonly'): made only by scripts/readonly-session.ts
 * run on the Mac with database access, 3 hours, every request that is not a
 * read refused, and refused unless the request comes from the Mac itself
 * (fromThisMachine below).
 */

import crypto from 'crypto'
import os from 'os'
import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import prisma from './prisma.js'
import { resolveSecret } from './secrets.js'
import { noteStaffDevice } from './staffDevices.js'

export const STAFF_COOKIE = 'ezbiz_staff'
export const STAFF_COOKIE_PATH = '/api'
export const STAFF_WRITE_HEADER = 'x-staff-request'
export const STAFF_IDLE_DAYS = 30
export const STAFF_MAX_DAYS = 90
export const READONLY_HOURS = 3
const DAY = 86_400_000
const TOUCH_MS = 5 * 60_000
const HASH_PREFIX = 'ck1:'

export type StaffSessionKind = 'cookie' | 'readonly'

export interface StaffCookieIdentity {
  sub: string
  email: string
  role: string
  firstName: string
  lastName: string
  crmAccountId: string | null
  sid: string
  sessionId: string
  readOnly: boolean
}

declare global {
  namespace Express {
    interface Request {
      staffCookie?: StaffCookieIdentity
    }
  }
}

// ── Stage D switch ───────────────────────────────────────────────────────────

let cookieOnlyOverride: boolean | null = null
/** Tests only: force the stage D switch on or off (null: from the environment). */
export function setCookieOnlyForTest(v: boolean | null): void { cookieOnlyOverride = v }

/** Stage D: the old Bearer sign in and the move over are refused. Off until STAFF_COOKIE_ONLY=1. */
export function cookieOnly(): boolean {
  if (cookieOnlyOverride !== null) return cookieOnlyOverride
  return process.env.STAFF_COOKIE_ONLY === '1'
}

// ── The cookie ───────────────────────────────────────────────────────────────

export const cookieHash = (value: string) => HASH_PREFIX + crypto.createHash('sha256').update(value).digest('hex')

/** The cookie's value from the request (no cookie parser is installed). */
export function staffCookieOf(req: Pick<Request, 'headers'>): string {
  const raw = String(req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${STAFF_COOKIE}=`))
  if (!raw) return ''
  try { return decodeURIComponent(raw.slice(STAFF_COOKIE.length + 1)) } catch { return '' }
}

/** Plain http is allowed only on this machine (the dev server, the Mac's checks); everywhere else https only. */
function secureFor(req: Request): boolean {
  const host = String(req.hostname || '').toLowerCase()
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  return req.secure || !local
}

function setCookie(req: Request, res: Response, value: string, maxAgeMs: number): void {
  res.cookie(STAFF_COOKIE, value, { httpOnly: true, secure: secureFor(req), sameSite: 'strict', path: STAFF_COOKIE_PATH, maxAge: Math.max(1000, maxAgeMs) })
}

export function clearStaffCookie(req: Request, res: Response): void {
  res.clearCookie(STAFF_COOKIE, { httpOnly: true, secure: secureFor(req), sameSite: 'strict', path: STAFF_COOKIE_PATH })
}

/** When a session ends if nothing more happens: 30 days after its last use, never after expiresAt. */
export function sessionEndsAt(s: { kind: string | null; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date }): Date {
  if (s.kind !== 'cookie') return s.expiresAt
  const idle = (s.lastUsedAt ?? s.createdAt).getTime() + STAFF_IDLE_DAYS * DAY
  return new Date(Math.min(idle, s.expiresAt.getTime()))
}

/** Starts a cookie session for this login and sets the cookie. */
export async function startStaffSession(req: Request, res: Response, userId: string): Promise<{ sessionId: string }> {
  const value = crypto.randomBytes(32).toString('base64url')
  const now = new Date()
  const session = await prisma.crmUserSession.create({
    data: {
      userId, tokenHash: cookieHash(value), kind: 'cookie', lastUsedAt: now,
      ipAddress: req.ip || req.socket?.remoteAddress || null,
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
      expiresAt: new Date(now.getTime() + STAFF_MAX_DAYS * DAY),
    },
  })
  setCookie(req, res, value, STAFF_IDLE_DAYS * DAY)
  return { sessionId: session.id }
}

/** Ends the session this request's cookie carries (sign out) and clears the cookie. */
export async function endStaffSessionOf(req: Request, res: Response): Promise<boolean> {
  const value = staffCookieOf(req)
  clearStaffCookie(req, res)
  if (!value || value.length > 200) return false
  const r = await prisma.crmUserSession.updateMany({ where: { tokenHash: cookieHash(value), revokedAt: null }, data: { revokedAt: new Date() } })
  return r.count > 0
}

// ── Where a request comes from (read only sessions) ──────────────────────────

const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-forwarded-host', 'x-real-ip', 'tailscale-user-login', 'tailscale-user-name', 'tailscale-funnel-request']
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

/** This machine's own addresses: loopback and every address of its network interfaces (the Tailscale address included). */
export function ownAddresses(): Set<string> {
  const out = new Set(LOOPBACK)
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      out.add(a.address)
      if (a.family === 'IPv4') out.add(`::ffff:${a.address}`)
    }
  }
  return out
}

/**
 * True only for a request made on this machine to this server directly: the
 * connection comes from one of the machine's own addresses (localhost, or its
 * own Tailscale address), it was not passed on by a proxy (Tailscale serve
 * and Funnel connect from localhost but add forwarding headers and keep the
 * public name in Host), and Host names this machine. The socket address is
 * used, never req.ip, which trusts X-Forwarded-For.
 */
export function fromThisMachine(req: Pick<Request, 'headers' | 'socket'>, own: Set<string> = ownAddresses()): boolean {
  const peer = String(req.socket?.remoteAddress || '')
  if (!peer || !own.has(peer)) return false
  for (const h of PROXY_HEADERS) if (req.headers[h] !== undefined) return false
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '')
  return host === 'localhost' || own.has(host)
}

// ── The check on every /api request ──────────────────────────────────────────

const isRead = (m: string) => m === 'GET' || m === 'HEAD' || m === 'OPTIONS'
const jwtSecret = () => resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')

export type CookieRefusal = 'SESSION_ENDED' | 'READ_ONLY_NOT_HERE'

/** The session behind a cookie value, or why it may not be used. */
export async function lookupStaffCookie(value: string, req: Pick<Request, 'headers' | 'socket'>, now = Date.now()): Promise<{ identity: StaffCookieIdentity; lastUsedAt: Date | null; endsAt: Date; maxUntil: Date } | { refusal: CookieRefusal }> {
  if (!value || value.length > 200) return { refusal: 'SESSION_ENDED' }
  const s = await prisma.crmUserSession.findUnique({
    where: { tokenHash: cookieHash(value) },
    select: { id: true, kind: true, readOnly: true, revokedAt: true, expiresAt: true, createdAt: true, lastUsedAt: true,
      user: { select: { id: true, email: true, role: true, status: true, firstName: true, lastName: true, crmAccountId: true } } },
  })
  if (!s || (s.kind !== 'cookie' && s.kind !== 'readonly') || s.revokedAt) return { refusal: 'SESSION_ENDED' }
  const endsAt = sessionEndsAt(s)
  if (endsAt.getTime() <= now) return { refusal: 'SESSION_ENDED' }
  const u = s.user
  if (!u || String(u.status) !== 'active' || ['customer', 'portal_customer'].includes(String(u.role))) return { refusal: 'SESSION_ENDED' }
  const readOnly = s.kind === 'readonly' || s.readOnly
  if (readOnly && !fromThisMachine(req)) return { refusal: 'READ_ONLY_NOT_HERE' }
  return {
    identity: { sub: u.id, email: u.email, role: String(u.role), firstName: u.firstName, lastName: u.lastName, crmAccountId: u.crmAccountId, sid: s.id, sessionId: s.id, readOnly },
    lastUsedAt: s.lastUsedAt, endsAt, maxUntil: s.expiresAt,
  }
}

/**
 * Mounted on /api before the cost hiding and every route (index.ts). A request
 * with a Bearer header is left to the old check (lib/sessionGuard.ts): during
 * the switch window an explicit token decides; with STAFF_COOKIE_ONLY=1 that
 * check refuses it.
 */
export function staffCookieAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS') { next(); return }
  const value = staffCookieOf(req)
  if (!value || String(req.headers.authorization || '').startsWith('Bearer ')) { next(); return }
  lookupStaffCookie(value, req).then(found => {
    if ('refusal' in found) {
      clearStaffCookie(req, res)
      if (found.refusal === 'READ_ONLY_NOT_HERE') {
        console.warn(`[staff-cookie] read only session used away from the Mac: ${req.method} ${req.originalUrl.split('?')[0]} from ${req.socket?.remoteAddress} host=${req.headers.host}`)
        res.status(401).json({ success: false, code: 'READ_ONLY_NOT_HERE', error: 'This read only sign in works only on the Mac itself.' }); return
      }
      // Ended or run out: carry on as not signed in (a public route still answers; the rest say 401).
      next(); return
    }
    const id = found.identity
    if (!isRead(req.method)) {
      if (id.readOnly) { res.status(403).json({ success: false, code: 'READ_ONLY', error: 'This sign in is read only. Nothing can be changed with it.' }); return }
      if (req.headers[STAFF_WRITE_HEADER] !== '1') {
        // Not from the app (another site, or a page of ours that is not the staff app, such as the
        // customer portal in the same browser): the cookie does not count. The request goes on as
        // not signed in, so a staff route answers 401 and nothing is saved as this login.
        console.warn(`[staff-cookie] save without the app header: not signed in for it: ${req.method} ${req.originalUrl.split('?')[0]} user=${id.email}`)
        next(); return
      }
    }
    req.staffCookie = id
    const { sessionId: _s, readOnly: _r, ...claims } = id
    void _s; void _r
    req.headers.authorization = `Bearer ${jwt.sign(claims, jwtSecret(), { expiresIn: '5m' })}`
    noteStaffDevice(req, id.sub, id.crmAccountId)
    const last = found.lastUsedAt?.getTime() ?? 0
    if (Date.now() - last > TOUCH_MS) {
      const now = new Date()
      if (!id.readOnly) setCookie(req, res, value, Math.min(STAFF_IDLE_DAYS * DAY, found.maxUntil.getTime() - now.getTime()))
      prisma.crmUserSession.update({ where: { id: id.sessionId }, data: { lastUsedAt: now } }).catch(() => {})
    }
    next()
  }).catch(err => {
    console.error('[staff-cookie] check failed:', err)
    res.status(503).json({ success: false, error: 'Could not check your sign in. Try again in a moment.' })
  })
}
