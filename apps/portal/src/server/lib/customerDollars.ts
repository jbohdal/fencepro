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
 *   Later that night: a contract asking no deposit says "Once materials are
 *       ordered, their cost is non-refundable." in its Cancellation Policy,
 *       from its own moment (NO_DEPOSIT_CANCEL_KEY).
 *
 * A contract signed before that moment opens exactly as it was signed: its
 * price and deposit to the cent as printed then, its terms as frozen. The
 * moment is recorded once per company (the first time it is asked: at server
 * start, index.ts, before any signing) and kept for good, as schedulesFrom is
 * (lib/contractBilling.ts).
 */

import prisma from './prisma.js'

export const CUSTOMER_DOLLARS_KEY = 'contracts:customer-dollars-from'

/**
 * Cancellation Policy on a contract that asks no deposit (Jonathan, Oct 29
 * 2026, late): "Once materials are ordered, their cost is non-refundable." in
 * place of "The deposit is non-refundable once materials are ordered."
 * (web/src/contractTerms.ts termsAsAsked). It began later than the rules
 * above, so it has its own moment: a contract signed before it keeps the
 * sentence it was signed with.
 */
export const NO_DEPOSIT_CANCEL_KEY = 'contracts:no-deposit-cancellation-from'

/** A moment recorded once per company under `key`, the first time it is asked, and kept for good. */
async function recordedFrom(accountId: string, key: string): Promise<Date> {
  const have = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key } } })
  if (have) return new Date(String(have.value))
  const at = new Date().toISOString()
  // Two at once: the first one written is kept.
  await prisma.accountKeyValue.create({ data: { accountId, key, value: at } }).catch(() => {})
  const row = await prisma.accountKeyValue.findUnique({ where: { accountId_key: { accountId, key } } })
  return new Date(String(row?.value ?? at))
}

/** When the Oct 29 2026 rules began for this company (recorded the first time it is asked). */
export async function customerDollarsFrom(accountId: string): Promise<Date> {
  return recordedFrom(accountId, CUSTOMER_DOLLARS_KEY)
}

/** When the no deposit Cancellation Policy sentence began for this company (recorded the first time it is asked). */
export async function noDepositCancellationFrom(accountId: string): Promise<Date> {
  return recordedFrom(accountId, NO_DEPOSIT_CANCEL_KEY)
}

/** At server start: the moments recorded for every company, so the first signing after a deploy is already on the new rules. */
export async function ensureCustomerDollarsFromAll(): Promise<void> {
  const accounts = await prisma.crmAccount.findMany({ select: { id: true } })
  for (const a of accounts) {
    await customerDollarsFrom(a.id)
    await noDepositCancellationFrom(a.id)
  }
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

/** The contract says the no deposit Cancellation Policy sentence when it asks none: not signed yet, or signed since that rule began. */
export async function quoteOnNoDepositCancellation(q: { accountId: string; acceptedAt?: Date | string | null; soldAt?: Date | string | null; status?: string | null }): Promise<boolean> {
  return onCustomerDollars(q, await noDepositCancellationFrom(q.accountId))
}
