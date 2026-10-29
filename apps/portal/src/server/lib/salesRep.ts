/**
 * Who sold it: the sales rep on a quote and its job (walkthrough, Oct 24,
 * 2026). Christa's quotes showed "—" because a quote took its rep only from
 * the customer record, which is blank for most customers. The rep is the
 * name the reports, job costing and commission group by.
 *
 *   - A quote a Salesman saves with no rep is hers: the server writes her
 *     name (first and last, as on her login), whichever phone sent it.
 *   - A job with no rep takes its quote's.
 *   - Old records (scripts/backfill-sales-rep.ts): a quote with no rep that a
 *     Salesman made (its ownerId), or whose pipeline card names her as the
 *     card's rep; a job with no rep whose quote is hers.
 *
 * The rep is a name only: it never changes a price (hasSalesman, the
 * commission switch that is part of the price, is left as the quote has it).
 */

import prisma from './prisma.js'
import { roleOf } from './permissions.js'

export const SALESMAN_ROLE = 'sales_rep'

/** Every lead assignment note starts with this (lib/leadAssign.ts); the History shows it as "Lead assigned". */
export const ASSIGN_NOTE_PREFIX = 'Lead assigned to '

/** Every History line of one quote's or job's Salesman change starts with this (lib/salesmanMove.ts); shown as "Salesman changed". */
export const SALESMAN_MOVED_NOTE_PREFIX = 'Salesman on '
/** Is this History line one of those (and not a typed note that happens to start the same way)? */
export const isSalesmanMovedNote = (body: string): boolean =>
  body.startsWith(SALESMAN_MOVED_NOTE_PREFIX) && / changed from .+ to .+ by .+\(/.test(body) && body.endsWith("The customer's own Salesman is unchanged.")

export const repName = (u: { firstName?: string | null; lastName?: string | null }): string =>
  `${u.firstName ?? ''} ${u.lastName ?? ''}`.replace(/\s+/g, ' ').trim()

const blank = (s: string | null | undefined) => !s || !s.trim()

/** Names are compared without case or extra spaces ("Christa " = "christa"). */
export const sameName = (a: string | null | undefined, b: string | null | undefined): boolean =>
  !blank(a) && !blank(b) && a!.replace(/\s+/g, ' ').trim().toLowerCase() === b!.replace(/\s+/g, ' ').trim().toLowerCase()

/**
 * The rep a save should carry: what was sent, or, when that is blank and the
 * login is a Salesman saving her own record (or a new one), her name.
 */
export async function repForSave(req: any, sent: string | null | undefined, ownerId?: string | null): Promise<string | undefined> {
  if (!blank(sent)) return sent!
  if (roleOf(req) !== SALESMAN_ROLE) return sent ?? undefined
  if (ownerId && ownerId !== req.user?.id) return sent ?? undefined
  const u = await prisma.crmUser.findUnique({ where: { id: req.user.id }, select: { firstName: true, lastName: true } }).catch(() => null)
  return (u && repName(u)) || (sent ?? undefined)
}

// ── Old records (the backfill) ──────────────────────────────────────────────

export interface RepLogin { id: string; firstName: string; lastName: string }
export interface RepQuote { id: string; ownerId: string | null; crmContactId: string | null; salesRep: string; customerName: string; status: string }
export interface RepJob { id: string; quoteId: string | null; crmContactId: string | null; salesRep: string; customerName: string; status?: string }
/** A pipeline card: its rep (assignedRep), its customer and the quote it is for. */
export interface RepCard { quoteId?: string | null; customerId?: string | null; assignedRep?: string | null }
/** A customer: their rep and who entered them. */
export interface RepContact { id: string; salesRep: string | null; ownerId: string | null }

export interface RepFix { kind: 'quote' | 'job'; id: string; customerName: string; status?: string; current: string; rep: string; why: string }

/**
 * Which quotes and jobs with no rep a Salesman is credited on, and why.
 * A record that already names a rep is never changed. In order:
 *   quote: she made it (ownerId); its pipeline card names her (by quote, else
 *   by customer); the customer's rep is her; she entered the customer.
 *   job: its quote names her (or is credited to her above); then the same
 *   customer checks.
 */
export function pickRepBackfill(input: { salesmen: RepLogin[]; quotes: RepQuote[]; jobs: RepJob[]; cards: RepCard[]; contacts: RepContact[] }): RepFix[] {
  const byId = new Map(input.salesmen.map(s => [s.id, s]))
  const byName = (name: string | null | undefined) => blank(name) ? undefined : input.salesmen.find(s => sameName(repName(s), name) || sameName(s.firstName, name))
  const cardByQuote = new Map<string, string>()
  const cardByCustomer = new Map<string, string>()
  for (const c of input.cards) {
    if (blank(c.assignedRep)) continue
    if (c.quoteId) cardByQuote.set(c.quoteId, c.assignedRep!)
    if (c.customerId && !cardByCustomer.has(c.customerId)) cardByCustomer.set(c.customerId, c.assignedRep!)
  }
  const contacts = new Map(input.contacts.map(c => [c.id, c]))
  /** Her customer: the card, the customer's rep, or she entered them. */
  const viaCustomer = (contactId: string | null): { who: RepLogin; why: string } | null => {
    if (!contactId) return null
    const card = byName(cardByCustomer.get(contactId))
    if (card) return { who: card, why: 'her pipeline card' }
    const c = contacts.get(contactId)
    const rep = byName(c?.salesRep)
    if (rep) return { who: rep, why: "the customer's rep is her" }
    const owner = c?.ownerId ? byId.get(c.ownerId) : undefined
    if (owner) return { who: owner, why: 'she entered the customer' }
    return null
  }

  const fixes: RepFix[] = []
  const quoteSalesman = new Map<string, RepLogin>()
  for (const q of input.quotes) {
    if (!blank(q.salesRep)) { const s = byName(q.salesRep); if (s) quoteSalesman.set(q.id, s); continue }
    const owner = q.ownerId ? byId.get(q.ownerId) : undefined
    const card = byName(cardByQuote.get(q.id))
    const hit = owner ? { who: owner, why: 'she made the quote' } : card ? { who: card, why: 'her pipeline card' } : viaCustomer(q.crmContactId)
    if (!hit) continue
    quoteSalesman.set(q.id, hit.who)
    fixes.push({ kind: 'quote', id: q.id, customerName: q.customerName, status: q.status, current: q.salesRep ?? '', rep: repName(hit.who), why: hit.why })
  }
  const quoteRep = new Map(input.quotes.map(q => [q.id, q.salesRep]))
  for (const j of input.jobs) {
    if (!blank(j.salesRep)) continue
    const fromQuote = j.quoteId ? quoteSalesman.get(j.quoteId) : undefined
    // Its quote names someone else (Jonathan): not hers.
    if (!fromQuote && j.quoteId && !blank(quoteRep.get(j.quoteId))) continue
    const hit = fromQuote ? { who: fromQuote, why: 'its quote is hers' } : viaCustomer(j.crmContactId)
    if (!hit) continue
    fixes.push({ kind: 'job', id: j.id, customerName: j.customerName, status: j.status, current: j.salesRep ?? '', rep: repName(hit.who), why: hit.why })
  }
  return fixes
}

/** A job's rep: as sent, else its quote's (a quote saved by a Salesman is hers). */
export async function repForJob(req: any, sent: string | null | undefined, quoteId: string | null | undefined): Promise<string | undefined> {
  if (!blank(sent)) return sent!
  if (quoteId) {
    const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId: req.user.crmAccountId }, select: { salesRep: true } }).catch(() => null)
    if (q && !blank(q.salesRep)) return q.salesRep
  }
  return repForSave(req, sent)
}
