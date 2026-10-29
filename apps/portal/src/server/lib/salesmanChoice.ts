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
 *     lib/leadAssign.ts assignees), plus the person entering when they are
 *     none of those (an office login), so "whoever is entering it" is there to
 *     be preselected.
 *   - The rep is stored as a name on the customer (CrmContact.salesRep), as
 *     everywhere else; lib/salesScope.ts reads it.
 *   - A new customer saved with no rep is the entering person's (any role).
 *     The CSV import asks for no default (its rows keep the file's rep).
 *   - Once saved, only the owner, admin, manager and office change it (the
 *     customer page, through POST /api/lead-assign/:id, which also moves the
 *     open cards and writes a History line). A Salesman's change is refused
 *     with words that say so.
 */

import prisma from './prisma.js'
import { assignees, canAssignLeads } from './leadAssign.js'
import { repName, sameName, SALESMAN_ROLE } from './salesRep.js'

export interface SalesmanChoice { id: string; name: string; role: string; me: boolean }

/** The signed in person's name as a rep is written ("Christa Feagin"), else their login email. */
export async function enteringName(userId: string | null | undefined): Promise<string> {
  if (!userId) return ''
  const u = await prisma.crmUser.findUnique({ where: { id: String(userId) }, select: { firstName: true, lastName: true, email: true } }).catch(() => null)
  return u ? (repName(u) || u.email) : ''
}

/** The Salesman choice for this person: the owner and Salesmen, with the person entering marked `me`. */
export async function salesmanChoices(accountId: string, userId: string, role: string | null): Promise<{ choices: SalesmanChoice[]; mine: string; canChange: boolean }> {
  const people = await assignees(accountId)
  const choices: SalesmanChoice[] = people.map(p => ({ id: p.id, name: p.name, role: p.role, me: p.id === userId }))
  const mine = await enteringName(userId)
  if (!choices.some(c => c.me) && mine) {
    choices.push({ id: userId, name: mine, role: String(role ?? ''), me: true })
  }
  return { choices, mine, canChange: canAssignLeads(role) }
}

/** Would this change of a customer's rep be a change (not the same name sent again)? */
export function repChanges(before: string | null | undefined, sent: string | null | undefined): boolean {
  if (sent === undefined || sent === null) return false
  const a = (before ?? '').trim()
  const b = sent.trim()
  if (!a && !b) return false
  return !sameName(a, b)
}

export const SALESMAN_CHANGE_REFUSED = "Only the owner or the office can change a customer's Salesman. Nothing was saved; ask the office to change it."

export const isSalesmanRole = (role: string | null | undefined): boolean => role === SALESMAN_ROLE
