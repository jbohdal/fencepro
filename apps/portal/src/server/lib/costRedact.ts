/**
 * Who sees costs and prices (Jonathan, Oct 25, 2026: "office staff like me
 * and sales i think its ok to see cost but installer and subcontractor no see
 * price"): the owner, admins, managers, the office and the Salesman see
 * everything (costs.view, prices.view). The Installer (Field Crew) receives
 * no cost and no price: no margin, profit, sub rate, wage, overhead,
 * commission, supplier price, and no quote or job price, job value, deposit,
 * payment or balance (PRICE_KEYS below). A role without costs.view but with
 * prices.view would get prices only (none today).
 *
 * Reading: every JSON answer under /api to a login without costs.view goes
 * through redactCosts (index.ts wraps res.json), so a route added later is
 * covered too. Removed wherever they appear:
 *   - the cost fields by name (COST_KEYS): material, labor and tear out cost,
 *     cost of goods, margins, Target Profit, sub rates, wages, overhead,
 *     commission, cost factor, job lot supplier prices, a move's or repair's
 *     cost lines, a proposal option's internal snapshot, ...;
 *   - a parts line's unit cost and total (pull sheets, kits, pending orders);
 *   - the books in Settings' business record (P&L, balance sheet, cash flow,
 *     budget, purchase orders).
 * Prices (a quote's price, price per foot, a tier's price, the minimum job
 * price) stay.
 *
 * Writing: a limited login cannot change a cost, and the blanks its phone
 * holds must never replace the saved figures, so restoreCosts puts every cost
 * field back from what is saved before a business record or Inventory is
 * compared and saved. Quotes are priced on the server instead (routes
 * quote-pricing and saved-quotes).
 */

import { can } from './permissions.js'
import { verifyStaffBearer } from './secrets.js'

/** Field names that hold a cost (or a figure made from costs), anywhere in an answer. */
export const COST_KEYS: ReadonlySet<string> = new Set([
  // A quote's and a job's costs and margin
  'materialCost', 'laborCost', 'tearOutCost', 'totalCOGS', 'cogs', 'grossMargin', 'gmPct', 'basePriceCents',
  'materialCents', 'laborCents', 'disposalCents', 'costCents', 'grossMarginCents', 'commissionCents',
  'commission', 'commissionAmt', 'commissionAmount', 'commissionPct', 'costFactor', 'profit', 'profitPct',
  // Settings → Pricing, Fence styles, Moves and repairs
  'margin', 'margins', 'targetProfitPct', 'colorTargetProfitPct', 'targetMarginPct', 'targetMargin', 'marginFrom',
  'subRate', 'subRateDefault', 'subRateByCategory', 'subWalkGate', 'subDblGate', 'subTearOutSection', 'subTearOutGate',
  'manHourRate', 'wage', 'wages', 'hourlyWage', 'overheadPct', 'overheadHistory', 'liveOverhead',
  'commissionSalesman', 'commissionNonSalesman', 'tearOutFence', 'tearOutGate', 'repairProfitPct',
  'pullNdLaborCents', 'pullNdDisposalCents', 'pullDsLaborCents', 'pullDsDisposalCents', 'footerDisposalCents', 'rateHistory', 'woodFactor', 'woodFactorPct',
  // Job costing (actual costs)
  'actualMaterialCost', 'actualOtherCosts', 'actualLaborCost', 'subPaidCents',
  // Parts and supplier prices
  'unitCost', 'fallbackCost', 'cost', 'costs', 'lastCost', 'avgCost', 'jobLot', 'pieceCents',
  // The rail optimizer's cost per run
  'cost6ft', 'cost8ft', 'savingsVsAll6ft',
  // A move's or repair's priced cost lines; a proposal option's internal snapshot
  'priced', 'snapshot',
])

/** The books in the business record: never for a limited login. */
export const BOOKS_KEYS: ReadonlySet<string> = new Set(['plEntries', 'balanceSheet', 'cashFlowManual', 'budget', 'purchaseOrders'])

/** Any field whose name says it is a cost or made from costs (unitCostCents, totalCostCents, a margin, a profit ...). */
const COST_NAME = /cost|margin|profit|commission|overhead|wage/i
/** Names that match but carry no figure: where a price came from, how commission is applied. */
const NOT_A_COST: ReadonlySet<string> = new Set(['costSource', 'commissionMode'])

