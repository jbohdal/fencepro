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

/** What a saved quote carries for its margin: the saved gmPct is after the commission (price − cost − commission). */
type SavedMargin = {
  gmPct: number
  finalPrice: number
  totalCOGS: number
  hasSalesman?: boolean
  pricing?: { commissionPct?: number } | null
  work?: { priced?: { commissionCents?: number } } | null
}

const pos = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Does this saved quote carry a commission (the switch was on, the quote kept its own %, or a repair's commission)? */
export function carriesCommission(q: SavedMargin): boolean {
  return !!q.hasSalesman || pos(q.pricing?.commissionPct) || pos(q.work?.priced?.commissionCents)
}

/**
 * A saved quote's margin before the commission. The saved gmPct is
 * (price − cost − commission) ÷ price (pricingEngine.ts, moveRepair.ts), so the
 * commission is added back from the saved price and cost: (price − cost) ÷ price.
 * A quote with no commission, no price or no cost keeps its saved margin.
 * For the screen only: the saved quote is never changed.
 */
export function marginBeforeCommission(q: SavedMargin): number {
  if (!carriesCommission(q) || !(q.finalPrice > 0) || !(q.totalCOGS > 0)) return q.gmPct
  return (q.finalPrice - q.totalCOGS) / q.finalPrice
}

/** The margin this login sees on a saved quote: the saved one, or for a Salesman the margin before the commission. */
export function shownMargin(q: SavedMargin, showCommission: boolean): number {
  return showCommission ? q.gmPct : marginBeforeCommission(q)
}

/** A copy of the quote for showing (its margin as this login sees it). Never saved: stores get the original. */
export function withShownMargin<T extends SavedMargin>(q: T, showCommission: boolean): T {
  if (showCommission) return q
  const gmPct = marginBeforeCommission(q)
  return gmPct === q.gmPct ? q : { ...q, gmPct }
}

type Login = { firstName?: string | null; lastName?: string | null } | null | undefined

/** A login's names as a rep is written: "christa feagin" and "christa" (the server's lib/salesScope.ts names). */
export function repNamesOf(me: Login): string[] {
  const full = norm(`${me?.firstName ?? ''} ${me?.lastName ?? ''}`)
  return [...new Set([full, norm(me?.firstName)].filter(Boolean))]
}

/**
 * Is the Salesman the Sales rep on this quote: the login's first and last name, or the first name alone,
 * without case or extra spaces ("Christa", "Christa ", "christa  feagin"). The same match as the server's
 * (lib/salesScope.ts isMine, lib/salesRep.ts sameName). Review Oct 28 2026: an exact match on
 * "Christa Feagin" showed the Salesman none of the Salesman's quotes.
 */
export function isRepsQuote(salesRep: string | null | undefined, me: Login): boolean {
  const rep = norm(salesRep)
  return !!rep && repNamesOf(me).includes(rep)
}

/**
 * The Salesman's Quotes screen: the server already sends only the quotes the Salesman may see
 * (lib/salesScope.ts), so the list is every quote sent. `mine` is the part with the Salesman as Sales rep
 * (the commission is on those). Every other login: the whole list, `mine` empty.
 */
export function salesmanQuoteView<T extends { salesRep?: string | null }>(quotes: readonly T[], role: string | null | undefined, me: Login): { listed: readonly T[]; mine: T[] } {
  if (role !== SALESMAN_ROLE) return { listed: quotes, mine: [] }
  return { listed: quotes, mine: quotes.filter(q => isRepsQuote(q.salesRep, me)) }
}

/**
 * A saved quote's commission, for "Pricing (Internal)" (review Oct 27 2026: the office saw cost, price and
 * a 35% margin that did not add up, the commission being in the margin but nowhere on the screen).
 * The cents are what the saved figures leave for it, price − cost − margin (so the lines add up to the
 * margin shown); a repair's are its own saved commission. The % is the quote's own, else the cents over
 * the price. Null with no commission. Only for logins that see the commission (seesCommission).
 */
export function savedCommission(q: SavedMargin): { pct: number; cents: number } | null {
  if (!carriesCommission(q) || !(q.finalPrice > 0)) return null
  const cents = pos(q.work?.priced?.commissionCents)
    ? Math.round(q.work!.priced!.commissionCents!)
    : Math.round(q.finalPrice * 100 * (1 - q.gmPct) - q.totalCOGS * 100)
  if (!(cents > 0)) return null
  const pct = pos(q.pricing?.commissionPct) ? q.pricing!.commissionPct! : cents / (q.finalPrice * 100)
  return { pct, cents }
}
