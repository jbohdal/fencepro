/**
 * The Salesman choice on a new customer or lead (Jonathan, Oct 28 2026):
 * "when anyone enters a new client or lead (Add lead, New Customer, the
 * quote's customer step), there's a "Salesman" choice: me, Christa or any
 * other Salesman. It defaults to whoever is entering it. The chosen salesman
 * sees that customer right away. [...] I can change a customer's salesman
 * anytime from the customer page."
 *
 *   - The choices: the owner and admins, then every active Salesman login, by
 *     name (the same people a website or phone lead can be assigned to,
 *     lib/leadAssign.ts assignees).
 *   - Who it starts on (Jonathan, Oct 29 2026, D4: "Office entries default to
 *     me, and the Salesman choice lets the office pick someone else."): the
 *     person entering when they are one of the choices (the owner, an admin,
 *     a Salesman); anyone else (the office, a manager) starts on the owner,
 *     the oldest active super_admin login (else the oldest admin), found by
 *     role, never by name. With no owner login it is the person entering.
 *   - The rep is stored as a name on the customer (CrmContact.salesRep), as
 *     everywhere else; lib/salesScope.ts reads it.
 *   - A new customer saved with no rep gets that same default (the Salesman:
 *     the Salesman; the office: the owner). The CSV import asks for no
 *     default (its rows keep the file's rep).
 *   - Once saved, only the owner changes it (Jonathan, Oct 29 2026: "lets me
 *     (owner only) change the salesman from the customer page AND from a
 *     single quote [...] Christa can't change it."). The owner is found by
 *     role as D4 finds him: a super_admin login, else (no super_admin) the
 *     oldest active admin. The customer page's Change (POST
 *     /api/lead-assign/:id, which also moves the open cards, open quotes and
 *     call backs and writes a History line) and one quote's or job's Salesman
 *     (lib/salesmanMove.ts) are the owner's. The office still picks the
 *     Salesman when entering a customer (D4) and still assigns a lead nobody
 *     has yet (the one tap Assign). A Salesman's, Installer's, office's or
 *     manager's change of a Salesman already on file is refused in words that
 *     say so (403); an everyday save that only carries an older copy's
 *     Salesman saves the rest and keeps the Salesman on file
 *     (routes/crm-contacts.ts, saved-quotes.ts, saved-jobs.ts).
 */

import prisma from './prisma.js'
import { assignees, type Assignee } from './leadAssign.js'
import { staffRoleOf } from './costRedact.js'
import { repName, sameName, SALESMAN_ROLE } from './salesRep.js'

export interface SalesmanChoice { id: string; name: string; role: string; me: boolean; preselected: boolean }

/** The signed in person's name as a rep is written ("Christa Feagin"), else their login email. */
export async function enteringName(userId: string | null | undefined): Promise<string> {
  if (!userId) return ''
  const u = await prisma.crmUser.findUnique({ where: { id: String(userId) }, select: { firstName: true, lastName: true, email: true } }).catch(() => null)
  return u ? (repName(u) || u.email) : ''
}

/**
 * Who the choice starts on for this person (D4): themselves when they are one of the choices (owner, admin,
 * Salesman), else the owner (super_admin first, then admin, oldest first: assignees' order). Null: nobody to
 * start on (no owner login and the person is not a choice).
 */
export function preselectFor(people: Assignee[], userId: string): Assignee | null {
  return people.find(p => p.id === userId) ?? people.find(p => p.role === 'super_admin') ?? people.find(p => p.role === 'admin') ?? null
}

/** The Sales rep a new customer saved with none gets: the choice's starting name (D4), else the person entering. */
export async function defaultRepFor(accountId: string, userId: string | null | undefined): Promise<string> {
  if (!userId) return ''
  const start = preselectFor(await assignees(accountId), String(userId))
  return start?.name || await enteringName(userId)
}

/**
 * The Salesman choice for this person: the owner and Salesmen, the person entering marked `me`, the one the
 * choice starts on marked `preselected` (D4: the office starts on the owner). With no owner login, an office
 * login is added as itself so the choice has someone to start on.
 */
export async function salesmanChoices(accountId: string, userId: string, role: string | null): Promise<{ choices: SalesmanChoice[]; mine: string; preselect: string; canChange: boolean }> {
  const people = await assignees(accountId)
  const start = preselectFor(people, userId)
  const choices: SalesmanChoice[] = people.map(p => ({ id: p.id, name: p.name, role: p.role, me: p.id === userId, preselected: p.id === start?.id }))
  const mine = await enteringName(userId)
  if (!start && mine) choices.push({ id: userId, name: mine, role: String(role ?? ''), me: true, preselected: true })
  return { choices, mine, preselect: start?.name || mine, canChange: await isOwnerLogin(accountId, userId, role, people) }
}

/**
 * Is this login the owner, who alone changes a Salesman once entered? By role, as D4 finds the owner: any
 * super_admin; an admin only when the company has no active super_admin and this admin is the oldest one.
 */
export async function isOwnerLogin(accountId: string, userId: string | null | undefined, role: string | null | undefined, people?: Assignee[]): Promise<boolean> {
  if (!userId) return false
  if (role === 'super_admin') return true
  if (role !== 'admin') return false
  const list = people ?? await assignees(accountId)
  if (list.some(p => p.role === 'super_admin')) return false
  return list.find(p => p.role === 'admin')?.id === String(userId)
}

/** The owner check for a request: the staff login's role (lib/costRedact.ts staffRoleOf), else the token's. */
export const requestIsOwner = (req: any): Promise<boolean> =>
  isOwnerLogin(String(req.user?.crmAccountId ?? ''), req.user?.id, staffRoleOf(req) ?? req.user?.role ?? null)

/** Would this change of a customer's rep be a change (not the same name sent again)? */
export function repChanges(before: string | null | undefined, sent: string | null | undefined): boolean {
  if (sent === undefined || sent === null) return false
  const a = (before ?? '').trim()
  const b = sent.trim()
  if (!a && !b) return false
  return !sameName(a, b)
}

export const SALESMAN_CHANGE_REFUSED = "Only the owner can change a customer's Salesman. Nothing was saved; ask the owner to change it."

/** The words of every other refused change of a Salesman on file (the office, a manager, the Installer). */
export const OWNER_ONLY_SALESMAN = 'Only the owner can change the Salesman once it is entered. Nothing was changed.'

export const isSalesmanRole = (role: string | null | undefined): boolean => role === SALESMAN_ROLE
