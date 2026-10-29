/**
 * Jonathan's Oct 29 2026 answers, and the moment they began for a company:
 *
 *   D1  "Customers pay what they saw." A quote signed from then on is billed
 *       and its contract printed at the whole dollar its proposal shows
 *       (lib/paymentMath.ts shownDollarCents, customerDepositCents).
 *   D2  "0% or blank deposit means no deposit invoice at signing." The
 *       contract's Payment Terms say the proposal's own deposit.
 *   #32 The contract says Getter Done Fence obtains the permits
 *       (web/src/contractTerms.ts termsAsAsked).
 *
 * A contract signed before that moment opens exactly as it was signed: its
 * price and deposit to the cent as printed then, its terms as frozen. The
 * moment is recorded once per company (the first time it is asked: at server
 * start, index.ts, before any signing) and kept for good, as schedulesFrom is
 * (lib/contractBilling.ts).
 */

import prisma from './prisma.js'

export const CUSTOMER_DOLLARS_KEY = 'contracts:customer-dollars-from'

/** When the Oct 29 2026 rules began for this company (recorded the first time it is asked). */
export async function customerDollarsFrom(accountId: string): Promise<Date> {
  const have = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: CUSTOMER_DOLLARS_KEY } } })
  if (have) return new Date(String(have.value))
  const at = new Date().toISOString()
  // Two at once: the first one written is kept.
  await prisma.accountKeyValue.create({ data: { accountId, key: CUSTOMER_DOLLARS_KEY, value: at } }).catch(() => {})
  const row = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key: CUSTOMER_DOLLARS_KEY } } })
  return new Date(String(row?.value ?? at))
}

/** At server start: the moment recorded for every company, so the first signing after a deploy is already on the new rules. */
export async function ensureCustomerDollarsFromAll(): Promise<void> {
  const accounts = await prisma.crmAccount.findMany({ select: { id: true } })
  for (const a of accounts) await customerDollarsFrom(a.id)
}

/**
 * When a quote was first signed, or null while it is not: soldAt (set the first time it is signed in any way,
 * never cleared, lib/everSold.ts), else when it was accepted on the link. Sold in the app before Oct 29 and
 * accepted on the link after is an old contract.
 */
export function signedAtOf(q: { acceptedAt?: Date | string | null; soldAt?: Date | string | null } | null | undefined): Date | null {
  const at = q?.soldAt ?? q?.acceptedAt ?? null
  return at ? new Date(at) : null
}

/**
 * The quote is on the Oct 29 2026 rules: not signed yet, or signed at or after
 * `from`. False: signed before, so its contract and billing stay as signed.
 */
export function onCustomerDollars(q: { acceptedAt?: Date | string | null; soldAt?: Date | string | null; status?: string | null } | null | undefined, from: Date): boolean {
  const at = signedAtOf(q)
  // Sold before "ever sold" was recorded (no date at all): an old sale.
  if (!at) return q?.status !== 'SOLD'
  return at.getTime() >= from.getTime()
}

/** The same, read for the quote's company. */
export async function quoteOnCustomerDollars(q: { accountId: string; acceptedAt?: Date | string | null; soldAt?: Date | string | null; status?: string | null }): Promise<boolean> {
  return onCustomerDollars(q, await customerDollarsFrom(q.accountId))
}
