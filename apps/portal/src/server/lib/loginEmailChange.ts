/**
 * The owner changes a team member's login email (Jonathan, Oct 30 2026: "The
 * app wouldn't let me change a team member's email. Let me (owner only) change
 * it on the Team page, so next time I don't need a second account.").
 *
 *   - Who: the owner only (lib/salesmanChoice.ts isOwnerLogin: a super_admin,
 *     else the oldest admin when there is none). Anyone else gets a 403.
 *   - The new email is trimmed and lower-cased, as a login is stored and looked
 *     up (routes/crm-auth.ts login). One already used by another login, of
 *     any status, is refused without saying whose it is.
 *   - Most of the app knows a person by login id (sessions, push sign ups,
 *     follow ups, pending calls), which needs nothing. A few places keep the
 *     login's email as text; every one of them that holds exactly the old
 *     email moves to the new one in the same transaction, so the person keeps
 *     their bell notices, tasks, leads and the "who" on what they did:
 *     EMAIL_KEYED_COLUMNS below, and the EZ Budget notification email.
 *   - Kept as it was: history (CrmAuditLog, CrmUserActivity, DeletionLog,
 *     ActivityLog bodies), customers' own emails (a customer card that happens
 *     to carry the same address is a customer's, not the login's) and the
 *     Google account a calendar is connected with.
 *   - Sessions are by login id and every request reads the login again
 *     (lib/staffSession.ts), so the person stays signed in; the password stays
 *     the same and the next sign in is with the new email. Nothing is emailed.
 */

import { z } from 'zod'
import prisma from './prisma.js'

/** [Prisma model, column] pairs that hold a staff login's email as text. */
export const EMAIL_KEYED_COLUMNS: ReadonlyArray<readonly [string, string]> = [
  ['lead', 'assignedRepEmail'],
  ['crmAccount', 'assignedRepEmail'],
  ['notification', 'recipientId'],
  ['task', 'assignedTo'],
  ['task', 'createdBy'],
  ['activityLog', 'actor'],
  ['appointment', 'assignedTo'],
  ['appointment', 'createdBy'],
  ['automation', 'createdBy'],
  ['automationRule', 'createdBy'],
  ['permit', 'updatedBy'],
  ['crmContactNote', 'createdBy'],
  ['changeOrder', 'createdBy'],
  ['vendorBill', 'createdBy'],
  ['plManualEntry', 'createdBy'],
  ['importBatch', 'createdBy'],
  ['apiKey', 'createdBy'],
  ['accountKeyValue', 'updatedBy'],
  ['followUpSettings', 'updatedBy'],
  ['warrantyUpdate', 'createdBy'],
  ['paymentSchedule', 'createdBy'],
  ['serviceTicket', 'createdBy'],
]

export const EMAIL_IN_USE = 'Another team member already uses that email.'
export const OWNER_ONLY = "Only the owner can change a team member's email."

/** A login email as it is stored: trimmed, lower case, a proper address. */
export function normalizeLoginEmail(raw: unknown): { ok: true; value: string } | { ok: false; error: string } {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return { ok: false, error: 'Type the new email.' }
  if (!z.string().email().max(254).safeParse(value).success) return { ok: false, error: 'That is not an email address. Check it and try again.' }
  return { ok: true, value }
}

export type EmailChange =
  | { ok: true; changed: boolean; oldEmail: string; newEmail: string; moved: Record<string, number> }
  | { ok: false; status: number; error: string }

/**
 * Change one login's email and every email-keyed reference to it, in one
 * transaction. The caller checks who may do it; this checks the address.
 */
export async function changeLoginEmail(userId: string, rawEmail: unknown): Promise<EmailChange> {
  const email = normalizeLoginEmail(rawEmail)
  if (!email.ok) return { ok: false, status: 400, error: email.error }
  const newEmail = email.value
  return prisma.$transaction(async tx => {
    const user = await tx.crmUser.findUnique({ where: { id: userId }, select: { id: true, email: true } })
    if (!user) return { ok: false as const, status: 404, error: 'Login not found' }
    const oldEmail = user.email
    if (oldEmail.toLowerCase() === newEmail) {
      // Same address (perhaps typed in capitals once): stored lower case, nothing else moves.
      if (oldEmail !== newEmail) await tx.crmUser.update({ where: { id: userId }, data: { email: newEmail } })
      return { ok: true as const, changed: false, oldEmail, newEmail, moved: {} }
    }
    const taken = await tx.crmUser.findFirst({ where: { id: { not: userId }, email: { equals: newEmail, mode: 'insensitive' } }, select: { id: true } })
    if (taken) return { ok: false as const, status: 409, error: EMAIL_IN_USE }
    await tx.crmUser.update({ where: { id: userId }, data: { email: newEmail } })
    const moved: Record<string, number> = {}
    for (const [model, column] of EMAIL_KEYED_COLUMNS) {
      const r = await (tx as any)[model].updateMany({ where: { [column]: { equals: oldEmail, mode: 'insensitive' } }, data: { [column]: newEmail } })
      if (r.count) moved[`${model}.${column}`] = r.count
    }
    // EZ Budget's notification email (one setting for the install), when it was this login's.
    const nt = await tx.ezBudgetSettings.findUnique({ where: { key: 'notifications' } })
    const v = nt?.value as Record<string, unknown> | null | undefined
    if (v && typeof v === 'object' && typeof v.notificationEmail === 'string' && v.notificationEmail.trim().toLowerCase() === oldEmail.toLowerCase()) {
      await tx.ezBudgetSettings.update({ where: { key: 'notifications' }, data: { value: { ...v, notificationEmail: newEmail } as any } })
      moved['ezBudgetSettings.notifications'] = 1
    }
    return { ok: true as const, changed: true, oldEmail, newEmail, moved }
  }, { timeout: 15_000 })
}
