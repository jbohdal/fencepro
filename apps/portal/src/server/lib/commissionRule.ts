/**
 * Commission only when an actual Salesman is the rep (Jonathan, Nov 2 2026:
 * "Commission only applies when an actual Salesman (Christa or another
 * salesman login) is the rep ... Nobody is paid on those.").
 *
 * Never removed on a guess. It comes off only when the rep is positively not
 * a Salesman (repRulesOut): a current owner, office, admin or manager login
 * (full name, first name or initials), or a blank rep on a quote made by such
 * a login. A name that is no login, a misspelling, a login that is gone, a
 * Salesman who left, was renamed or changed role: the quote keeps what it has.
 *
 *   - Every save of an unsigned quote holds to it (routes/saved-quotes.ts); the
 *     quote builder asks the same rule before a save and says so first.
 *   - A move: commission follows the rep on an unsigned quote, off to someone
 *     who is positively not a Salesman, on to a Salesman (commissionOnMove). A
 *     signed quote or sold job does not change (signedMoveChangesCommission).
 *   - Commission added on top of the price is never touched here: taking it off
 *     would leave the price grossed up.
 *   - Commission "included" comes out of the price, so turning it off or on
 *     changes only the margin saved after it and the commission fields. The
 *     price, the cost and every word the customer reads stay.
 *
 * Also what scripts/commission-rep-fix-2026-11-02.ts uses on old quotes.
 */

import prisma from './prisma.js'
import { SALESMAN_ROLE, repName } from './salesRep.js'

type Json = any

const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
const initials = (name: string) => norm(name).split(' ').map(w => w[0] ?? '').join('')

type Named = { firstName?: string | null; lastName?: string | null }

/** Does this rep name this login: full name, first name alone or initials ("Christa Feagin", "Christa ", "CF")? */
export function repNamesLogin(rep: string | null | undefined, u: Named): boolean {
  const n = norm(rep)
  const full = norm(repName(u))
  return !!n && !!full && (full === n || norm(u.firstName) === n || initials(full) === n)
}

/** Does this rep name one of these Salesman logins? */
export function repNamesSalesman(rep: string | null | undefined, salesmen: ReadonlyArray<Named>): boolean {
  return salesmen.some(u => repNamesLogin(rep, u))
}

/** A login as the rule reads it. wasSalesman: the audit log shows it invited or changed to Salesman. */
export interface RuleLogin extends Named { id: string; role: string; status: string; wasSalesman: boolean }

const NOT_SALESMAN_ROLES: ReadonlySet<string> = new Set(['super_admin', 'admin', 'manager', 'office_staff'])
const positivelyNot = (u: RuleLogin) => NOT_SALESMAN_ROLES.has(u.role) && u.status === 'active' && !u.wasSalesman

/**
 * Is this rep positively not a Salesman? `ownerId`: the login that made the quote. Every login the rep could
 * mean must be a current owner, office, admin or manager who never was a Salesman. Anything else: not known, false.
 */
export function repRulesOut(rep: string | null | undefined, ownerId: string | null | undefined, logins: readonly RuleLogin[]): boolean {
  if (!norm(rep)) {
    const maker = logins.find(u => u.id === ownerId)
    return !!maker && positivelyNot(maker)
  }
  const meant = logins.filter(u => repNamesLogin(rep, u))
  return meant.length > 0 && meant.every(positivelyNot)
}

/** The company's logins for the rule. */
export async function ruleLogins(accountId: string): Promise<RuleLogin[]> {
  const users = await prisma.crmUser.findMany({ where: { crmAccountId: accountId }, select: { id: true, firstName: true, lastName: true, role: true, status: true } })
  if (!users.length) return []
  const was = await prisma.crmAuditLog.findMany({ where: { entityType: 'CrmUser', entityId: { in: users.map(u => u.id) }, newValues: { path: ['role'], equals: SALESMAN_ROLE } }, select: { entityId: true } })
  const seen = new Set(was.map(w => w.entityId))
  return users.map(u => ({ ...u, role: String(u.role), status: String(u.status), wasSalesman: seen.has(u.id) }))
}

/** Settings' commission: the Salesman's share and how it sits on the price. */
export async function commissionSettings(accountId: string): Promise<{ pct: number; mode: string }> {
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const p = (b?.config as Json)?.pricing
  return { pct: typeof p?.commissionSalesman === 'number' && p.commissionSalesman > 0 ? p.commissionSalesman : 0, mode: p?.commissionMode ?? 'included' }
}

/** Commission added on top of this quote's price (the quote's own choice, else Settings)? */
const isAdded = (q: { pricing?: unknown }, settingsMode: string) => ((q.pricing as Json)?.commissionMode ?? settingsMode) === 'added'

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

