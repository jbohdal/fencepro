/**
 * What a tap on a person on the Assign screen (AssignLeadPage.tsx) does. Pure, so the tests read it.
 * Review Oct 28 2026: a lead someone already had moved to another person at one tap; now it asks first.
 */

import type { AssignChoice, LeadRep } from './leadAssign'

const nameKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
/** The person who already has the lead: their full name, or their first name alone ("Christa"), as the server reads a rep. */
export const isRepOf = (c: AssignChoice, rep: LeadRep | null | undefined): boolean =>
  !!rep && (nameKey(c.name) === nameKey(rep.name) || nameKey(c.name).split(' ')[0] === nameKey(rep.name))

/** What a tap on a person does: assign at once (nobody has it), nothing (they have it already), or ask first (someone else has it). */
export function tapDecision(c: AssignChoice, rep: LeadRep | null | undefined): 'assign' | 'theirs' | 'ask' {
  if (!rep) return 'assign'
  return isRepOf(c, rep) ? 'theirs' : 'ask'
}
