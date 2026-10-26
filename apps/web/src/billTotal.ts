/**
 * What a vendor bill comes to: lines + tax + freight + fees, in integer cents.
 * A bill made from a vendor document carries its freight and fees (a $25 fuel
 * charge); the server works out the same total (portal lib/invoiceMath
 * billWithCharges). No browser code here, so it is tested on its own.
 */
export function billTotalCents(b: { subtotalCents: number; taxCents?: number; freightCents?: number; fees?: Array<{ cents: number }> }): number {
  return (b.subtotalCents || 0) + (b.taxCents || 0) + (b.freightCents || 0) + (b.fees ?? []).reduce((s, f) => s + (Number(f.cents) || 0), 0)
}
