/**
 * Devices staff used the app from lately, so a proposal opened on the same
 * device (same address and same browser) can be marked "Staff view" even when
 * the link was opened outside the app (lib/proposalViews.ts).
 *
 * Kept in memory only: a keyed hash of address + browser, the login and when.
 * Filled by the session check on every staff request (sessionGuard.ts). After
 * a restart the sign in sessions in the database (CrmUserSession, address and
 * browser of each sign in) are the fallback.
 */

import crypto from 'crypto'
import type { Request } from 'express'
import { resolveSecret } from './secrets.js'

const KEEP_MS = 24 * 3600_000
const MAX = 5000
const seen = new Map<string, { userId: string; accountId: string | null; at: number }>()

/** A keyed hash (the address is never kept): same input, same hash, on this server only. */
export function keyedHash(value: string): string {
  return crypto.createHmac('sha256', resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')).update(`ezbiz-device:${value}`).digest('base64url').slice(0, 32)
}

export const clientIpOf = (req: Request): string => String(req.ip || req.socket?.remoteAddress || '')
export const deviceKey = (ip: string, ua: string) => keyedHash(`${ip}|${ua}`)

/** A staff request passed the session check: remember its device. */
export function noteStaffDevice(req: Request, userId: string, accountId: string | null | undefined, now = Date.now()): void {
  const ua = String(req.headers['user-agent'] || '')
  if (!ua) return
  if (seen.size > MAX) {
    for (const [k, v] of seen) if (now - v.at > KEEP_MS) seen.delete(k)
    if (seen.size > MAX) seen.clear()
  }
  seen.set(deviceKey(clientIpOf(req), ua), { userId, accountId: accountId ?? null, at: now })
}

/** A staff login that used the app from this address and browser in the last day, or null. */
export function recentStaffOn(ip: string, ua: string, now = Date.now()): { userId: string; accountId: string | null } | null {
  if (!ua) return null
  const hit = seen.get(deviceKey(ip, ua))
  if (!hit || now - hit.at > KEEP_MS) return null
  return { userId: hit.userId, accountId: hit.accountId }
}

/** Tests only. */
export function forgetStaffDevices(): void { seen.clear() }
