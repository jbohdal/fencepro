/**
 * A customer's open quotes move with the customer's Salesman (Jonathan,
 * Oct 29 2026, D3): "Yes, unsold quotes and their commission move with the
 * customer. Signed jobs stay with whoever sold them."
 *
 * Before, changing a customer's Salesman moved the customer and the open
 * pipeline cards but left the quotes behind: a $13,407 quote stayed
 * "Christa, $1,206.64 commission" while the customer page said Jonathan, so
 * the sales board, Sales by rep and the quote list disagreed with it.
 *
 *   - Which quotes: the customer's quotes that are open, Draft or Sent, never
 *     sold (no soldAt, no acceptance on the customer's link, no quoted cost
 *     saved at signing, no job made from it) and not deleted. Sold quotes,
 *     their jobs and their commission stay with whoever sold them. Lost
 *     quotes stay too: their close rate belongs to who lost them.
 *   - What changes: the quote's Sales rep, nothing else. The price, the cost,
 *     the margin and "Salesman on this job?" (hasSalesman, the commission
 *     switch that is part of the price) are left as saved. The commission
 *     is a share of the price that the quote carries (price − cost − margin),
 *     not a figure per rep: the Salesman % in Settings is the same for every
 *     Salesman, so a quote moved from one Salesman to another carries to the
 *     new one exactly the commission the app would work out for them. Moved
 *     to the owner, the quote keeps the same commission too (the switch is a
 *     staff choice per quote, never set by who the rep is), credited to the
 *     owner. What groups the commission by person (Sales by rep, the board,
 *     the quote list) reads the rep, so it follows.
 *   - Written down: a "Quotes moved" line on the customer's History (who,
 *     how many, from whom; no money: the History is read by the Salesman,
 *     who never sees a commission), and the quotes, prices and commissions
 *     moved in the audit log (by the route).
 *   - Who sees them: every remembered Salesman scope is forgotten by the
 *     caller (salesScope.ts forgetAllScopes): the new Salesman has the quotes
 *     on the next request, the old one no longer does, even a quote the old
 *     one wrote (Jonathan, Oct 29 2026: "Christa's quotes after a move:
 *     unsold ones leave her list. Signed ones she sold stay with her."; the
 *     rep on a quote decides, lib/salesScope.ts). What each phone held is
 *     still put back on its next save (salesServed.ts, salesScopeRecords.ts).
 *   - An older copy saved afterwards (a phone or tab that read the quote
 *     before the move) does not take the quote back: quoteRepKept below.
 */

import prisma from './prisma.js'
import { sameName } from './salesRep.js'

/** History lines of a quotes move start with this; followUps.ts shows them as "Quotes moved". */
export const QUOTES_MOVED_NOTE_PREFIX = 'Open quotes moved to '

/** The statuses of a quote that is not sold and not lost. */
export const OPEN_QUOTE_STATUSES = ['DRAFT', 'SENT'] as const

const isPos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** The same person as a rep is written: the same name, or one side the other's first name alone ("Christa" = "Christa Feagin"). */
export function samePerson(a: string | null | undefined, b: string | null | undefined): boolean {
  if (sameName(a, b)) return true
  const first = (s: string | null | undefined) => String(s ?? '').trim().split(/\s+/)[0]
  const oneWord = (s: string | null | undefined) => !!String(s ?? '').trim() && !/\s/.test(String(s).trim())
  return (oneWord(a) && sameName(a, first(b))) || (oneWord(b) && sameName(b, first(a)))
}

/**
 * A saved quote's commission in cents, as the app shows it ("Pricing
 * (Internal)", web salesmanCommission.ts savedCommission): a repair's or a
 * move's own saved commission, else what the saved figures leave for it,
 * price − cost − margin. 0 with no commission.
 */
export function quoteCommissionCents(q: { hasSalesman?: boolean | null; finalPrice: number; totalCOGS: number; gmPct: number; pricing?: unknown; work?: unknown }): number {
  const pricingPct = (q.pricing as { commissionPct?: unknown } | null | undefined)?.commissionPct
  const workCents = (q.work as { priced?: { commissionCents?: unknown } } | null | undefined)?.priced?.commissionCents
  const carries = !!q.hasSalesman || isPos(pricingPct) || isPos(workCents)
  if (!carries || !(q.finalPrice > 0)) return 0
  const cents = isPos(workCents) ? Math.round(workCents) : Math.round(q.finalPrice * 100 * (1 - q.gmPct) - q.totalCOGS * 100)
  return cents > 0 ? cents : 0
}

export interface MovedQuote {
  id: string
  status: string
  from: string
  to: string
  /** The customer's price, unchanged (integer cents). */
  priceCents: number
  /** The commission the quote carries, moved with it (integer cents). */
  commissionCents: number
}

