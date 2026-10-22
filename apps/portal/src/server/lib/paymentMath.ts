/**
 * The money rules of a payment schedule, in integer cents, with no database:
 * lib/contractBilling.ts saves what these work out, and the phone's offline
 * receipt (web/src/paymentsStore.ts predictReceipt) follows the same rules.
 *
 *   depositOf       contract × deposit percent, to the cent (half a cent rounds up);
 *                   on a contract priced to the whole dollar (Oct 21 2026 on),
 *                   rounded down to the whole dollar, so the final (the rest)
 *                   is whole dollars too
 *   finalOf         what is left of the contract after every other invoice (never below 0)
 *   applyPayments   each payment to the oldest open invoice first, the rest
 *                   carried to the next; what is left over is a credit
 */

export const DEFAULT_DEPOSIT_PCT = 50

export function depositOf(contractCents: number, pct: number | null | undefined, wholeDollars = false): number {
  const p = typeof pct === 'number' && pct > 0 && pct <= 100 ? pct : DEFAULT_DEPOSIT_PCT
  const exact = Math.round((contractCents * p) / 100)
  return wholeDollars ? Math.floor(exact / 100) * 100 : exact
}

/** A signed quote priced to the whole dollar: its proposal or its pricing says so (quotes before Oct 21 2026 keep cents). */
export function pricedWholeDollar(q: { proposal?: unknown; pricing?: unknown } | null | undefined): boolean {
  return (q?.proposal as any)?.wholeDollar === true || (q?.pricing as any)?.wholeDollar === true
}

export function finalOf(contractCents: number, otherInvoiceCents: number[]): number {
  return Math.max(0, contractCents - otherInvoiceCents.reduce((s, c) => s + c, 0))
}

export interface InvoiceLite { id: string; amountCents: number; sortOrder: number; createdAt: Date | string; voided?: boolean }
export interface PaymentLite { id: string; amountCents: number; paidOn: string; createdAt: Date | string; voided?: boolean }
export interface Application { paymentId: string; invoiceId: string; amountCents: number }

const t = (d: Date | string) => (typeof d === 'string' ? new Date(d) : d).getTime()

/** Invoices in the order they are paid: the schedule's order (deposit, progress, final), then oldest first. */
export function invoiceOrder<T extends InvoiceLite>(list: T[]): T[] {
  return list.filter(i => !i.voided).sort((a, b) => a.sortOrder - b.sortOrder || t(a.createdAt) - t(b.createdAt) || a.id.localeCompare(b.id))
}

/** Payments in the order they came: the day paid, then when recorded. */
export function paymentOrder<T extends PaymentLite>(list: T[]): T[] {
  return list.filter(p => !p.voided).sort((a, b) => a.paidOn.localeCompare(b.paidOn) || t(a.createdAt) - t(b.createdAt) || a.id.localeCompare(b.id))
}

export interface Applied {
  applications: Application[]
  paidByInvoice: Map<string, number>
  /** Per payment, what no invoice took (paid over the balance). */
  unappliedByPayment: Map<string, number>
  creditCents: number
}

export function applyPayments(invoices: InvoiceLite[], payments: PaymentLite[]): Applied {
  const inv = invoiceOrder(invoices)
  const open = inv.map(i => ({ id: i.id, left: Math.max(0, i.amountCents) }))
  const applications: Application[] = []
  const paidByInvoice = new Map<string, number>(inv.map(i => [i.id, 0]))
  const unappliedByPayment = new Map<string, number>()
  let credit = 0
  for (const p of paymentOrder(payments)) {
    let left = p.amountCents
    for (const o of open) {
      if (left <= 0) break
      if (o.left <= 0) continue
      const take = Math.min(o.left, left)
      o.left -= take; left -= take
      applications.push({ paymentId: p.id, invoiceId: o.id, amountCents: take })
      paidByInvoice.set(o.id, (paidByInvoice.get(o.id) ?? 0) + take)
    }
    if (left > 0) { unappliedByPayment.set(p.id, left); credit += left }
  }
  return { applications, paidByInvoice, unappliedByPayment, creditCents: credit }
}

/** Dollars and cents for receipts and log lines: $4,457.00 (a credit shows as -$27.00). */
export function moneyText(cents: number): string {
  const neg = cents < 0
  const abs = Math.abs(Math.round(cents))
  const s = '$' + Math.floor(abs / 100).toLocaleString('en-US') + '.' + String(abs % 100).padStart(2, '0')
  return neg ? '-' + s : s
}

export const METHODS = ['check', 'cash', 'zelle', 'card', 'other'] as const
export type Method = typeof METHODS[number]
export const METHOD_LABEL: Record<Method, string> = { check: 'Check', cash: 'Cash', zelle: 'Zelle', card: 'Card', other: 'Other' }

/** "Check #1234", "Cash", "Other (Cashiers check)". */
export function methodText(method: string, checkNumber?: string | null, reference?: string | null): string {
  const base = METHOD_LABEL[method as Method] ?? 'Other'
  if (method === 'check' && checkNumber) return `Check #${checkNumber}${reference ? ` (${reference})` : ''}`
  return reference ? `${base} (${reference})` : base
}
