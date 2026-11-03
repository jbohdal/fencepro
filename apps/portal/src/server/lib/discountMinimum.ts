/**
 * A discount below the minimum job price (Jonathan, Nov 2 2026): "block it and
 * warn the salesman. Owner can override." The server's check under the quote
 * builder's own (web/src/discountMinimum.ts): a crafted save skips the screen,
 * so what is about to be written is read here, whoever sent it.
 *
 * A save that puts a price under the minimum, or lowers one already under it,
 * is refused with 409 for every login but the owner. The owner's save goes
 * through only when it says so (minimumOverride, the box on the quote), and
 * the audit log records it. A price already saved is left alone, and this
 * never changes a price.
 */

import prisma from './prisma.js'
import { pricingModule } from './estimates.js'
import { can } from './permissions.js'
import type { PriceCheck } from './quotePriceCheck.js'

type Json = any

export const BELOW_MINIMUM_CODE = 'DISCOUNT_BELOW_MINIMUM'

export type MinimumCheck =
  | { kind: 'ok' }
  /** The owner chose to save it: recorded by minimumOverrideAudit. */
  | { kind: 'override'; minimumCents: number; under: Array<{ name: string; priceCents: number }> }
  | Extract<PriceCheck, { kind: 'refuse' }>

/** The check for one save. `body` is what was sent, `data` the fields about to be written, `existing` the saved quote (null for a new one). */
export async function checkDiscountMinimum(accountId: string, role: string | null | undefined, body: Json, data: Json, existing: Json | null): Promise<MinimumCheck> {
  const after = { ...(existing ?? {}), ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined)) }
  const m = await pricingModule() as Json
  const b = await prisma.businessState.findUnique({ where: { accountId }, select: { config: true } })
  const minimumCents: number = m.jobMinimumCents(b?.config ?? null, !!after.work)
  const under = m.newlyUnderMinimum(after, existing, minimumCents) as Array<{ name: string; priceCents: number }>
  if (!under.length) return { kind: 'ok' }
  const owner = can(role, 'quotes.underMinimum')
  if (owner && body?.minimumOverride === true) return { kind: 'override', minimumCents, under }
  return { kind: 'refuse', code: BELOW_MINIMUM_CODE, error: m.underMinimumWarning(under, minimumCents, owner) }
}

/** The owner's override, in the audit log with the prices and the minimum it went under. */
export async function minimumOverrideAudit(audit: (action: 'discount_override', entity: string, id: string, o: Json) => Promise<unknown>, quoteId: string, check: Extract<MinimumCheck, { kind: 'override' }>): Promise<void> {
  await audit('discount_override', 'SavedQuote', quoteId, { newValues: { minimumCents: check.minimumCents, prices: check.under.map(u => ({ name: u.name, priceCents: u.priceCents })) } })
}
