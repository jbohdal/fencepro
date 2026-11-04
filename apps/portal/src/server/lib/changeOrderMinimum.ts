/**
 * A change order that takes work off a job stops at the minimum job price
 * (Jonathan, Nov 3 2026, item 32: "yes, a cut stops at $350. Owner can
 * override."). The server's check under the change order screen's own (web
 * ChangeOrders.tsx, discountMinimum.ts cutUnderMinimum): a crafted save skips
 * the screen, so what is about to be written is read here, whoever sent it.
 *
 * Counted from the contract with every other change order not voided in it
 * (open or approved): the price signed for plus their totals. A credit that
 * takes it under the floor (the job's minimum with the quote's ± dollar
 * adjustment, web discountMinimum.ts cutFloorCents) is refused with 409 for
 * every login but the owner; the owner's goes through only when it says so
 * (minimumOverride, the box on the change order), and the audit log records
 * it. Only a new change order, or new lines that take more off, are checked:
 * one already saved or approved is never repriced.
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

/**
 * The check for one save of a change order on `quoteId` whose lines add up to
 * `changeCents`. `exclude`: the change order being edited (left out of the
 * contract), with `wasCents` its saved total (a change that takes no more off
 * than that is left alone).
 */
export async function checkCutMinimum(accountId: string, role: string | null | undefined, body: Json, quoteId: string, changeCents: number, opts: { exclude?: string | null; wasCents?: number | null } = {}): Promise<CutCheck> {
  if (!(changeCents < 0)) return { kind: 'ok' }
  if (typeof opts.wasCents === 'number' && changeCents >= opts.wasCents) return { kind: 'ok' }
  const q = await prisma.savedQuote.findFirst({ where: { id: quoteId, accountId }, select: { finalPrice: true, pricing: true, work: true } })
  if (!q) return { kind: 'ok' }
  const m = await pricingModule() as Json
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const type = (q.work as Json)?.type
  const floorCents: number = m.cutFloorCents(m.jobMinimumCents(b?.config ?? null, type === 'move' || type === 'repair'), q.pricing ?? null)
  if (!(floorCents > 0)) return { kind: 'ok' }
  const others = await prisma.changeOrder.findMany({ where: { accountId, quoteId, deletedAt: null, status: { not: 'void' }, ...(opts.exclude ? { id: { not: opts.exclude } } : {}) }, select: { totalCents: true } })
  const contractCents = Math.round((q.finalPrice || 0) * 100) + others.reduce((s, o) => s + o.totalCents, 0)
  if (!m.cutUnderMinimum(contractCents, changeCents, floorCents)) return { kind: 'ok' }
  const owner = can(role, 'quotes.underMinimum')
  if (owner && body?.minimumOverride === true) return { kind: 'override', floorCents, contractCents, changeCents }
  return { kind: 'refuse', code: CUT_BELOW_MINIMUM_CODE, error: m.cutUnderMinimumWarning(contractCents, changeCents, floorCents, owner) }
}

/** The owner's full credit, in the audit log with the contract, the credit and the floor it went under. */
export async function cutOverrideAudit(audit: (action: 'discount_override', entity: string, id: string, o: Json) => Promise<unknown>, changeOrderId: string, check: Extract<CutCheck, { kind: 'override' }>): Promise<void> {
  await audit('discount_override', 'ChangeOrder', changeOrderId, { newValues: { minimumCents: check.floorCents, contractCents: check.contractCents, changeCents: check.changeCents } })
}