/** Is this field a cost? */
export function isCostKey(k: string): boolean {
  return !NOT_A_COST.has(k) && (COST_KEYS.has(k) || COST_NAME.test(k))
}

/** Field names that hold a price or money the customer pays, for a login that sees no prices (the Installer). */
export const PRICE_KEYS: ReadonlySet<string> = new Set([
  'finalPrice', 'quotePrice', 'jobValue', 'contractValue', 'changeOrderTotal', 'amountPaid', 'balanceDue', 'jobPrice',
  'price', 'prices', 'perFoot', 'pricePerFoot', 'priceAdjust', 'tiers', 'estimate', 'estimates',
  'deposit', 'depositPct', 'financing', 'amount', 'subtotal', 'tax', 'payments', 'invoices', 'receipts', 'paymentSchedule', 'adjustments',
])
/** Any field whose name says it is money: priceCents, amountCents, depositPaidCents, balance, revenue, ... */
const PRICE_NAME = /price|amount|balance|deposit|revenue|cents$|dollars|paid(cents)?$/i
/** Names that match but carry no money. */
const NOT_A_PRICE: ReadonlySet<string> = new Set(['priceUpdatedAt', 'priceImported', 'pullSheetPulled', 'priceMethod', 'paymentStatus'])

/** Is this field a price (for a login that sees none)? */
export function isPriceKey(k: string): boolean {
  return !NOT_A_PRICE.has(k) && (PRICE_KEYS.has(k) || PRICE_NAME.test(k))
}

/** A dollar amount typed in words ("estimate shown $7,762", "$500 deposit"). */
const MONEY = /\$\s?\d+(?:,\d{3})*(?:\.\d+)?/g
/** What the Installer sees in place of a dollar amount in a note. */
export const MONEY_MARK = '$ (left out)'

/** A text with every dollar amount left out (the Installer's notes, the crew packet). */
export function withoutMoney(text: string): string {
  return text.replace(MONEY, MONEY_MARK)
}

/** A sentence about what something costs: an estimate, a quote, a price, a budget, a deposit, a payment. */
const PRICE_WORDS = /\b(estimate|estimated|quote[ds]?|quoted|price[ds]?|pricing|budget|cost[s]?|deposit|paid|pay|payment|total|balance)\b/i

/**
 * Text for the crew to read (the packet, the installer's card; never saved
 * back): a sentence that is about a price ("... and saw an estimate of $4,321
 * (Better).", "Budget about $4000.") is dropped whole, so the crew never reads
 * "saw an estimate of $ (left out)" (round 2, Oct 26 2026); any other dollar
 * amount is left out as withoutMoney does. The rest of the line is kept.
 */
export function forCrew(text: string): string {
  return withoutMoney(crewParts(text).kept)
}

/** forCrew in two parts: the text kept (amounts still in) and the sentences about a price it drops. */
function crewParts(text: string): { kept: string; dropped: string[] } {
  if (!text.includes('$')) return { kept: text, dropped: [] }
  const out: string[] = []
  const dropped: string[] = []
  for (const line of text.split('\n')) {
    if (!line.includes('$')) { out.push(line); continue }
    // An amount already left out ("$ (left out)", a packet made on the installer's phone) counts as an amount too.
    const parts = line.split(/(?<=[.!?])\s+/)
    const isPrice = (p: string) => (new RegExp(MONEY.source).test(p) || p.includes(MONEY_MARK)) && PRICE_WORDS.test(p)
    for (const p of parts) if (isPrice(p)) dropped.push(p)
    const kept = parts.filter(p => !isPrice(p))
    if (kept.length) out.push(kept.join(' '))
  }
  return { kept: out.join('\n'), dropped }
}

/** A field the Installer reads as a note: its sentences about a price are dropped (forCrew), not only the amounts. */
export const isNoteKey = (k: string) => /notes?$/i.test(k) || k === 'body'

