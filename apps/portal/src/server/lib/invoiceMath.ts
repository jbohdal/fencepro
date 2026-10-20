/**
 * The money rules for vendor invoices. All amounts are integer cents.
 *
 * The total check (nothing is applied unless it passes):
 *   1. every line is clear (quantity x price = amount, numbers read surely),
 *   2. the lines add up to the printed subtotal (when one is printed),
 *   3. subtotal + tax + freight + other fees = the printed total, to the cent.
 *
 * Landed cost: tax, freight and fees are spread over the lines by each line's
 * share of the subtotal. Each line's extra is rounded down to the cent and the
 * cents left over go one each to the lines with the largest remainders (ties:
 * the earlier line), so the extras add up exactly to tax + freight + fees.
 * The unit landed cost is (line amount + its extra) / quantity in Inventory
 * units, rounded half up to the cent; the unrounded value is kept too.
 *
 *   $100 line, $1,000 subtotal, $70 tax, $50 freight:
 *   extra = 120 x 100/1000 = $12.00, landed $112.00; 4 boxes of 100 = 400 each,
 *   so $0.28 each.
 */

export interface CheckLine { totalCents: number | null; problems: string[]; ignored?: boolean }
export interface CheckHeader {
  subtotalCents: number | null
  taxCents: number
  freightCents: number
  feesCents: number
  totalCents: number | null
}

export type CheckProblem =
  | { kind: 'unclear_lines'; lines: number[] }
  | { kind: 'subtotal'; linesCents: number; subtotalCents: number }
  | { kind: 'total'; computedCents: number; totalCents: number }
  | { kind: 'no_total' }
  | { kind: 'no_lines' }

export interface CheckResult {
  ok: boolean
  linesCents: number
  subtotalCents: number
  extrasCents: number
  computedTotalCents: number
  problems: CheckProblem[]
}

export function checkTotals(lines: CheckLine[], h: CheckHeader): CheckResult {
  const used = lines.map((l, i) => ({ l, i })).filter(x => !x.l.ignored)
  const problems: CheckProblem[] = []
  const unclear = used.filter(x => x.l.totalCents == null || x.l.problems.length > 0).map(x => x.i)
  if (unclear.length) problems.push({ kind: 'unclear_lines', lines: unclear })
  if (!used.length) problems.push({ kind: 'no_lines' })
  const linesCents = used.reduce((s, x) => s + (x.l.totalCents ?? 0), 0)
  const subtotalCents = h.subtotalCents ?? linesCents
  if (h.subtotalCents != null && h.subtotalCents !== linesCents) problems.push({ kind: 'subtotal', linesCents, subtotalCents: h.subtotalCents })
  const extrasCents = h.taxCents + h.freightCents + h.feesCents
  const computedTotalCents = subtotalCents + extrasCents
  if (h.totalCents == null) problems.push({ kind: 'no_total' })
  else if (h.totalCents !== computedTotalCents) problems.push({ kind: 'total', computedCents: computedTotalCents, totalCents: h.totalCents })
  return { ok: problems.length === 0, linesCents, subtotalCents, extrasCents, computedTotalCents, problems }
}

/**
 * Spread `extrasCents` over lines by their share of the positive line total
 * (largest remainder). Credit lines (negative or zero) get nothing.
 * The result adds up exactly to `extrasCents`.
 */
export function spreadExtras(lineCents: number[], extrasCents: number): number[] {
  const base = lineCents.map(c => (c > 0 ? c : 0))
  const sum = base.reduce((a, b) => a + b, 0)
  if (!sum || !extrasCents) return lineCents.map(() => 0)
  // Exact shares as integers: extras * line / sum, floor, then the remainder.
  const shares = base.map((c, i) => {
    const num = extrasCents * c
    const floor = Math.floor(num / sum)
    return { i, floor, rem: num - floor * sum }
  })
  let left = extrasCents - shares.reduce((a, s) => a + s.floor, 0)
  const order = shares.filter(s => base[s.i] > 0).sort((a, b) => b.rem - a.rem || a.i - b.i)
  const out = shares.map(s => s.floor)
  for (let k = 0; left > 0 && order.length; k = (k + 1) % order.length, left--) out[order[k].i] += 1
  return out
}

/** How a vendor's unit turns into Inventory units: `vendorPer` of theirs = `invPer` of ours. */
export interface Conversion { vendorPer: number; invPer: number }

/** Quantity in Inventory units: 4 boxes of 100 (1 box = 100 each) → 400. */
export function toInventoryQty(qty: number, c: Conversion): number {
  if (!(c.vendorPer > 0) || !(c.invPer > 0)) throw new Error('A unit conversion needs two numbers above zero')
  return (qty * c.invPer) / c.vendorPer
}

/** Unit landed cost: rounded half up to the cent, and the unrounded value. */
export function unitLanded(lineCents: number, extraCents: number, invQty: number): { cents: number; exact: number } {
  if (!(invQty > 0)) throw new Error('Quantity must be above zero')
  const exact = (lineCents + extraCents) / invQty
  return { cents: Math.floor(exact + 0.5 + 1e-9), exact }
}

/** Percent change from the last price (null when there was none). */
export function changePct(prevCents: number | null | undefined, nextCents: number): number | null {
  if (!prevCents || prevCents <= 0) return null
  return ((nextCents - prevCents) / prevCents) * 100
}

/** Waits for an OK when the change is more than `limitPct` either way. */
export function needsOk(prevCents: number | null | undefined, nextCents: number, limitPct: number): boolean {
  const p = changePct(prevCents, nextCents)
  return p != null && Math.abs(p) > limitPct + 1e-9
}

/** The key a vendor's line is remembered by: its item number, else its description. */
export function matchKey(itemNumber: string, description: string): string {
  const code = itemNumber.trim().toUpperCase().replace(/\s+/g, '')
  if (code) return `item:${code}`
  return `desc:${description.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
}

/** The invoice number as compared for duplicates ("INV #00123" and "123" are the same). */
export function invoiceNumberKey(n: string): string {
  return n.toUpperCase().replace(/^(INV(OICE)?)?[\s#:.-]*/, '').replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '')
}

/** "$1,234.56" */
export const dollars = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
