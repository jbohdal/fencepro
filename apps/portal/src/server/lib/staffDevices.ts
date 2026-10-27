/**
 * Where a request comes from, without keeping the address: a keyed hash, and
 * the client's address as Express gives it.
 *
 * Proposal opens used to be marked "Staff view" when they came from the same
 * address and browser as a staff login. That took a customer at home on the
 * same Wi-Fi and the same iPhone model for the Salesman (audit Oct 26, 2026),
 * so staff are now told apart only by their sign in (lib/staffSession.ts,
 * the staff mark on /p) or the app's own preview link (lib/proposalViews.ts).
 */

import crypto from 'crypto'
import type { Request } from 'express'
import { resolveSecret } from './secrets.js'

/** A keyed hash (the address is never kept): same input, same hash, on this server only. */
export function keyedHash(value: string): string {
  return crypto.createHmac('sha256', resolveSecret('JWT_SECRET', 'dev-crm-jwt-secret-change-me')).update(`ezbiz-device:${value}`).digest('base64url').slice(0, 32)
}

export const clientIpOf = (req: Request): string => String(req.ip || req.socket?.remoteAddress || '')
