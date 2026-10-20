/**
 * Links to customer files (GET /api/portal/files/<key>): an <img> or a
 * download link cannot send a sign in, so each link the server hands out is
 * signed for that one file and runs out after 7 days, the same way photo and
 * video links work (lib/media.ts). A link is only handed out with a list the
 * asker may see: a customer gets links to their own files only, the office to
 * the customer it opened.
 *
 * Until Oct 20, 2026 the route served any file under the upload folder to
 * anyone who knew its path, with no sign in at all. Now only the website
 * intake pictures (intake/, random names, shown in lead emails and the quote
 * widget) are served without a signature; every other file needs one.
 */

import crypto from 'crypto'
import { resolveSecret } from './secrets.js'

const SECRET = process.env.MEDIA_LINK_SECRET || resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')
const TTL_MS = 7 * 86_400_000

/** Keys served without a signature. */
export function isPublicFileKey(fileKey: string): boolean {
  return /^intake\/[^/]+$/.test(fileKey)
}

function sign(fileKey: string, exp: number): string {
  return crypto.createHmac('sha256', SECRET).update(`portal-file.${fileKey}.${exp}`).digest('base64url').slice(0, 32)
}

/** `/api/portal/files/<key>?e=&s=` for this file (rounded to the hour, so the same link comes back for a while). */
export function signedFileUrl(fileKey: string, now = Date.now()): string {
  const exp = Math.ceil((now + TTL_MS) / 3_600_000) * 3_600_000
  return `/api/portal/files/${encodeURIComponent(fileKey)}?e=${exp}&s=${sign(fileKey, exp)}`
}

export function checkFileSig(fileKey: string, e: unknown, s: unknown): boolean {
  if (typeof e !== 'string' || typeof s !== 'string') return false
  const exp = Number(e)
  if (!Number.isFinite(exp) || exp < Date.now()) return false
  const want = sign(fileKey, exp)
  return want.length === s.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))
}
