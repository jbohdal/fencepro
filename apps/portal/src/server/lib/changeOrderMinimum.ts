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
 *   only: the amounts are never repriced).
 * The owner's override is kept on the change order (its "minimumOverride"
 * column: who, when, its total then). Approving or signing it later, by the
 * office or the customer, goes through without asking again while its lines
 * still add up to that total (review Nov 3 2026: the owner's full credit could
 * not be signed on the customer's link); new lines clear it. Only an owner's
 * ticked box writes it.
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
export interface MinimumAsk { role: string | null | undefined; override: boolean; customer?: boolean; by?: string; userId?: string | null }

/** The owner's override kept on a change order: who gave it, when, and its total then. */
export interface StoredOverride { by: string; userId: string | null; at: string; totalCents: number; doing: CutOverride['doing'] }

/** The owner's override, for the audit log (cutOverrideAudit); `covered`: given before and kept on the change order, not asked again. */
export interface CutOverride { floorCents: number; contractCents: number; changeCents: number; doing: 'cut' | 'void' | 'approve'; covered?: StoredOverride }

/** The customer is told to call (never "ask Jonathan"), as for a change order that can't be signed yet (lib/changeOrders.ts refuseClash). */
const CUSTOMER_WORDS = 'This change order needs another look from our office before it can be signed. Please call us.'

const refused = (error: string) => Object.assign(new Error(error), { status: 409, code: CUT_BELOW_MINIMUM_CODE })

/** One save at a time per job: held to the end of the transaction `tx` (Postgres advisory lock on the quote id). */
export async function lockJob(tx: Json, quoteId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${'change-order:' + quoteId}))) l`
}

/** The owner's override kept on change order `id` (null: none). Read and written by SQL: a column the shared client may not know yet. */
export async function storedOverride(db: Json, id: string): Promise<StoredOverride | null> {
  const rows = await db.$queryRaw`SELECT "minimumOverride" AS o FROM "ChangeOrder" WHERE id = ${id}` as Array<{ o: unknown }>
  const o = rows[0]?.o as StoredOverride | null | undefined
  return o && typeof o === 'object' && typeof o.totalCents === 'number' ? o : null
}

/** Keep (or clear, with null) the owner's override on change order `id`. */
export async function keepOverride(db: Json, id: string, o: StoredOverride | null): Promise<void> {
  if (o) await db.$executeRaw`UPDATE "ChangeOrder" SET "minimumOverride" = ${JSON.stringify(o)}::jsonb WHERE id = ${id}`
  else await db.$executeRaw`UPDATE "ChangeOrder" SET "minimumOverride" = NULL WHERE id = ${id}`
}

/** The override to keep for an owner's ticked box on a change order now totalling `totalCents`. */
export const overrideToKeep = (ask: MinimumAsk, o: CutOverride, totalCents: number): StoredOverride =>
  ({ by: ask.by ?? 'The owner', userId: ask.userId ?? null, at: new Date().toISOString(), totalCents, doing: o.doing })

/**
 * The floor and the contract a cut on `quoteId` is counted from, in cents (`exclude`: the change order being changed, left
 * out), and the open cuts in that count (not approved or signed yet).
 */
export async function cutStanding(accountId: string, quoteId: string, exclude: string | null = null, db: Json = prisma): Promise<{ floorCents: number; contractCents: number; openCutCents: number } | null> {
  const q = await db.savedQuote.findFirst({ where: { id: quoteId, accountId }, select: { finalPrice: true, work: true } })
  if (!q) return null
  const m = await pricingModule() as Json
  const b = await db.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const type = (q.work as Json)?.type
  const floorCents: number = m.cutFloorCents(m.jobMinimumCents(b?.config ?? null, type === 'move' || type === 'repair'))
  const orders = await db.changeOrder.findMany({ where: { accountId, quoteId, deletedAt: null, ...(exclude ? { id: { not: exclude } } : {}) }, select: { status: true, totalCents: true, signedAt: true } })
  const jobs = (await db.savedJob.findMany({ where: { accountId, quoteId, deletedAt: null }, select: { id: true } })).map((j: { id: string }) => j.id)
  const adj = jobs.length ? (await db.contractAdjustment.aggregate({ where: { accountId, jobId: { in: jobs } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0 : 0
  const openCutCents = orders.filter((o: Json) => o.status !== 'void' && o.status !== 'approved' && !o.signedAt && o.totalCents < 0).reduce((t: number, o: Json) => t + o.totalCents, 0)
  return { floorCents, contractCents: m.cutContractCents(Math.round((q.finalPrice || 0) * 100), orders, adj), openCutCents }
}

/**
 * `contract` + `change` under the floor: the owner's box lets it through (returned for the audit log), as does an override
 * kept on the change order (`covered`); else refused in words for what is being done.
 */
async function held(db: Json, accountId: string, quoteId: string, exclude: string | null, changeCents: number, ask: MinimumAsk, doing: CutOverride['doing'], contractOf: (contractCents: number) => number = c => c, covered: StoredOverride | null = null): Promise<CutOverride | null> {
  const s = await cutStanding(accountId, quoteId, exclude, db)
  if (!s || !(s.floorCents > 0)) return null
  const contractCents = contractOf(s.contractCents)
  const m = await pricingModule() as Json
  if (!m.cutUnderMinimum(contractCents, changeCents, s.floorCents)) return null
  if (covered) return { floorCents: s.floorCents, contractCents, changeCents, doing, covered }
  const owner = !ask.customer && can(ask.role, 'quotes.underMinimum')
  if (owner && ask.override) return { floorCents: s.floorCents, contractCents, changeCents, doing }
  throw refused(ask.customer ? CUSTOMER_WORDS : m.cutUnderMinimumWarning(contractCents, changeCents, s.floorCents, owner, doing, s.openCutCents !== 0))
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
 * that moment, counted the same way. A check only: nothing is repriced. An
 * owner's override kept on it, given at this same total, covers it.
 * Throws 409 when refused.
 */
export async function checkApprove(db: Json, accountId: string, co: { id: string; quoteId: string; totalCents: number }, ask: MinimumAsk): Promise<CutOverride | null> {
  if (!(co.totalCents < 0)) return null
  const kept = await storedOverride(db, co.id)
  return held(db, accountId, co.quoteId, co.id, co.totalCents, ask, 'approve', c => c, kept && kept.totalCents === co.totalCents ? kept : null)
}

/** The owner's override, in the audit log with the contract, the change, the floor it went under and what was done (or the override that covered it). */
export async function cutOverrideAudit(audit: (action: 'discount_override', entity: string, id: string, o: Json) => Promise<unknown>, changeOrderId: string, o: CutOverride): Promise<void> {
  await audit('discount_override', 'ChangeOrder', changeOrderId, { newValues: { minimumCents: o.floorCents, contractCents: o.contractCents, changeCents: o.changeCents, doing: o.doing, ...(o.covered ? { coveredByOwnerOverride: o.covered } : {}) } })
}
