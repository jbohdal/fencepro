/**
 * The quote builder's "Salesman on this job?" switch (Jonathan, Oct 27 2026):
 * "Commission: 9% on by default for Christa's quotes. It comes out of the
 * price; the customer price never changes. Hidden from her view of costs as
 * before."
 *
 *   - On by default for a new quote made by a Salesman login, or whose sales
 *     rep is a Salesman on the team. The owner and the office keep off by
 *     default for their own quotes.
 *   - A website draft that nobody has sent yet counts as new: the website made
 *     it, nobody on staff picked the switch.
 *   - A saved quote opens with the switch as it was saved (its price and
 *     commission stay as saved).
 *   - The commission (its %, its dollars and its share of "where every dollar
 *     goes") is not shown to a Salesman. Her screens read as they did before
 *     the switch was on for her: commission is not part of her view.
 *
 * Pure: QuoteBuilder and QuoteDetailDrawer call it, tests call it directly.
 */

export const SALESMAN_ROLE = 'sales_rep'

type QuoteLike = {
  id?: string | null
  status?: string
  hasSalesman?: boolean
  salesRep?: string | null
  shareToken?: string | null
  acceptedAt?: string | null
  soldAt?: string | null
  layout?: { widgetDrawing?: unknown } | null
} | null | undefined

type Member = { name: string; role: string }

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/** Is this name a Salesman on the team (names compared without case or extra spaces)? */
export function isSalesmanName(name: string | null | undefined, team: readonly Member[]): boolean {
  const n = norm(name)
  return !!n && team.some(m => m.role === SALESMAN_ROLE && norm(m.name) === n)
}

/** A quote no one on staff has decided the switch on yet: not saved, or the website's draft not yet sent. */
export function isFreshQuote(q: QuoteLike): boolean {
  if (!q || !q.id) return true
  return q.status === 'DRAFT' && !q.shareToken && !q.acceptedAt && !q.soldAt && !!q.layout?.widgetDrawing && !q.hasSalesman
}

/** Where "Salesman on this job?" starts when the quote builder opens. */
export function salesmanSwitchDefault(q: QuoteLike, role: string | null | undefined, team: readonly Member[]): boolean {
  if (!isFreshQuote(q)) return !!q?.hasSalesman
  if (q?.hasSalesman) return true
  return role === SALESMAN_ROLE || isSalesmanName(q?.salesRep, team)
}

/** Does this login see the commission (its % and dollars)? Everyone who sees costs except a Salesman. */
export function seesCommission(role: string | null | undefined, seesCosts: boolean): boolean {
  return seesCosts && role !== SALESMAN_ROLE
}
