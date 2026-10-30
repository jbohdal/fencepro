/**
 * The call back moves with the lead (Jonathan, Oct 29 2026, D7: "Yes, the
 * callback moves with the lead.").
 *
 * A phone lead's call back is an appointment on the customer (type
 * call_back; routes/intake.ts makes it with nobody on it). When the lead is
 * assigned, or moved to someone else, its open call backs go to that person:
 * the appointment's person (assignedTo, the login's full name, and
 * assignedToUserId) is set, so it is on their Today and Appointments, and off
 * the person who had it (it also leaves that Salesman's scope, which counts a
 * customer with an appointment booked with her, lib/salesScope.ts).
 *
 *   - Open: scheduled, confirmed or rescheduled, not archived or deleted.
 *     A finished one (completed, no show, cancelled) or one already under way
 *     (on my way) stays with who had it.
 *   - Every assign path calls this: the Assign screen and the push's buttons
 *     (lib/leadAssign.ts assignLead, routes/lead-assign.ts), and a Sales rep
 *     changed on the customer (routes/crm-contacts.ts).
 *   - A rep name that is not one login (a first name two logins share, a name
 *     typed that is nobody's) moves nothing: no guessing.
 *   - The Salesmen's remembered scopes (lib/salesScope.ts) are forgotten for
 *     the person it went to and the one it left, so both see it at once.
 *   - Each move is a versioned save, as the appointment screen's own: an
 *     appointment changed in between is read again and tried again.
 */

import prisma from './prisma.js'
import { repName, sameName } from './salesRep.js'
import { requestCalendarSync } from './calendarSync/index.js'
import { forgetScope } from './salesScope.js'

export const OPEN_CALLBACK_STATUSES = ['scheduled', 'confirmed', 'rescheduled'] as const

export interface CallbackPerson { id: string; name: string }

/**
 * The login a rep name is, among the active staff logins: the full name
 * ("Christa Feagin"), else a first name ("Christa") only one login has.
 */
export async function loginForRep(accountId: string, rep: string | null | undefined): Promise<CallbackPerson | null> {
  if (!String(rep ?? '').trim()) return null
  const users = await prisma.crmUser.findMany({
    where: { crmAccountId: accountId, status: 'active', role: { not: 'customer' as any } },
    select: { id: true, firstName: true, lastName: true },
  })
  const full = users.filter(u => sameName(repName(u), rep))
  if (full.length === 1) return { id: full[0].id, name: repName(full[0]) }
  if (full.length > 1) return null
  const first = users.filter(u => sameName(u.firstName, rep))
  return first.length === 1 ? { id: first[0].id, name: repName(first[0]) } : null
}

/**
 * Put the customer's open call backs with this person. Returns the ids of the
 * appointments moved (none: nothing open, or all already theirs).
 */
export async function moveCallbacks(accountId: string, contactId: string, to: CallbackPerson): Promise<string[]> {
  const moved: string[] = []
  const name = to.name.replace(/\s+/g, ' ').trim()
  for (let attempt = 0; attempt < 5; attempt++) {
    const open = await prisma.appointment.findMany({
      where: {
        accountId, crmContactId: contactId, type: 'call_back', deletedAt: null, archivedAt: null,
        status: { in: [...OPEN_CALLBACK_STATUSES] },
        OR: [{ assignedToUserId: null }, { assignedToUserId: { not: to.id } }, { assignedTo: { not: name } }],
      },
      select: { id: true, version: true, assignedToUserId: true },
    })
    let raced = false
    for (const a of open) {
      const done = await prisma.appointment.updateMany({
        where: { id: a.id, version: a.version, status: { in: [...OPEN_CALLBACK_STATUSES] } },
        data: { assignedTo: name, assignedToUserId: to.id, version: { increment: 1 } },
      })
      if (done.count === 1) { if (!moved.includes(a.id)) moved.push(a.id); forgetScope(a.assignedToUserId) } else raced = true
    }
    if (!raced) break
  }
  // The scope a Salesman's screens are read with: the person it went to has the customer now, the one it left may not.
  if (moved.length) forgetScope(to.id)
  // Google Calendar shows who it is with: keep it in step (nothing happens when the calendar is not connected).
  if (moved.length) { try { requestCalendarSync(accountId) } catch { /* never affects the assign */ } }
  return moved
}

/**
 * The customer's UPCOMING visits (an estimate or any other booking that is not a call back, not done, cancelled or
 * a no show, starting from now on) that were with the Salesman the customer is moving FROM go to the person it
 * moves to (review, Oct 30 2026: Christa's estimate for a customer moved away stayed on her Today with a Call
 * button, and she could not open the customer). The owner's call, to be confirmed by Jonathan; as D7 moves the
 * call backs. Visits with anyone else (an installer, the owner) and past ones stay as they are.
 */
export async function moveUpcomingVisits(accountId: string, contactId: string, from: CallbackPerson | null, fromName: string, to: CallbackPerson, now = new Date()): Promise<string[]> {
  const was = fromName.replace(/\s+/g, ' ').trim()
  if (!from && !was) return []
  const name = to.name.replace(/\s+/g, ' ').trim()
  const moved: string[] = []
  const rows = await prisma.appointment.findMany({
    where: {
      accountId, crmContactId: contactId, type: { not: 'call_back' }, deletedAt: null, archivedAt: null,
      status: { in: [...OPEN_CALLBACK_STATUSES] }, startAt: { gte: now },
    },
    select: { id: true, version: true, assignedToUserId: true, assignedTo: true },
  })
  for (const a of rows) {
    const withOld = (from && a.assignedToUserId === from.id) || (!a.assignedToUserId && !!was && sameName(a.assignedTo, was)) || (!!was && sameName(a.assignedTo, was) && a.assignedToUserId !== to.id)
    if (!withOld || a.assignedToUserId === to.id) continue
    const done = await prisma.appointment.updateMany({
      where: { id: a.id, version: a.version, status: { in: [...OPEN_CALLBACK_STATUSES] } },
      data: { assignedTo: name, assignedToUserId: to.id, version: { increment: 1 } },
    })
    if (done.count === 1) { moved.push(a.id); forgetScope(a.assignedToUserId) }
  }
  if (moved.length) { forgetScope(to.id); try { requestCalendarSync(accountId) } catch { /* never affects the assign */ } }
  return moved
}

