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
 * A credit that takes the contract under the floor is refused with 409 for
 * every login but the owner; the owner's goes through only when it says so
 * (minimumOverride, the box on the change order), and the audit log records
 * it. Only a new change order, or new lines that take more off, are checked:
 * one already saved or approved is never repriced. Voiding an approved
 * addition that would leave the contract under the floor is refused the same
 * way for every login but the owner.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { can } from './permissions.js'

type Json = any

export const CUT_BELOW_MINIMUM_CODE = 'CHANGE_ORDER_BELOW_MINIMUM'

export type CutCheck =
  | { kind: 'ok' }
  /** The owner chose to give the full credit: recorded by cutOverrideAudit. */
  | { kind: 'override'; floorCents: number; contractCents: number; changeCents: number }
  | { kind: 'refuse'; code: string; error: string }

/** The floor and the contract a cut on `quoteId` is counted from, in cents (`exclude`: the change order being changed, left out). */
export async function cutStanding(accountId: string, quoteId: string, exclude: string | null = null): Promise<{ floorCents: number; contractCents: number } | null> {
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId }, select: { finalPrice: true, work: true } })
  if (!q) return null
  const m = await pricingModule() as Json
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const type = (q.work as Json)?.type
  const floorCents: number = m.cutFloorCents(m.jobMinimumCents(b?.config ?? null, type === 'move' || type === 'repair'))
  const orders = await prisma.changeOrder.findMany({ where: { accountId, quoteId, deletedAt: null, ...(exclude ? { id: { not: exclude } } : {}) }, select: { status: true, totalCents: true, signedAt: true } })
  const jobs = (await prisma.savedJob.findMany({ where: { accountId, quoteId, deletedAt: null }, select: { id: true } })).map(j => j.id)
  const adj = jobs.length ? (await prisma.contractAdjustment.aggregate({ where: { accountId, jobId: { in: jobs } }, _sum: { amountCents: true } }))._sum.amountCents ?? 0 : 0
  return { floorCents, contractCents: m.cutContractCents(Math.round((q.finalPrice || 0) * 100), orders, adj) }
}

/**
 * The check for one save of a change order on `quoteId` whose lines add up to
 * `changeCents`. `exclude`: the change order being edited (left out of the
 * contract), with `wasCents` its saved total (a change that takes no more off
 * than that is left alone).
 */
export async function checkCutMinimum(accountId: string, role: string | null | undefined, body: Json, quoteId: string, changeCents: number, opts: { exclude?: string | null; wasCents?: number | null } = {}): Promise<CutCheck> {
  if (!(changeCents < 0)) return { kind: 'ok' }
  if (typeof opts.wasCents === 'number' && changeCents >= opts.wasCents) return { kind: 'ok' }
  const s = await cutStanding(accountId, quoteId, opts.exclude ?? null)
  if (!s || !(s.floorCents > 0)) return { kind: 'ok' }
  const m = await pricingModule() as Json
  if (!m.cutUnderMinimum(s.contractCents, changeCents, s.floorCents)) return { kind: 'ok' }
  const owner = can(role, 'quotes.underMinimum')
  if (owner && body?.minimumOverride === true) return { kind: 'override', floorCents: s.floorCents, contractCents: s.contractCents, changeCents }
  return { kind: 'refuse', code: CUT_BELOW_MINIMUM_CODE, error: m.cutUnderMinimumWarning(s.contractCents, changeCents, s.floorCents, owner) }
}

/**
 * Voiding an approved addition: what it leaves is the contract without it.
 * Under the floor (and lower than before), refused for every login but the
 * owner, in the same words as a cut.
 */
export async function checkVoidMinimum(accountId: string, role: string | null | undefined, co: { id: string; quoteId: string; status: string; totalCents: number; signedAt?: Date | null }): Promise<CutCheck> {
  if (!(co.totalCents > 0) || !(co.status === 'approved' || co.signedAt) || can(role, 'quotes.underMinimum')) return { kind: 'ok' }
  const s = await cutStanding(accountId, co.quoteId, co.id)
  if (!s || !(s.floorCents > 0)) return { kind: 'ok' }
  const m = await pricingModule() as Json
  const withIt = s.contractCents + co.totalCents
  if (!m.cutUnderMinimum(withIt, -co.totalCents, s.floorCents)) return { kind: 'ok' }
  return { kind: 'refuse', code: CUT_BELOW_MINIMUM_CODE, error: m.cutUnderMinimumWarning(withIt, -co.totalCents, s.floorCents, false) }
}

/** The owner's full credit, in the audit log with the contract, the credit and the floor it went under. */
export async function cutOverrideAudit(audit: (action: 'discount_override', entity: string, id: string, o: Json) => Promise<unknown>, changeOrderId: string, check: Extract<CutCheck, { kind: 'override' }>): Promise<void> {
  await audit('discount_override', 'ChangeOrder', changeOrderId, { newValues: { minimumCents: check.floorCents, contractCents: check.contractCents, changeCents: check.changeCents } })
}
