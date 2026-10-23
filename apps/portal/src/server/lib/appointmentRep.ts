/**
 * Who an appointment is with, as a login: the person whose Direct phone
 * (CrmUser.phone, Settings > Team) goes in the appointment texts as
 * {rep_phone} (apps/web/src/appointmentMessages.ts).
 *
 * An appointment is booked with a login from the booking team (bookingTeam
 * below: the active staff logins of Settings > Team) and keeps both its id
 * (assignedToUserId) and its name (assignedTo, for history). A name sent alone
 * (an older phone's queued booking) is matched to a login only exactly, as
 * the card owner is (serviceTickets.ts cardOwnerOf): the login's full name
 * ("First Last"), case and spaces aside. A first name alone, a near miss, or
 * two logins with the same full name is never a match: no guessing. The match
 * is kept on the appointment (assignedToUserId) when it is booked or its
 * person changes; an appointment saved before that is matched when it is read.
 *
 * Deleted and switched off logins are not matched: the text then gives the
 * company phone and the Booked window says why.
 */

import prisma from './prisma.js'

export interface StaffLogin { id: string; firstName: string; lastName: string; phone: string | null; status: string; role?: string }
/** What the browser gets on each appointment (`rep`). Phone as saved (digits); the browser formats it. */
export interface RepInfo { userId: string; firstName: string; lastName: string; phone: string | null }

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const usable = (u: StaffLogin) => u.status !== 'deleted' && u.status !== 'deactivated'

/** The company's staff logins (not customer portal logins), oldest first. */
export async function staffLogins(accountId: string): Promise<StaffLogin[]> {
  const rows = await prisma.crmUser.findMany({
    where: { crmAccountId: accountId, role: { not: 'customer' as any } },
    select: { id: true, firstName: true, lastName: true, phone: true, status: true, role: true },
    orderBy: { createdAt: 'asc' },
  })
  return rows.map(r => ({ ...r, status: String(r.status), role: String(r.role) }))
}

/* ── The booking team ───────────────────────────────────────────────────────
 * Who appointments can be with: the company's active staff logins (Settings >
 * Team). Not a list of its own: anyone added in Team is on it at once, anyone
 * switched off, suspended or deleted is off it at once. An invited login joins
 * when the invite is accepted (it is "invited" until then, not active).
 * The owner (the first super_admin) comes first and is the default; the rest
 * by name. Appointments keep the name they were booked with (assignedTo), so
 * a past appointment still shows its person after that person leaves.
 */

/** Statuses and roles that can be booked. */
export const BOOKABLE_STATUS = 'active'
export const STAFF_ROLES = ['super_admin', 'admin', 'manager', 'sales_rep', 'field_crew', 'office_staff'] as const

export interface TeamMember {
  userId: string
  /** "First Last": what appointments store as assignedTo. */
  name: string
  firstName: string
  lastName: string
  /** Direct phone (10 digits) or null: the texts then give the company phone. */
  phone: string | null
  role: string
  /** The owner: first in the list and picked for new appointments. */
  isDefault: boolean
}

const fullName = (u: { firstName: string; lastName: string }) => `${u.firstName || ''} ${u.lastName || ''}`.replace(/\s+/g, ' ').trim()

/** The booking team from the logins (oldest first, as staffLogins gives them). Pure, for tests. */
export function bookingTeamOf(staff: StaffLogin[]): TeamMember[] {
  const ok = staff.filter(u => u.status === BOOKABLE_STATUS && (STAFF_ROLES as readonly string[]).includes(String(u.role)) && fullName(u))
  const owner = ok.find(u => u.role === 'super_admin') ?? ok[0]
  const rest = ok.filter(u => u !== owner).sort((a, b) => fullName(a).localeCompare(fullName(b)))
  return (owner ? [owner, ...rest] : []).map(u => ({
    userId: u.id, name: fullName(u), firstName: u.firstName, lastName: u.lastName, phone: u.phone || null, role: String(u.role), isDefault: u === owner,
  }))
}

/** The company's booking team, read now (so a change in Team shows on the next read). */
export async function bookingTeam(accountId: string): Promise<TeamMember[]> {
  return bookingTeamOf(await staffLogins(accountId))
}

/** The member with this login id, when it can be booked now. */
export async function bookableMember(accountId: string, userId: string): Promise<TeamMember | null> {
  return (await bookingTeam(accountId)).find(m => m.userId === userId) ?? null
}

/** The one login whose full name is exactly this name, or null. */
export function loginByName(staff: StaffLogin[], name: unknown): StaffLogin | null {
  const n = norm(name)
  if (!n) return null
  const hits = staff.filter(u => usable(u) && norm(`${u.firstName} ${u.lastName}`) === n)
  return hits.length === 1 ? hits[0] : null
}

/** The login an appointment is with: the one kept on it, else its name matched exactly. */
export function repOf(staff: StaffLogin[], a: { assignedTo?: string | null; assignedToUserId?: string | null }): RepInfo | null {
  const kept = a.assignedToUserId ? staff.find(u => u.id === a.assignedToUserId) : null
  // The kept login still carries this name (a renamed login or a changed name is matched again).
  const u = kept && usable(kept) && norm(`${kept.firstName} ${kept.lastName}`) === norm(a.assignedTo) ? kept : loginByName(staff, a.assignedTo)
  return u ? { userId: u.id, firstName: u.firstName, lastName: u.lastName, phone: u.phone || null } : null
}

/** The id to keep on an appointment for this name (null: no single login has it). */
export async function assignedUserIdFor(accountId: string, assignedTo: string | null | undefined): Promise<string | null> {
  if (!norm(assignedTo)) return null
  return loginByName(await staffLogins(accountId), assignedTo)?.id ?? null
}

/** Each appointment with its `rep` (one look at the logins for the whole list). */
export async function withReps<T extends { assignedTo?: string | null; assignedToUserId?: string | null }>(accountId: string, rows: T[]): Promise<Array<T & { rep: RepInfo | null }>> {
  const staff = rows.length ? await staffLogins(accountId) : []
  return rows.map(r => ({ ...r, rep: repOf(staff, r) }))
}

/**
 * A Direct phone as typed ("352-844-2677", "(352) 844 2677", "+1 352...") kept
 * as its 10 digits; empty clears it. Anything else is refused with a plain
 * reason (the texts must carry a number that works).
 */
export function normalizeDirectPhone(raw: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  const s = String(raw ?? '').trim()
  if (!s) return { ok: true, value: null }
  let d = s.replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  if (d.length !== 10 || /[a-z]/i.test(s)) return { ok: false, error: 'Enter a 10 digit phone number, like (352) 555 0100.' }
  return { ok: true, value: d }
}
