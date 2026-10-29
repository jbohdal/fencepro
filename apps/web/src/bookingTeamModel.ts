/**
 * The booking team: who appointments can be with. It is not a list of its own.
 * It is the company's active staff logins (Settings > Team), read from the
 * server (GET /api/appointments/team, apps/portal/src/server/lib/appointmentRep.ts
 * bookingTeam), owner first and the default. bookingTeamStore.ts holds the copy
 * every screen reads. These are the rules for reading it, kept apart from the
 * screens so they can be tested (apps/portal/tests/bookingTeam.test.ts).
 *
 * An appointment keeps its person's login id (assignedToUserId) and name
 * (assignedTo). When that person leaves the team the appointment keeps the
 * name: filters show such names apart, as "Former team members".
 */

import type { LatLng } from './geoUtils'

export interface TeamMember {
  userId: string
  /** "First Last": what appointments store as assignedTo. */
  name: string
  firstName: string
  lastName: string
  /** Direct phone, 10 digits, or null (the texts then give the company phone). */
  phone: string | null
  role: string
  /** The owner: first, and picked for new appointments. */
  isDefault: boolean
}

/** Where a person's day starts (Settings > Appointments), kept by login id. */
export interface PersonHome { homeBase: string; homeLat: number | null; homeLng: number | null }

type Assigned = { assignedTo?: string | null; assignedToUserId?: string | null }

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Only well formed members, in the server's order. */
export function normalizeTeam(data: unknown): TeamMember[] {
  if (!Array.isArray(data)) return []
  return data
    .filter((m: any) => m && typeof m.userId === 'string' && m.userId && typeof m.name === 'string' && m.name.trim())
    .map((m: any) => ({
      userId: m.userId, name: m.name.trim(), firstName: String(m.firstName ?? ''), lastName: String(m.lastName ?? ''),
      phone: m.phone ? String(m.phone) : null, role: String(m.role ?? ''), isDefault: !!m.isDefault,
    }))
}

/** The owner: first on the team. */
export const defaultMemberOf = (team: TeamMember[]): TeamMember | null => team.find(m => m.isDefault) ?? team[0] ?? null

/**
 * The person "With" starts on for a new appointment: whoever is signed in,
 * when they are on the booking team (Christa books for herself); otherwise the owner.
 */
export const newBookingMemberOf = (team: TeamMember[], signedInUserId: string | null | undefined): TeamMember | null =>
  (signedInUserId ? team.find(m => m.userId === signedInUserId) : undefined) ?? defaultMemberOf(team)

/**
 * The team member an appointment is with, or null when that person is not on
 * the team now. The login kept on it decides; a name alone (older appointments)
 * is matched exactly, case and spaces aside.
 */
export function memberOf(team: TeamMember[], a: Assigned): TeamMember | null {
  if (a.assignedToUserId) return team.find(m => m.userId === a.assignedToUserId) ?? null
  const n = norm(a.assignedTo)
  if (!n) return null
  const hits = team.filter(m => norm(m.name) === n)
  return hits.length === 1 ? hits[0] : null
}

/** Names on appointments whose person is not on the team now, sorted. */
export function formerNamesOf(team: TeamMember[], appointments: Assigned[]): string[] {
  const out = new Map<string, string>()
  for (const a of appointments) {
    const name = String(a.assignedTo ?? '').trim()
    if (!name || memberOf(team, a)) continue
    if (!out.has(norm(name))) out.set(norm(name), name)
  }
  return [...out.values()].sort((x, y) => x.localeCompare(y))
}

/**
 * A person filter's value: '' everyone, 'u:<login id>' a team member,
 * 'n:<name>' a former team member.
 */
export const memberKey = (m: TeamMember) => `u:${m.userId}`
export const formerKey = (name: string) => `n:${name}`

export function matchesPerson(team: TeamMember[], a: Assigned, key: string): boolean {
  if (!key) return true
  if (key.startsWith('u:')) return memberOf(team, a)?.userId === key.slice(2)
  if (key.startsWith('n:')) return !memberOf(team, a) && norm(a.assignedTo) === norm(key.slice(2))
  return false
}

/**
 * Who the Visits page (AppointmentsPage) starts on. The Salesman: everyone, which is every appointment the server
 * sends the Salesman (those with the Salesman, and those with the Salesman's own customers booked with someone
 * else; review Oct 28 2026: only the Salesman's own showed). The crew: their own. The office and owner: everyone.
 */
export function visitsStartPerson(role: string | null | undefined, myKey: string): string {
  return role === 'field_crew' ? myKey : ''
}

/** "With Jonathan Bohdal": an appointment the signed in person is not on, or null when it is theirs (or nobody's key is known). */
export function withSomeoneElse(team: TeamMember[], a: Assigned, myKey: string): string | null {
  if (!myKey || matchesPerson(team, a, myKey) || (myKey.startsWith('u:') && a.assignedToUserId === myKey.slice(2))) return null
  const name = memberOf(team, a)?.name ?? String(a.assignedTo ?? '').trim()
  return name ? `With ${name}` : 'With nobody yet'
}

/** Is this appointment with this member (by login, or the same name before logins were kept)? */
export const isWith = (team: TeamMember[], a: Assigned, m: TeamMember | null | undefined) =>
  !!m && memberOf(team, a)?.userId === m.userId

/** A member's home base on the map, from Settings > Appointments (by login id), or null. */
export function homeOf(homes: Record<string, PersonHome> | undefined, m: TeamMember | null | undefined): LatLng | null {
  const h = m ? homes?.[m.userId] : undefined
  return h && h.homeLat != null && h.homeLng != null && Number.isFinite(h.homeLat) && Number.isFinite(h.homeLng) ? { lat: h.homeLat, lng: h.homeLng } : null
}
