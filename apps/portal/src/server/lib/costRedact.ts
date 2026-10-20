/**
 * Prices only for a Salesman or Installer (Jonathan, Oct 2026): their phones
 * never receive a cost, margin, profit, sub rate, wage, overhead, commission,
 * Target Profit or "where every dollar goes" figure. The owner, admins,
 * managers and the office (permission costs.view) see everything.
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
  'pullNdLaborCents', 'pullNdDisposalCents', 'pullDsLaborCents', 'pullDsDisposalCents', 'woodFactor', 'woodFactorPct',
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

/** Account documents (/api/kv) that are costs through and through: job costing and supplier prices. */
export const KV_COST_KEYS: ReadonlySet<string> = new Set(['fencepro_jobcosting', 'fencepro_inv_suppliers'])

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
/** The business record (Settings): it has the books' keys next to config. */
const isBusinessRecord = (o: Record<string, unknown>) => 'config' in o && 'plEntries' in o

/** The value with every cost removed (a new copy; the input is not changed). */
export function redactCosts<T>(value: T): T {
  return walk(value) as T
}

function walk(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(walk)
  if (!isObj(v)) return v
  const out: Record<string, unknown> = {}
  const book = isBusinessRecord(v)
  // A parts line (item or part, with a quantity) priced from its unit cost: its total is a cost too.
  const costLine = 'unitCost' in v || 'fallbackCost' in v || 'unitCostCents' in v
  for (const [k, x] of Object.entries(v)) {
    if (isCostKey(k)) continue
    if (book && BOOKS_KEYS.has(k)) continue
    if (costLine && k === 'total') continue
    out[k] = walk(x)
  }
  return out
}

const CRM_ROLES = new Set(['super_admin', 'admin', 'manager', 'office_staff', 'sales_rep', 'field_crew'])

/** Does this CRM login see prices only (Salesman, Installer)? A request with no CRM login is left to its route. */
export function hidesCosts(role: string | null | undefined): boolean {
  return !!role && CRM_ROLES.has(role) && !can(role, 'costs.view')
}

/** The role on a request's staff login, or null. */
export function staffRoleOf(req: any): string | null {
  return verifyStaffBearer(req)?.role ?? null
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
export function restoreCosts<T>(incoming: T, saved: unknown): T {
  return restore(incoming, saved) as T
}

function restore(inc: unknown, sav: unknown): unknown {
  if (Array.isArray(inc)) {
    const s = Array.isArray(sav) ? sav : []
    return inc.map((x, i) => restore(x, matchIn(s, x, i)))
  }
  if (!isObj(inc)) return inc
  const s = isObj(sav) ? sav : {}
  const out: Record<string, unknown> = {}
  const book = isBusinessRecord(inc)
  for (const [k, x] of Object.entries(inc)) out[k] = isCostKey(k) || (book && BOOKS_KEYS.has(k)) ? x : restore(x, s[k])
  for (const [k, x] of Object.entries(s)) {
    if ((isCostKey(k) || (book && BOOKS_KEYS.has(k))) && !(k in inc)) out[k] = x
  }
  // A parts line's total comes back with its unit cost.
  if (('unitCost' in s || 'fallbackCost' in s || 'unitCostCents' in s) && 'total' in s && !('total' in inc)) out.total = s.total
  return out
}