/** A move's or repair's saved work with commission on: on its price before the adjustment and the rounding (moveRepair.ts). */
function workWith(work: Json, pct: number): Json {
  const p = work?.priced
  if (!p || typeof p !== 'object' || pos(p.commissionCents)) return work
  const base = (Number(p.priceCents) || 0) - (Number(p.adjustmentCents) || 0) + (Number(p.roundingCents) || 0)
  const c = Math.round(base * pct)
  return { ...work, priced: { ...p, commissionCents: c, grossMarginCents: (Number(p.grossMarginCents) || 0) - c } }
}

type Fields = { hasSalesman: boolean; gmPct: number; pricing?: Json; work?: Json; proposal?: Json }
type QuoteFigures = { finalPrice: number; totalCOGS: number; pricing?: unknown; work?: unknown; proposal?: unknown }

/**
 * The fields of a quote with its commission taken off: the switch, the saved
 * margin (now price less cost), the quote's own commission %, a move's or
 * repair's saved commission, and each proposal option's internal snapshot,
 * which the customer never reads and signing copies onto the quote. Nothing
 * else: no price, cost, status, link or proposal words.
 */
export function withoutCommission(q: QuoteFigures): Fields {
  const out: Fields = { hasSalesman: false, gmPct: marginOf(q.finalPrice, q.totalCOGS) }
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

/** Commission on the price before the ± dollar adjustment and the rounding (pricingEngine.ts), out of the margin. */
function marginWith(priceDollars: number, costDollars: number, adjustmentCents: number, roundingCents: number, pct: number): number {
  const price = Math.round(priceDollars * 100)
  if (!(price > 0)) return 0
  const base = price - (Number(adjustmentCents) || 0) + (Number(roundingCents) || 0)
  return (price - Math.round(costDollars * 100) - base * pct) / price
}

/** The other way: the same fields with commission on at `pct`, included in the price. Nothing else changes. */
export function withCommission(q: QuoteFigures, pct: number): Fields {
  const pricing = (q.pricing ?? {}) as Json
  const out: Fields = { hasSalesman: true, gmPct: marginWith(q.finalPrice, q.totalCOGS, pricing.priceAdjustmentCents, pricing.roundingCents, pct) }
  const work = q.work as Json
  if (work?.priced) {
    out.work = workWith(work, pct)
    const w = out.work.priced
    if (Number(w.priceCents) > 0) out.gmPct = Number(w.grossMarginCents) / Number(w.priceCents)
  }
  const p = q.proposal as Json
  if (p && typeof p === 'object' && Array.isArray(p.options) && p.options.some((o: Json) => o?.snapshot)) {
    out.proposal = {
      ...p,
      options: p.options.map((o: Json) => {
        const s = o?.snapshot
        if (!s || typeof s !== 'object') return o
        return { ...o, snapshot: { ...s, ...(typeof s.gmPct === 'number' && pos(s.totalCOGS) ? { gmPct: marginWith(Number(o.finalPrice) || 0, s.totalCOGS, o.adjustmentCents, s.roundingCents, pct) } : {}), ...(s.work ? { work: workWith(s.work, pct) } : {}) } }
      }),
    }
  }
  return out
}

/** A signed quote or sold job does not change commission on a move. Jonathan's answer on signed jobs is this one line. */
export const signedMoveChangesCommission = (): boolean => false

export type MoveCommission =
  | { change: 'none'; why: 'signed' | 'added' | 'same'; fields: null }
  | { change: 'off' | 'on'; why: 'rep'; fields: Fields }

/** What a move does to a quote's commission (`signed`: signed, sold or with a job). */
export function commissionOnMove(
  q: QuoteFigures & { hasSalesman?: boolean | null },
  input: { signed: boolean; toRep: string; logins: readonly RuleLogin[]; settings: { pct: number; mode: string } },
): MoveCommission {
  if (input.signed && !signedMoveChangesCommission()) return { change: 'none', why: 'signed', fields: null }
  if (isAdded(q, input.settings.mode)) return { change: 'none', why: 'added', fields: null }
  const carries = carriesCommission(q)
  if (carries && repRulesOut(input.toRep, null, input.logins)) return { change: 'off', why: 'rep', fields: withoutCommission(q) }
  const toSalesman = input.logins.some(u => u.role === SALESMAN_ROLE && repNamesLogin(input.toRep, u))
  if (!carries && toSalesman && input.settings.pct > 0) return { change: 'on', why: 'rep', fields: withCommission(q, input.settings.pct) }
  return { change: 'none', why: 'same', fields: null }
}

/** Would a save of this quote take its commission off? Commission added on top of the price is left alone. */
export function saveTakesCommissionOff(q: { salesRep?: string | null; ownerId?: string | null; pricing?: unknown }, logins: readonly RuleLogin[], settingsMode: string): boolean {
  return !isAdded(q, settingsMode) && repRulesOut(q.salesRep, q.ownerId, logins)
}

/**
 * The saved margin an option carries when a customer signs it (routes/proposal.ts). The option's snapshot was
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