/** The open quotes of a customer: Draft or Sent, never sold, not deleted. */
export async function openQuotesOf(accountId: string, contactId: string) {
  const quotes = await prisma.savedQuote.findMany({
    where: { accountId, crmContactId: contactId, deletedAt: null, status: { in: [...OPEN_QUOTE_STATUSES] }, soldAt: null, acceptedAt: null },
    select: { id: true, status: true, salesRep: true, finalPrice: true, totalCOGS: true, gmPct: true, hasSalesman: true, pricing: true, work: true },
    orderBy: { createdAt: 'asc' },
  })
  if (!quotes.length) return []
  const ids = quotes.map(q => q.id)
  // A quote with a quoted cost saved at signing, or a job made from it, was sold (lib/everSold.ts) whatever its status says.
  // all rows: a job made from the quote marks it sold even if the job was deleted later, so it stays with whoever sold it.
  const [costs, jobs] = await Promise.all([
    prisma.jobQuotedCost.findMany({ where: { accountId, quoteId: { in: ids } }, select: { quoteId: true } }),
    prisma.savedJob.findMany({ where: { accountId, quoteId: { in: ids } }, select: { quoteId: true } }),
  ])
  const sold = new Set([...costs.map(c => c.quoteId), ...jobs.map(j => j.quoteId)])
  return quotes.filter(q => !sold.has(q.id))
}

/**
 * Give the customer's open quotes to `toRep` (a name, as the customer's Sales
 * rep is written). Quotes already the rep's are left. Writes the History line
 * when any moved. Returns what moved (for the audit log).
 */
export async function moveOpenQuotes(input: { accountId: string; contactId: string; toRep: string; by: { id: string | null; name: string } }): Promise<MovedQuote[]> {
  const toRep = input.toRep.trim()
  if (!toRep) return []
  // A quote naming the rep by first name alone is already theirs (salesScope.ts reads it so).
  const open = (await openQuotesOf(input.accountId, input.contactId)).filter(q => !samePerson(q.salesRep, toRep))
  if (!open.length) return []
  const moved: MovedQuote[] = []
  for (const q of open) {
    // The same conditions again in the write: a quote sold or changed since the read is left as it is.
    const done = await prisma.savedQuote.updateMany({
      where: { id: q.id, accountId: input.accountId, crmContactId: input.contactId, deletedAt: null, status: { in: [...OPEN_QUOTE_STATUSES] }, soldAt: null, acceptedAt: null, salesRep: q.salesRep },
      data: { salesRep: toRep },
    })
    if (done.count !== 1) continue
    moved.push({ id: q.id, status: q.status, from: q.salesRep, to: toRep, priceCents: Math.round(q.finalPrice * 100), commissionCents: quoteCommissionCents(q) })
  }
  if (!moved.length) return []
  const froms = [...new Set(moved.map(m => m.from.trim()).filter(Boolean))]
  const n = moved.length
  await prisma.crmContactNote.create({
    data: {
      crmContactId: input.contactId, accountId: input.accountId, isPinned: false,
      body: `${QUOTES_MOVED_NOTE_PREFIX}${toRep} with the customer by ${input.by.name}: ${n} quote${n === 1 ? '' : 's'} not sold yet${froms.length ? `, ${n === 1 ? 'it was' : 'they were'} ${froms.join(' and ')}'s` : ''}. Signed jobs stay with whoever sold them.`,
      createdBy: input.by.name, createdById: input.by.id,
    },
  })
  return moved
}

/**
 * Should a quote save keep the stored Sales rep instead of the one sent?
 * Yes when the quote is open and its rep is its customer's Salesman, and the
 * save sends another name for the same customer: a phone or tab that read
 * the quote before the customer's Salesman was changed would otherwise take
 * the quote back to the old rep. Giving the quote to another customer (whose
 * rep it then takes) is not held back.
 */
export function quoteRepKept(input: {
  existing: { salesRep: string; status: string; soldAt: Date | null; acceptedAt: Date | null; crmContactId: string | null }
  sentRep: string | null | undefined
  sentContactId: string | null | undefined
  customerRep: string | null | undefined
}): boolean {
  const { existing, sentRep } = input
  if (!sentRep?.trim() || !existing.salesRep?.trim() || samePerson(sentRep, existing.salesRep)) return false
  if (!(OPEN_QUOTE_STATUSES as readonly string[]).includes(existing.status) || existing.soldAt || existing.acceptedAt) return false
  if (!existing.crmContactId || (input.sentContactId !== undefined && input.sentContactId !== existing.crmContactId)) return false
  return samePerson(input.customerRep, existing.salesRep)
}
