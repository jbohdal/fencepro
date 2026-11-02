/**
 * Checking a signed in person's password again: every place that does shares
 * one limit, so guesses cannot be spread between them. A signed in session on a
 * stolen phone must not be a way to find out the password.
 *
 * Every wrong try and every refusal goes in AuditLog (never the password), and
 * the limit is counted from there, so it outlives a restart: 5 wrong in 15
 * minutes and the right password is refused too until the window has passed.
 * Separate from the sign in's lockout, so tries here cannot lock him out of
 * signing in. One check at a time per login: tries side by side would all pass
 * the count before any was written.
 */

import bcrypt from 'bcryptjs'
import prisma from './prisma.js'

export const PASSWORD_WRONG_MAX = 5
export const PASSWORD_WRONG_WINDOW_MS = 15 * 60_000

export type PasswordTry = { ok: true } | { ok: false; status: number; code: string; error: string; left?: number; justStopped?: boolean }

export async function auditPassword(req: any, action: string, userId: string, extra: Record<string, unknown> = {}) {
  await prisma.auditLog.create({ data: { action, metadata: { userId, ...extra }, ipAddress: req?.ip || null, userAgent: String(req?.headers?.['user-agent'] ?? '').slice(0, 300) || null } })
}

const wrongTries = (userId: string, since: Date) => prisma.auditLog.count({
  where: { action: 'password_wrong', createdAt: { gte: since }, metadata: { path: ['userId'], equals: userId } },
})

const STOPPED = 'Too many wrong tries. Stopped for 15 minutes.'
const checking = new Set<string>()

/** Is this the login's password? `source` says who asked, in the audit log. */
export async function tryPassword(req: any, user: { id: string; passwordHash: string | null }, password: string, source: string, now = Date.now()): Promise<PasswordTry> {
  if (!user.passwordHash) return { ok: false, status: 403, code: 'NO_PASSWORD', error: 'This login has no password.' }
  if (checking.has(user.id)) return { ok: false, status: 429, code: 'PASSWORD_BUSY', error: 'One try at a time.' }
  checking.add(user.id)
  try {
    const since = new Date(now - PASSWORD_WRONG_WINDOW_MS)
    if (await wrongTries(user.id, since) >= PASSWORD_WRONG_MAX) {
      await auditPassword(req, 'password_refused', user.id, { source, why: 'too many wrong tries' })
      return { ok: false, status: 429, code: 'PASSWORD_STOPPED', error: STOPPED }
    }
    if (await bcrypt.compare(password, user.passwordHash)) return { ok: true }
    await auditPassword(req, 'password_wrong', user.id, { source })
    const left = PASSWORD_WRONG_MAX - await wrongTries(user.id, since)
    if (left <= 0) return { ok: false, status: 429, code: 'PASSWORD_STOPPED', error: STOPPED, justStopped: true }
    return { ok: false, status: 403, code: 'WRONG_PASSWORD', error: `That password is not right. ${left} tr${left === 1 ? 'y' : 'ies'} left.`, left }
  } finally { checking.delete(user.id) }
}