/**
 * A note the Installer sends back (he read it as forCrew made it): the
 * sentences about a price he never saw are kept, and each "$ (left out)"
 * becomes the amount that was there. Unchanged: as saved. Added to at the end:
 * as saved plus what he added. Changed in the middle: his text, then the price
 * sentences he could not see (never lost).
 */
export function crewTextBack(incoming: string, saved: string): string {
  const { kept, dropped } = crewParts(saved)
  const view = withoutMoney(kept)
  if (incoming === view) return saved
  // Nothing he could see (every sentence was about a price): what he typed goes after it.
  if (!view.trim()) return incoming.trim() ? `${saved}${saved ? '\n' : ''}${incoming.trim()}` : saved
  if (incoming.startsWith(view)) return saved + incoming.slice(view.length)
  const back = withMoneyBack(incoming, kept)
  const missing = dropped.filter(d => !back.includes(d))
  return missing.length ? `${back}${back ? '\n' : ''}${missing.join(' ')}` : back
}

/**
 * Text the Installer sends back: each "$ (left out)" becomes the amount that
 * was there, in order, so a note they did not change (or added to) keeps its
 * amounts as saved.
 */
export function withMoneyBack(text: string, saved: string): string {
  if (!text.includes(MONEY_MARK)) return text
  const amounts = saved.match(MONEY) ?? []
  let i = 0
  return text.split(MONEY_MARK).reduce((out, part, n) => (n === 0 ? part : out + (amounts[i++] ?? MONEY_MARK) + part), '')
}

/** What a login may not receive: costs, and for the Installer prices too. */
export interface Hide { prices?: boolean }
const hidden = (k: string, h: Hide) => isCostKey(k) || (!!h.prices && isPriceKey(k))

/** Account documents (/api/kv) that are costs through and through: job costing and supplier prices. */
export const KV_COST_KEYS: ReadonlySet<string> = new Set(['fencepro_jobcosting', 'fencepro_inv_suppliers'])

/**
 * A plain object (a record from the database, a JSON object): walked field by
 * field. A Date, a Decimal or a Buffer is a value, kept as it is: walking a
 * Date gave {}, and every date a Salesman's or Installer's phone was sent read
 * "Invalid Date" (Today's tasks, photo dates; Oct 24, 2026 walkthrough).
 */
const isObj = (v: unknown): v is Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false
  const proto = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}
/** The business record (Settings): it has the books' keys next to config. */
const isBusinessRecord = (o: Record<string, unknown>) => 'config' in o && 'plEntries' in o

/** The value with every cost (and with `prices`, every price) removed (a new copy; the input is not changed). */
export function redactCosts<T>(value: T, h: Hide = {}): T {
  return walk(value, h) as T
}

function walk(v: unknown, h: Hide): unknown {
  // A Date, Decimal or Buffer is kept whole (isObj below: walked as an object a date came out as {} and
  // blanked a Salesman's card window, Oct 24, 2026). A plain object with its own toJSON is walked as what it
  // turns into on the way out, so a cost inside that is left out too.
  if (isObj(v) && typeof (v as { toJSON?: unknown }).toJSON === 'function') v = (v as { toJSON: () => unknown }).toJSON()
  if (Array.isArray(v)) return v.map(x => walk(x, h))
  // The Installer: a dollar amount typed in a note is left out too.
  if (h.prices && typeof v === 'string') return v.includes('$') ? withoutMoney(v) : v
  if (!isObj(v)) return v
  const out: Record<string, unknown> = {}
  const book = isBusinessRecord(v)
  // A parts line (item or part, with a quantity) priced from its unit cost: its total is a cost too.
  const costLine = 'unitCost' in v || 'fallbackCost' in v || 'unitCostCents' in v
  for (const [k, x] of Object.entries(v)) {
    if (hidden(k, h)) continue
    if (book && BOOKS_KEYS.has(k)) continue
    if (costLine && k === 'total') continue
    // A note: a sentence about a price is dropped whole, as on the crew packet ("saw an estimate of $ (left out)" never shows; round 2b).
    out[k] = h.prices && typeof x === 'string' && isNoteKey(k) ? forCrew(x) : walk(x, h)
  }
  return out
}

const CRM_ROLES = new Set(['super_admin', 'admin', 'manager', 'office_staff', 'sales_rep', 'field_crew'])

