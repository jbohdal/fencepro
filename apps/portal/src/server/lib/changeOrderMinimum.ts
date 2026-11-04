/**
 * A change order that takes work off a job stops at the minimum job price
 * (Jonathan, Nov 3 2026, item 32: "yes, a cut stops at $350. Owner can
 * override."). The server's check under the change order screen's own (web
 * ChangeOrders.tsx, discountMinimum.ts cutUnderMinimum): a crafted save skips
 * the screen, so what is about to be written is read here, whoever sent it.
 *
 * The floor is the minimum job price itself, to the whole dollar (never moved
 * by the quote's own discount). The contract is counted as the screen counts
 * it (discountMinimum.ts cutContractCents): the price signed for, the contract
 * adjustments, every cut not voided and each addition once approved or signed.
 * The screen reads the same figures from GET /api/change-orders/cut-floor.
 *
 * Held to it, for every login but the owner (whose box, minimumOverride, lets
 * it through and is recorded in the audit log):
 * - a new change order, or new lines that take more off, whose credit takes
 *   the contract under the floor;
 * - voiding an approved (or signed) addition that leaves it under;
 * - approving or signing a cut that, at that moment, leaves it under (a check
 *   only: the amounts are never repriced). A customer signing is never the owner.
 * Each check runs inside the save's own transaction, after lockJob: two saves
 * on one job wait for each other, so two cuts sent at once cannot both get
 * through (review Nov 3 2026: two in the same second left −$140).
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { can } from './permissions.js'

type Json = any

export const CUT_BELOW_MINIMUM_CODE = 'CHANGE_ORDER_BELOW_MINIMUM'

/** What the login asked for: who, and whether the owner ticked the box. */
export interface MinimumAsk { role: string | null | undefined; override: boolean; customer?: boolean }

/** The owner's override, for the audit log (cutOverrideAudit). */
export interface CutOverride { floorCents: number; contractCents: number; changeCents: number; doing: 'cut' | 'void' | 'approve' }

/** The customer is told to call (never "ask Jonathan"), as for a change order that can't be signed yet (lib/changeOrders.ts refuseClash). */
const CUSTOMER_WORDS = 'This change order needs another look from our office before it can be signed. Please call us.'

const refused = (error: string) => Object.assign(new Error(error), { status: 409, code: CUT_BELOW_MINIMUM_CODE })

/** One save at a time per job: held to the end of the transaction `tx` (Postgres advisory lock on the quote id). */
export async function lockJob(tx: Json, quoteId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${'change-order:' + quoteId}))) l`
}

/** The floor and the contract a cut on `quoteId` is counted from, in cents (`exclude`: the change order being changed, left out). */
export async function cutStanding(accountId: string, quoteId: string, exclude: string | null = null, db: Json = prisma): Promise<{ floorCents: number; contractCents: number } | null> {
  const q = await db.savedQuote.findFirst({ where: { id: quoteId, accountId }, select: { finalPrice: true, work: true } })
  if (!q) return null
  const m = await pricingModule() as Json
  const b = await db.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const type = (q.work as Json)?.type
  const floorCents: number = m.cutFloorCents(m.jobMinimumCents(b?.config ?? null, type === 'move' || type === 'repair'))
  const orders = await db.changeOrder.findMany({ where: { accountId, quoteId, deletedAt: null, ...(exclude ? { id: { not: exclude } } : {}) }, select: { status: true, totalCents: true, signedAt: true } })
  const jobs = (await db.savedJob.findMany({ where: { accountId, quoteId, deletedAt: null }, select: { id: true } })).map((j: { id: string }) => j.id)
  const adj = jobs.length ? (await db.contractAdjustment.aggregate({ where: { accountId, jobId: { in: jobs } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0 : 0
  return { floorCents, contractCents: m.cutContractCents(Math.round((q.finalPrice || 0) * 100), orders, adj) }
}

/** `contract` + `change` under the floor: the owner's box lets it through (returned for the audit log), else refused in words for what is being done. */
async function held(db: Json, accountId: string, quoteId: string, exclude: string | null, changeCents: number, ask: MinimumAsk, doing: CutOverride['doing'], contractOf: (contractCents: number) => number = c => c): Promise<CutOverride | null> {
  const s = await cutStanding(accountId, quoteId, exclude, db)
  if (!s || !(s.floorCents > 0)) return null
  const contractCents = contractOf(s.contractCents)
  const m = await pricingModule() as Json
  if (!m.cutUnderMinimum(contractCents, changeCents, s.floorCents)) return null
  const owner = !ask.customer && can(ask.role, 'quotes.underMinimum')
  if (owner && ask.override) return { floorCents: s.floorCents, contractCents, changeCents, doing }
  throw refused(ask.customer ? CUSTOMER_WORDS : m.cutUnderMinimumWarning(contractCents, changeCents, s.floorCents, owner, doing))
}

/**
 * A save of lines adding up to `changeCents` (a new change order, or new lines
 * on an open one: `exclude` it, `wasCents` its saved total; taking no more off
 * than that is left alone). Throws 409 when refused.
 */
export async function checkCut(db: Json, accountId: string, quoteId: string, changeCents: number, ask: MinimumAsk, opts: { exclude?: string | null; wasCents?: number | null } = {}): Promise<CutOverride | null> {
  if (!(changeCents < 0)) return null
  if (typeof opts.wasCents === 'number' && changeCents >= opts.wasCents) return null
  return held(db, accountId, quoteId, opts.exclude ?? null, changeCents, ask, 'cut')
}

/** Voiding an approved or signed addition: what it leaves is the contract without it, open cuts counted. Throws 409 when refused. */
export async function checkVoid(db: Json, accountId: string, co: { id: string; quoteId: string; status: string; totalCents: number; signedAt?: Date | null }, ask: MinimumAsk): Promise<CutOverride | null> {
  if (!(co.totalCents > 0) || !(co.status === 'approved' || co.signedAt)) return null
  return held(db, accountId, co.quoteId, co.id, -co.totalCents, ask, 'void', c => c + co.totalCents)
}

/**
 * Approving or signing a cut (`totalCents` its lines now): what it leaves at
 * that moment, counted the same way. A check only: nothing is repriced.
 * Throws 409 when refused.
 */
export async function checkApprove(db: Json, accountId: string, co: { id: string; quoteId: string; totalCents: number }, ask: MinimumAsk): Promise<CutOverride | null> {
  if (!(co.totalCents < 0)) return null
  return held(db, accountId, co.quoteId, co.id, co.totalCents, ask, 'approve')
}

/** The owner's override, in the audit log with the contract, the change, the floor it went under and what was done. */
export async function cutOverrideAudit(audit: (action: 'discount_override', entity: string, id: string, o: Json) => Promise<unknown>, changeOrderId: string, o: CutOverride): Promise<void> {
  await audit('discount_override', 'ChangeOrder', changeOrderId, { newValues: { minimumCents: o.floorCents, contractCents: o.contractCents, changeCents: o.changeCents, doing: o.doing } })
}
