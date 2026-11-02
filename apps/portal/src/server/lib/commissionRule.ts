/**
 * Commission only when an actual Salesman is the rep (Jonathan, Nov 2 2026:
 * "Commission only applies when an actual Salesman (Christa or another
 * salesman login) is the rep ... Nobody is paid on those.").
 *
 *   - A quote's rep is a Salesman when it names a Salesman login, active or
 *     not (full name, first name alone or initials: "Christa Feagin",
 *     "Christa ", "CF"). Owner, office, admin, a name that is no login, or
 *     blank: $0 commission.
 *   - Every save of an unsigned quote holds to it (routes/saved-quotes.ts), and
 *     so does giving a quote to someone who is not a Salesman
 *     (lib/salesmanMove.ts, lib/quotesFollowCustomer.ts).
 *   - Commission "included" comes out of the price, so taking it off changes
 *     only the margin saved after it and the commission fields. The price, the
 *     cost and every word the customer reads stay.
 *
 * Also what scripts/commission-rep-fix-2026-11-02.ts writes on old quotes.
 */

import prisma from './prisma.js'
import { SALESMAN_ROLE, repName } from './salesRep.js'

type Json = any

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const initials = (name: string) => norm(name).split(' ').map(w => w[0] ?? '').join('')

/** Does this rep name one of these Salesman logins? */
export function repNamesSalesman(rep: string | null | undefined, salesmen: ReadonlyArray<{ firstName?: string | null; lastName?: string | null }>): boolean {
  const n = norm(rep)
  if (!n) return false
  return salesmen.some(u => {
    const full = norm(repName(u))
    return !!full && (full === n || norm(u.firstName) === n || initials(full) === n)
  })
}

/** The company's Salesman logins, of any status: a Salesman who left keeps the commission on the quotes she sold. */
export function salesmanLogins(accountId: string) {
  return prisma.crmUser.findMany({ where: { crmAccountId: accountId, role: SALESMAN_ROLE as any }, select: { id: true, firstName: true, lastName: true } })
}

export async function repIsSalesman(accountId: string, rep: string | null | undefined): Promise<boolean> {
  return repNamesSalesman(rep, await salesmanLogins(accountId))
}

const pos = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Does a saved quote carry a commission? (web salesmanCommission.ts carriesCommission) */
export function carriesCommission(q: { hasSalesman?: boolean | null; pricing?: unknown; work?: unknown }): boolean {
  return !!q.hasSalesman || pos((q.pricing as Json)?.commissionPct) || pos((q.work as Json)?.priced?.commissionCents)
}

/** Price less cost ÷ price. */
const marginOf = (price: number, cost: number) => {
  const p = Math.round(price * 100)
  return p > 0 ? (p - Math.round(cost * 100)) / p : 0
}

/** A move's or repair's saved work with no commission (the rest of it, its words and prices, as saved). */
function workWithout(work: Json): Json {
  const c = work?.priced?.commissionCents
  if (!pos(c)) return work
  return { ...work, priced: { ...work.priced, commissionCents: 0, grossMarginCents: (Number(work.priced.grossMarginCents) || 0) + c } }
}

/**
 * The fields of a quote with its commission taken off: the switch, the saved
 * margin (now price less cost), the quote's own commission %, a move's or
 * repair's saved commission, and each proposal option's internal snapshot,
 * which the customer never reads and signing copies onto the quote. Nothing
 * else: no price, cost, status, link or proposal words.
 */
export function withoutCommission(q: { finalPrice: number; totalCOGS: number; pricing?: unknown; work?: unknown; proposal?: unknown }): { hasSalesman: false; gmPct: number; pricing?: Json; work?: Json; proposal?: Json } {
  const out: { hasSalesman: false; gmPct: number; pricing?: Json; work?: Json; proposal?: Json } = { hasSalesman: false, gmPct: marginOf(q.finalPrice, q.totalCOGS) }
  const pricing = q.pricing as Json
  if (pricing && typeof pricing === 'object' && pricing.commissionPct !== undefined) {
    const { commissionPct: _pct, ...rest } = pricing
    out.pricing = rest
  }
  const work = q.work as Json
  if (pos(work?.priced?.commissionCents)) out.work = workWithout(work)
  const p = q.proposal as Json
  if (p && typeof p === 'object' && Array.isArray(p.options) && p.options.some((o: Json) => o?.snapshot)) {
    out.proposal = {
      ...p,
      options: p.options.map((o: Json) => {
        const s = o?.snapshot
        if (!s || typeof s !== 'object') return o
        return { ...o, snapshot: { ...s, ...(typeof s.gmPct === 'number' && pos(s.totalCOGS) ? { gmPct: marginOf(Number(o.finalPrice) || 0, s.totalCOGS) } : {}), ...(s.work ? { work: workWithout(s.work) } : {}) } }
      }),
    }
  }
  return out
}

/**
 * The saved margin an option carries when a customer signs it (lib: routes/proposal.ts). The option's snapshot was
 * priced before the quote's own price was set, so:
 *   - a quote with no commission: price less cost at the signed price;
 *   - the quote's own option at the quote's price (it may be typed by hand): that price less the option's cost less
 *     the commission saved on the quote;
 *   - any other option: as priced.
 */
export function gmPctAtSigning(
  q: { fenceStyle: string; finalPrice: number; totalCOGS: number; gmPct: number; hasSalesman?: boolean | null; pricing?: unknown; work?: unknown },
  opt: { fenceStyle: string; finalPrice: number },
  s: { totalCOGS: number; gmPct: number },
): number {
  const price = Number(opt.finalPrice) || 0
  if (!(price > 0)) return s.gmPct
  if (!carriesCommission(q)) return marginOf(price, s.totalCOGS)
  const own = opt.fenceStyle === q.fenceStyle && Math.round(price * 100) === Math.round(q.finalPrice * 100)
  if (!own) return s.gmPct
  const commission = q.finalPrice - q.totalCOGS - q.gmPct * q.finalPrice
  return (price - s.totalCOGS - commission) / price
}
