/**
 * Customer portal sign ins: a server side session in an httpOnly cookie
 * (Jonathan, Oct 20, 2026: "no sign in or business data in browser storage,
 * same as the rest of the app").
 *
 * Until then the portal kept a 15 minute JWT and a refresh token in the
 * browser's storage and sent them as a Bearer header; the server could not end
 * a sign in, and the token named its customer, so a token made with the
 * signing secret could read anyone's files.
 *
 * Now:
 *   - Signing in (password, or setting one on the invite link) makes a
 *     PortalSession row and sets the cookie `ezbiz_portal` to a random 32 byte
 *     token. The row keeps only its SHA-256. The page's script never sees it
 *     (HttpOnly), it is sent only to the portal's API (Path: /api/portal, or
 *     /p/portal/api when signed in through the public door, routes/portalPublic.ts), never from another
 *     site (SameSite=Strict), and only over https (Secure; plain http is let
 *     through only for localhost, the developer's own machine).
 *   - Every portal request looks the session up: not signed out, not run out
 *     (30 days), the login still active, and it names a customer. The
 *     customer comes from the login row on the server, never from the browser.
 *   - Writes also need the header `X-Portal-Request: 1`. A form or image on
 *     another site cannot send a custom header, and a script there needs a
 *     CORS preflight the server refuses, so with SameSite=Strict a page
 *     elsewhere cannot make a signed in customer's browser change anything.
 *     (The staff app sends its sign in as a header, which a page elsewhere
 *     cannot do either; this is the cookie equivalent.)
 *   - Ended by: Sign out (this session), the office revoking the login (all),
 *     a password change (all but the one that changed it), the login being
 *     suspended (checked on every request).
 */

import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import prisma from './prisma.js'

export const PORTAL_COOKIE = 'ezbiz_portal'
export const PORTAL_COOKIE_PATH = '/api/portal'
/** The portal's API through the public door (routes/portalPublic.ts); its cookie is sent only there. */
export const PUBLIC_PORTAL_API = '/p/portal/api'

/** The cookie's Path for this request: the door it came through. */
export function portalCookiePath(req: Pick<Request, 'baseUrl'>): string {
  return String(req.baseUrl || '').startsWith(PUBLIC_PORTAL_API) ? PUBLIC_PORTAL_API : PORTAL_COOKIE_PATH
}
export const PORTAL_SESSION_DAYS = 30
export const PORTAL_WRITE_HEADER = 'x-portal-request'
const TOUCH_MS = 5 * 60_000

export interface PortalIdentity { id: string; email: string; crmCustomerId: string; sessionId: string }

export function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex')
}

/** The cookie's value from the request (no cookie parser is installed). */
export function portalCookieOf(req: Pick<Request, 'headers'>): string {
  const raw = String(req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(`${PORTAL_COOKIE}=`))
  if (!raw) return ''
  try { return decodeURIComponent(raw.slice(PORTAL_COOKIE.length + 1)) } catch { return '' }
}

/** Plain http is allowed only on this machine (the dev server); everywhere else the cookie is https only. */
function secureFor(req: Request): boolean {
  const host = String(req.hostname || '').toLowerCase()
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  return req.secure || !local
}

/** Starts a session for this login and sets the cookie. */
export async function startPortalSession(req: Request, res: Response, portalAccountId: string): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url')
  await prisma.portalSession.create({
    data: {
      portalAccountId, tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + PORTAL_SESSION_DAYS * 86_400_000),
      ip: req.ip ?? null, userAgent: String(req.headers['user-agent'] ?? '').slice(0, 300) || null,
    },
  })
  res.cookie(PORTAL_COOKIE, token, {
    httpOnly: true, secure: secureFor(req), sameSite: 'strict', path: portalCookiePath(req),
    maxAge: PORTAL_SESSION_DAYS * 86_400_000,
  })
}

export function clearPortalCookie(req: Request, res: Response): void {
  res.clearCookie(PORTAL_COOKIE, { httpOnly: true, secure: secureFor(req), sameSite: 'strict', path: portalCookiePath(req) })
}

/** The signed in customer for this request, or null (no cookie, unknown, ended, run out, login not active, no customer). */
export async function portalIdentityOf(req: Pick<Request, 'headers'>): Promise<PortalIdentity | null> {
  const token = portalCookieOf(req)
  if (!token || token.length > 200) return null
  const s = await prisma.portalSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: { account: { select: { id: true, email: true, crmCustomerId: true, status: true } } },
  })
  if (!s || s.revokedAt || s.expiresAt.getTime() <= Date.now()) return null
  const a = s.account
  if (!a || a.status !== 'active' || typeof a.crmCustomerId !== 'string' || !a.crmCustomerId.trim()) return null
  if (Date.now() - s.lastSeenAt.getTime() > TOUCH_MS) {
    await prisma.portalSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {})
  }
  return { id: a.id, email: a.email, crmCustomerId: a.crmCustomerId, sessionId: s.id }
}

const isRead = (m: string) => m === 'GET' || m === 'HEAD'

/** Route guard: a live portal session, and the write header on anything but a read. */
export function requirePortalAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isRead(req.method) && req.headers[PORTAL_WRITE_HEADER] !== '1') {
    res.status(403).json({ success: false, error: 'FORBIDDEN' }); return
  }
  portalIdentityOf(req).then(who => {
    if (!who) { res.status(401).json({ success: false, error: 'INVALID_CREDENTIALS' }); return }
    ;(req as any).portalAccount = who
    next()
  }).catch(err => {
    console.error('[portal-session] check failed:', err)
    res.status(503).json({ success: false, error: 'Could not check your sign in. Try again in a moment.' })
  })
}

/** Ends every session of a login, or all but one. Returns how many ended. */
export async function revokePortalSessions(portalAccountId: string, exceptSessionId?: string): Promise<number> {
  const r = await prisma.portalSession.updateMany({
    where: { portalAccountId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  })
  return r.count
}

/** Ends the session this request carries (sign out). */
export async function endPortalSessionOf(req: Request): Promise<void> {
  const token = portalCookieOf(req)
  if (!token || token.length > 200) return
  await prisma.portalSession.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } })
}
