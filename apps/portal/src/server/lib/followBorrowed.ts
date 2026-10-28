/**
 * Jonathan, Oct 27 2026: "Any part still priced from Black ... follows Black's
 * price changes until a green price is entered."
 *
 * Every server write that can change an Inventory price runs the item list
 * through this before it is saved (Inventory saves, vendor documents applied,
 * OK'd or undone), and every server start does it too
 * (greenChainLinkFollow.ts): a part whose borrowed price still stands
 * (web/src/priceAge.ts borrowedPrice) takes its part's price now. A price
 * entered for the part itself ends it. Saved quotes are never touched.
 */

import { pricingModule } from './estimates.js'

/** YYYY-MM-DD in Ocala. */
const ocalaDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

export type Followed = Array<{ id: string; part: string; from: string; wasCents: number; nowCents: number }>

/** The items with every borrowed price moved to its part's price now, and what moved. */
export async function followBorrowedReport<T>(items: T[]): Promise<{ items: T[]; followed: Followed }> {
  const m = await pricingModule()
  return m.followBorrowedPrices(items, ocalaDay())
}

/** The items with every borrowed price moved to its part's price now (the same array when nothing moved). */
export async function followBorrowed<T>(items: T[]): Promise<T[]> {
  return (await followBorrowedReport(items)).items
}