/** Does this CRM login see no costs (the Installer)? A request with no CRM login is left to its route. */
export function hidesCosts(role: string | null | undefined): boolean {
  return !!role && CRM_ROLES.has(role) && !can(role, 'costs.view')
}

/** Does this CRM login see no prices either (the Installer)? */
export function hidesPrices(role: string | null | undefined): boolean {
  return !!role && CRM_ROLES.has(role) && !can(role, 'prices.view')
}

/** What to hold back from this login. */
export const hideFor = (role: string | null | undefined): Hide => ({ prices: hidesPrices(role) })

/**
 * The role on a request's staff login, or null. Signed in by the ezbiz_staff
 * cookie, that is the role the cookie check read from the database
 * (lib/staffSession.ts sets req.staffCookie, which verifyStaffBearer prefers);
 * otherwise the old Bearer token's.
 */
export function staffRoleOf(req: any): string | null {
  return verifyStaffBearer(req)?.role ?? null
}

/**
 * Mounted on /api in index.ts, after the cookie check (staffCookieAuth) and
 * before every route: a Salesman's or Installer's answers go out without a
 * cost, whichever route answers.
 */
export function hideCostsFromLimitedLogins(req: any, res: any, next: any): void {
  const role = staffRoleOf(req)
  if (!hidesCosts(role) && !hidesPrices(role)) { next(); return }
  const h = hideFor(role)
  const json = res.json.bind(res)
  res.json = (body: any) => json(redactCosts(body, h))
  next()
}

// ── Writing ─────────────────────────────────────────────────────────────────

/** Where two lists hold the same entry: by id, else key, else name, else the same place. */
function matchIn(saved: unknown[], x: unknown, i: number): unknown {
  if (isObj(x)) {
    for (const k of ['id', 'key', 'styleName', 'name', 'part', 'item']) {
      const v = x[k]
      if (typeof v === 'string' && v) {
        const hit = saved.find(s => isObj(s) && s[k] === v)
        if (hit !== undefined) return hit
        if (k === 'id' || k === 'key') return undefined
      }
    }
  }
  return saved[i]
}

/**
 * What a limited login sends, with the cost fields its phone never had put
 * back as saved. A cost it does send stays in, so the route's permission check
 * sees the change and refuses it (403); a new entry has no costs. Prices and
 * everything else are as sent.
 */
export function restoreCosts<T>(incoming: T, saved: unknown, h: Hide = {}): T {
  return restore(incoming, saved, h) as T
}

function restore(inc: unknown, sav: unknown, h: Hide): unknown {
  if (Array.isArray(inc)) {
    const s = Array.isArray(sav) ? sav : []
    return inc.map((x, i) => restore(x, matchIn(s, x, i), h))
  }
  if (h.prices && typeof inc === 'string' && typeof sav === 'string') return withMoneyBack(inc, sav)
  if (!isObj(inc)) return inc
  const s = isObj(sav) ? sav : {}
  const out: Record<string, unknown> = {}
  const book = isBusinessRecord(inc)
  for (const [k, x] of Object.entries(inc)) out[k] = hidden(k, h) || (book && BOOKS_KEYS.has(k)) ? x
    : h.prices && typeof x === 'string' && typeof s[k] === 'string' && isNoteKey(k) ? crewTextBack(x, s[k] as string) : restore(x, s[k], h)
  for (const [k, x] of Object.entries(s)) {
    if ((hidden(k, h) || (book && BOOKS_KEYS.has(k))) && !(k in inc)) out[k] = x
  }
  // A parts line's total comes back with its unit cost.
  if (('unitCost' in s || 'fallbackCost' in s || 'unitCostCents' in s) && 'total' in s && !('total' in inc)) out.total = s.total
  return out
}

/**
 * Mounted in index.ts on the routes that are about money only (payments,
 * invoices, contracts, change orders, signed documents, quote pricing,
 * pricing rules): the Installer is refused there outright, with a plain sentence.
 */
export function refuseNoPrices(req: any, res: any, next: any): void {
  if (hidesPrices(staffRoleOf(req))) { res.status(403).json({ success: false, code: 'NOT_ALLOWED', error: 'Your role does not see prices. Ask the office.' }); return }
  next()
}
